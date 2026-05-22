// "Run a local model" modal. Lists the size tiers, shows which models the
// user already has cached, surfaces the WebGPU compatibility check, and
// downloads + activates the chosen weights on demand. After a successful
// download the AI settings are flipped to the local provider so the next
// message goes through WebLLM instead of Anthropic.

import {
  LOCAL_MODELS,
  LOCAL_GROUP_LABELS,
  LOCAL_GROUP_HINTS,
  totalMemoryMB,
  type LocalModelInfo,
  type LocalSizeGroup,
} from '../ai/localModels';
import {
  ensureModelLoaded,
  getCachedModels,
  deleteCachedModel,
  probeWebGpu,
  probeGpuBudgetMB,
  isModelLoaded,
  getStorageUsage,
  effectiveContextCeiling,
} from '../ai/local';
import { getModelCeiling } from '../ai/modelMetadata';
import { loadSettings, saveSettings, setLocalModel, setProvider, addCustomLocalModel, removeCustomLocalModel, BuiltInModelIdCollision, type CustomLocalModel } from '../ai/settings';

let modalEl: HTMLElement | null = null;
let escHandler: ((e: KeyboardEvent) => void) | null = null;
let cachedSet: Set<string> = new Set();
/** WebGPU probe status. Starts as `checking` so we don't render an
 *  optimistic green pill that flashes to red a tick later on browsers
 *  without WebGPU. The first probe result flips this to ok/bad. */
type GpuStatus = { state: 'checking' } | { state: 'ok' } | { state: 'bad'; reason: string };
let webGpuStatus: GpuStatus = { state: 'checking' };

/** Resolve the context window we'll actually request at engine.reload()
 *  time, given the model's declared default and any cached WASM ceiling
 *  (fetched from mlc-chat-config.json — see modelMetadata.ts). The
 *  global override caps below the ceiling. The same math runs in
 *  `local.ts ensureModelLoaded` — keep these in sync. */
function effectiveContextWindow(modelId: string | null, modelDefault: number): number {
  const settings = loadSettings();
  const ceiling = modelId ? effectiveContextCeiling(modelId, modelDefault) : modelDefault;
  const override = settings.localContext.windowSizeOverride;
  if (override && override > 0) return Math.min(override, ceiling);
  return ceiling;
}

function formatTokens(n: number): string {
  if (n >= 1024 && n % 1024 === 0) return `${n / 1024}K`;
  return n.toLocaleString();
}

export interface AiLocalModalCallbacks {
  onChange: () => void;
}

export async function showAiLocalModal(cb: AiLocalModalCallbacks): Promise<void> {
  closeModal();

  const overlay = document.createElement('div');
  overlay.className = 'fixed inset-0 bg-black/60 flex items-center justify-center z-50';
  overlay.addEventListener('click', e => { if (e.target === overlay) closeModal(); });

  const modal = document.createElement('div');
  modal.className = 'bg-zinc-800 rounded-xl shadow-2xl border border-zinc-700 w-full max-w-lg flex flex-col max-h-[90vh]';

  const header = document.createElement('div');
  header.className = 'px-5 py-3 border-b border-zinc-700 flex items-center justify-between shrink-0';
  const title = document.createElement('h2');
  title.className = 'text-sm font-semibold text-zinc-100';
  title.textContent = 'Run a local model (no API key needed)';
  header.appendChild(title);
  const closeBtn = document.createElement('button');
  closeBtn.className = 'px-2 py-1 rounded text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700 text-sm';
  closeBtn.textContent = '✕';
  closeBtn.addEventListener('click', closeModal);
  header.appendChild(closeBtn);
  modal.appendChild(header);

  const body = document.createElement('div');
  body.className = 'px-5 py-4 flex flex-col gap-3 text-sm text-zinc-200 overflow-y-auto';
  modal.appendChild(body);

  overlay.appendChild(modal);
  document.body.appendChild(overlay);
  modalEl = overlay;

  // Re-render reactively when state changes (cache scan, download progress).
  await rerender(body, cb);

  escHandler = (e: KeyboardEvent) => {
    if (e.key === 'Escape') closeModal();
  };
  document.addEventListener('keydown', escHandler);
}

