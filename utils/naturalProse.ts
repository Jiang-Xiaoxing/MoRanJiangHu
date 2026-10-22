import { DEFAULT_NATURAL_PROSE_PROMPT } from '../prompts/writing/naturalProse';

export const NATURAL_PROSE_SETTINGS_KEY = 'natural_prose_settings';
export interface NaturalProseSettings {
    enabled: boolean;
}
export const naturalProseDefaults: Readonly<NaturalProseSettings> = Object.freeze({ enabled: false });

// 旧版 mode / 三套自定义 Prompt 不再参与运行；仅保留合法的开关状态。
export const normalizeNaturalProseSettings = (raw: unknown): NaturalProseSettings => ({
    enabled: !!raw && typeof raw === 'object' && !Array.isArray(raw)
        && (raw as { enabled?: unknown }).enabled === true
});

export const buildNaturalProsePrompt = (raw?: NaturalProseSettings): string =>
    normalizeNaturalProseSettings(raw).enabled ? DEFAULT_NATURAL_PROSE_PROMPT : '';
