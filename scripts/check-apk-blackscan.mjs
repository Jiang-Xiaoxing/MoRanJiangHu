// 对任意已解压的 APK 资源目录跑黑屏检测。用法：
//   node check-apk-blackscan.mjs <解压后的 assets/public 目录> <输出名>
import { chromium, devices } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const WEB = path.resolve(process.argv[2] || 'F:/code/MoRanJiangHu/.tmp-apk-webview/assets/public');
const NAME = process.argv[3] || 'scan';
const PORT = 39420 + Math.floor(Math.random() * 300);

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp',
};

const hits = { ok: [], miss: [] };
const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  let rel = decodeURIComponent(url.pathname);
  if (rel === '/' || rel === '') rel = '/index.html';
  // Windows: path.join(WEB, '/x') 会因前导斜杠变成绝对路径；且分隔符需统一
  const file = path.resolve(path.join(WEB, rel.replace(/^\/+/, '')));
  if (!file.startsWith(WEB) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    hits.miss.push(rel);
    res.writeHead(404, { 'content-type': 'text/plain' });
    return res.end('not found');
  }
  hits.ok.push(rel);
  res.writeHead(200, { 'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' });
  res.end(fs.readFileSync(file));
});
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));

const browser = await chromium.launch();
const ctx = await browser.newContext({ ...devices['Pixel 7'], serviceWorkers: 'block' });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${String(e.message).slice(0, 200)}`));
page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text().slice(0, 160)}`); });

await ctx.route('**/*', (route) => {
  const u = route.request().url();
  if (u.startsWith(`http://127.0.0.1:${PORT}/`)) return route.continue();
  return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
});

const t0 = Date.now();
await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'domcontentloaded', timeout: 60000 });
let firstContentMs = null;
try {
  await page.waitForFunction(
    () => (document.getElementById('root')?.innerText || '').includes('墨色江湖'),
    { timeout: 30000 },
  );
  firstContentMs = Date.now() - t0;
} catch { /* 未渲染 = 黑屏 */ }
await page.waitForTimeout(1500);

const state = await page.evaluate(() => ({
  rootLen: document.getElementById('root')?.innerHTML.length ?? -1,
  overlay: !!document.getElementById('moran-preboot-error-overlay'),
  overlayText: document.getElementById('moran-preboot-error-overlay')?.textContent?.slice(0, 300) || null,
  text: (document.body.innerText || '').trim().slice(0, 120),
}));

await page.screenshot({ path: `F:/code/MoRanJiangHu/.workbuddy/blackscan-${NAME}.png` });
const verdict = state.rootLen > 500 ? 'RENDER_OK' : 'BLACKSCREEN';
console.log(JSON.stringify({
  name: NAME, verdict, firstContentMs, state,
  missedCount: hits.miss.length,
  missed: [...new Set(hits.miss)].slice(0, 8),
  errors: errors.slice(0, 4),
}, null, 2));
fs.writeFileSync(`F:/code/MoRanJiangHu/.tmp-blackscan-${NAME}.json`, JSON.stringify({ NAME, verdict, firstContentMs, state, misses: [...new Set(hits.miss)] }, null, 2), 'utf8');

await browser.close();
server.close();
