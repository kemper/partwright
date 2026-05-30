// "What's new" page — a succinct, human-readable changelog of recently shipped
// features, grouped by week (most recent first). This is curated by hand (not
// generated from git) so it reads as release notes rather than a commit dump.
// When you ship a notable user-facing feature, add a bullet to the most recent
// week's entry here (and to public/llms.txt / the help page if it warrants it).

import { partwrightMarkSvg } from './brand';
import { getTheme, onThemeChange, toggleTheme } from './theme';

export interface WhatsNewCallbacks {
  onBack: () => void;
  onOpenEditor: () => void;
}

/** A themed cluster of bullets within a week (e.g. "Modeling", "Painting"). */
interface FeatureGroup {
  /** Short category label, or null for an un-labeled lead group. */
  label: string | null;
  items: { title: string; body: string }[];
}

interface WeekEntry {
  /** Human date range, e.g. "May 25 – 29, 2026". */
  range: string;
  /** One-line theme for the week. */
  headline: string;
  groups: FeatureGroup[];
}

// Most recent first. Each entry is a calendar week (Mon–Sun) of shipped work.
const WEEKS: WeekEntry[] = [
  {
    range: 'May 29 – 30, 2026',
    headline: 'AI slash commands, custom endpoints, and auto-continue',
    groups: [
      {
        label: 'AI assistant',
        items: [
          {
            title: 'Slash commands',
            body: 'Type / in the AI chat input to get a pop-up menu of quick commands (keyboard-navigable, floats above the input, only fires when the selection is unambiguous).',
          },
          {
            title: 'Custom OpenAI-compatible endpoint',
            body: 'Point the built-in AI at any self-hosted OpenAI-compatible server — llama.cpp, vLLM, LM Studio, and similar — by setting a base URL and model name. The API key is optional; the CSP now passes traffic through to custom origins.',
          },
          {
            title: 'Auto-continue (♾)',
            body: 'A new ♾ toggle makes the agent keep working across multiple turns until it explicitly calls a finish tool, instead of stopping at every end_turn. On by default in Standard and Full presets; bounded by the existing iteration and spend caps. Toggle state is remembered across reloads.',
          },
        ],
      },
      {
        label: 'Import',
        items: [
          {
            title: 'Import session from URL',
            body: 'Paste a URL that resolves to a .partwright.json and it loads directly — no download-then-upload step. The import target modal (new part / add to current / new session) applies as usual.',
          },
        ],
      },
      {
        label: 'Voxel',
        items: [
          {
            title: 'Improved image import',
            body: 'The voxel image-import wizard is now modal-first with a custom palette picker and editable JavaScript codegen — tweak the generated code before it lands in the editor. Repeated voxel groups collapse into compact for-loops automatically.',
          },
        ],
      },
      {
        label: 'Branding',
        items: [
          {
            title: 'New voxel-P logo and landing theme',
            body: 'A pixel-art voxel P mark replaces the old logo across the app; the landing page now uses a calmer, studio-style theme.',
          },
        ],
      },
    ],
  },
  {
    range: 'May 25 – 29, 2026',
    headline: 'New modeling engines, image relief, and sharing',
    groups: [
      {
        label: 'New ways to model',
        items: [
          {
            title: 'Voxel engine',
            body: 'A brand-new voxel modeling language — build from cubes, import an image as voxels or load a .vox file, paint individual voxels, and surface the result with rounded edges. Includes cylinder, mirror, translate, and hollow operations.',
          },
          {
            title: 'BREP solids (OpenCASCADE)',
            body: 'True solid modeling via replicad: selective edge fillets and chamfers, STEP import and export, plus cone, torus, revolve, shell, and linear/circular patterns. Reach it from api.BREP.* inside a JavaScript session, or switch a session fully to the BREP language.',
          },
          {
            title: 'Signed-distance fields (api.sdf)',
            body: 'Model with SDF primitives and combinators, including a TPMS family (gyroid and friends), polarRepeat / repeatN tiling, and smooth boolean blends — great for organic and lattice geometry.',
          },
          {
            title: 'Customizer parameters (api.params)',
            body: 'Declare tunable parameters in your code and adjust them from a parameter panel without editing the source.',
          },
        ],
      },
      {
        label: 'Relief Studio',
        items: [
          {
            title: 'Image-to-relief wizard',
            body: 'A HueForge-style studio turns a photo into a painted relief, with a guided 2-column wizard, 512px resolution, crop, a live 3D preview, and remembered recents.',
          },
          {
            title: 'Stepped relief & tiles',
            body: 'Z-banded stepped relief that prints faithfully on a single nozzle (with an invert-heights toggle), plus flat-color, silhouette, and SVG tile inputs, tile chamfers, and freely-positioned keychain holes.',
          },
        ],
      },
      {
        label: 'Painting',
        items: [
          {
            title: 'Geodesic & airbrush tools',
            body: 'A surface-following brush with curvature-adaptive refinement and boundary-conforming edges, plus a dither-spray airbrush that stays on the connected surface.',
          },
          {
            title: 'Paint by name (api.label)',
            body: 'Label regions directly in code (JavaScript and OpenSCAD) and paint them by name — and model-declared colors now export to 3MF and OBJ. The palette editor recolors regions in place.',
          },
        ],
      },
      {
        label: 'Sharing & sessions',
        items: [
          {
            title: 'Shareable session links',
            body: 'Generate a fully client-side link that opens a read-only preview of your model — anyone can view it and fork it into their own editable session. No server, nothing uploaded.',
          },
          {
            title: 'Multi-select parts',
            body: 'Select multiple parts in the rail to bulk-delete or merge them into one, and import external meshes as new parts.',
          },
        ],
      },
      {
        label: 'Catalog',
        items: [
          {
            title: 'Dozens of new models',
            body: 'Colored BREP showcases (Robot Buddy, Bird Feeder, pendant lamp, vintage camera, wall clock, coffee mug, lighthouse), BOSL2 OpenSCAD entries, SDF showcases, and new parametric models.',
          },
        ],
      },
    ],
  },
  {
    range: 'May 18 – 24, 2026',
    headline: 'Workspace overhaul, smoother painting, and AI controls',
    groups: [
      {
        label: 'Workspace & layout',
        items: [
          {
            title: 'Activity rail & unified sidebar',
            body: 'The old tab strip became a labeled activity rail, with Workspace and Parts stacked into a single left sidebar and the session switcher moved into the rail header.',
          },
          {
            title: 'Docked, resizable AI panel',
            body: 'The AI assistant now opens by default as a persistent, resizable layout column, with the toggle strip tidied behind an Options disclosure.',
          },
          {
            title: 'Command palette & shortcuts',
            body: 'Press ⌘K / Ctrl+K for a searchable command palette, and ? for a keyboard cheat sheet. Added OS-aware undo / redo / save shortcuts and faster custom tooltips.',
          },
          {
            title: 'Multi-part sessions',
            body: 'Hold multiple objects in one session via an IDE-style parts rail with per-part geometry previews.',
          },
          {
            title: 'Versions tab & About dialog',
            body: 'A dedicated Versions tab with thumbnail previews in the session list, plus an About dialog showing build and version info.',
          },
          {
            title: 'Editor niceties',
            body: 'Autocomplete for the manifold-js API and a mesh-edge (wireframe) viewport toggle.',
          },
        ],
      },
      {
        label: 'Painting & meshes',
        items: [
          {
            title: 'Smooth paintbrush',
            body: 'A smooth brush with adaptive edge subdivision (offloaded to a Web Worker with a Cancel button), a detail slider, and smooth edges for slab and shape painting.',
          },
          {
            title: 'Simplify tool',
            body: 'Reduce a model’s triangle count behind an Apply button with a progress bar; the original mesh is preserved when you save a simplified version.',
          },
        ],
      },
      {
        label: 'AI assistant',
        items: [
          {
            title: 'Per-session thinking level',
            body: 'A 🧠 control sets the reasoning effort across cloud providers, with a collapsible thinking box for models that expose their reasoning.',
          },
          {
            title: 'Upgraded render views',
            body: 'A reworked renderViews replaces the old Views/Elevations tabs, and budget presets gained render-resolution, angle, and notes knobs.',
          },
        ],
      },
      {
        label: 'Quality & viewing',
        items: [
          {
            title: 'Ultra quality tier',
            body: 'A new Ultra (1024-segment) preset plus custom segment counts; the quality preset now drives curve smoothness everywhere.',
          },
          {
            title: 'Read-only viewer mode',
            body: 'A dim-overlay viewer mode with reliable, reload-based take-control for shared tabs.',
          },
        ],
      },
      {
        label: 'Catalog',
        items: [
          {
            title: '20+ colorized models',
            body: 'New gallery models across game, medieval, and retro themes, with clean hero thumbnails and a randomized featured catalog on the landing page.',
          },
        ],
      },
    ],
  },
  {
    range: 'April 2026',
    headline: 'Launch & foundations',
    groups: [
      {
        label: null,
        items: [
          {
            title: 'Browser-based parametric CAD',
            body: 'The first releases: a live code editor, a Three.js viewport, sessions with versioning, and GLB / STL / OBJ / 3MF export — all powered by manifold-3d, running entirely in the browser.',
          },
          {
            title: 'Built for AI agents',
            body: 'The window.partwright console API (with the legacy window.mainifold alias), session-context notes for resuming work, and the /ai.md agent reference, refined for agent discoverability.',
          },
          {
            title: 'Onboarding',
            body: 'A first-visit guided tour, auto-created sessions, and an auto-run toggle so geometry re-renders as you type.',
          },
          {
            title: 'Infrastructure',
            body: 'A staging → production deployment pipeline, CSP and security hardening, and social-preview images.',
          },
        ],
      },
    ],
  },
];

