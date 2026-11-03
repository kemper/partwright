// Capture an annotation view — the current frame of the live viewport with the
// in-scope marks drawn on it — plus the camera, the marks projected to image
// coordinates, and what each mark points at on the model (ray-cast from the
// same camera, so a circle drawn around a feature reports the part inside it).
//
// main.ts configures the ray caster (it owns the current mesh + label map) and
// the model context via configureViewCapture(); the UI and the console API
// both call captureAnnotationView().

import * as THREE from 'three';
import { getCamera, getCameraPose, getRenderer, getScene, requestRender } from '../renderer/viewport';
import { renderPoseCanvas } from '../renderer/multiview';
import type { MeshData } from '../geometry/types';
import {
  getStrokes,
  getTexts,
  serializeScoped,
  isDraftScope,
  clearDrafts,
  deserializeList,
} from './annotations';
import { buildGroupFromAnnotations, disposeStrokesGroup, getOverlayGroup, showViewMarks } from './annotationOverlay';
import { getSelectedId, setSelectedId } from './selectionState';
import { restoreCameraView } from './sessionPlane';
import {
  addAnnotationView,
  getAnnotationViewSessionId,
  newAnnotationViewId,
  nextViewTitle,
  updateAnnotationView,
} from './annotationViews';
import {
  describeViewHits,
  decimate,
  isClosedLoop,
  strokeSamplePoints,
  summarizeHits,
  type AnnotationView,
  type AnnotationViewContext,
  type AnnotationViewHit,
  type AnnotationViewMark2D,
} from './annotationViewTypes';
import { getConfig } from '../config/appConfig';
import { attachToAiComposer } from '../ui/aiComposerBridge';
import { isQuotaError } from '../storage/quota';


export interface ViewCaptureHost {
  /** Cast a world ray at the current model: the nearest front-face hit and
   *  the labelled part it landed on, or null on a miss. */
  castRay: (origin: [number, number, number], direction: [number, number, number]) => { point: [number, number, number]; part: string | null } | null;
  /** Which object/version is showing. */
  context: () => AnnotationViewContext;
  /** The mesh the viewport currently shows (for re-rendering a view). */
  mesh: () => MeshData | null;
}

let host: ViewCaptureHost | null = null;

export function configureViewCapture(h: ViewCaptureHost): void {
  host = h;
}

const STROKE_POINTS_2D = 64;

function toHex(c: [number, number, number]): string {
  return '#' + c.map(v => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, '0')).join('');
}

function project(p: THREE.Vector3, camera: THREE.Camera): [number, number] {
  const v = p.clone().project(camera);
  const r4 = (n: number) => Math.round(n * 10000) / 10000;
  return [r4((v.x + 1) / 2), r4((1 - v.y) / 2)];
}

/** Ray-cast normalized image points from `camera` via the host. */
function castImagePoints(points: [number, number][], camera: THREE.Camera): ({ point: [number, number, number]; part: string | null } | null)[] {
  if (!host) return points.map(() => null);
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  return points.map(([u, v]) => {
    ndc.set(u * 2 - 1, 1 - v * 2);
    raycaster.setFromCamera(ndc, camera);
    const o = raycaster.ray.origin;
    const d = raycaster.ray.direction;
    return host!.castRay([o.x, o.y, o.z], [d.x, d.y, d.z]);
  });
}

/** Grab the live frame (without the session-plane fill/outline, the stroke
 *  preview or the selection highlight) as a scaled JPEG data URL. */
