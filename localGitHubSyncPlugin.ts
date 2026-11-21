import { execFile } from 'node:child_process';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { Readable } from 'node:stream';
import { promisify } from 'node:util';
import type { Plugin } from 'vite';

const execFileAsync = promisify(execFile);
const LOCAL_ORIGIN = 'http://127.0.0.1:3000';
const LOCAL_HOST = '127.0.0.1:3000';
const API_ORIGIN = 'https://api.github.com';
const CLOUD_TAG = 'wuxia-cloud-sync';
const CLOUD_DESCRIPTION = 'WuXia 私有云存档仓库';
const CLOUD_RELEASE_NAME = 'WuXia Cloud Sync';
const MAX_API_BODY_BYTES = 32 * 1024;
const MAX_UPLOAD_BYTES = 512 * 1024 * 1024;
const MAX_PART_UPLOAD_BYTES = 8 * 1024 * 1024;
const MAX_MANIFEST_UPLOAD_BYTES = 1024 * 1024;
const REPO_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
const LOGIN_NAME = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/;
const ASSET_ID = /^[1-9][0-9]*$/;
const CLOUD_ASSET = /^(?:WuXia_Save_Data\.zip|WuXia_Save_Data\.parts\.json|WuXia_Save_Data\.part[0-9]{3,}|WuXia_Settings_Data\.zip)$/;

type CloudRepo = { owner: string; repo: string };
type CloudRelease = { id: number; tag_name: string; assets?: Array<{ id: number; name: string }> };
type ApiRoute =
  | { kind: 'user'; method: 'GET'; url: URL }
  | { kind: 'repo'; method: 'GET'; url: URL; repo: CloudRepo }
  | { kind: 'create-repo'; method: 'POST'; url: URL }
  | { kind: 'release'; method: 'GET' | 'POST'; url: URL; repo: CloudRepo }
  | { kind: 'asset-delete'; method: 'DELETE'; url: URL; repo: CloudRepo; assetId: number };

class LocalSyncError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const header = (req: IncomingMessage, name: string): string => {
  const value = req.headers[name.toLowerCase()];
  return typeof value === 'string' ? value : '';
};

const sendJson = (res: ServerResponse, status: number, payload: unknown): void => {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.end(JSON.stringify(payload));
};

const isAllowedLocalRequest = (req: IncomingMessage): boolean => {
  const origin = header(req, 'origin');
  const fetchSite = header(req, 'sec-fetch-site');
  return header(req, 'host') === LOCAL_HOST
    && header(req, 'x-local-msjh-sync') === '1'
    && (!origin || origin === LOCAL_ORIGIN)
    && (!fetchSite || fetchSite === 'same-origin' || fetchSite === 'none');
};

const isCloudAssetName = (name: string): boolean => CLOUD_ASSET.test(name)
  && (!name.startsWith('WuXia_Save_Data.part')
    || name === 'WuXia_Save_Data.parts.json'
    || Number(name.slice('WuXia_Save_Data.part'.length)) > 0);

const parseGitHubUrl = (raw: string, hostname: string): URL => {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new LocalSyncError(400, 'GitHub 地址格式无效');
  }
  if (url.protocol !== 'https:' || url.hostname !== hostname || url.port
    || url.username || url.password || url.hash) {
    throw new LocalSyncError(400, 'GitHub 地址不在允许范围内');
  }
  return url;
};

const parseRepo = (owner: string, repo: string): CloudRepo => {
  if (!LOGIN_NAME.test(owner) || !REPO_NAME.test(repo) || repo === '.' || repo === '..') {
    throw new LocalSyncError(400, 'GitHub 仓库路径无效');
  }
  return { owner, repo };
};

