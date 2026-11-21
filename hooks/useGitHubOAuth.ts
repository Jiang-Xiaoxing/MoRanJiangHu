import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    buildSyncApiUrl,
    getSyncApiBaseUrl,
    isCapacitorPluginAvailable,
    isMissingNativeSyncApiBaseUrl,
    isNativeCapacitorEnvironment
} from '../utils/nativeRuntime';
import { isLocalGitHubSite, LOCAL_GITHUB_HEADER, LOCAL_GITHUB_SESSION } from '../utils/localGitHub';

const TOKEN_KEY = 'github_sync_token';
const LOCAL_DISCONNECTED_KEY = 'moran_local_github_disconnected';
const OAUTH_STATE_KEY = 'github_oauth_pending_state';
const GITHUB_OAUTH_AUTHORIZE_URL = 'https://github.com/login/oauth/authorize';
const GITHUB_OAUTH_SCOPE = 'repo';
const WEB_CALLBACK_PATH = '/oauth/github/callback';
// APK 默认走网页桥接回调。GitHub OAuth App 只能登记一个 callback URL，
// 当前主站/APK 桥接统一使用主域名；备用域名仅给 web_backup client 使用。
const DEFAULT_NATIVE_APP_LINK = 'https://msjh.bacon159.pp.ua/oauth/github/callback';
const DEFAULT_NATIVE_DEEP_LINK = 'com.moranjianghu.game://oauth/github/callback';
const DEFAULT_PRIMARY_ORIGIN = 'https://msjh.bacon159.pp.ua';
const DEFAULT_BACKUP_ORIGIN = 'https://msjh.bacon.de5.net';

type GitHubOAuthSessionStatus = 'idle' | 'waiting' | 'exchanging' | 'success' | 'error';
type GitHubOAuthClientType = 'web' | 'web_backup' | 'native';

export type GitHubOAuthSessionState = {
    status: GitHubOAuthSessionStatus;
    authorizationUrl: string;
    redirectUri: string;
    message: string | null;
};

type PendingOAuthState = {
    state: string;
    redirectUri: string;
    clientType: GitHubOAuthClientType;
    expectedCallbackUris: string[];
    createdAt: number;
};

type TokenExchangeResponse = {
    access_token?: string;
    error?: string;
};

type GitHubOAuthRuntimeConfig = {
    githubClientId?: string;
    githubBackupClientId?: string;
};

type ResolvedGitHubOAuthClientIds = {
    webGitHubClientId: string;
    backupGitHubClientId: string;
};

const createIdleOAuthSession = (): GitHubOAuthSessionState => ({
    status: 'idle',
    authorizationUrl: '',
    redirectUri: '',
    message: null
});

const normalizeErrorMessage = (error: unknown, fallback: string) => {
    if (error instanceof Error && error.message.trim()) return error.message;
    return fallback;
};

const readEnvString = (value: unknown) => (
    typeof value === 'string' ? value.trim() : ''
);

const getNativeSyncApiMissingMessage = () => {
    const currentOrigin = typeof window === 'undefined' ? 'unknown' : window.location.origin;
    return [
        '当前 APK 没有配置远程同步 API 地址，GitHub 同步无法工作。',
        `当前运行地址：${currentOrigin}`,
        '请在打包前配置 VITE_SYNC_API_BASE_URL，并重新生成 APK。'
    ].join('\n');
};

const getJsonResponseError = (response: Response, rawText: string) => {
    const snippet = rawText.trim().slice(0, 160);
    if (!snippet) {
        return new Error(`HTTP Error ${response.status}`);
    }

    const looksLikeHtml = snippet.startsWith('<!DOCTYPE') || snippet.startsWith('<html') || snippet.startsWith('<');
    if (looksLikeHtml) {
        return new Error(
            `HTTP Error ${response.status}: 服务返回了 HTML 页面而不是 JSON。通常表示 APK 没有配置 VITE_SYNC_API_BASE_URL，或者请求被发到了错误地址。`
        );
    }

    return new Error(`HTTP Error ${response.status}: ${snippet}`);
};

