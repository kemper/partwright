// Lazy loader for the packed MakeHuman asset (public/human/hm08.{json,bin}).
// Same pattern as the text fonts: the engine Worker (and the headless preview)
// awaits `preloadHumanAsset()` before running code that mentions `api.human`,
// so the synchronous sandbox call finds the asset already parsed. Models that
// never touch api.human never download it (~4 MB).
import { assetPath } from '../deployment';
import { fetchAppAsset } from '../geometry/workerLockdown';
import { parseHumanAsset, type HumanAsset, type HumanAssetMeta } from './humanModel';

let asset: HumanAsset | null = null;
let loading: Promise<void> | null = null;

/** True when model code calls the parametric human. */
export function sourceUsesHuman(code: string): boolean {
  return /\bapi\.human\b/.test(code) || /\bhuman\s*\(/.test(code);
}

export function preloadHumanAsset(): Promise<void> {
  if (loading) return loading;
  loading = (async () => {
    const [metaRes, binRes] = await Promise.all([
      fetchAppAsset(assetPath('/human/hm08.json')),
      fetchAppAsset(assetPath('/human/hm08.bin')),
    ]);
    if (!metaRes.ok || !binRes.ok) throw new Error(`api.human: failed to load the human asset (${metaRes.status}/${binRes.status})`);
    const meta = (await metaRes.json()) as HumanAssetMeta;
    asset = parseHumanAsset(meta, await binRes.arrayBuffer());
  })();
  // A failed load must not poison later runs.
  loading.catch(() => { loading = null; });
  return loading;
}

export function getHumanAsset(): HumanAsset | null {
  return asset;
}
