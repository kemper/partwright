import * as THREE from 'three';
import { getScene, requestRender } from '../renderer/viewport';
import { TOOL_PANEL_CLASS, TOOL_PANEL_HEADER, TOOL_PANEL_TITLE, TOOL_PANEL_CLOSE } from './toolPanel';
import { attachViewportPanelDrag, setInitialPanelPosition, type PanelDragHandle } from './viewportPanelDrag';
import { openViewportPanel, closeViewportPanel } from './viewportPanelRegistry';

export interface FlexiMakerDeps {
  getCurrentCode(): string;
  getActiveLanguage(): string;
  previewCode(code: string): Promise<{ error: string | null }>;
  restorePreview(): void;
  applyCode(code: string, label: string): Promise<{ error: string } | void>;
  getModelBounds(): { min: [number, number, number]; max: [number, number, number] } | null;
  onClose(): void;
}

export interface FlexiMakerHandle {
  show(): void;
  hide(): void;
  toggle(): void;
  isOpen(): boolean;
  dispose(): void;
}

interface FlexiState {
  cutOffset: number;
  tiltX: number;
  tiltY: number;
  ringSize: number;
  tolerance: number;
  connectorCount: number;
}

// === Three.js cut plane visualization ===

let cutDisc: THREE.Mesh | null = null;
let cutEdge: THREE.Mesh | null = null;

function showCutPlaneVisual(
  cx: number, cy: number, h: number,
  tiltX: number, tiltY: number,
  bounds: { min: [number, number, number]; max: [number, number, number] },
): void {
  removeCutPlaneVisual();
  const scene = getScene();
  const sizeX = bounds.max[0] - bounds.min[0];
  const sizeY = bounds.max[1] - bounds.min[1];
  const radius = Math.max(sizeX, sizeY) * 0.75;
  const rxR = THREE.MathUtils.degToRad(tiltX);
  const ryR = THREE.MathUtils.degToRad(tiltY);

  const discGeo = new THREE.CircleGeometry(radius, 64);
  const discMat = new THREE.MeshBasicMaterial({
    color: 0x00d4ff, transparent: true, opacity: 0.12,
    side: THREE.DoubleSide, depthWrite: false,
  });
  cutDisc = new THREE.Mesh(discGeo, discMat);
  cutDisc.position.set(cx, cy, h);
  cutDisc.rotation.set(rxR, ryR, 0);
  scene.add(cutDisc);

  const edgeGeo = new THREE.RingGeometry(radius * 0.97, radius, 64);
  const edgeMat = new THREE.MeshBasicMaterial({
    color: 0x00d4ff, side: THREE.DoubleSide,
    transparent: true, opacity: 0.55, depthWrite: false,
  });
  cutEdge = new THREE.Mesh(edgeGeo, edgeMat);
  cutEdge.position.set(cx, cy, h);
  cutEdge.rotation.set(rxR, ryR, 0);
  scene.add(cutEdge);

  requestRender();
}

function removeCutPlaneVisual(): void {
  const scene = getScene();
  if (cutDisc) {
    scene.remove(cutDisc);
    cutDisc.geometry.dispose();
    (cutDisc.material as THREE.Material).dispose();
    cutDisc = null;
  }
  if (cutEdge) {
    scene.remove(cutEdge);
    cutEdge.geometry.dispose();
    (cutEdge.material as THREE.Material).dispose();
    cutEdge = null;
  }
  requestRender();
}

// === Code generation ===

