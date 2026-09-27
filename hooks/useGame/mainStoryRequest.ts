import type {
    游戏设置结构,
    角色数据结构,
    聊天记录结构,
    记忆系统结构,
    内置提示词条目结构,
    世界书结构
} from '../../types';
import type { 当前可用接口结构 } from '../../utils/apiConfig';
import { 规范化游戏设置 } from '../../utils/gameSettings';
import { formatHistoryToScript } from './historyUtils';
import {
    构建COT伪装提示词,
    构建酒馆预设消息链,
    酒馆预设模式可用
} from './promptRuntime';
import { 构建剧情风格助手提示词 } from '../../prompts/runtime/storyStyles';
import { 构建真实世界模式提示词 } from '../../prompts/runtime/realWorldMode';
import { 构建运行时额外提示词 } from '../../prompts/runtime/nsfw';
import { 获取DeepSeek主剧情兼容提示词 } from '../../prompts/runtime/deepseekMode';
import { 获取GLM主剧情兼容提示词 } from '../../prompts/runtime/glmMode';
import {
    世界书本体槽位
} from '../../utils/worldbook';
import { 获取剧情风格内置槽位, 获取内置提示词槽位内容 } from '../../utils/builtinPrompts';
import { 按功能开关过滤提示词内容 } from '../../utils/promptFeatureToggles';
import { 包装繁体任务提示, 获取繁体输出指令 } from '../../utils/traditionalChinese';

export type 有序消息角色 = 'system' | 'user' | 'assistant';

export type 有序消息 = {
    role: 有序消息角色;
    content: string;
    prefix?: boolean;
};

type 主剧情上下文片段 = {
    AI角色声明: string;
    worldPrompt: string;
    地图建筑状态: string;
    同人设定摘要: string;
    境界体系提示词: string;
    离场NPC档案: string;
    otherPrompts: string;
    难度设置提示词: string;
    叙事人称提示词: string;
    字数设置提示词: string;
    长期记忆: string;
    中期记忆: string;
    在场NPC档案: string;
    剧情安排: string;
    女主剧情规划状态: string;
    世界状态: string;
    环境状态: string;
    角色状态: string;
    战斗状态: string;
    门派状态: string;
    任务状态: string;
    约定状态: string;
    COT提示词: string;
    格式提示词: string;
    文风提示词: string;
    字数要求提示词: string;
    免责声明输出提示词: string;
    输出协议提示词: string;
};

export type 主剧情系统上下文 = {
    shortMemoryContext: string;
    contextPieces: 主剧情上下文片段;
};

export type 主剧情消息条目 = {
    id: string;
    title: string;
    category: string;
    role: 有序消息角色;
    content: string;
    prefix?: boolean;
};

export type 主剧情请求构建结果 = {
    runtimeGameConfig: 游戏设置结构;
    tavernPresetModeEnabled: boolean;
    runtimeGptMode: boolean;
    runtimeCotPseudoEnabled: boolean;
    deepSeekMode: 游戏设置结构['主剧情消息模式'];
    deepSeekPrefixMode: boolean;
    glmPrefixMode: boolean;
    glmHTMLCommentThinking: boolean;
    lengthRequirementPrompt: string;
    disclaimerRequirementPrompt?: string;
    outputProtocolPrompt: string;
    styleAssistantPrompt: string;
    realWorldModePrompt: string;
    cotPseudoPrompt: string;
    messageEntries: 主剧情消息条目[];
    orderedMessages: 有序消息[];
    extraPromptForService: string;
};

const 角色标题前缀映射: Record<有序消息角色, string> = {
    system: '系统',
    user: '用户',
    assistant: '助手'
};

const 角色分类映射: Record<有序消息角色, string> = {
    system: '系统',
    user: '用户',
    assistant: '助手'
};

