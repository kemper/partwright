// Right-side floating chat drawer. The single largest UI surface of the AI
// feature — owns the transcript view, the cost-control toggle strip, the
// input row, the cost meter, and the compact button. State lives in the
// ai/* modules; this file is mostly DOM wiring.

import { runTurn, totalCost, totalTokensEstimate, estimateCachedPrefixTokens } from '../ai/chatLoop';
import { listMessages, GLOBAL_CHAT_BUCKET, putMessages, deleteMessages, getKey, clearChat } from '../ai/db';
import { proposeCompaction } from '../ai/compaction';
import { captureIsoViews, fileToImageSource } from '../ai/images';
import { loadSettings, saveSettings, setAnthropicModel, setToggles, ANTHROPIC_MODEL_OPTIONS, MAX_ITERATIONS_OPTIONS, MAX_SPEND_OPTIONS, type AiSettings } from '../ai/settings';
import { buildLocalSystemPrompt, buildMediumLocalSystemPrompt, buildSystemPrompt, loadAiMd } from '../ai/systemPrompt';
import { estimateTurnCostUsd, formatUsd } from '../ai/cost';
import { generateId } from '../storage/db';
import { showAiKeyModal } from './aiKeyModal';
import { showAiSettingsModal } from './aiSettingsModal';
import { showAiLocalModal } from './aiLocalModal';
import { showSystemPromptModal } from './aiSystemPromptModal';
import { showCompactConfirmModal } from './aiCompactModal';
import { showAttachmentModal } from './aiAttachmentModal';
import { putAttachment } from '../ai/attachments';
import { ensureModelLoaded, effectiveContextCeiling, interruptLocal, isModelLoaded, resolveLocalModel } from '../ai/local';
import { activeModel, SPEND_CAP_USD, type AnthropicModelId, type ChatBlock, type ChatMessage, type ChatToggles, type ImageSource, type PersistedToolResult, type TurnOutcomeReason } from '../ai/types';
import { errorLog } from '../diagnostics/errorLog';

interface PanelState {
  open: boolean;
  sessionId: string;
  history: ChatMessage[];
  pendingImages: ImageSource[];
  inFlight: boolean;
  /** Live for the duration of a turn. Stop button aborts via this. Null
   *  when no turn is in flight. */
  inFlightController: AbortController | null;
  /** Blocks the human queued while a turn was in flight. Delivered to the
   *  agent at the next natural pause (between iterations via the chatLoop
   *  drain hook, or as the userBlocks of a follow-up turn if the loop
   *  exits with the queue still non-empty). In-memory only — lost on
   *  refresh, which matches the ephemeral "queue while running" use case. */
  queuedBlocks: ChatBlock[];
  /** Undo stack for the rewind button. Each entry is the slice of messages
   *  removed by one rewind operation. Popped by fast-forward to restore.
   *  Cleared when the user sends a new message (conversation has diverged). */
  rewindStack: ChatMessage[][];
}

const state: PanelState = {
  open: false,
  sessionId: GLOBAL_CHAT_BUCKET,
  history: [],
  pendingImages: [],
  inFlight: false,
  inFlightController: null,
  queuedBlocks: [],
  rewindStack: [],
};

/** Cached length of `public/ai.md` + PREAMBLE, in characters, populated
 *  once on init. Used when the active provider is Anthropic. Default is
 *  a rough match for the current slimmed ai.md so the context meter is
 *  sensible before the fetch lands. */
let cachedAiMdLength = 55_000;

/** Effective system-prompt length in characters for the active provider /
 *  model / override combo. Drives the context meter and the auto-compact
 *  threshold — recomputed each render so flipping provider in AI settings
 *  doesn't strand us with the wrong number. */
function effectiveSystemPromptChars(): number {
  const s = loadSettings();
  const override = s.systemPromptOverrides?.[s.toggles.provider] ?? null;
  if (override !== null) return override.length;
  if (s.toggles.provider === 'anthropic') return cachedAiMdLength;
  if (s.toggles.localModel) {
    try {
      const info = resolveLocalModel(s.toggles.localModel);
      return info.promptTier === 'medium'
        ? buildMediumLocalSystemPrompt().length
        : buildLocalSystemPrompt().length;
    } catch {
      // Fall through if the active model id no longer resolves.
    }
  }
  return buildLocalSystemPrompt().length;
}

/** Token limit for the active provider/model — drives the % full bar
 *  on the cost meter and the auto-compaction thresholds. For local
 *  models we use the runtime-resolved WASM ceiling (fetched from the
 *  model's mlc-chat-config.json) when available, clamped by any user
 *  override, and falling back to the curated per-model default. */
function contextLimitFor(settings: AiSettings): number {
  if (settings.toggles.provider === 'local') {
    if (settings.toggles.localModel) {
      try {
        const info = resolveLocalModel(settings.toggles.localModel);
        const ceiling = effectiveContextCeiling(settings.toggles.localModel, info.contextWindowSize);
        // User override caps below the ceiling; the actual reload value
        // is min(override, ceiling). Reflect that in the meter so the
        // user sees the same number we're requesting.
        return settings.localContext.windowSizeOverride
          ? Math.min(settings.localContext.windowSizeOverride, ceiling)
          : ceiling;
      } catch { /* stale id — fall through */ }
    }
    return settings.localContext.windowSizeOverride ?? 8192;
  }
  if (settings.toggles.anthropicModel === 'claude-haiku-4-5') return 200_000;
  return 1_000_000;
}

/** Compute the next sequence ordinal for a compaction summary so it sorts
 *  before every kept message. Multiple compactions over a session would
 *  otherwise all share seq=-1 and sort unstably on reload — by stepping
 *  one below the current minimum we keep the order deterministic. */
function nextCompactedSeq(history: ChatMessage[]): number {
  const existing = history.map(m => m.seq).filter(n => Number.isFinite(n));
  const min = existing.length > 0 ? Math.min(...existing) : 0;
  return min - 1;
}

let sendBtnRef: HTMLButtonElement | null = null;
let stopBtnRef: HTMLButtonElement | null = null;
let queuedBadgeRef: HTMLElement | null = null;
let rewindBtnRef: HTMLButtonElement | null = null;
let forwardBtnRef: HTMLButtonElement | null = null;

let drawerEl: HTMLElement | null = null;
let transcriptEl: HTMLElement | null = null;
let inputEl: HTMLTextAreaElement | null = null;
let pendingImagesEl: HTMLElement | null = null;
let toggleStripEl: HTMLElement | null = null;
let costMeterEl: HTMLElement | null = null;
let panelStatusEl: HTMLElement | null = null;
let progressEl: HTMLElement | null = null;
let progressTickerId: number | null = null;
let navigateToEditorFn: (() => Promise<void> | void) | null = null;
let modelPickerEl: HTMLElement | null = null;
let promptChipEl: HTMLElement | null = null;
let panelWidth = 420;

/** Set by the watchdog when it abort()s mid-stream so sendMessage knows
 *  this was a stall recovery (auto-resume), not a user-initiated stop. */
let stalledByWatchdog = false;

export interface AiPanelOptions {
  /** main.ts hands in a navigation helper so the panel can move the user
   *  to the editor before firing a request from another page. Avoids a
   *  silent-modeling-on-landing-page UX bug where the AI runs code but
   *  the user can't see the result. */
  onNavigateToEditor?: () => Promise<void> | void;
}

/** Mount the drawer once on app start. Idempotent. */
export async function initAiPanel(opts: AiPanelOptions = {}): Promise<void> {
  if (drawerEl) return;
  navigateToEditorFn = opts.onNavigateToEditor ?? null;
  // Pre-load ai.md so the first turn doesn't pay the fetch latency on top
  // of the API round trip. Also caches its length for the context meter.
  const aiMd = await loadAiMd();
  cachedAiMdLength = buildSystemPrompt(aiMd).length;

  const settings = loadSettings();
  panelWidth = settings.aiPanelWidth;
  state.open = settings.drawerOpen;

  buildDrawer();
  // Don't try to load history until a session is opened or we know we're
  // in the global bucket. main.ts will call setActiveSession when ready.
  await loadHistoryForCurrentSession();
  if (state.open) showDrawer();
  else hideDrawer();
}

/** Called by main.ts whenever the active session changes (open / close).
 *  When the user isn't on /editor (landing, catalog, help, 404), we
 *  ignore whatever session the session manager is holding and pin the
 *  chat to the global bucket — prior session chat shouldn't leak across
 *  navigation. */
export async function setActiveSession(sessionId: string | null): Promise<void> {
  const onEditor = window.location.pathname === '/editor';
  const effective = (onEditor && sessionId) ? sessionId : GLOBAL_CHAT_BUCKET;
  if (state.sessionId === effective && state.history.length > 0) {
    // Already showing this bucket — skip the IndexedDB round trip and
    // avoid a transcript re-render that scrolls the user to the bottom.
    return;
  }
  state.sessionId = effective;
  // If a turn is in flight the session change was triggered by the model
  // calling createSession mid-turn. Don't reload/re-render now — the
  // callbacks (onUserPersisted etc.) are keeping state.history current
  // for the running turn. Reloading here would wipe the user's message
  // from the transcript. The reload happens after the turn completes.
  if (state.inFlight) return;
  // Drop any queued follow-ups — they were aimed at the prior chat bucket
  // and the human's instructions almost never make sense out of context.
  state.queuedBlocks = [];
  renderQueuedBadge();
  await loadHistoryForCurrentSession();
  renderTranscript();
  renderCostMeter();
}

export function toggleAiPanel(): void {
  if (state.open) hideDrawer();
  else showDrawer();
}

function showDrawer(): void {
  if (!drawerEl) return;
  state.open = true;
  drawerEl.classList.remove('translate-x-full');
  drawerEl.classList.add('translate-x-0');
  // Only push content on desktop — mobile layout is stacked, not side-by-side.
  if (window.matchMedia('(min-width: 768px)').matches) {
    const app = document.getElementById('app');
    if (app) app.style.paddingRight = `${panelWidth}px`;
  }
  window.dispatchEvent(new Event('resize'));
  saveSettings({ ...loadSettings(), drawerOpen: true });
  inputEl?.focus();
}

function hideDrawer(): void {
  if (!drawerEl) return;
  state.open = false;
  drawerEl.classList.remove('translate-x-0');
  drawerEl.classList.add('translate-x-full');
  const app = document.getElementById('app');
  if (app) app.style.paddingRight = '0';
  window.dispatchEvent(new Event('resize'));
  saveSettings({ ...loadSettings(), drawerOpen: false });
}

async function loadHistoryForCurrentSession(): Promise<void> {
  state.history = await listMessages(state.sessionId);
  updateRewindButtons();
}

// === DOM construction ===

