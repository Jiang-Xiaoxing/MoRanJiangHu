import { describe, expect, it } from 'vitest';
import { 构建空正文结束原因错误, 规范化文本补全消息链, type 通用消息 } from '../services/ai/chatCompletionClient';
import { 构建酒馆预设消息链 } from '../hooks/useGame/promptRuntime';

describe('空正文 finish_reason 语义化（酒馆预设 200 空内容修复）', () => {
    it('安全类结束原因给出审核拦截提示且不可重试', () => {
        const err = 构建空正文结束原因错误('SAFETY');
        expect(err).not.toBeNull();
        expect(err?.message).toContain('安全策略拦截');
        expect(err?.message).toContain('SAFETY');
        expect(err?.message).toContain('酒馆预设');
    });

    it('兼容 OpenAI 风格 content_filter 与 Gemini 原生 RECITATION/PROHIBITED_CONTENT/BLOCKLIST/SPII', () => {
        for (const reason of ['content_filter', 'RECITATION', 'PROHIBITED_CONTENT', 'BLOCKLIST', 'SPII', 'FINISH_REASON_SAFETY']) {
            const err = 构建空正文结束原因错误(reason);
            expect(err, reason).not.toBeNull();
            expect(err?.message, reason).toContain('安全策略拦截');
        }
    });

    it('长度类结束原因提示调大 max_tokens', () => {
        const err = 构建空正文结束原因错误('length');
        expect(err?.message).toContain('finish_reason=length');
        expect(err?.message).toContain('最大输出 Token');
        expect(构建空正文结束原因错误('MAX_TOKENS')?.message).toContain('最大输出 Token');
    });

    it('正常停止原因不接手（交给上层通用空内容路径）', () => {
        for (const reason of ['stop', 'STOP', 'tool_calls', 'end_turn', '']) {
            expect(构建空正文结束原因错误(reason), reason).toBeNull();
        }
    });

    it('未知名结束原因保留可重试的通用空内容措辞', () => {
        const err = 构建空正文结束原因错误('OTHER');
        expect(err?.message).toContain('模型返回了空内容');
        expect(err?.message).toContain('finish_reason=OTHER');
    });
});

describe('消息链尾部 system 防御', () => {
    it('尾部 system 转为 user，避免上游 200 空内容', () => {
        const messages: 通用消息[] = [
            { role: 'system', content: '规则' },
            { role: 'user', content: '输入' },
            { role: 'system', content: '尾部注入' }
        ];
        const normalized = 规范化文本补全消息链(messages, {
            保留System: true,
            合并同角色: false,
            尾部System转User: true
        });
        expect(normalized.at(-1)?.role).toBe('user');
        expect(normalized[0]?.role).toBe('system');
    });

    it('尾部 assistant prefix 保持原样（生成引导不是待回复输入）', () => {
        const messages: 通用消息[] = [
            { role: 'user', content: '输入' },
            { role: 'assistant', content: '<thinking>', prefix: true }
        ];
        const normalized = 规范化文本补全消息链(messages, {
            保留System: true,
            合并同角色: false,
            尾部System转User: true
        });
        expect(normalized.at(-1)?.role).toBe('assistant');
        expect(normalized.at(-1)?.prefix).toBe(true);
    });

    it('不开启选项时行为不变', () => {
        const messages: 通用消息[] = [
            { role: 'user', content: '输入' },
            { role: 'system', content: '尾部注入' }
        ];
        const normalized = 规范化文本补全消息链(messages, { 保留System: true, 合并同角色: false });
        expect(normalized.at(-1)?.role).toBe('system');
    });
});

// ─── instruct 角色序列回归 ───

const ctx = () => ({
    shortMemoryContext: '短期记忆文本',
    contextPieces: {
        worldPrompt: '世界观文本',
        地图建筑状态: '',
        同人设定摘要: '',
        境界体系提示词: '',
        otherPrompts: '核心规则文本',
        难度设置提示词: '',
        叙事人称提示词: '',
        字数设置提示词: '',
        COT提示词: '',
        格式提示词: '格式提示文本',
        文风提示词: '',
        离场NPC档案: '',
        长期记忆: '',
        中期记忆: '',
        在场NPC档案: '在场NPC文本',
        剧情安排: '',
        女主剧情规划状态: '',
        世界状态: '',
        环境状态: '环境文本',
        角色状态: '角色文本',
        战斗状态: '',
        门派状态: '',
        任务状态: '',
        约定状态: '',
    },
});

const 基础提示词 = [
    { identifier: 'main', name: 'Main', role: 'system', content: '你是主持人。' },
    { identifier: 'worldInfoBefore', name: 'WI', role: 'system', content: '{{worldInfoBefore}}' },
    { identifier: 'chatHistory', name: 'History', role: 'system', content: '' },
    { identifier: 'userInput', name: 'Input', role: 'user', content: '{{userInput}}' },
];

const 顺序 = [
    { identifier: 'main', enabled: true },
    { identifier: 'worldInfoBefore', enabled: true },
    { identifier: 'chatHistory', enabled: true },
    { identifier: 'userInput', enabled: true },
];

const 历史 = [
    { role: 'user', content: '我走进客栈。', timestamp: 1 },
    { role: 'assistant', content: '你走进了客栈大堂。', timestamp: 2 },
];

const 跑 = (instruct, 后处理 = "未选择") => {
    const preset = {
        prompts: 基础提示词,
        prompt_order: [{ character_id: 100001, order: 顺序 }],
        ...(instruct ? { instruct } : {}),
    } as any;
    return 构建酒馆预设消息链({
        config: { 启用酒馆预设模式: true, 酒馆预设: preset, 酒馆预设角色ID: 100001, 酒馆提示词后处理: (后处理 || '未选择') as any } as any,
        context: ctx() as any,
        chatHistory: 历史 as any,
        latestUserInput: '我向掌柜打听消息。',
        playerName: '杨培强',
        playerRole: null,
    });
};

describe('instruct 包装后角色序列（R5/R6 回归）', () => {
    it('last_input_sequence 与 input_sequence 不一致时，最后一条仍是 user', () => {
        const messages = 跑({ input_sequence: '[INST]', output_sequence: '[/INST]', system_sequence: '<<SYS>>', last_input_sequence: '<|user|>' });
        expect(messages.at(-1)?.role).toBe('user');
        expect(messages.at(-1)?.content).toContain('我向掌柜打听消息');
    });

    it('system_same_as_user 时 system 消息保持 system 角色', () => {
        const messages = 跑({ input_sequence: '<|user|>', output_sequence: '<|assistant|>', system_same_as_user: true });
        expect(messages[0]?.role).toBe('system');
        expect(messages.at(-1)?.role).toBe('user');
    });

    it('ChatML / Llama2 / 无 instruct 的角色序列保持正确', () => {
        expect(跑({ input_sequence: '<|user|>', output_sequence: '<|assistant|>', system_sequence: '<|system|>' }).map((m) => m.role))
            .toEqual(['system', 'user', 'assistant', 'user']);
        expect(跑({ input_sequence: '[INST]', output_sequence: '[/INST]', system_sequence: '<<SYS>>' }).map((m) => m.role))
            .toEqual(['system', 'user', 'assistant', 'user']);
        expect(跑(null).map((m) => m.role))
            .toEqual(['system', 'user', 'assistant', 'user']);
    });
});
