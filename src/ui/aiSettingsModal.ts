// AI Settings modal — tabbed by provider. Clicking a tab previews that
// provider's settings; the user must click "Enable" to actually switch
// the active provider. Auto-compaction is provider-agnostic and shown
// once at the bottom.

import { deleteKey, getKey } from '../ai/db';
import { resetClient, listModels as listAnthropicModels } from '../ai/anthropic';
import { resetClient as resetOpenaiClient, listModels as listOpenaiModels } from '../ai/openai';
import { resetClient as resetGeminiClient, listModels as listGeminiModels } from '../ai/gemini';
import { formatUsd } from '../ai/cost';
import { showAiKeyModal } from './aiKeyModal';
import { showAiLocalModal } from './aiLocalModal';
import { showSystemPromptModal } from './aiSystemPromptModal';
import { createModalShell } from './modalShell';
import {
  loadSettings,
  saveSettings,
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
} from '../ai/settings';
import { effectiveContextCeiling, resolveLocalModel, isModelLoaded, unloadActiveLocalModel } from '../ai/local';
import { getCachedCeiling } from '../ai/modelMetadata';
import type { AnthropicModelId, Provider } from '../ai/types';

export interface AiSettingsCallbacks {
  onChange: () => void;
}

export interface AiSettingsOptions {
  /** Tab to show first. Defaults to the active provider. */
  initialTab?: Provider;
}

export async function showAiSettingsModal(cb: AiSettingsCallbacks, opts: AiSettingsOptions = {}): Promise<void> {
  const shell = createModalShell({ title: 'AI Settings', scrollable: true });
  shell.body.classList.remove('gap-3');
  shell.body.classList.add('gap-4');

  let viewedTab: Provider = opts.initialTab ?? loadSettings().toggles.provider;

  const rerender = async (): Promise<void> => {
    shell.body.replaceChildren();
    shell.footer.replaceChildren();
    const tabBar = buildTabBar(viewedTab, tab => {
      viewedTab = tab;
      void rerender();
    });
    shell.body.appendChild(tabBar);
    const tabContent = document.createElement('div');
    tabContent.className = 'flex flex-col gap-4';
    shell.body.appendChild(tabContent);
    await renderTabContent(viewedTab, tabContent, shell.footer, shell.close, cb, () => { void rerender(); });
    shell.body.appendChild(makeDivider());
    shell.body.appendChild(buildAutoCompactSection(cb, () => { void rerender(); }));
  };

  await rerender();
}

function makeDivider(): HTMLElement {
  const hr = document.createElement('hr');
  hr.className = 'border-zinc-700';
  return hr;
}

function buildTabBar(viewedTab: Provider, onSwitch: (tab: Provider) => void): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'flex border-b border-zinc-700 -mx-1 -mt-1';

  const settings = loadSettings();
  const activeProvider = settings.toggles.provider;

  const mkTab = (id: Provider, text: string) => {
    const btn = document.createElement('button');
    const isViewed = viewedTab === id;
    const isActive = activeProvider === id;
    btn.className = isViewed
      ? 'px-4 py-2 text-xs font-medium text-zinc-100 border-b-2 border-blue-500 -mb-px'
      : 'px-4 py-2 text-xs text-zinc-400 hover:text-zinc-200 border-b-2 border-transparent';
    btn.textContent = text;
    if (isActive) {
      const pill = document.createElement('span');
      pill.className = 'ml-2 inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] uppercase tracking-wide bg-emerald-900/40 text-emerald-300 border border-emerald-700/50';
      const dot = document.createElement('span');
      dot.className = 'w-1 h-1 rounded-full bg-emerald-400';
      pill.appendChild(dot);
      pill.appendChild(document.createTextNode('Active'));
      btn.appendChild(pill);
    }
    btn.addEventListener('click', () => onSwitch(id));
    wrap.appendChild(btn);
  };

  mkTab('anthropic', 'Anthropic (cloud)');
  mkTab('openai', 'OpenAI (cloud)');
  mkTab('gemini', 'Gemini (cloud)');
  mkTab('local', 'Local (WebGPU)');
  return wrap;
}

async function renderTabContent(
  viewedTab: Provider,
  container: HTMLElement,
  footer: HTMLElement,
  close: () => void,
  cb: AiSettingsCallbacks,
  rerender: () => void,
): Promise<void> {
  container.appendChild(await buildEnableRow(viewedTab, cb, rerender));

  if (viewedTab === 'anthropic') {
    container.appendChild(buildAnthropicIntro());
    container.appendChild(makeDivider());
    await buildAnthropicKeySection(close, footer, container, cb);
    container.appendChild(makeDivider());
    container.appendChild(buildAnthropicModelSection(cb));
    container.appendChild(makeDivider());
    container.appendChild(buildSystemPromptSection('anthropic', close, cb));
  } else if (viewedTab === 'openai' || viewedTab === 'gemini') {
    container.appendChild(buildHostedIntro(viewedTab));
    container.appendChild(makeDivider());
    await buildHostedKeySection(viewedTab, close, footer, container, cb);
    container.appendChild(makeDivider());
    container.appendChild(buildHostedModelSection(viewedTab, cb));
    container.appendChild(makeDivider());
    container.appendChild(buildSystemPromptSection(viewedTab, close, cb));
  } else {
    container.appendChild(buildLocalIntro());
    container.appendChild(makeDivider());
    container.appendChild(buildLocalSection(close, cb));
    container.appendChild(makeDivider());
    container.appendChild(buildLocalContextSection(cb));
    container.appendChild(makeDivider());
    container.appendChild(buildSystemPromptSection('local', close, cb));
  }
}

