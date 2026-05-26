// Whole-document code transforms for the insert palette. Pure and
// dependency-free (unit-tested in tests/insert-codegen.spec.ts) — the palette
// reads the editor, runs these, and writes the result back via setValue.
//
// manifold-js needs a single managed `return` so the program stays valid as
// shapes/operations accumulate; OpenSCAD just appends statements (all
// top-level geometry renders) and wraps statements for operations.

import { fmt, type Vec3 } from './codegen';

/** True for a `return` expression we're willing to overwrite automatically:
 *  a bare identifier (a managed part) or a single constructor call. A more
 *  complex hand-written return is preserved instead of being clobbered. */
export function isSimpleReturnExpr(expr: string): boolean {
  const e = expr.trim();
  if (/^[A-Za-z_$][\w$]*$/.test(e)) return true;
  return (
    /^(api\.)?(Manifold|CrossSection|Curves)\b/.test(e) ||
    /^labeledUnion\s*\(/.test(e) ||
    /^api\.renderMesh\s*\(/.test(e)
  );
}

/** True when the return expression is the shape the additive-insert flow
 *  produces: a bare identifier (the very first inserted part) OR a chain of
 *  `.add(identifier)` calls on a bare identifier (the union of every
 *  palette-inserted part so far). When this matches we *extend* the chain
 *  instead of overwriting it, so adding a second shape doesn't hide the first. */
export function isAdditiveReturnExpr(expr: string): boolean {
  return /^[A-Za-z_$][\w$]*(?:\s*\.\s*add\s*\(\s*[A-Za-z_$][\w$]*\s*\))*$/.test(expr.trim());
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

export type ReturnMode = 'force' | 'ifSimple' | 'addOrReplace' | 'none';

export interface AddDeclarationResult {
  code: string;
  /** Whether the visible `return` now points at `resultName` (either replaced
   *  outright or extended with a `.add(resultName)` so it's part of the union).
   *  When false the caller should tell the user the part was added but isn't
   *  shown yet. */
  returnSet: boolean;
}

/** Insert a `const <resultName> = …;` declaration and (optionally) repoint the
 *  trailing `return` at it. The declaration lands just before the return line,
 *  or at end-of-file when there is no return.
 *
 *  Modes:
 *  - `force` — always replace the return with `return <resultName>;`. Used by
 *    operations (union/subtract/intersect) whose result subsumes the operands.
 *  - `addOrReplace` — the additive flow for primitive insertion. If the return
 *    is already a part chain (`a` or `a.add(b)`), append `.add(<resultName>)`
 *    so the new shape joins the existing scene. If the return is a single
 *    constructor call (e.g. the default `Manifold.cube(...)`), replace it so
 *    the first inserted shape doesn't double up with the placeholder.
 *  - `ifSimple` — legacy: replace whenever the return is "simple" (constructor
 *    call OR bare identifier). Kept for back-compat but no longer used by the
 *    palette.
 *  - `none` — never repoint the return. */
export function addJsDeclaration(
  code: string,
  declLine: string,
  resultName: string,
  mode: ReturnMode,
): AddDeclarationResult {
  let withDestructure = ensureManifoldDestructure(code);
  if (/\bCrossSection\b/.test(declLine)) {
    withDestructure = ensureCrossSectionDestructure(withDestructure);
  }
  const ret = findLastReturn(withDestructure);

  if (!ret) {
    const sep = withDestructure.length === 0 || withDestructure.endsWith('\n') ? '' : '\n';
    return {
      code: `${withDestructure}${sep}${declLine}\nreturn ${resultName};\n`,
      returnSet: true,
    };
  }

  const lineStart = withDestructure.lastIndexOf('\n', ret.index - 1) + 1;
  const before = withDestructure.slice(0, lineStart);
  const after = withDestructure.slice(lineStart);

  const isAdditive = mode === 'addOrReplace' && isAdditiveReturnExpr(ret.expr);
  const shouldReplace =
    !isAdditive && (
      mode === 'force'
      || (mode === 'ifSimple' && isSimpleReturnExpr(ret.expr))
      || (mode === 'addOrReplace' && isSimpleReturnExpr(ret.expr))
    );

  let newAfter: string;
  if (isAdditive) {
    newAfter = after.replace(/return\s+([^;]+?)\s*;/, `return $1.add(${resultName});`);
  } else if (shouldReplace) {
    newAfter = after.replace(/return\s+[^;]+;/, `return ${resultName};`);
  } else {
    newAfter = after;
  }

  return { code: `${before}${declLine}\n${newAfter}`, returnSet: isAdditive || shouldReplace };
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
