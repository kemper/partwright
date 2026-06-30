// Wires the feature-layer subsystems (phantom geometry, annotation overlay,
// session plane) into the viewport's lifecycle via the leaf registry, so the
// viewport itself never imports them. Import this module once for its side
// effects before calling initViewport (see main.ts).

import * as THREE from 'three';
import { onViewportInit, onViewportResize, registerOffscreenOverlayProvider } from './viewportRegistry';
import { initPhantomGroup } from './phantomGeometry';
import { initAnnotationOverlay, setLiveResolution as setAnnotationResolution, buildStrokesGroup, disposeStrokesGroup } from '../annotations/annotationOverlay';
import { configureSessionPlane } from '../annotations/sessionPlane';
import {
  initPointerOverlay,
  setPointerOverlayResolution,
  buildPointerSnapshotGroup,
  disposePointerSnapshotGroup,
} from '../annotations/pointerOverlay';

// Let the offscreen multi-view renderer (renderer layer) composite annotation
// marks into its snapshots without importing the annotations feature layer —
// the same inversion as the init/resize hooks (see viewportRegistry).
registerOffscreenOverlayProvider({
  build: (viewSizePx) => buildStrokesGroup(new THREE.Vector2(viewSizePx, viewSizePx)),
  dispose: (group) => disposeStrokesGroup(group),
});
// Same inversion for the AI-planning pointer overlay (labelled callouts +
// leader lines on the mesh surface). Registered separately so the registry
// composites both into one offscreen group per renderViews tile.
registerOffscreenOverlayProvider({
  build: (viewSizePx) => buildPointerSnapshotGroup(new THREE.Vector2(viewSizePx, viewSizePx)),
  dispose: (group) => disposePointerSnapshotGroup(group),
});

onViewportInit(({ scene, controls }) => {
  // Phantom geometry group (for reference/fitment overlays)
  initPhantomGroup(scene);
  // Freehand annotation overlay (drawn surface marks)
  initAnnotationOverlay(scene);
  // AI-planning pointer overlay (labelled mesh-surface callouts)
  initPointerOverlay(scene);
  configureSessionPlane(controls);
});

onViewportResize((width, height) => {
  setAnnotationResolution(width, height);
  setPointerOverlayResolution(width, height);
});
