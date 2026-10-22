import { describe, expect, it } from 'vitest';
import { 收集在档人物名集合, 校准规划关联人物一致性 } from '../utils/planningConsistency';

const 社交 = [
    { 姓名: '沈听澜', 别名: '听澜姑娘' },
    { 姓名: '老李', 称号: '李掌柜' },
    { 姓名: '  白 芷  ' },
    null,
    '非对象条目'
];

describe('收集在档人物名集合', () => {
    it('收集姓名/别名/称号，空白与大小写归一化', () => {
        const set = 收集在档人物名集合(社交, '叶 凡');
        expect(set.has('沈听澜')).toBe(true);
        expect(set.has('听澜姑娘')).toBe(true);
        expect(set.has('李掌柜')).toBe(true);
        expect(set.has('白芷')).toBe(true);
        expect(set.has('叶凡')).toBe(true);
        expect(set.size).toBe(6);
    });
});

describe('校准规划关联人物一致性', () => {
    const 构建规划 = () => ({
        当前章任务: [
            {
                标题: '夜探漕帮',
                关联人物: ['沈听澜', '柳无痕'],
                当前状态: '进行中'
            },
            {
                标题: '押镖',
                关联人物: ['老李'],
                当前状态: '待复核 【人物核对】关联人物 「老李」不在当前社交档案中（可能已退场或尚未出场），安排其登场前需先确认去向或补写入场。'
            }
        ],
        镜头规划: [
            {
                镜头标题: '码头相遇',
                关联人物: ['白芷', '听澜姑娘'],
                当前状态: ''
            },
            {
                镜头标题: '无关联人物条目',
                当前状态: '保持'
            }
        ]
    });

    it('不在社交档案的关联人物被打上标记，在档的不动', () => {
        const plan = 构建规划();
        const set = 收集在档人物名集合(社交, '');
        const { 变更条目数 } = 校准规划关联人物一致性(plan, set);
        // 任务1（柳无痕不在档）、任务2（旧标记刷新，老李已在档→标记应被清除）、镜头1（白芷在档，听澜姑娘是别名在档）
        expect(plan.当前章任务[0].当前状态).toContain('【人物核对】');
        expect(plan.当前章任务[0].当前状态).toContain('柳无痕');
        expect(plan.当前章任务[1].当前状态).toBe('待复核');
        // 镜头1 的白芷与「听澜姑娘」（别名）都在档，不应被打标记
        expect(plan.镜头规划[0].当前状态).toBe('');
        expect(变更条目数).toBe(2);
    });

    it('标记幂等：重复校准不叠加', () => {
        const plan = 构建规划();
        const set = 收集在档人物名集合(社交, '');
        校准规划关联人物一致性(plan, set);
        const first = plan.当前章任务[0].当前状态;
        校准规划关联人物一致性(plan, set);
        expect(plan.当前章任务[0].当前状态).toBe(first);
        expect(plan.当前章任务[0].当前状态.match(/【人物核对】/g)?.length).toBe(1);
    });

    it('标记后追加含【的普通文本时，刷新不叠加也不误删该文本', () => {
        const plan = 构建规划();
        const set = 收集在档人物名集合(社交, '');
        校准规划关联人物一致性(plan, set);
        // 模拟规划分析 AI 在标记后又追加了含【的其他文本
        plan.当前章任务[0].当前状态 = `${plan.当前章任务[0].当前状态} 【复核备注】待定`;
        const beforeCount = plan.当前章任务[0].当前状态.match(/【人物核对】/g)?.length ?? 0;
        校准规划关联人物一致性(plan, set);
        expect(plan.当前章任务[0].当前状态.match(/【人物核对】/g)?.length).toBe(beforeCount);
        expect(plan.当前章任务[0].当前状态).toContain('【复核备注】待定');
    });

    it('人物全部回档时清除旧标记', () => {
        const plan = 构建规划();
        // 柳无痕重新入档后，任务1 的标记应被清掉
        const set = 收集在档人物名集合([...社交, { 姓名: '柳无痕' }], '');
        const { 变更条目数 } = 校准规划关联人物一致性(plan, set);
        expect(plan.当前章任务[0].当前状态).toBe('进行中');
        expect(变更条目数).toBe(1);
    });

    it('空规划与非法输入安全返回', () => {
        expect(校准规划关联人物一致性(undefined, new Set()).变更条目数).toBe(0);
        expect(校准规划关联人物一致性(null, new Set()).变更条目数).toBe(0);
        expect(校准规划关联人物一致性({}, 收集在档人物名集合([], '')).变更条目数).toBe(0);
    });
});
