import type { 场外对话消息结构, 群聊摘要条目 } from '../../types';
import { 获取角色对话接口配置, 接口配置是否可用 } from '../../utils/apiConfig';
import { 判断角色对话位置 } from '../../utils/roleChatLocation';
import { generateRoleChatRawReply, 清理角色对话输出 } from '../../services/ai/text';
import { 默认角色对话提示词 } from '../../prompts/runtime/defaults';
import {
    执行角色对话请求带超时,
    序列化NPC档案,
    序列化当前情境,
    序列化眼前的人,
    序列化江湖常识,
    规范化场外对话列表,
    解析目标NPC,
    type 角色对话依赖
} from './roleChatWorkflow';
import { 执行带完整性校验的请求 } from './streamIntegrity';
import {
    构建群聊记录视图,
    构建摘要请求,
    合并摘要事实,
    拆分摘要事实,
    渲染摘要条目,
    解析摘要输出,
    需要生成摘要,
    type 群聊记录视图
} from './groupChatTranscriptBudget';

type 通用消息结构 = { role: 'system' | 'user' | 'assistant'; content: string };

export type 群聊调度动作 = 'continue' | 'wait' | 'stop';

export type 群聊模型输出 = {
    正文: string;
    动作: 群聊调度动作;
    下一位NPCId?: string;
    调度有效: boolean;
    完整: boolean;
};

export type 角色群聊参数 = {
    参与者NPCIds: string[];
    玩家输入: string;
    继续群聊?: boolean;
    首位NPCId?: string;
    群聊ID?: string;
    自动回复上限?: number;
    暂存对话?: 场外对话消息结构[];
    已确认全部位置?: boolean;
    signal?: AbortSignal;
    onTurnDelta?: (payload: { npcId: string; npcName: string; text: string }) => void;
    onTurnComplete?: (payload: { message: 场外对话消息结构; turnIndex: number }) => void;
    shouldStopAfterTurn?: () => boolean;
};

export type 角色群聊结果 = {
    groupId: string;
    新增消息: 场外对话消息结构[];
    发言次数: number;
    结束原因: 'model_wait' | 'model_stop' | 'limit' | 'invalid_scheduler' | 'stopped' | 'request_error';
    /** 调度失效时由程序接手选人的次数；正常结束也可能带值，用于观察模型调度能力。 */
    调度降级次数?: number;
    /** 模型给的下一位违反“点名/冷板凳/连说上限”被程序改写的次数。 */
    调度纠偏次数?: number;
    /** 本轮各角色发言次数，用于观察轮转是否均衡。 */
    发言分布?: Record<string, number>;
    /** 本轮新生成的长记录摘要，调用方需要写回群聊记录，下一轮直接复用。 */
    摘要更新?: 群聊摘要条目[];
};

/** 允许连续由程序接手选人的次数上限；超过后说明模型调度持续失效，本轮安全停止。 */
const 调度降级上限 = 2;

const 取文本 = (value: unknown): string => typeof value === 'string' ? value.trim() : '';
const 取NPCId = (npc: any): string => 取文本(npc?.id) || 取文本(npc?.姓名);

const 去思考块 = (text: string): string => String(text || '')
    .replace(/<thinking>[\s\S]*?<\/thinking>/gi, '')
    .replace(/<think>[\s\S]*?<\/think>/gi, '');

export const 提取群聊流式正文 = (raw: string): string => {
    const cleaned = 去思考块(raw);
    const openIndex = cleaned.toLowerCase().lastIndexOf('<正文>');
    let body = openIndex >= 0 ? cleaned.slice(openIndex + '<正文>'.length) : cleaned;
    const closeIndex = body.toLowerCase().indexOf('</正文>');
    if (closeIndex >= 0) body = body.slice(0, closeIndex);
    const schedulerIndex = body.toLowerCase().indexOf('<调度>');
    if (schedulerIndex >= 0) body = body.slice(0, schedulerIndex);
    return body.trim();
};

