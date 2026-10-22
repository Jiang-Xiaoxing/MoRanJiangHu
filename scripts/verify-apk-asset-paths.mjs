// 发布前强制闸门：检查待发布 APK 的 index.html 资源路径是否被 Git Bash 的
// MSYS 路径转换污染（如 /f/code/... → /workbuddy/resources/vendor/PortableGit/...）。
//
// 历史事故：v1.0.674 与 v1.0.675 的 APK 都因 index.html 里的资源路径被展开成
// PortableGit 安装目录，导致主 bundle 404 → 100% 黑屏。玩家反馈「重新下载还是黑屏」。
//
// 用法：node .workbuddy/tools/verify-apk-asset-paths.mjs [apkPath]
// 不传则用默认 release 产物。退出码非 0 = 禁止发布。
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = 'F:/code/MoRanJiangHu';
const APK = process.argv[2] || path.join(ROOT, 'android/app/build/outputs/apk/release/app-release.apk');

if (!fs.existsSync(APK)) {
  console.error(`FAIL 未找到 APK: ${APK}`);
  process.exit(2);
}

// 用 python 解压（Node 无内置 zip 读取）。
// ⚠️ 必须用 stdio:'inherit'——本机 spawnSync 默认管道会 EBUSY（垫片也救不了 execFileSync）。
const PY = process.env.PYTHON_BIN || 'C:/Users/64855/.workbuddy/binaries/python/versions/3.13.12/python.exe';
const script = `
import zipfile, re, sys, json
z = zipfile.ZipFile(r'''${APK.replace(/\\/g, '/')}''')
names = set(z.namelist())
idx = [n for n in names if n.endswith('assets/public/index.html')]
if not idx:
    print(json.dumps({'fatal': 'APK 内找不到 assets/public/index.html'})); sys.exit()
html = z.read(idx[0]).decode('utf-8', 'ignore')
refs = re.findall(r'(?:src|href)="([^"]+)"', html)
missing, portable, local = [], [], []
for r in refs:
    if r.startswith('http://') or r.startswith('https://') or r.startswith('data:'):
        continue
    local.append(r)
    if 'PortableGit' in r or '/workbuddy/' in r:
        portable.append(r)
    if ('assets/public' + r) not in names:
        missing.append(r)
print(json.dumps({'refs': local, 'missing': missing, 'portable': portable}, ensure_ascii=False))
`;

const proc = spawnSync(PY, ['-c', script], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
if (!proc.stdout || proc.status !== 0) {
  console.error('FAIL 无法读取 APK（python 探测失败）');
  if (proc.stderr) console.error(proc.stderr.slice(0, 500));
  process.exit(2);
}
const r = JSON.parse(String(proc.stdout).trim());

console.log(`检查 APK: ${APK}`);
if (r.fatal) {
  console.error(`FAIL ${r.fatal}`);
  process.exit(2);
}

console.log(`  本地资源引用 ${r.refs.length} 条`);

let bad = false;
if (r.portable.length) {
  bad = true;
  console.error(`\nFAIL 检测到 MSYS 路径转换污染（${r.portable.length} 条），这会导致 100% 黑屏：`);
  r.portable.forEach((x) => console.error(`  ${x}`));
  console.error('\n成因：构建时 Git Bash 把 /f/code/... 展开成 PortableGit 安装目录。');
  console.error('修法：所有 robocopy 必须加 MSYS2_ARG_CONV_EXCL=\'*\'；');
  console.error('      并确认 vite build 产出的 index.html 用的是 --base=/ 而非被转换的路径。');
}

if (r.missing.length) {
  bad = true;
  console.error(`\nFAIL 有 ${r.missing.length} 条引用的文件不在 APK 内（必然 404）：`);
  r.missing.forEach((x) => console.error(`  ${x}`));
}

if (bad) process.exit(1);

console.log('\nPASS 资源路径干净，且全部引用文件都在 APK 内。');
