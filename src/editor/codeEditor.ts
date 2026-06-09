import { EditorView, keymap } from '@codemirror/view';
import { EditorState, Compartment, Prec, Transaction, type Extension } from '@codemirror/state';
import { openSearchPanel } from '@codemirror/search';
import { acceptCompletion } from '@codemirror/autocomplete';
import { javascript } from '@codemirror/lang-javascript';
import { StreamLanguage } from '@codemirror/language';
import { oneDark } from '@codemirror/theme-one-dark';
import { basicSetup } from 'codemirror';
import { lintGutter, setDiagnostics, type Diagnostic } from '@codemirror/lint';
import { js as jsBeautify } from 'js-beautify';
import { manifoldApiCompletion } from './apiCompletions';
import type { SourceDiagnostic } from '../geometry/types';
import { getTheme, onThemeChange, type Theme } from '../ui/theme';
import { readPerTabPref, writePerTabPref } from '../storage/perTabPref';
import { getConfig } from '../config/appConfig';

/** Tracks which companion editor views are currently in a programmatic content
 *  load so the onChange listener can skip the spurious re-run. */
const _programmaticLoad = new WeakMap<EditorView, { active: boolean }>();

/** Replicad/BREP sessions reuse the JavaScript editor since they're written
 *  as JS (`api.BREP.box(...)`), but we still track them as a distinct
 *  language so callers (formatting, syntax highlighting, status badges) can
 *  branch per engine. */
export type EditorLanguage = 'manifold-js' | 'scad' | 'replicad' | 'voxel';

let editorView: EditorView | null = null;
let debounceTimer: number | null = null;
let idleTimer: number | null = null;
let activeDiagnostics: Diagnostic[] = [];

/** Teardown for the bottom-scroll stabilizer's listeners; replaced on re-install
 *  so a re-init never stacks duplicate document-level listeners. */
let disposeScrollStabilizer: (() => void) | null = null;
/** Timestamp (performance.now) of the last *deliberate* programmatic editor
 *  scroll — find-next, reveal-diagnostic. Lets the bottom-scroll stabilizer tell
 *  an intended navigation from an unsolicited re-measure snap. */
let scrollIntentAt = -Infinity;

/** Mark that the editor is about to scroll itself on purpose (find / reveal /
 *  caret nav), so the bottom-scroll stabilizer honors the resulting scroll
 *  instead of reverting it as a measure snap. Call immediately before dispatching
 *  the `EditorView.scrollIntoView` effect. */
function markEditorScrollIntent(): void {
  scrollIntentAt = performance.now();
}

let currentLanguage: EditorLanguage = 'manifold-js';
// Per-tab (with a shared seed for fresh tabs) so toggling auto-format in one
// window doesn't flip it in another open window.
let autoFormatEnabled: boolean = readPerTabPref('editor-auto-format') !== 'false';
const languageCompartment = new Compartment();
const readOnlyCompartment = new Compartment();
const themeCompartment = new Compartment();

function themeExt(theme: Theme): Extension {
  return theme === 'dark' ? oneDark : [];
}

/** Tab accepts the active autocomplete option. `acceptCompletion` returns false
 *  when no completion tooltip is open, so Tab falls through to its normal
 *  indent/insert behavior otherwise. Prec.highest so it wins over the default
 *  keymaps that basicSetup installs for Tab. */
const acceptCompletionWithTab: Extension = Prec.highest(
  keymap.of([{ key: 'Tab', run: acceptCompletion }]),
);

// Minimal OpenSCAD StreamLanguage — keyword/builtin/comment/string/number coloring.
const SCAD_KEYWORDS = new Set([
  'module','function','if','else','for','let','use','include','true','false','undef','each','return',
]);
const SCAD_BUILTINS = new Set([
  'cube','sphere','cylinder','polyhedron','polygon','square','circle','text',
  'translate','rotate','scale','mirror','multmatrix','color','offset','hull','minkowski','resize',
  'union','difference','intersection','linear_extrude','rotate_extrude','projection','surface',
  'import','children','render','echo','assert','assign','search','str','len','concat','abs','sign',
  'sin','cos','tan','asin','acos','atan','atan2','sqrt','pow','exp','log','ln','floor','ceil','round',
  'min','max','norm','cross','rands','lookup','version','version_num',
]);

