import type { ModeRuntimeProfile, OpeningConfig, 角色锚点结构, 题材模式类型 } from '../models/system';
import { 获取题材模式配置 } from './topicModeProfiles';

export type 视觉年龄分段 =
    | 'child'
    | 'early_teen'
    | 'late_teen'
    | 'young_adult'
    | 'mature_adult'
    | 'middle_aged'
    | 'elderly';

type 视觉年龄来源 =
    | 'actual'
    | 'explicit'
    | 'status'
    | 'supernatural'
    | 'fallback';

type 题材衰老模型 = 'immortal' | 'conditional' | 'reality';

export type 视觉年龄上下文 = {
    actualAge?: unknown;
    explicitVisualAge?: unknown;
    topicMode?: unknown;
    runtimeProfile?: ModeRuntimeProfile | null;
    openingConfig?: OpeningConfig | null;
    realmLevel?: unknown;
    realmText?: unknown;
    identity?: unknown;
    appearance?: unknown;
    body?: unknown;
    clothing?: unknown;
    bio?: unknown;
    race?: unknown;
    species?: unknown;
    statusText?: unknown;
    additionalTexts?: unknown[];
};

export type 视觉年龄解析结果 = {
    visualAgeBand: 视觉年龄分段;
    visualAgeLabel: string;
    source: 视觉年龄来源;
    actualAge?: number;
    suggestedVisualAge?: number;
    explicitVisualAgeText?: string;
    exactTagAge?: number;
    shouldUseExactAgeTag: boolean;
    shouldUseAgeAccurateFace: boolean;
    positiveTags: string[];
    negativeTags: string[];
    narrativeConstraints: string[];
    reasons: string[];
    isMinorVisual: boolean;
    isAdultVisual: boolean;
    isAdultSafetyApproved: boolean;
};

const 视觉年龄分段中文名映射: Record<视觉年龄分段, string> = {
    child: '幼童',
    early_teen: '少年',
    late_teen: '青少年',
    young_adult: '青年',
    mature_adult: '成熟青年',
    middle_aged: '中年',
    elderly: '老年'
};

const 强老态正则 = /老妪|老妇|老太婆|老太太|垂暮|白发苍苍|皱纹(?:深重|纵横)?|面容枯槁|鸡皮鹤发|寿元将尽|行将就木|衰老诅咒|急速衰老|苍老面容|老者面容/gu;
const 老态弱提示正则 = /老态/u;
const 否定老态正则 = /无(?:明显)?老态|不见老态|并无老态|没有老态|未显老态/u;
// 老态关键词的否定前缀：同一句子内、关键词之前出现这些词时，该处老态描述是“被否认的描述”，
// 不能作为老年外貌证据。典型场景：程序生成的约束“不得仅因真实年龄称为老妇、老妪或老太婆”
// 被二次判断回灌进人物描述后，字面匹配会误判 elderly。
const 老态否定词正则 = /不得|不能|不可以|禁止|切勿|勿|并非|不是|不会|不应|不准|无须|无需|不必|避免|防止|并未|并无|未有|未曾|不曾/u;
const 句子分隔正则 = /[。！？!?；;\n]+/u;
const 否定回溯窗口字数 = 24;
const 明确幼态正则 = /幼童外貌|孩童外貌|儿童外貌|幼女外貌|幼男外貌|childlike appearance|幼童|孩童|儿童|萝莉体型|正太体型/u;
const 明确少年正则 = /少年外貌|少女外貌|teen(?:age)? appearance|青春期外貌|青涩少年|青涩少女/u;
const 明确年轻正则 = /青年外貌|年轻外貌|二十岁上下|二十来岁|年轻貌美|年轻英俊|young adult|young-looking adult/u;
const 明确成熟正则 = /成熟外貌|成熟青年|三十岁上下|三十来岁|三旬上下|adult appearance|mature adult/u;
const 明确中年正则 = /中年外貌|四十岁上下|五十岁上下|middle-aged/u;
const 驻颜长生正则 = /驻颜|返老还童|不老|长生|青春药剂|身体机能保持巅峰|血统强化|基因强化|青春永驻|寿元悠长/u;
const 超凡强化正则 = /修士|修仙|修真|金丹|元婴|化神|炼虚|合体|渡劫|大乘|飞升|轮回者|主神|觉醒者|法师|术士|圣职|牧师|血统|异能|超凡|魔力|神格|半神|精灵|妖族|龙族|血族/u;
const 明确衰败正则 = /寿元枯竭|油尽灯枯|病骨支离|衰败不堪|风烛残年|残年败相/gu;

