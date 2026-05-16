// Landing page — shown when no URL params direct to a specific view.
// Sections (top to bottom):
//   1. Hero — wordmark, headline, sub, primary/secondary CTAs
//   2. How it works — three numbered steps
//   3. What you can build — featured catalog tiles
//   4. Built for AI agents — copyable prompt + bullets
//   5. Recent sessions (if any)
//   6. Built on / trust band
//   7. Footer

import { listSessions, type Session } from '../storage/sessionManager';
import { getLatestVersion, getVersionCount } from '../storage/db';
import { partwrightMarkSvg } from './brand';
import { getTheme, onThemeChange, toggleTheme } from './theme';
import type { ExportedSession } from '../storage/sessionManager';

export interface LandingCallbacks {
  onOpenEditor: () => void;
  onOpenHelp: () => void;
  onOpenCatalog: () => void;
  onOpenSession: (sessionId: string) => void;
}

interface CatalogManifestEntry {
  id: string;
  name: string;
  file: string;
  language?: 'manifold-js' | 'scad';
  description?: string;
}

interface FeaturedCatalogEntry {
  manifest: CatalogManifestEntry;
  thumbnailUrl: string | null;
}

const FEATURED_CATALOG_IDS = ['twisted-vase', 'retro-rocket', 'chess-rook', 'christmas-tree'];

export async function createLandingPage(
  container: HTMLElement,
  callbacks: LandingCallbacks,
): Promise<HTMLElement> {
  const page = document.createElement('div');
  page.id = 'landing-page';
  page.className = 'flex flex-col items-center w-full h-full overflow-auto bg-zinc-900 text-zinc-100 relative';

  page.appendChild(buildThemeToggle());
  page.appendChild(buildHero(callbacks));
  page.appendChild(buildHowItWorks());
  page.appendChild(await buildFeaturedCatalog(callbacks));
  page.appendChild(buildAgentSection());
  page.appendChild(await buildRecentSessions(callbacks));
  page.appendChild(buildBuiltOn());
  page.appendChild(buildFooter());

  container.appendChild(page);
  return page;
}

// ---------- 0. Theme toggle ----------

function buildThemeToggle(): HTMLElement {
  const btn = document.createElement('button');
  btn.textContent = 'Dark Mode';
  const active = 'absolute top-4 right-4 px-3 py-1 rounded text-xs font-medium transition-colors bg-zinc-700 text-zinc-100 z-10';
  const inactive = 'absolute top-4 right-4 px-3 py-1 rounded text-xs font-medium transition-colors text-zinc-500 hover:text-zinc-300 border border-zinc-600 z-10';
  const sync = (theme: 'light' | 'dark') => {
    const on = theme === 'dark';
    btn.className = on ? active : inactive;
    btn.title = on ? 'Dark mode on — click to switch to light' : 'Dark mode off — click to switch to dark';
    btn.setAttribute('aria-pressed', String(on));
    btn.setAttribute('aria-label', btn.title);
  };
  sync(getTheme());
  btn.addEventListener('click', () => { toggleTheme(); });
  onThemeChange(sync);
  return btn;
}

// ---------- 1. Hero ----------

