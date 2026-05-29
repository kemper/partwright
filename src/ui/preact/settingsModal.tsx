// AI Settings modal — Preact port of the original 842-line vanilla
// `aiSettingsModal.ts`. Same visible UI; the rewrite replaces:
//
//   - 40+ manual `replaceChildren()` re-render calls with reactive
//     subscriptions on the signal-backed settings store
//   - hand-rolled "rerender after async X" choreography (refreshEnableRow,
//     renderButtons, etc.) with normal effect-driven rendering
//   - copy-pasted markup for the 4 provider tabs with one `<TabContent>`
//     that switches on `provider`
//
// Strings anchored by the e2e suite (modal title, tab labels, "Connect
// Anthropic API" / "Connect OpenAI" / "Connect Google Gemini", "Done")
// are kept byte-identical.

import { useEffect, useRef } from 'preact/hooks';
import { signal, useSignal, type Signal } from '@preact/signals';

import { deleteKey, getKey } from '../../ai/db';
import { resetClient, listModels as listAnthropicModels } from '../../ai/anthropic';
import { resetClient as resetOpenaiClient, listModels as listOpenaiModels } from '../../ai/openai';
import { resetClient as resetGeminiClient, listModels as listGeminiModels } from '../../ai/gemini';
import { formatUsd } from '../../ai/cost';
import { providerKeyMeta, validateAndStoreKey, type HostedProvider } from '../aiKeyModal';
import { renderLocalPicker } from '../aiLocalModal';
import { showSystemPromptModal } from '../aiSystemPromptModal';
import {
  loadSettings,
  setAutoCompactMode,
  setLocalContext,
  setProvider,
  setAnthropicModel,
  setOpenaiModel,
  setGeminiModel,
  providerLabel,
  AUTO_COMPACT_OPTIONS,
  ANTHROPIC_MODEL_OPTIONS,
  OPENAI_MODEL_OPTIONS,
  GEMINI_MODEL_OPTIONS,
} from '../../ai/settings';
import { effectiveContextCeiling, resolveLocalModel, unloadActiveLocalModel } from '../../ai/local';
import { getCachedCeiling } from '../../ai/modelMetadata';
import type { AnthropicModelId, Provider } from '../../ai/types';

import { settingsSignal, setSettings, resyncSettings } from './settingsStore';
import { Divider, Section, Pill, PrimaryButton, SecondaryButton, TabBar, type TabSpec } from './primitives';

export interface AiSettingsCallbacks {
  onChange: () => void;
}

export interface AiSettingsOptions {
  initialTab?: Provider;
}

const TABS = [
  { id: 'anthropic' as const, label: 'Anthropic (cloud)' },
  { id: 'openai' as const, label: 'OpenAI (cloud)' },
  { id: 'gemini' as const, label: 'Gemini (cloud)' },
  { id: 'local' as const, label: 'Local (WebGPU)' },
];

/** Bumped after any key add/remove so EnableRow + KeySection re-fetch.
 *  Cheaper than threading a refresh callback through 4 component layers. */
const keyVersion = signal(0);
function bumpKeyVersion(): void { keyVersion.value = keyVersion.value + 1; }

export function SettingsModalBody(props: {
  cb: AiSettingsCallbacks;
  tab: Signal<Provider>;
  close: () => void;
}) {
  const { cb, tab, close } = props;
  const settings = settingsSignal.value;
  const activeProvider = settings.toggles.provider;

  const tabSpecs: TabSpec<Provider>[] = TABS.map(t => ({
    id: t.id,
    label: t.label,
    activeBadge: activeProvider === t.id,
  }));

  return (
    <>
      <TabBar tabs={tabSpecs} current={tab.value} onSelect={t => { tab.value = t; }} />
      <div class="flex flex-col gap-4">
        <EnableRow viewedTab={tab.value} cb={cb} />
        {tab.value === 'local'
          ? <LocalTab cb={cb} close={close} />
          : <HostedTab provider={tab.value} cb={cb} close={close} switchTab={t => { tab.value = t; }} />}
      </div>
      <Divider />
      <ApiTimeoutSection cb={cb} />
      <Divider />
      <AutoCompactSection cb={cb} />
    </>
  );
}

