import * as THREE from 'three';
import { getScene, withExportColors } from '../renderer/viewport';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { downloadBlob, getExportFilename } from './download';
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
