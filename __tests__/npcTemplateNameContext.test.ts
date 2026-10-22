import { describe, expect, it, vi } from 'vitest';
import { buildNpcTemplateNameContext } from '../services/npcTemplateNameContext';
import { 获取小说拆分数据集 } from '../services/novelDecompositionStore';
import { 提取命中新女性角色姓名黑名单 } from '../utils/femaleNameSelector';
vi.mock('../services/novelDecompositionStore', () => ({ 获取小说拆分数据集: vi.fn() }));

describe('可信原著/配置来源', () => {
    it('读取已选择原著数据集中的角色档案，不扫描小说正文', async () => {
        vi.mocked(获取小说拆分数据集).mockResolvedValueOnce({
            角色档案: [{ 名称: '赵灵儿' }],
            分段列表: [
                { 处理状态: '已完成', 角色档案: [{ 名称: '苏婉清' }], 正文: '云韵' },
                { 处理状态: '待处理', 角色档案: [{ 名称: '沈清婉' }] }
            ]
        } as any);
        const context = await buildNpcTemplateNameContext({ 社交: [] }, { 同人融合: { enabled: true, 启用附加小说: true, 附加小说数据集ID: 'selected' } } as any);
        expect(获取小说拆分数据集).toHaveBeenLastCalledWith('selected');
        const commands = ['赵灵儿', '苏婉清', '沈清婉', '云韵'].map(姓名 => ({ action: 'push', key: '社交', value: { 姓名 } }));
        expect(提取命中新女性角色姓名黑名单({ ...context, commands })).toEqual(['沈清婉', '云韵']);
    });
    it('未开启附加小说不读取全局数据集；导入社交与配置伙伴仍豁免', async () => {
        vi.mocked(获取小说拆分数据集).mockClear();
        const context = await buildNpcTemplateNameContext({ 社交: [{ 姓名: '苏婉清' }] }, { 初始伙伴: { enabled: true, 姓名: '赵灵儿' } } as any);
        expect(获取小说拆分数据集).not.toHaveBeenCalled();
        expect(提取命中新女性角色姓名黑名单({ ...context, commands: ['苏婉清', '赵灵儿'].map(姓名 => ({ action: 'push', key: '社交', value: { 姓名 } })) })).toEqual([]);
    });
    it('启用的同人角色替换配置提供可信原名和目标名', async () => {
        const context = await buildNpcTemplateNameContext({ 角色: { 姓名: '主角' } }, { 同人融合: {
            enabled: true, 启用角色替换: true,
            附加角色替换规则列表: [{ 原名称: '赵灵儿', 替换为: '苏婉清' }]
        } } as any);
        expect(提取命中新女性角色姓名黑名单({ ...context, commands: ['赵灵儿', '苏婉清'].map(姓名 => ({ action: 'push', key: '社交', value: { 姓名 } })) })).toEqual([]);
    });

});