export const 解析群聊模型输出 = (raw: string): 群聊模型输出 => {
    const text = 去思考块(raw);
    const bodyMatch = Array.from(text.matchAll(/<正文>([\s\S]*?)<\/正文>/gi)).at(-1);
    const 正文 = (bodyMatch?.[1] || 清理角色对话输出(text.replace(/<调度>[\s\S]*$/i, ''))).trim();
    const schedulerMatch = Array.from(text.matchAll(/<调度>([\s\S]*?)<\/调度>/gi)).at(-1);
    if (!schedulerMatch) {
        return { 正文, 动作: 'wait', 调度有效: false, 完整: Boolean(bodyMatch) };
    }
    try {
        const value = JSON.parse(schedulerMatch[1].trim());
        const actionValid = value?.action === 'continue' || value?.action === 'wait' || value?.action === 'stop';
        const action: 群聊调度动作 = actionValid ? value.action : 'wait';
        const nextNpcId = 取文本(value?.nextNpcId || value?.nextNpcName);
        const valid = actionValid && (action !== 'continue' || Boolean(nextNpcId));
        return {
            正文,
            动作: valid ? action : 'wait',
            ...(nextNpcId ? { 下一位NPCId: nextNpcId } : {}),
            调度有效: valid,
            完整: true
        };
    } catch {
        return { 正文, 动作: 'wait', 调度有效: false, 完整: Boolean(bodyMatch) };
    }
};

const 找被点名者 = (participants: any[], input: string): any | undefined => {
    const text = 取文本(input);
    if (!text) return undefined;
    return participants
        .slice()
        .sort((a, b) => 取文本(b?.姓名).length - 取文本(a?.姓名).length)
        .find(npc => 取文本(npc?.姓名) && text.includes(取文本(npc?.姓名)));
};

const 取最久没说话者 = (participants: any[], transcript: 场外对话消息结构[]): any | undefined => {
    if (!participants.length) return undefined;
    const lastSpoken = new Map<string, number>();
    transcript.forEach((item, index) => {
        if (item.role === 'npc' && item.npcId) lastSpoken.set(item.npcId, index);
    });
    return participants.slice().sort((a, b) => {
        const aIndex = lastSpoken.get(取NPCId(a)) ?? -1;
        const bIndex = lastSpoken.get(取NPCId(b)) ?? -1;
        return aIndex - bIndex;
    })[0];
};

const 选择首位发言者 = (participants: any[], input: string, preferredId: string, history: 场外对话消息结构[]): any => {
    if (preferredId) {
        const preferred = participants.find(npc => 取NPCId(npc) === preferredId);
        if (preferred) return preferred;
    }
    const mentioned = 找被点名者(participants, input);
    if (mentioned) return mentioned;
    return 取最久没说话者(participants, history);
};

/**
 * 调度字段失效时由程序接手选下一位：被点名的优先，其次是最久没说话的。
 * 尽量不把话说回刚说完的人，除非名单里没有别人。
 */
const 选择兜底发言者 = (
    participants: any[],
    transcript: 场外对话消息结构[],
    input: string,
    currentNpcId: string
): any | undefined => {
    if (!participants.length) return undefined;
    const others = participants.filter(npc => 取NPCId(npc) !== currentNpcId);
    const candidates = others.length ? others : participants.slice();
    const mentioned = 找被点名者(candidates, input);
    if (mentioned) return mentioned;
    return 取最久没说话者(candidates, transcript);
};

const 取最近玩家发言 = (transcript: 场外对话消息结构[]): string => {
    for (let index = transcript.length - 1; index >= 0; index -= 1) {
        if (transcript[index]?.role === 'player') return 取文本(transcript[index]?.内容);
    }
    return '';
};

/** 同一角色最多连说几轮；到顶必须换人。 */
export const 连续发言上限 = 2;

export type 轮转统计 = {
    发言次数: Map<string, number>;
    连续发言: { npcId: string; 次数: number };
    总发言次数: number;
};

export const 新建轮转统计 = (): 轮转统计 => ({
    发言次数: new Map<string, number>(),
    连续发言: { npcId: '', 次数: 0 },
    总发言次数: 0
});

export const 记录一次发言 = (统计: 轮转统计, npcId: string): void => {
    统计.发言次数.set(npcId, (统计.发言次数.get(npcId) || 0) + 1);
    统计.总发言次数 += 1;
    统计.连续发言 = 统计.连续发言.npcId === npcId
        ? { npcId, 次数: 统计.连续发言.次数 + 1 }
        : { npcId, 次数: 1 };
};

/**
 * 发言顺序纠偏：纯程序，不额外调用模型。
 * 三条规矩（用户 2026-10-22 定）：
 *  1. 被点名的人优先接话；
 *  2. 坐冷板凳的（发言次数明显落后）优先；
 *  3. 一个人不能连着说太多轮（上限 2）。
 * 模型选 wait / stop 属于真实意图，不进这里。
 */