async function rerender(body: HTMLElement, cb: AiLocalModalCallbacks): Promise<void> {
  body.replaceChildren();
  body.appendChild(buildCrashRiskWarning());
  body.appendChild(buildIntro());

  // Run the WebGPU probe lazily so the modal opens instantly. The probe
  // result is shown right under the intro once it lands. Run the GPU budget
  // probe in parallel — it re-uses the same adapter request under the hood
  // so there's no extra round-trip cost.
  const gpuBanner = document.createElement('div');
  body.appendChild(gpuBanner);
  void probeWebGpu().then(r => {
    webGpuStatus = r.supported
      ? { state: 'ok' }
      : { state: 'bad', reason: r.reason ?? 'WebGPU is not available.' };
    renderGpuBanner(gpuBanner);
  }).catch(() => {
    webGpuStatus = { state: 'bad', reason: 'WebGPU probe failed.' };
    renderGpuBanner(gpuBanner);
  });
  renderGpuBanner(gpuBanner);
  // Fire the GPU budget probe so ensureModelLoaded can use a cached result
  // the next time it's called (the adapter stays alive after requestAdapter).
  void probeGpuBudgetMB();

  // Storage usage line — populated async via navigator.storage.estimate().
  const storageBanner = document.createElement('div');
  body.appendChild(storageBanner);
  void renderStorageBanner(storageBanner);

  // Cache scan can take several seconds the first time it runs in a tab
  // because it triggers WebLLM's dynamic import (~14 MB chunk) and then
  // probes hasModelInCache() once per prebuilt entry. Without a visible
  // placeholder the modal sits at its tiny intro-only size and looks
  // frozen. Show a spinner + "Scanning…" line until the scan resolves.
  const loadingEl = document.createElement('div');
  loadingEl.className = 'flex items-center gap-2 px-3 py-3 mt-1 rounded border border-zinc-700 bg-zinc-900/50 text-xs text-zinc-400';
  loadingEl.innerHTML = '<span class="inline-block w-3 h-3 rounded-full border-2 border-zinc-600 border-t-blue-400 animate-spin"></span><span>Scanning model cache…</span>';
  body.appendChild(loadingEl);

  // Scan the cache once on open so we know which models show "Loaded" vs
  // "Download". A second open will repeat the scan — cheap, all-promises.
  cachedSet = await getCachedModels();
  loadingEl.remove();
  const settings = loadSettings();

  // Group models by tier so the picker reads like a curated shopping list
  // rather than a flat dump. Order: recommended → smaller → larger →
  // flagship → custom. Each group gets a heading + one-line hint
  // so the user knows whether the section is for their hardware.
  const groupOrder: LocalSizeGroup[] = ['recommended', 'smaller', 'larger', 'flagship'];
  for (const group of groupOrder) {
    const models = LOCAL_MODELS.filter(m => m.group === group);
    if (models.length === 0) continue;
    body.appendChild(buildGroupHeader(group));
    const list = document.createElement('div');
    list.className = 'flex flex-col gap-2 mb-1';
    for (const model of models) {
      list.appendChild(renderModelCard(model, settings.toggles.localModel, body, cb));
    }
    body.appendChild(list);
  }

  // User-added custom models — listed as their own group with the same
  // card UI as the curated set, but with a Remove button instead of an
  // "Active by default".
  if (settings.customLocalModels.length > 0) {
    body.appendChild(buildGroupHeader('custom'));
    const list = document.createElement('div');
    list.className = 'flex flex-col gap-2 mb-1';
    for (const c of settings.customLocalModels) {
      list.appendChild(renderCustomModelCard(c, settings.toggles.localModel, body, cb));
    }
    body.appendChild(list);
  }

  body.appendChild(buildCustomModelForm(body, cb));
  body.appendChild(buildContextNote());
  body.appendChild(buildTrustPanel());
}

function buildGroupHeader(group: LocalSizeGroup): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'flex flex-col gap-0.5 mt-1';
  const label = document.createElement('div');
  label.className = 'text-xs font-semibold text-zinc-200 uppercase tracking-wide';
  label.textContent = LOCAL_GROUP_LABELS[group];
  wrap.appendChild(label);
  const hint = document.createElement('div');
  hint.className = 'text-[11px] text-zinc-500 leading-snug';
  hint.textContent = LOCAL_GROUP_HINTS[group];
  wrap.appendChild(hint);
  return wrap;
}

/** Compact card for a user-added custom model. Same affordances as the
 *  curated card minus the per-tier metadata, plus a Remove button that
 *  forgets the entry. */
