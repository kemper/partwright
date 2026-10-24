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
// Pure and dependency-free so it runs in the unit tier.

import type { MeshData } from './types';

/** Every message type the engine Worker legitimately sends. */
const ENGINE_WORKER_MESSAGE_TYPES: ReadonlySet<string> = new Set([
  'ready',
  'error',
  'execute_preview',
  'execute_result',
  'validate_result',
  'detect_includes_result',
  'exportSTEP_result',
  'importSTEPToBrep_result',
  'importSTEPToMesh_result',
  'clearBrepImports_result',
  'clearBrepShape_result',
  'simplify_progress',
  'simplify_result',
  'enhance_progress',
  'enhance_result',
]);

const FORBIDDEN_KEYS: ReadonlySet<string> = new Set(['__proto__', 'constructor', 'prototype']);
const MAX_DATA_DEPTH = 32;

export type WorkerMessageCheck =
  | { ok: true; msg: Record<string, unknown> & { type: string } }
  | { ok: false; reason: string; callId: string | null; type: string | null };

class Bad extends Error {}

function fail(reason: string): never { throw new Bad(reason); }

function isPlainObject(v: unknown): v is Record<string, unknown> {
  if (v === null || typeof v !== 'object') return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

/** Structured-clone-able plain JSON-ish data: primitives, arrays, plain objects,
 *  typed arrays. No Map/Set/Date/Blob, no `__proto__`/`constructor` keys,
 *  bounded depth. */
export function isPlainData(v: unknown, depth = 0): boolean {
  if (depth > MAX_DATA_DEPTH) return false;
  if (v === null || v === undefined) return true;
  const t = typeof v;
  if (t === 'string' || t === 'number' || t === 'boolean') return true;
  if (t !== 'object') return false;
  if (ArrayBuffer.isView(v)) return true;
  if (Array.isArray(v)) {
    for (const item of v) if (!isPlainData(item, depth + 1)) return false;
    return true;
  }
  if (!isPlainObject(v)) return false;
  for (const key of Object.keys(v)) {
    if (FORBIDDEN_KEYS.has(key)) return false;
    if (!isPlainData(v[key], depth + 1)) return false;
  }
  return true;
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
function isRgb(v: unknown): boolean {
  return Array.isArray(v) && v.length === 3 && v.every(n => typeof n === 'number' && Number.isFinite(n));
}

/**
 * Validate a MeshData from the Worker: typed-array classes, counts that match
 * the array lengths, and every triangle index inside the vertex range.
 * Returns an error string, or null when the mesh is well-formed.
 */
export function checkMeshData(m: unknown): string | null {
  if (!isPlainObject(m)) return 'mesh must be a plain object';
  const { vertProperties, triVerts, numVert, numTri, numProp } = m;
  if (!(vertProperties instanceof Float32Array)) return 'mesh.vertProperties must be a Float32Array';
  if (!(triVerts instanceof Uint32Array)) return 'mesh.triVerts must be a Uint32Array';
  if (!isNonNegInt(numVert) || !isNonNegInt(numTri)) return 'mesh.numVert / mesh.numTri must be non-negative integers';
  if (!isNonNegInt(numProp) || numProp < 3) return 'mesh.numProp must be an integer ≥ 3';
  if (vertProperties.length !== numVert * numProp) return 'mesh.vertProperties length does not match numVert × numProp';
  if (triVerts.length !== numTri * 3) return 'mesh.triVerts length does not match numTri × 3';
  for (let i = 0; i < triVerts.length; i++) {
    if (triVerts[i] >= numVert) return 'mesh.triVerts references a vertex out of range';
  }
  const { mergeFromVert, mergeToVert, runIndex, runOriginalID, triColors } = m;
  if (mergeFromVert !== undefined || mergeToVert !== undefined) {
    if (!(mergeFromVert instanceof Uint32Array) || !(mergeToVert instanceof Uint32Array)) return 'mesh.mergeFromVert / mergeToVert must be Uint32Arrays';
    if (mergeFromVert.length !== mergeToVert.length) return 'mesh.mergeFromVert / mergeToVert lengths differ';
  }
  if (runIndex !== undefined && !(runIndex instanceof Uint32Array)) return 'mesh.runIndex must be a Uint32Array';
  if (runOriginalID !== undefined && !(runOriginalID instanceof Uint32Array)) return 'mesh.runOriginalID must be a Uint32Array';
  if (triColors !== undefined) {
    if (!(triColors instanceof Uint8Array)) return 'mesh.triColors must be a Uint8Array';
    if (triColors.length !== numTri * 3) return 'mesh.triColors length does not match numTri × 3';
  }
  return null;
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
  const arr = optPlainArray(v, field);
  if (!arr) return;
  for (const d of arr) {
    if (!isPlainObject(d) || typeof d.message !== 'string') fail(`${field} entries need a string message`);
  }
}

/** The colour / label / op payload shared by execute_result and execute_preview. */
function checkModelPayload(msg: Record<string, unknown>, numTri: number | null): void {
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
      const d = op.descriptor;
      // Shape check only — the descriptor kinds are owned by the api.paint.*
      // recorder (box/slab/cylinder/byLabel/pattern/…) and grow with it, so an
      // allow-list here would silently drop new paint ops. The payload is
      // already plain data (optPlainArray above).
      if (!isPlainObject(d) || typeof d.kind !== 'string') fail('paintOps entries need a descriptor with a string kind');
    }
  }
  const surfaceOps = optPlainArray(msg.surfaceOps, 'surfaceOps');
  if (surfaceOps) {
    for (const op of surfaceOps) {
      if (!isPlainObject(op) || typeof op.id !== 'string' || !isPlainObject(op.params)) fail('surfaceOps entries need a string id and a params object');
    }
  }
  if (msg.materialSpec !== undefined && msg.materialSpec !== null && !(isPlainObject(msg.materialSpec) && isPlainData(msg.materialSpec))) {
    fail('materialSpec must be a plain object');
  }
  const schema = optPlainArray(msg.paramsSchema, 'paramsSchema');
  if (schema) {
    for (const p of schema) {
      if (!isPlainObject(p) || typeof p.key !== 'string' || typeof p.type !== 'string') fail('paramsSchema entries need string key and type');
    }
  }
  const lost = optPlainArray(msg.lostLabels, 'lostLabels');
  if (lost && !lost.every(s => typeof s === 'string')) fail('lostLabels must be strings');
  optBool(msg.renderOnly, 'renderOnly');
  optFinite(msg.workerMs, 'workerMs');
  optFinite(msg.engineHeapBytes, 'engineHeapBytes');
  optFinite(msg.voxelCount, 'voxelCount');
  optFinite(msg.voxelPieceCount, 'voxelPieceCount');
  optFinite(msg.voxelRes, 'voxelRes');
  optBool(msg.voxelResMixed, 'voxelResMixed');
  const counts = msg.sdfLabelCounts;
  if (counts !== undefined && counts !== null) {
    if (!isPlainObject(counts) || !isPlainData(counts)) fail('sdfLabelCounts must be a plain object');
    for (const [k, n] of Object.entries(counts)) {
      if (FORBIDDEN_KEYS.has(k) || typeof n !== 'number' || !Number.isFinite(n)) fail('sdfLabelCounts values must be finite numbers');
    }
  }
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
        checkModelPayload(data, numTri);
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
      case 'simplify_result':
      case 'enhance_result':
        optString(data.error, 'error');
        optBool(data.cancelled, 'cancelled');
        optBool(data.exceeded, 'exceeded');
        optFinite(data.triangleCount, 'triangleCount');
        optFinite(data.tolerance, 'tolerance');
        checkMeshField(data.mesh, 'mesh', true);
        break;
    }
  } catch (e) {
    if (e instanceof Bad) return { ok: false, reason: e.message, callId, type };
    throw e;
  }
  return { ok: true, msg: data as Record<string, unknown> & { type: string } };
}