export const 纠偏下一位 = (params: {
    participants: any[];
    当前NpcId: string;
    模型建议?: any;
    最近发言: string;
    玩家输入: string;
    统计: 轮转统计;
    历史: 场外对话消息结构[];
}): { next?: any; 纠偏: boolean; 原因?: '点名优先' | '连续发言上限' | '冷板凳优先' } => {
    const { participants, 当前NpcId, 模型建议, 统计 } = params;
    const 其他人 = participants.filter(npc => 取NPCId(npc) !== 当前NpcId);
    const 池 = (其他人.length ? 其他人 : participants.slice());
    const 建议Id = 模型建议 ? 取NPCId(模型建议) : '';

    // 规矩 1：本条发言或玩家刚说的话里点了谁，就让谁接。
    // 这一条**有意**优先于规矩 3 的连说上限：玩家亲口点名时，他的即时意图应当压过轮转均衡。
    // 连说上限是用来防“演员兼导演式霸麦”的，不是用来违逆玩家指令的（PR #112 review 第 4 条确认）。
    const 被点名 = 找被点名者(池, `${params.最近发言}\n${params.玩家输入}`);
    if (被点名 && 取NPCId(被点名) !== 建议Id) {
        return { next: 被点名, 纠偏: true, 原因: '点名优先' };
    }

    // 规矩 3：连说到达上限就必须换人
    const 建议会连说 = 建议Id && 统计.连续发言.npcId === 建议Id ? 统计.连续发言.次数 : 0;
    if (模型建议 && 建议会连说 >= 连续发言上限) {
        const 候选 = 取最久没说话者(池.filter(npc => 取NPCId(npc) !== 建议Id), params.历史) || 取最久没说话者(池, params.历史);
        if (候选) return { next: 候选, 纠偏: true, 原因: '连续发言上限' };
    }

    // 规矩 2：有人明显被晾着（比别人少说 2 次以上），先给他
    // 差距要按全体算，不能只算“除当前发言者之外的池子”，否则刚连说的人被排除后差距永远看不出来。
    const 次数 = (npc: any) => 统计.发言次数.get(取NPCId(npc)) || 0;
    const 最少 = Math.min(...participants.map(次数));
    const 最多 = Math.max(...participants.map(次数));
    const 冷板凳 = 池.filter(npc => 次数(npc) === 最少 && 取NPCId(npc) !== 建议Id);
    if (最多 - 最少 >= 2 && 冷板凳.length > 0) {
        const 候选 = 取最久没说话者(冷板凳, params.历史);
        if (候选) return { next: 候选, 纠偏: true, 原因: '冷板凳优先' };
    }

    return { next: 模型建议, 纠偏: false };
};

/**
 * 把「比摘要更早的那批可见消息」压成一份摘要。一次调用只压一次，结果随记录复用。
 * 失败时返回 null，调用方退回原文，不让聊天因为摘要挂掉而中断。
 */
const 生成群聊记录摘要 = async (
    npc: any,
    view: 群聊记录视图,
    roleChatApi: any,
    signal?: AbortSignal
): Promise<群聊摘要条目 | null> => {
    if (view.待摘要消息.length === 0) return null;
    const messages = 构建摘要请求(view, { 角色名: 取文本(npc?.姓名) });
    const raw = await 执行角色对话请求带超时(
        async (innerSignal, _onDelta, 进入非流式重试) => {
            // 摘要会被写进事实清单，而事实清单只做并集、不删；截断的半句一旦入库就是永久污染，
            // 所以这里和「群聊发言」走同一套完整性校验，而不是只靠外层空闲超时。
            const 完整性结果 = await 执行带完整性校验的请求({
                功能名: '群聊记录摘要',
                发起流式请求: (streamOptions) => generateRoleChatRawReply(messages as any, roleChatApi, {
                    signal: innerSignal,
                    temperature: 0.2,
                    streamOptions: {
                        stream: true,
                        onDelta: () => {},
                        onStreamEnd: streamOptions.onStreamEnd
                    }
                }),
                发起非流式请求: () => generateRoleChatRawReply(messages as any, roleChatApi, { signal: innerSignal, temperature: 0.2 }),
                重试前重置超时: 进入非流式重试,
                重试失败处置: '抛出错误'
            });
            return 完整性结果.结果;
        },
        signal,
        { 中断时保留部分: false }
    );
    const 解析 = 解析摘要输出(raw);
    // 事实清单由程序做并集，不信任模型“重写”，否则对话越长早期细节越容易丢。
    const 旧事实 = [...(view.摘要?.早期事实 || []), ...(view.摘要?.事实 || [])];
    const 合并后 = 合并摘要事实(旧事实, 解析.事实);
    const { 最近, 早期 } = 拆分摘要事实(合并后);
    const 概述 = 解析.概述 || 取文本(清理角色对话输出(raw));
    const 内容 = 渲染摘要条目(最近, 概述, 早期) || 取文本(清理角色对话输出(raw));
    const 覆盖到时间 = view.待摘要消息.at(-1)?.时间 ?? 0;
    if (!内容 || !覆盖到时间) return null;
    return {
        群聊ID: view.群聊ID,
        听众键: view.听众键,
        覆盖到时间,
        内容,
        生成时间: Date.now(),
        ...(最近.length > 0 ? { 事实: 最近 } : {}),
        ...(早期.length > 0 ? { 早期事实: 早期 } : {}),
        ...(概述 ? { 概述 } : {}),
        ...(view.需要补课 ? { 补充课: true } : {})
    };
};

