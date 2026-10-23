// Small inline SVG icons shared across panels (stroke = currentColor, so they
// follow the button's text colour).

export function eyeIconSVG(): string {
  return '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" class="w-3.5 h-3.5"><path d="M1 8c1.5-3 4-5 7-5s5.5 2 7 5c-1.5 3-4 5-7 5s-5.5-2-7-5z"/><circle cx="8" cy="8" r="2"/></svg>';
}

export function eyeOffIconSVG(): string {
  return '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" class="w-3.5 h-3.5"><path d="M1 8c1.5-3 4-5 7-5s5.5 2 7 5c-1.5 3-4 5-7 5s-5.5-2-7-5z"/><line x1="2" y1="2" x2="14" y2="14"/></svg>';
}
