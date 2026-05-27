import * as THREE from 'three';
import { getScene } from '../renderer/viewport';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { downloadBlob, getExportFilename } from './download';

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

/** Build the GLB blob for the current scene without triggering a download. */
export async function buildGLB(customName?: string): Promise<BuiltExport> {
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

export async function exportGLB(customName?: string): Promise<string> {
  const built = await buildGLB(customName);
  downloadBlob(built.blob, built.filename, 'GLB');
  return built.filename;
}
