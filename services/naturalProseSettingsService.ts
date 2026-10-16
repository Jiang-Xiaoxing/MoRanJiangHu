import { 读取设置, 保存设置 } from './dbService';
import { NATURAL_PROSE_SETTINGS_KEY, normalizeNaturalProseSettings, type NaturalProseSettings } from '../utils/naturalProse';

export const createNaturalProseSettingsService = (storage = { read: 读取设置, write: 保存设置 }) => {
    let pending: Promise<unknown> = Promise.resolve();
    // 读、迁移和写串行执行，避免旧配置迁移覆盖刚切换的开关。
    const enqueue = <T>(action: () => Promise<T>): Promise<T> => {
        const result = pending.catch(() => undefined).then(action);
        pending = result;
        return result;
    };
    return {
        // 不长期缓存，导入、清理设置后下次请求使用新值。
        load: (): Promise<NaturalProseSettings> => enqueue(async () => {
            const raw = await storage.read(NATURAL_PROSE_SETTINGS_KEY);
            const settings = normalizeNaturalProseSettings(raw);
            if (raw != null && (typeof raw !== 'object' || Array.isArray(raw)
                || Object.keys(raw).length !== 1 || raw.enabled !== settings.enabled)) {
                await storage.write(NATURAL_PROSE_SETTINGS_KEY, settings);
            }
            return settings;
        }),
        save: (raw: NaturalProseSettings): Promise<void> => {
            const snapshot = normalizeNaturalProseSettings(raw);
            return enqueue(() => storage.write(NATURAL_PROSE_SETTINGS_KEY, snapshot));
        }
    };
};
export const naturalProseSettingsService = createNaturalProseSettingsService();
