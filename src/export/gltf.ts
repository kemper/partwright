import * as THREE from 'three';
import { getScene, withExportColors, meshGLToBufferGeometry } from '../renderer/viewport';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { downloadBlob, getExportFilename, getExportTitle } from './download';
import { assertFiniteMesh, DEFAULT_COLOR_HEX } from './meshClean';
import { gridLayout, uniquePartStem, type ExportPart } from './multiPart';
import type { MeshData } from '../geometry/types';

export interface BuiltExport {
  blob: Blob;
  filename: string;
  mimeType: string;
}

const EXCLUDED_NAMES = new Set([
  'phantom-reference',
  'dimension-lines',
  'measure-overlay',
  'clip-cap',
  'clip-plane-helper',
]);

function isWireframeMesh(obj: THREE.Object3D): boolean {
  if (!(obj instanceof THREE.Mesh)) return false;
  const mat = obj.material;
  const mats = Array.isArray(mat) ? mat : [mat];
  return mats.some(m => (m as THREE.Material & { wireframe?: boolean }).wireframe === true);
}

function shouldExcludeFromExport(obj: THREE.Object3D): boolean {
  if (EXCLUDED_NAMES.has(obj.name)) return true;
  if (isWireframeMesh(obj)) return true;
  if (obj instanceof THREE.GridHelper) return true;
  if (obj instanceof THREE.Line || obj instanceof THREE.LineSegments || obj instanceof THREE.Sprite) return true;
  return false;
}

/** Throws if any mesh that will be exported carries a non-finite (NaN/Infinity)
 *  vertex coordinate. GLB builds from the live Three.js scene rather than a
 *  MeshData, so it can't reuse assertFiniteMesh — but it needs the same guard so
 *  every export path (menu button AND window.partwright.exportGLB/exportGLBData)
 *  fails loudly instead of writing garbage floats. Run after excluded objects
 *  are hidden so only the geometry GLTFExporter will actually serialize is
 *  checked (the exporter skips invisible objects by default). */
function assertFiniteExportableScene(scene: THREE.Object3D): void {
  scene.traverse(obj => {
    if (!obj.visible || !(obj instanceof THREE.Mesh) || shouldExcludeFromExport(obj)) return;
    const pos = (obj.geometry as THREE.BufferGeometry).attributes?.position;
    if (!pos) return;
    const arr = pos.array;
    for (let i = 0; i < arr.length; i++) {
      if (!Number.isFinite(arr[i])) {
        throw new Error(`Cannot export: mesh "${obj.name || 'model'}" has a non-finite (NaN/Infinity) coordinate. Check the geometry before exporting.`);
      }
    }
  });
}

// NOTE on attribution: the other export formats (3MF metadata, STL header,
// OBJ/MTL comment) carry a "Partwright" attribution string. GLB intentionally
// does not. The glTF spec puts producer info in `asset.generator`, but
// three.js's GLTFExporter hard-codes that field and offers no public option to
// set it; the only alternative (stuffing it into `scene.userData` → `extras`)
// serializes inconsistently across three versions and risks emitting a
// malformed GLB. Since a broken export is far worse than a missing credit, we
// leave GLB attribution out rather than fight the exporter.

/** Serialize the live scene to a GLB blob, hiding non-exportable helpers first. */
async function serializeSceneToGLB(customName?: string): Promise<BuiltExport> {
  const scene = getScene();
  const exporter = new GLTFExporter();

  const hidden: THREE.Object3D[] = [];
  scene.traverse(obj => {
    if (obj.visible && shouldExcludeFromExport(obj)) {
      obj.visible = false;
      hidden.push(obj);
    }
  });

  try {
    assertFiniteExportableScene(scene);
    const result = await exporter.parseAsync(scene, { binary: true });
    const mimeType = 'model/gltf-binary';
    const blob = new Blob([result as ArrayBuffer], { type: mimeType });
    return { blob, filename: getExportFilename('glb', customName), mimeType };
  } finally {
    for (const obj of hidden) obj.visible = true;
  }
}

/** Build the GLB blob for the current model without triggering a download.
 *
 *  Pass `coloredMesh` (the result of `applyTriColors(currentMeshData)`) so the
 *  GLB bakes ALL color regions regardless of the viewport's paint-visibility
 *  flags — matching OBJ/3MF export semantics. The live scene's coloring is
 *  visibility-aware (`applyTriColorsIfVisible`), so without this the GLB would
 *  silently drop painted colors whenever the paint toggle (or a per-region eye)
 *  is off. When the mesh has no regions, `applyTriColors` returns it unchanged
 *  and the swapped geometry matches the display, so the no-paint case is
 *  unaffected. Omit `coloredMesh` to serialize the scene exactly as displayed. */
export async function buildGLB(customName?: string, coloredMesh?: MeshData | null): Promise<BuiltExport> {
  if (coloredMesh) {
    return withExportColors(coloredMesh, () => serializeSceneToGLB(customName));
  }
  return serializeSceneToGLB(customName);
}

export async function exportGLB(customName?: string, coloredMesh?: MeshData | null): Promise<string> {
  const built = await buildGLB(customName, coloredMesh);
  downloadBlob(built.blob, built.filename, 'GLB');
  return built.filename;
}

const DEFAULT_RGB = Number('0x' + DEFAULT_COLOR_HEX.slice(1));

/**
 * Build a multi-part GLB: each Session Part becomes a separately-named node in one
 * glTF scene, grid-arranged in XY so the parts don't overlap. glTF is a scene graph,
 * so this — named distinct meshes — is the format's natural multi-part form (no
 * triangle-soup merge). Painted parts (`mesh.triColors`) export as vertex colours;
 * unpainted parts use the default fill colour. Built off-screen from the baked part
 * meshes (NOT the live viewport), so it works for every part in the session, not just
 * the active one.
 */
export async function buildGLBProject(
  parts: ExportPart[],
  opts: { customName?: string; gridGapMm?: number } = {},
): Promise<BuiltExport> {
  if (parts.length === 0) throw new Error('Cannot export: no parts selected.');
  for (const p of parts) assertFiniteMesh(p.mesh);

  const slots = gridLayout(parts.map(p => p.mesh), opts.gridGapMm);
  const scene = new THREE.Scene();
  scene.name = getExportTitle();
  const used = new Set<string>();
  parts.forEach((p, i) => {
    const geometry = meshGLToBufferGeometry(p.mesh);
    const material = p.mesh.triColors
      ? new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.65, metalness: 0 })
      : new THREE.MeshStandardMaterial({ color: DEFAULT_RGB, roughness: 0.65, metalness: 0 });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = uniquePartStem(p.name, used, `part_${i + 1}`);
    const { dx, dy } = slots[i];
    mesh.position.set(dx, dy, 0);
    scene.add(mesh);
  });

  try {
    const exporter = new GLTFExporter();
    const result = await exporter.parseAsync(scene, { binary: true });
    const mimeType = 'model/gltf-binary';
    const blob = new Blob([result as ArrayBuffer], { type: mimeType });
    return { blob, filename: getExportFilename('glb', opts.customName), mimeType };
  } finally {
    // Dispose the temporary scene's GPU-less geometries/materials (no WebGL upload
    // happened, but BufferGeometry/Material still hold references — match the
    // app-wide resource-lifecycle rule).
    scene.traverse(obj => {
      if (obj instanceof THREE.Mesh) {
        obj.geometry.dispose();
        const mat = obj.material;
        (Array.isArray(mat) ? mat : [mat]).forEach(m => m.dispose());
      }
    });
  }
}
