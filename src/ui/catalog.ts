// Catalog page — a curated grid of premade sessions shipped as static
// `.partwright.json` files in `public/catalog/`. Each tile previews the
// embedded thumbnail (when present) and imports the session on click.

import type { ExportedSession } from '../storage/sessionManager';
import { partwrightMarkSvg } from './brand';
import { languageBadge } from './languageBadge';
import { getTheme, onThemeChange, toggleTheme } from './theme';

export interface CatalogManifestEntry {
  /** Stable id used as a slug; also serves as the manifest dedupe key. */
  id: string;
  /** Display name for the tile. */
  name: string;
  /** Short blurb shown under the name. */
  description?: string;
  /** Path (relative to /catalog/) of the .partwright.json file. */
  file: string;
  /** Optional language hint for the badge before the JSON loads. */
  language?: 'manifold-js' | 'scad' | 'replicad' | 'voxel';
}

interface CatalogManifest {
  entries: CatalogManifestEntry[];
}

export interface CatalogCallbacks {
  onBack: () => void;
  /** Called with the parsed session payload when a tile is clicked. */
  onLoadEntry: (entry: CatalogManifestEntry, payload: ExportedSession) => void | Promise<void>;
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

/** The catalog is sectioned so each tile's reason for being here is obvious.
 *  Categories are mutually exclusive and assigned in {@link categorize}; the
 *  array order is the on-page section order. */
type CategoryId = 'customizable' | 'manifold' | 'sdf' | 'voxel' | 'scad' | 'brep';

interface CategoryDef {
  id: CategoryId;
  title: string;
  blurb: string;
}

const CATEGORIES: CategoryDef[] = [
  { id: 'customizable', title: 'Customizable', blurb: 'Tweak these live with sliders and toggles — open the 🎛 Customize panel in the editor, no code changes needed.' },
  { id: 'manifold', title: 'JavaScript Models', blurb: 'Built with the default manifold-3d mesh API — the everyday JS modeling path.' },
  { id: 'sdf', title: 'Implicit Surfaces (SDF)', blurb: 'Signed-distance-field models via the Sdf builder — gyroids, lattices, and organic blends.' },
  { id: 'voxel', title: 'Voxel Models', blurb: 'Built by painting and baking a voxel grid.' },
  { id: 'scad', title: 'OpenSCAD', blurb: 'Authored in OpenSCAD with the BOSL2 library — gears, threads, and machined parts.' },
  { id: 'brep', title: 'Solid CAD (BREP)', blurb: 'Exact OpenCASCADE solids (replicad) with true fillets and STEP export.' },
];

/** Assign one category per entry. Parametric models lead (it's the trait users
 *  most want to find); otherwise we split by engine, with SDF pulled out of the
 *  manifold-js bucket as its own showcase. */
function categorize(entry: LoadedEntry): CategoryId {
  if (entry.hasParams) return 'customizable';
  const lang = entry.payload?.session.language ?? entry.manifest.language ?? 'manifold-js';
  if (lang === 'scad') return 'scad';
  if (lang === 'replicad') return 'brep';
  if (lang === 'voxel') return 'voxel';
  if (entry.isSDF) return 'sdf';
  return 'manifold';
}

/** Inspect a payload's code for the characteristics that drive categorization
 *  and tile badges. Reads across all versions so a trait declared on any
 *  version still counts. */
function deriveCharacteristics(entry: CatalogManifestEntry, payload: ExportedSession | null): { hasParams: boolean; isSDF: boolean } {
  const code = (payload?.versions ?? []).map(v => v.code ?? '').join('\n');
  const hasParams = /\bapi\.params\s*\(/.test(code);
  // SDF catalog entries reach the surface builder through the `sdf` api
  // namespace — either `api.sdf.…` or, more often, destructured as
  // `const { sdf, Manifold } = api`. Detect both, plus the raw manifold
  // `levelSet`, and fall back to the `sdf-` id prefix so a thumbnail-only or
  // differently-authored entry still classifies.
  const usesSdfApi = /\bapi\.sdf\b/.test(code) || /[{,]\s*sdf\s*[,}]/.test(code);
  const isSDF = usesSdfApi || /\blevelSet\s*\(/.test(code) || /^sdf[-_]/i.test(entry.id);
  return { hasParams, isSDF };
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
    const res = await fetch('/catalog/manifest.json', { cache: 'no-cache' });
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
        const res = await fetch(`/catalog/${entry.file}`, { cache: 'no-cache' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const payload = await res.json() as ExportedSession;
        // Latest version is the highest index; pull thumbnail from it.
        const versions = payload.versions ?? [];
        const latest = versions.length > 0 ? versions[versions.length - 1] : null;
        const thumbnailUrl = latest?.thumbnail ?? null;
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

  return page;
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
  meta.className = 'text-[10px] text-zinc-500 mt-1.5 flex items-center gap-2';
  const lang = loaded.payload?.session.language ?? loaded.manifest.language ?? 'manifold-js';
  const badge = languageBadge(lang);
  const langBadge = document.createElement('span');
  langBadge.className = `font-semibold border rounded px-1 ${badge.classes}`;
  langBadge.textContent = badge.label;
  meta.appendChild(langBadge);

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
