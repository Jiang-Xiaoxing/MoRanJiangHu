import { naturalProseSettingsService } from '../services/naturalProseSettingsService';
import { naturalProseDefaults } from '../utils/naturalProse';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { 执行主剧情发送工作流 } from '../hooks/useGame/sendWorkflow';
import * as textAIService from '../services/ai/text';
import { 默认游戏设置 } from '../utils/gameSettings';

vi.mock('../services/naturalProseSettingsService', () => ({ naturalProseSettingsService: { load: vi.fn() } }));

vi.mock('../services/ai/text', async () => {
    const actual = await vi.importActual<any>('../services/ai/text');
    return {
        ...actual,
        generateStoryResponse: vi.fn(),
        generatePolishedBody: vi.fn()
    };
});

const 构建系统上下文 = () => ({
    shortMemoryContext: '',
    runtimePromptStates: {},
    contextPieces: {
        AI角色声明: '你是墨色江湖主剧情模型。',
        worldPrompt: '',
        地图建筑状态: '',
        同人设定摘要: '',
        境界体系提示词: '',
        离场NPC档案: '',
        otherPrompts: '',
        难度设置提示词: '',
        叙事人称提示词: '',
        字数设置提示词: '正文不少于 50 字。',
        长期记忆: '',
        中期记忆: '',
        在场NPC档案: '',
        剧情安排: '',
        女主剧情规划状态: '',
        世界状态: '',
        环境状态: '',
        角色状态: '',
        战斗状态: '',
        门派状态: '',
        任务状态: '',
        约定状态: '',
        COT提示词: '',
        格式提示词: '',
        字数要求提示词: '正文不少于 50 字。',
        免责声明输出提示词: '',
        输出协议提示词: '请输出 <正文>、<短期记忆>、<命令>。'
    }
});

const 构建响应 = (text: string, rawText = text) => ({
    rawText,
    response: {
        logs: [{ sender: '旁白', text }],
        shortTerm: '本回合继续推进。',
        tavern_commands: [],
        action_options: ['继续观察', '准备撤离']
    }
});

const 深拷贝 = <T,>(value: T): T => (
    value === undefined ? value : JSON.parse(JSON.stringify(value))
);