const scadLanguage = StreamLanguage.define({
  startState: () => ({ inBlockComment: false }),
  token(stream, state: { inBlockComment: boolean }) {
    if (state.inBlockComment) {
      if (stream.match(/.*?\*\//)) { state.inBlockComment = false; return 'comment'; }
      stream.skipToEnd();
      return 'comment';
    }
    if (stream.eatSpace()) return null;
    if (stream.match('//')) { stream.skipToEnd(); return 'comment'; }
    if (stream.match('/*')) { state.inBlockComment = true; return 'comment'; }
    if (stream.match(/^"(?:[^"\\]|\\.)*"/)) return 'string';
    if (stream.match(/^\$[a-zA-Z_]+/)) return 'variableName.special';
    if (stream.match(/^-?\d+(?:\.\d*)?(?:[eE][+-]?\d+)?/)) return 'number';
    const wordMatch = stream.match(/^[a-zA-Z_][a-zA-Z0-9_]*/);
    if (wordMatch) {
      const word = Array.isArray(wordMatch) ? wordMatch[0] : (stream as unknown as { current: () => string }).current();
      if (SCAD_KEYWORDS.has(word)) return 'keyword';
      if (SCAD_BUILTINS.has(word)) return 'builtin';
      return 'variableName';
    }
    stream.next();
    return null;
  },
  languageData: {
    commentTokens: { line: '//', block: { open: '/*', close: '*/' } },
  },
});

/** CodeMirror syntax-highlighting extension for an editor language. Exported
 *  so read-only viewers (e.g. the diff view) can highlight the right language
 *  without duplicating the SCAD StreamLanguage definition. */
export function languageExt(lang: EditorLanguage): Extension {
  return lang === 'scad' ? scadLanguage : javascript();
}

/** Create a standalone CodeMirror editor for companion SCAD files.
 *  Uses the SCAD language extension for syntax highlighting. The caller
 *  owns the returned EditorView and should call setCompanionEditorContent()
 *  when switching between companion files. */
export function createCompanionEditor(
  parent: HTMLElement,
  onChange: (content: string) => void,
): EditorView {
  const companionThemeCompartment = new Compartment();
  const loadFlag = { active: false };
  const view = new EditorView({
    state: EditorState.create({
      doc: '',
      extensions: [
        basicSetup,
        scadLanguage,
        companionThemeCompartment.of(themeExt(getTheme())),
        EditorView.updateListener.of((update) => {
          if (update.docChanged && !loadFlag.active) onChange(update.state.doc.toString());
        }),
        EditorView.theme({
          '&': { height: '100%', fontSize: '13px' },
          '.cm-scroller': { overflow: 'auto' },
          '.cm-content': { fontFamily: 'monospace' },
        }),
      ],
    }),
    parent,
  });
  _programmaticLoad.set(view, loadFlag);
  onThemeChange((theme) => {
    view.dispatch({ effects: companionThemeCompartment.reconfigure(themeExt(theme)) });
  });
  return view;
}

/** Replace the full document in a companion editor view (programmatic load
 *  when switching between companion tabs or after version navigation).
 *  Sets a flag to suppress the onChange listener so we don't trigger a
 *  spurious recompile, and marks the transaction non-historical so that
 *  Ctrl+Z inside a companion file doesn't walk back through tab-switch loads. */
export function setCompanionEditorContent(view: EditorView, content: string): void {
  const flag = _programmaticLoad.get(view);
  if (flag) flag.active = true;
  try {
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: content },
      annotations: [Transaction.addToHistory.of(false)],
    });
  } finally {
    if (flag) flag.active = false;
  }
}

function clampOffset(offset: number, docLength: number): number {
  if (!Number.isFinite(offset)) return 0;
  return Math.max(0, Math.min(docLength, Math.trunc(offset)));
}

function offsetFromLineColumn(doc: string, line?: number, column?: number): number {
  if (!line) return 0;
  const targetLine = Math.max(1, Math.trunc(line));
  let currentLine = 1;
  let lineStart = 0;

  for (let i = 0; i < doc.length && currentLine < targetLine; i++) {
    if (doc.charCodeAt(i) === 10) {
      currentLine++;
      lineStart = i + 1;
    }
  }

  if (currentLine !== targetLine) return doc.length;
  const lineEnd = doc.indexOf('\n', lineStart);
  const end = lineEnd === -1 ? doc.length : lineEnd;
  const colOffset = Math.max(0, Math.trunc(column ?? 1) - 1);
  return Math.min(lineStart + colOffset, end);
}