const parseApiRoute = (rawUrl: string, rawMethod: string): ApiRoute => {
  const url = parseGitHubUrl(rawUrl, 'api.github.com');
  if (url.search || url.pathname.endsWith('/')) {
    throw new LocalSyncError(400, '不支持该 GitHub API 地址');
  }
  const method = rawMethod.toUpperCase();
  if (method === 'GET' && url.pathname === '/user') {
    return { kind: 'user', method, url };
  }
  if (method === 'POST' && url.pathname === '/user/repos') {
    return { kind: 'create-repo', method, url };
  }
  const repoMatch = /^\/repos\/([^/]+)\/([^/]+)$/.exec(url.pathname);
  if (method === 'GET' && repoMatch) {
    return { kind: 'repo', method, url, repo: parseRepo(repoMatch[1], repoMatch[2]) };
  }
  const releaseMatch = /^\/repos\/([^/]+)\/([^/]+)\/releases(?:\/tags\/wuxia-cloud-sync)?$/.exec(url.pathname);
  if (releaseMatch) {
    const repo = parseRepo(releaseMatch[1], releaseMatch[2]);
    if (method === 'GET' && url.pathname.endsWith(`/tags/${CLOUD_TAG}`)) {
      return { kind: 'release', method, url, repo };
    }
    if (method === 'POST' && url.pathname.endsWith('/releases')) {
      return { kind: 'release', method, url, repo };
    }
  }
  const assetMatch = /^\/repos\/([^/]+)\/([^/]+)\/releases\/assets\/([1-9][0-9]*)$/.exec(url.pathname);
  if (method === 'DELETE' && assetMatch && ASSET_ID.test(assetMatch[3])) {
    return {
      kind: 'asset-delete', method, url,
      repo: parseRepo(assetMatch[1], assetMatch[2]),
      assetId: Number(assetMatch[3])
    };
  }
  throw new LocalSyncError(400, '此本机接口仅允许墨色江湖云存档所需的 GitHub API');
};

const parseJsonObject = (raw: string): Record<string, unknown> => {
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch { /* handled below */ }
  throw new LocalSyncError(400, '请求 JSON 格式无效');
};

const assertExactKeys = (value: Record<string, unknown>, allowed: string[]): void => {
  if (Object.keys(value).some((key) => !allowed.includes(key))) {
    throw new LocalSyncError(400, '云同步请求包含不支持的字段');
  }
};

const validateApiBody = (route: ApiRoute, body: string | undefined): string | undefined => {
  if (route.method !== 'POST') {
    if (body) throw new LocalSyncError(400, '此请求不接受请求体');
    return undefined;
  }
  if (!body || Buffer.byteLength(body, 'utf8') > MAX_API_BODY_BYTES) {
    throw new LocalSyncError(400, '云同步请求体无效');
  }
  const parsed = parseJsonObject(body);
  if (route.kind === 'create-repo') {
    assertExactKeys(parsed, ['name', 'description', 'private', 'auto_init']);
    if (typeof parsed.name !== 'string' || !REPO_NAME.test(parsed.name)
      || parsed.name === '.' || parsed.name === '..'
      || parsed.description !== CLOUD_DESCRIPTION
      || parsed.private !== true || parsed.auto_init !== true) {
      throw new LocalSyncError(400, '仅允许创建墨色江湖私有云存档仓库');
    }
  } else if (route.kind === 'release') {
    assertExactKeys(parsed, ['tag_name', 'name', 'body', 'draft', 'prerelease', 'generate_release_notes']);
    if (parsed.tag_name !== CLOUD_TAG || parsed.name !== CLOUD_RELEASE_NAME
      || parsed.body !== 'WuXia 云同步二进制存档。'
      || parsed.draft !== false || parsed.prerelease !== false
      || parsed.generate_release_notes !== false) {
      throw new LocalSyncError(400, '仅允许创建墨色江湖云存档 Release');
    }
  } else {
    throw new LocalSyncError(400, '此请求不接受请求体');
  }
  return JSON.stringify(parsed);
};

const readSmallBody = async (req: IncomingMessage): Promise<string> => {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.length;
    if (size > MAX_API_BODY_BYTES) throw new LocalSyncError(413, '云同步请求体过大');
    chunks.push(bytes);
  }
  return Buffer.concat(chunks).toString('utf8');
};