const parseJsonResponse = async <T>(response: Response): Promise<T> => {
    const rawText = await response.text();
    try {
        return JSON.parse(rawText) as T;
    } catch {
        throw getJsonResponseError(response, rawText);
    }
};

type GitHubAuthPageOpenDeps = {
    loadBrowser?: () => Promise<{ Browser?: { open?: (options: { url: string; presentationStyle?: 'fullscreen' | 'popover' }) => Promise<void> } }>;
    windowOpen?: typeof window.open;
};

const openGitHubAuthPage = async (targetUrl: string, isNativeApp: boolean, deps: GitHubAuthPageOpenDeps = {}) => {
    if (!targetUrl) return;
    if (isNativeApp) {
        const loadBrowser = deps.loadBrowser || (() => import('@capacitor/browser'));
        const { Browser } = await loadBrowser();
        if (Browser?.open) {
            await Browser.open({ url: targetUrl, presentationStyle: 'fullscreen' });
            return;
        }
    }
    const openWindow = deps.windowOpen || window.open.bind(window);
    openWindow(targetUrl, '_blank', 'noopener,noreferrer');
};

const closeGitHubAuthPageIfPossible = async () => {
    try {
        const { Browser } = await import('@capacitor/browser');
        await Browser.close();
    } catch {
        // Browser may not be open or may be unavailable in web builds.
    }
};

const createOAuthStateValue = () => {
    if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
        const bytes = new Uint8Array(16);
        crypto.getRandomValues(bytes);
        return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
    }

    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
};

const buildOAuthState = (isNativeApp: boolean) => (
    `${isNativeApp ? 'native' : 'web'}:${createOAuthStateValue()}`
);

const serializeCallbackUrl = (value: string) => {
    try {
        const url = new URL(value);
        url.search = '';
        url.hash = '';
        return url.toString().replace(/\/$/, '');
    } catch {
        return '';
    }
};

const normalizeCallbackUris = (value: unknown) => (
    Array.isArray(value)
        ? value.map((item) => readEnvString(item)).filter(Boolean)
        : []
);

const normalizeOAuthClientType = (value: unknown): GitHubOAuthClientType => (
    value === 'native' || value === 'web_backup' ? value : 'web'
);

const readPendingOAuthState = (): PendingOAuthState | null => {
    try {
        const raw = localStorage.getItem(OAUTH_STATE_KEY);
        if (!raw) return null;

        const parsed = JSON.parse(raw) as Partial<PendingOAuthState>;
        const state = readEnvString(parsed.state);
        const redirectUri = readEnvString(parsed.redirectUri);
        const createdAt = Number(parsed.createdAt);
        const clientType = normalizeOAuthClientType(parsed.clientType);
        const expectedCallbackUris = normalizeCallbackUris(parsed.expectedCallbackUris);

        if (!state || !redirectUri || !Number.isFinite(createdAt)) {
            return null;
        }

        return {
            state,
            redirectUri,
            clientType,
            expectedCallbackUris: expectedCallbackUris.length > 0 ? expectedCallbackUris : [redirectUri],
            createdAt
        };
    } catch {
        return null;
    }
};

const writePendingOAuthState = (value: PendingOAuthState) => {
    localStorage.setItem(OAUTH_STATE_KEY, JSON.stringify(value));
};

const clearPendingOAuthState = () => {
    localStorage.removeItem(OAUTH_STATE_KEY);
};

const isMatchingCallbackUrl = (urlValue: string, redirectUris: string[]) => {
    const normalizedUrl = serializeCallbackUrl(urlValue);
    if (!normalizedUrl) return false;

    return redirectUris.some((redirectUri) => normalizedUrl === serializeCallbackUrl(redirectUri));
};

const hasOAuthCallbackParams = (url: URL) => (
    Boolean(readEnvString(url.searchParams.get('code')) || readEnvString(url.searchParams.get('error'))) &&
    Boolean(readEnvString(url.searchParams.get('state')))
);

const isRootOAuthCallbackFallback = (url: URL) => (
    url.pathname === '/' && hasOAuthCallbackParams(url)
);

const encodePendingOAuthState = (value: PendingOAuthState): string => {
    try {
        return btoa(encodeURIComponent(JSON.stringify(value)));
    } catch {
        return '';
    }
};

