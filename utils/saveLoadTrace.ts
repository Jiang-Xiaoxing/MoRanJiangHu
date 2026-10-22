type TracePayload = Record<string, unknown>;

const TRACE_KEY = 'moranjianghu.saveLoadTrace.v1';
const TRACE_ENABLE_KEY = 'moranjianghu.saveLoadTrace.enabled';
const TRACE_LIMIT = 160;
const VALUE_STRING_LIMIT = 240;

type ValueStats = {
    nodes: number;
    strings: number;
    stringChars: number;
    dataUrlStrings: number;
    dataUrlChars: number;
    remoteImageUrls: number;
    imageAssetRefs: number;
    arrays: number;
    objects: number;
    truncated: boolean;
};

const createValueStats = (): ValueStats => ({
    nodes: 0,
    strings: 0,
    stringChars: 0,
    dataUrlStrings: 0,
    dataUrlChars: 0,
    remoteImageUrls: 0,
    imageAssetRefs: 0,
    arrays: 0,
    objects: 0,
    truncated: false
});

const isSaveLoadTraceEnabled = (): boolean => {
    if (import.meta.env.DEV) return true;
    if (typeof localStorage === 'undefined') return false;
    try {
        return localStorage.getItem(TRACE_ENABLE_KEY) === '1';
    } catch {
        return false;
    }
};

const getPerformanceMemory = (): Record<string, number> | undefined => {
    if (typeof performance === 'undefined') return undefined;
    const memory = (performance as any).memory;
    if (!memory || typeof memory !== 'object') return undefined;
    return {
        jsHeapSizeLimit: Number(memory.jsHeapSizeLimit) || 0,
        totalJSHeapSize: Number(memory.totalJSHeapSize) || 0,
        usedJSHeapSize: Number(memory.usedJSHeapSize) || 0
    };
};

/**
 * 设备画像：iOS Safari 读档刷新类问题的定位关键。
 * iOS 不暴露 performance.memory / deviceMemory，只能靠 UA + 并发数推断机型档次，
 * 因此在每条 trace 上携带，玩家反馈时无需再追问设备信息。
 */
const 采集设备画像 = (): Record<string, unknown> => {
    if (typeof navigator === 'undefined' || !navigator) return {};
    const ua = String(navigator.userAgent || '');
    const isIOS = /iP(hone|ad|od)/.test(ua) || (/Macintosh/.test(ua) && (navigator as any).maxTouchPoints > 1);
    const isSafari = /Safari/.test(ua) && !/Chrome|Chromium|Edg|OPR|SamsungBrowser/.test(ua);
    return {
        platform: isIOS ? 'ios' : (/Android/i.test(ua) ? 'android' : 'desktop'),
        safari: isSafari,
        cores: Number((navigator as any).hardwareConcurrency) || 0,
        deviceMemoryGb: Number((navigator as any).deviceMemory) || 0,
        touchPoints: Number((navigator as any).maxTouchPoints) || 0
    };
};

const sanitizeTraceValue = (value: unknown, depth = 0): unknown => {
    if (value === null || value === undefined) return value;
    if (typeof value === 'number' || typeof value === 'boolean') return value;
    if (typeof value === 'string') {
        return value.length > VALUE_STRING_LIMIT
            ? `${value.slice(0, VALUE_STRING_LIMIT)}...(${value.length} chars)`
            : value;
    }
    if (value instanceof Error) {
        return {
            name: value.name,
            message: value.message,
            stack: value.stack ? value.stack.slice(0, 1200) : undefined
        };
    }
    if (typeof value !== 'object') return String(value);
    if (depth >= 5) return '[depth-limit]';
    if (Array.isArray(value)) {
        return value.slice(0, 24).map((item) => sanitizeTraceValue(item, depth + 1));
    }
    const result: Record<string, unknown> = {};
    Object.entries(value as Record<string, unknown>).slice(0, 80).forEach(([key, child]) => {
        result[key] = sanitizeTraceValue(child, depth + 1);
    });
    return result;
};

const writeTraceToStorage = (entry: Record<string, unknown>): void => {
    if (typeof localStorage === 'undefined') return;
    try {
        const raw = localStorage.getItem(TRACE_KEY);
        const list = raw ? JSON.parse(raw) : [];
        const nextList = Array.isArray(list) ? list : [];
        nextList.push(entry);
        localStorage.setItem(TRACE_KEY, JSON.stringify(nextList.slice(-TRACE_LIMIT)));
    } catch {
        // Debug tracing must never break the game flow.
    }
};

