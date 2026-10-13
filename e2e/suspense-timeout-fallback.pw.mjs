import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

/**
 * 挂起超时兜底（SuspenseTimeoutBoundary）端到端验证。
 *
 * 背景：v1.0.682 修复「读档后界面卡在『卷轴展开中…』无法进入游戏」——
 * ErrorBoundary 抓不到 Suspense 挂起，chunk Promise 永久 pending 时 fallback
 * 永久显示，玩家没有任何自救入口。本测试用「路由永不应答」真实复现
 * chunk 永久挂起，验证：
 *   1. 正常路径不受影响（读档 → 游戏界面渲染 → 懒面板可开）；
 *   2. 非游戏态：20s 后浮层带「关闭本界面 / 刷新整个页面」双出口；
 *   3. 游戏态：20s 后浮层提示进度不丢失、不给整页刷新（view 不持久化，
 *      刷新 = 丢对局），「关闭提示」只收浮层不重挂载子树。
 *
 * 前置：先构建并预览 dist（默认 http://127.0.0.1:4173，可用 E2E_BASE_URL 覆盖）。
 * 用法：npx playwright test e2e/suspense-timeout-fallback.pw.mjs
 */

const baseSave = JSON.parse(readFileSync('e2e/fixtures/desktop-compact-save.json', 'utf8'));

const compactOptions = [
    '上前询问掌柜昨夜城中异象的来龙去脉',
    '暂不声张，先观察四周是否有可疑人物',
    '取出地图，对照当前地点规划下一段行程',
    '邀请杨青儿同行前往城西旧宅探查',
    '检查随身物品，确认药品与兵器是否齐备',
    '向附近住客打听最近失踪人口的消息',
    '返回房间整理线索并记录关键人物关系',
    '前往集市购买干粮与夜间照明用的火折子',
    '拜访城中镖局，询问是否接到异常委托',
    '沿河岸搜索可能遗留的脚印与衣物碎片',
    '在客栈大厅等待，观察谁会主动前来接触',
    '写信通知旧友，请他协助调查城外山道',
    '先休息片刻，恢复精力后再继续行动',
    '直接前往衙门，将掌握的线索告知捕头',
    '隐去身份独自夜探，不让其他人卷入危险',
    '重新梳理时间线，寻找证词之间的矛盾之处',
    '去药铺询问近期是否有人大量购买迷药',
    '留在原地继续修炼，等待新的江湖消息',
];

const closeReleaseNotesIfOpen = async (page) => {
    const closeButton = page.locator('button[aria-label="关闭更新日志"]');
    await closeButton.waitFor({ state: 'visible', timeout: 2500 }).catch(() => {});
    if (await closeButton.count() && await closeButton.first().isVisible().catch(() => false)) {
        await closeButton.first().click({ timeout: 3000, force: true });
    }
};

const clickByTexts = async (page, texts) => {
    for (const text of texts) {
        const button = page.getByRole('button', { name: new RegExp(text) }).first();
        if (await button.count() && await button.isVisible().catch(() => false)) {
            await button.click({ timeout: 5000, force: true });
            return true;
        }
        const locator = page.getByText(text, { exact: false }).first();
        if (await locator.count() && await locator.isVisible().catch(() => false)) {
            await locator.click({ timeout: 5000, force: true });
            return true;
        }
    }
    return false;
};

const makeSeedSave = () => {
    const save = structuredClone(baseSave);
    save.id = 13660768;
    save.类型 = 'manual';
    save.时间戳 = 1785250000000;
    save.元数据 = {
        ...(save.元数据 || {}),
        名称: '1366短屏适配验证',
        现实保存时间戳: 1785250000000,
        历史记录条数: 2,
        历史记录是否裁剪: false,
    };
    save.历史记录 = [
        { role: 'user', content: '检查短屏布局。' },
        {
            role: 'assistant',
            content: 'Structured Response',
            structuredResponse: {
                logs: [
                    {
                        sender: '旁白',
                        text: '暮色落在客栈檐角，厅中人声渐低。你将沿途所得线索逐一铺开，准备决定下一步行动。',
                    },
                ],
                shortTerm: '正在客栈整理调查线索。',
                action_options: compactOptions,
            },
        },
    ];
    return save;
};

