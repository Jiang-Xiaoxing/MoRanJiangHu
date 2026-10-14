import { afterEach, describe, expect, it, vi } from 'vitest';
import { recordSaveLoadTrace } from '../utils/saveLoadTrace';

describe('saveLoadTrace 设备画像', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it('每条 trace 携带设备画像，便于 iOS Safari 读档刷新问题定位', () => {
        // vitest 下 import.meta.env.DEV 为 false，显式打开 trace 开关
        vi.stubGlobal('localStorage', {
            getItem: (key: string) => (key === 'moranjianghu.saveLoadTrace.enabled' ? '1' : null),
            setItem: () => {},
            removeItem: () => {}
        });
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        recordSaveLoadTrace('test.stage', { 样本: 1 });
        // 先取 calls 再 restore：mockRestore 会清空调用历史
        const raw = String(warn.mock.calls[0]?.[1] ?? '');
        warn.mockRestore();
        expect(raw).toContain('"stage":"test.stage"');
        expect(raw).toContain('"device"');
        expect(raw).toContain('"platform"');
        expect(raw).toContain('"cores"');
        expect(raw).toContain('"safari"');
    });

    it('trace 关闭时不写任何日志', () => {
        expect(() => recordSaveLoadTrace('test.noop')).not.toThrow();
    });
});