describe('主剧情质量审查自动重试端到端', () => {
    beforeEach(() => {
        vi.mocked(naturalProseSettingsService.load).mockReset().mockResolvedValue({ ...naturalProseDefaults, enabled: true });
        vi.mocked(textAIService.generateStoryResponse).mockReset();
        vi.mocked(textAIService.generatePolishedBody).mockReset();
    });

    it('拦截“极其”刷屏后会把拒绝原因返回给 AI 并接受重写结果', async () => {
        const badBody = [
            '我极其极其艰难地咬紧牙关，极其极其微弱地吐出这几个字。',
            '我极其极其死硬地将身体的重心极其极其微小地向左侧倾斜，准备极其极其痛苦地将自己的身体塞进那个极其极其狭窄的三角形缺口。',
            '下方机房走廊里，那极其极其沉闷的脚步声，极其极其突兀地停止了。'
        ].join('\n');
        const cleanBody = [
            '我咬住牙关，把快要散掉的呼吸压回胸腔，只从唇缝里挤出几个破碎的字。',
            '左肩先贴上冰冷管壁，膝盖一点点收紧，骨节在狭窄缺口里磨得发麻。',
            '就在我换气的瞬间，下方机房走廊的重步声忽然停住，正落在盲管下方。'
        ].join('\n');

        vi.mocked(textAIService.generateStoryResponse)
            .mockImplementationOnce(async () => {
                // 生成中修改配置只能在下一轮生效，当前回合重试仍使用启动快照。
                vi.mocked(naturalProseSettingsService.load).mockResolvedValue({ ...naturalProseDefaults, enabled: false });
                return 构建响应(badBody, '<正文>极其重复正文</正文>') as any;
            })
            .mockResolvedValueOnce(构建响应(cleanBody, '<正文>干净重写正文</正文>') as any);

        let history: any[] = [];
        const retryReasons: string[] = [];
        const apiConfig = {
            activeConfigId: 'main',
            configs: [{
                id: 'main',
                名称: '主剧情测试接口',
                供应商: 'openai_compatible',
                协议覆盖: 'openai',
                baseUrl: 'https://example.test/v1',
                apiKey: 'test-key',
                model: 'test-model',
                maxTokens: 1200,
                temperature: 0.2
            }],
            功能模型占位: {
                主剧情使用模型: 'test-model',
                世界演变功能启用: false,
                规划分析功能启用: false,
                地图生成功能启用: false,
                变量计算独立模型开关: false,
                文章优化独立模型开关: false,
                文生图功能启用: false,
                NPC生图启用: false,
                场景生图启用: false,
                物品生图启用: false
            }
        };
        const gameConfig = {
            ...默认游戏设置,
            字数要求: 50,
            字数不足处理方式: '重新生成',
            叙事人称: '第一人称',
            启用自动重试: true,
            启用行动选项: false,
            启用回合结束自动存档: false,
            启用正文词汇审查: true
        };
        const state = {
            历史记录: history,
            记忆系统: {},
            角色: { 姓名: '端测少侠', 物品列表: [], 装备: {} },
            环境: { 时间: '1:01:01:08:00', 大地点: '端测州', 具体地点: '机房盲管' },
            社交: [],
            世界: { 地图层级: [] },
            战斗: {},
            玩家门派: {},
            任务列表: [],
            约定列表: [],
            剧情: {},
            剧情规划: {},
            女主剧情规划: undefined,
            同人剧情规划: undefined,
            同人女主剧情规划: undefined,
            开局配置: undefined,
            游戏初始时间: '1:01:01:08:00',
            loading: false,
            gameConfig,
            apiConfig,
            memoryConfig: {},
            visualConfig: {},
            sceneImageArchive: {},
            prompts: [],
            内置提示词列表: [],
            世界书列表: []
        } as any;
        const deps = {
            abortControllerRef: { current: null },
            recallAbortControllerRef: { current: null },
            前台发送序号Ref: { current: 0 },
            setLoading: vi.fn(),
            set后台队列处理中: vi.fn(),
            setShowSettings: vi.fn(),
            设置剧情: vi.fn(),
            设置历史记录: vi.fn((value: any) => {
                history = typeof value === 'function' ? value(history) : value;
            }),
            设置叙事平静值: vi.fn(),
            应用并同步记忆系统: vi.fn(),
            构建系统提示词: vi.fn(() => 构建系统上下文()),
            processResponseCommands: vi.fn((_response: any, baseState: any) => ({
                ...深拷贝(baseState),
                gameConfig,
                剧情规划: baseState?.剧情规划 || {},
                女主剧情规划: baseState?.女主剧情规划,
                同人剧情规划: baseState?.同人剧情规划,
                同人女主剧情规划: baseState?.同人女主剧情规划
            })),
            performAutoSave: vi.fn(async () => undefined),
            执行正文润色: vi.fn(async (baseResponse: any, rawText: string) => ({ response: baseResponse, applied: false, rawText })),
            执行世界演变更新: vi.fn(async () => ({ ok: true, phase: 'skipped', statusText: '跳过', commands: [], rawText: '' })),
            触发新增NPC自动生图: vi.fn(),
            触发对白NPC头像补全: vi.fn(),
            检查主角每回合生图: vi.fn(),
            触发场景自动生图: vi.fn(),
            应用常驻壁纸为背景: vi.fn(async () => undefined),
            提取新增NPC列表: vi.fn(() => []),
            推入重Roll快照: vi.fn(),
            弹出重Roll快照: vi.fn(),
            回档到快照: vi.fn(),
            深拷贝,
            按回合窗口裁剪历史: (items: any[]) => items,
            规范化环境信息: (value?: any) => value || {},
            规范化剧情状态: (value?: any) => value || {},
            规范化剧情规划状态: (value?: any) => value || {},
            规范化女主剧情规划状态: (value?: any) => value,
            规范化同人剧情规划状态: (value?: any) => value,
            规范化同人女主剧情规划状态: (value?: any) => value,
            规范化世界状态: (value?: any) => value || { 地图层级: [] },
            游戏设置启用自动重试: (config?: any) => config?.启用自动重试 === true,
            执行带自动重试的生成请求: async ({ enabled, action, onRetry }: any) => {
                const maxAttempts = enabled ? 3 : 1;
                let lastError: any = null;
                for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
                    try {
                        return await action(attempt, lastError);
                    } catch (error: any) {
                        lastError = error;
                        if (!enabled || attempt >= maxAttempts) throw error;
                        const reason = error?.parseDetail || error?.message || '请求失败，正在重试';
                        retryReasons.push(reason);
                        onRetry?.(attempt + 1, maxAttempts, reason);
                    }
                }
                throw lastError;
            },
            更新流式草稿为自动重试提示: (items: any[], attempt: number, maxAttempts: number, reason?: string) => [
                ...items,
                { role: 'assistant', content: `【自动重试中】第 ${attempt} / ${maxAttempts} 次${reason ? `：${reason}` : ''}`, timestamp: Date.now() }
            ],
            提取解析失败原始信息: (error: any) => error?.parseDetail || error?.message || '',
            提取原始报错详情: (error: any) => error?.parseDetail || error?.message || '',
            格式化错误详情: (error: any) => error?.message || '',
            获取原始AI消息: (rawText: string) => rawText,
            估算消息Token: () => 0,
            估算AI输出Token: () => 0,
            计算回复耗时秒: () => 1,
            文章优化功能已开启: () => false,
            后台执行统一规划分析: vi.fn(async () => ({ updated: false, message: '跳过', rawText: '', commands: [] })),
            后台执行变量生成: vi.fn(async () => undefined),
            执行变量生成并合并响应: vi.fn(async () => null)
        } as any;

        const result = await 执行主剧情发送工作流('继续。', false, state, deps);
        await new Promise(resolve => setTimeout(resolve, 20));

        expect(result.cancelled).not.toBe(true);
        expect(naturalProseSettingsService.load).toHaveBeenCalledTimes(1);
        for (const call of vi.mocked(textAIService.generateStoryResponse).mock.calls) {
            expect(call[7]?.naturalProse).toMatchObject({ enabled: true });
        }
        expect(textAIService.generateStoryResponse).toHaveBeenCalledTimes(2);
        const systemPromptOptions = vi.mocked(deps.构建系统提示词).mock.calls[0]?.[4] as any;
        expect(systemPromptOptions.世界书附加文本?.[0]).toContain('玩家：继续。');
        expect(retryReasons.join('\n')).toContain('极其');
        const secondRequestOptions = vi.mocked(textAIService.generateStoryResponse).mock.calls[1][7] as any;
        expect(secondRequestOptions.lengthRequirementPrompt).toContain('【自动重试正文质量修正】');
        expect(secondRequestOptions.lengthRequirementPrompt).toContain('空泛强调词');
        expect(secondRequestOptions.lengthRequirementPrompt).toContain('完整重新生成本回合');
        const assistantTurn = history.find(item => item?.role === 'assistant' && item?.structuredResponse);
        expect(assistantTurn?.structuredResponse?.logs?.[0]?.text).toContain('我咬住牙关');
        expect(assistantTurn?.structuredResponse?.logs?.[0]?.text).not.toContain('极其');
    });

    it('名器名称出现在正文时只改写命中句子，不全文重新生成', async () => {
        const body = [
            '我推开窗，看见林清月仍站在廊下，雨水沿着檐角一线线落下。',
            '她强忍羞意，低声提到了雪玉灵窍这个隐秘名字。',
            '我没有追问，只把话题转回今晚的巡查，免得她更加难堪。'
        ].join('\n');
        const revisedSentence = '她强忍羞意，只含糊提到那处隐秘体质，不愿把细节说得太直白。';

        vi.mocked(textAIService.generateStoryResponse)
            .mockResolvedValueOnce(构建响应(body, '<正文>命中名器正文</正文>') as any);
        vi.mocked(textAIService.generatePolishedBody)
            .mockResolvedValueOnce({
                bodyText: JSON.stringify({
                    decision: 'rewrite',
                    reason: '像内部档案名，改成自然代称。',
                    sentence: revisedSentence
                }),
                rawText: `<正文>${JSON.stringify({
                    decision: 'rewrite',
                    reason: '像内部档案名，改成自然代称。',
                    sentence: revisedSentence
                })}</正文>`
            } as any);

        let history: any[] = [];
        const retryReasons: string[] = [];
        const apiConfig = {
            activeConfigId: 'main',
            configs: [{
                id: 'main',
                名称: '主剧情测试接口',
                供应商: 'openai_compatible',
                协议覆盖: 'openai',
                baseUrl: 'https://example.test/v1',
                apiKey: 'test-key',
                model: 'test-model',
                maxTokens: 1200,
                temperature: 0.2
            }],
            功能模型占位: {
                主剧情使用模型: 'test-model',
                世界演变功能启用: false,
                规划分析功能启用: false,
                地图生成功能启用: false,
                变量计算独立模型开关: false,
                文章优化独立模型开关: false,
                文生图功能启用: false,
                NPC生图启用: false,
                场景生图启用: false,
                物品生图启用: false
            }
        };
        const gameConfig = {
            ...默认游戏设置,
            字数要求: 50,
            字数不足处理方式: '重新生成',
            叙事人称: '第一人称',
            启用自动重试: true,
            启用行动选项: false,
            启用回合结束自动存档: false,
            启用正文词汇审查: true
        };
        const state = {
            历史记录: history,
            记忆系统: {},
            角色: { 姓名: '端测少侠', 物品列表: [], 装备: {} },
            环境: { 时间: '1:01:01:08:00', 大地点: '端测州', 具体地点: '客栈廊下' },
            社交: [{
                姓名: '林清月',
                名器档案: [
                    { 部位: '小穴', 名称: '雪玉灵窍', 品质: '极品', 稳定描述: '档案描述', 效果: { 说明: '机制说明' } }
                ]
            }],
            世界: { 地图层级: [] },
            战斗: {},
            玩家门派: {},
            任务列表: [],
            约定列表: [],
            剧情: {},
            剧情规划: {},
            女主剧情规划: undefined,
            同人剧情规划: undefined,
            同人女主剧情规划: undefined,
            开局配置: undefined,
            游戏初始时间: '1:01:01:08:00',
            loading: false,
            gameConfig,
            apiConfig,
            memoryConfig: {},
            visualConfig: {},
            sceneImageArchive: {},
            prompts: [],
            内置提示词列表: [],
            世界书列表: []
        } as any;
        const deps = {
            abortControllerRef: { current: null },
            recallAbortControllerRef: { current: null },
            前台发送序号Ref: { current: 0 },
            setLoading: vi.fn(),
            set后台队列处理中: vi.fn(),
            setShowSettings: vi.fn(),
            设置剧情: vi.fn(),
            设置历史记录: vi.fn((value: any) => {
                history = typeof value === 'function' ? value(history) : value;
            }),
            设置叙事平静值: vi.fn(),
            应用并同步记忆系统: vi.fn(),
            构建系统提示词: vi.fn(() => 构建系统上下文()),
            processResponseCommands: vi.fn((_response: any, baseState: any) => ({
                ...深拷贝(baseState),
                gameConfig,
                剧情规划: baseState?.剧情规划 || {},
                女主剧情规划: baseState?.女主剧情规划,
                同人剧情规划: baseState?.同人剧情规划,
                同人女主剧情规划: baseState?.同人女主剧情规划
            })),
            performAutoSave: vi.fn(async () => undefined),
            执行正文润色: vi.fn(async (baseResponse: any, rawText: string) => ({ response: baseResponse, applied: false, rawText })),
            执行世界演变更新: vi.fn(async () => ({ ok: true, phase: 'skipped', statusText: '跳过', commands: [], rawText: '' })),
            触发新增NPC自动生图: vi.fn(),
            触发对白NPC头像补全: vi.fn(),
            检查主角每回合生图: vi.fn(),
            触发场景自动生图: vi.fn(),
            应用常驻壁纸为背景: vi.fn(async () => undefined),
            提取新增NPC列表: vi.fn(() => []),
            推入重Roll快照: vi.fn(),
            弹出重Roll快照: vi.fn(),
            回档到快照: vi.fn(),
            深拷贝,
            按回合窗口裁剪历史: (items: any[]) => items,
            规范化环境信息: (value?: any) => value || {},
            规范化剧情状态: (value?: any) => value || {},
            规范化剧情规划状态: (value?: any) => value || {},
            规范化女主剧情规划状态: (value?: any) => value,
            规范化同人剧情规划状态: (value?: any) => value,
            规范化同人女主剧情规划状态: (value?: any) => value,
            规范化世界状态: (value?: any) => value || { 地图层级: [] },
            游戏设置启用自动重试: (config?: any) => config?.启用自动重试 === true,
            执行带自动重试的生成请求: async ({ enabled, action, onRetry }: any) => {
                const maxAttempts = enabled ? 3 : 1;
                let lastError: any = null;
                for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
                    try {
                        return await action(attempt, lastError);
                    } catch (error: any) {
                        lastError = error;
                        if (!enabled || attempt >= maxAttempts) throw error;
                        const reason = error?.parseDetail || error?.message || '请求失败，正在重试';
                        retryReasons.push(reason);
                        onRetry?.(attempt + 1, maxAttempts, reason);
                    }
                }
                throw lastError;
            },
            更新流式草稿为自动重试提示: (items: any[], attempt: number, maxAttempts: number, reason?: string) => [
                ...items,
                { role: 'assistant', content: `【自动重试中】第 ${attempt} / ${maxAttempts} 次${reason ? `：${reason}` : ''}`, timestamp: Date.now() }
            ],
            提取解析失败原始信息: (error: any) => error?.parseDetail || error?.message || '',
            提取原始报错详情: (error: any) => error?.parseDetail || error?.message || '',
            格式化错误详情: (error: any) => error?.message || '',
            获取原始AI消息: (rawText: string) => rawText,
            估算消息Token: () => 0,
            估算AI输出Token: () => 0,
            计算回复耗时秒: () => 1,
            文章优化功能已开启: () => false,
            后台执行统一规划分析: vi.fn(async () => ({ updated: false, message: '跳过', rawText: '', commands: [] })),
            后台执行变量生成: vi.fn(async () => undefined),
            执行变量生成并合并响应: vi.fn(async () => null)
        } as any;

        const result = await 执行主剧情发送工作流('继续。', false, state, deps);
        await new Promise(resolve => setTimeout(resolve, 20));

        expect(result.cancelled).not.toBe(true);
        expect(textAIService.generateStoryResponse).toHaveBeenCalledTimes(1);
        expect(textAIService.generatePolishedBody).toHaveBeenCalledTimes(1);
        expect(retryReasons).toEqual([]);
        const assistantTurn = history.find(item => item?.role === 'assistant' && item?.structuredResponse);
        const finalText = assistantTurn?.structuredResponse?.logs?.map((log: any) => log.text).join('\n') || '';
        expect(finalText).toContain(revisedSentence);
        expect(finalText).not.toContain('雪玉灵窍');
        expect(finalText).toContain('我推开窗');
        expect(finalText).toContain('我没有追问');
    });

    it('普通回合会把同一个 sendInput 传给动态世界和规划分析', async () => {
        const body = [
            '我停在巷口，没有贸然追上去，只隔着雨幕观察黑衣人的去向。',
            '雨水顺着屋檐连成细线，遮住远处灯火，也让巷道里的脚步声变得断续难辨。',
            '我只把手按在剑柄上，记下对方拐入西侧窄巷的方向，没有让自己贸然卷入新的冲突。'
        ].join('\n');
        vi.mocked(textAIService.generateStoryResponse)
            .mockResolvedValueOnce(构建响应(body, '<正文>观察正文</正文>') as any);

        let history: any[] = [];
        const playerInput = '本轮只观察，不要推进主线，也不要安排刺客袭击。';
        const apiConfig = {
            activeConfigId: 'main',
            configs: [{
                id: 'main',
                名称: '主剧情测试接口',
                供应商: 'openai_compatible',
                协议覆盖: 'openai',
                baseUrl: 'https://example.test/v1',
                apiKey: 'test-key',
                model: 'test-model',
                maxTokens: 1200,
                temperature: 0.2
            }],
            功能模型占位: {
                主剧情使用模型: 'test-model',
                世界演变功能启用: true,
                规划分析功能启用: true,
                地图生成功能启用: false,
                变量计算独立模型开关: false,
                文章优化独立模型开关: false,
                文生图功能启用: false,
                NPC生图启用: false,
                场景生图启用: false,
                物品生图启用: false
            }
        };
        const gameConfig = {
            ...默认游戏设置,
            字数要求: 50,
            字数不足处理方式: '重新生成',
            叙事人称: '第一人称',
            启用自动重试: false,
            启用行动选项: false,
            启用回合结束自动存档: false,
            启用正文词汇审查: false
        };
        const state = {
            历史记录: history,
            记忆系统: {},
            角色: { 姓名: '端测少侠', 物品列表: [], 装备: {} },
            环境: { 时间: '1:01:01:08:00', 大地点: '端测州', 具体地点: '雨巷' },
            社交: [],
            世界: { 地图层级: [] },
            战斗: {},
            玩家门派: {},
            任务列表: [],
            约定列表: [],
            剧情: {},
            剧情规划: {},
            女主剧情规划: undefined,
            同人剧情规划: undefined,
            同人女主剧情规划: undefined,
            开局配置: undefined,
            游戏初始时间: '1:01:01:08:00',
            loading: false,
            gameConfig,
            apiConfig,
            memoryConfig: {},
            visualConfig: {},
            sceneImageArchive: {},
            prompts: [],
            内置提示词列表: [],
            世界书列表: []
        } as any;
        const deps = {
            abortControllerRef: { current: null },
            recallAbortControllerRef: { current: null },
            前台发送序号Ref: { current: 0 },
            setLoading: vi.fn(),
            set后台队列处理中: vi.fn(),
            setShowSettings: vi.fn(),
            设置剧情: vi.fn(),
            设置历史记录: vi.fn((value: any) => {
                history = typeof value === 'function' ? value(history) : value;
            }),
            设置叙事平静值: vi.fn(),
            应用并同步记忆系统: vi.fn(),
            构建系统提示词: vi.fn(() => 构建系统上下文()),
            processResponseCommands: vi.fn((_response: any, baseState: any) => ({
                ...深拷贝(baseState),
                gameConfig,
                剧情规划: baseState?.剧情规划 || {},
                女主剧情规划: baseState?.女主剧情规划,
                同人剧情规划: baseState?.同人剧情规划,
                同人女主剧情规划: baseState?.同人女主剧情规划
            })),
            performAutoSave: vi.fn(async () => undefined),
            执行正文润色: vi.fn(async (baseResponse: any, rawText: string) => ({ response: baseResponse, applied: false, rawText })),
            执行世界演变更新: vi.fn(async () => ({ ok: true, phase: 'applied', statusText: '完成', commands: [], rawText: '' })),
            触发新增NPC自动生图: vi.fn(),
            触发对白NPC头像补全: vi.fn(),
            检查主角每回合生图: vi.fn(),
            触发场景自动生图: vi.fn(),
            应用常驻壁纸为背景: vi.fn(async () => undefined),
            提取新增NPC列表: vi.fn(() => []),
            推入重Roll快照: vi.fn(),
            弹出重Roll快照: vi.fn(),
            回档到快照: vi.fn(),
            深拷贝,
            按回合窗口裁剪历史: (items: any[]) => items,
            规范化环境信息: (value?: any) => value || {},
            规范化剧情状态: (value?: any) => value || {},
            规范化剧情规划状态: (value?: any) => value || {},
            规范化女主剧情规划状态: (value?: any) => value,
            规范化同人剧情规划状态: (value?: any) => value,
            规范化同人女主剧情规划状态: (value?: any) => value,
            规范化世界状态: (value?: any) => value || { 地图层级: [] },
            游戏设置启用自动重试: (config?: any) => config?.启用自动重试 === true,
            执行带自动重试的生成请求: async ({ action }: any) => action(1, null),
            更新流式草稿为自动重试提示: (items: any[]) => items,
            提取解析失败原始信息: (error: any) => error?.message || '',
            提取原始报错详情: (error: any) => error?.message || '',
            格式化错误详情: (error: any) => error?.message || '',
            获取原始AI消息: (rawText: string) => rawText,
            估算消息Token: () => 0,
            估算AI输出Token: () => 0,
            计算回复耗时秒: () => 1,
            文章优化功能已开启: () => false,
            后台执行统一规划分析: vi.fn(async () => ({ updated: false, message: '跳过', rawText: '', commands: [] })),
            后台执行变量生成: vi.fn(async () => undefined),
            执行变量生成并合并响应: vi.fn(async () => null)
        } as any;

        const result = await 执行主剧情发送工作流(playerInput, false, state, deps);
        await vi.waitFor(() => {
            expect(deps.执行世界演变更新).toHaveBeenCalled();
            expect(deps.后台执行统一规划分析).toHaveBeenCalled();
        });

        expect(result.cancelled).not.toBe(true);
        expect(vi.mocked(deps.执行世界演变更新).mock.calls.at(-1)?.[0]).toMatchObject({ playerInput });
        expect(vi.mocked(deps.后台执行统一规划分析).mock.calls.at(-1)?.[0]).toMatchObject({ playerInput });
        const snapshot = vi.mocked(deps.推入重Roll快照).mock.calls[0]?.[0] as any;
        expect(snapshot?.自动存档完成).toBeInstanceOf(Promise);
        await expect(Promise.race([
            snapshot.自动存档完成,
            new Promise((_, reject) => setTimeout(() => reject(new Error('自动存档完成 Promise 未收束')), 100))
        ])).resolves.toBeNull();
    });
});
