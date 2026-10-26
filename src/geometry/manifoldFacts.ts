// The Manifold-dependent half of the geometry-data stats: bbox, volume,
// surface area, genus, manifold status and the component census. Dependency-
// free (no engine/main-thread imports) so BOTH sides can compute it: the main
// thread over its own Manifold (statsComputation.ts), and the engine Worker over
// the live result Manifold of a big run — which lets the main thread skip
// rebuilding that Manifold (a multi-second, UI-freezing `Manifold.ofMesh` on a
// multi-million-triangle import) until something actually needs it.

import { componentsOverlap } from './geometryHeuristics';

/** Manifold runtime type — the manifold-3d package does not export precise TS
 *  types for the WASM-backed object, so it's an opaque value with method probes. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Manifold = any;

export interface ManifoldFacts {
  bbox: { min: [number, number, number]; max: [number, number, number] } | null;
  volume: number;
  surfaceArea: number;
  genus: number | null;
  isManifold: boolean;
  manifoldStatus: string | null;
  componentCount: number;
  containedComponents: number;
  componentsInterpenetrate: boolean;
  /** Shortest / mean triangle edge length of the result mesh — not a
   *  Manifold figure, but a full pass over a big mesh, so the Worker computes
   *  it alongside. Absent when computed on the main thread. */
  edges?: { min: number; mean: number };
  /** The mesh's connected components (`computeMeshPieces`), for the object
   *  list's Pieces section — also a full pass, so computed alongside. */
  pieces?: { count: number; pieceOfTri: Int32Array };
}

export function manifoldBoundingBox(manifold: Manifold): ManifoldFacts['bbox'] {
  try {
    const bbox = manifold.boundingBox();
    return {
      min: [bbox.min[0], bbox.min[1], bbox.min[2]],
      max: [bbox.max[0], bbox.max[1], bbox.max[2]],
    };
  } catch {
    return null;
  }
}

export function computeManifoldFacts(manifold: Manifold): ManifoldFacts {
  let volume = 0;
  let surfaceArea = 0;
  try {
    volume = manifold.volume();
    surfaceArea = manifold.surfaceArea();
  } catch {
    // fallback if methods unavailable
  }

  let componentCount = 1;
  let containedComponents = 0;
  // True when two separate solids' bounding boxes overlap (a boolean that
  // didn't fuse, or an assembly to clearance-check) — a cheap interpenetration
  // signal the headless preview already surfaces; mirrored here for the in-app AI.
  let componentsInterpenetrate = false;
  try {
    const parts = manifold.decompose();
    componentCount = parts.length;
    if (parts.length > 1) {
      // Identify enclosed components (fully inside another solid, or negative-volume
      // artifacts). These won't detach in print and shouldn't trip floater warnings.
      // The two fast pre-filters (volume comparison + bbox containment) reject the
      // vast majority of pairs cheaply, so the expensive WASM intersect() call is
      // only reached for plausible containment candidates — safe without a count cap.
      interface PartInfo { vol: number; bb: ManifoldFacts['bbox']; m: Manifold }
      const infos: PartInfo[] = parts.map((p: Manifold) => {
        const bb = manifoldBoundingBox(p);
        const vol = (() => { try { return p.volume() as number; } catch { return 0; } })();
        return { vol, bb, m: p };
      });
      // Cheap AABB-overlap pass over the decomposed parts (bboxes already in hand).
      componentsInterpenetrate = componentsOverlap(
        infos.filter((i) => i.bb).map((i) => ({ bbox: i.bb! })),
      );
      for (let j = 0; j < infos.length; j++) {
        const smaller = infos[j];
        if (smaller.vol <= 0) { containedComponents++; continue; }
        for (let i = 0; i < infos.length; i++) {
          if (i === j) continue;
          const larger = infos[i];
          if (larger.vol <= smaller.vol || !larger.bb || !smaller.bb) continue;
          // Fast bbox filter: smaller must fit inside larger's bbox
          let inside = true;
          for (let ax = 0; ax < 3 && inside; ax++) {
            if (smaller.bb.min[ax] < larger.bb.min[ax] - 0.01 ||
                smaller.bb.max[ax] > larger.bb.max[ax] + 0.01) inside = false;
          }
          if (!inside) continue;
          // Precise check: intersection volume ≈ smaller's volume → fully enclosed
          try {
            const ix = larger.m.intersect(smaller.m);
            const ixVol = ix.volume() as number;
            ix.delete();
            if (Math.abs(ixVol - smaller.vol) <= smaller.vol * 0.05) {
              containedComponents++;
              break;
            }
          } catch { /* ignore — boolean failed, skip this pair */ }
        }
      }
    }
    for (const p of parts) p.delete();
  } catch {
    // fallback
  }

  let isManifold = true;
  let manifoldStatus: string | null = null;
  try {
    const s = manifold.status();
    isManifold = s === 0 || s === 'NoError';
    if (!isManifold) manifoldStatus = String(s);
  } catch {
    // fallback
  }

  let genus: number | null = null;
  try { genus = manifold.genus(); } catch { genus = null; }

  return {
    bbox: manifoldBoundingBox(manifold),
    volume,
    surfaceArea,
    genus,
    isManifold,
    manifoldStatus,
    componentCount,
    containedComponents,
    componentsInterpenetrate,
  };
}