function toEditorDiagnostic(input: SourceDiagnostic, doc: string): Diagnostic {
  const from = input.from !== undefined
    ? clampOffset(input.from, doc.length)
    : offsetFromLineColumn(doc, input.line, input.column);
  const to = input.to !== undefined
    ? clampOffset(input.to, doc.length)
    : input.endLine !== undefined
      ? offsetFromLineColumn(doc, input.endLine, input.endColumn)
      : Math.min(doc.length, from + 1);
  const message = input.hint ? `${input.message}\nHint: ${input.hint}` : input.message;

  return {
    from,
    to: Math.max(from, to),
    severity: input.severity,
    source: input.source,
    message,
  };
}

function hasEditorLocation(input: SourceDiagnostic): boolean {
  return input.from !== undefined || input.line !== undefined;
}

/** Optional lifecycle hooks for decoupling error surfacing from the live
 *  preview run. `onChange` (debounced) still drives the preview; these let the
 *  caller hide errors instantly while typing and re-surface them once typing
 *  settles or focus leaves. */
export interface EditorHooks {
  /** Fires synchronously on every edit — hide transient error UI here. */
  onEdit?: () => void;
  /** Fires after typing has been idle for ~0.8s. */
  onIdle?: (code: string) => void;
  /** Fires when the editor loses focus. */
  onBlur?: () => void;
}

/** Keep the code editor's scroll position from drifting when CodeMirror
 *  re-measures while the editor is parked at (or near) the very bottom.
 *
 *  On a real display, CodeMirror's line-height model never perfectly matches
 *  Chrome's fractional, device-pixel-rounded line boxes, so over a long
 *  document the modelled content height drifts from the real DOM height by
 *  ~a line. Whenever something makes CodeMirror re-measure — a focus change, a
 *  layout reflow from opening a tool menu/panel, or its own measure loop — it
 *  reconciles the two and the browser re-clamps `scrollTop` at max-scroll,
 *  snapping the visible code by a line. It only shows at the bottom (anywhere
 *  else the offset is preserved exactly) and only on a real display, so it reads
 *  as a one-line "stutter" when you click around with the editor scrolled down.
 *
 *  This installs a persistent stabilizer: when a *programmatic* scroll nudges
 *  the editor by less than a couple of lines while it's resting near the bottom,
 *  it reverts to the last user-intended offset before the browser paints, so the
 *  snap is invisible. It stays out of the way of every genuine scroll — wheel,
 *  trackpad/momentum, scrollbar drag, touch, and keyboard/typing are all tracked
 *  as user intent and always honored — as is a deliberate programmatic
 *  navigation (find / reveal-diagnostic, which call `markEditorScrollIntent`)
 *  and any large jump. Thresholds are line-height-relative, not magic pixels. */
