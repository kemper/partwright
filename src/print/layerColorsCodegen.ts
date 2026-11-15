// Text edit behind `partwright.setLayerColors` and the Print Preview panel:
// write, update or remove the `api.print.layerColors([...])` call in model
// code, so layer colours live with the code (versioned, re-run on open,
// editable by hand or by the AI) like `api.surface.*` and `api.paint.*`.
//
// Matching runs on a lexically masked copy of the source (strings and
// comments blanked), so a call mentioned in a comment or string is never
// edited. Pure logic: unit-tested in tests/unit/layerColorsCodegen.test.ts.

import { lexicalMask } from '../surface/surfaceCodegen';
import { normalizeHex, type LayerColorChange, type LayerProfile } from './layerColors';

const num = (n: number) => String(Number(n.toPrecision(6)));

/** The statement for a set of changes, e.g. `api.print.layerColors([{ z: 0, color: '#ffffff' }]);`. */
export function formatLayerColorsCall(changes: readonly LayerColorChange[], profile?: Partial<LayerProfile>): string {
  const entries = [...changes].sort((a, b) => a.z - b.z).map((c) => `{ z: ${num(c.z)}, color: '${normalizeHex(c.color)}' }`);
  const opts: string[] = [];
  if (profile?.layerHeight !== undefined) opts.push(`layerHeight: ${num(profile.layerHeight)}`);
  if (profile?.firstLayerHeight !== undefined) opts.push(`firstLayerHeight: ${num(profile.firstLayerHeight)}`);
  return `api.print.layerColors([${entries.join(', ')}]${opts.length > 0 ? `, { ${opts.join(', ')} }` : ''});`;
}

/** Span of the last real `api.print.layerColors(...)` statement in `code`, or null. */
function findCall(code: string): { start: number; end: number } | null {
  const { masked } = lexicalMask(code);
  const re = /api\s*\.\s*print\s*\.\s*layerColors\s*\(/g;
  let found: { start: number; end: number } | null = null;
  for (let m = re.exec(masked); m; m = re.exec(masked)) {
    let depth = 1;
    let i = m.index + m[0].length;
    for (; i < masked.length && depth > 0; i++) {
      if (masked[i] === '(') depth++;
      else if (masked[i] === ')') depth--;
    }
    if (depth !== 0) continue; // unbalanced: leave it alone
    while (i < masked.length && (masked[i] === ' ' || masked[i] === '\t')) i++;
    if (masked[i] === ';') i++;
    found = { start: m.index, end: i };
  }
  return found;
}

export interface LayerColorsEdit {
  code: string;
  /** The statement now in the code ('' after a removal). */
  call: string;
  /** True when an existing call was rewritten or removed; false when a new one was inserted. */
  replaced: boolean;
}

/**
 * Insert or update the layer-colours call. An existing call is rewritten in
 * place; otherwise the call goes just before the code's last top-level
 * `return` (the last `return` at any depth as a fallback). Returns null when
 * the code has no `return` to anchor on.
 */
export function upsertLayerColorsCall(code: string, changes: readonly LayerColorChange[], profile?: Partial<LayerProfile>): LayerColorsEdit | null {
  const call = formatLayerColorsCall(changes, profile);
  const existing = findCall(code);
  if (existing) return { code: code.slice(0, existing.start) + call + code.slice(existing.end), call, replaced: true };

  const { masked, depth } = lexicalMask(code);
  const returnRe = /\breturn\b/g;
  let topLevel: number | null = null;
  let anyDepth: number | null = null;
  for (let m = returnRe.exec(masked); m; m = returnRe.exec(masked)) {
    anyDepth = m.index;
    if (depth[m.index] === 0) topLevel = m.index;
  }
  const at = topLevel ?? anyDepth;
  if (at === null) return null;
  const lineStart = code.lastIndexOf('\n', at - 1) + 1;
  const indent = /^[ \t]*/.exec(code.slice(lineStart, at))?.[0] ?? '';
  return { code: code.slice(0, at) + `${call}\n${indent}` + code.slice(at), call, replaced: false };
}

/** Remove the layer-colours call (and the line it leaves empty). Returns the code unchanged when there is none. */
export function removeLayerColorsCall(code: string): LayerColorsEdit {
  const existing = findCall(code);
  if (!existing) return { code, call: '', replaced: false };
  let { start, end } = existing;
  // If the statement was alone on its line, take the whole line with it.
  const lineStart = code.lastIndexOf('\n', start - 1) + 1;
  const lineEnd = code.indexOf('\n', end);
  if (/^[ \t]*$/.test(code.slice(lineStart, start)) && /^[ \t]*$/.test(code.slice(end, lineEnd === -1 ? code.length : lineEnd))) {
    start = lineStart;
    end = lineEnd === -1 ? code.length : lineEnd + 1;
  }
  return { code: code.slice(0, start) + code.slice(end), call: '', replaced: true };
}
