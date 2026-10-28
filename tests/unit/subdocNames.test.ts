// Every subdoc under public/ai/ is one readDoc can fetch, and every name
// readDoc accepts has a file — so a doc the ai.md topic index points to can't
// be silently rejected by the tool schema (enclosure and knurl once were).

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { SUBDOC_NAMES_LIST } from '../../src/ai/tools';

const files = readdirSync('public/ai').filter(f => f.endsWith('.md')).map(f => f.slice(0, -3));

describe('readDoc subdoc names', () => {
  it('match the files in public/ai/', () => {
    expect([...SUBDOC_NAMES_LIST].sort()).toEqual([...files].sort());
  });

  it('cover every name in the ai.md topic index', () => {
    const index = readFileSync('public/ai.md', 'utf8').split('## Topic index')[1].split('\n## ')[0];
    const names = [...index.matchAll(/^\| `([a-z-]+)` \|/gm)].map(m => m[1]);
    expect(names.length).toBeGreaterThan(20);
    for (const name of names) expect(SUBDOC_NAMES_LIST).toContain(name);
  });
});
