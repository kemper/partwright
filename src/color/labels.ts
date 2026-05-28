// Per-run snapshot of named labels (assigned via `api.label(shape, name)` in
// user code) and the triangle sets they cover. Mirrors `currentLabelMap` in
// main.ts so the paint UI can render a labels list without reaching across
// modules. Refreshed after every successful run; cleared otherwise.

export interface LabelInfo {
  name: string;
  triangleCount: number;
  triangles: Set<number>;
  /** Largest triangle id in the set, so hover-preview consumers can cheaply
   *  bounds-check against the currently-displayed paint mesh. Labels are
   *  built against the run's *base* mesh; if smooth paint refinement later
   *  inflates that mesh, indexing base ids into the refined mesh produces
   *  wrong-region highlights. -1 when the set is empty. */
  maxTriId: number;
}

let labels: LabelInfo[] = [];
const listeners: (() => void)[] = [];

export function setPaintLabels(map: Map<string, Set<number>> | null): void {
  labels = map
    ? [...map.entries()]
        .map(([name, triangles]) => {
          let maxTriId = -1;
          for (const t of triangles) if (t > maxTriId) maxTriId = t;
          return { name, triangleCount: triangles.size, triangles, maxTriId };
        })
        .sort((a, b) => a.name.localeCompare(b.name))
    : [];
  for (const fn of listeners) fn();
}

export function getPaintLabels(): LabelInfo[] {
  return labels;
}

export function onPaintLabelsChange(cb: () => void): void {
  listeners.push(cb);
}