const 长寿种族倍率表: Array<{ pattern: RegExp; factor: number }> = [
    { pattern: /精灵|elf|高等精灵|月精灵/u, factor: 7 },
    { pattern: /龙族|巨龙|dragon/u, factor: 8 },
    { pattern: /血族|吸血鬼|vampire/u, factor: 6 },
    { pattern: /神族|半神|天使|angel/u, factor: 7 },
    { pattern: /妖族|狐妖|灵族|仙族|凤凰|麒麟/u, factor: 5 }
];

const 读取文本 = (value: unknown): string => (
    typeof value === 'string' ? value.trim() : ''
);

const 读取整数 = (value: unknown): number | undefined => {
    if (typeof value === 'number' && Number.isFinite(value)) return Math.max(0, Math.floor(value));
    if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) {
        return Math.max(0, Math.floor(Number(value)));
    }
    return undefined;
};

const 从分段读取中文名 = (band: 视觉年龄分段): string => (
    视觉年龄分段中文名映射[band]
);

const 从年龄映射分段 = (age?: number): 视觉年龄分段 => {
    if (typeof age !== 'number' || !Number.isFinite(age)) return 'mature_adult';
    if (age <= 12) return 'child';
    if (age <= 14) return 'early_teen';
    if (age <= 17) return 'late_teen';
    if (age <= 27) return 'young_adult';
    if (age <= 44) return 'mature_adult';
    if (age <= 64) return 'middle_aged';
    return 'elderly';
};

const 收集文本 = (context: 视觉年龄上下文): string[] => {
    return [
        context.explicitVisualAge,
        context.realmText,
        context.identity,
        context.appearance,
        context.body,
        context.clothing,
        context.bio,
        context.race,
        context.species,
        context.statusText,
        ...(Array.isArray(context.additionalTexts) ? context.additionalTexts : [])
    ]
        .map(读取文本)
        .filter(Boolean);
};

const 读取题材模式 = (context: 视觉年龄上下文): 题材模式类型 | undefined => {
    const fromOpening = context.openingConfig?.题材模式;
    if (typeof fromOpening === 'string' && fromOpening.trim()) return fromOpening;
    const fromRuntime = context.runtimeProfile?.identity?.baseMode;
    if (typeof fromRuntime === 'string' && fromRuntime.trim()) return fromRuntime;
    const raw = 读取文本(context.topicMode);
    if (!raw) return undefined;
    const knownModes: 题材模式类型[] = ['武侠', '仙侠', '西方奇幻', '灵气复苏', '都市修仙', '现代都市', '末日丧尸', '无限流'];
    return knownModes.find((item) => item === raw);
};

const 判断题材衰老模型 = (context: 视觉年龄上下文, combinedText: string): 题材衰老模型 => {
    if (context.runtimeProfile?.identity?.usesCultivation) return 'immortal';
    const mode = 读取题材模式(context);
    if (mode) {
        const group = 获取题材模式配置(mode).group;
        if (group === 'xianxia' || group === 'urban_xianxia') return 'immortal';
        if (group === 'wuxia' || group === 'western_fantasy' || group === 'infinite') return 'conditional';
    }
    return 超凡强化正则.test(combinedText) ? 'conditional' : 'reality';
};

const 读取长寿种族倍率 = (combinedText: string): number => {
    for (const entry of 长寿种族倍率表) {
        if (entry.pattern.test(combinedText)) return entry.factor;
    }
    return 1;
};

const 匹配是否被否定 = (句子: string, 匹配索引: number): boolean => {
    const 窗口起点 = Math.max(0, 匹配索引 - 否定回溯窗口字数);
    return 老态否定词正则.test(句子.slice(窗口起点, 匹配索引));
};

