import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as client from '../services/ai/chatCompletionClient';
import { auditVariableReviewEquipment, approvedEquipmentReviewMoves } from '../hooks/useGame/variableReviewEquipment';
import { runVariableReview } from '../hooks/useGame/variableReviewWorkflow';
import { createReviewRig, reviewOutput } from './helpers/variableReviewFixture';
vi.mock('../services/ai/chatCompletionClient', async original => ({ ...await original<typeof import('../services/ai/chatCompletionClient')>(), 请求模型文本: vi.fn() }));
beforeEach(() => vi.mocked(client.请求模型文本).mockReset());
const fixture = (player: boolean, source = '腰部', name = '浅橘色薄棉短袖', type = '防具', position = '胸部') => {
    const rig = createReviewRig('林岳和沈清辞在大厅休息。');
    const item = { ID: 'shirt-1', 名称: name, 类型: type, 装备位置: position, 描述: '日常穿着的普通装备', 堆叠数量: 1, 价值: 10, 当前装备部位: source };
    if (player) {
        rig.source.currentState.角色.装备 = { ...rig.source.currentState.角色.装备, [source]: item.ID };
        rig.source.currentState.角色.物品列表 = [item] as any;
    } else {
        rig.source.currentState.社交 = [{ id: 'NPC-A', 姓名: '沈清辞', 当前装备: { 服装: '无', 饰品: '无', 鞋履: '无', 主武器: '无', [source]: item.名称 }, 背包: [item] }] as any;
    }
    return { ...rig, item };
};
const run = async (rig: ReturnType<typeof fixture>, commands = auditVariableReviewEquipment(rig.source.currentState).moves.flatMap(move => move.commands)) => {
    vi.mocked(client.请求模型文本).mockResolvedValue(reviewOutput(commands));
    return runVariableReview(rig.source, rig.dependencies);
};
describe('装备槽位核验与资产守恒', () => {
    it.each([true, false])('主角/NPC短袖错位完整归位：player=%s', async player => {
        const rig = fixture(player, player ? '腰部' : '腰带');
        const before = structuredClone(rig.source.currentState);
        const audit = auditVariableReviewEquipment(before);
        expect(audit.moves).toHaveLength(1);
        expect(audit.moves[0].target).toBe(player ? '胸部' : '服装');
        const result = await run(rig);
        expect(result.acceptedCommands).toHaveLength(2);
        const equipment = player ? result.previewState.角色.装备 : result.previewState.社交[0].当前装备;
        expect(equipment[audit.moves[0].target]).toBe(player ? rig.item.ID : rig.item.名称);
        expect(equipment[player ? '腰部' : '腰带']).toBe('无');
        const items = player ? result.previewState.角色.物品列表 : result.previewState.社交[0].背包;
        expect(items).toHaveLength(1); expect(items[0].堆叠数量).toBe(1);
        expect(items[0].价值).toBe(10);
        expect(result.reconciled!.counts.cleanup).toBe(0);
        expect(result.reconciled!.counts.supplement).toBe(0);
        expect(result.reconciled!.counts.correction).toBeGreaterThan(0);
        expect(rig.source.currentState).toEqual(before);
    });
    it.each([
        ['饰品', '白色运动鞋', '防具', '足部', '鞋履'],
        ['主武器', '银色项链', '饰品', '', '饰品']
    ])('鞋/项链错位：%s', async (source, name, type, position, target) => {
        const rig = fixture(false, source, name, type, position);
        expect(auditVariableReviewEquipment(rig.source.currentState).moves[0].target).toBe(target);
        const result = await run(rig);
        expect(result.previewState.社交[0].当前装备[target]).toBe(name);
    });
    it('正确槽位不生成修正，目标有其它装备时只报告疑点', async () => {
        const correct = fixture(true, '胸部');
        expect(auditVariableReviewEquipment(correct.source.currentState).moves).toEqual([]);
        expect((await run(correct)).changes).toEqual([]);
        const occupied = fixture(false, '腰带');
        occupied.source.currentState.社交[0].当前装备.服装 = '蓝色外套';
        const result = await run(occupied);
        expect(result.changes).toEqual([]); expect(result.issues.some(issue => issue.description.includes('已有装备'))).toBe(true);
    });
    it('仅稳定实体重复引用可清空错槽，不合并相似名称不同物品', async () => {
        const rig = fixture(true);
        rig.source.currentState.角色.装备.胸部 = rig.item.ID;
        expect(auditVariableReviewEquipment(rig.source.currentState).moves[0].commands).toHaveLength(1);
        expect((await run(rig)).previewState.角色.装备.腰部).toBe('无');
        const distinct = fixture(true);
        distinct.source.currentState.角色.物品列表.push({ ...distinct.item, ID: 'shirt-2', 名称: '浅橘色薄棉短袖（备用）' } as any);
        distinct.source.currentState.角色.装备.胸部 = 'shirt-2';
        expect(auditVariableReviewEquipment(distinct.source.currentState).moves).toEqual([]);
        expect((await run(distinct)).previewState.角色.物品列表).toHaveLength(2);
    });
    it('特殊多槽装备和不明物品保持原状，性别不影响归位', async () => {
        const special = fixture(false, '腰带', '连体防护衣');
        special.item.描述 = '特殊多槽位装备，覆盖全身';
        special.source.currentState.社交[0].当前装备.服装 = special.item.名称;
        expect(auditVariableReviewEquipment(special.source.currentState).moves).toEqual([]);
        const result = await run(special); expect(result.changes).toEqual([]); expect(result.issues.length).toBeGreaterThan(0);
        const unclear = fixture(false, '腰带', '不明古物', '法宝', '');
        expect((await run(unclear)).issues.length).toBeGreaterThan(0);
        const male = fixture(false, '腰带'); male.source.currentState.社交[0].性别 = '男';
        expect((await run(male)).acceptedCommands).toHaveLength(2);
    });
    it('缺一半命令、写错引用、追加库存或覆盖目标不能通过归位例外', async () => {
        for (const variant of ['half', 'wrong', 'bag']) {
            const rig = fixture(true); const move = auditVariableReviewEquipment(rig.source.currentState).moves[0];
            const commands = variant === 'half' ? move.commands.slice(1) : structuredClone(move.commands);
            if (variant === 'wrong') commands[0].value = '新装备';
            if (variant === 'bag') commands.push({ action: 'push', key: '角色.物品列表', value: { ...rig.item, ID: 'new' } });
            expect(approvedEquipmentReviewMoves(rig.source.currentState, commands)).toEqual([]);
            const result = await run(rig, commands);
            expect(result.previewState.角色.装备.腰部).toBe(rig.item.ID);
        }
    });
    it('旧NPC只有名称引用亦可归位，不创建背包实体或新schema', async () => {
        const rig = fixture(false, '腰带'); rig.source.currentState.社交[0].背包 = [];
        const result = await run(rig);
        expect(result.acceptedCommands).toHaveLength(2);
        expect(result.previewState.社交[0].背包).toEqual([]);
        expect(Object.keys(result.previewState.社交[0].当前装备).sort()).toEqual(Object.keys(rig.source.currentState.社交[0].当前装备).sort());
    });
});

