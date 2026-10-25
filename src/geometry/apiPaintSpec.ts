// The region-descriptor kinds `api.paint.*` (the manifold-js model-code paint
// recorder, engines/manifoldJs.ts) can emit. ONE shared constant (#1090): the
// recorder types its paint ops against it, and the Worker→main message
// validator (workerMessageValidation.ts) allow-lists exactly these kinds, so the
// two can't drift — a new paint op must be added here or it won't compile in the
// recorder, and a descriptor kind the recorder never emits (imagePaint,
// brushStroke, colorFlood, …) can't be smuggled to the main-thread resolver.
// Dependency-free leaf.

export const API_PAINT_DESCRIPTOR_KINDS = ['box', 'slab', 'cylinder', 'byLabel', 'pattern'] as const;

export type ApiPaintDescriptorKind = typeof API_PAINT_DESCRIPTOR_KINDS[number];
