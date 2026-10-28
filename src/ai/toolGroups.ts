// On-demand tool groups (#1175). The full tool list is ~66K tokens of JSON
// schema, more than ai.md itself, and every hosted request carried all of it
// from turn 0. Instead the model starts with CORE_TOOLS and loads the rest in
// named groups: by calling `loadTools`, or by reading a topic doc (readDoc
// "colors" loads `paint`). `buildToolList` gating stays the permission check —
// this module only decides which schemas are SENT — so a grouped tool the
// model calls without loading still runs where the provider lets the call
// through. That is only a safety net: Gemini and constrained local backends
// reject a call to an undeclared tool (malformed_function_call; chatLoop
// nudges the model to loadTools), so the prompt says load first. Loaded groups are derived from the chat
// history, so they are sticky for the conversation with no stored state, and
// survive reloads, Worker hand-offs and other tabs.
//
// Pure module (no DOM, no window.partwright) so it runs in the agent Worker
// and the unit tier.

import type { ChatMessage } from './types';
import { LEGACY_TOOL_ALIASES } from './tools';

export const LOAD_TOOLS_TOOL = 'loadTools';

/** Always sent (subject to the usual toggle gating): write code, run it, look
 *  at it, keep the session, label-driven paint, and the turn-control tools. */
export const CORE_TOOLS: readonly string[] = [
  'getActiveLanguage', 'setActiveLanguage', 'getCode', 'setCode', 'getParams', 'setParams',
  'runCode', 'runAndSave', 'runAndAssert', 'runAndExplain', 'modifyAndTest', 'runIsolated',
  'getGeometryData', 'query', 'listComponents', 'listLabels',
  'getSessionContext', 'listVersions', 'loadVersion', 'saveVersion', 'forkVersion', 'readDoc',
  'renderView', 'renderViews', 'getAttachments', 'getReferenceImages', 'listAnnotations',
  'listObjects', 'getCurrentObject', 'createObject', 'changeObject', 'listObjectParts',
  'paintByLabel', 'paintByLabels', 'paintComponent', 'paintConnected', 'paintPreview',
  'listRegions', 'removeRegion', 'undoLastPaint', 'reassignPaint',
  'checkPrintability', 'exportModel', 'setCamera',
  'addSessionNote', 'listSessionNotes', 'updateSessionNote', 'deleteSessionNote',
  'finish', 'askUser', 'proposePlan',
];

export interface ToolGroup {
  id: string;
  /** One line for the loadTools catalogue. */
  summary: string;
  tools: readonly string[];
}

/** Every tool outside CORE_TOOLS belongs to exactly one group (enforced by
 *  tests/unit/toolGroups.test.ts). A new tool must be placed here — core only
 *  when nearly every chat needs it. Order is the order groups are appended to
 *  the request, so keep it stable. */
