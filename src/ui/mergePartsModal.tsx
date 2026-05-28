// Modal shown when merging the multi-selected parts in the rail. Collects
// what should happen to the originals — keep them and add a new combined
// part, or replace them with a single combined part. The combine itself is
// done by the caller; this dialog only collects the choice.

import { signal } from '@preact/signals';
import type { Signal } from '@preact/signals';
import { mountPreactModal } from './preact/mount';
import { BUTTON_PRIMARY, BUTTON_CANCEL } from './styleConstants';

export type MergeMode = 'new' | 'replace';

export interface MergePartsOptions {
  /** Names of the parts being merged (two or more). */
  partNames: string[];
}

export interface MergeChoice {
  mode: MergeMode;
}

interface ModeSpec {
  mode: MergeMode;
  title: string;
  desc: string;
}

const MODES: ModeSpec[] = [
  { mode: 'new', title: 'Combine into a new part', desc: 'Keeps the selected parts and adds a new part holding the combination.' },
  { mode: 'replace', title: 'Merge into one part', desc: 'Replaces the selected parts (and their history) with a single combined part.' },
];

function MergeBody(props: { partNames: string[]; selected: Signal<MergeMode> }) {
  const { partNames, selected } = props;
  const namesText = partNames.map(n => `"${n}"`).join(', ');
  return (
    <>
      <p class="text-[11px] text-zinc-400 leading-relaxed">
        Combine <span class="text-zinc-200 font-medium">{partNames.length} parts</span> — {namesText} — into one, composed as separate components. Render-only parts can't be combined.
      </p>
      <div class="flex flex-col gap-1 mt-1">
        {MODES.map(m => (
          <label
            key={m.mode}
            class="flex items-start gap-2.5 py-1.5 px-2 -mx-2 rounded cursor-pointer hover:bg-zinc-700/40"
          >
            <input
              type="radio"
              name="merge-mode"
              value={m.mode}
              checked={selected.value === m.mode}
              class="mt-0.5 w-4 h-4 accent-blue-500 cursor-pointer"
              data-mode={m.mode}
              onChange={e => {
                if ((e.currentTarget as HTMLInputElement).checked) selected.value = m.mode;
              }}
            />
            <div class="flex-1 min-w-0">
              <div class="text-xs text-zinc-200 font-medium">{m.title}</div>
              <div class="text-[10px] text-zinc-500 leading-snug">{m.desc}</div>
            </div>
          </label>
        ))}
      </div>
    </>
  );
}

export function showMergePartsModal(opts: MergePartsOptions): Promise<MergeChoice | null> {
  return new Promise(resolve => {
    let result: MergeChoice | null = null;
    const selected = signal<MergeMode>('new');

    mountPreactModal(
      {
        title: 'Merge parts',
        onClose: () => resolve(result),
      },
      close => ({
        body: <MergeBody partNames={opts.partNames} selected={selected} />,
        footer: (
          <>
            <button
              type="button"
              class={BUTTON_CANCEL}
              onClick={() => { result = null; close(); }}
            >Cancel</button>
            <button
              type="button"
              class={BUTTON_PRIMARY}
              data-action="merge"
              onClick={() => { result = { mode: selected.value }; close(); }}
            >Merge</button>
          </>
        ),
      }),
    );
  });
}
