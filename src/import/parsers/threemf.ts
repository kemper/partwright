// 3MF import — core spec + the production extension (multi-file `p:path`
// components) + colour from every place real-world 3MFs carry it:
//
//   - Slicer projects (Bambu Studio / OrcaSlicer / PrusaSlicer): per-object and
//     per-part extruder assignments (Bambu `Metadata/model_settings.config`,
//     Prusa `Metadata/Slic3r_PE_model.config`), per-triangle MMU painting
//     (Bambu `paint_color`, Prusa `slic3rpe:mmu_segmentation`), and the filament
//     palette (`Metadata/project_settings.config` JSON / `Slic3r_PE.config`).
//     Colours resolve to *filament slots*, so the palette round-trips.
//   - Plain 3MF (CAD tools, other slicers, Partwright's own generic export):
//     core `<basematerials>` and the materials extension `<m:colorgroup>`,
//     referenced via object `pid`/`pindex` and triangle `pid`/`p1`.
//
// The result is ONE merged, world-space triangle mesh (build-item and component
// transforms baked in, units converted to millimetres, XY recentred on the
// origin) plus a per-triangle palette index — the shape the STL import path
// already consumes, with colour layered on top as paint regions.
//
// Deliberately pure (no DOM: a hand-rolled XML tag scanner instead of
// DOMParser, which also keeps a 40 MB Bambu object file fast), so the whole
// parser unit-tests in the vitest tier.

import type { MeshData } from '../../geometry/types';
import { dominantPaintColorState } from '../../export/paintColor3mf';
import { openZip, type ZipArchive } from '../zipReader';

export interface ThreeMFPaletteEntry {
  /** `#rrggbb`, lower-case. */
  hex: string;
  name: string;
}

export interface ThreeMFObjectSummary {
  name: string;
  triangleCount: number;
}

export interface ThreeMFParseResult {
  /** Merged world-space mesh (mm), numProp 3, indexed per source object. */
  mesh: MeshData;
  /** Per-triangle index into `palette`, or -1 for an uncoloured triangle. */
  triColor: Int32Array;
  /** Filament slots (slicer projects — every declared filament, used or not) or
   *  the distinct material colours actually referenced (plain 3MF). */
  palette: ThreeMFPaletteEntry[];
  /** Where the colours came from. */
  colorSource: 'filaments' | 'materials' | 'none';
  /** Which producer's conventions were detected. */
  flavor: 'bambu' | 'prusa' | 'generic';
  /** `Application` metadata, when present (e.g. "BambuStudio-02.00.01.50"). */
  application?: string;
  /** `Title` metadata, when present. */
  title?: string;
  /** One entry per emitted build item (a model's printable objects). */
  objects: ThreeMFObjectSummary[];
  /** Modifier / negative / support parts that were skipped (not printed geometry). */
  skippedParts: number;
  /** Triangles whose slicer painting was split between filaments — coloured
   *  with the filament covering most of the triangle. */
  splitPaintedTriangles: number;
}

export interface ThreeMFParseOptions {
  /** Shift the merged model so its XY bounding-box centre sits on the origin
   *  (3MF build plates are placed in bed coordinates, e.g. (128,128) on a
   *  Bambu). Z is kept: build space z=0 is the plate. Default true. */
  recenter?: boolean;
}

// ── XML scanning ────────────────────────────────────────────────────────────

const ATTR_RE = /([^\s=/]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

function localName(qname: string): string {
  const i = qname.indexOf(':');
  return i < 0 ? qname : qname.slice(i + 1);
}

/** Attributes keyed by LOCAL name (namespace prefix stripped: `p:path` → `path`,
 *  `slic3rpe:mmu_segmentation` → `mmu_segmentation`). */
function parseAttrs(s: string): Record<string, string> {
  const out: Record<string, string> = {};
  ATTR_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = ATTR_RE.exec(s))) out[localName(m[1])] = m[2] ?? m[3] ?? '';
  return out;
}

function decodeEntities(s: string): string {
  if (s.indexOf('&') < 0) return s;
  return s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, e: string) => {
    const k = e.toLowerCase();
    if (k === 'amp') return '&';
    if (k === 'lt') return '<';
    if (k === 'gt') return '>';
    if (k === 'quot') return '"';
    if (k === 'apos') return "'";
    const code = k.startsWith('#x') ? parseInt(k.slice(2), 16) : parseInt(k.slice(1), 10);
    return Number.isFinite(code) ? String.fromCodePoint(code) : '';
  });
}

