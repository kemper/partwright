// Pointer overlay — owns the THREE.Group that draws AI-planning pointers
// (leader line + label sprite + optional phantom flood-fill preview) on
// top of the live mesh. Mirrors the pattern used by annotationOverlay.ts:
// the group is added to the scene via a viewportRegistry init hook, and a
// disposable copy is exported as an OffscreenOverlayProvider so the
// multiview renderer composites pointers into renderViews output too.
//
// The overlay's *triangle-preview* layer (the phantom highlight for a
// pointer's proposed flood-fill) is owned here rather than the panel so
// that the AI's `previewPointerPaint` tool — which doesn't open the panel —
// still renders a visible selection on the model when called.
//
// The flood-fill itself runs in this module so the renderer stays the
// single owner of the phantom mesh. Panel UI calls
// `setPointerPreview(id, hint)` to ask for one, and `clearPointerPreview`
// to drop it.

import * as THREE from 'three';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import {
  getPointers,
  onPointersChange,
  type PointerAnnotation,
  type PointerPaintHint,
} from './pointers';
import { requestRender } from '../renderer/viewport';
import {
  findConnectedFromSeed,
  findCoplanarRegion,
  findColorRegion,
  findNearestTriangle,
  type AdjacencyGraph,
} from '../color/adjacency';
import type { MeshData } from '../geometry/types';

let overlayGroup: THREE.Group | null = null;
const liveResolution = new THREE.Vector2(1, 1);
/** Mesh diagonal cached at the most recent rebuild. The leader-line length and
 *  label sprite scale are computed from this so a 5-unit cube and a 200-unit
 *  figure both get callouts proportional to the model rather than a single
 *  hard-coded magnitude. */
let modelScale = 50;

// Mesh accessor — main.ts sets this on every successful run so the overlay
// + preview can use the live triangles without importing from main (avoids
// a circular import through the renderer layer).
type MeshAccessor = () => { mesh: MeshData; adjacency: AdjacencyGraph; triColors?: Uint8Array | null } | null;
let meshAccessor: MeshAccessor = () => null;

export function configurePointerOverlay(accessor: MeshAccessor): void {
  meshAccessor = accessor;
}

// Active preview, if any. Cleared when the underlying pointer or mesh
// changes (rebuild will reflood from the fresh state).
let activePreview: { pointerId: string; hint: PointerPaintHint } | null = null;
let previewMesh: THREE.Mesh | null = null;

export function setPointerPreview(pointerId: string, hint: PointerPaintHint): void {
  activePreview = { pointerId, hint };
  rebuildLiveOverlay();
}

export function clearPointerPreview(): void {
  if (!activePreview) return;
  activePreview = null;
  rebuildLiveOverlay();
}

export function getActivePreview(): { pointerId: string; hint: PointerPaintHint } | null {
  return activePreview;
}

export function initPointerOverlay(scene: THREE.Scene): THREE.Group {
  overlayGroup = new THREE.Group();
  overlayGroup.name = 'pointer-overlay';
  scene.add(overlayGroup);
  rebuildLiveOverlay();
  onPointersChange(rebuildLiveOverlay);
  return overlayGroup;
}

