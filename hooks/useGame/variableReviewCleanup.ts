import { 获取默认技艺名称 } from '../../utils/skillDefaults';
import { normalizeStateCommandKey } from '../../utils/stateHelpers';
import { readVariableCommandValue } from './variableCommandValidation';
import type { TavernCommand, OpeningConfig } from '../../types';

/** 数据整理不等同剧情丢弃。仅为结构明确的无价值一次性杂物开放库存例外。 */
export const isDisposableReviewCleanup = (state: any, index: number): boolean => {
    const item = state.角色?.物品列表?.[index];
    if (!item || item.类型 !== '杂物' || !/^(?:普通塑料袋|空的一次性包装|已使用的暖宝宝)$/u.test(item.名称 || '')) return false;
    if (item.价值 !== 0 || ![0, 1].includes(item.堆叠数量 ?? item.数量) || !/无用途|无使用价值|已使用完/u.test(item.描述 || '')) return false;
    if (/任务|剧情|纪念|赠|钥匙|证件|特殊|装备|收藏|重要|仍在使用/u.test(JSON.stringify(item))) return false;
    const rest = { ...state, 角色: { ...state.角色, 物品列表: state.角色.物品列表.filter((_: any, i: number) => i !== index) } };
    const references = JSON.stringify(rest);
    return ![item.名称, item.ID, item.id].filter(Boolean).some(key => references.includes(String(key)));
};
export const reviewSkillCleanupIssue = (command: TavernCommand, state: any, opening?: OpeningConfig): string | undefined => {
    const key = normalizeStateCommandKey(command.key);
    if (command.action !== 'delete' || !/\.技艺(?:\[|\.|$)/u.test(key)) return;
    if (!/^gameState\.(?:角色|社交\[\d+\])\.技艺\[\d+\]$/u.test(key)) return '技艺整理只允许删除可选动态条目，不能删除整个技艺列表或其必需字段';
    const skill = readVariableCommandValue(state, key);
    if (!skill || skill.熟练度 !== 0 || skill.等级 !== '未入门') return '仅可整理明确未掌握且熟练度为0的动态技艺';
    if (获取默认技艺名称(opening?.题材模式, opening?.modeRuntimeProfile).includes(skill.名称)) return '默认技艺由系统维护，删除会被自动补回';
    if (!['', '尚未形成稳定技艺。'].includes(skill.描述 || '')) return '技艺有额外描述或学习关联，保留待确认';
};
