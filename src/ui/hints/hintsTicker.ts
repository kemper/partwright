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
let desktopMqCleanup: (() => void) | null = null;
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
  desktopMqCleanup?.();
  desktopMqCleanup = null;
  dismissCoachmark();
  if (host) host.replaceChildren();
  strip = null;
  textEl = null;
  ctaEl = null;
}

/** Render the strip into the host (idempotent — rebuilds in place). */
function renderStrip(): void {
  if (!host) return;
  teardownStrip();

  order = buildOrder();
  idx = 0;

  // Centered, self-contained card in the toolbar's middle: a subtle bordered
  // box stacked into two rows. The top row is the compact header — icon,
  // "Did you know?" label, the rotating hint's CTA, and the ‹ › ✕ controls
  // (right-aligned). The hint text gets its own row beneath, so it never
  // competes horizontally with the header and can wrap freely. The host centers
  // it (justify-center) and stays flex-1 so it also right-aligns the
  // AI/Import/Export cluster.
  strip = document.createElement('div');
  strip.id = 'editor-hints';
  strip.setAttribute('role', 'note');
  strip.setAttribute('aria-label', 'Did you know');
  strip.className =
    'min-w-0 max-w-full flex flex-col gap-0.5 pl-2.5 pr-1.5 py-1 rounded-md bg-zinc-800/60 border border-zinc-700/70 text-xs text-zinc-400';

  // Row 1 — the header: icon + label + CTA on the left, ‹ › ✕ controls pushed
  // to the right edge with ml-auto.
  const topRow = document.createElement('div');
  topRow.className = 'flex items-center gap-2';

  const icon = document.createElement('span');
  icon.className = 'shrink-0 text-amber-300 flex items-center';
  icon.setAttribute('aria-hidden', 'true');
  icon.innerHTML = SPARKLES_SVG;

  const badge = document.createElement('span');
  badge.className = 'shrink-0 text-zinc-500 select-none';
  badge.textContent = 'Did you know?';

  ctaEl = document.createElement('button');
  ctaEl.type = 'button';
  ctaEl.className = 'shrink-0 text-blue-400 hover:text-blue-300 hover:underline font-medium transition-colors';

  // ‹ › step + ✕ dismiss, kept inside the section and right-aligned (ml-auto),
  // set off by a thin divider so they read as the hints' own controls.
  const controls = document.createElement('div');
  controls.className = 'shrink-0 flex items-center gap-0.5 ml-auto pl-1.5 border-l border-zinc-700/70 text-zinc-500';

  const prevBtn = makeIconBtn('‹', 'Previous hint', () => advance(-1));
  const nextBtn = makeIconBtn('›', 'Next hint', () => advance(1));
  const closeBtn = makeIconBtn('✕', 'Hide hints for this session', dismissForSession);

  controls.append(prevBtn, nextBtn, closeBtn);
  topRow.append(icon, badge, ctaEl, controls);

  // Row 2 — the rotating hint text on its own line beneath the header.
  textEl = document.createElement('span');
  textEl.id = 'editor-hints-text';
  // Wrap onto multiple lines when horizontal room is tight (e.g. the AI panel
  // is open) instead of truncating to a single ellipsised line — the card grows
  // vertically and the toolbar row grows with it. A long hint still fits on one
  // line when there's room; line-clamp-3 caps the growth at three lines so a
  // very long hint on a very narrow card can't balloon the toolbar.
  textEl.className = 'min-w-0 text-zinc-300 break-words line-clamp-3';

  strip.append(topRow, textEl);
  host.appendChild(strip);

  // Degrade gracefully as the toolbar's middle shrinks (e.g. the AI panel opens
  // or on a narrow screen). On mobile the toolbar already wraps and is cramped,
  // so the discovery strip isn't worth the space — hide it outright below the
  // md (768px) breakpoint. On desktop, drop the "💡 Did you know?" badge first
  // as room tightens, let the hint text wrap to multiple lines (see textEl
  // above), and finally hide the whole strip when there's genuinely no room —
  // so it never overflows into the adjacent toolbar buttons. The host stays
  // flex-1, so it keeps right-aligning the AI/Import/Export cluster even when
  // the strip is hidden.
  const desktopMq = window.matchMedia('(min-width: 768px)');
  const applyWidth = () => {
    if (!strip) return;
    const w = host!.clientWidth;
    strip.style.display = desktopMq.matches && w >= 200 ? '' : 'none';
    badge.style.display = w >= 360 ? '' : 'none';
  };
  resizeObs?.disconnect();
  resizeObs = new ResizeObserver(applyWidth);
  resizeObs.observe(host);
  // Re-evaluate on breakpoint crossings: resizing the window across 768px may
  // not shift the host's own width enough to trip the ResizeObserver.
  desktopMq.addEventListener('change', applyWidth);
  desktopMqCleanup = () => desktopMq.removeEventListener('change', applyWidth);
  applyWidth();

  // Pause rotation while the user is reading (hover) or interacting (focus).
  strip.addEventListener('pointerenter', () => { paused = true; });
  strip.addEventListener('pointerleave', () => { paused = false; });
  strip.addEventListener('focusin', () => { paused = true; });
  strip.addEventListener('focusout', () => { paused = false; });

  showCurrent();
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
