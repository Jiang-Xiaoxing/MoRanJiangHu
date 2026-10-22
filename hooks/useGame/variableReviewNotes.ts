import type { TavernCommand } from '../../types';
import { normalizeStateCommandKey } from '../../utils/stateHelpers';
import { isVariableReviewExcludedField, stableVariableReviewJson } from './variableReviewSnapshot';

export interface VariableReviewNoteTask { id: string; text: string; paths: string[] }
export type VariableReviewNoteStatus = 'noChange' | 'changesFound' | 'insufficientEvidence' | 'rejected' | 'incomplete';
export interface VariableReviewNoteResult extends VariableReviewNoteTask {
    status: VariableReviewNoteStatus;
    coverageMatched: boolean;
    reason: string;
    changePaths: string[];
    proposedCount: number;
    acceptedCount: number;
    rejectedCount: number;
}
export const variableReviewNoteStatusLabels: Record<VariableReviewNoteStatus, string> = {
    noChange: '已检查，无需修改', changesFound: '已检查，发现修改', insufficientEvidence: '证据不足，未修改', rejected: '命令被拒绝', incomplete: '未完成检查'
};
const normalized = (path: string) => normalizeStateCommandKey(path).replace(/^gameState\./u, '');
const under = (path: string, parent: string) => path === parent || path.startsWith(`${parent}.`) || path.startsWith(`${parent}[`);
const quote = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// 只读快照中的自有业务字段，不能通过备注/回执访问原型、图片或缓存。
const read = (state: any, raw: string): { exists: boolean; value?: unknown } => {
    const path = normalized(raw);
    if (!/^(?:角色|环境|世界|社交|战斗|玩家门派|任务列表|约定列表)(?:\.[^\s.[\]]+|\[\d+\])*$/u.test(path)) return { exists: false };
    const tokens = path.match(/[^.[\]]+/gu) || [];
    let value = state;
    for (const token of tokens) {
        if (['__proto__', 'constructor', 'prototype'].includes(token) || isVariableReviewExcludedField(token)
            || value == null || typeof value !== 'object' || !Object.hasOwn(value, token)) return { exists: false };
        value = value[token];
    }
    return { exists: true, value };
};

/** 本地识别明确对象/字段；未能定位的自然语言仍保留原文任务，不猜测对象、不丢弃。 */
export const buildVariableReviewNoteTasks = (notes: string | undefined, state: any): VariableReviewNoteTask[] => {
    if (!notes?.trim()) return [];
    const names = [state.角色?.姓名, ...(state.社交 || []).map((npc: any) => npc.姓名)].filter((name): name is string => typeof name === 'string' && !!name);
    const clauses = notes.split(new RegExp(`[；;。\\n]+|(?:和|以及|及|、|，)(?=(?:主角|玩家|${names.length ? names.map(quote).join('|') : '(?!)'}))`, 'u')).map(text => text.trim()).filter(Boolean);
    return clauses.map((text, index) => {
        const paths = new Set<string>();
        const add = (path: string) => { if (read(state, path).exists) paths.add(path); };
        const explicit = text.match(/(?:gameState\.)?(?:角色|环境|世界|社交|战斗|玩家门派|任务列表|约定列表)(?:\[\d+\]|\.[\p{L}\p{N}_]+)+/gu) || [];
        explicit.forEach(path => add(normalized(path)));
        const actors: Array<{ root: string; value: any; player: boolean }> = [];
        if (/主角|玩家/u.test(text) || state.角色?.姓名 && text.includes(state.角色.姓名)
            || /^(?:请|重点|优先)?(?:检查|审查|清理|核对|查看|查一下|查)?(?:背包|包裹|行囊)/u.test(text)) actors.push({ root: '角色', value: state.角色, player: true });
        (state.社交 || []).forEach((npc: any, i: number) => { if (npc.姓名 && text.includes(npc.姓名)) actors.push({ root: `社交[${i}]`, value: npc, player: false }); });
        if (!actors.length && /^(?:请|重点|优先)?(?:检查|审查|核对|修复)?(?:所有|全部|各人物的?|人物的?)?(?:装备|槽位|穿着|服装)/u.test(text)) {
            actors.push({ root: '角色', value: state.角色, player: true });
            (state.社交 || []).forEach((npc: any, i: number) => actors.push({ root: `社交[${i}]`, value: npc, player: false }));
        }
        for (const actor of actors) {
            const addField = (field: string) => add(`${actor.root}.${field}`);
            if (/服装|衣服|衣着|穿着|服饰|穿搭|着装|袜|内衣|内裤|鞋|腰带/u.test(text)) {
                ['衣着风格', actor.player ? '装备' : '当前装备', '穿着状态', '衣着状态', '服装状态'].forEach(addField);
            }
            if (/装备|槽位|武器|饰品|盔甲/u.test(text)) addField(actor.player ? '装备' : '当前装备');
            if (/背包|包裹|行囊|库存|物品|杂物/u.test(text)) addField(actor.player ? '物品列表' : '背包');
            if (/技艺|技能/u.test(text)) ['技艺', '技能列表'].forEach(addField);
            if (/状态|BUFF|DEBUFF/u.test(text)) ['状态', 'BUFF', 'DEBUFF', '玩家BUFF', '玩家DEBUFF'].forEach(addField);
            if (/金钱|金币|货币|余额|钱包/u.test(text)) addField('金钱');
            for (const field of ['姓名', '身份', '性别', '当前位置', '外貌描写']) if (text.includes(field)) addField(field);
        }
        for (const field of ['时间', '天气']) if (text.includes(field)) add(`环境.${field}`);
        if (/地点|位置/u.test(text) && !actors.length) ['地点', '大地点', '中地点', '小地点', '具体地点', '位置路径'].forEach(field => add(`环境.${field}`));
        if (/环境/u.test(text) && !paths.size) add('环境');
        if (/世界状态|世界变量/u.test(text)) add('世界');
        if (/战斗状态|战斗变量/u.test(text)) add('战斗');
        if (/门派/u.test(text)) add('玩家门派');
        if (/任务/u.test(text)) add('任务列表');
        if (/约定/u.test(text)) add('约定列表');
        if (!paths.size) actors.forEach(actor => add(actor.root));
        return { id: `note-${index + 1}`, text, paths: [...paths] };
    });
};

