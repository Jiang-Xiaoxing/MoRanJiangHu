import { beforeEach, describe, expect, it, vi } from 'vitest';

const rawReplyMock = vi.hoisted(() => vi.fn());
vi.mock('../services/ai/text', async () => {
    const actual = await vi.importActual<typeof import('../services/ai/text')>('../services/ai/text');
    return { ...actual, generateRoleChatRawReply: rawReplyMock };
});

import { 提取群聊流式正文, 解析群聊模型输出, 执行角色群聊, 构建群聊消息序列 } from '../hooks/useGame/groupRoleChatWorkflow';

const deps = () => ({
    apiConfig: {
        activeConfigId: 'base',
        configs: [{ id: 'base', 名称: '测试', 供应商: 'openai_compatible', baseUrl: 'https://example.test', apiKey: 'test-key', model: 'main' }],
        功能模型占位: {
            角色对话独立模型开关: true,
            角色对话使用模型: 'role-model',
            角色对话API地址: '',
            角色对话API密钥: '',
            角色对话提示词: ''
        }
    } as any,
    社交: [
        { id: 'npc-1', 姓名: '沈听澜', 是否在场: true, 当前位置: '药房', 记忆: [{ 内容: '只属于沈听澜的秘密' }] },
        { id: 'npc-2', 姓名: '老李', 是否在场: true, 当前位置: '药房', 记忆: [{ 内容: '只属于老李的秘密' }] }
    ],
    环境: { 大地点: '临安', 小地点: '仁心堂', 具体地点: '药房' },
    角色: { 姓名: '姜小星' },
    历史记录: [],
    prompts: []
});

beforeEach(() => rawReplyMock.mockReset());

describe('群聊模型输出解析', () => {
    it('正文和下一位调度分开解析', () => {
        const result = 解析群聊模型输出('<正文>先坐下。\n\n茶还热着。</正文>\n<调度>{"action":"continue","nextNpcId":"npc-2"}</调度>');
        expect(result).toEqual({
            正文: '先坐下。\n\n茶还热着。',
            动作: 'continue',
            下一位NPCId: 'npc-2',
            调度有效: true,
            完整: true
        });
    });

    it('调度缺失或损坏时保留正文并安全暂停', () => {
        const result = 解析群聊模型输出('<正文>我先说到这里。</正文><调度>{坏掉了}</调度>');
        expect(result.正文).toBe('我先说到这里。');
        expect(result.动作).toBe('wait');
        expect(result.调度有效).toBe(false);
    });

    it('未知调度动作不能被误当成有效等待', () => {
        const result = 解析群聊模型输出('<正文>先缓一缓。</正文><调度>{"action":"later","nextNpcId":"npc-2"}</调度>');
        expect(result.正文).toBe('先缓一缓。');
        expect(result.动作).toBe('wait');
        expect(result.调度有效).toBe(false);
    });

    it('流式显示永远不泄露调度标签', () => {
        expect(提取群聊流式正文('<正文>轮到老李了。</正文><调度>{"action":"continue"}'))
            .toBe('轮到老李了。');
    });

    it('模型重复打开正文标签时，正文不残留标签', () => {
        const result = 解析群聊模型输出('<正文>（拱手）今夜我值守阁楼，子时换灯。<正文>');
        expect(result.正文).toBe('（拱手）今夜我值守阁楼，子时换灯。');
        expect(result.动作).toBe('wait');
        expect(result.调度有效).toBe(false);
    });
});

