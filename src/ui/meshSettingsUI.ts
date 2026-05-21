// Mesh settings popover — a viewport-overlay button (next to Paint / Annotate /
// Measure) that opens a small panel with the two mesh-quality knobs:
//   • Curve quality — circular-segment count for spheres/cylinders/etc.
//   • Mesh detail   — global refine() factor (off by default; an opt-in boost
//     mainly useful for finer paint regions).
// Both persist via qualitySettings; the editor's onQualitySettingsChange
// listener re-renders, so we only update our own widgets here.

import {
  loadQualitySettings,
  saveQualitySettings,
  onQualitySettingsChange,
  QUALITY_OPTIONS,
  QUALITY_SEGMENTS,
  REFINE_MIN,
  REFINE_MAX,
  type QualityLevel,
} from '../geometry/qualitySettings';

const inactiveBtnClass = 'px-3 py-2 md:px-2 md:py-1 rounded text-sm md:text-xs bg-zinc-800/80 backdrop-blur text-zinc-400 [@media(hover:hover)]:hover:text-zinc-200 [@media(hover:hover)]:hover:bg-zinc-700/80 transition-colors border border-zinc-600/50';
const activeBtnClass = 'px-3 py-2 md:px-2 md:py-1 rounded text-sm md:text-xs bg-blue-500/30 backdrop-blur text-blue-200 border border-blue-400/60 transition-colors';

const presetInactiveClass = 'px-2 py-1 rounded text-[11px] bg-zinc-700/40 text-zinc-300 hover:bg-zinc-600/60 transition-colors';
const presetActiveClass = 'px-2 py-1 rounded text-[11px] bg-blue-500/30 text-blue-200 ring-1 ring-blue-400/60 transition-colors';

let meshBtn: HTMLButtonElement | null = null;
let panel: HTMLElement | null = null;
let qualityBtns: HTMLButtonElement[] = [];
let detailSlider: HTMLInputElement | null = null;
let detailReadout: HTMLElement | null = null;

export function initMeshSettingsUI(controlsContainer: HTMLElement): void {
  meshBtn = document.createElement('button');
  meshBtn.id = 'mesh-settings-toggle';
  meshBtn.className = inactiveBtnClass;
  meshBtn.textContent = '⬢ Mesh';
  meshBtn.title = 'Mesh settings — curve resolution and global subdivision detail';
  meshBtn.addEventListener('click', togglePanel);

  // Sit next to the other model tools — before the Cross Section toggle.
  const anchor = controlsContainer.querySelector('#clip-toggle');
  if (anchor) controlsContainer.insertBefore(meshBtn, anchor);
  else controlsContainer.appendChild(meshBtn);

  panel = createPanel();
  controlsContainer.appendChild(panel);

  // Close when clicking anywhere outside the panel or its button.
  document.addEventListener('pointerdown', (e) => {
    if (!isOpen()) return;
    const t = e.target as Node;
    if (panel!.contains(t) || meshBtn!.contains(t)) return;
    closePanel();
  });

  onQualitySettingsChange(syncFromSettings);
  syncFromSettings();
}

function isOpen(): boolean {
  return !!panel && !panel.classList.contains('hidden');
}

function togglePanel(): void {
  if (!panel || !meshBtn) return;
  if (isOpen()) { closePanel(); return; }
  panel.classList.remove('hidden');
  meshBtn.className = activeBtnClass;
}

function closePanel(): void {
  if (!panel || !meshBtn) return;
  panel.classList.add('hidden');
  meshBtn.className = inactiveBtnClass;
}

function createPanel(): HTMLElement {
  const p = document.createElement('div');
  p.id = 'mesh-settings-panel';
  p.className = 'hidden absolute top-10 right-2 z-20 bg-zinc-800/95 backdrop-blur border border-zinc-600/60 rounded-lg p-3 shadow-xl';
  p.style.width = '240px';

  // --- Curve quality (circular segments) ---
  const curveLabel = document.createElement('div');
  curveLabel.className = 'text-[10px] text-zinc-500 uppercase tracking-wider mb-1.5 font-medium';
  curveLabel.textContent = 'Curve quality';
  p.appendChild(curveLabel);

  const grid = document.createElement('div');
  grid.className = 'grid grid-cols-2 gap-1.5 mb-3';
  qualityBtns = [];
  for (const opt of QUALITY_OPTIONS) {
    const b = document.createElement('button');
    b.className = presetInactiveClass;
    b.dataset.quality = opt.id;
    b.textContent = opt.label;
    b.title = opt.hint;
    b.addEventListener('click', () => {
      saveQualitySettings({ ...loadQualitySettings(), quality: opt.id as QualityLevel });
    });
    qualityBtns.push(b);
    grid.appendChild(b);
  }
  p.appendChild(grid);

  // --- Mesh detail (refine factor) ---
  const detailHeader = document.createElement('div');
  detailHeader.className = 'flex items-baseline justify-between mb-1';
  const detailLabel = document.createElement('span');
  detailLabel.className = 'text-[10px] text-zinc-500 uppercase tracking-wider font-medium';
  detailLabel.textContent = 'Mesh detail';
  detailReadout = document.createElement('span');
  detailReadout.id = 'mesh-detail-readout';
  detailReadout.className = 'text-xs text-zinc-300 font-mono tabular-nums';
  detailHeader.appendChild(detailLabel);
  detailHeader.appendChild(detailReadout);
  p.appendChild(detailHeader);

  detailSlider = document.createElement('input');
  detailSlider.type = 'range';
  detailSlider.id = 'mesh-detail-slider';
  detailSlider.min = String(REFINE_MIN);
  detailSlider.max = String(REFINE_MAX);
  detailSlider.step = '1';
  detailSlider.className = 'w-full accent-blue-500 cursor-pointer';
  detailSlider.setAttribute('aria-label', 'Mesh detail (refinement factor)');
  detailSlider.addEventListener('input', () => updateReadout(Number(detailSlider!.value)));
  detailSlider.addEventListener('change', () => {
    saveQualitySettings({ ...loadQualitySettings(), refine: Number(detailSlider!.value) });
  });
  p.appendChild(detailSlider);

  const hint = document.createElement('div');
  hint.className = 'mt-1.5 text-[10px] text-zinc-500 leading-snug';
  hint.textContent = 'Subdivides every triangle edge into N pieces (count grows ~N²). Off by default; raise it for finer paint regions.';
  p.appendChild(hint);

  return p;
}

function updateReadout(n: number): void {
  if (detailReadout) detailReadout.textContent = n > 1 ? `${n}×` : 'off';
}

function syncFromSettings(): void {
  const s = loadQualitySettings();
  for (const b of qualityBtns) {
    b.className = b.dataset.quality === s.quality ? presetActiveClass : presetInactiveClass;
    const segs = QUALITY_SEGMENTS[b.dataset.quality as QualityLevel];
    b.title = `${segs} segments per full circle`;
  }
  if (detailSlider) detailSlider.value = String(s.refine);
  updateReadout(s.refine);
}