const getCliToken = async (): Promise<string> => {
  try {
    const { stdout } = await execFileAsync('gh', ['auth', 'token', '--hostname', 'github.com'], {
      timeout: 10000,
      maxBuffer: 8192,
      windowsHide: true
    });
    const token = stdout.trim();
    if (token) return token;
  } catch { /* CLI errors may include private details; never surface them. */ }
  throw new LocalSyncError(401, '本机 GitHub CLI 尚未登录，请先在终端运行 gh auth login');
};

const githubFetch = (token: string, url: string, init: RequestInit = {}): Promise<Response> => fetch(url, {
  ...init,
  redirect: 'manual',
  headers: {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'MoRanJiangHu-Local-Sync',
    ...init.headers
  }
});

const getLogin = async (token: string): Promise<string> => {
  const response = await githubFetch(token, `${API_ORIGIN}/user`);
  if (!response.ok) throw new LocalSyncError(401, '本机 GitHub 授权失效，请重新登录 GitHub CLI');
  const user = await response.json().catch(() => null) as { login?: unknown } | null;
  const login = typeof user?.login === 'string' ? user.login : '';
  if (!LOGIN_NAME.test(login)) throw new LocalSyncError(502, '无法确认当前 GitHub 账号');
  return login;
};

const assertOwner = (owner: string, login: string): void => {
  if (owner.toLowerCase() !== login.toLowerCase()) {
    throw new LocalSyncError(403, '只能访问当前 GitHub 账号下的云存档仓库');
  }
};

const getPrivateRepo = async (token: string, repo: CloudRepo): Promise<void> => {
  const response = await githubFetch(token, `${API_ORIGIN}/repos/${repo.owner}/${repo.repo}`);
  if (response.status === 404) throw new LocalSyncError(404, '云存档仓库不存在');
  if (!response.ok) throw new LocalSyncError(502, '无法核对云存档仓库');
  const metadata = await response.json().catch(() => null) as {
    private?: unknown; owner?: { login?: unknown }; full_name?: unknown
  } | null;
  if (metadata?.private !== true
    || String(metadata?.owner?.login || '').toLowerCase() !== repo.owner.toLowerCase()
    || String(metadata?.full_name || '').toLowerCase() !== `${repo.owner}/${repo.repo}`.toLowerCase()) {
    throw new LocalSyncError(403, '云存档仓库必须属于当前账号且为私有仓库');
  }
};

const getCloudRelease = async (token: string, repo: CloudRepo): Promise<CloudRelease> => {
  const response = await githubFetch(token, `${API_ORIGIN}/repos/${repo.owner}/${repo.repo}/releases/tags/${CLOUD_TAG}`);
  if (response.status === 404) throw new LocalSyncError(404, '云存档 Release 不存在');
  if (!response.ok) throw new LocalSyncError(502, '无法核对云存档 Release');
  const release = await response.json().catch(() => null) as CloudRelease | null;
  if (!release || release.tag_name !== CLOUD_TAG || !Number.isSafeInteger(release.id) || release.id <= 0) {
    throw new LocalSyncError(502, '云存档 Release 信息无效');
  }
  return release;
};

const isAssetInCloudRelease = async (
  token: string, repo: CloudRepo, release: CloudRelease, assetId: number, expectedName?: string
): Promise<boolean> => {
  if (!Number.isSafeInteger(assetId) || assetId <= 0) return false;
  const matches = (assets: CloudRelease['assets']): boolean => Array.isArray(assets)
    && assets.some((asset) => asset?.id === assetId && isCloudAssetName(asset.name)
      && (!expectedName || asset.name === expectedName));
  if (matches(release.assets)) return true;
  // GitHub may omit later assets from the release payload. Read its own asset list,
  // never the global asset endpoint, to prove membership before deletion/download.
  for (let page = 1; page <= 20; page += 1) {
    const response = await githubFetch(token,
      `${API_ORIGIN}/repos/${repo.owner}/${repo.repo}/releases/${release.id}/assets?per_page=100&page=${page}`);
    if (!response.ok) throw new LocalSyncError(502, '无法核对云存档附件');
    const assets = await response.json().catch(() => null) as CloudRelease['assets'];
    if (!Array.isArray(assets)) throw new LocalSyncError(502, '云存档附件列表无效');
    if (matches(assets)) return true;
    if (assets.length < 100) break;
  }
  return false;
};