function buildDrawer(): void {
  const root = document.createElement('div');
  root.id = 'ai-panel';
  root.className = 'fixed top-0 right-0 h-screen bg-zinc-900 border-l border-zinc-700 shadow-2xl z-40 flex flex-col transition-transform duration-200 translate-x-full';
  root.style.width = `${panelWidth}px`;
  drawerEl = root;

  const app = document.getElementById('app');
  if (app) app.style.transition = 'padding-right 200ms ease';

  // Left-edge drag handle for resizing panel width.
  // w-5 (20px) gives a finger-friendly touch target; the visible stripe stays
  // 1px wide so it doesn't look like a thick border.
  const panelResizeHandle = document.createElement('div');
  panelResizeHandle.className = 'absolute top-0 left-0 h-full w-5 -translate-x-1/2 cursor-col-resize z-10 touch-none group';
  const panelResizeStripe = document.createElement('div');
  panelResizeStripe.className = 'absolute inset-y-0 left-1/2 w-px bg-zinc-700 group-hover:bg-blue-500 group-[.is-dragging]:bg-blue-500 transition-colors';
  panelResizeHandle.appendChild(panelResizeStripe);
  initPanelResizer(panelResizeHandle);
  root.appendChild(panelResizeHandle);

  // Header — single row that wraps gracefully when the panel is narrow.
  // flex-wrap prevents overlap; items truncate or wrap rather than collide.
  const header = document.createElement('div');
  header.className = 'flex items-center flex-wrap gap-1.5 px-3 py-1.5 border-b border-zinc-700 shrink-0';

  const titleEl = document.createElement('div');
  titleEl.className = 'text-sm font-semibold text-zinc-100 shrink-0';
  titleEl.textContent = 'AI';
  header.appendChild(titleEl);

  modelPickerEl = document.createElement('div');
  modelPickerEl.className = 'flex items-center gap-1 shrink-0';
  header.appendChild(modelPickerEl);
  renderModelPicker();

  promptChipEl = document.createElement('span');
  promptChipEl.className = 'shrink-0';
  header.appendChild(promptChipEl);
  renderPromptChip();

  const compactBtn = createIconButton('Compact', '⤓ Compact');
  compactBtn.title = 'Compact the conversation: summarize older turns and promote insights to session notes.';
  compactBtn.addEventListener('click', () => { void runCompact(); });
  header.appendChild(compactBtn);

  const clearBtn = createIconButton('Clear', '🗑');
  clearBtn.title = 'Clear the chat history for the current session. The conversation is removed from your browser; saved versions and notes are untouched.';
  clearBtn.addEventListener('click', () => { void clearCurrentChat(); });
  header.appendChild(clearBtn);

  const settingsBtn = createIconButton('Settings', '⚙');
  settingsBtn.title = 'AI settings: provider, key, lifetime usage.';
  settingsBtn.addEventListener('click', () => {
    void showAiSettingsModal({ onChange: () => { renderTranscript(); renderToggleStrip(); renderCostMeter(); renderModelPicker(); renderPromptChip(); panelStatusUpdate(); } });
  });
  header.appendChild(settingsBtn);

  const headerSpacer = document.createElement('div');
  headerSpacer.className = 'flex-1';
  header.appendChild(headerSpacer);

  const closeBtn = document.createElement('button');
  closeBtn.className = 'shrink-0 px-2 py-1 rounded text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 text-sm';
  closeBtn.textContent = '✕';
  closeBtn.title = 'Close AI panel';
  closeBtn.addEventListener('click', hideDrawer);
  header.appendChild(closeBtn);

  root.appendChild(header);

  // Status bar — surfaces "no key" / "ready" / errors
  panelStatusEl = document.createElement('div');
  panelStatusEl.className = 'px-3 py-1.5 text-[11px] border-b border-zinc-800 hidden';
  root.appendChild(panelStatusEl);

  // Transcript
  transcriptEl = document.createElement('div');
  transcriptEl.className = 'flex-1 overflow-y-auto px-3 py-3 flex flex-col gap-3';
  root.appendChild(transcriptEl);

  // Vertical drag handle for resizing input area.
  // h-5 (20px) gives a finger-friendly touch target; the visible stripe stays
  // 1px tall centered in the hit area.
  const inputResizeHandle = document.createElement('div');
  inputResizeHandle.className = 'shrink-0 h-5 cursor-row-resize touch-none group relative';
  const inputResizeStripe = document.createElement('div');
  inputResizeStripe.className = 'absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-zinc-700 group-hover:bg-blue-500 group-[.is-dragging]:bg-blue-500 transition-colors';
  inputResizeHandle.appendChild(inputResizeStripe);
  root.appendChild(inputResizeHandle);

  // Bottom section — rewind, toggles, cost, input
  const bottomSection = document.createElement('div');
  bottomSection.className = 'flex flex-col shrink-0 overflow-hidden';
  bottomSection.style.height = '220px';
  initInputResizer(inputResizeHandle, bottomSection);


  // Toggle strip
  toggleStripEl = document.createElement('div');
  toggleStripEl.className = 'px-3 py-1.5 border-t border-zinc-800 flex flex-wrap items-center gap-1.5 shrink-0';
  bottomSection.appendChild(toggleStripEl);

  // Cost meter
  costMeterEl = document.createElement('div');
  costMeterEl.className = 'px-3 pb-1.5 text-[10px] text-zinc-500 flex items-center gap-2 shrink-0';
  bottomSection.appendChild(costMeterEl);

  // Pending image attachments row (hidden until something is pending)
  pendingImagesEl = document.createElement('div');
  pendingImagesEl.className = 'px-3 pb-1.5 flex flex-wrap gap-1.5 shrink-0 hidden';
  bottomSection.appendChild(pendingImagesEl);

  // In-progress indicator — shown while a turn is in flight so the user
  // knows we haven't frozen. Hidden by default; populated by
  // showProgress() / hideProgress() driven by runTurn's onProgress callback
  // and the stall watchdog.
  progressEl = document.createElement('div');
  progressEl.className = 'px-3 pb-1.5 text-[11px] text-zinc-400 flex items-center gap-2 shrink-0 hidden';
  bottomSection.appendChild(progressEl);

  // Queued-message badge — shown when the human has typed a follow-up
  // mid-run. Sits just above the input row so the user can see at a glance
  // that the next iteration will pick up what they queued.
  queuedBadgeRef = document.createElement('div');
  queuedBadgeRef.id = 'queued-message-badge';
  queuedBadgeRef.className = 'px-3 pb-1.5 text-[11px] text-amber-300 flex items-center gap-2 shrink-0 hidden';
  bottomSection.appendChild(queuedBadgeRef);

  // Input area — column layout: textarea fills available height, buttons
  // sit in a row below so the textarea gets the full pane width.
  const inputRow = document.createElement('div');
  inputRow.className = 'px-3 pt-2 pb-2 border-t border-zinc-700 flex flex-col gap-2 flex-1 min-h-0';

  const ta = document.createElement('textarea');
  ta.placeholder = 'Ask the AI to model something...';
  ta.rows = 2;
  ta.className = 'w-full flex-1 min-h-0 px-2 py-1.5 rounded bg-zinc-800 border border-zinc-600 text-zinc-100 text-sm placeholder:text-zinc-500 focus:outline-none focus:border-blue-500 resize-none';
  ta.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void sendMessage();
    }
  });
  ta.addEventListener('paste', e => {
    if (!e.clipboardData) return;
    for (const item of Array.from(e.clipboardData.items)) {
      if (item.kind === 'file') {
        const file = item.getAsFile();
        if (file) {
          e.preventDefault();
          void attachFile(file);
        }
      }
    }
  });
  inputEl = ta;
  inputRow.appendChild(ta);

  // Button row — attachment buttons on the left, stop/send on the right.
  const inputBtnRow = document.createElement('div');
  inputBtnRow.className = 'flex items-center gap-2 shrink-0';

  const showAiBtn = document.createElement('button');
  showAiBtn.className = 'shrink-0 px-2 py-1 rounded text-[11px] text-zinc-300 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700';
  showAiBtn.textContent = '📷 Show AI';
  showAiBtn.title = 'Snapshot the 4 iso views and attach to your next message.';
  showAiBtn.addEventListener('click', () => { void attachIsoViews(); });
  inputBtnRow.appendChild(showAiBtn);

  const fileBtn = document.createElement('button');
  fileBtn.className = 'shrink-0 px-2 py-1 rounded text-[11px] text-zinc-300 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700';
  fileBtn.textContent = '📎';
  fileBtn.title = 'Attach an image — pick from recent files or upload a new one.';
  fileBtn.addEventListener('click', () => {
    showAttachmentModal({
      onAttach: images => {
        for (const img of images) attachImageSource(img);
      },
    });
  });
  inputBtnRow.appendChild(fileBtn);

  const inputBtnSpacer = document.createElement('div');
  inputBtnSpacer.className = 'flex-1';
  inputBtnRow.appendChild(inputBtnSpacer);

  // Rewind / fast-forward — compact icon buttons tucked before Stop/Send.
  const rewindBtn = document.createElement('button');
  rewindBtn.className = 'shrink-0 px-2 py-1.5 rounded text-xs text-zinc-400 hover:text-zinc-100 hover:bg-zinc-700 disabled:opacity-30 disabled:cursor-not-allowed transition-colors';
  rewindBtn.textContent = '↩';
  rewindBtn.title = 'Rewind: remove the last turn from history. Use ↪ to restore it.';
  rewindBtn.disabled = true;
  rewindBtn.addEventListener('click', () => { void rewindTurn(); });
  rewindBtnRef = rewindBtn;
  inputBtnRow.appendChild(rewindBtn);

  const forwardBtn = document.createElement('button');
  forwardBtn.className = 'shrink-0 px-2 py-1.5 rounded text-xs text-zinc-400 hover:text-zinc-100 hover:bg-zinc-700 disabled:opacity-30 disabled:cursor-not-allowed transition-colors';
  forwardBtn.textContent = '↪';
  forwardBtn.title = 'Fast-forward: restore the last rewound turn. Cleared when you send a new message.';
  forwardBtn.disabled = true;
  forwardBtn.addEventListener('click', () => { void fastForwardTurn(); });
  forwardBtnRef = forwardBtn;
  inputBtnRow.appendChild(forwardBtn);

  // Stop button — separate from Send so the human can queue follow-ups
  // mid-run (clicking Send) without losing the ability to actually halt
  // the agent. Hidden until a turn is in flight.
  const stopBtn = document.createElement('button');
  stopBtn.id = 'btn-ai-stop';
  stopBtn.className = 'shrink-0 px-2 py-1.5 rounded text-xs font-medium bg-red-600 hover:bg-red-500 text-white hidden';
  stopBtn.textContent = '⊘ Stop';
  stopBtn.title = 'Stop the model. Partial output is kept so you can redirect. Any queued message stays queued.';
  stopBtn.addEventListener('click', () => {
    // Anthropic stops via AbortSignal propagated through the SDK. Local
    // (WebLLM) doesn't accept the signal, so interruptLocal() is the only
    // way to halt mid-token rather than at the next iteration boundary.
    state.inFlightController?.abort();
    void interruptLocal();
  });
  stopBtnRef = stopBtn;
  inputBtnRow.appendChild(stopBtn);

  const sendBtn = document.createElement('button');
  sendBtn.className = 'shrink-0 px-3 py-1.5 rounded text-xs font-medium bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-50 disabled:cursor-not-allowed';
  sendBtn.textContent = 'Send';
  sendBtn.addEventListener('click', () => {
    // While a turn is in flight, Send queues — the agent picks the
    // message up at the next natural pause (between tool round-trips or
    // at end-of-turn) without us aborting the current run. Stop is the
    // separate red button to the left for that.
    if (state.inFlight) {
      queueCurrentInput();
      return;
    }
    void sendMessage();
  });
  sendBtnRef = sendBtn;
  inputBtnRow.appendChild(sendBtn);

  inputRow.appendChild(inputBtnRow);
  bottomSection.appendChild(inputRow);
  root.appendChild(bottomSection);

  // Drag-drop image handling
  root.addEventListener('dragover', e => { e.preventDefault(); root.classList.add('ring-2', 'ring-blue-500'); });
  root.addEventListener('dragleave', e => { if (e.target === root) root.classList.remove('ring-2', 'ring-blue-500'); });
  root.addEventListener('drop', async e => {
    e.preventDefault();
    root.classList.remove('ring-2', 'ring-blue-500');
    if (!e.dataTransfer) return;
    for (const file of Array.from(e.dataTransfer.files)) await attachFile(file);
  });

  document.body.appendChild(root);

  renderToggleStrip();
  renderCostMeter();
  renderTranscript();
  panelStatusUpdate();
}