function renderCustomModelCard(
  custom: CustomLocalModel,
  activeId: string | null,
  parentBody: HTMLElement,
  cb: AiLocalModalCallbacks,
): HTMLElement {
  const isActive = custom.id === activeId;
  const isCached = cachedSet.has(custom.id);
  const isResident = isModelLoaded(custom.id);

  const card = document.createElement('div');
  card.className = isActive
    ? 'rounded border border-blue-600/60 bg-blue-900/10 p-3 flex flex-col gap-2'
    : 'rounded border border-zinc-700 bg-zinc-900/40 p-3 flex flex-col gap-2';

  const row = document.createElement('div');
  row.className = 'flex items-start justify-between gap-2';
  const left = document.createElement('div');
  left.className = 'flex flex-col gap-0.5 min-w-0';

  const head = document.createElement('div');
  head.className = 'flex items-center gap-2 flex-wrap';
  const name = document.createElement('div');
  name.className = 'text-sm font-medium text-zinc-100';
  name.textContent = custom.label || custom.id;
  head.appendChild(name);
  if (isResident) {
    const pill = document.createElement('span');
    pill.className = 'text-[10px] px-1.5 py-0.5 rounded bg-emerald-700/40 text-emerald-200 border border-emerald-700/60';
    pill.textContent = 'In GPU';
    head.appendChild(pill);
  } else if (isCached) {
    const pill = document.createElement('span');
    pill.className = 'text-[10px] px-1.5 py-0.5 rounded bg-zinc-700 text-zinc-300';
    pill.textContent = 'Downloaded';
    head.appendChild(pill);
  }
  const custPill = document.createElement('span');
  custPill.className = 'text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400 border border-zinc-700';
  custPill.textContent = 'Custom';
  head.appendChild(custPill);
  left.appendChild(head);

  const source = document.createElement('a');
  source.href = custom.modelUrl;
  source.target = '_blank';
  source.rel = 'noopener noreferrer';
  source.className = 'text-[11px] text-zinc-400 hover:text-zinc-200 underline truncate';
  source.textContent = custom.modelUrl;
  left.appendChild(source);

  const ctxLine = document.createElement('div');
  ctxLine.className = 'text-[10px] text-zinc-500';
  const ctxN = effectiveContextWindow(custom.id, custom.contextWindowSize ?? 4096);
  ctxLine.textContent = `Context: ${formatTokens(ctxN)}${custom.vramMB ? ` · VRAM: ${(custom.vramMB / 1024).toFixed(1)} GB` : ''}`;
  left.appendChild(ctxLine);

  if (custom.modelLibUrl) {
    const lib = document.createElement('div');
    lib.className = 'text-[10px] text-zinc-500 truncate';
    lib.textContent = `lib: ${custom.modelLibUrl}`;
    left.appendChild(lib);
  } else {
    const lib = document.createElement('div');
    lib.className = 'text-[10px] text-zinc-500';
    lib.textContent = 'lib: auto-derived from model id';
    left.appendChild(lib);
  }
  row.appendChild(left);

  const actions = document.createElement('div');
  actions.className = 'flex flex-col items-end gap-1 shrink-0';
  const primary = document.createElement('button');
  if (isActive && isResident) {
    primary.className = 'px-3 py-1.5 rounded text-xs font-medium bg-emerald-700/40 text-emerald-200 border border-emerald-700/60 cursor-default';
    primary.textContent = 'Active';
    primary.disabled = true;
  } else {
    primary.className = 'px-3 py-1.5 rounded text-xs font-medium bg-blue-600 hover:bg-blue-500 text-white';
    primary.textContent = isCached ? 'Use this model' : 'Download & use';
    primary.addEventListener('click', () => { void selectCustomModel(custom.id, parentBody, cb); });
  }
  actions.appendChild(primary);

  const remove = document.createElement('button');
  remove.className = 'px-2 py-0.5 rounded text-[10px] text-zinc-400 hover:text-red-300 hover:bg-red-900/30 border border-transparent';
  remove.textContent = 'Forget';
  remove.title = `Remove this custom model from the list (cached weights, if any, stay until you Remove them too).`;
  remove.addEventListener('click', async () => {
    if (!confirm(`Remove "${custom.label || custom.id}" from your custom model list?`)) return;
    saveSettings(removeCustomLocalModel(loadSettings(), custom.id));
    cb.onChange();
    await rerender(parentBody, cb);
  });
  actions.appendChild(remove);

  row.appendChild(actions);
  card.appendChild(row);
  return card;
}

async function selectCustomModel(modelId: string, parentBody: HTMLElement, cb: AiLocalModalCallbacks): Promise<void> {
  // Reuse the standard download flow; ensureModelLoaded reads the custom
  // entries from settings on every call so a freshly-added model is
  // visible to WebLLM.
  await selectModel(modelId, parentBody, cb);
}

/** Form at the bottom of the modal where the user pastes a Hugging Face
 *  URL (or `org/repo`) and optionally a compiled-WASM URL. Validation is
 *  loose — we just save what they typed and let the engine surface a
 *  network error if the URLs are wrong. */
