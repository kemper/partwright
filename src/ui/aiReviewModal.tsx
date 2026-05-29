// Review modal: pick a DIFFERENT provider/model than the one currently
// driving the chat, optionally type a focus prompt, and fire a one-shot
// review of the current session state. Defaults to the first connected
// provider that isn't the active one so the most common flow ("Claude
// is driving — get a second opinion from GPT/Gemini") is one click away.

import { signal, type Signal } from '@preact/signals';
import { useEffect } from 'preact/hooks';
import { gatherReviewContext, runReview, type ReviewContext } from '../ai/review';
import { ANTHROPIC_MODEL_OPTIONS, OPENAI_MODEL_OPTIONS, GEMINI_MODEL_OPTIONS, providerLabel, loadSettings } from '../ai/settings';
import { getKey } from '../ai/db';
import { formatUsd, estimateTurnCostUsd } from '../ai/cost';
import { showAiKeyModal } from './aiKeyModal';
import { showAiLocalModal } from './aiLocalModal';
import { showAiSettingsModal } from './aiSettingsModal';
import { mountPreactModal } from './preact/mount';
import { isModelLoaded, resolveLocalModel } from '../ai/local';
import type { ChatMessage, Provider } from '../ai/types';

export interface ReviewModalCallbacks {
  /** Provider currently driving the chat — used to pre-pick a DIFFERENT
   *  reviewer ("second opinion" makes no sense if both are the same). */
  activeProvider: Provider;
  /** Active sessionId, so the persisted review block lands in the right
   *  transcript. */
  sessionId: string;
  /** Called once a review completes successfully. The chat panel uses
   *  this to refresh its in-memory history and re-render. */
  onReviewPosted: (msg: ChatMessage) => void;
}

const HOSTED_PROVIDERS: Provider[] = ['anthropic', 'openai', 'gemini', 'custom'];
const ALL_PROVIDERS: Provider[] = ['anthropic', 'openai', 'gemini', 'custom', 'local'];

interface ReviewState {
  provider: Provider;
  model: string;
  focus: string;
  context: ReviewContext | null;
  contextError: string | null;
  runError: string | null;
  noKeyForProvider: Provider | null;
  running: boolean;
  availability: Record<Provider, boolean>;
}

function modelOptionsFor(p: Provider): { id: string; label: string }[] {
  switch (p) {
    case 'anthropic': return ANTHROPIC_MODEL_OPTIONS;
    case 'openai': return OPENAI_MODEL_OPTIONS;
    case 'gemini': return GEMINI_MODEL_OPTIONS;
    // Custom endpoints have no curated catalog — the configured model is
    // surfaced via the "(custom)" fallback option in the picker.
    case 'custom': return [];
    case 'local': return [];
  }
}

function defaultModelFor(p: Provider): string {
  const settings = loadSettings();
  switch (p) {
    case 'anthropic': return settings.toggles.anthropicModel;
    case 'openai': return settings.toggles.openaiModel;
    case 'gemini': return settings.toggles.geminiModel;
    case 'custom': return settings.toggles.customModel;
    case 'local': return settings.toggles.localModel ?? '';
  }
}

function ReviewerPicker(props: { state: Signal<ReviewState> }) {
  const { state } = props;
  const p = state.value.provider;

  const localModel = loadSettings().toggles.localModel;
  let localChipLabel = 'Pick local model';
  if (p === 'local' && localModel) {
    try {
      const info = resolveLocalModel(localModel);
      localChipLabel = `${info.label}${isModelLoaded(info.id) ? ' (in GPU)' : ' (not loaded)'}`;
    } catch { /* fall through */ }
  }

  return (
    <div class="flex flex-col gap-2">
      <div class="text-xs uppercase tracking-wider text-zinc-500 font-semibold">Reviewer</div>
      <div class="flex items-center gap-2">
        <select
          class="px-2 py-1 rounded text-xs bg-zinc-900 border border-zinc-600 text-zinc-100"
          value={p}
          onChange={e => {
            const next = (e.currentTarget as HTMLSelectElement).value as Provider;
            state.value = { ...state.value, provider: next, model: defaultModelFor(next) };
          }}
        >
          {ALL_PROVIDERS.map(pp => (
            <option key={pp} value={pp}>
              {providerLabel(pp)}{state.value.availability[pp] ? '' : ' (not ready)'}
            </option>
          ))}
        </select>
        {p === 'local' ? (
          <button
            type="button"
            class="flex-1 px-2 py-1 rounded text-xs bg-emerald-900/30 border border-emerald-700/50 text-emerald-200 hover:bg-emerald-900/50 text-left"
            onClick={() => {
              void showAiLocalModal({
                onChange: () => {
                  // Re-read so the chip label and the active model id reflect the pick.
                  state.value = { ...state.value, model: defaultModelFor('local') };
                },
              });
            }}
          >{localChipLabel}</button>
        ) : (
          <select
            class="px-2 py-1 rounded text-xs bg-zinc-900 border border-zinc-600 text-zinc-100 flex-1"
            value={state.value.model}
            onChange={e => {
              state.value = { ...state.value, model: (e.currentTarget as HTMLSelectElement).value };
            }}
          >
            {modelOptionsFor(p).map(opt => (
              <option key={opt.id} value={opt.id}>{opt.label}</option>
            ))}
            {/* Custom-id fallback: if the user pinned an id (via Settings →
                "Use id") that isn't in the curated options, surface it as
                a final selectable option labelled "(custom)" so the
                dropdown's visible value doesn't silently diverge from
                state.value.model. */}
            {state.value.model && !modelOptionsFor(p).some(o => o.id === state.value.model) && (
              <option key="custom" value={state.value.model}>{state.value.model} (custom)</option>
            )}
          </select>
        )}
      </div>
    </div>
  );
}