export function createWhatsNewPage(
  container: HTMLElement,
  callbacks: WhatsNewCallbacks,
): HTMLElement {
  const page = document.createElement('div');
  page.id = 'whats-new-page';
  page.className = 'flex flex-col items-center w-full h-full overflow-auto bg-zinc-900 text-zinc-100 relative';

  // Top-right theme toggle (mirrors landing / catalog pages).
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

  const content = document.createElement('div');
  content.className = 'max-w-3xl w-full px-6 py-12';

  // Back button
  const back = document.createElement('button');
  back.className = 'text-xs text-zinc-500 hover:text-zinc-300 mb-8 transition-colors';
  back.textContent = '← Back';
  back.addEventListener('click', callbacks.onBack);
  content.appendChild(back);

  // Title
  const titleWrap = document.createElement('div');
  titleWrap.className = 'flex items-center gap-3 mb-3';
  titleWrap.innerHTML = `${partwrightMarkSvg(32)}<h1 class="text-2xl font-bold tracking-tight">What’s new</h1>`;
  content.appendChild(titleWrap);

  const subtitle = document.createElement('p');
  subtitle.className = 'text-sm text-zinc-400 leading-relaxed mb-10';
  subtitle.textContent =
    'A running log of recently shipped features, newest first. Partwright is moving fast — here’s what’s landed lately.';
  content.appendChild(subtitle);

  // Timeline of weeks
  const timeline = document.createElement('div');
  timeline.className = 'relative border-l border-zinc-800 pl-6 space-y-12';

  for (const week of WEEKS) {
    timeline.appendChild(buildWeek(week));
  }
  content.appendChild(timeline);

  // CTA footer
  const cta = document.createElement('div');
  cta.className = 'mt-14 p-4 rounded-lg bg-zinc-800 border border-zinc-700 flex items-center justify-between gap-4';
  const ctaText = document.createElement('span');
  ctaText.className = 'text-sm text-zinc-300';
  ctaText.textContent = 'Want to try the latest? Jump into the editor.';
  cta.appendChild(ctaText);
  const ctaBtn = document.createElement('button');
  ctaBtn.className = 'px-4 py-1.5 rounded text-xs bg-blue-600 hover:bg-blue-500 text-white transition-colors shrink-0';
  ctaBtn.textContent = 'Open editor';
  ctaBtn.addEventListener('click', callbacks.onOpenEditor);
  cta.appendChild(ctaBtn);
  content.appendChild(cta);

  const footer = document.createElement('div');
  footer.className = 'mt-10 pt-6 border-t border-zinc-800 text-xs text-zinc-600';
  footer.innerHTML =
    'More detail in the <a href="/help" class="text-zinc-500 hover:text-zinc-300 transition-colors">help guide</a> and the <a href="/ai.md" class="text-zinc-500 hover:text-zinc-300 transition-colors">AI agent docs</a>.';
  content.appendChild(footer);

  page.appendChild(content);
  container.appendChild(page);
  return page;
}