const redact = (value: string, token: string): string => token ? value.replaceAll(token, '[REDACTED]') : value;

const relayApiResponse = async (res: ServerResponse, upstream: Response, token: string): Promise<void> => {
  if (upstream.status === 204) {
    res.statusCode = 204;
    res.setHeader('Cache-Control', 'no-store');
    res.end();
    return;
  }
  const body = redact(await upstream.text(), token);
  res.statusCode = upstream.status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.end(body);
};

const handleApi = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
  if (req.method !== 'POST' || !header(req, 'content-type').startsWith('application/json')) {
    throw new LocalSyncError(405, '请使用 JSON POST 请求');
  }
  const payload = parseJsonObject(await readSmallBody(req));
  assertExactKeys(payload, ['url', 'method', 'body']);
  if (typeof payload.url !== 'string' || payload.url.length > 2048
    || (payload.method !== undefined && typeof payload.method !== 'string')
    || (payload.body !== undefined && typeof payload.body !== 'string')) {
    throw new LocalSyncError(400, 'GitHub API 请求参数无效');
  }
  const route = parseApiRoute(payload.url, typeof payload.method === 'string' ? payload.method : 'GET');
  const body = validateApiBody(route, payload.body as string | undefined);
  const token = await getCliToken();
  const login = await getLogin(token);
  if ('repo' in route) assertOwner(route.repo.owner, login);
  if (route.kind === 'release' || route.kind === 'asset-delete') {
    await getPrivateRepo(token, route.repo);
  }
  if (route.kind === 'asset-delete') {
    const release = await getCloudRelease(token, route.repo);
    if (!await isAssetInCloudRelease(token, route.repo, release, route.assetId)) {
      throw new LocalSyncError(403, '附件不属于墨色江湖云存档 Release');
    }
  }
  const upstream = await githubFetch(token, route.url.href, {
    method: route.method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body
  });
  await relayApiResponse(res, upstream, token);
};

const parseUpload = (raw: string): { url: URL; repo: CloudRepo; releaseId: number; assetName: string } => {
  const url = parseGitHubUrl(raw, 'uploads.github.com');
  const match = /^\/repos\/([^/]+)\/([^/]+)\/releases\/([1-9][0-9]*)\/assets$/.exec(url.pathname);
  if (!match || !ASSET_ID.test(match[3])) throw new LocalSyncError(400, 'Release 上传地址无效');
  const keys = [...url.searchParams.keys()];
  const assetName = url.searchParams.get('name') || '';
  if (keys.length !== 1 || keys[0] !== 'name' || !isCloudAssetName(assetName)) {
    throw new LocalSyncError(400, '仅允许上传墨色江湖云存档附件');
  }
  return { url, repo: parseRepo(match[1], match[2]), releaseId: Number(match[3]), assetName };
};

const uploadLimitForAsset = (name: string): number => {
  if (name === 'WuXia_Save_Data.parts.json') return MAX_MANIFEST_UPLOAD_BYTES;
  if (name.startsWith('WuXia_Save_Data.part')) return MAX_PART_UPLOAD_BYTES;
  return MAX_UPLOAD_BYTES;
};

const readCompleteUpload = async (req: IncomingMessage, limit: number): Promise<Buffer> => {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.length;
    if (size > limit) throw new LocalSyncError(413, '云存档附件过大');
    chunks.push(bytes);
  }
  if (!req.complete) throw new LocalSyncError(400, '云存档附件未接收完整');
  if (size === 0) throw new LocalSyncError(400, '云存档附件不能为空');
  return Buffer.concat(chunks, size);
};

