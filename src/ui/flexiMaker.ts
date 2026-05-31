import * as THREE from 'three';
import { getScene, requestRender } from '../renderer/viewport';

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

type ConnectorType = 'ball-socket' | 'pin' | 'key-slot' | 'hinge';

interface FlexiState {
  cutOffset: number;
  tiltX: number;
  tiltY: number;
  connectorType: ConnectorType;
  connectorRadius: number;
  connectorDepth: number;
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
  const { cutOffset: h, tiltX: rx, tiltY: ry, connectorType: type } = state;
  const { connectorRadius: r, connectorDepth: depth, tolerance: tol, connectorCount: count } = state;
  const cx = (bounds.min[0] + bounds.max[0]) / 2;
  const cy = (bounds.min[1] + bounds.max[1]) / 2;
  const f = (n: number) => n.toFixed(4);

  // Connector positions spread radially around (cx, cy) at the cut height
  const positions: [number, number][] = count === 1
    ? [[cx, cy]]
    : Array.from({ length: count }, (_, i) => {
        const angle = (2 * Math.PI * i) / count;
        const spread = r * 3;
        return [
          parseFloat((cx + Math.cos(angle) * spread).toFixed(4)),
          parseFloat((cy + Math.sin(angle) * spread).toFixed(4)),
        ];
      });

  // The two half-space cutters use a large box rotated about the cut-plane center.
  // Rotation is around (cx, cy, h): shift to origin, rotate, shift back.
  const cutSetup = `const { Manifold, CrossSection } = api;

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

// Upper half-space (everything above the tilted cut plane)
const _up = Manifold.cube([_S, _S, _S], true)
  .translate([0, 0, _S / 2 + _h])
  .translate([-_cx, -_cy, -_h])
  .rotate([${f(rx)}, ${f(ry)}, 0])
  .translate([_cx, _cy, _h]);

// Lower half-space (everything below the tilted cut plane)
const _dn = Manifold.cube([_S, _S, _S], true)
  .translate([0, 0, -_S / 2 + _h])
  .translate([-_cx, -_cy, -_h])
  .rotate([${f(rx)}, ${f(ry)}, 0])
  .translate([_cx, _cy, _h]);

let _top = _orig.intersect(_up);
let _bot = _orig.intersect(_dn);`;

  if (type === 'ball-socket') {
    const ballCenterZ = f(h - r * 0.5);
    return `${cutSetup}

// Ball on top piece protrudes into socket cavity in bottom piece
for (const [bx, by] of ${JSON.stringify(positions)}) {
  const _ball = Manifold.sphere(${f(r)}, 32).translate([bx, by, ${ballCenterZ}]);
  _top = _top.add(_ball);
  const _sock = Manifold.sphere(${f(r + tol)}, 32).translate([bx, by, ${ballCenterZ}]);
  _bot = _bot.subtract(_sock);
}

const _bb = _top.boundingBox();
const _xOff = (_bb.max[0] - _bb.min[0]) + 8;
return Manifold.compose([_top, _bot.translate([_xOff, 0, 0])]);
`;
  }

  if (type === 'pin') {
    return `${cutSetup}

// Cylinder pin on top piece fits into hole in bottom piece
for (const [px, py] of ${JSON.stringify(positions)}) {
  const _pin = Manifold.cylinder(${f(depth)}, ${f(r)}, ${f(r)}, 24)
    .translate([px, py, ${f(h - depth)}]);
  _top = _top.add(_pin);
  const _hole = Manifold.cylinder(${f(depth + 2)}, ${f(r + tol)}, ${f(r + tol)}, 24)
    .translate([px, py, ${f(h - depth - 0.5)}]);
  _bot = _bot.subtract(_hole);
}

const _bb = _top.boundingBox();
const _xOff = (_bb.max[0] - _bb.min[0]) + 8;
return Manifold.compose([_top, _bot.translate([_xOff, 0, 0])]);
`;
  }

  if (type === 'key-slot') {
    const keyW = f((bounds.max[0] - bounds.min[0]) * 0.6);
    const keyD = f(depth * 0.8);
    return `${cutSetup}

// Rectangular key on top piece slides into slot in bottom piece
{
  const _kw = ${keyW};
  const _kd = ${keyD};
  const _kh = ${f(depth)};
  const _t = ${f(tol)};
  const _key = Manifold.cube([_kw, _kd, _kh])
    .translate([${f(cx)} - _kw / 2, ${f(cy)} - _kd / 2, ${f(h - depth)}]);
  _top = _top.add(_key);
  const _slot = Manifold.cube([_kw + _t * 2, _kd + _t * 2, _kh + _t * 2])
    .translate([${f(cx)} - (_kw + _t * 2) / 2, ${f(cy)} - (_kd + _t * 2) / 2, ${f(h - depth)} - _t]);
  _bot = _bot.subtract(_slot);
}

const _bb = _top.boundingBox();
const _xOff = (_bb.max[0] - _bb.min[0]) + 8;
return Manifold.compose([_top, _bot.translate([_xOff, 0, 0])]);
`;
  }

