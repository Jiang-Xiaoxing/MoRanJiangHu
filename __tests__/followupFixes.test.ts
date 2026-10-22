import { beforeEach, describe, expect, it, vi } from 'vitest';

const rawReplyMock = vi.hoisted(() => vi.fn());
vi.mock('../services/ai/text', async () => {
    const actual = await vi.importActual<typeof import('../services/ai/text')>('../services/ai/text');
    return { ...actual, generateRoleChatRawReply: rawReplyMock };
});

import { 执行角色群聊, 纠偏下一位, 新建轮转统计, 记录一次发言 } from '../hooks/useGame/groupRoleChatWorkflow';
import {
    合并摘要事实,
    解析摘要输出,
    取补课听众键,
    写入群聊摘要,
    构建群聊记录视图
} from '../hooks/useGame/groupChatTranscriptBudget';
import type { 场外对话消息结构 } from '../types';

const 造消息 = (params: {
    内容: string;
    时间: number;
    发言人: string;
    role?: 'npc' | 'player';
    npcId?: string;
    听众?: string[];
}): 场外对话消息结构 => ({
    会话类型: 'group',
    群聊ID: 'g-1',
    role: params.role || 'npc',
    ...(params.npcId ? { npcId: params.npcId } : {}),
    发言人: params.发言人,
    内容: params.内容,
    时间: params.时间,
    听众NPCIds: params.听众 || ['npc-1', 'npc-2', 'npc-3'],
    听众: params.听众 || ['npc-1', 'npc-2', 'npc-3'],
    完成状态: 'complete'
});

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
    环境: { 大地点: '临安', 具体地点: '药房' },
    角色: { 姓名: '姜小星' },
    历史记录: [],
    prompts: []
});

beforeEach(() => rawReplyMock.mockReset());

describe('review 修复：事实合并不丢细节', () => {
    it('新事实更长且包含旧事实时，用新的替换旧的', () => {
        const 合并 = 合并摘要事实(['药材已分好'], ['药材已分好，先煎的摆在炉边']);
        expect(合并).toEqual(['药材已分好，先煎的摆在炉边']);
    });

    it('旧事实包含新事实时，保留旧的，不降级成更短的说法', () => {
        const 合并 = 合并摘要事实(['药材已分好，先煎的摆在炉边'], ['药材已分好']);
        expect(合并).toEqual(['药材已分好，先煎的摆在炉边']);
    });

    it('完全相同的只留一条', () => {
        expect(合并摘要事实(['薄荷另包'], ['薄荷另包'])).toHaveLength(1);
    });
});

describe('review 修复：摘要概述兜底只用干净文本', () => {
    it('模型按格式回了事实时，概述不会被原始输出污染', () => {
        const 结果 = 解析摘要输出('<事实>\n1. 药引是城南红糖\n</事实>\n<概述>在备药。</概述>');
        expect(结果.概述).toBe('在备药。');
        expect(结果.概述).not.toContain('<事实>');
    });

    it('模型没按格式回时，整段当概述，但不含标签', () => {
        const 结果 = 解析摘要输出('刚才在说分药材和火候。');
        expect(结果.事实).toEqual([]);
        expect(结果.概述).toBe('刚才在说分药材和火候。');
    });

    it('抽到事实但没有概述时，不拿整段原文当概述', () => {
        const 结果 = 解析摘要输出('<事实>\n1. 红糖在柜子最上层\n</事实>');
        expect(结果.事实).toEqual(['红糖在柜子最上层']);
        expect(结果.概述).toBe('');
    });

    it('整段兜底时会把标签剔掉，不会把 <事实> 写进摘要', () => {
        const 结果 = 解析摘要输出('<事实></事实>刚才在分药材。');
        expect(结果.事实).toEqual([]);
        expect(结果.概述).toBe('刚才在分药材。');
        expect(结果.概述).not.toContain('<');
    });
});

