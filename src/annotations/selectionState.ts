// Leaf holding the "currently selected annotation" id and its change
// notification. It lives apart from selectMode so the overlay renderer
// (annotationOverlay) can observe the selection without importing selectMode —
// and selectMode can keep using the overlay's render helpers. That mutual
// import was a circular dependency; routing the shared state through this leaf
// breaks it while keeping a single source of truth.

let selectedId: string | null = null;
const listeners: Array<(id: string | null) => void> = [];

/** The id of the currently selected annotation, or null. */
export function getSelectedId(): string | null {
  return selectedId;
}

/** Subscribe to selection changes. Returns an unsubscribe function. */
export function onSelectionChange(fn: (id: string | null) => void): () => void {
  listeners.push(fn);
  return () => {
    const i = listeners.indexOf(fn);
    if (i >= 0) listeners.splice(i, 1);
  };
}

/** Set the selection and notify listeners. No-op if unchanged. */
export function setSelectedId(id: string | null): void {
  if (selectedId === id) return;
  selectedId = id;
  for (const fn of listeners) fn(selectedId);
}
