// The "Did you know?" rolling hints strip at the top of the editor.
//
// A slim, single-line ticker that rotates through HINTS (src/ui/hints/hintsData.ts),
// each with a CTA that navigates to / reveals the feature it describes. Designed
// to be the lowest-footprint discovery surface: it sits between the toolbar and
// the session bar and never steals focus.
//
// Visibility rules (matching the product decision):
//   - Shown by default. A permanent on/off lives in Advanced Settings
//     (config.ui.editorHintsEnabled) — also flipped by the `toggle-hints`
//     command in main.ts.
//   - The ✕ hides it for the current TAB/SESSION only (sessionStorage), so a
//     fresh tab shows it again. Re-enabling via settings/command clears that.
//
// The ticker mounts into a stable host element (created once in main.ts) so it
// can be torn down and rebuilt in place when toggled without disturbing layout.

import { HINTS, DEFAULT_CTA_LABEL, type Hint, type HintCta } from './hintsData';
import { runCommandById, openCommandPalette } from '../commandPalette';
import { openShortcutsOverlay } from '../shortcutsOverlay';
import { spotlightElement, dismissCoachmark } from '../coachmark';
import { getConfig, onConfigChange } from '../../config/appConfig';
import { getState } from '../../storage/sessionManager';

/** localStorage: ids the user has already been shown (rotate fresh ones first). */
const SEEN_KEY = 'partwright-hints-seen';
/** sessionStorage: set when the user ✕-dismisses for this tab. */
const HIDDEN_KEY = 'partwright-hints-hidden';

let host: HTMLElement | null = null;
let strip: HTMLElement | null = null;
let textEl: HTMLElement | null = null;
let ctaEl: HTMLButtonElement | null = null;
let rotateTimer = 0;
let order: Hint[] = [];
let idx = 0;
let paused = false;
let configUnsub: (() => void) | null = null;
let sessionUnsub: (() => void) | null = null;
let resizeObs: ResizeObserver | null = null;
/** Pending rAF handle for the resize-driven relayout (0 = none). The observer
 *  defers relayout to the next frame so its layout mutations (display toggles,
 *  reparenting, offsetWidth reads) don't re-enter the observer in the same tick
 *  — that re-entrancy is what raises "ResizeObserver loop completed with
 *  undelivered notifications". */
let resizeRaf = 0;
let desktopMqCleanup: (() => void) | null = null;
/** Re-evaluate single-vs-two-row layout for the current width + hint text.
 *  Set while a strip is mounted (closure over its elements), cleared on
 *  teardown. Called on resize, breakpoint change, and each text rotation. */
let relayoutFn: (() => void) | null = null;
/** High-water mark for the strip's height (px), reset on each fresh mount.
 *  Once the card grows — switching to the two-row layout, wrapping to more
 *  lines, a longer hint — we pin this as a min-height so it can never shrink
 *  back and shove the panes below it up and down (the "stutter" on rotation). */
let maxStripHeight = 0;
/** Last session id seen, so we only restore hints on a real session transition
 *  (new / opened / switched session) — not on intra-session changes like
 *  version navigation, which also fire 'session-changed'. */
let lastSessionId: string | null = null;

// ─── persistence helpers ──────────────────────────────────────────────────────

function readSeen(): Set<string> {
  try {
    const raw = localStorage.getItem(SEEN_KEY);
    if (raw) return new Set(JSON.parse(raw) as string[]);
  } catch { /* ignore */ }
  return new Set();
}

function markSeen(id: string): void {
  try {
    const seen = readSeen();
    if (seen.has(id)) return;
    seen.add(id);
    // Only keep ids that still exist, so the list can't grow unbounded.
    const live = HINTS.map(h => h.id);
    localStorage.setItem(SEEN_KEY, JSON.stringify([...seen].filter(id => live.includes(id))));
  } catch { /* ignore */ }
}

function isSessionHidden(): boolean {
  try { return sessionStorage.getItem(HIDDEN_KEY) === '1'; } catch { return false; }
}

function setSessionHidden(hidden: boolean): void {
  try {
    if (hidden) sessionStorage.setItem(HIDDEN_KEY, '1');
    else sessionStorage.removeItem(HIDDEN_KEY);
  } catch { /* ignore */ }
}

// ─── CTA dispatch ──────────────────────────────────────────────────────────────