export const TOOL_GROUPS: readonly ToolGroup[] = [
  {
    id: 'paint',
    summary: 'more paint verbs (box/slab/cylinder/near/stroke/image/pattern/airbrush), paint diagnostics, palette and region edits',
    tools: [
      'paintRegion', 'paintFaces', 'paintAlongBoundary', 'paintNear', 'paintStroke', 'paintImage',
      'paintInBox', 'paintInOrientedBox', 'paintSlab', 'paintPattern', 'paintNearestRegion',
      'paintInCylinder', 'paintAirbrush', 'paintExplain', 'assertPaint', 'getPartTriangles',
      'partBoundary', 'getModelColors', 'redoLastPaint', 'editRegion', 'clearColors',
      'undoClearColors', 'copyColorsFromVersion', 'editPalette', 'replaceColor',
      'setRegionVisibility', 'getPalette', 'setObjectPartColor', 'bakeObjectPartColor',
    ],
  },
  {
    id: 'inspect',
    summary: 'mesh probing and measurement: findFaces, probeRay/probePixel, slices and sections, measurements, photoMatch, fitment ghost',
    tools: [
      'getMeshSummary', 'findFaces', 'probePixel', 'probePixels', 'probeRay', 'getFeatureCentroids',
      'sliceAtZVisual', 'renderSection', 'getMeasurement', 'photoMatch', 'getViewState',
      'setReferenceGeometry', 'clearReferenceGeometry',
    ],
  },
  {
    id: 'objects',
    summary: 'manage objects, parts and pieces: rename, delete/restore, hide/isolate, extract, merge, reorder, group, arrange parts, export split items',
    tools: [
      'renameObject', 'deleteObject', 'listDeleted', 'restoreObject', 'highlightObjectPart',
      'setObjectPartHidden', 'deleteObjectPart', 'restoreObjectPart', 'frameObjectPart',
      'isolateObjectPart', 'getObjectPartInfo', 'renameObjectPart', 'extractObjectPiece',
      'extractObjectParts', 'mergeObjects', 'reorderObjects', 'saveAllObjects', 'setObjectGroup',
      'partAction', 'undoPartEdit', 'listExportItems',
    ],
  },
  {
    id: 'transforms',
    summary: 'bake a transform into the model: scale, place, rotate, lay flat, mirror, simplify, heal',
    tools: ['scaleModel', 'placeModel', 'rotateModel', 'layFlatModel', 'mirrorModel', 'simplifyModel', 'healCurrent'],
  },
  {
    id: 'textures',
    summary: 'surface textures and bake-only modifiers: applySurfaceTexture, voronoi lamp, engrave/emboss, voxelize',
    tools: ['applySurfaceTexture', 'applyVoronoiLamp', 'engraveModel', 'voxelizeModel'],
  },
  {
    id: 'character',
    summary: 'the buildCharacter humanoid figure builder and its presets',
    tools: ['buildCharacter', 'getCharacterSpec', 'listCharacterPresets', 'randomCharacter'],
  },
  {
    id: 'parts',
    summary: 'part detection on imported meshes: detect, edit, preview, accept named parts',
    tools: [
      'listPartDetectors', 'detectParts', 'autoDetectParts', 'reopenParts', 'previewPartPresets',
      'applyPartPreset', 'setPartSelection', 'setPartsView', 'partAt', 'previewSeeds',
      'openPartsPanel', 'getPartDraft', 'editParts', 'renderParts', 'comparePartDetectors',
      'setPartsOverlay', 'acceptParts', 'discardParts',
    ],
  },
  {
    id: 'import',
    summary: 'imports and reconstruction: URL import, image/SVG relief, image→voxels, convert a mesh to code, score a remake',
    tools: [
      'importFromUrl', 'importImageAsRelief', 'importSvgAsRelief', 'getReliefSwapGuide',
      'setReliefPreviewMode', 'importImageAsVoxels', 'convertToCode', 'evalAgainstImport',
    ],
  },
  {
    id: 'printing',
    summary: 'printer settings, model units, and the wall-thickness map',
    tools: ['getPrinterSettings', 'setPrinterSettings', 'getUnits', 'setUnits', 'thicknessMap'],
  },
  {
    id: 'versions',
    summary: 'compare, rename and delete saved versions',
    tools: ['diffVersions', 'renameVersion', 'deleteVersion'],
  },
  {
    id: 'ui',
    summary: 'open a prefilled tool panel for the user and read back what they changed',
    tools: ['openTool', 'closeTool', 'getUiState'],
  },
  {
    id: 'app',
    summary: 'app settings, curve quality, diagnostic log, catalog and session lists',
    tools: ['getAppConfig', 'setAppConfig', 'getCurvatureQuality', 'setCurvatureQuality', 'getDiagnosticLog', 'listCatalog', 'listSessions'],
  },
];

export const TOOL_GROUP_IDS: readonly string[] = TOOL_GROUPS.map(g => g.id);

/** readDoc topics that load a group: the doc teaches the tools, so they
 *  arrive together. */