export function SettingsModalFooter(props: { close: () => void }) {
  return <SecondaryButton label="Done" onClick={props.close} />;
}

// === Enable row ===

function EnableRow(props: { viewedTab: Provider; cb: AiSettingsCallbacks }) {
  const { viewedTab, cb } = props;
  // null = "haven't checked yet" (e.g. just switched tabs and the
  // async getKey hasn't resolved). The button stays disabled in that
  // interim state so we never momentarily render an enabled Enable for
  // a provider whose key status is unknown.
  const hasKey = useSignal<boolean | null>(null);

  useEffect(() => {
    if (viewedTab === 'local') { hasKey.value = true; return; }
    let cancelled = false;
    hasKey.value = null;
    void getKey(viewedTab).then(k => { if (!cancelled) hasKey.value = !!k; });
    return () => { cancelled = true; };
  }, [viewedTab, keyVersion.value]);

  const settings = settingsSignal.value;
  const isActive = settings.toggles.provider === viewedTab;
  const label = providerLabel(viewedTab);
  const ready = hasKey.value === true;

  // For local, `hasKey` is forced true above, so the "Connect your … key"
  // branch never fires for local; that's why there's no local-specific
  // copy here.
  const subtitle = isActive
    ? 'Chat turns are sent to this provider.'
    : ready
      ? `Viewing settings only — click Enable to send chat turns through ${label}.`
      : `Connect your ${label} key below to enable it.`;

  return (
    <div class={'flex items-center justify-between gap-3 rounded border px-3 py-2 ' + (
      isActive
        ? 'bg-emerald-900/15 border-emerald-700/40'
        : 'bg-zinc-900 border-zinc-700'
    )}>
      <div class="flex flex-col gap-0.5 min-w-0">
        <div class={'text-xs font-medium ' + (isActive ? 'text-emerald-200' : 'text-zinc-200')}>
          {isActive ? `${label} is the active provider.` : `${label} is not active.`}
        </div>
        <div class="text-[11px] text-zinc-400">{subtitle}</div>
      </div>
      {!isActive && (
        <PrimaryButton
          label={`Enable ${label}`}
          disabled={!ready}
          title={ready
            ? `Switch the active provider to ${label}. You can switch back any time.`
            : `Connect your ${label} key before enabling it.`}
          onClick={() => {
            setSettings(setProvider(loadSettings(), viewedTab));
            cb.onChange();
          }}
        />
      )}
    </div>
  );
}

// === Hosted (cloud) tab ===

function HostedTab(props: {
  provider: HostedProvider;
  cb: AiSettingsCallbacks;
  close: () => void;
  switchTab: (t: Provider) => void;
}) {
  const { provider, cb, close, switchTab } = props;
  return (
    <>
      <HostedIntro provider={provider} />
      <Divider />
      <KeySection provider={provider} cb={cb} switchTab={switchTab} />
      <Divider />
      {provider === 'anthropic'
        ? <AnthropicModelSection cb={cb} />
        : <HostedModelSection provider={provider} cb={cb} />}
      <Divider />
      <SystemPromptSection provider={provider} close={close} cb={cb} />
    </>
  );
}

function HostedIntro(props: { provider: HostedProvider }) {
  const html = props.provider === 'anthropic'
    ? 'Sends chat turns to <strong>Anthropic\'s hosted Claude</strong> models. Higher quality, vision support, and full <code>ai.md</code> system prompt — but each turn costs a few cents charged to your Anthropic account. The API key is stored only in this browser and never sent to a Partwright server.'
    : props.provider === 'openai'
      ? 'Sends chat turns to <strong>OpenAI\'s hosted GPT / o-series</strong> models. Vision support and the full <code>ai.md</code> system prompt; each turn is billed to your OpenAI account. The API key is stored only in this browser and never sent to a Partwright server.'
      : 'Sends chat turns to <strong>Google\'s hosted Gemini</strong> models. Vision support and the full <code>ai.md</code> system prompt; each turn is billed to your Google AI account. The API key is stored only in this browser and never sent to a Partwright server.';
  return (
    <Section label="About">
      {/* eslint-disable-next-line react/no-danger */}
      <p class="text-[11px] text-zinc-300 leading-snug" dangerouslySetInnerHTML={{ __html: html }} />
    </Section>
  );
}

