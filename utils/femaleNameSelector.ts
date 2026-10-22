import { collectBlockedNpcTemplateNames, type NpcTemplateNameCheck } from './npcTemplateNamePolicy';
import 女性人名选择器原始文本 from '../女性人名选择器?raw';

const 规范化姓名键 = (value: unknown): string => (
    typeof value === 'string'
        ? value.trim().replace(/[\s\u3000]+/g, '')
        : ''
);

const 稳定哈希 = (text: string): number => {
    let hash = 2166136261;
    for (let i = 0; i < text.length; i += 1) {
        hash ^= text.charCodeAt(i);
        hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
};

export const 女性人名选择器列表 = Array.from(new Set(
    女性人名选择器原始文本
        .split(/\r?\n/)
        .map(规范化姓名键)
        .filter((name) => name.length > 0)
));

const 女性人名选择器集合 = new Set(女性人名选择器列表);

const 女性性别正则 = /女|女性|女子|少女|女修|姑娘|妇人|夫人|娘子|侍女|丫鬟/;
const 非女性性别正则 = /男娘|男性|男子|少年|男修|公子|汉子|男/;
const 占位女性姓名正则 = /^(?:角色|同门|随行者|新NPC|未命名NPC|未命名|未知|无名|女子|少女|女修|姑娘|侍女|丫鬟)\d*$/;
const 模板化女性姓名正则 = /^(?:苏婉儿|苏婉清|苏清婉|沈清婉|林婉儿|林清雪|柳若嫣|叶灵儿|赵灵儿|萧薰儿|云韵|婉儿|清雪|若嫣|灵儿|月儿|芷若|小雅|小柔|小蝶|小环|小翠)$/;
const 同人姓名保护线索正则 = /同人|原著|小说|动漫|游戏|影视|正传|剧情线|章节|分解组|关联原著|替换规则|canon|fandom/i;

export const 判断女性名称目标 = (npc: any): boolean => {
    const sex = 规范化姓名键(npc?.性别 ?? npc?.gender);
    if (!sex) return false;
    if (非女性性别正则.test(sex) && !女性性别正则.test(sex)) return false;
    return 女性性别正则.test(sex);
};

export const 判断女性姓名来自姓名库 = (value: unknown): boolean => {
    const name = 规范化姓名键(value);
    return Boolean(name && 女性人名选择器集合.has(name));
};

export const 判断女性姓名需要兜底重命名 = (value: unknown): boolean => {
    const name = 规范化姓名键(value);
    return !name || 占位女性姓名正则.test(name);
};

export const 判断模板化女性姓名 = (value: unknown): boolean => {
    const name = 规范化姓名键(value);
    return Boolean(name && 模板化女性姓名正则.test(name));
};

export const 常见女性姓名黑名单 = [
    '苏婉儿',
    '苏婉清',
    '苏清婉',
    '沈清婉',
    '林婉儿',
    '林清雪',
    '柳若嫣',
    '叶灵儿',
    '赵灵儿',
    '萧薰儿',
    '云韵',
    '婉儿',
    '清雪',
    '若嫣',
    '灵儿',
    '月儿',
    '芷若',
    '小雅',
    '小柔',
    '小蝶',
    '小环',
    '小翠'
];

const 常见女性姓名黑名单集合 = new Set(常见女性姓名黑名单);
const 短昵称黑名单集合 = new Set(常见女性姓名黑名单.filter((name) => name.length <= 2));

const 排序姓名黑名单命中 = (hits: Iterable<string>): string[] => (
    Array.from(new Set(Array.from(hits).filter(Boolean)))
        .sort((a, b) => 常见女性姓名黑名单.indexOf(a) - 常见女性姓名黑名单.indexOf(b))
);

export const 提取命中女性姓名黑名单 = (value: unknown): string[] => {
    const text = typeof value === 'string'
        ? value
        : (value == null ? '' : JSON.stringify(value));
    if (!text) return [];
    const hits: string[] = [];
    [...常见女性姓名黑名单]
        .sort((a, b) => b.length - a.length)
        .forEach((name) => {
            if (!text.includes(name)) return;
            if (hits.some((hit) => hit.includes(name))) return;
            hits.push(name);
        });
    return 排序姓名黑名单命中(hits);
};

export const 提取命中新女性角色姓名黑名单 = (params: NpcTemplateNameCheck): string[] => (
    排序姓名黑名单命中(collectBlockedNpcTemplateNames(params, 常见女性姓名黑名单集合, 短昵称黑名单集合))
);

export const 构建女性姓名黑名单提示词 = (): string => [
    '【女性新角色姓名黑名单】',
    `- AI 自由创造新女性 NPC、女主、侍女、师姐、女修、姑娘、夫人时，应避开这些过度常见/模板化姓名：${常见女性姓名黑名单.join('、')}。`,
    '- 不再提供姓名候选池；请结合世界观、地域、门派、家族、身份、时代语感在中文语境下自行创造 2-4 字中文真实姓名；角色设定、世界观、玩家指令或原著使用外文姓名时，保留原语言姓名格式，不强行改为中文。',
    '- 正文对白框 sender、`<变量规划>` 中的人物称呼、变量命令里的 `社交[i].姓名` 必须完全一致。',
    '- 已存在于社交档案、玩家手动修改、原著/同人已有角色、小说拆分正文已点名或替换规则指定的人物姓名必须原样保留；不要为了避开黑名单而改旧角色。',
    '- 玩家本轮明确命名或要求引入的角色、已有档案、可信开局伙伴及原著预设不受模板姓名限制；这些姓名并非非法姓名，必须尊重明确来源，不得强制改名。',
    '- 临时代称、身份称呼或外貌描述不得写进姓名，可写入身份、简介或记忆；只有确有旧称、化名、曾用称呼时才写 `曾用名`，不要给每个 NPC 强行生成曾用名。'
].join('\n');

export const 选择唯一女性姓名 = (params?: {
    usedNames?: Iterable<string>;
    seed?: string;
}): string => {
    const used = new Set(Array.from(params?.usedNames || []).map(规范化姓名键).filter(Boolean));
    if (女性人名选择器列表.length === 0) return `女性${used.size + 1}`;
    const start = 稳定哈希(params?.seed || `female-${used.size}`) % 女性人名选择器列表.length;
    for (let offset = 0; offset < 女性人名选择器列表.length; offset += 1) {
        const candidate = 女性人名选择器列表[(start + offset) % 女性人名选择器列表.length];
        if (candidate && !used.has(candidate)) return candidate;
    }
    const base = 女性人名选择器列表[start] || '女性';
    let suffix = used.size + 1;
    while (used.has(`${base}${suffix}`)) suffix += 1;
    return `${base}${suffix}`;
};

export const 选择女性姓名候选列表 = (params?: {
    usedNames?: Iterable<string>;
    seed?: string;
    count?: number;
}): string[] => {
    const used = new Set(Array.from(params?.usedNames || []).map(规范化姓名键).filter(Boolean));
    const count = Math.max(1, Math.min(
        Number.isFinite(Number(params?.count)) ? Math.floor(Number(params?.count)) : 100,
        女性人名选择器列表.length || 1
    ));
    if (女性人名选择器列表.length === 0) return [];
    const start = 稳定哈希(params?.seed || `female-candidates-${used.size}`) % 女性人名选择器列表.length;
    const candidates: string[] = [];
    for (let offset = 0; offset < 女性人名选择器列表.length && candidates.length < count; offset += 1) {
        const candidate = 女性人名选择器列表[(start + offset) % 女性人名选择器列表.length];
        if (!candidate || used.has(candidate) || candidates.includes(candidate)) continue;
        candidates.push(candidate);
    }
    if (candidates.length >= count) return candidates;
    for (const candidate of 女性人名选择器列表) {
        if (candidates.length >= count) break;
        if (!candidate || used.has(candidate) || candidates.includes(candidate)) continue;
        candidates.push(candidate);
    }
    return candidates;
};

const 判断同人姓名保护目标 = (npc: any, name: string, options?: { 保留非姓名库主要女性名?: boolean }): boolean => {
    if (options?.保留非姓名库主要女性名 !== true) return false;
    if (!name || 判断女性姓名来自姓名库(name)) return false;
    if (占位女性姓名正则.test(name) || 模板化女性姓名正则.test(name)) return false;
    if (npc?.是否主要角色 === true) return true;
    if (npc?.是否主要角色 !== true && npc?.同人角色 !== true && npc?.原著角色 !== true) return false;
    const text = [
        npc?.来源,
        npc?.身份,
        npc?.简介,
        npc?.所属势力,
        npc?.关系状态,
        npc?.关联原著角色,
        npc?.原著姓名,
        npc?.同人作品,
        npc?.作品名,
        ...(Array.isArray(npc?.关联原著事件) ? npc.关联原著事件 : []),
        ...(Array.isArray(npc?.关联分解组) ? npc.关联分解组 : [])
    ].map((item) => 规范化姓名键(item)).join('|');
    return npc?.同人角色 === true || npc?.原著角色 === true || 同人姓名保护线索正则.test(text);
};

export const 重命名重复女性NPC列表 = (list: any[], options?: { 保留非姓名库主要女性名?: boolean }): any[] => {
    void options;
    return Array.isArray(list) ? list : [];
};
