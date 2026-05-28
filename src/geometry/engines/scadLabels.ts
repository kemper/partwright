/**
 * Tiny source-level scanner for the SCAD `label("name") <expr>` convention.
 *
 * SCAD has no provenance through CGAL booleans, so labels can't survive a
 * single `--export-format=stl` round-trip. But OpenSCAD's `--enable=lazy-union`
 * emits each top-level statement as its own `<object>` in AMF, in source
 * order. If we (1) scan the source for which top-level statements are
 * wrapped in `label("...")` and (2) count the unlabeled ones too, we can
 * map AMF objects 1:1 by position back to those names.
 *
 * This module is the (1) half — purely textual, no SCAD AST.
 *
 * Scope (v1):
 *   - Top-level `label("literal-string") <expr>;` only.
 *   - Anything nested inside `{ ... }` (so: inside any boolean, hull,
 *     minkowski, intersection_for, etc.) is NOT a top-level label. It's
 *     flagged separately so the engine can warn the user.
 *   - Runtime-computed names (`label(str("c", i))`) are intentionally
 *     ignored — they'd require runtime values we don't have.
 */

export interface ScadTopLevelStatement {
  /** Label name from `label("name") <expr>;` at the start of the statement's
   *  transformation chain, or null if the statement isn't labelled. */
  labelName: string | null;
}

export interface ScadLabelScan {
  /** One entry per top-level statement that produces geometry, in source order.
   *  Length should equal the number of `<object>` elements in lazy-union AMF.
   *  Empty when the source has no geometry statements. */
  topLevelStatements: ScadTopLevelStatement[];
  /** True iff the source contains any `label(` token at all. Cheap pre-check —
   *  the engine uses this to decide whether to take the lazy-union+AMF path
   *  or stay on the existing STL fast path. */
  hasAnyLabelCalls: boolean;
  /** True iff a `label(` token appears at brace-depth ≥ 1 (i.e. inside a
   *  `{ ... }` block such as a boolean's operand list). Engines should warn:
   *  these labels will be lost because the surrounding boolean is performed
   *  by OpenSCAD's CGAL backend, which strips provenance. */
  hasNestedLabels: boolean;
  /** Names of every `label("literal")` call the scanner saw, regardless of
   *  position (top-level, inside booleans, anywhere). The engine diffs this
   *  against the final labelMap to surface `lostLabels` — names the user
   *  wrote but didn't survive into paintByLabel reach. Runtime-computed
   *  names (`label(str("c", i))`) don't appear here. */
  allLiteralLabelNames: string[];
}

/**
 * Scan a SCAD source string. See {@link ScadLabelScan} for the result shape.
 *
 * The scanner is intentionally small: it treats SCAD as a depth-aware token
 * stream rather than a real AST. It skips line and block comments and string
 * literals so that braces and `label(` tokens inside them don't perturb the
 * count.
 */
