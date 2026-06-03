// Self-Modeling Studio — the UI for multi-view silhouette reconstruction.
//
// Flow: upload a source photo → generate a turntable of alternate angles with
// Gemini "nano banana" (or upload them by hand) → watch the tiles fill in →
// curate (toggle / regenerate / replace) → carve the included views into a
// voxel model. The whole import (source + per-angle images + carve settings) is
// handed back via onPersist so reopening it doesn't re-spend Gemini calls.
//
// This is a self-owned overlay (not createModalShell) so the AI-key modal can
// pop over it without the single-shell guard dismissing the studio.

import {
  newStudioState,
  frontView,
  anglePrompt,
  buildReconInput,
  readiness,
  serializeStudio,
  type StudioState,
  type StudioView,
  type StudioImportRecord,
  type CarveSettings,
} from '../recon/studioModel';
import { getKey } from '../ai/db';
import { listGeminiImageModels, generateAngleImage, pickImageModel, dataUrlToInline } from '../ai/geminiImage';
import { getConfig } from '../config/appConfig';
import { showAiKeyModal } from './aiKeyModal';
import { BUTTON_PRIMARY, BUTTON_CANCEL, BUTTON_SMALL_SECONDARY } from './styleConstants';

export interface SelfModelingStudioOptions {
  /** Reopen a previously-saved import instead of starting fresh. */
  initialState?: StudioState | null;
  /** Carve the included views into a voxel session. Implemented by the host as
   *  `partwright.reconstructFromSilhouettes`. */
  onBuild: (input: { views: Array<{ src: string; azimuth: number; elevation: number }>; options: CarveSettings }) =>
    Promise<{ sessionId?: string; voxelCount?: number; views?: number; error?: string }>;
  /** Persist the import history onto the newly-built session. */
  onPersist?: (sessionId: string, record: StudioImportRecord) => Promise<void>;
}

let isOpen = false;

