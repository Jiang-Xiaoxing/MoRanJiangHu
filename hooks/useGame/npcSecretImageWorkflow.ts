import * as imageAIService from '../../services/ai/image';
import type {
    接口设置结构,
    香闺秘档部位类型,
    NPC生图任务记录,
    生图任务来源类型,
} from '../../types';
import { 获取词组转化器预设上下文, type 当前可用接口结构 } from '../../utils/apiConfig';
import { 生图最大自动重试次数, 执行生图模型调用带重试 } from '../../utils/imageGenerationRetry';
import type { PNG解析参数结构, 角色锚点结构 } from '../../models/system';
import { 解析视觉年龄 } from '../../utils/visualAge';

const NPC生图运行中计数 = { current: 0 };
import { recordDiagnosticLog } from '../../services/diagnosticLog';
type 图片功能配置 = {
    总开关: boolean;
    NPC开关: boolean;
    使用词组转化器: boolean;
};

type 画师串预设摘要 = {
    名称: string;
    画师串: string;
    正面提示词: string;
    负面提示词: string;
} | null;

type PNG画风预设摘要 = {
    id?: string;
    名称: string;
    画师串: string;
    正面提示词: string;
    负面提示词: string;
    优先复刻原参数?: boolean;
    参数?: PNG解析参数结构;
} | null;

type 角色锚点摘要 = Pick<角色锚点结构, '名称' | '正面提示词' | '负面提示词'> | null;

type NPC秘档部位生图工作流依赖 = {
    apiConfig: 接口设置结构;
    获取NPC唯一标识: (npc: any, index?: number) => string;
    获取文生图接口配置: (config: 接口设置结构) => 当前可用接口结构 | null;
    获取生图词组转化器接口配置: (config: 接口设置结构) => 当前可用接口结构 | null;
    获取生图画师串预设: (config: 接口设置结构, scope: 'npc' | 'scene', preferredId?: string) => 画师串预设摘要;
    获取当前PNG画风预设: (preferredId?: string) => PNG画风预设摘要;
    获取NPC角色锚点: (npcId: string) => 角色锚点摘要;
    获取词组转化器预设提示词: (config: 接口设置结构, scope: 'npc' | 'scene', mode?: 'default' | 'anchor') => string;
    接口配置是否可用: (config: 当前可用接口结构 | null) => boolean;
    读取文生图功能配置: () => 图片功能配置;
    NPC私密部位生图进行中集合: Set<string>;
    提取NPC香闺秘档部位生图数据: (npc: any, part: 香闺秘档部位类型) => any;
    补齐NPC香闺秘档部位描述?: (npc: any, part: 香闺秘档部位类型, context: {
        npcKey: string;
        taskSource: 生图任务来源类型;
        baseData: any;
        描述字段: string;
    }) => Promise<any>;
    创建NPC生图任务: (params: {
        npc: any;
        npcKey: string;
        source: 生图任务来源类型;
        modelName: string;
        构图: '部位特写';
        部位: 香闺秘档部位类型;
        画风?: 当前可用接口结构['画风'];
        画师串?: string;
        额外要求?: string;
        尺寸?: string;
    }) => NPC生图任务记录;
    生成NPC生图记录ID: () => string;
    追加NPC生图任务: (task: NPC生图任务记录) => void;
    更新NPC生图任务: (taskId: string, updater: (task: NPC生图任务记录) => NPC生图任务记录) => void;
    写入NPC图片历史记录: (npcKey: string, record: any, options?: { 同步最近结果?: boolean }) => void;
    更新NPC香闺秘档部位结果: (npcKey: string, part: 香闺秘档部位类型, updater: (current: any) => any) => boolean;
    写入NPC香闺秘档部位记录: (npcKey: string, part: 香闺秘档部位类型, record: any, options?: { 同步最近结果?: boolean }) => boolean;
};

