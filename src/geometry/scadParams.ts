// SCAD Customizer parser — pure logic, no WASM/DOM.
//
// OpenSCAD has its own "customizer" convention: top-level variables become
// tweakable parameters, with a trailing line comment describing the widget and
// an optional preceding `// description` line. Groups are introduced by
// `/* [Group] */` headers; a group literally named `Hidden` suppresses its
// variables. Examples:
//
//   // Box width
//   width = 30;        // [10:100]      → slider 10..100
//   rows  = 2;         // [1:1:6]       → slider 1..6 step 1
//   style = "flat";    // [flat, round] → dropdown
//   mode  = 1;         // [0:Off, 1:On] → dropdown (value:label)
//   label = "PARTS";   // 12            → text, maxlength 12
//   solid = true;                       → checkbox
//
// We translate that into the SAME `ParamSpec[]` the JS engines produce via
// `api.params({...})`, so the existing engine-agnostic Customizer panel renders
// SCAD knobs with zero UI changes. Overrides are applied through OpenSCAD's
// native `-D name=value` command-line flag (see `buildScadDefines`), so no
// source rewriting is needed — the engine just passes extra `-D` args.
//
// This module is dependency-free so it lives in the fast vitest unit tier and
// is reused by the OpenSCAD engine (schema capture + override defines).

import { normalizeParamSchema, coerceParamValue, type ParamSpec, type ParamValue } from './params';

/** The OpenSCAD literal kind a parameter was declared with. Drives `-D` value
 *  quoting (strings are quoted, numbers/bools are not) independently of the
 *  widget type the value maps to — e.g. a numeric dropdown is a `select`
 *  ParamSpec but must be emitted to OpenSCAD as a bare number. */
type ScadKind = 'number' | 'bool' | 'string';

interface RawEntry {
  key: string;
  kind: ScadKind;
  /** Raw spec object in the `api.params` shape, fed through normalizeParamSchema. */
  raw: Record<string, unknown>;
}

const NUM_RE = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;
const ASSIGN_RE = /^([A-Za-z_]\w*)\s*=\s*(.+?)\s*;\s*(?:\/\/(.*))?$/;
const GROUP_RE = /^\/\*\s*\[([^\]]*)\]\s*\*\/$/;

function isNumericLiteral(s: string): boolean {
  return NUM_RE.test(s.trim());
}

/** Strip line/block comments and string contents from one line for the sole
 *  purpose of brace counting, threading multi-line block-comment state. We
 *  blank out string bodies (keeping the quotes) so braces inside strings or
 *  comments never affect depth. */
function stripForDepth(line: string, inBlock: boolean): { code: string; inBlock: boolean } {
  let out = '';
  let i = 0;
  let block = inBlock;
  let str: '"' | "'" | null = null;
  while (i < line.length) {
    const c = line[i];
    const next = line[i + 1];
    if (block) {
      if (c === '*' && next === '/') { block = false; i += 2; continue; }
      i++; continue;
    }
    if (str) {
      if (c === '\\') { i += 2; continue; }
      if (c === str) { str = null; }
      i++; continue;
    }
    if (c === '/' && next === '/') break;            // rest of line is a comment
    if (c === '/' && next === '*') { block = true; i += 2; continue; }
    if (c === '"' || c === "'") { str = c; i++; continue; }
    out += c;
    i++;
  }
  return { code: out, inBlock: block };
}

/** Parse a trailing-comment annotation into the relevant raw-spec fields, given
 *  the variable's literal kind. Returns null when the annotation is empty (the
 *  caller then falls back to a plain number/text widget). */