/** Row beneath the tab strip that surfaces whether the viewed provider is
 *  the active one — and, when it isn't, the "Enable" button that actually
 *  switches. Making this a deliberate click step fixes the prior bug where
 *  users couldn't tell that tab clicks already changed the provider.
 *
 *  A hosted provider can't be enabled until its key is connected (you'd just
 *  switch to a provider that 401s on the first turn), so the button stays
 *  disabled until then. Local needs no key, so it's always enabled. */
async function buildEnableRow(viewedTab: Provider, cb: AiSettingsCallbacks, rerender: () => void): Promise<HTMLElement> {
  const settings = loadSettings();
  const activeProvider = settings.toggles.provider;
  const isActive = activeProvider === viewedTab;
  const otherLabel = providerLabel(viewedTab);
  const needsKey = viewedTab !== 'local';
  const hasKey = needsKey ? !!(await getKey(viewedTab)) : true;

  const wrap = document.createElement('div');
  wrap.className = 'flex items-center justify-between gap-3 rounded border px-3 py-2 ' + (
    isActive
      ? 'bg-emerald-900/15 border-emerald-700/40'
      : 'bg-zinc-900 border-zinc-700'
  );

  const left = document.createElement('div');
  left.className = 'flex flex-col gap-0.5 min-w-0';
  const title = document.createElement('div');
  title.className = 'text-xs font-medium ' + (isActive ? 'text-emerald-200' : 'text-zinc-200');
  title.textContent = isActive ? `${otherLabel} is the active provider.` : `${otherLabel} is not active.`;
  left.appendChild(title);
  const sub = document.createElement('div');
  sub.className = 'text-[11px] text-zinc-400';
  sub.textContent = isActive
    ? 'Chat turns are sent to this provider.'
    : hasKey
      ? `Viewing settings only — click Enable to send chat turns through ${otherLabel}.`
      : `Connect your ${otherLabel} key below to enable it.`;
  left.appendChild(sub);
  wrap.appendChild(left);

  if (!isActive) {
    const btn = document.createElement('button');
    btn.className = hasKey
      ? 'shrink-0 px-3 py-1.5 rounded text-xs font-medium bg-blue-600 hover:bg-blue-500 text-white'
      : 'shrink-0 px-3 py-1.5 rounded text-xs font-medium bg-zinc-700 text-zinc-500 cursor-not-allowed';
    btn.textContent = `Enable ${otherLabel}`;
    btn.disabled = !hasKey;
    btn.title = hasKey
      ? `Switch the active provider to ${otherLabel}. You can switch back any time.`
      : `Connect your ${otherLabel} key before enabling it.`;
    if (hasKey) {
      btn.addEventListener('click', () => {
        saveSettings(setProvider(loadSettings(), viewedTab));
        cb.onChange();
        // Re-render the modal in place so the Active pill lands on the
        // right tab and the Enable row flips to its "active" state.
        rerender();
      });
    }
    wrap.appendChild(btn);
  }
  return wrap;
}

function buildAnthropicIntro(): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'flex flex-col gap-2';
  const head = document.createElement('div');
  head.className = 'text-xs text-zinc-400';
  head.textContent = 'About';
  wrap.appendChild(head);
  const body = document.createElement('p');
  body.className = 'text-[11px] text-zinc-300 leading-snug';
  body.innerHTML = 'Sends chat turns to <strong>Anthropic\'s hosted Claude</strong> models. Higher quality, vision support, and full <code>ai.md</code> system prompt — but each turn costs a few cents charged to your Anthropic account. The API key is stored only in this browser and never sent to a Partwright server.';
  wrap.appendChild(body);
  return wrap;
}

function buildLocalIntro(): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'flex flex-col gap-2';
  const head = document.createElement('div');
  head.className = 'text-xs text-zinc-400';
  head.textContent = 'About';
  wrap.appendChild(head);
  const body = document.createElement('p');
  body.className = 'text-[11px] text-zinc-300 leading-snug';
  body.innerHTML = 'Runs a <strong>WebLLM model entirely in this browser</strong> on your GPU. No API key, no per-turn cost, no network traffic after the one-time weight download — but quality is noticeably lower than Claude, and you\'ll need a few GB of GPU memory. Best on Chrome / Edge / Safari 26+ on a recent discrete GPU.';
  wrap.appendChild(body);
  return wrap;
}

