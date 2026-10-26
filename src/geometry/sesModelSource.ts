// Pure source-level helpers for evaluating model code in an SES Compartment
// (#1127). No `ses` import and no Worker state — the unit tier tests these
// directly; sesSandbox.ts wires them to the real lockdown/Compartment.
//
//   - SES_LOCKDOWN_OPTIONS: the lockdown preset, and why each option is set.
//   - wrapModelSource(): the per-run evaluation wrapper. It binds every
//     compartment global as a local const (the "prelude") — without it every
//     free-variable read in a hot model-code closure goes through SES's `with`
//     scope chain, ~1.85× slower — and it keeps the user's line N on line N.
//   - neutralizeSesRejections(): SES refuses source containing `import(`,
//     `eval(`, `<!--` or `-->` ANYWHERE, comments and strings included. This
//     rewrites those sequences inside comments and string/template literals
//     (meaning-preserving) so only real code occurrences are still refused.
//   - explainSesRejection(): turns SES's "rejected at <unknown>:N" into a
//     message naming the user's line, with a hint.
//   - analyzeFreeGlobals()/rewriteFreeTypeof(): SES reads an undeclared name
//     as `undefined` instead of throwing ReferenceError (a typo like
//     `Manfold.cube()` would surface as "Cannot read properties of
//     undefined", and `siz || 10` would silently change meaning). These find
//     the names nothing declares so the compiler can make reading one throw
//     `ReferenceError: <name> is not defined`, exactly when the read runs.

import { javascriptLanguage } from '@codemirror/lang-javascript';

/** Options passed to SES `lockdown()` in the engine Worker. Only the first
 *  two are load-bearing; the rest keep the engine realm's own behaviour
 *  (errors, stacks, console, locale) exactly as before SES. */
export const SES_LOCKDOWN_OPTIONS: Readonly<Record<string, string>> = Object.freeze({
  // Keep the START compartment's eval/Function native. sdfCompile.ts compiles
  // SDF trees with `new Function` and Emscripten/embind generate code; under
  // the default 'safe-eval' that code runs through SES's `with`-scope
  // evaluator and SDF figures take 4.3× as long. Compartments never get these
  // evaluators — their Function/eval are SES's confined ones.
  evalTaming: 'unsafe-eval',
  // 'min', NOT the default 'moderate': moderate/severe turn data properties on
  // shared prototypes (%TypedArray%.prototype.*, Array.prototype.push, …) into
  // accessors to avoid the override mistake, which knocks V8 off its fast
  // paths — BOSL2 SCAD runs took 1.8–2.1× longer. The few glue assignments
  // that trip the override mistake under 'min' are rewritten at build time
  // (sesGlueFix.ts).
  overrideTaming: 'min',
  // Engine-realm errors keep their V8 stacks and messages.
  errorTaming: 'unsafe',
  stackFiltering: 'verbose',
  // The Worker's console stays the platform console (DevTools, errorLog relay).
  consoleTaming: 'unsafe',
  // The Worker installs its own unhandledrejection relay (engineWorker.ts).
  errorTrapping: 'none',
  unhandledRejectionTrapping: 'none',
  // Keep toLocaleString / localeCompare behaviour.
  localeTaming: 'unsafe',
});

const IDENT = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
// Names the prelude must not rebind: `eval` (SES's direct-eval handling),
// literals the SES scope optimizer already binds as constants, and
// `globalThis` (the destructuring source — binding it would hit the TDZ).
const PRELUDE_SKIP: ReadonlySet<string> = new Set(['eval', 'undefined', 'NaN', 'Infinity', 'globalThis']);

/** The compartment global names the prelude binds, sorted. */
export function preludeNames(globalNames: readonly string[]): string[] {
  return [...new Set(globalNames.filter((n) => IDENT.test(n) && !PRELUDE_SKIP.has(n)))].sort();
}

/** The source evaluated in a compartment for one run. Evaluates to
 *  `function (api)`. The wrapper head shares the user's first line, so user
 *  line N is line N of the evaluated source (no offset to correct). */
export function wrapModelSource(jsCode: string, names: readonly string[]): string {
  const bind = names.length > 0 ? `const {${names.join(',')}} = globalThis; ` : '';
  return `(function (api) { "use strict"; ${bind}return (function (api) { "use strict";${jsCode}\n})(api); })`;
}

