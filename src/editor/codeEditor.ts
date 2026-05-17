import { EditorView } from '@codemirror/view';
import { EditorState, Compartment, type Extension } from '@codemirror/state';
import { javascript } from '@codemirror/lang-javascript';
import { StreamLanguage } from '@codemirror/language';
import { oneDark } from '@codemirror/theme-one-dark';
import { basicSetup } from 'codemirror';
import { lintGutter, setDiagnostics, type Diagnostic } from '@codemirror/lint';
import type { SourceDiagnostic } from '../geometry/types';
import { getTheme, onThemeChange, type Theme } from '../ui/theme';
import { getRenderDelayMs } from '../preferences';

export type EditorLanguage = 'manifold-js' | 'scad';

let editorView: EditorView | null = null;
let debounceTimer: number | null = null;
let activeDiagnostics: Diagnostic[] = [];
const languageCompartment = new Compartment();
const readOnlyCompartment = new Compartment();
const themeCompartment = new Compartment();

function themeExt(theme: Theme): Extension {
  return theme === 'dark' ? oneDark : [];
}

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

function languageExt(lang: EditorLanguage): Extension {
  return lang === 'scad' ? scadLanguage : javascript();
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

export function initEditor(
  container: HTMLElement,
  initialCode: string,
  onChange: (code: string) => void,
  initialLanguage: EditorLanguage = 'manifold-js',
): EditorView {
  const state = EditorState.create({
    doc: initialCode,
    extensions: [
      basicSetup,
      languageCompartment.of(languageExt(initialLanguage)),
      lintGutter(),
      readOnlyCompartment.of(EditorState.readOnly.of(false)),
      themeCompartment.of(themeExt(getTheme())),
      EditorView.updateListener.of((update) => {
        if (update.docChanged) {
          if (activeDiagnostics.length > 0) {
            window.queueMicrotask(() => clearEditorDiagnostics());
          }
          if (debounceTimer !== null) clearTimeout(debounceTimer);
          debounceTimer = window.setTimeout(() => {
            onChange(getValue());
          }, getRenderDelayMs());
        }
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

  onThemeChange((theme) => {
    if (!editorView) return;
    editorView.dispatch({ effects: themeCompartment.reconfigure(themeExt(theme)) });
  });

  return editorView;
}

export function setLanguage(lang: EditorLanguage): void {
  if (!editorView) return;
  editorView.dispatch({
    effects: languageCompartment.reconfigure(languageExt(lang)),
  });
}

export function getValue(): string {
  return editorView?.state.doc.toString() ?? '';
}

export function setValue(code: string): void {
  if (!editorView) return;
  editorView.dispatch({
    changes: { from: 0, to: editorView.state.doc.length, insert: code },
  });
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
