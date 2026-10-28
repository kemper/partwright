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
    markers.forEach((m, i) => expect(m, `marker ${i}`).toBe(i % 2 === 0 ? 'start' : 'end'));
  });

  test('each marker sits on its own line', () => {
    for (const line of aiMd.split('\n')) {
      if (line.includes('external-only:') && !line.startsWith('<!-- Maintainers:')) {
        expect(line.trim()).toMatch(/^<!-- external-only:(start|end) -->$/);
      }
    }
  });

  test('in-app notes are single-line comments', () => {
    for (const line of aiMd.split('\n')) {
      if (line.includes('<!-- in-app:')) expect(line).toMatch(/^<!-- in-app: .+ -->$/);
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

  test('handles an empty fence and collapses blank runs', () => {
    const doc = 'a\n\n<!-- external-only:start -->\nx\n<!-- external-only:end -->\n\n\n\nb\n<!-- in-app: note -->\n';
    expect(inAppAiMd(doc)).toBe('a\n\nb\nnote\n');
  });
});