/** "Load models from your key" button shared by all three hosted providers.
 *  Calls the provider's list endpoint and hands the live list to `onLoaded`
 *  so the caller can swap its option buttons. Reports counts / errors inline
 *  (no modal). Model ids rev fast and a hard-coded list goes stale, so this
 *  is the reliable way to surface the account's current lineup with exact
 *  ids (new GPT / o-series snapshots, Gemini 3 / Nano Banana, dated Claude
 *  snapshots) that aren't in the curated starter lists yet. */
function buildLoadModelsRow(
  provider: Exclude<Provider, 'local'>,
  onLoaded: (models: { id: string; label: string }[]) => void,
): HTMLElement {
  const listModels = provider === 'anthropic'
    ? listAnthropicModels
    : provider === 'openai'
      ? listOpenaiModels
      : listGeminiModels;
  const row = document.createElement('div');
  row.className = 'flex items-center gap-2';
  const btn = document.createElement('button');
  btn.className = 'px-2 py-1 rounded text-[11px] text-zinc-200 bg-zinc-700 hover:bg-zinc-600';
  btn.textContent = 'Load models from your key';
  const status = document.createElement('span');
  status.className = 'text-[10px] text-zinc-500';
  btn.addEventListener('click', async () => {
    const key = await getKey(provider);
    if (!key) { status.textContent = `Connect your ${providerLabel(provider)} key first.`; return; }
    btn.disabled = true;
    status.textContent = 'Loading…';
    try {
      const live = await listModels(key.apiKey);
      if (live.length === 0) {
        status.textContent = 'No chat models returned for this key.';
      } else {
        onLoaded(live);
        status.textContent = `${live.length} model(s) loaded.`;
      }
    } catch (err) {
      status.textContent = err instanceof Error ? err.message : String(err);
    } finally {
      btn.disabled = false;
    }
  });
  row.appendChild(btn);
  row.appendChild(status);
  return row;
}

/** Default Anthropic model picker. The toggle-strip chip in the panel
 *  header drives the same setting; surfacing it here makes "change my
 *  default model" findable in the Settings dialog where users look. */
function buildAnthropicModelSection(cb: AiSettingsCallbacks): HTMLElement {
  // Starts from the curated tiers; "Load models from your key" can replace
  // it with the account's real lineup (incl. dated snapshots).
  let optionList: { id: string; label: string }[] = ANTHROPIC_MODEL_OPTIONS;

  const wrap = document.createElement('div');
  wrap.className = 'flex flex-col gap-2';
  const head = document.createElement('div');
  head.className = 'text-xs text-zinc-400';
  head.textContent = 'Default model';
  wrap.appendChild(head);

  const desc = document.createElement('div');
  desc.className = 'text-[11px] text-zinc-400 leading-snug';
  desc.innerHTML = 'Claude tier used for new turns. <strong>Haiku</strong> is fast and cheap; <strong>Sonnet</strong> is the balanced default; <strong>Opus</strong> is the smartest and most expensive. Click <strong>Load models from your key</strong> to pull your account\'s full current lineup with exact ids. You can also switch on the fly from the dropdown in the chat header.';
  wrap.appendChild(desc);

  const seg = document.createElement('div');
  seg.className = 'flex flex-wrap gap-1';
  const renderButtons = () => {
    seg.replaceChildren();
    const current = loadSettings().toggles.anthropicModel;
    let matched = false;
    for (const opt of optionList) {
      const b = document.createElement('button');
      const active = current === opt.id;
      if (active) matched = true;
      b.className = active
        ? 'px-2 py-1 rounded text-[11px] bg-zinc-700 text-zinc-100 border border-zinc-600'
        : 'px-2 py-1 rounded text-[11px] text-zinc-300 border border-zinc-700 hover:bg-zinc-700/60';
      b.textContent = opt.label;
      b.addEventListener('click', () => {
        saveSettings(setAnthropicModel(loadSettings(), opt.id as AnthropicModelId));
        cb.onChange();
        renderButtons();
      });
      seg.appendChild(b);
    }
    // Surface a selected id that isn't in the current list (e.g. a loaded
    // dated snapshot picked on a previous open) as a selected pill.
    if (!matched && current) {
      const b = document.createElement('button');
      b.className = 'px-2 py-1 rounded text-[11px] bg-zinc-700 text-zinc-100 border border-zinc-600';
      b.textContent = `${current} (custom)`;
      seg.appendChild(b);
    }
  };
  renderButtons();
  wrap.appendChild(seg);

  wrap.appendChild(buildLoadModelsRow('anthropic', live => {
    optionList = live;
    renderButtons();
  }));

  return wrap;
}

// === OpenAI / Gemini tabs ===
// These two hosted providers share one set of builders (they differ only
// in copy, model list, and which setter/resetClient to call). Anthropic
// keeps its own bespoke builders above because its key section predates
// this and the smoke test anchors on its exact "Connect Anthropic API"
// string.

type HostedProvider = 'openai' | 'gemini';

function hostedConsoleUrl(provider: HostedProvider): { url: string; label: string } {
  return provider === 'openai'
    ? { url: 'https://platform.openai.com/api-keys', label: 'platform.openai.com' }
    : { url: 'https://aistudio.google.com/app/apikey', label: 'aistudio.google.com' };
}

