// Pre-export safety confirmation. Shown ONLY from the UI export path (toolbar /
// command palette) — never from the window.partwright.export* console API,
// which AI agents and e2e drive programmatically and must not be blocked.
//
// Surfaces up to two warnings in a single modal:
//   1. Unitless geometry — most slicers assume millimeters, so the printed
//      part will be the wrong size if the model was authored at another scale.
//      This block carries an inline units selector so the user can set (or
//      deliberately leave unset) the unit right here instead of cancelling and
//      reopening the Export menu; picking a unit clears the warning live.
//   2. Printability — the geometry is non-manifold (not watertight) and/or
//      has multiple disconnected components, which many slicers choke on.
//
// If neither applies, the caller skips the modal entirely and exports directly.

import { createModalShell } from './modalShell';
import { BUTTON_PRIMARY, BUTTON_CANCEL } from './styleConstants';
import { formatDimension, getUnits, setUnits, type UnitSystem } from '../geometry/units';
import { escapeHtml } from './htmlUtils';

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
  /** Set when the painted model needs more filament colours than the palette's
   *  printer-slot capacity (advisory — never blocks). */
  colorOverBudget?: { used: number; capacity: number };
  /** True when the chosen format can't carry colour (STL) but the model is
   *  painted, so the colours will be dropped. */
  colorDropped?: boolean;
  /** True when the model declares `api.surface.*` textures that haven't been
   *  applied to the current code (the Re-apply pill is up) — the export would
   *  carry the untextured base mesh. */
  surfaceStale?: boolean;
}