const writeTraceToNativeLog = (entry: Record<string, unknown>, serialized: string): void => {
    if (typeof window === 'undefined') return;
    try {
        const plugin = (window as any)?.Capacitor?.Plugins?.SaveLoadDebugLogger;
        if (!plugin || typeof plugin.log !== 'function') return;
        void plugin.log({
            stage: typeof entry.stage === 'string' ? entry.stage : '',
            message: serialized
        }).catch(() => undefined);
    } catch {
        // Native logging is best-effort only.
    }
};

export const recordSaveLoadTrace = (stage: string, payload: TracePayload = {}): void => {
    if (!isSaveLoadTraceEnabled()) return;

    const entry = sanitizeTraceValue({
        at: new Date().toISOString(),
        stage,
        device: 采集设备画像(),
        memory: getPerformanceMemory(),
        ...payload
    }) as Record<string, unknown>;

    let serialized = '';
    try {
        serialized = JSON.stringify(entry);
        console.warn('[SAVE_LOAD_TRACE]', serialized);
    } catch {
        serialized = JSON.stringify({ at: new Date().toISOString(), stage });
        console.warn('[SAVE_LOAD_TRACE]', stage);
    }
    writeTraceToNativeLog(entry, serialized);
    writeTraceToStorage(entry);
};

export const recordSaveLoadError = (stage: string, error: unknown, payload: TracePayload = {}): void => {
    recordSaveLoadTrace(stage, {
        level: 'error',
        error: error instanceof Error
            ? { name: error.name, message: error.message, stack: error.stack }
            : String(error),
        ...payload
    });
};

export const collectValueStats = (value: unknown, maxNodes = 24000): ValueStats => {
    const stats = createValueStats();
    const seen = new WeakSet<object>();
    const stack: unknown[] = [value];

    while (stack.length > 0) {
        if (stats.nodes >= maxNodes) {
            stats.truncated = true;
            break;
        }
        const current = stack.pop();
        stats.nodes += 1;

        if (typeof current === 'string') {
            stats.strings += 1;
            stats.stringChars += current.length;
            if (/^data:image\//i.test(current)) {
                stats.dataUrlStrings += 1;
                stats.dataUrlChars += current.length;
            } else if (/^https?:\/\//i.test(current) && /\.(png|jpe?g|webp|gif|bmp)(?:$|[?#])/i.test(current)) {
                stats.remoteImageUrls += 1;
            } else if (/^(img_asset_|remote_backup_)/.test(current)) {
                stats.imageAssetRefs += 1;
            }
            continue;
        }

        if (!current || typeof current !== 'object') continue;
        if (seen.has(current as object)) continue;
        seen.add(current as object);

        if (Array.isArray(current)) {
            stats.arrays += 1;
            for (let index = current.length - 1; index >= 0; index -= 1) {
                stack.push(current[index]);
            }
            continue;
        }

        stats.objects += 1;
        Object.values(current as Record<string, unknown>).forEach((child) => stack.push(child));
    }

    return stats;
};

export const collectLargestStrings = (
    value: unknown,
    options: { limit?: number; maxNodes?: number; sampleLength?: number } = {}
): Array<{ path: string; length: number; sample: string }> => {
    const limit = Math.max(1, Math.min(24, Number(options.limit) || 8));
    const maxNodes = Math.max(100, Number(options.maxNodes) || 50000);
    const sampleLength = Math.max(20, Math.min(240, Number(options.sampleLength) || 80));
    const seen = new WeakSet<object>();
    const stack: Array<{ value: unknown; path: string }> = [{ value, path: '$' }];
    const largest: Array<{ path: string; length: number; sample: string }> = [];
    let visited = 0;

    const pushCandidate = (path: string, text: string) => {
        largest.push({
            path,
            length: text.length,
            sample: text.slice(0, sampleLength)
        });
        largest.sort((a, b) => b.length - a.length);
        if (largest.length > limit) largest.length = limit;
    };

    while (stack.length > 0 && visited < maxNodes) {
        const current = stack.pop();
        if (!current) break;
        visited += 1;
        if (typeof current.value === 'string') {
            if (largest.length < limit || current.value.length > largest[largest.length - 1].length) {
                pushCandidate(current.path, current.value);
            }
            continue;
        }
        if (!current.value || typeof current.value !== 'object') continue;
        if (seen.has(current.value as object)) continue;
        seen.add(current.value as object);

        if (Array.isArray(current.value)) {
            for (let index = current.value.length - 1; index >= 0; index -= 1) {
                stack.push({ value: current.value[index], path: `${current.path}[${index}]` });
            }
            continue;
        }

        Object.entries(current.value as Record<string, unknown>).forEach(([key, child]) => {
            stack.push({ value: child, path: `${current.path}.${key}` });
        });
    }

    return largest;
};

