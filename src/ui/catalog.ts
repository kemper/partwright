// Catalog page — a curated grid of premade sessions shipped as static
// `.partwright.json` files in `public/catalog/`. Each tile previews the
// embedded thumbnail (when present) and imports the session on click.

import type { ExportedSession } from '../storage/sessionManager';
import { assetPath } from '../deployment';
import { partwrightMarkSvg } from './brand';
import { languageBadge } from './languageBadge';
import { getTheme, onThemeChange, toggleTheme } from './theme';
import { wireCatalogFilter } from '../content/catalogFilter';
import {
  CATEGORIES,
  categorizeOf,
  deriveCharacteristics as deriveTraits,
  printTestedBadge,
  printStatusOf,
  printStatusCounts,
  CATALOG_LANGUAGE_ORDER,
  CATALOG_THEMES,
  CATALOG_PRINT_STATUSES,
  themeCounts,
  type CategoryId,
  type CategoryDef,
  type CatalogManifestEntry,
  type CatalogLanguage,
} from '../content/data/catalogCategories';

export type { CatalogManifestEntry };

interface CatalogManifest {
  entries: CatalogManifestEntry[];
}

export interface CatalogCallbacks {
  onBack: () => void;
  /** Called with the parsed session payload when a tile is clicked. */
  onLoadEntry: (entry: CatalogManifestEntry, payload: ExportedSession) => void | Promise<void>;
  /** Optional: open the /ideas page (reciprocal cross-link in the header). */
  onOpenIdeas?: () => void;
}

interface LoadedEntry {
  manifest: CatalogManifestEntry;
  payload: ExportedSession | null;
  /** Pulled from the latest version's embedded thumbnail, or null. */
  thumbnailUrl: string | null;
  /** Declares `api.params({...})` in any version's code — drives the
   *  "Customizable" category + the parametric tile badge. */
  hasParams: boolean;
  /** Uses an implicit/signed-distance surface (`levelSet`, or an `sdf-` id). */
  isSDF: boolean;
  error: string | null;
}

/** Assign one category per entry (delegates to the shared, pure categorizer). */
function categorize(entry: LoadedEntry): CategoryId {
  const language = entry.payload?.session.language ?? entry.manifest.language ?? 'manifold-js';
  return categorizeOf({ hasParams: entry.hasParams, isSDF: entry.isSDF, language, group: entry.manifest.group });
}

/** The resolved language used for a tile's badge + the language filter. */
function entryLanguage(entry: LoadedEntry): CatalogLanguage {
  return entry.payload?.session.language ?? entry.manifest.language ?? 'manifold-js';
}

/** Inspect a payload's code for the characteristics that drive categorization
 *  and tile badges. Reads across all versions so a trait declared on any
 *  version still counts. */
function deriveCharacteristics(entry: CatalogManifestEntry, payload: ExportedSession | null): { hasParams: boolean; isSDF: boolean } {
  const code = (payload?.versions ?? []).map(v => v.code ?? '').join('\n');
  return deriveTraits(entry.id, code);
}

