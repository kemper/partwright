// HTML escaping for use sites that genuinely need to interpolate
// user-provided strings into `innerHTML`. Prefer `textContent` when
// possible — this helper exists for the rare cases where surrounding
// markup must be assigned via innerHTML.

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
