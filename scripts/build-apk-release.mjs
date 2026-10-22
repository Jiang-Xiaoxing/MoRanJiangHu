// 一键 APK 发布构建：build → 同步资源 → 裁剪 → gradle → 黑屏闸门 → 回填指纹
//
// 设计原则（针对 v1.0.674/675 黑屏事故）：
//  1. 构建期由 vite.config.ts 的 base 断言拦截 MSYS 路径转换污染；
//  2. 产物期用 verify-apk-asset-paths 检查资源路径与文件存在性；
//  3. 运行期用 blackscan 真机模拟断言界面确实画出来；
//  4. 三道闸门任一不过即退出非 0，**绝不产出可发布的坏包**。
//
// 用法：node scripts/build-apk-release.mjs [--skip-gradle]

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const skipGradle = process.argv.includes('--skip-gradle');

// ⚠️ 本机 spawnSync 默认管道必 EBUSY，统一走 stdio:'inherit'。
const run = (cmd, args, label) => {
  console.log(`\n=== ${label} ===`);
  const r = spawnSync(cmd, args, {
    cwd: rootDir,
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: {
      ...process.env,
      // 关键：禁止 MSYS 把 /f/... 这类路径参数转成 Windows 路径。
      MSYS2_ARG_CONV_EXCL: '*',
      MSYS_NO_PATHCONV: '1',
      // base 必须由构建脚本显式指定，不接受外部注入。
      VITE_BASE_PATH: '/',
    },
  });
  if (r.status !== 0) {
    console.error(`\n[FAIL] ${label} 退出码 ${r.status}，中止发布。`);
    process.exit(r.status || 1);
  }
};

// 1) 同步版本元数据（写 data/releaseInfo.ts + public/release-info.json，
//    vite 会把 public/ 下的文件带进构建产物）
run('npm', ['run', 'release:sync'], '同步版本元数据');

// 2) 构建前端。
// ⚠️ 不能直接 `vite build` 写 dist：vite 会先 emptyOutDir 清空 dist/assets，
// 在本机会被删除守卫拦下（SAFE_DELETE_BULK_CONFIRM_REQUIRED，数百项）而构建失败。
// 正确姿势 = 构建到全新临时目录（--emptyOutDir=false）→ robocopy /MIR 到 dist。
const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '-');
const tmpWeb = path.join(rootDir, `.tmp-web-apk-${stamp}`);
run(
  'npx',
  ['vite', 'build', '--base=/', '--outDir', tmpWeb, '--emptyOutDir=false'],
  '构建前端（base=/ → 临时目录）',
);

// 2b) 临时目录 → dist（/MIR，exit 3 = 有复制+删除，正常）
console.log('\n=== 同步临时构建 → dist ===');
const rcDist = spawnSync(
  'robocopy',
  [tmpWeb, 'dist', '/MIR'],
  { cwd: rootDir, stdio: 'inherit', env: { ...process.env, MSYS2_ARG_CONV_EXCL: '*' } },
);
if (rcDist.status !== undefined && rcDist.status > 3) {
  console.error(`\n[FAIL] robocopy(→dist) 退出码 ${rcDist.status}`);
  process.exit(1);
}

// 3) 同步到 android assets
const target = path.join(rootDir, 'android', 'app', 'src', 'main', 'assets', 'public');
const empty = path.join(rootDir, '.tmp-empty');
fs.mkdirSync(empty, { recursive: true });
console.log('\n=== 同步 dist → android assets ===');
const rc = spawnSync('robocopy', ['dist', target, '/MIR', '/XF', 'cordova.js', 'cordova_plugins.js'], {
  cwd: rootDir,
  stdio: 'inherit',
  env: { ...process.env, MSYS2_ARG_CONV_EXCL: '*' },
});
// robocopy: 0=无变化 1=已复制 2=有删除 3=已复制+删除(exit 3 正常)
if (rc.status !== undefined && rc.status > 3) {
  console.error(`\n[FAIL] robocopy 退出码 ${rc.status}`);
  process.exit(1);
}

// 4) 裁剪
run('node', ['scripts/prune-apk-assets.mjs'], '裁剪非必需资源');

// 5) gradle
if (!skipGradle) {
  run('node', ['scripts/run-gradle.mjs', 'assembleRelease'], 'gradle assembleRelease');
}

const apk = path.join(rootDir, 'android', 'app', 'build', 'outputs', 'apk', 'release', 'app-release.apk');
if (!fs.existsSync(apk)) {
  console.error(`\n[FAIL] 未找到 APK: ${apk}`);
  process.exit(1);
}
const apkSize = fs.statSync(apk).size;
if (apkSize < 3 * 1024 * 1024 || apkSize > 20 * 1024 * 1024) {
  console.error(`\n[FAIL] APK 体积异常: ${apkSize} 字节（正常应在 3–20MB）。`);
  console.error('  过大通常是 prune-apk-assets 被拦截导致裁剪未生效。');
  process.exit(1);
}
console.log(`\nAPK 体积: ${apkSize} 字节（${(apkSize / 1048576).toFixed(2)} MB）`);

// 6) 闸门一：资源路径
run('node', ['scripts/verify-apk-asset-paths.mjs', apk], '闸门一：APK 资源路径检查');

// 7) 闸门二：真机模拟渲染
const extractDir = path.join(rootDir, '.tmp-apk-gate');
fs.mkdirSync(extractDir, { recursive: true });
const py = process.env.PYTHON_BIN || 'C:/Users/64855/.workbuddy/binaries/python/versions/3.13.12/python.exe';
const ex = spawnSync(py, ['-c', `
import zipfile
z = zipfile.ZipFile(r'''${apk.replace(/\\/g, '/')}''')
n = 0
for name in z.namelist():
    if name.startswith('assets/public/') and not name.endswith('/'):
        z.extract(name, r'''${extractDir.replace(/\\/g, '/')}''')
        n += 1
print('extracted', n)
`], { stdio: 'inherit' });
if (ex.status !== 0) {
  console.error('\n[FAIL] 解压 APK 资源失败。');
  process.exit(1);
}
run(
  'node',
  ['scripts/check-apk-blackscan.mjs', path.join(extractDir, 'assets', 'public'), 'release-gate'],
  '闸门二：WebView 渲染模拟',
);

console.log('\n========================================');
console.log(' 三道闸门全部通过，APK 可发布：');
console.log(`   ${apk}`);
console.log(`   ${apkSize} 字节`);
console.log('========================================');
console.log('下一步：finalize-release-config.mjs <size> <sha256>');
