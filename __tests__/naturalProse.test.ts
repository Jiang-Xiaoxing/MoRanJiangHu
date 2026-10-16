import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { 创建历史回合工作流 } from '../hooks/useGame/historyTurnWorkflow';
import { buildNaturalProsePrompt, naturalProseDefaults, normalizeNaturalProseSettings, NATURAL_PROSE_SETTINGS_KEY } from '../utils/naturalProse';
import { DEFAULT_NATURAL_PROSE_PROMPT } from '../prompts/writing/naturalProse';
import { createNaturalProseSettingsService } from '../services/naturalProseSettingsService';
import { generateStoryResponse, generateVariableCalibrationUpdate, generateWorldEvolutionUpdate } from '../services/ai/storyTasks';
import * as client from '../services/ai/chatCompletionClient';
vi.mock('../services/ai/chatCompletionClient', async original => ({ ...await original<typeof import('../services/ai/chatCompletionClient')>(), 请求模型文本: vi.fn() }));
const api = { id: 'story', 名称: '展示名', 供应商: 'openai_compatible', baseUrl: 'https://test.invalid/v1', apiKey: 'test', model: 'claude-sonnet-4-5' } as any;
const output = '<正文>【旁白】你推开院门，沿石阶走下山。\n</正文><短期记忆>你走下山。</短期记忆><命令>[{"action":"set","key":"环境.地点","value":"山下"}]</命令>';
const enabled = { enabled: true };
beforeEach(() => { vi.mocked(client.请求模型文本).mockReset().mockResolvedValue(output); });
const createStorage = (initial?: unknown) => {
    const map = new Map<string, unknown>();
    if (initial !== undefined) map.set(NATURAL_PROSE_SETTINGS_KEY, initial);
    const storage = { read: vi.fn(async (key: string) => map.get(key)), write: vi.fn(async (key: string, value: unknown) => { map.set(key, structuredClone(value)); }) };
    return { map, storage };
};
describe('自然文风单开关设置与旧版迁移', () => {
    it.each([undefined, null, {}, [], true, { enabled: 'true' }, { mode: 'claude' }])('无合法开关时默认关闭：%j', raw => {
        expect(normalizeNaturalProseSettings(raw)).toEqual({ enabled: false });
        expect(buildNaturalProsePrompt(normalizeNaturalProseSettings(raw))).toBe('');
    });
    it('开启只使用统一常量，旧提示词与mode完全忽略', () => {
        const raw = { enabled: true, mode: 'claude', generalPrompt: '旧自定义', claudePrompt: '旧Claude', geminiPrompt: '旧Gemini' };
        expect(normalizeNaturalProseSettings(raw)).toEqual({ enabled: true });
        expect(buildNaturalProsePrompt(raw)).toBe(DEFAULT_NATURAL_PROSE_PROMPT);
        expect(buildNaturalProsePrompt({ ...raw, enabled: false })).toBe('');
    });
    it.each([true, false])('旧版开关%s保留，持久化记录清除mode和prompt', async value => {
        const rig = createStorage({ enabled: value, mode: 'gemini', generalPrompt: '旧通用', claudePrompt: '旧Claude', geminiPrompt: '旧Gemini' });
        const service = createNaturalProseSettingsService(rig.storage);
        expect(await service.load()).toEqual({ enabled: value });
        expect(rig.map.get(NATURAL_PROSE_SETTINGS_KEY)).toEqual({ enabled: value });
        expect(rig.storage.write).toHaveBeenCalledTimes(1);
        await service.load(); expect(rig.storage.write).toHaveBeenCalledTimes(1);
    });
    it('默认读取不写入，保存只持久化开关；重开恢复并读取导入的新值', async () => {
        const rig = createStorage(); const service = createNaturalProseSettingsService(rig.storage);
        expect(await service.load()).toEqual(naturalProseDefaults); expect(rig.storage.write).not.toHaveBeenCalled();
        await service.save({ ...enabled, mode: 'auto', generalPrompt: '忽略' } as any);
        expect(rig.map.get(NATURAL_PROSE_SETTINGS_KEY)).toEqual(enabled);
        expect(await createNaturalProseSettingsService(rig.storage).load()).toEqual(enabled);
        rig.map.set(NATURAL_PROSE_SETTINGS_KEY, { enabled: false, mode: 'claude' });
        expect(await service.load()).toEqual({ enabled: false });
        expect(rig.map.get(NATURAL_PROSE_SETTINGS_KEY)).toEqual({ enabled: false });
    });
    it('迁移与快速切换串行，迁移不会覆盖更新值', async () => {
        const rig = createStorage({ enabled: false, mode: 'auto' });
        const service = createNaturalProseSettingsService(rig.storage);
        const loading = service.load(); const first = service.save(enabled); const second = service.save({ enabled: false });
        expect(await loading).toEqual({ enabled: false }); await Promise.all([first, second]);
        expect(rig.storage.write.mock.calls.map(call => call[1])).toEqual([{ enabled: false }, enabled, { enabled: false }]);
        expect(await service.load()).toEqual({ enabled: false });
    });
    it('保存失败后仍可重试，不能污染磁盘记录', async () => {
        const rig = createStorage({ enabled: false }); const service = createNaturalProseSettingsService(rig.storage);
        rig.storage.write.mockRejectedValueOnce(new Error('disk'));
        await expect(service.save(enabled)).rejects.toThrow('disk');
        expect(await service.load()).toEqual({ enabled: false });
        await service.save(enabled); expect(await service.load()).toEqual(enabled);
    });
});
describe('真实正文请求与结构化响应', () => {
    const run = (settings: any, model = api.model, ordered = true) => generateStoryResponse('核心规则', '世界观', '下山', { ...api, model }, undefined, undefined, undefined, {
        naturalProse: settings, enableCotInjection: false,
        ...(ordered ? { orderedMessages: [{ role: 'system', content: '核心规则' }, { role: 'user', content: '下山' }, { role: 'assistant', content: '<正文>', prefix: true }] } : {}),
        validateDialogueFormat: false, validateTagCompleteness: false
    });
    it.each([true, false])('关闭时请求逐条保持原样（ordered=%s）', async ordered => {
        await run(undefined, api.model, ordered);
        const baseline = structuredClone(vi.mocked(client.请求模型文本).mock.calls[0][1]);
        await run(naturalProseDefaults, api.model, ordered);
        expect(vi.mocked(client.请求模型文本).mock.calls[1][1]).toEqual(baseline);
        expect(JSON.stringify(baseline)).not.toContain('自然文风');
    });
    it.each(['claude-sonnet-4-5', 'gemini-2.5-pro', 'gpt-4o', 'custom', ''])('实际模型%s统一注入且仅一次，prefix和命令保留', async model => {
        const result = await run(enabled, model);
        const messages = vi.mocked(client.请求模型文本).mock.calls[0][1];
        expect(messages.filter(m => m.content === DEFAULT_NATURAL_PROSE_PROMPT)).toHaveLength(1);
        expect(messages.at(-1)).toMatchObject({ role: 'assistant', prefix: true, content: '<正文>' });
        expect(messages.some(m => m.content === '核心规则')).toBe(true);
        expect(result.response.logs[0].text).toContain('你推开院门');
        expect(result.response.tavern_commands).toEqual([{ action: 'set', key: '环境.地点', value: '山下' }]);
        expect(client.请求模型文本).toHaveBeenCalledTimes(1);
    });
    it('普通组包和下一次重新生成使用同一套规则；原消息不积累注入', async () => {
        await run(enabled, 'claude-sonnet-4-5', false); await run(enabled, 'gemini-2.5-pro', false);
        for (const call of vi.mocked(client.请求模型文本).mock.calls) {
            expect(call[1].filter(m => m.content === DEFAULT_NATURAL_PROSE_PROMPT)).toHaveLength(1);
        }
    });
    it('已经组装过统一规则的消息不重复注入，调用方消息保持不变', async () => {
        const messages = [{ role: 'system' as const, content: DEFAULT_NATURAL_PROSE_PROMPT }, { role: 'user' as const, content: '下山' }];
        const before = structuredClone(messages);
        await generateStoryResponse('', '', '', api, undefined, undefined, undefined, { naturalProse: enabled, orderedMessages: messages, validateDialogueFormat: false });
        expect(vi.mocked(client.请求模型文本).mock.calls[0][1].filter(m => m.content === DEFAULT_NATURAL_PROSE_PROMPT)).toHaveLength(1);
        expect(messages).toEqual(before);
    });
    it('回档恢复原输入后重新生成正文，继续注入统一规则', async () => {
        const snapshot = { 玩家输入: '重新走下山', 回档前状态: {}, 回档前历史: [] };
        const restore = vi.fn();
        const workflow = 创建历史回合工作流({ loading: false, 弹出重Roll快照: () => snapshot, 回档到快照: restore, 清理回合自动存档并重置状态: vi.fn().mockResolvedValue(undefined) } as any);
        const input = await workflow.handleRegenerate();
        expect(input).toBe(snapshot.玩家输入); expect(restore).toHaveBeenCalledWith(snapshot);
        await generateStoryResponse('核心规则', '', input!, api, undefined, undefined, undefined, { naturalProse: enabled, enableCotInjection: false, validateDialogueFormat: false });
        const messages = vi.mocked(client.请求模型文本).mock.calls[0][1];
        expect(messages.filter(m => m.content === DEFAULT_NATURAL_PROSE_PROMPT)).toHaveLength(1);
        expect(messages.at(-1)?.content).toBe(snapshot.玩家输入);
    });
    it('请求开始后关闭开关不会改变已提交的消息', async () => {
        const settings = { enabled: true }; const promise = run(settings); settings.enabled = false; await promise;
        expect(vi.mocked(client.请求模型文本).mock.calls[0][1][0].content).toBe(DEFAULT_NATURAL_PROSE_PROMPT);
    });
    it.each(['generate', 'review'] as const)('独立变量%s任务不注入', async taskMode => {
        vi.mocked(client.请求模型文本).mockResolvedValue('<说明>状态：无需修改\n正文与变量已对比。</说明><命令></命令>');
        await generateVariableCalibrationUpdate({ stateJson: '{}', response: { logs: [] }, taskMode, reviewContext: { sourceTurnId: 'turn-1' } } as any, api);
        expect(JSON.stringify(vi.mocked(client.请求模型文本).mock.calls)).not.toContain('自然文风');
    });
    it('世界演变独立请求不注入', async () => {
        vi.mocked(client.请求模型文本).mockResolvedValue('<命令>[]</命令>'); await generateWorldEvolutionUpdate('{}', api);
        expect(JSON.stringify(vi.mocked(client.请求模型文本).mock.calls)).not.toContain('自然文风');
    });
    it('开局/普通回合继续传递快照，模型无关，旧存档不新增字段', () => {
        for (const file of ['sendWorkflow', 'openingStoryWorkflow']) {
            const code = readFileSync(`hooks/useGame/${file}.ts`, 'utf8');
            expect(code).toContain('naturalProse: naturalProseSnapshot');
            expect(code.match(/naturalProseSettingsService.load\(\)/g)).toHaveLength(1);
        }
        expect(readFileSync('hooks/useGame/historyTurnWorkflow.ts', 'utf8')).toContain('return snapshot.玩家输入');
        expect(readFileSync('models/system.ts', 'utf8')).not.toContain('natural_prose_settings');
    });
});
