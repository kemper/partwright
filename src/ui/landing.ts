// Landing page — shown when no URL params direct to a specific view.
// "Calm studio" theme: a quiet dark field, an amber→teal gradient headline as
// the lone pop of colour, the voxel-P app-icon mark beside the wordmark, and a
// faux product-frame embed in the hero. Sections (top to bottom):
//   0. Nav — brand lockup, links, theme toggle, Open editor
//   1. Hero — eyebrow, gradient headline, lede, CTAs, trust stats, product frame
//   2. How it works — three numbered steps
//   3. What you can build — featured catalog tiles
//   4. Built for AI agents — copyable prompt + bullets
//   5. Recent sessions (if any)
//   6. Built on / trust band
//   7. Footer

import { listSessions, effectiveVersionLanguage, type Session, type Version } from '../storage/sessionManager';
import { getSessionLatestVersion, getSessionVersionCount } from '../storage/db';
import { partwrightMarkSvg } from './brand';
import { languageBadge } from './languageBadge';
import { showUninstallModal } from './uninstallModal';
import { getTheme, onThemeChange, toggleTheme } from './theme';
import type { ExportedSession } from '../storage/sessionManager';
import type { CatalogManifestEntry } from './catalog';

export interface LandingCallbacks {
  onOpenEditor: () => void;
  onOpenHelp: () => void;
  onOpenCatalog: () => void;
  onOpenWhatsNew: () => void;
  /** Open the editor and launch the first-visit guided tour. */
  onTakeTour: () => void;
  onOpenSession: (sessionId: string) => void;
  /** Load a single catalog entry straight into the editor as a fresh session. */
  onLoadCatalogEntry: (entry: CatalogManifestEntry, payload: ExportedSession) => void | Promise<void>;
}

interface FeaturedCatalogEntry {
  manifest: CatalogManifestEntry;
  thumbnailUrl: string | null;
}

/** Number of catalog entries to show in the "What you can build" section. */
const FEATURED_CATALOG_COUNT = 8;

/** Amber→teal gradient used for the headline accent + primary buttons. */
const GRAD_TEXT = 'background:linear-gradient(115deg,#fcd34d 8%,#2dd4bf 92%);-webkit-background-clip:text;background-clip:text;color:transparent;';
const GRAD_BTN = 'background:linear-gradient(135deg,#fcd34d,#f59e0b);';

