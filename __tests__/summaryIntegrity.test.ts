import { beforeEach, describe, expect, it, vi } from 'vitest';

const rawReplyMock = vi.hoisted(() => vi.fn());
const integrityMock = vi.hoisted(() => vi.fn());

vi.mock('../services/ai/text', async () => {
    const actual = await vi.importActual<typeof import('../services/ai/text')>('../services/ai/text');
    return { ...actual, generateRoleChatRawReply: rawReplyMock };
});
vi.mock('../hooks/useGame/streamIntegrity', async () => {
    const actual = await vi.importActual<typeof import('../hooks/useGame/streamIntegrity')>('../hooks/useGame/streamIntegrity');
    return {
        ...actual,
        执行带完整性校验的请求: async (options: any) => {
            integrityMock(options);
            const 结果 = await options.发起非流式请求();
            return { ...(await actual.执行带完整性校验的请求?.length ? {} : {}), 结果, 完整性: '完整', 降级: false };
        }
    };
});

import { 执行角色群聊 } from '../hooks/useGame/groupRoleChatWorkflow';

const 参与者 = [
    { id: 'npc-1', 姓名: '沈听澜', 是否在场: true, 当前位置: '药房' },
    { id: 'npc-2', 姓名: '老李', 是否在场: true, 当前位置: '药房' }
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

const 长记录 = Array.from({ length: 40 }).map((_, i) => ({
    会话类型: 'group' as const, 群聊ID: 'g-int', role: (i % 2 === 0 ? 'player' : 'npc') as 'player' | 'npc',
    npcId: i % 2 === 0 ? undefined : 'npc-2', 发言人: i % 2 === 0 ? '姜小星' : '老李',
    内容: `第${i + 1}条：药材已分好。`, 时间: 1000 + i,
    听众NPCIds: ['npc-1', 'npc-2'], 听众: ['沈听澜', '老李'], 完成状态: 'complete' as const
}));

beforeEach(() => { rawReplyMock.mockReset(); integrityMock.mockReset(); });

describe('摘要请求必须接入完整性校验', () => {
    it('长记录触发摘要时，走的是执行带完整性校验的请求', async () => {
        rawReplyMock
            .mockResolvedValueOnce('<事实>\n1. 药引是城南捎来的红糖\n</事实>\n<概述>在分药材。</概述>')
            .mockResolvedValueOnce('<正文>那就从柴胡开始。</正文><调度>{"action":"wait","nextNpcId":""}</调度>');
        await 执行角色群聊(deps() as any, {
            参与者NPCIds: ['npc-1', 'npc-2'], 玩家输入: '接着来。', 首位NPCId: 'npc-1',
            自动回复上限: 1, 已确认全部位置: true, 暂存对话: 长记录, 群聊ID: 'g-int'
        });
        // 发言那条本来就走完整性校验，摘要这条也必须走；至少各一次
        const 功能名 = integrityMock.mock.calls.map((c: any) => c[0].功能名);
        expect(功能名).toContain('群聊记录摘要');
        const 摘要调用 = integrityMock.mock.calls.find((c: any) => c[0].功能名 === '群聊记录摘要');
        expect(typeof 摘要调用[0].发起非流式请求).toBe('function');
        expect(typeof 摘要调用[0].发起流式请求).toBe('function');
    });
});