const 默认额外负面提示词 = 'face, eyes, portrait, headshot, upper body, half body, full body, torso, abdomen, legs, arm, feet, hands, multiple people, extra legs, extra arms, extra breasts, extra nipples, extra fingers, three legs, three breasts, merged body parts, duplicate anatomy, mirrored anatomy, multiple genitals, extra genitals, room focus, scenery focus, environment focus, background focus, wide shot, mid shot, collage, contact sheet, reference sheet, character sheet, split screen, panel layout, comic panel, manga panel, thumbnails, bottom strip, inset image, blurry, low quality, bad anatomy';
const 默认裸体正向提示词 = 'nude, naked, unclothed';
const NSFW部位特写词组转化器提示词 = [
    '【NSFW ComfyUI 私密部位特写规则】',
    '只用于香闺秘档/NSFW 部位特写，不得回退成普通 NPC 立绘、半身像、头像或公开展示图。',
    '先清理冲突信息：过滤平台私有语法、长段解释、抽象情绪词、非目标部位信息，以及会导致拼贴/参考页/多镜头的描述。',
    '补足可画细节：围绕目标部位补齐形状、颜色、肌理、湿润感、体液分布、边缘轮廓、临时状态、光影反射和材质质感；除非用户明确要求，不要加入衣物、布料压迫或完整身体构图。',
    '保持短而稳定：输出适合 ComfyUI 的英文短语或 tags，主体必须是单一目标部位，单一镜头，单一画面。',
    '构图必须是 extreme close-up / ultra tight crop / macro shot，目标部位占据绝对主体；严禁出现脸、眼睛、头发、手脚、全身、半身、房间远景或场景主体。',
    '如果文本包含明确成人内容，允许并优先将性器官、体液、湿润光泽、插入/摩擦/压迫等可见细节转为具体画面元素；不要只写 nsfw、sexy、erotic 等空泛标签。',
    '光影和材质要服务于成人细节：用 soft rim light、specular highlights、subsurface scattering、wet skin texture、glistening fluid 等可画短语强化局部质感。',
    '锚点模式下只继承与目标部位相关的稳定身体特征，不要重复展开完整外貌、服装、身份和背景。',
    '输出只保留最终生图词组，不输出解释、Markdown、规则说明或中文翻译。'
].join('\n');

const 获取画风标签 = (style?: 当前可用接口结构['画风']): string => {
    switch (style) {
        case '二次元':
            return 'anime style, 2d illustration';
        case '国风':
            return 'guofeng, chinese ink painting, traditional chinese aesthetic';
        case '写实':
            return 'realistic, photorealistic';
        default:
            return '';
    }
};

const 获取图片后端显示名 = (apiConfig: 当前可用接口结构): string => {
    switch (apiConfig.图片后端类型) {
        case 'comfyui':
            return 'ComfyUI';
        case 'sd_webui':
            return 'Stable Diffusion WebUI';
        case 'novelai':
        case 'openai':
        default:
            return (apiConfig.model || '').trim() || '图片模型';
    }
};