// === Key section ===

interface KeyRecordShape {
  apiKey: string;
  createdAt: number;
  lastUsed: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCostUsd: number;
}

function KeySection(props: {
  provider: HostedProvider;
  cb: AiSettingsCallbacks;
  switchTab: (t: Provider) => void;
}) {
  const { provider, cb, switchTab } = props;
  const key = useSignal<KeyRecordShape | null | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    key.value = undefined;
    void getKey(provider).then(k => { if (!cancelled) key.value = k ?? null; });
    return () => { cancelled = true; };
  }, [provider, keyVersion.value]);

  const label = providerLabel(provider);

  if (key.value === undefined) return <Section label={`${label} key`}><div class="text-[11px] text-zinc-500">Loading…</div></Section>;
  if (key.value === null) {
    return (
      <Section label={`${label} key`}>
        <KeyEntryForm provider={provider} cb={cb} switchTab={switchTab} />
      </Section>
    );
  }

  const k = key.value;
  return (
    <Section label={`${label} key`}>
      <KeyStatRow label="Key" value={`…${k.apiKey.slice(-4)}`} />
      <KeyStatRow label="Connected" value={new Date(k.createdAt).toLocaleString()} />
      <KeyStatRow label="Last used" value={new Date(k.lastUsed).toLocaleString()} />
      <KeyStatRow label="Input tokens" value={k.totalInputTokens.toLocaleString()} />
      <KeyStatRow label="Output tokens" value={k.totalOutputTokens.toLocaleString()} />
      <KeyStatRow label="Spent (estimated)" value={formatUsd(k.totalCostUsd)} />
      <p class="text-[11px] text-zinc-500 leading-snug">
        Estimated spend uses public list prices and may differ slightly from your {provider === 'anthropic' ? 'Anthropic' : 'provider'} invoice.
      </p>
      <button
        type="button"
        class="self-start text-[11px] text-red-300 hover:text-red-200 underline"
        title="Delete this key from the browser. Your chat history is kept; you can paste a new key any time."
        onClick={async () => {
          if (!confirm(`Remove your ${label} key? Your chat history is kept; only the key is removed.`)) return;
          await deleteKey(provider);
          resetClientFor(provider);
          cb.onChange();
          bumpKeyVersion();
        }}
      >
        Remove {label} key
      </button>
    </Section>
  );
}

function KeyStatRow(props: { label: string; value: string }) {
  return (
    <div class="flex justify-between gap-3 text-xs">
      <span class="text-zinc-400">{props.label}</span>
      <span class="text-zinc-100 font-mono">{props.value}</span>
    </div>
  );
}

function resetClientFor(provider: HostedProvider): void {
  if (provider === 'anthropic') resetClient();
  else if (provider === 'openai') resetOpenaiClient();
  else resetGeminiClient();
}

function connectButtonLabel(provider: HostedProvider): string {
  // Anchored by e2e tests — do not change.
  return provider === 'anthropic' ? 'Connect Anthropic API' : `Connect ${providerLabel(provider)}`;
}