describe('review 修复：补课只取没听过的消息', () => {
    const 记录 = () => [
        造消息({ 内容: '药已经分好了。', 时间: 1000, 发言人: '沈听澜', npcId: 'npc-1', 听众: ['npc-1', 'npc-2'] }),
        造消息({ 内容: '红糖在柜子最上层。', 时间: 1500, 发言人: '老李', npcId: 'npc-2', 听众: ['npc-1', 'npc-2'] }),
        // 新人 npc-3 加入之后这一句他是听见的
        造消息({ 内容: '你来了，正好一起分药。', 时间: 2000, 发言人: '姜小星', role: 'player' })
    ];

    it('中途加入者拿到的补课里不含他已经听到的那句', () => {
        const 视图 = 构建群聊记录视图(记录(), { groupId: 'g-1', npcId: 'npc-3', audienceIds: ['npc-1', 'npc-2', 'npc-3'] });
        expect(视图.需要补课).toBe(true);
        const 补课内容 = 视图.待摘要消息.map(item => item.内容);
        expect(补课内容).toEqual(['药已经分好了。', '红糖在柜子最上层。']);
        expect(补课内容).not.toContain('你来了，正好一起分药。');
    });

    it('补课摘要按 npcId 独立键存，同听众的其他角色读不到', () => {
        const 写入后 = 写入群聊摘要(记录(), {
            群聊ID: 'g-1',
            听众键: 取补课听众键('npc-3'),
            覆盖到时间: 1500,
            内容: '【近况】\n刚才在分药材和红糖。',
            生成时间: 1,
            补充课: true
        });

        const 新人再看 = 构建群聊记录视图(写入后, { groupId: 'g-1', npcId: 'npc-3', audienceIds: ['npc-1', 'npc-2', 'npc-3'] });
        expect(新人再看.摘要?.听众键).toBe(取补课听众键('npc-3'));
        // 补过课之后不该再每轮重新补
        expect(新人再看.需要补课).toBe(false);
        expect(新人再看.渲染).toContain('你刚走近');

        const 老人看 = 构建群聊记录视图(写入后, { groupId: 'g-1', npcId: 'npc-1', audienceIds: ['npc-1', 'npc-2', 'npc-3'] });
        expect(老人看.摘要).toBeUndefined();
        expect(老人看.渲染).not.toContain('你刚走近');
    });
});

describe('review 修复：摘要失败不在本轮反复重试', () => {
    const 三十条历史 = () => Array.from({ length: 30 }, (_, index) => 造消息({
        内容: `第${index + 1}句闲聊。`,
        时间: 1000 + index,
        发言人: index % 2 === 0 ? '沈听澜' : '老李',
        role: index % 2 === 0 ? 'player' : 'npc',
        npcId: index % 2 === 0 ? undefined : 'npc-2'
    }));

    /** 摘要请求一律失败，正常发言照常返回；返回摘要请求被调用的次数。 */
    const 跑一场 = async (自动回复上限: number): Promise<{ 摘要调用: number; 发言次数: number }> => {
        let 摘要调用 = 0;
        rawReplyMock.mockImplementation(async (...args: any[]) => {
            const 全文 = JSON.stringify(args);
            if (全文.includes('整理成摘要') || 全文.includes('补一句课')) {
                摘要调用 += 1;
                throw new Error('摘要接口挂了');
            }
            return '<正文>嗯，我听着。</正文><调度>{"action":"continue","nextNpcId":"npc-2"}</调度>';
        });
        const result = await 执行角色群聊(deps() as any, {
            参与者NPCIds: ['npc-1', 'npc-2', 'npc-3'],
            玩家输入: '',
            继续群聊: true,
            群聊ID: 'g-1',
            暂存对话: 三十条历史(),
            首位NPCId: 'npc-1',
            自动回复上限,
            已确认全部位置: true
        } as any);
        return { 摘要调用, 发言次数: result.发言次数 };
    };

    it('摘要第一次失败后本轮不再重试，聊天照常继续', async () => {
        const 三轮 = await 跑一场(3);
        expect(三轮.发言次数).toBe(3);
        expect(三轮.摘要调用).toBeGreaterThan(0);
        // 一轮失败最多是「流式 + 非流式重试」两次；若每轮都重试，三轮至少 3 次以上
        expect(三轮.摘要调用).toBeLessThanOrEqual(2);

        const 一轮 = await 跑一场(1);
        expect(一轮.摘要调用).toBe(三轮.摘要调用);
    });
});

describe('review 确认：点名优先确实会越过连说上限（有意设计）', () => {
    it('连说已达上限、模型还想让同一人继续说时，玩家点名的第三个人照样接话', () => {
        const 统计 = 新建轮转统计();
        记录一次发言(统计, 'npc-1');
        记录一次发言(统计, 'npc-1');

        const 结果 = 纠偏下一位({
            participants: 参与者,
            当前NpcId: 'npc-1',
            模型建议: 参与者[0], // 模型仍建议沈听澜（npc-1）继续说
            最近发言: '我再补一句。',
            玩家输入: '苏晚你来说说药材的事。',
            统计,
            历史: []
        });

        // 如果连说上限优先，这里会按名单顺序换给老李（npc-2）；点名优先则必须是苏晚
        expect(结果.纠偏).toBe(true);
        expect(结果.原因).toBe('点名优先');
        expect(结果.next?.id).toBe('npc-3');
    });
});