export const 构建群聊消息序列 = (
    deps: 角色对话依赖,
    npc: any,
    participants: any[],
    groupId: string,
    transcript: 场外对话消息结构[],
    options?: { 记录文本?: string }
): 通用消息结构[] => {
    const npcId = 取NPCId(npc);
    const roster = participants.map(item => `${取NPCId(item)}=${取文本(item?.姓名) || '未知人物'}`).join('；');
    const publicTranscript = typeof options?.记录文本 === 'string'
        ? options.记录文本
        : transcript
            .filter(item => item.会话类型 === 'group' && item.群聊ID === groupId)
            .filter(item => Array.isArray(item.听众NPCIds) && item.听众NPCIds.includes(npcId))
            .slice(-80)
            .map(item => `【${item.发言人}】${item.内容}`)
            .join('\n');
    const customPrompt = 取文本((deps.apiConfig as any)?.功能模型占位?.角色对话提示词);
    const mandatoryProtocol = `<群聊输出协议>
你只扮演下方“你要扮演的角色”指定的一名 NPC。先以这个角色的有限认知完成一条自然发言，再以客观调度员身份建议下一位。
调度只能依据公开对话、是否被点名、是否需要回应及是否该等待玩家；不得把本角色的私人记忆当作调度理由。
本协议要求的 <正文>/<调度> 标签格式，优先于「角色对话协议」中“禁止输出标签”的限制。
必须严格输出：
<正文>角色说的话；完整意思之间用空行分段</正文>
<调度>{"action":"continue|wait|stop","nextNpcId":"继续时填写参与者ID，否则留空"}</调度>
不得输出其他文字，不得安排名单外人物。若玩家需要回应，action=wait。</群聊输出协议>`;
    // 块顺序按“缓存前缀”排：公共且稳定的在最前，只与当前发言角色有关的角色档案放最后。
    // 原先角色档案夹在“你实际听到的群聊”（最肥的一块）前面，导致这块每轮都命中不了缓存。
    const blocks = [
        customPrompt || 默认角色对话提示词,
        mandatoryProtocol,
        序列化江湖常识(deps.prompts) ? `## 江湖常识\n${序列化江湖常识(deps.prompts)}` : '',
        `## 当前情境\n${序列化当前情境(deps.环境)}`,
        `## 本群聊参与者（固定名单）\n${roster}`,
        `## 眼前的人\n${序列化眼前的人(participants, deps.角色)}`,
        `## 你实际听到的本次群聊\n${publicTranscript || '（暂无）'}`,
        `## 你要扮演的角色（ID：${npcId}）\n${序列化NPC档案(npc)}`
    ].filter(Boolean);
    return [
        ...blocks.map(content => ({ role: 'system' as const, content })),
        { role: 'user', content: '现在轮到你发言。只按群聊输出协议作答。' }
    ];
};

