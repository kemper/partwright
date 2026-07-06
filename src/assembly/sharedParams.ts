// Cross-part parameter reconciliation for the Assembly view. Pure and
// dependency-free (node-testable). It takes every part's declared parameter
// schema + current values and produces the UNION of parameters by key — one row
// per distinct parameter name, annotated with which parts it drives. The
// Assembly parameter panel renders these; changing one live-previews every part
// that declares that key, and Save persists to each of those parts.
//
// "Union by name" is the product decision: a parameter appears if ANY part
// declares it, and the panel shows an "affects N parts" indicator so the user
// knows the blast radius before dragging. When several parts share a numeric key
// with different ranges, the reconciled spec takes the widest range so every
// part's value stays reachable from the one slider.

import type { ParamSpec, ParamValue, ParamValues } from '../geometry/params';

/** One part's contribution to the union: its declared schema + current values. */
export interface PartParams {
  partId: string;
  partName: string;
  schema: ParamSpec[];
  values: ParamValues;
}

/** One row in the Assembly parameter panel. */
export interface SharedParam {
  /** Reconciled spec used to render the widget (widest numeric range across the
   *  contributing parts; other fields taken from the first part to declare it). */
  spec: ParamSpec;
  /** Ids of the parts this parameter drives (same key + compatible type). */
  partIds: string[];
  /** Names of those parts, for the "affects N parts" hover tooltip. */
  partNames: string[];
  /** Seed value for the widget: the parts' common value when they agree, else
   *  the reconciled default. */
  value: ParamValue;
  /** True when the contributing parts currently hold different values for this
   *  key (the widget shows the reconciled default; changing it aligns them). */
  mixed: boolean;
}

interface Accum {
  spec: ParamSpec;
  parts: { id: string; name: string; value: ParamValue }[];
}

/** Resolve a part's current value for `key`: its stored override, else the
 *  spec default. */
function currentValue(spec: ParamSpec, values: ParamValues): ParamValue {
  const v = values[spec.key];
  return v !== undefined ? v : spec.default;
}

/** Widen `into` to also cover `add`'s numeric range (union of [min,max], finest
 *  step). Mutates and returns `into`. Only meaningful for number/int specs. */
function widenRange(into: ParamSpec, add: ParamSpec): void {
  if (add.min !== undefined) into.min = into.min === undefined ? add.min : Math.min(into.min, add.min);
  if (add.max !== undefined) into.max = into.max === undefined ? add.max : Math.max(into.max, add.max);
  if (add.step !== undefined) into.step = into.step === undefined ? add.step : Math.min(into.step, add.step);
}

/**
 * Build the union of parameters across all parts.
 *
 * Rows preserve first-seen order across the parts (like `mergeParamSchemas`).
 * A key declared with two *different* types across parts keeps the first type;
 * parts whose spec has a mismatching type are omitted from that row's part set
 * (and reported in {@link buildSharedParams}'s `typeConflicts`).
 */
export function buildSharedParams(parts: PartParams[]): {
  params: SharedParam[];
  /** Keys that appeared with inconsistent types across parts (first type won). */
  typeConflicts: string[];
} {
  const order: string[] = [];
  const byKey = new Map<string, Accum>();
  const conflicts = new Set<string>();

  for (const part of parts) {
    for (const spec of part.schema) {
      const existing = byKey.get(spec.key);
      if (!existing) {
        order.push(spec.key);
        // Clone the spec so range-widening never mutates a part's own schema.
        byKey.set(spec.key, {
          spec: { ...spec },
          parts: [{ id: part.partId, name: part.partName, value: currentValue(spec, part.values) }],
        });
        continue;
      }
      if (spec.type !== existing.spec.type) {
        conflicts.add(spec.key); // incompatible re-declaration — first type wins
        continue;
      }
      widenRange(existing.spec, spec);
      existing.parts.push({ id: part.partId, name: part.partName, value: currentValue(spec, part.values) });
    }
  }

  const params: SharedParam[] = order.map((key) => {
    const acc = byKey.get(key)!;
    const values = acc.parts.map(p => p.value);
    const allEqual = values.every(v => v === values[0]);
    return {
      spec: acc.spec,
      partIds: acc.parts.map(p => p.id),
      partNames: acc.parts.map(p => p.name),
      value: allEqual ? values[0] : acc.spec.default,
      mixed: !allEqual,
    };
  });

  return { params, typeConflicts: [...conflicts] };
}