const injectSaveAndReload = async (page, targetUrl) => {
    await page.goto(targetUrl, { waitUntil: 'networkidle' });
    await closeReleaseNotesIfOpen(page);
    await page.evaluate(async (payload) => {
        const request = indexedDB.open('WuxiaGameDB');
        const db = await new Promise((resolve, reject) => {
            request.onerror = () => reject(request.error);
            request.onsuccess = () => resolve(request.result);
        });
        await new Promise((resolve, reject) => {
            const transaction = db.transaction(['saves', 'save_summaries'], 'readwrite');
            transaction.objectStore('saves').clear();
            transaction.objectStore('save_summaries').clear();
            transaction.objectStore('saves').put(payload);
            transaction.objectStore('save_summaries').put({
                id: payload.id,
                类型: payload.类型,
                时间戳: payload.时间戳,
                元数据: payload.元数据,
                游戏初始时间: payload.游戏初始时间,
                角色数据: payload.角色数据,
                环境信息: payload.环境信息,
            });
            transaction.oncomplete = () => resolve();
            transaction.onerror = () => reject(transaction.error);
        });
        db.close();
    }, makeSeedSave());
    await page.reload({ waitUntil: 'networkidle' });
    await closeReleaseNotesIfOpen(page);
};

/** 走完「本地游玩 → 重入江湖 → 点存档卡片 → 确认读取 → 游戏界面渲染」。 */
const loadCompactGame = async (page, targetUrl) => {
    await injectSaveAndReload(page, targetUrl);
    await expect.poll(() => clickByTexts(page, ['本地游玩'])).toBe(true);
    await expect.poll(() => clickByTexts(page, ['重入江湖', '读取进度', '继续游戏', '读取', '载入'])).toBe(true);

    const saveCard = page.locator('div.cursor-pointer', { hasText: '点击本系列会直接读取最新存档' }).first();
    await expect(saveCard).toBeVisible({ timeout: 10000 });
    await saveCard.click({ position: { x: 24, y: 80 }, force: true });

    const confirmReadButton = page.getByRole('button', { name: /^读取$/ }).last();
    if (!await confirmReadButton.isVisible().catch(() => false)) {
        const latestSaveButton = page.getByRole('button', { name: '读取最新存档' });
        await expect(latestSaveButton).toBeVisible({ timeout: 5000 });
        await latestSaveButton.click({ timeout: 5000, force: true });
    }
    await expect(confirmReadButton).toBeVisible({ timeout: 5000 });
    await confirmReadButton.click({ timeout: 5000, force: true });
    await expect(page.locator('.desktop-quick-actions')).toBeVisible({ timeout: 15000 });
};

const suppressReleaseNotes = (page) => page.addInitScript(() => {
    localStorage.setItem('moranjianghu.releaseNotesSuppressDate', new Date().toISOString().slice(0, 10));
});

/** 致命错误签名（白屏/hook 崩坏类），出现即判定渲染失败。 */
const FATAL_SIGNATURES = [
    /Cannot read properties of null \(reading 'useRef'\)/,
    /Invalid hook call/i,
    /Minified React error #321/,
];

test('读档后游戏界面完整渲染，懒加载面板可正常打开与关闭', async ({ page }) => {
    test.setTimeout(90000);
    const targetUrl = process.env.E2E_BASE_URL || 'http://127.0.0.1:4173';
    await page.setViewportSize({ width: 1366, height: 900 });
    await suppressReleaseNotes(page);

    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(String((error && error.stack) || error)));

    await loadCompactGame(page, targetUrl);

    // 对局真实渲染：fixture 历史里的 18 条行动选项全部画出
    await expect(page.locator('.desktop-quick-action-button')).toHaveCount(compactOptions.length);
    // 没有任何常驻转圈
    expect(await page.locator('.lazy-scroll-title').count()).toBe(0);

    // 懒加载面板：角色档案正常打开（chunk 加载 → 转圈消失 → 标题出现）
    await page.getByTitle('查看角色档案').click();
    await expect(page.getByRole('heading', { name: '角色档案' })).toBeVisible({ timeout: 20000 });
    expect(await page.locator('.lazy-scroll-title').count()).toBe(0);

    // 关闭后面板卸载，游戏界面保持
    await page.getByTitle('关闭').first().click();
    await expect(page.getByRole('heading', { name: '角色档案' })).toHaveCount(0);
    await expect(page.locator('.desktop-quick-actions')).toBeVisible();

    const fatal = pageErrors.filter((text) => FATAL_SIGNATURES.some((re) => re.test(text)));
    expect(fatal, `页面致命错误: ${fatal.join(' | ')}`).toEqual([]);
});