function installBottomScrollStabilizer(view: EditorView): void {
  // Tear down a prior install first. `initEditor` runs once today, but
  // `editorView` is reassignable (a future re-init / remount), and these
  // document-level listeners would otherwise stack and orphan the old scroller.
  disposeScrollStabilizer?.();

  const sc = view.scrollDOM;
  // The grace window (ms) during which recent user input means a scroll is the
  // user's own intent and must never be reverted.
  const inputGraceMs = (): number => getConfig().ui.codeEditorScrollPinMs;

  let intendedTop = sc.scrollTop; // the offset we believe the user wants
  let lastWheel = -Infinity;
  let lastKey = -Infinity;
  let pointerDown = false; // covers scrollbar drag + touch pan
  let reverting = false;

  const lineH = (): number => view.defaultLineHeight || 18;
  const userActive = (): boolean => {
    const now = performance.now();
    const grace = inputGraceMs();
    return pointerDown
      || now - lastWheel < grace
      || now - lastKey < grace
      || now - scrollIntentAt < grace; // deliberate programmatic navigation
  };

  // Track user-driven scroll intent. Capture phase so we see input even when the
  // editor isn't focused (e.g. dragging the scrollbar).
  const onWheel = (): void => { lastWheel = performance.now(); };
  // Keydown is bound to the whole editor (`view.dom`), not just the scroller, so
  // keystrokes in the search panel (find-next scrolls to the match) count as
  // intent too — the panel lives outside `.cm-scroller`.
  const onKey = (): void => { lastKey = performance.now(); };
  const onPointerDown = (): void => { pointerDown = true; };
  const onPointerUp = (): void => { pointerDown = false; };
  const onScroll = (): void => {
    if (reverting) return;
    if (getConfig().ui.codeEditorScrollPinMs <= 0) { intendedTop = sc.scrollTop; return; } // disabled
    const lh = lineH();
    const maxScroll = sc.scrollHeight - sc.clientHeight;
    // Anchor "near the bottom" to where the user *wanted* to be (intendedTop),
    // not the post-snap position — the snap moves us a line off the bottom, so
    // testing the current offset would miss it right at the boundary.
    const wasNearBottom = maxScroll - intendedTop <= lh * 2;
    const delta = sc.scrollTop - intendedTop;
    // Revert only an unsolicited, small, near-bottom nudge — the measure snap.
    if (!userActive() && wasNearBottom && delta !== 0 && Math.abs(delta) <= lh * 3) {
      reverting = true;
      sc.scrollTop = intendedTop;
      reverting = false;
      return;
    }
    // Otherwise this is the user's intent (or real navigation): adopt it.
    intendedTop = sc.scrollTop;
  };

  sc.addEventListener('wheel', onWheel, { capture: true, passive: true });
  view.dom.addEventListener('keydown', onKey, true);
  // Pointer down/up is tracked on the document: a scrollbar drag holds the
  // pointer down on the scroller without firing wheel/keydown.
  document.addEventListener('pointerdown', onPointerDown, true);
  document.addEventListener('pointerup', onPointerUp, true);
  document.addEventListener('pointercancel', onPointerUp, true);
  sc.addEventListener('scroll', onScroll, { passive: true });

  disposeScrollStabilizer = (): void => {
    sc.removeEventListener('wheel', onWheel, true);
    view.dom.removeEventListener('keydown', onKey, true);
    document.removeEventListener('pointerdown', onPointerDown, true);
    document.removeEventListener('pointerup', onPointerUp, true);
    document.removeEventListener('pointercancel', onPointerUp, true);
    sc.removeEventListener('scroll', onScroll);
    disposeScrollStabilizer = null;
  };
}

export function initEditor(
  container: HTMLElement,
  initialCode: string,
  onChange: (code: string) => void,
  initialLanguage: EditorLanguage = 'manifold-js',
  hooks: EditorHooks = {},
): EditorView {
  const state = EditorState.create({
    doc: initialCode,
    extensions: [
      basicSetup,
      acceptCompletionWithTab,
      manifoldApiCompletion,
      languageCompartment.of(languageExt(initialLanguage)),
      lintGutter(),
      readOnlyCompartment.of(EditorState.readOnly.of(false)),
      themeCompartment.of(themeExt(getTheme())),
      EditorView.updateListener.of((update) => {
        if (update.docChanged) {
          if (activeDiagnostics.length > 0) {
            window.queueMicrotask(() => clearEditorDiagnostics());
          }
          hooks.onEdit?.();
          if (debounceTimer !== null) clearTimeout(debounceTimer);
          debounceTimer = window.setTimeout(() => {
            onChange(getValue());
          }, 300);
          if (idleTimer !== null) clearTimeout(idleTimer);
          idleTimer = window.setTimeout(() => {
            hooks.onIdle?.(getValue());
          }, getConfig().ui.codeEditorErrorIdleMs);
        }
      }),
      EditorView.domEventHandlers({
        blur: () => { hooks.onBlur?.(); return false; },
      }),
      EditorView.theme({
        '&': { height: '100%', fontSize: '13px' },
        '.cm-scroller': { overflow: 'auto' },
        '.cm-content': { fontFamily: 'monospace' },
        '.cm-lint-marker-error': { cursor: 'help' },
      }),
    ],
  });

  editorView = new EditorView({
    state,
    parent: container,
  });

  installBottomScrollStabilizer(editorView);

  onThemeChange((theme) => {
    if (!editorView) return;
    editorView.dispatch({ effects: themeCompartment.reconfigure(themeExt(theme)) });
  });

  return editorView;
}