function buildCustomModelForm(parentBody: HTMLElement, cb: AiLocalModalCallbacks): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'mt-3 rounded border border-zinc-700 bg-zinc-900/40 p-3 flex flex-col gap-2';

  const head = document.createElement('div');
  head.className = 'text-xs font-semibold text-zinc-200 uppercase tracking-wide';
  head.textContent = 'Add a custom model';
  wrap.appendChild(head);

  const hint = document.createElement('div');
  hint.className = 'text-[11px] text-zinc-400 leading-snug';
  hint.innerHTML = 'Paste any <a href="https://huggingface.co/mlc-ai" target="_blank" rel="noopener noreferrer" class="underline text-zinc-300 hover:text-zinc-100">MLC-compiled Hugging Face model</a> URL or <code>org/repo</code> reference. The model_id must match the repo name. We try to auto-fill the compiled WASM library URL; for non-standard builds, paste it yourself.';
  wrap.appendChild(hint);

  const urlInput = document.createElement('input');
  urlInput.type = 'text';
  urlInput.placeholder = 'huggingface.co/mlc-ai/Qwen2.5-Coder-7B-Instruct-q4f16_1-MLC';
  urlInput.className = 'w-full px-2 py-1 rounded bg-zinc-900 border border-zinc-600 text-zinc-100 text-xs font-mono placeholder:text-zinc-600 focus:outline-none focus:border-blue-500';
  urlInput.spellcheck = false;
  wrap.appendChild(urlInput);

  const advancedDetails = document.createElement('details');
  advancedDetails.className = 'text-[11px]';
  const summary = document.createElement('summary');
  summary.className = 'cursor-pointer text-zinc-400 hover:text-zinc-200 select-none';
  summary.textContent = 'Advanced — set model_lib URL and VRAM estimate';
  advancedDetails.appendChild(summary);

  const libInput = document.createElement('input');
  libInput.type = 'text';
  libInput.placeholder = '(optional) https://raw.githubusercontent.com/mlc-ai/binary-mlc-llm-libs/main/web-llm-models/.../model_cs1k-webgpu.wasm';
  libInput.className = 'w-full mt-2 px-2 py-1 rounded bg-zinc-900 border border-zinc-600 text-zinc-100 text-xs font-mono placeholder:text-zinc-600 focus:outline-none focus:border-blue-500';
  libInput.spellcheck = false;
  advancedDetails.appendChild(libInput);

  const vramRow = document.createElement('div');
  vramRow.className = 'mt-2 flex items-center gap-2 text-zinc-400';
  vramRow.innerHTML = '<span>VRAM (GB, optional)</span>';
  const vramInput = document.createElement('input');
  vramInput.type = 'number';
  vramInput.step = '0.1';
  vramInput.min = '0';
  vramInput.placeholder = '5.0';
  vramInput.className = 'w-20 px-2 py-1 rounded bg-zinc-900 border border-zinc-600 text-zinc-100 text-xs focus:outline-none focus:border-blue-500';
  vramRow.appendChild(vramInput);
  advancedDetails.appendChild(vramRow);

  const ctxRow = document.createElement('div');
  ctxRow.className = 'mt-2 flex items-center gap-2 text-zinc-400';
  ctxRow.innerHTML = '<span>Context window (tokens, optional)</span>';
  const ctxInput = document.createElement('input');
  ctxInput.type = 'number';
  ctxInput.step = '1024';
  ctxInput.min = '0';
  ctxInput.placeholder = '4096';
  ctxInput.className = 'w-24 px-2 py-1 rounded bg-zinc-900 border border-zinc-600 text-zinc-100 text-xs focus:outline-none focus:border-blue-500';
  ctxInput.title = 'Some MLC-compiled WASMs support larger windows. Leave blank to use 4096 (the safe baseline).';
  ctxRow.appendChild(ctxInput);
  advancedDetails.appendChild(ctxRow);
  wrap.appendChild(advancedDetails);

  const errorBox = document.createElement('div');
  errorBox.className = 'text-[11px] text-red-300 hidden';
  wrap.appendChild(errorBox);

  const actions = document.createElement('div');
  actions.className = 'flex items-center justify-end gap-2';
  const addBtn = document.createElement('button');
  addBtn.className = 'px-3 py-1 rounded text-xs font-medium bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-50';
  addBtn.textContent = 'Add to list';
  addBtn.addEventListener('click', () => {
    errorBox.classList.add('hidden');
    const parsed = parseCustomModelInput(urlInput.value);
    if (!parsed) {
      errorBox.textContent = 'Couldn\'t parse that URL. Use either a huggingface.co URL or org/repo format.';
      errorBox.classList.remove('hidden');
      return;
    }
    const vramGB = parseFloat(vramInput.value);
    const ctxTokens = parseInt(ctxInput.value, 10);
    const custom: CustomLocalModel = {
      id: parsed.modelId,
      label: parsed.modelId,
      modelUrl: parsed.modelUrl,
      modelLibUrl: libInput.value.trim(),
      vramMB: Number.isFinite(vramGB) && vramGB > 0 ? Math.round(vramGB * 1024) : undefined,
      contextWindowSize: Number.isFinite(ctxTokens) && ctxTokens > 0 ? ctxTokens : undefined,
      addedAt: Date.now(),
    };
    try {
      saveSettings(addCustomLocalModel(loadSettings(), custom));
    } catch (err) {
      if (err instanceof BuiltInModelIdCollision) {
        errorBox.textContent = `That id matches a built-in model. Pick a different repo, or use the built-in entry from the list above.`;
      } else {
        errorBox.textContent = err instanceof Error ? err.message : String(err);
      }
      errorBox.classList.remove('hidden');
      return;
    }
    cb.onChange();
    void rerender(parentBody, cb);
  });
  actions.appendChild(addBtn);
  wrap.appendChild(actions);
  return wrap;
}

/** Parse a user-pasted reference into the bits WebLLM needs. Accepts:
 *    https://huggingface.co/<org>/<repo>
 *    huggingface.co/<org>/<repo>
 *    <org>/<repo>
 *  The repo name is taken verbatim as the WebLLM model_id, so it must be
 *  the actual published MLC repo (e.g. ending in `-MLC`). Returns null
 *  for anything we can't pattern-match. */