interface XmlHandler {
  open(name: string, attrs: string, selfClosing: boolean, contentStart: number): void;
  close(name: string, contentEnd: number): void;
}

/** Minimal forward-only XML tag scanner: element names are reported by local
 *  name; attribute strings are handed over raw so hot elements (vertex,
 *  triangle) parse only what they need. Skips comments, PIs, CDATA, DOCTYPE. */
function scanXml(xml: string, h: XmlHandler): void {
  const len = xml.length;
  let i = 0;
  for (;;) {
    const lt = xml.indexOf('<', i);
    if (lt < 0 || lt + 1 >= len) return;
    const c = xml.charCodeAt(lt + 1);
    if (c === 33 /* ! */) {
      let end: number;
      if (xml.startsWith('<!--', lt)) { end = xml.indexOf('-->', lt + 4); i = end < 0 ? len : end + 3; }
      else if (xml.startsWith('<![CDATA[', lt)) { end = xml.indexOf(']]>', lt + 9); i = end < 0 ? len : end + 3; }
      else { end = xml.indexOf('>', lt); i = end < 0 ? len : end + 1; }
      continue;
    }
    if (c === 63 /* ? */) {
      const end = xml.indexOf('?>', lt + 2);
      i = end < 0 ? len : end + 2;
      continue;
    }
    // Tag end, quote-aware ('>' is legal inside attribute values).
    let gt = lt + 1;
    let quote = 0;
    for (; gt < len; gt++) {
      const ch = xml.charCodeAt(gt);
      if (quote) { if (ch === quote) quote = 0; }
      else if (ch === 34 || ch === 39) quote = ch;
      else if (ch === 62) break;
    }
    if (gt >= len) return;
    if (c === 47 /* / */) {
      h.close(localName(xml.slice(lt + 2, gt).trim()), lt);
    } else {
      let nameEnd = lt + 1;
      while (nameEnd < gt) {
        const ch = xml.charCodeAt(nameEnd);
        if (ch === 32 || ch === 9 || ch === 10 || ch === 13 || ch === 47 || ch === 62) break;
        nameEnd++;
      }
      const selfClosing = xml.charCodeAt(gt - 1) === 47;
      const name = localName(xml.slice(lt + 1, nameEnd));
      h.open(name, xml.slice(nameEnd, selfClosing ? gt - 1 : gt), selfClosing, gt + 1);
      if (selfClosing) h.close(name, gt + 1);
    }
    i = gt + 1;
  }
}

// ── Transforms (3MF row-vector 3×4: m00 m01 m02 m10 m11 m12 m20 m21 m22 m30 m31 m32) ──

type Mat = Float64Array;
const IDENTITY: Mat = new Float64Array([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]);

function parseTransform(s: string | undefined): Mat {
  if (!s) return IDENTITY;
  const parts = s.trim().split(/\s+/).map(Number);
  if (parts.length !== 12 || parts.some(n => !Number.isFinite(n))) return IDENTITY;
  return new Float64Array(parts);
}

/** `a` applied first, then `b` (p' = p·A·B). */
function compose(a: Mat, b: Mat): Mat {
  const r = new Float64Array(12);
  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < 3; col++) {
      let v = a[row * 3] * b[col] + a[row * 3 + 1] * b[3 + col] + a[row * 3 + 2] * b[6 + col];
      if (row === 3) v += b[9 + col];
      r[row * 3 + col] = v;
    }
  }
  return r;
}

function determinant(m: Mat): number {
  return m[0] * (m[4] * m[8] - m[5] * m[7]) - m[1] * (m[3] * m[8] - m[5] * m[6]) + m[2] * (m[3] * m[7] - m[4] * m[6]);
}

// ── Model-file parsing ──────────────────────────────────────────────────────

