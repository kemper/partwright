// Prompt library modal — opened from the 💡 button in the AI panel header.
// Lists the prompt-bearing ideas (starter + technique) with a search box so a
// user who's staring at a blank chat input can find something to ask for.
// Picking one drops the prompt into the input (populate, don't send) and
// closes — the caller wires `onSelect`.

import { useSignal } from '@preact/signals';
import { IDEA_CATEGORIES, filterIdeas, promptIdeas, type Idea } from '../ideas/ideas';
import { mountPreactModal } from './preact/mount';

function PromptLibraryBody(props: { onPick: (idea: Idea) => void }) {
  const query = useSignal('');
  const all = promptIdeas();
  const visible = filterIdeas(all, query.value);

  // Group the visible ideas by category, preserving IDEA_CATEGORIES order.
  const groups = IDEA_CATEGORIES
    .map((cat) => ({ cat, items: visible.filter((i) => i.category === cat.id) }))
    .filter((g) => g.items.length > 0);

  return (
    <>
      <p class="text-xs text-zinc-400 leading-snug">
        Pick a prompt to drop into the chat box — then tweak it before you send. Not sure what’s possible? These cover a lot of ground.
      </p>
      <input
        type="text"
        autofocus
        placeholder="Search prompts (e.g. box, gear, voxel)…"
        class="w-full px-2.5 py-1.5 rounded text-xs bg-zinc-900 border border-zinc-600 text-zinc-100 placeholder-zinc-500"
        value={query.value}
        onInput={(e) => { query.value = (e.currentTarget as HTMLInputElement).value; }}
      />
      <div class="flex flex-col gap-3">
        {groups.length === 0
          ? <p class="text-zinc-500 text-xs italic">No prompts match “{query.value}”.</p>
          : groups.map((g) => (
              <div key={g.cat.id} class="flex flex-col gap-1.5">
                <div class="text-[10px] uppercase tracking-wider text-zinc-500">{g.cat.title}</div>
                {g.items.map((idea) => (
                  <button
                    key={idea.id}
                    type="button"
                    class="flex items-start gap-2.5 text-left px-2.5 py-2 rounded border border-zinc-700 bg-zinc-900/40 hover:border-zinc-500 hover:bg-zinc-800 transition-colors"
                    onClick={() => props.onPick(idea)}
                  >
                    <span class="text-lg leading-none mt-0.5">{idea.emoji}</span>
                    <span class="flex flex-col min-w-0">
                      <span class="text-xs font-medium text-zinc-100">{idea.title}</span>
                      <span class="text-[11px] text-zinc-400 leading-snug">{idea.prompt}</span>
                    </span>
                  </button>
                ))}
              </div>
            ))}
      </div>
    </>
  );
}

export function showAiPromptLibraryModal(opts: { onSelect: (idea: Idea) => void }): void {
  mountPreactModal(
    { title: 'Prompt library', maxWidth: 'lg', scrollable: true },
    (close) => ({
      body: <PromptLibraryBody onPick={(idea) => { opts.onSelect(idea); close(); }} />,
      footer: (
        <button
          type="button"
          class="px-3 py-1.5 rounded text-xs text-zinc-200 bg-zinc-700 hover:bg-zinc-600"
          onClick={close}
        >Done</button>
      ),
    }),
  );
}
