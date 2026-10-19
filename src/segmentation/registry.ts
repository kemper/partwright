// Detector registry. Every surface (panel controls, window.partwright,
// AI tool schema, CLI flags) reads detectors and their ParamSpecs from here,
// so registering a detector updates all of them at once.

import { autoMergeDetector } from './autoPatches';
import { creaseWatershedDetector, piecesDetector } from './detectors';
import { planarGroupsDetector } from './planarGroups';
import type { DetectorPreset, ParamSpec, ParamValues, PartDetector } from './types';

const DETECTORS: PartDetector[] = [piecesDetector, creaseWatershedDetector, autoMergeDetector, planarGroupsDetector];

export function listDetectors(): readonly PartDetector[] {
  return DETECTORS;
}

export function getDetector(id: string): PartDetector | undefined {
  return DETECTORS.find((d) => d.id === id);
}

export function detectorIds(): string[] {
  return DETECTORS.map((d) => d.id);
}

/** Detectors that may run unattended (import-time auto-detect,
 *  `autoDetectParts`), in the order they should be tried: opted in via
 *  `autoPropose`, able to run without seeds, ascending priority (registry
 *  order breaks ties). */
export function autoProposeDetectors(): PartDetector[] {
  return DETECTORS
    .map((d, i) => ({ d, i }))
    .filter(({ d }) => d.autoPropose !== undefined && d.seeds !== 'required')
    .sort((a, b) => a.d.autoPropose!.priority - b.d.autoPropose!.priority || a.i - b.i)
    .map(({ d }) => d);
}

/** JSON-friendly description of a detector (for listPartDetectors / docs). */
export function describeDetector(d: PartDetector): {
  id: string; name: string; description: string; bestFor: string;
  seeds: PartDetector['seeds']; params: ParamSpec[]; presets: DetectorPreset[]; autoPropose: boolean;
} {
  return {
    id: d.id, name: d.name, description: d.description, bestFor: d.bestFor, seeds: d.seeds,
    params: d.params.map((p) => ({ ...p })),
    presets: (d.presets ?? []).map((p) => ({ name: p.name, params: { ...p.params }, ...(p.featureOptions ? { featureOptions: { ...p.featureOptions } } : {}) })),
    autoPropose: d.autoPropose !== undefined && d.seeds !== 'required',
  };
}

/** Fill defaults and validate user params against a detector's ParamSpecs.
 *  Unknown keys and out-of-range/mistyped values throw — no coercion, matching
 *  the rest of the console API. */
export function resolveParams(d: PartDetector, raw: Record<string, unknown> | undefined): ParamValues {
  const out: ParamValues = {};
  const input = raw ?? {};
  const known = new Set(d.params.map((p) => p.key));
  for (const k of Object.keys(input)) {
    if (!known.has(k)) {
      const allowed = d.params.map((p) => p.key).join(', ') || '(none)';
      throw new Error(`Unknown param "${k}" for detector "${d.id}". Allowed: ${allowed}`);
    }
  }
  for (const p of d.params) {
    const v = input[p.key];
    if (v === undefined) { out[p.key] = p.default; continue; }
    out[p.key] = checkParam(d.id, p, v);
  }
  return out;
}

function checkParam(detectorId: string, p: ParamSpec, v: unknown): number | boolean | string {
  const where = `params.${p.key} (${detectorId})`;
  switch (p.type) {
    case 'boolean':
      if (typeof v !== 'boolean') throw new Error(`${where} must be a boolean`);
      return v;
    case 'enum':
      if (typeof v !== 'string' || !p.options?.includes(v)) throw new Error(`${where} must be one of: ${(p.options ?? []).join(', ')}`);
      return v;
    case 'number':
    case 'integer': {
      if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error(`${where} must be a finite number`);
      if (p.type === 'integer' && !Number.isInteger(v)) throw new Error(`${where} must be an integer`);
      if (p.min !== undefined && v < p.min) throw new Error(`${where} must be ≥ ${p.min}`);
      if (p.max !== undefined && v > p.max) throw new Error(`${where} must be ≤ ${p.max}`);
      return v;
    }
  }
}

/** JSON-Schema fragment for a detector's params (AI tool schemas). Only the
 *  OpenAPI subset Gemini accepts: type/enum/minimum/maximum/description. */
export function paramsJsonSchema(): Record<string, unknown> {
  const props: Record<string, unknown> = {};
  for (const d of DETECTORS) {
    for (const p of d.params) {
      const text = `[${d.id}] ${p.label}: ${p.hint} Default ${String(p.default)}.`;
      const seen = props[p.key] as Record<string, unknown> | undefined;
      // A key several detectors share keeps the first one's type, and lists
      // every detector's meaning, so the model never reads one detector's
      // hint as another's.
      if (seen) {
        seen.description = `${String(seen.description)} ${text}`;
        if (seen.minimum !== undefined && (p.min === undefined || p.min < (seen.minimum as number))) seen.minimum = p.min;
        if (seen.maximum !== undefined && (p.max === undefined || p.max > (seen.maximum as number))) seen.maximum = p.max;
        if (seen.minimum === undefined) delete seen.minimum;
        if (seen.maximum === undefined) delete seen.maximum;
        continue;
      }
      const base: Record<string, unknown> = { description: text };
      if (p.type === 'enum') { base.type = 'string'; base.enum = p.options; }
      else if (p.type === 'boolean') base.type = 'boolean';
      else { base.type = p.type === 'integer' ? 'integer' : 'number'; if (p.min !== undefined) base.minimum = p.min; if (p.max !== undefined) base.maximum = p.max; }
      props[p.key] = base;
    }
  }
  return { type: 'object', description: 'Detector parameters (see listPartDetectors). Omit for defaults.', properties: props };
}