function parseAnnotation(ann: string, kind: ScadKind): Record<string, unknown> | null {
  const t = ann.trim();
  if (t === '') return null;

  const bracket = t.match(/^\[(.*)\]$/);
  if (bracket) {
    const inner = bracket[1].trim();
    const parts = inner.split(',').map(p => p.trim()).filter(p => p.length > 0);

    // Single segment with colon(s) and all-numeric pieces → a range
    // `[min:max]` or `[min:step:max]`. Anything else with commas is a dropdown.
    if (parts.length === 1 && parts[0].includes(':')) {
      const segs = parts[0].split(':').map(s => s.trim());
      if (segs.length >= 2 && segs.length <= 3 && segs.every(isNumericLiteral)) {
        if (segs.length === 2) return { min: Number(segs[0]), max: Number(segs[1]) };
        return { min: Number(segs[0]), step: Number(segs[1]), max: Number(segs[2]) };
      }
    }

    if (parts.length > 0) {
      // Dropdown — each part is `value` or `value:label`.
      const options = parts.map(p => {
        const ci = p.indexOf(':');
        if (ci >= 0) {
          const value = p.slice(0, ci).trim();
          const label = p.slice(ci + 1).trim();
          return label ? { value, label } : { value };
        }
        return { value: p };
      });
      return { __select: true, options };
    }
    return null;
  }

  // A bare number annotation: max-value for numbers, max-length for strings.
  if (isNumericLiteral(t)) {
    const n = Number(t);
    if (kind === 'string') return { maxLength: Math.max(1, Math.floor(n)) };
    return { max: n };
  }

  return null;
}

/** Collect raw customizer entries from SCAD source in declaration order. Only
 *  top-level (brace-depth 0) simple-literal assignments are considered;
 *  variables inside modules/functions/blocks and special `$vars` are ignored,
 *  matching OpenSCAD's customizer. */
function collect(source: string): RawEntry[] {
  const lines = source.split(/\r?\n/);
  const entries: RawEntry[] = [];
  const seen = new Set<string>();
  let hidden = false;
  let pendingDesc: string | undefined;
  let depth = 0;
  let inBlock = false;

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();

    // Group header `/* [Name] */` — only meaningful outside a block comment and
    // at top level. A group named "Hidden" suppresses its members.
    if (!inBlock && depth === 0) {
      const gm = trimmed.match(GROUP_RE);
      if (gm) {
        hidden = gm[1].trim().toLowerCase() === 'hidden';
        pendingDesc = undefined;
        continue;
      }
    }

    const wasInBlock = inBlock;
    const { code, inBlock: nowInBlock } = stripForDepth(rawLine, inBlock);
    const startDepth = depth;
    for (const ch of code) {
      if (ch === '{') depth++;
      else if (ch === '}') depth = Math.max(0, depth - 1);
    }
    inBlock = nowInBlock;

    // A standalone `// description` line (not a group, not inside a block
    // comment) attaches to the next assignment.
    if (!wasInBlock && code.trim() === '' && trimmed.startsWith('//')) {
      pendingDesc = trimmed.replace(/^\/\/\s?/, '').trim() || undefined;
      continue;
    }

    // Only parse assignments that sit entirely at top level and outside a
    // block comment. Match the *raw* line, not the depth-stripped `code` —
    // stripForDepth blanks string literals (so braces inside them don't move
    // depth), which would erase a string variable's value.
    const desc = pendingDesc;
    if (!(wasInBlock || nowInBlock) && startDepth === 0 && depth === 0) {
      const m = trimmed.match(ASSIGN_RE);
      if (m && !seen.has(m[1])) {
        const key = m[1];
        const valueLit = m[2].trim();
        const ann = (m[3] ?? '').trim();
        const entry = buildEntry(key, valueLit, ann, desc, hidden);
        if (entry) { entries.push(entry); seen.add(key); }
      }
    }

    // Reset the pending description on any non-comment line so a description
    // only binds to an immediately-following assignment.
    if (code.trim() !== '' || !trimmed.startsWith('//')) pendingDesc = undefined;
  }

  return entries;
}

