// Whole-document code transforms for the insert palette. Pure and
// dependency-free (unit-tested in tests/insert-codegen.spec.ts) — the palette
// reads the editor, runs these, and writes the result back via setValue.
//
// manifold-js needs a single managed `return` so the program stays valid as
// shapes/operations accumulate; OpenSCAD just appends statements (all
// top-level geometry renders) and wraps statements for operations.

import { fmt, scanPartsJs, type Vec3 } from './codegen';

/** A bare identifier — the simplest return expression (a single managed part). */
function isBareIdent(expr: string): boolean {
  return /^[A-Za-z_$][\w$]*$/.test(expr.trim());
}

/** A single library constructor call — the throwaway placeholder a fresh
 *  session returns (e.g. the default `Manifold.cube(...)`). Distinguished from
 *  a user's real geometry by also requiring the program to have no named
 *  parts (see addManagedDeclaration). */
function isConstructorCall(expr: string): boolean {
  const e = expr.trim();
  return (
    /^(api\.)?(Manifold|CrossSection|Curves|BREP)\b/.test(e) ||
    /^labeledUnion\s*\(/.test(e) ||
    /^api\.renderMesh\s*\(/.test(e)
  );
}

/** Split a comma-separated expression list at top level, respecting nested
 *  brackets/parens/braces (so `Manifold.union([a, b.translate([1,2,3])])`
 *  splits into `a` and `b.translate([1,2,3])`, not at the inner commas). */
export function splitTopLevelCommas(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '[' || c === '(' || c === '{') depth++;
    else if (c === ']' || c === ')' || c === '}') depth--;
    else if (c === ',' && depth === 0) {
      out.push(s.slice(start, i));
      start = i + 1;
    }
  }
  if (start < s.length) out.push(s.slice(start));
  return out;
}

/** Ensure `Manifold` is destructured from `api` (the house style every
 *  example uses). No-op when it already is, or when code reads `api.Manifold`
 *  directly. */
export function ensureManifoldDestructure(code: string): string {
  if (/const\s*\{[^}]*\bManifold\b[^}]*\}\s*=\s*api\b/.test(code)) return code;
  if (/\bapi\.Manifold\b/.test(code)) return code;
  return `const { Manifold } = api;\n${code}`;
}

/** Ensure `CrossSection` is destructured from `api` (needed by shapes that
 *  build their geometry via the 2D library — torus, polygon prisms, etc.).
 *  Prefer extending an existing `const { … } = api` line over adding a new one,
 *  so we don't pile up redundant destructures. */
export function ensureCrossSectionDestructure(code: string): string {
  if (/const\s*\{[^}]*\bCrossSection\b[^}]*\}\s*=\s*api\b/.test(code)) return code;
  if (/\bapi\.CrossSection\b/.test(code)) return code;
  // If there's already a `const { … } = api;` line, slip CrossSection into it.
  const re = /const\s*\{\s*([^}]+?)\s*\}\s*=\s*api\b/;
  const m = re.exec(code);
  if (m) {
    const names = m[1].split(',').map(s => s.trim()).filter(Boolean);
    if (!names.includes('CrossSection')) names.push('CrossSection');
    return code.slice(0, m.index) + `const { ${names.join(', ')} } = api` + code.slice(m.index + m[0].length);
  }
  return `const { CrossSection } = api;\n${code}`;
}

/** Ensure `BREP` is destructured from `api` (the replicad house style:
 *  `const { BREP } = api;` then bare `BREP.box(...)`). Slips into an existing
 *  `const { … } = api` line when there is one. */
export function ensureBrepDestructure(code: string): string {
  if (/const\s*\{[^}]*\bBREP\b[^}]*\}\s*=\s*api\b/.test(code)) return code;
  const re = /const\s*\{\s*([^}]+?)\s*\}\s*=\s*api\b/;
  const m = re.exec(code);
  if (m) {
    const names = m[1].split(',').map(s => s.trim()).filter(Boolean);
    if (!names.includes('BREP')) names.push('BREP');
    return code.slice(0, m.index) + `const { ${names.join(', ')} } = api` + code.slice(m.index + m[0].length);
  }
  return `const { BREP } = api;\n${code}`;
}

interface ReturnMatch {
  index: number;
  expr: string;
}