function buildHostedIntro(provider: HostedProvider): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'flex flex-col gap-2';
  const head = document.createElement('div');
  head.className = 'text-xs text-zinc-400';
  head.textContent = 'About';
  wrap.appendChild(head);
  const body = document.createElement('p');
  body.className = 'text-[11px] text-zinc-300 leading-snug';
  body.innerHTML = provider === 'openai'
    ? 'Sends chat turns to <strong>OpenAI\'s hosted GPT / o-series</strong> models. Vision support and the full <code>ai.md</code> system prompt; each turn is billed to your OpenAI account. The API key is stored only in this browser and never sent to a Partwright server.'
    : 'Sends chat turns to <strong>Google\'s hosted Gemini</strong> models. Vision support and the full <code>ai.md</code> system prompt; each turn is billed to your Google AI account. The API key is stored only in this browser and never sent to a Partwright server.';
  wrap.appendChild(body);
  return wrap;
}

/** Default-model picker for a hosted provider. Mirrors
 *  buildAnthropicModelSection but reads/writes the provider's own model
 *  field and includes a custom-id input for dated snapshots / brand-new
 *  releases not in the curated list. */
function buildHostedModelSection(provider: HostedProvider, cb: AiSettingsCallbacks): HTMLElement {
  // Starts from the curated list; for Gemini the user can replace it with
  // their key's real lineup via the "Load models from your key" button.
  let optionList = provider === 'openai' ? OPENAI_MODEL_OPTIONS : GEMINI_MODEL_OPTIONS;
  const setModel = provider === 'openai' ? setOpenaiModel : setGeminiModel;
  const currentOf = () => provider === 'openai' ? loadSettings().toggles.openaiModel : loadSettings().toggles.geminiModel;

  const wrap = document.createElement('div');
  wrap.className = 'flex flex-col gap-2';
  const head = document.createElement('div');
  head.className = 'text-xs text-zinc-400';
  head.textContent = 'Default model';
  wrap.appendChild(head);

  const desc = document.createElement('div');
  desc.className = 'text-[11px] text-zinc-400 leading-snug';
  desc.innerHTML = provider === 'gemini'
    ? 'Model used for new turns. The starter list is the GA 2.5 family; click <strong>Load models from your key</strong> to pull your account\'s full current lineup (Gemini 3, Nano Banana, previews) with their exact ids. You can also switch on the fly from the chat header.'
    : 'Model used for new turns. The starter list is curated; click <strong>Load models from your key</strong> to pull your account\'s full current lineup with exact ids. You can also switch on the fly from the dropdown in the chat header.';
  wrap.appendChild(desc);

  const seg = document.createElement('div');
  seg.className = 'flex flex-wrap gap-1';
  const renderButtons = () => {
    seg.replaceChildren();
    const current = currentOf();
    let matched = false;
    for (const opt of optionList) {
      const b = document.createElement('button');
      const active = current === opt.id;
      if (active) matched = true;
      b.className = active
        ? 'px-2 py-1 rounded text-[11px] bg-zinc-700 text-zinc-100 border border-zinc-600'
        : 'px-2 py-1 rounded text-[11px] text-zinc-300 border border-zinc-700 hover:bg-zinc-700/60';
      b.textContent = opt.label;
      b.addEventListener('click', () => {
        saveSettings(setModel(loadSettings(), opt.id));
        cb.onChange();
        renderButtons();
      });
      seg.appendChild(b);
    }
    // Surface a custom id (one not in the curated list) as a selected pill.
    if (!matched && current) {
      const b = document.createElement('button');
      b.className = 'px-2 py-1 rounded text-[11px] bg-zinc-700 text-zinc-100 border border-zinc-600';
      b.textContent = `${current} (custom)`;
      seg.appendChild(b);
    }
  };
  renderButtons();
  wrap.appendChild(seg);

  // Pull the key's actual available models. Model ids rev fast and a
  // hard-coded list goes stale (guessed Gemini 3 ids 404'd), so this is the
  // reliable way to surface current models — Gemini 3 / Nano Banana, new
  // GPT / o-series snapshots — with whatever id the account was granted.
  wrap.appendChild(buildLoadModelsRow(provider, live => {
    optionList = live;
    renderButtons();
  }));

  // Custom-id input.
  const customRow = document.createElement('div');
  customRow.className = 'flex items-center gap-2';
  const customInput = document.createElement('input');
  customInput.type = 'text';
  customInput.placeholder = provider === 'openai' ? 'custom id, e.g. gpt-5-2026-09-15' : 'custom id, e.g. gemini-3-pro-preview-12-2025';
  customInput.className = 'flex-1 px-2 py-1 rounded bg-zinc-900 border border-zinc-600 text-zinc-100 text-[11px] font-mono';
  customRow.appendChild(customInput);
  const setBtn = document.createElement('button');
  setBtn.className = 'px-2 py-1 rounded text-[11px] bg-zinc-700 text-zinc-100 hover:bg-zinc-600';
  setBtn.textContent = 'Use id';
  setBtn.addEventListener('click', () => {
    const id = customInput.value.trim();
    if (!id) return;
    saveSettings(setModel(loadSettings(), id));
    customInput.value = '';
    cb.onChange();
    renderButtons();
  });
  customRow.appendChild(setBtn);
  wrap.appendChild(customRow);

  const customHint = document.createElement('p');
  customHint.className = 'text-[10px] text-zinc-500';
  customHint.textContent = 'Pricing for unknown ids falls back to median-tier rates — the cost meter will be approximate.';
  wrap.appendChild(customHint);
  return wrap;
}

