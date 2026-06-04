// Landing-page entry — loaded ONLY on the landing route ("/") via src/entry.ts.
//
// The landing page is plain static HTML in index.html (the canonical markup).
// This module does NOT re-render it; it *enhances the existing DOM in place*:
//   - fills the "What you can build" + "Your recent sessions" grids (async data)
//   - wires the copy-prompt button and rewrites the prompt to the current origin
// Every other action (open editor, open a session, load a catalog entry, take
// the tour, browse the catalog) is a plain <a href> in the static HTML that
// hard-navigates to a route the app honors on a fresh load — so the multi-
// megabyte app bundle (src/main.ts + Three.js / CodeMirror / manifold) is
// never fetched while you're on the landing page.
//
// The landing page is intentionally dark-only (a "calm studio" marketing
// surface); the light/dark toggle lives in the editor and the other app pages.
//
// IMPORTANT: keep this module's import graph tiny. It may import only
// dependency-free modules (storage/db). Pulling in anything that transitively
// loads the geometry engine, Three.js, or CodeMirror would defeat the split.

import {
  listSessions,
  getSessionLatestVersion,
  getSessionVersionCount,
  type Session,
  type Version,
} from '../storage/db';

/** Minimal shape of a catalog manifest entry (avoids importing ui/catalog). */
interface ManifestEntry {
  id?: string;
  name: string;
  description?: string;
  file: string;
}

/** Number of featured catalog tiles to show (mirrors the static skeleton count). */
const FEATURED_CATALOG_COUNT = 8;

function init(): void {
  enhanceCopyPrompt();
  rewritePromptOrigin();
  void fillCatalog();
  void fillRecentSessions();

  // When the page is restored from the bfcache (e.g. browser Back from the
  // editor), the DOM — including the grids we filled — comes back as-is. The
  // catalog is static, but recent sessions may be stale, so refresh them.
  window.addEventListener('pageshow', (e) => {
    if ((e as PageTransitionEvent).persisted) void fillRecentSessions();
  });
}

// ---------- Copy prompt ----------

function enhanceCopyPrompt(): void {
  const btn = document.getElementById('li-copy-prompt');
  const pre = document.getElementById('li-prompt');
  if (!btn || !pre) return;
  btn.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(pre.textContent ?? '');
      btn.textContent = 'Copied!';
      btn.style.color = '#34d399';
      setTimeout(() => { btn.textContent = 'Copy'; btn.style.color = '#a1a1aa'; }, 1800);
    } catch {
      btn.textContent = 'Copy failed';
      setTimeout(() => { btn.textContent = 'Copy'; }, 1800);
    }
  });
}

/** The static prompt hardcodes the production origin; use the real one so the
 *  URLs are correct on previews / localhost too. */
function rewritePromptOrigin(): void {
  const pre = document.getElementById('li-prompt');
  if (!pre || !pre.textContent) return;
  pre.textContent = pre.textContent.replace(/https:\/\/www\.partwrightstudio\.com/g, window.location.origin);
}

// ---------- Featured catalog ----------

async function fillCatalog(): Promise<void> {
  const grid = document.getElementById('li-catalog-grid');
  if (!grid) return;
  let entries: { manifest: ManifestEntry; thumbnailUrl: string | null }[] = [];
  try {
    const res = await fetch('/catalog/manifest.json', { cache: 'no-cache' });
    if (!res.ok) return; // leave skeletons rather than flashing an error
    const manifest = await res.json() as { entries: ManifestEntry[] };
    const picked = shuffle(manifest.entries).slice(0, FEATURED_CATALOG_COUNT);
    entries = await Promise.all(picked.map(async (m) => {
      try {
        const r = await fetch(`/catalog/${m.file}`, { cache: 'no-cache' });
        if (!r.ok) return { manifest: m, thumbnailUrl: null };
        const payload = await r.json() as { versions?: { thumbnail?: string | null }[] };
        const versions = payload.versions ?? [];
        const latest = versions.length > 0 ? versions[versions.length - 1] : null;
        return { manifest: m, thumbnailUrl: latest?.thumbnail ?? null };
      } catch {
        return { manifest: m, thumbnailUrl: null };
      }
    }));
  } catch {
    return;
  }
  if (entries.length === 0) return;
  grid.replaceChildren(...entries.map(buildCatalogTile));
}

function buildCatalogTile(entry: { manifest: ManifestEntry; thumbnailUrl: string | null }): HTMLElement {
  const tile = document.createElement('a');
  tile.href = `/editor?catalog=${encodeURIComponent(entry.manifest.file)}`;
  tile.setAttribute('style',
    'display:flex;flex-direction:column;border-radius:8px;overflow:hidden;text-decoration:none;' +
    'background:rgba(39,39,42,0.6);border:1px solid #27272a');

  tile.appendChild(buildThumb(entry.thumbnailUrl, entry.manifest.name, '#0c0c0f'));

  const info = document.createElement('div');
  info.setAttribute('style', 'padding:10px 12px;display:flex;flex-direction:column;gap:2px');
  const name = document.createElement('div');
  name.setAttribute('style', 'font-size:14px;font-weight:500;color:#f4f4f5;white-space:nowrap;overflow:hidden;text-overflow:ellipsis');
  name.textContent = entry.manifest.name;
  info.appendChild(name);
  if (entry.manifest.description) {
    const desc = document.createElement('div');
    desc.setAttribute('style', 'font-size:11px;color:#a1a1aa;white-space:nowrap;overflow:hidden;text-overflow:ellipsis');
    desc.textContent = entry.manifest.description;
    info.appendChild(desc);
  }
  tile.appendChild(info);
  return tile;
}

