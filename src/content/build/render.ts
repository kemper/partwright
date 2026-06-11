// Build-time renderers for the static content pages. Each returns the inner
// HTML for one page; the prerender plugin wraps it in the shared shell and
// injects it into the page's HTML at build (and in dev/preview). Pure Node
// code — no browser globals, no app runtime.

import { pageShell } from './shell';
import { LEGAL_INTRO, LEGAL_SECTIONS, type ContentSection } from '../data/legal';
import { WHATS_NEW_INTRO, WHATS_NEW_WEEKS, type WeekEntry } from '../data/whatsNew';
import { HELP_INTRO, HELP_STATIC_SECTIONS, helpDynamicSections } from '../data/help';
import { getShortcutDocs, IS_MAC, MOD_LABEL, SHIFT_LABEL, ALT_LABEL } from '../../ui/shortcutDefs';
import { languageBadge } from '../../ui/languageBadge';
import {
  CATEGORIES,
  categorizeOf,
  deriveCharacteristics,
  printTestedBadge,
  CATALOG_LANGUAGE_ORDER,
  type CategoryId,
  type CatalogLanguage,
  type CatalogManifestEntry,
} from '../data/catalogCategories';
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';

/** Production origin for absolute links baked into the static pages (e.g. the
 *  help page's example agent prompt). Mirrors the absoluteUrls plugin's env
 *  precedence, falling back to the canonical production URL. */
function siteOrigin(): string {
  return (process.env.SITE_URL || process.env.CF_PAGES_URL || 'https://www.partwrightstudio.com').replace(/\/$/, '');
}

