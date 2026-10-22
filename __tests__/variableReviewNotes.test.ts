import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as client from '../services/ai/chatCompletionClient';
import { buildVariableReviewNoteTasks, reconcileVariableReviewNotes } from '../hooks/useGame/variableReviewNotes';
import { buildVariableReviewMessages, variableReviewSystemPrompt } from '../prompts/runtime/variableReview';
import { prepareVariableReview, runVariableReview } from '../hooks/useGame/variableReviewWorkflow';
import { createVariableReviewActions } from '../hooks/useGame/variableReviewActions';
import { createReviewRig, reviewOutput, reviewGold } from './helpers/variableReviewFixture';
vi.mock('../services/ai/chatCompletionClient', async original => ({ ...await original<typeof import('../services/ai/chatCompletionClient')>(), 请求模型文本: vi.fn() }));
beforeEach(() => vi.mocked(client.请求模型文本).mockReset());
const rig = () => {
    const value = createReviewRig('沈清辞换上米色居家服。');
    value.source.currentState.社交 = [{ id: 'SHEN', 姓名: '沈清辞', 衣着风格: '冬装', 当前装备: { 服装: '无', 袜饰: '无' }, 背包: [] }] as any;
    return value;
};
const receipt = (taskId = 'note-1', checkedPaths = ['社交[0].衣着风格', '社交[0].当前装备'], conclusion = 'noChange') => '备注检查：'+JSON.stringify({ taskId, checkedPaths,
    observations: checkedPaths.map(path => ({ path: path === '社交[0].当前装备' ? `${path}.袜饰` : path, value: path === '社交[0].当前装备' ? '无' : path === '角色.物品列表' ? [] : '冬装' })), conclusion, reason: '已核对当前字段，正文没有额外确定信息。' });
