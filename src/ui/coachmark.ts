// Lightweight, non-modal coachmark: pulses a ring + arrow + label at a target
// element to draw the eye to it, then auto-fades. Unlike the guided tour
// (src/ui/tour.ts), it does NOT dim the screen or trap focus — the whole
// overlay is pointer-events:none so the user can still click the highlighted
// control through it (e.g. the button an arrow is pointing at). Used by the
// "Did you know?" hints ticker to reveal where a feature lives after its CTA
// switches views / opens a menu.

export type CoachPlacement = 'top' | 'bottom' | 'left' | 'right';

export interface CoachmarkOptions {
  /** Short label shown in the arrow bubble (e.g. "Texture & paint live here"). */
  text?: string;
  /** Which side of the target the bubble sits on. Default 'bottom'. */
  placement?: CoachPlacement;
  /** Auto-dismiss after this long (ms). Default 4000. */
  durationMs?: number;
}

// One coachmark at a time — a new one supersedes the old.
let active: { root: HTMLElement; cleanup: () => void } | null = null;

/** Tear down any visible coachmark immediately. */
export function dismissCoachmark(): void {
  active?.cleanup();
  active = null;
}

/**
 * Pulse a ring + arrow at the element matching `selector`. Returns false (and
 * does nothing) when the target is missing or not visible — callers can treat
 * that as "nothing to point at". The overlay is pointer-events:none, so the
 * first real interaction the user makes (click/scroll/keydown) passes through
 * to the page and also dismisses the coachmark.
 */
export function spotlightElement(selector: string, opts: CoachmarkOptions = {}): boolean {
  const target = document.querySelector<HTMLElement>(selector);
  if (!target) return false;
  const rect = target.getBoundingClientRect();
  // Hidden / zero-size element (e.g. inside a collapsed popover) — nothing to show.
  if (rect.width === 0 || rect.height === 0) return false;

  dismissCoachmark();

  const placement = opts.placement ?? 'bottom';
  const durationMs = opts.durationMs ?? 4000;
  const pad = 6;

  const root = document.createElement('div');
  root.className = 'pw-coachmark-root';

  // Pulsing ring hugging the target.
  const ring = document.createElement('div');
  ring.className = 'pw-coachmark-ring';
  ring.style.top = `${rect.top - pad}px`;
  ring.style.left = `${rect.left - pad}px`;
  ring.style.width = `${rect.width + pad * 2}px`;
  ring.style.height = `${rect.height + pad * 2}px`;
  root.appendChild(ring);

  // Optional label bubble with a directional arrow.
  let bubble: HTMLElement | null = null;
  if (opts.text) {
    bubble = document.createElement('div');
    bubble.className = 'pw-coachmark-bubble';
    bubble.textContent = opts.text;
    const arrow = document.createElement('div');
    arrow.className = `tour-arrow tour-arrow-${placement}`;
    bubble.appendChild(arrow);
    root.appendChild(bubble);
  }

  document.body.appendChild(root);

  // Position the bubble relative to the target now that it's measurable.
  if (bubble) positionBubble(bubble, rect, placement);

  // Fade in.
  requestAnimationFrame(() => {
    ring.classList.add('visible');
    bubble?.classList.add('visible');
  });

  // Teardown wiring.
  let timer = window.setTimeout(dismissCoachmark, durationMs);
  const onInteract = () => dismissCoachmark();
  // Re-measure on layout shifts; if the target vanishes, dismiss.
  const onReflow = () => {
    const r = target.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) { dismissCoachmark(); return; }
    ring.style.top = `${r.top - pad}px`;
    ring.style.left = `${r.left - pad}px`;
    ring.style.width = `${r.width + pad * 2}px`;
    ring.style.height = `${r.height + pad * 2}px`;
    if (bubble) positionBubble(bubble, r, placement);
  };
  // Capture-phase so we see the interaction even though the overlay can't.
  document.addEventListener('pointerdown', onInteract, { capture: true });
  document.addEventListener('keydown', onInteract, { capture: true });
  window.addEventListener('scroll', onReflow, { capture: true, passive: true });
  window.addEventListener('resize', onReflow, { passive: true });

  const cleanup = () => {
    window.clearTimeout(timer);
    timer = 0;
    document.removeEventListener('pointerdown', onInteract, { capture: true } as EventListenerOptions);
    document.removeEventListener('keydown', onInteract, { capture: true } as EventListenerOptions);
    window.removeEventListener('scroll', onReflow, { capture: true } as EventListenerOptions);
    window.removeEventListener('resize', onReflow);
    root.remove();
  };

  active = { root, cleanup };
  return true;
}

const BUBBLE_W = 240;

function positionBubble(bubble: HTMLElement, targetRect: DOMRect, placement: CoachPlacement): void {
  const gap = 14;
  const margin = 12;
  bubble.style.width = `${BUBBLE_W}px`;

  // Force a measure for the height.
  const h = bubble.offsetHeight;

  let top = 0;
  let left = 0;
  switch (placement) {
    case 'bottom':
      top = targetRect.bottom + gap;
      left = targetRect.left + targetRect.width / 2 - BUBBLE_W / 2;
      break;
    case 'top':
      top = targetRect.top - h - gap;
      left = targetRect.left + targetRect.width / 2 - BUBBLE_W / 2;
      break;
    case 'right':
      top = targetRect.top + targetRect.height / 2 - h / 2;
      left = targetRect.right + gap;
      break;
    case 'left':
      top = targetRect.top + targetRect.height / 2 - h / 2;
      left = targetRect.left - BUBBLE_W - gap;
      break;
  }

  // Clamp to the viewport.
  left = Math.max(margin, Math.min(window.innerWidth - BUBBLE_W - margin, left));
  top = Math.max(margin, Math.min(window.innerHeight - h - margin, top));

  bubble.style.top = `${top}px`;
  bubble.style.left = `${left}px`;
}