// SES's own detection patterns (ses/src/transforms.js), so we neutralize
// exactly what it would reject.
const IMPORT_RE = /(^|[^.]|\.\.\.)\bimport(\s*(?:\(|\/[/*]))/g;
const EVAL_RE = /(^|[^.])\beval(\s*\()/g;
// SES also rejects the two HTML-like comment markers (`<` `!--` and `--` `>`).
// They're matched with plain string scans, not a regexp: this is a
// JavaScript-source check, and a regexp spelled like an HTML-comment filter
// reads (to people and to static analysers) as a broken HTML sanitizer.
const HTML_OPEN = '<' + '!--';
const HTML_CLOSE = '--' + '>';
const WORD_RE = /\b(?:import|eval)\b/;

function hasHtmlMarker(text: string): boolean {
  return text.includes(HTML_OPEN) || text.includes(HTML_CLOSE);
}

/** Replace each HTML-comment marker, scanning left to right (an opener wins
 *  over a closer starting at the same position, as SES's alternation does). */
function replaceHtmlMarkers(text: string, open: string, close: string): string {
  if (!hasHtmlMarker(text)) return text;
  let out = '';
  for (let i = 0; i < text.length;) {
    if (text.startsWith(HTML_OPEN, i)) { out += open; i += HTML_OPEN.length; }
    else if (text.startsWith(HTML_CLOSE, i)) { out += close; i += HTML_CLOSE.length; }
    else { out += text[i]; i++; }
  }
  return out;
}

function rewriteComment(text: string): string {
  // Comments don't affect meaning: mangle in place, keeping the length so
  // columns on the line don't move.
  const mangled = text
    .replace(IMPORT_RE, (_m, pre: string, post: string) => `${pre}imp0rt${post}`)
    .replace(EVAL_RE, (_m, pre: string, post: string) => `${pre}ev4l${post}`);
  return replaceHtmlMarkers(mangled, '<!-_', '-_>');
}

function rewriteLiteralText(text: string): string {
  // Inside a string or template literal, replace the triggering character by
  // the equivalent hex escape: the literal's value is unchanged, but the
  // source text no longer matches. (`\x28` outside a literal is a syntax
  // error, so a misparse can't turn this into working code.)
  const escaped = text
    .replace(IMPORT_RE, (_m, pre: string, post: string) => `${pre}import${post.endsWith('(') ? `${post.slice(0, -1)}\\x28` : `${post.slice(0, -2)}\\x2f${post.slice(-1)}`}`)
    .replace(EVAL_RE, (_m, pre: string, post: string) => `${pre}eval${post.slice(0, -1)}\\x28`);
  return replaceHtmlMarkers(escaped, '<\\x21--', '--\\x3e');
}

interface Edit { from: number; to: number; text: string }

/**
 * Rewrite the text SES rejects (`import(`, `eval(`, `<!--`, `-->`) where it
 * can't be code: inside comments and string/template literal text. A `-->`
 * in the middle of a code line (`i --> 0`, a decrement then a comparison) is
 * spaced to `-- >`, which parses the same. Everything else — a real
 * `import(...)`/`eval(...)` call, `<!--` in code, a `-->` at the start of a
 * line (an HTML close comment in script code), regular-expression literals —
 * is left for SES to reject. Returns the input unchanged when nothing matches.
 */
export function neutralizeSesRejections(jsCode: string): string {
  if (!hasHtmlMarker(jsCode) && !WORD_RE.test(jsCode)) return jsCode;
  const edits: Edit[] = [];
  const opaque: Array<[number, number]> = []; // comment / literal / regexp ranges
  const blockComments: Array<[number, number]> = [];
  const tree = javascriptLanguage.parser.parse(jsCode);
  tree.cursor().iterate((node) => {
    const name = node.name;
    if (name === 'LineComment' || name === 'BlockComment') {
      opaque.push([node.from, node.to]);
      if (name === 'BlockComment') blockComments.push([node.from, node.to]);
      const text = jsCode.slice(node.from, node.to);
      const out = rewriteComment(text);
      if (out !== text) edits.push({ from: node.from, to: node.to, text: out });
      return false;
    }
    if (name === 'String') {
      opaque.push([node.from, node.to]);
      const text = jsCode.slice(node.from, node.to);
      const out = rewriteLiteralText(text);
      if (out !== text) edits.push({ from: node.from, to: node.to, text: out });
      return false;
    }
    if (name === 'RegExp') {
      opaque.push([node.from, node.to]);
      return false;
    }
    if (name === 'TemplateString') {
      // Only the literal text — `${…}` interpolations are code (their own
      // strings/comments are handled when the walk descends into them).
      // A TAGGED template's tag sees the raw text (`String.raw`), so an escape
      // would change its value: leave it for SES to reject.
      const tagged = node.node.parent?.name === 'TaggedTemplateExpression';
      let pos = node.from;
      const holes: Array<[number, number]> = [];
      const c = node.node.cursor();
      if (c.firstChild()) {
        do { if (c.name === 'Interpolation') holes.push([c.from, c.to]); } while (c.nextSibling());
      }
      for (const [hFrom, hTo] of [...holes, [node.to, node.to] as [number, number]]) {
        if (hFrom > pos) {
          opaque.push([pos, hFrom]);
          const text = jsCode.slice(pos, hFrom);
          const out = tagged ? text : rewriteLiteralText(text);
          if (out !== text) edits.push({ from: pos, to: hFrom, text: out });
        }
        pos = hTo;
      }
      return true; // descend into interpolations
    }
    return true;
  });
  // Mid-line `-->` in code.
  opaque.sort((a, b) => a[0] - b[0]);
  const inOpaque = (i: number): boolean => {
    let lo = 0;
    let hi = opaque.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (opaque[mid][1] <= i) lo = mid + 1;
      else if (opaque[mid][0] > i) hi = mid - 1;
      else return true;
    }
    return false;
  };
  for (let i = jsCode.indexOf(HTML_CLOSE); i !== -1; i = jsCode.indexOf(HTML_CLOSE, i + HTML_CLOSE.length)) {
    if (inOpaque(i)) continue;
    // An HTML close comment (script code, Annex B) is a `-->` with only
    // whitespace and block comments before it on its line — leave it for SES.
    const lineStart = jsCode.lastIndexOf('\n', i - 1) + 1;
    let onlyBlanks = true;
    for (let j = lineStart; j < i && onlyBlanks; j++) {
      if (/\s/.test(jsCode[j])) continue;
      const bc = blockComments.find(([f, t]) => j >= f && j < t);
      if (bc) j = bc[1] - 1;
      else onlyBlanks = false;
    }
    if (onlyBlanks) continue;
    edits.push({ from: i, to: i + 3, text: '-- >' });
  }
  if (edits.length === 0) return jsCode;
  edits.sort((a, b) => a.from - b.from);
  let out = '';
  let pos = 0;
  for (const e of edits) {
    if (e.from < pos) continue; // overlapping (shouldn't happen) — keep the first
    out += jsCode.slice(pos, e.from) + e.text;
    pos = e.to;
  }
  return out + jsCode.slice(pos);
}

const REJECTION_RE = /^Possible (import expression|direct eval expression|HTML comment) rejected at [^:]*:(\d+)\. \((SES_[A-Z_]+_REJECTED)\)/;

const REJECTION_HINTS: Readonly<Record<string, string>> = Object.freeze({
  SES_IMPORT_REJECTED: 'dynamic `import()` is not available in model code. Pass data in through `api.imports` or `api.params` instead.',
  SES_EVAL_REJECTED: '`eval(…)` is not available in model code. Build the geometry with plain functions instead.',
  SES_HTML_COMMENT_REJECTED: '`<!--` (anywhere in code) and `-->` at the start of a line are HTML-style comments in browser JavaScript; the sandbox refuses them. Use `//` comments, or add a space (`- ->`).',
});

/** Map an SES source-rejection message to `{ message, line }` naming the
 *  user's line (the wrapper keeps user line N on line N), or null when
 *  `message` isn't one. */
export function explainSesRejection(message: string): { message: string; line: number } | null {
  const m = REJECTION_RE.exec(message);
  if (!m) return null;
  const line = Math.max(1, Number(m[2]));
  return {
    message: `Possible ${m[1]} rejected on line ${line} (${m[3]}).\nHint: ${REJECTION_HINTS[m[3]] ?? 'the sandbox refuses this source text.'}`,
    line,
  };
}

/** Result of {@link analyzeFreeGlobals}. */
export interface FreeGlobals {
  /** Names the code reads as globals that nothing declares: not declared
   *  anywhere in the source (in any scope), not a compartment global or
   *  endowment (`known`), and never touched as `globalThis.<name>` /
   *  `globalThis['<name>']` (the code may create those itself). */
  names: string[];
  /** 1-based line of each name's first reference. */
  firstLine: Map<string, number>;
  /** Source ranges of the `typeof <name>` operands among those names. */
  typeofOperands: Array<{ from: number; to: number }>;
}

/**
 * Find the free global identifiers of model code, so the SES compiler can make
 * reading one throw `ReferenceError: <name> is not defined` like strict
 * JavaScript (SES's scope terminator otherwise reads it as `undefined`).
 *
 * Deliberately conservative: a name is reported only when it is certainly not
 * bound in the source. ANY declaration of the name anywhere — var / let /
 * const / function / class / parameter / catch binding / destructuring,
 * shorthand `{ a }` patterns included — in any scope excludes it. The caller
 * doesn't throw at compile time: it installs a throwing accessor for each name
 * on that run's compartment global, which a local binding always shadows, so
 * the error fires exactly when, and only if, the read executes (dead code, a
 * `typeof x` guard or an uncalled helper never trip it). Property names, object
 * keys, labels and member accesses aren't identifier references and are
 * ignored; a shorthand `{ a }` in an object literal is a read of `a`.
 */
export function analyzeFreeGlobals(jsCode: string, known: ReadonlySet<string>): FreeGlobals {
  const declared = new Set<string>();
  const viaGlobalThis = new Set<string>();
  const refs: Array<{ name: string; from: number; to: number; typeofOperand: boolean }> = [];
  javascriptLanguage.parser.parse(jsCode).cursor().iterate((node) => {
    const n = node.name;
    if (n === 'VariableDefinition' || (n === 'PropertyName' && node.node.parent?.name === 'PatternProperty')) {
      declared.add(jsCode.slice(node.from, node.to));
      return;
    }
    if (n === 'MemberExpression') {
      // globalThis.x / globalThis?.x / globalThis['x'] — the code may define x itself.
      const obj = node.node.firstChild;
      if (obj?.name === 'VariableName' && jsCode.slice(obj.from, obj.to) === 'globalThis') {
        for (let c = obj.nextSibling; c; c = c.nextSibling) {
          if (c.name === 'PropertyName') { viaGlobalThis.add(jsCode.slice(c.from, c.to)); break; }
          if (c.name === 'String') { viaGlobalThis.add(jsCode.slice(c.from + 1, c.to - 1)); break; }
        }
      }
      return;
    }
    let isRef = n === 'VariableName';
    if (!isRef && n === 'PropertyDefinition') {
      // `{ a }` in an object literal: a Property holding only the name.
      const p = node.node.parent;
      isRef = p?.name === 'Property' && p.firstChild?.from === node.from && p.lastChild?.to === node.to;
    }
    if (!isRef) return;
    // `typeof x` / `typeof (x)` / `typeof ((x))` — the operand is the bare name.
    let operand = node.node;
    let parent = operand.parent;
    while (parent?.name === 'ParenthesizedExpression' && parent.firstChild?.nextSibling?.from === operand.from && parent.firstChild?.nextSibling?.to === operand.to) {
      operand = parent;
      parent = operand.parent;
    }
    const typeofOperand = parent?.name === 'UnaryExpression' && parent.firstChild?.name === 'typeof' && parent.lastChild?.from === operand.from;
    refs.push({ name: jsCode.slice(node.from, node.to), from: node.from, to: node.to, typeofOperand });
  });
  const names: string[] = [];
  const firstLine = new Map<string, number>();
  const typeofOperands: Array<{ from: number; to: number }> = [];
  for (const r of refs) {
    if (declared.has(r.name) || known.has(r.name) || viaGlobalThis.has(r.name)) continue;
    if (r.typeofOperand) typeofOperands.push({ from: r.from, to: r.to });
    if (!firstLine.has(r.name)) {
      names.push(r.name);
      let line = 1;
      for (let i = jsCode.indexOf('\n'); i !== -1 && i < r.from; i = jsCode.indexOf('\n', i + 1)) line++;
      firstLine.set(r.name, line);
    }
  }
  return { names, firstLine, typeofOperands };
}

/** Replace each `typeof <free name>` operand with `replacement(name)`, so the
 *  operator never reaches the name's throwing accessor (in strict JS,
 *  `typeof undeclared` never throws). Line count unchanged. */
export function rewriteFreeTypeof(jsCode: string, operands: ReadonlyArray<{ from: number; to: number }>, replacement: (name: string) => string): string {
  if (operands.length === 0) return jsCode;
  let out = '';
  let pos = 0;
  for (const o of [...operands].sort((a, b) => a.from - b.from)) {
    out += jsCode.slice(pos, o.from) + replacement(jsCode.slice(o.from, o.to));
    pos = o.to;
  }
  return out + jsCode.slice(pos);
}