function buildHero(callbacks: LandingCallbacks): HTMLElement {
  const hero = document.createElement('section');
  hero.setAttribute('aria-labelledby', 'hero-heading');
  hero.className = 'flex flex-col items-center text-center pt-20 pb-12 px-6 max-w-3xl';

  const mark = document.createElement('div');
  mark.className = 'flex items-center gap-4 mb-4';
  mark.innerHTML = `${partwrightMarkSvg(56)}<h1 id="hero-heading" class="text-5xl font-bold tracking-tight">Partwright</h1>`;
  hero.appendChild(mark);

  const tagline = document.createElement('p');
  tagline.className = 'text-xl text-zinc-300 mb-3 font-medium';
  tagline.textContent = 'AI-driven parametric CAD in your browser';
  hero.appendChild(tagline);

  const desc = document.createElement('p');
  desc.className = 'text-base text-zinc-400 mb-8 max-w-xl leading-relaxed';
  desc.textContent =
    'Describe a part, get a printable 3D model. Partwright runs entirely in your browser, with a programmatic API designed for AI agents. No signup, no installs — powered by manifold-3d.';
  hero.appendChild(desc);

  const ctas = document.createElement('div');
  ctas.className = 'flex flex-wrap gap-3 justify-center';

  const open = document.createElement('button');
  open.className = 'px-6 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold transition-colors';
  open.textContent = 'Open editor';
  open.addEventListener('click', callbacks.onOpenEditor);
  ctas.appendChild(open);

  const tryAgent = document.createElement('button');
  tryAgent.className = 'px-6 py-2.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-100 text-sm font-semibold transition-colors border border-zinc-700';
  tryAgent.textContent = 'Try with an AI agent';
  tryAgent.addEventListener('click', () => scrollToAgentSection());
  ctas.appendChild(tryAgent);

  const help = document.createElement('button');
  help.className = 'px-6 py-2.5 rounded-lg bg-transparent hover:bg-zinc-800 text-zinc-400 text-sm font-medium transition-colors';
  help.textContent = 'How does this work?';
  help.addEventListener('click', callbacks.onOpenHelp);
  ctas.appendChild(help);

  hero.appendChild(ctas);

  // Sub-hero feature pills
  const pills = document.createElement('div');
  pills.className = 'flex flex-wrap justify-center gap-2 mt-8';
  const pillItems = [
    'JavaScript + OpenSCAD',
    'manifold-3d engine',
    'No backend',
    'GLB / STL / OBJ / 3MF export',
  ];
  for (const text of pillItems) {
    const pill = document.createElement('span');
    pill.className = 'text-xs text-zinc-500 border border-zinc-800 rounded-full px-3 py-1';
    pill.textContent = text;
    pills.appendChild(pill);
  }
  hero.appendChild(pills);

  return hero;
}

// ---------- 2. How it works ----------

function buildHowItWorks(): HTMLElement {
  const section = document.createElement('section');
  section.setAttribute('aria-labelledby', 'how-heading');
  section.className = 'w-full max-w-5xl px-6 py-12 border-t border-zinc-800';

  const heading = document.createElement('h2');
  heading.id = 'how-heading';
  heading.className = 'text-xs font-semibold text-zinc-500 uppercase tracking-widest text-center mb-10';
  heading.textContent = 'How it works';
  section.appendChild(heading);

  const grid = document.createElement('div');
  grid.className = 'grid gap-6 md:grid-cols-3';

  const steps: { num: string; title: string; body: string }[] = [
    {
      num: '01',
      title: 'Write or prompt',
      body: 'Type code in the editor, or let an AI agent drive it. Both engines (manifold-js, OpenSCAD) work the same way.',
    },
    {
      num: '02',
      title: 'Render live',
      body: 'Geometry compiles in WebAssembly and renders in a Three.js viewport with multi-view, sections, and elevations.',
    },
    {
      num: '03',
      title: 'Verify & export',
      body: 'Sessions track every iteration with thumbnails and stats. Export GLB, STL, OBJ, or 3MF when ready.',
    },
  ];

  for (const step of steps) {
    const card = document.createElement('div');
    card.className = 'bg-zinc-800/40 border border-zinc-800 rounded-xl p-6';

    const num = document.createElement('div');
    num.className = 'text-xs font-mono text-blue-400 mb-3';
    num.textContent = step.num;
    card.appendChild(num);

    const t = document.createElement('h3');
    t.className = 'text-base font-semibold text-zinc-100 mb-2';
    t.textContent = step.title;
    card.appendChild(t);

    const body = document.createElement('p');
    body.className = 'text-sm text-zinc-400 leading-relaxed';
    body.textContent = step.body;
    card.appendChild(body);

    grid.appendChild(card);
  }

  section.appendChild(grid);
  return section;
}

// ---------- 3. Featured catalog ----------