export function openSelfModelingStudio(options: SelfModelingStudioOptions): void {
  if (isOpen) return;
  isOpen = true;

  const state: StudioState = options.initialState ?? newStudioState('standard12');
  let apiKey: string | null = null;
  let availableModels: string[] = [];
  let generating = false;
  let abort: AbortController | null = null;

  // ── Overlay + panel ────────────────────────────────────────────────────
  const overlay = document.createElement('div');
  overlay.className = 'fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4';
  const panel = document.createElement('div');
  panel.className = 'bg-zinc-800 rounded-xl shadow-2xl border border-zinc-700 w-full max-w-4xl max-h-[calc(100vh-2rem)] flex flex-col';
  overlay.appendChild(panel);

  const header = document.createElement('div');
  header.className = 'px-5 py-3 border-b border-zinc-700 flex items-center justify-between';
  const title = document.createElement('h2');
  title.className = 'text-sm font-semibold text-zinc-100';
  title.textContent = '🧑‍🎨 Self-Modeling Studio — photo → 3D (experimental)';
  const closeBtn = document.createElement('button');
  closeBtn.className = 'px-2 py-1 rounded text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700 text-sm';
  closeBtn.textContent = '✕';
  closeBtn.addEventListener('click', () => close());
  header.append(title, closeBtn);

  const body = document.createElement('div');
  body.className = 'px-5 py-4 flex flex-col gap-4 text-sm text-zinc-200 overflow-y-auto flex-1 min-h-0';

  const footer = document.createElement('div');
  footer.className = 'px-5 py-3 border-t border-zinc-700 flex items-center justify-between gap-2';
  panel.append(header, body, footer);
  document.body.appendChild(overlay);

  const escHandler = (e: KeyboardEvent) => { if (e.key === 'Escape' && !generating) close(); };
  document.addEventListener('keydown', escHandler);
  overlay.addEventListener('mousedown', (e) => { if (e.target === overlay && !generating) close(); });

  function close(): void {
    abort?.abort();
    document.removeEventListener('keydown', escHandler);
    overlay.remove();
    isOpen = false;
  }

  // ── Sections (built once, refreshed on state change) ──────────────────────
  const keyBanner = document.createElement('div');
  const sourceSection = document.createElement('div');
  const controlsSection = document.createElement('div');
  const gridSection = document.createElement('div');
  gridSection.className = 'grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2';
  const carveSection = document.createElement('div');
  const statusEl = document.createElement('div');
  statusEl.className = 'text-xs text-zinc-400 min-h-[1rem]';
  body.append(keyBanner, sourceSection, controlsSection,
    sectionLabel('Angles'), gridSection,
    sectionLabel('Carve settings'), carveSection, statusEl);

  // Footer: readiness + Build / Cancel.
  const readyEl = document.createElement('div');
  readyEl.className = 'text-xs text-zinc-400';
  const footBtns = document.createElement('div');
  footBtns.className = 'flex items-center gap-2';
  const cancelBtn = button('Close', BUTTON_CANCEL, () => close());
  const buildBtn = button('Build 3D model', BUTTON_PRIMARY, () => void doBuild());
  footBtns.append(cancelBtn, buildBtn);
  footer.append(readyEl, footBtns);

  function setStatus(msg: string, kind: 'info' | 'error' = 'info'): void {
    statusEl.textContent = msg;
    statusEl.className = `text-xs min-h-[1rem] ${kind === 'error' ? 'text-rose-400' : 'text-zinc-400'}`;
  }

  // ── Key + model bootstrap ────────────────────────────────────────────────
  async function refreshKeyAndModels(): Promise<void> {
    apiKey = (await getKey('gemini'))?.apiKey ?? null;
    renderKeyBanner();
    if (!apiKey) return;
    if (availableModels.length === 0) {
      try {
        availableModels = await listGeminiImageModels(apiKey);
      } catch { availableModels = []; }
    }
    if (!state.model) {
      state.model = pickImageModel(availableModels) ?? getConfig().ai.geminiImageModel;
    }
    renderControls();
  }

  function renderKeyBanner(): void {
    keyBanner.innerHTML = '';
    if (apiKey) {
      keyBanner.className = 'text-xs text-emerald-400/80';
      keyBanner.textContent = '✓ Google Gemini connected — alternate angles can be generated, or upload your own.';
      return;
    }
    keyBanner.className = 'rounded-lg border border-amber-700/50 bg-amber-900/20 px-3 py-2 flex items-center justify-between gap-3';
    const txt = document.createElement('span');
    txt.className = 'text-xs text-amber-200/90';
    txt.textContent = 'Google Gemini isn’t connected. Connect it to auto-generate angles, or upload your own images for each view.';
    const connect = button('Connect Gemini', BUTTON_SMALL_SECONDARY, () => {
      void showAiKeyModal({ provider: 'gemini', onConnected: () => { void refreshKeyAndModels(); } });
    });
    keyBanner.append(txt, connect);
  }

  // ── Source photo ─────────────────────────────────────────────────────────
  function renderSource(): void {
    sourceSection.innerHTML = '';
    sourceSection.className = 'flex items-center gap-3 rounded-lg border border-zinc-700 bg-zinc-900/40 p-3';
    const front = frontView(state);
    const thumb = document.createElement('div');
    thumb.className = 'w-16 h-16 rounded border border-zinc-700 bg-zinc-900 flex items-center justify-center overflow-hidden shrink-0';
    if (front?.src) {
      const img = document.createElement('img');
      img.src = front.src; img.className = 'w-full h-full object-cover';
      thumb.appendChild(img);
    } else {
      thumb.textContent = '🙂';
    }
    const col = document.createElement('div');
    col.className = 'flex flex-col gap-1';
    const lbl = document.createElement('div');
    lbl.className = 'text-xs font-medium text-zinc-200';
    lbl.textContent = front?.src ? 'Source photo (Front view)' : 'Upload a source photo to start';
    const hint = document.createElement('div');
    hint.className = 'text-[11px] text-zinc-500';
    hint.textContent = 'A clear, front-facing photo on a plain background works best.';
    const pick = button(front?.src ? 'Replace photo' : 'Upload photo', BUTTON_SMALL_SECONDARY, () => {
      pickImageFile((dataUrl, mediaType) => {
        const f = frontView(state);
        if (f) { f.src = dataUrl; f.status = 'ready'; f.origin = 'source'; }
        state.sourceMediaType = mediaType;
        renderAll();
      });
    });
    col.append(lbl, hint, pick);
    sourceSection.append(thumb, col);
  }

  // ── Generate controls + model picker ─────────────────────────────────────
  function renderControls(): void {
    controlsSection.innerHTML = '';
    controlsSection.className = 'flex flex-wrap items-center gap-2';

    if (apiKey && availableModels.length > 0) {
      const sel = document.createElement('select');
      sel.className = 'bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-xs text-zinc-200';
      for (const id of availableModels) {
        const o = document.createElement('option');
        o.value = id; o.textContent = id; o.selected = id === state.model;
        sel.appendChild(o);
      }
      sel.addEventListener('change', () => { state.model = sel.value; });
      const wrap = document.createElement('label');
      wrap.className = 'flex items-center gap-1.5 text-[11px] text-zinc-400';
      wrap.append(document.createTextNode('Image model'), sel);
      controlsSection.appendChild(wrap);
    }

    const genBtn = button(
      generating ? 'Generating…' : 'Generate missing angles',
      BUTTON_PRIMARY,
      () => void generateMissing(),
    );
    (genBtn as HTMLButtonElement).disabled = generating || !apiKey || !frontView(state)?.src;
    if ((genBtn as HTMLButtonElement).disabled) genBtn.classList.add('opacity-50', 'cursor-not-allowed');
    controlsSection.appendChild(genBtn);

    if (generating) {
      controlsSection.appendChild(button('Stop', BUTTON_SMALL_SECONDARY, () => abort?.abort()));
    }
  }

  // ── Angle grid ───────────────────────────────────────────────────────────
  function renderGrid(): void {
    gridSection.innerHTML = '';
    for (const v of state.views) gridSection.appendChild(renderTile(v));
  }

  function renderTile(v: StudioView): HTMLElement {
    const tile = document.createElement('div');
    tile.className = `rounded-lg border ${v.include ? 'border-zinc-700' : 'border-zinc-800 opacity-50'} bg-zinc-900/40 p-2 flex flex-col gap-1`;

    const imgBox = document.createElement('div');
    imgBox.className = 'aspect-square rounded bg-zinc-900 border border-zinc-800 flex items-center justify-center overflow-hidden text-xs text-zinc-600';
    if (v.status === 'generating') {
      imgBox.textContent = '⏳ generating…';
    } else if (v.src) {
      const img = document.createElement('img');
      img.src = v.src; img.className = 'w-full h-full object-cover';
      imgBox.appendChild(img);
    } else if (v.status === 'error') {
      imgBox.textContent = '⚠ failed';
      imgBox.title = v.error ?? '';
    } else {
      imgBox.textContent = '—';
    }
    tile.appendChild(imgBox);

    const meta = document.createElement('div');
    meta.className = 'flex items-center justify-between gap-1';
    const lbl = document.createElement('span');
    lbl.className = 'text-[11px] font-medium text-zinc-300 truncate';
    lbl.textContent = v.angle.label;
    lbl.title = `az ${v.angle.azimuth}° · el ${v.angle.elevation}°`;
    const inc = document.createElement('input');
    inc.type = 'checkbox'; inc.checked = v.include; inc.title = 'Include in carve';
    inc.className = 'accent-blue-500';
    inc.addEventListener('change', () => { v.include = inc.checked; renderAll(); });
    meta.append(lbl, inc);
    tile.appendChild(meta);

    const actions = document.createElement('div');
    actions.className = 'flex items-center gap-1';
    if (v.origin !== 'source' && apiKey) {
      const regen = iconBtn(v.src ? '↻' : '✨', v.src ? 'Regenerate' : 'Generate', () => void generateOne(v));
      (regen as HTMLButtonElement).disabled = generating || !frontView(state)?.src;
      actions.appendChild(regen);
    }
    actions.appendChild(iconBtn('⬆', 'Upload an image for this angle', () => {
      pickImageFile((dataUrl) => { v.src = dataUrl; v.status = 'ready'; v.origin = 'upload'; renderAll(); });
    }));
    if (v.src && v.origin !== 'source') {
      actions.appendChild(iconBtn('🗑', 'Clear this image', () => { v.src = null; v.status = 'empty'; renderAll(); }));
    }
    tile.appendChild(actions);
    return tile;
  }

  // ── Carve settings ───────────────────────────────────────────────────────
  function renderCarve(): void {
    carveSection.innerHTML = '';
    carveSection.className = 'grid grid-cols-2 gap-x-4 gap-y-2';
    carveSection.append(
      numberRow('Resolution', state.carve.resolution, 8, 256, 1, (n) => { state.carve.resolution = n; }),
      numberRow('Smoothing', state.carve.smooth, 0, 8, 1, (n) => { state.carve.smooth = n; }),
      numberRow('Frame fill', state.carve.frameFill, 0.1, 2, 0.05, (n) => { state.carve.frameFill = n; }),
      checkboxRow('Colour from views', state.carve.colorFromViews, (b) => { state.carve.colorFromViews = b; }),
    );
  }

  function renderFooter(): void {
    const r = readiness(state);
    readyEl.textContent = `${r.ready} of ${r.total} views ready${r.canCarve ? '' : ' — need at least 2'}`;
    (buildBtn as HTMLButtonElement).disabled = !r.canCarve || generating;
    buildBtn.classList.toggle('opacity-50', (buildBtn as HTMLButtonElement).disabled);
    buildBtn.classList.toggle('cursor-not-allowed', (buildBtn as HTMLButtonElement).disabled);
  }

  function renderAll(): void {
    renderSource(); renderControls(); renderGrid(); renderCarve(); renderFooter();
  }

  // ── Generation ───────────────────────────────────────────────────────────
  async function generateOne(v: StudioView): Promise<void> {
    const front = frontView(state);
    if (!apiKey || !front?.src || !state.model) { setStatus('Connect Gemini and upload a source photo first.', 'error'); return; }
    abort = new AbortController();
    generating = true; v.status = 'generating'; v.error = undefined; renderAll();
    try {
      const dataUrl = await generateAngleImage({
        apiKey, model: state.model, source: dataUrlToInline(front.src),
        prompt: anglePrompt(v.angle), signal: abort.signal,
      });
      v.src = dataUrl; v.status = 'ready'; v.origin = 'gemini';
      setStatus(`Generated ${v.angle.label}.`);
    } catch (e) {
      v.status = 'error'; v.error = (e as Error).message;
      setStatus(`Failed to generate ${v.angle.label}: ${v.error}`, 'error');
    } finally {
      generating = false; abort = null; renderAll();
    }
  }

  async function generateMissing(): Promise<void> {
    const front = frontView(state);
    if (!apiKey || !front?.src || !state.model) { setStatus('Connect Gemini and upload a source photo first.', 'error'); return; }
    const targets = state.views.filter(v => v.origin !== 'source' && v.include && v.status !== 'ready' && !v.src);
    if (targets.length === 0) { setStatus('No missing angles to generate.'); return; }
    abort = new AbortController();
    generating = true; renderControls(); renderFooter();
    let done = 0;
    for (const v of targets) {
      if (abort.signal.aborted) break;
      v.status = 'generating'; v.error = undefined; renderGrid();
      setStatus(`Generating ${v.angle.label} (${done + 1}/${targets.length})…`);
      try {
        const dataUrl = await generateAngleImage({
          apiKey, model: state.model, source: dataUrlToInline(front.src),
          prompt: anglePrompt(v.angle), signal: abort.signal,
        });
        v.src = dataUrl; v.status = 'ready'; v.origin = 'gemini';
      } catch (e) {
        if (abort.signal.aborted) { v.status = 'empty'; break; }
        v.status = 'error'; v.error = (e as Error).message;
      }
      done++; renderGrid(); renderFooter();
    }
    const wasAborted = abort.signal.aborted;
    generating = false; abort = null;
    setStatus(wasAborted ? 'Generation stopped.' : `Generated ${done} angle(s).`);
    renderAll();
  }

  // ── Build ────────────────────────────────────────────────────────────────
  async function doBuild(): Promise<void> {
    if (!readiness(state).canCarve) return;
    setStatus('Carving the visual hull…');
    (buildBtn as HTMLButtonElement).disabled = true;
    try {
      const res = await options.onBuild(buildReconInput(state));
      if (res.error || !res.sessionId) {
        setStatus(`Build failed: ${res.error ?? 'no model produced'}`, 'error');
        renderFooter();
        return;
      }
      await options.onPersist?.(res.sessionId, serializeStudio(state));
      setStatus(`Built a ${res.voxelCount?.toLocaleString() ?? ''}-voxel model from ${res.views ?? 0} views.`);
      close();
    } catch (e) {
      setStatus(`Build failed: ${(e as Error).message}`, 'error');
      renderFooter();
    }
  }

  // First paint, then resolve key/model async.
  renderAll();
  if (options.initialState) setStatus('Reopened a saved import — no Gemini calls needed.');
  void refreshKeyAndModels();
}