function buildWeek(week: WeekEntry): HTMLElement {
  const section = document.createElement('section');
  section.className = 'relative';

  // Timeline dot
  const dot = document.createElement('span');
  dot.className = 'absolute -left-[31px] top-1.5 w-3 h-3 rounded-full bg-blue-500 ring-4 ring-zinc-900';
  section.appendChild(dot);

  const range = document.createElement('div');
  range.className = 'text-xs font-mono text-blue-400 mb-1';
  range.textContent = week.range;
  section.appendChild(range);

  const headline = document.createElement('h2');
  headline.className = 'text-lg font-semibold text-zinc-100 mb-5';
  headline.textContent = week.headline;
  section.appendChild(headline);

  for (const group of week.groups) {
    if (group.label) {
      const label = document.createElement('h3');
      label.className = 'text-[11px] font-semibold text-zinc-500 uppercase tracking-widest mt-5 mb-2';
      label.textContent = group.label;
      section.appendChild(label);
    }
    const list = document.createElement('ul');
    list.className = 'space-y-2.5';
    for (const item of group.items) {
      const li = document.createElement('li');
      li.className = 'text-sm leading-relaxed';
      const title = document.createElement('span');
      title.className = 'font-medium text-zinc-200';
      title.textContent = `${item.title} — `;
      const body = document.createElement('span');
      body.className = 'text-zinc-400';
      body.textContent = item.body;
      li.appendChild(title);
      li.appendChild(body);
      list.appendChild(li);
    }
    section.appendChild(list);
  }

  return section;
}
