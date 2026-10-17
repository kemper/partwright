// Code minimap — the compact "shape of the file" view the code pane shows by
// default (layout.ts `codeView: 'mini'`). Most model work is driven by the AI or
// the viewport tools, so the full editor is opt-in: this strip renders the main
// editor's document as a 1px-per-character, syntax-colored overview (canvas,
// virtualized so huge inline-data files stay cheap), marks the lines that changed
// since it last rendered (an AI edit lights up where it landed) and any error
// lines, peeks the real code on hover, and opens the full editor at the clicked
// line. It reads the live CodeMirror doc through codeEditor.ts and never edits.

import { getEditorErrorLines, getEditorLanguage, getEditorLines, onEditorContentChange } from './codeEditor';
import { changedLineRange, tokenizeMinimapLines, type MinimapRun, type MinimapTokenKind } from './minimapModel';
import { getTheme, onThemeChange, type Theme } from '../ui/theme';

/** Rendered geometry, in CSS px: 4px rows (a 3px bar with a 1px gap) and
 *  1.5px per character, so ~80 columns fill the default-width strip. */
const LINE_H = 4;
const BAR_H = 3;
const CHAR_W = 1.5;
const PAD_Y = 4;
/** Text starts after the 2px change-marker gutter. */
const TEXT_X = 5;
/** Right gutter reserved for error markers. */
const ERROR_GUTTER = 3;
/** Lines shown above/below the hovered line in the peek popover. */
const PEEK_RADIUS = 6;
/** Peek lines longer than this are truncated with an ellipsis. */
const PEEK_MAX_COLS = 140;

type Palette = Record<MinimapTokenKind, string> & { hover: string; changed: string; error: string; lineNo: string };

const PALETTES: Record<Theme, Palette> = {
  dark: {
    text: '#abb2bf', keyword: '#c678dd', string: '#98c379', number: '#d19a66', comment: '#5c6370',
    punct: '#7f848e', call: '#61afef', property: '#e06c75',
    hover: 'rgba(255,255,255,0.09)', changed: '#3b82f6', error: '#ef4444', lineNo: '#71717a',
  },
  light: {
    text: '#383a42', keyword: '#a626a4', string: '#50a14f', number: '#986801', comment: '#a0a1a7',
    punct: '#9a9ba1', call: '#4078f2', property: '#e45649',
    hover: 'rgba(0,0,0,0.07)', changed: '#3b82f6', error: '#dc2626', lineNo: '#a1a1aa',
  },
};

export interface CodeMinimapOptions {
  /** Open the full editor; `line` (1-based) when the user clicked a specific line. */
  onOpenFull: (line?: number) => void;
  /** Hide the code pane entirely. */
  onHide: () => void;
}

export interface CodeMinimap {
  /** The pane root to mount in the editor group. */
  el: HTMLElement;
  /** Re-measure and redraw — call after the pane becomes visible or resizes. */
  refresh: () => void;
  /** Surface (or clear) the editor's current error message in the footer badge. */
  setError: (message: string | null) => void;
}

const ICON_BTN = 'shrink-0 w-6 h-6 flex items-center justify-center rounded text-zinc-400 hover:text-zinc-100 hover:bg-zinc-700 text-sm leading-none';

