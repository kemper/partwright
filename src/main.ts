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
import { initEngine, executeCode, executeCodeAsync, validateCodeAsync, ensureEngineReady, getModule, getActiveLanguage, setActiveLanguage, exportLastBrepAsSTEP, importSTEPToBrep, importSTEPToMesh, clearBrepImports, clearBrepShape, simplifyInWorker, enhanceInWorker, cancelCurrentExecution, type Language } from './geometry/engine';
import { onQualitySettingsChange } from './geometry/qualitySettings';
import { resolveParamValues, pruneParamValues, type ParamSpec, type ParamValue } from './geometry/params';
import { createParamsPanel, type ParamsPanelController } from './ui/paramsPanel';
import { sliceAtZ, getBoundingBox } from './geometry/crossSection';
import { initViewport, updateMesh, clearMesh, setOnMeshUpdate, setOnContextLost, setOnContextRestored, setClipping, setClipZ, getClipState, getCameraState, getCanvas, getMeshGroup, getCamera, setMeasureLock, setUserOrbitLock, isUserOrbitLocked, onUserOrbitLockChange, setDimensionsVisible, isDimensionsVisible, setGridVisible, isGridVisible, setWireframeVisible, isWireframeVisible, onWireframeChange } from './renderer/viewport';
import { renderCompositeCanvas, renderSingleView, renderSingleViewCanvas, renderSliceSVG, setImages as _setImages, clearImages as _clearImages, getImages as _getImages, buildViewCamera, RENDER_VIEW_MODES, EDGE_MODES, STANDARD_VIEWS, type AttachedImage, type RenderViewMode, type EdgeMode } from './renderer/multiview';
import { generateId, getLatestVersion } from './storage/db';
import { setPhantom, clearPhantom, hasPhantom, type PhantomOptions } from './renderer/phantomGeometry';
import { initEditor, setValue, getValue, setLanguage as setEditorLanguage, setEditorDiagnostics, clearEditorDiagnostics, revealFirstDiagnostic, formatCode, openFindReplace, getAutoFormat, setAutoFormat, editorContentDiffersFrom } from './editor/codeEditor';
import { createLayout, type TabName } from './ui/layout';
import { createToolbar, isAutoRun, setAutoRun, setToolbarLanguage, setAiToolbarState, setRunState } from './ui/toolbar';
import { installKeyboardShortcuts } from './ui/keyboardShortcuts';
import { registerCommands } from './ui/commandPalette';
import { showQualitySettingsModal } from './ui/qualitySettingsModal';
import { combo, MOD_LABEL, SHIFT_LABEL, ALT_LABEL } from './ui/shortcutDefs';
import { showToast } from './ui/toast';
import { initAiPanel, setActiveSession as setAiActiveSession, toggleAiPanel, toggleAiPanelFromToolbar, prefillAiInput } from './ui/aiPanel';
import { getKey, mergeChatBucket } from './ai/db';
import { requestPersistentStorage } from './storage/persist';
import { aiConnectionMode, reloadSettingsFromStorage, getRenderBudget, getSpendingSummary, setSpendingMode as applyAiSpendingMode } from './ai/settings';
import { createLandingPage } from './ui/landing';
import { createHelpPage } from './ui/help';
import { createLegalPage } from './ui/legal';
import { showExportOptionsDialog } from './ui/exportOptionsDialog';
import { showExportConfirm, hasExportWarning, type ExportWarningInfo } from './ui/exportConfirmModal';
import { createCatalogPage, type CatalogManifestEntry } from './ui/catalog';
import { createIdeasPage } from './ui/ideasPage';
import type { Idea } from './ideas/ideas';
import { createWhatsNewPage } from './ui/whatsNew';
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
import { exportVOX, buildVOX } from './export/vox';
import { assertFiniteMesh } from './export/meshClean';
import { exportSessionJSON, exportRawCode, buildSessionJSON, buildRawCode } from './export/session';
import { blobToBase64, downloadBlob, getExportFilename } from './export/download';
import {
  listExports as listInboxExports,
  getExport as getInboxExport,
  clearExports as clearInboxExports,
  registerExport as registerInboxExport,
  hydrateExportInbox,
} from './export/exportInbox';
import {
  registerImportSnapshot,
  classifyImportSource,
  hydrateImportInbox,
  type ImportInboxEntry,
  type ImportMetadata,
} from './import/importInbox';
import { createThumbnailFromImageData } from './import/imageThumbnail';
import { showImportPreview, summarizeSessionImport } from './ui/importPreview';
import { showImportUrlModal } from './ui/importUrlModal';
import {
  filenameFromUrl,
  classifyRemoteResource,
  ensureExtensionForSource,
  MAX_REMOTE_BYTES,
} from './import/urlImport';
import { showImportTargetModal } from './ui/importTargetModal';
import { showImageVoxelImportModal, type ImageVoxelModalResult } from './ui/imageVoxelImportModal';
import { showImageImportKindModal } from './ui/imageImportKindModal';
import { showStepImportTargetModal } from './ui/stepImportTargetModal';
import { showLanguageHelpModal } from './ui/languageHelpModal';
import { showMergePartsModal } from './ui/mergePartsModal';
import { parseSTL } from './import/parsers/stl';
import { parseVox } from './import/parsers/vox';
import { generateImportCode } from './import/codegen';
import { imageDataToVoxelGrid, generateVoxelImportCode, type ImageToVoxelOptions } from './import/imageToVoxel';
import { runVoxelForPaint } from './geometry/engines/voxel';
import type { VoxelGrid } from './geometry/voxel/grid';
import * as voxelPaint from './color/voxelPaint';
import { setActiveImports, getActiveImports, type ImportedMesh } from './import/importedMesh';
import { applyFuzzy, applyKnit, applyCable, applyWaffle, applyFur, applyWoven, applySmooth, applyVoxelize, applyScale, defaultFuzzyOptions, defaultKnitOptions, defaultCableOptions, defaultWaffleOptions, defaultFurOptions, defaultWovenOptions, defaultSmoothOptions, modelDiagonal, type ModifierResult } from './surface/modifiers';
import { nearestTriangleMap } from './surface/colorTransfer';
import { initSurfaceUI } from './ui/surfaceModal';
import { initResizeUI } from './ui/resizeModal';
import { generateRelief, generateReliefFromSvg } from './relief/imageToRelief';
import { DEFAULT_RELIEF_OPTIONS, type ReliefOptions, type ReliefImportMode, type ReliefCommonOptions, type SeedRegion, type PreviewMode, type GenerateReliefResult } from './relief/types';
import { computeReliefTriColors, getSwapGuideFor, setPreviewMode as ctlSetReliefPreviewMode, getPreviewMode as ctlGetReliefPreviewMode, isPreviewActive as isReliefPreviewActive } from './relief/reliefController';
import { setReliefSettings, getReliefSettings, updateReliefSettings, isReliefSession, getPreviewModeFor } from './relief/reliefSettings';
import { saveReliefSource, getReliefSource } from './relief/reliefSource';
import { listFilaments, hexToRgb } from './relief/filaments';
import { meshBounds } from './color/slabPaint';
import { openReliefImportModal } from './ui/reliefImportModal';
import { mountReliefStudio, type ReliefStudioHandle } from './ui/reliefStudio';
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
import { initVoxelPaintUI, setVoxelPaintAvailable, syncActiveState as syncVoxelPaintUI } from './color/voxelPaintUI';
import { initSimplifyUI, isSimplifyOpen, refreshSimplifyIfOpen, forceDeactivate as closeSimplifyMenu, type SimplifyHandlers } from './ui/simplifyUI';
import { updatePaintMesh, setOnRegionPainted } from './color/paintMode';
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
import { applyTriColors, applyTriColorsIfVisible, hasRegions as hasColorRegions, onChange as onColorRegionsChange, onVisibilityChange as onPaintVisibilityChange, clearRegions, serialize as serializeRegions, addRegion, getRegions, removeRegion, removeLastRegion, redoLastRegion, setRegionVisibility, setRegionTriangles, buildTriColors, createEmptyTriColors, overlayPainted, setModelColorRegions, hasModelColorRegions, clearModelColorRegions, getModelRegions, type SerializedColorRegion, type RegionDescriptor } from './color/regions';
import { setPaintLabels } from './color/labels';
import { setBucketTolerance as setPaintBucketTolerance, getBucketTolerance as getPaintBucketTolerance, setBrushRadius as setPaintBrushRadius, getBrushRadius as getPaintBrushRadius, setBrushSmooth as setPaintBrushSmooth, isBrushSmooth as isPaintBrushSmooth, setBrushSmoothDivisor as setPaintBrushSmoothDivisor, getBrushSmoothDivisor as getPaintBrushSmoothDivisor, setBrushSurface as setPaintBrushSurface, getBrushSurface as getPaintBrushSurface, setBrushPaintDepth as setPaintBrushDepth, getBrushPaintDepth as getPaintBrushDepth, SMOOTH_DIVISOR_MIN, SMOOTH_DIVISOR_MAX } from './color/paintMode';
import { buildStrokeMesh, buildRefinedMesh, brushRefineRegion, strokeFootprintTriangles, deriveSampleNormals, buildGeodesicField, tangentBasis, childrenByParent, type BrushStroke, type BrushShape, type RefineRegion } from './color/subdivide';
import { refineInWorker, SubdivisionAbortError, terminateSubdivisionWorker } from './color/subdivisionClient';
import { startProgress, endProgress, __setProgressModalDelayForTests } from './ui/progressModal';
import { syncLockState, disableRun, enableRun } from './color/editorLock';
import { setReadOnlyReason } from './editor/editorAccess';
import { asLanguage } from './storage/languageFallback';
import { encodeShare, decodeShare, validateSharePayloadShape, ShareUnsupportedError } from './share/shareLink';
import { openShareModal, renderSharedBanner, renderSharedOverlay } from './share/shareUI';
import { buildAdjacency, findCoplanarRegion, findConnectedFromSeed, resolveSeed, findNearestTriangle, type AdjacencyGraph } from './color/adjacency';
import { findSlabTriangles, slabRefineRegion, smoothEdgeForResolution } from './color/slabPaint';
import { findBoxTriangles, findShapeTriangles, shapeRefineRegion } from './color/boxPaint';
import { cylinderRefineRegion, findCylinderTriangles } from './color/cylinderPaint';
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
  readDraft,
  writeDraft,
  effectiveVersionLanguage,
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
  importSessionPartsIntoActive,
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
import { isQuotaError } from './storage/quota';
import { isolationSupported } from './geometry/isolation';
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
  computePrintability,
  checkAssertions,
  type GeometryAssertions,
} from './geometry/statsComputation';
import { getConfig } from './config/appConfig';

// Load examples as raw text — JS and SCAD
const jsExampleModules = import.meta.glob('../examples/*.js', { query: '?raw', import: 'default' });
const scadExampleModules = import.meta.glob('../examples/*.scad', { query: '?raw', import: 'default' });

export interface ExampleEntry {
  code: string;
  language: Language;
}

// Customizer state. `currentParamSchema` is the parameter schema the active
// model declared via `api.params({...})` on its last run (null when it declared
// none); `currentParamValues` holds the user's overrides (only keys differing
// from defaults — pruned each run). `paramsPanel` is the viewport overlay that
// renders the schema as widgets. All three are kept in sync by runCodeSync.
let currentParamSchema: ParamSpec[] | null = null;
let currentParamValues: Record<string, ParamValue> = {};
let paramsPanel: ParamsPanelController | null = null;

/** Reconcile the Customizer panel + override state with the parameter schema a
 *  model declared on its latest run. Pass `undefined` when the model declared
 *  none (hides the panel and clears overrides). */
