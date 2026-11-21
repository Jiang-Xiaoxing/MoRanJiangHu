// The local Vite server uses the existing GitHub CLI session on this computer.
// This marker is only an in-memory UI state; the CLI token never reaches the page.
export const LOCAL_GITHUB_SESSION = '__moran_local_gh_cli__';
export const LOCAL_GITHUB_HEADER = 'X-Local-Msjh-Sync';

export const isLocalGitHubSite = (): boolean => (
    typeof window !== 'undefined' && window.location.origin === 'http://127.0.0.1:3000'
);
