import { describe, test, expect, beforeEach } from 'vitest';
import { STARTERS, nextStarter, isStarterCode } from '../../src/editor/starters';
import type { Language } from '../../src/geometry/engine';

// nextStarter persists its rotation index in localStorage; the vitest tier runs
// in node, so provide a minimal in-memory stand-in.
class MemStorage {
  private m = new Map<string, string>();
  getItem(k: string) { return this.m.has(k) ? this.m.get(k)! : null; }
  setItem(k: string, v: string) { this.m.set(k, String(v)); }
  removeItem(k: string) { this.m.delete(k); }
  clear() { this.m.clear(); }
}

const LANGS: Language[] = ['manifold-js', 'voxel', 'scad', 'replicad'];

beforeEach(() => {
  (globalThis as unknown as { localStorage: MemStorage }).localStorage = new MemStorage();
});

describe('STARTERS data', () => {
  test('every engine has a non-empty starter set', () => {
    for (const lang of LANGS) {
      expect(STARTERS[lang].length).toBeGreaterThan(0);
    }
  });

  test('manifold-js starters self-colour via api.label({ color })', () => {
    for (const s of STARTERS['manifold-js']) {
      expect(s.code).toMatch(/api\.label\(/);
      expect(s.code).toMatch(/color:\s*'#[0-9a-fA-F]{6}'/);
      expect(s.paint).toBeUndefined(); // colour is in code, no post-run paint
    }
  });

  test('voxel starters carry a hex colour per call', () => {
    for (const s of STARTERS.voxel) {
      expect(s.code).toMatch(/'#[0-9a-fA-F]{6}'/);
      expect(s.paint).toBeUndefined();
    }
  });

  test('scad/replicad starters declare a paint label that matches their code', () => {
    for (const lang of ['scad', 'replicad'] as const) {
      for (const s of STARTERS[lang]) {
        expect(s.paint).toBeDefined();
        const { label, colorHex } = s.paint!;
        expect(colorHex).toMatch(/^#[0-9a-fA-F]{6}$/);
        // The painted label must actually be declared in the snippet.
        expect(s.code.includes(`"${label}"`) || s.code.includes(`'${label}'`)).toBe(true);
      }
    }
  });
});

describe('nextStarter rotation', () => {
  test('cycles through every starter then wraps, per language', () => {
    for (const lang of LANGS) {
      const set = STARTERS[lang];
      const seen = set.map(() => nextStarter(lang).code);
      // One full lap visits every distinct starter code.
      expect(new Set(seen).size).toBe(set.length);
      // The next call wraps back to the first.
      expect(nextStarter(lang).code).toBe(set[0].code);
    }
  });

  test('rotation is independent per language', () => {
    nextStarter('manifold-js'); // advance only manifold-js
    expect(nextStarter('voxel').code).toBe(STARTERS.voxel[0].code);
  });
});

describe('isStarterCode', () => {
  test('recognizes every starter from every engine', () => {
    for (const lang of LANGS) {
      for (const s of STARTERS[lang]) {
        expect(isStarterCode(s.code)).toBe(true);
      }
    }
  });

  test('tolerates whitespace reflow (auto-format)', () => {
    const base = STARTERS['manifold-js'][0].code;
    const reflowed = base.replace(/, /g, ',\n  ').replace(/\n+/g, '\n  ') + '\n\n';
    expect(isStarterCode(reflowed)).toBe(true);
  });

  test('treats blank code as a starter', () => {
    expect(isStarterCode('')).toBe(true);
    expect(isStarterCode('   \n  ')).toBe(true);
  });

  test('matches the legacy cube stub for back-compat', () => {
    expect(isStarterCode('const { Manifold } = api;\nreturn Manifold.cube([10, 10, 10], true);')).toBe(true);
  });

  test('rejects edited / foreign code', () => {
    expect(isStarterCode("const { Manifold } = api;\nreturn Manifold.sphere(99);")).toBe(false);
    // A real token edit to a starter (different radius) is no longer a starter.
    const edited = STARTERS['manifold-js'][1].code.replace('12', '30');
    expect(isStarterCode(edited)).toBe(false);
  });
});