export const DOC_TOOL_GROUPS: Readonly<Record<string, readonly string[]>> = {
  // colors' vision loop finds paint targets with findFaces / probeRay / getMeshSummary.
  colors: ['paint', 'inspect'],
  'reference-images': ['inspect'],
  'visual-verification': ['inspect'],
  textures: ['textures'],
  figure: ['character'],
  segmentation: ['parts'],
  relief: ['import'],
  reconstruction: ['import'],
  'file-io': ['import'],
  // printing teaches orienting the part: layFlat / rotate / place / scale / mirror.
  printing: ['printing', 'transforms'],
  'iteration-workflow': ['versions'],
  'ui-control': ['ui'],
};

const GROUP_OF_TOOL: ReadonlyMap<string, string> = new Map(
  TOOL_GROUPS.flatMap(g => g.tools.map(t => [t, g.id] as [string, string])),
);

export function toolGroupOf(name: string): string | undefined {
  return GROUP_OF_TOOL.get(name);
}

/** Groups the conversation has already pulled in: explicit loadTools calls,
 *  readDoc topics, and any grouped tool the model called. `preload` adds
 *  groups implied by the session state (see sessionToolGroups in aiPanel).
 *  A call that was refused (not offered — e.g. made while planning) or a
 *  loadTools call that errored loads nothing. */
export function loadedToolGroups(history: readonly ChatMessage[], preload: readonly string[] = []): Set<string> {
  const loaded = new Set<string>();
  const add = (id: unknown) => { if (typeof id === 'string' && TOOL_GROUP_IDS.includes(id)) loaded.add(id); };
  for (const id of preload) add(id);
  for (let i = 0; i < history.length; i++) {
    const m = history[i];
    if (!m.toolCalls) continue;
    // Results answer the calls in the next message. Pair by position, falling
    // back to id: some providers reuse call ids across turns.
    const results = history[i + 1]?.toolResults;
    for (let j = 0; j < m.toolCalls.length; j++) {
      const tc = m.toolCalls[j];
      const r = results?.[j]?.toolUseId === tc.id ? results[j] : results?.find(x => x.toolUseId === tc.id);
      if (r?.isError && (tc.name === LOAD_TOOLS_TOOL || r.content.startsWith('[Not run'))) continue;
      if (tc.name === LOAD_TOOLS_TOOL) {
        const groups = (tc.input as { groups?: unknown }).groups;
        if (Array.isArray(groups)) groups.forEach(add);
      } else if (tc.name === 'readDoc') {
        const name = (tc.input as { name?: unknown }).name;
        if (typeof name === 'string') (DOC_TOOL_GROUPS[name] ?? []).forEach(add);
      } else {
        add(GROUP_OF_TOOL.get(LEGACY_TOOL_ALIASES[tc.name] ?? tc.name));
      }
    }
  }
  return loaded;
}

interface NamedTool { name: string }

/** The schemas to send: core tools in their gated order, then loadTools, then
 *  each loaded group in TOOL_GROUPS order. Appending keeps the core prefix
 *  identical across group loads. Tools absent from `gated` (toggled off,
 *  plan mode) stay absent — this only ever narrows. */
export function selectOfferedTools<T extends NamedTool>(gated: readonly T[], loaded: ReadonlySet<string>, loadTool: T): T[] {
  const core = new Set(CORE_TOOLS);
  const byName = new Map(gated.map(t => [t.name, t]));
  const out = gated.filter(t => core.has(t.name) || !GROUP_OF_TOOL.has(t.name));
  out.push(loadTool);
  for (const g of TOOL_GROUPS) {
    if (!loaded.has(g.id)) continue;
    for (const name of g.tools) {
      const t = byName.get(name);
      if (t) out.push(t);
    }
  }
  return out;
}

/** Groups with at least one tool the current gates allow. */
function availableGroups(gatedNames: ReadonlySet<string>): ToolGroup[] {
  return TOOL_GROUPS.filter(g => g.tools.some(t => gatedNames.has(t)));
}

/** The loadTools definition. Static (lists every group) so it caches with the
 *  rest of the tool prefix; a group whose tools are all switched off answers
 *  with that instead of loading. */
