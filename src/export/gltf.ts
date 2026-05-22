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
