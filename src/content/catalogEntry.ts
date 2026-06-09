// The ONLY client script on any content page — and it runs only on /catalog.
// The catalog tiles' text (name, description, language, category) are baked
// into the static HTML at build time for crawlers; this hydrates each tile's
// thumbnail lazily so the initial HTML stays small. Tiles are plain <a> links
// to /editor?catalog=<file>, so the page is fully functional without it. It
// also wires the search box + language filter pills (progressive enhancement —
// the full catalog renders server-side; this just hides/shows on top).
//
// Keep the import graph empty: this must not pull in any app/engine code. The
// imports below are dependency-free — wireCatalogFilter is pure DOM, and
// initTooltips pulls in only the self-contained appConfig (no engine/WASM).

import { wireCatalogFilter } from './catalogFilter';
import { initTooltips } from '../ui/tooltip';

/** Fetch one tile's thumbnail from its entry JSON and apply it. Each tile loads
 *  at most once. `no-cache` revalidates (cheap 304 when unchanged) so an updated
 *  thumbnail is never masked by a stale cached copy. */
async function loadThumbnail(tile: HTMLElement): Promise<void> {
  const file = tile.getAttribute('data-pw-thumb');
  if (!file) return;
  const img = tile.querySelector<HTMLImageElement>('img');
  if (!img) return;
  try {
    const res = await fetch(`/catalog/${file}`, { cache: 'no-cache' });
    if (!res.ok) return;
    const payload = await res.json() as { versions?: { thumbnail?: string | null }[] };
    const versions = payload.versions ?? [];
    const src = versions.length > 0 ? (versions[versions.length - 1].thumbnail ?? null) : null;
    if (src) {
      img.src = src;
      img.style.opacity = '1';
    }
  } catch { /* leave placeholder */ }
}

async function hydrateThumbnails(): Promise<void> {
  const tiles = Array.from(document.querySelectorAll<HTMLElement>('[data-pw-thumb]'));
  if (tiles.length === 0) return;

  // Lazy, per-tile: a tile's thumbnail (a base64 data URL embedded in its entry
  // JSON) is fetched only as the tile nears the viewport. There is intentionally
  // no aggregate `thumbs.json` — bundling every thumbnail into one file doesn't
  // scale: it grows unbounded with the catalog and blocks the whole page on a
  // single multi-MB download even for tiles far below the fold. Loading on demand
  // keeps the page fast no matter how large the catalog grows.
  if (typeof IntersectionObserver === 'undefined') {
    // Ancient browser with no IO: just load everything (old behavior).
    await Promise.all(tiles.map(loadThumbnail));
    return;
  }

  // Start fetching ~300px before a tile scrolls into view so the image is
  // usually ready by the time it's on screen; unobserve after the first hit so
  // each tile loads exactly once.
  const observer = new IntersectionObserver((entries, obs) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      const tile = entry.target as HTMLElement;
      obs.unobserve(tile);
      void loadThumbnail(tile);
    }
  }, { rootMargin: '300px 0px' });
  for (const tile of tiles) observer.observe(tile);
}

function init(): void {
  wireCatalogFilter(document);
  // Replace the slow native `title` tooltips on the catalog's tags/badges with
  // the same fast styled bubbles the editor uses (config-driven ~150ms delay).
  // The static catalog page never boots main.ts, so without this the tags fall
  // back to the browser's ~0.5–1.5s native tooltip delay.
  initTooltips();
  void hydrateThumbnails();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
