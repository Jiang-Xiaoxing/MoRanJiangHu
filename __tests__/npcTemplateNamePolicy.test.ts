import { describe, expect, it } from 'vitest';
import { 提取命中新女性角色姓名黑名单 } from '../utils/femaleNameSelector';
import { 提取命中模板姓名黑名单 } from '../utils/templateNameBlacklist';
import { collectTrustedNpcCharacters, playerExplicitlySpecifiesNpcName } from '../utils/npcTemplateNamePolicy';
import { 校验响应未命中模板姓名黑名单 } from '../hooks/useGame/sendWorkflow';

const names = ['苏婉清', '赵灵儿', '赵平安', '林砚舟', '辛夷'];
const blocked = (params: any) => [
    ...提取命中新女性角色姓名黑名单(params), ...提取命中模板姓名黑名单(params)
];
const push = (姓名: string, extra = {}) => ({ action: 'push', key: '社交', value: { id: `npc-${姓名}`, 姓名, ...extra } });

describe('模板姓名只拦截 AI 自由创造的新角色', () => {
    it.each(names)('无来源的新角色 %s 仍拦截', name => expect(blocked({ commands: [push(name)] })).toEqual([name]));
    it.each(names)('已有 %s 更新、重复 push、整槽更新均豁免', name => {
        const npc = { id: `npc-${name}`, 姓名: name };
        for (const command of [
            { action: 'set', key: '社交[0].好感度', value: 20 },
            push(name), { action: 'set', key: '社交[0]', value: npc },
            { action: 'set', key: '社交[0].姓名', value: name },
            { action: 'set', key: '社交', value: [npc] }
        ]) expect(blocked({ commands: [command], currentSocial: [npc] })).toEqual([]);
        expect(blocked({ response: { logs: [{ sender: name, text: '你好' }] }, currentSocial: [npc] })).toEqual([]);
    });
    it('整数组重排按已有身份判断，不比较同索引姓名', () => {
        const currentSocial = names.map(姓名 => ({ id: `npc-${姓名}`, 姓名 }));
        expect(blocked({ currentSocial, commands: [{ action: 'set', key: '社交', value: [...currentSocial].reverse() }] })).toEqual([]);
    });
    it('重排中混入真正的新黑名单角色仍拦截', () => {
        expect(blocked({ currentSocial: [{ 姓名: '赵平安' }], commands: [{ action: 'set', key: '社交', value: [{ 姓名: '苏婉清' }, { 姓名: '赵平安' }] }] })).toEqual(['苏婉清']);
    });
    it.each(names)('规范化命令路径以及 add %s 也遵守来源规则', name => {
        expect(blocked({ commands: [{ ...push(name), action: 'add', key: '*社交*' }] })).toEqual([name]);
        expect(blocked({ commands: [{ ...push(name), key: 'gameState.社交' }], currentSocial: [{ 姓名: name }] })).toEqual([]);
    });
    it.each([
        ['新增一个角色，名字叫苏婉清', '苏婉清'],
        ['新增一个女性角色，名字叫苏婉清。', '苏婉清'],
        ['创建一个叫赵平安的人物', '赵平安'],
        ['加入一个叫林砚舟的人', '林砚舟'],
        ['新角色叫赵灵儿', '赵灵儿'],
        ['让苏婉清进来', '苏婉清'],
        ['不要修改云韵的名字', '云韵'],
        ['添加辛夷', '辛夷'],
        ['姓名是“赵平安”', '赵平安'],
        ['新增角色，命名为苏婉清', '苏婉清']
    ])('明确指令“%s”豁免 %s', (playerInput, name) => {
        expect(playerExplicitlySpecifiesNpcName(playerInput, name)).toBe(true);
        expect(blocked({ playerInput, commands: [push(name)] })).toEqual([]);
    });
    it.each([
        '我敲了敲门：“苏婉清，在吗？”', '我想起苏婉清。', '苏婉清这个名字很常见',
        '我听说她的名字叫苏婉清', '他告诉我：“新角色叫苏婉清。”',
        '不要创建一个叫苏婉清的人', '不要把新角色叫苏婉清',
        '新增一个角色，名字叫苏婉清清', '如果创建一个叫苏婉清的人会怎样？'
    ])('普通引用、否定或非执行意图不自动豁免：%s', playerInput => {
        expect(blocked({ playerInput, commands: [push('苏婉清')] })).toEqual(['苏婉清']);
    });
    it('可信档案与已确认曾用名豁免；AI 自称原著角色不豁免', () => {
        expect(blocked({ trustedCharacters: [{ id: 'canon', 名称: '赵灵儿' }], commands: [push('赵灵儿')] })).toEqual([]);
        expect(blocked({ currentSocial: [{ id: 'old', 姓名: '江婉', 曾用名: ['苏婉清'] }], commands: [push('苏婉清', { id: 'old' })] })).toEqual([]);
        expect(blocked({ commands: [push('苏婉清', { 原著角色: true, 同人角色: true })] })).toEqual(['苏婉清']);
        expect(blocked({ currentSocial: [{ id: 'old', 姓名: '江婉' }], commands: [push('苏婉清', { id: 'old' })] })).toEqual(['苏婉清']);
    });
    it('已有玩家档案、世界活跃角色、门派和开局伙伴来自检查前可信来源', () => {
        const trustedCharacters = collectTrustedNpcCharacters({
            角色: { 姓名: '赵平安' }, 世界: { 活跃NPC列表: [{ 姓名: '林砚舟' }] },
            玩家门派: { 重要成员: [{ 姓名: '辛夷' }] }, 同人女主剧情规划: { 女主条目: [{ 女主姓名: '赵灵儿' }] }
        }, { 初始伙伴列表: [{ 姓名: '苏婉清', enabled: true }, { 姓名: '沈清婉', enabled: false }] } as any);
        expect(blocked({ trustedCharacters, commands: names.map(name => push(name)) })).toEqual([]);
        expect(blocked({ trustedCharacters, commands: [push('沈清婉')] })).toEqual(['沈清婉']);
    });
    it.each(names)('开局和普通回合响应检查对 %s 使用同一语义', name => {
        const response = { logs: [{ sender: name, text: '你好' }], tavern_commands: [push(name)] } as any;
        for (const stage of ['开局主剧情', '主剧情']) {
            expect(() => 校验响应未命中模板姓名黑名单(response, '', stage)).toThrow('模板姓名黑名单');
            expect(() => 校验响应未命中模板姓名黑名单(response, '', stage, { currentSocial: [{ 姓名: name }] })).not.toThrow();
            expect(() => 校验响应未命中模板姓名黑名单(response, '', stage, { playerInput: `新角色叫${name}` })).not.toThrow();
        }
    });
});
