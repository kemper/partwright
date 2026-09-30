// Reviewer-prompt editor — the review-side twin of aiSystemPromptModal.
//
// Shows the rubric every review (manual 👁 and automatic 🔍) is sent with,
// lets the user replace it, and shows the fixed output contract that is
// always appended (read-only: the automatic loop parses its verdict line).
// Saving text identical to the default clears the override, so a later
// improvement to the built-in prompt reaches users who never customized it.

import { signal, type Signal } from '@preact/signals';
import { loadSettings, setReviewPromptOverride } from '../ai/settings';
import { DEFAULT_REVIEW_PROMPT, REVIEW_OUTPUT_CONTRACT } from '../ai/reviewPrompt';
import { mountPreactModal } from './preact/mount';
import { setSettings } from './preact/settingsStore';
import { BUTTON_CANCEL, BUTTON_PRIMARY, BUTTON_SMALL_SECONDARY } from './styleConstants';

export interface ReviewPromptModalCallbacks {
  onChange?: () => void;
}

function isDefault(text: string): boolean {
  return text.trim() === DEFAULT_REVIEW_PROMPT.trim();
}

function ReviewPromptBody(props: { text: Signal<string> }) {
  const { text } = props;
  const custom = !isDefault(text.value);
  const chars = text.value.length;
  return (
    <>
      <p class="text-zinc-300 leading-snug">
        The reviewer’s instructions, used by the 👁 Review button and by automatic reviews. Along with them, each review
        receives the request (automatic reviews) or your focus text (👁), the current code, geometry stats, session notes,
        a 4-view render and any reference images you attached — but none of the agent’s own reasoning.
      </p>
      <div class="flex items-center gap-2 text-xs">
        <span
          class={custom
            ? 'px-2 py-0.5 rounded bg-amber-900/40 text-amber-200 border border-amber-800/60'
            : 'px-2 py-0.5 rounded bg-blue-900/40 text-blue-200 border border-blue-800/60'}
          data-testid="review-prompt-state"
        >{custom ? 'Custom (override)' : 'Built-in default'}</span>
        <span class="text-zinc-500">· {chars.toLocaleString()} chars · ~{Math.round(chars / 4).toLocaleString()} tokens</span>
      </div>
      <textarea
        class="w-full min-h-[260px] max-h-[50vh] px-3 py-2 rounded bg-zinc-900 border border-zinc-600 text-zinc-100 text-xs font-mono leading-snug focus:outline-none focus:border-blue-500 resize-y"
        spellcheck={false}
        aria-label="Review prompt"
        data-testid="review-prompt-text"
        value={text.value}
        onInput={e => { text.value = (e.currentTarget as HTMLTextAreaElement).value; }}
      />
      <div class="flex flex-col gap-1">
        <div class="text-xs text-zinc-400">Always appended (not editable — the automatic review reads the verdict line to decide whether the agent gets a fix round)</div>
        <pre class="w-full px-3 py-2 rounded bg-zinc-900/60 border border-zinc-700 text-zinc-400 text-[11px] font-mono leading-snug whitespace-pre-wrap">{REVIEW_OUTPUT_CONTRACT}</pre>
      </div>
    </>
  );
}

export function showReviewPromptModal(cb: ReviewPromptModalCallbacks = {}): void {
  const text = signal(loadSettings().reviewPromptOverride ?? DEFAULT_REVIEW_PROMPT);
  mountPreactModal(
    { title: 'Review prompt', maxWidth: '2xl', scrollable: true },
    close => ({
      body: <ReviewPromptBody text={text} />,
      footer: (
        // Reset on the left, Cancel + Save on the right (the shell's footer
        // is justify-end; `mr-auto` pushes the reset button left).
        <>
          <button
            type="button"
            class={`mr-auto ${BUTTON_SMALL_SECONDARY}`}
            title="Replace the editor with the built-in review prompt. Saves nothing until you press Save."
            onClick={() => { text.value = DEFAULT_REVIEW_PROMPT; }}
          >Reset to default</button>
          <button type="button" class={BUTTON_CANCEL} onClick={close}>Cancel</button>
          <button
            type="button"
            class={BUTTON_PRIMARY}
            onClick={() => {
              const value = text.value;
              setSettings(setReviewPromptOverride(loadSettings(), isDefault(value) ? null : value));
              cb.onChange?.();
              close();
            }}
          >Save</button>
        </>
      ),
    }),
  );
}
