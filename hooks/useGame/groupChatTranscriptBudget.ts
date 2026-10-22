import type { 场外对话消息结构, 群聊摘要条目 } from '../../types';

/**
 * 群聊记录预算：把「你实际听到的本次群聊」从整段原文改成「最近 N 条原文 + 更早的摘要」。
 *
 * 三条硬规矩：
 * 1. 只在记录变长时生成一次摘要，结果挂在被摘要的最后一条消息上（`群聊摘要` 字段），随存档复用；
 *    每轮重新概括等于把省下的 token 又花回去。
 * 2. 知情边界先过滤再摘要：先按 `听众NPCIds` 取出这名角色真能听到的消息，再对这批消息做摘要；
 *    摘要按听众集合（听众键）分开存，不同听众集合不共用同一份。
 * 3. 中途加入者的「你刚走近，之前大概在聊……」也走同一套摘要机制，只是标记成补课摘要。
 */

export const 保留原文条数 = 8;
/**
 * 比摘要覆盖更早的可见消息达到这个条数才值得再压一次。
 * 真模型实测：摘要一次约 0.18 credit（思考型模型，输出侧才是大头），
 * 阈值定成 4 会每 1~2 轮就摘一次，摊销下来比省掉的还贵；16 条约等于 5 轮群聊摘一次，才划得来。
 */
export const 触发摘要条数 = 16;

export type 群聊记录视图 = {
    听众键: string;
    摘要?: 群聊摘要条目;
    最近原文: 场外对话消息结构[];
    待摘要消息: 场外对话消息结构[];
    可见条数: number;
    需要补课: boolean;
    渲染: string;
};

export const 取群聊听众键 = (ids: string[]): string =>
    Array.from(new Set(ids.map(id => String(id || '').trim()).filter(Boolean))).sort().join('|');

const 取文本 = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

const 取本群消息 = (transcript: 场外对话消息结构[], groupId: string): 场外对话消息结构[] =>
    transcript.filter(item => item.会话类型 === 'group' && item.群聊ID === groupId);

/** 这名角色真正听得见的消息（知情边界）。 */
export const 取可听消息 = (messages: 场外对话消息结构[], npcId: string): 场外对话消息结构[] =>
    messages.filter(item => Array.isArray(item.听众NPCIds) && item.听众NPCIds.includes(npcId));

const 收集摘要 = (messages: 场外对话消息结构[], 听众键: string): 群聊摘要条目[] =>
    messages
        .flatMap(item => Array.isArray(item.群聊摘要) ? item.群聊摘要 : [])
        .filter(entry => entry.听众键 === 听众键)
        .sort((a, b) => a.覆盖到时间 - b.覆盖到时间);

const 渲染消息 = (messages: 场外对话消息结构[]): string =>
    messages.map(item => `【${item.发言人}】${item.内容}`).join('\n');

/**
 * 构建某名角色这一轮实际拿到的群聊记录。
 * @param extraSummaries 本轮刚生成、还没写回记录的摘要（同轮其他角色可以直接复用）
 */
export const 构建群聊记录视图 = (
    transcript: 场外对话消息结构[],
    params: {
        groupId: string;
        npcId: string;
        audienceIds: string[];
        保留条数?: number;
        extraSummaries?: 群聊摘要条目[];
    }
): 群聊记录视图 => {
    const 听众键 = 取群聊听众键(params.audienceIds);
    const 本群消息 = 取本群消息(transcript, params.groupId);
    const 可听 = 取可听消息(本群消息, params.npcId);
    const 保留条数 = Math.max(0, params.保留条数 ?? 保留原文条数);
    const 全部摘要 = [...收集摘要(本群消息, 听众键), ...(params.extraSummaries || []).filter(entry => entry.听众键 === 听众键)]
        .sort((a, b) => a.覆盖到时间 - b.覆盖到时间);
    const 摘要 = 全部摘要.at(-1);
    const 未被覆盖 = 摘要 ? 可听.filter(item => item.时间 > 摘要.覆盖到时间) : 可听;
    const 最近原文 = 保留条数 > 0 ? 未被覆盖.slice(-保留条数) : [];
    const 待摘要消息 = 未被覆盖.slice(0, Math.max(0, 未被覆盖.length - 最近原文.length));

    // 中途加入：这个人一条 NPC 发言都没听到过，但群里已经有人说过话 → 用全场公开记录补课。
    // 只听到玩家刚说的那句不算“听过课”，否则新加入者永远拿不到补课。
    const 可听NPC发言数 = 可听.filter(item => item.role === 'npc').length;
    const 需要补课 = 可听NPC发言数 === 0
        && 本群消息.some(item => item.role === 'npc')
        && !全部摘要.some(entry => entry.补充课);
    const 补课来源 = 需要补课 ? 本群消息.slice(-Math.max(保留条数, 保留原文条数)) : [];

    const 摘要块 = 摘要
        ? `${摘要.补充课 ? '（你刚走近，之前的大致经过）' : '（更早的对话已摘要）'}\n${摘要.内容}`
        : '';
    const 原文块 = 渲染消息(最近原文);
    const 渲染 = [摘要块, 原文块].filter(Boolean).join('\n');

    return {
        听众键,
        摘要,
        最近原文,
        待摘要消息: 需要补课 ? 补课来源 : 待摘要消息,
        可见条数: 可听.length,
        需要补课,
        渲染
    };
};

/** 判断这份视图要不要再压一次摘要（不含补课，补课单独触发）。 */
export const 需要生成摘要 = (view: 群聊记录视图): boolean =>
    !view.需要补课 && view.待摘要消息.length >= 触发摘要条数;

