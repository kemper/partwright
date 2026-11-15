// Images that model code can read: `api.image(id)` resolves a session
// attachment (by id) to decoded RGBA pixels. LEAF module — shared by the main
// thread (which decodes attachments and ships the referenced ones with each
// execute message) and the engine Worker (which installs them for the run).
//
// Pixels travel only when the code mentions `api.image(` — `sourceImageRefs`
// finds the ids — so ordinary models pay nothing.

export interface ModelImage {
  id: string;
  width: number;
  height: number;
  /** RGBA, row 0 = top of the image. */
  data: Uint8ClampedArray;
  /** Content hash (dims + sampled pixels) — the solve-cache key. */
  hash: string;
}

/** Attachment ids named by literal `api.image('<id>')` calls in `code`. */
export function sourceImageRefs(code: string): string[] {
  const out = new Set<string>();
  const re = /\bapi\.image\(\s*(['"`])([^'"`\n]{1,200})\1\s*\)/g;
  for (let m = re.exec(code); m; m = re.exec(code)) out.add(m[2]);
  return [...out];
}

/** Content hash over EVERY pixel (two independent FNV-1a lanes): it keys the
 *  Worker's solve cache, so a small local edit to a photo must change it. Runs
 *  once per decode (the main thread caches decoded attachments). */
export function hashImagePixels(width: number, height: number, data: Uint8ClampedArray): string {
  let a = (0x811c9dc5 ^ width) >>> 0;
  let b = (0x01000193 ^ (height << 8)) >>> 0;
  for (let i = 0; i < data.length; i++) {
    a = Math.imul(a ^ data[i], 0x01000193) >>> 0;
    b = Math.imul(b ^ data[i] ^ (i & 0xff), 0x5bd1e995) >>> 0;
  }
  return `${width}x${height}:${a.toString(16)}${b.toString(16)}`;
}

// ── Worker-side registry for the current run ────────────────────────────────

let active = new Map<string, ModelImage>();

export function setActiveModelImages(images: ModelImage[] | undefined): void {
  active = new Map((images ?? []).map((im) => [im.id, im]));
}

export function getActiveModelImage(id: string): ModelImage | null {
  return active.get(id) ?? null;
}

// ── Main-thread provider (registered by main.ts) ────────────────────────────

type Provider = (ids: string[]) => Promise<ModelImage[]>;
let provider: Provider | null = null;

export function setModelImageProvider(p: Provider | null): void {
  provider = p;
}

/** Decoded images for the attachment ids `code` references (empty when the
 *  code names none or no provider is registered, e.g. in Node). */
export async function collectModelImages(code: string): Promise<ModelImage[]> {
  const ids = sourceImageRefs(code);
  if (ids.length === 0 || !provider) return [];
  return provider(ids);
}
