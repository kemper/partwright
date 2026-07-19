// Animation export — canned viewport recordings, the useful sliver of
// Blender's animation system for a CAD tool: a turntable spin, an exploded-view
// pull-apart, and a Customizer-parameter sweep, each captured straight off the
// live WebGL canvas into a WebM (or whatever container MediaRecorder offers)
// and downloaded like any other export.
//
// The recorder plays every animation in REAL TIME while MediaRecorder captures
// the canvas stream — no frame-by-frame encoder dependency. Anything expensive
// (param-sweep geometry) is precomputed *before* recording starts, so playback
// is a cheap mesh swap per frame and the wall-clock capture stays smooth.
//
// This is a feature layer above the renderer: it drives the viewport through
// its public accessors (camera pose, updateMesh) and restores everything it
// touched when done.

import type { MeshData } from '../geometry/types';
import { getCanvas, getCameraPose, setCameraPose, updateMesh } from '../renderer/viewport';
import { downloadBlob, getExportFilename } from './download';

export class AnimationExportError extends Error {}

/** Pick the best MediaRecorder container available. */
function pickMimeType(): string {
  const candidates = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4'];
  if (typeof MediaRecorder === 'undefined') {
    throw new AnimationExportError('MediaRecorder is not available in this browser — cannot record video.');
  }
  for (const c of candidates) {
    if (MediaRecorder.isTypeSupported(c)) return c;
  }
  return ''; // let the browser pick its default
}

/** Record the viewport canvas while `animate` runs. `animate` receives a
 *  `frame(t)` callback it should drive from rAF with t ∈ [0,1]. */
async function recordCanvas(
  seconds: number,
  animate: (onDone: () => void) => void,
): Promise<Blob> {
  const canvas = getCanvas();
  const mimeType = pickMimeType();
  const stream = canvas.captureStream(30);
  const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
  const chunks: BlobPart[] = [];
  recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };

  const done = new Promise<Blob>((resolve, reject) => {
    recorder.onstop = () => resolve(new Blob(chunks, { type: mimeType || 'video/webm' }));
    recorder.onerror = () => reject(new AnimationExportError('Video recording failed.'));
  });

  recorder.start(250);
  animate(() => {
    // A short grace frame so the last painted frame lands in the stream.
    setTimeout(() => { try { recorder.stop(); } catch { /* already stopped */ } stream.getTracks().forEach(t => t.stop()); }, 120);
  });
  // Watchdog: never hang forever if rAF stalls (hidden tab).
  const watchdog = setTimeout(() => { try { recorder.stop(); } catch { /* ok */ } }, (seconds + 10) * 1000);
  try {
    return await done;
  } finally {
    clearTimeout(watchdog);
  }
}

/** Drive `frame(t)` from requestAnimationFrame over `seconds`, then call done. */
function playTimeline(seconds: number, frame: (t: number) => void, onDone: () => void): void {
  const start = performance.now();
  const tick = (): void => {
    const t = Math.min((performance.now() - start) / (seconds * 1000), 1);
    frame(t);
    if (t < 1) requestAnimationFrame(tick);
    else onDone();
  };
  requestAnimationFrame(tick);
}

const easeInOut = (t: number): number => t < 0.5 ? 2 * t * t : 1 - 2 * (1 - t) * (1 - t);

export interface TurntableOpts {
  /** Duration of the clip (default 6 s). */
  seconds?: number;
  /** Full revolutions over the clip (default 1). */
  revolutions?: number;
}

/** Record the camera orbiting the model once around the vertical axis, from
 *  its current pose. Returns the recorded blob (caller downloads). */
export async function recordTurntable(opts: TurntableOpts = {}): Promise<Blob> {
  const seconds = opts.seconds ?? 6;
  const revolutions = opts.revolutions ?? 1;
  const pose = getCameraPose();
  const dx = pose.position[0] - pose.target[0];
  const dy = pose.position[1] - pose.target[1];
  const r = Math.hypot(dx, dy);
  const a0 = Math.atan2(dy, dx);
  const z = pose.position[2];
  try {
    return await recordCanvas(seconds, (onDone) => {
      playTimeline(seconds, (t) => {
        const a = a0 + t * revolutions * Math.PI * 2;
        setCameraPose({
          position: [pose.target[0] + r * Math.cos(a), pose.target[1] + r * Math.sin(a), z],
          target: pose.target,
        });
      }, onDone);
    });
  } finally {
    setCameraPose(pose);
  }
}

export interface ExplodePart {
  mesh: MeshData;
  /** Component centroid (bbox center), used to derive its explode direction. */
  center: [number, number, number];
}

export interface ExplodeOpts {
  seconds?: number;
  /** How far parts travel, as a multiple of their distance from the assembly
   *  center (default 0.8 — parts end 1.8× from center). */
  spread?: number;
}

/** Concatenate parts into one MeshData with each part offset by its explode
 *  vector × `k`. Buffers are reused across frames via the returned closure. */