interface MeshObject {
  kind: 'mesh';
  name?: string;
  type: string;
  positions: Float64Array;
  tris: Uint32Array;
  /** Per-triangle property group / index (-1 = unset). Null when no triangle sets one. */
  triPid: Int32Array | null;
  triP1: Int32Array | null;
  /** Per-triangle dominant slicer paint state (0 = unpainted). Null when unpainted. */
  paint: Uint16Array | null;
  splitPainted: number;
  pid: number;
  pindex: number;
}

interface Component { path: string | null; objectId: number; transform: Mat }

interface ComponentsObject {
  kind: 'components';
  name?: string;
  type: string;
  components: Component[];
}

type ModelObject = MeshObject | ComponentsObject;

interface PropertyGroup { colors: (string | null)[]; names: (string | null)[] }

interface ModelFile {
  unitScale: number;
  objects: Map<number, ModelObject>;
  groups: Map<number, PropertyGroup>;
  build: { objectId: number; path: string | null; transform: Mat }[];
  metadata: Map<string, string>;
}

const UNIT_SCALE: Record<string, number> = {
  micron: 0.001, millimeter: 1, centimeter: 10, inch: 25.4, foot: 304.8, meter: 1000,
};

/** `#RGB`, `#RRGGBB`, `#RRGGBBAA` → `#rrggbb`; null when unparseable. */
export function normalizeHexColor(s: string | undefined | null): string | null {
  if (!s) return null;
  const t = s.trim().replace(/^#/, '');
  if (/^[0-9a-f]{3}$/i.test(t)) return '#' + t.split('').map(c => c + c).join('').toLowerCase();
  if (/^[0-9a-f]{6}([0-9a-f]{2})?$/i.test(t)) return '#' + t.slice(0, 6).toLowerCase();
  return null;
}

function parseModelXml(xml: string): ModelFile {
  const file: ModelFile = { unitScale: 1, objects: new Map(), groups: new Map(), build: [], metadata: new Map() };

  let obj: { id: number; name?: string; type: string; pid: number; pindex: number } | null = null;
  let positions: number[] = [];
  let tris: number[] = [];
  let triPid: number[] | null = null;
  let triP1: number[] | null = null;
  let paint: number[] | null = null;
  let splitPainted = 0;
  let components: Component[] | null = null;
  let hasMesh = false;
  let group: PropertyGroup | null = null;
  let groupId = -1;
  let inBuild = false;
  let metaName: string | null = null;
  let metaStart = 0;
  let depthInObjectMetadata = 0;


  scanXml(xml, {
    open(name, attrStr, selfClosing, contentStart) {
      switch (name) {
        case 'vertex': {
          const a = parseAttrs(attrStr);
          positions.push(Number(a.x), Number(a.y), Number(a.z));
          return;
        }
        case 'triangle': {
          const a = parseAttrs(attrStr);
          const t = tris.length / 3;
          tris.push(Number(a.v1), Number(a.v2), Number(a.v3));
          if (a.pid !== undefined || a.p1 !== undefined) {
            if (!triPid) { triPid = new Array(t).fill(-1); triP1 = new Array(t).fill(-1); }
          }
          if (triPid) {
            triPid.push(a.pid !== undefined ? Number(a.pid) : -1);
            triP1!.push(a.p1 !== undefined ? Number(a.p1) : -1);
          }
          const paintStr = a.paint_color ?? a.mmu_segmentation;
          if (paintStr !== undefined && !paint) paint = new Array(t).fill(0);
          if (paint) {
            const s = paintStr ? dominantPaintColorState(paintStr) : 0;
            if (paintStr && paintStr.length > 1 && (parseInt(paintStr[paintStr.length - 1], 16) & 0b11) !== 0) splitPainted++;
            paint.push(s);
          }
          return;
        }
        case 'model': {
          const a = parseAttrs(attrStr);
          file.unitScale = UNIT_SCALE[(a.unit ?? 'millimeter').toLowerCase()] ?? 1;
          return;
        }
        case 'object': {
          const a = parseAttrs(attrStr);
          obj = {
            id: Number(a.id),
            name: a.name !== undefined ? decodeEntities(a.name) : undefined,
            type: (a.type ?? 'model').toLowerCase(),
            pid: a.pid !== undefined ? Number(a.pid) : -1,
            pindex: a.pindex !== undefined ? Number(a.pindex) : 0,
          };
          positions = []; tris = []; triPid = null; triP1 = null; paint = null; splitPainted = 0;
          components = null; hasMesh = false;
          return;
        }
        case 'mesh': hasMesh = true; return;
        case 'components': components = []; return;
        case 'component': {
          if (!components) return;
          const a = parseAttrs(attrStr);
          components.push({ path: a.path ?? null, objectId: Number(a.objectid), transform: parseTransform(a.transform) });
          return;
        }
        case 'basematerials':
        case 'colorgroup': {
          const a = parseAttrs(attrStr);
          groupId = Number(a.id);
          group = { colors: [], names: [] };
          if (selfClosing) { file.groups.set(groupId, group); group = null; }
          return;
        }
        case 'base': {
          if (!group) return;
          const a = parseAttrs(attrStr);
          group.colors.push(normalizeHexColor(a.displaycolor));
          group.names.push(a.name !== undefined ? decodeEntities(a.name) : null);
          return;
        }
        case 'color': {
          if (!group) return;
          const a = parseAttrs(attrStr);
          group.colors.push(normalizeHexColor(a.color));
          group.names.push(null);
          return;
        }
        case 'texture2dgroup':
        case 'compositematerials':
        case 'multiproperties': {
          // Not colour-resolvable per triangle — register an empty group so
          // references to it fall through to "uncoloured" instead of erroring.
          const a = parseAttrs(attrStr);
          file.groups.set(Number(a.id), { colors: [], names: [] });
          return;
        }
        case 'build': inBuild = true; return;
        case 'item': {
          if (!inBuild) return;
          const a = parseAttrs(attrStr);
          file.build.push({ objectId: Number(a.objectid), path: a.path ?? null, transform: parseTransform(a.transform) });
          return;
        }
        case 'metadatagroup': depthInObjectMetadata++; return;
        case 'metadata': {
          if (obj || depthInObjectMetadata > 0 || selfClosing) return;
          const a = parseAttrs(attrStr);
          metaName = a.name ?? null;
          metaStart = contentStart;
          return;
        }
      }
    },
    close(name, contentEnd) {
      switch (name) {
        case 'object': {
          if (!obj) return;
          if (components && !hasMesh) {
            file.objects.set(obj.id, { kind: 'components', name: obj.name, type: obj.type, components });
          } else {
            file.objects.set(obj.id, {
              kind: 'mesh',
              name: obj.name,
              type: obj.type,
              positions: new Float64Array(positions),
              tris: new Uint32Array(tris),
              triPid: triPid ? new Int32Array(triPid) : null,
              triP1: triP1 ? new Int32Array(triP1!) : null,
              paint: paint ? new Uint16Array(paint) : null,
              splitPainted,
              pid: obj.pid,
              pindex: obj.pindex,
            });
          }
          obj = null;
          positions = []; tris = []; triPid = null; triP1 = null; paint = null;
          return;
        }
        case 'basematerials':
        case 'colorgroup':
          if (group) file.groups.set(groupId, group);
          group = null;
          return;
        case 'build': inBuild = false; return;
        case 'metadatagroup': depthInObjectMetadata = Math.max(0, depthInObjectMetadata - 1); return;
        case 'metadata':
          if (metaName !== null) {
            file.metadata.set(metaName, decodeEntities(xml.slice(metaStart, contentEnd)).trim());
            metaName = null;
          }
          return;
      }
    },
  });
  return file;
}

// ── Slicer project settings (Bambu / Orca / Prusa) ──────────────────────────

interface SlicerPart { extruder: number; subtype: string; name?: string }
interface SlicerVolume { first: number; last: number; extruder: number; printable: boolean }
interface SlicerObject { extruder: number; name?: string; parts: Map<number, SlicerPart>; volumes: SlicerVolume[] }

interface SlicerConfig {
  flavor: 'bambu' | 'prusa';
  filaments: ThreeMFPaletteEntry[];
  objects: Map<number, SlicerObject>;
}

function intOr0(s: string | undefined): number {
  const n = s === undefined ? NaN : parseInt(s, 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** Bambu/Orca `Metadata/model_settings.config`: object → extruder + parts. */
function parseBambuModelSettings(xml: string): Map<number, SlicerObject> {
  const objects = new Map<number, SlicerObject>();
  let cur: SlicerObject | null = null;
  let part: SlicerPart | null = null;
  let partId = -1;
  let inPlate = false;
  scanXml(xml, {
    open(name, attrStr) {
      if (name === 'plate') { inPlate = true; return; }
      if (inPlate) return;
      const a = parseAttrs(attrStr);
      if (name === 'object') {
        cur = { extruder: 0, parts: new Map(), volumes: [] };
        objects.set(Number(a.id), cur);
      } else if (name === 'part' && cur) {
        partId = Number(a.id);
        part = { extruder: 0, subtype: a.subtype ?? 'normal_part' };
      } else if (name === 'metadata' && cur) {
        const target = part ?? cur;
        if (a.key === 'extruder') target.extruder = intOr0(a.value);
        else if (a.key === 'name' && a.value !== undefined) target.name = decodeEntities(a.value);
      }
    },
    close(name) {
      if (name === 'plate') { inPlate = false; return; }
      if (name === 'part' && cur && part) { cur.parts.set(partId, part); part = null; }
      else if (name === 'object') cur = null;
    },
  });
  return objects;
}

/** PrusaSlicer `Metadata/Slic3r_PE_model.config`: object → extruder + volume
 *  (triangle-range) extruders and types. */
function parsePrusaModelConfig(xml: string): Map<number, SlicerObject> {
  const objects = new Map<number, SlicerObject>();
  let cur: SlicerObject | null = null;
  let vol: (SlicerVolume & { type?: string; modifier?: boolean }) | null = null;
  scanXml(xml, {
    open(name, attrStr) {
      const a = parseAttrs(attrStr);
      if (name === 'object') {
        cur = { extruder: 0, parts: new Map(), volumes: [] };
        objects.set(Number(a.id), cur);
      } else if (name === 'volume' && cur) {
        vol = { first: Number(a.firstid), last: Number(a.lastid), extruder: 0, printable: true };
      } else if (name === 'metadata' && cur) {
        if (vol) {
          if (a.key === 'extruder') vol.extruder = intOr0(a.value);
          else if (a.key === 'volume_type') vol.printable = a.value === 'ModelPart';
          else if (a.key === 'modifier' && a.value === '1') vol.printable = false;
        } else if (a.key === 'extruder') cur.extruder = intOr0(a.value);
        else if (a.key === 'name' && a.value !== undefined) cur.name = decodeEntities(a.value);
      }
    },
    close(name) {
      if (name === 'volume' && cur && vol) { cur.volumes.push(vol); vol = null; }
      else if (name === 'object') cur = null;
    },
  });
  return objects;
}

function filamentName(i: number, settingsId: string | undefined, type: string | undefined): string {
  const clean = (settingsId ?? '').replace(/^"|"$/g, '').replace(/\s*@.*$/, '').trim();
  return `F${i + 1} ${clean || type || 'Filament'}`.trim();
}

/** Bambu/Orca `Metadata/project_settings.config` (JSON). */
function parseBambuFilaments(json: string): ThreeMFPaletteEntry[] {
  let cfg: Record<string, unknown>;
  try { cfg = JSON.parse(json) as Record<string, unknown>; } catch { return []; }
  const arr = (k: string): string[] => (Array.isArray(cfg[k]) ? (cfg[k] as unknown[]).map(String) : []);
  const colours = arr('filament_colour');
  const ids = arr('filament_settings_id');
  const types = arr('filament_type');
  return colours.map((c, i) => ({ hex: normalizeHexColor(c) ?? '#808080', name: filamentName(i, ids[i], types[i]) }));
}

/** PrusaSlicer `Metadata/Slic3r_PE.config` (`; key = value` lines). */
function parsePrusaFilaments(text: string): ThreeMFPaletteEntry[] {
  const get = (k: string): string[] => {
    const m = new RegExp(`^;\\s*${k}\\s*=\\s*(.*)$`, 'm').exec(text);
    return m ? m[1].split(';').map(s => s.trim()) : [];
  };
  const filament = get('filament_colour');
  const extruder = get('extruder_colour');
  const ids = get('filament_settings_id');
  const types = get('filament_type');
  const n = Math.max(filament.length, extruder.length);
  const out: ThreeMFPaletteEntry[] = [];
  for (let i = 0; i < n; i++) {
    // Prusa shows the extruder colour when one is set, else the filament colour.
    const hex = normalizeHexColor(extruder[i]) ?? normalizeHexColor(filament[i]) ?? '#808080';
    out.push({ hex, name: filamentName(i, ids[i], types[i]) });
  }
  return out;
}

async function readSlicerConfig(zip: ZipArchive): Promise<SlicerConfig | null> {
  const bambuSettings = zip.find('Metadata/model_settings.config');
  const bambuProject = zip.find('Metadata/project_settings.config');
  if (bambuSettings || bambuProject) {
    return {
      flavor: 'bambu',
      objects: bambuSettings ? parseBambuModelSettings(await zip.readText(bambuSettings)) : new Map(),
      filaments: bambuProject ? parseBambuFilaments(await zip.readText(bambuProject)) : [],
    };
  }
  const prusaModel = zip.find('Metadata/Slic3r_PE_model.config');
  const prusaPrint = zip.find('Metadata/Slic3r_PE.config');
  if (prusaModel || prusaPrint) {
    return {
      flavor: 'prusa',
      objects: prusaModel ? parsePrusaModelConfig(await zip.readText(prusaModel)) : new Map(),
      filaments: prusaPrint ? parsePrusaFilaments(await zip.readText(prusaPrint)) : [],
    };
  }
  return null;
}

// ── Package entry ───────────────────────────────────────────────────────────

const FALLBACK_FILAMENT_COLORS = ['#f5f5f0', '#181818', '#c02525', '#e8c024', '#2452c0', '#808080', '#2e9d4a', '#e07a1f'];

function normPath(p: string): string {
  return '/' + p.replace(/\\/g, '/').replace(/^\/+/, '').toLowerCase();
}

async function findRootModelPath(zip: ZipArchive): Promise<string> {
  const rels = zip.find('_rels/.rels');
  if (rels) {
    const xml = await zip.readText(rels);
    let target: string | null = null;
    scanXml(xml, {
      open(name, attrStr) {
        if (name !== 'Relationship' || target) return;
        const a = parseAttrs(attrStr);
        if ((a.Type ?? '').toLowerCase().endsWith('/3dmodel') && a.Target) target = a.Target;
      },
      close() { /* no-op */ },
    });
    if (target && zip.find(target)) return normPath(target);
  }
  if (zip.find('3D/3dmodel.model')) return '/3d/3dmodel.model';
  const any = zip.entries.find(e => /\.model$/i.test(e.name));
  if (any) return normPath(any.name);
  throw new Error('Not a 3MF file: no 3D model part found in the package.');
}

/** Parse a .3mf package. Throws a human-readable Error on unreadable input. */
export async function parse3MF(bytes: Uint8Array, options: ThreeMFParseOptions = {}): Promise<ThreeMFParseResult> {
  const zip = openZip(bytes);
  const rootPath = await findRootModelPath(zip);

  // Parse the root model, then every model file it (transitively) references
  // through production-extension `p:path` components / build items.
  const files = new Map<string, ModelFile>();
  const queue = [rootPath];
  while (queue.length > 0) {
    const path = queue.shift()!;
    if (files.has(path)) continue;
    const entry = zip.find(path);
    if (!entry) throw new Error(`3MF references a missing model part: ${path}`);
    const model = parseModelXml(await zip.readText(entry));
    files.set(path, model);
    for (const o of model.objects.values()) {
      if (o.kind === 'components') for (const c of o.components) if (c.path) queue.push(normPath(c.path));
    }
    for (const it of model.build) if (it.path) queue.push(normPath(it.path));
  }
  const root = files.get(rootPath)!;
  if (root.build.length === 0) throw new Error('3MF has no build items (nothing to print).');

  const slicer = await readSlicerConfig(zip);
  const anyPaint = [...files.values()].some(f => [...f.objects.values()].some(o => o.kind === 'mesh' && o.paint));
  const anyMaterial = [...files.values()].some(f => f.groups.size > 0 && [...f.objects.values()].some(o => o.kind === 'mesh' && (o.pid >= 0 || o.triPid)));
  const colorSource: ThreeMFParseResult['colorSource'] =
    (slicer && (slicer.filaments.length > 0 || slicer.objects.size > 0)) || anyPaint ? 'filaments'
      : anyMaterial ? 'materials' : 'none';

  // Palette. Filament mode: every declared slot (grown on demand if painting
  // references a slot the config didn't list). Material mode: distinct colours,
  // added as they're first referenced.
  const palette: ThreeMFPaletteEntry[] = colorSource === 'filaments' ? [...(slicer?.filaments ?? [])] : [];
  const materialIndex = new Map<string, number>();
  const ensureFilament = (state: number): number => {
    while (palette.length < state) {
      const i = palette.length;
      palette.push({ hex: FALLBACK_FILAMENT_COLORS[i % FALLBACK_FILAMENT_COLORS.length], name: `F${i + 1} Filament` });
    }
    return state - 1;
  };
  const materialColor = (file: ModelFile, pid: number, idx: number): number => {
    const g = file.groups.get(pid);
    const hex = g?.colors[idx] ?? null;
    if (!hex) return -1;
    let pi = materialIndex.get(hex);
    if (pi === undefined) {
      pi = palette.length;
      materialIndex.set(hex, pi);
      palette.push({ hex, name: g!.names[idx] ?? `Color ${pi + 1}` });
    }
    return pi;
  };

  const positions: number[] = [];
  const triVerts: number[] = [];
  const triColor: number[] = [];
  const objects: ThreeMFObjectSummary[] = [];
  let skippedParts = 0;
  let splitPaintedTriangles = 0;

  interface Ctx { settingsObject: SlicerObject | undefined; part: SlicerPart | undefined }

  const emitMesh = (file: ModelFile, o: MeshObject, m: Mat, ctx: Ctx, settingsObjectId: number, meshId: number): void => {
    const s = file.unitScale;
    const base = positions.length / 3;
    const p = o.positions;
    for (let i = 0; i < p.length; i += 3) {
      const x = p[i] * s, y = p[i + 1] * s, z = p[i + 2] * s;
      positions.push(
        x * m[0] + y * m[3] + z * m[6] + m[9] * s,
        x * m[1] + y * m[4] + z * m[7] + m[10] * s,
        x * m[2] + y * m[5] + z * m[8] + m[11] * s,
      );
    }
    const flip = determinant(m) < 0; // mirrored instance — keep normals outward
    const nv = p.length / 3;
    // Prusa: the settings object id is the mesh object's own id.
    const prusaObj = slicer?.flavor === 'prusa' ? slicer.objects.get(meshId) ?? slicer.objects.get(settingsObjectId) : undefined;
    const objExtruder = ctx.part?.extruder || ctx.settingsObject?.extruder || prusaObj?.extruder || 0;
    let volIdx = 0;
    const vols = prusaObj?.volumes ?? [];
    const numTri = o.tris.length / 3;
    for (let t = 0; t < numTri; t++) {
      let extruder = objExtruder;
      if (vols.length > 0) {
        while (volIdx < vols.length - 1 && t > vols[volIdx].last) volIdx++;
        const v = vols[volIdx];
        if (t >= v.first && t <= v.last) {
          if (!v.printable) continue;
          if (v.extruder) extruder = v.extruder;
        }
      }
      const a = o.tris[t * 3], b = o.tris[t * 3 + 1], c = o.tris[t * 3 + 2];
      if (a >= nv || b >= nv || c >= nv) throw new Error('3MF triangle references a vertex index out of range.');
      if (flip) triVerts.push(base + a, base + c, base + b);
      else triVerts.push(base + a, base + b, base + c);

      let color = -1;
      if (colorSource === 'filaments') {
        const state = (o.paint ? o.paint[t] : 0) || extruder || 1;
        color = ensureFilament(state);
      } else if (colorSource === 'materials') {
        const pid = o.triPid && o.triPid[t] >= 0 ? o.triPid[t] : o.pid;
        const idx = o.triP1 && o.triP1[t] >= 0 ? o.triP1[t] : o.pindex;
        if (pid >= 0) color = materialColor(file, pid, idx);
      }
      triColor.push(color);
    }
    splitPaintedTriangles += o.splitPainted;
  };

  const emit = (filePath: string, objectId: number, m: Mat, ctx: Ctx, settingsObjectId: number, depth: number): void => {
    if (depth > 32) throw new Error('3MF component nesting is too deep (cyclic reference?).');
    const file = files.get(filePath);
    const o = file?.objects.get(objectId);
    if (!file || !o) throw new Error(`3MF references a missing object (id ${objectId}).`);
    if (o.type === 'support' || o.type === 'other') { skippedParts++; return; }
    if (o.kind === 'mesh') { emitMesh(file, o, m, ctx, settingsObjectId, objectId); return; }
    for (const c of o.components) {
      // Bambu: a first-level component is a "part" of the settings object.
      let part = ctx.part;
      if (!part && ctx.settingsObject) {
        part = ctx.settingsObject.parts.get(c.objectId);
        if (part && part.subtype !== 'normal_part') { skippedParts++; continue; }
      }
      emit(c.path ? normPath(c.path) : filePath, c.objectId, compose(c.transform, m), { settingsObject: ctx.settingsObject, part }, settingsObjectId, depth + 1);
    }
  };

  for (const item of root.build) {
    const startTri = triVerts.length / 3;
    const filePath = item.path ? normPath(item.path) : rootPath;
    const settingsObject = slicer?.flavor === 'bambu' ? slicer.objects.get(item.objectId) : undefined;
    emit(filePath, item.objectId, item.transform, { settingsObject, part: undefined }, item.objectId, 0);
    const o = files.get(filePath)?.objects.get(item.objectId);
    objects.push({
      name: settingsObject?.name ?? o?.name ?? `Object ${item.objectId}`,
      triangleCount: triVerts.length / 3 - startTri,
    });
  }

  const numVert = positions.length / 3;
  const numTri = triVerts.length / 3;
  if (numTri === 0) throw new Error('3MF contains no printable triangles.');
  for (let i = 0; i < positions.length; i++) {
    if (!Number.isFinite(positions[i])) throw new Error('3MF contains a non-finite vertex coordinate.');
  }

  const vertProperties = new Float32Array(positions.length);
  let dx = 0, dy = 0;
  if (options.recenter !== false) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (let i = 0; i < positions.length; i += 3) {
      const x = positions[i], y = positions[i + 1];
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
    dx = -(minX + maxX) / 2;
    dy = -(minY + maxY) / 2;
  }
  for (let i = 0; i < positions.length; i += 3) {
    vertProperties[i] = positions[i] + dx;
    vertProperties[i + 1] = positions[i + 1] + dy;
    vertProperties[i + 2] = positions[i + 2];
  }

  return {
    mesh: { vertProperties, triVerts: new Uint32Array(triVerts), numVert, numTri, numProp: 3 },
    triColor: new Int32Array(triColor),
    palette,
    colorSource,
    flavor: slicer?.flavor ?? 'generic',
    application: root.metadata.get('Application'),
    title: root.metadata.get('Title') || undefined,
    objects,
    skippedParts,
    splitPaintedTriangles,
  };
}

/** Weld vertices that coincide after quantizing to `tolerance`, keeping the
 *  triangle order (so `triColor` stays aligned). 3MF meshes are already indexed,
 *  but separately-modelled objects / some exporters duplicate seam vertices,
 *  which `Manifold.ofMesh` rejects as open edges. */
export function weldMesh(mesh: MeshData, tolerance: number): MeshData {
  const inv = 1 / tolerance;
  const map = new Map<string, number>();
  const remap = new Uint32Array(mesh.numVert);
  const out: number[] = [];
  const vp = mesh.vertProperties;
  for (let v = 0; v < mesh.numVert; v++) {
    const x = vp[v * 3], y = vp[v * 3 + 1], z = vp[v * 3 + 2];
    const key = `${Math.round(x * inv)},${Math.round(y * inv)},${Math.round(z * inv)}`;
    let idx = map.get(key);
    if (idx === undefined) {
      idx = out.length / 3;
      out.push(x, y, z);
      map.set(key, idx);
    }
    remap[v] = idx;
  }
  const triVerts = new Uint32Array(mesh.triVerts.length);
  for (let i = 0; i < triVerts.length; i++) triVerts[i] = remap[mesh.triVerts[i]];
  return { vertProperties: new Float32Array(out), triVerts, numVert: out.length / 3, numTri: mesh.numTri, numProp: 3 };
}
