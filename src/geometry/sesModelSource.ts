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
//   - undeclaredNames()/undeclaredHint(): SES reads an undeclared name as
//     `undefined` instead of throwing ReferenceError, so a typo like
//     `Manfold.cube()` surfaces as "Cannot read properties of undefined". The
//     hint names the identifiers the code uses but never declares.

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
const HTML_RE = /<!--|-->/g;
const ANY_RE = /<!--|-->|\bimport\b|\beval\b/;

function rewriteComment(text: string): string {
  // Comments don't affect meaning: mangle in place, keeping the length so
  // columns on the line don't move.
  return text
    .replace(IMPORT_RE, (_m, pre: string, post: string) => `${pre}imp0rt${post}`)
    .replace(EVAL_RE, (_m, pre: string, post: string) => `${pre}ev4l${post}`)
    .replace(HTML_RE, (m) => (m === '<!--' ? '<!-_' : '-_>'));
}

function rewriteLiteralText(text: string): string {
  // Inside a string or template literal, replace the triggering character by
  // the equivalent hex escape: the literal's value is unchanged, but the
  // source text no longer matches. (`\x28` outside a literal is a syntax
  // error, so a misparse can't turn this into working code.)
  return text
    .replace(IMPORT_RE, (_m, pre: string, post: string) => `${pre}import${post.endsWith('(') ? `${post.slice(0, -1)}\\x28` : `${post.slice(0, -2)}\\x2f${post.slice(-1)}`}`)
    .replace(EVAL_RE, (_m, pre: string, post: string) => `${pre}eval${post.slice(0, -1)}\\x28`)
    .replace(HTML_RE, (m) => (m === '<!--' ? '<\\x21--' : '--\\x3e'));
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
  if (!ANY_RE.test(jsCode)) return jsCode;
  const edits: Edit[] = [];
  const opaque: Array<[number, number]> = []; // comment / literal / regexp ranges
  const tree = javascriptLanguage.parser.parse(jsCode);
  tree.cursor().iterate((node) => {
    const name = node.name;
    if (name === 'LineComment' || name === 'BlockComment') {
      opaque.push([node.from, node.to]);
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
          const out = rewriteLiteralText(text);
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
  for (let i = jsCode.indexOf('-->'); i !== -1; i = jsCode.indexOf('-->', i + 3)) {
    if (inOpaque(i)) continue;
    const lineStart = jsCode.lastIndexOf('\n', i - 1) + 1;
    if (jsCode.slice(lineStart, i).trim() === '') continue; // HTML close comment — leave for SES
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

/** Identifiers `jsCode` reads that it never declares and that aren't in
 *  `known` (the compartment's globals + `api`). Scope-insensitive — good
 *  enough for a hint. At most `limit` names, in first-use order. */
export function undeclaredNames(jsCode: string, known: ReadonlySet<string>, limit = 5): string[] {
  const declared = new Set<string>();
  const used: string[] = [];
  javascriptLanguage.parser.parse(jsCode).cursor().iterate((node) => {
    const n = node.name;
    // Shorthand destructuring (`const { Manifold } = api`) parses as a
    // PatternProperty > PropertyName with no VariableDefinition.
    if (n === 'VariableDefinition' || (n === 'PropertyName' && node.node.parent?.name === 'PatternProperty')) {
      declared.add(jsCode.slice(node.from, node.to));
    } else if (n === 'VariableName') {
      used.push(jsCode.slice(node.from, node.to));
    }
  });
  const out: string[] = [];
  for (const u of used) {
    if (declared.has(u) || known.has(u) || out.includes(u)) continue;
    out.push(u);
    if (out.length >= limit) break;
  }
  return out;
}

/** The hint appended to a runtime TypeError when the code reads undeclared
 *  names, or '' when there are none. */
export function undeclaredHint(names: readonly string[]): string {
  if (names.length === 0) return '';
  const list = names.map((n) => `\`${n}\``).join(', ');
  return `\nHint: ${list} ${names.length === 1 ? 'is' : 'are'} not defined — the model-code sandbox reads undeclared names as undefined. Check the spelling, or destructure it from \`api\` (e.g. \`const { Manifold } = api;\`). Browser globals such as \`self\`, \`navigator\`, \`setTimeout\` and \`fetch\` don't exist in model code.`;
}
