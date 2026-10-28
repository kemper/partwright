// Validation for Worker → main-thread messages from the geometry engine Worker
// (engine.ts) and the parallel engine pool (enginePool.ts). (#1090)
//
// The engine Worker evaluates untrusted model code in its own realm. That code
// can call `self.postMessage` itself, or tamper with the Worker's own message
// plumbing, so everything arriving on the main thread is treated as untrusted
// DATA: the message type must be on an allow-list, and every field the main
// thread consumes must have the expected shape (typed-array classes, sizes,
// index ranges, plain-data payloads with no prototype-polluting keys). A
// malformed message is rejected before any main-thread logic acts on it.
//
// Pure (data tables only) so it runs in the unit tier.

import type { MeshData } from './types';
import { API_PAINT_DESCRIPTOR_KINDS, MAX_PAINT_PATTERN_ANCHORS, MAX_PAINT_PATTERN_COLORS } from './apiPaintSpec';
import { COLOR_PATTERN_KINDS } from '../color/colorPattern';
import { isSurfaceOpId, parseSurfaceOpts } from '../surface/surfaceOpSpec';
import { normalizeParamSchema, type ParamSpec } from './params';
import { isMaterialPresetName } from '../renderer/materialSpec';

/** Every message type the engine Worker legitimately sends. */
export const ENGINE_WORKER_MESSAGE_TYPES: ReadonlySet<string> = new Set([
  'ready',
  'error',
  'execute_preview',
  'execute_result',
  'validate_result',
  'detect_includes_result',
  'voxel_grid_result',
  'exportSTEP_result',
  'importSTEPToBrep_result',
  'importSTEPToMesh_result',
  'clearBrepImports_result',
  'clearBrepShape_result',
  'simplify_progress',
  'simplify_result',
  'enhance_progress',
  'enhance_result',
  // Dev builds only: the engine-realm report the e2e tier asks for
  // (engineWorker.ts `inspect_realm`, engine.ts `inspectEngineRealm`).
  ...(import.meta.env?.DEV ? ['inspect_realm_result'] : []),
]);

const FORBIDDEN_KEYS: ReadonlySet<string> = new Set(['__proto__', 'constructor', 'prototype']);
const MAX_DATA_DEPTH = 32;
/** Total nodes one isPlainData walk may visit. Structured clone preserves
 *  shared references, so `x = [x, x]` repeated 31 times is a tiny message that
 *  a naive walk would expand to ~2^31 visits; shared nodes are visited once
 *  (WeakSet) and the walk is capped. */
const MAX_DATA_NODES = 250_000;
const PAINT_KINDS: ReadonlySet<string> = new Set(API_PAINT_DESCRIPTOR_KINDS);
const PATTERN_KINDS: ReadonlySet<string> = new Set(COLOR_PATTERN_KINDS);
const AXES: ReadonlySet<string> = new Set(['x', 'y', 'z']);

export type WorkerMessageCheck =
  | {
      ok: true;
      msg: Record<string, unknown> & { type: string };
      /** execute results: the Customizer schema re-normalized on THIS thread
       *  (normalizeParamSchema) — use it instead of the Worker's raw array. */
      paramsSchema?: ParamSpec[];
    }
  | { ok: false; reason: string; callId: string | null; type: string | null };

class Bad extends Error {}

function fail(reason: string): never { throw new Bad(reason); }