interface NoteReceipt {
    taskId: string;
    checkedPaths: string[];
    observations: Array<{ path: string; value: unknown }>;
    conclusion: 'noChange' | 'proposed' | 'insufficientEvidence';
    reason: string;
}
const receipts = (reports: string[]): NoteReceipt[] => reports.flatMap(line => {
    const match = line.trim().match(/^备注检查[：:]\s*(\{.*\})$/u);
    if (!match) return [];
    try {
        const value = JSON.parse(match[1]);
        return typeof value.taskId === 'string' && Array.isArray(value.checkedPaths) && value.checkedPaths.every((path: unknown) => typeof path === 'string')
            && Array.isArray(value.observations) && value.observations.every((item: any) => item && typeof item.path === 'string' && Object.hasOwn(item, 'value'))
            && ['noChange', 'proposed', 'insufficientEvidence'].includes(value.conclusion) && typeof value.reason === 'string' && value.reason.trim() ? [value as NoteReceipt] : [];
    } catch { return []; }
});

export const reconcileVariableReviewNotes = (params: {
    tasks: VariableReviewNoteTask[];
    reports: string[];
    before: any;
    changes: Array<{ path: string }>;
    proposedCommands: TavernCommand[];
    acceptedCommands: TavernCommand[];
    rejectedCommands: Array<{ command: TavernCommand; code: string; reason: string }>;
    truncated: boolean;
    issuePaths?: string[];
}): VariableReviewNoteResult[] => {
    const received = receipts(params.reports);
    return params.tasks.map(task => {
        const related = (path: string) => task.paths.some(root => under(normalized(path), root) || under(root, normalized(path)));
        const changes = params.changes.filter(change => related(change.path));
        const proposed = params.proposedCommands.filter(command => related(command.key));
        const accepted = params.acceptedCommands.filter(command => related(command.key));
        const rejected = params.rejectedCommands.filter(item => item.code !== 'alreadySettled' && related(item.command.key));
        const unresolved = params.issuePaths?.some(related);
        const candidates = received.filter(receipt => receipt.taskId === task.id);
        const receipt = candidates.length === 1 ? candidates[0] : undefined;
        const coverageMatched = !!receipt && !params.truncated && task.paths.length > 0
            && receipt.checkedPaths.length === task.paths.length
            && new Set(receipt.checkedPaths.map(normalized)).size === task.paths.length
            && task.paths.every(path => receipt.checkedPaths.some(checked => normalized(checked) === path)
                && receipt.observations.some(observation => under(normalized(observation.path), path)))
            && receipt.observations.length > 0 && receipt.observations.every(observation => {
                const value = read(params.before, observation.path);
                return task.paths.some(root => under(normalized(observation.path), root)) && value.exists
                    && stableVariableReviewJson(value.value) === stableVariableReviewJson(observation.value);
            });
        let status: VariableReviewNoteStatus = 'incomplete';
        let reason = !task.paths.length ? '未能将备注可靠定位到本次业务变量范围，保留原文供核对。'
            : params.truncated ? '上下文存在裁剪，不能确认完整覆盖本项任务。' : '缺少完整且与快照一致的结构化检查回执，不能确认已完成。';
        if (rejected.length && !changes.length) { status = 'rejected'; reason = rejected.map(item => item.reason).join('；'); }
        else if (coverageMatched && changes.length) { status = 'changesFound'; reason = '已根据程序模拟的真实 Diff 关联此任务，不使用 AI 自报的修改数量。'; }
        else if (coverageMatched && receipt!.conclusion === 'noChange' && !proposed.length && !unresolved) { status = 'noChange'; reason = receipt!.reason; }
        else if (coverageMatched && !changes.length) { status = 'insufficientEvidence'; reason = receipt!.reason; }
        return { ...task, status, coverageMatched, reason, changePaths: changes.map(change => change.path), proposedCount: proposed.length, acceptedCount: accepted.length, rejectedCount: rejected.length };
    });
};
