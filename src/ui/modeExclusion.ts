// Leaf coordinator for the mutually-exclusive viewport tools (paint, and the
// annotate sub-modes pen / text / select).
//
// Before this existed, each mode imported its siblings' `forceDeactivate` so it
// could turn them off when it activated — a fully-connected web of cross-imports
// that produced ~14 of the repo's circular dependencies. Instead, each mode now
// *registers* its deactivator here (subscribe) and asks this module to
// deactivate a sibling by id (notify). No mode imports another mode, so the
// cycles are gone and the dependency graph flows one way.
//
// This is a registry of deactivators rather than a single `@preact/signals`
// "active tool" signal on purpose: the pen/text/select trio shares one session
// plane and the intra-trio switches pass `{ keepSession }` (e.g. pen → text
// keeps the plane alive). A flat "deactivate everything else" signal can't carry
// that per-transition option, so we keep the exact existing calls — only the
// import edge changes.

/** Identifiers for the mutually-exclusive viewport tools. */
export type ExclusiveMode = 'paint' | 'imagePaint' | 'pen' | 'text' | 'select' | 'cut';

/** Options forwarded verbatim to a mode's `forceDeactivate`. Only the annotate
 *  sub-modes honour `keepSession`; paint ignores it. */
export interface DeactivateOpts {
  keepSession?: boolean;
}

type Deactivator = (opts?: DeactivateOpts) => void;

const registry = new Map<ExclusiveMode, Deactivator>();

/** Register a mode's force-deactivate callback. Called once at init. */
export function registerExclusiveMode(id: ExclusiveMode, deactivate: Deactivator): void {
  registry.set(id, deactivate);
}

/** Force-deactivate the given mode if it is registered (a no-op otherwise —
 *  e.g. when paint's UI was never initialised in this context). */
export function deactivateMode(id: ExclusiveMode, opts?: DeactivateOpts): void {
  registry.get(id)?.(opts);
}
