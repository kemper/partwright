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
  'getModule',          // internal: raw wasm module for advanced geometry ops
  'mergeChatHistory',   // internal chat maintenance, not an agent workflow
  'help',               // the documenter itself — not a help() table key
  '__setProgressModalDelay', // internal test hook
]);

// The former UNDOCUMENTED_BACKLOG (issue #683) is cleared: every agent-facing
// member now has a help() row. Don't reintroduce a backlog — a new method gets
// its help() entry in the same change (CLAUDE.md "UI <-> JS-API parity").

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

  // Scan the WHOLE object (it's ~300 KB and we stop at the `help(` member
  // anyway); an earlier 80 KB window silently scanned only the first third.
  const chunk = src.slice(apiStart, apiStart + 400_000);
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

  // Read up to the table's closing `};` rather than a fixed window: the table
  // passed 60 000 chars in Oct 2026 and a fixed slice silently dropped the
  // last entries, failing the parity check for methods that WERE documented.
  const end = src.slice(start).search(/\n\s*\};/);
  const chunk = src.slice(start, end === -1 ? undefined : start + end);

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

  it('every partwrightAPI member is in help() or INTENTIONALLY_UNDOCUMENTED', () => {
    const missing: string[] = [];
    for (const member of apiMembers) {
      if (!helpKeys.has(member) && !INTENTIONALLY_UNDOCUMENTED.has(member)) {
        missing.push(member);
      }
    }
    // A NEW undocumented method must get a help() entry (or, for a true
    // internal, a justified INTENTIONALLY_UNDOCUMENTED entry).
    expect(missing, `API members missing from help(): ${missing.join(', ')}`).toHaveLength(0);
  });

  it('INTENTIONALLY_UNDOCUMENTED has no stale entries (every name is actually in partwrightAPI)', () => {
    const stale: string[] = [];
    for (const name of INTENTIONALLY_UNDOCUMENTED) {
      if (!apiMembers.has(name)) stale.push(name);
    }
    expect(stale, `Stale undocumented entries (no longer in API): ${stale.join(', ')}`).toHaveLength(0);
  });

  it('INTENTIONALLY_UNDOCUMENTED names do not also have a help() row', () => {
    const both = [...INTENTIONALLY_UNDOCUMENTED].filter((name) => helpKeys.has(name));
    expect(both, `Documented in help() but still exempted: ${both.join(', ')}`).toHaveLength(0);
  });

  it('every help() row names a real partwrightAPI member', () => {
    const phantom = [...helpKeys].filter((name) => !apiMembers.has(name));
    expect(phantom, `help() rows with no API member: ${phantom.join(', ')}`).toHaveLength(0);
  });
});
