// Image Paint UI — toggle button + floating draggable panel for stamping an
// image onto the model surface by clicking. Follows the paintUI pattern:
// the panel is right-docked by default, draggable via its header.

import * as THREE from 'three';
import {
  stampImageOntoMesh,
  resizeImageData,
  imageDataToDataUrl,
  loadImageDataFromUrl,
  defaultPreprocess,
  buildTangentFrame,
  compactImageDataUrl,
  type StampImageOptions,
} from './imagePaint';
import type { ImagePaintResult } from './imagePaint';
import {
  addRegion,
  getRegions,
  onChange as onRegionsChange,
  removeLastRegion,
  clearRegionsBySource,
  isVisible as isPaintVisible,
  setVisible as setPaintVisible,
  canUndoClear,
  undoClear,
  onClearSnapshotChange,
  removeRegion,
  setRegionVisibility,
  canRedoRegion,
  redoLastRegion,
} from './regions';
// Read the current mesh through the paintAccessors leaf (published by paintMode)
// rather than importing paintMode directly — same one-way dependency the drag
// tools (boxDrag/slabDrag) use, so this stays a leaf read, not a back-edge.
import { getCurrentMesh as getPaintMesh } from './paintAccessors';
import { deactivateMode, registerExclusiveMode } from '../ui/modeExclusion';
import { forceDeactivate as closeSimplifyMenu } from '../ui/simplifyUI';
import { viewportToolsMount } from '../ui/popoverMenu';
import { createColorSwatch } from '../ui/colorPickerModal';
import { setInitialPanelPosition, attachViewportPanelDrag } from '../ui/viewportPanelDrag';
import { createToolPanelHeader } from '../ui/toolPanel';
import { openViewportPanel, closeViewportPanel } from '../ui/viewportPanelRegistry';
import { forceDeactivate as closeAnnotate } from '../annotations/annotateUI';
import { forceDeactivate as closeAnnotateText } from '../annotations/textMode';
import { forceDeactivate as closeAnnotateSelect } from '../annotations/selectMode';
import { pickFace } from './facePicker';
import { getRenderer, getScene, addPointerSuppressor, isPointerOverModel, requestRender } from '../renderer/viewport';
import type { PreprocessOptions } from '../relief/types';

// Max resolution for stamping — higher = crisper stamp detail.
const STAMP_MAX = 1024;
// Max for the in-panel preview thumbnail (display only, can be lower).
const THUMB_MAX = 512;

// v2: bumped from v1 to invalidate stale JPEG-encoded entries (JPEG has no
// alpha channel; persisting as JPEG then restoring caused the background-
// removal logic to strip black foreground like smiley eyes).
const STORAGE_KEY = 'imagePaint_savedImage_v2';

let imagePaintBtn: HTMLButtonElement | null = null;
let panel: HTMLElement | null = null;
let isOpen = false;

// Current picked image state
let pickedImageData: ImageData | null = null;     // full-res for stamping (≤ STAMP_MAX)
let pickedImageThumb: ImageData | null = null;    // downscaled for the preview canvas
let previewCanvas: HTMLCanvasElement | null = null;
let previewCtx: CanvasRenderingContext2D | null = null;
let sourceLabel: HTMLElement | null = null;

// Settings state
let opts: {
  preprocess: PreprocessOptions;
  removeBackground: boolean;
  manualBgColor?: [number, number, number];
} = {
  preprocess: defaultPreprocess(),
  removeBackground: true,
};

// Stamp settings
let stampSize = 5;         // world units
let stampRotation = 0;     // degrees
let stampSmooth = true;    // subdivide the stamp footprint for crisp detail
let stampDetail = 96;      // smooth mode: target triangle rows across the stamp
                           // width (higher = finer; maxEdge = stampSize/detail)

// Stamp mode (active when panel is open and image is loaded)
let stampModeActive = false;
let removeSuppressor: (() => void) | null = null;
let stampCounter = 0;

// Hover preview overlay (a square outline in the scene)
let previewLines: THREE.LineSegments | null = null;

// Callback registered from main.ts: runs the full stamp-then-refine loop when
// smooth mode is on. Receives the image and options, returns the stamp result
// (already on the refined mesh) plus the parentToChildren remap so existing
// regions stay correct after the subdivision.
type SmoothStampCallback = (
  imageData: ImageData,
  stampOpts: StampImageOptions,
  maxEdge: number,
) => { result: ImagePaintResult; parentToChildren: Map<number, number[]> | null } | null;
let smoothStampCb: SmoothStampCallback | null = null;

export function setSmoothStampCallback(cb: SmoothStampCallback): void {
  smoothStampCb = cb;
}

// The stamp flow (smooth or flat) already produces the final mesh and resolves
// every region's triangles itself, so committing the new stamp region must NOT
// kick off the paint reconciler — when brush strokes (or other refine regions)
// are present the reconciler would rebuild the mesh from base and wipe both the
// just-placed stamp (its colours live in runtime perTriColors, not the
// descriptor) and the existing brush paint. main.ts registers a hook that wraps
// the region commit so it runs with the reconciler suspended, then refreshes the
// composited colours directly. Falls back to running the commit as-is.
type StampCommitHook = (commit: () => void) => void;
let stampCommitHook: StampCommitHook | null = null;

export function setStampCommitHook(hook: StampCommitHook): void {
  stampCommitHook = hook;
}

// Hint element for stamp instructions
let stampHintEl: HTMLElement | null = null;

// Footer button refs for enable/disable sync
let undoBtn: HTMLButtonElement | null = null;
let redoBtn: HTMLButtonElement | null = null;
let undoClearBtn: HTMLButtonElement | null = null;
let visibilityBtn: HTMLButtonElement | null = null;

// Badge on toggle button
let countBadge: HTMLElement | null = null;