const decodePendingOAuthState = (value: string): PendingOAuthState | null => {
    try {
        const parsed = JSON.parse(decodeURIComponent(atob(value))) as Partial<PendingOAuthState>;
        const state = readEnvString(parsed.state);
        const redirectUri = readEnvString(parsed.redirectUri);
        const createdAt = Number(parsed.createdAt);
        const clientType = normalizeOAuthClientType(parsed.clientType);
        const expectedCallbackUris = normalizeCallbackUris(parsed.expectedCallbackUris);
        if (!state || !redirectUri || !Number.isFinite(createdAt)) return null;
        return {
            state,
            redirectUri,
            clientType,
            expectedCallbackUris: expectedCallbackUris.length > 0 ? expectedCallbackUris : [redirectUri],
            createdAt
        };
    } catch {
        return null;
    }
};

const normalizeOAuthCallbackUrl = (callbackUrl: string, pendingState: PendingOAuthState | null) => {
    let url: URL;
    try {
        url = new URL(callbackUrl);
    } catch {
        return callbackUrl;
    }

    if (!pendingState || !isRootOAuthCallbackFallback(url)) {
        return callbackUrl;
    }

    const redirectUri = pendingState.expectedCallbackUris[0] || pendingState.redirectUri;
    try {
        const normalized = new URL(redirectUri);
        normalized.search = url.search;
        normalized.hash = url.hash;
        return normalized.toString();
    } catch {
        return callbackUrl;
    }
};

const createFallbackPendingStateFromCallback = (callbackUrl: string): PendingOAuthState | null => {
    let url: URL;
    try {
        url = new URL(callbackUrl);
    } catch {
        return null;
    }

    if (!hasOAuthCallbackParams(url)) return null;

    const encodedPending = readEnvString(url.searchParams.get('oauth_pending'));
    const decodedPending = encodedPending ? decodePendingOAuthState(encodedPending) : null;
    if (decodedPending) return decodedPending;

    const state = readEnvString(url.searchParams.get('state'));
    if (!state.startsWith('native:')) return null;

    const redirectUri = getNativeBridgeRedirectUri();
    return {
        state,
        redirectUri,
        clientType: 'web',
        expectedCallbackUris: [redirectUri, getNativeDirectRedirectUri()],
        createdAt: Date.now()
    };
};

const buildNativeBridgeDeepLink = (callbackUrl: string): string | null => {
    let url: URL;
    try {
        url = new URL(callbackUrl);
    } catch {
        return null;
    }

    const state = readEnvString(url.searchParams.get('state'));
    if (!state.startsWith('native:')) return null;

    const pendingState: PendingOAuthState = {
        state,
        redirectUri: getNativeBridgeRedirectUri(),
        clientType: 'web',
        expectedCallbackUris: [getNativeBridgeRedirectUri(), getNativeDirectRedirectUri()],
        createdAt: Date.now()
    };
    const deepLinkUrl = new URL(getNativeDirectRedirectUri());
    deepLinkUrl.search = url.search;
    const encodedPending = encodePendingOAuthState(pendingState);
    if (encodedPending) deepLinkUrl.searchParams.set('oauth_pending', encodedPending);
    return deepLinkUrl.toString();
};

const getNativeDirectRedirectUri = () => {
    const configured = readEnvString(import.meta.env.VITE_GITHUB_OAUTH_REDIRECT_URI);
    return configured || DEFAULT_NATIVE_DEEP_LINK;
};

const getNativeBridgeRedirectUri = () => {
    const configured = readEnvString(import.meta.env.VITE_GITHUB_OAUTH_BRIDGE_REDIRECT_URI);
    return configured || DEFAULT_NATIVE_APP_LINK;
};

const shouldUseNativeDirectRedirect = () => (
    readEnvString(import.meta.env.VITE_GITHUB_OAUTH_USE_DIRECT_DEEP_LINK).toLowerCase() === 'true'
);