function KeyEntryForm(props: {
  provider: HostedProvider;
  cb: AiSettingsCallbacks;
  switchTab: (t: Provider) => void;
}) {
  const { provider, cb, switchTab } = props;
  const meta = providerKeyMeta(provider);
  const value = useSignal('');
  const error = useSignal<string | null>(null);
  const validating = useSignal(false);

  async function attempt() {
    if (value.value.trim().length < 10) { error.value = 'That key looks too short.'; return; }
    error.value = null;
    validating.value = true;
    const err = await validateAndStoreKey(provider, value.value);
    validating.value = false;
    if (err) { error.value = err; return; }
    // validateAndStoreKey calls saveSettings() directly to promote the
    // just-connected provider to active — pull that change into the
    // signal so EnableRow's "isActive" + the TabBar's Active pill
    // both update without waiting for the next modal open.
    resyncSettings();
    cb.onChange();
    bumpKeyVersion();
  }

  return (
    <div class="flex flex-col gap-2">
      <a
        href={meta.consoleUrl}
        target="_blank"
        rel="noopener noreferrer"
        class="text-blue-400 hover:text-blue-300 underline text-[11px]"
      >{meta.consoleLabel}</a>
      <div
        class="rounded border border-amber-700/50 bg-amber-900/20 px-3 py-2 text-[11px] text-amber-200 leading-snug"
        dangerouslySetInnerHTML={{ __html: '<strong>Recommended:</strong> use a workspace-scoped key with a monthly spend cap. Anyone who can run code in this page (extensions, devtools) can read the key.' }}
      />
      <input
        type="password"
        placeholder={meta.placeholder}
        class="w-full px-3 py-2 rounded bg-zinc-900 border border-zinc-600 text-zinc-100 text-sm font-mono placeholder:text-zinc-600 focus:outline-none focus:border-blue-500"
        spellcheck={false}
        autocomplete="off"
        value={value.value}
        onInput={e => { value.value = (e.currentTarget as HTMLInputElement).value; }}
        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void attempt(); } }}
      />
      {error.value && <div class="text-[11px] text-red-400">{error.value}</div>}
      {validating.value && <div class="text-[11px] text-zinc-500">Sending a 1-token test request to verify the key…</div>}
      <PrimaryButton
        label={validating.value ? 'Validating…' : connectButtonLabel(provider)}
        disabled={validating.value}
        variant="column"
        onClick={() => { void attempt(); }}
      />
      <div class="text-[11px] text-zinc-400 leading-snug">
        Don’t want an API key?{' '}
        <button
          type="button"
          class="underline text-emerald-300 hover:text-emerald-200"
          onClick={() => switchTab('local')}
        >Run a local model in your browser</button>
        {' '}— free, runs on your GPU.
      </div>
    </div>
  );
}

// === Model section (Anthropic) ===

function AnthropicModelSection(props: { cb: AiSettingsCallbacks }) {
  const { cb } = props;
  const options = useSignal<{ id: string; label: string }[]>(ANTHROPIC_MODEL_OPTIONS);
  const current = settingsSignal.value.toggles.anthropicModel;
  const inList = options.value.some(o => o.id === current);

  return (
    <Section label="Default model">
      <div
        class="text-[11px] text-zinc-400 leading-snug"
        dangerouslySetInnerHTML={{ __html: 'Claude tier used for new turns. <strong>Haiku</strong> is fast and cheap; <strong>Sonnet</strong> is the balanced default; <strong>Opus</strong> is the smartest and most expensive. Click <strong>Load models from your key</strong> to pull your account\'s full current lineup with exact ids. You can also switch on the fly from the dropdown in the chat header.' }}
      />
      <div class="flex flex-wrap gap-1">
        {options.value.map(opt => (
          <Pill
            key={opt.id}
            active={current === opt.id}
            label={opt.label}
            onClick={() => { setSettings(setAnthropicModel(loadSettings(), opt.id as AnthropicModelId)); cb.onChange(); }}
          />
        ))}
        {!inList && current && <Pill key="custom" active={true} label={`${current} (custom)`} onClick={() => {}} />}
      </div>
      <LoadModelsRow provider="anthropic" onLoaded={live => { options.value = live; }} />
    </Section>
  );
}

// === Model section (OpenAI / Gemini) ===

type CloudPairProvider = 'openai' | 'gemini';

