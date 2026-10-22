import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { generateStoryResponse } from '../services/ai/storyTasks';
import { naturalProseDefaults } from '../utils/naturalProse';
import { DEFAULT_NATURAL_PROSE_PROMPT } from '../prompts/writing/naturalProse';
const api = { id: 'test', 名称: 'Gemini 展示名', 供应商: 'openai_compatible', 协议覆盖: 'openai', baseUrl: 'https://story.test/v1', apiKey: 'fake-test-key', model: 'claude-sonnet-4-5' } as const;
const response = '<正文>【旁白】你走出客栈。</正文><短期记忆>你出门了。</短期记忆><命令>set 环境.小地点 = "街道"</命令>';
const fetchMock = vi.fn();
beforeEach(() => {
    fetchMock.mockReset().mockImplementation(async () => new Response(JSON.stringify({ choices: [{ message: { content: response }, finish_reason: 'stop' }] }), { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());
const run = (settings: typeof naturalProseDefaults | undefined, model = api.model as string) => generateStoryResponse('原有核心规则，保留输出协议。', '世界观和玩家设定', '走出客栈', { ...api, model }, undefined, undefined, undefined, { naturalProse: settings, enableCotInjection: false, validateDialogueFormat: false });
const payload = (index = 0) => JSON.parse(fetchMock.mock.calls[index][1].body);
describe('自然文风最终HTTP请求', () => {
    it('关闭时最终HTTP body与原请求完全相同', async () => {
        await run(undefined); const baseline = payload();
        await run(naturalProseDefaults);
        expect(payload(1)).toEqual(baseline);
        expect(JSON.stringify(payload(1))).not.toContain('自然文风');
    });
    it.each(['claude-sonnet-4-5', 'gemini-2.5-pro', 'custom-model'])('实际model=%s最终HTTP请求使用相同规则，响应命令可解析', async model => {
        const result = await run({ ...naturalProseDefaults, enabled: true }, model);
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(fetchMock.mock.calls[0][0]).toBe('https://story.test/v1/chat/completions');
        expect(payload().model).toBe(model);
        const text = payload().messages.map((message: any) => message.content).join('\n');
        expect(text.match(/【自然文风修复协议】/g)).toHaveLength(1);
        expect(payload().messages.filter((m: any) => m.content === DEFAULT_NATURAL_PROSE_PROMPT)).toHaveLength(1);
        expect(text).toContain('原有核心规则'); expect(text).toContain('世界观和玩家设定');
        expect(result.response.tavern_commands).toEqual([{ action: 'set', key: '环境.小地点', value: '街道' }]);
    });
    it('JSON响应沿用原解析流程，文风功能不参与响应变换', async () => {
        const value = { logs: [{ sender: '旁白', text: '你走出客栈。' }], tavern_commands: [{ action: 'set', key: '环境.小地点', value: '街道' }] };
        fetchMock.mockImplementation(async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(value) } }] })));
        const baseline = await run(undefined);
        const enhanced = await run({ ...naturalProseDefaults, enabled: true });
        expect(enhanced).toEqual(baseline);
        expect(enhanced.rawText).toBe(JSON.stringify(value));
    });
});
