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
let resizeObs: ResizeObserver | null = null;

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

/** Build the rotation order: unseen hints first (in dataset order), then seen. */
function buildOrder(): Hint[] {
  const seen = readSeen();
  const unseen = HINTS.filter(h => !seen.has(h.id));
  const rest = HINTS.filter(h => seen.has(h.id));
  return unseen.length ? [...unseen, ...rest] : [...HINTS];
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

  // Inline toolbar variant: lives in the toolbar's flexible middle, framed by a
  // vertical divider on each side so the hint region (text + CTA + its ‹ › ✕
  // controls) reads as one unit, distinct from the toolbar's left and right
  // button clusters.
  strip = document.createElement('div');
  strip.id = 'editor-hints';
  strip.setAttribute('role', 'note');
  strip.setAttribute('aria-label', 'Did you know');
  strip.className = 'flex-1 min-w-0 flex items-center gap-2 text-xs text-zinc-400 overflow-hidden';

  const badge = document.createElement('span');
  badge.className = 'shrink-0 text-zinc-500 select-none';
  badge.textContent = '💡 Did you know?';

  textEl = document.createElement('span');
  textEl.id = 'editor-hints-text';
  textEl.className = 'min-w-0 truncate text-zinc-300';

  ctaEl = document.createElement('button');
  ctaEl.type = 'button';
  ctaEl.className = 'shrink-0 text-blue-400 hover:text-blue-300 hover:underline font-medium transition-colors';

  // ‹ › step + ✕ dismiss, kept tight together and right after a divider so it's
  // clear they belong to the hints, not the adjacent "Use AI" button.
  const controls = document.createElement('div');
  controls.className = 'shrink-0 flex items-center gap-0.5 text-zinc-500';

  const prevBtn = makeIconBtn('‹', 'Previous hint', () => advance(-1));
  const nextBtn = makeIconBtn('›', 'Next hint', () => advance(1));
  const closeBtn = makeIconBtn('✕', 'Hide hints for this session', dismissForSession);

  controls.append(prevBtn, nextBtn, closeBtn);
  strip.append(makeDivider(), badge, textEl, ctaEl, makeDivider(), controls);
  host.appendChild(strip);

  // Degrade gracefully as the toolbar's middle shrinks (e.g. the AI panel opens
  // or on a narrow screen): drop the "💡 Did you know?" badge first, then hide
  // the whole strip when there's no room — so it never overflows into the
  // adjacent toolbar buttons. The host stays flex-1, so it keeps right-aligning
  // the AI/Import/Export cluster even when the strip is hidden.
  const applyWidth = () => {
    if (!strip) return;
    const w = host!.clientWidth;
    strip.style.display = w >= 200 ? '' : 'none';
    badge.style.display = w >= 360 ? '' : 'none';
  };
  resizeObs?.disconnect();
  resizeObs = new ResizeObserver(applyWidth);
  resizeObs.observe(host);
  applyWidth();

  // Pause rotation while the user is reading (hover) or interacting (focus).
  strip.addEventListener('pointerenter', () => { paused = true; });
  strip.addEventListener('pointerleave', () => { paused = false; });
  strip.addEventListener('focusin', () => { paused = true; });
  strip.addEventListener('focusout', () => { paused = false; });

  showCurrent();
  scheduleRotate();
}

/** A thin vertical divider used to frame the hint region within the toolbar. */
function makeDivider(): HTMLElement {
  const d = document.createElement('span');
  d.className = 'shrink-0 self-center h-5 w-px bg-zinc-700';
  d.setAttribute('aria-hidden', 'true');
  return d;
}

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