function findLastReturn(code: string): ReturnMatch | null {
  // Anchor to the start of a line (after optional indentation) so the word
  // "return" inside a `//` comment or a string literal isn't mistaken for a
  // return statement (the default example's comment literally says "…return
  // the final Manifold object").
  const re = /^[ \t]*return\s+([^;]+);/gm;
  let last: ReturnMatch | null = null;
  let m: RegExpExecArray | null;
  while ((m = re.exec(code)) !== null) {
    last = { index: m.index, expr: m[1] };
  }
  return last;
}

export interface AddDeclarationResult {
  code: string;
  /** Whether the visible `return` now includes the new part(s). When false the
   *  part was inserted but isn't shown yet (auto-combine off) — the caller can
   *  hint the user to combine it. */
  returnSet: boolean;
}

/** The engine-specific "show every part" combinator + how to recognise one we
 *  already manage so its element list can be extended in place. */
type ManagedLang = 'manifold-js' | 'replicad';
const MANAGED: Record<ManagedLang, {
  wrap: (parts: string[]) => string;
  match: RegExp;
  ensure: (code: string) => string;
}> = {
  'manifold-js': {
    wrap: (p) => `Manifold.union([${p.join(', ')}])`,
    match: /^(?:api\.)?Manifold\.union\(\s*\[([\s\S]*)\]\s*\)$/,
    ensure: ensureManifoldDestructure,
  },
  'replicad': {
    wrap: (p) => `BREP.fuseAll([${p.join(', ')}])`,
    match: /^(?:api\.)?BREP\.fuseAll\(\s*\[([\s\S]*)\]\s*\)$/,
    ensure: ensureBrepDestructure,
  },
};

export interface ManagedDeclOptions {
  /** Engine — selects the union combinator + destructure preamble. */
  lang: ManagedLang;
  /** Part name(s) the declaration introduces (usually one; `enclosure.box`
   *  binds two). Folded into the visible union when `combine`. */
  addNames: string[];
  /** When false (auto-combine off), insert the declaration but leave the
   *  return untouched — the part exists in code but isn't shown yet. */
  combine: boolean;
  /** Names to drop from the visible union as they're folded in. Operations
   *  pass their operands so the result replaces them rather than piling up. */
  replaceNames?: string[];
}

/** Insert a `const …;` declaration and fold its part(s) into the engine's
 *  managed "show everything" union (`Manifold.union([…])` / `BREP.fuseAll([…])`).
 *
 *  The cardinal rule: **never silently drop existing geometry.** Whatever the
 *  current return is — a bare part, a managed union, or a hand-written
 *  expression — it becomes an element of the new union. The one exception is a
 *  throwaway placeholder return (a lone constructor call in a program with no
 *  named parts, i.e. a fresh session's default), which is replaced so the first
 *  insert doesn't double up with it. */
export function addManagedDeclaration(
  code: string,
  declLine: string,
  opts: ManagedDeclOptions,
): AddDeclarationResult {
  const cfg = MANAGED[opts.lang];
  let withPre = cfg.ensure(code);
  if (opts.lang === 'manifold-js' && /\bCrossSection\b/.test(declLine)) {
    withPre = ensureCrossSectionDestructure(withPre);
  }
  const ret = findLastReturn(withPre);

  const toReturnExpr = (list: string[]): string =>
    list.length === 1 ? list[0] : cfg.wrap(list);

  if (!ret) {
    // No return yet — declare and return the part(s). (Auto-combine off is
    // meaningless without an existing return to leave alone, so we still emit
    // one so the program is valid.)
    const sep = withPre.length === 0 || withPre.endsWith('\n') ? '' : '\n';
    return {
      code: `${withPre}${sep}${declLine}\nreturn ${toReturnExpr(opts.addNames)};\n`,
      returnSet: true,
    };
  }

  const lineStart = withPre.lastIndexOf('\n', ret.index - 1) + 1;
  const before = withPre.slice(0, lineStart);
  const after = withPre.slice(lineStart);

  if (!opts.combine) {
    // Insert the declaration before the return; leave the return as-is.
    return { code: `${before}${declLine}\n${after}`, returnSet: false };
  }

  // Derive the current union element list from the existing return expression.
  const expr = ret.expr.trim();
  let list: string[];
  const managed = cfg.match.exec(expr);
  if (managed) {
    list = splitTopLevelCommas(managed[1]).map(s => s.trim()).filter(Boolean);
  } else if (isBareIdent(expr)) {
    list = [expr];
  } else if (isConstructorCall(expr) && scanPartsJs(withPre).length === 0) {
    // Throwaway placeholder (default starter) — drop it.
    list = [];
  } else {
    // Real hand-written return — preserve it as an element (never drop).
    list = [`(${expr})`];
  }

  const drop = new Set(opts.replaceNames ?? []);
  list = list.filter(e => !drop.has(e));
  for (const n of opts.addNames) if (!list.includes(n)) list.push(n);

  const newAfter = after.replace(/return\s+[^;]+;/, `return ${toReturnExpr(list)};`);
  return { code: `${before}${declLine}\n${newAfter}`, returnSet: true };
}

