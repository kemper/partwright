// Help modal explaining what each language is best for. Anchored to the
// toolbar's language toggle via a "?" link the user clicks when they're
// unsure which mode to pick. Designed to be skimmable: each language gets a
// one-line elevator pitch, a "best for" list, and a "pick something else if"
// caveat so a user (or AI) can decide in under 30 seconds.

import { createModalShell } from './modalShell';
import { languageBadge } from './languageBadge';
import type { Language } from '../geometry/engines/types';

interface LanguageCard {
  language: Language;
  /** Short pitch — one line, leads the card. */
  pitch: string;
  /** Bullet list of strengths. Two or three items each. */
  bestFor: string[];
  /** What you give up — what makes this NOT the right pick. */
  tradeoffs: string;
}

const CARDS: LanguageCard[] = [
  {
    language: 'manifold-js',
    pitch: 'Algorithmic geometry and smooth/organic shapes. Mesh-native.',
    bestFor: [
      'Procedural design (loops, math, generative shapes)',
      'Painting and color regions (the painting tools are first-class here)',
      'Implicit surfaces, gyroids, metaballs (Manifold.levelSet)',
      'Mesh-level smoothing, blending, vertex warps',
      'Quick iteration — fast WASM, no per-run init',
    ],
    tradeoffs: 'No exact surfaces, no STEP import/export, no true selective edge fillets (use api.BREP inside this mode for a one-off exact fillet).',
  },
  {
    language: 'scad',
    pitch: 'Mechanical parts with BOSL2 — threads, gears, attach/anchor.',
    bestFor: [
      'Porting existing .scad files',
      'BOSL2 idioms: threaded_rod, spur_gear, cuboid(rounding=…), attachable()',
      'CSG-style construction (union { ... }, difference { ... })',
      'OpenSCAD users who already know the language',
    ],
    tradeoffs: 'No exact BREP fillets (BOSL2 fakes them with bevels), no STEP, no text() (font data not loaded). Painting on cylinder/revolve outputs is awkward because of radial-fan triangle topology.',
  },
  {
    language: 'replicad',
    pitch: 'Exact-surface BREP — true fillets, chamfers, STEP roundtrip.',
    bestFor: [
      'Parts you\'ll send to a CNC shop, a slicer with a STEP step, or another CAD tool',
      'Selective edge fillets/chamfers (only the top rim, only the four vertical edges)',
      'STEP file import — preserves exact surfaces from SolidWorks/Fusion/FreeCAD',
      'BREP.label → paintByLabel for labeled mechanical parts',
    ],
    tradeoffs: 'No mesh-only ops (Manifold.warp, .levelSet, .smoothOut), no Curves helpers (loft/sweep/NACA airfoils). For shapes that mix exact fillets with organic/SDF geometry, stay in manifold-js and use api.BREP for the one feature.',
  },
];

/** Open the help modal. Pure UI; resolves when the user closes it. */
export function showLanguageHelpModal(): Promise<void> {
  return new Promise((resolve) => {
    const shell = createModalShell({
      title: 'Pick a modeling language',
      onClose: () => resolve(),
    });

    const intro = document.createElement('p');
    intro.className = 'text-[11px] text-zinc-400 leading-relaxed mb-3';
    intro.textContent = 'Each engine has its own strengths. You can switch languages at any time — switching resets the editor to a starter snippet but doesn\'t touch your other sessions.';
    shell.body.appendChild(intro);

    for (const card of CARDS) {
      const badge = languageBadge(card.language);
      const wrapper = document.createElement('div');
      wrapper.className = 'border border-zinc-700 rounded-md p-3 mb-2 bg-zinc-800/40';

      const head = document.createElement('div');
      head.className = 'flex items-center gap-2 mb-1';
      const badgeEl = document.createElement('span');
      badgeEl.className = `text-[10px] font-semibold border rounded px-1 ${badge.classes}`;
      badgeEl.textContent = badge.label;
      head.appendChild(badgeEl);
      const pitchEl = document.createElement('span');
      pitchEl.className = 'text-[13px] text-zinc-100 font-medium';
      pitchEl.textContent = card.pitch;
      head.appendChild(pitchEl);
      wrapper.appendChild(head);

      const bestForLabel = document.createElement('div');
      bestForLabel.className = 'text-[10px] uppercase tracking-wide text-zinc-500 mt-2';
      bestForLabel.textContent = 'Best for';
      wrapper.appendChild(bestForLabel);

      const ul = document.createElement('ul');
      ul.className = 'list-disc list-inside text-[12px] text-zinc-300 leading-relaxed mt-0.5';
      for (const item of card.bestFor) {
        const li = document.createElement('li');
        li.textContent = item;
        ul.appendChild(li);
      }
      wrapper.appendChild(ul);

      const tradeoffLabel = document.createElement('div');
      tradeoffLabel.className = 'text-[10px] uppercase tracking-wide text-zinc-500 mt-2';
      tradeoffLabel.textContent = 'Tradeoffs';
      wrapper.appendChild(tradeoffLabel);

      const tradeoffEl = document.createElement('p');
      tradeoffEl.className = 'text-[12px] text-zinc-400 leading-relaxed mt-0.5';
      tradeoffEl.textContent = card.tradeoffs;
      wrapper.appendChild(tradeoffEl);

      shell.body.appendChild(wrapper);
    }

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'mt-2 px-3 py-1.5 rounded text-sm font-medium transition-colors bg-zinc-700 hover:bg-zinc-600 text-zinc-100';
    closeBtn.textContent = 'Got it';
    closeBtn.addEventListener('click', () => shell.close());
    shell.body.appendChild(closeBtn);
  });
}
