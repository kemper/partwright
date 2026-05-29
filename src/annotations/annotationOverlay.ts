// Annotation overlay — owns the THREE.Group attached to the live viewport
// scene and provides a builder that constructs disposable Line2 + Sprite
// objects for offscreen scenes (multiview, renderSingleView, elevations,
// composite thumbnails).
//
// Each annotation object carries `userData.annotationId` so the select-mode
// raycaster can map a hit back to its source annotation. A subtle highlight
// ring is added behind the selected annotation when one exists.

import * as THREE from 'three';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import {
  getStrokes,
  getTexts,
  onChange,
  type StrokeAnnotation,
  type TextAnnotation,
} from './annotations';
import { onSelectionChange, getSelectedId } from './selectMode';
import { requestRender } from '../renderer/viewport';

let overlayGroup: THREE.Group | null = null;
let visible = true;
const visibilityListeners: Array<(visible: boolean) => void> = [];

const liveResolution = new THREE.Vector2(1, 1);

export function initAnnotationOverlay(scene: THREE.Scene): THREE.Group {
  overlayGroup = new THREE.Group();
  overlayGroup.name = 'annotation-overlay';
  overlayGroup.visible = visible;
  scene.add(overlayGroup);
  rebuildLiveOverlay();
  onChange(rebuildLiveOverlay);
  onSelectionChange(rebuildLiveOverlay);
  return overlayGroup;
}

export function getOverlayGroup(): THREE.Group | null {
  return overlayGroup;
}

export function getLiveResolution(): THREE.Vector2 {
  return liveResolution;
}

export function setLiveResolution(width: number, height: number): void {
  const w = Math.max(1, width);
  const h = Math.max(1, height);
  liveResolution.set(w, h);
  if (!overlayGroup) return;
  overlayGroup.traverse(obj => {
    if (obj instanceof Line2) {
      const mat = obj.material as LineMaterial;
      mat.resolution.copy(liveResolution);
    }
  });
}

export function setAnnotationsVisible(v: boolean): void {
  if (visible === v) return;
  visible = v;
  if (overlayGroup) overlayGroup.visible = v;
  requestRender();
  for (const fn of visibilityListeners) fn(v);
}

export function isAnnotationsVisible(): boolean {
  return visible;
}

export function onVisibilityChange(fn: (visible: boolean) => void): () => void {
  visibilityListeners.push(fn);
  return () => {
    const i = visibilityListeners.indexOf(fn);
    if (i >= 0) visibilityListeners.splice(i, 1);
  };
}

function rebuildLiveOverlay(): void {
  if (!overlayGroup) return;
  // Annotation children are tagged with userData.annotationId; everything
  // else (the session plane fill + outline) is preserved automatically.
  disposeAnnotationChildren(overlayGroup);

  const selected = getSelectedId();
  for (const s of getStrokes()) {
    overlayGroup.add(strokeToLine2(s, liveResolution, s.id === selected));
  }
  for (const t of getTexts()) {
    overlayGroup.add(textToSprite(t, t.id === selected));
  }
  overlayGroup.visible = visible;
  // The store's onChange fires this for programmatic (console/AI) annotation
  // add/clear too, which have no pointer event to drive an on-demand repaint.
  requestRender();
}

/** Build a fresh disposable group of Line2 + Sprite objects for an offscreen
 *  scene. `resolution` is the pixel size of the target render so LineMaterial
 *  can compute screen-space widths. Selection highlights are NEVER applied to
 *  offscreen renders — they are a viewport-only UX cue. */
export function buildStrokesGroup(resolution: THREE.Vector2): THREE.Group | null {
  if (!visible) return null;
  const strokes = getStrokes();
  const texts = getTexts();
  if (strokes.length === 0 && texts.length === 0) return null;
  const g = new THREE.Group();
  g.name = 'annotation-overlay-snapshot';
  for (const s of strokes) g.add(strokeToLine2(s, resolution, false));
  for (const t of texts) g.add(textToSprite(t, false));
  return g;
}

export function disposeStrokesGroup(g: THREE.Group): void {
  disposeAnnotationChildren(g);
}

/** Build a Line2 for a stroke. Tagged with userData.annotationId so the
 *  select-mode raycaster can identify it. */
export function strokeToLine2(s: StrokeAnnotation, resolution: THREE.Vector2, selected: boolean): Line2 {
  const positions = pointsToFlatPositions(s.points);
  const geo = new LineGeometry();
  geo.setPositions(positions);

  const mat = new LineMaterial({
    color: new THREE.Color(s.color[0], s.color[1], s.color[2]).getHex(),
    linewidth: selected ? s.width + 2 : s.width,
    worldUnits: false,
    resolution: resolution.clone(),
    depthTest: true,
    transparent: true,
    dashed: false,
    opacity: selected ? 1.0 : 0.95,
  });

  const line = new Line2(geo, mat);
  line.computeLineDistances();
  line.renderOrder = 999;
  line.frustumCulled = false;
  line.userData.annotationId = s.id;
  return line;
}