// 逐句扫描：只有“未被否定”的匹配才算证据。
// 带 g 标志的正则通过 exec 循环逐条匹配，使用前必须重置 lastIndex。
const 文本含非否定的匹配 = (text: string, pattern: RegExp): boolean => {
    if (!text) return false;
    for (const 句子 of text.split(句子分隔正则)) {
        if (!句子) continue;
        pattern.lastIndex = 0;
        let match: RegExpExecArray | null;
        while ((match = pattern.exec(句子)) !== null) {
            if (!匹配是否被否定(句子, match.index)) return true;
            if (match.index === pattern.lastIndex) pattern.lastIndex += 1;
        }
    }
    return false;
};

const 文本含明确老态 = (text: string): boolean => (
    文本含非否定的匹配(text, 强老态正则) || (老态弱提示正则.test(text) && !否定老态正则.test(text))
);

const 解析明确外观年龄 = (
    explicitVisualAge: unknown
): { band?: 视觉年龄分段; suggestedAge?: number; exactAge?: number; reason?: string; text?: string } => {
    const directNumber = 读取整数(explicitVisualAge);
    if (typeof directNumber === 'number' && directNumber > 0) {
        return {
            band: 从年龄映射分段(directNumber),
            suggestedAge: directNumber,
            exactAge: directNumber,
            reason: '使用明确外观年龄数值',
            text: String(directNumber)
        };
    }
    const text = 读取文本(explicitVisualAge);
    if (!text) return {};
    const numericMatch = text.match(/(\d{1,3})\s*岁/u);
    if (numericMatch) {
        const parsed = 读取整数(numericMatch[1]);
        if (typeof parsed === 'number' && parsed > 0) {
            return {
                band: 从年龄映射分段(parsed),
                suggestedAge: parsed,
                exactAge: parsed,
                reason: '使用明确外观年龄文本',
                text
            };
        }
    }
    if (文本含明确老态(text)) return { band: 'elderly', suggestedAge: 72, reason: '档案明确老态外观', text };
    if (明确幼态正则.test(text)) return { band: 'child', suggestedAge: 10, reason: '档案明确幼态外观', text };
    if (明确少年正则.test(text)) return { band: 'late_teen', suggestedAge: 16, reason: '档案明确少年外观', text };
    if (明确年轻正则.test(text)) return { band: 'young_adult', suggestedAge: 24, reason: '档案明确青年外观', text };
    if (明确成熟正则.test(text)) return { band: 'mature_adult', suggestedAge: 34, reason: '档案明确成熟外观', text };
    if (明确中年正则.test(text)) return { band: 'middle_aged', suggestedAge: 50, reason: '档案明确中年外观', text };
    return { text };
};

const 从分段生成年龄提示词 = (band: 视觉年龄分段): string[] => {
    switch (band) {
        case 'child':
            return ['child', 'age-appropriate child face'];
        case 'early_teen':
            return ['early teen', 'age-appropriate teen face'];
        case 'late_teen':
            return ['teenage adolescent', 'age-appropriate teen face', 'not a child'];
        case 'young_adult':
            return ['adult', 'young adult', 'youthful adult face'];
        case 'mature_adult':
            return ['adult', 'mature adult', 'mature youthful face'];
        case 'middle_aged':
            return ['adult', 'middle-aged adult', 'mature face'];
        case 'elderly':
            return ['adult', 'elderly appearance', 'aged face'];
        default:
            return ['adult'];
    }
};

const 从分段生成负向提示词 = (band: 视觉年龄分段): string[] => {
    switch (band) {
        case 'child':
            return ['adult body', 'mature adult face', 'elderly appearance', 'old face'];
        case 'early_teen':
            return ['child', 'adult body', 'elderly appearance', 'old face'];
        case 'late_teen':
            return ['child', 'adult body', 'elderly appearance', 'old face'];
        case 'young_adult':
            return ['child', 'teenage', 'elderly appearance', 'old face', 'wrinkles', 'frail body'];
        case 'mature_adult':
            return ['child', 'teenage', 'elderly appearance', 'old face', 'wrinkles', 'frail body'];
        case 'middle_aged':
            return ['child', 'teenage', 'elderly appearance'];
        case 'elderly':
            return ['child', 'teenage', 'young-looking child'];
        default:
            return [];
    }
};

