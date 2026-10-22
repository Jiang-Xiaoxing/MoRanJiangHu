import { describe, expect, it } from 'vitest';
import { isDisposableReviewCleanup, reviewSkillCleanupIssue } from '../hooks/useGame/variableReviewCleanup';
import { compareReviewEconomicChange } from '../hooks/useGame/variableReviewEconomy';
const trash = { ID: 'trash', 名称: '普通塑料袋', 类型: '杂物', 堆叠数量: 1, 价值: 0, 描述: '无使用价值' };
describe('严格数据整理保护', () => {
    it('允许无关联无价值一次性杂物，拒绝剧情信物与用途不明物品', () => {
        const state = { 角色: { 物品列表: [trash] } };
        expect(isDisposableReviewCleanup(state, 0)).toBe(true);
        for (const patch of [{ 描述: 'NPC赠送的纪念品' }, { 价值: 1 }, { 类型: '任务物品' }, { 名称: '钥匙' }, { 价值: undefined }, { 堆叠数量: 5 }]) {
            expect(isDisposableReviewCleanup({ 角色: { 物品列表: [{ ...trash, ...patch }] } }, 0)).toBe(false);
        }
        expect(isDisposableReviewCleanup({ ...state, 任务: [{ 描述: '带着普通塑料袋' }] }, 0)).toBe(false);
    });
    it('数据整理例外不要求虚构丢弃事实，但普通库存仍受原保护', () => {
        const state = { 角色: { 物品列表: [trash], 金钱: {} } };
        const next = { 角色: { 物品列表: [], 金钱: {} } };
        expect(compareReviewEconomicChange(state, next, undefined, [])).toBeNull();
        expect(compareReviewEconomicChange({ 角色: { ...state.角色, 物品列表: [{ ...trash, 价值: 3 }] } }, next, undefined, [])).toBeTruthy();
    });
    it('仅允许可选动态零值技艺，默认技艺与已学技艺及必需子字段保留', () => {
        const skill = { 名称: '驾驶', 等级: '未入门', 熟练度: 0, 描述: '尚未形成稳定技艺。' };
        const cmd = { action: 'delete' as const, key: '角色.技艺[0]', value: null };
        expect(reviewSkillCleanupIssue(cmd, { 角色: { 技艺: [skill] } })).toBeUndefined();
        for (const patch of [{ 名称: '医术' }, { 熟练度: 1 }, { 描述: '父亲传授，等待学习' }]) expect(reviewSkillCleanupIssue(cmd, { 角色: { 技艺: [{ ...skill, ...patch }] } })).toBeTruthy();
        expect(reviewSkillCleanupIssue({ ...cmd, key: '角色.技艺[0].熟练度' }, {})).toBeTruthy();
    });
});
