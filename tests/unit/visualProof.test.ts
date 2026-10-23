import { describe, it, expect } from 'vitest';
import {
  COMMENT_MARKER,
  folderForBranch,
  groupBatches,
  imageUrl,
  renderComment,
  renderedImageSrcs,
  resolveProofMarkdown,
  // @ts-expect-error — plain .mjs helper used by scripts/pr-screenshots.mjs (no .d.ts)
} from '../../scripts/lib/visualProof.mjs';

const SLUG = 'kemper/partwright';
const SHA = 'abc1234def5678';

describe('PR visual proof comment', () => {
  it('maps a branch to its pr-assets folder', () => {
    expect(folderForBranch('claude/busy-curie')).toBe('claude-busy-curie');
    expect(folderForBranch('main')).toBe('main');
  });

  it('groups uploads into batches, oldest first, ignoring other folders', () => {
    const batches = groupBatches(
      [
        'README.md',
        'b/20261023-100000/after.png',
        'b/20261023-100000/before.png',
        'b/20261023-100000/proof.md',
        'b/20261022-090000/old.png',
        'b/20261022-090000/notes.txt',
        'b-other/20261023-100000/x.png',
        'c/20261023-100000/y.png',
      ],
      'b',
    );
    expect(batches.map((b: { stamp: string }) => b.stamp)).toEqual(['20261022-090000', '20261023-100000']);
    expect(batches[1].images.map((i: { name: string }) => i.name)).toEqual(['after.png', 'before.png']);
    expect(batches[1].proofPath).toBe('b/20261023-100000/proof.md');
    expect(batches[0].images).toHaveLength(1);
  });

  it('reads the older flat <stamp>-<name> layout too', () => {
    const batches = groupBatches(['b/20261017-120000-shot.png', 'b/20261017-120000-other.png'], 'b');
    expect(batches).toHaveLength(1);
    expect(batches[0].images.map((i: { name: string }) => i.name)).toEqual(['other.png', 'shot.png']);
  });

  it('pins image URLs to the commit and encodes path segments', () => {
    expect(imageUrl(SLUG, SHA, 'b/20261023-100000/my shot.png')).toBe(
      `https://github.com/${SLUG}/blob/${SHA}/b/20261023-100000/my%20shot.png?raw=true`,
    );
  });

  it('renders the newest batch two images per row and collapses earlier uploads', () => {
    const batches = groupBatches(
      ['b/20261022-090000/old.png', 'b/20261023-100000/a.png', 'b/20261023-100000/b.png', 'b/20261023-100000/c.png'],
      'b',
    );
    const body = renderComment({ repoSlug: SLUG, sha: SHA, batches });
    expect(body.startsWith(COMMENT_MARKER)).toBe(true);
    expect(body).toContain('| a | b |');
    expect(body).toContain(`![c](https://github.com/${SLUG}/blob/${SHA}/b/20261023-100000/c.png?raw=true)`);
    expect(body).toContain('Earlier screenshots (1 upload)');
    expect(body).toContain(`- 2026-10-22 09:00 UTC: [old](https://github.com/${SLUG}/blob/${SHA}/b/20261022-090000/old.png?raw=true)`);
    // Earlier uploads are links, not inline images.
    expect(body).not.toContain('![old]');
  });

  it('uses an uploaded layout, resolving only the batch\'s own images', () => {
    const [batch] = groupBatches(['b/20261023-100000/before.png', 'b/20261023-100000/after.png'], 'b');
    const md = '| Before | After |\n|---|---|\n| ![b](before.png) | <img src="./after.png" width="300"> |\n![ext](https://example.com/x.png) ![missing](nope.png)';
    const out = resolveProofMarkdown(md, batch, (p: string) => `URL/${p}`);
    expect(out).toContain('![b](URL/b/20261023-100000/before.png)');
    expect(out).toContain('<img src="URL/b/20261023-100000/after.png" width="300">');
    expect(out).toContain('![ext](https://example.com/x.png)');
    expect(out).toContain('![missing](nope.png)');
  });

  it('finds the pinned images GitHub rendered in comment HTML', () => {
    const html =
      `<p><a href="x"><img src="https://github.com/${SLUG}/blob/${SHA}/b/s/a.png?raw=true&amp;x=1" alt="a"></a>` +
      '<img src="https://camo.githubusercontent.com/zzz"></p>';
    expect(renderedImageSrcs(html, SLUG)).toEqual([`https://github.com/${SLUG}/blob/${SHA}/b/s/a.png?raw=true&x=1`]);
  });
});