const 从分段生成叙事约束 = (band: 视觉年龄分段): string[] => {
    switch (band) {
        case 'child':
            return ['外貌按儿童描写，不得视为成年人。'];
        case 'early_teen':
        case 'late_teen':
            return ['外貌按未成年描写，不得视为成年人。'];
        case 'young_adult':
            return ['真实年龄只代表经历；外貌按青年成年人描写。', '不得仅因真实年龄称为老妇、老妪或老太婆。'];
        case 'mature_adult':
            return ['真实年龄只代表经历；外貌按成熟成年人描写。', '不得仅因真实年龄称为老妇、老妪或老太婆。'];
        case 'middle_aged':
            return ['外貌按中年成年人描写，不因资历自动加重老态。'];
        case 'elderly':
            return ['档案支持老年外貌，可以使用与老态一致的外貌措辞。'];
        default:
            return [];
    }
};

const 从分段构建结果 = (
    band: 视觉年龄分段,
    options: {
        actualAge?: number;
        suggestedAge?: number;
        exactTagAge?: number;
        shouldUseExactAgeTag?: boolean;
        shouldUseAgeAccurateFace?: boolean;
        source: 视觉年龄来源;
        reasons: string[];
        explicitVisualAgeText?: string;
        extraConstraints?: string[];
    }
): 视觉年龄解析结果 => {
    const positiveTags = 从分段生成年龄提示词(band);
    if (typeof options.exactTagAge === 'number' && options.shouldUseExactAgeTag) {
        positiveTags.unshift(`${options.exactTagAge} years old`);
    }
    if (options.shouldUseAgeAccurateFace) {
        if (band === 'child') positiveTags.push('age-appropriate child face');
        else if (band === 'early_teen' || band === 'late_teen') positiveTags.push('age-appropriate teen face');
        else positiveTags.push('age-accurate face');
    }
    const narrativeConstraints = [
        ...从分段生成叙事约束(band),
        ...(Array.isArray(options.extraConstraints) ? options.extraConstraints : [])
    ];
    const isMinorVisual = band === 'child' || band === 'early_teen' || band === 'late_teen';
    const isAdultVisual = !isMinorVisual;
    return {
        visualAgeBand: band,
        visualAgeLabel: 从分段读取中文名(band),
        source: options.source,
        actualAge: options.actualAge,
        suggestedVisualAge: options.suggestedAge,
        explicitVisualAgeText: options.explicitVisualAgeText,
        exactTagAge: options.exactTagAge,
        shouldUseExactAgeTag: options.shouldUseExactAgeTag === true,
        shouldUseAgeAccurateFace: options.shouldUseAgeAccurateFace === true,
        positiveTags: Array.from(new Set(positiveTags.filter(Boolean))),
        negativeTags: Array.from(new Set(从分段生成负向提示词(band))),
        narrativeConstraints: Array.from(new Set(narrativeConstraints.filter(Boolean))),
        reasons: Array.from(new Set(options.reasons.filter(Boolean))),
        isMinorVisual,
        isAdultVisual,
        isAdultSafetyApproved: Boolean(isAdultVisual && (options.actualAge === undefined || options.actualAge >= 18))
    };
};

const 估算超凡视觉年龄 = (
    actualAge: number | undefined,
    realmLevel: number,
    model: 题材衰老模型,
    longevityFactor: number,
    hasPreservation: boolean
): number | undefined => {
    if (typeof actualAge !== 'number' || !Number.isFinite(actualAge) || actualAge <= 0) {
        if (model === 'immortal') return realmLevel >= 16 ? 36 : 44;
        if (model === 'conditional') return longevityFactor >= 5 ? 40 : 48;
        return undefined;
    }
    if (actualAge < 18) return actualAge;
    if (model === 'immortal') {
        if (realmLevel >= 16 || longevityFactor >= 5 || hasPreservation) {
            if (actualAge >= 200) return 33;
            if (actualAge >= 120) return 35;
            if (actualAge >= 80) return 36;
            if (actualAge >= 60) return 38;
            if (actualAge >= 45) return 40;
            return Math.min(actualAge, 40);
        }
        if (realmLevel >= 10 || hasPreservation) {
            if (actualAge >= 100) return 42;
            if (actualAge >= 80) return 45;
            if (actualAge >= 60) return 46;
            if (actualAge >= 45) return 44;
            return Math.min(actualAge, 44);
        }
        return actualAge;
    }
    if (model === 'conditional') {
        if (longevityFactor >= 5) {
            if (actualAge >= 120) return 34;
            if (actualAge >= 80) return 38;
            if (actualAge >= 60) return 42;
            return Math.min(actualAge, 42);
        }
        if (realmLevel >= 12 || hasPreservation) {
            if (actualAge >= 120) return 42;
            if (actualAge >= 80) return 48;
            if (actualAge >= 60) return 50;
            if (actualAge >= 45) return 46;
            return Math.min(actualAge, 46);
        }
    }
    return actualAge;
};

