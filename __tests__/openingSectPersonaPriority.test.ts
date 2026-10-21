import { describe, expect, it } from 'vitest';
import { 获取开场初始化任务提示词 } from '../prompts/runtime/opening';
import { 构建开局角色建档摘要 } from '../hooks/useGame/openingStoryWorkflow';

describe('开局组织归属优先级（玩家人设优先于随机生成）', () => {
    const prompt = 获取开场初始化任务提示词();

    it('组织段包含建档门派唯一真值硬规则', () => {
        expect(prompt).toContain('【组织归属优先级】');
        expect(prompt).toContain('必须将该描述视为唯一真值初始化');
        expect(prompt).toContain('不得另行随机生成新组织');
    });

    it('硬规则引用开局额外约束块名，与 openingConfig 产出一致', () => {
        expect(prompt).toContain('【开局额外约束】');
    });

    it('建档优先规则排在随机生成规则之前', () => {
        const priorityIndex = prompt.indexOf('【组织归属优先级】');
        const randomIndex = prompt.indexOf('都必须由本局 `world_prompt`、主角出身、题材模式与随机性生成');
        expect(priorityIndex).toBeGreaterThan(0);
        expect(randomIndex).toBeGreaterThan(0);
        expect(priorityIndex).toBeLessThan(randomIndex);
    });

    it('建档摘要带门派归属锚点句', () => {
        const summary = 构建开局角色建档摘要({
            姓名: '测试角色',
            性别: '男',
            年龄: 20,
            出身背景: { 名称: '玄墨派外门', 描述: '自幼入玄墨派，师从内堂长老。', 效果: '门派贡献初始 +20。' }
        });
        expect(summary).toContain('已写明主角的门派/组织归属');
        expect(summary).toContain('不得另行随机生成新组织或改写归属');
        expect(summary).toContain('玄墨派外门');
    });
});