function grabFrame(): { image: string; width: number; height: number } {
  const renderer = getRenderer();
  const overlay = getOverlayGroup();
  const hidden: THREE.Object3D[] = [];
  overlay?.traverse(obj => {
    if (obj.visible && /^annotation-(session-plane|preview|view-marks)/.test(obj.name)) {
      obj.visible = false;
      hidden.push(obj);
    }
  });
  renderer.render(getScene(), getCamera());
  const src = renderer.domElement;
  const maxW = getConfig().ui.annotationViewMaxWidth;
  const scale = Math.min(1, maxW / Math.max(1, src.width));
  const width = Math.max(1, Math.round(src.width * scale));
  const height = Math.max(1, Math.round(src.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas.getContext('2d')!.drawImage(src, 0, 0, width, height);
  for (const obj of hidden) obj.visible = true;
  requestRender();
  return { image: canvas.toDataURL('image/jpeg', 0.88), width, height };
}

/** Save the current frame + in-scope marks as an annotation view. In Snapshot
 *  style the drafts move into the view (and are cleared from the frame); in
 *  Floating style the marks stay put — the view is a copy. */
export async function captureAnnotationView(opts: { title?: string } = {}): Promise<AnnotationView | { error: string }> {
  const sessionId = getAnnotationViewSessionId();
  if (!sessionId) return { error: 'No session is open — open or create a session first.' };
  const camera = getCamera();
  camera.updateMatrixWorld();
  const pose = getCameraPose();

  const prevSelection = getSelectedId();
  if (prevSelection) setSelectedId(null);
  const frame = grabFrame();
  if (prevSelection) setSelectedId(prevSelection);

  const marks2D: AnnotationViewMark2D[] = [];
  const hits: AnnotationViewHit[] = [];
  for (const s of getStrokes()) {
    const pts = s.points.map(p => project(p, camera));
    const closed = isClosedLoop(pts);
    marks2D.push({ id: s.id, kind: 'stroke', color: toHex(s.color), width: s.width, points: decimate(pts, STROKE_POINTS_2D), closed });
    hits.push(summarizeHits({ id: s.id, kind: 'stroke' }, castImagePoints(strokeSamplePoints(pts, closed), camera)));
  }
  for (const t of getTexts()) {
    const at = project(t.anchor, camera);
    marks2D.push({ id: t.id, kind: 'text', color: toHex(t.color), text: t.text, at });
    const d = 0.01;
    const ring: [number, number][] = [at, [at[0] - d, at[1]], [at[0] + d, at[1]], [at[0], at[1] - d], [at[0], at[1] + d]];
    hits.push(summarizeHits({ id: t.id, kind: 'text', text: t.text }, castImagePoints(ring, camera)));
  }

  const view: AnnotationView = {
    id: newAnnotationViewId(),
    sessionId,
    createdAt: Date.now(),
    title: opts.title?.trim() || nextViewTitle(),
    camera: {
      position: pose.position,
      target: pose.target,
      up: [camera.up.x, camera.up.y, camera.up.z],
      fov: camera.fov,
      aspect: camera.aspect,
    },
    image: frame.image,
    width: frame.width,
    height: frame.height,
    marks: serializeScoped(),
    marks2D,
    hits,
    context: host?.context() ?? {},
  };
  try {
    await addAnnotationView(view);
  } catch (err) {
    return {
      error: isQuotaError(err)
        ? 'Browser storage is full — the view was not saved. Delete old views or sessions, or lower "Annotation view width" in Advanced Settings.'
        : `Could not save the view: ${(err as Error)?.message ?? String(err)}`,
    };
  }
  if (isDraftScope()) clearDrafts();
  return view;
}

/** Snap the live camera back to a view's camera and redraw its marks there
 *  (`marks: false` moves the camera only). The marks stay until
 *  hideAnnotationViewMarks / another view / Annotate closes. */
export function restoreAnnotationViewCamera(view: AnnotationView, opts: { marks?: boolean } = {}): void {
  restoreCameraView({ position: view.camera.position, target: view.camera.target, up: view.camera.up });
  if (opts.marks !== false) showViewMarks(view.id, deserializeList(view.marks));
  requestRender();
}

/** Render the CURRENT model from a view's exact camera (white agent
 *  background), with the view's marks drawn on top unless `marks: false`.
 *  Returns a PNG data URL, or null when there's no model. */
export function renderAnnotationViewImage(view: AnnotationView, opts: { marks?: boolean; width?: number } = {}): string | null {
  const mesh = host?.mesh();
  if (!mesh) return null;
  const width = Math.max(64, Math.min(2048, Math.round(opts.width ?? Math.min(view.width, 1024))));
  const height = Math.max(64, Math.round(width / Math.max(0.1, view.camera.aspect)));
  const overlay = opts.marks === false ? null : buildGroupFromAnnotations(deserializeList(view.marks), new THREE.Vector2(width, height));
  try {
    return renderPoseCanvas(mesh, view.camera, { width, height, overlay }).toDataURL('image/png');
  } finally {
    if (overlay) disposeStrokesGroup(overlay);
  }
}

/** The line staged in the chat input alongside an attached view's image. */
export function annotationViewChatText(view: AnnotationView): string {
  return `[Annotation view "${view.title}" (${view.id}): ${describeViewHits(view)}. Exact camera saved — viewAnnotationView re-renders the current model from it.]`;
}

/** Stage a view's captured frame + a one-line summary in the AI chat input
 *  (nothing is sent). */
export async function attachAnnotationViewToChat(view: AnnotationView): Promise<{ attached: true } | { error: string }> {
  const m = /^data:(image\/(?:png|jpeg|webp|gif));base64,(.*)$/.exec(view.image);
  if (!m) return { error: 'This view has no usable image.' };
  const ok = attachToAiComposer(
    { mediaType: m[1] as 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif', data: m[2], label: view.title },
    annotationViewChatText(view),
  );
  if (!ok) return { error: 'The AI panel is not available.' };
  // The image is already staged; failing to record the timestamp is cosmetic.
  await updateAnnotationView(view.id, { attachedAt: Date.now() }).catch(err => console.warn('Annotation views: attach stamp failed', err));
  return { attached: true };
}