function HostedModelSection(props: { provider: CloudPairProvider; cb: AiSettingsCallbacks }) {
  const { provider, cb } = props;
  const defaults = provider === 'openai' ? OPENAI_MODEL_OPTIONS : GEMINI_MODEL_OPTIONS;
  const options = useSignal<{ id: string; label: string }[]>(defaults);
  const customId = useSignal('');

  const settings = settingsSignal.value;
  const current = provider === 'openai' ? settings.toggles.openaiModel : settings.toggles.geminiModel;
  const setModel = provider === 'openai' ? setOpenaiModel : setGeminiModel;
  const inList = options.value.some(o => o.id === current);

  const descHtml = provider === 'gemini'
    ? 'Model used for new turns. The starter list is the GA 2.5 family; click <strong>Load models from your key</strong> to pull your account\'s full current lineup (Gemini 3, Nano Banana, previews) with their exact ids. You can also switch on the fly from the chat header.'
    : 'Model used for new turns. The starter list is curated; click <strong>Load models from your key</strong> to pull your account\'s full current lineup with exact ids. You can also switch on the fly from the dropdown in the chat header.';

  return (
    <Section label="Default model">
      <div class="text-[11px] text-zinc-400 leading-snug" dangerouslySetInnerHTML={{ __html: descHtml }} />
      <div class="flex flex-wrap gap-1">
        {options.value.map(opt => (
          <Pill
            key={opt.id}
            active={current === opt.id}
            label={opt.label}
            onClick={() => { setSettings(setModel(loadSettings(), opt.id)); cb.onChange(); }}
          />
        ))}
        {!inList && current && <Pill key="custom" active={true} label={`${current} (custom)`} onClick={() => {}} />}
      </div>
      <LoadModelsRow provider={provider} onLoaded={live => { options.value = live; }} />
      <div class="flex items-center gap-2">
        <input
          type="text"
          placeholder={provider === 'openai' ? 'custom id, e.g. gpt-5-2026-09-15' : 'custom id, e.g. gemini-3-pro-preview-12-2025'}
          class="flex-1 px-2 py-1 rounded bg-zinc-900 border border-zinc-600 text-zinc-100 text-[11px] font-mono"
          value={customId.value}
          onInput={e => { customId.value = (e.currentTarget as HTMLInputElement).value; }}
        />
        <SecondaryButton
          label="Use id"
          size="sm"
          onClick={() => {
            const id = customId.value.trim();
            if (!id) return;
            setSettings(setModel(loadSettings(), id));
            customId.value = '';
            cb.onChange();
          }}
        />
      </div>
      <p class="text-[10px] text-zinc-500">
        Pricing for unknown ids falls back to median-tier rates — the cost meter will be approximate.
      </p>
    </Section>
  );
}

function LoadModelsRow(props: {
  provider: HostedProvider;
  onLoaded: (models: { id: string; label: string }[]) => void;
}) {
  const status = useSignal('');
  const busy = useSignal(false);

  const listFn = props.provider === 'anthropic'
    ? listAnthropicModels
    : props.provider === 'openai'
      ? listOpenaiModels
      : listGeminiModels;

  async function loadModels() {
    const key = await getKey(props.provider);
    if (!key) { status.value = `Connect your ${providerLabel(props.provider)} key first.`; return; }
    busy.value = true;
    status.value = 'Loading…';
    try {
      const live = await listFn(key.apiKey);
      if (live.length === 0) {
        status.value = 'No chat models returned for this key.';
      } else {
        props.onLoaded(live);
        status.value = `${live.length} model(s) loaded.`;
      }
    } catch (err) {
      status.value = err instanceof Error ? err.message : String(err);
    } finally {
      busy.value = false;
    }
  }

  return (
    <div class="flex items-center gap-2">
      <SecondaryButton label="Load models from your key" size="sm" disabled={busy.value} onClick={() => { void loadModels(); }} />
      <span class="text-[10px] text-zinc-500">{status.value}</span>
    </div>
  );
}

// === Local tab ===

function LocalTab(props: { cb: AiSettingsCallbacks; close: () => void }) {
  const { cb, close } = props;
  return (
    <>
      <LocalPickerEmbed cb={cb} />
      <Divider />
      <LocalContextSection cb={cb} />
      <Divider />
      <SystemPromptSection provider="local" close={close} cb={cb} />
    </>
  );
}

/** Hosts the existing vanilla-TS renderLocalPicker inside a Preact ref —
 *  the cohabitation seam. Picking a local model flips the active provider
 *  via the picker's own onChange; `resyncSettings()` pulls that write off
 *  disk into the signal so EnableRow's `isActive` flips immediately.
 *
 *  Cleanup: the picker mutates `ref.current` via `replaceChildren` +
 *  manual appends, and chains async work (cache scan, WebGPU probe,
 *  storage probe) that can outlive the modal. The `disposed` flag short-
 *  circuits the onChange callback so a late picker tick (e.g. switching
 *  tabs Local → Anthropic while the cache scan is still running) doesn't
 *  reach into the now-detached signal store. The ref's children are
 *  unmounted by Preact when the modal closes, so the picker's DOM is
 *  released; only the in-flight callbacks need explicit gating. */
