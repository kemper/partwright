// Wires the feature-layer subsystems (phantom geometry, annotation overlay,
// session plane) into the viewport's lifecycle via the leaf registry, so the
// viewport itself never imports them. Import this module once for its side
// effects before calling initViewport (see main.ts).

import { onViewportInit, onViewportResize } from './viewportRegistry';
import { initPhantomGroup } from './phantomGeometry';
import { initAnnotationOverlay, setLiveResolution as setAnnotationResolution } from '../annotations/annotationOverlay';
import { configureSessionPlane } from '../annotations/sessionPlane';

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