/** Key status + connect/replace/disconnect for a hosted provider. Mirrors
 *  buildAnthropicKeySection; actions live in the modal footer like the
 *  Anthropic tab. */
async function buildHostedKeySection(
  provider: HostedProvider,
  close: () => void,
  footer: HTMLElement,
  body: HTMLElement,
  cb: AiSettingsCallbacks,
): Promise<void> {
  const label = providerLabel(provider);
  const reset = provider === 'openai' ? resetOpenaiClient : resetGeminiClient;
  const console = hostedConsoleUrl(provider);

  const wrap = document.createElement('div');
  wrap.className = 'flex flex-col gap-2';
  const head = document.createElement('div');
  head.className = 'text-xs text-zinc-400';
  head.textContent = `${label} key`;
  wrap.appendChild(head);

  const key = await getKey(provider);
  if (!key) {
    const empty = document.createElement('p');
    empty.className = 'text-[11px] text-zinc-400';
    empty.textContent = `No ${label} key connected.`;
    wrap.appendChild(empty);
    const linkRow = document.createElement('p');
    linkRow.className = 'text-[11px]';
    const a = document.createElement('a');
    a.href = console.url;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.className = 'text-blue-400 hover:text-blue-300 underline';
    a.textContent = `Get a key at ${console.label} →`;
    linkRow.appendChild(a);
    wrap.appendChild(linkRow);
    const connectBtn = document.createElement('button');
    connectBtn.className = 'self-start px-3 py-1.5 rounded text-xs font-medium bg-blue-600 hover:bg-blue-500 text-white';
    connectBtn.textContent = `Connect ${label}`;
    connectBtn.addEventListener('click', () => {
      close();
      void showAiKeyModal({ provider, onConnected: cb.onChange });
    });
    wrap.appendChild(connectBtn);
    body.appendChild(wrap);
    return;
  }

  const last4 = key.apiKey.slice(-4);
  const row = (rl: string, value: string) => {
    const r = document.createElement('div');
    r.className = 'flex justify-between gap-3 text-xs';
    const l = document.createElement('span');
    l.className = 'text-zinc-400';
    l.textContent = rl;
    const v = document.createElement('span');
    v.className = 'text-zinc-100 font-mono';
    v.textContent = value;
    r.appendChild(l);
    r.appendChild(v);
    return r;
  };
  wrap.appendChild(row('Key', `…${last4}`));
  wrap.appendChild(row('Connected', new Date(key.createdAt).toLocaleString()));
  wrap.appendChild(row('Last used', new Date(key.lastUsed).toLocaleString()));
  wrap.appendChild(row('Input tokens', key.totalInputTokens.toLocaleString()));
  wrap.appendChild(row('Output tokens', key.totalOutputTokens.toLocaleString()));
  wrap.appendChild(row('Spent (estimated)', formatUsd(key.totalCostUsd)));

  const note = document.createElement('p');
  note.className = 'text-[11px] text-zinc-500 leading-snug';
  note.textContent = 'Estimated spend uses public list prices and may differ slightly from your provider invoice.';
  wrap.appendChild(note);
  body.appendChild(wrap);

  const replaceBtn = document.createElement('button');
  replaceBtn.className = 'px-3 py-1.5 rounded text-xs text-zinc-200 bg-zinc-700 hover:bg-zinc-600';
  replaceBtn.textContent = 'Replace key';
  replaceBtn.addEventListener('click', () => {
    close();
    void showAiKeyModal({ provider, onConnected: cb.onChange });
  });
  footer.appendChild(replaceBtn);

  const disconnectBtn = document.createElement('button');
  disconnectBtn.className = 'px-3 py-1.5 rounded text-xs text-red-300 bg-red-900/40 hover:bg-red-800/60';
  disconnectBtn.textContent = 'Disconnect';
  disconnectBtn.addEventListener('click', async () => {
    if (!confirm(`Disconnect ${label}? Your chat history is kept; only the key is removed.`)) return;
    await deleteKey(provider);
    reset();
    close();
    cb.onChange();
  });
  footer.appendChild(disconnectBtn);
}

function formatK(n: number): string {
  if (n >= 1024 && n % 1024 === 0) return `${n / 1024}K`;
  return n.toLocaleString();
}

