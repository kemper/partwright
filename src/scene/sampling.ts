// Per-instance parameter / transform sampling for scenes.
//
// Each placed instance gets its OWN sampled parameter values, emitted into the
// generated code as literals (api.params resolves ONE global value set per run,
// so per-instance variation can't go through it). Every sampled value is run
// through coerceParamValue so the literal is guaranteed valid for its spec.

import type { ParamSpec, ParamValue } from '../geometry/params';
import { coerceParamValue } from '../geometry/params';
import type { AssetSpec, LayoutControl } from './types';
import type { Rng } from './prng';

/** Sample one valid value for a single parameter spec. */
function sampleOne(spec: ParamSpec, rng: Rng): ParamValue {
  let raw: unknown;
  switch (spec.type) {
    case 'number': {
      const min = spec.min !== undefined ? spec.min : asNum(spec.default, 0);
      const max = spec.max !== undefined ? spec.max : (spec.min !== undefined ? spec.min : asNum(spec.default, 0));
      raw = max > min ? rng.range(min, max) : min;
      break;
    }
    case 'int': {
      const min = spec.min !== undefined ? spec.min : asNum(spec.default, 0);
      const max = spec.max !== undefined ? spec.max : min;
      let v = max >= min ? rng.int(min, max) : min;
      // Respect a declared step (snap to the nearest step from min).
      if (spec.step !== undefined && spec.step > 0) {
        v = min + Math.round((v - min) / spec.step) * spec.step;
      }
      raw = Math.round(v);
      break;
    }
    case 'boolean':
      raw = rng.next() < 0.5;
      break;
    case 'select': {
      const opts = spec.options ?? [];
      raw = opts.length > 0 ? rng.pick(opts).value : spec.default;
      break;
    }
    case 'text':
    case 'color':
    default:
      raw = spec.default;
      break;
  }
  // Coerce against the spec — guarantees the literal we emit is valid and in
  // range; falls back to the declared default if sampling produced something
  // the spec rejects.
  const coerced = coerceParamValue(spec, raw);
  return coerced !== undefined ? coerced : spec.default;
}

function asNum(v: ParamValue, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

/** Sample a complete, valid parameter value set for one asset instance. */
export function sampleParams(spec: AssetSpec, rng: Rng): Record<string, ParamValue> {
  const out: Record<string, ParamValue> = {};
  for (const p of spec.params) {
    out[p.key] = sampleOne(p, rng);
  }
  return out;
}

/** Sample an instance scale from the layout's scaleRange (defaults to 1). */
export function sampleScale(layout: LayoutControl, rng: Rng): number {
  const range = layout.scaleRange;
  if (!range) return 1;
  const [lo, hi] = range;
  if (!(hi > lo)) return lo;
  return rng.range(lo, hi);
}

/** Sample an instance rotation (degrees about Z) from rotationJitter (0..360
 *  band centered on 0; defaults to no rotation). */
export function sampleRotation(layout: LayoutControl, rng: Rng): number {
  const jitter = layout.rotationJitter ?? 0;
  if (jitter <= 0) return 0;
  return rng.range(-jitter, jitter);
}