function syncParamsPanel(schema: ParamSpec[] | undefined): void {
  if (schema && schema.length > 0) {
    currentParamSchema = schema;
    // Keep only overrides the model still declares (drops stale keys from a
    // previously-run model) and store the minimal non-default set.
    currentParamValues = pruneParamValues(schema, currentParamValues);
    paramsPanel?.update(schema, resolveParamValues(schema, currentParamValues));
  } else {
    currentParamSchema = null;
    currentParamValues = {};
    paramsPanel?.update(undefined, {});
  }
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
/** Id of the most recently created brushStroke region that is still awaiting
 *  the worker's triangle resolution. `handlePaintCancel` removes exactly this
 *  region on a user cancel — narrowing to the id avoids wiping an unrelated
 *  brushStroke region that legitimately resolved to zero triangles. Cleared
 *  once the stroke's refine lands (or its cancel is handled). */
let pendingStrokeRegionId: number | null = null;
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
/** Per-run list of label names the user wrote but that didn't make it into
 *  `currentLabelMap` — typically because the label sat inside a SCAD boolean
 *  the CGAL backend stripped, or a for-loop expansion produced a count
 *  mismatch. Surfaced to agent callers via `runAndSave().lostLabels` and
 *  `listLabels().lostLabels` so they don't have to diff by hand. */
let currentLostLabels: string[] | null = null;

// #geometry-data element — always-updated machine-readable state
let geometryDataEl: HTMLElement;
// Viewport overlay pill — shows printability issues after each successful run.
let printabilityIndicatorEl: HTMLElement | null = null;

// === Shared-link preview mode ===
//
// When the editor is showing a decoded share link (`/editor#share=…`), it is a
// strictly READ-ONLY preview of UNTRUSTED code: nothing the sharer wrote may
// execute until the viewer explicitly Forks. This module-scoped flag is the
// chokepoint guard — every code-execution entry point bails while it's set:
// `runCode`/`runCodeSync` (and the console `partwright.run()`/`runAndSave()`
// that route through them), `executeIsolated` (which backs the AI-exposed
// `runIsolated`/`runAndAssert`/`runDecompose`, modify/test, and forkVersion),
// and `setReferenceGeometry`, plus `saveCurrentVersion` and the export actions.
// It's separate from the CodeMirror read-only flag (which only blocks typing)
// and from the multi-tab viewer flag.
let _sharedPreview = false;

/** Error string returned by the execution chokepoints while a read-only shared
 *  preview is on screen — the sharer's untrusted code must not run until Fork. */
const SHARED_PREVIEW_REFUSAL = 'Read-only shared preview — fork this design first to run code.';

/** True while the editor is showing a decoded share link (read-only preview).
 *  Execution + save chokepoints bail when this returns true. */
function isSharedPreview(): boolean {
  return _sharedPreview;
}

/** The encoded value of the current `#share=` hash, or null when the hash isn't
 *  a share link. Used to detect share links and to guard hashchange re-entrancy. */
function getShareHashValue(): string | null {
  const hash = window.location.hash;
  if (!hash.startsWith('#share=')) return null;
  const value = hash.slice('#share='.length);
  return value.length > 0 ? value : null;
}

/** True when the URL hash carries a share link. */
function hasShareHash(): boolean {
  return getShareHashValue() !== null;
}

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

function updateDocumentTitle(context?: { page?: 'landing' | 'editor' | 'help' | '404' | 'catalog' | 'ideas' | 'legal' | 'whats-new'; sessionName?: string | null }) {
  let route: RouteName;
  let titleOverride: string | undefined;
  if (context?.page === 'landing' || (context?.page === undefined && shouldShowLanding())) {
    route = 'landing';
  } else if (context?.page === 'help') {
    route = 'help';
  } else if (context?.page === 'catalog') {
    route = 'catalog';
  } else if (context?.page === 'ideas') {
    route = 'ideas';
  } else if (context?.page === 'legal') {
    route = 'legal';
  } else if (context?.page === 'whats-new') {
    route = 'whats-new';
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
  if (printabilityIndicatorEl) {
    const { printable, issues } = computePrintability(data);
    if (printable) {
      printabilityIndicatorEl.style.display = 'none';
    } else {
      printabilityIndicatorEl.textContent = '⚠ ' + issues.join(' · ');
      printabilityIndicatorEl.style.display = '';
    }
  }
}

/** How long to wait for `canvas.toBlob` before giving up on the thumbnail.
 *  `toBlob` can stall indefinitely when encoding a 2D canvas that a WebGL render
 *  was composited into (observed after painting subdivides + colors the mesh) —
 *  the GPU readback never settles the callback. A thumbnail is non-essential, so
 *  we cap the wait and let the save proceed without it rather than hang forever
 *  (which silently blocked saving a painted version). */

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
    const timer = setTimeout(() => finish(null), getConfig().renderer.thumbnailTimeoutMs);
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
  if (d.kind === 'slab' || d.kind === 'box' || d.kind === 'cylinder') {
    return !!d.smooth && (d.maxEdge ?? 0) > 0;
  }
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
    } else if (d.kind === 'cylinder' && descriptorRefines(d)) {
      regions.push(cylinderRefineRegion(d.center, d.rMin, d.rMax, d.zMin, d.zMax, d.maxEdge!));
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
    case 'cylinder': {
      // Same triangle collector `paintInCylinder` uses for the live call —
      // re-resolves the shell against the (possibly subdivided) current mesh
      // so smoothing-driven refinement carries forward across re-runs.
      const { center, rMin, rMax, zMin, zMax, normalCone, coverageMode, maxTriangleArea } = descriptor;
      return findCylinderTriangles(mesh, center, rMin, rMax, zMin, zMax, normalCone, coverageMode ?? 'centroid', maxTriangleArea);
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
      const { seedPoint, seedNormal, maxDeviationDeg, clampMin, clampMax } = descriptor;
      // Find the closest triangle to the seed point — robust across re-runs
      // because triangle indices are unstable but world-space points are not.
      // Then BFS-flood gated by deviation from the stored seed normal.
      const nearest = findNearestTriangle(seedPoint, mesh, adjacency);
      if (nearest.triIndex < 0) return new Set<number>();
      const cos = Math.cos(maxDeviationDeg * Math.PI / 180);
      // Restore the original clamp predicate so re-resolution after a
      // geometry edit walks the same bounded region the user painted.
      const predicate = (clampMin || clampMax)
        ? (cx: number, cy: number, cz: number) =>
            cx >= (clampMin?.[0] ?? -Infinity) && cx <= (clampMax?.[0] ?? Infinity) &&
            cy >= (clampMin?.[1] ?? -Infinity) && cy <= (clampMax?.[1] ?? Infinity) &&
            cz >= (clampMin?.[2] ?? -Infinity) && cz <= (clampMax?.[2] ?? Infinity)
        : undefined;
      let triangles = findConnectedFromSeed(nearest.triIndex, adjacency, cos, predicate);
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
  // Relief sessions in a non-flat preview mode show the optical (translucent /
  // glossy) composite instead of raw region colors. This is the one chokepoint
  // every paint path funnels through, so the preview tracks strokes, undo/redo,
  // and programmatic paints alike.
  const sid = getState().session?.id ?? null;
  if (sid && isReliefSession(sid) && isReliefPreviewActive()) {
    const lh = getReliefSettings(sid)?.layerHeight ?? 0.08;
    const preview = computeReliefTriColors(currentMeshData, lh);
    if (preview) {
      updateMesh({ ...currentMeshData, triColors: preview }, { skipAutoFrame: true });
      return;
    }
  }
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
    // Mirror the async tick (see reconcilePaintedGeometryAsyncTick) — color
    // mutations from the Edit colors panel must refresh the mesh even when
    // the Paint UI is closed.
    paintedColorRefresh();
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
  const region = withSyncReconcile(() => addRegion(name, color, 'paintbrush', descriptor, new Set<number>()));
  // Track this as the in-flight stroke so a user cancel removes exactly it.
  pendingStrokeRegionId = region.id;
  return region;
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
    // Re-bake per-triangle colours regardless of whether the Paint UI is
    // open — the Relief Studio's Edit colors panel also mutates regions
    // (updateRegionColor / removeRegion) and the user expects the model to
    // update in realtime from there too. paintedColorRefresh is a no-op
    // when there are no regions or paint visibility is off, so calling it
    // unconditionally is cheap.
    paintedColorRefresh();
    return;
  }

  // Pure append: one new stroke at the end, prior strokes unchanged.
  if (strokesNow.length === lastStrokeList.length + 1 && prefixRefEqual(strokesNow, lastStrokeList)) {
    const newDesc = strokesNow[strokesNow.length - 1] as Extract<RegionDescriptor, { kind: 'brushStroke' }>;
    try {
      await appendStrokeRefineAsync(newDesc);
      // The stroke resolved successfully, so it's no longer a cancel orphan.
      pendingStrokeRegionId = null;
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
  // Drop the orphaned brushStroke region (empty triangles → unresolved). We
  // remove exactly the region this cancelled stroke added (tracked by id at
  // creation), still requiring its triangle set to be empty — removing every
  // zero-triangle brushStroke region would also wipe an unrelated region that
  // legitimately resolved to zero triangles.
  const cancelledId = pendingStrokeRegionId;
  pendingStrokeRegionId = null;
  const orphans = cancelledId == null
    ? []
    : getRegions().filter(r => r.id === cancelledId && r.descriptor.kind === 'brushStroke' && r.triangles.size === 0);
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
  if (isSharedPreview()) {
    return { error: 'This is a read-only shared preview. Fork it first to make edits you can save.' };
  }
  if (!getState().session) {
    return { error: 'No active session. Call createSession() or openSession(id) first.' };
  }
  if (isReadOnlyViewer()) {
    return { error: 'This session is open and being edited in another tab. Use "Take over" in the viewer banner to edit here.' };
  }
  const thumbnail = await captureThumbnail();
  const version = await saveVersion(getValue(), enrichGeometryDataWithColors(getGeometryDataObj()), thumbnail, label, undefined, { paramValues: currentParamValues });
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
  // AND no share-link hash (a bare `/#share=…` must open the shared preview, not
  // the landing page).
  const isRootPath = path === '/' || path === '';
  return isRootPath && !hasShareHash() && !params.has('view') && !params.has('session') && !params.has('gallery') && !params.has('versions') && !params.has('images') && !params.has('diff') && !params.has('notes') && !params.has('data');
}

function shouldShowHelp(): boolean {
  // A `/help#share=…` link must open the shared preview (editor), not Help —
  // mirrors shouldShowLanding's share-hash exclusion.
  return window.location.pathname === '/help' && !hasShareHash();
}

function shouldShowCatalog(): boolean {
  return window.location.pathname === '/catalog' && !hasShareHash();
}

function shouldShowIdeas(): boolean {
  return window.location.pathname === '/ideas' && !hasShareHash();
}

function shouldShowWhatsNew(): boolean {
  return window.location.pathname === '/whats-new';
}

function shouldShowLegal(): boolean {
  return window.location.pathname === '/legal';
}

function shouldShow404(): boolean {
  if (hasShareHash()) return false;
  const path = window.location.pathname;
  return path !== '/' && path !== '' && path !== '/help' && path !== '/editor' && path !== '/catalog' && path !== '/ideas' && path !== '/legal' && path !== '/whats-new';
}

/** True when the editor view is the active page. Editor-scoped command-palette
 *  actions (tab switches, the guided tour) gate on this so they don't fire from
 *  the landing / help / catalog pages — which would rewrite the URL to
 *  `/editor?…` and toggle hidden panes without ever transitioning into the
 *  editor. A `#share=…` link also lands in the editor, so it counts too. */
function isEditorActive(): boolean {
  return window.location.pathname === '/editor' || hasShareHash();
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

  // Rehydrate the Recent Imports / Recent Exports lists from IndexedDB so they
  // survive a refresh. Fire-and-forget: each notifies its subscribers (the
  // toolbar dropdowns) when the load completes, so boot isn't blocked on IDB
  // and the order relative to toolbar mount doesn't matter.
  void hydrateImportInbox();
  void hydrateExportInbox();

  // If the user already has a saved API key, ask the browser to make storage
  // persistent so it isn't evicted under storage pressure (mobile browsers,
  // iOS Safari ITP especially, evict best-effort IndexedDB and wipe the key).
  // New saves request this from putKey; this covers installs keyed before that
  // shipped. Gated on having a key so we don't prompt (Firefox) unprompted users.
  void (async () => {
    const keyed = await Promise.all(
      (['anthropic', 'openai', 'gemini', 'custom'] as const).map((p) => getKey(p)),
    );
    if (keyed.some(Boolean)) void requestPersistentStorage();
  })();

  // Remove loading overlays as soon as JS takes over.
  // landing-inline stays visible on the landing route until showLandingPage()
  // replaces it with the JS-built version; remove it immediately on all other routes.
  document.getElementById('loading-splash')?.remove();
  if (!shouldShowLanding()) {
    document.getElementById('landing-inline')?.remove();
  }

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
  editorUI.className = 'flex flex-col flex-1 min-h-0 w-full hidden';

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
    // Seed the active-imports register with each version's own meshes before
    // running its code: `Manifold.ofMesh(api.imports[0])` only reproduces this
    // version's geometry (and thus a correct thumbnail) if the register holds
    // these meshes — otherwise the run captures a stale, previously-loaded part.
    // importSession resets the register to the latest version's imports when it
    // finishes, so no manual restore is needed here.
    const session = await importSession(data, async (code, importedMeshes) => {
      setActiveImports(importedMeshes ?? []);
      await runCodeSync(code);
      return captureThumbnail();
    });
    const version = await openSession(session.id);
    if (version) await loadVersionIntoEditor(version);
    return { sessionId: session.id };
  }

  // Cancel an active voxel-paint session. Its live grid + per-triangle
  // provenance map are bound to the OUTGOING code, so it must stop before we
  // load or import different code — otherwise a later click/bake writes into the
  // wrong model. Safe no-op when paint isn't active.
  function cancelVoxelPaintIfActive(): void {
    if (voxelPaint.isActive()) {
      voxelPaint.deactivate();
      syncVoxelPaintUI();
    }
  }

  // Drop the outgoing target's paint state — color regions, the model-declared
  // color underlay, and any in-flight subdivision worker job — then re-sync the
  // editor lock. These live in module state the session/part layer doesn't own,
  // so a fresh target (new session, new part, freshly imported model) must wipe
  // them or it inherits the previous one's regions: the next runCodeSync
  // re-resolves them onto the new mesh and the editor opens locked.
  function dropPaintState(): void {
    // Drop any in-flight subdivision worker job before clearing regions, so a
    // late continuation can't stamp triangle ids onto regions that no longer
    // exist (or overwrite the freshly-loaded mesh).
    resetPaintWorkerState();
    clearRegions();
    clearModelColorRegions(); // model-declared underlay is module state too
    // Annotations are module state too, scoped to the outgoing version — wipe
    // them here so an editor reset (new part / new session / fresh import) is
    // self-contained rather than relying on the session manager clearing them
    // first via loadAnnotations([]). clearAll() early-returns when already
    // empty, so this is a no-op in the common case and won't disturb the
    // per-version annotation swap on version navigation.
    clearAllAnnotations();
    syncLockState();
  }

  // Import a raw code payload as a new session. Shared between file drop and the AI API.
  async function importCodePayload(code: string, language: Language, sessionName?: string): Promise<{ sessionId: string }> {
    if (language !== getActiveLanguage()) await switchLanguage(language);
    const session = await createSession(sessionName, language);
    // A freshly imported model starts unpainted. Clear the previous session's
    // live voxel paint and color regions before running, or runCodeSync
    // re-resolves those stale regions onto the new mesh — e.g. a painted part's
    // colors bleeding onto image→voxel art — and the editor opens locked.
    cancelVoxelPaintIfActive();
    dropPaintState();
    clearMesh();
    // Clear stale params panel immediately so old controls don't linger while
    // the new model is loading — syncParamsPanel runs again after the run.
    syncParamsPanel(undefined);
    setValue(code);
    await runCodeSync(code);
    return { sessionId: session.id };
  }

  // Seed pre-computed colour regions (relief's per-colour bands, or a coloured
  // mesh import's own regions) onto the just-run mesh and repaint. Shared by the
  // mesh-placement helpers so relief's colours survive into whatever
  // part/session the import-target modal sends them to.
  function seedImportRegions(seedRegions: SeedRegion[] | undefined): void {
    if (!seedRegions || seedRegions.length === 0) return;
    for (const seed of seedRegions) {
      addRegion(seed.name, seed.color, 'subtree', { kind: 'triangles', ids: seed.triangleIds }, new Set(seed.triangleIds));
    }
    if (currentMeshData) updateMesh(applyTriColorsIfVisible(currentMeshData), { skipAutoFrame: true });
  }

  // Import a parsed mesh (STL today) as a new session.
  //
  // Unlike code imports, the parsed mesh bytes don't live in the editor — they
  // ride on the Version via `importedMeshes`. We must persist v1 immediately
  // so the imports survive a reload and so future saveVersion calls (which
  // carry forward `importedMeshes` from the prior version) have something to
  // build on.
  async function importMeshPayload(mesh: ImportedMesh, sessionName: string, opts: { manifold: boolean; seedRegions?: SeedRegion[] } = { manifold: true }): Promise<{ sessionId: string }> {
    if (getActiveLanguage() !== 'manifold-js') await switchLanguage('manifold-js');
    const session = await createSession(sessionName, 'manifold-js');
    // Fresh session: drop the previous model's paint before running the import
    // wrapper (same reason as importCodePayload). seedRegions below are added
    // AFTER this clear, so an imported colored mesh's own seeds survive.
    cancelVoxelPaintIfActive();
    dropPaintState();
    setActiveImports([mesh]);
    const code = generateImportCode([mesh], { manifold: opts.manifold });
    setValue(code);
    await runCodeSync(code);
    seedImportRegions(opts.seedRegions);
    const thumbnail = await captureThumbnail();
    const geometryData = enrichGeometryDataWithColors(getGeometryDataObj());
    const label = opts.manifold ? 'imported' : 'imported (render-only)';
    await saveVersion(code, geometryData, thumbnail, label, undefined, {
      force: true,
      importedMeshes: [mesh],
    });
    return { sessionId: session.id };
  }

  // === Relief Studio (image → printable colour tile / stepped relief) ===
  let reliefStudio: ReliefStudioHandle | null = null;
  // True only while the editor pane was collapsed by THIS module's show-studio
  // call, so the close path can restore symmetrically without clobbering a
  // pre-existing manual collapse the user set up before opening the studio.
  let studioCollapsedEditor = false;

  function currentLayerHeight(): number {
    const sid = getState().session?.id ?? null;
    return sid ? (getReliefSettings(sid)?.layerHeight ?? 0.08) : 0.08;
  }

  // Single source of truth for recoloring the displayed mesh: relief preview
  // when active (and only in a relief session — the preview mode is a module
  // global, so gating on isReliefSession keeps a leftover mode from bleeding
  // onto a normal session's mesh), otherwise the normal painted-region colors.
  // Relief preview + normal painted-region coloring share one chokepoint
  // (module-level paintedColorRefresh) so the smooth-brush reconcile path and
  // the relief/AI paths stay in sync.
  function refreshModelColors(): void {
    paintedColorRefresh();
  }

  // Restore the saved preview mode for the active session (reset to 'flat' for
  // non-relief sessions so the global never carries over).
  function syncReliefPreviewFromSettings(): void {
    const sid = getState().session?.id ?? null;
    ctlSetReliefPreviewMode(isReliefSession(sid) ? getPreviewModeFor(sid) : 'flat');
  }

  function showReliefStudio(): void {
    if (!reliefStudio) return;
    syncReliefPreviewFromSettings();
    if (!studioCollapsedEditor) {
      collapseEditor();
      studioCollapsedEditor = true;
    }
    reliefStudio.show();
    reliefStudio.setChipVisible(false);
    reliefStudio.refresh();
  }

  function closeReliefStudio(): void {
    if (!reliefStudio) return;
    reliefStudio.hide();
    // Surface the "Edit colors" chip so users can find their way back to the
    // palette without remembering the toolbar button.
    const sid = getState().session?.id ?? null;
    reliefStudio.setChipVisible(isReliefSession(sid));
    if (studioCollapsedEditor) { expandEditor(); studioCollapsedEditor = false; }
  }

  function toggleReliefStudio(): void {
    if (!reliefStudio) return;
    const sid = getState().session?.id ?? null;
    // No relief session yet — the studio's filaments/swap-guide/etc. are
    // contextless. Send the user to the import wizard so the button has an
    // intuitive meaning regardless of whether they've made a relief yet.
    if (!isReliefSession(sid) && !reliefStudio.isOpen()) {
      openReliefImportFlow();
      return;
    }
    if (reliefStudio.isOpen()) closeReliefStudio();
    else showReliefStudio();
  }

  // Show/hide the studio in response to a session change. Keeps the panel from
  // hovering over an unrelated session, and re-syncs the preview mode pills
  // from the new session's saved settings.
  function syncReliefStudioForSession(): void {
    if (!reliefStudio) return;
    const sid = getState().session?.id ?? null;
    if (isReliefSession(sid)) showReliefStudio();
    else {
      // Non-relief session — hide the panel AND the re-open chip; the chip
      // is only meaningful for image-derived sessions.
      if (reliefStudio.isOpen()) reliefStudio.hide();
      reliefStudio.setChipVisible(false);
      if (studioCollapsedEditor) { expandEditor(); studioCollapsedEditor = false; }
    }
  }

  // Clamp the common knobs to sane physical/perf bounds. The wizard enforces
  // these via input attributes, but the programmatic (AI/console) path bypasses
  // the UI, so guard here against OOM (huge resolution) and degenerate values.
  // Clamp the quantized + tile knobs to safe bounds. The wizard enforces these
  // via input min/max, but the programmatic (AI/console) path bypasses the UI,
  // so guard against an OOM hang (e.g. clusters=1e6) and degenerate tile sizes.
  // Image pre-processing knobs: defaults are no-op so unset fields pass through
  // untouched. Caps keep the API path from over-saturating / inverting wildly.
  function clampReliefPreprocess(p: ReliefOptions['preprocess'] | undefined): ReliefOptions['preprocess'] {
    const num = (v: number, def: number) => (Number.isFinite(v) ? v : def);
    const defaults = DEFAULT_RELIEF_OPTIONS.preprocess;
    if (!p) return { ...defaults };
    return {
      brightness: Math.max(-1, Math.min(1, num(p.brightness, defaults.brightness))),
      contrast: Math.max(-1, Math.min(1, num(p.contrast, defaults.contrast))),
      saturation: Math.max(-1, Math.min(1, num(p.saturation, defaults.saturation))),
      levelsLow: Math.max(0, Math.min(254, Math.floor(num(p.levelsLow, defaults.levelsLow)))),
      levelsHigh: Math.max(1, Math.min(255, Math.floor(num(p.levelsHigh, defaults.levelsHigh)))),
    };
  }

  function clampReliefQuantized(q: ReliefOptions['quantized']): ReliefOptions['quantized'] {
    const num = (v: number, def: number) => (Number.isFinite(v) ? v : def);
    const widthGuess = 200; // generous clamp range; real bounds enforced by tile mesh
    const clampHole = (h: { cxMm?: number; cyMm?: number; diameterMm?: number }) => ({
      cxMm: num(h.cxMm ?? 0, 0),
      cyMm: num(h.cyMm ?? 0, 0),
      diameterMm: Math.max(0.5, Math.min(widthGuess, num(h.diameterMm ?? 6, 6))),
    });
    // Migrate the legacy single-hole knobs to holes[] when no explicit array is
    // present — keeps saved presets and old API callers working.
    let holes: ReliefOptions['quantized']['holes'] = Array.isArray(q.holes)
      ? q.holes.map(clampHole)
      : [];
    if (holes.length === 0 && q.holeEnabled) {
      const widthMm = 100;
      const heightMm = widthMm; // unknown aspect at clamp time; cyMm in mm anyway
      holes = [clampHole({
        cxMm: 0,
        cyMm: heightMm / 2 - num(q.holeOffsetMm ?? 6, 6),
        diameterMm: num(q.holeDiameterMm ?? 6, 6),
      })];
    }
    return {
      clusters: Math.max(2, Math.min(12, Math.floor(num(q.clusters, 5)))),
      colorSpace: q.colorSpace === 'rgb' ? 'rgb' : 'lab',
      dither: !!q.dither,
      output: q.output === 'relief' || q.output === 'silhouette' ? q.output : 'flat',
      shape: q.shape === 'rounded' || q.shape === 'circle' ? q.shape : 'rect',
      cornerRadiusMm: Math.max(0, Math.min(50, num(q.cornerRadiusMm, 4))),
      chamferMm: Math.max(0, Math.min(5, num(q.chamferMm, 0))),
      holes,
      paintingMode: q.paintingMode === 'multi-color' ? 'multi-color' : 'single-nozzle',
      invertHeights: !!q.invertHeights,
      manualBackground: q.manualBackground,
      doubleSided: !!q.doubleSided,
      backMirror: q.backMirror !== false,
    };
  }

  function clampReliefCommon(c: ReliefCommonOptions): ReliefCommonOptions {
    const num = (v: number, def: number) => (Number.isFinite(v) ? v : def);
    return {
      widthMm: Math.max(1, Math.min(2000, num(c.widthMm, 100))),
      layerHeight: Math.max(0.02, Math.min(2, num(c.layerHeight, 0.08))),
      baseThickness: Math.max(0, Math.min(50, num(c.baseThickness, 0.6))),
      maxHeight: Math.max(0.1, Math.min(100, num(c.maxHeight, 3))),
      resolution: Math.max(8, Math.min(512, Math.floor(num(c.resolution, 200)))),
      smoothing: Math.max(0, Math.min(20, num(c.smoothing, 0))),
      removeBackground: !!c.removeBackground,
    };
  }

  // Shared finalisation step: package a generated relief result as an
  // ImportedMesh, persist the relief settings, and open the studio. Used by
  // both the raster (createReliefFromImageData) and SVG (createReliefFromSvgText)
  // entry points so the post-generation flow stays in lockstep.
  async function commitGeneratedRelief(result: GenerateReliefResult, opts: ReliefOptions, sourceName: string, sourceFile: File | null = null, isSvg = false, interactive = false): Promise<{ sessionId: string }> {
    if (result.mesh.numTri === 0) throw new Error('Source too small to build a relief — use a larger image or SVG.');
    const mesh: ImportedMesh = {
      id: generateId(),
      filename: `${sourceName}.relief`,
      format: 'relief',
      vertProperties: result.mesh.vertProperties,
      triVerts: result.mesh.triVerts,
      numVert: result.mesh.numVert,
      numTri: result.mesh.numTri,
      numProp: result.mesh.numProp,
    };
    // Quantized + SVG modes pre-compute seedRegion triangle ids in the input
    // mesh's order; Manifold.ofMesh reorders triangles internally, which would
    // scramble that mapping. Bring those imports in as render-only
    // (api.renderMesh preserves ids). Luminance imports have no pre-computed
    // ids, so they keep the real Manifold (and stay manifold:true) for
    // downstream booleans/slice.
    const hasSeeds = !!(result.seedRegions && result.seedRegions.length > 0);
    const useManifold = result.mesh.watertight && !hasSeeds;
    const seedRegions = result.seedRegions;
    // Honor the import-target choice (new part / current part / new session)
    // exactly like STL/STEP/voxel imports — relief used to always spawn a fresh
    // session via importMeshPayload, silently wiping the open part. Only the
    // INTERACTIVE wizard path shows the modal; the console/AI path
    // (importImageAsRelief/importSvgAsRelief) stays modal-free so agents — and
    // tests that import twice in one page.evaluate — never block on a click,
    // matching how voxel/image console imports already behave. Skip the modal
    // too when there's no real work to protect (no session, or an expendable
    // starter); then a fresh session is the right, non-destructive default
    // (today's behavior, and what keeps a fresh-/editor relief import
    // modal-free). The per-colour seed regions ride through new-part and
    // new-session unchanged (single-mesh order preserved). "Add to current
    // part" is disabled here: relief's seed-region triangle ids are indexed
    // against the relief mesh's own triangle order, which compose-into would
    // scramble — same out-of-scope call BREP imports make.
    let sessionId: string;
    if (!interactive || !getState().session || currentPartIsExpendable()) {
      ({ sessionId } = await importMeshPayload(mesh, sourceName, { manifold: useManifold, seedRegions }));
    } else {
      const target = await showImportTargetModal({
        title: 'Import relief',
        filename: `${sourceName}.relief`,
        currentPartName: getState().currentPart?.name ?? null,
        canAddToCurrent: false,
        addDisabledReason: 'Relief colours are keyed to this mesh, so it can only become its own part or session.',
        recommend: 'new-part',
      });
      // Cancel: leave the current part untouched and skip relief-state persistence.
      if (!target) return { sessionId: getState().session?.id ?? '' };
      if (target === 'new-session') {
        ({ sessionId } = await importMeshPayload(mesh, sourceName, { manifold: useManifold, seedRegions }));
      } else {
        // 'new-part' (default; 'current-part' is disabled above so never reached).
        // seedNewPartWithMesh runs + saves the import wrapper as the new part's
        // v1; seed the relief colours onto that version so they persist with it.
        await seedNewPartWithMesh(mesh, `${sourceName}.relief`, useManifold, seedRegions);
        sessionId = getState().session?.id ?? '';
      }
    }
    setReliefSettings(sessionId, {
      isRelief: true,
      layerHeight: opts.common.layerHeight,
      baseThickness: opts.common.baseThickness,
      previewMode: 'flat',
      options: opts,
    });
    // Persist the source so the wizard can be reopened pre-loaded (no
    // re-upload). Best-effort — saveReliefSource swallows storage errors.
    if (sourceFile) {
      await saveReliefSource(sessionId, sourceFile, sourceFile.name || `${sourceName}${isSvg ? '.svg' : '.png'}`, isSvg);
    }
    showReliefStudio();
    return { sessionId };
  }

  /** Single-nozzle stepped relief needs each cluster on its own layer-height
   *  band, otherwise two cluster filaments would have to swap mid-layer and
   *  the user would see colour stripes inside a single Z. The minimum
   *  maxHeight is `(clusters - 1) * layerHeight` — anything less can't fit. */
  function steppedReliefLayerFitError(opts: ReliefOptions): string | null {
    if (opts.mode !== 'quantized') return null;
    if (opts.quantized.output !== 'relief') return null;
    if (opts.quantized.paintingMode !== 'single-nozzle') return null;
    const lh = opts.common.layerHeight;
    const minMaxHeight = (opts.quantized.clusters - 1) * lh;
    if (opts.common.maxHeight + 1e-6 < minMaxHeight) {
      return `Single-nozzle stepped relief needs max height ≥ ${minMaxHeight.toFixed(2)} mm for ${opts.quantized.clusters} colours at ${lh} mm layers — otherwise two filaments would have to swap inside one print layer. Increase max height to at least ${minMaxHeight.toFixed(2)} mm, or reduce the cluster count.`;
    }
    return null;
  }

  async function createReliefFromImageData(image: ImageData, options: ReliefOptions, sourceName: string, sourceFile: File | null = null, interactive = false): Promise<{ sessionId: string }> {
    const opts: ReliefOptions = {
      ...options,
      common: clampReliefCommon(options.common),
      quantized: clampReliefQuantized(options.quantized),
      preprocess: clampReliefPreprocess(options.preprocess),
    };
    const fitError = steppedReliefLayerFitError(opts);
    if (fitError) throw new Error(fitError);
    const result = generateRelief(image, opts);
    return commitGeneratedRelief(result, opts, sourceName, sourceFile, false, interactive);
  }

  async function createReliefFromSvgText(svgText: string, options: ReliefOptions, sourceName: string, sourceFile: File | null = null, interactive = false): Promise<{ sessionId: string }> {
    const opts: ReliefOptions = {
      ...options,
      common: clampReliefCommon(options.common),
      quantized: clampReliefQuantized(options.quantized),
      preprocess: clampReliefPreprocess(options.preprocess),
      mode: 'svg',
    };
    const fitError = steppedReliefLayerFitError(opts);
    if (fitError) throw new Error(fitError);
    const result = await generateReliefFromSvg(svgText, opts);
    return commitGeneratedRelief(result, opts, sourceName, sourceFile, true, interactive);
  }

  // Seed color regions from an imported stepped-relief STL's existing Z plateaus so the
  // user can recolor each printed layer band. Reuses the slab selector.
  function detectReliefLevels(): void {
    if (!currentMeshData) return;
    const bounds = meshBounds(currentMeshData);
    const span = bounds.max[2] - bounds.min[2];
    if (span <= 0) return;
    // Replace-instead-of-stack: clicking the button twice used to pile 24+
    // overlapping slab regions on the mesh. Ask first, then start clean.
    if (getRegions().length > 0) {
      const ok = window.confirm('Replace existing colour regions with detected levels?');
      if (!ok) return;
      clearRegions();
    }
    const lh = currentLayerHeight();
    const maxBands = 12;
    const bandCount = Math.max(2, Math.min(maxBands, Math.round(span / Math.max(lh, span / maxBands))));
    const thickness = span / bandCount;
    const palette = listFilaments();
    for (let i = 0; i < bandCount; i++) {
      const offset = bounds.min[2] + i * thickness;
      const tris = findSlabTriangles(currentMeshData, [0, 0, 1], offset, thickness);
      if (tris.size === 0) continue;
      // palette is empty if the user hid every default filament and added no
      // custom ones; fall back to neutral grey so we colour the slab instead
      // of throwing on `fil.hex` (palette[NaN] === undefined).
      const fil = palette.length > 0 ? palette[i % palette.length] : { hex: '#808080' };
      addRegion(`Level ${i + 1}`, hexToRgb(fil.hex), 'slab', { kind: 'slab', normal: [0, 0, 1], offset, thickness }, tris);
    }
    refreshModelColors();
    reliefStudio?.refresh();
  }

  // Quick offline auto-tune used by the import wizard's "AI assist" button.
  // (A hosted-LLM suggestion path can replace this; the hook is the same.)
  function suggestReliefOptions(image: ImageData, opts: ReliefOptions): Partial<ReliefOptions> & { note?: string } {
    const total = image.width * image.height;
    if (total === 0) return { note: 'Could not analyze image.' };
    const d = image.data;
    const stride = Math.max(1, Math.floor(total / 4096));
    let n = 0, sumL = 0, sumL2 = 0, sumSat = 0;
    for (let i = 0; i < total; i += stride) {
      const p = i * 4;
      const r = d[p], g = d[p + 1], b = d[p + 2];
      const l = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
      sumL += l; sumL2 += l * l;
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
      sumSat += mx > 0 ? (mx - mn) / mx : 0;
      n++;
    }
    const mean = sumL / n;
    const contrast = Math.sqrt(Math.max(0, sumL2 / n - mean * mean));
    const sat = sumSat / n;
    if (sat > 0.35) {
      const clusters = Math.max(3, Math.min(8, Math.round(3 + sat * 6)));
      return { mode: 'quantized', quantized: { ...opts.quantized, clusters }, note: `Colorful image — suggested Color levels with ${clusters} clusters.` };
    }
    const levels = Math.max(4, Math.min(24, Math.round(6 + contrast * 40)));
    const invert = mean > 0.6;
    return { mode: 'luminance', luminance: { ...opts.luminance, levels, invert }, note: `Tonal image — suggested Luminance relief with ${levels} levels${invert ? ' (inverted)' : ''}.` };
  }

  function openReliefImportFlow(initialFile?: File, initialOptions?: ReliefOptions): void {
    openReliefImportModal({
      aiAvailable: true,
      initialFile,
      initialOptions,
      onAiAssist: async (image, opts) => suggestReliefOptions(image, opts),
      // Don't catch — let runCreate (inside the wizard) handle the error: it
      // already shows an inline aiNote and keeps the modal open so the user
      // doesn't lose their tuned settings. Swallowing here would also let the
      // wizard think the create succeeded and close itself.
      onCreate: async (image, opts, name, sourceFile) => {
        // interactive: true → the wizard is the only entry point that may show
        // the import-target modal (console/AI imports stay modal-free).
        await createReliefFromImageData(image, opts, name || 'relief', sourceFile, true);
      },
      onCreateSvg: async (svgText, opts, name, sourceFile) => {
        await createReliefFromSvgText(svgText, opts, name || 'relief', sourceFile, true);
      },
    });
  }

  /** Reopen the relief import wizard for an existing relief session, pre-loaded
   *  with its saved source image + the settings it was generated with — so the
   *  user re-tunes without re-uploading. Falls back to a blank wizard when no
   *  source was stored (old sessions, or a storage miss). */
  async function reopenReliefImport(sessionId: string): Promise<void> {
    const savedOpts = getReliefSettings(sessionId)?.options;
    // getReliefSource swallows storage errors and returns null, so a miss (old
    // session, no stored source) just falls back to a blank picker pre-filled
    // with the saved settings.
    const source = await getReliefSource(sessionId);
    openReliefImportFlow(source?.file, savedOpts);
  }

  function dataUrlToImageData(src: string): Promise<ImageData> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        const c = document.createElement('canvas');
        c.width = img.naturalWidth;
        c.height = img.naturalHeight;
        const ctx = c.getContext('2d');
        if (!ctx) { reject(new Error('no canvas 2d context')); return; }
        ctx.drawImage(img, 0, 0);
        resolve(ctx.getImageData(0, 0, c.width, c.height));
      };
      img.onerror = () => reject(new Error('image decode failed'));
      img.src = src;
    });
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
    // Show the destination chooser (new session vs merge) and import. The merge
    // option is only offered when a session is open (gated inside
    // importValidatedSession). A failure surfaces as a toast and returns false.
    try {
      return await importValidatedSession(data, filename);
    } catch (e) {
      showToast(`Import failed: ${(e as Error).message}`, { variant: 'warn' });
      return false;
    }
  }

  // Import a .partwright.json session, a raw .js / .scad file, or an .stl mesh
  // into a new session. Returns whether the import committed (so callers know
  // if the inbox should be updated).
  async function handleImportFile(file: File): Promise<boolean> {
    const source = classifyImportSource(file.name);
    if (!source) {
      alert(`Unsupported file type: ${file.name}\n\nSupported: .partwright.json, .js, .scad, .stl, .step / .stp, .vox, .svg, .png / .jpg / .gif / .webp / .avif`);
      return false;
    }

    try {
      let committed = false;
      if (source === 'JSON') {
        const text = await file.text();
        committed = await importJSONFromText(file.name, text);
      } else if (source === 'JS' || source === 'SCAD') {
        const code = await file.text();
        const lang: Language = source === 'SCAD' ? 'scad' : 'manifold-js';
        committed = await placeImportedCodeFile(code, lang, file.name);
      } else if (source === 'STL') {
        const parsed = await parseSTLFile(file);
        if (parsed) {
          committed = await placeImportedMesh(parsed, file.name);
        }
      } else if (source === 'STEP') {
        committed = await handleStepImport(file);
      } else if (source === 'IMAGE') {
        // This is the GENERIC image import path (toolbar "Choose file…" or
        // drag-and-drop), where the user hasn't expressed an intent — so first
        // ask whether to build a relief or voxels. The explicit "Image → voxel…"
        // and "Image → relief…" menu items bypass handleImportFile entirely
        // (openVoxelImportFlow / openReliefImportFlow), and the console API
        // (importImageAsVoxels) skips this too. Cancel aborts cleanly (no
        // session mutation); each branch owns its own Recent-Imports entry.
        const kind = await showImageImportKindModal({ filename: file.name });
        if (!kind) return false;
        if (kind === 'relief') {
          openReliefImportFlow(file);
          return true;
        }
        committed = await handleImageImport(file);
      } else if (source === 'VOX') {
        committed = await handleVoxImport(file);
      } else if (source === 'SVG') {
        // SVG has no standalone mesh importer — it's a Relief Studio source.
        // Open the relief wizard pre-loaded with the dropped file (its own
        // Create registers the Recent-Imports entry + thumbnail), so a dropped
        // .svg lands somewhere sensible instead of silently doing nothing.
        openReliefImportFlow(file);
        return true;
      }
      // IMAGE registers itself inside handleImageImport (it owns the chosen
      // voxel options + thumbnail it needs to stash for a faithful re-import).
      // Snapshot the bytes so a later re-import doesn't depend on the original
      // (possibly moved/dropped) OS file handle.
      if (committed && source !== 'IMAGE') await registerImportSnapshot(file, file.name, source);
      return committed;
    } catch (e) {
      alert(`Failed to import "${file.name}": ${(e as Error).message}`);
      return false;
    }
  }

  // === Import from URL ===

  /** Decode + import a Partwright share link or raw `#share=…` hash WITHOUT any
   *  network. Mirrors the decode+validate chain in enterSharedFromHash/onFork:
   *  decodeShare → validateSessionPayload → validateSharePayloadShape, then runs
   *  it through the same new-session / merge destination chooser as a file
   *  import. Throws a human-readable message on any failure (the modal surfaces
   *  it inline). */
  async function importFromShareHash(hash: string): Promise<void> {
    let payload: ExportedSession;
    try {
      const parsed = await decodeShare(hash);
      const branded = validateSessionPayload(parsed);
      if (!branded) throw new Error('not a Partwright payload');
      payload = validateSharePayloadShape(branded);
    } catch (e) {
      if (e instanceof ShareUnsupportedError) {
        throw new Error('That share link was made by a newer version of Partwright.');
      }
      throw new Error('That share link is invalid or corrupted.');
    }
    await importValidatedSession(payload, 'shared link');
  }

  /** Show the destination chooser (new session vs merge, the latter only when a
   *  session is open) for an already-validated session payload, then import.
   *  Returns whether the import committed (false when the user cancelled). */
  async function importValidatedSession(data: ExportedSession, filename: string): Promise<boolean> {
    const summary = summarizeSessionImport(data);
    const cur = getState();
    const mergeTargetName = cur.session
      ? (cur.session.name?.trim() || 'current session')
      : undefined;
    const choice = await showImportPreview(filename, summary, { mergeTargetName });
    if (choice === 'cancel') return false;
    if (choice === 'merge') {
      // The regen callback runs each imported version's code to snapshot a
      // thumbnail. Code like `Manifold.ofMesh(api.imports[0])` reads the active-
      // imports register, so we must seed it with *that* version's meshes
      // before running — otherwise the run produces the host (previously
      // selected) part's geometry and the captured thumbnail is stale. Restore
      // the host's own imports afterwards so the closing re-render is correct.
      const hostImports = getActiveImports();
      const result = await importSessionPartsIntoActive(data, async (code, importedMeshes) => {
        setActiveImports(importedMeshes ?? []);
        await runCodeSync(code);
        return captureThumbnail();
      });
      setActiveImports(hostImports);
      if (result) {
        // Merging an imported version with no embedded thumbnail runs that
        // version's code through runCodeSync to capture one — which leaves the
        // viewport showing the last imported geometry while the editor still
        // shows the active version's code. Re-render the active version so the
        // editor text and viewport agree again.
        const st = getState();
        if (st.currentVersion) await runCodeSync(st.currentVersion.code);
        const partWord = result.addedParts.length === 1 ? 'part' : 'parts';
        showToast(`Merged ${result.addedParts.length} ${partWord} into this session.`, { variant: 'success' });
        return true;
      }
    }
    await importSessionPayload(data);
    return true;
  }

  /** Fetch a remote http(s) file with a timeout + size cap, wrap it in a File,
   *  and route it through the existing import pipeline (handleImportFile, which
   *  itself routes JSON → the session-import path). Never evals fetched content.
   *  Throws a human-readable message on any failure. */
  async function importFromRemoteUrl(url: string): Promise<void> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), getConfig().import.remoteFetchTimeoutMs);
    let res: Response;
    try {
      res = await fetch(url, { signal: controller.signal, redirect: 'follow' });
    } catch (e) {
      clearTimeout(timer);
      if ((e as Error).name === 'AbortError') throw new Error('The request timed out.');
      throw new Error('Could not fetch that URL. The server may block cross-origin requests, or the URL may point to a page rather than a direct file — try finding the direct file URL, or download and upload instead.');
    }
    if (!res.ok) {
      clearTimeout(timer);
      throw new Error(`The server responded ${res.status} ${res.statusText}.`);
    }

    // Defense-in-depth: parseImportUrlInput only vetted the *initial* URL's
    // scheme. With redirect: 'follow', the final URL could in theory be a
    // non-http(s) scheme; browsers already block http(s)→file:/data: redirects,
    // but re-check the resolved URL before touching the body just in case.
    if (res.url) {
      let finalProtocol: string;
      try {
        finalProtocol = new URL(res.url).protocol;
      } catch {
        clearTimeout(timer);
        controller.abort();
        throw new Error('The remote server redirected to an invalid URL.');
      }
      if (finalProtocol !== 'http:' && finalProtocol !== 'https:') {
        clearTimeout(timer);
        controller.abort();
        throw new Error(`The remote server redirected to an unsupported URL (got "${finalProtocol}").`);
      }
    }

    // Up-front size guard from Content-Length when present.
    const declared = Number(res.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > MAX_REMOTE_BYTES) {
      clearTimeout(timer);
      controller.abort();
      throw new Error(`That file is too large (${(declared / 1048576).toFixed(1)} MB; limit 25 MB).`);
    }

    const contentType = res.headers.get('content-type');
    const filename = filenameFromUrl(url);

    // Classify before buffering so we can reject unsupported types early. The
    // filename extension is authoritative; fall back to Content-Type.
    const source = classifyRemoteResource(filename, contentType);
    if (!source) {
      clearTimeout(timer);
      controller.abort();
      throw new Error('Unsupported file type. Supported: .partwright.json, .stl, .step / .stp, .svg, .vox, or an image.');
    }

    // Stream the body with a hard byte cap as a backstop for servers that omit
    // or under-report Content-Length.
    let bytes: Uint8Array;
    try {
      bytes = await readBodyCapped(res, MAX_REMOTE_BYTES, controller);
    } catch (e) {
      clearTimeout(timer);
      if ((e as Error).name === 'AbortError') throw new Error('The request timed out.');
      throw e;
    }
    clearTimeout(timer);

    const safeName = ensureExtensionForSource(filename, source);
    const file = new File([bytes], safeName, { type: contentType ?? '' });
    const ok = await handleImportFile(file);
    if (!ok) {
      // handleImportFile surfaces its own alert on hard failure; a soft "false"
      // (e.g. user cancelled a sub-modal) shouldn't be reported as an error.
      throw new Error('Import was cancelled or the file could not be read.');
    }
  }

  /** Read a fetch Response body into a Uint8Array, aborting once the streamed
   *  total exceeds `cap`. Falls back to a plain arrayBuffer() read (still cap-
   *  checked) when the body isn't a readable stream. */
  async function readBodyCapped(res: Response, cap: number, controller: AbortController): Promise<Uint8Array> {
    const body = res.body;
    if (!body || typeof body.getReader !== 'function') {
      const buf = new Uint8Array(await res.arrayBuffer());
      if (buf.byteLength > cap) throw new Error(`That file is too large (limit 25 MB).`);
      return buf;
    }
    const reader = body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        total += value.byteLength;
        if (total > cap) {
          controller.abort();
          try { await reader.cancel(); } catch { /* ignore */ }
          throw new Error('That file is too large (limit 25 MB).');
        }
        chunks.push(value);
      }
    }
    const out = new Uint8Array(total);
    let offset = 0;
    for (const c of chunks) { out.set(c, offset); offset += c.byteLength; }
    return out;
  }

  /** Open the "Import from URL…" modal and route the user's input to either the
   *  local share decode or the size-capped remote fetch. */
  function openImportFromUrl(): void {
    showImportUrlModal({
      onSubmit: async (parsed) => {
        if (parsed.kind === 'share') {
          await importFromShareHash(parsed.hash);
        } else {
          await importFromRemoteUrl(parsed.url);
        }
      },
    });
  }

  /** Decode an image File/Blob into ImageData via an offscreen canvas. */
  async function decodeImageToImageData(blob: Blob): Promise<ImageData> {
    const bmp = await createImageBitmap(blob);
    try {
      const canvas = document.createElement('canvas');
      canvas.width = bmp.width;
      canvas.height = bmp.height;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) throw new Error('Could not get a 2D canvas context to read image pixels.');
      ctx.drawImage(bmp, 0, 0);
      return ctx.getImageData(0, 0, bmp.width, bmp.height);
    } finally {
      bmp.close();
    }
  }

  /** Decode an image URL (a `data:` URL or same-origin URL) into ImageData via
   *  an `<img>` element. Uses an img-src load, not `fetch`, so it isn't blocked
   *  by the app's strict CSP `connect-src` (which rejects `fetch('data:…')`). */
  async function decodeImageUrlToImageData(url: string): Promise<ImageData> {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.src = url;
    await img.decode();
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('Could not get a 2D canvas context to read image pixels.');
    ctx.drawImage(img, 0, 0);
    return ctx.getImageData(0, 0, canvas.width, canvas.height);
  }

  /** Shared tail of every image→voxel import (drag/drop, recent re-click, and
   *  the modal-first menu): turn the modal result into a voxel session + a
   *  Recent Imports entry. `fallbackFile` seeds the source blob when the result
   *  didn't carry one (the picker flows always do). */
  async function finishVoxelImport(result: ImageVoxelModalResult, fallbackFile?: File): Promise<boolean> {
    const { options: opts, image: chosenImage, file: chosenFile, filename: chosenName } = result;
    const sourceFile = chosenFile ?? fallbackFile ?? null;
    const grid = imageDataToVoxelGrid(chosenImage, opts);
    if (grid.size === 0) {
      alert(`"${chosenName}" produced no voxels at the chosen settings. Try lowering the transparency cutoff.`);
      return false;
    }
    const code = generateVoxelImportCode(grid, chosenName, { style: opts.codeStyle });
    const sessionName = chosenName.replace(/\.[^.]+$/, '');
    // With a session open (and real work to protect), let the user pick
    // new-part / current-part / new-session (default new-part). A fresh /
    // expendable starter or no session forces a fresh session named after the
    // file (handled inside placeImportedCode).
    const placed = await placeImportedCode({
      code,
      language: 'voxel',
      sessionName,
      filename: chosenName,
      title: 'Import voxels',
      composable: true,
    });
    if (!placed) return false;
    // Register in Recent Imports tagged as a voxel import, with the chosen
    // settings + a thumbnail, so re-clicking it reopens THIS modal (not relief)
    // pre-loaded with these knobs. Needs the source blob to re-import later.
    if (sourceFile) {
      const meta: ImportMetadata = { importer: 'voxel', options: opts };
      // Snapshot the file bytes (registerImportSnapshot): a later re-import must
      // not depend on the original OS file still being readable. chosenImage
      // always originates from decodeImage*ToImageData (a real ImageData), so
      // the ImageDataLike→ImageData narrowing is safe here.
      await registerImportSnapshot(sourceFile, chosenName, 'IMAGE', meta, createThumbnailFromImageData(chosenImage as ImageData));
    }
    return true;
  }

  /** Import an image as a colored voxel billboard in a new voxel session.
   *  Transparent pixels (alpha below threshold) drop out, so logos and
   *  sprites voxelize cleanly; opaque photos become a full extruded slab.
   *  The grid is embedded in the generated `voxels.decode(...)` code, so the
   *  session persists as code with no special schema. */
  async function handleImageImport(file: File, initialOptions?: ImageToVoxelOptions): Promise<boolean> {
    let imageData: ImageData;
    try {
      imageData = await decodeImageToImageData(file);
    } catch (e) {
      alert(`Could not read image "${file.name}": ${(e as Error).message}`);
      return false;
    }
    // Let the user dial in resolution / mode / depth / color before
    // committing. The modal's Cancel doubles as the back-out, so the generic
    // pre-import confirm is skipped for images (see handleImportFile).
    // `initialOptions` pre-fills the controls when re-importing a past entry.
    // The user may also swap the source image inside the modal ("Choose a
    // different image…"), so build everything from the RESULT's image / file /
    // name rather than the originally-picked one.
    const result = await showImageVoxelImportModal({ filename: file.name, image: imageData, file, initialOptions });
    if (!result) return false;
    return finishVoxelImport(result, file);
  }

  /** Modal-first entry for Import → "Image → voxel…": open the voxel modal with
   *  no image and let the user pick one inside (mirrors the relief wizard). */
  async function openVoxelImportFlow(): Promise<boolean> {
    const result = await showImageVoxelImportModal({});
    if (!result) return false;
    return finishVoxelImport(result);
  }

  /** Import a MagicaVoxel `.vox` file as a voxel session. Mirrors the image
   *  flow: parse → grid → bake as `voxels.decode(...)` editor code so the
   *  session persists as code with no schema change. */
  async function handleVoxImport(file: File): Promise<boolean> {
    let grid;
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      grid = parseVox(bytes);
    } catch (e) {
      alert(`Could not read .vox file "${file.name}": ${(e as Error).message}`);
      return false;
    }
    if (grid.size === 0) {
      alert(`"${file.name}" contained no voxels.`);
      return false;
    }
    const code = generateVoxelImportCode(grid, file.name);
    const sessionName = file.name.replace(/\.vox$/i, '');
    // With a session open, let the user pick new-part / current-part /
    // new-session (default new-part). With none open, force a fresh session.
    return placeImportedCode({
      code,
      language: 'voxel',
      sessionName,
      filename: file.name,
      title: 'Import voxels',
      composable: true,
    });
  }

  interface ParsedSTL {
    mesh: ImportedMesh;
    /** True if Manifold.ofMesh() succeeded — supports boolean ops, paint, slicing.
     *  False if the user chose to import render-only after manifold construction failed. */
    isManifold: boolean;
  }

  /** Handle a `.step` / `.stp` import. The chooser modal asks the user
   *  whether the file should land as exact BREP (default, recommended) or
   *  as a tessellated manifold-js mesh. Each path then drives the same
   *  downstream session-creation flow with a per-language starter so the
   *  user can run the import immediately. Returns true iff a new session
   *  was opened with the import in it. */
  async function handleStepImport(file: File): Promise<boolean> {
    const state = getState();
    const hasWork = !!state.session && state.versionCount > 0;
    const target = await showStepImportTargetModal({ filename: file.name, hasActiveSessionWithWork: hasWork });
    if (target === null) return false;

    const baseName = file.name.replace(/\.(step|stp)$/i, '');
    if (target === 'brep') {
      // The canonical "return the import" starter so the user can iterate
      // immediately.
      const starter = `// Imported from ${file.name}\n// api.imports[0] is the BREP shape parsed from the STEP file.\nconst { BREP } = api;\nreturn api.imports[0];\n`;
      // Push this file's shape into the worker's pending-imports list. Drop any
      // previously-imported BREP shapes first — otherwise the list accumulates
      // and the seeded `return api.imports[0]` would render the *first* file.
      // (Belt-and-suspenders with the session-change clear when a new session
      // is created; the sole guard when importing into the active session.)
      const pushBrepShape = async (): Promise<boolean> => {
        try {
          await clearBrepImports();
          await importSTEPToBrep(file, file.name);
          return true;
        } catch (e) {
          alert(`Failed to parse STEP file: ${(e as Error).message}`);
          return false;
        }
      };

      // No session open (or the user picks "new session"): open a fresh BREP
      // session named after the file. Switch the editor to the BREP language
      // FIRST so the session-change listener's clearBrepImports/clearBrepShape
      // fires (and is enqueued on the worker) before we push this file's shape —
      // otherwise it would wipe the just-imported shape. switchLanguage resets
      // the editor to a stub starter; we overwrite that below.
      const openInNewSession = async (): Promise<boolean> => {
        if (getActiveLanguage() !== 'replicad') await switchLanguage('replicad');
        await createSession(baseName, 'replicad');
        if (!(await pushBrepShape())) return false;
        setValue(starter);
        runCode(starter);
        return true;
      };

      // No session, or the only part is an expendable starter: open a fresh BREP
      // session named after the file (legacy behavior). The target modal only
      // exists to protect real work, and a fresh/expendable editor has none.
      if (!state.session || currentPartIsExpendable()) return openInNewSession();

      // A session is open: offer new-part / new-session (current-part is out of
      // scope — composing an exact BREP shape into a mesh part isn't supported).
      const choice = await showImportTargetModal({
        title: 'Import STEP (BREP)',
        filename: file.name,
        currentPartName: state.currentPart?.name ?? null,
        canAddToCurrent: false,
        addDisabledReason: 'A BREP shape can’t be combined into an existing part — choose a new part or session.',
        recommend: 'new-part',
      });
      if (!choice) return false;
      if (choice === 'new-session') return openInNewSession();

      // new-part: add a BREP part to the current session, seed the starter, run
      // it, and save v1 tagged `replicad`. preserveCurrentEditsIfNeeded first so
      // the current part's unsaved work isn't lost. Parse the STEP shape BEFORE
      // creating the part — a parse failure must not leave a freshly-created
      // empty part orphaned as the current part.
      await preserveCurrentEditsIfNeeded();
      if (getActiveLanguage() !== 'replicad') await switchLanguage('replicad');
      if (!(await pushBrepShape())) return false;
      const part = await createPart(baseName);
      if (!part) return false;
      // Wipe the outgoing part's paint state (color regions, model-color
      // underlay, annotations) BEFORE running/saving the new part — otherwise
      // the leftover regions are re-resolved onto the imported mesh and
      // serialized into the new part's version, so it "inherits" the previous
      // part's colors. (The mesh path does this via applyImportWrapper; the
      // voxel path via applyCodeToCurrentPart — this hand-written BREP branch
      // was the one path that missed it.)
      cancelVoxelPaintIfActive();
      dropPaintState();
      setValue(starter);
      await runCodeSync(starter);
      const thumbnail = await captureThumbnail();
      await saveVersion(starter, getGeometryDataObj(), thumbnail, 'imported', undefined, { force: true });
      return true;
    }

    // manifold-js path: parse + tessellate via the worker, then drop the
    // mesh through the same path that STL imports use.
    let mesh: MeshData;
    try {
      mesh = await importSTEPToMesh(file);
    } catch (e) {
      alert(`Failed to parse STEP file: ${(e as Error).message}`);
      return false;
    }
    if (!mesh || mesh.numTri === 0) {
      alert(`STEP file produced no geometry: ${file.name}`);
      return false;
    }
    // Mirror STL flow: try to construct a Manifold from the tessellation so
    // boolean / paint downstream tools work; fall back to render-only if
    // the OCCT mesh isn't watertight.
    const trial = tryConstructManifold(mesh);
    const parsed: ParsedSTL = {
      mesh: toImportedMesh(file.name, mesh, 'step'),
      isManifold: trial.ok,
    };
    if (getActiveLanguage() !== 'manifold-js') await switchLanguage('manifold-js');
    return placeImportedMesh(parsed, file.name);
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

    const tolerances = [getConfig().import.stlWeldTolerance, 1e-4, 1e-3, scaleTolerance];
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

  function toImportedMesh(filename: string, mesh: MeshData, format: ImportedMesh['format'] = 'stl'): ImportedMesh {
    return {
      id: generateId(),
      filename,
      format,
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
  async function applyImportWrapper(components: ImportedMesh[], manifold: boolean, seedRegions?: SeedRegion[]): Promise<void> {
    // Same reset as the other import chokepoints: an import wrapper replaces the
    // part's geometry, so the previous part's regions can't survive (compose
    // even rebuilds topology wholesale). Callers run preserveCurrentEditsIfNeeded
    // first, so the painted version is already saved before we drop live paint —
    // otherwise runCodeSync re-resolves stale regions onto the new mesh and locks
    // the editor.
    cancelVoxelPaintIfActive();
    dropPaintState();
    // The import wrapper is manifold-js code; runCodeSync and saveVersion both
    // key off the active language, so switch before running/saving — otherwise
    // composing into a SCAD/BREP/voxel part would run the wrapper through the
    // wrong engine and persist the version tagged with the wrong language.
    if (getActiveLanguage() !== 'manifold-js') await switchLanguage('manifold-js');
    const code = generateImportCode(components, { manifold });
    setActiveImports(components);
    setValue(code);
    await runCodeSync(code);
    // Seed any pre-computed colour regions (relief bands) AFTER the live-paint
    // reset above, so the import's own colours survive into the saved version.
    seedImportRegions(seedRegions);
    const thumbnail = await captureThumbnail();
    const geometryData = enrichGeometryDataWithColors(getGeometryDataObj());
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
    // Bake the part under the language it was authored in, not the globally
    // active engine. Without the explicit lang arg executeCodeAsync falls back
    // to pickLang(undefined) = the active language, so merging/composing a SCAD
    // or BREP part while a manifold-js part is open ran its code through the
    // wrong engine and produced no usable geometry ("No geometry data").
    const lang = effectiveVersionLanguage(version, getState().session);
    const saved = getActiveImports();
    try {
      setActiveImports((version.importedMeshes ?? []) as ImportedMesh[]);
      const result = await executeCodeAsync(version.code, lang);
      if (result.error || !result.mesh) return null;
      return [toImportedMesh(label, result.mesh)];
    } finally {
      setActiveImports(saved);
    }
  }

  /** Add the imported mesh as a brand-new part (becomes current). Optional
   *  seedRegions (relief's per-colour bands) are painted onto the saved v1. */
  async function seedNewPartWithMesh(mesh: ImportedMesh, filename: string, manifold: boolean, seedRegions?: SeedRegion[]): Promise<void> {
    const part = await createPart(filename.replace(/\.[^.]+$/, ''));
    if (!part) return;
    await applyImportWrapper([mesh], manifold, seedRegions);
  }

  /** Run `code` under `language` in the current part and save it as a version.
   *  The language is switched BEFORE running and saving so the engine runs the
   *  right kernel and saveVersion (which snapshots getActiveLanguage()) tags the
   *  version correctly — a voxel part must read back as `voxel`, a BREP part as
   *  `replicad` (per-version language). */
  async function applyCodeToCurrentPart(code: string, language: Language): Promise<void> {
    // An import replaces the part's geometry, so the previous part's regions /
    // live paint can't survive — clear them before running, or runCodeSync
    // re-resolves stale regions onto the new mesh and locks the editor.
    cancelVoxelPaintIfActive();
    dropPaintState();
    clearMesh();
    if (getActiveLanguage() !== language) await switchLanguage(language);
    // Clear stale params panel immediately so old controls don't linger while
    // the new model is loading.
    syncParamsPanel(undefined);
    setValue(code);
    await runCodeSync(code);
    const thumbnail = await captureThumbnail();
    const geometryData = getGeometryDataObj();
    await saveVersion(code, geometryData, thumbnail, 'imported', undefined, { force: true });
  }

  /** Add code (voxel / BREP starter) as a brand-new part's first version.
   *  Mirrors seedNewPartWithMesh but for editor code + a language tag instead
   *  of a parsed mesh. */
  async function seedNewPartWithCode(code: string, name: string, language: Language): Promise<void> {
    const part = await createPart(name);
    if (!part) return;
    await applyCodeToCurrentPart(code, language);
  }

  /** Run `code` under `language` off-editor and capture its geometry as a single
   *  compose component, so a code-based import (voxel) can be composed into a
   *  mesh part. Returns null when the code produced no usable mesh. */
  async function bakeCodeComponent(code: string, language: Language, label: string): Promise<ImportedMesh[] | null> {
    const saved = getActiveImports();
    try {
      setActiveImports([]);
      const result = await executeCodeAsync(code, language);
      if (result.error || !result.mesh) return null;
      return [toImportedMesh(label, result.mesh)];
    } finally {
      setActiveImports(saved);
    }
  }

  /** Decide where freshly-generated import code (voxel today, BREP starter)
   *  lands. With no session open it creates one (legacy behavior); otherwise the
   *  import-target modal lets the user pick a new part, the current part, or a
   *  new session. `composable` controls whether the current-part choice can
   *  compose into an existing mesh part (voxel: yes via bake; BREP: no). */
  async function placeImportedCode(opts: {
    code: string;
    language: Language;
    sessionName: string;
    filename: string;
    title: string;
    composable: boolean;
    composeDisabledReason?: string;
  }): Promise<boolean> {
    const { code, language, sessionName, filename, title } = opts;
    const state = getState();
    // No session, or the only part is an expendable starter: import as before —
    // a fresh session named after the file. The target modal only exists to
    // protect real work, and a fresh/expendable editor has none to protect.
    if (!state.session || currentPartIsExpendable()) {
      await importCodePayload(code, language, sessionName);
      return true;
    }

    // Past this point the current part holds real work (not an expendable
    // starter), so the current-part choice can only compose-into — and only
    // when the import is composable (voxel bakes to a mesh; a BREP starter
    // can't compose into a mesh part).
    const canAddToCurrent = !!state.currentPart && opts.composable;
    const target = await showImportTargetModal({
      title,
      filename,
      currentPartName: state.currentPart?.name ?? null,
      canAddToCurrent,
      addDisabledReason: !opts.composable ? opts.composeDisabledReason : undefined,
      recommend: 'new-part',
    });
    if (!target) return false;

    if (target === 'new-session') {
      await importCodePayload(code, language, sessionName);
      return true;
    }
    if (target === 'new-part') {
      await preserveCurrentEditsIfNeeded();
      await seedNewPartWithCode(code, sessionName, language);
      return true;
    }
    // current-part: compose the import's baked mesh into the existing part
    // (composable imports only).
    await preserveCurrentEditsIfNeeded();
    const baked = await bakeCodeComponent(code, language, sessionName);
    if (!baked) {
      showToast('Couldn’t read the imported geometry to combine.', { variant: 'warn' });
      return false;
    }
    const cur = getState().currentPart;
    if (!cur) return false;
    const curBaked = await bakePartComponents(cur.id, cur.name);
    if (!curBaked) {
      showToast('Couldn’t read the current part’s geometry to combine.', { variant: 'warn' });
      return false;
    }
    await applyImportWrapper([...curBaked, ...baked], true);
    return true;
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
    // Mesh imports always produce a `Manifold.ofMesh(...)` / `Manifold.compose(...)`
    // wrapper, which is manifold-js code. saveVersion snapshots the active
    // language, so switch before any version is written — otherwise importing
    // into an active SCAD/BREP/voxel session tags the version with the wrong
    // language and the engine switches wrong on reload. (The STEP→mesh path
    // already switches before calling here; do it unconditionally so every
    // entry point — STL, STEP, re-import — is safe.)
    if (getActiveLanguage() !== 'manifold-js') await switchLanguage('manifold-js');
    const sessionName = filename.replace(/\.[^.]+$/, '');
    const state = getState();
    // No session, or the only part is an expendable starter: import as before —
    // a fresh session named after the file. The target modal only exists to
    // protect real work, and a fresh/expendable editor has none to protect.
    if (!state.session || currentPartIsExpendable()) {
      await importMeshPayload(parsed.mesh, sessionName, { manifold: parsed.isManifold });
      return true;
    }

    // Past this point the current part holds real work (not an expendable
    // starter), so "current part" always means compose-into, never replace.
    const target = await showImportTargetModal({
      filename,
      currentPartName: state.currentPart?.name ?? null,
      canAddToCurrent: parsed.isManifold && !!state.currentPart,
      addDisabledReason: !parsed.isManifold
        ? 'Render-only meshes can’t be combined into an existing part.'
        : undefined,
      // Default to a new part so an import never silently overwrites the
      // current part's real work.
      recommend: 'new-part',
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
    // current-part: compose the imported mesh into the existing real work.
    await preserveCurrentEditsIfNeeded();
    return composeMeshIntoCurrentPart(parsed.mesh);
  }

  /** Place an imported code file (JS / SCAD) into the session, showing a target
   *  modal when there is real existing work. Options: new part, replace current
   *  part, or new session. Distinct from placeImportedCode (which handles
   *  generated code / voxel / BREP with a compose-into current-part path). */
  async function placeImportedCodeFile(code: string, lang: Language, filename: string): Promise<boolean> {
    const sessionName = filename.replace(/\.(js|scad)$/i, '');
    const state = getState();
    if (!state.session || currentPartIsExpendable()) {
      await importCodePayload(code, lang, sessionName);
      return true;
    }
    const partLabel = state.currentPart?.name ? `"${state.currentPart.name}"` : 'the current part';
    const target = await showImportTargetModal({
      filename,
      title: 'Import code',
      currentPartName: state.currentPart?.name ?? null,
      canAddToCurrent: true,
      currentPartTitle: `Replace current part — ${partLabel}`,
      currentPartDesc: "Replace this part's code with the imported file. The current code is saved as a version first.",
      recommend: 'new-part',
    });
    if (!target) return false;
    if (target === 'new-session') {
      await importCodePayload(code, lang, sessionName);
    } else if (target === 'new-part') {
      await preserveCurrentEditsIfNeeded();
      await seedNewPartWithCode(code, sessionName, lang);
    } else {
      // current-part: replace current part's code with the imported file.
      await preserveCurrentEditsIfNeeded();
      await applyCodeToCurrentPart(code, lang);
    }
    return true;
  }

  function mergedPartName(names: string[]): string {
    const joined = names.join(' + ');
    return joined.length <= 40 ? joined : `Merged (${names.length} parts)`;
  }

  /** Build a new part holding the composed geometry of `components`. Probes the
   *  combine first so a failure surfaces as a toast instead of a broken part. */
  async function createCombinedPart(components: ImportedMesh[], name: string): Promise<boolean> {
    // The compose wrapper is manifold-js; merging while a SCAD/BREP/voxel part
    // is active would probe + run + save it through the wrong engine. Switch
    // first so the probe, runCodeSync, and the saved version are all manifold-js.
    if (getActiveLanguage() !== 'manifold-js') await switchLanguage('manifold-js');
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
      // Image / SVG re-imports reopen the same importer that produced them,
      // pre-loaded with the original settings: voxel imports return to the
      // voxel modal, everything else (relief, SVG) to the Relief Studio.
      if (entry.source === 'IMAGE' || entry.source === 'SVG') {
        const file = new File([entry.blob], entry.filename, { type: entry.blob.type });
        const meta = (entry.metadata && typeof entry.metadata === 'object') ? entry.metadata as Partial<ImportMetadata> : undefined;
        if (meta?.importer === 'voxel') {
          await handleImageImport(file, meta.options as ImageToVoxelOptions);
          return;
        }
        // Relief imports store { importer:'relief', options }; older/plain
        // entries stored the ReliefOptions directly — accept both shapes.
        const savedOpts = (meta?.importer === 'relief' ? meta.options : entry.metadata) as ReliefOptions | undefined;
        openReliefImportFlow(file, savedOpts);
        return;
      }
      // VOX re-imports rebuild the voxel session from the original bytes via the
      // same handler as a fresh import. The .vox blob is binary, so the code
      // fall-through below (which reads it as text and opens it as manifold-js)
      // dumped garbage into the editor and never switched to the voxel language.
      // handleVoxImport now shows the import-target modal (new part / current
      // part / new session) when a session is open, so no separate confirm here.
      if (entry.source === 'VOX') {
        const file = new File([entry.blob], entry.filename, { type: entry.blob.type });
        await handleVoxImport(file);
        return;
      }
      // STEP re-imports reopen the BREP-vs-tessellated-mesh target modal, same as
      // a fresh STEP import; the code fall-through below would import the raw STEP
      // text as manifold-js source.
      if (entry.source === 'STEP') {
        const file = new File([entry.blob], entry.filename, { type: entry.blob.type });
        await handleStepImport(file);
        return;
      }
      // Remaining sources are raw code (JS / SCAD): show the target modal so
      // the user can choose new part, replace current, or new session.
      const code = await entry.blob.text();
      const lang: Language = entry.source === 'SCAD' ? 'scad' : 'manifold-js';
      await placeImportedCodeFile(code, lang, entry.filename);
    } catch (e) {
      alert(`Failed to re-import "${entry.filename}": ${(e as Error).message}`);
    }
  }

  // Document-level drag-and-drop import. The editor UI is initialized once
  // per page load and never torn down, so these document listeners live for
  // the lifetime of the document — no cleanup needed. If editor teardown is
  // ever added, store these handlers and pair with removeEventListener().
  function isImportableFile(file: File): boolean {
    // Reuse the single classifier so drag-and-drop accepts exactly the same set
    // as the Import button (IMPORT_ACCEPT) — STEP, VOX, images, and SVG too,
    // not just the original JSON/JS/SCAD/STL.
    return classifyImportSource(file.name) !== null;
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
  //
  // These UI actions gate on the pre-export safety modal (unitless / non-
  // manifold / multi-component) — but the underlying window.partwright.export*
  // console API stays unguarded so AI agents and e2e can drive it
  // programmatically without a blocking modal.

  /** Build the warning descriptor for the current geometry from the published
   *  stats blob (which carries bbox dimensions, isManifold, componentCount even
   *  for render-only imports where currentManifold is null). */
  function exportWarningInfo(format: string): ExportWarningInfo {
    const gd = getGeometryDataObj();
    const bbox = gd?.boundingBox as { dimensions?: unknown } | null | undefined;
    const rawDims = bbox?.dimensions;
    const dimensions = Array.isArray(rawDims) && rawDims.length === 3 && rawDims.every(n => typeof n === 'number')
      ? (rawDims as [number, number, number])
      : null;
    return {
      unitless: _getUnits() === 'unitless',
      dimensions,
      isManifold: gd?.isManifold !== false, // treat unknown as manifold (no false alarm)
      componentCount: typeof gd?.componentCount === 'number' ? gd.componentCount : 1,
      format,
    };
  }

  /** Returns true if the export should proceed: no warning, or the user
   *  confirmed it. Only used by the UI export actions below. */
  async function confirmExportOrProceed(format: string): Promise<boolean> {
    const info = exportWarningInfo(format);
    if (!hasExportWarning(info)) return true;
    return showExportConfirm(info);
  }

  // One standardized "nothing to export" toast for every mesh export action, so
  // the feedback is consistent instead of some formats silently no-op'ing and
  // others (GLB) producing a bogus empty file.
  const noGeometryToast = () => showToast('No geometry to export — run a model first.', { variant: 'warn' });

  /** The MeshData to feed an export: bakes ALL color regions when any are
   *  present (independent of viewport paint visibility) so every format ships
   *  the same colors; otherwise the mesh as-is. */
  const coloredMeshForExport = (mesh: MeshData): MeshData =>
    (hasColorRegions() || hasModelColorRegions()) ? applyTriColors(mesh) : mesh;

  /** Non-blocking heads-up that a multi-part session exports only the active
   *  part (mesh exports consume the single `currentMeshData`). Mirrors the
   *  share-link warning so users aren't silently handed one part of an
   *  assembly. */
  const notifyMultiPartExport = () => {
    const parts = getState().parts;
    if (parts.length > 1) {
      const partName = getState().currentPart?.name ?? 'the current part';
      showToast(`Exporting only "${partName}" — ${parts.length} parts in this session. Merge parts first to export them together.`, { variant: 'neutral' });
    }
  };

  const actionExportGLB = async () => {
    if (isSharedPreview()) { showToast('Fork this shared design before exporting.', { variant: 'warn' }); return; }
    if (!currentMeshData) { noGeometryToast(); return; }
    if (!(await confirmExportOrProceed('GLB'))) return;
    try {
      assertFiniteMesh(currentMeshData);
      notifyMultiPartExport();
      const filename = await exportGLB(undefined, coloredMeshForExport(currentMeshData));
      showToast(`Exported ${filename}`, { variant: 'success' });
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'GLB export failed', { variant: 'warn' });
    }
  };
  const actionExportSTL = async () => {
    if (isSharedPreview()) { showToast('Fork this shared design before exporting.', { variant: 'warn' }); return; }
    if (!currentMeshData) { noGeometryToast(); return; }
    if (!(await confirmExportOrProceed('STL'))) return;
    notifyMultiPartExport();
    try { showToast(`Exported ${exportSTL(currentMeshData)}`, { variant: 'success' }); }
    catch (e) { showToast(e instanceof Error ? e.message : 'STL export failed', { variant: 'warn' }); }
  };
  const actionExportOBJ = async () => {
    if (isSharedPreview()) { showToast('Fork this shared design before exporting.', { variant: 'warn' }); return; }
    if (!currentMeshData) { noGeometryToast(); return; }
    if (!(await confirmExportOrProceed('OBJ'))) return;
    notifyMultiPartExport();
    try { showToast(`Exported ${exportOBJ(coloredMeshForExport(currentMeshData))}`, { variant: 'success' }); }
    catch (e) { showToast(e instanceof Error ? e.message : 'OBJ export failed', { variant: 'warn' }); }
  };
  const actionExport3MF = async () => {
    if (isSharedPreview()) { showToast('Fork this shared design before exporting.', { variant: 'warn' }); return; }
    if (!currentMeshData) { noGeometryToast(); return; }
    if (!(await confirmExportOrProceed('3MF'))) return;
    notifyMultiPartExport();
    try { showToast(`Exported ${export3MF(coloredMeshForExport(currentMeshData))}`, { variant: 'success' }); }
    catch (e) { showToast(e instanceof Error ? e.message : '3MF export failed', { variant: 'warn' }); }
  };
  // The integer VoxelGrid behind a voxel session. The engine meshes in the
  // Worker, so the grid isn't on the main thread after a normal run — re-run the
  // current code locally to recover it (the same trick voxel paint uses), or use
  // the live painted grid when paint is active so unbaked edits are exported.
  const getCurrentVoxelGrid = (): VoxelGrid | null => {
    if (getActiveLanguage() !== 'voxel') return null;
    const painted = voxelPaint.getGrid();
    if (painted) return painted;
    const r = runVoxelForPaint(getValue());
    return r.ok ? r.data.grid : null;
  };
  const actionExportVOX = () => {
    if (isSharedPreview()) { showToast('Fork this shared design before exporting.', { variant: 'warn' }); return; }
    const grid = getCurrentVoxelGrid();
    if (!grid) {
      showToast(getActiveLanguage() === 'voxel'
        ? 'Run a voxel model before exporting .vox.'
        : 'Switch to the Voxel language to export .vox.', { variant: 'warn' });
      return;
    }
    try { showToast(`Exported ${exportVOX(grid)}`, { variant: 'success' }); }
    catch (e) { showToast(e instanceof Error ? e.message : 'VOX export failed', { variant: 'warn' }); }
  };
  // STEP — BREP (replicad) sessions only. Shared by the toolbar callback and the
  // command palette so the worker round-trip + download convention live in one
  // place. (The partwrightAPI.exportSTEP const is defined further down main(), so
  // inlining the worker call here avoids a TDZ on toolbar build.)
  const actionExportSTEP = async () => {
    if (isSharedPreview()) { showToast('Fork this shared design before exporting.', { variant: 'warn' }); return; }
    try {
      // The retained shape is cleared on session/language change, but guard the
      // active language too so a stale shape can never be served outside a
      // replicad session (defense-in-depth — the toolbar item and palette entry
      // are already gated on replicad).
      if (getActiveLanguage() !== 'replicad') {
        showToast('STEP export is only available in BREP mode. Switch to BREP and run a model first.', { variant: 'warn' });
        return;
      }
      const blob = await exportLastBrepAsSTEP();
      if (!blob) {
        showToast('No BREP shape available. Run a model in BREP mode first.', { variant: 'warn' });
        return;
      }
      // Route through the shared download helper so STEP gets the same filename
      // convention (date/unit suffix, sanitization), unified revoke, and a
      // Recent Exports entry as every other format.
      const filename = getExportFilename('step');
      downloadBlob(blob, filename, 'STEP');
      showToast(`Exported ${filename}`, { variant: 'success' });
    } catch (e) {
      showToast(`STEP export failed: ${e instanceof Error ? e.message : String(e)}`, { variant: 'warn' });
    }
  };

  // Hard cap on the encoded share string. Browsers and chat apps choke on very
  // long URLs; past this we drop the thumbnail once and, if still too big, abort
  // with a toast rather than minting a link that silently won't open.
  const MAX_SHARE_ENCODED_CHARS = 1_500_000;

  /** Encode the current committed version into a self-contained `#share=…`
   *  read-only link. Saves the current buffer first (exportSession reads the
   *  SAVED version), feature-detects CompressionStream, and trims the thumbnail
   *  if the link is too large before giving up. Returns `{ url, encodedBytes }`
   *  on success or `{ error }` with a user-facing message. Pure builder: it does
   *  no UI — callers decide whether to open the modal (toolbar) or just return
   *  the string (the partwright API).
   *
   *  `notify` optionally surfaces the "multi-part designs share one part" toast;
   *  the API path passes a no-op so it never pops UI out from under an agent. */
  const buildShareLink = async (
    notify: (msg: string) => void = () => {},
  ): Promise<{ url: string; encodedBytes: number } | { error: string }> => {
    if (typeof CompressionStream === 'undefined') {
      return { error: 'Sharing needs a newer browser' };
    }
    if (!getState().session || !engineOk) {
      return { error: 'Open or create a design before sharing.' };
    }
    // exportSession reads the SAVED version from IndexedDB, so commit the current
    // buffer first — both to give a fresh /editor (currentVersion: null) a
    // version to export and to capture any unsaved edits the user is sharing.
    const saved = await saveCurrentVersion();
    if ('error' in saved) {
      return { error: saved.error };
    }
    const state = getState();
    const versionIndex = state.currentVersion?.index;
    if (versionIndex === undefined) {
      return { error: 'No saved version to share yet.' };
    }

    const sessionId = state.session!.id;
    // Single-version, lean payload: no chat, no notes. Name the shared session
    // after the current part when the session is multi-part so the preview reads
    // sensibly (the share covers only the current part's current version).
    const exported = await exportSession(sessionId, {
      versionIndices: [versionIndex],
      includeChat: false,
      includeNotes: false,
    });
    if (!exported) {
      return { error: 'Could not prepare this design for sharing.' };
    }
    if (state.parts.length > 1) {
      // A share link carries one version of one part. Tell the user so a
      // multi-part assembly isn't silently reduced, and name the shared session
      // after the current part.
      const partName = state.currentPart?.name;
      if (partName) exported.session = { ...exported.session, name: partName };
      notify(`Sharing only "${partName ?? 'the current part'}" — multi-part designs share one part per link.`);
    }

    try {
      let encoded = await encodeShare(exported);
      // If the link is too long, drop the (heavy) thumbnail and try once more.
      if (encoded.length > MAX_SHARE_ENCODED_CHARS && exported.versions[0]?.thumbnail) {
        const slimmed = {
          ...exported,
          versions: exported.versions.map((v, i) =>
            i === 0 ? (() => { const { thumbnail: _t, ...rest } = v; return rest; })() : v,
          ),
        };
        encoded = await encodeShare(slimmed);
      }
      if (encoded.length > MAX_SHARE_ENCODED_CHARS) {
        return { error: 'Design too large to share via link' };
      }
      return { url: `${location.origin}/editor#share=${encoded}`, encodedBytes: encoded.length };
    } catch (e) {
      if (e instanceof ShareUnsupportedError) {
        return { error: 'Sharing needs a newer browser' };
      }
      errorLog.capture({ level: 'error', source: 'app', message: `share encode failed: ${e instanceof Error ? e.message : String(e)}` });
      return { error: 'Could not create a share link.' };
    }
  };

  /** Build the share link and open the copy modal. Thin toolbar wrapper around
   *  {@link buildShareLink}; surfaces every error path as a toast. */
  const actionShareLink = async (): Promise<void> => {
    const result = await buildShareLink((msg) => showToast(msg, { variant: 'neutral' }));
    if ('error' in result) {
      showToast(result.error, { variant: 'warn' });
      return;
    }
    openShareModal(result.url, result.encodedBytes);
  };

  /** True when the share action can run: an active session on a ready engine. */
  const canShare = (): boolean => !!getState().session && engineOk && !isSharedPreview() && typeof CompressionStream !== 'undefined';

  // Create toolbar
  createToolbar(editorUI, {
    onGoHome: () => {
      updateAppHistory('/', 'push');
      void syncRouteFromURL();
    },
    onRun: () => runCode(),
    onCancelRun: () => { cancelCurrentExecution(); },
    onExportGLB: actionExportGLB,
    onExportSTL: actionExportSTL,
    onExportOBJ: actionExportOBJ,
    onExport3MF: actionExport3MF,
    onExportVOX: actionExportVOX,
    onExportSTEP: actionExportSTEP,
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
    onShareLink: () => { void actionShareLink(); },
    onExportRawCode: () => {
      exportRawCode(getValue(), getActiveLanguage());
    },
    onImportFile: async (file) => { await handleImportFile(file); },
    onImportFromURL: () => { openImportFromUrl(); },
    onImportInboxEntry: handleReimportInboxEntry,
    onCreateRelief: () => {
      // If the active session is itself a relief, reopen the wizard pre-loaded
      // with its stored source + settings (re-tune without re-uploading);
      // otherwise start a fresh blank import.
      const sid = getState().session?.id ?? null;
      if (sid && isReliefSession(sid)) void reopenReliefImport(sid);
      else openReliefImportFlow();
    },
    onCreateVoxel: () => { void openVoxelImportFlow(); },
    onLanguageHelp: async () => { await showLanguageHelpModal(); },
    onToggleAi: () => { void toggleAiPanelFromToolbar(); },
    onLanguageSwitch: async (lang: 'manifold-js' | 'scad' | 'replicad' | 'voxel') => {
      if (lang === getActiveLanguage()) return;
      // Stash the current language's editor buffer as a draft on the active
      // session, then swap engines and restore (or seed) the other language's
      // draft. Versions in this session aren't touched — they remember the
      // language they were authored in.
      await switchLanguageWithDrafts(lang);
    },
  });

  // Init diagnostic panel — attaches to document.body, registers badge subscriber.
  initDiagnosticsPanel();

  // Reset the editor to a blank starting point for a freshly created session.
  // Shared by the session bar's "+ New Session" button and the session modal's,
  // so both clear the previous session's code instead of leaving it behind.
  function resetEditorToStarter(comment: string) {
    dropPaintState();
    const lang = getActiveLanguage();
    let body: string;
    if (lang === 'scad') {
      body = 'cube([10, 10, 10], center=true);';
    } else if (lang === 'replicad') {
      body = 'const { BREP } = api;\nconst body = BREP.box([30, 30, 10]).fillet(3, { inDirection: [0, 0, 1] });\nconst bore = BREP.cylinder(4, 12).translate([0, 0, -1]);\nreturn body.cut(bore);';
    } else if (lang === 'voxel') {
      body = "const { voxels } = api;\nconst v = voxels();\nv.fillBox([-5, -5, 0], [4, 4, 0], '#6b8cff');\nv.fillBox([-1, -1, 1], [1, 1, 6], '#ff8c42');\nv.set(0, 0, 7, '#ff3b30');\nreturn v;";
    } else {
      body = 'const { Manifold } = api;\nreturn Manifold.cube([10, 10, 10], true);';
    }
    const freshCode = `// ${comment}\n${body}`;
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
  // the part has no saved versions yet. A saved version carries its own language
  // and `loadVersionIntoEditor` swaps the engine to match. A version-less part
  // falls back to the manifold-js starter: the engine MUST be on manifold-js
  // before we seed + run it — otherwise the starter's `Manifold.cube(...)` runs
  // under whatever engine the previously-active part left behind (e.g. voxel,
  // where `api.Manifold` is undefined). This is the mixed-language case a JSON
  // merge creates: a voxel Part 2 alongside an unsaved manifold-js Part 1.
  async function loadPartIntoEditor(version: Version | null, opts: { skipDraftSave?: boolean } = {}) {
    clearMesh();
    if (version) {
      await loadVersionIntoEditor(version, opts);
    } else {
      if (getActiveLanguage() !== 'manifold-js') await switchLanguage('manifold-js');
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
    onLoadVersion: async (_code: string) => {
      // The session bar's prev/next/version-dropdown handlers update
      // currentVersion before firing this; route through loadVersionIntoEditor
      // so cross-language navigation swaps the engine and stashes the
      // previous language's draft. The `code` argument is redundant once we
      // read the version from state — kept on the callback to avoid churning
      // the SessionBarCallbacks signature.
      const v = getState().currentVersion;
      if (v) await loadVersionIntoEditor(v);
    },
    onNewSession: startNewSessionInEditor,
  });

  // Create layout
  const { editorContainer, editorErrorPanel, viewportPane, galleryContainer, versionsContainer, imagesContainer, diffContainer, notesContainer, dataContainer, statusBar, clipControls, findReplaceBtn, formatBtn, autoFormatToggle, switchTab, partsRail, togglePartsRail, collapseEditor, expandEditor } = createLayout(editorUI, {
    onToggleAi: () => { void toggleAiPanelFromToolbar(); },
    onOpenCatalog: () => { void showCatalogPage(); },
    onToggleDiagnostics: () => { toggleDiagnosticsPanel(); },
    onOpenSessionList: () => showSessionList(),
    // The rail only renders inside the editor, so the tour's spotlight targets
    // already exist — start it directly without re-navigating.
    onStartTour: () => { resetTour(); startTour(); },
  });

  // Printability indicator pill — shown in the viewport overlay when the model
  // has structural issues that would prevent 3D printing (non-manifold or
  // disconnected components). Hidden when the model is printable.
  printabilityIndicatorEl = document.createElement('span');
  printabilityIndicatorEl.className = 'absolute top-8 left-2 z-20 text-xs text-amber-300 font-mono bg-zinc-900/80 px-2 py-0.5 rounded border border-amber-700/60 pointer-events-none';
  printabilityIndicatorEl.style.display = 'none';
  viewportPane.appendChild(printabilityIndicatorEl);

  // Parts rail — IDE-style list of the session's parts.
  createPartList(partsRail, {
    onSelectPart: async (partId: string) => {
      // Save any unsaved non-starter edits as a version (imported SCAD with
      // errors, etc.) so they survive the switch and are loadable on return.
      await preserveCurrentEditsIfNeeded();
      // Also stash the raw editor buffer as a per-part draft BEFORE changePart
      // runs — after that call currentPart is already the incoming part, so
      // saving inside loadVersionIntoEditor would land under the wrong id.
      const { session, currentPart } = getState();
      if (session && currentPart) {
        await writeDraft(session.id, getActiveLanguage(), getValue(), currentPart.id);
      }
      const version = await changePart(partId);
      // skipDraftSave: the outgoing draft was already saved above.
      await loadPartIntoEditor(version, { skipDraftSave: true });
      // Restore the incoming part's unsaved work (if any) on top of the
      // saved version that loadPartIntoEditor just loaded.
      await restoreDraftIfNewer();
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
        await restoreDraftIfNewer();
      }
    },
    onDeleteParts: async (partIds: string[]) => {
      if (isReadOnlyViewer()) return;
      const result = await deleteParts(partIds);
      // Only reload the editor when the active part was among those removed
      // (deleteParts reports this via newCurrent).
      if (result && result.newCurrent) {
        await loadPartIntoEditor(getState().currentVersion);
        await restoreDraftIfNewer();
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
    // BREP/replicad sessions are still JavaScript files (api.BREP.*), so they
    // share the .js extension fallback with manifold-js.
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
  findReplaceBtn.addEventListener('click', () => openFindReplace());
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
    let result;
    try {
      result = await saveCurrentVersion();
    } catch (e) {
      // An explicit Save that fails (e.g. a full quota) must surface the
      // failure — never the "Saved" toast — so the user knows it didn't
      // persist. No caller inspects the result, so a warn toast is the
      // signal (we don't re-throw, which would just be an unhandled
      // rejection through the `void` call sites).
      if (isQuotaError(e)) {
        showToast('Storage full — could not save this version. Free up space or export your work.', { variant: 'warn' });
      } else {
        showToast(e instanceof Error ? e.message : 'Save failed', { variant: 'warn' });
      }
      return;
    }
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
    { id: 'tab-interactive', title: 'Go to 3D view', hint: 'Tab', keywords: 'interactive viewport model', run: () => switchTab('interactive'), enabled: isEditorActive },
    { id: 'tab-gallery', title: 'Go to Gallery (read-only)', hint: 'Tab', keywords: 'thumbnails versions visual grid', run: () => switchTab('gallery'), enabled: isEditorActive },
    { id: 'tab-versions', title: 'Go to Versions', hint: 'Tab', keywords: 'history rename delete', run: () => switchTab('versions'), enabled: isEditorActive },
    { id: 'tab-images', title: 'Go to Reference images', hint: 'Tab', keywords: 'photos reference', run: () => switchTab('images'), enabled: isEditorActive },
    { id: 'tab-diff', title: 'Go to Diff', hint: 'Tab', keywords: 'compare changes', run: () => switchTab('diff'), enabled: isEditorActive },
    { id: 'tab-notes', title: 'Go to Notes', hint: 'Tab', keywords: 'session notes', run: () => switchTab('notes'), enabled: isEditorActive },
    { id: 'tab-data', title: 'Go to Data', hint: 'Tab', keywords: 'storage browser indexeddb inventory', run: () => switchTab('data'), enabled: isEditorActive },
    { id: 'export-glb', title: 'Export GLB', hint: 'Export', keywords: 'download gltf 3d', run: () => { void actionExportGLB(); }, enabled: () => currentMeshData !== null },
    { id: 'export-stl', title: 'Export STL', hint: 'Export', keywords: 'download print', run: actionExportSTL, enabled: () => currentMeshData !== null },
    { id: 'export-obj', title: 'Export OBJ', hint: 'Export', keywords: 'download wavefront', run: actionExportOBJ, enabled: () => currentMeshData !== null },
    { id: 'export-3mf', title: 'Export 3MF', hint: 'Export', keywords: 'download print color', run: actionExport3MF, enabled: () => currentMeshData !== null },
    // VOX exports the voxel grid (getCurrentVoxelGrid), not currentMeshData, so
    // gate on the active language — the grid is re-derived on demand inside the
    // action, which also toasts if there's nothing to export. (Re-running the
    // model inside an `enabled` predicate would be far too heavy.)
    { id: 'export-vox', title: 'Export VOX', hint: 'Export', keywords: 'download magicavoxel voxel goxel', run: actionExportVOX, enabled: () => getActiveLanguage() === 'voxel' },
    // STEP exports the retained BREP shape, only available in replicad sessions
    // (mirrors the toolbar's STEP gating); the action toasts if no shape exists.
    { id: 'export-step', title: 'Export STEP', hint: 'Export', keywords: 'download brep cad solidworks fusion freecad', run: () => { void actionExportSTEP(); }, enabled: () => getActiveLanguage() === 'replicad' },
    { id: 'share-link', title: 'Share design (copy link)', hint: 'Share', keywords: 'url public link copy fork readonly', run: () => { void actionShareLink(); }, enabled: canShare },
    { id: 'toggle-ai', title: 'Toggle AI panel', hint: 'View', keywords: 'chat assistant drawer', run: () => toggleAiPanel() },
    { id: 'toggle-diagnostics', title: 'Toggle diagnostic log', hint: 'View', keywords: 'errors warnings console', run: () => toggleDiagnosticsPanel() },
    { id: 'open-catalog', title: 'Open catalog', hint: 'Navigate', keywords: 'examples premade browse', run: () => { void showCatalogPage(); } },
    { id: 'open-ideas', title: 'Open ideas', hint: 'Navigate', keywords: 'prompts examples inspiration showcase what can i do', run: () => { showIdeasPage(); } },
    { id: 'open-help', title: 'Open help', hint: 'Navigate', keywords: 'docs documentation guide', run: () => showHelp() },
    { id: 'open-whats-new', title: "Open what's new", hint: 'Navigate', keywords: 'changelog recent features updates release notes', run: () => showWhatsNewPage() },
    { id: 'open-quality', title: 'Modeling quality settings', hint: 'Settings', keywords: 'resolution curve segments smoothness', run: () => showQualitySettingsModal() },
    { id: 'retake-tour', title: 'Take the guided tour', hint: 'Help', keywords: 'onboarding walkthrough intro tutorial', run: () => { resetTour(); startTour(); }, enabled: isEditorActive },
  ]);

  // Init gallery — `loadVersion` (in gallery.ts) has already updated state to
  // point at the clicked version by the time this fires, so route through
  // loadVersionIntoEditor for the engine swap + draft stash + rehydration.
  createGalleryView(galleryContainer, async (_code: string) => {
    const v = getState().currentVersion;
    if (v) await loadVersionIntoEditor(v);
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
      // Restore the engine to the loaded version's language. The opened
      // session's current-version pointer was just refreshed by openSession,
      // so currentVersion.language (with session-level fallback) is the
      // right signal here — not session.language alone, which would miss
      // mixed-language sessions where the active version uses the other
      // engine.
      const st = getState();
      const versionLang = effectiveVersionLanguage(st.currentVersion, st.session);
      if (versionLang !== getActiveLanguage()) {
        await switchLanguage(versionLang);
      }
      setValue(code);
      runCode(code);
    },
    async (code: string, importedMeshes) => {
      // Seed this version's imported meshes so `api.imports[0]` resolves to its
      // own geometry when the thumbnail is regenerated (else a stale capture).
      setActiveImports(importedMeshes ?? []);
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
  let engineLoadPromise: Promise<void> | null = null;
  let engineLoadingOverlay: HTMLElement | null = null;
  let helpHasAppBackTarget = false;
  let legalEl: HTMLElement | null = null;
  let legalHasAppBackTarget = false;
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
  // Elapsed-time display for slow renders (SCAD, complex JS). The cancel
  // button and timer are hidden until 400 ms have elapsed so fast runs don't
  // flash them. _runShowTimer is the delayed-show timeout; _runTimerInterval
  // fires every 100 ms to update the displayed elapsed time.
  let _runTimerStart = 0;
  let _runShowTimer: number | null = null;
  let _runTimerInterval: number | null = null;
  // The _runGeneration value of the most-recently-started RAF-initiated run.
  // -1 = no RAF run is currently active. A new RAF may cancel only the
  // generation that this tracks; if the active generation is different (an
  // explicit call superseded the RAF), the new RAF suppresses itself instead.
  let _rafOwnedGeneration = -1;

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
    if (ideasEl) ideasEl.classList.add('hidden');
    if (legalEl) legalEl.classList.add('hidden');
    overlayContainer.classList.add('hidden');
    window.dispatchEvent(new Event('resize'));
    void ensureEngineStarted();
  }

  async function loadVersionIntoEditor(version: Version, opts: { skipDraftSave?: boolean } = {}) {
    // Cancel any active voxel paint before loading a different version — its
    // live grid and provenance map are bound to the OUTGOING code, so a Bake
    // after navigation would write the wrong session's voxels into the new
    // editor. Also unlocks the editor and clears the floating panel.
    cancelVoxelPaintIfActive();
    // Each version remembers the language it was authored in (per-version
    // since schema 1.8); fall back to the session-level hint, then to the
    // engine default. Lets a single session hold mixed JS + SCAD versions
    // and switch the engine as you click between them. When crossing a
    // language boundary we stash the current editor buffer as a draft for
    // the previous language first, so navigate ↔ toggle round-trips don't
    // silently drop work-in-progress in the language we're leaving.
    // skipDraftSave is set by onSelectPart, which saves the outgoing draft
    // before calling changePart (ensuring it lands under the correct part id).
    const versionLang = effectiveVersionLanguage(version, getState().session);
    if (versionLang !== getActiveLanguage()) {
      if (!opts.skipDraftSave) {
        const sid = getState().session?.id;
        const pid = getState().currentPart?.id;
        if (sid) await writeDraft(sid, getActiveLanguage(), getValue(), pid);
      }
      await switchLanguage(versionLang);
    } else {
      // Engine is already on the right language but the toolbar might have
      // drifted (e.g. a previous same-language part was active) — sync it.
      setToolbarLanguage(versionLang);
    }
    setActiveImports((version.importedMeshes ?? []) as ImportedMesh[]);
    setValue(version.code);
    // Restore this version's Customizer overrides so it re-runs (and renders)
    // with the values it was saved at — keeping geometry consistent with the
    // saved thumbnail/stats. runCodeSync prunes these against the model's
    // declared schema, so stale keys from a previous model fall away.
    currentParamValues = { ...(version.paramValues ?? {}) };
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
    await ensureEngineStarted();
    if (!engineOk) return;
    await createSession();
    updateDocumentTitle({ page: 'editor' });
    setStatus(statusBar, 'ready', 'Ready');
    runCode(defaultCode);
  }

  async function openSessionFromLanding(sid: string) {
    updateAppHistory(`/editor?session=${sid}`, 'push');
    transitionToEditor();
    await ensureEditorReady();
    await ensureEngineStarted();
    if (!engineOk) return;
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

  // Launch the guided tour from an entry point outside the editor (the landing
  // CTA or the help page button): the tour spotlights editor chrome, so make
  // sure we're in the editor with a live session before it starts.
  async function takeGuidedTour() {
    updateAppHistory('/editor', 'push');
    transitionToEditor();
    await ensureEditorReady();
    await ensureEngineStarted();
    if (!getState().session) {
      await createSession();
      runCode(defaultCode);
    }
    resetTour();
    startTour();
  }

  function ensureLandingPage() {
    if (!landingEl) {
      landingEl = createLandingPage(overlayContainer, {
        onOpenEditor: openEditorFromLanding,
        onOpenHelp: () => showHelp(),
        onOpenCatalog: () => { void showCatalogPage(); },
        onOpenIdeas: () => { showIdeasPage(); },
        onOpenWhatsNew: () => showWhatsNewPage(),
        onTakeTour: () => { void takeGuidedTour(); },
        onOpenSession: openSessionFromLanding,
        onLoadCatalogEntry: handleCatalogEntryLoad,
      });
    }
    return landingEl;
  }

  async function showLandingPage() {
    const page = ensureLandingPage();
    overlayContainer.classList.remove('hidden');
    editorUI.classList.add('hidden');
    helpEl?.classList.add('hidden');
    notFoundEl?.classList.add('hidden');
    catalogEl?.classList.add('hidden');
    ideasEl?.classList.add('hidden');
    legalEl?.classList.add('hidden');
    whatsNewEl?.classList.add('hidden');
    page.classList.remove('hidden');
    updateDocumentTitle({ page: 'landing' });
    // Build and render the JS page behind the static overlay, then remove the
    // overlay only after fonts are settled — both pages then share the same
    // metrics, making the swap invisible. Copy scroll position so the user's
    // reading position is preserved if they scrolled before JS finished.
    await document.fonts.ready;
    requestAnimationFrame(() => {
      const li = document.getElementById('landing-inline');
      if (li) {
        page.scrollTop = li.scrollTop;
        li.remove();
      }
    });
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
    ideasEl?.classList.add('hidden');
    legalEl?.classList.add('hidden');
    whatsNewEl?.classList.add('hidden');
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
        onStartTour: () => { void takeGuidedTour(); },
      });
    }
    overlayContainer.classList.remove('hidden');
    editorUI.classList.add('hidden');
    if (landingEl) landingEl.classList.add('hidden');
    if (notFoundEl) notFoundEl.classList.add('hidden');
    if (catalogEl) catalogEl.classList.add('hidden');
    if (ideasEl) ideasEl.classList.add('hidden');
    if (legalEl) legalEl.classList.add('hidden');
    if (whatsNewEl) whatsNewEl.classList.add('hidden');
    helpEl.classList.remove('hidden');
    updateDocumentTitle({ page: 'help' });
  }

  // Helper to show legal page — mirrors showHelp's history / in-page-Back pattern.
  function showLegal(options: { history?: 'push' | 'replace' | 'none' } = {}) {
    const historyMode = options.history ?? 'push';
    if (historyMode !== 'none') {
      legalHasAppBackTarget = currentURLPathAndSearch() !== '/legal';
      updateAppHistory('/legal', historyMode);
    }
    if (!legalEl) {
      legalEl = createLegalPage(overlayContainer, {
        onBack: () => {
          if (legalHasAppBackTarget) {
            window.history.back();
          } else {
            updateAppHistory('/editor', 'replace');
            void syncEditorFromURL();
          }
        },
      });
    }
    overlayContainer.classList.remove('hidden');
    editorUI.classList.add('hidden');
    if (landingEl) landingEl.classList.add('hidden');
    if (notFoundEl) notFoundEl.classList.add('hidden');
    if (catalogEl) catalogEl.classList.add('hidden');
    if (ideasEl) ideasEl.classList.add('hidden');
    if (helpEl) helpEl.classList.add('hidden');
    legalEl.classList.remove('hidden');
    updateDocumentTitle({ page: 'legal' });
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
        onOpenIdeas: () => { showIdeasPage(); },
      });
    }
    overlayContainer.classList.remove('hidden');
    editorUI.classList.add('hidden');
    if (landingEl) landingEl.classList.add('hidden');
    if (helpEl) helpEl.classList.add('hidden');
    if (notFoundEl) notFoundEl.classList.add('hidden');
    if (legalEl) legalEl.classList.add('hidden');
    if (whatsNewEl) whatsNewEl.classList.add('hidden');
    if (ideasEl) ideasEl.classList.add('hidden');
    catalogEl.classList.remove('hidden');
    updateDocumentTitle({ page: 'catalog' });
  }

  let whatsNewEl: HTMLElement | null = null;
  let whatsNewHasAppBackTarget = false;
  function showWhatsNewPage(options: { history?: 'push' | 'replace' | 'none' } = {}) {
    const historyMode = options.history ?? 'push';
    if (historyMode !== 'none') {
      whatsNewHasAppBackTarget = currentURLPathAndSearch() !== '/whats-new';
      updateAppHistory('/whats-new', historyMode);
    }
    if (!whatsNewEl) {
      whatsNewEl = createWhatsNewPage(overlayContainer, {
        onBack: () => {
          if (whatsNewHasAppBackTarget) {
            window.history.back();
          } else {
            updateAppHistory('/', 'replace');
            void syncRouteFromURL();
          }
        },
        onOpenEditor: openEditorFromLanding,
      });
    }
    overlayContainer.classList.remove('hidden');
    editorUI.classList.add('hidden');
    if (landingEl) landingEl.classList.add('hidden');
    if (helpEl) helpEl.classList.add('hidden');
    if (catalogEl) catalogEl.classList.add('hidden');
    if (ideasEl) ideasEl.classList.add('hidden');
    if (notFoundEl) notFoundEl.classList.add('hidden');
    whatsNewEl.classList.remove('hidden');
    updateDocumentTitle({ page: 'whats-new' });
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
    await ensureEngineStarted();
    if (!engineOk) return;
    await importSessionPayload(payload);
    updateDocumentTitle({ page: 'editor' });
  }

  // === Ideas page handlers ===

  /** Enter the editor with a live session, ready for a hand-off. Used by the
   *  ideas-page actions: they all start by getting the user into the editor
   *  (pushing the history entry BEFORE any session mutation, same reason as
   *  handleCatalogEntryLoad). */
  async function enterEditorForIdea(): Promise<void> {
    updateAppHistory('/editor', 'push');
    transitionToEditor();
    await ensureEditorReady();
  }

  // A starter/technique idea — drop its prompt into the AI panel (don't send).
  async function handleIdeaUsePrompt(idea: Idea): Promise<void> {
    await enterEditorForIdea();
    if (window.location.pathname !== '/editor') return;
    if (!getState().session) {
      await createSession();
      setStatus(statusBar, 'ready', 'Ready');
      runCode(defaultCode);
    }
    updateDocumentTitle({ page: 'editor' });
    prefillAiInput(idea.prompt ?? '');
  }

  // An interactive idea: turn the user's photo into a colored voxel session
  // (reuses the existing image→voxel import flow, modal and all).
  async function handleIdeaPhotoToVoxel(file: File): Promise<void> {
    await enterEditorForIdea();
    if (window.location.pathname !== '/editor') return;
    await handleImageImport(file);
    updateDocumentTitle({ page: 'editor' });
  }

  // An interactive idea: emboss the user's photo as a smooth relief tile
  // (reuses the existing Relief import wizard).
  async function handleIdeaPhotoToRelief(file: File): Promise<void> {
    await enterEditorForIdea();
    if (window.location.pathname !== '/editor') return;
    openReliefImportFlow(file);
    updateDocumentTitle({ page: 'editor' });
  }

  let ideasEl: HTMLElement | null = null;
  let ideasHasAppBackTarget = false;
  function showIdeasPage(options: { history?: 'push' | 'replace' | 'none' } = {}) {
    const historyMode = options.history ?? 'push';
    if (historyMode !== 'none') {
      ideasHasAppBackTarget = currentURLPathAndSearch() !== '/ideas';
      updateAppHistory('/ideas', historyMode);
    }
    if (!ideasEl) {
      ideasEl = createIdeasPage(overlayContainer, {
        onBack: () => {
          if (ideasHasAppBackTarget) {
            window.history.back();
          } else {
            updateAppHistory('/', 'replace');
            void syncRouteFromURL();
          }
        },
        onUsePrompt: handleIdeaUsePrompt,
        onPhotoToVoxel: handleIdeaPhotoToVoxel,
        onPhotoToRelief: handleIdeaPhotoToRelief,
      });
    }
    overlayContainer.classList.remove('hidden');
    editorUI.classList.add('hidden');
    if (landingEl) landingEl.classList.add('hidden');
    if (helpEl) helpEl.classList.add('hidden');
    if (notFoundEl) notFoundEl.classList.add('hidden');
    if (legalEl) legalEl.classList.add('hidden');
    if (catalogEl) catalogEl.classList.add('hidden');
    if (whatsNewEl) whatsNewEl.classList.add('hidden');
    ideasEl.classList.remove('hidden');
    updateDocumentTitle({ page: 'ideas' });
  }

  // === Shared-link preview mode (read-only) ===

  // DOM owned by shared-preview mode, removed on exit so nothing leaks.
  let sharedBannerEl: HTMLElement | null = null;
  let sharedOverlayEl: HTMLElement | null = null;

  /** Toggle a control's disabled state + dimmed/non-interactive styling. Used to
   *  neutralize Paint, Save, and the language toggle in shared preview without
   *  re-implementing each control's own logic. */
  function setControlNeutralized(id: string, off: boolean): void {
    const el = document.getElementById(id);
    if (!el) return;
    if ('disabled' in el) (el as HTMLButtonElement).disabled = off;
    el.classList.toggle('opacity-40', off);
    el.classList.toggle('pointer-events-none', off);
  }

  /** Enter read-only shared-preview mode: refuse execution + save (via the
   *  module flag), hold the editor read-only, and neutralize Run / Paint / Save /
   *  language toggle. Mounts the banner above the editor and the overlay (with
   *  the decoded thumbnail + Fork CTA) over the viewport. */
  function enterSharedMode(thumbnail: string | undefined): void {
    _sharedPreview = true;
    setReadOnlyReason('shared', true);
    disableRun();
    if (isPaintOpen()) closePaintMenu();
    setControlNeutralized('paint-toggle', true);
    setControlNeutralized('btn-save-version', true);
    setControlNeutralized('lang-toggle', true);

    // Rebuild the banner + overlay fresh on every entry so re-previewing a
    // DIFFERENT share link (pasted over an active preview) shows the new
    // thumbnail rather than a stale one carried over from the previous link.
    if (sharedBannerEl) { sharedBannerEl.remove(); sharedBannerEl = null; }
    if (sharedOverlayEl) { sharedOverlayEl.remove(); sharedOverlayEl = null; }
    sharedBannerEl = renderSharedBanner(() => { void onFork(); });
    const editorPane = editorContainer.parentElement;
    if (editorPane) editorPane.insertBefore(sharedBannerEl, editorContainer);
    sharedOverlayEl = renderSharedOverlay({ thumbnail, onFork: () => { void onFork(); } });
    viewportPane.appendChild(sharedOverlayEl);
  }

  /** Leave shared-preview mode: re-enable every control and remove the banner +
   *  overlay. Disposes nothing on the GPU here — the cold preview never built a
   *  Three.js mesh — but tears down the overlay's <img> via .remove(). */
  function exitSharedMode(): void {
    _sharedPreview = false;
    setReadOnlyReason('shared', false);
    enableRun();
    setControlNeutralized('paint-toggle', false);
    setControlNeutralized('btn-save-version', false);
    setControlNeutralized('lang-toggle', false);
    if (sharedBannerEl) { sharedBannerEl.remove(); sharedBannerEl = null; }
    if (sharedOverlayEl) { sharedOverlayEl.remove(); sharedOverlayEl = null; }
    // Re-derive the Run button state from the (reason-counted) editor lock, so we
    // never leave Run enabled if a color lock happens to be active.
    syncLockState();
  }

  /** Strip the `#share=` hash from the URL without touching the back stack or
   *  re-firing routing. Modeled on the ?takeover=1 strip — keeps path + search,
   *  drops only the hash, so refresh / Back never re-decodes the link. */
  function stripShareHash(): void {
    // Entering a shared preview always shows the editor, so normalize the path
    // to /editor — otherwise pasting #share=… onto /catalog or /help would
    // leave the URL claiming a non-editor page while the editor is on screen.
    // App-generated links already use /editor#share=, so this is a no-op there.
    window.history.replaceState(null, '', '/editor' + window.location.search);
  }

  /** Open a `#share=…` link as a read-only preview. Decodes + validates the
   *  UNTRUSTED payload, strips the hash, and renders code/stats/thumbnail
   *  WITHOUT touching IndexedDB or running anything. On any failure it degrades
   *  to a normal editable empty editor (no uncaught error, no scary toast). */
  async function enterSharedFromHash(): Promise<void> {
    const hashValue = getShareHashValue();
    if (hashValue === null) return;

    transitionToEditor();
    switchTab('interactive', { history: 'none' });
    updateDocumentTitle({ page: 'editor' });
    await ensureEditorReady();
    await ensureEngineStarted();
    if (!engineOk) return;

    // Decode + validate. ANY failure → graceful fallback to a blank editor.
    let payload: ExportedSession;
    try {
      const parsed = await decodeShare(hashValue);
      // App-level brand/schema check first, then the structural/security shape
      // validator (which also drops an unsafe thumbnail).
      const branded = validateSessionPayload(parsed);
      if (!branded) throw new Error('not a Partwright payload');
      payload = validateSharePayloadShape(branded);
    } catch (e) {
      // A malformed/hostile share link is an expected degrade path, not an app
      // error — log to the console only (keep it out of the user-facing
      // diagnostic log) and fall back to a normal editable editor.
      console.debug('Partwright: ignoring invalid share link —', e instanceof Error ? e.message : String(e));
      stripShareHash();
      exitSharedMode();
      // Fall through to a normal, editable empty editor.
      if (!getState().session) await createSession();
      setStatus(statusBar, 'ready', 'Ready');
      runCode(defaultCode);
      return;
    }

    // Valid: strip the hash immediately so refresh / Back can't re-fire it.
    stripShareHash();

    const version = payload.versions[0];
    const lang = asLanguage(version.language ?? payload.session.language) ?? 'manifold-js';

    // Apply the version's language with the BARE alias (engine + editor only —
    // never switchLanguageWithDrafts, which would createSession() + runCode()).
    if (lang !== getActiveLanguage()) await switchLanguage(lang);

    // Read-only preview, no IndexedDB writes, no execution.
    enterSharedMode(version.thumbnail);
    setValue(version.code); // setValue does not auto-run
    // Populate the live stats panel straight from the embedded geometryData —
    // we deliberately do NOT run the code.
    const stats = version.geometryData;
    geometryDataEl.textContent = stats
      ? JSON.stringify(stats, null, 2)
      : JSON.stringify({ status: 'shared-preview' });
    setStatus(statusBar, 'ready', 'Shared preview (read-only)');

    // Stash the validated payload for the Fork handler (the consented import).
    pendingSharedPayload = payload;
  }

  // The decoded share payload awaiting an explicit Fork (the first consented
  // execution). Held only while a shared preview is on screen.
  let pendingSharedPayload: ExportedSession | null = null;

  /** Fork the previewed share into a real local session. Reuses the
   *  catalog-load ORDER (push /editor → transition → ensureReady →
   *  importSessionPayload, which runs the code) — this is the consented first
   *  execution. Then leaves shared mode. */
  async function onFork(): Promise<void> {
    const payload = pendingSharedPayload;
    if (!payload) return;
    // Leave shared mode FIRST so the import's runCode() isn't refused by the
    // execution guard.
    exitSharedMode();
    pendingSharedPayload = null;
    updateAppHistory('/editor', 'push');
    transitionToEditor();
    await ensureEditorReady();
    await importSessionPayload(payload);
    updateDocumentTitle({ page: 'editor' });
  }

  // On a session open where we land on the LATEST version (the version the
  // user would be actively editing — the URL pins ?v=<latest> after every
  // save, so this is the normal reopen case), prefer an autosaved draft for
  // the active language when it exists and differs from the code we just
  // loaded. This is what makes editor autosave recover unsaved typing across a
  // reload / crash. It is deliberately skipped when we loaded an OLDER version
  // (explicit history navigation), so a stale draft never shadows a version
  // the user intentionally went back to.
  async function restoreDraftIfNewer(): Promise<void> {
    const sid = getState().session?.id;
    if (!sid) return;
    const pid = getState().currentPart?.id;
    // Only at the tip: if a specific older version is loaded, don't override it.
    const current = getState().currentVersion;
    if (current) {
      const versions = await listCurrentVersions();
      const latestIndex = versions.reduce((m, v) => Math.max(m, v.index), -Infinity);
      if (current.index !== latestIndex) return;
    }
    const draft = await readDraft(sid, getActiveLanguage(), pid);
    if (draft == null || draft === getValue()) return;
    setValue(draft);
    await runCodeSync(draft);
  }

  async function syncEditorFromURL() {
    transitionToEditor();
    const tab = getTabFromURL();
    switchTab(tab, { history: 'none' });
    updateDocumentTitle({ page: 'editor' });
    await ensureEditorReady();
    await ensureEngineStarted();
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
          // restoreDraftIfNewer self-gates: it only acts when this is the
          // latest version (the tip the user edits), not an older one they
          // navigated back to.
          await restoreDraftIfNewer();
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
          await restoreDraftIfNewer();
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
    if (shouldShowLanding() || shouldShowHelp() || shouldShowCatalog() || shouldShowIdeas() || shouldShowLegal() || shouldShowWhatsNew() || shouldShow404()) {
      void setAiActiveSession(null);
    }
    // A share-link hash takes precedence over the normal editor sync on this
    // path too (e.g. a popstate that lands back on a `#share=` URL), so we never
    // createSession()+default-code over a shared preview.
    if (hasShareHash()) {
      await enterSharedFromHash();
    } else if (shouldShowLanding()) {
      showLandingPage();
    } else if (shouldShowHelp()) {
      showHelp({ history: 'none' });
    } else if (shouldShowCatalog()) {
      await showCatalogPage({ history: 'none' });
    } else if (shouldShowIdeas()) {
      showIdeasPage({ history: 'none' });
    } else if (shouldShowLegal()) {
      showLegal({ history: 'none' });
    } else if (shouldShowWhatsNew()) {
      showWhatsNewPage({ history: 'none' });
    } else if (shouldShow404()) {
      showNotFoundPage();
    } else {
      await syncEditorFromURL();
    }
  }

  window.addEventListener('popstate', () => {
    void syncRouteFromURL();
  });

  // Pasting a share URL into an already-open editor changes only the hash, which
  // fires `hashchange` (NOT popstate). Decode it into a read-only preview.
  // Re-entrancy guard: skip if we're already previewing this exact hash (entering
  // shared mode itself strips the hash, so this won't loop on our own change).
  let lastSharedHash: string | null = null;
  window.addEventListener('hashchange', () => {
    const value = getShareHashValue();
    if (value === null) return;
    if (_sharedPreview && value === lastSharedHash) return;
    lastSharedHash = value;
    void enterSharedFromHash();
  });

  // Expose showHelp for toolbar
  const windowRecord = window as unknown as Record<string, unknown>;
  windowRecord.__partwrightShowHelp = showHelp;
  windowRecord.__mainifoldShowHelp = showHelp;

  // Check which page to show before loading heavy resources
  const showLanding = shouldShowLanding();
  const showHelpPage = shouldShowHelp();
  const showCatalog = shouldShowCatalog();
  const showIdeas = shouldShowIdeas();
  const showLegalPage = shouldShowLegal();
  const showWhatsNew = shouldShowWhatsNew();
  const show404 = shouldShow404();

  if (showLanding) {
    await showLandingPage();
  } else if (showHelpPage) {
    showHelp({ history: 'none' });
  } else if (showCatalog) {
    await showCatalogPage({ history: 'none' });
  } else if (showIdeas) {
    showIdeasPage({ history: 'none' });
  } else if (showLegalPage) {
    showLegal({ history: 'none' });
  } else if (showWhatsNew) {
    showWhatsNewPage({ history: 'none' });
  } else if (show404) {
    showNotFoundPage();
  }

  // Geometry engine initialisation — deferred until the user first opens the
  // editor. WASM is never loaded on landing / catalog / help page visits.
  const COI_MISSING_MSG =
    "This browser tab is not cross-origin isolated, so the WASM engine (which needs SharedArrayBuffer) can't start. " +
    "This usually fixes itself on reload; if it persists, the required COOP/COEP headers aren't reaching the page " +
    '(a proxy, extension, or unsupported browser can strip them).';

  function ensureEngineStarted(): Promise<void> {
    if (engineLoadPromise) return engineLoadPromise;
    setStatus(statusBar, 'loading', 'Loading WASM...');
    engineLoadingOverlay?.classList.remove('hidden');
    if (!isolationSupported()) {
      // Has the COI shim already had a chance to reload this tab? It registers a
      // service worker and reloads once; until a controller exists, that reload
      // is still pending, so stay on the neutral "Loading…" message rather than
      // alarming the user. We remember that we waited so a second non-isolated
      // load (where the shim can't help) surfaces the explanation.
      let coiReloadPending = false;
      try {
        const waited = sessionStorage.getItem('partwright-coi-waited') === '1';
        const hasController = 'serviceWorker' in navigator && !!navigator.serviceWorker.controller;
        coiReloadPending = !waited && !hasController && 'serviceWorker' in navigator;
        if (coiReloadPending) sessionStorage.setItem('partwright-coi-waited', '1');
      } catch {
        coiReloadPending = false;
      }
      if (!coiReloadPending) {
        setStatus(statusBar, 'error', 'WASM unavailable (not cross-origin isolated)');
        errorLog.capture({ level: 'error', source: 'engine', message: COI_MISSING_MSG });
        showToast(COI_MISSING_MSG, { variant: 'warn', durationMs: 9000 });
      }
      engineLoadingOverlay?.classList.add('hidden');
      engineLoadPromise = Promise.resolve();
    } else {
      engineLoadPromise = (async () => {
        try {
          await initEngine();
          engineOk = true;
        } catch (e) {
          console.error('WASM engine failed to load:', e);
          const coiMissing = !isolationSupported();
          setStatus(statusBar, 'error', coiMissing ? 'WASM unavailable (not cross-origin isolated)' : 'WASM failed');
          errorLog.capture({
            level: 'error',
            source: 'engine',
            message: coiMissing ? COI_MISSING_MSG : `WASM engine failed to load: ${e instanceof Error ? e.message : String(e)}`,
          });
        } finally {
          engineLoadingOverlay?.classList.add('hidden');
        }
      })();
    }
    return engineLoadPromise;
  }

  // Init viewport
  initViewport(viewportPane);

  // Indeterminate progress bar shown over the viewport while WASM loads on
  // first editor open. Hidden by ensureEngineStarted's finally block.
  {
    const style = document.createElement('style');
    style.textContent = '@keyframes pw-bar{0%{left:0;width:30%}50%{left:35%;width:30%}100%{left:70%;width:30%}}';
    document.head.appendChild(style);
    engineLoadingOverlay = document.createElement('div');
    engineLoadingOverlay.className = 'absolute inset-0 flex flex-col items-center justify-center z-10 pointer-events-none hidden';
    const loadingText = document.createElement('div');
    loadingText.className = 'text-xs text-zinc-400 mb-3 font-mono';
    loadingText.textContent = 'Loading engine…';
    const progressTrack = document.createElement('div');
    progressTrack.className = 'relative w-48 h-1 bg-zinc-700 rounded-full overflow-hidden';
    const progressBar = document.createElement('div');
    progressBar.className = 'absolute h-full bg-blue-500 rounded-full';
    progressBar.style.animation = 'pw-bar 1.5s ease-in-out infinite';
    progressTrack.appendChild(progressBar);
    engineLoadingOverlay.appendChild(loadingText);
    engineLoadingOverlay.appendChild(progressTrack);
    viewportPane.appendChild(engineLoadingOverlay);
  }

  // Keep the live triangle-count readout (and high-complexity warning) in sync
  // with every displayed mesh — runs, paint strokes, simplify, clear.
  setOnMeshUpdate((mesh) => refreshTriangleCount(mesh.numTri));
  // Surface WebGL context loss / recovery as a toast (three.js auto-restores
  // the GL programs; the viewport just pauses + resumes its render loop).
  setOnContextLost(() => {
    showToast('3D view paused — the graphics context was lost. Recovering…', { variant: 'warn', durationMs: 6000 });
  });
  setOnContextRestored(() => {
    showToast('3D view recovered.', { variant: 'success' });
  });

  // Customizer panel — a viewport overlay that surfaces the parameters a model
  // declares via api.params({...}). Editing a widget records the override and
  // re-runs (live preview); Reset clears all overrides back to model defaults.
  // Hidden until a run reports a parameter schema.
  //
  // A "Customize" toggle pill in the viewport toolbar (created below) is the
  // discoverable open/reopen affordance: it appears only when the active model
  // declares parameters, shows the count, and mirrors the panel's open state —
  // so closing the panel never strands the user without a way back in.
  const customizeBtn = document.createElement('button');
  customizeBtn.id = 'customize-toggle';
  customizeBtn.title = 'Tweak this model’s parameters';
  customizeBtn.className = 'hidden'; // shown by syncCustomizeBtn once a run reports params
  customizeBtn.addEventListener('click', () => paramsPanel?.toggle());
  const CUSTOMIZE_BTN_BASE = 'md:px-2 md:py-1 px-3 py-2 rounded text-sm md:text-xs backdrop-blur transition-colors border';
  const CUSTOMIZE_BTN_OPEN = `${CUSTOMIZE_BTN_BASE} bg-blue-500/30 text-blue-300 border-blue-500/50`;
  const CUSTOMIZE_BTN_CLOSED = `${CUSTOMIZE_BTN_BASE} bg-zinc-800/80 text-zinc-400 [@media(hover:hover)]:hover:text-zinc-200 [@media(hover:hover)]:hover:bg-zinc-700/80 border-zinc-600/50`;
  const syncCustomizeBtn = (state: { hasParams: boolean; open: boolean; count: number }) => {
    customizeBtn.textContent = state.count > 0 ? `🎛 Customize (${state.count})` : '🎛 Customize';
    customizeBtn.className = state.open ? CUSTOMIZE_BTN_OPEN : CUSTOMIZE_BTN_CLOSED;
    // No declared parameters → no button at all (matches the panel being hidden).
    customizeBtn.classList.toggle('hidden', !state.hasParams);
  };

  paramsPanel = createParamsPanel({
    onChange: (key, value) => {
      currentParamValues = { ...currentParamValues, [key]: value };
      runCode();
    },
    onReset: () => {
      currentParamValues = {};
      runCode();
    },
    onVisibilityChange: syncCustomizeBtn,
  });
  viewportPane.appendChild(paramsPanel.element);
  // Sit the Customize pill with the other panel-toggling tools (Paint/Measure),
  // just after the view-toggle divider — same grouping Paint/Annotate use, so it
  // reads as a tool and stays clear of the top-left "Show code" button that the
  // wrapping toolbar's leftmost item collides with.
  const measureToggle = clipControls.querySelector('#measure-toggle');
  if (measureToggle) clipControls.insertBefore(customizeBtn, measureToggle);
  else clipControls.appendChild(customizeBtn);

  // Init measure tool
  initMeasureTool(getCanvas(), getCamera(), getMeshGroup(), viewportPane);

  reliefStudio = mountReliefStudio(viewportPane, {
    getLayerHeight: () => currentLayerHeight(),
    setLayerHeight: (mm: number) => {
      const sid = getState().session?.id ?? null;
      if (sid) updateReliefSettings(sid, { layerHeight: mm });
      refreshModelColors();
      reliefStudio?.refresh();
    },
    getPreviewMode: () => ctlGetReliefPreviewMode(),
    setPreviewMode: (mode: PreviewMode) => {
      ctlSetReliefPreviewMode(mode);
      const sid = getState().session?.id ?? null;
      if (sid) updateReliefSettings(sid, { previewMode: mode });
      refreshModelColors();
    },
    getSwapGuide: () => (currentMeshData ? getSwapGuideFor(currentMeshData, currentLayerHeight()) : null),
    detectLevels: () => detectReliefLevels(),
    onClose: () => closeReliefStudio(),
    onEditImage: () => {
      const sid = getState().session?.id ?? null;
      if (sid) void reopenReliefImport(sid);
      else openReliefImportFlow();
    },
  });

  // Persist the editor's working buffer to the active session's draft so an
  // accidental reload / tab-close / crash doesn't lose unsaved typing. Reads
  // getActiveLanguage() + getValue() SYNCHRONOUSLY at fire time so the draft
  // lands under the right (session, language) key — same key version-load and
  // the language-toggle path use — and never writes OLD code under a NEW
  // language. Skips when no session is open so we don't auto-create empty
  // sessions (which would fight deleteIfEmpty on unload). Best-effort: a quota
  // failure is swallowed with a warn toast since autosave is non-critical.
  function autosaveDraft(): void {
    const sid = getState().session?.id;
    if (!sid) return;
    const pid = getState().currentPart?.id;
    const lang = getActiveLanguage();
    const code = getValue();
    void writeDraft(sid, lang, code, pid).catch((e) => {
      if (isQuotaError(e)) {
        showToast('Storage full — could not autosave your draft. Free up space or export your work.', { variant: 'warn' });
      }
      // Other autosave failures are non-fatal and intentionally silent.
    });
  }

  // Init editor — only auto-run if auto-run is enabled. Auto-runs drive the
  // live preview but defer error surfacing (no panel/markers/log mid-keystroke);
  // the idle + blur hooks surface the held-back error gently once typing settles.
  // The same idle/blur ticks autosave the draft. A programmatic setValue
  // (version load / language switch) cancels the pending onIdle (see
  // codeEditor.setValue), so autosave never fires for code the user didn't type.
  initEditor(editorContainer, defaultCode, (code: string) => {
    if (isAutoRun()) runCode(code, { surfaceErrors: false });
  }, 'manifold-js', {
    onEdit: () => clearEditorErrorPanel(editorErrorPanel),
    onIdle: () => { surfacePendingError(); autosaveDraft(); },
    onBlur: () => { surfacePendingError(); autosaveDraft(); },
  });

  // Autosave when the tab is hidden (switching apps, closing) — the most
  // reliable "user is leaving" signal that still permits an async IDB write,
  // unlike beforeunload which can't await. Singleton listener (main runs once).
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) autosaveDraft();
  });

  // One-time low-memory heads-up. On devices reporting <= 4 GB RAM
  // (navigator.deviceMemory), the WASM engines + Three.js can get sluggish or
  // OOM on heavy models. Shown as a DISMISSIBLE banner (not a toast — a toast
  // can't be persistently dismissed) with the choice remembered in
  // localStorage. deviceMemory is undefined in Firefox/Safari, so the
  // typeof-number guard means those browsers never see it (no false alarm).
  const LOWMEM_DISMISS_KEY = 'partwright-lowmem-dismissed';
  function maybeShowLowMemoryNotice(): void {
    const dm = (navigator as unknown as { deviceMemory?: unknown }).deviceMemory;
    if (typeof dm !== 'number' || dm > 4) return;
    try {
      if (localStorage.getItem(LOWMEM_DISMISS_KEY) === '1') return;
    } catch { /* localStorage unavailable — show it anyway */ }

    const banner = document.createElement('div');
    banner.id = 'lowmem-notice';
    banner.className = 'flex items-center gap-3 px-4 py-2 text-xs bg-amber-900/30 border-b border-amber-700/40 text-amber-200';
    const msg = document.createElement('span');
    msg.className = 'flex-1';
    msg.textContent = `Heads up: this device reports ${dm} GB of memory. Large or high-detail models may render slowly or run out of memory — lower the modeling quality (⚙) or simplify the mesh if things get sluggish.`;
    const dismiss = document.createElement('button');
    // 44px-tall hit area for touch while staying visually compact.
    dismiss.className = 'shrink-0 -my-2 px-3 py-3 leading-none text-amber-300 hover:text-amber-100 transition-colors';
    dismiss.setAttribute('aria-label', 'Dismiss low-memory notice');
    dismiss.textContent = '✕';
    dismiss.addEventListener('click', () => {
      banner.remove();
      try { localStorage.setItem(LOWMEM_DISMISS_KEY, '1'); } catch { /* best-effort */ }
    });
    banner.appendChild(msg);
    banner.appendChild(dismiss);
    // Sit at the very top of the editor UI, above the toolbar.
    editorUI.insertBefore(banner, editorUI.firstChild);
  }

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
  // Baseline mesh with triColors baked in (set when the panel opens with paint
  // active). Used as the color source for all carry operations in this session.
  let simplifyBaselineColoredMesh: MeshData | null = null;
  // Serialized paint (user) regions from the baseline — restored when the user resets.
  let simplifyBaselineRegions: SerializedColorRegion[] | null = null;
  // Model color region snapshot — these come from code declarations, not user paint,
  // so they aren't captured by serializeRegions(). Captured separately at open time.
  let simplifyBaselineModelRegions: Array<{ name: string; color: [number, number, number]; triangles: Set<number> }> | null = null;

  // Restore the baseline mesh and all its color state (user regions + model regions).
  // Used by simplify/enhance's "already at full detail" early-out and by Reset.
  function restoreBaselineColors(baseline: MeshData): void {
    if (simplifyBaselineColoredMesh) {
      resetPaintWorkerState();
      clearRegions();
      clearModelColorRegions();
      applyLiveGeometry(baseline);
      if (simplifyBaselineModelRegions && simplifyBaselineModelRegions.length > 0) {
        setModelColorRegions(simplifyBaselineModelRegions);
      }
      rehydrateColorRegions({ colorRegions: simplifyBaselineRegions ?? [] });
      updateMesh(applyTriColorsIfVisible(baseline), { skipAutoFrame: true });
    } else {
      applyLiveGeometryWithColor(baseline);
    }
  }

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

  /** Apply geometry and ensure colors from the regions module are re-rendered.
   *  `applyLiveGeometry` calls `updateMesh(mesh)` which bypasses color regions;
   *  this overrides that with a colored repaint when regions are active. */
  function applyLiveGeometryWithColor(mesh: MeshData): void {
    applyLiveGeometry(mesh);
    if (hasColorRegions() || hasModelColorRegions()) {
      updateMesh(applyTriColorsIfVisible(mesh), { skipAutoFrame: true });
    }
  }

  /** Transfer colors from `src` (which must have `.triColors`) onto `dest` via
   *  nearest-triangle centroid mapping. Returns `dest` with `triColors` added. */
  function carryColorsToMesh(src: MeshData, dest: MeshData): MeshData {
    const srcColors = src.triColors!;
    const nearest = nearestTriangleMap(src, dest);
    const triColors = new Uint8Array(dest.numTri * 3);
    for (let t = 0; t < dest.numTri; t++) {
      const o = nearest[t];
      if (o >= 0) {
        triColors[t * 3]     = srcColors[o * 3];
        triColors[t * 3 + 1] = srcColors[o * 3 + 1];
        triColors[t * 3 + 2] = srcColors[o * 3 + 2];
      }
    }
    return { ...dest, triColors };
  }

  const simplifyHandlers: SimplifyHandlers = {
    open(userInitiated) {
      if (userInitiated) {
        // Don’t let two overlay panels share the top-right slot.
        if (isPaintOpen()) closePaintMenu();
        if (isAnnotateOpen()) closeAnnotateMenu();
        closeMeasureIfActive();
      }
      if (!currentMeshData) {
        return { ok: false, reason: "Run some code first — there’s no model to simplify." };
      }
      if (!currentManifold) {
        return { ok: false, reason: "Simplify needs a solid (manifold) model. Render-only imports can’t be reduced." };
      }
      if (!simplifyBaselineMesh) {
        simplifyBaselineMesh = currentMeshData;
        // Snapshot colors once so all carry operations in this session use the
        // same source — even after apply clears the regions module state.
        if (modelHasColor()) {
          simplifyBaselineColoredMesh = applyTriColors(currentMeshData);
          simplifyBaselineRegions = serializeRegions();
          simplifyBaselineModelRegions = getModelRegions().map(r => ({
            name: r.name, color: [...r.color] as [number, number, number], triangles: new Set(r.triangles),
          }));
        }
      }
      return {
        ok: true,
        info: {
          baseTriangles: simplifyBaselineMesh.numTri,
          currentTriangles: currentMeshData.numTri,
          hasColor: simplifyBaselineColoredMesh != null,
        },
      };
    },

    async apply(targetTriangles, preserveColor, onProgress, signal) {
      const baseline = simplifyBaselineMesh;
      if (!baseline) return null;
      const coloredBaseline = preserveColor ? simplifyBaselineColoredMesh : null;

      // Dragging the target back to (or above) full detail is just a restore.
      if (targetTriangles >= baseline.numTri) {
        restoreBaselineColors(baseline);
        await onProgress(1);
        return { triangleCount: baseline.numTri };
      }
      const bbox = bboxFromMesh(baseline);
      const diag = bbox
        ? Math.hypot(bbox.max[0] - bbox.min[0], bbox.max[1] - bbox.min[1], bbox.max[2] - bbox.min[2])
        : 0;
      if (!(diag > 0)) return null;

      const result = await simplifyInWorker(
        baseline,
        targetTriangles,
        diag * 0.5,
        (fraction) => { void onProgress(fraction); },
        signal,
      );
      if (simplifyBaselineMesh !== baseline) return null;
      if (!result) {
        applyLiveGeometryWithColor(baseline);
        return null;
      }
      if (coloredBaseline?.triColors) {
        resetPaintWorkerState();
        clearRegions();
        clearModelColorRegions();
        applyLiveGeometry(carryColorsToMesh(coloredBaseline, result.mesh));
      } else {
        applyLiveGeometry(result.mesh);
      }
      return { triangleCount: result.triangleCount };
    },

    async enhance(targetTriangles, preserveColor, onProgress, signal) {
      const baseline = simplifyBaselineMesh;
      if (!baseline) return null;
      const coloredBaseline = preserveColor ? simplifyBaselineColoredMesh : null;

      if (targetTriangles <= baseline.numTri) {
        restoreBaselineColors(baseline);
        await onProgress(1);
        return { triangleCount: baseline.numTri };
      }
      const bbox = bboxFromMesh(baseline);
      const diag = bbox
        ? Math.hypot(bbox.max[0] - bbox.min[0], bbox.max[1] - bbox.min[1], bbox.max[2] - bbox.min[2])
        : 0;
      if (!(diag > 0)) return null;

      const result = await enhanceInWorker(
        baseline,
        targetTriangles,
        diag,
        (fraction) => { void onProgress(fraction); },
        signal,
      );
      if (simplifyBaselineMesh !== baseline) return null;
      if (!result) {
        applyLiveGeometryWithColor(baseline);
        return null;
      }
      if (coloredBaseline?.triColors) {
        resetPaintWorkerState();
        clearRegions();
        clearModelColorRegions();
        applyLiveGeometry(carryColorsToMesh(coloredBaseline, result.mesh));
      } else {
        applyLiveGeometry(result.mesh);
      }
      return { triangleCount: result.triangleCount };
    },

    reset() {
      if (!simplifyBaselineMesh) return;
      restoreBaselineColors(simplifyBaselineMesh);
    },

    async save() {
      const baseline = simplifyBaselineMesh;
      if (!getState().session) {
        return { ok: false, message: "Open a session before saving." };
      }
      if (!currentMeshData || !baseline || currentMeshData.numTri === baseline.numTri) {
        return { ok: false, message: "Simplify or enhance the model first, then save." };
      }
      try {
        const reduced = currentMeshData;
        // triColors on the live mesh (set by carry) — used to persist colors.
        const carriedColors = reduced.triColors ?? null;

        const originalCode = getValue();
        const current = getState().currentVersion;
        const parentId = current?.id ?? null;
        let savedOriginal = false;
        if (!current || editorContentDiffersFrom(current.code)) {
          const original = await snapshotMeshAsVersion(baseline, originalCode);
          savedOriginal = !!(await saveVersion(originalCode, original.geometryData, original.thumbnail));
        }

        const versionLabel = reduced.numTri < baseline.numTri ? 'simplified' : 'enhanced';
        const importFilename = `${versionLabel}-${reduced.numTri}tri`;
        const baked = toImportedMesh(importFilename, reduced);
        const code = generateImportCode([baked], { manifold: true });
        setActiveImports([baked]);
        setValue(code);
        await runCodeSync(code);
        let geoData = getGeometryDataObj();
        if (carriedColors && currentMeshData && geoData) {
          const { regions } = buildCarriedColorRegions(
            { ...reduced, triColors: carriedColors },
            carriedColors,
            currentMeshData,
          );
          if (regions.length > 0) {
            rehydrateColorRegions({ ...geoData, colorRegions: regions });
            geoData = enrichGeometryDataWithColors(getGeometryDataObj());
          }
        }
        const thumbnail = await captureThumbnail();
        await saveVersion(code, geoData, thumbnail, versionLabel, undefined, {
          force: true,
          importedMeshes: [baked],
          parentVersionId: parentId,
          operation: versionLabel === 'simplified' ? 'simplify' : 'enhance',
        });
        const tri = reduced.numTri.toLocaleString();
        return {
          ok: true,
          message: savedOriginal
            ? `Saved original + result (${tri} triangles).`
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
  initVoxelPaintUI(clipControls, {
    activate: async () => {
      const code = getValue();
      const err = voxelPaint.activate(code, {
        onMeshUpdate: (mesh) => { updateMesh(mesh, { skipAutoFrame: true }); },
        onLockChange: (locked) => { setReadOnlyReason('voxelPaint', locked); },
      }, currentParamValues);
      if (err) alert(`Voxel paint: ${err}`);
      syncVoxelPaintUI();
    },
    deactivate: async () => {
      voxelPaint.deactivate();
      runCode(getValue());
      syncVoxelPaintUI();
    },
    bake: async () => {
      const result = await bakePaintedVoxelsAsVersion('painted');
      if ('error' in result) alert(`Voxel paint: ${result.error}`);
      syncVoxelPaintUI();
    },
  });
  setVoxelPaintAvailable(getActiveLanguage() === 'voxel');

  // Single source of truth for "commit the painted voxel grid as a new
  // version" — called both from the UI Bake button and the partwright API.
  // Centralising avoids the bake-with-empty-grid / no-session bugs that two
  // separate implementations introduced.
  async function bakePaintedVoxelsAsVersion(label: string): Promise<{ versionIndex: number | null; voxelCount: number } | { error: string }> {
    if (!voxelPaint.isActive()) return { error: 'voxel paint is not active.' };
    const count = voxelPaint.voxelCount();
    if (count === 0) return { error: 'The painted grid is empty — paint or keep at least one voxel before baking.' };
    const code = voxelPaint.bakeToCode('painted');
    if (!code) return { error: 'voxel paint has no grid to bake.' };
    voxelPaint.deactivate();
    setValue(code);
    await runCodeSync(code);
    // Mirror the runAndSave auto-create pattern so callers don't have to wrap
    // bake with a manual createSession.
    if (!getState().session) {
      await createSession(label, getActiveLanguage());
    }
    const thumbnail = await captureThumbnail();
    const geometryData = enrichGeometryDataWithColors(getGeometryDataObj());
    const v = await saveVersion(code, geometryData, thumbnail, label);
    return { versionIndex: v?.index ?? null, voxelCount: count };
  }
  initSimplifyUI(clipControls, simplifyHandlers);
  initMeasureToggle(clipControls);
  initOrbitLockToggle(clipControls);

  // Relief / Edit colors toggle in the viewport overlay — paint/simplify are
  // alongside this button so the colour palette is discoverable from the
  // same place as the other model-editing tools (was previously in the top
  // toolbar where it kept getting clipped behind Show Code).
  const reliefViewportBtn = document.createElement('button');
  reliefViewportBtn.id = 'relief-viewport-toggle';
  reliefViewportBtn.className = 'px-2 py-1 rounded text-xs bg-zinc-800/80 backdrop-blur text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700/80 transition-colors border border-zinc-600/50';
  reliefViewportBtn.textContent = '✦ Relief';
  reliefViewportBtn.title = 'Edit colors / make a tile or relief from an image';
  reliefViewportBtn.addEventListener('click', () => toggleReliefStudio());
  const paintBtnEl = clipControls.querySelector('#paint-toggle');
  if (paintBtnEl) clipControls.insertBefore(reliefViewportBtn, paintBtnEl);
  else clipControls.appendChild(reliefViewportBtn);

  initEscapeMenuClose();

  // When a color region is painted, re-render the mesh with colors.
  setOnRegionPainted(() => {
    scheduleColorRefresh();
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
    scheduleColorRefresh();
  });

  editorReady = true;
  editorReadyResolve();

  // Start guided tour on first visit (after editor fully renders) — but not over
  // a shared preview, which is a read-only landing surface for an external link.
  if (!showLanding && !showHelpPage && !showCatalog && !showIdeas && !showLegalPage && !showWhatsNew && !show404 && !hasShareHash()) {
    maybeStartTour();
    maybeShowShortcutsHint();
    maybeShowLowMemoryNotice();
  }

  // A `#share=…` link opens the read-only preview INSTEAD of the normal editor
  // load. enterSharedFromHash must run before syncEditorFromURL so the latter
  // never createSession()s + runs default code on this path; it strips the hash
  // and degrades to a normal editable editor if the link is invalid. (The
  // editor is ready here; ensureEngineStarted is awaited inside each path.)
  if (!showLanding && !showHelpPage && !showCatalog && !showIdeas && !showLegalPage && !showWhatsNew && !show404) {
    if (hasShareHash()) {
      await enterSharedFromHash();
    } else {
      await syncEditorFromURL();
      syncReliefStudioForSession();
    }
  }

  // Keep this tab's session state in sync with peer tabs that mutate the same
  // session in another window, and coordinate single-writer leadership.
  initSessionTabSync();
  initSessionLeader();
  // Reflect single-writer ownership across the whole editor surface: the
  // non-owner tab becomes a read-only viewer (editor + paint + run + save
  // disabled, with a "Take over" banner).
  initViewerMode();

  // Track the active session id so BREP worker state (pending STEP imports +
  // the retained STEP-export shape) can be flushed when the session changes —
  // both live module-global in the worker and would otherwise bleed across
  // sessions (a second STEP-as-BREP import accumulating in `api.imports`, or
  // exportSTEP serializing a previous session's shape).
  let lastBrepSessionId: string | null = getState().session?.id ?? null;

  // Update document title when session state changes (create, open, close, rename)
  onStateChange((state) => {
    const sid = state.session?.id ?? null;
    if (sid !== lastBrepSessionId) {
      lastBrepSessionId = sid;
      void clearBrepImports().catch(() => {});
      void clearBrepShape().catch(() => {});
    }
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
        // Never auto-open the drawer when the app boots on the landing page —
        // the remembered open state only applies once the user is in the editor.
        suppressAutoOpen: shouldShowLanding(),
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
  if (!showLanding && !showHelpPage && !showCatalog && !showIdeas && !showLegalPage && !showWhatsNew && !show404) {
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

  // === Language switching helpers ===

  /** Low-level: swap the engine and the editor's display language, leaving
   *  the editor contents alone. Used by version navigation (where the new
   *  contents are provided by the caller) and as a primitive for the
   *  draft-swap path below. Does NOT touch session.language — that's still a
   *  "default for new sessions / fallback for pre-1.8 versions" hint and is
   *  only updated on session creation or by an explicit AI/console call. */
  async function applyEngineLanguage(lang: Language) {
    if (lang === getActiveLanguage()) return;
    // Leaving a replicad session: drop the retained STEP-export shape so a
    // later exportSTEP can't serialize a stale shape that belonged to the
    // previous BREP model (it's module-global in the worker and only replaced
    // by the next replicad run).
    if (getActiveLanguage() === 'replicad') void clearBrepShape().catch(() => {});
    setActiveLanguage(lang);
    setEditorLanguage(lang);
    setToolbarLanguage(lang);
    setVoxelPaintAvailable(lang === 'voxel');
    syncEditorTitle(getState());
    const loadingLabel =
      lang === 'scad' ? 'Loading OpenSCAD...' :
      lang === 'replicad' ? 'Loading BREP (OpenCASCADE)...' :
      'Switching...';
    setStatus(statusBar, 'running', loadingLabel);
    try {
      await ensureEngineReady(lang);
    } catch (e) {
      const msg = `Failed to load ${lang}: ${e instanceof Error ? e.message : String(e)}`;
      setStatus(statusBar, 'error', msg);
      errorLog.capture({ level: 'error', source: 'engine', message: msg });
      throw e;
    }
    setStatus(statusBar, 'ready', 'Ready');
  }

  const DRAFT_STUB_JS = '// JavaScript\nconst { Manifold } = api;\nreturn Manifold.cube([10, 10, 10], true);';
  const DRAFT_STUB_SCAD = '// OpenSCAD\ncube([10, 10, 10], center=true);';
  // Voxel — a small colored model so the first paint after switching shows
  // the workflow (fillBox / set with hex or [r,g,b] colors) immediately.
  const DRAFT_STUB_VOXEL =
    '// Voxel — build with colored cubes on an integer grid (1 voxel = 1 unit).\n' +
    'const { voxels } = api;\n' +
    'const v = voxels();\n' +
    "v.fillBox([-5, -5, 0], [4, 4, 0], '#6b8cff');   // a 10x10 base slab\n" +
    "v.fillBox([-1, -1, 1], [1, 1, 6], '#ff8c42');   // a tower\n" +
    "v.set(0, 0, 7, '#ff3b30');                       // a red cap\n" +
    '// Tip: return v.smooth() for rounded edges (see /ai/voxel.md).\n' +
    'return v;\n';
  // BREP / replicad — quick showcase of the headline features:
  //   - selective fillet (the inDirection-based workaround for box edges,
  //     called out in the gotchas cheat sheet at the top of replicad.md)
  //   - true chamfer on the top rim
  //   - boolean subtract (cut) of a cylinder bore
  // The result is a rounded-corner mounting bracket with a bevelled bore.
  // It's small enough that the OCCT solver runs in well under a second on
  // a cold WASM load, so the first paint into the editor after switching
  // languages still feels instant.
  const DRAFT_STUB_REPLICAD =
    '// BREP / replicad — exact-surface modeling\n' +
    "const { BREP } = api;\n" +
    '\n' +
    '// Body: 30x30x10 box with rounded vertical corners and a chamfered top rim.\n' +
    'const body = BREP.box([30, 30, 10])\n' +
    '  // Round the four vertical corners. `inDirection: [0,0,1]` requires the\n' +
    "  // edge be Z-parallel — needed because inBox alone is unreliable on a\n" +
    "  // BREP.box's planar coincident edges (see replicad.md \"Gotchas\").\n" +
    '  .fillet(3, { inDirection: [0, 0, 1] })\n' +
    '  // Bevel the top rim — the four edges of the top face. Same gotcha:\n' +
    "  // pair the maxZ bound with parallelToPlane: 'XY'.\n" +
    "  .chamfer(0.6, { maxZ: 9.999, parallelToPlane: 'XY' });\n" +
    '\n' +
    '// Boolean cut: a 4 mm bore through the centre.\n' +
    'const bore = BREP.cylinder(4, 12).translate([0, 0, -1]);\n' +
    'return body.cut(bore);\n';

  /** Toolbar / AI language toggle: stash the current editor buffer as a draft
   *  on the active session, swap engines, then restore the target language's
   *  draft (seeded with a stub if none has been stashed yet). Versions are not
   *  touched — they keep the language they were authored in. Auto-creates a
   *  session first when none is open, so a sessionless toggle (rare — usually
   *  there's an auto-created session on first edit) doesn't silently drop the
   *  current editor buffer with no place to stash it. */
  async function switchLanguageWithDrafts(lang: Language) {
    if (lang === getActiveLanguage()) return;
    const prevLang = getActiveLanguage();
    const currentCode = getValue();
    if (!getState().session) {
      // No session means no draft store to stash into. Mirror the auto-create
      // behavior used elsewhere in the editor so the user's in-progress code
      // doesn't vanish. The new session is tagged with the PREVIOUS language
      // (the one the current code is in) so its session-level fallback hint
      // stays meaningful for the buffer being stashed.
      await createSession(undefined, prevLang);
    }
    const sid = getState().session?.id;
    const pid = getState().currentPart?.id;
    if (sid) {
      // Persist the previous language's working buffer so flipping back
      // restores it exactly. Both languages stay live in IDB until the
      // part/session is deleted.
      await writeDraft(sid, prevLang, currentCode, pid);
    }
    await applyEngineLanguage(lang);
    let nextCode: string | null = null;
    if (sid) nextCode = await readDraft(sid, lang, pid);
    if (nextCode === null) {
      nextCode = lang === 'scad' ? DRAFT_STUB_SCAD
        : lang === 'replicad' ? DRAFT_STUB_REPLICAD
        : lang === 'voxel' ? DRAFT_STUB_VOXEL
        : DRAFT_STUB_JS;
    }
    setValue(nextCode);
    runCode(nextCode);
  }

  /** Pre-existing call sites that just need the engine swapped (version
   *  navigation, programmatic openSession, import flows). Kept as a small
   *  alias so the diff against the old name stays minimal. */
  async function switchLanguage(lang: Language) {
    await applyEngineLanguage(lang);
  }

  // === Execution state ===
  // (`_running` is declared at the top of main() so async callbacks fired
  // during initial load don't hit a Temporal Dead Zone error.)

  async function executeIsolated(code: string, lang?: Language) {
    // Hard refusal in a read-only shared preview. executeIsolated is the single
    // funnel for every isolated run — runIsolated / runAndAssert / runDecompose
    // (all AI-exposed tools), modify/test, and forkVersion — so guarding it here
    // stops the sharer's untrusted code from reaching the `new Function` sandbox
    // (and thus fetch / indexedDB) via any of them. Fork clears the flag before
    // importing, so the consented run is unaffected.
    if (isSharedPreview()) {
      return {
        geometryData: {
          status: 'error' as const,
          error: SHARED_PREVIEW_REFUSAL,
          diagnostics: [] as SourceDiagnostic[],
          executionTimeMs: 0,
          codeHash: simpleHash(code),
        },
        meshData: null as MeshData | null,
        manifold: null as unknown,
      };
    }
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

  // === Surface modifiers (fuzzy skin / smooth / voxelize) ===
  // Post-hoc operations on the current model that commit a new version, mirroring
  // the STL-import path (applyImportWrapper): bake the result onto an imported
  // mesh and emit a `Manifold.ofMesh(...)` wrapper (manifold modifiers), or emit a
  // self-contained `voxels.decode(...)` program (voxelize). Then switch to the
  // right engine, run, and save. Declared here as hoisted functions so the
  // partwrightAPI methods below can call them.
  function requireCurrentMeshForModifier(): MeshData {
    if (!currentMeshData || currentMeshData.numTri === 0) {
      throw new Error('No model to modify — run or open a model first.');
    }
    return currentMeshData;
  }

  /** The mesh a modifier should consume. When `preserveColor` is on and the
   *  model is painted, bake the visible colors into `triColors` so a modifier
   *  that resamples color (voxelize) inherits the paint; manifold modifiers
   *  ignore `triColors` (they re-resolve paint regions after the run instead). */
  function meshForModifier(preserveColor: boolean): MeshData {
    const mesh = requireCurrentMeshForModifier();
    if (preserveColor && (hasColorRegions() || hasModelColorRegions())) {
      return applyTriColors(mesh);
    }
    return mesh;
  }

  /** True if the active model carries any paint (manual or model-declared). */
  function modelHasColor(): boolean {
    return hasColorRegions() || hasModelColorRegions();
  }

  /** Pre-run validation warnings for texture operations. Checks amplitude and
   *  feature size relative to the model's bounding-box diagonal so the AI gets
   *  actionable feedback before spending time on a degenerate run. */
  function textureWarnings(
    id: 'fuzzy' | 'knit' | 'cable' | 'waffle' | 'fur' | 'woven',
    opts: Record<string, unknown>,
    mesh: MeshData,
  ): string[] {
    const diag = modelDiagonal(mesh) || 10;
    const amp = (opts.amplitude as number | undefined) ?? 0;
    const warnings: string[] = [];
    if (amp > diag * 0.15) {
      warnings.push(
        `amplitude (${amp.toFixed(3)}) exceeds 15% of the model diagonal (${diag.toFixed(2)}) — ` +
        `large displacements may produce manifold artifacts; consider amplitude ≤ ${(diag * 0.05).toFixed(3)}`,
      );
    }
    if (id === 'fuzzy') {
      const scale = (opts.scale as number | undefined) ?? 0;
      if (scale > diag * 0.5) {
        warnings.push(
          `scale (${scale.toFixed(3)}) is more than half the model size — ` +
          `only 1–2 noise features will be visible; try scale ≈ ${(diag * 0.04).toFixed(3)}`,
        );
      }
      if (scale > 0 && scale < diag / 300) {
        warnings.push(
          `scale (${scale.toFixed(4)}) is very small relative to the model — ` +
          `texture will be invisible; try scale ≈ ${(diag * 0.04).toFixed(3)}`,
        );
      }
    } else if (id === 'knit') {
      const sw = (opts.stitchWidth as number | undefined) ?? 0;
      const sh = (opts.stitchHeight as number | undefined) ?? sw * 1.4;
      if (sw > diag * 0.35) {
        warnings.push(
          `stitchWidth (${sw.toFixed(3)}) is large relative to the model diagonal (${diag.toFixed(2)}) — ` +
          `fewer than 3 stitches across; try stitchWidth ≈ ${(diag * 0.05).toFixed(3)}`,
        );
      }
      if (sh > diag * 0.35) {
        warnings.push(
          `stitchHeight (${sh.toFixed(3)}) is large relative to the model — ` +
          `fewer than 3 stitch rows visible; try stitchHeight ≈ ${(diag * 0.07).toFixed(3)}`,
        );
      }
      if (sw > 0 && sw < diag / 300) {
        warnings.push(
          `stitchWidth (${sw.toFixed(4)}) is very small — stitches will be invisible; ` +
          `try stitchWidth ≈ ${(diag * 0.05).toFixed(3)}`,
        );
      }
    } else if (id === 'cable') {
      const cw = (opts.cableWidth as number | undefined) ?? 0;
      if (cw > diag * 0.4) {
        warnings.push(
          `cableWidth (${cw.toFixed(3)}) is large relative to the model diagonal (${diag.toFixed(2)}) — ` +
          `fewer than 3 cables visible; try cableWidth ≈ ${(diag * 0.08).toFixed(3)}`,
        );
      }
      if (cw > 0 && cw < diag / 300) {
        warnings.push(
          `cableWidth (${cw.toFixed(4)}) is very small — cables will be invisible; ` +
          `try cableWidth ≈ ${(diag * 0.08).toFixed(3)}`,
        );
      }
    } else if (id === 'waffle') {
      const cw = (opts.cellWidth as number | undefined) ?? 0;
      if (cw > diag * 0.4) {
        warnings.push(
          `cellWidth (${cw.toFixed(3)}) is large relative to the model diagonal (${diag.toFixed(2)}) — ` +
          `fewer than 3 cells visible; try cellWidth ≈ ${(diag * 0.06).toFixed(3)}`,
        );
      }
      if (cw > 0 && cw < diag / 300) {
        warnings.push(
          `cellWidth (${cw.toFixed(4)}) is very small — waffle grid will be invisible; ` +
          `try cellWidth ≈ ${(diag * 0.06).toFixed(3)}`,
        );
      }
    } else if (id === 'fur') {
      const fs = (opts.fiberSpacing as number | undefined) ?? 0;
      if (fs > diag * 0.3) {
        warnings.push(
          `fiberSpacing (${fs.toFixed(3)}) is large relative to the model diagonal (${diag.toFixed(2)}) — ` +
          `very few fibers visible; try fiberSpacing ≈ ${(diag * 0.02).toFixed(3)}`,
        );
      }
      if (fs > 0 && fs < diag / 600) {
        warnings.push(
          `fiberSpacing (${fs.toFixed(4)}) is very small — fur texture will be very fine; ` +
          `try fiberSpacing ≈ ${(diag * 0.02).toFixed(3)}`,
        );
      }
    } else if (id === 'woven') {
      const ts = (opts.threadSpacing as number | undefined) ?? 0;
      if (ts > diag * 0.35) {
        warnings.push(
          `threadSpacing (${ts.toFixed(3)}) is large relative to the model diagonal (${diag.toFixed(2)}) — ` +
          `fewer than 3 thread rows; try threadSpacing ≈ ${(diag * 0.04).toFixed(3)}`,
        );
      }
      if (ts > 0 && ts < diag / 400) {
        warnings.push(
          `threadSpacing (${ts.toFixed(4)}) is very small — weave will be invisible; ` +
          `try threadSpacing ≈ ${(diag * 0.04).toFixed(3)}`,
        );
      }
    }
    return warnings;
  }

  // Non-destructive preview: swap the viewport mesh to the modifier's result
  // WITHOUT running the engine or saving a version. Cleared by reverting to the
  // current model's mesh (clearSurfacePreview). Mirrors the relief preview path.
  // Colors are carried through subdivision in buildSurfaceModifier, so result.mesh
  // already has the correct per-triangle colors — no post-hoc transfer needed.
  function previewSurfaceModifier(result: ModifierResult, _preserveColor: boolean): void {
    const previewMesh = result.kind === 'manifold' ? result.mesh : result.previewMesh;
    if (previewMesh.numTri === 0) return;
    updateMesh(previewMesh, { skipAutoFrame: true });
  }

  function clearSurfacePreview(): void {
    if (!currentMeshData) return;
    const restored = modelHasColor() ? applyTriColorsIfVisible(currentMeshData) : currentMeshData;
    updateMesh(restored, { skipAutoFrame: true });
  }

  // Carry paint from the pre-modifier mesh onto a re-tessellated manifold result
  // by nearest-triangle transfer. Region descriptors (coplanar/slab/…) re-resolve
  // by geometry and collapse to nothing once fuzzy/smooth perturb the surface, so
  // we instead snapshot the composited colors (paint + model colors, via
  // buildTriColors) and map them onto the new mesh by centroid proximity, grouped
  // into one `{ kind: 'triangles' }` region per distinct color. Those persist
  // because the import→ofMesh pipeline is deterministic — the raw triangle ids
  // stay valid across reloads. Returns the regions to rehydrate, or [] if nothing
  // was painted. `transferredTris` reports coverage for the UI.
  function buildCarriedColorRegions(
    oldMesh: MeshData,
    oldColors: Uint8Array,
    newMesh: MeshData,
  ): { regions: SerializedColorRegion[]; transferredTris: number } {
    const painted = (oldColors as Uint8Array & { _painted?: Uint8Array })._painted;
    const nearest = nearestTriangleMap(oldMesh, newMesh);
    const groups = new Map<number, number[]>(); // packed rgb → new triangle ids
    let transferredTris = 0;
    for (let t = 0; t < newMesh.numTri; t++) {
      const o = nearest[t];
      if (o < 0) continue;
      if (painted && !painted[o]) continue; // skip triangles that weren't painted
      const r = oldColors[o * 3], g = oldColors[o * 3 + 1], b = oldColors[o * 3 + 2];
      const rgb = (r << 16) | (g << 8) | b;
      let arr = groups.get(rgb);
      if (!arr) { arr = []; groups.set(rgb, arr); }
      arr.push(t);
      transferredTris++;
    }
    const regions: SerializedColorRegion[] = [];
    let i = 0;
    for (const [rgb, ids] of groups) {
      regions.push({
        name: `Surface color ${++i}`,
        // ColorRegion.color is RGB in 0..1 (buildTriColors multiplies by 255);
        // the packed rgb here is 0..255 bytes, so normalize each channel.
        color: [((rgb >> 16) & 0xff) / 255, ((rgb >> 8) & 0xff) / 255, (rgb & 0xff) / 255],
        source: 'face-pick',
        descriptor: { kind: 'triangles', ids },
        visible: true,
      } as SerializedColorRegion);
    }
    return { regions, transferredTris };
  }

  async function commitSurfaceModifier(result: ModifierResult, preserveColor: boolean): Promise<Record<string, unknown>> {
    // For manifold results the modifier already baked colors into its input and
    // carried them through subdivision — result.mesh.triColors has the correct
    // per-triangle paint (dense mesh, same shape as the engine output). We use
    // that as the color source rather than the pre-modifier coarse mesh, which
    // avoids the coarse→dense centroid-mapping errors that cause wrong colors.
    const colorMesh = (preserveColor && result.kind === 'manifold' && result.mesh.triColors != null)
      ? result.mesh : null;
    cancelVoxelPaintIfActive();
    dropPaintState();
    if (result.kind === 'manifold') {
      if (getActiveLanguage() !== 'manifold-js') await switchLanguage('manifold-js');
      const comp: ImportedMesh = {
        id: crypto.randomUUID(),
        filename: result.label,
        format: 'stl',
        vertProperties: result.mesh.vertProperties,
        triVerts: result.mesh.triVerts,
        numVert: result.mesh.numVert,
        numTri: result.mesh.numTri,
        numProp: 3,
      };
      setActiveImports([comp]);
      setValue(result.code);
      const ok = await runCodeSync(result.code);
      if (!ok) return { error: `Failed to apply ${result.label}` };
      let geoData = getGeometryDataObj();
      let carried = 0;
      if (colorMesh && currentMeshData && geoData) {
        const { regions, transferredTris } = buildCarriedColorRegions(colorMesh, colorMesh.triColors!, currentMeshData);
        if (regions.length > 0) {
          rehydrateColorRegions({ ...geoData, colorRegions: regions });
          carried = transferredTris;
          geoData = enrichGeometryDataWithColors(getGeometryDataObj());
        }
      }
      const thumbnail = await captureThumbnail();
      await saveVersion(result.code, geoData, thumbnail, result.label, undefined, {
        force: true,
        importedMeshes: [comp],
      });
      const colorWarnings: string[] = [];
      if (preserveColor && colorMesh && currentMeshData && carried > 0) {
        const coverage = carried / currentMeshData.numTri;
        if (coverage < 0.7) {
          colorWarnings.push(
            `Color transfer covered ${(coverage * 100).toFixed(0)}% of new triangles — ` +
            `some areas may appear unpainted; use copyColorsFromVersion or repaint those regions`,
          );
        }
      }
      return {
        ok: true,
        label: result.label,
        geometry: getGeometryDataObj(),
        colorsCarried: carried,
        ...(colorWarnings.length > 0 ? { warnings: colorWarnings } : {}),
      };
    }
    // Voxel result: a self-contained `voxels.decode(...)` program, no imports.
    // Color (when preserved) is baked into the grid at voxelize time, so it
    // rides the emitted code — nothing extra to persist here.
    if (getActiveLanguage() !== 'voxel') await switchLanguage('voxel');
    setActiveImports([]);
    setValue(result.code);
    const ok = await runCodeSync(result.code);
    if (!ok) return { error: `Failed to apply ${result.label}` };
    const thumbnail = await captureThumbnail();
    await saveVersion(result.code, getGeometryDataObj(), thumbnail, result.label, undefined, { force: true });
    return { ok: true, label: result.label, geometry: getGeometryDataObj() };
  }

  // Build a modifier result from an id + options (shared by apply and preview).
  // All three modifiers receive the color-baked mesh when preserveColor is on:
  // fuzzy/smooth carry triColors (with _painted) through subdivision so the
  // result already has correct per-triangle paint — no post-hoc transfer needed.
  function buildSurfaceModifier(
    id: 'fuzzy' | 'knit' | 'cable' | 'waffle' | 'fur' | 'woven' | 'smooth' | 'voxelize',
    opts: Record<string, unknown> | undefined,
    preserveColor: boolean,
  ): ModifierResult {
    if (id === 'fuzzy') {
      const mesh = meshForModifier(preserveColor);
      const base = defaultFuzzyOptions(mesh);
      return applyFuzzy(mesh, {
        amplitude: (opts?.amplitude as number) ?? base.amplitude,
        scale: (opts?.scale as number) ?? base.scale,
        octaves: (opts?.octaves as number) ?? base.octaves,
        seed: (opts?.seed as number) ?? base.seed,
      });
    }
    if (id === 'knit') {
      const mesh = meshForModifier(preserveColor);
      const base = defaultKnitOptions(mesh);
      return applyKnit(mesh, {
        amplitude: (opts?.amplitude as number) ?? base.amplitude,
        stitchWidth: (opts?.stitchWidth as number) ?? base.stitchWidth,
        stitchHeight: (opts?.stitchHeight as number) ?? base.stitchHeight,
        rowOffset: (opts?.rowOffset as number) ?? base.rowOffset,
        roundness: (opts?.roundness as number) ?? base.roundness,
        grainAngleDeg: (opts?.grainAngleDeg as number) ?? base.grainAngleDeg,
        variation: (opts?.variation as number) ?? base.variation,
        seed: (opts?.seed as number) ?? base.seed,
      });
    }
    if (id === 'cable') {
      const mesh = meshForModifier(preserveColor);
      const base = defaultCableOptions(mesh);
      return applyCable(mesh, {
        amplitude: (opts?.amplitude as number) ?? base.amplitude,
        cableWidth: (opts?.cableWidth as number) ?? base.cableWidth,
        cablePitch: (opts?.cablePitch as number) ?? base.cablePitch,
        plyWidth: (opts?.plyWidth as number) ?? base.plyWidth,
        grainAngleDeg: (opts?.grainAngleDeg as number) ?? base.grainAngleDeg,
        variation: (opts?.variation as number) ?? base.variation,
        seed: (opts?.seed as number) ?? base.seed,
      });
    }
    if (id === 'waffle') {
      const mesh = meshForModifier(preserveColor);
      const base = defaultWaffleOptions(mesh);
      return applyWaffle(mesh, {
        amplitude: (opts?.amplitude as number) ?? base.amplitude,
        cellWidth: (opts?.cellWidth as number) ?? base.cellWidth,
        cellHeight: (opts?.cellHeight as number) ?? base.cellHeight,
        sharpness: (opts?.sharpness as number) ?? base.sharpness,
        rowOffset: (opts?.rowOffset as number) ?? base.rowOffset,
        grainAngleDeg: (opts?.grainAngleDeg as number) ?? base.grainAngleDeg,
      });
    }
    if (id === 'fur') {
      const mesh = meshForModifier(preserveColor);
      const base = defaultFurOptions(mesh);
      return applyFur(mesh, {
        amplitude: (opts?.amplitude as number) ?? base.amplitude,
        fiberSpacing: (opts?.fiberSpacing as number) ?? base.fiberSpacing,
        fiberLength: (opts?.fiberLength as number) ?? base.fiberLength,
        octaves: (opts?.octaves as number) ?? base.octaves,
        grainAngleDeg: (opts?.grainAngleDeg as number) ?? base.grainAngleDeg,
        seed: (opts?.seed as number) ?? base.seed,
      });
    }
    if (id === 'woven') {
      const mesh = meshForModifier(preserveColor);
      const base = defaultWovenOptions(mesh);
      return applyWoven(mesh, {
        amplitude: (opts?.amplitude as number) ?? base.amplitude,
        threadSpacing: (opts?.threadSpacing as number) ?? base.threadSpacing,
        threadWidth: (opts?.threadWidth as number) ?? base.threadWidth,
        underDepth: (opts?.underDepth as number) ?? base.underDepth,
        grainAngleDeg: (opts?.grainAngleDeg as number) ?? base.grainAngleDeg,
        seed: (opts?.seed as number) ?? base.seed,
      });
    }
    if (id === 'smooth') {
      const mesh = meshForModifier(preserveColor);
      const base = defaultSmoothOptions();
      return applySmooth(mesh, {
        iterations: (opts?.iterations as number) ?? base.iterations,
        subdivide: (opts?.subdivide as boolean) ?? base.subdivide,
      });
    }
    // voxelize: feed the color-baked mesh when preserving so per-voxel color is sampled.
    return applyVoxelize(meshForModifier(preserveColor), {
      resolution: (opts?.resolution as number) ?? 32,
      smooth: (opts?.smooth as boolean) ?? false,
    });
  }

  // === Expose window.partwright console API ===
  const partwrightAPI = {
    /** Whether the current model carries paint (so the UI can warn before a
     *  color-clearing modifier, or offer "preserve colors"). */
    modelHasColor(): boolean { return modelHasColor(); },
    /** Non-destructive viewport preview of a surface modifier (no version saved).
     *  Call clearSurfacePreview() / re-run to restore. id: 'fuzzy'|'knit'|'smooth'|'voxelize'. */
    previewSurfaceModifier(id: 'fuzzy' | 'knit' | 'cable' | 'waffle' | 'fur' | 'woven' | 'smooth' | 'voxelize', opts?: Record<string, unknown>, preserveColor = true): { ok: true } | { error: string } {
      try {
        previewSurfaceModifier(buildSurfaceModifier(id, opts, preserveColor), preserveColor);
        return { ok: true };
      } catch (e) { return { error: e instanceof Error ? e.message : String(e) }; }
    },
    /** Discard a live surface preview and restore the current model's mesh. */
    clearSurfacePreview(): { ok: true } { clearSurfacePreview(); return { ok: true }; },
    /** Apply a fuzzy-skin surface texture to the current model; saves a new version.
     *  `preserveColor` (default true) re-resolves paint regions onto the new mesh.
     *  Returns `{ ok, label, geometry, colorsCarried, warnings? }`. */
    async applyFuzzySkin(opts?: { amplitude?: number; scale?: number; octaves?: number; seed?: number; quality?: number; preserveColor?: boolean }) {
      try {
        const preserve = opts?.preserveColor ?? true;
        const mesh = requireCurrentMeshForModifier();
        const warns = textureWarnings('fuzzy', opts ?? {}, mesh);
        const result = await commitSurfaceModifier(buildSurfaceModifier('fuzzy', opts, preserve), preserve);
        if (warns.length > 0 && result && typeof result === 'object' && 'ok' in result) {
          const existing = (result as Record<string, unknown>).warnings as string[] | undefined;
          return { ...result, warnings: [...warns, ...(existing ?? [])] };
        }
        return result;
      } catch (e) { return { error: e instanceof Error ? e.message : String(e) }; }
    },

    /** Apply a knit-stitch surface texture to the current model; saves a new version.
     *  Produces a stockinette V-pattern of interlocking stitch bumps arranged in a
     *  brick-offset grid. `preserveColor` (default true) carries paint across subdivision.
     *  Returns `{ ok, label, geometry, colorsCarried, warnings? }`. */
    async applyKnitTexture(opts?: {
      amplitude?: number;
      stitchWidth?: number;
      stitchHeight?: number;
      rowOffset?: number;
      roundness?: number;
      grainAngleDeg?: number;
      variation?: number;
      seed?: number;
      quality?: number;
      preserveColor?: boolean;
    }) {
      try {
        const preserve = opts?.preserveColor ?? true;
        const mesh = requireCurrentMeshForModifier();
        const warns = textureWarnings('knit', opts ?? {}, mesh);
        const result = await commitSurfaceModifier(buildSurfaceModifier('knit', opts, preserve), preserve);
        if (warns.length > 0 && result && typeof result === 'object' && 'ok' in result) {
          const existing = (result as Record<string, unknown>).warnings as string[] | undefined;
          return { ...result, warnings: [...warns, ...(existing ?? [])] };
        }
        return result;
      } catch (e) { return { error: e instanceof Error ? e.message : String(e) }; }
    },

    /** Apply a cable-knit surface texture to the current model; saves a new version.
     *  Produces intertwining rope-like cable columns with crossing ply ridges.
     *  `preserveColor` (default true) carries paint across subdivision.
     *  Returns `{ ok, label, geometry, colorsCarried, warnings? }`. */
    async applyCableKnit(opts?: {
      amplitude?: number;
      cableWidth?: number;
      cablePitch?: number;
      plyWidth?: number;
      grainAngleDeg?: number;
      variation?: number;
      seed?: number;
      quality?: number;
      preserveColor?: boolean;
    }) {
      try {
        const preserve = opts?.preserveColor ?? true;
        const mesh = requireCurrentMeshForModifier();
        const warns = textureWarnings('cable', opts ?? {}, mesh);
        const result = await commitSurfaceModifier(buildSurfaceModifier('cable', opts, preserve), preserve);
        if (warns.length > 0 && result && typeof result === 'object' && 'ok' in result) {
          const existing = (result as Record<string, unknown>).warnings as string[] | undefined;
          return { ...result, warnings: [...warns, ...(existing ?? [])] };
        }
        return result;
      } catch (e) { return { error: e instanceof Error ? e.message : String(e) }; }
    },

    /** Apply a waffle-stitch surface texture to the current model; saves a new version.
     *  Produces a regular grid of recessed cells with raised border ridges.
     *  Set rowOffset=0.5 for a honeycomb variant. `preserveColor` (default true) carries paint.
     *  Returns `{ ok, label, geometry, colorsCarried, warnings? }`. */
    async applyWaffleStitch(opts?: {
      amplitude?: number;
      cellWidth?: number;
      cellHeight?: number;
      sharpness?: number;
      rowOffset?: number;
      grainAngleDeg?: number;
      seed?: number;
      quality?: number;
      preserveColor?: boolean;
    }) {
      try {
        const preserve = opts?.preserveColor ?? true;
        const mesh = requireCurrentMeshForModifier();
        const warns = textureWarnings('waffle', opts ?? {}, mesh);
        const result = await commitSurfaceModifier(buildSurfaceModifier('waffle', opts, preserve), preserve);
        if (warns.length > 0 && result && typeof result === 'object' && 'ok' in result) {
          const existing = (result as Record<string, unknown>).warnings as string[] | undefined;
          return { ...result, warnings: [...warns, ...(existing ?? [])] };
        }
        return result;
      } catch (e) { return { error: e instanceof Error ? e.message : String(e) }; }
    },

    /** Apply a fur/velvet surface texture to the current model; saves a new version.
     *  Produces directional pile (velvet, short fur, chenille) using anisotropic FBM noise.
     *  `preserveColor` (default true) carries paint across subdivision.
     *  Returns `{ ok, label, geometry, colorsCarried, warnings? }`. */
    async applyFurVelvet(opts?: {
      amplitude?: number;
      fiberSpacing?: number;
      fiberLength?: number;
      octaves?: number;
      grainAngleDeg?: number;
      seed?: number;
      quality?: number;
      preserveColor?: boolean;
    }) {
      try {
        const preserve = opts?.preserveColor ?? true;
        const mesh = requireCurrentMeshForModifier();
        const warns = textureWarnings('fur', opts ?? {}, mesh);
        const result = await commitSurfaceModifier(buildSurfaceModifier('fur', opts, preserve), preserve);
        if (warns.length > 0 && result && typeof result === 'object' && 'ok' in result) {
          const existing = (result as Record<string, unknown>).warnings as string[] | undefined;
          return { ...result, warnings: [...warns, ...(existing ?? [])] };
        }
        return result;
      } catch (e) { return { error: e instanceof Error ? e.message : String(e) }; }
    },

    /** Apply a woven-fabric surface texture to the current model; saves a new version.
     *  Simulates plain-weave interlacing: warp and weft threads alternate over/under.
     *  `preserveColor` (default true) carries paint across subdivision.
     *  Returns `{ ok, label, geometry, colorsCarried, warnings? }`. */
    async applyWovenFabric(opts?: {
      amplitude?: number;
      threadSpacing?: number;
      threadWidth?: number;
      underDepth?: number;
      grainAngleDeg?: number;
      seed?: number;
      quality?: number;
      preserveColor?: boolean;
    }) {
      try {
        const preserve = opts?.preserveColor ?? true;
        const mesh = requireCurrentMeshForModifier();
        const warns = textureWarnings('woven', opts ?? {}, mesh);
        const result = await commitSurfaceModifier(buildSurfaceModifier('woven', opts, preserve), preserve);
        if (warns.length > 0 && result && typeof result === 'object' && 'ok' in result) {
          const existing = (result as Record<string, unknown>).warnings as string[] | undefined;
          return { ...result, warnings: [...warns, ...(existing ?? [])] };
        }
        return result;
      } catch (e) { return { error: e instanceof Error ? e.message : String(e) }; }
    },

    /** Smooth/round the current model (Taubin λ/μ); saves a new version. */
    async smoothModel(opts?: { iterations?: number; subdivide?: boolean; preserveColor?: boolean }) {
      try {
        const preserve = opts?.preserveColor ?? true;
        return await commitSurfaceModifier(buildSurfaceModifier('smooth', opts, preserve), preserve);
      } catch (e) { return { error: e instanceof Error ? e.message : String(e) }; }
    },
    /** Voxelize the current model into the voxel engine; saves a new version. */
    async voxelizeModel(opts?: { resolution?: number; smooth?: boolean; preserveColor?: boolean }) {
      try {
        const preserve = opts?.preserveColor ?? true;
        return await commitSurfaceModifier(buildSurfaceModifier('voxelize', opts, preserve), preserve);
      } catch (e) { return { error: e instanceof Error ? e.message : String(e) }; }
    },
    /** Non-destructive viewport preview of a scale operation (no version saved). */
    previewScale(sx: number, sy: number, sz: number, opts?: { preserveColor?: boolean }): { ok: true } | { error: string } {
      try {
        if (!currentMeshData) return { error: 'No model loaded' };
        const preserve = opts?.preserveColor ?? false;
        const result = applyScale(meshForModifier(preserve), sx, sy, sz);
        previewSurfaceModifier(result, preserve);
        return { ok: true };
      } catch (e) { return { error: e instanceof Error ? e.message : String(e) }; }
    },
    /** Discard a live scale preview and restore the current model's mesh. */
    clearScalePreview(): { ok: true } { clearSurfacePreview(); return { ok: true }; },
    /** Scale the current model and save as a new version.
     *  sx/sy/sz are multiplicative factors (1 = no change, 2 = double, 0.5 = half).
     *  `preserveColor` (default true) re-resolves paint regions onto the scaled mesh. */
    async scaleModel(sx: number, sy: number, sz: number, opts?: { preserveColor?: boolean }) {
      try {
        if (!currentMeshData) return { error: 'No model loaded' };
        const preserve = opts?.preserveColor ?? true;
        return await commitSurfaceModifier(applyScale(meshForModifier(preserve), sx, sy, sz), preserve);
      } catch (e) { return { error: e instanceof Error ? e.message : String(e) }; }
    },
    /** Run code string and update all views. Returns geometry data object. */
    async run(code?: string): Promise<Record<string, unknown>> {
      assertString(code, 'run(code)', { optional: true, allowEmpty: false });
      const src = code ?? getValue();
      if (code !== undefined) setValue(code);
      const applied = await runCodeSync(src);
      if (!applied) {
        return { status: 'error', error: 'Run was superseded by a concurrent execution — retry' };
      }
      const geo = JSON.parse(geometryDataEl.textContent || '{}');
      return { ...geo, printability: computePrintability(geo) };
    },

    /** Get current geometry stats without re-running */
    getGeometryData(): Record<string, unknown> {
      const geo = JSON.parse(geometryDataEl.textContent || '{}') as Record<string, unknown>;
      const warnings = geometryWarnings(geo);
      // Flag stale results: setCode() doesn't re-run, so the cached geometry may
      // reflect a previous version of the code. Callers should run or runAndSave
      // before relying on component counts or other stats.
      const stale = typeof geo.codeHash === 'string' && simpleHash(getValue()) !== geo.codeHash;
      return {
        ...geo,
        printability: computePrintability(geo),
        ...(stale ? { stale: true } : {}),
        ...(warnings.length > 0 ? { warnings } : {}),
      };
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

    /** Read the Customizer parameter schema the current model declared (via
     *  `api.params({...})`) plus the resolved current value of each. Returns
     *  `{ schema: [], values: {} }` when the model declares no parameters. Use
     *  this to discover which knobs exist (and their ranges) before tweaking. */
    getParams(): { schema: ParamSpec[]; values: Record<string, ParamValue> } {
      if (!currentParamSchema) return { schema: [], values: {} };
      return { schema: currentParamSchema, values: resolveParamValues(currentParamSchema, currentParamValues) };
    },

    /** Set one or more Customizer parameter overrides and re-run the model —
     *  the language-based equivalent of dragging the panel's sliders. Unknown
     *  keys are ignored and out-of-range / wrong-type values are clamped or
     *  fall back to the declared default (never throws on a bad value). Returns
     *  the updated geometry data plus the resolved parameter values, or
     *  `{ error }` if the model declares no parameters. */
    async setParams(values: Record<string, unknown>) {
      const check = guard(() => { assertObject(values, 'setParams(values)'); return true; });
      if (typeof check === 'object' && check !== null && 'error' in check) return check;
      if (!currentParamSchema) {
        return { error: 'The current model declares no parameters. Add an api.params({...}) call to the model code (and run it) first.' };
      }
      currentParamValues = { ...currentParamValues, ...(values as Record<string, ParamValue>) };
      const applied = await runCodeSync(getValue());
      if (!applied) return { status: 'error', error: 'Run was superseded by a concurrent execution — retry' };
      const geometry = JSON.parse(geometryDataEl.textContent || '{}');
      return {
        geometry,
        params: currentParamSchema ? resolveParamValues(currentParamSchema, currentParamValues) : {},
      };
    },

    /** Slice current manifold at Z height. Returns cross-section data. */
    sliceAtZ(z: number) {
      const check = guard(() => assertNumber(z, 'sliceAtZ(z)'));
      if (typeof check === 'object' && check !== null && 'error' in check) return check;
      if (!currentManifold) return { error: 'No geometry loaded' };
      const result = sliceAtZ(currentManifold, z);
      // sliceAtZ now returns a reference into a per-(manifold,z) memo cache.
      // Hand external (console/AI) callers a copy so mutating the result can't
      // corrupt the cache; in-app callers keep the fast shared reference.
      return result ? structuredClone(result) : result;
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
      if (!currentMeshData) return { error: 'No geometry loaded' };
      assertFiniteMesh(currentMeshData);
      await exportGLB(filename, coloredMeshForExport(currentMeshData));
    },

    /** Export current model as STL download. Optional filename override. */
    exportSTL(filename?: string) {
      assertString(filename, 'exportSTL(filename)', { optional: true });
      if (!currentMeshData) return { error: 'No geometry loaded' };
      exportSTL(currentMeshData, filename);
    },

    /** Export current model as OBJ download. Optional filename override. */
    exportOBJ(filename?: string) {
      assertString(filename, 'exportOBJ(filename)', { optional: true });
      if (!currentMeshData) return { error: 'No geometry loaded' };
      exportOBJ(coloredMeshForExport(currentMeshData), filename);
    },

    /** Export current model as 3MF download. Optional filename override. */
    export3MF(filename?: string) {
      assertString(filename, 'export3MF(filename)', { optional: true });
      if (!currentMeshData) return { error: 'No geometry loaded' };
      export3MF(coloredMeshForExport(currentMeshData), filename);
    },

    /** Export the current voxel grid as a MagicaVoxel `.vox` download. Voxel
     *  sessions only (the integer grid is re-derived from the current code, or
     *  the live painted grid when paint is active). Returns
     *  `{ ok, filename }` or `{ error }` (no grid, or a model larger than the
     *  format's 256-per-axis limit). */
    exportVOX(filename?: string) {
      assertString(filename, 'exportVOX(filename)', { optional: true });
      const grid = getCurrentVoxelGrid();
      if (!grid) return { error: 'No voxel grid — switch to the Voxel language (setActiveLanguage("voxel")) and run a model first.' };
      try { return { ok: true as const, filename: exportVOX(grid, filename) }; }
      catch (e) { return { error: e instanceof Error ? e.message : String(e) }; }
    },

    /** Export the most-recent BREP shape as a STEP file. Only meaningful in
     *  replicad-language sessions — BREP shapes built ad-hoc inside a
     *  manifold-js session (via api.BREP.*) are not retained past the
     *  toManifold() conversion, so this won't pick them up. Returns
     *  `{ ok: true, filename, sizeBytes }` on success, or
     *  `{ ok: false, error }` when no BREP shape is available. */
    async exportSTEP(filename?: string) {
      assertString(filename, 'exportSTEP(filename)', { optional: true });
      try {
        // The retained shape is cleared on session/language change; guard the
        // active language too so a stale shape can never be served outside a
        // replicad session.
        if (getActiveLanguage() !== 'replicad') {
          return { ok: false as const, error: 'No BREP shape available. STEP export requires BREP mode — switch with setActiveLanguage("replicad") and run a model first.' };
        }
        const blob = await exportLastBrepAsSTEP();
        if (!blob) {
          return { ok: false as const, error: 'No BREP shape available. Switch to BREP language (setActiveLanguage("replicad")) and run a model first.' };
        }
        // Route through the shared download helper so STEP gets the standard
        // filename convention, unified revoke, and a Recent Exports entry like
        // every other format.
        const name = getExportFilename('step', filename);
        downloadBlob(blob, name, 'STEP');
        return { ok: true as const, filename: name, sizeBytes: blob.size };
      } catch (e) {
        return { ok: false as const, error: e instanceof Error ? e.message : String(e) };
      }
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
      const mesh = (hasColorRegions() || hasModelColorRegions()) ? applyTriColors(currentMeshData) : currentMeshData;
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
      const mesh = (hasColorRegions() || hasModelColorRegions()) ? applyTriColors(currentMeshData) : currentMeshData;
      const built = build3MF(mesh, filename);
      registerExportFromBuilt(built, '3MF');
      return {
        filename: built.filename,
        mimeType: built.mimeType,
        sizeBytes: built.blob.size,
        base64: await blobToBase64(built.blob),
      };
    },

    /** Build a MagicaVoxel `.vox` and return its bytes as base64. Voxel sessions
     *  only. Returns `{ error }` with no grid, or when the model exceeds the
     *  format's 256-per-axis limit. */
    async exportVOXData(filename?: string) {
      assertString(filename, 'exportVOXData(filename)', { optional: true });
      const grid = getCurrentVoxelGrid();
      if (!grid) return { error: 'No voxel grid — switch to the Voxel language (setActiveLanguage("voxel")) and run a model first.' };
      let built;
      try { built = buildVOX(grid, filename); }
      catch (e) { return { error: e instanceof Error ? e.message : String(e) }; }
      registerExportFromBuilt(built, 'VOX');
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
        assertEnum(language, ['manifold-js', 'scad', 'replicad', 'voxel'], 'importCodeData(language)');
        assertString(sessionName, 'importCodeData(sessionName)', { optional: true, allowEmpty: false });
      });
      if (typeof check === 'object' && check !== null && 'error' in check) return check;
      const result = await importCodePayload(code, language, sessionName);
      return { sessionId: result.sessionId };
    },

    /** Import an image (a `data:` URL or a same-origin URL) as a colored voxel
     *  model in a new voxel session — the programmatic equivalent of the
     *  Import → image file flow. `mode: 'billboard'` (default) extrudes every
     *  surviving pixel to a uniform `depth`; `mode: 'heightmap'` drives a
     *  per-column height from pixel brightness (with an optional `baseThickness`
     *  backing, and `invert` to raise dark areas). `colorMode` keeps the
     *  original color, converts to `grayscale`, or paints a single `flatColor`.
     *  Transparent pixels below `alphaThreshold` drop out. `palette` (an array
     *  of `[r,g,b]` triples) snaps each `original`-mode pixel to its nearest
     *  entry (overrides `posterizeColors`); `codeStyle: 'calls'` emits editable
     *  `v.fillBox(...)` builder code instead of the compact `voxels.decode(...)`
     *  blob. Returns `{ sessionId, voxelCount }` or `{ error }`. */
    async importImageAsVoxels(imageUrl: string, opts: ImageToVoxelOptions = {}) {
      const check = guard(() => {
        assertString(imageUrl, 'importImageAsVoxels(imageUrl)', { allowEmpty: false });
        assertObject(opts, 'importImageAsVoxels(opts)', { optional: true });
        if (opts.maxSize !== undefined) assertNumber(opts.maxSize, 'importImageAsVoxels(opts.maxSize)', { min: 1, integer: true });
        if (opts.mode !== undefined) assertEnum(opts.mode, ['billboard', 'heightmap'], 'importImageAsVoxels(opts.mode)');
        if (opts.depth !== undefined) assertNumber(opts.depth, 'importImageAsVoxels(opts.depth)', { min: 1, integer: true });
        if (opts.maxHeight !== undefined) assertNumber(opts.maxHeight, 'importImageAsVoxels(opts.maxHeight)', { min: 1, integer: true });
        if (opts.baseThickness !== undefined) assertNumber(opts.baseThickness, 'importImageAsVoxels(opts.baseThickness)', { min: 0, integer: true });
        if (opts.invert !== undefined) assertBoolean(opts.invert, 'importImageAsVoxels(opts.invert)');
        if (opts.alphaThreshold !== undefined) assertNumber(opts.alphaThreshold, 'importImageAsVoxels(opts.alphaThreshold)', { min: 0, max: 255, integer: true });
        if (opts.colorMode !== undefined) assertEnum(opts.colorMode, ['original', 'grayscale', 'flat'], 'importImageAsVoxels(opts.colorMode)');
        if (opts.flatColor !== undefined) {
          const c = assertNumberTuple(opts.flatColor, 3, 'importImageAsVoxels(opts.flatColor)');
          c.forEach((n, i) => assertNumber(n, `importImageAsVoxels(opts.flatColor[${i}])`, { min: 0, max: 255, integer: true }));
        }
        if (opts.gamma !== undefined) assertNumber(opts.gamma, 'importImageAsVoxels(opts.gamma)', { min: 0.01 });
        if (opts.brightness !== undefined) assertNumber(opts.brightness, 'importImageAsVoxels(opts.brightness)', { min: -1, max: 1 });
        if (opts.contrast !== undefined) assertNumber(opts.contrast, 'importImageAsVoxels(opts.contrast)', { min: -1, max: 1 });
        if (opts.saturation !== undefined) assertNumber(opts.saturation, 'importImageAsVoxels(opts.saturation)', { min: -1, max: 1 });
        if (opts.posterizeColors !== undefined) assertNumber(opts.posterizeColors, 'importImageAsVoxels(opts.posterizeColors)', { min: 0, integer: true });
        if (opts.palette !== undefined && opts.palette !== null) {
          if (!Array.isArray(opts.palette)) throw new Error('importImageAsVoxels(opts.palette) must be an array of [r,g,b] triples');
          opts.palette.forEach((c, i) => {
            const t = assertNumberTuple(c, 3, `importImageAsVoxels(opts.palette[${i}])`);
            t.forEach((n, j) => assertNumber(n, `importImageAsVoxels(opts.palette[${i}][${j}])`, { min: 0, max: 255, integer: true }));
          });
        }
        if (opts.codeStyle !== undefined) assertEnum(opts.codeStyle, ['decode', 'calls'], 'importImageAsVoxels(opts.codeStyle)');
        if (opts.removeBackground !== undefined) assertBoolean(opts.removeBackground, 'importImageAsVoxels(opts.removeBackground)');
        if (opts.backgroundColor !== undefined) {
          const c = assertNumberTuple(opts.backgroundColor, 3, 'importImageAsVoxels(opts.backgroundColor)');
          c.forEach((n, i) => assertNumber(n, `importImageAsVoxels(opts.backgroundColor[${i}])`, { min: 0, max: 255, integer: true }));
        }
      });
      if (typeof check === 'object' && check !== null && 'error' in check) return check;
      let imageData: ImageData;
      try {
        imageData = await decodeImageUrlToImageData(imageUrl);
      } catch (e) {
        return { error: `importImageAsVoxels: could not load/decode image — ${(e as Error).message}` };
      }
      const grid = imageDataToVoxelGrid(imageData, opts);
      if (grid.size === 0) return { error: 'importImageAsVoxels: image produced no voxels (every sampled pixel was transparent).' };
      const code = generateVoxelImportCode(grid, 'image', { style: opts.codeStyle });
      const result = await importCodePayload(code, 'voxel', 'image-voxels');
      return { sessionId: result.sessionId, voxelCount: grid.size };
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
          if (o.language !== undefined) assertEnum(o.language, ['manifold-js', 'scad', 'replicad', 'voxel'], 'validate(opts).language');
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

    /** Swap the active engine. The current editor buffer is stashed as a draft
     *  on the active session, and the target language's draft is restored (or
     *  a stub if you've never written in it on this session). Versions in the
     *  session are not touched — they keep the language they were authored in
     *  and re-load you into that engine when you navigate to them. */
    async setActiveLanguage(lang: Language): Promise<void> {
      assertEnum(lang, ['manifold-js', 'scad', 'replicad', 'voxel'], 'setActiveLanguage(lang)');
      await switchLanguageWithDrafts(lang);
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
    /** Generate a colour tile / stepped-relief Part from an image (data: or http(s) URL). */
    async importImageAsRelief(args: { src: string; mode?: ReliefImportMode; options?: Partial<ReliefCommonOptions>; quantized?: Record<string, unknown>; preprocess?: Record<string, unknown>; crop?: { left: number; top: number; right: number; bottom: number } }): Promise<{ sessionId: string } | { error: string }> {
      if (!args || typeof args !== 'object') return { error: 'importImageAsRelief: expected an object { src, mode?, options?, quantized?, crop? }' };
      const src = (args as { src?: unknown }).src;
      if (typeof src !== 'string' || src.length === 0) return { error: 'importImageAsRelief: src must be a non-empty data: or http(s) URL string' };
      try {
        const image = await dataUrlToImageData(src);
        const opts: ReliefOptions = structuredClone(DEFAULT_RELIEF_OPTIONS);
        const mode = (args as { mode?: unknown }).mode;
        if (mode === 'luminance' || mode === 'quantized' || mode === 'ai') opts.mode = mode;
        const o = (args as { options?: unknown }).options;
        if (o && typeof o === 'object') opts.common = { ...opts.common, ...(o as Partial<ReliefCommonOptions>) };
        const q = (args as { quantized?: unknown }).quantized;
        if (q && typeof q === 'object') opts.quantized = { ...opts.quantized, ...(q as Record<string, unknown>) } as typeof opts.quantized;
        const pp = (args as { preprocess?: unknown }).preprocess;
        if (pp && typeof pp === 'object') opts.preprocess = { ...opts.preprocess, ...(pp as Record<string, unknown>) } as typeof opts.preprocess;
        const crop = (args as { crop?: unknown }).crop;
        if (crop && typeof crop === 'object') opts.crop = crop as ReliefOptions['crop'];
        return await createReliefFromImageData(image, opts, 'relief');
      } catch (e) {
        return { error: `importImageAsRelief failed: ${e instanceof Error ? e.message : String(e)}` };
      }
    },
    /** Generate a multi-colour tile from raw SVG text. Each `<path fill>` becomes
     *  one seed region with crisp boundaries (no clustering). */
    async importSvgAsRelief(args: { svgText: string; options?: Partial<ReliefCommonOptions>; quantized?: Record<string, unknown>; preprocess?: Record<string, unknown> }): Promise<{ sessionId: string } | { error: string }> {
      if (!args || typeof args !== 'object') return { error: 'importSvgAsRelief: expected an object { svgText, options?, quantized? }' };
      const svgText = (args as { svgText?: unknown }).svgText;
      if (typeof svgText !== 'string' || svgText.length === 0) return { error: 'importSvgAsRelief: svgText must be a non-empty SVG string' };
      try {
        const opts: ReliefOptions = structuredClone(DEFAULT_RELIEF_OPTIONS);
        const o = (args as { options?: unknown }).options;
        if (o && typeof o === 'object') opts.common = { ...opts.common, ...(o as Partial<ReliefCommonOptions>) };
        const q = (args as { quantized?: unknown }).quantized;
        if (q && typeof q === 'object') opts.quantized = { ...opts.quantized, ...(q as Record<string, unknown>) } as typeof opts.quantized;
        const pp = (args as { preprocess?: unknown }).preprocess;
        if (pp && typeof pp === 'object') opts.preprocess = { ...opts.preprocess, ...(pp as Record<string, unknown>) } as typeof opts.preprocess;
        return await createReliefFromSvgText(svgText, opts, 'svg');
      } catch (e) {
        return { error: `importSvgAsRelief failed: ${e instanceof Error ? e.message : String(e)}` };
      }
    },
    /** The advisory single-nozzle filament-swap guide for the current relief. */
    getReliefSwapGuide(): unknown {
      if (!currentMeshData) return { error: 'getReliefSwapGuide: no geometry loaded — create or load a relief first.' };
      return getSwapGuideFor(currentMeshData, currentLayerHeight());
    },
    /** Switch the relief optical preview mode: 'flat' | 'ams' | 'single-nozzle'. */
    setReliefPreviewMode(mode: PreviewMode): { ok: true } | { error: string } {
      if (mode !== 'flat' && mode !== 'ams' && mode !== 'single-nozzle') return { error: "setReliefPreviewMode: mode must be 'flat', 'ams', or 'single-nozzle'" };
      const sid = getState().session?.id ?? null;
      // Guard the setter — without this an AI/console call into a non-relief
      // session writes a previewMode record into ReliefSettings for that
      // session and starts shading its mesh with relief-preview colours.
      if (!sid || !isReliefSession(sid)) {
        return { error: 'setReliefPreviewMode: no relief session active. Create one with importImageAsRelief first.' };
      }
      ctlSetReliefPreviewMode(mode);
      updateReliefSettings(sid, { previewMode: mode });
      refreshModelColors();
      reliefStudio?.refresh();
      return { ok: true };
    },
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
        // Restore engine to the loaded version's language (per-version since
        // schema 1.8, with session-level fallback for older data).
        const lang = effectiveVersionLanguage(version, getState().session);
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

    /** Commit the current state, routing between `runAndSave` and
     *  `saveVersion` automatically based on whether the code changed:
     *
     *  - `commitWithColors({code, label?, assertions?})` — code provided
     *    AND differs from the editor: full run + save (carries colors via
     *    the descriptor re-resolution pipeline, same as runAndSave).
     *  - `commitWithColors({code, label?})` — code provided but matches
     *    the editor: snapshot the in-memory state (geometry + colors)
     *    without re-running. Equivalent to `saveVersion`.
     *  - `commitWithColors({label?})` — code omitted: same as `saveVersion`.
     *
     *  Use this when you're an agent and the runAndSave-vs-saveVersion
     *  decision feels brittle — calling `runAndSave` for a color-only
     *  change wastes the WASM re-run; calling `saveVersion` when you
     *  meant to update geometry silently snapshots stale colors. This
     *  routes for you. */
    async commitWithColors(opts: { code?: string; label?: string; assertions?: GeometryAssertions } = {}) {
      const o = opts ?? {};
      assertString(o.code, 'commitWithColors(opts).code', { optional: true });
      assertString(o.label, 'commitWithColors(opts).label', { optional: true });
      if (o.assertions !== undefined) validateAssertionsShape(o.assertions, 'commitWithColors(opts).assertions');
      // If no code is given, or the code matches what's in the editor, just
      // snapshot. The current-code check is intentionally string-equality —
      // whitespace-equivalent reformatting will still re-run, but that's
      // safer than skipping a meaningful change because of a hash collision.
      const editorCode = getValue();
      const shouldRun = typeof o.code === 'string' && o.code !== editorCode;
      if (!shouldRun) {
        const snapshot = await saveCurrentVersion(o.label);
        return { routed: 'snapshot' as const, ...snapshot };
      }
      const run = await partwrightAPI.runAndSave(o.code as string, o.label, o.assertions);
      return { routed: 'run' as const, ...run };
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
      // Each version remembers the language it was authored in (since schema
      // 1.8). Swap the engine before re-running so a JS version loaded while
      // SCAD is active doesn't hit a parse error in the wrong engine.
      const versionLang = effectiveVersionLanguage(version, getState().session);
      if (versionLang !== getActiveLanguage()) {
        await switchLanguage(versionLang);
      }
      setValue(version.code);
      // Restore this version's Customizer overrides before the re-run so it
      // renders with the values it was saved at (matches loadVersionIntoEditor).
      currentParamValues = { ...(version.paramValues ?? {}) };
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
        // Each version remembers the language it was authored in (since schema
        // 1.8). Swap the engine before re-running so a JS version stepped into
        // while another engine is active doesn't run under the wrong sandbox —
        // e.g. a manifold-js version under the voxel/replicad engine, whose
        // `api` has no `params` (and voxel no `Manifold`), which surfaced as
        // "api.params is not a function" / "reading 'cube' of undefined".
        // Mirrors loadVersion()'s language handling.
        const versionLang = effectiveVersionLanguage(version, getState().session);
        if (versionLang !== getActiveLanguage()) {
          await switchLanguage(versionLang);
        }
        setValue(version.code);
        // Restore this version's Customizer overrides before the re-run so it
        // renders with the values it was saved at (matches loadVersion).
        currentParamValues = { ...(version.paramValues ?? {}) };
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
      const version = await saveVersion(code, enrichGeometryDataWithColors(getGeometryDataObj()), thumbnail, label, assertions?.notes, { paramValues: currentParamValues });

      let diff = null;
      if (prevGeoData && prevGeoData.status === 'ok' && newGeoData.status === 'ok') {
        diff = computeStatDiff(prevGeoData, newGeoData);
      }

      const warnings = geometryWarnings(newGeoData);
      const lostLabels = currentLostLabels && currentLostLabels.length > 0
        ? [...currentLostLabels]
        : undefined;
      const printability = computePrintability(newGeoData);
      return {
        ...(assertions ? { passed: true } : {}),
        geometry: newGeoData,
        printability,
        version: version ? { id: version.id, index: version.index, label: version.label } : null,
        diff,
        galleryUrl: getGalleryUrl(),
        ...(warnings.length > 0 ? { warnings } : {}),
        ...(lostLabels ? { lostLabels } : {}),
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

      // Fork into the parent's language. If the active engine is the other
      // one (e.g. user toggled to SCAD then forked a JS version), swap first
      // so the isolated execution doesn't hit a parse error.
      const parentLang = effectiveVersionLanguage(parent, getState().session);
      if (parentLang !== getActiveLanguage()) {
        await switchLanguage(parentLang);
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
      const version = await saveVersion(newCode, enrichGeometryDataWithColors(getGeometryDataObj()), thumbnail, label, assertions?.notes, { paramValues: currentParamValues });

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

    /** Mint a self-contained, read-only share link for the current version.
     *
     *  This is the link to hand back to the user when you're done — unlike
     *  `getSessionUrl()`/`getGalleryUrl()` (which only resolve on this browser,
     *  against this browser's IndexedDB), a share link encodes the whole design
     *  into the URL hash, so anyone can open it anywhere and fork it into their
     *  own editable copy. Nothing is uploaded to a server.
     *
     *  Commits the current buffer first (so unsaved edits are captured), then
     *  encodes the current part's current version. Multi-part sessions share one
     *  part per link. Returns `{ url, encodedBytes }` on success or `{ error }`
     *  (e.g. no session open, browser lacks CompressionStream, or the design is
     *  too large to fit in a URL). */
    async getShareLink() {
      return buildShareLink();
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
        async (code: string, importedMeshes) => {
          // Seed this version's imported meshes so `api.imports[0]` resolves to
          // its own geometry when regenerating the thumbnail (else a stale part).
          setActiveImports(importedMeshes ?? []);
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

      // Include current stats for convenience, with a stale flag when the editor
      // code doesn't match the last-executed code (setCode was called without run).
      const rawStats = JSON.parse(geometryDataEl.textContent || '{}') as Record<string, unknown>;
      const stale = typeof rawStats.codeHash === 'string' && simpleHash(getValue()) !== rawStats.codeHash;
      if (stale) rawStats.stale = true;
      result.stats = rawStats;
      if (stale) result.stale = true;

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

    /** General ray query — cast from origin in direction, return hits along
     *  the ray. Defaults to FRONT-FACE hits only (the outer-surface hits a
     *  closed solid presents to an outside observer), so `hits[0]` is the
     *  nearest exterior surface — which is almost always what you want for
     *  "find the surface I'm aiming at". Pass `{ allHits: true }` to opt
     *  into the full entry/exit soup (`DoubleSide`), useful for thickness
     *  / through-piece queries. */
    probeRay(
      origin: [number, number, number],
      direction: [number, number, number],
      opts?: { allHits?: boolean },
    ): GeneralRayResult | null {
      assertNumberTuple(origin, 3, 'probeRay(origin)');
      assertNumberTuple(direction, 3, 'probeRay(direction)');
      assertBoolean(opts?.allHits, 'probeRay(opts).allHits', { optional: true });
      if (!currentMeshData) return null;
      return probeRay(currentMeshData, origin, direction, opts);
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
        // Thin-feature heuristic: if the model occupies fewer than ~32 px
        // along either screen axis at the current size, the feature is
        // smaller than the AI's pixel-estimation noise — bumping the
        // render size makes each "perceived pixel" cover a smaller real
        // area, so a future probe is more likely to land on geometry.
        const thinAxis = b ? Math.min(b.maxX - b.minX, b.maxY - b.minY) : Infinity;
        const isThin = thinAxis < 32;
        const baseHint = b
          ? `In this ${size}×${size} view the model occupies pixels x[${b.minX}..${b.maxX}], y[${b.minY}..${b.maxY}] (top-left is [0,0]). Re-aim inside that box and probe again.`
          : 'The model does not project into this view (off-screen or degenerate). Render this exact view first to see where it sits, or try a different elevation/azimuth.';
        const thinHint = isThin
          ? ` Thin feature (only ${thinAxis}px wide on the minor axis at size ${size}). Re-render this view at size: ${Math.min(1024, size * 2)} and probe again — each rendered pixel now covers half the real area, so an aim error of ±10-20 px is far less likely to fall off the feature.`
          : '';
        return { ...result, reason: `Pixel [${px}, ${py}] missed the mesh (background).`, hint: baseHint + thinHint };
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
      /** Spatial clamp — the flood-fill won't walk into triangles whose
       *  centroid falls outside this AABB. Essential when painting one
       *  feature of a `BREP.fuseAll` / `Manifold.union` result: the
       *  topology is one big connected mesh and `maxDeviationDeg` alone
       *  can't stop the walk from bleeding across the join between (say)
       *  a dome and the collar beneath it. Either field can be omitted to
       *  leave that side unbounded. */
      withinBox?: { min?: [number, number, number]; max?: [number, number, number] };
      /** Convenience shortcuts for axis-aligned ranges — equivalent to
       *  `withinBox: { min: [-∞,-∞,zMin], max: [∞,∞,zMax] }`. Combine with
       *  withinBox for tighter constraints (AND'd together). */
      zMin?: number;
      zMax?: number;
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

      // Resolve the clamp into a single AABB the BFS predicate can use. Both
      // sides default to ±Infinity so an empty `withinBox` plus a `zMax` works.
      const huge = Infinity;
      const boxMin: [number, number, number] = [
        opts.withinBox?.min?.[0] ?? -huge,
        opts.withinBox?.min?.[1] ?? -huge,
        Math.max(opts.withinBox?.min?.[2] ?? -huge, opts.zMin ?? -huge),
      ];
      const boxMax: [number, number, number] = [
        opts.withinBox?.max?.[0] ?? huge,
        opts.withinBox?.max?.[1] ?? huge,
        Math.min(opts.withinBox?.max?.[2] ?? huge, opts.zMax ?? huge),
      ];
      const hasClamp = (
        Number.isFinite(boxMin[0]) || Number.isFinite(boxMin[1]) || Number.isFinite(boxMin[2]) ||
        Number.isFinite(boxMax[0]) || Number.isFinite(boxMax[1]) || Number.isFinite(boxMax[2])
      );
      const centroidPredicate = hasClamp
        ? (cx: number, cy: number, cz: number) =>
            cx >= boxMin[0] && cx <= boxMax[0] &&
            cy >= boxMin[1] && cy <= boxMax[1] &&
            cz >= boxMin[2] && cz <= boxMax[2]
        : undefined;

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
      const triangles = findConnectedFromSeed(nearest.triIndex, adjacency, cos, centroidPredicate);
      if (triangles.size === 0) {
        if (centroidPredicate) {
          return { error: `paintConnected: seed triangle ${nearest.triIndex} either fails the withinBox/zMin/zMax clamp or has no neighbors meeting both the deviation threshold and the clamp. Widen the clamp or pick a seed inside it.` };
        }
        return { error: `paintConnected: seed triangle ${nearest.triIndex} has no neighbors meeting the deviation threshold` };
      }

      const regionName = opts.name ?? `Region ${getRegions().length + 1}`;
      const region = addRegion(
        regionName,
        opts.color as [number, number, number],
        'paintbrush',
        // Persist the clamp on the descriptor so a re-resolve (e.g. after a
        // code edit that re-tessellates) walks the same way. Old descriptors
        // without clamp fields keep working — they decode as undefined.
        {
          kind: 'connectedFromSeed',
          seedPoint,
          seedNormal,
          maxDeviationDeg: maxDev,
          ...(hasClamp ? {
            clampMin: boxMin,
            clampMax: boxMax,
          } : {}),
        },
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
      if (isSharedPreview()) {
        return { success: false, error: SHARED_PREVIEW_REFUSAL };
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
      /** Smooth the painted boundary by subdividing the base mesh along the
       *  cylinder wall(s) until boundary triangles fall below `maxEdge`.
       *  Defaults to `true` — the painted edge follows the analytic
       *  cylinder rather than the coarse base tessellation, which matters
       *  most for radial-fan meshes (sphere/cylinder/revolve outputs)
       *  where a single base triangle can span 10°+ of arc. Pass
       *  `smooth: false` for the previous fast-but-jaggy behaviour. */
      smooth?: boolean;
      /** Either `resolution` (model bbox diagonal / resolution; default 256)
       *  or an explicit absolute `maxEdge` controls how aggressively we
       *  subdivide. Mirrors the `paintSlab` knobs. */
      resolution?: number;
      maxEdge?: number;
    }) {
      if (!currentMeshData) return { error: 'No geometry loaded' };
      if (!opts || typeof opts !== 'object') return { error: 'paintInCylinder requires { rMin, rMax, zMin, zMax, color }' };
      if (typeof opts.rMin !== 'number' || typeof opts.rMax !== 'number') return { error: 'rMin and rMax must be numbers' };
      if (typeof opts.zMin !== 'number' || typeof opts.zMax !== 'number') return { error: 'zMin and zMax must be numbers' };
      if (opts.rMin < 0 || opts.rMax <= opts.rMin) return { error: 'paintInCylinder requires rMin >= 0 and rMax > rMin' };
      if (opts.zMax <= opts.zMin) return { error: 'paintInCylinder requires zMax > zMin' };
      if (!Array.isArray(opts.color) || opts.color.length !== 3) return { error: 'color must be [r,g,b] in 0..1' };
      const cone = resolvePaintCone(opts.normalCone, opts.topOnly);
      const coneErr = validateNormalCone(cone);
      if (coneErr) return { error: coneErr };
      const areaErr = validateMaxTriangleArea(opts.maxTriangleArea);
      if (areaErr) return { error: areaErr };
      const smoothErr = validateSmoothParams(opts);
      if (smoothErr) return { error: smoothErr };

      const center = opts.center ?? [0, 0];
      const coverageMode = opts.coverageMode;
      const { smooth, maxEdge } = resolveShapeSmoothFields(opts);

      // First pass: find triangles that match the cylinder selector on the
      // CURRENT mesh. If we're going to subdivide, the post-refine resolver
      // (see RegionDescriptor 'cylinder' case) will re-collect against the
      // refined mesh — but we still need a non-empty seed set so addRegion
      // doesn't reject the call with "0 triangles".
      const triangles = collectTrianglesByCylinder(
        currentMeshData,
        center,
        opts.rMin, opts.rMax,
        opts.zMin, opts.zMax,
        cone,
        coverageMode,
        opts.maxTriangleArea,
      );
      if (triangles.size === 0) {
        return { error: `paintInCylinder: no triangles in cylindrical shell (rMin=${opts.rMin}, rMax=${opts.rMax}, z=${opts.zMin}..${opts.zMax})${cone ? ' with normalCone filter' : ''}. Try widening the shell, checking the center, or calling paintPreview with a box first to locate the geometry.` };
      }

      const regionName = opts.name ?? `Region ${getRegions().length + 1}`;
      // withSyncReconcile mirrors the paintSlab pattern: smoothing routes
      // refinement through the async listener, but the agent-facing API
      // wants a fully-populated region back synchronously.
      const region = withSyncReconcile(() => addRegion(
        regionName,
        opts.color as [number, number, number],
        'paintbrush',
        {
          kind: 'cylinder',
          center,
          rMin: opts.rMin,
          rMax: opts.rMax,
          zMin: opts.zMin,
          zMax: opts.zMax,
          ...(cone ? { normalCone: cone } : {}),
          ...(coverageMode ? { coverageMode } : {}),
          ...(opts.maxTriangleArea !== undefined ? { maxTriangleArea: opts.maxTriangleArea } : {}),
          smooth,
          maxEdge,
        },
        triangles,
      ));
      scheduleColorRefresh();
      syncLockState();
      return { id: region.id, name: region.name, triangles: region.triangles.size, smooth, maxEdge };
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
      const lost = currentLostLabels && currentLostLabels.length > 0
        ? [...currentLostLabels]
        : undefined;
      if (!currentLabelMap || currentLabelMap.size === 0) {
        return { count: 0, labels: [], ...(lost ? { lostLabels: lost } : {}) };
      }
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
      return { count: labels.length, labels, ...(lost ? { lostLabels: lost } : {}) };
    },

    /** Report the colors the current run declared in code via
     *  `api.label(shape, name, { color })` (and `api.labeledUnion` entries with a
     *  `color`). These render and export automatically as a derived underlay —
     *  no paint step — and the editor stays editable. Manual paint composites on
     *  top. Returns `{ count, colors: [{name, color, triangleCount}] }`; an empty
     *  list means no colors were declared (or the labelled triangles vanished in
     *  a boolean — check `listLabels().lostLabels`). */
    getModelColors() {
      const colors = getModelRegions().map(r => ({
        name: r.name,
        color: r.color,
        triangleCount: r.triangles.size,
      }));
      return { count: colors.length, colors };
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
    /** Voxel paint mode — only valid in `voxel` language sessions. Activates a
     *  per-voxel click-to-color edit loop: the current code is re-run locally
     *  to capture the grid + per-triangle voxel provenance, the editor is
     *  locked (read-only) so auto-run can't clobber edits, and clicks on the
     *  3D model set or erase voxels in the live grid. Call
     *  `bakeVoxelsToCode()` to commit; `deactivateVoxelPaint()` to cancel.
     *  Returns `{ voxelCount }` or `{ error }`. */
    activateVoxelPaint() {
      if (getActiveLanguage() !== 'voxel') {
        return { error: 'activateVoxelPaint is only available in voxel sessions — call setActiveLanguage("voxel") first.' };
      }
      const code = getValue();
      const err = voxelPaint.activate(code, {
        onMeshUpdate: (mesh) => { updateMesh(mesh, { skipAutoFrame: true }); },
        onLockChange: (locked) => { setReadOnlyReason('voxelPaint', locked); },
      }, currentParamValues);
      if (err) return { error: `activateVoxelPaint: ${err}` };
      syncVoxelPaintUI();
      return { voxelCount: voxelPaint.voxelCount() };
    },

    /** Cancel voxel paint mode without committing — the editor unlocks and the
     *  next auto-run / Run rebuilds the mesh from the (unchanged) code. */
    deactivateVoxelPaint() {
      if (!voxelPaint.isActive()) return { error: 'voxel paint is not active' };
      voxelPaint.deactivate();
      // Trigger a fresh render so the viewport returns to the code's output.
      runCode(getValue());
      syncVoxelPaintUI();
      return { ok: true };
    },

    /** Click on a face during voxel paint: set the underlying voxel's color
     *  (or remove it when `erase: true`). Use this instead of synthesising
     *  pointer events. Returns whether the grid actually changed. */
    paintVoxelFace(opts: { faceIndex: number; color?: [number, number, number] | string | number; erase?: boolean }) {
      if (!voxelPaint.isActive()) return { error: 'voxel paint is not active — call activateVoxelPaint() first.' };
      if (!opts || typeof opts !== 'object') return { error: 'paintVoxelFace requires { faceIndex, color? }' };
      if (!Number.isInteger(opts.faceIndex) || opts.faceIndex < 0) return { error: 'paintVoxelFace.faceIndex must be a non-negative integer' };
      voxelPaint.setEraser(!!opts.erase);
      if (!opts.erase && opts.color !== undefined) {
        try { voxelPaint.setColor(opts.color); }
        catch (e) { return { error: (e as Error).message }; }
      }
      const changed = voxelPaint.paintTriangle(opts.faceIndex);
      return { changed, voxelCount: voxelPaint.voxelCount() };
    },

    /** Bake the painted grid into `voxels.decode(...)` editor code, run it,
     *  and save as a new version. Deactivates voxel paint mode after baking.
     *  Auto-creates a session if none exists. Returns `{ versionIndex,
     *  voxelCount }` or `{ error }`. */
    async bakeVoxelsToCode(opts: { label?: string } = {}) {
      const label = typeof opts.label === 'string' && opts.label ? opts.label : 'painted';
      const result = await bakePaintedVoxelsAsVersion(label);
      syncVoxelPaintUI();
      return result;
    },

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
        'getShareLink':    { signature: 'await getShareLink() -- Read-only share link for the current version -> {url, encodedBytes} or {error}; the link to hand the user when done', docs: '/ai.md#console-api--windowpartwright' },
        'getGalleryUrl':   { signature: 'getGalleryUrl() -- URL for gallery view (local browser only)', docs: '/ai.md#console-api--windowpartwright' },
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
        'exportVOX':       { signature: 'exportVOX() -- Download MagicaVoxel .vox (voxel sessions)', docs: '/ai/voxel.md' },
        // AI-friendly export — return bytes over the API instead of triggering a download
        'exportGLBData':   { signature: 'await exportGLBData() -- Return GLB as {filename, mimeType, base64, sizeBytes}', docs: '/ai/file-io.md' },
        'exportSTLData':   { signature: 'await exportSTLData() -- Return STL as {filename, mimeType, base64, sizeBytes}', docs: '/ai/file-io.md' },
        'exportOBJData':   { signature: 'await exportOBJData() -- Return OBJ as {filename, mimeType, text? | base64, sizeBytes}', docs: '/ai/file-io.md' },
        'export3MFData':   { signature: 'await export3MFData() -- Return 3MF as {filename, mimeType, base64, sizeBytes}', docs: '/ai/file-io.md' },
        'exportVOXData':   { signature: 'await exportVOXData() -- Return .vox as {filename, mimeType, base64, sizeBytes} (voxel sessions)', docs: '/ai/file-io.md' },
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
        'getModelColors':  { signature: 'getModelColors() -> {count, colors: [{name, color, triangleCount}]} -- Colors declared in code via api.label(shape, name, {color}). Render + export automatically; editor stays editable; manual paint overrides.', docs: '/ai/colors.md' },
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

  // Surface modifiers UI (viewport ✦ Surface button + command-palette entries).
  initSurfaceUI(partwrightAPI as unknown as Parameters<typeof initSurfaceUI>[0]);
  // Resize/scale UI (viewport ⇲ Resize button + command-palette entry).
  initResizeUI(partwrightAPI as unknown as Parameters<typeof initResizeUI>[0]);

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
    const isBrep = getActiveLanguage() === 'replicad';
    if (geo.isManifold === false) {
      warnings.push(
        'isManifold: false — the mesh has non-manifold edges or gaps, so it is ' +
        'not a watertight solid and will fail to slice / 3D-print with most tools. ' +
        'Fix before finalizing: ensure boolean operands overlap by ≥ 0.5 units, ' +
        'avoid zero-thickness walls, and check for duplicate faces.',
      );
    }
    if (typeof geo.componentCount === 'number' && geo.componentCount > 1) {
      const cc = geo.componentCount;
      const enclosed = typeof geo.containedComponents === 'number' ? geo.containedComponents : 0;
      const floating = cc - enclosed;
      // Only warn about true floaters — fully-enclosed interior components (e.g.
      // sealed voids inside voxel shells) won't detach in print and shouldn't
      // block a single-piece assertion.
      if (floating > 1) {
        // Partwright exists to produce printable parts, so a multi-component
        // result is almost always a failed union rather than a deliberate
        // assembly. Frame it as a print defect and point at the exact tool that
        // diagnoses it, instead of inviting the model to shrug it off.
        let msg =
          `componentCount: ${cc}${enclosed > 0 ? ` (${enclosed} enclosed interior void${enclosed > 1 ? 's' : ''} excluded)` : ''} — ` +
          `the model has ${floating} disconnected solid${floating > 1 ? 's' : ''}. ` +
          `For 3D printing that means ${floating} separate piece${floating > 1 ? 's' : ''}: any part not connected ` +
          `to the main body floats free and will detach (or print in mid-air). ` +
          `Unless you deliberately intend a multi-part assembly, the pieces must ` +
          `volumetrically OVERLAP by ≥ 0.5 units to fuse into one solid — a shared ` +
          `face or a point/edge touch is NOT enough.`;
        msg += isBrep
          ? ' In BREP this bites often: OCCT leaves non-overlapping or thinly-touching ' +
            'shapes as a disconnected compound even after fuse / fuseAll (e.g. a thin ' +
            'annular sliver of overlap frequently fails to bond). Call ' +
            'runAndExplain(code) to list every component with a per-floater overlap ' +
            'suggestion, then seat the piece a few units deeper into its neighbour and ' +
            're-run until componentCount is 1.'
          : ' Call runAndExplain(code) to see which pieces are disconnected and get a ' +
            'concrete .translate() overlap suggestion for each floater.';
        warnings.push(msg);
      } else if (enclosed > 0) {
        // All extra components are sealed interior voids — informational only
        warnings.push(
          `componentCount: ${cc} — ${enclosed} component${enclosed > 1 ? 's are' : ' is'} a sealed interior void fully enclosed within another solid. ` +
          `These won't detach in print. Call runAndExplain(code) to inspect each component individually.`,
        );
      }
    }
    // Surface color regions that no longer resolve to any triangles on
    // the freshly-run mesh — descriptors are still serialized (so the
    // user's intent is preserved), but the live render shows zero paint
    // for them. The most common cause is editing the code so a
    // previously-registered api.label / BREP.label is gone, or switching
    // modeling languages: byLabel descriptors then silently drop on
    // load. Naming them in the runAndSave response saves a re-load.
    const empty: string[] = [];
    for (const r of getRegions()) {
      if (r.triangles.size === 0) {
        const kind = r.descriptor.kind === 'byLabel'
          ? `byLabel "${r.descriptor.label}"`
          : r.descriptor.kind;
        empty.push(`${r.name} (${kind})`);
      }
    }
    if (empty.length > 0) {
      warnings.push(
        `${empty.length} color region${empty.length > 1 ? 's' : ''} resolved to zero triangles on the new mesh and will render as un-painted: ${empty.join(', ')}. ` +
        'Most common cause: the api.label / BREP.label they reference is no longer registered (renamed, removed, or the modeling language changed). ' +
        'Re-add the label, or drop the region with removeRegion / clearColors and repaint by coordinates.',
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
      refreshModelColors();
    });
  }

  function runCode(code?: string, opts: { surfaceErrors?: boolean } = {}) {
    // Never execute the sharer's untrusted code in a read-only preview. Fork first.
    if (isSharedPreview()) return;
    const src = code ?? getValue();
    setStatus(statusBar, 'running', 'Running...');
    clearEditorDiagnostics();
    clearEditorErrorPanel(editorErrorPanel);

    requestAnimationFrame(async () => {
      if (_running) {
        if (_runGeneration === _rafOwnedGeneration) {
          // The in-flight run is our own previous RAF auto-run — cancel it so
          // the latest edited code renders immediately instead of being dropped.
          cancelCurrentExecution();
        } else {
          // An explicit call (partwright.run, version load) owns the current
          // run (or a newer RAF already claimed a higher generation) — suppress
          // this auto-run rather than preempting it.
          return;
        }
      }
      // Record which generation we're about to start so a later RAF can
      // cancel only this specific run (not an explicit run that superseded it).
      const myRafGen = _runGeneration + 1;
      _rafOwnedGeneration = myRafGen;
      await runCodeSync(src, opts);
      // If we still own the generation slot and the run is done, clear it.
      if (_rafOwnedGeneration === myRafGen) _rafOwnedGeneration = -1;
    });
  }

  // Start the elapsed-time display for a render. The cancel button and timer
  // are delayed 400 ms so fast runs (manifold-js is typically < 100 ms) never
  // flash them. stopRunTimer() always cancels the pending show before it fires.
  function startRunTimer(t0: number): void {
    _runTimerStart = t0;
    stopRunTimer();
    _runShowTimer = window.setTimeout(() => {
      _runShowTimer = null;
      setRunState(true, performance.now() - _runTimerStart);
      _runTimerInterval = window.setInterval(() => {
        const ms = performance.now() - _runTimerStart;
        setRunState(true, ms);
        setStatus(statusBar, 'running', `Rendering... ${(ms / 1000).toFixed(1)}s`);
      }, 100);
    }, 400);
  }

  function stopRunTimer(): void {
    if (_runShowTimer !== null) { clearTimeout(_runShowTimer); _runShowTimer = null; }
    if (_runTimerInterval !== null) { clearInterval(_runTimerInterval); _runTimerInterval = null; }
    setRunState(false);
  }

  async function runCodeSync(src: string, opts: { surfaceErrors?: boolean } = {}): Promise<boolean> {
    // Hard refusal in shared-preview mode: this is the single execution
    // chokepoint that the console API (partwright.run / runAndSave) also routes
    // through, so guarding it here keeps the sharer's untrusted code from ever
    // reaching `new Function('api', code)` until the viewer forks.
    if (isSharedPreview()) return false;
    // Manual runs (Run button, version load, partwright.run) surface errors
    // immediately; auto-runs defer to the idle/blur triggers so the editor
    // doesn't flicker an error on every keystroke.
    const surfaceErrors = opts.surfaceErrors ?? true;
    const myGen = ++_runGeneration;
    _running = true;
    // Ensure status shows "Running..." regardless of how this run was triggered
    // (runCode sets it before the RAF; import paths call runCodeSync directly).
    setStatus(statusBar, 'running', 'Running...');
    clearEditorDiagnostics();
    clearEditorErrorPanel(editorErrorPanel);
    const t0 = performance.now();
    startRunTimer(t0);
    // Feed the Customizer's current overrides into the model's api.params(...).
    let result: Awaited<ReturnType<typeof executeCodeAsync>>;
    try {
      result = await executeCodeAsync(src, undefined, currentParamValues);
    } catch (err) {
      // Worker was terminated (cancelled by user, cancelled for a newer run,
      // timeout, or crash). Only clean up if we're still the active run —
      // a newer run already owns _running and the timer when myGen differs.
      if (myGen !== _runGeneration) return false;
      _running = false;
      stopRunTimer();
      const msg = err instanceof Error ? err.message : String(err);
      const wasCancelled = /cancell?ed/i.test(msg);
      setStatus(statusBar, wasCancelled ? 'ready' : 'error', wasCancelled ? 'Cancelled' : msg);
      return false;
    }

    // A newer runCodeSync was dispatched while we were awaiting the Worker.
    // Discard this result to prevent a stale version from overwriting the
    // current mesh, manifold, or colour regions.
    if (myGen !== _runGeneration) return false;

    const elapsed = Math.round(performance.now() - t0);
    _running = false;
    stopRunTimer();

    // Reconcile the Customizer with what the model declared this run. The
    // schema rides on the result for both success and error, so the panel
    // stays visible (and editable) even while the model is mid-error. Prune
    // overrides to the keys the model still declares so values from a previous
    // model don't linger, then reflect resolved values in the widgets.
    syncParamsPanel(result.paramsSchema);

    if (result.error) {
      const diagnostics = result.diagnostics ?? [];
      setStatus(statusBar, 'error', summarizeDiagnostics(result.error, diagnostics));
      if (printabilityIndicatorEl) printabilityIndicatorEl.style.display = 'none';
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
      } else if (result.renderOnly) {
        // Render-only output (api.renderMesh) is intentionally not a real
        // Manifold; trying to ofMesh() it would throw "Not manifold".
        currentManifold = null;
      } else {
        const mod = getModule();
        // SCAD / replicad engines deliberately tolerate non-watertight output
        // and return it as a raw mesh — ofMesh() throws "Not manifold" on
        // those. Treat a failed reconstruction as render-only (parity with the
        // renderOnly branch and the import flow) rather than letting the run
        // handler blow up.
        try {
          currentManifold = (mod && result.mesh) ? mod.Manifold.ofMesh(result.mesh) : null;
        } catch {
          currentManifold = null;
        }
      }
      // Capture the labelled-construction map for this run. byLabel
      // region descriptors look up their triangles here; rehydrating a
      // saved version re-runs the code first, which rebuilds the map.
      currentLabelMap = result.labelMap ?? null;
      currentLostLabels = result.lostLabels ?? null;
      setPaintLabels(currentLabelMap);

      // Model-declared colors (api.label(shape, name, { color })) become a
      // derived underlay: resolve each labelled name's triangles from the fresh
      // labelMap and hand them to the model-region layer. Rebuilt every run
      // (so editing a color in code updates the render) and replaced wholesale
      // — passing [] when nothing was declared clears any prior run's layer.
      // This layer never locks the editor and is never serialized; the user's
      // manual paint composites on top of it. See src/color/regions.ts.
      const modelColorDecls: { name: string; color: [number, number, number]; triangles: Set<number> }[] = [];
      if (result.labelColors && currentLabelMap) {
        for (const [name, color] of result.labelColors) {
          const triangles = currentLabelMap.get(name);
          if (triangles && triangles.size > 0) modelColorDecls.push({ name, color, triangles });
        }
      }
      setModelColorRegions(modelColorDecls);

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
      } else if (hasColorRegions() || hasModelColorRegions()) {
        // Re-resolve each non-refining region's triangles against the
        // freshly-run mesh. Without this, the in-memory `triangles` Set
        // still indexes the previous mesh — wrong colors when the
        // triangle count changes, and the `byLabel` / `coplanar` /
        // `connectedFromSeed` cases that depend on engine state
        // (labelMap, surface positions) don't re-evaluate on the new
        // run. Cheap when there are no regions; O(regions * tris) when
        // there are.
        const mesh = result.mesh;
        let adjacency: AdjacencyGraph | null = null;
        for (const region of getRegions()) {
          const d = region.descriptor;
          if (!adjacency && (d.kind === 'coplanar' || d.kind === 'connectedFromSeed')) {
            adjacency = buildAdjacency(mesh);
          }
          setRegionTriangles(region.id, resolveDescriptorTriangles(d, mesh, adjacency, null));
        }
        const displayMesh = applyTriColorsIfVisible(mesh);
        updateMesh(displayMesh);
        updatePaintMesh(mesh);
      } else {
        updateMesh(result.mesh);
        updatePaintMesh(result.mesh); // always pass uncolored mesh for adjacency
      }

      updateGeometryData(elapsed, src);
      syncClipSliderBounds();
      // A fresh run replaces the geometry, so any simplify baseline is stale.
      // Drop it and let an open panel re-snapshot the new mesh.
      simplifyBaselineMesh = null;
      simplifyBaselineColoredMesh = null;
      simplifyBaselineRegions = null;
      simplifyBaselineModelRegions = null;
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