  // Living-hinge bridge: thin slab straddling the cut plane connects both halves.
  // The bridge overlaps both _top (z > h) and _bot (z < h) by half its thickness,
  // so the final union produces a single connected printable piece that folds at the hinge.
  const bridgeW = f((bounds.max[0] - bounds.min[0]) * 0.6);
  const bridgeL = f(r * 3.5);
  const bridgeT = f(Math.max(0.8, r * 0.22));
  return `${cutSetup}

// Thin bridge straddling cut plane — print as one piece, fold along the hinge
{
  const _bw = ${bridgeW};
  const _bl = ${bridgeL};
  const _bt = ${bridgeT};
  // Bridge centered at cut height, at the Y-min edge of the model
  const _bridge = Manifold.cube([_bw, _bl, _bt], true)
    .translate([${f(cx)}, ${f(bounds.min[1])} + _bl / 2, ${f(h)}]);
  _top = _top.add(_bridge);
}

return _top.add(_bot);
`;
}

// === Panel ===

export function mountFlexiMaker(host: HTMLElement, deps: FlexiMakerDeps): FlexiMakerHandle {
  let previewActive = false;

  // Build initial state from model bounds; refreshed on show()
  function makeDefaultState(): FlexiState {
    const b = deps.getModelBounds();
    const modelSize = b
      ? Math.max(b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2])
      : 20;
    return {
      cutOffset: b ? (b.min[2] + b.max[2]) / 2 : 0,
      tiltX: 0,
      tiltY: 0,
      connectorType: 'ball-socket',
      connectorRadius: Math.round(Math.max(2.5, modelSize * 0.05) * 10) / 10,
      connectorDepth: Math.round(Math.max(4, modelSize * 0.08) * 10) / 10,
      tolerance: 0.25,
      connectorCount: 1,
    };
  }

  const state: FlexiState = makeDefaultState();

  // Panel element
  const panel = document.createElement('div');
  panel.id = 'flexi-maker-panel';
  panel.className =
    'hidden absolute top-2 right-2 z-10 w-[264px] max-w-[calc(100vw-1rem)] ' +
    'max-h-[calc(100%-1rem)] flex flex-col bg-zinc-800/90 backdrop-blur ' +
    'border border-zinc-600/50 rounded-lg shadow-xl overflow-hidden select-none';

  // === Header (draggable) ===
  const header = document.createElement('div');
  header.className =
    'flex items-center gap-2 px-3 py-2 border-b border-zinc-700/70 shrink-0 ' +
    'cursor-grab active:cursor-grabbing touch-none';

  const titleEl = document.createElement('span');
  titleEl.className = 'text-sm font-medium text-zinc-100 flex-1';
  titleEl.textContent = '✂ Flexi-Maker';

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className =
    'shrink-0 w-8 h-8 flex items-center justify-center rounded text-zinc-400 ' +
    'hover:text-zinc-100 hover:bg-zinc-700/70 transition-colors text-lg leading-none';
  closeBtn.textContent = '×';
  closeBtn.title = 'Close Flexi-Maker';
  closeBtn.addEventListener('click', () => handle.hide());

  header.appendChild(titleEl);
  header.appendChild(closeBtn);
  panel.appendChild(header);

  // Drag behavior using Pointer Events (works for mouse + touch)
  let dragging = false, dragOffX = 0, dragOffY = 0;
  header.addEventListener('pointerdown', (e) => {
    if ((e.target as Element).closest('button')) return;
    dragging = true;
    dragOffX = e.clientX - panel.getBoundingClientRect().left;
    dragOffY = e.clientY - panel.getBoundingClientRect().top;
    header.setPointerCapture(e.pointerId);
  });
  header.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const hr = host.getBoundingClientRect();
    const x = Math.max(0, Math.min(e.clientX - hr.left - dragOffX, hr.width - panel.offsetWidth));
    const y = Math.max(0, Math.min(e.clientY - hr.top - dragOffY, hr.height - panel.offsetHeight));
    panel.style.right = 'auto';
    panel.style.bottom = 'auto';
    panel.style.left = `${x}px`;
    panel.style.top = `${y}px`;
  });
  header.addEventListener('pointerup', () => { dragging = false; });
  header.addEventListener('pointercancel', () => { dragging = false; });

  // === Scrollable body ===
  const body = document.createElement('div');
  body.className = 'flex flex-col gap-3 px-3 py-3 overflow-y-auto min-h-0';

  function sectionLbl(text: string): HTMLElement {
    const el = document.createElement('div');
    el.className = 'text-[10px] text-zinc-500 uppercase tracking-wider font-semibold';
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
    input.className = 'w-full h-1.5 accent-cyan-400 cursor-pointer rounded touch-none';

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

  // --- Connector Type ---
  const typeSection = document.createElement('div');
  typeSection.className = 'flex flex-col gap-2';
  typeSection.appendChild(sectionLbl('Connector Type'));

  const TYPES: { id: ConnectorType; label: string; hint: string }[] = [
    { id: 'ball-socket', label: 'Ball-socket', hint: 'Flex in any direction — snakes, dragons' },
    { id: 'pin', label: 'Pin-hole', hint: 'Hinge motion — arms, legs, panels' },
    { id: 'key-slot', label: 'Key-slot', hint: 'Slide-fit halves — boxes, enclosures' },
    { id: 'hinge', label: 'Bridge hinge', hint: 'One-piece print — fold along edge' },
  ];

  const typeGrid = document.createElement('div');
  typeGrid.className = 'grid grid-cols-2 gap-1';

  const activeTypeCls = 'p-1.5 rounded text-left transition-colors bg-cyan-500/20 border border-cyan-500/50 text-cyan-200 cursor-pointer';
  const inactiveTypeCls = 'p-1.5 rounded text-left transition-colors bg-zinc-700/50 border border-zinc-600/50 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700 cursor-pointer';

  const typeBtns = new Map<ConnectorType, HTMLButtonElement>();

  for (const t of TYPES) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = state.connectorType === t.id ? activeTypeCls : inactiveTypeCls;
    btn.title = t.hint;
    btn.innerHTML = `<div class="text-[10px] font-medium leading-tight">${t.label}</div><div class="text-[9px] text-zinc-500 leading-tight mt-0.5">${t.hint}</div>`;
    btn.addEventListener('click', () => {
      state.connectorType = t.id;
      typeBtns.forEach((b, id) => { b.className = id === t.id ? activeTypeCls : inactiveTypeCls; });
      syncCountVisibility();
      onStateChange();
    });
    typeBtns.set(t.id, btn);
    typeGrid.appendChild(btn);
  }

  typeSection.appendChild(typeGrid);
  body.appendChild(typeSection);

  // --- Parameters ---
  const paramSection = document.createElement('div');
  paramSection.className = 'flex flex-col gap-2';
  paramSection.appendChild(sectionLbl('Parameters'));

  const radiusSlider = makeSlider('Connector size', 1, 15, 0.5, state.connectorRadius, ' mm', (v) => {
    state.connectorRadius = v; onStateChange();
  });
  const depthSlider = makeSlider('Depth', 2, 20, 0.5, state.connectorDepth, ' mm', (v) => {
    state.connectorDepth = v; onStateChange();
  });
  const tolSlider = makeSlider('Fit tolerance', 0.05, 1, 0.05, state.tolerance, ' mm', (v) => {
    state.tolerance = v;
  });

  paramSection.appendChild(radiusSlider.el);
  paramSection.appendChild(depthSlider.el);
  paramSection.appendChild(tolSlider.el);

  // Count buttons (hidden for key-slot and hinge)
  const countWrap = document.createElement('div');
  countWrap.className = 'flex flex-col gap-0.5';

  const countTopRow = document.createElement('div');
  countTopRow.className = 'flex items-center justify-between gap-2';
  const countLblEl = document.createElement('span');
  countLblEl.className = 'text-[11px] text-zinc-400';
  countLblEl.textContent = 'Count';

  const countBtnRow = document.createElement('div');
  countBtnRow.className = 'flex gap-1';

  const activeCntCls = 'flex-1 py-1 rounded text-[11px] font-semibold bg-cyan-500/20 border border-cyan-500/50 text-cyan-200 min-w-[28px]';
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
  paramSection.appendChild(countWrap);

  body.appendChild(paramSection);

  function syncCountVisibility(): void {
    countWrap.style.display = (state.connectorType === 'key-slot' || state.connectorType === 'hinge') ? 'none' : '';
  }
  syncCountVisibility();

  // === Status / footer ===
  const statusEl = document.createElement('div');
  statusEl.className = 'text-[10px] text-zinc-500 min-h-[14px] leading-tight px-3 pb-1 shrink-0';

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
    'flex-1 px-2 py-1.5 rounded text-xs bg-cyan-600 text-white font-medium ' +
    'hover:bg-cyan-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed';
  applyBtn.textContent = 'Apply & Save';

  footer.appendChild(previewBtn);
  footer.appendChild(applyBtn);

  panel.appendChild(body);
  panel.appendChild(statusEl);
  panel.appendChild(footer);
  host.appendChild(panel);

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
      preview: 'text-cyan-400', done: 'text-emerald-400', error: 'text-red-400',
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

    const label = `flexi-${state.connectorType}`;
    try {
      const res = await deps.applyCode(generateFlexiCode(deps.getCurrentCode(), state, b), label);
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
      // Re-sync height range with current model
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
      panel.remove();
    },
  };

  return handle;
}
