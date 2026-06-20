// Pure, unit-testable CLI gate helpers (no engine / vite / sharp imports) so they
// can be exercised in the fast vitest tier — same split as views.mjs. Re-exported
// from preview.mjs for the CLIs and imported directly by figure-smoke.mjs.

// `--require-labels a,b,c` paint-resolution gate — the headless twin of
// scripts/build-catalog-entry.cjs's `--require-labels` gate, but it runs in the
// stateless Node SSR preview (no browser / no xvfb). Given a PreviewStats and the
// raw comma-separated flag value, returns null when EVERY listed label resolves
// to >0 paintable triangles in `stats.labels`, otherwise an error string naming
// each failure.
//
// Why this catches buried features: figure parts (eyes / iris / pupil / areola)
// are labelled geometry whose colour is applied later, so a feature buried under
// the skin contributes 0 triangles to the final mesh — its label is then absent
// from `stats.labels` (or present with triangleCount 0). model:preview shades by
// normal and can't show this; the colored xvfb bake was previously the only
// oracle. This gate surfaces it in ~2s instead of ~75s.
export function checkRequireLabels(stats, requireArg) {
  if (requireArg === null || requireArg === undefined || requireArg === '') return null;
  const required = String(requireArg).split(',').map((s) => s.trim()).filter(Boolean);
  // Flag was given but empty (e.g. `--require-labels ,`) — surface it rather than
  // silently treating the gate as a no-op, matching checkExpectComponents.
  if (!required.length) return '--require-labels needs a comma-separated label list.';
  const counts = new Map((stats && Array.isArray(stats.labels) ? stats.labels : []).map((l) => [l.name, l.triangleCount]));
  const failures = [];
  for (const name of required) {
    const n = counts.get(name);
    if (!n) failures.push(`'${name}' resolved to ${n === 0 ? '0' : 'no'} paintable triangles (buried/aliased-away feature, or never declared)`);
  }
  if (!failures.length) return null;
  const present = [...counts.entries()].filter(([, n]) => n > 0).map(([k]) => k);
  return `--require-labels failed:\n  ${failures.join('\n  ')}\n  (labels with paintable surface: ${present.join(', ') || 'none'})`;
}
