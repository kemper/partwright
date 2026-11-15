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

// ── Stage B: image tools as code ops ─────────────────────────────────────────
//
// Each tool also exists as a model-code call that reads the image and builds
// the geometry in the engine Worker (instead of baking a mesh into the code):
//
//   const img = api.image('<attachment id>');
//   return api.imageTile(img, { quantized: { clusters: 6 } });
//
// `params` is the same object the header stores; the call merges it over the
// tool's defaults (src/imageTools/params.ts validates it strictly).

/** The relief tools and the manifold-js sandbox function that runs each. */
export const RELIEF_OP_FUNCTIONS = {
  tile: 'imageTile',
  silhouette: 'silhouetteTile',
  steppedRelief: 'steppedRelief',
  lithophane: 'lithophane',
} as const;

export type ReliefToolId = keyof typeof RELIEF_OP_FUNCTIONS;

/** The voxel tool's function (voxel-language sessions). */
export const VOXEL_OP_FUNCTION = 'voxelsFromImage';

const OP_FUNCTION_TOOL: Record<string, ImageToolId> = {
  imageTile: 'tile',
  silhouetteTile: 'silhouette',
  steppedRelief: 'steppedRelief',
  lithophane: 'lithophane',
  voxelsFromImage: 'voxel',
  layeredPrint: 'layeredPrint',
};

/** The part of a relief record worth writing as code: only values that differ
 *  from the tool's defaults, minus what the function name already implies
 *  (`mode`, `quantized.output`) and the sections the tool ignores. */
export function compactReliefParams(tool: ReliefToolId, params: Record<string, unknown>): Record<string, unknown> {
  const full = reliefOptionsForOp(tool, params) as unknown as Record<string, unknown>;
  const defaults = reliefDefaultsForTool(tool) as unknown as Record<string, unknown>;
  const sections = tool === 'lithophane' ? ['common', 'luminance', 'preprocess'] : ['common', 'quantized', 'preprocess'];
  const out: Record<string, unknown> = {};
  for (const sec of sections) {
    const cur = full[sec] as Record<string, unknown>;
    const def = defaults[sec] as Record<string, unknown>;
    const diff: Record<string, unknown> = {};
    for (const k of Object.keys(cur)) {
      if (cur[k] === undefined) continue;
      if (sec === 'quantized' && k === 'output') continue;
      if (JSON.stringify(cur[k]) !== JSON.stringify(def[k])) diff[k] = cur[k];
    }
    if (Object.keys(diff).length > 0) out[sec] = diff;
  }
  const crop = full.crop as { left: number; top: number; right: number; bottom: number } | undefined;
  if (crop && !(crop.left <= 0.001 && crop.top <= 0.001 && crop.right >= 0.999 && crop.bottom >= 0.999)) out.crop = crop;
  return out;
}

/** Model code that runs `op` as a real call (not a baked mesh), and the
 *  language it runs in. Re-reading the code with {@link imageToolOpFromCode}
 *  gives back an equivalent record. */
