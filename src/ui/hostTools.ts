// Tools whose opener lives in main.ts state (the clip plane, the Customizer,
// the export / publish dialogs, the relief + image→voxel import wizards),
// registered into the tool registry through a small dependency object so the
// logic stays out of main.ts. Same contract as every other ToolSpec: openers
// only STAGE values (never export / import / save), every key is validated
// before anything opens, and the user confirms in the dialog.

import { registerTool, checkRange, type PrefillSchema, type ToolOpenContext, type ToolOpenResult } from './toolRegistry';
import { checkParamOverrides, type ParamSpec, type ParamValues } from '../geometry/params';
import { getConfig } from '../config/appConfig';
import {
  stageExportPartsPrefill, clearExportPartsPrefill, isExportPartsOpen, getExportPartsState, closeExportPartsModal,
} from './exportPartsModal';
import {
  EXPORT_SESSION_FLAGS, stageExportOptionsPrefill, clearExportOptionsPrefill, isExportOptionsOpen, getExportOptionsState, closeExportOptionsDialog,
} from './exportOptionsDialog';
import {
  checkPublishPrefill, stagePublishPrefill, clearPublishPrefill, isPublishModalOpen, getPublishModalState, closePublishModal,
} from './publishModal';
import { isReliefImportOpen, getReliefImportState, closeReliefImport, type ReliefStagedOptions } from './reliefImportModal';
import { isImageVoxelImportOpen, getImageVoxelImportState, closeImageVoxelImport } from './imageVoxelImportModal';
import { resolvePrefillImageSrc, loadPrefillImageBlob, prefillImageFile, blobToImageData, PREFILL_IMAGE_SRC_MAX } from './prefillImage';
import type { ImageToVoxelOptions } from '../import/imageToVoxel';

export type ExportObjectsFormat = '3mf-bambu' | '3mf' | 'stl' | 'obj' | 'glb';

export interface HostToolDeps {
  /** A transient message (used for notes on tools with no panel). */
  toast(message: string): void;
  clip: {
    get(): { enabled: boolean; z: number; min: number; max: number };
    setEnabled(on: boolean): void;
    setZ(z: number): void;
  };
  params: {
    schema(): ParamSpec[] | null;
    /** The resolved values the panel shows. */
    values(): ParamValues;
    isOpen(): boolean;
    open(): void;
    close(): void;
    setNote(note: string | null | undefined, source?: ToolOpenContext['source']): void;
    /** Set overrides and re-run — exactly what dragging the sliders does. */
    stage(values: ParamValues): void;
  };
  exports: {
    /** Model on screen and not a read-only shared preview. */
    canExport(): boolean;
    objectCount(): number;
    /** The session's objects (for validating `objects` up front). */
    objects(): { id: string; name: string }[];
    /** The Bambu picker's choices (printer ids, nozzle strings, filament ids). */
    bambuChoices(): { printers: string[]; nozzles: string[]; filaments: string[] };
    hasSession(): boolean;
    /** The toolbar export action for `format` (opens the object picker for a
     *  multi-object session; resolves when the flow ends). */
    runObjects(format: ExportObjectsFormat): Promise<void>;
    /** The toolbar "Export session" action (opens the options dialog). */
    runSession(): Promise<void>;
    /** The "Publish to a print site" action. */
    runPublish(platform?: string): Promise<void>;
  };
  imports: {
    /** Open the relief wizard with this file + staged options. */
    relief(file: File | undefined, staged: ReliefStagedOptions, note: string | undefined, source: ToolOpenContext['source']): void;
    /** Open the image→voxel modal (with this image when given) and finish the
     *  import if the user confirms. */
    imageVoxel(image: { file: File; imageData: ImageData } | null, options: ImageToVoxelOptions, note: string | undefined, source: ToolOpenContext['source']): Promise<unknown>;
  };
}

/** Wait for a staged dialog to open: resolves with its outcome, an error when
 *  the flow ended before the dialog showed, or — if something the user must
 *  answer first is up (a pre-export confirm) — the staged values after
 *  `ui.toolDialogOpenWaitMs`. */
