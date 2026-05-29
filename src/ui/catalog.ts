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
  error: string | null;
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
  intro.textContent = 'Curated premade models. Click a tile to import it as a fresh session you can edit.';
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
        return { manifest: entry, payload, thumbnailUrl, error: null };
      } catch (e) {
        return { manifest: entry, payload: null, thumbnailUrl: null, error: (e as Error).message };
      }
    }),
  );

  status.remove();

  const grid = document.createElement('div');
  grid.className = 'grid gap-4';
  grid.style.gridTemplateColumns = 'repeat(auto-fill, minmax(220px, 1fr))';
  body.appendChild(grid);

  for (const entry of loaded) {
    grid.appendChild(renderTile(entry, callbacks));
  }

  return page;
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
