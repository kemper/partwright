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
import { assetPath, appPath, appRoute } from './deployment';
import { initDiagnosticsPanel, toggleDiagnosticsPanel } from './ui/diagnosticsPanel';
import { initEngine, executeCode, executeCodeAsync, validateCodeAsync, detectScadIncludesAsync, ensureEngineReady, getModule, getActiveLanguage, setActiveLanguage, exportLastBrepAsSTEP, importSTEPToBrep, importSTEPToMesh, clearBrepImports, clearBrepShape, simplifyInWorker, enhanceInWorker, cancelCurrentExecution, type Language } from './geometry/engine';
import { formatEngineMemory } from './geometry/engineMemory';
import { onQualitySettingsChange } from './geometry/qualitySettings';
import { resolveParamValues, pruneParamValues, type ParamSpec, type ParamValue } from './geometry/params';
import { createParamsPanel, type ParamsPanelController } from './ui/paramsPanel';
import { viewportToolsMount, openPopoverGroupById } from './ui/popoverMenu';
import { TOOL_TOGGLE_IDLE, TOOL_TOGGLE_ACTIVE } from './ui/toolPanel';
import { sliceAtZ, getBoundingBox } from './geometry/crossSection';
import { initViewport, updateMesh, clearMesh, setOnMeshUpdate, setOnContextLost, setOnContextRestored, setClipping, setClipZ, getClipState, getCameraState, getCameraPose, setCameraPose, getCanvas, getMeshGroup, getCamera, setMeasureLock, setUserOrbitLock, isUserOrbitLocked, onUserOrbitLockChange, setDimensionsVisible, isDimensionsVisible, setGridVisible, isGridVisible, setWireframeVisible, isWireframeVisible, onWireframeChange, setStudioLighting, isStudioLighting, onStudioLightingChange, resetView, onOrbitEnd } from './renderer/viewport';
// Side-effect import: registers the phantom/annotation/session-plane viewport
// hooks. Must load before initViewport runs (below). See viewportSubsystems.ts.
import './renderer/viewportSubsystems';
import { renderCompositeCanvas, renderSingleView, renderSingleViewCanvas, renderSliceSVG, setAttachments as _setAttachments, clearAttachments as _clearAttachments, getAttachments as _getAttachments, getImageAttachments as _getImageAttachments, buildViewCamera, RENDER_VIEW_MODES, EDGE_MODES, STANDARD_VIEWS, type AttachedImage, type SessionAttachment, type AttachmentKind, type RenderViewMode, type EdgeMode } from './renderer/multiview';
import { normalizeAttachment, ATTACHMENT_KINDS } from './storage/attachment';
import { generateId, getLatestVersion, listVersions, listParts, updateVersionThumbnail } from './storage/db';
import { setPhantom, clearPhantom, hasPhantom, type PhantomOptions } from './renderer/phantomGeometry';
import { initEditor, setValue, getValue, getSelection, setLanguage as setEditorLanguage, setEditorDiagnostics, clearEditorDiagnostics, revealFirstDiagnostic, formatCode, openFindReplace, getAutoFormat, setAutoFormat, getLineWrap, setLineWrap, getLineNumbers, setLineNumbers, getFontSize, setFontSize, getFontSizeBounds, editorContentDiffersFrom, createCompanionEditor, setCompanionEditorContent } from './editor/codeEditor';
import type { EditorView as CMEditorView } from '@codemirror/view';
import { createLayout, type TabName } from './ui/layout';
import { createToolbar, isAutoRun, setAutoRun, setToolbarLanguage, setAiToolbarState, setRunState } from './ui/toolbar';
import { installKeyboardShortcuts } from './ui/keyboardShortcuts';
import { registerCommands } from './ui/commandPalette';
import { mountHintsTicker, showHintsTicker } from './ui/hints/hintsTicker';
import { showAdvancedSettingsModal } from './ui/advancedSettingsModal';
import { combo, MOD_LABEL, SHIFT_LABEL, ALT_LABEL } from './ui/shortcutDefs';
import { showToast } from './ui/toast';
import { confirmDialog, promptDialog } from './ui/dialogs';
import { showSaveAllModal, type UnsavedPartRow } from './ui/saveAllModal';
import { updateAppHistory } from './ui/appHistory';
import { initAiPanel, setActiveSession as setAiActiveSession, toggleAiPanel, toggleAiPanelFromToolbar, prefillAiInput, setAiPanelRouteActive, closeAiPanel, isAiTurnInFlight, onAiTurnEnd } from './ui/aiPanel';
import { onViewportPanelOpen } from './ui/viewportPanelRegistry';
import { getKey, mergeChatBucket } from './ai/db';
import { requestPersistentStorage } from './storage/persist';
import { aiConnectionMode, reloadSettingsFromStorage, getRenderBudget, getSpendingSummary, setSpendingMode as applyAiSpendingMode } from './ai/settings';
import { createHelpPage } from './ui/help';
import { createLegalPage } from './ui/legal';
import { showExportOptionsDialog } from './ui/exportOptionsDialog';
import { showExportConfirm, hasExportWarning, type ExportWarningInfo } from './ui/exportConfirmModal';
import { createCatalogPage, type CatalogManifestEntry } from './ui/catalog';
import { createIdeasPage } from './ui/ideasPage';
import { IDEAS, type Idea } from './ideas/ideas';
import { createWhatsNewPage } from './ui/whatsNew';
import { createNotFoundPage } from './ui/notFound';
import { applyRouteMeta, routeTitle, type RouteName } from './seo/meta';
import { createSessionBar } from './ui/sessionBar';
import { createPartList } from './ui/partList';
import { openAssemblyView, closeAssemblyView, isAssemblyViewOpen, getAssemblySnapshot } from './assembly/assemblyView';
import { openPartsOverview } from './ui/partsOverview';
import { createGalleryView, refreshGallery } from './ui/gallery';
import { createVersionsView, refreshVersions } from './ui/versions';
import { createImagesView, refreshImages } from './ui/imagesView';
import { createDiffView, refreshDiff } from './ui/diffView';
import { createNotesView, refreshNotes } from './ui/notes';
import { initDataExplorer, refreshDataExplorer } from './ui/dataExplorer';
import { initSessionList, showSessionList } from './ui/sessionList';
import { exportGLB, buildGLB, buildGLBProject } from './export/gltf';
import { exportSTL, buildSTL, buildSTLProject } from './export/stl';
import { exportOBJ, buildOBJ, buildOBJProject } from './export/obj';
import { openPublishModal } from './ui/publishModal';
import { findPublishTarget, type PublishFormat } from './publish/publishTargets';
import { generatePublishMetadata, isActiveProviderConnected } from './ai/publishMetadata';
import { export3MF, build3MF } from './export/threemf';
import { buildZip, type ZipEntry } from './export/zip';
import { build3MFProject, BAMBU_PRINTERS, DEFAULT_BAMBU_PRINTER, BAMBU_FILAMENT_TYPES, DEFAULT_BAMBU_FILAMENT, BAMBU_NOZZLES, isBambuPrinter, isBambuNozzle, isBambuFilament } from './export/threemfProject';
import { showExportPartsModal, type ExportPartChoice } from './ui/exportPartsModal';
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
import { showScadCompanionModal } from './ui/scadCompanionModal';
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
import { greedyMeshGrid } from './geometry/voxel/mesher';
import { appendVoxelEditsToCode, editOpCount, formatSurfacingCall } from './geometry/voxel/editCodegen';
import * as voxelPaint from './color/voxelPaint';
import { setActiveImports, getActiveImports, type ImportedMesh } from './import/importedMesh';
import { getCompanionFiles, setCompanionFiles, addCompanionFile as addCompanionFileToRegistry, removeCompanionFile as removeCompanionFileFromRegistry, updateCompanionFile, detectMissingIncludes, normalizeCompanionPath, companionFilesEqual } from './import/companionFiles';
import { applyFuzzy, applyFuzzyPatch, applyKnit, applyKnitAsync, applyKnitPatch, applyKnitPatchAsync, applyCable, applyCablePatch, applyWaffle, applyWafflePatch, applyFur, applyFurPatch, applyWoven, applyWovenPatch, applyKnurl, applyKnurlPatch, applyVoronoi, applyVoronoiPatch, applyVoronoiLamp, buildEngraveResult, applySmooth, applySmoothPatch, applyVoxelize, applyScale, defaultFuzzyOptions, defaultKnitOptions, defaultCableOptions, defaultWaffleOptions, defaultFurOptions, defaultWovenOptions, defaultKnurlOptions, defaultVoronoiOptions, defaultVoronoiLampOptions, defaultEngraveOptions, defaultSmoothOptions, modelDiagonal, applyTransform, SdfAbortError, type ModifierResult, type EngraveProjection, type StampMask, type SdfRunControl } from './surface/modifiers';
import { engraveInWorker } from './surface/engraveWorkerClient';
import { buildTextStampMask, buildImageStampMask } from './surface/engraveStampHost';
import { buildTransformCode, computePlacementDelta, isNoopDelta, isNoopRotation, isNoopScale, placementLabel, rotationLabel, mirrorLabel, scaleLabel, rotateAboutCenterSteps, mirrorAboutCenterSteps, bestFlatDownRotation, applySteps, meshBox, type PlacementBox, type PlacementOps, type TransformStep, type Vec3 } from './surface/placement';
import { nearestTriangleMap, remapTriangleSets, selectTrianglesNearSeeds } from './surface/colorTransfer';
import { surfaceCacheStatus, computeChain, surfaceChainKey, seedSurfaceCache, meshContentKey, cancelSurfaceCompute, surfaceComputeInFlight, SurfaceComputeCancelled, type SurfaceOp } from './surface/surfaceOps';
import { SURFACE_OP_IDS, SURFACE_OP_FIELDS, SURFACE_SCOPE_KEYS, parseSurfaceOpts, isSurfaceOpId, type SurfaceOpId, type PersistedSurfaceTexture, type ResolvedScope } from './surface/surfaceOpSpec';
import { upsertSurfaceCall } from './surface/surfaceCodegen';
import { initSurfaceUI } from './ui/surfaceModal';
import { initCharacterCreatorUI } from './ui/characterCreatorPanel';
import { specToCode } from './figure/characterCodegen';
import { normalizeSpec } from './figure/characterSpec';
import { initResizeUI } from './ui/resizeModal';
import { initPlaceUI } from './ui/placeModal';
import { generateRelief, generateReliefFromSvg } from './relief/imageToRelief';
import { DEFAULT_RELIEF_OPTIONS, type ReliefOptions, type ReliefImportMode, type ReliefCommonOptions, type SeedRegion, type PreviewMode, type GenerateReliefResult } from './relief/types';
import { computeReliefTriColors, getSwapGuideFor, setPreviewMode as ctlSetReliefPreviewMode, getPreviewMode as ctlGetReliefPreviewMode, isPreviewActive as isReliefPreviewActive } from './relief/reliefController';
import { setReliefSettings, getReliefSettings, updateReliefSettings, isReliefSession, getPreviewModeFor } from './relief/reliefSettings';
import { saveReliefSource, getReliefSource } from './relief/reliefSource';
import {
  listFilaments, hexToRgb, getPaletteCapacity, setPaletteCapacity,
  isPaletteConstrained, setPaletteConstrained,
  addFilament, updateFilament, removeFilament,
  listPalettes, createPalette, setActivePalette, getActivePaletteId, getActivePaletteName,
} from './color/palette';
import { meshBounds } from './color/slabPaint';
import { openReliefImportModal } from './ui/reliefImportModal';
import { mountReliefStudio, type ReliefStudioHandle } from './ui/reliefStudio';
import type { BuiltExport } from './export/gltf';

/** Register a freshly-built export blob in the inbox so it shows up in Recent Exports. */
function registerExportFromBuilt(built: BuiltExport, source: string): void {
  registerInboxExport(built.blob, built.filename, source, built.mimeType);
}
import type { MeshData, MeshResult, SourceDiagnostic } from './geometry/types';
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
import { initImagePaintUI, setSmoothStampCallback, setStampCommitHook, stampImageProgrammatic } from './color/imagePaintUI';
import { stampImageOntoMesh, buildTangentFrame, entriesToPerTriColors, remapPerTriColors, loadImageDataFromUrl } from './color/imagePaint';
import { resolveImageStampPlacement, STAMP_VIEWS, type StampView } from './color/imagePaintPlacement';
import { initVoxelPaintUI, setVoxelPaintAvailable, syncActiveState as syncVoxelPaintUI } from './color/voxelPaintUI';
import { initSimplifyUI, isSimplifyOpen, refreshSimplifyIfOpen, forceDeactivate as closeSimplifyMenu, notifyQualityLangChanged, setQualityRenderState, type SimplifyHandlers } from './ui/simplifyUI';
import { initPrintToolsUI, isPrintToolsOpen, forceDeactivate as closePrintToolsMenu, type PrintToolsHandlers } from './ui/printToolsUI';
import { analyzePrintability, type PrintabilityReport } from './geometry/printability';
import { loadPrinterSettings, savePrinterSettings, type PrinterSettings } from './geometry/printerSettings';
import { updatePaintMesh, setOnRegionPainted, setTriangleToBaseMapper } from './color/paintMode';
import { baseTriangleOf } from './color/baseRemap';
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
import { applyTriColors, applyTriColorsIfVisible, hasRegions as hasColorRegions, onChange as onColorRegionsChange, onVisibilityChange as onPaintVisibilityChange, clearRegions, serialize as serializeRegions, addRegion, getRegions, removeRegion, removeLastRegion, redoLastRegion, setRegionVisibility, setRegionTriangles, buildTriColors, createEmptyTriColors, overlayPainted, setModelColorRegions, setModelRegionTriangles, hasModelColorRegions, clearModelColorRegions, getModelRegions, getDistinctRegionColors, replaceRegionColors, composeTriColors, type ColorRegion, type SerializedColorRegion, type RegionDescriptor } from './color/regions';
import { resolvePaintOps, resolvePaintDescriptor } from './color/paintOpsResolve';
import { computePatternColors, filterScopeTriangles } from './color/colorPattern';
import { setPaintLabels } from './color/labels';
import { setBucketTolerance as setPaintBucketTolerance, getBucketTolerance as getPaintBucketTolerance, setBucketColorTolerance as setPaintBucketColorTolerance, getBucketColorTolerance as getPaintBucketColorTolerance, setBucketMode as setPaintBucketMode, getBucketMode as getPaintBucketMode, setBrushRadius as setPaintBrushRadius, getBrushRadius as getPaintBrushRadius, setBrushSmooth as setPaintBrushSmooth, isBrushSmooth as isPaintBrushSmooth, setBrushSmoothDivisor as setPaintBrushSmoothDivisor, getBrushSmoothDivisor as getPaintBrushSmoothDivisor, setBrushSurface as setPaintBrushSurface, getBrushSurface as getPaintBrushSurface, setBrushPaintDepth as setPaintBrushDepth, getBrushPaintDepth as getPaintBrushDepth, setBrushWrapAngle as setPaintBrushWrapAngle, getBrushWrapAngle as getPaintBrushWrapAngle, SMOOTH_DIVISOR_MIN, SMOOTH_DIVISOR_MAX, WRAP_ANGLE_MIN, WRAP_ANGLE_MAX } from './color/paintMode';
import { buildStrokeMesh, buildRefinedMesh, buildRefinedMeshFromSet, brushRefineRegion, strokeFootprintTriangles, deriveSampleNormals, buildGeodesicField, tangentBasis, wrapAngleGate, childrenByParent, type BrushStroke, type BrushShape, type RefineRegion } from './color/subdivide';
import { refineInWorker, SubdivisionAbortError, terminateSubdivisionWorker } from './color/subdivisionClient';
import { startProgress, updateProgress, endProgress, __setProgressModalDelayForTests } from './ui/progressModal';
import { syncLockState, disableRun, enableRun } from './color/editorLock';
import { setReadOnlyReason } from './editor/editorAccess';
import { asLanguage } from './storage/languageFallback';
import { encodeShare, decodeShare, validateSharePayloadShape, ShareUnsupportedError } from './share/shareLink';
import { openShareModal, renderSharedBanner, renderSharedOverlay } from './share/shareUI';
import {
  initInsertPalette,
  setInsertPaletteAvailable,
  apiEnterArrange,
  apiExitArrange,
  apiIsArrangeActive,
  apiSetSelection,
  apiAddToSelection,
  apiClearSelection,
  apiGetSelection,
  apiUndo,
  apiRedo,
  apiCanUndo,
  apiCanRedo,
  apiResizeSelection,
  apiAlignSelection,
  apiGroupSelection,
  apiSubtractSelection,
  apiIntersectSelection,
  apiDeleteSelection,
  apiDuplicateSelection,
  apiMirrorSelection,
  apiListParts,
  apiSetAutoCombine,
  apiGetAutoCombine,
  apiSetSnapToGrid,
  apiGetSnapToGrid,
  apiRotateSelection,
} from './ui/insertPalette';
import { buildAdjacency, findCoplanarRegion, findConnectedFromSeed, findColorRegion, resolveSeed, findNearestTriangle, type AdjacencyGraph } from './color/adjacency';
import { findSlabTriangles, slabRefineRegion, smoothEdgeForResolution } from './color/slabPaint';
import { findBoxTriangles, findShapeTriangles, shapeRefineRegion } from './color/boxPaint';
import { cylinderRefineRegion, findCylinderTriangles, type CylinderAxis } from './color/cylinderPaint';
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
  renameVersion as renameVersionInStore,
  deleteVersion as deleteVersionFromStore,
  listCurrentVersions,
  listCurrentParts,
  getCurrentPart,
  createPart,
  changePart,
  renamePart,
  deletePart,
  deleteParts,
  reorderParts,
  partSaveState,
  currentPartIsDirty,
  getState,
  setSessionThumbCamera,
  setSessionWorkCamera,
  getSessionUrl,
  getGalleryUrl,
  exportSession,
  importSession,
  importSessionPartsIntoActive,
  clearAllSessions,
  saveAttachments as persistAttachments,
  getAttachmentsFromSession,
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
import { buildGeometryHeuristicWarnings } from './geometry/geometryHeuristics';
import { getConfig, saveAppConfig } from './config/appConfig';
import { nextStarter, isStarterCode } from './editor/starters';
import { parseLabelColor } from './color/labelColor';
import { extractPositions, maxEdgeLength, minEdgeLength, estimateRefineTriangles } from './surface/meshSubdivide';

// === Attachment helpers (shared by the setImages/addImage + setAttachments/
// addAttachment API methods) ===

/** Push the new attachment list into the in-memory mirror AND persist it to
 *  the active session. Mirrors the old `_setImages + persistImages` pairing. */
function commitAttachments(next: SessionAttachment[]): void {
  _setAttachments(next);
  void persistAttachments(next);
}

/** Validate a loose `{src, id?, label?, kind?, mediaType?}` input and normalize
 *  it into a typed SessionAttachment. `kind`/`mediaType` are inferred from the
 *  src/label when omitted; an explicit `kind` is checked against the enum. */
function buildAttachmentFromInput(input: unknown, ctx: string, source?: 'user' | 'chat'): SessionAttachment {
  const obj = assertObject(input, ctx)!;
  assertNoUnknownKeys(obj, ['src', 'id', 'label', 'description', 'kind', 'mediaType'] as const, ctx);
  assertString(obj.src, `${ctx}.src`, { allowEmpty: false });
  if (obj.id !== undefined) assertString(obj.id, `${ctx}.id`, { allowEmpty: false });
  if (obj.label !== undefined) assertString(obj.label, `${ctx}.label`, { optional: true, allowEmpty: true });
  if (obj.description !== undefined) assertString(obj.description, `${ctx}.description`, { optional: true, allowEmpty: true });
  if (obj.mediaType !== undefined) assertString(obj.mediaType, `${ctx}.mediaType`, { allowEmpty: false });
  if (obj.kind !== undefined) assertEnum(obj.kind, ATTACHMENT_KINDS, `${ctx}.kind`);
  return normalizeAttachment({
    id: obj.id as string | undefined,
    src: obj.src as string,
    label: obj.label as string | undefined,
    description: obj.description as string | undefined,
    kind: obj.kind as AttachmentKind | undefined,
    mediaType: obj.mediaType as string | undefined,
    addedAt: Date.now(),
    source,
  }, generateId());
}

// Editor starters — one simple, labelled, self-coloured primitive per engine,
// rotated so a fresh session/part/language opens on a different cube / sphere /
// cylinder / cone / pyramid. Data + rotation + recognition live in the
// dependency-light, unit-tested `editor/starters` module; the engines that
// can't carry colour in code (scad, replicad) ship a `paint` descriptor that
// `seedStarter` applies via paintByLabel after the run. See `seedStarter`.

// Customizer state. `currentParamSchema` is the parameter schema the active
// model declared via `api.params({...})` on its last run (null when it declared
// none); `currentParamValues` holds the user's overrides (only keys differing
// from defaults — pruned each run). `paramsPanel` is the viewport overlay that
// renders the schema as widgets. All three are kept in sync by runCodeSync.
let currentParamSchema: ParamSpec[] | null = null;
let currentParamValues: Record<string, ParamValue> = {};
let paramsPanel: ParamsPanelController | null = null;

// === Assembly (multi-part grid) view ===
// The mount for the assembly parameter panel (the viewport pane) and the toolbar
// toggle button, both assigned during editor setup. openAssembly/closeAssembly
// are module-scoped so the console API (partwright.openAssembly) can drive them.
let assemblyMount: HTMLElement | null = null;
let assemblyToggleBtn: HTMLButtonElement | null = null;
// The part-id set the Assembly view opened against. If the session's parts
// change while the view is open (a part added/deleted/reordered in this or
// another tab), the in-memory grid + shared-param records go stale — so we close
// the view rather than show/save against a set that no longer matches.
let assemblyOpenSig: string | null = null;
function partsSignature(): string {
  return getState().parts.map(p => p.id).join(',');
}

function syncAssemblyToggle(open: boolean): void {
  if (!assemblyToggleBtn) return;
  assemblyToggleBtn.className = open ? TOOL_TOGGLE_ACTIVE : TOOL_TOGGLE_IDLE;
  // Hidden entirely for single-part sessions where there's nothing to assemble.
  const { session, parts } = getState();
  assemblyToggleBtn.classList.toggle('hidden', !(session && parts.length > 1));
}

async function openAssembly(): Promise<void> {
  if (isAssemblyViewOpen() || !assemblyMount) return;
  const st = getState();
  if (!st.session || st.parts.length < 2) {
    showToast('Add a second part to view all parts together.', { variant: 'neutral' });
    return;
  }
  syncAssemblyToggle(true);
  assemblyOpenSig = partsSignature();
  paramsPanel?.close(); // the assembly view has its own shared-parameter panel
  await openAssemblyView({
    mount: assemblyMount,
    isReadOnly: () => isReadOnlyViewer(),
    // The current part's mesh is already built on the main thread — show it
    // instantly instead of rebuilding it in the pool.
    seedMesh: (versionId) => (getState().currentVersion?.id === versionId ? currentMeshData : null),
    seedSchema: (versionId) => (getState().currentVersion?.id === versionId ? currentParamSchema : null),
    onClosed: () => {
      assemblyOpenSig = null;
      syncAssemblyToggle(false);
      resetView(); // re-frame the restored single-part model
    },
  });
}

function closeAssembly(): void {
  if (!isAssemblyViewOpen()) return;
  closeAssemblyView(); // fires onClosed → syncAssemblyToggle(false) + resetView
}

function toggleAssembly(): void {
  if (isAssemblyViewOpen()) closeAssembly();
  else void openAssembly();
}

/** Reconcile the Customizer panel + override state with the parameter schema a
 *  model declared on its latest run. Pass `undefined` when the model declared
 *  none (hides the panel and clears overrides). */
// Set while an AI turn deferred the Customizer reveal (see syncParamsPanel); the
// onAiTurnEnd flush below consumes it.
let paramsRevealDeferred = false;

function syncParamsPanel(schema: ParamSpec[] | undefined): void {
  if (schema && schema.length > 0) {
    currentParamSchema = schema;
    // Keep only overrides the model still declares (drops stale keys from a
    // previously-run model) and store the minimal non-default set.
    currentParamValues = pruneParamValues(schema, currentParamValues);
  } else {
    currentParamSchema = null;
    currentParamValues = {};
  }
  // While the AI is mid-turn (e.g. a runAndSave during a chat response), don't
  // pop the Customizer over the chat or yank the AI panel aside — the user is
  // still reading the model think. Record the schema now but defer the reveal
  // until the turn ends, then reveal it *silently* so the AI panel stays open.
  if (isAiTurnInFlight()) {
    paramsRevealDeferred = true;
    return;
  }
  refreshParamsPanelUI(false);
}

/** Push the current schema/values into the Customizer panel. `silentReveal`
 *  opens it without hiding the AI panel — used for the post-AI-turn flush. */
function refreshParamsPanelUI(silentReveal: boolean): void {
  if (currentParamSchema && currentParamSchema.length > 0) {
    paramsPanel?.update(currentParamSchema, resolveParamValues(currentParamSchema, currentParamValues), { silentReveal });
  } else {
    paramsPanel?.update(undefined, {});
  }
}

let currentMeshData: MeshData | null = null;
/** Session id whose geometry the viewport last framed. Lets the render paths
 *  tell a *re-render within the active session* (version switch or re-run —
 *  preserve the user's current interactive camera angle) apart from the first
 *  render of a freshly-opened session (let the camera auto-frame the new model). */
let lastFramedSessionId: string | null = null;
type CameraPose = { position: [number, number, number]; target: [number, number, number] };
/** Pose to apply after a render so the camera lands where the user expects
 *  rather than at the default 3/4 framing. Two cases:
 *   • Re-render within an already-framed session (version switch, re-run, AI
 *     edit) → keep the live angle (snapshot it now).
 *   • First framing of a session that has a persisted working-view camera →
 *     restore that saved pose, so the angle survives reload / reopen.
 *  Returns null for the first framing of a session with no saved view (let it
 *  auto-frame). Restore with `if (pose) setCameraPose(pose)` after the render. */
function captureCameraToPreserve(): CameraPose | null {
  const sid = getState().session?.id ?? null;
  if (sid === null) return null;
  if (currentMeshData !== null && sid === lastFramedSessionId) {
    return getCameraPose();
  }
  const saved = getState().session?.workCamera;
  return saved ? { position: [...saved.position], target: [...saved.target] } : null;
}
/** WASM heap high-water (bytes) reported by the geometry Worker for the most
 *  recent manifold-js run. Surfaced in the geometry-data stats and engine-error
 *  log so users can see how close a run came to the ~4 GB ceiling. Undefined
 *  for non-manifold-js engines (separate heaps) or before the first run. */
let lastEngineHeapBytes: number | undefined;
/** Occupied-voxel count reported by the voxel engine for the most recent run.
 *  Surfaced in the geometry-data stats (so `runAndSave().geometry.voxelCount`
 *  and the Data panel show it) without re-decoding the grid. Undefined for the
 *  non-voxel engines or before the first run. */
let lastVoxelCount: number | undefined;
/** Face-connected printable-piece count for the last voxel run (6-neighbour
 *  BFS). Surfaced as `voxelPieceCount` in the geometry-data stats so agents
 *  trust it over the mesh `componentCount`, which over-reports voxel models
 *  (enclosed cavities + edge/corner touches). Undefined for non-voxel engines. */
let lastVoxelPieceCount: number | undefined;
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
/** The refine-driving (subdivision) descriptors the current working mesh was
 *  built against — every `brushStroke` plus any smooth slab/box/cylinder. When
 *  a paint change leaves this set unchanged (a non-smooth stroke, a colour
 *  edit, removing a non-refine region), the mesh topology is already correct,
 *  so the reconcile re-resolves regions against it and recolours instead of
 *  replaying the whole subdivision in the worker. Without this, one smooth
 *  stroke made *every* later paint action trigger a full "Rebuilding refined
 *  mesh…" pass — turning edge smoothing off didn't help, because the existing
 *  smooth stroke still forced the rebuild. Kept in sync wherever the working
 *  mesh is (re)built or reverted via `markMeshRefineState()`. */
let meshRefineList: RegionDescriptor[] = [];
/** The exact `currentMeshData` object `meshRefineList` was snapshotted for. The
 *  fast path only fires while this still holds, so any external mesh swap (a
 *  surface-modifier/scale bake, a model re-run, a version load) forces a real
 *  rebuild instead of recolouring stale triangle indices. */
let meshRefineForMesh: MeshData | null = null;
/** Set while rehydration adds regions in bulk, so each addRegion doesn't kick
 *  off a reconcile mid-rebuild. */
let suspendReconcile = false;
/** Stored reference to the smooth-stamp callback set by setSmoothStampCallback so
 *  rehydrateColorRegions can replay smooth imagePaint stamps on session reload. */
type SmoothReplayCb = (imageData: ImageData, stampOpts: import('./color/imagePaint').StampImageOptions, maxEdge: number) => { result: import('./color/imagePaint').ImagePaintResult; parentToChildren: Map<number, number[]> | null } | null;
let smoothReplayCb: SmoothReplayCb | null = null;
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

// Per-version mesh cache: avoids recompiling SCAD (or any engine) when
// switching between parts whose last-loaded version is unchanged. Keyed by
// version id; LRU eviction keeps memory bounded.
type PartMeshCacheEntry = {
  meshData: MeshData;
  labelMap: Map<string, Set<number>> | null;
  lostLabels: string[] | null;
  modelColorDecls: Array<{ name: string; color: [number, number, number]; triangles: Set<number>; descriptor?: RegionDescriptor }>;
  paramsSchema: ParamSpec[] | undefined;
};
const PART_MESH_CACHE_SIZE = 8;
const partMeshCache = new Map<string, PartMeshCacheEntry>();

// #geometry-data element — always-updated machine-readable state
let geometryDataEl: HTMLElement;
// Viewport overlay pill — shows printability issues after each successful run.
let printabilityIndicatorEl: HTMLElement | null = null;
let fastPreviewPillEl: HTMLElement | null = null;
/** True while the viewport shows the coarse fast-preview pass of an SDF model
 *  and the full-quality render is still in flight. Used to gate mesh-altering
 *  actions (paint, surface modifiers) so they don't bind to the throwaway mesh. */
let _showingFastPreview = false;
// Viewport overlay pill — shown when a run's `api.surface.*` texture chain is
// NOT in the memo cache (a "sticky" miss): we render the base mesh and let the
// user press this to recompute the (potentially slow) texture on demand. See
// the surfaceOps integration in runCodeSync.
let surfaceReapplyEl: HTMLElement | null = null;
// The base mesh + op-chain + base identity for the current run's pending
// (uncomputed) surface textures. Set when a run leaves textures stale; consumed
// by the Re-apply handler. Null when there's nothing pending.
let pendingSurface: { base: MeshData; ops: SurfaceOp[]; baseKey: string; src: string } | null = null;
let surfaceReapplyBusy = false;
// The most recent APPLIED `api.surface.*` result: the full-chain memo key plus
// the textured mesh it produced (the same object that became the live
// currentMeshData / paintBaseMesh). Persisted onto the version on save so
// reopening the session renders textured instantly — and pins the texture's
// appearance at save time as the modifier math evolves. Reset on every
// mesh-producing run by applySurfaceTextures (null when the run declared no
// ops or left them pending); save-time use is identity-guarded against the
// live mesh so a version restored from partMeshCache never persists another
// run's texture. See currentSurfaceTextureForSave.
let lastAppliedSurface: { key: string; mesh: MeshData } | null = null;

/** The `api.surface.*` texture to persist with a save, or undefined when the
 *  live mesh isn't an applied-texture result. Identity-guarded: the tracked
 *  textured mesh must BE the live mesh object (paintBaseMesh stays the run's
 *  mesh through paint refinement; a version restored from partMeshCache is a
 *  different object, so another run's texture can never be attributed to it).
 *  Oversized meshes aren't persisted — the version still saves and reopening
 *  recomputes the chain on demand, exactly as if nothing was stored. */
function currentSurfaceTextureForSave(): PersistedSurfaceTexture | undefined {
  if (!lastAppliedSurface) return undefined;
  const live = paintBaseMesh ?? currentMeshData;
  if (!live || lastAppliedSurface.mesh !== live) return undefined;
  if (lastAppliedSurface.mesh.numTri > getConfig().renderer.surfaceTexturePersistMaxTriangles) return undefined;
  return { key: lastAppliedSurface.key, mesh: lastAppliedSurface.mesh };
}
// The disconnected-components warning is surfaced as a transient toast (recorded
// in the Diagnostic Log) rather than the persistent pill. Track the last one we
// toasted so re-runs of an unchanged broken model don't re-spam the same toast;
// reset to null whenever the warning clears so its next occurrence toasts again.
let lastDisconnectedWarning: string | null = null;

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
  // Engine WASM heap high-water for the last run, so the Data panel doubles as a
  // memory readout — watch it climb as a model scales up toward the ceiling.
  if (lastEngineHeapBytes !== undefined) {
    data.engineMemory = formatEngineMemory(lastEngineHeapBytes);
  }
  // Voxel models report their occupied-voxel count so the stats double as a
  // size readout for direct (non-mesh) modeling.
  if (lastVoxelCount !== undefined) {
    data.voxelCount = lastVoxelCount;
  }
  // Trustworthy "separate printable pieces?" count for voxel models — the mesh
  // componentCount over-reports them (enclosed cavities, edge/corner touches).
  if (lastVoxelPieceCount !== undefined) {
    data.voxelPieceCount = lastVoxelPieceCount;
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
    const { issues } = computePrintability(data);
    // The disconnected-components warning surfaces as a transient toast (which
    // also records it in the Diagnostic Log) rather than the persistent pill;
    // every other issue (e.g. non-manifold) stays on the pill as standing status.
    const disconnected = issues.find((i) => i.includes('disconnected component')) ?? null;
    const pillIssues = issues.filter((i) => i !== disconnected);
    if (pillIssues.length === 0) {
      printabilityIndicatorEl.style.display = 'none';
    } else {
      printabilityIndicatorEl.textContent = '⚠ ' + pillIssues.join(' · ');
      printabilityIndicatorEl.style.display = '';
    }
    // Toast once per change so re-running an unchanged broken model isn't spammy.
    if (disconnected && disconnected !== lastDisconnectedWarning) {
      showToast('⚠ ' + disconnected, { variant: 'warn', source: 'engine' });
    }
    lastDisconnectedWarning = disconnected;
  }
}

/** How long to wait for `canvas.toBlob` before giving up on the thumbnail.
 *  `toBlob` can stall indefinitely when encoding a 2D canvas that a WebGL render
 *  was composited into (observed after painting subdivides + colors the mesh) —
 *  the GPU readback never settles the callback. A thumbnail is non-essential, so
 *  we cap the wait and let the save proceed without it rather than hang forever
 *  (which silently blocked saving a painted version). */

function captureThumbnail(
  mesh: MeshData | null = currentMeshData,
  opts: { rawColors?: boolean } = {},
): Promise<Blob | null> {
  if (!mesh) return Promise.resolve(null);
  let canvas: HTMLCanvasElement;
  // Honour a session-pinned thumbnail camera (partwright.setThumbnailCamera);
  // fall back to the default iso 3/4 view. The pin keeps the perspective ortho
  // flag of the iso view so a custom angle still reads as a 3/4 tile.
  const pin = getState().session?.thumbCamera;
  // `rawColors` renders the mesh's OWN triColors verbatim, bypassing the global
  // paint/region state — used by the offscreen import thumbnail backfill, whose
  // colours are pre-baked per version and must not pick up the live (latest)
  // version's regions.
  const colored = opts.rawColors ? mesh : applyTriColorsIfVisible(mesh);
  try {
    canvas = renderSingleViewCanvas(colored, {
      elevation: pin ? pin.elevation : STANDARD_VIEWS.iso.elevation,
      azimuth: pin ? pin.azimuth : STANDARD_VIEWS.iso.azimuth,
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

/** Per-region paint summary for the runAndSave / saveVersion response: each user
 *  paint region's name, descriptor `kind` (so an agent can confirm it used
 *  `byLabel` rather than coordinate paint — which bloats saved catalog files),
 *  the resolved label for byLabel regions, and the triangle count it resolved to
 *  on the current mesh (0 ⇒ the region matched nothing; see the zero-triangle
 *  warning in `geometryWarnings`). Returns [] when nothing is painted.
 *  Model-declared label colors are excluded — this reflects the serialized
 *  paint, which is what determines file size. */
function colorRegionStats(): { name: string; kind: RegionDescriptor['kind']; label?: string; triangleCount: number }[] {
  return getRegions().map((r) => ({
    name: r.name,
    kind: r.descriptor.kind,
    ...(r.descriptor.kind === 'byLabel' ? { label: r.descriptor.label } : {}),
    triangleCount: r.triangles.size,
  }));
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
      regions.push(cylinderRefineRegion(d.center, d.rMin, d.rMax, d.zMin, d.zMax, d.maxEdge!, d.axis ?? 'z'));
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

interface ResolveResult {
  triangles: Set<number>;
  perTriColors?: Map<number, [number, number, number]>;
}

/** Resolve a single region descriptor to a triangle set on `mesh`. Shared by
 *  rehydration (loading a saved version) and the live rebuild after a smooth
 *  brush stroke changes the working mesh. Returns perTriColors for imagePaint
 *  descriptors (per-triangle color map rebuilt from stored entries). */
function resolveDescriptorTriangles(
  descriptor: RegionDescriptor,
  mesh: MeshData,
  adjacency: AdjacencyGraph | null,
  parentToChildren: Map<number, number[]> | null,
  /** Id of the region being resolved, when known. Used by `colorFlood` to read
   *  the surface color *beneath* itself (excluding its own stamp). */
  selfRegionId?: number,
): ResolveResult {
  switch (descriptor.kind) {
    case 'coplanar': {
      if (!adjacency) return { triangles: new Set<number>() };
      const { seedPoint, seedNormal, normalTolerance } = descriptor;
      const seedTri = resolveSeed(seedPoint, seedNormal, mesh, adjacency, normalTolerance);
      return { triangles: seedTri >= 0 ? findCoplanarRegion(seedTri, adjacency, normalTolerance) : new Set<number>() };
    }
    case 'colorFlood': {
      if (!adjacency) return { triangles: new Set<number>() };
      const { seedPoint, seedColor, colorTolerance } = descriptor;
      // Triangle indices are unstable across re-tessellation; the world-space
      // seed point is not. Find the triangle under it, then magic-wand by color.
      const nearest = findNearestTriangle(seedPoint, mesh, adjacency);
      if (nearest.triIndex < 0) return { triangles: new Set<number>() };
      // Read colors with this region excluded, and anchor on the stored matched
      // color, so the flood follows the *source* color this fill sits on top of.
      const triColors = buildTriColors(mesh.numTri, false, selfRegionId);
      const anchor: [number, number, number] = [
        Math.round(seedColor[0] * 255), Math.round(seedColor[1] * 255), Math.round(seedColor[2] * 255),
      ];
      return { triangles: findColorRegion(nearest.triIndex, adjacency, triColors, colorTolerance, anchor) };
    }
    case 'triangles':
      // Raw ids index the base tessellation; carry them across any subdivision.
      return { triangles: remapTriangleIds(descriptor.ids, parentToChildren) };
    case 'slab': {
      const { normal, offset, thickness } = descriptor;
      return { triangles: findSlabTriangles(mesh, normal, offset, thickness) };
    }
    case 'box': {
      const { center, size, quaternion, shape } = descriptor;
      return { triangles: findShapeTriangles(mesh, shape ?? 'box', { center, size, quaternion }) };
    }
    case 'cylinder': {
      // Same triangle collector `paintInCylinder` uses for the live call —
      // re-resolves the shell against the (possibly subdivided) current mesh
      // so smoothing-driven refinement carries forward across re-runs.
      const { center, rMin, rMax, zMin, zMax, normalCone, coverageMode, maxTriangleArea, axis } = descriptor;
      return { triangles: findCylinderTriangles(mesh, center, rMin, rMax, zMin, zMax, normalCone, coverageMode ?? 'centroid', maxTriangleArea, axis ?? 'z') };
    }
    case 'byLabel': {
      // Labels are runtime state — manifold-3d assigns fresh originalIDs on
      // every run, so we re-resolve by name from the labelMap the engine just
      // built (it indexes the base mesh, hence the remap). Missing label →
      // empty set → region drops silently.
      const ids = currentLabelMap?.get(descriptor.label);
      return { triangles: ids ? remapTriangleIds(ids, parentToChildren) : new Set<number>() };
    }
    case 'connectedFromSeed': {
      if (!adjacency) return { triangles: new Set<number>() };
      const { seedPoint, seedNormal, maxDeviationDeg, clampMin, clampMax } = descriptor;
      // Find the closest triangle to the seed point — robust across re-runs
      // because triangle indices are unstable but world-space points are not.
      // Then BFS-flood gated by deviation from the stored seed normal.
      const nearest = findNearestTriangle(seedPoint, mesh, adjacency);
      if (nearest.triIndex < 0) return { triangles: new Set<number>() };
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
      return { triangles };
    }
    case 'brushStroke':
      return { triangles: strokeFootprintTriangles(mesh, descriptorToStroke(descriptor)) };
    case 'imagePaint':
      // Re-expand the stored [triIdx,r,g,b,…] entries through the subdivision
      // map (children inherit their parent's projected color).
      return entriesToPerTriColors(descriptor.entries, parentToChildren);
    case 'pattern': {
      // Algorithmic colourway: resolve the scope (an api.label region, remapped
      // through subdivision, or the whole mesh), then assign each triangle one
      // palette colour from the field (computePatternColors → perTriColors).
      const label = descriptor.scope?.label;
      let base: Set<number>;
      if (label) {
        const ids = currentLabelMap?.get(label);
        base = ids ? remapTriangleIds(ids, parentToChildren) : new Set<number>();
      } else {
        base = new Set<number>();
        for (let t = 0; t < mesh.numTri; t++) base.add(t);
      }
      const scope = filterScopeTriangles(mesh, base, descriptor.scope);
      return { triangles: scope, perTriColors: computePatternColors(mesh, scope, descriptor) };
    }
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
  // Surface mode is whatever the stroke was painted with (slab by default);
  // old descriptors without the field — and old geodesic-forced sprays —
  // resolve from their stored `surface`, falling back to slab for back-compat.
  const surface = d.surface ?? 'slab';
  const stroke: BrushStroke = {
    samples: d.samples,
    radius: d.radius,
    shape: d.shape,
    maxEdge: d.maxEdge > 0 ? d.maxEdge : d.radius / 256,
    surface,
    depth: d.depth !== undefined && d.depth > 0 ? d.depth : d.radius * 0.5,
    spray: d.spray,
  };
  // Wrap tolerance: a finite gate (< 180°) needs the geodesic reachability field
  // even in slab mode (built alongside the prism's normals). Absent ⇒ 180° (no
  // gate) for strokes saved before the slider — kept byte-identical.
  const wrapAngleDeg = d.wrapAngleDeg ?? 180;
  const maxBendCos = wrapAngleGate(wrapAngleDeg);
  const base = paintBaseMesh ?? currentMeshData;
  if (base) {
    if (surface === 'geodesic') {
      stroke.geoField = buildGeodesicField(base, d.samples, d.radius, maxBendCos);
    } else {
      stroke.sampleNormals = deriveSampleNormals(d.samples, base);
      stroke.sampleTangents = stroke.sampleNormals.map(tangentBasis);
      if (wrapAngleDeg < 180) {
        stroke.geoField = buildGeodesicField(base, d.samples, d.radius, maxBendCos);
      }
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

/** Rehydrate all saved colour regions onto the current mesh.  Smooth imagePaint
 *  stamps are replayed asynchronously (they need to decode a stored image data
 *  URL and re-run the subdivision + stamp algorithm), so this function is async.
 *  All call sites are already in async functions and should `await` the result. */
async function rehydrateColorRegions(geometryData: Record<string, unknown> | null): Promise<{ carried: string[]; dropped: string[] }> {
  // Drop any in-flight worker job before we wipe + replace the region store;
  // otherwise its continuation could overwrite the freshly-rehydrated mesh
  // and stamp triangles onto regions that no longer exist.
  resetPaintWorkerState();
  clearRegions();

  const report: { carried: string[]; dropped: string[] } = { carried: [], dropped: [] };
  if (!geometryData || !currentMeshData) {
    // Nothing to colour against yet; still finalize the model underlay so a
    // bare-mesh restore doesn't strand code-declared colours unrendered.
    renderModelColorUnderlay();
    return report;
  }
  const regions = geometryData.colorRegions as SerializedColorRegion[] | undefined;
  if (!regions || regions.length === 0) {
    // No user paint to restore — but the model-declared colour underlay
    // (api.label / api.paint) still needs to be drawn. This function is the
    // single authority that finalizes a restored part's colours for EVERY load
    // path (cache hit, cache miss, loadVersion, navigateVersion), so neither
    // branch needs its own colour stamp — the class of "a restore path forgot
    // to apply colours" bug can't recur. A model-only part never subdivides, so
    // currentMeshData and the model regions' triangle indices stay aligned.
    renderModelColorUnderlay();
    return report;
  }

  // Partition: smooth imagePaint regions with a stored imageDataUrl are replayed
  // sequentially below (they drive their own subdivision pass each). All other
  // regions go through the standard combined refinement pipeline.
  const smoothImageStamps = regions.filter(r =>
    r.descriptor.kind === 'imagePaint' && r.descriptor.smooth && r.descriptor.imageDataUrl && r.descriptor.maxEdge,
  );
  const standardRegions = regions.filter(r => !smoothImageStamps.includes(r));

  // Refine the pristine base mesh under any smooth strokes/slabs/shapes before
  // resolving. Without refine regions this is a no-op and currentMeshData is
  // left untouched (identical to the pre-subdivision behavior).
  const base = paintBaseMesh ?? currentMeshData;
  const { mesh, parentToChildren } = refineMeshForRegions(base, standardRegions.map(r => r.descriptor));
  if (parentToChildren) {
    currentMeshData = mesh;
    updatePaintMesh(mesh);
  }
  const adjacency = buildAdjacency(mesh);

  // Bulk-add the resolved standard regions without letting each addRegion
  // trigger a reconcile (we've already built the mesh here).
  suspendReconcile = true;
  for (const region of standardRegions) {
    const { triangles, perTriColors } = resolveDescriptorTriangles(region.descriptor, mesh, adjacency, parentToChildren, region.id);
    if (triangles.size > 0) {
      addRegion(region.name, region.color, region.source, region.descriptor, triangles, region.visible !== false, region.slotId, perTriColors);
      report.carried.push(region.name);
    } else {
      report.dropped.push(region.name);
    }
  }
  suspendReconcile = false;

  // Replay smooth imagePaint stamps in order. Each stamp call updates
  // currentMeshData and paintBaseMesh via the callback's side effects, so
  // sequential stamps (M0→M1→M2→M3) accumulate correctly.
  if (smoothImageStamps.length > 0 && smoothReplayCb) {
    suspendReconcile = true;
    for (const region of smoothImageStamps) {
      const d = region.descriptor as Extract<RegionDescriptor, { kind: 'imagePaint' }>;
      if (!d.imageDataUrl || !d.hitPoint || !d.hitNormal || !d.stampSize || !d.maxEdge) {
        report.dropped.push(region.name);
        continue;
      }
      try {
        const imageData = await loadImageDataFromUrl(d.imageDataUrl);
        const stampOpts = {
          hitPoint: d.hitPoint,
          hitNormal: d.hitNormal,
          size: d.stampSize,
          rotationDeg: d.rotationDeg ?? 0,
          preprocess: { brightness: 0, contrast: 0, saturation: 0, levelsLow: 0, levelsHigh: 255 },
          removeBackground: d.removeBackground ?? false,
          ...(d.manualBgColor ? { manualBgColor: d.manualBgColor } : {}),
          bgTolerance: d.bgTolerance ?? 36 * 36 * 3,
        };
        const refined = smoothReplayCb(imageData, stampOpts, d.maxEdge);
        if (refined && refined.result.entries.length > 0) {
          const triangles = new Set(refined.result.perTriColors.keys());
          addRegion(region.name, region.color, region.source, d, triangles, region.visible !== false, region.slotId, refined.result.perTriColors);
          report.carried.push(region.name);
        } else {
          report.dropped.push(region.name);
        }
      } catch {
        report.dropped.push(region.name);
      }
    }
    suspendReconcile = false;
  } else {
    // No smooth imagePaint stamps to replay; log any that lacked imageDataUrl
    // (old sessions saved before this mechanism existed).
    for (const region of smoothImageStamps) {
      report.dropped.push(region.name);
    }
  }

  lastStrokeList = getRegions().map(r => r.descriptor).filter(d => d.kind === 'brushStroke');
  markMeshRefineState();

  syncLockState();

  // Re-render with colors if any region layer is present (user paint and/or the
  // model-declared underlay — applyTriColorsIfVisible stamps both).
  if ((hasColorRegions() || hasModelColorRegions()) && currentMeshData) {
    const colored = applyTriColorsIfVisible(currentMeshData);
    updateMesh(colored, { skipAutoFrame: true });
  }

  return report;
}

/** Load a version's saved colour-region *descriptors* into the store WITHOUT
 *  resolving them against a mesh (empty triangle sets). Used when a version
 *  load can't finish its render — most importantly when the user cancels the
 *  slow initial render of a catalog figure. Without this, the cancel skips
 *  rehydrateColorRegions entirely (it needs a finished mesh + labelMap to
 *  resolve `byLabel` regions), so the figure's colours never enter memory: a
 *  subsequent Save then serialises the empty store over the version's colours
 *  (permanent loss), and the next edit→rerender shows a colourless model.
 *
 *  Staging the descriptors fixes both: `serialize()` persists descriptors (not
 *  triangles), so a Save keeps the colours, and runCodeSync re-resolves every
 *  in-memory region against the freshly-rendered mesh+labelMap on the next run,
 *  so the colours reappear. Regions that genuinely no longer match just resolve
 *  to 0 triangles, exactly as the normal reconcile path already tolerates. */
function stageUnresolvedColorRegions(geometryData: Record<string, unknown> | null): void {
  resetPaintWorkerState();
  clearRegions();
  const regions = geometryData?.colorRegions as SerializedColorRegion[] | undefined;
  if (!regions || regions.length === 0) {
    syncLockState();
    return;
  }
  suspendReconcile = true;
  for (const region of regions) {
    addRegion(region.name, region.color, region.source, region.descriptor, new Set<number>(), region.visible !== false, region.slotId);
  }
  suspendReconcile = false;
  syncLockState();
}

/** Draw `currentMeshData` with the model-declared colour underlay (api.label /
 *  api.paint) applied — or the plain mesh when the model declares no colours.
 *  The shared "show model colours" step for restore paths: a no-op for an
 *  uncoloured model (applyTriColorsIfVisible returns the mesh unchanged when no
 *  regions exist), so it's always safe to call. User paint is layered on top by
 *  rehydrateColorRegions' main path. */
function renderModelColorUnderlay(): void {
  if (!currentMeshData) return;
  if (hasModelColorRegions()) {
    updateMesh(applyTriColorsIfVisible(currentMeshData), { skipAutoFrame: true });
  }
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
    const { triangles, perTriColors } = resolveDescriptorTriangles(region.descriptor, mesh, adjacency, parentToChildren, region.id);
    setRegionTriangles(region.id, triangles, perTriColors);
  }
  reresolveModelRegions(mesh, adjacency, parentToChildren);
  paintedColorRefresh();
  syncLockState();
  markMeshRefineState();
}

/** Re-resolve the code-declared color underlay (`api.label({color})` /
 *  `api.paint.*`) against a (possibly subdivided) mesh. The refine paths
 *  subdivide the working mesh to follow smooth user strokes, which invalidates
 *  the underlay's triangle indices unless we re-resolve them here from their
 *  descriptors — geometric selectors against `mesh` directly, byLabel through
 *  `parentToChildren` from the run's labelMap. No-op when no underlay exists. */
function reresolveModelRegions(mesh: MeshData, adjacency: AdjacencyGraph | null, parentToChildren: Map<number, number[]> | null): void {
  for (const region of getModelRegions()) {
    const d = region.descriptor;
    // Across an *incremental* subdivision (parentToChildren present), explicit and
    // byLabel model regions must carry their current triangle set forward via the
    // parent→children map — exactly like the paint regions above. Re-resolving a
    // byLabel descriptor here would remap `currentLabelMap` (which indexes the
    // BASE mesh) through a CURRENT-mesh parent map, so its coverage collapses onto
    // a shrinking, wrong cluster with each stroke (the api.label underlay then
    // leaks through wherever paint doesn't cover). On a full rebuild
    // (parentToChildren === null) currentLabelMap matches the freshly-built mesh,
    // so re-resolving by descriptor is correct.
    if (parentToChildren && (d.kind === 'byLabel' || d.kind === 'triangles')) {
      setModelRegionTriangles(region.id, remapTriangleIds(region.triangles, parentToChildren));
    } else {
      const { triangles } = resolveDescriptorTriangles(d, mesh, adjacency, parentToChildren, region.id);
      setModelRegionTriangles(region.id, triangles);
    }
  }
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
      setRegionTriangles(region.id, remapTriangleIds(region.triangles, parentToChildren), remapPerTriColors(region.perTriColors, parentToChildren));
    } else {
      if (!adjacency && (d.kind === 'coplanar' || d.kind === 'connectedFromSeed' || d.kind === 'colorFlood')) adjacency = buildAdjacency(mesh);
      const { triangles, perTriColors } = resolveDescriptorTriangles(d, mesh, adjacency, parentToChildren, region.id);
      setRegionTriangles(region.id, triangles, perTriColors);
    }
  }
  reresolveModelRegions(mesh, adjacency, parentToChildren);
  paintedColorRefresh();
  syncLockState();
  markMeshRefineState();
}

function strokeDescriptors(): RegionDescriptor[] {
  return getRegions().map(r => r.descriptor).filter(d => d.kind === 'brushStroke');
}

/** Subdivision-driving descriptors in region order (see `descriptorRefines`) —
 *  the snapshot the cheap-reconcile fast path compares against `meshRefineList`. */
function currentRefineList(): RegionDescriptor[] {
  return getRegions().filter(r => descriptorRefines(r.descriptor)).map(r => r.descriptor);
}

/** True when `a` holds exactly the entries of `b` by reference (same refine
 *  descriptors, same order) — i.e. nothing that affects subdivision changed. */
function sameRefineList(a: RegionDescriptor[], b: RegionDescriptor[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** Snapshot the refine set the current working mesh now reflects. Call after
 *  any path that (re)builds or reverts the working mesh. */
function markMeshRefineState(): void {
  meshRefineList = currentRefineList();
  meshRefineForMesh = currentMeshData;
}

/** True when the working mesh still matches its refine snapshot — same mesh
 *  object and the same refine-driving descriptors — so a change can be
 *  reconciled by recolouring instead of re-subdividing. */
function refineSetUnchanged(): boolean {
  return currentMeshData === meshRefineForMesh && sameRefineList(currentRefineList(), meshRefineList);
}

/** Cheap reconcile for a change that doesn't alter the refine set: the working
 *  mesh's topology is already correct, so resolve any not-yet-resolved regions
 *  against it and recolour — no worker subdivision, no progress modal. This is
 *  what keeps painting instant once smooth strokes exist (and makes turning
 *  edge smoothing off actually speed subsequent strokes up). */
function reresolveRegionsAgainstCurrentMesh(): void {
  const mesh = currentMeshData;
  if (!mesh) return;
  let adjacency: AdjacencyGraph | null = null;
  for (const region of getRegions()) {
    const d = region.descriptor;
    // Explicit/byLabel sets and already-resolved regions are valid in the
    // current mesh's index space (topology unchanged) — only a freshly-added
    // geometric/flood region with no triangles yet needs resolving.
    if (d.kind === 'triangles' || d.kind === 'byLabel' || region.triangles.size > 0) continue;
    if (!adjacency && (d.kind === 'coplanar' || d.kind === 'connectedFromSeed' || d.kind === 'colorFlood')) adjacency = buildAdjacency(mesh);
    const { triangles, perTriColors } = resolveDescriptorTriangles(d, mesh, adjacency, null, region.id);
    setRegionTriangles(region.id, triangles, perTriColors);
  }
  reresolveModelRegions(mesh, adjacency, null);
  paintedColorRefresh();
  syncLockState();
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
    markMeshRefineState();
    // Mirror the async tick (see reconcilePaintedGeometryAsyncTick) — color
    // mutations from the Edit colors panel must refresh the mesh even when
    // the Paint UI is closed.
    paintedColorRefresh();
    return;
  }
  // Refine set unchanged — re-resolve against the current mesh, skip the heavy
  // rebuild (mirrors the async tick's fast path).
  if (refineSetUnchanged()) {
    reresolveRegionsAgainstCurrentMesh();
    lastStrokeList = strokesNow;
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
    markMeshRefineState();
    // Re-bake per-triangle colours regardless of whether the Paint UI is
    // open — the Relief Studio's Edit colors panel also mutates regions
    // (updateRegionColor / removeRegion) and the user expects the model to
    // update in realtime from there too. paintedColorRefresh is a no-op
    // when there are no regions or paint visibility is off, so calling it
    // unconditionally is cheap.
    paintedColorRefresh();
    return;
  }

  // Refine set unchanged → the working mesh's topology already reflects every
  // subdivision-driving descriptor. A change that doesn't touch that set (a
  // non-smooth stroke, a colour edit, removing a non-refine region) only needs
  // regions re-resolved against the current mesh + a recolour — NOT a full
  // worker re-subdivision (and no progress modal). This is what keeps painting
  // instant once a smooth stroke exists, so turning edge smoothing off actually
  // speeds the next strokes up instead of leaving every one to rebuild.
  if (refineSetUnchanged()) {
    reresolveRegionsAgainstCurrentMesh();
    lastStrokeList = strokesNow;
    return;
  }

  // Pure append: one new stroke at the end, prior strokes unchanged.
  if (strokesNow.length === lastStrokeList.length + 1 && prefixRefEqual(strokesNow, lastStrokeList)) {
    const newDesc = strokesNow[strokesNow.length - 1] as Extract<RegionDescriptor, { kind: 'brushStroke' }>;
    // Track this in-flight stroke's region so a user Cancel (or the modal's
    // "turn off smoothing" action) drops exactly it. The agent paint path sets
    // this itself via paintBrushStrokeSync; the UI brush path didn't, so a
    // cancelled UI stroke used to leave a dead, empty brushStroke region that
    // still forced re-subdivision on every later paint.
    const newRegion = getRegions().find(r => r.descriptor === newDesc);
    if (newRegion) pendingStrokeRegionId = newRegion.id;
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

/** The "did you know you can speed this up" extras for the paint-refine
 *  progress modal: a tip line plus a one-click "Stop & turn off smoothing"
 *  button. Only offered when brush edge smoothing is currently on — that
 *  subdivision is the usual reason a stroke takes multiple seconds. The button
 *  doubles as Cancel (it aborts the in-flight job) AND turns smoothing off so
 *  the next stroke paints instantly. Returns `{}` when smoothing is already off
 *  (e.g. a spray stroke is what's refining) so we never offer a no-op. */
function paintRefineSmoothingExtras(abort: AbortController): {
  hint?: string;
  secondaryAction?: { label: string; onClick: () => void };
} {
  if (!isPaintBrushSmooth()) return {};
  return {
    hint: 'Edge smoothing refines the mesh under each stroke — turn it off for faster painting.',
    secondaryAction: {
      label: 'Stop & turn off smoothing',
      onClick: () => {
        abort.abort();
        setPaintBrushSmooth(false);
        showToast('Edge smoothing turned off — painting will be faster', { variant: 'neutral' });
      },
    },
  };
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
    ...paintRefineSmoothingExtras(abort),
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
        setRegionTriangles(region.id, remapTriangleIds(region.triangles, parentToChildren), remapPerTriColors(region.perTriColors, parentToChildren));
      } else {
        if (!adjacency && (d.kind === 'coplanar' || d.kind === 'connectedFromSeed' || d.kind === 'colorFlood')) adjacency = buildAdjacency(mesh);
        const { triangles, perTriColors } = resolveDescriptorTriangles(d, mesh, adjacency, parentToChildren, region.id);
        setRegionTriangles(region.id, triangles, perTriColors);
      }
    }
    reresolveModelRegions(mesh, adjacency, parentToChildren);
    paintedColorRefresh();
    syncLockState();
    markMeshRefineState();
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
    ...paintRefineSmoothingExtras(abort),
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
        const { triangles, perTriColors } = resolveDescriptorTriangles(d, mesh, adjacency, parentToChildren, region.id);
        setRegionTriangles(region.id, triangles, perTriColors);
      }
    }
    reresolveModelRegions(mesh, adjacency, parentToChildren);
    paintedColorRefresh();
    syncLockState();
    markMeshRefineState();
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
  // The orphan stroke was dropped and the mesh reverted to its pre-stroke
  // state, so the refine set the working mesh reflects has shrunk — resnapshot
  // it (otherwise the next non-refine change would needlessly full-rebuild).
  markMeshRefineState();
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
  | { id: string; index: number; label: string; colorRegions?: ReturnType<typeof colorRegionStats> }
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
  const version = await saveVersion(getValue(), enrichGeometryDataWithColors(getGeometryDataObj()), thumbnail, label, undefined, { paramValues: currentParamValues, companionFiles: getCompanionFiles(), surfaceTexture: currentSurfaceTextureForSave() });
  if (version) {
    // Keep the mesh cache valid for the newly-saved version so that switching
    // away and back doesn't trigger a recompile. The code/geometry didn't
    // change (only paint or annotations may have), so the current in-memory
    // mesh is still correct for the new version id.
    // Cache the coarse pre-refinement base mesh (paintBaseMesh) so that
    // rehydrateColorRegions can re-apply paint correctly on switch-back
    // rather than re-refining an already-refined mesh.
    const meshToCache = paintBaseMesh ?? currentMeshData;
    if (meshToCache) {
      const entry: PartMeshCacheEntry = {
        meshData: meshToCache,
        labelMap: currentLabelMap,
        lostLabels: currentLostLabels,
        modelColorDecls: getModelRegions().map(r => ({ name: r.name, color: r.color, triangles: new Set(r.triangles), descriptor: r.descriptor })),
        paramsSchema: currentParamSchema ?? undefined,
      };
      partMeshCache.delete(version.id);
      partMeshCache.set(version.id, entry);
      if (partMeshCache.size > PART_MESH_CACHE_SIZE) {
        const oldest = partMeshCache.keys().next().value;
        if (oldest) partMeshCache.delete(oldest);
      }
    }
    const colorRegions = colorRegionStats();
    return {
      id: version.id, index: version.index, label: version.label,
      ...(colorRegions.length > 0 ? { colorRegions } : {}),
    };
  }
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
  // 0-based index into the parts as listParts() returns them (sorted by order).
  // Lets a caller address "the second part" without first looking up its id.
  if (typeof target === 'number') {
    if (!Number.isInteger(target) || target < 0) {
      return { error: `${caller}: index must be a non-negative integer.` };
    }
    const ordered = [...parts].sort((a, b) => a.order - b.order);
    const part = ordered[target];
    if (!part) return { error: `${caller}: no part at index ${target}. Use listParts() to see available parts.` };
    return part;
  }
  // A bare string is ambiguous between an id and a human-facing name, so try
  // both (id first — ids are unique). Object form keeps the field explicit.
  if (typeof target === 'string') {
    if (target.length === 0) return { error: `${caller}: part must be a non-empty string.` };
    const part = parts.find(p => p.id === target) ?? parts.find(p => p.name === target);
    if (!part) return { error: `${caller}: no part matching ${JSON.stringify(target)} (by id or name). Use listParts() to see available parts.` };
    return part;
  }
  let id: string | undefined;
  let name: string | undefined;
  if (target && typeof target === 'object') {
    ({ id, name } = target as { id?: string; name?: string });
  } else {
    return { error: `${caller}(target): pass a part name, id string, or 0-based index — or { id } / { name } from listParts().` };
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

// The app-relative route for the current URL, with the deployment base
// (`/`, `/v2/`, …) stripped — so route predicates compare against bare routes
// ('/editor', '/help') regardless of where this major is mounted. A no-op at
// base `/`. See src/deployment.ts.
function currentRoute(): string {
  return appRoute(window.location.pathname);
}

// Like appHistory's currentURLPathAndSearch(), but with the deployment base
// stripped — so "did we arrive here from elsewhere in the app" back-target
// checks compare against bare routes ('/help') regardless of the /vN/ mount.
// A no-op at base `/`.
function currentRouteAndSearch(): string {
  return `${currentRoute()}${window.location.search}`;
}

// Determine which page to show based on URL path and query params
function shouldShowLanding(): boolean {
  const path = currentRoute();
  const params = new URLSearchParams(window.location.search);
  // Landing if at root path AND no query params that indicate a specific view
  // AND no share-link hash (a bare `/#share=…` must open the shared preview, not
  // the landing page).
  const isRootPath = path === '/';
  return isRootPath && !hasShareHash() && !params.has('view') && !params.has('session') && !params.has('gallery') && !params.has('versions') && !params.has('images') && !params.has('diff') && !params.has('notes') && !params.has('data');
}

function shouldShowHelp(): boolean {
  // A `/help#share=…` link must open the shared preview (editor), not Help —
  // mirrors shouldShowLanding's share-hash exclusion.
  return currentRoute() === '/help' && !hasShareHash();
}

function shouldShowCatalog(): boolean {
  return currentRoute() === '/catalog' && !hasShareHash();
}

function shouldShowIdeas(): boolean {
  return currentRoute() === '/ideas' && !hasShareHash();
}

function shouldShowWhatsNew(): boolean {
  return currentRoute() === '/whats-new';
}

function shouldShowLegal(): boolean {
  return currentRoute() === '/legal';
}

function shouldShow404(): boolean {
  if (hasShareHash()) return false;
  const path = currentRoute();
  return path !== '/' && path !== '/help' && path !== '/editor' && path !== '/catalog' && path !== '/ideas' && path !== '/legal' && path !== '/whats-new';
}

/** True when the editor view is the active page. Editor-scoped command-palette
 *  actions (tab switches, the guided tour) gate on this so they don't fire from
 *  the landing / help / catalog pages — which would rewrite the URL to
 *  `/editor?…` and toggle hidden panes without ever transitioning into the
 *  editor. A `#share=…` link also lands in the editor, so it counts too. */
function isEditorActive(): boolean {
  return currentRoute() === '/editor' || hasShareHash();
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

  // Remove loading overlays as soon as JS takes over. (/ideas is served as a
  // static, app-free page now, so there's no boot-spinner special-case here —
  // a soft-nav to the in-app ideas overlay happens after boot.)
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
    // Import the session STRUCTURE first, without regenerating any thumbnails.
    // Regenerating a thumbnail runs that version's code through WASM (seconds
    // apiece for a complex figure), and doing it inside importSession deferred
    // the notify()/selection + editor swap until the whole loop finished. The
    // user saw the new geometry render into the viewport while the OLD part
    // stayed selected and the OLD code lingered in the editor for seconds. So we
    // now create + select the session and load its latest version immediately,
    // then backfill the missing thumbnails offscreen in the background. Embedded
    // thumbnails (when the export carried them) are still restored by
    // importSession; only versions exported without one need the backfill.
    const session = await importSession(data);
    const version = await openSession(session.id);
    if (version) {
      // Skip surface texture computation during import — the surface Worker
      // (voronoi/knurl/woven) can take 30–120s on complex models and would block
      // the load. Textures apply on the first user-triggered run.
      await loadVersionIntoEditor(version, { skipSurface: true });
      // The latest version is now rendered live with full colour (model labels
      // AND user paint), so snapshot its thumbnail straight from that state —
      // the most accurate tile for the version the user is actually looking at,
      // and it lets the backfill below skip re-running this one.
      if (!version.thumbnail) {
        const thumb = await captureThumbnail();
        if (thumb) await updateVersionThumbnail(version.id, thumb);
      }
    }
    // Fire-and-forget: render a snapshot for each remaining version that
    // imported without a thumbnail. Runs AFTER the user is already on the new
    // part, fully offscreen, so it never disturbs the live viewport or editor.
    void backfillImportedThumbnails(session.id);
    return { sessionId: session.id };
  }

  // Build the model-declared colour layer (api.label({color}) + optionally
  // api.paint.* ops) for a run/preview result, resolving every triangle set
  // against THIS result's own mesh + labelMap — no global state. Shared by the
  // offscreen-thumbnail bake and the fast-preview colouring below.
  function buildModelColorLayer(result: MeshResult, includePaintOps: boolean): ColorRegion[] {
    const mesh = result.mesh;
    if (!mesh) return [];
    const { labelColors, labelMap, paintOps } = result;
    const layer: ColorRegion[] = [];
    let order = 0;
    if (labelColors && labelMap && labelColors.size > 0) {
      for (const [name, color] of labelColors) {
        const tris = labelMap.get(name);
        if (!tris || tris.size === 0) continue;
        layer.push({
          id: order, name, color, source: 'model',
          descriptor: { kind: 'triangles', ids: [...tris] },
          order: order++, visible: true, triangles: tris,
        });
      }
    }
    if (includePaintOps && paintOps && paintOps.length > 0) {
      // resolvePaintOps is the pure resolver `model:preview` uses — it covers
      // every kind api.paint.* can record (slab / box / cylinder / byLabel) with
      // no adjacency or global state, and resolves byLabel from THIS result's
      // labelMap (not the global currentLabelMap, which still indexes the
      // previous full render during the preview window).
      for (const op of resolvePaintOps(paintOps, mesh, labelMap)) {
        if (op.triangles.size === 0) continue;
        layer.push({
          id: order, name: op.name, color: op.color, source: 'model',
          descriptor: { kind: 'triangles', ids: [...op.triangles] },
          order: order++, visible: true, triangles: op.triangles,
        });
      }
    }
    return layer;
  }

  // Bake a run's model-declared colours into a standalone coloured MeshData,
  // touching no global paint/region state. Reuses composeTriColors — the same
  // stamping the live model-colour underlay uses — so the result matches what
  // the live pipeline would paint, minus the user's manual paint regions (which
  // index the live tessellation and aren't resolvable off-state here).
  //
  // Always resolves api.label(shape, name, {color}). When `includePaintOps` is
  // set it ALSO resolves api.paint.* ops (box / slab / cylinder / byLabel)
  // against this result's own mesh + labelMap — used by the fast-preview path so
  // the coarse mesh shows in-code paint too. Backfilled thumbnails leave it off:
  // a paint-only model's historical-version thumbnail shades by normal (the live
  // latest version always renders through the full pipeline with colour), and
  // resolving descriptors over many offscreen versions would build adjacency per
  // op for no gallery benefit.
  function colorMeshFromModel(result: MeshResult, includePaintOps = false): MeshData | null {
    const mesh = result.mesh;
    if (!mesh) return null;
    const layer = buildModelColorLayer(result, includePaintOps);
    if (layer.length === 0) return mesh;
    const triColors = composeTriColors(mesh.numTri, [layer], { baseColors: mesh.triColors ?? null });
    return triColors ? { ...mesh, triColors } : mesh;
  }

  // Colour the coarse FAST-PREVIEW mesh as faithfully as the rough tessellation
  // allows: the model-declared underlay (above) PLUS the user's saved paint
  // regions whose descriptors re-resolve geometrically — byLabel and the
  // box/slab/cylinder selectors. This is what makes a painted catalog figure
  // (whose colours live in saved `byLabel` regions, not in code) show colour on
  // the preview instead of bare grey. `resolvePaintDescriptor` returns a triangle
  // set for exactly those kinds and `null` for the index/seed-dependent ones
  // (brush strokes, coplanar, colorFlood, raw triangle ids) — which can't map
  // onto the coarse mesh and correctly fill in only with the full render. No
  // global state is touched: each region is re-resolved against THIS coarse mesh,
  // so stale full-mesh indices never stamp the wrong triangles.
  function colorCoarsePreview(result: MeshResult): MeshData {
    const mesh = result.mesh!;
    const modelLayer = buildModelColorLayer(result, true);
    const userLayer: ColorRegion[] = [];
    for (const region of getRegions()) {
      if (region.visible === false) continue;
      const triangles = resolvePaintDescriptor(region.descriptor, mesh, result.labelMap ?? null);
      if (!triangles || triangles.size === 0) continue;
      userLayer.push({ ...region, triangles, descriptor: { kind: 'triangles', ids: [...triangles] } });
    }
    if (modelLayer.length === 0 && userLayer.length === 0) return mesh;
    // Same layer order as the live compositor (buildTriColors): model underlay
    // first, the user's manual paint on top.
    const triColors = composeTriColors(mesh.numTri, [modelLayer, userLayer], { baseColors: mesh.triColors ?? null });
    return triColors ? { ...mesh, triColors } : mesh;
  }

  // Render + persist a thumbnail for every version (in the given parts) that
  // arrived without one (default exports omit thumbnails). Runs AFTER the
  // session/part is selected and its latest version loaded, so the new part
  // appears immediately rather than waiting on these WASM runs. Each version
  // executes OFFSCREEN via executeCodeAsync (no updateMesh → no viewport flicker)
  // with its own imports + companion files passed explicitly, so the live
  // active-imports register is never touched. Bails as soon as the user
  // navigates away from the session.
  //
  // Backfill execs share the single engine Worker with live user runs. They
  // carry per-version imports/companions explicitly, so a manifold-js/SCAD run
  // can't read stale module state — but the replicad engine retains the last
  // tessellated BREP shape in Worker scope for `exportSTEP`, so a backfill of an
  // older replicad version landing between a live run and a manual STEP export
  // could export the wrong shape. Rare (same-session, bounded, STEP-during-import
  // is unusual) and self-corrects on the next live run; not guarded here.
  async function backfillThumbnailsForParts(sessionId: string, partIds: string[]): Promise<void> {
    let wrote = false;
    try {
      for (const partId of partIds) {
        const versions = await listVersions(partId);
        for (const v of versions) {
          // Stop the moment the user leaves the session — don't tie up the
          // engine Worker rendering snapshots nobody is waiting on.
          if (getState().session?.id !== sessionId) return;
          if (v.thumbnail) continue;
          let result: MeshResult;
          try {
            result = await executeCodeAsync(
              v.code,
              effectiveVersionLanguage(v, getState().session),
              v.paramValues,
              undefined,
              (v.importedMeshes ?? []) as ImportedMesh[],
              v.companionFiles,
            );
          } catch {
            // Worker restarted (a live run cancelled it) or an engine fault —
            // skip this one; the gallery keeps its placeholder.
            continue;
          }
          if (!result.mesh) continue;
          const thumbnail = await captureThumbnail(colorMeshFromModel(result), { rawColors: true });
          if (!thumbnail) continue;
          await updateVersionThumbnail(v.id, thumbnail);
          wrote = true;
        }
      }
    } catch {
      // Best-effort — keep whatever thumbnails we managed to persist.
    }
    // Refresh the gallery (if open) so new thumbnails replace placeholders
    // without a manual reopen. Guarded so we don't redraw a session the user has
    // since navigated away from.
    if (wrote && getState().session?.id === sessionId) {
      window.dispatchEvent(new CustomEvent('session-changed', { detail: getState() }));
    }
  }

  // New-session import: backfill thumbnails across all of the imported session's
  // parts (it owns the whole session, so every part is fair game).
  async function backfillImportedThumbnails(sessionId: string): Promise<void> {
    const parts = await listParts(sessionId);
    await backfillThumbnailsForParts(sessionId, parts.map(p => p.id));
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
  async function importCodePayload(code: string, language: Language, sessionName?: string, companions?: Record<string, string>): Promise<{ sessionId: string }> {
    if (language !== getActiveLanguage()) await switchLanguage(language);
    const session = await createSession(sessionName, language);
    // Register companions right after session creation so their tabs appear in
    // the bar immediately — before the (potentially slow) first compile. createSession
    // calls setCompanionFiles({}) internally, so companions must be re-applied here.
    if (companions && Object.keys(companions).length > 0) {
      for (const [path, content] of Object.entries(companions)) {
        addCompanionFileToRegistry(path, content);
      }
      renderCompanionFilesBar();
    }
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
    document.getElementById('relief-viewport-toggle')?.classList.remove('hidden');
    reliefStudio.show();
    reliefStudio.refresh();
  }

  function closeReliefStudio(): void {
    if (!reliefStudio) return;
    reliefStudio.hide();
    if (studioCollapsedEditor) { expandEditor(); studioCollapsedEditor = false; }
  }

  function toggleReliefStudio(): void {
    if (!reliefStudio) return;
    if (reliefStudio.isOpen()) closeReliefStudio();
    else showReliefStudio();
  }

  // Show/hide the studio in response to a session change. Keeps the panel from
  // hovering over an unrelated session, and re-syncs the preview mode pills
  // from the new session's saved settings.
  function syncReliefStudioForSession(): void {
    if (!reliefStudio) return;
    const sid = getState().session?.id ?? null;
    const isRelief = isReliefSession(sid);
    document.getElementById('relief-viewport-toggle')?.classList.toggle('hidden', !isRelief);
    if (isRelief) showReliefStudio();
    else {
      if (reliefStudio.isOpen()) reliefStudio.hide();
      if (studioCollapsedEditor) { expandEditor(); studioCollapsedEditor = false; }
    }
  }

  // Validate the optional sub-objects an AI/console caller may pass to
  // importImageAsRelief / importSvgAsRelief. The clamp* helpers below tolerate
  // bad numerics by falling back to defaults, but the rest of the
  // window.partwright API rejects unknown keys and wrong types outright
  // (CLAUDE.md: "unknown keys rejected") so a typo like `{ widthToDeep: 100 }`
  // is loud rather than silently ignored. Throws ValidationError; callers wrap
  // this in guard() to surface it as { error }. The numeric bounds mirror the
  // clamp* ranges below.
  const RELIEF_COMMON_KEYS = ['widthMm', 'layerHeight', 'baseThickness', 'maxHeight', 'resolution', 'smoothing', 'removeBackground'] as const;
  const RELIEF_QUANTIZED_KEYS = ['clusters', 'colorSpace', 'dither', 'fixedPalette', 'output', 'shape', 'cornerRadiusMm', 'chamferMm', 'paintingMode', 'invertHeights', 'holes', 'holeEnabled', 'holeDiameterMm', 'holeOffsetMm', 'manualBackground', 'doubleSided', 'backMirror'] as const;
  const RELIEF_PREPROCESS_KEYS = ['brightness', 'contrast', 'saturation', 'levelsLow', 'levelsHigh'] as const;
  const RELIEF_CROP_KEYS = ['left', 'top', 'right', 'bottom'] as const;
  function validateReliefOptionArgs(args: { options?: unknown; quantized?: unknown; preprocess?: unknown; crop?: unknown }, fn: string): void {
    if (args.options !== undefined) {
      const o = assertObject(args.options, `${fn}(options)`)!;
      assertNoUnknownKeys(o, RELIEF_COMMON_KEYS, `${fn}(options)`);
      assertNumber(o.widthMm, `${fn}(options).widthMm`, { optional: true, min: 1, max: 2000 });
      assertNumber(o.layerHeight, `${fn}(options).layerHeight`, { optional: true, min: 0.02, max: 2 });
      assertNumber(o.baseThickness, `${fn}(options).baseThickness`, { optional: true, min: 0, max: 50 });
      assertNumber(o.maxHeight, `${fn}(options).maxHeight`, { optional: true, min: 0.1, max: 100 });
      assertNumber(o.resolution, `${fn}(options).resolution`, { optional: true, min: 8, max: 512 });
      assertNumber(o.smoothing, `${fn}(options).smoothing`, { optional: true, min: 0, max: 20 });
      assertBoolean(o.removeBackground, `${fn}(options).removeBackground`, { optional: true });
    }
    if (args.quantized !== undefined) {
      const q = assertObject(args.quantized, `${fn}(quantized)`)!;
      assertNoUnknownKeys(q, RELIEF_QUANTIZED_KEYS, `${fn}(quantized)`);
      assertNumber(q.clusters, `${fn}(quantized).clusters`, { optional: true, min: 2, max: 12, integer: true });
      if (q.colorSpace !== undefined) assertEnum(q.colorSpace, ['rgb', 'lab'], `${fn}(quantized).colorSpace`);
      assertBoolean(q.dither, `${fn}(quantized).dither`, { optional: true });
      if (q.output !== undefined) assertEnum(q.output, ['relief', 'flat', 'silhouette'], `${fn}(quantized).output`);
      if (q.shape !== undefined) assertEnum(q.shape, ['rect', 'rounded', 'circle'], `${fn}(quantized).shape`);
      assertNumber(q.cornerRadiusMm, `${fn}(quantized).cornerRadiusMm`, { optional: true, min: 0, max: 50 });
      assertNumber(q.chamferMm, `${fn}(quantized).chamferMm`, { optional: true, min: 0, max: 5 });
      if (q.paintingMode !== undefined) assertEnum(q.paintingMode, ['multi-color', 'single-nozzle'], `${fn}(quantized).paintingMode`);
      assertBoolean(q.invertHeights, `${fn}(quantized).invertHeights`, { optional: true });
      assertBoolean(q.doubleSided, `${fn}(quantized).doubleSided`, { optional: true });
      assertBoolean(q.backMirror, `${fn}(quantized).backMirror`, { optional: true });
      // "Constrain to filament palette": an array of [r,g,b] 0–255 triples each
      // cell snaps to. The clamp re-sanitises, but reject the obviously-wrong
      // shape here so a typo is loud rather than silently ignored.
      if (q.fixedPalette !== undefined) {
        const pal = q.fixedPalette;
        const ok = Array.isArray(pal) && pal.every(c =>
          Array.isArray(c) && c.length === 3 && c.every(n => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 255));
        if (!ok) throw new ValidationError(`${fn}(quantized).fixedPalette must be an array of [r,g,b] triples (0–255). See /ai.md#argument-validation`);
      }
    }
    if (args.preprocess !== undefined) {
      const p = assertObject(args.preprocess, `${fn}(preprocess)`)!;
      assertNoUnknownKeys(p, RELIEF_PREPROCESS_KEYS, `${fn}(preprocess)`);
      assertNumber(p.brightness, `${fn}(preprocess).brightness`, { optional: true, min: -1, max: 1 });
      assertNumber(p.contrast, `${fn}(preprocess).contrast`, { optional: true, min: -1, max: 1 });
      assertNumber(p.saturation, `${fn}(preprocess).saturation`, { optional: true, min: -1, max: 1 });
      assertNumber(p.levelsLow, `${fn}(preprocess).levelsLow`, { optional: true, min: 0, max: 254 });
      assertNumber(p.levelsHigh, `${fn}(preprocess).levelsHigh`, { optional: true, min: 1, max: 255 });
    }
    if (args.crop !== undefined) {
      const c = assertObject(args.crop, `${fn}(crop)`)!;
      assertNoUnknownKeys(c, RELIEF_CROP_KEYS, `${fn}(crop)`);
      assertNumber(c.left, `${fn}(crop).left`, { min: 0, max: 1 });
      assertNumber(c.top, `${fn}(crop).top`, { min: 0, max: 1 });
      assertNumber(c.right, `${fn}(crop).right`, { min: 0, max: 1 });
      assertNumber(c.bottom, `${fn}(crop).bottom`, { min: 0, max: 1 });
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
    // Preserve the "constrain to filament palette" snap colours (0–255 triples).
    // Must be threaded through here — the create path runs options through this
    // clamp before generateRelief, so dropping it would make the committed model
    // ignore the palette even though the live preview honoured it.
    const byte = (v: number) => Math.max(0, Math.min(255, Math.round(num(v, 0))));
    const fixedPalette = Array.isArray(q.fixedPalette)
      ? q.fixedPalette
          .filter(c => Array.isArray(c) && c.length === 3 && c.every(n => Number.isFinite(n)))
          .map(c => [byte(c[0]), byte(c[1]), byte(c[2])] as [number, number, number])
      : undefined;
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
      ...(fixedPalette && fixedPalette.length > 0 ? { fixedPalette } : {}),
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
  async function detectReliefLevels(): Promise<void> {
    if (!currentMeshData) return;
    const bounds = meshBounds(currentMeshData);
    const span = bounds.max[2] - bounds.min[2];
    if (span <= 0) return;
    // Replace-instead-of-stack: clicking the button twice used to pile 24+
    // overlapping slab regions on the mesh. Ask first, then start clean.
    if (getRegions().length > 0) {
      const ok = await confirmDialog('Replace existing colour regions with detected levels?', {
        confirmLabel: 'Replace',
      });
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
        // Colour reliefs bring their own palette of cluster colours — nudge the
        // user to reconcile them. Tonal (luminance) reliefs have no colours.
        if (opts.mode === 'quantized') nudgePaletteAfterColorImport();
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
      showToast(`Could not parse "${filename}" as JSON.`, { variant: 'warn', source: 'import' });
      return false;
    }
    const data = validateSessionPayload(parsed);
    if (!data) {
      showToast(`"${filename}" doesn't look like a Partwright session file.`, { variant: 'warn', source: 'import' });
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
      showToast(
        `Unsupported file type: ${file.name}. Supported: .partwright.json, .js, .scad, .stl, .step / .stp, .vox, .svg, .png / .jpg / .gif / .webp / .avif`,
        { variant: 'warn', source: 'import' },
      );
      return false;
    }

    // For SCAD files, detect missing includes before showing the placement modal
    // so the companion modal can run first (it acts as the user's intent signal).
    let scadCode: string | undefined;
    let scadCompanions: Record<string, string> | undefined;
    if (source === 'SCAD') {
      scadCode = await file.text();
      const missing = detectMissingIncludes(scadCode);
      if (missing.length > 0) {
        // Open the modal immediately on the static regex candidates, and kick
        // off a fast OpenSCAD compile probe in parallel that narrows the list to
        // the dependencies OpenSCAD genuinely can't resolve. `null` from the
        // probe means it couldn't run — the modal keeps all candidates.
        const refine = detectScadIncludesAsync(scadCode).catch(() => null);
        const result = await showScadCompanionModal({
          filename: file.name,
          missingIncludes: missing,
          refine,
        });
        if (result === null) return false; // user cancelled
        scadCompanions = result;
      }
    }


    try {
      let committed = false;
      if (source === 'JSON') {
        const text = await file.text();
        committed = await importJSONFromText(file.name, text);
      } else if (source === 'JS' || source === 'SCAD') {
        const code = scadCode ?? await file.text();
        const lang: Language = source === 'SCAD' ? 'scad' : 'manifold-js';
        // placeImportedCodeFile registers any modal-supplied companions itself
        // (after the placement is chosen), so the first saved version carries
        // them — and so the "companion file of current part" choice can attach
        // the imported file too.
        committed = await placeImportedCodeFile(code, lang, file.name, scadCompanions);
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
      if (committed && source !== 'IMAGE') await registerImportSnapshot(file, file.name, source, undefined, undefined, scadCompanions);
      return committed;
    } catch (e) {
      showToast(`Failed to import "${file.name}": ${(e as Error).message}`, { variant: 'warn', source: 'import' });
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
      // Append the imported parts WITHOUT regenerating thumbnails inline. The old
      // path ran every imported version's code through the live renderer (the
      // 10–15s render the user saw), then re-rendered the host version on top — a
      // second full render — while leaving the host part selected. Instead: copy
      // the parts in (fast, no WASM), switch to the FIRST new part so it appears
      // selected with a single progressive render (fast preview → full), then
      // backfill the rest of the new parts' thumbnails offscreen.
      const result = await importSessionPartsIntoActive(data);
      if (result && result.addedParts.length > 0) {
        // Navigate to the first newly-added part so it appears selected with a
        // single progressive render (fast preview → full). We do NOT route
        // through selectPart here: its cancelCurrentExecution + saveVersion-based
        // edit preservation deadlock when invoked from inside the import flow.
        // Instead, stash the outgoing part's buffer as a draft BEFORE changePart
        // (so it lands under the host part's id, not the incoming one), then load
        // the new part with skipDraftSave since we've already saved that draft.
        const outgoing = getState();
        if (outgoing.session && outgoing.currentPart) {
          await writeDraft(outgoing.session.id, getActiveLanguage(), getValue(), outgoing.currentPart.id, getCompanionFiles(), currentDraftRegions());
        }
        const newVersion = await changePart(result.addedParts[0].id);
        if (newVersion) await loadVersionIntoEditor(newVersion, { skipSurface: true, skipDraftSave: true });
        // The selected part is now rendered live with full colour — snapshot its
        // thumbnail straight from that state (the most accurate tile, and it lets
        // the backfill skip re-running this one).
        const sel = getState();
        if (sel.currentVersion && !sel.currentVersion.thumbnail) {
          const thumb = await captureThumbnail();
          if (thumb) await updateVersionThumbnail(sel.currentVersion.id, thumb);
        }
        const sessionId = sel.session?.id;
        if (sessionId) void backfillThumbnailsForParts(sessionId, result.addedParts.map(p => p.id));
        const partWord = result.addedParts.length === 1 ? 'part' : 'parts';
        showToast(`Added ${result.addedParts.length} ${partWord} to this session.`, { variant: 'success' });
        return true;
      }
      // Nothing importable (e.g. every imported part was empty) — report it.
      if (result) {
        showToast('That file had no parts to add.', { variant: 'warn', source: 'import' });
        return false;
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
      showToast(`"${chosenName}" produced no voxels at the chosen settings. Try lowering the transparency cutoff.`, { variant: 'warn', source: 'import' });
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
    nudgePaletteAfterColorImport();
    return true;
  }

  /** After an import that brings in its own colours (voxel art, colour relief),
   *  nudge the user toward the palette tool to match those colours to their
   *  filaments — rather than constraining the importers to the palette. */
  function nudgePaletteAfterColorImport(): void {
    showToast('Imported with colours — open 🧵 Palette to match them to your filaments.', { variant: 'neutral', source: 'import' });
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
      showToast(`Could not read image "${file.name}": ${(e as Error).message}`, { variant: 'warn', source: 'import' });
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
      showToast(`Could not read .vox file "${file.name}": ${(e as Error).message}`, { variant: 'warn', source: 'import' });
      return false;
    }
    if (grid.size === 0) {
      showToast(`"${file.name}" contained no voxels.`, { variant: 'warn', source: 'import' });
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
          showToast(`Failed to parse STEP file: ${(e as Error).message}`, { variant: 'warn', source: 'import' });
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
      showToast(`Failed to parse STEP file: ${(e as Error).message}`, { variant: 'warn', source: 'import' });
      return false;
    }
    if (!mesh || mesh.numTri === 0) {
      showToast(`STEP file produced no geometry: ${file.name}`, { variant: 'warn', source: 'import' });
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
  /** Non-interactive STL parse: tries a ladder of weld tolerances and reports
   *  whether the welded result forms a clean manifold. Shared by the interactive
   *  file path (`parseSTLFile`, which adds the render-only confirm dialog) and
   *  the programmatic `importMeshData` API (which auto-accepts render-only).
   *  Returns null only when the bytes don't parse as STL at all. */
  type ParsedSTLProbe =
    | { mesh: ImportedMesh; isManifold: true }
    | { mesh: ImportedMesh; isManifold: false; manifoldError: string | null; maxTried: number; triCount: number; vertCount: number };
  function parseSTLBytes(bytes: Uint8Array, filename: string): ParsedSTLProbe | null {
    // Sanity-check that the file parses to *something* before the more expensive
    // ofMesh trials.
    const probe = parseSTL(bytes);
    if (!probe || probe.numTri === 0) return null;

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
      if (trial.ok) return { mesh: toImportedMesh(filename, mesh), isManifold: true };
      manifoldError = trial.error;
      if (tol > maxTried) maxTried = tol;
      bestMesh = mesh;
    }
    return {
      mesh: toImportedMesh(filename, bestMesh),
      isManifold: false,
      manifoldError,
      maxTried,
      triCount: probe.numTri,
      vertCount: probe.numVert,
    };
  }

  async function parseSTLFile(file: File): Promise<ParsedSTL | null> {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const parsed = parseSTLBytes(bytes, file.name);
    if (!parsed) {
      showToast(`Could not parse "${file.name}" as an STL file.`, { variant: 'warn', source: 'import' });
      return null;
    }
    if (parsed.isManifold) return { mesh: parsed.mesh, isManifold: true };

    // All tolerances failed. Offer render-only fallback — most users importing
    // a Baby Yoda / Eiffel Tower scan just want to look at it, not boolean-op it.
    const accepted = await confirmDialog(
      `${file.name} won't form a clean manifold — typical for sculpted or scanned models with self-intersections, open edges, or T-junctions.\n\n` +
      `You can still import it as render-only: the mesh displays and exports normally, but boolean operations, paint, and cross-sections won't work.\n\n` +
      `For full editing, repair the mesh first in MeshLab or Blender, then re-import.\n\n` +
      `${parsed.triCount.toLocaleString()} triangles · ${parsed.vertCount.toLocaleString()} vertices · tried weld tolerances up to ${parsed.maxTried.toExponential(1)} · ${parsed.manifoldError}`,
      {
        title: 'Import as render-only?',
        confirmLabel: 'Import render-only',
        cancelLabel: 'Cancel',
      }
    );
    if (!accepted) return null;

    return { mesh: parsed.mesh, isManifold: false };
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

  // `isStarterCode` (does the editor still hold an untouched rotating starter?)
  // lives in editor/starters — it must recognize starters from every engine.

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
    // A freshly-created part the user never touched still holds starter code;
    // don't pollute its history with a version for it. BUT interactive paint
    // applied on top of the starter geometry is real work — bailing here would
    // silently drop it on a part switch (the painted part returns completely
    // uncolored). Let saveVersion run when paint exists; it persists the
    // regions via enrichGeometryDataWithColors and rehydrateColorRegions
    // restores them when the part is reopened.
    if (isStarterCode(code) && !hasColorRegions()) return;
    // Previously bailed here when code was unchanged, silently discarding
    // unsaved paint, annotations, param overrides, and companion-file edits.
    // saveVersion already deduplicates on all five axes (code + annotations +
    // paint + params + companions), so letting it run is the holistic fix: no
    // DB write when truly nothing changed, one write when any tracked state
    // differs. The only extra cost is the captureThumbnail() call (~30–80 ms
    // canvas readback, not a recompile).
    const thumbnail = await captureThumbnail();
    const geometryData = enrichGeometryDataWithColors(getGeometryDataObj());
    // Include companions so the dedup check in saveVersion works when a
    // concurrent applyCodeToCurrentPart already saved a version with companions
    // (avoids the "new-part import + navigate away" phantom second version).
    const companionFiles = getActiveLanguage() === 'scad' ? getCompanionFiles() : undefined;
    await saveVersion(code, geometryData, thumbnail, undefined, undefined, { companionFiles });
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

  /** Bake a part's mesh WITH its colours, off the live editor, for multi-part
   *  export. The active part is returned straight from `currentMeshData` (already
   *  fully coloured, no re-run). Any other part is re-executed and BOTH colour
   *  layers are resolved offline — code-declared colours (`api.label` /
   *  `api.paint.*`, from the run result) and the part's saved manual paint
   *  (`version.geometryData.colorRegions`) — using the same resolver + compositor
   *  the live editor uses, so nothing is silently dropped. Returns null when the
   *  part has no version or produced no usable mesh. */
  async function bakeColoredMeshForPart(partId: string, name: string): Promise<{ name: string; mesh: MeshData } | null> {
    if (partId === getState().currentPart?.id && currentMeshData) {
      return { name, mesh: coloredMeshForExport(currentMeshData) };
    }
    const version = await getLatestVersion(partId);
    if (!version) return null;
    const lang = effectiveVersionLanguage(version, getState().session);
    const saved = getActiveImports();
    let result;
    try {
      setActiveImports((version.importedMeshes ?? []) as ImportedMesh[]);
      result = await executeCodeAsync(version.code, lang);
    } finally {
      setActiveImports(saved);
    }
    if (!result || result.error || !result.mesh) return null;
    const mesh = result.mesh;

    // Adjacency is only needed by a few descriptor kinds; build it lazily once.
    let adjacency: AdjacencyGraph | null = null;
    const needsAdjacency = (d: RegionDescriptor) =>
      d.kind === 'coplanar' || d.kind === 'connectedFromSeed' || d.kind === 'colorFlood';
    const ensureAdjacency = () => (adjacency ??= buildAdjacency(mesh));

    let order = 0;
    const mkRegion = (color: [number, number, number], triangles: Set<number>, perTriColors?: Map<number, [number, number, number]>): ColorRegion => ({
      id: ++order, name: '', color, source: 'model', descriptor: { kind: 'triangles', ids: [] },
      order, visible: true, triangles, perTriColors,
    });

    // Layer B — code-declared colours (the model-colour underlay).
    const modelLayer: ColorRegion[] = [];
    if (result.labelColors && result.labelMap) {
      for (const [labelName, color] of result.labelColors) {
        const tris = result.labelMap.get(labelName);
        if (tris && tris.size > 0) modelLayer.push(mkRegion(color, tris));
      }
    }
    if (result.paintOps) {
      for (const op of result.paintOps) {
        const d = op.descriptor as RegionDescriptor;
        if (needsAdjacency(d)) ensureAdjacency();
        const { triangles, perTriColors } = resolveDescriptorTriangles(d, mesh, adjacency, null);
        if (triangles.size > 0) modelLayer.push(mkRegion(op.color, triangles, perTriColors));
      }
    }

    // Layer A — the part's saved manual paint regions.
    const manualLayer: ColorRegion[] = [];
    for (const region of versionColorRegions(version)) {
      const d = region.descriptor;
      if (needsAdjacency(d)) ensureAdjacency();
      const { triangles, perTriColors } = resolveDescriptorTriangles(d, mesh, adjacency, null);
      if (triangles.size > 0) {
        manualLayer.push({
          id: ++order, name: region.name, color: region.color, source: region.source,
          descriptor: d, order: region.order, visible: true, triangles, perTriColors,
        });
      }
    }

    const triColors = composeTriColors(mesh.numTri, [modelLayer, manualLayer]);
    return { name, mesh: triColors ? { ...mesh, triColors } : mesh };
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
  async function applyCodeToCurrentPart(code: string, language: Language, companions?: Record<string, string>): Promise<void> {
    // An import replaces the part's geometry, so the previous part's regions /
    // live paint can't survive — clear them before running, or runCodeSync
    // re-resolves stale regions onto the new mesh and locks the editor.
    cancelVoxelPaintIfActive();
    dropPaintState();
    clearMesh();
    if (getActiveLanguage() !== language) await switchLanguage(language);
    // Register companions before the compile so their tabs appear immediately and
    // MEMFS already contains them on the first (and only) run. createPart clears
    // the registry, so we always set here — don't addCompanionFileToRegistry.
    if (companions !== undefined) {
      setCompanionFiles(companions);
      renderCompanionFilesBar();
    }
    // Clear stale params panel immediately so old controls don't linger while
    // the new model is loading.
    syncParamsPanel(undefined);
    setValue(code);
    // Snapshot the active part before the (possibly slow) compile.  If the
    // user navigates away mid-compile or during the async thumbnail capture,
    // changePart will have already run by the time we reach saveVersion — which
    // would write to the wrong part or create a second version on the original
    // (preserveCurrentEditsIfNeeded already captured the draft on navigation).
    const partIdBeforeRun = getState().currentPart?.id;
    const ran = await runCodeSync(code);
    // Cancelled (user navigated away mid-compile): preserveCurrentEditsIfNeeded
    // will have saved a draft version; don't double-save here.
    if (!ran) return;
    if (getState().currentPart?.id !== partIdBeforeRun) return;
    const thumbnail = await captureThumbnail();
    // captureThumbnail uses macro-task callbacks (toBlob/setTimeout), so a
    // click event can fire between runCodeSync returning and here.  Recheck.
    if (getState().currentPart?.id !== partIdBeforeRun) return;
    const geometryData = getGeometryDataObj();
    await saveVersion(code, geometryData, thumbnail, 'imported', undefined, { force: true, companionFiles: companions });
  }

  /** Add code (voxel / BREP starter) as a brand-new part's first version.
   *  Mirrors seedNewPartWithMesh but for editor code + a language tag instead
   *  of a parsed mesh. */
  async function seedNewPartWithCode(code: string, name: string, language: Language, companions?: Record<string, string>): Promise<void> {
    const part = await createPart(name);
    if (!part) return;
    await applyCodeToCurrentPart(code, language, companions);
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
  async function placeImportedCodeFile(
    code: string,
    lang: Language,
    filename: string,
    companions?: Record<string, string>,
  ): Promise<boolean> {
    const sessionName = filename.replace(/\.(js|scad)$/i, '');
    const state = getState();

    // Register any companion files that rode along with the import (the modal's
    // supplied deps, plus optionally the imported file itself), re-run with them
    // in place, and persist so the saved version already carries them. A no-op
    // when there's nothing to add — the seeding path saves its own base version.
    const applyCompanions = async (self?: { path: string; content: string }): Promise<void> => {
      let any = false;
      if (self) { addCompanionFileToRegistry(self.path, self.content); any = true; }
      if (companions) {
        for (const [path, content] of Object.entries(companions)) {
          addCompanionFileToRegistry(path, content);
          any = true;
        }
      }
      if (any) {
        renderCompanionFilesBar();
        await runCodeSync(getValue());
        await saveCurrentVersion();
      }
    };

    if (!state.session || currentPartIsExpendable()) {
      // No real "current part" to attach to (no session, or just starter code) —
      // import straight into a fresh session. Pass companions directly so they're
      // registered before the first compile (tabs appear immediately) and MEMFS
      // already contains them on that one compile — no second run needed.
      await importCodePayload(code, lang, sessionName, companions);
      if (companions && Object.keys(companions).length > 0) {
        await saveCurrentVersion();
      }
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
      // Companion attach only makes sense for a .scad imported into a SCAD part.
      canAddAsCompanion: lang === 'scad' && getActiveLanguage() === 'scad',
      recommend: 'new-part',
    });
    if (!target) return false;
    if (target === 'companion-file') {
      // Attach the imported file as a dependency of the current part — keep the
      // current code, just make `include <name.scad>` resolvable.
      await preserveCurrentEditsIfNeeded();
      const companionPath = normalizeCompanionPath(filename);
      await applyCompanions({ path: companionPath, content: code });
      showToast(`Added ${companionPath} as a companion of this part.`, { variant: 'success', source: 'import' });
      return true;
    }
    if (target === 'new-session') {
      await importCodePayload(code, lang, sessionName, companions);
      if (companions && Object.keys(companions).length > 0) await saveCurrentVersion();
    } else if (target === 'new-part') {
      await preserveCurrentEditsIfNeeded();
      await seedNewPartWithCode(code, sessionName, lang, companions);
    } else {
      // current-part: replace current part's code with the imported file.
      await preserveCurrentEditsIfNeeded();
      await applyCodeToCurrentPart(code, lang, companions);
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
      // Restore companions captured at import time so re-imports from history
      // don't lose the companion files the user originally provided.
      await placeImportedCodeFile(code, lang, entry.filename, entry.companions);
    } catch (e) {
      showToast(`Failed to re-import "${entry.filename}": ${(e as Error).message}`, { variant: 'warn', source: 'import' });
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
    const all = Array.from(files).filter(isImportableFile);
    if (all.length === 0) return;
    e.preventDefault();

    // When multiple SCAD files are dropped at once, detect if one is a "main"
    // file (has top-level geometry) and the rest are companions.
    const scadFiles = all.filter(f => /\.scad$/i.test(f.name));
    if (scadFiles.length > 1) {
      // Read all SCAD files in parallel.
      const contents = await Promise.all(scadFiles.map(async f => ({ f, code: await f.text() })));
      // A file that's referenced by another is a companion candidate.
      const mainCandidates = contents.filter(({ f, code }) => {
        const needed = detectMissingIncludes(code);
        // A main file either imports others in the batch, or has none of the
        // others importing it.
        const otherNames = contents.filter(c => c.f !== f).map(c => c.f.name);
        const importsOthers = needed.some(p => otherNames.some(n => n === p || n === p.split('/').pop()));
        return importsOthers;
      });

      if (mainCandidates.length === 1) {
        // One file imports the others — treat the rest as companions. Match the
        // dropped companions to the main file's include paths, then route the
        // main file through placeImportedCodeFile so the drop inherits the same
        // placement modal + unsaved-edit preservation as a single-file import
        // (rather than silently clobbering the current session).
        const { f: mainFile, code: mainCode } = mainCandidates[0];
        const companionContents = contents.filter(c => c.f !== mainFile);
        const missing = detectMissingIncludes(mainCode);
        const companionsMap: Record<string, string> = {};
        for (const { f: cf, code: cfCode } of companionContents) {
          const matchedPath = missing.find(p => p === cf.name || p.endsWith(`/${cf.name}`)) ?? cf.name;
          companionsMap[matchedPath] = cfCode;
        }
        const committed = await placeImportedCodeFile(mainCode, 'scad', mainFile.name, companionsMap);
        // Warn about any include the drop didn't supply a file for.
        if (committed) {
          const stillMissing = missing.filter(p => getCompanionFiles()[p] === undefined);
          if (stillMissing.length > 0) {
            showToast(
              `Still missing companion files: ${stillMissing.join(', ')}. Use the "+" tab to add them.`,
              { variant: 'warn', durationMs: 8000 },
            );
          }
        }
        return;
      }
    }

    // Default: import the first importable file.
    const first = all[0];
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
    // Colour-aware warnings. Colour-carrying formats (3MF/GLB/OBJ) warn when the
    // model needs more filament colours than the palette's slot capacity; STL
    // can't carry colour at all, so a painted model warns that colours drop.
    const colorCarrying = format === '3MF' || format === 'GLB' || format === 'OBJ';
    let colorOverBudget: { used: number; capacity: number } | undefined;
    if (colorCarrying && hasColorRegions()) {
      const used = getDistinctRegionColors().length;
      const capacity = getPaletteCapacity();
      if (used > capacity) colorOverBudget = { used, capacity };
    }
    const colorDropped = format === 'STL' && (hasColorRegions() || hasModelColorRegions());
    // Fold the design-for-print analysis (bed fit, overhangs, thin walls, small
    // features, stability) into the confirm modal so the user reads it there
    // rather than catching a fleeting toast. The watertight `manifold` check is
    // dropped — it's already covered by the isManifold block above — and only
    // blocker/warning levels are surfaced.
    const report = exportPrintabilityReport();
    const printabilityChecks = report
      ? report.checks.filter(c => (c.level === 'fail' || c.level === 'warn') && c.id !== 'manifold')
      : [];
    return {
      unitless: _getUnits() === 'unitless',
      dimensions,
      isManifold: gd?.isManifold !== false, // treat unknown as manifold (no false alarm)
      componentCount: typeof gd?.componentCount === 'number' ? gd.componentCount : 1,
      format,
      colorOverBudget,
      colorDropped,
      surfaceStale: pendingSurface !== null,
      printabilityChecks,
    };
  }

  /** Warning string when the model declares `api.surface.*` textures that
   *  haven't been applied to the current code (the Re-apply pill is up) — an
   *  export right now carries the untextured base mesh. Null when current.
   *  The UI export actions surface this through the confirm modal instead;
   *  this string is for the unguarded console export API (toast + `warning`
   *  field), which must stay non-blocking for AI agents. */
  const surfaceStaleExportWarning = (format: string): string | null =>
    pendingSurface
      ? `${format} export contains the untextured base mesh — this model's api.surface.* textures haven't been applied to the current code. Run the code (every run applies textures) and export again to include them.`
      : null;

  /** Toast (and log) the stale-texture warning for a console-API export. */
  function warnIfSurfaceStale(format: string): void {
    const msg = surfaceStaleExportWarning(format);
    if (msg) showToast(msg, { variant: 'warn', source: 'export' });
  }

  /** Returns true if the export should proceed: no warning, or the user
   *  confirmed it. Only used by the UI export actions below. */
  async function confirmExportOrProceed(format: string): Promise<boolean> {
    const info = exportWarningInfo(format);
    // Flag every part that isn't fully saved so the export doesn't silently use
    // stale data. A multi-part export bakes each NON-current part from its last
    // SAVED version (the current part exports from its live mesh), so unsaved
    // edits drop out — and a part that was never saved at all (an untouched
    // starter) has NO version, so it's skipped from the export entirely. Both
    // 'unsaved' (edited, not saved) and 'empty' (brand-new, never saved) count;
    // only 'clean' parts are omitted. We warn for the current part too: the user
    // asked to be alerted whenever they export without saving.
    const unsavedRows = (await gatherUnsavedParts()).filter(r => r.status === 'unsaved' || r.status === 'empty');
    if (unsavedRows.length > 0) {
      info.unsavedParts = { count: unsavedRows.length, names: unsavedRows.map(r => r.name) };
    }
    if (!hasExportWarning(info)) return true;
    const decision = await showExportConfirm(info);
    if (decision === 'save') {
      // Hand off to the multi-part save modal so the user picks which parts to
      // save (or cancels) — the same chooser Cmd/Ctrl+S uses. The export is
      // abandoned either way; the user re-clicks Export to resume once they've
      // saved. Mirrors saveVersionWithToast's choice handling.
      const choice = await showSaveAllModal(unsavedRows);
      if (choice.action === 'selected') {
        const onlyCurrent = choice.partIds.length === 1 && choice.partIds[0] === getState().currentPart?.id;
        if (!onlyCurrent) await saveSelectedParts(choice.partIds);
        else await saveCurrentPartWithToast();
      } else if (choice.action === 'current') {
        await saveCurrentPartWithToast();
      }
      // 'cancel' → save nothing; the user can re-open Export and decide again.
      return false;
    }
    return decision === 'export';
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

  // Run a design-for-print analysis (bed fit, watertight, overhangs, thin walls,
  // stability) over the live mesh so the export-confirm modal can surface the
  // findings. Returns null when there's no mesh to analyze. The modal — not a
  // toast — is where these now reach the user (see `exportWarningInfo`).
  function exportPrintabilityReport(): PrintabilityReport | null {
    if (!currentMeshData) return null;
    const settings = loadPrinterSettings();
    let isManifold = false;
    let renderOnly = false;
    try {
      const geo = JSON.parse(geometryDataEl.textContent || '{}');
      isManifold = !!geo.isManifold;
      renderOnly = geo.manifoldStatus === 'render-only (not manifold)';
    } catch { /* default false */ }
    return analyzePrintability(currentMeshData, {
      bed: settings.bed,
      nozzleWidth: settings.nozzleWidth,
      overhangAngleDeg: settings.overhangAngleDeg,
      isManifold,
      renderOnly,
    });
  }

  const actionExportGLB = async () => {
    if (isSharedPreview()) { showToast('Fork this shared design before exporting.', { variant: 'warn' }); return; }
    if (!currentMeshData) { noGeometryToast(); return; }
    if (!(await confirmExportOrProceed('GLB'))) return;
    // Multi-part session → pick parts and bundle them as named nodes in one scene.
    if (getState().parts.length > 1) { await exportMultiPartFlow('GLB', GLB_PARTS_DESC, buildGLBPartsBlob); return; }
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
    // Multi-part session → pick parts and bundle a .stl per part in one .zip.
    if (getState().parts.length > 1) { await exportMultiPartFlow('STL', STL_PARTS_DESC, buildSTLPartsBlob); return; }
    notifyMultiPartExport();
    try { showToast(`Exported ${exportSTL(fileExportMesh(false)!)}`, { variant: 'success' }); }
    catch (e) { showToast(e instanceof Error ? e.message : 'STL export failed', { variant: 'warn' }); }
  };
  const actionExportOBJ = async () => {
    if (isSharedPreview()) { showToast('Fork this shared design before exporting.', { variant: 'warn' }); return; }
    if (!currentMeshData) { noGeometryToast(); return; }
    if (!(await confirmExportOrProceed('OBJ'))) return;
    // Multi-part session → pick parts and emit named objects in one .obj.
    if (getState().parts.length > 1) { await exportMultiPartFlow('OBJ', OBJ_PARTS_DESC, buildOBJPartsBlob); return; }
    notifyMultiPartExport();
    try { showToast(`Exported ${exportOBJ(fileExportMesh(true)!)}`, { variant: 'success' }); }
    catch (e) { showToast(e instanceof Error ? e.message : 'OBJ export failed', { variant: 'warn' }); }
  };
  /** Multi-part 3MF: pick parts (with previews), bake each part's coloured mesh
   *  off-editor, and bundle them into one 3MF. `bambu` true → one part per build
   *  plate (Bambu/Orca project); false → a generic multi-object 3MF (grid). */
  async function export3MFMultiPartFlow(bambu: boolean): Promise<void> {
    const parts = getState().parts;
    const activeId = getState().currentPart?.id ?? null;
    // Pull each part's latest thumbnail for the picker (cheap — pre-baked Blobs).
    const choices: ExportPartChoice[] = [];
    for (const p of parts) {
      const v = await getLatestVersion(p.id);
      choices.push({ id: p.id, name: p.name, thumbnail: v?.thumbnail ?? null });
    }
    const selected = await showExportPartsModal(choices, {
      activePartId: activeId,
      title: bambu ? 'Export parts to 3MF (Bambu/Orca)' : 'Export parts to 3MF',
      description: bambu
        ? 'Choose which parts to include. Each selected part is placed on its own build plate, and painted colours are bound to filaments for Bambu Studio / OrcaSlicer.'
        : 'Choose which parts to include. Each selected part is added as a separate object, arranged in a grid so they don’t overlap. Standard 3MF — opens in any slicer.',
      bambu: bambu ? {
        printers: BAMBU_PRINTERS.map(p => ({ id: p.id, label: p.label })),
        defaultPrinter: DEFAULT_BAMBU_PRINTER,
        nozzles: ['0.2', '0.4', '0.6', '0.8'],
        defaultNozzle: '0.4',
        filaments: BAMBU_FILAMENT_TYPES.map(f => ({ id: f.id, label: f.label })),
        defaultFilament: DEFAULT_BAMBU_FILAMENT,
      } : undefined,
    });
    if (!selected || selected.partIds.length === 0) return;
    const selectedIds = selected.partIds;

    const byId = new Map(parts.map(p => [p.id, p]));
    const job = startProgress({ title: 'Preparing 3MF', indeterminate: false, message: 'Baking parts…' });
    try {
      const baked: { name: string; mesh: MeshData }[] = [];
      for (let i = 0; i < selectedIds.length; i++) {
        const part = byId.get(selectedIds[i]);
        if (!part) continue;
        updateProgress(job, i / selectedIds.length, `Baking "${part.name}" (${i + 1}/${selectedIds.length})…`);
        const result = await bakeColoredMeshForPart(part.id, part.name);
        if (result) baked.push(result);
      }
      updateProgress(job, 1, 'Writing 3MF…');
      if (baked.length === 0) { showToast('None of the selected parts produced geometry to export.', { variant: 'warn' }); return; }

      const bed = loadPrinterSettings().bed;
      const built = build3MFProject(baked, {
        bambu, bedSize: [bed[0], bed[1]],
        printer: selected.printer, nozzle: selected.nozzle, filament: selected.filament,
      });
      downloadBlob(built.blob, built.filename, '3MF');
      const skipped = selectedIds.length - baked.length;
      const note = skipped > 0 ? ` (${skipped} skipped — no geometry)` : '';
      showToast(`Exported ${built.filename} — ${baked.length} part${baked.length === 1 ? '' : 's'}${note}`, { variant: 'success' });
    } catch (e) {
      showToast(e instanceof Error ? e.message : '3MF export failed', { variant: 'warn' });
    } finally {
      endProgress(job);
    }
  }

  /** Format-agnostic multi-part export flow for OBJ / STL / GLB: pick parts (with
   *  previews), bake each selected part's coloured mesh off-editor, hand the baked
   *  set to `build`, and download the result. Mirrors {@link export3MFMultiPartFlow}
   *  but for the scene-graph / soup formats (3MF keeps its own bed-aware flow). */
  async function exportMultiPartFlow(
    formatTag: string,
    description: string,
    build: (parts: { name: string; mesh: MeshData }[]) => BuiltExport | Promise<BuiltExport>,
  ): Promise<void> {
    const parts = getState().parts;
    const activeId = getState().currentPart?.id ?? null;
    const choices: ExportPartChoice[] = [];
    for (const p of parts) {
      const v = await getLatestVersion(p.id);
      choices.push({ id: p.id, name: p.name, thumbnail: v?.thumbnail ?? null });
    }
    const selected = await showExportPartsModal(choices, {
      activePartId: activeId,
      title: `Export parts to ${formatTag}`,
      description,
    });
    if (!selected || selected.partIds.length === 0) return;
    const selectedIds = selected.partIds;

    const byId = new Map(parts.map(p => [p.id, p]));
    const job = startProgress({ title: `Preparing ${formatTag}`, indeterminate: false, message: 'Baking parts…' });
    try {
      const baked: { name: string; mesh: MeshData }[] = [];
      for (let i = 0; i < selectedIds.length; i++) {
        const part = byId.get(selectedIds[i]);
        if (!part) continue;
        updateProgress(job, i / selectedIds.length, `Baking "${part.name}" (${i + 1}/${selectedIds.length})…`);
        const result = await bakeColoredMeshForPart(part.id, part.name);
        if (result) baked.push(result);
      }
      updateProgress(job, 1, `Writing ${formatTag}…`);
      if (baked.length === 0) { showToast('None of the selected parts produced geometry to export.', { variant: 'warn' }); return; }

      const built = await build(baked);
      downloadBlob(built.blob, built.filename, formatTag);
      const skipped = selectedIds.length - baked.length;
      const note = skipped > 0 ? ` (${skipped} skipped — no geometry)` : '';
      showToast(`Exported ${built.filename} — ${baked.length} part${baked.length === 1 ? '' : 's'}${note}`, { variant: 'success' });
    } catch (e) {
      showToast(e instanceof Error ? e.message : `${formatTag} export failed`, { variant: 'warn' });
    } finally {
      endProgress(job);
    }
  }

  /** Console/AI core for the multi-part OBJ/STL/GLB exports: validate the part ids
   *  (default: all), bake each part's coloured mesh off-editor, and return the baked
   *  set. Mirrors the validation of {@link build3MFPartsExport} without the 3MF
   *  builder, so the per-format API twins just supply the builder. */
  async function bakePartsForExport(partIds?: string[]): Promise<{ baked: { name: string; mesh: MeshData }[] } | { error: string }> {
    const allParts = getState().parts;
    if (allParts.length === 0) return { error: 'No parts in this session.' };
    let ids = partIds;
    if (ids !== undefined) {
      if (!Array.isArray(ids) || !ids.every(id => typeof id === 'string')) {
        return { error: 'partIds must be an array of part-id strings.' };
      }
    } else {
      ids = allParts.map(p => p.id);
    }
    const byId = new Map(allParts.map(p => [p.id, p]));
    const baked: { name: string; mesh: MeshData }[] = [];
    for (const id of ids) {
      const part = byId.get(id);
      if (!part) return { error: `Unknown part id "${id}".` };
      const result = await bakeColoredMeshForPart(part.id, part.name);
      if (result) baked.push(result);
    }
    if (baked.length === 0) return { error: 'None of the selected parts produced geometry to export.' };
    return { baked };
  }

  /** Console/AI twin of a multi-part OBJ/STL/GLB export — bakes the requested parts
   *  (default: all) and DOWNLOADS the bundled file. */
  async function exportPartsApi(
    formatTag: string,
    build: (parts: { name: string; mesh: MeshData }[]) => BuiltExport | Promise<BuiltExport>,
    partIds?: string[],
    filename?: string,
  ): Promise<{ ok: true; filename: string; parts: number } | { error: string }> {
    assertString(filename, `export${formatTag}Parts(partIds, filename)`, { optional: true });
    const r = await bakePartsForExport(partIds);
    if ('error' in r) return r;
    let built: BuiltExport;
    try { built = await build(r.baked); } catch (e) { return { error: e instanceof Error ? e.message : String(e) }; }
    downloadBlob(built.blob, built.filename, formatTag);
    return { ok: true as const, filename: built.filename, parts: r.baked.length };
  }

  /** Like {@link exportPartsApi} but RETURNS the bytes (base64) instead of
   *  downloading — the agent/test-friendly twin. */
  async function exportPartsDataApi(
    formatTag: string,
    build: (parts: { name: string; mesh: MeshData }[]) => BuiltExport | Promise<BuiltExport>,
    partIds?: string[],
    filename?: string,
  ): Promise<{ filename: string; mimeType: string; sizeBytes: number; base64: string; parts: number } | { error: string }> {
    assertString(filename, `export${formatTag}PartsData(partIds, filename)`, { optional: true });
    const r = await bakePartsForExport(partIds);
    if ('error' in r) return r;
    let built: BuiltExport;
    try { built = await build(r.baked); } catch (e) { return { error: e instanceof Error ? e.message : String(e) }; }
    return {
      filename: built.filename,
      mimeType: built.mimeType,
      sizeBytes: built.blob.size,
      base64: await blobToBase64(built.blob),
      parts: r.baked.length,
    };
  }

  // Per-format builder bound to a custom filename, shared by the menu flow + API.
  const buildOBJPartsBlob = (baked: { name: string; mesh: MeshData }[], filename?: string) => buildOBJProject(baked, filename);
  const buildSTLPartsBlob = (baked: { name: string; mesh: MeshData }[], filename?: string) => buildSTLProject(baked, filename);
  const buildGLBPartsBlob = (baked: { name: string; mesh: MeshData }[], filename?: string) => buildGLBProject(baked, { customName: filename });

  const OBJ_PARTS_DESC = 'Choose which parts to include. Each part becomes a named object in one .obj file, arranged in a grid so they don’t overlap. Painted colours export as materials (.mtl, bundled in a .zip).';
  const STL_PARTS_DESC = 'Choose which parts to include. Each part is saved as its own .stl file, bundled in a .zip. STL has no colour or part names, so separate files keep the parts distinct.';
  const GLB_PARTS_DESC = 'Choose which parts to include. Each part becomes a named node in one .glb scene, arranged in a grid. Painted colours export as vertex colours.';

  /** Shared core for the multi-part 3MF exports: validate the part ids, bake each
   *  selected part's coloured mesh off-editor, and build the 3MF. Returns the
   *  BuiltExport (no download, no base64) so callers can either trigger a
   *  download or return the bytes. `opts.bambu` (default true) → one part per
   *  build plate (Bambu/Orca project); false → a generic multi-object 3MF. */
  async function build3MFPartsExport(partIds?: string[], filename?: string, opts?: { bambu?: boolean; printer?: string; nozzle?: string; filament?: string }): Promise<{ built: import('./export/gltf').BuiltExport; parts: number } | { error: string }> {
    const bambu = opts?.bambu ?? true;
    // Validate the Bambu profile selectors at the boundary so a console/AI/MCP
    // caller gets the same constraints the export modal's dropdowns enforce. An
    // unknown printer/filament would silently fall back to the default profile,
    // and a raw nozzle string is interpolated straight into the Bambu config —
    // a bad value yields a malformed preset Bambu rejects. (Only meaningful for
    // the Bambu project path; the generic grid ignores these.)
    if (bambu && opts) {
      if (opts.printer !== undefined && !isBambuPrinter(opts.printer))
        return { error: `export3MFParts: unknown printer "${opts.printer}". Valid: ${BAMBU_PRINTERS.map(p => p.id).join(', ')}.` };
      if (opts.nozzle !== undefined && !isBambuNozzle(opts.nozzle))
        return { error: `export3MFParts: unknown nozzle "${opts.nozzle}". Valid: ${BAMBU_NOZZLES.join(', ')}.` };
      if (opts.filament !== undefined && !isBambuFilament(opts.filament))
        return { error: `export3MFParts: unknown filament "${opts.filament}". Valid: ${BAMBU_FILAMENT_TYPES.map(f => f.id).join(', ')}.` };
    }
    const allParts = getState().parts;
    if (allParts.length === 0) return { error: 'No parts in this session.' };
    let ids = partIds;
    if (ids !== undefined) {
      if (!Array.isArray(ids) || !ids.every(id => typeof id === 'string')) {
        return { error: 'export3MFParts(partIds): partIds must be an array of part-id strings.' };
      }
    } else {
      ids = allParts.map(p => p.id);
    }
    const byId = new Map(allParts.map(p => [p.id, p]));
    const baked: { name: string; mesh: MeshData }[] = [];
    for (const id of ids) {
      const part = byId.get(id);
      if (!part) return { error: `export3MFParts: unknown part id "${id}".` };
      const result = await bakeColoredMeshForPart(part.id, part.name);
      if (result) baked.push(result);
    }
    if (baked.length === 0) return { error: 'None of the selected parts produced geometry to export.' };
    try {
      const bed = loadPrinterSettings().bed;
      const built = build3MFProject(baked, {
        customName: filename, bambu, bedSize: [bed[0], bed[1]],
        printer: opts?.printer, nozzle: opts?.nozzle, filament: opts?.filament,
      });
      return { built, parts: baked.length };
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) };
    }
  }

  /** Console/AI twin of the multi-part 3MF export — bakes the requested parts
   *  (default: all) and DOWNLOADS one 3MF. `opts.bambu` (default true) → one part
   *  per build plate (Bambu/Orca project); false → a generic multi-object 3MF. */
  async function export3MFPartsApi(partIds?: string[], filename?: string, opts?: { bambu?: boolean; printer?: string; nozzle?: string; filament?: string }): Promise<{ ok: true; filename: string; parts: number } | { error: string }> {
    assertString(filename, 'export3MFParts(partIds, filename)', { optional: true });
    const r = await build3MFPartsExport(partIds, filename, opts);
    if ('error' in r) return r;
    downloadBlob(r.built.blob, r.built.filename, '3MF');
    return { ok: true as const, filename: r.built.filename, parts: r.parts };
  }

  /** Like {@link export3MFPartsApi} but RETURNS the bytes (base64) instead of
   *  downloading — the agent/test-friendly twin. Lets a caller read the exported
   *  3MF back without the browser download path. */
  async function export3MFPartsDataApi(partIds?: string[], filename?: string, opts?: { bambu?: boolean; printer?: string; nozzle?: string; filament?: string }): Promise<{ filename: string; mimeType: string; sizeBytes: number; base64: string; parts: number } | { error: string }> {
    assertString(filename, 'export3MFPartsData(partIds, filename)', { optional: true });
    const r = await build3MFPartsExport(partIds, filename, opts);
    if ('error' in r) return r;
    return {
      filename: r.built.filename,
      mimeType: r.built.mimeType,
      sizeBytes: r.built.blob.size,
      base64: await blobToBase64(r.built.blob),
      parts: r.parts,
    };
  }

  const actionExport3MF = async () => {
    if (isSharedPreview()) { showToast('Fork this shared design before exporting.', { variant: 'warn' }); return; }
    if (!currentMeshData) { noGeometryToast(); return; }
    if (!(await confirmExportOrProceed('3MF'))) return;
    // Multi-part session → offer the part picker and emit a GENERIC multi-object
    // 3MF (grid-arranged, no Bambu metadata). Single-part keeps the original
    // single-object export.
    if (getState().parts.length > 1) { await export3MFMultiPartFlow(false); return; }
    try { showToast(`Exported ${export3MF(fileExportMesh(true)!)}`, { variant: 'success' }); }
    catch (e) { showToast(e instanceof Error ? e.message : '3MF export failed', { variant: 'warn' }); }
  };
  // Bambu/Orca multi-plate 3MF — a SEPARATE export from the generic 3MF above.
  // Opens the part picker and bundles the chosen parts into one Bambu project
  // (one part per build plate, colours bound to AMS filaments). Available for any
  // session (single-part too); it always emits the Bambu project layer.
  const actionExport3MFBambu = async () => {
    if (isSharedPreview()) { showToast('Fork this shared design before exporting.', { variant: 'warn' }); return; }
    if (!currentMeshData) { noGeometryToast(); return; }
    if (!(await confirmExportOrProceed('3MF'))) return;
    await export3MFMultiPartFlow(true);
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
  /** Mesh for a triangle-mesh file export (STL / OBJ / 3MF). Voxel sessions get
   *  a greedy-meshed copy straight from the grid — coplanar same-color faces are
   *  coalesced, cutting triangle count (and file size) several-fold. Greedy
   *  meshing introduces T-junctions: harmless in a triangle-soup export, but
   *  they break Manifold.ofMesh, so it stays OUT of the render / stats / slicing
   *  path (those keep the per-face manifold mesh from `meshGrid`). `colored`
   *  bakes paint/relief regions for non-voxel meshes; voxel grids already carry
   *  their per-voxel colors. Returns null only when there's nothing to export. */
  const fileExportMesh = (colored: boolean): MeshData | null => {
    if (getActiveLanguage() === 'voxel') {
      const grid = getCurrentVoxelGrid();
      // Greedy meshing applies to BLOCKY surfacing only. A smoothed grid must
      // export the rounded mesh the viewport (and GLB) show, not blocky cubes —
      // and greedy wins nothing on a smoothed mesh anyway (no large coplanar
      // same-color runs to coalesce), so fall through to currentMeshData.
      if (grid && grid.surfacing().mode !== 'smooth') return greedyMeshGrid(grid);
    }
    if (!currentMeshData) return null;
    return colored ? coloredMeshForExport(currentMeshData) : currentMeshData;
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

  /** Axis-aligned bbox of the current export mesh, for the publish description. */
  const currentModelDims = (): [number, number, number] | null => {
    const m = currentMeshData;
    if (!m || m.numVert === 0) return null;
    const v = m.vertProperties, stride = m.numProp;
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (let i = 0; i < m.numVert; i++) {
      const x = v[i * stride], y = v[i * stride + 1], z = v[i * stride + 2];
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
      if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
    }
    return [maxX - minX, maxY - minY, maxZ - minZ];
  };

  /** Build a downloadable file in the requested format for the publish flow.
   *  Mirrors the single-part export paths (colour-bake where the format carries
   *  it). Returns null when there's no geometry. */
  const buildPublishFile = async (
    format: PublishFormat,
  ): Promise<{ blob: Blob; filename: string } | null> => {
    if (format === 'glb') {
      if (!currentMeshData) return null;
      assertFiniteMesh(currentMeshData);
      const built = await buildGLB(undefined, coloredMeshForExport(currentMeshData));
      return { blob: built.blob, filename: built.filename };
    }
    // MakerWorld's preferred 3MF is the Bambu Studio / OrcaSlicer project flavour
    // (build plate + AMS filament bindings) — same builder as the toolbar's
    // "3MF — Bambu/Orca" export, here for the single active model with default
    // printer settings.
    if (format === '3mf-bambu') {
      const mesh = fileExportMesh(true);
      if (!mesh) return null;
      const bed = loadPrinterSettings().bed;
      const built = build3MFProject([{ name: getState().session?.name ?? 'model', mesh }], {
        bambu: true, bedSize: [bed[0], bed[1]],
        printer: DEFAULT_BAMBU_PRINTER, nozzle: '0.4', filament: DEFAULT_BAMBU_FILAMENT,
      });
      return { blob: built.blob, filename: built.filename };
    }
    const mesh = fileExportMesh(format !== 'stl');
    if (!mesh) return null;
    const built = format === '3mf' ? build3MF(mesh)
      : format === 'obj' ? buildOBJ(mesh)
      : buildSTL(mesh);
    return { blob: built.blob, filename: built.filename };
  };

  /** Render the publish cover PNG as bytes, or null when there's no geometry. */
  const buildPublishCover = async (): Promise<Uint8Array | null> => {
    if (!currentMeshData) return null;
    const canvas = renderSingleViewCanvas(applyTriColorsIfVisible(currentMeshData), {
      elevation: 25, azimuth: 45, size: 1024,
    });
    const blob = await new Promise<Blob | null>(res => canvas.toBlob(res, 'image/png'));
    if (!blob) return null;
    return new Uint8Array(await blob.arrayBuffer());
  };

  /** Bundle the model file (+ optional cover + details.txt) into ONE ZIP, so the
   *  user gets a single download instead of several files (which trips the
   *  browser's "open multiple files?" prompt). */
  const buildPublishBundle = async (opts: {
    format: PublishFormat;
    includeCover: boolean;
    detailsText: string;
  }): Promise<{ blob: Blob; filename: string } | null> => {
    const file = await buildPublishFile(opts.format);
    if (!file) return null;
    const entries: ZipEntry[] = [
      { name: file.filename, data: new Uint8Array(await file.blob.arrayBuffer()) },
      { name: 'details.txt', data: new TextEncoder().encode(opts.detailsText) },
    ];
    if (opts.includeCover) {
      const cover = await buildPublishCover();
      if (cover) entries.push({ name: 'cover.png', data: cover });
    }
    const zip = buildZip(entries);
    // ArrayBuffer copy so the Blob doesn't alias the SharedArrayBuffer-backed view.
    const zipBytes = new Uint8Array(zip.byteLength);
    zipBytes.set(zip);
    const blob = new Blob([zipBytes], { type: 'application/zip' });
    const filename = getExportFilename('zip').replace(/\.zip$/, '-publish.zip');
    return { blob, filename };
  };

  /** Open the assisted-publish modal (Printables / MakerWorld / Thingiverse /
   *  Thangs). `preselect` optionally focuses one platform. */
  const actionPublish = async (preselect?: string): Promise<void> => {
    if (isSharedPreview()) { showToast('Fork this shared design before publishing.', { variant: 'warn' }); return; }
    if (!currentMeshData) { noGeometryToast(); return; }
    // "Auto-populate with AI" is only offered when the active provider is
    // connected; otherwise the modal disables the button with a tooltip.
    const aiAvailable = await isActiveProviderConnected();
    openPublishModal({
      defaultTitle: getState().session?.name ?? 'My model',
      stats: { dims: currentModelDims(), units: _getUnits() },
      buildBundle: buildPublishBundle,
      download: (blob, filename) => downloadBlob(blob, filename, 'Publish'),
      aiAvailable,
      aiGenerate: aiAvailable
        ? async () => {
            const sessionId = getState().session?.id;
            if (!sessionId) throw new Error('Open or create a session first.');
            return generatePublishMetadata(sessionId);
          }
        : undefined,
      preselect,
    });
  };

  // Create toolbar
  createToolbar(editorUI, {
    onGoHome: () => {
      // The landing page is a separate static document that does NOT load this
      // app bundle, so going home is a real navigation, not an in-app render.
      window.location.assign(appPath('/'));
    },
    onRun: () => runCode(),
    onExportGLB: actionExportGLB,
    onExportSTL: actionExportSTL,
    onExportOBJ: actionExportOBJ,
    onExport3MF: actionExport3MF,
    onExport3MFBambu: actionExport3MFBambu,
    onExportVOX: actionExportVOX,
    onExportSTEP: actionExportSTEP,
    onExportSessionJSON: async () => {
      if (!getState().session) {
        showToast('No active session to export. Save a version first.', { variant: 'warn', source: 'export' });
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
      if (!ok) showToast('No active session to export. Save a version first.', { variant: 'warn', source: 'export' });
    },
    onShareLink: () => { void actionShareLink(); },
    onPublish: () => { void actionPublish(); },
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

  // "Did you know?" hints ticker — mounts into the toolbar's middle host
  // (#editor-hints-host, created by createToolbar between the language "?" and
  // the "Use AI" button). The ticker mounts/unmounts inside it as it's toggled.
  // Shown by default; hidden per-session via its ✕ or permanently in Advanced
  // Settings (config.ui.editorHintsEnabled).
  // Query within editorUI (not document) — it isn't attached to the page yet.
  const hintsHost = editorUI.querySelector<HTMLElement>('#editor-hints-host');
  if (hintsHost) mountHintsTicker(hintsHost);

  // Init diagnostic panel — attaches to document.body, registers badge subscriber.
  initDiagnosticsPanel();

  // Reset the editor to a blank starting point for a freshly created session.
  // Shared by the session bar's "+ New Session" button and the session modal's,
  // so both clear the previous session's code instead of leaving it behind.
  function resetEditorToStarter() {
    void seedStarter(getActiveLanguage());
  }

  // Seed the editor with the next starter in `lang`'s rotation, run it, and —
  // for engines that can't carry colour in code (scad, replicad) — paint its
  // label a basic starting colour once the run registers it. Used by
  // new-session/new-part resets, language switches, and the fresh-session entry
  // points (landing, ideas, share/stale-URL fallbacks). Drops any prior paint
  // first so the fresh starter (and its auto-paint) doesn't inherit a previous
  // buffer's regions across a language switch. runCodeSync (no preserveCamera)
  // auto-frames the fresh model, matching the old behaviour.
  async function seedStarter(lang: Language): Promise<void> {
    dropPaintState();
    const starter = nextStarter(lang);
    setValue(starter.code);
    const ran = await runCodeSync(starter.code, { surfaceErrors: false });
    if (ran && starter.paint) {
      const color = parseLabelColor(starter.paint.colorHex);
      if (color) partwrightAPI.paintByLabel({ label: starter.paint.label, color });
    }
  }

  function startNewSessionInEditor() {
    resetEditorToStarter();
    _clearAttachments();
  }

  // Reset the editor for a freshly created part. Unlike a new session, parts
  // share the session's attachments, so those are left intact.
  function startNewPartInEditor() {
    resetEditorToStarter();
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
    const cached = version ? partMeshCache.get(version.id) : undefined;
    // Only clear the viewport when there is no cached mesh to restore — avoids
    // a blank-viewport flash during the recompile that cache hits skip entirely.
    if (!cached) clearMesh();
    if (version) {
      await loadVersionIntoEditor(version, opts, cached);
    } else {
      if (getActiveLanguage() !== 'manifold-js') await switchLanguage('manifold-js');
      // Await the starter render (seedStarter runs the code + applies its label
      // color) rather than the fire-and-forget startNewPartInEditor(). A part
      // switch must not "complete" until the new part's geometry is on screen —
      // otherwise a caller that captures a thumbnail right after (the Save-all
      // loop) reads the previous part's stale mesh, so freshly-created parts all
      // get one wrong, colorless thumbnail.
      await seedStarter(getActiveLanguage());
      // Attachments are session-level, not version-level. The version-load path
      // (loadVersionIntoEditor) restores them, but a session with attachments
      // and NO saved version reaches the editor through this branch — so without
      // this it would lose its attachments on refresh. See
      // restoreAttachmentsForActiveSession.
      await restoreAttachmentsForActiveSession();
    }
  }

  /** Reload the active session's attachments (stored on the Session row) into
   *  the in-memory mirror. Session-level data: restored on every session open,
   *  independent of version/part loading, so attachments survive a refresh even
   *  when the session has no saved version. */
  async function restoreAttachmentsForActiveSession(): Promise<void> {
    const sessionAttachments = await getAttachmentsFromSession();
    if (sessionAttachments) {
      _setAttachments(sessionAttachments);
    } else {
      _clearAttachments();
    }
  }

  /** Switch the active part and load it (plus any stashed unsaved draft) into
   *  the editor — the shared body behind the parts-rail click AND the
   *  multi-part save flow's "visit each part to save it" loop. Stashes the
   *  outgoing part's buffer as a draft first so nothing is lost on the switch. */
  async function selectPart(partId: string): Promise<void> {
    // Cancel any in-flight render so stale previews can't land on the viewport
    // after we've switched away to a different part.
    cancelCurrentExecution();
    // Save any unsaved non-starter edits as a version (imported SCAD with
    // errors, etc.) so they survive the switch and are loadable on return.
    await preserveCurrentEditsIfNeeded();
    // Also stash the raw editor buffer as a per-part draft BEFORE changePart
    // runs — after that call currentPart is already the incoming part, so
    // saving inside loadVersionIntoEditor would land under the wrong id.
    const { session, currentPart } = getState();
    if (session && currentPart) {
      await writeDraft(session.id, getActiveLanguage(), getValue(), currentPart.id, getCompanionFiles(), currentDraftRegions());
    }
    const version = await changePart(partId);
    // skipDraftSave: the outgoing draft was already saved above.
    await loadPartIntoEditor(version, { skipDraftSave: true });
    // Restore the incoming part's unsaved work (if any) on top of the saved
    // version that loadPartIntoEditor just loaded.
    await restoreDraftIfNewer();
  }

  // Assigned to the modal-aware save once it's defined below; the session bar's
  // Save button reads it through this mutable handle so a click and Cmd/Ctrl+S
  // run identical logic (including the multi-part save modal).
  let saveVersionFromUI: (() => void | Promise<void>) | undefined;

  // Create session bar. The 💾 Save button defers to `saveVersionFromUI` (the
  // modal-aware save assigned below, once it's defined) so clicking Save and
  // pressing Cmd/Ctrl+S share the exact same multi-part flow.
  createSessionBar(editorUI, {
    onSave: () => { void saveVersionFromUI?.(); },
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
  const { editorContainer, companionFilesBar, editorErrorPanel, viewportPane, galleryContainer, versionsContainer, imagesContainer, diffContainer, notesContainer, dataContainer, statusBar, cancelInlineBtn, clipControls, findReplaceBtn, formatBtn, autoFormatToggle, lineWrapToggle, lineNumbersToggle, fontSizeDecBtn, fontSizeIncBtn, fontSizeValueEl, switchTab, partsRail, togglePartsRail, collapseEditor, expandEditor } = createLayout(editorUI, {
    onToggleAi: () => { void toggleAiPanelFromToolbar(); },
    onOpenCatalog: () => { void showCatalogPage(); },
    onToggleDiagnostics: () => { toggleDiagnosticsPanel(); },
    onOpenSessionList: () => showSessionList(),
    // The rail only renders inside the editor, so the tour's spotlight targets
    // already exist — start it directly without re-navigating.
    onStartTour: () => { resetTour(); startTour(); },
  });

  // Printability indicator pill — shown in the viewport overlay when the model
  // has standing structural issues that would prevent 3D printing (e.g.
  // non-manifold mesh). The disconnected-components warning is split off into a
  // transient toast (see updateGeometryData); the pill is hidden when no
  // pill-level issue remains.
  printabilityIndicatorEl = document.createElement('span');
  printabilityIndicatorEl.className = 'absolute top-8 left-2 z-20 text-xs text-amber-300 font-mono bg-zinc-900/80 px-2 py-0.5 rounded border border-amber-700/60 cursor-help';
  // A persistent status indicator, not a transient toast: it stays up while the
  // current model has structural issues that would prevent a clean 3D print.
  // The title explains what it is so it doesn't read as a stray message (and is
  // hoverable — hence no `pointer-events-none`).
  printabilityIndicatorEl.title = 'This model has structural issues that may prevent a clean 3D print. Open the ⚠ Diagnostic Log in the toolbar for details.';
  printabilityIndicatorEl.style.display = 'none';
  viewportPane.appendChild(printabilityIndicatorEl);

  // Fast-preview pill — shown while the viewport is displaying the rough coarse
  // pass of a slow SDF model (figures) and the full-quality render is still
  // running in the Worker. A status indicator, not a toast: it clears the moment
  // the full mesh lands (or the run errors/cancels). See runCodeSync's preview
  // callback. Title explains the swap so the rough→sharp transition isn't a
  // surprise.
  fastPreviewPillEl = document.createElement('span');
  fastPreviewPillEl.className = 'text-xs text-sky-300 font-mono bg-zinc-900/80 px-2 py-0.5 rounded border border-sky-700/60 cursor-help whitespace-nowrap';
  fastPreviewPillEl.textContent = '⚡ Fast preview';
  fastPreviewPillEl.title = 'Showing a quick rough version of this model. The full-detail render is still computing and will replace it automatically. Wait for it before painting or editing the mesh.';
  fastPreviewPillEl.style.display = 'none';
  // Live inside the status row (next to the "Rendering… Xs" text + Cancel button)
  // rather than as its own absolute overlay, so it never stacks on top of them.
  (cancelInlineBtn.parentElement ?? viewportPane).appendChild(fastPreviewPillEl);

  // Owners of the inline Cancel button when an SDF surface carve (engrave /
  // voronoi lamp) is running. Declared here — early, before the initial
  // syncEditorFromURL render — so the click handler attached just below can
  // close over them without a temporal-dead-zone error. They're assigned in
  // buildSurfaceModifierProgress far below.
  let surfaceCarveAbort: AbortController | null = null;
  let surfaceCarveCancel: (() => void) | null = null;

  // Wire the Cancel button NOW, before the first deep-link render. main() awaits
  // the initial render inside syncEditorFromURL(), so attaching this handler at
  // its natural spot far below left the button visible-but-dead for the whole
  // first render of a slow model — exactly the catalog-figure case where the
  // fast-preview pill + "Rendering… Xs" timer + Cancel button all appear but the
  // click did nothing. Precedence: a running surface carve owns it (aborts the
  // SDF sweep); then an in-flight surface-texture chain (terminates the surface
  // Worker — the base mesh stays + the Re-apply pill appears); otherwise it
  // cancels the current engine execution (terminates the geometry Worker).
  cancelInlineBtn.addEventListener('click', () => {
    if (surfaceCarveCancel) { surfaceCarveCancel(); return; }
    if (cancelSurfaceCompute()) return;
    cancelCurrentExecution();
  });

  // Surface "Re-apply" pill — a persistent status indicator (not a transient
  // toast) shown when the model declares `api.surface.*` textures whose result
  // isn't cached for the current code/params. Until pressed, the viewport shows
  // the untextured base mesh; pressing it computes the texture chain on demand.
  surfaceReapplyEl = document.createElement('button');
  surfaceReapplyEl.className = 'absolute top-2 left-2 z-20 text-xs text-sky-200 font-mono bg-zinc-900/85 px-2 py-0.5 rounded border border-sky-700/60 cursor-pointer hover:bg-zinc-800/90 transition-colors';
  surfaceReapplyEl.textContent = '⟳ Textures stale — Re-apply';
  surfaceReapplyEl.title = 'This model declares api.surface.* textures that haven’t been computed for the current code. The base shape is shown; click to apply the texture(s).';
  surfaceReapplyEl.style.display = 'none';
  surfaceReapplyEl.addEventListener('click', () => { void reapplySurfaceTextures(); });
  viewportPane.appendChild(surfaceReapplyEl);

  // Parts rail — IDE-style list of the session's parts.
  createPartList(partsRail, {
    onSelectPart: (partId: string) => selectPart(partId),
    onCreatePart: async () => {
      // Structural part edits are leader-only — a read-only viewer must not
      // write to the shared session (mirrors the run/save guard).
      if (isReadOnlyViewer()) return;
      // Stash the current part's buffer as a draft before switching away so its
      // unsaved work survives and is detectable by the multi-part save modal.
      // Unlike the rail-switch path we deliberately DON'T auto-save it as a
      // version — leaving it unsaved is exactly what surfaces it in that modal.
      const { session, currentPart } = getState();
      if (session && currentPart && (!isStarterCode(getValue()) || hasColorRegions())) {
        await writeDraft(session.id, getActiveLanguage(), getValue(), currentPart.id, getCompanionFiles(), currentDraftRegions());
      }
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
    onViewAllParts: () => { void openAssembly(); },
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

  // Editor settings menu (⚙) — Format / Auto-format / Word wrap / Line numbers /
  // Font size. Each toggle renders as a compact On/Off pill via a shared helper.
  const TOGGLE_ON_CLASS = 'shrink-0 px-2 py-0.5 rounded text-[11px] leading-none border text-emerald-400 border-emerald-700 bg-emerald-950/40 hover:bg-emerald-900/40 min-w-[2.75rem] text-center';
  const TOGGLE_OFF_CLASS = 'shrink-0 px-2 py-0.5 rounded text-[11px] leading-none border text-zinc-400 border-zinc-700 hover:text-zinc-200 min-w-[2.75rem] text-center';
  function syncTogglePill(btn: HTMLButtonElement, on: boolean, name: string): void {
    btn.textContent = on ? 'On' : 'Off';
    btn.title = `${name}: ${on ? 'on' : 'off'} — click to toggle`;
    btn.setAttribute('aria-pressed', String(on));
    btn.className = on ? TOGGLE_ON_CLASS : TOGGLE_OFF_CLASS;
  }
  const syncAutoFormatToggleUI = (): void => syncTogglePill(autoFormatToggle, getAutoFormat(), 'Auto-format on load');
  const syncLineWrapToggleUI = (): void => syncTogglePill(lineWrapToggle, getLineWrap(), 'Word wrap');
  const syncLineNumbersToggleUI = (): void => syncTogglePill(lineNumbersToggle, getLineNumbers(), 'Line numbers');
  function syncFontSizeUI(): void {
    const px = getFontSize();
    const { min, max } = getFontSizeBounds();
    fontSizeValueEl.textContent = `${px}px`;
    fontSizeDecBtn.disabled = px <= min;
    fontSizeIncBtn.disabled = px >= max;
    fontSizeDecBtn.classList.toggle('opacity-40', fontSizeDecBtn.disabled);
    fontSizeDecBtn.classList.toggle('cursor-not-allowed', fontSizeDecBtn.disabled);
    fontSizeIncBtn.classList.toggle('opacity-40', fontSizeIncBtn.disabled);
    fontSizeIncBtn.classList.toggle('cursor-not-allowed', fontSizeIncBtn.disabled);
  }
  syncAutoFormatToggleUI();
  syncLineWrapToggleUI();
  syncLineNumbersToggleUI();
  syncFontSizeUI();

  findReplaceBtn.addEventListener('click', () => openFindReplace());
  formatBtn.addEventListener('click', () => formatCode());
  autoFormatToggle.addEventListener('click', () => {
    setAutoFormat(!getAutoFormat());
    syncAutoFormatToggleUI();
  });
  lineWrapToggle.addEventListener('click', () => {
    setLineWrap(!getLineWrap());
    syncLineWrapToggleUI();
  });
  lineNumbersToggle.addEventListener('click', () => {
    setLineNumbers(!getLineNumbers());
    syncLineNumbersToggleUI();
  });
  fontSizeDecBtn.addEventListener('click', () => {
    setFontSize(getFontSize() - 1);
    syncFontSizeUI();
  });
  fontSizeIncBtn.addEventListener('click', () => {
    setFontSize(getFontSize() + 1);
    syncFontSizeUI();
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

  // Save the CURRENT part and toast the outcome — the single-part save path.
  const saveCurrentPartWithToast = async () => {
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
    } else if (getGeometryDataObj()?.status === 'error') {
      // Checkpointing a broken model is allowed, but warn that this version
      // won't render correctly so the save isn't mistaken for a clean one.
      showToast(`Saved v${result.index}${result.label ? ` — ${result.label}` : ''}, but the model has errors and won't render correctly`, { variant: 'warn' });
    } else {
      showToast(`Saved v${result.index}${result.label ? ` — ${result.label}` : ''}`, { variant: 'success' });
    }
  };

  /** Parts in the active session with unsaved changes, in left-panel order.
   *  The current part is judged from the live editor buffer; the others from
   *  their stashed per-part drafts. */
  const gatherUnsavedParts = async (): Promise<UnsavedPartRow[]> => {
    const { session, parts, currentPart } = getState();
    if (!session) return [];
    const rows: UnsavedPartRow[] = [];
    for (const part of parts) {
      const isCurrent = part.id === currentPart?.id;
      if (isCurrent) {
        if (!currentPartIsDirty(
          getValue(),
          enrichGeometryDataWithColors(getGeometryDataObj()),
          { paramValues: currentParamValues, companionFiles: getCompanionFiles() },
        )) continue;
        // No committed version + untouched starter buffer = "no changes yet".
        const empty = !getState().currentVersion && isStarterCode(getValue());
        rows.push({ id: part.id, name: part.name, isCurrent, status: empty ? 'empty' : 'unsaved' });
      } else {
        const state = await partSaveState(part);
        if (state === 'clean') continue;
        rows.push({ id: part.id, name: part.name, isCurrent, status: state });
      }
    }
    return rows;
  };

  /** Save several parts in one action: each non-current part is loaded into the
   *  editor (which restores its stashed draft and re-runs its code, so the saved
   *  version carries the right geometry + thumbnail), saved, then the original
   *  part is restored. The current part is saved in place first to avoid an
   *  unnecessary round-trip. */
  const saveSelectedParts = async (partIds: string[]): Promise<{ saved: number; failed: number }> => {
    const wanted = new Set(partIds);
    const originalPartId = getState().currentPart?.id ?? null;
    // Preserve the rail's order; only touch parts the user kept checked.
    const ordered = getState().parts.filter(p => wanted.has(p.id));
    let saved = 0;
    let failed = 0;
    const tally = async () => {
      try {
        const result = await saveCurrentVersion();
        if ('error' in result) failed++;
        else if (!('skipped' in result)) saved++;
        // 'skipped' = nothing actually changed (a race or already-saved); no-op.
      } catch {
        failed++;
      }
    };
    try {
      // Current part first, in place — no part switch needed.
      if (originalPartId && wanted.has(originalPartId)) await tally();
      for (const part of ordered) {
        if (part.id === originalPartId) continue;
        await selectPart(part.id);
        await tally();
      }
    } finally {
      // Always return to where the user was, even if a save threw.
      if (originalPartId && getState().currentPart?.id !== originalPartId) {
        await selectPart(originalPartId);
      }
    }
    if (failed > 0) {
      showToast(`Saved ${saved} part${saved === 1 ? '' : 's'}, ${failed} failed`, { variant: 'warn' });
    } else {
      showToast(`Saved ${saved} part${saved === 1 ? '' : 's'}`, { variant: 'success' });
    }
    return { saved, failed };
  };

  // Modal-aware save: when ≥2 parts have unsaved changes, let the user choose
  // whether to save just the current part or a selected subset; otherwise this
  // is the plain single-part save. Drives both Cmd/Ctrl+S and the 💾 button.
  const saveVersionWithToast = async () => {
    const unsaved = await gatherUnsavedParts();
    if (unsaved.length >= 2) {
      const choice = await showSaveAllModal(unsaved);
      if (choice.action === 'cancel') return;
      if (choice.action === 'selected') {
        const onlyCurrent = choice.partIds.length === 1 && choice.partIds[0] === getState().currentPart?.id;
        if (!onlyCurrent) {
          await saveSelectedParts(choice.partIds);
          return;
        }
      }
      // 'current', or a "selected" set that's just the current part → fall
      // through to the single-part save below (same toasts as a normal save).
    }
    await saveCurrentPartWithToast();
  };
  // Exposed so the session-bar 💾 button routes through the same modal flow.
  saveVersionFromUI = saveVersionWithToast;
  installKeyboardShortcuts({ onSave: saveVersionWithToast });

  // Viewport tools need the editor active and a model on screen to act on.
  const viewportToolEnabled = () => isEditorActive() && currentMeshData !== null;

  // Flip the permanent on/off for the hints ticker (also exposed in Advanced
  // Settings). Turning it on clears any per-session ✕-dismiss so it reappears.
  function toggleEditorHints(): void {
    const cfg = getConfig();
    const next = !cfg.ui.editorHintsEnabled;
    saveAppConfig({ ...cfg, ui: { ...cfg.ui, editorHintsEnabled: next } });
    if (next) showHintsTicker();
    showToast(next ? 'Editor hints shown' : 'Editor hints hidden', { variant: 'neutral' });
  }

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
    { id: 'tab-images', title: 'Go to Attachments', hint: 'Tab', keywords: 'photos reference images attachments files model document pdf', run: () => switchTab('images'), enabled: isEditorActive },
    { id: 'tab-diff', title: 'Go to Diff', hint: 'Tab', keywords: 'compare changes', run: () => switchTab('diff'), enabled: isEditorActive },
    { id: 'tab-notes', title: 'Go to Notes', hint: 'Tab', keywords: 'session notes', run: () => switchTab('notes'), enabled: isEditorActive },
    { id: 'tab-data', title: 'Go to Data', hint: 'Tab', keywords: 'storage browser indexeddb inventory', run: () => switchTab('data'), enabled: isEditorActive },
    { id: 'export-glb', title: 'Export GLB', hint: 'Export', keywords: 'download gltf 3d', run: () => { void actionExportGLB(); }, enabled: () => currentMeshData !== null },
    { id: 'export-stl', title: 'Export STL', hint: 'Export', keywords: 'download print', run: actionExportSTL, enabled: () => currentMeshData !== null },
    { id: 'export-obj', title: 'Export OBJ', hint: 'Export', keywords: 'download wavefront', run: actionExportOBJ, enabled: () => currentMeshData !== null },
    { id: 'export-3mf', title: 'Export 3MF', hint: 'Export', keywords: 'download print color', run: actionExport3MF, enabled: () => currentMeshData !== null },
    { id: 'export-3mf-bambu', title: 'Export 3MF — Bambu/Orca (multi-plate)', hint: 'Export', keywords: 'download print color bambu orca plate parts multi-part filament ams', run: actionExport3MFBambu, enabled: () => currentMeshData !== null },
    // VOX exports the voxel grid (getCurrentVoxelGrid), not currentMeshData, so
    // gate on the active language — the grid is re-derived on demand inside the
    // action, which also toasts if there's nothing to export. (Re-running the
    // model inside an `enabled` predicate would be far too heavy.)
    { id: 'export-vox', title: 'Export VOX', hint: 'Export', keywords: 'download magicavoxel voxel goxel', run: actionExportVOX, enabled: () => getActiveLanguage() === 'voxel' },
    // STEP exports the retained BREP shape, only available in replicad sessions
    // (mirrors the toolbar's STEP gating); the action toasts if no shape exists.
    { id: 'export-step', title: 'Export STEP', hint: 'Export', keywords: 'download brep cad solidworks fusion freecad', run: () => { void actionExportSTEP(); }, enabled: () => getActiveLanguage() === 'replicad' },
    { id: 'share-link', title: 'Share design (copy link)', hint: 'Share', keywords: 'url public link copy fork readonly', run: () => { void actionShareLink(); }, enabled: canShare },
    { id: 'publish-model', title: 'Publish to a print site…', hint: 'Share', keywords: 'printables makerworld bambu thingiverse thangs upload publish release post', run: () => { void actionPublish(); }, enabled: () => currentMeshData !== null && !isSharedPreview() },
    // Viewport tools — now grouped behind the View/Inspect/Tools popovers, so the
    // palette is the flat, searchable index of everything (keeps grouping cheap
    // for discoverability). Each fires the existing overlay button by id; click()
    // works even while the button sits inside a collapsed popover.
    { id: 'tool-measure', title: 'Measure distance', hint: 'Inspect', keywords: 'distance ruler dimension length point', run: () => document.getElementById('measure-toggle')?.click(), enabled: viewportToolEnabled },
    { id: 'tool-cross-section', title: 'Cross section', hint: 'Inspect', keywords: 'clip plane slice cut section interior', run: () => document.getElementById('clip-toggle')?.click(), enabled: viewportToolEnabled },
    { id: 'tool-paint', title: 'Paint colors', hint: 'Tools', keywords: 'color region brush bucket filament multicolor airbrush', run: () => document.getElementById('paint-toggle')?.click(), enabled: viewportToolEnabled },
    { id: 'tool-palette', title: 'Manage filament palette', hint: 'Tools', keywords: 'palette filament slots colours capacity', run: () => document.getElementById('palette-manager-toggle')?.click(), enabled: viewportToolEnabled },
    { id: 'tool-image-paint', title: 'Stamp image onto model', hint: 'Tools', keywords: 'image stamp decal texture paint photo logo', run: () => document.getElementById('image-paint-toggle')?.click(), enabled: viewportToolEnabled },
    { id: 'tool-annotate', title: 'Annotate (draw / text)', hint: 'Tools', keywords: 'draw pen text label note markup sketch arrow', run: () => document.getElementById('annotate-toggle')?.click(), enabled: viewportToolEnabled },
    { id: 'tool-quality', title: 'Quality: simplify / enhance', hint: 'Tools', keywords: 'simplify enhance decimate reduce triangles quality curvature smoothness', run: () => document.getElementById('simplify-toggle')?.click(), enabled: viewportToolEnabled },
    { id: 'tool-customize', title: 'Customize parameters', hint: 'Tools', keywords: 'parameters params sliders tweak knobs', run: () => document.getElementById('customize-toggle')?.click(), enabled: () => isEditorActive() && !document.getElementById('customize-toggle')?.classList.contains('hidden') },
    // These tools moved behind the Tools/Inspect popovers after the view-menu
    // refactor, so the palette is their only keyboard/search entry point. Each
    // fires the existing overlay toggle by id (click() works even collapsed).
    { id: 'tool-surface', title: 'Surface textures', hint: 'Tools', keywords: 'fuzzy knit cable waffle fur woven voronoi smooth voxelize texture modifier displace', run: () => document.getElementById('surface-viewport-toggle')?.click(), enabled: viewportToolEnabled },
    { id: 'tool-resize', title: 'Resize / scale model', hint: 'Tools', keywords: 'scale resize size dimensions grow shrink mm', run: () => document.getElementById('resize-viewport-toggle')?.click(), enabled: viewportToolEnabled },
    { id: 'tool-place', title: 'Place / orient on bed', hint: 'Tools', keywords: 'place orient rotate move position lay flat drop floor center bed', run: () => document.getElementById('place-viewport-toggle')?.click(), enabled: viewportToolEnabled },
    { id: 'tool-print', title: 'Print tools / check printability', hint: 'Inspect', keywords: 'print printability fdm overhang support wall thickness bed fit slicer 3d', run: () => document.getElementById('print-tools-toggle')?.click(), enabled: viewportToolEnabled },
    { id: 'tool-voxel-paint', title: 'Voxel Studio (edit voxels)', hint: 'Tools', keywords: 'voxel studio paint edit cube blocky pixel sculpt', run: () => document.getElementById('voxel-paint-toggle')?.click(), enabled: () => isEditorActive() && getActiveLanguage() === 'voxel' },
    { id: 'toggle-ai', title: 'Toggle AI panel', hint: 'View', keywords: 'chat assistant drawer', run: () => toggleAiPanel() },
    { id: 'toggle-diagnostics', title: 'Toggle diagnostics', hint: 'View', keywords: 'errors warnings console workers webworkers threads memory wasm performance restarts crash timing health log', run: () => toggleDiagnosticsPanel() },
    { id: 'open-catalog', title: 'Open catalog', hint: 'Navigate', keywords: 'examples premade browse', run: () => { void showCatalogPage(); } },
    { id: 'open-ideas', title: 'Open ideas', hint: 'Navigate', keywords: 'prompts examples inspiration showcase what can i do', run: () => { showIdeasPage(); } },
    { id: 'open-help', title: 'Open help', hint: 'Navigate', keywords: 'docs documentation guide', run: () => showHelp() },
    { id: 'open-whats-new', title: "Open what's new", hint: 'Navigate', keywords: 'changelog recent features updates release notes', run: () => showWhatsNewPage() },
    { id: 'open-quality', title: 'Settings', hint: 'Settings', keywords: 'resolution curve segments smoothness advanced', run: () => showAdvancedSettingsModal() },
    { id: 'retake-tour', title: 'Take the guided tour', hint: 'Help', keywords: 'onboarding walkthrough intro tutorial', run: () => { resetTour(); startTour(); }, enabled: isEditorActive },
    { id: 'toggle-hints', title: 'Toggle "Did you know?" hints', hint: 'View', keywords: 'did you know tips ticker discovery hints banner strip', run: () => toggleEditorHints() },
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
      _setAttachments(next);
      await persistAttachments(next);
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
    // The docked AI panel is an editor tool — restore it here (it only takes
    // layout space on the editor route; overlay pages render full-width).
    setAiPanelRouteActive(true);
    window.dispatchEvent(new Event('resize'));
    void ensureEngineStarted();
  }

  async function loadVersionIntoEditor(version: Version, opts: { skipDraftSave?: boolean; skipSurface?: boolean } = {}, cachedEntry?: PartMeshCacheEntry) {
    // Cancel any active voxel paint before loading a different version — its
    // live grid and provenance map are bound to the OUTGOING code, so a Bake
    // after navigation would write the wrong session's voxels into the new
    // editor. Also unlocks the editor and clears the floating panel.
    cancelVoxelPaintIfActive();
    // Preserve the user's interactive camera angle across version switches
    // *within* a session. Loading a version re-renders the geometry, whose
    // updateMesh auto-frames the camera back to the default 3/4 view — undoing
    // any orbit/zoom the user set. We snapshot the live pose here and restore it
    // after the new geometry is in (frameModel still runs, so clip range / grid /
    // near-far adapt to the new model's bounds — only the camera is put back).
    // runCodeSync applies the same preserve on the cache-miss compile and on the
    // debounced auto-run that re-renders ~300ms after a version load.
    const preservedCameraPose = captureCameraToPreserve();
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
        if (sid) await writeDraft(sid, getActiveLanguage(), getValue(), pid, getCompanionFiles(), currentDraftRegions());
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

    if (cachedEntry) {
      // Cache hit: restore previously computed mesh without recompiling.
      // Bump to MRU position in the LRU map.
      partMeshCache.delete(version.id);
      partMeshCache.set(version.id, cachedEntry);

      currentMeshData = cachedEntry.meshData;
      paintBaseMesh = cachedEntry.meshData;
      if (currentManifold && typeof currentManifold.delete === 'function') {
        try { currentManifold.delete(); } catch { /* already deleted */ }
      }
      const mod = getModule();
      try {
        currentManifold = (mod && cachedEntry.meshData) ? mod.Manifold.ofMesh(cachedEntry.meshData) : null;
      } catch {
        currentManifold = null;
      }
      currentLabelMap = cachedEntry.labelMap;
      currentLostLabels = cachedEntry.lostLabels;
      setPaintLabels(currentLabelMap);
      setModelColorRegions(cachedEntry.modelColorDecls);
      syncParamsPanel(cachedEntry.paramsSchema);
      // Show the geometry; colours (model underlay + any user paint) are applied
      // by the single rehydrateColorRegions pass below, which both load branches
      // share — so this branch no longer hand-rolls its own colour stamp (the
      // omission that shipped model-coloured parts restoring uncoloured). The
      // paint mesh stays the uncoloured base (it backs hit-testing).
      updateMesh(cachedEntry.meshData);
      updatePaintMesh(cachedEntry.meshData);
      geometryDataEl.textContent = version.geometryData
        ? JSON.stringify(version.geometryData, null, 2)
        : JSON.stringify({ status: 'ready' });
      if (printabilityIndicatorEl) {
        const geoData = version.geometryData ?? {};
        const { printable, issues } = computePrintability(geoData);
        if (printable) {
          printabilityIndicatorEl.style.display = 'none';
        } else {
          printabilityIndicatorEl.textContent = '⚠ ' + issues.join(' · ');
          printabilityIndicatorEl.style.display = '';
        }
      }
      syncClipSliderBounds();
      simplifyBaselineMesh = null;
      simplifyBaselineColoredMesh = null;
      simplifyBaselineRegions = null;
      simplifyBaselineModelRegions = null;
      refreshSimplifyIfOpen();
      // Cached entries come from completed runs (api.surface.* textures
      // applied), so a Re-apply pill raised by the previously shown version no
      // longer describes the restored mesh. The cache-miss branch clears it via
      // runCodeSync → applySurfaceTextures; this branch must do it explicitly.
      hideSurfaceReapplyPill();
      setStatus(statusBar, 'ready', 'Ready');
    } else {
      // Cache miss: compile the code and, on success, populate the cache.
      // preserveCamera keeps the user's interactive angle across the switch
      // (see captureCameraToPreserve); the cache-hit branch above relies on the
      // preservedCameraPose restore at the end of this function instead.
      //
      // If the version carries a persisted api.surface.* texture, seed the
      // memo cache with it first so the run's chain apply hits instantly
      // instead of recomputing — this is what makes a reopened session render
      // textured immediately, and what pins the texture to the mesh the user
      // saved (modifier math may have evolved since). The key is
      // self-validating: it hashes the BASE MESH CONTENT + op chain, so a seed
      // that doesn't match this run's recomputed key (different geometry, or a
      // pre-mesh-key save) is simply never read and the chain recomputes.
      const persistedTexture = version.surfaceTexture as PersistedSurfaceTexture | undefined;
      if (
        persistedTexture && typeof persistedTexture.key === 'string' &&
        persistedTexture.mesh && persistedTexture.mesh.vertProperties instanceof Float32Array &&
        persistedTexture.mesh.triVerts instanceof Uint32Array
      ) {
        seedSurfaceCache(persistedTexture.key, persistedTexture.mesh as MeshData);
      }
      const meshBeforeRun = currentMeshData;
      const genBeforeRun = _runGeneration;
      // Stage this version's saved colour-region *descriptors* (empty triangle
      // sets) into the store BEFORE the run, so the fast-preview pass can paint
      // an estimate of a painted figure's colours (byLabel / geometric regions
      // re-resolve against the coarse mesh — see colorCoarsePreview) instead of
      // showing bare grey for the tens of seconds a figure takes to fully render.
      // Without this the regions only arrive via rehydrateColorRegions AFTER the
      // run, so the preview had nothing to resolve. The full render re-resolves
      // them too, and rehydrateColorRegions below still owns the final resolution
      // (smooth-stroke replay etc.) — it clears + rebuilds, so this is a strict
      // head-start, not a competing source of truth.
      stageUnresolvedColorRegions(version.geometryData);
      const applied = await runCodeSync(version.code, { preserveCamera: true, skipSurface: opts.skipSurface });
      // If a newer version-switch arrived while we were compiling, our result
      // was discarded — don't rehydrate colours or annotations for the wrong version.
      if (!applied) {
        // The render didn't complete (most commonly: the user cancelled the slow
        // initial render of a catalog figure). rehydrateColorRegions needs a
        // finished mesh + labelMap to resolve regions, so it's skipped here — but
        // we must still stage the version's colour-region descriptors into memory,
        // or a Save would persist an empty store over the figure's colours and the
        // next edit→rerender would render colourless. They re-resolve on the next
        // successful run. Skip when a NEWER run superseded ours (runCodeSync bumped
        // _runGeneration past the one our call started): that newer run owns the
        // store and must not be clobbered with this version's descriptors.
        if (_runGeneration === genBeforeRun + 1) stageUnresolvedColorRegions(version.geometryData);
        return;
      }
      // Store the freshly compiled result so the next switch back is instant.
      // Only cache on a successful mesh-producing run (compile errors leave
      // currentMeshData as the previous part's mesh, i.e. unchanged).
      if (currentMeshData !== null && currentMeshData !== meshBeforeRun) {
        const entry: PartMeshCacheEntry = {
          meshData: currentMeshData,
          labelMap: currentLabelMap,
          lostLabels: currentLostLabels,
          modelColorDecls: getModelRegions().map(r => ({ name: r.name, color: r.color, triangles: new Set(r.triangles), descriptor: r.descriptor })),
          paramsSchema: currentParamSchema ?? undefined,
        };
        partMeshCache.delete(version.id);
        partMeshCache.set(version.id, entry);
        if (partMeshCache.size > PART_MESH_CACHE_SIZE) {
          // Evict the least-recently-used entry (first key in insertion-order map).
          const oldest = partMeshCache.keys().next().value;
          if (oldest) partMeshCache.delete(oldest);
        }
      }
    }

    // Restore the pre-switch camera angle (see capture above), or record this
    // session as framed so the *next* switch within it preserves the angle.
    if (preservedCameraPose) {
      setCameraPose(preservedCameraPose);
    }
    lastFramedSessionId = getState().session?.id ?? null;

    await rehydrateColorRegions(version.geometryData);
    applyVersionAnnotations(version);
    await restoreAttachmentsForActiveSession();
  }

  async function openEditorFromLanding() {
    updateAppHistory(appPath('/editor'), 'push');
    transitionToEditor();
    await ensureEditorReady();
    if (currentRoute() !== '/editor') return;
    await ensureEngineStarted();
    if (!engineOk) return;
    await createSession();
    updateDocumentTitle({ page: 'editor' });
    setStatus(statusBar, 'ready', 'Ready');
    void seedStarter('manifold-js');
  }

  // Launch the guided tour from an entry point outside the editor (the landing
  // CTA or the help page button): the tour spotlights editor chrome, so make
  // sure we're in the editor with a live session before it starts.
  async function takeGuidedTour() {
    updateAppHistory(appPath('/editor'), 'push');
    transitionToEditor();
    await ensureEditorReady();
    await ensureEngineStarted();
    if (!getState().session) {
      await createSession();
      void seedStarter('manifold-js');
    }
    resetTour();
    startTour();
  }

  // The landing page is a separate, static document — index.html's
  // #landing-inline markup, enhanced in place by src/landing/landingEntry.ts.
  // This app bundle is never loaded on the landing route, so "showing" the
  // landing from within the app is a real navigation back to "/", which loads
  // the lightweight landing entry instead of this bundle. (Callers: the boot
  // router and syncRouteFromURL's popstate handler.)
  function showLandingPage() {
    window.location.assign(appPath('/'));
  }

  function showNotFoundPage() {
    if (!notFoundEl) {
      notFoundEl = createNotFoundPage(overlayContainer, {
        onGoHome: () => {
          updateAppHistory(appPath('/'), 'push');
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
    setAiPanelRouteActive(false);
    updateDocumentTitle({ page: '404' });
  }

  // Helper to show help page
  function showHelp(options: { history?: 'push' | 'replace' | 'none' } = {}) {
    const historyMode = options.history ?? 'push';
    if (historyMode !== 'none') {
      helpHasAppBackTarget = currentRouteAndSearch() !== '/help';
      updateAppHistory(appPath('/help'), historyMode);
    }
    if (!helpEl) {
      helpEl = createHelpPage(overlayContainer, {
        onBack: () => {
          if (helpHasAppBackTarget) {
            window.history.back();
          } else {
            updateAppHistory(appPath('/editor'), 'replace');
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
    setAiPanelRouteActive(false);
    updateDocumentTitle({ page: 'help' });
  }

  // Helper to show legal page — mirrors showHelp's history / in-page-Back pattern.
  function showLegal(options: { history?: 'push' | 'replace' | 'none' } = {}) {
    const historyMode = options.history ?? 'push';
    if (historyMode !== 'none') {
      legalHasAppBackTarget = currentRouteAndSearch() !== '/legal';
      updateAppHistory(appPath('/legal'), historyMode);
    }
    if (!legalEl) {
      legalEl = createLegalPage(overlayContainer, {
        onBack: () => {
          if (legalHasAppBackTarget) {
            window.history.back();
          } else {
            updateAppHistory(appPath('/editor'), 'replace');
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
    setAiPanelRouteActive(false);
    updateDocumentTitle({ page: 'legal' });
  }

  let catalogEl: HTMLElement | null = null;
  let catalogElPromise: Promise<HTMLElement> | null = null;
  let catalogHasAppBackTarget = false;
  async function showCatalogPage(options: { history?: 'push' | 'replace' | 'none' } = {}) {
    const historyMode = options.history ?? 'push';
    if (historyMode !== 'none') {
      catalogHasAppBackTarget = currentRouteAndSearch() !== '/catalog';
      updateAppHistory(appPath('/catalog'), historyMode);
    }
    if (!catalogEl) {
      // createCatalogPage awaits a manifest fetch before returning, so guard the
      // async gap with an in-flight promise: rapid re-entry (a second click, or
      // the popstate the first click's pushState fires) must reuse the pending
      // build, not start a second one that appends another #catalog-page pane.
      if (!catalogElPromise) {
        catalogElPromise = createCatalogPage(overlayContainer, {
          onBack: () => {
            if (catalogHasAppBackTarget) {
              window.history.back();
            } else {
              updateAppHistory(appPath('/'), 'replace');
              void syncRouteFromURL();
            }
          },
          onLoadEntry: handleCatalogEntryLoad,
          onOpenIdeas: () => { showIdeasPage(); },
        });
      }
      catalogEl = await catalogElPromise;
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
    setAiPanelRouteActive(false);
    updateDocumentTitle({ page: 'catalog' });
  }

  let whatsNewEl: HTMLElement | null = null;
  let whatsNewHasAppBackTarget = false;
  function showWhatsNewPage(options: { history?: 'push' | 'replace' | 'none' } = {}) {
    const historyMode = options.history ?? 'push';
    if (historyMode !== 'none') {
      whatsNewHasAppBackTarget = currentRouteAndSearch() !== '/whats-new';
      updateAppHistory(appPath('/whats-new'), historyMode);
    }
    if (!whatsNewEl) {
      whatsNewEl = createWhatsNewPage(overlayContainer, {
        onBack: () => {
          if (whatsNewHasAppBackTarget) {
            window.history.back();
          } else {
            updateAppHistory(appPath('/'), 'replace');
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
    setAiPanelRouteActive(false);
    updateDocumentTitle({ page: 'whats-new' });
  }

  // Import a catalog entry as a fresh session and navigate to the editor.
  async function handleCatalogEntryLoad(_entry: CatalogManifestEntry, payload: ExportedSession) {
    // Push the editor history entry BEFORE importing. importSessionPayload
    // calls openSession() internally, which uses replaceState (see
    // sessionManager.updateURL). Without an earlier push, that replaceState
    // would clobber whatever page we came from (e.g. /catalog) and break the
    // browser back button.
    updateAppHistory(appPath('/editor'), 'push');
    transitionToEditor();
    await ensureEditorReady();
    await ensureEngineStarted();
    if (!engineOk) return;
    await importSessionPayload(payload);
    updateDocumentTitle({ page: 'editor' });
  }

  // Fetch a catalog entry by file name and import it. Used by the /editor?catalog=
  // deep-link from the static landing page. Mirrors handleCatalogEntryLoad but
  // sources the payload from the URL rather than an in-memory tile click. The
  // editor is already entered (this runs inside syncEditorFromURL), so no
  // history push is needed — importSessionPayload's openSession replaceState
  // rewrites the URL to /editor?session=<id>.
  async function loadCatalogFileIntoEditor(file: string): Promise<void> {
    try {
      const res = await fetch(assetPath(`/catalog/${file}`), { cache: 'no-cache' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const payload = await res.json() as ExportedSession;
      await importSessionPayload(payload);
      // importSessionPayload's openSession appended ?session=&v= but preserved
      // the one-shot ?catalog= param; drop it now for a clean editor URL.
      const url = new URL(window.location.href);
      if (url.searchParams.has('catalog')) {
        url.searchParams.delete('catalog');
        history.replaceState(history.state, '', url.pathname + url.search);
      }
      updateDocumentTitle({ page: 'editor' });
    } catch {
      // Couldn't load the entry (bad/removed file, offline). Don't leave the
      // editor stuck on "Loading WASM…" — fall back to a default session.
      if (!getState().session) await createSession();
      setStatus(statusBar, 'ready', 'Ready');
      void seedStarter('manifold-js');
    }
  }

  // === Ideas page handlers ===

  /** Enter the editor with a live session, ready for a hand-off. Used by the
   *  ideas-page actions: they all start by getting the user into the editor
   *  (pushing the history entry BEFORE any session mutation, same reason as
   *  handleCatalogEntryLoad). */
  async function enterEditorForIdea(): Promise<void> {
    updateAppHistory(appPath('/editor'), 'push');
    transitionToEditor();
    await ensureEditorReady();
  }

  // A starter/technique idea — drop its prompt into the AI panel (don't send).
  async function handleIdeaUsePrompt(idea: Idea): Promise<void> {
    await enterEditorForIdea();
    if (currentRoute() !== '/editor') return;
    if (!getState().session) {
      await createSession();
      setStatus(statusBar, 'ready', 'Ready');
      void seedStarter('manifold-js');
    }
    updateDocumentTitle({ page: 'editor' });
    prefillAiInput(idea.prompt ?? '');
  }

  // An interactive idea: turn the user's photo into a colored voxel session
  // (reuses the existing image→voxel import flow, modal and all).
  async function handleIdeaPhotoToVoxel(file: File): Promise<void> {
    await enterEditorForIdea();
    if (currentRoute() !== '/editor') return;
    await handleImageImport(file);
    updateDocumentTitle({ page: 'editor' });
  }

  // Open the Relief import wizard in 'luminance' (tonal) mode — the "smooth
  // relief / lithophane" idea promises a non-blocky result, unlike the global
  // 'quantized' default (flat blocky colour clusters). Shared by the in-app
  // tile and the /editor?idea= deep-link. Clone the defaults so we only
  // override the mode.
  function openReliefForIdea(file: File): void {
    const initialOptions: ReliefOptions = { ...structuredClone(DEFAULT_RELIEF_OPTIONS), mode: 'luminance' };
    openReliefImportFlow(file, initialOptions);
  }

  // An interactive idea: emboss the user's photo as a smooth relief tile
  // (reuses the existing Relief import wizard).
  async function handleIdeaPhotoToRelief(file: File): Promise<void> {
    await enterEditorForIdea();
    if (currentRoute() !== '/editor') return;
    openReliefForIdea(file);
    updateDocumentTitle({ page: 'editor' });
  }

  // Deep-link from the static /ideas page: /editor?idea=<id>. The static page
  // can't hand an in-memory tile click across a real navigation, so it links
  // here and we resolve the id against the IDEAS dataset. A prompt idea
  // prefills the AI panel; an interactive idea opens a photo picker, then runs
  // the same flow the in-app tile would. The editor is already entered (this
  // runs inside syncEditorFromURL), so there's no history push — we just strip
  // the one-shot ?idea= param for a clean URL.
  async function loadIdeaIntoEditor(id: string): Promise<void> {
    const clearIdeaParam = () => {
      const url = new URL(window.location.href);
      if (url.searchParams.has('idea')) {
        url.searchParams.delete('idea');
        history.replaceState(history.state, '', url.pathname + url.search);
      }
    };
    const idea = IDEAS.find((i) => i.id === id);
    // Ensure a live session exists either way (mirrors handleIdeaUsePrompt).
    if (!getState().session) {
      await createSession();
      setStatus(statusBar, 'ready', 'Ready');
      void seedStarter('manifold-js');
    }
    clearIdeaParam();
    updateDocumentTitle({ page: 'editor' });
    if (!idea) return; // unknown id — just land in a fresh editor session
    if (idea.category === 'interactive' && idea.action) {
      const action = idea.action;
      // No file came across the navigation — pick one here, then run the flow.
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      input.style.display = 'none';
      document.body.appendChild(input);
      input.addEventListener(
        'change',
        () => {
          const file = input.files?.[0];
          input.remove();
          if (!file) return;
          if (action === 'photoToVoxel') void handleImageImport(file);
          else openReliefForIdea(file);
        },
        { once: true },
      );
      input.click();
      // Cancelling the native picker fires no 'change' — reclaim the orphaned
      // input once focus returns (deferred so a real selection's change runs
      // first and removes it).
      window.addEventListener(
        'focus',
        () => setTimeout(() => { if (input.isConnected && !input.files?.length) input.remove(); }, 0),
        { once: true },
      );
    } else {
      prefillAiInput(idea.prompt ?? '');
    }
  }

  let ideasEl: HTMLElement | null = null;
  let ideasHasAppBackTarget = false;
  function showIdeasPage(options: { history?: 'push' | 'replace' | 'none' } = {}) {
    const historyMode = options.history ?? 'push';
    if (historyMode !== 'none') {
      ideasHasAppBackTarget = currentRouteAndSearch() !== '/ideas';
      updateAppHistory(appPath('/ideas'), historyMode);
    }
    if (!ideasEl) {
      ideasEl = createIdeasPage(overlayContainer, {
        onBack: () => {
          if (ideasHasAppBackTarget) {
            window.history.back();
          } else {
            updateAppHistory(appPath('/'), 'replace');
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
    setAiPanelRouteActive(false); // full-width page; panel restores in the editor
    // Content is up — drop the boot spinner that was held over the app load.
    document.getElementById('loading-splash')?.remove();
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
    window.history.replaceState(null, '', appPath('/editor') + window.location.search);
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
      void seedStarter('manifold-js');
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
    updateAppHistory(appPath('/editor'), 'push');
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

  /** Snapshot the current paint regions for stashing into a draft. Returns the
   *  serialized regions array when there are any user-painted regions, or
   *  undefined when the part is unpainted (so the draft omits the field). */
  const currentDraftRegions = (): SerializedColorRegion[] | undefined =>
    (hasColorRegions() ? serializeRegions() : undefined);

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
    if (draft == null) return;
    // Recover unsaved companion edits too: a draft whose code matches the loaded
    // version but whose companions differ still represents unsaved work.
    const isScad = getActiveLanguage() === 'scad';
    const draftCompanions = isScad ? (draft.companionFiles ?? {}) : {};
    const companionsDiffer = isScad && !companionFilesEqual(getCompanionFiles(), draftCompanions);
    const hasDraftPaint = !!(draft.colorRegions && draft.colorRegions.length > 0);
    // Skip only when code, companions, AND paint all match the loaded state.
    if (draft.code === getValue() && !companionsDiffer && !hasDraftPaint) return;
    if (draft.code !== getValue() || companionsDiffer) {
      // Code or companions changed \u2014 re-run to produce the correct mesh before
      // applying paint on top.
      if (isScad) setCompanionFiles(draftCompanions);
      setValue(draft.code);
      await runCodeSync(draft.code);
    }
    // Re-apply the stashed paint onto the (now-current) mesh. rehydrateColorRegions
    // clears existing user regions first, so it correctly supersedes whatever the
    // saved version had. Only rehydrate when the draft actually carries paint \u2014
    // if it doesn't, leave the existing paint state (loaded from the saved version)
    // untouched so we don't accidentally clear paint that was already there.
    if (hasDraftPaint) {
      await rehydrateColorRegions({ colorRegions: draft.colorRegions });
    }
  }

  async function syncEditorFromURL() {
    transitionToEditor();
    const tab = getTabFromURL();
    switchTab(tab, { history: 'none' });
    updateDocumentTitle({ page: 'editor' });
    await ensureEditorReady();
    await ensureEngineStarted();
    if (!engineOk) return;

    // Catalog deep-link: /editor?catalog=<file> imports that catalog entry as a
    // fresh session. The static landing page links its catalog tiles here
    // because it can't hand an in-memory payload across a real navigation.
    const catalogFile = new URLSearchParams(window.location.search).get('catalog');
    if (catalogFile) {
      await loadCatalogFileIntoEditor(catalogFile);
      return;
    }

    // Ideas deep-link: /editor?idea=<id> hands off from the static /ideas page.
    const ideaId = new URLSearchParams(window.location.search).get('idea');
    if (ideaId) {
      await loadIdeaIntoEditor(ideaId);
      return;
    }

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
    void seedStarter('manifold-js');
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

  // Persist the interactive working-view camera per session so the angle/zoom
  // survives reload and reopening (restored on open via captureCameraToPreserve).
  // Debounced on the orbit-end gesture; only when a model is shown for the active
  // session. Programmatic camera moves don't fire 'end', so auto-frames and
  // restores never write back.
  let _workCameraSaveTimer: number | undefined;
  onOrbitEnd(() => {
    if (_workCameraSaveTimer !== undefined) clearTimeout(_workCameraSaveTimer);
    // Capture which session this orbit belongs to. setSessionWorkCamera writes
    // to whatever session is active *at fire time*, so if the user switches
    // sessions within the debounce window the pending save would otherwise
    // stamp the new session's row with the old session's pose. Discard the
    // save if the active session changed before the timer elapses.
    const orbitedSessionId = getState().session?.id ?? null;
    // Snapshot inside the debounced callback, not here: 'end' fires at gesture
    // release while OrbitControls damping is still gliding, so reading the pose
    // now would persist a pre-settle angle. By the time the debounce elapses the
    // camera has come to rest, so the saved view matches what the user sees.
    _workCameraSaveTimer = window.setTimeout(() => {
      _workCameraSaveTimer = undefined;
      if (currentMeshData === null) return;
      const cur = getState().session;
      if (!cur || cur.id !== orbitedSessionId) return; // session changed — discard
      void setSessionWorkCamera(getCameraPose());
    }, getConfig().ui.workCameraSaveDebounceMs);
  });

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
  // A "Customize" toggle button lives in the viewport Tools dropdown (one of the
  // model-editing tools) and is the discoverable open/reopen affordance: it
  // appears in the menu only when the active model declares parameters, shows the
  // count, and mirrors the panel's open state — so closing the panel never
  // strands the user without a way back in. When a parameterizable model is first
  // opened, the panel auto-reveals and pops the Tools dropdown open with it (see
  // onAutoReveal), so the tool list sits just above the freshly-docked panel.
  const customizeBtn = document.createElement('button');
  customizeBtn.id = 'customize-toggle';
  customizeBtn.title = 'Tweak this model’s parameters';
  customizeBtn.className = `hidden ${TOOL_TOGGLE_IDLE}`; // shown by syncCustomizeBtn once a run reports params
  customizeBtn.addEventListener('click', () => paramsPanel?.toggle());
  const syncCustomizeBtn = (state: { hasParams: boolean; open: boolean; count: number }) => {
    customizeBtn.textContent = state.count > 0 ? `🎛 Customize (${state.count})` : '🎛 Customize';
    customizeBtn.className = state.open ? TOOL_TOGGLE_ACTIVE : TOOL_TOGGLE_IDLE;
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
    // First open of a parameterizable model: surface the Tools dropdown the
    // Customize button sits in, so the tool list shows just above the panel.
    onAutoReveal: () => openPopoverGroupById('viewport-tools'),
  });
  viewportPane.appendChild(paramsPanel.element);
  // Customize joins the other model-editing tools inside the Tools popover, hidden
  // until a model declares params. The Customize panel docks beneath the open
  // Tools menu (see viewportPanelDrag's dockUnderBottom), so the two read as one
  // unit when auto-revealed.
  viewportToolsMount(clipControls).appendChild(customizeBtn);

  // "All parts" toggle — the in-viewport entry point to the grid Assembly view
  // (the part-list "▦" button is the other). Shown only for multi-part sessions;
  // reflects and drives the open/closed state. Escape also exits the view.
  assemblyMount = viewportPane;
  assemblyToggleBtn = document.createElement('button');
  assemblyToggleBtn.id = 'assembly-toggle';
  assemblyToggleBtn.textContent = '⧉ All parts';
  assemblyToggleBtn.title = 'View all parts together in a 3D grid (Assembly)';
  assemblyToggleBtn.className = `hidden ${TOOL_TOGGLE_IDLE}`;
  assemblyToggleBtn.addEventListener('click', () => toggleAssembly());
  viewportToolsMount(clipControls).appendChild(assemblyToggleBtn);
  // Keep the toggle's visibility in sync with the part count (hidden for
  // single-part sessions). Also close the view if the session drops to one part.
  onStateChange((state) => {
    const multi = !!(state.session && state.parts.length > 1);
    // Close the view if it can no longer be shown (dropped to one part) or if the
    // set of parts changed out from under it (add/delete/reorder → stale records).
    if (isAssemblyViewOpen() && (!multi || partsSignature() !== assemblyOpenSig)) {
      closeAssembly();
      return;
    }
    if (!isAssemblyViewOpen()) syncAssemblyToggle(false);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && isAssemblyViewOpen() && !document.querySelector('[role="dialog"]')) {
      closeAssembly();
    }
  });

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
    void writeDraft(sid, lang, code, pid, getCompanionFiles(), currentDraftRegions()).catch((e) => {
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
  initEditor(editorContainer, nextStarter('manifold-js').code, (code: string) => {
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

  // ── Companion SCAD files ────────────────────────────────────────────────────
  // Secondary tab strip shown in SCAD mode. Each session can have companion
  // files (e.g. models.scad) that are written to OpenSCAD's MEMFS before every
  // compile. Tabs let the user view and edit them; "+" adds a new one; "×"
  // removes one. The companion editor panel (a styled textarea) replaces the
  // main CodeMirror view while a companion tab is active.

  let _companionActiveTab: string | null = null; // null = main tab
  let _lastSyncedVersionId: string | undefined;
  const companionEditorPanel = document.getElementById('companion-editor-panel') as HTMLElement;

  // Debounced draft autosave for companion-file edits — mirrors the main
  // editor's idle autosave so companion typing survives a reload without an
  // explicit save, but coalesces keystrokes so IndexedDB isn't hit per-key.
  let _companionDraftTimer: number | undefined;
  function scheduleCompanionDraftSave(): void {
    if (_companionDraftTimer !== undefined) clearTimeout(_companionDraftTimer);
    _companionDraftTimer = window.setTimeout(() => {
      _companionDraftTimer = undefined;
      autosaveDraft();
    }, getConfig().ui.companionDraftDebounceMs);
  }

  // CodeMirror editor for companion SCAD files — created once, content swapped
  // when switching between companion tabs.
  let _companionEditor: CMEditorView | null = null;
  function ensureCompanionEditor(): CMEditorView {
    if (_companionEditor) return _companionEditor;
    _companionEditor = createCompanionEditor(companionEditorPanel, (content) => {
      if (_companionActiveTab === null) return;
      updateCompanionFile(_companionActiveTab, content);
      runCode(getValue(), { surfaceErrors: false });
      scheduleCompanionDraftSave();
    });
    return _companionEditor;
  }

  function renderCompanionFilesBar(): void {
    const lang = getActiveLanguage();
    if (lang !== 'scad') {
      companionFilesBar.classList.add('hidden');
      // Ensure main editor is visible when not in SCAD mode.
      editorContainer.classList.remove('hidden');
      companionEditorPanel.classList.add('hidden');
      _companionActiveTab = null;
      return;
    }
    companionFilesBar.classList.remove('hidden');
    companionFilesBar.className = [
      'flex items-center gap-0 px-2 py-0.5 bg-zinc-850 border-b border-zinc-700',
      'overflow-x-auto [scrollbar-width:thin] shrink-0',
    ].join(' ');
    companionFilesBar.innerHTML = '';

    const companions = getCompanionFiles();
    const paths = Object.keys(companions);

    // "Main" tab
    const mainTab = buildTab('main', _companionActiveTab === null, () => switchToMainTab());
    companionFilesBar.appendChild(mainTab);

    // One tab per companion file
    for (const path of paths) {
      const tab = buildTab(
        path,
        _companionActiveTab === path,
        () => switchToCompanionTab(path),
        () => { void confirmRemoveCompanion(path); },
      );
      companionFilesBar.appendChild(tab);
    }

    // "+" add button
    const addBtn = document.createElement('button');
    addBtn.className = [
      'shrink-0 ml-1 px-2 py-0.5 rounded text-zinc-500 hover:text-zinc-200',
      'hover:bg-zinc-700 text-xs leading-none border border-transparent',
      'hover:border-zinc-600 transition-colors',
    ].join(' ');
    addBtn.textContent = '+';
    addBtn.title = 'Add a new companion SCAD file';
    addBtn.addEventListener('click', () => { void promptAddCompanion(); });
    companionFilesBar.appendChild(addBtn);
  }

  function buildTab(
    label: string,
    active: boolean,
    onClick: () => void,
    onRemove?: () => void,
  ): HTMLElement {
    const tab = document.createElement('div');
    tab.className = [
      'flex items-center gap-1 px-2 py-1 text-xs font-mono rounded-sm cursor-pointer shrink-0',
      'border border-transparent transition-colors select-none',
      active
        ? 'bg-zinc-700 text-zinc-100 border-zinc-600'
        : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800',
    ].join(' ');

    const name = document.createElement('span');
    name.textContent = label === 'main' ? 'main.scad' : label;
    name.addEventListener('click', onClick);
    tab.appendChild(name);

    if (onRemove) {
      const x = document.createElement('button');
      x.className = 'ml-0.5 w-3.5 h-3.5 flex items-center justify-center rounded hover:bg-red-800/60 hover:text-red-300 text-zinc-500 leading-none';
      x.textContent = '×';
      x.title = `Remove ${label}`;
      x.addEventListener('click', (e) => { e.stopPropagation(); onRemove(); });
      tab.appendChild(x);
    }

    return tab;
  }

  function switchToMainTab(): void {
    _companionActiveTab = null;
    editorContainer.classList.remove('hidden');
    companionEditorPanel.classList.add('hidden');
    renderCompanionFilesBar();
  }

  function switchToCompanionTab(path: string): void {
    _companionActiveTab = path;
    editorContainer.classList.add('hidden');
    companionEditorPanel.classList.remove('hidden');
    const companions = getCompanionFiles();
    const editor = ensureCompanionEditor();
    setCompanionEditorContent(editor, companions[path] ?? '');
    editor.focus();
    renderCompanionFilesBar();
  }

  async function promptAddCompanion(): Promise<void> {
    const filename = await promptDialog('Companion file name (e.g. models or lib/utils):');
    if (!filename || !filename.trim()) return;
    const path = normalizeCompanionPath(filename);
    if (getCompanionFiles()[path] !== undefined) {
      showToast(`${path} is already a companion file.`, { variant: 'warn' });
      return;
    }
    addCompanionFileToRegistry(path, '');
    renderCompanionFilesBar();
    switchToCompanionTab(path);
    // Persist immediately so a freshly-added companion survives a reload even if
    // the user navigates away before saving — mirrors the remove path, which
    // already saves. (Add was previously registry-only and silently lost.)
    void saveCurrentVersion();
  }

  async function confirmRemoveCompanion(path: string): Promise<void> {
    if (!await confirmDialog(`Remove companion file "${path}"?`, { danger: true, confirmLabel: 'Remove' })) return;
    removeCompanionFileFromRegistry(path);
    if (_companionActiveTab === path) switchToMainTab();
    else renderCompanionFilesBar();
    // Re-run synchronously so the cache and saved geometry data reflect the
    // post-removal mesh (fire-and-forget runCode races with saveCurrentVersion).
    await runCodeSync(getValue());
    void saveCurrentVersion();
  }

  // Re-render companion tab bar when language or session state changes.
  // Also syncs the in-memory registry from the DB-stored version whenever the
  // version ID changes (session open, version navigation, post-save). Gating
  // on the version ID prevents overwriting in-progress unsaved edits — the ID
  // only changes on explicit state transitions, not on keystrokes.
  onStateChange(() => {
    const versionId = getState().currentVersion?.id;
    if (versionId !== _lastSyncedVersionId) {
      _lastSyncedVersionId = versionId;
      setCompanionFiles(getState().currentVersion?.companionFiles ?? {});
    }

    if (_companionActiveTab !== null) {
      // Keep the companion tab active unless the companion is no longer present
      // (e.g. navigated to a version that doesn't have it). Staying on the
      // companion tab after a plain save is correct UX — the user was editing
      // a companion file and shouldn't be yanked back to main.scad on save.
      if (getCompanionFiles()[_companionActiveTab] === undefined) {
        switchToMainTab();
      } else {
        // Refresh editor content in case version navigation changed what's in
        // this companion file (the registry was updated but the CodeMirror view
        // still shows the old content).
        if (_companionEditor !== null) {
          setCompanionEditorContent(_companionEditor, getCompanionFiles()[_companionActiveTab] ?? '');
        }
        renderCompanionFilesBar();
      }
    } else {
      renderCompanionFilesBar();
    }
  });

  // Initial render (will be hidden since we start in manifold-js mode).
  renderCompanionFilesBar();

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
  async function restoreBaselineColors(baseline: MeshData): Promise<void> {
    if (simplifyBaselineColoredMesh) {
      resetPaintWorkerState();
      clearRegions();
      clearModelColorRegions();
      applyLiveGeometry(baseline);
      if (simplifyBaselineModelRegions && simplifyBaselineModelRegions.length > 0) {
        setModelColorRegions(simplifyBaselineModelRegions);
      }
      await rehydrateColorRegions({ colorRegions: simplifyBaselineRegions ?? [] });
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
    // Mirror the post-run path (see runCodeSync's ofMesh reconstruction): a
    // simplify / enhance / paint-refine result can come back not-quite-manifold
    // (degenerate tris, non-2-manifold edges), and Manifold.ofMesh throws
    // "Not manifold" on those. Without this guard the exception escapes the
    // helper, the simplify/enhance handler surfaces a raw "Not manifold" error,
    // AND the stats / printability refresh below is skipped — so the user gets
    // no warning that the model went non-manifold (the exact bug reported for
    // paint → enhance → paint → simplify). Fall back to render-only and warn.
    try {
      currentManifold = mod && mesh ? mod.Manifold.ofMesh(mesh) : null;
    } catch {
      currentManifold = null;
      showToast(
        "The resulting mesh isn’t a watertight solid (non-manifold) — it still renders, but won’t slice or boolean cleanly. Try a higher triangle target, or re-run the code to rebuild a clean solid.",
        { variant: 'warn', source: 'engine', durationMs: 6000 },
      );
    }
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

  // Push a simplify/enhance worker result onto the live viewport, carrying
  // colors through the topology change when a colored baseline is held. Shared
  // by the count-based (apply/enhance) and direct edge-length/tolerance
  // (simplifyByTolerance/enhanceByEdgeLength) handlers. Returns the achieved
  // triangle count, or null when the baseline changed underneath us or the op
  // produced no change (the panel surfaces null as a "nothing to do" warning).
  function commitMeshOpResult(
    result: { mesh: MeshData; triangleCount: number } | null,
    baseline: MeshData,
    coloredBaseline: MeshData | null,
  ): { triangleCount: number } | null {
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
  }

  const simplifyHandlers: SimplifyHandlers = {
    open(userInitiated) {
      if (userInitiated) {
        // Don’t let two overlay panels share the top-right slot.
        if (isPaintOpen()) closePaintMenu();
        if (isAnnotateOpen()) closeAnnotateMenu();
        closePrintToolsMenu();
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
      const bbox = bboxFromMesh(simplifyBaselineMesh);
      const bboxDiagonal = bbox
        ? Math.hypot(bbox.max[0] - bbox.min[0], bbox.max[1] - bbox.min[1], bbox.max[2] - bbox.min[2])
        : 0;
      const positions = extractPositions(simplifyBaselineMesh);
      return {
        ok: true,
        info: {
          baseTriangles: simplifyBaselineMesh.numTri,
          currentTriangles: currentMeshData.numTri,
          hasColor: simplifyBaselineColoredMesh != null,
          bboxDiagonal,
          maxEdge: maxEdgeLength(positions, simplifyBaselineMesh.triVerts),
          minEdge: minEdgeLength(positions, simplifyBaselineMesh.triVerts),
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
      return commitMeshOpResult(result, baseline, coloredBaseline);
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
      if (result?.exceeded) return { exceeded: true, triangleCount: result.triangleCount };
      const meshResult = result && result.mesh ? { mesh: result.mesh, triangleCount: result.triangleCount } : null;
      return commitMeshOpResult(meshResult, baseline, coloredBaseline);
    },

    async simplifyByTolerance(tolerance, preserveColor, onProgress, signal) {
      const baseline = simplifyBaselineMesh;
      if (!baseline) return null;
      if (!(tolerance > 0)) return null;
      const coloredBaseline = preserveColor ? simplifyBaselineColoredMesh : null;

      const result = await simplifyInWorker(
        baseline,
        baseline.numTri,
        tolerance,
        (fraction) => { void onProgress(fraction); },
        signal,
        tolerance,
      );
      return commitMeshOpResult(result, baseline, coloredBaseline);
    },

    async enhanceByEdgeLength(edgeLength, preserveColor, onProgress, signal) {
      const baseline = simplifyBaselineMesh;
      if (!baseline) return null;
      if (!(edgeLength > 0)) return null;
      const coloredBaseline = preserveColor ? simplifyBaselineColoredMesh : null;

      const result = await enhanceInWorker(
        baseline,
        baseline.numTri,
        edgeLength,
        (fraction) => { void onProgress(fraction); },
        signal,
        edgeLength,
      );
      if (result?.exceeded) return { exceeded: true, triangleCount: result.triangleCount };
      const meshResult = result && result.mesh ? { mesh: result.mesh, triangleCount: result.triangleCount } : null;
      return commitMeshOpResult(meshResult, baseline, coloredBaseline);
    },

    estimateRefine(edgeLength) {
      const baseline = simplifyBaselineMesh;
      if (!baseline || !(edgeLength > 0)) return baseline?.numTri ?? 0;
      const positions = extractPositions(baseline);
      return estimateRefineTriangles(positions, baseline.triVerts, edgeLength);
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
            await rehydrateColorRegions({ ...geoData, colorRegions: regions });
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
  initLightToggle(clipControls);
  initDimensionsToggle(clipControls);
  initAnnotateUI(clipControls);
  initPaintUI(clipControls);
  initInsertPalette(clipControls, {
    getLanguage: () => getActiveLanguage(),
    getCode: () => getValue(),
    setCode: (code: string) => setValue(code),
    getSelection: () => getSelection(),
    run: (code?: string) => runCode(code),
    showToast: (msg, opts) => showToast(msg, opts),
    getMeshData: () => currentMeshData,
    getCamera: () => getCamera(),
    getCanvas: () => getCanvas(),
  });
  // initInsertPalette wires the toolbar button itself. All four engines now
  // have insert codegen, so the palette is always available; per-engine shape
  // and operation support is handled inside the palette.
  setInsertPaletteAvailable(true);
  initImagePaintUI(clipControls);
  setSmoothStampCallback(smoothReplayCb = (imageData, stampOpts, maxEdge) => {
    if (!currentMeshData) return null;

    const { hitPoint: [hpX, hpY, hpZ], hitNormal: [nx, ny, nz], size, rotationDeg } = stampOpts;
    const halfSize = size / 2;
    const { tr: [trX, trY, trZ], br: [brX, brY, brZ] } = buildTangentFrame(stampOpts.hitNormal, rotationDeg);
    const { numProp, vertProperties, triVerts } = currentMeshData;

    // Build adjacency once — used for the BFS footprint walk and the region remap.
    const adjacency = buildAdjacency(currentMeshData);

    // Find the mesh triangle the user clicked as the BFS seed.
    const { triIndex: startTri } = findNearestTriangle([hpX, hpY, hpZ], currentMeshData, adjacency);
    if (startTri < 0) return null;

    // Footprint test: UV square (with margin) AND depth slab so we don't cross
    // through the model to the far side.
    const MARGIN = 0.15;
    const lo = -(1 + MARGIN), hi = 1 + MARGIN;
    const inFootprint = (px: number, py: number, pz: number) => {
      const dx = px - hpX, dy = py - hpY, dz = pz - hpZ;
      if (dx * nx + dy * ny + dz * nz < -halfSize) return false; // depth slab
      const u = (dx * trX + dy * trY + dz * trZ) / halfSize;
      const v = (dx * brX + dy * brY + dz * brZ) / halfSize;
      return u >= lo && u <= hi && v >= lo && v <= hi;
    };

    // Step 1: BFS from the hit triangle — walk across shared mesh edges, only
    // continuing through forward-facing triangles. This mirrors the paint brush's
    // geodesic approach: paint stays on the reachable surface, never bleeds
    // through the model to the far side.
    const footprintTris = new Set<number>();
    const visited = new Set<number>([startTri]);
    const queue: number[] = [startTri];

    while (queue.length > 0) {
      const t = queue.shift()!;
      const v0 = triVerts[t * 3], v1 = triVerts[t * 3 + 1], v2 = triVerts[t * 3 + 2];
      const x0 = vertProperties[v0 * numProp], y0 = vertProperties[v0 * numProp + 1], z0 = vertProperties[v0 * numProp + 2];
      const x1 = vertProperties[v1 * numProp], y1 = vertProperties[v1 * numProp + 1], z1 = vertProperties[v1 * numProp + 2];
      const x2 = vertProperties[v2 * numProp], y2 = vertProperties[v2 * numProp + 1], z2 = vertProperties[v2 * numProp + 2];

      // Stop propagating at back-facing triangles (they form the geometric horizon).
      const ex = x1 - x0, ey = y1 - y0, ez = z1 - z0;
      const fx = x2 - x0, fy = y2 - y0, fz = z2 - z0;
      if ((ey * fz - ez * fy) * nx + (ez * fx - ex * fz) * ny + (ex * fy - ey * fx) * nz <= 0) continue;

      const cx = (x0 + x1 + x2) / 3, cy = (y0 + y1 + y2) / 3, cz = (z0 + z1 + z2) / 3;
      if (inFootprint(cx, cy, cz) || inFootprint(x0, y0, z0) || inFootprint(x1, y1, z1) || inFootprint(x2, y2, z2)) {
        footprintTris.add(t);
        for (const n of adjacency.neighbors[t]) {
          if (!visited.has(n)) { visited.add(n); queue.push(n); }
        }
      }
    }

    if (footprintTris.size === 0) return null;

    // Supplement the BFS with a full forward-face scan for any triangle that
    // passes the footprint bounds but wasn't reachable via adjacency. Prior
    // stamp subdivisions create T-junctions between fine (stamp) and medium
    // (outer) triangles — the BFS can't cross T-junctions, so medium boundary
    // triangles are missed. stampImageOntoMesh colors triangles by centroid
    // (not adjacency), so a missed medium triangle would get painted at full
    // coarse size and appear as a large triangular patch outside the circle.
    // Depth-slab + back-face checks keep far-side triangles excluded.
    for (let t = 0; t < currentMeshData.numTri; t++) {
      if (visited.has(t)) continue;
      const sv0 = triVerts[t * 3], sv1 = triVerts[t * 3 + 1], sv2 = triVerts[t * 3 + 2];
      const sx0 = vertProperties[sv0 * numProp], sy0 = vertProperties[sv0 * numProp + 1], sz0 = vertProperties[sv0 * numProp + 2];
      const sx1 = vertProperties[sv1 * numProp], sy1 = vertProperties[sv1 * numProp + 1], sz1 = vertProperties[sv1 * numProp + 2];
      const sx2 = vertProperties[sv2 * numProp], sy2 = vertProperties[sv2 * numProp + 1], sz2 = vertProperties[sv2 * numProp + 2];
      const sex = sx1 - sx0, sey = sy1 - sy0, sez = sz1 - sz0;
      const sfx = sx2 - sx0, sfy = sy2 - sy0, sfz = sz2 - sz0;
      if ((sey * sfz - sez * sfy) * nx + (sez * sfx - sex * sfz) * ny + (sex * sfy - sey * sfx) * nz <= 0) continue;
      const scx = (sx0 + sx1 + sx2) / 3, scy = (sy0 + sy1 + sy2) / 3, scz = (sz0 + sz1 + sz2) / 3;
      if (inFootprint(scx, scy, scz) || inFootprint(sx0, sy0, sz0) || inFootprint(sx1, sy1, sz1) || inFootprint(sx2, sy2, sz2)) {
        footprintTris.add(t);
      }
    }

    // Step 2: Confined subdivision. `overlapsStamp` keeps refinement inside the
    // stamp square (+ a thin margin) and the depth slab: as a big seed triangle
    // splits 1→4, children that land outside the square stop refining, so the
    // fine tessellation stays within the stamp footprint instead of flooding the
    // whole base triangle. This is the paint-tool's "refine only within the
    // region" strategy — a 12-tri cube now grows a few thousand triangles inside
    // the stamp, not 500k across the whole face.
    const REFINE_MARGIN = 0.03;
    const ov = -(1 + REFINE_MARGIN), oh = 1 + REFINE_MARGIN;

    // Project a 3-D mesh point to 2-D stamp-UV space.
    const toUV = (px: number, py: number, pz: number): [number, number] => {
      const dx = px - hpX, dy = py - hpY, dz = pz - hpZ;
      return [
        (dx * trX + dy * trY + dz * trZ) / halfSize,
        (dx * brX + dy * brY + dz * brZ) / halfSize,
      ];
    };

    // 2-D signed area (cross product) used for point-in-triangle.
    const cross2d = (ax: number, ay: number, bx: number, by: number, px: number, py: number): number =>
      (bx - ax) * (py - ay) - (by - ay) * (px - ax);

    // Is a 2-D point inside triangle (ax,ay)-(bx,by)-(cx,cy)?
    const ptInTri2d = (
      px: number, py: number,
      ax: number, ay: number, bx: number, by: number, cx: number, cy: number,
    ): boolean => {
      const d1 = cross2d(ax, ay, bx, by, px, py);
      const d2 = cross2d(bx, by, cx, cy, px, py);
      const d3 = cross2d(cx, cy, ax, ay, px, py);
      return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0));
    };

    // Is a 2-D UV point inside the stamp square?
    const ptInStamp2d = (u: number, v: number): boolean => u >= ov && u <= oh && v >= ov && v <= oh;

    // Depth slab guard: skip triangles behind the hit surface.
    const inDepthSlab = (px: number, py: number, pz: number): boolean =>
      (px - hpX) * nx + (py - hpY) * ny + (pz - hpZ) * nz >= -halfSize;

    const overlapsStamp = (a: number[], b: number[], c: number[]): boolean => {
      // Depth-slab test on centroid first (cheap early-out for back triangles).
      const cenX = (a[0] + b[0] + c[0]) / 3;
      const cenY = (a[1] + b[1] + c[1]) / 3;
      const cenZ = (a[2] + b[2] + c[2]) / 3;
      if (!inDepthSlab(cenX, cenY, cenZ)) return false;

      // Project triangle vertices to 2-D stamp UV.
      const [ua, va] = toUV(a[0], a[1], a[2]);
      const [ub, vb] = toUV(b[0], b[1], b[2]);
      const [uc, vc] = toUV(c[0], c[1], c[2]);

      // 1. Bounding-box early reject (SAT axes for the stamp rectangle).
      const uMin = Math.min(ua, ub, uc), uMax = Math.max(ua, ub, uc);
      const vMin = Math.min(va, vb, vc), vMax = Math.max(va, vb, vc);
      if (uMax < ov || uMin > oh || vMax < ov || vMin > oh) return false;

      // 2. Any triangle vertex or centroid inside the stamp square.
      const uCen = (ua + ub + uc) / 3, vCen = (va + vb + vc) / 3;
      if (ptInStamp2d(ua, va) || ptInStamp2d(ub, vb) || ptInStamp2d(uc, vc) || ptInStamp2d(uCen, vCen)) return true;

      // 3. Any stamp corner inside the triangle.
      // Handles the case where the stamp is completely enclosed by one large triangle
      // (no triangle vertex lands inside the stamp, but the triangle still covers it).
      return ptInTri2d(ov, ov, ua, va, ub, vb, uc, vc)
          || ptInTri2d(oh, ov, ua, va, ub, vb, uc, vc)
          || ptInTri2d(oh, oh, ua, va, ub, vb, uc, vc)
          || ptInTri2d(ov, oh, ua, va, ub, vb, uc, vc);
    };

    // Step 3: Subdivide the footprint to maxEdge, confined by overlapsStamp.
    const { mesh, childToParent } = buildRefinedMeshFromSet(currentMeshData, footprintTris, maxEdge, overlapsStamp);
    const parentToChildren = childrenByParent(childToParent);
    currentMeshData = mesh;
    // Advance paintBaseMesh to the subdivided mesh so the paint reconciler
    // (triggered by addRegion after we return) sees currentMeshData ===
    // paintBaseMesh and skips the rebuild-from-base step that would otherwise
    // revert our subdivision back to the coarse geometry.
    paintBaseMesh = mesh;
    updatePaintMesh(mesh);

    // Step 4: Remap existing paint regions onto the subdivided mesh.
    let regionAdjacency: AdjacencyGraph | null = null;
    for (const region of getRegions()) {
      const d = region.descriptor;
      if (d.kind === 'triangles' || d.kind === 'byLabel' || d.kind === 'imagePaint') {
        // For imagePaint: descriptor.entries are from the creation-time mesh, not
        // the current one. Re-reading them via resolveDescriptorTriangles with only
        // the one-step parentToChildren map produces wrong triangle ids on the 3rd+
        // stamp (entries from stamp 1 are M1 indices; stamp 3's map is M2→M3).
        // region.triangles is always the current runtime set, already correctly
        // mapped by the previous stamp's step 4 — remap it directly.
        setRegionTriangles(region.id, remapTriangleIds(region.triangles, parentToChildren), remapPerTriColors(region.perTriColors, parentToChildren));
      } else {
        if (!regionAdjacency && (d.kind === 'coplanar' || d.kind === 'connectedFromSeed')) regionAdjacency = buildAdjacency(mesh);
        const { triangles, perTriColors } = resolveDescriptorTriangles(d, mesh, regionAdjacency, parentToChildren);
        setRegionTriangles(region.id, triangles, perTriColors);
      }
    }
    paintedColorRefresh();

    // Step 5: Stamp on the now-fine mesh for crisp image edges.
    const finalResult = stampImageOntoMesh(mesh, imageData, stampOpts);
    return { result: finalResult, parentToChildren };
  });
  // Commit a freshly-placed stamp region with the paint reconciler suspended.
  // The stamp flow already built the final mesh and resolved every region's
  // triangles/colours, so a reconcile here would only ever do harm: with brush
  // strokes (or smooth slabs/etc.) present it rebuilds the mesh from base and
  // re-resolves regions, wiping the stamp (whose colours live in runtime
  // perTriColors, not its descriptor) and any pre-existing paint. Suspend it,
  // run the addRegion, then re-composite colours directly.
  setStampCommitHook((commit) => {
    suspendReconcile = true;
    try {
      commit();
    } finally {
      suspendReconcile = false;
    }
    paintedColorRefresh();
  });
  initVoxelPaintUI(clipControls, {
    activate: async () => {
      const code = getValue();
      const err = voxelPaint.activate(code, {
        onMeshUpdate: (mesh) => { updateMesh(mesh, { skipAutoFrame: true }); },
        onLockChange: (locked) => { setReadOnlyReason('voxelPaint', locked); },
        onStateChange: () => { syncVoxelPaintUI(); },
      }, currentParamValues);
      if (err) showToast(`Voxel Studio: ${err}`, { variant: 'warn' });
      syncVoxelPaintUI();
    },
    deactivate: async () => {
      voxelPaint.deactivate();
      runCode(getValue());
      syncVoxelPaintUI();
    },
    updateCode: async () => {
      const result = await commitVoxelEdits('update', 'voxel edits');
      if ('error' in result) showToast(`Voxel Studio: ${result.error}`, { variant: 'warn' });
      else showToast('Voxel edits applied to your code', { variant: 'success' });
      syncVoxelPaintUI();
    },
    saveRaw: async () => {
      // Replacing destroys the current source; confirm when there's code to lose.
      if (getValue().trim().length > 0) {
        const ok = await confirmDialog(
          'Save as raw voxel data? This replaces the code in the editor with voxels.decode(...) of the current grid.',
          { title: 'Replace code', confirmLabel: 'Replace', danger: true },
        );
        if (!ok) return;
      }
      const result = await commitVoxelEdits('replace', 'painted');
      if ('error' in result) showToast(`Voxel Studio: ${result.error}`, { variant: 'warn' });
      syncVoxelPaintUI();
    },
  });
  setVoxelPaintAvailable(getActiveLanguage() === 'voxel');

  // Single source of truth for committing Voxel Studio edits as a new version.
  // `mode` picks how the edits land in the editor:
  //   • 'replace' — overwrite the code with voxels.decode(<full grid>) ("Save
  //     as raw voxel data"). The UI confirms before calling this; the
  //     programmatic API (bakeVoxelsToCode) skips the dialog.
  //   • 'update'  — keep the procedural code and append the edits as explicit
  //     v.set/v.remove statements ("Update code").
  async function commitVoxelEdits(
    mode: 'replace' | 'update',
    label: string,
  ): Promise<{ versionIndex: number | null; voxelCount: number } | { error: string }> {
    if (!voxelPaint.isActive()) return { error: 'Voxel Studio is not active.' };
    const count = voxelPaint.voxelCount();
    if (count === 0) return { error: 'The grid is empty — keep at least one voxel before saving.' };

    let code: string | null;
    if (mode === 'update') {
      const ops = voxelPaint.getEditOps();
      const roundingChanged = voxelPaint.roundingChanged();
      if (editOpCount(ops) === 0 && !roundingChanged) {
        return { error: 'No edits to apply — paint/add/remove voxels or adjust Rounding first.' };
      }
      // Append an explicit surfacing call only when the user changed rounding;
      // otherwise leave whatever the source already declared intact.
      const surf = voxelPaint.getSurfacing();
      const surfacingCall = roundingChanged && surf ? formatSurfacingCall(surf, true) : '';
      code = appendVoxelEditsToCode(getValue(), ops, surfacingCall);
      // No trailing `return …;` to hook onto — fall back to a clean replace.
      if (code === null) code = voxelPaint.bakeToCode('painted');
    } else {
      code = voxelPaint.bakeToCode('painted');
    }
    if (!code) return { error: 'Voxel Studio has no grid to save.' };

    voxelPaint.deactivate();
    setValue(code);
    await runCodeSync(code);
    // Mirror the runAndSave auto-create pattern so callers don't have to wrap
    // the commit with a manual createSession.
    if (!getState().session) {
      await createSession(label, getActiveLanguage());
    }
    const thumbnail = await captureThumbnail();
    const geometryData = enrichGeometryDataWithColors(getGeometryDataObj());
    const v = await saveVersion(code, geometryData, thumbnail, label);
    return { versionIndex: v?.index ?? null, voxelCount: count };
  }
  initSimplifyUI(clipControls, simplifyHandlers, {
    initialLang: getActiveLanguage(),
    onCancelRender: () => { cancelCurrentExecution(); },
  });
  initMeasureToggle(clipControls);
  initOrbitLockToggle(clipControls);
  initResetViewButton(clipControls);

  // Relief / Edit colors toggle in the viewport overlay — paint/simplify are
  // alongside this button so the colour palette is discoverable from the
  // same place as the other model-editing tools (was previously in the top
  // toolbar where it kept getting clipped behind Show Code).
  const reliefViewportBtn = document.createElement('button');
  reliefViewportBtn.id = 'relief-viewport-toggle';
  reliefViewportBtn.className = 'hidden px-2 py-1 rounded text-xs bg-zinc-800/80 backdrop-blur text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700/80 transition-colors border border-zinc-600/50';
  reliefViewportBtn.textContent = '✦ Relief';
  reliefViewportBtn.title = 'Edit colors for this relief';
  reliefViewportBtn.addEventListener('click', () => toggleReliefStudio());
  // Relief edit is a contextual primary (shown only in relief sessions), so it
  // sits top-level on the bar rather than inside the Tools popover.
  const reliefAnchor = clipControls.querySelector('#viewport-inspect-group');
  if (reliefAnchor) clipControls.insertBefore(reliefViewportBtn, reliefAnchor);
  else clipControls.appendChild(reliefViewportBtn);

  initEscapeMenuClose();

  // When a color region is painted, re-render the mesh with colors.
  setOnRegionPainted(() => {
    scheduleColorRefresh();
  });

  // Projection paint collects triangle ids in the current working mesh's index
  // space; this maps them back to pristine-base ids before storage so a later
  // refine remaps them correctly. Reads live state: identity (no work) while the
  // mesh is unrefined, a base-mesh closest-point lookup once it's been refined.
  setTriangleToBaseMapper((t) => {
    const cm = currentMeshData, base = paintBaseMesh;
    if (!cm || !base || cm === base) return t;
    return baseTriangleOf(cm, base, t);
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
  // /editor?tour=1 (the static landing's "Take the guided tour" CTA): force the
  // guided tour even for users who already completed it once, then strip the
  // param so a refresh doesn't relaunch it. maybeStartTour() below then fires on
  // the now-clean editor URL.
  if (new URLSearchParams(window.location.search).get('tour') === '1') {
    resetTour();
    history.replaceState(history.state, '', appPath('/editor'));
  }

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

  // Opening a hands-on viewport tool (Paint, Customize, Surface, Resize, …)
  // steps the AI panel out of the way: once the user is driving a tool by hand
  // they're not chatting, and the docked AI column would otherwise sit beneath
  // the freshly-opened tool panel and be easy to miss. Wired here (not in the
  // registry) so the registry stays a dependency-free leaf.
  onViewportPanelOpen(() => closeAiPanel());

  // When a chat turn produced a customizable model, the Customizer reveal was
  // deferred (see syncParamsPanel) so it didn't pop over the live chat. Flush it
  // now that the turn has ended — silently, so the AI panel stays open and the
  // user sees the result and its knobs side by side.
  onAiTurnEnd(() => {
    if (!paramsRevealDeferred) return;
    paramsRevealDeferred = false;
    refreshParamsPanelUI(true);
  });

  // Initialize the AI chat side drawer once the editor UI is mounted.
  // Wraps initAiPanel + setAiToolbarState; tolerated if it fails (e.g.
  // network blocks /ai.md) — toolbar still shows the Connect button.
  void (async () => {
    try {
      await initAiPanel({
        onNavigateToEditor: async () => {
          updateAppHistory(appPath('/editor'), 'push');
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
    renderCompanionFilesBar();
    setEditorLanguage(lang);
    setToolbarLanguage(lang);
    setVoxelPaintAvailable(lang === 'voxel');
    // All four engines have insert codegen; the palette repaints its per-engine
    // sections on this call (when open) and on its next open.
    setInsertPaletteAvailable(true);
    notifyQualityLangChanged(lang);
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
      // part/session is deleted. Companions ride along for the SCAD buffer.
      await writeDraft(sid, prevLang, currentCode, pid, getCompanionFiles(), currentDraftRegions());
    }
    await applyEngineLanguage(lang);
    let nextCode: string | null = null;
    let nextCompanions: Record<string, string> | undefined;
    if (sid) {
      const draft = await readDraft(sid, lang, pid);
      if (draft) { nextCode = draft.code; nextCompanions = draft.companionFiles; }
    }
    // Restore the target language's companion set: the SCAD draft's saved
    // companions, or empty for any non-SCAD buffer (which never has them).
    setCompanionFiles(lang === 'scad' ? (nextCompanions ?? {}) : {});
    if (nextCode === null) {
      // No saved buffer for this language — seed a fresh rotating starter (which
      // also applies the scad/replicad starting colour after the run).
      await seedStarter(lang);
    } else {
      setValue(nextCode);
      runCode(nextCode);
    }
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

    // Engine WASM heap high-water for this run (manifold-js only) so isolated
    // runs report memory in their stats just like the editor's Data panel.
    const engineMemory = result.engineHeapBytes !== undefined
      ? formatEngineMemory(result.engineHeapBytes)
      : undefined;

    if (result.error) {
      recordError(result.error);
      return {
        geometryData: {
          status: 'error' as const,
          error: result.error,
          diagnostics: result.diagnostics ?? [],
          executionTimeMs: elapsed,
          codeHash: simpleHash(code),
          ...(engineMemory !== undefined ? { engineMemory } : {}),
        },
        meshData: null as MeshData | null,
        manifold: null as unknown,
      };
    }

    // Reconstruct the Manifold if the Worker path returned manifold=null.
    const mod = getModule();
    const manifold = result.manifold ?? (mod && result.mesh ? mod.Manifold.ofMesh(result.mesh) : null);
    const stats = computeGeometryStats(manifold, result.mesh!, elapsed, code);
    if (engineMemory !== undefined) stats.engineMemory = engineMemory;
    if (result.voxelCount !== undefined) stats.voxelCount = result.voxelCount;
    if (result.voxelPieceCount !== undefined) stats.voxelPieceCount = result.voxelPieceCount;
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
    id: 'fuzzy' | 'knit' | 'cable' | 'waffle' | 'fur' | 'woven' | 'knurl' | 'voronoi',
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
    } else if (id === 'knurl') {
      const cw = (opts.cellWidth as number | undefined) ?? 0;
      if (cw > diag * 0.4) {
        warnings.push(
          `cellWidth (${cw.toFixed(3)}) is large relative to the model diagonal (${diag.toFixed(2)}) — ` +
          `fewer than 3 ridges visible; try cellWidth ≈ ${(diag * 0.05).toFixed(3)}`,
        );
      }
      if (cw > 0 && cw < diag / 400) {
        warnings.push(
          `cellWidth (${cw.toFixed(4)}) is very small — the knurl will be invisible; ` +
          `try cellWidth ≈ ${(diag * 0.05).toFixed(3)}`,
        );
      }
    } else if (id === 'voronoi') {
      const cs = (opts.cellSize as number | undefined) ?? 0;
      if (cs > diag * 0.4) {
        warnings.push(
          `cellSize (${cs.toFixed(3)}) is large relative to the model diagonal (${diag.toFixed(2)}) — ` +
          `fewer than 3 cells visible; try cellSize ≈ ${(diag * 0.12).toFixed(3)}`,
        );
      }
      if (cs > 0 && cs < diag / 300) {
        warnings.push(
          `cellSize (${cs.toFixed(4)}) is very small — the cell walls will be invisible; ` +
          `try cellSize ≈ ${(diag * 0.12).toFixed(3)}`,
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
  /** Write per-triangle colors onto `target` by nearest-triangle transfer from a
   *  colored `source` (a painted or model-declared mesh). Used to keep the
   *  engrave/voronoi-lamp *preview* colored — those bake a fresh, color-less mesh,
   *  so without this the live preview goes grey/default-blue and looks like the
   *  carve wiped the model's colors. The `_painted` mask is carried so unmapped /
   *  unpainted triangles render the default material instead of black — matching
   *  what Apply produces (partial paint works too). */
  function previewColorsFromSource(target: MeshData, source: MeshData): MeshData | null {
    const src = source.triColors;
    if (!src) return null;
    const srcPainted = (src as Uint8Array & { _painted?: Uint8Array })._painted;
    const nearest = nearestTriangleMap(source, target);
    const out = new Uint8Array(target.numTri * 3);
    const painted = new Uint8Array(target.numTri);
    for (let t = 0; t < target.numTri; t++) {
      const o = nearest[t];
      if (o < 0 || (srcPainted && srcPainted[o] !== 1)) continue;
      out[t * 3] = src[o * 3]; out[t * 3 + 1] = src[o * 3 + 1]; out[t * 3 + 2] = src[o * 3 + 2];
      painted[t] = 1;
    }
    (out as Uint8Array & { _painted?: Uint8Array })._painted = painted;
    return { ...target, triColors: out };
  }

  function previewSurfaceModifier(result: ModifierResult, preserveColor: boolean): void {
    const previewMesh = result.kind === 'manifold' ? result.mesh : result.previewMesh;
    if (previewMesh.numTri === 0) return;
    // Texture results already carry triColors (rendered colored). For a re-meshed
    // result with none (engrave / voronoi lamp), transfer the model's colors so
    // the preview matches what Apply will produce instead of flashing grey.
    let mesh = previewMesh;
    if (preserveColor && result.kind === 'manifold' && !previewMesh.triColors && result.colorSource) {
      mesh = previewColorsFromSource(previewMesh, result.colorSource) ?? previewMesh;
    }
    updateMesh(mesh, { skipAutoFrame: true });
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

  /** A user-facing warning when committing a modifier converts a SCAD or BREP
   *  session into a baked manifold-js/voxel mesh — the parametric source (and,
   *  for BREP, STEP export) is discarded. Returns null when nothing of value is
   *  lost (manifold-js → manifold-js, or the explicit manifold-js → voxelize). */
  function engineBakeWarning(priorLang: Language, target: 'manifold-js' | 'voxel'): string | null {
    if (priorLang === target) return null;
    if (priorLang === 'replicad') {
      return 'This BREP model was baked to a mesh — the parametric BREP source and STEP export are no longer available.';
    }
    if (priorLang === 'scad') {
      return 'This OpenSCAD model was baked to a mesh — the parametric SCAD source is no longer editable.';
    }
    return null;
  }

  async function commitSurfaceModifier(result: ModifierResult, preserveColor: boolean, opts?: { warnOnBake?: boolean }): Promise<Record<string, unknown>> {
    // Refuse to bake while a coarse fast-preview is on screen: the modifier would
    // bind to the throwaway low-res mesh, which the full-quality render is about
    // to replace. Tell the user to let it finish (it auto-completes in seconds).
    if (_showingFastPreview) {
      const msg = 'Full-quality render still in progress — wait for it to finish before altering the mesh.';
      showToast(msg, { variant: 'warn' });
      return { error: msg };
    }
    // Capture the language *before* the commit switches it, so we can warn when a
    // SCAD/BREP session is silently baked to a mesh. The transform path
    // (commitTransform) emits its own, more specific warning and passes
    // warnOnBake:false to avoid double-reporting.
    const priorLang = getActiveLanguage();
    const warnOnBake = opts?.warnOnBake !== false;
    // For manifold results the modifier already baked colors into its input and
    // carried them through subdivision — result.mesh.triColors has the correct
    // per-triangle paint (dense mesh, same shape as the engine output). We use
    // that as the color source rather than the pre-modifier coarse mesh, which
    // avoids the coarse→dense centroid-mapping errors that cause wrong colors.
    // Prefer the baked mesh's own triColors (textures carry them exactly through
    // subdivision). When the result is fully re-meshed (engrave, voronoi lamp) it
    // has none, so fall back to a spatial transfer from the painted source mesh
    // the modifier handed back — otherwise the carve would wipe all paint.
    // A result that bakes its own triColors (a colored engrave/emboss stamp)
    // persists them even with preserveColor off: that flag scopes the carry of
    // EXISTING paint, not paint the modifier itself just introduced.
    const colorMesh = result.kind === 'manifold'
      ? (result.mesh.triColors != null ? result.mesh
        : (preserveColor && result.colorSource?.triColors != null ? result.colorSource : null))
      : null;
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
      // A surface modifier decorates the existing model in place (same bounds),
      // so keep the user's camera angle instead of snapping back to the default
      // framing when the baked result renders.
      const ok = await runCodeSync(result.code, { preserveCamera: true });
      if (!ok) return { error: `Failed to apply ${result.label}` };
      let geoData = getGeometryDataObj();
      let carried = 0;
      if (colorMesh && currentMeshData && geoData) {
        const { regions, transferredTris } = buildCarriedColorRegions(colorMesh, colorMesh.triColors!, currentMeshData);
        if (regions.length > 0) {
          await rehydrateColorRegions({ ...geoData, colorRegions: regions });
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
      const bakeWarning = warnOnBake ? engineBakeWarning(priorLang, 'manifold-js') : null;
      if (bakeWarning) showToast(bakeWarning, { variant: 'warn', source: 'engine' });
      const allWarnings = [...(bakeWarning ? [bakeWarning] : []), ...colorWarnings];
      return {
        ok: true,
        label: result.label,
        geometry: getGeometryDataObj(),
        colorsCarried: carried,
        ...(allWarnings.length > 0 ? { warnings: allWarnings } : {}),
      };
    }
    // Voxel result: a self-contained `voxels.decode(...)` program, no imports.
    // Color (when preserved) is baked into the grid at voxelize time, so it
    // rides the emitted code — nothing extra to persist here.
    if (getActiveLanguage() !== 'voxel') await switchLanguage('voxel');
    setActiveImports([]);
    setValue(result.code);
    // Same in-place decoration: a voxelize/voronoi-lamp bake keeps the model's
    // bounds, so preserve the user's camera angle across the render.
    const ok = await runCodeSync(result.code, { preserveCamera: true });
    if (!ok) return { error: `Failed to apply ${result.label}` };
    const thumbnail = await captureThumbnail();
    await saveVersion(result.code, getGeometryDataObj(), thumbnail, result.label, undefined, { force: true });
    const voxelBakeWarning = warnOnBake ? engineBakeWarning(priorLang, 'voxel') : null;
    if (voxelBakeWarning) showToast(voxelBakeWarning, { variant: 'warn', source: 'engine' });
    return {
      ok: true,
      label: result.label,
      geometry: getGeometryDataObj(),
      ...(voxelBakeWarning ? { warnings: [voxelBakeWarning] } : {}),
    };
  }

  // ---- Place / Rotate (drop-to-floor, center, free rotate, auto lay-flat) --

  /** The current model's axis-aligned bounding box, from the cached geometry
   *  stats. Null when no model has been run yet. */
  function placementBox(): PlacementBox | null {
    const gd = getGeometryDataObj() as { boundingBox?: { x?: number[]; y?: number[]; z?: number[] } | null } | null;
    const bb = gd?.boundingBox;
    if (!bb?.x || !bb?.y || !bb?.z || bb.x.length < 2 || bb.y.length < 2 || bb.z.length < 2) return null;
    const min: Vec3 = [bb.x[0], bb.y[0], bb.z[0]];
    const max: Vec3 = [bb.x[1], bb.y[1], bb.z[1]];
    if (![...min, ...max].every(Number.isFinite)) return null;
    return { min, max };
  }

  /** Whether the active model has *any* parametric transform path (so the panel
   *  offers the write-back choice). manifold-js handles every transform; voxel
   *  code is also JS and its grid has a self-rounding `.translate([…])`, so
   *  translate-only ops stay parametric (rotation needs voxel's 90° `.rotate`,
   *  handled per-op below). Manual paint blocks both: world-space paint-region
   *  descriptors can't follow a parametric move. Model-declared label colors
   *  re-resolve from the re-run code, so they don't block parametric. */
  function canPlaceParametric(): boolean {
    if (hasColorRegions()) return false;
    const lang = getActiveLanguage();
    return lang === 'manifold-js' || lang === 'voxel';
  }

  /** Whether *this specific* transform chain can be applied parametrically.
   *  manifold-js: any chain. voxel: translate-only (its grid lacks the generic
   *  `.rotate([x,y,z])` — voxel rotation is 90°-lattice via `v.rotate('z',90)`,
   *  so rotate/lay-flat bake). Everything else (scad/replicad, or any manual
   *  paint): bake. */
  function stepsSupportParametric(steps: TransformStep[]): boolean {
    if (hasColorRegions()) return false;
    const lang = getActiveLanguage();
    if (lang === 'manifold-js') return true;
    if (lang === 'voxel') return steps.every(s => s.kind === 'translate');
    return false;
  }

  /** Commit a transform chain as editable code: extend the source's wrapper with
   *  the new `.rotate`/`.translate` calls, keeping the model parametric. */
  async function commitTransformParametric(steps: TransformStep[], label: string): Promise<Record<string, unknown>> {
    const date = new Date().toISOString().slice(0, 10);
    const newCode = buildTransformCode(getValue(), steps, label, date);
    setValue(newCode);
    const ok = await runCodeSync(newCode);
    if (!ok) return { error: `Failed to apply ${label}` };
    const thumbnail = await captureThumbnail();
    await saveVersion(newCode, enrichGeometryDataWithColors(getGeometryDataObj()), thumbnail, label, undefined, { force: true });
    return { ok: true, label, mode: 'parametric', geometry: getGeometryDataObj() };
  }

  /** Apply a rigid transform chain to the current model and save a version,
   *  picking the write-back mode ('auto' → parametric when safe, else bake). */
  async function commitTransform(steps: TransformStep[], label: string, mode: 'parametric' | 'bake' | 'auto' | undefined, preserveColor: boolean | undefined): Promise<Record<string, unknown>> {
    const canParam = stepsSupportParametric(steps);
    let resolved: 'parametric' | 'bake' = mode === undefined || mode === 'auto'
      ? (canParam ? 'parametric' : 'bake')
      : mode;
    if (resolved === 'parametric' && !canParam) resolved = 'bake';
    const warnings: string[] = [];
    // Warn whenever we *fall back* to baking (not when the user explicitly chose
    // 'bake'): baking converts a voxel/SCAD/BREP model into a manifold-js mesh,
    // a notable side effect the user didn't necessarily ask for.
    if (resolved === 'bake' && mode !== 'bake' && !canParam) {
      if (hasColorRegions()) {
        warnings.push('Model has manual paint — baked to a mesh so the paint is preserved.');
      } else if (getActiveLanguage() === 'voxel') {
        warnings.push("Voxel rotation needs 90° steps — baked to a mesh. To keep it a voxel, rotate in code with v.rotate('z', 90).");
      } else {
        warnings.push("This model type can't transform parametrically — baked to a mesh.");
      }
    }
    let result: Record<string, unknown>;
    if (resolved === 'parametric') {
      result = await commitTransformParametric(steps, label);
    } else {
      const preserve = preserveColor ?? true;
      result = await commitSurfaceModifier(applyTransform(meshForModifier(preserve), steps, label), preserve, { warnOnBake: false });
    }
    return warnings.length && !result.error ? { ...result, warnings } : result;
  }

  /** Reposition the current model onto the print bed (drop-to-floor / center). */
  async function placeModel(opts?: PlacementOps & { mode?: 'parametric' | 'bake' | 'auto'; preserveColor?: boolean }): Promise<Record<string, unknown>> {
    try {
      if (!currentMeshData) return { error: 'No model loaded' };
      const box = placementBox();
      if (!box) return { error: 'No bounding box available — run the model first' };
      const ops: PlacementOps = {
        dropToFloor: opts?.dropToFloor ?? false,
        centerX: opts?.centerX ?? false,
        centerY: opts?.centerY ?? false,
        centerZ: opts?.centerZ ?? false,
      };
      if (!ops.dropToFloor && !ops.centerX && !ops.centerY && !ops.centerZ) {
        return { error: 'placeModel: choose at least one of dropToFloor, centerX, centerY, centerZ' };
      }
      const delta = computePlacementDelta(box, ops);
      const label = placementLabel(ops);
      if (isNoopDelta(delta, box)) {
        return { ok: true, noop: true, label, message: 'Model is already positioned' };
      }
      return await commitTransform([{ kind: 'translate', v: delta }], label, opts?.mode, opts?.preserveColor);
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) };
    }
  }

  /** Freely rotate the current model by Euler degrees, about its own center so
   *  it spins in place rather than swinging around the world origin. */
  async function rotateModel(opts?: { x?: number; y?: number; z?: number; mode?: 'parametric' | 'bake' | 'auto'; preserveColor?: boolean }): Promise<Record<string, unknown>> {
    try {
      if (!currentMeshData) return { error: 'No model loaded' };
      const box = placementBox();
      if (!box) return { error: 'No bounding box available — run the model first' };
      const euler: Vec3 = [opts?.x ?? 0, opts?.y ?? 0, opts?.z ?? 0];
      if (![...euler].every(Number.isFinite)) return { error: 'rotateModel: x/y/z must be finite degrees' };
      const label = rotationLabel(euler);
      if (isNoopRotation(euler)) return { ok: true, noop: true, label, message: 'No rotation requested' };
      return await commitTransform(rotateAboutCenterSteps(box, euler), label, opts?.mode, opts?.preserveColor);
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) };
    }
  }

  /** Auto-orient: find the model's largest flat face, rotate it onto the bed
   *  (about the model center), and drop the result to the floor. */
  async function layFlatModel(opts?: { mode?: 'parametric' | 'bake' | 'auto'; preserveColor?: boolean }): Promise<Record<string, unknown>> {
    try {
      if (!currentMeshData) return { error: 'No model loaded' };
      const box = placementBox();
      if (!box) return { error: 'No bounding box available — run the model first' };
      const euler = bestFlatDownRotation(currentMeshData);
      if (!euler) return { error: 'Could not find a flat face to lay down' };
      // Rotate about the model center, then drop to the floor. The drop distance
      // is measured from the rotated mesh so it's exact regardless of how the
      // rotation reshapes the bounding box.
      const rotSteps = rotateAboutCenterSteps(box, euler);
      const rotated = applySteps(currentMeshData, rotSteps);
      const minZ = meshBox(rotated).min[2];
      const steps: TransformStep[] = [...rotSteps, { kind: 'translate', v: [0, 0, -minZ] }];
      const label = 'lay flat (auto)';
      if (rotSteps.length === 0 && isNoopDelta([0, 0, -minZ], box)) {
        return { ok: true, noop: true, label, message: 'Model is already lying flat on the bed' };
      }
      return await commitTransform(steps, label, opts?.mode, opts?.preserveColor);
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) };
    }
  }

  /** Mirror (flip) the current model across its own center plane along the given
   *  axis, so it stays in place rather than reflecting across the world origin. */
  async function mirrorModel(opts?: { axis?: 'x' | 'y' | 'z'; mode?: 'parametric' | 'bake' | 'auto'; preserveColor?: boolean }): Promise<Record<string, unknown>> {
    try {
      if (!currentMeshData) return { error: 'No model loaded' };
      const box = placementBox();
      if (!box) return { error: 'No bounding box available — run the model first' };
      const axis = opts?.axis ?? 'x';
      if (axis !== 'x' && axis !== 'y' && axis !== 'z') return { error: "mirrorModel: axis must be 'x', 'y', or 'z'" };
      return await commitTransform(mirrorAboutCenterSteps(box, axis), mirrorLabel(axis), opts?.mode, opts?.preserveColor);
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) };
    }
  }

  // Build a modifier result from an id + options (shared by apply and preview).
  // Every modifier receives the color-baked mesh when preserveColor is on:
  // the texture/smooth paths carry triColors (with _painted) through subdivision
  // so the result already has correct per-triangle paint — no post-hoc transfer.
  // `quality` (mesh-detail) is threaded into each opts object so the surface
  // panel's detail slider takes effect in both preview and apply.
  async function buildSurfaceModifier(
    id: 'fuzzy' | 'knit' | 'cable' | 'waffle' | 'fur' | 'woven' | 'knurl' | 'voronoi' | 'voronoiLamp' | 'engrave' | 'smooth' | 'voxelize',
    opts: Record<string, unknown> | undefined,
    preserveColor: boolean,
    ctl?: SdfRunControl,
  ): Promise<ModifierResult> {
    const sel = opts?.selectedTriangles as Set<number> | undefined;
    if (id === 'fuzzy') {
      const mesh = meshForModifier(preserveColor);
      const base = defaultFuzzyOptions(mesh);
      const fuzzyOpts = {
        amplitude: (opts?.amplitude as number) ?? base.amplitude,
        scale: (opts?.scale as number) ?? base.scale,
        octaves: (opts?.octaves as number) ?? base.octaves,
        seed: (opts?.seed as number) ?? base.seed,
        quality: (opts?.quality as number) ?? base.quality,
      };
      if (sel && sel.size > 0) return applyFuzzyPatch(mesh, fuzzyOpts, sel);
      return applyFuzzy(mesh, fuzzyOpts);
    }
    if (id === 'knit') {
      const mesh = meshForModifier(preserveColor);
      const base = defaultKnitOptions(mesh);
      const knitOpts = {
        amplitude: (opts?.amplitude as number) ?? base.amplitude,
        stitchWidth: (opts?.stitchWidth as number) ?? base.stitchWidth,
        stitchHeight: (opts?.stitchHeight as number) ?? base.stitchHeight,
        rowOffset: (opts?.rowOffset as number) ?? base.rowOffset,
        roundness: (opts?.roundness as number) ?? base.roundness,
        grainAngleDeg: (opts?.grainAngleDeg as number) ?? base.grainAngleDeg,
        variation: (opts?.variation as number) ?? base.variation,
        seed: (opts?.seed as number) ?? base.seed,
        quality: (opts?.quality as number) ?? base.quality,
        // LSCM/harmonic require disk topology — only use them on a selected patch.
        // On a closed mesh they produce partial coverage; fall back to BFS.
        algorithm: (sel && sel.size > 0)
          ? ((opts?.algorithm as typeof base.algorithm) ?? base.algorithm)
          : 'bfs',
      };
      if (sel && sel.size > 0) return applyKnitPatch(mesh, knitOpts, sel);
      return applyKnit(mesh, knitOpts);
    }
    if (id === 'cable') {
      const mesh = meshForModifier(preserveColor);
      const base = defaultCableOptions(mesh);
      const cableOpts = {
        amplitude: (opts?.amplitude as number) ?? base.amplitude,
        cableWidth: (opts?.cableWidth as number) ?? base.cableWidth,
        cablePitch: (opts?.cablePitch as number) ?? base.cablePitch,
        plyWidth: (opts?.plyWidth as number) ?? base.plyWidth,
        grainAngleDeg: (opts?.grainAngleDeg as number) ?? base.grainAngleDeg,
        variation: (opts?.variation as number) ?? base.variation,
        seed: (opts?.seed as number) ?? base.seed,
        quality: (opts?.quality as number) ?? base.quality,
      };
      if (sel && sel.size > 0) return applyCablePatch(mesh, cableOpts, sel);
      return applyCable(mesh, cableOpts);
    }
    if (id === 'waffle') {
      const mesh = meshForModifier(preserveColor);
      const base = defaultWaffleOptions(mesh);
      const waffleOpts = {
        amplitude: (opts?.amplitude as number) ?? base.amplitude,
        cellWidth: (opts?.cellWidth as number) ?? base.cellWidth,
        cellHeight: (opts?.cellHeight as number) ?? base.cellHeight,
        sharpness: (opts?.sharpness as number) ?? base.sharpness,
        rowOffset: (opts?.rowOffset as number) ?? base.rowOffset,
        grainAngleDeg: (opts?.grainAngleDeg as number) ?? base.grainAngleDeg,
        quality: (opts?.quality as number) ?? base.quality,
      };
      if (sel && sel.size > 0) return applyWafflePatch(mesh, waffleOpts, sel);
      return applyWaffle(mesh, waffleOpts);
    }
    if (id === 'fur') {
      const mesh = meshForModifier(preserveColor);
      const base = defaultFurOptions(mesh);
      const furOpts = {
        amplitude: (opts?.amplitude as number) ?? base.amplitude,
        fiberSpacing: (opts?.fiberSpacing as number) ?? base.fiberSpacing,
        fiberLength: (opts?.fiberLength as number) ?? base.fiberLength,
        octaves: (opts?.octaves as number) ?? base.octaves,
        grainAngleDeg: (opts?.grainAngleDeg as number) ?? base.grainAngleDeg,
        seed: (opts?.seed as number) ?? base.seed,
        quality: (opts?.quality as number) ?? base.quality,
      };
      if (sel && sel.size > 0) return applyFurPatch(mesh, furOpts, sel);
      return applyFur(mesh, furOpts);
    }
    if (id === 'woven') {
      const mesh = meshForModifier(preserveColor);
      const base = defaultWovenOptions(mesh);
      const wovenOpts = {
        amplitude: (opts?.amplitude as number) ?? base.amplitude,
        threadSpacing: (opts?.threadSpacing as number) ?? base.threadSpacing,
        threadWidth: (opts?.threadWidth as number) ?? base.threadWidth,
        underDepth: (opts?.underDepth as number) ?? base.underDepth,
        grainAngleDeg: (opts?.grainAngleDeg as number) ?? base.grainAngleDeg,
        seed: (opts?.seed as number) ?? base.seed,
        quality: (opts?.quality as number) ?? base.quality,
      };
      if (sel && sel.size > 0) return applyWovenPatch(mesh, wovenOpts, sel);
      return applyWoven(mesh, wovenOpts);
    }
    if (id === 'knurl') {
      const mesh = meshForModifier(preserveColor);
      const base = defaultKnurlOptions(mesh);
      const knurlOpts = {
        amplitude: (opts?.amplitude as number) ?? base.amplitude,
        cellWidth: (opts?.cellWidth as number) ?? base.cellWidth,
        cellHeight: (opts?.cellHeight as number) ?? base.cellHeight,
        style: (opts?.style as 'diamond' | 'straight' | 'ribs') ?? base.style,
        profile: (opts?.profile as 'round' | 'pyramid') ?? base.profile,
        sharpness: (opts?.sharpness as number) ?? base.sharpness,
        grainAngleDeg: (opts?.grainAngleDeg as number) ?? base.grainAngleDeg,
        seed: (opts?.seed as number) ?? base.seed,
        quality: (opts?.quality as number) ?? base.quality,
      };
      if (sel && sel.size > 0) return applyKnurlPatch(mesh, knurlOpts, sel);
      return applyKnurl(mesh, knurlOpts);
    }
    if (id === 'voronoi') {
      const mesh = meshForModifier(preserveColor);
      const base = defaultVoronoiOptions(mesh);
      const voronoiOpts = {
        amplitude: (opts?.amplitude as number) ?? base.amplitude,
        cellSize: (opts?.cellSize as number) ?? base.cellSize,
        wallWidth: (opts?.wallWidth as number) ?? base.wallWidth,
        raised: (opts?.raised as boolean) ?? base.raised,
        jitter: (opts?.jitter as number) ?? base.jitter,
        grainAngleDeg: (opts?.grainAngleDeg as number) ?? base.grainAngleDeg,
        seed: (opts?.seed as number) ?? base.seed,
        quality: (opts?.quality as number) ?? base.quality,
      };
      if (sel && sel.size > 0) return applyVoronoiPatch(mesh, voronoiOpts, sel);
      return applyVoronoi(mesh, voronoiOpts);
    }
    if (id === 'voronoiLamp') {
      // Perforated shell → voxel output; whole-model only (no region patch).
      const mesh = meshForModifier(preserveColor);
      const base = defaultVoronoiLampOptions(mesh);
      return applyVoronoiLamp(mesh, {
        cellSize: (opts?.cellSize as number) ?? base.cellSize,
        wallThickness: (opts?.wallThickness as number) ?? base.wallThickness,
        strutWidth: (opts?.strutWidth as number) ?? base.strutWidth,
        resolution: (opts?.resolution as number) ?? base.resolution,
        jitter: (opts?.jitter as number) ?? base.jitter,
        grainAngleDeg: (opts?.grainAngleDeg as number) ?? base.grainAngleDeg,
        seed: (opts?.seed as number) ?? base.seed,
        watertight: (opts?.watertight as boolean) ?? base.watertight,
        output: (opts?.output as 'mesh' | 'voxel') ?? base.output,
        smooth: (opts?.smooth as boolean) ?? base.smooth,
      }, ctl);
    }
    if (id === 'engrave') {
      // Whole-model carve or emboss (no region patch). The ink mask is
      // pre-rasterized by the host (text via the app's font path, or a decoded
      // image) and passed in opts.mask. The SDF sweep yields via `ctl` so the
      // UI shows progress.
      const mesh = meshForModifier(preserveColor);
      const base = defaultEngraveOptions(mesh);
      const mask = opts?.mask as StampMask | undefined;
      if (!mask || mask.width === 0 || mask.height === 0) {
        throw new Error('engrave requires a rasterized stamp — provide text or an image first.');
      }
      const raised = (opts?.raised as boolean) ?? false;
      const engraveOpts = {
        mask,
        projection: (opts?.projection as EngraveProjection) ?? base.projection,
        through: raised ? false : ((opts?.through as boolean) ?? base.through),
        raised,
        depth: (opts?.depth as number) ?? base.depth,
        size: (opts?.size as number) ?? base.size,
        resolution: (opts?.resolution as number) ?? base.resolution,
        watertight: (opts?.watertight as boolean) ?? base.watertight,
        source: opts?.source as string | undefined,
        color: parseStampColor(opts?.color),
      };
      // Run the dense SDF carve in the engrave Worker so it never janks the UI;
      // the cheap result assembly (paint transfer + version code) stays here.
      const baked = await engraveInWorker(mesh, engraveOpts, ctl);
      return buildEngraveResult(mesh, baked, engraveOpts);
    }
    if (id === 'smooth') {
      const mesh = meshForModifier(preserveColor);
      const base = defaultSmoothOptions();
      const smoothOpts = {
        iterations: (opts?.iterations as number) ?? base.iterations,
        subdivide: (opts?.subdivide as boolean) ?? base.subdivide,
      };
      if (sel && sel.size > 0) return applySmoothPatch(mesh, smoothOpts, sel);
      return applySmooth(mesh, smoothOpts);
    }
    // voxelize: feed the color-baked mesh when preserving so per-voxel color is sampled.
    return applyVoxelize(meshForModifier(preserveColor), {
      resolution: (opts?.resolution as number) ?? 32,
      smooth: (opts?.smooth as boolean) ?? false,
    });
  }

  /** Normalize a stamp color from its console/UI forms — '#rrggbb' hex (the
   *  color input) or [r,g,b] in [0,1] (the paint API's convention) — to the
   *  modifier's [0,1] tuple. Returns undefined for absent or malformed input
   *  (engraveModel validates and reports the error before reaching here). */
  function parseStampColor(c: unknown): [number, number, number] | undefined {
    if (typeof c === 'string') {
      return /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.test(c.trim()) ? hexToRgb(c) : undefined;
    }
    if (Array.isArray(c) && c.length === 3 && c.every(n => typeof n === 'number' && Number.isFinite(n))) {
      const clamp01 = (n: number) => Math.min(1, Math.max(0, n));
      return [clamp01(c[0]), clamp01(c[1]), clamp01(c[2])];
    }
    return undefined;
  }

  // The SDF carves (engrave, voronoi lamp) sweep a dense lattice and can take a
  // few seconds. Drive the same inline "Rendering…" status indicator (timer +
  // the toolbar Cancel link) that a normal model run uses, rather than a modal —
  // the Cancel aborts the sweep (see surfaceCarveCancel, wired into
  // cancelInlineBtn). Supersede any in-flight carve when a newer one starts
  // (rapid slider edits). Lighter modifiers run inline with no indicator.
  // surfaceCarveAbort / surfaceCarveCancel are declared early (near the
  // fast-preview pill setup) so the Cancel handler can be wired before the
  // initial render; this block only assigns them.
  const SDF_HEAVY = new Set(['engrave', 'voronoiLamp']);
  async function buildSurfaceModifierProgress(
    id: Parameters<typeof buildSurfaceModifier>[0],
    opts: Record<string, unknown> | undefined,
    preserveColor: boolean,
  ): Promise<ModifierResult> {
    if (!SDF_HEAVY.has(id)) return buildSurfaceModifier(id, opts, preserveColor);
    surfaceCarveAbort?.abort();              // supersede an in-flight carve
    const abort = new AbortController();
    surfaceCarveAbort = abort;
    surfaceCarveCancel = () => abort.abort();
    startRunTimer(performance.now());        // shared inline "Rendering… Xs" + Cancel
    try {
      return await buildSurfaceModifier(id, opts, preserveColor, { signal: abort.signal });
    } finally {
      // Only the current carve owns the indicator — a superseded one must not
      // hide the timer the newer carve just started.
      if (surfaceCarveAbort === abort) {
        stopRunTimer();
        setStatus(statusBar, 'ready', 'Ready');
        surfaceCarveAbort = null;
        surfaceCarveCancel = null;
      }
    }
  }

  /** Resolve a preview op's `label` / `region` scope (the same keys Apply uses)
   *  into a concrete `selectedTriangles` set against the current mesh, so a
   *  scoped preview shows the same patch Apply will produce — closing the gap
   *  where "By label" / "Near point" previewed the whole-model texture. Strips
   *  the scope keys (buildSurfaceModifier only understands selectedTriangles).
   *  Returns opts unchanged when the op isn't scoped; throws (→ surfaced as a
   *  preview error) on a malformed scope, matching Apply's validation. */
  function resolvePreviewScope(
    id: string,
    opts: Record<string, unknown> | undefined,
  ): Record<string, unknown> | undefined {
    if (!opts || (!('label' in opts) && !('region' in opts))) return opts;
    const rest: Record<string, unknown> = { ...opts };
    delete rest.label;
    delete rest.region;
    if (!isSurfaceOpId(id) || !currentMeshData) return rest;
    const scopeOnly: Record<string, unknown> = {};
    if ('label' in opts) scopeOnly.label = opts.label;
    if ('region' in opts) scopeOnly.region = opts.region;
    const { scope } = parseSurfaceOpts(id, scopeOnly);
    if (!scope) return rest;
    const resolved = resolveSurfaceScopes([{ id, params: {}, scope }], currentMeshData, currentLabelMap);
    const rs = resolved?.[0];
    // Resolve to a patch selection; an empty label set selects nothing (the op
    // previews as a no-op, mirroring Apply rather than texturing the whole model).
    rest.selectedTriangles = rs ? selectTrianglesNearSeeds(currentMeshData, rs.seeds, rs.radius) : new Set<number>();
    return rest;
  }

  // === Expose window.partwright console API ===
  const partwrightAPI = {
    /** Whether the current model carries paint (so the UI can warn before a
     *  color-clearing modifier, or offer "preserve colors"). */
    modelHasColor(): boolean { return modelHasColor(); },
    /** Make sure the model's pending `api.surface.*` chain (parked by a Cancel
     *  or a compute failure — the "Re-apply" pill state) is applied, so that
     *  previews, modifiers, and exports operate on the textured mesh rather
     *  than the base. No-ops (resolves true) when nothing is pending. The
     *  Surface panel awaits this before every preview. */
    async ensureSurfaceTexturesApplied(): Promise<{ ok: boolean }> {
      if (!pendingSurface) return { ok: true };
      const applied = await reapplySurfaceTextures();
      return { ok: applied && pendingSurface === null };
    },
    /** Non-destructive viewport preview of a surface modifier (no version saved).
     *  Call clearSurfacePreview() / re-run to restore.
     *  id: 'fuzzy'|'knit'|'cable'|'waffle'|'fur'|'woven'|'knurl'|'voronoi'|'voronoiLamp'|'engrave'|'smooth'|'voxelize'. */
    async previewSurfaceModifier(id: 'fuzzy' | 'knit' | 'cable' | 'waffle' | 'fur' | 'woven' | 'knurl' | 'voronoi' | 'voronoiLamp' | 'engrave' | 'smooth' | 'voxelize', opts?: Record<string, unknown>, preserveColor = true): Promise<{ ok: true } | { error: string }> {
      try {
        const scopedOpts = resolvePreviewScope(id, opts);
        previewSurfaceModifier(await buildSurfaceModifierProgress(id, scopedOpts, preserveColor), preserveColor);
        return { ok: true };
      } catch (e) {
        // A superseded / user-cancelled carve isn't an error — keep the prior preview.
        if (e instanceof SdfAbortError || (e as { name?: string })?.name === 'AbortError') return { ok: true };
        return { error: e instanceof Error ? e.message : String(e) };
      }
    },
    /** Discard a live surface preview and restore the current model's mesh. */
    clearSurfacePreview(): { ok: true } { clearSurfacePreview(); return { ok: true }; },
    /** Write a surface texture into the model code as an `api.surface.<id>({…})`
     *  call instead of baking the mesh (manifold-js sessions only). Updates the
     *  existing call for the same modifier in place, or inserts a new one before
     *  the code's final `return`; then re-runs (computing the texture) and saves
     *  a new version. The texture stays parametric — it recomputes when the model
     *  changes and persists with the saved version. Whole-model only: for a
     *  selected patch, or for SCAD/BREP/voxel sessions, use the bake tools
     *  (applyFuzzySkin / applyKnitTexture / …) instead.
     *  id: 'fuzzy'|'knit'|'cable'|'waffle'|'fur'|'woven'|'voronoi'|'smooth'.
     *  opts: that op's api.surface options (see /ai/textures.md); omitted keys
     *  use size-relative defaults at apply time.
     *  Returns `{ ok, call, replaced, version?, geometry }` or `{ error }`. */
    async applySurfaceTextureAsCode(id: SurfaceOpId, opts?: Record<string, unknown>) {
      const check = guard(() => {
        assertEnum(id, SURFACE_OP_IDS, 'applySurfaceTextureAsCode(id)');
        if (opts !== undefined) {
          const o = assertObject(opts, 'applySurfaceTextureAsCode(_, opts)')!;
          // Shared validator: scalar params + the reserved scope keys
          // (label / region). It throws a plain Error; re-wrap as a
          // ValidationError so guard() returns { error } instead of throwing.
          try {
            parseSurfaceOpts(id as SurfaceOpId, o as Record<string, unknown>);
          } catch (e) {
            throw new ValidationError(e instanceof Error ? e.message : String(e));
          }
        }
        return true;
      });
      if (typeof check === 'object' && check !== null && 'error' in check) return check;
      if (isSharedPreview()) return { error: SHARED_PREVIEW_REFUSAL };
      if (getActiveLanguage() !== 'manifold-js') {
        return { error: `api.surface.* textures live in manifold-js code only — this session is ${getActiveLanguage()}. Use the bake tools (applyFuzzySkin / applyKnitTexture / …), which convert the result to a mesh.` };
      }
      const previousCode = getValue();
      const up = upsertSurfaceCall(previousCode, id, (opts ?? {}) as Record<string, unknown>);
      if (!up) {
        return { error: 'Could not find a top-level `return` in the code to insert the api.surface call before. Add the call manually, or bake instead.' };
      }
      setValue(up.code);
      const applied = await runCodeSync(up.code);
      if (!applied) return { error: 'Run was superseded by a concurrent execution — retry' };
      const geo = getGeometryDataObj() as { status?: string; error?: string } | null;
      if (geo?.status === 'error') {
        // The edited code doesn't run — put the buffer back the way it was
        // (and re-render the previous model) rather than leaving a broken edit.
        setValue(previousCode);
        await runCodeSync(previousCode);
        return { error: `Applying the texture failed: ${geo.error ?? 'run error'}. The code was restored.` };
      }
      // The code ran, but the texture compute itself can still have failed —
      // applySurfaceTextures keeps the base mesh and raises the Re-apply pill
      // in that case (geometry status stays 'ok'). The call is in the code, so
      // the edit stands; report it honestly instead of implying textured stats.
      const computeFailed = pendingSurface !== null;
      const saved = await saveCurrentVersion(`api.surface.${id}`);
      return {
        ok: true,
        call: up.call,
        replaced: up.replaced,
        ...('id' in saved ? { version: { id: saved.id, index: saved.index, label: saved.label } } : {}),
        ...('error' in saved ? { saveWarning: saved.error } : {}),
        ...('skipped' in saved ? { saveSkipped: saved.reason } : {}),
        ...(computeFailed ? { warnings: ['The texture compute failed — the call is in the code but the model shows the untextured base mesh. Press the ⟳ Re-apply pill (or run again) to retry.'] } : {}),
        geometry: getGeometryDataObj(),
      };
    },
    /** Apply a surface texture by the best available path — the auto-routing
     *  twin of the Surface panel's Apply (and the in-app AI's single texture
     *  tool). mode 'auto' (default): a manifold-js session gets the texture AS
     *  CODE (`api.surface.<id>` upserted via applySurfaceTextureAsCode — stays
     *  parametric); any other engine falls back to the BAKE tool for that id
     *  (with the engine-bake warning). 'code' forces the in-code path (errors
     *  off manifold-js); 'bake' forces the destructive bake on any engine.
     *  Whole-model only — for a selected patch use the per-texture bake
     *  methods' selectedTriangles. opts: that id's api.surface options, plus
     *  preserveColor (bake path only; code-path paint re-resolves every run).
     *  Returns the underlying result plus `path: 'code' | 'bake'`. */
    async applySurfaceTexture(
      id: SurfaceOpId,
      opts?: Record<string, unknown>,
      mode: 'auto' | 'code' | 'bake' = 'auto',
    ) {
      const check = guard(() => {
        assertEnum(id, SURFACE_OP_IDS, 'applySurfaceTexture(id)');
        assertEnum(mode, ['auto', 'code', 'bake'], 'applySurfaceTexture(_, _, mode)');
        if (opts !== undefined) {
          const o = assertObject(opts, 'applySurfaceTexture(_, opts)')!;
          assertNoUnknownKeys(o, [...(SURFACE_OP_FIELDS[id as SurfaceOpId] ?? []), 'preserveColor', ...SURFACE_SCOPE_KEYS], 'applySurfaceTexture(_, opts)');
        }
        return true;
      });
      if (typeof check === 'object' && check !== null && 'error' in check) return check;
      const { preserveColor, label, region, ...opOpts } = (opts ?? {}) as Record<string, unknown> & { preserveColor?: boolean };
      const scoped = label !== undefined || region !== undefined;
      const scopeOpts = {
        ...(label !== undefined ? { label } : {}),
        ...(region !== undefined ? { region } : {}),
      };
      const asCode = mode === 'code' || (mode === 'auto' && getActiveLanguage() === 'manifold-js');
      if (asCode) {
        // The code path resolves label/region scopes via parseSurfaceOpts.
        const r = await partwrightAPI.applySurfaceTextureAsCode(id, { ...opOpts, ...scopeOpts });
        return { path: 'code' as const, ...r };
      }
      // Bake methods are whole-model only — they can't honor a label/region
      // scope, so reject rather than silently texture the entire mesh.
      if (scoped) {
        return { error: `applySurfaceTexture: scoping (label/region) is only supported on the code path (a manifold-js session). The current session bakes whole-model; switch to manifold-js or drop the scope.` };
      }
      const bakeOpts = { ...opOpts, ...(preserveColor !== undefined ? { preserveColor } : {}) } as Record<string, number | boolean | string> & { preserveColor?: boolean };
      const r = id === 'fuzzy' ? await partwrightAPI.applyFuzzySkin(bakeOpts)
        : id === 'knit' ? await partwrightAPI.applyKnitTexture(bakeOpts)
        : id === 'cable' ? await partwrightAPI.applyCableKnit(bakeOpts)
        : id === 'waffle' ? await partwrightAPI.applyWaffleStitch(bakeOpts)
        : id === 'fur' ? await partwrightAPI.applyFurVelvet(bakeOpts)
        : id === 'woven' ? await partwrightAPI.applyWovenFabric(bakeOpts)
        : id === 'knurl' ? await partwrightAPI.applyKnurlTexture(bakeOpts)
        : id === 'voronoi' ? await partwrightAPI.applyVoronoiShell(bakeOpts)
        : await partwrightAPI.smoothModel(bakeOpts);
      return { path: 'bake' as const, ...(r as Record<string, unknown>) };
    },
    /** Apply a fuzzy-skin surface texture to the current model; saves a new version.
     *  `preserveColor` (default true) re-resolves paint regions onto the new mesh.
     *  Returns `{ ok, label, geometry, colorsCarried, warnings? }`. */
    async applyFuzzySkin(opts?: { amplitude?: number; scale?: number; octaves?: number; seed?: number; quality?: number; preserveColor?: boolean }) {
      try {
        const preserve = opts?.preserveColor ?? true;
        const mesh = requireCurrentMeshForModifier();
        const warns = textureWarnings('fuzzy', opts ?? {}, mesh);
        const result = await commitSurfaceModifier(await buildSurfaceModifierProgress('fuzzy', opts, preserve), preserve);
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
      algorithm?: 'bfs' | 'lscm' | 'harmonic';
      selectedTriangles?: Set<number>;
      preserveColor?: boolean;
    }) {
      try {
        const preserve = opts?.preserveColor ?? true;
        const mesh = meshForModifier(preserve);
        const warns = textureWarnings('knit', opts ?? {}, mesh);
        const base = defaultKnitOptions(mesh);
        const knitOpts = {
          amplitude:     (opts?.amplitude     as number) ?? base.amplitude,
          stitchWidth:   (opts?.stitchWidth   as number) ?? base.stitchWidth,
          stitchHeight:  (opts?.stitchHeight  as number) ?? base.stitchHeight,
          rowOffset:     (opts?.rowOffset     as number) ?? base.rowOffset,
          roundness:     (opts?.roundness     as number) ?? base.roundness,
          grainAngleDeg: (opts?.grainAngleDeg as number) ?? base.grainAngleDeg,
          variation:     (opts?.variation     as number) ?? base.variation,
          seed:          (opts?.seed          as number) ?? base.seed,
          quality:       (opts?.quality       as number) ?? base.quality,
          algorithm:     (opts?.algorithm     as typeof base.algorithm) ?? base.algorithm,
          subdivide:     true,
        };
        const selectedTriangles = opts?.selectedTriangles;
        const modifier = (selectedTriangles && selectedTriangles.size > 0)
          ? await applyKnitPatchAsync(mesh, knitOpts, selectedTriangles)
          : await applyKnitAsync(mesh, knitOpts);
        const result = await commitSurfaceModifier(modifier, preserve);
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
        const result = await commitSurfaceModifier(await buildSurfaceModifierProgress('cable', opts, preserve), preserve);
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
        const result = await commitSurfaceModifier(await buildSurfaceModifierProgress('waffle', opts, preserve), preserve);
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
        const result = await commitSurfaceModifier(await buildSurfaceModifierProgress('fur', opts, preserve), preserve);
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
        const result = await commitSurfaceModifier(await buildSurfaceModifierProgress('woven', opts, preserve), preserve);
        if (warns.length > 0 && result && typeof result === 'object' && 'ok' in result) {
          const existing = (result as Record<string, unknown>).warnings as string[] | undefined;
          return { ...result, warnings: [...warns, ...(existing ?? [])] };
        }
        return result;
      } catch (e) { return { error: e instanceof Error ? e.message : String(e) }; }
    },

    /** Apply a knurl grip texture to the current model; saves a new version.
     *  Functional grip relief — diamond cross-hatch, straight axial splines, or
     *  horizontal finger ribs — displaced along surface normals. Distinct from
     *  the `api.knurl.*` shape generator: this textures any existing mesh.
     *  `preserveColor` (default true) carries paint across subdivision.
     *  Returns `{ ok, label, geometry, colorsCarried, warnings? }`. */
    async applyKnurlTexture(opts?: {
      amplitude?: number;
      cellWidth?: number;
      cellHeight?: number;
      style?: 'diamond' | 'straight' | 'ribs';
      profile?: 'round' | 'pyramid';
      sharpness?: number;
      grainAngleDeg?: number;
      seed?: number;
      quality?: number;
      preserveColor?: boolean;
    }) {
      try {
        const preserve = opts?.preserveColor ?? true;
        const mesh = requireCurrentMeshForModifier();
        const warns = textureWarnings('knurl', opts ?? {}, mesh);
        const result = await commitSurfaceModifier(await buildSurfaceModifierProgress('knurl', opts, preserve), preserve);
        if (warns.length > 0 && result && typeof result === 'object' && 'ok' in result) {
          const existing = (result as Record<string, unknown>).warnings as string[] | undefined;
          return { ...result, warnings: [...warns, ...(existing ?? [])] };
        }
        return result;
      } catch (e) { return { error: e instanceof Error ? e.message : String(e) }; }
    },

    /** Apply a Voronoi-shell surface texture to the current model; saves a new version.
     *  Produces an organic cell-wall relief — a network of raised ridges tracing
     *  Voronoi cell boundaries (cracked-mud / dragonfly-wing / lampshade look).
     *  Set raised=false to engrave the network as channels; jitter=0 for a regular grid.
     *  `preserveColor` (default true) carries paint across subdivision.
     *  Returns `{ ok, label, geometry, colorsCarried, warnings? }`. */
    async applyVoronoiShell(opts?: {
      amplitude?: number;
      cellSize?: number;
      wallWidth?: number;
      raised?: boolean;
      jitter?: number;
      grainAngleDeg?: number;
      seed?: number;
      quality?: number;
      preserveColor?: boolean;
    }) {
      try {
        const preserve = opts?.preserveColor ?? true;
        const mesh = requireCurrentMeshForModifier();
        const warns = textureWarnings('voronoi', opts ?? {}, mesh);
        const result = await commitSurfaceModifier(await buildSurfaceModifierProgress('voronoi', opts, preserve), preserve);
        if (warns.length > 0 && result && typeof result === 'object' && 'ok' in result) {
          const existing = (result as Record<string, unknown>).warnings as string[] | undefined;
          return { ...result, warnings: [...warns, ...(existing ?? [])] };
        }
        return result;
      } catch (e) { return { error: e instanceof Error ? e.message : String(e) }; }
    },

    /** Turn the current model into a true perforated Voronoi shell (a "Voronoi
     *  lamp"): a thin hollow wall with the cell interiors cut clean through,
     *  leaving a see-through strut network. Unlike applyVoronoiShell (a relief
     *  texture), this opens real holes. `output:'mesh'` (default) bakes a smooth
     *  manifold-js mesh; `output:'voxel'` switches to the voxel engine
     *  (paintable / .vox). Saves a new version. Returns `{ ok, label, geometry, warnings? }`. */
    async applyVoronoiLamp(opts?: {
      cellSize?: number;
      wallThickness?: number;
      strutWidth?: number;
      resolution?: number;
      jitter?: number;
      grainAngleDeg?: number;
      seed?: number;
      watertight?: boolean;
      output?: 'mesh' | 'voxel';
      smooth?: boolean;
      preserveColor?: boolean;
    }) {
      try {
        const preserve = opts?.preserveColor ?? true;
        return await commitSurfaceModifier(await buildSurfaceModifierProgress('voronoiLamp', opts, preserve), preserve);
      } catch (e) { return { error: e instanceof Error ? e.message : String(e) }; }
    },
    /** Rasterize an engrave stamp (text via the app's font path, or a decoded
     *  image) to a mask the surface preview / engraveModel can consume. Browser-
     *  only (font fetch / image decode). Returns `{ mask, width, height }`. */
    async buildEngraveStamp(spec?: { text?: string; font?: 'regular' | 'bold' | 'italic' | 'bold-italic'; imageUrl?: string; invert?: boolean }) {
      try {
        if (spec?.text) {
          const mask = await buildTextStampMask(spec.text, { font: spec.font });
          return { mask, width: mask.width, height: mask.height };
        }
        if (spec?.imageUrl) {
          const mask = await buildImageStampMask(spec.imageUrl, { invert: spec.invert });
          return { mask, width: mask.width, height: mask.height };
        }
        return { error: 'buildEngraveStamp needs `text` or `imageUrl`.' };
      } catch (e) { return { error: e instanceof Error ? e.message : String(e) }; }
    },
    /** Carve TEXT or an IMAGE into the current model as recessed channels
     *  (engrave) or holes through the whole wall (cut-through) — or, with
     *  `raised`, EMBOSS it as a raised relief instead. Unlike the relief
     *  textures (which only displace the skin), this removes (or adds) material.
     *  The stamp is projected onto a chosen face (planar) or wrapped around Z
     *  (cylindrical). Pass `text` (rasterized via the app's font path) or
     *  `imageUrl`; the modal may pass a prebuilt `mask`. `color` paints the
     *  letters ('#rrggbb' or [r,g,b] in 0–1) for multicolor prints. Saves a new
     *  version. Returns `{ ok, label, geometry, warnings? }`. */
    async engraveModel(opts?: {
      text?: string;
      imageUrl?: string;
      mask?: StampMask;
      invert?: boolean;
      font?: 'regular' | 'bold' | 'italic' | 'bold-italic';
      projection?: EngraveProjection;
      mode?: 'planar' | 'cylindrical';
      axis?: 'x' | 'y' | 'z';
      side?: 'min' | 'max' | 'outer' | 'inner';
      posU?: number;
      posV?: number;
      rotationDeg?: number;
      curveAxis?: 'none' | 'u' | 'v';
      curveAngleDeg?: number;
      through?: boolean;
      raised?: boolean;
      depth?: number;
      size?: number;
      color?: string | [number, number, number];
      resolution?: number;
      watertight?: boolean;
      preserveColor?: boolean;
    }) {
      try {
        const preserve = opts?.preserveColor ?? true;
        requireCurrentMeshForModifier();
        if (opts?.color !== undefined && parseStampColor(opts.color) === undefined) {
          return { error: "engraveModel: `color` must be '#rrggbb' hex or [r,g,b] with components in 0–1." };
        }
        let mask = opts?.mask;
        let source: string | undefined;
        if (!mask) {
          if (opts?.text) {
            if (!opts.text.trim()) return { error: 'engraveModel: `text` is empty.' };
            mask = await buildTextStampMask(opts.text, { font: opts.font });
            source = opts.text;
          } else if (opts?.imageUrl) {
            mask = await buildImageStampMask(opts.imageUrl, { invert: opts.invert });
            source = 'image';
          } else {
            return { error: 'engraveModel needs `text` or `imageUrl` (or a prebuilt `mask`).' };
          }
        }
        // Assemble the projection: a structured `projection` wins; otherwise
        // build one from the flat mode/axis/side fields (the AI/console form).
        const curve = opts?.curveAxis && opts.curveAxis !== 'none'
          ? { axis: opts.curveAxis, angleDeg: opts.curveAngleDeg ?? 90 }
          : undefined;
        let projection: EngraveProjection;
        if (opts?.projection) {
          projection = opts.projection;
        } else if (opts?.mode === 'cylindrical') {
          projection = { mode: 'cylindrical', side: opts?.side === 'inner' ? 'inner' : 'outer', rotationDeg: opts?.rotationDeg };
        } else {
          projection = {
            mode: 'planar',
            axis: (opts?.axis as 'x' | 'y' | 'z') ?? 'z',
            side: opts?.side === 'min' ? 'min' : 'max',
            posU: opts?.posU, posV: opts?.posV, rotationDeg: opts?.rotationDeg, curve,
          };
        }
        return await commitSurfaceModifier(
          await buildSurfaceModifierProgress('engrave', { ...opts, mask, projection, source }, preserve),
          preserve,
        );
      } catch (e) { return { error: e instanceof Error ? e.message : String(e) }; }
    },
    /** Smooth/round the current model (Taubin λ/μ); saves a new version. */
    async smoothModel(opts?: { iterations?: number; subdivide?: boolean; preserveColor?: boolean }) {
      try {
        const preserve = opts?.preserveColor ?? true;
        return await commitSurfaceModifier(await buildSurfaceModifierProgress('smooth', opts, preserve), preserve);
      } catch (e) { return { error: e instanceof Error ? e.message : String(e) }; }
    },
    /** Voxelize the current model into the voxel engine; saves a new version. */
    async voxelizeModel(opts?: { resolution?: number; smooth?: boolean; preserveColor?: boolean }) {
      try {
        const preserve = opts?.preserveColor ?? true;
        return await commitSurfaceModifier(await buildSurfaceModifierProgress('voxelize', opts, preserve), preserve);
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
     *  `mode`: 'auto' (default) keeps a manifold-js model parametric (wraps the
     *  source in `.scale([sx,sy,sz])`), else bakes; 'parametric' forces the wrap;
     *  'bake' flattens to a mesh. `preserveColor` (default true) re-resolves paint
     *  regions onto the scaled mesh. */
    async scaleModel(sx: number, sy: number, sz: number, opts?: { mode?: 'parametric' | 'bake' | 'auto'; preserveColor?: boolean }) {
      try {
        if (!currentMeshData) return { error: 'No model loaded' };
        // Match applyScale's guard: a negative factor mirrors the mesh (inside-out,
        // non-manifold) and zero collapses an axis — reject before either path.
        for (const [name, f] of [['sx', sx], ['sy', sy], ['sz', sz]] as const) {
          if (typeof f !== 'number' || !Number.isFinite(f) || f <= 0) {
            return { error: `scaleModel: ${name} must be a positive, finite factor (got ${f}). A negative or zero scale would mirror or collapse the mesh into non-manifold geometry.` };
          }
        }
        const factors: Vec3 = [sx, sy, sz];
        const label = scaleLabel(factors);
        if (isNoopScale(factors)) return { ok: true, noop: true, label, message: 'Scale factors are all 1 — nothing to do' };
        return await commitTransform([{ kind: 'scale', v: factors }], label, opts?.mode, opts?.preserveColor);
      } catch (e) { return { error: e instanceof Error ? e.message : String(e) }; }
    },
    /** Reposition the current model onto the print bed and save a new version.
     *  Combine any of `dropToFloor` (Z-min → 0), `centerX`, `centerY`, `centerZ`.
     *  `mode`: 'auto' (default) keeps the model parametric when safe, else bakes;
     *  'parametric' wraps the source + `.translate`; 'bake' flattens to a mesh.
     *  Returns `{ ok, noop }` when the model is already positioned. */
    async placeModel(opts?: { dropToFloor?: boolean; centerX?: boolean; centerY?: boolean; centerZ?: boolean; mode?: 'parametric' | 'bake' | 'auto'; preserveColor?: boolean }) {
      return placeModel(opts);
    },
    /** Freely rotate the current model by Euler degrees (x/y/z), about its own
     *  center, and save a new version. Same write-back modes as placeModel. */
    async rotateModel(opts?: { x?: number; y?: number; z?: number; mode?: 'parametric' | 'bake' | 'auto'; preserveColor?: boolean }) {
      return rotateModel(opts);
    },
    /** Auto-orient: rotate the model's largest flat face onto the bed and drop it
     *  to the floor. Same write-back modes as placeModel. */
    async layFlatModel(opts?: { mode?: 'parametric' | 'bake' | 'auto'; preserveColor?: boolean }) {
      return layFlatModel(opts);
    },
    /** Mirror (flip) the current model across its own center plane along the
     *  given axis ('x'|'y'|'z'), and save a new version. The triangle winding is
     *  flipped so the result stays watertight. Same write-back modes as placeModel. */
    async mirrorModel(opts?: { axis?: 'x' | 'y' | 'z'; mode?: 'parametric' | 'bake' | 'auto'; preserveColor?: boolean }) {
      return mirrorModel(opts);
    },
    /** True when a transform can be applied as editable parametric code rather
     *  than baked to a mesh (manifold-js model with no manual paint). */
    canPlaceParametric(): boolean { return canPlaceParametric(); },
    /** Run code string and update all views. Returns geometry data object. */
    async run(code?: string, opts?: { preserveCamera?: boolean }): Promise<Record<string, unknown>> {
      assertString(code, 'run(code)', { optional: true, allowEmpty: false });
      const src = code ?? getValue();
      if (code !== undefined) setValue(code);
      // The in-app AI passes preserveCamera so iterating on a model doesn't snap
      // the user's orbit back to default every turn; bare console callers omit it
      // and keep auto-framing (the same-session gate still frames a fresh run).
      const applied = await runCodeSync(src, { preserveCamera: opts?.preserveCamera === true });
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
     *  keys are ignored; a numeric value beyond the declared min/max is honored
     *  as typed (the bounds only size the slider), and only wrong-type values
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
      // Tweaking a parameter re-renders the same model, so keep the user's (or
      // AI's) current camera angle rather than snapping to the default framing —
      // matching the Customizer panel's onChange path (runCode preserves by
      // default). captureCameraToPreserve still auto-frames a session's first run.
      const applied = await runCodeSync(getValue(), { preserveCamera: true });
      if (!applied) return { status: 'error', error: 'Run was superseded by a concurrent execution — retry' };
      const geometry = JSON.parse(geometryDataEl.textContent || '{}');
      return {
        geometry,
        params: currentParamSchema ? resolveParamValues(currentParamSchema, currentParamValues) : {},
      };
    },

    /** Open the Assembly view — show every part of the session laid out in a
     *  non-overlapping grid, built in parallel. Needs ≥ 2 parts. */
    async openAssembly() {
      const st = getState();
      if (!st.session) return { error: 'No session open.' };
      if (st.parts.length < 2) return { error: 'The session has only one part — add another to view all parts together.' };
      await openAssembly();
      return { status: 'ok', ...getAssemblySnapshot() };
    },

    /** Close the Assembly view and return to the single-part editor. */
    closeAssembly() {
      if (!isAssemblyViewOpen()) return { error: 'The Assembly view is not open.' };
      closeAssembly();
      return { status: 'ok' };
    },

    /** Snapshot of the Assembly view: whether it's open, the parts and their
     *  placement, and the union of shared parameters. */
    getAssembly() {
      return getAssemblySnapshot();
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
      warnIfSurfaceStale('GLB');
      await exportGLB(filename, coloredMeshForExport(currentMeshData));
    },

    /** Export current model as STL download. Optional filename override. */
    exportSTL(filename?: string) {
      assertString(filename, 'exportSTL(filename)', { optional: true });
      if (!currentMeshData) return { error: 'No geometry loaded' };
      warnIfSurfaceStale('STL');
      exportSTL(fileExportMesh(false)!, filename);
    },

    /** Export current model as OBJ download. Optional filename override. */
    exportOBJ(filename?: string) {
      assertString(filename, 'exportOBJ(filename)', { optional: true });
      if (!currentMeshData) return { error: 'No geometry loaded' };
      warnIfSurfaceStale('OBJ');
      exportOBJ(fileExportMesh(true)!, filename);
    },

    /** Export current model as 3MF download. Optional filename override. */
    export3MF(filename?: string) {
      assertString(filename, 'export3MF(filename)', { optional: true });
      if (!currentMeshData) return { error: 'No geometry loaded' };
      warnIfSurfaceStale('3MF');
      export3MF(fileExportMesh(true)!, filename);
    },

    /** Open the assisted-publish modal (Printables / MakerWorld / Thingiverse /
     *  Thangs). These sites have no public upload API, so this prepares the
     *  publish — downloads the model file + cover image and copies the
     *  title/description/tags to the clipboard, then opens the upload page —
     *  rather than posting directly. Optional `platform` preselects one site. */
    publish(platform?: string) {
      assertString(platform, 'publish(platform)', { optional: true });
      if (platform != null && !findPublishTarget(platform)) {
        return { error: `Unknown platform "${platform}". Use one of: printables, makerworld, thingiverse, thangs.` };
      }
      if (!currentMeshData) return { error: 'No geometry loaded' };
      void actionPublish(platform);
    },

    /** Bundle several Session Parts into ONE 3MF. With `{ bambu: true }` (the
     *  default) each part lands on its own Bambu Studio / OrcaSlicer build plate
     *  with colours bound to filaments; `{ bambu: false }` emits a generic
     *  multi-object 3MF (grid-arranged, opens in any slicer). The UI equivalents
     *  are the "3MF — Bambu/Orca" menu item and the generic "3MF" export in a
     *  multi-part session. Pass an array of part ids (default: every part); each
     *  part's latest version is baked WITH its colours. `{ ok, filename, parts }`
     *  or `{ error }`. */
    export3MFParts(partIds?: string[], filename?: string, opts?: { bambu?: boolean; printer?: string; nozzle?: string; filament?: string }) {
      return export3MFPartsApi(partIds, filename, opts);
    },

    /** Bytes-returning twin of {@link export3MFParts} — bundles parts into one
     *  3MF and RETURNS `{ filename, mimeType, base64, sizeBytes, parts }` (or
     *  `{ error }`) instead of downloading, so an agent/test can read the
     *  exported file back without the browser download path. `{ bambu }` as in
     *  export3MFParts (default true). */
    export3MFPartsData(partIds?: string[], filename?: string, opts?: { bambu?: boolean; printer?: string; nozzle?: string; filament?: string }) {
      return export3MFPartsDataApi(partIds, filename, opts);
    },

    /** Bundle several Session Parts into ONE OBJ — each part a named `o <part>`
     *  object in one .obj, grid-arranged so they don't overlap; painted parts add a
     *  shared .mtl (OBJ + MTL in a .zip). The UI equivalent is the "OBJ" export in a
     *  multi-part session. Pass an array of part ids (default: every part); each
     *  part's latest version is baked WITH its colours. `{ ok, filename, parts }` or
     *  `{ error }`. */
    exportOBJParts(partIds?: string[], filename?: string) {
      return exportPartsApi('OBJ', baked => buildOBJPartsBlob(baked, filename), partIds, filename);
    },
    /** Bytes-returning twin of {@link exportOBJParts} — RETURNS
     *  `{ filename, mimeType, base64, sizeBytes, parts }` (or `{ error }`). */
    exportOBJPartsData(partIds?: string[], filename?: string) {
      return exportPartsDataApi('OBJ', baked => buildOBJPartsBlob(baked, filename), partIds, filename);
    },

    /** Bundle several Session Parts into ONE STL download — a `.zip` with one `.stl`
     *  per part (STL has no part names or colour, so separate files keep them
     *  distinct). The UI equivalent is the "STL" export in a multi-part session. Pass
     *  an array of part ids (default: every part). `{ ok, filename, parts }` or
     *  `{ error }`. */
    exportSTLParts(partIds?: string[], filename?: string) {
      return exportPartsApi('STL', baked => buildSTLPartsBlob(baked, filename), partIds, filename);
    },
    /** Bytes-returning twin of {@link exportSTLParts}. */
    exportSTLPartsData(partIds?: string[], filename?: string) {
      return exportPartsDataApi('STL', baked => buildSTLPartsBlob(baked, filename), partIds, filename);
    },

    /** Bundle several Session Parts into ONE GLB — each part a named node in one glTF
     *  scene, grid-arranged; painted parts export as vertex colours. The UI
     *  equivalent is the "GLB" export in a multi-part session. Pass an array of part
     *  ids (default: every part). `{ ok, filename, parts }` or `{ error }`. */
    exportGLBParts(partIds?: string[], filename?: string) {
      return exportPartsApi('GLB', baked => buildGLBPartsBlob(baked, filename), partIds, filename);
    },
    /** Bytes-returning twin of {@link exportGLBParts}. */
    exportGLBPartsData(partIds?: string[], filename?: string) {
      return exportPartsDataApi('GLB', baked => buildGLBPartsBlob(baked, filename), partIds, filename);
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
      const warning = surfaceStaleExportWarning('GLB');
      const built = await buildGLB(filename);
      registerExportFromBuilt(built, 'GLB');
      return {
        filename: built.filename,
        mimeType: built.mimeType,
        sizeBytes: built.blob.size,
        base64: await blobToBase64(built.blob),
        ...(warning ? { warning } : {}),
      };
    },

    /** Build an STL and return its bytes as base64. */
    async exportSTLData(filename?: string) {
      assertString(filename, 'exportSTLData(filename)', { optional: true });
      if (!currentMeshData) return { error: 'No geometry loaded' };
      const warning = surfaceStaleExportWarning('STL');
      const built = buildSTL(fileExportMesh(false)!, filename);
      registerExportFromBuilt(built, 'STL');
      return {
        filename: built.filename,
        mimeType: built.mimeType,
        sizeBytes: built.blob.size,
        base64: await blobToBase64(built.blob),
        ...(warning ? { warning } : {}),
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
      const warning = surfaceStaleExportWarning('OBJ');
      const built = buildOBJ(fileExportMesh(true)!, filename);
      registerExportFromBuilt(built, 'OBJ');
      const isText = built.mimeType === 'text/plain';
      return {
        filename: built.filename,
        mimeType: built.mimeType,
        sizeBytes: built.blob.size,
        ...(isText
          ? { text: await built.blob.text() }
          : { base64: await blobToBase64(built.blob) }),
        ...(warning ? { warning } : {}),
      };
    },

    /** Build a 3MF (always a ZIP) and return its bytes as base64. */
    async export3MFData(filename?: string) {
      assertString(filename, 'export3MFData(filename)', { optional: true });
      if (!currentMeshData) return { error: 'No geometry loaded' };
      const warning = surfaceStaleExportWarning('3MF');
      const built = build3MF(fileExportMesh(true)!, filename);
      registerExportFromBuilt(built, '3MF');
      return {
        filename: built.filename,
        mimeType: built.mimeType,
        sizeBytes: built.blob.size,
        base64: await blobToBase64(built.blob),
        ...(warning ? { warning } : {}),
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

    /** Import an STL mesh (binary or ASCII) from base64-encoded bytes as a new
     *  session — the programmatic equivalent of the Import → choose-file flow for
     *  STL (which an agent can't reach: there's no file picker). The mesh is
     *  welded across a tolerance ladder; when it forms a clean manifold it's
     *  imported as an editable manifold-js model, otherwise it lands render-only
     *  (display + export only — no booleans/paint/slicing), reflected by
     *  `isManifold: false` in the return. `base64` may be a bare base64 string or
     *  a `data:` URL. `filename` names the import; `opts.sessionName` overrides
     *  the new session's name. Returns `{ sessionId, isManifold, triangleCount,
     *  vertexCount }` or `{ error }`. */
    async importMeshData(base64: string, filename: string, opts: { sessionName?: string } = {}) {
      const check = guard(() => {
        assertString(base64, 'importMeshData(base64)', { allowEmpty: false });
        assertString(filename, 'importMeshData(filename)', { allowEmpty: false });
        assertObject(opts, 'importMeshData(opts)', { optional: true });
        assertString(opts?.sessionName, 'importMeshData(opts.sessionName)', { optional: true, allowEmpty: false });
      });
      if (typeof check === 'object' && check !== null && 'error' in check) return check;
      let bytes: Uint8Array;
      try {
        const raw = (base64.includes(',') ? base64.slice(base64.indexOf(',') + 1) : base64).replace(/\s/g, '');
        const binary = atob(raw);
        bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      } catch {
        return { error: 'importMeshData(base64): not valid base64-encoded data.' };
      }
      const parsed = parseSTLBytes(bytes, filename);
      if (!parsed) return { error: `Could not parse "${filename}" as an STL file (binary or ASCII).` };
      const sessionName = opts?.sessionName ?? filename.replace(/\.[^.]+$/, '');
      const { sessionId } = await importMeshPayload(parsed.mesh, sessionName, { manifold: parsed.isManifold });
      return {
        sessionId,
        isManifold: parsed.isManifold,
        triangleCount: parsed.mesh.numTri,
        vertexCount: parsed.mesh.numVert,
      };
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

    /** Enable or disable studio lighting (image-based reflections + a mild
     *  contact shadow). On by default. Pass a boolean to set, omit to toggle. */
    setStudioLighting(on?: boolean): boolean {
      assertBoolean(on, 'setStudioLighting(on)', { optional: true });
      setStudioLighting(on ?? !isStudioLighting());
      return isStudioLighting();
    },

    /** Whether studio lighting (reflections + soft shadow) is currently on */
    isStudioLighting(): boolean {
      return isStudioLighting();
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

    /** Reset the camera to the default framing of the current model (same view
     *  applied after a fresh run). */
    resetView(): void {
      resetView();
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

    // === Insert & arrange palette ===
    //
    // Drives the same Tinkercad-style arrange tool you reach from the toolbar.
    // The selection Set, undo stack, and per-engine code rewriters are shared
    // with the panel — calling `partwright.enterArrange()` then
    // `partwright.alignSelection('z','center')` is identical to clicking the
    // toggle, ⇧-clicking parts, and pressing the Z⊣ Align button.

    /** Turn arrange mode on (the persistent click-to-select / drag-to-move
     *  viewport tool). Opens the Insert palette if needed so chip strip and
     *  undo controls are visible. Returns `{ ok: true }` on success. */
    enterArrange(): { ok: boolean; reason?: string } {
      return apiEnterArrange();
    },

    /** Turn arrange mode off and exit the canvas pointer hook. */
    exitArrange(): void { apiExitArrange(); },

    /** Whether arrange mode is currently capturing pointer events. */
    isArrangeActive(): boolean { return apiIsArrangeActive(); },

    /** Replace the arrange-mode selection with the given part names. Names
     *  unknown to the current code are silently dropped; the returned array
     *  lists names that actually stuck. */
    selectParts(names: string[]): string[] {
      assertArray(names, 'selectParts(names)');
      for (let i = 0; i < names.length; i++) assertString(names[i], `selectParts(names[${i}])`);
      return apiSetSelection(names);
    },

    /** Extend the selection — equivalent to ⇧-click on each part. */
    addToSelection(names: string[]): string[] {
      assertArray(names, 'addToSelection(names)');
      for (let i = 0; i < names.length; i++) assertString(names[i], `addToSelection(names[${i}])`);
      return apiAddToSelection(names);
    },

    /** Clear the arrange-mode selection. */
    clearSelection(): void { apiClearSelection(); },

    /** Names the arrange tool is currently treating as the active group. */
    getSelection(): string[] { return apiGetSelection(); },

    /** List the parts arrange mode can currently work with. Returns
     *  `[{ name, box: { min, max }, center }]`. Includes both palette-inserted
     *  parts and hand-written ones the parser was able to resolve. */
    listArrangeParts(): Array<{ name: string; box: { min: [number, number, number]; max: [number, number, number] }; center: [number, number, number] }> {
      return apiListParts();
    },

    /** Step back one palette operation (insert / move / resize / align /
     *  duplicate / delete / mirror / boolean). Returns the label of the
     *  reversed op, or null when nothing to undo. */
    undo(): string | null { return apiUndo(); },

    /** Reapply the most recently undone palette operation. */
    redo(): string | null { return apiRedo(); },

    /** Whether `undo()` would do anything right now. */
    canUndo(): boolean { return apiCanUndo(); },

    /** Whether `redo()` would do anything right now. */
    canRedo(): boolean { return apiCanRedo(); },

    /** Scale every part in the selection. `scale` may be uniform `[s,s,s]`
     *  or anisotropic `[sx, sy, sz]`. Same path as the Size X/Y/Z inputs.
     *  Errors are returned as `{ ok: false, reason }`. */
    resizeSelection(scale: [number, number, number]): { ok: boolean; reason?: string } {
      assertNumberTuple(scale, 3, 'resizeSelection(scale)');
      return apiResizeSelection(scale as [number, number, number]);
    },

    /** Align 2+ selected parts on `axis` ('x' | 'y' | 'z') to `mode`
     *  ('min' | 'center' | 'max'). The reference is the union of the
     *  selection's bboxes (Tinkercad-style). */
    alignSelection(axis: 'x' | 'y' | 'z', mode: 'min' | 'center' | 'max'): { ok: boolean; reason?: string } {
      assertEnum(axis, ['x', 'y', 'z'] as const, 'alignSelection(axis)');
      assertEnum(mode, ['min', 'center', 'max'] as const, 'alignSelection(mode)');
      return apiAlignSelection(axis, mode);
    },

    /** Union the selected parts in code — same as the ∪ Group button. Voxel
     *  grids union implicitly so the call is rejected there. */
    groupSelection(): { ok: boolean; reason?: string } { return apiGroupSelection(); },

    /** Subtract every later operand from the first selected part. */
    subtractSelection(): { ok: boolean; reason?: string } { return apiSubtractSelection(); },

    /** Intersect every selected part. */
    intersectSelection(): { ok: boolean; reason?: string } { return apiIntersectSelection(); },

    /** Remove every selected part from the code. */
    deleteSelection(): { ok: boolean; reason?: string } { return apiDeleteSelection(); },

    /** Clone every selected part, offset along +X. New parts replace the
     *  selection so a follow-up call (resize / align / move) operates on the
     *  copies. */
    duplicateSelection(): { ok: boolean; reason?: string } { return apiDuplicateSelection(); },

    /** Mirror every selected part in place across the given axis. */
    mirrorSelection(axis: 'x' | 'y' | 'z'): { ok: boolean; reason?: string } {
      assertEnum(axis, ['x', 'y', 'z'] as const, 'mirrorSelection(axis)');
      return apiMirrorSelection(axis);
    },

    /** Toggle the "Auto-combine new shapes" checkbox programmatically. When
     *  on (default), each inserted shape folds into the managed-return
     *  engine's visible union so it appears immediately; when off, the part
     *  is added to the code + registered for arrange/pick but not unioned
     *  until you call `groupSelection`. Only meaningful for manifold-js /
     *  replicad — voxel + scad union implicitly. */
    setAutoCombine(on: boolean): void {
      assertBoolean(on, 'setAutoCombine(on)');
      apiSetAutoCombine(on);
    },

    /** Read the current Auto-combine flag. */
    getAutoCombine(): boolean { return apiGetAutoCombine(); },

    /** Toggle "Snap drag to whole units" — when on, arrange-mode drag
     *  commits and the per-engine writeback paths round to whole units.
     *  Voxel grids already snap; this gives the JS/SCAD/BREP engines an
     *  opt-in "tidy lattice" mode. */
    setSnapToGrid(on: boolean): void {
      assertBoolean(on, 'setSnapToGrid(on)');
      apiSetSnapToGrid(on);
    },

    /** Read the current snap-to-grid flag. */
    getSnapToGrid(): boolean { return apiGetSnapToGrid(); },

    /** Rotate the current selection in place (degrees, per-axis). For 2+
     *  selected parts, the rotation pivots around the group centroid in the
     *  XY plane. Voxel sessions are rejected (lattice quantization). */
    rotateSelection(deg: [number, number, number]): { ok: boolean; reason?: string } {
      assertNumberTuple(deg, 3, 'rotateSelection(deg)');
      return apiRotateSelection(deg as [number, number, number]);
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

    /** Pin the thumbnail camera angle for the active session so captured
     *  thumbnails (catalog tile, gallery, version snapshots) render from this
     *  azimuth / elevation (degrees) instead of the default iso 3/4 view (the
     *  default is azimuth 45°, elevation 35°). The pin persists on the session
     *  and survives reload / export, so a faced model can present its front in
     *  the tile without baking orientation into the geometry.
     *
     *  - `setThumbnailCamera({ azimuth, elevation })` — pin an explicit angle.
     *    Azimuth: 0 = front (-Y), 90 = right (+X), 180 = back (+Y), 270 = left.
     *    Elevation: 0 = horizon, 90 = top-down.
     *  - `setThumbnailCamera('current')` — pin the angle you're currently
     *    looking at in the viewport (orbit to a nice 3/4 view, then call this —
     *    no guessing numbers). The live viewport's azimuth convention is
     *    mirrored from the thumbnail camera's, so this converts it for you.
     *  - `setThumbnailCamera(null)` — clear the pin, back to the default.
     *
     *  Returns the resolved camera (or null when cleared), or `{ error }`. */
    async setThumbnailCamera(camera: { azimuth: number; elevation: number } | 'current' | null) {
      let resolved: { azimuth: number; elevation: number } | null;
      if (camera === 'current') {
        // Viewport azimuth (getCameraState) and the thumbnail camera
        // (buildViewCamera) now use the same convention — atan2(dx, −dy), with
        // azimuth 0 = front (−Y) — so the live viewport angle maps straight
        // through to the pinned thumbnail camera with no mirror.
        const cs = getCameraState();
        resolved = { azimuth: ((cs.azimuth % 360) + 360) % 360, elevation: cs.elevation };
      } else if (camera === null) {
        resolved = null;
      } else {
        const check = guard(() => {
          const o = assertObject(camera, 'setThumbnailCamera(camera)')!;
          assertNoUnknownKeys(o, ['azimuth', 'elevation'], 'setThumbnailCamera(camera)');
          assertNumber(o.azimuth, 'setThumbnailCamera(camera).azimuth');
          assertNumber(o.elevation, 'setThumbnailCamera(camera).elevation', { min: -90, max: 90 });
          return true;
        });
        if (typeof check === 'object' && check !== null && 'error' in check) return check;
        resolved = camera;
      }
      if (!getState().session) return { error: 'No active session. Call createSession() or openSession() first.' };
      await setSessionThumbCamera(resolved);
      return { thumbCamera: getState().session?.thumbCamera ?? null };
    },

    /** The active session's pinned thumbnail camera `{ azimuth, elevation }`, or
     *  null when unpinned (the default iso view is used for thumbnails). */
    getThumbnailCamera(): { azimuth: number; elevation: number } | null {
      return getState().session?.thumbCamera ?? null;
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
      const argCheck = guard(() => {
        const mode = (args as { mode?: unknown }).mode;
        if (mode !== undefined) assertEnum(mode, ['luminance', 'quantized', 'ai'], 'importImageAsRelief(mode)');
        validateReliefOptionArgs(args, 'importImageAsRelief');
        return true;
      });
      if (typeof argCheck === 'object' && argCheck !== null && 'error' in argCheck) return argCheck;
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
      const argCheck = guard(() => {
        validateReliefOptionArgs(args, 'importSvgAsRelief');
        return true;
      });
      if (typeof argCheck === 'object' && argCheck !== null && 'error' in argCheck) return argCheck;
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
      const items: SessionAttachment[] = [];
      for (let i = 0; i < arr.length; i++) {
        const item = assertObject(arr[i], `setImages(images)[${i}]`)!;
        assertNoUnknownKeys(item, ['src', 'id', 'label'] as const, `setImages(images)[${i}]`);
        assertString(item.src, `setImages(images)[${i}].src`, { allowEmpty: false });
        if (item.id !== undefined) assertString(item.id, `setImages(images)[${i}].id`, { allowEmpty: false });
        if (item.label !== undefined) assertString(item.label, `setImages(images)[${i}].label`, { optional: true, allowEmpty: true });
        items.push(normalizeAttachment({
          id: item.id as string | undefined,
          src: item.src as string,
          label: item.label as string | undefined,
          kind: 'image',
          addedAt: Date.now(),
          source: 'user',
        }, generateId()));
      }
      // Replace the image-kind attachments, preserving any non-image ones
      // (models, docs) the user/AI may have pinned.
      const nonImages = _getAttachments().filter(a => a.kind !== 'image');
      commitAttachments([...items, ...nonImages]);
      return items;
    },

    /** Append a single image. Returns the appended item with its assigned id. */
    addImage(image: { src: string; label?: string }): AttachedImage {
      const obj = assertObject(image, 'addImage(image)')!;
      assertNoUnknownKeys(obj, ['src', 'label'] as const, 'addImage(image)');
      assertString(obj.src, 'addImage(image).src', { allowEmpty: false });
      if (obj.label !== undefined) assertString(obj.label, 'addImage(image).label', { optional: true, allowEmpty: true });
      const item = normalizeAttachment({
        src: obj.src as string,
        label: obj.label as string | undefined,
        kind: 'image',
        addedAt: Date.now(),
        source: 'user',
      }, generateId());
      commitAttachments([..._getAttachments(), item]);
      return item;
    },

    /** Remove an image (or any attachment) by id. Returns true if one was removed. */
    removeImage(id: string): boolean {
      assertString(id, 'removeImage(id)', { allowEmpty: false });
      const current = _getAttachments();
      const next = current.filter(a => a.id !== id);
      if (next.length === current.length) return false;
      commitAttachments(next);
      return true;
    },

    /** Clear the image attachments (non-image attachments are preserved). */
    clearImages(): void {
      const nonImages = _getAttachments().filter(a => a.kind !== 'image');
      commitAttachments(nonImages);
    },

    /** Get the image-kind attachments as `{id, src, label}`. */
    getImages(): AttachedImage[] {
      return _getImageAttachments();
    },

    // === Attachments (generalization of reference images) ===

    /** Replace the whole attachment list. Each item: `{src, kind?, mediaType?, id?, label?}`
     *  — `kind`/`mediaType` are inferred from the src/label when omitted. */
    setAttachments(attachments: Array<{ src: string; id?: string; label?: string; kind?: AttachmentKind; mediaType?: string }>): SessionAttachment[] {
      const arr = assertArray(attachments, 'setAttachments(attachments)') as Array<Record<string, unknown>>;
      const items: SessionAttachment[] = [];
      for (let i = 0; i < arr.length; i++) {
        items.push(buildAttachmentFromInput(arr[i], `setAttachments(attachments)[${i}]`));
      }
      commitAttachments(items);
      return items;
    },

    /** Append one attachment. `{src, kind?, mediaType?, label?}` — kind/mediaType
     *  inferred when omitted. Returns the stored item with its assigned id. */
    addAttachment(attachment: { src: string; label?: string; kind?: AttachmentKind; mediaType?: string }): SessionAttachment {
      const obj = assertObject(attachment, 'addAttachment(attachment)')!;
      const item = buildAttachmentFromInput(obj, 'addAttachment(attachment)', 'user');
      commitAttachments([..._getAttachments(), item]);
      return item;
    },

    /** Remove an attachment by id. Returns true if one was removed. */
    removeAttachment(id: string): boolean {
      assertString(id, 'removeAttachment(id)', { allowEmpty: false });
      const current = _getAttachments();
      const next = current.filter(a => a.id !== id);
      if (next.length === current.length) return false;
      commitAttachments(next);
      return true;
    },

    /** Clear ALL attachments (images and non-images). */
    clearAttachments(): void {
      commitAttachments([]);
    },

    /** Get all attachments: `{id, kind, mediaType?, src, label?, addedAt?, source?}`. */
    getAttachments(): SessionAttachment[] {
      return _getAttachments();
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
        await runCodeSync(version.code, { preserveCamera: true });
      }
      // Attachments are session-level — restore regardless of whether a version loaded.
      await restoreAttachmentsForActiveSession();
      return version ? { id: version.id, index: version.index, label: version.label } : null;
    },

    /** Close the current session */
    async closeSession() {
      await closeSession();
      // Forget the framed session so re-opening it (or any session) auto-frames
      // its model rather than preserving the angle from before it was closed —
      // matches the "opening a session always frames" contract.
      lastFramedSessionId = null;
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

    /** Open the parts-overview modal (a thumbnail contact-sheet of every
     *  part; click a tile to switch). Same view as the part rail's grid
     *  button. Returns { error } when there is no session or no parts. */
    showPartsOverview() {
      const opened = openPartsOverview((id) => { void selectPart(id); });
      return opened ? { ok: true } : { error: 'showPartsOverview: no session with parts is open' };
    },

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

    /** Switch the active part. Pass a part name, id string, or 0-based index —
     *  or { id } / { name } from listParts(). Loads that part's latest version
     *  into the editor. */
    async changePart(target: string | number | { id?: string; name?: string }) {
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

    /** Rename a part. Pass a part name, id string, 0-based index, or { id } / { name }. */
    async renamePart(target: string | number | { id?: string; name?: string }, newName: string) {
      const check = guard(() => assertString(newName, 'renamePart(newName)', { allowEmpty: false }));
      if (typeof check === 'object' && check !== null && 'error' in check) return check;
      const part = resolvePartTarget(target, 'renamePart');
      if ('error' in part) return part;
      await renamePart(part.id, newName);
      return { id: part.id, name: newName };
    },

    /** Delete a part and its versions. Refuses to delete a session's last part.
     *  Deleting the active part activates and loads an adjacent one. Pass a part
     *  name, id string, 0-based index, or { id } / { name }. */
    async deletePart(target: string | number | { id?: string; name?: string }) {
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

    /** Save every part in the active session that has unsaved changes, in one
     *  call — the non-interactive twin of the 💾 button's multi-part save
     *  modal. Each part is loaded, saved, and the originally-active part is
     *  restored. Returns how many parts were saved (and how many failed). */
    async saveAllParts() {
      if (!getState().session) {
        return { error: 'No active session. Call createSession() or openSession(id) first.' };
      }
      const unsaved = await gatherUnsavedParts();
      if (unsaved.length === 0) return { saved: 0, failed: 0 };
      return saveSelectedParts(unsaved.map(p => p.id));
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

    /** Rename a version's display label (its index is immutable). Pass { index }
     *  or { id } from listVersions(), plus the new label. Returns the updated
     *  { id, index, label }, or { error } if the version isn't in this session. */
    async renameVersion(target: { index?: number; id?: string }, label: string) {
      const parsed = parseVersionTarget(target, 'renameVersion');
      if ('error' in parsed) return parsed;
      const check = guard(() => assertString(label, 'renameVersion(label)', { allowEmpty: false }));
      if (typeof check === 'object' && check !== null && 'error' in check) return check;
      if (!getState().session) return { error: 'No active session. Call openSession(id) or createSession() first.' };
      const version = await peekVersion(parsed.value);
      if (!version) return { error: `No version found with ${parsed.kind} "${parsed.value}" in the active session. Use listVersions() to see valid ${parsed.kind}s.` };
      const updated = await renameVersionInStore(version.id, label);
      if (!updated) return { error: `Could not rename version "${parsed.value}".` };
      return { ok: true, id: updated.id, index: updated.index, label: updated.label };
    },

    /** Delete a version from the active session. Pass { index } or { id }. Refuses
     *  to remove the last remaining version. When the active version is deleted,
     *  the nearest earlier version becomes active and is re-rendered. Returns
     *  { ok, deleted, newCurrent } or { error }. */
    async deleteVersion(target: { index?: number; id?: string }) {
      const parsed = parseVersionTarget(target, 'deleteVersion');
      if ('error' in parsed) return parsed;
      if (!getState().session) return { error: 'No active session. Call openSession(id) or createSession() first.' };
      const version = await peekVersion(parsed.value);
      if (!version) return { error: `No version found with ${parsed.kind} "${parsed.value}" in the active session. Use listVersions() to see valid ${parsed.kind}s.` };
      const result = await deleteVersionFromStore(version.id);
      if (!result) return { error: 'Could not delete — a session must keep at least one version.' };
      // If the active version changed, re-render the replacement so the viewport
      // and editor reflect the new state (mirrors loadVersion's language/colour/
      // annotation restore).
      if (result.wasCurrent && result.newCurrent) {
        const nv = result.newCurrent;
        const versionLang = effectiveVersionLanguage(nv, getState().session);
        if (versionLang !== getActiveLanguage()) await switchLanguage(versionLang);
        setValue(nv.code);
        currentParamValues = { ...(nv.paramValues ?? {}) };
        await runCodeSync(nv.code, { preserveCamera: true });
        await rehydrateColorRegions(nv.geometryData);
        applyVersionAnnotations(nv);
      }
      return {
        ok: true,
        deleted: { id: result.deleted.id, index: result.deleted.index, label: result.deleted.label },
        newCurrent: result.newCurrent ? { id: result.newCurrent.id, index: result.newCurrent.index, label: result.newCurrent.label } : null,
      };
    },

    /** Compare two versions' code and geometry stats — the programmatic form of
     *  the Diff tab. Pass two targets (each { index } or { id }) from
     *  listVersions(). Returns each version's code + a per-field stat delta, or
     *  { error } if either version isn't found. */
    async diffVersions(a: { index?: number; id?: string }, b: { index?: number; id?: string }) {
      const pa = parseVersionTarget(a, 'diffVersions');
      if ('error' in pa) return pa;
      const pb = parseVersionTarget(b, 'diffVersions');
      if ('error' in pb) return pb;
      if (!getState().session) return { error: 'No active session. Call openSession(id) or createSession() first.' };
      const va = await peekVersion(pa.value);
      if (!va) return { error: `No version found with ${pa.kind} "${pa.value}" in the active session.` };
      const vb = await peekVersion(pb.value);
      if (!vb) return { error: `No version found with ${pb.kind} "${pb.value}" in the active session.` };
      const statDiff = computeStatDiff(
        (va.geometryData ?? {}) as Record<string, unknown>,
        (vb.geometryData ?? {}) as Record<string, unknown>,
      );
      return {
        a: { id: va.id, index: va.index, label: va.label, code: va.code },
        b: { id: vb.id, index: vb.index, label: vb.label, code: vb.code },
        codeChanged: va.code !== vb.code,
        statDiff,
      };
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
      await runCodeSync(version.code, { preserveCamera: true });
      await rehydrateColorRegions(version.geometryData);
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
        await runCodeSync(version.code, { preserveCamera: true });
        await rehydrateColorRegions(version.geometryData);
        applyVersionAnnotations(version);
      }
      return version ? { id: version.id, index: version.index, label: version.label } : null;
    },

    /** Run code and save as a new version in one call. Returns stat diff vs previous version.
     *  Optional assertions — if provided, validates after running. Saves only if assertions pass.
     *  The editor and viewport always update to reflect the new code (including on assertion failure),
     *  so the model can inspect the failing geometry. The version is NOT saved on failure. */
    async runAndSave(code: string, label?: string, assertions?: GeometryAssertions, opts?: { preserveCamera?: boolean }) {
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
      // preserveCamera (set by the AI tool path) keeps the user's orbit across
      // AI iterations; bare console callers omit it and auto-frame.
      setValue(code);
      const applied = await runCodeSync(code, { preserveCamera: opts?.preserveCamera === true });
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
      const version = await saveVersion(code, enrichGeometryDataWithColors(getGeometryDataObj()), thumbnail, label, assertions?.notes, { paramValues: currentParamValues, companionFiles: getCompanionFiles(), surfaceTexture: currentSurfaceTextureForSave() });

      let diff = null;
      if (prevGeoData && prevGeoData.status === 'ok' && newGeoData.status === 'ok') {
        diff = computeStatDiff(prevGeoData, newGeoData);
      }

      const warnings = geometryWarnings(newGeoData);
      const lostLabels = currentLostLabels && currentLostLabels.length > 0
        ? [...currentLostLabels]
        : undefined;
      const printability = computePrintability(newGeoData);
      const colorRegions = colorRegionStats();
      return {
        ...(assertions ? { passed: true } : {}),
        geometry: newGeoData,
        printability,
        version: version ? { id: version.id, index: version.index, label: version.label } : null,
        diff,
        galleryUrl: getGalleryUrl(),
        ...(warnings.length > 0 ? { warnings } : {}),
        ...(lostLabels ? { lostLabels } : {}),
        ...(colorRegions.length > 0 ? { colorRegions } : {}),
      };
    },

    /** Generate a posed, painted human figure from a Character Creator spec and
     *  run it. With `{ save: true }` it commits a new version (via runAndSave);
     *  otherwise it just updates the editor + viewport for a live preview. The
     *  generated code embeds the spec as a `// @character` header so the panel
     *  (and a re-opened session) can restore every control. `spec` is the plain
     *  object the panel edits — see src/figure/characterSpec.ts; unknown/missing
     *  fields fall back to the defaults. */
    async buildCharacter(spec: unknown, opts?: { save?: boolean; label?: string }) {
      if (!spec || typeof spec !== 'object') {
        return { error: 'buildCharacter(spec): spec must be a Character Creator spec object. See src/figure/characterSpec.ts / public/ai/figure.md.' };
      }
      const code = specToCode(normalizeSpec(spec));
      if (opts?.save) {
        const r = await partwrightAPI.runAndSave(code, opts.label ?? 'Character');
        return { code, ...(r as Record<string, unknown>) };
      }
      // Live preview: swap the editor buffer and re-render without saving.
      // Cancel any in-flight render first — a heavy SDF figure build runs in the
      // geometry Worker, and without this a rapid preset/slider change would
      // start a second build while the first keeps churning (they contend and
      // stack, so the preview lags badly). Terminating the prior build mirrors
      // what the interactive runCode path does for superseding auto-runs.
      if (_running) cancelCurrentExecution();
      setValue(code);
      await runCodeSync(code);
      return { code };
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
      const forkApplied = await runCodeSync(newCode, { preserveCamera: true });
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
        colorReport = await rehydrateColorRegions({ colorRegions: parentColors });
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
      const version = await saveVersion(newCode, enrichGeometryDataWithColors(getGeometryDataObj()), thumbnail, label, assertions?.notes, { paramValues: currentParamValues, companionFiles: getCompanionFiles(), surfaceTexture: currentSurfaceTextureForSave() });

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
      const report = await rehydrateColorRegions({ colorRegions: regions });
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
        await runCodeSync(version.code, { preserveCamera: true });
      }
      // Restore attachments from imported session (session-level).
      await restoreAttachmentsForActiveSession();
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

    // === Print tools: build volume, printability, scale, split ===

    /** Read the current printer / build-volume settings. */
    getPrinterSettings(): PrinterSettings {
      return loadPrinterSettings();
    },

    /** Update printer / build-volume settings. Accepts any subset of
     *  {bed:[x,y,z], nozzleWidth, overhangAngleDeg, clearance}. Returns the
     *  merged settings. */
    setPrinterSettings(settings: Partial<PrinterSettings>) {
      const check = guard(() => {
        const o = assertObject(settings, 'setPrinterSettings(settings)')!;
        assertNoUnknownKeys(o, ['bed', 'nozzleWidth', 'overhangAngleDeg', 'clearance'], 'setPrinterSettings(settings)');
        if (o.bed !== undefined) assertNumberTuple(o.bed, 3, 'setPrinterSettings(settings).bed');
        assertNumber(o.nozzleWidth, 'setPrinterSettings(settings).nozzleWidth', { optional: true, min: 0.05 });
        assertNumber(o.overhangAngleDeg, 'setPrinterSettings(settings).overhangAngleDeg', { optional: true, min: 1, max: 89 });
        assertNumber(o.clearance, 'setPrinterSettings(settings).clearance', { optional: true, min: 0 });
        return true;
      });
      if (typeof check === 'object' && check !== null && 'error' in check) return check;
      return savePrinterSettings(settings);
    },

    /** Analyze the current model for printability: bed fit, overhangs, thin
     *  walls (sampled estimate), small features, tip-over stability, and
     *  watertightness. Returns a structured report with per-check pass/warn/fail
     *  levels. Optional overrides for {bed, nozzleWidth, overhangAngleDeg};
     *  defaults come from the printer settings. */
    checkPrintability(opts?: { bed?: [number, number, number]; nozzleWidth?: number; overhangAngleDeg?: number }) {
      const check = guard(() => {
        if (opts !== undefined) {
          const o = assertObject(opts, 'checkPrintability(opts)')!;
          assertNoUnknownKeys(o, ['bed', 'nozzleWidth', 'overhangAngleDeg'], 'checkPrintability(opts)');
          if (o.bed !== undefined) assertNumberTuple(o.bed, 3, 'checkPrintability(opts).bed');
          assertNumber(o.nozzleWidth, 'checkPrintability(opts).nozzleWidth', { optional: true, min: 0.05 });
          assertNumber(o.overhangAngleDeg, 'checkPrintability(opts).overhangAngleDeg', { optional: true, min: 1, max: 89 });
        }
        return true;
      });
      if (typeof check === 'object' && check !== null && 'error' in check) return check;
      if (!currentMeshData) return { error: 'No geometry loaded — run code first.' };
      const settings = loadPrinterSettings();
      const stats = JSON.parse(geometryDataEl.textContent || '{}');
      return analyzePrintability(currentMeshData, {
        bed: opts?.bed ?? settings.bed,
        nozzleWidth: opts?.nozzleWidth ?? settings.nozzleWidth,
        overhangAngleDeg: opts?.overhangAngleDeg ?? settings.overhangAngleDeg,
        isManifold: stats.isManifold === true,
        renderOnly: stats.manifoldStatus === 'render-only (not manifold)',
      });
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
      if (triangles.size === 0) return { error: 'No triangles found inside the slab. Dry-run paintPreview({ slab: { axis|normal, offset, thickness } }) to check the offset/thickness against the model bbox first.' };

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
      /** World axis the shell runs along (default 'z'). Mirrors `paintSlab`'s
       *  axis shorthand: 'x' measures radius in YZ with the band along X, 'y'
       *  in ZX along Y, 'z' (default) in XY along Z. `center` is the [a,b] pair
       *  in the radial plane and zMin/zMax are the band along the chosen axis. */
      axis?: CylinderAxis;
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
      if (opts.axis !== undefined && opts.axis !== 'x' && opts.axis !== 'y' && opts.axis !== 'z') return { error: "paintInCylinder axis must be 'x', 'y', or 'z'" };
      if (!Array.isArray(opts.color) || opts.color.length !== 3) return { error: 'color must be [r,g,b] in 0..1' };
      const cone = resolvePaintCone(opts.normalCone, opts.topOnly);
      const coneErr = validateNormalCone(cone);
      if (coneErr) return { error: coneErr };
      const areaErr = validateMaxTriangleArea(opts.maxTriangleArea);
      if (areaErr) return { error: areaErr };
      const smoothErr = validateSmoothParams(opts);
      if (smoothErr) return { error: smoothErr };

      const center = opts.center ?? [0, 0];
      const axis = opts.axis ?? 'z';
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
        axis,
      );
      if (triangles.size === 0) {
        return { error: `paintInCylinder: no triangles in cylindrical shell (axis=${axis}, rMin=${opts.rMin}, rMax=${opts.rMax}, band=${opts.zMin}..${opts.zMax})${cone ? ' with normalCone filter' : ''}. Try widening the shell, checking the center, or dry-running paintPreview({ cylinder: { rMin, rMax, zMin, zMax } }) to locate the geometry.` };
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
          ...(axis !== 'z' ? { axis } : {}),
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
      return { id: region.id, name: region.name, triangles: region.triangles.size, axis, smooth, maxEdge };
    },

    /** Render a preview of the current model with a candidate region tinted
     *  bright yellow, *without* committing the paint to the regions list.
     *  Accepts the same selectors as `paintInBox` / `paintNear` /
     *  `paintInCylinder` / `paintSlab` plus an optional explicit `triangleIds`
     *  set. Returns `{ thumbnail, triangleCount, bbox, centroid }` so an agent
     *  can verify the shape of the would-be region in one call instead of
     *  paint → render → undo. The `cylinder` / `slab` forms preview the
     *  *unsmoothed* selection (preview never subdivides), which is the cheap
     *  way to validate a radial-shell or slab selection before committing the
     *  real smoothing paint.
     *
     *  ```
     *  const preview = partwright.paintPreview({
     *    box: { min: [...], max: [...] },
     *    normalCone: { axis: [...], angleDeg: 25 },
     *  })
     *  // Or a radial shell — the inner wall of a mug:
     *  partwright.paintPreview({ cylinder: { rMin: 18, rMax: 22, zMin: 2, zMax: 88 } })
     *  // Display preview.thumbnail (data URL) to confirm before committing.
     *  ```
     *  `view` is forwarded to `renderView` (elevation/azimuth/ortho/size). */
    paintPreview(opts: {
      box?: { min: [number, number, number]; max: [number, number, number] };
      cylinder?: { center?: [number, number]; rMin: number; rMax: number; zMin: number; zMax: number; axis?: CylinderAxis };
      slab?: { axis?: 'x' | 'y' | 'z'; normal?: [number, number, number]; offset: number; thickness: number };
      normalCone?: { axis: [number, number, number]; angleDeg: number };
      /** Cylinder selector only — mirrors `paintInCylinder.topOnly`. Keeps just
       *  the outward-radial faces so the dry-run matches what a
       *  `paintInCylinder({ topOnly: true })` commit would actually paint. */
      topOnly?: boolean;
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
      } else if (opts.cylinder !== undefined) {
        const c = opts.cylinder;
        if (typeof c !== 'object' || c === null) return { error: 'cylinder must be { rMin, rMax, zMin, zMax, center? }' };
        if (typeof c.rMin !== 'number' || typeof c.rMax !== 'number') return { error: 'cylinder.rMin and cylinder.rMax must be numbers' };
        if (typeof c.zMin !== 'number' || typeof c.zMax !== 'number') return { error: 'cylinder.zMin and cylinder.zMax must be numbers' };
        if (c.rMin < 0 || c.rMax <= c.rMin) return { error: 'cylinder requires rMin >= 0 and rMax > rMin' };
        if (c.zMax <= c.zMin) return { error: 'cylinder requires zMax > zMin' };
        if (c.center !== undefined && (!Array.isArray(c.center) || c.center.length !== 2)) return { error: 'cylinder.center must be [x, y]' };
        if (c.axis !== undefined && c.axis !== 'x' && c.axis !== 'y' && c.axis !== 'z') return { error: "cylinder.axis must be 'x', 'y', or 'z'" };
        // Resolve topOnly into a cone the same way paintInCylinder does, so the
        // preview's selection matches a topOnly commit instead of over-reporting.
        const cone = resolvePaintCone(opts.normalCone, opts.topOnly);
        const coneErr = validateNormalCone(cone);
        if (coneErr) return { error: coneErr };
        triangles = collectTrianglesByCylinder(mesh, c.center ?? [0, 0], c.rMin, c.rMax, c.zMin, c.zMax, cone, opts.coverageMode, opts.maxTriangleArea, c.axis ?? 'z');
      } else if (opts.slab !== undefined) {
        const s = opts.slab;
        if (typeof s !== 'object' || s === null) return { error: 'slab must be { axis|normal, offset, thickness }' };
        let slabNormal: [number, number, number];
        if (s.axis !== undefined) {
          if (s.axis !== 'x' && s.axis !== 'y' && s.axis !== 'z') return { error: "slab.axis must be 'x', 'y', or 'z'" };
          slabNormal = s.axis === 'x' ? [1, 0, 0] : s.axis === 'y' ? [0, 1, 0] : [0, 0, 1];
        } else if (Array.isArray(s.normal) && s.normal.length === 3) {
          const [nx, ny, nz] = s.normal;
          const len = Math.hypot(nx, ny, nz);
          if (!Number.isFinite(len) || len === 0) return { error: 'slab.normal must be a non-zero 3-vector' };
          slabNormal = [nx / len, ny / len, nz / len];
        } else {
          return { error: 'slab requires either axis (x|y|z) or normal [nx,ny,nz]' };
        }
        if (typeof s.offset !== 'number' || !Number.isFinite(s.offset)) return { error: 'slab.offset must be a finite number' };
        if (typeof s.thickness !== 'number' || !Number.isFinite(s.thickness) || s.thickness <= 0) return { error: 'slab.thickness must be a positive finite number' };
        triangles = findSlabTriangles(mesh, slabNormal, s.offset, s.thickness, opts.coverageMode);
        if (opts.maxTriangleArea !== undefined && triangles.size > 0) {
          triangles = new Set([...triangles].filter(t => triangleArea(t, mesh) <= opts.maxTriangleArea!));
        }
      } else {
        return { error: 'paintPreview requires one of: { triangleIds }, { point, radius }, { box }, { cylinder }, or { slab }' };
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

    /** Recolor every paint region whose color matches `from` (within
     *  `tolerance`) to `to` — the programmatic Replace-color tool. Colors are
     *  [r,g,b] in 0..1 (the range paintFaces/paintRegion use). `tolerance`
     *  defaults to 0.01. Returns `{ replaced: count }`. Only rewrites USER
     *  paint regions — colors declared in code (`api.paint.*` /
     *  `api.label({color})`) are derived from the source, so change those by
     *  editing the color argument in the code and re-running; when nothing
     *  matched but code-declared colors exist, the result carries a `hint`
     *  saying so. */
    replaceColor(opts: { from: [number, number, number]; to: [number, number, number]; tolerance?: number }) {
      const check = guard(() => {
        assertObject(opts, 'replaceColor(opts)');
        const from = assertNumberTuple(opts?.from, 3, 'replaceColor(opts.from)');
        from.forEach((n, i) => assertNumber(n, `replaceColor(opts.from[${i}])`, { min: 0, max: 1 }));
        const to = assertNumberTuple(opts?.to, 3, 'replaceColor(opts.to)');
        to.forEach((n, i) => assertNumber(n, `replaceColor(opts.to[${i}])`, { min: 0, max: 1 }));
        if (opts?.tolerance !== undefined) assertNumber(opts.tolerance, 'replaceColor(opts.tolerance)', { min: 0 });
      });
      if (typeof check === 'object' && check !== null && 'error' in check) return check;
      const count = replaceRegionColors(opts.from, opts.to, opts.tolerance ?? 0.01);
      if (count > 0) scheduleColorRefresh();
      if (count === 0 && hasModelColorRegions()) {
        return {
          replaced: 0,
          hint: 'No user paint regions matched. This model\'s colors are declared in code (api.paint.* / api.label({color})) — replaceColor only rewrites user paint regions. Edit the color argument in the code and re-run instead.',
        };
      }
      return { replaced: count };
    },

    /** Stamp a raster image onto the model surface as paint — the programmatic
     *  Image-paint tool, the right way to put a logo / graphic / text / decal on
     *  a surface (a shirt graphic, a label, face/skin detail). `imageUrl` is a
     *  `data:` URL or a same-origin URL.
     *
     *  PLACEMENT (two ways):
     *   - Easiest: pass `view` ('front'|'back'|'left'|'right'|'top'|'bottom') and
     *     the decal is projected flat along that axis onto the surface facing it,
     *     auto-anchored at the model centre. Add `label` to centre (and, when
     *     `size` is omitted, auto-size) the projection on an `api.label` region.
     *   - Precise: pass explicit `at` (stamp centre on the surface, world coords)
     *     and `normal` (outward face direction there) — from probeRay / probePixel
     *     / a face centroid.
     *
     *  `size` is the decal width in world units (auto-derived from `label` when
     *  omitted). `rotationDeg` twists the image around the projection axis.
     *  `detail` (default 96) is triangle rows across the stamp — higher = crisper
     *  (0 = flat stamp on the existing tessellation). `removeBackground` (default
     *  true) drops the image's background so only the subject paints. Only
     *  forward-facing triangles inside the footprint are painted; a depth slab
     *  stops it bleeding through thin walls. Returns `{ ok, name, triangles,
     *  avgColor }` or `{ error }`. Call saveVersion() afterwards to persist. */
    async paintImage(opts: { imageUrl: string; view?: StampView; label?: string; at?: [number, number, number]; normal?: [number, number, number]; size?: number; rotationDeg?: number; detail?: number; removeBackground?: boolean; name?: string }) {
      const check = guard(() => {
        assertObject(opts, 'paintImage(opts)');
        assertString(opts?.imageUrl, 'paintImage(opts.imageUrl)', { allowEmpty: false });
        if (opts?.view !== undefined) {
          assertString(opts.view, 'paintImage(opts.view)', { allowEmpty: false });
          if (!(STAMP_VIEWS as string[]).includes(opts.view)) {
            throw new ValidationError(`paintImage(opts.view) must be one of: ${STAMP_VIEWS.join(', ')}`);
          }
        }
        if (opts?.label !== undefined) assertString(opts.label, 'paintImage(opts.label)', { allowEmpty: false });
        if (opts?.at !== undefined) assertNumberTuple(opts.at, 3, 'paintImage(opts.at)').forEach((n, i) => assertNumber(n, `paintImage(opts.at[${i}])`, {}));
        if (opts?.normal !== undefined) assertNumberTuple(opts.normal, 3, 'paintImage(opts.normal)').forEach((n, i) => assertNumber(n, `paintImage(opts.normal[${i}])`, {}));
        if (opts?.size !== undefined) {
          assertNumber(opts.size, 'paintImage(opts.size)', { min: 0 });
          if (opts.size <= 0) throw new ValidationError('paintImage(opts.size) must be greater than 0');
        }
        if (opts?.rotationDeg !== undefined) assertNumber(opts.rotationDeg, 'paintImage(opts.rotationDeg)', {});
        if (opts?.detail !== undefined) assertNumber(opts.detail, 'paintImage(opts.detail)', { min: 0, integer: true });
        if (opts?.removeBackground !== undefined) assertBoolean(opts.removeBackground, 'paintImage(opts.removeBackground)');
        if (opts?.name !== undefined) assertString(opts.name, 'paintImage(opts.name)', { allowEmpty: false });
      });
      if (typeof check === 'object' && check !== null && 'error' in check) return check;
      if (!currentMeshData) return { error: 'No model loaded — run code first.' };

      // Resolve a label name to its triangle set (used to centre/auto-size the
      // projection). An unknown label is a clear user error, not a silent miss.
      let labelTriangles: Set<number> | null = null;
      if (opts.label) {
        labelTriangles = currentLabelMap?.get(opts.label) ?? null;
        if (!labelTriangles || labelTriangles.size === 0) {
          const known = currentLabelMap ? Array.from(currentLabelMap.keys()) : [];
          return { error: `paintImage: no label "${opts.label}" in the current model.${known.length ? ` Known labels: ${known.join(', ')}.` : ''}` };
        }
      }

      const placement = resolveImageStampPlacement(currentMeshData, {
        view: opts.view,
        at: opts.at,
        normal: opts.normal,
        size: opts.size,
        labelTriangles,
      });
      if ('error' in placement) return placement;

      let imageData: ImageData;
      try {
        imageData = await loadImageDataFromUrl(opts.imageUrl);
      } catch (e) {
        return { error: `paintImage: could not load image — ${e instanceof Error ? e.message : String(e)}` };
      }
      const region = stampImageProgrammatic(imageData, {
        hitPoint: placement.at,
        hitNormal: placement.normal,
        size: placement.size,
        rotationDeg: opts.rotationDeg,
        detail: opts.detail,
        removeBackground: opts.removeBackground,
        name: opts.name,
      });
      if (!region) {
        return { error: 'paintImage: nothing was painted — the stamp footprint was empty. Check that `at` lies on the surface and `normal` faces outward, and that `size` is large enough to cover triangles.' };
      }
      return { ok: true, name: region.name, triangles: region.triangles, avgColor: region.avgColor };
    },

    // --- Filament palette (the print-color slots paint regions map onto) ------

    /** Read the active filament palette — the slots a multi-color model maps onto
     *  a printer's AMS/MMU. Returns `{ id, name, capacity, constrained, slots:
     *  [{id, name, hex, td}] }`. `td` is the slot's transmission distance (used
     *  by the relief optical preview). Paint with palette hex values (via
     *  hexToRgb) so a model's colors land on real, loadable filament slots. */
    getPalette() {
      return {
        id: getActivePaletteId(),
        name: getActivePaletteName(),
        capacity: getPaletteCapacity(),
        constrained: isPaletteConstrained(),
        slots: listFilaments().map(f => ({ id: f.id, name: f.name, hex: f.hex, td: f.td })),
      };
    },

    /** List all saved palettes (spool sets). Returns `[{id, name, active}]`. */
    listPalettes() { return listPalettes(); },

    /** Create a new (empty) palette and return its id. Does not switch to it —
     *  call setActivePalette(id) to make it active. */
    createPalette(name: string) {
      const check = guard(() => assertString(name, 'createPalette(name)', { allowEmpty: false }));
      if (typeof check === 'object' && check !== null && 'error' in check) return check;
      return { id: createPalette(name) };
    },

    /** Switch the active palette by id (from listPalettes()). */
    setActivePalette(id: string) {
      const check = guard(() => assertString(id, 'setActivePalette(id)', { allowEmpty: false }));
      if (typeof check === 'object' && check !== null && 'error' in check) return check;
      if (!listPalettes().some(p => p.id === id)) return { error: `No palette with id "${id}". Use listPalettes() to see valid ids.` };
      setActivePalette(id);
      return { ok: true };
    },

    /** Add a filament slot to the active palette. `hex` is "#rrggbb"; `td`
     *  (transmission distance, default 1) tunes the relief preview. Returns the
     *  new slot `{ id, name, hex, td }`. */
    addFilament(opts: { name: string; hex: string; td?: number }) {
      const check = guard(() => {
        assertObject(opts, 'addFilament(opts)');
        assertString(opts?.name, 'addFilament(opts.name)', { allowEmpty: false });
        assertString(opts?.hex, 'addFilament(opts.hex)', { allowEmpty: false });
        if (!/^#[0-9a-fA-F]{6}$/.test(opts.hex)) throw new ValidationError('addFilament(opts.hex) must be a "#rrggbb" hex color');
        if (opts?.td !== undefined) assertNumber(opts.td, 'addFilament(opts.td)', { min: 0 });
      });
      if (typeof check === 'object' && check !== null && 'error' in check) return check;
      const slot = addFilament({ name: opts.name, hex: opts.hex, td: opts.td ?? 1 });
      return { id: slot.id, name: slot.name, hex: slot.hex, td: slot.td };
    },

    /** Update a filament slot's name/hex/td by id (from getPalette().slots). */
    updateFilament(id: string, patch: { name?: string; hex?: string; td?: number }) {
      const check = guard(() => {
        assertString(id, 'updateFilament(id)', { allowEmpty: false });
        assertObject(patch, 'updateFilament(patch)');
        if (patch?.name !== undefined) assertString(patch.name, 'updateFilament(patch.name)', { allowEmpty: false });
        if (patch?.hex !== undefined) {
          assertString(patch.hex, 'updateFilament(patch.hex)', { allowEmpty: false });
          if (!/^#[0-9a-fA-F]{6}$/.test(patch.hex)) throw new ValidationError('updateFilament(patch.hex) must be a "#rrggbb" hex color');
        }
        if (patch?.td !== undefined) assertNumber(patch.td, 'updateFilament(patch.td)', { min: 0 });
      });
      if (typeof check === 'object' && check !== null && 'error' in check) return check;
      if (!listFilaments().some(f => f.id === id)) return { error: `No filament slot with id "${id}". Use getPalette().slots to see valid ids.` };
      updateFilament(id, patch);
      return { ok: true };
    },

    /** Remove a filament slot from the active palette by id. */
    removeFilament(id: string) {
      const check = guard(() => assertString(id, 'removeFilament(id)', { allowEmpty: false }));
      if (typeof check === 'object' && check !== null && 'error' in check) return check;
      if (!listFilaments().some(f => f.id === id)) return { error: `No filament slot with id "${id}". Use getPalette().slots to see valid ids.` };
      removeFilament(id);
      return { ok: true };
    },

    /** Set how many filament slots the printer can load at once (the AMS/MMU
     *  budget). Regions beyond it are flagged over-budget in the UI. */
    setPaletteCapacity(n: number) {
      const check = guard(() => assertNumber(n, 'setPaletteCapacity(n)', { min: 1, integer: true }));
      if (typeof check === 'object' && check !== null && 'error' in check) return check;
      setPaletteCapacity(n);
      return { ok: true, capacity: getPaletteCapacity() };
    },

    /** Toggle whether paint is constrained to the palette's slots (snap to the
     *  nearest filament) versus free RGB. */
    setPaletteConstrained(on: boolean) {
      const check = guard(() => assertBoolean(on, 'setPaletteConstrained(on)'));
      if (typeof check === 'object' && check !== null && 'error' in check) return check;
      setPaletteConstrained(on);
      return { ok: true, constrained: isPaletteConstrained() };
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

    /** Read or write the geometry-mode bucket tolerance (cosine of the max
     *  allowed bend angle between adjacent faces). Range [-1, 1] where
     *  1 = strict coplanar, -1 = whole connected component.
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
    /** Read or write the color-mode bucket tolerance (normalised Euclidean
     *  RGB distance from the seed). Range [0, 1] where 0 = exact match only
     *  and 1 = fill entire connected component regardless of color.
     *  Returns the previous + new value on set. */
    getBucketColorTolerance() {
      return { tolerance: getPaintBucketColorTolerance() };
    },
    setBucketColorTolerance(tolerance: number) {
      if (typeof tolerance !== 'number' || !Number.isFinite(tolerance)) {
        return { error: 'setBucketColorTolerance(tolerance): tolerance must be a finite number in [0, 1]' };
      }
      const clamped = Math.max(0, Math.min(1, tolerance));
      const previous = getPaintBucketColorTolerance();
      setPaintBucketColorTolerance(clamped);
      return { previous, tolerance: clamped };
    },
    /** Read or write which flood-fill strategy the bucket tool uses:
     *  'color' (magic-wand by RGB similarity) or 'geometry' (coplanar faces
     *  by bend angle). */
    getBucketMode() {
      return { mode: getPaintBucketMode() };
    },
    setBucketMode(mode: string) {
      if (mode !== 'color' && mode !== 'geometry') {
        return { error: "setBucketMode(mode): mode must be 'color' or 'geometry'" };
      }
      const previous = getPaintBucketMode();
      setPaintBucketMode(mode as 'color' | 'geometry');
      return { previous, mode };
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

    /** Wrap tolerance for the UI brush tool: the maximum edge bend (degrees,
     *  0–180) paint may flow across. Applies to both surface modes — paint
     *  follows gentle curves / bumps but stops at sharper folds. 90° (default)
     *  stops at right-angle corners; 180° wraps across any edge. */
    getBrushWrapAngle() {
      return { wrapAngleDeg: getPaintBrushWrapAngle() };
    },
    setBrushWrapAngle(deg: number) {
      if (typeof deg !== 'number' || !Number.isFinite(deg)) {
        return { error: `setBrushWrapAngle(deg): deg must be a finite number in ${WRAP_ANGLE_MIN}..${WRAP_ANGLE_MAX}` };
      }
      setPaintBrushWrapAngle(deg);
      return { wrapAngleDeg: getPaintBrushWrapAngle() };
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
      wrapAngleDeg?: number;
      name?: string;
    }) {
      if (!currentMeshData) return { error: 'No geometry loaded — run code first, then paint.' };
      if (!opts || typeof opts !== 'object') return { error: 'paintStroke(opts): opts object required' };
      const { points, radius, color, shape, resolution, maxEdge, surface, depth, wrapAngleDeg, name } = opts;
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
      if (wrapAngleDeg !== undefined && (typeof wrapAngleDeg !== 'number' || !Number.isFinite(wrapAngleDeg) || wrapAngleDeg < WRAP_ANGLE_MIN || wrapAngleDeg > WRAP_ANGLE_MAX)) {
        return { error: `paintStroke: wrapAngleDeg must be a number in ${WRAP_ANGLE_MIN}..${WRAP_ANGLE_MAX} (max edge bend paint flows across) when provided` };
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
        surface: (surface as 'geodesic' | 'slab') ?? 'slab', depth: depth ?? 0,
        // Default to no gate (180°) for the console API so a paintStroke without
        // wrapAngleDeg behaves exactly as before; the UI brush passes 90°.
        wrapAngleDeg: wrapAngleDeg ?? 180,
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
      surface?: string;
      depth?: number;
      name?: string;
    }) {
      if (!currentMeshData) return { error: 'No geometry loaded — run code first, then paint.' };
      if (!opts || typeof opts !== 'object') return { error: 'paintAirbrush(opts): opts object required' };
      const { points, radius, color, shape, strength, softness, seed, resolution, maxEdge, surface, depth, name } = opts;
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
      if (surface !== undefined && surface !== 'geodesic' && surface !== 'slab') {
        return { error: "paintAirbrush: surface must be 'geodesic' or 'slab' when provided" };
      }
      if (depth !== undefined && (typeof depth !== 'number' || !Number.isFinite(depth) || depth < 0)) {
        return { error: 'paintAirbrush: depth must be a non-negative finite number (mesh units) when provided' };
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
        kind: 'brushStroke', samples, radius, shape: shp, maxEdge: target,
        surface: (surface as 'geodesic' | 'slab') ?? 'slab', depth: depth ?? 0, spray,
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
    /** Just the current run's label names (for the Surface panel's code-path
     *  scope dropdown). Empty when the model declares none. */
    getLabelNames(): string[] {
      return currentLabelMap ? [...currentLabelMap.keys()] : [];
    },

    /** Report the colors the current run declared in code — via
     *  `api.label(shape, name, { color })` (and `api.labeledUnion` entries with
     *  a `color`) or `api.paint.*` calls. These render and export automatically
     *  as a derived underlay — no paint step — and the editor stays editable.
     *  Manual paint composites on top. Returns
     *  `{ count, colors: [{name, color, triangleCount}] }`; an empty list means
     *  no colors were declared (or the labelled triangles vanished in a
     *  boolean — check `listLabels().lostLabels`). */
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
        onStateChange: () => { syncVoxelPaintUI(); },
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

    /** Select the active Voxel Studio tool: 'paint' | 'add' | 'remove' |
     *  'bucket' | 'level' | 'boxAdd' | 'boxRemove'. Returns `{ tool }` or
     *  `{ error }`. */
    setVoxelTool(tool: import('./color/voxelPaint').VoxelTool) {
      if (!voxelPaint.isActive()) return { error: 'Voxel Studio is not active — call activateVoxelPaint() first.' };
      const tools = ['view', 'paint', 'add', 'remove', 'bucket', 'level', 'boxAdd', 'boxRemove'];
      if (!tools.includes(tool as string)) return { error: `setVoxelTool: tool must be one of ${tools.join(', ')}` };
      voxelPaint.setTool(tool);
      syncVoxelPaintUI();
      return { tool };
    },

    /** Apply the active tool at a clicked face (the triangle index a raycast
     *  would return). Optionally sets the color and/or tool first. The box
     *  tools take two calls (first banks a corner, second completes the box).
     *  Returns `{ changed, voxelCount, tool, pendingBoxCorner }` or `{ error }`. */
    voxelStudioApply(opts: { faceIndex: number; color?: [number, number, number] | string | number; tool?: import('./color/voxelPaint').VoxelTool }) {
      if (!voxelPaint.isActive()) return { error: 'Voxel Studio is not active — call activateVoxelPaint() first.' };
      if (!opts || typeof opts !== 'object') return { error: 'voxelStudioApply requires { faceIndex }' };
      if (!Number.isInteger(opts.faceIndex) || opts.faceIndex < 0) return { error: 'voxelStudioApply.faceIndex must be a non-negative integer' };
      if (opts.tool !== undefined) {
        const tools = ['paint', 'add', 'remove', 'bucket', 'level', 'boxAdd', 'boxRemove'];
        if (!tools.includes(opts.tool as string)) return { error: `voxelStudioApply: tool must be one of ${tools.join(', ')}` };
        voxelPaint.setTool(opts.tool);
      }
      if (opts.color !== undefined) {
        try { voxelPaint.setColor(opts.color); }
        catch (e) { return { error: (e as Error).message }; }
      }
      const changed = voxelPaint.applyAtTriangle(opts.faceIndex);
      syncVoxelPaintUI();
      return { changed, voxelCount: voxelPaint.voxelCount(), tool: voxelPaint.getTool(), pendingBoxCorner: voxelPaint.pendingBoxCorner() };
    },

    /** Undo the last Voxel Studio edit. Returns `{ undone, voxelCount }`. */
    voxelStudioUndo() {
      if (!voxelPaint.isActive()) return { error: 'Voxel Studio is not active.' };
      const undone = voxelPaint.undo();
      syncVoxelPaintUI();
      return { undone, voxelCount: voxelPaint.voxelCount() };
    },

    /** Redo the last undone Voxel Studio edit. Returns `{ redone, voxelCount }`. */
    voxelStudioRedo() {
      if (!voxelPaint.isActive()) return { error: 'Voxel Studio is not active.' };
      const redone = voxelPaint.redo();
      syncVoxelPaintUI();
      return { redone, voxelCount: voxelPaint.voxelCount() };
    },

    /** Configure the brush used by the paint/add/remove tools. `radius` is in
     *  voxels (0 = a single voxel, max 16); `shape` is 'sphere' | 'cube' |
     *  'diamond'; `spray` scatters a random subset; `sprayDensity` is 0.05..1.
     *
     *  The `add` tool uses a block instead of a round brush: `block` is the
     *  [x,y,z] size in voxels (1..32 each) and `depth` (≥ 0; no upper limit) is
     *  how far the block sinks into the clicked surface — 0 attaches it flush to the face
     *  (so a thick block never pokes out the far side of a thin tile).
     *  Returns the resolved brush settings or `{ error }`. */
    setVoxelBrush(opts: { radius?: number; shape?: import('./color/voxelPaint').BrushShape; spray?: boolean; sprayDensity?: number; block?: [number, number, number]; depth?: number } = {}) {
      if (!voxelPaint.isActive()) return { error: 'Voxel Studio is not active — call activateVoxelPaint() first.' };
      if (opts.radius !== undefined) {
        if (typeof opts.radius !== 'number' || opts.radius < 0) return { error: 'setVoxelBrush.radius must be a non-negative number' };
        voxelPaint.setBrushRadius(opts.radius);
      }
      if (opts.shape !== undefined) {
        const shapes = ['sphere', 'cube', 'diamond'];
        if (!shapes.includes(opts.shape as string)) return { error: `setVoxelBrush.shape must be one of ${shapes.join(', ')}` };
        voxelPaint.setBrushShape(opts.shape);
      }
      if (opts.spray !== undefined) voxelPaint.setSpray(!!opts.spray);
      if (opts.sprayDensity !== undefined) {
        if (typeof opts.sprayDensity !== 'number') return { error: 'setVoxelBrush.sprayDensity must be a number 0.05..1' };
        voxelPaint.setSprayDensity(opts.sprayDensity);
      }
      if (opts.block !== undefined) {
        const b = opts.block;
        if (!Array.isArray(b) || b.length !== 3 || b.some((n) => typeof n !== 'number' || n < 1)) {
          return { error: 'setVoxelBrush.block must be [x,y,z] with each ≥ 1' };
        }
        ([0, 1, 2] as const).forEach((axis) => voxelPaint.setBlockSize(axis, b[axis]));
      }
      if (opts.depth !== undefined) {
        if (typeof opts.depth !== 'number' || opts.depth < 0) return { error: 'setVoxelBrush.depth must be a non-negative number' };
        voxelPaint.setAddDepth(opts.depth);
      }
      syncVoxelPaintUI();
      return {
        radius: voxelPaint.getBrushRadius(), shape: voxelPaint.getBrushShape(),
        spray: voxelPaint.isSpray(), sprayDensity: voxelPaint.getSprayDensity(),
        block: voxelPaint.getBlockSize(), depth: voxelPaint.getAddDepth(),
      };
    },

    /** Set the axis (0=x, 1=y, 2=z) the 'level' tool recolors. Returns `{ axis }`. */
    setVoxelLevelAxis(axis: 0 | 1 | 2) {
      if (!voxelPaint.isActive()) return { error: 'Voxel Studio is not active.' };
      if (axis !== 0 && axis !== 1 && axis !== 2) return { error: 'setVoxelLevelAxis.axis must be 0, 1, or 2' };
      voxelPaint.setLevelAxis(axis);
      syncVoxelPaintUI();
      return { axis };
    },

    /** Set the active grid's surfacing (corner rounding) — the programmatic twin
     *  of the Voxel Studio Rounding panel. Pass `null` for hard blocks, or
     *  `{ algorithm?: 'taubin'|'surfaceNets', strength?: 0..1, iterations?: 1..8,
     *  flatBottom?: bool, baseLayers?: int (0 = no flat base) }` to smooth.
     *  Requires `activateVoxelPaint()` first. Returns `{ surfacing }` (the
     *  resolved surfacing, or `null` when blocky) or `{ error }`. */
    setVoxelRounding(opts: import('./color/voxelPaint').RoundingOpts | null) {
      if (!voxelPaint.isActive()) return { error: 'Voxel Studio is not active — call activateVoxelPaint() first.' };
      if (opts === null) {
        voxelPaint.setRounding(null);
        syncVoxelPaintUI();
        return { surfacing: voxelPaint.getSurfacing() };
      }
      if (typeof opts !== 'object' || Array.isArray(opts)) return { error: 'setVoxelRounding.opts must be an object or null' };
      const clean: import('./color/voxelPaint').RoundingOpts = {};
      if (opts.algorithm !== undefined) {
        if (opts.algorithm !== 'taubin' && opts.algorithm !== 'surfaceNets') return { error: "setVoxelRounding.algorithm must be 'taubin' or 'surfaceNets'" };
        clean.algorithm = opts.algorithm;
      }
      if (opts.strength !== undefined) {
        if (typeof opts.strength !== 'number' || opts.strength < 0 || opts.strength > 1) return { error: 'setVoxelRounding.strength must be a number 0..1' };
        clean.strength = opts.strength;
      }
      if (opts.iterations !== undefined) {
        if (typeof opts.iterations !== 'number' || !Number.isInteger(opts.iterations) || opts.iterations < 1 || opts.iterations > 8) return { error: 'setVoxelRounding.iterations must be an integer 1..8' };
        clean.iterations = opts.iterations;
      }
      if (opts.flatBottom !== undefined) {
        if (typeof opts.flatBottom !== 'boolean') return { error: 'setVoxelRounding.flatBottom must be a boolean' };
        clean.flatBottom = opts.flatBottom;
      }
      if (opts.baseLayers !== undefined) {
        if (typeof opts.baseLayers !== 'number' || !Number.isInteger(opts.baseLayers) || opts.baseLayers < 0 || opts.baseLayers > 1024) return { error: 'setVoxelRounding.baseLayers must be an integer 0..1024' };
        if (opts.baseLayers > 0) clean.baseLayers = opts.baseLayers; // 0 = no flat base
      }
      voxelPaint.setRounding(clean);
      syncVoxelPaintUI();
      return { surfacing: voxelPaint.getSurfacing() };
    },

    /** Read the active grid's current surfacing (corner rounding) settings.
     *  Returns `{ surfacing }` (the Surfacing object, or `null` when blocky) or
     *  `{ error }` when Voxel Studio is not active. */
    getVoxelRounding() {
      if (!voxelPaint.isActive()) return { error: 'Voxel Studio is not active — call activateVoxelPaint() first.' };
      return { surfacing: voxelPaint.getSurfacing() };
    },

    /** Begin a brush stroke: subsequent `voxelStudioApply` calls collapse into a
     *  single undo step until `voxelStudioEndStroke()`. This is the programmatic
     *  equivalent of a click-drag. Returns `{ ok }` or `{ error }`. */
    voxelStudioBeginStroke() {
      if (!voxelPaint.isActive()) return { error: 'Voxel Studio is not active.' };
      voxelPaint.beginStroke();
      return { ok: true };
    },

    /** Finish the current brush stroke, committing it as one undo step.
     *  Returns `{ ok, voxelCount }`. */
    voxelStudioEndStroke() {
      if (!voxelPaint.isActive()) return { error: 'Voxel Studio is not active.' };
      voxelPaint.endStroke();
      syncVoxelPaintUI();
      return { ok: true, voxelCount: voxelPaint.voxelCount() };
    },

    /** Bake the painted grid into `voxels.decode(...)` editor code, run it,
     *  and save as a new version. Deactivates voxel paint mode after baking.
     *  Auto-creates a session if none exists. Returns `{ versionIndex,
     *  voxelCount }` or `{ error }`. */
    async bakeVoxelsToCode(opts: { label?: string } = {}) {
      const label = typeof opts.label === 'string' && opts.label ? opts.label : 'painted';
      const result = await commitVoxelEdits('replace', label);
      syncVoxelPaintUI();
      return result;
    },

    /** "Update code": keep the current procedural voxel source and append the
     *  Studio's edits as explicit v.set/v.remove statements, then save a new
     *  version. Returns `{ versionIndex, voxelCount }` or `{ error }`. */
    async updateVoxelCode(opts: { label?: string } = {}) {
      const label = typeof opts.label === 'string' && opts.label ? opts.label : 'voxel edits';
      const result = await commitVoxelEdits('update', label);
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
      if (!ids) {
        const known = [...currentLabelMap.keys()].map(k => `"${k}"`).join(', ');
        return { error: `paintByLabel: no label "${opts.label}". Known labels: ${known}.` };
      }
      if (ids.size === 0) {
        return { error: `paintByLabel: label "${opts.label}" is registered but resolved to 0 triangles — the labelled geometry has no visible surface (it may be fully enclosed by another region, e.g. eyes swallowed by the head). Make the labelled shape protrude, or paint by coordinates instead.` };
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
        'buildCharacter':  { signature: 'await buildCharacter(spec, {save?, label?}) -- Generate a posed, painted human figure from a Character Creator spec (body/pose/face/hair/clothing/colors). save:true commits a version. Same engine as the 🧍 Character panel.', docs: '/ai/figure.md' },
        'saveVersion':     { signature: 'await saveVersion(label?) -- Save current state as version', docs: '/ai.md#console-api--windowpartwright' },
        'saveAllParts':    { signature: 'await saveAllParts() -- Save every part with unsaved changes', docs: '/ai.md#console-api--windowpartwright' },
        'listVersions':    { signature: 'await listVersions() -- List all versions in session', docs: '/ai.md#console-api--windowpartwright' },
        'loadVersion':     { signature: 'await loadVersion({index} | {id}) -- Load version into editor -> {id, index, label, code, geometryData} or {error}', docs: '/ai.md#console-api--windowpartwright' },
        'renameVersion':   { signature: 'await renameVersion({index} | {id}, label) -- Relabel a version -> {ok, id, index, label} or {error}', docs: '/ai.md#console-api--windowpartwright' },
        'deleteVersion':   { signature: 'await deleteVersion({index} | {id}) -- Delete a version (refuses the last) -> {ok, deleted, newCurrent} or {error}', docs: '/ai.md#console-api--windowpartwright' },
        'diffVersions':    { signature: 'await diffVersions({index} | {id}, {index} | {id}) -- Compare two versions -> {a, b, codeChanged, statDiff}', docs: '/ai.md#console-api--windowpartwright' },
        'forkVersion':     { signature: 'await forkVersion({index} | {id}, transformFn, label?, assertions?, carryColors=true) -- Load + modify + validate + save in one call; carries parent colors -> {..., codeDiff, colors}', docs: '/ai.md#forking-a-prior-version' },
        'copyColorsFromVersion': { signature: 'await copyColorsFromVersion({index} | {id}) -- Re-apply a prior version\'s color regions onto the current mesh -> {source, carried, dropped}', docs: '/ai.md#forking-a-prior-version' },
        'openSession':     { signature: 'await openSession(id) -- Open existing session', docs: '/ai.md#resuming-a-session' },
        'listSessions':    { signature: 'await listSessions() -- List all sessions', docs: '/ai.md#console-api--windowpartwright' },
        'getSessionContext': { signature: 'await getSessionContext() -- Get full session context (for resuming)', docs: '/ai.md#resuming-a-session' },
        // Parts (multiple objects per session)
        'listParts':       { signature: 'listParts() -- List parts in the session -> [{id, name, order, isCurrent}]', docs: '/ai.md#console-api--windowpartwright' },
        'showPartsOverview': { signature: 'showPartsOverview() -- Open the all-parts thumbnail overview modal', docs: '/ai.md#console-api--windowpartwright' },
        'getCurrentPart':  { signature: 'getCurrentPart() -- Active part -> {id, name, order} or null', docs: '/ai.md#console-api--windowpartwright' },
        'createPart':      { signature: 'await createPart(name?) -- New empty part + switch to it -> {id, name, order}', docs: '/ai.md#console-api--windowpartwright' },
        'changePart':      { signature: 'await changePart(name|id|index) -- Switch active part (loads its latest version)', docs: '/ai.md#console-api--windowpartwright' },
        'renamePart':      { signature: 'await renamePart(name|id|index, newName) -- Rename a part', docs: '/ai.md#console-api--windowpartwright' },
        'deletePart':      { signature: 'await deletePart(name|id|index) -- Delete a part and its versions', docs: '/ai.md#console-api--windowpartwright' },
        'getShareLink':    { signature: 'await getShareLink() -- Read-only share link for the current version -> {url, encodedBytes} or {error}; the link to hand the user when done', docs: '/ai.md#console-api--windowpartwright' },
        'getGalleryUrl':   { signature: 'getGalleryUrl() -- URL for gallery view (local browser only)', docs: '/ai.md#console-api--windowpartwright' },
        // Notes
        'addSessionNote':  { signature: 'await addSessionNote(text) -- Add note with [PREFIX] tag', docs: '/ai.md#session-notes----tracking-design-context' },
        'listSessionNotes': { signature: 'await listSessionNotes() -- List all session notes', docs: '/ai.md#session-notes----tracking-design-context' },
        // Attachments (durable project files: reference images, models, docs — survive a chat clear)
        'getAttachments':  { signature: 'getAttachments() -- List session attachments -> [{id, kind, mediaType?, src, label?, description?, addedAt?, source?}]. kind: image|model|document|text|other; description = why it matters', docs: '/ai/reference-images.md#attachments' },
        'addAttachment':   { signature: 'addAttachment({src, label?, description?, kind?, mediaType?}) -- Pin a file to the session (kind/mediaType inferred when omitted; description = why it matters) -> the stored item', docs: '/ai/reference-images.md#attachments' },
        'setAttachments':  { signature: 'setAttachments([{src, label?, description?, kind?, mediaType?}]) -- Replace the whole attachment list', docs: '/ai/reference-images.md#attachments' },
        'removeAttachment': { signature: 'removeAttachment(id) -- Remove an attachment by id -> boolean', docs: '/ai/reference-images.md#attachments' },
        'clearAttachments': { signature: 'clearAttachments() -- Remove all attachments', docs: '/ai/reference-images.md#attachments' },
        'getImages':       { signature: 'getImages() -- Image-kind attachments only -> [{id, src, label?}]', docs: '/ai/reference-images.md#attachments' },
        'addImage':        { signature: 'addImage({src, label?}) -- Pin a reference image (shorthand for addAttachment with kind:image)', docs: '/ai/reference-images.md#attachments' },
        'setImages':       { signature: 'setImages([{src, label?, id?}]) -- Replace the image attachments (non-image attachments preserved)', docs: '/ai/reference-images.md#attachments' },
        'removeImage':     { signature: 'removeImage(id) -- Remove an attachment by id -> boolean', docs: '/ai/reference-images.md#attachments' },
        'clearImages':     { signature: 'clearImages() -- Remove the image attachments (non-image attachments preserved)', docs: '/ai/reference-images.md#attachments' },
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
        'setStudioLighting':    { signature: 'setStudioLighting(on?) -- Toggle studio lighting: reflections + soft shadow, on by default (omit to toggle) -> boolean', docs: '/ai.md#viewport-controls' },
        'isStudioLighting':     { signature: 'isStudioLighting() -- Whether studio lighting is on', docs: '/ai.md#viewport-controls' },
        'setDimensionsVisible': { signature: 'setDimensionsVisible(on?) -- Show/hide bounding box dimensions (omit to toggle) -> boolean', docs: '/ai.md#viewport-controls' },
        'areDimensionsVisible': { signature: 'areDimensionsVisible() -- Whether dimensions overlay is visible', docs: '/ai.md#viewport-controls' },
        'setOrbitLock':         { signature: 'setOrbitLock(on?) -- Lock/unlock camera rotation (omit to toggle) -> boolean', docs: '/ai.md#viewport-controls' },
        'isOrbitLocked':        { signature: 'isOrbitLocked() -- Whether camera orbit is locked', docs: '/ai.md#viewport-controls' },
        'resetView':            { signature: 'resetView() -- Reset the camera to the default framing of the current model', docs: '/ai.md#viewport-controls' },
        'setTheme':             { signature: 'setTheme("dark"|"light") -- Set color theme', docs: '/ai.md#viewport-controls' },
        'getTheme':             { signature: 'getTheme() -- Current color theme', docs: '/ai.md#viewport-controls' },
        'setAutoRun':           { signature: 'setAutoRun(enabled) -- Enable/disable auto-render on edit', docs: '/ai.md#viewport-controls' },
        'isAutoRunEnabled':     { signature: 'isAutoRunEnabled() -- Whether auto-run is active', docs: '/ai.md#viewport-controls' },
        // Assembly view (all parts in a grid)
        'openAssembly':         { signature: 'openAssembly() -- Show every part of the session in a non-overlapping grid, built in parallel (needs ≥2 parts) -> snapshot', docs: '/ai.md#assembly-view' },
        'closeAssembly':        { signature: 'closeAssembly() -- Close the Assembly view, return to the single part', docs: '/ai.md#assembly-view' },
        'getAssembly':          { signature: 'getAssembly() -- Assembly snapshot: {open, parts:[{id,name,placed}], sharedParams}', docs: '/ai.md#assembly-view' },
        // Insert & arrange palette (Tinkercad-style direct manipulation)
        'enterArrange':         { signature: 'enterArrange() -- Activate arrange-mode pointer hook (drag to move parts in 3D) -> {ok}', docs: '/ai.md#arrange-mode' },
        'exitArrange':          { signature: 'exitArrange() -- Deactivate arrange mode', docs: '/ai.md#arrange-mode' },
        'isArrangeActive':      { signature: 'isArrangeActive() -- Whether arrange mode is currently capturing pointer events', docs: '/ai.md#arrange-mode' },
        'selectParts':          { signature: 'selectParts(names) -- Replace the arrange-mode selection -> matched names', docs: '/ai.md#arrange-mode' },
        'addToSelection':       { signature: 'addToSelection(names) -- Extend the arrange-mode selection -> matched names', docs: '/ai.md#arrange-mode' },
        'clearSelection':       { signature: 'clearSelection() -- Drop everything from the arrange-mode selection', docs: '/ai.md#arrange-mode' },
        'getSelection':         { signature: 'getSelection() -- Current arrange-mode selection -> string[]', docs: '/ai.md#arrange-mode' },
        'listArrangeParts':     { signature: 'listArrangeParts() -- Names + bboxes of every part arrange mode can act on -> [{name, box:{min,max}, center}]', docs: '/ai.md#arrange-mode' },
        'undo':                 { signature: 'undo() -- Reverse the last palette operation (insert/move/resize/align/boolean/etc) -> label or null', docs: '/ai.md#arrange-mode' },
        'redo':                 { signature: 'redo() -- Reapply the last undone palette operation -> label or null', docs: '/ai.md#arrange-mode' },
        'canUndo':              { signature: 'canUndo() -- Whether undo() would do anything', docs: '/ai.md#arrange-mode' },
        'canRedo':              { signature: 'canRedo() -- Whether redo() would do anything', docs: '/ai.md#arrange-mode' },
        'resizeSelection':      { signature: 'resizeSelection([sx,sy,sz]) -- Scale selected parts per-axis (or uniform [s,s,s]) -> {ok}', docs: '/ai.md#arrange-mode' },
        'alignSelection':       { signature: 'alignSelection(axis, mode) -- axis: "x"|"y"|"z", mode: "min"|"center"|"max" -> {ok}', docs: '/ai.md#arrange-mode' },
        'groupSelection':       { signature: 'groupSelection() -- Union selected parts in code (∪) -> {ok}', docs: '/ai.md#arrange-mode' },
        'subtractSelection':    { signature: 'subtractSelection() -- Subtract later operands from the first (∖) -> {ok}', docs: '/ai.md#arrange-mode' },
        'intersectSelection':   { signature: 'intersectSelection() -- Intersect every selected part (∩) -> {ok}', docs: '/ai.md#arrange-mode' },
        'deleteSelection':      { signature: 'deleteSelection() -- Remove selected parts from the code -> {ok}', docs: '/ai.md#arrange-mode' },
        'duplicateSelection':   { signature: 'duplicateSelection() -- Clone selected parts, offset along +X -> {ok}', docs: '/ai.md#arrange-mode' },
        'mirrorSelection':      { signature: 'mirrorSelection("x"|"y"|"z") -- Mirror selected parts in place across axis -> {ok}', docs: '/ai.md#arrange-mode' },
        'setAutoCombine':       { signature: 'setAutoCombine(on) -- Toggle "Auto-combine new shapes" (managed-return engines only)', docs: '/ai.md#arrange-mode' },
        'getAutoCombine':       { signature: 'getAutoCombine() -- Whether Auto-combine is currently on', docs: '/ai.md#arrange-mode' },
        'setSnapToGrid':        { signature: 'setSnapToGrid(on) -- Round arrange-drag deltas to whole units (non-voxel engines)', docs: '/ai.md#arrange-mode' },
        'getSnapToGrid':        { signature: 'getSnapToGrid() -- Whether snap-to-grid is currently on', docs: '/ai.md#arrange-mode' },
        'rotateSelection':      { signature: 'rotateSelection([rx,ry,rz]) -- Rotate selected parts in place (degrees); 2+ parts pivot around the group centroid (Z plane) -> {ok}', docs: '/ai.md#arrange-mode' },
        // View
        'setView':         { signature: 'setView(tab) -- Switch tab: "interactive", "gallery", "images", "diff", "notes"', docs: '/ai.md#how-to-use-this-tool' },
        'getViewState':    { signature: 'getViewState() -- Current tab and camera state', docs: '/ai.md#how-to-use-this-tool' },
        // Export
        'exportGLB':       { signature: 'await exportGLB() -- Download GLB file', docs: '/ai.md#console-api--windowpartwright' },
        'exportSTL':       { signature: 'exportSTL() -- Download STL file', docs: '/ai.md#console-api--windowpartwright' },
        'exportOBJ':       { signature: 'exportOBJ() -- Download OBJ file', docs: '/ai.md#console-api--windowpartwright' },
        'export3MF':       { signature: 'export3MF() -- Download 3MF file', docs: '/ai.md#console-api--windowpartwright' },
        'publish':         { signature: 'publish(platform?) -- Open the assisted-publish modal for Printables/MakerWorld/Thingiverse/Thangs (no public upload API, so it prepares the file + cover + clipboard details and opens the upload page). platform optionally preselects one site', docs: '/ai/file-io.md' },
        'export3MFParts':  { signature: 'await export3MFParts(partIds?, filename?, {bambu?, printer?, nozzle?, filament?}) -- Bundle parts into one 3MF; bambu:true (default) = one part per Bambu/Orca plate (printer e.g. "p1s"/"h2c", nozzle "0.4", filament "pla"/"petg"…), false = generic multi-object grid -> {ok, filename, parts}', docs: '/ai/file-io.md' },
        'export3MFPartsData': { signature: 'await export3MFPartsData(partIds?, filename?, {bambu?, printer?, nozzle?, filament?}) -- Same as export3MFParts but RETURNS {filename, mimeType, base64, sizeBytes, parts} instead of downloading', docs: '/ai/file-io.md' },
        'exportOBJParts':  { signature: 'await exportOBJParts(partIds?, filename?) -- Bundle parts into one OBJ (named objects, grid-arranged; .mtl in a .zip if painted) -> {ok, filename, parts}', docs: '/ai/file-io.md' },
        'exportOBJPartsData': { signature: 'await exportOBJPartsData(partIds?, filename?) -- Same as exportOBJParts but RETURNS {filename, mimeType, base64, sizeBytes, parts} instead of downloading', docs: '/ai/file-io.md' },
        'exportSTLParts':  { signature: 'await exportSTLParts(partIds?, filename?) -- Bundle parts into a .zip of one .stl per part -> {ok, filename, parts}', docs: '/ai/file-io.md' },
        'exportSTLPartsData': { signature: 'await exportSTLPartsData(partIds?, filename?) -- Same as exportSTLParts but RETURNS {filename, mimeType, base64, sizeBytes, parts} instead of downloading', docs: '/ai/file-io.md' },
        'exportGLBParts':  { signature: 'await exportGLBParts(partIds?, filename?) -- Bundle parts into one GLB (named nodes, grid-arranged; vertex colours) -> {ok, filename, parts}', docs: '/ai/file-io.md' },
        'exportGLBPartsData': { signature: 'await exportGLBPartsData(partIds?, filename?) -- Same as exportGLBParts but RETURNS {filename, mimeType, base64, sizeBytes, parts} instead of downloading', docs: '/ai/file-io.md' },
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
        'importMeshData':  { signature: 'await importMeshData(base64, filename, {sessionName?}) -- Import STL bytes (binary/ASCII) as a new session -> {sessionId, isManifold, triangleCount, vertexCount} or {error}', docs: '/ai/file-io.md' },
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
        'paintInCylinder': { signature: 'paintInCylinder({rMin, rMax, zMin, zMax, center?, axis?, color, name?}) -- Paint a cylindrical/annular shell (rMin=0 = solid cylinder). axis (x|y|z, default z) picks the shell axis; band runs zMin..zMax along it.', docs: '/ai/colors.md' },
        'paintPreview':    { signature: 'paintPreview({box?|point+radius?|triangleIds?, normalCone?, withImage?, view?}) -- DRY-RUN -> {triangleCount, bbox, centroid, [thumbnail]}. Default count-only; pass withImage:true for the yellow-highlighted thumbnail.', docs: '/ai/colors.md' },
        'paintExplain':    { signature: 'paintExplain({region, withImage?, view?}) -- Diagnose a committed region -> {triangleCount, area, bbox, centroid, normalHistogram, [thumbnail]}.', docs: '/ai/colors.md' },
        'assertPaint':     { signature: 'assertPaint({region, expectedTriangleCount?, expectedBoundingBox?, expectedCentroid?}) -- Verify a previously-painted region -> {passed, failures?}', docs: '/ai/colors.md' },
        'findFaces':       { signature: 'findFaces({box?, normal?, normalTolerance?, color?, region?, maxResults?}) -- Query triangle ids by geometry/color filters', docs: '/ai/colors.md' },
        'getMesh':         { signature: 'getMesh() -- Direct triangle/vertex/normal/centroid access for procedural paint workflows', docs: '/ai/colors.md' },
        'getMeshSummary':  { signature: 'getMeshSummary({tolerance?, minTriangles?, maxTrianglesPerGroup?, maxGroups?}?) -- List coplanar face groups with centroid/normal/area/bbox', docs: '/ai/colors.md' },
        'listRegions':     { signature: 'listRegions() -- List all color regions with bbox + centroid for each', docs: '/ai/colors.md' },
        'clearColors':     { signature: 'clearColors() -- Remove ALL color regions (use undoLastPaint to reverse just one)', docs: '/ai/colors.md' },
        'replaceColor':    { signature: 'replaceColor({from:[r,g,b], to:[r,g,b], tolerance?}) -- Recolor every USER paint region matching `from` (0..1 colors) -> {replaced, hint?}. Code-declared colors (api.paint.*/api.label) are edited in the code, not here.', docs: '/ai/colors.md' },
        'paintImage':      { signature: 'await paintImage({imageUrl, view?:"front"|"back"|"left"|"right"|"top"|"bottom", label?, at?:[x,y,z], normal?:[nx,ny,nz], size?, rotationDeg?, detail?, removeBackground?, name?}) -- Project a raster image onto the surface as paint (logo/graphic/text/decal). Use view (auto-anchored, optionally centred on a label) OR explicit at+normal -> {ok, name, triangles, avgColor} or {error}', docs: '/ai/colors.md' },
        'getPalette':      { signature: 'getPalette() -- Active filament palette {id, name, capacity, constrained, slots:[{id,name,hex,td}]}', docs: '/ai/colors.md' },
        'listPalettes':    { signature: 'listPalettes() -- All saved palettes [{id, name, active}]', docs: '/ai/colors.md' },
        'createPalette':   { signature: 'createPalette(name) -- Create an empty palette -> {id} (call setActivePalette to switch)', docs: '/ai/colors.md' },
        'setActivePalette':{ signature: 'setActivePalette(id) -- Switch active palette by id from listPalettes() -> {ok} or {error}', docs: '/ai/colors.md' },
        'addFilament':     { signature: 'addFilament({name, hex:"#rrggbb", td?}) -- Add a slot to the active palette -> {id,name,hex,td}', docs: '/ai/colors.md' },
        'updateFilament':  { signature: 'updateFilament(id, {name?, hex?, td?}) -- Edit a slot -> {ok} or {error}', docs: '/ai/colors.md' },
        'removeFilament':  { signature: 'removeFilament(id) -- Remove a slot from the active palette -> {ok} or {error}', docs: '/ai/colors.md' },
        'setPaletteCapacity': { signature: 'setPaletteCapacity(n) -- Set the AMS/MMU slot budget -> {ok, capacity}', docs: '/ai/colors.md' },
        'setPaletteConstrained': { signature: 'setPaletteConstrained(on) -- Constrain paint to palette slots (snap) vs free RGB -> {ok, constrained}', docs: '/ai/colors.md' },
        'listComponents':  { signature: 'listComponents() -> {count, components: [{index, centroid, boundingBox, volume, surfaceArea}]} -- Decompose the manifold into boolean-distinct parts. For "paint each feature" workflows (e.g. unioned head + eyes + mouth).', docs: '/ai/colors.md' },
        'paintComponent':  { signature: 'paintComponent({index, color, name?, topOnly?}) -- One-call shortcut: listComponents + paintInBox for the Nth piece.', docs: '/ai/colors.md' },
        'listLabels':      { signature: 'listLabels() -> {count, labels: [{name, triangleCount, bbox, centroid}]} -- Labels registered in the current run via api.label(shape, name). Survives boolean ops; the cleanest paint primitive on agent-authored geometry.', docs: '/ai/colors.md' },
        'getModelColors':  { signature: 'getModelColors() -> {count, colors: [{name, color, triangleCount}]} -- Colors declared in code via api.label(shape, name, {color}) or api.paint.*. Render + export automatically; editor stays editable; manual paint overrides.', docs: '/ai/colors.md' },
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
        'getBucketTolerance': { signature: 'getBucketTolerance() -- Read the geometry-mode bucket tolerance (cosine of max bend angle, -1..1).', docs: '/ai/colors.md' },
        'setBucketTolerance': { signature: 'setBucketTolerance(tolerance) -- Set geometry-mode bucket tolerance (-1..1, cosine). 1 = coplanar only, -1 = whole component.', docs: '/ai/colors.md' },
        'getBucketColorTolerance': { signature: 'getBucketColorTolerance() -- Read the color-mode bucket tolerance (0 = exact match, 1 = any color).', docs: '/ai/colors.md' },
        'setBucketColorTolerance': { signature: 'setBucketColorTolerance(tolerance) -- Set color-mode bucket tolerance (0..1). 0 = exact match, 1 = fill entire connected mesh.', docs: '/ai/colors.md' },
        'getBucketMode': { signature: "getBucketMode() -- Read the bucket flood-fill mode ('color' or 'geometry').", docs: '/ai/colors.md' },
        'setBucketMode': { signature: "setBucketMode(mode) -- Set the bucket flood-fill mode: 'color' (magic-wand by RGB) or 'geometry' (coplanar by bend angle).", docs: '/ai/colors.md' },
        'getBrushSize':    { signature: 'getBrushSize() -- Read the UI brush radius (mesh units). 0 = single triangle.', docs: '/ai/colors.md' },
        'setBrushSize':    { signature: 'setBrushSize(radius) -- Set the UI brush radius (mesh units, >= 0). Affects only the interactive brush tool; programmatic painting uses paintNear / paintFaces.', docs: '/ai/colors.md' },
        // Surface textures & modifiers (bake path — saves a new version whose code
        // wraps the displaced mesh; in a manifold-js session the in-code
        // api.surface.* alternative keeps the texture parametric instead)
        'modelHasColor':   { signature: 'modelHasColor() -- Whether the model carries any color (user paint or code-declared)', docs: '/ai/colors.md' },
        'ensureSurfaceTexturesApplied': { signature: 'await ensureSurfaceTexturesApplied() -- Apply any pending (cancelled/failed) api.surface.* chain so the live mesh is textured -> {ok}', docs: '/ai/textures.md' },
        'previewSurfaceModifier': { signature: "previewSurfaceModifier(id, opts?, preserveColor?) -- Non-destructive viewport preview of a modifier; id: 'fuzzy'|'knit'|'cable'|'waffle'|'fur'|'woven'|'knurl'|'voronoi'|'voronoiLamp'|'engrave'|'smooth'|'voxelize' -> {ok} or {error}", docs: '/ai/textures.md' },
        'clearSurfacePreview': { signature: 'clearSurfacePreview() -- Discard a live surface preview and restore the current mesh', docs: '/ai/textures.md' },
        'applySurfaceTexture': { signature: "await applySurfaceTexture(id, opts?, mode?) -- Texture by the best path: mode 'auto' (default) writes api.surface.<id> as code on manifold-js, bakes elsewhere; 'code'/'bake' force a path. opts may scope the code path with label:'name' or region:{point,radius}. Returns the result plus path: 'code'|'bake'", docs: '/ai/textures.md' },
        'applySurfaceTextureAsCode': { signature: "await applySurfaceTextureAsCode(id, opts?) -- Write api.surface.<id>({…}) into the code (insert before the final return, or update the existing call) instead of baking; re-runs and saves a version. manifold-js only. opts may add a scope: label:'name' (an api.label region) or region:{point:[x,y,z],radius}. id: 'fuzzy'|'knit'|'cable'|'waffle'|'fur'|'woven'|'knurl'|'voronoi'|'smooth'", docs: '/ai/textures.md' },
        'applyFuzzySkin':  { signature: 'await applyFuzzySkin({amplitude?, scale?, octaves?, seed?, quality?, preserveColor?}) -- BAKE fuzzy-skin noise; saves a new version. In-code alternative: api.surface.fuzzy', docs: '/ai/textures.md' },
        'applyKnitTexture':{ signature: 'await applyKnitTexture({amplitude?, stitchWidth?, stitchHeight?, rowOffset?, roundness?, grainAngleDeg?, variation?, seed?, quality?, algorithm?, selectedTriangles?, preserveColor?}) -- BAKE knit stitches; saves a new version. In-code alternative: api.surface.knit', docs: '/ai/textures.md' },
        'applyCableKnit':  { signature: 'await applyCableKnit({amplitude?, cableWidth?, cablePitch?, plyWidth?, grainAngleDeg?, variation?, seed?, quality?, preserveColor?}) -- BAKE cable-knit ropes; saves a new version. In-code alternative: api.surface.cable', docs: '/ai/textures.md' },
        'applyWaffleStitch': { signature: 'await applyWaffleStitch({amplitude?, cellWidth?, cellHeight?, sharpness?, rowOffset?, grainAngleDeg?, seed?, quality?, preserveColor?}) -- BAKE waffle grid; saves a new version. In-code alternative: api.surface.waffle', docs: '/ai/textures.md' },
        'applyFurVelvet':  { signature: 'await applyFurVelvet({amplitude?, fiberSpacing?, fiberLength?, octaves?, grainAngleDeg?, seed?, quality?, preserveColor?}) -- BAKE fur/velvet fibers; saves a new version. In-code alternative: api.surface.fur', docs: '/ai/textures.md' },
        'applyWovenFabric':{ signature: 'await applyWovenFabric({amplitude?, threadSpacing?, threadWidth?, underDepth?, grainAngleDeg?, seed?, quality?, preserveColor?}) -- BAKE woven threads; saves a new version. In-code alternative: api.surface.woven', docs: '/ai/textures.md' },
        'applyKnurlTexture':{ signature: 'await applyKnurlTexture({amplitude?, cellWidth?, cellHeight?, style?, profile?, sharpness?, grainAngleDeg?, seed?, quality?, preserveColor?}) -- BAKE knurl grip (style: diamond|straight|ribs; profile: round|pyramid); saves a new version. In-code alternative: api.surface.knurl', docs: '/ai/textures.md' },
        'applyVoronoiShell': { signature: 'await applyVoronoiShell({amplitude?, cellSize?, wallWidth?, raised?, jitter?, grainAngleDeg?, seed?, quality?, preserveColor?}) -- BAKE Voronoi cell relief; saves a new version. In-code alternative: api.surface.voronoi', docs: '/ai/textures.md' },
        'applyVoronoiLamp':{ signature: 'await applyVoronoiLamp({cellSize?, wallThickness?, strutWidth?, resolution?, jitter?, grainAngleDeg?, seed?, preserveColor?}) -- Convert the model into a perforated Voronoi lamp shell (bake only — no api.surface twin)', docs: '/ai/textures.md' },
        'engraveModel':    { signature: "await engraveModel({text | imageUrl, raised?, through?, depth?, size?, color?, axis?, side?, posU?, posV?, rotationDeg?, curveAxis?, curveAngleDeg?, font?, resolution?, watertight?, preserveColor?}) -- Carve text/image as recessed channels (engrave), holes (through), or a raised relief (raised = emboss); color paints the letters ('#rrggbb' or [r,g,b] 0–1). Saves a new version.", docs: '/ai/textures.md#engravemodel' },
        'buildEngraveStamp': { signature: 'await buildEngraveStamp({text?, font?, imageUrl?, invert?}) -- Rasterize an ink mask for engraveModel/the Surface panel -> {mask, width, height}', docs: '/ai/textures.md#engravemodel' },
        'smoothModel':     { signature: 'await smoothModel({iterations?, subdivide?, preserveColor?}) -- BAKE a Taubin smoothing pass; saves a new version. In-code alternative: api.surface.smooth', docs: '/ai/textures.md' },
        'voxelizeModel':   { signature: 'await voxelizeModel({resolution?, smooth?, preserveColor?}) -- Convert the mesh to a voxel-language session (engine change — bake only)', docs: '/ai/voxel.md' },
        'setVoxelRounding': { signature: "setVoxelRounding(opts | null) -- Voxel Studio corner rounding: null = hard blocks; {algorithm?: 'taubin'|'surfaceNets', strength?: 0..1, iterations?: 1..8, flatBottom?: bool, baseLayers?: int} = smooth. Requires activateVoxelPaint(). Returns {surfacing} or {error}", docs: '/ai/voxel.md' },
        'getVoxelRounding': { signature: 'getVoxelRounding() -- Read the active grid surfacing -> {surfacing} (null when blocky) or {error}', docs: '/ai/voxel.md' },
        // Transform / placement (mode 'parametric' wraps the code; 'bake' rewrites the mesh; 'auto' picks)
        'canPlaceParametric': { signature: 'canPlaceParametric() -- Whether transforms can be written into the code parametrically (manifold-js sessions)', docs: '/ai/printing.md' },
        'previewScale':    { signature: 'previewScale(sx, sy, sz, {preserveColor?}?) -- Non-destructive viewport preview of a resize -> {ok} or {error}', docs: '/ai/printing.md' },
        'clearScalePreview': { signature: 'clearScalePreview() -- Discard a live scale preview', docs: '/ai/printing.md' },
        'scaleModel':      { signature: "await scaleModel(sx, sy, sz, {mode?: 'parametric'|'bake'|'auto', preserveColor?}?) -- Resize the model (mode 'auto' keeps manifold-js parametric); saves a new version", docs: '/ai/printing.md' },
        'placeModel':      { signature: "await placeModel({dropToFloor?, centerX?, centerY?, centerZ?, mode?: 'parametric'|'bake'|'auto', preserveColor?}) -- Drop to the bed / center on axes; saves a new version", docs: '/ai/printing.md' },
        'rotateModel':     { signature: "await rotateModel({x?, y?, z?, mode?: 'parametric'|'bake'|'auto', preserveColor?}) -- Rotate by Euler degrees about the model's center; saves a new version", docs: '/ai/printing.md' },
        'layFlatModel':    { signature: "await layFlatModel({mode?: 'parametric'|'bake'|'auto', preserveColor?}) -- Auto-orient: largest flat face down onto the bed; saves a new version", docs: '/ai/printing.md' },
        'mirrorModel':     { signature: "await mirrorModel({axis?: 'x'|'y'|'z', mode?: 'parametric'|'bake'|'auto', preserveColor?}) -- Mirror across the model's center plane; saves a new version", docs: '/ai/printing.md' },
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
  // Character Creator UI (viewport 🧍 Character button + command-palette entry).
  initCharacterCreatorUI(partwrightAPI as unknown as Parameters<typeof initCharacterCreatorUI>[0]);
  // Resize/scale UI (viewport ⇲ Resize button + command-palette entry).
  initResizeUI(partwrightAPI as unknown as Parameters<typeof initResizeUI>[0]);
  // Placement UI (viewport ⤓ Place button + command-palette entries).
  initPlaceUI(partwrightAPI as unknown as Parameters<typeof initPlaceUI>[0]);

  // Print tools overlay — informational only: build-volume settings and an
  // on-demand printability check. Scaling and splitting live in their own
  // dedicated tools.
  const printToolsHandlers: PrintToolsHandlers = {
    open(userInitiated) {
      if (userInitiated) {
        if (isPaintOpen()) closePaintMenu();
        if (isAnnotateOpen()) closeAnnotateMenu();
        if (isSimplifyOpen()) closeSimplifyMenu();
        closeMeasureIfActive();
      }
      return { hasModel: !!currentMeshData };
    },
    getSettings: () => loadPrinterSettings(),
    setSettings: (partial) => savePrinterSettings(partial),
    check: () => partwrightAPI.checkPrintability(),
  };
  initPrintToolsUI(clipControls, printToolsHandlers);

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
    axis: CylinderAxis = 'z',
  ): Set<number> {
    // Delegate to the canonical shell collector (src/color/cylinderPaint.ts) so
    // the live paint call, the preview, and the post-refine descriptor resolver
    // all share one implementation — the projection/axis logic can't drift.
    return findCylinderTriangles(mesh, center, rMin, rMax, zMin, zMax, cone, coverage, maxArea, axis);
  }

  /** Produce advisory warnings for geometry that was saved or queried.
   *  Returns an empty array when the geometry is clean.
   *  These are non-blocking — the save has already happened. */
  function geometryWarnings(geo: Record<string, unknown>): string[] {
    if (!geo || geo.status !== 'ok') return [];
    const warnings: string[] = [];
    const isBrep = getActiveLanguage() === 'replicad';
    if (geo.isManifold === false) {
      if (geo.manifoldStatus === 'render-only (not manifold)') {
        // Render-only imports (colour reliefs, sculpted STLs) carry no Manifold,
        // so watertightness was never measured — isManifold is false for lack of
        // measurement, NOT a detected defect. Don't claim the mesh will fail to
        // print; state the actual situation so the agent doesn't chase a phantom.
        warnings.push(
          'render-only import — no Manifold is available, so watertightness is ' +
          'unverified (this is not a detected defect). Reliefs and sculpted STL ' +
          'imports come in render-only to preserve per-vertex colour / order; they ' +
          'still slice and print. Convert to a Manifold (e.g. re-run through ' +
          'Manifold.ofMesh) only if you need booleans or a verified-solid check.',
        );
      } else {
        warnings.push(
          'isManifold: false — the mesh has non-manifold edges or gaps, so it is ' +
          'not a watertight solid and will fail to slice / 3D-print with most tools. ' +
          'Fix before finalizing: ensure boolean operands overlap by ≥ 0.5 units, ' +
          'avoid zero-thickness walls, and check for duplicate faces.',
        );
      }
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
    // Cheap numeric heuristics (tri budget, aspect ratio, sub-extrusion detail,
    // interpenetrating parts) — the signals the headless model:preview already
    // emits but the in-app AI was previously blind to. Surfacing them here lets
    // the agent catch these from stats without paying for a render.
    const cc = typeof geo.componentCount === 'number' ? geo.componentCount : 1;
    const enclosed = typeof geo.containedComponents === 'number' ? geo.containedComponents : 0;
    warnings.push(...buildGeometryHeuristicWarnings(
      {
        triangleCount: typeof geo.triangleCount === 'number' ? geo.triangleCount : 0,
        aspectRatio: typeof geo.aspectRatio === 'number' ? geo.aspectRatio : null,
        minEdgeLength: typeof geo.minEdgeLength === 'number' ? geo.minEdgeLength : 0,
        floatingComponentCount: cc - enclosed,
        componentsInterpenetrate: geo.componentsInterpenetrate === true,
      },
      getConfig().geometry,
    ));
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

  // === api.surface.* — code-declared surface textures (off-thread, memoized) ===

  function hideSurfaceReapplyPill(): void {
    pendingSurface = null;
    if (surfaceReapplyEl) surfaceReapplyEl.style.display = 'none';
  }

  /** Park the run's chain as pending and raise the sticky "Re-apply" pill —
   *  the post-Cancel / post-failure state. */
  function parkSurfaceChain(
    park: { base: MeshData; ops: SurfaceOp[]; baseKey: string; src: string },
    pillText: string,
  ): void {
    pendingSurface = park;
    if (surfaceReapplyEl) {
      surfaceReapplyEl.textContent = pillText;
      surfaceReapplyEl.style.display = '';
    }
  }

  function stalePillText(opCount: number): string {
    return opCount > 1 ? `⟳ ${opCount} textures stale — Re-apply` : '⟳ Texture stale — Re-apply';
  }

  // Inline "Applying texture… Xs" timer — mirrors the "Rendering… Xs" run
  // timer (400 ms delayed show so cache hits never flash it, shared Cancel
  // button). Generation-tokened so a superseded compute's cleanup can't kill
  // the newer compute's timer.
  let _surfaceTimerGen = 0;
  let _surfaceTimerShow: number | null = null;
  let _surfaceTimerInterval: number | null = null;
  let _surfaceProgressNote = '';

  function startSurfaceTimer(label: string): number {
    const gen = ++_surfaceTimerGen;
    if (_surfaceTimerShow !== null) { clearTimeout(_surfaceTimerShow); _surfaceTimerShow = null; }
    if (_surfaceTimerInterval !== null) { clearInterval(_surfaceTimerInterval); _surfaceTimerInterval = null; }
    _surfaceProgressNote = '';
    const t0 = performance.now();
    _surfaceTimerShow = window.setTimeout(() => {
      _surfaceTimerShow = null;
      cancelInlineBtn.classList.remove('hidden');
      _surfaceTimerInterval = window.setInterval(() => {
        const s = ((performance.now() - t0) / 1000).toFixed(1);
        setStatus(statusBar, 'running', `${label}${_surfaceProgressNote} ${s}s`);
      }, 100);
    }, 400);
    return gen;
  }

  function stopSurfaceTimer(gen: number): void {
    if (gen !== _surfaceTimerGen) return; // a newer compute owns the timer now
    if (_surfaceTimerShow !== null) { clearTimeout(_surfaceTimerShow); _surfaceTimerShow = null; }
    if (_surfaceTimerInterval !== null) { clearInterval(_surfaceTimerInterval); _surfaceTimerInterval = null; }
    cancelInlineBtn.classList.add('hidden');
  }

  /** Resolve a run's `api.surface.*` chain. Mutates `result` in place so the
   *  downstream wiring sees the final mesh:
   *   - cache hit → swap in the textured mesh (drop the stale base Manifold so
   *     the run handler reconstructs from it). The memo key is the BASE MESH
   *     CONTENT (`meshContentKey`), so whitespace/comment/refactor edits that
   *     don't change geometry hit instantly and never drop the textures.
   *   - miss → compute the chain in the surface Worker (the UI thread stays
   *     free) behind an inline "Applying texture… Xs" status + the Cancel
   *     button, mirroring the "Rendering… Xs" pattern. EVERY run applies —
   *     explicit and live-typing alike; a newer run's compute supersedes an
   *     in-flight one (latest wins, like run generations).
   *   - Cancel (or a compute failure) keeps the base mesh and parks the chain
   *     behind the sticky "⟳ Re-apply" pill. */
  /** Mean triangle-edge length of a base mesh (sampled), used to size a label
   *  scope's catch radius so subdivided children — which sit within a parent
   *  face — are selected without bleeding onto neighbours. */
  function baseMeanEdge(mesh: MeshData): number {
    const { vertProperties: vp, triVerts: tv, numProp, numTri } = mesh;
    if (numTri === 0) return 1;
    const step = Math.max(1, Math.floor(numTri / 2000));
    const d = (i: number, j: number) => {
      const dx = vp[i] - vp[j], dy = vp[i + 1] - vp[j + 1], dz = vp[i + 2] - vp[j + 2];
      return Math.sqrt(dx * dx + dy * dy + dz * dz);
    };
    let total = 0, count = 0;
    for (let t = 0; t < numTri; t += step) {
      const a = tv[t * 3] * numProp, b = tv[t * 3 + 1] * numProp, c = tv[t * 3 + 2] * numProp;
      total += d(a, b) + d(b, c) + d(c, a);
      count += 3;
    }
    return count > 0 ? total / count : 1;
  }

  /** Resolve each scoped op (`label` / `point`) to seed centroids + a catch
   *  radius against the BASE mesh. Unscoped ops → null (whole-model texture).
   *  Returns undefined when no op is scoped, so the common path passes nothing.
   *  An unknown/empty label yields empty seeds → the op textures nothing rather
   *  than silently falling back to the whole model. */
  function resolveSurfaceScopes(
    ops: SurfaceOp[],
    base: MeshData,
    labelMap: Map<string, Set<number>> | null,
  ): (ResolvedScope | null)[] | undefined {
    if (!ops.some(o => o.scope)) return undefined;
    let meanEdge = -1;
    const { vertProperties: vp, triVerts: tv, numProp } = base;
    return ops.map((op): ResolvedScope | null => {
      const s = op.scope;
      if (!s) return null;
      if (s.kind === 'point') {
        return { seeds: Float32Array.of(s.point[0], s.point[1], s.point[2]), radius: s.radius };
      }
      const tris = labelMap?.get(s.label);
      if (!tris || tris.size === 0) return { seeds: new Float32Array(0), radius: 1 };
      if (meanEdge < 0) meanEdge = baseMeanEdge(base);
      const seeds = new Float32Array(tris.size * 3);
      let i = 0;
      for (const t of tris) {
        const a = tv[t * 3] * numProp, b = tv[t * 3 + 1] * numProp, c = tv[t * 3 + 2] * numProp;
        seeds[i++] = (vp[a] + vp[b] + vp[c]) / 3;
        seeds[i++] = (vp[a + 1] + vp[b + 1] + vp[c + 1]) / 3;
        seeds[i++] = (vp[a + 2] + vp[b + 2] + vp[c + 2]) / 3;
      }
      return { seeds, radius: Math.max(meanEdge * 1.1, 1e-3) };
    });
  }

  async function applySurfaceTextures(result: MeshResult, src: string): Promise<void> {
    // Each mesh-producing run re-establishes what (if any) applied texture the
    // live mesh carries; stale-by-default until a branch below applies one.
    lastAppliedSurface = null;
    const ops = result.surfaceOps;
    if (!ops || ops.length === 0 || !result.mesh) {
      hideSurfaceReapplyPill();
      return;
    }
    const base = result.mesh;
    const baseKey = meshContentKey(base);
    // The textured mesh has a denser/displaced tessellation, so the run's
    // labelMap (Set<baseTriIndex> per api.label name) no longer points at the
    // right triangles. Remap each label's set onto the textured mesh by spatial
    // proximity — the same nearest-centroid carry the bake path uses — so
    // api.label / byLabel colors survive texturing. Geometric paint descriptors
    // (box/slab/cylinder) and brush strokes re-resolve by shape downstream and
    // need no remap.
    const carryLabels = (textured: MeshData): void => {
      if (result.labelMap && result.labelMap.size > 0) {
        result.labelMap = remapTriangleSets(result.labelMap, base, textured);
      }
    };
    const status = surfaceCacheStatus(baseKey, ops);
    if (status.cached && status.mesh) {
      // These displaced meshes round-trip through Manifold.ofMesh like the bake
      // path; clearing manifold makes the run handler rebuild from the textured
      // mesh (and fall back to render-only if it isn't watertight).
      result.mesh = status.mesh;
      result.manifold = null;
      carryLabels(status.mesh);
      lastAppliedSurface = { key: surfaceChainKey(baseKey, ops)!, mesh: status.mesh };
      hideSurfaceReapplyPill();
      return;
    }
    // Resolve any label/point scopes to seed points + radius against the BASE
    // mesh (before carryLabels rewrites result.labelMap to textured indices).
    const resolvedScopes = resolveSurfaceScopes(ops, base, result.labelMap ?? null);
    const label = ops.length > 1 ? `Applying ${ops.length} textures...` : 'Applying texture...';
    const timer = startSurfaceTimer(label);
    try {
      const textured = await computeChain(base, baseKey, ops, (f) => {
        if (ops.length > 1) _surfaceProgressNote = ` ${Math.min(Math.round(f * ops.length), ops.length)}/${ops.length}`;
      }, resolvedScopes);
      result.mesh = textured;
      result.manifold = null;
      carryLabels(textured);
      lastAppliedSurface = { key: surfaceChainKey(baseKey, ops)!, mesh: textured };
      hideSurfaceReapplyPill();
    } catch (e) {
      if (e instanceof SurfaceComputeCancelled) {
        // Superseded by a newer run's compute: that run owns the UI now — stay
        // quiet (runCodeSync's generation check discards this stale result).
        if (surfaceComputeInFlight()) return;
        // The user pressed Cancel: keep the base mesh, park the chain.
        parkSurfaceChain({ base, ops, baseKey, src }, stalePillText(ops.length));
        return;
      }
      // Compute failed — keep the base mesh and raise the pill so the user can
      // retry; surface the reason in the log.
      const msg = e instanceof Error ? e.message : String(e);
      showToast(`Surface texture failed: ${msg}`, { variant: 'warn', source: 'app' });
      parkSurfaceChain({ base, ops, baseKey, src }, '⟳ Texture failed — Re-apply');
    } finally {
      stopSurfaceTimer(timer);
    }
  }

  /** The Re-apply pill's click handler: compute the parked chain by re-running
   *  the exact same source — every run now applies its chain, so the re-run
   *  recomputes (or cache-hits) and clears the pill. Console agents reach the
   *  same recovery via `ensureSurfaceTexturesApplied()` (the Surface panel
   *  awaits it before previews); `run()`/`runAndSave()` apply inline anyway. */
  async function reapplySurfaceTextures(): Promise<boolean> {
    if (!pendingSurface || surfaceReapplyBusy) return false;
    surfaceReapplyBusy = true;
    const { src } = pendingSurface;
    try {
      return await runCodeSync(src, { preserveCamera: true });
    } finally {
      surfaceReapplyBusy = false;
    }
  }

  function runCode(code?: string, opts: { surfaceErrors?: boolean; preserveCamera?: boolean } = {}) {
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
      // runCode is the interactive entry point (editor auto-run, Run button,
      // command palette, quality/param changes), so it preserves the user's
      // current camera angle by default — re-rendering edited code shouldn't
      // snap the view back to the default 3/4 framing. The same-session gate in
      // captureCameraToPreserve still auto-frames the first render of a session
      // (e.g. seedStarter() on a freshly-created session). Programmatic
      // runs (partwright.run/runAndSave) call runCodeSync directly and keep
      // auto-framing. A caller can opt out with preserveCamera: false.
      await runCodeSync(src, { preserveCamera: true, ...opts });
      // If we still own the generation slot and the run is done, clear it.
      if (_rafOwnedGeneration === myRafGen) _rafOwnedGeneration = -1;
    });
  }

  // Start the elapsed-time display for a render. The cancel button and timer
  // are delayed 400 ms so fast runs (manifold-js is typically < 100 ms) never
  // flash them. stopRunTimer() always cancels the pending show before it fires.
  // NOTE: the Cancel button's click handler is attached *early* (right after the
  // layout is built, before the initial syncEditorFromURL render) — see the
  // `cancelInlineBtn.addEventListener` near the fast-preview pill setup. Attaching
  // it here instead left the button dead for the entire first render of a slow
  // deep-linked model (catalog SDF figures especially), because main() awaits
  // that render before ever reaching this line.

  function startRunTimer(t0: number): void {
    _runTimerStart = t0;
    stopRunTimer();
    _runShowTimer = window.setTimeout(() => {
      _runShowTimer = null;
      setRunState(true, performance.now() - _runTimerStart);
      setQualityRenderState(true);
      cancelInlineBtn.classList.remove('hidden');
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
    setQualityRenderState(false);
    cancelInlineBtn.classList.add('hidden');
  }

  function showFastPreviewPill(): void {
    _showingFastPreview = true;
    if (fastPreviewPillEl) fastPreviewPillEl.style.display = '';
  }
  function hideFastPreviewPill(): void {
    _showingFastPreview = false;
    if (fastPreviewPillEl) fastPreviewPillEl.style.display = 'none';
  }

  async function runCodeSync(src: string, opts: { surfaceErrors?: boolean; preserveCamera?: boolean; skipSurface?: boolean } = {}): Promise<boolean> {
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

    // Snapshot the camera to restore *before* the engine runs, not after, when
    // this is a re-render of an already-framed session (opts.preserveCamera:
    // version switch, live edit, Customizer change, quality change). The SCAD
    // path renders progressively — onScadPreview below calls updateMesh mid-run,
    // which auto-frames; capturing afterwards would record that reset pose and
    // "preserve" the default framing instead of the user's angle (the Customizer
    // reset bug on parametric SCAD models). captureCameraToPreserve returns null
    // on a session's first render, so a genuinely new model still auto-frames.
    const preservedCameraPose = opts.preserveCamera ? captureCameraToPreserve() : null;

    // Progressive-render preview callback: receives the fast coarse-pass mesh and
    // updates the viewport immediately so the user sees geometry while the full
    // render finishes. Used by two engines: SCAD's two-phase compile, and the
    // manifold-js SDF coarse pass (figures). Skip its auto-frame while preserving
    // the camera, so the mid-run preview doesn't momentarily snap to the default
    // view before the final restore lands. For SDF, raise the "⚡ Fast preview"
    // pill so the user knows the rough mesh will be replaced.
    const previewLang = getActiveLanguage();
    const onEnginePreview = (previewLang === 'scad' || previewLang === 'manifold-js')
      ? (previewResult: MeshResult) => {
          if (myGen !== _runGeneration || !previewResult.mesh) return;
          // currentMeshData stays the raw (uncoloured) coarse mesh — the model
          // colours live only on the copy handed to updateMesh, mirroring the
          // full-render path where currentMeshData is also the uncoloured base.
          currentMeshData = previewResult.mesh;
          // Estimate the model's colours on the coarse mesh: the in-code
          // underlay (api.label({color}) + api.paint.*) plus the user's saved
          // paint regions that re-resolve geometrically (byLabel / box / slab /
          // cylinder) — so a painted catalog figure shows colour instead of bare
          // grey. All resolve against this preview result's own mesh + labelMap
          // (no global state touched). Brush strokes and detail-region labels
          // (eyes, etc.) can't map onto the coarse mesh — they fill in with the
          // full render.
          const colouredPreview = colorCoarsePreview(previewResult);
          updateMesh(colouredPreview, { skipAutoFrame: preservedCameraPose !== null });
          if (previewLang === 'manifold-js') showFastPreviewPill();
        }
      : undefined;

    // Feed the Customizer's current overrides into the model's api.params(...).
    let result: Awaited<ReturnType<typeof executeCodeAsync>>;
    try {
      result = await executeCodeAsync(src, undefined, currentParamValues, onEnginePreview);
    } catch (err) {
      // Worker was terminated (cancelled by user, cancelled for a newer run,
      // timeout, or crash). Only clean up if we're still the active run —
      // a newer run already owns _running and the timer when myGen differs.
      if (myGen !== _runGeneration) return false;
      _running = false;
      stopRunTimer();
      hideFastPreviewPill();
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
    // The full-quality mesh is in hand — the coarse preview (if any) is about to
    // be replaced, so drop the pill.
    hideFastPreviewPill();

    // Record the engine WASM heap high-water for this run (undefined for non
    // manifold-js engines, which own separate heaps). Surfaced in the Data panel
    // and engine-error log so users can see how close a run came to the ceiling.
    lastEngineHeapBytes = result.engineHeapBytes;
    // Occupied-voxel count for voxel runs (undefined for other engines, which
    // resets the readout so a prior voxel session's count doesn't linger).
    lastVoxelCount = result.voxelCount;
    lastVoxelPieceCount = result.voxelPieceCount;

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
      hideSurfaceReapplyPill();
      lastDisconnectedWarning = null;
      geometryDataEl.textContent = JSON.stringify({
        status: 'error',
        error: result.error,
        diagnostics,
        executionTimeMs: elapsed,
        codeHash: simpleHash(src),
        ...(lastEngineHeapBytes !== undefined ? { engineMemory: formatEngineMemory(lastEngineHeapBytes) } : {}),
      });
      if (surfaceErrors) {
        // Explicit run: record + show + log + jump to the first diagnostic now.
        recordError(result.error);
        // Engine errors carry no JS stack (the fault is inside the WASM kernel,
        // off-thread), so attach the diagnostics + run metadata as the log detail
        // — otherwise the diagnostics panel shows "No stack trace or origin
        // captured" for what is often a memory/complexity fault worth context.
        const engineDetail = [
          `language: ${getActiveLanguage()}`,
          `executionTimeMs: ${elapsed}`,
          ...(lastEngineHeapBytes !== undefined ? [`WASM heap: ${formatEngineMemory(lastEngineHeapBytes)}`] : []),
          ...diagnostics.map(d => `${d.severity ?? 'error'} (${d.source ?? 'engine'}): ${d.message}`),
        ].join('\n');
        errorLog.capture({ level: 'error', source: 'engine', message: result.error, detail: engineDetail });
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
      // === Surface textures declared in code (api.surface.*) ===
      // The geometry Worker recorded an op chain but didn't touch the mesh.
      // Apply it here — memoized (keyed on the base mesh content, so no-op
      // edits hit instantly) and computed in the surface Worker on a miss,
      // behind an inline "Applying texture… Xs" timer + Cancel. The textured
      // mesh is swapped in so all the downstream wiring (manifold
      // reconstruction, paint resolution, stats) sees final geometry.
      // skipSurface: skip during thumbnail-regeneration imports so the
      // heavy surface computation doesn't hang the import flow.
      if (!opts.skipSurface) await applySurfaceTextures(result, src);
      // A compute can take seconds; if a newer run started meanwhile, abandon
      // this one rather than stamping a stale mesh over the new render.
      if (myGen !== _runGeneration) return false;
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
      const modelColorDecls: { name: string; color: [number, number, number]; triangles: Set<number>; descriptor?: RegionDescriptor; perTriColors?: Map<number, [number, number, number]> }[] = [];
      if (result.labelColors && currentLabelMap) {
        for (const [name, color] of result.labelColors) {
          const triangles = currentLabelMap.get(name);
          if (triangles && triangles.size > 0) modelColorDecls.push({ name, color, triangles });
        }
      }
      // Paint declared in code via api.paint.* (box / slab / cylinder / label).
      // Resolve each descriptor against this run's mesh — exactly like a user
      // paint region, but fed into the model underlay so it stays derived from
      // code and is never serialized to the paint sidecar. byLabel reads the
      // labelMap captured just above; the geometric selectors need only the mesh
      // (adjacency built lazily for the rare descriptor kind that wants it).
      if (result.paintOps && result.paintOps.length > 0) {
        const mesh = result.mesh;
        let paintAdjacency: AdjacencyGraph | null = null;
        for (const op of result.paintOps) {
          const d = op.descriptor as RegionDescriptor;
          if (!paintAdjacency && (d.kind === 'coplanar' || d.kind === 'connectedFromSeed' || d.kind === 'colorFlood')) {
            paintAdjacency = buildAdjacency(mesh);
          }
          const { triangles, perTriColors } = resolveDescriptorTriangles(d, mesh, paintAdjacency, null);
          if (triangles.size > 0) modelColorDecls.push({ name: op.name, color: op.color, triangles, descriptor: d, perTriColors });
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
      //
      // preservedCameraPose was snapshotted at the top of runCodeSync (before
      // the engine ran), so the auto-framing updateMesh calls below — and the
      // SCAD progressive preview — don't poison the pose we restore at the end.
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
          if (!adjacency && (d.kind === 'coplanar' || d.kind === 'connectedFromSeed' || d.kind === 'colorFlood')) {
            adjacency = buildAdjacency(mesh);
          }
          const { triangles, perTriColors } = resolveDescriptorTriangles(d, mesh, adjacency, null, region.id);
          setRegionTriangles(region.id, triangles, perTriColors);
        }
        const displayMesh = applyTriColorsIfVisible(mesh);
        updateMesh(displayMesh);
        updatePaintMesh(mesh);
      } else {
        updateMesh(result.mesh);
        updatePaintMesh(result.mesh); // always pass uncolored mesh for adjacency
      }
      // Put the camera back where the user had it (no-op on a session's first
      // render, where captureCameraToPreserve returned null and we auto-frame).
      if (preservedCameraPose) setCameraPose(preservedCameraPose);

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
      // Record the session this freshly-framed geometry belongs to, so the next
      // version switch within it preserves the user's camera angle (see
      // loadVersionIntoEditor). A fresh compile auto-frames, which is the
      // baseline we want each new session to start from.
      lastFramedSessionId = getState().session?.id ?? null;
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
        closePrintToolsMenu();
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
      if (isPrintToolsOpen()) { closePrintToolsMenu(); closed = true; }
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

  function initLightToggle(container: HTMLElement) {
    const lightBtn = container.querySelector('#light-toggle') as HTMLButtonElement;
    if (!lightBtn) return;

    const inactiveClass = 'px-2 py-1 rounded text-xs bg-zinc-800/80 backdrop-blur text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700/80 transition-colors border border-zinc-600/50';
    const activeClass = 'px-2 py-1 rounded text-xs bg-amber-500/20 backdrop-blur text-amber-400 hover:bg-amber-500/30 transition-colors border border-amber-500/30';

    const reflect = (on: boolean) => {
      lightBtn.className = on ? activeClass : inactiveClass;
      lightBtn.title = on ? 'Turn off studio lighting (reflections + soft shadow)' : 'Turn on studio lighting (reflections + soft shadow)';
    };
    reflect(isStudioLighting());
    onStudioLightingChange(reflect);

    lightBtn.addEventListener('click', () => { setStudioLighting(!isStudioLighting()); });
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

  function initResetViewButton(container: HTMLElement) {
    const resetBtn = container.querySelector('#reset-view') as HTMLButtonElement;
    if (!resetBtn) return;
    resetBtn.addEventListener('click', () => { resetView(); });
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
  // Keep the indicator click-transparent — `setStatus` overwrites the className
  // so the original `pointer-events-none` from layout.ts would otherwise be
  // lost, letting it intercept clicks on what it overlaps. Restore the chip
  // background/border too (also dropped on overwrite). The status row is an
  // absolute, shrink-to-fit flex strip, so cap the width with a viewport-
  // relative `max-w` (a percentage would resolve against this very element's
  // shrink-to-fit parent and collapse "Ready" to "R…"); `truncate` still
  // ellipsizes long error messages.
  el.className = 'text-xs font-mono max-w-[55vw] truncate pointer-events-none bg-zinc-900/70 px-2 py-0.5 rounded border border-zinc-700 ';
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

main().catch(console.error);
