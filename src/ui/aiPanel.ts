// Right-side floating chat drawer. The single largest UI surface of the AI
// feature — owns the transcript view, the cost-control toggle strip, the
// input row, the cost meter, and the compact button. State lives in the
// ai/* modules; this file is mostly DOM wiring.

import { totalCost, totalTokensEstimate, estimateCachedPrefixTokens, runTurn as runTurnOnMainThread, type RunTurnInput, type RunTurnCallbacks } from '../ai/chatLoop';
import { runTurn as runTurnInWorker, pushQueuedBlocks } from '../ai/agentWorkerClient';
import { listMessages, GLOBAL_CHAT_BUCKET, putMessages, deleteMessages, getKey, clearChat, mergeChatBucket } from '../ai/db';
import { proposeCompaction } from '../ai/compaction';
import { captureIsoViews, fileToImageSource } from '../ai/images';
import { loadSettings, saveSettings, setAnthropicModel, setOpenaiModel, setGeminiModel, setCustomModel, setProvider, setLocalModel, setToggles, providerLabel, aiConnectionMode, ANTHROPIC_MODEL_OPTIONS, OPENAI_MODEL_OPTIONS, GEMINI_MODEL_OPTIONS, MAX_ITERATIONS_OPTIONS, MAX_SPEND_OPTIONS, THINKING_OPTIONS, RENDER_RESOLUTION_OPTIONS, VERIFY_ANGLE_OPTIONS, type AiSettings } from '../ai/settings';
import { buildLocalSystemPrompt, buildMediumLocalSystemPrompt, buildSystemPrompt, loadAiMd } from '../ai/systemPrompt';
import { estimateTurnCostUsd, formatUsd } from '../ai/cost';
import { getLimits } from '../ai/catalog';
import { generateId } from '../storage/db';
import { showAiKeyModal } from './aiKeyModal';
import { showAiSettingsModal } from './aiSettingsModal';
import { showAiReviewModal } from './aiReviewModal';
import { showAiDiagnosticsModal } from './aiDiagnosticsModal';
import { showAiPromptLibraryModal } from './aiPromptLibraryModal';
import { starterChipIdeas } from '../ideas/ideas';
import { showAiLocalModal } from './aiLocalModal';
import { showSystemPromptModal } from './aiSystemPromptModal';
import { showCompactConfirmModal } from './aiCompactModal';
import { showAttachmentModal } from './aiAttachmentModal';
import { putAttachment } from '../ai/attachments';
import { exportChatMarkdown } from '../export/chat';
import { getState, setSessionAiPreference, refreshCurrentSession } from '../storage/sessionManager';
import { onTabSync, publishTabSync } from '../storage/tabSync';
import { onOwnershipChange } from '../storage/sessionLock';
import { ensureModelLoaded, effectiveContextCeiling, interruptLocal, isModelLoaded, resolveLocalModel } from '../ai/local';
import { activeModel, SPEND_CAP_USD, type ChatBlock, type ChatMessage, type ChatToggles, type ImageSource, type PersistedToolResult, type Preset, type Provider, type TurnOutcomeReason } from '../ai/types';
import { matchSlashCommands, parseSlashCommand, slashMenuPrefix, type SlashCommandName, type SlashCommandSpec } from '../ai/slashCommands';
import { errorLog } from '../diagnostics/errorLog';
import { onConnectivityChange, isOnline } from '../util/connectivity';

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
  /** Set when planFirst mode has generated a plan and is awaiting user
   *  approval. Cleared on approve (which fires the real execution turn) or
   *  reject (which removes planning messages from history and restores the
   *  original input). null when no plan is pending. */
  pendingPlanApproval: {
    originalText: string;
    originalImages: ImageSource[];
    /** Length of state.history before the planning turn was sent, so
     *  reject can remove exactly the planning messages that were added. */
    historyLengthBefore: number;
  } | null;
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
  pendingPlanApproval: null,
};

/** Cached length of `public/ai.md` + PREAMBLE, in characters, populated
 *  once on init. Used for every hosted provider (Anthropic/OpenAI/Gemini),
 *  which all receive the full ai.md system prompt. Default is a rough match
 *  for the current ai.md so the context meter is sensible before the fetch
 *  lands. */
let cachedAiMdLength = 55_000;

/** Effective system-prompt length in characters for the active provider /
 *  model / override combo. Drives the context meter and the auto-compact
 *  threshold — recomputed each render so flipping provider in AI settings
 *  doesn't strand us with the wrong number. */