describe('群聊消息块的缓存友好顺序', () => {
    const 参与者 = [
        { id: 'npc-1', 姓名: '沈听澜', 是否在场: true, 当前位置: '药房' },
        { id: 'npc-2', 姓名: '老李', 是否在场: true, 当前位置: '药房' }
    ];
    const 记录: any[] = [{ 会话类型: 'group', 群聊ID: 'g1', role: 'player', 发言人: '姜小星', 内容: '来了。', 时间: 1, 听众NPCIds: ['npc-1', 'npc-2'], 听众: ['沈听澜', '老李'], 完成状态: 'complete' }];

    it('角色档案放在最后一块，公共块在前，听到的群聊在档案之前', () => {
        const messages = 构建群聊消息序列(deps() as any, 参与者[0], 参与者, 'g1', 记录);
        const systems = messages.filter(item => item.role === 'system').map(item => item.content);
        expect(systems.at(-1)).toContain('你要扮演的角色');
        expect(systems.at(-2)).toContain('你实际听到的本次群聊');
        expect(systems[0]).toContain('角色对话');
        expect(systems[1]).toContain('群聊输出协议');
        expect(messages.at(-1)?.role).toBe('user');
    });

    it('换角色说话时，档案之前的所有块完全一致（前缀可复用）', () => {
        const a = 构建群聊消息序列(deps() as any, 参与者[0], 参与者, 'g1', 记录);
        const b = 构建群聊消息序列(deps() as any, 参与者[1], 参与者, 'g1', 记录);
        const prefixA = a.filter(item => item.role === 'system').slice(0, -1).map(item => item.content);
        const prefixB = b.filter(item => item.role === 'system').slice(0, -1).map(item => item.content);
        expect(prefixA).toEqual(prefixB);
        expect(a.filter(item => item.role === 'system').at(-1)?.content).not.toBe(b.filter(item => item.role === 'system').at(-1)?.content);
    });
});

describe('群聊长记录预算', () => {
    const 造记录 = (count: number) => Array.from({ length: count }).map((_, index) => ({
        会话类型: 'group' as const, 群聊ID: 'g-long', role: (index % 2 === 0 ? 'player' : 'npc') as 'player' | 'npc',
        npcId: index % 2 === 0 ? undefined : 'npc-2', 发言人: index % 2 === 0 ? '姜小星' : '老李',
        内容: `第${index + 1}条：药材已分好，先煎的摆在炉边。`, 时间: 1000 + index,
        听众NPCIds: ['npc-1', 'npc-2'], 听众: ['沈听澜', '老李'], 完成状态: 'complete' as const
    }));

    it('长记录只压一次，同一轮后面的角色直接复用', async () => {
        rawReplyMock
            .mockResolvedValueOnce('刚才在说分药材、看火候，还没定先煎哪几味。')
            .mockResolvedValueOnce('<正文>那就从柴胡开始。</正文><调度>{"action":"continue","nextNpcId":"npc-2"}</调度>')
            .mockResolvedValueOnce('<正文>成，我这就抓。</正文><调度>{"action":"wait","nextNpcId":""}</调度>');

        const result = await 执行角色群聊(deps() as any, {
            参与者NPCIds: ['npc-1', 'npc-2'], 玩家输入: '接着来。', 首位NPCId: 'npc-1',
            自动回复上限: 2, 已确认全部位置: true, 暂存对话: 造记录(40), 群聊ID: 'g-long'
        });

        expect(rawReplyMock).toHaveBeenCalledTimes(3);
        expect(result.摘要更新).toHaveLength(1);
        expect(result.摘要更新?.[0].内容).toContain('分药材');
        expect(result.摘要更新?.[0].补充课).toBeUndefined();
        const 摘要请求 = rawReplyMock.mock.calls[0][0].map((item: any) => item.content).join('\n');
        const 第二人请求 = rawReplyMock.mock.calls[2][0].map((item: any) => item.content).join('\n');
        expect(摘要请求).toContain('<新对话>');
        expect(第二人请求).toContain('更早的对话已摘要');
        expect(第二人请求).toContain('分药材');
        // 摘要之后不再把整段老记录塞进去
        expect(第二人请求).not.toContain('第1条：');
    });

    it('摘要调用失败时退回原文，聊天不断', async () => {
        rawReplyMock
            .mockRejectedValueOnce(new Error('summary down'))
            .mockResolvedValueOnce('<正文>那我们接着分药。</正文><调度>{"action":"wait","nextNpcId":""}</调度>');
        const result = await 执行角色群聊(deps() as any, {
            参与者NPCIds: ['npc-1', 'npc-2'], 玩家输入: '接着来。', 首位NPCId: 'npc-1',
            自动回复上限: 2, 已确认全部位置: true, 暂存对话: 造记录(40), 群聊ID: 'g-long'
        });
        expect(result.发言次数).toBe(1);
        expect(result.结束原因).toBe('model_wait');
        expect(result.摘要更新).toBeUndefined();
        const 发言请求 = rawReplyMock.mock.calls.at(-1)![0].map((item: any) => item.content).join('\n');
        expect(发言请求).toContain('第1条：');
    });

    it('中途加入的角色拿到补课摘要，而不是空记录', async () => {
        const 旧记录 = 造记录(6);
        rawReplyMock
            .mockResolvedValueOnce('刚才大家在商量怎么分药材、谁看火候。')
            .mockResolvedValueOnce('<正文>我在边上听了会儿，火候我来盯。</正文><调度>{"action":"wait","nextNpcId":""}</调度>');
        const depsWithNew = deps();
        (depsWithNew.社交 as any[]).push({ id: 'npc-3', 姓名: '苏晚', 是否在场: true, 当前位置: '药房' });
        const result = await 执行角色群聊(depsWithNew as any, {
            参与者NPCIds: ['npc-1', 'npc-3'], 玩家输入: '苏晚刚到。', 首位NPCId: 'npc-3',
            自动回复上限: 1, 已确认全部位置: true, 暂存对话: 旧记录, 群聊ID: 'g-long'
        });
        expect(result.摘要更新?.[0].补充课).toBe(true);
        const 补课请求 = rawReplyMock.mock.calls[0][0].map((item: any) => item.content).join('\n');
        expect(补课请求).toContain('刚走近');
        const 发言请求 = rawReplyMock.mock.calls[1][0].map((item: any) => item.content).join('\n');
        expect(发言请求).toContain('你刚走近');
    });
});