function LocalPickerEmbed(props: { cb: AiSettingsCallbacks }) {
  const { cb } = props;
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!ref.current) return;
    let disposed = false;
    void renderLocalPicker(ref.current, {
      onChange: () => {
        if (disposed) return;
        cb.onChange();
        resyncSettings();
      },
    }, { embedded: true });
    return () => { disposed = true; };
  }, []);

  return <div ref={ref} class="flex flex-col gap-3" />;
}

function formatK(n: number): string {
  if (n >= 1024 && n % 1024 === 0) return `${n / 1024}K`;
  return n.toLocaleString();
}

function LocalContextSection(props: { cb: AiSettingsCallbacks }) {
  const { cb } = props;
  const settings = settingsSignal.value;

  let ceilingHint = '';
  if (settings.toggles.localModel) {
    try {
      const info = resolveLocalModel(settings.toggles.localModel);
      const fetched = getCachedCeiling(settings.toggles.localModel);
      const ceiling = effectiveContextCeiling(settings.toggles.localModel, info.contextWindowSize);
      ceilingHint = fetched !== null
        ? ` · ${formatK(ceiling)} ceiling for ${info.label} (confirmed)`
        : ` · ${formatK(ceiling)} requested for ${info.label} (real ceiling fetched on first load)`;
    } catch { /* stale id — skip ceiling hint */ }
  }

  return (
    <Section label="Local context">
      <div
        class="text-[11px] text-zinc-400 leading-snug"
        dangerouslySetInnerHTML={{ __html: 'We request <strong>32K tokens</strong> for most models at load time, and <strong>4K for the 70B</strong> (its KV cache is too expensive at higher windows). The actual ceiling is whatever the model\'s compiled WASM accepts — fetched once from its config and cached. Set an override below to clamp lower; the value we\'ll request is <code>min(your override, model default, WASM ceiling)</code>. If a load still fails we walk down 32K → 16K → 8K → 4K until one sticks.' }}
      />
      <label class="flex items-center gap-2 text-xs text-zinc-300">
        <span>Override window size:</span>
        <input
          type="number"
          step={1024}
          min={0}
          placeholder="auto"
          class="w-24 px-2 py-1 rounded bg-zinc-900 border border-zinc-600 text-zinc-100 text-xs focus:outline-none focus:border-blue-500"
          value={settings.localContext.windowSizeOverride === null ? '' : String(settings.localContext.windowSizeOverride)}
          onChange={e => {
            const raw = (e.currentTarget as HTMLInputElement).value;
            const v = parseInt(raw, 10);
            const next = Number.isFinite(v) && v > 0 ? v : null;
            setSettings(setLocalContext(loadSettings(), { windowSizeOverride: next }));
            void unloadActiveLocalModel();
            cb.onChange();
          }}
        />
        <span class="text-[10px] text-zinc-500">tokens · blank = per-model default{ceilingHint}</span>
      </label>
      <label class="flex items-start gap-2 text-xs text-zinc-300">
        <input
          type="checkbox"
          class="mt-0.5"
          checked={settings.localContext.sliding}
          onChange={e => {
            setSettings(setLocalContext(loadSettings(), { sliding: (e.currentTarget as HTMLInputElement).checked }));
            void unloadActiveLocalModel();
            cb.onChange();
          }}
        />
        <span dangerouslySetInnerHTML={{ __html: '<strong class="text-zinc-200">Sliding window mode.</strong> <span class="text-zinc-400">Old turns drop off silently as new ones arrive. Conversation never errors, but the model loses long-range coherence. Costs the same VRAM as a fixed window of the same size.</span>' }} />
      </label>
      {settings.localContext.sliding && (
        <div
          class="rounded border border-amber-700/40 bg-amber-900/15 px-3 py-2 text-[11px] text-amber-200 leading-snug"
          dangerouslySetInnerHTML={{ __html: '<strong>Heads up:</strong> sliding-window mode rolls off tokens without understanding our message structure. If the cut falls between a tool call and its result, the next turn can error. <strong>Auto-compaction</strong> (the section below) avoids this — prefer it for long sessions.' }}
        />
      )}
      <div class="text-[10px] text-zinc-500">
        Changing these unloads the GPU engine; the next message rebuilds it (cached weights survive — just a fast reload).
      </div>
    </Section>
  );
}