/** Append a top-level OpenSCAD statement. */
export function appendScadStatement(code: string, statement: string): string {
  const sep = code.length > 0 && !code.endsWith('\n') ? '\n' : '';
  return `${code}${sep}${statement}\n`;
}

/** Replace a set of OpenSCAD statement ranges with a single `block`, inserted
 *  where the earliest range began. Ranges are half-open `[from, to)` character
 *  offsets (as returned by scanPartsScad). */
export function replaceScadRanges(
  code: string,
  ranges: { from: number; to: number }[],
  block: string,
): string {
  if (ranges.length === 0) return code;
  const sorted = [...ranges].sort((a, b) => a.from - b.from);
  const insertAt = sorted[0].from;

  // Delete from last to first so earlier offsets stay valid.
  let out = code;
  const deletions = [...sorted].sort((a, b) => b.from - a.from);
  let adjustedInsert = insertAt;
  for (const r of deletions) {
    out = out.slice(0, r.from) + out.slice(r.to);
    if (r.from < adjustedInsert) {
      adjustedInsert -= r.to - r.from;
    }
  }

  // Tidy whitespace around the splice point.
  const head = out.slice(0, adjustedInsert).replace(/[ \t]+$/, '');
  const tail = out.slice(adjustedInsert).replace(/^[ \t]*\n?/, '');
  const headSep = head.length > 0 && !head.endsWith('\n') ? '\n' : '';
  const tailSep = tail.length > 0 ? '\n' : '';
  return `${head}${headSep}${block}${tailSep}${tail}`;
}

// ---------------------------------------------------------------------------
// Voxel scaffold + statements (one grid `v`; every fill unions into it)
// ---------------------------------------------------------------------------

// Matches a grid handle declared as `const v = voxels()` or `= api.voxels()`
// (the destructured and namespaced forms both appear in voxel sessions).
const VOXEL_GRID_RE = /\b(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:api\.)?voxels\s*\(\s*\)/;

/** The grid variable a voxel session fills (`const v = voxels()`), or `'v'`. */
export function voxelGridVar(code: string): string {
  const m = VOXEL_GRID_RE.exec(code);
  return m ? m[1] : 'v';
}

/** Ensure the voxel scaffold exists — a grid handle near the top and a trailing
 *  `return <grid>;` — so fills can chain onto a named handle. Idempotent.
 *
 *  Three cases: (1) a `const v = voxels()` handle already exists → reuse it;
 *  (2) the session returns an inline grid expression (`return voxels().fillBox(…)`)
 *  → bind that expression to a handle so further fills append to it instead of
 *  racing a second grid; (3) empty/no return → a fresh `const v = api.voxels()`
 *  (the namespaced form needs no `const { voxels } = api` destructure). */
export function ensureVoxelScaffold(code: string): { code: string; gridVar: string } {
  const existing = VOXEL_GRID_RE.exec(code);
  if (existing) {
    const gridVar = existing[1];
    let out = code;
    if (!new RegExp(`^[ \\t]*return\\s+${gridVar}\\s*;`, 'm').test(out)) {
      const sep = out.length === 0 || out.endsWith('\n') ? '' : '\n';
      out = `${out}${sep}return ${gridVar};\n`;
    }
    return { code: out, gridVar };
  }

  const ret = findLastReturn(code);
  if (ret) {
    // Bind the inline returned grid to a handle, preserving whatever form the
    // user wrote (`voxels()` / `api.voxels()` / a variable).
    const gridVar = 'v';
    const lineStart = code.lastIndexOf('\n', ret.index - 1) + 1;
    const before = code.slice(0, lineStart);
    const after = code.slice(lineStart);
    const newAfter = after.replace(/return\s+([^;]+);/, `const ${gridVar} = $1;\nreturn ${gridVar};`);
    return { code: before + newAfter, gridVar };
  }

  const sep = code.length === 0 || code.endsWith('\n') ? '' : '\n';
  return { code: `${code}${sep}const v = api.voxels();\nreturn v;\n`, gridVar: 'v' };
}