export function initImagePaintUI(controlsContainer: HTMLElement): void {
  imagePaintBtn = document.createElement('button');
  imagePaintBtn.id = 'image-paint-toggle';
  imagePaintBtn.className = btnClass(false);
  imagePaintBtn.title = 'Stamp an image onto the model surface as a color region';
  imagePaintBtn.textContent = '🖼️ Image';

  countBadge = document.createElement('span');
  countBadge.className = 'hidden ml-1 px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-blue-500 text-white leading-none';
  imagePaintBtn.appendChild(countBadge);

  imagePaintBtn.addEventListener('click', toggleImagePaint);

  // Insert right after the paint toggle button, within the Tools popover (or the
  // bar itself as fallback). insertBefore needs the same parent as the reference
  // node, so anchor off whichever container actually holds the paint button.
  const toolsMount = viewportToolsMount(controlsContainer);
  const paintBtn = toolsMount.querySelector('#paint-toggle');
  if (paintBtn?.nextSibling) {
    toolsMount.insertBefore(imagePaintBtn, paintBtn.nextSibling);
  } else {
    toolsMount.appendChild(imagePaintBtn);
  }

  panel = buildPanel();
  const host = controlsContainer.parentElement ?? controlsContainer;
  host.appendChild(panel);

  onRegionsChange(() => {
    updateBadge();
    updateFooterButtons();
  });
  onClearSnapshotChange(updateFooterButtons);
  updateBadge();
  updateFooterButtons();
  restorePersistedImage();
}

function toggleImagePaint(): void {
  if (isOpen) {
    closePanel();
  } else {
    // Close conflicting modes
    deactivateMode('paint');
    deactivateMode('voxelStudio');
    closeSimplifyMenu();
    closeAnnotate();
    closeAnnotateText();
    closeAnnotateSelect();
    openPanel();
  }
}

/** Registry entry so opening any other tool panel closes Image Paint, and
 *  opening Image Paint closes whatever else is open (single panel at a time). */
const imagePanelEntry = { close: (): void => { if (isOpen) closePanel(); } };

function onImagePaintEscape(e: KeyboardEvent): void {
  if (e.key !== 'Escape') return;
  // Let a centered dialog (e.g. a confirm) consume Escape first.
  if (document.querySelector('[role="dialog"]')) return;
  if (isOpen) closePanel();
}

function openPanel(): void {
  isOpen = true;
  imagePaintBtn!.className = btnClass(true);
  openViewportPanel(imagePanelEntry); // close any other open tool panel
  panel?.classList.remove('hidden');
  // Desktop: dock beneath the toolbar (or the open Tools menu), right-aligned —
  // same as every other tool panel. Mobile: a bottom sheet positioned by its
  // inset-x classes, so clear any inline offsets left from a desktop session.
  if (panel) {
    if (window.matchMedia('(min-width: 768px)').matches) {
      setInitialPanelPosition(panel);
    } else {
      panel.style.top = ''; panel.style.right = ''; panel.style.left = ''; panel.style.bottom = '';
    }
  }
  document.addEventListener('keydown', onImagePaintEscape);
  updateStampMode();
}

function closePanel(): void {
  isOpen = false;
  imagePaintBtn!.className = btnClass(false);
  panel?.classList.add('hidden');
  document.removeEventListener('keydown', onImagePaintEscape);
  closeViewportPanel(imagePanelEntry);
  updateStampMode();
}

export function forceDeactivate(): void {
  if (isOpen) closePanel();
}
registerExclusiveMode('imagePaint', forceDeactivate);

// ─── Stamp mode ───────────────────────────────────────────────────────────────

function updateStampMode(): void {
  const shouldBeActive = isOpen && pickedImageData !== null;
  if (shouldBeActive === stampModeActive) return;
  if (shouldBeActive) {
    activateStampMode();
  } else {
    deactivateStampMode();
  }
  // Update hint text
  if (stampHintEl) {
    stampHintEl.textContent = pickedImageData !== null
      ? 'Click on model to stamp'
      : 'Load an image to start stamping';
  }
}

function activateStampMode(): void {
  stampModeActive = true;
  const canvas = getRenderer().domElement;
  const container = canvas.parentElement ?? canvas;
  container.addEventListener('pointerdown', onStampPointerDown, { capture: true });
  container.addEventListener('pointermove', onStampPointerMove);
  removeSuppressor = addPointerSuppressor((event) => event.button === 0 && isPointerOverModel(event));
  (container as HTMLElement).style.cursor = 'crosshair';
  ensurePreviewLines();
}

function deactivateStampMode(): void {
  if (!stampModeActive) return;
  stampModeActive = false;
  const canvas = getRenderer().domElement;
  const container = canvas.parentElement ?? canvas;
  container.removeEventListener('pointerdown', onStampPointerDown, { capture: true });
  container.removeEventListener('pointermove', onStampPointerMove);
  if (removeSuppressor) { removeSuppressor(); removeSuppressor = null; }
  (container as HTMLElement).style.cursor = '';
  removePreviewLines();
}

function onStampPointerDown(event: PointerEvent): void {
  if (event.button !== 0) return;
  const hit = pickFace(event as unknown as MouseEvent);
  if (!hit) return;
  executeStamp(hit.point, hit.normal);
}

function onStampPointerMove(event: PointerEvent): void {
  const hit = pickFace(event as unknown as MouseEvent);
  if (!hit) {
    hidePreviewLines();
    return;
  }
  updatePreviewLines(hit.point, hit.normal);
}

// ─── Hover preview (square outline) ──────────────────────────────────────────

function ensurePreviewLines(): void {
  if (previewLines) return;
  // A unit square in the XY plane ([-1,1]²), drawn as 4 line segments.
  const positions = new Float32Array([
    -1, -1, 0,  1, -1, 0,
     1, -1, 0,  1,  1, 0,
     1,  1, 0, -1,  1, 0,
    -1,  1, 0, -1, -1, 0,
  ]);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const mat = new THREE.LineBasicMaterial({
    color: 0xffffff,
    opacity: 0.75,
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });
  previewLines = new THREE.LineSegments(geo, mat);
  previewLines.matrixAutoUpdate = false;
  previewLines.visible = false;
  previewLines.renderOrder = 999;
  getScene().add(previewLines);
}

