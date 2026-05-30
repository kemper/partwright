// The "Ideas" dataset — the single source of truth that powers BOTH discovery
// surfaces:
//   1. the /ideas gallery page (src/ui/ideasPage.ts), and
//   2. the in-pane prompt library + empty-state chips (src/ui/aiPanel.ts,
//      src/ui/aiPromptLibraryModal.tsx).
//
// An "idea" is a *starting point*, not a finished session (that's what the
// catalog is for). Most ideas are just a prompt the user can drop into the AI
// input and tweak; a few "interactive" ones kick off a built-in flow that
// needs an input first (e.g. uploading a photo to voxelize).
//
// Kept dependency-free so the pure helpers below stay unit-testable and both
// the page and the modal can import the list without a network fetch.

export type IdeaCategory = 'starter' | 'technique' | 'interactive';

/** Built-in interactive flow an "interactive" idea triggers. The handler lives
 *  in main.ts (it needs the editor/session plumbing). */
export type IdeaAction = 'photoToVoxel' | 'photoToRelief';

export interface Idea {
  /** Stable id / slug. */
  id: string;
  /** Tile heading. */
  title: string;
  /** One-line description shown under the title. */
  blurb: string;
  category: IdeaCategory;
  /** Glyph shown on the tile (we ship no rendered thumbnails — these are
   *  prompts, not finished models). */
  emoji: string;
  /** Free-text tags, used for search in the prompt library. */
  tags?: string[];
  /** The prompt dropped (verbatim) into the AI input. Present for `starter`
   *  and `technique` ideas. */
  prompt?: string;
  /** Optional deep-link to a reference doc (opened in a new tab) so a curious
   *  user can read how the technique works. */
  learnMore?: string;
  /** The interactive flow this tile starts. Present only for `interactive`
   *  ideas (which have no `prompt`). */
  action?: IdeaAction;
}

export interface IdeaCategoryDef {
  id: IdeaCategory;
  title: string;
  blurb: string;
}

/** Section order on the /ideas page. */
export const IDEA_CATEGORIES: IdeaCategoryDef[] = [
  {
    id: 'interactive',
    title: 'Try it with your own photo',
    blurb: 'Upload an image and turn it into a model right here — no AI key needed. A great first taste of what the tool can do.',
  },
  {
    id: 'starter',
    title: 'Starter prompts',
    blurb: 'Not sure what to ask for? Pick one of these to drop a ready-made prompt into the AI panel — then tweak it before you send.',
  },
  {
    id: 'technique',
    title: 'Show me what’s possible',
    blurb: 'Each of these spotlights a capability you might not discover on your own — implicit surfaces, true CAD fillets, voxels, and more. Open the prompt, or read how it works.',
  },
];

