// Model console — the last run's `console.log` / warn / error output from the
// model code. The same lines reach agents as `logs` on run / runAndSave /
// getGeometryData; this is the people-facing view of them.
//
// A run that prints shows a small pill in the viewport's lower-left corner
// (terminal icon + line count, tinted by the worst level) rather than opening
// a drawer over the model — an AI iterating on code can print on every run.
// Clicking the pill expands it into the output drawer; × dismisses it until
// the next run prints. The collapsed pill fades after
// `ui.modelConsoleAutoHideMs` (paused while hovered/focused; output with
// errors stays), and `show()` — the "Show console output" palette command —
// brings it back expanded.

import { BUTTON_SMALL_SECONDARY } from './styleConstants';
import { showToast } from './toast';
import { getConfig } from '../config/appConfig';

/** Fade-out transition length before the pill is display:none'd (ms). Matches
 *  the `duration-300` class below — structural, not a tuning knob. */
const FADE_MS = 300;

export interface ModelConsolePanel {
  el: HTMLElement;
  /** Show a run's lines (undefined/empty hides the panel). */
  setLogs(logs: string[] | undefined): void;
  /** Re-open the last run's output, expanded. False when there is none. */
  show(): boolean;
  /** Whether the last run printed anything. */
  hasLogs(): boolean;
}

type Level = 'error' | 'warn' | 'log';

function lineLevel(line: string): Level {
  if (line.startsWith('error: ') || line.startsWith('assert: ')) return 'error';
  if (line.startsWith('warn: ')) return 'warn';
  return 'log';
}

/** Colour by the level prefix modelConsole.ts writes. */
function lineClass(line: string): string {
  if (line.startsWith('… ')) return 'text-zinc-500 italic';
  const level = lineLevel(line);
  if (level === 'error') return 'text-red-500';
  if (level === 'warn') return 'text-amber-500';
  return 'text-zinc-200';
}

const COUNT_CLASS: Record<Level, string> = {
  error: 'bg-red-600 text-white',
  warn: 'bg-amber-600 text-white',
  log: 'bg-zinc-700 text-zinc-200',
};

const TERMINAL_ICON = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="w-3.5 h-3.5" aria-hidden="true"><rect x="1.5" y="2.5" width="13" height="11" rx="1.5"/><path d="M4.5 6l2 2-2 2M8.5 10.5h3"/></svg>';