function buildLocalSection(close: () => void, cb: AiSettingsCallbacks): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'flex flex-col gap-2';
  const head = document.createElement('div');
  head.className = 'flex items-center justify-between';
  const h = document.createElement('div');
  h.className = 'text-xs text-zinc-400';
  h.textContent = 'Local model';
  head.appendChild(h);
  const pick = document.createElement('button');
  pick.className = 'px-3 py-1 rounded text-xs text-zinc-200 bg-zinc-700 hover:bg-zinc-600';
  pick.textContent = 'Choose model…';
  pick.addEventListener('click', () => {
    close();
    void showAiLocalModal({ onChange: cb.onChange });
  });
  head.appendChild(pick);
  wrap.appendChild(head);

  const settings = loadSettings();
  const status = document.createElement('div');
  status.className = 'text-[11px] text-zinc-400 leading-snug';
  if (settings.toggles.localModel) {
    try {
      const info = resolveLocalModel(settings.toggles.localModel);
      const resident = isModelLoaded(info.id);
      status.textContent = `${info.label} · ${(info.vramMB / 1024).toFixed(1)} GB VRAM · ${resident ? 'in GPU memory' : 'not yet loaded'}`;
    } catch {
      status.textContent = 'Previously selected model is no longer available. Pick another.';
    }
  } else {
    status.textContent = 'No local model picked yet. Click “Choose model…” to download one.';
  }
  wrap.appendChild(status);
  return wrap;
}

/** "Local context" section — controls the trade-off between conversation
 *  length and VRAM. Two knobs:
 *    - Window size override: blank = use each model's declared default,
 *      otherwise applies globally. Higher = more turns fit, more VRAM.
 *    - Sliding window: when on, old turns drop off silently instead of
 *      hitting the "exceeds window" error. */
function buildLocalContextSection(cb: AiSettingsCallbacks): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'flex flex-col gap-2';
  const head = document.createElement('div');
  head.className = 'text-xs text-zinc-400';
  head.textContent = 'Local context';
  wrap.appendChild(head);

  const desc = document.createElement('div');
  desc.className = 'text-[11px] text-zinc-400 leading-snug';
  desc.innerHTML = `We request <strong>32K tokens</strong> for most models at load time, and <strong>4K for the 70B</strong> (its KV cache is too expensive at higher windows). The actual ceiling is whatever the model's compiled WASM accepts — fetched once from its config and cached. Set an override below to clamp lower; the value we'll request is <code>min(your override, model default, WASM ceiling)</code>. If a load still fails we walk down 32K → 16K → 8K → 4K until one sticks.`;
  wrap.appendChild(desc);

  const settings = loadSettings();

  const overrideRow = document.createElement('label');
  overrideRow.className = 'flex items-center gap-2 text-xs text-zinc-300';
  overrideRow.innerHTML = '<span>Override window size:</span>';
  const overrideInput = document.createElement('input');
  overrideInput.type = 'number';
  overrideInput.step = '1024';
  overrideInput.min = '0';
  overrideInput.placeholder = 'auto';
  overrideInput.className = 'w-24 px-2 py-1 rounded bg-zinc-900 border border-zinc-600 text-zinc-100 text-xs focus:outline-none focus:border-blue-500';
  overrideInput.value = settings.localContext.windowSizeOverride === null
    ? ''
    : String(settings.localContext.windowSizeOverride);
  overrideInput.addEventListener('change', () => {
    const v = parseInt(overrideInput.value, 10);
    const next = Number.isFinite(v) && v > 0 ? v : null;
    saveSettings(setLocalContext(loadSettings(), { windowSizeOverride: next }));
    // Unload so the next message rebuilds the engine with the new window.
    // Cached weights survive — the rebuild is just a fast reload.
    void unloadActiveLocalModel();
    cb.onChange();
  });
  overrideRow.appendChild(overrideInput);
  const overrideHint = document.createElement('span');
  overrideHint.className = 'text-[10px] text-zinc-500';
  let ceilingHint = '';
  if (settings.toggles.localModel) {
    try {
      const info = resolveLocalModel(settings.toggles.localModel);
      // Distinguish "fetched from the model's config and known good"
      // from "registry default we'll request on first load." The former
      // is a hard ceiling; the latter is provisional until we've actually
      // loaded the model once.
      const fetched = getCachedCeiling(settings.toggles.localModel);
      const ceiling = effectiveContextCeiling(settings.toggles.localModel, info.contextWindowSize);
      ceilingHint = fetched !== null
        ? ` · ${formatK(ceiling)} ceiling for ${info.label} (confirmed)`
        : ` · ${formatK(ceiling)} requested for ${info.label} (real ceiling fetched on first load)`;
    } catch { /* stale id — skip ceiling hint */ }
  }
  overrideHint.textContent = `tokens · blank = per-model default${ceilingHint}`;
  overrideRow.appendChild(overrideHint);
  wrap.appendChild(overrideRow);

  const slidingRow = document.createElement('label');
  slidingRow.className = 'flex items-start gap-2 text-xs text-zinc-300';
  const slidingCheckbox = document.createElement('input');
  slidingCheckbox.type = 'checkbox';
  slidingCheckbox.className = 'mt-0.5';
  slidingCheckbox.checked = settings.localContext.sliding;
  slidingCheckbox.addEventListener('change', () => {
    saveSettings(setLocalContext(loadSettings(), { sliding: slidingCheckbox.checked }));
    void unloadActiveLocalModel();
    cb.onChange();
  });
  slidingRow.appendChild(slidingCheckbox);
  const slidingText = document.createElement('span');
  slidingText.innerHTML = '<strong class="text-zinc-200">Sliding window mode.</strong> <span class="text-zinc-400">Old turns drop off silently as new ones arrive. Conversation never errors, but the model loses long-range coherence. Costs the same VRAM as a fixed window of the same size.</span>';
  slidingRow.appendChild(slidingText);
  wrap.appendChild(slidingRow);

  if (settings.localContext.sliding) {
    const warn = document.createElement('div');
    warn.className = 'rounded border border-amber-700/40 bg-amber-900/15 px-3 py-2 text-[11px] text-amber-200 leading-snug';
    warn.innerHTML = `<strong>Heads up:</strong> sliding-window mode rolls off tokens without understanding our message structure. If the cut falls between a tool call and its result, the next turn can error. <strong>Auto-compaction</strong> (the section below) avoids this — prefer it for long sessions.`;
    wrap.appendChild(warn);
  }

  const reloadHint = document.createElement('div');
  reloadHint.className = 'text-[10px] text-zinc-500';
  reloadHint.textContent = 'Changing these unloads the GPU engine; the next message rebuilds it (cached weights survive — just a fast reload).';
  wrap.appendChild(reloadHint);

  const stallRow = document.createElement('label');
  stallRow.className = 'flex items-center gap-2 text-xs text-zinc-300';
  stallRow.innerHTML = '<span>Stall timeout:</span>';
  const stallInput = document.createElement('input');
  stallInput.type = 'number';
  stallInput.min = '5';
  stallInput.max = '600';
  stallInput.step = '5';
  stallInput.className = 'w-20 px-2 py-1 rounded bg-zinc-900 border border-zinc-600 text-zinc-100 text-xs focus:outline-none focus:border-blue-500';
  stallInput.value = String(settings.localContext.stallTimeoutSec);
  stallInput.addEventListener('change', () => {
    const v = parseInt(stallInput.value, 10);
    const next = Number.isFinite(v) && v >= 5 ? v : 35;
    stallInput.value = String(next);
    saveSettings(setLocalContext(loadSettings(), { stallTimeoutSec: next }));
    cb.onChange();
  });
  stallRow.appendChild(stallInput);
  const stallHint = document.createElement('span');
  stallHint.className = 'text-[10px] text-zinc-500';
  stallHint.textContent = 'seconds · gap between tokens before auto-retry fires. Raise to 120+ for large models on slow hardware.';
  stallRow.appendChild(stallHint);
  wrap.appendChild(stallRow);

  return wrap;
}