function initPanelResizer(handle: HTMLElement): void {
  let startX = 0;
  let startWidth = 0;

  handle.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    e.preventDefault();
    startX = e.clientX;
    startWidth = drawerEl!.getBoundingClientRect().width;
    handle.setPointerCapture(e.pointerId);
    handle.classList.add('is-dragging');
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  });

  handle.addEventListener('pointermove', (e) => {
    if (!handle.hasPointerCapture(e.pointerId)) return;
    const delta = startX - e.clientX;
    const minW = 280;
    const maxW = Math.min(900, window.innerWidth - 200);
    panelWidth = Math.max(minW, Math.min(maxW, startWidth + delta));
    if (drawerEl) drawerEl.style.width = `${panelWidth}px`;
    if (state.open && window.matchMedia('(min-width: 768px)').matches) {
      const app = document.getElementById('app');
      if (app) app.style.paddingRight = `${panelWidth}px`;
    }
    window.dispatchEvent(new Event('resize'));
  });

  const onPanelResizeEnd = (e: PointerEvent) => {
    if (!handle.hasPointerCapture(e.pointerId)) return;
    handle.releasePointerCapture(e.pointerId);
    handle.classList.remove('is-dragging');
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    saveSettings({ ...loadSettings(), aiPanelWidth: panelWidth });
  };

  handle.addEventListener('pointerup', onPanelResizeEnd);
  handle.addEventListener('pointercancel', onPanelResizeEnd);
}

function initInputResizer(handle: HTMLElement, bottomSection: HTMLElement): void {
  let startY = 0;
  let startHeight = 0;

  handle.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    e.preventDefault();
    startY = e.clientY;
    startHeight = bottomSection.getBoundingClientRect().height;
    handle.setPointerCapture(e.pointerId);
    handle.classList.add('is-dragging');
    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';
  });

  handle.addEventListener('pointermove', (e) => {
    if (!handle.hasPointerCapture(e.pointerId)) return;
    const delta = startY - e.clientY;
    const minH = 100;
    const maxH = 520;
    bottomSection.style.height = `${Math.max(minH, Math.min(maxH, startHeight + delta))}px`;
  });

  const onInputResizeEnd = (e: PointerEvent) => {
    if (!handle.hasPointerCapture(e.pointerId)) return;
    handle.releasePointerCapture(e.pointerId);
    handle.classList.remove('is-dragging');
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  };

  handle.addEventListener('pointerup', onInputResizeEnd);
  handle.addEventListener('pointercancel', onInputResizeEnd);
}

function createIconButton(_label: string, glyph: string): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.className = 'shrink-0 h-6 px-2 inline-flex items-center rounded text-[11px] text-zinc-300 hover:bg-zinc-800 border border-transparent hover:border-zinc-700';
  btn.textContent = glyph;
  return btn;
}

/** Provider-aware model picker — on Anthropic it's a native `<select>` of
 *  Haiku/Sonnet/Opus; on Local it's a chip showing the active local model
 *  that opens the picker modal when clicked. Renders into `modelPickerEl`
 *  so toggling provider just calls `renderModelPicker()` again. */
function renderModelPicker(): void {
  if (!modelPickerEl) return;
  modelPickerEl.replaceChildren();
  const settings = loadSettings();

  if (settings.toggles.provider === 'anthropic') {
    const sel = document.createElement('select');
    sel.className = 'h-6 px-2 rounded text-[11px] bg-zinc-800 border border-zinc-700 text-zinc-200 focus:outline-none';
    sel.title = 'Anthropic model (hosted).';
    for (const opt of ANTHROPIC_MODEL_OPTIONS) {
      const o = document.createElement('option');
      o.value = opt.id;
      o.textContent = opt.label;
      sel.appendChild(o);
    }
    sel.value = settings.toggles.anthropicModel;
    sel.addEventListener('change', () => {
      saveSettings(setAnthropicModel(loadSettings(), sel.value as AnthropicModelId));
      renderToggleStrip();
      renderCostMeter();
    });
    modelPickerEl.appendChild(sel);
    return;
  }

  const chip = document.createElement('button');
  chip.type = 'button';
  chip.className = 'h-6 px-2 inline-flex items-center rounded text-[11px] bg-emerald-900/30 border border-emerald-700/50 text-emerald-200 hover:bg-emerald-900/50';
  if (settings.toggles.localModel) {
    try {
      const info = resolveLocalModel(settings.toggles.localModel);
      chip.textContent = info.label;
      chip.title = `Local model: ${info.label}${isModelLoaded(info.id) ? ' (in GPU)' : ' (not loaded)'}`;
    } catch {
      chip.textContent = 'Pick local model';
      chip.title = 'The previously-selected model is no longer available. Click to pick one.';
    }
  } else {
    chip.textContent = 'Pick local model';
    chip.title = 'No local model is selected. Click to pick one.';
  }
  chip.addEventListener('click', () => {
    void showAiLocalModal({ onChange: () => { renderModelPicker(); renderToggleStrip(); renderCostMeter(); panelStatusUpdate(); } });
  });
  modelPickerEl.appendChild(chip);
}

/** Tiny clickable chip showing which system prompt is active. Local models
 *  see a stripped-down "slim" or "medium" version of ai.md; Anthropic
 *  gets the full thing. Calling out the difference up front makes the
 *  capability gap less surprising. Clicking opens the editor. */
function renderPromptChip(): void {
  if (!promptChipEl) return;
  const settings = loadSettings();
  const provider = settings.toggles.provider;
  const override = settings.systemPromptOverrides?.[provider] ?? null;

  const chip = document.createElement('button');
  chip.type = 'button';
  let label: string;
  let cls: string;
  let title: string;
  if (override !== null) {
    label = '✎ Custom prompt';
    cls = 'h-6 px-1.5 inline-flex items-center rounded text-[10px] bg-amber-900/40 text-amber-200 border border-amber-800/60 hover:bg-amber-900/60';
    title = 'A custom system prompt is in use. Click to view or edit.';
  } else if (provider === 'local') {
    const tier = settings.toggles.localModel
      ? resolveLocalModel(settings.toggles.localModel).promptTier
      : 'slim';
    const tierLabel = tier === 'medium' ? 'Medium' : 'Slim';
    const tierSize = tier === 'medium' ? '~1.1K tokens' : '~700 tokens';
    label = `· ${tierLabel} prompt`;
    cls = 'h-6 px-1.5 inline-flex items-center rounded text-[10px] bg-zinc-800 text-zinc-400 border border-zinc-700 hover:bg-zinc-700';
    title = `Local models use a compact built-in prompt (${tierSize}) and pull subdoc detail on demand via the readDoc tool. Click to view or pin a different tier.`;
  } else {
    label = '· Full ai.md';
    cls = 'h-6 px-1.5 inline-flex items-center rounded text-[10px] bg-zinc-800 text-zinc-400 border border-zinc-700 hover:bg-zinc-700';
    title = 'Anthropic gets the full ai.md (~15K tokens) cached on the API. Click to view or edit.';
  }
  chip.className = cls;
  chip.textContent = label;
  chip.title = title;
  chip.addEventListener('click', () => {
    void showSystemPromptModal(provider, { onChange: () => renderPromptChip() });
  });
  promptChipEl.replaceChildren(chip);
}

// === Toggle strip rendering ===