export const 执行角色群聊 = async (deps: 角色对话依赖, params: 角色群聊参数): Promise<角色群聊结果> => {
    const participantIds = Array.from(new Set(params.参与者NPCIds.map(取文本).filter(Boolean)));
    if (participantIds.length < 2) throw new Error('群聊至少需要选择两名角色。');
    const participants = participantIds
        .map(id => 解析目标NPC(deps.社交, { npcId: id, npcName: id }))
        .filter(Boolean);
    if (participants.length !== participantIds.length) throw new Error('群聊成员已经变化，请重新选择。');
    for (const npc of participants) {
        const check = 判断角色对话位置(npc, deps.环境);
        if (!check.可选) throw new Error(check.原因);
        if (check.需要确认 && params.已确认全部位置 !== true) {
            throw new Error('请先确认所有群聊成员都在附近并能听见。');
        }
    }
    const roleChatApi = 获取角色对话接口配置(deps.apiConfig);
    if (!接口配置是否可用(roleChatApi)) {
        throw new Error('角色对话独立模型未配置：请到 设置 → 角色对话 开启独立模型并选择模型。');
    }
    const playerInput = 取文本(params.玩家输入);
    if (!playerInput && params.继续群聊 !== true) throw new Error('输入内容为空。');
    if (params.继续群聊 === true && !取文本(params.群聊ID)) throw new Error('当前没有可继续的群聊。');
    const groupId = 取文本(params.群聊ID) || `role-group-${Date.now().toString(36)}`;
    const limit = Math.min(6, Math.max(1, Number(params.自动回复上限) || 3));
    const audienceIds = participants.map(取NPCId);
    const audienceNames = participants.map(npc => 取文本(npc?.姓名) || 取NPCId(npc));
    const history = 规范化场外对话列表(params.暂存对话);
    const newMessages: 场外对话消息结构[] = params.继续群聊 === true ? [] : [{
        会话类型: 'group', 群聊ID: groupId, role: 'player',
        发言人: 取文本(deps.角色?.姓名) || '玩家', 内容: playerInput, 时间: Date.now(),
        听众NPCIds: audienceIds, 听众: audienceNames, 完成状态: 'complete'
    }];
    let current = 选择首位发言者(
        participants,
        playerInput,
        取文本(params.首位NPCId),
        history.filter(item => item.会话类型 === 'group' && item.群聊ID === groupId)
    );
    let endReason: 角色群聊结果['结束原因'] = 'limit';
    let 调度降级次数 = 0;
    let 连续降级次数 = 0;
    let 调度纠偏次数 = 0;
    const 轮转 = 新建轮转统计();
    const 摘要更新: 群聊摘要条目[] = [];

    for (let index = 0; index < limit; index += 1) {
        if (params.signal?.aborted) throw params.signal.reason ?? new DOMException('请求已取消', 'AbortError');
        const npcId = 取NPCId(current);
        const npcName = 取文本(current?.姓名) || npcId;
        const 现有记录 = [...history, ...newMessages];
        // 群聊记录预算：最近几条原文 + 更早的摘要；摘要只在变长时生成一次，本轮内其他角色直接复用。
        let 记录文本: string | undefined;
        try {
            let 视图: 群聊记录视图 = 构建群聊记录视图(现有记录, { groupId, npcId, audienceIds, extraSummaries: 摘要更新 });
            if (需要生成摘要(视图) || 视图.需要补课) {
                const 条目 = await 生成群聊记录摘要(current, 视图, roleChatApi, params.signal);
                if (条目) {
                    摘要更新.push(条目);
                    视图 = 构建群聊记录视图(现有记录, { groupId, npcId, audienceIds, extraSummaries: 摘要更新 });
                }
            }
            记录文本 = 视图.渲染;
        } catch {
            // 摘要失败不影响发言：退回整段原文。
            记录文本 = undefined;
        }
        const messages = 构建群聊消息序列(deps, current, participants, groupId, 现有记录, { 记录文本 });
        let raw = '';
        try {
            raw = await 执行角色对话请求带超时(
                async (signal, onDelta, 进入非流式重试) => {
                    // 与角色对话同源的风险：空闲超时挡不住「快速断流」，
                    // 半截发言会被当成完整发言（`解析群聊模型输出` 只看 <正文> 是否闭合）。
                    const 完整性结果 = await 执行带完整性校验的请求({
                        功能名: '群聊发言',
                        发起流式请求: (streamOptions) => generateRoleChatRawReply(messages, roleChatApi as any, {
                            signal,
                            streamOptions: {
                                stream: true,
                                onDelta: (_delta, accumulated) => {
                                    onDelta(_delta, accumulated);
                                    params.onTurnDelta?.({ npcId, npcName, text: 提取群聊流式正文(accumulated) });
                                },
                                onStreamEnd: streamOptions.onStreamEnd
                            }
                        }),
                        发起非流式请求: () => generateRoleChatRawReply(messages, roleChatApi as any, { signal }),
                        // 重试前把外层超时器切回首响应预算，否则非流式重试会被流式空闲计时器掐断。
                        重试前重置超时: 进入非流式重试,
                        // 重试也失败时不能把上一次的截断发言当完整发言返回。
                        重试失败处置: '抛出错误',
                        onFallback: (info) => {
                            console.warn('[群聊] 流式输出疑似被上游中断，降级为非流式重新生成', info);
                        }
                    });
                    return 完整性结果.结果;
                },
                params.signal,
                { 中断时保留部分: true }
            );
        } catch (error) {
            if (params.signal?.aborted) { endReason = 'stopped'; break; }
            if (newMessages.some(item => item.role === 'npc')) { endReason = 'request_error'; break; }
            throw error;
        }
        const parsed = 解析群聊模型输出(raw);
        if (!parsed.正文) {
            // 已经有角色说完时，按“后续请求失败”处理：保留已完成发言并安全暂停，
            // 而不是抛错导致整批（含前面已完成的发言）都进不了暂存。
            if (newMessages.some(item => item.role === 'npc')) { endReason = 'request_error'; break; }
            throw new Error(`${npcName}返回了空回复。`);
        }
        const npcMessage: 场外对话消息结构 = {
            会话类型: 'group', 群聊ID: groupId, npcId, role: 'npc', 发言人: npcName,
            内容: parsed.正文, 时间: Date.now(), 听众NPCIds: audienceIds, 听众: audienceNames,
            完成状态: parsed.完整 ? 'complete' : 'partial'
        };
        newMessages.push(npcMessage);
        记录一次发言(轮转, npcId);
        params.onTurnComplete?.({ message: npcMessage, turnIndex: index });
        if (params.shouldStopAfterTurn?.() === true) { endReason = 'stopped'; break; }

        if (!parsed.调度有效) {
            // 调度字段掉了不该让整场散场：先由程序接手选下一位，连续失效过多才停。
            调度降级次数 += 1;
            连续降级次数 += 1;
            const fallback = 连续降级次数 > 调度降级上限
                ? undefined
                : 选择兜底发言者(participants, [...history, ...newMessages], 取最近玩家发言([...history, ...newMessages]), npcId);
            if (!fallback) { endReason = 'invalid_scheduler'; break; }
            current = fallback;
            continue;
        }
        if (parsed.动作 === 'wait') { endReason = 'model_wait'; break; }
        if (parsed.动作 === 'stop') { endReason = 'model_stop'; break; }
        const next = participants.find(item => {
            const nextId = 取文本(parsed.下一位NPCId);
            return 取NPCId(item) === nextId || 取文本(item?.姓名) === nextId;
        });
        if (!next) {
            // 模型报了名单外的人：同样是调度故障，按降级处理，不让整场断掉。
            调度降级次数 += 1;
            连续降级次数 += 1;
            const fallback = 连续降级次数 > 调度降级上限
                ? undefined
                : 选择兜底发言者(participants, [...history, ...newMessages], 取最近玩家发言([...history, ...newMessages]), npcId);
            if (!fallback) { endReason = 'invalid_scheduler'; break; }
            current = fallback;
            continue;
        }
        连续降级次数 = 0;
        // 纯程序纠偏：被点名优先 / 冷板凳优先 / 连说上限，模型给的下一位违规才改写。
        const 纠偏 = 纠偏下一位({
            participants,
            当前NpcId: npcId,
            模型建议: next,
            最近发言: parsed.正文,
            玩家输入: playerInput || 取最近玩家发言([...history, ...newMessages]),
            统计: 轮转,
            历史: [...history, ...newMessages]
        });
        if (纠偏.纠偏 && 纠偏.next) 调度纠偏次数 += 1;
        current = 纠偏.next || next;
    }

    return {
        groupId,
        新增消息: newMessages,
        发言次数: newMessages.filter(item => item.role === 'npc').length,
        结束原因: endReason,
        调度降级次数,
        调度纠偏次数,
        发言分布: Object.fromEntries(
            participants.map(npc => {
                const id = 取NPCId(npc);
                return [取文本(npc?.姓名) || id, 轮转.发言次数.get(id) || 0];
            })
        ),
        ...(摘要更新.length > 0 ? { 摘要更新 } : {})
    };
};