function removePreviewLines(): void {
  if (!previewLines) return;
  getScene().remove(previewLines);
  previewLines.geometry.dispose();
  (previewLines.material as THREE.Material).dispose();
  previewLines = null;
}

function hidePreviewLines(): void {
  if (previewLines && previewLines.visible) {
    previewLines.visible = false;
    requestRender();
  }
}

function updatePreviewLines(
  hitPoint: [number, number, number],
  hitNormal: [number, number, number],
): void {
  if (!previewLines) return;
  const { tr, br, n } = buildTangentFrame(hitNormal, stampRotation);
  const half = stampSize / 2;
  const [hpX, hpY, hpZ] = hitPoint;
  // Column-major 4×4 matrix: x-axis = tr*half, y-axis = br*half, z-axis = n, pos = hitPoint
  previewLines.matrix.set(
    tr[0] * half, br[0] * half, n[0], hpX,
    tr[1] * half, br[1] * half, n[1], hpY,
    tr[2] * half, br[2] * half, n[2], hpZ,
    0, 0, 0, 1,
  );
  previewLines.matrixWorldNeedsUpdate = true;
  previewLines.visible = true;
  requestRender();
}

function executeStamp(hitPoint: [number, number, number], hitNormal: [number, number, number]): void {
  if (!pickedImageData) return;
  const maxEdge = stampDetail > 0 ? stampSize / stampDetail : 0;
  runStamp({
    imageData: pickedImageData,
    hitPoint,
    hitNormal,
    size: stampSize,
    rotationDeg: stampRotation,
    smooth: stampSmooth && maxEdge > 0,
    maxEdge,
    removeBackground: opts.removeBackground,
    manualBgColor: opts.manualBgColor,
    preprocess: opts.preprocess,
  });
}

interface StampRun {
  imageData: ImageData;
  hitPoint: [number, number, number];
  hitNormal: [number, number, number];
  size: number;
  rotationDeg: number;
  /** Subdivide the stamp footprint for crisp detail (uses the smooth callback). */
  smooth: boolean;
  /** Target triangle edge length when smoothing (stampSize / detail-rows). */
  maxEdge: number;
  removeBackground: boolean;
  manualBgColor?: [number, number, number];
  preprocess: PreprocessOptions;
  name?: string;
}

/** Shared stamp core: compute the per-triangle colours (smooth-subdivided when
 *  asked, else flat on the current mesh) and commit them as an `imagePaint`
 *  region. Used by both the click-driven UI (executeStamp) and the programmatic
 *  `stampImageProgrammatic` API. Returns the committed region summary, or null
 *  when nothing was painted (empty footprint / no mesh). */
function runStamp(r: StampRun): { name: string; triangles: number; avgColor: [number, number, number] } | null {
  const stampOpts: StampImageOptions = {
    hitPoint: r.hitPoint,
    hitNormal: r.hitNormal,
    size: r.size,
    rotationDeg: r.rotationDeg,
    preprocess: { ...r.preprocess },
    removeBackground: r.removeBackground,
    manualBgColor: r.manualBgColor ? [...r.manualBgColor] as [number, number, number] : undefined,
    bgTolerance: 36 * 36 * 3,
  };

  let result: ImagePaintResult;
  const useSmooth = r.smooth && r.maxEdge > 0 && !!smoothStampCb;
  if (useSmooth) {
    // Smooth mode: callback subdivides the stamp footprint to maxEdge (confined
    // to the stamp square), then stamps on the fine mesh — giving crisp detail.
    const refined = smoothStampCb!(r.imageData, stampOpts, r.maxEdge);
    if (!refined || refined.result.entries.length === 0) return null;
    result = refined.result;
  } else {
    const mesh = getPaintMesh();
    if (!mesh) return null;
    result = stampImageOntoMesh(mesh, r.imageData, stampOpts);
    if (result.entries.length === 0) return null;
  }

  stampCounter++;
  const name = r.name ?? `Stamp ${stampCounter}`;
  const triangles = new Set(result.perTriColors.keys());
  const commit = () => addRegion(
    name,
    result.avgColor,
    'imagePaint',
    {
      kind: 'imagePaint',
      entries: useSmooth ? [] : result.entries,
      avgColor: result.avgColor,
      ...(useSmooth ? {
        smooth: true, maxEdge: r.maxEdge,
        hitPoint: r.hitPoint, hitNormal: r.hitNormal, stampSize: r.size, rotationDeg: r.rotationDeg,
        imageDataUrl: compactImageDataUrl(r.imageData),
        removeBackground: r.removeBackground,
        ...(r.manualBgColor ? { manualBgColor: r.manualBgColor } : {}),
        bgTolerance: 36 * 36 * 3,
      } : {}),
    },
    triangles,
    true,
    undefined, // unslotted — image-paint carries per-triangle colours, not a palette slot
    result.perTriColors,
  );
  // Commit through the reconcile-suspending hook when wired (see setStampCommitHook),
  // so adding the stamp can't trigger a mesh rebuild that drops it or existing paint.
  if (stampCommitHook) stampCommitHook(commit);
  else commit();
  return { name, triangles: triangles.size, avgColor: result.avgColor };
}

export interface ProgrammaticStampParams {
  /** Stamp centre on the surface (world coords). */
  hitPoint: [number, number, number];
  /** Outward face direction at the stamp centre. */
  hitNormal: [number, number, number];
  /** Stamp diameter in world units. */
  size: number;
  rotationDeg?: number;
  /** Triangle rows across the stamp; >0 subdivides for crisp detail (default
   *  96, matching the UI). 0 = flat stamp on the existing tessellation. */
  detail?: number;
  removeBackground?: boolean;
  manualBgColor?: [number, number, number];
  preprocess?: PreprocessOptions;
  /** Region label; defaults to "Stamp N". */
  name?: string;
}

