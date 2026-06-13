// Snapshot/regression test: every public member of partwrightAPI must have an
// entry in the help() methods table.  This catches the common drift where a new
// method is wired into the API object but forgotten in the help() table.
//
// NOTE: src/main.ts contains literal NUL bytes (\0) as template-literal
// cache-key separators, so the file is read with 'latin1' (binary encoding),
// NOT 'utf8'.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const MAIN_TS = resolve(__dirname, '../../src/main.ts');

// Methods that exist on partwrightAPI but are intentionally not listed in
// help() — typically internal/low-level helpers or methods whose help doc is
// embedded elsewhere.  Keep this list small; prefer adding the help() entry.
const INTENTIONALLY_UNDOCUMENTED = new Set([
  'exportSTEP',         // documented under the BREP/replicad flow, not main API table
  'getActiveLanguage',  // internal state accessor, not a primary agent entrypoint
  'setActiveLanguage',  // internal state mutator, not a primary agent entrypoint
  'getClipState',       // internal viewport state accessor
  'setClipZ',           // internal viewport mutator
  'toggleClip',         // internal viewport toggle
  'getParams',          // internal customizer param accessor
  'setParams',          // internal customizer param mutator
  'getModule',          // internal: raw wasm module for advanced geometry ops
  'importImageAsVoxels',// documented in voxel subdoc, not main help table
  'mergeChatHistory',   // internal chat management, not an agent workflow
  'setThumbnailCamera', // internal UI helper, not a geometry/session operation
]);

/** Language keywords that appear at 4-space indent inside an object literal
 *  but are NOT property names. */
const KEYWORDS = new Set([
  'async', 'get', 'if', 'else', 'for', 'while', 'return', 'const', 'let',
  'throw', 'try', 'catch', 'switch', 'case', 'break', 'new', 'await',
  'typeof', 'instanceof', 'true', 'false', 'null', 'undefined', 'this',
  'super', 'class', 'export', 'import', 'default',
]);

function extractApiMembers(src: string): Set<string> {
  const apiStart = src.indexOf('const partwrightAPI = {');
  if (apiStart === -1) throw new Error('Could not find partwrightAPI in main.ts');

  // Take a generous slice — the object is large.
  const chunk = src.slice(apiStart, apiStart + 80_000);
  const lines = chunk.split('\n');
  const members = new Set<string>();

  for (const line of lines) {
    // Stop when we hit the help() method definition — it's the last member and
    // we don't want to recurse into the methods-table inner object.
    if (/^    help\(/.test(line)) {
      members.add('help');
      break;
    }

    // Match 4-space-indented member declarations:
    //   methodName(         — regular method
    //   async methodName(   — async method
    //   get methodName(     — getter
    //   methodName:         — property/arrow-function
    //   methodName<         — generic method
    const m = /^    (?:async |get )?([a-zA-Z_$][a-zA-Z0-9_$]*)[\(<: ]/.exec(line);
    if (m) {
      const name = m[1];
      if (!KEYWORDS.has(name)) {
        members.add(name);
      }
    }
  }

  return members;
}

function extractHelpKeys(src: string): Set<string> {
  const marker = "const methods: Record<string, { signature: string; docs: string }> = {";
  const start = src.indexOf(marker);
  if (start === -1) throw new Error('Could not find help() methods table in main.ts');

  // The table is large (~8 000 chars). Take 60 000 to be safe.
  const chunk = src.slice(start, start + 60_000);

  // Match 'keyName': { signature: ... patterns.
  const keys = new Set<string>();
  for (const m of chunk.matchAll(/'([^']+)':\s*\{\s*signature/g)) {
    keys.add(m[1]);
  }
  return keys;
}

describe('partwrightAPI vs help() parity', () => {
  const src = readFileSync(MAIN_TS, 'latin1');

  const apiMembers = extractApiMembers(src);
  const helpKeys = extractHelpKeys(src);

  it('partwrightAPI should be non-empty (sanity check)', () => {
    expect(apiMembers.size).toBeGreaterThan(50);
  });

  it('help() table should be non-empty (sanity check)', () => {
    expect(helpKeys.size).toBeGreaterThan(100);
  });

  it('every partwrightAPI member is either in help() or INTENTIONALLY_UNDOCUMENTED', () => {
    const missing: string[] = [];
    for (const member of apiMembers) {
      if (!helpKeys.has(member) && !INTENTIONALLY_UNDOCUMENTED.has(member)) {
        missing.push(member);
      }
    }
    expect(missing, `API members missing from help(): ${missing.join(', ')}`).toHaveLength(0);
  });

  it('INTENTIONALLY_UNDOCUMENTED set has no stale entries (every entry is actually in partwrightAPI)', () => {
    const stale: string[] = [];
    for (const name of INTENTIONALLY_UNDOCUMENTED) {
      if (!apiMembers.has(name)) {
        stale.push(name);
      }
    }
    expect(stale, `Stale INTENTIONALLY_UNDOCUMENTED entries (no longer in API): ${stale.join(', ')}`).toHaveLength(0);
  });
});