export const buildHistoryDebugSummary = (history: unknown): Record<string, unknown> => {
    if (!Array.isArray(history)) {
        return {
            historyIsArray: false,
            historyType: typeof history
        };
    }

    let userCount = 0;
    let assistantCount = 0;
    let systemCount = 0;
    let structuredCount = 0;
    let logCount = 0;
    let commandCount = 0;
    let actionOptionCount = 0;
    let contentChars = 0;
    let rawJsonChars = 0;

    history.forEach((item: any) => {
        if (item?.role === 'user') userCount += 1;
        else if (item?.role === 'assistant') assistantCount += 1;
        else if (item?.role === 'system') systemCount += 1;
        if (typeof item?.content === 'string') contentChars += item.content.length;
        if (typeof item?.rawJson === 'string') rawJsonChars += item.rawJson.length;
        if (item?.structuredResponse && typeof item.structuredResponse === 'object') {
            structuredCount += 1;
            if (Array.isArray(item.structuredResponse.logs)) logCount += item.structuredResponse.logs.length;
            if (Array.isArray(item.structuredResponse.tavern_commands)) commandCount += item.structuredResponse.tavern_commands.length;
            if (Array.isArray(item.structuredResponse.action_options)) actionOptionCount += item.structuredResponse.action_options.length;
        }
    });

    const latest = history.length > 0 ? history[history.length - 1] as any : undefined;
    return {
        historyIsArray: true,
        historyLength: history.length,
        userCount,
        assistantCount,
        systemCount,
        structuredCount,
        logCount,
        commandCount,
        actionOptionCount,
        contentChars,
        rawJsonChars,
        latestRole: latest?.role,
        latestTimestamp: latest?.timestamp,
        stats: collectValueStats(history)
    };
};

export const buildSaveDebugSummary = (save: any): Record<string, unknown> => {
    if (!save || typeof save !== 'object') {
        return {
            saveExists: Boolean(save),
            saveType: typeof save
        };
    }

    const worldLayers = Array.isArray(save?.世界?.地图层级) ? save.世界.地图层级.length : 0;
    const sceneHistory = Array.isArray(save?.场景图片档案?.生图历史) ? save.场景图片档案.生图历史.length : 0;
    const memory = save?.记忆系统 || {};

    return {
        saveExists: true,
        id: save.id,
        type: save.类型,
        timestamp: save.时间戳,
        realSavedAt: save.元数据?.现实保存时间戳,
        schemaVersion: save.元数据?.schemaVersion,
        metadataHistoryCount: save.元数据?.历史记录条数,
        roleName: typeof save.角色数据?.姓名 === 'string' ? save.角色数据.姓名.slice(0, 40) : undefined,
        realm: typeof save.角色数据?.境界 === 'string' ? save.角色数据.境界.slice(0, 40) : undefined,
        location: typeof save.环境信息?.具体地点 === 'string'
            ? save.环境信息.具体地点.slice(0, 40)
            : undefined,
        gameTime: typeof save.环境信息?.时间 === 'string' ? save.环境信息.时间.slice(0, 40) : undefined,
        history: buildHistoryDebugSummary(save.历史记录),
        socialCount: Array.isArray(save.社交) ? save.社交.length : 0,
        taskCount: Array.isArray(save.任务列表) ? save.任务列表.length : 0,
        agreementCount: Array.isArray(save.约定列表) ? save.约定列表.length : 0,
        worldLayers,
        sceneHistory,
        characterAnchors: Array.isArray(save.角色锚点列表) ? save.角色锚点列表.length : 0,
        memoryCounts: {
            archive: Array.isArray(memory.回忆档案) ? memory.回忆档案.length : 0,
            instant: Array.isArray(memory.即时记忆) ? memory.即时记忆.length : 0,
            short: Array.isArray(memory.短期记忆) ? memory.短期记忆.length : 0,
            middle: Array.isArray(memory.中期记忆) ? memory.中期记忆.length : 0,
            long: Array.isArray(memory.长期记忆) ? memory.长期记忆.length : 0
        },
        topLevelStats: collectValueStats(save, 36000),
        sceneArchiveStats: collectValueStats(save.场景图片档案, 12000),
        socialStats: collectValueStats(save.社交, 12000)
    };
};