function runCta(cta: HintCta): void {
  switch (cta.kind) {
    case 'open':
      if (cta.what === 'commandPalette') openCommandPalette();
      else openShortcutsOverlay();
      return;
    case 'command':
      runCommandById(cta.id);
      return;
    case 'coach': {
      // Defer past the current click: opening a popover here, then letting this
      // very click keep bubbling to document, would trip the popover's own
      // click-outside handler and close it again. A 0ms timeout runs the whole
      // sequence after the click finishes propagating.
      window.setTimeout(() => {
        for (const id of cta.prep ?? []) runCommandById(id);
        if (cta.openSelector) {
          document.querySelector<HTMLElement>(cta.openSelector)?.click();
        }
        // Let any view switch / popover open settle before we measure the target.
        requestAnimationFrame(() => {
          spotlightElement(cta.target, { text: cta.label, placement: cta.placement });
        });
      }, 0);
      return;
    }
  }
}

// ─── rotation ──────────────────────────────────────────────────────────────────

/** Fisher–Yates shuffle (in place), returning the same array. */
function shuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/** Build the rotation order: unseen hints first, then seen — but each group is
 *  shuffled, so the *first* hint shown is random (a fresh one you haven't seen
 *  yet while any remain, then any once you've seen them all) rather than always
 *  the same dataset-order hint. Rebuilt on every mount / session change. */
function buildOrder(): Hint[] {
  const seen = readSeen();
  const unseen = shuffle(HINTS.filter(h => !seen.has(h.id)));
  const rest = shuffle(HINTS.filter(h => seen.has(h.id)));
  return [...unseen, ...rest];
}

function showCurrent(): void {
  if (!textEl || !ctaEl || order.length === 0) return;
  const hint = order[idx % order.length];
  textEl.textContent = hint.text;
  ctaEl.textContent = hint.ctaLabel ?? DEFAULT_CTA_LABEL;
  ctaEl.onclick = () => runCta(hint.cta);
  markSeen(hint.id);
  // A longer/shorter hint can change whether everything still fits on one line,
  // so re-pick the single-vs-two-row layout for the new text.
  relayoutFn?.();
}

function advance(delta: number): void {
  if (order.length === 0) return;
  idx = (idx + delta + order.length) % order.length;
  showCurrent();
}

function scheduleRotate(): void {
  window.clearTimeout(rotateTimer);
  const interval = getConfig().ui.hintRotationMs;
  rotateTimer = window.setTimeout(() => {
    if (!paused) advance(1);
    scheduleRotate();
  }, interval);
}

// ─── mount / unmount ─────────────────────────────────────────────────────────

function teardownStrip(): void {
  window.clearTimeout(rotateTimer);
  rotateTimer = 0;
  resizeObs?.disconnect();
  resizeObs = null;
  if (resizeRaf) { cancelAnimationFrame(resizeRaf); resizeRaf = 0; }
  desktopMqCleanup?.();
  desktopMqCleanup = null;
  dismissCoachmark();
  if (host) host.replaceChildren();
  strip = null;
  textEl = null;
  ctaEl = null;
  relayoutFn = null;
}

