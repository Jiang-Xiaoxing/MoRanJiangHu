import { beforeEach, describe, expect, it, vi } from 'vitest';

const rawReplyMock = vi.hoisted(() => vi.fn());
vi.mock('../services/ai/text', async () => {
    const actual = await vi.importActual<typeof import('../services/ai/text')>('../services/ai/text');
    return { ...actual, generateRoleChatRawReply: rawReplyMock };
});

import { 执行角色群聊 } from '../hooks/useGame/groupRoleChatWorkflow';
import type { 场外对话消息结构 } from '../types';

/**
 * 摘要失败后，本轮**剩余**角色必须仍然拿到完整记录。
 *
 * 触发路径：第一次摘要请求失败 → `摘要生成失败 = true`，本轮不再生成摘要。
 * 若此时仍然去构造「记录视图」并用 `视图.渲染`，而视图里没有摘要，`渲染` 只会
 * 渲染最近 N 条原文，更早的消息既不进摘要也不进原文 → 被静默丢掉。
 * 也就是说摘要一挂，本轮后面说话的每个角色都会忘掉更早的对话。
 *
 * 这里用「最老的那句话是否还在 prompt 里」作为判据。
 */

const 造消息 = (params: {
    内容: string;
    时间: number;
    发言人: string;
    role: 'npc' | 'player';
    npcId?: string;
}): 场外对话消息结构 => ({
    会话类型: 'group',
    群聊ID: 'g-1',
    role: params.role,
    ...(params.npcId ? { npcId: params.npcId } : {}),
    发言人: params.发言人,
    内容: params.内容,
    时间: params.时间,
    听众NPCIds: ['npc-1', 'npc-2'],
    听众: ['npc-1', 'npc-2'],
    完成状态: 'complete'
});

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
    角色: { 姓名: '姜小星' },
    历史记录: [],
    prompts: []
});

// 30 条可见记录：预算模式下只剩最近 8 条，最老的「第1句闲聊。」会被丢掉。
const 三十条历史 = () => Array.from({ length: 30 }, (_, index) => 造消息({
    内容: `第${index + 1}句闲聊。`,
    时间: 1000 + index,
    发言人: index % 2 === 0 ? '姜小星' : '老李',
    role: index % 2 === 0 ? 'player' : 'npc',
    ...(index % 2 === 0 ? {} : { npcId: 'npc-2' })
}));

beforeEach(() => rawReplyMock.mockReset());

describe('摘要失败后本轮剩余角色的上下文', () => {
    it('第一次摘要失败后，后续角色的 prompt 仍然包含最老的那句记录', async () => {
        const 发言提示: string[] = [];
        let 摘要调用 = 0;
        rawReplyMock.mockImplementation(async (...args: any[]) => {
            const 全文 = JSON.stringify(args);
            if (全文.includes('整理成摘要') || 全文.includes('补一句课')) {
                摘要调用 += 1;
                throw new Error('摘要接口挂了');
            }
            发言提示.push(全文);
            // 依次轮转，保证本轮有多位说话人，好观察失败之后的第二轮。
            return '<正文>嗯，我听着。</正文><调度>{"action":"continue","nextNpcId":"npc-2"}</调度>';
        });

        const result = await 执行角色群聊(deps() as any, {
            参与者NPCIds: ['npc-1', 'npc-2'],
            玩家输入: '',
            继续群聊: true,
            群聊ID: 'g-1',
            暂存对话: 三十条历史(),
            首位NPCId: 'npc-1',
            自动回复上限: 4,
            已确认全部位置: true
        } as any);

        expect(摘要调用).toBeGreaterThan(0); // 确实撞上了摘要失败
        expect(result.发言次数).toBeGreaterThanOrEqual(3);

        // 关键断言：失败之后的每一轮发言，最老的记录都不能消失。
        const 失败之后的发言 = 发言提示.slice(1);
        expect(失败之后的发言.length).toBeGreaterThanOrEqual(2);
        for (const 提示 of 失败之后的发言) {
            expect(提示).toContain('第1句闲聊。');
        }
    });

    it('摘要正常时仍然走预算视图，不把整段原文塞回去', async () => {
        const 发言提示: string[] = [];
        rawReplyMock.mockImplementation(async (...args: any[]) => {
            const 全文 = JSON.stringify(args);
            if (全文.includes('整理成摘要') || 全文.includes('补一句课')) {
                return '<事实>\n1. 大家在药房闲聊。\n</事实>\n<概述>众人正有一搭没一搭地说话。</概述>';
            }
            发言提示.push(全文);
            return '<正文>嗯，我听着。</正文><调度>{"action":"continue","nextNpcId":"npc-2"}</调度>';
        });

        await 执行角色群聊(deps() as any, {
            参与者NPCIds: ['npc-1', 'npc-2'],
            玩家输入: '',
            继续群聊: true,
            群聊ID: 'g-1',
            暂存对话: 三十条历史(),
            首位NPCId: 'npc-1',
            自动回复上限: 3,
            已确认全部位置: true
        } as any);

        expect(发言提示.length).toBeGreaterThanOrEqual(2);
        // 有了摘要就不该再回退到整段原文：最老那句被摘要覆盖，不该原样出现。
        expect(发言提示.at(-1)).not.toContain('第1句闲聊。');
        expect(发言提示.at(-1)).toContain('更早的对话已摘要');
    });
});