async function awaitStagedDialog(
  staged: Promise<ToolOpenResult>,
  run: () => Promise<void>,
  clear: (reason: string) => void,
  pendingResult: ToolOpenResult,
): Promise<ToolOpenResult> {
  void run()
    .catch(() => { /* the action reports its own failures */ })
    .finally(() => clear('the export ended before its dialog opened (cancelled, or nothing to export)'));
  let timer: ReturnType<typeof setTimeout> | undefined;
  const wait = new Promise<ToolOpenResult>(resolve => {
    timer = setTimeout(() => resolve(pendingResult), getConfig().ui.toolDialogOpenWaitMs);
  });
  try {
    return await Promise.race([staged, wait]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/** Load a prefill `src` into a File + ImageData (download only). */
async function loadPrefillImage(src: string): Promise<{ file: File; imageData: ImageData; label: string } | { error: string }> {
  const resolved = resolvePrefillImageSrc(src);
  if ('error' in resolved) return resolved;
  try {
    const blob = await loadPrefillImageBlob(resolved);
    const file = prefillImageFile(blob, resolved.label);
    const imageData = /svg/i.test(blob.type) ? new ImageData(1, 1) : await blobToImageData(blob);
    return { file, imageData, label: resolved.label };
  } catch (e) {
    return { error: `src: ${e instanceof Error ? e.message : String(e)}` };
  }
}

const RELIEF_PREFILL_SCHEMA: PrefillSchema = {
  src: { type: 'string', maxLength: PREFILL_IMAGE_SRC_MAX, description: 'Image to load: a data:image/ URL, an http(s) URL (CORS-enabled host), or an image attachment id/label. Omit to open the picker empty.' },
  mode: { type: 'enum', values: ['quantized', 'luminance'], description: "'quantized' = flat colour tile (keychain), 'luminance' = relief / lithophane." },
  options: { type: 'object', description: 'Shared knobs.', fields: {
    widthMm: { type: 'number', min: 1, max: 2000 },
    layerHeight: { type: 'number', min: 0.02, max: 2 },
    baseThickness: { type: 'number', min: 0, max: 50 },
    maxHeight: { type: 'number', min: 0.1, max: 100 },
    resolution: { type: 'number', integer: true, min: 8, max: 512 },
    smoothing: { type: 'number', min: 0, max: 20 },
    removeBackground: { type: 'boolean' },
  } },
  luminance: { type: 'object', description: 'Relief / lithophane knobs.', fields: {
    invert: { type: 'boolean' },
    gamma: { type: 'number', min: 0.2, max: 3 },
    levels: { type: 'number', integer: true, min: 2, max: 32 },
  } },
  quantized: { type: 'object', description: 'Colour-tile knobs.', fields: {
    clusters: { type: 'number', integer: true, min: 2, max: 12 },
    colorSpace: { type: 'enum', values: ['rgb', 'lab'] },
    dither: { type: 'boolean' },
    output: { type: 'enum', values: ['flat', 'relief', 'silhouette'] },
    shape: { type: 'enum', values: ['rect', 'rounded', 'circle'] },
    cornerRadiusMm: { type: 'number', min: 0, max: 50 },
    chamferMm: { type: 'number', min: 0, max: 5 },
    paintingMode: { type: 'enum', values: ['multi-color', 'single-nozzle'] },
    invertHeights: { type: 'boolean' },
    doubleSided: { type: 'boolean' },
    backMirror: { type: 'boolean' },
  } },
  preprocess: { type: 'object', description: 'Image corrections.', fields: {
    brightness: { type: 'number', min: -1, max: 1 },
    contrast: { type: 'number', min: -1, max: 1 },
    saturation: { type: 'number', min: -1, max: 1 },
    levelsLow: { type: 'number', integer: true, min: 0, max: 254 },
    levelsHigh: { type: 'number', integer: true, min: 1, max: 255 },
  } },
  crop: { type: 'object', description: 'Crop as fractions 0..1 of the image (all four keys).', fields: {
    left: { type: 'number', min: 0, max: 1 }, top: { type: 'number', min: 0, max: 1 },
    right: { type: 'number', min: 0, max: 1 }, bottom: { type: 'number', min: 0, max: 1 },
  } },
};

const VOXEL_IMPORT_PREFILL_SCHEMA: PrefillSchema = {
  src: { type: 'string', maxLength: PREFILL_IMAGE_SRC_MAX, description: 'Image to load (data:image/ URL, http(s) URL, or image attachment id/label). Omit to open the picker empty.' },
  options: { type: 'object', description: 'Initial controls (as importImageAsVoxels opts).', fields: {
    maxSize: { type: 'number', integer: true, min: 1, max: 1024 },
    mode: { type: 'enum', values: ['billboard', 'heightmap'] },
    depth: { type: 'number', integer: true, min: 1 },
    maxHeight: { type: 'number', integer: true, min: 1 },
    baseThickness: { type: 'number', integer: true, min: 0 },
    invert: { type: 'boolean' },
    alphaThreshold: { type: 'number', integer: true, min: 0, max: 255 },
    colorMode: { type: 'enum', values: ['original', 'grayscale', 'flat'] },
    flatColor: { type: 'color', description: 'Flat-mode colour ([r,g,b] 0..1 or "#rrggbb").' },
    gamma: { type: 'number', min: 0.01 },
    brightness: { type: 'number', min: -1, max: 1 },
    contrast: { type: 'number', min: -1, max: 1 },
    saturation: { type: 'number', min: -1, max: 1 },
    posterizeColors: { type: 'number', integer: true, min: 0 },
    constrainToPalette: { type: 'boolean', description: 'Snap colours to the filament palette.' },
    removeBackground: { type: 'boolean' },
    codeStyle: { type: 'enum', values: ['decode', 'calls'] },
  } },
};

export function registerHostTools(deps: HostToolDeps): void {
  // ── Cross section (a viewport mode; the note is a toast) ─────────────────
  registerTool({
    id: 'tool-cross-section',
    title: 'Cross section',
    hint: 'Inspect',
    overlay: true,
    prefillSchema: {
      z: { type: 'number', description: "Clip-plane height (world Z), within the model's Z range. Only a horizontal (Z) plane is supported." },
    },
    open: (prefill, ctx) => {
      const z = prefill?.z as number | undefined;
      const st = deps.clip.get();
      const errors: string[] = [];
      if (z !== undefined && !checkRange('z', z, st.min, st.max, errors)) return { error: errors.join('; ') };
      if (!st.enabled) deps.clip.setEnabled(true);
      if (z !== undefined) deps.clip.setZ(z);
      if (ctx.note) deps.toast(`Suggested by AI: ${ctx.note}`);
      return { applied: z !== undefined ? { z } : {}, ignored: [] };
    },
    getState: () => { const s = deps.clip.get(); return s.enabled ? { z: s.z } : null; },
    isOpen: () => deps.clip.get().enabled,
    close: () => { if (deps.clip.get().enabled) deps.clip.setEnabled(false); },
  });

  // ── Customizer (api.params sliders) ──────────────────────────────────────
  registerTool({
    id: 'tool-customize',
    title: 'Customize parameters',
    hint: 'Tools',
    prefillSchema: {
      values: { type: 'object', description: "Parameter values keyed like the model's api.params schema (as setParams; validated strictly — unknown keys / wrong types rejected). Moves the sliders, which re-runs the model like a drag; nothing is saved." },
    },
    enabled: () => (deps.params.schema()?.length ?? 0) > 0,
    open: (prefill, ctx) => {
      const schema = deps.params.schema();
      if (!schema || schema.length === 0) return { error: 'the current model declares no parameters (add api.params({...}) and run it)' };
      let staged: ParamValues | null = null;
      if (prefill?.values) {
        const r = checkParamOverrides(schema, prefill.values as Record<string, unknown>);
        if ('error' in r) return { error: `values: ${r.error}` };
        staged = r.values;
      }
      if (!deps.params.isOpen()) deps.params.open();
      deps.params.setNote(ctx.note, ctx.source);
      if (staged && Object.keys(staged).length) deps.params.stage(staged);
      return { applied: staged ? { values: staged } : {}, ignored: [] };
    },
    getState: () => (deps.params.isOpen() ? { values: deps.params.values() } : null),
    isOpen: () => deps.params.isOpen(),
    close: () => deps.params.close(),
  });

  // ── Export the session's objects (multi-object picker) ───────────────────
  registerTool({
    id: 'export-objects',
    title: 'Export objects (pick objects + printer settings)',
    hint: 'Export',
    prefillSchema: {
      format: { type: 'enum', values: ['3mf-bambu', '3mf', 'stl', 'obj', 'glb'], description: "Which export's object picker (default '3mf-bambu'). Non-Bambu formats need 2+ objects (a single object downloads directly)." },
      objects: { type: 'list', of: 'string', maxItems: 500, description: 'Objects to tick, by name or id (default: the current object).' },
      printer: { type: 'string', description: 'Bambu printer id (3mf-bambu).' },
      nozzle: { type: 'string', description: 'Nozzle diameter as a string, e.g. "0.4" (3mf-bambu).' },
      filament: { type: 'string', description: 'Filament type id (3mf-bambu).' },
      plateLayout: { type: 'enum', values: ['separate', 'grid', 'group'], description: 'Bambu plate layout.' },
      packStrategy: { type: 'enum', values: ['grid', 'horizontal', 'vertical'], description: '3MF packing.' },
    },
    enabled: () => deps.exports.canExport(),
    open: (prefill, ctx) => {
      const p = prefill ?? {};
      const format = (p.format as ExportObjectsFormat | undefined) ?? '3mf-bambu';
      if (!deps.exports.canExport()) return { error: 'nothing to export (no model on screen, or a read-only shared design)' };
      if (format !== '3mf-bambu' && deps.exports.objectCount() < 2) {
        return { error: `the ${format} export only shows an object picker for a session with 2+ objects (this one would download straight away) — use format "3mf-bambu", or runUiCommand("export-${format}") to export directly` };
      }
      if (isExportPartsOpen()) return { error: 'an export object picker is already open' };
      // Validate against the real objects / Bambu choices BEFORE starting the
      // export flow (a pre-export confirm can delay the picker past openTool's
      // return); the picker re-checks when it consumes the prefill.
      const errors: string[] = [];
      if (Array.isArray(p.objects)) {
        const objs = deps.exports.objects();
        if (p.objects.length === 0) errors.push('objects must name at least one object');
        for (const want of p.objects as string[]) {
          if (!objs.some(o => o.id === want || o.name.toLowerCase() === want.toLowerCase())) {
            errors.push(`objects: "${want}" is not an object of this session (objects: ${objs.map(o => `"${o.name}"`).join(', ')})`);
          }
        }
      }
      if (format === '3mf-bambu') {
        const c = deps.exports.bambuChoices();
        const check = (key: 'printer' | 'nozzle' | 'filament', allowed: string[]) => {
          if (p[key] !== undefined && !allowed.includes(p[key] as string)) errors.push(`${key} must be one of ${allowed.join(', ')}`);
        };
        check('printer', c.printers); check('nozzle', c.nozzles); check('filament', c.filaments);
      }
      if (errors.length) return { error: errors.join('; ') };
      const { format: _f, ...rest } = p;
      void _f;
      const staged = stageExportPartsPrefill({ ...(rest as Record<string, never>), note: ctx.note, source: ctx.source });
      return awaitStagedDialog(staged, () => deps.exports.runObjects(format), clearExportPartsPrefill, { applied: p, ignored: [] })
        .then(r => ('error' in r ? r : { ...r, applied: { format, ...r.applied } }));
    },
    getState: getExportPartsState,
    isOpen: isExportPartsOpen,
    close: closeExportPartsModal,
  });

  // ── Export session (.partwright.json options) ────────────────────────────
  const sessionSchema: PrefillSchema = {
    versions: { type: 'list', of: 'integer', maxItems: 10_000, description: 'Version indices to keep in the file (default: all).' },
  };
  for (const k of EXPORT_SESSION_FLAGS) sessionSchema[k] = { type: 'boolean' };
  registerTool({
    id: 'export-session',
    title: 'Export session (.partwright.json)',
    hint: 'Export',
    prefillSchema: sessionSchema,
    enabled: () => deps.exports.hasSession(),
    open: (prefill, ctx) => {
      if (!deps.exports.hasSession()) return { error: 'no active session to export — save a version first' };
      if (isExportOptionsOpen()) return { error: 'the session export dialog is already open' };
      const staged = stageExportOptionsPrefill({ ...(prefill ?? {}), note: ctx.note, source: ctx.source });
      return awaitStagedDialog(staged, deps.exports.runSession, clearExportOptionsPrefill, { applied: prefill ?? {}, ignored: [] });
    },
    getState: getExportOptionsState,
    isOpen: isExportOptionsOpen,
    close: closeExportOptionsDialog,
  });

  // ── Publish to a print site ──────────────────────────────────────────────
  registerTool({
    id: 'publish-model',
    title: 'Publish to a print site',
    hint: 'Share',
    prefillSchema: {
      platform: { type: 'enum', values: ['printables', 'makerworld', 'thingiverse', 'thangs'] },
      format: { type: 'enum', values: ['stl', '3mf', '3mf-bambu', 'glb', 'obj'], description: "File format (must be one the platform takes; default its recommended one)." },
      title: { type: 'string', maxLength: 200 },
      description: { type: 'string', maxLength: 5000 },
      tags: { type: 'list', of: 'string', maxItems: 30 },
      includeCover: { type: 'boolean', description: 'Include a cover PNG in the ZIP.' },
    },
    enabled: () => deps.exports.canExport(),
    open: (prefill, ctx) => {
      const p = (prefill ?? {}) as Parameters<typeof checkPublishPrefill>[0];
      const err = checkPublishPrefill(p);
      if (err) return { error: err };
      if (!deps.exports.canExport()) return { error: 'nothing to publish (no model on screen, or a read-only shared design)' };
      if (isPublishModalOpen()) return { error: 'the publish dialog is already open' };
      const staged = stagePublishPrefill({ ...p, note: ctx.note, source: ctx.source });
      return awaitStagedDialog(staged, () => deps.exports.runPublish(p.platform), clearPublishPrefill, { applied: prefill ?? {}, ignored: [] });
    },
    getState: getPublishModalState,
    isOpen: isPublishModalOpen,
    close: closePublishModal,
  });

  // ── Relief import wizard ─────────────────────────────────────────────────
  registerTool({
    id: 'import-relief',
    title: 'Make a part from an image (relief / colour tile)',
    hint: 'Import',
    prefillSchema: RELIEF_PREFILL_SCHEMA,
    open: async (prefill, ctx) => {
      const p = prefill ?? {};
      const crop = p.crop as { left?: number; top?: number; right?: number; bottom?: number } | undefined;
      if (crop) {
        if ([crop.left, crop.top, crop.right, crop.bottom].some(v => v === undefined)) return { error: 'crop needs all of left, top, right, bottom' };
        if (crop.left! >= crop.right! || crop.top! >= crop.bottom!) return { error: 'crop must have left < right and top < bottom' };
      }
      const pre = p.preprocess as { levelsLow?: number; levelsHigh?: number } | undefined;
      if (pre?.levelsLow !== undefined && pre.levelsHigh !== undefined && pre.levelsLow >= pre.levelsHigh) return { error: 'preprocess.levelsLow must be below levelsHigh' };
      if (isReliefImportOpen()) return { error: 'the relief wizard is already open — close it first (its picked image and settings would be lost)' };
      let file: File | undefined;
      let label: string | undefined;
      if (typeof p.src === 'string') {
        const img = await loadPrefillImage(p.src);
        if ('error' in img) return img;
        file = img.file; label = img.label;
      }
      const staged: ReliefStagedOptions = {
        ...(p.mode ? { mode: p.mode as ReliefStagedOptions['mode'] } : {}),
        ...(p.options ? { common: p.options as ReliefStagedOptions['common'] } : {}),
        ...(p.luminance ? { luminance: p.luminance as ReliefStagedOptions['luminance'] } : {}),
        ...(p.quantized ? { quantized: p.quantized as ReliefStagedOptions['quantized'] } : {}),
        ...(p.preprocess ? { preprocess: p.preprocess as ReliefStagedOptions['preprocess'] } : {}),
        ...(crop ? { crop: crop as NonNullable<ReliefStagedOptions['crop']> } : {}),
      };
      deps.imports.relief(file, staged, ctx.note, ctx.source);
      return { applied: { ...p, ...(label ? { src: label } : {}) }, ignored: [] };
    },
    getState: getReliefImportState,
    isOpen: isReliefImportOpen,
    close: closeReliefImport,
  });

  // ── Image → voxel import ─────────────────────────────────────────────────
  registerTool({
    id: 'import-image-voxel',
    title: 'Image → voxel',
    hint: 'Import',
    prefillSchema: VOXEL_IMPORT_PREFILL_SCHEMA,
    open: async (prefill, ctx) => {
      const p = prefill ?? {};
      if (isImageVoxelImportOpen()) return { error: 'the image → voxel dialog is already open' };
      let img: { file: File; imageData: ImageData; label: string } | null = null;
      if (typeof p.src === 'string') {
        const r = await loadPrefillImage(p.src);
        if ('error' in r) return r;
        if (/svg/i.test(r.file.type)) return { error: 'src: SVG images are not supported by image → voxel (use import-relief)' };
        img = r;
      }
      const options = { ...((p.options ?? {}) as Record<string, unknown>) } as ImageToVoxelOptions & { flatColor?: [number, number, number] };
      if (options.flatColor) options.flatColor = options.flatColor.map(n => Math.round(n * 255)) as [number, number, number];
      void deps.imports.imageVoxel(img, options, ctx.note, ctx.source);
      return { applied: { ...p, ...(img ? { src: img.label } : {}) }, ignored: [] };
    },
    getState: getImageVoxelImportState,
    isOpen: isImageVoxelImportOpen,
    close: closeImageVoxelImport,
  });
}