/** Stamp `imageData` onto the current mesh programmatically — the engine behind
 *  the Image-paint tool, exposed so `window.partwright.paintImage` can drive it
 *  without a click. Mirrors the UI's executeStamp but takes explicit params
 *  instead of panel state. Returns the committed region summary or null. */
export function stampImageProgrammatic(
  imageData: ImageData,
  params: ProgrammaticStampParams,
): { name: string; triangles: number; avgColor: [number, number, number] } | null {
  const size = params.size;
  const detail = params.detail ?? 96;
  const maxEdge = detail > 0 ? size / detail : 0;
  return runStamp({
    imageData,
    hitPoint: params.hitPoint,
    hitNormal: params.hitNormal,
    size,
    rotationDeg: params.rotationDeg ?? 0,
    smooth: maxEdge > 0,
    maxEdge,
    removeBackground: params.removeBackground ?? true,
    manualBgColor: params.manualBgColor,
    preprocess: params.preprocess ?? defaultPreprocess(),
    name: params.name,
  });
}

// ─── Panel construction ───────────────────────────────────────────────────────

function buildPanel(): HTMLElement {
  const el = document.createElement('div');
  el.id = 'image-paint-panel';
  el.className = [
    'hidden z-20 flex flex-col overflow-hidden bg-zinc-800/95 backdrop-blur border border-zinc-600/60 shadow-xl',
    // Mobile: bottom sheet
    'absolute inset-x-2 bottom-2 top-auto max-h-[60%] rounded-xl',
    // Desktop: right-docked, ~260px wide
    'md:inset-x-auto md:bottom-auto md:left-auto md:right-2 md:top-12 md:w-64 md:max-h-[calc(100%-3.5rem)] md:rounded-lg',
  ].join(' ');

  // ── Header / drag handle (shared tool-panel chrome) ──
  const header = createToolPanelHeader('🖼️ Image Paint', toggleImagePaint, 'Close image paint panel');
  el.appendChild(header);
  attachViewportPanelDrag(header, el);

  // ── Scrollable content ──
  const content = document.createElement('div');
  content.className = 'flex-1 min-h-0 overflow-y-auto px-2.5 py-2.5 flex flex-col gap-3';

  // Image source picker
  content.appendChild(buildImageSection());
  // Image adjustments
  content.appendChild(buildAdjustmentsSection());
  // Background removal
  content.appendChild(buildBackgroundSection());
  // Stamp settings (size + rotation)
  content.appendChild(buildStampSettingsSection());

  // Stamp hint
  stampHintEl = document.createElement('div');
  stampHintEl.className = 'text-[11px] text-zinc-400 text-center py-1';
  stampHintEl.setAttribute('data-stamp-hint', '');
  stampHintEl.textContent = 'Load an image to start stamping';
  content.appendChild(stampHintEl);

  // Region list
  const regionListWrap = document.createElement('div');
  regionListWrap.id = 'image-paint-region-list';
  regionListWrap.className = 'border-t border-zinc-700 pt-2';
  content.appendChild(regionListWrap);
  onRegionsChange(() => updateRegionList(regionListWrap));
  updateRegionList(regionListWrap);

  el.appendChild(content);

  // ── Footer ──
  const footer = document.createElement('div');
  footer.className = 'shrink-0 flex items-center gap-1.5 px-2.5 py-2 border-t border-zinc-700 bg-zinc-800/95 flex-wrap';

  visibilityBtn = document.createElement('button');
  visibilityBtn.className = footerBtnClass();
  visibilityBtn.addEventListener('click', () => setPaintVisible(!isPaintVisible()));
  footer.appendChild(visibilityBtn);

  undoBtn = document.createElement('button');
  undoBtn.className = footerBtnClass();
  undoBtn.textContent = 'Undo';
  undoBtn.title = 'Remove the most recently stamped image region';
  undoBtn.addEventListener('click', removeLastRegion);
  footer.appendChild(undoBtn);

  redoBtn = document.createElement('button');
  redoBtn.className = footerBtnClass();
  redoBtn.textContent = 'Redo';
  redoBtn.title = 'Re-apply the last removed stamp region';
  redoBtn.addEventListener('click', redoLastRegion);
  footer.appendChild(redoBtn);

  undoClearBtn = document.createElement('button');
  undoClearBtn.className = footerBtnClass();
  undoClearBtn.textContent = 'Undo clear';
  undoClearBtn.title = 'Restore all regions removed by the last Clear';
  undoClearBtn.addEventListener('click', undoClear);
  footer.appendChild(undoClearBtn);

  const clearBtn = document.createElement('button');
  clearBtn.className = 'px-2 py-1 rounded text-[10px] bg-red-700/60 text-red-200 hover:bg-red-600/60 transition-colors';
  clearBtn.textContent = 'Clear';
  clearBtn.title = 'Remove all image stamps (keeps brush paint and other regions)';
  clearBtn.addEventListener('click', () => clearRegionsBySource('imagePaint'));
  footer.appendChild(clearBtn);

  el.appendChild(footer);
  updateFooterButtons();

  return el;
}

// ─── Sections ────────────────────────────────────────────────────────────────

