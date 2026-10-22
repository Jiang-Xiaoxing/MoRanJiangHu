import { describe, expect, it } from 'vitest';
import {
    构建群聊记录视图,
    构建摘要请求,
    写入群聊摘要,
    取可听消息,
    取群聊听众键,
    合并摘要事实,
    渲染摘要条目,
    摘要事实上限,
    早期事实上限,
    拆分摘要事实,
    需要生成摘要,
    解析摘要输出,
    保留原文条数,
    触发摘要条数
} from '../hooks/useGame/groupChatTranscriptBudget';
import { 规范化场外对话列表 } from '../hooks/useGame/roleChatWorkflow';

const 造消息 = (count: number, 听众: string[] = ['npc-1', 'npc-2'], 前缀 = '第') => Array.from({ length: count }).map((_, index) => ({
    会话类型: 'group' as const,
    群聊ID: 'g1',
    role: (index % 3 === 0 ? 'player' : 'npc') as 'player' | 'npc',
    npcId: index % 3 === 0 ? undefined : 'npc-2',
    发言人: index % 3 === 0 ? '姜小星' : '老李',
    内容: `${前缀}${index + 1}条：药材已分好，先煎的那几味摆在炉边。`,
    时间: 1000 + index,
    听众NPCIds: 听众,
    听众,
    完成状态: 'complete' as const
}));

describe('摘要事实清单（防止越摘越丢）', () => {
    it('解析结构化输出：事实逐条，概述单独', () => {
        const r = 解析摘要输出('<事实>\n1. 药引是城南捎来的红糖\n2. 薄荷另包\n</事实>\n<概述>还在商量谁备药。</概述>');
        expect(r.事实).toEqual(['药引是城南捎来的红糖', '薄荷另包']);
        expect(r.概述).toBe('还在商量谁备药。');
    });

    it('模型不按格式回时，整段当概述，至少不丢内容', () => {
        const r = 解析摘要输出('刚才在说分药材和火候。');
        expect(r.事实).toEqual([]);
        expect(r.概述).toBe('刚才在说分药材和火候。');
    });

    it('旧事实只增不减：模型这轮漏了早期细节也补得回来', () => {
        const 旧 = ['药引是城南捎来的红糖'];
        const 新 = ['薄荷另包', '头煎先武后文'];
        const 合并 = 合并摘要事实(旧, 新);
        expect(合并).toContain('药引是城南捎来的红糖');
        expect(合并).toHaveLength(3);
    });

    it('重复或包含关系的事实不会越堆越多', () => {
        const 合并 = 合并摘要事实(['薄荷另包，快好时下'], ['薄荷另包，快好时下', '薄荷另包']);
        expect(合并).toHaveLength(1);
    });

    it('事实清单有上限，不会无限膨胀', () => {
        const 旧 = Array.from({ length: 摘要事实上限 + 5 }).map((_, i) => `第${i + 1}条事实`);
        expect(合并摘要事实(旧, ['新事实']).length).toBeLessThanOrEqual(摘要事实上限 + 早期事实上限);
    });

    it('超限后早期事实不丢：降级进【早期约定】，仍然出现在 prompt 里', () => {
        const 事实 = ['药引是城南捎来的红糖'];
        事实.push(...Array.from({ length: 摘要事实上限 + 5 }).map((_, i) => `第${i + 1}条细节`));
        const { 最近, 早期 } = 拆分摘要事实(事实);
        expect(最近).toHaveLength(摘要事实上限);
        expect(早期.length).toBeGreaterThan(0);
        const 内容 = 渲染摘要条目(最近, '在备药。', 早期);
        expect(内容).toContain('【早期约定】');
        expect(内容).toContain('城南捎来的红糖');
        const 记录 = 造消息(40);
        const view = 构建群聊记录视图(记录, { groupId: 'g1', npcId: 'npc-1', audienceIds: ['npc-1', 'npc-2'] });
        const 条目 = { 听众键: view.听众键, 覆盖到时间: view.待摘要消息.at(-1)!.时间, 内容, 生成时间: 1, 事实: 最近, 早期事实: 早期, 概述: '在备药。' };
        const 新视图 = 构建群聊记录视图(写入群聊摘要(记录, 条目), { groupId: 'g1', npcId: 'npc-1', audienceIds: ['npc-1', 'npc-2'] });
        expect(新视图.渲染).toContain('城南捎来的红糖');
    });

    it('超出两档总上限时只淘汰最老的，不会越堆越多', () => {
        const 旧 = Array.from({ length: 摘要事实上限 + 早期事实上限 + 10 }).map((_, i) => `第${i + 1}条事实`);
        const 合并 = 合并摘要事实(旧, ['新来的事实']);
        expect(合并.length).toBeLessThanOrEqual(摘要事实上限 + 早期事实上限);
        expect(合并.at(-1)).toBe('新来的事实');
    });

    it('渲染出来的摘要带要点与近况，旧摘要会被一起喂回模型', () => {
        const 内容 = 渲染摘要条目(['药引是城南红糖'], '还在商量谁备药。');
        expect(内容).toContain('【要点】');
        expect(内容).toContain('城南红糖');
        expect(内容).toContain('【近况】');
        const 记录 = 造消息(40);
        const view = 构建群聊记录视图(记录, { groupId: 'g1', npcId: 'npc-1', audienceIds: ['npc-1', 'npc-2'] });
        const 条目 = { 听众键: view.听众键, 覆盖到时间: view.待摘要消息.at(-1)!.时间, 内容, 生成时间: 1, 事实: ['药引是城南红糖'], 概述: '还在商量谁备药。' };
        const 新记录 = 写入群聊摘要(记录, 条目);
        const 新视图 = 构建群聊记录视图(新记录, { groupId: 'g1', npcId: 'npc-1', audienceIds: ['npc-1', 'npc-2'] });
        const 请求 = 构建摘要请求(新视图);
        expect(请求[1].content).toContain('药引是城南红糖');
    });
});

