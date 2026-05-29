// Confirm-before-compact modal. Shows the proposed summary (editable),
// the proposed session notes (each editable / dismissable), the count
// of turns to drop vs keep, and the cost of the compaction call itself.

import { signal, type Signal } from '@preact/signals';
import { formatUsd } from '../ai/cost';
import type { CompactionProposal } from '../ai/compaction';
import { mountPreactModal } from './preact/mount';

export interface CompactConfirm {
  summary: string;
  notes: string[];
}

interface NoteState {
  include: boolean;
  text: string;
}

function CompactBody(props: {
  proposal: CompactionProposal;
  summary: Signal<string>;
  notes: Signal<NoteState[]>;
}) {
  const { proposal, summary, notes } = props;
  return (
    <>
      <div class="flex gap-4 text-xs text-zinc-400">
        <span>
          <span class="text-zinc-200 font-medium">{proposal.drop.length}</span>{' '}turns dropped
        </span>
        <span>
          <span class="text-zinc-200 font-medium">{proposal.keep.length}</span>{' '}turns kept verbatim
        </span>
        <span>
          compaction cost: <span class="text-zinc-200 font-medium">{formatUsd(proposal.costUsd)}</span>
        </span>
      </div>

      <h3 class="text-xs uppercase tracking-wider text-zinc-500 font-semibold">Summary</h3>
      <textarea
        class="w-full min-h-[120px] px-3 py-2 rounded bg-zinc-900 border border-zinc-600 text-zinc-100 text-xs leading-relaxed font-mono resize-y"
        value={summary.value}
        onInput={e => { summary.value = (e.currentTarget as HTMLTextAreaElement).value; }}
      />

      <h3 class="text-xs uppercase tracking-wider text-zinc-500 font-semibold mt-2">
        Session notes to add ({proposal.proposedNotes.length})
      </h3>
      <p class="text-xs text-zinc-500 leading-snug">
        These get appended to the session log so they survive future compactions and are visible to future agents. Uncheck any you do not want to keep, or edit the text in place.
      </p>

      <div class="flex flex-col gap-1">
        {notes.value.length === 0
          ? <p class="text-xs text-zinc-500">No notes proposed — the summary is enough.</p>
          : notes.value.map((note, i) => (
            <div key={i} class="flex items-center gap-2">
              <input
                type="checkbox"
                class="shrink-0 accent-blue-500"
                checked={note.include}
                onChange={e => {
                  const checked = (e.currentTarget as HTMLInputElement).checked;
                  notes.value = notes.value.map((n, idx) => idx === i ? { ...n, include: checked } : n);
                }}
              />
              <input
                type="text"
                class="flex-1 px-2 py-1 rounded bg-zinc-900 border border-zinc-600 text-zinc-100 text-xs font-mono"
                value={note.text}
                onInput={e => {
                  const text = (e.currentTarget as HTMLInputElement).value;
                  notes.value = notes.value.map((n, idx) => idx === i ? { ...n, text } : n);
                }}
              />
            </div>
          ))}
      </div>
    </>
  );
}

export function showCompactConfirmModal(
  proposal: CompactionProposal,
  onConfirm: (result: CompactConfirm) => void,
): void {
  const summary = signal(proposal.summary);
  const notes = signal<NoteState[]>(
    proposal.proposedNotes.map(text => ({ include: true, text })),
  );

  mountPreactModal(
    { title: 'Compact conversation', maxWidth: '2xl', scrollable: true },
    close => ({
      body: <CompactBody proposal={proposal} summary={summary} notes={notes} />,
      footer: (
        <>
          <button
            type="button"
            class="px-3 py-1.5 rounded text-xs text-zinc-300 hover:bg-zinc-700"
            onClick={close}
          >Cancel</button>
          <button
            type="button"
            class="px-3 py-1.5 rounded text-xs font-medium bg-blue-600 hover:bg-blue-500 text-white"
            onClick={() => {
              const kept = notes.value
                .filter(n => n.include)
                .map(n => n.text.trim())
                .filter(n => n.length > 0);
              close();
              onConfirm({ summary: summary.value.trim(), notes: kept });
            }}
          >Compact</button>
        </>
      ),
    }),
    { bodyClassPatches: [['gap-3', 'gap-4']] },
  );
}
