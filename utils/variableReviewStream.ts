/** 只读取说明块中已完整结束的一行；命令与隐藏推理均不进入候选UI。 */
export interface VariableReviewCandidate {
    equipmentOwner?: string;
    path: string;
    category: '补齐' | '修正' | '清理' | '待确认';
    description: string;
    evidence: string;
    current?: unknown;
    expected?: unknown;
}
export const createVariableReviewStreamParser = (emit: (items: VariableReviewCandidate[]) => void) => {
    let offset = 0;
    let started = false;
    let ended = false;
    const seen = new Set<string>();
    return (text: string) => {
        if (ended) return;
        if (!started) {
            // 严格要求标签位于开头，避免将推理中的伪协议展示给玩家。
            const start = text.match(/^\s*<说明>/u);
            if (!start) return;
            started = true; offset = start[0].length;
        }
        const batch: VariableReviewCandidate[] = [];
        while (offset < text.length) {
            const newline = text.indexOf('\n', offset);
            const close = text.indexOf('</说明>', offset);
            const end = close >= 0 && (newline < 0 || close < newline) ? close : newline;
            if (end < 0) break;
            const line = text.slice(offset, end).trim();
            offset = end + 1;
            if (end === close) ended = true;
            const match = line.match(/^(修复|疑点)[：:]\s*(\{.*\})$/u);
            if (match) {
                try {
                    const item = JSON.parse(match[2]);
                    if (typeof item.path === 'string' && typeof item.description === 'string' && typeof item.evidence === 'string') {
                        const category = match[1] === '疑点' ? '待确认' : ['补齐', '修正', '清理'].includes(item.category) ? item.category : '修正';
                        const candidate: VariableReviewCandidate = { path: item.path, category, description: item.description, evidence: item.evidence, current: item.current, expected: item.expected };
                        const key = JSON.stringify(candidate);
                        if (!seen.has(key)) { seen.add(key); batch.push(candidate); }
                    }
                } catch { /* 无效/不完整事件不展示；完整协议仍由最终解析器把关。 */ }
            }
            if (ended) break;
        }
        if (batch.length) emit(batch);
    };
};