/** Insert a voxel fill statement just before the `return v;` line (so fills
 *  accumulate into the grid in source order). Scaffolds first if needed. */
export function appendVoxelStatement(code: string, statement: string): string {
  const { code: scaffolded, gridVar } = ensureVoxelScaffold(code);
  const retRe = new RegExp(`(^|\\n)([ \\t]*return\\s+${gridVar}\\s*;)`);
  const m = retRe.exec(scaffolded);
  if (!m) {
    const sep = scaffolded.endsWith('\n') ? '' : '\n';
    return `${scaffolded}${sep}${statement}\n`;
  }
  const insertAt = m.index + (m[1] ? m[1].length : 0);
  const head = scaffolded.slice(0, insertAt);
  const tail = scaffolded.slice(insertAt);
  const headSep = head.length > 0 && !head.endsWith('\n') ? '\n' : '';
  return `${head}${headSep}${statement}\n${tail}`;
}

/** Replace a voxel statement (located by its scanned range) with `newStmt` —
 *  used by the drag writeback, which re-emits the whole `v.…(); // part: name`
 *  line at the moved coordinates (voxels bake position into their args, so
 *  there is no `translate()` to bump). */
export function replaceVoxelStatement(
  code: string,
  range: { from: number; to: number },
  newStmt: string,
): string {
  return code.slice(0, range.from) + newStmt + code.slice(range.to);
}

// ---------------------------------------------------------------------------
// Moving a part (drag-gizmo writeback)
// ---------------------------------------------------------------------------

const NUM = '-?\\d*\\.?\\d+(?:[eE][+-]?\\d+)?';
const TRIPLE = `\\[\\s*(${NUM})\\s*,\\s*(${NUM})\\s*,\\s*(${NUM})\\s*\\]`;

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Add `delta` to the `[x, y, z]` vector literal inside a translate call,
 *  preserving the surrounding text (`.translate([…])` or `translate([…])`). */
function addDeltaToTranslate(call: string, delta: Vec3): string {
  const re = new RegExp(TRIPLE);
  return call.replace(re, (_full, a: string, b: string, c: string) =>
    `[${fmt(parseFloat(a) + delta[0])}, ${fmt(parseFloat(b) + delta[1])}, ${fmt(parseFloat(c) + delta[2])}]`,
  );
}

/** Shift a manifold-js part by `delta`: bump the trailing `.translate([…])` on
 *  its declaration, or append one if it has none. Returns the code unchanged
 *  when no `const <name> = …;` is found. */
export function setPartTranslateDeltaJs(code: string, name: string, delta: Vec3): string {
  const declRe = new RegExp(`(const\\s+${escapeRegExp(name)}\\s*=\\s*)([\\s\\S]*?)(;)`);
  const m = declRe.exec(code);
  if (!m) return code;
  let rhs = m[2];

  const transRe = new RegExp(`\\.translate\\(${TRIPLE}\\)`, 'g');
  const matches = [...rhs.matchAll(transRe)];
  if (matches.length > 0) {
    const last = matches[matches.length - 1];
    const updated = addDeltaToTranslate(last[0], delta);
    rhs = rhs.slice(0, last.index!) + updated + rhs.slice(last.index! + last[0].length);
  } else {
    rhs = `${rhs}.translate([${fmt(delta[0])}, ${fmt(delta[1])}, ${fmt(delta[2])}])`;
  }
  return code.slice(0, m.index) + m[1] + rhs + m[3] + code.slice(m.index + m[0].length);
}

/** Shift an OpenSCAD part (located by its `// part: <name>` tag) by `delta`:
 *  bump a leading `translate([…])`, or prepend one. */