export const 解析视觉年龄 = (context: 视觉年龄上下文): 视觉年龄解析结果 => {
    const actualAge = 读取整数(context.actualAge);
    const realmLevel = 读取整数(context.realmLevel) ?? 0;
    const texts = 收集文本(context);
    const combinedText = texts.join(' ');
    const explicit = 解析明确外观年龄(context.explicitVisualAge);
    const modeModel = 判断题材衰老模型(context, combinedText);
    const hasExplicitElderly = 文本含明确老态(combinedText) || 文本含非否定的匹配(combinedText, 明确衰败正则);
    const hasExplicitChild = 明确幼态正则.test(combinedText);
    const hasExplicitTeen = 明确少年正则.test(combinedText);
    const hasPreservation = 驻颜长生正则.test(combinedText);
    const hasSupernaturalEvidence = 超凡强化正则.test(combinedText) || realmLevel >= 10 || hasPreservation;
    const longevityFactor = 读取长寿种族倍率(combinedText);

    if (typeof actualAge === 'number' && actualAge < 18) {
        const band = 从年龄映射分段(actualAge);
        return 从分段构建结果(band, {
            actualAge,
            suggestedAge: actualAge,
            exactTagAge: actualAge,
            shouldUseExactAgeTag: true,
            shouldUseAgeAccurateFace: true,
            source: 'actual',
            reasons: ['真实年龄未满18岁，必须按未成年视觉年龄处理。']
        });
    }

    if (hasExplicitElderly) {
        return 从分段构建结果('elderly', {
            actualAge,
            suggestedAge: explicit.suggestedAge ?? 72,
            exactTagAge: explicit.exactAge ?? (modeModel === 'reality' ? actualAge : undefined),
            shouldUseExactAgeTag: typeof explicit.exactAge === 'number' || (modeModel === 'reality' && typeof actualAge === 'number'),
            shouldUseAgeAccurateFace: typeof explicit.exactAge === 'number' || (modeModel === 'reality' && typeof actualAge === 'number'),
            source: explicit.band ? 'explicit' : 'status',
            reasons: [explicit.reason || '正文存在明确老态或寿元衰败证据。'],
            explicitVisualAgeText: explicit.text
        });
    }

    if (explicit.band) {
        return 从分段构建结果(explicit.band, {
            actualAge,
            suggestedAge: explicit.suggestedAge,
            exactTagAge: explicit.exactAge,
            shouldUseExactAgeTag: typeof explicit.exactAge === 'number',
            shouldUseAgeAccurateFace: typeof explicit.exactAge === 'number',
            source: 'explicit',
            reasons: [explicit.reason || '使用明确外观年龄。'],
            explicitVisualAgeText: explicit.text,
            extraConstraints: explicit.band === 'child' || explicit.band === 'early_teen' || explicit.band === 'late_teen'
                ? ['即使真实年龄已成年，只要档案明确幼态或未成年外观，也不得用于成人私密生图。']
                : undefined
        });
    }

    if (hasExplicitChild) {
        return 从分段构建结果('child', {
            actualAge,
            suggestedAge: 10,
            source: 'status',
            reasons: ['正文存在明确幼态外观证据。'],
            extraConstraints: ['即使真实年龄已成年，只要档案明确幼态外观，也不得用于成人私密生图。']
        });
    }

    if (hasExplicitTeen) {
        return 从分段构建结果('late_teen', {
            actualAge,
            suggestedAge: 16,
            source: 'status',
            reasons: ['正文存在明确少年外观证据。'],
            extraConstraints: ['即使真实年龄已成年，只要档案明确未成年外观，也不得用于成人私密生图。']
        });
    }

    const supernaturalEstimate = hasSupernaturalEvidence
        ? 估算超凡视觉年龄(actualAge, realmLevel, modeModel, longevityFactor, hasPreservation)
        : undefined;
    if (typeof supernaturalEstimate === 'number' && supernaturalEstimate > 0 && typeof actualAge === 'number' && supernaturalEstimate !== actualAge) {
        const band = 从年龄映射分段(supernaturalEstimate);
        const reasonHead = modeModel === 'immortal'
            ? '题材允许长生或驻颜，视觉年龄优先跟随修炼层级与外貌证据。'
            : '题材存在超凡强化证据，视觉年龄不完全按现实衰老处理。';
        return 从分段构建结果(band, {
            actualAge,
            suggestedAge: supernaturalEstimate,
            source: 'supernatural',
            reasons: [
                reasonHead,
                hasPreservation ? '资料包含驻颜、返老还童或长期维持巅峰状态的证据。' : '',
                longevityFactor >= 5 ? '资料包含长寿种族或血统证据。' : '',
                realmLevel > 0 ? `境界层级证据为 ${realmLevel}。` : ''
            ].filter(Boolean),
            extraConstraints: band === 'young_adult' || band === 'mature_adult'
                ? ['高龄超凡角色的资历可通过前辈、长老、老祖等身份体现，不要求老年面容。']
                : undefined
        });
    }

    if (typeof actualAge === 'number' && actualAge > 0) {
        const band = 从年龄映射分段(actualAge);
        return 从分段构建结果(band, {
            actualAge,
            suggestedAge: actualAge,
            exactTagAge: actualAge,
            shouldUseExactAgeTag: true,
            shouldUseAgeAccurateFace: true,
            source: 'actual',
            reasons: ['缺少稳定超凡驻颜证据，按现实年龄衰老处理。']
        });
    }

    return 从分段构建结果('mature_adult', {
        actualAge,
        suggestedAge: 32,
        source: 'fallback',
        reasons: ['缺少真实年龄与明确外观年龄时，保守按成年外观处理。'],
        extraConstraints: ['未提供明确未成年证据时，不得默认生成幼态外观。']
    });
};