/** Request-timeout control. The stall watchdog (aiPanel getStallThresholdMs)
 *  aborts and auto-retries a turn after this many seconds with no streamed
 *  token — for every provider, cloud or local. Lives outside the per-provider
 *  tabs because it applies to all of them; folding it into the Local tab
 *  hides it from cloud users (which was a previous bug). */
function ApiTimeoutSection(props: { cb: AiSettingsCallbacks }) {
  const { cb } = props;
  const settings = settingsSignal.value;
  return (
    <Section label="Request timeout">
      <label class="flex items-center gap-2 text-xs text-zinc-300">
        <span>Timeout:</span>
        <input
          type="number"
          min={5}
          max={600}
          step={5}
          class="w-20 px-2 py-1 rounded bg-zinc-900 border border-zinc-600 text-zinc-100 text-xs focus:outline-none focus:border-blue-500"
          value={String(settings.localContext.stallTimeoutSec)}
          onChange={e => {
            const raw = (e.currentTarget as HTMLInputElement).value;
            const v = parseInt(raw, 10);
            const next = Number.isFinite(v) && v >= 5 ? v : 60;
            setSettings(setLocalContext(loadSettings(), { stallTimeoutSec: next }));
            cb.onChange();
          }}
        />
        <span class="text-[10px] text-zinc-500">
          seconds without a streamed token before the request aborts and auto-retries. Applies to every provider; raise to 120+ for large local models on slow hardware.
        </span>
      </label>
    </Section>
  );
}

// === Auto-compaction ===

function AutoCompactSection(props: { cb: AiSettingsCallbacks }) {
  const { cb } = props;
  const settings = settingsSignal.value;
  const activeHint = AUTO_COMPACT_OPTIONS.find(o => o.id === settings.autoCompactMode)?.hint ?? '';

  return (
    <Section label="Auto-compaction">
      <div
        class="text-[11px] text-zinc-400 leading-snug"
        dangerouslySetInnerHTML={{ __html: 'Condenses older turns into a one-paragraph summary so the conversation keeps fitting in context. Compaction itself runs through the active provider — local turns are free; Anthropic turns cost a tiny Haiku request each time. Insights get auto-promoted to the session\'s note log when applicable.' }}
      />
      <div class="flex flex-wrap gap-1">
        {AUTO_COMPACT_OPTIONS.map(opt => (
          <Pill
            key={opt.id}
            active={settings.autoCompactMode === opt.id}
            label={opt.label}
            title={opt.hint}
            onClick={() => { setSettings(setAutoCompactMode(loadSettings(), opt.id)); cb.onChange(); }}
          />
        ))}
      </div>
      <div class="text-[11px] text-zinc-500 leading-snug">{activeHint}</div>
    </Section>
  );
}

// === System prompt section ===

function SystemPromptSection(props: { provider: Provider; close: () => void; cb: AiSettingsCallbacks }) {
  const { provider, close, cb } = props;
  const settings = settingsSignal.value;
  const override = settings.systemPromptOverrides?.[provider] ?? null;

  const html = provider === 'local'
    ? (override !== null
      ? '<strong>Custom prompt active</strong> — your override is sent to local models instead of the built-in tier.'
      : '<strong>Built-in</strong> — a compact prompt tuned for local models, with the <code>readDoc</code> tool to pull in detailed subdocs on demand. The exact tier (Slim ~700 tok / Medium ~1.1K tok) depends on the active model; click to view or pin a different tier.')
    : (override !== null
      ? '<strong>Custom prompt active</strong> — your override is sent to Claude instead of the full <code>ai.md</code>.'
      : '<strong>Built-in</strong> — the full <code>public/ai.md</code> (~12.5K tokens) cached on Anthropic\'s side. Subdocs are fetched on demand via the <code>readDoc</code> tool.');

  return (
    <Section label="System prompt">
      <div class="text-[11px] text-zinc-400 leading-snug" dangerouslySetInnerHTML={{ __html: html }} />
      <SecondaryButton
        label={override !== null ? 'Edit / reset prompt' : 'View / edit prompt'}
        selfStart={true}
        onClick={() => {
          close();
          void showSystemPromptModal(provider, { onChange: cb.onChange });
        }}
      />
    </Section>
  );
}