const resolveWebOAuthClient = ({
    currentOrigin,
    primaryClientId,
    backupClientId,
    primaryOrigin,
    backupOrigin
}: {
    currentOrigin: string;
    primaryClientId: string;
    backupClientId?: string;
    primaryOrigin?: string;
    backupOrigin?: string;
}) => {
    const normalizedCurrentOrigin = currentOrigin.replace(/\/+$/, '');
    const normalizedPrimaryOrigin = readEnvString(primaryOrigin).replace(/\/+$/, '') || DEFAULT_PRIMARY_ORIGIN;
    const normalizedBackupOrigin = readEnvString(backupOrigin).replace(/\/+$/, '') || DEFAULT_BACKUP_ORIGIN;
    const useBackupClient = normalizedCurrentOrigin === normalizedBackupOrigin && readEnvString(backupClientId).length > 0;
    // Always pin redirect_uri to the OAuth App's registered origin.
    // Localhost / preview / capacitor origins must not be sent to GitHub.
    const redirectOrigin = useBackupClient ? normalizedBackupOrigin : normalizedPrimaryOrigin;
    const redirectUri = new URL(WEB_CALLBACK_PATH, `${redirectOrigin}/`).toString();
    const currentCallbackUri = new URL(WEB_CALLBACK_PATH, currentOrigin).toString();
    return {
        clientId: useBackupClient ? readEnvString(backupClientId) : primaryClientId,
        clientType: useBackupClient ? 'web_backup' : 'web',
        redirectUri,
        // Accept either the registered callback or same-path callbacks that land on the current origin
        // after a proxy/host rewrite, then normalize back to redirectUri during exchange.
        expectedCallbackUris: currentCallbackUri === redirectUri
            ? [redirectUri]
            : [redirectUri, currentCallbackUri]
    } as const;
};

const resolveGitHubOAuthClientIds = ({
    buildWebClientId,
    buildBackupClientId,
    runtimeWebClientId,
    runtimeBackupClientId
}: {
    buildWebClientId: string;
    buildBackupClientId?: string;
    runtimeWebClientId?: string;
    runtimeBackupClientId?: string;
}): ResolvedGitHubOAuthClientIds => ({
    webGitHubClientId: readEnvString(buildWebClientId) || readEnvString(runtimeWebClientId),
    backupGitHubClientId: readEnvString(buildBackupClientId) || readEnvString(runtimeBackupClientId)
});

const getWebOAuthClient = (primaryClientId: string, backupClientId?: string) => {
    const currentOrigin = typeof window === 'undefined' ? DEFAULT_PRIMARY_ORIGIN : window.location.origin;
    return resolveWebOAuthClient({
        currentOrigin,
        primaryClientId,
        backupClientId,
        primaryOrigin: import.meta.env.VITE_GITHUB_PRIMARY_ORIGIN,
        backupOrigin: import.meta.env.VITE_GITHUB_BACKUP_ORIGIN
    });
};

const getWebRedirectUri = (primaryClientId = '', backupClientId = '') => {
    if (typeof window === 'undefined') {
        return new URL(WEB_CALLBACK_PATH, `${DEFAULT_PRIMARY_ORIGIN}/`).toString();
    }
    return getWebOAuthClient(primaryClientId, backupClientId).redirectUri;
};

