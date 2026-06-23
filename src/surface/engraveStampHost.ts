// Browser-side stamp builders for the engrave modifier. These are the DOM-only
// steps the pure `engraveStamp` module deliberately leaves out: fetching the
// app's fonts and decoding an image. Both return a plain `StampMask` (data) that
// the pure field math then consumes, so the heavy logic stays unit-testable.

import { preloadTextFonts, textToContours, type FontVariant } from '../geometry/textGlyphs';
import { loadImageDataFromUrl, resizeImageData } from '../color/imagePaint';
import { rasterizeContours, maskFromRGBA, type StampMask } from './engraveStamp';

/** Rasterize text to an ink mask using the app's own text path (Liberation
 *  Sans via opentype.js), so engraved text matches `api.text()`. Bold by
 *  default — heavier strokes engrave/cut more legibly. */
export async function buildTextStampMask(
  text: string,
  opts: { font?: FontVariant; maxDim?: number } = {},
): Promise<StampMask> {
  await preloadTextFonts();
  const contours = textToContours(text, { size: 100, font: opts.font ?? 'bold' });
  return rasterizeContours(contours, { maxDim: opts.maxDim ?? 512, paddingFrac: 0.08 });
}

/** Decode an image URL (data: or remote) to an ink mask. Dark/opaque pixels
 *  read as ink by default; `invert` flips that for light-on-dark art. */
export async function buildImageStampMask(
  url: string,
  opts: { invert?: boolean; maxDim?: number } = {},
): Promise<StampMask> {
  const decoded = await loadImageDataFromUrl(url);
  const sized = resizeImageData(decoded, opts.maxDim ?? 384);
  return maskFromRGBA(sized.data, sized.width, sized.height, { invert: opts.invert });
}