function isPlainObject(v: unknown): v is Record<string, unknown> {
  if (v === null || typeof v !== 'object') return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

/** A typed array of class `Ctor` over a plain, fixed-length ArrayBuffer. A view
 *  over a SharedArrayBuffer (or a resizable buffer) could be rewritten by the
 *  Worker AFTER validation — the app is cross-origin isolated, so the Worker
 *  can post one — so those are refused. */
function isOwnedView<T extends ArrayBufferView>(v: unknown, Ctor: abstract new (...args: never[]) => T): v is T {
  if (!(v instanceof Ctor)) return false;
  const buf = (v as ArrayBufferView).buffer;
  return buf instanceof ArrayBuffer && (buf as ArrayBuffer & { resizable?: boolean }).resizable !== true;
}

function isOwnedAnyView(v: unknown): boolean {
  if (!ArrayBuffer.isView(v)) return false;
  const buf = v.buffer;
  return buf instanceof ArrayBuffer && (buf as ArrayBuffer & { resizable?: boolean }).resizable !== true;
}

/** Structured-clone-able plain JSON-ish data: primitives, arrays, plain objects,
 *  typed arrays over owned buffers. No Map/Set/Date/Blob, no
 *  `__proto__`/`constructor` keys, bounded depth and node count. */
export function isPlainData(v: unknown): boolean {
  // `checked`: nodes fully validated already (a shared, acyclic reference is
  // walked once). `onPath`: ancestors of the node being visited — reaching one
  // again is a cycle, which no consumer of these payloads can handle (a JSON
  // copy or a recursive walk would never terminate), so it's refused.
  const checked = new WeakSet<object>();
  const onPath = new Set<object>();
  let budget = MAX_DATA_NODES;
  const walk = (x: unknown, depth: number): boolean => {
    if (--budget < 0 || depth > MAX_DATA_DEPTH) return false;
    if (x === null || x === undefined) return true;
    const t = typeof x;
    if (t === 'string' || t === 'number' || t === 'boolean') return true;
    if (t !== 'object') return false;
    const o = x as object;
    if (onPath.has(o)) return false; // cycle
    if (checked.has(o)) return true; // shared reference — already validated
    let ok: boolean;
    if (ArrayBuffer.isView(o)) {
      ok = isOwnedAnyView(o);
    } else if (Array.isArray(o)) {
      onPath.add(o);
      ok = true;
      for (const item of o) if (!walk(item, depth + 1)) { ok = false; break; }
      onPath.delete(o);
    } else if (!isPlainObject(o)) {
      ok = false;
    } else {
      onPath.add(o);
      ok = true;
      for (const key of Object.keys(o)) {
        if (FORBIDDEN_KEYS.has(key) || !walk((o as Record<string, unknown>)[key], depth + 1)) { ok = false; break; }
      }
      onPath.delete(o);
    }
    if (ok) checked.add(o);
    return ok;
  };
  return walk(v, 0);
}

function isNonNegInt(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0;
}

function optString(v: unknown, field: string): void {
  if (v !== undefined && v !== null && typeof v !== 'string') fail(`${field} must be a string`);
}
function optBool(v: unknown, field: string): void {
  if (v !== undefined && v !== null && typeof v !== 'boolean') fail(`${field} must be a boolean`);
}
function optFinite(v: unknown, field: string): void {
  if (v !== undefined && v !== null && !(typeof v === 'number' && Number.isFinite(v))) fail(`${field} must be a finite number`);
}
function optPlainArray(v: unknown, field: string): unknown[] | null {
  if (v === undefined || v === null) return null;
  if (!Array.isArray(v) || !isPlainData(v)) fail(`${field} must be an array of plain data`);
  return v;
}
function isFiniteNum(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}
function isTuple(v: unknown, n: number): boolean {
  return Array.isArray(v) && v.length === n && v.every(isFiniteNum);
}
function isRgb(v: unknown): boolean {
  return isTuple(v, 3);
}
function onlyKeys(o: Record<string, unknown>, allowed: readonly string[], field: string): void {
  for (const k of Object.keys(o)) if (!allowed.includes(k)) fail(`${field}: unexpected field "${k}"`);
}
function reqTuple(o: Record<string, unknown>, k: string, n: number, field: string): void {
  if (!isTuple(o[k], n)) fail(`${field}.${k} must be ${n} finite numbers`);
}
function reqNum(o: Record<string, unknown>, k: string, field: string): void {
  if (!isFiniteNum(o[k])) fail(`${field}.${k} must be a finite number`);
}
function optNum(o: Record<string, unknown>, k: string, field: string): void {
  if (o[k] !== undefined && !isFiniteNum(o[k])) fail(`${field}.${k} must be a finite number`);
}
/** `MeshResult.manifoldFacts` — the Worker-computed stats of a big run. */
function checkManifoldFacts(v: unknown, numTri: number | null): void {
  if (v === undefined || v === null) return;
  const field = 'manifoldFacts';
  if (!isPlainObject(v)) fail(`${field} must be a plain object`);
  onlyKeys(v, ['bbox', 'volume', 'surfaceArea', 'genus', 'isManifold', 'manifoldStatus', 'componentCount', 'containedComponents', 'componentsInterpenetrate', 'edges', 'pieces'], field);
  if (v.pieces !== undefined) {
    const p = v.pieces;
    if (!isPlainObject(p)) fail(`${field}.pieces must be { count, pieceOfTri }`);
    onlyKeys(p, ['count', 'pieceOfTri'], `${field}.pieces`);
    if (!isNonNegInt(p.count) || !(p.pieceOfTri instanceof Int32Array)) fail(`${field}.pieces must be { count, pieceOfTri: Int32Array }`);
    if (numTri !== null && p.pieceOfTri.length !== numTri) fail(`${field}.pieces.pieceOfTri must have one entry per triangle`);
    const count = p.count as number;
    const pot = p.pieceOfTri;
    for (let i = 0; i < pot.length; i++) if (pot[i] < -1 || pot[i] >= count) fail(`${field}.pieces.pieceOfTri entry out of range`);
  }
  if (v.edges !== undefined) {
    if (!isPlainObject(v.edges)) fail(`${field}.edges must be { min, mean }`);
    onlyKeys(v.edges, ['min', 'mean'], `${field}.edges`);
    reqNum(v.edges, 'min', `${field}.edges`);
    reqNum(v.edges, 'mean', `${field}.edges`);
  }
  if (v.bbox !== null) {
    if (!isPlainObject(v.bbox)) fail(`${field}.bbox must be { min, max } or null`);
    onlyKeys(v.bbox, ['min', 'max'], `${field}.bbox`);
    reqTuple(v.bbox, 'min', 3, `${field}.bbox`);
    reqTuple(v.bbox, 'max', 3, `${field}.bbox`);
  }
  for (const k of ['volume', 'surfaceArea', 'componentCount', 'containedComponents']) reqNum(v, k, field);
  if (v.genus !== null) reqNum(v, 'genus', field);
  if (typeof v.isManifold !== 'boolean' || typeof v.componentsInterpenetrate !== 'boolean') fail(`${field} flags must be booleans`);
  if (v.manifoldStatus !== null && typeof v.manifoldStatus !== 'string') fail(`${field}.manifoldStatus must be a string or null`);
}
function optAxis(o: Record<string, unknown>, k: string, field: string): void {
  if (o[k] !== undefined && !(typeof o[k] === 'string' && AXES.has(o[k] as string))) fail(`${field}.${k} must be 'x', 'y' or 'z'`);
}

/** Per-kind field check for an `api.paint.*` descriptor — exactly the fields
 *  the recorder emits, with the types the main-thread resolver relies on, so a
 *  forged `{ kind: 'box' }` (no center) can't throw there and no other
 *  descriptor kind (imagePaint, brushStroke, colorFlood, …) can reach
 *  resolveDescriptorTriangles. */
export function checkPaintDescriptor(d: unknown, field = 'paintOps descriptor'): void {
  if (!isPlainObject(d) || typeof d.kind !== 'string' || !PAINT_KINDS.has(d.kind)) {
    fail(`${field} kind must be one of ${API_PAINT_DESCRIPTOR_KINDS.join(', ')}`);
  }
  if (d.withinPart !== undefined && (typeof d.withinPart !== 'string' || d.withinPart.length === 0)) fail(`${field}.withinPart must be a label name`);
  const f = `${field} (${d.kind})`;
  switch (d.kind) {
    case 'box':
      onlyKeys(d, ['kind', 'center', 'size', 'quaternion', 'shape', 'withinPart'], f);
      reqTuple(d, 'center', 3, f); reqTuple(d, 'size', 3, f); reqTuple(d, 'quaternion', 4, f);
      if (d.shape !== undefined && d.shape !== 'box') fail(`${f}.shape must be 'box'`);
      break;
    case 'slab':
      onlyKeys(d, ['kind', 'normal', 'offset', 'thickness', 'withinPart'], f);
      reqTuple(d, 'normal', 3, f); reqNum(d, 'offset', f); reqNum(d, 'thickness', f);
      break;
    case 'cylinder':
      onlyKeys(d, ['kind', 'center', 'rMin', 'rMax', 'zMin', 'zMax', 'axis', 'withinPart'], f);
      reqTuple(d, 'center', 2, f);
      for (const k of ['rMin', 'rMax', 'zMin', 'zMax']) reqNum(d, k, f);
      optAxis(d, 'axis', f);
      break;
    case 'byLabel':
      onlyKeys(d, ['kind', 'label', 'withinPart'], f);
      if (typeof d.label !== 'string' || d.label.length === 0) fail(`${f}.label must be a label name`);
      break;
    case 'pattern': {
      onlyKeys(d, ['kind', 'pattern', 'colors', 'scope', 'scale', 'axis', 'warp', 'coverage', 'seed', 'anchors', 'withinPart'], f);
      if (typeof d.pattern !== 'string' || !PATTERN_KINDS.has(d.pattern)) fail(`${f}.pattern must be one of ${COLOR_PATTERN_KINDS.join(', ')}`);
      if (!Array.isArray(d.colors) || d.colors.length === 0 || d.colors.length > MAX_PAINT_PATTERN_COLORS || !d.colors.every(isRgb)) fail(`${f}.colors must be 1–${MAX_PAINT_PATTERN_COLORS} [r, g, b] colours`);
      for (const k of ['scale', 'warp', 'coverage', 'seed']) optNum(d, k, f);
      optAxis(d, 'axis', f);
      if (d.anchors !== undefined && (!Array.isArray(d.anchors) || d.anchors.length > MAX_PAINT_PATTERN_ANCHORS || !d.anchors.every(a => isTuple(a, 3)))) fail(`${f}.anchors must be up to ${MAX_PAINT_PATTERN_ANCHORS} [x, y, z] points`);
      if (d.scope !== undefined) {
        const s = d.scope;
        if (!isPlainObject(s)) fail(`${f}.scope must be an object`);
        onlyKeys(s, ['label', 'above', 'below', 'box', 'sphere'], `${f}.scope`);
        if (s.label !== undefined && typeof s.label !== 'string') fail(`${f}.scope.label must be a string`);
        for (const k of ['above', 'below'] as const) {
          const p = s[k];
          if (p === undefined) continue;
          if (!isPlainObject(p)) fail(`${f}.scope.${k} must be { axis, at }`);
          onlyKeys(p, ['axis', 'at'], `${f}.scope.${k}`);
          if (!(typeof p.axis === 'string' && AXES.has(p.axis))) fail(`${f}.scope.${k}.axis must be 'x', 'y' or 'z'`);
          reqNum(p, 'at', `${f}.scope.${k}`);
        }
        if (s.box !== undefined) {
          if (!isPlainObject(s.box)) fail(`${f}.scope.box must be { min, max }`);
          onlyKeys(s.box, ['min', 'max'], `${f}.scope.box`);
          reqTuple(s.box, 'min', 3, `${f}.scope.box`); reqTuple(s.box, 'max', 3, `${f}.scope.box`);
        }
        if (s.sphere !== undefined) {
          if (!isPlainObject(s.sphere)) fail(`${f}.scope.sphere must be { center, radius }`);
          onlyKeys(s.sphere, ['center', 'radius'], `${f}.scope.sphere`);
          reqTuple(s.sphere, 'center', 3, `${f}.scope.sphere`); reqNum(s.sphere, 'radius', `${f}.scope.sphere`);
        }
      }
      break;
    }
  }
}

/** Re-run the Worker-side `api.surface.*` validator on the main thread. */
function checkSurfaceOp(op: unknown): void {
  if (!isPlainObject(op) || !isSurfaceOpId(op.id) || !isPlainObject(op.params)) fail('surfaceOps entries need a known id and a params object');
  onlyKeys(op, ['id', 'params', 'scope'], 'surfaceOps entry');
  const opts: Record<string, unknown> = { ...op.params };
  if ('label' in opts || 'region' in opts || 'select' in opts) fail('surfaceOps params must not carry scope keys');
  if (op.scope !== undefined) {
    const s = op.scope;
    if (!isPlainObject(s)) fail('surfaceOps scope must be an object');
    if (s.kind === 'label') { onlyKeys(s, ['kind', 'label'], 'surfaceOps scope'); opts.label = s.label; }
    else if (s.kind === 'point') { onlyKeys(s, ['kind', 'point', 'radius'], 'surfaceOps scope'); opts.region = { point: s.point, radius: s.radius }; }
    else if (s.kind === 'select') { onlyKeys(s, ['kind', 'select'], 'surfaceOps scope'); opts.select = s.select; }
    else fail('surfaceOps scope kind must be label, point or select');
  }
  try {
    parseSurfaceOpts(op.id, opts);
  } catch (e) {
    fail(`surfaceOps: ${e instanceof Error ? e.message : String(e)}`);
  }
}

/** Re-normalize the captured Customizer schema with the same validator
 *  `api.params` uses (types, options, min/max/step, defaults). */
function checkParamsSchema(schema: unknown[]): ParamSpec[] {
  const raw: Record<string, unknown> = {};
  for (const p of schema) {
    if (!isPlainObject(p) || typeof p.key !== 'string' || typeof p.type !== 'string') fail('paramsSchema entries need string key and type');
    if (FORBIDDEN_KEYS.has(p.key) || Object.prototype.hasOwnProperty.call(raw, p.key)) fail(`paramsSchema key "${p.key}" is reserved or duplicated`);
    const { key, ...spec } = p;
    raw[key as string] = spec;
  }
  try {
    return normalizeParamSchema(raw);
  } catch (e) {
    fail(`paramsSchema: ${e instanceof Error ? e.message : String(e)}`);
  }
}

const MATERIAL_UNIT_FIELDS = ['metalness', 'roughness', 'clearcoat', 'transmission', 'opacity'] as const;

/** `api.material(...)` spec: known preset, 0..1 colour and PBR numbers. */
function checkMaterialSpec(m: unknown): void {
  if (!isPlainObject(m)) fail('materialSpec must be a plain object');
  onlyKeys(m, ['preset', 'color', ...MATERIAL_UNIT_FIELDS], 'materialSpec');
  if (m.preset !== undefined && !isMaterialPresetName(m.preset)) fail('materialSpec.preset is not a known preset');
  const inUnit = (n: unknown) => isFiniteNum(n) && n >= 0 && n <= 1;
  if (m.color !== undefined && !(isRgb(m.color) && (m.color as number[]).every(inUnit))) fail('materialSpec.color must be [r, g, b] in 0..1');
  for (const k of MATERIAL_UNIT_FIELDS) if (m[k] !== undefined && !inUnit(m[k])) fail(`materialSpec.${k} must be a number in 0..1`);
}

/**
 * Validate a MeshData from the Worker: typed-array classes, counts that match
 * the array lengths, and every triangle index inside the vertex range.
 * Returns an error string, or null when the mesh is well-formed.
 */
export function checkMeshData(m: unknown): string | null {
  if (!isPlainObject(m)) return 'mesh must be a plain object';
  const { vertProperties, triVerts, numVert, numTri, numProp } = m;
  if (!isOwnedView(vertProperties, Float32Array)) return 'mesh.vertProperties must be a Float32Array over its own buffer';
  if (!isOwnedView(triVerts, Uint32Array)) return 'mesh.triVerts must be a Uint32Array over its own buffer';
  if (!isNonNegInt(numVert) || !isNonNegInt(numTri)) return 'mesh.numVert / mesh.numTri must be non-negative integers';
  if (!isNonNegInt(numProp) || numProp < 3) return 'mesh.numProp must be an integer ≥ 3';
  if (vertProperties.length !== numVert * numProp) return 'mesh.vertProperties length does not match numVert × numProp';
  if (triVerts.length !== numTri * 3) return 'mesh.triVerts length does not match numTri × 3';
  for (let i = 0; i < triVerts.length; i++) {
    if (triVerts[i] >= numVert) return 'mesh.triVerts references a vertex out of range';
  }
  const { mergeFromVert, mergeToVert, runIndex, runOriginalID, triColors } = m;
  if (mergeFromVert !== undefined || mergeToVert !== undefined) {
    if (!isOwnedView(mergeFromVert, Uint32Array) || !isOwnedView(mergeToVert, Uint32Array)) return 'mesh.mergeFromVert / mergeToVert must be Uint32Arrays';
    if (mergeFromVert.length !== mergeToVert.length) return 'mesh.mergeFromVert / mergeToVert lengths differ';
  }
  if (runIndex !== undefined && !isOwnedView(runIndex, Uint32Array)) return 'mesh.runIndex must be a Uint32Array';
  if (runOriginalID !== undefined && !isOwnedView(runOriginalID, Uint32Array)) return 'mesh.runOriginalID must be a Uint32Array';
  if (triColors !== undefined) {
    if (!isOwnedView(triColors, Uint8Array)) return 'mesh.triColors must be a Uint8Array over its own buffer';
    if (triColors.length !== numTri * 3) return 'mesh.triColors length does not match numTri × 3';
  }
  return null;
}

/** Shape check for a VoxelGridTransfer (`VoxelGrid.fromTransfer` re-validates
 *  every key, colour and surfacing knob when the grid is rebuilt). */
function checkVoxelGridField(v: unknown, field: string): void {
  if (v === undefined || v === null) return;
  if (!isPlainObject(v)) fail(`${field} must be a plain object`);
  const { keys, colors, surfacing } = v;
  if (!isOwnedView(keys, Float64Array) || !isOwnedView(colors, Uint32Array) || keys.length !== colors.length) {
    fail(`${field} needs equal-length Float64Array keys and Uint32Array colors`);
  }
  if (!isPlainObject(surfacing) || typeof surfacing.mode !== 'string' || !isPlainData(surfacing)) fail(`${field}.surfacing must be a plain object`);
}

function checkMeshField(v: unknown, field: string, nullable: boolean): number | null {
  if (v === null || v === undefined) {
    if (!nullable) fail(`${field} is required`);
    return null;
  }
  const err = checkMeshData(v);
  if (err) fail(err);
  return (v as MeshData).numTri;
}

function checkDiagnostics(v: unknown, field: string): void {
  // optPlainArray → isPlainData: refuses cycles anywhere inside, incl. extra keys.
  const arr = optPlainArray(v, field);
  if (!arr) return;
  for (const d of arr) {
    if (!isPlainObject(d) || typeof d.message !== 'string') fail(`${field} entries need a string message`);
  }
}

/** The colour / label / op payload shared by execute_result and execute_preview. */
function checkModelPayload(msg: Record<string, unknown>, numTri: number | null): ParamSpec[] | undefined {
  const lme = msg.labelMapEntries;
  if (lme !== undefined && lme !== null) {
    if (!Array.isArray(lme)) fail('labelMapEntries must be an array');
    for (const e of lme) {
      if (!Array.isArray(e) || e.length !== 2 || typeof e[0] !== 'string' || !Array.isArray(e[1])) fail('labelMapEntries entries must be [string, number[]]');
      for (const id of e[1] as unknown[]) {
        if (!isNonNegInt(id) || (numTri !== null && id >= numTri)) fail('labelMapEntries triangle id out of range');
      }
    }
  }
  const lce = msg.labelColorEntries;
  if (lce !== undefined && lce !== null) {
    if (!Array.isArray(lce)) fail('labelColorEntries must be an array');
    for (const e of lce) {
      if (!Array.isArray(e) || e.length !== 2 || typeof e[0] !== 'string' || !isRgb(e[1])) fail('labelColorEntries entries must be [string, [r, g, b]]');
    }
  }
  const paintOps = optPlainArray(msg.paintOps, 'paintOps');
  if (paintOps) {
    for (const op of paintOps) {
      if (!isPlainObject(op) || typeof op.name !== 'string' || !isRgb(op.color)) fail('paintOps entries need a string name and [r, g, b] color');
      onlyKeys(op, ['name', 'color', 'descriptor'], 'paintOps entry');
      checkPaintDescriptor(op.descriptor);
    }
  }
  const surfaceOps = optPlainArray(msg.surfaceOps, 'surfaceOps');
  if (surfaceOps) {
    for (const op of surfaceOps) checkSurfaceOp(op);
  }
  if (msg.materialSpec !== undefined && msg.materialSpec !== null) {
    if (!isPlainData(msg.materialSpec)) fail('materialSpec must be plain data');
    checkMaterialSpec(msg.materialSpec);
  }
  const schema = optPlainArray(msg.paramsSchema, 'paramsSchema');
  const normalizedSchema = schema ? checkParamsSchema(schema) : undefined;
  const lost = optPlainArray(msg.lostLabels, 'lostLabels');
  if (lost && !lost.every(s => typeof s === 'string')) fail('lostLabels must be strings');
  const logs = optPlainArray(msg.logs, 'logs');
  if (logs && !logs.every(s => typeof s === 'string')) fail('logs must be strings');
  optBool(msg.renderOnly, 'renderOnly');
  optFinite(msg.workerMs, 'workerMs');
  optFinite(msg.engineHeapBytes, 'engineHeapBytes');
  checkManifoldFacts(msg.manifoldFacts, numTri);
  optFinite(msg.voxelCount, 'voxelCount');
  optFinite(msg.voxelPieceCount, 'voxelPieceCount');
  optFinite(msg.voxelRes, 'voxelRes');
  optBool(msg.voxelResMixed, 'voxelResMixed');
  checkVoxelGridField(msg.voxelGrid, 'voxelGrid');
  const counts = msg.sdfLabelCounts;
  if (counts !== undefined && counts !== null) {
    if (!isPlainObject(counts) || !isPlainData(counts)) fail('sdfLabelCounts must be a plain object');
    for (const [k, n] of Object.entries(counts)) {
      if (FORBIDDEN_KEYS.has(k) || typeof n !== 'number' || !Number.isFinite(n)) fail('sdfLabelCounts values must be finite numbers');
    }
  }
  return normalizedSchema;
}

function checkFraction(v: unknown): void {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 1) fail('fraction must be a number in [0, 1]');
}