test('非游戏态 chunk 永久挂起：20s 后浮层给出关闭/刷新双出口', async ({ page }) => {
    test.setTimeout(120000);
    const targetUrl = process.env.E2E_BASE_URL || 'http://127.0.0.1:4173';
    await page.setViewportSize({ width: 1366, height: 900 });
    await suppressReleaseNotes(page);

    // 存档面板 chunk 永不应答 = 生产环境「请求一直 pending」
    await page.route(/SaveLoadModal[^/]*\.js$/, () => {
        /* 故意不 continue：模拟 chunk 永久挂起 */
    });

    await injectSaveAndReload(page, targetUrl);
    await expect.poll(() => clickByTexts(page, ['本地游玩'])).toBe(true);
    await clickByTexts(page, ['重入江湖']);

    // 挂起期间显示卷轴转圈
    await expect(page.locator('.lazy-scroll-title')).toBeVisible({ timeout: 15000 });

    // 20s（面板级 timeoutMs）后弹出可操作浮层
    await expect(page.getByText('界面加载超时')).toBeVisible({ timeout: 30000 });
    await expect(page.getByText('关闭本界面', { exact: false }).first()).toBeVisible();

    // 非游戏态必须保留整页刷新入口（此时没有进行中的对局）
    await expect(page.getByRole('button', { name: '刷新整个页面' })).toBeVisible();

    // 「关闭本界面」= 调用方面板关闭出口：浮层消失且回到可用首页
    await page.getByRole('button', { name: '关闭本界面' }).click();
    await expect(page.getByText('界面加载超时')).toHaveCount(0);
    await expect(page.getByRole('button', { name: '本地游玩' })).toBeVisible();
});

test('游戏态 chunk 永久挂起：浮层保进度不驱客，关闭后对局仍在', async ({ page }) => {
    test.setTimeout(150000);
    const targetUrl = process.env.E2E_BASE_URL || 'http://127.0.0.1:4173';
    await page.setViewportSize({ width: 1366, height: 900 });
    await suppressReleaseNotes(page);

    // 角色面板 chunk 永不应答（读档预热也会拉它，二次 import 复用同一 pending 请求）
    await page.route(/CharacterModal[^/]*\.js$/, () => {
        /* 故意不 continue：模拟 chunk 永久挂起 */
    });

    // 主界面不依赖该 chunk，正常进入游戏
    await loadCompactGame(page, targetUrl);
    await expect(page.locator('.desktop-quick-actions')).toBeVisible();

    // 打开角色面板 → chunk 挂起
    await page.getByTitle('查看角色档案').click();
    await expect(page.locator('.lazy-scroll-title')).toBeVisible({ timeout: 15000 });

    // 20s 后浮层：游戏态文案
    await expect(page.getByText('界面加载超时')).toBeVisible({ timeout: 30000 });
    await expect(page.getByText('进度不会因此丢失')).toBeVisible();

    // 游戏态禁止整页刷新（view 不持久化，刷新 = 丢掉未保存对局）
    await expect(page.getByRole('button', { name: '刷新整个页面' })).toHaveCount(0);

    // 出口是「关闭提示，先保存进度」：只收浮层 + 通知调用方关面板，不重挂载子树
    const dismissButton = page.getByRole('button', { name: '关闭提示，先保存进度' });
    await expect(dismissButton).toBeVisible();
    await dismissButton.click();

    // 浮层消失、面板已关、游戏界面与对局状态保持
    await expect(page.getByText('界面加载超时')).toHaveCount(0);
    await expect(page.getByRole('heading', { name: '角色档案' })).toHaveCount(0);
    await expect(page.locator('.desktop-quick-actions')).toBeVisible();
    await expect(page.locator('.desktop-quick-action-button')).toHaveCount(compactOptions.length);
    await expect(page.getByTitle('查看角色档案')).toBeVisible();
});
