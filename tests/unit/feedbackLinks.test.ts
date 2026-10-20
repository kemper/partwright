import { describe, it, expect } from 'vitest';
import type { BuildInfo } from '../../src/buildInfo';
import {
  bugReportUrl,
  discussionsUrl,
  featureRequestUrl,
  issueChooserUrl,
  safePageUrl,
  securityReportUrl,
  versionLine,
} from '../../src/feedbackLinks';

const INFO: BuildInfo = {
  commit: '0123456789abcdef0123456789abcdef01234567',
  branch: 'main',
  buildTime: '2026-09-28T00:00:00Z',
  repo: 'kemper/partwright',
  dirty: false,
  version: '1.4.0',
};

describe('feedbackLinks', () => {
  it('drops query and hash from the page URL (share links carry the design in the hash)', () => {
    expect(safePageUrl('https://www.partwrightstudio.com/editor?session=abc#share=H4sIAAAA'))
      .toBe('https://www.partwrightstudio.com/editor');
    expect(safePageUrl('not a url')).toBe('');
  });

  it('formats the version line', () => {
    expect(versionLine(INFO)).toBe('v1.4.0 (0123456)');
    expect(versionLine({ ...INFO, version: 'unknown', commit: 'unknown', dirty: true }))
      .toBe('unknown version (unknown, uncommitted changes)');
  });

  it('pre-fills the bug report form without leaking the hash', () => {
    const url = new URL(bugReportUrl(INFO, {
      href: 'https://www.partwrightstudio.com/editor?session=abc#secret-design',
      userAgent: 'TestAgent/1.0',
    }));
    expect(url.origin + url.pathname).toBe('https://github.com/kemper/partwright/issues/new');
    expect(url.searchParams.get('template')).toBe('bug_report.yml');
    expect(url.searchParams.get('labels')).toBe('bug,user-report');
    expect(url.searchParams.get('version')).toBe('v1.4.0 (0123456)');
    expect(url.searchParams.get('environment'))
      .toBe('https://www.partwrightstudio.com/editor\nTestAgent/1.0');
    expect(url.toString()).not.toContain('secret-design');
    expect(url.toString()).not.toContain('session=abc');
  });

  it('omits an empty environment field', () => {
    const url = new URL(bugReportUrl(INFO, { href: '', userAgent: '' }));
    expect(url.searchParams.has('environment')).toBe(false);
  });

  it('falls back to the canonical repo on a malformed slug', () => {
    expect(featureRequestUrl({ ...INFO, repo: 'bad slug' }))
      .toBe('https://github.com/kemper/partwright/issues/new?template=feature_request.yml&labels=enhancement,user-report');
  });

  it('builds Discussions links', () => {
    expect(discussionsUrl(INFO)).toBe('https://github.com/kemper/partwright/discussions');
    expect(discussionsUrl(INFO, 'q-a')).toBe('https://github.com/kemper/partwright/discussions/new?category=q-a');
    expect(issueChooserUrl(INFO)).toBe('https://github.com/kemper/partwright/issues/new/choose');
    expect(securityReportUrl(INFO)).toBe('https://github.com/kemper/partwright/security/advisories/new');
  });
});