function ContextPreview(props: { context: ReviewContext | null; contextError: string | null }) {
  const { context, contextError } = props;
  if (contextError) {
    return <p class="text-amber-400">Couldn't gather context: {contextError}</p>;
  }
  if (!context) {
    return <p class="text-zinc-500">Capturing snapshot + gathering context...</p>;
  }
  const Item = (p: { label: string; detail: string }) => (
    <div class="flex items-start gap-2">
      <span class="mt-0.5 inline-block w-1.5 h-1.5 rounded-full bg-emerald-400" />
      <span>
        <span class="text-zinc-100">{p.label}</span>{' '}
        <span class="text-zinc-500">{p.detail}</span>
      </span>
    </div>
  );
  return (
    <>
      <Item label="Current code" detail={`${context.language} · ${context.code.length} chars`} />
      <Item
        label="Geometry stats"
        detail={context.geometryStats === '(no current geometry)' ? '(none — code not run)' : 'volume / surfaceArea / triangle count / bounding box'}
      />
      <Item label="Session notes" detail={`${context.notes.length} note(s)`} />
      <Item label="Snapshot" detail={context.snapshot ? '4-iso composite PNG (~1500 tokens)' : '— no rendered geometry yet'} />
    </>
  );
}

function ReviewBody(props: { state: Signal<ReviewState> }) {
  const { state } = props;

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const ctx = await gatherReviewContext();
        if (!cancelled) state.value = { ...state.value, context: ctx };
      } catch (err) {
        if (!cancelled) state.value = { ...state.value, contextError: err instanceof Error ? err.message : String(err) };
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const { context, contextError, focus, provider, model, runError, noKeyForProvider, availability } = state.value;

  // Cost preview — same formula as the original. Reacts to provider/model/focus.
  let costText = '';
  if (model) {
    const codeChars = context?.code.length ?? 1500;
    const notesChars = context?.notes.join('\n').length ?? 0;
    const focusChars = focus.length;
    const tokens = Math.round((codeChars + notesChars + focusChars + 800) / 4) + (context?.snapshot ? 1500 : 0);
    const est = estimateTurnCostUsd(provider, model, 0, tokens, 200);
    costText = (provider === 'local' || provider === 'custom')
      ? 'Self-hosted model: free at the API level.'
      : `Estimated cost: ~${formatUsd(est)}`;
  }

  return (
    <>
      <p class="text-xs text-zinc-400 leading-snug">
        Send the current code, geometry stats, session notes, and a 4-iso render to another model for review. Pick a different provider than the one driving the chat for a fresh perspective.
      </p>
      <ReviewerPicker state={state} />
      <label class="flex flex-col gap-1">
        <span class="text-xs uppercase tracking-wider text-zinc-500 font-semibold">Focus (optional)</span>
        <textarea
          rows={2}
          placeholder={'e.g. "Is the wall thickness print-safe?" or "Does the handle attach in a sensible spot?"'}
          class="w-full px-2 py-1.5 rounded bg-zinc-900 border border-zinc-600 text-zinc-100 text-xs placeholder:text-zinc-500 resize-y"
          value={focus}
          onInput={e => { state.value = { ...state.value, focus: (e.currentTarget as HTMLTextAreaElement).value }; }}
        />
      </label>
      <div class="text-xs uppercase tracking-wider text-zinc-500 font-semibold">Reviewer will see</div>
      <div class="flex flex-col gap-2 text-xs text-zinc-300">
        <ContextPreview context={context} contextError={contextError} />
      </div>
      {runError && <div class="text-xs text-red-400">{runError}</div>}
      {noKeyForProvider && (
        <div class="text-xs text-amber-400 flex items-center gap-2">
          <span>{noKeyForProvider === 'custom' ? "Custom endpoint isn't configured. " : `No key for ${providerLabel(noKeyForProvider)}. `}</span>
          <button
            type="button"
            class="underline text-amber-200 hover:text-amber-100"
            onClick={() => {
              if (noKeyForProvider === 'custom') {
                // Custom is configured in the settings modal, not the key modal.
                void showAiSettingsModal({
                  onChange: () => {
                    const s = loadSettings();
                    const ok = s.toggles.customBaseUrl.trim().length > 0 && s.toggles.customModel.trim().length > 0;
                    const nextAvail: Record<Provider, boolean> = { ...availability, custom: ok };
                    state.value = { ...state.value, noKeyForProvider: ok ? null : noKeyForProvider, availability: nextAvail, model: defaultModelFor('custom') };
                  },
                }, { initialTab: 'custom' });
                return;
              }
              void showAiKeyModal({
                provider: noKeyForProvider,
                onConnected: () => {
                  const nextAvail: Record<Provider, boolean> = { ...availability, [noKeyForProvider]: true };
                  state.value = { ...state.value, noKeyForProvider: null, availability: nextAvail };
                },
              });
            }}
          >{noKeyForProvider === 'custom' ? 'Configure' : 'Connect now'}</button>
        </div>
      )}
      <p class="text-[10px] text-zinc-500">{costText}</p>
    </>
  );
}