export function imageToolCode(op: ImageToolOp): { code: string; language: 'manifold-js' | 'voxel' } {
  const info = imageToolInfo(op.tool);
  if (!/^[^'"`\\\n]{1,200}$/.test(op.image)) throw new Error(`imageToolCode: "${op.image.slice(0, 40)}" is not a usable attachment id`);
  const head = `// ${info.label} from an attached image. The image is read and the geometry\n// built on every run: edit the settings below and re-run.\nconst img = api.image('${op.image}');\n`;
  const call = (fn: string, params: Record<string, unknown>) =>
    `return api.${fn}(${Object.keys(params).length > 0 ? `img, ${JSON.stringify(params, null, 2)}` : 'img'});\n`;
  if (op.tool === 'voxel') {
    const params = JSON.parse(JSON.stringify(op.params)) as Record<string, unknown>;
    delete params.codeStyle; // only steers the baked (decode vs calls) form
    return { language: 'voxel', code: head + call(VOXEL_OP_FUNCTION, params) };
  }
  if (op.tool === 'layeredPrint') return { language: 'manifold-js', code: head + call('layeredPrint', op.params) };
  const tool = op.tool as ReliefToolId;
  const note = tool === 'lithophane' ? '' : '// Each colour region is a part (colour-1 = the largest), in its cluster colour.\n';
  return { language: 'manifold-js', code: head + note + call(RELIEF_OP_FUNCTIONS[tool], compactReliefParams(tool, op.params)) };
}

/** Index just past the balanced `{…}` starting at `start` (strings and
 *  comments skipped), or -1. */
function matchBrace(src: string, start: number): number {
  let depth = 0;
  for (let i = start; i < src.length; i++) {
    const c = src[i];
    if (c === '"' || c === "'" || c === '`') {
      for (i++; i < src.length && src[i] !== c; i++) if (src[i] === '\\') i++;
    } else if (c === '/' && src[i + 1] === '/') {
      while (i < src.length && src[i] !== '\n') i++;
    } else if (c === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2);
      if (end < 0) return -1;
      i = end + 1;
    } else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return i + 1;
  }
  return -1;
}

/** A plain JS object literal (quoted or bare keys, single or double quotes,
 *  comments, trailing commas; literal values only) → its JSON value, or
 *  undefined when it holds anything else (variables, expressions, calls). */
export function parseObjectLiteral(src: string): unknown {
  let out = '';
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (c === '"' || c === "'") {
      let body = '';
      for (i++; i < src.length && src[i] !== c; i++) {
        if (src[i] === '\\') { body += src[i] + (src[i + 1] ?? ''); i++; } else body += src[i] === '"' ? '\\"' : src[i];
      }
      if (i >= src.length) return undefined;
      try { out += JSON.stringify(JSON.parse(`"${body.replace(/\\'/g, "'")}"`)); } catch { return undefined; }
    } else if (c === '/' && src[i + 1] === '/') {
      while (i < src.length && src[i] !== '\n') i++;
    } else if (c === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2);
      if (end < 0) return undefined;
      i = end + 1;
    } else if (/[A-Za-z_$]/.test(c)) {
      let j = i;
      while (j < src.length && /[\w$]/.test(src[j])) j++;
      const word = src.slice(i, j);
      if (/^\s*:/.test(src.slice(j))) out += JSON.stringify(word);
      else if (word === 'true' || word === 'false' || word === 'null') out += word;
      else if (/^\d/.test(src.slice(i - 1, i)) || /^[eE]$/.test(word)) out += word; // exponent in 1e-3
      else return undefined;
      i = j - 1;
    } else if (c === ',') {
      // Drop a trailing comma (JSON has none).
      const next = src[nextSignificantIndex(src, i + 1)];
      if (next !== '}' && next !== ']') out += c;
    } else if (/[\s{}[\]:0-9.+-]/.test(c)) out += c;
    else return undefined;
  }
  try { return JSON.parse(out); } catch { return undefined; }
}

/** Index of the first character at or after `i` that isn't whitespace or a
 *  comment (a linear scan — no regex backtracking on comment-heavy input). */
function nextSignificantIndex(src: string, i: number): number {
  while (i < src.length) {
    const c = src[i];
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') { i++; continue; }
    if (c === '/' && src[i + 1] === '/') { const nl = src.indexOf('\n', i + 2); i = nl < 0 ? src.length : nl + 1; continue; }
    if (c === '/' && src[i + 1] === '*') { const end = src.indexOf('*/', i + 2); i = end < 0 ? src.length : end + 2; continue; }
    break;
  }
  return i;
}

/** The record behind an image-tool CALL in `code` — `api.imageTile(img, {…})`
 *  & co., the voxel `api.voxelsFromImage(img, {…})`, or `api.layeredPrint` —
 *  where `img` is `api.image('<id>')` inline or a variable assigned from one.
 *  Params are read back when the options are a plain literal (else `{}`); a
 *  layered print's code is its own record, so its params stay `{}`. */
function imageToolOpFromCall(code: string): ImageToolOp | null {
  const re = /\bapi\.(imageTile|silhouetteTile|steppedRelief|lithophane|voxelsFromImage|layeredPrint)\(\s*(?:api\.image\(\s*(['"`])([^'"`\n]{1,200})\2\s*\)|([A-Za-z_$][\w$]*))\s*(,?)/g;
  for (let m = re.exec(code); m; m = re.exec(code)) {
    const tool = OP_FUNCTION_TOOL[m[1]];
    let image = m[3];
    if (!image && m[4]) {
      const name = m[4].replace(/[\\^$.*+?()[\]{}|]/g, '\\$&');
      const v = new RegExp(`\\b(?:const|let|var)\\s+${name}\\s*=\\s*api\\.image\\(\\s*(['"\`])([^'"\`\\n]{1,200})\\1\\s*\\)`).exec(code);
      if (v) image = v[2];
    }
    if (!image) continue;
    let params: Record<string, unknown> = {};
    if (tool !== 'layeredPrint' && m[5] === ',') {
      const at = re.lastIndex + (/^\s*/.exec(code.slice(re.lastIndex))?.[0].length ?? 0);
      if (code[at] === '{') {
        const end = matchBrace(code, at);
        const parsed = end > 0 ? parseObjectLiteral(code.slice(at, end)) : undefined;
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) params = parsed as Record<string, unknown>;
      }
    }
    return { tool, image, params };
  }
  return null;
}

/** The tool record behind `code`: its `@image-tool` header, or — for code that
 *  runs a tool as a call (`api.imageTile(api.image(id), {…})` & co., the voxel
 *  `api.voxelsFromImage`, `api.layeredPrint`) — that call. Null when the
 *  object wasn't made by an image tool. */
export function imageToolOpFromCode(code: string): ImageToolOp | null {
  const header = parseImageToolHeader(code);
  if (header) return header;
  return imageToolOpFromCall(code);
}