export function setPointerOverlayResolution(width: number, height: number): void {
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

function rebuildLiveOverlay(): void {
  if (!overlayGroup) return;
  disposePointerChildren(overlayGroup);

  const ctx = meshAccessor();
  // Re-derive the model scale from the live mesh each rebuild so leader
  // length and label sprite size track the actual geometry (a re-run that
  // resizes the model from 5 units to 200 will resize its callouts to match
  // on the next refresh).
  if (ctx) modelScale = computeMeshDiagonal(ctx.mesh);
  for (const p of getPointers()) {
    if (p.hidden) continue;
    overlayGroup.add(buildLeaderLine(p, liveResolution));
    overlayGroup.add(buildLabelSprite(p));
  }
  // Phantom preview: a single highlighted triangle set for the active pointer.
  if (activePreview && ctx) {
    const p = getPointers().find(x => x.id === activePreview!.pointerId);
    if (p && !p.hidden) {
      const tris = resolvePointerTriangles(p, activePreview.hint, ctx.mesh, ctx.adjacency, ctx.triColors ?? null);
      if (tris.size > 0) {
        previewMesh = buildPreviewMesh(ctx.mesh, tris, p.proposedColor);
        if (previewMesh) {
          previewMesh.userData.pointerOverlayPreview = true;
          overlayGroup.add(previewMesh);
        }
      }
    }
  }
  requestRender();
}

/** Resolve a pointer + its paintHint into a triangle index set against the
 *  current mesh. Reused by the preview overlay AND by the AI's commit tool
 *  (the latter through `resolvePointerTrianglesForCommit` below). */
export function resolvePointerTriangles(
  pointer: PointerAnnotation,
  hint: PointerPaintHint,
  mesh: MeshData,
  adjacency: AdjacencyGraph,
  triColors: Uint8Array | null,
): Set<number> {
  // Always re-resolve from world coords — the cached `triangleId` may have
  // moved or been invalidated by a mesh edit since the pointer was dropped.
  let seedTri = pointer.triangleId;
  if (seedTri < 0 || seedTri >= mesh.numTri) {
    const near = findNearestTriangle(pointer.point, mesh, adjacency);
    if (near.triIndex < 0) return new Set();
    seedTri = near.triIndex;
  }
  switch (hint.kind) {
    case 'connected': {
      const cos = Math.cos(hint.maxDeviationDeg * Math.PI / 180);
      return findConnectedFromSeed(seedTri, adjacency, cos);
    }
    case 'coplanar': {
      const cos = Math.cos(hint.normalToleranceDeg * Math.PI / 180);
      return findCoplanarRegion(seedTri, adjacency, cos);
    }
    case 'colorFlood': {
      if (!triColors) return new Set();
      return findColorRegion(seedTri, adjacency, triColors, hint.colorTolerance);
    }
  }
}

function buildLeaderLine(p: PointerAnnotation, resolution: THREE.Vector2): Line2 {
  // Leader line: a short segment along the surface normal away from the
  // anchor, ending at the sprite's offset point. Length scales with the
  // model diagonal via a fixed multiple of the normal so the leader is
  // long enough to clear the surface but small enough not to dominate.
  const off = leaderOffset(p);
  const positions = [
    p.point[0], p.point[1], p.point[2],
    off[0], off[1], off[2],
  ];

  const geo = new LineGeometry();
  geo.setPositions(positions);

  const hex = leaderHex(p);
  const mat = new LineMaterial({
    color: hex,
    linewidth: 2,
    worldUnits: false,
    resolution: resolution.clone(),
    depthTest: false,
    transparent: true,
    dashed: p.stale || p.orphaned,
    dashSize: 0.4,
    gapSize: 0.25,
    opacity: p.orphaned ? 0.5 : 0.95,
  });

  const line = new Line2(geo, mat);
  line.computeLineDistances();
  line.renderOrder = 999;
  line.frustumCulled = false;
  line.userData.pointerId = p.id;
  return line;
}

function buildLabelSprite(p: PointerAnnotation): THREE.Sprite {
  const dpr = typeof window !== 'undefined' ? Math.max(1, window.devicePixelRatio || 1) : 1;
  const fontPx = Math.round(14 * dpr);
  const padX = Math.round(fontPx * 0.55);
  const padY = Math.round(fontPx * 0.35);

  const meas = document.createElement('canvas').getContext('2d')!;
  meas.font = `600 ${fontPx}px sans-serif`;
  const text = p.label || '(unnamed)';
  const metrics = meas.measureText(text);
  const textWidth = Math.ceil(metrics.width);

  const cw = Math.max(2, textWidth + padX * 2);
  const ch = Math.max(2, fontPx + padY * 2);
  const canvas = document.createElement('canvas');
  canvas.width = cw;
  canvas.height = ch;
  const ctx = canvas.getContext('2d')!;

  const bg = labelBg(p);
  ctx.fillStyle = bg;
  const radius = Math.min(ch / 2, 10 * dpr);
  roundRect(ctx, 0, 0, cw, ch, radius);
  ctx.fill();

  if (p.stale || p.orphaned) {
    ctx.strokeStyle = 'rgba(255, 196, 0, 0.9)';
    ctx.lineWidth = Math.max(2, dpr * 1.5);
    roundRect(ctx, 1, 1, cw - 2, ch - 2, radius);
    ctx.stroke();
  }

  ctx.font = `600 ${fontPx}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = labelText(p);
  ctx.fillText(text, cw / 2, ch / 2);

  // Small colour dot to the left of the text when a proposed colour is set.
  if (p.proposedColor) {
    const dotR = fontPx * 0.32;
    const dotX = padX * 0.55;
    const dotY = ch / 2;
    ctx.beginPath();
    ctx.arc(dotX, dotY, dotR, 0, Math.PI * 2);
    ctx.fillStyle = `rgb(${Math.round(p.proposedColor[0] * 255)},${Math.round(p.proposedColor[1] * 255)},${Math.round(p.proposedColor[2] * 255)})`;
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.7)';
    ctx.lineWidth = Math.max(1, dpr);
    ctx.stroke();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.needsUpdate = true;

  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthTest: false,
    // sizeAttenuation:true makes the sprite shrink with distance like the rest
    // of the geometry — so zooming out makes the label smaller proportionally
    // instead of dominating the frame the way the original screen-space
    // sizing did.
    sizeAttenuation: true,
  });

  const sprite = new THREE.Sprite(material);
  const off = leaderOffset(p);
  sprite.position.set(off[0], off[1], off[2]);
  // Sprite scale is in world units (because sizeAttenuation:true), so size
  // it as a fraction of the model diagonal — readable when framed but never
  // larger than the model itself.
  const scaleY = modelScale * 0.04;
  const scaleX = scaleY * (cw / ch);
  sprite.scale.set(scaleX, scaleY, 1);
  sprite.center.set(0.5, -0.1);
  sprite.renderOrder = 1001;
  sprite.userData.pointerId = p.id;
  return sprite;
}

function leaderOffset(p: PointerAnnotation): [number, number, number] {
  // Push the label a fraction of the model diagonal along the surface
  // normal. Scaling with the model means a 5-unit cube gets a short leader
  // and a 200-unit figure gets a proportional one — instead of one fixed
  // magnitude that's invisible on the big model and dominates the small one.
  const k = modelScale * 0.07;
  return [
    p.point[0] + p.normal[0] * k,
    p.point[1] + p.normal[1] * k,
    p.point[2] + p.normal[2] * k,
  ];
}

/** Mesh diagonal — the same shape-size proxy {@link computeMeshDiagonal}'s
 *  inline twin in pointers.ts uses. Cheap O(numVert) scan. */
function computeMeshDiagonal(mesh: MeshData): number {
  const { vertProperties, numProp, numVert } = mesh;
  if (numVert === 0) return 50;
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < numVert; i++) {
    const x = vertProperties[i * numProp];
    const y = vertProperties[i * numProp + 1];
    const z = vertProperties[i * numProp + 2];
    if (x < minX) minX = x; if (y < minY) minY = y; if (z < minZ) minZ = z;
    if (x > maxX) maxX = x; if (y > maxY) maxY = y; if (z > maxZ) maxZ = z;
  }
  const dx = maxX - minX, dy = maxY - minY, dz = maxZ - minZ;
  const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
  return d > 0 ? d : 50;
}

function leaderHex(p: PointerAnnotation): number {
  if (p.orphaned) return 0x999999;
  if (p.stale) return 0xffb020;
  if (p.status === 'painted') return 0x6b7280;
  if (p.status === 'approved') return 0x10b981;
  return 0x60a5fa; // proposed
}

function labelBg(p: PointerAnnotation): string {
  if (p.orphaned) return 'rgba(80,80,80,0.85)';
  if (p.stale) return 'rgba(60,40,0,0.88)';
  if (p.status === 'painted') return 'rgba(60,60,70,0.82)';
  if (p.status === 'approved') return 'rgba(16,40,30,0.88)';
  return 'rgba(20,30,55,0.88)';
}

function labelText(p: PointerAnnotation): string {
  if (p.orphaned) return 'rgba(255,255,255,0.7)';
  return '#f5f5f5';
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

function buildPreviewMesh(
  mesh: MeshData,
  tris: Set<number>,
  proposedColor: [number, number, number] | undefined,
): THREE.Mesh | null {
  if (tris.size === 0) return null;
  const { vertProperties, triVerts, numProp } = mesh;
  const positions = new Float32Array(tris.size * 9);
  let k = 0;
  for (const t of tris) {
    for (let i = 0; i < 3; i++) {
      const v = triVerts[t * 3 + i];
      positions[k++] = vertProperties[v * numProp];
      positions[k++] = vertProperties[v * numProp + 1];
      positions[k++] = vertProperties[v * numProp + 2];
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.computeVertexNormals();
  const hex = proposedColor
    ? new THREE.Color(proposedColor[0], proposedColor[1], proposedColor[2])
    : new THREE.Color(1.0, 0.95, 0.2);
  const mat = new THREE.MeshBasicMaterial({
    color: hex,
    transparent: true,
    opacity: 0.55,
    side: THREE.DoubleSide,
    depthTest: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  const m = new THREE.Mesh(geo, mat);
  m.renderOrder = 998;
  m.frustumCulled = false;
  return m;
}

/** Build a disposable copy of the pointer overlay for offscreen renders
 *  (multiview, thumbnails). Selection highlights are intentionally omitted
 *  — those are a viewport-only UX cue. */
export function buildPointerSnapshotGroup(resolution: THREE.Vector2): THREE.Group | null {
  const pts = getPointers();
  if (pts.length === 0) return null;
  const g = new THREE.Group();
  g.name = 'pointer-overlay-snapshot';
  for (const p of pts) {
    if (p.hidden) continue;
    g.add(buildLeaderLine(p, resolution));
    g.add(buildLabelSprite(p));
  }
  if (g.children.length === 0) return null;
  return g;
}

export function disposePointerSnapshotGroup(g: THREE.Group): void {
  disposePointerChildren(g);
}

function disposePointerChildren(g: THREE.Group): void {
  const toRemove: THREE.Object3D[] = [];
  for (const child of g.children) toRemove.push(child);
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
    } else if (child instanceof THREE.Mesh) {
      child.geometry.dispose();
      const m = child.material;
      if (Array.isArray(m)) m.forEach(mm => mm.dispose());
      else m.dispose();
      if (child === previewMesh) previewMesh = null;
    }
  }
}

/** Recompute the overlay because the live mesh changed under it. Called by
 *  main.ts after each successful run + after invalidation. */
export function refreshPointerOverlay(): void {
  rebuildLiveOverlay();
}
