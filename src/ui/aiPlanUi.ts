// Plan-mode pieces of the AI panel (#1209): the planning-style picker shown on
// a new plan request, the feasibility estimate on the plan card, and the text
// of the build checkpoint. DOM only — the panel owns the state and wiring.

import type { PlanStyle } from '../ai/userWords';
import { PLAN_STYLES } from '../ai/userWords';
import { formatUsd } from '../ai/cost';
import { difficultyLabel, roundsLabel, type BuildBudget, type PlanDifficulty, type PlanEstimate } from '../ai/planEstimate';

export const PLAN_STYLE_INFO: Record<PlanStyle, { label: string; chip: string; description: string }> = {
  quick: {
    label: 'Quick plan',
    chip: '📋 Plan first',
    description: 'Reads your request and writes a detailed plan with an estimate. Looks at the model only where it helps.',
  },
  assess: {
    label: 'Assess first',
    chip: '🔎 Assess first',
    description: 'Inspects your attachments and the current model with the read-only tools, then reports feasibility — difficulty, tools that fit or are missing, expected quality and rounds — before the plan. Costs a few extra rounds.',
  },
  compare: {
    label: 'Compare approaches',
    chip: '⚖ Compare approaches',
    description: 'Lays out 2–3 different ways to do it, each with its difficulty, cost and quality, and asks you to pick one before planning it.',
  },
};

/** The picker that opens on a new plan request: one button per planning
 *  style (the last one used leads), "don't ask again", and cancel. Renders
 *  into `bar` (emptied first); the caller shows/hides the bar. */
export function renderPlanStylePicker(
  bar: HTMLElement,
  opts: { current: PlanStyle; onPick: (style: PlanStyle, remember: boolean) => void; onCancel: () => void },
): void {
  bar.replaceChildren();
  bar.dataset.planStylePicker = '';
  bar.setAttribute('role', 'group');
  bar.setAttribute('aria-label', 'How should the AI plan this?');
  const head = document.createElement('div');
  head.className = 'flex items-center gap-2';
  const title = document.createElement('span');
  title.className = 'flex-1 text-[11px] font-medium text-amber-200';
  title.textContent = '📋 How should the AI plan this?';
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'shrink-0 flex items-center justify-center min-w-[44px] min-h-[44px] -my-3 -mr-2 md:min-w-0 md:min-h-0 md:m-0 px-1 text-zinc-400 hover:text-zinc-100';
  close.textContent = '✕';
  close.title = 'Cancel — your message stays in the input';
  close.setAttribute('aria-label', 'Cancel planning');
  close.addEventListener('click', () => opts.onCancel());
  head.append(title, close);
  bar.appendChild(head);

  const options = document.createElement('div');
  options.className = 'flex flex-col gap-1';
  const remember = document.createElement('input');
  remember.type = 'checkbox';
  const order = [opts.current, ...PLAN_STYLES.filter(s => s !== opts.current)];
  let first: HTMLButtonElement | null = null;
  for (const style of order) {
    const info = PLAN_STYLE_INFO[style];
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.dataset.planStyle = style;
    btn.className = style === opts.current
      ? 'text-left px-2 py-1.5 rounded border border-blue-500/70 bg-blue-600/20 hover:bg-blue-600/30 text-zinc-100'
      : 'text-left px-2 py-1.5 rounded border border-zinc-700 bg-zinc-800/60 hover:bg-zinc-700/60 text-zinc-200';
    const name = document.createElement('div');
    name.className = 'text-[12px] font-medium';
    name.textContent = style === opts.current ? `${info.label} (last used)` : info.label;
    const desc = document.createElement('div');
    desc.className = 'text-[11px] text-zinc-400 leading-snug';
    desc.textContent = info.description;
    btn.append(name, desc);
    btn.addEventListener('click', () => opts.onPick(style, remember.checked));
    options.appendChild(btn);
    first ??= btn;
  }
  bar.appendChild(options);

  const rememberRow = document.createElement('label');
  rememberRow.className = 'flex items-center gap-1.5 text-[11px] text-zinc-400 cursor-pointer select-none';
  rememberRow.append(remember, document.createTextNode('Always use this style — don\'t ask again (change it in AI Settings)'));
  bar.appendChild(rememberRow);
  // Keyboard: arrows move between the styles, Escape cancels.
  const buttons = [...options.querySelectorAll<HTMLButtonElement>('[data-plan-style]')];
  bar.onkeydown = (ev: KeyboardEvent) => {
    if (ev.key === 'Escape') { ev.preventDefault(); opts.onCancel(); return; }
    if (ev.key !== 'ArrowDown' && ev.key !== 'ArrowUp') return;
    const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (i < 0) return;
    ev.preventDefault();
    buttons[(i + (ev.key === 'ArrowDown' ? 1 : buttons.length - 1)) % buttons.length].focus();
  };
  first?.focus();
}

