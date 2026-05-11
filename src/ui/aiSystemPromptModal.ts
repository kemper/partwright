// System prompt editor. Lets the user see + edit the wrapper prompt the
// app sends to each provider, and reset it to the built-in default.
//
// For local models, the default is the slim ~540-token prompt in
// `src/ai/systemPrompt.ts#buildLocalSystemPrompt` — designed to fit inside
// a 4K-token context window. For Anthropic, the default is the full
// `public/ai.md` body (~15K tokens) loaded at runtime.
//
// Edits persist to localStorage via `setSystemPromptOverride`; clearing the
// editor + Save (or clicking Reset) drops back to the built-in default.

import { loadSettings, saveSettings, setSystemPromptOverride } from '../ai/settings';
import { buildLocalSystemPrompt, buildSystemPrompt, loadAiMd } from '../ai/systemPrompt';
import type { Provider } from '../ai/types';

let modalEl: HTMLElement | null = null;

export interface SystemPromptModalCallbacks {
  onChange?: () => void;
}

export async function showSystemPromptModal(provider: Provider, cb: SystemPromptModalCallbacks = {}): Promise<void> {
  closeModal();

  const overlay = document.createElement('div');
  overlay.className = 'fixed inset-0 bg-black/60 flex items-center justify-center z-50';
  overlay.addEventListener('click', e => { if (e.target === overlay) closeModal(); });

  const modal = document.createElement('div');
  modal.className = 'bg-zinc-800 rounded-xl shadow-2xl border border-zinc-700 w-full max-w-2xl flex flex-col max-h-[90vh]';

  // Header
  const header = document.createElement('div');
  header.className = 'px-5 py-3 border-b border-zinc-700 flex items-center justify-between shrink-0';
  const title = document.createElement('h2');
  title.className = 'text-sm font-semibold text-zinc-100';
  title.textContent = `System prompt — ${provider === 'local' ? 'Local (WebGPU)' : 'Anthropic (cloud)'}`;
  header.appendChild(title);
  const closeBtn = document.createElement('button');
  closeBtn.className = 'px-2 py-1 rounded text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700 text-sm';
  closeBtn.textContent = '✕';
  closeBtn.addEventListener('click', closeModal);
  header.appendChild(closeBtn);
  modal.appendChild(header);

  // Body
  const body = document.createElement('div');
  body.className = 'px-5 py-4 flex flex-col gap-3 text-sm text-zinc-200 overflow-y-auto';
  modal.appendChild(body);

  const intro = document.createElement('p');
  intro.className = 'text-zinc-300 leading-snug';
  intro.innerHTML = provider === 'local'
    ? 'This is the wrapper prompt prepended to every message you send to a local model. Local models cap at a <strong>4096-token context window</strong>, so this is a deliberately slim version of the full <code>ai.md</code> docs — about 540 tokens — designed to leave room for the conversation.'
    : 'This is the wrapper prompt prepended to every message you send to hosted Claude. By default it\'s the full <code>public/ai.md</code> body, served with prompt caching so you only pay for it once per cache window.';
  body.appendChild(intro);

  const settings = loadSettings();
  const override = settings.systemPromptOverrides?.[provider] ?? null;
  const defaultPrompt = provider === 'local'
    ? buildLocalSystemPrompt()
    : buildSystemPrompt(await loadAiMd());

  // Source indicator pill
  const sourcePill = document.createElement('div');
  sourcePill.className = 'flex items-center gap-2 text-xs';
  const pill = document.createElement('span');
  if (override !== null) {
    pill.className = 'px-2 py-0.5 rounded bg-amber-900/40 text-amber-200 border border-amber-800/60';
    pill.textContent = 'Custom (your override)';
  } else if (provider === 'local') {
    pill.className = 'px-2 py-0.5 rounded bg-blue-900/40 text-blue-200 border border-blue-800/60';
    pill.textContent = 'Built-in slim prompt';
  } else {
    pill.className = 'px-2 py-0.5 rounded bg-blue-900/40 text-blue-200 border border-blue-800/60';
    pill.textContent = 'Built-in (full public/ai.md)';
  }
  sourcePill.appendChild(pill);
  const tokenInfo = document.createElement('span');
  tokenInfo.className = 'text-zinc-500';
  sourcePill.appendChild(tokenInfo);
  body.appendChild(sourcePill);

  const ta = document.createElement('textarea');
  ta.className = 'w-full min-h-[260px] max-h-[50vh] px-3 py-2 rounded bg-zinc-900 border border-zinc-600 text-zinc-100 text-xs font-mono leading-snug focus:outline-none focus:border-blue-500 resize-y';
  ta.spellcheck = false;
  ta.value = override ?? defaultPrompt;
  ta.addEventListener('input', () => updateTokenInfo());
  body.appendChild(ta);

  function updateTokenInfo() {
    const chars = ta.value.length;
    const approx = Math.round(chars / 4);
    tokenInfo.textContent = `· ${chars.toLocaleString()} chars · ~${approx.toLocaleString()} tokens`;
  }
  updateTokenInfo();

  if (provider === 'local') {
    const warn = document.createElement('div');
    warn.className = 'rounded border border-amber-700/40 bg-amber-900/15 px-3 py-2 text-[11px] text-amber-200 leading-snug';
    warn.innerHTML = 'Keep it short. The 4096-token local-model window is shared between this prompt, the tool docs (~400 tokens), the conversation, and the model\'s reply (~768 tokens reserved). Aim for under 1500 tokens here.';
    body.appendChild(warn);
  }

  modal.appendChild(body);

  // Footer
  const footer = document.createElement('div');
  footer.className = 'px-5 py-3 border-t border-zinc-700 flex items-center justify-between gap-2 shrink-0';

  const left = document.createElement('div');
  left.className = 'flex items-center gap-2';
  const resetBtn = document.createElement('button');
  resetBtn.className = 'px-3 py-1.5 rounded text-xs text-zinc-300 hover:bg-zinc-700 border border-zinc-600';
  resetBtn.textContent = 'Reset to default';
  resetBtn.title = 'Replace the editor contents with the built-in default. Saves nothing until you press Save.';
  resetBtn.addEventListener('click', () => {
    ta.value = defaultPrompt;
    updateTokenInfo();
  });
  left.appendChild(resetBtn);
  footer.appendChild(left);

  const right = document.createElement('div');
  right.className = 'flex items-center gap-2';
  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'px-3 py-1.5 rounded text-xs text-zinc-300 hover:bg-zinc-700';
  cancelBtn.textContent = 'Cancel';
  cancelBtn.addEventListener('click', closeModal);
  right.appendChild(cancelBtn);

  const saveBtn = document.createElement('button');
  saveBtn.className = 'px-3 py-1.5 rounded text-xs font-medium bg-blue-600 hover:bg-blue-500 text-white';
  saveBtn.textContent = 'Save';
  saveBtn.addEventListener('click', () => {
    // If the user saves back exactly the default, clear the override —
    // that way default-prompt improvements ship through next release
    // instead of being frozen at the saved snapshot.
    const value = ta.value;
    const next = value.trim() === defaultPrompt.trim() ? null : value;
    saveSettings(setSystemPromptOverride(loadSettings(), provider, next));
    cb.onChange?.();
    closeModal();
  });
  right.appendChild(saveBtn);
  footer.appendChild(right);

  modal.appendChild(footer);

  overlay.appendChild(modal);
  document.body.appendChild(overlay);
  modalEl = overlay;

  const escHandler = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      closeModal();
      document.removeEventListener('keydown', escHandler);
    }
  };
  document.addEventListener('keydown', escHandler);
}

function closeModal(): void {
  modalEl?.remove();
  modalEl = null;
}
