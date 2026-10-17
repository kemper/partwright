// Seed markers — the Part Detection panel's seeds drawn in the viewport: a
// dot on the surface plus a floating name tag per seed, so the user can see
// where they clicked. The panel owns the interaction (drag, delete, hide);
// this module only draws and hit-tests.
//
// Dots are depth-tested (a seed behind the model is hidden like the surface
// it sits on) and sized from the model's bounding box, so they read the same
// on a 20 mm figurine and a 2 m scan. Name tags draw on top at a constant
// on-screen size, one per name (on its first seed) so fifty seeds don't
// bury the model in labels.

import * as THREE from 'three';
import { getCamera, getCanvas, getMeshGroup, getScene, requestRender } from '../renderer/viewport';
import type { SegSeed } from './types';

/** Dot radius as a fraction of the model's bounding-box diagonal. */
const DOT_FRACTION = 0.008;
/** Tag height as a fraction of the viewport height. */
const TAG_SCREEN_FRACTION = 0.026;

export interface SeedMarkers {
  update(seeds: SegSeed[], colorFor: (label: string) => string, highlight?: number | null): void;
  /** Move one marker without rebuilding (live drag feedback). */
  moveMarker(index: number, point: [number, number, number]): void;
  setVisible(visible: boolean): void;
  isVisible(): boolean;
  /** Seed index under a pointer event, or −1. */
  hitTest(evt: MouseEvent): number;
  dispose(): void;
}

export function createSeedMarkers(): SeedMarkers {
  const group = new THREE.Group();
  group.name = 'part-seed-markers';
  group.renderOrder = 10;
  getScene().add(group);
  let visible = true;
  const dots: THREE.Mesh[] = [];
  /** Name tag per seed index (only the first seed of each name has one). */
  const tags: (THREE.Sprite | null)[] = [];
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();

  function diagonal(): number {
    const box = new THREE.Box3().setFromObject(getMeshGroup());
    if (box.isEmpty()) return 10;
    return box.getSize(new THREE.Vector3()).length() || 10;
  }

  function clear(): void {
    for (const d of dots) { d.geometry.dispose(); (d.material as THREE.Material).dispose(); }
    for (const t of tags) if (t) { t.material.map?.dispose(); t.material.dispose(); }
    dots.length = 0;
    tags.length = 0;
    group.clear();
  }

  function tagTexture(text: string, color: string): { tex: THREE.CanvasTexture; aspect: number } {
    const c = document.createElement('canvas');
    const ctx = c.getContext('2d')!;
    const font = 'bold 28px sans-serif';
    ctx.font = font;
    const w = Math.ceil(ctx.measureText(text).width) + 24;
    c.width = w; c.height = 40;
    ctx.font = font;
    ctx.fillStyle = 'rgba(20,20,20,0.82)';
    ctx.beginPath();
    ctx.roundRect(0, 0, w, 40, 8);
    ctx.fill();
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, 6, 40);
    ctx.fillStyle = '#fff';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 14, 21);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return { tex, aspect: w / 40 };
  }

  const api: SeedMarkers = {
    update(seeds, colorFor, highlight = null) {
      clear();
      const diag = diagonal();
      const r = diag * DOT_FRACTION;
      // sizeAttenuation:false sprites are sized in view space at distance 1.
      const cam = getCamera();
      const tagH = TAG_SCREEN_FRACTION * 2 * Math.tan(THREE.MathUtils.degToRad(cam.fov / 2));
      const tagged = new Set<string>();
      seeds.forEach((s, i) => {
        const color = colorFor(s.label);
        const dot = new THREE.Mesh(
          new THREE.SphereGeometry(i === highlight ? r * 1.5 : r, 16, 12),
          new THREE.MeshBasicMaterial({ color }),
        );
        dot.position.set(s.point[0], s.point[1], s.point[2]);
        dot.userData.seedIndex = i;
        // A white rim so a dot on a same-coloured part still reads.
        const rim = new THREE.Mesh(
          new THREE.SphereGeometry((i === highlight ? r * 1.5 : r) * 1.25, 16, 12),
          new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.BackSide }),
        );
        dot.add(rim);
        dots.push(dot);
        group.add(dot);
        if (tagged.has(s.label) && i !== highlight) { tags.push(null); return; }
        tagged.add(s.label);
        const { tex, aspect } = tagTexture(s.label, color);
        const tag = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true, sizeAttenuation: false }));
        tag.scale.set(tagH * aspect, tagH, 1);
        tag.center.set(-0.15, -0.3);
        tag.position.set(s.point[0], s.point[1], s.point[2]);
        tag.renderOrder = 11;
        tags.push(tag);
        group.add(tag);
      });
      group.visible = visible;
      requestRender();
    },
    moveMarker(index, point) {
      const dot = dots[index], tag = tags[index];
      if (!dot) return;
      dot.position.set(point[0], point[1], point[2]);
      tag?.position.set(point[0], point[1], point[2]);
      requestRender();
    },
    setVisible(v) {
      visible = v;
      group.visible = v;
      requestRender();
    },
    isVisible() { return visible; },
    hitTest(evt) {
      if (!visible || dots.length === 0) return -1;
      const rect = getCanvas().getBoundingClientRect();
      ndc.set(((evt.clientX - rect.left) / rect.width) * 2 - 1, -((evt.clientY - rect.top) / rect.height) * 2 + 1);
      raycaster.setFromCamera(ndc, getCamera());
      // Generous pick: test the rim (1.25× the dot) so a fingertip finds it.
      const hit = raycaster.intersectObjects(dots, true)[0];
      if (!hit) return -1;
      let o: THREE.Object3D | null = hit.object;
      while (o && o.userData.seedIndex === undefined) o = o.parent;
      return o ? (o.userData.seedIndex as number) : -1;
    },
    dispose() {
      clear();
      getScene().remove(group);
      requestRender();
    },
  };
  return api;
}
