// Pure content data for the "What's new" page — a hand-curated changelog,
// newest first. Dependency-free so both the in-app renderer (src/ui/whatsNew.ts)
// and the build-time static pre-renderer can import it.
//
// When you ship a notable user-facing feature, add a bullet to the most recent
// week's entry here (and to public/llms.txt / the help page if it warrants it).

/** A themed cluster of bullets within a week (e.g. "Modeling", "Painting"). */
export interface FeatureGroup {
  /** Short category label, or null for an un-labeled lead group. */
  label: string | null;
  items: { title: string; body: string }[];
}

export interface WeekEntry {
  /** Human date range, e.g. "May 25 – 29, 2026". */
  range: string;
  /** One-line theme for the week. */
  headline: string;
  groups: FeatureGroup[];
}

export const WHATS_NEW_INTRO =
  'A running log of recently shipped features, newest first. Partwright is moving fast — here’s what’s landed lately.';

// Most recent first. Each entry is a calendar week (Mon–Sun) of shipped work.
export const WHATS_NEW_WEEKS: WeekEntry[] = [
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