function buildImageSection(): HTMLElement {
  const section = document.createElement('div');

  const sectionTitle = sectionLabel('Image');
  section.appendChild(sectionTitle);

  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = 'image/*';
  fileInput.className = 'hidden';

  const pickRow = document.createElement('div');
  pickRow.className = 'flex items-center gap-2';

  const pickBtn = document.createElement('button');
  pickBtn.className = 'px-2.5 py-1 rounded text-[11px] bg-zinc-700/60 text-zinc-200 hover:bg-zinc-600/60 border border-zinc-600/40 transition-colors whitespace-nowrap';
  pickBtn.textContent = 'Choose…';
  pickBtn.addEventListener('click', () => fileInput.click());

  sourceLabel = document.createElement('span');
  sourceLabel.className = 'text-[10px] text-zinc-500 truncate flex-1 min-w-0';
  sourceLabel.textContent = 'No image selected';

  pickRow.appendChild(fileInput);
  pickRow.appendChild(pickBtn);
  pickRow.appendChild(sourceLabel);
  section.appendChild(pickRow);

  // Preview canvas
  const previewWrap = document.createElement('div');
  previewWrap.className = 'mt-1.5 rounded overflow-hidden border border-zinc-700/60 bg-zinc-900/60';

  previewCanvas = document.createElement('canvas');
  previewCanvas.className = 'w-full h-auto block';
  previewCanvas.style.maxHeight = '120px';
  previewCanvas.style.objectFit = 'contain';
  previewCanvas.width = 1;
  previewCanvas.height = 1;
  previewCtx = previewCanvas.getContext('2d');
  previewWrap.appendChild(previewCanvas);
  section.appendChild(previewWrap);

  // File pick handler
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    await applyImageFile(file);
  });

  // Allow drag-drop onto the preview
  previewWrap.addEventListener('dragover', (e) => { e.preventDefault(); });
  previewWrap.addEventListener('drop', async (e) => {
    e.preventDefault();
    const file = e.dataTransfer?.files?.[0];
    if (!file || !file.type.startsWith('image/')) return;
    await applyImageFile(file);
  });

  return section;
}

/** Load a file into ImageData, rendering SVGs at high resolution. */
async function applyImageFile(file: File): Promise<void> {
  const objectUrl = URL.createObjectURL(file);
  try {
    const isSvg = file.type === 'image/svg+xml' || file.name.toLowerCase().endsWith('.svg');
    const raw = await loadImageDataHighRes(objectUrl, isSvg);
    pickedImageData = resizeImageData(raw, STAMP_MAX);
    pickedImageThumb = resizeImageData(raw, THUMB_MAX);
    if (sourceLabel) sourceLabel.textContent = file.name;
    persistImage(pickedImageData);
    renderPreview();
    updateStampMode();
  } catch {
    if (sourceLabel) sourceLabel.textContent = 'Failed to load image';
  } finally {
    // Revoke on every path — a decode failure must not leak the blob (it
    // retains the full file bytes in memory until the page closes).
    URL.revokeObjectURL(objectUrl);
  }
}

function persistImage(imageData: ImageData): void {
  try {
    localStorage.setItem(STORAGE_KEY, imageDataToDataUrl(imageData));
  } catch {
    // localStorage may be full; silently ignore
  }
}

async function restorePersistedImage(): Promise<void> {
  try {
    const dataUrl = localStorage.getItem(STORAGE_KEY);
    if (!dataUrl) return;
    const raw = await loadImageDataFromUrl(dataUrl);
    pickedImageData = resizeImageData(raw, STAMP_MAX);
    pickedImageThumb = resizeImageData(raw, THUMB_MAX);
    if (sourceLabel) sourceLabel.textContent = 'Saved image';
    renderPreview();
    updateStampMode();
  } catch {
    localStorage.removeItem(STORAGE_KEY);
  }
}

/** Like loadImageDataFromUrl but renders SVGs at ≥1024px for quality. */
function loadImageDataHighRes(url: string, isSvg: boolean): Promise<ImageData> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const naturalW = img.naturalWidth || 512;
      const naturalH = img.naturalHeight || 512;
      // For SVGs, render at a multiple of their declared size so vector
      // detail is sharp even if the SVG declares a small width/height.
      const targetW = isSvg ? Math.max(naturalW, 1024) : naturalW;
      const targetH = isSvg ? Math.max(naturalH, 1024) : naturalH;
      const canvas = document.createElement('canvas');
      canvas.width = targetW; canvas.height = targetH;
      const ctx = canvas.getContext('2d');
      if (!ctx) { reject(new Error('Canvas 2D not available')); return; }
      ctx.drawImage(img, 0, 0, targetW, targetH);
      resolve(ctx.getImageData(0, 0, targetW, targetH));
    };
    img.onerror = () => reject(new Error('Failed to load image'));
    img.src = url;
  });
}

function buildAdjustmentsSection(): HTMLElement {
  const section = document.createElement('div');
  section.appendChild(sectionLabel('Adjustments'));

  const grid = document.createElement('div');
  grid.className = 'flex flex-col gap-1.5';

  addSlider(grid, 'Brightness', -1, 1, 0.02, 0,
    () => opts.preprocess.brightness,
    v => { opts.preprocess.brightness = v; renderPreview(); });

  addSlider(grid, 'Contrast', -1, 1, 0.02, 0,
    () => opts.preprocess.contrast,
    v => { opts.preprocess.contrast = v; renderPreview(); });

  addSlider(grid, 'Saturation', -1, 1, 0.02, 0,
    () => opts.preprocess.saturation,
    v => { opts.preprocess.saturation = v; renderPreview(); });

  addSlider(grid, 'Black point', 0, 254, 1, 0,
    () => opts.preprocess.levelsLow,
    v => { opts.preprocess.levelsLow = v; renderPreview(); },
    true);

  addSlider(grid, 'White point', 1, 255, 1, 255,
    () => opts.preprocess.levelsHigh,
    v => { opts.preprocess.levelsHigh = v; renderPreview(); },
    true);

  section.appendChild(grid);
  return section;
}

