// 用法：node e2e/natural-prose.mjs。只服务本地dist，使用仓库旧存档，无真实AI请求。
import { chromium, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
const root = path.resolve('dist');
const server = createServer(async (req, res) => {
    try {
        const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
        const file = path.resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
        if (!file.startsWith(root + path.sep)) throw new Error('invalid path');
        const content = await readFile(file);
        const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' };
        res.setHeader('Content-Type', mime[path.extname(file)] || 'application/octet-stream'); res.end(content);
    } catch { res.writeHead(404); res.end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
const reports = [];
try {
    browser = await chromium.launch({ channel: 'chrome', headless: true });
    const page = await browser.newPage({ viewport: { width: 2560, height: 1440 } });
    // 屏蔽与本地界面验证无关的远端统计/资源请求。
    const origin = `http://127.0.0.1:${server.address().port}`;
    await page.route('**/*', route => route.request().url().startsWith(origin) || route.request().url().startsWith('data:') ? route.continue() : route.abort());
    const errors = [];
    const deadline = setTimeout(() => { console.error('Browser verification exceeded 90s'); void browser?.close(); process.exit(1); }, 90000);
    deadline.unref();
    page.on('pageerror', error => errors.push(error.message));
    page.setDefaultTimeout(15000);
    console.log('step: open');
    await page.goto(origin + '/?skipReleaseNotes=1');
    await page.getByRole('button', { name: '设置', exact: true }).waitFor();
    const save = JSON.parse(await readFile('e2e/fixtures/desktop-compact-save.json', 'utf8'));
    console.log('step: seed');
    await page.evaluate(async payload => {
        const db = await new Promise((resolve, reject) => { const req = indexedDB.open('WuxiaGameDB'); req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); });
        await new Promise((resolve, reject) => {
            const tx = db.transaction(['saves', 'save_summaries', 'settings'], 'readwrite');
            tx.objectStore('saves').put(payload);
            tx.objectStore('save_summaries').put({ id: payload.id, 类型: payload.类型, 时间戳: payload.时间戳, 元数据: payload.元数据, 游戏初始时间: payload.游戏初始时间, 角色数据: payload.角色数据, 环境信息: payload.环境信息 });
            tx.objectStore('settings').put({ key: 'app_theme', value: 'day' });
            tx.objectStore('settings').put({ key: 'natural_prose_settings', value: { enabled: false, mode: 'claude', generalPrompt: '旧通用', claudePrompt: '旧Claude', geminiPrompt: '旧Gemini' } });
            tx.objectStore('settings').put({ key: 'api_settings', value: { activeConfigId: 'local-test', configs: [{ id: 'local-test', 名称: '本地测试', 供应商: 'openai_compatible', 协议覆盖: 'openai', baseUrl: 'https://story.test/v1', apiKey: 'fake-test-key', model: 'claude-sonnet-4-5' }] } });
            tx.oncomplete = resolve; tx.onerror = () => reject(tx.error);
        }); db.close();
    }, save);
    console.log('step: seeded');
    console.log('step: reload');
    await page.reload();
    console.log('step: settings');
    await page.getByRole('button', { name: '设置', exact: true }).click();
    await page.getByRole('button', { name: '游戏设定', exact: true }).click();
    const readSetting = key => page.evaluate(async key => {
        const db = await new Promise((resolve, reject) => { const req = indexedDB.open('WuxiaGameDB'); req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); });
        const value = await new Promise((resolve, reject) => { const req = db.transaction('settings').objectStore('settings').get(key); req.onsuccess = () => resolve(req.result?.value); req.onerror = () => reject(req.error); });
        db.close(); return value;
    }, key);
    let row = page.getByRole('group', { name: '自然文风修复', exact: true });
    const toggle = row.getByRole('switch', { name: '切换自然文风修复' });
    await expect(toggle).toBeEnabled();
    await expect(toggle).not.toBeChecked();
    expect(await readSetting('natural_prose_settings')).toEqual({ enabled: false });
    await toggle.click();
    await expect.poll(() => readSetting('natural_prose_settings')).toEqual({ enabled: true });
    await expect(row.getByRole('textbox')).toHaveCount(0);
    await expect(row.getByRole('combobox')).toHaveCount(0);
    await expect(row.locator('details')).toHaveCount(0);
    expect(await row.innerText()).not.toMatch(/当前生效|模型|专项|恢复默认/);
    await mkdir('.tmp-natural-prose', { recursive: true });
    for (const [name, width, height, theme] of [['desktop-day', 2560, 1440, 'day'], ['desktop-dark', 1440, 1000, 'dark']]) {
        await page.setViewportSize({ width, height });
        await page.evaluate(theme => document.documentElement.setAttribute('data-theme', theme), theme);
        const measure = await row.evaluate(el => ({ width: el.getBoundingClientRect().width, height: el.getBoundingClientRect().height, scroll: el.scrollWidth, client: el.clientWidth,
            color: getComputedStyle(el.querySelector('.text-gray-400')).color }));
        expect(measure.scroll).toBeLessThanOrEqual(measure.client + 1);
        expect(measure.height).toBeLessThan(100);
        await row.screenshot({ path: `.tmp-natural-prose/${name}.png` });
        reports.push({ name, ...measure });
    }
    await page.getByRole('button', { name: '数据存储', exact: true }).click();
    await page.getByRole('switch', { name: '切换清理时保留 API 配置' }).click();
    const downloadPending = page.waitForEvent('download');
    await page.getByRole('button', { name: '导出全部设置', exact: true }).click();
    const exported = JSON.parse(await readFile(await (await downloadPending).path(), 'utf8'));
    expect(exported.settings.find(item => item.key === 'natural_prose_settings').value).toEqual({ enabled: true });
    const imported = { version: 1, type: 'moranjianghu_settings_backup', settings: [
        { key: 'natural_prose_settings', value: { enabled: false, mode: 'gemini', generalPrompt: '旧配置不再运行', claudePrompt: '旧Claude', geminiPrompt: '旧Gemini' } },
        { key: 'api_settings', value: { activeConfigId: 'must-not-replace' } }
    ] };
    await page.getByRole('button', { name: '导入全部设置', exact: true }).click();
    const chooserPending = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: '继续导入', exact: true }).click();
    await (await chooserPending).setFiles({ name: 'settings.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(imported)) });
    await expect(page.getByText(/导入完成：已应用 1 项设置，跳过 1 项/).first()).toBeVisible();
    expect(await readSetting('natural_prose_settings')).toEqual({ enabled: false });
    expect((await readSetting('api_settings')).activeConfigId).toBe('local-test');
    reports.push({ settingsExportImport: true, legacySettingsNormalized: true, preserveApi: true });
    await page.reload();
    await page.getByRole('button', { name: '本地游玩', exact: true }).click();
    await page.getByRole('button', { name: '重入江湖', exact: true }).click();
    const saveCard = page.locator('div.cursor-pointer', { hasText: '点击本系列会直接读取最新存档' }).first();
    await saveCard.click();
    const read = page.getByRole('button', { name: '读取', exact: true }).last();
    if (!await read.isVisible().catch(() => false)) await page.getByRole('button', { name: '读取最新存档' }).click();
    await read.click();
    await expect(page.locator('.desktop-game-frame')).toBeVisible({ timeout: 20000 });
    reports.push({ oldSaveLoaded: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole('button', { name: /设置$/ }).first().click();
    await page.getByRole('button', { name: '游戏', exact: true }).click();
    row = page.getByRole('group', { name: '自然文风修复', exact: true });
    await expect(row.getByRole('switch')).toBeEnabled();
    await expect(row.getByRole('switch')).not.toBeChecked();
    await row.getByRole('switch').click();
    await expect.poll(() => readSetting('natural_prose_settings')).toEqual({ enabled: true });
    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'day'));
    const mobile = await row.evaluate(el => ({ height: el.getBoundingClientRect().height, scroll: el.scrollWidth, client: el.clientWidth,
        color: getComputedStyle(el.querySelector('.text-gray-400')).color }));
    expect(mobile.scroll).toBeLessThanOrEqual(mobile.client + 1);
    expect(mobile.height).toBeLessThan(110);
    await expect(row.getByRole('textbox')).toHaveCount(0);
    await expect(row.getByRole('combobox')).toHaveCount(0);
    await row.screenshot({ path: '.tmp-natural-prose/mobile-day.png' });
    await page.reload();
    await page.getByRole('button', { name: '设置', exact: true }).click();
    await page.getByRole('button', { name: '游戏', exact: true }).click();
    await expect(page.getByRole('switch', { name: '切换自然文风修复' })).toBeChecked();
    reports.push({ name: 'mobile-day', ...mobile, persistedAfterReloadAndSaveLoad: true });
    expect(errors).toEqual([]);
    await readFile('.tmp-natural-prose/mobile-day.png');
    console.log(JSON.stringify({ result: 'PASS', reports }, null, 2));
    await browser.close(); browser = null;
} finally {
    await browser?.close(); await new Promise(resolve => server.close(resolve));
}
