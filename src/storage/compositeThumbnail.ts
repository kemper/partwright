// Composite "contact sheet" thumbnail for a multi-part session — the same
// all-parts view the parts-overview modal shows, rendered once into a single
// image so it can serve as the session's identity picture (catalog tile,
// embedded export preview). Built purely from each part's saved latest-version
// thumbnail: no geometry is rebuilt, so composing a 30-part kit costs a few
// IndexedDB reads and one canvas paint.

import { getLatestVersion, type Part } from './db';

/** Side length of one grid cell in the composed sheet. */
const TILE_PX = 144;
/** JPEG keeps the sheet ~5-10× smaller than PNG for these soft-shaded
 *  renders; the dark backdrop makes the lost alpha channel invisible. */
const MIME = 'image/jpeg';
const QUALITY = 0.85;
const BACKDROP = '#18181b'; // zinc-900, matching the part-rail thumb slots

/**
 * Compose the parts' latest thumbnails into one square-ish grid, returned as
 * a data URL. Returns null when fewer than two parts have a saved thumbnail —
 * a single image is not a contact sheet, and callers fall back to the
 * existing latest-version thumbnail.
 */
export async function composePartsThumbnail(parts: Part[]): Promise<string | null> {
  const blobs = await Promise.all(
    parts.map(async (p) => (await getLatestVersion(p.id))?.thumbnail ?? null),
  );
  const bitmaps: ImageBitmap[] = [];
  for (const b of blobs) {
    if (!b) continue;
    try {
      bitmaps.push(await createImageBitmap(b));
    } catch {
      // A corrupt/unsupported blob just loses its cell — never fails the export.
    }
  }
  if (bitmaps.length < 2) return null;

  const cols = Math.ceil(Math.sqrt(bitmaps.length));
  const rows = Math.ceil(bitmaps.length / cols);
  const canvas = document.createElement('canvas');
  canvas.width = cols * TILE_PX;
  canvas.height = rows * TILE_PX;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.fillStyle = BACKDROP;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  bitmaps.forEach((bmp, i) => {
    const cx = (i % cols) * TILE_PX;
    const cy = Math.floor(i / cols) * TILE_PX;
    // contain-fit inside the cell with a small inset so tiles read as tiles.
    const inset = 4;
    const avail = TILE_PX - inset * 2;
    const scale = Math.min(avail / bmp.width, avail / bmp.height);
    const w = bmp.width * scale;
    const h = bmp.height * scale;
    ctx.drawImage(bmp, cx + inset + (avail - w) / 2, cy + inset + (avail - h) / 2, w, h);
    bmp.close();
  });

  return canvas.toDataURL(MIME, QUALITY);
}
