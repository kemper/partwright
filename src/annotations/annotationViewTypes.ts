// Annotation views — the persisted shape of one Snapshot-style markup: the
// exact camera the user marked up from, the frame they saw (with their marks),
// the marks themselves, and what each mark points at on the model.
//
// LEAF: pure types + pure helpers only (no app imports beyond types), so the
// storage layer, the in-memory store and the unit tier can all import it.

import type { SerializedAnnotation } from './annotations';

/** Exact interactive-viewport camera at capture time. */
export interface AnnotationViewCamera {
  position: [number, number, number];
  target: [number, number, number];
  up: [number, number, number];
  /** Vertical field of view, degrees. */
  fov: number;
  /** Viewport width / height at capture. */
  aspect: number;
}

/** A mark projected into the captured frame. Coordinates are normalized image
 *  coordinates: (0,0) top-left, (1,1) bottom-right. */
export type AnnotationViewMark2D =
  | { id: string; kind: 'stroke'; color: string; width: number; points: [number, number][]; closed: boolean }
  | { id: string; kind: 'text'; color: string; text: string; at: [number, number] };

/** What one mark points at on the model, from ray-casting its screen points
 *  (and, for a closed loop, its interior) from the captured camera. */
export interface AnnotationViewHit {
  markId: string;
  kind: 'stroke' | 'text';
  text?: string;
  /** Rays cast for this mark. */
  samples: number;
  /** Rays that hit the model. */
  hits: number;
  /** Mean surface point of the hits (world units). */
  centroid?: [number, number, number];
  /** World-space box of the hit points. */
  bbox?: { min: [number, number, number]; max: [number, number, number] };
  /** Labelled parts the hits landed on, most-hit first. */
  parts: { name: string; hits: number }[];
}

/** Model state the view was made against. */
export interface AnnotationViewContext {
  objectId?: string;
  objectName?: string;
  versionIndex?: number;
}

export interface AnnotationView {
  id: string;
  sessionId: string;
  createdAt: number;
  title: string;
  camera: AnnotationViewCamera;
  /** Captured frame (marks included) as a JPEG data URL. */
  image: string;
  width: number;
  height: number;
  /** The marks as drawn (3D, on the frozen session plane) — re-renderable
   *  from `camera` against later geometry. */
  marks: SerializedAnnotation[];
  marks2D: AnnotationViewMark2D[];
  hits: AnnotationViewHit[];
  context: AnnotationViewContext;
  /** Epoch ms of the last "Attach to AI". */
  attachedAt?: number;
}

/** A view as exported in a session file (no ids tying it to this DB). */
export type ExportedAnnotationView = Omit<AnnotationView, 'id' | 'sessionId' | 'context'> & {
  context?: { objectName?: string; versionIndex?: number };
};

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isVec3 = (v: unknown): v is [number, number, number] => Array.isArray(v) && v.length === 3 && v.every(isNum);

/** Validate an imported view. Returns null for anything malformed so a bad
 *  entry is dropped rather than poisoning the history. */
export function parseExportedAnnotationView(raw: unknown): ExportedAnnotationView | null {
  if (!raw || typeof raw !== 'object') return null;
  const v = raw as Record<string, unknown>;
  const cam = v.camera as Record<string, unknown> | undefined;
  if (!cam || !isVec3(cam.position) || !isVec3(cam.target) || !isVec3(cam.up) || !isNum(cam.fov) || !isNum(cam.aspect)) return null;
  if (typeof v.image !== 'string' || !v.image.startsWith('data:image/')) return null;
  if (!isNum(v.width) || !isNum(v.height) || !isNum(v.createdAt)) return null;
  const ctx = v.context && typeof v.context === 'object' ? v.context as Record<string, unknown> : {};
  return {
    createdAt: v.createdAt,
    title: typeof v.title === 'string' ? v.title : 'View',
    camera: { position: cam.position, target: cam.target, up: cam.up, fov: cam.fov, aspect: cam.aspect },
    image: v.image,
    width: v.width,
    height: v.height,
    marks: Array.isArray(v.marks) ? v.marks as SerializedAnnotation[] : [],
    marks2D: Array.isArray(v.marks2D) ? v.marks2D as AnnotationViewMark2D[] : [],
    hits: Array.isArray(v.hits) ? v.hits as AnnotationViewHit[] : [],
    context: {
      ...(typeof ctx.objectName === 'string' ? { objectName: ctx.objectName } : {}),
      ...(isNum(ctx.versionIndex) ? { versionIndex: ctx.versionIndex } : {}),
    },
    ...(isNum(v.attachedAt) ? { attachedAt: v.attachedAt } : {}),
  };
}

