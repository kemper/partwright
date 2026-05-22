// Review modal: pick a DIFFERENT provider/model than the one currently
// driving the chat, optionally type a focus prompt, and fire a one-shot
// review of the current session state. Defaults to the first connected
// provider that isn't the active one so the most common flow ("Claude
// is driving — get a second opinion from GPT/Gemini") is one click away.

import { gatherReviewContext, runReview, type ReviewContext } from '../ai/review';
import { ANTHROPIC_MODEL_OPTIONS, OPENAI_MODEL_OPTIONS, GEMINI_MODEL_OPTIONS, providerLabel, loadSettings } from '../ai/settings';
import { getKey } from '../ai/db';
import { formatUsd, estimateTurnCostUsd } from '../ai/cost';
import { showAiKeyModal } from './aiKeyModal';
import { showAiLocalModal } from './aiLocalModal';
import { createModalShell } from './modalShell';
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

const HOSTED_PROVIDERS: Provider[] = ['anthropic', 'openai', 'gemini'];
const ALL_PROVIDERS: Provider[] = ['anthropic', 'openai', 'gemini', 'local'];

export async function showAiReviewModal(cb: ReviewModalCallbacks): Promise<void> {
  const shell = createModalShell({ title: 'Get a second opinion', maxWidth: 'lg', scrollable: true });
  shell.body.classList.remove('gap-3');
  shell.body.classList.add('gap-4');

  const intro = document.createElement('p');
  intro.className = 'text-xs text-zinc-400 leading-snug';
  intro.textContent = 'Send the current code, geometry stats, session notes, and a 4-iso render to another model for review. Pick a different provider than the one driving the chat for a fresh perspective.';
  shell.body.appendChild(intro);

  // Probe which providers have a usable backing — hosted = key present,
  // local = a model has been selected.
  const settings = loadSettings();
  const availability: Record<Provider, boolean> = {
    anthropic: !!(await getKey('anthropic')),
    openai: !!(await getKey('openai')),
    gemini: !!(await getKey('gemini')),
    local: !!settings.toggles.localModel,
  };

  // Reviewer picker.
  const pickerRow = document.createElement('div');
  pickerRow.className = 'flex flex-col gap-2';

  const pickerLabel = document.createElement('div');
  pickerLabel.className = 'text-xs uppercase tracking-wider text-zinc-500 font-semibold';
  pickerLabel.textContent = 'Reviewer';
  pickerRow.appendChild(pickerLabel);

  const selectRow = document.createElement('div');
  selectRow.className = 'flex items-center gap-2';
  const provSel = document.createElement('select');
  provSel.className = 'px-2 py-1 rounded text-xs bg-zinc-900 border border-zinc-600 text-zinc-100';
  for (const p of ALL_PROVIDERS) {
    const o = document.createElement('option');
    o.value = p;
    o.textContent = `${providerLabel(p)}${availability[p] ? '' : ' (not ready)'}`;
    provSel.appendChild(o);
  }
  const defaultProvider: Provider =
    HOSTED_PROVIDERS.find(p => p !== cb.activeProvider && availability[p])
      ?? HOSTED_PROVIDERS.find(p => availability[p])
      ?? cb.activeProvider;
  provSel.value = defaultProvider;

  const modelSel = document.createElement('select');
  modelSel.className = 'px-2 py-1 rounded text-xs bg-zinc-900 border border-zinc-600 text-zinc-100 flex-1';
  const localChip = document.createElement('button');
  localChip.type = 'button';
  localChip.className = 'flex-1 px-2 py-1 rounded text-xs bg-emerald-900/30 border border-emerald-700/50 text-emerald-200 hover:bg-emerald-900/50 text-left';
  localChip.addEventListener('click', () => {
    void showAiLocalModal({ onChange: () => { renderModelControl(); updatePreviewCost(); } });
  });

  function modelOptionsFor(p: Provider): { id: string; label: string }[] {
    switch (p) {
      case 'anthropic': return ANTHROPIC_MODEL_OPTIONS;
      case 'openai': return OPENAI_MODEL_OPTIONS;
      case 'gemini': return GEMINI_MODEL_OPTIONS;
      case 'local': return []; // chip path
    }
  }

  function defaultModelFor(p: Provider): string {
    switch (p) {
      case 'anthropic': return settings.toggles.anthropicModel;
      case 'openai': return settings.toggles.openaiModel;
      case 'gemini': return settings.toggles.geminiModel;
      case 'local': return settings.toggles.localModel ?? '';
    }
  }

  function renderModelControl(): void {
    selectRow.replaceChildren();
    selectRow.appendChild(provSel);
    const p = provSel.value as Provider;
    if (p === 'local') {
      if (settings.toggles.localModel) {
        try {
          const info = resolveLocalModel(settings.toggles.localModel);
          localChip.textContent = `${info.label}${isModelLoaded(info.id) ? ' (in GPU)' : ' (not loaded)'}`;
        } catch {
          localChip.textContent = 'Pick local model';
        }
      } else {
        localChip.textContent = 'Pick local model';
      }
      selectRow.appendChild(localChip);
    } else {
      modelSel.replaceChildren();
      for (const opt of modelOptionsFor(p)) {
        const o = document.createElement('option');
        o.value = opt.id;
        o.textContent = opt.label;
        modelSel.appendChild(o);
      }
      modelSel.value = defaultModelFor(p);
      selectRow.appendChild(modelSel);
    }
  }
  modelSel.addEventListener('change', () => updatePreviewCost());
  provSel.addEventListener('change', () => { renderModelControl(); updatePreviewCost(); });
  renderModelControl();

  pickerRow.appendChild(selectRow);
  shell.body.appendChild(pickerRow);

  // Focus prompt (optional).
  const focusLabel = document.createElement('label');
  focusLabel.className = 'flex flex-col gap-1';
  const focusHeader = document.createElement('span');
  focusHeader.className = 'text-xs uppercase tracking-wider text-zinc-500 font-semibold';
  focusHeader.textContent = 'Focus (optional)';
  focusLabel.appendChild(focusHeader);
  const focusInput = document.createElement('textarea');
  focusInput.rows = 2;
  focusInput.placeholder = 'e.g. "Is the wall thickness print-safe?" or "Does the handle attach in a sensible spot?"';
  focusInput.className = 'w-full px-2 py-1.5 rounded bg-zinc-900 border border-zinc-600 text-zinc-100 text-xs placeholder:text-zinc-500 resize-y';
  focusLabel.appendChild(focusInput);
  shell.body.appendChild(focusLabel);

  // Context preview.
  const previewHeader = document.createElement('div');
  previewHeader.className = 'text-xs uppercase tracking-wider text-zinc-500 font-semibold';
  previewHeader.textContent = 'Reviewer will see';
  shell.body.appendChild(previewHeader);

  const previewWrap = document.createElement('div');
  previewWrap.className = 'flex flex-col gap-2 text-xs text-zinc-300';
  shell.body.appendChild(previewWrap);

  const previewLoading = document.createElement('p');
  previewLoading.className = 'text-zinc-500';
  previewLoading.textContent = 'Capturing snapshot + gathering context...';
  previewWrap.appendChild(previewLoading);

  const errorBox = document.createElement('div');
  errorBox.className = 'text-xs text-red-400 hidden';
  shell.body.appendChild(errorBox);

  const noKeyBox = document.createElement('div');
  noKeyBox.className = 'text-xs text-amber-400 hidden flex items-center gap-2';
  shell.body.appendChild(noKeyBox);

  const costEl = document.createElement('p');
  costEl.className = 'text-[10px] text-zinc-500';
  shell.body.appendChild(costEl);

  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'px-3 py-1.5 rounded text-xs text-zinc-300 hover:bg-zinc-700';
  cancelBtn.textContent = 'Cancel';
  cancelBtn.addEventListener('click', shell.close);
  shell.footer.appendChild(cancelBtn);

  const runBtn = document.createElement('button');
  runBtn.className = 'px-3 py-1.5 rounded text-xs font-medium bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-50 disabled:cursor-not-allowed';
  runBtn.textContent = 'Run review';
  shell.footer.appendChild(runBtn);

  let context: ReviewContext | null = null;

  function activeReviewerModel(): string {
    const p = provSel.value as Provider;
    if (p === 'local') return loadSettings().toggles.localModel ?? '';
    return modelSel.value;
  }

  function updatePreview() {
    previewWrap.replaceChildren();
    if (!context) return;
    const itemize = (label: string, detail: string) => {
      const row = document.createElement('div');
      row.className = 'flex items-start gap-2';
      const dot = document.createElement('span');
      dot.className = 'mt-0.5 inline-block w-1.5 h-1.5 rounded-full bg-emerald-400';
      const txt = document.createElement('span');
      txt.innerHTML = `<span class="text-zinc-100">${escape(label)}</span> <span class="text-zinc-500">${escape(detail)}</span>`;
      row.appendChild(dot); row.appendChild(txt);
      previewWrap.appendChild(row);
    };
    itemize('Current code', `${context.language} · ${context.code.length} chars`);
    itemize('Geometry stats', context.geometryStats === '(no current geometry)' ? '(none — code not run)' : 'volume / surfaceArea / triangle count / bounding box');
    itemize('Session notes', `${context.notes.length} note(s)`);
    itemize('Snapshot', context.snapshot ? '4-iso composite PNG (~1500 tokens)' : '— no rendered geometry yet');
  }

  function updatePreviewCost() {
    const prov = provSel.value as Provider;
    const model = activeReviewerModel();
    if (!model) { costEl.textContent = ''; return; }
    const codeChars = context?.code.length ?? 1500;
    const notesChars = (context?.notes.join('\n').length ?? 0);
    const focusChars = focusInput.value.length;
    const tokens = Math.round((codeChars + notesChars + focusChars + 800) / 4) + (context?.snapshot ? 1500 : 0);
    const est = estimateTurnCostUsd(prov, model, 0, tokens, 200);
    costEl.textContent = prov === 'local' ? 'Local model: free at the API level.' : `Estimated cost: ~${formatUsd(est)}`;
  }
  focusInput.addEventListener('input', updatePreviewCost);

  runBtn.addEventListener('click', async () => {
    const prov = provSel.value as Provider;
    const model = activeReviewerModel();
    if (!model) {
      errorBox.textContent = prov === 'local' ? 'Pick a local model first (above).' : 'Pick a model from the dropdown.';
      errorBox.classList.remove('hidden');
      return;
    }
    if (prov !== 'local' && !availability[prov]) {
      noKeyBox.replaceChildren();
      noKeyBox.classList.remove('hidden');
      const msg = document.createElement('span');
      msg.textContent = `No key for ${providerLabel(prov)}. `;
      noKeyBox.appendChild(msg);
      const connectBtn = document.createElement('button');
      connectBtn.className = 'underline text-amber-200 hover:text-amber-100';
      connectBtn.textContent = 'Connect now';
      connectBtn.addEventListener('click', () => {
        void showAiKeyModal({ provider: prov, onConnected: () => { noKeyBox.classList.add('hidden'); availability[prov] = true; } });
      });
      noKeyBox.appendChild(connectBtn);
      return;
    }
    if (!context) return;
    runBtn.disabled = true;
    runBtn.textContent = 'Sending...';
    errorBox.classList.add('hidden');
    try {
      const result = await runReview({
        provider: prov,
        model,
        context: { ...context, focus: focusInput.value.trim() || undefined },
        sessionId: cb.sessionId,
      });
      cb.onReviewPosted(result.message);
      shell.close();
    } catch (err) {
      errorBox.textContent = `Review failed: ${err instanceof Error ? err.message : String(err)}`;
      errorBox.classList.remove('hidden');
      runBtn.disabled = false;
      runBtn.textContent = 'Run review';
    }
  });

  try {
    context = await gatherReviewContext();
    updatePreview();
    updatePreviewCost();
  } catch (err) {
    previewWrap.replaceChildren();
    const errMsg = document.createElement('p');
    errMsg.className = 'text-amber-400';
    errMsg.textContent = `Couldn't gather context: ${err instanceof Error ? err.message : String(err)}`;
    previewWrap.appendChild(errMsg);
    runBtn.disabled = true;
  }
}

function escape(s: string): string {
  return s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] ?? c));
}
