import { collectBlockedNpcTemplateNames, type NpcTemplateNameCheck } from './npcTemplateNamePolicy';
// 通用模板化姓名黑名单（男性 / 中性）。
// 女性模板名仍由 femaleNameSelector.ts 的「常见女性姓名黑名单」单独维护，
// 这里只覆盖男性/中性 NPC 反复出现的模板名（如"林砚舟/许明澈/苏清寒"）。
// 这些名字来源：stateTransforms.ts 历史姓名池 + 多次开局被 AI 反复生成的高频名。

const 规范化姓名键 = (value: unknown): string => (
    typeof value === 'string'
        ? value.trim().replace(/[\s\u3000]+/g, '')
        : ''
);

export const 男性模板姓名黑名单 = [
    '顾长风', '沈砚', '陆怀安', '谢行舟', '裴景明', '温玄', '晏清河', '秦照夜',
    '傅云峥', '宁远山', '赵平安', '林砚舟', '许明澈', '周临渊', '韩不疑', '唐问川',
    '宋青崖', '叶归尘', '江听澜', '方知白', '洛怀瑾', '萧承影', '陈照微', '岑越',
    // 高频复用的女主/男主模板名
    '苏清寒', '沈逸尘', '顾长青'
];

export const 中性模板姓名黑名单 = [
    '云照', '青棠', '闻溪', '桑宁', '辛夷', '乔霜', '尹舟', '郁离',
    '楚衡', '姜行', '阮清', '奚白', '叶澄', '洛微', '祝宁', '温竹'
];

const 男性模板姓名黑名单集合 = new Set(男性模板姓名黑名单);
const 中性模板姓名黑名单集合 = new Set(中性模板姓名黑名单);
const 全部模板姓名黑名单集合 = new Set<string>([
    ...男性模板姓名黑名单,
    ...中性模板姓名黑名单
]);

export const 全部模板姓名黑名单 = Array.from(全部模板姓名黑名单集合);

// 判断某个候选名是否"包含"黑名单中的某个完整姓名，或反过来被包含。
// 用于过滤开局默认同门库等"名片段"池（如"砚舟"落在黑名单"林砚舟"中）。
export const 候选名命中模板黑名单 = (candidate: unknown): boolean => {
    const name = 规范化姓名键(candidate);
    if (!name) return false;
    for (const blocked of 全部模板姓名黑名单集合) {
        if (blocked.includes(name) || name.includes(blocked)) return true;
    }
    return false;
};

export const 提取命中模板姓名黑名单 = (params: NpcTemplateNameCheck): string[] => (
    collectBlockedNpcTemplateNames(params, 全部模板姓名黑名单集合)
);

export const 构建模板姓名黑名单提示词 = (): string => [
    '【男性/中性新角色姓名黑名单】',
    `- AI 自由创造新 NPC、队友、伙伴、同门、师兄弟、护卫、管事时，应避开这些被反复使用过的模板姓名：${全部模板姓名黑名单.join('、')}。`,
    '- 每次开局的队友、伙伴、关键 NPC 必须由题材模式、出身背景和随机性共同决定，使用不同的原创姓名。',
    '- 玩家本轮明确命名或要求引入的角色、可信原著/预设角色不受模板姓名限制；这些姓名并非非法姓名。',
    '- 已经存在于社交档案、玩家手动修改、本局开局配置/开局伙伴设定的人物姓名必须原样保留；不要为了避开黑名单而改旧角色。'
].join('\n');
