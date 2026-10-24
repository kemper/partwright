// Image sources for tool prefills (`openTool('tool-image-paint', {src})`, the
// relief and image→voxel wizards). A prefill `src` is one of:
//
//   • a `data:image/…` URL,
//   • an `https://` URL on a PUBLIC host — fetched with the Import-from-URL
//     guards (timeout, size cap; src/import/remoteFetch.ts) but with
//     redirects refused, and with localhost / `.local` / loopback / private /
//     link-local addresses rejected up front, so an AI-supplied src can't
//     make this tab GET something on the user's machine or LAN, or
//   • an image ATTACHMENT of this session, by id or label (its data may be a
//     data URL, a public https URL, or a same-origin / blob: URL this page
//     made).
//
// Staging only ever DOWNLOADS the bytes into this tab (nothing is uploaded).
// Decoding checks the image's pixel count before drawing it, and renders SVGs
// at a usable size (the same rule as Image paint's file picker).

import { getAttachments } from '../renderer/multiview';
import { getConfig } from '../config/appConfig';
import { fetchRemoteBytes, isLocalOrPrivateHost } from '../import/remoteFetch';
import { MAX_REMOTE_BYTES } from '../import/urlImport';

interface ResolvedPrefillImage {
  /** data: URL, a public https: URL, or a same-origin / blob: URL (attachments only). */
  url: string;
  kind: 'data' | 'remote' | 'local';
  /** Short human label for the panel ("attachment ref-1", "data URL", the URL's file name). */
  label: string;
}

const pageOrigin = (): string | null => {
  try { return typeof location !== 'undefined' ? location.origin : null; } catch { return null; }
};

/** Classify one URL: data:image, a public https URL, or (attachments only)
 *  a same-origin / blob: URL of this page. */
function classifyUrl(raw: string, allowLocal: boolean): { url: string; kind: ResolvedPrefillImage['kind']; name: string } | { error: string } {
  if (/^data:image\//i.test(raw)) return { url: raw, kind: 'data', name: 'image (data URL)' };
  let u: URL;
  try { u = new URL(raw, allowLocal && pageOrigin() ? location.href : undefined); } catch { return { error: `src "${raw.slice(0, 60)}" is not a valid URL` }; }
  const name = decodeURIComponent(u.pathname.split('/').filter(Boolean).pop() ?? '') || u.hostname;
  if (allowLocal && (u.protocol === 'blob:' || u.origin === pageOrigin())) {
    if (u.origin !== pageOrigin()) return { error: 'src: a blob: URL from another origin can\'t be loaded' };
    return { url: u.href, kind: 'local', name };
  }
  if (u.protocol !== 'https:') return { error: `src must be a data:image/ URL, an https:// URL, or an image attachment id/label (got a ${u.protocol} URL)` };
  if (isLocalOrPrivateHost(u.hostname)) return { error: `src: "${u.hostname}" is a local or private-network address — use a public https URL, a data URL or an attachment` };
  return { url: u.href, kind: 'remote', name };
}

/** Resolve a prefill `src` without loading it. Pure apart from reading the
 *  session's attachment list, the page origin and the size limit. */
export function resolvePrefillImageSrc(src: string): ResolvedPrefillImage | { error: string } {
  const s = src.trim();
  const max = getConfig().import.prefillImageSrcMaxChars;
  if (s.length > max) return { error: `src is too long (${s.length} chars; limit ${max})` };
  if (/^data:/i.test(s) || /^[a-z][a-z0-9+.-]*:/i.test(s)) {
    const c = classifyUrl(s, false);
    return 'error' in c ? c : { url: c.url, kind: c.kind, label: c.name };
  }
  const images = getAttachments().filter(a => a.kind === 'image');
  const hit = images.find(a => a.id === s) ?? images.find(a => (a.label ?? '').toLowerCase() === s.toLowerCase());
  if (hit) {
    const c = classifyUrl(hit.src, true);
    if ('error' in c) return { error: `attachment ${hit.id}: ${c.error}` };
    return { url: c.url, kind: c.kind, label: hit.label || `attachment ${hit.id}` };
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

/** Re-encode a same-origin / blob: image as a PNG Blob through an <img>
 *  (img-src allows 'self' + blob:; connect-src doesn't allow blob:). */
function localUrlToBlob(url: string): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const w = img.naturalWidth, h = img.naturalHeight;
      if (!w || !h) { reject(new Error('the image has no size')); return; }
      const maxPx = getConfig().import.prefillImageMaxPixels;
      if (w * h > maxPx) { reject(new Error(`the image is too large (${w}×${h} px; limit ${maxPx.toLocaleString()} pixels)`)); return; }
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      const ctx = c.getContext('2d');
      if (!ctx) { reject(new Error('2D canvas unavailable')); return; }
      ctx.drawImage(img, 0, 0);
      c.toBlob(b => (b ? resolve(b) : reject(new Error('could not read the image'))), 'image/png');
    };
    img.onerror = () => reject(new Error('could not load the attachment image'));
    img.src = url;
  });
}

/** Download a resolved image into a Blob (never uploads). Rejects with a
 *  readable message on a network / CORS / size / non-image failure. */
export async function loadPrefillImageBlob(img: ResolvedPrefillImage): Promise<Blob> {
  if (img.kind === 'data') return dataUrlToBlob(img.url);
  if (img.kind === 'local') return localUrlToBlob(img.url);
  const { bytes, contentType } = await fetchRemoteBytes(img.url, {
    timeoutMs: getConfig().import.remoteFetchTimeoutMs,
    maxBytes: MAX_REMOTE_BYTES,
    // No redirects: a public https URL must not bounce the request to
    // localhost / the LAN (the redirected request would fire before any
    // post-response check could stop it).
    redirect: 'error',
    allowedProtocols: ['https:'],
    networkErrorMessage: 'Could not fetch the image — the host must allow CORS (and must not redirect), or pass a data URL / attachment instead.',
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
        if (svg) {
          // Vector: render it no bigger than the pixel cap allows.
          if (w * h > maxPx) { const k = Math.sqrt(maxPx / (w * h)); w *= k; h *= k; }
        } else if (w * h > maxPx) {
          throw new Error(`the image is too large (${img.naturalWidth}×${img.naturalHeight} px; limit ${maxPx.toLocaleString()} pixels)`);
        }
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