/** Reduce a polyline to at most `max` points, keeping both ends. */
export function decimate<T>(points: readonly T[], max: number): T[] {
  if (points.length <= max) return [...points];
  const out: T[] = [];
  const step = (points.length - 1) / (max - 1);
  for (let i = 0; i < max; i++) out.push(points[Math.round(i * step)]);
  return out;
}

/** Whether a screen-space stroke reads as a closed loop (a "circle this"
 *  gesture): its ends meet within 25% of its larger extent and it spans a
 *  real area. */
export function isClosedLoop(points: readonly [number, number][]): boolean {
  if (points.length < 6) return false;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of points) {
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
  const extent = Math.max(maxX - minX, maxY - minY);
  if (extent <= 0 || Math.min(maxX - minX, maxY - minY) < extent * 0.2) return false;
  const [x0, y0] = points[0];
  const [x1, y1] = points[points.length - 1];
  return Math.hypot(x1 - x0, y1 - y0) <= extent * 0.25;
}

/** Even-odd point-in-polygon test. */
function insidePolygon(x: number, y: number, poly: readonly [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Sample points for ray-casting a stroke: up to `along` points on the line,
 *  plus (for a closed loop) a grid of up to `grid`×`grid` interior points. */
export function strokeSamplePoints(points: readonly [number, number][], closed: boolean, along = 24, grid = 6): [number, number][] {
  const out = decimate(points, along);
  if (!closed) return out;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of points) {
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
  for (let i = 0; i < grid; i++) {
    for (let j = 0; j < grid; j++) {
      const x = minX + ((i + 0.5) / grid) * (maxX - minX);
      const y = minY + ((j + 0.5) / grid) * (maxY - minY);
      if (insidePolygon(x, y, points)) out.push([x, y]);
    }
  }
  return out;
}

/** Fold per-ray results into one mark's hit summary. */
export function summarizeHits(
  mark: { id: string; kind: 'stroke' | 'text'; text?: string },
  rays: ({ point: [number, number, number]; part: string | null } | null)[],
): AnnotationViewHit {
  const pts = rays.filter((r): r is { point: [number, number, number]; part: string | null } => r !== null);
  const partCounts = new Map<string, number>();
  for (const r of pts) if (r.part) partCounts.set(r.part, (partCounts.get(r.part) ?? 0) + 1);
  const out: AnnotationViewHit = {
    markId: mark.id,
    kind: mark.kind,
    ...(mark.text !== undefined ? { text: mark.text } : {}),
    samples: rays.length,
    hits: pts.length,
    parts: [...partCounts].sort((a, b) => b[1] - a[1]).map(([name, hits]) => ({ name, hits })),
  };
  if (pts.length > 0) {
    const min: [number, number, number] = [Infinity, Infinity, Infinity];
    const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
    const sum = [0, 0, 0];
    for (const { point } of pts) {
      for (let k = 0; k < 3; k++) {
        sum[k] += point[k];
        if (point[k] < min[k]) min[k] = point[k];
        if (point[k] > max[k]) max[k] = point[k];
      }
    }
    const r3 = (n: number) => Math.round(n * 1000) / 1000;
    out.centroid = [r3(sum[0] / pts.length), r3(sum[1] / pts.length), r3(sum[2] / pts.length)];
    out.bbox = { min: [r3(min[0]), r3(min[1]), r3(min[2])], max: [r3(max[0]), r3(max[1]), r3(max[2])] };
  }
  return out;
}

/** One-line plain-words description of a view's hits — for the chat
 *  attachment text and the history list. */
export function describeViewHits(view: Pick<AnnotationView, 'hits' | 'marks2D'>): string {
  const strokes = view.marks2D.filter(m => m.kind === 'stroke').length;
  const texts = view.marks2D.filter(m => m.kind === 'text');
  const parts = new Map<string, number>();
  let onModel = 0;
  let total = 0;
  for (const h of view.hits) {
    total += h.samples;
    onModel += h.hits;
    for (const p of h.parts) parts.set(p.name, (parts.get(p.name) ?? 0) + p.hits);
  }
  const bits: string[] = [];
  if (strokes) bits.push(`${strokes} stroke${strokes === 1 ? '' : 's'}`);
  if (texts.length) bits.push(texts.map(t => `"${t.kind === 'text' ? t.text : ''}"`).join(', '));
  if (bits.length === 0) bits.push('no marks');
  if (parts.size > 0) {
    bits.push(`on ${[...parts].sort((a, b) => b[1] - a[1]).map(([n]) => n).join(', ')}`);
  } else if (total > 0) {
    bits.push(onModel === 0 ? 'off the model' : `${Math.round((onModel / total) * 100)}% on the model`);
  }
  return bits.join(' · ');
}
