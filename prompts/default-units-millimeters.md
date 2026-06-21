---
session: "01Qhfn"
timestamp: "2026-06-20T15:30:00Z"
---

## Human

When creating a new session, I'd like the units to default to millimeters. I'm
tired of the unitless warnings. For all new sessions from here on out, assume
millimeters by default. And for older sessions — if I import a JSON file from an
older session and it's unitless, assume that's millimeters. And definitely
anything from the catalog should be in millimeters.

## Assistant

## Key decisions

**Flipped the single app-wide default from `'unitless'` to `'mm'` in
`readPersistedUnit()` (`src/geometry/units.ts`).** Units in this app are a global
per-tab preference, not a per-session field — there is no `unit` on the session/
`ExportedSession` schema, and import never restores a unit from a file (the
`unit` inside a version's `geometryData` is a historical snapshot that's never
read back). So all three asks collapse to one change:
- **New sessions / fresh browser** → no persisted value, so the default applies → mm.
- **Imported older (unitless) JSON** → import doesn't touch the live unit, so the
  tab simply stays at its mm default. No per-import migration needed.
- **Catalog** → loads through the same `importSessionPayload` path → also mm.

This also removes the "No units set" export-confirm warning by default, since that
modal only fires when the live unit is `'unitless'`.

**Kept `'unitless'` as an explicitly selectable value.** Anyone who deliberately
wants unitless can still pick it from the Export-menu selector; only the *default*
moved. `get3MFUnitString()` already mapped unitless → millimeter, so nothing
downstream needed touching.

**Updated the tests that pinned the old default rather than the behavior.**
`tests/unit/units.test.ts` now asserts the mm default (and adds a case proving an
explicitly-stored `'unitless'` still reads back as unitless). `tests/export-safety.spec.ts`
now sets `partwright-units: 'unitless'` explicitly in its `beforeEach` instead of
clearing the key — those tests exercise the unitless warning path, which no longer
matches the app default.

**Refreshed the user-facing help copy** (`src/content/data/help.ts`) so it states
the mm default and points at the Export menu for switching, instead of "units are
arbitrary." Left the AI system-prompt wording alone — it already says "treat as mm
unless the user says otherwise."