it('归位不放行物品属性/数量联动改写，装备引用保护也覆盖低价值清理', async () => {
    const rig = fixture(true); const audit = auditVariableReviewEquipment(rig.source.currentState);
    const commands = [...audit.moves[0].commands, { action: 'set' as const, key: '角色.物品列表[0].堆叠数量', value: 2 }];
    expect(approvedEquipmentReviewMoves(rig.source.currentState, commands)).toEqual([]);
    const result = await run(rig, commands);
    expect(result.previewState.角色.装备.腰部).toBe(rig.item.ID);
    expect(result.previewState.角色.物品列表[0].堆叠数量).toBe(1);
});
it('只有旧腰带键的NPC可写入现有schema服装槽，非新建存档字段体系', async () => {
    const rig = fixture(false, '腰带');
    rig.source.currentState.社交[0].当前装备 = { 腰带: rig.item.名称 } as any;
    rig.source.currentState.社交[0].背包 = [];
    const result = await run(rig);
    expect(result.acceptedCommands).toHaveLength(2);
    expect(result.previewState.社交[0].当前装备.服装).toBe(rig.item.名称);
});

it('裸名称NPC项链可归位；同名不同ID物品不按重复实体合并', async () => {
    const legacy = fixture(false, '主武器', '银色项链', '饰品', '');
    legacy.source.currentState.社交[0].背包 = [];
    expect((await run(legacy)).previewState.社交[0].当前装备.饰品).toBe('银色项链');
    const distinct = fixture(true);
    distinct.source.currentState.角色.物品列表.push({ ...distinct.item, ID: 'second' } as any);
    distinct.source.currentState.角色.装备.胸部 = 'second';
    expect(auditVariableReviewEquipment(distinct.source.currentState).moves).toEqual([]);
    expect((await run(distinct)).previewState.角色.物品列表).toHaveLength(2);
});
it('类型与装备位置冲突时不凭单字段强行归位', async () => {
    const rig = fixture(false, '腰带', '银色项链', '饰品', '足部');
    expect(auditVariableReviewEquipment(rig.source.currentState).moves).toEqual([]);
    expect((await run(rig)).changes).toEqual([]);
});

