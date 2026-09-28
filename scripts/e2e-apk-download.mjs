import { chromium } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const targetUrl = process.argv[2] || 'http://127.0.0.1:4173/';
const expectedVersion = process.argv[3] || '';
const shouldMockDownload = process.argv.includes('--mock-apk');
const minApkBytesArg = process.argv.find((arg) => arg.startsWith('--min-apk-bytes='));
// 阈值只需拦掉「返回 HTML 报错页」这类明显异常，不能高于真实产物体积。
// APK 自 v1.0.6xx 起在构建时裁剪 item-presets / auction-items（改由站点远程 URL 提供），
// 体积稳定在 ~5.9MB；原先写死 10MB 会把正常产物误判为失败（v1.0.669/1.0.670 均已复现）。
const minApkBytes = Number(minApkBytesArg?.split('=')[1] || (shouldMockDownload ? 16 : 1 * 1024 * 1024));

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  acceptDownloads: true,
  viewport: { width: 1280, height: 820 }
});
const page = await context.newPage();

try {
  if (shouldMockDownload) {
    await page.route('**/api/apk/latest.apk**', async (route) => {
      await route.fulfill({
        status: 200,
        headers: {
          'Content-Type': 'application/vnd.android.package-archive',
          'Content-Disposition': 'attachment; filename="MoRanJiangHu-e2e.apk"',
          'Cache-Control': 'no-store'
        },
        body: Buffer.from('PK\u0003\u0004 fake apk payload for download e2e')
      });
    });
  }

  await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await page.waitForTimeout(2_000);

  const bodyText = await page.locator('body').innerText({ timeout: 15_000 });
  if (expectedVersion && !bodyText.includes(expectedVersion)) {
    throw new Error(`首页未显示预期版本：${expectedVersion}`);
  }

  const closeButton = page.getByRole('button', { name: '关闭更新日志', exact: true });
  if (await closeButton.count()) {
    await closeButton.click({ timeout: 10_000 });
  } else {
    const fallbackCloseButton = page.getByRole('button', { name: '×', exact: true });
    if (await fallbackCloseButton.count()) {
      await fallbackCloseButton.click({ timeout: 10_000 });
    }
  }

  const downloadButton = page.getByRole('button', { name: 'APK 下载', exact: true });
  await downloadButton.waitFor({ state: 'visible', timeout: 15_000 });

  const downloadPromise = page.waitForEvent('download', { timeout: 120_000 });
  await downloadButton.click();
  const download = await downloadPromise;
  if (/latest\.apk/i.test(page.url())) {
    throw new Error(`点击 APK 下载后页面发生跳转：${page.url()}`);
  }

  const suggestedFilename = download.suggestedFilename();
  if (!/\.apk$/i.test(suggestedFilename)) {
    throw new Error(`下载文件名不是 APK：${suggestedFilename}`);
  }

  const downloadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'moranjianghu-apk-e2e-'));
  const savePath = path.join(downloadDir, suggestedFilename);
  await download.saveAs(savePath);
  const apkBuffer = fs.readFileSync(savePath);
  if (apkBuffer.byteLength < minApkBytes) {
    const preview = apkBuffer.subarray(0, 96).toString('utf8');
    throw new Error(`APK 下载文件过小：${apkBuffer.byteLength} bytes，开头内容：${preview}`);
  }
  if (apkBuffer[0] !== 0x50 || apkBuffer[1] !== 0x4b) {
    const preview = apkBuffer.subarray(0, 96).toString('utf8');
    throw new Error(`APK 下载文件头不正确，开头内容：${preview}`);
  }

  console.log(JSON.stringify({
    ok: true,
    targetUrl,
    suggestedFilename,
    finalUrl: page.url(),
    bytes: apkBuffer.byteLength
  }, null, 2));
} finally {
  await browser.close();
}