/** Auto-compaction mode picker. Aggressive mode compacts after every
 *  assistant turn, keeping just the last exchange — ideal for an app like
 *  this where the live editor + version gallery hold the actual state and
 *  the chat is mostly a tool-driving channel. */
function buildAutoCompactSection(cb: AiSettingsCallbacks, rerenderModal: () => void): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'flex flex-col gap-2';
  const head = document.createElement('div');
  head.className = 'text-xs text-zinc-400';
  head.textContent = 'Auto-compaction';
  wrap.appendChild(head);

  const settings = loadSettings();
  const desc = document.createElement('div');
  desc.className = 'text-[11px] text-zinc-400 leading-snug';
  desc.innerHTML = 'Condenses older turns into a one-paragraph summary so the conversation keeps fitting in context. Compaction itself runs through the active provider — local turns are free; Anthropic turns cost a tiny Haiku request each time. Insights get auto-promoted to the session\'s note log when applicable.';
  wrap.appendChild(desc);

  const seg = document.createElement('div');
  seg.className = 'flex flex-wrap gap-1';
  for (const opt of AUTO_COMPACT_OPTIONS) {
    const b = document.createElement('button');
    const active = settings.autoCompactMode === opt.id;
    b.className = active
      ? 'px-2 py-1 rounded text-[11px] bg-zinc-700 text-zinc-100 border border-zinc-600'
      : 'px-2 py-1 rounded text-[11px] text-zinc-300 border border-zinc-700 hover:bg-zinc-700/60';
    b.textContent = opt.label;
    b.title = opt.hint;
    b.addEventListener('click', () => {
      saveSettings(setAutoCompactMode(loadSettings(), opt.id));
      cb.onChange();
      rerenderModal();
    });
    seg.appendChild(b);
  }
  wrap.appendChild(seg);

  const hintBox = document.createElement('div');
  hintBox.className = 'text-[11px] text-zinc-500 leading-snug';
  const active = AUTO_COMPACT_OPTIONS.find(o => o.id === settings.autoCompactMode);
  if (active) hintBox.textContent = active.hint;
  wrap.appendChild(hintBox);
  return wrap;
}

