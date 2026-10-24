// Image sources for tool prefills (`openTool('tool-image-paint', {src})`, the
// relief and image→voxel wizards). A prefill `src` is one of:
//
//   • a `data:image/…` URL,
//   • an `https://` URL — fetched with the same guards as "Import from URL…"
//     (timeout, redirect-scheme check, size cap; src/import/remoteFetch.ts).
//     Plain `http:` is refused so an AI can't make the tab GET localhost /
//     LAN addresses, or
//   • an image ATTACHMENT of this session, by id or label.
//
// Staging only ever DOWNLOADS the bytes into this tab (nothing is uploaded).
// Decoding checks the image's pixel count before drawing it, and renders SVGs
// at a usable size (the same rule as Image paint's file picker).

import { getAttachments } from '../renderer/multiview';
import { getConfig } from '../config/appConfig';
import { fetchRemoteBytes } from '../import/remoteFetch';
import { MAX_REMOTE_BYTES } from '../import/urlImport';

interface ResolvedPrefillImage {
  /** A data: or https: URL. */
  url: string;
  /** Short human label for the panel ("attachment ref-1", "data URL", the URL's file name). */
  label: string;
}

/** Resolve a prefill `src` without loading it. Pure apart from reading the
 *  session's attachment list and the size limit. */
export function resolvePrefillImageSrc(src: string): ResolvedPrefillImage | { error: string } {
  const s = src.trim();
  const max = getConfig().import.prefillImageSrcMaxChars;
  if (s.length > max) return { error: `src is too long (${s.length} chars; limit ${max})` };
  if (/^data:image\//i.test(s)) return { url: s, label: 'image (data URL)' };
  if (/^[a-z][a-z0-9+.-]*:/i.test(s)) {
    let u: URL;
    try { u = new URL(s); } catch { return { error: `src "${s.slice(0, 60)}" is not a valid URL` }; }
    if (u.protocol !== 'https:') return { error: `src must be a data:image/ URL, an https:// URL, or an image attachment id/label (got a ${u.protocol} URL)` };
    const name = decodeURIComponent(u.pathname.split('/').filter(Boolean).pop() ?? '') || u.hostname;
    return { url: u.href, label: name };
  }
  const images = getAttachments().filter(a => a.kind === 'image');
  const hit = images.find(a => a.id === s) ?? images.find(a => (a.label ?? '').toLowerCase() === s.toLowerCase());
  if (hit) {
    if (!/^data:image\//i.test(hit.src) && !/^https:\/\//i.test(hit.src)) return { error: `attachment ${hit.id} has no loadable image data` };
    return { url: hit.src, label: hit.label || `attachment ${hit.id}` };
  }
  return {
    error: `src must be a data:image/ URL, an https:// URL, or an image attachment id/label (image attachments: ${images.map(a => a.id).join(', ') || 'none'})`,
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

const looksLikeImage = (type: string | null, url: string): boolean =>
  (!!type && /^image\//i.test(type)) || (!type && /\.(png|jpe?g|gif|webp|bmp|svg)(\?|#|$)/i.test(url));

/** Download a resolved image into a Blob (never uploads). Rejects with a
 *  readable message on a network / CORS / size / non-image failure. */
export async function loadPrefillImageBlob(img: ResolvedPrefillImage): Promise<Blob> {
  if (img.url.startsWith('data:')) return dataUrlToBlob(img.url);
  const { bytes, contentType } = await fetchRemoteBytes(img.url, {
    timeoutMs: getConfig().import.remoteFetchTimeoutMs,
    maxBytes: MAX_REMOTE_BYTES,
    check: (res) => (looksLikeImage(res.headers.get('content-type'), img.url) ? null : `src is not an image (got ${res.headers.get('content-type') ?? 'no content type'})`),
  });
  const type = contentType && /^image\//i.test(contentType) ? contentType.split(';')[0] : /\.svg(\?|#|$)/i.test(img.url) ? 'image/svg+xml' : 'image/png';
  return new Blob([bytes], { type });
}

export const isSvgBlob = (b: Blob): boolean => /svg/i.test(b.type);

/** The Blob as a File, for wizards that take a picked File. */
export function prefillImageFile(blob: Blob, label: string): File {
  const ext = (blob.type.split('/')[1] ?? 'png').replace('svg+xml', 'svg').replace('jpeg', 'jpg');
  const base = label.replace(/\.[a-z0-9]+$/i, '').replace(/[^\w.-]+/g, '-').slice(0, 60) || 'image';
  return new File([blob], `${base}.${ext}`, { type: blob.type || 'image/png' });
}

/** Decode a Blob to ImageData no larger than `maxDim` on its longest side.
 *  The pixel count is checked from the image's header dimensions BEFORE it is
 *  drawn (decoded); SVGs without a size render at ≥ 1024 px like Image
 *  paint's picker. Browser only. */
export function blobToImageData(blob: Blob, maxDim: number): Promise<ImageData> {
  const url = URL.createObjectURL(blob);
  return new Promise<ImageData>((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      try {
        const svg = isSvgBlob(blob);
        let w = img.naturalWidth || (svg ? 1024 : 0);
        let h = img.naturalHeight || (svg ? 1024 : 0);
        if (svg) { const k = Math.max(1, 1024 / Math.max(w, h)); w *= k; h *= k; }
        if (!w || !h) throw new Error('the image has no size');
        const maxPx = getConfig().import.prefillImageMaxPixels;
        if (!svg && w * h > maxPx) throw new Error(`the image is too large (${img.naturalWidth}×${img.naturalHeight} px; limit ${maxPx.toLocaleString()} pixels)`);
        const scale = Math.min(1, maxDim / Math.max(w, h));
        const cw = Math.max(1, Math.round(w * scale));
        const ch = Math.max(1, Math.round(h * scale));
        const canvas = document.createElement('canvas');
        canvas.width = cw; canvas.height = ch;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) throw new Error('2D canvas unavailable');
        ctx.drawImage(img, 0, 0, cw, ch);
        resolve(ctx.getImageData(0, 0, cw, ch));
      } catch (e) {
        reject(e instanceof Error ? e : new Error(String(e)));
      } finally {
        URL.revokeObjectURL(url);
      }
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('could not decode the image')); };
    img.src = url;
  });
}