export const 构建主剧情请求参数 = (
    params: {
        gameConfig: 游戏设置结构;
        apiConfig: 接口设置结构扩展;
        builtContext: 主剧情系统上下文;
        updatedContextHistory: 聊天记录结构[];
        updatedMemSys: 记忆系统结构;
        sendInput: string;
        recallTag?: string;
        场外对话提示?: string;
        novelDecompositionPrompt?: string;
        playerRole?: 角色数据结构;
        builtinPromptEntries?: 内置提示词条目结构[];
        worldbooks?: 世界书结构[];
    }
): 主剧情请求构建结果 => {
    const runtimeGameConfig = 规范化游戏设置(params.gameConfig);
    const tavernPresetModeEnabled = 酒馆预设模式可用(runtimeGameConfig);
    const deepSeekMode = runtimeGameConfig.主剧情消息模式;
    const deepSeekMainModeEnabled = deepSeekMode === 'DeepSeek标准' || deepSeekMode === 'DeepSeek锁格式';
    const glmModeEnabled = deepSeekMode === 'GLM标准' || deepSeekMode === 'GLM锁格式';
    const runtimeGptMode = runtimeGameConfig.启用GPT模式 === true || runtimeGameConfig.主剧情消息模式 === 'GPT' || deepSeekMainModeEnabled || glmModeEnabled;
    const runtimeCotPseudoEnabled = (deepSeekMainModeEnabled || glmModeEnabled) ? false : runtimeGameConfig.启用COT伪装注入 !== false;
    const deepSeekPrefixMode = deepSeekMode === 'DeepSeek锁格式' && runtimeGameConfig.DeepSeek策略?.启用Prefix能力探测 !== false;
    const glmPrefixMode = deepSeekMode === 'GLM锁格式' && runtimeGameConfig.GLM策略?.启用Prefix能力探测 !== false;
    const glmHTMLCommentThinking = glmModeEnabled && runtimeGameConfig.GLM策略?.启用HTML注释思维链 !== false;
    const lengthRequirementPrompt = params.builtContext.contextPieces.字数要求提示词;
    const disclaimerRequirementPrompt = params.builtContext.contextPieces.免责声明输出提示词 || undefined;
    const outputProtocolPrompt = params.builtContext.contextPieces.输出协议提示词;
    const styleAssistantPrompt = 按功能开关过滤提示词内容(
        获取内置提示词槽位内容({
            entries: params.builtinPromptEntries,
            slotId: 获取剧情风格内置槽位('main', runtimeGameConfig.剧情风格, runtimeGameConfig?.NTL后宫档位),
            fallback: 构建剧情风格助手提示词(
                runtimeGameConfig.剧情风格,
                runtimeGameConfig?.NTL后宫档位,
                runtimeGameConfig
            )
        }),
        runtimeGameConfig
    );
    const realWorldModePrompt = runtimeGameConfig.启用真实世界模式 === true
        ? 获取内置提示词槽位内容({
            entries: params.builtinPromptEntries,
            slotId: 世界书本体槽位.真实世界模式,
            fallback: 构建真实世界模式提示词(runtimeGameConfig)
        })
        : '';
    const deepSeekModePrompt = 获取DeepSeek主剧情兼容提示词(runtimeGameConfig);
    const glmModePrompt = 获取GLM主剧情兼容提示词(runtimeGameConfig);
    const traditionalChinesePrompt = 获取繁体输出指令(runtimeGameConfig);
    const cotPseudoPrompt = runtimeCotPseudoEnabled
        ? 构建COT伪装提示词(
            runtimeGameConfig,
            params.builtContext.contextPieces.AI角色声明
        )
        : '';
    const normalizedRuntimeExtraPrompt = !tavernPresetModeEnabled
        ? 构建运行时额外提示词(runtimeGameConfig.额外提示词 || '', runtimeGameConfig)
        : '';
    const tavernRuntimeExtraPrompt = 构建运行时额外提示词(runtimeGameConfig.额外提示词 || '', runtimeGameConfig);
    const recallScriptAppend = params.recallTag ? `\n\n【剧情回忆】\n${params.recallTag}` : '';
    const scriptSectionText = `【即时剧情回顾】\n${formatHistoryToScript(params.updatedContextHistory) || '暂无'}${recallScriptAppend}`;
    const latestUserInputAsModel = 包装繁体任务提示([
        '以下是用户最新输入内容：',
        `<用户输入>${params.sendInput}</用户输入>`
    ].join('\n'), runtimeGameConfig);
    const latestUserInputForTavern = 包装繁体任务提示(
        params.recallTag
            ? `${params.sendInput}\n\n<剧情回忆>\n${params.recallTag}\n</剧情回忆>`
            : params.sendInput,
        runtimeGameConfig
    );
    const novelDecompositionPrompt = (params.novelDecompositionPrompt || '').trim();
    const messageEntries: 主剧情消息条目[] = [];

	    if (tavernPresetModeEnabled) {
	        // 酒馆模式：外部预设主导叙事提示词；玩家显式开启的最低字数与严格旁白/对白格式
	        // 作为硬约束例外保留。其他项目风格和免责声明仍不混入。
	        const tavernMessages = 构建酒馆预设消息链({
	            config: runtimeGameConfig,
	            context: params.builtContext,
	            chatHistory: params.updatedContextHistory,
	            latestUserInput: latestUserInputForTavern,
	            playerName: params.playerRole?.姓名 || '',
	            playerRole: params.playerRole,
		            worldbookExtraTexts: [
		                // 仅保留玩家显式设置的偏好和兼容性项
		                deepSeekModePrompt,           // DeepSeek 兼容格式（玩家主动选择）
		                glmModePrompt,                // GLM 兼容格式（玩家主动选择）
		                traditionalChinesePrompt,      // 繁体中文输出（玩家主动选择）
		                tavernRuntimeExtraPrompt,      // 玩家自定义额外提示词
		            ],
	            overrideStoryAppendPrompt: novelDecompositionPrompt
	        });
        tavernMessages.forEach((message, index) => {
            const trimmed = (message?.content || '').trim();
            if (!trimmed) return;
            const role = message.role as 有序消息角色;
            messageEntries.push({
                id: `tavern_message_${index + 1}`,
                title: `酒馆${角色标题前缀映射[role] || '消息'} ${index + 1}`,
                category: `酒馆${角色分类映射[role] || ''}`,
                role,
                content: trimmed
            });
        });
        const strictFormatPrompt = runtimeGameConfig.启用严格正文对白格式 !== false
            ? params.builtContext.contextPieces.格式提示词.trim()
            : '';
        const formatAlreadyInjected = Boolean(strictFormatPrompt)
            && tavernMessages.some((message) => (message?.content || '').includes(strictFormatPrompt));
        if (strictFormatPrompt && !formatAlreadyInjected) {
            messageEntries.push({
                id: 'tavern_format_requirement',
                title: '酒馆严格旁白/对白格式',
                category: '系统',
                role: 'system',
                content: strictFormatPrompt
            });
        }
        if (lengthRequirementPrompt.trim()) {
            messageEntries.push({
                id: 'tavern_length_requirement',
                title: '酒馆预设字数要求',
                category: '用户',
                role: 'user',
                content: lengthRequirementPrompt.trim()
            });
        }
        const tavernRoleChatPrompt = (params.场外对话提示 || '').trim();
        if (tavernRoleChatPrompt) {
            messageEntries.push({
                id: 'tavern_role_chat',
                title: '场外对话记录',
                category: '记忆',
                role: 'system',
                content: tavernRoleChatPrompt
            });
        }
    } else {
        const latestUserInputRole: 有序消息角色 = 'assistant';
        const pushEntry = (
            id: string,
            title: string,
            category: string,
            role: 有序消息角色,
            content: string,
            options?: { userInput?: boolean; prefix?: boolean }
        ) => {
            const raw = content || '';
            const normalizedContent = options?.prefix === true ? raw : raw.trim();
            if (normalizedContent.length === 0) return;
            const normalizedRole: 有序消息角色 = role;
            messageEntries.push({
                id,
                title,
                category,
                role: normalizedRole,
                content: normalizedContent,
                ...(options?.prefix === true ? { prefix: true } : {})
            });
        };

        pushEntry('narrative_constraint', '叙事约束', '系统', 'system', params.builtContext.contextPieces.叙事约束提示词 || '');
        pushEntry('ai_role', 'AI角色声明', '系统', 'system', params.builtContext.contextPieces.AI角色声明);
        pushEntry('world_prompt', '世界观提示词', '系统', 'system', params.builtContext.contextPieces.worldPrompt);
        pushEntry('world_map', '地图与空间锚点', '系统', 'system', params.builtContext.contextPieces.地图建筑状态);
        pushEntry('fandom_summary', '同人设定摘要', '系统', 'system', params.builtContext.contextPieces.同人设定摘要);
        pushEntry('realm_template', '境界体系提示词', '系统', 'system', params.builtContext.contextPieces.境界体系提示词);
        pushEntry('npc_away', '以下为不在场角色', '系统', 'system', params.builtContext.contextPieces.离场NPC档案);
        pushEntry('other_prompts', '叙事/规则提示词', '系统', 'system', params.builtContext.contextPieces.otherPrompts);
        pushEntry('difficulty_prompts', '难度设置提示词', '系统', 'system', params.builtContext.contextPieces.难度设置提示词);
        pushEntry('perspective_prompt', '叙事人称提示词', '系统', 'system', params.builtContext.contextPieces.叙事人称提示词);
        pushEntry('length_prompt', '字数要求提示词', '系统', 'system', params.builtContext.contextPieces.字数设置提示词);
        pushEntry('memory_long', '长期记忆', '记忆', 'system', params.builtContext.contextPieces.长期记忆);
        pushEntry('memory_mid', '中期记忆', '记忆', 'system', params.builtContext.contextPieces.中期记忆);
        pushEntry('story_plan', '剧情安排', '系统', 'system', params.builtContext.contextPieces.剧情安排);
        pushEntry('novel_decomposition', '小说分解注入', '系统', 'system', novelDecompositionPrompt);
        pushEntry('npc_present', '以下为在场角色', '系统', 'system', params.builtContext.contextPieces.在场NPC档案);
        pushEntry('heroine_plan', '女主剧情规划', '系统', 'system', params.builtContext.contextPieces.女主剧情规划状态);
        pushEntry('state_world', '世界', '系统', 'system', params.builtContext.contextPieces.世界状态);
        pushEntry('state_environment', '当前环境', '系统', 'system', params.builtContext.contextPieces.环境状态);
        pushEntry('state_role', '用户角色数据', '系统', 'system', params.builtContext.contextPieces.角色状态);
        pushEntry('state_battle', '战斗', '系统', 'system', params.builtContext.contextPieces.战斗状态);
        pushEntry('state_sect', '玩家门派', '系统', 'system', params.builtContext.contextPieces.门派状态);
        pushEntry('state_tasks', '任务列表', '系统', 'system', params.builtContext.contextPieces.任务状态);
        pushEntry('state_agreements', '约定列表', '系统', 'system', params.builtContext.contextPieces.约定状态);
        pushEntry('memory_short', '短期记忆', '记忆', 'system', params.builtContext.shortMemoryContext);

        // 场外对话（侧聊）暂存原文：紧贴短期记忆之后注入，主回合负责把对话写进正文并同步状态。
        pushEntry('role_chat', '场外对话记录', '记忆', 'system', params.场外对话提示 || '');

        pushEntry('script', '即时剧情回顾', '历史', 'system', scriptSectionText);
        pushEntry('style_assistant', '剧情风格助手消息', '系统', 'system', styleAssistantPrompt);
        pushEntry('real_world_mode', '真实世界模式消息', '系统', 'system', realWorldModePrompt);
        pushEntry('deepseek_mode', 'DeepSeek兼容模式', '系统', 'system', deepSeekModePrompt);
        pushEntry('glm_mode', 'GLM兼容模式', '系统', 'system', glmModePrompt);
        pushEntry('traditional_chinese', '繁体中文输出要求', '系统', 'system', traditionalChinesePrompt);
        pushEntry('extra_prompt', '额外要求提示词', '用户', 'user', normalizedRuntimeExtraPrompt);
        pushEntry('disclaimer_requirement', '免责声明输出要求', '用户', 'user', disclaimerRequirementPrompt || '');
        pushEntry('format_prompt', '输出格式提示词', '系统', 'system', params.builtContext.contextPieces.格式提示词);
        pushEntry('cot_core', 'COT提示词', '系统', 'system', params.builtContext.contextPieces.COT提示词);
        pushEntry(
            'length_requirement_final',
            '本回合硬性字数要求',
            '用户',
            'user',
            lengthRequirementPrompt
        );
        if (!runtimeGptMode) {
            pushEntry(
                'player_input_as_model',
                '最新用户输入（模型消息）',
                '助手',
                latestUserInputRole,
                latestUserInputAsModel,
                { userInput: true }
            );
        }
        pushEntry(
            'start_task',
            runtimeGptMode ? '本回合用户输入' : '开始任务',
            '用户',
            'user',
            runtimeGptMode ? 包装繁体任务提示(params.sendInput, runtimeGameConfig) : 包装繁体任务提示('开始任务', runtimeGameConfig)
        );
        if (runtimeCotPseudoEnabled) {
            pushEntry(
                'cot_fake_history',
                'COT伪装历史消息',
                '助手',
                'assistant',
                cotPseudoPrompt
            );
        }
        if (deepSeekPrefixMode) {
            pushEntry(
                'deepseek_prefix',
                'DeepSeek锁格式Prefix',
                '助手',
                'assistant',
                '<thinking>\n',
                { prefix: true }
            );
        }
        if (glmPrefixMode) {
            pushEntry(
                'glm_prefix',
                'GLM锁格式Prefix',
                '助手',
                'assistant',
                glmHTMLCommentThinking ? '<!-- \n' : '<thinking>\n',
                { prefix: true }
            );
        }
    }

    const orderedMessages = messageEntries.map((entry) => ({
        role: entry.role,
        content: entry.content,
        ...(entry.prefix === true ? { prefix: true } : {})
    }));

    return {
        runtimeGameConfig,
        tavernPresetModeEnabled,
        runtimeGptMode,
        runtimeCotPseudoEnabled,
        deepSeekMode,
        deepSeekPrefixMode,
        glmPrefixMode,
        glmHTMLCommentThinking,
        lengthRequirementPrompt,
        disclaimerRequirementPrompt,
        outputProtocolPrompt,
        styleAssistantPrompt,
        realWorldModePrompt,
        cotPseudoPrompt,
        messageEntries,
        orderedMessages,
        extraPromptForService: tavernPresetModeEnabled
            ? ''
            : normalizedRuntimeExtraPrompt
    };
};

type 接口设置结构扩展 = 当前可用接口结构 & {
    功能模型占位?: {
        剧情回忆独立模型开关?: boolean;
        剧情回忆完整原文条数N?: number;
    };
};
