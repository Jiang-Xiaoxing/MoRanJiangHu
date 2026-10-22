import { describe, expect, it } from 'vitest';
import { 计算角色对话重Roll目标 } from '../hooks/useGame/roleChatWorkflow';
import type { 场外对话消息结构 } from '../types';

/**
 * 「角色对话」重ROLL 的定位逻辑。
 *
 * 角色对话的入库形态是成对的 `[玩家, NPC]`，而 `执行角色对话` 会在回放暂存历史之后
 * 再把 `玩家输入` 追加成最后一条 user 消息。所以要重生成上一次的回复，必须把那一对
 * 从暂存里摘掉；只摘 NPC 那条会让同一句玩家发言在上下文里出现两次。
 */

const 消息 = (
    role: 'player' | 'npc',
    内容: string,
    extra?: Partial<场外对话消息结构>
): 场外对话消息结构 => ({
    role,
    发言人: role === 'npc' ? '沈照临' : '陆行舟',
    内容,
    时间: 1,
    ...extra
} as 场外对话消息结构);

describe('角色对话重ROLL 目标计算', () => {
    it('一对问答：摘掉这两条，用玩家原话重发', () => {
        const list = [
            消息('player', '你师父是谁？', { npcId: 'npc_1', 会话类型: 'single' }),
            消息('npc', '无可奉告。', { npcId: 'npc_1', 会话类型: 'single' })
        ];
        const 目标 = 计算角色对话重Roll目标(list, { npcId: 'npc_1' });
        expect(目标).not.toBeNull();
        expect(目标!.玩家输入).toBe('你师父是谁？');
        expect(目标!.剩余暂存).toEqual([]);
    });

    it('多轮对话：只摘最后一对，历史保留', () => {
        const list = [
            消息('player', '第一问', { npcId: 'npc_1', 会话类型: 'single' }),
            消息('npc', '第一答', { npcId: 'npc_1', 会话类型: 'single' }),
            消息('player', '第二问', { npcId: 'npc_1', 会话类型: 'single' }),
            消息('npc', '第二答', { npcId: 'npc_1', 会话类型: 'single' })
        ];
        const 目标 = 计算角色对话重Roll目标(list, { npcId: 'npc_1' });
        expect(目标!.玩家输入).toBe('第二问');
        expect(目标!.剩余暂存.map((item) => item.内容)).toEqual(['第一问', '第一答']);
    });

    it('最后一条是玩家发言时不可重ROLL（还没回复，应该直接发送）', () => {
        const list = [
            消息('player', '第一问', { npcId: 'npc_1', 会话类型: 'single' }),
            消息('npc', '第一答', { npcId: 'npc_1', 会话类型: 'single' }),
            消息('player', '第二问', { npcId: 'npc_1', 会话类型: 'single' })
        ];
        expect(计算角色对话重Roll目标(list, { npcId: 'npc_1' })).toBeNull();
    });

    it('只有一条消息时不可重ROLL', () => {
        const list = [消息('npc', '独白', { npcId: 'npc_1', 会话类型: 'single' })];
        expect(计算角色对话重Roll目标(list, { npcId: 'npc_1' })).toBeNull();
    });

    it('空列表 / 无目标标识时不可重ROLL', () => {
        expect(计算角色对话重Roll目标([], { npcId: 'npc_1' })).toBeNull();
        expect(计算角色对话重Roll目标(null, { npcId: 'npc_1' })).toBeNull();
        const list = [
            消息('player', '问', { npcId: 'npc_1', 会话类型: 'single' }),
            消息('npc', '答', { npcId: 'npc_1', 会话类型: 'single' })
        ];
        expect(计算角色对话重Roll目标(list, {})).toBeNull();
    });

    it('别的角色的对话不会被摘掉', () => {
        const list = [
            消息('player', '问甲', { npcId: 'npc_1', 会话类型: 'single' }),
            消息('npc', '答甲', { npcId: 'npc_1', 会话类型: 'single' }),
            消息('player', '问乙', { npcId: 'npc_2', 会话类型: 'single' }),
            消息('npc', '答乙', { npcId: 'npc_2', 会话类型: 'single' })
        ];
        const 目标 = 计算角色对话重Roll目标(list, { npcId: 'npc_1' });
        expect(目标!.玩家输入).toBe('问甲');
        expect(目标!.剩余暂存.map((item) => item.内容)).toEqual(['问乙', '答乙']);
    });

    it('群聊记录不参与单聊重ROLL', () => {
        const list = [
            消息('player', '单聊问', { npcId: 'npc_1', 会话类型: 'single' }),
            消息('npc', '单聊答', { npcId: 'npc_1', 会话类型: 'single' }),
            消息('npc', '群聊插话', { npcId: 'npc_1', 会话类型: 'group' })
        ];
        const 目标 = 计算角色对话重Roll目标(list, { npcId: 'npc_1' });
        expect(目标!.玩家输入).toBe('单聊问');
        // 群聊那条既不当成「最后一条 NPC 回复」，也不会被删掉。
        expect(目标!.剩余暂存.map((item) => item.内容)).toEqual(['群聊插话']);
    });

    it('缺 npcId 时退回姓名匹配（老存档只有姓名）', () => {
        const list = [
            消息('player', '问', { 会话类型: 'single' }),
            消息('npc', '答', { 会话类型: 'single' })
        ];
        // 两条都没有 npcId：无法判定归属，不能贸然删除。
        expect(计算角色对话重Roll目标(list, { npcName: '沈照临' })).toBeNull();

        const withId = [
            消息('player', '问', { npcId: '沈照临', 会话类型: 'single' }),
            消息('npc', '答', { npcId: '沈照临', 会话类型: 'single' })
        ];
        const 目标 = 计算角色对话重Roll目标(withId, { npcName: '沈照临' });
        expect(目标!.玩家输入).toBe('问');
    });
});
