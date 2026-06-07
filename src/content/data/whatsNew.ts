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
    range: 'June 7, 2026',
    headline: 'Voxel rotation, print-ready AI, voice input, and remembered views',
    groups: [
      {
        label: 'Voxel',
        items: [
          {
            title: 'Rotate voxel models',
            body: 'Voxel code gained a rotate() operation for 90° turns on the lattice, so you can reorient a voxel build along any axis without rebuilding it cube by cube.',
          },
        ],
      },
      {
        label: 'AI assistant',
        items: [
          {
            title: '3D-printable mode',
            body: 'A new 3D-printable toggle feeds the assistant FDM design guidance — wall thickness, overhangs, and bed-friendly geometry — so the models it builds come out print-ready. On by default.',
          },
          {
            title: 'Voice input',
            body: 'A mic button in the AI panel lets you dictate prompts instead of typing them.',
          },
        ],
      },
      {
        label: 'Sessions',
        items: [
          {
            title: 'Remembered camera view',
            body: 'Each session now remembers its working view, so reopening a model frames it the way you left it instead of resetting the camera.',
          },
        ],
      },
    ],
  },
  {
    range: 'June 5, 2026',
    headline: 'Filament palettes, the Self-Modeling Studio, and a searchable catalog',
    groups: [
      {
        label: 'Filament palette & multi-color',
        items: [
          {
            title: 'Filament palette manager',
            body: 'A standalone palette manager opens from a new 🧵 Palette pill in the viewport: define your printer’s filament slots, reorder or reset them, and constrain new colors to the palette. The paint panel keeps a live swatch row, a custom-color picker, and an over-budget badge (colors used vs. slot capacity), with a “Manage…” link into the full editor — edits propagate everywhere live.',
          },
          {
            title: 'Slot-aware painting',
            body: 'Painting with a slot stamps each region with a stable slot id, so a multi-color model maps cleanly onto a printer’s AMS/filament slots — recolor a slot and every region on it recolors at once. Multi-color 3MF export now orders its materials by slot so the material index follows AMS slot order, and the export step warns you when a model is over palette budget or when exporting to color-less STL.',
          },
          {
            title: 'Build a palette from a photo',
            body: 'Import palette colors straight from an image: the manager auto-detects the dominant colors and gives you a click-to-eyedrop canvas to pick exact filament colors from a screenshot. A “Recent colors” history keeps colors you’ve used so you can re-add them as slots.',
          },
          {
            title: 'Reconcile a model against the palette',
            body: 'A “Colors in this model” view tags every color as on- or off-palette and offers Replace (swap to a palette or recent color), Merge (collapse one color into another), and Apply-palette auto-match (snap every color to its nearest slot). Save, switch, rename, and delete named palette collections for different printers or projects.',
          },
        ],
      },
      {
        label: 'Self-Modeling Studio',
        items: [
          {
            title: 'Photo → multi-view → 3D',
            body: 'A guided Studio (Import → “Photo → 3D”) turns a single photo into a model: upload a source image, generate a turntable of alternate angles with a Gemini image model (or upload the angles by hand), curate the tiles, then either carve a voxel model from the silhouettes or hand the angle set straight to the AI modeler. Cardinal / Isometric / Full angle-set presets pick how many views to use.',
          },
          {
            title: 'The AI reads your reference images',
            body: 'The assistant can now pull in attached images as a single labeled grid, so the Studio’s reference angles — and any photos you attach — actually feed the AI’s vision when it models for you.',
          },
        ],
      },
      {
        label: 'Catalog',
        items: [
          {
            title: 'Searchable, filterable catalog',
            body: 'Both the /catalog page and the in-editor catalog overlay gained a search box and per-language filter pills, so you can narrow a growing gallery by keyword or by modeling language. A new curated “Fidget Toys” group leads the catalog.',
          },
          {
            title: 'Print-in-place fidgets',
            body: 'The spiral fidget cone is now a real print-in-place mechanism — a cone split by a helical slab into two interleaved ribbons that twist apart straight off the bed, with a built-in clearance gap.',
          },
        ],
      },
      {
        label: 'Painting & editor',
        items: [
          {
            title: 'Wrap tolerance stops paint at sharp edges',
            body: 'The paintbrush gained a “Wrap tolerance” slider (0–180°, default 90°): a stroke crosses an edge only when the two faces bend by no more than the tolerance, so paint flows over gentle curves but stops at a sharp fold instead of bleeding onto an adjacent face or the next wall of a hollow part.',
          },
          {
            title: 'Starters you can experiment with',
            body: 'The JavaScript, OpenSCAD, and BREP starters are now capability samplers — a row of primitives, booleans, and operations to poke at — and the voxel starter is a layered pine tree with ornaments and a star. The Quality panel’s curvature preview also gained an explicit Apply button.',
          },
        ],
      },
    ],
  },
  {
    range: 'June 4, 2026',
    headline: 'Fabric textures, image paint, region-targeted modifiers, and a catalog refresh',
    groups: [
      {
        label: 'Surface textures',
        items: [
          {
            title: 'Fabric & knit textures',
            body: 'A new family of surface modifiers wraps a model in stitched fabric: V-strand knit (stockinette), cable knit, waffle stitch, fur / velvet, and woven fabric. The displacement follows the surface via UV unwrapping — BFS triangle unfolding, with LSCM and harmonic-field layouts for cleaner whole-mesh maps — and runs on a WebGPU compute shader where the browser supports it. A mesh-detail slider trades triangle count for fidelity, and the textures are available to the AI assistant too.',
          },
          {
            title: 'Apply modifiers to part of a model',
            body: 'Every surface modifier — fuzzy skin, smooth, voxelize, and the new fabric textures — now takes a click-to-select flood-fill region selector, so you can texture just one area. Additive multi-region selection, a color-sensitivity control, and triplanar blending round out a redesigned selector UX inside a draggable Surface panel.',
          },
        ],
      },
      {
        label: 'Painting',
        items: [
          {
            title: 'Image paint',
            body: 'Project an image onto the model surface as color regions: click to stamp it where you point, with a hover preview, rotation, and a smooth (stamp-then-refine) mode that subdivides the footprint so the picture conforms to curvature. Alpha-channel flood fill drops the background, and SVG inputs stamp at full vector quality.',
          },
          {
            title: 'Smarter color bucket',
            body: 'The bucket now walks and persists the real connected region, with a live flood-fill preview that tracks the tolerance slider. Region selection uses an explicit Preview button instead of auto-previewing on every click.',
          },
        ],
      },
      {
        label: 'Catalog',
        items: [
          {
            title: 'Catalog quality pass',
            body: 'Redesigned 8 catalog entries and colorized 6 more, added 5 voxel creatures, and shipped five new models — a chain, a hot dog, a voxel castle, a watchtower, and a retro TV.',
          },
        ],
      },
      {
        label: 'Viewport & rendering',
        items: [
          {
            title: 'Reset view & zoom limit',
            body: 'A reset-view button returns the camera to its default framing, and a zoom-out limit keeps a model from shrinking away into the distance.',
          },
          {
            title: 'Cancel long renders instead of timing out',
            body: 'Heavy renders no longer hit a hard execution timeout — they run until you cancel them with the Cancel button, so a slow-but-valid model finishes instead of being killed. Out-of-memory failures in the manifold-js engine now surface a clear hint instead of an opaque crash.',
          },
          {
            title: 'Mesh-quality knobs',
            body: 'The Quality panel’s simplify / enhance controls gained edge-length and size-threshold knobs for finer command over triangle reduction and refinement.',
          },
        ],
      },
      {
        label: 'Diagnostics',
        items: [
          {
            title: 'Worker health & engine memory',
            body: 'The diagnostics log gained a worker-health panel that surfaces the geometry Worker’s state and each engine’s WASM heap usage. Disconnected-component results now also raise a transient warning toast.',
          },
        ],
      },
      {
        label: 'Reliability',
        items: [
          {
            title: 'Resilient sessions',
            body: 'The geometry Worker now recovers automatically after a fatal WASM fault, autosaved drafts clear on save (with a warning if you save error-state code), and paint, annotations, and parameters survive switching between parts. SCAD parts cache their mesh so flipping between parts skips a recompile, and Customizer number fields can now exceed their declared min / max.',
          },
        ],
      },
    ],
  },
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
