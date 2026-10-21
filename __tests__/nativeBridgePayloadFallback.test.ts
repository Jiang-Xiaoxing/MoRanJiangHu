import { describe, expect, it } from 'vitest';
import {
    是否原生桥载荷错误,
    规范化原生连接错误提示
} from '../services/ai/chatCompletionClient';

const 真实桥错误 = 'Error invoking postMessage: Java bridge method invocation error Error: Error invoking postMessage: Java bridge method invocation error at postToNative (<anonymous>:853:43) at cap.toNative (<anonymous>:922:25) at cap.nativeCallback (<anonymous>:1007:28) at G.v (https://localhost/assets/capacitor-vendor-Dt_IU_QQ.js:1:2353)';

describe('原生桥载荷错误识别与降级提示', () => {
    it('识别玩家实际上报的 Capacitor 桥调用失败', () => {
        expect(是否原生桥载荷错误(真实桥错误)).toBe(true);
        expect(是否原生桥载荷错误(new Error(真实桥错误))).toBe(true);
    });

    it('不误伤其他错误', () => {
        expect(是否原生桥载荷错误('API Error: 500 - internal')).toBe(false);
        expect(是否原生桥载荷错误('Failed to connect to /127.0.0.1:11434')).toBe(false);
        expect(是否原生桥载荷错误('"NativeChatStreamer" plugin is not implemented on android')).toBe(false);
        expect(是否原生桥载荷错误('API Error: stream unsupported (content-type=application/json)')).toBe(false);
        expect(是否原生桥载荷错误('')).toBe(false);
    });

    it('桥错误转成玩家可读的体积提示', () => {
        const friendly = 规范化原生连接错误提示(真实桥错误);
        expect(friendly).not.toBe(真实桥错误);
        expect(friendly).toContain('桥接层');
        expect(friendly).toContain('请求尚未发出');
        expect(friendly).toContain('女主规划');
    });

    it('友好提示不包含流式关键词，避免误触流式降级判定', () => {
        const friendly = 规范化原生连接错误提示(真实桥错误).toLowerCase();
        expect(friendly).not.toContain('stream');
        expect(friendly).not.toContain('event-stream');
    });

    it('连接层错误与无关错误的行为不变', () => {
        expect(规范化原生连接错误提示('Failed to connect to /127.0.0.1:11434')).toContain('无法连接到接口服务器');
        const 无关错误 = 'API Error: 400 - bad request';
        expect(规范化原生连接错误提示(无关错误)).toBe(无关错误);
    });
});