function buildBackgroundSection(): HTMLElement {
  const section = document.createElement('div');
  section.appendChild(sectionLabel('Background'));

  // Auto-detect toggle
  const autoRow = document.createElement('div');
  autoRow.className = 'flex items-center gap-2';

  const autoCheck = document.createElement('input');
  autoCheck.type = 'checkbox';
  autoCheck.id = 'img-paint-remove-bg';
  autoCheck.className = 'accent-blue-500 w-3.5 h-3.5 shrink-0';
  autoCheck.checked = opts.removeBackground;
  autoCheck.title = 'Auto-detect the dominant border colour and treat it as transparent';

  const autoLabel = document.createElement('label');
  autoLabel.htmlFor = 'img-paint-remove-bg';
  autoLabel.className = 'text-[11px] text-zinc-300 cursor-pointer select-none';
  autoLabel.textContent = 'Remove background (auto)';

  autoRow.appendChild(autoCheck);
  autoRow.appendChild(autoLabel);
  section.appendChild(autoRow);

  // Manual colour-pick row
  const manualRow = document.createElement('div');
  manualRow.className = 'flex items-center gap-2 mt-1';

  const pickerLabel = document.createElement('span');
  pickerLabel.className = 'text-[11px] text-zinc-400 shrink-0';
  pickerLabel.textContent = 'Or pick color:';

  const colorSwatch = createColorSwatch({
    initialHex: '#ffffff',
    title: 'Manually specify the background colour to remove',
    modalTitle: 'Background colour to remove',
    className: 'w-7 h-7 shrink-0 rounded cursor-pointer border border-zinc-600/40 hover:border-white/70 transition-colors',
    onPick: (hex) => {
      opts.manualBgColor = [
        parseInt(hex.slice(1, 3), 16),
        parseInt(hex.slice(3, 5), 16),
        parseInt(hex.slice(5, 7), 16),
      ];
      opts.removeBackground = true;
      autoCheck.checked = true;
      renderPreview();
    },
  });
  const colorInput = colorSwatch.el;

  const colorClear = document.createElement('button');
  colorClear.className = 'text-[10px] text-zinc-500 hover:text-zinc-200 underline-offset-2 hover:underline transition-colors';
  colorClear.textContent = 'clear';
  colorClear.title = 'Revert to auto background detection';

  colorClear.addEventListener('click', () => {
    opts.manualBgColor = undefined;
    renderPreview();
  });

  autoCheck.addEventListener('change', () => {
    opts.removeBackground = autoCheck.checked;
    renderPreview();
  });

  manualRow.appendChild(pickerLabel);
  manualRow.appendChild(colorInput);
  manualRow.appendChild(colorClear);
  section.appendChild(manualRow);

  return section;
}

function buildStampSettingsSection(): HTMLElement {
  const section = document.createElement('div');
  section.appendChild(sectionLabel('Stamp settings'));

  const grid = document.createElement('div');
  grid.className = 'flex flex-col gap-1.5';

  addSlider(grid, 'Size (units)', 1, 200, 1, 20,
    () => stampSize,
    v => { stampSize = v; updatePreviewSize(); },
    true);

  addSlider(grid, 'Rotation (°)', 0, 359, 1, 0,
    () => stampRotation,
    v => { stampRotation = v; },
    true);

  // Smooth mode — subdivides the mesh boundary for crisp stamp edges
  const smoothRow = document.createElement('div');
  smoothRow.className = 'flex items-center gap-2 mt-0.5';

  const smoothToggle = document.createElement('button');
  const maxEdgeRow = document.createElement('div');
  maxEdgeRow.className = 'flex flex-col gap-1.5';

  const syncSmoothUI = (on: boolean): void => {
    smoothToggle.className = on
      ? 'px-2 py-1 rounded text-[10px] bg-blue-600/40 text-blue-200 border border-blue-500/50 transition-colors'
      : 'px-2 py-1 rounded text-[10px] bg-zinc-700/60 text-zinc-300 hover:bg-zinc-600/60 border border-zinc-600/40 transition-colors';
    smoothToggle.textContent = on ? '◉ Smooth edges: On' : '○ Smooth edges: Off';
    maxEdgeRow.classList.toggle('hidden', !on);
  };

  smoothToggle.title = 'Subdivide the stamp footprint so fine image detail is preserved rather than following the coarse base triangles';
  smoothToggle.addEventListener('click', () => {
    stampSmooth = !stampSmooth;
    syncSmoothUI(stampSmooth);
  });
  smoothRow.appendChild(smoothToggle);
  grid.appendChild(smoothRow);

  // Detail = triangle rows across the stamp width (size-independent). The actual
  // target edge length is stampSize / detail, computed at stamp time — so the
  // same Detail gives the same quality regardless of how big the stamp is.
  addSlider(maxEdgeRow, 'Detail', 16, 256, 1, 96,
    () => stampDetail,
    v => { stampDetail = v; },
    true, true /* uncappedInput */);

  const smoothHelp = document.createElement('div');
  smoothHelp.className = 'text-[10px] text-zinc-500';
  smoothHelp.textContent = 'Detail · higher = finer triangles, crisper stamp';
  maxEdgeRow.appendChild(smoothHelp);
  grid.appendChild(maxEdgeRow);

  syncSmoothUI(stampSmooth);

  section.appendChild(grid);
  return section;
}

function updatePreviewSize(): void {
  // If a preview is visible, re-render so the size change is immediate
  if (previewLines?.visible) requestRender();
}

// ─── Preview rendering ────────────────────────────────────────────────────────

function renderPreview(): void {
  const src = pickedImageThumb ?? pickedImageData;
  if (!previewCanvas || !previewCtx || !src) return;

  const { width, height } = src;
  previewCanvas.width = width;
  previewCanvas.height = height;

  const copy = new ImageData(new Uint8ClampedArray(src.data), width, height);
  applyAdjustmentsToCanvas(copy);
  previewCtx.putImageData(copy, 0, 0);
}

