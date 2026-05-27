// Build/version metadata, injected at compile time by the `__BUILD_INFO__`
// define in vite.config.ts (from Cloudflare's CF_PAGES_* env vars, or local
// git as a fallback). Surfaced in the in-app About dialog so you can confirm
// exactly which branch/commit a given deploy is running — handy for Cloudflare
// branch & PR preview deploys, which otherwise look identical.

export interface BuildInfo {
  /** Full commit SHA, or 'unknown' if it couldn't be resolved at build time. */
  commit: string;
  /** Branch name, or 'unknown'. */
  branch: string;
  /** ISO 8601 build timestamp, or 'unknown'. */
  buildTime: string;
  /** GitHub "owner/name" slug used to build commit / branch / PR links. */
  repo: string;
  /** True when the build included uncommitted local changes (dev builds only). */
  dirty: boolean;
}

// Replaced wholesale by vite's `define`. The typeof guard keeps this module
// importable under the vitest unit tier, where the define isn't applied.
declare const __BUILD_INFO__: BuildInfo | undefined;

const FALLBACK: BuildInfo = {
  commit: 'unknown',
  branch: 'unknown',
  buildTime: 'unknown',
  repo: 'kemper/mainifold',
  dirty: false,
};

export const buildInfo: BuildInfo =
  typeof __BUILD_INFO__ !== 'undefined' && __BUILD_INFO__ ? __BUILD_INFO__ : FALLBACK;

const SHA_RE = /^[0-9a-f]{7,40}$/i;
const REPO_RE = /^[\w.-]+\/[\w.-]+$/;

/** Abbreviated 7-char commit, or the raw value if it isn't a SHA. */
export function shortCommit(commit: string): string {
  return SHA_RE.test(commit) ? commit.slice(0, 7) : commit;
}

function repoBase(repo: string): string | null {
  return REPO_RE.test(repo) ? `https://github.com/${repo}` : null;
}

/** GitHub URL for the exact commit, or null if commit / repo are unusable. */
export function commitUrl(info: BuildInfo): string | null {
  const base = repoBase(info.repo);
  return base && SHA_RE.test(info.commit) ? `${base}/commit/${info.commit}` : null;
}

// Encode each path segment but keep slashes literal — GitHub's /tree/<branch>
// route 404s on a percent-encoded slash (%2F), and branch names here are
// routinely slash-namespaced (e.g. "claude/foo").
function encodeBranchPath(branch: string): string {
  return branch.split('/').map(encodeURIComponent).join('/');
}

/** GitHub URL for the branch tree, or null if branch / repo are unusable. */
export function branchUrl(info: BuildInfo): string | null {
  const base = repoBase(info.repo);
  return base && info.branch && info.branch !== 'unknown'
    ? `${base}/tree/${encodeBranchPath(info.branch)}`
    : null;
}

/** GitHub search URL listing PRs whose head is this branch, or null. */
export function pullRequestsUrl(info: BuildInfo): string | null {
  const base = repoBase(info.repo);
  return base && info.branch && info.branch !== 'unknown'
    ? `${base}/pulls?q=${encodeURIComponent(`is:pr head:${info.branch}`)}`
    : null;
}