async function buildFeaturedCatalog(callbacks: LandingCallbacks): Promise<HTMLElement> {
  const section = document.createElement('section');
  section.setAttribute('aria-labelledby', 'catalog-heading');
  section.className = 'w-full max-w-5xl px-6 py-12 border-t border-zinc-800';

  const header = document.createElement('div');
  header.className = 'flex items-baseline justify-between mb-6';

  const heading = document.createElement('h2');
  heading.id = 'catalog-heading';
  heading.className = 'text-xs font-semibold text-zinc-500 uppercase tracking-widest';
  heading.textContent = 'What you can build';
  header.appendChild(heading);

  const browseAll = document.createElement('button');
  browseAll.className = 'text-xs text-blue-400 hover:text-blue-300 transition-colors';
  browseAll.textContent = 'Browse the full catalog →';
  browseAll.addEventListener('click', callbacks.onOpenCatalog);
  header.appendChild(browseAll);

  section.appendChild(header);

  const grid = document.createElement('div');
  grid.className = 'grid gap-3';
  grid.style.gridTemplateColumns = 'repeat(auto-fill, minmax(200px, 1fr))';
  section.appendChild(grid);

  const entries = await loadFeaturedCatalogEntries();
  if (entries.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'text-sm text-zinc-500 text-center py-6';
    empty.textContent = 'Catalog unavailable.';
    section.appendChild(empty);
    return section;
  }

  for (const entry of entries) {
    grid.appendChild(buildCatalogTile(entry, callbacks.onOpenCatalog));
  }
  return section;
}

async function loadFeaturedCatalogEntries(): Promise<FeaturedCatalogEntry[]> {
  try {
    const res = await fetch('/catalog/manifest.json', { cache: 'no-cache' });
    if (!res.ok) return [];
    const manifest = await res.json() as { entries: CatalogManifestEntry[] };
    const byId = new Map(manifest.entries.map(e => [e.id, e]));
    const featured = FEATURED_CATALOG_IDS
      .map(id => byId.get(id))
      .filter((e): e is CatalogManifestEntry => Boolean(e));
    const list = featured.length > 0 ? featured : manifest.entries.slice(0, 4);

    return await Promise.all(list.map(async (manifestEntry) => {
      try {
        const r = await fetch(`/catalog/${manifestEntry.file}`, { cache: 'no-cache' });
        if (!r.ok) return { manifest: manifestEntry, thumbnailUrl: null };
        const payload = await r.json() as ExportedSession;
        const versions = payload.versions ?? [];
        const latest = versions.length > 0 ? versions[versions.length - 1] : null;
        return { manifest: manifestEntry, thumbnailUrl: latest?.thumbnail ?? null };
      } catch {
        return { manifest: manifestEntry, thumbnailUrl: null };
      }
    }));
  } catch {
    return [];
  }
}

function buildCatalogTile(entry: FeaturedCatalogEntry, onOpen: () => void): HTMLElement {
  const tile = document.createElement('button');
  tile.className = 'flex flex-col bg-zinc-800/60 rounded-lg border border-zinc-800 hover:border-zinc-600 transition-colors overflow-hidden text-left cursor-pointer';
  tile.addEventListener('click', onOpen);

  const thumb = document.createElement('div');
  thumb.className = 'w-full aspect-square bg-zinc-900/50 flex items-center justify-center overflow-hidden';
  if (entry.thumbnailUrl) {
    const img = document.createElement('img');
    img.className = 'w-full h-full object-contain';
    img.src = entry.thumbnailUrl;
    img.alt = entry.manifest.name;
    img.loading = 'lazy';
    thumb.appendChild(img);
  } else {
    const placeholder = document.createElement('span');
    placeholder.className = 'text-3xl text-zinc-700';
    placeholder.textContent = '⬡';
    thumb.appendChild(placeholder);
  }
  tile.appendChild(thumb);

  const info = document.createElement('div');
  info.className = 'px-3 py-2.5';
  const name = document.createElement('div');
  name.className = 'text-sm font-medium text-zinc-100 truncate';
  name.textContent = entry.manifest.name;
  info.appendChild(name);
  if (entry.manifest.description) {
    const desc = document.createElement('div');
    desc.className = 'text-[11px] text-zinc-400 mt-0.5 line-clamp-2 leading-snug';
    desc.textContent = entry.manifest.description;
    info.appendChild(desc);
  }
  tile.appendChild(info);

  return tile;
}

