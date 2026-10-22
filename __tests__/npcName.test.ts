import { 收集主剧情已知对白说话人, 校验响应未改写既有NPC姓名 } from '../hooks/useGame/sendWorkflow';
import { 查找社交NPC索引 } from '../hooks/useGame/variableModelWorkflow';
import { describe, expect, it } from 'vitest';
import { normalizeNpcNameKey, isMultilingualNpcName, textMentionsNpcName } from '../utils/npcName';
import { 是否可信角色发送者, 规范化正文发送者名 } from '../utils/dialogueSpeakerGuard';
import { 规范化对白日志 } from '../utils/dialogueLogNormalizer';

describe('姓名匹配与显示分离', () => {
    it.each(['Alice', 'Emily Carter', 'Alex Morgan', 'Jean-Luc', "O'Connor", 'O’Connor', 'José Álvarez', 'Мария Иванова'])('保留 sender %s', name => {
        expect(isMultilingualNpcName(name)).toBe(true);
        expect(是否可信角色发送者(name)).toBe(true);
        expect(规范化正文发送者名(name)).toBe(name);
        expect(规范化对白日志([{ sender: name, text: '“你好。”' }]).map(log => log.sender)).toEqual([name]);
        expect(规范化对白日志([{ sender: '旁白', text: `【${name}】“你好。”` }]).some(log => log.sender === name)).toBe(true);
    });
    it('比较键归一化，不删除词间空格', () => {
        expect(normalizeNpcNameKey(' Emily  Carter ')).toBe('emily carter');
        expect(normalizeNpcNameKey('O’Connor')).toBe(normalizeNpcNameKey("O'Connor"));
        expect(normalizeNpcNameKey('José')).toBe(normalizeNpcNameKey('José'));
        expect(textMentionsNpcName('emily  carter arrived.', 'Emily Carter')).toBe(true);
        expect(textMentionsNpcName('随后Emily Carter走进大厅。', 'Emily Carter')).toBe(true);
        expect(textMentionsNpcName('Emily Carterson arrived.', 'Emily Carter')).toBe(false);
    });
    it.each(['Alice\nBob', '<Alice>', 'Alice=Bob', "O''Connor", 'Jean--Luc', 'A'.repeat(65)])('拒绝非法格式 %s', name => expect(isMultilingualNpcName(name)).toBe(false));
    it.each(['她轻声细语地', '只能强辩', '自己已经没有', '随着夜色降临'])('叙事短语不能作为 sender：%s', name => expect(是否可信角色发送者(name)).toBe(false));
});


it('已知角色名保持显示格式，审计和改名保护使用统一比较键', () => {
    const social = [{ 姓名: 'Emily Carter', 是否主要角色: true }, { 姓名: "O'Connor", 是否主要角色: true }];
    expect(收集主剧情已知对白说话人(undefined, social)).toEqual(['Emily Carter', "O'Connor"]);
    expect(查找社交NPC索引(social, 'emily carter')).toBe(0);
    expect(查找社交NPC索引(social, 'O’Connor')).toBe(1);
    expect(() => 校验响应未改写既有NPC姓名({ tavern_commands: [{ action: 'set', key: '社交[1].姓名', value: 'O’Connor' }] } as any, social, '')).not.toThrow();
});

it.each([['Alex', 'Alexander'], ['Ann', 'Anna']])('对白审计不会把 %s 匹配到 %s', (sender, name) => {
    expect(查找社交NPC索引([{ 姓名: name, 身份: sender, 简介: `${sender} is here` }], sender)).toBe(-1);
    expect(查找社交NPC索引([{ 姓名: name, 是否主要角色: true, 身份: sender }], sender)).toBe(-1);
    expect(查找社交NPC索引([{ 姓名: name }, { 姓名: sender }], sender)).toBe(1);
});