function buildSystemPromptSection(provider: Provider, close: () => void, cb: AiSettingsCallbacks): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'flex flex-col gap-2';
  const head = document.createElement('div');
  head.className = 'flex items-center justify-between';
  const h = document.createElement('div');
  h.className = 'text-xs text-zinc-400';
  h.textContent = 'System prompt';
  head.appendChild(h);
  wrap.appendChild(head);

  const settings = loadSettings();
  const override = settings.systemPromptOverrides?.[provider] ?? null;

  const desc = document.createElement('div');
  desc.className = 'text-[11px] text-zinc-400 leading-snug';
  if (provider === 'local') {
    desc.innerHTML = override !== null
      ? '<strong>Custom prompt active</strong> — your override is sent to local models instead of the built-in tier.'
      : '<strong>Built-in</strong> — a compact prompt tuned for local models, with the <code>readDoc</code> tool to pull in detailed subdocs on demand. The exact tier (Slim ~700 tok / Medium ~1.1K tok) depends on the active model; click to view or pin a different tier.';
  } else {
    desc.innerHTML = override !== null
      ? '<strong>Custom prompt active</strong> — your override is sent to Claude instead of the full <code>ai.md</code>.'
      : '<strong>Built-in</strong> — the full <code>public/ai.md</code> (~12.5K tokens) cached on Anthropic\'s side. Subdocs are fetched on demand via the <code>readDoc</code> tool.';
  }
  wrap.appendChild(desc);

  const editBtn = document.createElement('button');
  editBtn.className = 'self-start px-3 py-1 rounded text-xs text-zinc-200 bg-zinc-700 hover:bg-zinc-600';
  editBtn.textContent = override !== null ? 'Edit / reset prompt' : 'View / edit prompt';
  editBtn.addEventListener('click', () => {
    close();
    void showSystemPromptModal(provider, { onChange: cb.onChange });
  });
  wrap.appendChild(editBtn);
  return wrap;
}

/** Anthropic key + lifetime usage panel. Renders the empty-state connect
 *  button inline, and (when a key exists) puts Replace / Disconnect into
 *  the modal footer. */
async function buildAnthropicKeySection(close: () => void, footer: HTMLElement, body: HTMLElement, cb: AiSettingsCallbacks): Promise<void> {
  const wrap = document.createElement('div');
  wrap.className = 'flex flex-col gap-2';
  const head = document.createElement('div');
  head.className = 'text-xs text-zinc-400';
  head.textContent = 'Anthropic key';
  wrap.appendChild(head);

  const key = await getKey('anthropic');
  if (!key) {
    const empty = document.createElement('p');
    empty.className = 'text-[11px] text-zinc-400';
    empty.textContent = 'No Anthropic key connected.';
    wrap.appendChild(empty);
    const connectBtn = document.createElement('button');
    connectBtn.className = 'self-start px-3 py-1.5 rounded text-xs font-medium bg-blue-600 hover:bg-blue-500 text-white';
    connectBtn.textContent = 'Connect Anthropic API';
    connectBtn.addEventListener('click', () => {
      close();
      void showAiKeyModal({ onConnected: cb.onChange });
    });
    wrap.appendChild(connectBtn);
    body.appendChild(wrap);
    return;
  }

  const last4 = key.apiKey.slice(-4);
  const row = (label: string, value: string) => {
    const r = document.createElement('div');
    r.className = 'flex justify-between gap-3 text-xs';
    const l = document.createElement('span');
    l.className = 'text-zinc-400';
    l.textContent = label;
    const v = document.createElement('span');
    v.className = 'text-zinc-100 font-mono';
    v.textContent = value;
    r.appendChild(l);
    r.appendChild(v);
    return r;
  };
  wrap.appendChild(row('Key', `…${last4}`));
  wrap.appendChild(row('Connected', new Date(key.createdAt).toLocaleString()));
  wrap.appendChild(row('Last used', new Date(key.lastUsed).toLocaleString()));
  wrap.appendChild(row('Input tokens', key.totalInputTokens.toLocaleString()));
  wrap.appendChild(row('Output tokens', key.totalOutputTokens.toLocaleString()));
  wrap.appendChild(row('Spent (estimated)', formatUsd(key.totalCostUsd)));

  const note = document.createElement('p');
  note.className = 'text-[11px] text-zinc-500 leading-snug';
  note.textContent = 'Estimated spend uses public list prices and may differ slightly from your Anthropic invoice.';
  wrap.appendChild(note);
  body.appendChild(wrap);

  const replaceBtn = document.createElement('button');
  replaceBtn.className = 'px-3 py-1.5 rounded text-xs text-zinc-200 bg-zinc-700 hover:bg-zinc-600';
  replaceBtn.textContent = 'Replace key';
  replaceBtn.addEventListener('click', () => {
    close();
    void showAiKeyModal({ onConnected: cb.onChange });
  });
  footer.appendChild(replaceBtn);

  const disconnectBtn = document.createElement('button');
  disconnectBtn.className = 'px-3 py-1.5 rounded text-xs text-red-300 bg-red-900/40 hover:bg-red-800/60';
  disconnectBtn.textContent = 'Disconnect';
  disconnectBtn.addEventListener('click', async () => {
    if (!confirm('Disconnect Anthropic? Your chat history is kept; only the key is removed.')) return;
    await deleteKey('anthropic');
    resetClient();
    close();
    cb.onChange();
  });
  footer.appendChild(disconnectBtn);
}
