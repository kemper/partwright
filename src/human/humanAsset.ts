// Lazy loader for the packed MakeHuman asset (public/human/hm08.json + packs).
// Same pattern as the text fonts: the engine Worker (and the headless preview)
// awaits `preloadHumanAsset(code)` before running code that mentions
// `api.human`, so the synchronous sandbox call finds the asset already parsed.
// Models that never touch api.human never download it.
//
// The data ships in three packs so a simple figure stays light:
//   core   (~4 MB)  mesh, skeleton, weights, adult body sliders — always
//   morphs (~2 MB)  every MakeHuman modelling slider — when the code mentions
//                   face / torso / morphs / expression
//   young  (~3 MB)  baby + child body targets — when the code mentions age
// Callers swallow a failed preload: the run goes ahead, and only an actual
// api.human call fails (with its own clear error).
import { assetPath } from '../deployment';
import { fetchAppAsset } from '../geometry/workerLockdown';
import { parseHumanAsset, type HumanAsset, type HumanAssetMeta, type HumanPack } from './humanModel';

let meta: HumanAssetMeta | null = null;
const buffers: Partial<Record<HumanPack, ArrayBuffer>> = {};
let asset: HumanAsset | null = null;
let loading: Promise<void> | null = null;

/** True when model code reaches the parametric human — `api.human` or a
 *  `{ human } = api` destructure. Deliberately narrow: a match downloads ~4 MB. */
export function sourceUsesHuman(code: string): boolean {
  return /\bapi\s*\.\s*human\b/.test(code) || /\{[^}]*\bhuman\b[^}]*\}\s*=\s*api\b/.test(code);
}

/** The optional packs this source needs (core is implied). */
export function humanPacksFor(code: string): HumanPack[] {
  const packs: HumanPack[] = [];
  // Styles and clothing reshape with modelling sliders too.
  if (/\b(face|torso|morphs|expression|style)\b/.test(code)) packs.push('morphs');
  if (/\bage\b/.test(code)) packs.push('young');
  return packs;
}

async function fetchBuffer(file: string): Promise<ArrayBuffer> {
  const res = await fetchAppAsset(assetPath(`/human/${file}`));
  if (!res.ok) throw new Error(`api.human: failed to load ${file} (${res.status})`);
  return res.arrayBuffer();
}

async function load(packs: HumanPack[]): Promise<void> {
  if (!meta) {
    const res = await fetchAppAsset(assetPath('/human/hm08.json'));
    if (!res.ok) throw new Error(`api.human: failed to load the human asset table (${res.status})`);
    meta = (await res.json()) as HumanAssetMeta;
  }
  const m = meta;
  const want = (['core', ...packs] as HumanPack[]).filter((p) => !buffers[p]);
  if (want.length === 0 && asset) return;
  const loaded = await Promise.all(want.map((p) => fetchBuffer(m.packs[p])));
  want.forEach((p, i) => { buffers[p] = loaded[i]; });
  asset = parseHumanAsset(m, buffers);
}

/** Load the core pack plus whatever optional packs `code` needs. */
export function preloadHumanAsset(code = ''): Promise<void> {
  const packs = humanPacksFor(code);
  const run = (loading ?? Promise.resolve()).catch(() => undefined).then(() => load(packs));
  loading = run;
  return run;
}

export function getHumanAsset(): HumanAsset | null {
  return asset;
}