describe('发言顺序纠偏（不加模型调用）', () => {
    const 三人 = () => {
        const d = deps();
        (d.社交 as any[]).push({ id: 'npc-3', 姓名: '苏晚', 是否在场: true, 当前位置: '药房' });
        return d;
    };

    it('同一个人连说两轮后必须换人', async () => {
        rawReplyMock
            .mockResolvedValueOnce('<正文>我先说。</正文><调度>{"action":"continue","nextNpcId":"npc-2"}</调度>')
            .mockResolvedValueOnce('<正文>我再说一句。</正文><调度>{"action":"continue","nextNpcId":"npc-2"}</调度>')
            .mockResolvedValueOnce('<正文>还没说完。</正文><调度>{"action":"continue","nextNpcId":"npc-2"}</调度>')
            .mockResolvedValueOnce('<正文>那我也说。</正文><调度>{"action":"wait","nextNpcId":""}</调度>');
        const result = await 执行角色群聊(deps() as any, {
            参与者NPCIds: ['npc-1', 'npc-2'], 玩家输入: '你们说。', 首位NPCId: 'npc-1',
            自动回复上限: 4, 已确认全部位置: true
        });
        expect(result.新增消息.filter(item => item.role === 'npc').map(item => item.npcId))
            .toEqual(['npc-1', 'npc-2', 'npc-2', 'npc-1']);
        expect(result.调度纠偏次数).toBeGreaterThanOrEqual(1);
    });

    it('发言里点了谁，就让谁接话', async () => {
        rawReplyMock
            .mockResolvedValueOnce('<正文>老李，你来说说这药怎么抓。</正文><调度>{"action":"continue","nextNpcId":"npc-3"}</调度>')
            .mockResolvedValueOnce('<正文>好，我来说。</正文><调度>{"action":"wait","nextNpcId":""}</调度>');
        const result = await 执行角色群聊(三人() as any, {
            参与者NPCIds: ['npc-1', 'npc-2', 'npc-3'], 玩家输入: '你们商量下。', 首位NPCId: 'npc-1',
            自动回复上限: 3, 已确认全部位置: true
        });
        expect(result.新增消息.filter(item => item.role === 'npc')[1]?.npcId).toBe('npc-2');
        expect(result.调度纠偏次数).toBe(1);
    });

    it('有人被晾着两轮，就强行把话递过去', async () => {
        [
            '<正文>我先起个头。</正文><调度>{"action":"continue","nextNpcId":"npc-2"}</调度>',
            '<正文>我说两句。</正文><调度>{"action":"continue","nextNpcId":"npc-1"}</调度>',
            '<正文>我再补一句。</正文><调度>{"action":"continue","nextNpcId":"npc-2"}</调度>',
            '<正文>成，那就这样。</正文><调度>{"action":"continue","nextNpcId":"npc-1"}</调度>',
            '<正文>好，继续。</正文><调度>{"action":"wait","nextNpcId":""}</调度>'
        ].forEach(text => rawReplyMock.mockResolvedValueOnce(text));
        const result = await 执行角色群聊(三人() as any, {
            参与者NPCIds: ['npc-1', 'npc-2', 'npc-3'], 玩家输入: '你们商量。', 首位NPCId: 'npc-1',
            自动回复上限: 5, 已确认全部位置: true
        });
        expect(result.新增消息.some(item => item.npcId === 'npc-3')).toBe(true);
        expect((result.发言分布 || {})['苏晚']).toBeGreaterThan(0);
    });

    it('发言分布如实回报，末位与首位差距不超过规定', async () => {
        [
            '<正文>一。</正文><调度>{"action":"continue","nextNpcId":"npc-2"}</调度>',
            '<正文>二。</正文><调度>{"action":"continue","nextNpcId":"npc-2"}</调度>',
            '<正文>三。</正文><调度>{"action":"continue","nextNpcId":"npc-2"}</调度>',
            '<正文>四。</正文><调度>{"action":"continue","nextNpcId":"npc-2"}</调度>',
            '<正文>五。</正文><调度>{"action":"continue","nextNpcId":"npc-2"}</调度>',
            '<正文>六。</正文><调度>{"action":"wait","nextNpcId":""}</调度>'
        ].forEach(text => rawReplyMock.mockResolvedValueOnce(text));
        const result = await 执行角色群聊(三人() as any, {
            参与者NPCIds: ['npc-1', 'npc-2', 'npc-3'], 玩家输入: '你们商量。', 首位NPCId: 'npc-1',
            自动回复上限: 6, 已确认全部位置: true
        });
        const values = Object.values(result.发言分布 || {}).map(Number);
        expect(result.发言次数).toBe(6);
        expect(Math.max(...values) - Math.min(...values)).toBeLessThanOrEqual(2);
    });
});