export const 构建摘要请求 = (
    view: 群聊记录视图,
    options?: { 角色名?: string }
): Array<{ role: 'system' | 'user'; content: string }> => {
    const 对话 = 渲染消息(view.待摘要消息);
    const 旧事实 = [...(view.摘要?.早期事实 || []), ...(view.摘要?.事实 || [])].map(item => `· ${item}`).join('\n');
    const 旧概述 = 取文本(view.摘要?.概述) || 取文本(view.摘要?.内容);
    const 补课 = view.需要补课;
    const 事实要求 = '具体事实指：人名、物品名、地名、数量、约定和承诺。事实条目要短（一句一条），不要写成概述。';
    const 指令 = 补课
        ? `你要给一个刚走近的人补一句课。<事实> 里逐条列出这段群聊里说定的具体事实（人、物、地点、数量、承诺），<概述> 里用 2~3 句说清刚才在聊什么。不要编造对话里没有的内容。${事实要求}`
        : `把下面这段群聊整理成摘要。<事实> 里逐条列出具体事实，<概述> 里用 2~3 句说明进展和还没定的事。不要编造。${事实要求}`;
    const 对话块 = [
        旧事实 || 旧概述 ? `<旧摘要>\n${旧事实}${旧概述 ? `\n${旧概述}` : ''}\n</旧摘要>` : '',
        `<新对话>\n${对话}\n</新对话>`
    ].filter(Boolean).join('\n');
    return [
        {
            role: 'system',
            content: `${指令}\n输出格式严格如下，不要输出别的文字：\n<事实>\n1. ……\n2. ……\n</事实>\n<概述>……</概述>`
        },
        { role: 'user', content: 对话块 }
    ];
};

/** 「最近事实」清单上限：渲染时放在【要点】里，优先保证模型看见。 */
export const 摘要事实上限 = 20;
/** 「早期事实」上限：超过最近清单的事实降级放这里，**不丢弃**，渲染时仍进 prompt。 */
export const 早期事实上限 = 40;

/** 按新旧把事实分成「最近要点」和「早期约定」两档：超出最近清单的降级，而不是丢掉。 */
export const 拆分摘要事实 = (全部: string[]): { 最近: string[]; 早期: string[] } => {
    const list = Array.isArray(全部) ? 全部.filter(Boolean) : [];
    if (list.length <= 摘要事实上限) return { 最近: list, 早期: [] };
    const 最近 = list.slice(-摘要事实上限);
    const 早期 = list.slice(0, list.length - 摘要事实上限).slice(-早期事实上限);
    return { 最近, 早期 };
};

/** 解析模型输出的结构化摘要：事实清单 + 概述。 */
export const 解析摘要输出 = (raw: string): { 事实: string[]; 概述: string } => {
    const text = String(raw || '').trim();
    const 事实块 = text.match(/<事实>([\s\S]*?)<\/事实>/i)?.[1] || '';
    const 概述块 = text.match(/<概述>([\s\S]*?)<\/概述>/i)?.[1] || '';
    const 事实 = 事实块
        .split('\n')
        .map(line => line.replace(/^[\s\-*·•]*(?:\d+[.、)）])?\s*/u, '').trim())
        .filter(Boolean);
    const 概述 = 概述块.trim();
    // 模型没按格式回时，退化成“整段当概述”，至少不丢内容
    return { 事实, 概述: 概述 || (事实.length ? '' : text) };
};

/**
 * 事实清单只增不减：反复重写摘要最容易丢早期细节，靠程序做并集兜住。
 * 去重后总上限是「最近 20 + 早期 40」，超出的最老条目才会被并进概述（见 渲染摘要条目）。
 */
export const 合并摘要事实 = (旧事实: string[] = [], 新事实: string[] = []): string[] => {
    const 结果: string[] = [];
    for (const raw of [...旧事实, ...新事实]) {
        const text = String(raw || '').trim();
        if (!text) continue;
        if (结果.some(existed => existed === text || existed.includes(text) || text.includes(existed))) continue;
        结果.push(text);
    }
    return 结果.slice(-(摘要事实上限 + 早期事实上限));
};

export const 渲染摘要条目 = (事实: string[], 概述: string, 早期事实: string[] = []): string => {
    const 最近 = 拆分摘要事实(事实).最近;
    const 早期 = 早期事实.length > 0 ? 早期事实 : 拆分摘要事实(事实).早期;
    const 早期块 = 早期.length > 0 ? `【早期约定】\n${早期.map(item => `· ${item}`).join('\n')}` : '';
    const 最近块 = 最近.length > 0 ? `【要点】\n${最近.map(item => `· ${item}`).join('\n')}` : '';
    return [早期块, 最近块, 概述 ? `【近况】\n${概述}` : ''].filter(Boolean).join('\n');
};
export const 写入群聊摘要 = (
    transcript: 场外对话消息结构[],
    条目: 群聊摘要条目
): 场外对话消息结构[] => {
    let 目标索引 = -1;
    transcript.forEach((item, index) => {
        if (item.会话类型 === 'group' && item.时间 <= 条目.覆盖到时间) 目标索引 = index;
    });
    if (目标索引 < 0) return transcript;
    return transcript.map((item, index) => {
        if (index !== 目标索引) return item;
        const 旧 = Array.isArray(item.群聊摘要) ? item.群聊摘要 : [];
        const 保留 = 旧.filter(entry => entry.听众键 !== 条目.听众键);
        return { ...item, 群聊摘要: [...保留, 条目] };
    });
};
