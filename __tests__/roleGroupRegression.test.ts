import { beforeEach, describe, expect, it, vi } from 'vitest';

const 单聊回复Mock = vi.hoisted(() => vi.fn());
vi.mock('../services/ai/text', async () => {
    const actual = await vi.importActual<typeof import('../services/ai/text')>('../services/ai/text');
    return { ...actual, generateRoleChatReply: 单聊回复Mock };
});

import { 执行角色对话, 规范化场外对话列表, 构建场外对话记录块 } from '../hooks/useGame/roleChatWorkflow';
import { 判断角色对话位置 } from '../utils/roleChatLocation';

const deps = () => ({
    apiConfig: {
        activeConfigId: 'base',
        configs: [{ id: 'base', 名称: '测试', 供应商: 'openai_compatible', baseUrl: 'https://x.test', apiKey: 'k', model: 'm' }],
        功能模型占位: {
            角色对话独立模型开关: true, 角色对话使用模型: 'role-model',
            角色对话API地址: '', 角色对话API密钥: '', 角色对话提示词: ''
        }
    } as any,
    社交: [
        { id: 'npc-1', 姓名: '沈听澜', 是否在场: true, 当前位置: '药房', 记忆: [] },
        { id: 'npc-9', 姓名: '城外的货郎', 是否在场: false, 当前位置: '城外' }
    ],
    环境: { 大时间: '辰时', 大地点: '临安', 中地点: '仁心堂', 小地点: '药房', 具体地点: '药房' },
    角色: { 姓名: '姜小星' },
    历史记录: [],
    memoryConfig: {},
    prompts: []
});

beforeEach(() => 单聊回复Mock.mockReset());

describe('回归一：单聊不带群聊协议', () => {
    it('单聊请求里没有群聊输出协议，也没有群聊记录块', async () => {
        单聊回复Mock.mockResolvedValueOnce('她在柜台后抬头看你一眼。');
        await 执行角色对话(deps() as any, {
            npcId: 'npc-1', 玩家输入: '今日风大。', 已确认位置: true
        } as any);
        expect(单聊回复Mock).toHaveBeenCalledTimes(1);
        const 全文 = 单聊回复Mock.mock.calls[0][0].map((m: any) => m.content).join('\n');
        expect(全文).not.toContain('<群聊输出协议>');
        expect(全文).not.toContain('你实际听到的本次群聊');
        expect(全文).not.toContain('<调度>');
    });
});

describe('回归二：存档读写不丢场外对话（PR92 老 bug）', () => {
    it('序列化 → 反序列化后，群聊ID、听众、摘要都还在', () => {
        const 原记录 = [{
            会话类型: 'group' as const, 群聊ID: 'g-pr92', role: 'npc' as const, npcId: 'npc-1', 发言人: '沈听澜',
            内容: '药引是城南捎来的红糖。', 时间: 1000,
            听众NPCIds: ['npc-1', 'npc-2'], 听众: ['沈听澜', '老李'], 完成状态: 'complete' as const,
            群聊摘要: [{ 听众键: 'npc-1|npc-2', 覆盖到时间: 1000, 内容: '【要点】\n· 城南红糖', 生成时间: 5, 事实: ['药引是城南捎来的红糖'], 概述: '在备药。' }]
        }];
        const 往返 = 规范化场外对话列表(JSON.parse(JSON.stringify(原记录)));
        expect(往返).toHaveLength(1);
        expect(往返[0].群聊ID).toBe('g-pr92');
        expect(往返[0].听众NPCIds).toEqual(['npc-1', 'npc-2']);
        expect(往返[0].群聊摘要?.[0]?.事实).toEqual(['药引是城南捎来的红糖']);
        expect(往返[0].群聊摘要?.[0]?.听众键).toBe('npc-1|npc-2');
    });
});

describe('回归三：主线场外注入格式', () => {
    it('注入文本带发言人、在场听众与注入指令', () => {
        const 文本 = 构建场外对话记录块([{
            会话类型: 'group', 群聊ID: 'g1', role: 'npc', npcId: 'npc-1', 发言人: '沈听澜',
            内容: '药我已经配好。', 时间: 1000, 听众NPCIds: ['npc-1', 'npc-2'], 听众: ['沈听澜', '老李'], 完成状态: 'complete'
        }]);
        expect(文本).toContain('【沈听澜｜在场听众：沈听澜、老李】');
        expect(文本).toContain('药我已经配好。');
        expect(文本.length).toBeGreaterThan(10);
    });

    it('没有场外对话时不产生注入块', () => {
        expect(构建场外对话记录块([])).toBe('');
    });
});

describe('回归四：距离判断不能静默放行', () => {
    it('不在附近的角色会被拦或要求确认', () => {
        const 远处 = { id: 'npc-9', 姓名: '城外的货郎', 是否在场: false, 当前位置: '城外' };
        const 结果 = 判断角色对话位置(远处 as any, deps().环境 as any);
        expect(结果.可选 && !结果.需要确认).toBe(false);
        expect(String(结果.原因 || '').length).toBeGreaterThan(0);
    });

    it('就在同一地点的角色可以直接聊', () => {
        const 近处 = { id: 'npc-1', 姓名: '沈听澜', 是否在场: true, 当前位置: '药房' };
        const 结果 = 判断角色对话位置(近处 as any, deps().环境 as any);
        expect(结果.可选).toBe(true);
    });
});
