import type { TavernCommand } from '../../types';
import type { NPC装备栏 } from '../../models/social';
import { 装备槽位列表 } from '../../utils/equipmentActions';
import { normalizeStateCommandKey } from '../../utils/stateHelpers';

export const npcReviewEquipmentSlots = ['主武器', '副武器', '服装', '饰品', '内衣', '内裤', '袜饰', '鞋履'] as const satisfies readonly (keyof NPC装备栏)[];
export const emptyReviewEquipment = (value: unknown) => value == null || /^(?:|无|暂无|未装备|空|没有|none|n\/a)$/iu.test(String(value).trim());
const path = (key: string) => normalizeStateCommandKey(key).replace(/^gameState\./u, '');
const special = /连衣裙|连体|披风|腰封|特殊护甲|多槽|世界观特殊|套装|两用|覆盖全身|同时.*(?:占据|穿戴|覆盖)|占用.*槽/u;
export interface EquipmentReviewMove { root: string; owner: string; source: string; target: string; reference: string; itemId?: string; reason: string; commands: TavernCommand[] }
export interface EquipmentReviewAudit { moves: EquipmentReviewMove[]; issues: Array<{ path: string; description: string; evidence: string; reason: string }> }
export const reviewEquipmentOwners = (state: any) => [
    { root: '角色.装备', name: state.角色?.姓名 || '主角', equipment: state.角色?.装备 || {}, items: state.角色?.物品列表 || [], player: true },
    ...(state.社交 || []).map((npc: any, i: number) => ({ root: `社交[${i}].当前装备`, name: npc.姓名 || 'NPC', equipment: npc.当前装备 || {}, items: npc.背包 || npc.物品列表 || [], player: false }))
];
/** 不读取当前装备部位推断合法槽位：它可能正是被污染的字段。没有唯一语义结论就留待AI/玩家确认。 */
const destinations = (item: any, reference: string, player: boolean): string[] => {
    const slots: readonly string[] = player ? 装备槽位列表 : npcReviewEquipmentSlots;
    const text = `${item?.名称 || reference} ${item?.描述 || ''} ${item?.装备规则 || ''}`;
    if (special.test(text)) return [];
    if (Array.isArray(item?.允许装备槽位) && item.允许装备槽位.length > 1) return [];
    const explicit = item?.装备位置;
    if (item?.类型 === '武器' && explicit && typeof explicit === 'string' && !['主武器', '副武器', '暗器'].includes(explicit)) return [];
    if (['防具', '饰品', '服装', '上衣'].includes(item?.类型) && ['主武器', '副武器', '暗器'].includes(explicit)) return [];
    if (item?.类型 === '饰品' && explicit && typeof explicit === 'string' && !['腰部', '饰品', '头部'].includes(explicit)) return [];
    if (item?.类型 === '防具' && /短袖|T恤|衬衫|上衣/u.test(text) && explicit && !['胸部', '服装', '内衬', '内衣'].includes(explicit)) return [];
    if (typeof explicit === 'string' && slots.includes(explicit)) return [explicit];
    if (Array.isArray(explicit)) return []; // 多槽规则不按单槽归位处理。
    if (!player && typeof explicit === 'string') {
        const aliases: Record<string, string> = { 胸部: '服装', 足部: '鞋履', 内衬: '内衣', 腰部: '饰品' };
        if (aliases[explicit]) return [aliases[explicit]];
    }
    const targets = new Set<string>();
    if ((item?.类型 === '饰品' || !item && /(?:项链|颈链|吊坠)$/u.test(reference)) && /项链|颈链|吊坠/u.test(text)) targets.add(player ? '腰部' : '饰品');
    if ((!item && /(?:短袖|T恤|衬衫|上衣)$/u.test(reference) || item && /防具|上衣|服装|装备|防护装备/u.test(item.类型 || '')) && /短袖|T恤|衬衫|上衣/u.test(text)) targets.add(player ? '胸部' : '服装');
    if ((!item && /(?:运动鞋|布鞋|皮鞋|长靴|短靴|鞋履)$/u.test(reference) || item && /防具|鞋履|装备|防护装备/u.test(item.类型 || '')) && /运动鞋|布鞋|皮鞋|长靴|短靴|鞋履/u.test(text)) targets.add(player ? '足部' : '鞋履');
    // 禁止无类型的名称猜测覆盖明确相反的物品类型。
    return [...targets];
};
export const auditVariableReviewEquipment = (state: any): EquipmentReviewAudit => {
    const moves: EquipmentReviewMove[] = [], issues: EquipmentReviewAudit['issues'] = [];
    for (const owner of reviewEquipmentOwners(state)) {
        const targetReservations = new Set<string>();
        for (const [source, raw] of Object.entries(owner.equipment)) {
            if (emptyReviewEquipment(raw)) continue;
            const issue = (reason: string) => issues.push({ path: `${owner.root}.${source}`, description: `${owner.name}装备槽位无法安全确认：${reason}`, evidence: JSON.stringify(raw), reason });
            if (typeof raw !== 'string') { issue('旧装备记录不是物品引用，需要核对原始物品'); continue; }
            const matches = owner.items.filter((item: any) => item?.ID === raw || item?.id === raw || item?.名称 === raw);
            if (matches.length > 1) { issue('名称对应多件物品，不能合并或移动相似装备'); continue; }
            const item = matches[0];
            const candidates = destinations(item, raw, owner.player);
            const duplicates = Object.entries(owner.equipment).filter(([, ref]) => ref === raw);
            if (candidates.length !== 1) {
                const slots: readonly string[] = owner.player ? 装备槽位列表 : npcReviewEquipmentSlots;
                const weaponSlot = ['主武器', '副武器', '暗器'].includes(source);
                const typeConflict = item?.类型 === '武器' && !weaponSlot || item && ['防具', '饰品', '上衣', '服装'].includes(item.类型) && weaponSlot;
                if (duplicates.length > 1 || special.test(`${raw} ${item?.描述 || ''}`) || !slots.includes(source) || typeConflict || item?.装备位置 || item && !['武器', '防具', '饰品', '上衣', '服装'].includes(item.类型)) issue('无法从类型、描述及现有规则确定唯一归属；可能是特殊/多槽位装备，保留原装备');
                continue;
            }
            const target = candidates[0];
            if (source === target) continue;
            if (owner.player && !item) { issue('主角引用缺少唯一背包实体，不能凭空补建装备'); continue; }
            const targetValue = owner.equipment[target];
            const stableId = item?.ID || item?.id;
            const sameEntity = stableId && (targetValue === stableId || targetValue === item?.名称) && owner.items.filter((v: any) => v?.名称 === item.名称).length === 1;
            if (!emptyReviewEquipment(targetValue) && !sameEntity) { issue('正确槽位已有装备，或不能证明重复引用属于同一实体'); continue; }
            if (emptyReviewEquipment(targetValue) && targetReservations.has(target)) { issue('多件装备竞争同一目标槽位'); continue; }
            targetReservations.add(target);
            const commands: TavernCommand[] = [];
            if (emptyReviewEquipment(targetValue)) commands.push({ action: 'set', key: `${owner.root}.${target}`, value: raw });
            commands.push({ action: 'set', key: `${owner.root}.${source}`, value: '无' });
            moves.push({ root: owner.root, owner: owner.name, source, target, reference: raw, itemId: stableId, reason: '物品类型、描述或明确装备位置与原槽位不匹配；仅调整引用，不增加或丢弃物品', commands });
        }
    }
    return { moves, issues };
};
const equalCommand = (a: TavernCommand, b: TavernCommand) => path(a.key) === path(b.key) && a.action === b.action && a.value === b.value;
export const approvedEquipmentReviewMoves = (state: any, commands: TavernCommand[]) => auditVariableReviewEquipment(state).moves.filter(move =>
    move.commands.every(expected => commands.filter(command => path(command.key) === path(expected.key)).length === 1 && commands.some(command => equalCommand(command, expected)))
    && !commands.some(command => {
        const key = path(command.key), owner = move.root.replace(/\.(装备|当前装备)$/u, '');
        return key === owner || key === move.root || key.startsWith(`${owner}.${owner === '角色' ? '物品列表' : '背包'}`) || key.startsWith(`${owner}.物品列表`);
    }));