/** Render the strip into the host (idempotent — rebuilds in place). */
function renderStrip(): void {
  if (!host) return;
  teardownStrip();

  order = buildOrder();
  idx = 0;
  maxStripHeight = 0;   // fresh card starts at its natural height

  // Centered, self-contained card in the toolbar's middle: a subtle bordered
  // box. It adapts between two arrangements (see relayout below):
  //   • single row (default, when there's room) — icon, "Did you know?", hint
  //     text, CTA, and the ‹ › ✕ controls all inline, as before this feature;
  //   • two rows (when horizontal space is tight) — a compact header (icon +
  //     label + CTA, controls right-aligned) with the hint text on its own line
  //     beneath, so the text never competes with the header for width.
  // The host centers it (justify-center) and stays flex-1 so it also
  // right-aligns the AI/Import/Export cluster.
  const stripEl = document.createElement('div');
  strip = stripEl;
  stripEl.id = 'editor-hints';
  stripEl.setAttribute('role', 'note');
  stripEl.setAttribute('aria-label', 'Did you know');

  // The header-row wrapper used only in the two-row arrangement.
  const topRow = document.createElement('div');
  topRow.className = 'flex items-center gap-2';

  const icon = document.createElement('span');
  icon.className = 'shrink-0 text-amber-300 flex items-center';
  icon.setAttribute('aria-hidden', 'true');
  icon.innerHTML = SPARKLES_SVG;

  const badge = document.createElement('span');
  badge.className = 'shrink-0 text-zinc-500 select-none';
  badge.textContent = 'Did you know?';

  const ctaBtn = document.createElement('button');
  ctaEl = ctaBtn;
  ctaBtn.type = 'button';
  ctaBtn.className = 'shrink-0 text-blue-400 hover:text-blue-300 hover:underline font-medium transition-colors';

  // ‹ › step + ✕ dismiss, kept inside the section, set off by a thin divider so
  // they read as the hints' own controls.
  const controls = document.createElement('div');

  const prevBtn = makeIconBtn('‹', 'Previous hint', () => advance(-1));
  const nextBtn = makeIconBtn('›', 'Next hint', () => advance(1));
  const closeBtn = makeIconBtn('✕', 'Hide hints for this session', dismissForSession);
  controls.append(prevBtn, nextBtn, closeBtn);

  const textSpan = document.createElement('span');
  textEl = textSpan;
  textSpan.id = 'editor-hints-text';

  host.appendChild(stripEl);

  // ── single-vs-two-row layout ──────────────────────────────────────────────
  const STRIP_BASE =
    'min-w-0 max-w-full pl-2.5 pr-1.5 py-1 rounded-md bg-zinc-800/60 border border-zinc-700/70 text-xs text-zinc-400';
  let layoutMode: 'single' | 'two' | null = null;

  /** Reparent + restyle into the requested arrangement (no-op if unchanged). */
  const setLayout = (mode: 'single' | 'two'): void => {
    if (layoutMode === mode) return;
    layoutMode = mode;
    if (mode === 'single') {
      stripEl.className = `${STRIP_BASE} flex flex-row items-center gap-2`;
      // One line, no wrap: if the text won't fit, relayout() switches to 'two'
      // rather than letting it wrap inside the single row.
      textSpan.className = 'min-w-0 text-zinc-300 whitespace-nowrap';
      controls.className =
        'shrink-0 flex items-center gap-0.5 pl-1.5 ml-0.5 border-l border-zinc-700/70 text-zinc-500';
      stripEl.replaceChildren(icon, badge, textSpan, ctaBtn, controls);
    } else {
      stripEl.className = `${STRIP_BASE} flex flex-col gap-0.5`;
      // On its own line the text may wrap; line-clamp-3 caps the growth so a
      // very long hint on a narrow card can't balloon the toolbar.
      textSpan.className = 'min-w-0 text-zinc-300 break-words line-clamp-3';
      controls.className =
        'shrink-0 flex items-center gap-0.5 ml-auto pl-1.5 border-l border-zinc-700/70 text-zinc-500';
      topRow.replaceChildren(icon, badge, ctaBtn, controls);
      stripEl.replaceChildren(topRow, textSpan);
    }
  };

  /** Intrinsic width the single-row arrangement needs, measured off-flow so the
   *  flex parent can't shrink it. Assumes single-row structure is applied. */
  const measureSingleNeeded = (): number => {
    const s = stripEl.style;
    const saved = { position: s.position, width: s.width, maxWidth: s.maxWidth, visibility: s.visibility };
    s.position = 'absolute';
    s.visibility = 'hidden';
    s.maxWidth = 'none';
    s.width = 'max-content';
    const needed = stripEl.offsetWidth;
    s.position = saved.position;
    s.width = saved.width;
    s.maxWidth = saved.maxWidth;
    s.visibility = saved.visibility;
    return needed;
  };

  // Degrade gracefully as the toolbar's middle shrinks (e.g. the AI panel opens
  // or on a narrow screen). On mobile the toolbar already wraps and is cramped,
  // so the discovery card isn't worth the space — hide it outright below the md
  // (768px) breakpoint. On desktop: drop the "Did you know?" badge as room
  // tightens, prefer the single-row arrangement while it fits, fall back to two
  // rows when it doesn't, and finally hide the whole card when there's genuinely
  // no room — so it never overflows into the adjacent toolbar buttons. The host
  // stays flex-1, so it keeps right-aligning the AI/Import/Export cluster even
  // when the card is hidden.
  const desktopMq = window.matchMedia('(min-width: 768px)');
  const relayout = (): void => {
    if (!strip) return;
    const w = host!.clientWidth;
    const visible = desktopMq.matches && w >= 200;
    stripEl.style.display = visible ? '' : 'none';
    if (!visible) return;
    badge.style.display = w >= 360 ? '' : 'none';
    // Try single row first; measure its intrinsic width and fall back to two
    // rows only when it would overflow the available width.
    setLayout('single');
    if (measureSingleNeeded() > w) setLayout('two');
    lockMinHeight();
  };
  relayoutFn = relayout;

  /** Pin the strip's height to its running maximum so it never shrinks back.
   *  offsetHeight already includes any min-height we've set, so the measured
   *  value is monotonic — it only ever reflects genuine growth, and a shorter
   *  hint or the single-row layout keeps the taller height instead of snapping
   *  the panes below up and down. */
  const lockMinHeight = (): void => {
    const h = stripEl.offsetHeight;
    if (h > maxStripHeight) maxStripHeight = h;
    stripEl.style.minHeight = maxStripHeight ? `${maxStripHeight}px` : '';
  };

  resizeObs?.disconnect();
  resizeObs = new ResizeObserver(() => {
    // Coalesce to one relayout per frame and run it outside the observer's
    // delivery tick, so the layout changes it makes don't trip the
    // "undelivered notifications" loop.
    if (resizeRaf) return;
    resizeRaf = requestAnimationFrame(() => {
      resizeRaf = 0;
      relayout();
    });
  });
  resizeObs.observe(host);
  // Re-evaluate on breakpoint crossings: resizing the window across 768px may
  // not shift the host's own width enough to trip the ResizeObserver.
  desktopMq.addEventListener('change', relayout);
  desktopMqCleanup = () => desktopMq.removeEventListener('change', relayout);

  // Pause rotation while the user is reading (hover) or interacting (focus).
  stripEl.addEventListener('pointerenter', () => { paused = true; });
  stripEl.addEventListener('pointerleave', () => { paused = false; });
  stripEl.addEventListener('focusin', () => { paused = true; });
  stripEl.addEventListener('focusout', () => { paused = false; });

  showCurrent();   // sets the text, then triggers relayout() via relayoutFn
  scheduleRotate();
}