const DIFFICULTY_CLASS: Record<PlanDifficulty, string> = {
  easy: 'bg-emerald-700/40 text-emerald-200 border-emerald-600/60',
  medium: 'bg-amber-700/30 text-amber-100 border-amber-600/60',
  hard: 'bg-orange-700/40 text-orange-100 border-orange-600/60',
  research: 'bg-red-800/40 text-red-100 border-red-600/60',
};

function chip(text: string, cls: string, title?: string): HTMLElement {
  const el = document.createElement('span');
  el.className = `px-1.5 py-0.5 rounded border text-[11px] ${cls}`;
  el.textContent = text;
  if (title) el.title = title;
  return el;
}

/** A labelled bullet list on a plan card (assumptions, gaps, risks). */
export function appendPlanCardList(card: HTMLElement, label: string, items: string[]): void {
  if (items.length === 0) return;
  const heading = document.createElement('div');
  heading.className = 'mt-1 text-[11px] uppercase tracking-wide text-zinc-400';
  heading.textContent = label;
  card.appendChild(heading);
  const list = document.createElement('ul');
  list.className = 'list-disc pl-5 text-zinc-300 flex flex-col gap-0.5';
  for (const item of items) {
    const li = document.createElement('li');
    li.textContent = item;
    list.appendChild(li);
  }
  card.appendChild(list);
}

/** The estimate block on a plan card: difficulty, rounds, cost, confidence,
 *  expected quality, gaps and risks, the checkpoint, and past calibration. */
export function renderPlanEstimate(
  e: PlanEstimate,
  cost: { low: number; high: number } | null,
  calibration: string | null,
): HTMLElement {
  const box = document.createElement('div');
  box.className = 'mt-1 rounded border border-zinc-700 bg-zinc-900/60 px-2 py-1.5 flex flex-col gap-1';
  box.dataset.planEstimate = e.difficulty;
  const row = document.createElement('div');
  row.className = 'flex flex-wrap items-center gap-1';
  row.appendChild(chip(difficultyLabel(e.difficulty), DIFFICULTY_CLASS[e.difficulty], 'How hard this is with this app\'s tools'));
  row.appendChild(chip(`~${roundsLabel(e)}`, 'border-zinc-600 text-zinc-200', 'Tool round-trips the build should take, including checks and fixes'));
  if (cost) {
    row.appendChild(chip(`≈ ${formatUsd(cost.low)}–${formatUsd(cost.high)}`, 'border-zinc-600 text-zinc-200',
      'The round range at this chat\'s recent average cost per round. A rough guide: rounds that render images cost more.'));
  }
  if (e.confidence !== undefined) {
    row.appendChild(chip(`${e.confidence}% confident`, 'border-zinc-600 text-zinc-200', 'The planner\'s own chance of reaching the expected quality within the estimate'));
  }
  box.appendChild(row);
  if (e.quality) {
    const q = document.createElement('div');
    q.className = 'text-[12px] text-zinc-300';
    q.textContent = `Expected result: ${e.quality}`;
    box.appendChild(q);
  }
  appendPlanCardList(box, 'Missing or weak tools', e.gaps);
  appendPlanCardList(box, 'Risks', e.risks);
  const stop = document.createElement('div');
  stop.className = 'text-[11px] text-zinc-400';
  stop.textContent = `Building pauses for your go-ahead after ${e.roundsMax} rounds (instead of the ⟲ cap).`;
  box.appendChild(stop);
  if (calibration) {
    const cal = document.createElement('div');
    cal.className = 'text-[11px] italic text-zinc-500';
    cal.dataset.planCalibration = '';
    cal.textContent = calibration;
    box.appendChild(cal);
  }
  return box;
}

export function checkpointTitle(b: BuildBudget): string {
  return `Plan checkpoint — ${b.used} rounds used (estimated ${roundsLabel(b.estimate)})`;
}

export function checkpointBody(b: BuildBudget, extension: number): string {
  const est = b.estCost ? ` (≈${formatUsd(b.estCost.low)}–${formatUsd(b.estCost.high)})` : '';
  const spent = b.spentUsd > 0 ? ` and ${formatUsd(b.spentUsd)}` : '';
  return `The plan estimated ${roundsLabel(b.estimate)}${est}; the build has used ${b.used} rounds${spent} and isn't finished. `
    + 'Check the model, then keep going or take it as it is. '
    + `Keep going grants ${extension} more rounds and pauses here again after them.`;
}