describe('群聊记录预算', () => {
    it('记录不长时全部给原文，不触发摘要', () => {
        const view = 构建群聊记录视图(造消息(5), { groupId: 'g1', npcId: 'npc-1', audienceIds: ['npc-1', 'npc-2'] });
        expect(view.待摘要消息).toHaveLength(0);
        expect(view.最近原文).toHaveLength(5);
        expect(需要生成摘要(view)).toBe(false);
        expect(view.渲染).toContain('第5条');
        expect(view.渲染).not.toContain('已摘要');
    });

    it('记录变长后只保留最近 N 条原文，更早的进入待摘要', () => {
        const view = 构建群聊记录视图(造消息(40), { groupId: 'g1', npcId: 'npc-1', audienceIds: ['npc-1', 'npc-2'] });
        expect(view.最近原文).toHaveLength(保留原文条数);
        expect(view.待摘要消息).toHaveLength(40 - 保留原文条数);
        expect(需要生成摘要(view)).toBe(true);
    });

    it('有了摘要就复用，不再重复进待摘要队列', () => {
        const 记录 = 造消息(40);
        const 旧 = 构建群聊记录视图(记录, { groupId: 'g1', npcId: 'npc-1', audienceIds: ['npc-1', 'npc-2'] });
        const 条目 = {
            听众键: 旧.听众键,
            覆盖到时间: 旧.待摘要消息.at(-1)!.时间,
            内容: '刚才在说分药材和火候。',
            生成时间: 2000
        };
        const 写入后 = 写入群聊摘要(记录, 条目);
        const 新 = 构建群聊记录视图(写入后, { groupId: 'g1', npcId: 'npc-1', audienceIds: ['npc-1', 'npc-2'] });
        expect(新.摘要?.内容).toBe('刚才在说分药材和火候。');
        expect(新.待摘要消息).toHaveLength(0);
        expect(需要生成摘要(新)).toBe(false);
        expect(新.渲染).toContain('更早的对话已摘要');
        expect(新.渲染).toContain('刚才在说分药材和火候。');
    });

    it('知情边界：听不到的消息既不进原文也不进摘要来源', () => {
        const 有私密 = [...造消息(10), {
            会话类型: 'group' as const, 群聊ID: 'g1', role: 'npc' as const, npcId: 'npc-3', 发言人: '苏晚',
            内容: '只对在场三人说的话。', 时间: 9999, 听众NPCIds: ['npc-2', 'npc-3'], 听众: ['老李', '苏晚'], 完成状态: 'complete' as const
        }];
        const view = 构建群聊记录视图(有私密, { groupId: 'g1', npcId: 'npc-1', audienceIds: ['npc-1', 'npc-2'] });
        expect(view.待摘要消息.concat(view.最近原文).some(item => item.内容.includes('只对在场三人说的话'))).toBe(false);
    });

    it('不同听众集合不共用同一份摘要', () => {
        const 记录 = 造消息(40);
        const 甲 = 构建群聊记录视图(记录, { groupId: 'g1', npcId: 'npc-1', audienceIds: ['npc-1', 'npc-2'] });
        const 条目 = { 听众键: 甲.听众键, 覆盖到时间: 甲.待摘要消息.at(-1)!.时间, 内容: '甲乙的摘要', 生成时间: 1 };
        const 写入后 = 写入群聊摘要(记录, 条目);
        // 听众集合变了（比如苏晚加入），不能拿甲乙那份摘要顶
        const 乙 = 构建群聊记录视图(写入后, { groupId: 'g1', npcId: 'npc-1', audienceIds: ['npc-1', 'npc-2', 'npc-3'] });
        expect(乙.摘要).toBeUndefined();
        expect(乙.待摘要消息.length).toBeGreaterThan(0);
        expect(乙.渲染).not.toContain('甲乙的摘要');
    });

    it('中途加入者拿补课摘要，并标明是补课', () => {
        const view = 构建群聊记录视图(造消息(12), { groupId: 'g1', npcId: 'npc-new', audienceIds: ['npc-1', 'npc-2', 'npc-new'] });
        expect(view.可见条数).toBe(0);
        expect(view.需要补课).toBe(true);
        expect(view.待摘要消息.length).toBeGreaterThan(0);
        const 请求 = 构建摘要请求(view);
        expect(请求[0].content).toContain('刚走近');
        expect(请求[1].content).toContain('第12条');
    });

    it('摘要写回后能被规范化保住，不会随加载丢掉', () => {
        const 记录 = 造消息(3);
        const 条目 = { 听众键: 取群聊听众键(['npc-1', 'npc-2']), 覆盖到时间: 1002, 内容: '摘要正文', 生成时间: 5 };
        const 写入后 = 规范化场外对话列表(写入群聊摘要(记录, 条目));
        expect(写入后.at(-1)?.群聊摘要?.[0]?.内容).toBe('摘要正文');
    });

    it('取可听消息只看听众集合', () => {
        const 记录 = 造消息(4);
        expect(取可听消息(记录, 'npc-1')).toHaveLength(4);
        expect(取可听消息(记录, 'npc-9')).toHaveLength(0);
    });

    it('待摘要条数不到阈值就不花那次调用', () => {
        const view = 构建群聊记录视图(造消息(保留原文条数 + 触发摘要条数 - 1), { groupId: 'g1', npcId: 'npc-1', audienceIds: ['npc-1', 'npc-2'] });
        expect(需要生成摘要(view)).toBe(false);
    });
});
