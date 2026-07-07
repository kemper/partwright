// Pure catalog categorization — shared by the in-app catalog (src/ui/catalog.ts)
// and the build-time static /catalog pre-renderer, so both bucket entries
// identically. Dependency-free (no DOM, no app runtime).

export type CatalogLanguage = 'manifold-js' | 'scad' | 'replicad' | 'voxel';

/** Canonical order for the language filter pills (only present ones render). */
export const CATALOG_LANGUAGE_ORDER: CatalogLanguage[] = ['manifold-js', 'scad', 'replicad', 'voxel'];

/** Curated, language-independent groups. Unlike the engine-derived categories
 *  below, a curated group is assigned explicitly per manifest entry (via
 *  `group`) so a themed collection can span every engine. */
export type CuratedGroupId = 'fidget-toys' | 'print-fit';

/** Content themes — an orthogonal, language-independent *filter* facet (not a
 *  section). Assigned per manifest entry via `tags`; an entry can carry several.
 *  Unlike `group` (which buckets an entry into one section), themes layer on top
 *  of the engine/curated sections so a user can focus the whole catalog on, say,
 *  Figures or Vehicles regardless of how each model is built. */
export type CatalogThemeId =
  | 'figures'
  | 'fidgets'
  | 'mechanical'
  | 'buildings'
  | 'vehicles'
  | 'games'
  | 'decor';

export interface CatalogThemeDef {
  id: CatalogThemeId;
  /** Pill label. */
  label: string;
}

/** The theme filter pills, in render order. A pill renders only when at least
 *  one present entry carries its tag (mirrors the language-pill behavior). */
export const CATALOG_THEMES: CatalogThemeDef[] = [
  { id: 'figures', label: 'Figures' },
  { id: 'fidgets', label: 'Fidgets' },
  { id: 'mechanical', label: 'Mechanical' },
  { id: 'buildings', label: 'Buildings' },
  { id: 'vehicles', label: 'Vehicles' },
  { id: 'games', label: 'Games' },
  { id: 'decor', label: 'Home & Decor' },
];

/** Count how many of `entries` carry each theme tag. Pure; shared by both
 *  catalog surfaces so their theme pills (and counts) stay identical. */
export function themeCounts(entries: { tags?: CatalogThemeId[] }[]): Map<CatalogThemeId, number> {
  const counts = new Map<CatalogThemeId, number>();
  for (const entry of entries) {
    for (const tag of entry.tags ?? []) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  }
  return counts;
}

/** Print-verification status as a filter facet — an orthogonal toggle over the
 *  same tiles (like language/theme), so a user can focus the whole catalog on
 *  models proven with a physical print (or on the ones still unproven). Every
 *  entry resolves to exactly one status via `printStatusOf`. */
export type CatalogPrintStatus = 'tested' | 'untested';

export interface CatalogPrintStatusDef {
  id: CatalogPrintStatus;
  /** Pill label — mirrors the tile chip wording. */
  label: string;
}

/** The print-status filter pills, in render order. A pill renders only when
 *  both statuses are present (mirrors the language-pill "> 1 present" rule) so
 *  a fully-untested catalog shows no status facet at all. */
export const CATALOG_PRINT_STATUSES: CatalogPrintStatusDef[] = [
  { id: 'tested', label: '✓ Print-tested' },
  { id: 'untested', label: 'Untested' },
];

/** The single status bucket an entry falls into (absent/false ⇒ untested). */
export function printStatusOf(printTested: boolean | undefined): CatalogPrintStatus {
  return printTested ? 'tested' : 'untested';
}

/** The entry's current latest version *number* — the highest version `index`,
 *  NOT the version-array length. These differ for multi-part entries, where the
 *  array holds one entry per part (each at its own index) rather than a linear
 *  history: a 37-part kit whose parts are all at index 1 has a latest version of
 *  1, not 37. This is the value compared against `printTestedVersion` for
 *  staleness, so it must reflect revision depth, not part count. Falls back to
 *  the length when no indices are present. */
export function latestVersionIndex(versions: { index?: number }[]): number {
  let max = 0;
  for (const v of versions) {
    if (typeof v.index === 'number' && v.index > max) max = v.index;
  }
  return max || versions.length;
}

/** Count how many of `entries` fall into each print status. Pure; shared by
 *  both catalog surfaces so their status pills (and counts) stay identical. */