it('NPC归位混入删除背包命令时整组保留原装备和资产', async () => {
    const rig = fixture(false, '饰品');
    const move = auditVariableReviewEquipment(rig.source.currentState).moves[0];
    const commands = [...move.commands, { action: 'delete' as const, key: '社交[0].背包[0]', value: null }];
    const result = await run(rig, commands);
    expect(result.acceptedCommands).toEqual([]);
    expect(result.previewState.社交[0].背包).toHaveLength(1);
    expect(result.previewState.社交[0].当前装备.饰品).toBe(rig.item.名称);
});

it('正文明确NPC换装且新旧衣物均在背包时允许修正，旁观他人换装不算本人证据', async () => {
    const rig = fixture(false, '服装');
    const clothes = [{ 名称: rig.item.名称, 类型: '防具', 数量: 1, 描述: '日常上衣' }, { 名称: '蓝色衬衫', 类型: '防具', 数量: 1, 描述: '日常上衣' }];
    rig.source.currentState.社交[0].背包 = clothes as any;
    rig.source.history[1].structuredResponse!.logs[0].text = '沈清辞换上蓝色衬衫。';
    const command = { action: 'set' as const, key: '社交[0].当前装备.服装', value: '蓝色衬衫' };
    const result = await run(rig, [command]);
    expect(result.acceptedCommands).toHaveLength(1);
    expect(result.previewState.社交[0].当前装备.服装).toBe('蓝色衬衫');
    expect(result.previewState.社交[0].背包).toEqual(clothes);
    rig.source.history[1].structuredResponse!.logs[0].text = '沈清辞看着林岳换上蓝色衬衫。';
    expect((await run(rig, [command])).acceptedCommands).toEqual([]);
});

it('旧格式装备对象即使有换装正文，也不能夹带虚构属性', async () => {
    const rig = fixture(true);
    (rig.source.currentState.角色.装备 as any).武器 = { ID: 'old-sword', 名称: '铁剑', 类型: '武器' };
    rig.source.currentState.角色.物品列表.push({ ID: 'new-sword', 名称: '银月长剑', 类型: '武器', 攻击力: 3, 堆叠数量: 1 } as any);
    rig.source.history[1].structuredResponse!.logs[0].text = '林岳换上银月长剑。';
    const result = await run(rig, [{ action: 'set', key: '角色.装备.武器', value: { ID: 'new-sword', 名称: '银月长剑', 类型: '武器', 攻击力: 999 } }]);
    expect(result.acceptedCommands).toEqual([]);
    expect((result.previewState.角色.物品列表.find((item: any) => item.ID === 'new-sword') as any).攻击力).toBe(3);
});
