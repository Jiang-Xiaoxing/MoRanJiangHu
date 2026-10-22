import { normalizeNpcNameKey } from './npcName';
import { normalizeStateCommandKey } from './stateHelpers';
import type { OpeningConfig } from '../types';

export type NpcTemplateNameContext = {
    currentSocial?: any[];
    playerInput?: string;
    // 只能传入检查前的角色档案/配置，不能信任本次 AI 返回的来源标记。
    trustedCharacters?: any[];
    trustedNames?: Iterable<string>;
};

export type NpcTemplateNameCheck = NpcTemplateNameContext & {
    response?: any;
    commands?: any[];
    includeLogSenders?: boolean;
};

const characterNames = (character: any): string[] => [
    character?.姓名, character?.名称, character?.name,
    ...(Array.isArray(character?.曾用名) ? character.曾用名 : [])
].map(normalizeNpcNameKey).filter(Boolean);

// 不以“输入中出现过姓名”作为许可；只接受明确命名、引入或保留姓名的指令。
export const playerExplicitlySpecifiesNpcName = (input: string, name: string): boolean => {
    const key = normalizeNpcNameKey(name);
    if (!key) return false;
    const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const quotedName = `[“"'‘「『]?${escaped}`;
    const end = `(?=$|[\\s，,。！？!?；;：:“”"'‘’「」『』]|(?:的)?(?:人物|角色|人|npc))`;
    return normalizeNpcNameKey(input).split(/[。！？!?；;\n\r]/u).some(clause => {
        if (new RegExp(`(?:不要|别|不得|禁止)(?:修改|改写|更改|改|改变)${quotedName}(?:[”"'’」』])?(?:的)?(?:名字|姓名)`, 'u').test(clause)) return true;
        if (/(?:不要|别|禁止|不能|不准|无需|不用|不想|避免|如果|假如|假设|是否|会怎样|听说|据说|听到|想起|记得|提到|提及|告诉|例如|比如)/u.test(clause)) return false;
        return [
            `(?:命名为|取名为|取名叫)\\s*${quotedName}${end}`,
            `(?:名字|姓名)(?:就)?(?:叫|是|为|[:：])\\s*${quotedName}${end}`,
            `(?:新角色|新人物|npc)(?:名)?(?:叫|是|为|[:：])\\s*${quotedName}${end}`,
            `(?:新增|新建|创建|加入|添加|引入|出现)[^。！？!?；;]{0,24}?(?:名叫|叫)\\s*${quotedName}${end}`,
            `(?:新增|新建|创建|加入|添加|引入|召唤)(?:一个|一名)?(?:角色|人物|npc)?\\s*${quotedName}${end}`,
            `(?:让|请|叫)\\s*${quotedName}(?:[”"'’」』])?\\s*(?:进来|过来|登场|出现|加入|进入)`
        ].some(pattern => new RegExp(pattern, 'u').test(clause));
    });
};

export const shouldBlockNewNpcTemplateName = (
    name: unknown,
    blacklist: ReadonlySet<string>,
    context: NpcTemplateNameContext = {},
    character?: any
): boolean => {
    const key = normalizeNpcNameKey(name);
    if (!key || !blacklist.has(key)) return false;
    const known = [...(context.currentSocial || []), ...(context.trustedCharacters || [])];
    const id = normalizeNpcNameKey(character?.id ?? character?.ID ?? character?.npcId);
    // ID 确认身份，但不能仅凭相同 ID 放行任意新姓名；改名仍交给原保护逻辑。
    const byId = id && known.find(npc => normalizeNpcNameKey(npc?.id ?? npc?.ID ?? npc?.npcId) === id);
    if (byId && characterNames(byId).includes(key)) return false;
    if (known.some(npc => characterNames(npc).includes(key))) return false;
    if (Array.from(context.trustedNames || []).some(value => normalizeNpcNameKey(value) === key)) return false;
    return !playerExplicitlySpecifiesNpcName(context.playerInput || '', key);
};

// push、整槽 set、整数组 set 共用来源判断，数组索引变化不代表新角色。
export const collectBlockedNpcTemplateNames = (
    params: NpcTemplateNameCheck,
    blacklist: ReadonlySet<string>,
    ignoredLogNames: ReadonlySet<string> = new Set()
): string[] => {
    const hits = new Set<string>();
    const add = (name: unknown, character?: any) => {
        if (shouldBlockNewNpcTemplateName(name, blacklist, params, character)) hits.add(normalizeNpcNameKey(name));
    };
    const addCharacter = (value: any) => {
        if (value && typeof value === 'object' && !Array.isArray(value)) add(value.姓名 ?? value.名称 ?? value.name, value);
    };
    const commands = params.commands ?? params.response?.tavern_commands ?? [];
    if (Array.isArray(commands)) commands.forEach(cmd => {
        const action = typeof cmd?.action === 'string' ? cmd.action.trim() : 'set';
        const key = normalizeStateCommandKey(typeof cmd?.key === 'string' ? cmd.key : '').replace(/^gameState\./, '');
        if (key === '社交' && (action === 'push' || action === 'add' || action === 'set')) {
            if (Array.isArray(cmd?.value)) cmd.value.forEach(addCharacter);
            else addCharacter(cmd?.value);
        } else if (action === 'set' && /^社交\[\d+\]$/.test(key)) {
            addCharacter(cmd?.value);
        } else if (action === 'set' && /^社交\[\d+\]\.姓名$/.test(key)) {
            add(cmd?.value);
        }
    });
    if (params.includeLogSenders !== false && Array.isArray(params.response?.logs)) {
        params.response.logs.forEach((log: any) => {
            const key = normalizeNpcNameKey(log?.sender);
            if (!ignoredLogNames.has(key)) add(log?.sender);
        });
    }
    return Array.from(hits);
};

// 明确读取已有结构中的角色字段，不扫描任意世界观正文，不读取本次 AI 候选对象。
export const collectTrustedNpcCharacters = (state: any, openingConfig?: OpeningConfig): any[] => {
    const list = (value: unknown): any[] => Array.isArray(value) ? value : [];
    const partners = openingConfig?.初始伙伴列表?.length
        ? openingConfig.初始伙伴列表 : (openingConfig?.初始伙伴 ? [openingConfig.初始伙伴] : []);
    return [
        state?.角色,
        ...list(state?.社交),
        ...list(state?.世界?.活跃NPC列表),
        ...list(state?.玩家门派?.重要成员),
        ...list(state?.战斗?.敌方),
        ...list(state?.战斗?.我方),
        ...list(state?.女主剧情规划?.女主条目).map(item => ({ 姓名: item?.女主姓名 })),
        ...list(state?.同人女主剧情规划?.女主条目).map(item => ({ 姓名: item?.女主姓名 })),
        ...partners.filter(partner => partner.enabled !== false)
    ].filter(Boolean);
};
