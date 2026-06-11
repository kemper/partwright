// Code generation for the Surface panel's "apply as code" path (and the
// `partwright.applySurfaceTextureAsCode` console method behind it).
//
// Instead of baking the textured mesh (destroying the parametric source), the
// panel writes an `api.surface.<id>({ … })` call into the model code so the
// texture lives with the code: it recomputes when the model changes, persists
// with saved versions, and stays editable. This module is the pure text edit:
// insert the call before the code's final top-level `return`, or update the
// options of an existing call for the same modifier (so re-applying with
// tweaked sliders edits in place instead of stacking duplicates).
//
// All matching runs against a LEXICALLY MASKED copy of the source — string,
// template-literal, and comment contents are blanked first — so a call
// mentioned in a comment or string can never be edited, and a `}` inside a
// string param can't break the options-object match. Edits are applied to the
// original text by index.
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

/** A same-length copy of `code` with the contents of string literals,
 *  template literals (including their interpolations), and comments replaced
 *  by spaces (newlines preserved). Regex matching against this mask can't be
 *  fooled by code-shaped text inside strings or comments, and indices map 1:1
 *  back onto the original source. Also returns the brace depth at each index
 *  (counted on the masked text, so braces in strings/comments don't count). */
function lexicalMask(code: string): { masked: string; depth: Int32Array } {
  const len = code.length;
  const out = code.split('');
  const depth = new Int32Array(len);
  // Delimiters (quotes, backticks, comment markers) are KEPT in the mask —
  // only the contents are blanked — so string boundaries stay visible to the
  // match patterns. Regex literals are not modeled (model code essentially
  // never uses them); the worst case there is a missed match, never a
  // corrupting edit inside a string.
  type State = 'code' | 'single' | 'double' | 'template' | 'line' | 'block';
  let state: State = 'code';
  let d = 0;
  for (let i = 0; i < len; i++) {
    const c = code[i];
    const next = code[i + 1];
    depth[i] = d;
    if (state === 'code') {
      if (c === "'") state = 'single';
      else if (c === '"') state = 'double';
      else if (c === '`') state = 'template';
      else if (c === '/' && next === '/') state = 'line';
      else if (c === '/' && next === '*') state = 'block';
      else if (c === '{') d++;
      else if (c === '}') { d = Math.max(0, d - 1); depth[i] = d; }
      continue;
    }
    // Inside a string/template/comment: blank everything except newlines and
    // the closing delimiter.
    const blankEscaped = () => {
      out[i] = ' ';
      if (i + 1 < len) { i++; depth[i] = d; if (code[i] !== '\n') out[i] = ' '; }
    };
    if (state === 'single') {
      if (c === '\\') { blankEscaped(); continue; }
      if (c === "'" || c === '\n') { state = 'code'; continue; } // newline: unterminated, bail
      out[i] = ' ';
    } else if (state === 'double') {
      if (c === '\\') { blankEscaped(); continue; }
      if (c === '"' || c === '\n') { state = 'code'; continue; }
      out[i] = ' ';
    } else if (state === 'template') {
      // The whole template — interpolations included — is masked. A surface
      // call inside `${…}` is out of scope for this edit.
      if (c === '\\') { blankEscaped(); continue; }
      if (c === '`') { state = 'code'; continue; }
      if (c !== '\n') out[i] = ' ';
    } else if (state === 'line') {
      if (c === '\n') { state = 'code'; continue; }
      out[i] = ' ';
    } else { // block comment
      if (c === '*' && next === '/') {
        out[i] = ' ';
        i++; depth[i] = d; out[i] = ' ';
        state = 'code';
        continue;
      }
      if (c !== '\n') out[i] = ' ';
    }
  }
  return { masked: out.join(''), depth };
}

/** Matches an existing call for the given op — either the direct
 *  `api.surface.<id>({ … })` form or the generic `api.surface.apply('<id>', { … })`
 *  form. Run against the lexical mask, where the options object is guaranteed
 *  flat-brace (string contents are blanked) so `\{[^{}]*\}` is exact. The
 *  generic form's quoted id is matched as blanks of the right length. */
function existingCallRe(id: SurfaceOpId): RegExp {
  const obj = String.raw`\{[^{}]*\}`;
  const direct = String.raw`api\.surface\.${id}\(\s*(?:${obj})?\s*\)`;
  // In the mask, '<id>' / "<id>" becomes a quote-delimited run of blanks the
  // same length as the id — match that instead of the literal characters.
  const maskedId = String.raw`['"] {${id.length}}['"]`;
  const generic = String.raw`api\.surface\.apply\(\s*${maskedId}\s*(?:,\s*${obj})?\s*\)`;
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
 * - If the code already calls this op (direct or `apply('<id>', …)` form — in
 *   real code, not in a string or comment), the LAST such call is rewritten
 *   with the new options (normalized to the direct form) — re-applying from
 *   the panel tweaks in place rather than chaining the same texture twice.
 *   Other ops' calls are left alone, so a chain of different textures builds
 *   up naturally.
 * - Otherwise the call is inserted just before the code's LAST top-level
 *   (brace-depth-0) `return`. If every `return` is nested (e.g. the model
 *   only returns from inside conditional blocks), it falls back to the last
 *   `return` at any depth rather than refusing.
 *
 * Returns null when the code has no `return` at all — the caller surfaces an
 * actionable error instead of guessing.
 */
export function upsertSurfaceCall(
  code: string,
  id: SurfaceOpId,
  params: Record<string, number | boolean | string>,
): UpsertResult | null {
  const call = `api.surface.${id}(${formatSurfaceParams(params)});`;
  const { masked, depth } = lexicalMask(code);

  // Update the last real (non-string, non-comment) existing call in place.
  const re = existingCallRe(id);
  let last: RegExpExecArray | null = null;
  for (let m = re.exec(masked); m; m = re.exec(masked)) last = m;
  if (last) {
    const next = code.slice(0, last.index) + call + code.slice(last.index + last[0].length);
    return { code: next, call, replaced: true };
  }

  // Insert before the last top-level `return`; fall back to the last return
  // at any depth (matches the historical behavior for conditional returns).
  const returnRe = /\breturn\b/g;
  let topLevel: number | null = null;
  let anyDepth: number | null = null;
  for (let m = returnRe.exec(masked); m; m = returnRe.exec(masked)) {
    anyDepth = m.index;
    if (depth[m.index] === 0) topLevel = m.index;
  }
  const at = topLevel ?? anyDepth;
  if (at === null) return null;
  // Keep the return's own line indentation for the inserted call.
  const lineStart = code.lastIndexOf('\n', at - 1) + 1;
  const indent = /^[ \t]*/.exec(code.slice(lineStart, at))?.[0] ?? '';
  return {
    code: code.slice(0, at) + `${call}\n${indent}` + code.slice(at),
    call,
    replaced: false,
  };
}
