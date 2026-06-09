// Emit `api.surface.*` calls into a manifold-js model's source (phase 4: the
// Surface panel / console can apply a texture as editable, parametric code
// instead of baking it into a mesh). Pure string transform — unit-testable.

import { SURFACE_OP_FIELDS, type SurfaceOpId } from './surfaceOpSpec';

// Marker for the IIFE wrapper this (and the api.paint.* migration) uses, so
// repeated applies append another line before the same return instead of
// nesting wrappers.
const WRAP_RETURN = 'return __pwModel;';

function roundNum(n: number): string {
  // Compact literal: round to 4 decimals, drop trailing zeros.
  return Number(n.toFixed(4)).toString();
}

/** Serialize chosen opts to a compact object literal, keeping only keys valid
 *  for this op and JSON-serializable scalars (numbers/booleans/strings). */
export function surfaceOptsLiteral(id: SurfaceOpId, opts: Record<string, unknown>): string {
  const allowed = new Set(SURFACE_OP_FIELDS[id]);
  const parts: string[] = [];
  for (const [k, v] of Object.entries(opts)) {
    if (!allowed.has(k)) continue;
    if (typeof v === 'number') { if (Number.isFinite(v)) parts.push(`${k}: ${roundNum(v)}`); }
    else if (typeof v === 'boolean') parts.push(`${k}: ${v}`);
    else if (typeof v === 'string') parts.push(`${k}: ${JSON.stringify(v)}`);
  }
  return parts.length > 0 ? `{ ${parts.join(', ')} }` : '';
}

/** Append an `api.surface.<id>(...)` call to a model's code. If the code is
 *  already wrapped (carries `return __pwModel;` — from a prior surface/paint
 *  emit), insert the call before that return so emits compose; otherwise wrap
 *  the body in an IIFE so any return shape keeps working. */
export function appendSurfaceCall(code: string, id: SurfaceOpId, opts: Record<string, unknown>): string {
  const lit = surfaceOptsLiteral(id, opts);
  const call = `api.surface.${id}(${lit});`;
  const body = code.replace(/\s+$/, '');
  if (body.includes(WRAP_RETURN)) {
    // Insert before the LAST occurrence of the return marker.
    const idx = body.lastIndexOf(WRAP_RETURN);
    return `${body.slice(0, idx)}${call}\n${WRAP_RETURN}${body.slice(idx + WRAP_RETURN.length)}`;
  }
  return [
    '// Surface texture applied as parametric code — edit the params, or remove',
    '// this line to drop the texture. See /ai/textures.md#textures-as-code.',
    'const __pwModel = (() => {',
    body,
    '})();',
    call,
    WRAP_RETURN,
    '',
  ].join('\n');
}
