import { beforeEach, describe, expect, it, vi } from 'vitest';

const rawReplyMock = vi.hoisted(() => vi.fn());
vi.mock('../services/ai/text', async () => {
    const actual = await vi.importActual<typeof import('../services/ai/text')>('../services/ai/text');
    return { ...actual, generateRoleChatRawReply: rawReplyMock };
});

import { 构建群聊消息序列, 执行角色群聊 } from '../hooks/useGame/groupRoleChatWorkflow';
import {
    构建群聊记录视图,
    构建摘要请求,
    写入群聊摘要,
    渲染摘要条目,
    拆分摘要事实,
    摘要事实上限
} from '../hooks/useGame/groupChatTranscriptBudget';

const 参与者 = [
    { id: 'npc-1', 姓名: '沈听澜', 是否在场: true, 当前位置: '药房' },
    { id: 'npc-2', 姓名: '老李', 是否在场: true, 当前位置: '药房' },
    { id: 'npc-3', 姓名: '苏晚', 是否在场: true, 当前位置: '药房' }
];
const deps = () => ({
    apiConfig: {
        activeConfigId: 'base',
        configs: [{ id: 'base', 名称: '测试', 供应商: 'openai_compatible', baseUrl: 'https://x.test', apiKey: 'k', model: 'm' }],
        功能模型占位: { 角色对话独立模型开关: true, 角色对话使用模型: 'm', 角色对话API地址: '', 角色对话API密钥: '', 角色对话提示词: '' }
    } as any,
    社交: 参与者,
    环境: { 大地点: '临安', 小地点: '仁心堂', 具体地点: '药房' },
    角色: { 姓名: '姜小星' },
    历史记录: [],
    prompts: []
});

// A、B 之间 4 条对话，听众只有 A、B（C 听不到）
const 旧对话 = Array.from({ length: 4 }).map((_, i) => ({
    会话类型: 'group' as const, 群聊ID: 'g-new', role: (i % 2 === 0 ? 'npc' : 'player') as 'npc' | 'player',
    npcId: i % 2 === 0 ? 'npc-1' : undefined, 发言人: i % 2 === 0 ? '沈听澜' : '姜小星',
    内容: `私房话第${i + 1}条：柜里还压着三两碎银。`, 时间: 1000 + i,
    听众NPCIds: ['npc-1', 'npc-2'], 听众: ['沈听澜', '老李'], 完成状态: 'complete' as const
}));

beforeEach(() => rawReplyMock.mockReset());

describe('段4 新人补课（代码层）', () => {
    it('半路加入的角色拿到补课摘要，且看不到自己没听到的原文', () => {
        const 视图 = 构建群聊记录视图([...旧对话], { groupId: 'g-new', npcId: 'npc-3', audienceIds: ['npc-1', 'npc-2', 'npc-3'] });
        expect(视图.需要补课).toBe(true);
        // 补课请求走的是「刚走近」口径
        expect(构建摘要请求(视图)[0].content).toContain('刚走近');

        // 注入一份补课摘要，等价于模型真的生成了它
        const 补课条目 = { 听众键: 视图.听众键, 覆盖到时间: 1000 + 3, 内容: '刚才两人在商量私房钱的去处。', 生成时间: 1, 补充课: true };
        const 新记录 = 写入群聊摘要([...旧对话], 补课条目);
        const 新视图 = 构建群聊记录视图(新记录, { groupId: 'g-new', npcId: 'npc-3', audienceIds: ['npc-1', 'npc-2', 'npc-3'] });
        const messages = 构建群聊消息序列(deps() as any, 参与者[2], 参与者, 'g-new', 新记录, { 记录文本: 新视图.渲染 });
        const 全文 = messages.map(m => m.content).join('\n');
        expect(全文).toContain('你刚走近');
        // 私密原文（C 没听到的）不能出现在他的 prompt 里
        expect(全文).not.toContain('柜里还压着三两碎银');
    });

    it('从开场就在场的角色没有这段补课', () => {
        const 视图 = 构建群聊记录视图([...旧对话], { groupId: 'g-new', npcId: 'npc-1', audienceIds: ['npc-1', 'npc-2', 'npc-3'] });
        expect(视图.需要补课).toBe(false);
        const messages = 构建群聊消息序列(deps() as any, 参与者[0], 参与者, 'g-new', 写入群聊摘要([...旧对话], {
            听众键: 视图.听众键, 覆盖到时间: 1000 + 3, 内容: '刚才在商量私房钱。', 生成时间: 1
        }), { 记录文本: 构建群聊记录视图(写入群聊摘要([...旧对话], {
            听众键: 视图.听众键, 覆盖到时间: 1000 + 3, 内容: '刚才在商量私房钱。', 生成时间: 1
        }), { groupId: 'g-new', npcId: 'npc-1', audienceIds: ['npc-1', 'npc-2', 'npc-3'] }).渲染 });
        expect(messages.map(m => m.content).join('\n')).not.toContain('你刚走近');
    });
});

