import type { OpeningConfig } from '../types';
import { collectTrustedNpcCharacters, type NpcTemplateNameContext } from '../utils/npcTemplateNamePolicy';
import { 获取小说拆分数据集 } from './novelDecompositionStore';
import { 获取同人角色替换规则列表 } from '../utils/openingConfig';

export const buildNpcTemplateNameContext = async (
    state: any,
    openingConfig?: OpeningConfig,
    playerInput = ''
): Promise<NpcTemplateNameContext> => {
    const trustedCharacters = collectTrustedNpcCharacters(state, openingConfig);
    const fandom = openingConfig?.同人融合;
    if (fandom?.enabled && fandom.启用附加小说 && fandom.附加小说数据集ID) {
        const dataset = await 获取小说拆分数据集(fandom.附加小说数据集ID);
        trustedCharacters.push(...(dataset?.角色档案 || []));
        for (const segment of dataset?.分段列表 || []) {
            if (segment.处理状态 === '已完成' && segment.启用注入 !== false) trustedCharacters.push(...(segment.角色档案 || []));
        }
    }
    const trustedNames = fandom?.enabled && fandom.启用角色替换
        ? 获取同人角色替换规则列表(openingConfig, state?.角色?.姓名).flatMap(rule => [rule.原名称, rule.替换为])
        : [];
    return { currentSocial: state?.社交 || [], trustedCharacters, trustedNames, playerInput };
};