describe('群聊自动接话', () => {
    it('同一模型逐人请求，尊重下一位调度和回复上限，并保存听众快照', async () => {
        rawReplyMock
            .mockResolvedValueOnce('<正文>先听老李怎么说。</正文><调度>{"action":"continue","nextNpcId":"npc-2"}</调度>')
            .mockResolvedValueOnce('<正文>我看此事可行。</正文><调度>{"action":"continue","nextNpcId":"npc-1"}</调度>')
            .mockResolvedValueOnce('<正文>那便如此。</正文><调度>{"action":"wait","nextNpcId":""}</调度>');

        const result = await 执行角色群聊(deps() as any, {
            参与者NPCIds: ['npc-1', 'npc-2'], 玩家输入: '你们怎么看？', 首位NPCId: 'npc-1',
            自动回复上限: 3, 已确认全部位置: true
        });

        expect(rawReplyMock).toHaveBeenCalledTimes(3);
        expect(result.发言次数).toBe(3);
        expect(result.结束原因).toBe('model_wait');
        expect(result.新增消息).toHaveLength(4);
        expect(result.新增消息.every(item => item.听众NPCIds?.join(',') === 'npc-1,npc-2')).toBe(true);
        const firstPrompt = rawReplyMock.mock.calls[0][0].map((item: any) => item.content).join('\n');
        expect(firstPrompt).toContain('只属于沈听澜的秘密');
        expect(firstPrompt).not.toContain('只属于老李的秘密');
    });

    it('调度字段缺失时由程序接手选下一位，整场不再断掉', async () => {
        rawReplyMock
            .mockResolvedValueOnce('<正文>我说完了，你们接着说。</正文>')
            .mockResolvedValueOnce('<正文>那我补一句。</正文><调度>{"action":"wait","nextNpcId":""}</调度>');
        const result = await 执行角色群聊(deps() as any, {
            参与者NPCIds: ['npc-1', 'npc-2'], 玩家输入: '开始吧。', 首位NPCId: 'npc-1',
            自动回复上限: 3, 已确认全部位置: true
        });
        expect(rawReplyMock).toHaveBeenCalledTimes(2);
        expect(result.发言次数).toBe(2);
        expect(result.结束原因).toBe('model_wait');
        expect(result.调度降级次数).toBe(1);
        // 程序接手时挑了另一个还没说话的角色，而不是把话又塞回刚说完的人
        const secondPrompt = rawReplyMock.mock.calls[1][0].map((item: any) => item.content).join('\n');
        expect(secondPrompt).toContain('只属于老李的秘密');
        expect(result.新增消息.map(item => item.内容)).toEqual(['开始吧。', '我说完了，你们接着说。', '那我补一句。']);
    });

    it('名单外的下一位同样由程序接手，不触发报错也不多请求', async () => {
        rawReplyMock
            .mockResolvedValueOnce('<正文>我说完了。</正文><调度>{"action":"continue","nextNpcId":"npc-outside"}</调度>')
            .mockResolvedValueOnce('<正文>轮到我。</正文><调度>{"action":"continue","nextNpcId":"npc-1"}</调度>')
            .mockResolvedValueOnce('<正文>说完了。</正文><调度>{"action":"wait","nextNpcId":""}</调度>');
        const result = await 执行角色群聊(deps() as any, {
            参与者NPCIds: ['npc-1', 'npc-2'], 玩家输入: '开始吧。', 首位NPCId: 'npc-1',
            自动回复上限: 3, 已确认全部位置: true
        });
        expect(rawReplyMock).toHaveBeenCalledTimes(3);
        expect(result.结束原因).toBe('model_wait');
        expect(result.调度降级次数).toBe(1);
        expect(result.新增消息.at(-1)?.内容).toBe('说完了。');
    });

    it('调度持续失效时才停下来，并如实报告降级次数', async () => {
        rawReplyMock.mockResolvedValue('<正文>我说完了。</正文>');
        const result = await 执行角色群聊(deps() as any, {
            参与者NPCIds: ['npc-1', 'npc-2'], 玩家输入: '开始吧。', 首位NPCId: 'npc-1',
            自动回复上限: 6, 已确认全部位置: true
        });
        // 允许连续 2 次由程序接手，第 3 次仍失效才停
        expect(rawReplyMock).toHaveBeenCalledTimes(3);
        expect(result.结束原因).toBe('invalid_scheduler');
        expect(result.调度降级次数).toBe(3);
        expect(result.发言次数).toBe(3);
    });

    it('一直报名单外的下一人时，同样按连续失效上限停下', async () => {
        rawReplyMock.mockResolvedValue('<正文>我说完了。</正文><调度>{"action":"continue","nextNpcId":"小二"}</调度>');
        const result = await 执行角色群聊(deps() as any, {
            参与者NPCIds: ['npc-1', 'npc-2'], 玩家输入: '开始吧。', 首位NPCId: 'npc-1',
            自动回复上限: 6, 已确认全部位置: true
        });
        expect(rawReplyMock).toHaveBeenCalledTimes(3);
        expect(result.结束原因).toBe('invalid_scheduler');
        expect(result.调度降级次数).toBe(3);
    });

    it('后续请求失败时保留已经完成的角色发言', async () => {
        rawReplyMock
            .mockResolvedValueOnce('<正文>第一句已经说完。</正文><调度>{"action":"continue","nextNpcId":"npc-2"}</调度>')
            .mockRejectedValueOnce(new Error('network down'));
        const result = await 执行角色群聊(deps() as any, {
            参与者NPCIds: ['npc-1', 'npc-2'], 玩家输入: '继续。', 自动回复上限: 3, 已确认全部位置: true
        });
        expect(result.结束原因).toBe('request_error');
        expect(result.新增消息.map(item => item.内容)).toContain('第一句已经说完。');
    });

    it('后续角色返回空正文时同样保留已完成发言并安全暂停', async () => {
        rawReplyMock
            .mockResolvedValueOnce('<正文>第一句已经说完。</正文><调度>{"action":"continue","nextNpcId":"npc-2"}</调度>')
            .mockResolvedValueOnce('<调度>{"action":"wait","nextNpcId":""}</调度>');
        const result = await 执行角色群聊(deps() as any, {
            参与者NPCIds: ['npc-1', 'npc-2'], 玩家输入: '继续。', 自动回复上限: 3, 已确认全部位置: true
        });
        expect(result.结束原因).toBe('request_error');
        expect(result.新增消息.map(item => item.内容)).toContain('第一句已经说完。');
    });
});
