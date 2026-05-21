// Optional mesh-reduction step shown when importing a heavy STL. Gives precise
// control over the result via a target triangle count ("Max triangles") — a
// numeric input plus a slider — backed by a tolerance search in ../import/
// simplify.ts. Small meshes skip this entirely.

import { createModalShell } from './modalShell';
import {
  buildImportManifold,
  simplifyToTargetTriangles,
  meshDiagonal,
} from '../import/simplify';
import type { MeshData } from '../geometry/types';

/** Only offer the reduction step for imports above this triangle count — below
 *  it, simplification isn't worth interrupting the import for. */
export const IMPORT_DETAIL_TRIANGLE_THRESHOLD = 20_000;

export interface ImportDetailResult {
  /** The mesh to import — original, or a simplified copy. */
  mesh: MeshData;
  /** Original triangle count when the user reduced; null when full detail. */
  reducedFrom: number | null;
}

const fmt = (n: number) => Math.round(n).toLocaleString();

export function showImportDetailModal(mesh: MeshData, filename: string): Promise<ImportDetailResult | null> {
  return new Promise((resolve) => {
    const original = mesh.numTri;
    const diag = meshDiagonal(mesh) || 1;
    const minTarget = Math.max(50, Math.round(original * 0.002));

    let settled = false;
    let pendingTimer: ReturnType<typeof setTimeout> | null = null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let manifold: any | null = null;
    let manifoldTried = false;
    // Memoize the most recent reduction so Import doesn't recompute.
    let cachedTarget = -1;
    let cachedMesh: MeshData | null = null;

    const shell = createModalShell({ title: 'Import detail', onClose: () => finish(null) });

    function getManifold(): unknown {
      if (!manifoldTried) { manifold = buildImportManifold(mesh); manifoldTried = true; }
      return manifold;
    }

    function finish(result: ImportDetailResult | null): void {
      if (pendingTimer) { clearTimeout(pendingTimer); pendingTimer = null; }
      if (manifold) { try { manifold.delete?.(); } catch { /* already gone */ } manifold = null; }
      if (!settled) { settled = true; resolve(result); }
      shell.close();
    }

    /** Compute (synchronously) the mesh for a target triangle count. */
    function computeFor(target: number): { mesh: MeshData; reducedFrom: number | null; tolerance: number; count: number } {
      if (target >= original || !getManifold()) {
        return { mesh, reducedFrom: null, tolerance: 0, count: original };
      }
      const r = simplifyToTargetTriangles(manifold, diag, target);
      return { mesh: r.mesh, reducedFrom: original, tolerance: r.tolerance, count: r.triangleCount };
    }

    // --- UI ---------------------------------------------------------------
    const intro = document.createElement('p');
    intro.className = 'text-xs text-zinc-400 leading-relaxed';
    intro.innerHTML =
      `<span class="text-zinc-200 font-mono">${filename}</span> has <span class="text-zinc-200">${fmt(original)}</span> triangles. ` +
      'Set a target triangle count to reduce it for a lighter, faster session. Reduction merges vertices within a tolerance of the surface — ideal for over-tessellated meshes. You can re-import the original any time.';
    shell.body.appendChild(intro);

    const row = document.createElement('div');
    row.className = 'flex items-center justify-between gap-2 mt-1';
    const rowLabel = document.createElement('label');
    rowLabel.className = 'text-xs text-zinc-300';
    rowLabel.textContent = 'Max triangles';
    rowLabel.htmlFor = 'import-target-input';
    const input = document.createElement('input');
    input.type = 'number';
    input.id = 'import-target-input';
    input.min = String(minTarget);
    input.max = String(original);
    input.step = '1';
    input.value = String(original);
    input.className = 'w-28 text-right px-2 py-1 rounded bg-zinc-900 border border-zinc-600 text-zinc-100 text-xs font-mono';
    row.appendChild(rowLabel);
    row.appendChild(input);
    shell.body.appendChild(row);

    const slider = document.createElement('input');
    slider.type = 'range';
    slider.id = 'import-target-slider';
    slider.min = String(minTarget);
    slider.max = String(original);
    slider.step = '1';
    slider.value = String(original);
    slider.className = 'w-full accent-blue-500 cursor-pointer mt-1';
    slider.setAttribute('aria-label', 'Maximum triangle count');
    shell.body.appendChild(slider);

    const result = document.createElement('div');
    result.id = 'import-target-result';
    result.className = 'mt-1 text-[11px] text-zinc-400 leading-snug min-h-[1.5em]';
    shell.body.appendChild(result);

    function renderFull(): void {
      result.textContent = `Full detail — ${fmt(original)} triangles.`;
    }
    function renderReduced(count: number, tolerance: number): void {
      const pct = Math.round((count / original) * 100);
      const dev = Number(tolerance.toPrecision(2));
      result.textContent = `≈ ${fmt(count)} triangles (${pct}% of original) · max deviation ≈ ${dev} units.`;
    }
    renderFull();

    function clampTarget(v: number): number {
      if (!Number.isFinite(v)) return original;
      return Math.min(original, Math.max(minTarget, Math.round(v)));
    }

    /** Update both widgets to a target and schedule a (deferred) preview. */
    function setTarget(target: number, fromSlider: boolean): void {
      if (!fromSlider) slider.value = String(target);
      if (fromSlider) input.value = String(target);
      cachedTarget = -1; // invalidate memo until recomputed
      if (target >= original) { renderFull(); return; }
      result.textContent = 'Calculating…';
      if (pendingTimer) clearTimeout(pendingTimer);
      pendingTimer = setTimeout(() => {
        pendingTimer = null;
        if (settled) return;
        const r = computeFor(target);
        cachedTarget = target; cachedMesh = r.mesh;
        if (r.reducedFrom == null) renderFull(); else renderReduced(r.count, r.tolerance);
      }, 120);
    }

    // Live-sync the two widgets while dragging; compute on release / commit.
    slider.addEventListener('input', () => { input.value = slider.value; });
    slider.addEventListener('change', () => setTarget(clampTarget(Number(slider.value)), true));
    input.addEventListener('change', () => setTarget(clampTarget(Number(input.value)), false));

    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'px-3 py-1.5 rounded text-xs font-medium bg-zinc-700 hover:bg-zinc-600 text-zinc-100';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.addEventListener('click', () => finish(null));

    const importBtn = document.createElement('button');
    importBtn.className = 'px-3 py-1.5 rounded text-xs font-medium bg-blue-600 hover:bg-blue-500 text-white';
    importBtn.textContent = 'Import';
    importBtn.addEventListener('click', () => {
      const target = clampTarget(Number(input.value));
      // Use the memoized result when it matches; otherwise compute synchronously
      // so a fast click never silently imports the wrong density.
      if (cachedTarget === target && cachedMesh) {
        finish({ mesh: cachedMesh, reducedFrom: target >= original ? null : original });
        return;
      }
      const r = computeFor(target);
      finish({ mesh: r.mesh, reducedFrom: r.reducedFrom });
    });

    shell.footer.appendChild(cancelBtn);
    shell.footer.appendChild(importBtn);
  });
}
