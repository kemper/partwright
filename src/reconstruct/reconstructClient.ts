// Main-thread client for the reconstruction Worker (`reconstructWorker.ts`).
// Same lifecycle idioms as `surface/engraveWorkerClient.ts`: lazy spawn,
// terminate-on-abort (the transpile is synchronous math — terminate+respawn
// is the only true interrupt), settled-guarded handlers. Requests are
// serialized per Worker; the app only issues one reconstruction at a time.

import type { SliceAxis, TriangleSoup } from './slice2d';
import type { ReconstructionResult, SectionCodeOptions } from './sectionCode';
import type { MeshDistanceReport } from './meshDistance';
import type { MeshProfile, ProfileOptions, SectionProbe } from './profileMesh';
import type { VoxelDiffOptions, VoxelDiffReport } from './voxelDiff';
import type { InscribedBox, InscribedCylinder, InscribedOptions } from './inscribed';

export class ReconstructAbortError extends Error {
  constructor() {
    super('reconstruction cancelled');
    this.name = 'ReconstructAbortError';
  }
}

export interface ReconstructRunControl {
  signal?: AbortSignal;
  onProgress?: (fraction: number) => void;
}

let worker: Worker | null = null;

function initWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL('./reconstructWorker.ts', import.meta.url), { type: 'module' });
  return worker;
}

function teardown(): void {
  worker?.terminate();
  worker = null;
}

function request<T>(payload: object, transfer: Transferable[], ctl?: ReconstructRunControl): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    if (ctl?.signal?.aborted) {
      reject(new ReconstructAbortError());
      return;
    }
    const w = initWorker();

    let settled = false;
    const cleanup = () => {
      ctl?.signal?.removeEventListener('abort', onAbort);
      w.onmessage = null;
      w.onerror = null;
    };
    const onAbort = () => {
      if (settled) return;
      settled = true;
      teardown(); // a terminated worker can't fire its handlers, so clean up here
      ctl?.signal?.removeEventListener('abort', onAbort);
      reject(new ReconstructAbortError());
    };

    w.onmessage = (e: MessageEvent<{ type: string; fraction?: number; result?: T; message?: string }>) => {
      const m = e.data;
      if (m.type === 'progress') {
        ctl?.onProgress?.(m.fraction ?? 0);
        return;
      }
      if (settled) return;
      settled = true;
      cleanup();
      if (m.type === 'done' && m.result !== undefined) resolve(m.result);
      else reject(new Error(m.message ?? 'reconstruction failed'));
    };
    w.onerror = (e) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error(e.message || 'reconstruction worker error'));
    };

    if (ctl?.signal) ctl.signal.addEventListener('abort', onAbort, { once: true });
    w.postMessage(payload, transfer);
  });
}

/** Transpile a triangle soup into manifold-js code in the Worker. The soup's
 *  buffer is copied (not transferred) — the caller still needs it for eval. */
export function generateCodeInWorker(
  soup: TriangleSoup,
  opts: Omit<SectionCodeOptions, 'onProgress'>,
  ctl?: ReconstructRunControl,
): Promise<ReconstructionResult> {
  return request<ReconstructionResult>({ type: 'generate', triangles: soup.triangles, opts }, [], ctl);
}

/** Multi-axis primitive-fit profile (or one targeted section when axis+at
 *  are set). Buffers are copied. */
export function profileInWorker(
  soup: TriangleSoup,
  opts: Omit<ProfileOptions, 'onProgress'> & { axis?: SliceAxis; at?: number },
  ctl?: ReconstructRunControl,
): Promise<MeshProfile | SectionProbe> {
  return request<MeshProfile | SectionProbe>({ type: 'profile', triangles: soup.triangles, opts }, [], ctl);
}

/** Voxel symmetric-difference with localized findings; buffers are copied. */
export function compareInWorker(
  target: TriangleSoup,
  candidate: TriangleSoup,
  opts?: VoxelDiffOptions,
  ctl?: ReconstructRunControl,
): Promise<VoxelDiffReport> {
  return request<VoxelDiffReport>(
    { type: 'compare', targetTriangles: target.triangles, candidateTriangles: candidate.triangles, opts },
    [],
    ctl,
  );
}

/** Largest inscribed box / z-cylinder inside the soup; buffer is copied. */
export function inscribedInWorker(
  soup: TriangleSoup,
  kind: 'box' | 'cylinder',
  opts?: InscribedOptions,
  ctl?: ReconstructRunControl,
): Promise<InscribedBox | InscribedCylinder> {
  return request<InscribedBox | InscribedCylinder>(
    { type: 'inscribed', triangles: soup.triangles, kind, opts },
    [],
    ctl,
  );
}

/** Chamfer/hausdorff report between two soups; buffers are copied. */
export function evaluateInWorker(
  target: TriangleSoup,
  candidate: TriangleSoup,
  samples?: number,
  ctl?: ReconstructRunControl,
): Promise<MeshDistanceReport> {
  return request<MeshDistanceReport>(
    { type: 'evaluate', targetTriangles: target.triangles, candidateTriangles: candidate.triangles, samples },
    [],
    ctl,
  );
}