export function scanScadLabels(source: string): ScadLabelScan {
  // Replace all comments and string contents with spaces so positions in
  // `source` stay valid but masked content can't trigger our matchers.
  const masked = maskCommentsAndStrings(source);

  const topLevelStatements: ScadTopLevelStatement[] = [];
  const allLiteralLabelNames: string[] = [];
  let hasAnyLabelCalls = false;
  let hasNestedLabels = false;

  let braceDepth = 0;
  let parenDepth = 0;
  let stmtStart = 0;
  let i = 0;

  // braceDepth at which we entered a `module foo() { ... }` declaration body,
  // or -1 if we're not inside any module body. While inside, we suppress
  // label() collection — those calls are dead until the module is
  // *invoked*, and the invocation is what actually shows up in lazy-union
  // output. Including them would inflate `lostLabels` with names the user
  // never invoked.
  let moduleBodyEntryDepth = -1;

  // Track whether the next top-level statement boundary should produce a
  // recorded statement. Module declarations (`module foo(...) { ... }`),
  // function declarations, `use`/`include` directives, and bare top-level
  // assignments (`name = expr;`) don't produce geometry, so we drop them.
  const flushStatement = (chunk: string) => {
    if (!isGeometryStatement(chunk)) return;
    topLevelStatements.push({ labelName: extractLeadingLabelName(chunk) });
  };

  while (i < masked.length) {
    const c = masked[i];

    // Check for a `label(` token before doing any depth changes — we want
    // the depth at the point of the token, not after stepping past `(`.
    // Suppress inside a module body: those labels are dead until invoked.
    if (c === 'l' && isLabelTokenAt(masked, i) && moduleBodyEntryDepth === -1) {
      hasAnyLabelCalls = true;
      if (braceDepth > 0) hasNestedLabels = true;
      // Collect the literal name if there is one. Reads from `source` —
      // the mask erased string quotes, so masked indices won't survive an
      // intra-call walk. `null` here means runtime-computed
      // (`label(str(...))`) — those aren't surfaced as lost labels.
      const lit = readLiteralLabelArg(source, i);
      if (lit !== null) allLiteralLabelNames.push(lit);
    }

    if (c === '{') {
      // If this `{` opens a top-level `module foo(...) { ... }` body, mark
      // the depth so we can suppress collection until it closes. Function
      // declarations don't have braces (they're `function name(...) = expr;`),
      // so the module check covers it.
      if (moduleBodyEntryDepth === -1 && braceDepth === 0 && parenDepth === 0) {
        const head = masked.slice(stmtStart, i);
        if (/^\s*module\b/.test(head)) {
          moduleBodyEntryDepth = braceDepth;
        }
      }
      braceDepth++;
    } else if (c === '}') {
      braceDepth = Math.max(0, braceDepth - 1);
      // Closing back to the depth at which we entered a module body lifts
      // the suppression. Reset BEFORE the statement-boundary check so the
      // module declaration's chunk is still classified correctly (via
      // isGeometryStatement → DECL_RE).
      if (moduleBodyEntryDepth !== -1 && braceDepth === moduleBodyEntryDepth) {
        moduleBodyEntryDepth = -1;
      }
      // A `}` at top level closes a block statement (module body, anonymous
      // group, etc.). Treat that as a statement boundary too.
      if (braceDepth === 0 && parenDepth === 0) {
        const chunk = source.slice(stmtStart, i + 1);
        flushStatement(chunk);
        stmtStart = i + 1;
      }
    } else if (c === '(') {
      parenDepth++;
    } else if (c === ')') {
      parenDepth = Math.max(0, parenDepth - 1);
    } else if (c === ';' && braceDepth === 0 && parenDepth === 0) {
      const chunk = source.slice(stmtStart, i + 1);
      flushStatement(chunk);
      stmtStart = i + 1;
    }

    i++;
  }

  return {
    topLevelStatements,
    hasAnyLabelCalls,
    hasNestedLabels,
    allLiteralLabelNames,
  };
}

/** Read the literal string argument of a `label(` token at `source[at..]`.
 *  Returns the inner text, or null if the argument isn't a quoted string
 *  literal (e.g. `label(str(...))`). Uses raw `source` throughout because
 *  the comment/string mask erased the quote characters we need to find. */
function readLiteralLabelArg(source: string, at: number): string | null {
  let j = at + 5;
  while (j < source.length && /[ \t\r\n]/.test(source[j])) j++;
  if (source[j] !== '(') return null;
  j++;
  while (j < source.length && /[ \t\r\n]/.test(source[j])) j++;
  if (source[j] !== '"') return null;
  const start = j + 1;
  let k = start;
  while (k < source.length && source[k] !== '"') {
    if (source[k] === '\\') k++;
    k++;
  }
  if (k >= source.length) return null;
  const name = source.slice(start, k);
  return name.length > 0 ? name : null;
}

/** Replace contents of `// ...`, `/* ... *\/`, and `"..."` with spaces so the
 *  outer scanner sees neutral content at those positions. Newlines inside
 *  block comments are preserved (helps any downstream column math stay sane).
 */
function maskCommentsAndStrings(source: string): string {
  const out = source.split('');
  const len = source.length;
  let i = 0;
  while (i < len) {
    const c = source[i];
    const next = source[i + 1];
    if (c === '/' && next === '/') {
      // Line comment up to (but not including) the newline.
      out[i] = ' ';
      out[i + 1] = ' ';
      i += 2;
      while (i < len && source[i] !== '\n') {
        out[i] = ' ';
        i++;
      }
    } else if (c === '/' && next === '*') {
      out[i] = ' ';
      out[i + 1] = ' ';
      i += 2;
      while (i < len && !(source[i] === '*' && source[i + 1] === '/')) {
        if (source[i] !== '\n') out[i] = ' ';
        i++;
      }
      if (i < len) { out[i] = ' '; out[i + 1] = ' '; i += 2; }
    } else if (c === '"') {
      out[i] = ' ';
      i++;
      while (i < len && source[i] !== '"') {
        // Honor backslash-escapes inside strings — a `\"` doesn't end the
        // string. Otherwise `echo("a\"b"); label("real") cube();` would
        // exit string mode at the escaped quote, re-enter at the next
        // real one, and end up masking over the real `label("real")` call.
        if (source[i] === '\\' && i + 1 < len) {
          out[i] = ' ';
          if (source[i + 1] !== '\n') out[i + 1] = ' ';
          i += 2;
          continue;
        }
        if (source[i] !== '\n') out[i] = ' ';
        i++;
      }
      if (i < len) { out[i] = ' '; i++; }
    } else {
      i++;
    }
  }
  return out.join('');
}