function buildEntry(key: string, valueLit: string, ann: string, desc: string | undefined, hidden: boolean): RawEntry | null {
  if (hidden) return null;

  const help = desc && desc.length > 0 ? { help: desc } : {};

  // Boolean checkbox.
  if (valueLit === 'true' || valueLit === 'false') {
    return { key, kind: 'bool', raw: { type: 'boolean', default: valueLit === 'true', ...help } };
  }

  // String literal — `"..."`.
  const strMatch = valueLit.match(/^"((?:[^"\\]|\\.)*)"$/);
  if (strMatch) {
    const def = strMatch[1].replace(/\\"/g, '"');
    const a = parseAnnotation(ann, 'string');
    if (a && a.__select) {
      return { key, kind: 'string', raw: { type: 'select', default: def, options: a.options, ...help } };
    }
    if (a && typeof a.maxLength === 'number') {
      return { key, kind: 'string', raw: { type: 'text', default: def, maxLength: a.maxLength, ...help } };
    }
    return { key, kind: 'string', raw: { type: 'text', default: def, ...help } };
  }

  // Numeric literal.
  if (isNumericLiteral(valueLit)) {
    const def = Number(valueLit);
    const a = parseAnnotation(ann, 'number');
    if (a && a.__select) {
      // Numeric dropdown — keep option values as strings (select contract) but
      // remember the kind so the override is emitted unquoted.
      return { key, kind: 'number', raw: { type: 'select', default: String(def), options: a.options, ...help } };
    }
    const min = a && typeof a.min === 'number' ? a.min : undefined;
    const max = a && typeof a.max === 'number' ? a.max : undefined;
    const step = a && typeof a.step === 'number' ? a.step : undefined;
    const ints = [def, min, max, step].filter((n): n is number => typeof n === 'number');
    const type = ints.every(n => Number.isInteger(n)) ? 'int' : 'number';
    return {
      key,
      kind: 'number',
      raw: {
        type,
        default: def,
        ...(min !== undefined ? { min } : {}),
        ...(max !== undefined ? { max } : {}),
        ...(step !== undefined ? { step } : {}),
        ...help,
      },
    };
  }

  // Vectors and expression defaults aren't customizable widgets — skip.
  return null;
}

/** Normalize collected entries through the canonical validator, dropping any
 *  that don't pass (e.g. a dropdown whose default isn't among its options).
 *  Returns specs paired with their SCAD literal kind for define formatting. */
function parseEntries(source: string): Array<{ spec: ParamSpec; kind: ScadKind }> {
  const out: Array<{ spec: ParamSpec; kind: ScadKind }> = [];
  for (const entry of collect(source)) {
    try {
      const [spec] = normalizeParamSchema({ [entry.key]: entry.raw });
      if (spec) out.push({ spec, kind: entry.kind });
    } catch {
      // A malformed annotation shouldn't break the whole panel — skip it.
    }
  }
  return out;
}

/** Parse the OpenSCAD customizer schema from source into the shared ParamSpec
 *  form. Empty when the source declares no customizable top-level variables. */
export function parseScadParams(source: string): ParamSpec[] {
  return parseEntries(source).map(e => e.spec);
}

function formatScadValue(kind: ScadKind, value: ParamValue): string {
  if (kind === 'bool') return value ? 'true' : 'false';
  if (kind === 'string') return `"${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  return String(value);
}

/** Build OpenSCAD `-D name=value` override flags for the parameters whose
 *  override differs from the source default. Returns an interleaved arg array
 *  ready to splice into a `callMain([...])` invocation, e.g.
 *  `['-D', 'width=47', '-D', 'solid=false']`. */
export function buildScadDefines(source: string, overrides?: Record<string, unknown>): string[] {
  if (!overrides) return [];
  const args: string[] = [];
  for (const { spec, kind } of parseEntries(source)) {
    if (!(spec.key in overrides)) continue;
    const v = coerceParamValue(spec, overrides[spec.key]);
    if (v === undefined || v === spec.default) continue;
    args.push('-D', `${spec.key}=${formatScadValue(kind, v)}`);
  }
  return args;
}
