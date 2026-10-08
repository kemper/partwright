// Where users send feedback: GitHub issue forms (bug / feature) and GitHub
// Discussions (questions, show-and-tell). Pure URL builders — nothing here
// sends data anywhere. The bug-report link pre-fills the issue form with build
// and browser details via GitHub's query-param prefill, so the user sees and
// can edit every field on GitHub before choosing to submit.
//
// Field ids used in the prefill must match the `id:` keys in
// .github/ISSUE_TEMPLATE/bug_report.yml.

import { repoBase, shortCommit, type BuildInfo } from './buildInfo';

/** Repo URL for feedback links; falls back to the canonical repo so a
 *  malformed build slug never produces a dead link. */
function feedbackRepo(info: BuildInfo): string {
  return repoBase(info.repo) ?? 'https://github.com/kemper/partwright';
}

/** Page context for a bug report, reduced to what's safe to share.
 *  The hash is always dropped: share links encode the whole design there. */
export interface ReportContext {
  /** Page URL (origin + path are kept; query and hash are dropped). */
  href: string;
  /** navigator.userAgent, or '' when unavailable. */
  userAgent: string;
}

/** Origin + pathname of a URL, with no query or hash. */
export function safePageUrl(href: string): string {
  try {
    const u = new URL(href);
    return `${u.origin}${u.pathname}`;
  } catch {
    return '';
  }
}

/** One-line build description for the issue form's "Version" field. */
export function versionLine(info: BuildInfo): string {
  const version = info.version !== 'unknown' ? `v${info.version}` : 'unknown version';
  return `${version} (${shortCommit(info.commit)}${info.dirty ? ', uncommitted changes' : ''})`;
}

/** Issue-form URL for a bug report, pre-filled with build + browser details. */
export function bugReportUrl(info: BuildInfo, ctx: ReportContext): string {
  const params = new URLSearchParams({ template: 'bug_report.yml', labels: 'bug,user-report' });
  params.set('version', versionLine(info));
  const env = [safePageUrl(ctx.href), ctx.userAgent].filter(Boolean).join('\n');
  if (env) params.set('environment', env);
  return `${feedbackRepo(info)}/issues/new?${params.toString()}`;
}

/** GitHub's "new issue" chooser (bug form, feature form, Discussions links). */
export function issueChooserUrl(info: BuildInfo): string {
  return `${feedbackRepo(info)}/issues/new/choose`;
}

/** Issue-form URL for a feature request. */
export function featureRequestUrl(info: BuildInfo): string {
  return `${feedbackRepo(info)}/issues/new?template=feature_request.yml&labels=enhancement,user-report`;
}

/** GitHub Discussions URL; `category` opens the new-discussion form in that
 *  category (GitHub's default slugs: 'q-a', 'show-and-tell', 'ideas'). */
export function discussionsUrl(info: BuildInfo, category?: 'q-a' | 'show-and-tell'): string {
  const base = `${feedbackRepo(info)}/discussions`;
  return category ? `${base}/new?category=${category}` : base;
}

/** GitHub private vulnerability report form. */
export function securityReportUrl(info: BuildInfo): string {
  return `${feedbackRepo(info)}/security/advisories/new`;
}
