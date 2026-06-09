// The ONLY client script on any content page — and it runs only on /catalog.
// The catalog tiles' text (name, description, language, category) AND their
// thumbnails are baked into the static HTML at build time: each tile's <img>
// points at a content-hashed PNG (/catalog/thumbs/<id>.<hash>.png) emitted by
// the prerender plugin (see prepareCatalogThumbnails in build/render.ts) and is
// lazy-loaded natively. So this script only wires the search box + language
// filter pills and swaps the slow native tooltips — there's no thumbnail
// hydration left to do.
//
// Keep the import graph empty: this must not pull in any app/engine code. The
// imports below are dependency-free — wireCatalogFilter is pure DOM, and
// initTooltips pulls in only the self-contained appConfig (no engine/WASM).

import { wireCatalogFilter } from './catalogFilter';
import { initTooltips } from '../ui/tooltip';

function init(): void {
  wireCatalogFilter(document);
  // Replace the slow native `title` tooltips on the catalog's tags/badges with
  // the same fast styled bubbles the editor uses (config-driven ~150ms delay).
  // The static catalog page never boots main.ts, so without this the tags fall
  // back to the browser's ~0.5–1.5s native tooltip delay.
  initTooltips();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
