// Pre-export safety confirmation. Shown ONLY from the UI export path (toolbar /
// command palette) — never from the window.partwright.export* console API,
// which AI agents and e2e drive programmatically and must not be blocked.
//
// Surfaces up to two warnings in a single modal:
//   1. Unitless geometry — most slicers assume millimeters, so the printed
//      part will be the wrong size if the model was authored at another scale.
//   2. Printability — the geometry is non-manifold (not watertight) and/or
//      has multiple disconnected components, which many slicers choke on.
//
// If neither applies, the caller skips the modal entirely and exports directly.

import { createModalShell } from './modalShell';
import { BUTTON_PRIMARY, BUTTON_CANCEL } from './styleConstants';
import { formatDimension } from '../geometry/units';

export interface ExportWarningInfo {
  /** True when the active unit system is 'unitless'. */
  unitless: boolean;
  /** Bounding-box dimensions [x, y, z], or null when unknown. */
  dimensions: [number, number, number] | null;
  /** False when the geometry is non-manifold (not watertight). */
  isManifold: boolean;
  /** Number of disconnected components (1 = single solid). */
  componentCount: number;
  /** Format label shown in the confirm button, e.g. 'STL'. */
  format: string;
}

/** Whether any warning is worth interrupting the export for. */
export function hasExportWarning(info: ExportWarningInfo): boolean {
  return info.unitless || !info.isManifold || info.componentCount > 1;
}

/**
 * Show the export-confirmation modal. Resolves true if the user proceeds,
 * false if they cancel/dismiss. Callers should check `hasExportWarning` first
 * and only call this when there's something to warn about.
 */
export function showExportConfirm(info: ExportWarningInfo): Promise<boolean> {
  return new Promise((resolve) => {
    let result = false;
    const shell = createModalShell({
      title: `Export ${info.format}?`,
      onClose: () => {
        document.removeEventListener('keydown', onEnter);
        resolve(result);
      },
    });

    if (info.unitless) {
      const block = document.createElement('div');
      block.className = 'rounded border border-amber-700/50 bg-amber-900/20 px-3 py-2 text-xs text-amber-200 leading-snug';
      const dims = info.dimensions;
      const dimText = dims
        ? `${formatDimension(dims[0])} × ${formatDimension(dims[1])} × ${formatDimension(dims[2])}`
        : null;
      block.innerHTML =
        '<strong>No units set.</strong> Most slicers assume <strong>millimeters</strong>. ' +
        'If you modeled at another scale, the printed part will be the wrong size. ' +
        (dimText ? `This model\'s bounding box is <span class="font-mono">${dimText}</span>. ` : '') +
        'Set units in the Export menu to silence this check.';
      shell.body.appendChild(block);
    }

    if (!info.isManifold || info.componentCount > 1) {
      const block = document.createElement('div');
      block.className = 'rounded border border-amber-700/50 bg-amber-900/20 px-3 py-2 text-xs text-amber-200 leading-snug';
      const lines: string[] = [];
      if (!info.isManifold) {
        lines.push('the geometry is <strong>not manifold</strong> (not watertight)');
      }
      if (info.componentCount > 1) {
        lines.push(`it has <strong>${info.componentCount} disconnected components</strong>`);
      }
      block.innerHTML =
        '<strong>Printability warning:</strong> ' + lines.join(' and ') +
        '. Many slicers may fail or produce a bad print. Consider fixing the model before exporting.';
      shell.body.appendChild(block);
    }

    const cancelBtn = document.createElement('button');
    cancelBtn.className = BUTTON_CANCEL;
    cancelBtn.textContent = 'Cancel';
    cancelBtn.addEventListener('click', () => { result = false; shell.close(); });
    shell.footer.appendChild(cancelBtn);

    const exportBtn = document.createElement('button');
    exportBtn.className = BUTTON_PRIMARY;
    exportBtn.textContent = `Export anyway`;
    exportBtn.addEventListener('click', () => { result = true; shell.close(); });
    shell.footer.appendChild(exportBtn);

    function onEnter(e: KeyboardEvent) {
      if (e.key === 'Enter') { e.preventDefault(); result = true; shell.close(); }
    }
    document.addEventListener('keydown', onEnter);

    exportBtn.focus();
  });
}