const handleUpload = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
  if (req.method !== 'POST') throw new LocalSyncError(405, '上传仅支持 POST');
  const target = parseUpload(header(req, 'x-github-upload-url'));
  const contentType = header(req, 'content-type').split(';')[0].trim().toLowerCase();
  if (!['application/octet-stream', 'application/json', 'application/zip'].includes(contentType)) {
    throw new LocalSyncError(400, '云存档附件类型无效');
  }
  const uploadLimit = uploadLimitForAsset(target.assetName);
  const contentLengthHeader = header(req, 'content-length');
  const declaredLength = contentLengthHeader ? Number(contentLengthHeader) : null;
  if (declaredLength !== null && (!Number.isSafeInteger(declaredLength) || declaredLength < 0)) {
    throw new LocalSyncError(400, '云存档附件长度无效');
  }
  if (declaredLength !== null && declaredLength > uploadLimit) {
    throw new LocalSyncError(413, '云存档附件过大');
  }
  const token = await getCliToken();
  const login = await getLogin(token);
  assertOwner(target.repo.owner, login);
  await getPrivateRepo(token, target.repo);
  const release = await getCloudRelease(token, target.repo);
  if (release.id !== target.releaseId) throw new LocalSyncError(403, '上传目标不是云存档 Release');
  // Do not open a GitHub upload until the complete, bounded local body exists.
  // A Buffer plus explicit Content-Length avoids chunked uploads rejected by
  // GitHub Releases and prevents a truncated client stream becoming an asset.
  const uploadBody = await readCompleteUpload(req, uploadLimit);
  if (declaredLength !== null && uploadBody.length !== declaredLength) {
    throw new LocalSyncError(400, '云存档附件长度与请求不一致');
  }
  const upstream = await fetch(target.url.href, {
    method: 'POST',
    redirect: 'manual',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': contentType,
      'Content-Length': String(uploadBody.length),
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'MoRanJiangHu-Local-Sync'
    },
    body: uploadBody as unknown as BodyInit
  });
  if (upstream.status >= 300 && upstream.status < 400) {
    throw new LocalSyncError(502, 'GitHub 附件上传发生意外跳转');
  }
  await relayApiResponse(res, upstream, token);
};

const parseDownload = (raw: string): { url: URL; repo: CloudRepo; assetId?: number; assetName?: string } => {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new LocalSyncError(400, '云存档下载地址格式无效');
  }
  if (!['api.github.com', 'github.com'].includes(parsed.hostname)) {
    throw new LocalSyncError(400, '云存档下载地址不在允许范围内');
  }
  const url = parseGitHubUrl(raw, parsed.hostname);
  if (url.search) throw new LocalSyncError(400, '云存档下载地址不允许查询参数');
  if (url.hostname === 'api.github.com') {
    const match = /^\/repos\/([^/]+)\/([^/]+)\/releases\/assets\/([1-9][0-9]*)$/.exec(url.pathname);
    if (!match || !ASSET_ID.test(match[3])) throw new LocalSyncError(400, '云存档下载地址无效');
    return { url, repo: parseRepo(match[1], match[2]), assetId: Number(match[3]) };
  }
  if (url.hostname === 'github.com') {
    const match = /^\/([^/]+)\/([^/]+)\/releases\/download\/wuxia-cloud-sync\/([^/]+)$/.exec(url.pathname);
    if (!match) throw new LocalSyncError(400, '云存档下载地址无效');
    const assetName = decodeURIComponent(match[3]);
    if (!isCloudAssetName(assetName)) throw new LocalSyncError(400, '仅允许下载墨色江湖云存档附件');
    return { url, repo: parseRepo(match[1], match[2]), assetName };
  }
  throw new LocalSyncError(400, '云存档下载地址不在允许范围内');
};

