// ai.md serves two audiences (#1175 Phase 1): external agents read the whole
// file and drive the `window.partwright` console; the in-app chat gets it as
// its system prompt with the external-only blocks removed (inAppAiMd). These
// tests keep the markers well-formed so nothing leaks either way.

import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { inAppAiMd } from '../../src/ai/systemPrompt';

const aiMd = readFileSync(new URL('../../public/ai.md', import.meta.url), 'utf8');

describe('ai.md external-only markers', () => {
  test('start/end markers alternate and never nest', () => {
    const markers = [...aiMd.matchAll(/<!-- external-only:(start|end) -->/g)].map(m => m[1]);
    expect(markers.length).toBeGreaterThan(0);
    expect(markers.length % 2, 'every start needs an end').toBe(0);
    markers.forEach((m, i) => expect(m, `marker ${i}`).toBe(i % 2 === 0 ? 'start' : 'end'));
  });

  test('each marker sits on its own line', () => {
    for (const line of aiMd.split('\n')) {
      if (line.includes('external-only:') && !line.startsWith('<!-- Maintainers:')) {
        expect(line.trim()).toMatch(/^<!-- external-only:(start|end) -->$/);
      }
    }
  });

  test('in-app notes are single-line, name their audience, and hold no inner -->', () => {
    for (const line of aiMd.split('\n')) {
      if (!line.includes('<!-- in-app:')) continue;
      // External agents read the raw file, so the note must say who it's for.
      expect(line).toMatch(/^<!-- in-app: \(In-app chat only\.\) .+ -->$/);
      expect(line.slice('<!-- in-app: '.length, -' -->'.length)).not.toContain('-->');
    }
  });
});

describe('inAppAiMd', () => {
  const inApp = inAppAiMd(aiMd);

  test('leaves no HTML comments behind', () => {
    expect(inApp).not.toContain('<!--');
  });

  test('drops the console-only material', () => {
    expect(inApp).not.toContain('## Console API');
    expect(inApp).not.toContain('## Argument validation');
    expect(inApp).not.toContain('## Arrange mode');
    expect(inApp).not.toContain('partwright.toggleClip');
  });

  test('keeps what the in-app model needs', () => {
    for (const heading of ['## Before you start', '## What do I do for X?', '## Topic index (subdocs)', '## Writing model code (manifold-js)', '## Iteration workflow', '### Recommended iteration pattern']) {
      expect(inApp).toContain(heading);
    }
    expect(inApp).toContain('Your tools validate their arguments');
  });

  test('is substantially smaller than the served file', () => {
    expect(inApp.length).toBeLessThan(aiMd.length * 0.7);
  });

  test('every in-page link still resolves in the in-app text', () => {
    // GitHub-style heading slugs, plus explicit <a id> anchors.
    const slug = (h: string) => h.trim().toLowerCase().replace(/[^\p{L}\p{N}\s_-]/gu, '').replace(/\s/g, '-');
    const targets = new Set<string>();
    for (const m of inApp.matchAll(/^#+ (.+)$/gm)) targets.add(slug(m[1]));
    for (const m of inApp.matchAll(/<a id="([^"]+)"/g)) targets.add(m[1]);
    const dangling = [...inApp.matchAll(/\]\(#([^)]+)\)/g)].map(m => m[1]).filter(a => !targets.has(a));
    expect(dangling, 'point these at a subdoc (/ai/<name>.md#…) or keep their section in-app').toEqual([]);
  });

  test('CRLF input is stripped and collapsed too', () => {
    const doc = 'a\r\n\r\n<!-- external-only:start -->\r\nx\r\n<!-- external-only:end -->\r\n\r\n\r\nb\r\n<!-- in-app: note --> \r\n';
    const out = inAppAiMd(doc);
    expect(out).not.toContain('external-only');
    expect(out).not.toMatch(/(\r?\n){3,}/);
    expect(out.startsWith('a\r\n\r\nb')).toBe(true);
  });

  test('handles an empty fence and collapses blank runs', () => {
    const doc = 'a\n\n<!-- external-only:start -->\nx\n<!-- external-only:end -->\n\n\n\nb\n<!-- in-app: note -->\n';
    expect(inAppAiMd(doc)).toBe('a\n\nb\nnote\n');
  });
});
