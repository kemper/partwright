// Modal shown when importing a STEP file. STEP can land as either a true
// BREP shape (exact surfaces, ready for fillets and STEP roundtrip) or as a
// tessellated mesh inside a manifold-js session (works with paint, mesh
// booleans, mesh-only ops). The BREP path is the recommended default
// because STEP's whole point is exact CAD interop — tessellating loses that
// signal. SCAD isn't offered because the OpenSCAD WASM build doesn't read
// STEP.

import { createModalShell } from './modalShell';
import { escapeHtml } from './htmlUtils';
import { languageBadge } from './languageBadge';

export type StepImportTarget = 'brep' | 'manifold-js';

export interface StepImportTargetOptions {
  filename: string;
  /** Whether the user already has a session with real content open — drives
   *  copy under each option ("Open a new session" vs "Replace current"). */
  hasActiveSessionWithWork: boolean;
}

interface Choice {
  target: StepImportTarget;
  badgeLang: 'replicad' | 'manifold-js';
  title: string;
  desc: string;
  recommended?: boolean;
}

/** Show the chooser. Resolves with the picked target or null if cancelled. */
export function showStepImportTargetModal(opts: StepImportTargetOptions): Promise<StepImportTarget | null> {
  return new Promise((resolve) => {
    let result: StepImportTarget | null = null;
    const shell = createModalShell({
      title: 'Import STEP file',
      onClose: () => resolve(result),
    });

    const intro = document.createElement('p');
    intro.className = 'text-[11px] text-zinc-400 leading-relaxed';
    intro.innerHTML = `How should <span class="text-zinc-200 font-medium">${escapeHtml(opts.filename)}</span> land?`;
    shell.body.appendChild(intro);

    const newSessionNote = opts.hasActiveSessionWithWork
      ? ' Your current session will be kept; this opens a new one.'
      : '';

    const choices: Choice[] = [
      {
        target: 'brep',
        badgeLang: 'replicad',
        title: 'BREP (replicad)',
        desc: `Recommended. Preserves the exact surfaces. You can apply true fillets/chamfers, do boolean ops, and re-export as STEP without losing the original geometry.${newSessionNote}`,
        recommended: true,
      },
      {
        target: 'manifold-js',
        badgeLang: 'manifold-js',
        title: 'JS (manifold-js)',
        desc: `Tessellates the BREP into a mesh and exposes it as api.imports[0]. Works with paint, mesh booleans, and mesh-only ops (warp, levelSet). Cannot be re-exported as STEP — surface exactness is lost at tessellation.${newSessionNote}`,
      },
    ];

    const pick = (target: StepImportTarget) => { result = target; shell.close(); };

    let recommendedBtn: HTMLButtonElement | null = null;
    for (const c of choices) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'w-full text-left p-3 rounded-md border border-zinc-700 hover:border-zinc-500 hover:bg-zinc-800/60 transition-colors mb-2 block';
      const badge = languageBadge(c.badgeLang);

      const header = document.createElement('div');
      header.className = 'flex items-center gap-2 mb-1';
      const badgeEl = document.createElement('span');
      badgeEl.className = `text-[10px] font-semibold border rounded px-1 ${badge.classes}`;
      badgeEl.textContent = badge.label;
      header.appendChild(badgeEl);
      const titleEl = document.createElement('span');
      titleEl.className = 'text-[13px] font-medium text-zinc-100';
      titleEl.textContent = c.title;
      header.appendChild(titleEl);
      if (c.recommended) {
        const recBadge = document.createElement('span');
        recBadge.className = 'text-[9px] uppercase tracking-wide text-emerald-400 border border-emerald-400/30 rounded px-1';
        recBadge.textContent = 'Recommended';
        header.appendChild(recBadge);
      }
      btn.appendChild(header);

      const desc = document.createElement('div');
      desc.className = 'text-[12px] text-zinc-400 leading-relaxed';
      desc.textContent = c.desc;
      btn.appendChild(desc);

      btn.addEventListener('click', () => pick(c.target));
      shell.body.appendChild(btn);

      if (c.recommended) recommendedBtn = btn;
    }

    // Focus the recommended option so Enter commits the recommended choice.
    requestAnimationFrame(() => recommendedBtn?.focus());

    // Cancel.
    const cancelRow = document.createElement('div');
    cancelRow.className = 'flex justify-end mt-1';
    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'px-3 py-1.5 rounded text-sm font-medium transition-colors text-zinc-400 hover:text-zinc-100';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.addEventListener('click', () => shell.close());
    cancelRow.appendChild(cancelBtn);
    shell.body.appendChild(cancelRow);
  });
}