export const 构建视觉年龄签名 = (result: Pick<视觉年龄解析结果, 'visualAgeBand' | 'suggestedVisualAge' | 'exactTagAge' | 'isAdultSafetyApproved' | 'source'>): string => {
    const agePart = typeof result.exactTagAge === 'number'
        ? result.exactTagAge
        : (typeof result.suggestedVisualAge === 'number' ? Math.round(result.suggestedVisualAge) : 'na');
    return [
        'v2',
        result.visualAgeBand,
        String(agePart),
        result.source,
        result.isAdultSafetyApproved ? 'adult' : 'restricted'
    ].join(':');
};

const 锚点文本含老态 = (text: string): boolean => /elderly|aged face|old face|wrinkles|frail body|\bold\s+woman\b|\bold\s+man\b/i.test(text);
const 锚点文本含幼态 = (text: string): boolean => /\bchild\b|幼童|teenage|teen face|少年|少女/i.test(text);

export const 自动角色锚点视觉年龄是否过期 = (
    anchor: Pick<角色锚点结构, '来源' | '视觉年龄签名' | '正面提示词' | '负面提示词'> | null | undefined,
    current: 视觉年龄解析结果
): boolean => {
    if (!anchor) return true;
    if (anchor.来源 === 'manual' || anchor.来源 === 'imported') return false;
    const currentSignature = 构建视觉年龄签名(current);
    const anchorSignature = 读取文本(anchor.视觉年龄签名);
    if (anchorSignature) return anchorSignature !== currentSignature;
    const mergedText = `${读取文本(anchor.正面提示词)} ${读取文本(anchor.负面提示词)}`.trim();
    if (!mergedText) return false;
    if (current.isMinorVisual) return 锚点文本含老态(mergedText);
    if (current.visualAgeBand === 'elderly') return 锚点文本含幼态(mergedText);
    return 锚点文本含老态(mergedText) || 锚点文本含幼态(mergedText);
};
