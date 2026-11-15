// Image tools (#1256, Stage A): one image imported into a session as an
// attachment, then turned into geometry by a TOOL whose settings are stored as
// an operation record:
//
//   { tool: 'tile', image: '<attachment id>', params: { ...the tool's options } }
//
// The record lives in the object's own code, as a header comment the tool
// writes above the generated code:
//
//   // @image-tool {"tool":"tile","image":"a1b2c3","params":{...}}
//
// Code already persists, versions and exports with the session, so the record
// needs no schema change; re-opening a tool reads it back, and re-applying
// writes a new version (undo = version history). Stage B turns the same record
// into a real call (`api.imageTile(api.image(id), params)`), so the param
// schemas here are the contract.
//
// Pure — no DOM, no app imports beyond types.

import type { ReliefOptions } from '../relief/types';
import { DEFAULT_RELIEF_OPTIONS } from '../relief/types';
import type { ImageToVoxelOptions } from '../import/imageToVoxel';

export type ImageToolId = 'tile' | 'silhouette' | 'steppedRelief' | 'lithophane' | 'voxel' | 'layeredPrint';

/** Which generator a tool runs on. */
export type ImageToolEngine = 'relief' | 'voxel' | 'layered';

export interface ImageToolInfo {
  id: ImageToolId;
  label: string;
  description: string;
  engine: ImageToolEngine;
}

export const IMAGE_TOOLS: readonly ImageToolInfo[] = [
  { id: 'tile', label: 'Keychain / colour tile', description: 'A flat tile with the image\'s colour regions painted on top (keychain, badge, coaster). AMS-friendly.', engine: 'relief' },
  { id: 'silhouette', label: 'Silhouette tile', description: 'A flat tile cut to the image\'s subject outline (background removed) — stickers, character keychains.', engine: 'relief' },
  { id: 'steppedRelief', label: 'Stepped relief', description: 'Each colour cluster gets its own height — a layered poster look.', engine: 'relief' },
  { id: 'lithophane', label: 'Lithophane / luminance relief', description: 'A smooth brightness → height heightmap; backlit, it shows the photo.', engine: 'relief' },
  { id: 'layeredPrint', label: 'Layered filament print', description: 'HueForge-style: thin translucent layers with filament swaps at chosen heights blend a few filaments into many shades.', engine: 'layered' },
  { id: 'voxel', label: 'Voxel art', description: 'Blocky coloured cubes (pixel-art / Minecraft style), flat billboard or brightness-driven heightmap.', engine: 'voxel' },
];

export function isImageToolId(v: unknown): v is ImageToolId {
  return typeof v === 'string' && IMAGE_TOOLS.some((t) => t.id === v);
}

export function imageToolInfo(id: ImageToolId): ImageToolInfo {
  return IMAGE_TOOLS.find((t) => t.id === id)!;
}

/** The stored operation record. `params` is the tool's own option object:
 *  relief tools → `ReliefOptions`, voxel → `ImageToVoxelOptions`, layered print
 *  → none (its code, `api.layeredPrint`, is already the record). */
export interface ImageToolOp {
  tool: ImageToolId;
  /** Session attachment id of the source image. */
  image: string;
  params: Record<string, unknown>;
}

const HEADER_RE = /^\/\/ @image-tool (\{.*\})\s*$/m;

/** The header line(s) a tool writes above its generated code. */
export function formatImageToolHeader(op: ImageToolOp): string {
  const info = imageToolInfo(op.tool);
  return `// @image-tool ${JSON.stringify({ tool: op.tool, image: op.image, params: op.params })}\n`
    + `// ${info.label} from an attached image. Re-open it from Import → Image tools to change the settings.\n`;
}

/** The operation record in `code`'s header, or null (absent or malformed). */
export function parseImageToolHeader(code: string): ImageToolOp | null {
  const m = HEADER_RE.exec(code);
  if (!m) return null;
  try {
    const o = JSON.parse(m[1]) as Record<string, unknown>;
    if (!isImageToolId(o.tool) || typeof o.image !== 'string' || !o.image) return null;
    const params = o.params && typeof o.params === 'object' && !Array.isArray(o.params) ? (o.params as Record<string, unknown>) : {};
    return { tool: o.tool, image: o.image, params };
  } catch {
    return null;
  }
}

/** Replace (or add) the header on `code`. */
export function withImageToolHeader(code: string, op: ImageToolOp): string {
  const stripped = code.replace(/^\/\/ @image-tool \{.*\}\s*\n(\/\/ .*Image tools.*\n)?/m, '');
  return formatImageToolHeader(op) + stripped;
}

// ── relief tools ↔ ReliefOptions ────────────────────────────────────────────

/** Default ReliefOptions for a relief-engine tool. */
export function reliefDefaultsForTool(tool: ImageToolId): ReliefOptions {
  const o: ReliefOptions = structuredClone(DEFAULT_RELIEF_OPTIONS);
  switch (tool) {
    case 'tile': o.mode = 'quantized'; o.quantized.output = 'flat'; break;
    case 'silhouette': o.mode = 'quantized'; o.quantized.output = 'silhouette'; break;
    case 'steppedRelief': o.mode = 'quantized'; o.quantized.output = 'relief'; break;
    case 'lithophane': o.mode = 'luminance'; break;
    default: throw new Error(`${tool} is not a relief tool`);
  }
  return o;
}

/** Merge stored params over a relief tool's defaults (one level deep, per
 *  section), so a record that omits a section still yields full options. */
export function reliefOptionsForOp(tool: ImageToolId, params: Record<string, unknown>): ReliefOptions {
  const base = reliefDefaultsForTool(tool);
  const p = params as Partial<ReliefOptions>;
  return {
    ...base,
    ...(p.mode ? { mode: p.mode } : {}),
    common: { ...base.common, ...(p.common ?? {}) },
    luminance: { ...base.luminance, ...(p.luminance ?? {}) },
    quantized: { ...base.quantized, ...(p.quantized ?? {}) },
    preprocess: { ...base.preprocess, ...(p.preprocess ?? {}) },
    ...(p.crop ? { crop: p.crop } : {}),
  };
}

/** Which relief tool a finished set of options amounts to (the wizard lets
 *  the user switch mode, so the record follows what was actually made). */
export function toolForReliefOptions(o: ReliefOptions): ImageToolId {
  if (o.mode === 'luminance') return 'lithophane';
  if (o.quantized.output === 'silhouette') return 'silhouette';
  if (o.quantized.output === 'relief') return 'steppedRelief';
  return 'tile';
}

/** Voxel params as stored (a plain copy, minus undefined). */
export function voxelParams(o: ImageToVoxelOptions): Record<string, unknown> {
  return JSON.parse(JSON.stringify(o)) as Record<string, unknown>;
}

/** The tool record behind `code`: its `@image-tool` header, or — for a layered
 *  print, whose code is already the record — its `api.layeredPrint(api.image(id))`
 *  call. Null when the object wasn't made by an image tool. */
export function imageToolOpFromCode(code: string): ImageToolOp | null {
  const header = parseImageToolHeader(code);
  if (header) return header;
  const m = /api\.layeredPrint\(\s*api\.image\(\s*(['"`])([^'"`\n]{1,200})\1\s*\)/.exec(code);
  return m ? { tool: 'layeredPrint', image: m[2], params: {} } : null;
}
