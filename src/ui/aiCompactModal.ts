// Confirm-before-compact modal. Shows the proposed summary, the proposed
// session notes (each editable / dismissable), the count of turns to drop
// vs keep, and the cost of the compaction call itself.

import { formatUsd } from '../ai/cost';
import type { CompactionProposal } from '../ai/compaction';
import { createModalShell } from './modalShell';

export interface CompactConfirm {
  /** The summary text the user accepted (may be edited from the proposal). */
  summary: string;
  /** Notes the user kept and wants written to the session log. */
  notes: string[];
}

export function showCompactConfirmModal(
  proposal: CompactionProposal,
  onConfirm: (result: CompactConfirm) => void,
): void {
  const shell = createModalShell({ title: 'Compact conversation', maxWidth: '2xl', scrollable: true });
  // The compaction modal uses a slightly larger gap than the default.
  shell.body.classList.remove('gap-3');
  shell.body.classList.add('gap-4');

  const stats = document.createElement('div');
  stats.className = 'flex gap-4 text-xs text-zinc-400';
  const dropEl = document.createElement('span');
  dropEl.innerHTML = `<span class="text-zinc-200 font-medium">${proposal.drop.length}</span> turns dropped`;
  const keepEl = document.createElement('span');
  keepEl.innerHTML = `<span class="text-zinc-200 font-medium">${proposal.keep.length}</span> turns kept verbatim`;
  const costEl = document.createElement('span');
  costEl.innerHTML = `compaction cost: <span class="text-zinc-200 font-medium">${formatUsd(proposal.costUsd)}</span>`;
  stats.appendChild(dropEl);
  stats.appendChild(keepEl);
  stats.appendChild(costEl);
  shell.body.appendChild(stats);

  const summaryHeader = document.createElement('h3');
  summaryHeader.className = 'text-xs uppercase tracking-wider text-zinc-500 font-semibold';
  summaryHeader.textContent = 'Summary';
  shell.body.appendChild(summaryHeader);

  const summaryArea = document.createElement('textarea');
  summaryArea.className = 'w-full min-h-[120px] px-3 py-2 rounded bg-zinc-900 border border-zinc-600 text-zinc-100 text-xs leading-relaxed font-mono resize-y';
  summaryArea.value = proposal.summary;
  shell.body.appendChild(summaryArea);

  const notesHeader = document.createElement('h3');
  notesHeader.className = 'text-xs uppercase tracking-wider text-zinc-500 font-semibold mt-2';
  notesHeader.textContent = `Session notes to add (${proposal.proposedNotes.length})`;
  shell.body.appendChild(notesHeader);

  const notesIntro = document.createElement('p');
  notesIntro.className = 'text-xs text-zinc-500 leading-snug';
  notesIntro.textContent = 'These get appended to the session log so they survive future compactions and are visible to future agents. Uncheck any you do not want to keep, or edit the text in place.';
  shell.body.appendChild(notesIntro);

  const notesContainer = document.createElement('div');
  notesContainer.className = 'flex flex-col gap-1';
  const noteRows: { include: HTMLInputElement; text: HTMLInputElement }[] = [];
  for (const note of proposal.proposedNotes) {
    const row = document.createElement('div');
    row.className = 'flex items-center gap-2';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = true;
    cb.className = 'shrink-0 accent-blue-500';
    const txt = document.createElement('input');
    txt.type = 'text';
    txt.value = note;
    txt.className = 'flex-1 px-2 py-1 rounded bg-zinc-900 border border-zinc-600 text-zinc-100 text-xs font-mono';
    row.appendChild(cb);
    row.appendChild(txt);
    notesContainer.appendChild(row);
    noteRows.push({ include: cb, text: txt });
  }
  if (proposal.proposedNotes.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'text-xs text-zinc-500';
    empty.textContent = 'No notes proposed — the summary is enough.';
    notesContainer.appendChild(empty);
  }
  shell.body.appendChild(notesContainer);

  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'px-3 py-1.5 rounded text-xs text-zinc-300 hover:bg-zinc-700';
  cancelBtn.textContent = 'Cancel';
  cancelBtn.addEventListener('click', shell.close);
  shell.footer.appendChild(cancelBtn);

  const confirmBtn = document.createElement('button');
  confirmBtn.className = 'px-3 py-1.5 rounded text-xs font-medium bg-blue-600 hover:bg-blue-500 text-white';
  confirmBtn.textContent = 'Compact';
  confirmBtn.addEventListener('click', () => {
    const notes = noteRows
      .filter(r => r.include.checked)
      .map(r => r.text.value.trim())
      .filter(n => n.length > 0);
    shell.close();
    onConfirm({ summary: summaryArea.value.trim(), notes });
  });
  shell.footer.appendChild(confirmBtn);
}