export function setLanguage(lang: EditorLanguage): void {
  if (!editorView) return;
  currentLanguage = lang;
  editorView.dispatch({
    effects: languageCompartment.reconfigure(languageExt(lang)),
  });
}

export function getValue(): string {
  return editorView?.state.doc.toString() ?? '';
}

export function setValue(code: string): void {
  if (!editorView) return;
  const formatted = autoFormatEnabled ? applyFormat(code, currentLanguage) : code;
  editorView.dispatch({
    changes: { from: 0, to: editorView.state.doc.length, insert: formatted },
  });
  // Programmatic setValue (partwright.run, version load, etc.) signals an
  // explicit caller-managed run, so cancel the debounced auto-run that the
  // docChanged listener just scheduled. Without this, every programmatic
  // value-set triggers an extra run 300 ms later that re-runs the code and
  // (via updateMesh's auto-frame) snaps the camera back — wiping any zoom /
  // orbit the user did in the meantime.
  if (debounceTimer !== null) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
  if (idleTimer !== null) {
    clearTimeout(idleTimer);
    idleTimer = null;
  }
}

function applyFormat(code: string, lang: EditorLanguage): string {
  if (lang === 'scad') return code;
  try {
    return jsBeautify(code, {
      indent_size: 2,
      indent_with_tabs: false,
      brace_style: 'preserve-inline',
      preserve_newlines: true,
      max_preserve_newlines: 2,
      keep_array_indentation: false,
      break_chained_methods: false,
      end_with_newline: true,
      wrap_line_length: 0,
      comma_first: false,
      e4x: false,
      jslint_happy: false,
    });
  } catch {
    return code;
  }
}

export function openFindReplace(): void {
  if (!editorView) return;
  openSearchPanel(editorView);
}

export function formatCode(): void {
  if (!editorView) return;
  const raw = editorView.state.doc.toString();
  const formatted = applyFormat(raw, currentLanguage);
  if (formatted !== raw) {
    editorView.dispatch({
      changes: { from: 0, to: editorView.state.doc.length, insert: formatted },
    });
  }
}

/** True when the editor's content has real edits relative to `code`, ignoring
 *  pure formatting differences. `code` is run through the same auto-format pass
 *  setValue() applies on load, so a freshly-loaded version reports "no edits"
 *  even when its stored code was never formatted (e.g. saved raw via the
 *  console API). When auto-format is off, compares the raw strings. */
export function editorContentDiffersFrom(code: string): boolean {
  const normalized = autoFormatEnabled ? applyFormat(code, currentLanguage) : code;
  return getValue() !== normalized;
}

export function getAutoFormat(): boolean {
  return autoFormatEnabled;
}

export function setAutoFormat(enabled: boolean): void {
  autoFormatEnabled = enabled;
  writePerTabPref('editor-auto-format', enabled ? 'true' : 'false');
}

export function setEditorDiagnostics(diagnostics: SourceDiagnostic[]): void {
  if (!editorView) return;
  const doc = editorView.state.doc.toString();
  activeDiagnostics = diagnostics
    .filter(hasEditorLocation)
    .map(d => toEditorDiagnostic(d, doc));
  editorView.dispatch(setDiagnostics(editorView.state, activeDiagnostics));
}

export function clearEditorDiagnostics(): void {
  if (!editorView || activeDiagnostics.length === 0) return;
  activeDiagnostics = [];
  editorView.dispatch(setDiagnostics(editorView.state, []));
}

export function revealFirstDiagnostic(): void {
  if (!editorView || activeDiagnostics.length === 0) return;
  const first = activeDiagnostics[0];
  // This is a deliberate jump — tell the bottom-scroll stabilizer not to revert
  // it (e.g. a diagnostic on one of the last lines while parked at the bottom).
  markEditorScrollIntent();
  editorView.dispatch({
    selection: { anchor: first.from, head: first.to },
    effects: EditorView.scrollIntoView(first.from, { y: 'center' }),
  });
  editorView.focus();
}

export function setReadOnly(readOnly: boolean): void {
  if (!editorView) return;
  editorView.dispatch({
    effects: readOnlyCompartment.reconfigure(EditorState.readOnly.of(readOnly)),
  });
}