function renderToggleStrip(): void {
  if (!toggleStripEl) return;
  toggleStripEl.replaceChildren();
  const settings = loadSettings();
  const { toggles } = settings;

  toggleStripEl.appendChild(togglePill(
    '📸 Auto-render',
    toggles.vision.views,
    'Auto-render: lets the model call renderView() to take its own screenshots after paint / geometry changes. Each render ≈ 1500 tokens of input on the next turn — verification is valuable but it adds up. The 📷 Show AI button still works manually when this is OFF.',
    () => {
      saveSettings(setToggles(loadSettings(), { vision: { views: !toggles.vision.views } }));
      renderToggleStrip();
      renderCostMeter();
    },
  ));
  toggleStripEl.appendChild(togglePill(
    '▶ Run',
    toggles.scope.runCode,
    'Run code: allow the AI to execute geometry code (runCode, runAndSave). OFF makes it suggest code in chat without running.',
    () => {
      saveSettings(setToggles(loadSettings(), { scope: { runCode: !toggles.scope.runCode } }));
      renderToggleStrip();
    },
  ));
  toggleStripEl.appendChild(togglePill(
    '💾 Save',
    toggles.scope.saveVersions,
    'Save versions: allow the AI to commit results to the gallery (runAndSave, loadVersion). OFF keeps the model in run-only / dry-run mode.',
    () => {
      saveSettings(setToggles(loadSettings(), { scope: { saveVersions: !toggles.scope.saveVersions } }));
      renderToggleStrip();
    },
  ));
  toggleStripEl.appendChild(togglePill(
    '🎨 Paint',
    toggles.scope.paintFaces,
    'Paint: allow the AI to set color regions (paintInBox, paintSlab, paintNear, etc.). OFF by default — painting locks the editor and is the easiest place for the AI to over-select.',
    () => {
      saveSettings(setToggles(loadSettings(), { scope: { paintFaces: !toggles.scope.paintFaces } }));
      renderToggleStrip();
    },
  ));

  const retry = document.createElement('select');
  retry.className = 'px-1.5 py-0.5 rounded text-[10px] bg-zinc-800 border border-zinc-700 text-zinc-300 focus:outline-none';
  retry.title = 'Auto-retry on tool error: how many times to feed the error back before surfacing it.';
  for (const n of [0, 1, 3]) {
    const opt = document.createElement('option');
    opt.value = String(n);
    opt.textContent = `↻ ${n}`;
    retry.appendChild(opt);
  }
  retry.value = String(toggles.autoRetry);
  retry.addEventListener('change', () => {
    saveSettings(setToggles(loadSettings(), { autoRetry: Number(retry.value) as 0 | 1 | 3 }));
  });
  toggleStripEl.appendChild(retry);

  // Iteration cap — how many tool round-trips per user turn before the
  // loop forces a stop. Lower = safer (model can't run away on cost or
  // time), higher = more autonomous (long paint runs complete in one go).
  const iterCap = document.createElement('select');
  iterCap.className = 'px-1.5 py-0.5 rounded text-[10px] bg-zinc-800 border border-zinc-700 text-zinc-300 focus:outline-none';
  iterCap.title = 'Iteration cap: how many agent loop rounds before the loop forces a stop. Lower = safer (the model can\'t run away on cost or time), higher = more autonomous (long paint runs complete in one go). ∞ relies entirely on the model declaring done or you clicking Stop.';
  for (const opt of MAX_ITERATIONS_OPTIONS) {
    const o = document.createElement('option');
    o.value = opt.id;
    o.textContent = `⟲ ${opt.label}`;
    o.title = opt.hint;
    iterCap.appendChild(o);
  }
  iterCap.value = toggles.maxIterations;
  iterCap.addEventListener('change', () => {
    saveSettings(setToggles(loadSettings(), { maxIterations: iterCap.value as ChatToggles['maxIterations'] }));
  });
  toggleStripEl.appendChild(iterCap);

  // Spend cap — alternative / parallel control to iteration cap. Both
  // apply; whichever trips first stops the loop. Useful when iteration
  // count is hard to predict (vision-heavy turns can run a few
  // iterations but spend $0.50+ each).
  const spendCap = document.createElement('select');
  spendCap.className = 'px-1.5 py-0.5 rounded text-[10px] bg-zinc-800 border border-zinc-700 text-zinc-300 focus:outline-none';
  spendCap.title = 'Spend cap: total USD this session can cost before the loop forces a stop and further sends are blocked until you raise the cap. Applies alongside the iteration cap — whichever trips first wins. Set ∞ to disable.';
  for (const opt of MAX_SPEND_OPTIONS) {
    const o = document.createElement('option');
    o.value = opt.id;
    o.textContent = opt.label;
    o.title = opt.hint;
    spendCap.appendChild(o);
  }
  spendCap.value = toggles.maxSpend;
  spendCap.addEventListener('change', () => {
    saveSettings(setToggles(loadSettings(), { maxSpend: spendCap.value as ChatToggles['maxSpend'] }));
  });
  toggleStripEl.appendChild(spendCap);
}

function togglePill(label: string, on: boolean, tooltip: string, onClick: () => void): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.className = on
    ? 'px-2 py-0.5 rounded text-[10px] bg-emerald-700/40 border border-emerald-700/60 text-emerald-200'
    : 'px-2 py-0.5 rounded text-[10px] bg-zinc-800 border border-zinc-700 text-zinc-500';
  btn.textContent = label;
  btn.title = `${tooltip}\n\nCurrently: ${on ? 'ON' : 'OFF'} — click to ${on ? 'disable' : 'enable'}.`;
  btn.setAttribute('aria-pressed', String(on));
  btn.addEventListener('click', onClick);
  return btn;
}

// === Cost meter ===

function renderCostMeter(): void {
  if (!costMeterEl) return;
  const settings = loadSettings();
  const tokens = totalTokensEstimate(state.history, effectiveSystemPromptChars());
  const cost = totalCost(state.history);
  const cachedPrefix = estimateCachedPrefixTokens(effectiveSystemPromptChars());
  // Per-turn estimate covers the user's input + a typical response. Image
  // tokens (Show AI snapshot + any renderView calls the model makes) are
  // observed on the post-turn meter rather than predicted here — they're
  // too variable to estimate up front without lying to the user.
  const model = activeModel(settings.toggles);
  const turnEst = model ? estimateTurnCostUsd(model, cachedPrefix, 500) : 0;

  // Color the context bar by % of model context window. Local models cap
  // around 4-16K tokens so the bar fills much faster than on Anthropic —
  // that's the honest behavior we want to surface.
  const ctxLimit = contextLimitFor(settings);
  const pct = Math.min(100, Math.round((tokens / ctxLimit) * 100));
  const barColor = pct < 60 ? 'bg-emerald-500' : pct < 85 ? 'bg-amber-500' : 'bg-red-500';

  costMeterEl.replaceChildren();
  const meter = document.createElement('div');
  meter.className = 'flex items-center gap-1.5';
  meter.innerHTML = `
    <span>ctx</span>
    <span class="w-16 h-1.5 bg-zinc-800 rounded-full overflow-hidden inline-block">
      <span class="block h-full ${barColor}" style="width: ${pct}%"></span>
    </span>
    <span class="text-zinc-400">${pct}%</span>
  `;
  costMeterEl.appendChild(meter);

  const sep = document.createElement('span');
  sep.className = 'text-zinc-700';
  sep.textContent = '·';
  costMeterEl.appendChild(sep);

  const session = document.createElement('span');
  session.textContent = `session: ${formatUsd(cost)}`;
  costMeterEl.appendChild(session);

  const sep2 = document.createElement('span');
  sep2.className = 'text-zinc-700';
  sep2.textContent = '·';
  costMeterEl.appendChild(sep2);

  const next = document.createElement('span');
  next.textContent = `next turn ~${formatUsd(turnEst)}`;
  costMeterEl.appendChild(next);
}

// === Status bar ===

function panelStatusUpdate(): void {
  if (!panelStatusEl) return;
  const settings = loadSettings();
  if (settings.toggles.provider === 'local') {
    panelStatusEl.replaceChildren();
    if (!settings.toggles.localModel) {
      panelStatusEl.classList.remove('hidden', 'text-emerald-400');
      panelStatusEl.classList.add('text-amber-400');
      panelStatusEl.appendChild(document.createTextNode('No local model picked. '));
      const link = document.createElement('button');
      link.className = 'underline text-amber-200 hover:text-amber-100';
      link.textContent = 'Choose a model';
      link.addEventListener('click', () => {
        void showAiLocalModal({ onChange: () => { panelStatusUpdate(); renderModelPicker(); renderToggleStrip(); renderCostMeter(); renderPromptChip(); } });
      });
      panelStatusEl.appendChild(link);
    } else if (!isModelLoaded(settings.toggles.localModel)) {
      panelStatusEl.classList.remove('hidden', 'text-emerald-400');
      panelStatusEl.classList.add('text-blue-300');
      let label = 'Model';
      try { label = resolveLocalModel(settings.toggles.localModel).label; } catch { /* stale id */ }
      panelStatusEl.appendChild(document.createTextNode(`${label} downloaded — `));
      const link = document.createElement('button');
      link.className = 'underline text-blue-200 hover:text-blue-100';
      link.textContent = 'load into GPU';
      link.addEventListener('click', () => { void loadLocalModelInline(); });
      panelStatusEl.appendChild(link);
      panelStatusEl.appendChild(document.createTextNode(' or send a message to auto-load.'));
    } else {
      panelStatusEl.classList.add('hidden');
    }
    return;
  }
  void getKey('anthropic').then(key => {
    if (!panelStatusEl) return;
    if (!key) {
      panelStatusEl.classList.remove('hidden', 'text-emerald-400');
      panelStatusEl.classList.add('text-amber-400');
      panelStatusEl.replaceChildren();
      panelStatusEl.appendChild(document.createTextNode('Not connected. '));
      const link = document.createElement('button');
      link.className = 'underline text-amber-200 hover:text-amber-100';
      link.textContent = 'Connect Anthropic API';
      link.addEventListener('click', () => {
        void showAiKeyModal({ onConnected: () => { panelStatusUpdate(); } });
      });
      panelStatusEl.appendChild(link);
      panelStatusEl.appendChild(document.createTextNode(' or '));
      const local = document.createElement('button');
      local.className = 'underline text-amber-200 hover:text-amber-100';
      local.textContent = 'run a local model';
      local.addEventListener('click', () => {
        void showAiLocalModal({ onChange: () => { panelStatusUpdate(); renderToggleStrip(); renderCostMeter(); renderModelPicker(); renderPromptChip(); } });
      });
      panelStatusEl.appendChild(local);
      panelStatusEl.appendChild(document.createTextNode('.'));
    } else {
      panelStatusEl.classList.add('hidden');
    }
  });
}

async function loadLocalModelInline(): Promise<void> {
  const settings = loadSettings();
  if (!settings.toggles.localModel) return;
  setTransientStatus('Loading model into GPU...');
  try {
    await ensureModelLoaded(settings.toggles.localModel, {
      onProgress: r => setTransientStatus(r.text || `Loading ${Math.round(r.progress * 100)}%`),
    });
    setTransientStatus('');
    panelStatusUpdate();
    renderCostMeter();
  } catch (err) {
    setTransientStatus(`Failed to load: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/** Clear chat history for the current session. Confirms first; refuses to
 *  fire mid-turn so we don't leave the agent's in-flight writes orphaned. */
async function clearCurrentChat(): Promise<void> {
  if (state.inFlight) {
    setTransientStatus('Wait for the current turn to finish before clearing.');
    return;
  }
  if (state.history.length === 0) {
    setTransientStatus('Nothing to clear — the chat is already empty.');
    return;
  }
  const scope = state.sessionId === GLOBAL_CHAT_BUCKET
    ? 'the global chat (before any session was opened)'
    : 'this session';
  if (!confirm(`Clear chat for ${scope}? ${state.history.length} message(s) will be deleted from your browser. Saved versions and session notes are untouched.`)) return;
  try {
    await clearChat(state.sessionId);
  } catch (err) {
    setTransientStatus(`Couldn't clear chat: ${err instanceof Error ? err.message : String(err)}`);
    return;
  }
  state.history = [];
  renderTranscript();
  renderCostMeter();
  setTransientStatus('Chat cleared.');
}

// === Transcript rendering ===

function renderTranscript(): void {
  if (!transcriptEl) return;
  transcriptEl.replaceChildren();
  const hasHistory = state.history.length > 0;
  const hasQueue = state.queuedBlocks.length > 0;
  if (!hasHistory && !hasQueue) {
    const empty = document.createElement('div');
    empty.className = 'flex-1 flex items-center justify-center text-zinc-600 text-xs text-center px-6';
    empty.textContent = state.sessionId === GLOBAL_CHAT_BUCKET
      ? 'Open a session and ask the AI to model something. Try: "Build a coffee mug, 80mm tall."'
      : 'Ask the AI to model, modify, or describe this session.';
    transcriptEl.appendChild(empty);
    return;
  }
  for (const msg of state.history) {
    transcriptEl.appendChild(renderMessage(msg));
  }
  // Pending preview — render queued follow-ups as faded user bubbles at the
  // bottom of the transcript so the human sees their typed message land
  // immediately, before the agent's loop drains the queue. When the drain
  // fires, the merged tool_result message takes the queued blocks' place
  // (and renderTranscript runs again to clear the preview).
  if (hasQueue) {
    transcriptEl.appendChild(renderQueuedPreview());
  }
  transcriptEl.scrollTop = transcriptEl.scrollHeight;
}

function renderQueuedPreview(): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'flex flex-col items-end gap-1';
  wrap.dataset.queuedPreview = 'true';
  for (const b of state.queuedBlocks) {
    if (b.type === 'text' && b.text.trim().length > 0) {
      const bubble = document.createElement('div');
      bubble.className = 'max-w-[90%] px-3 py-2 rounded-lg text-sm whitespace-pre-wrap leading-snug bg-blue-600/70 text-white border border-amber-400/50 ring-1 ring-amber-400/30';
      bubble.textContent = b.text;
      bubble.title = 'Queued — will be delivered to the AI at the next pause.';
      wrap.appendChild(bubble);
    } else if (b.type === 'image') {
      const imgWrap = renderImageBubble(b.source);
      imgWrap.classList.add('opacity-70', 'ring-1', 'ring-amber-400/40');
      wrap.appendChild(imgWrap);
    }
  }
  const tag = document.createElement('div');
  tag.className = 'text-[10px] text-amber-300/80 italic';
  tag.textContent = '⏳ queued — waiting for the agent to pause';
  wrap.appendChild(tag);
  return wrap;
}