function generateFlexiCode(
  originalCode: string,
  state: FlexiState,
  bounds: { min: [number, number, number]; max: [number, number, number] },
): string {
  const { cutOffset: h, tiltX: rx, tiltY: ry, ringSize: size, tolerance: tol, connectorCount: count } = state;
  const cx = (bounds.min[0] + bounds.max[0]) / 2;
  const cy = (bounds.min[1] + bounds.max[1]) / 2;
  const f = (n: number) => n.toFixed(4);

  // Ring geometry: two perpendicular tori (chain-link style).
  // Ring A (XZ plane, hole faces Y) attaches to bottom half.
  // Ring B (YZ plane, hole faces X) attaches to top half.
  // They're topologically linked with a tol-wide print gap.
  const R = Math.max(1.5, size * 0.38);   // torus center radius
  const r = Math.max(0.5, size * 0.12);   // tube radius
  const offset = r + tol / 2;             // axial offset: gives min surface gap = tol
  const clearR = R + r * 2.2;             // clearance cylinder radius
  const clearH = 2 * (offset + R + r);    // clearance cylinder height (spans both rings)

  // Space connectors evenly along X (non-overlapping clearance zones)
  const spacing = 2 * clearR + size * 0.15;
  const positions: [number, number][] = Array.from({ length: count }, (_, i) => {
    const xOff = (i - (count - 1) / 2) * spacing;
    return [parseFloat((cx + xOff).toFixed(4)), parseFloat(cy.toFixed(4))];
  });

  return `const { Manifold, CrossSection } = api;

const _orig = (() => {
${originalCode}
})();
if (!_orig || typeof _orig.boundingBox !== 'function') {
  throw new Error('Flexi-Maker: original code must return a Manifold object');
}

const _h = ${f(h)};
const _S = 10000;
const _cx = ${f(cx)};
const _cy = ${f(cy)};

// Upper half-space (above the tilted cut plane)
const _up = Manifold.cube([_S, _S, _S], true)
  .translate([0, 0, _S / 2 + _h])
  .translate([-_cx, -_cy, -_h])
  .rotate([${f(rx)}, ${f(ry)}, 0])
  .translate([_cx, _cy, _h]);

// Lower half-space (below the tilted cut plane)
const _dn = Manifold.cube([_S, _S, _S], true)
  .translate([0, 0, -_S / 2 + _h])
  .translate([-_cx, -_cy, -_h])
  .rotate([${f(rx)}, ${f(ry)}, 0])
  .translate([_cx, _cy, _h]);

let _top = _orig.intersect(_up);
let _bot = _orig.intersect(_dn);

// Interlocked ring connectors — print in place as one piece.
// Two perpendicular tori interlock like chain links so the halves articulate
// but can't separate. Minimum print gap between them: ${f(tol)} mm.
const _R = ${f(R)};
const _r = ${f(r)};
const _off = ${f(offset)};

// Base torus in XY plane (revolve around Z). Rotate to get the two perpendicular rings.
const _tube = CrossSection.circle(_r, 24).translate([_R, 0]);
const _torusBase = Manifold.revolve(_tube, 48);
const _ringAbase = _torusBase.rotate([90, 0, 0]); // XZ plane — hole faces Y
const _ringBbase = _torusBase.rotate([0, 90, 0]); // YZ plane — hole faces X

for (const [px, py] of ${JSON.stringify(positions)}) {
  // Hollow out a cylinder through both halves so the ring arms have room to flex.
  const _cyl = Manifold.cylinder(${f(clearH)}, ${f(clearR)}, ${f(clearR)}, 48, true)
    .translate([px, py, _h]);
  _top = _top.subtract(_cyl);
  _bot = _bot.subtract(_cyl);

  // Ring A attaches to bottom half, arms protrude into the cleared top zone.
  _bot = _bot.add(_ringAbase.translate([px, py, _h - _off]));
  // Ring B attaches to top half, arms protrude into the cleared bottom zone.
  _top = _top.add(_ringBbase.translate([px, py, _h + _off]));
}

// Return both halves as a single multi-component manifold — print in place.
return Manifold.compose([_bot, _top]);
`;
}

// === Panel ===