export function makeExplodedMeshBuilder(parts: ExplodePart[]): (k: number) => MeshData {
  let totalVerts = 0, totalTris = 0;
  for (const p of parts) { totalVerts += p.mesh.numVert; totalTris += p.mesh.numTri; }
  const numProp = parts[0]?.mesh.numProp ?? 3;
  const vertProperties = new Float32Array(totalVerts * numProp);
  const triVerts = new Uint32Array(totalTris * 3);
  const hasColors = parts.every(p => p.mesh.triColors && p.mesh.triColors.length >= p.mesh.numTri * 3);
  const triColors = hasColors ? new Uint8Array(totalTris * 3) : undefined;
  // Assembly center = mean of part centers.
  const c: [number, number, number] = [0, 0, 0];
  for (const p of parts) { c[0] += p.center[0] / parts.length; c[1] += p.center[1] / parts.length; c[2] += p.center[2] / parts.length; }

  // Static index/color layout — computed once.
  {
    let vOff = 0, tOff = 0;
    for (const p of parts) {
      const m = p.mesh;
      for (let i = 0; i < m.numTri * 3; i++) triVerts[tOff * 3 + i] = m.triVerts[i] + vOff;
      if (triColors && m.triColors) triColors.set(m.triColors.subarray(0, m.numTri * 3), tOff * 3);
      vOff += m.numVert;
      tOff += m.numTri;
    }
  }

  return (k: number): MeshData => {
    let vOff = 0;
    for (const p of parts) {
      const m = p.mesh;
      const ox = (p.center[0] - c[0]) * k;
      const oy = (p.center[1] - c[1]) * k;
      const oz = (p.center[2] - c[2]) * k;
      for (let v = 0; v < m.numVert; v++) {
        const src = v * m.numProp;
        const dst = (vOff + v) * numProp;
        vertProperties[dst] = m.vertProperties[src] + ox;
        vertProperties[dst + 1] = m.vertProperties[src + 1] + oy;
        vertProperties[dst + 2] = m.vertProperties[src + 2] + oz;
        for (let extra = 3; extra < numProp; extra++) vertProperties[dst + extra] = m.vertProperties[src + extra];
      }
      vOff += m.numVert;
    }
    return { vertProperties, triVerts, numVert: totalVerts, numTri: totalTris, numProp, triColors };
  };
}

/** Record an exploded-view animation: parts ease outward from the assembly
 *  center, hold, and ease back. The caller supplies the decomposed parts and
 *  restores the live mesh afterwards. */
export async function recordExplode(parts: ExplodePart[], opts: ExplodeOpts = {}): Promise<Blob> {
  if (parts.length < 2) {
    throw new AnimationExportError(`Exploded view needs a multi-part model — this one has ${parts.length} component${parts.length === 1 ? '' : 's'}.`);
  }
  const seconds = opts.seconds ?? 6;
  const spread = opts.spread ?? 0.8;
  const build = makeExplodedMeshBuilder(parts);
  return recordCanvas(seconds, (onDone) => {
    playTimeline(seconds, (t) => {
      // out (0→0.4), hold (0.4→0.6), back (0.6→1)
      const phase = t < 0.4 ? easeInOut(t / 0.4) : t < 0.6 ? 1 : 1 - easeInOut((t - 0.6) / 0.4);
      updateMesh(build(phase * spread), { skipAutoFrame: true });
    }, onDone);
  });
}

export interface ParamSweepFrame {
  value: number;
  mesh: MeshData;
}

export interface ParamSweepOpts {
  seconds?: number;
  /** Ping-pong back to the start value (default true). */
  pingPong?: boolean;
}

/** Record a parameter sweep from precomputed frames (one mesh per value —
 *  the caller runs the model for each). Playback crossfades by nearest frame. */
export async function recordParamSweep(frames: ParamSweepFrame[], opts: ParamSweepOpts = {}): Promise<Blob> {
  if (frames.length < 2) throw new AnimationExportError('Parameter sweep needs at least 2 computed frames.');
  const seconds = opts.seconds ?? 6;
  const pingPong = opts.pingPong !== false;
  let lastIdx = -1;
  return recordCanvas(seconds, (onDone) => {
    playTimeline(seconds, (t) => {
      const phase = pingPong ? (t < 0.5 ? t * 2 : 2 - t * 2) : t;
      const idx = Math.min(frames.length - 1, Math.round(phase * (frames.length - 1)));
      if (idx !== lastIdx) {
        lastIdx = idx;
        updateMesh(frames[idx].mesh, { skipAutoFrame: true });
      }
    }, onDone);
  });
}

/** Download a recorded animation blob with the standard export naming, the
 *  animation kind suffixed before the extension (`mypart-turntable.webm`). */
export function downloadAnimation(blob: Blob, label: string): string {
  const ext = blob.type.includes('mp4') ? 'mp4' : 'webm';
  const filename = getExportFilename(ext).replace(new RegExp(`\\.${ext}$`), `-${label}.${ext}`);
  downloadBlob(blob, filename, 'Animation');
  return filename;
}