function applyAdjustmentsToCanvas(imgData: ImageData): void {
  const { data } = imgData;
  const p = opts.preprocess;
  const noOp = p.brightness === 0 && p.contrast === 0 && p.saturation === 0
    && p.levelsLow === 0 && p.levelsHigh === 255;
  if (noOp && !opts.removeBackground) return;

  const lo = Math.max(0, Math.min(254, p.levelsLow));
  const hi = Math.max(lo + 1, Math.min(255, p.levelsHigh));
  const levelsScale = 255 / (hi - lo);
  const brightAdd = Math.max(-1, Math.min(1, p.brightness)) * 128;
  const c = Math.max(-1, Math.min(1, p.contrast));
  const cf = (259 * (c * 255 + 255)) / (255 * (259 - c * 255));
  const sat = 1 + Math.max(-1, Math.min(1, p.saturation));

  const pixelCount = imgData.width * imgData.height;
  for (let i = 0; i < pixelCount; i++) {
    const o = i * 4;
    let r = data[o], g = data[o + 1], b = data[o + 2];
    r = (r - lo) * levelsScale; g = (g - lo) * levelsScale; b = (b - lo) * levelsScale;
    r += brightAdd; g += brightAdd; b += brightAdd;
    r = cf * (r - 128) + 128; g = cf * (g - 128) + 128; b = cf * (b - 128) + 128;
    const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    r = lum + (r - lum) * sat; g = lum + (g - lum) * sat; b = lum + (b - lum) * sat;
    data[o]   = r < 0 ? 0 : r > 255 ? 255 : r;
    data[o+1] = g < 0 ? 0 : g > 255 ? 255 : g;
    data[o+2] = b < 0 ? 0 : b > 255 ? 255 : b;
  }

  // Grey out background pixels in the preview
  if (opts.removeBackground) {
    // Build a simple background mask for preview using border-color detection
    // (mirrors the real detectBackgroundMask heuristic in imageToRelief)
    const w = imgData.width, h = imgData.height;
    const counts = new Map<number, number>();
    const key = (i: number) => (data[i * 4] << 16) | (data[i * 4 + 1] << 8) | data[i * 4 + 2];
    const bump = (i: number) => counts.set(key(i), (counts.get(key(i)) ?? 0) + 1);
    for (let x = 0; x < w; x++) { bump(x); bump((h - 1) * w + x); }
    for (let y = 0; y < h; y++) { bump(y * w); bump(y * w + w - 1); }
    let bgKey = -1, bgCount = 0;
    for (const [k, n] of counts) if (n > bgCount) { bgCount = n; bgKey = k; }
    const borderTotal = Math.max(1, 2 * (w + h) - 4);
    const bgValid = bgCount / borderTotal >= 0.35;

    if (bgValid || opts.manualBgColor) {
      const bgR = opts.manualBgColor ? opts.manualBgColor[0] : (bgKey >> 16) & 0xff;
      const bgG = opts.manualBgColor ? opts.manualBgColor[1] : (bgKey >> 8) & 0xff;
      const bgB = opts.manualBgColor ? opts.manualBgColor[2] : bgKey & 0xff;
      const tol = 36 * 36 * 3;
      for (let i = 0; i < pixelCount; i++) {
        const o = i * 4;
        const dr = data[o] - bgR, dg = data[o + 1] - bgG, db = data[o + 2] - bgB;
        if (dr * dr + dg * dg + db * db <= tol) {
          data[o] = 60; data[o + 1] = 60; data[o + 2] = 60; data[o + 3] = 80;
        }
      }
    }
  }
}

// ─── Region list ─────────────────────────────────────────────────────────────

function updateRegionList(container: HTMLElement): void {
  container.innerHTML = '';

  const imagePaintRegions = getRegions().filter(r => r.descriptor.kind === 'imagePaint');
  if (imagePaintRegions.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'text-[10px] text-zinc-500 leading-snug';
    empty.textContent = 'No stamps yet. Click on the model to stamp.';
    container.appendChild(empty);
    return;
  }

  const header = document.createElement('div');
  header.className = 'flex items-center justify-between mb-1';
  const lbl = document.createElement('div');
  lbl.className = 'text-[10px] text-zinc-500 uppercase tracking-wider font-medium';
  lbl.textContent = 'Applied stamps';
  const cnt = document.createElement('span');
  cnt.className = 'text-[10px] text-zinc-600 tabular-nums';
  cnt.textContent = String(imagePaintRegions.length);
  header.appendChild(lbl); header.appendChild(cnt);
  container.appendChild(header);

  for (const region of imagePaintRegions) {
    const row = document.createElement('div');
    row.className = 'flex items-center gap-1.5 py-0.5 rounded px-1 -mx-1 hover:bg-zinc-700/40 transition-colors';

    // Color swatch
    const swatch = document.createElement('span');
    swatch.className = 'w-3.5 h-3.5 shrink-0 rounded-sm border border-zinc-500';
    const [r, g, b] = region.color;
    swatch.style.backgroundColor = `rgb(${Math.round(r*255)},${Math.round(g*255)},${Math.round(b*255)})`;
    if (!region.visible) swatch.classList.add('opacity-30');

    const nameEl = document.createElement('span');
    nameEl.className = `text-[11px] truncate flex-1 ${region.visible ? 'text-zinc-400' : 'text-zinc-600 line-through'}`;
    nameEl.textContent = region.name;

    const triCount = document.createElement('span');
    triCount.className = 'text-[10px] text-zinc-600 tabular-nums shrink-0';
    triCount.textContent = `${region.triangles.size}△`;

    const eyeBtn = document.createElement('button');
    eyeBtn.className = 'shrink-0 w-4 h-4 flex items-center justify-center text-zinc-500 hover:text-zinc-200 transition-colors';
    eyeBtn.title = region.visible ? 'Hide region' : 'Show region';
    eyeBtn.innerHTML = region.visible ? eyeSVG() : eyeOffSVG();
    eyeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      setRegionVisibility(region.id, !region.visible);
    });

    const trashBtn = document.createElement('button');
    trashBtn.className = 'shrink-0 w-4 h-4 flex items-center justify-center text-zinc-500 hover:text-red-400 transition-colors';
    trashBtn.title = 'Delete stamp region';
    trashBtn.innerHTML = trashSVG();
    trashBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      removeRegion(region.id);
    });

    row.appendChild(swatch);
    row.appendChild(nameEl);
    row.appendChild(triCount);
    row.appendChild(eyeBtn);
    row.appendChild(trashBtn);
    container.appendChild(row);
  }
}