function parseCustomModelInput(raw: string): { modelUrl: string; modelId: string } | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  // Strip protocol + host if a full URL was pasted.
  const m = trimmed.match(/^(?:https?:\/\/)?(?:www\.)?(?:huggingface\.co\/)?([^/\s]+\/[^/\s?#]+)/);
  if (!m) return null;
  const [, slug] = m;
  const parts = slug.split('/');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  const [org, repo] = parts;
  return {
    modelUrl: `https://huggingface.co/${org}/${repo}`,
    modelId: repo,
  };
}

/** Honest note about how the displayed context number is chosen and
 *  what changes it. KV cache is the real bottleneck in the browser, not
 *  the WASM compilation. */
function buildContextNote(): HTMLElement {
  const note = document.createElement('div');
  note.className = 'mt-2 rounded border border-zinc-700 bg-zinc-900/40 p-3 text-[11px] text-zinc-400 leading-snug';
  note.innerHTML = `
    <strong class="text-zinc-300">About the context window.</strong>
    We request <strong>32K tokens</strong> for most models and
    <strong>4K for the 70B</strong> (its KV cache is too expensive at
    higher windows). The actual ceiling is whatever the model's compiled
    WASM accepts — we fetch <code>mlc-chat-config.json</code> on first
    load to find it, and walk a fallback ladder (32K → 16K → 8K → 4K)
    if our request is rejected. The card above shows the requested value;
    the chosen value is committed after the first load and persists in
    cache across sessions.
    <br><br>
    Clamp lower or enable sliding-window mode in <em>AI settings →
    Local context</em>. KV-cache memory grows linearly with window size:
    a 32K window on an 8B model needs ~4 GB of GPU memory just for the
    cache. Six-figure context isn't realistic in the browser today — use
    the Anthropic provider if you need it.
  `;
  return note;
}

/** Trust panel — surfaces the supply chain so users know where the weights
 *  come from and which open-source projects run them in the browser. We
 *  want this to be unmissable, not buried in a footer, because "AI model
 *  runs in your browser" sounds magical and people are right to be
 *  suspicious about it. */
function buildTrustPanel(): HTMLElement {
  const panel = document.createElement('div');
  panel.className = 'mt-1 rounded border border-zinc-700 bg-zinc-900/40 p-3 flex flex-col gap-2 text-[11px] text-zinc-400 leading-snug';

  const head = document.createElement('div');
  head.className = 'text-zinc-300 font-medium text-xs flex items-center gap-1.5';
  head.textContent = 'Where these models come from';
  panel.appendChild(head);

  const list = document.createElement('ul');
  list.className = 'list-disc list-inside space-y-1';
  list.innerHTML = `
    <li><strong class="text-zinc-300">Weights</strong> are downloaded from
      <a href="https://huggingface.co/mlc-ai" target="_blank" rel="noopener noreferrer" class="underline text-zinc-300 hover:text-zinc-100">huggingface.co/mlc-ai</a>
      — the official MLC.AI organization on Hugging Face. Originals are
      Meta's Llama, Microsoft's Phi, and Nous Research's Hermes;
      <a href="https://mlc.ai" target="_blank" rel="noopener noreferrer" class="underline text-zinc-300 hover:text-zinc-100">MLC.AI</a>
      compiles them for browser WebGPU.</li>
    <li><strong class="text-zinc-300">Runtime</strong> is
      <a href="https://webllm.mlc.ai" target="_blank" rel="noopener noreferrer" class="underline text-zinc-300 hover:text-zinc-100">WebLLM</a>
      (<code>@mlc-ai/web-llm</code> on npm, Apache-2.0). It loads the model
      into your GPU and runs inference; nothing leaves your browser.</li>
    <li><strong class="text-zinc-300">Network access</strong> is read-only:
      the page fetches weights on first use, then caches them locally.
      Subsequent turns are offline — verify with your browser's dev tools
      Network tab.</li>
    <li><strong class="text-zinc-300">Storage</strong> uses the browser's
      Cache API / OPFS. Click <em>Remove</em> next to any downloaded
      model to wipe its weights, or clear site data to start fresh.</li>
  `;
  panel.appendChild(list);
  return panel;
}

/** Prominent crash-risk warning shown at the top of the local model modal.
 *  Local model inference runs entirely in your browser and can exhaust
 *  device memory, which causes different outcomes per OS:
 *  - macOS: jetsam OOM killer can terminate system processes and log you out
 *  - Linux: kernel OOM killer terminates the browser; session survives
 *  - Windows: Chrome tab crashes (Aw, Snap); session survives
 *  This warning is intentionally loud and always visible — the auto-reduce
 *  logic in ensureModelLoaded helps but is heuristic and not guaranteed. */
function buildCrashRiskWarning(): HTMLElement {
  const box = document.createElement('div');
  box.className = 'rounded border border-amber-600/70 bg-amber-900/20 px-4 py-3 flex flex-col gap-1.5 text-sm text-amber-100';
  const head = document.createElement('div');
  head.className = 'font-semibold flex items-center gap-2';
  head.innerHTML = '⚠ Local models are experimental and can crash your computer';
  box.appendChild(head);
  const body = document.createElement('div');
  body.className = 'text-[12px] text-amber-200/90 leading-snug space-y-1';
  body.innerHTML = `
    <p>The model weights and KV cache are loaded entirely into GPU memory at startup — if they exceed what your device has free, the OS will forcibly kill processes.</p>
    <p><strong>On macOS this can terminate your login session</strong> (log you out). On Linux the browser process is killed but the session survives. On Windows the tab crashes.</p>
    <p>The app tries to auto-reduce the context window to fit your device, but this estimate is not guaranteed. <strong>If you are on a 16 GB Mac, use a model from the Smaller tier, or reduce the context window to 8 192 tokens in AI settings → Local context before loading any 8 B+ model.</strong></p>
  `;
  box.appendChild(body);
  return box;
}

function buildIntro(): HTMLElement {
  const intro = document.createElement('p');
  intro.className = 'text-zinc-300 leading-snug';
  intro.textContent = 'Pick a size that matches your hardware. The "Total GPU" figure on each card is the estimated memory at the current context window — weights plus KV cache pre-allocated at startup.';
  return intro;
}

/** Surface browser storage usage so the user can see how close they are to
 *  the per-origin quota before downloading another 5 GB of weights. The
 *  numbers come from `navigator.storage.estimate()` and cover everything
 *  this origin stores (Cache API, IndexedDB, OPFS) — not just our models —
 *  but in practice models dwarf the rest. */
async function renderStorageBanner(host: HTMLElement): Promise<void> {
  const usage = await getStorageUsage();
  host.replaceChildren();
  if (usage.unavailable) {
    const line = document.createElement('div');
    line.className = 'text-[11px] text-zinc-500';
    line.textContent = 'Browser storage info unavailable in this browser.';
    host.appendChild(line);
    return;
  }
  const used = formatBytes(usage.usageBytes);
  const quota = formatBytes(usage.quotaBytes);
  const pct = usage.quotaBytes > 0
    ? Math.min(100, Math.round((usage.usageBytes / usage.quotaBytes) * 100))
    : 0;

  const wrap = document.createElement('div');
  wrap.className = 'rounded border border-zinc-700 bg-zinc-900/40 px-3 py-2 flex flex-col gap-1.5 text-[11px] text-zinc-400 leading-snug';

  const top = document.createElement('div');
  top.className = 'flex items-center justify-between gap-2';
  const left = document.createElement('div');
  left.className = 'text-zinc-300';
  left.innerHTML = `<strong>${used}</strong> used of <strong>${quota}</strong> available for this site`;
  top.appendChild(left);
  if (usage.persistent) {
    const pill = document.createElement('span');
    pill.className = 'px-1.5 py-0.5 rounded text-[10px] bg-emerald-900/40 text-emerald-200 border border-emerald-800/60';
    pill.textContent = 'persistent';
    pill.title = 'You have granted persistent storage; the browser will not evict cached weights under storage pressure.';
    top.appendChild(pill);
  }
  wrap.appendChild(top);

  // Progress bar — colors mirror the chat panel's context meter so the
  // amber/red thresholds read as "getting full".
  const bar = document.createElement('div');
  bar.className = 'w-full h-1.5 bg-zinc-800 rounded-full overflow-hidden';
  const barColor = pct < 60 ? 'bg-emerald-500' : pct < 85 ? 'bg-amber-500' : 'bg-red-500';
  const fill = document.createElement('div');
  fill.className = `h-full ${barColor}`;
  fill.style.width = `${pct}%`;
  bar.appendChild(fill);
  wrap.appendChild(bar);

  const hint = document.createElement('div');
  hint.className = 'text-[10px] text-zinc-500';
  hint.textContent = 'Includes Partwright sessions and any cached model weights. The browser may evict this storage if your disk fills up; clearing site data also wipes it.';
  wrap.appendChild(hint);

  host.appendChild(wrap);
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let n = bytes;
  let i = 0;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(n < 10 ? 1 : 0)} ${units[i]}`;
}

function renderGpuBanner(host: HTMLElement): void {
  host.replaceChildren();
  if (webGpuStatus.state === 'checking') {
    const wait = document.createElement('div');
    wait.className = 'rounded border border-zinc-700 bg-zinc-900/40 px-3 py-2 text-xs text-zinc-400';
    wait.textContent = 'Checking WebGPU support…';
    host.appendChild(wait);
    return;
  }
  if (webGpuStatus.state === 'ok') {
    const ok = document.createElement('div');
    ok.className = 'rounded border border-emerald-700/50 bg-emerald-900/20 px-3 py-2 text-xs text-emerald-200';
    ok.textContent = 'WebGPU detected — your browser can run local models.';
    host.appendChild(ok);
    return;
  }
  const bad = document.createElement('div');
  bad.className = 'rounded border border-red-700/60 bg-red-900/20 px-3 py-2 text-xs text-red-200 leading-snug';
  bad.innerHTML = `<strong>WebGPU is not available here.</strong> ${escapeHtml(webGpuStatus.reason)} Local models need WebGPU — try the latest Chrome or Safari 26+.`;
  host.appendChild(bad);
}

function renderModelCard(
  model: LocalModelInfo,
  activeId: string | null,
  parentBody: HTMLElement,
  cb: AiLocalModalCallbacks,
): HTMLElement {
  const isActive = model.id === activeId;
  const isCached = cachedSet.has(model.id);
  const isResident = isModelLoaded(model.id);

  const card = document.createElement('div');
  card.className = isActive
    ? 'rounded border border-blue-600/60 bg-blue-900/10 p-3 flex flex-col gap-2'
    : 'rounded border border-zinc-700 bg-zinc-900/40 p-3 flex flex-col gap-2';

  const row = document.createElement('div');
  row.className = 'flex items-start justify-between gap-2';
  const left = document.createElement('div');
  left.className = 'flex flex-col gap-0.5 min-w-0';
  const head = document.createElement('div');
  head.className = 'flex items-center gap-2 flex-wrap';
  const name = document.createElement('div');
  name.className = 'text-sm font-medium text-zinc-100';
  name.textContent = model.label;
  head.appendChild(name);

  // Quality stars (filled count of 3) for THIS app's use case — driving
  // tool calls for CAD modeling. A 70B with mediocre tool-calling rates
  // lower than an 8B fine-tuned for tools, which is why we don't just
  // sort by parameter count.
  const stars = document.createElement('span');
  stars.className = 'text-[11px] text-amber-300';
  stars.textContent = '★'.repeat(model.qualityStars) + '☆'.repeat(3 - model.qualityStars);
  stars.title = `Quality rating for tool-driven modeling (${model.qualityStars}/3 stars).`;
  head.appendChild(stars);

  if (isResident) {
    const pill = document.createElement('span');
    pill.className = 'text-[10px] px-1.5 py-0.5 rounded bg-emerald-700/40 text-emerald-200 border border-emerald-700/60';
    pill.textContent = 'In GPU';
    head.appendChild(pill);
  } else if (isCached) {
    const pill = document.createElement('span');
    pill.className = 'text-[10px] px-1.5 py-0.5 rounded bg-zinc-700 text-zinc-300';
    pill.textContent = 'Downloaded';
    head.appendChild(pill);
  }
  if (model.officialToolCalling) {
    const pill = document.createElement('span');
    pill.className = 'text-[10px] px-1.5 py-0.5 rounded bg-violet-900/40 text-violet-200 border border-violet-800/60';
    pill.title = 'Officially fine-tuned for tool calling — most reliable at running our tools.';
    pill.textContent = 'Native tools';
    head.appendChild(pill);
  } else {
    const pill = document.createElement('span');
    pill.className = 'text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400 border border-zinc-700';
    pill.title = 'Uses prompt-engineered tool calls (model emits <tool_call> markup we parse).';
    pill.textContent = 'Prompt tools';
    head.appendChild(pill);
  }
  if (model.supportsVision) {
    const pill = document.createElement('span');
    pill.className = 'text-[10px] px-1.5 py-0.5 rounded bg-amber-900/40 text-amber-200 border border-amber-800/60';
    pill.textContent = 'Vision';
    head.appendChild(pill);
  }
  left.appendChild(head);

  const blurb = document.createElement('div');
  blurb.className = 'text-[11px] text-zinc-400 leading-snug';
  blurb.textContent = model.blurb;
  left.appendChild(blurb);

  const stats = document.createElement('div');
  stats.className = 'text-[10px] text-zinc-500';
  const ctx = effectiveContextWindow(model.id, model.contextWindowSize);

  function renderStats(ctxTokens: number): void {
    const totalMB = totalMemoryMB(model, ctxTokens);
    const totalGB = (totalMB / 1024).toFixed(1);
    // Colour-code based on absolute thresholds (device budget probe is async and
    // may not be ready; absolute numbers are more actionable than percentages).
    // ≤7 GB: green (safe on 16 GB), 7–10 GB: amber (tight on 16 GB), >10 GB: red
    const riskColor = totalMB <= 7168 ? 'text-emerald-400'
      : totalMB <= 10240 ? 'text-amber-400'
      : 'text-red-400';
    stats.innerHTML =
      `~${model.downloadGB.toFixed(1)} GB download · ${(model.vramMB / 1024).toFixed(1)} GB weights · ${formatTokens(ctxTokens)} ctx · ${model.promptTier} prompt` +
      ` · Total GPU: <span class="${riskColor} font-medium">~${totalGB} GB</span>`;
  }
  renderStats(ctx);

  // Kick off a background fetch of the model's mlc-chat-config.json so
  // the displayed context tightens up to the actual WASM ceiling on a
  // subsequent re-render. First open shows the curated default; later
  // opens show the precise number.
  if (effectiveContextCeiling(model.id, -1) < 0) {
    void getModelCeiling(model.id, `https://huggingface.co/mlc-ai/${model.id}`).then(c => {
      if (c !== null) renderStats(effectiveContextWindow(model.id, model.contextWindowSize));
    });
  }
  left.appendChild(stats);

  const recommended = document.createElement('div');
  recommended.className = 'text-[10px] text-zinc-500 leading-snug';
  recommended.textContent = `Runs well on: ${model.recommendedSystem}`;
  left.appendChild(recommended);

  const source = document.createElement('a');
  source.href = `https://huggingface.co/mlc-ai/${model.id}`;
  source.target = '_blank';
  source.rel = 'noopener noreferrer';
  source.className = 'text-[10px] text-zinc-500 hover:text-zinc-300 underline truncate';
  source.textContent = `huggingface.co/mlc-ai/${model.id}`;
  source.title = `Inspect the weights on Hugging Face before downloading.`;
  left.appendChild(source);

  row.appendChild(left);

  const actions = document.createElement('div');
  actions.className = 'flex flex-col items-end gap-1 shrink-0';

  const primary = document.createElement('button');
  if (isActive && isResident) {
    primary.className = 'px-3 py-1.5 rounded text-xs font-medium bg-emerald-700/40 text-emerald-200 border border-emerald-700/60 cursor-default';
    primary.textContent = 'Active';
    primary.disabled = true;
  } else if (isCached) {
    primary.className = 'px-3 py-1.5 rounded text-xs font-medium bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-50';
    primary.textContent = 'Use this model';
    primary.addEventListener('click', () => { void selectModel(model.id, parentBody, cb); });
  } else {
    primary.className = 'px-3 py-1.5 rounded text-xs font-medium bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-50 disabled:cursor-not-allowed';
    primary.textContent = `Download ${model.downloadGB.toFixed(1)} GB`;
    if (webGpuStatus.state === 'bad') primary.disabled = true;
    primary.addEventListener('click', () => { void selectModel(model.id, parentBody, cb); });
  }
  actions.appendChild(primary);

  if (isCached) {
    const remove = document.createElement('button');
    remove.className = 'px-2 py-0.5 rounded text-[10px] text-zinc-400 hover:text-red-300 hover:bg-red-900/30 border border-transparent';
    remove.textContent = 'Remove';
    remove.title = `Delete the cached weights for ${model.label}.`;
    remove.addEventListener('click', async () => {
      if (!confirm(`Delete cached weights for ${model.label}? You'll need to re-download to use it again.`)) return;
      // If this was the active model, clear it from settings — otherwise
      // the chat panel tries to send to a model whose weights are gone.
      let s = loadSettings();
      if (s.toggles.localModel === model.id) {
        s = setLocalModel(s, null);
        saveSettings(s);
      }
      await deleteCachedModel(model.id);
      cb.onChange();
      await rerender(parentBody, cb);
    });
    actions.appendChild(remove);
  }

  row.appendChild(actions);
  card.appendChild(row);

  return card;
}

