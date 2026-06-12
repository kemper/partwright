// Wires the feature-layer subsystems (phantom geometry, annotation overlay,
// session plane) into the viewport's lifecycle via the leaf registry, so the
// viewport itself never imports them. Import this module once for its side
// effects before calling initViewport (see main.ts).

import * as THREE from 'three';
import { onViewportInit, onViewportResize, registerOffscreenOverlayProvider } from './viewportRegistry';
import { initPhantomGroup } from './phantomGeometry';
import { initAnnotationOverlay, setLiveResolution as setAnnotationResolution, buildStrokesGroup, disposeStrokesGroup } from '../annotations/annotationOverlay';
import { configureSessionPlane } from '../annotations/sessionPlane';

// Let the offscreen multi-view renderer (renderer layer) composite annotation
// marks into its snapshots without importing the annotations feature layer —
// the same inversion as the init/resize hooks (see viewportRegistry).
registerOffscreenOverlayProvider({
  build: (viewSizePx) => buildStrokesGroup(new THREE.Vector2(viewSizePx, viewSizePx)),
  dispose: (group) => disposeStrokesGroup(group),
});

onViewportInit(({ scene, controls }) => {
  // Phantom geometry group (for reference/fitment overlays)
  initPhantomGroup(scene);
  // Freehand annotation overlay (drawn surface marks)
  initAnnotationOverlay(scene);
  configureSessionPlane(controls);
});

onViewportResize((width, height) => {
  setAnnotationResolution(width, height);
});