// ─── Footer state sync ────────────────────────────────────────────────────────

function updateBadge(): void {
  if (!countBadge) return;
  const count = getRegions().filter(r => r.descriptor.kind === 'imagePaint').length;
  if (count > 0) {
    countBadge.textContent = String(count);
    countBadge.classList.remove('hidden');
  } else {
    countBadge.classList.add('hidden');
  }
}

function updateFooterButtons(): void {
  const hasAny = getRegions().length > 0;
  const canUndo = hasAny;

  if (undoBtn) {
    undoBtn.disabled = !canUndo;
    undoBtn.classList.toggle('opacity-40', !canUndo);
    undoBtn.classList.toggle('cursor-not-allowed', !canUndo);
  }

  const canRedo = canRedoRegion();
  if (redoBtn) {
    redoBtn.disabled = !canRedo;
    redoBtn.classList.toggle('opacity-40', !canRedo);
    redoBtn.classList.toggle('cursor-not-allowed', !canRedo);
  }

  const canUndoC = canUndoClear();
  if (undoClearBtn) {
    undoClearBtn.disabled = !canUndoC;
    undoClearBtn.classList.toggle('opacity-40', !canUndoC);
    undoClearBtn.classList.toggle('cursor-not-allowed', !canUndoC);
  }

  if (visibilityBtn) {
    visibilityBtn.textContent = isPaintVisible() ? 'Hide all' : 'Show all';
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function addSlider(
  parent: HTMLElement,
  label: string,
  min: number,
  max: number,
  step: number,
  defaultVal: number,
  get: () => number,
  set: (v: number) => void,
  integer = false,
  uncappedInput = false,
): void {
  const wrap = document.createElement('div');
  wrap.className = 'flex items-center gap-1.5';

  const lbl = document.createElement('span');
  lbl.className = 'text-[10px] text-zinc-500 w-[72px] shrink-0';
  lbl.textContent = label;

  const slider = document.createElement('input');
  slider.type = 'range';
  slider.min = String(min);
  slider.max = String(max);
  slider.step = String(step);
  slider.value = String(get());
  slider.className = 'flex-1 accent-blue-500 min-w-0';

  const numInput = document.createElement('input');
  numInput.type = 'number';
  numInput.min = String(min);
  if (!uncappedInput) numInput.max = String(max);
  numInput.step = String(step);
  numInput.value = integer ? String(Math.round(get())) : get().toFixed(2);
  numInput.className = 'w-14 px-1 py-0.5 text-[11px] bg-zinc-900/70 border border-zinc-600/60 rounded text-zinc-200 text-right tabular-nums';

  slider.addEventListener('input', () => {
    const v = parseFloat(slider.value);
    set(v);
    numInput.value = integer ? String(Math.round(v)) : v.toFixed(2);
  });

  const applyNum = (): void => {
    const raw = parseFloat(numInput.value);
    if (!Number.isFinite(raw)) { numInput.value = integer ? String(Math.round(get())) : get().toFixed(2); return; }
    const v = uncappedInput ? Math.max(min, raw) : Math.max(min, Math.min(max, raw));
    set(v);
    slider.value = String(Math.min(v, max)); // slider stays within its own range
    numInput.value = integer ? String(Math.round(v)) : v.toFixed(2);
  };
  numInput.addEventListener('change', applyNum);
  numInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { applyNum(); numInput.blur(); } });

  // Reset on double-click
  wrap.addEventListener('dblclick', (e) => {
    if (e.target === lbl || e.target === wrap) {
      set(defaultVal);
      slider.value = String(defaultVal);
      numInput.value = integer ? String(Math.round(defaultVal)) : defaultVal.toFixed(2);
    }
  });

  wrap.appendChild(lbl);
  wrap.appendChild(slider);
  wrap.appendChild(numInput);
  parent.appendChild(wrap);
}

function sectionLabel(text: string): HTMLElement {
  const el = document.createElement('div');
  el.className = 'text-[10px] text-zinc-500 uppercase tracking-wider mb-1.5 font-medium';
  el.textContent = text;
  return el;
}

function btnClass(active: boolean): string {
  if (active) {
    return 'px-2 py-1 rounded text-xs bg-blue-500/30 backdrop-blur text-blue-300 border border-blue-500/50 transition-colors';
  }
  return 'px-2 py-1 rounded text-xs bg-zinc-800/80 backdrop-blur text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700/80 transition-colors border border-zinc-600/50';
}

function footerBtnClass(): string {
  return 'px-2 py-1 rounded text-[10px] bg-zinc-700/60 text-zinc-300 hover:bg-zinc-600/60 transition-colors';
}

function eyeSVG(): string {
  return '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" class="w-3.5 h-3.5"><path d="M1 8c1.5-3 4-5 7-5s5.5 2 7 5c-1.5 3-4 5-7 5s-5.5-2-7-5z"/><circle cx="8" cy="8" r="2"/></svg>';
}

function eyeOffSVG(): string {
  return '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" class="w-3.5 h-3.5"><path d="M1 8c1.5-3 4-5 7-5s5.5 2 7 5c-1.5 3-4 5-7 5s-5.5-2-7-5z"/><line x1="2" y1="2" x2="14" y2="14"/></svg>';
}

function trashSVG(): string {
  return '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" class="w-3.5 h-3.5"><path d="M3 4h10M5 4V2.5a1 1 0 011-1h4a1 1 0 011 1V4m-6 0v9.5a1 1 0 001 1h4a1 1 0 001-1V4"/></svg>';
}
