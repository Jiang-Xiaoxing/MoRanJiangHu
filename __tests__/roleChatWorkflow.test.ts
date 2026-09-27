import { describe, expect, it } from 'vitest';
import {
    构建场外对话记录块,
    构建角色对话消息序列,
    提取亲历回顾,
    序列化NPC档案,
    规范化场外对话列表,
    type 角色对话依赖,
    type 角色对话参数
} from '../hooks/useGame/roleChatWorkflow';

const 目标NPC = {
    id: 'npc-1',
    姓名: '沈听澜',
    性别: '女',
    年龄: 19,
    身份: '受伤剑修',
    简介来历: '被追杀',
    核心性格特征: '清冷孤傲',
    好感度: 15,
    是否在场: true,
    记忆: [
        { 内容: '说过很喜欢竹笛', 时间: '0年12月03日:午时' },
        { 内容: '被主角所救', 时间: '1年01月01日:子时' }
    ],
    总结记忆: [{ 内容: '与主角互信渐生', 时间: '1年01月' }]
};

const 其他NPC = {
    id: 'npc-2',
    姓名: '老李',
    是否在场: true,
    记忆: [{ 内容: '偷偷藏了半坛毒酒', 时间: '1年01月01日:丑时' }]
};

const 基础依赖 = (): 角色对话依赖 => ({
    apiConfig: { 功能模型占位: { 角色对话提示词: '' } } as any,
    社交: [目标NPC, 其他NPC] as any[],
    环境: {},
    角色: { 姓名: '姜小星' } as any,
    历史记录: [],
    memoryConfig: { 即时消息上传条数N: 10 },
    prompts: []
});

describe('规范化场外对话列表', () => {
    it('非数组与空内容一律过滤，旧存档缺失字段按空处理', () => {
        expect(规范化场外对话列表(undefined)).toEqual([]);
        expect(规范化场外对话列表(null)).toEqual([]);
        expect(规范化场外对话列表('junk')).toEqual([]);
        expect(规范化场外对话列表([{ 内容: '' }, { role: 'npc', 发言人: '沈听澜', 内容: '嗯。', 时间: 1 }]))
            .toEqual([{ role: 'npc', 发言人: '沈听澜', 内容: '嗯。', 时间: 1 }]);
    });
});

describe('构建场外对话记录块', () => {
    it('空暂存返回空串（主回合无注入）', () => {
        expect(构建场外对话记录块([])).toBe('');
        expect(构建场外对话记录块(undefined)).toBe('');
    });

    it('逐条带发言人原样列出并附处理指令', () => {
        const block = 构建场外对话记录块([
            { role: 'player', 发言人: '姜小星', 内容: '你在怕什么？', 时间: 1 },
            { role: 'npc', 发言人: '沈听澜', 内容: '……没什么。', 时间: 2 }
        ]);
        expect(block).toContain('【姜小星】你在怕什么？');
        expect(block).toContain('【沈听澜】……没什么。');
        expect(block).toContain('场外对话记录');
        expect(block).toContain('短期记忆');
    });
});

describe('序列化NPC档案（本人认知核心）', () => {
    it('带全量记忆与总结记忆——旧记忆可命中', () => {
        const text = 序列化NPC档案(目标NPC);
        expect(text).toContain('沈听澜');
        expect(text).toContain('说过很喜欢竹笛');
        expect(text).toContain('被主角所救');
        expect(text).toContain('与主角互信渐生');
        expect(text).toContain('好感度：15');
    });
});

describe('提取亲历回顾（不含未来剧本）', () => {
    const mkAssistant = (logs: Array<{ sender: string; text: string }>, gameTime: string) => ({
        role: 'assistant',
        content: 'Structured Response',
        gameTime,
        structuredResponse: { logs }
    });
    const mkUser = (content: string, gameTime: string) => ({
        role: 'user',
        content,
        gameTime
    });

    it('命中含该 NPC 的回合，并明确注明知情边界', () => {
        const history: any[] = [
            mkUser('我走进茶馆。', '1年01月01日:午时'),
            mkAssistant([{ sender: '旁白', text: '沈听澜坐在角落。' }], '1年01月01日:午时'),
            mkUser('我去后山采药。', '1年01月02日:辰时'),
            mkAssistant([{ sender: '旁白', text: '山中无人。' }], '1年01月02日:辰时')
        ];
        const text = 提取亲历回顾(history, '沈听澜', { memoryConfig: { 即时消息上传条数N: 10 } });
        expect(text).toContain('沈听澜坐在角落');
        expect(text).toContain('亲身在场');
        expect(text).not.toContain('采药');
    });

    it('绝不携带主回合的剧情规划（未来剧本）', () => {
        const history: any[] = [
            mkUser('看什么？', '1年01月01日:子时'),
            mkAssistant([{ sender: '沈听澜', text: '看你像麻烦。' }], '1年01月01日:子时')
        ];
        history[1].structuredResponse.剧情规划 = '下一步反派将血洗仁心堂';
        const text = 提取亲历回顾(history, '沈听澜', { memoryConfig: { 即时消息上传条数N: 10 } });
        expect(text).not.toContain('血洗仁心堂');
        expect(text).not.toContain('剧情规划');
    });

    it('无命中时回退最近回合并注明', () => {
        const history: any[] = [
            mkUser('我去后山了。', '1年01月02日:辰时'),
            mkAssistant([{ sender: '旁白', text: '山路安静。' }], '1年01月02日:辰时')
        ];
        const text = 提取亲历回顾(history, '沈听澜', { memoryConfig: { 即时消息上传条数N: 10 } });
        expect(text).toContain('山路安静');
        expect(text).toContain('眼前正在发生的事');
    });
});

describe('构建角色对话消息序列（认知范围白名单）', () => {
    it('只注入本人档案与记忆，绝不注入他人记忆与主剧情记忆块', () => {
        const deps = 基础依赖();
        const params: 角色对话参数 = { npcId: 'npc-1', 玩家输入: '还记得我吗？' };
        const messages = 构建角色对话消息序列(deps, params);
        const all = messages.map((m) => m.content).join('\n');

        expect(messages[0].role).toBe('system');
        expect(all).toContain('角色对话协议');
        expect(all).toContain('说过很喜欢竹笛');
        expect(all).toContain('沈听澜');

        // 他人的秘密不注入
        expect(all).not.toContain('毒酒');
        // 主剧情的全知记忆块不注入
        expect(all).not.toContain('【短期记忆】');
        expect(all).not.toContain('【长期记忆】');
        expect(all).not.toContain('【中期记忆】');
        // 未来剧本不注入
        expect(all).not.toContain('剧情规划');

        // 暂存对话交替 + 本次输入收尾
        expect(messages[messages.length - 1]).toEqual({ role: 'user', content: '还记得我吗？' });
    });

    it('面板暂存的一问一答按 user/assistant 交替回放', () => {
        const deps = 基础依赖();
        const params: 角色对话参数 = {
            npcName: '沈听澜',
            玩家输入: '那笛子送你。',
            暂存对话: [
                { role: 'player', 发言人: '姜小星', 内容: '你腹胀好了吗？', 时间: 1 },
                { role: 'npc', 发言人: '沈听澜', 内容: '多管闲事。', 时间: 2 }
            ]
        };
        const messages = 构建角色对话消息序列(deps, params);
        const tail = messages.slice(-3);
        expect(tail).toEqual([
            { role: 'user', content: '你腹胀好了吗？' },
            { role: 'assistant', content: '多管闲事。' },
            { role: 'user', content: '那笛子送你。' }
        ]);
    });
});