export function printStatusCounts(entries: { printTested?: boolean }[]): Map<CatalogPrintStatus, number> {
  const counts = new Map<CatalogPrintStatus, number>();
  for (const entry of entries) {
    const id = printStatusOf(entry.printTested);
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return counts;
}

export interface CatalogManifestEntry {
  /** Stable id used as a slug; also the manifest dedupe key. */
  id: string;
  /** Display name for the tile. */
  name: string;
  /** Short blurb shown under the name. */
  description?: string;
  /** Path (relative to /catalog/) of the .partwright.json file. */
  file: string;
  /** Optional language hint for the badge before the JSON loads. */
  language?: CatalogLanguage;
  /** Optional curated group. When set, the entry is bucketed into this themed,
   *  language-independent section instead of its engine-derived category. */
  group?: CuratedGroupId;
  /** Optional content themes — an orthogonal filter facet (see CatalogThemeId).
   *  An entry can carry several (e.g. a jet engine is both mechanical + vehicle).
   *  Drives the theme filter pills; does not affect which section it lands in. */
  tags?: CatalogThemeId[];
  /** Whether this model has been physically 3D-printed and verified printable.
   *  Absent/false means "not print-tested yet" (the default for every entry) —
   *  flip to `true` only once a real print exists. Drives the print-tested tile
   *  badge so users can tell verified-printable models from unproven ones. */
  printTested?: boolean;
  /** Curator's note about the physical print — quality, caveats, how it came
   *  out — surfaced in the badge's hover tooltip so users get the honest story,
   *  not just a green check. Only meaningful when `printTested` is true. */
  printTestedNote?: string;
  /** The version index (1-based, matching a version's `index`) that was actually
   *  printed and verified. When the entry later gains newer versions
   *  (latest > this), the badge flags the print as stale/needing re-verification
   *  so a re-bake can't silently invalidate the "tested" claim. Only meaningful
   *  when `printTested` is true; omit to assert only that *a* print exists. */
  printTestedVersion?: number;
}

/** Badge describing whether a catalog entry has been verified print-tested.
 *  Pure (label + Tailwind classes + tooltip + searchable tokens) so both the
 *  static pre-renderer and the in-app overlay render an identical chip. */
export interface PrintTestedBadge {
  /** True once the model has a verified physical print. */
  tested: boolean;
  /** True when the print was verified against an older version than the latest
   *  (tested at vN but the model has since advanced) — the "re-test me" state. */
  stale: boolean;
  /** Short chip label. */
  label: string;
  /** Tailwind text + border colour classes. */
  classes: string;
  /** Full-text tooltip — the curator's note plus the tested-version provenance. */
  title: string;
  /** Tokens folded into the tile's search haystack so the state is findable
   *  (`verified` for tested, `untested` for not-yet-tested, plus `outdated` for
   *  a stale print). */
  search: string;
}

export interface PrintTestedInput {
  /** Whether a verified physical print exists. */
  printTested?: boolean;
  /** Curator's free-text note about the print (quality, caveats). */
  note?: string;
  /** Version index (1-based) that was actually printed and verified. */
  testedVersion?: number;
  /** The entry's current latest version index — compared against `testedVersion`
   *  to detect that the model has advanced since it was tested. */
  latestVersion?: number;
}

/** Describe a catalog entry's print-tested status as a renderable chip. Pure
 *  (label + Tailwind classes + tooltip + search tokens) so both the static
 *  pre-renderer and the in-app overlay render an identical chip.
 *
 *  Three states: untested (default), verified-current (green), and
 *  verified-but-stale (amber — tested at an older version than the latest, so
 *  the model has changed since and the print claim needs re-checking). */
export function printTestedBadge(input: PrintTestedInput | undefined = {}): PrintTestedBadge {
  const { printTested, note, testedVersion, latestVersion } = input;
  if (!printTested) {
    return {
      tested: false,
      stale: false,
      label: 'Untested',
      classes: 'text-zinc-500 border-zinc-600/70',
      title: 'Not print-tested yet — this model has not been verified with a physical print.',
      // Just `untested` — avoid any token containing the `print-tested`
      // substring, so searching "print-tested" surfaces only verified tiles
      // (the filter matches substrings, see catalogFilter.ts).
      search: 'untested',
    };
  }

  const stale =
    typeof testedVersion === 'number' &&
    typeof latestVersion === 'number' &&
    latestVersion > testedVersion;

  // The tooltip leads with the curator's note (the honest, per-model story) and
  // falls back to a generic verified line. The version provenance is appended so
  // hovering always says *which* version was proven.
  const lead = note?.trim() || 'Verified — this model has been physically 3D-printed successfully.';
  let provenance = '';
  if (typeof testedVersion === 'number') {
    provenance = stale
      ? ` Tested at version ${testedVersion}; the model has since been updated to version ${latestVersion} and has not been re-verified.`
      : ` Verified at version ${testedVersion}.`;
  }
  const title = `${lead}${provenance}`;

  if (stale) {
    return {
      tested: true,
      stale: true,
      label: `✓ Print-tested (v${testedVersion})`,
      classes: 'text-amber-300 border-amber-400/40',
      title,
      search: 'print-tested verified outdated re-test',
    };
  }
  return {
    tested: true,
    stale: false,
    label: '✓ Print-tested',
    classes: 'text-emerald-300 border-emerald-400/40',
    title,
    search: 'print-tested verified',
  };
}

/** The catalog is sectioned so each tile's reason for being here is obvious.
 *  Engine-derived categories are mutually exclusive; curated groups (assigned
 *  explicitly via `entry.group`) lead the list. Array order is the on-page
 *  section order. */
export type CategoryId = CuratedGroupId | 'customizable' | 'manifold' | 'sdf' | 'voxel' | 'scad' | 'brep';

export interface CategoryDef {
  id: CategoryId;
  title: string;
  blurb: string;
}

export const CATEGORIES: CategoryDef[] = [
  { id: 'fidget-toys', title: 'Fidget Toys', blurb: 'Twisty, spinny, squishy desk toys — popular 3D-print fidgets you can print and tweak. Spans every engine.' },
  { id: 'print-fit', title: 'Hardware-Ready Joinery', blurb: 'Enclosures, brackets, and joints sized to real hardware — M2–M8 screws, heat-set inserts, captive nuts, dovetails, and alignment pins built with the api.fasteners and api.joints helpers.' },
  { id: 'customizable', title: 'Customizable', blurb: 'Tweak these live with sliders and toggles — open the 🎛 Customize panel in the editor, no code changes needed.' },
  { id: 'manifold', title: 'JavaScript Models', blurb: 'Built with the default manifold-3d mesh API — the everyday JS modeling path.' },
  { id: 'sdf', title: 'Implicit Surfaces (SDF)', blurb: 'Signed-distance-field models via the Sdf builder — gyroids, lattices, and organic blends.' },
  { id: 'voxel', title: 'Voxel Models', blurb: 'Built by painting and baking a voxel grid.' },
  { id: 'scad', title: 'OpenSCAD', blurb: 'Authored in OpenSCAD with the BOSL2 library — gears, threads, and machined parts.' },
  { id: 'brep', title: 'Solid CAD (BREP)', blurb: 'Exact OpenCASCADE solids (replicad) with true fillets and STEP export.' },
];

/** Inspect concatenated version code (+ the entry id) for the traits that drive
 *  categorization and tile badges. */
export function deriveCharacteristics(id: string, code: string): { hasParams: boolean; isSDF: boolean } {
  const hasParams = /\bapi\.params\s*\(/.test(code);
  // SDF entries reach the surface builder through the `sdf` api namespace
  // (`api.sdf.…` or destructured `const { sdf } = api`), the raw manifold
  // `levelSet`, or an `sdf-`/`sdf_` id prefix as a fallback.
  const usesSdfApi = /\bapi\.sdf\b/.test(code) || /[{,]\s*sdf\s*[,}]/.test(code);
  const isSDF = usesSdfApi || /\blevelSet\s*\(/.test(code) || /^sdf[-_]/i.test(id);
  return { hasParams, isSDF };
}

/** Assign one category. A curated group wins outright (it's an explicit,
 *  language-independent editorial choice); otherwise parametric models lead
 *  (the trait users most want to find), then split by engine, with SDF pulled
 *  out of the manifold-js bucket as its own showcase. */
export function categorizeOf(opts: { hasParams: boolean; isSDF: boolean; language: CatalogLanguage; group?: CuratedGroupId }): CategoryId {
  if (opts.group) return opts.group;
  if (opts.hasParams) return 'customizable';
  if (opts.language === 'scad') return 'scad';
  if (opts.language === 'replicad') return 'brep';
  if (opts.language === 'voxel') return 'voxel';
  if (opts.isSDF) return 'sdf';
  return 'manifold';
}