const relayDownloadResponse = async (res: ServerResponse, upstream: Response, token: string): Promise<void> => {
  if (!upstream.ok) {
    await relayApiResponse(res, upstream, token);
    return;
  }
  res.statusCode = upstream.status;
  res.setHeader('Content-Type', upstream.headers.get('content-type') || 'application/octet-stream');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  const length = upstream.headers.get('content-length');
  if (length && /^[0-9]+$/.test(length)) res.setHeader('Content-Length', length);
  if (!upstream.body) {
    res.end();
    return;
  }
  for await (const chunk of Readable.fromWeb(upstream.body as any)) {
    if (!res.write(chunk)) await new Promise<void>((resolve) => res.once('drain', resolve));
  }
  res.end();
};

const handleDownload = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
  if (req.method !== 'POST') throw new LocalSyncError(405, '下载仅支持 POST');
  const target = parseDownload(header(req, 'x-github-download-url'));
  const token = await getCliToken();
  const login = await getLogin(token);
  assertOwner(target.repo.owner, login);
  await getPrivateRepo(token, target.repo);
  const release = await getCloudRelease(token, target.repo);
  const belongsToRelease = target.assetId
    ? await isAssetInCloudRelease(token, target.repo, release, target.assetId)
    : Array.isArray(release.assets) && release.assets.some((asset) => asset?.name === target.assetName);
  if (!belongsToRelease) throw new LocalSyncError(403, '附件不属于墨色江湖云存档 Release');

  let upstream = await fetch(target.url.href, {
    method: 'GET',
    redirect: 'manual',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/octet-stream',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'MoRanJiangHu-Local-Sync'
    }
  });
  if ([301, 302, 303, 307, 308].includes(upstream.status)) {
    const location = upstream.headers.get('location') || '';
    const redirect = parseGitHubUrl(location, new URL(location).hostname);
    if (!['objects.githubusercontent.com', 'release-assets.githubusercontent.com'].includes(redirect.hostname)) {
      throw new LocalSyncError(502, 'GitHub 附件跳转到了未允许的地址');
    }
    // Signed asset URLs reject an additional Authorization header.
    upstream = await fetch(redirect.href, { method: 'GET', redirect: 'manual' });
  }
  if (upstream.status >= 300 && upstream.status < 400) {
    throw new LocalSyncError(502, 'GitHub 附件下载发生意外跳转');
  }
  await relayDownloadResponse(res, upstream, token);
};

const handleRequest = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
  if (!isAllowedLocalRequest(req)) {
    sendJson(res, 403, { error: '仅允许本机墨色江湖页面调用此接口' });
    return;
  }
  const path = new URL(req.url || '/', LOCAL_ORIGIN).pathname;
  try {
    if (path === '/status' && req.method === 'GET') {
      try {
        const token = await getCliToken();
        const login = await getLogin(token);
        sendJson(res, 200, { authenticated: true, login });
      } catch (error) {
        sendJson(res, 200, {
          authenticated: false,
          error: error instanceof LocalSyncError ? error.message : '暂时无法确认本机 GitHub 登录状态'
        });
      }
    } else if (path === '/api') {
      await handleApi(req, res);
    } else if (path === '/release-upload') {
      await handleUpload(req, res);
    } else if (path === '/release-download') {
      await handleDownload(req, res);
    } else {
      throw new LocalSyncError(404, '本机 GitHub 同步接口不存在');
    }
  } catch (error) {
    if (res.headersSent) {
      res.destroy();
      return;
    }
    const status = error instanceof LocalSyncError ? error.status : 502;
    const message = error instanceof LocalSyncError ? error.message : '本机 GitHub 同步请求失败';
    sendJson(res, status, { error: message });
  }
};

export const localGitHubSyncPlugin = (): Plugin => ({
  name: 'local-github-cloud-sync',
  apply: 'serve',
  configureServer(server) {
    server.middlewares.use('/local-github', (req, res) => { void handleRequest(req, res); });
  },
  configurePreviewServer(server) {
    server.middlewares.use('/local-github', (req, res) => { void handleRequest(req, res); });
  }
});