/**
 * Validate one Worker → main message. On success returns the message typed as
 * a record; on failure returns why, plus the callId/type when they were
 * readable so the caller can fail the matching pending request.
 */
export function checkEngineWorkerMessage(data: unknown): WorkerMessageCheck {
  if (!isPlainObject(data)) return { ok: false, reason: 'message is not a plain object', callId: null, type: null };
  const type = typeof data.type === 'string' ? data.type : null;
  const callId = typeof data.callId === 'string' ? data.callId : null;
  if (type === null || !ENGINE_WORKER_MESSAGE_TYPES.has(type)) {
    return { ok: false, reason: `unknown message type ${JSON.stringify(String(data.type)).slice(0, 60)}`, callId, type: null };
  }
  let paramsSchema: ParamSpec[] | undefined;
  try {
    if (type !== 'ready' && data.callId !== null && data.callId !== undefined && typeof data.callId !== 'string') fail('callId must be a string');
    if (type !== 'ready' && type !== 'error' && callId === null) fail('callId is required');
    switch (type) {
      case 'ready':
        break;
      case 'error':
        if (typeof data.message !== 'string') fail('message must be a string');
        break;
      case 'execute_preview': {
        const numTri = checkMeshField(data.mesh, 'mesh', true);
        checkModelPayload(data, numTri);
        break;
      }
      case 'execute_result': {
        optString(data.error, 'error');
        const numTri = checkMeshField(data.mesh, 'mesh', true);
        checkDiagnostics(data.diagnostics, 'diagnostics');
        paramsSchema = checkModelPayload(data, numTri);
        break;
      }
      case 'validate_result': {
        const r = data.result;
        if (!isPlainObject(r) || typeof r.valid !== 'boolean') fail('result.valid must be a boolean');
        optString(r.error, 'result.error');
        checkDiagnostics(r.diagnostics, 'result.diagnostics');
        break;
      }
      case 'detect_includes_result': {
        const r = data.result;
        if (!Array.isArray(r) || !r.every(s => typeof s === 'string')) fail('result must be a string array');
        break;
      }
      case 'voxel_grid_result':
        optString(data.error, 'error');
        checkVoxelGridField(data.grid, 'grid');
        break;
      case 'exportSTEP_result':
        optString(data.error, 'error');
        if (data.blob !== null && data.blob !== undefined && !(data.blob instanceof Blob)) fail('blob must be a Blob');
        break;
      case 'importSTEPToBrep_result':
        optString(data.error, 'error');
        optString(data.filename, 'filename');
        break;
      case 'importSTEPToMesh_result':
        optString(data.error, 'error');
        checkMeshField(data.mesh, 'mesh', true);
        break;
      case 'clearBrepImports_result':
      case 'clearBrepShape_result':
        optString(data.error, 'error');
        break;
      case 'simplify_progress':
      case 'enhance_progress':
        checkFraction(data.fraction);
        break;
      case 'inspect_realm_result':
        if (!isPlainObject(data.report)) fail('report must be a plain object');
        break;
      case 'simplify_result':
      case 'enhance_result':
        optString(data.error, 'error');
        optBool(data.cancelled, 'cancelled');
        optBool(data.exceeded, 'exceeded');
        optFinite(data.triangleCount, 'triangleCount');
        optFinite(data.tolerance, 'tolerance');
        checkManifoldFacts(data.manifoldFacts, checkMeshField(data.mesh, 'mesh', true));
        optString(data.manifoldError, 'manifoldError');
        break;
    }
  } catch (e) {
    if (e instanceof Bad) return { ok: false, reason: e.message, callId, type };
    throw e;
  }
  return { ok: true, msg: data as Record<string, unknown> & { type: string }, ...(paramsSchema ? { paramsSchema } : {}) };
}
