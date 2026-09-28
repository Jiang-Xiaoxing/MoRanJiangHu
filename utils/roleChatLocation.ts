import { 地图文本相互命中 } from './mapNpcLocation';

export type 角色对话位置判定 = {
    可选: boolean;
    需要确认: boolean;
    状态: 'nearby' | 'uncertain' | 'blocked';
    原因: string;
    地点摘要: string;
};

const 取文本 = (value: unknown): string => typeof value === 'string' ? value.trim() : '';

const 拆分位置路径 = (value: unknown): string[] => {
    const text = 取文本(value);
    return text ? text.split(/[>＞/\\|,，、;；]+/u).map(item => item.trim()).filter(Boolean) : [];
};

const 取NPC位置层级 = (npc: any): string[] => {
    const path = 拆分位置路径(npc?.位置路径);
    const direct = [npc?.大地点, npc?.中地点, npc?.小地点, npc?.当前位置, npc?.当前地点, npc?.具体地点]
        .map(取文本)
        .filter(Boolean);
    return Array.from(new Set([...path, ...direct]));
};

const 取环境位置层级 = (环境: any): string[] => [
    环境?.大地点,
    环境?.中地点,
    环境?.小地点,
    环境?.具体地点
].map(取文本).filter(Boolean);

const 命中 = (left: unknown, right: unknown): boolean => 地图文本相互命中(left, right);

const NPC已死亡 = (npc: any): boolean => {
    if (npc?.是否死亡 === true || npc?.存活 === false) return true;
    const state = [npc?.状态, npc?.生存状态, npc?.当前状态].map(取文本).join(' ');
    return /死亡|已死|身亡|阵亡|亡故|尸体/u.test(state) && !/假死|濒死/u.test(state);
};

export const 判断角色对话位置 = (npc: any, 环境: any): 角色对话位置判定 => {
    const npcName = 取文本(npc?.姓名) || '该角色';
    const npcLocations = 取NPC位置层级(npc);
    const envLocations = 取环境位置层级(环境);
    const npcLocationLabel = npcLocations.join(' > ');
    const envLocationLabel = envLocations.join(' > ');
    const 地点摘要 = npcLocationLabel || '位置未记录';

    if (NPC已死亡(npc)) {
        return { 可选: false, 需要确认: false, 状态: 'blocked', 原因: `${npcName}当前无法参与对话。`, 地点摘要 };
    }
    if (npc?.是否在场 !== true) {
        return { 可选: false, 需要确认: false, 状态: 'blocked', 原因: `${npcName}不在当前场景。`, 地点摘要 };
    }
    if (envLocations.length === 0 || npcLocations.length === 0) {
        return {
            可选: true,
            需要确认: true,
            状态: 'uncertain',
            原因: '记录不足，无法由程序确认彼此距离；请确认对方就在附近并能听见。',
            地点摘要
        };
    }

    const envLeaf = envLocations[envLocations.length - 1];
    const npcLeaf = npcLocations[npcLocations.length - 1];
    if (npcLocations.some(location => 命中(location, envLeaf))) {
        return {
            可选: true,
            需要确认: true,
            状态: 'nearby',
            原因: '位置记录与当前地点相符；请确认对方此刻就在交谈距离内。',
            地点摘要
        };
    }

    // NPC 只记录到城市/区域等上级地点时，程序无法据此判断实际距离，交给玩家确认。
    const npcLeaf只是当前上级地点 = envLocations.slice(0, -1).some(location => 命中(npcLeaf, location));
    if (npcLeaf只是当前上级地点) {
        return {
            可选: true,
            需要确认: true,
            状态: 'uncertain',
            原因: `只确认同处“${npcLeaf}”，具体距离不明；请确认对方就在附近。`,
            地点摘要
        };
    }

    return {
        可选: false,
        需要确认: false,
        状态: 'blocked',
        原因: `${npcName}的位置“${npcLeaf}”与当前地点“${envLeaf || envLocationLabel}”不一致，请先通过主行动接近。`,
        地点摘要
    };
};

export const 角色对话确认键 = (npc: any, 环境: any): string => {
    const npcId = 取文本(npc?.id) || 取文本(npc?.姓名);
    const envKey = 取环境位置层级(环境).join('>') || 'unknown-place';
    const npcKey = 取NPC位置层级(npc).join('>') || 'unknown-npc-place';
    return `${npcId}::${envKey}::${npcKey}::${npc?.是否在场 === true ? 'present' : 'absent'}`;
};