function renderMessage(msg: ChatMessage): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = msg.role === 'user' ? 'flex flex-col items-end gap-1' : 'flex flex-col items-start gap-1';
  wrap.dataset.messageId = msg.id;

  // Tool results (user role) get rendered as collapsed bubbles
  if (msg.role === 'user' && msg.toolResults && msg.toolResults.length > 0) {
    for (const tr of msg.toolResults) {
      wrap.appendChild(renderToolResultBubble(tr));
    }
  }

  // Errored placeholder: render a distinct red bubble with Retry / Dismiss
  // and skip the normal text/tool/cost rendering.
  if (msg.errored) {
    wrap.appendChild(renderErrorBubble(msg));
    return wrap;
  }

  // Assistant placeholders are pushed with an empty text block during a
  // streaming turn so the live bubble exists *before* any tokens arrive —
  // otherwise the streaming scanner finds nothing to update and the user
  // sees nothing until the final persist. We render the empty bubble and
  // tag it with `data-live-bubble` so onAssistantText can target it.
  for (const b of msg.blocks) {
    if (b.type === 'text') {
      const isEmpty = b.text.length === 0;
      if (isEmpty && msg.role !== 'assistant') continue;
      const bubble = renderTextBubble(msg.role, b.text, msg.compacted);
      if (isEmpty && msg.role === 'assistant') bubble.dataset.liveBubble = msg.id;
      if (b.text.trim().length > 0 || (isEmpty && msg.role === 'assistant')) {
        wrap.appendChild(bubble);
      }
    } else if (b.type === 'image') {
      wrap.appendChild(renderImageBubble(b.source));
    }
  }

  if (msg.role === 'assistant' && msg.toolCalls && msg.toolCalls.length > 0) {
    for (const tc of msg.toolCalls) {
      wrap.appendChild(renderToolCallChip(tc.name, tc.input));
    }
  }

  if (msg.role === 'assistant' && msg.costUsd !== undefined) {
    const meta = document.createElement('div');
    meta.className = 'text-[10px] text-zinc-600';
    meta.textContent = `${formatUsd(msg.costUsd)}${msg.usage ? ` · ${msg.usage.outputTokens}t out` : ''}`;
    wrap.appendChild(meta);
  }

  if (msg.role === 'assistant' && msg.aborted) {
    const banner = document.createElement('div');
    banner.className = 'flex items-center gap-2 text-[10px] text-amber-400';
    const label = document.createElement('span');
    label.textContent = '⊘ Stopped by user.';
    banner.appendChild(label);
    const discard = document.createElement('button');
    discard.className = 'underline hover:text-amber-200';
    discard.textContent = 'Discard partial';
    discard.title = 'Delete this aborted message so the next turn starts clean.';
    discard.addEventListener('click', () => { void discardPartial(msg.id); });
    banner.appendChild(discard);
    wrap.appendChild(banner);
  }

  return wrap;
}

async function discardPartial(messageId: string): Promise<void> {
  // Drop the aborted assistant message from both the DB and the in-memory
  // history so the next turn doesn't see (or have to refer to) it. We also
  // drop any tool_result message that immediately followed — that pair
  // only makes sense together.
  const idx = state.history.findIndex(m => m.id === messageId);
  if (idx < 0) return;
  const toDelete = [state.history[idx].id];
  const next = state.history[idx + 1];
  if (next && next.role === 'user' && next.toolResults && next.toolResults.length > 0) {
    toDelete.push(next.id);
  }
  await deleteMessages(toDelete);
  await loadHistoryForCurrentSession();
  renderTranscript();
  renderCostMeter();
}

/** Rendered for turns that errored mid-flight — visually distinct so the
 *  user can spot the failure point in a long chat, and offers a Retry that
 *  re-sends the immediately preceding user message. */
function renderErrorBubble(msg: ChatMessage): HTMLElement {
  const card = document.createElement('div');
  card.className = 'max-w-[95%] rounded border border-red-700/60 bg-red-900/15 px-3 py-2 flex flex-col gap-2';

  const head = document.createElement('div');
  head.className = 'flex items-center gap-1.5 text-xs font-medium text-red-200';
  head.innerHTML = '<span>⚠</span><span>Turn failed</span>';
  card.appendChild(head);

  const body = document.createElement('div');
  body.className = 'text-[12px] text-red-100 whitespace-pre-wrap leading-snug';
  body.textContent = msg.blocks.find(b => b.type === 'text')?.text ?? 'The model didn\'t finish the turn.';
  card.appendChild(body);

  const actions = document.createElement('div');
  actions.className = 'flex items-center gap-2 pt-1';
  const retryBtn = document.createElement('button');
  retryBtn.className = 'px-2 py-1 rounded text-[11px] text-zinc-100 bg-zinc-700 hover:bg-zinc-600 border border-zinc-600';
  retryBtn.textContent = '↻ Retry last message';
  retryBtn.addEventListener('click', () => { void retryLastUserMessage(msg.id); });
  actions.appendChild(retryBtn);

  const dismissBtn = document.createElement('button');
  dismissBtn.className = 'px-2 py-1 rounded text-[11px] text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800';
  dismissBtn.textContent = 'Dismiss';
  dismissBtn.title = 'Hide this error from the chat (it\'s not stored anyway).';
  dismissBtn.addEventListener('click', () => {
    state.history = state.history.filter(m => m.id !== msg.id);
    renderTranscript();
  });
  actions.appendChild(dismissBtn);
  card.appendChild(actions);
  return card;
}

/** Find the most recent user message before this error, dismiss the error
 *  bubble, and replay the user message verbatim. */
async function retryLastUserMessage(errorMsgId: string): Promise<void> {
  if (state.inFlight) {
    setTransientStatus('Wait for the current turn to finish before retrying.');
    return;
  }
  const errorIdx = state.history.findIndex(m => m.id === errorMsgId);
  if (errorIdx < 0) return;
  let lastUser: ChatMessage | null = null;
  for (let i = errorIdx - 1; i >= 0; i--) {
    const m = state.history[i];
    if (m.role === 'user' && m.blocks.some(b => b.type === 'text' || b.type === 'image')) {
      lastUser = m;
      break;
    }
  }
  if (!lastUser) {
    setTransientStatus('Nothing to retry — couldn\'t find your last message.');
    return;
  }
  state.history = state.history.filter(m => m.id !== errorMsgId);
  renderTranscript();
  if (!inputEl) return;
  const text = lastUser.blocks.find(b => b.type === 'text')?.text ?? '';
  state.pendingImages = lastUser.blocks.filter(b => b.type === 'image').map(b => (b as { source: ImageSource }).source);
  inputEl.value = text;
  await sendMessage();
}

function renderTextBubble(role: 'user' | 'assistant', text: string, compacted?: boolean): HTMLElement {
  const bubble = document.createElement('div');
  const baseClass = 'max-w-[90%] px-3 py-2 rounded-lg text-sm whitespace-pre-wrap leading-snug';
  if (compacted) {
    bubble.className = `${baseClass} bg-zinc-800/60 border border-zinc-700 text-zinc-300 italic`;
  } else if (role === 'user') {
    bubble.className = `${baseClass} bg-blue-600 text-white`;
  } else {
    bubble.className = `${baseClass} bg-zinc-800 text-zinc-100`;
  }
  bubble.textContent = text;
  return bubble;
}

function renderImageBubble(source: ImageSource): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'max-w-[90%] rounded-lg overflow-hidden border border-zinc-700';
  const img = document.createElement('img');
  img.src = `data:${source.mediaType};base64,${source.data}`;
  img.alt = source.label ?? 'image';
  img.className = 'block max-w-full max-h-64';
  wrap.appendChild(img);
  if (source.label) {
    const label = document.createElement('div');
    label.className = 'px-2 py-1 text-[10px] text-zinc-400 bg-zinc-800';
    label.textContent = source.label;
    wrap.appendChild(label);
  }
  return wrap;
}

function renderToolCallChip(name: string, input: Record<string, unknown>): HTMLElement {
  const chip = document.createElement('details');
  chip.className = 'max-w-[90%] text-[11px] rounded border border-zinc-700 bg-zinc-800/40 px-2 py-1';
  const summary = document.createElement('summary');
  summary.className = 'cursor-pointer text-zinc-300 select-none';
  summary.textContent = `◆ ${name}(…)`;
  chip.appendChild(summary);
  const pre = document.createElement('pre');
  pre.className = 'mt-1 text-[10px] text-zinc-400 overflow-x-auto whitespace-pre-wrap';
  pre.textContent = JSON.stringify(input, null, 2);
  chip.appendChild(pre);
  return chip;
}

function renderToolResultBubble(result: PersistedToolResult): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'flex flex-col items-start gap-1 max-w-[90%]';
  const chip = document.createElement('details');
  const tone = result.isError ? 'border-red-700/60 bg-red-900/20 text-red-200' : 'border-emerald-700/40 bg-emerald-900/10 text-emerald-200';
  chip.className = `text-[11px] rounded border ${tone} px-2 py-1`;
  // If the tool returned an image, default to open so the user can see
  // it without expanding — that's the whole point of the affordance.
  if (result.image) chip.open = true;
  const summary = document.createElement('summary');
  summary.className = 'cursor-pointer select-none';
  const head = result.content.split('\n')[0].slice(0, 80);
  summary.textContent = `${result.isError ? '✗' : '✓'} ${head}${result.content.length > head.length ? '…' : ''}`;
  chip.appendChild(summary);
  const pre = document.createElement('pre');
  pre.className = 'mt-1 text-[10px] opacity-80 overflow-x-auto whitespace-pre-wrap';
  pre.textContent = result.content;
  chip.appendChild(pre);
  wrap.appendChild(chip);
  // Image bubble — the same render the AI sees, so the human and the
  // model are looking at literally the same pixels.
  if (result.image) {
    wrap.appendChild(renderImageBubble(result.image));
  }
  return wrap;
}