export function mountFlexiMaker(host: HTMLElement, deps: FlexiMakerDeps): FlexiMakerHandle {
  let previewActive = false;
  let dragHandle: PanelDragHandle | null = null;

  function makeDefaultState(): FlexiState {
    const b = deps.getModelBounds();
    const modelSize = b
      ? Math.max(b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2])
      : 20;
    return {
      cutOffset: b ? (b.min[2] + b.max[2]) / 2 : 0,
      tiltX: 0,
      tiltY: 0,
      ringSize: Math.round(Math.max(4, modelSize * 0.12) * 10) / 10,
      tolerance: 0.3,
      connectorCount: 1,
    };
  }

  const state: FlexiState = makeDefaultState();

  // Panel — shared tool-panel chrome (z-20, zinc-800/95, rounded, shadow, etc.)
  const panel = document.createElement('div');
  panel.id = 'flexi-maker-panel';
  panel.className =
    `${TOOL_PANEL_CLASS} hidden w-[264px] max-w-[calc(100vw-1rem)] ` +
    'max-h-[calc(100%-3.5rem)] select-none';

  // Header — shared drag-handle chrome
  const header = document.createElement('div');
  header.className = TOOL_PANEL_HEADER;

  const titleEl = document.createElement('div');
  titleEl.className = TOOL_PANEL_TITLE;
  titleEl.textContent = '✂ Flexi-Maker';
  header.appendChild(titleEl);

  const closeBtn = document.createElement('button');
  closeBtn.className = TOOL_PANEL_CLOSE;
  closeBtn.textContent = '×';
  closeBtn.title = 'Close Flexi-Maker panel';
  closeBtn.setAttribute('aria-label', 'Close Flexi-Maker panel');
  closeBtn.addEventListener('click', () => handle.hide());
  header.appendChild(closeBtn);
  panel.appendChild(header);

  // Scrollable body
  const body = document.createElement('div');
  body.className = 'flex flex-col gap-3 px-3 py-3 overflow-y-auto min-h-0';

  // Description
  const desc = document.createElement('p');
  desc.className = 'text-[10px] text-zinc-500 leading-snug';
  desc.textContent =
    'Splits the model with interlocked ring joints — two perpendicular tori that interlock like chain links so the halves articulate after printing.';
  body.appendChild(desc);

  function sectionLbl(text: string): HTMLElement {
    const el = document.createElement('div');
    el.className = 'text-[10px] text-zinc-500 uppercase tracking-wider font-medium';
    el.textContent = text;
    return el;
  }

  function makeSlider(
    label: string, min: number, max: number, step: number,
    initVal: number, unit: string,
    onChange: (v: number) => void,
  ): { el: HTMLElement; set(v: number): void } {
    const wrap = document.createElement('div');
    wrap.className = 'flex flex-col gap-0.5';

    const topRow = document.createElement('div');
    topRow.className = 'flex items-center justify-between';

    const lbl = document.createElement('span');
    lbl.className = 'text-[11px] text-zinc-400';
    lbl.textContent = label;

    const valLbl = document.createElement('span');
    valLbl.className = 'text-[11px] text-zinc-300 tabular-nums';
    const fmt = (v: number) => unit === '°' ? `${v}°` : unit === ' mm' ? `${v} mm` : String(Math.round(v * 100) / 100);
    valLbl.textContent = fmt(initVal);

    topRow.appendChild(lbl);
    topRow.appendChild(valLbl);

    const input = document.createElement('input');
    input.type = 'range';
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    input.value = String(initVal);
    input.className = 'w-full h-1.5 accent-blue-400 cursor-pointer rounded touch-none';

    input.addEventListener('input', () => {
      const v = parseFloat(input.value);
      valLbl.textContent = fmt(v);
      onChange(v);
    });

    wrap.appendChild(topRow);
    wrap.appendChild(input);
    return { el: wrap, set: (v) => { input.value = String(v); valLbl.textContent = fmt(v); } };
  }

  // --- Cut Plane ---
  const cutSection = document.createElement('div');
  cutSection.className = 'flex flex-col gap-2';
  cutSection.appendChild(sectionLbl('Cut Plane'));

  const b0 = deps.getModelBounds();
  const zMin = b0 ? b0.min[2] : -20;
  const zMax = b0 ? b0.max[2] : 20;
  const zRange = Math.max(zMax - zMin, 1);

  const heightSlider = makeSlider('Height', zMin, zMax, zRange / 200, state.cutOffset, '', (v) => {
    state.cutOffset = v; onStateChange();
  });
  const tiltXSlider = makeSlider('Tilt X', -45, 45, 1, state.tiltX, '°', (v) => {
    state.tiltX = v; onStateChange();
  });
  const tiltYSlider = makeSlider('Tilt Y', -45, 45, 1, state.tiltY, '°', (v) => {
    state.tiltY = v; onStateChange();
  });

  cutSection.appendChild(heightSlider.el);
  cutSection.appendChild(tiltXSlider.el);
  cutSection.appendChild(tiltYSlider.el);
  body.appendChild(cutSection);

  // --- Ring Joint ---
  const ringSection = document.createElement('div');
  ringSection.className = 'flex flex-col gap-2';
  ringSection.appendChild(sectionLbl('Ring Joint'));

  const sizeSlider = makeSlider('Ring size', 2, 20, 0.5, state.ringSize, ' mm', (v) => {
    state.ringSize = v; onStateChange();
  });
  const tolSlider = makeSlider('Print tolerance', 0.1, 0.8, 0.05, state.tolerance, ' mm', (v) => {
    state.tolerance = v;
  });

  ringSection.appendChild(sizeSlider.el);
  ringSection.appendChild(tolSlider.el);

  // Count buttons
  const countWrap = document.createElement('div');
  countWrap.className = 'flex flex-col gap-0.5';

  const countTopRow = document.createElement('div');
  countTopRow.className = 'flex items-center justify-between gap-2';
  const countLblEl = document.createElement('span');
  countLblEl.className = 'text-[11px] text-zinc-400';
  countLblEl.textContent = 'Count';

  const countBtnRow = document.createElement('div');
  countBtnRow.className = 'flex gap-1';

  const activeCntCls = 'flex-1 py-1 rounded text-[11px] font-semibold bg-blue-500/20 border border-blue-500/50 text-blue-300 min-w-[28px]';
  const inactiveCntCls = 'flex-1 py-1 rounded text-[11px] text-zinc-400 bg-zinc-700/50 border border-zinc-600/50 hover:text-zinc-200 min-w-[28px]';

  const cntBtns: HTMLButtonElement[] = [];
  for (let n = 1; n <= 4; n++) {
    const cb = document.createElement('button');
    cb.type = 'button';
    cb.textContent = String(n);
    cb.className = n === state.connectorCount ? activeCntCls : inactiveCntCls;
    cb.addEventListener('click', () => {
      state.connectorCount = n;
      cntBtns.forEach((b, i) => { b.className = (i + 1) === n ? activeCntCls : inactiveCntCls; });
      onStateChange();
    });
    cntBtns.push(cb);
    countBtnRow.appendChild(cb);
  }

  countTopRow.appendChild(countLblEl);
  countTopRow.appendChild(countBtnRow);
  countWrap.appendChild(countTopRow);
  ringSection.appendChild(countWrap);

  body.appendChild(ringSection);

  // Status line
  const statusEl = document.createElement('div');
  statusEl.className = 'text-[10px] text-zinc-500 min-h-[14px] leading-tight px-3 pb-1 shrink-0';

  // Footer
  const footer = document.createElement('div');
  footer.className = 'flex gap-2 px-3 py-2 border-t border-zinc-700/70 shrink-0';

  const previewBtn = document.createElement('button');
  previewBtn.type = 'button';
  previewBtn.className =
    'flex-1 px-2 py-1.5 rounded text-xs bg-zinc-700 border border-zinc-600 ' +
    'text-zinc-200 hover:bg-zinc-600 hover:text-zinc-100 transition-colors';
  previewBtn.textContent = 'Preview cut';

  const applyBtn = document.createElement('button');
  applyBtn.type = 'button';
  applyBtn.className =
    'flex-1 px-2 py-1.5 rounded text-xs bg-blue-600 text-white font-medium ' +
    'hover:bg-blue-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed';
  applyBtn.textContent = 'Apply & Save';

  footer.appendChild(previewBtn);
  footer.appendChild(applyBtn);

  panel.appendChild(body);
  panel.appendChild(statusEl);
  panel.appendChild(footer);
  host.appendChild(panel);

  // Registry entry — enables mutual exclusion with other tool panels
  const registryEntry = { close(): void { handle.hide(); } };

  // Escape-to-close (added/removed on show/hide)
  const onEscape = (e: KeyboardEvent): void => {
    if (e.key !== 'Escape') return;
    if (document.querySelector('[role="dialog"][aria-modal="true"]')) return;
    handle.hide();
  };

  // === Event handlers ===

  function onStateChange(): void {
    const b = deps.getModelBounds();
    if (b) {
      const cx = (b.min[0] + b.max[0]) / 2;
      const cy = (b.min[1] + b.max[1]) / 2;
      showCutPlaneVisual(cx, cy, state.cutOffset, state.tiltX, state.tiltY, b);
    }
    if (previewActive) {
      previewActive = false;
      previewBtn.textContent = 'Preview cut';
      deps.restorePreview();
      setStatus('idle');
    }
  }

  function setStatus(kind: 'idle' | 'running' | 'preview' | 'done' | 'error', msg?: string): void {
    const base = 'text-[10px] min-h-[14px] leading-tight px-3 pb-1 shrink-0 ';
    const colors: Record<string, string> = {
      idle: 'text-zinc-500', running: 'text-zinc-400',
      preview: 'text-blue-400', done: 'text-emerald-400', error: 'text-red-400',
    };
    statusEl.className = base + (colors[kind] ?? 'text-zinc-500');
    const msgs: Record<string, string> = {
      idle: '', running: 'Running…',
      preview: 'Preview active — click again to restore.',
      done: 'Saved as new version.',
    };
    statusEl.textContent = kind === 'error' ? (msg ?? 'Error — check diagnostics.') : (msgs[kind] ?? '');
  }

  previewBtn.addEventListener('click', async () => {
    if (previewActive) {
      previewActive = false;
      previewBtn.textContent = 'Preview cut';
      deps.restorePreview();
      setStatus('idle');
      return;
    }
    if (deps.getActiveLanguage() !== 'manifold-js') {
      setStatus('error', 'Flexi-Maker requires JavaScript (JS) mode.');
      return;
    }
    const b = deps.getModelBounds();
    if (!b) { setStatus('error', 'No model loaded.'); return; }

    setStatus('running');
    const result = await deps.previewCode(generateFlexiCode(deps.getCurrentCode(), state, b));
    if (result.error) {
      setStatus('error', result.error.slice(0, 150));
    } else {
      previewActive = true;
      previewBtn.textContent = 'Restore';
      setStatus('preview');
    }
  });

  applyBtn.addEventListener('click', async () => {
    if (deps.getActiveLanguage() !== 'manifold-js') {
      setStatus('error', 'Flexi-Maker requires JavaScript (JS) mode.');
      return;
    }
    const b = deps.getModelBounds();
    if (!b) { setStatus('error', 'No model loaded.'); return; }

    setStatus('running');
    applyBtn.disabled = true;
    previewBtn.disabled = true;

    try {
      const res = await deps.applyCode(generateFlexiCode(deps.getCurrentCode(), state, b), 'flexi-rings');
      if (res && 'error' in res) {
        setStatus('error', res.error.slice(0, 150));
      } else {
        setStatus('done');
        previewActive = false;
        previewBtn.textContent = 'Preview cut';
      }
    } catch (e) {
      setStatus('error', e instanceof Error ? e.message : String(e));
    } finally {
      applyBtn.disabled = false;
      previewBtn.disabled = false;
    }
  });

  // === Handle ===
  const handle: FlexiMakerHandle = {
    show() {
      if (handle.isOpen()) return;
      panel.classList.remove('hidden');
      setInitialPanelPosition(panel);
      if (!dragHandle) dragHandle = attachViewportPanelDrag(header, panel);
      openViewportPanel(registryEntry);
      document.addEventListener('keydown', onEscape);

      // Sync height range and cut plane visual with current model
      const b = deps.getModelBounds();
      if (b) {
        const mid = (b.min[2] + b.max[2]) / 2;
        state.cutOffset = mid;
        heightSlider.set(mid);
        const cx = (b.min[0] + b.max[0]) / 2;
        const cy = (b.min[1] + b.max[1]) / 2;
        showCutPlaneVisual(cx, cy, mid, state.tiltX, state.tiltY, b);
      }
    },
    hide() {
      panel.classList.add('hidden');
      document.removeEventListener('keydown', onEscape);
      closeViewportPanel(registryEntry);
      removeCutPlaneVisual();
      if (previewActive) { deps.restorePreview(); previewActive = false; }
      previewBtn.textContent = 'Preview cut';
      setStatus('idle');
      deps.onClose();
    },
    toggle() { handle.isOpen() ? handle.hide() : handle.show(); },
    isOpen() { return !panel.classList.contains('hidden'); },
    dispose() {
      removeCutPlaneVisual();
      document.removeEventListener('keydown', onEscape);
      dragHandle?.destroy();
      panel.remove();
    },
  };

  return handle;
}