// ---------- Recent sessions ----------

async function fillRecentSessions(): Promise<void> {
  const grid = document.getElementById('li-sessions-grid');
  if (!grid) return;
  let sessions: Session[] = [];
  try {
    sessions = await listSessions();
  } catch {
    return; // leave skeletons
  }

  if (sessions.length === 0) {
    const empty = document.createElement('div');
    empty.setAttribute('style', 'font-size:14px;color:#71717a;padding:8px 0');
    empty.textContent = 'No sessions yet. Open the editor and start building, or use an AI agent to create geometry.';
    grid.replaceChildren(empty);
    return;
  }

  const data = await Promise.all(
    sessions.slice(0, 12).map(async (session) => {
      const [latestVersion, versionCount] = await Promise.all([
        getSessionLatestVersion(session.id).catch(() => null),
        getSessionVersionCount(session.id).catch(() => 0),
      ]);
      return { session, latestVersion, versionCount };
    }),
  );
  grid.replaceChildren(...data.map(d => buildSessionTile(d.session, d.latestVersion, d.versionCount)));
}

function buildSessionTile(session: Session, latest: Version | null, versionCount: number): HTMLElement {
  const tile = document.createElement('a');
  tile.href = `/editor?session=${encodeURIComponent(session.id)}`;
  tile.setAttribute('style',
    'display:flex;flex-direction:column;border-radius:8px;overflow:hidden;text-decoration:none;' +
    'background:#27272a;border:1px solid #3f3f46');

  tile.appendChild(buildThumb(latest?.thumbnail ?? null, session.name, '#1e1e21'));

  const info = document.createElement('div');
  info.setAttribute('style', 'padding:8px 12px');
  const name = document.createElement('div');
  name.setAttribute('style', 'font-size:12px;font-weight:500;color:#f4f4f5;white-space:nowrap;overflow:hidden;text-overflow:ellipsis');
  name.textContent = session.name;
  info.appendChild(name);

  const meta = document.createElement('div');
  meta.setAttribute('style', 'font-size:10px;color:#71717a;margin-top:4px;display:flex;justify-content:space-between;align-items:center;gap:6px');
  const lang = effectiveLanguage(latest, session);
  const badge = languageBadge(lang);
  const badgeEl = document.createElement('span');
  badgeEl.setAttribute('style', `font-weight:600;border:1px solid ${badge.border};color:${badge.color};border-radius:3px;padding:0 4px`);
  badgeEl.textContent = badge.label;
  const count = document.createElement('span');
  count.textContent = `${versionCount} version${versionCount !== 1 ? 's' : ''}`;
  const date = document.createElement('span');
  date.textContent = relativeDate(session.updated);
  meta.append(badgeEl, count, date);
  info.appendChild(meta);

  tile.appendChild(info);
  return tile;
}

// ---------- Shared tile helpers ----------

function buildThumb(src: Blob | string | null, alt: string, bg: string): HTMLElement {
  const thumb = document.createElement('div');
  thumb.setAttribute('style', `width:100%;aspect-ratio:1;background:${bg};display:flex;align-items:center;justify-content:center;overflow:hidden`);
  if (src) {
    const img = document.createElement('img');
    img.setAttribute('style', 'width:100%;height:100%;object-fit:contain');
    img.loading = 'lazy';
    img.alt = alt;
    if (typeof src === 'string') {
      img.src = src;
    } else {
      const url = URL.createObjectURL(src);
      img.src = url;
      img.addEventListener('load', () => URL.revokeObjectURL(url));
      img.addEventListener('error', () => URL.revokeObjectURL(url));
    }
    thumb.appendChild(img);
  } else {
    const placeholder = document.createElement('span');
    placeholder.setAttribute('style', 'font-size:28px;color:#3f3f46');
    placeholder.textContent = '⬡';
    thumb.appendChild(placeholder);
  }
  return thumb;
}

type Lang = 'manifold-js' | 'scad' | 'replicad' | 'voxel';

function effectiveLanguage(version: Version | null, session: Session): Lang {
  return (version?.language ?? session.language ?? 'manifold-js') as Lang;
}

function languageBadge(lang: Lang): { label: string; color: string; border: string } {
  switch (lang) {
    case 'scad': return { label: 'SCAD', color: '#fbbf24', border: 'rgba(245,158,11,0.4)' };
    case 'replicad': return { label: 'BREP', color: '#a78bfa', border: 'rgba(139,92,246,0.4)' };
    case 'voxel': return { label: 'VOX', color: '#5eead4', border: 'rgba(20,184,166,0.4)' };
    default: return { label: 'JS', color: '#7dd3fc', border: 'rgba(56,189,248,0.4)' };
  }
}

function relativeDate(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(timestamp).toLocaleDateString();
}

function shuffle<T>(arr: T[]): T[] {
  const copy = arr.slice();
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