export const 执行NPC香闺秘档部位生图工作流 = async (
    npc: any,
    part: 香闺秘档部位类型,
    options: { source?: 生图任务来源类型; 画风?: 当前可用接口结构['画风']; 画师串?: string; 画师串预设ID?: string; PNG画风预设ID?: string; 额外要求?: string; 尺寸?: string; signal?: AbortSignal } | undefined,
    deps: NPC秘档部位生图工作流依赖
): Promise<void> => {
    const npcKey = deps.获取NPC唯一标识(npc);
    if (!npcKey) return;

    const uniqueTaskKey = `${npcKey}::${part}`;
    if (deps.NPC私密部位生图进行中集合.has(uniqueTaskKey)) return;
    if (NPC生图运行中计数.current >= 1) return;

    const imageApi = deps.获取文生图接口配置(deps.apiConfig);
    const imageFeature = deps.读取文生图功能配置();
    const backendType = imageApi?.图片后端类型;
    const shouldUsePromptTransformer = backendType === 'novelai' || imageFeature.使用词组转化器 !== false;
    const promptApi = shouldUsePromptTransformer ? deps.获取生图词组转化器接口配置(deps.apiConfig) : null;
    const modelName = imageApi ? 获取图片后端显示名(imageApi) : '';
    const 画风 = options?.画风;
    const 额外要求 = (options?.额外要求 || '').trim();
    const 尺寸 = (options?.尺寸 || '').trim();
    const taskSource: 生图任务来源类型 = options?.source || 'manual';
    const task = deps.创建NPC生图任务({
        npc,
        npcKey,
        source: taskSource,
        modelName,
        构图: '部位特写',
        部位: part,
        画风,
        画师串: '',
        额外要求,
        尺寸
    });
    const recordId = deps.生成NPC生图记录ID();
    deps.追加NPC生图任务(task);
    deps.更新NPC生图任务(task.id, (currentTask) => ({
        ...currentTask,
        状态: 'running',
        开始时间: Date.now(),
        构图: '部位特写',
        部位: part,
        画风,
        额外要求,
        尺寸,
        进度阶段: 'prompting',
        进度文本: `正在校验${part}特写的配置与描述文本。`
    }));

    deps.NPC私密部位生图进行中集合.add(uniqueTaskKey);
    NPC生图运行中计数.current += 1;
    let baseData: any = undefined;
    let partDescription = '';
    let 前置正向提示词 = '';
    let 合并负向画师串 = '';
    let PNG参数: PNG解析参数结构 | undefined = undefined;

    try {
        if (!imageFeature.总开关) {
            throw new Error('文生图总开关未启用，无法生成香闺秘档特写。');
        }
        if (!deps.接口配置是否可用(imageApi)) {
            throw new Error('未配置可用的文生图接口，无法生成香闺秘档特写。');
        }
        if (shouldUsePromptTransformer && !deps.接口配置是否可用(promptApi)) {
            throw new Error(backendType === 'novelai'
                ? 'NovelAI 模式必须绑定可用的词组转化器接口，请先完成配置。'
                : '词组转化器配置不可用，无法生成香闺秘档特写。');
        }

        baseData = deps.提取NPC香闺秘档部位生图数据(npc, part);
        const 视觉年龄 = 解析视觉年龄({
            actualAge: baseData?.真实年龄 ?? baseData?.年龄 ?? npc?.年龄,
            explicitVisualAge: baseData?.外观年龄 ?? npc?.外观年龄,
            topicMode: baseData?.题材模式,
            realmLevel: baseData?.境界层级 ?? npc?.境界层级,
            realmText: baseData?.境界 ?? npc?.境界,
            identity: baseData?.身份 ?? npc?.身份,
            appearance: baseData?.外貌 ?? npc?.外貌描写 ?? npc?.外貌,
            body: baseData?.身材 ?? npc?.身材描写 ?? npc?.身材,
            clothing: baseData?.衣着 ?? npc?.衣着风格 ?? npc?.衣着,
            // 视觉年龄约束 是上一轮解析产出的指令文本，不作为年龄判断输入（避免回灌误判 elderly）
            bio: [baseData?.简介, baseData?.核心性格特征, baseData?.性格].filter(Boolean).join('；'),
            race: npc?.种族,
            species: npc?.血统,
            additionalTexts: [npc?.灵根, npc?.灵根资质, npc?.男娘设定, npc?.扶她设定, npc?.性转记录]
        });
        if (!视觉年龄.isAdultSafetyApproved) {
            throw new Error('角色真实年龄或明确视觉年龄不满足成人私密生图要求。');
        }
        const partDescriptionField = part === '胸部' ? '胸部描述' : part === '小穴' ? '小穴描述' : part === '肉棒' ? '肉棒描述' : '屁穴描述';
        partDescription = typeof baseData?.[partDescriptionField] === 'string' ? baseData[partDescriptionField].trim() : '';
        if (!partDescription && deps.补齐NPC香闺秘档部位描述) {
            deps.更新NPC生图任务(task.id, (currentTask) => ({
                ...currentTask,
                状态: 'running',
                进度阶段: 'prompting',
                进度文本: `${part}描述为空，正在自动补齐私密部位档案。`
            }));
            const filledData = await deps.补齐NPC香闺秘档部位描述(npc, part, {
                npcKey,
                taskSource,
                baseData,
                描述字段: partDescriptionField
            });
            if (filledData && typeof filledData === 'object') {
                baseData = {
                    ...baseData,
                    ...filledData
                };
                partDescription = typeof baseData?.[partDescriptionField] === 'string' ? baseData[partDescriptionField].trim() : '';
                recordDiagnosticLog(partDescription ? 'info' : 'warn', '[NPC私密部位生图链路] 自动补齐部位描述结果', {
                    npcKey,
                    part,
                    descriptionFilled: Boolean(partDescription),
                    descriptionLength: partDescription.length
                });
            }
        }
        // [修复] 部位描述为空时，使用NPC外貌/身材描写作为降级描述，而不是直接报错
        if (!partDescription) {
            const fallbackDesc = [
                typeof baseData?.外貌 === 'string' ? baseData.外貌.trim() : '',
                typeof baseData?.身材 === 'string' ? baseData.身材.trim() : ''
            ].filter(Boolean).join('；');
            if (fallbackDesc) {
                partDescription = `${fallbackDesc}（${part}特写）`;
                recordDiagnosticLog('info', '[NPC私密部位生图链路] 部位描述为空，使用外貌描写降级', {
                    npcKey,
                    part,
                    fallbackLength: fallbackDesc.length
                });
            } else {
                throw new Error(`${part}描述和外貌描写均为空，无法生成${part}特写。`);
            }
        }

        const 强制裸体语义 = deps.apiConfig?.功能模型占位?.香闺秘档特写强制裸体语义 === true;
    const PNG画风预设 = deps.获取当前PNG画风预设(options?.PNG画风预设ID);
    const 角色锚点 = deps.获取NPC角色锚点(typeof npc?.id === 'string' ? npc.id.trim() : '');
    const 词组转化兼容模式 = deps.apiConfig?.功能模型占位?.词组转化兼容模式 === true;
    const 启用画师串预设 = Boolean(
        (options?.画师串 || '').trim()
        || (PNG画风预设?.画师串 || '').trim()
        || (PNG画风预设?.正面提示词 || '').trim()
        || (PNG画风预设?.负面提示词 || '').trim()
    );
    const 启用PNG画风预设 = Boolean(
        (PNG画风预设?.画师串 || '').trim()
        || (PNG画风预设?.正面提示词 || '').trim()
        || (PNG画风预设?.负面提示词 || '').trim()
    );
    const 画师串 = [(options?.画师串 || '').trim(), (PNG画风预设?.画师串 || '').trim()]
        .map((item) => item.trim())
        .filter(Boolean)
        .join(', ');
    const 画师串负面 = [默认额外负面提示词]
        .map((item) => item.trim())
        .filter(Boolean)
        .join(', ');
    const 非画师风格正面提示词 = [(PNG画风预设?.正面提示词 || '').trim()].filter(Boolean).join(', ');
    const 兼容模式风格提示词 = 词组转化兼容模式 ? 非画师风格正面提示词 : '';
    前置正向提示词 = [
        画师串,
        词组转化兼容模式 ? '' : 非画师风格正面提示词,
        角色锚点
            ? imageAIService.构建角色锚点注入提示词({
                正面提示词: 角色锚点.正面提示词,
                结构化特征: (角色锚点 as any).结构化特征
            }, { 构图: '部位特写', 部位: part })
            : ''
    ].filter(Boolean).join(', ');
    合并负向画师串 = [画师串负面, (角色锚点?.负面提示词 || '').trim(), (PNG画风预设?.负面提示词 || '').trim()].filter(Boolean).join(', ');
    PNG参数 = PNG画风预设?.优先复刻原参数 === true ? PNG画风预设?.参数 : undefined;
    const 画风标签 = 获取画风标签(画风);
    const 合并额外要求 = [额外要求, 画风标签].filter(Boolean).join(', ');
    const 词组转化器预设上下文 = 获取词组转化器预设上下文(
        deps.apiConfig,
        'npc',
        角色锚点 ? 'anchor' : 'default',
        { 包含输出格式提示词: false }
    );
    // 私密部位特写不能复用普通 NPC 角色预设；那套预设会鼓励完整外观、服装和环境，容易把画面拉回普通角色图。
    // 这里使用 NSFW 专用规则，承接客户模板里的细节强化要求，但只作用于香闺秘档部位特写。
    const 词组转化器提示词 = NSFW部位特写词组转化器提示词;
    const promptApiForTask = promptApi ? {
        ...promptApi,
        词组转化器AI角色提示词: 词组转化器预设上下文.AI角色定制提示词,
        词组转化器提示词
    } : null;
    deps.更新NPC生图任务(task.id, (currentTask) => ({
        ...currentTask,
        状态: 'running',
        开始时间: Date.now(),
        原始描述: JSON.stringify(baseData ?? {}, null, 2),
        构图: '部位特写',
        部位: part,
        画风,
        画师串: 前置正向提示词,
        额外要求,
        尺寸,
        进度阶段: 'prompting',
        进度文本: shouldUsePromptTransformer ? `正在整理${part}特写资料并生成生图词组。` : `已跳过词组转化器，正在直接整理${part}特写资料。`
    }));

    deps.更新NPC香闺秘档部位结果(npcKey, part, (currentResult) => ({
        // [修复] 保留当前已有的 图片URL/本地路径，避免 pending 占位覆盖已存在的 success 图。
        // 旧图作为兜底显示，新图生成中由任务队列展示进度，成功后由 写入NPC香闺秘档部位记录 覆盖。
        ...currentResult,
        id: recordId,
        部位: part,
        生图词组: '',
        原始描述: JSON.stringify(baseData ?? {}, null, 2),
        使用模型: modelName,
        生成时间: Date.now(),
        构图: '部位特写' as const,
        画风,
        画师串: 前置正向提示词,
        状态: 'pending' as const,
        错误信息: undefined,
        描述文本: partDescription
    }));
    // [修复] 不在工作流前期写入 pending 历史记录：
    // 空壳 pending 记录会污染生图历史，导致从历史回填逻辑误以为该部位已有记录（但无图），
    // 也让 UI 显示的生图历史里挂着无图 pending 条目。
    // 最终成功或失败后，写入NPC香闺秘档部位记录 / 失败分支的写入NPC图片历史记录 
    // 会写入完整的含图记录或含错误信息的失败记录。

        const { 原始描述, 生图词组 } = shouldUsePromptTransformer && promptApiForTask
            ? await imageAIService.generateNpcSecretPartImagePrompt(
                baseData,
                promptApiForTask,
                undefined,
                undefined,
                undefined,
                { 部位: part, 画风, 额外要求: 合并额外要求, 后端类型: backendType, 启用画师串预设: !词组转化兼容模式 && (启用画师串预设 || 启用PNG画风预设), 兼容模式: 词组转化兼容模式, 风格提示词输入: 兼容模式风格提示词 || undefined }
            )
            : imageAIService.buildNpcSecretPartDirectImagePrompt(baseData, {
                部位: part,
                画风,
                额外要求: 合并额外要求,
                后端类型: backendType,
                启用画师串预设: !词组转化兼容模式 && (启用画师串预设 || 启用PNG画风预设),
                兼容模式: 词组转化兼容模式,
                风格提示词输入: 兼容模式风格提示词 || undefined
            });
        const 特写附加正向提示词 = [强制裸体语义 ? 默认裸体正向提示词 : '', 前置正向提示词].filter(Boolean).join(', ');
        const 特写尺寸 = 尺寸 || '1024x1280';
        const 最终提示词 = imageAIService.构建最终图片提示词(生图词组, imageApi!, {
            构图: '部位特写',
            尺寸: 特写尺寸,
            附加正向提示词: 特写附加正向提示词,
            附加负面提示词: 合并负向画师串,
            PNG参数
        });
        deps.更新NPC生图任务(task.id, (currentTask) => ({
            ...currentTask,
            原始描述,
            生图词组,
            最终正向提示词: 最终提示词.最终正向提示词,
            最终负向提示词: 最终提示词.最终负向提示词,
            构图: '部位特写',
            部位: part,
            画风,
            画师串: 前置正向提示词,
            额外要求,
            尺寸,
            进度阶段: 'generating',
            进度文本: `${part}词组转换完成，正在调用图片模型生成特写。`
        }));
        deps.更新NPC香闺秘档部位结果(npcKey, part, (currentResult) => ({
            ...currentResult,
            id: currentResult?.id || recordId,
            部位: part,
            生图词组,
            最终正向提示词: 最终提示词.最终正向提示词,
            最终负向提示词: 最终提示词.最终负向提示词,
            原始描述,
            使用模型: modelName,
            生成时间: currentResult?.生成时间 || Date.now(),
            构图: '部位特写',
            画风,
            画师串: 前置正向提示词,
            状态: 'pending',
            错误信息: undefined,
            描述文本: partDescription
        }));
        // [修复] 不在词组转换后写入 pending 历史记录，原因同上
        recordDiagnosticLog('info', '[NPC私密部位生图链路] 准备调用图片后端', {
            taskId: task.id,
            recordId,
            npcKey,
            npcName: typeof npc?.姓名 === 'string' ? npc.姓名 : '',
            part,
            backendType: imageApi?.图片后端类型 || '',
            model: imageApi?.model || '',
            size: 特写尺寸,
            promptLength: 生图词组.length,
            hasFinalPositivePrompt: Boolean(最终提示词.最终正向提示词),
            hasFinalNegativePrompt: Boolean(最终提示词.最终负向提示词)
        });
        const imageResult = await 执行生图模型调用带重试(
            () => imageAIService.generateImageByPrompt(生图词组, imageApi!, options?.signal, {
                构图: '部位特写',
                尺寸: 特写尺寸,
                附加正向提示词: 特写附加正向提示词,
                附加负面提示词: 合并负向画师串,
                跳过基础负面提示词: Boolean((PNG画风预设?.负面提示词 || '').trim()),
                PNG参数,
                随机种子生成: deps.apiConfig?.功能模型占位?.随机种子生成 !== false,
                启用NSFW模式: true  // 香闺秘档生图天生属于 NSFW 场景，不剥离成人标签
            }),
            {
                signal: options?.signal,
                onAttempt: (attempt, totalAttempts) => {
                    deps.更新NPC生图任务(task.id, (currentTask) => ({
                        ...currentTask,
                        状态: 'running',
                        重试次数: Math.max(0, attempt - 1),
                        最大重试次数: 生图最大自动重试次数,
                        进度阶段: 'generating',
                        进度文本: `${part}词组转换完成，正在调用图片模型生成特写（第 ${attempt}/${totalAttempts} 次尝试）。`
                    }));
                },
                onRetry: (attempt, totalAttempts, errorMessage) => {
                    deps.更新NPC生图任务(task.id, (currentTask) => ({
                        ...currentTask,
                        状态: 'running',
                        重试次数: attempt,
                        最大重试次数: 生图最大自动重试次数,
                        错误信息: errorMessage,
                        进度阶段: 'generating',
                        进度文本: `第 ${attempt}/${totalAttempts} 次${part}特写生成失败：${errorMessage}；正在自动重试。`
                    }));
                }
            }
        );
        recordDiagnosticLog('info', '[NPC私密部位生图链路] 图片后端已返回', {
            taskId: task.id,
            recordId,
            npcKey,
            part,
            hasImageUrl: Boolean(imageResult?.图片URL),
            hasLocalPath: Boolean(imageResult?.本地路径),
            hasFinalPositivePrompt: Boolean(imageResult?.最终正向提示词),
            hasFinalNegativePrompt: Boolean(imageResult?.最终负向提示词)
        });
        const fixedImageResult = await imageAIService.修复部位特写底部缩略图栏(imageResult);
        const localizedImageResult = await imageAIService.persistImageAssetLocally(fixedImageResult);
        const 调试链路 = Array.isArray(imageResult?.调试链路) ? imageResult.调试链路 : undefined;
        recordDiagnosticLog('info', '[NPC私密部位生图链路] 图片资源本地化完成', {
            taskId: task.id,
            recordId,
            npcKey,
            part,
            hasImageUrl: Boolean(localizedImageResult?.图片URL),
            hasLocalPath: Boolean(localizedImageResult?.本地路径),
            displayable: Boolean(localizedImageResult?.图片URL || localizedImageResult?.本地路径)
        });
        if (!localizedImageResult.图片URL && !localizedImageResult.本地路径) {
            throw new Error('图片已生成，但未得到可展示或可保存的图片资源。');
        }
        deps.更新NPC生图任务(task.id, (currentTask) => ({
            ...currentTask,
            进度阶段: 'saving',
            进度文本: `${part}特写已生成，正在写回图片档案。`
        }));

        const successRecord = {
            id: recordId,
            部位: part,
            图片URL: localizedImageResult.图片URL,
            本地路径: localizedImageResult.本地路径,
            生图词组,
            最终正向提示词: localizedImageResult.最终正向提示词 || 最终提示词.最终正向提示词,
            最终负向提示词: localizedImageResult.最终负向提示词 || 最终提示词.最终负向提示词,
            原始描述,
            使用模型: modelName,
            生成时间: Date.now(),
            构图: '部位特写',
            画风,
            画师串: 前置正向提示词,
            状态: 'success',
            错误信息: undefined,
            描述文本: partDescription,
            调试链路
        };
        const writeSucceeded = deps.写入NPC香闺秘档部位记录(npcKey, part, successRecord, { 同步最近结果: false });
        recordDiagnosticLog(writeSucceeded ? 'info' : 'error', '[NPC私密部位生图链路] 写入历史记录结果', {
            taskId: task.id,
            recordId,
            npcKey,
            npcName: typeof npc?.姓名 === 'string' ? npc.姓名 : '',
            part,
            writeSucceeded,
            hasImageUrl: Boolean(successRecord.图片URL),
            hasLocalPath: Boolean(successRecord.本地路径)
        });
        if (!writeSucceeded) {
            throw new Error(`${part}特写已生成，但没有找到要写回的 NPC 档案；已阻止任务标记为成功。`);
        }
        deps.更新NPC生图任务(task.id, (currentTask) => ({
            ...currentTask,
            状态: 'success',
            完成时间: Date.now(),
            使用模型: modelName,
            原始描述,
            生图词组,
            最终正向提示词: localizedImageResult.最终正向提示词 || 最终提示词.最终正向提示词,
            最终负向提示词: localizedImageResult.最终负向提示词 || 最终提示词.最终负向提示词,
            构图: '部位特写',
            部位: part,
            画风,
            画师串: 前置正向提示词,
            额外要求,
            图片URL: localizedImageResult.图片URL,
            本地路径: localizedImageResult.本地路径,
            错误信息: undefined,
            调试链路,
            进度阶段: 'success',
            进度文本: `${part}特写已生成并写入历史记录。`
        }));
    } catch (error: any) {
        const errorMessage = typeof error?.message === 'string' && error.message.trim()
            ? error.message.trim()
            : `${part}特写生成失败`;
        const 调试链路 = Array.isArray(error?.生图调试链路) ? error.生图调试链路 : undefined;
        deps.更新NPC香闺秘档部位结果(npcKey, part, (currentResult) => ({
            id: currentResult?.id || recordId,
            部位: part,
            图片URL: currentResult?.图片URL,
            本地路径: currentResult?.本地路径,
            生图词组: currentResult?.生图词组 || '',
            最终正向提示词: currentResult?.最终正向提示词 || '',
            最终负向提示词: currentResult?.最终负向提示词 || '',
            原始描述: currentResult?.原始描述 || JSON.stringify(baseData ?? {}, null, 2),
            使用模型: modelName,
            生成时间: Date.now(),
            构图: '部位特写',
            画风,
            画师串: 前置正向提示词,
            状态: 'failed',
            错误信息: errorMessage,
            描述文本: partDescription,
            调试链路
        }));
        deps.写入NPC图片历史记录(npcKey, {
            id: recordId,
            部位: part,
            图片URL: undefined,
            本地路径: undefined,
            生图词组: '',
            最终正向提示词: '',
            最终负向提示词: '',
            原始描述: JSON.stringify(baseData ?? {}, null, 2),
            使用模型: modelName,
            生成时间: Date.now(),
            构图: '部位特写' as const,
            画风,
            画师串: 前置正向提示词,
            状态: 'failed' as const,
            错误信息: errorMessage,
            调试链路
        }, { 同步最近结果: false });
        deps.更新NPC生图任务(task.id, (currentTask) => ({
            ...currentTask,
            状态: 'failed',
            完成时间: Date.now(),
            构图: '部位特写',
            部位: part,
            最终正向提示词: currentTask.最终正向提示词,
            最终负向提示词: currentTask.最终负向提示词,
            画风,
            画师串: 前置正向提示词,
            额外要求,
            错误信息: errorMessage,
            调试链路,
            进度阶段: 'failed',
            进度文本: errorMessage
        }));
        throw error;
    } finally {
        NPC生图运行中计数.current -= 1;
        deps.NPC私密部位生图进行中集合.delete(uniqueTaskKey);
    }
};