export function loadToolsDefinition(): { name: string; description: string; input_schema: { type: 'object'; properties: Record<string, unknown>; required: string[] } } {
  const lines = TOOL_GROUPS.map(g => `• ${g.id}: ${g.summary}. Tools: ${g.tools.join(', ')}`);
  return {
    name: LOAD_TOOLS_TOOL,
    description:
      'Load more tools. You start with the core set; the rest come in the groups below. A loaded group\'s full schemas are attached from your next step on, for the rest of this chat. '
      + `readDoc of a topic loads its group too (${docGroupSummary()}). `
      + 'Load a tool\'s group BEFORE calling it — a call to a tool not in your list can fail outright. Load only what the task needs.\n'
      + lines.join('\n'),
    input_schema: {
      type: 'object',
      properties: {
        groups: {
          type: 'array',
          items: { type: 'string', enum: [...TOOL_GROUP_IDS] },
          description: 'Group ids to load.',
        },
      },
      required: ['groups'],
    },
  };
}

/** "colors → paint + inspect, …", derived from DOC_TOOL_GROUPS so the
 *  loadTools description can't drift from the map. */
function docGroupSummary(): string {
  return Object.entries(DOC_TOOL_GROUPS).map(([doc, gs]) => `${doc} → ${gs.join(' + ')}`).join(', ');
}

/** Result text for a loadTools call. `gatedNames` is this turn's permitted
 *  tool set, so the reply names only tools the model can actually use. */
export function loadToolsResult(input: Record<string, unknown>, gatedNames: ReadonlySet<string>): { content: string; isError: boolean } {
  const groups = input.groups;
  if (!Array.isArray(groups) || groups.length === 0) {
    return { content: JSON.stringify({ error: `loadTools: pass groups, an array of group ids (${TOOL_GROUP_IDS.join(', ')}).` }), isError: true };
  }
  // Unknown ids are reported but don't sink the valid ones: loadedToolGroups
  // reads the call back from the history and loads every valid id it names,
  // so an error result here would contradict what actually gets attached.
  const isGroup = (g: unknown): g is string => typeof g === 'string' && TOOL_GROUP_IDS.includes(g);
  const unknown = groups.filter(g => !isGroup(g));
  const valid = groups.filter(isGroup);
  const unknownNote = unknown.length > 0 ? `unknown group(s) ${unknown.map(g => JSON.stringify(g)).join(', ')}. Groups: ${TOOL_GROUP_IDS.join(', ')}.` : '';
  if (valid.length === 0) {
    return { content: JSON.stringify({ error: `loadTools: ${unknownNote}` }), isError: true };
  }
  const loaded: Record<string, string[]> = {};
  const unavailable: string[] = [];
  for (const id of valid) {
    const g = TOOL_GROUPS.find(x => x.id === id)!;
    const names = g.tools.filter(t => gatedNames.has(t));
    if (names.length > 0) loaded[id] = names;
    else unavailable.push(id);
  }
  return {
    content: JSON.stringify({
      loaded,
      ...(unavailable.length > 0 ? { unavailable: `${unavailable.join(', ')}: switched off in this chat's settings` } : {}),
      ...(unknownNote ? { ignored: unknownNote } : {}),
      note: 'Their schemas are attached from your next step on.',
    }),
    isError: false,
  };
}

/** Per-turn suffix line: which groups are loaded and which can be. Empty
 *  when nothing is left to load. */
export function toolGroupsSuffix(loaded: ReadonlySet<string>, gatedNames: ReadonlySet<string>): string {
  const avail = availableGroups(gatedNames);
  const pending = avail.filter(g => !loaded.has(g.id)).map(g => g.id);
  if (pending.length === 0) return '';
  const have = avail.filter(g => loaded.has(g.id)).map(g => g.id);
  return `Tool groups — loaded: core${have.length ? ', ' + have.join(', ') : ''}. Not loaded yet: ${pending.join(', ')} (see loadTools). If ai.md or a doc names a tool you don't have, load its group with loadTools before calling it.`;
}
