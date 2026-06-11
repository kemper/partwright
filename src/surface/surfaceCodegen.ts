// Code generation for the Surface panel's "apply as code" path (and the
// `partwright.applySurfaceTextureAsCode` console method behind it).
//
// Instead of baking the textured mesh (destroying the parametric source), the
// panel writes an `api.surface.<id>({ … })` call into the model code so the
// texture lives with the code: it recomputes when the model changes, persists
// with saved versions, and stays editable. This module is the pure text edit:
// insert the call before the code's final `return`, or update the options of
// an existing call for the same modifier (so re-applying with tweaked sliders
// edits in place instead of stacking duplicates).
//
// Pure logic (no DOM/engine) so it unit-tests in the vitest tier. Sibling of
// `src/geometry/voxel/editCodegen.ts`, which does the same "append before the
// final return" edit for Voxel Studio.

import type { SurfaceOpId } from './surfaceOpSpec';

/** Format an options value for source output. Numbers are rounded to 6
 *  significant digits so slider floats don't smear into 17-digit noise. */
function formatValue(v: number | boolean | string): string {
  if (typeof v === 'number') return String(Number(v.toPrecision(6)));
  if (typeof v === 'boolean') return String(v);
  return `'${v.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

/** Render a params record as a single-line object literal (`{ a: 1, b: 'x' }`),
 *  or `{}` when empty. Key order follows the record's insertion order. */
export function formatSurfaceParams(params: Record<string, number | boolean | string>): string {
  const entries = Object.entries(params).map(([k, v]) => `${k}: ${formatValue(v)}`);
  return entries.length > 0 ? `{ ${entries.join(', ')} }` : '{}';
}

/** Matches an existing call for the given op — either the direct
 *  `api.surface.<id>({ … })` form or the generic `api.surface.apply('<id>', { … })`
 *  form. The options object can be matched exactly with `\{[^{}]*\}` because
 *  surface-op params are flat (the allow-list admits only number/boolean/string
 *  values, so the literal can never contain a nested brace). */
function existingCallRe(id: SurfaceOpId): RegExp {
  const obj = String.raw`\{[^{}]*\}`;
  const direct = String.raw`api\.surface\.${id}\(\s*(?:${obj})?\s*\)`;
  const generic = String.raw`api\.surface\.apply\(\s*['"]${id}['"]\s*(?:,\s*${obj})?\s*\)`;
  return new RegExp(`(?:${direct}|${generic})\\s*;?`, 'g');
}

export interface UpsertResult {
  code: string;
  /** The exact statement now in the code. */
  call: string;
  /** True when an existing call for this op was updated in place;
   *  false when a new call was inserted before the final `return`. */
  replaced: boolean;
}

/**
 * Insert or update an `api.surface.<id>({ … })` call in model code.
 *
 * - If the code already calls this op (direct or `apply('<id>', …)` form), the
 *   LAST such call is rewritten with the new options (normalized to the direct
 *   form) — re-applying from the panel tweaks in place rather than chaining
 *   the same texture twice. Other ops' calls are left alone, so a chain of
 *   different textures builds up naturally.
 * - Otherwise the call is inserted just before the code's final `return …;`
 *   (the greedy prefix pins the match to the LAST return in the source, same
 *   approach as the Voxel Studio codegen).
 *
 * Returns null when the code has no `return …;` to hook onto — the caller
 * surfaces an actionable error instead of guessing.
 */
export function upsertSurfaceCall(
  code: string,
  id: SurfaceOpId,
  params: Record<string, number | boolean | string>,
): UpsertResult | null {
  const call = `api.surface.${id}(${formatSurfaceParams(params)});`;

  const re = existingCallRe(id);
  let last: RegExpExecArray | null = null;
  for (let m = re.exec(code); m; m = re.exec(code)) last = m;
  if (last) {
    const next = code.slice(0, last.index) + call + code.slice(last.index + last[0].length);
    return { code: next, call, replaced: true };
  }

  const trimmed = code.replace(/\s+$/, '');
  const m = /^([\s\S]*)\breturn\b([\s\S]*?);\s*$/.exec(trimmed);
  if (!m) return null;
  const prefix = m[1].replace(/\s+$/, '');
  const expr = m[2].trim();
  return {
    code: `${prefix}\n${call}\nreturn ${expr};\n`,
    call,
    replaced: false,
  };
}