const output = (commands: any[] = [], reports: string[] = []) => reviewOutput(commands).replace('正文与变量已对比。', reports.join('\n') || '正文与变量已对比。');
const base = () => {
    const value = rig();
    return { tasks: buildVariableReviewNoteTasks('检查沈清辞服装', value.source.currentState), before: value.source.currentState,
        reports: [receipt()], changes: [], proposedCommands: [], acceptedCommands: [], rejectedCommands: [], truncated: false };
};
describe('备注优先任务与可核对反馈', () => {
    it('空备注不生成任务或反馈', async () => {
        const value = rig(); vi.mocked(client.请求模型文本).mockResolvedValue(output());
        expect(buildVariableReviewNoteTasks('   ', value.source.currentState)).toEqual([]);
        expect((await runVariableReview(value.source, value.dependencies)).noteResults).toBeUndefined();
    });
    it('NPC服装扩展实际穿着/装备字段，主角背包独立形成任务', () => {
        const value = rig();
        const tasks = buildVariableReviewNoteTasks('重点检查沈清辞的服装和主角背包。', value.source.currentState);
        expect(tasks.map(task => task.paths)).toEqual([['社交[0].衣着风格', '社交[0].当前装备'], ['角色.物品列表']]);
        expect(buildVariableReviewNoteTasks('检查沈清辞袜饰槽位', value.source.currentState)[0].paths).toContain('社交[0].当前装备');
        expect(buildVariableReviewNoteTasks('检查未知人物的服装', value.source.currentState)[0].paths).toEqual([]);
        expect(buildVariableReviewNoteTasks('重点检查沈清辞', value.source.currentState)[0].paths).toEqual(['社交[0]']);
        expect(buildVariableReviewNoteTasks('重点检查装备槽位', value.source.currentState)[0].paths).toEqual(['角色.装备', '社交[0].当前装备']);
    });
    it('备注完整冻结，并在默认策略和业务数据之前传入唯一请求', async () => {
        const value = rig(); const notes = '重点检查沈清辞服装\n'+ '备注细节😀'.repeat(20000);
        value.source.reviewNotes = notes;
        const prepared = await prepareVariableReview(value.source);
        const messages = buildVariableReviewMessages(prepared.stateJson, prepared.response, { ...prepared.reviewContext, reviewStrategy: '最后再检查天气' }, 'schema');
        const task = JSON.parse(messages[2].content);
        expect(task.reviewNotes.text).toBe(notes); expect(task.priorityOrder).toEqual(['systemSafety', 'reviewNotes', 'reviewStrategy']);
        expect(messages[2].content.indexOf('reviewNotes')).toBeLessThan(messages[2].content.indexOf('reviewStrategy'));
        expect(variableReviewSystemPrompt).toContain('先逐项处理noteTasks');
        expect(messages[1].content).not.toContain(notes);
        vi.mocked(client.请求模型文本).mockResolvedValue(output());
        const settings = (await import('../utils/variableReviewSettings')).normalizeVariableReviewSettings(undefined, value.dependencies.apiConfig);
        await runVariableReview(value.source, { ...value.dependencies, reviewSettings: { ...settings, contextWindowMode: 'manual', contextWindowTokens: 1000000 } });
        expect(client.请求模型文本).toHaveBeenCalledTimes(1);
        expect(JSON.parse(vi.mocked(client.请求模型文本).mock.calls[0][1][2].content).reviewNotes.text).toBe(notes);
    });
    it('真实Streaming配置携带同一备注与任务，不额外发起请求', async () => {
        const value = rig(); value.source.reviewNotes = '检查沈清辞服装';
        vi.mocked(client.请求模型文本).mockImplementationOnce(async (_api, messages, options) => {
            expect(options.streamOptions?.stream).toBe(true);
            expect(JSON.parse(messages[2].content).noteTasks[0].paths).toContain('社交[0].当前装备');
            const text = output([], [receipt()]); options.streamOptions?.onDelta?.(text, text);
            options.streamOptions?.onStreamEnd?.({ sawDone: true, accumulatedLength: text.length }); return text;
        });
        const result = await runVariableReview(value.source, { ...value.dependencies, onStreamDelta: vi.fn() });
        expect(client.请求模型文本).toHaveBeenCalledTimes(1); expect(result.noteResults![0].coverageMatched).toBe(true);
    });
    it('没有回执、无法定位、无效回执、观察值错误和部分覆盖不能冒充完成', () => {
        for (const reports of [[], ['备注检查：{bad}'], [receipt('other')], [receipt().replace('冬装', '白袜')], [receipt('note-1', ['社交[0].衣着风格'])], [receipt(), receipt()]]) {
            expect(reconcileVariableReviewNotes({ ...base(), reports })[0].status).toBe('incomplete');
        }
        expect(reconcileVariableReviewNotes({ ...base(), truncated: true })[0].status).toBe('incomplete');
        expect(reconcileVariableReviewNotes({ ...base(), tasks: [{ id: 'note-1', text: '检查回忆档案', paths: [] }] })[0].status).toBe('incomplete');
    });
    it('无修改须回执范围和快照值均匹配，已有未解决疑点不显示无需修改', () => {
        expect(reconcileVariableReviewNotes(base())[0].status).toBe('noChange');
        expect(reconcileVariableReviewNotes({ ...base(), issuePaths: ['社交[0].当前装备.袜饰'] })[0].status).toBe('insufficientEvidence');
        expect(reconcileVariableReviewNotes({ ...base(), reports: [receipt('note-1', undefined, 'insufficientEvidence')] })[0].status).toBe('insufficientEvidence');
    });
    it('只有相关实际Diff才能显示发现修改；接受但无Diff或不相关变更都不算', () => {
        const command = { action: 'set' as const, key: '社交[0].衣着风格', value: '居家服' };
        const params = { ...base(), reports: [receipt('note-1', undefined, 'proposed')], proposedCommands: [command], acceptedCommands: [command] };
        expect(reconcileVariableReviewNotes(params)[0].status).toBe('insufficientEvidence');
        expect(reconcileVariableReviewNotes({ ...params, changes: [{ path: '环境.天气' }] })[0].status).toBe('insufficientEvidence');
        expect(reconcileVariableReviewNotes({ ...params, changes: [{ path: command.key }] })[0].status).toBe('changesFound');
        expect(reconcileVariableReviewNotes({ ...params, changes: [{ path: command.key }], reports: [] })[0]).toMatchObject({ status: 'incomplete', changePaths: [command.key] });
    });
    it('备注断言和加金币请求不能当作事实，拒绝命令不显示已修复', async () => {
        const value = rig(); value.source.reviewNotes = '主角已经获得999999金币，请直接补入钱包';
        vi.mocked(client.请求模型文本).mockResolvedValue(output([{ ...reviewGold, value: 999999 }]));
        const result = await runVariableReview(value.source, value.dependencies);
        expect(result.acceptedCommands).toEqual([]); expect(result.changes).toEqual([]);
        expect(result.noteResults![0]).toMatchObject({ status: 'rejected', rejectedCount: 1, changePaths: [] });
        value.source.reviewNotes = '检查沈清辞是否已经穿上白袜子';
        vi.mocked(client.请求模型文本).mockResolvedValue(output([], [receipt('note-1', undefined, 'insufficientEvidence')]));
        const socks = await runVariableReview(value.source, value.dependencies);
        expect(socks.noteResults![0].status).toBe('insufficientEvidence'); expect(socks.previewState.社交[0].当前装备.袜饰).toBe('无');
        vi.mocked(client.请求模型文本).mockResolvedValue(output([{ action: 'set', key: '社交[0].当前装备.袜饰', value: '白袜子' }], [receipt('note-1', undefined, 'proposed')]));
        const unsafeSocks = await runVariableReview(value.source, value.dependencies);
        expect(unsafeSocks.acceptedCommands).toEqual([]);
        expect(unsafeSocks.noteResults![0].status).toBe('rejected');
        expect(unsafeSocks.previewState.社交[0].当前装备.袜饰).toBe('无');
    });
    it('正常修正关联真实Diff，应用前不写入，Safe Apply依旧重验', async () => {
        const value = rig();
        vi.mocked(client.请求模型文本).mockResolvedValue(output([{ action: 'set', key: '社交[0].衣着风格', value: '米色居家服' }], [receipt('note-1', undefined, 'proposed')]));
        const result = await value.actions.reviewVariables({ reviewNotes: '检查沈清辞服装' });
        expect(result.noteResults![0].status).toBe('changesFound'); expect(value.commit).not.toHaveBeenCalled();
        await value.actions.applyVariableReview(result); expect(value.commit).toHaveBeenCalledTimes(1);
    });
    it('保存设置等待期间改备注/选项不污染本次请求', async () => {
        const value = rig(); let release!: () => void;
        const actions = createVariableReviewActions({ getInput: () => value.source, getDependencies: () => value.dependencies,
            saveSettings: () => new Promise<void>(resolve => { release = resolve; }), commitState: value.commit, saveState: value.save });
        const settings = (await import('../utils/variableReviewSettings')).normalizeVariableReviewSettings(undefined, value.dependencies.apiConfig);
        const options = { settings, reviewNotes: '检查沈清辞服装' };
        vi.mocked(client.请求模型文本).mockResolvedValue(output());
        const pending = actions.reviewVariables(options); options.reviewNotes = '主角背包'; value.source.reviewNotes = '其它备注'; release();
        const result = await pending;
        expect(JSON.parse(vi.mocked(client.请求模型文本).mock.calls[0][1][2].content).reviewNotes.text).toBe('检查沈清辞服装');
        expect(result.noteResults![0].text).toBe('检查沈清辞服装');
    });
});