/** Update an existing Line2's geometry to a new point list.
 *
 *  Implementation note: `LineGeometry.setPositions()` allocates a new
 *  InstancedInterleavedBuffer and updates `instanceCount`, but does NOT
 *  clear the private `_maxInstanceCount` field that WebGLRenderer caches
 *  on first render. Without clearing it, every subsequent setPositions
 *  with a larger array gets silently clamped to the original instance
 *  count — strokes appear frozen during drag and only "snap" to full
 *  length on the next full rebuild. This is a known three.js bug:
 *  https://github.com/mrdoob/three.js/issues/27205
 *  https://github.com/mrdoob/three.js/issues/21488
 *  Deleting the private cache forces the renderer to use the up-to-date
 *  `instanceCount` on the next draw. */
export function setLine2Points(line: Line2, points: THREE.Vector3[]): void {
  const positions = pointsToFlatPositions(points);
  const geo = line.geometry as LineGeometry;
  geo.setPositions(positions);
  delete (geo as unknown as { _maxInstanceCount?: number })._maxInstanceCount;
  line.computeLineDistances();
}

function pointsToFlatPositions(points: THREE.Vector3[]): number[] {
  if (points.length === 0) return [0, 0, 0, 0, 0, 0];
  if (points.length === 1) {
    const p = points[0];
    return [p.x, p.y, p.z, p.x, p.y, p.z];
  }
  const out = new Array<number>(points.length * 3);
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    out[i * 3] = p.x;
    out[i * 3 + 1] = p.y;
    out[i * 3 + 2] = p.z;
  }
  return out;
}

function disposeAnnotationChildren(g: THREE.Group): void {
  // Remove only annotation children, preserving anything else (e.g. plane outline).
  const toRemove: THREE.Object3D[] = [];
  for (const child of g.children) {
    if (child.userData.annotationId !== undefined) toRemove.push(child);
  }
  for (const child of toRemove) {
    g.remove(child);
    if (child instanceof Line2) {
      child.geometry.dispose();
      const m = child.material;
      if (Array.isArray(m)) m.forEach(mm => mm.dispose());
      else m.dispose();
    } else if (child instanceof THREE.Sprite) {
      const mat = child.material as THREE.SpriteMaterial;
      mat.map?.dispose();
      mat.dispose();
    }
  }
}

/** Build a Sprite for a text annotation. */
export function textToSprite(t: TextAnnotation, selected: boolean): THREE.Sprite {
  const dpr = typeof window !== 'undefined' ? Math.max(1, window.devicePixelRatio || 1) : 1;
  const fontPx = Math.round(t.fontSizePx * dpr * 1.5);
  const padX = Math.round(fontPx * 0.4);
  const padY = Math.round(fontPx * 0.25);

  const meas = document.createElement('canvas').getContext('2d')!;
  meas.font = `bold ${fontPx}px sans-serif`;
  const metrics = meas.measureText(t.text || ' ');
  const textWidth = Math.ceil(metrics.width);

  const cw = Math.max(2, textWidth + padX * 2);
  const ch = Math.max(2, fontPx + padY * 2);

  const canvas = document.createElement('canvas');
  canvas.width = cw;
  canvas.height = ch;
  const ctx = canvas.getContext('2d')!;
  ctx.font = `bold ${fontPx}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  const radius = Math.min(ch / 2, 24 * dpr);
  ctx.fillStyle = selected ? 'rgba(40, 30, 60, 0.92)' : 'rgba(20, 20, 30, 0.78)';
  roundRect(ctx, 0, 0, cw, ch, radius);
  ctx.fill();

  if (selected) {
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.6)';
    ctx.lineWidth = Math.max(2, dpr * 1.5);
    roundRect(ctx, 1, 1, cw - 2, ch - 2, radius);
    ctx.stroke();
  }

  ctx.fillStyle = `rgb(${Math.round(t.color[0] * 255)},${Math.round(t.color[1] * 255)},${Math.round(t.color[2] * 255)})`;
  ctx.fillText(t.text, cw / 2, ch / 2);

  const texture = new THREE.CanvasTexture(canvas);
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.needsUpdate = true;

  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthTest: true,
    sizeAttenuation: false,
  });

  const sprite = new THREE.Sprite(material);
  sprite.position.copy(t.anchor);
  const scaleY = (t.fontSizePx * 2) / 1080;
  const scaleX = scaleY * (cw / ch);
  sprite.scale.set(scaleX, scaleY, 1);
  sprite.center.set(0.5, -0.1);
  sprite.renderOrder = 1001;
  sprite.userData.annotationId = t.id;
  return sprite;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}
