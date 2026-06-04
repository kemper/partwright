// Pure catalog categorization — shared by the in-app catalog (src/ui/catalog.ts)
// and the build-time static /catalog pre-renderer, so both bucket entries
// identically. Dependency-free (no DOM, no app runtime).

export type CatalogLanguage = 'manifold-js' | 'scad' | 'replicad' | 'voxel';

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
}

/** The catalog is sectioned so each tile's reason for being here is obvious.
 *  Categories are mutually exclusive; array order is the on-page section order. */
export type CategoryId = 'customizable' | 'manifold' | 'sdf' | 'voxel' | 'scad' | 'brep';

export interface CategoryDef {
  id: CategoryId;
  title: string;
  blurb: string;
}

export const CATEGORIES: CategoryDef[] = [
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

/** Assign one category. Parametric models lead (the trait users most want to
 *  find); otherwise split by engine, with SDF pulled out of the manifold-js
 *  bucket as its own showcase. */
export function categorizeOf(opts: { hasParams: boolean; isSDF: boolean; language: CatalogLanguage }): CategoryId {
  if (opts.hasParams) return 'customizable';
  if (opts.language === 'scad') return 'scad';
  if (opts.language === 'replicad') return 'brep';
  if (opts.language === 'voxel') return 'voxel';
  if (opts.isSDF) return 'sdf';
  return 'manifold';
}
