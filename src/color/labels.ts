// Per-run snapshot of named labels (assigned via `api.label(shape, name)` in
// user code) and the triangle sets they cover. Mirrors `currentLabelMap` in
// main.ts so the paint UI can render a labels list without reaching across
// modules. Refreshed after every successful run; cleared otherwise.

export interface LabelInfo {
  name: string;
  triangleCount: number;
  triangles: Set<number>;
}

let labels: LabelInfo[] = [];
const listeners: (() => void)[] = [];

export function setPaintLabels(map: Map<string, Set<number>> | null): void {
  labels = map
    ? [...map.entries()]
        .map(([name, triangles]) => ({ name, triangleCount: triangles.size, triangles }))
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