export function createCodeMinimap(opts: CodeMinimapOptions): CodeMinimap {
  const el = document.createElement('div');
  el.id = 'code-minimap';
  el.className = 'hidden flex flex-col flex-1 min-w-0 min-h-0 bg-zinc-900';

  // Header — matches the full editor header's height so toggling modes doesn't
  // shift the rows beneath.
  const header = document.createElement('div');
  header.className = 'flex items-center gap-0.5 pl-2 pr-1 py-[3px] bg-zinc-800 border-b border-zinc-700';
  const label = document.createElement('span');
  label.className = 'flex-1 min-w-0 truncate text-xs text-zinc-400 font-mono select-none';
  label.textContent = 'Code';
  header.appendChild(label);

  const expandBtn = document.createElement('button');
  expandBtn.id = 'code-minimap-expand';
  expandBtn.type = 'button';
  expandBtn.className = ICON_BTN;
  expandBtn.textContent = '⤢';
  expandBtn.title = 'Open the full code editor';
  expandBtn.setAttribute('aria-label', 'Open the full code editor');
  expandBtn.addEventListener('click', () => opts.onOpenFull());
  header.appendChild(expandBtn);

  const hideBtn = document.createElement('button');
  hideBtn.id = 'code-minimap-hide';
  hideBtn.type = 'button';
  hideBtn.className = ICON_BTN;
  hideBtn.textContent = '«';
  hideBtn.title = 'Hide code';
  hideBtn.setAttribute('aria-label', 'Hide code');
  hideBtn.addEventListener('click', () => opts.onHide());
  header.appendChild(hideBtn);
  el.appendChild(header);

  // Scroller → sizer (full virtual height) → sticky canvas painted for the
  // visible slice only. Native scrolling keeps trackpad momentum.
  const scroller = document.createElement('div');
  scroller.className = 'relative flex-1 min-h-0 overflow-y-auto overflow-x-hidden cursor-pointer [scrollbar-width:thin] outline-none focus-visible:ring-1 focus-visible:ring-blue-500';
  scroller.tabIndex = 0;
  scroller.setAttribute('role', 'button');
  const sizer = document.createElement('div');
  sizer.className = 'relative';
  const canvas = document.createElement('canvas');
  canvas.className = 'sticky top-0 block';
  sizer.appendChild(canvas);
  scroller.appendChild(sizer);
  el.appendChild(scroller);

  const footer = document.createElement('div');
  footer.className = 'flex items-center gap-1 px-2 py-1 border-t border-zinc-700 text-[10px] text-zinc-500 font-mono select-none';
  const lineCountEl = document.createElement('span');
  lineCountEl.className = 'flex-1 min-w-0 truncate';
  footer.appendChild(lineCountEl);
  const errorBadge = document.createElement('button');
  errorBadge.id = 'code-minimap-error';
  errorBadge.type = 'button';
  errorBadge.className = 'hidden shrink-0 px-1 rounded text-red-300 bg-red-950/70 border border-red-500/40 hover:bg-red-900/70';
  errorBadge.textContent = '⚠ Error';
  errorBadge.addEventListener('click', () => {
    const first = getEditorErrorLines()[0];
    opts.onOpenFull(first);
  });
  footer.appendChild(errorBadge);
  el.appendChild(footer);

  // Hover peek — real code around the pointer, so "how is this made?" rarely
  // needs the full editor. Fixed-position so it can overhang the viewport.
  const peek = document.createElement('div');
  peek.id = 'code-minimap-peek';
  peek.className = 'hidden fixed z-40 pointer-events-none rounded-md border border-zinc-600 bg-zinc-900/95 shadow-xl backdrop-blur px-2 py-1.5 font-mono text-[11px] leading-[1.45] overflow-hidden';
  peek.setAttribute('aria-hidden', 'true');
  document.body.appendChild(peek);

  // === Model ===
  let lines: string[] = [];
  let runs: MinimapRun[][] = [];
  let changed: { from: number; to: number } | null = null;
  let errorLines: number[] = [];
  let dirty = true;
  let rafId: number | null = null;
  let hoverLine: number | null = null;
  let peekLine: number | null = null;
  let lastPointer: { x: number; y: number } | null = null;

  const isShown = (): boolean => el.isConnected && !el.classList.contains('hidden') && el.offsetParent !== null;

  function rebuild(): void {
    dirty = false;
    const next = getEditorLines().map((l) => l.replace(/\t/g, '  '));
    const prev = lines;
    // Only mark a change against a baseline the user actually saw rendered.
    const range = prev.length > 0 ? changedLineRange(prev, next) : null;
    const contentChanged = prev.length !== next.length || prev.some((l, i) => l !== next[i]);
    if (contentChanged) changed = range;
    lines = next;
    runs = tokenizeMinimapLines(lines, getEditorLanguage() === 'scad' ? 'scad' : 'js');
    errorLines = getEditorErrorLines();
    const n = lines.length;
    lineCountEl.textContent = `${n} line${n === 1 ? '' : 's'}`;
    scroller.setAttribute('aria-label', `Code overview, ${n} lines. Click to open the full editor.`);
    if (contentChanged && range) revealRange(range);
  }

  /** Scroll the minimap so a freshly changed region is on screen. */
  function revealRange(range: { from: number; to: number }): void {
    const top = PAD_Y + range.from * LINE_H;
    const bottom = PAD_Y + (range.to + 1) * LINE_H;
    const viewTop = scroller.scrollTop;
    const viewBottom = viewTop + scroller.clientHeight;
    if (top >= viewTop && bottom <= viewBottom) return;
    scroller.scrollTop = Math.max(0, (top + bottom) / 2 - scroller.clientHeight / 2);
  }

  function draw(): void {
    const width = scroller.clientWidth;
    const height = scroller.clientHeight;
    if (width <= 0 || height <= 0) return;
    sizer.style.height = `${Math.max(height, PAD_Y * 2 + lines.length * LINE_H)}px`;
    const dpr = window.devicePixelRatio || 1;
    const pxW = Math.round(width * dpr);
    const pxH = Math.round(height * dpr);
    if (canvas.width !== pxW || canvas.height !== pxH) {
      canvas.width = pxW;
      canvas.height = pxH;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    const palette = PALETTES[getTheme()];
    const scrollTop = scroller.scrollTop;
    const yOf = (line: number): number => PAD_Y + line * LINE_H - scrollTop;
    const first = Math.max(0, Math.floor((scrollTop - PAD_Y) / LINE_H));
    const last = Math.min(lines.length - 1, Math.ceil((scrollTop + height - PAD_Y) / LINE_H));
    const textRight = width - ERROR_GUTTER - 1;

    if (hoverLine !== null) {
      const from = Math.max(0, hoverLine - PEEK_RADIUS);
      const to = Math.min(lines.length - 1, hoverLine + PEEK_RADIUS);
      ctx.fillStyle = palette.hover;
      ctx.fillRect(0, yOf(from) - 1, width, (to - from + 1) * LINE_H + 1);
    }
    if (changed) {
      ctx.fillStyle = palette.changed;
      ctx.fillRect(0, yOf(changed.from), 2, (changed.to - changed.from + 1) * LINE_H - (LINE_H - BAR_H));
    }
    for (let i = first; i <= last; i++) {
      const y = yOf(i);
      for (const run of runs[i] ?? []) {
        const x = TEXT_X + run.start * CHAR_W;
        if (x >= textRight) break;
        const w = Math.min(textRight, TEXT_X + run.end * CHAR_W) - x;
        ctx.fillStyle = palette[run.kind];
        ctx.fillRect(x, y, w, BAR_H);
      }
    }
    if (errorLines.length > 0) {
      ctx.fillStyle = palette.error;
      for (const ln of errorLines) {
        const y = yOf(ln - 1);
        if (y < -LINE_H || y > height) continue;
        ctx.fillRect(width - ERROR_GUTTER, y - 1, ERROR_GUTTER, LINE_H + 1);
      }
    }
  }

  function render(): void {
    rafId = null;
    if (!isShown()) return; // redrawn on the next refresh() once visible
    if (dirty) rebuild();
    draw();
    if (peekLine !== null) updatePeek(true);
  }

  function schedule(): void {
    if (rafId === null) rafId = requestAnimationFrame(render);
  }

  // === Hover peek ===
  function lineAtClientY(clientY: number): number | null {
    if (lines.length === 0) return null;
    const rect = scroller.getBoundingClientRect();
    const y = clientY - rect.top + scroller.scrollTop - PAD_Y;
    if (y < 0) return 0;
    const line = Math.floor(y / LINE_H);
    // Empty space below the last line isn't any line.
    return line < lines.length ? line : null;
  }

  function buildPeek(center: number): void {
    const palette = PALETTES[getTheme()];
    const from = Math.max(0, center - PEEK_RADIUS);
    const to = Math.min(lines.length - 1, center + PEEK_RADIUS);
    const gutterW = String(to + 1).length;
    peek.replaceChildren();
    for (let i = from; i <= to; i++) {
      const row = document.createElement('div');
      row.className = 'whitespace-pre';
      if (i === center) row.style.background = palette.hover;
      const num = document.createElement('span');
      num.style.color = palette.lineNo;
      num.textContent = `${String(i + 1).padStart(gutterW, ' ')}  `;
      row.appendChild(num);
      const text = lines[i];
      let col = 0;
      const limit = Math.min(text.length, PEEK_MAX_COLS);
      for (const run of runs[i] ?? []) {
        if (run.start >= limit) break;
        if (run.start > col) row.appendChild(document.createTextNode(text.slice(col, run.start)));
        const span = document.createElement('span');
        span.style.color = palette[run.kind];
        const end = Math.min(run.end, limit);
        span.textContent = text.slice(run.start, end);
        row.appendChild(span);
        col = end;
      }
      if (text.length > PEEK_MAX_COLS) {
        const more = document.createElement('span');
        more.style.color = palette.lineNo;
        more.textContent = '…';
        row.appendChild(more);
      }
      peek.appendChild(row);
    }
    const hint = document.createElement('div');
    hint.className = 'mt-1 pt-1 border-t border-zinc-700 text-[10px] text-zinc-500 font-sans';
    hint.textContent = `Click to open the editor at line ${center + 1}`;
    peek.appendChild(hint);
  }

  function positionPeek(clientY: number): void {
    const paneRect = el.getBoundingClientRect();
    const left = paneRect.right + 6;
    peek.style.left = `${left}px`;
    peek.style.maxWidth = `${Math.max(160, Math.min(560, window.innerWidth - left - 12))}px`;
    const h = peek.offsetHeight;
    const top = Math.max(8, Math.min(window.innerHeight - h - 8, clientY - h / 2));
    peek.style.top = `${top}px`;
  }

  /** Recompute the peek for the last pointer position; `force` rebuilds even
   *  when the hovered line is unchanged (the doc or scroll moved under it). */
  function updatePeek(force = false): void {
    if (!lastPointer) return;
    const line = lineAtClientY(lastPointer.y);
    if (line === null) { hidePeek(); return; }
    if (force || line !== peekLine) {
      peekLine = line;
      hoverLine = line;
      buildPeek(line);
      peek.classList.remove('hidden');
      draw();
    }
    positionPeek(lastPointer.y);
  }

  function hidePeek(): void {
    lastPointer = null;
    peekLine = null;
    if (hoverLine !== null) { hoverLine = null; draw(); }
    peek.classList.add('hidden');
  }

  scroller.addEventListener('pointermove', (e) => {
    // Hover peek is a mouse/pen affordance; touch taps go straight to the editor.
    if (e.pointerType === 'touch') return;
    lastPointer = { x: e.clientX, y: e.clientY };
    updatePeek();
  });
  scroller.addEventListener('pointerleave', hidePeek);
  scroller.addEventListener('scroll', () => {
    draw();
    if (lastPointer) updatePeek(true);
  }, { passive: true });
  scroller.addEventListener('click', (e) => {
    const line = lineAtClientY(e.clientY);
    hidePeek();
    opts.onOpenFull(line === null ? undefined : line + 1);
  });
  scroller.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      opts.onOpenFull();
    }
  });

  onEditorContentChange(() => { dirty = true; schedule(); });
  onThemeChange(() => schedule());
  // Keep the canvas sized to the pane (mode toggles, window resizes, slides).
  new ResizeObserver(() => schedule()).observe(scroller);

  return {
    el,
    refresh: () => { dirty = true; schedule(); },
    setError: (message) => {
      errorBadge.classList.toggle('hidden', message === null);
      errorBadge.title = message ? `${message}\n\nClick to open the full editor` : '';
    },
  };
}
