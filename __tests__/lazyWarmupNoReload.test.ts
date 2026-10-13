import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const 读源码 = (相对路径: string): string =>
    readFileSync(resolve(process.cwd(), 相对路径), 'utf-8');

/**
 * 截取「创建可预加载懒组件」工厂的完整源码。
 * 用首尾锚点而不是固定长度切片：工厂体随注释增减变化，
 * 固定 1600 字符迟早漏出边界（已因此漏过变异）。
 */
const 读懒组件工厂源码 = (): string => {
    const 源码 = 读源码('App.tsx');
    const 起点 = 源码.indexOf('const 创建可预加载懒组件');
    expect(起点).toBeGreaterThanOrEqual(0);
    const 终点 = 源码.indexOf('const CharacterModal', 起点);
    expect(终点).toBeGreaterThan(起点);
    return 源码.slice(起点, 终点);
};

describe('预热路径不得触发整页刷新', () => {
    // 回归：v1.0.679 把预热 effect 依赖收敛为 [state.view] 后，
    // 「读档」成了唯一且必然触发全量预热的入口。iOS Safari 上刚灌完存档
    // 内存处于峰值，任一 chunk 加载失败就整页刷新，
    // view 归零 -> 玩家刚读进来的对局丢失、回主页。
    it('App.tsx 的 preload 必须走 preloadLazyImport', () => {
        const 创建组件段 = 读懒组件工厂源码();

        // 精确断言：preload 的赋值目标必须使用不走 reload 的加载器。
        // 只断言「不含 wrappedLoader」不够——有人把 preload 改回
        // 直接包一层 lazyImportWithReload 时会漏过（已用变异测试验证过）。
        const preload赋值行 = 创建组件段
            .split('\n')
            .filter((line) => /\bpreload\s*=/.test(line));
        expect(preload赋值行.length).toBeGreaterThanOrEqual(1);
        for (const 行 of preload赋值行) {
            expect(行).toMatch(/preloadLazyImport|preloadLoader/);
            expect(行).not.toMatch(/lazyImportWithReload/);
        }
        expect(创建组件段).toContain('preloadLazyImport');
    });

    // CodeRabbit PR#99 意见二：React.lazy 会缓存 rejected payload（_status=2），
    // 失败后不再调用 loader。游戏态禁了整页刷新，若没有重建路径，
    // 玩家点开某个弹窗失败一次就永远打不开。
    it('懒组件必须可重建，否则游戏态内失败后无法恢复', () => {
        const 创建组件段 = 读懒组件工厂源码();

        // 版本号必须来自登记簿，版本一变才能造出全新的 React.lazy 实例。
        expect(创建组件段).toMatch(/useSyncExternalStore/);
        expect(创建组件段).toContain('读取懒组件版本');
        expect(创建组件段).toContain('订阅懒组件重建');

        // v1.0.682 致命回归（玩家反馈「进不去」的根因）：
        // React.lazy 实例曾由 useMemo 按 fiber 生命周期创建。懒组件首次渲染
        // 就 suspend 时，Suspense 会提交 fallback 并删除 primary 子树，
        // chunk 到位后 primary 从零重挂载 → useMemo 重算 → 拿到 _status=-1
        // 的全新 payload → loader 重发 → promise resolve → ping 重试 →
        // 再重挂载 → 再 suspend……自激死循环（e2e 实测约 1 万次/秒），
        // 弹窗永远渲染不出来。SettingsModal.tsx 的模块级 React.lazy 没这个
        // 问题，因为 payload 活在模块作用域、跨重挂载存活。
        // 不变量：lazy 实例必须按版本缓存在工厂闭包里，跨重挂载存活。
        const allLazy = 创建组件段.match(/React\.lazy\(/g) || [];
        expect(allLazy.length).toBe(1);
        // 唯一的那次创建必须落在按版本读写的缓存里：get 当门闩、set 落盘，
        // 少任何一个都会退回「每次渲染/重挂载都新建」的死循环。
        expect(创建组件段).toMatch(/\.get\(\s*版本\s*\)/);
        expect(创建组件段).toMatch(/\.set\(\s*版本\s*,/);
        // 薄壳渲染必须走缓存读取，而不是拿到类型后自行 new。
        expect(创建组件段).toMatch(/createElement\(\s*获取懒实例\(版本\)/);
        // 反向：绝不允许再把 lazy 实例塞回依赖 fiber 生命周期的 useMemo。
        expect(创建组件段).not.toMatch(/useMemo\([\s\S]*?React\.lazy\(/);
    });

    it('ModalErrorBoundary 必须在游戏态提供重试而非刷新', () => {
        const 源码 = 读源码('components/ui/ModalErrorBoundary.tsx');
        expect(源码).toContain('重置懒组件重建');
        expect(源码).toContain('isLazyImportInGameActive');
        // 游戏态内不得再出现刷新按钮的渲染分支条件。
        expect(源码).toMatch(/isLazyImportError && !游戏态内/);
    });

    it('lazyImportWithReload 必须提供显式的禁止刷新开关', () => {
        const 源码 = 读源码('utils/lazyImportWithReload.ts');
        expect(源码).toContain('allowReload');
        expect(源码).toMatch(/allowReload\s*!==\s*false/);
        // preloadLazyImport 必须显式关闭刷新。
        expect(源码).toMatch(
            /preloadLazyImport[\s\S]*?allowReload:\s*false/
        );
    });

    it('App.tsx 必须随 view 同步游戏态标记', () => {
        const 源码 = 读源码('App.tsx');
        expect(源码).toMatch(
            /setLazyImportInGameActive\(\s*state\.view === 'game'\s*\)/
        );
    });

    it('预热失败只记日志，不弹刷新提示', () => {
        const 源码 = 读源码('App.tsx');
        const 预热段 = 源码.slice(
            源码.indexOf('const warmup = () => {'),
            源码.indexOf('const warmup = () => {') + 1200
        );
        expect(预热段).toContain('console.warn');
        expect(预热段).not.toContain('location.reload');
    });
});