/** Fisher-Yates shuffle — returns a new array in random order. */
function shuffleArray<T>(arr: T[]): T[] {
  const copy = arr.slice();
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

export async function createLandingPage(
  container: HTMLElement,
  callbacks: LandingCallbacks,
): Promise<HTMLElement> {
  const page = document.createElement('div');
  page.id = 'landing-page';
  page.className = 'flex flex-col items-center w-full h-full overflow-auto bg-zinc-900 text-zinc-100 relative font-body';

  page.appendChild(buildNav(callbacks));
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

// ---------- 0. Nav ----------

/** Compact theme toggle, placed inside the nav. */
function buildThemeToggle(): HTMLElement {
  const btn = document.createElement('button');
  const base = 'shrink-0 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors border';
  const sync = (theme: 'light' | 'dark') => {
    const on = theme === 'dark';
    btn.className = `${base} ${on
      ? 'bg-white/5 border-zinc-700 text-zinc-300 hover:text-zinc-100'
      : 'bg-zinc-200 border-zinc-300 text-zinc-700 hover:bg-zinc-300'}`;
    btn.textContent = on ? 'Dark' : 'Light';
    btn.title = on ? 'Dark mode on — click to switch to light' : 'Light mode on — click to switch to dark';
    btn.setAttribute('aria-pressed', String(on));
    btn.setAttribute('aria-label', btn.title);
  };
  sync(getTheme());
  btn.addEventListener('click', () => { toggleTheme(); });
  onThemeChange(sync);
  return btn;
}

function buildNav(callbacks: LandingCallbacks): HTMLElement {
  const nav = document.createElement('header');
  nav.className = 'w-full max-w-6xl px-6 py-5 flex items-center justify-between relative z-20';

  // Brand lockup — app-icon tile mark + wordmark. The tile keeps the mark from
  // reading as the leading "P" of "Partwright".
  const brand = document.createElement('div');
  brand.className = 'flex items-center gap-2.5';
  brand.innerHTML = `${partwrightMarkSvg(30)}<span class="font-display font-bold text-lg tracking-tight text-zinc-50">Partwright</span>`;
  nav.appendChild(brand);

  // Center links (desktop only)
  const links = document.createElement('nav');
  links.className = 'hidden md:flex items-center gap-7 text-sm text-zinc-400';
  const navItems: { label: string; onClick: () => void }[] = [
    { label: 'Catalog', onClick: callbacks.onOpenCatalog },
    { label: 'How it works', onClick: callbacks.onOpenHelp },
    { label: 'For AI agents', onClick: scrollToAgentSection },
    { label: "What's new", onClick: callbacks.onOpenWhatsNew },
  ];
  for (const item of navItems) {
    const a = document.createElement('button');
    a.className = 'bg-transparent border-0 cursor-pointer text-zinc-400 hover:text-zinc-100 transition-colors';
    a.textContent = item.label;
    a.addEventListener('click', item.onClick);
    links.appendChild(a);
  }
  nav.appendChild(links);

  // Right cluster — theme toggle + primary CTA
  const right = document.createElement('div');
  right.className = 'flex items-center gap-3';
  right.appendChild(buildThemeToggle());

  const open = document.createElement('button');
  open.className = 'px-4 py-2 rounded-lg text-sm font-semibold text-amber-950 transition-transform hover:-translate-y-px';
  open.setAttribute('style', GRAD_BTN);
  open.textContent = 'Open editor →';
  open.addEventListener('click', callbacks.onOpenEditor);
  right.appendChild(open);

  nav.appendChild(right);
  return nav;
}

// ---------- 1. Hero ----------

function buildHero(callbacks: LandingCallbacks): HTMLElement {
  const hero = document.createElement('section');
  hero.setAttribute('aria-labelledby', 'hero-heading');
  // shrink-0: the page is a fixed-height flex-column scroll container, so the
  // hero must not flex-shrink below its content height. (Avoid overflow-hidden
  // here — it would drop min-height:auto and let the section collapse to 0.)
  hero.className = 'relative w-full shrink-0';

  const field = document.createElement('div');
  field.className = 'pw-calmfield';
  hero.appendChild(field);

  const wrap = document.createElement('div');
  wrap.className = 'relative z-10 w-full max-w-6xl mx-auto px-6 pt-8 pb-16 grid gap-12 md:grid-cols-2 items-center';

  // ----- left column -----
  const left = document.createElement('div');

  // eyebrow — doubles as the "What's new" entry point
  const eyebrow = document.createElement('button');
  eyebrow.className = 'inline-flex items-center gap-2 text-xs text-zinc-300 bg-white/5 hover:bg-white/10 border border-zinc-700 rounded-full px-3.5 py-1.5 mb-6 transition-colors cursor-pointer';
  eyebrow.innerHTML =
    '<span class="text-[10px] font-semibold uppercase tracking-wider text-amber-400">New</span>' +
    '<span>Voxels, BREP solids &amp; image relief</span>' +
    '<span class="text-zinc-500">→</span>';
  eyebrow.addEventListener('click', callbacks.onOpenWhatsNew);
  left.appendChild(eyebrow);

  const h1 = document.createElement('h1');
  h1.id = 'hero-heading';
  h1.className = 'font-display font-extrabold text-5xl md:text-6xl leading-[1.03] tracking-tight text-zinc-50 mb-5';
  h1.innerHTML = `Describe a part.<br>Get a <span style="${GRAD_TEXT}">printable model.</span>`;
  left.appendChild(h1);

  const lede = document.createElement('p');
  lede.className = 'text-lg text-zinc-400 leading-relaxed max-w-xl mb-7';
  lede.textContent =
    'A browser-native parametric CAD studio with a programmatic API built for AI agents. Write JavaScript or OpenSCAD, watch it render live, export print-ready GLB / STL / OBJ / 3MF. No signup, no installs.';
  left.appendChild(lede);

  const ctas = document.createElement('div');
  ctas.className = 'flex flex-wrap gap-3 items-center mb-8';

  const open = document.createElement('button');
  open.className = 'px-6 py-3 rounded-xl text-sm font-semibold text-amber-950 transition-transform hover:-translate-y-px';
  open.setAttribute('style', GRAD_BTN);
  open.textContent = 'Open the editor';
  open.addEventListener('click', callbacks.onOpenEditor);
  ctas.appendChild(open);

  const tour = document.createElement('button');
  tour.className = 'px-6 py-3 rounded-xl bg-white/5 hover:bg-white/10 text-zinc-100 text-sm font-semibold transition-colors border border-zinc-700';
  tour.textContent = 'Take the guided tour';
  tour.addEventListener('click', callbacks.onTakeTour);
  ctas.appendChild(tour);

  const agent = document.createElement('button');
  agent.className = 'px-2 py-3 text-zinc-400 hover:text-zinc-100 text-sm font-medium transition-colors';
  agent.textContent = 'Try with an AI agent →';
  agent.addEventListener('click', () => scrollToAgentSection());
  ctas.appendChild(agent);

  left.appendChild(ctas);

  // trust stats
  const trust = document.createElement('div');
  trust.className = 'flex flex-wrap gap-x-7 gap-y-2 text-sm text-zinc-500';
  const stats: { value: string; label: string }[] = [
    { value: '0', label: 'installs' },
    { value: '4', label: 'engines' },
    { value: '100%', label: 'in-browser' },
    { value: 'GLB · STL · 3MF', label: 'export' },
  ];
  for (const s of stats) {
    const span = document.createElement('span');
    span.innerHTML = `<b class="text-zinc-300 font-semibold">${s.value}</b> ${s.label}`;
    trust.appendChild(span);
  }
  left.appendChild(trust);

  wrap.appendChild(left);

  // ----- right column: faux product frame -----
  wrap.appendChild(buildProductFrame());

  hero.appendChild(wrap);
  return hero;
}

/**
 * A decorative "editor screenshot" — browser chrome with a code pane and an
 * isometric rendered part. Purely visual (the live editor is the real thing).
 */
function buildProductFrame(): HTMLElement {
  const frame = document.createElement('div');
  frame.setAttribute('aria-hidden', 'true');
  frame.className = 'rounded-2xl overflow-hidden border border-zinc-800 bg-[#0c0c0f]';
  frame.style.boxShadow = '0 40px 110px -40px rgba(0,0,0,.75), 0 12px 40px -24px rgba(0,0,0,.7)';
  frame.innerHTML = `
    <div class="flex items-center gap-2 px-3.5 py-2.5 bg-[#141417] border-b border-zinc-800">
      <span style="width:11px;height:11px;border-radius:50%;background:#ef4444;display:inline-block"></span>
      <span style="width:11px;height:11px;border-radius:50%;background:#f59e0b;display:inline-block"></span>
      <span style="width:11px;height:11px;border-radius:50%;background:#22c55e;display:inline-block"></span>
      <span class="pw-codemock" style="margin-left:8px;font-size:12px;color:#52525b">partwright · mounting-bracket</span>
    </div>
    <div class="grid" style="grid-template-columns:1fr 1.1fr;height:320px">
      <div class="pw-codemock" style="padding:16px;font-size:12.5px;line-height:1.7;background:#0a0a0c;border-right:1px solid #1c1c20;overflow:hidden">
<span style="color:#546e7a">// parametric bracket</span><br>
<span style="color:#c792ea">const</span> { <span style="color:#89ddff">Manifold</span> } = api;<br><br>
<span style="color:#c792ea">const</span> <span style="color:#ffcb6b">base</span> = <span style="color:#89ddff">Manifold</span>.<span style="color:#82aaff">cube</span>([<span style="color:#f78c6c">40</span>,<span style="color:#f78c6c">30</span>,<span style="color:#f78c6c">4</span>], <span style="color:#c792ea">true</span>);<br>
<span style="color:#c792ea">const</span> <span style="color:#ffcb6b">wall</span> = <span style="color:#89ddff">Manifold</span>.<span style="color:#82aaff">cube</span>([<span style="color:#f78c6c">40</span>,<span style="color:#f78c6c">4</span>,<span style="color:#f78c6c">24</span>])<br>
&nbsp;&nbsp;.<span style="color:#82aaff">translate</span>([<span style="color:#f78c6c">0</span>,<span style="color:#f78c6c">13</span>,<span style="color:#f78c6c">12</span>]);<br>
<span style="color:#c792ea">const</span> <span style="color:#ffcb6b">bore</span> = <span style="color:#89ddff">Manifold</span>.<span style="color:#82aaff">cylinder</span>(<span style="color:#f78c6c">10</span>,<span style="color:#f78c6c">4</span>,<span style="color:#f78c6c">4</span>,<span style="color:#f78c6c">48</span>);<br><br>
<span style="color:#c792ea">return</span> <span style="color:#ffcb6b">base</span>.<span style="color:#82aaff">add</span>(<span style="color:#ffcb6b">wall</span>)<br>
&nbsp;&nbsp;.<span style="color:#82aaff">subtract</span>(<span style="color:#ffcb6b">bore</span>.<span style="color:#82aaff">translate</span>([<span style="color:#f78c6c">0</span>,<span style="color:#f78c6c">0</span>,<span style="color:#f78c6c">4</span>]));
      </div>
      <div style="position:relative;display:flex;align-items:center;justify-content:center;background:radial-gradient(120% 90% at 50% 18%,#1a2330 0%,#0d1117 55%,#090b0f 100%)">
        <span style="position:absolute;top:12px;left:12px;font-size:11px;font-weight:600;color:#34d399;background:rgba(16,185,129,.12);border:1px solid rgba(16,185,129,.3);border-radius:999px;padding:3px 10px 3px 8px;display:flex;align-items:center;gap:6px"><span style="width:6px;height:6px;border-radius:50%;background:#34d399;display:inline-block"></span>Ready · 1 component</span>
        <span style="position:absolute;top:12px;right:12px;display:flex;gap:5px"><i style="width:16px;height:16px;border-radius:4px;background:#14b8a6;border:1px solid rgba(255,255,255,.15);display:block"></i><i style="width:16px;height:16px;border-radius:4px;background:#f59e0b;border:1px solid rgba(255,255,255,.15);display:block"></i></span>
        <svg width="230" height="230" viewBox="0 0 240 240" aria-hidden="true">
          <defs>
            <linearGradient id="pwf-top" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#5eead4"/><stop offset="1" stop-color="#2dd4bf"/></linearGradient>
            <linearGradient id="pwf-left" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0f766e"/><stop offset="1" stop-color="#115e59"/></linearGradient>
            <linearGradient id="pwf-right" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#14b8a6"/><stop offset="1" stop-color="#0d9488"/></linearGradient>
            <radialGradient id="pwf-floor" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="#1f2a38"/><stop offset="1" stop-color="transparent"/></radialGradient>
          </defs>
          <ellipse cx="120" cy="196" rx="92" ry="26" fill="url(#pwf-floor)"/>
          <polygon points="120,40 208,90 120,140 32,90" fill="url(#pwf-top)"/>
          <polygon points="32,90 120,140 120,196 32,146" fill="url(#pwf-left)"/>
          <polygon points="208,90 120,140 120,196 208,146" fill="url(#pwf-right)"/>
          <ellipse cx="120" cy="90" rx="26" ry="14" fill="#0b3b38"/>
          <ellipse cx="120" cy="90" rx="26" ry="14" fill="none" stroke="#0d9488" stroke-width="1.5"/>
          <path d="M94 90 a26 14 0 0 0 52 0 l0 14 a26 14 0 0 1 -52 0 z" fill="#072a28"/>
          <line x1="120" y1="40" x2="208" y2="90" stroke="#fcd34d" stroke-width="1.5" opacity="0.55"/>
        </svg>
        <span class="pw-codemock" style="position:absolute;bottom:12px;right:14px;font-size:10px;color:#52525b">Z ⊥ · iso</span>
      </div>
    </div>`;
  return frame;
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
      body: 'Geometry compiles in WebAssembly and renders in a Three.js viewport with cross-sections and on-demand multi-angle snapshots.',
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
    num.className = 'pw-codemock text-xs text-teal-400 mb-3';
    num.textContent = step.num;
    card.appendChild(num);

    const t = document.createElement('h3');
    t.className = 'font-display text-base font-semibold text-zinc-100 mb-2';
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
  header.className = 'flex items-center justify-between mb-6';

  const heading = document.createElement('h2');
  heading.id = 'catalog-heading';
  heading.className = 'text-xs font-semibold text-zinc-500 uppercase tracking-widest';
  heading.textContent = 'What you can build';
  header.appendChild(heading);

  const browseAll = document.createElement('button');
  browseAll.className = 'shrink-0 inline-flex items-center gap-1 px-3 py-1.5 rounded-md text-sm font-medium border border-teal-500/60 text-teal-300 hover:bg-teal-500/10 hover:border-teal-400 transition-colors';
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
    grid.appendChild(buildCatalogTile(entry, () => { void loadFeaturedCatalogEntry(entry.manifest, callbacks); }));
  }
  return section;
}

/**
 * Fetch a featured catalog entry's session payload and hand it to the editor.
 * Mirrors the catalog page's load path so clicking a landing tile opens the
 * item directly instead of routing through the full catalog.
 */
async function loadFeaturedCatalogEntry(manifest: CatalogManifestEntry, callbacks: LandingCallbacks): Promise<void> {
  try {
    const res = await fetch(`/catalog/${manifest.file}`, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const payload = await res.json() as ExportedSession;
    await callbacks.onLoadCatalogEntry(manifest, payload);
  } catch {
    // If the entry can't be loaded directly, fall back to the full catalog
    // page so the user still has a path to the content.
    callbacks.onOpenCatalog();
  }
}

async function loadFeaturedCatalogEntries(): Promise<FeaturedCatalogEntry[]> {
  try {
    const res = await fetch('/catalog/manifest.json', { cache: 'no-cache' });
    if (!res.ok) return [];
    const manifest = await res.json() as { entries: CatalogManifestEntry[] };
    const shuffled = shuffleArray(manifest.entries);
    const list = shuffled.slice(0, FEATURED_CATALOG_COUNT);

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

Then navigate to ${origin}/editor and use the window.partwright console API to:

1. Create a session called "Standard Lego Brick"
2. Build a standard 2x4 Lego brick (approximately 31.8mm x 15.8mm x 11.4mm with studs on top and hollow underside with tubes)
3. Save each major step as a version (e.g. v1 - base block, v2 - add studs, v3 - hollow underside with tubes)
4. Use assertions to verify each version is a valid manifold with maxComponents: 1
5. Give me a share link (partwright.getShareLink()) when done so I can open the design`;

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
  subheading.className = 'font-display text-2xl font-bold text-zinc-100 mb-4 leading-tight';
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
    'Headless renderViews/renderView API for all-angle visual verification',
    'Session notes record [REQUIREMENT], [DECISION], [FEEDBACK] for resume',
  ];
  for (const text of bulletItems) {
    const li = document.createElement('li');
    li.className = 'flex items-start gap-2';
    const arrow = document.createElement('span');
    arrow.className = 'text-teal-400 mt-0.5';
    arrow.textContent = '→';
    const span = document.createElement('span');
    span.textContent = text;
    li.appendChild(arrow);
    li.appendChild(span);
    bullets.appendChild(li);
  }
  left.appendChild(bullets);

  const docsLink = document.createElement('a');
  docsLink.className = 'inline-block mt-5 text-sm text-teal-400 hover:text-teal-300 transition-colors';
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
  promptBody.className = 'pw-codemock text-xs leading-relaxed text-zinc-300 px-4 py-3 max-h-72 overflow-auto whitespace-pre-wrap';
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
        getSessionLatestVersion(session.id),
        getSessionVersionCount(session.id),
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
    { label: "What's new", href: '/whats-new' },
    { label: 'How it works', href: '/help' },
    { label: 'Legal', href: '/legal' },
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
  copyright.textContent = `© ${new Date().getFullYear()} Partwright Studio. Source-available · free for non-commercial use.`;
  footer.appendChild(copyright);

  // Low-emphasis "start fresh" escape hatch — discoverable but well out of the
  // primary click path. Opens a modal to delete chosen categories of local
  // data (recovery valve for corruption / schema changes).
  const reset = document.createElement('button');
  reset.type = 'button';
  reset.className = 'mt-2 text-zinc-700 hover:text-red-400 transition-colors';
  reset.textContent = 'Uninstall / start fresh';
  reset.addEventListener('click', () => { void showUninstallModal(); });
  footer.appendChild(reset);

  return footer;
}

// ---------- Session tile (used by Recent Sessions) ----------

function createSessionTile(
  session: Session,
  latestVersion: Version | null,
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

  // Show the latest version's language (per-version since schema 1.8), with
  // session-level fallback. The session can hold mixed languages; this badge
  // shows whichever language the user was last working in. The shared
  // `languageBadge` helper handles the JS / SCAD / BREP colour-coding.
  const sessionLang = effectiveVersionLanguage(latestVersion, session);
  const badge = languageBadge(sessionLang);
  const langBadge = document.createElement('span');
  langBadge.className = `text-[10px] font-semibold border rounded px-1 ${badge.classes}`;
  langBadge.textContent = badge.label;

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
