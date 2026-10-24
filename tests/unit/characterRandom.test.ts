import { describe, it, expect } from 'vitest';
import { specToCode } from '../../src/figure/characterCodegen';
import {
  DEFAULT_SPEC,
  decodeSpecComment,
  normalizeSpec,
  validateSpec,
  specLeaves,
  type CharacterSpec,
} from '../../src/figure/characterSpec';
import {
  randomSpec,
  seededRandom,
  RANDOM_EXCLUDED_VALUES,
  RANDOM_FIXED_FIELDS,
} from '../../src/figure/characterRandom';

const ROLLS = 3000;
const rolls: CharacterSpec[] = Array.from({ length: ROLLS }, (_, i) => randomSpec(seededRandom(i)));

/** Read a dotted path out of a spec. */
function at(spec: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown> | undefined)?.[k], spec);
}
const isFixed = (path: string) => RANDOM_FIXED_FIELDS.some(f => path === f || path.startsWith(`${f}.`));

describe('randomSpec', () => {
  it('is deterministic for a seed and varies across seeds', () => {
    expect(randomSpec(seededRandom(7))).toEqual(randomSpec(seededRandom(7)));
    expect(new Set(rolls.slice(0, 50).map(r => JSON.stringify(r))).size).toBe(50);
  });

  it('always produces a valid, codegen-able spec of the full default shape', () => {
    for (let i = 0; i < 400; i++) {
      const s = rolls[i];
      expect(validateSpec(s), `seed ${i}`).toEqual([]);
      expect(normalizeSpec(s), `seed ${i}`).toEqual(s);
      expect(decodeSpecComment(specToCode(s)), `seed ${i}`).toEqual(normalizeSpec(s));
    }
  });

  it('never rolls an excluded value', () => {
    for (const [i, s] of rolls.entries()) {
      for (const [path, bad] of Object.entries(RANDOM_EXCLUDED_VALUES)) {
        expect(bad, `seed ${i} ${path}`).not.toContain(at(s, path));
      }
    }
  });

  it('keeps rolls coherent', () => {
    for (const [i, s] of rolls.entries()) {
      const toy = s.body.proportions !== 'realistic';
      if (toy || s.body.age < 12) {
        expect(s.body.bust, `seed ${i}`).toBe(0);
        expect(s.body.muscle, `seed ${i}`).toBe(0);
      }
      if (s.body.proportions === 'funko') expect(s.face.eyeStyle, `seed ${i}`).toBe('bead');
      expect(s.colors.pants, `seed ${i}`).not.toBe(s.colors.top);
    }
  });

  it('covers every body style and a spread of ages', () => {
    const styles = new Set(rolls.map(s => s.body.proportions));
    expect([...styles].sort()).toEqual(['chibi', 'funko', 'realistic']);
    expect(rolls.some(s => s.body.age < 12)).toBe(true);
    expect(rolls.some(s => s.body.age > 60)).toBe(true);
  });
});

// The drift guards. Fields come from SPEC_FIELDS and options from the enum
// lists, so a new field or option is picked up here without editing this test.
describe('randomSpec stays in sync with the spec', () => {
  const leaves = specLeaves();

  it('varies every spec field not listed in RANDOM_FIXED_FIELDS', () => {
    const neverVaried: string[] = [];
    for (const leaf of leaves) {
      if (isFixed(leaf.path)) continue;
      const seen = new Set(rolls.map(s => JSON.stringify(at(s, leaf.path))));
      // A one-value enum can't vary; drawing it from its list is enough.
      const singleOption = leaf.kind === 'enum' && (leaf.values?.length ?? 0) === 1;
      if (seen.size < 2 && !singleOption) neverVaried.push(leaf.path);
    }
    // Fix: vary the field in randomSpec, or add it to RANDOM_FIXED_FIELDS.
    expect(neverVaried).toEqual([]);
  });

  it('lists only real, actually-fixed fields in RANDOM_FIXED_FIELDS', () => {
    for (const fixed of RANDOM_FIXED_FIELDS) {
      const matching = leaves.filter(l => l.path === fixed || l.path.startsWith(`${fixed}.`));
      expect(matching.length, `${fixed} is not a spec field`).toBeGreaterThan(0);
      for (const leaf of matching) {
        const def = JSON.stringify(at(DEFAULT_SPEC, leaf.path));
        expect(rolls.every(s => JSON.stringify(at(s, leaf.path)) === def), `${leaf.path} is listed as fixed but varies`).toBe(true);
      }
    }
  });

  it('rolls every non-excluded option of every varied enum field', () => {
    const missing: string[] = [];
    for (const leaf of leaves) {
      if (leaf.kind !== 'enum' || isFixed(leaf.path)) continue;
      const seen = new Set(rolls.map(s => at(s, leaf.path)));
      const excluded = RANDOM_EXCLUDED_VALUES[leaf.path] ?? [];
      for (const v of leaf.values ?? []) if (!excluded.includes(v) && !seen.has(v)) missing.push(`${leaf.path}=${v}`);
    }
    // Fix: let randomSpec draw it (pickEnum over the list), or exclude it in RANDOM_EXCLUDED_VALUES.
    expect(missing).toEqual([]);
  });

  it('excludes only values that exist', () => {
    const byPath = new Map(leaves.map(l => [l.path, l]));
    for (const [path, bad] of Object.entries(RANDOM_EXCLUDED_VALUES)) {
      const leaf = byPath.get(path);
      expect(leaf?.kind, `${path} is not an enum spec field`).toBe('enum');
      for (const v of bad) expect(leaf?.values, `${path}=${v}`).toContain(v);
    }
  });
});
