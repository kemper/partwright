// Model console — the last run's `console.log` / warn / error output from the
// model code, shown in a drawer along the bottom of the viewport. The same
// lines reach agents as `logs` on run / runAndSave / getGeometryData; this is
// the people-facing view of them. Hidden when the last run printed nothing.

import { BUTTON_SMALL_SECONDARY } from './styleConstants';
import { showToast } from './toast';

const COLLAPSED_KEY = 'partwright-model-console-collapsed';

export interface ModelConsolePanel {
  el: HTMLElement;
  /** Show a run's lines (undefined/empty hides the panel). */
  setLogs(logs: string[] | undefined): void;
}

function readCollapsed(): boolean {
  try { return localStorage.getItem(COLLAPSED_KEY) === '1'; } catch { return false; }
}

function writeCollapsed(collapsed: boolean): void {
  try { localStorage.setItem(COLLAPSED_KEY, collapsed ? '1' : '0'); } catch { /* ignore */ }
}

/** Colour by the level prefix modelConsole.ts writes. */
function lineClass(line: string): string {
  if (line.startsWith('warn: ')) return 'text-amber-500';
  if (line.startsWith('error: ') || line.startsWith('assert: ')) return 'text-red-500';
  if (line.startsWith('… ')) return 'text-zinc-500 italic';
  return 'text-zinc-200';
}

export function createModelConsolePanel(): ModelConsolePanel {
  let lines: string[] = [];
  let collapsed = readCollapsed();

  const el = document.createElement('div');
  el.id = 'model-console';
  el.className = 'absolute left-2 right-2 md:right-auto md:w-[min(42rem,calc(100%-1rem))] bottom-28 md:bottom-2 z-20 hidden flex-col rounded border border-zinc-700 bg-zinc-900/95 text-xs shadow-lg';

  const header = document.createElement('div');
  header.className = 'flex items-center gap-2 px-2';

  const toggle = document.createElement('button');
  toggle.id = 'model-console-toggle';
  toggle.type = 'button';
  toggle.className = 'flex items-center gap-1.5 min-h-[44px] md:min-h-0 py-1 font-medium text-zinc-200 hover:text-zinc-50';
  toggle.title = 'What the model code printed with console.log / warn / error on its last run';
  const arrow = document.createElement('span');
  arrow.className = 'w-3 text-zinc-400';
  const label = document.createElement('span');
  label.textContent = 'Console';
  const count = document.createElement('span');
  count.className = 'rounded bg-zinc-800 px-1.5 text-[10px] text-zinc-400';
  toggle.append(arrow, label, count);

  const spacer = document.createElement('div');
  spacer.className = 'flex-1';

  const copyBtn = document.createElement('button');
  copyBtn.type = 'button';
  copyBtn.className = `${BUTTON_SMALL_SECONDARY} min-h-[44px] md:min-h-0`;
  copyBtn.textContent = 'Copy';
  copyBtn.title = 'Copy the output to the clipboard';

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'min-h-[44px] min-w-[44px] md:min-h-0 md:min-w-0 px-1.5 text-base leading-none text-zinc-400 hover:text-zinc-100';
  closeBtn.textContent = '×';
  closeBtn.title = 'Hide until the next run prints something';
  closeBtn.setAttribute('aria-label', 'Hide console');

  header.append(toggle, spacer, copyBtn, closeBtn);

  const body = document.createElement('div');
  body.id = 'model-console-body';
  body.setAttribute('role', 'log');
  body.className = 'max-h-48 overflow-auto border-t border-zinc-800 px-2 py-1 font-mono text-[11px] leading-4';

  el.append(header, body);

  const sync = (): void => {
    arrow.textContent = collapsed ? '▸' : '▾';
    toggle.setAttribute('aria-expanded', String(!collapsed));
    body.classList.toggle('hidden', collapsed);
  };

  toggle.addEventListener('click', () => {
    collapsed = !collapsed;
    writeCollapsed(collapsed);
    sync();
  });
  closeBtn.addEventListener('click', () => {
    el.classList.add('hidden');
    el.classList.remove('flex');
  });
  copyBtn.addEventListener('click', () => {
    navigator.clipboard.writeText(lines.join('\n')).then(
      () => showToast('Console output copied', { variant: 'success' }),
      () => showToast('Could not copy the console output', { variant: 'warn' }),
    );
  });

  sync();

  return {
    el,
    setLogs(logs) {
      lines = logs ?? [];
      if (lines.length === 0) {
        el.classList.add('hidden');
        el.classList.remove('flex');
        body.replaceChildren();
        return;
      }
      count.textContent = String(lines.length);
      body.replaceChildren(...lines.map(line => {
        const row = document.createElement('div');
        row.className = `whitespace-pre-wrap break-words ${lineClass(line)}`;
        row.textContent = line;
        return row;
      }));
      el.classList.remove('hidden');
      el.classList.add('flex');
      body.scrollTop = body.scrollHeight;
    },
  };
}
