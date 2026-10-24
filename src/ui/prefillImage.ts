// Image sources for tool prefills (`openTool('tool-image-paint', {src})`, the
// relief and image→voxel wizards). A prefill `src` is one of:
//
//   • a `data:image/…` URL,
//   • an `http(s)://` URL (fetched over CORS — the CSP's connect-src allows
//     https:, but img-src does not, so it is fetched, never <img src>'d), or
//   • an image ATTACHMENT of this session, by id or label.
//
// Staging only ever DOWNLOADS the bytes into this tab (nothing is uploaded).

import { getAttachments } from '../renderer/multiview';

/** Longest `src` string a prefill accepts (a data URL of a few MB). */
export const PREFILL_IMAGE_SRC_MAX = 15_000_000;

export interface ResolvedPrefillImage {
  /** A data: or http(s): URL. */
  url: string;
  /** Short human label for the panel ("attachment ref-1", "data URL", the URL's file name). */
  label: string;
}

/** Resolve a prefill `src` without loading it. Pure apart from reading the
 *  session's attachment list. */
export function resolvePrefillImageSrc(src: string): ResolvedPrefillImage | { error: string } {
  const s = src.trim();
  if (/^data:image\//i.test(s)) return { url: s, label: 'image (data URL)' };
  if (/^https?:\/\//i.test(s)) {
    try {
      const u = new URL(s);
      const name = decodeURIComponent(u.pathname.split('/').filter(Boolean).pop() ?? '') || u.hostname;
      return { url: u.href, label: name };
    } catch {
      return { error: `src "${s.slice(0, 60)}" is not a valid URL` };
    }
  }
  const images = getAttachments().filter(a => a.kind === 'image');
  const hit = images.find(a => a.id === s) ?? images.find(a => (a.label ?? '').toLowerCase() === s.toLowerCase());
  if (hit) return { url: hit.src, label: hit.label || `attachment ${hit.id}` };
  return {
    error: `src must be a data:image/ URL, an http(s) URL, or an image attachment id/label (image attachments: ${images.map(a => a.id).join(', ') || 'none'})`,
  };
}

/** Decode a `data:` URL to a Blob without fetch (connect-src has no data:). */
function dataUrlToBlob(url: string): Blob {
  const comma = url.indexOf(',');
  if (comma < 0) throw new Error('malformed data URL');
  const meta = url.slice(5, comma);
  const body = url.slice(comma + 1);
  const type = meta.split(';')[0] || 'application/octet-stream';
  if (/;base64$/i.test(meta)) {
    const bin = atob(body);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type });
  }
  return new Blob([decodeURIComponent(body)], { type });
}

/** Download a resolved image into a Blob (never uploads). Rejects with a
 *  readable message on a network / CORS / non-image failure. */
export async function loadPrefillImageBlob(img: ResolvedPrefillImage): Promise<Blob> {
  let blob: Blob;
  if (img.url.startsWith('data:')) {
    blob = dataUrlToBlob(img.url);
  } else {
    let res: Response;
    try {
      res = await fetch(img.url, { mode: 'cors', credentials: 'omit' });
    } catch (e) {
      throw new Error(`could not fetch the image (${e instanceof Error ? e.message : String(e)}) — the host must allow CORS, or pass a data URL / attachment instead`);
    }
    if (!res.ok) throw new Error(`could not fetch the image (HTTP ${res.status})`);
    blob = await res.blob();
  }
  if (blob.type && !blob.type.startsWith('image/')) throw new Error(`src is not an image (got ${blob.type})`);
  return blob;
}

/** The Blob as a File, for wizards that take a picked File. */
export function prefillImageFile(blob: Blob, label: string): File {
  const ext = (blob.type.split('/')[1] ?? 'png').replace('svg+xml', 'svg').replace('jpeg', 'jpg');
  const base = label.replace(/\.[a-z0-9]+$/i, '').replace(/[^\w.-]+/g, '-').slice(0, 60) || 'image';
  return new File([blob], `${base}.${ext}`, { type: blob.type || 'image/png' });
}

/** Decode a Blob to ImageData (browser only). */
export async function blobToImageData(blob: Blob): Promise<ImageData> {
  const bmp = await createImageBitmap(blob);
  try {
    const canvas = document.createElement('canvas');
    canvas.width = bmp.width;
    canvas.height = bmp.height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('2D canvas unavailable');
    ctx.drawImage(bmp, 0, 0);
    return ctx.getImageData(0, 0, bmp.width, bmp.height);
  } finally {
    bmp.close();
  }
}
