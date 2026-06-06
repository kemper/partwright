// The "Did you know?" hints dataset — the single source of truth for the
// rolling editor hints ticker (src/ui/hints/hintsTicker.ts).
//
// Each hint is one capability a new user is likely to miss, plus a call-to-
// action that takes them straight to it. The CTA is a small discriminated
// union so the ticker stays dumb: it just dispatches by `kind`.
//
//   - `command`: run a registered command-palette action by id (navigation,
//     tab switches, open-modal actions, …). The id must exist in the registry
//     wired up in main.ts.
//   - `open`: open one of the two global overlays that aren't palette commands.
//   - `coach`: the star case — run any prep commands (switch view, open a
//     menu), optionally click a menu trigger to reveal nested buttons, then
//     pulse an arrow at the target control so the user learns where it lives.
//
// Kept dependency-free (no imports) so it can be unit-tested in the node tier.

import type { CoachPlacement } from '../coachmark';

export type HintCta =
  | { kind: 'command'; id: string }
  | { kind: 'open'; what: 'commandPalette' | 'shortcuts' }
  | {
      kind: 'coach';
      /** Command ids run in order before pointing (e.g. switch to a view). */
      prep?: string[];
      /** Selector clicked to open a popover so the `target` becomes visible. */
      openSelector?: string;
      /** Selector the arrow points at. */
      target: string;
      /** Side of the target the bubble sits on. */
      placement?: CoachPlacement;
      /** Bubble label. */
      label?: string;
    };

export interface Hint {
  /** Stable id (also used to remember which hints have been seen). */
  id: string;
  /** The "Did you know?" line. Keep it to one sentence. */
  text: string;
  /** CTA link label. Defaults to "Check it out →". */
  ctaLabel?: string;
  /** What clicking the CTA does. */
  cta: HintCta;
}

/** Default CTA link text when a hint doesn't override it. */
export const DEFAULT_CTA_LABEL = 'Check it out →';

// Order here is the rotation order for a fresh user; the ticker prioritizes
// unseen hints and then cycles. Targets/ids are verified against the live DOM:
//   #viewport-tools-group-btn  — the "Tools ▾" popover trigger (clip-controls)
//   #paint-toggle              — Paint button (inside the Tools popover)
//   #surface-viewport-toggle   — ✦ Surface button (inside the Tools popover)
//   #lang-toggle               — JS/SCAD/BREP/VOXEL engine switch (toolbar)
//   #import-wrapper            — Import dropdown (toolbar)
export const HINTS: Hint[] = [
  {
    id: 'command-palette',
    text: 'Press ⌘K (Ctrl+K) to open the command palette and run any action by name.',
    ctaLabel: 'Open it →',
    cta: { kind: 'open', what: 'commandPalette' },
  },
  {
    id: 'shortcuts',
    text: 'Press ? anywhere to see the full keyboard-shortcut cheat sheet.',
    ctaLabel: 'Show shortcuts →',
    cta: { kind: 'open', what: 'shortcuts' },
  },
  {
    id: 'surface-texture',
    text: 'Add knurling, fuzzy skin, woven, or fur textures to any model with the Surface tool.',
    ctaLabel: 'Try it →',
    cta: {
      kind: 'coach',
      prep: ['tab-interactive'],
      openSelector: '#viewport-tools-group-btn',
      target: '#surface-viewport-toggle',
      placement: 'left',
      label: 'Surface textures live here — fuzzy, knit, woven, fur & more.',
    },
  },
  {
    id: 'paint-colors',
    text: 'Paint regions of your model for multi-color 3D prints, exported as 3MF or OBJ.',
    ctaLabel: 'Show me →',
    cta: {
      kind: 'coach',
      prep: ['tab-interactive'],
      openSelector: '#viewport-tools-group-btn',
      target: '#paint-toggle',
      placement: 'left',
      label: 'Paint coplanar regions and label them by name.',
    },
  },
  {
    id: 'photo-to-model',
    text: 'Turn any photo into a printable relief, lithophane, or colored voxel model.',
    ctaLabel: 'Open Ideas →',
    cta: { kind: 'command', id: 'open-ideas' },
  },
  {
    id: 'brep-engine',
    text: 'Switch to the BREP engine for true rounded fillets, chamfers, and STEP export.',
    ctaLabel: 'Find the switch →',
    cta: {
      kind: 'coach',
      target: '#lang-toggle',
      placement: 'bottom',
      label: 'Pick an engine here: JS, SCAD, BREP, or VOXEL.',
    },
  },
  {
    id: 'diff-versions',
    text: 'Compare any two versions side by side — code and geometry stats — in the Diff tab.',
    ctaLabel: 'Open Diff →',
    cta: { kind: 'command', id: 'tab-diff' },
  },
  {
    id: 'catalog',
    text: 'Browse a catalog of ready-made models you can open, tweak, or hand to the AI.',
    ctaLabel: 'Browse catalog →',
    cta: { kind: 'command', id: 'open-catalog' },
  },
  {
    id: 'ai-review',
    text: 'Get a second opinion: have a different AI provider review your current model.',
    ctaLabel: 'Open the AI panel →',
    cta: { kind: 'command', id: 'toggle-ai' },
  },
  {
    id: 'import',
    text: 'Import STL or STEP meshes, .scad / .js source, .vox models, or a full session file.',
    ctaLabel: 'Show import →',
    cta: {
      kind: 'coach',
      target: '#import-wrapper',
      placement: 'bottom',
      label: 'Import meshes, source files, or whole sessions here.',
    },
  },
];
