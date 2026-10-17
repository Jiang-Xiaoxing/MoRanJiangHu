import { describe, expect, it, vi } from 'vitest';
import { createVariableReviewStreamParser } from '../utils/variableReviewStream';
const finding = '修复：'+JSON.stringify({ path: '角色.技艺[0]', category: '清理', description: '删除未掌握动态技艺', evidence: '熟练度0', current: 0, expected: '删除条目' });
describe('增量审查候选解析', () => {
    it('逐字符拆分中文和JSON，只展示完整事件且不重复', () => {
        const emit = vi.fn(); const receive = createVariableReviewStreamParser(emit);
        const text = `<说明>状态：需要修复\n${finding}\n</说明><命令></命令>`;
        for (let i = 1; i <= text.length; i++) receive(text.slice(0, i));
        receive(text);
        expect(emit).toHaveBeenCalledTimes(1);
        expect(emit.mock.calls[0][0][0]).toMatchObject({ category: '清理', current: 0 });
    });
    it('逐条可见，不等最终命令完整，断行片段继续等待', () => {
        const emit = vi.fn(); const receive = createVariableReviewStreamParser(emit);
        receive(`<说明>状态：需要修复\n${finding}`); expect(emit).not.toHaveBeenCalled();
        receive(`<说明>状态：需要修复\n${finding}\n修复：{`); expect(emit).toHaveBeenCalledTimes(1);
    });
    it('忽略无效JSON、隐藏推理和命令块', () => {
        const emit = vi.fn();
        createVariableReviewStreamParser(emit)(`<think>${finding}</think><说明>${finding}</说明>`);
        expect(emit).not.toHaveBeenCalled();
        createVariableReviewStreamParser(emit)(`<说明>状态：需要修复\n修复：{bad}\n</说明><命令>${finding}\n</命令>`);
        expect(emit).not.toHaveBeenCalled();
    });
});
