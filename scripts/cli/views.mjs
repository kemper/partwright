// Camera-view resolution for the headless preview CLI. Pure + dependency-free
// (no vite/sharp), so it lives apart from preview.mjs and is unit-testable in
// the fast vitest tier. Consumed by preview.mjs (composePng), main.mjs
// (preview/compare), and the legacy model-preview.mjs wrapper.

// Named camera angles for `--views`. az/el are degrees in the rasterizer's own
// frame (see `basis` in preview.mjs); front/right/top/iso are the default grid.
export const NAMED_VIEWS = {
  front: { az: -90, el: 0 },
  back: { az: 90, el: 0 },
  right: { az: 0, el: 0 },
  left: { az: 180, el: 0 },
  top: { az: -90, el: 90 },
  bottom: { az: -90, el: -90 },
  iso: { az: -50, el: 28 },
};

export const DEFAULT_VIEWS = ['front', 'right', 'top', 'iso'].map((name) => ({ name, ...NAMED_VIEWS[name] }));

/** Resolve the `--view` / `--views` CLI flags into an array of {name, az, el}.
 *  Returns `{ views: null }` when neither is set (caller uses DEFAULT_VIEWS),
 *  `{ views }` on success, or `{ error }` on a bad spec. `--view` wins if both
 *  are passed.
 *  - `--view "az,el"`            → one custom-angle tile (e.g. peek behind a feature).
 *  - `--view "az,el;az,el;…"`    → SEVERAL custom angles in one call (';'-separated
 *                                   pairs), tiled together — e.g. iso + underside.
 *  - `--views a,b,c`             → named angles, in order: front,back,right,left,top,bottom,iso. */
export function resolveViews(view, views) {
  if (view !== undefined && view !== null && view !== '') {
    const segs = String(view).split(';').map((s) => s.trim()).filter(Boolean);
    const out = [];
    for (const seg of segs) {
      const parts = seg.split(',').map((s) => Number(s.trim()));
      if (parts.length !== 2 || parts.some((n) => !Number.isFinite(n))) {
        return { error: `--view expects "az,el" pairs (two numbers in degrees, ';'-separated for multiple), got "${seg}".` };
      }
      out.push({ name: `${parts[0]},${parts[1]}`, az: parts[0], el: parts[1] });
    }
    if (!out.length) return { error: '--view needs at least one "az,el" pair.' };
    return { views: out };
  }
  if (views !== undefined && views !== null && views !== '') {
    const names = String(views).split(',').map((s) => s.trim()).filter(Boolean);
    const out = [];
    for (const nm of names) {
      const v = NAMED_VIEWS[nm];
      if (!v) return { error: `--views: unknown view "${nm}". Valid: ${Object.keys(NAMED_VIEWS).join(', ')}.` };
      out.push({ name: nm, ...v });
    }
    if (!out.length) return { error: '--views needs at least one view name.' };
    return { views: out };
  }
  return { views: null };
}