/** Minimal HTML-escape for text interpolated into element bodies. */
function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Escape for a double-quoted attribute value (adds the quote on top of esc). */
function escAttr(s: string): string {
  return esc(s).replace(/"/g, '&quot;');
}

export type ContentPage = 'catalog' | 'help' | 'legal' | 'whats-new';

/** Map a clean route to its content-page id (and back). */
export const CONTENT_PAGES: Record<ContentPage, { path: string; htmlFile: string }> = {
  catalog: { path: '/catalog', htmlFile: 'catalog.html' },
  help: { path: '/help', htmlFile: 'help.html' },
  legal: { path: '/legal', htmlFile: 'legal.html' },
  'whats-new': { path: '/whats-new', htmlFile: 'whats-new.html' },
};

/** Render a list of `{id, heading, body}` sections as the app's pages do:
 *  an uppercase section heading followed by its trusted HTML body. */
function sectionsHtml(sections: ContentSection[]): string {
  return sections
    .map(
      (s) => `<h2 id="${s.id}" class="text-sm font-semibold text-zinc-300 uppercase tracking-wide mt-10 mb-3 scroll-mt-20">${s.heading}</h2>
<div class="text-sm text-zinc-400 leading-relaxed">${s.body}</div>`,
    )
    .join('\n');
}

function legalBody(): string {
  return `<div class="max-w-3xl">
  <h1 class="text-3xl font-bold tracking-tight mb-3">Legal</h1>
  <p class="text-sm text-zinc-400 leading-relaxed mb-8">${LEGAL_INTRO}</p>
  ${sectionsHtml(LEGAL_SECTIONS)}
</div>`;
}

function weekHtml(week: WeekEntry): string {
  const groups = week.groups
    .map((group) => {
      const label = group.label
        ? `<h3 class="text-[11px] font-semibold text-zinc-500 uppercase tracking-widest mt-5 mb-2">${esc(group.label)}</h3>`
        : '';
      const items = group.items
        .map(
          (item) =>
            `<li class="text-sm leading-relaxed"><span class="font-medium text-zinc-200">${esc(item.title)} — </span><span class="text-zinc-400">${esc(item.body)}</span></li>`,
        )
        .join('');
      return `${label}<ul class="space-y-2.5">${items}</ul>`;
    })
    .join('');
  return `<section class="relative">
  <span class="absolute -left-[31px] top-1.5 w-3 h-3 rounded-full bg-blue-500 ring-4 ring-zinc-900"></span>
  <div class="text-xs font-mono text-blue-400 mb-1">${esc(week.range)}</div>
  <h2 class="text-lg font-semibold text-zinc-100 mb-5">${esc(week.headline)}</h2>
  ${groups}
</section>`;
}

function whatsNewBody(): string {
  return `<div class="max-w-3xl">
  <h1 class="text-3xl font-bold tracking-tight mb-3">What’s new</h1>
  <p class="text-sm text-zinc-400 leading-relaxed mb-10">${esc(WHATS_NEW_INTRO)}</p>
  <div class="relative border-l border-zinc-800 pl-6 space-y-12">
    ${WHATS_NEW_WEEKS.map(weekHtml).join('\n')}
  </div>
  <div class="mt-14 p-4 rounded-lg bg-zinc-800 border border-zinc-700 flex items-center justify-between gap-4">
    <span class="text-sm text-zinc-300">Want to try the latest? Jump into the editor.</span>
    <a href="/editor" class="px-4 py-1.5 rounded text-xs bg-blue-600 hover:bg-blue-500 text-white transition-colors shrink-0">Open editor</a>
  </div>
</div>`;
}

function helpBody(): string {
  const kbd = (k: string) => `<strong class="text-zinc-300">${k}</strong>`;
  // Build-time (Node) shortcut rendering resolves to the non-macOS labels —
  // the page text itself notes the macOS variant. Origin uses the prod URL.
  const sections = [
    ...HELP_STATIC_SECTIONS,
    ...helpDynamicSections({
      origin: siteOrigin(),
      paletteKeys: IS_MAC ? `${MOD_LABEL} K` : `${MOD_LABEL} + K`,
      modEnterKeys: IS_MAC ? `${MOD_LABEL} Enter` : `${MOD_LABEL} + Enter`,
      formatKeys: IS_MAC ? `${SHIFT_LABEL} ${ALT_LABEL} F` : `${SHIFT_LABEL} + ${ALT_LABEL} + F`,
      ownedShortcutsHtml: getShortcutDocs().map((s) => `<li>${kbd(s.keys)} — ${s.description}</li>`).join(''),
    }),
  ];
  const toc = sections
    .map((s) => `<li><a href="#${s.id}" class="text-blue-400 hover:text-blue-300 hover:underline">${s.heading}</a></li>`)
    .join('');
  return `<div class="max-w-3xl">
  <h1 class="text-3xl font-bold tracking-tight mb-3">How Partwright works</h1>
  <p class="text-sm text-zinc-400 leading-relaxed mb-4">${HELP_INTRO}</p>
  <a href="/whats-new" class="inline-flex items-center gap-2 mb-8 text-sm text-blue-400 hover:text-blue-300 transition-colors"><span class="text-[10px] font-semibold uppercase tracking-wider rounded bg-blue-500/15 text-blue-300 px-1.5 py-0.5">New</span> See what’s shipped recently →</a>
  <nav class="mb-10 p-4 rounded-lg bg-zinc-800/60 border border-zinc-700/60">
    <div class="text-xs uppercase tracking-wider text-zinc-500 font-semibold mb-2">Contents</div>
    <ul class="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 text-sm">${toc}</ul>
  </nav>
  ${sectionsHtml(sections)}
  <div class="mt-12 p-4 rounded-lg bg-zinc-800 border border-zinc-700 flex items-center justify-between gap-4">
    <span class="text-sm text-zinc-300">New to the editor? Walk through the key features.</span>
    <a href="/editor?tour=1" class="px-4 py-1.5 rounded text-xs bg-blue-600 hover:bg-blue-500 text-white transition-colors shrink-0">Take the guided tour</a>
  </div>
</div>`;
}

interface BuiltTile {
  entry: CatalogManifestEntry;
  language: CatalogLanguage;
  versionCount: number;
  hasParams: boolean;
  category: CategoryId;
}

// Per-entry hashed thumbnail URL (entry.file → "/catalog/thumbs/<id>.<hash>.png"),
// filled by prepareCatalogThumbnails() and read by catalogTileHtml(). Empty until
// the prerender plugin's buildStart runs (dev + build).
const thumbSrcByFile = new Map<string, string>();

/** Decode each catalog entry's stored thumbnail (a base64 PNG data URL in its
 *  session JSON) into a **content-hashed** PNG under `<publicDir>/catalog/thumbs/`,
 *  and remember the hashed URL per entry so the tiles can point `<img src>` at it.
 *
 *  Content-hashed filenames make these immutably cacheable (see `public/_headers`):
 *  a refresh re-uses the cached image with no request, while a *changed* thumbnail
 *  hashes to a new name — so a new build busts only what actually changed, never
 *  the unchanged tiles. This replaces the old client-side per-entry JSON fetch.
 *
 *  Idempotent and deterministic; called once from the prerender plugin's
 *  `buildStart` (so the files exist for both the dev server and the production
 *  build). Failures for one entry just skip its thumbnail (the tile keeps its
 *  placeholder glyph). */
export function prepareCatalogThumbnails(publicDir: string): void {
  thumbSrcByFile.clear();
  const catalogDir = resolve(publicDir, 'catalog');
  const thumbsDir = resolve(catalogDir, 'thumbs');
  let entries: CatalogManifestEntry[];
  try {
    entries = (JSON.parse(readFileSync(resolve(catalogDir, 'manifest.json'), 'utf8')) as { entries: CatalogManifestEntry[] }).entries ?? [];
  } catch {
    return;
  }
  // Start clean so stale hashes (from removed or re-baked thumbnails) don't pile up.
  try { rmSync(thumbsDir, { recursive: true, force: true }); } catch { /* ignore */ }
  mkdirSync(thumbsDir, { recursive: true });
  for (const entry of entries) {
    try {
      const payload = JSON.parse(readFileSync(resolve(catalogDir, entry.file), 'utf8')) as {
        versions?: { thumbnail?: string | null }[];
      };
      const versions = payload.versions ?? [];
      const dataUrl = versions.length > 0 ? versions[versions.length - 1].thumbnail : null;
      const m = dataUrl?.match(/^data:image\/png;base64,(.+)$/);
      if (!m) continue;
      const bytes = Buffer.from(m[1], 'base64');
      const hash = createHash('sha256').update(bytes).digest('hex').slice(0, 16);
      const fileName = `${entry.id}.${hash}.png`;
      writeFileSync(resolve(thumbsDir, fileName), bytes);
      thumbSrcByFile.set(entry.file, `/catalog/thumbs/${fileName}`);
    } catch {
      // No usable thumbnail for this entry — the tile falls back to its glyph.
    }
  }
}

/** Read the catalog manifest + each session file from public/catalog at build
 *  time, deriving each tile's language, traits, version count, and category.
 *  Failures degrade to an empty list (the page still renders its intro). */
function loadCatalogTiles(): BuiltTile[] {
  const catalogDir = resolve(process.cwd(), 'public/catalog');
  let entries: CatalogManifestEntry[];
  try {
    const manifest = JSON.parse(readFileSync(resolve(catalogDir, 'manifest.json'), 'utf8')) as { entries: CatalogManifestEntry[] };
    entries = manifest.entries ?? [];
  } catch {
    return [];
  }
  const tiles: BuiltTile[] = [];
  for (const entry of entries) {
    let language: CatalogLanguage = entry.language ?? 'manifold-js';
    let versionCount = 0;
    let code = '';
    try {
      const payload = JSON.parse(readFileSync(resolve(catalogDir, entry.file), 'utf8')) as {
        session?: { language?: CatalogLanguage };
        versions?: { code?: string }[];
      };
      language = payload.session?.language ?? language;
      const versions = payload.versions ?? [];
      versionCount = versions.length;
      code = versions.map((v) => v.code ?? '').join('\n');
    } catch {
      // Keep the entry with manifest-only info; it still links + categorizes.
    }
    const { hasParams, isSDF } = deriveCharacteristics(entry.id, code);
    tiles.push({ entry, language, versionCount, hasParams, category: categorizeOf({ hasParams, isSDF, language, group: entry.group }) });
  }
  return tiles;
}

function catalogTileHtml(tile: BuiltTile): string {
  const badge = languageBadge(tile.language);
  const desc = tile.entry.description
    ? `<div class="text-[11px] text-zinc-400 mt-0.5 leading-snug">${esc(tile.entry.description)}</div>`
    : '';
  const paramChip = tile.hasParams
    ? '<span class="font-semibold border rounded px-1 text-violet-300 border-violet-400/30" title="Exposes adjustable parameters">🎛 Parametric</span>'
    : '';
  const print = printTestedBadge(tile.entry.printTested);
  const printChip = `<span class="font-semibold border rounded px-1 ${print.classes}" title="${escAttr(print.title)}">${esc(print.label)}</span>`;
  const versions = tile.versionCount > 0
    ? `<span>${tile.versionCount} version${tile.versionCount !== 1 ? 's' : ''}</span>`
    : '';
  const haystack = [tile.entry.name, tile.entry.description ?? '', tile.entry.id, badge.label, print.search].join(' ').toLowerCase();
  // Thumbnail src is a content-hashed PNG emitted at build time (see
  // prepareCatalogThumbnails); the browser lazy-loads it natively. Tiles with no
  // thumbnail keep just the placeholder glyph.
  const thumbSrc = thumbSrcByFile.get(tile.entry.file);
  const thumbImg = thumbSrc
    ? `<img src="${escAttr(thumbSrc)}" alt="${escAttr(tile.entry.name)}" loading="lazy" decoding="async" class="absolute inset-0 w-full h-full object-contain" />`
    : '';
  return `<a href="/editor?catalog=${encodeURIComponent(tile.entry.file)}" data-catalog-tile data-language="${escAttr(tile.language)}" data-search="${escAttr(haystack)}" class="flex flex-col bg-zinc-800 rounded-lg border border-zinc-700 hover:border-zinc-500 transition-colors overflow-hidden no-underline">
  <div class="relative w-full aspect-square bg-zinc-900 flex items-center justify-center overflow-hidden">
    <span class="text-3xl text-zinc-700">&#11041;</span>
    ${thumbImg}
  </div>
  <div class="px-3 py-2.5">
    <div class="text-sm font-medium text-zinc-100 truncate">${esc(tile.entry.name)}</div>
    ${desc}
    <div class="text-[10px] text-zinc-500 mt-1.5 flex items-center gap-2 flex-wrap">
      <span class="font-semibold border rounded px-1 ${badge.classes}">${esc(badge.label)}</span>
      ${printChip}
      ${paramChip}
      ${versions}
    </div>
  </div>
</a>`;
}

function catalogBody(): string {
  const tiles = loadCatalogTiles();
  const intro = `<div class="flex items-center gap-3 mb-2">
    <h1 class="text-3xl font-bold tracking-tight">Catalog</h1>
  </div>
  <p class="text-sm text-zinc-400 leading-relaxed mb-8 max-w-3xl">Curated premade models, grouped by what makes each one tick — parametric, JavaScript, implicit-surface (SDF), OpenSCAD, and solid-CAD (BREP). Click a tile to open it in the editor as a fresh session you can edit. <a href="/ideas" class="text-teal-300 hover:text-teal-200 underline decoration-dotted">Looking for ideas to try? →</a></p>`;
  if (tiles.length === 0) {
    return `${intro}<p class="text-zinc-500 text-sm">Catalog is loading — open the <a href="/editor" class="text-blue-400 hover:underline">editor</a> to browse models.</p>`;
  }
  const sections = CATEGORIES.map((def) => {
    const inCat = tiles.filter((t) => t.category === def.id);
    if (inCat.length === 0) return '';
    return `<section class="mb-10" data-category="${def.id}">
  <div class="flex items-baseline gap-2">
    <h2 class="text-lg font-semibold text-zinc-100">${esc(def.title)}</h2>
    <span class="text-xs text-zinc-500 tabular-nums" data-catalog-count>${inCat.length}</span>
  </div>
  <p class="text-xs text-zinc-400 mt-0.5 mb-3 leading-relaxed">${esc(def.blurb)}</p>
  <div class="grid gap-4" style="grid-template-columns:repeat(auto-fill,minmax(220px,1fr))">${inCat.map(catalogTileHtml).join('')}</div>
</section>`;
  }).join('');
  const empty = '<div data-catalog-empty class="hidden text-center py-12 text-zinc-500 text-sm">No models match your search and filters.</div>';
  return `<div>${intro}${catalogControlsHtml(tiles)}${sections}${empty}</div>`;
}

/** Search box + language filter pills for the static page, tagged with the
 *  shared `data-catalog-*` hooks. catalogEntry.ts wires the behavior. */
function catalogControlsHtml(tiles: BuiltTile[]): string {
  const langCounts = new Map<CatalogLanguage, number>();
  for (const t of tiles) langCounts.set(t.language, (langCounts.get(t.language) ?? 0) + 1);
  const present = CATALOG_LANGUAGE_ORDER.filter((l) => langCounts.has(l));
  const pills = present.length > 1
    ? `<div class="flex items-center gap-2 flex-wrap">
    <span class="text-xs text-zinc-500 mr-1">Language:</span>
    ${present.map((l) => {
      const b = languageBadge(l);
      return `<button type="button" data-catalog-pill="${escAttr(l)}" aria-pressed="true" class="px-2 py-1 rounded text-xs font-semibold border bg-zinc-800 ${b.classes}" title="Hide ${escAttr(b.label)} models">${esc(b.label)} ${langCounts.get(l) ?? 0}</button>`;
    }).join('')}
  </div>`
    : '';
  return `<div class="mb-8 flex flex-col gap-3">
  <input type="search" data-catalog-search placeholder="Search the catalog…" aria-label="Search the catalog" class="w-full max-w-md bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 outline-none focus:border-zinc-500 transition-colors" />
  ${pills}
</div>`;
}

/** Return the fully-wrapped inner HTML (nav + content + footer) for a page. */
export function renderContentBody(page: ContentPage): string {
  switch (page) {
    case 'legal':
      return pageShell('/legal', legalBody());
    case 'whats-new':
      return pageShell('/whats-new', whatsNewBody());
    case 'help':
      return pageShell('/help', helpBody());
    case 'catalog':
      return pageShell('/catalog', catalogBody());
  }
}