async function selectModel(modelId: string, parentBody: HTMLElement, cb: AiLocalModalCallbacks): Promise<void> {
  // Disable everything in the modal while we download / load.
  const oldBody = parentBody.cloneNode(false) as HTMLElement;
  parentBody.replaceWith(oldBody);
  // Note: we leave the modal up; below we replace contents with progress UI.

  const progressWrap = document.createElement('div');
  progressWrap.className = 'flex flex-col gap-3 py-2';
  oldBody.appendChild(progressWrap);

  const title = document.createElement('div');
  title.className = 'text-sm text-zinc-100 font-medium';
  title.textContent = `Loading ${modelId}`;
  progressWrap.appendChild(title);

  const status = document.createElement('div');
  status.className = 'text-xs text-zinc-400 leading-snug';
  status.textContent = 'Preparing engine...';
  progressWrap.appendChild(status);

  const barOuter = document.createElement('div');
  barOuter.className = 'w-full h-2 bg-zinc-700 rounded overflow-hidden';
  const bar = document.createElement('div');
  bar.className = 'h-full bg-blue-500 transition-all';
  bar.style.width = '0%';
  barOuter.appendChild(bar);
  progressWrap.appendChild(barOuter);

  const hint = document.createElement('div');
  hint.className = 'text-[11px] text-zinc-500 leading-snug';
  hint.textContent = 'First time? This downloads the weights from huggingface.co/mlc-ai and caches them in your browser. Closing this tab cancels the download.';
  progressWrap.appendChild(hint);

  try {
    await ensureModelLoaded(modelId, {
      onProgress: report => {
        status.textContent = report.text || 'Loading...';
        if (Number.isFinite(report.progress)) {
          bar.style.width = `${Math.max(0, Math.min(1, report.progress)) * 100}%`;
        }
      },
    });
    // Flip the active provider/model so the next chat turn uses it.
    let settings = loadSettings();
    settings = setLocalModel(settings, modelId);
    settings = setProvider(settings, 'local');
    saveSettings(settings);

    status.textContent = 'Ready.';
    bar.style.width = '100%';
    cb.onChange();

    // Re-render the model list so the just-loaded model shows as Active.
    await rerender(oldBody, cb);
  } catch (err) {
    status.textContent = `Failed to load: ${err instanceof Error ? err.message : String(err)}`;
    bar.style.background = '#dc2626';
    const back = document.createElement('button');
    back.className = 'self-start mt-2 px-3 py-1.5 rounded text-xs text-zinc-200 bg-zinc-700 hover:bg-zinc-600';
    back.textContent = 'Back';
    back.addEventListener('click', () => { void rerender(oldBody, cb); });
    progressWrap.appendChild(back);
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

function closeModal(): void {
  if (escHandler) {
    document.removeEventListener('keydown', escHandler);
    escHandler = null;
  }
  modalEl?.remove();
  modalEl = null;
}