export const isApprovedEquipmentReviewCommand = (command: TavernCommand, moves: EquipmentReviewMove[]) => moves.some(move => move.commands.some(expected => equalCommand(command, expected)));
export const reviewEquipmentCommandIssue = (command: TavernCommand, state: any, batch: TavernCommand[], body = ''): string | undefined => {
    const key = path(command.key);
    if (/^(?:角色(?:\.物品列表|$)|社交(?:$|\[\d+\](?:\.(?:背包|物品列表)|$)))/u.test(key)) {
        const actor = reviewEquipmentOwners(state).find(owner => {
            const root = owner.root.replace(/\.(装备|当前装备)$/u, '');
            return key === root || key.startsWith(`${root}.${owner.player ? '物品列表' : '背包'}`) || key.startsWith(`${root}.物品列表`);
        });
        if (batch.some(other => {
            const otherKey = path(other.key);
            return /^(?:角色\.装备|社交\[\d+\]\.当前装备)\./u.test(otherKey) && (key === '社交' || actor && otherKey.startsWith(`${actor.root}.`));
        })) return '装备槽位核验不能同时替换人物或改写其背包数量、属性；请分开核对，避免资产丢失或重复';
    }
    if (!/^(?:角色\.装备|社交\[\d+\]\.当前装备)(?:\.|$)/u.test(key)) return;
    const audit = auditVariableReviewEquipment(state);
    if (isApprovedEquipmentReviewCommand(command, approvedEquipmentReviewMoves(state, batch))) return;
    if (/^(?:角色\.装备|社交\[\d+\]\.当前装备)$/u.test(key)) return '装备审查必须按具体槽位提出命令，不允许整栏替换或删除';
    // 既有正文明确换装仍走原保护；不把旧格式装备对象误判为无依据的槽位归位。
    const owner = reviewEquipmentOwners(state).find(person => key.startsWith(`${person.root}.`));
    const ref = typeof command.value === 'string' ? command.value : command.value?.ID || command.value?.名称;
    const existing = owner?.items.find((item: any) => item.ID === ref || item.名称 === ref);
    if (command.value && typeof command.value === 'object' && existing && Object.entries(command.value).some(([field, value]) =>
        !['是否装备', '当前装备部位'].includes(field) && JSON.stringify(value) !== JSON.stringify(existing[field]))) return '旧格式装备引用夹带了与背包实体不一致的属性，不允许借槽位修正改写装备';
    const quote = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const targetSlot = key.split('.').pop()!;
    const reference = (value: any) => typeof value === 'string' ? value : value?.ID || value?.id || value?.名称;
    const oldReference = reference(owner?.equipment[targetSlot]);
    const oldPreserved = emptyReviewEquipment(oldReference) || oldReference === ref || owner?.items.some((item: any) => item.ID === oldReference || item.名称 === oldReference);
    const otherSlot = owner && Object.entries(owner.equipment).some(([slot, value]) => slot !== targetSlot && !emptyReviewEquipment(value) && [ref, existing?.名称].filter(Boolean).includes(reference(value)));
    if (command.action === 'set' && existing && body.split(/[。！？\n]/u).some(sentence =>
        new RegExp(`(?:^|[，,；;])\\s*(?:${quote(owner!.name)}${owner!.player ? '|你|主角' : ''})(?:已经|刚刚|随后|又|缓缓|立即)?(?:收起[^，,。]{1,40}[，,]\\s*)?(?:换上|穿上|戴上|装备)[^。！？]{0,20}${quote(existing.名称)}`, 'u').test(sentence)
        && !/没有|并未|尚未|打算|准备|如果|可能|想要/u.test(sentence)) && oldPreserved && !otherSlot) return;
    if (command.action === 'delete' || emptyReviewEquipment(command.value) && owner && !emptyReviewEquipment(owner.equipment[key.split('.').pop()!])) return '清空装备必须属于验证完整的归位命令组，不能把装备错位当作冗余删除';
    if (audit.moves.some(move => move.commands.some(expected => path(expected.key) === key)) || owner && audit.issues.some(issue => issue.path.startsWith(`${owner.root}.`))) return '装备归位命令不完整、目标被占用或实体/特殊槽位不明确，保留原装备并待确认';
    return '装备修改尚无完整可核实的归位规则或明确换装事实，保留原装备并待确认，不能凭空增加或覆盖槽位引用';
};

/** 模拟后的资产守恒核对：槽位以外只允许主角物品的当前装备引用同步。 */
export const equipmentReviewSimulationIssue = (before: any, after: any, moves: EquipmentReviewMove[]): boolean => {
    for (const root of new Set(moves.map(move => move.root))) {
        const prior = reviewEquipmentOwners(before).find(owner => owner.root === root);
        const next = reviewEquipmentOwners(after).find(owner => owner.root === root);
        if (!prior || !next) return true;
        const expected = { ...prior.equipment };
        const relevant = moves.filter(move => move.root === root);
        for (const move of relevant) for (const command of move.commands) expected[command.key.split('.').pop()!] = command.value;
        if (JSON.stringify(Object.entries(expected).sort()) !== JSON.stringify(Object.entries(next.equipment).sort())) return true;
        const assets = (items: any[]) => items.map(item => { const { 当前装备部位, ...asset } = item; return asset; });
        if (JSON.stringify(assets(prior.items)) !== JSON.stringify(assets(next.items))) return true;
    }
    return false;
};