describe('段5 摘要生效（代码层）', () => {
    const 造长记录 = (count: number) => Array.from({ length: count }).map((_, i) => ({
        会话类型: 'group' as const, 群聊ID: 'g-long', role: (i % 4 === 0 ? 'player' : 'npc') as 'npc' | 'player',
        npcId: i % 4 === 0 ? undefined : 'npc-2', 发言人: i % 4 === 0 ? '姜小星' : '老李',
        内容: i === 2 ? '药引是城南捎来的红糖。' : `第${i + 1}条：药材已分好。`, 时间: 1000 + i,
        听众NPCIds: ['npc-1', 'npc-2'], 听众: ['沈听澜', '老李'], 完成状态: 'complete' as const
    }));

    it('超过阈值后 prompt 里出现「更早的对话已摘要」', () => {
        const 记录 = 造长记录(40);
        const 视图 = 构建群聊记录视图(记录, { groupId: 'g-long', npcId: 'npc-1', audienceIds: ['npc-1', 'npc-2'] });
        const 条目 = { 听众键: 视图.听众键, 覆盖到时间: 视图.待摘要消息.at(-1)!.时间, 内容: 渲染摘要条目(['药引是城南捎来的红糖'], '在分药材。'), 生成时间: 1, 事实: ['药引是城南捎来的红糖'], 概述: '在分药材。' };
        const 新记录 = 写入群聊摘要(记录, 条目);
        const 新视图 = 构建群聊记录视图(新记录, { groupId: 'g-long', npcId: 'npc-1', audienceIds: ['npc-1', 'npc-2'] });
        expect(新视图.渲染).toContain('更早的对话已摘要');
        expect(新视图.渲染).toContain('城南捎来的红糖');
        const messages = 构建群聊消息序列(deps() as any, 参与者[0], 参与者, 'g-long', 新记录, { 记录文本: 新视图.渲染 });
        expect(messages.map(m => m.content).join('\n')).toContain('更早的对话已摘要');
    });

    it('同一轮里只生成一次摘要，后面的角色直接复用', async () => {
        rawReplyMock
            .mockResolvedValueOnce('<事实>\n1. 药引是城南捎来的红糖\n</事实>\n<概述>还在分药材。</概述>')
            .mockResolvedValueOnce('<正文>那就从柴胡开始。</正文><调度>{"action":"continue","nextNpcId":"npc-2"}</调度>')
            .mockResolvedValueOnce('<正文>成，我这就抓。</正文><调度>{"action":"wait","nextNpcId":""}</调度>');
        const result = await 执行角色群聊(deps() as any, {
            参与者NPCIds: ['npc-1', 'npc-2'], 玩家输入: '接着来。', 首位NPCId: 'npc-1',
            自动回复上限: 2, 已确认全部位置: true, 暂存对话: 造长记录(40), 群聊ID: 'g-long'
        });
        const 摘要调用 = rawReplyMock.mock.calls.filter(call => String(call[0]?.[0]?.content || '').includes('输出格式严格如下'));
        expect(摘要调用).toHaveLength(1);
        expect(result.摘要更新).toHaveLength(1);
        expect(result.摘要更新?.[0].事实).toEqual(['药引是城南捎来的红糖']);
        // 第二个角色的 prompt 里已经能看到这份摘要
        const 第二条 = rawReplyMock.mock.calls[2][0].map((m: any) => m.content).join('\n');
        expect(第二条).toContain('更早的对话已摘要');
    });

    it('事实超限后早期事实仍留在 prompt 里（城南红糖）', () => {
        const 事实 = ['药引是城南捎来的红糖', ...Array.from({ length: 摘要事实上限 + 5 }).map((_, i) => `细节${i + 1}`)];
        const { 最近, 早期 } = 拆分摘要事实(事实);
        const 内容 = 渲染摘要条目(最近, '在备药。', 早期);
        expect(内容).toContain('【早期约定】');
        expect(内容).toContain('城南捎来的红糖');
    });
});
