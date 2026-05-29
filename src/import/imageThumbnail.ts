// Small thumbnail generator for the Recent Imports list. Decodes an image
// blob (or takes ready ImageData) and draws it, letterboxed, into a square
// canvas, returning a compact PNG data URL. Browser-only (canvas /
// createImageBitmap); kept out of the pure inbox module.

const THUMB_SIZE = 48;

/** Draw `bmp` (an ImageBitmap or ImageData-backed canvas source) centered and
 *  aspect-preserved into a `size`×`size` canvas, returning a PNG data URL.
 *  Returns undefined if a 2D context can't be obtained. */
function drawThumb(width: number, height: number, paint: (ctx: CanvasRenderingContext2D, dw: number, dh: number, dx: number, dy: number) => void, size: number): string | undefined {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return undefined;
  const scale = Math.min(size / width, size / height);
  const dw = Math.max(1, Math.round(width * scale));
  const dh = Math.max(1, Math.round(height * scale));
  const dx = Math.floor((size - dw) / 2);
  const dy = Math.floor((size - dh) / 2);
  // Crisp nearest-neighbor so pixel-art / sprites stay legible at thumb scale.
  ctx.imageSmoothingEnabled = false;
  paint(ctx, dw, dh, dx, dy);
  return canvas.toDataURL('image/png');
}

/** Build a thumbnail data URL from an image/SVG blob. Returns undefined on any
 *  decode failure (a missing thumbnail just means no preview in the list). */
export async function createThumbnailFromBlob(blob: Blob, size = THUMB_SIZE): Promise<string | undefined> {
  try {
    const bmp = await createImageBitmap(blob);
    try {
      return drawThumb(bmp.width, bmp.height, (ctx, dw, dh, dx, dy) => ctx.drawImage(bmp, dx, dy, dw, dh), size);
    } finally {
      bmp.close();
    }
  } catch {
    return undefined;
  }
}

/** Build a thumbnail data URL from already-decoded ImageData. */
export function createThumbnailFromImageData(image: ImageData, size = THUMB_SIZE): string | undefined {
  // Stage the full-res pixels on an intermediate canvas so drawImage can scale.
  const src = document.createElement('canvas');
  src.width = image.width;
  src.height = image.height;
  const sctx = src.getContext('2d');
  if (!sctx) return undefined;
  sctx.putImageData(image, 0, 0);
  return drawThumb(image.width, image.height, (ctx, dw, dh, dx, dy) => ctx.drawImage(src, dx, dy, dw, dh), size);
}