export function setPartTranslateDeltaScad(
  code: string,
  statement: { from: number; to: number },
  delta: Vec3,
): string {
  const stmt = code.slice(statement.from, statement.to);
  const leadRe = new RegExp(`^translate\\(${TRIPLE}\\)`);
  let updated: string;
  if (leadRe.test(stmt)) {
    updated = stmt.replace(leadRe, (mm) => addDeltaToTranslate(mm, delta));
  } else {
    updated = `translate([${fmt(delta[0])}, ${fmt(delta[1])}, ${fmt(delta[2])}]) ${stmt}`;
  }
  return code.slice(0, statement.from) + updated + code.slice(statement.to);
}

// ---------------------------------------------------------------------------
// Mirror / Duplicate / Delete (selection-driven quick actions)
// ---------------------------------------------------------------------------

/** Inject `.mirror([n])` into a JS part's declaration so the shape is flipped
 *  *in place* — inserted before any trailing `.translate([…])`, so the part's
 *  position is preserved. Returns the code unchanged when no matching
 *  `const <name> = …;` exists. */
export function mirrorPartJs(code: string, name: string, axis: Vec3): string {
  const declRe = new RegExp(`(const\\s+${escapeRegExp(name)}\\s*=\\s*)([\\s\\S]*?)(;)`);
  const m = declRe.exec(code);
  if (!m) return code;
  let rhs = m[2];
  const mirrorCall = `.mirror([${fmt(axis[0])}, ${fmt(axis[1])}, ${fmt(axis[2])}])`;
  const transRe = new RegExp(`\\.translate\\(${TRIPLE}\\)`, 'g');
  const matches = [...rhs.matchAll(transRe)];
  if (matches.length > 0) {
    const last = matches[matches.length - 1];
    rhs = rhs.slice(0, last.index!) + mirrorCall + rhs.slice(last.index!);
  } else {
    rhs = `${rhs}${mirrorCall}`;
  }
  return code.slice(0, m.index) + m[1] + rhs + m[3] + code.slice(m.index + m[0].length);
}

/** Wrap an OpenSCAD part's construction (everything after its leading
 *  `translate([…])`, if any) in `mirror([…])` so the shape flips in place. */
export function mirrorPartScad(
  code: string,
  statement: { from: number; to: number },
  axis: Vec3,
): string {
  const stmt = code.slice(statement.from, statement.to);
  const leadRe = new RegExp(`^(translate\\(${TRIPLE}\\)\\s*)`);
  const lead = leadRe.exec(stmt);
  const mirrorCall = `mirror([${fmt(axis[0])}, ${fmt(axis[1])}, ${fmt(axis[2])}])`;
  let updated: string;
  if (lead) {
    updated = `${lead[1]}${mirrorCall} ${stmt.slice(lead[0].length)}`;
  } else {
    updated = `${mirrorCall} ${stmt}`;
  }
  return code.slice(0, statement.from) + updated + code.slice(statement.to);
}

/** Append `const <newName> = <originalName>.translate([dx,dy,dz]);` right after
 *  the original part's declaration. Caller guarantees `newName` is unique. */
export function duplicatePartJs(
  code: string,
  originalName: string,
  newName: string,
  offset: Vec3,
): string {
  const declRe = new RegExp(`(const\\s+${escapeRegExp(originalName)}\\s*=[\\s\\S]*?;)`);
  const m = declRe.exec(code);
  if (!m) return code;
  const end = m.index + m[0].length;
  const translate = offset[0] !== 0 || offset[1] !== 0 || offset[2] !== 0
    ? `.translate([${fmt(offset[0])}, ${fmt(offset[1])}, ${fmt(offset[2])}])`
    : '';
  const newLine = `\nconst ${newName} = ${originalName}${translate};`;
  return code.slice(0, end) + newLine + code.slice(end);
}

/** Duplicate an OpenSCAD statement, optionally wrapping the copy in `translate`
 *  for an offset. Tags the copy with `// part: <newName>` so the operand
 *  scanner picks it up. */