/** True iff `masked[at..]` is the start of a `label` identifier token followed
 *  by an opening paren (possibly with whitespace in between).
 *  Must NOT match `relabel(` / `slabel(` / similar — checks the preceding
 *  character is not part of an identifier.
 */
function isLabelTokenAt(masked: string, at: number): boolean {
  if (masked.slice(at, at + 5) !== 'label') return false;
  const before = at > 0 ? masked[at - 1] : '';
  if (/[A-Za-z0-9_$]/.test(before)) return false;
  let j = at + 5;
  while (j < masked.length && /[ \t\r\n]/.test(masked[j])) j++;
  return masked[j] === '(';
}

const DECL_RE = /^\s*(module|function|use|include)\b/;

/** Leading keywords that mean this chunk is a *continuation* of the previous
 *  top-level statement, not a new one. `else` is the canonical case:
 *  `if (cond) cube(); else sphere();` splits at the first `;`, leaving
 *  `else sphere();` as a free-floating chunk that would otherwise be counted
 *  as its own geometry statement. lazy-union still emits only one object
 *  (the taken branch), so counting both halves makes the count mismatch
 *  and silently kills labels via the auto-name fallback. */
const CONTINUATION_RE = /^\s*else\b/;

/** A "statement" we want to count is one that produces geometry. Skip:
 *   - `module name(...) { ... }` and `function name(...) = ...;` declarations
 *   - `use <...>;` / `include <...>;` directives
 *   - Top-level assignments `name = expr;` (no `(` before the `=`)
 *   - `else <expr>;` continuations of a preceding `if (...) <expr>;`
 *   - Pure whitespace/comment-only chunks
 */
function isGeometryStatement(chunk: string): boolean {
  const m = maskCommentsAndStrings(chunk).trim();
  if (m.length === 0) return false;
  if (DECL_RE.test(m)) return false;
  if (CONTINUATION_RE.test(m)) return false;
  // Top-level assignment classifier: a single `=` appears before any `(`.
  // Geometry statements always have `(` before any `=` (e.g. `cube(size=10);`).
  // Variable assignments have `=` before any `(` (e.g. `x = 10;` or
  // `vec = [1,2,3];`). Guard against `==`, `!=`, `<=`, `>=`, which are
  // comparisons inside expressions, not assignments.
  const firstParen = m.indexOf('(');
  for (let i = 0; i < m.length; i++) {
    if (firstParen >= 0 && i >= firstParen) break;
    if (m[i] !== '=') continue;
    const prev = i > 0 ? m[i - 1] : '';
    const next = i + 1 < m.length ? m[i + 1] : '';
    if (next === '=' || prev === '=' || prev === '!' || prev === '<' || prev === '>') continue;
    return false;
  }
  return true;
}

/** If the statement's transformation chain begins with `label("name")`,
 *  return `name`; otherwise null.
 *
 *  We accept the label anywhere in the leading run of `name(args)` /
 *  `name(args) name(args) ...` before the final primitive call or block.
 *  Examples that count as labeled "x":
 *    label("x") cube(10);
 *    translate([5,0,0]) label("x") sphere(5);
 *    color([1,0,0]) label("x") translate([0,1,0]) cube(2);
 */
function extractLeadingLabelName(chunk: string): string | null {
  // Mask comments/strings *except* preserve the label argument string itself.
  // Simplest approach: scan the raw chunk for `label\s*\(\s*"..."` and verify
  // it sits at brace-depth 0 of the chunk (i.e. before any `{`).
  const masked = maskCommentsAndStrings(chunk);
  const firstBrace = masked.indexOf('{');
  const ceiling = firstBrace >= 0 ? firstBrace : chunk.length;

  // We need to read the literal string content, which the masker erased.
  // Walk the chunk's original text with a small state machine to find the
  // first `label(` token before `ceiling` and capture its string argument.
  let i = 0;
  while (i < ceiling) {
    if (masked[i] === 'l' && isLabelTokenAt(masked, i)) {
      // Skip past `label` and whitespace to the opening paren.
      let j = i + 5;
      while (j < ceiling && /[ \t\r\n]/.test(chunk[j])) j++;
      if (chunk[j] !== '(') { i++; continue; }
      j++; // past `(`
      while (j < ceiling && /[ \t\r\n]/.test(chunk[j])) j++;
      if (chunk[j] !== '"') return null; // non-literal label arg — unsupported
      const strStart = j + 1;
      let k = strStart;
      while (k < chunk.length && chunk[k] !== '"') {
        if (chunk[k] === '\\') k++; // skip escape
        k++;
      }
      if (k >= chunk.length) return null;
      const name = chunk.slice(strStart, k);
      return name.length > 0 ? name : null;
    }
    i++;
  }
  return null;
}
