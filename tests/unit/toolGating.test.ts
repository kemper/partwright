import { describe, it, expect } from 'vitest';
import { buildToolList, ALL_TOOLS } from '../../src/ai/tools';
import type { ChatToggles } from '../../src/ai/types';

// buildToolList's non-plan filter is a WHITELIST over the gating sets with a
// default of "drop" — a tool defined in ALL_TOOLS but absent from every set
// silently never reaches the model. That exact gap shipped twice
// (evalAgainstImport in the first reconstruction PR, then the measurement
// tools) before this guard existed: with every toggle enabled, every defined
// tool must be exposed.

/** All scopes/vision/notes on, auto-continue on — the maximal surface. */
const FULL_TOGGLES = {
  scope: { runCode: true, saveVersions: true, paintFaces: true, sessionNotes: true },
  vision: { views: true },
  autoResume: true,
  planFirst: false,
} as unknown as ChatToggles;

describe('AI tool gating', () => {
  it('every defined tool is exposed under fully-enabled toggles (no orphans)', () => {
    const exposed = new Set(buildToolList(FULL_TOGGLES).map((t) => t.name));
    const orphans = ALL_TOOLS.map((t) => t.name).filter((n) => !exposed.has(n));
    expect(orphans).toEqual([]);
  });

  it('plan mode is a strict read-only subset', () => {
    const plan = buildToolList({ ...FULL_TOGGLES, planFirst: true } as unknown as ChatToggles);
    const planNames = new Set(plan.map((t) => t.name));
    const full = new Set(buildToolList(FULL_TOGGLES).map((t) => t.name));
    for (const n of planNames) expect(full.has(n)).toBe(true);
    // Mutating tools stay hidden while planning.
    expect(planNames.has('runAndSave')).toBe(false);
    expect(planNames.has('convertToCode')).toBe(false);
    // Measurements are available for grounding the plan.
    expect(planNames.has('profileModel')).toBe(true);
    expect(planNames.has('evalAgainstImport')).toBe(true);
  });
});
