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

interface CatalogThumbs {
  /** Map of catalog file name → latest-version thumbnail data URL. */
  [file: string]: string;
}

async function hydrateThumbnails(): Promise<void> {
  const tiles = Array.from(document.querySelectorAll<HTMLElement>('[data-pw-thumb]'));
  if (tiles.length === 0) return;

  // One request for all thumbnails (emitted at build time), with a graceful
  // fallback to per-file fetches if it isn't present. Use `no-cache` (revalidate
  // with the server, cheap 304 when unchanged) rather than `force-cache`: a
  // stale entry must never blank a tile after a thumbnail update — `force-cache`
  // returns a cached copy without revalidating, so a visitor who loaded the page
  // before a thumbnail existed would keep seeing the blank indefinitely.
  let thumbs: CatalogThumbs | null = null;
  try {
    const res = await fetch('/catalog/thumbs.json', { cache: 'no-cache' });
    if (res.ok) thumbs = await res.json() as CatalogThumbs;
  } catch { /* fall through to per-file */ }

  await Promise.all(tiles.map(async (tile) => {
    const file = tile.getAttribute('data-pw-thumb');
    if (!file) return;
    const img = tile.querySelector<HTMLImageElement>('img');
    if (!img) return;
    let src = thumbs?.[file] ?? null;
    if (!src) {
      try {
        const res = await fetch(`/catalog/${file}`, { cache: 'no-cache' });
        if (res.ok) {
          const payload = await res.json() as { versions?: { thumbnail?: string | null }[] };
          const versions = payload.versions ?? [];
          src = versions.length > 0 ? (versions[versions.length - 1].thumbnail ?? null) : null;
        }
      } catch { /* leave placeholder */ }
    }
    if (src) {
      img.src = src;
      img.style.opacity = '1';
    }
  }));
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
