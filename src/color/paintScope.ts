// "Paint within part" — the Paint panel's active scope (#1025).
//
// When the user picks a part (a label: `api.label` or a detected part of an
// import), every paint tool stamps `withinPart: <label>` on the descriptor it
// commits, and the region store clips the region to that part (see
// `clipToPart` in regions.ts). Brush, bucket, slab, box and image stamps then
// cannot bleed across the part's edge however wide the brush is.
//
// A leaf module: the paint tools read it, the Paint panel writes it, neither
// imports the other. The console API does NOT read this state — agents pass
// `withinPart` explicitly per call, so a scope the user left selected in the
// panel never silently clips an agent's paint.

import { removeRegion, type ColorRegion, type RegionDescriptor } from './regions';
import { showToast } from '../ui/toast';

let activeScope: string | null = null;
const listeners: (() => void)[] = [];

export function getPaintScope(): string | null {
  return activeScope;
}

export function setPaintScope(label: string | null): void {
  const next = label && label.length > 0 ? label : null;
  if (next === activeScope) return;
  activeScope = next;
  for (const fn of listeners) fn();
}

export function onPaintScopeChange(fn: () => void): void {
  listeners.push(fn);
}

/** The descriptor a UI paint tool should commit: scoped to the active part
 *  when one is selected (an explicit `withinPart` already on it wins). */
export function withPaintScope<D extends RegionDescriptor>(descriptor: D): D {
  if (!activeScope || descriptor.withinPart) return descriptor;
  return { ...descriptor, withinPart: activeScope };
}

/** A UI paint the part scope clipped to nothing (the click landed outside the
 *  chosen part): drop the empty region and say why, instead of leaving a
 *  silent no-op row in the region list. Returns true when it was dropped. */
export function dropIfClippedEmpty(region: ColorRegion): boolean {
  const part = region.descriptor.withinPart;
  if (!part || region.triangles.size > 0) return false;
  removeRegion(region.id);
  showToast(`Nothing inside "${part}" there. Paint on that part, or set Paint within back to Whole model.`, { variant: 'neutral', source: 'parts' });
  return true;
}