// ---------- 4. Built for AI agents ----------

const AGENT_PROMPT_TEMPLATE = (origin: string) =>
  `Read the AI agent instructions at ${origin}/ai.md to understand how to use this tool.

Then navigate to ${origin}/editor?view=ai and use the window.partwright console API to:

1. Create a session called "Standard Lego Brick"
2. Build a standard 2x4 Lego brick (approximately 31.8mm x 15.8mm x 11.4mm with studs on top and hollow underside with tubes)
3. Save each major step as a version (e.g. v1 - base block, v2 - add studs, v3 - hollow underside with tubes)
4. Use assertions to verify each version is a valid manifold with maxComponents: 1
5. Give me the gallery URL when done so I can review the versions`;

function buildAgentSection(): HTMLElement {
  const section = document.createElement('section');
  section.id = 'agent-section';
  section.setAttribute('aria-labelledby', 'agent-heading');
  section.className = 'w-full max-w-5xl px-6 py-14 border-t border-zinc-800';

  const grid = document.createElement('div');
  grid.className = 'grid gap-8 md:grid-cols-2 items-start';

  // Left column — pitch
  const left = document.createElement('div');

  const heading = document.createElement('h2');
  heading.id = 'agent-heading';
  heading.className = 'text-xs font-semibold text-zinc-500 uppercase tracking-widest mb-3';
  heading.textContent = 'Built for AI agents';
  left.appendChild(heading);

  const subheading = document.createElement('h3');
  subheading.className = 'text-2xl font-bold text-zinc-100 mb-4 leading-tight';
  subheading.textContent = 'Hand the keyboard to your agent.';
  left.appendChild(subheading);

  const body = document.createElement('p');
  body.className = 'text-sm text-zinc-400 leading-relaxed mb-5';
  body.textContent =
    'Most CAD tools assume a human at the mouse. Partwright is built around a programmatic API so an agent can model, verify, iterate, and hand you a gallery for review — no clicks required.';
  left.appendChild(body);

  const bullets = document.createElement('ul');
  bullets.className = 'space-y-2 text-sm text-zinc-300';
  const bulletItems = [
    'window.partwright console API for sessions, runs, validation, exports',
    'Geometry stats published as JSON in #geometry-data for verification',
    'AI-friendly URLs: /editor?view=ai opens with all elevations visible',
    'Session notes record [REQUIREMENT], [DECISION], [FEEDBACK] for resume',
  ];
  for (const text of bulletItems) {
    const li = document.createElement('li');
    li.className = 'flex items-start gap-2';
    const arrow = document.createElement('span');
    arrow.className = 'text-blue-400 mt-0.5';
    arrow.textContent = '→';
    const span = document.createElement('span');
    span.textContent = text;
    li.appendChild(arrow);
    li.appendChild(span);
    bullets.appendChild(li);
  }
  left.appendChild(bullets);

  const docsLink = document.createElement('a');
  docsLink.className = 'inline-block mt-5 text-sm text-blue-400 hover:text-blue-300 transition-colors';
  docsLink.href = '/ai.md';
  docsLink.textContent = 'Read the agent instructions →';
  left.appendChild(docsLink);

  grid.appendChild(left);

  // Right column — copyable prompt
  const right = document.createElement('div');
  right.className = 'bg-zinc-950 border border-zinc-800 rounded-xl overflow-hidden';

  const promptHeader = document.createElement('div');
  promptHeader.className = 'flex items-center justify-between px-4 py-2 border-b border-zinc-800 bg-zinc-900';

  const label = document.createElement('span');
  label.className = 'text-xs font-medium text-zinc-400';
  label.textContent = 'Try this prompt with Claude / ChatGPT';
  promptHeader.appendChild(label);

  const copyBtn = document.createElement('button');
  copyBtn.className = 'text-xs text-zinc-400 hover:text-zinc-100 transition-colors flex items-center gap-1';
  copyBtn.textContent = 'Copy';
  promptHeader.appendChild(copyBtn);

  right.appendChild(promptHeader);

  const promptBody = document.createElement('pre');
  promptBody.className = 'text-xs leading-relaxed text-zinc-300 px-4 py-3 max-h-72 overflow-auto whitespace-pre-wrap font-mono';
  const promptText = AGENT_PROMPT_TEMPLATE(window.location.origin);
  promptBody.textContent = promptText;
  right.appendChild(promptBody);

  copyBtn.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(promptText);
      copyBtn.textContent = 'Copied!';
      copyBtn.classList.add('text-emerald-400');
      setTimeout(() => {
        copyBtn.textContent = 'Copy';
        copyBtn.classList.remove('text-emerald-400');
      }, 1800);
    } catch {
      copyBtn.textContent = 'Copy failed';
      setTimeout(() => { copyBtn.textContent = 'Copy'; }, 1800);
    }
  });

  grid.appendChild(right);
  section.appendChild(grid);
  return section;
}