// === Pending images ===

async function attachIsoViews(): Promise<void> {
  const img = await captureIsoViews();
  if (!img) {
    setTransientStatus('No geometry to snapshot — run some code first.');
    return;
  }
  state.pendingImages.push(img);
  renderPendingImages();
}

async function attachFile(file: File): Promise<void> {
  const img = await fileToImageSource(file);
  if (!img) {
    setTransientStatus(`Skipped non-image: ${file.name}`);
    return;
  }
  attachImageSource(img);
}

/** Single entry point that pushes an image into the pending row AND
 *  records it in the recent-attachments store. Both the modal callback
 *  and the paste/drag-drop helpers route through this so re-attaches
 *  always show up in the picker on the next open. */
function attachImageSource(img: ImageSource): void {
  state.pendingImages.push(img);
  renderPendingImages();
  // Fire-and-forget — IDB write failures shouldn't block the UI; the
  // image is already attached to this turn either way.
  void putAttachment(img).catch(err => console.warn('Recent attachments: write failed', err));
}

function renderPendingImages(): void {
  if (!pendingImagesEl) return;
  pendingImagesEl.replaceChildren();
  if (state.pendingImages.length === 0) {
    pendingImagesEl.classList.add('hidden');
    return;
  }
  pendingImagesEl.classList.remove('hidden');
  state.pendingImages.forEach((img, i) => {
    const chip = document.createElement('div');
    chip.className = 'relative w-12 h-12 rounded border border-zinc-600 overflow-hidden';
    const el = document.createElement('img');
    el.src = `data:${img.mediaType};base64,${img.data}`;
    el.className = 'w-full h-full object-cover';
    chip.appendChild(el);
    const rm = document.createElement('button');
    rm.className = 'absolute top-0 right-0 w-4 h-4 bg-black/70 text-white text-[10px] rounded-bl';
    rm.textContent = '✕';
    rm.title = `Remove ${img.label ?? 'image'}`;
    rm.addEventListener('click', () => {
      state.pendingImages.splice(i, 1);
      renderPendingImages();
    });
    chip.appendChild(rm);
    pendingImagesEl!.appendChild(chip);
  });
}

// === Queue message (mid-run follow-up) ===

/** Append the current textarea + pending-images contents to the mid-run
 *  queue. The chatLoop's `onDrainQueuedBlocks` hook drains this at the
 *  next safe seam (between tool round-trips). If the loop exits with the
 *  queue still non-empty, runTurnWithStallRetry auto-fires a follow-up
 *  turn with the queued blocks as the new user message. */
function queueCurrentInput(): void {
  if (!inputEl) return;
  const text = inputEl.value.trim();
  if (text.length === 0 && state.pendingImages.length === 0) return;
  const blocks: ChatBlock[] = [];
  if (text.length > 0) blocks.push({ type: 'text', text });
  for (const img of state.pendingImages) blocks.push({ type: 'image', source: img });
  state.queuedBlocks.push(...blocks);
  inputEl.value = '';
  state.pendingImages = [];
  renderPendingImages();
  renderQueuedBadge();
  // Surface the queued blocks as a preview bubble at the bottom of the
  // transcript so the human gets immediate visual confirmation — without
  // this they'd see no feedback until end-of-turn reload.
  renderTranscript();
  inputEl.focus();
}

function renderQueuedBadge(): void {
  if (!queuedBadgeRef) return;
  if (state.queuedBlocks.length === 0) {
    queuedBadgeRef.classList.add('hidden');
    queuedBadgeRef.replaceChildren();
    return;
  }
  const textBlocks = state.queuedBlocks.filter(b => b.type === 'text');
  const imageCount = state.queuedBlocks.length - textBlocks.length;
  // Prefer the first queued text as the badge preview so the human can see
  // which message they queued at a glance (handy if they queued more than
  // one before the agent paused).
  const preview = textBlocks.length > 0 && textBlocks[0].type === 'text'
    ? textBlocks[0].text.split('\n')[0].slice(0, 80)
    : `${imageCount} image${imageCount === 1 ? '' : 's'}`;
  const more = state.queuedBlocks.length > 1 ? ` (+${state.queuedBlocks.length - 1} more)` : '';

  queuedBadgeRef.classList.remove('hidden');
  queuedBadgeRef.replaceChildren();
  const dot = document.createElement('span');
  dot.className = 'inline-block w-2 h-2 rounded-full bg-amber-400 animate-pulse';
  queuedBadgeRef.appendChild(dot);
  const label = document.createElement('span');
  label.className = 'flex-1 truncate';
  label.textContent = `Queued: ${preview}${more} — will send at next pause`;
  label.title = 'Queued for delivery on the agent\'s next response. Click ✕ to discard.';
  queuedBadgeRef.appendChild(label);
  const clearBtn = document.createElement('button');
  clearBtn.type = 'button';
  clearBtn.className = 'shrink-0 text-amber-400 hover:text-amber-200 px-1';
  clearBtn.textContent = '✕';
  clearBtn.title = 'Discard the queued message';
  clearBtn.addEventListener('click', () => {
    state.queuedBlocks = [];
    renderQueuedBadge();
    renderTranscript();
  });
  queuedBadgeRef.appendChild(clearBtn);
}

/** Pop the queue and return its contents. Called by chatLoop's
 *  `onDrainQueuedBlocks` hook and by the end-of-turn auto-restart. */
function drainQueuedBlocks(): ChatBlock[] {
  if (state.queuedBlocks.length === 0) return [];
  const drained = state.queuedBlocks;
  state.queuedBlocks = [];
  renderQueuedBadge();
  // Clear the preview bubble — onUserMessageUpdated (mid-loop case) or the
  // end-of-turn reload (auto-restart case) will replace it with the real
  // delivered bubble. Re-rendering here drops the now-stale preview
  // immediately so it doesn't visually duplicate when the real one lands.
  renderTranscript();
  return drained;
}

// === Rewind / fast-forward ===

/** Remove the last user-initiated turn (the last user message with actual
 *  typed content, plus everything that follows it) from history and IndexedDB.
 *  The removed slice is pushed onto rewindStack so fast-forward can restore it.
 *  Clears itself when the user sends a new message (conversation has diverged). */
async function rewindTurn(): Promise<void> {
  if (state.inFlight) return;
  // Find the last message the user actually typed (has blocks — not a pure
  // tool_result carrier which has toolResults but empty blocks).
  let cutIndex = -1;
  for (let i = state.history.length - 1; i >= 0; i--) {
    if (state.history[i].role === 'user' && state.history[i].blocks.length > 0) {
      cutIndex = i;
      break;
    }
  }
  if (cutIndex < 0) return;
  const removed = state.history.splice(cutIndex);
  state.rewindStack.push(removed);
  await deleteMessages(removed.map(m => m.id));
  renderTranscript();
  updateRewindButtons();
}

/** Restore the most recently rewound turn from the rewindStack back into
 *  history and IndexedDB. */
async function fastForwardTurn(): Promise<void> {
  if (state.inFlight) return;
  const toRestore = state.rewindStack.pop();
  if (!toRestore?.length) return;
  await putMessages(toRestore);
  for (const msg of toRestore) {
    const insertAt = state.history.findIndex(m => m.seq > msg.seq);
    if (insertAt === -1) state.history.push(msg);
    else state.history.splice(insertAt, 0, msg);
  }
  renderTranscript();
  updateRewindButtons();
}

function updateRewindButtons(): void {
  const canRewind = !state.inFlight &&
    state.history.some(m => m.role === 'user' && m.blocks.length > 0);
  const canForward = !state.inFlight && state.rewindStack.length > 0;
  if (rewindBtnRef) rewindBtnRef.disabled = !canRewind;
  if (forwardBtnRef) forwardBtnRef.disabled = !canForward;
}

// === Send message ===

async function sendMessage(): Promise<void> {
  if (state.inFlight) return;
  if (!inputEl) return;
  const text = inputEl.value.trim();
  if (text.length === 0 && state.pendingImages.length === 0) return;

  const settings = loadSettings();
  let apiKey: string | undefined;
  if (settings.toggles.provider === 'anthropic') {
    const key = await getKey('anthropic');
    if (!key) {
      void showAiKeyModal({ onConnected: () => { panelStatusUpdate(); void sendMessage(); } });
      return;
    }
    apiKey = key.apiKey;
  } else {
    if (!settings.toggles.localModel) {
      void showAiLocalModal({ onChange: () => { panelStatusUpdate(); renderModelPicker(); renderToggleStrip(); renderCostMeter(); void sendMessage(); } });
      return;
    }
    // Auto-load the model into GPU on first message — saves a click.
    if (!isModelLoaded(settings.toggles.localModel)) {
      setTransientStatus('Loading model into GPU (first turn only)...');
      try {
        await ensureModelLoaded(settings.toggles.localModel, {
          onProgress: r => setTransientStatus(r.text || `Loading ${Math.round(r.progress * 100)}%`),
        });
        setTransientStatus('');
      } catch (err) {
        setTransientStatus(`Failed to load: ${err instanceof Error ? err.message : String(err)}`);
        return;
      }
    }
  }

  // Session spend gate. The dropdown is a session-total budget, so block
  // a new turn once historical spend has reached it. The user has to
  // raise the cap (or pick ∞) to keep going — otherwise the dropdown
  // would be advisory only and continued prompting would silently sail
  // past the chosen budget.
  const sessionCap = SPEND_CAP_USD[loadSettings().toggles.maxSpend];
  if (Number.isFinite(sessionCap)) {
    const sessionTotal = totalCost(state.history);
    if (sessionTotal >= sessionCap) {
      setTransientStatus(`Session has spent ${formatUsd(sessionTotal)} — at or over the ${formatUsd(sessionCap)} cap. Raise the $ cap in the toggle strip to continue.`);
      return;
    }
  }

  // The drawer is a fixed overlay on every page (landing, catalog, help),
  // but the AI's tools (runAndSave, setCode, paint*) target the editor.
  // If the user fires from anywhere else, navigate to /editor and give
  // the route handler a beat to mount the editor + engine before runTurn
  // starts calling window.partwright methods.
  if (window.location.pathname !== '/editor' && navigateToEditorFn) {
    setTransientStatus('Switching to editor…');
    try {
      await navigateToEditorFn();
    } catch (err) {
      setTransientStatus(`Navigation failed: ${err instanceof Error ? err.message : String(err)}`);
      return;
    }
    // Wait for window.partwright to actually be live before proceeding.
    // The editor mount + engine init is async; polling is simpler than
    // wiring a dedicated ready event for one caller.
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
      const w = window as unknown as { partwright?: { run?: unknown } };
      if (w.partwright?.run) break;
      await new Promise(r => setTimeout(r, 50));
    }
  }

  const blocks: ChatBlock[] = [];
  if (text.length > 0) blocks.push({ type: 'text', text });
  // Only attach images the user added if vision is on. Iso views are
  // user-initiated via Show AI; pending images get sent regardless because
  // the user's intent is explicit when they attached them.
  for (const img of state.pendingImages) blocks.push({ type: 'image', source: img });

  inputEl.value = '';
  state.pendingImages = [];
  renderPendingImages();
  // Sending a new message commits to this branch of the conversation —
  // any rewound turns can no longer be re-applied.
  state.rewindStack = [];
  progressState.retryCount = 0;
  stalledByWatchdog = false;
  await runTurnWithStallRetry(apiKey, settings.toggles, blocks);
}

