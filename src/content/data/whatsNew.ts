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
    range: 'May 31 – June 3, 2026',
    headline: 'Multi-file OpenSCAD, unified viewport panels, and instant static pages',
    groups: [
      {
        label: 'Modeling & editor',
        items: [
          {
            title: '3D text in JavaScript (api.text)',
            body: 'Build raised or cut lettering directly in a manifold-js session with api.text() and api.textSection() — no need to drop to OpenSCAD for a label. OpenSCAD’s own text() primitive now works too, backed by the Liberation Sans font family loaded into WASM.',
          },
          {
            title: 'Resize panel',
            body: 'A new ⇲ Resize tool in the viewport overlay scales a model along X / Y / Z with independent or uniform sliders, a typeable exact size, an optional “preserve colors” pass, and a live preview before you commit a new version.',
          },
          {
            title: 'Find / Replace in the editor',
            body: 'A Find/Replace control in the editor header for quickly searching and rewriting code.',
          },
        ],
      },
      {
        label: 'OpenSCAD multi-file',
        items: [
          {
            title: 'Companion files for multi-file SCAD',
            body: 'Import a .scad file that pulls in your own include <…> / use <…> dependencies and Partwright detects the missing files (by actually compiling), then prompts you to supply them. Companion files get their own editable, syntax-highlighted tabs and persist with the session.',
          },
          {
            title: 'Two-phase preview & cancel',
            body: 'SCAD renders show a fast preview first, an elapsed-time status bar while the full render runs, and a Cancel button so a long compile never traps you.',
          },
        ],
      },
      {
        label: 'Painting',
        items: [
          {
            title: 'Color-based bucket & new Replace tool',
            body: 'The Bucket tool can now flood-fill by color as well as by geometry, and a new 🔄 Replace tool swaps one color for another across every matching region at once. Slab is now the default paint surface (and works with spray).',
          },
          {
            title: 'Projection paintbrush & no more editor lock',
            body: 'A projection-based paintbrush with BVH-accelerated picking and a faster smooth-brush commit. Painting no longer locks the code editor — it stays fully editable, and version history is your rollback path.',
          },
        ],
      },
      {
        label: 'Viewport panels',
        items: [
          {
            title: 'Unified, draggable overlay panels',
            body: 'The Quality, Resize, Surface, and Relief panels now share one set of UX conventions — draggable, kept on-screen (and mobile-friendly), with consistent headers and behavior.',
          },
          {
            title: 'Quality panel (was Simplify)',
            body: 'The old Simplify tool is now the ○ Quality panel: it folds curvature quality together with simplify / enhance triangle-count controls in one place.',
          },
        ],
      },
      {
        label: 'AI assistant',
        items: [
          {
            title: 'Plan-first mode',
            body: 'A new toggle makes the assistant draft a plan and wait for your approval before it touches the model — you can keep refining the plan while approval is pending. Also fixed a Gemini retry loop on malformed function calls.',
          },
        ],
      },
      {
        label: 'Pages & polish',
        items: [
          {
            title: 'Instant static pages',
            body: 'The landing, catalog, help, legal, and what’s-new pages are now pre-rendered as static, app-free HTML — they paint instantly without loading the editor or WASM, behind a unified top header shared across every non-editor page.',
          },
          {
            title: 'In-app dialogs everywhere',
            body: 'Native browser alert / confirm / prompt pop-ups are gone, replaced by in-app toasts and dialogs that match the rest of the UI. A “Beta” pill now sits in the landing nav and editor toolbar.',
          },
          {
            title: 'Version provenance',
            body: 'Saved versions now record where they came from (their parent version and the operation that produced them), laying groundwork for clearer history.',
          },
        ],
      },
    ],
  },
  {
    range: 'May 30, 2026',
    headline: 'Surface modifiers, Ideas library, and landing page performance',
    groups: [
      {
        label: 'Modeling',
        items: [
          {
            title: 'Surface modifiers',
            body: 'Apply post-processing effects to any model: fuzzy skin adds randomized surface noise (mimicking FDM printed texture), smooth rounds out faceted geometry, and voxelize converts the surface to a cube grid. All three are available from the command palette, the viewport overlay, and the window.partwright API. Paint carries through the modifier via nearest-triangle transfer, and each apply creates an undoable new version with a live preview before committing.',
          },
        ],
      },
      {
        label: 'AI assistant',
        items: [
          {
            title: 'Ideas page and in-pane prompt library',
            body: 'A new /ideas page showcases starter prompts and technique ideas. In the AI panel, clicking 💡 opens a searchable prompt library — pick a tile to populate the input without sending. Empty-state chips suggest quick starts when the chat is blank.',
          },
          {
            title: 'Printability feedback',
            body: 'The AI now sees printability data (overhangs, thin walls, floating parts, non-manifold status) in its tool responses. The viewport shows a live printability indicator after each successful render.',
          },
          {
            title: 'Import confirmation',
            body: 'The AI must now show a confirmation dialog before importing files into a session — you see exactly what it intends to import and can accept or cancel.',
          },
        ],
      },
      {
        label: 'Relief Studio',
        items: [
          {
            title: 'Remove background, double-sided, and mirror',
            body: 'Three new import options: automatic background removal (reads the alpha channel when available, pre-quantization RGB otherwise), a double-sided toggle for wall-hung reliefs, and a mirror axis selector.',
          },
        ],
      },
      {
        label: 'Settings',
        items: [
          {
            title: 'Advanced Settings overhaul',
            body: '30 new configurable fields across AI, renderer, import, and UI — each with a ? tooltip explaining what it controls. The start-fresh / uninstall action moved from the landing page into Advanced Settings.',
          },
        ],
      },
      {
        label: 'Performance',
        items: [
          {
            title: 'Landing page speed and stability',
            body: 'The landing page now renders from static HTML before JavaScript loads, eliminating black-screen flash and layout shift on first visit. Skeleton ghost loaders fill catalog and session tiles while data arrives; fonts use fallback rendering to prevent reflow; WASM loads are deferred until the editor actually opens.',
          },
        ],
      },
    ],
  },
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