function scrollToAgentSection(): void {
  const target = document.getElementById('agent-section');
  if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ---------- 5. Recent sessions ----------

async function buildRecentSessions(callbacks: LandingCallbacks): Promise<HTMLElement> {
  const section = document.createElement('section');
  section.setAttribute('aria-labelledby', 'sessions-heading');
  section.className = 'w-full max-w-5xl px-6 py-12 border-t border-zinc-800';

  const heading = document.createElement('h2');
  heading.id = 'sessions-heading';
  heading.className = 'text-xs font-semibold text-zinc-500 uppercase tracking-widest mb-4';
  heading.textContent = 'Your recent sessions';
  section.appendChild(heading);

  const sessions = await listSessions();
  if (sessions.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'text-sm text-zinc-500 py-4';
    empty.textContent = 'No sessions yet. Open the editor and start building, or use an AI agent to create geometry.';
    section.appendChild(empty);
    return section;
  }

  const grid = document.createElement('div');
  grid.className = 'grid gap-3';
  grid.style.gridTemplateColumns = 'repeat(auto-fill, minmax(220px, 1fr))';

  const tileData = await Promise.all(
    sessions.slice(0, 12).map(async (session) => {
      const [latestVersion, versionCount] = await Promise.all([
        getLatestVersion(session.id),
        getVersionCount(session.id),
      ]);
      return { session, latestVersion, versionCount };
    }),
  );

  for (const { session, latestVersion, versionCount } of tileData) {
    grid.appendChild(createSessionTile(session, latestVersion, versionCount, callbacks.onOpenSession));
  }

  section.appendChild(grid);
  return section;
}

// ---------- 6. Built on / trust band ----------

function buildBuiltOn(): HTMLElement {
  const section = document.createElement('section');
  section.setAttribute('aria-labelledby', 'built-on-heading');
  section.className = 'w-full max-w-5xl px-6 py-12 border-t border-zinc-800';

  const heading = document.createElement('h2');
  heading.id = 'built-on-heading';
  heading.className = 'text-xs font-semibold text-zinc-500 uppercase tracking-widest text-center mb-6';
  heading.textContent = 'Built on open foundations';
  section.appendChild(heading);

  const items = document.createElement('div');
  items.className = 'flex flex-wrap justify-center gap-x-8 gap-y-3 text-sm text-zinc-400';

  const links: { label: string; href: string }[] = [
    { label: 'manifold-3d', href: 'https://github.com/elalish/manifold' },
    { label: 'Three.js', href: 'https://threejs.org/' },
    { label: 'CodeMirror', href: 'https://codemirror.net/' },
    { label: 'OpenSCAD WASM', href: 'https://github.com/openscad/openscad' },
    { label: 'Cloudflare Pages', href: 'https://pages.cloudflare.com/' },
  ];

  for (const link of links) {
    const a = document.createElement('a');
    a.href = link.href;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.className = 'hover:text-zinc-100 transition-colors';
    a.textContent = link.label;
    items.appendChild(a);
  }

  section.appendChild(items);

  const trust = document.createElement('p');
  trust.className = 'text-center text-xs text-zinc-600 mt-6 max-w-xl mx-auto leading-relaxed';
  trust.textContent =
    'No backend, no analytics, no outbound network requests. Everything runs in your browser, and you can verify the source on GitHub.';
  section.appendChild(trust);

  return section;
}

// ---------- 7. Footer ----------

function buildFooter(): HTMLElement {
  const footer = document.createElement('footer');
  footer.className = 'w-full max-w-5xl px-6 py-8 border-t border-zinc-800 text-center text-xs text-zinc-600';

  const links = document.createElement('div');
  links.className = 'flex flex-wrap justify-center gap-x-5 gap-y-2 mb-3';

  const items: { label: string; href: string; external?: boolean }[] = [
    { label: 'Editor', href: '/editor' },
    { label: 'Catalog', href: '/catalog' },
    { label: 'How it works', href: '/help' },
    { label: 'AI agent docs', href: '/ai.md' },
    { label: 'GitHub', href: 'https://github.com/kemper/mainifold', external: true },
  ];

  for (const item of items) {
    const a = document.createElement('a');
    a.href = item.href;
    a.className = 'text-zinc-500 hover:text-zinc-300 transition-colors';
    a.textContent = item.label;
    if (item.external) {
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
    }
    links.appendChild(a);
  }
  footer.appendChild(links);

  const copyright = document.createElement('div');
  copyright.textContent = `© ${new Date().getFullYear()} Partwright. Open source.`;
  footer.appendChild(copyright);

  return footer;
}

// ---------- Session tile (used by Recent Sessions) ----------

function createSessionTile(
  session: Session,
  latestVersion: { thumbnail: Blob | null; label: string; geometryData: Record<string, unknown> | null } | null,
  versionCount: number,
  onOpen: (id: string) => void,
): HTMLElement {
  const tile = document.createElement('button');
  tile.className = 'flex flex-col bg-zinc-800 rounded-lg border border-zinc-700 hover:border-zinc-500 transition-colors overflow-hidden text-left cursor-pointer';
  tile.addEventListener('click', () => onOpen(session.id));

  const thumbContainer = document.createElement('div');
  thumbContainer.className = 'w-full aspect-square bg-zinc-800 flex items-center justify-center overflow-hidden';

  if (latestVersion?.thumbnail) {
    const img = document.createElement('img');
    img.className = 'w-full h-full object-contain';
    img.src = URL.createObjectURL(latestVersion.thumbnail);
    img.loading = 'lazy';
    img.alt = session.name;
    img.addEventListener('load', () => URL.revokeObjectURL(img.src));
    thumbContainer.appendChild(img);
  } else {
    const placeholder = document.createElement('span');
    placeholder.className = 'text-3xl text-zinc-700';
    placeholder.textContent = '⬡';
    thumbContainer.appendChild(placeholder);
  }

  tile.appendChild(thumbContainer);

  const info = document.createElement('div');
  info.className = 'px-3 py-2';

  const name = document.createElement('div');
  name.className = 'text-xs font-medium text-zinc-200 truncate';
  name.textContent = session.name;

  const meta = document.createElement('div');
  meta.className = 'text-xs text-zinc-500 mt-1 flex justify-between';

  const langLabel = session.language === 'scad' ? 'SCAD' : 'JS';
  const langColor = session.language === 'scad' ? 'text-amber-400 border-amber-400/30' : 'text-blue-400 border-blue-400/30';
  const langBadge = document.createElement('span');
  langBadge.className = `text-[10px] font-semibold border rounded px-1 ${langColor}`;
  langBadge.textContent = langLabel;

  const versions = document.createElement('span');
  versions.textContent = `${versionCount} version${versionCount !== 1 ? 's' : ''}`;

  const date = document.createElement('span');
  date.textContent = formatRelativeDate(session.updated);

  meta.appendChild(langBadge);
  meta.appendChild(versions);
  meta.appendChild(date);

  info.appendChild(name);
  info.appendChild(meta);
  tile.appendChild(info);

  return tile;
}

function formatRelativeDate(timestamp: number): string {
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