/** Whether any warning is worth interrupting the export for. */
export function hasExportWarning(info: ExportWarningInfo): boolean {
  return info.unitless || !info.isManifold || info.componentCount > 1
    || info.colorOverBudget != null || info.colorDropped === true
    || info.surfaceStale === true;
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

    // When the unit is satisfied (a concrete unit was picked, or it wasn't
    // unitless to begin with), the export button reads "Export"; while any
    // warning is still live it reads "Export anyway". `syncUnitsBlock` keeps
    // both the unit warning copy and the button label in sync as the user
    // picks a unit right here in the modal.
    const otherWarning = !info.isManifold || info.componentCount > 1
      || info.colorOverBudget != null || info.colorDropped === true
      || info.surfaceStale === true;
    let unitsResolved = !info.unitless;

    if (info.unitless) {
      const block = document.createElement('div');
      const message = document.createElement('div');
      const dims = info.dimensions;
      const dimText = dims
        ? `${formatDimension(dims[0])} × ${formatDimension(dims[1])} × ${formatDimension(dims[2])}`
        : null;

      // Inline units control — lets the user fix the warning right here instead
      // of cancelling, opening the Export menu, and starting over.
      const controlRow = document.createElement('div');
      controlRow.className = 'mt-2 flex items-center gap-2';
      const selectLabel = document.createElement('label');
      selectLabel.className = 'text-xs font-medium';
      selectLabel.textContent = 'Set units:';
      selectLabel.htmlFor = 'export-confirm-units-select';
      const unitsSelect = document.createElement('select');
      unitsSelect.id = 'export-confirm-units-select';
      unitsSelect.className = 'text-xs bg-zinc-900 border border-zinc-600 rounded px-2 py-1 text-zinc-200 focus:outline-none focus:border-blue-500';
      const UNIT_LABELS: Record<UnitSystem, string> = {
        unitless: 'Leave unitless',
        mm: 'Millimeters (mm)',
        cm: 'Centimeters (cm)',
        in: 'Inches (in)',
      };
      for (const u of ['unitless', 'mm', 'cm', 'in'] as const) {
        const opt = document.createElement('option');
        opt.value = u;
        opt.textContent = UNIT_LABELS[u];
        unitsSelect.appendChild(opt);
      }
      unitsSelect.value = getUnits();
      selectLabel.appendChild(unitsSelect);
      controlRow.append(selectLabel);

      // Re-render the warning copy + restyle the block for the current unit.
      // Dimensions re-format through `formatDimension`, which reflects the unit
      // we just set, so the bounding box reads in the chosen unit.
      const syncUnitsBlock = () => {
        const unit = getUnits();
        unitsResolved = unit !== 'unitless';
        const liveDimText = dims
          ? `${formatDimension(dims[0])} × ${formatDimension(dims[1])} × ${formatDimension(dims[2])}`
          : null;
        if (unitsResolved) {
          block.className = 'rounded border border-emerald-700/50 bg-emerald-900/20 px-3 py-2 text-xs text-emerald-200 leading-snug';
          message.innerHTML =
            `<strong>Units set to ${escapeHtml(unit)}.</strong> The exported model will declare this unit. ` +
            (liveDimText ? `Bounding box: <span class="font-mono">${escapeHtml(liveDimText)}</span>.` : '');
        } else {
          block.className = 'rounded border border-amber-700/50 bg-amber-900/20 px-3 py-2 text-xs text-amber-200 leading-snug';
          message.innerHTML =
            '<strong>No units set.</strong> Most slicers assume <strong>millimeters</strong>. ' +
            'If you modeled at another scale, the printed part will be the wrong size. ' +
            (dimText ? `This model\'s bounding box is <span class="font-mono">${escapeHtml(dimText)}</span>. ` : '') +
            'Choose a unit below to silence this check.';
        }
      };

      unitsSelect.addEventListener('change', () => {
        setUnits(unitsSelect.value as UnitSystem);
        syncUnitsBlock();
        updateExportLabel();
      });

      block.append(message, controlRow);
      syncUnitsBlock();
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
        lines.push(`it has <strong>${escapeHtml(String(info.componentCount))} disconnected components</strong>`);
      }
      block.innerHTML =
        '<strong>Printability warning:</strong> ' + lines.join(' and ') +
        '. Many slicers may fail or produce a bad print. Consider fixing the model before exporting.';
      shell.body.appendChild(block);
    }

    if (info.colorOverBudget) {
      const block = document.createElement('div');
      block.className = 'rounded border border-amber-700/50 bg-amber-900/20 px-3 py-2 text-xs text-amber-200 leading-snug';
      const { used, capacity } = info.colorOverBudget;
      block.innerHTML =
        `<strong>More colours than slots.</strong> This model uses <strong>${used}</strong> filament colours but your palette capacity is <strong>${capacity}</strong>. ` +
        'Your printer may not have enough filament slots. Adjust capacity in the palette manager (🧵 Palette).';
      shell.body.appendChild(block);
    }

    if (info.colorDropped) {
      const block = document.createElement('div');
      block.className = 'rounded border border-amber-700/50 bg-amber-900/20 px-3 py-2 text-xs text-amber-200 leading-snug';
      block.innerHTML =
        `<strong>${info.format} can't carry colour.</strong> Your painted colours will be dropped — the exported model is geometry only. ` +
        'Export <strong>3MF</strong> (or GLB) to keep colours.';
      shell.body.appendChild(block);
    }

    if (info.surfaceStale) {
      const block = document.createElement('div');
      block.className = 'rounded border border-amber-700/50 bg-amber-900/20 px-3 py-2 text-xs text-amber-200 leading-snug';
      block.innerHTML =
        '<strong>Surface textures not applied.</strong> This model declares <span class="font-mono">api.surface.*</span> textures ' +
        'that haven\'t been computed for the current code — the export would contain the <strong>untextured base mesh</strong>. ' +
        'Cancel and press <strong>Run</strong> (or the ⟳ Re-apply pill) first to texture it.';
      shell.body.appendChild(block);
    }

    const cancelBtn = document.createElement('button');
    cancelBtn.className = BUTTON_CANCEL;
    cancelBtn.textContent = 'Cancel';
    cancelBtn.addEventListener('click', () => { result = false; shell.close(); });
    shell.footer.appendChild(cancelBtn);

    const exportBtn = document.createElement('button');
    exportBtn.className = BUTTON_PRIMARY;
    exportBtn.addEventListener('click', () => { result = true; shell.close(); });
    shell.footer.appendChild(exportBtn);

    // "Export anyway" while any warning is still live; once every warning is
    // cleared (e.g. the user picked a unit inline) it relaxes to "Export".
    function updateExportLabel() {
      exportBtn.textContent = (otherWarning || !unitsResolved) ? 'Export anyway' : 'Export';
    }
    updateExportLabel();

    function onEnter(e: KeyboardEvent) {
      if (e.key === 'Enter') { e.preventDefault(); result = true; shell.close(); }
    }
    document.addEventListener('keydown', onEnter);

    exportBtn.focus();
  });
}