/** Wraps runTurn with: in-progress indicator, stall watchdog, and bounded
 *  auto-retry. When the watchdog fires we abort and re-issue the same
 *  conversation; on retry attempts userBlocks is empty because the user
 *  message is already in history from the first attempt. */
interface TurnOutcome {
  totalCostUsd: number;
  toolCalls: number;
  reason: TurnOutcomeReason;
  detail?: string;
  iterations: number;
}

function formatTurnOutcome(o: TurnOutcome): string {
  const cost = formatUsd(o.totalCostUsd);
  const iters = `${o.iterations} iter`;
  const tools = o.toolCalls > 0 ? `, ${o.toolCalls} tool call${o.toolCalls === 1 ? '' : 's'}` : '';
  switch (o.reason) {
    case 'end_turn':
      return `✓ done · ${cost} · ${iters}${tools}`;
    case 'empty_final':
      return `⚠ model exited without a final message · ${cost} · ${iters}${tools} — last visible content is above`;
    case 'iteration_cap':
      return `⚠ stopped at agent iteration cap (${o.iterations}) — try a more focused prompt, click Compact, or raise the ⟲ cap · ${cost}${tools}`;
    case 'spend_cap':
      return `⚠ stopped at session spend cap${o.detail ? ` (${o.detail})` : ''} — raise the $ cap to continue · ${cost} · ${iters}${tools}`;
    case 'max_tokens': {
      const isLocal = loadSettings().toggles.provider === 'local';
      const hint = isLocal
        ? 'try a shorter prompt, switch to a larger local model, or compact the chat'
        : 'ask the model to continue';
      return `⚠ hit max_tokens before finishing · ${cost} · ${iters}${tools} — ${hint}`;
    }
    case 'refusal':
      return `⊘ model refused · ${cost} · ${iters}${tools}`;
    case 'aborted':
      return `⊘ stopped · ${cost} · ${iters}${tools}`;
    case 'error':
      return `✗ ${o.detail ?? 'error'} · ${cost} · ${iters}${tools}`;
    default:
      return `· ended (${o.detail ?? 'other'}) · ${cost} · ${iters}${tools}`;
  }
}

async function runTurnWithStallRetry(apiKey: string | undefined, toggles: ChatToggles, userBlocks: ChatBlock[]): Promise<void> {
  let attempt = 0;
  let lastTurnOutcome: TurnOutcome | null = null;
  while (true) {
    attempt++;
    const controller = new AbortController();
    state.inFlight = true;
    state.inFlightController = controller;
    setSendButtonMode('inflight');
    showProgress('thinking', 'starting…');

    let activeAssistantId: string | null = null;
    let liveTextEl: HTMLElement | null = null;
    const blocksForThisAttempt = attempt === 1 ? userBlocks : [];

    await runTurn({
      apiKey,
      toggles,
      sessionId: state.sessionId,
      history: state.history,
      userBlocks: blocksForThisAttempt,
      signal: controller.signal,
      onDrainQueuedBlocks: drainQueuedBlocks,
    }, {
      onUserPersisted: msg => {
        state.history.push(msg);
        renderTranscript();
        updateRewindButtons();
      },
      onUserMessageUpdated: msg => {
        // chatLoop persists tool_result user messages directly without
        // firing onUserPersisted, so the first time we hear about one mid-
        // turn (because the human's queue triggered a merge) we have to
        // insert it ourselves at the right seq position — otherwise
        // renderTranscript can't show the human's bubble until end-of-turn
        // reload, and the user thinks their message vanished.
        const idx = state.history.findIndex(m => m.id === msg.id);
        if (idx >= 0) {
          state.history[idx] = msg;
        } else {
          const insertAt = state.history.findIndex(m => m.seq > msg.seq);
          if (insertAt === -1) state.history.push(msg);
          else state.history.splice(insertAt, 0, msg);
        }
        renderTranscript();
        setTransientStatus('Queued message delivered to the AI.');
      },
      onAssistantStart: id => {
        activeAssistantId = id;
        const placeholder: ChatMessage = {
          id, sessionId: state.sessionId, role: 'assistant',
          blocks: [{ type: 'text', text: '' }], createdAt: Date.now(),
          seq: (state.history[state.history.length - 1]?.seq ?? 0) + 1,
        };
        state.history.push(placeholder);
        renderTranscript();
        // renderMessage tags the empty placeholder bubble with
        // `data-live-bubble` so we can find it reliably — `bg-zinc-800` is
        // shared by tool-call chips and other UI and isn't a stable target.
        if (transcriptEl) {
          liveTextEl = transcriptEl.querySelector(`[data-live-bubble="${id}"]`) as HTMLElement | null;
          if (liveTextEl) liveTextEl.textContent = '';
        }
      },
      onAssistantText: delta => {
        if (liveTextEl) {
          liveTextEl.textContent = (liveTextEl.textContent ?? '') + delta;
          if (transcriptEl) transcriptEl.scrollTop = transcriptEl.scrollHeight;
        }
      },
      onProgress: info => showProgress(info.phase, info.detail),
      onAssistantPersisted: msg => {
        const idx = state.history.findIndex(m => m.id === activeAssistantId);
        if (idx >= 0) state.history[idx] = msg;
        activeAssistantId = null;
        liveTextEl = null;
        renderTranscript();
        renderCostMeter();
      },
      onToolResult: (_id, _name, result) => {
        if (result.isError) setTransientStatus('A tool errored. The agent will retry or surface the issue.');
      },
      onError: err => {
        errorLog.capture({ level: 'error', source: 'ai', message: err.message, detail: err.stack });
        // Replace the in-memory "Thinking…" placeholder with a visible
        // error bubble so the user can see what failed and recover via
        // the Retry button. The bubble is in-memory only (not persisted),
        // so a session change wipes it. We also capture the outcome and
        // flash the transient status for visibility.
        if (activeAssistantId) {
          const idx = state.history.findIndex(m => m.id === activeAssistantId);
          const errorMsg: ChatMessage = {
            id: activeAssistantId,
            sessionId: state.sessionId,
            role: 'assistant',
            blocks: [{ type: 'text', text: err.message }],
            createdAt: Date.now(),
            seq: idx >= 0 ? state.history[idx].seq : (state.history[state.history.length - 1]?.seq ?? 0) + 1,
            errored: true,
          };
          if (idx >= 0) state.history[idx] = errorMsg;
          else state.history.push(errorMsg);
          activeAssistantId = null;
          liveTextEl = null;
          renderTranscript();
        }
        setTransientStatus(`Error: ${err.message}`);
        lastTurnOutcome = { totalCostUsd: 0, toolCalls: 0, reason: 'error', detail: err.message, iterations: 0 };
      },
      onAborted: () => {
        // Only show the user-stopped notice if the user actually clicked
        // Stop — when the watchdog fires, the message is misleading.
        if (!stalledByWatchdog) {
          setTransientStatus('Stopped. Type a new message to continue or redirect.');
          inputEl?.focus();
        }
      },
      onTurnComplete: info => {
        // Do NOT reload from IndexedDB here. Every message callback
        // (onUserPersisted, onAssistantPersisted, onUserMessageUpdated) keeps
        // state.history current throughout the turn, so the in-memory state is
        // already correct. A DB reload races with the next queued turn: if the
        // user queued a message mid-turn, turn 2 starts immediately after drain
        // and its onUserPersisted write may not have committed before the reload
        // transaction opened — IndexedDB snapshot isolation means the reload
        // returns a stale snapshot that drops the new message, causing it to
        // flash and vanish from the transcript.
        renderTranscript();
        renderCostMeter();
        // Auto-compaction only fires on clean turns — skip it after an
        // abort, error, or errored placeholder so the user can keep
        // context for retry/recovery.
        const erroredFromThisTurn = state.history.some(m => m.errored);
        if (!erroredFromThisTurn && info.reason !== 'aborted' && info.reason !== 'error') {
          void maybeAutoCompact();
        }
        lastTurnOutcome = info;
      },
    });

    state.inFlight = false;
    state.inFlightController = null;
    setSendButtonMode('send');
    updateRewindButtons();

    // Surface a sticky completion banner so the user knows the turn
    // actually ended and why — better than a silent hideProgress that
    // reads as "the model stalled and gave up".
    if (lastTurnOutcome) {
      showProgressFinal(formatTurnOutcome(lastTurnOutcome));
      lastTurnOutcome = null;
    } else {
      hideProgress();
    }

    if (stalledByWatchdog && progressState.retryCount <= MAX_STALL_RETRIES) {
      // Strip the empty/partial assistant message left by the stalled
      // attempt so the retry doesn't see (or send back to the model) a
      // ghost bubble.
      await stripLastAbortedAssistant();
      stalledByWatchdog = false;
      continue;
    }

    // If the human queued a message and the agent loop exited (end_turn,
    // refusal, iteration cap, spend cap, abort…) without the drain hook
    // picking it up, fire it now as a fresh user turn. This covers the
    // common case where the human queued a follow-up while the model was
    // streaming its final assistant turn (no tool_use → no drain seam).
    if (state.queuedBlocks.length > 0) {
      const next = drainQueuedBlocks();
      progressState.retryCount = 0;
      stalledByWatchdog = false;
      lastTurnOutcome = null;
      userBlocks = next;
      attempt = 0;
      continue;
    }
    return;
  }
}

/** Find the last assistant message marked `aborted` at the tail of the
 *  in-memory history, delete it from IndexedDB, and reload. Used to clean
 *  up after the stall watchdog. */
async function stripLastAbortedAssistant(): Promise<void> {
  for (let i = state.history.length - 1; i >= 0; i--) {
    const m = state.history[i];
    if (m.role !== 'assistant') continue;
    if (m.aborted) {
      await deleteMessages([m.id]);
      await loadHistoryForCurrentSession();
      renderTranscript();
      return;
    }
    break;
  }
}

function setSendButtonMode(mode: 'send' | 'inflight'): void {
  if (stopBtnRef) {
    stopBtnRef.classList.toggle('hidden', mode !== 'inflight');
  }
  if (!sendBtnRef) return;
  // Button label stays "Send" in both states. The semantics are: Send when
  // idle dispatches immediately; Send while in-flight queues the message
  // for delivery at the next agent pause. The tooltip surfaces the queue
  // semantics so the human isn't surprised by the click outcome.
  if (mode === 'inflight') {
    sendBtnRef.title = 'Queue this message for the AI (Enter). It will be delivered at the next pause, no need to stop the agent.';
  } else {
    sendBtnRef.title = 'Send your message (Enter). Shift+Enter for newline.';
  }
}

// === Progress indicator + stall watchdog ===

interface ProgressTracker {
  phase: 'thinking' | 'streaming' | 'tool' | 'final' | 'idle';
  detail?: string;
  lastBeat: number;
  retryCount: number;
}

