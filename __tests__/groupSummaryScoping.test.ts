import { describe, expect, it } from 'vitest';
import { 写入群聊摘要, 构建群聊记录视图 } from '../hooks/useGame/groupChatTranscriptBudget';
import type { 场外对话消息结构, 群聊摘要条目 } from '../types';

/**
 * 群聊摘要的群聊隔离。
 *
 * 摘要挂在「被摘要的最后一条消息」上，而 `写入群聊摘要` 原实现只按时间戳找落点、
 * 没有比对群聊ID。两个群聊的相邻消息落在同一毫秒时，A 群的摘要会挂到 B 群的消息上：
 *  - A 群读不到自己那份 → 下一轮重新生成一次（把省下的 token 又花回去）；
 *  - B 群的视图只要听众键相同就会捡起来 → B 群的角色读到 A 群的对话，
 *    违反本模块「知情边界先过滤再摘要」的约定。
 */

const 群消息 = (
    群聊ID: string,
    内容: string,
    时间: number,
    extra?: Partial<场外对话消息结构>
): 场外对话消息结构 => ({
    会话类型: 'group',
    群聊ID,
    role: 'npc',
    npcId: 'npc-1',
    发言人: '甲',
    内容,
    时间,
    听众NPCIds: ['npc-1', 'npc-2'],
    ...extra
} as 场外对话消息结构);

const 造摘要 = (
    覆盖到时间: number,
    内容: string,
    extra?: Partial<群聊摘要条目>
): 群聊摘要条目 => ({
    听众键: 'npc-1|npc-2',
    覆盖到时间,
    内容,
    生成时间: 1,
    ...extra
} as 群聊摘要条目);

describe('群聊摘要按群聊ID隔离', () => {
    it('两个群聊同一毫秒时，摘要落在自己那条消息上', () => {
        const 记录 = [
            群消息('g1', 'A1', 100),
            群消息('g2', 'B1', 100),
            群消息('g1', 'A2', 200)
        ];
        const 写入后 = 写入群聊摘要(记录, 造摘要(100, 'A群摘要', { 群聊ID: 'g1' }));
        const 落点 = 写入后.findIndex((item) => Array.isArray(item.群聊摘要) && item.群聊摘要!.length > 0);
        expect(落点).toBe(0);
        expect(写入后[落点]?.群聊ID).toBe('g1');
    });

    it('别的群聊读不到本群摘要（知情边界）', () => {
        const 记录 = 写入群聊摘要(
            [群消息('g1', 'A1', 100), 群消息('g1', 'A2', 200), 群消息('g2', 'B1', 300)],
            造摘要(200, 'A群摘要', { 群聊ID: 'g1' })
        );
        const g1视图 = 构建群聊记录视图(记录, { groupId: 'g1', npcId: 'npc-1', audienceIds: ['npc-1', 'npc-2'] });
        const g2视图 = 构建群聊记录视图(记录, { groupId: 'g2', npcId: 'npc-1', audienceIds: ['npc-1', 'npc-2'] });
        expect(g1视图.摘要?.内容).toBe('A群摘要');
        expect(g2视图.摘要).toBeUndefined();
        expect(g2视图.渲染).not.toContain('A群摘要');
    });

    it('误挂到别的群消息上的旧摘要不会被本群读到', () => {
        // 模拟修复前写坏的存档：摘要挂在 g2 的消息上，但内容是 g1 的。
        const 记录 = [
            群消息('g1', 'A1', 100),
            群消息('g2', 'B1', 200, { 群聊摘要: [造摘要(100, 'A群摘要', { 群聊ID: 'g1' })] })
        ];
        const g2视图 = 构建群聊记录视图(记录, { groupId: 'g2', npcId: 'npc-1', audienceIds: ['npc-1', 'npc-2'] });
        expect(g2视图.摘要).toBeUndefined();
        expect(g2视图.渲染).not.toContain('A群摘要');
    });

    it('没有群聊ID的老条目仍按时间落位（向后兼容）', () => {
        const 记录 = [群消息('g1', 'A1', 100), 群消息('g2', 'B1', 200)];
        const 写入后 = 写入群聊摘要(记录, 造摘要(100, '老摘要'));
        const 落点 = 写入后.findIndex((item) => Array.isArray(item.群聊摘要) && item.群聊摘要!.length > 0);
        expect(落点).toBe(0);
    });

    it('同群同听众键的新摘要覆盖旧的，不重复堆积', () => {
        const 记录 = [
            群消息('g1', 'A1', 100),
            群消息('g1', 'A2', 200)
        ];
        const 第一次 = 写入群聊摘要(记录, 造摘要(100, '第一份', { 群聊ID: 'g1' }));
        const 第二次 = 写入群聊摘要(第一次, 造摘要(200, '第二份', { 群聊ID: 'g1' }));
        const 全部 = 第二次.flatMap((item) => Array.isArray(item.群聊摘要) ? item.群聊摘要 : []);
        // 两份都留着（分别挂在 100 和 200 上）是预期行为，但同一落点不能叠同键多条
        const 落点200 = 第二次[1]?.群聊摘要 || [];
        expect(落点200.filter((entry) => entry.听众键 === 'npc-1|npc-2')).toHaveLength(1);
        expect(全部.every((entry) => entry.群聊ID === 'g1')).toBe(true);
    });
});
