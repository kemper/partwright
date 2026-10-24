// Tile captions for the comparePartDetectors contact sheet (pure).
//
// A caption names the detector AND the settings that make this tile differ,
// so two variants of the same detector are told apart at a glance:
//   "2. crease-watershed · growth=summed creaseWeight=4"
// Among configs that share a detector, the keys whose values differ between
// them are listed; a detector that appears once lists what it changed from
// its defaults. Feature options (normal smoothing) count as settings too.

import type { FeatureOptions, ParamValues } from './types';

export interface CaptionConfig {
  detectorId: string;
  params: Record<string, unknown>;
  featureOptions?: FeatureOptions;
}

function flatten(c: CaptionConfig): Record<string, unknown> {
  const out: Record<string, unknown> = { ...c.params };
  for (const [k, v] of Object.entries(c.featureOptions ?? {})) if (v !== undefined) out[k] = v;
  return out;
}

function fmt(v: unknown): string {
  if (typeof v === 'number') return String(+v.toFixed(4));
  return String(v);
}

/** One "k=v k=v" diff string per config (may be empty). */
export function configDiffs(configs: CaptionConfig[], defaultsOf: (detectorId: string) => ParamValues): string[] {
  const flat = configs.map(flatten);
  return configs.map((c, i) => {
    const peers = configs.map((x, j) => (x.detectorId === c.detectorId ? j : -1)).filter((j) => j >= 0);
    const mine = flat[i];
    let keys: string[];
    if (peers.length > 1) {
      const all = new Set<string>();
      for (const j of peers) for (const k of Object.keys(flat[j])) all.add(k);
      keys = [...all].filter((k) => peers.some((j) => fmt(flat[j][k]) !== fmt(mine[k])));
    } else {
      const defs = defaultsOf(c.detectorId);
      keys = Object.keys(mine).filter((k) => !(k in defs) || fmt(defs[k]) !== fmt(mine[k]));
    }
    return keys.filter((k) => mine[k] !== undefined).sort().map((k) => `${k}=${fmt(mine[k])}`).join(' ');
  });
}

/** Caption per tile: "N. detector · diffs". */
export function compareCaptions(configs: CaptionConfig[], defaultsOf: (detectorId: string) => ParamValues): string[] {
  const diffs = configDiffs(configs, defaultsOf);
  return configs.map((c, i) => `${i + 1}. ${c.detectorId}${diffs[i] ? ` · ${diffs[i]}` : ''}`);
}
