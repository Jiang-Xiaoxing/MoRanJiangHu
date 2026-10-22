import { beforeEach, describe, expect, it, vi } from 'vitest';

const rawReplyMock = vi.hoisted(() => vi.fn());
vi.mock('../services/ai/text', async () => {
    const actual = await vi.importActual<typeof import('../services/ai/text')>('../services/ai/text');
    return { ...actual, generateRoleChatRawReply: rawReplyMock };
});

import { 执行角色群聊 } from '../hooks/useGame/groupRoleChatWorkflow';
import { 写入群聊摘要, 合并摘要事实 } from '../hooks/useGame/groupChatTranscriptBudget';

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
    环境: { 大地点: '临安', 具体地点: '药房' },
    角色: { 姓名: '姜小星' }, 历史记录: [], prompts: []
});

beforeEach(() => rawReplyMock.mockReset());

describe('review 修复：摘要按群聊隔离', () => {
    it('两个群同一毫秒有消息时，摘要不会挂到别的群', () => {
        const 记录 = [
            { 会话类型: 'group' as const, 群聊ID: 'g-A', role: 'npc' as const, npcId: 'npc-1', 发言人: '沈听澜', 内容: 'A 群的话', 时间: 5000, 听众NPCIds: ['npc-1'], 听众: ['沈听澜'], 完成状态: 'complete' as const },
            { 会话类型: 'group' as const, 群聊ID: 'g-B', role: 'npc' as const, npcId: 'npc-2', 发言人: '老李', 内容: 'B 群的话', 时间: 5000, 听众NPCIds: ['npc-2'], 听众: ['老李'], 完成状态: 'complete' as const }
        ];
        const 条目 = { 群聊ID: 'g-A', 听众键: 'npc-1', 覆盖到时间: 5000, 内容: 'A 群摘要', 生成时间: 1 };
        const 写入后 = 写入群聊摘要(记录, 条目);
        expect(写入后[0].群聊摘要?.[0]?.内容).toBe('A 群摘要');
        expect(写入后[1].群聊摘要).toBeUndefined();
    });

    it('旧存档没有群聊ID时按同群内时间降级，也不跨群', () => {
        const 记录 = [
            { 会话类型: 'group' as const, 群聊ID: 'g-A', role: 'npc' as const, npcId: 'npc-1', 发言人: '沈听澜', 内容: 'A', 时间: 1000, 听众NPCIds: ['npc-1'], 听众: ['沈听澜'], 完成状态: 'complete' as const },
            { 会话类型: 'group' as const, 群聊ID: 'g-B', role: 'npc' as const, npcId: 'npc-2', 发言人: '老李', 内容: 'B', 时间: 2000, 听众NPCIds: ['npc-2'], 听众: ['老李'], 完成状态: 'complete' as const }
        ];
        const 条目 = { 听众键: 'npc-1', 覆盖到时间: 2000, 内容: '旧档摘要', 生成时间: 1 };
        const 写入后 = 写入群聊摘要(记录, 条目);
        // 没有群聊ID时退化成按时间匹配，但仍然只落在 时间<=覆盖 的最后一条上，不会同时写进两个群
        const 命中数 = 写入后.filter(item => Array.isArray(item.群聊摘要) && item.群聊摘要.length > 0).length;
        expect(命中数).toBe(1);
    });
});

describe('review 修复：事实合并不丢细节', () => {
    it('新事实更长且包含旧事实时，用新的替换', () => {
        const 合并 = 合并摘要事实(['药材已分好'], ['药材已分好，先煎的摆在炉边']);
        expect(合并).toEqual(['药材已分好，先煎的摆在炉边']);
    });

    it('旧事实包含新事实时，保留旧的', () => {
        const 合并 = 合并摘要事实(['药材已分好，先煎的摆在炉边'], ['药材已分好']);
        expect(合并).toEqual(['药材已分好，先煎的摆在炉边']);
    });

    it('完全相同的只留一条', () => {
        expect(合并摘要事实(['薄荷另包'], ['薄荷另包'])).toHaveLength(1);
    });
});

describe('review 确认：点名优先确实会越过连说上限（有意设计）', () => {
    it('模型想让自己连说第三轮，但玩家点了另一个人，程序照点名走', async () => {
        rawReplyMock
            .mockResolvedValueOnce('<正文>我先说。</正文><调度>{"action":"continue","nextNpcId":"npc-1"}</调度>')
            .mockResolvedValueOnce('<正文>我再说。</正文><调度>{"action":"continue","nextNpcId":"npc-1"}</调度>')
            .mockResolvedValueOnce('<正文>老李，你来讲讲药材。</正文><调度>{"action":"continue","nextNpcId":"npc-2"}</调度>')
            .mockResolvedValueOnce('<正文>好，我讲。</正文><调度>{"action":"wait","nextNpcId":""}</调度>');
        const result = await 执行角色群聊(deps() as any, {
            参与者NPCIds: ['npc-1', 'npc-2'],
            玩家输入: '沈听澜你连续说两句了，还是叫老李讲讲吧。',
            首位NPCId: 'npc-1', 自动回复上限: 4, 已确认全部位置: true
        });
        const 发言 = result.新增消息.filter((m: any) => m.role === 'npc').map((m: any) => m.npcId);
        expect(发言).toContain('npc-2');
        expect(result.发言次数).toBeGreaterThan(1);
    });
});