function ReviewFooter(props: {
  state: Signal<ReviewState>;
  cb: ReviewModalCallbacks;
  close: () => void;
}) {
  const { state, cb, close } = props;

  async function runIt() {
    const { provider, model, focus, context, availability } = state.value;
    if (!model) {
      const msg = provider === 'local' ? 'Pick a local model first (above).' : 'Pick a model from the dropdown.';
      state.value = { ...state.value, runError: msg };
      return;
    }
    if (provider !== 'local' && !availability[provider]) {
      state.value = { ...state.value, noKeyForProvider: provider };
      return;
    }
    if (!context) return;
    state.value = { ...state.value, running: true, runError: null };
    try {
      const result = await runReview({
        provider,
        model,
        context: { ...context, focus: focus.trim() || undefined },
        sessionId: cb.sessionId,
      });
      cb.onReviewPosted(result.message);
      close();
    } catch (err) {
      state.value = {
        ...state.value,
        running: false,
        runError: `Review failed: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  return (
    <>
      <button
        type="button"
        class="px-3 py-1.5 rounded text-xs text-zinc-300 hover:bg-zinc-700"
        onClick={close}
      >Cancel</button>
      <button
        type="button"
        class="px-3 py-1.5 rounded text-xs font-medium bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-50 disabled:cursor-not-allowed"
        disabled={state.value.running || !!state.value.contextError}
        onClick={() => { void runIt(); }}
      >{state.value.running ? 'Sending...' : 'Run review'}</button>
    </>
  );
}

export async function showAiReviewModal(cb: ReviewModalCallbacks): Promise<void> {
  const settings = loadSettings();
  const availability: Record<Provider, boolean> = {
    anthropic: !!(await getKey('anthropic')),
    openai: !!(await getKey('openai')),
    gemini: !!(await getKey('gemini')),
    // Custom is "available" as a reviewer once both its endpoint URL and a
    // model id are set (the API key is optional).
    custom: settings.toggles.customBaseUrl.trim().length > 0 && settings.toggles.customModel.trim().length > 0,
    local: !!settings.toggles.localModel,
  };
  const defaultProvider: Provider =
    HOSTED_PROVIDERS.find(p => p !== cb.activeProvider && availability[p])
      ?? HOSTED_PROVIDERS.find(p => availability[p])
      ?? cb.activeProvider;

  const state = signal<ReviewState>({
    provider: defaultProvider,
    model: defaultModelFor(defaultProvider),
    focus: '',
    context: null,
    contextError: null,
    runError: null,
    noKeyForProvider: null,
    running: false,
    availability,
  });

  mountPreactModal(
    { title: 'Get a second opinion', maxWidth: 'lg', scrollable: true },
    close => ({
      body: <ReviewBody state={state} />,
      footer: <ReviewFooter state={state} cb={cb} close={close} />,
    }),
    { bodyClassPatches: [['gap-3', 'gap-4']] },
  );
}
