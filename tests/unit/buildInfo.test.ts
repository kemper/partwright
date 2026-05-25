// Unit tests for the pure GitHub-link builders behind the About dialog. These
// take an explicit BuildInfo so they exercise no build-time `define` and stay
// in the dependency-free vitest unit tier.

import { describe, test, expect } from 'vitest';
import {
  shortCommit,
  commitUrl,
  branchUrl,
  pullRequestsUrl,
  type BuildInfo,
} from '../../src/buildInfo';

const base: BuildInfo = {
  commit: 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2',
  branch: 'main',
  buildTime: '2026-05-24T00:00:00.000Z',
  repo: 'kemper/mainifold',
  dirty: false,
};

describe('shortCommit', () => {
  test('abbreviates a full SHA to 7 chars', () => {
    expect(shortCommit(base.commit)).toBe('a1b2c3d');
  });

  test('passes non-SHA values (e.g. "unknown") through unchanged', () => {
    expect(shortCommit('unknown')).toBe('unknown');
  });
});

describe('commitUrl', () => {
  test('links to the commit on GitHub', () => {
    expect(commitUrl(base)).toBe(`https://github.com/kemper/mainifold/commit/${base.commit}`);
  });

  test('returns null when the commit is unknown', () => {
    expect(commitUrl({ ...base, commit: 'unknown' })).toBeNull();
  });

  test('returns null for a malformed repo slug', () => {
    expect(commitUrl({ ...base, repo: 'not a repo' })).toBeNull();
  });
});

describe('branchUrl', () => {
  test('links to the branch tree, keeping namespace slashes literal', () => {
    // GitHub's /tree/<branch> 404s on a percent-encoded slash, so slashes in
    // slash-namespaced branch names must stay raw.
    expect(branchUrl({ ...base, branch: 'claude/laughing-davinci' }))
      .toBe('https://github.com/kemper/mainifold/tree/claude/laughing-davinci');
  });

  test('encodes unsafe characters per segment but preserves slashes', () => {
    expect(branchUrl({ ...base, branch: 'feature/a b' }))
      .toBe('https://github.com/kemper/mainifold/tree/feature/a%20b');
  });

  test('returns null when the branch is unknown', () => {
    expect(branchUrl({ ...base, branch: 'unknown' })).toBeNull();
  });
});

describe('pullRequestsUrl', () => {
  test('builds a PR search scoped to the branch head', () => {
    expect(pullRequestsUrl({ ...base, branch: 'feature/x' }))
      .toBe(`https://github.com/kemper/mainifold/pulls?q=${encodeURIComponent('is:pr head:feature/x')}`);
  });

  test('returns null when the branch is unknown', () => {
    expect(pullRequestsUrl({ ...base, branch: 'unknown' })).toBeNull();
  });
});