export function duplicatePartScad(
  code: string,
  statement: { from: number; to: number },
  newName: string,
  offset: Vec3,
): string {
  const stmt = code.slice(statement.from, statement.to);
  // Strip any existing `// part:` so we don't carry over the old name.
  const stripped = stmt.replace(/\s*\/\/ part:[^\n]*/, '').trim();
  // Drop a trailing `;` so we can wrap in translate cleanly, then re-add.
  const trailingSemi = stripped.endsWith(';');
  const body = trailingSemi ? stripped.slice(0, -1) : stripped;
  const nonZero = offset[0] !== 0 || offset[1] !== 0 || offset[2] !== 0;
  const wrapped = nonZero
    ? `translate([${fmt(offset[0])}, ${fmt(offset[1])}, ${fmt(offset[2])}]) ${body}`
    : body;
  const newStmt = `${wrapped}${trailingSemi ? ';' : ''} // part: ${newName}`;
  // Append after the original statement, on its own line.
  const sep = code[statement.to - 1] === '\n' ? '' : '\n';
  return code.slice(0, statement.to) + sep + newStmt + '\n' + code.slice(statement.to);
}

/** Remove a JS `const <name> = …;` declaration. If a trailing `return <name>;`
 *  remains, repoint it at the previous surviving named const, or to the last
 *  named const in the file. Returns the code unchanged when no match is found. */
export function removeJsDeclaration(code: string, name: string): string {
  const declRe = new RegExp(`(^|\\n)[ \\t]*const\\s+${escapeRegExp(name)}\\s*=[\\s\\S]*?;[ \\t]*(?:\\r?\\n|$)`);
  const m = declRe.exec(code);
  if (!m) return code;
  // Keep the leading newline if we matched it (so we don't fuse two lines).
  const start = m.index + (m[1] === '\n' ? 1 : 0);
  const end = m.index + m[0].length;
  let out = code.slice(0, start) + code.slice(end);

  // If `return <name>;` survives, swap it for the last remaining named const.
  const retRe = new RegExp(`(^|\\n)([ \\t]*return\\s+)${escapeRegExp(name)}(\\s*;)`);
  if (retRe.test(out)) {
    const remaining = [...out.matchAll(/^[ \t]*const\s+([A-Za-z_$][\w$]*)\s*=/gm)]
      .map(mm => mm[1])
      .filter(n => n !== name);
    const replacement = remaining[remaining.length - 1];
    if (replacement) {
      out = out.replace(retRe, `$1$2${replacement}$3`);
    }
  }
  return out;
}

/** Remove a managed-engine part: delete its `const <name> = …;` *and* drop it
 *  from the managed visible union (`Manifold.union([…])` / `BREP.fuseAll([…])`)
 *  so the union doesn't keep a dangling reference to the deleted const. Collapses
 *  the union to a bare return when one part remains, and repoints to the last
 *  surviving const (or drops the return) when none do. */
export function removeManagedPart(code: string, name: string, lang: ManagedLang): string {
  let out = removeJsDeclaration(code, name);
  const cfg = MANAGED[lang];
  const ret = findLastReturn(out);
  if (!ret) return out;
  const m = cfg.match.exec(ret.expr.trim());
  if (!m) return out;

  const list = splitTopLevelCommas(m[1]).map(s => s.trim()).filter(Boolean).filter(e => e !== name);
  const lineStart = out.lastIndexOf('\n', ret.index - 1) + 1;
  const before = out.slice(0, lineStart);
  const after = out.slice(lineStart);

  if (list.length >= 1) {
    const expr = list.length === 1 ? list[0] : cfg.wrap(list);
    return before + after.replace(/return\s+[^;]+;/, `return ${expr};`);
  }
  // Union emptied — repoint to the last remaining named const, or drop the
  // return so the engine reports the empty scene with its usual message.
  const remaining = scanPartsJs(out).map(p => p.name);
  const last = remaining[remaining.length - 1];
  return last
    ? before + after.replace(/return\s+[^;]+;/, `return ${last};`)
    : before + after.replace(/^[ \t]*return\s+[^;]+;[ \t]*\n?/m, '');
}

/** Remove an OpenSCAD statement at `[from, to)`, collapsing leftover blank lines. */
export function removeScadStatement(
  code: string,
  statement: { from: number; to: number },
): string {
  let out = code.slice(0, statement.from) + code.slice(statement.to);
  // Tidy: collapse a doubled blank line where the statement used to be.
  const splice = statement.from;
  if (out[splice - 1] === '\n' && out[splice] === '\n') {
    out = out.slice(0, splice) + out.slice(splice + 1);
  }
  return out;
}
