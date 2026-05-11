// "Run a local model" modal. Lists the size tiers, shows which models the
// user already has cached, surfaces the WebGPU compatibility check, and
// downloads + activates the chosen weights on demand. After a successful
// download the AI settings are flipped to the local provider so the next
// message goes through WebLLM instead of Anthropic.

import {
  LOCAL_MODELS,
  type LocalModelId,
  type LocalModelInfo,
  type LocalSizeTier,
} from '../ai/localModels';
import {
  ensureModelLoaded,
  getCachedModels,
  deleteCachedModel,
  probeWebGpu,
  isModelLoaded,
} from '../ai/local';
import { loadSettings, saveSettings, setLocalModel, setProvider } from '../ai/settings';

let modalEl: HTMLElement | null = null;
let cachedSet: Set<string> = new Set();
let webGpuStatus: { supported: boolean; reason?: string } = { supported: true };

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

  const escHandler = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      closeModal();
      document.removeEventListener('keydown', escHandler);
    }
  };
  document.addEventListener('keydown', escHandler);
}

async function rerender(body: HTMLElement, cb: AiLocalModalCallbacks): Promise<void> {
  body.replaceChildren();
  body.appendChild(buildIntro());

  // Run the WebGPU probe lazily so the modal opens instantly. The probe
  // result is shown right under the intro once it lands.
  const gpuBanner = document.createElement('div');
  body.appendChild(gpuBanner);
  void probeWebGpu().then(r => {
    webGpuStatus = { supported: r.supported, reason: r.reason };
    renderGpuBanner(gpuBanner);
  }).catch(() => {
    webGpuStatus = { supported: false, reason: 'WebGPU probe failed.' };
    renderGpuBanner(gpuBanner);
  });
  renderGpuBanner(gpuBanner);

  // Scan the cache once on open so we know which models show "Loaded" vs
  // "Download". A second open will repeat the scan — cheap, all-promises.
  cachedSet = await getCachedModels();
  const settings = loadSettings();

  const list = document.createElement('div');
  list.className = 'flex flex-col gap-2';
  body.appendChild(list);
  for (const tier of (['small', 'medium', 'large', 'vision'] as LocalSizeTier[])) {
    const model = LOCAL_MODELS.find(m => m.tier === tier);
    if (model) list.appendChild(renderModelCard(model, settings.toggles.localModel, body, cb));
  }

  body.appendChild(buildTrustPanel());
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

function buildIntro(): HTMLElement {
  const intro = document.createElement('p');
  intro.className = 'text-zinc-300 leading-snug';
  intro.textContent = 'Pick a size that matches your hardware. Small fits on most laptops, Large needs a discrete GPU with ~5 GB free VRAM, and Vision lets the model see screenshots of your work.';
  return intro;
}

function renderGpuBanner(host: HTMLElement): void {
  host.replaceChildren();
  if (webGpuStatus.supported) {
    const ok = document.createElement('div');
    ok.className = 'rounded border border-emerald-700/50 bg-emerald-900/20 px-3 py-2 text-xs text-emerald-200';
    ok.textContent = 'WebGPU detected — your browser can run local models.';
    host.appendChild(ok);
  } else {
    const bad = document.createElement('div');
    bad.className = 'rounded border border-red-700/60 bg-red-900/20 px-3 py-2 text-xs text-red-200 leading-snug';
    bad.innerHTML = `<strong>WebGPU is not available here.</strong> ${escapeHtml(webGpuStatus.reason ?? '')} Local models need WebGPU — try the latest Chrome or Safari 26+.`;
    host.appendChild(bad);
  }
}

function renderModelCard(
  model: LocalModelInfo,
  activeId: LocalModelId | null,
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
    pill.textContent = 'Tool calls';
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
  stats.textContent = `~${model.downloadGB.toFixed(1)} GB download · ${(model.vramMB / 1024).toFixed(1)} GB VRAM`;
  left.appendChild(stats);

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
    if (!webGpuStatus.supported) primary.disabled = true;
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

async function selectModel(modelId: LocalModelId, parentBody: HTMLElement, cb: AiLocalModalCallbacks): Promise<void> {
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
  modalEl?.remove();
  modalEl = null;
}