export function useGitHubOAuth() {
    const isLocalGitHub = isLocalGitHubSite();
    const [token, setToken] = useState<string | null>(() => isLocalGitHub ? null : localStorage.getItem(TOKEN_KEY));
    const [isLoggingIn, setIsLoggingIn] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [localGitHubLogin, setLocalGitHubLogin] = useState('');
    const [localSessionLoading, setLocalSessionLoading] = useState(isLocalGitHub);
    const [oauthSession, setOAuthSession] = useState<GitHubOAuthSessionState>(createIdleOAuthSession);
    const [runtimeConfig, setRuntimeConfig] = useState<GitHubOAuthRuntimeConfig | null>(null);
    const handledCallbackUrlRef = useRef('');

    const isNativeApp = isNativeCapacitorEnvironment();
    const buildWebGitHubClientId = readEnvString(import.meta.env.VITE_GITHUB_CLIENT_ID);
    const buildBackupGitHubClientId = readEnvString(import.meta.env.VITE_GITHUB_BACKUP_CLIENT_ID);
    const runtimeConfigLoaded = isNativeApp || buildWebGitHubClientId.length > 0 || runtimeConfig !== null;
    const { webGitHubClientId, backupGitHubClientId } = resolveGitHubOAuthClientIds({
        buildWebClientId: buildWebGitHubClientId,
        buildBackupClientId: buildBackupGitHubClientId,
        runtimeWebClientId: runtimeConfig?.githubClientId,
        runtimeBackupClientId: runtimeConfig?.githubBackupClientId
    });
    const webOAuthClient = !isNativeApp ? getWebOAuthClient(webGitHubClientId, backupGitHubClientId) : null;
    const nativeGitHubClientId = readEnvString(import.meta.env.VITE_GITHUB_NATIVE_CLIENT_ID);
    const hasNativeGitHubClientId = nativeGitHubClientId.length > 0;
    const nativeDirectRedirectEnabled = isNativeApp && hasNativeGitHubClientId && shouldUseNativeDirectRedirect();
    const oauthClientType: GitHubOAuthClientType = nativeDirectRedirectEnabled ? 'native' : 'web';
    const githubClientId = oauthClientType === 'native' ? nativeGitHubClientId : (webOAuthClient?.clientId || webGitHubClientId);
    const hasGitHubOAuthClientId = isLocalGitHub || githubClientId.length > 0;
    const syncApiBaseUrl = useMemo(() => getSyncApiBaseUrl(), []);
    const missingNativeSyncApiBaseUrl = isNativeApp && isMissingNativeSyncApiBaseUrl();
    const oauthRedirectUri = useMemo(() => {
        if (!isNativeApp) return getWebRedirectUri(webGitHubClientId, backupGitHubClientId);
        return oauthClientType === 'native'
            ? getNativeDirectRedirectUri()
            : getNativeBridgeRedirectUri();
    }, [backupGitHubClientId, isNativeApp, oauthClientType, webGitHubClientId]);
    const nativeDeepLinkUri = useMemo(() => getNativeDirectRedirectUri(), []);

    const resetOAuthSession = useCallback(() => {
        setOAuthSession(createIdleOAuthSession());
    }, []);

    const connectLocalGitHub = useCallback(async () => {
        const response = await fetch('/local-github/status', {
            headers: { [LOCAL_GITHUB_HEADER]: '1', 'Accept': 'application/json' }
        });
        const data = await parseJsonResponse<{ authenticated?: boolean; login?: string; error?: string }>(response);
        if (!response.ok || !data.authenticated || !data.login) {
            throw new Error(data.error || '本机 GitHub 未登录，请先运行 gh auth login。');
        }
        localStorage.removeItem(LOCAL_DISCONNECTED_KEY);
        setLocalGitHubLogin(data.login);
        setToken(LOCAL_GITHUB_SESSION);
        setError(null);
    }, []);

    useEffect(() => {
        if (!isLocalGitHub) return;
        if (localStorage.getItem(LOCAL_DISCONNECTED_KEY) === '1') {
            setLocalSessionLoading(false);
            return;
        }
        let cancelled = false;
        void connectLocalGitHub().catch((failure) => {
            if (!cancelled) setError(normalizeErrorMessage(failure, '本机 GitHub 登录检查失败'));
        }).finally(() => {
            if (!cancelled) setLocalSessionLoading(false);
        });
        return () => { cancelled = true; };
    }, [connectLocalGitHub, isLocalGitHub]);

    const logout = useCallback(() => {
        if (isLocalGitHub) {
            localStorage.setItem(LOCAL_DISCONNECTED_KEY, '1');
            setToken(null);
            setLocalGitHubLogin('');
            setError(null);
            return;
        }
        localStorage.removeItem(TOKEN_KEY);
        clearPendingOAuthState();
        setToken(null);
        setError(null);
        resetOAuthSession();
    }, [isLocalGitHub, resetOAuthSession]);

    const finishWithToken = useCallback((nextToken: string) => {
        localStorage.setItem(TOKEN_KEY, nextToken);
        clearPendingOAuthState();
        setToken(nextToken);
        setError(null);
        setOAuthSession((current) => ({
            ...current,
            status: 'success',
            message: 'GitHub 已授权完成。'
        }));
        void closeGitHubAuthPageIfPossible();
    }, []);

    const reopenAuthorizationPage = useCallback(() => {
        const targetUrl = oauthSession.authorizationUrl;
        if (!targetUrl) return;
        void openGitHubAuthPage(targetUrl, isNativeApp);
    }, [isNativeApp, oauthSession.authorizationUrl]);

    const exchangeCodeForToken = useCallback(async (
        code: string,
        redirectUri: string,
        clientType: GitHubOAuthClientType
    ) => {
        const response = await fetch(buildSyncApiUrl('/api/auth/github'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                code,
                redirectUri,
                clientType
            })
        });
        const data = await parseJsonResponse<TokenExchangeResponse>(response);
        if (!response.ok) {
            throw new Error(data.error || 'GitHub OAuth token exchange failed');
        }
        if (!data.access_token) {
            throw new Error(data.error || 'GitHub OAuth did not return an access token');
        }
        return data.access_token;
    }, []);

    const cleanupCallbackUrl = useCallback((callbackUrl: string) => {
        if (typeof window === 'undefined') return;

        try {
            const url = new URL(callbackUrl);
            if (url.origin === window.location.origin && (url.pathname === WEB_CALLBACK_PATH || isRootOAuthCallbackFallback(url))) {
                window.history.replaceState({}, document.title, '/');
            }
        } catch {
            // Ignore malformed callback cleanup.
        }
    }, []);

    const bridgeBrowserCallbackToNativeApp = useCallback((callbackUrl: string) => {
        if (typeof window === 'undefined' || isNativeApp) return false;

        let url: URL;
        try {
            url = new URL(callbackUrl);
        } catch {
            return false;
        }

        if (url.pathname !== WEB_CALLBACK_PATH && !isRootOAuthCallbackFallback(url)) {
            return false;
        }

        const state = readEnvString(url.searchParams.get('state'));
        if (!state.startsWith('native:')) {
            return false;
        }

        const deepLinkUrl = buildNativeBridgeDeepLink(callbackUrl);
        if (!deepLinkUrl) return false;
        window.location.replace(deepLinkUrl);
        window.setTimeout(() => {
            window.location.replace('/');
        }, 1500);
        return true;
    }, [isNativeApp]);

    const handleOAuthCallback = useCallback(async (callbackUrl: string) => {
        if (!callbackUrl || handledCallbackUrlRef.current === callbackUrl) {
            return;
        }

        const pendingState = readPendingOAuthState() || (isNativeApp ? createFallbackPendingStateFromCallback(callbackUrl) : null);
        if (!pendingState) {
            if (bridgeBrowserCallbackToNativeApp(callbackUrl)) {
                return;
            }
            return;
        }

        const normalizedCallbackUrl = normalizeOAuthCallbackUrl(callbackUrl, pendingState);

        if (bridgeBrowserCallbackToNativeApp(normalizedCallbackUrl)) {
            return;
        }

        let url: URL;
        try {
            url = new URL(normalizedCallbackUrl);
        } catch {
            return;
        }

        if (!isMatchingCallbackUrl(normalizedCallbackUrl, pendingState.expectedCallbackUris)) {
            return;
        }

        handledCallbackUrlRef.current = normalizedCallbackUrl;
        setIsLoggingIn(true);
        void closeGitHubAuthPageIfPossible();

        const callbackError = readEnvString(url.searchParams.get('error'));
        const callbackErrorDescription = readEnvString(url.searchParams.get('error_description'));
        const callbackCode = readEnvString(url.searchParams.get('code'));
        const callbackState = readEnvString(url.searchParams.get('state'));

        try {
            if (callbackError) {
                throw new Error(callbackErrorDescription || callbackError);
            }

            if (!callbackCode) {
                throw new Error('GitHub 回调中缺少 authorization code。');
            }

            if (!callbackState || callbackState !== pendingState.state) {
                throw new Error('GitHub OAuth state 校验失败，请重新登录。');
            }

            setOAuthSession((current) => ({
                ...current,
                status: 'exchanging',
                redirectUri: pendingState.redirectUri,
                message: '正在校验 GitHub 授权结果并换取访问令牌。'
            }));

            const nextToken = await exchangeCodeForToken(
                callbackCode,
                pendingState.redirectUri,
                pendingState.clientType
            );
            finishWithToken(nextToken);
        } catch (callbackFailure) {
            const rawMessage = normalizeErrorMessage(callbackFailure, 'GitHub 登录失败');
            const message = /redirect_uri MUST match the registered callback URL/i.test(rawMessage)
                ? [
                    'GitHub 回调地址与 OAuth App 登记不一致。',
                    `当前使用的 redirect_uri：${pendingState.redirectUri}`,
                    `clientType：${pendingState.clientType}`,
                    '请确认 Cloudflare 中的 GITHUB_CLIENT_ID / GITHUB_BACKUP_CLIENT_ID / GITHUB_NATIVE_CLIENT_ID 与前端一致，且对应 App 的 Authorization callback URL 已登记该地址。'
                ].join('\n')
                : rawMessage;
            clearPendingOAuthState();
            setError(message);
            setOAuthSession((current) => ({
                ...current,
                status: 'error',
                redirectUri: pendingState.redirectUri,
                message
            }));
            alert(`授权失败: ${message}`);
        } finally {
            cleanupCallbackUrl(callbackUrl);
            setIsLoggingIn(false);
        }
    }, [bridgeBrowserCallbackToNativeApp, cleanupCallbackUrl, exchangeCodeForToken, finishWithToken, isNativeApp]);

    useEffect(() => {
        if (isLocalGitHub) return;
        void handleOAuthCallback(window.location.href);
    }, [handleOAuthCallback, isLocalGitHub]);

    useEffect(() => {
        if (isLocalGitHub || isNativeApp || buildWebGitHubClientId) {
            return;
        }

        let released = false;
        const loadRuntimeConfig = async () => {
            try {
                const response = await fetch(buildSyncApiUrl('/api/auth/github-config'), {
                    headers: { 'Accept': 'application/json' }
                });
                if (!response.ok) {
                    throw new Error(`HTTP Error ${response.status}`);
                }
                const data = await parseJsonResponse<GitHubOAuthRuntimeConfig>(response);
                if (!released) {
                    setRuntimeConfig({
                        githubClientId: readEnvString(data.githubClientId),
                        githubBackupClientId: readEnvString(data.githubBackupClientId)
                    });
                }
            } catch {
                if (!released) {
                    setRuntimeConfig({});
                }
            }
        };

        void loadRuntimeConfig();

        return () => {
            released = true;
        };
    }, [buildWebGitHubClientId, isLocalGitHub, isNativeApp]);

    useEffect(() => {
        if (!isNativeApp || !isCapacitorPluginAvailable('App')) return;

        let released = false;
        let removeListener: (() => void) | undefined;

        const bindNativeOAuthListener = async () => {
            const { App } = await import('@capacitor/app');

            const listener = await App.addListener('appUrlOpen', (event) => {
                void handleOAuthCallback(event.url);
            });
            removeListener = () => {
                void listener.remove();
            };

            const launchUrl = await App.getLaunchUrl();
            if (!released && launchUrl?.url) {
                void handleOAuthCallback(launchUrl.url);
            }
        };

        void bindNativeOAuthListener();

        return () => {
            released = true;
            removeListener?.();
        };
    }, [handleOAuthCallback, isNativeApp]);

    const login = useCallback(async () => {
        setError(null);

        if (isLocalGitHub) {
            setIsLoggingIn(true);
            try {
                await connectLocalGitHub();
            } catch (loginError) {
                const message = normalizeErrorMessage(loginError, '本机 GitHub 登录检查失败');
                setError(message);
                alert(message);
            } finally {
                setIsLoggingIn(false);
            }
            return;
        }

        if (!githubClientId) {
            const message = isNativeApp
                ? '未配置可用的 GitHub OAuth Client ID。请至少提供 VITE_GITHUB_CLIENT_ID，或为 APK 单独提供 VITE_GITHUB_NATIVE_CLIENT_ID。'
                : runtimeConfigLoaded
                    ? '未配置 VITE_GITHUB_CLIENT_ID 环境变量，且 Worker 运行时也没有提供 GITHUB_CLIENT_ID。'
                    : '正在读取 GitHub OAuth 运行时配置，请稍后再试。';
            setError(message);
            alert(message);
            return;
        }

        if (isNativeApp && missingNativeSyncApiBaseUrl) {
            const message = getNativeSyncApiMissingMessage();
            setError(message);
            alert(message);
            return;
        }

        const useNativeDirectCallback = isNativeApp && oauthClientType === 'native' && shouldUseNativeDirectRedirect();
        const webOAuthClient = !isNativeApp ? getWebOAuthClient(webGitHubClientId, backupGitHubClientId) : null;
        const redirectUri = !isNativeApp
            ? webOAuthClient?.redirectUri || getWebRedirectUri(webGitHubClientId, backupGitHubClientId)
            : useNativeDirectCallback
                ? getNativeDirectRedirectUri()
                : getNativeBridgeRedirectUri();
        const expectedCallbackUris = !isNativeApp
            ? webOAuthClient?.expectedCallbackUris || [redirectUri]
            : useNativeDirectCallback
                ? [redirectUri]
                : [redirectUri, getNativeDirectRedirectUri()];
        const resolvedClientType = !isNativeApp ? (webOAuthClient?.clientType || 'web') : oauthClientType;
        const state = buildOAuthState(isNativeApp);
        const authorizationUrl = new URL(GITHUB_OAUTH_AUTHORIZE_URL);

        authorizationUrl.searchParams.set('client_id', !isNativeApp ? (webOAuthClient?.clientId || githubClientId) : githubClientId);
        authorizationUrl.searchParams.set('redirect_uri', redirectUri);
        authorizationUrl.searchParams.set('scope', GITHUB_OAUTH_SCOPE);
        authorizationUrl.searchParams.set('state', state);
        authorizationUrl.searchParams.set('allow_signup', 'true');

        writePendingOAuthState({
            state,
            redirectUri,
            clientType: resolvedClientType,
            expectedCallbackUris,
            createdAt: Date.now()
        });

        const authorizationUrlString = authorizationUrl.toString();
        handledCallbackUrlRef.current = '';
        setOAuthSession({
            status: 'waiting',
            authorizationUrl: authorizationUrlString,
            redirectUri,
            message: !isNativeApp
                ? '即将跳转到 GitHub 授权页。'
                : useNativeDirectCallback
                    ? 'GitHub 授权页已打开，完成授权后会通过 Android deep link 直接回到应用。'
                    : 'GitHub 授权页已打开，完成授权后会先落到网页回调页，再自动拉起 APK。'
        });

        if (!isNativeApp) {
            window.location.assign(authorizationUrlString);
            return;
        }

        setIsLoggingIn(true);
        try {
            await openGitHubAuthPage(authorizationUrlString, true);
        } catch (loginError) {
            clearPendingOAuthState();
            const message = normalizeErrorMessage(loginError, 'GitHub 登录失败');
            setError(message);
            setOAuthSession({
                ...createIdleOAuthSession(),
                status: 'error',
                redirectUri,
                message
            });
            alert(`授权失败: ${message}`);
        } finally {
            setIsLoggingIn(false);
        }
    }, [backupGitHubClientId, connectLocalGitHub, githubClientId, isLocalGitHub, isNativeApp, missingNativeSyncApiBaseUrl, oauthClientType, runtimeConfigLoaded, webGitHubClientId]);

    return {
        token,
        isLoggingIn,
        error,
        login,
        logout,
        setError,
        isNativeApp,
        isLocalGitHub,
        localGitHubLogin,
        hasGitHubOAuthClientId,
        isGitHubOAuthConfigLoading: isLocalGitHub ? localSessionLoading : !runtimeConfigLoaded,
        oauthSession,
        reopenAuthorizationPage,
        syncApiBaseUrl,
        missingNativeSyncApiBaseUrl,
        oauthRedirectUri,
        nativeDeepLinkUri
    };
}

export const __githubOAuthTestUtils = {
    buildNativeBridgeDeepLink,
    createFallbackPendingStateFromCallback,
    openGitHubAuthPageForTest: openGitHubAuthPage,
    resolveWebOAuthClientForTest: resolveWebOAuthClient,
    resolveGitHubOAuthClientIdsForTest: resolveGitHubOAuthClientIds
};
