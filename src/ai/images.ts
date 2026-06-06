// Image capture for the "Show AI" button. We use window.partwright.renderView
// to produce data-URL PNGs from any angle without touching the live viewport
// canvas (which has preserveDrawingBuffer=false and would race with normal
// rendering). Each call returns one stitched PNG laying out front / right /
// top / iso in a 2x2 grid — one image block instead of four, which costs the
// model less context.

import type { ImageSource } from './types';
import { STANDARD_VIEWS } from '../renderer/multiview';

const ISO_VIEWS = Object.values(STANDARD_VIEWS);

const TILE_SIZE = 384;
const LABEL_HEIGHT = 24;

type RenderViewFn = (opts: { elevation: number; azimuth: number; ortho: boolean; size: number }) => string | null;

function getRenderView(): RenderViewFn | null {
  const w = window as unknown as { partwright?: { renderView?: RenderViewFn } };
  return w.partwright?.renderView ?? null;
}

/** Snapshot the 4 iso views as a single composited PNG. Returns null when
 *  no geometry is loaded (renderView returns null) or partwright isn't
 *  ready. */
export async function captureIsoViews(): Promise<ImageSource | null> {
  const renderView = getRenderView();
  if (!renderView) return null;

  const tiles: { label: string; image: HTMLImageElement }[] = [];
  for (const spec of ISO_VIEWS) {
    const dataUrl = renderView({ elevation: spec.elevation, azimuth: spec.azimuth, ortho: spec.ortho, size: TILE_SIZE });
    if (!dataUrl) return null;
    const image = await loadImage(dataUrl);
    tiles.push({ label: spec.label, image });
  }

  const cellHeight = TILE_SIZE + LABEL_HEIGHT;
  const composite = document.createElement('canvas');
  composite.width = TILE_SIZE * 2;
  composite.height = cellHeight * 2;
  const ctx = composite.getContext('2d');
  if (!ctx) return null;
  ctx.fillStyle = '#f4f4f5';
  ctx.fillRect(0, 0, composite.width, composite.height);

  tiles.forEach((tile, i) => {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const x = col * TILE_SIZE;
    const y = row * cellHeight;
    ctx.drawImage(tile.image, x, y, TILE_SIZE, TILE_SIZE);
    ctx.fillStyle = '#27272a';
    ctx.fillRect(x, y + TILE_SIZE, TILE_SIZE, LABEL_HEIGHT);
    ctx.fillStyle = '#f4f4f5';
    ctx.font = '13px -apple-system, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(tile.label, x + TILE_SIZE / 2, y + TILE_SIZE + 16);
  });

  const blob = await canvasToBlob(composite, 'image/png');
  if (!blob) return null;
  const data = await blobToBase64(blob);
  return { data, mediaType: 'image/png', label: 'iso views (front, right, top, iso)' };
}

/**
 * Tile the session's reference images into a single labeled grid PNG, so the
 * `getReferenceImages` tool can hand the model ALL of them in one multimodal
 * block (the tool-result channel carries only one image). Each cell shows the
 * image contain-fit into a square with its caption beneath. Returns null when
 * there are no images or the canvas can't be created.
 */
export async function compositeReferenceGrid(
  images: Array<{ src: string; label?: string }>,
): Promise<ImageSource | null> {
  if (images.length === 0) return null;
  const tile = images.length > 9 ? 240 : 360;
  const cols = Math.ceil(Math.sqrt(images.length));
  const rows = Math.ceil(images.length / cols);
  const cellH = tile + LABEL_HEIGHT;

  const canvas = document.createElement('canvas');
  canvas.width = cols * tile;
  canvas.height = rows * cellH;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.fillStyle = '#f4f4f5';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  for (let i = 0; i < images.length; i++) {
    const x = (i % cols) * tile;
    const y = Math.floor(i / cols) * cellH;
    let img: HTMLImageElement | null = null;
    try { img = await loadImage(images[i].src); } catch { img = null; }
    if (img && img.width > 0 && img.height > 0) {
      const scale = Math.min(tile / img.width, tile / img.height);
      const w = img.width * scale, h = img.height * scale;
      ctx.drawImage(img, x + (tile - w) / 2, y + (tile - h) / 2, w, h);
    } else {
      ctx.fillStyle = '#3f3f46';
      ctx.fillRect(x, y, tile, tile);
    }
    ctx.fillStyle = '#27272a';
    ctx.fillRect(x, y + tile, tile, LABEL_HEIGHT);
    ctx.fillStyle = '#f4f4f5';
    ctx.font = '13px -apple-system, system-ui, sans-serif';
    ctx.textAlign = 'center';
    const label = images[i].label?.trim() || `#${i + 1}`;
    ctx.fillText(label, x + tile / 2, y + tile + 16);
  }

  const blob = await canvasToBlob(canvas, 'image/png');
  if (!blob) return null;
  const data = await blobToBase64(blob);
  return { data, mediaType: 'image/png', label: `${images.length} reference image(s)` };
}

/** Convert a user-supplied File (drag-drop or paste) to an ImageSource.
 *  Rejects anything that isn't an image. */
export async function fileToImageSource(file: File): Promise<ImageSource | null> {
  if (!file.type.startsWith('image/')) return null;
  const data = await blobToBase64(file);
  const media = file.type as ImageSource['mediaType'];
  // Anthropic accepts png / jpeg / gif / webp. Fall back to png label if the
  // browser reports something exotic — the bytes are what matter.
  const safeMedia: ImageSource['mediaType'] = (
    media === 'image/png' || media === 'image/jpeg' || media === 'image/gif' || media === 'image/webp'
  ) ? media : 'image/png';
  return { data, mediaType: safeMedia, label: file.name };
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('image decode failed'));
    img.src = src;
  });
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string): Promise<Blob | null> {
  return new Promise(resolve => canvas.toBlob(b => resolve(b), type));
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // strip the "data:<media>;base64," prefix — we store raw base64
      const comma = result.indexOf(',');
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}