// Lucide "sparkles" — a cooler stand-in for the old 💡, evoking tips/discovery.
const SPARKLES_SVG =
  '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .962 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.962 0z"/><path d="M20 3v4"/><path d="M22 5h-4"/><path d="M4 17v2"/><path d="M5 18H3"/></svg>';

/** A compact control button with a ≥44px touch target via padding. */
function makeIconBtn(glyph: string, label: string, onClick: () => void): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.textContent = glyph;
  btn.setAttribute('aria-label', label);
  btn.title = label;
  btn.className =
    'leading-none px-2 py-2 -my-1 rounded text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800 transition-colors';
  btn.addEventListener('click', onClick);
  return btn;
}

function dismissForSession(): void {
  setSessionHidden(true);
  teardownStrip();
}

/** Whether the strip should currently be visible. */
function shouldShow(): boolean {
  return getConfig().ui.editorHintsEnabled && !isSessionHidden();
}

/** Re-evaluate visibility and mount/unmount accordingly. */
function refreshHintsTicker(): void {
  if (!host) return;
  if (shouldShow()) {
    if (!strip) renderStrip();
  } else {
    teardownStrip();
  }
}

/**
 * Mount the hints ticker into a stable host element (called once from main.ts,
 * after the toolbar so the strip sits between toolbar and session bar). Wires a
 * config subscription so the Advanced Settings toggle takes effect live.
 */
export function mountHintsTicker(hostEl: HTMLElement): void {
  host = hostEl;
  configUnsub?.();
  configUnsub = onConfigChange(() => refreshHintsTicker());

  // Restore hints when the user starts or opens a *different* session — a ✕
  // dismiss means "not now, this session", so a new session brings them back.
  // Seed from the current id so the initial session load isn't seen as a
  // transition (a reload keeps a same-session dismiss in place).
  lastSessionId = getState().session?.id ?? null;
  sessionUnsub?.();
  const onSessionChanged = () => {
    const id = getState().session?.id ?? null;
    if (id && id !== lastSessionId) {
      lastSessionId = id;
      showHintsTicker();
    } else {
      lastSessionId = id;
    }
  };
  window.addEventListener('session-changed', onSessionChanged);
  sessionUnsub = () => window.removeEventListener('session-changed', onSessionChanged);

  refreshHintsTicker();
}

/**
 * Force the ticker visible: clear this tab's session-dismiss so the strip comes
 * back even if the user had ✕-ed it. Used by the `toggle-hints` command when
 * turning hints on. Returns nothing; relies on config already being enabled.
 */
export function showHintsTicker(): void {
  setSessionHidden(false);
  refreshHintsTicker();
}