export async function createCatalogPage(
  container: HTMLElement,
  callbacks: CatalogCallbacks,
): Promise<HTMLElement> {
  const page = document.createElement('div');
  page.id = 'catalog-page';
  page.className = 'flex flex-col items-center w-full h-full overflow-auto bg-zinc-900 text-zinc-100 relative';

  // Top-right theme toggle (mirrors landing page).
  const themeBtn = document.createElement('button');
  themeBtn.textContent = 'Dark Mode';
  const themeActive = 'absolute top-4 right-4 px-3 py-1 rounded text-xs font-medium transition-colors bg-zinc-700 text-zinc-100';
  const themeInactive = 'absolute top-4 right-4 px-3 py-1 rounded text-xs font-medium transition-colors text-zinc-500 hover:text-zinc-300 border border-zinc-600';
  const syncThemeBtn = (theme: 'light' | 'dark') => {
    const on = theme === 'dark';
    themeBtn.className = on ? themeActive : themeInactive;
    themeBtn.title = on ? 'Dark mode on — click to switch to light' : 'Dark mode off — click to switch to dark';
    themeBtn.setAttribute('aria-pressed', String(on));
  };
  syncThemeBtn(getTheme());
  themeBtn.addEventListener('click', () => { toggleTheme(); });
  onThemeChange(syncThemeBtn);
  page.appendChild(themeBtn);

  // Header: logo + back button + title
  const header = document.createElement('div');
  header.className = 'w-full max-w-5xl px-6 pt-10 pb-6 flex items-center gap-4';

  const back = document.createElement('button');
  back.className = 'flex items-center gap-1.5 px-3 py-1.5 rounded text-xs text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 transition-colors';
  back.innerHTML = '\u2190 Back';
  back.addEventListener('click', callbacks.onBack);
  header.appendChild(back);

  const titleWrap = document.createElement('div');
  titleWrap.className = 'flex items-center gap-3';
  titleWrap.innerHTML = `${partwrightMarkSvg(28)}<h1 class="text-2xl font-semibold tracking-tight">Catalog</h1>`;
  header.appendChild(titleWrap);

  page.appendChild(header);

  const intro = document.createElement('p');
  intro.className = 'w-full max-w-5xl px-6 -mt-4 mb-6 text-sm text-zinc-400 leading-relaxed';
  intro.textContent = 'Curated premade models, grouped by what makes each one tick — parametric, JavaScript, implicit-surface (SDF), OpenSCAD, and solid-CAD (BREP). Click a tile to import it as a fresh session you can edit.';
  if (callbacks.onOpenIdeas) {
    const ideasLink = document.createElement('button');
    ideasLink.className = 'ml-1 text-teal-300 hover:text-teal-200 underline decoration-dotted';
    ideasLink.textContent = 'Looking for ideas to try? →';
    ideasLink.addEventListener('click', () => callbacks.onOpenIdeas!());
    intro.appendChild(ideasLink);
  }
  page.appendChild(intro);

  // Body: grid (loading / empty / error states handled below).
  const body = document.createElement('div');
  body.className = 'w-full max-w-5xl px-6 pb-16';
  page.appendChild(body);

  const status = document.createElement('div');
  status.className = 'text-center py-12 text-zinc-500 text-sm';
  status.textContent = 'Loading catalog\u2026';
  body.appendChild(status);

  container.appendChild(page);

  // Fetch manifest + each entry. Failures degrade gracefully — a broken entry
  // shows a placeholder tile rather than blocking the whole page.
  let manifest: CatalogManifest;
  try {
    const res = await fetch(assetPath('/catalog/manifest.json'), { cache: 'no-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    manifest = await res.json() as CatalogManifest;
  } catch (e) {
    status.textContent = '';
    const empty = document.createElement('div');
    empty.className = 'text-center py-12 text-zinc-500 text-sm';
    empty.textContent = 'No catalog manifest found. Add public/catalog/manifest.json to populate this page.';
    body.appendChild(empty);
    return page;
  }

  if (!manifest.entries || manifest.entries.length === 0) {
    status.textContent = '';
    const empty = document.createElement('div');
    empty.className = 'text-center py-12 text-zinc-500 text-sm';
    empty.textContent = 'Catalog is empty. Export sessions from the editor (with the Thumbnail option) and add them to public/catalog/.';
    body.appendChild(empty);
    return page;
  }

  const loaded: LoadedEntry[] = await Promise.all(
    manifest.entries.map(async (entry): Promise<LoadedEntry> => {
      try {
        const res = await fetch(assetPath(`/catalog/${entry.file}`), { cache: 'no-cache' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const payload = await res.json() as ExportedSession;
        // Prefer the session-level composite contact sheet (schema 1.18,
        // multi-part entries); fall back to the latest version's thumbnail.
        const versions = payload.versions ?? [];
        const latest = versions.length > 0 ? versions[versions.length - 1] : null;
        const thumbnailUrl = payload.session?.compositeThumbnail ?? latest?.thumbnail ?? null;
        const { hasParams, isSDF } = deriveCharacteristics(entry, payload);
        return { manifest: entry, payload, thumbnailUrl, hasParams, isSDF, error: null };
      } catch (e) {
        return { manifest: entry, payload: null, thumbnailUrl: null, hasParams: false, isSDF: false, error: (e as Error).message };
      }
    }),
  );

  status.remove();

  // Bucket entries into their category, then render the non-empty sections in
  // CATEGORIES order. Entry order within a section follows the manifest.
  const buckets = new Map<CategoryId, LoadedEntry[]>();
  for (const entry of loaded) {
    const cat = categorize(entry);
    const arr = buckets.get(cat);
    if (arr) arr.push(entry);
    else buckets.set(cat, [entry]);
  }

  for (const def of CATEGORIES) {
    const entries = buckets.get(def.id);
    if (!entries || entries.length === 0) continue;
    body.appendChild(renderCategorySection(def, entries, callbacks));
  }

  // "No results" element the shared filter toggles when nothing matches.
  const noResults = document.createElement('div');
  noResults.dataset.catalogEmpty = '';
  noResults.className = 'hidden text-center py-12 text-zinc-500 text-sm';
  noResults.textContent = 'No models match your search and filters.';
  body.appendChild(noResults);

  // Search box + language pills, inserted above the body so they control every
  // section at once. Behavior is the shared, data-attribute-driven filter used
  // by the static /catalog page too.
  page.insertBefore(buildControls(loaded), body);
  wireCatalogFilter(page);

  return page;
}

/** Build the search input + language filter pills, tagged with the shared
 *  `data-catalog-*` hooks. Behavior is wired separately by wireCatalogFilter. */
function buildControls(loaded: LoadedEntry[]): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'w-full max-w-5xl px-6 mb-8 flex flex-col gap-3';

  const search = document.createElement('input');
  search.type = 'search';
  search.dataset.catalogSearch = '';
  search.placeholder = 'Search the catalog…';
  search.setAttribute('aria-label', 'Search the catalog');
  search.className = 'w-full max-w-md bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 outline-none focus:border-zinc-500 transition-colors';
  wrap.appendChild(search);

  // One pill per language actually present, in canonical order, with counts.
  const langCounts = new Map<CatalogLanguage, number>();
  for (const entry of loaded) {
    const lang = entryLanguage(entry);
    langCounts.set(lang, (langCounts.get(lang) ?? 0) + 1);
  }
  const present = CATALOG_LANGUAGE_ORDER.filter((l) => langCounts.has(l));
  if (present.length > 1) {
    const pillRow = document.createElement('div');
    pillRow.className = 'flex items-center gap-2 flex-wrap';
    const label = document.createElement('span');
    label.className = 'text-xs text-zinc-500 mr-1';
    label.textContent = 'Language:';
    pillRow.appendChild(label);

    for (const lang of present) {
      const badge = languageBadge(lang);
      const pill = document.createElement('button');
      pill.type = 'button';
      pill.dataset.catalogPill = lang;
      // Unselected by default — an empty selection means "show all languages".
      pill.setAttribute('aria-pressed', 'false');
      pill.className = `px-2 py-1 rounded text-xs font-semibold border bg-zinc-800 opacity-60 ${badge.classes}`;
      pill.textContent = `${badge.label} ${langCounts.get(lang) ?? 0}`;
      pillRow.appendChild(pill);
    }
    wrap.appendChild(pillRow);
  }

  // Theme filter pills — an orthogonal facet over the same tiles. One pill per
  // theme actually present, in canonical order, with counts. Unselected by
  // default (empty selection = all themes).
  const tCounts = themeCounts(loaded.map((entry) => entry.manifest));
  const presentThemes = CATALOG_THEMES.filter((th) => tCounts.has(th.id));
  if (presentThemes.length > 0) {
    const themeRow = document.createElement('div');
    themeRow.className = 'flex items-center gap-2 flex-wrap';
    const label = document.createElement('span');
    label.className = 'text-xs text-zinc-500 mr-1';
    label.textContent = 'Type:';
    themeRow.appendChild(label);

    for (const theme of presentThemes) {
      const pill = document.createElement('button');
      pill.type = 'button';
      pill.dataset.catalogTheme = theme.id;
      pill.setAttribute('aria-pressed', 'false');
      pill.className = 'px-2 py-1 rounded text-xs font-semibold border bg-zinc-800 border-zinc-600 text-zinc-300 opacity-60';
      pill.textContent = `${theme.label} ${tCounts.get(theme.id) ?? 0}`;
      themeRow.appendChild(pill);
    }
    wrap.appendChild(themeRow);
  }

  // Print-status filter pills — verified-print vs not-yet-tested. Coloured to
  // match the tile chips (emerald for tested, muted for untested). Rendered only
  // when both statuses are present, so a fully-untested catalog shows no facet.
  const sCounts = printStatusCounts(loaded.map((entry) => entry.manifest));
  const presentStatuses = CATALOG_PRINT_STATUSES.filter((s) => sCounts.has(s.id));
  if (presentStatuses.length > 1) {
    const statusRow = document.createElement('div');
    statusRow.className = 'flex items-center gap-2 flex-wrap';
    const label = document.createElement('span');
    label.className = 'text-xs text-zinc-500 mr-1';
    label.textContent = 'Print status:';
    statusRow.appendChild(label);

    for (const status of presentStatuses) {
      const badge = printTestedBadge({ printTested: status.id === 'tested' });
      const pill = document.createElement('button');
      pill.type = 'button';
      pill.dataset.catalogStatus = status.id;
      pill.setAttribute('aria-pressed', 'false');
      pill.className = `px-2 py-1 rounded text-xs font-semibold border bg-zinc-800 opacity-60 ${badge.classes}`;
      pill.textContent = `${status.label} ${sCounts.get(status.id) ?? 0}`;
      statusRow.appendChild(pill);
    }
    wrap.appendChild(statusRow);
  }

  return wrap;
}

/** Render one titled, blurbed category section with its own tile grid. */
function renderCategorySection(def: CategoryDef, entries: LoadedEntry[], callbacks: CatalogCallbacks): HTMLElement {
  const section = document.createElement('section');
  section.className = 'mb-10';
  section.dataset.category = def.id;

  const titleRow = document.createElement('div');
  titleRow.className = 'flex items-baseline gap-2';
  const h2 = document.createElement('h2');
  h2.className = 'text-lg font-semibold text-zinc-100';
  h2.textContent = def.title;
  const count = document.createElement('span');
  count.className = 'text-xs text-zinc-500 tabular-nums';
  count.dataset.catalogCount = '';
  count.textContent = String(entries.length);
  titleRow.appendChild(h2);
  titleRow.appendChild(count);
  section.appendChild(titleRow);

  const blurb = document.createElement('p');
  blurb.className = 'text-xs text-zinc-400 mt-0.5 mb-3 leading-relaxed';
  blurb.textContent = def.blurb;
  section.appendChild(blurb);

  const grid = document.createElement('div');
  grid.className = 'grid gap-4';
  grid.style.gridTemplateColumns = 'repeat(auto-fill, minmax(220px, 1fr))';
  for (const entry of entries) grid.appendChild(renderTile(entry, callbacks));
  section.appendChild(grid);

  return section;
}

function renderTile(loaded: LoadedEntry, callbacks: CatalogCallbacks): HTMLElement {
  const tile = document.createElement('button');
  tile.className = 'flex flex-col bg-zinc-800 rounded-lg border border-zinc-700 hover:border-zinc-500 transition-colors overflow-hidden text-left cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed';

  // Filter hooks consumed by wireCatalogFilter.
  const language = entryLanguage(loaded);
  const tags = loaded.manifest.tags ?? [];
  tile.dataset.catalogTile = '';
  tile.dataset.language = language;
  tile.dataset.themes = tags.join(' ');
  tile.dataset.status = printStatusOf(loaded.manifest.printTested);
  const print = printTestedBadge({
    printTested: loaded.manifest.printTested,
    note: loaded.manifest.printTestedNote,
    testedVersion: loaded.manifest.printTestedVersion,
    latestVersion: loaded.payload?.versions?.length ?? 0,
  });
  tile.dataset.search = [
    loaded.manifest.name,
    loaded.manifest.description ?? '',
    loaded.manifest.id,
    languageBadge(language).label,
    print.search,
    ...tags,
  ].join(' ').toLowerCase();

  // Thumbnail
  const thumbContainer = document.createElement('div');
  thumbContainer.className = 'w-full aspect-square bg-zinc-900 flex items-center justify-center overflow-hidden';

  if (loaded.thumbnailUrl) {
    const img = document.createElement('img');
    img.className = 'w-full h-full object-contain';
    img.src = loaded.thumbnailUrl;
    img.alt = loaded.manifest.name;
    thumbContainer.appendChild(img);
  } else {
    const placeholder = document.createElement('span');
    placeholder.className = 'text-3xl text-zinc-700';
    placeholder.textContent = '\u2B21'; // hexagon
    thumbContainer.appendChild(placeholder);
  }
  tile.appendChild(thumbContainer);

  // Info
  const info = document.createElement('div');
  info.className = 'px-3 py-2.5';

  const name = document.createElement('div');
  name.className = 'text-sm font-medium text-zinc-100 truncate';
  name.textContent = loaded.manifest.name;
  info.appendChild(name);

  if (loaded.manifest.description) {
    const desc = document.createElement('div');
    desc.className = 'text-[11px] text-zinc-400 mt-0.5 line-clamp-2 leading-snug';
    desc.textContent = loaded.manifest.description;
    info.appendChild(desc);
  }

  const meta = document.createElement('div');
  meta.className = 'text-[10px] text-zinc-500 mt-1.5 flex items-center gap-2 flex-wrap';
  const badge = languageBadge(language);
  const langBadge = document.createElement('span');
  langBadge.className = `font-semibold border rounded px-1 ${badge.classes}`;
  langBadge.textContent = badge.label;
  meta.appendChild(langBadge);

  // Print-tested chip — verified-printable vs. not-yet-tested. Always shown so
  // every tile states its print status (default: "Untested").
  const printChip = document.createElement('span');
  printChip.className = `font-semibold border rounded px-1 ${print.classes}`;
  printChip.textContent = print.label;
  printChip.title = print.title;
  meta.appendChild(printChip);

  // Parametric chip — the headline "special characteristic": this model exposes
  // tweakable knobs. Reinforces the Customizable section at a per-tile glance.
  if (loaded.hasParams) {
    const paramBadge = document.createElement('span');
    paramBadge.className = 'font-semibold border rounded px-1 text-violet-300 border-violet-400/30';
    paramBadge.textContent = '🎛 Parametric';
    paramBadge.title = 'Exposes adjustable parameters — tweak it in the Customize panel';
    meta.appendChild(paramBadge);
  }

  if (loaded.error) {
    const errBadge = document.createElement('span');
    errBadge.className = 'text-red-400';
    errBadge.textContent = 'Failed to load';
    errBadge.title = loaded.error;
    meta.appendChild(errBadge);
  } else if (loaded.payload) {
    const versionCount = loaded.payload.versions?.length ?? 0;
    const versions = document.createElement('span');
    versions.textContent = `${versionCount} version${versionCount !== 1 ? 's' : ''}`;
    meta.appendChild(versions);
  }
  info.appendChild(meta);
  tile.appendChild(info);

  if (loaded.error || !loaded.payload) {
    tile.disabled = true;
  } else {
    const payload = loaded.payload;
    tile.addEventListener('click', () => {
      void callbacks.onLoadEntry(loaded.manifest, payload);
    });
  }

  return tile;
}
