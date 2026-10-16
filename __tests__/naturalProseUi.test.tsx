// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import GameSettings from '../components/features/Settings/GameSettings';
import { 默认游戏设置 } from '../utils/gameSettings';
import { NATURAL_PROSE_SETTINGS_KEY } from '../utils/naturalProse';
import { 读取设置, 保存设置 } from '../services/dbService';
vi.mock('../services/dbService', () => ({ 读取设置: vi.fn(), 保存设置: vi.fn() }));
const map = new Map<string, unknown>();
beforeEach(() => {
    map.clear();
    vi.mocked(读取设置).mockReset().mockImplementation(async key => map.get(key));
    vi.mocked(保存设置).mockReset().mockImplementation(async (key, value) => { map.set(key, structuredClone(value)); });
});
afterEach(cleanup);
const mount = async () => {
    const view = render(<GameSettings settings={默认游戏设置} onSave={vi.fn()} />);
    await waitFor(() => expect((screen.getByRole('switch', { name: '切换自然文风修复' }) as HTMLButtonElement).disabled).toBe(false));
    return view;
};
describe('自然文风精简设置UI', () => {
    it('使用原有开关，正常界面只显示标题和说明，无编辑器或专项入口', async () => {
        await mount();
        const row = within(screen.getByRole('group', { name: '自然文风修复' }));
        expect(row.getByRole('switch').getAttribute('aria-checked')).toBe('false');
        expect(row.getByText('减少 AI 正文中的套路化表达、重复句式、冗余修辞和机械化描写。')).toBeTruthy();
        expect(row.queryByRole('combobox')).toBeNull(); expect(row.queryByRole('textbox')).toBeNull();
        expect(row.getAllByRole('switch')).toHaveLength(1); expect(row.queryByText(/当前生效|专项|恢复默认/)).toBeNull();
    });
    it('切换自动保存，仅保存开关，重开恢复且不改游戏设置', async () => {
        const onSave = vi.fn();
        const view = render(<GameSettings settings={默认游戏设置} onSave={onSave} />);
        const toggle = screen.getByRole('switch', { name: '切换自然文风修复' });
        await waitFor(() => expect((toggle as HTMLButtonElement).disabled).toBe(false));
        fireEvent.click(toggle);
        await waitFor(() => expect(map.get(NATURAL_PROSE_SETTINGS_KEY)).toEqual({ enabled: true }));
        expect(onSave).not.toHaveBeenCalled();
        view.unmount(); await mount();
        expect(screen.getByRole('switch', { name: '切换自然文风修复' }).getAttribute('aria-checked')).toBe('true');
    });
    it('旧版配置迁移后只剩开关，旧mode和prompt无隐藏入口', async () => {
        map.set(NATURAL_PROSE_SETTINGS_KEY, { enabled: true, mode: 'gemini', generalPrompt: '旧通用', geminiPrompt: '旧Gemini' });
        await mount();
        expect(screen.getByRole('switch', { name: '切换自然文风修复' }).getAttribute('aria-checked')).toBe('true');
        expect(map.get(NATURAL_PROSE_SETTINGS_KEY)).toEqual({ enabled: true });
        expect(screen.queryByText('旧通用')).toBeNull(); expect(screen.queryByText('模型专项优化')).toBeNull();
    });
    it('保存失败回退开关并允许再次切换，不增加常驻控件', async () => {
        await mount(); vi.mocked(保存设置).mockRejectedValueOnce(new Error('disk'));
        fireEvent.click(screen.getByRole('switch', { name: '切换自然文风修复' }));
        await screen.findByText('保存失败，请再次切换重试。');
        expect(screen.getByRole('switch', { name: '切换自然文风修复' }).getAttribute('aria-checked')).toBe('false');
        fireEvent.click(screen.getByRole('switch', { name: '切换自然文风修复' }));
        await waitFor(() => expect(map.get(NATURAL_PROSE_SETTINGS_KEY)).toEqual({ enabled: true }));
        expect(screen.queryByRole('alert')).toBeNull();
    });
    it('读取失败禁用开关，不覆盖已有数据', async () => {
        vi.mocked(读取设置).mockRejectedValueOnce(new Error('disk'));
        render(<GameSettings settings={默认游戏设置} onSave={vi.fn()} />);
        await screen.findByText('读取失败，请重新打开设置重试。');
        expect((screen.getByRole('switch', { name: '切换自然文风修复' }) as HTMLButtonElement).disabled).toBe(true);
        expect(保存设置).not.toHaveBeenCalled();
    });
});