export function createModelConsolePanel(): ModelConsolePanel {
  let lines: string[] = [];
  let expanded = false;
  let worst: Level = 'log';
  let hideTimer: ReturnType<typeof setTimeout> | null = null;
  let fadeTimer: ReturnType<typeof setTimeout> | null = null;
  let hovered = false;

  const el = document.createElement('div');
  el.id = 'model-console';
  el.className = 'absolute left-2 bottom-28 md:bottom-2 z-20 hidden flex-col rounded border border-zinc-700 bg-zinc-900/95 text-xs shadow-lg transition-opacity duration-300';

  const header = document.createElement('div');
  header.className = 'flex items-center gap-1 pl-2 pr-1';

  const toggle = document.createElement('button');
  toggle.id = 'model-console-toggle';
  toggle.type = 'button';
  toggle.className = 'flex items-center gap-1.5 min-h-[44px] md:min-h-0 py-1 font-medium text-zinc-200 hover:text-zinc-50';
  const icon = document.createElement('span');
  icon.className = 'text-zinc-400';
  icon.innerHTML = TERMINAL_ICON;
  const label = document.createElement('span');
  label.textContent = 'Console';
  const count = document.createElement('span');
  count.id = 'model-console-count';
  const arrow = document.createElement('span');
  arrow.className = 'w-3 text-zinc-400';
  toggle.append(icon, label, count, arrow);

  const spacer = document.createElement('div');
  spacer.className = 'flex-1';

  const copyBtn = document.createElement('button');
  copyBtn.type = 'button';
  copyBtn.className = `${BUTTON_SMALL_SECONDARY} min-h-[44px] md:min-h-0`;
  copyBtn.textContent = 'Copy';
  copyBtn.title = 'Copy the output to the clipboard';

  const closeBtn = document.createElement('button');
  closeBtn.id = 'model-console-close';
  closeBtn.type = 'button';
  closeBtn.className = 'min-h-[44px] min-w-[44px] md:min-h-0 md:min-w-0 px-1.5 text-base leading-none text-zinc-400 hover:text-zinc-100';
  closeBtn.textContent = '×';
  closeBtn.title = 'Dismiss until the next run prints (Show console output in the command palette brings it back)';
  closeBtn.setAttribute('aria-label', 'Dismiss console');

  header.append(toggle, spacer, copyBtn, closeBtn);

  const body = document.createElement('div');
  body.id = 'model-console-body';
  body.setAttribute('role', 'log');
  body.className = 'max-h-48 overflow-auto border-t border-zinc-800 px-2 py-1 font-mono text-[11px] leading-4';

  el.append(header, body);

  const clearTimers = (): void => {
    if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
    if (fadeTimer) { clearTimeout(fadeTimer); fadeTimer = null; }
  };

  const hide = (): void => {
    clearTimers();
    // A hidden element gets no pointerleave/focusout, so don't let a stale
    // hover pin the next pill open.
    hovered = false;
    el.classList.add('hidden');
    el.classList.remove('flex', 'opacity-0');
  };

  /** Start (or restart) the collapsed pill's fade-out countdown. */
  const armAutoHide = (): void => {
    clearTimers();
    el.classList.remove('opacity-0');
    const ms = getConfig().ui.modelConsoleAutoHideMs;
    if (expanded || hovered || worst === 'error' || !(ms > 0)) return;
    hideTimer = setTimeout(() => {
      hideTimer = null;
      el.classList.add('opacity-0');
      fadeTimer = setTimeout(hide, FADE_MS);
    }, ms);
  };

  const sync = (): void => {
    arrow.textContent = expanded ? '▾' : '▸';
    toggle.setAttribute('aria-expanded', String(expanded));
    toggle.title = expanded
      ? 'Collapse the console'
      : `What the model code printed with console.log / warn / error on its last run (${lines.length} line${lines.length === 1 ? '' : 's'}) — click to read it`;
    body.classList.toggle('hidden', !expanded);
    copyBtn.classList.toggle('hidden', !expanded);
    // Collapsed it is a content-sized pill; expanded it is the output drawer.
    for (const c of ['right-2', 'md:right-auto', 'md:w-[min(42rem,calc(100%-1rem))]']) el.classList.toggle(c, expanded);
    spacer.classList.toggle('hidden', !expanded);
    count.className = `rounded px-1.5 text-[10px] font-semibold ${COUNT_CLASS[worst]}`;
    if (expanded) body.scrollTop = body.scrollHeight;
  };

  const reveal = (): void => {
    el.classList.remove('hidden');
    el.classList.add('flex');
    sync();
    armAutoHide();
  };

  toggle.addEventListener('click', () => {
    expanded = !expanded;
    sync();
    armAutoHide();
  });
  closeBtn.addEventListener('click', () => {
    expanded = false;
    hide();
  });
  copyBtn.addEventListener('click', () => {
    const failed = () => showToast('Could not copy the console output', { variant: 'warn' });
    const write = navigator.clipboard?.writeText(lines.join('\n'));
    if (!write) { failed(); return; }
    write.then(() => showToast('Console output copied', { variant: 'success' }), failed);
  });
  // Don't fade the pill out from under a pointer or keyboard focus.
  el.addEventListener('pointerenter', () => { hovered = true; armAutoHide(); });
  el.addEventListener('pointerleave', () => { hovered = false; armAutoHide(); });
  el.addEventListener('focusin', () => { hovered = true; armAutoHide(); });
  el.addEventListener('focusout', (e) => {
    if (el.contains(e.relatedTarget as Node | null)) return;
    hovered = false;
    armAutoHide();
  });

  return {
    el,
    setLogs(logs) {
      lines = logs ?? [];
      if (lines.length === 0) {
        expanded = false;
        hide();
        body.replaceChildren();
        return;
      }
      const levels = lines.map(lineLevel);
      worst = levels.includes('error') ? 'error' : levels.includes('warn') ? 'warn' : 'log';
      count.textContent = String(lines.length);
      body.replaceChildren(...lines.map(line => {
        const row = document.createElement('div');
        row.className = `whitespace-pre-wrap break-words ${lineClass(line)}`;
        row.textContent = line;
        return row;
      }));
      // An open drawer stays open across runs; otherwise a new run's output
      // arrives as the collapsed pill.
      reveal();
    },
    show() {
      if (lines.length === 0) return false;
      expanded = true;
      reveal();
      return true;
    },
    hasLogs: () => lines.length > 0,
  };
}
