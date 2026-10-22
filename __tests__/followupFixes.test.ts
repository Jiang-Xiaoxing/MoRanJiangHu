import { describe, expect, it } from 'vitest';
import { 合并摘要事实, 解析摘要输出 } from '../hooks/useGame/groupChatTranscriptBudget';

describe('review 修复：事实合并不丢细节', () => {
    it('新事实更长且包含旧事实时，用新的替换旧的', () => {
        const 合并 = 合并摘要事实(['药材已分好'], ['药材已分好，先煎的摆在炉边']);
        expect(合并).toEqual(['药材已分好，先煎的摆在炉边']);
    });

    it('旧事实包含新事实时，保留旧的，不降级成更短的说法', () => {
        const 合并 = 合并摘要事实(['药材已分好，先煎的摆在炉边'], ['药材已分好']);
        expect(合并).toEqual(['药材已分好，先煎的摆在炉边']);
    });

    it('完全相同的只留一条', () => {
        expect(合并摘要事实(['薄荷另包'], ['薄荷另包'])).toHaveLength(1);
    });
});

describe('review 修复：摘要概述兜底只用干净文本', () => {
    it('模型按格式回了事实时，概述不会被原始输出污染', () => {
        const 结果 = 解析摘要输出('<事实>\n1. 药引是城南红糖\n</事实>\n<概述>在备药。</概述>');
        expect(结果.概述).toBe('在备药。');
        expect(结果.概述).not.toContain('<事实>');
    });

    it('模型没按格式回时，整段当概述，但不含标签', () => {
        const 结果 = 解析摘要输出('刚才在说分药材和火候。');
        expect(结果.事实).toEqual([]);
        expect(结果.概述).toBe('刚才在说分药材和火候。');
    });
});