// ── Small DOM helpers ────────────────────────────────────────────────────────

function sectionLabel(text: string): HTMLElement {
  const el = document.createElement('div');
  el.className = 'text-[11px] font-semibold uppercase tracking-wide text-zinc-500 -mb-1';
  el.textContent = text;
  return el;
}

function button(label: string, cls: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.className = cls; b.textContent = label;
  b.addEventListener('click', onClick);
  return b;
}

function iconBtn(glyph: string, title: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.className = 'flex-1 px-1 py-0.5 rounded text-[11px] text-zinc-300 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 disabled:opacity-40';
  b.textContent = glyph; b.title = title;
  b.addEventListener('click', onClick);
  return b;
}

function numberRow(label: string, value: number, min: number, max: number, step: number, onChange: (n: number) => void): HTMLElement {
  const wrap = document.createElement('label');
  wrap.className = 'flex items-center justify-between gap-2 text-xs text-zinc-300';
  const span = document.createElement('span'); span.textContent = label;
  const input = document.createElement('input');
  input.type = 'number'; input.min = String(min); input.max = String(max); input.step = String(step);
  input.value = String(value);
  input.className = 'w-20 bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-xs text-zinc-200';
  input.addEventListener('change', () => {
    let n = Number(input.value);
    if (!Number.isFinite(n)) n = value;
    n = Math.min(max, Math.max(min, n));
    input.value = String(n);
    onChange(n);
  });
  wrap.append(span, input);
  return wrap;
}

function checkboxRow(label: string, checked: boolean, onChange: (b: boolean) => void): HTMLElement {
  const wrap = document.createElement('label');
  wrap.className = 'flex items-center justify-between gap-2 text-xs text-zinc-300';
  const span = document.createElement('span'); span.textContent = label;
  const input = document.createElement('input');
  input.type = 'checkbox'; input.checked = checked; input.className = 'accent-blue-500';
  input.addEventListener('change', () => onChange(input.checked));
  wrap.append(span, input);
  return wrap;
}

/** Open a file picker and hand back the chosen image as a data URL + media type. */
function pickImageFile(onPicked: (dataUrl: string, mediaType: string) => void): void {
  const input = document.createElement('input');
  input.type = 'file'; input.accept = 'image/*'; input.className = 'hidden';
  document.body.appendChild(input);
  input.addEventListener('change', () => {
    const file = input.files?.[0];
    input.remove();
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => onPicked(String(reader.result), file.type || 'image/png');
    reader.readAsDataURL(file);
  });
  input.click();
}