export const IDEAS: Idea[] = [
  // ---- Interactive (need an input first; handled in main.ts) ----
  {
    id: 'voxel-selfie',
    title: 'Turn your photo into a voxel portrait',
    blurb: 'Upload a selfie and get a colorful, blocky 3D version of it that you can refine and print.',
    category: 'interactive',
    emoji: '\u{1F9CA}', // ice cube — blocky/voxel feel
    tags: ['voxel', 'photo', 'selfie', 'portrait', 'fun'],
    action: 'photoToVoxel',
    learnMore: '/ai/voxel.md',
  },
  {
    id: 'relief-portrait',
    title: 'Turn your photo into a smooth relief',
    blurb: 'Upload a photo and emboss it as a smooth, printable relief tile (lithophane-style) — the non-blocky take.',
    category: 'interactive',
    emoji: '\u{1F5BC}\u{FE0F}', // framed picture
    tags: ['relief', 'lithophane', 'photo', 'smooth', 'portrait'],
    action: 'photoToRelief',
    learnMore: '/ai/relief.md',
  },

  // ---- Starter prompts (drop-in AI prompts) ----
  {
    id: 'coffee-mug',
    title: 'A coffee mug',
    blurb: 'A classic to start with — a mug with a comfortable handle.',
    category: 'starter',
    emoji: '☕',
    tags: ['mug', 'kitchen', 'beginner', 'hollow'],
    prompt: 'Build a coffee mug about 90mm tall with a 5mm-thick wall, a rounded base, and a comfortable handle on the side.',
  },
  {
    id: 'phone-stand',
    title: 'A desk phone stand',
    blurb: 'Holds your phone at a viewing angle with a cable pass-through.',
    category: 'starter',
    emoji: '\u{1F4F1}',
    tags: ['phone', 'stand', 'desk', 'practical'],
    prompt: 'Design a phone stand for my desk that holds the phone at about a 65° angle, with a slot at the front lip for the charging cable to pass through. Make it stable and printable without supports.',
  },
  {
    id: 'snap-fit-box',
    title: 'A box with a snap-fit lid',
    blurb: 'A small parts box whose lid clicks shut.',
    category: 'starter',
    emoji: '\u{1F4E6}',
    tags: ['box', 'lid', 'enclosure', 'storage'],
    prompt: 'Create a small rectangular box, roughly 60×40×25mm, with 2mm walls and a separate snap-fit lid that clicks onto the rim. Arrange the box and lid side by side.',
  },
  {
    id: 'name-keychain',
    title: 'A name keychain',
    blurb: 'Raised letters on a tag with a ring hole.',
    category: 'starter',
    emoji: '\u{1F511}',
    tags: ['keychain', 'text', 'gift', 'name'],
    prompt: 'Make a keychain: a rounded rectangular tag with my name in raised letters across the front and a hole in one corner for a keyring.',
  },
  {
    id: 'gridfinity-bin',
    title: 'A Gridfinity bin',
    blurb: 'A 1×1 bin for the popular desktop organizing system.',
    category: 'starter',
    emoji: '\u{1F5C3}\u{FE0F}',
    tags: ['gridfinity', 'organizer', 'storage', 'modular'],
    prompt: 'Make a 1×1 Gridfinity bin compatible with the standard 42mm grid, with the usual stacking lip and a single open compartment.',
  },
  {
    id: 'keycap',
    title: 'A keyboard keycap',
    blurb: 'A Cherry MX–style cap with a dished top.',
    category: 'starter',
    emoji: '⌨\u{FE0F}',
    tags: ['keycap', 'keyboard', 'mx', 'mechanical'],
    prompt: 'Design a Cherry MX compatible keycap (1u) with a slightly dished/concave top surface and the cross-shaped stem socket underneath.',
  },

  // ---- Technique showcases (prompt + "learn more") ----
  {
    id: 'parametric-customizer',
    title: 'A part you can tweak with sliders',
    blurb: 'Expose parameters so anyone can customize it without touching code.',
    category: 'technique',
    emoji: '\u{1F39B}\u{FE0F}',
    tags: ['parametric', 'customizer', 'params', 'sliders'],
    prompt: 'Make a parametric desk organizer that uses api.params({...}) to expose adjustable width, depth, number of compartments, and wall thickness, so I can tune it from the Customize panel.',
    learnMore: '/ai.md',
  },
  {
    id: 'sdf-gyroid',
    title: 'A gyroid lattice (implicit surfaces)',
    blurb: 'Smooth, organic infill built from a signed-distance field.',
    category: 'technique',
    emoji: '\u{1F300}',
    tags: ['sdf', 'gyroid', 'lattice', 'implicit', 'organic'],
    prompt: 'Use the SDF (signed-distance field) tools to build a gyroid lattice contained inside a rounded cube, around 40mm on a side.',
    learnMore: '/ai/sdf.md',
  },
  {
    id: 'brep-fillets',
    title: 'True rounded edges (solid CAD)',
    blurb: 'Exact, selective fillets on real solids via the BREP engine.',
    category: 'technique',
    emoji: '\u{1F529}',
    tags: ['brep', 'fillet', 'chamfer', 'replicad', 'cad', 'step'],
    prompt: 'Switch to the BREP engine and model a rectangular bracket with true selective fillets on its outer vertical edges and a chamfer around the top face.',
    learnMore: '/ai/replicad.md',
  },
  {
    id: 'voxel-pixel-art',
    title: 'Voxel pixel-art',
    blurb: 'Build a colorful model by stacking colored cubes.',
    category: 'technique',
    emoji: '\u{1F47E}',
    tags: ['voxel', 'pixel', 'retro', 'color'],
    prompt: 'Use the voxel builder to make a small piece of pixel-art — a red mushroom with white spots — then smooth its edges slightly.',
    learnMore: '/ai/voxel.md',
  },
  {
    id: 'lofted-vase',
    title: 'A lofted vase (curves)',
    blurb: 'Sweep and loft profiles into a flowing organic shape.',
    category: 'technique',
    emoji: '\u{1F3FA}',
    tags: ['vase', 'loft', 'sweep', 'curves', 'organic'],
    prompt: 'Use the Curves helpers to loft a vase: a circular base flowing up through a pinched waist to a wider, gently scalloped rim, hollowed out with a few-mm wall.',
    learnMore: '/ai/curves.md',
  },
  {
    id: 'scad-gear',
    title: 'A spur gear (OpenSCAD + BOSL2)',
    blurb: 'Lean on the BOSL2 library for parts with precise teeth and threads.',
    category: 'technique',
    emoji: '⚙\u{FE0F}',
    tags: ['gear', 'openscad', 'bosl2', 'scad', 'mechanical'],
    prompt: 'Switch to OpenSCAD and use BOSL2 to make a 20-tooth spur gear, 6mm thick, with a 5mm center bore.',
    learnMore: '/ai/bosl2.md',
  },
];

/** Case-insensitive search across title, blurb, tags, and prompt. A blank
 *  query returns the list unchanged. Pure — unit tested. */
export function filterIdeas(ideas: Idea[], query: string): Idea[] {
  const q = query.trim().toLowerCase();
  if (!q) return ideas;
  return ideas.filter((idea) => {
    const hay = [idea.title, idea.blurb, idea.prompt ?? '', ...(idea.tags ?? [])]
      .join(' ')
      .toLowerCase();
    return hay.includes(q);
  });
}

/** Ideas that carry a prompt — the ones the prompt library and the empty-state
 *  chips can surface (interactive ideas have an action, not a prompt). */
export function promptIdeas(): Idea[] {
  return IDEAS.filter((idea) => typeof idea.prompt === 'string' && idea.prompt.length > 0);
}

/** A short slice of starter prompts for the AI panel empty state. Deterministic
 *  (the first N starters) so the chips don't jump around on every render. */
export function starterChipIdeas(limit = 4): Idea[] {
  return IDEAS.filter((idea) => idea.category === 'starter').slice(0, limit);
}
