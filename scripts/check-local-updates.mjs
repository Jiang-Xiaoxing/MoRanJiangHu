import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { connect } from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const officialRemote = 'https://github.com/ypq123456789/MoRanJiangHu.git';
const gitEnv = { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never' };

function git(args, timeout = 7000) {
  return execFileSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    timeout,
    windowsHide: true,
    env: gitEnv,
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function proxyIsOpen() {
  return new Promise((resolve) => {
    const socket = connect({ host: '127.0.0.1', port: 7897 });
    const finish = (open) => {
      socket.destroy();
      resolve(open);
    };
    socket.setTimeout(500);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
  });
}

function readRemoteHead(proxyUrl = '') {
  const flags = proxyUrl
    ? ['-c', `http.proxy=${proxyUrl}`, '-c', `https.proxy=${proxyUrl}`]
    : ['-c', 'http.proxy=', '-c', 'https.proxy='];
  const output = git([...flags, 'ls-remote', '--exit-code', 'origin', 'refs/heads/main']);
  const sha = output.split(/\s+/)[0];
  if (!/^[0-9a-f]{40}$/i.test(sha)) throw new Error('Invalid remote commit');
  return sha.toLowerCase();
}

function report(status, message, current = '', remote = '') {
  const line = `[墨色江湖] ${message}`;
  console.log(line);
  const logs = join(root, 'local-logs');
  mkdirSync(logs, { recursive: true });
  writeFileSync(join(logs, 'update-status.json'), `${JSON.stringify({
    checkedAt: new Date().toISOString(), status, current, remote, message,
  }, null, 2)}\n`, 'utf8');
}

try {
  const origin = git(['remote', 'get-url', 'origin'], 2000);
  if (origin !== officialRemote) {
    report('unavailable', 'Git 远端地址与原仓库不一致，已跳过更新检查；网站仍会正常启动。');
    process.exit(0);
  }

  const current = git(['rev-parse', 'HEAD'], 2000).toLowerCase();
  let remote;
  try {
    remote = readRemoteHead();
  } catch {
    if (await proxyIsOpen()) remote = readRemoteHead('http://127.0.0.1:7897');
    else throw new Error('GitHub unavailable');
  }

  if (remote === current) {
    report('current', `已检查 GitHub：当前是最新 main（${current.slice(0, 7)}）。`, current, remote);
  } else {
    report('update_available', `GitHub 版本有变化：本地 ${current.slice(0, 7)}，远端 ${remote.slice(0, 7)}。请让我帮你安全更新，现有 ComfyUI 配置不会被自动覆盖。`, current, remote);
  }
} catch {
  report('unavailable', '这次无法检查 GitHub 更新；本地网站仍会正常启动。');
}