function effectiveSystemPromptChars(): number {
  const s = loadSettings();
  const override = s.systemPromptOverrides?.[s.toggles.provider] ?? null;
  if (override !== null) return override.length;
  // Every hosted provider gets the full ai.md prompt (see chatLoop's
  // system-prompt branch); only 'local' gets the slim variant. Counting the
  // local length for OpenAI/Gemini under-reported ~12K tokens of prompt and
  // made the context meter / auto-compaction fire far too late.
  if (s.toggles.provider !== 'local') return cachedAiMdLength;
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
 *  on the cost meter and the auto-compaction thresholds. Hosted providers
 *  read from the models.dev snapshot so Haiku's 200k, GPT-5's 400k, and
 *  Gemini's 1M get the right number without us hand-maintaining a table.
 *  Custom / out-of-catalog ids fall back to 200k (the smallest current
 *  hosted-model window, conservative for the % bar). For local models we
 *  use the runtime-resolved WASM ceiling (fetched from the model's
 *  mlc-chat-config.json) when available, clamped by any user override. */
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
  const model = activeModel(settings.toggles);
  const limits = model ? getLimits(settings.toggles.provider, String(model)) : null;
  return limits?.context ?? 200_000;
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
let planApprovalBarEl: HTMLElement | null = null;

// Slash-command autocomplete menu state. The menu sits just above the input
// row and shows while the user is typing a "/command" token. `slashMenuItems`
// is the currently-filtered list; `slashMenuIndex` is the keyboard highlight;
// `slashMenuUserSelected` records whether the user has explicitly arrowed to a
// choice (so a stray Enter on a bare "/" doesn't fire the default command).
let slashMenuEl: HTMLElement | null = null;
let slashMenuItems: SlashCommandSpec[] = [];
let slashMenuIndex = 0;
let slashMenuUserSelected = false;

/** "Stuck to bottom" detection for the transcript. The auto-scroll on every
 *  streamed delta used to fight the user when they scrolled up to read earlier
 *  content. The fix is to measure pinned-ness *before* mutating content (since
 *  appending text grows scrollHeight and would otherwise un-pin a user who was
 *  at the bottom), then only re-pin to bottom if they were already there. The
 *  threshold gives leeway for sub-pixel rounding and inertial scrolling. */
const STICKY_BOTTOM_THRESHOLD_PX = 24;
function isTranscriptPinnedToBottom(): boolean {
  if (!transcriptEl) return true;
  return transcriptEl.scrollHeight - transcriptEl.scrollTop - transcriptEl.clientHeight <= STICKY_BOTTOM_THRESHOLD_PX;
}
function pinTranscriptToBottom(): void {
  if (!transcriptEl) return;
  transcriptEl.scrollTop = transcriptEl.scrollHeight;
}
let pendingImagesEl: HTMLElement | null = null;
let toggleStripEl: HTMLElement | null = null;
let costMeterEl: HTMLElement | null = null;
let panelStatusEl: HTMLElement | null = null;
let prefNoticeEl: HTMLElement | null = null;
let offlineNoticeEl: HTMLElement | null = null;
/** False when another tab holds the single-writer lock for the current
 *  session — this tab is then a read-only viewer. */
let writeOwner = true;
let progressEl: HTMLElement | null = null;
let progressTickerId: number | null = null;
let navigateToEditorFn: (() => Promise<void> | void) | null = null;
let modelPickerEl: HTMLElement | null = null;
let promptChipEl: HTMLElement | null = null;
let panelWidth = 420;
/** App-level flex row the docked panel mounts into (see AiPanelOptions). */
let mountTarget: HTMLElement | null = null;

/** Set by the watchdog when it abort()s mid-stream so sendMessage knows
 *  this was a stall recovery (auto-resume), not a user-initiated stop. */
let stalledByWatchdog = false;

export interface AiPanelOptions {
  /** main.ts hands in a navigation helper so the panel can move the user
   *  to the editor before firing a request from another page. Avoids a
   *  silent-modeling-on-landing-page UX bug where the AI runs code but
   *  the user can't see the result. */
  onNavigateToEditor?: () => Promise<void> | void;
  /** App-level flex row the panel docks into as its right-hand column. It
   *  lives outside the per-page subtrees, so the docked panel survives route
   *  changes (landing ↔ editor) — the landing-page chat flow depends on that.
   *  Falls back to <body> if omitted. */
  mountInto?: HTMLElement;
  /** Suppress the remembered-open auto-expand for this load. main.ts passes
   *  this when the app boots on the landing page so the drawer never
   *  auto-opens there, even if `drawerOpen` is set from a prior editor
   *  session. The user can still open it manually. */
  suppressAutoOpen?: boolean;
}

/** Mount the drawer once on app start. Idempotent. */
export async function initAiPanel(opts: AiPanelOptions = {}): Promise<void> {
  if (drawerEl) return;
  navigateToEditorFn = opts.onNavigateToEditor ?? null;
  mountTarget = opts.mountInto ?? null;
  // Pre-load ai.md so the first turn doesn't pay the fetch latency on top
  // of the API round trip. Also caches its length for the context meter.
  const aiMd = await loadAiMd();
  cachedAiMdLength = buildSystemPrompt(aiMd).length;

  const settings = loadSettings();
  panelWidth = settings.aiPanelWidth;
  // Honor the remembered open state, but never auto-open on the landing page
  // (main.ts sets suppressAutoOpen there) — the drawer shouldn't pop open
  // before the user has even entered the editor.
  state.open = settings.drawerOpen && !opts.suppressAutoOpen;

  buildDrawer();
  // The panel docks as a column on desktop but becomes a full-screen overlay
  // on mobile; recompose its layout when the breakpoint is crossed while open.
  const mq = window.matchMedia('(min-width: 768px)');
  const onBreakpoint = () => { if (state.open) applyDockLayout(); };
  if (typeof mq.addEventListener === 'function') mq.addEventListener('change', onBreakpoint);
  else (mq as unknown as { addListener: (cb: () => void) => void }).addListener(onBreakpoint);
  // Re-assert this session's remembered model when the tab regains focus, so
  // the tab you're actively using reflects its own session's model even if a
  // peer tab changed the shared settings while this tab was in the background.
  window.addEventListener('focus', () => { void applySessionAiPreference(); });
  // Reflect single-writer ownership and live-update the transcript when a peer
  // tab changes this session's chat.
  onOwnershipChange(({ owned }) => applyOwnership(owned));
  onTabSync((msg) => {
    if (msg.kind === 'chat') void reloadChatFromPeer(msg.sessionId);
  });
  // Don't try to load history until a session is opened or we know we're
  // in the global bucket. main.ts will call setActiveSession when ready.
  await loadHistoryForCurrentSession();
  // Paint the loaded history now. buildDrawer's first renderTranscript ran
  // against empty state, and the setActiveSession call that follows in
  // main.ts early-returns when we're already on the global bucket — so
  // without this, pre-existing global chat history wouldn't show until the
  // next interaction.
  renderTranscript();
  renderCostMeter();
  // On a default-open load, show the panel without grabbing keyboard focus —
  // the user hasn't asked to type in it yet.
  if (state.open) showDrawer(false);
  else if (opts.suppressAutoOpen) {
    // Landing-page boot: keep the drawer visually hidden (its default state)
    // but DON'T persist drawerOpen:false — that would wipe the user's
    // remembered preference, so the panel wouldn't auto-open in the editor
    // later. The drawer element already starts with the `hidden` class.
    state.open = false;
  } else hideDrawer();
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
  state.pendingPlanApproval = null;
  renderPlanApprovalBar();
  await loadHistoryForCurrentSession();
  await applySessionAiPreference();
  renderTranscript();
  // Session switch is an explicit user action — land at the bottom regardless
  // of where they were scrolled in the previous session's transcript.
  pinTranscriptToBottom();
  renderCostMeter();
}

export function toggleAiPanel(): void {
  if (state.open) hideDrawer();
  else showDrawer();
}

/** Open the AI panel (if closed) and drop `text` into the chat input without
 *  sending it — the user reads/tweaks it and hits send themselves. Used by the
 *  prompt library and the /ideas page so picking a prompt lands here. */
export function prefillAiInput(text: string): void {
  if (!state.open) showDrawer(false);
  if (!inputEl) return;
  inputEl.value = text;
  inputEl.focus();
  const end = text.length;
  inputEl.setSelectionRange(end, end);
}

/** Re-render everything that an AI-settings change (provider / model / key)
 *  can affect, and persist the new provider+model as the session preference. */
function afterAiSettingsChange(): void {
  recordSessionAiPreference();
  renderTranscript();
  renderToggleStrip();
  renderCostMeter();
  renderModelPicker();
  renderPromptChip();
  panelStatusUpdate();
  updateOfflineNotice();
}

/** Activity-rail AI button entry point. Toggles the docked panel like
 *  toggleAiPanel, but when it's *opening* the panel from a not-yet-connected
 *  state it also pops the AI settings modal so the user lands directly on the
 *  connect flow. The default-open-on-load path uses showDrawer() directly, so
 *  it never triggers this. */
export async function toggleAiPanelFromToolbar(): Promise<void> {
  if (state.open) { hideDrawer(); return; }
  showDrawer();
  if (await aiConnectionMode() === 'disconnected') {
    void showAiSettingsModal({ onChange: afterAiSettingsChange });
  }
}

/** Switch the panel between its desktop "docked column" form and its mobile
 *  "full-screen overlay" form. Only meaningful while open. */
function applyDockLayout(): void {
  if (!drawerEl) return;
  const desktop = window.matchMedia('(min-width: 768px)').matches;
  if (desktop) {
    // A real flex child of the app row: takes layout space, no overlay chrome.
    // `relative` makes the panel the containing block for the absolutely-
    // positioned left-edge resize handle, so the handle lands on the panel's
    // border instead of escaping to the viewport. On mobile the panel is
    // `fixed` (its own containing block), so `relative` is dropped there to
    // avoid the two position utilities colliding.
    drawerEl.classList.remove('fixed', 'inset-0', 'z-40', 'h-dvh', 'w-full', 'shadow-2xl');
    drawerEl.classList.add('relative', 'shrink-0', 'self-stretch');
    drawerEl.style.width = `${panelWidth}px`;
  } else {
    // Stacked mobile layout has no side-by-side column to dock into, so cover
    // the screen instead. h-dvh keeps the input above the mobile browser chrome.
    drawerEl.classList.remove('relative', 'shrink-0', 'self-stretch');
    drawerEl.classList.add('fixed', 'inset-0', 'z-40', 'h-dvh', 'w-full', 'shadow-2xl');
    drawerEl.style.width = '';
  }
}

/** Show the drawer. `focusInput` moves the caret into the chat box, which is
 *  what you want when the user *explicitly* opens the panel — but not when it's
 *  shown automatically on a default-open page load, where stealing focus from
 *  the editor/viewport (and intercepting shortcuts like ⌘Z) is surprising. */
function showDrawer(focusInput = true): void {
  if (!drawerEl) return;
  state.open = true;
  drawerEl.classList.remove('hidden');
  applyDockLayout();
  window.dispatchEvent(new CustomEvent('ai-panel-toggled', { detail: { open: true } }));
  window.dispatchEvent(new Event('resize'));
  saveSettings({ ...loadSettings(), drawerOpen: true });
  if (focusInput) inputEl?.focus();
}

function hideDrawer(): void {
  if (!drawerEl) return;
  state.open = false;
  drawerEl.classList.add('hidden');
  window.dispatchEvent(new CustomEvent('ai-panel-toggled', { detail: { open: false } }));
  window.dispatchEvent(new Event('resize'));
  saveSettings({ ...loadSettings(), drawerOpen: false });
}

async function loadHistoryForCurrentSession(): Promise<void> {
  state.history = await listMessages(state.sessionId);
  updateRewindButtons();
}

// === Per-session AI preference ===

/** Is this session's remembered provider/model usable right now? Cloud
 *  providers need a stored key; local needs the model id to still resolve. */
async function isProviderModelUsable(provider: Provider, model: string): Promise<boolean> {
  if (provider === 'local') {
    try { resolveLocalModel(model); return true; } catch { return false; }
  }
  // Custom is usable once its endpoint URL is configured — the API key is
  // optional, so don't gate on a stored key.
  if (provider === 'custom') return loadSettings().toggles.customBaseUrl.trim().length > 0;
  return !!(await getKey(provider));
}

/** Record the active AI config (provider + model + the full toggle set +
 *  preset) as the current session's preference so reopening — or taking control
 *  of — the session in another tab restores exactly what this tab was using.
 *  Cheap and idempotent (the storage layer skips no-op writes). Only ever
 *  called on a real user-initiated change, never on load, so a freshly-opened
 *  session the user hasn't touched keeps no stored config (and the global
 *  default applies). */
function recordSessionAiPreference(): void {
  const s = loadSettings();
  const model = activeModel(s.toggles);
  if (typeof model === 'string' && model.length > 0) {
    void setSessionAiPreference(
      s.toggles.provider,
      model,
      s.toggles as unknown as Record<string, unknown>,
      s.preset,
    );
  }
}

/** Apply a user-initiated change from the toggle strip: write it to this tab's
 *  settings AND persist the full toggle set as the session's remembered config,
 *  so it carries over when the session is reopened or taken control of in
 *  another tab. (Per-tab live; per-session persisted — never broadcast, so it
 *  doesn't bleed into other open windows.) */
function applyToggleChange(partial: Parameters<typeof setToggles>[1]): void {
  saveSettings(setToggles(loadSettings(), partial));
  recordSessionAiPreference();
}

/** Restore the session's remembered AI config into THIS tab's settings — called
 *  on session open and when this tab takes control of the session (not live on
 *  every peer write, so windows never bleed into each other). If the remembered
 *  model isn't available right now we keep the user's current model and show a
 *  non-blocking notice — without erasing the stored preference, so it snaps back
 *  once the model is available again. */
async function applySessionAiPreference(): Promise<void> {
  // Only the writer applies its session's remembered config. A viewer applying
  // would mutate this tab's settings to mirror a session it can't drive.
  if (!writeOwner) return;
  hidePrefNotice();
  const pref = getState().session?.aiPreference;
  if (!pref) return;
  const known: Provider[] = ['anthropic', 'openai', 'gemini', 'custom', 'local'];
  const provider = pref.provider as Provider;
  if (!known.includes(provider)) return;
  if (!(await isProviderModelUsable(provider, pref.model))) {
    showPrefNotice(provider, pref.model);
    return;
  }
  const cur = loadSettings();
  let next: AiSettings;
  if (pref.toggles) {
    // Full per-session toggle snapshot (current format): restore provider,
    // every per-provider model id, and all the toggles in one shot. Skip when
    // already applied so the focus / take-control re-assert is a cheap no-op
    // (no needless settings write or transcript-shifting re-render).
    const sameToggles = JSON.stringify(cur.toggles) === JSON.stringify(pref.toggles);
    if (sameToggles && (!pref.preset || cur.preset === pref.preset)) return;
    next = setToggles(cur, pref.toggles as unknown as Parameters<typeof setToggles>[1]);
    if (pref.preset) next = { ...next, preset: pref.preset as Preset };
  } else {
    // Legacy {provider, model} only (sessions saved before toggles were stored).
    if (cur.toggles.provider === provider && activeModel(cur.toggles) === pref.model) return;
    next = setProvider(cur, provider);
    switch (provider) {
      case 'anthropic': next = setAnthropicModel(next, pref.model); break;
      case 'openai': next = setOpenaiModel(next, pref.model); break;
      case 'gemini': next = setGeminiModel(next, pref.model); break;
      case 'custom': next = setCustomModel(next, pref.model); break;
      case 'local': next = setLocalModel(next, pref.model); break;
    }
  }
  saveSettings(next);
  renderModelPicker();
  renderToggleStrip();
  renderCostMeter();
  renderPromptChip();
  panelStatusUpdate();
}

function showPrefNotice(provider: Provider, model: string): void {
  if (!prefNoticeEl) return;
  prefNoticeEl.replaceChildren();
  const msg = document.createElement('span');
  msg.className = 'flex-1';
  msg.textContent = `This session last used ${providerLabel(provider)} (${model}), which isn't available right now — using your current model. It'll be restored when that one is available again.`;
  const dismiss = document.createElement('button');
  dismiss.type = 'button';
  dismiss.className = 'shrink-0 text-amber-300 hover:text-amber-100';
  dismiss.textContent = '✕';
  dismiss.title = 'Dismiss';
  dismiss.addEventListener('click', hidePrefNotice);
  prefNoticeEl.append(msg, dismiss);
  prefNoticeEl.classList.remove('hidden');
}

function hidePrefNotice(): void {
  if (!prefNoticeEl) return;
  prefNoticeEl.classList.add('hidden');
  prefNoticeEl.replaceChildren();
}

// === Single-writer ownership + cross-tab chat sync ===

/** Announce that this session's chat transcript changed so viewer tabs reload. */
function broadcastChatChanged(): void {
  if (state.sessionId && state.sessionId !== GLOBAL_CHAT_BUCKET) {
    publishTabSync({ kind: 'chat', sessionId: state.sessionId });
  }
}

/** A peer tab changed this session's chat — reload so a read-along viewer stays
 *  current. Skipped while a turn is in flight here (our in-memory history wins
 *  during an active turn). */
async function reloadChatFromPeer(sessionId: string): Promise<void> {
  if (sessionId !== state.sessionId || state.inFlight) return;
  await loadHistoryForCurrentSession();
  renderTranscript();
  renderCostMeter();
}

function applyOwnership(owned: boolean): void {
  // No real session (global bucket) = no contention = always writable.
  const noRealSession = !state.sessionId || state.sessionId === GLOBAL_CHAT_BUCKET;
  const wasOwner = writeOwner;
  writeOwner = noRealSession ? true : owned;
  // The whole-screen viewer overlay (viewerMode.ts) is the single "locked" UI
  // now; the send-disable + sendMessage guard stay as a backstop.
  if (sendBtnRef) sendBtnRef.disabled = !writeOwner;
  // Becoming a viewer mid-turn (another tab took control): stop our run.
  if (!writeOwner) stopActiveTurn();
  // Gaining write-ownership of a real session — "Take control" in a new tab —
  // is one of the explicit transitions where state SHOULD carry over from the
  // tab that had it. Re-read the session from IndexedDB first (the previous
  // writer persisted its config there without broadcasting), then apply it so
  // this tab adopts that session's provider/model/toggles.
  if (writeOwner && !wasOwner && !noRealSession) {
    void (async () => {
      await refreshCurrentSession();
      await applySessionAiPreference();
    })();
  }
}

/** Abort any in-flight AI turn — used by the Stop button and when this tab
 *  loses write-ownership (another tab took control). */
function stopActiveTurn(): void {
  // Anthropic stops via AbortSignal through the SDK; local (WebLLM) ignores the
  // signal, so interruptLocal() is what halts it mid-token.
  state.inFlightController?.abort();
  void interruptLocal();
}

/** Insert or replace a message in the in-memory transcript, keeping it
 *  ordered by `seq`. Replaces in place when the id is already present
 *  (re-persist of the same message), otherwise splices it into the right
 *  slot. Used by the mid-turn callbacks that surface tool results and
 *  drained queued messages before the turn fully completes. */
function upsertHistoryMessage(msg: ChatMessage): void {
  const idx = state.history.findIndex(m => m.id === msg.id);
  if (idx >= 0) {
    state.history[idx] = msg;
    return;
  }
  const insertAt = state.history.findIndex(m => m.seq > msg.seq);
  if (insertAt === -1) state.history.push(msg);
  else state.history.splice(insertAt, 0, msg);
}

// === DOM construction ===

function buildDrawer(): void {
  const root = document.createElement('div');
  root.id = 'ai-panel';
  // Docked right-hand column of the app row (#app-row): a real flex child that
  // takes layout space rather than floating over the page. `hidden` is the
  // closed state; showDrawer()/applyDockLayout() add the desktop-docked vs
  // mobile-overlay classes. Starts hidden — initAiPanel calls show/hideDrawer
  // once panelWidth and drawerOpen are known.
  root.className = 'flex flex-col min-h-0 bg-zinc-900 border-l border-zinc-700 hidden';
  root.style.width = `${panelWidth}px`;
  drawerEl = root;

  // Left-edge drag handle for resizing panel width. Desktop-only — on the
  // mobile full-screen overlay there's no column to widen.
  // w-5 (20px) gives a finger-friendly touch target; the visible stripe stays
  // 1px wide so it doesn't look like a thick border.
  const panelResizeHandle = document.createElement('div');
  panelResizeHandle.className = 'hidden md:block absolute top-0 left-0 h-full w-5 -translate-x-1/2 cursor-col-resize z-10 touch-none group';
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

  const reviewBtn = createIconButton('Review', '👁');
  reviewBtn.title = 'Get a second opinion: have a different provider/model review the current session and post feedback.';
  reviewBtn.addEventListener('click', () => { void launchReview(); });
  header.appendChild(reviewBtn);

  const compactBtn = createIconButton('Compact', '⤓ Compact');
  compactBtn.title = 'Compact the conversation: summarize older turns and promote insights to session notes.';
  compactBtn.addEventListener('click', () => { void runCompact(); });
  header.appendChild(compactBtn);

  const exportBtn = createIconButton('Export chat', '⬇ Chat');
  exportBtn.title = 'Export this conversation as a Markdown (.md) file. Saves the whole transcript — text, tool calls, and results.';
  exportBtn.addEventListener('click', exportCurrentChat);
  header.appendChild(exportBtn);

  const clearBtn = createIconButton('Clear', '🗑');
  clearBtn.title = 'Clear the chat history for the current session. The conversation is removed from your browser; saved versions and notes are untouched.';
  clearBtn.addEventListener('click', () => { void clearCurrentChat(); });
  header.appendChild(clearBtn);

  const promptsBtn = createIconButton('Prompt library', '💡');
  promptsBtn.title = 'Prompt library — example prompts to try. Pick one to drop it into the chat box (you can edit it before sending).';
  promptsBtn.addEventListener('click', () => {
    showAiPromptLibraryModal({ onSelect: (idea) => prefillAiInput(idea.prompt ?? '') });
  });
  header.appendChild(promptsBtn);

  const diagBtn = createIconButton('AI Call Log', '🩺');
  diagBtn.title = 'AI Call Log — recent provider API calls: request shape, stop reason, token usage, full error messages. Open this when a turn ends with a confusing status.';
  diagBtn.addEventListener('click', () => { showAiDiagnosticsModal(); });
  header.appendChild(diagBtn);

  const settingsBtn = createIconButton('Settings', '⚙');
  settingsBtn.title = 'AI settings: provider, key, lifetime usage.';
  settingsBtn.addEventListener('click', () => {
    void showAiSettingsModal({ onChange: afterAiSettingsChange });
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

  // Per-session AI-preference notice — shown when this session's remembered
  // model/provider isn't currently available (key removed, local model not
  // installed, id retired). Non-blocking and dismissible; the stored
  // preference is kept so it's restored when the model is available again.
  prefNoticeEl = document.createElement('div');
  prefNoticeEl.className = 'px-3 py-1.5 text-[11px] border-b border-amber-800/60 bg-amber-900/20 text-amber-200 hidden flex items-start gap-2';
  root.appendChild(prefNoticeEl);

  // Offline notice — shown only when the network is down *and* a cloud provider
  // is active. Cloud turns will fail offline, so we point the user at the local
  // (WebLLM) model, which runs entirely in the browser with no network.
  offlineNoticeEl = document.createElement('div');
  offlineNoticeEl.id = 'offline-notice';
  offlineNoticeEl.className = 'px-3 py-1.5 text-[11px] border-b border-amber-800/60 bg-amber-900/20 text-amber-200 hidden flex items-start gap-2';
  root.appendChild(offlineNoticeEl);
  // Re-render on connectivity changes (fires once immediately to set state).
  onConnectivityChange(() => updateOfflineNotice());

  // Transcript
  transcriptEl = document.createElement('div');
  transcriptEl.id = 'ai-transcript';
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

  // Plan approval bar — shown after planFirst mode generates a plan, until
  // the user approves (proceeds to execution) or rejects (restores input).
  planApprovalBarEl = document.createElement('div');
  planApprovalBarEl.className = 'px-3 py-2 border-t border-amber-700/60 bg-amber-900/20 flex items-center gap-2 shrink-0 hidden';
  root.appendChild(planApprovalBarEl);

  // Bottom section — rewind, toggles, cost, input
  const bottomSection = document.createElement('div');
  bottomSection.className = 'flex flex-col shrink-0 overflow-hidden';
  bottomSection.style.height = '220px';
  initInputResizer(inputResizeHandle, bottomSection);


  // Toggle strip
  toggleStripEl = document.createElement('div');
  toggleStripEl.className = 'px-3 py-1.5 border-t border-zinc-800 flex flex-col gap-1 shrink-0';
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
  ta.placeholder = 'Ask the AI to model something…  (type / for commands)';
  ta.rows = 2;
  ta.className = 'w-full flex-1 min-h-0 px-2 py-1.5 rounded bg-zinc-800 border border-zinc-600 text-zinc-100 text-sm placeholder:text-zinc-500 focus:outline-none focus:border-blue-500 resize-none';
  ta.addEventListener('keydown', e => {
    // When the slash-command menu is open it owns the arrow/Tab/Enter/Escape
    // keys so the user can navigate and run a command without it being sent
    // to the model as a message.
    if (isSlashMenuOpen()) {
      if (e.key === 'ArrowDown') { e.preventDefault(); moveSlashSelection(1); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); moveSlashSelection(-1); return; }
      if (e.key === 'Tab') { e.preventDefault(); completeSlashSelection(); return; }
      if (e.key === 'Escape') { e.preventDefault(); hideSlashMenu(); return; }
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        // Only run on Enter when the choice is unambiguous: the user has
        // explicitly highlighted an item (arrow keys), or the filter has
        // narrowed to a single command. A bare "/" — or any prefix matching
        // several commands — leaves the highlight on whatever is first, so a
        // stray Enter would silently fire that command (e.g. /compact). In
        // that case consume the Enter and keep the menu open to refine.
        if (slashSelectionConfirmed()) {
          const cmd = slashMenuItems[slashMenuIndex];
          if (cmd) runSlashCommand(cmd.name as SlashCommandName);
        }
        return;
      }
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      // A bare "/command" runs the command instead of being sent as a message.
      if (maybeRunSlashCommand()) return;
      void sendMessage();
    }
  });
  ta.addEventListener('input', () => { updateSlashMenu(); });
  // Hide the menu when focus genuinely leaves the input. Row clicks keep focus
  // (they preventDefault on mousedown), so this fires only on a real blur.
  ta.addEventListener('blur', () => { window.setTimeout(() => hideSlashMenu(), 120); });
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
    stopActiveTurn();
  });
  stopBtnRef = stopBtn;
  inputBtnRow.appendChild(stopBtn);

  const sendBtn = document.createElement('button');
  sendBtn.className = 'shrink-0 px-3 py-1.5 rounded text-xs font-medium bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-50 disabled:cursor-not-allowed';
  sendBtn.textContent = 'Send';
  sendBtn.addEventListener('click', () => {
    // A bare "/command" runs the command rather than being sent/queued.
    if (maybeRunSlashCommand()) return;
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

  // Slash-command autocomplete menu — a floating overlay anchored just above
  // the input. It uses `position: fixed` (coordinates set in
  // positionSlashMenu() from the textarea's rect) so it overlays the content
  // above the input instead of taking flow space — the textarea never changes
  // size or shape. Fixed positioning also escapes the bottom section's
  // `overflow-hidden`, which would otherwise clip an upward-growing menu.
  slashMenuEl = document.createElement('div');
  slashMenuEl.id = 'ai-slash-menu';
  slashMenuEl.className = 'fixed z-50 rounded border border-zinc-600 bg-zinc-800 shadow-xl max-h-56 overflow-y-auto hidden';
  root.appendChild(slashMenuEl);
  // Keep the overlay glued to the input if the viewport (or panel) resizes
  // while it's open. Keystrokes already reposition via renderSlashMenu().
  window.addEventListener('resize', () => { if (isSlashMenuOpen()) positionSlashMenu(); });

  // Drag-drop image handling
  root.addEventListener('dragover', e => { e.preventDefault(); root.classList.add('ring-2', 'ring-blue-500'); });
  root.addEventListener('dragleave', e => { if (e.target === root) root.classList.remove('ring-2', 'ring-blue-500'); });
  root.addEventListener('drop', async e => {
    e.preventDefault();
    root.classList.remove('ring-2', 'ring-blue-500');
    if (!e.dataTransfer) return;
    for (const file of Array.from(e.dataTransfer.files)) await attachFile(file);
  });

  (mountTarget ?? document.body).appendChild(root);

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
    // The docked column owns real layout width, so widening it reflows the page
    // automatically — no #app padding to keep in sync.
    if (drawerEl) drawerEl.style.width = `${panelWidth}px`;
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

  // Hosted providers (anthropic / openai / gemini) render a dropdown of
  // curated models; a custom id stashed in settings is appended as
  // "<id> (custom)" so it stays selectable. Local renders the picker chip.
  const hostedConfig: Record<'anthropic' | 'openai' | 'gemini', { options: { id: string; label: string }[]; current: string; title: string; setModel: (id: string) => AiSettings }> = {
    anthropic: {
      options: ANTHROPIC_MODEL_OPTIONS,
      current: settings.toggles.anthropicModel,
      title: 'Anthropic model (hosted).',
      setModel: (id) => setAnthropicModel(loadSettings(), id),
    },
    openai: {
      options: OPENAI_MODEL_OPTIONS,
      current: settings.toggles.openaiModel,
      title: 'OpenAI model (hosted). Custom ids: AI Settings → OpenAI.',
      setModel: (id) => setOpenaiModel(loadSettings(), id),
    },
    gemini: {
      options: GEMINI_MODEL_OPTIONS,
      current: settings.toggles.geminiModel,
      title: 'Google Gemini model (hosted). Custom ids: AI Settings → Gemini.',
      setModel: (id) => setGeminiModel(loadSettings(), id),
    },
  };

  if (settings.toggles.provider in hostedConfig) {
    const cfg = hostedConfig[settings.toggles.provider as keyof typeof hostedConfig];
    const sel = document.createElement('select');
    sel.className = 'h-6 px-2 rounded text-[11px] bg-zinc-800 border border-zinc-700 text-zinc-200 focus:outline-none';
    sel.title = cfg.title;
    let foundCurrent = false;
    for (const opt of cfg.options) {
      const o = document.createElement('option');
      o.value = opt.id;
      o.textContent = opt.label;
      sel.appendChild(o);
      if (opt.id === cfg.current) foundCurrent = true;
    }
    if (!foundCurrent && cfg.current) {
      const custom = document.createElement('option');
      custom.value = cfg.current;
      custom.textContent = `${cfg.current} (custom)`;
      sel.appendChild(custom);
    }
    sel.value = cfg.current;
    sel.addEventListener('change', () => {
      saveSettings(cfg.setModel(sel.value));
      recordSessionAiPreference();
      renderToggleStrip();
      renderCostMeter();
    });
    modelPickerEl.appendChild(sel);
    return;
  }

  // Custom OpenAI-compatible endpoint: a chip showing the configured model
  // (or a prompt to configure), opening AI Settings on the Custom tab — the
  // endpoint URL + model live there, like the local model lives in its modal.
  if (settings.toggles.provider === 'custom') {
    const customChip = document.createElement('button');
    customChip.type = 'button';
    customChip.className = 'h-6 px-2 inline-flex items-center rounded text-[11px] bg-sky-900/30 border border-sky-700/50 text-sky-200 hover:bg-sky-900/50';
    customChip.textContent = settings.toggles.customModel.trim() || 'Configure endpoint';
    customChip.title = settings.toggles.customBaseUrl.trim()
      ? `Custom endpoint: ${settings.toggles.customBaseUrl} · model: ${settings.toggles.customModel || '(none set)'}. Click to configure.`
      : 'No custom endpoint configured yet. Click to set the base URL and model.';
    customChip.addEventListener('click', () => {
      void showAiSettingsModal({ onChange: afterAiSettingsChange }, { initialTab: 'custom' });
    });
    modelPickerEl.appendChild(customChip);
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
    void showAiLocalModal({ onChange: () => { recordSessionAiPreference(); renderModelPicker(); renderToggleStrip(); renderCostMeter(); panelStatusUpdate(); } });
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

// Whether the collapsible "Options" group (verification knobs, caps, thinking
// level) is expanded. In-memory; collapsed by default so the panel reads clean.
let advancedOpen = false;

function renderToggleStrip(): void {
  if (!toggleStripEl) return;
  toggleStripEl.replaceChildren();
  const settings = loadSettings();
  const { toggles } = settings;

  // Primary actions — always visible (the pills the user flips most often).
  const primary = document.createElement('div');
  primary.className = 'flex flex-wrap items-center gap-1';
  // Advanced knobs — set once and rarely touched; tucked behind ⚙ Options.
  const adv = document.createElement('div');
  adv.className = 'flex flex-wrap items-center gap-1 mt-1.5 pt-1.5 border-t border-zinc-800';

  primary.appendChild(togglePill(
    '📸 Auto-render',
    toggles.vision.views,
    'Auto-render: lets the model call renderView() to take its own screenshots after paint / geometry changes. Each render ≈ 1500 tokens of input on the next turn — verification is valuable but it adds up. The 📷 Show AI button still works manually when this is OFF.',
    () => {
      applyToggleChange({ vision: { views: !toggles.vision.views } });
      renderToggleStrip();
      renderCostMeter();
    },
  ));

  // Verification image resolution — pixel size of the screenshots the model
  // renders to check its work. Lower = cheaper vision spend; caps any size the
  // model requests via renderView/renderViews.
  const resSel = document.createElement('select');
  resSel.className = 'px-1.5 py-0.5 rounded text-[10px] bg-zinc-800 border border-zinc-700 text-zinc-300 focus:outline-none';
  resSel.title = 'Verification image resolution: pixel size of the screenshots the AI renders to check its work. Lower = cheaper vision spend; higher = sharper but more image tokens. Caps any size the model requests.';
  for (const opt of RENDER_RESOLUTION_OPTIONS) {
    const o = document.createElement('option');
    o.value = opt.id;
    o.textContent = `📐 ${opt.label}`;
    o.title = opt.hint;
    resSel.appendChild(o);
  }
  resSel.value = toggles.vision.resolution;
  resSel.addEventListener('change', () => {
    applyToggleChange({ vision: { resolution: resSel.value as ChatToggles['vision']['resolution'] } });
    renderCostMeter();
  });
  adv.appendChild(resSel);

  // Verification angles — how many camera angles renderViews captures per check.
  const anglesSel = document.createElement('select');
  anglesSel.className = 'px-1.5 py-0.5 rounded text-[10px] bg-zinc-800 border border-zinc-700 text-zinc-300 focus:outline-none';
  anglesSel.title = 'Verification angles: how many camera angles the AI captures per renderViews check. Fewer = cheaper; more = better coverage but more image tokens.';
  for (const opt of VERIFY_ANGLE_OPTIONS) {
    const o = document.createElement('option');
    o.value = opt.id;
    o.textContent = `🎥 ${opt.label}`;
    o.title = opt.hint;
    anglesSel.appendChild(o);
  }
  anglesSel.value = toggles.vision.angles;
  anglesSel.addEventListener('change', () => {
    applyToggleChange({ vision: { angles: anglesSel.value as ChatToggles['vision']['angles'] } });
  });
  adv.appendChild(anglesSel);

  primary.appendChild(togglePill(
    '▶ Run',
    toggles.scope.runCode,
    'Run code: allow the AI to execute geometry code (runCode, runAndSave). OFF makes it suggest code in chat without running.',
    () => {
      applyToggleChange({ scope: { runCode: !toggles.scope.runCode } });
      renderToggleStrip();
    },
  ));
  primary.appendChild(togglePill(
    '💾 Save',
    toggles.scope.saveVersions,
    'Save versions: allow the AI to commit results to the gallery (runAndSave, loadVersion). OFF keeps the model in run-only / dry-run mode.',
    () => {
      applyToggleChange({ scope: { saveVersions: !toggles.scope.saveVersions } });
      renderToggleStrip();
    },
  ));
  primary.appendChild(togglePill(
    '🎨 Paint',
    toggles.scope.paintFaces,
    'Paint: allow the AI to set color regions (paintInBox, paintSlab, paintNear, etc.). OFF by default — painting locks the editor and is the easiest place for the AI to over-select.',
    () => {
      applyToggleChange({ scope: { paintFaces: !toggles.scope.paintFaces } });
      renderToggleStrip();
    },
  ));
  primary.appendChild(togglePill(
    '📝 Notes',
    toggles.scope.sessionNotes,
    'Session notes: allow the AI to call addSessionNote to log design decisions. OFF saves a tool round-trip per note — the chat transcript already records the reasoning.',
    () => {
      applyToggleChange({ scope: { sessionNotes: !toggles.scope.sessionNotes } });
      renderToggleStrip();
    },
  ));
  primary.appendChild(togglePill(
    '♾ Auto-continue',
    toggles.autoResume,
    'Auto-continue: the agent keeps working until it calls the finish tool to declare the task done — if a turn ends without calling finish, it is automatically resumed instead of stopping. Bounded by the ⟲ iteration cap and the $ spend cap (whichever trips first). Useful for models that tend to stop early (e.g. Gemini). ON by default; turn it OFF to stop at each end_turn as usual (your choice is remembered).',
    () => {
      applyToggleChange({ autoResume: !toggles.autoResume });
      renderToggleStrip();
    },
  ));
  primary.appendChild(togglePill(
    '📋 Plan',
    toggles.planFirst,
    'Plan first: when ON, the AI writes a step-by-step plan before doing any work. You approve or reject the plan before execution starts. Useful for complex requests where you want to review the approach first.',
    () => {
      applyToggleChange({ planFirst: !toggles.planFirst });
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
    applyToggleChange({ autoRetry: Number(retry.value) as 0 | 1 | 3 });
  });
  adv.appendChild(retry);

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
    applyToggleChange({ maxIterations: iterCap.value as ChatToggles['maxIterations'] });
  });
  adv.appendChild(iterCap);

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
    applyToggleChange({ maxSpend: spendCap.value as ChatToggles['maxSpend'] });
  });
  adv.appendChild(spendCap);

  // Thinking level — how much the model reasons before answering. Maps
  // per-provider to Anthropic extended-thinking budget_tokens, Gemini
  // thinkingBudget (+ surfaced thought parts), and OpenAI reasoning_effort.
  // Off (the default) sends no thinking request, so it's the cheapest and
  // reproduces the pre-feature behavior. No effect on local models.
  const thinkSel = document.createElement('select');
  thinkSel.className = 'px-1.5 py-0.5 rounded text-[10px] bg-zinc-800 border border-zinc-700 text-zinc-300 focus:outline-none';
  thinkSel.title = 'Thinking: how much the model reasons before it answers. Maps to Anthropic extended-thinking budget, Gemini thinkingBudget, and OpenAI reasoning_effort. Off = no extended reasoning (cheapest, fastest). Higher levels help on hard spatial/assembly problems but cost more output tokens. No effect on local models (their reasoning is handled by the model itself).';
  for (const opt of THINKING_OPTIONS) {
    const o = document.createElement('option');
    o.value = opt.id;
    o.textContent = `🧠 ${opt.label}`;
    o.title = opt.hint;
    thinkSel.appendChild(o);
  }
  thinkSel.value = toggles.thinking;
  thinkSel.addEventListener('change', () => {
    applyToggleChange({ thinking: thinkSel.value as ChatToggles['thinking'] });
    renderCostMeter();
  });
  adv.appendChild(thinkSel);

  // Disclosure toggle for the advanced group.
  const optBtn = document.createElement('button');
  optBtn.className = advancedOpen
    ? 'px-2 py-0.5 rounded text-[10px] bg-zinc-700/60 border border-zinc-600 text-zinc-200'
    : 'px-2 py-0.5 rounded text-[10px] bg-zinc-800 border border-zinc-700 text-zinc-400 [@media(hover:hover)]:hover:text-zinc-200';
  optBtn.textContent = advancedOpen ? '⚙ Options ▴' : '⚙ Options ▾';
  optBtn.title = 'Advanced AI controls: verification image resolution & angles, auto-retry, iteration & spend caps, and thinking level. Hidden by default to keep the panel uncluttered.';
  optBtn.setAttribute('aria-expanded', String(advancedOpen));
  optBtn.addEventListener('click', () => { advancedOpen = !advancedOpen; renderToggleStrip(); });
  primary.appendChild(optBtn);

  toggleStripEl.appendChild(primary);
  if (advancedOpen) toggleStripEl.appendChild(adv);
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
  const turnEst = model ? estimateTurnCostUsd(settings.toggles.provider, model, cachedPrefix, 500) : 0;

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

/** Show/hide the offline notice. Visible only when the browser is offline and
 *  a cloud provider is active — local (WebLLM) needs no network, so we stay
 *  quiet there. While online (the normal case, and the case in tests) the
 *  notice is always hidden, so this is purely additive. */
function updateOfflineNotice(): void {
  if (!offlineNoticeEl) return;
  const settings = loadSettings();
  const cloud = settings.toggles.provider !== 'local';
  if (isOnline() || !cloud) {
    offlineNoticeEl.classList.add('hidden');
    offlineNoticeEl.replaceChildren();
    return;
  }
  offlineNoticeEl.replaceChildren();
  offlineNoticeEl.appendChild(document.createTextNode(
    `You're offline, so ${providerLabel(settings.toggles.provider)} can't respond. You can keep modeling, or `,
  ));
  const link = document.createElement('button');
  link.className = 'underline text-amber-100 hover:text-white';
  link.textContent = 'switch to a local model';
  link.addEventListener('click', () => {
    void showAiLocalModal({ onChange: () => { afterAiSettingsChange(); } });
  });
  offlineNoticeEl.appendChild(link);
  offlineNoticeEl.appendChild(document.createTextNode(' that runs in your browser.'));
  offlineNoticeEl.classList.remove('hidden');
}

function panelStatusUpdate(): void {
  if (!panelStatusEl) return;
  const settings = loadSettings();
  if (settings.toggles.provider === 'local') {
    panelStatusEl.replaceChildren();
    panelStatusEl.classList.remove('hidden', 'text-emerald-400', 'text-amber-400', 'text-blue-300');
    if (!settings.toggles.localModel) {
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
      panelStatusEl.classList.add('text-zinc-400');
    }
    // Quality hint — always shown when local is the active provider so the
    // user knows cloud providers exist and are sharper. Click opens AI
    // Settings (on a cloud tab) where the Enable buttons live.
    const hint = document.createElement('div');
    hint.className = 'text-zinc-400 mt-0.5';
    hint.appendChild(document.createTextNode('Choose a '));
    const switchLink = document.createElement('button');
    switchLink.className = 'underline text-zinc-200 hover:text-zinc-50';
    switchLink.textContent = 'non-local AI provider';
    switchLink.addEventListener('click', () => {
      void showAiSettingsModal(
        { onChange: () => { renderTranscript(); renderToggleStrip(); renderCostMeter(); renderModelPicker(); renderPromptChip(); panelStatusUpdate(); } },
        { initialTab: 'anthropic' },
      );
    });
    hint.appendChild(switchLink);
    hint.appendChild(document.createTextNode(' for better quality.'));
    panelStatusEl.appendChild(hint);
    return;
  }
  // Custom OpenAI-compatible endpoint: readiness is the base URL + model
  // (the API key is optional), so don't run the cloud-key check below — it
  // would falsely report "Not connected" for a keyless self-hosted server.
  if (settings.toggles.provider === 'custom') {
    panelStatusEl.replaceChildren();
    panelStatusEl.classList.remove('hidden', 'text-emerald-400', 'text-amber-400', 'text-blue-300');
    const needsUrl = settings.toggles.customBaseUrl.trim().length === 0;
    const needsModel = settings.toggles.customModel.trim().length === 0;
    if (needsUrl || needsModel) {
      panelStatusEl.classList.add('text-amber-400');
      panelStatusEl.appendChild(document.createTextNode(needsUrl ? 'Custom endpoint not configured. ' : 'No model set for the endpoint. '));
      const link = document.createElement('button');
      link.className = 'underline text-amber-200 hover:text-amber-100';
      link.textContent = needsUrl ? 'Set endpoint URL' : 'Choose a model';
      link.addEventListener('click', () => {
        void showAiSettingsModal(
          { onChange: () => { renderTranscript(); renderToggleStrip(); renderCostMeter(); renderModelPicker(); renderPromptChip(); panelStatusUpdate(); } },
          { initialTab: 'custom' },
        );
      });
      panelStatusEl.appendChild(link);
      panelStatusEl.appendChild(document.createTextNode('.'));
    } else {
      panelStatusEl.classList.add('hidden');
    }
    return;
  }
  // Hosted providers (anthropic / openai / gemini) all need a key. When the
  // active provider has none, surface a single generic CTA that opens the
  // full AI settings modal — every provider (incl. the no-key local option)
  // lives there, so we no longer push one provider over the others.
  const activeProvider = settings.toggles.provider as Exclude<Provider, 'local'>;
  void getKey(activeProvider).then(key => {
    if (!panelStatusEl) return;
    if (!key) {
      panelStatusEl.classList.remove('hidden', 'text-emerald-400');
      panelStatusEl.classList.add('text-amber-400');
      panelStatusEl.replaceChildren();
      panelStatusEl.appendChild(document.createTextNode('Not connected. '));
      const link = document.createElement('button');
      link.className = 'underline text-amber-200 hover:text-amber-100';
      link.textContent = 'Connect an AI agent';
      link.addEventListener('click', () => {
        void showAiSettingsModal({ onChange: () => { renderTranscript(); renderToggleStrip(); renderCostMeter(); renderModelPicker(); renderPromptChip(); panelStatusUpdate(); } });
      });
      panelStatusEl.appendChild(link);
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

/** Download the current conversation as a Markdown transcript. In-memory
 *  history is already the authoritative, seq-ordered view, so no DB read. */
function exportCurrentChat(): void {
  if (state.history.length === 0) {
    setTransientStatus('Nothing to export — the chat is empty.');
    return;
  }
  const sessionName = state.sessionId === GLOBAL_CHAT_BUCKET ? null : (getState().session?.name ?? null);
  exportChatMarkdown(state.history, sessionName);
  setTransientStatus('Chat exported as Markdown.');
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
  state.pendingPlanApproval = null;
  renderPlanApprovalBar();
  broadcastChatChanged();
  renderTranscript();
  renderCostMeter();
  setTransientStatus('Chat cleared.');
}

function formatDuration(ms: number): string {
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

function renderPlanApprovalBar(): void {
  if (!planApprovalBarEl) return;
  if (!state.pendingPlanApproval || state.inFlight) {
    planApprovalBarEl.classList.add('hidden');
    return;
  }
  planApprovalBarEl.classList.remove('hidden');
  planApprovalBarEl.replaceChildren();

  const label = document.createElement('span');
  label.className = 'text-[11px] text-amber-200 flex-1';
  label.textContent = '📋 Plan mode — type to refine, or approve/reject.';
  planApprovalBarEl.appendChild(label);

  const approveBtn = document.createElement('button');
  approveBtn.className = 'shrink-0 px-2 py-1 rounded text-[11px] font-medium bg-blue-600 hover:bg-blue-500 text-white';
  approveBtn.textContent = '✓ Approve';
  approveBtn.title = 'Approve this plan and start building.';
  approveBtn.addEventListener('click', () => { void approvePlan(); });
  planApprovalBarEl.appendChild(approveBtn);

  const rejectBtn = document.createElement('button');
  rejectBtn.className = 'shrink-0 px-2 py-1 rounded text-[11px] text-zinc-300 bg-zinc-700 hover:bg-zinc-600';
  rejectBtn.textContent = '✗ Reject';
  rejectBtn.title = 'Reject this plan and edit your request.';
  rejectBtn.addEventListener('click', () => { void rejectPlan(); });
  planApprovalBarEl.appendChild(rejectBtn);
}

async function approvePlan(): Promise<void> {
  if (!state.pendingPlanApproval) return;
  state.pendingPlanApproval = null;
  renderPlanApprovalBar();

  const settings = loadSettings();
  const apiKey = await preflightTurn(settings, () => { void approvePlan(); });
  if (apiKey === PREFLIGHT_ABORT) return;

  state.rewindStack = [];
  progressState.retryCount = 0;
  stalledByWatchdog = false;
  pinTranscriptToBottom();
  await runTurnWithStallRetry(apiKey, settings.toggles, [
    { type: 'text', text: 'Plan approved. Please proceed.' },
  ]);
}

async function rejectPlan(): Promise<void> {
  if (!state.pendingPlanApproval) return;
  const { originalText, originalImages, historyLengthBefore } = state.pendingPlanApproval;

  const msgsToRemove = state.history.slice(historyLengthBefore);
  if (msgsToRemove.length > 0) {
    await deleteMessages(msgsToRemove.map(m => m.id));
    state.history = state.history.slice(0, historyLengthBefore);
  }

  state.pendingPlanApproval = null;

  if (inputEl) {
    inputEl.value = originalText;
    inputEl.dispatchEvent(new Event('input'));
    inputEl.focus();
  }
  state.pendingImages = [...originalImages];
  renderPendingImages();
  renderPlanApprovalBar();
  renderTranscript();
  updateRewindButtons();
}

// === Transcript rendering ===

/** Empty-state shown when a chat has no messages yet. Beyond the one-line
 *  hint, it surfaces a few tappable starter-prompt chips (and a link to the
 *  full prompt library) so a user who doesn't know what to ask for can get
 *  going in one click — populate, don't send. */
function renderEmptyState(): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'flex-1 flex flex-col items-center justify-center gap-3 text-center px-6';

  const hint = document.createElement('p');
  hint.className = 'text-zinc-500 text-xs';
  hint.textContent = state.sessionId === GLOBAL_CHAT_BUCKET
    ? 'Open a session and ask the AI to model something — or start with one of these:'
    : 'Ask the AI to model, modify, or describe this session — or start with one of these:';
  wrap.appendChild(hint);

  const chips = document.createElement('div');
  chips.className = 'flex flex-wrap items-center justify-center gap-1.5';
  for (const idea of starterChipIdeas(4)) {
    chips.appendChild(buildPromptChip(`${idea.emoji} ${idea.title}`, idea.title, () => {
      prefillAiInput(idea.prompt ?? '');
    }));
  }
  // "More…" opens the full prompt library.
  chips.appendChild(buildPromptChip('More ideas…', 'Browse the prompt library', () => {
    showAiPromptLibraryModal({ onSelect: (idea) => prefillAiInput(idea.prompt ?? '') });
  }));
  wrap.appendChild(chips);

  return wrap;
}

/** A small pill button used in the empty-state suggestion row. */
function buildPromptChip(label: string, title: string, onClick: () => void): HTMLButtonElement {
  const chip = document.createElement('button');
  chip.type = 'button';
  chip.className = 'px-2.5 py-1 rounded-full text-[11px] text-zinc-300 bg-zinc-800 border border-zinc-700 hover:border-zinc-500 hover:text-zinc-100 transition-colors';
  chip.textContent = label;
  chip.title = title;
  chip.addEventListener('click', onClick);
  return chip;
}

function renderTranscript(): void {
  if (!transcriptEl) return;
  // Measure before replaceChildren — clearing children clamps scrollTop, so
  // any post-clear check would mis-report the user's intent.
  const pinned = isTranscriptPinnedToBottom();
  transcriptEl.replaceChildren();
  const hasHistory = state.history.length > 0;
  const hasQueue = state.queuedBlocks.length > 0;
  if (!hasHistory && !hasQueue) {
    transcriptEl.appendChild(renderEmptyState());
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
  if (pinned) pinTranscriptToBottom();
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

  // Resumable auto-stop (iteration/spend cap, truncation, refusal, empty
  // final): an amber notice with a "Keep going" button instead of normal
  // rendering.
  if (msg.stopNotice) {
    wrap.appendChild(renderStopNotice(msg));
    return wrap;
  }

  // Auto-continue nudge: a synthetic "keep going" user turn. Render a subtle
  // centered divider instead of a normal blue user bubble so it doesn't read
  // as something the human typed.
  if (msg.autoResumeNudge) {
    wrap.className = 'flex flex-col items-center gap-1';
    wrap.appendChild(renderAutoResumeDivider());
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
    } else if (b.type === 'thinking') {
      if (b.text.trim().length > 0) wrap.appendChild(renderThinkingBox(b.text));
    } else if (b.type === 'review') {
      wrap.appendChild(renderReviewBubble(b.provider, b.model, b.text));
    }
  }

  if (msg.role === 'assistant' && msg.toolCalls && msg.toolCalls.length > 0) {
    for (const tc of msg.toolCalls) {
      wrap.appendChild(renderToolCallChip(tc.name, tc.input));
    }
  }

  if (msg.role === 'assistant' && (msg.costUsd !== undefined || msg.durationMs !== undefined)) {
    const meta = document.createElement('div');
    meta.className = 'text-[10px] text-zinc-600';
    const parts: string[] = [];
    if (msg.costUsd !== undefined) parts.push(formatUsd(msg.costUsd));
    if (msg.usage) parts.push(`${msg.usage.outputTokens}t out`);
    if (msg.durationMs !== undefined) {
      parts.push(formatDuration(msg.durationMs));
      if (msg.turnElapsedMs !== undefined && msg.turnElapsedMs > msg.durationMs) {
        parts.push(`Σ${formatDuration(msg.turnElapsedMs)}`);
      }
    }
    meta.textContent = parts.join(' · ');
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

/** Rendered for turns that auto-stopped early but can be picked back up — the
 *  iteration cap, the session spend cap, a max_tokens truncation, a refusal,
 *  or an empty final. Visually distinct (amber) from the red error bubble, and
 *  offers a one-click "Keep going" that resumes the loop from where it left
 *  off rather than re-sending the original prompt. */
function renderStopNotice(msg: ChatMessage): HTMLElement {
  const notice = msg.stopNotice!;
  const card = document.createElement('div');
  card.className = 'max-w-[95%] rounded border border-amber-700/60 bg-amber-900/15 px-3 py-2 flex flex-col gap-2';

  const head = document.createElement('div');
  head.className = 'flex items-center gap-1.5 text-xs font-medium text-amber-200';
  const icon = document.createElement('span');
  icon.textContent = '⏸';
  const title = document.createElement('span');
  title.textContent = stopNoticeTitle(notice);
  head.append(icon, title);
  card.appendChild(head);

  const body = document.createElement('div');
  body.className = 'text-[12px] text-amber-100/90 whitespace-pre-wrap leading-snug';
  body.textContent = stopNoticeBody(notice);
  card.appendChild(body);

  const actions = document.createElement('div');
  actions.className = 'flex items-center gap-2 pt-1';

  // A spend-cap stop is only resumable with more budget, so its button bumps
  // the cap one tier (the click is the explicit OK to spend more). Every other
  // stop just continues the loop.
  const isSpend = notice.reason === 'spend_cap';
  const curSpend = loadSettings().toggles.maxSpend;
  const bumpedSpend = isSpend ? nextSpendTier(curSpend) : curSpend;
  const canRaise = isSpend && bumpedSpend !== curSpend;

  const resumeBtn = document.createElement('button');
  resumeBtn.className = 'px-2 py-1 rounded text-[11px] text-zinc-100 bg-zinc-700 hover:bg-zinc-600 border border-zinc-600';
  resumeBtn.textContent = canRaise
    ? `↻ Raise cap to ${spendTierLabel(bumpedSpend)} & keep going`
    : '↻ Keep going';
  resumeBtn.title = 'Continue the agent loop from where it stopped — no need to retype your request.';
  resumeBtn.addEventListener('click', () => { void resumeFromNotice(msg.id, canRaise); });
  actions.appendChild(resumeBtn);

  const dismissBtn = document.createElement('button');
  dismissBtn.className = 'px-2 py-1 rounded text-[11px] text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800';
  dismissBtn.textContent = 'Dismiss';
  dismissBtn.title = 'Hide this notice (it\'s not stored anyway).';
  dismissBtn.addEventListener('click', () => {
    state.history = state.history.filter(m => m.id !== msg.id);
    renderTranscript();
  });
  actions.appendChild(dismissBtn);

  card.appendChild(actions);
  return card;
}

function stopNoticeTitle(notice: NonNullable<ChatMessage['stopNotice']>): string {
  switch (notice.reason) {
    case 'iteration_cap': return `Stopped at the ${notice.iterations}-iteration cap`;
    case 'spend_cap': return 'Stopped at the session spend cap';
    case 'max_tokens': return 'Response was cut off';
    case 'refusal': return 'The model declined';
    case 'empty_final': return 'Stopped without a final message';
    default: return 'Stopped early';
  }
}

function stopNoticeBody(notice: NonNullable<ChatMessage['stopNotice']>): string {
  switch (notice.reason) {
    case 'iteration_cap':
      return `The agent used all ${notice.iterations} tool round-trips allowed per turn and was still working. Keep going to grant another batch, or raise the ⟲ iteration cap in the toggle strip for longer autonomous runs.`;
    case 'spend_cap':
      return `This session reached its ${notice.detail ?? 'spend'} budget. Raise the cap and keep going, or pick a higher $ cap in the toggle strip.`;
    case 'max_tokens':
      return 'The model hit its output-token limit before finishing this step. Keep going to let it continue from where it left off.';
    case 'refusal':
      return 'The model declined to continue this turn. Keep going to try again, or rephrase your request.';
    case 'empty_final':
      return 'The model ended the turn without a final message. Keep going to nudge it to continue.';
    default:
      return `The turn ended early${notice.detail ? ` (${notice.detail})` : ''}. Keep going to continue.`;
  }
}

/** Next tier up in the spend-cap ladder (clamped at the top). */
function nextSpendTier(cur: ChatToggles['maxSpend']): ChatToggles['maxSpend'] {
  const ids = MAX_SPEND_OPTIONS.map(o => o.id);
  const i = ids.indexOf(cur);
  return i >= 0 && i < ids.length - 1 ? ids[i + 1] : cur;
}

function spendTierLabel(id: ChatToggles['maxSpend']): string {
  return MAX_SPEND_OPTIONS.find(o => o.id === id)?.label ?? '';
}

/** Continue an auto-stopped turn from the existing history — no new user
 *  prompt. Mirrors sendMessage's pre-flight, then runs a turn with empty
 *  userBlocks: every provider's request builder drops the empty trailing
 *  user message, so the model resumes from the last real turn (its tool
 *  results or its own last message). The per-turn iteration budget resets,
 *  so an iteration-cap stop gets a fresh batch of round-trips. */
async function resumeFromNotice(noticeMsgId: string, raiseSpendCap: boolean): Promise<void> {
  if (state.inFlight) {
    setTransientStatus('Wait for the current turn to finish before resuming.');
    return;
  }
  if (!writeOwner) return;
  if (raiseSpendCap) {
    const cur = loadSettings().toggles.maxSpend;
    const next = nextSpendTier(cur);
    if (next !== cur) {
      applyToggleChange({ maxSpend: next });
      renderToggleStrip();
      renderCostMeter();
    }
  }

  const settings = loadSettings();
  // Honor the (possibly just-raised) session spend cap before spending more.
  const sessionCap = SPEND_CAP_USD[settings.toggles.maxSpend];
  if (Number.isFinite(sessionCap) && totalCost(state.history) >= sessionCap) {
    setTransientStatus(`Session has spent ${formatUsd(totalCost(state.history))} — at or over the ${formatUsd(sessionCap)} cap. Raise the $ cap to continue.`);
    return;
  }

  const apiKey = await preflightTurn(settings, () => { void resumeFromNotice(noticeMsgId, false); });
  if (apiKey === PREFLIGHT_ABORT) return;

  // Drop the notice card now that we're actually resuming.
  state.history = state.history.filter(m => m.id !== noticeMsgId);
  renderTranscript();
  progressState.retryCount = 0;
  stalledByWatchdog = false;
  await runTurnWithStallRetry(apiKey, settings.toggles, []);
}

/** Subtle centered divider for an auto-continue nudge (the synthetic "keep
 *  going" turn injected when the model stopped without calling `finish`). */
function renderAutoResumeDivider(): HTMLElement {
  const el = document.createElement('div');
  el.className = 'text-[10px] text-zinc-500 italic flex items-center gap-1.5 py-0.5 select-none';
  el.title = 'Auto-continue is on: the model ended its turn without calling the finish tool, so the agent resumed it automatically.';
  const icon = document.createElement('span');
  icon.textContent = '↻';
  el.appendChild(icon);
  const label = document.createElement('span');
  label.textContent = 'auto-continued (model didn\'t call finish)';
  el.appendChild(label);
  return el;
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

/** Distinct purple-bordered bubble so the user (and any agent reading the
 *  panel later) sees this came from a SECOND model via the Review
 *  feature, not the active one. */
function renderReviewBubble(provider: Provider, model: string, text: string): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'max-w-[90%] rounded-lg border border-purple-700/60 bg-purple-900/15 overflow-hidden';
  const header = document.createElement('div');
  header.className = 'px-3 py-1 text-[10px] uppercase tracking-wider text-purple-300 bg-purple-900/30 border-b border-purple-800/40 flex items-center gap-1.5';
  const icon = document.createElement('span');
  icon.textContent = '👁';
  const headerText = document.createElement('span');
  headerText.textContent = `Review by ${providerLabel(provider)} · ${model}`;
  header.appendChild(icon);
  header.appendChild(headerText);
  wrap.appendChild(header);
  const body = document.createElement('div');
  body.className = 'px-3 py-2 text-sm text-zinc-100 whitespace-pre-wrap leading-snug';
  body.textContent = text;
  wrap.appendChild(body);
  return wrap;
}

async function launchReview(): Promise<void> {
  if (state.inFlight) {
    setTransientStatus('Wait for the current turn to finish before asking for a review.');
    return;
  }
  const activeProvider = loadSettings().toggles.provider;
  showAiReviewModal({
    activeProvider,
    sessionId: state.sessionId,
    onReviewPosted: (msg) => {
      state.history.push(msg);
      renderTranscript();
      renderCostMeter();
      setTransientStatus('Review posted to the chat.');
    },
  });
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

/** Persisted reasoning, rendered as a collapsed expand/contract box (same
 *  affordance as tool-call chips) so a verbose chain of thought doesn't
 *  bury the actual reply. Indigo-tinted to read apart from tool chips. */
function renderThinkingBox(text: string): HTMLElement {
  const chip = document.createElement('details');
  chip.className = 'max-w-[90%] text-[11px] rounded border border-indigo-800/50 bg-indigo-950/20 px-2 py-1';
  const summary = document.createElement('summary');
  summary.className = 'cursor-pointer text-indigo-300/90 select-none';
  summary.textContent = '🧠 Thinking';
  chip.appendChild(summary);
  const pre = document.createElement('pre');
  pre.className = 'mt-1 text-[10px] text-zinc-400 italic overflow-x-auto whitespace-pre-wrap leading-snug';
  pre.textContent = text;
  chip.appendChild(pre);
  return chip;
}

/** Open box used while reasoning streams: a capped-height scrolling preview
 *  so the user sees thought arrive live. `collapseLiveThinking` turns it
 *  into the quiet collapsed form once the next step (answer/tool) begins. */
function renderLiveThinkingBox(): HTMLElement {
  const chip = document.createElement('details');
  chip.open = true;
  chip.dataset.liveThinking = '1';
  chip.className = 'max-w-[90%] text-[11px] rounded border border-indigo-800/50 bg-indigo-950/20 px-2 py-1';
  const summary = document.createElement('summary');
  summary.className = 'cursor-pointer text-indigo-300/90 select-none flex items-center gap-1.5';
  const dot = document.createElement('span');
  dot.className = 'inline-block w-1.5 h-1.5 rounded-full bg-indigo-400 animate-pulse';
  const label = document.createElement('span');
  label.textContent = '🧠 thinking…';
  summary.appendChild(dot);
  summary.appendChild(label);
  chip.appendChild(summary);
  const pre = document.createElement('pre');
  pre.dataset.thinkingBody = '1';
  pre.className = 'mt-1 max-h-32 overflow-y-auto text-[10px] text-zinc-400 italic whitespace-pre-wrap leading-snug';
  chip.appendChild(pre);
  return chip;
}

function collapseLiveThinking(el: HTMLElement): void {
  if (!el.dataset.liveThinking) return;
  delete el.dataset.liveThinking;
  (el as HTMLDetailsElement).open = false;
  const summary = el.querySelector('summary');
  if (summary) {
    summary.className = 'cursor-pointer text-indigo-300/90 select-none';
    summary.textContent = '🧠 Thinking';
  }
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
  // Relay newly-queued blocks into the Worker so its drain hook picks them
  // up at the next tool-round boundary without waiting for end-of-turn.
  if (state.inFlight) pushQueuedBlocks(blocks);
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

/** Returned by preflightTurn when the turn must not proceed — a key/model
 *  modal was opened (and will re-fire via onReady), or navigation failed. */
const PREFLIGHT_ABORT = Symbol('preflight-abort');

/** Shared pre-flight for any turn we're about to run: resolve the provider's
 *  API key (opening the key modal if missing), ensure the local model is
 *  loaded, and make sure we're on /editor so the AI's tools have a live
 *  window.partwright. Returns the apiKey (undefined for local), or
 *  PREFLIGHT_ABORT if the caller should bail. `onReady` is invoked from a
 *  modal's success callback so the caller can retry once the user finishes. */
async function preflightTurn(
  settings: AiSettings,
  onReady: () => void,
): Promise<string | undefined | typeof PREFLIGHT_ABORT> {
  let apiKey: string | undefined;
  if (settings.toggles.provider === 'custom') {
    // Custom OpenAI-compatible endpoint: needs a base URL + model; the API
    // key is OPTIONAL (a stored one is used when present, else no auth). Send
    // the user to the Custom settings tab if it isn't configured yet.
    if (!settings.toggles.customBaseUrl.trim() || !settings.toggles.customModel.trim()) {
      void showAiSettingsModal(
        { onChange: () => { panelStatusUpdate(); renderModelPicker(); renderToggleStrip(); renderCostMeter(); onReady(); } },
        { initialTab: 'custom' },
      );
      return PREFLIGHT_ABORT;
    }
    apiKey = (await getKey('custom'))?.apiKey;
  } else if (settings.toggles.provider !== 'local') {
    // Hosted cloud provider (anthropic / openai / gemini): need a stored key.
    const provider = settings.toggles.provider;
    const key = await getKey(provider);
    if (!key) {
      void showAiKeyModal({ provider, onConnected: () => { panelStatusUpdate(); onReady(); } });
      return PREFLIGHT_ABORT;
    }
    apiKey = key.apiKey;
  } else {
    if (!settings.toggles.localModel) {
      void showAiLocalModal({ onChange: () => { panelStatusUpdate(); renderModelPicker(); renderToggleStrip(); renderCostMeter(); onReady(); } });
      return PREFLIGHT_ABORT;
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
        return PREFLIGHT_ABORT;
      }
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
      return PREFLIGHT_ABORT;
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
  return apiKey;
}

// === Slash commands ===
//
// A bare "/command" typed in the input runs a panel action instead of being
// sent to the model. Each command mirrors a header button, giving the whole
// chat-management surface a keyboard path. The command names live in the pure
// `slashCommands` module; this map binds each to its handler and is type-
// checked against `SlashCommandName`, so adding a name there without a handler
// here (or vice versa) is a compile error.
const SLASH_HANDLERS: Record<SlashCommandName, () => void> = {
  compact: () => { void runCompact(); },
  clear: () => { void clearCurrentChat(); },
  review: () => { void launchReview(); },
  export: () => { exportCurrentChat(); },
  models: () => { void showAiSettingsModal({ onChange: afterAiSettingsChange }); },
  help: () => { openSlashHelp(); },
};

/** Interpret the current input as a slash command. Returns true when it was a
 *  slash-command invocation — known commands run, unknown ones surface a hint
 *  — so the caller skips the normal send/queue path. Returns false for any
 *  ordinary message (which then sends as usual). */
function maybeRunSlashCommand(): boolean {
  if (!inputEl) return false;
  const parsed = parseSlashCommand(inputEl.value);
  if (!parsed) return false;
  if (parsed.name) {
    runSlashCommand(parsed.name);
  } else {
    hideSlashMenu();
    setTransientStatus(`Unknown command /${parsed.token} — type /help to list commands.`);
  }
  return true;
}

/** Run a resolved command: dismiss the menu, clear the input, dispatch. */
function runSlashCommand(name: SlashCommandName): void {
  hideSlashMenu();
  if (inputEl) inputEl.value = '';
  SLASH_HANDLERS[name]();
}

function isSlashMenuOpen(): boolean {
  return !!slashMenuEl && !slashMenuEl.classList.contains('hidden') && slashMenuItems.length > 0;
}

/** Re-filter the menu against the current input and show or hide it. Called on
 *  every input event: shows while the user is mid-"/command", hides once a
 *  space is typed or the leading slash is gone. */
function updateSlashMenu(): void {
  if (!inputEl) return;
  const prefix = slashMenuPrefix(inputEl.value);
  if (prefix === null) { hideSlashMenu(); return; }
  showSlashMenu(prefix);
}

/** Open the menu showing every command — the /help action. */
function openSlashHelp(): void {
  showSlashMenu('');
  inputEl?.focus();
}

function showSlashMenu(prefix: string): void {
  slashMenuItems = matchSlashCommands(prefix);
  slashMenuIndex = 0;
  // Re-filtering resets the highlight, so any prior explicit selection is
  // stale — require fresh confirmation before Enter runs anything.
  slashMenuUserSelected = false;
  renderSlashMenu();
}

function hideSlashMenu(): void {
  slashMenuItems = [];
  slashMenuIndex = 0;
  slashMenuUserSelected = false;
  if (slashMenuEl) {
    slashMenuEl.replaceChildren();
    slashMenuEl.classList.add('hidden');
  }
}

function moveSlashSelection(delta: number): void {
  if (slashMenuItems.length === 0) return;
  slashMenuIndex = (slashMenuIndex + delta + slashMenuItems.length) % slashMenuItems.length;
  slashMenuUserSelected = true;
  renderSlashMenu();
}

/** Whether an Enter press should run the highlighted command: true once the
 *  user has explicitly arrowed to a choice, or the filter has narrowed to a
 *  single command (typing the full name, or a unique prefix). Guards against a
 *  stray Enter on an ambiguous menu firing the first command. */
function slashSelectionConfirmed(): boolean {
  return slashMenuUserSelected || slashMenuItems.length === 1;
}

/** Tab-complete the highlighted command into the input, then re-filter so the
 *  menu narrows to the now-exact token. */
function completeSlashSelection(): void {
  const cmd = slashMenuItems[slashMenuIndex];
  if (!cmd || !inputEl) return;
  inputEl.value = `/${cmd.name}`;
  updateSlashMenu();
}

function renderSlashMenu(): void {
  if (!slashMenuEl) return;
  if (slashMenuItems.length === 0) { hideSlashMenu(); return; }
  slashMenuEl.replaceChildren();

  const header = document.createElement('div');
  header.className = 'px-2 py-1 text-[10px] uppercase tracking-wide text-zinc-500 border-b border-zinc-700/60 sticky top-0 bg-zinc-800/95';
  header.textContent = 'Slash commands';
  slashMenuEl.appendChild(header);

  slashMenuItems.forEach((cmd, i) => {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = `w-full text-left px-2 py-1.5 flex flex-col gap-0.5 ${i === slashMenuIndex ? 'bg-zinc-700' : 'hover:bg-zinc-700/50'}`;
    const nameEl = document.createElement('span');
    nameEl.className = 'text-[12px] font-medium text-blue-300';
    nameEl.textContent = `/${cmd.name}`;
    const sumEl = document.createElement('span');
    sumEl.className = 'text-[10px] text-zinc-400';
    sumEl.textContent = cmd.summary;
    row.append(nameEl, sumEl);
    // Keep focus in the textarea so the click handler can clear it and the
    // blur-hide never races the click.
    row.addEventListener('mousedown', e => e.preventDefault());
    row.addEventListener('click', () => { runSlashCommand(cmd.name as SlashCommandName); });
    slashMenuEl!.appendChild(row);
  });

  slashMenuEl.classList.remove('hidden');
  positionSlashMenu();
}

/** Anchor the floating menu just above the input, matching its width. Uses
 *  the textarea's viewport rect with `position: fixed`, so the overlay never
 *  reflows the input and isn't clipped by the bottom section. */
function positionSlashMenu(): void {
  if (!slashMenuEl || !inputEl) return;
  const r = inputEl.getBoundingClientRect();
  slashMenuEl.style.left = `${Math.round(r.left)}px`;
  slashMenuEl.style.width = `${Math.round(r.width)}px`;
  // Pin the menu's bottom edge 6px above the input's top; it grows upward.
  slashMenuEl.style.bottom = `${Math.round(window.innerHeight - r.top + 6)}px`;
  slashMenuEl.style.top = 'auto';
}

async function sendMessage(): Promise<void> {
  if (state.inFlight) return;
  // Another tab is the leader for this session — don't run a second chat loop
  // against the same transcript. The viewer overlay offers "Take control".
  if (!writeOwner) return;
  if (!inputEl) return;
  const text = inputEl.value.trim();
  if (text.length === 0 && state.pendingImages.length === 0) return;

  const settings = loadSettings();

  // Session spend gate. The dropdown is a session-total budget, so block
  // a new turn once historical spend has reached it. The user has to
  // raise the cap (or pick ∞) to keep going — otherwise the dropdown
  // would be advisory only and continued prompting would silently sail
  // past the chosen budget.
  const sessionCap = SPEND_CAP_USD[settings.toggles.maxSpend];
  if (Number.isFinite(sessionCap)) {
    const sessionTotal = totalCost(state.history);
    if (sessionTotal >= sessionCap) {
      setTransientStatus(`Session has spent ${formatUsd(sessionTotal)} — at or over the ${formatUsd(sessionCap)} cap. Raise the $ cap in the toggle strip to continue.`);
      return;
    }
  }

  const apiKey = await preflightTurn(settings, () => { void sendMessage(); });
  if (apiKey === PREFLIGHT_ABORT) return;

  // Capture content before clearing the input so plan mode can restore it on reject.
  const capturedText = text;
  const capturedImages = [...state.pendingImages];

  const blocks: ChatBlock[] = [];
  if (capturedText.length > 0) blocks.push({ type: 'text', text: capturedText });
  // Only attach images the user added if vision is on. Iso views are
  // user-initiated via Show AI; pending images get sent regardless because
  // the user's intent is explicit when they attached them.
  for (const img of capturedImages) blocks.push({ type: 'image', source: img });

  inputEl.value = '';
  state.pendingImages = [];
  renderPendingImages();
  // Sending a new message commits to this branch of the conversation —
  // any rewound turns can no longer be re-applied.
  state.rewindStack = [];
  progressState.retryCount = 0;
  stalledByWatchdog = false;
  // Hitting send is an explicit "follow the new turn" gesture — re-pin to
  // bottom so the user's own bubble and the streamed reply are visible even
  // if they had been scrolled up reading earlier history.
  pinTranscriptToBottom();

  if (settings.toggles.planFirst || state.pendingPlanApproval) {
    // Plan-first mode or an in-flight plan refinement: keep tools off so the
    // model can't execute anything until the user approves. If this is a
    // follow-up (pendingPlanApproval is already set), the user is replying to
    // a clarifying question or asking the model to revise — just send the
    // message as-is; the planning prefix is only for the very first turn.
    const planToggles: ChatToggles = {
      ...settings.toggles,
      scope: { runCode: false, saveVersions: false, paintFaces: false, sessionNotes: false },
      autoResume: false,
    };

    let planBlocks: ChatBlock[];
    if (state.pendingPlanApproval) {
      // Refinement turn: plain user message, no prefix. historyLengthBefore
      // stays fixed so Reject still removes all planning messages.
      // Refinement: remind the model it is still in plan mode so it doesn't
      // switch to execution mode when it receives the information it asked for.
      const refinePrefix = '[Plan refinement — revise or extend the plan only, do not call any tools or start building]: ';
      planBlocks = [];
      if (capturedText.length > 0) planBlocks.push({ type: 'text', text: refinePrefix + capturedText });
      for (const img of capturedImages) planBlocks.push({ type: 'image', source: img });
    } else {
      // First planning turn: prefix with the planning instruction.
      const planPrefix =
        'Before doing anything, write a concise plan for the following request. '
        + 'Describe your approach, key steps, and any design decisions. '
        + 'Do NOT call any tools or start building yet — I will approve or reject your plan first.\n\n'
        + '---\n\n';
      planBlocks = [];
      if (capturedText.length > 0) planBlocks.push({ type: 'text', text: planPrefix + capturedText });
      for (const img of capturedImages) planBlocks.push({ type: 'image', source: img });
      state.pendingPlanApproval = {
        originalText: capturedText,
        originalImages: capturedImages,
        historyLengthBefore: state.history.length,
      };
    }

    await runTurnWithStallRetry(apiKey, planToggles, planBlocks);
    renderPlanApprovalBar();
    return;
  }

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

/** Route a turn to the right executor.
 *
 *  Hosted providers (anthropic / openai / gemini) run in the Agent Worker so
 *  their HTTP streams keep flowing when the tab is backgrounded.
 *
 *  The local (WebLLM) provider MUST run on the main thread. Its engine is
 *  loaded into the main thread's `local.ts` module state by ensureModelLoaded
 *  (driven by this panel and the local-model modal). The Worker has its own
 *  module instance whose `loaded` engine is always null, so a worker-side
 *  streamLocalTurn throws "Local model … is not loaded" even when the weights
 *  are cached and the model is resident in GPU on the main thread. Running the
 *  loop here reunites streamLocalTurn (and interruptLocal) with that engine. */
/** Show a blocking overlay asking the user to allow or decline an AI-initiated
 *  import. Resolves true (allow) or false (decline). */
function showToolConfirmation(toolName: string): Promise<boolean> {
  return new Promise(resolve => {
    const label = toolName === 'importImageAsRelief'
      ? 'import an image as a 3D relief'
      : toolName === 'importSvgAsRelief'
      ? 'import an SVG as a 3D relief tile'
      : `run "${toolName}"`;

    const overlay = document.createElement('div');
    overlay.className = 'fixed inset-0 z-50 flex items-center justify-center bg-black/60';

    const card = document.createElement('div');
    card.className = 'bg-zinc-800 rounded-lg p-5 max-w-sm mx-4 shadow-xl border border-zinc-600';

    const msg = document.createElement('p');
    msg.className = 'text-sm text-zinc-200 mb-4';
    msg.textContent = `The AI wants to ${label}. Allow this?`;

    const btns = document.createElement('div');
    btns.className = 'flex gap-2 justify-end';

    const declineBtn = document.createElement('button');
    declineBtn.className = 'px-3 py-1.5 text-sm rounded bg-zinc-700 hover:bg-zinc-600 text-zinc-200 transition-colors';
    declineBtn.textContent = 'Decline';

    const allowBtn = document.createElement('button');
    allowBtn.className = 'px-3 py-1.5 text-sm rounded bg-blue-600 hover:bg-blue-500 text-white transition-colors';
    allowBtn.textContent = 'Allow';

    btns.appendChild(declineBtn);
    btns.appendChild(allowBtn);
    card.appendChild(msg);
    card.appendChild(btns);
    overlay.appendChild(card);
    document.body.appendChild(overlay);

    const done = (allowed: boolean) => {
      overlay.remove();
      resolve(allowed);
    };
    allowBtn.addEventListener('click', () => done(true));
    declineBtn.addEventListener('click', () => done(false));
  });
}

function runTurn(input: RunTurnInput, callbacks?: RunTurnCallbacks): Promise<ChatMessage[]> {
  return input.toggles.provider === 'local'
    ? runTurnOnMainThread(input, callbacks)
    : runTurnInWorker(input, callbacks);
}

async function runTurnWithStallRetry(apiKey: string | undefined, toggles: ChatToggles, userBlocks: ChatBlock[]): Promise<void> {
  let attempt = 0;
  let lastTurnOutcome: TurnOutcome | null = null;
  // Bucket the conversation lives in as this turn begins. If the model creates
  // a session mid-turn the active bucket changes out from under us, so we
  // remember the starting bucket and re-home the chat once the turn settles.
  let turnStartBucket = state.sessionId;
  // NOTE: don't record the session's AI preference here. On turn start the
  // active model may be a *fallback* (the session's remembered model was
  // unavailable), and recording it would erase the real preference instead of
  // letting it snap back. The preference is recorded only on a deliberate model
  // / provider pick (the picker + settings/local modals below).
  while (true) {
    attempt++;
    const controller = new AbortController();
    state.inFlight = true;
    state.inFlightController = controller;
    setSendButtonMode('inflight');
    showProgress('thinking', 'starting…');

    let activeAssistantId: string | null = null;
    let liveTextEl: HTMLElement | null = null;
    let liveThinkingEl: HTMLElement | null = null;
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
        upsertHistoryMessage(msg);
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
        liveThinkingEl = null;
        if (transcriptEl) {
          liveTextEl = transcriptEl.querySelector(`[data-live-bubble="${id}"]`) as HTMLElement | null;
          if (liveTextEl) liveTextEl.textContent = '';
        }
      },
      onAssistantText: delta => {
        if (liveTextEl) {
          const pinned = isTranscriptPinnedToBottom();
          liveTextEl.textContent = (liveTextEl.textContent ?? '') + delta;
          if (pinned) pinTranscriptToBottom();
        }
      },
      onAssistantThinking: delta => {
        const pinned = isTranscriptPinnedToBottom();
        if (!liveThinkingEl) {
          const wrapEl = (liveTextEl?.parentElement
            ?? transcriptEl?.querySelector(`[data-message-id="${activeAssistantId}"]`)) as HTMLElement | null;
          if (!wrapEl) return;
          liveThinkingEl = renderLiveThinkingBox();
          // Thinking sits above the answer bubble in the same message wrap.
          if (liveTextEl && liveTextEl.parentElement === wrapEl) wrapEl.insertBefore(liveThinkingEl, liveTextEl);
          else wrapEl.insertBefore(liveThinkingEl, wrapEl.firstChild);
        }
        const body = liveThinkingEl.querySelector('[data-thinking-body]') as HTMLElement | null;
        if (body) {
          body.textContent = (body.textContent ?? '') + delta;
          // The thinking box's inner <pre> (max-h-32) is its own scroll
          // container — keep it pinned so the latest reasoning tokens stay
          // visible inside the bubble itself.
          body.scrollTop = body.scrollHeight;
        }
        if (pinned) pinTranscriptToBottom();
      },
      onProgress: info => {
        // The next step has begun — fold the live thinking preview into its
        // quiet collapsed form (the user's "hide it once the next task
        // happens"). Persisted render at iteration end finalizes it.
        if (liveThinkingEl && (info.phase === 'streaming' || info.phase === 'tool')) {
          collapseLiveThinking(liveThinkingEl);
        }
        showProgress(info.phase, info.detail);
      },
      onAssistantPersisted: msg => {
        const idx = state.history.findIndex(m => m.id === activeAssistantId);
        if (idx >= 0) state.history[idx] = msg;
        activeAssistantId = null;
        liveTextEl = null;
        liveThinkingEl = null;
        renderTranscript();
        renderCostMeter();
      },
      confirmTool: (toolName) => showToolConfirmation(toolName),
      onToolResult: (_id, _name, result) => {
        if (result.isError) setTransientStatus('A tool errored. The agent will retry or surface the issue.');
      },
      onToolResultsPersisted: msg => {
        // Surface tool result bubbles — including renderView / renderViews
        // snapshots — in the live transcript as the agent works. The
        // tool_result user message is persisted by chatLoop but isn't pushed
        // through onUserPersisted, so without this it would only appear after
        // a session reload. renderToolResultBubble auto-expands image-bearing
        // results, so the rendering shows without the user expanding anything.
        upsertHistoryMessage(msg);
        renderTranscript();
      },
      onAutoResume: msg => {
        // Auto-continue injected a synthetic "keep going" turn — show it as a
        // subtle divider so the user can see why the agent kept going.
        upsertHistoryMessage(msg);
        renderTranscript();
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
          liveThinkingEl = null;
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
        // Auto-compaction only fires on a clean end_turn — skip it after an
        // abort, error, or any resumable auto-stop (iteration/spend cap,
        // truncation, refusal, empty final) so the user keeps full context
        // for the "Keep going" resume.
        if (info.reason === 'end_turn' && !state.history.some(m => m.errored)) {
          void maybeAutoCompact();
        }
        lastTurnOutcome = info;
      },
    });

    state.inFlight = false;
    state.inFlightController = null;
    setSendButtonMode('send');
    updateRewindButtons();

    // Bug fix — reunite a conversation split by a mid-turn session switch.
    // chatLoop stamps every message of a turn with the session active when the
    // turn began, so when the model creates or switches sessions mid-turn (via
    // createSession, or a runAndSave auto-create), the lead-up turns stay under
    // the old bucket — the global bucket OR an earlier real session — and
    // vanish from the new session on reload. Fold them forward into the session
    // the user landed on. Restricted to a fresh target (onlyIfTargetEmpty) so
    // two distinct conversations are never auto-merged.
    if (state.sessionId !== turnStartBucket) {
      const moved = await mergeChatBucket(turnStartBucket, state.sessionId, { onlyIfTargetEmpty: true });
      if (moved > 0) {
        await loadHistoryForCurrentSession();
        renderTranscript();
        renderCostMeter();
      }
      turnStartBucket = state.sessionId;
    }

    // Surface a sticky completion banner so the user knows the turn
    // actually ended and why — better than a silent hideProgress that
    // reads as "the model stalled and gave up".
    // Snapshot the outcome before the null reset below. The cast is also
    // required: lastTurnOutcome is assigned inside the runTurn callbacks,
    // which TS can't flow-narrow, so without it the read is typed `null` and
    // the resumable-stop check further down fails to compile.
    const finalOutcome = lastTurnOutcome as TurnOutcome | null;
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

    // The turn truly ended. If it auto-stopped early but is resumable (hit
    // the iteration cap, spend cap, a max_tokens truncation, a refusal, or an
    // empty final) and didn't already surface a hard error, drop a notice into
    // the transcript with a one-click "Keep going" so the user can continue
    // without retyping their request.
    if (finalOutcome && isResumableStop(finalOutcome.reason) && !state.history.some(m => m.errored)) {
      pushStopNotice(finalOutcome);
    }
    broadcastChatChanged();
    return;
  }
}

/** Stop reasons the user can pick up from with a single "Keep going". Excludes
 *  a clean end_turn (nothing to resume), an intentional user abort, and a hard
 *  error (handled by the red error bubble's "Retry last message" instead). */
function isResumableStop(reason: TurnOutcomeReason): boolean {
  return reason === 'iteration_cap'
    || reason === 'spend_cap'
    || reason === 'max_tokens'
    || reason === 'refusal'
    || reason === 'empty_final'
    || reason === 'other';
}

/** Append an in-memory (not persisted) resumable-stop notice to the transcript.
 *  Mirrors the errored-bubble pattern: a session change wipes it, but until
 *  then it gives the user a clear reason + a "Keep going" button. */
function pushStopNotice(outcome: TurnOutcome): void {
  const last = state.history[state.history.length - 1];
  const msg: ChatMessage = {
    id: generateId(),
    sessionId: state.sessionId,
    role: 'assistant',
    blocks: [],
    createdAt: Date.now(),
    seq: (last?.seq ?? 0) + 1,
    stopNotice: { reason: outcome.reason, detail: outcome.detail, iterations: outcome.iterations },
  };
  state.history.push(msg);
  renderTranscript();
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

/** Display a completion / failure status after a turn ends. The status
 *  remains visible until the next turn starts (showProgress overwrites
 *  the 'final' phase), so the user always sees the outcome of the most
 *  recent turn instead of a banner that vanishes on a timer. */
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
}

function triggerStallRetry(): void {
  const threshSec = Math.round(getStallThresholdMs() / 1000);
  if (progressState.retryCount >= MAX_STALL_RETRIES) {
    setTransientStatus(`Model stalled (no tokens for ${threshSec}s) after ${MAX_STALL_RETRIES} retries — stopping. Increase "Request timeout" in AI settings if using a slow model.`);
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
  if (settings.toggles.provider === 'custom') {
    // Optional key; skip silently if the endpoint isn't fully configured.
    if (!settings.toggles.customBaseUrl.trim() || !settings.toggles.customModel.trim()) return;
    apiKey = (await getKey('custom'))?.apiKey;
  } else if (settings.toggles.provider !== 'local') {
    const key = await getKey(settings.toggles.provider);
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
  broadcastChatChanged();
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
  if (settings.toggles.provider === 'custom') {
    // Custom endpoint: API key optional; route to the Custom tab if the
    // endpoint isn't configured yet.
    if (!settings.toggles.customBaseUrl.trim() || !settings.toggles.customModel.trim()) {
      void showAiSettingsModal({ onChange: () => panelStatusUpdate() }, { initialTab: 'custom' });
      return;
    }
    apiKey = (await getKey('custom'))?.apiKey;
    setTransientStatus('Summarizing the conversation…');
  } else if (settings.toggles.provider !== 'local') {
    const provider = settings.toggles.provider;
    const key = await getKey(provider);
    if (!key) {
      void showAiKeyModal({ provider, onConnected: () => panelStatusUpdate() });
      return;
    }
    apiKey = key.apiKey;
    setTransientStatus('Summarizing the conversation…');
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
    broadcastChatChanged();
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
