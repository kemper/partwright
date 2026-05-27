// Application entry point.
//
// Responsibilities:
//   - Boot the geometry engine, renderer, editor, layout, and AI panel.
//   - Wire cross-module events (route changes, session lifecycle, tab
//     switches, drag-and-drop import).
//   - Build the window.partwright public API surface inside main() and
//     expose it on window for browser-console / AI-agent callers.
//
// What lives elsewhere:
//   - Runtime argument validation: src/validation/apiValidation.ts
//   - Geometry stats + assertion checks: src/geometry/statsComputation.ts
//   - Per-subsystem UI: src/ui/* (toolbar, panels, modals, views)
//   - Storage: src/storage/sessionManager.ts, src/storage/db.ts
//   - AI chat backend: src/ai/* (anthropic, chatLoop, compaction, tools)
//
// Note: most of the window.partwright API is defined as a closure inside
// main() because the methods read editor / engine / session state that
// only exists once the app has bootstrapped. The validation helpers used
// throughout that API are pure and live in the validation module above.

import './style.css';
import { errorLog } from './diagnostics/errorLog';
import { initDiagnosticsPanel, toggleDiagnosticsPanel } from './ui/diagnosticsPanel';
import { initEngine, executeCode, executeCodeAsync, validateCodeAsync, ensureEngineReady, getModule, getActiveLanguage, setActiveLanguage, simplifyInWorker, type Language } from './geometry/engine';
import { onQualitySettingsChange } from './geometry/qualitySettings';
import { sliceAtZ, getBoundingBox } from './geometry/crossSection';
import { initViewport, updateMesh, setOnMeshUpdate, setClipping, setClipZ, getClipState, getCameraState, getCanvas, getMeshGroup, getCamera, setMeasureLock, setUserOrbitLock, isUserOrbitLocked, onUserOrbitLockChange, setDimensionsVisible, isDimensionsVisible, setGridVisible, isGridVisible, setWireframeVisible, isWireframeVisible, onWireframeChange } from './renderer/viewport';
import { renderCompositeCanvas, renderSingleView, renderSingleViewCanvas, renderSliceSVG, setImages as _setImages, clearImages as _clearImages, getImages as _getImages, buildViewCamera, RENDER_VIEW_MODES, EDGE_MODES, STANDARD_VIEWS, type AttachedImage, type RenderViewMode, type EdgeMode } from './renderer/multiview';
import { generateId, getLatestVersion } from './storage/db';
import { setPhantom, clearPhantom, hasPhantom, type PhantomOptions } from './renderer/phantomGeometry';
import { initEditor, setValue, getValue, setLanguage as setEditorLanguage, setEditorDiagnostics, clearEditorDiagnostics, revealFirstDiagnostic, formatCode, getAutoFormat, setAutoFormat, editorContentDiffersFrom } from './editor/codeEditor';
import { createLayout, type TabName } from './ui/layout';
import { createToolbar, isAutoRun, setAutoRun, setToolbarLanguage, setAiToolbarState } from './ui/toolbar';
import { installKeyboardShortcuts } from './ui/keyboardShortcuts';
import { registerCommands } from './ui/commandPalette';
import { showQualitySettingsModal } from './ui/qualitySettingsModal';
import { combo, MOD_LABEL, SHIFT_LABEL, ALT_LABEL } from './ui/shortcutDefs';
import { showToast } from './ui/toast';
import { initAiPanel, setActiveSession as setAiActiveSession, toggleAiPanel, toggleAiPanelFromToolbar } from './ui/aiPanel';
import { mergeChatBucket } from './ai/db';
import { aiConnectionMode, reloadSettingsFromStorage, getRenderBudget, getSpendingSummary, setSpendingMode as applyAiSpendingMode } from './ai/settings';
import { createLandingPage } from './ui/landing';
import { createHelpPage } from './ui/help';
import { showExportOptionsDialog } from './ui/exportOptionsDialog';
import { createCatalogPage, type CatalogManifestEntry } from './ui/catalog';
import { createNotFoundPage } from './ui/notFound';
import { applyRouteMeta, routeTitle, type RouteName } from './seo/meta';
import { createSessionBar } from './ui/sessionBar';
import { createPartList } from './ui/partList';
import { createGalleryView, refreshGallery } from './ui/gallery';
import { createVersionsView, refreshVersions } from './ui/versions';
import { createImagesView, refreshImages } from './ui/imagesView';
import { createDiffView, refreshDiff } from './ui/diffView';
import { createNotesView, refreshNotes } from './ui/notes';
import { initDataExplorer, refreshDataExplorer } from './ui/dataExplorer';
import { initSessionList, showSessionList } from './ui/sessionList';
import { exportGLB, buildGLB } from './export/gltf';
import { exportSTL, buildSTL } from './export/stl';
import { exportOBJ, buildOBJ } from './export/obj';
import { export3MF, build3MF } from './export/threemf';
import { assertFiniteMesh } from './export/meshClean';
import { exportSessionJSON, exportRawCode, buildSessionJSON, buildRawCode } from './export/session';
import { blobToBase64, downloadBlob } from './export/download';
import {
  listExports as listInboxExports,
  getExport as getInboxExport,
  clearExports as clearInboxExports,
  registerExport as registerInboxExport,
} from './export/exportInbox';
import {
  registerImport,
  classifyImportSource,
  type ImportInboxEntry,
} from './import/importInbox';
import { showImportPreview, summarizeSessionImport } from './ui/importPreview';
import { showImportTargetModal } from './ui/importTargetModal';
import { showMergePartsModal } from './ui/mergePartsModal';
import { parseSTL } from './import/parsers/stl';
import { generateImportCode } from './import/codegen';
import { setActiveImports, getActiveImports, type ImportedMesh } from './import/importedMesh';
import type { BuiltExport } from './export/gltf';

/** Register a freshly-built export blob in the inbox so it shows up in Recent Exports. */
function registerExportFromBuilt(built: BuiltExport, source: string): void {
  registerInboxExport(built.blob, built.filename, source, built.mimeType);
}
import type { MeshData, SourceDiagnostic } from './geometry/types';
import { analyzeZProfile, type ZProfile } from './geometry/profileAnalysis';
import { probeAtXY, probeRay, probePixel, measureDistance, type ProbeResult, type GeneralRayResult, type PixelHit, type PixelMiss } from './geometry/rayCast';
import { checkContainment, type ContainmentWarning } from './geometry/containmentCheck';
import { setUnits as _setUnits, getUnits as _getUnits, type UnitSystem } from './geometry/units';
import { initMeasureTool, activate as activateMeasure, deactivate as deactivateMeasure, getState as getMeasureState } from './ui/measureTool';
import { maybeStartTour, resetTour, startTour, isTourCompleted } from './ui/tour';
import { initTooltips } from './ui/tooltip';
import { initTheme, getTheme, setTheme } from './ui/theme';
import type { Theme } from './ui/theme';
import { initPaintUI, isPaintOpen, forceDeactivate as closePaintMenu } from './color/paintUI';
import { initSimplifyUI, isSimplifyOpen, refreshSimplifyIfOpen, forceDeactivate as closeSimplifyMenu, type SimplifyHandlers } from './ui/simplifyUI';
import { updatePaintMesh, setOnRegionPainted, isActive as isPaintActive } from './color/paintMode';
import { initAnnotateUI, isAnnotateOpen, closeMenu as closeAnnotateMenu } from './annotations/annotateUI';
import { isActive as isSelectActive, getSelectedId as getSelectedAnnotationId } from './annotations/selectMode';
import {
  getStrokes as getAnnotationStrokes,
  getTexts as getAnnotationTexts,
  getCount as getAnnotationCount,
  clearStrokes as clearStrokesStore,
  clearTexts as clearTextsStore,
  clearAll as clearAllAnnotations,
  loadFromSerialized as loadAnnotations,
  removeLastAnnotation,
  removeAnnotationById,
  type SerializedAnnotation,
} from './annotations/annotations';
import {
  setAnnotationsVisible as setAnnotationsVisibleOverlay,
  isAnnotationsVisible as isAnnotationsVisibleOverlay,
} from './annotations/annotationOverlay';
import { setColor as setAnnotateColor, setWidth as setAnnotateWidth, getWidth as getAnnotateWidth } from './annotations/annotateMode';
import { addTextAnnotationAtAnchor, setFontSize as setAnnotateFontSize, getFontSize as getAnnotateFontSize } from './annotations/textMode';
import { restoreView as restoreAnnotationViewById } from './annotations/selectMode';
import { applyTriColors, applyTriColorsIfVisible, hasRegions as hasColorRegions, onChange as onColorRegionsChange, onVisibilityChange as onPaintVisibilityChange, clearRegions, serialize as serializeRegions, addRegion, getRegions, removeRegion, removeLastRegion, redoLastRegion, setRegionVisibility, setRegionTriangles, buildTriColors, createEmptyTriColors, overlayPainted, type SerializedColorRegion, type RegionDescriptor } from './color/regions';
import { setBucketTolerance as setPaintBucketTolerance, getBucketTolerance as getPaintBucketTolerance, setBrushRadius as setPaintBrushRadius, getBrushRadius as getPaintBrushRadius, setBrushSmooth as setPaintBrushSmooth, isBrushSmooth as isPaintBrushSmooth, setBrushSmoothDivisor as setPaintBrushSmoothDivisor, getBrushSmoothDivisor as getPaintBrushSmoothDivisor, setBrushSurface as setPaintBrushSurface, getBrushSurface as getPaintBrushSurface, setBrushPaintDepth as setPaintBrushDepth, getBrushPaintDepth as getPaintBrushDepth, SMOOTH_DIVISOR_MIN, SMOOTH_DIVISOR_MAX } from './color/paintMode';
import { buildStrokeMesh, buildRefinedMesh, brushRefineRegion, strokeFootprintTriangles, deriveSampleNormals, buildGeodesicField, tangentBasis, childrenByParent, type BrushStroke, type BrushShape, type RefineRegion } from './color/subdivide';
import { refineInWorker, SubdivisionAbortError, terminateSubdivisionWorker } from './color/subdivisionClient';
import { startProgress, endProgress, __setProgressModalDelayForTests } from './ui/progressModal';
import { initEditorLock, syncLockState, setUnlockHandlers } from './color/editorLock';
import { buildAdjacency, findCoplanarRegion, findConnectedFromSeed, resolveSeed, findNearestTriangle, type AdjacencyGraph } from './color/adjacency';
import { findSlabTriangles, slabRefineRegion, smoothEdgeForResolution } from './color/slabPaint';
import { findBoxTriangles, findShapeTriangles, shapeRefineRegion } from './color/boxPaint';
import { computeFaceGroups } from './color/faceGroups';
import {
  getSessionIdFromURL,
  getVersionFromURL,
  getPartIdFromURL,
  openSession,
  createSession,
  closeSession,
  listSessions,
  deleteSession,
  renameSession,
  setSessionLanguage,
  saveVersion,
  navigateVersion,
  loadVersion as loadVersionFromStore,
  peekVersion,
  listCurrentVersions,
  listCurrentParts,
  getCurrentPart,
  createPart,
  changePart,
  renamePart,
  deletePart,
  deleteParts,
  reorderParts,
  getState,
  getSessionUrl,
  getGalleryUrl,
  exportSession,
  importSession,
  clearAllSessions,
  saveImages as persistImages,
  getImagesFromSession,
  addSessionNote,
  listSessionNotes,
  deleteIfEmpty,
  deleteSessionNote,
  updateSessionNote,
  getSessionContext,
  recordError,
  onStateChange,
  initSessionTabSync,
  setViewerPredicate,
  refreshCurrentSession,
  type ExportedSession,
  type ExportOptions,
} from './storage/sessionManager';
import { acquireSession as acquireSessionLock, initSessionLeader, onOwnershipChange } from './storage/sessionLock';
import { initViewerMode, isReadOnlyViewer } from './ui/viewerMode';
import type { Version, Part } from './storage/db';
import {
  ValidationError,
  guard,
  assertString,
  assertNumber,
  assertBoolean,
  assertObject,
  assertFunction,
  assertEnum,
  assertNumberTuple,
  assertArray,
  assertNoUnknownKeys,
  validateAssertionsShape,
} from './validation/apiValidation';
import {
  simpleHash,
  bboxFromMesh,
  computeGeometryStats,
  computeStatDiff,
  checkAssertions,
  type GeometryAssertions,
} from './geometry/statsComputation';

// Load examples as raw text — JS and SCAD
const jsExampleModules = import.meta.glob('../examples/*.js', { query: '?raw', import: 'default' });
const scadExampleModules = import.meta.glob('../examples/*.scad', { query: '?raw', import: 'default' });

export interface ExampleEntry {
  code: string;
  language: Language;
}

let currentMeshData: MeshData | null = null;
/** The pristine mesh produced by the authored code, before any smooth brush
 *  subdivision. `currentMeshData` equals this until a `brushStroke` region
 *  exists, at which point it becomes the refined (subdivided) mesh rebuilt by
 *  `rebuildPaintedGeometry`. Kept so the refinement can always be rebuilt from
 *  a clean base and so unlocking can restore the original tessellation. */
let paintBaseMesh: MeshData | null = null;
/** The ordered brushStroke descriptors the current refined mesh was built from.
 *  Lets the regions-change reconcile detect a pure append (paint one more
 *  stroke) and refine incrementally from the current mesh, instead of replaying
 *  every stroke from the base (which is O(strokes²) and made painting lag). */
let lastStrokeList: RegionDescriptor[] = [];
/** Set while rehydration adds regions in bulk, so each addRegion doesn't kick
 *  off a reconcile mid-rebuild. */
let suspendReconcile = false;
/** Reconcile state for the async (worker-backed) paint pipeline. Region-change
 *  notifications fire frequently while the user paints; we coalesce them so at
 *  most one worker job runs at a time and any later notifications collapse into
 *  a single re-reconcile after the in-flight job lands.
 *    - `asyncReconcileInFlight`: a job is running or being post-processed.
 *    - `asyncReconcileDirty`: a region change arrived during a running job;
 *      the post-job loop re-runs once it lands.
 *    - `paintAbort`: cancels the running worker job (Cancel button or an
 *      agent-API sync action that's taking over). */
let asyncReconcileInFlight = false;
let asyncReconcileDirty = false;
let paintAbort: AbortController | null = null;
/** Id of the in-flight progress-modal job for the active worker call (paint
 *  subdivision). Tracked so a stale endProgress from a superseded job can't
 *  dismiss the new modal. */
let paintProgressId: number | null = null;
/** Monotonic generation tag for paint state. Incremented every time the sync
 *  agent-API path (`withSyncReconcile`) mutates the region store while an
 *  async worker job is in flight, so the worker's continuation can detect
 *  that it was superseded and discard its result instead of clobbering the
 *  mesh / region triangles the sync work just produced. Each async tick
 *  captures the generation at start and checks it on completion. */
let paintGeneration = 0;
/** Set when `withSyncReconcile` aborts an in-flight worker job because a
 *  sync agent action is taking over. Tells `handlePaintCancel` not to
 *  surface a "Painting cancelled." toast or remove the in-flight stroke as
 *  an orphan — neither applies to an internal abort. Cleared after the
 *  cancel handler runs. */
let pendingInternalAbort = false;
/** Deferred that resolves once `asyncReconcileInFlight` flips false (so any
 *  coalesced follow-ups have also drained). `partwright.waitForPaint()` and
 *  the e2e tests that drive the brush via mouse events await this to know
 *  when the worker has applied results. */
let paintIdleDeferred: { promise: Promise<void>; resolve: () => void } | null = null;
function paintIdlePromise(): Promise<void> {
  if (!asyncReconcileInFlight) return Promise.resolve();
  if (!paintIdleDeferred) {
    let resolve!: () => void;
    const promise = new Promise<void>(r => { resolve = r; });
    paintIdleDeferred = { promise, resolve };
  }
  return paintIdleDeferred.promise;
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let currentManifold: any = null;
/** Per-run map from labels (assigned in user code via api.label(shape, name))
 *  to the triangle ids that came from the labelled input. Rebuilt on every
 *  successful run; null when no labels were registered or no code has run. */
let currentLabelMap: Map<string, Set<number>> | null = null;

// #geometry-data element — always-updated machine-readable state
let geometryDataEl: HTMLElement;

/** Paint selector containment test. `centroid` is the historical default
 *  (a triangle is in the selection when its centroid lies inside the
 *  box / sphere / slab). `fully_inside` and `any_vertex_inside` are
 *  per-vertex tests that defang the long radial triangles produced by
 *  cylinder / revolve / linear_extrude — those can have a centroid in
 *  the selection while extending visibly far outside it ("bleed"). */
export const COVERAGE_MODES = ['centroid', 'fully_inside', 'any_vertex_inside'] as const;
export type CoverageMode = typeof COVERAGE_MODES[number];

// === Document title management ===
// Actively manage document.title to reflect current state.
// Some browser automation tools (MCP servers, extensions) can inadvertently
// replace the page title with JS evaluation results; this prevents that.
const BASE_TITLE = 'Partwright';
let _expectedTitle = 'Partwright — AI-Driven Parametric CAD in Your Browser';

function updateDocumentTitle(context?: { page?: 'landing' | 'editor' | 'help' | '404' | 'catalog'; sessionName?: string | null }) {
  let route: RouteName;
  let titleOverride: string | undefined;
  if (context?.page === 'landing' || (context?.page === undefined && shouldShowLanding())) {
    route = 'landing';
  } else if (context?.page === 'help') {
    route = 'help';
  } else if (context?.page === 'catalog') {
    route = 'catalog';
  } else if (context?.page === '404') {
    route = '404';
  } else {
    route = 'editor';
    const name = context?.sessionName ?? getState().session?.name;
    if (name) titleOverride = `${name} — ${BASE_TITLE}`;
  }
  _expectedTitle = titleOverride ?? routeTitle(route);
  applyRouteMeta(route, titleOverride ? { title: _expectedTitle } : undefined);
}

// Guard against external title mutations (e.g. browser automation eval results)
function installTitleGuard() {
  const titleEl = document.querySelector('title');
  if (!titleEl) return;
  new MutationObserver(() => {
    if (document.title !== _expectedTitle) {
      document.title = _expectedTitle;
    }
  }).observe(titleEl, { childList: true, characterData: true, subtree: true });
}

function createGeometryDataElement(): HTMLElement {
  const el = document.createElement('pre');
  el.id = 'geometry-data';
  el.className = 'sr-only';
  el.setAttribute('aria-hidden', 'true');
  el.textContent = '{}';
  document.body.appendChild(el);
  return el;
}

function firstErrorLine(error: string): string {
  return error
    .split('\n')
    .map(line => line.trim())
    .find(Boolean) ?? error;
}

function summarizeDiagnostics(error: string, diagnostics: SourceDiagnostic[] = []): string {
  const primary = diagnostics[0];
  if (primary?.line) {
    const label = primary.source === 'OpenSCAD' ? 'OpenSCAD error' : 'Syntax error';
    return `${label} on line ${primary.line}${primary.column ? `:${primary.column}` : ''}`;
  }

  const summary = firstErrorLine(error);
  return summary.length > 80 ? `${summary.slice(0, 77)}...` : summary;
}

function renderEditorError(panel: HTMLElement, error: string, diagnostics: SourceDiagnostic[] = []): void {
  const primary = diagnostics[0];
  const title = document.createElement('div');
  title.className = 'font-semibold text-red-200';
  title.textContent = summarizeDiagnostics(error, diagnostics);

  const location = document.createElement('div');
  location.className = 'mt-1 text-red-200/80';
  location.textContent = primary?.line
    ? `${primary.source ?? 'Error'} at line ${primary.line}${primary.column ? `, column ${primary.column}` : ''}`
    : primary?.source ?? 'Error';

  const details = document.createElement('pre');
  details.className = 'mt-2 max-h-32 overflow-auto whitespace-pre-wrap font-mono text-[11px] leading-4 text-red-100/90';
  details.textContent = error;

  panel.replaceChildren(title, location, details);

  if (primary?.hint) {
    const hint = document.createElement('div');
    hint.className = 'mt-2 text-red-100';
    hint.textContent = `Hint: ${primary.hint}`;
    panel.appendChild(hint);
  }

  panel.classList.remove('hidden');
}

function clearEditorErrorPanel(panel: HTMLElement): void {
  panel.classList.add('hidden');
  panel.replaceChildren();
}

// Surface session URLs in geometry-data so they're accessible even when
// getGalleryUrl() is sandbox-blocked. Shared by the live geometry-data panel
// and the off-screen version snapshot below so both carry the same context.
function withSessionContext(data: Record<string, unknown>): Record<string, unknown> {
  const state = getState();
  if (state.session) {
    data.sessionId = state.session.id;
    data.sessionUrl = getSessionUrl();
    data.galleryUrl = getGalleryUrl();
  }
  return data;
}

function updateGeometryData(executionTimeMs?: number, sourceCode?: string) {
  if (!currentMeshData) {
    geometryDataEl.textContent = JSON.stringify({ status: 'error', error: 'No geometry' });
    return;
  }

  // currentManifold may be null for render-only imports (sculpted STLs that
  // can't form a watertight manifold). computeGeometryStats degrades gracefully.
  const data = withSessionContext(computeGeometryStats(currentManifold, currentMeshData, executionTimeMs, sourceCode));
  geometryDataEl.textContent = JSON.stringify(data, null, 2);
}

/** How long to wait for `canvas.toBlob` before giving up on the thumbnail.
 *  `toBlob` can stall indefinitely when encoding a 2D canvas that a WebGL render
 *  was composited into (observed after painting subdivides + colors the mesh) —
 *  the GPU readback never settles the callback. A thumbnail is non-essential, so
 *  we cap the wait and let the save proceed without it rather than hang forever
 *  (which silently blocked saving a painted version). */
const THUMBNAIL_TIMEOUT_MS = 4000;

function captureThumbnail(mesh: MeshData | null = currentMeshData): Promise<Blob | null> {
  if (!mesh) return Promise.resolve(null);
  let canvas: HTMLCanvasElement;
  try {
    canvas = renderSingleViewCanvas(applyTriColorsIfVisible(mesh), {
      elevation: STANDARD_VIEWS.iso.elevation,
      azimuth: STANDARD_VIEWS.iso.azimuth,
      ortho: STANDARD_VIEWS.iso.ortho,
    });
  } catch {
    return Promise.resolve(null);
  }
  return new Promise(resolve => {
    let settled = false;
    const finish = (b: Blob | null): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(b);
    };
    // Bound the wait: if toBlob never calls back, resolve null so the caller
    // (save / snapshot) still completes.
    const timer = setTimeout(() => finish(null), THUMBNAIL_TIMEOUT_MS);
    try {
      canvas.toBlob(b => finish(b), 'image/png');
    } catch {
      finish(null);
    }
  });
}

// Capture a thumbnail + geometry-data for an arbitrary `mesh` without touching
// the live viewport (no updateMesh call → no flicker). Builds a throwaway
// Manifold purely for the volumetric stats and releases it. Used to snapshot
// the pre-simplify baseline as its own version during a simplify save.
async function snapshotMeshAsVersion(
  mesh: MeshData,
  sourceCode: string,
): Promise<{ thumbnail: Blob | null; geometryData: Record<string, unknown> | null }> {
  const thumbnail = await captureThumbnail(mesh);
  const mod = getModule();
  const manifold = mod ? mod.Manifold.ofMesh(mesh) : null;
  try {
    const geometryData = withSessionContext(computeGeometryStats(manifold, mesh, undefined, sourceCode));
    return { thumbnail, geometryData };
  } finally {
    if (manifold && typeof manifold.delete === 'function') {
      try { manifold.delete(); } catch { /* already deleted */ }
    }
  }
}

function getGeometryDataObj(): Record<string, unknown> | null {
  try {
    return JSON.parse(geometryDataEl.textContent || '{}');
  } catch {
    return null;
  }
}

/** Swap the in-memory annotation store to the version's snapshot.
 *  Treats absence as "empty", so navigating to a version without annotations
 *  clears any that were on screen for the previously-active version. */
function applyVersionAnnotations(version: Version | null | undefined): void {
  const snapshot = (version?.annotations ?? []) as SerializedAnnotation[];
  loadAnnotations(snapshot);
}

/** Rehydrate color regions from a version's geometryData.
 *  Rebuilds adjacency + BFS for coplanar descriptors against the current mesh.
 *  Returns the names of regions that resolved to ≥1 triangle (`carried`) vs.
 *  those whose descriptor no longer matches the current geometry (`dropped`),
 *  so callers transferring colors across versions can report what landed. */
/** True when a descriptor drives mesh subdivision: any brush stroke, or a slab /
 *  oriented shape with smoothing enabled (`smooth` + a positive `maxEdge`).
 *  Descriptors saved before smoothing existed omit those fields and refine
 *  nothing, preserving their original blocky edges. */
function descriptorRefines(d: RegionDescriptor): boolean {
  if (d.kind === 'brushStroke') return true;
  if (d.kind === 'slab' || d.kind === 'box') return !!d.smooth && (d.maxEdge ?? 0) > 0;
  return false;
}

/** Build the ordered refine regions (brush footprints, slab/shape boundaries)
 *  from a descriptor list. Drives the local subdivision so painted edges follow
 *  the analytic boundary rather than the coarse base tessellation. */
function collectRefineRegions(descriptors: RegionDescriptor[]): RefineRegion[] {
  const regions: RefineRegion[] = [];
  for (const d of descriptors) {
    if (d.kind === 'brushStroke') {
      regions.push(brushRefineRegion(descriptorToStroke(d)));
    } else if (d.kind === 'slab' && descriptorRefines(d)) {
      regions.push(slabRefineRegion(d.normal, d.offset, d.thickness, d.maxEdge!));
    } else if (d.kind === 'box' && descriptorRefines(d)) {
      regions.push(shapeRefineRegion(d.shape ?? 'box', { center: d.center, size: d.size, quaternion: d.quaternion }, d.maxEdge!));
    }
  }
  return regions;
}

/** True when any current region drives subdivision (see `descriptorRefines`). */
function hasRefineDescriptors(): boolean {
  return getRegions().some(r => descriptorRefines(r.descriptor));
}

/** Refine a base mesh under the given descriptors. Returns the mesh unchanged
 *  with `parentToChildren: null` when nothing refines (the common case — no
 *  subdivision, identity mapping). */
function refineMeshForRegions(
  base: MeshData,
  descriptors: RegionDescriptor[],
): { mesh: MeshData; parentToChildren: Map<number, number[]> | null } {
  const regions = collectRefineRegions(descriptors);
  if (regions.length === 0) return { mesh: base, parentToChildren: null };
  const { mesh, childToParent } = buildRefinedMesh(base, regions);
  return { mesh, parentToChildren: childrenByParent(childToParent) };
}

/** Above this triangle count we warn (once) that the model is getting heavy.
 *  There is no hard cap — painting keeps working; this is just a heads-up. */
const HIGH_COMPLEXITY_TRIANGLES = 1_000_000;
let complexityWarned = false;

/** Refresh the live triangle-count readout and, once, warn when the displayed
 *  mesh gets heavy. Driven by every viewport mesh update (run, paint, simplify,
 *  clear). Resets the warning when the mesh drops back below the threshold. */
function refreshTriangleCount(numTri: number): void {
  const el = document.getElementById('triangle-count');
  if (el) el.textContent = `${numTri.toLocaleString()} tris`;
  if (numTri >= HIGH_COMPLEXITY_TRIANGLES) {
    if (!complexityWarned) {
      complexityWarned = true;
      showToast(`Model complexity is high (${numTri.toLocaleString()} triangles) — painting still works, but it may slow down. Clear colors or lower Edge smoothing to lighten it.`, { variant: 'warn', durationMs: 5000 });
    }
  } else if (numTri < HIGH_COMPLEXITY_TRIANGLES * 0.8) {
    complexityWarned = false; // re-arm once well below the threshold
  }
}

/** Map base-mesh triangle ids onto the refined mesh. With no subdivision
 *  (`parentToChildren` null) the ids are used as-is. */
function remapTriangleIds(ids: Iterable<number>, parentToChildren: Map<number, number[]> | null): Set<number> {
  if (!parentToChildren) return new Set(ids);
  const out = new Set<number>();
  for (const id of ids) {
    const children = parentToChildren.get(id);
    if (children) for (const c of children) out.add(c);
  }
  return out;
}

/** Resolve a single region descriptor to a triangle set on `mesh`. Shared by
 *  rehydration (loading a saved version) and the live rebuild after a smooth
 *  brush stroke changes the working mesh. */
function resolveDescriptorTriangles(
  descriptor: RegionDescriptor,
  mesh: MeshData,
  adjacency: AdjacencyGraph | null,
  parentToChildren: Map<number, number[]> | null,
): Set<number> {
  switch (descriptor.kind) {
    case 'coplanar': {
      if (!adjacency) return new Set<number>();
      const { seedPoint, seedNormal, normalTolerance } = descriptor;
      const seedTri = resolveSeed(seedPoint, seedNormal, mesh, adjacency, normalTolerance);
      return seedTri >= 0 ? findCoplanarRegion(seedTri, adjacency, normalTolerance) : new Set<number>();
    }
    case 'triangles':
      // Raw ids index the base tessellation; carry them across any subdivision.
      return remapTriangleIds(descriptor.ids, parentToChildren);
    case 'slab': {
      const { normal, offset, thickness } = descriptor;
      return findSlabTriangles(mesh, normal, offset, thickness);
    }
    case 'box': {
      const { center, size, quaternion, shape } = descriptor;
      return findShapeTriangles(mesh, shape ?? 'box', { center, size, quaternion });
    }
    case 'byLabel': {
      // Labels are runtime state — manifold-3d assigns fresh originalIDs on
      // every run, so we re-resolve by name from the labelMap the engine just
      // built (it indexes the base mesh, hence the remap). Missing label →
      // empty set → region drops silently.
      const ids = currentLabelMap?.get(descriptor.label);
      return ids ? remapTriangleIds(ids, parentToChildren) : new Set<number>();
    }
    case 'connectedFromSeed': {
      if (!adjacency) return new Set<number>();
      const { seedPoint, seedNormal, maxDeviationDeg } = descriptor;
      // Find the closest triangle to the seed point — robust across re-runs
      // because triangle indices are unstable but world-space points are not.
      // Then BFS-flood gated by deviation from the stored seed normal.
      const nearest = findNearestTriangle(seedPoint, mesh, adjacency);
      if (nearest.triIndex < 0) return new Set<number>();
      const cos = Math.cos(maxDeviationDeg * Math.PI / 180);
      let triangles = findConnectedFromSeed(nearest.triIndex, adjacency, cos);
      const sNorm = adjacency.normals;
      const dotSeed = sNorm[nearest.triIndex * 3] * seedNormal[0]
                    + sNorm[nearest.triIndex * 3 + 1] * seedNormal[1]
                    + sNorm[nearest.triIndex * 3 + 2] * seedNormal[2];
      if (dotSeed < cos) {
        // Surface re-orientation between runs — re-filter conservatively.
        const filtered = new Set<number>();
        for (const t of triangles) {
          const nx = sNorm[t * 3], ny = sNorm[t * 3 + 1], nz = sNorm[t * 3 + 2];
          const d = seedNormal[0] * nx + seedNormal[1] * ny + seedNormal[2] * nz;
          if (d >= cos) filtered.add(t);
        }
        triangles = filtered;
      }
      return triangles;
    }
    case 'brushStroke':
      return strokeFootprintTriangles(mesh, descriptorToStroke(descriptor));
  }
}

/** Normalize a brushStroke descriptor to a BrushStroke, filling a sane default
 *  maxEdge (matching the default detail divisor) for any malformed/legacy data.
 *  For the `slab` surface constraint, derives a per-sample surface normal from
 *  the pristine base mesh (stable across reloads) when the descriptor doesn't
 *  carry one, and defaults `depth` to half the radius when unset (0/omitted). */
// Resolved-stroke cache: descriptorToStroke is called for the same descriptor
// both when collecting refine regions and when resolving triangles (and again on
// every later reconcile). Building the geodesic field / sample normals is the
// expensive part, and it only depends on the descriptor + the pristine base
// mesh — so memoize per descriptor, rebuilding only when the base changes (a new
// code run). WeakMap so dropped regions are collected automatically.
const strokeCache = new WeakMap<object, { base: MeshData; stroke: BrushStroke }>();

function descriptorToStroke(d: Extract<RegionDescriptor, { kind: 'brushStroke' }>): BrushStroke {
  const cacheBase = paintBaseMesh ?? currentMeshData;
  const cached = strokeCache.get(d);
  if (cached && cached.base === cacheBase) return cached.stroke;
  // An airbrush spray is always geodesic (surface-following, no through-wall).
  const surface = d.spray ? 'geodesic' : (d.surface ?? 'slab');
  const stroke: BrushStroke = {
    samples: d.samples,
    radius: d.radius,
    shape: d.shape,
    maxEdge: d.maxEdge > 0 ? d.maxEdge : d.radius / 256,
    surface,
    depth: d.depth !== undefined && d.depth > 0 ? d.depth : d.radius * 0.5,
    spray: d.spray,
  };
  const base = paintBaseMesh ?? currentMeshData;
  if (base) {
    if (surface === 'geodesic') {
      stroke.geoField = buildGeodesicField(base, d.samples, d.radius);
    } else {
      stroke.sampleNormals = deriveSampleNormals(d.samples, base);
      stroke.sampleTangents = stroke.sampleNormals.map(tangentBasis);
    }
    strokeCache.set(d, { base, stroke });
  }
  return stroke;
}

/** Cancel any in-flight subdivision worker job and reset the async paint state.
 *  Called before paths that wholesale replace the region store (session
 *  rehydrate, unlock-to-edit), so a worker continuation can't land on the new
 *  state and stamp stale triangle ids onto fresh regions. The worker process
 *  itself is terminated; a fresh one spins up on the next refine. */
function resetPaintWorkerState(): void {
  paintGeneration++;
  pendingInternalAbort = false;
  asyncReconcileInFlight = false;
  asyncReconcileDirty = false;
  paintAbort = null;
  terminateSubdivisionWorker();
  if (paintProgressId !== null) {
    endProgress(paintProgressId);
    paintProgressId = null;
  }
  if (paintIdleDeferred) {
    const d = paintIdleDeferred;
    paintIdleDeferred = null;
    d.resolve();
  }
}

/** True when any in-memory region is a smooth brush stroke (which drives mesh
 *  subdivision). */
function rehydrateColorRegions(geometryData: Record<string, unknown> | null): { carried: string[]; dropped: string[] } {
  // Drop any in-flight worker job before we wipe + replace the region store;
  // otherwise its continuation could overwrite the freshly-rehydrated mesh
  // and stamp triangles onto regions that no longer exist.
  resetPaintWorkerState();
  clearRegions();

  const report: { carried: string[]; dropped: string[] } = { carried: [], dropped: [] };
  if (!geometryData || !currentMeshData) return report;
  const regions = geometryData.colorRegions as SerializedColorRegion[] | undefined;
  if (!regions || regions.length === 0) return report;

  // Refine the pristine base mesh under any smooth strokes/slabs/shapes before
  // resolving. Without refine regions this is a no-op and currentMeshData is
  // left untouched (identical to the pre-subdivision behavior).
  const base = paintBaseMesh ?? currentMeshData;
  const { mesh, parentToChildren } = refineMeshForRegions(base, regions.map(r => r.descriptor));
  if (parentToChildren) {
    currentMeshData = mesh;
    updatePaintMesh(mesh);
  }
  const adjacency = buildAdjacency(mesh);

  // Bulk-add the resolved regions without letting each addRegion trigger a
  // reconcile (we've already built the mesh here).
  suspendReconcile = true;
  for (const region of regions) {
    const triangles = resolveDescriptorTriangles(region.descriptor, mesh, adjacency, parentToChildren);
    if (triangles.size > 0) {
      addRegion(region.name, region.color, region.source, region.descriptor, triangles, region.visible !== false);
      report.carried.push(region.name);
    } else {
      report.dropped.push(region.name);
    }
  }
  suspendReconcile = false;
  lastStrokeList = getRegions().map(r => r.descriptor).filter(d => d.kind === 'brushStroke');

  syncLockState();

  // Re-render with colors if regions were rehydrated
  if (hasColorRegions() && currentMeshData) {
    const colored = applyTriColorsIfVisible(currentMeshData);
    updateMesh(colored, { skipAutoFrame: true });
  }

  return report;
}

function paintedColorRefresh(): void {
  if (!currentMeshData) return;
  const colored = applyTriColorsIfVisible(currentMeshData);
  updateMesh(colored, { skipAutoFrame: true });
}

/** Full rebuild: refine the pristine base by every current stroke and re-resolve
 *  all regions. Used on undo/clear/non-stroke changes (when an incremental
 *  append doesn't apply) — not on the hot path of painting more strokes. */
function rebuildPaintedGeometry(): void {
  const base = paintBaseMesh;
  if (!base) return;
  const { mesh, parentToChildren } = refineMeshForRegions(base, getRegions().map(r => r.descriptor));
  currentMeshData = mesh;
  updatePaintMesh(mesh);
  const adjacency = buildAdjacency(mesh);
  for (const region of getRegions()) {
    setRegionTriangles(region.id, resolveDescriptorTriangles(region.descriptor, mesh, adjacency, parentToChildren));
  }
  paintedColorRefresh();
  syncLockState();
}

/** Incrementally refine the CURRENT mesh by a single newly-added stroke, instead
 *  of replaying every stroke from the base. Existing regions' triangles are
 *  carried across the local subdivision via the parent→children map (O(painted
 *  triangles)); only the new stroke is resolved by footprint. This is the hot
 *  path while painting and keeps each stroke ~constant-time regardless of how
 *  many strokes precede it. */
function appendStrokeRefine(descriptor: Extract<RegionDescriptor, { kind: 'brushStroke' }>): void {
  if (!currentMeshData) return;
  const { mesh, childToParent } = buildStrokeMesh(currentMeshData, [descriptorToStroke(descriptor)]);
  const parentToChildren = childrenByParent(childToParent);
  currentMeshData = mesh;
  updatePaintMesh(mesh);
  // Triangles of the prior mesh that this stroke actually split (>1 child).
  // Only regions touching those need descriptor re-resolution; everyone else is
  // untouched, so forward-carrying their set (each unsplit triangle → its single
  // child) equals what a reload would re-resolve — and is far cheaper.
  const splitParents = new Set<number>();
  for (const [parent, children] of parentToChildren) if (children.length > 1) splitParents.add(parent);

  // A region must be re-resolved by descriptor when it's freshly added (no
  // triangles yet, e.g. the new stroke) or overlaps the split — because a
  // spatial/footprint/flood descriptor's split children can fall outside it,
  // which a naive parent→children carry would wrongly keep. Explicit sets
  // (triangles/byLabel) always carry forward. This keeps the live result
  // identical to a reload (determinism) while staying ~O(painted) per stroke.
  let adjacency: AdjacencyGraph | null = null;
  const overlapsSplit = (region: { triangles: Set<number> }): boolean => {
    if (region.triangles.size === 0) return true;
    for (const t of region.triangles) if (splitParents.has(t)) return true;
    return false;
  };
  for (const region of getRegions()) {
    const d = region.descriptor;
    if (d.kind === 'triangles' || d.kind === 'byLabel' || !overlapsSplit(region)) {
      setRegionTriangles(region.id, remapTriangleIds(region.triangles, parentToChildren));
    } else {
      if (!adjacency && (d.kind === 'coplanar' || d.kind === 'connectedFromSeed')) adjacency = buildAdjacency(mesh);
      setRegionTriangles(region.id, resolveDescriptorTriangles(d, mesh, adjacency, parentToChildren));
    }
  }
  paintedColorRefresh();
  syncLockState();
}

function strokeDescriptors(): RegionDescriptor[] {
  return getRegions().map(r => r.descriptor).filter(d => d.kind === 'brushStroke');
}

/** Synchronous mirror of `reconcilePaintedGeometryAsync` — the agent paint
 *  APIs (paintStroke, paintAirbrush, paintSlab w/ smoothing, paintInOrientedBox
 *  w/ smoothing) need an immediate, populated result from a single function
 *  call. Routing those through the worker-backed listener would force every
 *  callsite to be `await`-aware (and break the existing console / test
 *  contract). So they suspend the async listener, mutate the region store,
 *  then call this helper to do the same work the listener would have done —
 *  but inline, on the main thread, blocking until the refined region's
 *  triangles are populated. */
function reconcilePaintedGeometrySync(): void {
  syncLockState();
  const strokesNow = strokeDescriptors();
  const refinedActive = currentMeshData !== paintBaseMesh || hasRefineDescriptors();
  if (!refinedActive) {
    lastStrokeList = [];
    if (isPaintActive()) paintedColorRefresh();
    return;
  }
  if (strokesNow.length === lastStrokeList.length + 1 && prefixRefEqual(strokesNow, lastStrokeList)) {
    const newDesc = strokesNow[strokesNow.length - 1] as Extract<RegionDescriptor, { kind: 'brushStroke' }>;
    appendStrokeRefine(newDesc);
    lastStrokeList = strokesNow;
    return;
  }
  rebuildPaintedGeometry();
  lastStrokeList = strokesNow;
}

/** Run a region-mutation action with the async listener suspended, then drive
 *  the sync reconciler so any refining descriptors fully resolve before the
 *  caller returns. Used by the agent APIs to preserve their pre-existing
 *  "result is populated on return" contract.
 *
 *  If a worker job is currently in flight (e.g. the user is mid-stroke and
 *  then the agent fires `paintStroke` / `clearColors`), we abort it and bump
 *  `paintGeneration` so the worker's continuation discards its result instead
 *  of overwriting the mesh + region triangles the sync rebuild just
 *  produced. `pendingInternalAbort` tells the abort handler not to surface a
 *  user-facing toast — the agent action took over by design. */
function withSyncReconcile<T>(action: () => T): T {
  paintGeneration++;
  if (asyncReconcileInFlight) {
    pendingInternalAbort = true;
    paintAbort?.abort();
  }
  const prev = suspendReconcile;
  suspendReconcile = true;
  try {
    const result = action();
    reconcilePaintedGeometrySync();
    return result;
  } finally {
    suspendReconcile = prev;
  }
}

/** Add a brushStroke region and synchronously refine the mesh under it. */
function paintBrushStrokeSync(
  name: string,
  color: [number, number, number],
  descriptor: Extract<RegionDescriptor, { kind: 'brushStroke' }>,
): { id: number; name: string; triangles: Set<number> } {
  return withSyncReconcile(() => addRegion(name, color, 'paintbrush', descriptor, new Set<number>()));
}

/** True when `a` starts with exactly the entries of `b` (by reference). */
function prefixRefEqual(a: RegionDescriptor[], b: RegionDescriptor[]): boolean {
  if (a.length < b.length) return false;
  for (let i = 0; i < b.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** Async reconciler used by the regions-change listener: dispatches the heavy
 *  subdivision to a Web Worker so the main thread stays responsive on max
 *  settings (where a single stroke could otherwise hang the tab for seconds).
 *
 *  Coalescing rule: at most one worker job runs at a time. Changes that arrive
 *  while a job is in flight set `asyncReconcileDirty`; the post-job tail
 *  re-runs reconcile from the latest state. The agent-API path (paintStroke /
 *  paintAirbrush) explicitly bypasses this with `suspendReconcile` + a direct
 *  call to the sync `appendStrokeRefine`, so console-driven painting still
 *  returns a populated region synchronously. */
async function reconcilePaintedGeometryAsync(): Promise<void> {
  if (suspendReconcile) return;
  if (asyncReconcileInFlight) {
    asyncReconcileDirty = true;
    return;
  }
  asyncReconcileInFlight = true;
  try {
    do {
      asyncReconcileDirty = false;
      await reconcilePaintedGeometryAsyncTick();
    } while (asyncReconcileDirty && !suspendReconcile);
  } finally {
    asyncReconcileInFlight = false;
    if (paintIdleDeferred) {
      const d = paintIdleDeferred;
      paintIdleDeferred = null;
      d.resolve();
    }
  }
}

async function reconcilePaintedGeometryAsyncTick(): Promise<void> {
  syncLockState();
  const strokesNow = strokeDescriptors();
  const refinedActive = currentMeshData !== paintBaseMesh || hasRefineDescriptors();
  if (!refinedActive) {
    lastStrokeList = [];
    if (isPaintActive()) paintedColorRefresh();
    return;
  }

  // Pure append: one new stroke at the end, prior strokes unchanged.
  if (strokesNow.length === lastStrokeList.length + 1 && prefixRefEqual(strokesNow, lastStrokeList)) {
    const newDesc = strokesNow[strokesNow.length - 1] as Extract<RegionDescriptor, { kind: 'brushStroke' }>;
    try {
      await appendStrokeRefineAsync(newDesc);
      // Region set may have shifted while the await was in flight (coalesced
      // changes, or an agent-API sync action via withSyncReconcile). Re-read.
      lastStrokeList = strokeDescriptors();
    } catch (err) {
      if (isAbortError(err)) {
        handlePaintCancel();
      } else {
        // eslint-disable-next-line no-console
        console.error('[paint] async append failed, falling back to sync rebuild', err);
        rebuildPaintedGeometry();
        lastStrokeList = strokeDescriptors();
      }
    }
    return;
  }

  try {
    await rebuildPaintedGeometryAsync();
    lastStrokeList = strokeDescriptors();
  } catch (err) {
    if (isAbortError(err)) {
      handlePaintCancel();
    } else {
      // eslint-disable-next-line no-console
      console.error('[paint] async rebuild failed, falling back to sync rebuild', err);
      rebuildPaintedGeometry();
      lastStrokeList = strokeDescriptors();
    }
  }
}

function isAbortError(err: unknown): boolean {
  return err instanceof SubdivisionAbortError
    || (err instanceof Error && err.name === 'AbortError');
}

/** Worker-backed incremental append. Mirrors the sync `appendStrokeRefine`
 *  but offloads `buildStrokeMesh` to a dedicated thread, so a heavy stroke
 *  doesn't freeze the viewport. The Cancel button on the progress badge
 *  aborts the in-flight job. */
async function appendStrokeRefineAsync(
  descriptor: Extract<RegionDescriptor, { kind: 'brushStroke' }>,
): Promise<void> {
  if (!currentMeshData) return;
  const base = paintBaseMesh ?? currentMeshData;
  const inputMesh = currentMeshData;

  paintAbort = new AbortController();
  const abort = paintAbort;
  const myGen = paintGeneration;
  const progressId = startProgress({
    title: 'Painting',
    message: 'Refining mesh under the stroke…',
    onCancel: () => abort.abort(),
    // The subdivision pipeline is one big buildRefinedMesh call with
    // variable pass count — no natural fraction to report. The animated
    // indeterminate stripe still telegraphs "something's happening."
    indeterminate: true,
  });
  paintProgressId = progressId;

  try {
    const { mesh, childToParent, brushStrokeTriangles } = await refineInWorker({
      base,
      input: inputMesh,
      descriptors: [descriptor],
      signal: abort.signal,
    });
    // If a sync agent action (withSyncReconcile) mutated paint state while
    // this worker job was running, the mesh / regions we'd apply are stale.
    // Drop the result silently — the sync path already produced the right
    // state, and our `finally` still cleans up the progress badge.
    if (myGen !== paintGeneration) return;
    currentMeshData = mesh;
    updatePaintMesh(mesh);
    const parentToChildren = childrenByParent(childToParent);

    // Re-resolve regions exactly like the sync path: forward-carry triangles
    // for regions untouched by the split, re-resolve those overlapping the
    // split, and use the worker-provided footprint for the new stroke.
    const splitParents = new Set<number>();
    for (const [parent, children] of parentToChildren) if (children.length > 1) splitParents.add(parent);
    const newTris = brushStrokeTriangles.get(0);

    let adjacency: AdjacencyGraph | null = null;
    const overlapsSplit = (region: { triangles: Set<number> }): boolean => {
      if (region.triangles.size === 0) return true;
      for (const t of region.triangles) if (splitParents.has(t)) return true;
      return false;
    };
    for (const region of getRegions()) {
      const d = region.descriptor;
      if (d === descriptor) {
        setRegionTriangles(region.id, newTris ? new Set(newTris) : new Set<number>());
      } else if (d.kind === 'triangles' || d.kind === 'byLabel' || !overlapsSplit(region)) {
        setRegionTriangles(region.id, remapTriangleIds(region.triangles, parentToChildren));
      } else {
        if (!adjacency && (d.kind === 'coplanar' || d.kind === 'connectedFromSeed')) adjacency = buildAdjacency(mesh);
        setRegionTriangles(region.id, resolveDescriptorTriangles(d, mesh, adjacency, parentToChildren));
      }
    }
    paintedColorRefresh();
    syncLockState();
  } finally {
    endProgress(progressId);
    if (paintProgressId === progressId) paintProgressId = null;
    paintAbort = null;
  }
}

/** Worker-backed full rebuild. Used by the async reconcile path for undo /
 *  clear / mixed region changes. Brush-stroke descriptors get their footprint
 *  triangles resolved inside the worker (it already has the resolved stroke
 *  with its geodesic field); other descriptor kinds are resolved on the main
 *  thread via the usual adjacency / engine-label paths. */
async function rebuildPaintedGeometryAsync(): Promise<void> {
  const base = paintBaseMesh;
  if (!base) return;
  const descriptors = getRegions().map(r => r.descriptor);
  if (!descriptors.some(descriptorRefines)) {
    // Nothing to subdivide — sync path is already trivial; reuse it.
    rebuildPaintedGeometry();
    return;
  }

  paintAbort = new AbortController();
  const abort = paintAbort;
  const myGen = paintGeneration;
  const progressId = startProgress({
    title: 'Painting',
    message: 'Rebuilding refined mesh…',
    onCancel: () => abort.abort(),
    indeterminate: true,
  });
  paintProgressId = progressId;

  try {
    const { mesh, childToParent, brushStrokeTriangles } = await refineInWorker({
      base,
      input: base,
      descriptors,
      signal: abort.signal,
    });
    // See appendStrokeRefineAsync: drop stale results when a sync action ran.
    if (myGen !== paintGeneration) return;
    currentMeshData = mesh;
    updatePaintMesh(mesh);
    const parentToChildren = childrenByParent(childToParent);
    const adjacency = buildAdjacency(mesh);

    const regions = getRegions();
    for (const region of regions) {
      const d = region.descriptor;
      const idx = descriptors.indexOf(d);
      const workerTris = idx >= 0 ? brushStrokeTriangles.get(idx) : undefined;
      if (workerTris) {
        setRegionTriangles(region.id, new Set(workerTris));
      } else {
        setRegionTriangles(region.id, resolveDescriptorTriangles(d, mesh, adjacency, parentToChildren));
      }
    }
    paintedColorRefresh();
    syncLockState();
  } finally {
    endProgress(progressId);
    if (paintProgressId === progressId) paintProgressId = null;
    paintAbort = null;
  }
}

/** Worker job ended via abort. Two cases:
 *    - User clicked Cancel: drop the orphaned brushStroke region (added on
 *      mouseup but never resolved), surface a toast, and let
 *      `lastStrokeList` reflect the post-removal state.
 *    - `withSyncReconcile` aborted us so an agent action could take over
 *      (`pendingInternalAbort`): the sync rebuild has already produced
 *      correct state — don't remove anything, don't toast, just let the
 *      pending-promise unwind clean up.
 *
 *  `appendStrokeRefineAsync` / `rebuildPaintedGeometryAsync`'s finally has
 *  already cleared `paintAbort` and dismissed the progress modal by the
 *  time we get here. */
function handlePaintCancel(): void {
  if (pendingInternalAbort) {
    pendingInternalAbort = false;
    // Sync work owns the post-state; just refresh lastStrokeList against
    // whatever it produced and return.
    lastStrokeList = strokeDescriptors();
    return;
  }

  // Real user-initiated cancel. The mesh is still pre-stroke (the worker
  // never applied a result, since the rejection happened before the apply).
  // Drop any orphaned brushStroke regions (empty triangles → unresolved).
  const orphans = getRegions().filter(r => r.descriptor.kind === 'brushStroke' && r.triangles.size === 0);
  if (orphans.length > 0) {
    suspendReconcile = true;
    try {
      for (const r of orphans) removeRegion(r.id);
    } finally {
      suspendReconcile = false;
    }
  }
  lastStrokeList = strokeDescriptors();
  paintedColorRefresh();
  syncLockState();
  showToast('Painting cancelled.', { variant: 'neutral' });
}

/** Pull a version's serialized color regions out of its geometryData blob
 *  (where saveVersion persists them via enrichGeometryDataWithColors).
 *  Returns [] when the version has no colors. */
function versionColorRegions(v: Version | null | undefined): SerializedColorRegion[] {
  const nested = (v?.geometryData as Record<string, unknown> | null | undefined)?.colorRegions;
  return Array.isArray(nested) ? (nested as SerializedColorRegion[]) : [];
}

/** Compact line-level diff for surfacing what a fork/transform actually
 *  changed in the source — the cheapest way for an agent to confirm a
 *  patch landed (a no-op patch shows `changed: false`). LCS-based so
 *  insertions/deletions align; output is capped to keep the token cost of
 *  a large rewrite bounded. */
function computeCodeDiff(before: string, after: string, maxLines = 60): { changed: boolean; added: number; removed: number; diff: string | null } {
  if (before === after) return { changed: false, added: 0, removed: 0, diff: null };
  const a = before.split('\n');
  const b = after.split('\n');
  const n = a.length, m = b.length;
  // The LCS table below is O(n·m). CAD scripts are small, but guard against a
  // pathologically large rewrite by falling back to a cheap multiset line
  // count (still surfaces "something changed" without allocating a huge table).
  if (n * m > 2_000_000) {
    const minus = (from: string[], against: string[]): number => {
      const counts = new Map<string, number>();
      for (const l of against) counts.set(l, (counts.get(l) ?? 0) + 1);
      let extra = 0;
      for (const l of from) {
        const c = counts.get(l) ?? 0;
        if (c > 0) counts.set(l, c - 1); else extra++;
      }
      return extra;
    };
    return { changed: true, added: minus(b, a), removed: minus(a, b), diff: '(diff too large to render line-by-line)' };
  }
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const lines: string[] = [];
  let added = 0, removed = 0, i = 0, j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { lines.push(`- ${a[i]}`); removed++; i++; }
    else { lines.push(`+ ${b[j]}`); added++; j++; }
  }
  while (i < n) { lines.push(`- ${a[i]}`); removed++; i++; }
  while (j < m) { lines.push(`+ ${b[j]}`); added++; j++; }
  const diff = lines.length > maxLines
    ? `${lines.slice(0, maxLines).join('\n')}\n… (${lines.length - maxLines} more changed lines)`
    : lines.join('\n');
  return { changed: true, added, removed, diff };
}

/** Include color regions in geometry data for saving. */
function enrichGeometryDataWithColors(geoData: Record<string, unknown> | null): Record<string, unknown> | null {
  if (!geoData) return geoData;
  if (hasColorRegions()) {
    geoData.colorRegions = serializeRegions();
  }
  return geoData;
}

/** Snapshot the current editor code + geometry + paint regions + annotations
 *  as a new version in the active session. Shared by the
 *  window.partwright.saveVersion() API and the mod+S keyboard shortcut.
 *  Returns `{ id, index, label }` on success, `{ error }` when no session is
 *  active, or `{ skipped }` when nothing changed since the current version. */
async function saveCurrentVersion(label?: string): Promise<
  | { error: string }
  | { id: string; index: number; label: string }
  | { skipped: true; reason: string }
> {
  if (!getState().session) {
    return { error: 'No active session. Call createSession() or openSession(id) first.' };
  }
  if (isReadOnlyViewer()) {
    return { error: 'This session is open and being edited in another tab. Use "Take over" in the viewer banner to edit here.' };
  }
  const thumbnail = await captureThumbnail();
  const version = await saveVersion(getValue(), enrichGeometryDataWithColors(getGeometryDataObj()), thumbnail, label);
  if (version) return { id: version.id, index: version.index, label: version.label };
  return {
    skipped: true as const,
    reason: 'No changes since the current version (code, annotations, and color regions all match). Add a new region, edit code, or pass a different label to force a save.',
  };
}

// ===========================================================================

/** Validate a { index } | { id } version-target arg. Returns a parsed descriptor
 *  or { error } with a caller-aware message. Exactly one of index/id must be set. */
function parseVersionTarget(
  target: unknown,
  caller: string,
): { kind: 'index'; value: number } | { kind: 'id'; value: string } | { error: string } {
  const usage = `${caller}(target, ...): target must be { index: number } or { id: string } from listVersions()`;
  if (target === null || typeof target !== 'object') {
    return { error: usage };
  }
  const { index, id } = target as { index?: unknown; id?: unknown };
  const hasIndex = index !== undefined;
  const hasId = id !== undefined;
  if (hasIndex && hasId) {
    return { error: `${caller}: pass either { index } or { id }, not both.` };
  }
  if (!hasIndex && !hasId) {
    return { error: usage };
  }
  if (hasIndex) {
    if (typeof index !== 'number' || !Number.isFinite(index)) {
      return { error: `${caller}: target.index must be a finite number (got ${typeof index}).` };
    }
    return { kind: 'index', value: index };
  }
  if (typeof id !== 'string' || id.length === 0) {
    return { error: `${caller}: target.id must be a non-empty string (got ${typeof id}).` };
  }
  return { kind: 'id', value: id };
}

/** Resolve a part-target arg — a part id string, or { id } / { name } — to a
 *  Part in the active session. Returns { error } (with guidance) on a miss. */
function resolvePartTarget(target: unknown, caller: string): Part | { error: string } {
  if (!getState().session) {
    return { error: `${caller}: no active session. Call createSession() or openSession(id) first.` };
  }
  const parts = listCurrentParts();
  let id: string | undefined;
  let name: string | undefined;
  if (typeof target === 'string') {
    id = target;
  } else if (target && typeof target === 'object') {
    ({ id, name } = target as { id?: string; name?: string });
  } else {
    return { error: `${caller}(target): pass a part id string, or { id } / { name } from listParts().` };
  }
  let part: Part | undefined;
  if (id !== undefined) {
    if (typeof id !== 'string' || id.length === 0) return { error: `${caller}: id must be a non-empty string.` };
    part = parts.find(p => p.id === id);
  } else if (name !== undefined) {
    if (typeof name !== 'string' || name.length === 0) return { error: `${caller}: name must be a non-empty string.` };
    part = parts.find(p => p.name === name);
  } else {
    return { error: `${caller}(target): pass { id } or { name } from listParts().` };
  }
  if (!part) return { error: `${caller}: no matching part. Use listParts() to see available parts.` };
  return part;
}

// Determine which page to show based on URL path and query params
function shouldShowLanding(): boolean {
  const path = window.location.pathname;
  const params = new URLSearchParams(window.location.search);
  // Landing if at root path AND no query params that indicate a specific view
  const isRootPath = path === '/' || path === '';
  return isRootPath && !params.has('view') && !params.has('session') && !params.has('gallery') && !params.has('versions') && !params.has('images') && !params.has('diff') && !params.has('notes') && !params.has('data');
}

function shouldShowHelp(): boolean {
  return window.location.pathname === '/help';
}

function shouldShowCatalog(): boolean {
  return window.location.pathname === '/catalog';
}

function shouldShow404(): boolean {
  const path = window.location.pathname;
  return path !== '/' && path !== '' && path !== '/help' && path !== '/editor' && path !== '/catalog';
}

function getTabFromURL(): TabName {
  const params = new URLSearchParams(window.location.search);
  if (params.has('data')) return 'data';
  if (params.has('notes')) return 'notes';
  if (params.has('diff')) return 'diff';
  if (params.has('images')) return 'images';
  if (params.has('versions')) return 'versions';
  if (params.has('gallery')) return 'gallery';
  return 'interactive';
}

function currentURLPathAndSearch(): string {
  return `${window.location.pathname}${window.location.search}`;
}

function updateAppHistory(url: string, mode: 'push' | 'replace'): void {
  if (url === currentURLPathAndSearch()) return;
  if (mode === 'push') {
    window.history.pushState(null, '', url);
  } else {
    window.history.replaceState(null, '', url);
  }
}


// Hide landing/help and show the editor UI
function showEditorUI(landingEl: HTMLElement | null, helpEl: HTMLElement | null, editorUI: HTMLElement) {
  if (landingEl) landingEl.classList.add('hidden');
  if (helpEl) helpEl.classList.add('hidden');
  editorUI.classList.remove('hidden');
}

async function main() {
  // Install global error/warning capture as early as possible so nothing
  // slips through before the rest of the app is ready.
  errorLog.install();

  // Apply persisted theme before any UI renders
  initTheme();

  // Remove loading splash as soon as JS takes over
  document.getElementById('loading-splash')?.remove();

  const app = document.getElementById('app')!;
  geometryDataEl = createGeometryDataElement();
  installTitleGuard();

  // Replace the slow native `title` tooltips with fast styled ones app-wide.
  initTooltips();

  // Overlay container for landing/help pages (sits above the editor UI)
  const overlayContainer = document.createElement('div');
  overlayContainer.id = 'overlay-container';
  overlayContainer.className = 'flex flex-col flex-1 min-h-0 w-full hidden';

  // Wrapper for the main editor UI (toolbar + session bar + layout)
  const editorUI = document.createElement('div');
  editorUI.id = 'editor-ui';
  editorUI.className = 'flex flex-col flex-1 min-h-0 w-full';

  let landingEl: HTMLElement | null = null;
  let helpEl: HTMLElement | null = null;

  // Load examples (JS + SCAD) with language metadata
  const examples: Record<string, ExampleEntry> = {};
  for (const [path, loader] of Object.entries(jsExampleModules)) {
    examples[path] = { code: await loader() as string, language: 'manifold-js' };
  }
  for (const [path, loader] of Object.entries(scadExampleModules)) {
    examples[path] = { code: await loader() as string, language: 'scad' };
  }

  const defaultExampleKey = Object.keys(examples).find(k => k.includes('basic_shapes')) ?? Object.keys(examples)[0];
  const defaultCode = examples[defaultExampleKey]?.code ?? '// Write your manifold code here\nconst { Manifold } = api;\nreturn Manifold.cube([5,5,5], true);';

  // Shared validator for parsed session JSON. Returns null if shape is wrong.
  // A chat- or notes-only export (a session used before any geometry was saved)
  // is legitimate per importSession's contract — accept it when versions are
  // absent as long as chat or notes are present.
  function validateSessionPayload(data: unknown): ExportedSession | null {
    if (!data || typeof data !== 'object') return null;
    const d = data as ExportedSession;
    if ((!d.partwright && !d.mainifold) || !d.session) return null;
    const hasVersions = Array.isArray(d.versions);
    const hasChat = Array.isArray(d.chat) && d.chat.length > 0;
    const hasNotes = Array.isArray(d.notes) && d.notes.length > 0;
    if (!hasVersions && !hasChat && !hasNotes) return null;
    return d;
  }

  // Import an already-parsed session payload. Used by both file import and the
  // window.partwright.importSessionData() API so AI agents can bypass the file picker.
  async function importSessionPayload(data: ExportedSession): Promise<{ sessionId: string }> {
    const session = await importSession(data, async (code) => {
      await runCodeSync(code);
      return captureThumbnail();
    });
    const version = await openSession(session.id);
    if (version) await loadVersionIntoEditor(version);
    return { sessionId: session.id };
  }

  // Import a raw code payload as a new session. Shared between file drop and the AI API.
  async function importCodePayload(code: string, language: Language, sessionName?: string): Promise<{ sessionId: string }> {
    if (language !== getActiveLanguage()) await switchLanguage(language);
    const session = await createSession(sessionName, language);
    setValue(code);
    await runCodeSync(code);
    return { sessionId: session.id };
  }

  // Import a parsed mesh (STL today) as a new session.
  //
  // Unlike code imports, the parsed mesh bytes don't live in the editor — they
  // ride on the Version via `importedMeshes`. We must persist v1 immediately
  // so the imports survive a reload and so future saveVersion calls (which
  // carry forward `importedMeshes` from the prior version) have something to
  // build on.
  async function importMeshPayload(mesh: ImportedMesh, sessionName: string, opts: { manifold: boolean } = { manifold: true }): Promise<{ sessionId: string }> {
    if (getActiveLanguage() !== 'manifold-js') await switchLanguage('manifold-js');
    const session = await createSession(sessionName, 'manifold-js');
    setActiveImports([mesh]);
    const code = generateImportCode([mesh], { manifold: opts.manifold });
    setValue(code);
    await runCodeSync(code);
    const thumbnail = await captureThumbnail();
    const geometryData = getGeometryDataObj();
    const label = opts.manifold ? 'imported' : 'imported (render-only)';
    await saveVersion(code, geometryData, thumbnail, label, undefined, {
      force: true,
      importedMeshes: [mesh],
    });
    return { sessionId: session.id };
  }

  // Run a JSON session import end-to-end: validate, show the preview modal, import.
  async function importJSONFromText(filename: string, text: string): Promise<boolean> {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      alert(`Could not parse "${filename}" as JSON.`);
      return false;
    }
    const data = validateSessionPayload(parsed);
    if (!data) {
      alert(`"${filename}" doesn't look like a Partwright session file.`);
      return false;
    }
    const summary = summarizeSessionImport(data);
    const ok = await showImportPreview(filename, summary);
    if (!ok) return false;
    await importSessionPayload(data);
    return true;
  }

  // Import a .partwright.json session, a raw .js / .scad file, or an .stl mesh
  // into a new session. Returns whether the import committed (so callers know
  // if the inbox should be updated).
  async function handleImportFile(file: File, options: { skipPreActiveConfirm?: boolean } = {}): Promise<boolean> {
    const source = classifyImportSource(file.name);
    if (!source) {
      alert(`Unsupported file type: ${file.name}\n\nSupported: .partwright.json, .js, .scad, .stl`);
      return false;
    }

    // Raw code imports don't get a preview modal of their own — confirm before clobber.
    // JSON imports skip this confirm because the preview modal already serves as
    // confirmation; STL imports skip it because the import-target modal lets the
    // user choose a new part / current part / new session instead.
    if (!options.skipPreActiveConfirm && source !== 'JSON' && source !== 'STL') {
      const cur = getState();
      if (cur.session && cur.versionCount > 0) {
        const ok = await showInlineConfirm(
          editorUI,
          `Open "${file.name}" as a new session? Your current session will be kept.`,
        );
        if (!ok) return false;
      }
    }

    try {
      let committed = false;
      if (source === 'JSON') {
        const text = await file.text();
        committed = await importJSONFromText(file.name, text);
      } else if (source === 'JS' || source === 'SCAD') {
        const code = await file.text();
        const lang: Language = source === 'SCAD' ? 'scad' : 'manifold-js';
        const sessionName = file.name.replace(/\.(js|scad)$/i, '');
        await importCodePayload(code, lang, sessionName);
        committed = true;
      } else if (source === 'STL') {
        const parsed = await parseSTLFile(file);
        if (parsed) {
          committed = await placeImportedMesh(parsed, file.name);
        }
      }
      if (committed) registerImport(file, file.name, source);
      return committed;
    } catch (e) {
      alert(`Failed to import "${file.name}": ${(e as Error).message}`);
      return false;
    }
  }

  interface ParsedSTL {
    mesh: ImportedMesh;
    /** True if Manifold.ofMesh() succeeded — supports boolean ops, paint, slicing.
     *  False if the user chose to import render-only after manifold construction failed. */
    isManifold: boolean;
  }

  /** Read an STL file, parse it, and verify Manifold.ofMesh() accepts the result.
   *  Tries progressively looser weld tolerances to absorb float-precision noise.
   *  If the mesh still won't form a manifold (common for sculpted/scanned models
   *  with self-intersections or open edges), prompts the user to import as
   *  render-only — visible and exportable, but no booleans/paint/slice. */
  async function parseSTLFile(file: File): Promise<ParsedSTL | null> {
    const bytes = new Uint8Array(await file.arrayBuffer());

    // Sanity-check that the file parses to *something* before doing the more
    // expensive ofMesh trial.
    const probe = parseSTL(bytes);
    if (!probe || probe.numTri === 0) {
      alert(`Could not parse "${file.name}" as an STL file.`);
      return null;
    }

    // Scale-aware fallback tolerance: 5 ppm of the mesh's bounding-box diagonal
    // catches imports that ship in unusual units (μm or m) where 1e-3 absolute
    // is either way too tight or way too loose.
    const bbox = bboxFromMesh(probe);
    const diag = bbox
      ? Math.hypot(bbox.max[0] - bbox.min[0], bbox.max[1] - bbox.min[1], bbox.max[2] - bbox.min[2])
      : 0;
    const scaleTolerance = Math.max(diag * 5e-6, 1e-6);

    const tolerances = [1e-5, 1e-4, 1e-3, scaleTolerance];
    let bestMesh = probe;
    let maxTried = 0;
    let manifoldError: string | null = null;
    for (const tol of tolerances) {
      const mesh = parseSTL(bytes, { weldTolerance: tol });
      if (!mesh || mesh.numTri === 0) continue;
      const trial = tryConstructManifold(mesh);
      if (trial.ok) {
        return { mesh: toImportedMesh(file.name, mesh), isManifold: true };
      }
      manifoldError = trial.error;
      if (tol > maxTried) maxTried = tol;
      bestMesh = mesh;
    }

    // All tolerances failed. Offer render-only fallback — most users importing
    // a Baby Yoda / Eiffel Tower scan just want to look at it, not boolean-op it.
    const accepted = await showInlineConfirm(
      editorUI,
      `${file.name} won't form a clean manifold — typical for sculpted or scanned models with self-intersections, open edges, or T-junctions.\n\n` +
      `You can still import it as render-only: the mesh displays and exports normally, but boolean operations, paint, and cross-sections won't work.\n\n` +
      `For full editing, repair the mesh first in MeshLab or Blender, then re-import.\n\n` +
      `${probe.numTri.toLocaleString()} triangles · ${probe.numVert.toLocaleString()} vertices · tried weld tolerances up to ${maxTried.toExponential(1)} · ${manifoldError}`,
      {
        title: 'Import as render-only?',
        confirmLabel: 'Import render-only',
        cancelLabel: 'Cancel',
      }
    );
    if (!accepted) return null;

    return { mesh: toImportedMesh(file.name, bestMesh), isManifold: false };
  }

  function toImportedMesh(filename: string, mesh: MeshData): ImportedMesh {
    return {
      id: generateId(),
      filename,
      format: 'stl',
      vertProperties: mesh.vertProperties,
      triVerts: mesh.triVerts,
      numVert: mesh.numVert,
      numTri: mesh.numTri,
      numProp: mesh.numProp,
    };
  }

  /** Attempt Manifold.ofMesh() on a parsed mesh; report success/failure. The
   *  trial manifold is disposed immediately — we only care whether construction
   *  worked, not the geometry itself. */
  function tryConstructManifold(mesh: MeshData): { ok: true } | { ok: false; error: string } {
    const mod = getModule();
    if (!mod) return { ok: true }; // engine not ready yet; assume good and let runtime surface any issue
    let m: { isEmpty(): boolean; delete?: () => void } | null = null;
    try {
      m = mod.Manifold.ofMesh({
        numProp: mesh.numProp,
        vertProperties: mesh.vertProperties,
        triVerts: mesh.triVerts,
      });
      if (!m || m.isEmpty()) {
        return { ok: false, error: 'constructed manifold is empty' };
      }
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    } finally {
      try { m?.delete?.(); } catch { /* already gone */ }
    }
  }

  // ── Import placement & part merging ──────────────────────────────────────
  // A mesh import (or a merge) never silently clobbers the active part: the
  // user is offered a choice, and any unsaved edits on the current part are
  // committed first. Both flows funnel mesh geometry through the same import
  // wrapper (`Manifold.ofMesh` / `Manifold.compose`) main already uses for STL
  // imports and simplify-bakes, so the result is an ordinary, editable version.

  /** True when the editor still holds a fresh starter snippet (blank, the
   *  default example, or a "New session"/"New part" cube) — i.e. nothing worth
   *  preserving before an import overwrites it. */
  function isStarterCode(code: string): boolean {
    const t = code.trim();
    if (!t) return true;
    if (t === defaultCode.trim()) return true;
    return /^(\/\/ (New session|New part)\n)?const \{ Manifold \} = api;\nreturn Manifold\.cube\(\[10, 10, 10\], true\);$/.test(t);
  }

  /** The current part is "expendable" when it has no saved version and the
   *  editor still shows starter code — seeding a mesh into it discards nothing. */
  function currentPartIsExpendable(): boolean {
    const s = getState();
    return !!s.currentPart && !s.currentVersion && isStarterCode(getValue());
  }

  /** Save the current part's editor content as a version when it holds real,
   *  unsaved work — so a following import/merge never loses it and a part that
   *  was only run (not saved) can still be used as merge input. */
  async function preserveCurrentEditsIfNeeded(): Promise<void> {
    if (isReadOnlyViewer()) return;
    const s = getState();
    if (!s.session || !s.currentPart) return;
    const code = getValue();
    if (isStarterCode(code)) return;
    if (s.currentVersion && !editorContentDiffersFrom(s.currentVersion.code)) return;
    const thumbnail = await captureThumbnail();
    const geometryData = enrichGeometryDataWithColors(getGeometryDataObj());
    await saveVersion(code, geometryData, thumbnail);
  }

  /** Drop an import wrapper for `components` into the current part: set the
   *  active imports, render, and save a version that carries the mesh data. */
  async function applyImportWrapper(components: ImportedMesh[], manifold: boolean): Promise<void> {
    const code = generateImportCode(components, { manifold });
    setActiveImports(components);
    setValue(code);
    await runCodeSync(code);
    const thumbnail = await captureThumbnail();
    const geometryData = getGeometryDataObj();
    const label = manifold ? 'imported' : 'imported (render-only)';
    await saveVersion(code, geometryData, thumbnail, label, undefined, {
      force: true,
      importedMeshes: components,
    });
  }

  /** Execute a part's latest version off-editor and capture its geometry as a
   *  single compose component. Returns null when the part has no version or
   *  produced no usable mesh (e.g. render-only or a code error). */
  async function bakePartComponents(partId: string, label: string): Promise<ImportedMesh[] | null> {
    const version = await getLatestVersion(partId);
    if (!version) return null;
    const saved = getActiveImports();
    try {
      setActiveImports((version.importedMeshes ?? []) as ImportedMesh[]);
      const result = await executeCodeAsync(version.code);
      if (result.error || !result.mesh) return null;
      return [toImportedMesh(label, result.mesh)];
    } finally {
      setActiveImports(saved);
    }
  }

  /** Add the imported mesh as a brand-new part (becomes current). */
  async function seedNewPartWithMesh(mesh: ImportedMesh, filename: string, manifold: boolean): Promise<void> {
    const part = await createPart(filename.replace(/\.stl$/i, ''));
    if (!part) return;
    await applyImportWrapper([mesh], manifold);
  }

  /** Compose the imported mesh with the current part's existing geometry. */
  async function composeMeshIntoCurrentPart(mesh: ImportedMesh): Promise<boolean> {
    const cur = getState().currentPart;
    if (!cur) return false;
    const baked = await bakePartComponents(cur.id, cur.name);
    if (!baked) {
      showToast('Couldn’t read the current part’s geometry to combine.', { variant: 'warn' });
      return false;
    }
    await applyImportWrapper([...baked, mesh], true);
    return true;
  }

  /** Decide where a freshly-parsed STL mesh lands. With no session open it
   *  creates one (legacy behavior); otherwise the import-target modal lets the
   *  user pick a new part, the current part, or a new session. */
  async function placeImportedMesh(parsed: ParsedSTL, filename: string): Promise<boolean> {
    const sessionName = filename.replace(/\.stl$/i, '');
    const state = getState();
    if (!state.session) {
      await importMeshPayload(parsed.mesh, sessionName, { manifold: parsed.isManifold });
      return true;
    }

    const expendable = currentPartIsExpendable();
    const target = await showImportTargetModal({
      filename,
      currentPartName: state.currentPart?.name ?? null,
      canAddToCurrent: parsed.isManifold && !!state.currentPart,
      addDisabledReason: !parsed.isManifold
        ? 'Render-only meshes can’t be combined into an existing part.'
        : undefined,
      recommend: expendable ? 'current-part' : 'new-part',
      addReplacesStarter: expendable,
    });
    if (!target) return false;

    if (target === 'new-session') {
      await importMeshPayload(parsed.mesh, sessionName, { manifold: parsed.isManifold });
      return true;
    }
    if (target === 'new-part') {
      await preserveCurrentEditsIfNeeded();
      await seedNewPartWithMesh(parsed.mesh, filename, parsed.isManifold);
      return true;
    }
    // current-part: seed an expendable starter, else compose into real work.
    if (expendable) {
      await applyImportWrapper([parsed.mesh], parsed.isManifold);
      return true;
    }
    await preserveCurrentEditsIfNeeded();
    return composeMeshIntoCurrentPart(parsed.mesh);
  }

  function mergedPartName(names: string[]): string {
    const joined = names.join(' + ');
    return joined.length <= 40 ? joined : `Merged (${names.length} parts)`;
  }

  /** Build a new part holding the composed geometry of `components`. Probes the
   *  combine first so a failure surfaces as a toast instead of a broken part. */
  async function createCombinedPart(components: ImportedMesh[], name: string): Promise<boolean> {
    const code = generateImportCode(components, { manifold: true });
    const saved = getActiveImports();
    setActiveImports(components);
    const probe = await executeCodeAsync(code);
    if (probe.error || !probe.mesh) {
      setActiveImports(saved);
      showToast(`Couldn’t combine parts: ${probe.error ?? 'no geometry produced'}`, { variant: 'warn' });
      return false;
    }
    const part = await createPart(name);
    if (!part) { setActiveImports(saved); return false; }
    setActiveImports(components);
    setValue(code);
    await runCodeSync(code);
    const thumbnail = await captureThumbnail();
    const geometryData = getGeometryDataObj();
    await saveVersion(code, geometryData, thumbnail, 'merged', undefined, {
      force: true,
      importedMeshes: components,
    });
    return true;
  }

  /** Combine the multi-selected parts into one. Each part's latest version is
   *  baked to geometry and composed; the result is a new part, optionally
   *  replacing the originals. */
  async function mergePartsFlow(ids: string[]): Promise<void> {
    if (isReadOnlyViewer()) return;
    if (!getState().session) return;
    // Precreate a version for the current part if it has unsaved work, so a
    // merge that includes the active part uses its latest geometry — no manual
    // Save first.
    await preserveCurrentEditsIfNeeded();

    const parts = getState().parts.filter(p => ids.includes(p.id));
    if (parts.length < 2) {
      showToast('Select at least two parts to merge.', { variant: 'warn' });
      return;
    }
    const choice = await showMergePartsModal({ partNames: parts.map(p => p.name) });
    if (!choice) return;

    const components: ImportedMesh[] = [];
    for (const p of parts) {
      const baked = await bakePartComponents(p.id, p.name);
      if (baked) components.push(...baked);
    }
    if (components.length < 2) {
      showToast('Couldn’t merge — at least two parts need usable geometry (render-only parts can’t be combined).', { variant: 'warn' });
      return;
    }

    const ok = await createCombinedPart(components, mergedPartName(parts.map(p => p.name)));
    if (!ok) return;

    if (choice.mode === 'replace') {
      // The combined part is brand-new (not in `ids`), so it survives the delete.
      await deleteParts(ids);
    }
  }


  // Re-import an entry from the Recent Imports inbox. Reuses the same flow as
  // a fresh file import, including the JSON preview modal — it is still a
  // session-creating action and the user may want to verify before clobbering.
  async function handleReimportInboxEntry(entry: ImportInboxEntry): Promise<void> {
    try {
      if (entry.source === 'JSON') {
        const text = await entry.blob.text();
        await importJSONFromText(entry.filename, text);
        return;
      }
      // STL re-imports go through the import-target modal (new part / current
      // part / new session) just like a fresh file import.
      if (entry.source === 'STL') {
        const file = new File([entry.blob], entry.filename, { type: entry.blob.type });
        const parsed = await parseSTLFile(file);
        if (parsed) await placeImportedMesh(parsed, entry.filename);
        return;
      }
      const cur = getState();
      if (cur.session && cur.versionCount > 0) {
        const ok = await showInlineConfirm(
          editorUI,
          `Re-import "${entry.filename}" as a new session? Your current session will be kept.`,
        );
        if (!ok) return;
      }
      const code = await entry.blob.text();
      const lang: Language = entry.source === 'SCAD' ? 'scad' : 'manifold-js';
      const sessionName = entry.filename.replace(/\.(js|scad)$/i, '');
      await importCodePayload(code, lang, sessionName);
    } catch (e) {
      alert(`Failed to re-import "${entry.filename}": ${(e as Error).message}`);
    }
  }

  // Document-level drag-and-drop import. The editor UI is initialized once
  // per page load and never torn down, so these document listeners live for
  // the lifetime of the document — no cleanup needed. If editor teardown is
  // ever added, store these handlers and pair with removeEventListener().
  function isImportableFile(file: File): boolean {
    const n = file.name.toLowerCase();
    return n.endsWith('.json') || n.endsWith('.js') || n.endsWith('.scad') || n.endsWith('.stl');
  }

  document.addEventListener('dragover', (e) => {
    if (!e.dataTransfer || e.dataTransfer.types.indexOf('Files') === -1) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  });

  document.addEventListener('drop', async (e) => {
    const files = e.dataTransfer?.files;
    if (!files || files.length === 0) return;
    const first = Array.from(files).find(isImportableFile);
    if (!first) return;
    e.preventDefault();
    await handleImportFile(first);
  });

  // Mesh export actions, shared by the toolbar and the command palette so the
  // guards + success/error toasts stay in one place.
  const actionExportGLB = async () => {
    try {
      if (currentMeshData) assertFiniteMesh(currentMeshData);
      const filename = await exportGLB();
      showToast(`Exported ${filename}`, { variant: 'success' });
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'GLB export failed', { variant: 'warn' });
    }
  };
  const actionExportSTL = () => {
    if (!currentMeshData) return;
    try { showToast(`Exported ${exportSTL(currentMeshData)}`, { variant: 'success' }); }
    catch (e) { showToast(e instanceof Error ? e.message : 'STL export failed', { variant: 'warn' }); }
  };
  const actionExportOBJ = () => {
    if (!currentMeshData) return;
    try { showToast(`Exported ${exportOBJ(hasColorRegions() ? applyTriColors(currentMeshData) : currentMeshData)}`, { variant: 'success' }); }
    catch (e) { showToast(e instanceof Error ? e.message : 'OBJ export failed', { variant: 'warn' }); }
  };
  const actionExport3MF = () => {
    if (!currentMeshData) return;
    try { showToast(`Exported ${export3MF(hasColorRegions() ? applyTriColors(currentMeshData) : currentMeshData)}`, { variant: 'success' }); }
    catch (e) { showToast(e instanceof Error ? e.message : '3MF export failed', { variant: 'warn' }); }
  };

  // Create toolbar
  createToolbar(editorUI, {
    onGoHome: () => {
      updateAppHistory('/', 'push');
      void syncRouteFromURL();
    },
    onRun: () => runCode(),
    onExportGLB: actionExportGLB,
    onExportSTL: actionExportSTL,
    onExportOBJ: actionExportOBJ,
    onExport3MF: actionExport3MF,
    onExportSessionJSON: async () => {
      if (!getState().session) {
        alert('No active session to export. Save a version first.');
        return;
      }
      // Imported meshes (STL) ride along in the export from schema 1.7 (their
      // buffers are base64-encoded in `versions[].importedMeshes`), so no
      // re-import warning is needed.
      const versions = await listCurrentVersions();
      const opts = await showExportOptionsDialog(
        versions.map(v => ({ index: v.index, label: v.label })),
      );
      if (!opts) return;
      const ok = await exportSessionJSON(undefined, opts);
      if (!ok) alert('No active session to export. Save a version first.');
    },
    onExportRawCode: () => {
      exportRawCode(getValue(), getActiveLanguage());
    },
    onImportFile: async (file) => { await handleImportFile(file); },
    onImportInboxEntry: handleReimportInboxEntry,
    onLanguageSwitch: async (lang: 'manifold-js' | 'scad') => {
      if (lang === getActiveLanguage()) return;
      // If current session has work, ask before switching
      const curState = getState();
      if (curState.session && curState.versionCount > 0) {
        const msg = lang === 'scad'
          ? 'Your current JS session will be kept. Start new OpenSCAD session?'
          : 'Your current SCAD session will be kept. Start new JavaScript session?';
        const ok = await showInlineConfirm(editorUI, msg);
        if (!ok) return;
      }
      await switchLanguage(lang);
      // Create a fresh session in the new language (empty previous session auto-deleted)
      await createSession(undefined, lang);
      const defaultScad = '// OpenSCAD\ncube([10, 10, 10], center=true);';
      const defaultJs = 'const { Manifold } = api;\nreturn Manifold.cube([10, 10, 10], true);';
      const code = lang === 'scad' ? defaultScad : defaultJs;
      setValue(code);
      runCode(code);
    },
  });

  // Init diagnostic panel — attaches to document.body, registers badge subscriber.
  initDiagnosticsPanel();

  // Reset the editor to a blank starting point for a freshly created session.
  // Shared by the session bar's "+ New Session" button and the session modal's,
  // so both clear the previous session's code instead of leaving it behind.
  // Reset the editor to a starter snippet, dropping stale paint state. Color
  // regions live in module state that the session/part layer doesn't own, so a
  // fresh target must clear them here — otherwise the new (unpainted) session or
  // part inherits the previous one's regions and is born with a locked editor.
  function resetEditorToStarter(comment: string) {
    // Drop any in-flight subdivision worker job before clearing regions, so a
    // late continuation can't stamp triangle ids onto regions that no longer
    // exist (or overwrite the freshly-loaded starter mesh).
    resetPaintWorkerState();
    clearRegions();
    syncLockState();
    const freshCode = `// ${comment}\nconst { Manifold } = api;\nreturn Manifold.cube([10, 10, 10], true);`;
    setValue(freshCode);
    runCode(freshCode);
  }

  function startNewSessionInEditor() {
    resetEditorToStarter('New session');
    _clearImages();
  }

  // Reset the editor for a freshly created part. Unlike a new session, parts
  // share the session's reference images, so those are left intact.
  function startNewPartInEditor() {
    resetEditorToStarter('New part');
  }

  // Load a part's active version into the editor, or reset to a blank part when
  // the part has no saved versions yet.
  async function loadPartIntoEditor(version: Version | null) {
    if (version) {
      await loadVersionIntoEditor(version);
    } else {
      startNewPartInEditor();
    }
  }

  // Create session bar
  createSessionBar(editorUI, {
    onSaveVersion: async () => ({
      code: getValue(),
      geometryData: enrichGeometryDataWithColors(getGeometryDataObj()),
      thumbnail: await captureThumbnail(),
    }),
    onLoadVersion: async (code: string) => {
      setValue(code);
      const applied = await runCodeSync(code);
      if (!applied) return;
      const loadedVersion = getState().currentVersion;
      if (loadedVersion) {
        rehydrateColorRegions(loadedVersion.geometryData);
      }
      applyVersionAnnotations(loadedVersion);
    },
    onNewSession: startNewSessionInEditor,
  });

  // Create layout
  const { editorContainer, editorErrorPanel, viewportPane, galleryContainer, versionsContainer, imagesContainer, diffContainer, notesContainer, dataContainer, statusBar, clipControls, formatBtn, autoFormatToggle, switchTab, partsRail, togglePartsRail } = createLayout(editorUI, {
    onToggleAi: () => { void toggleAiPanelFromToolbar(); },
    onOpenCatalog: () => { void showCatalogPage(); },
    onToggleDiagnostics: () => { toggleDiagnosticsPanel(); },
    onOpenSessionList: () => showSessionList(),
  });

  // Parts rail — IDE-style list of the session's parts.
  createPartList(partsRail, {
    onSelectPart: async (partId: string) => {
      const version = await changePart(partId);
      await loadPartIntoEditor(version);
    },
    onCreatePart: async () => {
      // Structural part edits are leader-only — a read-only viewer must not
      // write to the shared session (mirrors the run/save guard).
      if (isReadOnlyViewer()) return;
      await createPart();
      startNewPartInEditor();
    },
    onRenamePart: async (partId: string, name: string) => {
      if (isReadOnlyViewer()) return;
      await renamePart(partId, name);
    },
    onDeletePart: async (partId: string) => {
      if (isReadOnlyViewer()) return;
      const wasCurrent = getState().currentPart?.id === partId;
      const result = await deletePart(partId);
      if (result && wasCurrent) {
        await loadPartIntoEditor(getState().currentVersion);
      }
    },
    onDeleteParts: async (partIds: string[]) => {
      if (isReadOnlyViewer()) return;
      const result = await deleteParts(partIds);
      // Only reload the editor when the active part was among those removed
      // (deleteParts reports this via newCurrent).
      if (result && result.newCurrent) {
        await loadPartIntoEditor(getState().currentVersion);
      }
    },
    onMergeParts: async (partIds: string[]) => {
      if (isReadOnlyViewer()) return;
      await mergePartsFlow(partIds);
    },
    onReorderParts: async (orderedIds: string[]) => {
      if (isReadOnlyViewer()) return;
      await reorderParts(orderedIds);
    },
    onToggleCollapse: () => togglePartsRail(),
  });

  // Keep the editor title showing the active part's name (falls back to the
  // generic filename when no part/session is open). The element is looked up on
  // each call rather than captured, since the editor root may not be mounted in
  // the document when this wiring first runs.
  function syncEditorTitle(state: ReturnType<typeof getState>): void {
    const editorTitleEl = document.getElementById('editor-title');
    if (!editorTitleEl) return;
    const part = state.currentPart;
    editorTitleEl.textContent = part ? part.name : (getActiveLanguage() === 'scad' ? 'editor.scad' : 'editor.js');
  }
  syncEditorTitle(getState());
  onStateChange(syncEditorTitle);

  // Format button and auto-format toggle
  const AUTO_FORMAT_ON_CLASS = 'shrink-0 px-2 py-0.5 rounded text-xs leading-none border text-emerald-400 border-emerald-700 bg-emerald-950/40 hover:bg-emerald-900/40';
  const AUTO_FORMAT_OFF_CLASS = 'shrink-0 px-2 py-0.5 rounded text-xs leading-none border text-zinc-500 border-zinc-700 hover:text-zinc-300';
  function syncAutoFormatToggleUI(): void {
    const on = getAutoFormat();
    autoFormatToggle.textContent = on ? 'Auto ✓' : 'Auto';
    autoFormatToggle.title = on ? 'Auto-format on — click to disable' : 'Auto-format off — click to enable';
    autoFormatToggle.className = on ? AUTO_FORMAT_ON_CLASS : AUTO_FORMAT_OFF_CLASS;
  }
  syncAutoFormatToggleUI();
  formatBtn.addEventListener('click', () => formatCode());
  autoFormatToggle.addEventListener('click', () => {
    setAutoFormat(!getAutoFormat());
    syncAutoFormatToggleUI();
  });
  document.addEventListener('keydown', (e) => {
    // Use e.code (physical key) — on macOS, Option+Shift+F composes a dead-key
    // character so e.key is no longer 'F' and the shortcut would never fire.
    if (e.shiftKey && e.altKey && e.code === 'KeyF') {
      e.preventDefault();
      formatCode();
    }
  });

  // Global undo / redo / save shortcuts (OS-aware, focus/tool-routed).
  const saveVersionWithToast = async () => {
    const result = await saveCurrentVersion();
    if ('error' in result) {
      showToast(result.error, { variant: 'warn' });
    } else if ('skipped' in result) {
      showToast('No changes to save', { variant: 'neutral' });
    } else {
      showToast(`Saved v${result.index}${result.label ? ` — ${result.label}` : ''}`, { variant: 'success' });
    }
  };
  installKeyboardShortcuts({ onSave: saveVersionWithToast });

  // Register command-palette actions (⌘K). Reuses the same handlers the
  // toolbar/session bar/layout already wire up so behavior can't drift.
  registerCommands([
    { id: 'run', title: 'Run code', hint: 'Editor', keywords: 'execute render', run: () => runCode() },
    { id: 'save', title: 'Save version', hint: 'Session', shortcut: combo(MOD_LABEL, 'S'), keywords: 'commit snapshot', run: () => { void saveVersionWithToast(); } },
    { id: 'format', title: 'Format code', hint: 'Editor', shortcut: combo(SHIFT_LABEL, ALT_LABEL, 'F'), keywords: 'prettify beautify indent', run: () => formatCode() },
    { id: 'new-session', title: 'New session', hint: 'Session', keywords: 'create blank', run: () => startNewSessionInEditor() },
    { id: 'open-sessions', title: 'Open session…', hint: 'Session', keywords: 'switch list recent', run: () => showSessionList() },
    { id: 'tab-interactive', title: 'Go to 3D view', hint: 'Tab', keywords: 'interactive viewport model', run: () => switchTab('interactive') },
    { id: 'tab-gallery', title: 'Go to Gallery (read-only)', hint: 'Tab', keywords: 'thumbnails versions visual grid', run: () => switchTab('gallery') },
    { id: 'tab-versions', title: 'Go to Versions', hint: 'Tab', keywords: 'history rename delete', run: () => switchTab('versions') },
    { id: 'tab-images', title: 'Go to Reference images', hint: 'Tab', keywords: 'photos reference', run: () => switchTab('images') },
    { id: 'tab-diff', title: 'Go to Diff', hint: 'Tab', keywords: 'compare changes', run: () => switchTab('diff') },
    { id: 'tab-notes', title: 'Go to Notes', hint: 'Tab', keywords: 'session notes', run: () => switchTab('notes') },
    { id: 'tab-data', title: 'Go to Data', hint: 'Tab', keywords: 'storage browser indexeddb inventory', run: () => switchTab('data') },
    { id: 'export-glb', title: 'Export GLB', hint: 'Export', keywords: 'download gltf 3d', run: () => { void actionExportGLB(); }, enabled: () => currentMeshData !== null },
    { id: 'export-stl', title: 'Export STL', hint: 'Export', keywords: 'download print', run: actionExportSTL, enabled: () => currentMeshData !== null },
    { id: 'export-obj', title: 'Export OBJ', hint: 'Export', keywords: 'download wavefront', run: actionExportOBJ, enabled: () => currentMeshData !== null },
    { id: 'export-3mf', title: 'Export 3MF', hint: 'Export', keywords: 'download print color', run: actionExport3MF, enabled: () => currentMeshData !== null },
    { id: 'toggle-ai', title: 'Toggle AI panel', hint: 'View', keywords: 'chat assistant drawer', run: () => toggleAiPanel() },
    { id: 'toggle-diagnostics', title: 'Toggle diagnostic log', hint: 'View', keywords: 'errors warnings console', run: () => toggleDiagnosticsPanel() },
    { id: 'open-catalog', title: 'Open catalog', hint: 'Navigate', keywords: 'examples premade browse', run: () => { void showCatalogPage(); } },
    { id: 'open-help', title: 'Open help', hint: 'Navigate', keywords: 'docs documentation guide', run: () => showHelp() },
    { id: 'open-quality', title: 'Modeling quality settings', hint: 'Settings', keywords: 'resolution curve segments smoothness', run: () => showQualitySettingsModal() },
    { id: 'retake-tour', title: 'Take the guided tour', hint: 'Help', keywords: 'onboarding walkthrough intro tutorial', run: () => { resetTour(); startTour(); } },
  ]);

  // Init gallery
  createGalleryView(galleryContainer, async (code: string) => {
    setValue(code);
    const applied = await runCodeSync(code);
    if (!applied) return;
    // Rehydrate color regions and annotations from the loaded version
    const loadedVersion = getState().currentVersion;
    if (loadedVersion) {
      rehydrateColorRegions(loadedVersion.geometryData);
    }
    applyVersionAnnotations(loadedVersion);
    switchTab('interactive');
  });

  // Init images view
  createImagesView(imagesContainer, {
    onChange: async (next) => {
      _setImages(next);
      await persistImages(next);
    },
  });

  // Init diff view
  createDiffView(diffContainer, (code: string) => {
    setValue(code);
    runCode(code);
    switchTab('interactive');
  });

  // Init notes panel
  createNotesView(notesContainer);

  // Init data explorer (browse everything stored in this browser)
  initDataExplorer(dataContainer);

  // Init versions panel (manage saved versions: rename / delete, with undo/redo)
  createVersionsView(versionsContainer, {
    onOpenVersion: async (version) => {
      await loadVersionFromStore(version.index);
      await loadVersionIntoEditor(version);
      switchTab('interactive');
    },
    onSyncEditor: async (version) => {
      await loadVersionIntoEditor(version);
    },
  });

  // Refresh tabs when they're selected
  window.addEventListener('tab-switched', ((e: CustomEvent) => {
    if (e.detail.tab === 'gallery') refreshGallery();
    if (e.detail.tab === 'versions') refreshVersions();
    if (e.detail.tab === 'images') refreshImages();
    if (e.detail.tab === 'diff') refreshDiff();
    if (e.detail.tab === 'notes') refreshNotes();
    if (e.detail.tab === 'data') refreshDataExplorer();
  }) as EventListener);

  // Init session list
  initSessionList(
    async (code: string) => {
      // Restore language from the newly opened session
      const sessionLang = getState().session?.language ?? 'manifold-js';
      if (sessionLang !== getActiveLanguage()) {
        await switchLanguage(sessionLang);
      }
      setValue(code);
      runCode(code);
    },
    async (code: string) => {
      await runCodeSync(code);
      return captureThumbnail();
    },
    startNewSessionInEditor,
  );

  // Assemble DOM early so landing/help pages can render before WASM loads.
  // The page subtrees (editor + landing/help/catalog overlays) share a flex row
  // with the AI panel so the panel docks as a persistent right-hand column: it
  // sits OUTSIDE the per-page subtrees, so it survives route changes (the
  // landing-page chat flow relies on the panel staying mounted across nav).
  const appRow = document.createElement('div');
  appRow.id = 'app-row';
  appRow.className = 'flex flex-row flex-1 min-h-0 w-full';
  const pageArea = document.createElement('div');
  pageArea.id = 'page-area';
  pageArea.className = 'flex flex-col flex-1 min-w-0 min-h-0';
  pageArea.appendChild(editorUI);
  pageArea.appendChild(overlayContainer);
  appRow.appendChild(pageArea);
  app.appendChild(appRow);

  let editorReady = false;
  let editorReadyResolve: (() => void) = () => {};
  const editorReadyPromise = new Promise<void>(resolve => { editorReadyResolve = resolve; });
  let engineOk = false;
  let helpHasAppBackTarget = false;
  let notFoundEl: HTMLElement | null = null;
  // Declared early so async callbacks (e.g. runCodeSync triggered during
  // initial syncEditorFromURL) don't hit a TDZ error before this point.
  let _running = false;
  // Monotonically-increasing counter that identifies the most-recently-started
  // runCodeSync call. When a Worker result arrives, it's only applied if its
  // generation matches the current value — any lower value means a newer
  // version-switch or run has already superseded it, and applying the stale
  // result would overwrite the wrong mesh/manifold/colour state.
  let _runGeneration = 0;

  // Last error from an auto-run, held back from the editor UI until typing
  // settles or focus leaves (see surfacePendingError). `src` guards against
  // surfacing an error for code the user has since edited.
  let pendingEditorError: { error: string; diagnostics: SourceDiagnostic[]; src: string } | null = null;

  /** Render a deferred auto-run error into the editor, but only if the code it
   *  came from still matches the editor — used by the idle/blur triggers. */
  function surfacePendingError(): void {
    if (!pendingEditorError || pendingEditorError.src !== getValue()) return;
    setEditorDiagnostics(pendingEditorError.diagnostics);
    renderEditorError(editorErrorPanel, pendingEditorError.error, pendingEditorError.diagnostics);
  }

  async function ensureEditorReady() {
    if (!editorReady) await editorReadyPromise;
  }

  // Helper to transition from landing/help to editor
  function transitionToEditor() {
    showEditorUI(landingEl, helpEl, editorUI);
    if (notFoundEl) notFoundEl.classList.add('hidden');
    if (catalogEl) catalogEl.classList.add('hidden');
    overlayContainer.classList.add('hidden');
    window.dispatchEvent(new Event('resize'));
  }

  async function loadVersionIntoEditor(version: Version) {
    const sessionLang = getState().session?.language ?? 'manifold-js';
    if (sessionLang !== getActiveLanguage()) {
      await switchLanguage(sessionLang);
    }
    setActiveImports((version.importedMeshes ?? []) as ImportedMesh[]);
    setValue(version.code);
    const applied = await runCodeSync(version.code);
    // If a newer version-switch arrived while we were compiling, our result
    // was discarded — don't rehydrate colours or annotations for the wrong version.
    if (!applied) return;
    rehydrateColorRegions(version.geometryData);
    applyVersionAnnotations(version);
    const sessionImages = await getImagesFromSession();
    if (sessionImages) {
      _setImages(sessionImages);
    } else {
      _clearImages();
    }
  }

  async function openEditorFromLanding() {
    updateAppHistory('/editor', 'push');
    transitionToEditor();
    await ensureEditorReady();
    if (window.location.pathname !== '/editor') return;
    await createSession();
    updateDocumentTitle({ page: 'editor' });
    setStatus(statusBar, 'ready', 'Ready');
    runCode(defaultCode);
  }

  async function openSessionFromLanding(sid: string) {
    updateAppHistory(`/editor?session=${sid}`, 'push');
    transitionToEditor();
    await ensureEditorReady();
    if (getSessionIdFromURL() !== sid) return;
    const version = await openSession(sid);
    if (version) {
      await loadVersionIntoEditor(version);
    } else {
      // openSession returned null — either the session doesn't exist
      // (e.g. stale tile from another device's data) or it has no saved
      // versions yet. Run defaults so the viewport renders and the
      // status doesn't stay stuck on "Loading WASM...".
      setStatus(statusBar, 'ready', 'Ready');
      runCode(defaultCode);
    }
    updateDocumentTitle({ page: 'editor' });
  }

  async function ensureLandingPage() {
    if (!landingEl) {
      landingEl = await createLandingPage(overlayContainer, {
        onOpenEditor: openEditorFromLanding,
        onOpenHelp: () => showHelp(),
        onOpenCatalog: () => { void showCatalogPage(); },
        onOpenSession: openSessionFromLanding,
      });
    }
    return landingEl;
  }

  async function showLandingPage() {
    const page = await ensureLandingPage();
    overlayContainer.classList.remove('hidden');
    editorUI.classList.add('hidden');
    helpEl?.classList.add('hidden');
    notFoundEl?.classList.add('hidden');
    catalogEl?.classList.add('hidden');
    page.classList.remove('hidden');
    updateDocumentTitle({ page: 'landing' });
  }

  function showNotFoundPage() {
    if (!notFoundEl) {
      notFoundEl = createNotFoundPage(overlayContainer, {
        onGoHome: () => {
          updateAppHistory('/', 'push');
          void syncRouteFromURL();
        },
      });
    }
    overlayContainer.classList.remove('hidden');
    editorUI.classList.add('hidden');
    landingEl?.classList.add('hidden');
    helpEl?.classList.add('hidden');
    catalogEl?.classList.add('hidden');
    notFoundEl.classList.remove('hidden');
    updateDocumentTitle({ page: '404' });
  }

  // Helper to show help page
  function showHelp(options: { history?: 'push' | 'replace' | 'none' } = {}) {
    const historyMode = options.history ?? 'push';
    if (historyMode !== 'none') {
      helpHasAppBackTarget = currentURLPathAndSearch() !== '/help';
      updateAppHistory('/help', historyMode);
    }
    if (!helpEl) {
      helpEl = createHelpPage(overlayContainer, {
        onBack: () => {
          if (helpHasAppBackTarget) {
            window.history.back();
          } else {
            updateAppHistory('/editor', 'replace');
            void syncEditorFromURL();
          }
        },
        onStartTour: async () => {
          updateAppHistory('/editor', 'push');
          transitionToEditor();
          await ensureEditorReady();
          if (!getState().session) {
            await createSession();
            runCode(defaultCode);
          }
          resetTour();
          startTour();
        },
      });
    }
    overlayContainer.classList.remove('hidden');
    editorUI.classList.add('hidden');
    if (landingEl) landingEl.classList.add('hidden');
    if (notFoundEl) notFoundEl.classList.add('hidden');
    if (catalogEl) catalogEl.classList.add('hidden');
    helpEl.classList.remove('hidden');
    updateDocumentTitle({ page: 'help' });
  }

  let catalogEl: HTMLElement | null = null;
  let catalogHasAppBackTarget = false;
  async function showCatalogPage(options: { history?: 'push' | 'replace' | 'none' } = {}) {
    const historyMode = options.history ?? 'push';
    if (historyMode !== 'none') {
      catalogHasAppBackTarget = currentURLPathAndSearch() !== '/catalog';
      updateAppHistory('/catalog', historyMode);
    }
    if (!catalogEl) {
      catalogEl = await createCatalogPage(overlayContainer, {
        onBack: () => {
          if (catalogHasAppBackTarget) {
            window.history.back();
          } else {
            updateAppHistory('/', 'replace');
            void syncRouteFromURL();
          }
        },
        onLoadEntry: handleCatalogEntryLoad,
      });
    }
    overlayContainer.classList.remove('hidden');
    editorUI.classList.add('hidden');
    if (landingEl) landingEl.classList.add('hidden');
    if (helpEl) helpEl.classList.add('hidden');
    if (notFoundEl) notFoundEl.classList.add('hidden');
    catalogEl.classList.remove('hidden');
    updateDocumentTitle({ page: 'catalog' });
  }

  // Import a catalog entry as a fresh session and navigate to the editor.
  async function handleCatalogEntryLoad(_entry: CatalogManifestEntry, payload: ExportedSession) {
    // Push the editor history entry BEFORE importing. importSessionPayload
    // calls openSession() internally, which uses replaceState (see
    // sessionManager.updateURL). Without an earlier push, that replaceState
    // would clobber whatever page we came from (e.g. /catalog) and break the
    // browser back button.
    updateAppHistory('/editor', 'push');
    transitionToEditor();
    await ensureEditorReady();
    await importSessionPayload(payload);
    updateDocumentTitle({ page: 'editor' });
  }

  async function syncEditorFromURL() {
    transitionToEditor();
    const tab = getTabFromURL();
    switchTab(tab, { history: 'none' });
    updateDocumentTitle({ page: 'editor' });
    await ensureEditorReady();
    if (!engineOk) return;

    const sessionId = getSessionIdFromURL();
    if (sessionId) {
      const versionIndex = getVersionFromURL();
      const partId = getPartIdFromURL();
      const state = getState();
      const needsSessionLoad = state.session?.id !== sessionId;
      const needsPartLoad = partId !== null && state.currentPart?.id !== partId;
      const needsVersionLoad = versionIndex !== null && state.currentVersion?.index !== versionIndex;
      if (needsSessionLoad || needsPartLoad || needsVersionLoad) {
        const version = await openSession(sessionId, versionIndex ?? undefined, partId ?? undefined);
        if (version) {
          await loadVersionIntoEditor(version);
          if (tab === 'gallery') refreshGallery();
          if (tab === 'versions') refreshVersions();
          return;
        }
        // No version returned. If the session nonetheless opened (it exists but
        // the active part has no saved versions yet), show that part's starter
        // — loadPartIntoEditor also clears stale paint state — instead of the
        // generic default example.
        if (getState().session?.id === sessionId) {
          await loadPartIntoEditor(getState().currentVersion);
          if (tab === 'gallery') refreshGallery();
          if (tab === 'versions') refreshVersions();
          return;
        }
        // Otherwise the session ID in the URL doesn't exist in IndexedDB (a
        // stale bookmark or a URL shared from another device). Fall through to
        // create a fresh session and run defaults, so the viewport renders and
        // the status doesn't stay stuck on "Loading WASM...".
      } else {
        return;
      }
    }
    if (!getState().session) {
      await createSession();
    }
    setStatus(statusBar, 'ready', 'Ready');
    runCode(defaultCode);
  }

  async function syncRouteFromURL() {
    // Routing to a non-editor page (landing, catalog, help, 404) drops
    // the AI chat back to the global bucket. The drawer is a body-level
    // overlay that follows the user across pages, so without this the
    // last session's transcript would still be visible after clicking
    // Home — confusing because no editor / session is loaded to act on
    // it. /editor's own loader updates the AI session via onStateChange
    // when a session opens, so we don't need to set it explicitly here.
    if (shouldShowLanding() || shouldShowHelp() || shouldShowCatalog() || shouldShow404()) {
      void setAiActiveSession(null);
    }
    if (shouldShowLanding()) {
      await showLandingPage();
    } else if (shouldShowHelp()) {
      showHelp({ history: 'none' });
    } else if (shouldShowCatalog()) {
      await showCatalogPage({ history: 'none' });
    } else if (shouldShow404()) {
      showNotFoundPage();
    } else {
      await syncEditorFromURL();
    }
  }

  window.addEventListener('popstate', () => {
    void syncRouteFromURL();
  });

  // Expose showHelp for toolbar
  const windowRecord = window as unknown as Record<string, unknown>;
  windowRecord.__partwrightShowHelp = showHelp;
  windowRecord.__mainifoldShowHelp = showHelp;

  // Check which page to show before loading heavy resources
  const showLanding = shouldShowLanding();
  const showHelpPage = shouldShowHelp();
  const showCatalog = shouldShowCatalog();
  const show404 = shouldShow404();

  if (showLanding) {
    await showLandingPage();
  } else if (showHelpPage) {
    showHelp({ history: 'none' });
  } else if (showCatalog) {
    await showCatalogPage({ history: 'none' });
  } else if (show404) {
    showNotFoundPage();
  }

  // Init geometry engine — wrapped in try/catch so editor/viewport still init on failure
  setStatus(statusBar, 'loading', 'Loading WASM...');
  try {
    await initEngine();
    engineOk = true;
  } catch (e) {
    console.error('WASM engine failed to load:', e);
    setStatus(statusBar, 'error', 'WASM failed');
  }

  // Init viewport
  initViewport(viewportPane);
  // Keep the live triangle-count readout (and high-complexity warning) in sync
  // with every displayed mesh — runs, paint strokes, simplify, clear.
  setOnMeshUpdate((mesh) => refreshTriangleCount(mesh.numTri));

  // Init measure tool
  initMeasureTool(getCanvas(), getCamera(), getMeshGroup(), viewportPane);

  // Init editor — only auto-run if auto-run is enabled. Auto-runs drive the
  // live preview but defer error surfacing (no panel/markers/log mid-keystroke);
  // the idle + blur hooks surface the held-back error gently once typing settles.
  initEditor(editorContainer, defaultCode, (code: string) => {
    if (isAutoRun()) runCode(code, { surfaceErrors: false });
  }, 'manifold-js', {
    onEdit: () => clearEditorErrorPanel(editorErrorPanel),
    onIdle: () => surfacePendingError(),
    onBlur: () => surfacePendingError(),
  });

  // When the user changes the modeling-quality preset, re-render the
  // current code so the new segment count takes effect immediately.
  onQualitySettingsChange(() => { runCode(); });

  // Wire up clip controls
  initClipControls(clipControls);

  // Declared up here (before the simplify bridge and initMeasureToggle that
  // reference it) so neither the closure capture below nor the assignment inside
  // initMeasureToggle hits a let-TDZ error.
  let closeMeasureIfActive: () => boolean = () => false;

  // === Simplify (mesh decimation) bridge ===
  // The simplify panel reduces the live model's triangle count. Because that
  // changes mesh topology — not something derivable from the parametric code —
  // it operates on the rendered result: the baseline is the full-detail mesh
  // captured when the panel opens, previews swap the live mesh in place (so
  // exports use it), and "Save as version" bakes the reduced mesh into a new
  // imported-style version. The baseline persists across panel open/close and
  // is cleared whenever a code run replaces the geometry.
  let simplifyBaselineMesh: MeshData | null = null;

  // Replace the live geometry with `mesh`: rebuild the queryable Manifold and
  // refresh the viewport, paint-adjacency map, stats, and clip bounds. Mirrors
  // the tail of runCodeSync so exports / slicing / measurements stay correct.
  function applyLiveGeometry(mesh: MeshData): void {
    // Bump the paint generation so any in-flight subdivision worker discards
    // its result instead of stamping a refined mesh built from the OLD base
    // over the new geometry.
    resetPaintWorkerState();
    currentMeshData = mesh;
    paintBaseMesh = mesh;
    if (currentManifold && typeof currentManifold.delete === 'function') {
      try { currentManifold.delete(); } catch { /* already deleted */ }
    }
    const mod = getModule();
    currentManifold = mod && mesh ? mod.Manifold.ofMesh(mesh) : null;
    updateMesh(mesh);
    updatePaintMesh(mesh);
    updateGeometryData();
    syncClipSliderBounds();
  }

  const simplifyHandlers: SimplifyHandlers = {
    open(userInitiated) {
      if (userInitiated) {
        // Don't let two overlay panels share the top-right slot.
        if (isPaintOpen()) closePaintMenu();
        if (isAnnotateOpen()) closeAnnotateMenu();
        closeMeasureIfActive();
      }
      if (!currentMeshData) {
        return { ok: false, reason: 'Run some code first — there’s no model to simplify.' };
      }
      if (!currentManifold) {
        return { ok: false, reason: 'Simplify needs a solid (manifold) model. Render-only imports can’t be reduced.' };
      }
      if (hasColorRegions()) {
        return { ok: false, reason: 'Clear paint regions before simplifying — reducing triangles would invalidate them.' };
      }
      if (!simplifyBaselineMesh) simplifyBaselineMesh = currentMeshData;
      return {
        ok: true,
        info: {
          baseTriangles: simplifyBaselineMesh.numTri,
          currentTriangles: currentMeshData.numTri,
        },
      };
    },

    async apply(targetTriangles, onProgress, signal) {
      const baseline = simplifyBaselineMesh;
      if (!baseline) return null;
      // Dragging the target back to (or above) full detail is just a restore —
      // no search to run, so report it as instantly complete.
      if (targetTriangles >= baseline.numTri) {
        applyLiveGeometry(baseline);
        await onProgress(1);
        return { triangleCount: baseline.numTri };
      }
      const bbox = bboxFromMesh(baseline);
      const diag = bbox
        ? Math.hypot(bbox.max[0] - bbox.min[0], bbox.max[1] - bbox.min[1], bbox.max[2] - bbox.min[2])
        : 0;
      if (!(diag > 0)) return null;

      // Run the binary-search reduction off the main thread so a heavy mesh
      // doesn't freeze the viewport. The worker reports progress per
      // iteration and honors `signal` for Cancel.
      const result = await simplifyInWorker(
        baseline,
        targetTriangles,
        diag * 0.5,
        (fraction) => { void onProgress(fraction); },
        signal,
      );
      // The search yields to the event loop, so a code run can replace the
      // geometry mid-flight. If the baseline moved, our result is stale —
      // drop it rather than clobber the freshly-run mesh.
      if (simplifyBaselineMesh !== baseline) return null;
      if (!result) {
        applyLiveGeometry(baseline);
        return null;
      }
      applyLiveGeometry(result.mesh);
      return { triangleCount: result.triangleCount };
    },

    reset() {
      if (simplifyBaselineMesh) applyLiveGeometry(simplifyBaselineMesh);
    },

    async save() {
      const baseline = simplifyBaselineMesh;
      if (!getState().session) {
        return { ok: false, message: 'Open a session before saving.' };
      }
      if (!currentMeshData || !baseline || currentMeshData.numTri >= baseline.numTri) {
        return { ok: false, message: 'Reduce the model first, then save.' };
      }
      try {
        const reduced = currentMeshData;

        // Preserve the pre-simplify model as its own version first, so baking the
        // reduced mesh (which overwrites the editor with an import wrapper) never
        // silently discards the full-detail original. Skip when the editor already
        // matches the current saved version (formatting-aware, so a version saved
        // with raw code isn't re-saved just because the editor reformatted it).
        const originalCode = getValue();
        const current = getState().currentVersion;
        let savedOriginal = false;
        if (!current || editorContentDiffersFrom(current.code)) {
          const original = await snapshotMeshAsVersion(baseline, originalCode);
          savedOriginal = !!(await saveVersion(originalCode, original.geometryData, original.thumbnail));
        }

        const baked = toImportedMesh(`simplified-${reduced.numTri}tri`, reduced);
        const code = generateImportCode([baked], { manifold: true });
        setActiveImports([baked]);
        setValue(code);
        await runCodeSync(code);
        const thumbnail = await captureThumbnail();
        const geometryData = getGeometryDataObj();
        await saveVersion(code, geometryData, thumbnail, 'simplified', undefined, {
          force: true,
          importedMeshes: [baked],
        });
        const tri = reduced.numTri.toLocaleString();
        return {
          ok: true,
          message: savedOriginal
            ? `Saved original + simplified (${tri} triangles).`
            : `Saved as a new version (${tri} triangles).`,
        };
      } catch (e) {
        return { ok: false, message: `Save failed: ${(e as Error).message}` };
      }
    },
  };

  // Wire up viewport overlay buttons
  initWireframeToggle(clipControls);
  initGridToggle(clipControls);
  initDimensionsToggle(clipControls);
  initAnnotateUI(clipControls);
  initPaintUI(clipControls);
  initSimplifyUI(clipControls, simplifyHandlers);
  initMeasureToggle(clipControls);
  initOrbitLockToggle(clipControls);
  initEscapeMenuClose();

  // Initialize editor lock
  initEditorLock(editorContainer);

  // Set up unlock handlers
  setUnlockHandlers(
    // Fork: save the colored version (if needed), then create a new uncolored version
    async (colorData) => {
      if (getState().session && currentMeshData) {
        const code = getValue();

        // 1. Only save the colored version if it doesn't already have colorRegions persisted
        const currentVersion = getState().currentVersion;
        const alreadyPersisted = currentVersion?.geometryData &&
          Array.isArray((currentVersion.geometryData as Record<string, unknown>).colorRegions);

        if (!alreadyPersisted) {
          const thumbnail = await captureThumbnail();
          const coloredGeoData = getGeometryDataObj() ?? {};
          coloredGeoData.colorRegions = colorData;
          await saveVersion(code, coloredGeoData, thumbnail, 'colored', undefined, { force: true });
        }

        // 2. Re-render without colors, then save an uncolored sibling
        updateMesh(currentMeshData, { skipAutoFrame: true });

        const cleanGeoData = getGeometryDataObj() ?? {};
        delete cleanGeoData.colorRegions;
        const cleanThumb = await captureThumbnail();
        await saveVersion(code, cleanGeoData, cleanThumb, undefined, undefined, { force: true });
      } else {
        // No session — just re-render without colors
        if (currentMeshData) {
          updateMesh(currentMeshData, { skipAutoFrame: true });
        }
      }
    },
    // Clear: just re-render without colors (clearRegions already called)
    () => {
      if (currentMeshData) {
        updateMesh(currentMeshData, { skipAutoFrame: true });
      }
    },
  );

  // When a color region is painted, re-render the mesh with colors and sync lock
  setOnRegionPainted(() => {
    if (currentMeshData) {
      const colored = applyTriColorsIfVisible(currentMeshData);
      updateMesh(colored, { skipAutoFrame: true });
    }
    syncLockState();
  });

  // Any region change reconciles the working mesh: incremental stroke append,
  // full rebuild, or the lightweight no-subdivision refresh. The async variant
  // runs the heavy subdivision in a Web Worker (with a Cancel button) so a
  // single max-settings stroke can't freeze the tab — see
  // reconcilePaintedGeometryAsync.
  onColorRegionsChange(() => { void reconcilePaintedGeometryAsync(); });

  // Toggling paint visibility re-renders the viewport so colors
  // disappear/reappear immediately. Exports remain colored regardless.
  onPaintVisibilityChange(() => {
    if (!currentMeshData) return;
    const colored = applyTriColorsIfVisible(currentMeshData);
    updateMesh(colored, { skipAutoFrame: true });
  });

  editorReady = true;
  editorReadyResolve();

  // Start guided tour on first visit (after editor fully renders)
  if (!showLanding && !showHelpPage && !showCatalog && !show404) {
    maybeStartTour();
    maybeShowShortcutsHint();
  }

  // If not on landing/help/catalog/404, load session or default code now
  if (!showLanding && !showHelpPage && !showCatalog && !show404 && engineOk) {
    await syncEditorFromURL();
  }

  // Keep this tab's session state in sync with peer tabs that mutate the same
  // session in another window, and coordinate single-writer leadership.
  initSessionTabSync();
  initSessionLeader();
  // Reflect single-writer ownership across the whole editor surface: the
  // non-owner tab becomes a read-only viewer (editor + paint + run + save
  // disabled, with a "Take over" banner).
  initViewerMode();

  // Update document title when session state changes (create, open, close, rename)
  onStateChange((state) => {
    updateDocumentTitle({ page: 'editor', sessionName: state.session?.name ?? null });
    // Re-bind the AI panel to the current session so chat history follows.
    void setAiActiveSession(state.session?.id ?? null);
    // Claim (or queue for) write-ownership of the now-active session so two
    // tabs on the same session don't both drive the chat / save versions.
    void acquireSessionLock(state.session?.id ?? null);
    // A read-only viewer mirrors the leader's current (latest) version into its
    // editor + viewport so it reads along instead of freezing on an old one.
    if (isReadOnlyViewer() && state.currentVersion && getValue() !== state.currentVersion.code) {
      void loadVersionIntoEditor(state.currentVersion);
    }
  });

  // Tell the session manager this tab's viewer status so cross-tab reloads
  // follow the latest version when we're a viewer; and when we *become* a
  // viewer (a peer took control), snap to the leader's latest state.
  setViewerPredicate(() => isReadOnlyViewer());
  onOwnershipChange(({ sessionId, owned }) => {
    if (sessionId && !owned) void refreshCurrentSession();
  });

  // syncEditorFromURL() above opened the initial session BEFORE the listener
  // was registered, so claim that session's leadership explicitly now —
  // otherwise a tab that loads straight into a session (?session=…) never
  // engages the single-writer lock. ?takeover=1 (from a "Take control" reload)
  // claims leadership outright, bumping the other tab to read-only; strip it so
  // it doesn't stick on refresh.
  {
    const tparams = new URLSearchParams(window.location.search);
    const steal = tparams.get('takeover') === '1';
    void acquireSessionLock(getState().session?.id ?? null, { steal });
    if (steal) {
      tparams.delete('takeover');
      const qs = tparams.toString();
      window.history.replaceState(null, '', window.location.pathname + (qs ? `?${qs}` : ''));
    }
  }

  // Initialize the AI chat side drawer once the editor UI is mounted.
  // Wraps initAiPanel + setAiToolbarState; tolerated if it fails (e.g.
  // network blocks /ai.md) — toolbar still shows the Connect button.
  void (async () => {
    try {
      await initAiPanel({
        onNavigateToEditor: async () => {
          updateAppHistory('/editor', 'push');
          await syncRouteFromURL();
        },
        mountInto: appRow,
      });
      const cur = getState();
      await setAiActiveSession(cur.session?.id ?? null);
      await refreshAiToolbarChip();
      // Watch for key/provider changes via a poll-on-focus trigger — cheap,
      // and matches the chip's update cadence in the AI settings modal.
      window.addEventListener('focus', () => { void refreshAiToolbarChip(); });
      // Also watch localStorage for cross-tab provider switches. Drop our
      // cached settings blob first so refreshAiToolbarChip (and any
      // onSettingsChange subscriber, e.g. the AI panel) reads the peer tab's
      // change instead of our stale copy.
      window.addEventListener('storage', e => {
        if (e.key === 'partwright-ai-settings-v1') {
          reloadSettingsFromStorage();
          void refreshAiToolbarChip();
        }
      });
    } catch (err) {
      console.warn('AI panel init failed:', err);
    }
  })();

  async function refreshAiToolbarChip(): Promise<void> {
    // Local model configured → 'local'; any hosted-provider key → 'cloud';
    // otherwise 'disconnected'. The chat panel surfaces its own per-provider
    // banner when the active dropdown is on a provider missing a key.
    setAiToolbarState(await aiConnectionMode());
  }

  // Set initial editor title if we're on the editor page
  if (!showLanding && !showHelpPage && !showCatalog && !show404) {
    updateDocumentTitle({ page: 'editor' });
  }

  // Clean up empty auto-created sessions when leaving the page, and warn
  // when there are painted color regions that haven't been saved yet.
  window.addEventListener('beforeunload', (event) => {
    const state = getState();
    if (state.session && state.versionCount === 0) {
      deleteIfEmpty(state.session.id);
    }
    // Warn if in-memory color regions exist but the current persisted version
    // doesn't have them — i.e. the user painted but hasn't hit Save yet.
    if (hasColorRegions()) {
      const persistedRegions = (state.currentVersion?.geometryData as Record<string, unknown> | null | undefined)?.colorRegions;
      const alreadySaved = Array.isArray(persistedRegions) && (persistedRegions as unknown[]).length > 0;
      if (!alreadySaved) {
        event.preventDefault();
        // returnValue is required for cross-browser compat (Chrome ignores just preventDefault)
        event.returnValue = '';
      }
    }
  });

  // === Language switching helper ===
  async function switchLanguage(lang: Language) {
    setActiveLanguage(lang);
    setEditorLanguage(lang);
    setToolbarLanguage(lang);
    // Update the editor title (shows the active part name, or the filename
    // fallback when no part is open).
    syncEditorTitle(getState());
    setStatus(statusBar, 'running', lang === 'scad' ? 'Loading OpenSCAD...' : 'Switching...');
    try {
      await ensureEngineReady(lang);
    } catch (e) {
      const msg = `Failed to load ${lang}: ${e instanceof Error ? e.message : String(e)}`;
      setStatus(statusBar, 'error', msg);
      errorLog.capture({ level: 'error', source: 'engine', message: msg });
      throw e;
    }
    // Persist the language to the active session so reopening it loads in the
    // correct mode. Without this, sessions created before a language switch
    // keep their stale language field and reload in the wrong engine, parsing
    // SCAD code as JS (or vice versa).
    const sid = getState().session?.id;
    if (sid) await setSessionLanguage(sid, lang);
    setStatus(statusBar, 'ready', 'Ready');
  }

  // === Execution state ===
  // (`_running` is declared at the top of main() so async callbacks fired
  // during initial load don't hit a Temporal Dead Zone error.)

  async function executeIsolated(code: string, lang?: Language) {
    const t0 = performance.now();
    const result = await executeCodeAsync(code, lang);
    const elapsed = Math.round(performance.now() - t0);

    if (result.error) {
      recordError(result.error);
      return {
        geometryData: {
          status: 'error' as const,
          error: result.error,
          diagnostics: result.diagnostics ?? [],
          executionTimeMs: elapsed,
          codeHash: simpleHash(code),
        },
        meshData: null as MeshData | null,
        manifold: null as unknown,
      };
    }

    // Reconstruct the Manifold if the Worker path returned manifold=null.
    const mod = getModule();
    const manifold = result.manifold ?? (mod && result.mesh ? mod.Manifold.ofMesh(result.mesh) : null);
    const stats = computeGeometryStats(manifold, result.mesh!, elapsed, code);
    return {
      geometryData: stats,
      meshData: result.mesh,
      manifold,
    };
  }

  // === Expose window.partwright console API ===
  const partwrightAPI = {
    /** Run code string and update all views. Returns geometry data object. */
    async run(code?: string): Promise<Record<string, unknown>> {
      assertString(code, 'run(code)', { optional: true, allowEmpty: false });
      const src = code ?? getValue();
      if (code !== undefined) setValue(code);
      const applied = await runCodeSync(src);
      if (!applied) {
        return { status: 'error', error: 'Run was superseded by a concurrent execution — retry' };
      }
      return JSON.parse(geometryDataEl.textContent || '{}');
    },

    /** Get current geometry stats without re-running */
    getGeometryData(): Record<string, unknown> {
      const geo = JSON.parse(geometryDataEl.textContent || '{}');
      const warnings = geometryWarnings(geo);
      return warnings.length > 0 ? { ...geo, warnings } : geo;
    },

    /** Get current editor code */
    getCode(): string {
      return getValue();
    },

    /** Set editor code (does not auto-run — call .run() after) */
    setCode(code: string): void {
      assertString(code, 'setCode(code)', { allowEmpty: true });
      setValue(code);
    },

    /** Slice current manifold at Z height. Returns cross-section data. */
    sliceAtZ(z: number) {
      const check = guard(() => assertNumber(z, 'sliceAtZ(z)'));
      if (typeof check === 'object' && check !== null && 'error' in check) return check;
      if (!currentManifold) return { error: 'No geometry loaded' };
      return sliceAtZ(currentManifold, z);
    },

    /** Get bounding box of current geometry */
    getBoundingBox() {
      if (!currentManifold) return null;
      return getBoundingBox(currentManifold);
    },

    /** Get the raw manifold-3d module (for advanced use) */
    getModule() {
      return getModule();
    },

    /** Export current model as GLB download. Optional filename override. */
    async exportGLB(filename?: string) {
      assertString(filename, 'exportGLB(filename)', { optional: true });
      if (currentMeshData) assertFiniteMesh(currentMeshData);
      await exportGLB(filename);
    },

    /** Export current model as STL download. Optional filename override. */
    exportSTL(filename?: string) {
      assertString(filename, 'exportSTL(filename)', { optional: true });
      if (currentMeshData) exportSTL(currentMeshData, filename);
    },

    /** Export current model as OBJ download. Optional filename override. */
    exportOBJ(filename?: string) {
      assertString(filename, 'exportOBJ(filename)', { optional: true });
      if (currentMeshData) exportOBJ(hasColorRegions() ? applyTriColors(currentMeshData) : currentMeshData, filename);
    },

    /** Export current model as 3MF download. Optional filename override. */
    export3MF(filename?: string) {
      assertString(filename, 'export3MF(filename)', { optional: true });
      if (currentMeshData) export3MF(hasColorRegions() ? applyTriColors(currentMeshData) : currentMeshData, filename);
    },

    // === AI-friendly export API ===
    // These return file contents over the API instead of triggering a browser
    // download — so AI agents (which can't observe Downloads-folder files) can
    // inspect, save elsewhere, or pipe the bytes onward. Each export is also
    // added to the Recent Exports inbox so the user can re-download from the UI.

    /** Build a GLB and return its bytes as base64. Same blob as exportGLB(). */
    async exportGLBData(filename?: string) {
      assertString(filename, 'exportGLBData(filename)', { optional: true });
      if (currentMeshData) assertFiniteMesh(currentMeshData);
      const built = await buildGLB(filename);
      registerExportFromBuilt(built, 'GLB');
      return {
        filename: built.filename,
        mimeType: built.mimeType,
        sizeBytes: built.blob.size,
        base64: await blobToBase64(built.blob),
      };
    },

    /** Build an STL and return its bytes as base64. */
    async exportSTLData(filename?: string) {
      assertString(filename, 'exportSTLData(filename)', { optional: true });
      if (!currentMeshData) return { error: 'No geometry loaded' };
      const built = buildSTL(currentMeshData, filename);
      registerExportFromBuilt(built, 'STL');
      return {
        filename: built.filename,
        mimeType: built.mimeType,
        sizeBytes: built.blob.size,
        base64: await blobToBase64(built.blob),
      };
    },

    /**
     * Build an OBJ. If the mesh has painted color regions the result is a ZIP
     * (returned as base64); otherwise it's plain text (returned as `text`).
     * Inspect `mimeType` to tell which.
     */
    async exportOBJData(filename?: string) {
      assertString(filename, 'exportOBJData(filename)', { optional: true });
      if (!currentMeshData) return { error: 'No geometry loaded' };
      const mesh = hasColorRegions() ? applyTriColors(currentMeshData) : currentMeshData;
      const built = buildOBJ(mesh, filename);
      registerExportFromBuilt(built, 'OBJ');
      const isText = built.mimeType === 'text/plain';
      return {
        filename: built.filename,
        mimeType: built.mimeType,
        sizeBytes: built.blob.size,
        ...(isText
          ? { text: await built.blob.text() }
          : { base64: await blobToBase64(built.blob) }),
      };
    },

    /** Build a 3MF (always a ZIP) and return its bytes as base64. */
    async export3MFData(filename?: string) {
      assertString(filename, 'export3MFData(filename)', { optional: true });
      if (!currentMeshData) return { error: 'No geometry loaded' };
      const mesh = hasColorRegions() ? applyTriColors(currentMeshData) : currentMeshData;
      const built = build3MF(mesh, filename);
      registerExportFromBuilt(built, '3MF');
      return {
        filename: built.filename,
        mimeType: built.mimeType,
        sizeBytes: built.blob.size,
        base64: await blobToBase64(built.blob),
      };
    },

    /** Build a session export (.partwright.json). Returns the parsed JSON object directly.
     *  Pass `options.includeThumbnails: true` to embed the per-version
     *  thumbnail PNG data URLs — needed when generating catalog entries. */
    async exportSessionData(sessionId?: string, options?: { includeThumbnails?: boolean; includeAnnotations?: boolean; includeNotes?: boolean }) {
      assertString(sessionId, 'exportSessionData(sessionId)', { optional: true, allowEmpty: false });
      if (options !== undefined) {
        const o = assertObject(options, 'exportSessionData(_, options)')!;
        assertNoUnknownKeys(o, ['includeThumbnails', 'includeAnnotations', 'includeNotes'], 'exportSessionData(_, options)');
        if (o.includeThumbnails !== undefined) assertBoolean(o.includeThumbnails, 'exportSessionData.options.includeThumbnails');
        if (o.includeAnnotations !== undefined) assertBoolean(o.includeAnnotations, 'exportSessionData.options.includeAnnotations');
        if (o.includeNotes !== undefined) assertBoolean(o.includeNotes, 'exportSessionData.options.includeNotes');
      }
      const built = await buildSessionJSON(sessionId, options);
      if (!built) return { error: 'No active session to export' };
      registerExportFromBuilt(built, 'Session JSON');
      return {
        filename: built.filename,
        mimeType: built.mimeType,
        sizeBytes: built.blob.size,
        data: built.data,
      };
    },

    /** Maintenance: merge a chat transcript from one session into another to
     *  reunite a conversation that got split across sessions. Re-sequences the
     *  combined transcript chronologically. Refresh the target session to see
     *  the result. Returns { moved, into } or { error }. */
    async mergeChatHistory(fromSessionId: string, toSessionId: string) {
      const check = guard(() => {
        assertString(fromSessionId, 'mergeChatHistory(fromSessionId)', { allowEmpty: false });
        assertString(toSessionId, 'mergeChatHistory(toSessionId)', { allowEmpty: false });
        return true;
      });
      if (typeof check === 'object' && check !== null && 'error' in check) return check;
      const moved = await mergeChatBucket(fromSessionId, toSessionId);
      if (moved === 0) return { error: 'No messages moved — check the source has chat and differs from the target.' };
      return { moved, into: toSessionId };
    },

    /** Return the current editor source as text + metadata. */
    exportCodeData() {
      const code = getValue();
      const built = buildRawCode(code, getActiveLanguage());
      registerExportFromBuilt(built, 'Code');
      return {
        filename: built.filename,
        mimeType: built.mimeType,
        sizeBytes: built.blob.size,
        language: built.language,
        text: built.text,
      };
    },

    // === AI-friendly import API ===
    // Bypass the file picker by accepting parsed payloads inline.

    /**
     * Import a parsed `.partwright.json` payload (object or string) as a new session.
     * Activates the new session on success.
     */
    async importSessionData(data: unknown) {
      let payload: unknown = data;
      if (typeof payload === 'string') {
        try { payload = JSON.parse(payload); } catch { return { error: 'importSessionData(data): could not parse string as JSON' }; }
      }
      const validated = validateSessionPayload(payload);
      if (!validated) return { error: 'importSessionData(data): payload missing partwright/mainifold brand, session, or any of versions[]/chat[]/notes[]' };
      const result = await importSessionPayload(validated);
      return { sessionId: result.sessionId };
    },

    /**
     * Import raw source code as a new session. `language` selects 'manifold-js' or 'scad'.
     */
    async importCodeData(code: string, language: Language, sessionName?: string) {
      const check = guard(() => {
        assertString(code, 'importCodeData(code)', { allowEmpty: false });
        assertEnum(language, ['manifold-js', 'scad'], 'importCodeData(language)');
        assertString(sessionName, 'importCodeData(sessionName)', { optional: true, allowEmpty: false });
      });
      if (typeof check === 'object' && check !== null && 'error' in check) return check;
      const result = await importCodePayload(code, language, sessionName);
      return { sessionId: result.sessionId };
    },

    // === Recent Exports inbox ===
    // The same list shown in the toolbar's Export → Recent Exports section.

    /** List recent exports (newest first). Bytes are not included — call getRecentExport() for those. */
    listRecentExports() {
      return listInboxExports().map(e => ({
        id: e.id,
        filename: e.filename,
        mimeType: e.mimeType,
        source: e.source,
        sizeBytes: e.sizeBytes,
        timestamp: e.timestamp,
      }));
    },

    /**
     * Look up a recent export by id and return its bytes.
     * Text-typed exports return `text`; everything else returns `base64`.
     */
    async getRecentExport(id: string) {
      const check = guard(() => assertString(id, 'getRecentExport(id)', { allowEmpty: false }));
      if (typeof check === 'object' && check !== null && 'error' in check) return check;
      const entry = getInboxExport(id);
      if (!entry) return { error: `No export with id "${id}"` };
      const isText = entry.mimeType === 'text/plain' || entry.mimeType === 'application/json';
      return {
        id: entry.id,
        filename: entry.filename,
        mimeType: entry.mimeType,
        source: entry.source,
        sizeBytes: entry.sizeBytes,
        timestamp: entry.timestamp,
        ...(isText
          ? { text: await entry.blob.text() }
          : { base64: await blobToBase64(entry.blob) }),
      };
    },

    /** Trigger a re-download of a recent export by id (no new inbox entry). */
    downloadRecentExport(id: string) {
      const check = guard(() => assertString(id, 'downloadRecentExport(id)', { allowEmpty: false }));
      if (typeof check === 'object' && check !== null && 'error' in check) return check;
      const entry = getInboxExport(id);
      if (!entry) return { error: `No export with id "${id}"` };
      downloadBlob(entry.blob, entry.filename, entry.source, { register: false });
      return { ok: true };
    },

    /** Empty the Recent Exports inbox. */
    clearRecentExports() {
      clearInboxExports();
    },

    /** Validate code without rendering. Returns { valid, error? } */
    async validate(code: string, opts?: { language?: Language }): Promise<{ valid: boolean; error?: string; diagnostics?: SourceDiagnostic[] }> {
      const check = guard(() => {
        assertString(code, 'validate(code)', { allowEmpty: false });
        if (opts !== undefined) {
          const o = assertObject(opts, 'validate(code, opts)')!;
          assertNoUnknownKeys(o, ['language'], 'validate(opts)');
          if (o.language !== undefined) assertEnum(o.language, ['manifold-js', 'scad'], 'validate(opts).language');
        }
        return true;
      });
      if (typeof check === 'object' && check !== null && 'error' in check) return { valid: false, error: check.error };
      const r = await validateCodeAsync(code, opts?.language);
      return r.valid ? { valid: true } : { valid: false, error: r.error, diagnostics: r.diagnostics ?? [] };
    },

    /** Get active engine language */
    getActiveLanguage(): Language {
      return getActiveLanguage();
    },

    /** Switch active engine language. Lazy-inits SCAD on first switch. */
    async setActiveLanguage(lang: Language): Promise<void> {
      assertEnum(lang, ['manifold-js', 'scad'], 'setActiveLanguage(lang)');
      await switchLanguage(lang);
    },

    // === Clipping API ===

    /** Toggle clipping plane on/off */
    toggleClip(enabled?: boolean) {
      assertBoolean(enabled, 'toggleClip(enabled)', { optional: true });
      const on = enabled ?? !getClipState().enabled;
      setClipping(on);
      syncClipUI();
      return getClipState();
    },

    /** Set clipping plane Z height */
    setClipZ(z: number) {
      assertNumber(z, 'setClipZ(z)');
      setClipZ(z);
      syncClipUI();
      return getClipState();
    },

    /** Get current clip state */
    getClipState() {
      return getClipState();
    },

    // === Viewport controls API ===

    /** Show or hide the grid plane. Pass a boolean to set, omit to toggle. */
    setGridVisible(visible?: boolean): boolean {
      assertBoolean(visible, 'setGridVisible(visible)', { optional: true });
      const on = visible ?? !isGridVisible();
      setGridVisible(on);
      return isGridVisible();
    },

    /** Whether the grid plane is currently visible */
    isGridVisible(): boolean {
      return isGridVisible();
    },

    /** Show or hide the bounding box dimension overlays. Pass a boolean to set, omit to toggle. */
    setDimensionsVisible(visible?: boolean): boolean {
      assertBoolean(visible, 'setDimensionsVisible(visible)', { optional: true });
      const on = visible ?? !isDimensionsVisible();
      setDimensionsVisible(on);
      return isDimensionsVisible();
    },

    /** Whether bounding box dimensions are currently visible */
    areDimensionsVisible(): boolean {
      return isDimensionsVisible();
    },

    /** Lock or unlock camera orbit rotation. Pass a boolean to set, omit to toggle. */
    setOrbitLock(locked?: boolean): boolean {
      assertBoolean(locked, 'setOrbitLock(locked)', { optional: true });
      const on = locked ?? !isUserOrbitLocked();
      setUserOrbitLock(on);
      return isUserOrbitLocked();
    },

    /** Whether camera orbit is currently locked */
    isOrbitLocked(): boolean {
      return isUserOrbitLocked();
    },

    // === Theme API ===

    /** Set the color theme. */
    setTheme(theme: Theme): void {
      assertEnum(theme, ['dark', 'light'], 'setTheme(theme)');
      setTheme(theme);
    },

    /** Get the current color theme */
    getTheme(): Theme {
      return getTheme();
    },

    // === Spending mode (AI budget) ===

    /** Read the AI spending budget — the preset plus the knobs it controls
     *  (thinking, image verification, painting, session notes, iteration and
     *  spend caps). Agents should respect it. `renderResolution` sets the
     *  default renderView/renderViews size (an explicit size still wins). */
    getSpendingMode() {
      return getSpendingSummary();
    },

    /** Set the AI spending budget preset: "cheap" | "balanced" | "expensive".
     *  Sets thinking, vision, paint, notes, and the iteration/spend caps at once
     *  (these are the in-app AI presets minimal/standard/full). */
    setSpendingMode(mode: 'cheap' | 'balanced' | 'expensive') {
      assertEnum(mode, ['cheap', 'balanced', 'expensive'] as const, 'setSpendingMode(mode)');
      applyAiSpendingMode(mode);
      return getSpendingSummary();
    },

    // === Auto-run API ===

    /** Enable or disable auto-run (re-render on edit). */
    setAutoRun(enabled: boolean): void {
      assertBoolean(enabled, 'setAutoRun(enabled)');
      setAutoRun(enabled);
    },

    /** Whether auto-run is currently enabled */
    isAutoRunEnabled(): boolean {
      return isAutoRun();
    },

    // === View rendering API ===

    /** Render a single view from any camera angle. Returns a data URL (PNG).
     *  elevation: degrees, 0 = horizon, 90 = top-down. Default 30.
     *  azimuth: degrees, 0 = front (-Y), 90 = right (+X). Default 315.
     *  ortho: true for orthographic projection. Default false.
     *  edges: edge overlay — 'none' (plain shaded), 'crease' (feature edges
     *  only), or 'wireframe' (every triangle). Default: 'crease' for
     *  uncolored meshes, 'none' for painted ones. */
    renderView(options?: { elevation?: number; azimuth?: number; ortho?: boolean; size?: number; edges?: EdgeMode }): string | null {
      if (options !== undefined) {
        const o = assertObject(options, 'renderView(options)')!;
        assertNoUnknownKeys(o, ['elevation', 'azimuth', 'ortho', 'size', 'edges'], 'renderView(options)');
        assertNumber(o.elevation, 'renderView(options).elevation', { optional: true, min: -90, max: 90 });
        assertNumber(o.azimuth, 'renderView(options).azimuth', { optional: true });
        assertBoolean(o.ortho, 'renderView(options).ortho', { optional: true });
        assertNumber(o.size, 'renderView(options).size', { optional: true, min: 1, integer: true });
        if (o.edges !== undefined) assertEnum(o.edges, EDGE_MODES, 'renderView(options).edges');
      }
      if (!currentMeshData) return null;
      // Default image size follows the spending-mode resolution budget when the
      // caller omits size; an explicit size still wins (e.g. a final hi-res check).
      const size = options?.size ?? getRenderBudget().defaultPx;
      return renderSingleView(applyTriColorsIfVisible(currentMeshData), { ...(options ?? {}), size });
    },

    /** Render multiple angles of the current model laid out in a single
     *  labeled grid, returned as one PNG data URL. The killer use case
     *  is "did this paint operation land where I thought" — a single
     *  top-down view can hide errors that show clearly from the front.
     *
     *  `views: 'auto'` (default) picks the angles by bounding-box aspect:
     *  flat models get [Top, Iso]; tall models get [Front, Right, Iso];
     *  everything else gets [Front, Top, Iso]. `views: 'tri'` forces the
     *  front/top/iso composite regardless of shape; `views: 'all'` is the
     *  classic 4-view iso grid (front/right/top/iso); `views: 'box'` is the
     *  6 orthographic axis faces (front/back/left/right/top/bottom) — the
     *  guaranteed all-faces check, since back/left/bottom are otherwise
     *  never shown. For total control, pass `angles` (an explicit list of
     *  {elevation, azimuth, ortho?, label?}) which overrides `views`.
     *  Bump `size` for a higher-resolution final inspection. `edges`
     *  ('none' | 'crease' | 'wireframe', default 'crease' for uncolored
     *  meshes) sets the edge overlay on every tile. */
    async renderViews(options?: { views?: RenderViewMode; angles?: Array<{ elevation: number; azimuth: number; ortho?: boolean; label?: string }>; size?: number; edges?: EdgeMode }): Promise<string | null> {
      if (options !== undefined) {
        const o = assertObject(options, 'renderViews(options)')!;
        assertNoUnknownKeys(o, ['views', 'angles', 'size', 'edges'], 'renderViews(options)');
        if (o.views !== undefined) assertEnum(o.views, RENDER_VIEW_MODES, 'renderViews(options).views');
        if (o.edges !== undefined) assertEnum(o.edges, EDGE_MODES, 'renderViews(options).edges');
        if (o.angles !== undefined) {
          const arr = assertArray(o.angles, 'renderViews(options).angles') as unknown[];
          for (let i = 0; i < arr.length; i++) {
            const a = assertObject(arr[i], `renderViews(options).angles[${i}]`)!;
            assertNoUnknownKeys(a, ['elevation', 'azimuth', 'ortho', 'label'], `renderViews(options).angles[${i}]`);
            assertNumber(a.elevation, `renderViews(options).angles[${i}].elevation`, { min: -90, max: 90 });
            assertNumber(a.azimuth, `renderViews(options).angles[${i}].azimuth`);
            assertBoolean(a.ortho, `renderViews(options).angles[${i}].ortho`, { optional: true });
            assertString(a.label, `renderViews(options).angles[${i}].label`, { optional: true, allowEmpty: true });
          }
        }
        assertNumber(o.size, 'renderViews(options).size', { optional: true, min: 1, integer: true });
      }
      if (!currentMeshData) return null;
      // Angle set and tile size default to the spending-mode budget when the
      // caller doesn't specify them; an explicit size still wins.
      const budget = getRenderBudget();
      const which = options?.views ?? budget.angles;
      const tileSize = options?.size ?? budget.defaultPx;
      const colored = applyTriColorsIfVisible(currentMeshData);
      const explicit = options?.angles;
      const angles = explicit && explicit.length > 0
        ? explicit.map((a) => ({
            label: a.label ?? `elev ${a.elevation}° az ${a.azimuth}°`,
            opts: { elevation: a.elevation, azimuth: a.azimuth, ortho: a.ortho ?? false },
          }))
        : chooseRenderAngles(which);

      const labelHeight = 24;
      const cellHeight = tileSize + labelHeight;
      const cols = angles.length <= 1 ? 1 : angles.length <= 4 ? 2 : 3;
      const rows = Math.ceil(angles.length / cols);
      const composite = document.createElement('canvas');
      composite.width = tileSize * cols;
      composite.height = cellHeight * rows;
      const ctx = composite.getContext('2d');
      if (!ctx) return null;
      ctx.fillStyle = '#f4f4f5';
      ctx.fillRect(0, 0, composite.width, composite.height);

      // Render each angle to a data URL via renderSingleView (each call
      // reuses the same offscreen WebGLRenderer), decode each to an
      // HTMLImageElement, then stamp into the composite grid.
      for (let i = 0; i < angles.length; i++) {
        const { label, opts } = angles[i];
        const dataUrl = renderSingleView(colored, { ...opts, size: tileSize, edges: options?.edges });
        if (!dataUrl) continue;
        const img = await loadImageFromDataUrl(dataUrl);
        if (!img) continue;
        drawCell(ctx, img, i, tileSize, cellHeight, label, cols);
      }
      return composite.toDataURL('image/png');
    },

    /** Render a cross-section at Z height as an SVG string for visual verification */
    sliceAtZVisual(z: number): { svg: string; area: number; contours: number } | null {
      assertNumber(z, 'sliceAtZVisual(z)');
      if (!currentManifold) return null;
      const s = sliceAtZ(currentManifold, z);
      if (!s) return null;
      const svg = renderSliceSVG(s.polygons as [number, number][][], s.boundingBox);
      return { svg, area: s.area, contours: s.polygons.length };
    },

    /** Slice the currently loaded model with an axis-aligned plane and return
     *  the cross-section as an SVG data URL. Useful when the agent needs to
     *  see internal structure (cavities, walls, supports) without exporting.
     *
     *  - `axis`: 'x' | 'y' | 'z' (default 'z')
     *  - `offset`: where along the axis to cut. If omitted, defaults to the
     *    midpoint of the model's bounding box along that axis.
     *  - `size`: pixel size of the rendered SVG (default 400). The result is
     *    a data URL the agent can drop straight into setImages or display.
     *
     *  Works for any engine (manifold-js or SCAD) — it operates on the rendered
     *  manifold, not the source code. */
    renderSection(options?: { axis?: 'x' | 'y' | 'z'; offset?: number; size?: number }):
      { dataUrl: string; svg: string; axis: 'x' | 'y' | 'z'; offset: number; area: number; contours: number } | null {
      let axis: 'x' | 'y' | 'z' = 'z';
      let offset: number | undefined;
      let size = 400;
      if (options !== undefined) {
        const o = assertObject(options, 'renderSection(options)')!;
        assertNoUnknownKeys(o, ['axis', 'offset', 'size'], 'renderSection(options)');
        if (o.axis !== undefined) {
          assertEnum(o.axis, ['x', 'y', 'z'] as const, 'renderSection(options).axis');
          axis = o.axis as 'x' | 'y' | 'z';
        }
        if (o.offset !== undefined) assertNumber(o.offset, 'renderSection(options).offset');
        if (o.size !== undefined) assertNumber(o.size, 'renderSection(options).size', { min: 16, max: 4096, integer: true });
        offset = o.offset as number | undefined;
        size = (o.size as number | undefined) ?? size;
      }
      if (!currentManifold) return null;

      // manifold-3d only exposes .slice(z) for the Z plane. For X/Y we rotate
      // the manifold so that axis points along Z, slice, then label the result
      // with the original axis and the un-rotated offset.
      const bb = currentManifold.boundingBox();
      const axisIdx = axis === 'x' ? 0 : axis === 'y' ? 1 : 2;
      const lo = bb.min[axisIdx];
      const hi = bb.max[axisIdx];
      const actualOffset = offset ?? (lo + hi) / 2;

      let sliceTarget = currentManifold;
      let zHeight = actualOffset;
      let unrotate = false;
      if (axis === 'x') {
        // Rotate +X to +Z (rotation around Y by -90°).
        sliceTarget = currentManifold.rotate([0, -90, 0]);
        zHeight = actualOffset;
        unrotate = true;
      } else if (axis === 'y') {
        // Rotate +Y to +Z (rotation around X by 90°).
        sliceTarget = currentManifold.rotate([90, 0, 0]);
        zHeight = actualOffset;
        unrotate = true;
      }

      const result = sliceAtZ(sliceTarget, zHeight);
      if (unrotate && typeof sliceTarget.delete === 'function') {
        try { sliceTarget.delete(); } catch { /* already gone */ }
      }
      if (!result) return null;

      const svg = renderSliceSVG(result.polygons as [number, number][][], result.boundingBox, size);
      const dataUrl = 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
      return {
        dataUrl,
        svg,
        axis,
        offset: actualOffset,
        area: result.area,
        contours: result.polygons.length,
      };
    },

    /** Per-connected-component bounding boxes and volumes for the current
     *  model. Sorted largest-volume first, so [0] is the main body and
     *  [1+] are satellite pieces (often the result of a leaked boolean).
     *
     *  Works for any engine — operates on the rendered manifold. */
    componentBounds(): Array<{ index: number; volume: number; triangleCount: number; vertexCount: number; bbox: { min: [number, number, number]; max: [number, number, number]; size: [number, number, number]; center: [number, number, number] } }> | null {
      if (!currentManifold) return null;
      if (currentManifold.isEmpty?.()) return [];
      const pieces = currentManifold.decompose();
      const out = pieces.map((p: { boundingBox: () => { min: number[]; max: number[] }; volume: () => number; numTri: () => number; numVert: () => number; delete?: () => void }, i: number) => {
        const bb = p.boundingBox();
        const min: [number, number, number] = [bb.min[0], bb.min[1], bb.min[2]];
        const max: [number, number, number] = [bb.max[0], bb.max[1], bb.max[2]];
        const info = {
          index: i,
          volume: p.volume(),
          triangleCount: p.numTri(),
          vertexCount: p.numVert(),
          bbox: {
            min, max,
            size: [max[0] - min[0], max[1] - min[1], max[2] - min[2]] as [number, number, number],
            center: [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2] as [number, number, number],
          },
        };
        try { p.delete?.(); } catch { /* ignore */ }
        return info;
      });
      out.sort((a: { volume: number }, b: { volume: number }) => b.volume - a.volume);
      for (let i = 0; i < out.length; i++) out[i].index = i;
      return out;
    },

    /** Is the given point inside the currently loaded solid? Uses a tiny
     *  probe cube — robust for points well inside or well outside, may be
     *  ambiguous within ~1e-5 of the surface. Works for any engine. */
    pointInside(point: [number, number, number]): boolean | null {
      const arr = assertArray(point, 'pointInside(point)') as unknown[];
      if (arr.length !== 3) throw new ValidationError('pointInside(point): point must be a [x,y,z] vector');
      for (let i = 0; i < 3; i++) assertNumber(arr[i], `pointInside(point)[${i}]`);
      if (!currentManifold || currentManifold.isEmpty?.()) return null;
      const p = arr as [number, number, number];
      const bb = currentManifold.boundingBox();
      if (p[0] < bb.min[0] || p[0] > bb.max[0]) return false;
      if (p[1] < bb.min[1] || p[1] > bb.max[1]) return false;
      if (p[2] < bb.min[2] || p[2] > bb.max[2]) return false;
      const sx = Math.max(bb.max[0] - bb.min[0], bb.max[1] - bb.min[1], bb.max[2] - bb.min[2], 1);
      const eps = sx * 1e-5;
      const mod = getModule();
      if (!mod) return null;
      // Capture each Manifold allocation separately so we can .delete() all of
      // them. `Manifold.cube(...).translate(...)` allocates two — the un-named
      // intermediate would otherwise leak the cube's WASM heap memory.
      const cube = mod.Manifold.cube([eps, eps, eps], true);
      const probe = cube.translate(p);
      const inter = probe.intersect(currentManifold);
      const inside = !inter.isEmpty();
      try { inter.delete?.(); } catch { /* ignore */ }
      try { probe.delete?.(); } catch { /* ignore */ }
      try { cube.delete?.(); } catch { /* ignore */ }
      return inside;
    },

    /** Heal the current model: run a simplify pass (collapse near-degenerate
     *  edges, re-run the boolean-cleanup pipeline) and return whether the
     *  result is now a clean manifold. Useful after STL import or whenever
     *  a boolean produced unexpected components. Works for any engine. */
    healCurrent(opts?: { tolerance?: number }): { ok: boolean; volumeDelta: number; triangleDelta: number; componentCountBefore: number; componentCountAfter: number } | null {
      if (opts !== undefined) {
        const o = assertObject(opts, 'healCurrent(opts)')!;
        assertNoUnknownKeys(o, ['tolerance'], 'healCurrent(opts)');
        if (o.tolerance !== undefined) assertNumber(o.tolerance, 'healCurrent(opts).tolerance', { min: 0 });
      }
      if (!currentManifold || currentManifold.isEmpty?.()) return null;
      // decompose() returns an array of fresh Manifolds — we must .delete()
      // each piece after counting, otherwise this leaks O(components) of WASM
      // heap on every healCurrent call.
      const beforePieces = currentManifold.decompose();
      const before = {
        volume: currentManifold.volume(),
        tri: currentManifold.numTri(),
        components: beforePieces.length,
      };
      for (const p of beforePieces) { try { p.delete?.(); } catch { /* ignore */ } }
      // Per manifold-3d's docs, simplify(tol) with tol less than the manifold's
      // stored tolerance falls back to the stored value — so 0 (the default
      // here) is the lightest-touch heal. Pass a positive value to collapse
      // edges aggressively. (The binding rejects no-arg .simplify().)
      const cleaned = currentManifold.simplify(opts?.tolerance ?? 0);
      const afterPieces = cleaned.decompose();
      const after = {
        volume: cleaned.volume(),
        tri: cleaned.numTri(),
        components: afterPieces.length,
      };
      for (const p of afterPieces) { try { p.delete?.(); } catch { /* ignore */ } }
      // Apply the healed manifold as the new current geometry, so the
      // viewport reflects the cleanup. The mesh extraction path mirrors
      // applyLiveGeometry's flow.
      const mesh = cleaned.getMesh();
      const meshData: MeshData = {
        vertProperties: mesh.vertProperties,
        triVerts: mesh.triVerts,
        numVert: mesh.numVert,
        numTri: mesh.numTri,
        numProp: mesh.numProp,
      };
      applyLiveGeometry(meshData);
      const status = typeof cleaned.status === 'function' ? cleaned.status() : 0;
      try { cleaned.delete?.(); } catch { /* applyLiveGeometry rebuilt currentManifold */ }
      return {
        ok: !status || status === 0 || status === 'NoError',
        volumeDelta: after.volume - before.volume,
        triangleDelta: after.tri - before.tri,
        componentCountBefore: before.components,
        componentCountAfter: after.components,
      };
    },

    // === Images API ===

    /** Attach images for side-by-side comparison in the Images and Gallery
     *  tabs. Each item is `{src, label?}`. `src` is a data URL or http(s) URL.
     *  `label` is an optional caption — common values like "Front", "Right", "Back",
     *  "Left", "Top", "Perspective" are presets that drive ordering in the image
     *  strip; any other string is also valid. Multiple items may share a label.
     *  Replaces all currently attached images. If a session is active, also persists
     *  to IndexedDB. Returns the canonical list with assigned ids. */
    setImages(images: Array<{ src: string; id?: string; label?: string }>): AttachedImage[] {
      const arr = assertArray(images, 'setImages(images)') as Array<Record<string, unknown>>;
      const items: AttachedImage[] = [];
      for (let i = 0; i < arr.length; i++) {
        const item = assertObject(arr[i], `setImages(images)[${i}]`)!;
        assertNoUnknownKeys(item, ['src', 'id', 'label'] as const, `setImages(images)[${i}]`);
        assertString(item.src, `setImages(images)[${i}].src`, { allowEmpty: false });
        if (item.id !== undefined) assertString(item.id, `setImages(images)[${i}].id`, { allowEmpty: false });
        if (item.label !== undefined) assertString(item.label, `setImages(images)[${i}].label`, { optional: true, allowEmpty: true });
        const built: AttachedImage = {
          id: (item.id as string | undefined) ?? generateId(),
          src: item.src as string,
        };
        const lbl = (item.label as string | undefined)?.trim();
        if (lbl) built.label = lbl;
        items.push(built);
      }
      _setImages(items);
      persistImages(items);
      return items;
    },

    /** Append a single image. Returns the appended item with its assigned id. */
    addImage(image: { src: string; label?: string }): AttachedImage {
      const obj = assertObject(image, 'addImage(image)')!;
      assertNoUnknownKeys(obj, ['src', 'label'] as const, 'addImage(image)');
      assertString(obj.src, 'addImage(image).src', { allowEmpty: false });
      if (obj.label !== undefined) assertString(obj.label, 'addImage(image).label', { optional: true, allowEmpty: true });
      const item: AttachedImage = { id: generateId(), src: obj.src as string };
      const lbl = (obj.label as string | undefined)?.trim();
      if (lbl) item.label = lbl;
      const next = [..._getImages(), item];
      _setImages(next);
      persistImages(next);
      return item;
    },

    /** Remove an image by id. Returns true if an image was removed. */
    removeImage(id: string): boolean {
      assertString(id, 'removeImage(id)', { allowEmpty: false });
      const current = _getImages();
      const next = current.filter(img => img.id !== id);
      if (next.length === current.length) return false;
      _setImages(next);
      persistImages(next);
      return true;
    },

    /** Clear all images */
    clearImages(): void {
      _clearImages();
      persistImages(null);
    },

    /** Get the currently attached images as an array of `{id, angle, src}`. */
    getImages(): AttachedImage[] {
      return _getImages();
    },

    // === Session API ===

    /** Create a new session and make it active */
    async createSession(name?: string) {
      assertString(name, 'createSession(name)', { optional: true });
      const session = await createSession(name, getActiveLanguage());
      await addSessionNote(
        '[WORKFLOW] Drive this app via window.partwright (see /ai.md). ' +
        'Use runAndSave(code, label, assertions) for iterations; ' +
        'after structural changes verify visually via renderViews (use views:"box" for an all-faces final check); ' +
        'addSessionNote with [REQUIREMENT]/[DECISION]/[MEASUREMENT]/[FEEDBACK]/[ATTEMPT]/[TODO] prefixes; ' +
        'getSessionContext() when resuming.',
      );
      return { id: session.id, url: getSessionUrl(), galleryUrl: getGalleryUrl() };
    },

    /** List all saved sessions */
    async listSessions() {
      const sessions = await listSessions();
      return sessions.map(s => ({ id: s.id, name: s.name, updated: s.updated }));
    },

    /** Open an existing session (loads latest version, restores attached images, restores language) */
    async openSession(id: string) {
      const check = guard(() => assertString(id, 'openSession(id)', { allowEmpty: false }));
      if (typeof check === 'object' && check !== null && 'error' in check) return check;
      const version = await openSession(id);
      if (version) {
        // Restore language from session
        const lang = getState().session?.language ?? 'manifold-js';
        if (lang !== getActiveLanguage()) {
          await switchLanguage(lang);
        }
        setValue(version.code);
        await runCodeSync(version.code);
      }
      // Restore images from session
      const sessionImages = await getImagesFromSession();
      if (sessionImages) {
        _setImages(sessionImages);
      } else {
        _clearImages();
      }
      return version ? { id: version.id, index: version.index, label: version.label } : null;
    },

    /** Close the current session */
    async closeSession() {
      await closeSession();
    },

    /** Delete a session and all its versions */
    async deleteSession(id: string) {
      assertString(id, 'deleteSession(id)', { allowEmpty: false });
      await deleteSession(id);
    },

    // === Part API ===
    // A session holds one or more parts; each part has its own code + version
    // history. The "current part" determines what every other method (run,
    // save, paint, export, …) acts on.

    /** List the parts in the active session, each flagged with `isCurrent`. */
    listParts() {
      const current = getCurrentPart();
      return listCurrentParts().map(p => ({ id: p.id, name: p.name, order: p.order, isCurrent: p.id === current?.id }));
    },

    /** The active part, or null when no session is open. */
    getCurrentPart() {
      const p = getCurrentPart();
      return p ? { id: p.id, name: p.name, order: p.order } : null;
    },

    /** Create a new, empty part and switch to it. Resets the editor to a starter
     *  snippet; call runAndSave/saveVersion to commit its first version. */
    async createPart(name?: string) {
      const check = guard(() => assertString(name, 'createPart(name)', { optional: true }));
      if (typeof check === 'object' && check !== null && 'error' in check) return check;
      if (!getState().session) {
        return { error: 'No active session. Call createSession() or openSession(id) first.' };
      }
      const part = await createPart(name);
      if (!part) return { error: 'Could not create part (no active session).' };
      startNewPartInEditor();
      return { id: part.id, name: part.name, order: part.order };
    },

    /** Switch the active part. Pass a part id string, or { id } / { name } from
     *  listParts(). Loads that part's latest version into the editor. */
    async changePart(target: string | { id?: string; name?: string }) {
      const part = resolvePartTarget(target, 'changePart');
      if ('error' in part) return part;
      const version = await changePart(part.id);
      await loadPartIntoEditor(version);
      return {
        id: part.id,
        name: part.name,
        currentVersion: version ? { id: version.id, index: version.index, label: version.label } : null,
      };
    },

    /** Rename a part. Pass a part id string, or { id } / { name }. */
    async renamePart(target: string | { id?: string; name?: string }, newName: string) {
      const check = guard(() => assertString(newName, 'renamePart(newName)', { allowEmpty: false }));
      if (typeof check === 'object' && check !== null && 'error' in check) return check;
      const part = resolvePartTarget(target, 'renamePart');
      if ('error' in part) return part;
      await renamePart(part.id, newName);
      return { id: part.id, name: newName };
    },

    /** Delete a part and its versions. Refuses to delete a session's last part.
     *  Deleting the active part activates and loads an adjacent one. */
    async deletePart(target: string | { id?: string; name?: string }) {
      const part = resolvePartTarget(target, 'deletePart');
      if ('error' in part) return part;
      const wasCurrent = getCurrentPart()?.id === part.id;
      const result = await deletePart(part.id);
      if (!result) return { error: 'Cannot delete the last part of a session.' };
      if (wasCurrent) {
        await loadPartIntoEditor(getState().currentVersion);
      }
      return {
        deleted: { id: result.deleted.id, name: result.deleted.name },
        newCurrent: result.newCurrent ? { id: result.newCurrent.id, name: result.newCurrent.name } : null,
      };
    },

    /** Save current state as a new version in the active session.
     *  Returns `{ id, index, label }` on success, `{ error }` if no session is
     *  active, or `{ skipped: true, reason }` when nothing has changed since
     *  the current version (code, annotations, and color regions all match). */
    async saveVersion(label?: string) {
      assertString(label, 'saveVersion(label)', { optional: true });
      return saveCurrentVersion(label);
    },

    /** List all versions in the current session */
    async listVersions() {
      const versions = await listCurrentVersions();
      return versions.map(v => ({
        id: v.id,
        index: v.index,
        label: v.label,
        timestamp: v.timestamp,
        status: (v.geometryData as Record<string, unknown> | null)?.status ?? null,
      }));
    },

    /** Load a version into the editor. Pass { index } or { id } from listVersions().
     *  Returns the loaded version's code and stats, or { error } if not found. */
    async loadVersion(target: { index?: number; id?: string }) {
      const parsed = parseVersionTarget(target, 'loadVersion');
      if ('error' in parsed) return parsed;
      if (!getState().session) {
        return { error: 'No active session. Call openSession(id) or createSession() first.' };
      }
      const version = await loadVersionFromStore(parsed.value);
      if (!version) {
        const kind = parsed.kind;
        return { error: `No version found with ${kind} "${parsed.value}" in the active session. Use listVersions() to see valid ${kind}s.` };
      }
      setValue(version.code);
      await runCodeSync(version.code);
      rehydrateColorRegions(version.geometryData);
      applyVersionAnnotations(version);
      // Labels are runtime state from the just-executed code. Surface
      // whether any were registered so callers can decide between
      // paintByLabel (when available) and paintComponent / paintInBox
      // (when not) without a follow-up listLabels() round-trip.
      const labelCount = currentLabelMap?.size ?? 0;
      return {
        id: version.id,
        index: version.index,
        label: version.label,
        code: version.code,
        geometryData: version.geometryData,
        labelsAvailable: labelCount > 0,
        labelCount,
      };
    },

    /** Navigate to previous or next version */
    async navigateVersion(direction: 'prev' | 'next') {
      const check = guard(() => assertEnum(direction, ['prev', 'next'] as const, 'navigateVersion(direction)'));
      if (typeof check === 'object' && check !== null && 'error' in check) return check;
      const version = await navigateVersion(direction);
      if (version) {
        setValue(version.code);
        await runCodeSync(version.code);
        rehydrateColorRegions(version.geometryData);
        applyVersionAnnotations(version);
      }
      return version ? { id: version.id, index: version.index, label: version.label } : null;
    },

    /** Run code and save as a new version in one call. Returns stat diff vs previous version.
     *  Optional assertions — if provided, validates after running. Saves only if assertions pass.
     *  The editor and viewport always update to reflect the new code (including on assertion failure),
     *  so the model can inspect the failing geometry. The version is NOT saved on failure. */
    async runAndSave(code: string, label?: string, assertions?: GeometryAssertions) {
      const check = guard(() => {
        assertString(code, 'runAndSave(code)', { allowEmpty: false });
        assertString(label, 'runAndSave(label)', { optional: true });
        if (assertions !== undefined) validateAssertionsShape(assertions, 'runAndSave(assertions)');
        return true;
      });
      if (typeof check === 'object' && check !== null && 'error' in check) return check;

      const prevGeoData = getState().currentVersion?.geometryData as Record<string, unknown> | null;

      // Single execution — run the code, update editor + viewport, read geometry.
      // Assertions are checked against the live result rather than a separate
      // isolation run. This halves execution time for assertion-guarded saves.
      setValue(code);
      const applied = await runCodeSync(code);
      if (!applied) {
        return { passed: false, failures: ['Run was superseded by a concurrent execution — retry'], geometry: null, version: null, diff: null, galleryUrl: getGalleryUrl() };
      }
      const newGeoData = JSON.parse(geometryDataEl.textContent || '{}');

      if (assertions) {
        if (newGeoData.status === 'error') {
          return { passed: false, failures: [newGeoData.error as string], geometry: newGeoData, version: null, diff: null, galleryUrl: getGalleryUrl() };
        }
        const failures = checkAssertions(newGeoData, assertions);
        if (failures.length > 0) {
          return { passed: false, failures, geometry: newGeoData, version: null, diff: null, galleryUrl: getGalleryUrl() };
        }
      }

      // Auto-create session if none exists (e.g. AI agent calling runAndSave without createSession)
      if (!getState().session) {
        const sessionName = label || `AI Session ${new Date().toLocaleDateString()}`;
        await createSession(sessionName, getActiveLanguage());
      }

      const thumbnail = await captureThumbnail();
      const version = await saveVersion(code, enrichGeometryDataWithColors(getGeometryDataObj()), thumbnail, label, assertions?.notes);

      let diff = null;
      if (prevGeoData && prevGeoData.status === 'ok' && newGeoData.status === 'ok') {
        diff = computeStatDiff(prevGeoData, newGeoData);
      }

      const warnings = geometryWarnings(newGeoData);
      return {
        ...(assertions ? { passed: true } : {}),
        geometry: newGeoData,
        version: version ? { id: version.id, index: version.index, label: version.label } : null,
        diff,
        galleryUrl: getGalleryUrl(),
        ...(warnings.length > 0 ? { warnings } : {}),
      };
    },

    /** Fork a prior version: load its code, apply transformFn, validate, and save as a new version.
     *  target: { index } or { id } from listVersions().
     *  transformFn: (code: string) => string — modifies the parent's code. Return the full new code.
     *  Eliminates the load + getCode + modify + save round-trip chain.
     *  Returns { error } if the parent isn't found or transformFn throws.
     *  Returns { passed, failures } without saving if assertions fail.
     *  On success: { passed?, parent, geometry, version, diff, galleryUrl }. */
    async forkVersion(
      target: { index?: number; id?: string },
      transformFn: (code: string) => string,
      label?: string,
      assertions?: GeometryAssertions,
      carryColors: boolean = true,
    ) {
      const parsed = parseVersionTarget(target, 'forkVersion');
      if ('error' in parsed) return parsed;
      if (typeof transformFn !== 'function') {
        return { error: 'forkVersion(target, transformFn): transformFn must be a function (code: string) => string. See /ai.md#argument-validation' };
      }
      const check = guard(() => {
        assertString(label, 'forkVersion(label)', { optional: true });
        if (assertions !== undefined) validateAssertionsShape(assertions, 'forkVersion(assertions)');
        return true;
      });
      if (typeof check === 'object' && check !== null && 'error' in check) return check;
      if (!getState().session) {
        return { error: 'No active session. Call openSession(id) or createSession() first.' };
      }

      const parent = await peekVersion(parsed.value);
      if (!parent) {
        return { error: `No version found with ${parsed.kind} "${parsed.value}" in the active session. Use listVersions() to see valid ${parsed.kind}s.` };
      }

      let newCode: string;
      try {
        newCode = transformFn(parent.code);
      } catch (e: unknown) {
        return { error: `transformFn threw: ${e instanceof Error ? e.message : String(e)}`, parent: { id: parent.id, index: parent.index, label: parent.label } };
      }
      if (typeof newCode !== 'string') {
        return { error: `transformFn must return a string; got ${typeof newCode}`, parent: { id: parent.id, index: parent.index, label: parent.label } };
      }

      // Validate in isolation before committing anything.
      const { geometryData: testData, manifold: testManifold } = await executeIsolated(newCode);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      try { (testManifold as any)?.delete?.(); } catch { /* ignore */ }
      if (testData.status === 'error') {
        return { passed: false, failures: [testData.error as string], geometry: testData, parent: { id: parent.id, index: parent.index, label: parent.label }, version: null, diff: null, galleryUrl: getGalleryUrl() };
      }
      if (assertions) {
        const failures = checkAssertions(testData, assertions);
        if (failures.length > 0) {
          return { passed: false, failures, geometry: testData, parent: { id: parent.id, index: parent.index, label: parent.label }, version: null, diff: null, galleryUrl: getGalleryUrl() };
        }
      }

      // Commit: update editor, run, (carry colors), save.
      const prevGeoData = getState().currentVersion?.geometryData as Record<string, unknown> | null;
      const parentColors = carryColors ? versionColorRegions(parent) : [];
      setValue(newCode);
      const forkApplied = await runCodeSync(newCode);
      if (!forkApplied) {
        return { error: 'Run was superseded by a concurrent execution — retry' };
      }
      const newGeoData = JSON.parse(geometryDataEl.textContent || '{}');

      // Re-apply the parent's color regions to the forked geometry before
      // snapshotting the thumbnail and saving, so a geometry tweak doesn't
      // force the agent to repaint. Descriptors are re-resolved against the
      // new mesh; non-matching regions drop out and are reported. When not
      // carrying, clear any stale in-memory regions so the fork is clean.
      let colorReport: { carried: string[]; dropped: string[] } = { carried: [], dropped: [] };
      if (parentColors.length > 0) {
        colorReport = rehydrateColorRegions({ colorRegions: parentColors });
      } else {
        clearRegions();
      }

      // Carry the PARENT's annotations onto the fork. saveVersion snapshots
      // the in-memory annotation store, which still holds the previously
      // active version's strokes — without this the fork would silently
      // inherit the wrong annotations (or drop them). Mirrors how
      // loadVersion swaps annotations to the version it loads.
      applyVersionAnnotations(parent);
      const annotationsCarried = (parent.annotations?.length ?? 0) > 0;

      const thumbnail = await captureThumbnail();
      const version = await saveVersion(newCode, enrichGeometryDataWithColors(getGeometryDataObj()), thumbnail, label, assertions?.notes);

      let diff = null;
      if (prevGeoData && prevGeoData.status === 'ok' && newGeoData.status === 'ok') {
        diff = computeStatDiff(prevGeoData, newGeoData);
      }

      const forkWarnings = geometryWarnings(newGeoData);
      return {
        ...(assertions ? { passed: true } : {}),
        parent: { id: parent.id, index: parent.index, label: parent.label },
        geometry: newGeoData,
        version: version ? { id: version.id, index: version.index, label: version.label } : null,
        diff,
        codeDiff: computeCodeDiff(parent.code, newCode),
        ...(parentColors.length > 0 ? { colors: colorReport } : {}),
        ...(annotationsCarried ? { annotationsCarried: parent.annotations?.length ?? 0 } : {}),
        galleryUrl: getGalleryUrl(),
        ...(forkWarnings.length > 0 ? { warnings: forkWarnings } : {}),
      };
    },

    /** Transfer the color regions from a prior version onto the CURRENT
     *  geometry by re-resolving each region's descriptor against the live
     *  mesh — instead of repainting region by region after a rebuild. Any
     *  colors currently on the model are replaced. Regions whose descriptor
     *  no longer resolves (a dropped label, raw-triangle regions on changed
     *  topology) are skipped and listed in `dropped`. In-memory like any
     *  paint op: call runAndSave / saveVersion to persist. Returns
     *  { source, carried, dropped } or { error }. */
    async copyColorsFromVersion(target: { index?: number; id?: string }) {
      const parsed = parseVersionTarget(target, 'copyColorsFromVersion');
      if ('error' in parsed) return parsed;
      if (!getState().session) {
        return { error: 'No active session. Call openSession(id) or createSession() first.' };
      }
      if (!currentMeshData) {
        return { error: 'No geometry loaded — run code first, then copy colors onto it.' };
      }
      const source = await peekVersion(parsed.value);
      if (!source) {
        return { error: `No version found with ${parsed.kind} "${parsed.value}" in the active session. Use listVersions() to see valid ${parsed.kind}s.` };
      }
      const regions = versionColorRegions(source);
      if (regions.length === 0) {
        return { error: `Version ${source.index} ("${source.label}") has no color regions to copy.` };
      }
      const report = rehydrateColorRegions({ colorRegions: regions });
      scheduleColorRefresh();
      syncLockState();
      return {
        source: { index: source.index, label: source.label },
        carried: report.carried,
        dropped: report.dropped,
        note: report.dropped.length > 0
          ? 'Some regions did not resolve on the current geometry and were skipped — repaint those, or check the labels/topology still match. The rest are in-memory; your next runAndSave will persist them.'
          : 'All regions transferred. They are in-memory like any paint op; your next runAndSave will persist them.',
      };
    },

    /** Get URL for the current session */
    getSessionUrl() {
      return getSessionUrl();
    },

    /** Get URL for the gallery view of the current session */
    getGalleryUrl() {
      return getGalleryUrl();
    },

    /** Get current session state */
    getSessionState() {
      const state = getState();
      return {
        session: state.session ? { id: state.session.id, name: state.session.name } : null,
        currentPart: state.currentPart ? { id: state.currentPart.id, name: state.currentPart.name } : null,
        parts: state.parts.map(p => ({ id: p.id, name: p.name, order: p.order, isCurrent: p.id === state.currentPart?.id })),
        currentVersion: state.currentVersion ? { index: state.currentVersion.index, label: state.currentVersion.label } : null,
        versionCount: state.versionCount,
      };
    },

    /** Add a standalone note to the current session (requirements, feedback, decisions) */
    async addSessionNote(text: string) {
      const check = guard(() => assertString(text, 'addSessionNote(text)', { allowEmpty: false }));
      if (typeof check === 'object' && check !== null && 'error' in check) return check;
      const note = await addSessionNote(text);
      if (!note) return { error: 'No active session' };
      return { id: note.id, text: note.text, timestamp: note.timestamp };
    },

    /** List all notes in the current session */
    async listSessionNotes() {
      const notes = await listSessionNotes();
      return notes.map(n => ({ id: n.id, text: n.text, timestamp: n.timestamp }));
    },

    /** Delete a session note by ID */
    async deleteSessionNote(noteId: string) {
      const check = guard(() => assertString(noteId, 'deleteSessionNote(noteId)', { allowEmpty: false }));
      if (typeof check === 'object' && check !== null && 'error' in check) return check;
      await deleteSessionNote(noteId);
      return { success: true };
    },

    /** Update a session note's text by ID */
    async updateSessionNote(noteId: string, text: string) {
      const check = guard(() => {
        assertString(noteId, 'updateSessionNote(noteId)', { allowEmpty: false });
        assertString(text, 'updateSessionNote(text)', { allowEmpty: false });
        return true;
      });
      if (typeof check === 'object' && check !== null && 'error' in check) return check;
      await updateSessionNote(noteId, text);
      return { success: true };
    },

    /** Get full session context — everything an AI agent needs to understand this session */
    async getSessionContext() {
      const ctx = await getSessionContext();
      if (!ctx) return { error: 'No active session' };
      const geo = JSON.parse(geometryDataEl.textContent || '{}');
      const warnings = geometryWarnings(geo);
      return {
        ...ctx,
        currentCode: getValue(),
        ...(warnings.length > 0 ? { geometryWarnings: warnings } : {}),
      };
    },

    /** Export a session as JSON (defaults to current session) */
    async exportSession(sessionId?: string, options?: ExportOptions) {
      assertString(sessionId, 'exportSession(sessionId)', { optional: true });
      if (options !== undefined) {
        const o = assertObject(options, 'exportSession(options)')!;
        assertNoUnknownKeys(o, ['includeThumbnails', 'includeAnnotations', 'includeNotes', 'includeColorRegions'], 'exportSession(options)');
        for (const k of ['includeThumbnails', 'includeAnnotations', 'includeNotes', 'includeColorRegions'] as const) {
          assertBoolean(o[k], `exportSession(options).${k}`, { optional: true });
        }
      }
      return exportSession(sessionId, options);
    },

    /** Import a session from JSON data, regenerating thumbnails */
    async importSession(data: ExportedSession) {
      const check = guard(() => {
        const d = assertObject(data, 'importSession(data)')!;
        const brandVersion = d.partwright ?? d.mainifold;
        assertString(brandVersion, 'importSession(data).partwright', { allowEmpty: false });
        const s = assertObject(d.session, 'importSession(data).session')!;
        assertString(s.name, 'importSession(data).session.name', { allowEmpty: true });
        assertNumber(s.created, 'importSession(data).session.created');
        assertNumber(s.updated, 'importSession(data).session.updated');
        // `versions` is optional — chat- or notes-only exports omit it.
        // sessionManager.importSession rejects payloads where versions,
        // chat, and notes are ALL empty, so we don't need to re-check
        // that here.
        if (d.versions !== undefined) {
          const versions = assertArray(d.versions, 'importSession(data).versions');
          for (let i = 0; i < versions.length; i++) {
            const v = assertObject(versions[i], `importSession(data).versions[${i}]`)!;
            assertNumber(v.index, `importSession(data).versions[${i}].index`, { integer: true });
            assertString(v.code, `importSession(data).versions[${i}].code`, { allowEmpty: true });
            assertString(v.label, `importSession(data).versions[${i}].label`, { allowEmpty: true });
            assertNumber(v.timestamp, `importSession(data).versions[${i}].timestamp`);
            if (v.notes !== undefined) assertString(v.notes, `importSession(data).versions[${i}].notes`, { allowEmpty: true });
            // geometryData may be null or an object; don't over-specify shape (historical data varies)
            if (v.geometryData !== null && v.geometryData !== undefined) {
              assertObject(v.geometryData, `importSession(data).versions[${i}].geometryData`);
            }
          }
        }
        if (d.notes !== undefined) {
          const notes = assertArray(d.notes, 'importSession(data).notes');
          for (let i = 0; i < notes.length; i++) {
            const n = assertObject(notes[i], `importSession(data).notes[${i}]`)!;
            assertString(n.text, `importSession(data).notes[${i}].text`, { allowEmpty: true });
            assertNumber(n.timestamp, `importSession(data).notes[${i}].timestamp`);
          }
        }
        return true;
      });
      if (typeof check === 'object' && check !== null && 'error' in check) return check;
      let warning: string | null = null;
      const session = await importSession(
        data,
        async (code: string) => {
          await runCodeSync(code);
          return captureThumbnail();
        },
        (msg) => { warning = msg; },
      );
      const version = await openSession(session.id);
      if (version) {
        setValue(version.code);
        await runCodeSync(version.code);
      }
      // Restore images from imported session
      const sessionImages = await getImagesFromSession();
      if (sessionImages) {
        _setImages(sessionImages);
      }
      return { id: session.id, name: session.name, ...(warning ? { warning } : {}) };
    },

    /** Clear all sessions and versions from IndexedDB */
    async clearAllSessions() {
      await clearAllSessions();
    },

    // === Isolated execution & assertions ===

    /** Check if geometry code is currently executing */
    isRunning(): boolean {
      return _running;
    },

    /** Run code without mutating editor, viewport, or session state.
     *  Returns geometry stats + thumbnail. By default the thumbnail is
     *  the standard 4-iso composite; pass `view` to render a single
     *  named angle instead — useful when the feature you're verifying
     *  (a smile on a face, a logo on a flat panel) only reads from one
     *  specific direction. Same shape `renderView` accepts, including
     *  `edges` ('none' | 'crease' | 'wireframe'). */
    async runIsolated(code: string, view?: { elevation?: number; azimuth?: number; ortho?: boolean; size?: number; edges?: EdgeMode }) {
      const check = guard(() => {
        assertString(code, 'runIsolated(code)', { allowEmpty: false });
        if (view !== undefined) {
          const v = assertObject(view, 'runIsolated(code, view)')!;
          assertNoUnknownKeys(v, ['elevation', 'azimuth', 'ortho', 'size', 'edges'], 'runIsolated(code, view)');
          assertNumber(v.elevation, 'runIsolated(code, view).elevation', { optional: true, min: -90, max: 90 });
          assertNumber(v.azimuth, 'runIsolated(code, view).azimuth', { optional: true });
          assertBoolean(v.ortho, 'runIsolated(code, view).ortho', { optional: true });
          assertNumber(v.size, 'runIsolated(code, view).size', { optional: true, min: 1, integer: true });
          if (v.edges !== undefined) assertEnum(v.edges, EDGE_MODES, 'runIsolated(code, view).edges');
        }
        return true;
      });
      if (typeof check === 'object' && check !== null && 'error' in check) {
        return { geometryData: { status: 'error', error: check.error }, thumbnail: null };
      }
      const { geometryData, meshData, manifold } = await executeIsolated(code);

      let thumbnail: string | null = null;
      if (meshData) {
        try {
          if (view) {
            thumbnail = renderSingleView(meshData, view);
          } else {
            const canvas = renderCompositeCanvas(meshData);
            thumbnail = canvas.toDataURL('image/png');
          }
        } catch { /* ignore */ }
      }

      // Clean up manifold to prevent memory leaks
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      try { (manifold as any)?.delete?.(); } catch { /* ignore */ }

      return { geometryData, thumbnail };
    },

    /** Run code and check geometry against assertions. Does not mutate global state. */
    async runAndAssert(code: string, assertions: GeometryAssertions) {
      const check = guard(() => {
        assertString(code, 'runAndAssert(code)', { allowEmpty: false });
        validateAssertionsShape(assertions, 'runAndAssert(assertions)');
        return true;
      });
      if (typeof check === 'object' && check !== null && 'error' in check) {
        return { passed: false, failures: [check.error], stats: null };
      }
      const { geometryData, manifold } = await executeIsolated(code);

      // Clean up manifold
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      try { (manifold as any)?.delete?.(); } catch { /* ignore */ }

      if (geometryData.status === 'error') {
        return { passed: false, failures: [geometryData.error as string], stats: geometryData };
      }

      const failures = checkAssertions(geometryData, assertions);
      return {
        passed: failures.length === 0,
        failures: failures.length > 0 ? failures : undefined,
        stats: geometryData,
      };
    },

    /** Run code and decompose result into individual components for debugging. Does not mutate global state. */
    async runAndExplain(code: string) {
      const check = guard(() => assertString(code, 'runAndExplain(code)', { allowEmpty: false }));
      if (typeof check === 'object' && check !== null && 'error' in check) {
        return { stats: { status: 'error', error: check.error }, components: null };
      }
      const { geometryData, manifold } = await executeIsolated(code);

      if (geometryData.status === 'error' || !manifold) {
        return { stats: geometryData, components: null };
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const m = manifold as any;
      let components: { index: number; volume: number; surfaceArea: number; centroid: number[]; boundingBox: { min: number[]; max: number[] } }[] | null = null;

      try {
        const parts = m.decompose();
        if (parts.length > 1) {
          components = parts.map((p: any, i: number) => {
            const bb = getBoundingBox(p);
            const vol = (() => { try { return p.volume(); } catch { return 0; } })();
            const sa = (() => { try { return p.surfaceArea(); } catch { return 0; } })();
            const centroid = bb
              ? [(bb.min[0] + bb.max[0]) / 2, (bb.min[1] + bb.max[1]) / 2, (bb.min[2] + bb.max[2]) / 2]
              : [0, 0, 0];
            p.delete();
            return { index: i, volume: Math.round(vol * 100) / 100, surfaceArea: Math.round(sa * 100) / 100, centroid: centroid.map((c: number) => Math.round(c * 10) / 10), boundingBox: bb ?? { min: [0, 0, 0], max: [0, 0, 0] } };
          });
        } else {
          for (const p of parts) p.delete();
        }
      } catch { /* ignore */ }

      // Containment/occlusion check (before cleanup — needs manifold alive)
      let containmentWarnings: ContainmentWarning[] = [];
      try { containmentWarnings = checkContainment(m); } catch { /* ignore */ }

      // Clean up
      try { m.delete?.(); } catch { /* ignore */ }

      // Generate hints
      const hints: string[] = [];
      if (components && components.length > 1) {
        const sorted = [...components].sort((a, b) => b.volume - a.volume);
        const mainBody = sorted[0];
        const mainVol = mainBody.volume;
        const floaters = sorted.filter(c => c.volume < mainVol * 0.01);
        const mediumParts = sorted.filter(c => c.volume >= mainVol * 0.01 && c !== mainBody);

        // Identify main body
        hints.push(`Main body: component ${mainBody.index} (volume: ${mainBody.volume}, centroid: [${mainBody.centroid}])`);

        if (floaters.length > 0) {
          hints.push(`${floaters.length} tiny disconnected component(s) detected — likely floating attachments that failed to union:`);
          for (const f of floaters) {
            // Suggest fix: find which face of main body is closest to the floater
            const fc = f.centroid;
            const mb = mainBody.boundingBox;
            const axes = ['X', 'Y', 'Z'];
            let closestAxis = '';
            let closestDist = Infinity;
            let closestDir = '';
            for (let ax = 0; ax < 3; ax++) {
              const distToMin = Math.abs(fc[ax] - mb.min[ax]);
              const distToMax = Math.abs(fc[ax] - mb.max[ax]);
              if (distToMin < closestDist) { closestDist = distToMin; closestAxis = axes[ax]; closestDir = 'min'; }
              if (distToMax < closestDist) { closestDist = distToMax; closestAxis = axes[ax]; closestDir = 'max'; }
            }
            const suggestion = closestDist <= 1.0
              ? ` — sits on ${closestDir} ${closestAxis}-face of main body. Try .translate() to overlap by 0.5 units along ${closestAxis}.`
              : ` — ${closestDist.toFixed(1)} units from main body. May need repositioning.`;
            hints.push(`  Component ${f.index}: volume ${f.volume}, centroid [${f.centroid}]${suggestion}`);
          }
        }
        if (mediumParts.length > 0) {
          hints.push(`${mediumParts.length + 1} components of similar size — major geometry sections are not connected`);
        }

        // Check for near-touching bounding boxes (flush placement)
        const TOUCH_TOL = 1.0;
        for (let i = 0; i < components.length; i++) {
          for (let j = i + 1; j < components.length; j++) {
            const a = components[i].boundingBox;
            const b = components[j].boundingBox;
            // Check if bounding boxes are within tolerance on any axis
            // (close enough to suggest they were meant to be joined)
            const gaps = [0, 1, 2].map(ax => {
              const gap = Math.max(a.min[ax] - b.max[ax], b.min[ax] - a.max[ax]);
              return gap; // negative = overlapping, 0 = flush, positive = gap
            });
            const minGap = Math.min(...gaps);
            const maxGap = Math.max(...gaps);
            // If boxes overlap on 2 axes and are flush/near-flush on the third
            if (minGap <= 0 && maxGap >= -0.01 && maxGap <= TOUCH_TOL) {
              hints.push(`Components ${i} and ${j} share a face or near-touch (gap: ${maxGap.toFixed(2)}) — they likely need volumetric overlap (offset by 0.5+ units) to union correctly`);
            }
          }
        }
      }

      // Add containment warnings to hints
      if (containmentWarnings.length > 0) {
        hints.push(`WARNING: ${containmentWarnings.length} contained component(s) detected (geometrically invisible):`);
        for (const w of containmentWarnings) {
          hints.push(`  ${w.message}`);
        }
      }

      return { stats: geometryData, components, hints: hints.length > 0 ? hints : undefined, containmentWarnings: containmentWarnings.length > 0 ? containmentWarnings : undefined };
    },

    /** Modify current editor code with a transform function and test the result without committing.
     *  The patchFn receives the current code string and returns modified code.
     *  Runs in isolation — no side effects on editor/viewport/session. */
    async modifyAndTest(patchFn: (code: string) => string, assertions?: GeometryAssertions) {
      const check = guard(() => {
        assertFunction(patchFn, 'modifyAndTest(patchFn)');
        if (assertions !== undefined) validateAssertionsShape(assertions, 'modifyAndTest(assertions)');
        return true;
      });
      if (typeof check === 'object' && check !== null && 'error' in check) {
        return { error: check.error, stats: null };
      }
      const currentCode = getValue();
      let modifiedCode: string;
      try {
        modifiedCode = patchFn(currentCode);
      } catch (e: unknown) {
        return { error: `Patch function failed: ${e instanceof Error ? e.message : String(e)}`, stats: null };
      }

      // Surface what the patch actually changed. A transform that matched
      // nothing returns the code unchanged (codeDiff.changed === false) —
      // the cheapest way to catch a no-op tweak before reading stats that
      // look identical for the wrong reason.
      const codeDiff = computeCodeDiff(currentCode, modifiedCode);

      const { geometryData, manifold } = await executeIsolated(modifiedCode);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      try { (manifold as any)?.delete?.(); } catch { /* ignore */ }

      if (geometryData.status === 'error') {
        return { error: geometryData.error, modifiedCode, codeDiff, stats: geometryData, ...(assertions ? { passed: false, failures: [geometryData.error as string] } : {}) };
      }

      if (assertions) {
        const failures = checkAssertions(geometryData, assertions);
        return { modifiedCode, codeDiff, stats: geometryData, passed: failures.length === 0, failures: failures.length > 0 ? failures : undefined };
      }

      return { modifiedCode, codeDiff, stats: geometryData };
    },

    /** Query multiple properties of the current geometry in a single call. Avoids multiple round-trips. */
    query(opts: { sliceAt?: number[]; decompose?: boolean; boundingBox?: boolean }) {
      const check = guard(() => {
        const o = assertObject(opts, 'query(opts)')!;
        assertNoUnknownKeys(o, ['sliceAt', 'decompose', 'boundingBox'], 'query(opts)');
        if (o.sliceAt !== undefined) {
          const arr = assertArray(o.sliceAt, 'query(opts).sliceAt');
          for (let i = 0; i < arr.length; i++) {
            assertNumber(arr[i], `query(opts).sliceAt[${i}]`);
          }
        }
        assertBoolean(o.decompose, 'query(opts).decompose', { optional: true });
        assertBoolean(o.boundingBox, 'query(opts).boundingBox', { optional: true });
        return true;
      });
      if (typeof check === 'object' && check !== null && 'error' in check) return check;

      const result: Record<string, unknown> = {};

      if (!currentManifold) {
        return { error: 'No geometry loaded' };
      }

      if (opts.boundingBox) {
        result.boundingBox = getBoundingBox(currentManifold);
      }

      if (opts.sliceAt && opts.sliceAt.length > 0) {
        const slices: Record<string, unknown> = {};
        for (const z of opts.sliceAt) {
          const s = sliceAtZ(currentManifold, z);
          slices[`z${z}`] = s ?? { error: `No cross-section at z=${z}` };
        }
        result.slices = slices;
      }

      if (opts.decompose) {
        try {
          const parts = currentManifold.decompose();
          result.components = parts.map((p: any, i: number) => {
            const bb = getBoundingBox(p);
            const vol = (() => { try { return p.volume(); } catch { return 0; } })();
            const sa = (() => { try { return p.surfaceArea(); } catch { return 0; } })();
            const centroid = bb
              ? [(bb.min[0] + bb.max[0]) / 2, (bb.min[1] + bb.max[1]) / 2, (bb.min[2] + bb.max[2]) / 2]
              : [0, 0, 0];
            p.delete();
            return { index: i, volume: Math.round(vol * 100) / 100, surfaceArea: Math.round(sa * 100) / 100, centroid, boundingBox: bb ?? { min: [0, 0, 0], max: [0, 0, 0] } };
          });
        } catch { /* ignore */ }
      }

      // Include current stats for convenience
      result.stats = JSON.parse(geometryDataEl.textContent || '{}');

      return result;
    },

    /** Create a session and populate it with multiple versions in one call */
    async createSessionWithVersions(name: string, versions: { code: string; label?: string }[]) {
      const check = guard(() => {
        assertString(name, 'createSessionWithVersions(name)', { allowEmpty: false });
        const arr = assertArray(versions, 'createSessionWithVersions(versions)');
        if (arr.length === 0) {
          throw new ValidationError('createSessionWithVersions(versions): must contain at least one version. See /ai.md#argument-validation');
        }
        for (let i = 0; i < arr.length; i++) {
          const v = assertObject(arr[i], `createSessionWithVersions(versions[${i}])`)!;
          assertNoUnknownKeys(v, ['code', 'label'], `createSessionWithVersions(versions[${i}])`);
          assertString(v.code, `createSessionWithVersions(versions[${i}].code)`, { allowEmpty: false });
          assertString(v.label, `createSessionWithVersions(versions[${i}].label)`, { optional: true });
        }
        return true;
      });
      if (typeof check === 'object' && check !== null && 'error' in check) return check;
      const session = await createSession(name, getActiveLanguage());
      const results = [];

      for (const v of versions) {
        setValue(v.code);
        const vApplied = await runCodeSync(v.code);
        if (!vApplied) {
          results.push({ version: null, geometry: null, error: 'Run superseded — version skipped' });
          continue;
        }
        const thumbnail = await captureThumbnail();
        const geoData = getGeometryDataObj();
        const version = await saveVersion(v.code, geoData, thumbnail, v.label);
        results.push({
          version: version ? { id: version.id, index: version.index, label: version.label } : null,
          geometry: geoData,
        });
      }

      return {
        session: { id: session.id, name: session.name },
        versions: results,
        galleryUrl: getGalleryUrl(),
      };
    },

    // === Phase 1: Geometry Intelligence ===

    /** Analyze Z-profile of current geometry — returns features at each height with radii, areas, positions */
    analyzeProfile(sampleCount?: number): ZProfile | null {
      assertNumber(sampleCount, 'analyzeProfile(sampleCount)', { optional: true, min: 1, integer: true });
      if (!currentManifold) return null;
      const bbox = getBoundingBox(currentManifold);
      if (!bbox) return null;
      return analyzeZProfile(currentManifold, bbox, sampleCount);
    },

    /** Analyze Z-profile of code in isolation — no side effects */
    async analyzeProfileIsolated(code: string, sampleCount?: number): Promise<{ profile: ZProfile | null; stats: Record<string, unknown> }> {
      assertString(code, 'analyzeProfileIsolated(code)', { allowEmpty: false });
      assertNumber(sampleCount, 'analyzeProfileIsolated(sampleCount)', { optional: true, min: 1, integer: true });
      const { geometryData, manifold } = await executeIsolated(code);
      if (geometryData.status === 'error' || !manifold) {
        return { profile: null, stats: geometryData };
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const m = manifold as any;
      const bbox = getBoundingBox(m);
      const profile = bbox ? analyzeZProfile(m, bbox, sampleCount) : null;
      try { m.delete?.(); } catch { /* ignore */ }
      return { profile, stats: geometryData };
    },

    /** Probe geometry at an XY coordinate — shoots ray down Z axis, returns all hit Z values */
    measureAt(xy: [number, number]): ProbeResult | null {
      assertNumberTuple(xy, 2, 'measureAt(xy)');
      if (!currentMeshData) return null;
      return probeAtXY(currentMeshData, xy[0], xy[1]);
    },

    /** Euclidean distance between two 3D points */
    measureBetween(p1: [number, number, number], p2: [number, number, number]): number {
      assertNumberTuple(p1, 3, 'measureBetween(p1)');
      assertNumberTuple(p2, 3, 'measureBetween(p2)');
      return measureDistance(p1, p2);
    },

    /** General ray query — cast from origin in direction, return all hits */
    probeRay(origin: [number, number, number], direction: [number, number, number]): GeneralRayResult | null {
      assertNumberTuple(origin, 3, 'probeRay(origin)');
      assertNumberTuple(direction, 3, 'probeRay(direction)');
      if (!currentMeshData) return null;
      return probeRay(currentMeshData, origin, direction);
    },

    /** Click in your perception. Translates a pixel in a rendered image
     *  back to a world-space hit on the mesh — exact surface point,
     *  face normal, and triangle id of the front-most hit (occlusion-
     *  correct by construction). The `view` argument must be the SAME
     *  shape `renderView` accepted for the image you're probing; the
     *  camera is rebuilt deterministically so screen coordinates round-
     *  trip without drift. Returns `null` when the pixel is background.
     *
     *  Pixel convention matches the rendered PNG: `(0, 0)` is top-left,
     *  `(size - 1, size - 1)` is bottom-right.
     *
     *  ```
     *  // renderView returned a 320×320 image; you identified the fingertip
     *  // around pixel (180, 220) by eye:
     *  const hit = partwright.probePixel({
     *    pixel: [180, 220],
     *    view:  { elevation: 0, azimuth: 0, ortho: true, size: 320 },
     *  });
     *  // On a miss, `hit.hint` reports the model's pixel bounds so you can
     *  // re-aim; on a hit, `hit.point`/`hit.normal` carry the surface seed.
     *  if ('point' in hit) partwright.paintNear({ point: hit.point, radius: 4, color: [...] });
     *  ``` */
    probePixel(opts: {
      pixel: [number, number];
      view: { elevation?: number; azimuth?: number; ortho?: boolean; size?: number };
    }): (PixelHit & { nextStep: string }) | (PixelMiss & { reason: string; hint: string }) | { error: string } | null {
      if (!opts || typeof opts !== 'object') return { error: 'probePixel requires { pixel, view }' };
      if (!Array.isArray(opts.pixel) || opts.pixel.length !== 2) return { error: 'probePixel.pixel must be [x, y]' };
      for (const c of opts.pixel) {
        if (typeof c !== 'number' || !Number.isFinite(c)) return { error: 'probePixel.pixel components must be finite numbers' };
      }
      if (!opts.view || typeof opts.view !== 'object') return { error: 'probePixel.view must match the renderView options used to produce the image' };
      const v = opts.view as { elevation?: unknown; azimuth?: unknown; ortho?: unknown; size?: unknown };
      assertNoUnknownKeys(v, ['elevation', 'azimuth', 'ortho', 'size'], 'probePixel(opts).view');
      assertNumber(v.elevation, 'probePixel(opts).view.elevation', { optional: true, min: -90, max: 90 });
      assertNumber(v.azimuth, 'probePixel(opts).view.azimuth', { optional: true });
      assertBoolean(v.ortho, 'probePixel(opts).view.ortho', { optional: true });
      assertNumber(v.size, 'probePixel(opts).view.size', { optional: true, min: 1, integer: true });
      if (!currentMeshData) return null;
      const size = (v.size as number | undefined) ?? 500;
      const [px, py] = opts.pixel;
      if (px < 0 || px >= size || py < 0 || py >= size) {
        return { error: `probePixel.pixel [${px}, ${py}] is outside the ${size}×${size} viewport. Pixel (0,0) is top-left, (${size - 1},${size - 1}) is bottom-right.` };
      }
      const camera = buildViewCamera(currentMeshData, opts.view);
      const result = probePixel(currentMeshData, camera, [px, py], size);
      if ('hit' in result) {
        // Miss: instead of a bare null, tell the caller where the model
        // actually projects so they can re-aim. Pixel estimation off a
        // render carries ±10-20px error, so misses are an expected, common
        // case — make them self-correcting rather than a dead end.
        const b = result.modelPixelBounds;
        const hint = b
          ? `In this ${size}×${size} view the model occupies pixels x[${b.minX}..${b.maxX}], y[${b.minY}..${b.maxY}] (top-left is [0,0]). Re-aim inside that box and probe again.`
          : 'The model does not project into this view (off-screen or degenerate). Render this exact view first to see where it sits, or try a different elevation/azimuth.';
        return { ...result, reason: `Pixel [${px}, ${py}] missed the mesh (background).`, hint };
      }
      return {
        ...result,
        nextStep: 'To paint here, pass this point+normal to paintConnected({seed:{point,normal},color}) (follows the surface by normal) or paintNear({point,radius,normalCone:{axis:normal,angleDeg:35},color}) (bounded blob).',
      };
    },

    /** Paint a connected patch starting from a seed point on the
     *  surface, expanding through adjacent triangles only as far as the
     *  surface stays within `maxDeviationDeg` of the seed's normal.
     *
     *  Unlike `paintRegion` (which compares each adjacent pair, so on a
     *  smooth surface the threshold is bimodal — all or nothing),
     *  `paintConnected` compares every candidate triangle against the
     *  SEED's normal directly. That means picking a seed on a hand and
     *  flooding with 30° tolerance gives you the hand's surface that
     *  faces roughly the same way, no matter how curved the connecting
     *  geometry is.
     *
     *  Best when paired with `probePixel`: probe a pixel in a rendered
     *  view, take the returned `point` + `normal`, hand them to
     *  `paintConnected`. The patch follows real mesh topology rather
     *  than a coordinate box, so it doesn't bleed across feature
     *  boundaries (a robe collar stops where the skin starts).
     *
     *  ```
     *  partwright.paintConnected({
     *    seed: { point: hit.point, normal: hit.normal },
     *    maxDeviationDeg: 30,
     *    color: [0.4, 0.7, 0.4],
     *    name: 'skin patch',
     *  })
     *  ``` */
    paintConnected(opts: {
      seed: { point: [number, number, number]; normal?: [number, number, number] };
      maxDeviationDeg?: number;
      color: [number, number, number];
      name?: string;
    }) {
      if (!opts || typeof opts !== 'object') return { error: 'paintConnected requires { seed: {point, normal?}, color }' };
      if (!opts.seed || typeof opts.seed !== 'object') return { error: 'paintConnected.seed must be { point: [x,y,z], normal?: [nx,ny,nz] }' };
      if (!Array.isArray(opts.seed.point) || opts.seed.point.length !== 3) return { error: 'paintConnected.seed.point must be [x,y,z]' };
      for (const c of opts.seed.point) {
        if (typeof c !== 'number' || !Number.isFinite(c)) return { error: 'paintConnected.seed.point components must be finite numbers' };
      }
      if (opts.seed.normal !== undefined) {
        if (!Array.isArray(opts.seed.normal) || opts.seed.normal.length !== 3) return { error: 'paintConnected.seed.normal must be [nx,ny,nz] when provided' };
        for (const c of opts.seed.normal) {
          if (typeof c !== 'number' || !Number.isFinite(c)) return { error: 'paintConnected.seed.normal components must be finite numbers' };
        }
      }
      const maxDev = opts.maxDeviationDeg ?? 30;
      if (typeof maxDev !== 'number' || !Number.isFinite(maxDev) || maxDev < 0 || maxDev > 180) {
        return { error: 'paintConnected.maxDeviationDeg must be a finite number in [0, 180]' };
      }
      if (!Array.isArray(opts.color) || opts.color.length !== 3) return { error: 'paintConnected.color must be [r,g,b] in 0..1' };
      if (!currentMeshData) return { error: 'No geometry loaded' };

      const mesh = currentMeshData;
      const adjacency = buildAdjacency(mesh);
      const nearest = findNearestTriangle(opts.seed.point, mesh, adjacency);
      if (nearest.triIndex < 0) return { error: 'paintConnected: mesh has no triangles' };

      // Use the supplied normal if provided, else derive from the nearest
      // triangle — same convention paintRegion uses.
      const seedNormal: [number, number, number] = opts.seed.normal ?? nearest.normal;
      // Persist the seed point we used (snapped to the surface) so
      // rehydration finds the same triangle on re-load.
      const seedPoint: [number, number, number] = nearest.closest;
      const cos = Math.cos(maxDev * Math.PI / 180);
      const triangles = findConnectedFromSeed(nearest.triIndex, adjacency, cos);
      if (triangles.size === 0) return { error: `paintConnected: seed triangle ${nearest.triIndex} has no neighbors meeting the deviation threshold` };

      const regionName = opts.name ?? `Region ${getRegions().length + 1}`;
      const region = addRegion(
        regionName,
        opts.color as [number, number, number],
        'paintbrush',
        { kind: 'connectedFromSeed', seedPoint, seedNormal, maxDeviationDeg: maxDev },
        triangles,
      );
      const colored = applyTriColorsIfVisible(mesh);
      updateMesh(colored, { skipAutoFrame: true });
      syncLockState();
      const stats = regionTriangleStats(triangles, mesh);
      return { id: region.id, name: region.name, triangles: triangles.size, bbox: stats.bbox, centroid: stats.centroid, seedTriangle: nearest.triIndex };
    },

    /** Check if any component is fully contained inside another (invisible geometry) */
    checkContainment(): ContainmentWarning[] | null {
      if (!currentManifold) return null;
      return checkContainment(currentManifold);
    },

    // === Phase 2: View State & Session Rename ===

    /** Get current view state — active tab, camera angle, zoom */
    getViewState(): { tab: string; camera: { azimuth: number; elevation: number; distance: number; target: [number, number, number] } } {
      return { tab: getTabFromURL(), camera: getCameraState() };
    },

    /** Programmatic tab switching */
    setView(tab: 'interactive' | 'gallery' | 'versions' | 'images' | 'diff' | 'notes' | 'data'): void {
      assertEnum(tab, ['interactive', 'gallery', 'versions', 'images', 'diff', 'notes', 'data'] as const, 'setView(tab)');
      switchTab(tab);
    },

    /** Rename a session */
    async renameSession(newName: string, id?: string): Promise<void> {
      assertString(newName, 'renameSession(newName)', { allowEmpty: false });
      assertString(id, 'renameSession(id)', { optional: true, allowEmpty: false });
      const targetId = id ?? getState().session?.id;
      if (!targetId) throw new Error('No active session and no id provided');
      await renameSession(targetId, newName);
    },

    // === Phase 3: Reference/Phantom Geometry ===

    /** Set translucent reference geometry for fitment checking. Code is executed in isolation (always manifold-js). */
    setReferenceGeometry(code: string, options?: PhantomOptions): { success: boolean; error?: string; boundingBox?: unknown; volume?: number } {
      const check = guard(() => {
        assertString(code, 'setReferenceGeometry(code)', { allowEmpty: false });
        if (options !== undefined) {
          const opts = assertObject(options, 'setReferenceGeometry(code, options)')!;
          assertNoUnknownKeys(opts, ['color', 'opacity', 'wireframe'], 'setReferenceGeometry(options)');
          assertNumber(opts.color, 'setReferenceGeometry(options).color', { optional: true, min: 0, max: 0xffffff, integer: true });
          assertNumber(opts.opacity, 'setReferenceGeometry(options).opacity', { optional: true, min: 0, max: 1 });
          assertBoolean(opts.wireframe, 'setReferenceGeometry(options).wireframe', { optional: true });
        }
        return true;
      });
      if (typeof check === 'object' && check !== null && 'error' in check) {
        return { success: false, error: check.error };
      }
      const result = executeCode(code, 'manifold-js');
      if (result.error) {
        return { success: false, error: result.error };
      }
      if (!result.mesh) {
        return { success: false, error: 'Code did not produce geometry' };
      }

      setPhantom(result.mesh, options);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const m = result.manifold as any;
      let volume = 0;
      let bb = null;
      try { volume = m.volume(); } catch { /* ignore */ }
      try { bb = getBoundingBox(m); } catch { /* ignore */ }
      try { m.delete?.(); } catch { /* ignore */ }

      return { success: true, boundingBox: bb, volume };
    },

    /** Clear phantom/reference geometry overlay */
    clearReferenceGeometry(): void {
      clearPhantom();
    },

    /** Check if phantom/reference geometry is currently displayed */
    hasReferenceGeometry(): boolean {
      return hasPhantom();
    },

    // === Phase 4: Units & Scale ===

    /** Declare the unit system (metadata only — no coordinate transformation) */
    setUnits(unit: UnitSystem): void {
      assertEnum(unit, ['mm', 'cm', 'in', 'unitless'] as const, 'setUnits(unit)');
      _setUnits(unit);
    },

    /** Get current unit system */
    getUnits(): UnitSystem {
      return _getUnits();
    },

    // === Phase 5: Measuring Tool ===

    /** Toggle interactive measure mode — click two points to measure distance.
     *  Also locks camera rotation while measuring. */
    measureMode(enabled?: boolean): void {
      assertBoolean(enabled, 'measureMode(enabled)', { optional: true });
      const state = getMeasureState();
      if (enabled === undefined) {
        // Toggle
        if (state.active) { deactivateMeasure(); setMeasureLock(false); }
        else { activateMeasure(); setMeasureLock(true); }
      } else if (enabled) {
        activateMeasure();
        setMeasureLock(true);
      } else {
        deactivateMeasure();
        setMeasureLock(false);
      }
    },

    /** Get current measurement state */
    getMeasurement(): { active: boolean; point1: [number, number, number] | null; point2: [number, number, number] | null; distance: number | null } {
      return getMeasureState();
    },

    /** Programmatic measurement between two 3D points (no clicking needed) */
    measurePoints(p1: [number, number, number], p2: [number, number, number]): number {
      assertNumberTuple(p1, 3, 'measurePoints(p1)');
      assertNumberTuple(p2, 3, 'measurePoints(p2)');
      return measureDistance(p1, p2);
    },

    // === Color Regions API ===

    /** Paint a coplanar region by specifying a point and normal on the model surface.
     *  Returns the created region or `{error}`. On failure, the error message
     *  includes a diagnostic — the nearest hit point, its normal, the angle
     *  off the requested normal, and a suggested tolerance value that would
     *  include it. Pair with `probeRay` to get a known-on-surface seed. */
    paintRegion(opts: { point: [number, number, number]; normal: [number, number, number]; color: [number, number, number]; name?: string; tolerance?: number }) {
      if (!currentMeshData) return { error: 'No geometry loaded' };
      if (!opts || typeof opts !== 'object') return { error: 'paintRegion requires {point, normal, color}' };
      const { point, normal, color, name, tolerance } = opts;
      if (!Array.isArray(point) || point.length !== 3) return { error: 'point must be [x,y,z]' };
      if (!Array.isArray(normal) || normal.length !== 3) return { error: 'normal must be [nx,ny,nz]' };
      if (!Array.isArray(color) || color.length !== 3) return { error: 'color must be [r,g,b] with values 0..1' };

      const normalTolerance = tolerance ?? 0.9995;
      const adjacency = buildAdjacency(currentMeshData);
      const seedTri = resolveSeed(point as [number, number, number], normal as [number, number, number], currentMeshData, adjacency, normalTolerance);
      if (seedTri < 0) {
        return diagnoseSeedFailure(point as [number, number, number], normal as [number, number, number], currentMeshData, adjacency, normalTolerance);
      }

      const triangles = findCoplanarRegion(seedTri, adjacency, normalTolerance);
      const regionName = name ?? `Region ${getRegions().length + 1}`;
      const region = addRegion(
        regionName,
        color as [number, number, number],
        'face-pick',
        { kind: 'coplanar', seedPoint: point as [number, number, number], seedNormal: normal as [number, number, number], normalTolerance },
        triangles,
      );

      // Re-render with colors
      const colored = applyTriColorsIfVisible(currentMeshData);
      updateMesh(colored, { skipAutoFrame: true });
      syncLockState();

      return { id: region.id, name: region.name, triangles: triangles.size };
    },

    /** Paint a coplanar region by snapping the seed point to the nearest face on
     *  the model. Tolerant of off-surface points within `searchRadius` (default
     *  `Infinity` — always picks the closest face). The seed normal is taken
     *  from the snapped triangle, so callers don't need to know it. Returns
     *  `{ id, name, triangles, snappedTo: { point, normal, distance } }` on
     *  success, or `{ error, nearestDistance? }` on failure. */
    paintNearestRegion(opts: {
      point: [number, number, number];
      color: [number, number, number];
      searchRadius?: number;
      name?: string;
      tolerance?: number;
    }) {
      if (!currentMeshData) return { error: 'No geometry loaded' };
      if (!opts || typeof opts !== 'object') {
        return { error: 'paintNearestRegion requires {point, color, searchRadius?, tolerance?}' };
      }
      const { point, color, searchRadius, name, tolerance } = opts;
      if (!Array.isArray(point) || point.length !== 3) return { error: 'point must be [x,y,z]' };
      if (!Array.isArray(color) || color.length !== 3) return { error: 'color must be [r,g,b] with values 0..1' };
      if (searchRadius !== undefined && (typeof searchRadius !== 'number' || !Number.isFinite(searchRadius) || searchRadius < 0)) {
        return { error: 'searchRadius must be a non-negative finite number' };
      }

      const normalTolerance = tolerance ?? 0.9995;
      const adjacency = buildAdjacency(currentMeshData);
      const nearest = findNearestTriangle(point as [number, number, number], currentMeshData, adjacency);
      if (nearest.triIndex < 0) return { error: 'Mesh has no triangles' };

      if (searchRadius !== undefined && nearest.distance > searchRadius) {
        return {
          error: `Nearest face is ${nearest.distance.toFixed(4)} units from the seed point, outside searchRadius=${searchRadius}. Increase searchRadius or move the point closer to the surface.`,
          nearestDistance: nearest.distance,
        };
      }

      const triangles = findCoplanarRegion(nearest.triIndex, adjacency, normalTolerance);
      const regionName = name ?? `Region ${getRegions().length + 1}`;
      const region = addRegion(
        regionName,
        color as [number, number, number],
        'face-pick',
        { kind: 'coplanar', seedPoint: nearest.closest, seedNormal: nearest.normal, normalTolerance },
        triangles,
      );

      const colored = applyTriColorsIfVisible(currentMeshData);
      updateMesh(colored, { skipAutoFrame: true });
      syncLockState();

      return {
        id: region.id,
        name: region.name,
        triangles: triangles.size,
        snappedTo: {
          point: nearest.closest,
          normal: nearest.normal,
          distance: nearest.distance,
        },
      };
    },

    /** Paint a specific set of triangle indices as a single region.
     *  Useful for paintbrush-style selections produced programmatically. */
    paintFaces(opts: { triangleIds: number[]; color: [number, number, number]; name?: string }) {
      if (!currentMeshData) return { error: 'No geometry loaded' };
      if (!opts || typeof opts !== 'object') return { error: 'paintFaces requires {triangleIds, color}' };
      const { triangleIds, color, name } = opts;
      if (!Array.isArray(triangleIds) || triangleIds.length === 0) return { error: 'triangleIds must be a non-empty array of integers' };
      if (!Array.isArray(color) || color.length !== 3) return { error: 'color must be [r,g,b] with values 0..1' };

      const numTri = currentMeshData.numTri;
      const ids: number[] = [];
      for (const id of triangleIds) {
        if (typeof id !== 'number' || !Number.isInteger(id) || id < 0 || id >= numTri) {
          return { error: `triangleIds contains invalid index ${id} (expected 0..${numTri - 1})` };
        }
        ids.push(id);
      }

      const triangles = new Set<number>(ids);
      const regionName = name ?? `Region ${getRegions().length + 1}`;
      const region = addRegion(
        regionName,
        color as [number, number, number],
        'paintbrush',
        { kind: 'triangles', ids: [...triangles] },
        triangles,
      );

      const colored = applyTriColorsIfVisible(currentMeshData);
      updateMesh(colored, { skipAutoFrame: true });
      syncLockState();

      return { id: region.id, name: region.name, triangles: triangles.size };
    },

    /** Paint a slab — all faces whose centroid falls inside a planar slab.
     *  `axis` is shorthand for axis-aligned slabs ('x'/'y'/'z'). For oblique
     *  slabs, pass `normal` directly (does not need to be normalized). */
    paintSlab(opts: { axis?: 'x' | 'y' | 'z'; normal?: [number, number, number]; offset: number; thickness: number; color: [number, number, number]; name?: string; coverageMode?: CoverageMode; maxTriangleArea?: number; smooth?: boolean; resolution?: number; maxEdge?: number }) {
      if (!currentMeshData) return { error: 'No geometry loaded' };
      if (!opts || typeof opts !== 'object') return { error: 'paintSlab requires {axis|normal, offset, thickness, color}' };
      const { axis, normal: rawNormal, offset, thickness, color, name, coverageMode, maxTriangleArea } = opts;

      let normal: [number, number, number];
      if (axis !== undefined) {
        if (axis !== 'x' && axis !== 'y' && axis !== 'z') return { error: "axis must be 'x', 'y', or 'z'" };
        normal = axis === 'x' ? [1, 0, 0] : axis === 'y' ? [0, 1, 0] : [0, 0, 1];
      } else if (Array.isArray(rawNormal) && rawNormal.length === 3) {
        const [nx, ny, nz] = rawNormal;
        const len = Math.hypot(nx, ny, nz);
        if (!Number.isFinite(len) || len === 0) return { error: 'normal must be a non-zero 3-vector' };
        normal = [nx / len, ny / len, nz / len];
      } else {
        return { error: 'paintSlab requires either axis (x|y|z) or normal [nx,ny,nz]' };
      }

      if (typeof offset !== 'number' || !Number.isFinite(offset)) return { error: 'offset must be a finite number' };
      if (typeof thickness !== 'number' || !Number.isFinite(thickness) || thickness <= 0) return { error: 'thickness must be a positive finite number' };
      if (!Array.isArray(color) || color.length !== 3) return { error: 'color must be [r,g,b] with values 0..1' };
      const coverageErr = validateCoverageMode(coverageMode);
      if (coverageErr) return { error: coverageErr };
      const areaErr = validateMaxTriangleArea(maxTriangleArea);
      if (areaErr) return { error: areaErr };
      const smoothErr = validateSmoothParams(opts);
      if (smoothErr) return { error: smoothErr };

      let triangles = findSlabTriangles(currentMeshData, normal, offset, thickness, coverageMode);
      if (maxTriangleArea !== undefined && triangles.size > 0) {
        triangles = new Set([...triangles].filter(t => triangleArea(t, currentMeshData!) <= maxTriangleArea));
      }
      if (triangles.size === 0) return { error: 'No triangles found inside the slab' };

      const regionName = name ?? `Region ${getRegions().length + 1}`;
      const { smooth, maxEdge } = resolveShapeSmoothFields(opts);
      // Smoothing routes refinement through the async (worker-backed) listener;
      // for the agent API we want a populated region back synchronously, so wrap
      // the addRegion in withSyncReconcile() — same dance as paintBrushStrokeSync.
      const region = withSyncReconcile(() => addRegion(
        regionName,
        color as [number, number, number],
        'slab',
        { kind: 'slab', normal, offset, thickness, smooth, maxEdge },
        triangles,
      ));
      scheduleColorRefresh();
      syncLockState();

      return { id: region.id, name: region.name, triangles: region.triangles.size, smooth, maxEdge };
    },

    /** List all color regions on the current geometry. Each entry includes
     *  `bbox` (axis-aligned bounding box of the painted triangles' vertices)
     *  and `centroid` (mean of those vertex positions) so callers can verify
     *  *where* a region landed without re-rendering. Returns `{ ..., bbox: null,
     *  centroid: null }` for regions whose triangles haven't been resolved
     *  yet (e.g. just deserialized from a saved version). */
    listRegions() {
      const mesh = currentMeshData;
      return getRegions().map(r => {
        const stats = mesh ? regionTriangleStats(r.triangles, mesh) : null;
        return {
          id: r.id,
          name: r.name,
          color: r.color,
          source: r.source,
          triangles: r.triangles.size,
          order: r.order,
          visible: r.visible,
          bbox: stats?.bbox ?? null,
          centroid: stats?.centroid ?? null,
        };
      });
    },

    /** Direct mesh access for procedural paint workflows. Returns flat typed
     *  arrays plus per-triangle face normals and centroids (the same arrays
     *  the paint resolver uses internally), so a caller can implement any
     *  selection strategy without trial-and-error tolerance tuning.
     *
     *  Shape:
     *  ```
     *  {
     *    numVert, numTri,
     *    vertices: Float32Array,   // numVert * 3 (x,y,z packed)
     *    triangles: Uint32Array,   // numTri * 3 (vertex indices)
     *    normals: Float32Array,    // numTri * 3 (face normals)
     *    centroids: Float32Array,  // numTri * 3 (face centroids)
     *    boundingBox: { min:[x,y,z], max:[x,y,z] }
     *  }
     *  ```
     *  Triangle indices are stable for a given saved version — pass them to
     *  `paintFaces({triangleIds})` directly. */
    getMesh() {
      const mesh = currentMeshData;
      if (!mesh) return { error: 'No geometry loaded' };
      const adjacency = buildAdjacency(mesh);
      const numTri = mesh.numTri;
      const numVert = mesh.numVert;

      // Pack vertex positions into a tight Float32Array (mesh.vertProperties may
      // include per-vertex extras like colors that callers don't need).
      const vertices = new Float32Array(numVert * 3);
      for (let v = 0; v < numVert; v++) {
        vertices[v * 3] = mesh.vertProperties[v * mesh.numProp];
        vertices[v * 3 + 1] = mesh.vertProperties[v * mesh.numProp + 1];
        vertices[v * 3 + 2] = mesh.vertProperties[v * mesh.numProp + 2];
      }

      // Triangle indices may be backed by Uint32 already; copy to a stable, owned buffer.
      const triangles = new Uint32Array(numTri * 3);
      for (let t = 0; t < numTri * 3; t++) triangles[t] = mesh.triVerts[t];

      // Centroids — average of the three vertex positions per triangle.
      const centroids = new Float32Array(numTri * 3);
      for (let t = 0; t < numTri; t++) {
        const v0 = triangles[t * 3];
        const v1 = triangles[t * 3 + 1];
        const v2 = triangles[t * 3 + 2];
        centroids[t * 3] = (vertices[v0 * 3] + vertices[v1 * 3] + vertices[v2 * 3]) / 3;
        centroids[t * 3 + 1] = (vertices[v0 * 3 + 1] + vertices[v1 * 3 + 1] + vertices[v2 * 3 + 1]) / 3;
        centroids[t * 3 + 2] = (vertices[v0 * 3 + 2] + vertices[v1 * 3 + 2] + vertices[v2 * 3 + 2]) / 3;
      }

      // Bounding box from the packed vertices (avoids walking the full vertProperties).
      let xMin = Infinity, yMin = Infinity, zMin = Infinity;
      let xMax = -Infinity, yMax = -Infinity, zMax = -Infinity;
      for (let v = 0; v < numVert; v++) {
        const x = vertices[v * 3], y = vertices[v * 3 + 1], z = vertices[v * 3 + 2];
        if (x < xMin) xMin = x; if (x > xMax) xMax = x;
        if (y < yMin) yMin = y; if (y > yMax) yMax = y;
        if (z < zMin) zMin = z; if (z > zMax) zMax = z;
      }

      return {
        numVert,
        numTri,
        vertices,
        triangles,
        normals: adjacency.normals,
        centroids,
        boundingBox: {
          min: [xMin, yMin, zMin] as [number, number, number],
          max: [xMax, yMax, zMax] as [number, number, number],
        },
      };
    },

    /** Paint every triangle whose centroid lies inside an axis-aligned bounding
     *  box. Optional `normalCone` further restricts to triangles whose face
     *  normal is within `angleDeg` of `axis` (a unit vector). One-shot wrapper
     *  around `findFaces` + `paintFaces` for the common "paint that region of
     *  the model" intent.
     *
     *  ```
     *  partwright.paintInBox({
     *    box: { min: [-5, -5, 60], max: [5, 5, 75] },
     *    normalCone: { axis: [0, -1, 0.4], angleDeg: 20 },  // back-facing only
     *    color: [0.88, 0.30, 0.45],
     *    name: 'Index nail',
     *  })
     *  ```
     *  Returns `{ id, name, triangles, bbox, centroid }` on success or
     *  `{ error }`. Empty match returns `{ error: 'no triangles matched' }`. */
    paintInBox(opts: {
      box: { min: [number, number, number]; max: [number, number, number] };
      normalCone?: { axis: [number, number, number]; angleDeg: number };
      color: [number, number, number];
      name?: string;
      /** Shortcut: paint only upward-facing triangles inside the box. Same
       *  as `normalCone: { axis: [0, 0, 1], angleDeg: 30 }` — eliminates
       *  the common over-paint where the box also catches side walls and
       *  the bottom face. Ignored when `normalCone` is explicitly set. */
      topOnly?: boolean;
      /** How triangles are tested for box containment. Default `'centroid'`
       *  (the historical behavior). Use `'fully_inside'` to defang long
       *  radial fan triangles from cylinder/revolve meshes — they often
       *  have a centroid in the box but extend visibly outside it. */
      coverageMode?: CoverageMode;
      /** Skip any triangle whose world-space area exceeds this threshold.
       *  Backstop against fan-topology bleed when `coverageMode` alone
       *  isn't enough. Inspect `largestTriangleArea` from `paintPreview`
       *  to pick a sensible value. */
      maxTriangleArea?: number;
    }) {
      if (!currentMeshData) return { error: 'No geometry loaded' };
      if (!opts || typeof opts !== 'object') return { error: 'paintInBox requires { box, color }' };
      const cone = resolvePaintCone(opts.normalCone, opts.topOnly);
      const filterErr = validateBoxAndCone(opts.box, cone);
      if (filterErr) return { error: filterErr };
      const coverageErr = validateCoverageMode(opts.coverageMode);
      if (coverageErr) return { error: coverageErr };
      const areaErr = validateMaxTriangleArea(opts.maxTriangleArea);
      if (areaErr) return { error: areaErr };
      if (!Array.isArray(opts.color) || opts.color.length !== 3) return { error: 'color must be [r,g,b] with values 0..1' };

      const triangles = collectTrianglesByFilter(currentMeshData, opts.box, cone, null, opts.coverageMode, opts.maxTriangleArea);
      if (triangles.size === 0) return { error: `paintInBox: no triangles matched the box${cone ? ' (with the normalCone' + (opts.topOnly ? '/topOnly' : '') + ' filter)' : ''}${opts.coverageMode === 'fully_inside' ? ' (with coverageMode: fully_inside — try widening the box or dropping the mode)' : ''}${opts.maxTriangleArea !== undefined ? ` (with maxTriangleArea: ${opts.maxTriangleArea} — try raising it)` : ''}. Try widening the box, dropping topOnly/normalCone, or call findFaces() to see what passes each filter individually.` };

      return commitPaintFromSet(triangles, opts.color, opts.name, 'paintbrush');
    },

    /** Paint every triangle whose centroid lies inside an *oriented* bounding
     *  box — same selector the UI's Box tool uses, but with explicit
     *  center/size/quaternion instead of a gizmo. Use this when you need
     *  arbitrary rotation that an AABB can't express (e.g. painting a tilted
     *  panel on an oriented part).
     *
     *  `quaternion` defaults to identity `[0, 0, 0, 1]` if omitted, which
     *  reduces to the same selector as `paintInBox` against an AABB centered
     *  at `center` with the given `size`.
     *
     *  ```
     *  partwright.paintInOrientedBox({
     *    box: {
     *      center: [10, 0, 5],
     *      size: [8, 4, 2],
     *      quaternion: [0, 0, Math.sin(Math.PI / 8), Math.cos(Math.PI / 8)], // 45° around Z
     *    },
     *    color: [0.2, 0.7, 0.9],
     *  });
     *  ```
     *  Returns `{ id, name, triangles }` or `{ error }`. */
    paintInOrientedBox(opts: {
      box: {
        center: [number, number, number];
        size: [number, number, number];
        quaternion?: [number, number, number, number];
      };
      color: [number, number, number];
      name?: string;
      /** Smooth the box's painted edge by subdividing the mesh near its faces.
       *  On by default — pass `false` to keep the blocky base tessellation. */
      smooth?: boolean;
      /** Smoothing detail: target boundary edge length = model bbox diagonal /
       *  resolution (2..1024, default 256). Ignored when `maxEdge` is set. */
      resolution?: number;
      /** Absolute target boundary edge length (mesh units); overrides `resolution`. */
      maxEdge?: number;
    }) {
      if (!currentMeshData) return { error: 'No geometry loaded' };
      if (!opts || typeof opts !== 'object') return { error: 'paintInOrientedBox requires { box, color }' };
      if (!opts.box || typeof opts.box !== 'object') return { error: 'paintInOrientedBox.box must be { center, size, quaternion? }' };
      const { center, size, quaternion } = opts.box;
      if (!Array.isArray(center) || center.length !== 3 || !center.every(Number.isFinite)) return { error: 'paintInOrientedBox.box.center must be [x, y, z] of finite numbers' };
      if (!Array.isArray(size) || size.length !== 3 || !size.every(v => Number.isFinite(v) && v > 0)) return { error: 'paintInOrientedBox.box.size must be [sx, sy, sz] of positive finite numbers' };
      const q: [number, number, number, number] = quaternion ?? [0, 0, 0, 1];
      if (!Array.isArray(q) || q.length !== 4 || !q.every(Number.isFinite)) return { error: 'paintInOrientedBox.box.quaternion must be [x, y, z, w] of finite numbers (defaults to identity if omitted)' };
      if (!Array.isArray(opts.color) || opts.color.length !== 3) return { error: 'color must be [r, g, b] with values 0..1' };
      const smoothErr = validateSmoothParams(opts);
      if (smoothErr) return { error: smoothErr };

      const box = {
        center: [center[0], center[1], center[2]] as [number, number, number],
        size: [size[0], size[1], size[2]] as [number, number, number],
        quaternion: q,
      };
      const triangles = findBoxTriangles(currentMeshData, box);
      if (triangles.size === 0) return { error: 'paintInOrientedBox: no triangles inside the box. Try a larger size, recheck the center, or use paintPreview to see what the box covers.' };

      // Persist a re-resolvable box descriptor (not baked triangle ids) so the
      // edge can be smoothed. Smoothing routes through the async listener; the
      // agent API wraps addRegion in withSyncReconcile so a populated region
      // comes back before this call returns (same pattern as paintSlab).
      const { smooth, maxEdge } = resolveShapeSmoothFields(opts);
      const regionName = opts.name ?? `Region ${getRegions().length + 1}`;
      const region = withSyncReconcile(() => addRegion(
        regionName,
        opts.color as [number, number, number],
        'slab',
        { kind: 'box', center: box.center, size: box.size, quaternion: box.quaternion, smooth, maxEdge },
        triangles,
      ));
      scheduleColorRefresh();
      syncLockState();
      const stats = regionTriangleStats(region.triangles, currentMeshData);
      return { id: region.id, name: region.name, triangles: region.triangles.size, bbox: stats.bbox, centroid: stats.centroid, smooth, maxEdge };
    },

    /** Paint every triangle whose centroid lies within `radius` of `point`.
     *  Optional `normalCone` restricts by face normal direction. Use this for
     *  "paint a fingernail-sized patch around X" without picking edge tolerances.
     *
     *  ```
     *  partwright.paintNear({
     *    point: [10, 5, 67],
     *    radius: 4,
     *    normalCone: { axis: [0, -0.89, 0.45], angleDeg: 25 },
     *    color: [0.88, 0.30, 0.45],
     *  })
     *  ```
     *  Returns `{ id, name, triangles, bbox, centroid }` or `{ error }`. */
    paintNear(opts: {
      point: [number, number, number];
      radius: number;
      normalCone?: { axis: [number, number, number]; angleDeg: number };
      color: [number, number, number];
      name?: string;
      /** Shortcut: only upward-facing triangles. See paintInBox.topOnly. */
      topOnly?: boolean;
      /** See paintInBox.coverageMode. */
      coverageMode?: CoverageMode;
      /** See paintInBox.maxTriangleArea. */
      maxTriangleArea?: number;
    }) {
      if (!currentMeshData) return { error: 'No geometry loaded' };
      if (!opts || typeof opts !== 'object') return { error: 'paintNear requires { point, radius, color }' };
      if (!Array.isArray(opts.point) || opts.point.length !== 3) return { error: 'point must be [x,y,z]' };
      for (let i = 0; i < 3; i++) {
        if (typeof opts.point[i] !== 'number' || !Number.isFinite(opts.point[i])) return { error: 'point components must be finite numbers' };
      }
      if (typeof opts.radius !== 'number' || !Number.isFinite(opts.radius) || opts.radius <= 0) return { error: 'radius must be a positive finite number' };
      const cone = resolvePaintCone(opts.normalCone, opts.topOnly);
      const coneErr = validateNormalCone(cone);
      if (coneErr) return { error: coneErr };
      const coverageErr = validateCoverageMode(opts.coverageMode);
      if (coverageErr) return { error: coverageErr };
      const areaErr = validateMaxTriangleArea(opts.maxTriangleArea);
      if (areaErr) return { error: areaErr };
      if (!Array.isArray(opts.color) || opts.color.length !== 3) return { error: 'color must be [r,g,b] with values 0..1' };

      const triangles = collectTrianglesBySphere(currentMeshData, opts.point as [number, number, number], opts.radius, cone, opts.coverageMode, opts.maxTriangleArea);
      if (triangles.size === 0) return { error: `paintNear: no triangles within ${opts.radius} of [${opts.point.join(', ')}]${opts.coverageMode === 'fully_inside' ? ' (with coverageMode: fully_inside)' : ''}${opts.maxTriangleArea !== undefined ? ` (with maxTriangleArea: ${opts.maxTriangleArea})` : ''}. Try a larger radius — call findFaces() with a bigger box first to see what's around.` };

      return commitPaintFromSet(triangles, opts.color, opts.name, 'paintbrush');
    },

    /** Paint triangles whose centroids fall inside a cylindrical shell:
     *  rMin ≤ dist(centroid, axis) ≤ rMax AND zMin ≤ centroid.z ≤ zMax.
     *  The canonical tool for inner walls of hollow cylinders, mugs, vases,
     *  and any revolved shape where `paintInBox` catches too many faces.
     *  Set rMin > 0 to exclude the axis core and select only the inner surface. */
    paintInCylinder(opts: {
      center?: [number, number];
      rMin: number;
      rMax: number;
      zMin: number;
      zMax: number;
      color: [number, number, number];
      name?: string;
      normalCone?: { axis: [number, number, number]; angleDeg: number };
      topOnly?: boolean;
      coverageMode?: CoverageMode;
      maxTriangleArea?: number;
    }) {
      if (!currentMeshData) return { error: 'No geometry loaded' };
      if (!opts || typeof opts !== 'object') return { error: 'paintInCylinder requires { rMin, rMax, zMin, zMax, color }' };
      if (typeof opts.rMin !== 'number' || typeof opts.rMax !== 'number') return { error: 'rMin and rMax must be numbers' };
      if (typeof opts.zMin !== 'number' || typeof opts.zMax !== 'number') return { error: 'zMin and zMax must be numbers' };
      if (!Array.isArray(opts.color) || opts.color.length !== 3) return { error: 'color must be [r,g,b] in 0..1' };
      const cone = resolvePaintCone(opts.normalCone, opts.topOnly);
      const coneErr = validateNormalCone(cone);
      if (coneErr) return { error: coneErr };
      const areaErr = validateMaxTriangleArea(opts.maxTriangleArea);
      if (areaErr) return { error: areaErr };
      const triangles = collectTrianglesByCylinder(
        currentMeshData,
        opts.center ?? [0, 0],
        opts.rMin, opts.rMax,
        opts.zMin, opts.zMax,
        cone,
        opts.coverageMode,
        opts.maxTriangleArea,
      );
      if (triangles.size === 0) {
        return { error: `paintInCylinder: no triangles in cylindrical shell (rMin=${opts.rMin}, rMax=${opts.rMax}, z=${opts.zMin}..${opts.zMax})${cone ? ' with normalCone filter' : ''}. Try widening the shell, checking the center, or calling paintPreview with a box first to locate the geometry.` };
      }
      return commitPaintFromSet(triangles, opts.color, opts.name, 'paintbrush');
    },

    /** Render a preview of the current model with a candidate region tinted
     *  bright yellow, *without* committing the paint to the regions list.
     *  Accepts the same selectors as `paintInBox` / `paintNear` plus an
     *  optional explicit `triangleIds` set. Returns
     *  `{ thumbnail, triangleCount, bbox, centroid }` so an agent can verify
     *  the shape of the would-be region in one call instead of paint → render → undo.
     *
     *  ```
     *  const preview = partwright.paintPreview({
     *    box: { min: [...], max: [...] },
     *    normalCone: { axis: [...], angleDeg: 25 },
     *  })
     *  // Display preview.thumbnail (data URL) to confirm before committing.
     *  ```
     *  `view` is forwarded to `renderView` (elevation/azimuth/ortho/size). */
    paintPreview(opts: {
      box?: { min: [number, number, number]; max: [number, number, number] };
      normalCone?: { axis: [number, number, number]; angleDeg: number };
      point?: [number, number, number];
      radius?: number;
      triangleIds?: number[];
      view?: { elevation?: number; azimuth?: number; ortho?: boolean; size?: number };
      /** When `true`, render a yellow-highlighted thumbnail of the
       *  would-be region and return it in `thumbnail`. Default `false` —
       *  count-only is the cheap sanity check that should always be
       *  affordable. */
      withImage?: boolean;
      /** See paintInBox.coverageMode. Applied to box / point+radius
       *  selectors; ignored when `triangleIds` is passed (those bypass
       *  the geometric filter). */
      coverageMode?: CoverageMode;
      /** See paintInBox.maxTriangleArea. */
      maxTriangleArea?: number;
    } = {}) {
      const mesh = currentMeshData;
      if (!mesh) return { error: 'No geometry loaded' };

      const coverageErr = validateCoverageMode(opts.coverageMode);
      if (coverageErr) return { error: coverageErr };
      const areaErr = validateMaxTriangleArea(opts.maxTriangleArea);
      if (areaErr) return { error: areaErr };

      let triangles: Set<number>;
      if (opts.triangleIds !== undefined) {
        if (!Array.isArray(opts.triangleIds)) return { error: 'triangleIds must be an array of integers' };
        triangles = new Set();
        for (const id of opts.triangleIds) {
          if (!Number.isInteger(id) || id < 0 || id >= mesh.numTri) return { error: `triangleIds contains invalid index ${id} (expected 0..${mesh.numTri - 1})` };
          triangles.add(id);
        }
      } else if (opts.point !== undefined && opts.radius !== undefined) {
        if (!Array.isArray(opts.point) || opts.point.length !== 3) return { error: 'point must be [x,y,z]' };
        if (typeof opts.radius !== 'number' || !Number.isFinite(opts.radius) || opts.radius <= 0) return { error: 'radius must be a positive finite number' };
        const coneErr = validateNormalCone(opts.normalCone);
        if (coneErr) return { error: coneErr };
        triangles = collectTrianglesBySphere(mesh, opts.point, opts.radius, opts.normalCone, opts.coverageMode, opts.maxTriangleArea);
      } else if (opts.box !== undefined) {
        const err = validateBoxAndCone(opts.box, opts.normalCone);
        if (err) return { error: err };
        triangles = collectTrianglesByFilter(mesh, opts.box, opts.normalCone, null, opts.coverageMode, opts.maxTriangleArea);
      } else {
        return { error: 'paintPreview requires one of: { triangleIds }, { point, radius }, or { box }' };
      }

      const stats = regionTriangleStats(triangles, mesh);
      const areas = summarizeTriangleAreas(triangles, mesh);
      const wantImage = opts.withImage === true;
      const thumbnail = wantImage ? renderRegionHighlight(mesh, triangles, opts.view ?? {}) : undefined;
      return {
        ...(thumbnail !== undefined ? { thumbnail } : {}),
        triangleCount: triangles.size,
        bbox: stats.bbox,
        centroid: stats.centroid,
        totalArea: Math.round(areas.totalArea * 1000) / 1000,
        largestTriangleArea: Math.round(areas.largestTriangleArea * 1000) / 1000,
      };
    },

    /** Diagnose an existing painted region: returns counts, bbox, area,
     *  a normal-distribution histogram (axis-aligned bins), and a yellow-
     *  highlighted thumbnail of just the region's triangles overlaid on
     *  the current model. Use to self-correct after a bad paint without
     *  the paint → render → undo → repaint cycle.
     *
     *  ```
     *  partwright.paintExplain({ region: 'mouth' })       // by name
     *  partwright.paintExplain({ region: 17042, withImage: false })  // stats-only
     *  ``` */
    paintExplain(opts: {
      region: number | string;
      withImage?: boolean;
      view?: { elevation?: number; azimuth?: number; ortho?: boolean; size?: number };
    }) {
      if (!currentMeshData) return { error: 'No geometry loaded' };
      if (!opts || typeof opts !== 'object') return { error: 'paintExplain requires { region }' };
      if (opts.region === undefined) return { error: 'paintExplain.region (id or name) is required' };

      const regions = getRegions();
      const region = typeof opts.region === 'number'
        ? regions.find(r => r.id === opts.region)
        : regions.find(r => r.name === opts.region);
      if (!region) {
        const existing = regions.map(r => `"${r.name}" (id=${r.id})`).join(', ') || '(none)';
        return { error: `No region matching ${JSON.stringify(opts.region)}. Existing: ${existing}` };
      }

      const mesh = currentMeshData;
      const stats = regionTriangleStats(region.triangles, mesh);
      const { area, normalHistogram, largestTriangleArea } = computeRegionAreaAndNormalHistogram(region.triangles, mesh);
      const wantImage = opts.withImage !== false; // default true — explain wants visual
      const thumbnail = wantImage ? renderRegionHighlight(mesh, region.triangles, opts.view ?? {}) : undefined;

      return {
        id: region.id,
        name: region.name,
        color: region.color,
        source: region.source,
        triangleCount: region.triangles.size,
        area: Math.round(area * 1000) / 1000,
        largestTriangleArea: Math.round(largestTriangleArea * 1000) / 1000,
        bbox: stats.bbox,
        centroid: stats.centroid,
        normalHistogram,
        ...(thumbnail !== undefined ? { thumbnail } : {}),
      };
    },

    /** Assert facts about a previously-painted region. Returns
     *  `{ passed: true }` on success, otherwise `{ passed: false, failures: [...] }`.
     *
     *  ```
     *  partwright.assertPaint({
     *    region: 'Index nail',                            // or numeric region id
     *    expectedTriangleCount: { min: 15, max: 60 },     // or exact number
     *    expectedBoundingBox: {
     *      x: [8, 11], y: [3, 7], z: [60, 75],            // any subset of axes
     *    },
     *    expectedCentroid: { z: [62, 72] },               // approximate centroid axes
     *  })
     *  ``` */
    assertPaint(opts: {
      region: number | string;
      expectedTriangleCount?: number | { min?: number; max?: number };
      expectedBoundingBox?: { x?: [number, number]; y?: [number, number]; z?: [number, number] };
      expectedCentroid?: { x?: [number, number]; y?: [number, number]; z?: [number, number] };
    }) {
      const mesh = currentMeshData;
      if (!mesh) return { passed: false, failures: ['No geometry loaded'] };
      if (!opts || typeof opts !== 'object') return { passed: false, failures: ['assertPaint requires an options object'] };
      if (opts.region === undefined) return { passed: false, failures: ['assertPaint.region (id or name) is required'] };

      const regions = getRegions();
      const region = typeof opts.region === 'number'
        ? regions.find(r => r.id === opts.region)
        : regions.find(r => r.name === opts.region);
      if (!region) return { passed: false, failures: [`No region matching ${JSON.stringify(opts.region)}. Existing: ${regions.map(r => `"${r.name}" (id=${r.id})`).join(', ') || '(none)'}`] };

      const stats = regionTriangleStats(region.triangles, mesh);
      const failures: string[] = [];

      if (opts.expectedTriangleCount !== undefined) {
        const c = region.triangles.size;
        if (typeof opts.expectedTriangleCount === 'number') {
          if (c !== opts.expectedTriangleCount) failures.push(`triangle count: expected ${opts.expectedTriangleCount}, got ${c}`);
        } else {
          const { min, max } = opts.expectedTriangleCount;
          if (typeof min === 'number' && c < min) failures.push(`triangle count: expected >= ${min}, got ${c}`);
          if (typeof max === 'number' && c > max) failures.push(`triangle count: expected <= ${max}, got ${c}`);
        }
      }

      if (opts.expectedBoundingBox && stats.bbox) {
        const axes = ['x', 'y', 'z'] as const;
        for (let i = 0; i < 3; i++) {
          const axis = axes[i];
          const range = opts.expectedBoundingBox[axis];
          if (!range) continue;
          const lo = stats.bbox.min[i], hi = stats.bbox.max[i];
          if (lo < range[0]) failures.push(`bbox.${axis}.min: expected >= ${range[0]}, got ${lo.toFixed(3)}`);
          if (hi > range[1]) failures.push(`bbox.${axis}.max: expected <= ${range[1]}, got ${hi.toFixed(3)}`);
        }
      }

      if (opts.expectedCentroid && stats.centroid) {
        const axes = ['x', 'y', 'z'] as const;
        for (let i = 0; i < 3; i++) {
          const axis = axes[i];
          const range = opts.expectedCentroid[axis];
          if (!range) continue;
          const c = stats.centroid[i];
          if (c < range[0] || c > range[1]) failures.push(`centroid.${axis}: expected within [${range[0]}, ${range[1]}], got ${c.toFixed(3)}`);
        }
      }

      return failures.length === 0
        ? { passed: true, region: { id: region.id, name: region.name, triangles: region.triangles.size, bbox: stats.bbox, centroid: stats.centroid } }
        : { passed: false, failures, region: { id: region.id, name: region.name, triangles: region.triangles.size, bbox: stats.bbox, centroid: stats.centroid } };
    },

    /** Clear all color regions */
    clearColors() {
      // Drop regions inside withSyncReconcile so the mesh reverts to its
      // pristine base before this call returns — otherwise the async listener
      // would unrefine on the next tick and the immediate getMesh() reads
      // stale state.
      withSyncReconcile(() => clearRegions());
      scheduleColorRefresh();
      syncLockState();
      return { cleared: true };
    },

    /** Remove a single color region by id. Reverses one paint operation
     *  without nuking the rest. Returns `{ removed: true, id }` on success
     *  or `{ error }` if no region matches. */
    removeRegion(id: number) {
      if (!Number.isFinite(id)) return { error: 'removeRegion(id) requires a finite integer id from listRegions()' };
      // Removing a refining region (brushStroke / smooth slab / smooth box)
      // requires re-refining without it; do it synchronously so the caller's
      // immediate getMesh() sees the post-removal mesh.
      const ok = withSyncReconcile(() => removeRegion(id));
      if (!ok) return { error: `No region with id=${id}. Call listRegions() to see current ids.` };
      scheduleColorRefresh();
      syncLockState();
      return { removed: true, id };
    },

    /** Toggle whether a single region is rendered in the viewport. Hidden
     *  regions still ship in GLB/3MF exports — visibility is a UI-only flag
     *  meant for previewing the model without a region's overlay. Mirrors the
     *  eye-icon button in the paint panel's region list. Returns
     *  `{ id, visible }` on success or `{ error }` if no region matches. */
    setRegionVisibility(id: number, visible: boolean) {
      if (!Number.isFinite(id)) return { error: 'setRegionVisibility(id, visible) requires a finite integer id from listRegions()' };
      if (typeof visible !== 'boolean') return { error: 'setRegionVisibility(id, visible): visible must be a boolean (true | false)' };
      const ok = setRegionVisibility(id, visible);
      if (!ok) return { error: `No region with id=${id}. Call listRegions() to see current ids.` };
      scheduleColorRefresh();
      return { id, visible };
    },

    /** Shorthand for `setRegionVisibility(id, false)`. */
    hideRegion(id: number) {
      return this.setRegionVisibility(id, false);
    },

    /** Shorthand for `setRegionVisibility(id, true)`. */
    showRegion(id: number) {
      return this.setRegionVisibility(id, true);
    },

    /** Read or write the bucket-tool tolerance used by the interactive paint
     *  panel and by `paintRegion` when no `tolerance` argument is passed.
     *  Value is the cosine of the maximum allowed bend angle (1 = strict
     *  coplanar, -1 = whole connected component). Use the angle form via
     *  `paintRegion({tolerance})` if you'd rather think in degrees.
     *  Returns the previous + new value on set. */
    getBucketTolerance() {
      return { tolerance: getPaintBucketTolerance() };
    },
    setBucketTolerance(tolerance: number) {
      if (typeof tolerance !== 'number' || !Number.isFinite(tolerance)) {
        return { error: 'setBucketTolerance(tolerance): tolerance must be a finite number in [-1, 1] (cosine of max bend angle)' };
      }
      const clamped = Math.max(-1, Math.min(1, tolerance));
      const previous = getPaintBucketTolerance();
      setPaintBucketTolerance(clamped);
      return { previous, tolerance: clamped };
    },

    /** Read or write the brush-tool radius (in mesh units) used by the
     *  interactive paint panel. `0` means single-triangle (legacy behavior);
     *  any positive value expands the brush footprint to every triangle whose
     *  centroid lies within the radius of the click/drag point.
     *  Programmatic painters should use `paintNear({point, radius})` or
     *  `paintFaces({triangleIds})` — this setter only changes the UI brush. */
    getBrushSize() {
      return { radius: getPaintBrushRadius() };
    },
    setBrushSize(radius: number) {
      if (typeof radius !== 'number' || !Number.isFinite(radius) || radius < 0) {
        return { error: 'setBrushSize(radius): radius must be a non-negative finite number (mesh units)' };
      }
      const previous = getPaintBrushRadius();
      setPaintBrushRadius(radius);
      return { previous, radius };
    },

    /** Surface-painting settings for the UI brush tool. `slab` (default) keeps a
     *  stroke's footprint a thin shell on the picked surface so paint can't bleed
     *  through thin / hollow walls; `depth` (mesh units, 0 = auto = half the
     *  radius) is how far through the wall paint may reach. */
    getBrushSurface() {
      return { surface: getPaintBrushSurface(), depth: getPaintBrushDepth() };
    },
    setBrushSurface(mode: string) {
      if (mode !== 'geodesic' && mode !== 'slab') {
        return { error: "setBrushSurface(mode): mode must be 'geodesic' or 'slab'" };
      }
      setPaintBrushSurface(mode);
      return { surface: getPaintBrushSurface() };
    },
    setBrushDepth(depth: number) {
      if (typeof depth !== 'number' || !Number.isFinite(depth) || depth < 0) {
        return { error: 'setBrushDepth(depth): depth must be a non-negative finite number (mesh units; 0 = auto)' };
      }
      setPaintBrushDepth(depth);
      return { depth: getPaintBrushDepth() };
    },

    /** Smooth-brush settings for the UI brush tool. When smooth is on (and the
     *  brush has a radius), a stroke subdivides the triangles its edge crosses
     *  until they are below a target edge length, so the painted outline is
     *  rounded regardless of base-mesh coarseness. `divisor` is the detail
     *  control: target edge = brush radius / divisor (2..1024; higher =
     *  smoother + more triangles). */
    getBrushSmooth() {
      return { smooth: isPaintBrushSmooth(), divisor: getPaintBrushSmoothDivisor() };
    },
    setBrushSmooth(on: boolean) {
      if (typeof on !== 'boolean') return { error: 'setBrushSmooth(on): on must be a boolean' };
      setPaintBrushSmooth(on);
      return { smooth: on };
    },
    setBrushSmoothDivisor(divisor: number) {
      if (typeof divisor !== 'number' || !Number.isFinite(divisor)) {
        return { error: `setBrushSmoothDivisor(divisor): divisor must be a finite number in ${SMOOTH_DIVISOR_MIN}..${SMOOTH_DIVISOR_MAX}` };
      }
      setPaintBrushSmoothDivisor(divisor);
      return { divisor: getPaintBrushSmoothDivisor() };
    },

    /** Paint a smooth brush stroke along world-space surface points, subdividing
     *  the mesh under the stroke so the painted edge is rounded (the smooth-brush
     *  equivalent of `paintNear`, but for a swept path and with edge
     *  tessellation). `points` are surface points — obtain them from
     *  `probePixel` against a rendered view. `radius` is in mesh units.
     *  `resolution` is the smoothness detail (target triangle edge = radius /
     *  resolution; higher = smoother + more triangles), default 64, clamped to
     *  2..1024 — the same knob as the UI slider. The painted edge is clipped to
     *  the exact outline, so this only sets how many segments a curve uses;
     *  straight edges are crisp at any setting. `maxEdge` (optional) overrides
     *  it with an absolute target edge length in
     *  mesh units (e.g. `maxEdge: 0.1` for crisp 0.1-unit edges). `shape` is
     *  circle|square|diamond. This MUTATES the working mesh's tessellation
     *  (triangle count grows near the stroke) and is more expensive than the
     *  region selectors — prefer `paintNear`/`paintInBox`/`paintConnected` for
     *  flat-edged fills; use this only when a rounded painted edge matters. */
    paintStroke(opts: {
      points?: number[][];
      radius?: number;
      color?: number[];
      shape?: string;
      resolution?: number;
      maxEdge?: number;
      surface?: string;
      depth?: number;
      name?: string;
    }) {
      if (!currentMeshData) return { error: 'No geometry loaded — run code first, then paint.' };
      if (!opts || typeof opts !== 'object') return { error: 'paintStroke(opts): opts object required' };
      const { points, radius, color, shape, resolution, maxEdge, surface, depth, name } = opts;
      if (!Array.isArray(points) || points.length === 0) {
        return { error: 'paintStroke: points must be a non-empty array of [x,y,z] surface points (use probePixel to get them)' };
      }
      const samples: [number, number, number][] = [];
      for (const p of points) {
        if (!Array.isArray(p) || p.length !== 3 || p.some(n => typeof n !== 'number' || !Number.isFinite(n))) {
          return { error: 'paintStroke: each point must be [x,y,z] of finite numbers' };
        }
        samples.push([p[0], p[1], p[2]]);
      }
      if (typeof radius !== 'number' || !Number.isFinite(radius) || radius <= 0) {
        return { error: 'paintStroke: radius must be a positive finite number (mesh units)' };
      }
      if (!Array.isArray(color) || color.length !== 3 || color.some(c => typeof c !== 'number' || !Number.isFinite(c))) {
        return { error: 'paintStroke: color must be [r,g,b] with each channel in 0..1' };
      }
      if (resolution !== undefined && (typeof resolution !== 'number' || !Number.isFinite(resolution) || resolution <= 0)) {
        return { error: 'paintStroke: resolution must be a positive finite number (radius / resolution = target edge) when provided' };
      }
      if (maxEdge !== undefined && (typeof maxEdge !== 'number' || !Number.isFinite(maxEdge) || maxEdge <= 0)) {
        return { error: 'paintStroke: maxEdge must be a positive finite number (mesh units) when provided' };
      }
      if (surface !== undefined && surface !== 'geodesic' && surface !== 'slab') {
        return { error: "paintStroke: surface must be 'geodesic' or 'slab' when provided" };
      }
      if (depth !== undefined && (typeof depth !== 'number' || !Number.isFinite(depth) || depth < 0)) {
        return { error: 'paintStroke: depth must be a non-negative finite number (mesh units) when provided' };
      }
      const shp: BrushShape = (shape === 'square' || shape === 'diamond') ? shape : 'circle';
      // maxEdge (absolute) overrides; otherwise radius / resolution, default 64
      // (the exact-outline clip keeps edges crisp, so curves need fewer segments).
      const res = Math.max(SMOOTH_DIVISOR_MIN, Math.min(SMOOTH_DIVISOR_MAX, resolution ?? 64));
      // Floor an explicit maxEdge at the same finest edge the resolution path
      // can request (radius / SMOOTH_DIVISOR_MAX). A tinier value just drives
      // runaway subdivision for no visible benefit (the safety ceiling in
      // buildRefinedMesh would cut it off anyway).
      const target = maxEdge !== undefined ? Math.max(maxEdge, radius / SMOOTH_DIVISOR_MAX) : radius / res;
      const descriptor: Extract<RegionDescriptor, { kind: 'brushStroke' }> = {
        kind: 'brushStroke', samples, radius, shape: shp, maxEdge: target,
        surface: (surface as 'geodesic' | 'slab') ?? 'geodesic', depth: depth ?? 0,
      };
      const region = paintBrushStrokeSync(
        typeof name === 'string' && name ? name : `Region ${getRegions().length + 1}`,
        [color[0], color[1], color[2]],
        descriptor,
      );
      if (region.triangles.size === 0) {
        // Drop the empty region through the same sync path so the async
        // reconcile listener doesn't kick a wasted worker rebuild against a
        // stale lastStrokeList.
        withSyncReconcile(() => removeRegion(region.id));
        return { error: 'paintStroke: no surface fell within the stroke footprint — check the points are on the model and the radius is large enough.' };
      }
      return {
        id: region.id,
        name: region.name,
        triangles: region.triangles.size,
        resolution: maxEdge !== undefined ? undefined : res,
        maxEdge: target,
        meshTriangleCount: currentMeshData?.numTri ?? 0,
      };
    },

    /** Geodesic airbrush: spray a soft speckle along world-space surface points.
     *  Coverage fades from the core out via a deterministic per-triangle dither
     *  (each triangle stays one printable colour). Always surface-following — it
     *  never bleeds through a thin/hollow wall. `strength` (0..1, default 0.4) is
     *  the core density, `softness` (0..1, default 0.5) the feather fraction,
     *  `seed` (default 1) makes the speckle reproducible. `shape` is
     *  circle|square|diamond; `resolution`/`maxEdge` set the speckle grain. */
    paintAirbrush(opts: {
      points?: number[][];
      radius?: number;
      color?: number[];
      shape?: string;
      strength?: number;
      softness?: number;
      seed?: number;
      resolution?: number;
      maxEdge?: number;
      name?: string;
    }) {
      if (!currentMeshData) return { error: 'No geometry loaded — run code first, then paint.' };
      if (!opts || typeof opts !== 'object') return { error: 'paintAirbrush(opts): opts object required' };
      const { points, radius, color, shape, strength, softness, seed, resolution, maxEdge, name } = opts;
      if (!Array.isArray(points) || points.length === 0) {
        return { error: 'paintAirbrush: points must be a non-empty array of [x,y,z] surface points (use probePixel to get them)' };
      }
      const samples: [number, number, number][] = [];
      for (const p of points) {
        if (!Array.isArray(p) || p.length !== 3 || p.some(n => typeof n !== 'number' || !Number.isFinite(n))) {
          return { error: 'paintAirbrush: each point must be [x,y,z] of finite numbers' };
        }
        samples.push([p[0], p[1], p[2]]);
      }
      if (typeof radius !== 'number' || !Number.isFinite(radius) || radius <= 0) {
        return { error: 'paintAirbrush: radius must be a positive finite number (mesh units)' };
      }
      if (!Array.isArray(color) || color.length !== 3 || color.some(c => typeof c !== 'number' || !Number.isFinite(c))) {
        return { error: 'paintAirbrush: color must be [r,g,b] with each channel in 0..1' };
      }
      for (const [v, n] of [[strength, 'strength'], [softness, 'softness']] as const) {
        if (v !== undefined && (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 1)) {
          return { error: `paintAirbrush: ${n} must be a number in 0..1 when provided` };
        }
      }
      if (seed !== undefined && (typeof seed !== 'number' || !Number.isFinite(seed))) {
        return { error: 'paintAirbrush: seed must be a finite number when provided' };
      }
      if (resolution !== undefined && (typeof resolution !== 'number' || !Number.isFinite(resolution) || resolution <= 0)) {
        return { error: 'paintAirbrush: resolution must be a positive finite number when provided' };
      }
      if (maxEdge !== undefined && (typeof maxEdge !== 'number' || !Number.isFinite(maxEdge) || maxEdge <= 0)) {
        return { error: 'paintAirbrush: maxEdge must be a positive finite number when provided' };
      }
      const shp: BrushShape = (shape === 'square' || shape === 'diamond') ? shape : 'circle';
      const res = Math.max(SMOOTH_DIVISOR_MIN, Math.min(SMOOTH_DIVISOR_MAX, resolution ?? 96));
      const target = maxEdge !== undefined ? Math.max(maxEdge, radius / SMOOTH_DIVISOR_MAX) : radius / res;
      const spray = {
        strength: strength ?? 0.4,
        softness: softness ?? 0.5,
        seed: seed !== undefined ? (seed | 0) : 1,
      };
      const descriptor: Extract<RegionDescriptor, { kind: 'brushStroke' }> = {
        kind: 'brushStroke', samples, radius, shape: shp, maxEdge: target, surface: 'geodesic', spray,
      };
      const region = paintBrushStrokeSync(
        typeof name === 'string' && name ? name : `Region ${getRegions().length + 1}`,
        [color[0], color[1], color[2]],
        descriptor,
      );
      if (region.triangles.size === 0) {
        // Drop the empty region through the same sync path so the async
        // reconcile listener doesn't kick a wasted worker rebuild against a
        // stale lastStrokeList.
        withSyncReconcile(() => removeRegion(region.id));
        return { error: 'paintAirbrush: no surface was sprayed — check the points are on the model, the radius is large enough, and strength > 0.' };
      }
      return {
        id: region.id,
        name: region.name,
        triangles: region.triangles.size,
        strength: spray.strength,
        softness: spray.softness,
        seed: spray.seed,
        meshTriangleCount: currentMeshData?.numTri ?? 0,
      };
    },

    /** Resolves when no paint subdivision job is in flight on the worker. The
     *  agent paint APIs (`paintStroke`, `paintAirbrush`) already return a
     *  populated region synchronously, so they don't need this — but the
     *  interactive brush (driven by mouse events from a test or external
     *  driver) commits via the async listener path, where the mesh updates a
     *  worker round-trip later. Tests and scripts that drive the canvas
     *  directly `await partwright.waitForPaint()` before reading mesh state. */
    waitForPaint(): Promise<void> {
      return paintIdlePromise();
    },

    /** Test-only knob: how long the progress modal waits before appearing
     *  (default 250ms). Tests that exercise the Cancel button set this to 0
     *  so the modal shows synchronously and the test doesn't depend on the
     *  worker taking >250ms. Returns the previous value. Same modal covers
     *  paint and simplify, so both feature tests use this. */
    __setProgressModalDelay(ms: number): number {
      return __setProgressModalDelayForTests(ms);
    },

    /** Undo the most recent paint operation. The removed region goes onto
     *  a redo stack — `redoLastPaint()` puts it back. Returns the removed
     *  region's metadata, or `{ error }` if nothing to undo. */
    undoLastPaint() {
      // Undoing a refining stroke (brushStroke / smooth slab / smooth box)
      // requires re-refining without it, which the async listener does on
      // its own clock. Wrap so the mesh + remaining region triangles settle
      // before the call returns.
      const region = withSyncReconcile(() => removeLastRegion());
      if (!region) return { error: 'Nothing to undo — no paint operations on the current version.' };
      scheduleColorRefresh();
      syncLockState();
      return {
        undone: true,
        id: region.id,
        name: region.name,
        color: region.color,
        triangles: region.triangles.size,
      };
    },

    /** Redo the most recently undone paint operation. Pairs with
     *  `undoLastPaint()`. */
    redoLastPaint() {
      const region = withSyncReconcile(() => redoLastRegion());
      if (!region) return { error: 'Nothing to redo — call undoLastPaint() first.' };
      scheduleColorRefresh();
      syncLockState();
      return {
        redone: true,
        id: region.id,
        name: region.name,
        color: region.color,
        triangles: region.triangles.size,
      };
    },

    /** Query triangles on the current mesh by geometric or color filters.
     *  Returns `{ triangleIds, count, sampled }` so the result can be passed
     *  directly to `paintFaces({ triangleIds, color })`.
     *
     *  Filters (all optional, ANDed together):
     *  - `box`: `{ min: [x,y,z], max: [x,y,z] }` — triangle centroid lies inside
     *  - `normal`: `[nx,ny,nz]` — triangle normal aligns within `normalTolerance`
     *  - `normalTolerance`: cosine threshold (default `0.95`, ≈18°)
     *  - `color`: `[r,g,b]` — triangle is currently painted this color (RGB 0..1, matched to ±0.01)
     *  - `region`: number — only triangles inside the listRegions() entry with this `id`
     *  - `maxResults`: cap output (default `5000`)
     */
    findFaces(opts: {
      box?: { min: [number, number, number]; max: [number, number, number] };
      normal?: [number, number, number];
      normalTolerance?: number;
      color?: [number, number, number];
      region?: number;
      maxResults?: number;
      /** See paintInBox.coverageMode. Applies to the `box` predicate
       *  only; the normal / color / region predicates are per-triangle
       *  already. */
      coverageMode?: CoverageMode;
      /** See paintInBox.maxTriangleArea. */
      maxTriangleArea?: number;
    } = {}) {
      if (!currentMeshData) return { error: 'No geometry loaded' };
      if (typeof opts !== 'object' || opts === null) {
        return { error: 'findFaces requires an options object — see /ai.md#color-regions' };
      }

      const { box, normal, normalTolerance, color, region, maxResults, coverageMode, maxTriangleArea } = opts;
      const coverageErr = validateCoverageMode(coverageMode);
      if (coverageErr) return { error: coverageErr };
      const areaErr = validateMaxTriangleArea(maxTriangleArea);
      if (areaErr) return { error: areaErr };

      let boxMin: [number, number, number] | null = null;
      let boxMax: [number, number, number] | null = null;
      if (box !== undefined) {
        if (typeof box !== 'object' || box === null || !Array.isArray(box.min) || !Array.isArray(box.max)) {
          return { error: 'findFaces.box must be { min: [x,y,z], max: [x,y,z] }' };
        }
        if (box.min.length !== 3 || box.max.length !== 3) {
          return { error: 'findFaces.box.min/max must be 3-tuples' };
        }
        boxMin = box.min as [number, number, number];
        boxMax = box.max as [number, number, number];
        for (let i = 0; i < 3; i++) {
          if (!Number.isFinite(boxMin[i]) || !Number.isFinite(boxMax[i])) {
            return { error: 'findFaces.box values must be finite numbers' };
          }
          if (boxMin[i] > boxMax[i]) return { error: `findFaces.box.min[${i}] (${boxMin[i]}) must be <= box.max[${i}] (${boxMax[i]})` };
        }
      }

      let nrm: [number, number, number] | null = null;
      if (normal !== undefined) {
        if (!Array.isArray(normal) || normal.length !== 3) return { error: 'findFaces.normal must be [nx,ny,nz]' };
        const [nx, ny, nz] = normal;
        const len = Math.hypot(nx, ny, nz);
        if (!Number.isFinite(len) || len === 0) return { error: 'findFaces.normal must be a non-zero 3-vector' };
        nrm = [nx / len, ny / len, nz / len];
      }

      const cosTol = normalTolerance ?? 0.95;
      if (typeof cosTol !== 'number' || !Number.isFinite(cosTol)) {
        return { error: 'findFaces.normalTolerance must be a finite number in [-1, 1]' };
      }

      let colorTarget: [number, number, number] | null = null;
      if (color !== undefined) {
        if (!Array.isArray(color) || color.length !== 3) return { error: 'findFaces.color must be [r,g,b] with values 0..1' };
        colorTarget = [color[0], color[1], color[2]];
      }

      let regionTriangles: Set<number> | null = null;
      if (region !== undefined) {
        if (typeof region !== 'number' || !Number.isInteger(region)) {
          return { error: 'findFaces.region must be a region id (integer) from listRegions()' };
        }
        const found = getRegions().find(r => r.id === region);
        if (!found) return { error: `findFaces.region: no region with id=${region}. Use listRegions() to see ids.` };
        regionTriangles = found.triangles;
      }

      const limit = maxResults ?? 5000;
      if (typeof limit !== 'number' || !Number.isInteger(limit) || limit <= 0) {
        return { error: 'findFaces.maxResults must be a positive integer' };
      }

      const mesh = currentMeshData;
      const adjacency = nrm ? buildAdjacency(mesh) : null;
      const triColors = colorTarget ? (buildTriColors(mesh.numTri) ?? new Uint8Array(mesh.numTri * 3)) : null;

      const result: number[] = [];
      let visited = 0;

      const cR = colorTarget ? Math.round(colorTarget[0] * 255) : 0;
      const cG = colorTarget ? Math.round(colorTarget[1] * 255) : 0;
      const cB = colorTarget ? Math.round(colorTarget[2] * 255) : 0;

      const coverage: CoverageMode = coverageMode ?? 'centroid';
      for (let t = 0; t < mesh.numTri; t++) {
        if (regionTriangles && !regionTriangles.has(t)) continue;

        if (boxMin && boxMax) {
          const v0 = mesh.triVerts[t * 3];
          const v1 = mesh.triVerts[t * 3 + 1];
          const v2 = mesh.triVerts[t * 3 + 2];
          const ax = mesh.vertProperties[v0 * mesh.numProp],     ay = mesh.vertProperties[v0 * mesh.numProp + 1], az = mesh.vertProperties[v0 * mesh.numProp + 2];
          const bx = mesh.vertProperties[v1 * mesh.numProp],     by = mesh.vertProperties[v1 * mesh.numProp + 1], bz = mesh.vertProperties[v1 * mesh.numProp + 2];
          const cx = mesh.vertProperties[v2 * mesh.numProp],     cy = mesh.vertProperties[v2 * mesh.numProp + 1], cz = mesh.vertProperties[v2 * mesh.numProp + 2];
          const inA = ax >= boxMin[0] && ax <= boxMax[0] && ay >= boxMin[1] && ay <= boxMax[1] && az >= boxMin[2] && az <= boxMax[2];
          const inB = bx >= boxMin[0] && bx <= boxMax[0] && by >= boxMin[1] && by <= boxMax[1] && bz >= boxMin[2] && bz <= boxMax[2];
          const inC = cx >= boxMin[0] && cx <= boxMax[0] && cy >= boxMin[1] && cy <= boxMax[1] && cz >= boxMin[2] && cz <= boxMax[2];
          if (coverage === 'fully_inside') {
            if (!inA || !inB || !inC) continue;
          } else if (coverage === 'any_vertex_inside') {
            if (!inA && !inB && !inC) continue;
          } else {
            const ccx = (ax + bx + cx) / 3, ccy = (ay + by + cy) / 3, ccz = (az + bz + cz) / 3;
            if (ccx < boxMin[0] || ccx > boxMax[0] || ccy < boxMin[1] || ccy > boxMax[1] || ccz < boxMin[2] || ccz > boxMax[2]) continue;
          }
        }

        if (nrm && adjacency) {
          const nx = adjacency.normals[t * 3];
          const ny = adjacency.normals[t * 3 + 1];
          const nz = adjacency.normals[t * 3 + 2];
          const dot = nrm[0] * nx + nrm[1] * ny + nrm[2] * nz;
          if (dot < cosTol) continue;
        }

        if (triColors) {
          if (triColors[t * 3] !== cR || triColors[t * 3 + 1] !== cG || triColors[t * 3 + 2] !== cB) continue;
        }

        if (maxTriangleArea !== undefined && triangleArea(t, mesh) > maxTriangleArea) continue;

        visited++;
        if (result.length < limit) result.push(t);
      }

      return {
        triangleIds: result,
        count: result.length,
        matched: visited,
        truncated: visited > result.length,
      };
    },

    /** Summarize the mesh as a list of coplanar face groups, sorted by
     *  triangle count descending. Each group reports a centroid, area-weighted
     *  normal, area, bounding box, and a sample of triangle ids. Use this to
     *  pick paint targets procedurally without trial-and-error point placement.
     *
     *  Options:
     *  - `tolerance`: cosine bend threshold (default `0.9995`, ≈1.8°)
     *  - `minTriangles`: skip groups smaller than this (default `1`)
     *  - `maxTrianglesPerGroup`: cap reported triangleIds per group (default `64`, `0` to omit)
     *  - `maxGroups`: cap number of returned groups (default `256`, `0` for unlimited)
     */
    getMeshSummary(opts?: { tolerance?: number; minTriangles?: number; maxTrianglesPerGroup?: number; maxGroups?: number }) {
      if (!currentMeshData) return { error: 'No geometry loaded' };
      const o = opts ?? {};
      if (o.tolerance !== undefined && (typeof o.tolerance !== 'number' || !Number.isFinite(o.tolerance))) {
        return { error: 'getMeshSummary.tolerance must be a finite number in [-1, 1]' };
      }
      if (o.minTriangles !== undefined && (typeof o.minTriangles !== 'number' || !Number.isInteger(o.minTriangles) || o.minTriangles < 1)) {
        return { error: 'getMeshSummary.minTriangles must be a positive integer' };
      }
      if (o.maxTrianglesPerGroup !== undefined && (typeof o.maxTrianglesPerGroup !== 'number' || !Number.isInteger(o.maxTrianglesPerGroup) || o.maxTrianglesPerGroup < 0)) {
        return { error: 'getMeshSummary.maxTrianglesPerGroup must be a non-negative integer' };
      }
      if (o.maxGroups !== undefined && (typeof o.maxGroups !== 'number' || !Number.isInteger(o.maxGroups) || o.maxGroups < 0)) {
        return { error: 'getMeshSummary.maxGroups must be a non-negative integer' };
      }

      const summary = computeFaceGroups(currentMeshData, o);

      // Optional bbox filter — agents painting one feature of a complex
      // model can pass `withinBox` to get only the groups in that region.
      // Cheap to compute (we already have group bboxes); keeps the per-
      // group `triangleIds` payload from drowning the response in groups
      // the agent doesn't care about.
      let groups = summary.groups;
      const within = (opts as { withinBox?: { min?: unknown; max?: unknown } } | undefined)?.withinBox;
      if (within && typeof within === 'object') {
        const min = within.min as [number, number, number] | undefined;
        const max = within.max as [number, number, number] | undefined;
        if (Array.isArray(min) && min.length === 3 && Array.isArray(max) && max.length === 3) {
          groups = groups.filter(g => bboxesIntersect(g.bbox, { min, max }));
        }
      }

      return {
        groups,
        totalTriangles: summary.totalTriangles,
        groupCount: groups.length,
        tolerance: summary.tolerance,
        ...(groups.length < summary.groups.length ? { unfiltered: summary.groups.length } : {}),
      };
    },

    /** Paint a single boolean-distinct component by index from
     *  `listComponents()`. Convenience wrapper that runs decompose, pulls
     *  the component's bounding box, and calls paintInBox in one round
     *  trip. Use this when you already know "the 3rd unioned part is the
     *  mouth, paint it red" — saves the listComponents → paintInBox
     *  two-call dance. */
    paintComponent(opts: {
      index: number;
      color: [number, number, number];
      name?: string;
      /** Inherits the same topOnly shortcut as paintInBox. */
      topOnly?: boolean;
    }) {
      if (!opts || typeof opts !== 'object') return { error: 'paintComponent requires { index, color }' };
      if (!Number.isInteger(opts.index) || opts.index < 0) return { error: 'paintComponent.index must be a non-negative integer (from listComponents)' };
      if (!Array.isArray(opts.color) || opts.color.length !== 3) return { error: 'color must be [r,g,b] with values 0..1' };
      if (!currentManifold) return { error: 'No geometry loaded — run code first.' };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let parts: any[] | null = null;
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        parts = currentManifold.decompose() as any[];
        if (opts.index >= parts.length) {
          return { error: `paintComponent.index ${opts.index} out of range — listComponents has ${parts.length} component(s).` };
        }
        const bb = getBoundingBox(parts[opts.index]);
        if (!bb) return { error: `Component ${opts.index} has no bounding box (degenerate geometry?).` };
        // Pad the box slightly so a flat coplanar boundary doesn't miss
        // triangles whose centroid lies exactly on the edge.
        const pad = 1e-4;
        const box = {
          min: [bb.min[0] - pad, bb.min[1] - pad, bb.min[2] - pad] as [number, number, number],
          max: [bb.max[0] + pad, bb.max[1] + pad, bb.max[2] + pad] as [number, number, number],
        };
        return partwrightAPI.paintInBox({ box, color: opts.color, name: opts.name ?? `Component ${opts.index}`, topOnly: opts.topOnly });
      } catch (err) {
        return { error: `paintComponent failed: ${err instanceof Error ? err.message : String(err)}` };
      } finally {
        if (parts) for (const p of parts) { try { p.delete(); } catch { /* noop */ } }
      }
    },

    /** Token-cheap planning aid for paint workflows: returns just the
     *  centroid + normal + bbox of each coplanar face group, no triangle
     *  IDs. Same as `getMeshSummary({maxTrianglesPerGroup: 0, maxGroups})`
     *  but a one-liner that signals "I'm planning, not painting yet". */
    getFeatureCentroids(opts?: { maxGroups?: number; withinBox?: { min: [number, number, number]; max: [number, number, number] } }) {
      const maxGroups = Math.max(1, opts?.maxGroups ?? 32);
      return partwrightAPI.getMeshSummary({ maxTrianglesPerGroup: 0, maxGroups, ...(opts?.withinBox ? { withinBox: opts.withinBox } : {}) });
    },

    /** Decompose the current manifold into its boolean-distinct components
     *  and return per-component metadata: `{index, centroid, boundingBox,
     *  volume, surfaceArea}`. The killer use case is "paint each feature
     *  of a unioned model" — for a smiley face built from a head + two
     *  eyes + a mouth, this returns 4 components with their bboxes, and
     *  the agent can then call `paintInBox({box: component.boundingBox,
     *  color})` for each, with no coordinate guessing. */
    listComponents() {
      if (!currentManifold) return { error: 'No geometry loaded — run code first.' };
      try {
        const parts = currentManifold.decompose();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const components = parts.map((p: any, i: number) => {
          const bb = getBoundingBox(p);
          const vol = (() => { try { return p.volume(); } catch { return 0; } })();
          const sa = (() => { try { return p.surfaceArea(); } catch { return 0; } })();
          const centroid: [number, number, number] = bb
            ? [(bb.min[0] + bb.max[0]) / 2, (bb.min[1] + bb.max[1]) / 2, (bb.min[2] + bb.max[2]) / 2]
            : [0, 0, 0];
          p.delete();
          return {
            index: i,
            volume: Math.round(vol * 100) / 100,
            surfaceArea: Math.round(sa * 100) / 100,
            centroid,
            boundingBox: bb ?? { min: [0, 0, 0], max: [0, 0, 0] },
          };
        });
        return { count: components.length, components };
      } catch (err) {
        return { error: `decompose failed: ${err instanceof Error ? err.message : String(err)}` };
      }
    },

    /** List labels registered by `api.label(shape, name)` in the current
     *  run's code. Returns `[{name, triangleCount, bbox}]`. The triangle
     *  buckets survive boolean ops cleanly (manifold-3d propagates the
     *  originalID of every input through `runOriginalID` on the result
     *  mesh) — so for a model built as
     *  `api.label(head, 'head').add(api.label(eye, 'eye'))` you get one
     *  entry per labelled piece, no matter how they overlap. Empty list
     *  when the code didn't use `api.label`. */
    listLabels() {
      if (!currentMeshData) return { error: 'No geometry loaded — run code first.' };
      if (!currentLabelMap || currentLabelMap.size === 0) return { count: 0, labels: [] };
      const mesh = currentMeshData;
      const labels = [...currentLabelMap.entries()].map(([name, ids]) => {
        const stats = regionTriangleStats(ids, mesh);
        return {
          name,
          triangleCount: ids.size,
          bbox: stats.bbox,
          centroid: stats.centroid,
        };
      });
      return { count: labels.length, labels };
    },

    /** Paint a labelled feature by name. The label must have been
     *  registered in the current run's code via `api.label(shape, name)`
     *  or `api.labeledUnion([{name, shape}, ...])`. This is the cleanest
     *  paint primitive on agent-authored geometry — no coordinate
     *  guessing, no bounding-box estimation, no fan-bleed: the
     *  triangle set comes straight from manifold-3d's provenance
     *  tracking and is exact even for overlapping inputs.
     *
     *  ```
     *  // In user code:
     *  return api.label(Manifold.sphere(10), 'head')
     *    .add(api.label(Manifold.sphere(2).translate([3, 5, 7]), 'eyeL'));
     *
     *  // After running:
     *  partwright.paintByLabel({ label: 'eyeL', color: [0, 0, 1] });
     *  ```
     *  Returns `{ id, name, triangles, bbox, centroid }` on success or
     *  `{ error }` if no such label exists or no labels were registered. */
    paintByLabel(opts: { label: string; color: [number, number, number]; name?: string; topOnly?: boolean; normalCone?: { axis: [number, number, number]; angleDeg: number } }) {
      if (!opts || typeof opts !== 'object') return { error: 'paintByLabel requires { label, color }' };
      if (typeof opts.label !== 'string' || opts.label.length === 0) return { error: 'paintByLabel.label must be a non-empty string' };
      if (!Array.isArray(opts.color) || opts.color.length !== 3) return { error: 'paintByLabel.color must be [r,g,b] in 0..1' };
      if (!currentMeshData) return { error: 'No geometry loaded — run code first.' };
      if (!currentLabelMap || currentLabelMap.size === 0) {
        return { error: 'No labels registered in the current run. Either wrap features with api.label(shape, "name") in your code, then runAndSave, then call paintByLabel — or, if you cannot edit the code, paint by coordinates instead: paintInBox / paintComponent (after listComponents) / paintConnected (after probePixel on a render).' };
      }
      const ids = currentLabelMap.get(opts.label);
      if (!ids || ids.size === 0) {
        const known = [...currentLabelMap.keys()].map(k => `"${k}"`).join(', ');
        return { error: `paintByLabel: no label "${opts.label}". Known labels: ${known}.` };
      }
      const mesh = currentMeshData;
      const regionName = opts.name ?? opts.label;
      const cone = resolvePaintCone(opts.normalCone, opts.topOnly);
      if (cone) {
        // Filter the label's triangle set by normal direction. Use a
        // triangles descriptor (not byLabel) so the exact filtered set
        // is preserved on re-hydration rather than restoring the full set.
        const adjacency = buildAdjacency(mesh);
        const axLen = Math.hypot(cone.axis[0], cone.axis[1], cone.axis[2]);
        const cax = cone.axis[0] / axLen, cay = cone.axis[1] / axLen, caz = cone.axis[2] / axLen;
        const coneCos = Math.cos(cone.angleDeg * Math.PI / 180);
        const filtered = new Set<number>();
        for (const t of ids) {
          const dot = cax * adjacency.normals[t * 3] + cay * adjacency.normals[t * 3 + 1] + caz * adjacency.normals[t * 3 + 2];
          if (dot >= coneCos) filtered.add(t);
        }
        if (filtered.size === 0) {
          return { error: `paintByLabel: label "${opts.label}" matched ${ids.size} triangles but none passed the ${opts.topOnly ? 'topOnly' : 'normalCone'} filter. Try widening angleDeg or removing the filter.` };
        }
        return commitPaintFromSet(filtered, opts.color as [number, number, number], regionName, 'paintbrush');
      }
      const triangles = new Set(ids);
      const region = addRegion(
        regionName,
        opts.color as [number, number, number],
        'paintbrush',
        { kind: 'byLabel', label: opts.label },
        triangles,
      );
      scheduleColorRefresh();
      syncLockState();
      const stats = regionTriangleStats(triangles, mesh);
      return { id: region.id, name: region.name, triangles: triangles.size, bbox: stats.bbox, centroid: stats.centroid };
    },

    /** Batch sibling of `paintByLabel`. Paints N labelled features in
     *  one call, collapsing what would otherwise be N round-trips into
     *  a single tool invocation. The viewport refresh fires once (the
     *  existing `scheduleColorRefresh` rAF coalescing absorbs the
     *  individual commits), so a 9-feature smiley paints in one frame
     *  instead of nine.
     *
     *  Returns `{ results: [...], failed: [{label, error}] }`. Each
     *  entry in `results` is the same shape `paintByLabel` returns; an
     *  empty `failed` array means every label resolved.
     *
     *  ```
     *  partwright.paintByLabels([
     *    { label: 'head',  color: [0.4, 0.7, 0.4] },
     *    { label: 'eyeL',  color: [0,   0,   0  ] },
     *    { label: 'eyeR',  color: [0,   0,   0  ] },
     *    { label: 'mouth', color: [0.8, 0.2, 0.2] },
     *  ]);
     *  ``` */
    paintByLabels(items: Array<{ label: string; color: [number, number, number]; name?: string; topOnly?: boolean; normalCone?: { axis: [number, number, number]; angleDeg: number } }>) {
      if (!Array.isArray(items)) return { error: 'paintByLabels requires an array of { label, color, name?, topOnly?, normalCone? }' };
      if (items.length === 0) return { results: [], failed: [] };
      if (!currentMeshData) return { error: 'No geometry loaded — run code first.' };
      if (!currentLabelMap || currentLabelMap.size === 0) {
        return { error: 'No labels registered in the current run. Either wrap features with api.label(shape, "name") in your code, then runAndSave, then call paintByLabels — or, if you cannot edit the code, paint by coordinates instead: paintInBox / paintComponent (after listComponents) / paintConnected (after probePixel on a render).' };
      }
      const results: Array<Record<string, unknown>> = [];
      const failed: Array<{ label: string; error: string }> = [];
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (!item || typeof item !== 'object') {
          failed.push({ label: `(item ${i})`, error: 'each entry must be { label, color, name? }' });
          continue;
        }
        const r = partwrightAPI.paintByLabel(item) as Record<string, unknown>;
        if (r && typeof r === 'object' && 'error' in r) {
          failed.push({ label: typeof item.label === 'string' ? item.label : `(item ${i})`, error: String(r.error) });
        } else {
          results.push(r);
        }
      }
      return { results, failed };
    },

    // === Annotations API ===

    /** List all freehand annotation strokes drawn on the model surface.
     *  Each stroke includes its surface-projected polyline points and color. */
    listAnnotations() {
      return getAnnotationStrokes().map(s => ({
        id: s.id,
        color: s.color,
        width: s.width,
        pointCount: s.points.length,
        points: s.points.map(p => [
          Math.round(p.x * 1000) / 1000,
          Math.round(p.y * 1000) / 1000,
          Math.round(p.z * 1000) / 1000,
        ] as [number, number, number]),
        camera: s.camera,
      }));
    },

    /** List all pinned text-label annotations on the model. */
    listTextAnnotations() {
      return getAnnotationTexts().map(t => ({
        id: t.id,
        text: t.text,
        color: t.color,
        fontSizePx: t.fontSizePx,
        anchor: [
          Math.round(t.anchor.x * 1000) / 1000,
          Math.round(t.anchor.y * 1000) / 1000,
          Math.round(t.anchor.z * 1000) / 1000,
        ] as [number, number, number],
        camera: t.camera,
      }));
    },

    /** Total number of annotations (strokes + text labels). */
    getAnnotationCount() {
      return getAnnotationCount();
    },

    /** Remove the most recently added annotation (stroke or text). */
    undoAnnotation() {
      const removed = removeLastAnnotation() !== null;
      return { removed, remaining: getAnnotationCount() };
    },

    /** Remove a specific annotation by id. */
    removeAnnotation(id: string) {
      assertString(id, 'removeAnnotation(id)');
      const removed = removeAnnotationById(id);
      return { removed: removed !== null, remaining: getAnnotationCount() };
    },

    /** Remove all annotations (strokes and text labels). */
    clearAnnotations() {
      const previous = getAnnotationCount();
      clearAllAnnotations();
      return { cleared: previous };
    },

    /** Remove all freehand strokes (keeps text labels). */
    clearAnnotationStrokes() {
      const before = getAnnotationStrokes().length;
      clearStrokesStore();
      return { cleared: before };
    },

    /** Remove all text labels (keeps freehand strokes). */
    clearTextAnnotations() {
      const before = getAnnotationTexts().length;
      clearTextsStore();
      return { cleared: before };
    },

    /** Add a text-label annotation at a 3D anchor point on the model.
     *  `anchor` is [x, y, z] in world coords. Text is shown as a screen-facing
     *  label and survives orbiting. Color (RGB 0..1) and fontSizePx are optional. */
    addTextAnnotation(opts: {
      anchor: [number, number, number];
      text: string;
      color?: [number, number, number];
      fontSizePx?: number;
    }) {
      const o = assertObject(opts, 'addTextAnnotation(opts)');
      if (!o) return { error: 'addTextAnnotation requires {anchor, text, color?, fontSizePx?}' };
      assertNoUnknownKeys(o, ['anchor', 'text', 'color', 'fontSizePx'], 'addTextAnnotation(opts)');
      assertString(o.text, 'addTextAnnotation(opts).text', { allowEmpty: false });
      if (!Array.isArray(o.anchor) || o.anchor.length !== 3) {
        return { error: 'addTextAnnotation(opts).anchor must be [x, y, z]' };
      }
      for (const c of o.anchor as number[]) {
        if (typeof c !== 'number' || !Number.isFinite(c)) {
          return { error: 'anchor components must be finite numbers' };
        }
      }
      if (o.color !== undefined) {
        if (!Array.isArray(o.color) || o.color.length !== 3) return { error: 'color must be [r, g, b] in 0..1' };
        for (const c of o.color as number[]) {
          if (typeof c !== 'number' || c < 0 || c > 1 || !Number.isFinite(c)) {
            return { error: 'color components must be finite numbers in 0..1' };
          }
        }
      }
      if (o.fontSizePx !== undefined) assertNumber(o.fontSizePx, 'addTextAnnotation(opts).fontSizePx', { min: 4, max: 256 });

      const ann = addTextAnnotationAtAnchor({
        anchor: o.anchor as [number, number, number],
        text: o.text as string,
        color: o.color as [number, number, number] | undefined,
        fontSizePx: o.fontSizePx as number | undefined,
      });
      return { id: ann.id };
    },

    /** Set the default font size (pixels) for new text annotations. */
    setAnnotationFontSize(px: number) {
      assertNumber(px, 'setAnnotationFontSize(px)', { min: 4, max: 256 });
      setAnnotateFontSize(px);
      return { fontSizePx: px };
    },

    /** Get the current default font size (pixels) for new text annotations. */
    getAnnotationFontSize() {
      return getAnnotateFontSize();
    },

    /** Snap the camera to the angle the given annotation was originally
     *  drawn from. Useful when reviewing where an annotation belongs. */
    restoreAnnotationView(id: string) {
      assertString(id, 'restoreAnnotationView(id)');
      const ok = restoreAnnotationViewById(id);
      return ok ? { restored: true } : { error: `No annotation with id ${id}` };
    },

    /** Show or hide annotations without removing them.
     *  When hidden, annotations are excluded from renderView/multiview/elevation output. */
    setAnnotationsVisible(visible: boolean) {
      assertBoolean(visible, 'setAnnotationsVisible(visible)');
      setAnnotationsVisibleOverlay(visible);
      return { visible };
    },

    /** Whether annotations are currently visible. */
    areAnnotationsVisible() {
      return isAnnotationsVisibleOverlay();
    },

    /** Set the active drawing color for new annotation strokes. RGB in 0..1. */
    setAnnotationColor(color: [number, number, number]) {
      if (!Array.isArray(color) || color.length !== 3) {
        return { error: 'setAnnotationColor requires [r, g, b] in 0..1' };
      }
      for (const c of color) {
        if (typeof c !== 'number' || c < 0 || c > 1 || !Number.isFinite(c)) {
          return { error: 'color components must be finite numbers in 0..1' };
        }
      }
      setAnnotateColor([color[0], color[1], color[2]]);
      return { color };
    },

    /** Set the active drawing line width (pixels) for new annotation strokes.
     *  Existing strokes keep their original width. */
    setAnnotationWidth(width: number) {
      assertNumber(width, 'setAnnotationWidth(width)', { min: 0.5, max: 64 });
      setAnnotateWidth(width);
      return { width };
    },

    /** Get the active drawing line width (pixels). */
    getAnnotationWidth() {
      return getAnnotateWidth();
    },

    /** Self-documenting help -- returns structured object and logs readable summary */
    help(method?: string): Record<string, unknown> {
      assertString(method, 'help(method)', { optional: true, allowEmpty: false });
      const methods: Record<string, { signature: string; docs: string }> = {
        // Core
        'run':             { signature: 'run(code?) -- Run code, update views, return geometry stats', docs: '/ai.md#console-api--windowpartwright' },
        'getGeometryData': { signature: 'getGeometryData() -- Current stats as JSON object', docs: '/ai.md#geometry-data' },
        'validate':        { signature: 'validate(code) -- Check code without rendering -> {valid, error?}', docs: '/ai.md#console-api--windowpartwright' },
        'getCode':         { signature: 'getCode() -- Read editor contents', docs: '/ai.md#console-api--windowpartwright' },
        'setCode':         { signature: 'setCode(code) -- Set editor contents (no auto-run)', docs: '/ai.md#console-api--windowpartwright' },
        // Isolated execution
        'runIsolated':     { signature: 'await runIsolated(code) -- Test without side effects -> {geometryData, thumbnail}', docs: '/ai.md#testing-without-side-effects' },
        'runAndAssert':    { signature: 'await runAndAssert(code, assertions) -- Validate geometry -> {passed, failures?, stats}', docs: '/ai.md#assertions----structured-validation' },
        'runAndExplain':   { signature: 'await runAndExplain(code) -- Debug disconnected components -> {stats, components[], hints[]}', docs: '/ai.md#debugging-disconnected-components' },
        'modifyAndTest':   { signature: 'await modifyAndTest(patchFn, assertions?) -- Modify + test without committing -> {modifiedCode, codeDiff, stats, passed?}', docs: '/ai.md#modify-and-test' },
        'query':           { signature: 'query({sliceAt?, decompose?, boundingBox?}) -- Multi-query current geometry', docs: '/ai.md#multi-query-current-geometry' },
        // Sessions
        'createSession':   { signature: 'await createSession(name?) -- Create session -> {id, url, galleryUrl}', docs: '/ai.md#console-api--windowpartwright' },
        'runAndSave':      { signature: 'await runAndSave(code, label?, assertions?) -- Assert + save version in one call', docs: '/ai.md#assert--save-in-one-call' },
        'saveVersion':     { signature: 'await saveVersion(label?) -- Save current state as version', docs: '/ai.md#console-api--windowpartwright' },
        'listVersions':    { signature: 'await listVersions() -- List all versions in session', docs: '/ai.md#console-api--windowpartwright' },
        'loadVersion':     { signature: 'await loadVersion({index} | {id}) -- Load version into editor -> {id, index, label, code, geometryData} or {error}', docs: '/ai.md#console-api--windowpartwright' },
        'forkVersion':     { signature: 'await forkVersion({index} | {id}, transformFn, label?, assertions?, carryColors=true) -- Load + modify + validate + save in one call; carries parent colors -> {..., codeDiff, colors}', docs: '/ai.md#forking-a-prior-version' },
        'copyColorsFromVersion': { signature: 'await copyColorsFromVersion({index} | {id}) -- Re-apply a prior version\'s color regions onto the current mesh -> {source, carried, dropped}', docs: '/ai.md#forking-a-prior-version' },
        'openSession':     { signature: 'await openSession(id) -- Open existing session', docs: '/ai.md#resuming-a-session' },
        'listSessions':    { signature: 'await listSessions() -- List all sessions', docs: '/ai.md#console-api--windowpartwright' },
        'getSessionContext': { signature: 'await getSessionContext() -- Get full session context (for resuming)', docs: '/ai.md#resuming-a-session' },
        // Parts (multiple objects per session)
        'listParts':       { signature: 'listParts() -- List parts in the session -> [{id, name, order, isCurrent}]', docs: '/ai.md#console-api--windowpartwright' },
        'getCurrentPart':  { signature: 'getCurrentPart() -- Active part -> {id, name, order} or null', docs: '/ai.md#console-api--windowpartwright' },
        'createPart':      { signature: 'await createPart(name?) -- New empty part + switch to it -> {id, name, order}', docs: '/ai.md#console-api--windowpartwright' },
        'changePart':      { signature: 'await changePart(id) -- Switch active part (loads its latest version)', docs: '/ai.md#console-api--windowpartwright' },
        'renamePart':      { signature: 'await renamePart(id, name) -- Rename a part', docs: '/ai.md#console-api--windowpartwright' },
        'deletePart':      { signature: 'await deletePart(id) -- Delete a part and its versions', docs: '/ai.md#console-api--windowpartwright' },
        'getGalleryUrl':   { signature: 'getGalleryUrl() -- URL for gallery view (human review)', docs: '/ai.md#console-api--windowpartwright' },
        // Notes
        'addSessionNote':  { signature: 'await addSessionNote(text) -- Add note with [PREFIX] tag', docs: '/ai.md#session-notes----tracking-design-context' },
        'listSessionNotes': { signature: 'await listSessionNotes() -- List all session notes', docs: '/ai.md#session-notes----tracking-design-context' },
        // Inspection
        'sliceAtZ':        { signature: 'sliceAtZ(z) -- Cross-section at height -> {polygons, svg, area}', docs: '/ai.md#console-api--windowpartwright' },
        'getBoundingBox':  { signature: 'getBoundingBox() -- -> {min, max}', docs: '/ai.md#console-api--windowpartwright' },
        'renderSection':   { signature: 'renderSection({axis?, offset?, size?}) -- Slice current model on any axis -> {dataUrl, svg, axis, offset, area, contours}. Engine-agnostic.', docs: '/ai.md#console-api--windowpartwright' },
        'componentBounds': { signature: 'componentBounds() -- Per-connected-component info: [{index, volume, triangleCount, bbox}], largest first. Engine-agnostic.', docs: '/ai.md#console-api--windowpartwright' },
        'pointInside':     { signature: 'pointInside([x,y,z]) -- Is this point inside the current solid? -> boolean | null. Engine-agnostic.', docs: '/ai.md#console-api--windowpartwright' },
        'healCurrent':     { signature: 'healCurrent({tolerance?}) -- Simplify + apply: collapses near-degenerate edges, re-runs cleanup -> {ok, volumeDelta, triangleDelta, componentCountBefore, componentCountAfter}. Engine-agnostic.', docs: '/ai.md#console-api--windowpartwright' },
        'renderView':      { signature: 'renderView({elevation?, azimuth?, ortho?, size?, edges?: "none"|"crease"|"wireframe"}) -- Render from any angle -> data URL (default/cap size follows spending mode; edges default "crease")', docs: '/ai.md#visual-verification' },
        'renderViews':     { signature: 'await renderViews({views?: "tri"|"all", size?, edges?: "none"|"crease"|"wireframe"}) -- 3- or 4-angle labeled composite -> data URL. Use for verification when one angle could hide errors.', docs: '/ai.md#visual-verification' },
        // Spending mode (AI budget)
        'getSpendingMode': { signature: 'getSpendingMode() -- Read the AI budget (preset + thinking/vision/paint/notes/caps); respect it', docs: '/ai.md#spending-mode' },
        'setSpendingMode': { signature: 'setSpendingMode("cheap"|"balanced"|"expensive") -- Set the AI budget preset', docs: '/ai.md#spending-mode' },
        'analyzeProfile':  { signature: 'analyzeProfile(sampleCount?) -- Z-profile feature summary', docs: '/ai.md#console-api--windowpartwright' },
        'measureAt':       { signature: 'measureAt([x,y]) -- Ray-cast probe at XY -> {hits, thickness, topZ, bottomZ}', docs: '/ai.md#console-api--windowpartwright' },
        'probePixel':      { signature: 'probePixel({pixel: [x,y], view}) -- Translate a pixel in a rendered view back to a surface hit: {point, normal, distance, triangleId, nextStep}. The view spec must match the renderView call. On a background pixel returns {hit:false, modelPixelBounds, reason, hint} telling you where the model projects so you can re-aim.', docs: '/ai.md#console-api--windowpartwright' },
        // Viewport controls
        'setGridVisible':       { signature: 'setGridVisible(on?) -- Show/hide grid plane (omit to toggle) -> boolean', docs: '/ai.md#viewport-controls' },
        'isGridVisible':        { signature: 'isGridVisible() -- Whether grid plane is visible', docs: '/ai.md#viewport-controls' },
        'setDimensionsVisible': { signature: 'setDimensionsVisible(on?) -- Show/hide bounding box dimensions (omit to toggle) -> boolean', docs: '/ai.md#viewport-controls' },
        'areDimensionsVisible': { signature: 'areDimensionsVisible() -- Whether dimensions overlay is visible', docs: '/ai.md#viewport-controls' },
        'setOrbitLock':         { signature: 'setOrbitLock(on?) -- Lock/unlock camera rotation (omit to toggle) -> boolean', docs: '/ai.md#viewport-controls' },
        'isOrbitLocked':        { signature: 'isOrbitLocked() -- Whether camera orbit is locked', docs: '/ai.md#viewport-controls' },
        'setTheme':             { signature: 'setTheme("dark"|"light") -- Set color theme', docs: '/ai.md#viewport-controls' },
        'getTheme':             { signature: 'getTheme() -- Current color theme', docs: '/ai.md#viewport-controls' },
        'setAutoRun':           { signature: 'setAutoRun(enabled) -- Enable/disable auto-render on edit', docs: '/ai.md#viewport-controls' },
        'isAutoRunEnabled':     { signature: 'isAutoRunEnabled() -- Whether auto-run is active', docs: '/ai.md#viewport-controls' },
        // View
        'setView':         { signature: 'setView(tab) -- Switch tab: "interactive", "gallery", "images", "diff", "notes"', docs: '/ai.md#how-to-use-this-tool' },
        'getViewState':    { signature: 'getViewState() -- Current tab and camera state', docs: '/ai.md#how-to-use-this-tool' },
        // Export
        'exportGLB':       { signature: 'await exportGLB() -- Download GLB file', docs: '/ai.md#console-api--windowpartwright' },
        'exportSTL':       { signature: 'exportSTL() -- Download STL file', docs: '/ai.md#console-api--windowpartwright' },
        'exportOBJ':       { signature: 'exportOBJ() -- Download OBJ file', docs: '/ai.md#console-api--windowpartwright' },
        'export3MF':       { signature: 'export3MF() -- Download 3MF file', docs: '/ai.md#console-api--windowpartwright' },
        // AI-friendly export — return bytes over the API instead of triggering a download
        'exportGLBData':   { signature: 'await exportGLBData() -- Return GLB as {filename, mimeType, base64, sizeBytes}', docs: '/ai/file-io.md' },
        'exportSTLData':   { signature: 'await exportSTLData() -- Return STL as {filename, mimeType, base64, sizeBytes}', docs: '/ai/file-io.md' },
        'exportOBJData':   { signature: 'await exportOBJData() -- Return OBJ as {filename, mimeType, text? | base64, sizeBytes}', docs: '/ai/file-io.md' },
        'export3MFData':   { signature: 'await export3MFData() -- Return 3MF as {filename, mimeType, base64, sizeBytes}', docs: '/ai/file-io.md' },
        'exportSessionData': { signature: 'await exportSessionData(sessionId?) -- Return parsed session JSON {filename, mimeType, data, sizeBytes}', docs: '/ai/file-io.md' },
        'exportCodeData':  { signature: 'exportCodeData() -- Return editor source as {filename, mimeType, language, text, sizeBytes}', docs: '/ai/file-io.md' },
        // AI-friendly import — bypass the file picker
        'importSessionData': { signature: 'await importSessionData(jsonObjectOrString) -- Import .partwright.json payload -> {sessionId} or {error}', docs: '/ai/file-io.md' },
        'importCodeData':  { signature: 'await importCodeData(code, language, sessionName?) -- Import raw source as new session', docs: '/ai/file-io.md' },
        // Recent Exports inbox (also visible in toolbar Export dropdown)
        'listRecentExports': { signature: 'listRecentExports() -- Recent export metadata, newest first', docs: '/ai/file-io.md' },
        'getRecentExport': { signature: 'await getRecentExport(id) -- Look up bytes by id -> {filename, mimeType, text? | base64, ...}', docs: '/ai/file-io.md' },
        'downloadRecentExport': { signature: 'downloadRecentExport(id) -- Re-trigger browser download for an inbox entry', docs: '/ai/file-io.md' },
        'clearRecentExports': { signature: 'clearRecentExports() -- Empty the Recent Exports list', docs: '/ai/file-io.md' },
        // Color regions
        'paintRegion':     { signature: 'paintRegion({point, normal, color, name?, tolerance?}) -- Paint coplanar face region (flood-fill, edge-bounded). Diagnostic error on failure.', docs: '/ai/colors.md' },
        'paintNearestRegion': { signature: 'paintNearestRegion({point, color, searchRadius?, name?, tolerance?}) -- Snap seed to nearest face, then paint coplanar region', docs: '/ai/colors.md' },
        'paintNear':       { signature: 'paintNear({point, radius, normalCone?, color, name?}) -- Paint triangles whose centroid is within `radius` of `point`. Predictable, no flood-fill tolerance to tune.', docs: '/ai/colors.md' },
        'paintInBox':      { signature: 'paintInBox({box, normalCone?, color, name?}) -- Paint triangles whose centroid is inside an axis-aligned box (and optional normal cone).', docs: '/ai/colors.md' },
        'paintInOrientedBox': { signature: 'paintInOrientedBox({box: {center, size, quaternion?}, color, name?}) -- Paint triangles whose centroid is inside a rotated oriented box. Same selector as the UI Box tool.', docs: '/ai/colors.md' },
        'paintFaces':      { signature: 'paintFaces({triangleIds, color, name?}) -- Paint specific triangle indices', docs: '/ai/colors.md' },
        'paintSlab':       { signature: 'paintSlab({axis|normal, offset, thickness, color, name?}) -- Paint planar slab range', docs: '/ai/colors.md' },
        'paintPreview':    { signature: 'paintPreview({box?|point+radius?|triangleIds?, normalCone?, withImage?, view?}) -- DRY-RUN -> {triangleCount, bbox, centroid, [thumbnail]}. Default count-only; pass withImage:true for the yellow-highlighted thumbnail.', docs: '/ai/colors.md' },
        'paintExplain':    { signature: 'paintExplain({region, withImage?, view?}) -- Diagnose a committed region -> {triangleCount, area, bbox, centroid, normalHistogram, [thumbnail]}.', docs: '/ai/colors.md' },
        'assertPaint':     { signature: 'assertPaint({region, expectedTriangleCount?, expectedBoundingBox?, expectedCentroid?}) -- Verify a previously-painted region -> {passed, failures?}', docs: '/ai/colors.md' },
        'findFaces':       { signature: 'findFaces({box?, normal?, normalTolerance?, color?, region?, maxResults?}) -- Query triangle ids by geometry/color filters', docs: '/ai/colors.md' },
        'getMesh':         { signature: 'getMesh() -- Direct triangle/vertex/normal/centroid access for procedural paint workflows', docs: '/ai/colors.md' },
        'getMeshSummary':  { signature: 'getMeshSummary({tolerance?, minTriangles?, maxTrianglesPerGroup?, maxGroups?}?) -- List coplanar face groups with centroid/normal/area/bbox', docs: '/ai/colors.md' },
        'listRegions':     { signature: 'listRegions() -- List all color regions with bbox + centroid for each', docs: '/ai/colors.md' },
        'clearColors':     { signature: 'clearColors() -- Remove ALL color regions (use undoLastPaint to reverse just one)', docs: '/ai/colors.md' },
        'listComponents':  { signature: 'listComponents() -> {count, components: [{index, centroid, boundingBox, volume, surfaceArea}]} -- Decompose the manifold into boolean-distinct parts. For "paint each feature" workflows (e.g. unioned head + eyes + mouth).', docs: '/ai/colors.md' },
        'paintComponent':  { signature: 'paintComponent({index, color, name?, topOnly?}) -- One-call shortcut: listComponents + paintInBox for the Nth piece.', docs: '/ai/colors.md' },
        'listLabels':      { signature: 'listLabels() -> {count, labels: [{name, triangleCount, bbox, centroid}]} -- Labels registered in the current run via api.label(shape, name). Survives boolean ops; the cleanest paint primitive on agent-authored geometry.', docs: '/ai/colors.md' },
        'paintByLabel':    { signature: 'paintByLabel({label, color, name?}) -- Paint a labelled feature by name. Pair with api.label/labeledUnion in your code. No coordinate guessing.', docs: '/ai/colors.md' },
        'paintByLabels':   { signature: 'paintByLabels([{label, color, name?}, ...]) -- Batch sibling. N features painted in one call -> {results, failed}. Use for any multi-feature paint job.', docs: '/ai/colors.md' },
        'paintConnected':  { signature: 'paintConnected({seed: {point, normal?}, maxDeviationDeg?, color, name?}) -- BFS-flood from a surface seed, gated by deviation from SEED normal (not adjacent). Pairs with probePixel for "paint everything contiguous and facing this way".', docs: '/ai/colors.md' },
        'getFeatureCentroids': { signature: 'getFeatureCentroids({maxGroups?, withinBox?}?) -- Token-cheap: face-group centroids + normals + bbox, no triangleIds. Use to plan paint targets.', docs: '/ai/colors.md' },
        'removeRegion':    { signature: 'removeRegion(id) -- Remove ONE color region by id from listRegions(). Use this to fix a single mistake without nuking the rest.', docs: '/ai/colors.md' },
        'setRegionVisibility': { signature: 'setRegionVisibility(id, visible) -- Show/hide ONE region in the viewport. Hidden regions still export.', docs: '/ai/colors.md' },
        'hideRegion':      { signature: 'hideRegion(id) -- Shorthand for setRegionVisibility(id, false).', docs: '/ai/colors.md' },
        'showRegion':      { signature: 'showRegion(id) -- Shorthand for setRegionVisibility(id, true).', docs: '/ai/colors.md' },
        'undoLastPaint':   { signature: 'undoLastPaint() -- Undo the most recent paint op. Removed region goes on a redo stack.', docs: '/ai/colors.md' },
        'redoLastPaint':   { signature: 'redoLastPaint() -- Reapply the most recently undone paint op.', docs: '/ai/colors.md' },
        'getBucketTolerance': { signature: 'getBucketTolerance() -- Read the bucket flood-fill tolerance (cosine of max bend angle).', docs: '/ai/colors.md' },
        'setBucketTolerance': { signature: 'setBucketTolerance(tolerance) -- Set the bucket flood-fill tolerance (-1..1). Affects the UI bucket tool and the default for paintRegion.', docs: '/ai/colors.md' },
        'getBrushSize':    { signature: 'getBrushSize() -- Read the UI brush radius (mesh units). 0 = single triangle.', docs: '/ai/colors.md' },
        'setBrushSize':    { signature: 'setBrushSize(radius) -- Set the UI brush radius (mesh units, >= 0). Affects only the interactive brush tool; programmatic painting uses paintNear / paintFaces.', docs: '/ai/colors.md' },
        // Annotations
        'listAnnotations':    { signature: 'listAnnotations() -- List freehand strokes -> [{id, color, width, points}]', docs: '/ai/annotations.md' },
        'listTextAnnotations':{ signature: 'listTextAnnotations() -- List pinned text labels -> [{id, text, color, fontSizePx, anchor}]', docs: '/ai/annotations.md' },
        'addTextAnnotation':  { signature: 'addTextAnnotation({anchor, text, color?, fontSizePx?}) -- Pin a text label at a 3D point', docs: '/ai/annotations.md' },
        'getAnnotationCount': { signature: 'getAnnotationCount() -- Total annotations (strokes + text)', docs: '/ai/annotations.md' },
        'undoAnnotation':     { signature: 'undoAnnotation() -- Remove the most recently added annotation -> {removed, remaining}', docs: '/ai/annotations.md' },
        'removeAnnotation':   { signature: 'removeAnnotation(id) -- Remove a specific annotation by id', docs: '/ai/annotations.md' },
        'clearAnnotations':   { signature: 'clearAnnotations() -- Remove all annotations (strokes + text) -> {cleared}', docs: '/ai/annotations.md' },
        'clearAnnotationStrokes': { signature: 'clearAnnotationStrokes() -- Remove only freehand strokes', docs: '/ai/annotations.md' },
        'clearTextAnnotations':   { signature: 'clearTextAnnotations() -- Remove only text labels', docs: '/ai/annotations.md' },
        'setAnnotationsVisible': { signature: 'setAnnotationsVisible(bool) -- Show/hide all annotations (also affects renderView output)', docs: '/ai/annotations.md' },
        'areAnnotationsVisible': { signature: 'areAnnotationsVisible() -- Whether annotations are currently visible', docs: '/ai/annotations.md' },
        'setAnnotationColor': { signature: 'setAnnotationColor([r,g,b]) -- Set draw color for new strokes/text (RGB 0..1)', docs: '/ai/annotations.md' },
        'setAnnotationWidth': { signature: 'setAnnotationWidth(px) -- Set line width for new strokes (0.5..64 px)', docs: '/ai/annotations.md' },
        'getAnnotationWidth': { signature: 'getAnnotationWidth() -- Current line width (pixels)', docs: '/ai/annotations.md' },
        'setAnnotationFontSize': { signature: 'setAnnotationFontSize(px) -- Set font size for new text labels (4..256 px)', docs: '/ai/annotations.md' },
        'getAnnotationFontSize': { signature: 'getAnnotationFontSize() -- Current text label font size (pixels)', docs: '/ai/annotations.md' },
        'restoreAnnotationView': { signature: 'restoreAnnotationView(id) -- Snap the camera to the angle the annotation was made from', docs: '/ai/annotations.md' },
      };

      if (method) {
        const entry = methods[method];
        if (entry) {
          console.log(`${entry.signature}\nDocs: ${entry.docs}`);
          return { method, ...entry };
        }
        return { error: `Unknown method "${method}". Call help() for full list.` };
      }

      const result = {
        app: 'Partwright -- AI-driven parametric CAD in the browser',
        docs: '/ai.md',
        constraints: {
          codeMustReturn: 'Code must end with: return <Manifold object>;',
          noUIAutomation: 'Do not drive the app with clicks or keystrokes. Use this API.',
        },
        quickstart: [
          'partwright.help()                        // You are here',
          'await partwright.createSession("name")   // Start a named session',
          'await partwright.runAndSave(code, "v1", {isManifold: true, maxComponents: 1})',
        ],
        methods,
      };

      // Also log a readable summary to the console
      const lines = [
        'Partwright -- AI-driven parametric CAD. Full docs: /ai.md',
        '',
        'Code must end with: return <Manifold object>;',
        'Do not drive the UI with clicks/keystrokes -- use this API.',
        '',
        'Quickstart:',
        '  await partwright.createSession("name")',
        '  await partwright.runAndSave(code, "v1", {isManifold: true, maxComponents: 1})',
        '',
        'Methods:',
        ...Object.entries(methods).map(([, v]) => `  ${v.signature}`),
      ];
      console.log(lines.join('\n'));

      return result;
    },
  };

  const apiWindow = window as unknown as Record<string, unknown>;
  apiWindow.partwright = partwrightAPI;
  apiWindow.mainifold = partwrightAPI;

  // Log API availability for AI agents
  console.info('Partwright: AI agents should use window.partwright -- start with partwright.help(). window.mainifold remains as a legacy alias. See /llms.txt');

  // === Internal functions ===

  /** Draw one rendered angle into the renderViews composite grid:
   *  the rendered tile occupies the top of the cell, with a labelled
   *  footer band beneath it identifying the angle. `cols` controls
   *  whether cellIndex wraps after 1 or 2 columns. */
  function drawCell(
    ctx: CanvasRenderingContext2D,
    src: CanvasImageSource,
    cellIndex: number,
    tileSize: number,
    cellHeight: number,
    label: string,
    cols: number,
  ): void {
    const col = cellIndex % cols;
    const row = Math.floor(cellIndex / cols);
    const x = col * tileSize;
    const y = row * cellHeight;
    ctx.drawImage(src, x, y, tileSize, tileSize);
    ctx.fillStyle = '#27272a';
    ctx.fillRect(x, y + tileSize, tileSize, cellHeight - tileSize);
    ctx.fillStyle = '#f4f4f5';
    ctx.font = '13px -apple-system, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(label, x + tileSize / 2, y + tileSize + 16);
    ctx.textAlign = 'start';
  }

  /** Pick the angle set for `renderViews`. `auto` reads the current
   *  manifold's bounding box and chooses based on aspect ratio:
   *  - very flat (dz / max(dx, dy) < 0.15) → [Top, Iso]: front view
   *    would be a thin sliver, top carries the information.
   *  - very tall (max(dx, dy) / dz < 0.3) → [Front, Right, Iso]:
   *    top view would be a tiny disk, the side elevations matter.
   *  - otherwise the classic [Front, Top, Iso] trio. */
  function chooseRenderAngles(which: RenderViewMode): { label: string; opts: { elevation: number; azimuth: number; ortho: boolean } }[] {
    const view = (v: typeof STANDARD_VIEWS[keyof typeof STANDARD_VIEWS]) => ({
      label: v.label,
      opts: { elevation: v.elevation, azimuth: v.azimuth, ortho: v.ortho },
    });
    const FRONT = view(STANDARD_VIEWS.front);
    const RIGHT = view(STANDARD_VIEWS.right);
    const TOP   = view(STANDARD_VIEWS.top);
    const ISO   = view(STANDARD_VIEWS.iso);
    if (which === 'tri') return [FRONT, TOP, ISO];
    if (which === 'all') return [FRONT, RIGHT, TOP, ISO];
    if (which === 'box') return [
      FRONT, RIGHT,
      { label: 'Back', opts: { elevation: 0, azimuth: 180, ortho: true } },
      { label: 'Left', opts: { elevation: 0, azimuth: 270, ortho: true } },
      TOP,
      { label: 'Bottom', opts: { elevation: -90, azimuth: 0, ortho: true } },
    ];
    // 'auto': inspect the current manifold's bounding box.
    let bb: { min: [number, number, number]; max: [number, number, number] } | null = null;
    if (currentManifold) {
      try { bb = getBoundingBox(currentManifold); } catch { bb = null; }
    }
    if (!bb) return [FRONT, TOP, ISO];
    const dx = bb.max[0] - bb.min[0];
    const dy = bb.max[1] - bb.min[1];
    const dz = bb.max[2] - bb.min[2];
    const widest = Math.max(dx, dy);
    if (widest <= 0 || dz <= 0) return [FRONT, TOP, ISO];
    const flatness = dz / widest;
    if (flatness < 0.15) return [TOP, ISO];
    if (widest / dz < 0.3) return [FRONT, RIGHT, ISO];
    return [FRONT, TOP, ISO];
  }

  /** Render the current mesh with `highlightTriangles` tinted bright
   *  yellow on top of any existing color regions. Shared between
   *  `paintPreview` (highlight a candidate selector) and `paintExplain`
   *  (highlight an already-committed region). The yellow is intentionally
   *  off-palette from anything a user would commit, so it reads as
   *  "in-progress / unsaved" against real paint. */
  function renderRegionHighlight(
    mesh: MeshData,
    highlightTriangles: Set<number>,
    viewOpts: { elevation?: number; azimuth?: number; ortho?: boolean; size?: number },
  ): string | null {
    const triColors = buildTriColors(mesh.numTri) ?? createEmptyTriColors(mesh.numTri);
    overlayPainted(triColors, highlightTriangles, [1, 230 / 255, 0]);
    return renderSingleView({ ...mesh, triColors }, viewOpts);
  }

  /** For a triangle set, compute total surface area, the largest single-
   *  triangle area (the diagnostic for fan-topology contamination), and
   *  an area-weighted histogram of face normals binned by cardinal axis
   *  (within 30°). Triangles whose normal is more than 30° off every
   *  axis fall into `oblique`. The histogram bins normalize to sum ≈ 1. */
  function computeRegionAreaAndNormalHistogram(
    triangles: Set<number>,
    mesh: MeshData,
  ): {
    area: number;
    largestTriangleArea: number;
    normalHistogram: { xPos: number; xNeg: number; yPos: number; yNeg: number; zPos: number; zNeg: number; oblique: number };
  } {
    const adjacency = buildAdjacency(mesh);
    const cosThresh = Math.cos(30 * Math.PI / 180); // ≈ 0.866
    const bins = { xPos: 0, xNeg: 0, yPos: 0, yNeg: 0, zPos: 0, zNeg: 0, oblique: 0 };
    let totalArea = 0;
    let largest = 0;
    for (const t of triangles) {
      const area = triangleArea(t, mesh);
      totalArea += area;
      if (area > largest) largest = area;
      const nx = adjacency.normals[t * 3];
      const ny = adjacency.normals[t * 3 + 1];
      const nz = adjacency.normals[t * 3 + 2];
      if (nx > cosThresh) bins.xPos += area;
      else if (nx < -cosThresh) bins.xNeg += area;
      else if (ny > cosThresh) bins.yPos += area;
      else if (ny < -cosThresh) bins.yNeg += area;
      else if (nz > cosThresh) bins.zPos += area;
      else if (nz < -cosThresh) bins.zNeg += area;
      else bins.oblique += area;
    }
    if (totalArea > 0) {
      const norm = (v: number) => Math.round((v / totalArea) * 1000) / 1000;
      return {
        area: totalArea,
        largestTriangleArea: largest,
        normalHistogram: {
          xPos: norm(bins.xPos), xNeg: norm(bins.xNeg),
          yPos: norm(bins.yPos), yNeg: norm(bins.yNeg),
          zPos: norm(bins.zPos), zNeg: norm(bins.zNeg),
          oblique: norm(bins.oblique),
        },
      };
    }
    return { area: 0, largestTriangleArea: 0, normalHistogram: { xPos: 0, xNeg: 0, yPos: 0, yNeg: 0, zPos: 0, zNeg: 0, oblique: 0 } };
  }

  /** Decode a data: URL into an HTMLImageElement. Image decoding from a
   *  data URL is async even when the bytes are local — returning a
   *  promise here keeps the renderViews caller cleanly awaitable. */
  function loadImageFromDataUrl(dataUrl: string): Promise<HTMLImageElement | null> {
    return new Promise(resolve => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = dataUrl;
    });
  }

  /** Axis-aligned bounding-box intersection test. Inclusive on both ends
   *  so a face touching the box boundary counts as inside. */
  function bboxesIntersect(
    a: { min: [number, number, number]; max: [number, number, number] },
    b: { min: [number, number, number]; max: [number, number, number] },
  ): boolean {
    return (
      a.max[0] >= b.min[0] && a.min[0] <= b.max[0] &&
      a.max[1] >= b.min[1] && a.min[1] <= b.max[1] &&
      a.max[2] >= b.min[2] && a.min[2] <= b.max[2]
    );
  }

  /** Report bounding box + centroid for a triangle set, walking only the
   *  vertices used by those triangles. Returns `null` when the set is empty. */
  function regionTriangleStats(triangles: Set<number>, mesh: MeshData): { bbox: { min: [number, number, number]; max: [number, number, number] }; centroid: [number, number, number] } | { bbox: null; centroid: null } {
    if (triangles.size === 0) return { bbox: null, centroid: null };
    const { triVerts, vertProperties, numProp } = mesh;
    let xMin = Infinity, yMin = Infinity, zMin = Infinity;
    let xMax = -Infinity, yMax = -Infinity, zMax = -Infinity;
    let sx = 0, sy = 0, sz = 0, count = 0;
    for (const t of triangles) {
      for (let k = 0; k < 3; k++) {
        const vi = triVerts[t * 3 + k];
        const x = vertProperties[vi * numProp];
        const y = vertProperties[vi * numProp + 1];
        const z = vertProperties[vi * numProp + 2];
        if (x < xMin) xMin = x; if (x > xMax) xMax = x;
        if (y < yMin) yMin = y; if (y > yMax) yMax = y;
        if (z < zMin) zMin = z; if (z > zMax) zMax = z;
        sx += x; sy += y; sz += z; count++;
      }
    }
    return {
      bbox: { min: [xMin, yMin, zMin], max: [xMax, yMax, zMax] },
      centroid: [sx / count, sy / count, sz / count],
    };
  }

  /** Build a friendly diagnostic for `paintRegion` failures: locate the closest
   *  surface point, report its position/normal, the angle off the requested
   *  normal, and a tolerance value that would accept it. Avoids the
   *  "no matching face found" black box that wastes agent debugging cycles. */
  function diagnoseSeedFailure(
    point: [number, number, number],
    requestedNormal: [number, number, number],
    mesh: MeshData,
    adjacency: ReturnType<typeof buildAdjacency>,
    tolerance: number,
  ): { error: string; nearest?: { point: [number, number, number]; normal: [number, number, number]; distance: number; angleDeg: number; suggestedTolerance: number } } {
    const nearest = findNearestTriangle(point, mesh, adjacency);
    if (nearest.triIndex < 0) return { error: 'paintRegion: mesh has no triangles' };

    // Normalize the requested normal so the angle calc is meaningful.
    const len = Math.hypot(requestedNormal[0], requestedNormal[1], requestedNormal[2]);
    const nx = len > 0 ? requestedNormal[0] / len : 0;
    const ny = len > 0 ? requestedNormal[1] / len : 0;
    const nz = len > 0 ? requestedNormal[2] / len : 0;
    const dot = nx * nearest.normal[0] + ny * nearest.normal[1] + nz * nearest.normal[2];
    const clamped = Math.max(-1, Math.min(1, dot));
    const angleDeg = Math.acos(clamped) * 180 / Math.PI;

    // Suggest a tolerance just permissive enough to include the nearest face.
    // Round down to 4 decimal places so the suggestion clearly passes the threshold.
    const suggested = Math.max(-1, Math.floor(clamped * 10000) / 10000 - 0.0001);
    const suggestText = clamped >= tolerance
      ? `tolerance ${tolerance} should already match — the seed point may be too far off the surface (${nearest.distance.toFixed(3)} units). Use the hit point/normal from probeRay() instead, or call paintNearestRegion({point, color}) which auto-snaps.`
      : `try tolerance ${suggested.toFixed(4)} (currently ${tolerance})`;

    return {
      error: `paintRegion: no face matched at point=[${point.map(n => n.toFixed(2)).join(', ')}], normal=[${requestedNormal.map(n => n.toFixed(3)).join(', ')}], tolerance=${tolerance}. Nearest face is at [${nearest.closest.map(n => n.toFixed(2)).join(', ')}] with normal [${nearest.normal.map(n => n.toFixed(3)).join(', ')}] (${angleDeg.toFixed(1)}° off requested, distance ${nearest.distance.toFixed(3)}). ${suggestText}`,
      nearest: {
        point: nearest.closest,
        normal: nearest.normal,
        distance: nearest.distance,
        angleDeg,
        suggestedTolerance: suggested,
      },
    };
  }

  /** Resolve the normalCone to use for a paint op. Explicit cone wins;
   *  `topOnly: true` is sugar for "upward-facing within ~30° of +Z" and
   *  is the most common case the agent over-paints without. */
  function resolvePaintCone(
    explicit: { axis: [number, number, number]; angleDeg: number } | undefined,
    topOnly: boolean | undefined,
  ): { axis: [number, number, number]; angleDeg: number } | undefined {
    if (explicit) return explicit;
    if (topOnly) return { axis: [0, 0, 1], angleDeg: 30 };
    return undefined;
  }

  function validateCoverageMode(mode: unknown): string | null {
    if (mode === undefined) return null;
    if (!COVERAGE_MODES.includes(mode as CoverageMode)) {
      return `coverageMode must be one of: ${COVERAGE_MODES.join(', ')}`;
    }
    return null;
  }

  function validateMaxTriangleArea(area: unknown): string | null {
    if (area === undefined) return null;
    if (typeof area !== 'number' || !Number.isFinite(area) || area <= 0) {
      return 'maxTriangleArea must be a positive finite number';
    }
    return null;
  }

  /** Validate the optional edge-smoothing params shared by slab/shape paint
   *  methods (`smooth`, `resolution`, `maxEdge`). */
  function validateSmoothParams(opts: { smooth?: unknown; resolution?: unknown; maxEdge?: unknown }): string | null {
    if (opts.smooth !== undefined && typeof opts.smooth !== 'boolean') return 'smooth must be a boolean';
    if (opts.resolution !== undefined && (typeof opts.resolution !== 'number' || !Number.isFinite(opts.resolution) || opts.resolution < SMOOTH_DIVISOR_MIN || opts.resolution > SMOOTH_DIVISOR_MAX)) {
      return `resolution must be a number from ${SMOOTH_DIVISOR_MIN} to ${SMOOTH_DIVISOR_MAX}`;
    }
    if (opts.maxEdge !== undefined && (typeof opts.maxEdge !== 'number' || !Number.isFinite(opts.maxEdge) || opts.maxEdge <= 0)) return 'maxEdge must be a positive finite number';
    return null;
  }

  /** Resolve smoothing fields for a slab/shape descriptor from API opts.
   *  `smooth` defaults to true; an explicit positive `maxEdge` (absolute edge
   *  length) wins over `resolution` (model bbox diagonal / resolution, default
   *  256). With smoothing off, the fields refine nothing. */
  function resolveShapeSmoothFields(opts: { smooth?: boolean; resolution?: number; maxEdge?: number }): { smooth: boolean; maxEdge: number } {
    if (opts.smooth === false) return { smooth: false, maxEdge: 0 };
    if (typeof opts.maxEdge === 'number' && opts.maxEdge > 0) return { smooth: true, maxEdge: opts.maxEdge };
    const resolution = typeof opts.resolution === 'number' && opts.resolution > 0 ? opts.resolution : 256;
    const maxEdge = currentMeshData ? smoothEdgeForResolution(currentMeshData, resolution) : 0;
    return { smooth: maxEdge > 0, maxEdge };
  }

  function validateNormalCone(cone: { axis: [number, number, number]; angleDeg: number } | undefined): string | null {
    if (cone === undefined) return null;
    if (typeof cone !== 'object' || cone === null) return 'normalCone must be { axis: [x,y,z], angleDeg: number }';
    if (!Array.isArray(cone.axis) || cone.axis.length !== 3) return 'normalCone.axis must be [nx, ny, nz]';
    for (let i = 0; i < 3; i++) {
      if (typeof cone.axis[i] !== 'number' || !Number.isFinite(cone.axis[i])) return 'normalCone.axis components must be finite numbers';
    }
    const len = Math.hypot(cone.axis[0], cone.axis[1], cone.axis[2]);
    if (len === 0) return 'normalCone.axis must be a non-zero vector';
    if (typeof cone.angleDeg !== 'number' || !Number.isFinite(cone.angleDeg)) return 'normalCone.angleDeg must be a finite number';
    if (cone.angleDeg < 0 || cone.angleDeg > 180) return 'normalCone.angleDeg must be in [0, 180]';
    return null;
  }

  function validateBoxAndCone(
    box: { min: [number, number, number]; max: [number, number, number] } | undefined,
    cone: { axis: [number, number, number]; angleDeg: number } | undefined,
  ): string | null {
    if (box === undefined || typeof box !== 'object' || box === null) return 'box must be { min: [x,y,z], max: [x,y,z] }';
    if (!Array.isArray(box.min) || box.min.length !== 3 || !Array.isArray(box.max) || box.max.length !== 3) {
      return 'box.min and box.max must be 3-tuples';
    }
    for (let i = 0; i < 3; i++) {
      if (typeof box.min[i] !== 'number' || !Number.isFinite(box.min[i])) return `box.min[${i}] must be a finite number`;
      if (typeof box.max[i] !== 'number' || !Number.isFinite(box.max[i])) return `box.max[${i}] must be a finite number`;
      if (box.min[i] > box.max[i]) return `box.min[${i}] (${box.min[i]}) must be <= box.max[${i}] (${box.max[i]})`;
    }
    return validateNormalCone(cone);
  }

  /** Compute the world-space area of a single triangle. Shared by the
   *  selector `maxTriangleArea` filter, the region-stats walker, and the
   *  normal-histogram weighter so they stay byte-consistent. */
  function triangleArea(t: number, mesh: MeshData): number {
    const { triVerts, vertProperties, numProp } = mesh;
    const v0 = triVerts[t * 3], v1 = triVerts[t * 3 + 1], v2 = triVerts[t * 3 + 2];
    const ax = vertProperties[v0 * numProp],     ay = vertProperties[v0 * numProp + 1], az = vertProperties[v0 * numProp + 2];
    const bx = vertProperties[v1 * numProp],     by = vertProperties[v1 * numProp + 1], bz = vertProperties[v1 * numProp + 2];
    const cx = vertProperties[v2 * numProp],     cy = vertProperties[v2 * numProp + 1], cz = vertProperties[v2 * numProp + 2];
    const e1x = bx - ax, e1y = by - ay, e1z = bz - az;
    const e2x = cx - ax, e2y = cy - ay, e2z = cz - az;
    const crx = e1y * e2z - e1z * e2y;
    const cry = e1z * e2x - e1x * e2z;
    const crz = e1x * e2y - e1y * e2x;
    return 0.5 * Math.sqrt(crx * crx + cry * cry + crz * crz);
  }

  /** Summarize the area distribution of a triangle set without walking
   *  the mesh twice. The `largestTriangleArea / (totalArea / count)`
   *  ratio is the diagnostic for fan-topology bleed — anything > ~10×
   *  means one or more long radial triangles are dragging the selector
   *  beyond its intended footprint. */
  function summarizeTriangleAreas(triangles: Iterable<number>, mesh: MeshData): { totalArea: number; largestTriangleArea: number } {
    let total = 0;
    let largest = 0;
    for (const t of triangles) {
      const a = triangleArea(t, mesh);
      total += a;
      if (a > largest) largest = a;
    }
    return { totalArea: total, largestTriangleArea: largest };
  }

  /** Collect triangle ids whose centroid lies inside `box` and (optionally)
   *  whose face normal aligns with `cone.axis` within `cone.angleDeg`.
   *  `regionFilter`, when non-null, restricts to ids in that set. */
  function collectTrianglesByFilter(
    mesh: MeshData,
    box: { min: [number, number, number]; max: [number, number, number] },
    cone: { axis: [number, number, number]; angleDeg: number } | undefined,
    regionFilter: Set<number> | null,
    coverage: CoverageMode = 'centroid',
    maxArea: number | undefined = undefined,
  ): Set<number> {
    const adjacency = cone ? buildAdjacency(mesh) : null;
    let coneAxis: [number, number, number] | null = null;
    let coneCos = -1;
    if (cone) {
      const len = Math.hypot(cone.axis[0], cone.axis[1], cone.axis[2]);
      coneAxis = [cone.axis[0] / len, cone.axis[1] / len, cone.axis[2] / len];
      coneCos = Math.cos(cone.angleDeg * Math.PI / 180);
    }
    const result = new Set<number>();
    const { triVerts, vertProperties, numProp, numTri } = mesh;
    const [bMinX, bMinY, bMinZ] = box.min;
    const [bMaxX, bMaxY, bMaxZ] = box.max;
    for (let t = 0; t < numTri; t++) {
      if (regionFilter && !regionFilter.has(t)) continue;
      const v0 = triVerts[t * 3];
      const v1 = triVerts[t * 3 + 1];
      const v2 = triVerts[t * 3 + 2];
      const ax = vertProperties[v0 * numProp], ay = vertProperties[v0 * numProp + 1], az = vertProperties[v0 * numProp + 2];
      const bx = vertProperties[v1 * numProp], by = vertProperties[v1 * numProp + 1], bz = vertProperties[v1 * numProp + 2];
      const cx = vertProperties[v2 * numProp], cy = vertProperties[v2 * numProp + 1], cz = vertProperties[v2 * numProp + 2];

      if (coverage === 'fully_inside') {
        if (ax < bMinX || ax > bMaxX || ay < bMinY || ay > bMaxY || az < bMinZ || az > bMaxZ) continue;
        if (bx < bMinX || bx > bMaxX || by < bMinY || by > bMaxY || bz < bMinZ || bz > bMaxZ) continue;
        if (cx < bMinX || cx > bMaxX || cy < bMinY || cy > bMaxY || cz < bMinZ || cz > bMaxZ) continue;
      } else if (coverage === 'any_vertex_inside') {
        const a = ax >= bMinX && ax <= bMaxX && ay >= bMinY && ay <= bMaxY && az >= bMinZ && az <= bMaxZ;
        const b = bx >= bMinX && bx <= bMaxX && by >= bMinY && by <= bMaxY && bz >= bMinZ && bz <= bMaxZ;
        const c = cx >= bMinX && cx <= bMaxX && cy >= bMinY && cy <= bMaxY && cz >= bMinZ && cz <= bMaxZ;
        if (!a && !b && !c) continue;
      } else {
        const ccx = (ax + bx + cx) / 3, ccy = (ay + by + cy) / 3, ccz = (az + bz + cz) / 3;
        if (ccx < bMinX || ccx > bMaxX || ccy < bMinY || ccy > bMaxY || ccz < bMinZ || ccz > bMaxZ) continue;
      }

      if (coneAxis && adjacency) {
        const nx = adjacency.normals[t * 3];
        const ny = adjacency.normals[t * 3 + 1];
        const nz = adjacency.normals[t * 3 + 2];
        const dot = coneAxis[0] * nx + coneAxis[1] * ny + coneAxis[2] * nz;
        if (dot < coneCos) continue;
      }

      if (maxArea !== undefined && triangleArea(t, mesh) > maxArea) continue;

      result.add(t);
    }
    return result;
  }

  /** Collect triangle ids whose centroid lies within `radius` of `point`. */
  function collectTrianglesBySphere(
    mesh: MeshData,
    point: [number, number, number],
    radius: number,
    cone: { axis: [number, number, number]; angleDeg: number } | undefined,
    coverage: CoverageMode = 'centroid',
    maxArea: number | undefined = undefined,
  ): Set<number> {
    const adjacency = cone ? buildAdjacency(mesh) : null;
    let coneAxis: [number, number, number] | null = null;
    let coneCos = -1;
    if (cone) {
      const len = Math.hypot(cone.axis[0], cone.axis[1], cone.axis[2]);
      coneAxis = [cone.axis[0] / len, cone.axis[1] / len, cone.axis[2] / len];
      coneCos = Math.cos(cone.angleDeg * Math.PI / 180);
    }
    const r2 = radius * radius;
    const result = new Set<number>();
    const { triVerts, vertProperties, numProp, numTri } = mesh;
    const [px, py, pz] = point;
    for (let t = 0; t < numTri; t++) {
      const v0 = triVerts[t * 3];
      const v1 = triVerts[t * 3 + 1];
      const v2 = triVerts[t * 3 + 2];
      const ax = vertProperties[v0 * numProp], ay = vertProperties[v0 * numProp + 1], az = vertProperties[v0 * numProp + 2];
      const bx = vertProperties[v1 * numProp], by = vertProperties[v1 * numProp + 1], bz = vertProperties[v1 * numProp + 2];
      const cx = vertProperties[v2 * numProp], cy = vertProperties[v2 * numProp + 1], cz = vertProperties[v2 * numProp + 2];

      if (coverage === 'fully_inside') {
        if ((ax - px) ** 2 + (ay - py) ** 2 + (az - pz) ** 2 > r2) continue;
        if ((bx - px) ** 2 + (by - py) ** 2 + (bz - pz) ** 2 > r2) continue;
        if ((cx - px) ** 2 + (cy - py) ** 2 + (cz - pz) ** 2 > r2) continue;
      } else if (coverage === 'any_vertex_inside') {
        const dA = (ax - px) ** 2 + (ay - py) ** 2 + (az - pz) ** 2;
        const dB = (bx - px) ** 2 + (by - py) ** 2 + (bz - pz) ** 2;
        const dC = (cx - px) ** 2 + (cy - py) ** 2 + (cz - pz) ** 2;
        if (dA > r2 && dB > r2 && dC > r2) continue;
      } else {
        const ccx = (ax + bx + cx) / 3, ccy = (ay + by + cy) / 3, ccz = (az + bz + cz) / 3;
        const dx = ccx - px, dy = ccy - py, dz = ccz - pz;
        if (dx * dx + dy * dy + dz * dz > r2) continue;
      }

      if (coneAxis && adjacency) {
        const nx = adjacency.normals[t * 3];
        const ny = adjacency.normals[t * 3 + 1];
        const nz = adjacency.normals[t * 3 + 2];
        const dot = coneAxis[0] * nx + coneAxis[1] * ny + coneAxis[2] * nz;
        if (dot < coneCos) continue;
      }

      if (maxArea !== undefined && triangleArea(t, mesh) > maxArea) continue;

      result.add(t);
    }
    return result;
  }

  /** Collect triangle ids whose centroids fall within a cylindrical shell
   *  (rMin ≤ radial dist from axis ≤ rMax, zMin ≤ z ≤ zMax). */
  function collectTrianglesByCylinder(
    mesh: MeshData,
    center: [number, number],
    rMin: number,
    rMax: number,
    zMin: number,
    zMax: number,
    cone: { axis: [number, number, number]; angleDeg: number } | undefined,
    coverage: CoverageMode = 'centroid',
    maxArea: number | undefined = undefined,
  ): Set<number> {
    const adjacency = cone ? buildAdjacency(mesh) : null;
    let coneAxis: [number, number, number] | null = null;
    let coneCos = -1;
    if (cone) {
      const len = Math.hypot(cone.axis[0], cone.axis[1], cone.axis[2]);
      coneAxis = [cone.axis[0] / len, cone.axis[1] / len, cone.axis[2] / len];
      coneCos = Math.cos(cone.angleDeg * Math.PI / 180);
    }
    const rMin2 = rMin * rMin, rMax2 = rMax * rMax;
    const [cx, cy] = center;
    const result = new Set<number>();
    const { triVerts, vertProperties, numProp, numTri } = mesh;

    function radial2(x: number, y: number): number {
      const dx = x - cx, dy = y - cy;
      return dx * dx + dy * dy;
    }
    function inShell(x: number, y: number, z: number): boolean {
      const r2 = radial2(x, y);
      return r2 >= rMin2 && r2 <= rMax2 && z >= zMin && z <= zMax;
    }

    for (let t = 0; t < numTri; t++) {
      const v0 = triVerts[t * 3], v1 = triVerts[t * 3 + 1], v2 = triVerts[t * 3 + 2];
      const ax = vertProperties[v0 * numProp], ay = vertProperties[v0 * numProp + 1], az = vertProperties[v0 * numProp + 2];
      const bx = vertProperties[v1 * numProp], by = vertProperties[v1 * numProp + 1], bz = vertProperties[v1 * numProp + 2];
      const cx2 = vertProperties[v2 * numProp], cy2 = vertProperties[v2 * numProp + 1], cz2 = vertProperties[v2 * numProp + 2];

      if (coverage === 'fully_inside') {
        if (!inShell(ax, ay, az) || !inShell(bx, by, bz) || !inShell(cx2, cy2, cz2)) continue;
      } else if (coverage === 'any_vertex_inside') {
        if (!inShell(ax, ay, az) && !inShell(bx, by, bz) && !inShell(cx2, cy2, cz2)) continue;
      } else {
        const ccx = (ax + bx + cx2) / 3, ccy = (ay + by + cy2) / 3, ccz = (az + bz + cz2) / 3;
        if (!inShell(ccx, ccy, ccz)) continue;
      }

      if (coneAxis && adjacency) {
        const nx = adjacency.normals[t * 3], ny = adjacency.normals[t * 3 + 1], nz = adjacency.normals[t * 3 + 2];
        if (coneAxis[0] * nx + coneAxis[1] * ny + coneAxis[2] * nz < coneCos) continue;
      }
      if (maxArea !== undefined && triangleArea(t, mesh) > maxArea) continue;
      result.add(t);
    }
    return result;
  }

  /** Produce advisory warnings for geometry that was saved or queried.
   *  Returns an empty array when the geometry is clean.
   *  These are non-blocking — the save has already happened. */
  function geometryWarnings(geo: Record<string, unknown>): string[] {
    if (!geo || geo.status !== 'ok') return [];
    const warnings: string[] = [];
    if (geo.isManifold === false) {
      warnings.push(
        'isManifold: false — the mesh has non-manifold edges or gaps. ' +
        'Export and slicing will fail with most tools. Fix the geometry ' +
        'before finalizing: ensure boolean operands overlap by ≥ 0.5 units, ' +
        'avoid zero-thickness walls, and check for duplicate faces.',
      );
    }
    if (typeof geo.componentCount === 'number' && geo.componentCount > 1) {
      warnings.push(
        `componentCount: ${geo.componentCount} — model has ${geo.componentCount} disconnected pieces. ` +
        'If unintentional, check that boolean union shapes overlap by ≥ 0.5 units. ' +
        'If intentional (separate printable parts), ignore this warning.',
      );
    }
    return warnings;
  }

  /** Commit a triangle set as a region and refresh the viewport — shared by
   *  `paintInBox` and `paintNear` so they stay byte-for-byte consistent with
   *  the existing `paintFaces`/`paintRegion` rendering path. */
  function commitPaintFromSet(
    triangles: Set<number>,
    color: [number, number, number],
    name: string | undefined,
    source: 'face-pick' | 'paintbrush',
  ) {
    if (!currentMeshData) return { error: 'No geometry loaded' };
    const regionName = name ?? `Region ${getRegions().length + 1}`;
    const region = addRegion(
      regionName,
      color,
      source,
      { kind: 'triangles', ids: [...triangles] },
      triangles,
    );
    scheduleColorRefresh();
    syncLockState();
    const stats = regionTriangleStats(triangles, currentMeshData);
    return { id: region.id, name: region.name, triangles: triangles.size, bbox: stats.bbox, centroid: stats.centroid };
  }

  /** Coalesce viewport + multi-view + elevations-strip refreshes triggered
   *  by paint mutations (commit / undo / redo / removeRegion / clearColors).
   *  An agent turn that paints N regions in a row otherwise pays the full
   *  three-renderer cost N times; with rAF batching it pays once at the
   *  next frame boundary. Each sub-renderer is 50-150ms on complex meshes,
   *  so this was a primary source of the "page unresponsive" warning. */
  let paintRefreshPending = false;
  function scheduleColorRefresh(): void {
    if (paintRefreshPending) return;
    paintRefreshPending = true;
    requestAnimationFrame(() => {
      paintRefreshPending = false;
      if (!currentMeshData) return;
      const colored = applyTriColorsIfVisible(currentMeshData);
      updateMesh(colored, { skipAutoFrame: true });
    });
  }

  function runCode(code?: string, opts: { surfaceErrors?: boolean } = {}) {
    const src = code ?? getValue();
    setStatus(statusBar, 'running', 'Running...');
    clearEditorDiagnostics();
    clearEditorErrorPanel(editorErrorPanel);

    requestAnimationFrame(async () => {
      // An explicit runCodeSync (e.g. version-load, partwright.run) may have
      // started synchronously before this RAF fired — if so, skip to avoid
      // racing: the explicit call owns _runGeneration and will apply results.
      if (_running) return;
      await runCodeSync(src, opts);
    });
  }

  async function runCodeSync(src: string, opts: { surfaceErrors?: boolean } = {}): Promise<boolean> {
    // Manual runs (Run button, version load, partwright.run) surface errors
    // immediately; auto-runs defer to the idle/blur triggers so the editor
    // doesn't flicker an error on every keystroke.
    const surfaceErrors = opts.surfaceErrors ?? true;
    const myGen = ++_runGeneration;
    _running = true;
    const t0 = performance.now();
    const result = await executeCodeAsync(src);

    // A newer runCodeSync was dispatched while we were awaiting the Worker.
    // Discard this result to prevent a stale version from overwriting the
    // current mesh, manifold, or colour regions.
    if (myGen !== _runGeneration) return false;

    const elapsed = Math.round(performance.now() - t0);
    _running = false;

    if (result.error) {
      const diagnostics = result.diagnostics ?? [];
      setStatus(statusBar, 'error', summarizeDiagnostics(result.error, diagnostics));
      geometryDataEl.textContent = JSON.stringify({
        status: 'error',
        error: result.error,
        diagnostics,
        executionTimeMs: elapsed,
        codeHash: simpleHash(src),
      });
      if (surfaceErrors) {
        // Explicit run: record + show + log + jump to the first diagnostic now.
        recordError(result.error);
        errorLog.capture({ level: 'error', source: 'engine', message: result.error });
        setEditorDiagnostics(diagnostics);
        renderEditorError(editorErrorPanel, result.error, diagnostics);
        revealFirstDiagnostic();
        pendingEditorError = null;
      } else {
        // Auto-run: hold the error; the idle/blur trigger surfaces it quietly
        // (no log, no caret jump, no error-history noise) if the code is still
        // the same.
        pendingEditorError = { error: result.error, diagnostics, src };
      }
      return true;
    }

    if (result.mesh) {
      clearEditorDiagnostics();
      clearEditorErrorPanel(editorErrorPanel);
      pendingEditorError = null;
      // Bump the paint generation so any in-flight subdivision worker — started
      // against the previous base mesh — discards its result instead of stamping
      // a refined mesh built from the OLD base over result.mesh.
      resetPaintWorkerState();
      currentMeshData = result.mesh;
      // A fresh run is the new pristine base for any subsequent smooth-brush
      // subdivision; rehydrating a saved version rebuilds the refined mesh from
      // this base + its stroke descriptors right after.
      paintBaseMesh = result.mesh;
      // Release the previous Manifold's WASM-heap memory before overwriting.
      // Manifold objects live outside the JS heap and require manual .delete().
      if (currentManifold && typeof currentManifold.delete === 'function') {
        try { currentManifold.delete(); } catch { /* already deleted */ }
      }
      // The geometry Worker returns manifold=null (live WASM objects can't
      // cross thread boundaries). Reconstruct a queryable Manifold from the
      // transferred mesh data so sliceAtZ, getBoundingBox, decompose, etc.
      // keep working without changes on the main thread.
      if (result.manifold) {
        currentManifold = result.manifold;
      } else {
        const mod = getModule();
        currentManifold = (mod && result.mesh) ? mod.Manifold.ofMesh(result.mesh) : null;
      }
      // Capture the labelled-construction map for this run. byLabel
      // region descriptors look up their triangles here; rehydrating a
      // saved version re-runs the code first, which rebuilds the map.
      currentLabelMap = result.labelMap ?? null;

      // Apply any existing color regions to the mesh. Refining regions —
      // smooth brush strokes AND smooth slab/box regions — subdivide the mesh:
      // their triangle indices point into the REFINED tessellation, not this
      // freshly-run coarse base. Re-running the code (e.g. the debounced
      // auto-run that fires ~300ms after a saved version loads) resets
      // currentMeshData to the coarse base, so naively coloring `result.mesh`
      // would stamp those refined-mesh indices onto coarse triangles — the
      // "shattered shards" bug. Gate on hasRefineDescriptors() (not just brush
      // strokes) so slab/box smooth regions rebuild too, exactly as the
      // visibility-toggle path does via reconcilePaintedGeometry.
      if (hasColorRegions() && hasRefineDescriptors()) {
        rebuildPaintedGeometry();
        lastStrokeList = strokeDescriptors();
      } else {
        const displayMesh = hasColorRegions() ? applyTriColorsIfVisible(result.mesh) : result.mesh;
        updateMesh(displayMesh);
        updatePaintMesh(result.mesh); // always pass uncolored mesh for adjacency
      }

      updateGeometryData(elapsed, src);
      syncClipSliderBounds();
      // A fresh run replaces the geometry, so any simplify baseline is stale.
      // Drop it and let an open panel re-snapshot the new mesh.
      simplifyBaselineMesh = null;
      refreshSimplifyIfOpen();
      setStatus(statusBar, 'ready', 'Ready');
    }
    return true;
  }

  function initClipControls(container: HTMLElement) {
    const toggleBtn = container.querySelector('#clip-toggle') as HTMLButtonElement;
    // Slider + label live in their own anchor under the gizmo, not in the toolbar.
    const slider = document.getElementById('clip-z-slider') as HTMLInputElement;
    const zLabel = document.getElementById('clip-z-label') as HTMLElement;

    toggleBtn.addEventListener('click', () => {
      const state = getClipState();
      setClipping(!state.enabled);
      syncClipUI();
    });

    slider.addEventListener('input', () => {
      const z = parseFloat(slider.value);
      setClipZ(z);
      zLabel.textContent = `Z: ${z.toFixed(2)}`;
    });
  }

  function syncClipUI() {
    const state = getClipState();
    const toggleBtn = document.getElementById('clip-toggle');
    const sliderGroup = document.getElementById('clip-slider-group');
    const slider = document.getElementById('clip-z-slider') as HTMLInputElement;
    const zLabel = document.getElementById('clip-z-label');

    if (toggleBtn) {
      toggleBtn.className = state.enabled
        ? 'px-2 py-1 rounded text-xs bg-red-500/20 backdrop-blur text-red-300 hover:bg-red-500/30 transition-colors border border-red-500/50'
        : 'px-2 py-1 rounded text-xs bg-zinc-800/80 backdrop-blur text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700/80 transition-colors border border-zinc-600/50';
    }

    if (sliderGroup) {
      sliderGroup.classList.toggle('hidden', !state.enabled);
    }

    if (slider && state.enabled) {
      slider.value = String(state.z);
    }

    if (zLabel && state.enabled) {
      zLabel.textContent = `Z: ${state.z.toFixed(2)}`;
    }
  }

  function syncClipSliderBounds() {
    const state = getClipState();
    const slider = document.getElementById('clip-z-slider') as HTMLInputElement;
    if (!slider) return;

    slider.min = String(state.min);
    slider.max = String(state.max);
    slider.step = String((state.max - state.min) / 200);

    if (state.enabled) {
      // Keep current Z if within bounds, else reset to 75%
      if (state.z < state.min || state.z > state.max) {
        const newZ = state.min + (state.max - state.min) * 0.75;
        setClipZ(newZ);
        syncClipUI();
      }
    }
  }

  function initMeasureToggle(container: HTMLElement) {
    const measureBtn = container.querySelector('#measure-toggle') as HTMLButtonElement;
    if (!measureBtn) return;

    const inactiveClass = 'px-2 py-1 rounded text-xs bg-zinc-800/80 backdrop-blur text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700/80 transition-colors border border-zinc-600/50';
    const activeClass = 'px-2 py-1 rounded text-xs bg-blue-500/20 backdrop-blur text-blue-400 hover:bg-blue-500/30 transition-colors border border-blue-500/30';

    function close(): boolean {
      if (!getMeasureState().active) return false;
      deactivateMeasure();
      setMeasureLock(false);
      measureBtn.className = inactiveClass;
      return true;
    }

    closeMeasureIfActive = close;

    measureBtn.addEventListener('click', () => {
      if (getMeasureState().active) {
        close();
      } else {
        closeSimplifyMenu();
        activateMeasure();
        setMeasureLock(true);
        measureBtn.className = activeClass;
      }
    });
  }

  function initEscapeMenuClose() {
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
        return;
      }
      // Let select-mode handle Escape first when an annotation is selected
      // (it deselects). A subsequent Escape will close the menu.
      if (isSelectActive() && getSelectedAnnotationId()) return;

      let closed = false;
      if (isAnnotateOpen()) { closeAnnotateMenu(); closed = true; }
      if (isPaintOpen()) { closePaintMenu(); closed = true; }
      if (isSimplifyOpen()) { closeSimplifyMenu(); closed = true; }
      if (closeMeasureIfActive()) closed = true;
      if (getClipState().enabled) { setClipping(false); syncClipUI(); closed = true; }
      if (closed) e.preventDefault();
    });
  }

  function initWireframeToggle(container: HTMLElement) {
    const wireBtn = container.querySelector('#wireframe-toggle') as HTMLButtonElement;
    if (!wireBtn) return;

    const inactiveClass = 'px-3 py-2 md:px-2 md:py-1 rounded text-sm md:text-xs bg-zinc-800/80 backdrop-blur text-zinc-400 [@media(hover:hover)]:hover:text-zinc-200 [@media(hover:hover)]:hover:bg-zinc-700/80 transition-colors border border-zinc-600/50';
    const activeClass = 'px-3 py-2 md:px-2 md:py-1 rounded text-sm md:text-xs bg-blue-500/20 backdrop-blur text-blue-400 [@media(hover:hover)]:hover:bg-blue-500/30 transition-colors border border-blue-500/30';

    // Drive the button visuals from the viewport's change events so it stays in
    // sync whether the user clicked it or paint mode forced edges on/off.
    const applyState = (visible: boolean) => {
      wireBtn.className = visible ? activeClass : inactiveClass;
      wireBtn.title = visible ? 'Hide mesh edges' : 'Show mesh edges';
    };
    applyState(isWireframeVisible());
    onWireframeChange(applyState);

    wireBtn.addEventListener('click', () => {
      setWireframeVisible(!isWireframeVisible());
    });
  }

  function initGridToggle(container: HTMLElement) {
    const gridBtn = container.querySelector('#grid-toggle') as HTMLButtonElement;
    if (!gridBtn) return;

    const inactiveClass = 'px-2 py-1 rounded text-xs bg-zinc-800/80 backdrop-blur text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700/80 transition-colors border border-zinc-600/50';
    const activeClass = 'px-2 py-1 rounded text-xs bg-blue-500/20 backdrop-blur text-blue-400 hover:bg-blue-500/30 transition-colors border border-blue-500/30';

    gridBtn.addEventListener('click', () => {
      const nowVisible = !isGridVisible();
      setGridVisible(nowVisible);
      gridBtn.className = nowVisible ? activeClass : inactiveClass;
      gridBtn.title = nowVisible ? 'Hide grid plane' : 'Show grid plane';
    });
  }

  function initDimensionsToggle(container: HTMLElement) {
    const dimBtn = container.querySelector('#dimensions-toggle') as HTMLButtonElement;
    if (!dimBtn) return;

    const inactiveClass = 'px-2 py-1 rounded text-xs bg-zinc-800/80 backdrop-blur text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700/80 transition-colors border border-zinc-600/50';
    const activeClass = 'px-2 py-1 rounded text-xs bg-blue-500/20 backdrop-blur text-blue-400 hover:bg-blue-500/30 transition-colors border border-blue-500/30';

    dimBtn.addEventListener('click', () => {
      const nowVisible = !isDimensionsVisible();
      setDimensionsVisible(nowVisible);
      dimBtn.className = nowVisible ? activeClass : inactiveClass;
      dimBtn.title = nowVisible ? 'Hide bounding box dimensions' : 'Show bounding box dimensions';
    });
  }

  function initOrbitLockToggle(container: HTMLElement) {
    const lockBtn = container.querySelector('#orbit-lock-toggle') as HTMLButtonElement;
    if (!lockBtn) return;

    const inactiveClass = 'px-2 py-1 rounded text-xs bg-zinc-800/80 backdrop-blur text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700/80 transition-colors border border-zinc-600/50';
    const activeClass = 'px-2 py-1 rounded text-xs bg-amber-500/20 backdrop-blur text-amber-400 hover:bg-amber-500/30 transition-colors border border-amber-500/30';

    function reflect(locked: boolean) {
      lockBtn.className = locked ? activeClass : inactiveClass;
      lockBtn.textContent = locked ? '\uD83D\uDD12 Lock' : '\uD83D\uDD13 Lock';
      lockBtn.title = locked ? 'Unlock camera rotation' : 'Lock camera rotation';
    }

    lockBtn.addEventListener('click', () => {
      setUserOrbitLock(!isUserOrbitLocked());
    });

    // Keep the icon in sync when the lock state changes from any source
    // (e.g. pen/text/select activate, programmatic API).
    onUserOrbitLockChange(reflect);
    reflect(isUserOrbitLocked());
  }
}

const SHORTCUTS_HINT_KEY = 'partwright-shortcuts-hint-seen';

/** One-time, non-intrusive nudge toward the `?` shortcuts cheat sheet. Only
 *  shown to users who've already finished the first-run tour (so it never
 *  competes with onboarding), and only once ever. */
function maybeShowShortcutsHint(): void {
  try {
    if (localStorage.getItem(SHORTCUTS_HINT_KEY)) return;
    if (!isTourCompleted()) return; // let first-timers finish the tour first
    localStorage.setItem(SHORTCUTS_HINT_KEY, new Date().toISOString());
  } catch {
    return; // private-mode / storage disabled — skip the hint rather than throw
  }
  setTimeout(
    () => showToast('Tip: press  ?  for keyboard shortcuts', { variant: 'neutral', durationMs: 6000 }),
    1200,
  );
}

function setStatus(el: HTMLElement, state: 'ready' | 'running' | 'error' | 'loading', text: string) {
  // Announce status changes (Ready / Running / Error) to assistive tech.
  el.setAttribute('role', 'status');
  el.setAttribute('aria-live', 'polite');
  el.textContent = text;
  el.title = text;
  el.className = 'text-xs font-mono max-w-[60%] truncate text-right ';
  switch (state) {
    case 'ready':
      el.className += 'text-emerald-400';
      break;
    case 'running':
    case 'loading':
      el.className += 'text-amber-400';
      break;
    case 'error':
      el.className += 'text-red-400';
      break;
  }
}

interface ConfirmOptions {
  /** Optional bold title above the message. */
  title?: string;
  /** Label for the confirm button. Default 'Continue'. */
  confirmLabel?: string;
  /** Label for the cancel button. Default 'Cancel'. */
  cancelLabel?: string;
}

/** Modal confirmation dialog with semi-transparent backdrop overlay.
 *  Message preserves newlines (single `\n` becomes a soft break, `\n\n` a
 *  paragraph break) so callers can lay out multi-line prompts cleanly.
 *  Returns a Promise that resolves true (confirm) or false (cancel / Escape / click overlay). */
function showInlineConfirm(_container: HTMLElement, message: string, options: ConfirmOptions = {}): Promise<boolean> {
  return new Promise((resolve) => {
    // Remove any existing modal
    document.querySelector('.confirm-modal-overlay')?.remove();

    // Backdrop overlay
    const overlay = document.createElement('div');
    overlay.className = 'confirm-modal-overlay fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center';

    // Modal box — wider than the default 'max-w-sm' so multi-line prompts
    // don't reflow into long thin columns.
    const modal = document.createElement('div');
    modal.className = 'bg-zinc-800 border border-zinc-600 rounded-xl shadow-2xl p-5 max-w-md mx-4 animate-modal-in';

    if (options.title) {
      const title = document.createElement('h2');
      title.className = 'text-zinc-100 text-base font-semibold mb-2';
      title.textContent = options.title;
      modal.appendChild(title);
    }

    const msg = document.createElement('p');
    // `whitespace-pre-line` preserves \n as line breaks while still collapsing
    // other whitespace runs, so single-line callers behave unchanged.
    msg.className = 'text-zinc-200 text-sm leading-relaxed mb-5 whitespace-pre-line';
    msg.textContent = message;

    const btnGroup = document.createElement('div');
    btnGroup.className = 'flex items-center justify-end gap-2';

    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'px-4 py-1.5 rounded-lg text-sm text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700 transition-colors';
    cancelBtn.textContent = options.cancelLabel ?? 'Cancel';

    const continueBtn = document.createElement('button');
    continueBtn.className = 'px-4 py-1.5 rounded-lg text-sm font-medium bg-blue-600 text-white hover:bg-blue-500 transition-colors';
    continueBtn.textContent = options.confirmLabel ?? 'Continue';

    btnGroup.appendChild(cancelBtn);
    btnGroup.appendChild(continueBtn);
    modal.appendChild(msg);
    modal.appendChild(btnGroup);
    overlay.appendChild(modal);

    let resolved = false;
    function finish(result: boolean) {
      if (resolved) return;
      resolved = true;
      overlay.remove();
      document.removeEventListener('keydown', onKey);
      resolve(result);
    }

    continueBtn.addEventListener('click', () => finish(true));
    cancelBtn.addEventListener('click', () => finish(false));

    // Click on overlay (outside modal) dismisses
    overlay.addEventListener('mousedown', (e) => {
      if (e.target === overlay) finish(false);
    });

    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') finish(false);
    }
    document.addEventListener('keydown', onKey);

    document.body.appendChild(overlay);
    continueBtn.focus();
  });
}

main().catch(console.error);