const progressState: ProgressTracker = { phase: 'idle', lastBeat: 0, retryCount: 0 };

/** Wall-clock seconds without a stream beat before we treat the request as
 *  stalled. Read from localContext.stallTimeoutSec at fire time so the user
 *  can raise it for slow models without reloading. The watchdog beats on
 *  every text delta so this is the gap BETWEEN tokens, not total turn time. */
function getStallThresholdMs(): number {
  return loadSettings().localContext.stallTimeoutSec * 1000;
}
const MAX_STALL_RETRIES = 2;
/** Phases where a long silence indicates a real stall — not 'tool' (tool
 *  execution is synchronous JS and may legitimately run for a few seconds
 *  with no progress events) and not 'idle' (we shouldn't be running). */
const STALL_PHASES = new Set<ProgressTracker['phase']>(['thinking', 'streaming']);

function showProgress(phase: ProgressTracker['phase'], detail?: string): void {
  // Per-text-delta calls land here too (the watchdog needs lastBeat fresh
  // to know the stream is healthy). Skip the DOM rebuild when nothing the
  // user can see has changed — the 1s ticker keeps the "(15s silent)"
  // counter accurate, and avoiding replaceChildren() on every token saves
  // hundreds of DOM rewrites/sec during a streaming response.
  const visualChanged = progressState.phase !== phase || progressState.detail !== detail;
  progressState.phase = phase;
  progressState.detail = detail;
  progressState.lastBeat = Date.now();
  if (visualChanged) renderProgress();
  if (!progressEl) return;
  progressEl.classList.remove('hidden');
  if (progressTickerId === null) {
    // Re-render every second so the "(15s)" elapsed counter updates and
    // the stall watchdog can fire from the same tick.
    progressTickerId = window.setInterval(renderProgress, 1000);
  }
}

function hideProgress(): void {
  progressState.phase = 'idle';
  if (progressEl) progressEl.classList.add('hidden');
  if (progressTickerId !== null) {
    clearInterval(progressTickerId);
    progressTickerId = null;
  }
}

function renderProgress(): void {
  if (!progressEl) return;
  if (progressState.phase === 'idle') return;
  const elapsedSec = Math.max(0, Math.round((Date.now() - progressState.lastBeat) / 1000));
  const silentSuffix = elapsedSec > 3 ? ` (${elapsedSec}s silent)` : '';
  const label =
    progressState.phase === 'thinking' ? `🧠 thinking…${silentSuffix}` :
    progressState.phase === 'streaming' ? `✎ streaming response…${silentSuffix}` :
    progressState.phase === 'tool' ? `🔧 ${progressState.detail ?? 'running tool'}…` :
    progressState.phase === 'final' ? (progressState.detail ?? '✓ done') :
    '';
  progressEl.replaceChildren();
  const dot = document.createElement('span');
  // Final-state dot is static and colored by outcome rather than pulsing.
  const dotColor =
    progressState.phase === 'final'
      ? (label.startsWith('⚠') ? 'bg-amber-400' : label.startsWith('✗') || label.startsWith('⊘') ? 'bg-red-400' : 'bg-emerald-400')
      : 'bg-blue-400 animate-pulse';
  dot.className = `inline-block w-2 h-2 rounded-full ${dotColor}`;
  progressEl.appendChild(dot);
  const text = document.createElement('span');
  text.textContent = label;
  progressEl.appendChild(text);
  if (
    state.inFlightController &&
    STALL_PHASES.has(progressState.phase) &&
    elapsedSec * 1000 > getStallThresholdMs()
  ) {
    triggerStallRetry();
  }
}

/** Display a sticky completion / failure status for ~6s after a turn
 *  ends. Replaces the silent hideProgress() that left users wondering
 *  whether the model finished, errored, or just stopped speaking. */
function showProgressFinal(detail: string): void {
  if (!progressEl) return;
  progressState.phase = 'final';
  progressState.detail = detail;
  progressState.lastBeat = Date.now();
  progressEl.classList.remove('hidden');
  renderProgress();
  if (progressTickerId !== null) {
    clearInterval(progressTickerId);
    progressTickerId = null;
  }
  window.setTimeout(() => {
    if (progressState.phase === 'final' && progressState.detail === detail) {
      hideProgress();
    }
  }, 6000);
}

function triggerStallRetry(): void {
  const threshSec = Math.round(getStallThresholdMs() / 1000);
  if (progressState.retryCount >= MAX_STALL_RETRIES) {
    setTransientStatus(`Model stalled (no tokens for ${threshSec}s) after ${MAX_STALL_RETRIES} retries — stopping. Increase "Stall timeout" in AI settings if using a slow model.`);
    state.inFlightController?.abort();
    void interruptLocal();
    return;
  }
  progressState.retryCount++;
  setTransientStatus(`No response for ${threshSec}s — auto-resuming (retry ${progressState.retryCount}/${MAX_STALL_RETRIES})...`);
  stalledByWatchdog = true;
  state.inFlightController?.abort();
  void interruptLocal();
}

// === Compaction ===

// === Auto-compaction ===

/** Runs after every successful turn. Honors the user's autoCompactMode:
 *  - off:           do nothing.
 *  - conservative:  no auto-fire (the persistent "Compact now" link on
 *                   the cost meter at ≥80% is the canonical surface).
 *  - standard:      silently compact at 70% full, keep last 4 turns.
 *  - aggressive:    compact after every turn, keep just the last
 *                   exchange. Best when full history doesn't matter —
 *                   like driving the modeler. */
async function maybeAutoCompact(): Promise<void> {
  const settings = loadSettings();
  const mode = settings.autoCompactMode;
  if (mode === 'off' || mode === 'conservative') return;

  const tokens = totalTokensEstimate(state.history, effectiveSystemPromptChars());
  const ctxLimit = contextLimitFor(settings);
  const pct = ctxLimit > 0 ? tokens / ctxLimit : 0;

  let keepTail: number;
  if (mode === 'aggressive') {
    keepTail = 2;
    if (state.history.length <= keepTail + 1) return;
  } else {
    // standard
    keepTail = 4;
    if (pct < 0.7) return;
    if (state.history.length <= keepTail + 1) return;
  }

  let apiKey: string | undefined;
  if (settings.toggles.provider === 'anthropic') {
    const key = await getKey('anthropic');
    if (!key) return;
    apiKey = key.apiKey;
  } else if (!settings.toggles.localModel) {
    return;
  }

  let proposal;
  try {
    proposal = await proposeCompaction({ toggles: settings.toggles, apiKey }, state.history, keepTail);
  } catch (err) {
    // Don't block the user's actual conversation on a flaky compactor —
    // but DO surface it so a quietly-broken auto-compact doesn't leave
    // them wondering why context keeps growing.
    const msg = err instanceof Error ? err.message : String(err);
    setTransientStatus(`Auto-compact skipped: ${msg}. Click Compact to retry.`);
    return;
  }

  // Promote any proposed notes silently so insights survive.
  const w = window as unknown as { partwright?: { addSessionNote?: (t: string) => Promise<unknown> } };
  if (w.partwright?.addSessionNote && state.sessionId !== GLOBAL_CHAT_BUCKET) {
    for (const note of proposal.proposedNotes) {
      try { await w.partwright.addSessionNote(note); } catch { /* noop */ }
    }
  }

  const summaryMsg: ChatMessage = {
    id: generateId(),
    sessionId: state.sessionId,
    role: 'assistant',
    blocks: [{ type: 'text', text: `[auto-compacted ${proposal.drop.length} turn(s)]\n${proposal.summary}` }],
    createdAt: Date.now(),
    seq: nextCompactedSeq(state.history),
    compacted: true,
  };
  await deleteMessages(proposal.drop.map(m => m.id));
  await putMessages([summaryMsg]);
  await loadHistoryForCurrentSession();
  renderTranscript();
  renderCostMeter();
}

async function runCompact(): Promise<void> {
  if (state.inFlight) {
    setTransientStatus('Wait for the current turn to finish before compacting.');
    return;
  }
  const settings = loadSettings();
  let apiKey: string | undefined;
  if (settings.toggles.provider === 'anthropic') {
    const key = await getKey('anthropic');
    if (!key) {
      void showAiKeyModal({ onConnected: () => panelStatusUpdate() });
      return;
    }
    apiKey = key.apiKey;
    setTransientStatus('Asking Haiku to summarize...');
  } else {
    if (!settings.toggles.localModel) {
      void showAiLocalModal({ onChange: () => panelStatusUpdate() });
      return;
    }
    if (!isModelLoaded(settings.toggles.localModel)) {
      setTransientStatus('Loading model into GPU...');
      try {
        await ensureModelLoaded(settings.toggles.localModel, {
          onProgress: r => setTransientStatus(r.text || `Loading ${Math.round(r.progress * 100)}%`),
        });
      } catch (err) {
        setTransientStatus(`Failed to load: ${err instanceof Error ? err.message : String(err)}`);
        return;
      }
    }
    setTransientStatus('Asking local model to summarize...');
  }
  let proposal;
  try {
    proposal = await proposeCompaction({ toggles: settings.toggles, apiKey }, state.history);
  } catch (err) {
    setTransientStatus(`Compaction failed: ${err instanceof Error ? err.message : String(err)}`);
    return;
  }
  setTransientStatus('');

  showCompactConfirmModal(proposal, async ({ summary, notes }) => {
    // Promote selected notes to durable session log via the existing API
    const w = window as unknown as { partwright?: { addSessionNote?: (t: string) => Promise<unknown> } };
    if (w.partwright?.addSessionNote && state.sessionId !== GLOBAL_CHAT_BUCKET) {
      for (const note of notes) {
        try { await w.partwright.addSessionNote(note); } catch { /* noop */ }
      }
    }
    // Replace the dropped tail with one synthetic summary message
    const summaryMsg: ChatMessage = {
      id: generateId(),
      sessionId: state.sessionId,
      role: 'assistant',
      blocks: [{ type: 'text', text: `[compacted summary]\n${summary}` }],
      createdAt: Date.now(),
      seq: nextCompactedSeq(state.history),
      compacted: true,
    };
    await deleteMessages(proposal.drop.map(m => m.id));
    await putMessages([summaryMsg]);
    await loadHistoryForCurrentSession();
    renderTranscript();
    renderCostMeter();
    setTransientStatus(`Compacted ${proposal.drop.length} turn(s); promoted ${notes.length} note(s).`);
  });
}

// === Status flash ===

let statusTimer: number | null = null;

function setTransientStatus(text: string): void {
  if (!panelStatusEl) return;
  if (statusTimer !== null) {
    clearTimeout(statusTimer);
    statusTimer = null;
  }
  if (!text) {
    panelStatusUpdate();
    return;
  }
  panelStatusEl.classList.remove('hidden', 'text-amber-400');
  panelStatusEl.classList.add('text-blue-300');
  panelStatusEl.textContent = text;
  statusTimer = window.setTimeout(() => {
    statusTimer = null;
    panelStatusUpdate();
  }, 4000);
}
