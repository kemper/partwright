// Fast hover tooltips. The browser's native `title` tooltip only appears
// after a long, browser-controlled delay (~0.5–1.5s) that JS can't shorten.
// This replaces it app-wide: a single delegated listener watches for hover
// over any `[title]` element, suppresses the native tooltip by lifting the
// attribute, and shows a styled bubble after a short delay — restoring the
// attribute on leave so accessibility tools still see it.

const SHOW_DELAY_MS = 150;

let initialized = false;
let bubble: HTMLElement | null = null;
let activeEl: Element | null = null;
let stashedTitle: string | null = null;
let showTimer: ReturnType<typeof setTimeout> | undefined;

export function initTooltips(): void {
  if (initialized) return;
  initialized = true;

  bubble = document.createElement('div');
  bubble.className = 'pw-tooltip';
  bubble.setAttribute('role', 'tooltip');
  document.body.appendChild(bubble);

  document.addEventListener('pointerover', onPointerOver);
  document.addEventListener('pointerout', onPointerOut);
  // A click usually triggers an action that mutates layout, so drop the
  // tooltip immediately rather than leaving it floating over new content.
  document.addEventListener('pointerdown', hide, true);
  // Any scroll invalidates the anchored position.
  document.addEventListener('scroll', hide, true);
}

function onPointerOver(e: PointerEvent): void {
  // Touch taps fire pointerover but there's no real hover — a tooltip would
  // get stuck under the finger, so ignore touch entirely.
  if (e.pointerType === 'touch') return;

  const target = e.target as Element | null;
  const el = target?.closest?.('[title]') as HTMLElement | null;
  if (!el || el === activeEl) return;

  const title = el.getAttribute('title');
  if (!title || !title.trim()) return;

  // Tear down any previous hover before adopting the new target.
  hide();

  activeEl = el;
  stashedTitle = title;
  el.removeAttribute('title'); // suppress the native (slow) tooltip
  showTimer = setTimeout(() => show(el, title), SHOW_DELAY_MS);
}

function onPointerOut(e: PointerEvent): void {
  if (!activeEl) return;
  // Moving onto a descendant of the hovered element is not a real leave.
  const related = e.relatedTarget as Node | null;
  if (related && activeEl.contains(related)) return;
  hide();
}

function show(el: Element, text: string): void {
  if (!bubble || el !== activeEl || !el.isConnected) return;

  bubble.textContent = text;

  // Measure off-screen, then anchor below the element (flipping above when
  // there isn't room) and clamp horizontally to the viewport.
  bubble.style.visibility = 'hidden';
  bubble.classList.add('visible');
  const rect = el.getBoundingClientRect();
  const gap = 6;
  const margin = 8;
  const tw = bubble.offsetWidth;
  const th = bubble.offsetHeight;

  let top = rect.bottom + gap;
  if (top + th + margin > window.innerHeight) {
    const above = rect.top - th - gap;
    if (above >= margin) top = above;
  }
  let left = rect.left + rect.width / 2 - tw / 2;
  left = Math.max(margin, Math.min(window.innerWidth - tw - margin, left));
  top = Math.max(margin, top);

  bubble.style.left = `${left}px`;
  bubble.style.top = `${top}px`;
  bubble.style.visibility = '';
}

function hide(): void {
  clearTimeout(showTimer);
  showTimer = undefined;
  if (activeEl && stashedTitle !== null && !activeEl.hasAttribute('title')) {
    activeEl.setAttribute('title', stashedTitle); // restore for a11y / reuse
  }
  activeEl = null;
  stashedTitle = null;
  bubble?.classList.remove('visible');
}
