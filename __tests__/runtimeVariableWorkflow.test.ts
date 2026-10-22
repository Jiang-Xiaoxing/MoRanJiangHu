import { describe, expect, it, vi } from 'vitest';
import { 创建运行时变量工作流 } from '../hooks/useGame/runtimeVariableWorkflow';
import { 规范化社交列表 } from '../hooks/useGame/stateTransforms';

const 创建依赖 = (options?: { heroinePlanEnabled?: boolean }) => {
    let social: any[] = [];
    const state = {
        角色: {},
        环境: {},
        社交: social,
        世界: {},
        战斗: {},
        剧情: {},
        剧情规划: {},
        女主剧情规划: undefined,
        同人剧情规划: undefined,
        同人女主剧情规划: undefined,
        玩家门派: {},
        任务列表: [],
        约定列表: [],
        记忆系统: {}
    };
    const performAutoSave = vi.fn();
    const deps = {
        获取历史记录: () => [],
        深拷贝: <T,>(value: T): T => JSON.parse(JSON.stringify(value)),
        获取当前状态: () => ({ ...state, 社交: social }),
        规范化角色物品容器映射: (value: any) => value || {},
        规范化环境信息: (value: any) => value || {},
        规范化社交列表,
        规范化世界状态: (value: any) => value || {},
        规范化战斗状态: (value: any) => value || {},
        规范化剧情状态: (value: any) => value || {},
        规范化剧情规划状态: (value: any) => value || {},
        规范化女主剧情规划状态: (value: any) => value,
        规范化同人剧情规划状态: (value: any) => value,
        规范化同人女主剧情规划状态: (value: any) => value,
        规范化门派状态: (value: any) => value || {},
        规范化记忆系统: (value: any) => value || {},
        环境时间转标准串: () => '',
        获取开局配置: () => ({}),
        设置角色: (value: any) => { state.角色 = value; },
        设置环境: (value: any) => { state.环境 = value; },
        设置社交: (value: any) => { social = value; state.社交 = value; },
        设置世界: (value: any) => { state.世界 = value; },
        设置战斗: (value: any) => { state.战斗 = value; },
        设置剧情: (value: any) => { state.剧情 = value; },
        设置剧情规划: (value: any) => { state.剧情规划 = value; },
        设置女主剧情规划: (value: any) => { state.女主剧情规划 = value; },
        设置同人剧情规划: (value: any) => { state.同人剧情规划 = value; },
        设置同人女主剧情规划: (value: any) => { state.同人女主剧情规划 = value; },
        设置玩家门派: (value: any) => { state.玩家门派 = value; },
        设置任务列表: (value: any) => { state.任务列表 = value; },
        设置约定列表: (value: any) => { state.约定列表 = value; },
        应用并同步记忆系统: (value: any) => { state.记忆系统 = value; },
        performAutoSave,
        女主规划已启用: () => options?.heroinePlanEnabled !== false
    };
    return { deps, getSocial: () => social, getState: () => state, performAutoSave };
};

describe('运行时变量管理', () => {
    it('保存分区仍保护主角撇号变体，同时保留正常词间空格差异', async () => {
        const { deps, getSocial } = 创建依赖();
        const workflow = 创建运行时变量工作流(deps);
        await workflow.updateRuntimeVariableSection('角色', { 姓名: "O'Connor" });
        await workflow.updateRuntimeVariableSection('社交', [{ 姓名: 'O’Connor', 身份: '旅人' }]);
        expect(getSocial()).toEqual([]);
        await workflow.applyRuntimeVariableCommand({ action: 'push', key: '社交', value: { 姓名: 'O’Connor', 身份: '旅人' } });
        expect(getSocial()).toEqual([]);
        await workflow.updateRuntimeVariableSection('角色', { 姓名: 'Emily Carter' });
        await workflow.updateRuntimeVariableSection('社交', [{ 姓名: 'EmilyCarter', 身份: '旅人' }]);
        expect(getSocial().map(npc => npc.姓名)).toEqual(['EmilyCarter']);
    });
    it('保存社交分区时保留人工填写的主要女性正式姓名', async () => {
        const { deps, getSocial, performAutoSave } = 创建依赖();
        const workflow = 创建运行时变量工作流(deps);

        await workflow.updateRuntimeVariableSection('社交', [
            {
                id: 'npc_manual_social_name',
                姓名: '黄蓉',
                性别: '女',
                年龄: 18,
                是否主要角色: true
            }
        ]);

        expect(getSocial()[0].姓名).toBe('黄蓉');
        expect(performAutoSave).toHaveBeenCalledWith(expect.objectContaining({
            social: expect.arrayContaining([
                expect.objectContaining({ 姓名: '黄蓉' })
            ]),
            force: true
        }));
    });

    it('关闭女主规划时忽略女主规划分区保存', async () => {
        const { deps, getState, performAutoSave } = 创建依赖({ heroinePlanEnabled: false });
        const workflow = 创建运行时变量工作流(deps);

        await workflow.updateRuntimeVariableSection('女主剧情规划', { 现状: '新规划' });
        await workflow.updateRuntimeVariableSection('同人女主剧情规划', { 现状: '新同人规划' });

        expect(getState().女主剧情规划).toBeUndefined();
        expect(getState().同人女主剧情规划).toBeUndefined();
        expect(performAutoSave).not.toHaveBeenCalled();
    });

    it('关闭女主规划时忽略女主规划变量命令', async () => {
        const { deps, getState, performAutoSave } = 创建依赖({ heroinePlanEnabled: false });
        const workflow = 创建运行时变量工作流(deps);

        await workflow.applyRuntimeVariableCommand({ action: 'set', key: '女主剧情规划.现状', value: '新规划' } as any);
        await workflow.applyRuntimeVariableCommand({ action: 'set', key: '同人女主剧情规划.现状', value: '新同人规划' } as any);

        expect(getState().女主剧情规划).toBeUndefined();
        expect(getState().同人女主剧情规划).toBeUndefined();
        expect(performAutoSave).not.toHaveBeenCalled();
    });

    it('运行时变量命令会把背包数量减少同步到真实物品列表', async () => {
        const { deps, getState, performAutoSave } = 创建依赖();
        getState().角色 = {
            姓名: '杨培强',
            物品列表: [
                { ID: 'item_pill', 名称: '回气丹', 堆叠数量: 3, 是否可堆叠: true }
            ]
        };
        const workflow = 创建运行时变量工作流(deps);

        await workflow.applyRuntimeVariableCommand({
            action: 'sub',
            key: '角色.物品列表[0].堆叠数量',
            value: 1
        } as any);

        expect(getState().角色.物品列表[0].堆叠数量).toBe(2);
        expect(performAutoSave).toHaveBeenCalledWith(expect.objectContaining({
            char: expect.objectContaining({
                物品列表: expect.arrayContaining([
                    expect.objectContaining({ 名称: '回气丹', 堆叠数量: 2 })
                ])
            }),
            force: true
        }));
    });
});
