// Modal shown when importing an image (PNG/JPG/GIF/WebP) as voxels. Lets the
// user dial in how the picture is turned into a voxel model — resolution,
// billboard-vs-heightmap mode, extrusion depth / relief height, transparency
// cutoff, and color handling — with a live 2D preview and voxel-count readout
// before anything is committed to a session.

import { signal, type Signal } from '@preact/signals';
import { useMemo, useRef, useEffect } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import { mountPreactModal } from './preact/mount';
import { BUTTON_CANCEL, BUTTON_PRIMARY } from './styleConstants';
import {
  computeImageVoxelLayout,
  extractImagePalette,
  imageDataToVoxelGrid,
  countVoxelBuilderCalls,
  MAX_BUILDER_CALLS,
  type ImageDataLike,
  type ImageToVoxelOptions,
  type ImageVoxelMode,
  type ImageVoxelColorMode,
} from '../import/imageToVoxel';

export interface ImageVoxelModalOptions {
  filename?: string;
  /** The image to import. Omit / null to open the modal **first** with no
   *  image — the user then picks one inside via "Choose image…". */
  image?: ImageDataLike | null;
  /** The File the image was decoded from, when available. Threaded back out so
   *  a "swap image" keeps the right blob for Recent Imports; null for sources
   *  that didn't come from a File (e.g. the console API's URL path). */
  file?: File | null;
  /** Pre-fill the controls (e.g. re-importing a past entry with its settings). */
  initialOptions?: ImageToVoxelOptions;
}

/** What the modal resolves to on Import: the chosen options plus the image the
 *  user ended up with (original or swapped-in) and its source File + name. */
export interface ImageVoxelModalResult {
  options: ImageToVoxelOptions;
  image: ImageDataLike;
  file: File | null;
  filename: string;
}

/** Decode a picked File to ImageData for the swap-image flow. Browser-only
 *  (createImageBitmap + canvas), mirroring main.ts's decodeImageToImageData. */
async function decodeFileToImageData(file: File): Promise<ImageData> {
  const bmp = await createImageBitmap(file);
  try {
    const canvas = document.createElement('canvas');
    canvas.width = bmp.width;
    canvas.height = bmp.height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('Could not get a 2D canvas context to read image pixels.');
    ctx.drawImage(bmp, 0, 0);
    return ctx.getImageData(0, 0, bmp.width, bmp.height);
  } finally {
    bmp.close();
  }
}

// Above this the model gets heavy to mesh/render; we warn but don't block.
const HEAVY_VOXEL_COUNT = 250_000;

type Opts = Required<Omit<ImageToVoxelOptions, 'flatColor' | 'backgroundColor' | 'palette'>> & {
  flatColor: [number, number, number];
  /** A locked fixed palette (pixels snap to nearest), or null for none. */
  palette: [number, number, number][] | null;
};

/** Default number of colors to extract when the user switches on the custom
 *  palette (and the posterize default). */
const DEFAULT_COLOR_COUNT = 6;

const DEFAULT_OPTS: Opts = {
  maxSize: 64,
  mode: 'billboard',
  depth: 1,
  maxHeight: 16,
  baseThickness: 1,
  invert: false,
  alphaThreshold: 128,
  colorMode: 'original',
  flatColor: [180, 180, 180],
  gamma: 1,
  brightness: 0,
  contrast: 0,
  saturation: 0,
  posterizeColors: 0,
  palette: null,
  removeBackground: false,
  codeStyle: 'decode',
};

/** Seed the modal state from optional initial options, falling back to each
 *  default. Picks only the fields the modal owns (drops backgroundColor, which
 *  the modal has no control for — auto-detect is used when removeBackground is
 *  on). */
function seedOpts(init?: ImageToVoxelOptions): Opts {
  if (!init) return { ...DEFAULT_OPTS };
  return {
    maxSize: init.maxSize ?? DEFAULT_OPTS.maxSize,
    mode: init.mode ?? DEFAULT_OPTS.mode,
    depth: init.depth ?? DEFAULT_OPTS.depth,
    maxHeight: init.maxHeight ?? DEFAULT_OPTS.maxHeight,
    baseThickness: init.baseThickness ?? DEFAULT_OPTS.baseThickness,
    invert: init.invert ?? DEFAULT_OPTS.invert,
    alphaThreshold: init.alphaThreshold ?? DEFAULT_OPTS.alphaThreshold,
    colorMode: init.colorMode ?? DEFAULT_OPTS.colorMode,
    flatColor: init.flatColor ?? DEFAULT_OPTS.flatColor,
    gamma: init.gamma ?? DEFAULT_OPTS.gamma,
    brightness: init.brightness ?? DEFAULT_OPTS.brightness,
    contrast: init.contrast ?? DEFAULT_OPTS.contrast,
    saturation: init.saturation ?? DEFAULT_OPTS.saturation,
    posterizeColors: init.posterizeColors ?? DEFAULT_OPTS.posterizeColors,
    palette: init.palette ?? DEFAULT_OPTS.palette,
    removeBackground: init.removeBackground ?? DEFAULT_OPTS.removeBackground,
    codeStyle: init.codeStyle ?? DEFAULT_OPTS.codeStyle,
  };
}

function toHex([r, g, b]: [number, number, number]): string {
  const h = (n: number) => n.toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`;
}
function fromHex(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return [180, 180, 180];
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

function Slider(props: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  suffix?: string;
  onChange: (v: number) => void;
}) {
  const step = props.step ?? 1;
  const shown = step < 1 ? props.value.toFixed(2) : String(props.value);
  return (
    <label class="block">
      <div class="flex items-center justify-between text-[11px] text-zinc-400 mb-0.5">
        <span>{props.label}</span>
        <span class="text-zinc-200 tabular-nums">{shown}{props.suffix ?? ''}</span>
      </div>
      <input
        type="range"
        class="w-full accent-blue-500"
        min={props.min}
        max={props.max}
        step={props.step ?? 1}
        value={props.value}
        onInput={e => props.onChange(Number((e.target as HTMLInputElement).value))}
      />
    </label>
  );
}

function SegButton<T extends string>(props: {
  value: T;
  current: T;
  onPick: (v: T) => void;
  children: ComponentChildren;
}) {
  const active = props.value === props.current;
  const cls = [
    'flex-1 px-2 py-1 rounded text-[11px] font-medium transition-colors border',
    active
      ? 'bg-blue-600 border-blue-500 text-white'
      : 'bg-zinc-800 border-zinc-700 text-zinc-300 hover:bg-zinc-700',
  ].join(' ');
  return (
    <button type="button" class={cls} onClick={() => props.onPick(props.value)}>
      {props.children}
    </button>
  );
}

/** Which color-reduction strategy the `original` mode is using, derived from
 *  the current options (a fixed palette wins over posterize). */
type ColorReduction = 'all' | 'posterize' | 'palette';
function reductionOf(o: Opts): ColorReduction {
  if (o.palette && o.palette.length > 0) return 'palette';
  if (o.posterizeColors >= 2) return 'posterize';
  return 'all';
}

/** Editable swatch list for the fixed-palette color mode: each pixel snaps to
 *  its nearest swatch. Swatches seed from the image (k-means) and can be
 *  recolored, removed, added, or re-extracted at a different count. */
function PaletteEditor(props: {
  image: ImageDataLike;
  opts: Opts;
  set: <K extends keyof Opts>(key: K, value: Opts[K]) => void;
}) {
  const { image, opts, set } = props;
  const palette = opts.palette ?? [];
  const count = palette.length;

  const reseed = (k: number) => {
    const colors = extractImagePalette(image, k, {
      maxSize: opts.maxSize,
      brightness: opts.brightness,
      contrast: opts.contrast,
      saturation: opts.saturation,
    });
    set('palette', colors.length ? colors : [[180, 180, 180]]);
    set('posterizeColors', Math.max(2, k));
  };
  const setSwatch = (i: number, hex: string) => {
    const next = palette.slice();
    next[i] = fromHex(hex);
    set('palette', next);
  };
  const removeSwatch = (i: number) => {
    const next = palette.slice();
    next.splice(i, 1);
    set('palette', next.length ? next : [[180, 180, 180]]);
  };
  const addSwatch = () => set('palette', [...palette, palette[palette.length - 1] ?? [180, 180, 180]]);

  return (
    <div class="flex flex-col gap-1.5 mt-1.5">
      <div class="flex flex-wrap items-center gap-1.5">
        {palette.map((c, i) => (
          <div class="relative">
            <input
              type="color"
              class="w-7 h-7 rounded border border-zinc-700 bg-transparent cursor-pointer"
              value={toHex(c)}
              onInput={e => setSwatch(i, (e.target as HTMLInputElement).value)}
            />
            <button
              type="button"
              title="Remove color"
              class="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-zinc-900 border border-zinc-600 text-zinc-300 text-[10px] leading-none flex items-center justify-center hover:bg-rose-600 hover:border-rose-500"
              onClick={() => removeSwatch(i)}
            >×</button>
          </div>
        ))}
        <button
          type="button"
          title="Add a color"
          class="w-7 h-7 rounded border border-dashed border-zinc-600 text-zinc-400 text-base leading-none hover:bg-zinc-700 hover:text-zinc-200"
          onClick={addSwatch}
        >+</button>
      </div>
      <div class="flex items-center gap-2 text-[11px] text-zinc-400">
        <span>Re-extract</span>
        <button type="button" class="w-5 h-5 rounded bg-zinc-700 text-zinc-200 leading-none hover:bg-zinc-600"
          onClick={() => reseed(Math.max(2, count - 1))}>−</button>
        <span class="text-zinc-200 tabular-nums w-4 text-center">{count}</span>
        <button type="button" class="w-5 h-5 rounded bg-zinc-700 text-zinc-200 leading-none hover:bg-zinc-600"
          onClick={() => reseed(Math.min(16, count + 1))}>+</button>
        <span>from image</span>
      </div>
      <div class="text-[10px] text-zinc-500 leading-snug">
        Each pixel snaps to the nearest swatch. Edit a swatch to recolor it; − / + re-extracts that many colors (discarding manual edits).
      </div>
    </div>
  );
}

function ImageVoxelBody(props: {
  imageSig: Signal<ImageDataLike | null>;
  filenameSig: Signal<string>;
  fileSig: Signal<File | null>;
  swapErrorSig: Signal<string | null>;
  state: Signal<Opts>;
}) {
  const { imageSig, filenameSig, fileSig, swapErrorSig, state } = props;
  const image = imageSig.value;
  const opts = state.value;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const swapInputRef = useRef<HTMLInputElement>(null);

  const set = <K extends keyof Opts>(key: K, value: Opts[K]) => {
    state.value = { ...state.value, [key]: value };
  };

  // Switch between the three `original`-mode color strategies. 'palette' seeds
  // an editable swatch list from the image so the user can then tweak it.
  const pickReduction = (r: ColorReduction) => {
    if (r === 'all') {
      set('palette', null);
      set('posterizeColors', 0);
      return;
    }
    if (r === 'posterize') {
      set('palette', null);
      set('posterizeColors', opts.posterizeColors >= 2 ? opts.posterizeColors : DEFAULT_COLOR_COUNT);
      return;
    }
    if (!image) return; // can't seed a palette without an image
    const k = opts.posterizeColors >= 2 ? opts.posterizeColors : DEFAULT_COLOR_COUNT;
    const colors = extractImagePalette(image, k, {
      maxSize: opts.maxSize,
      brightness: opts.brightness,
      contrast: opts.contrast,
      saturation: opts.saturation,
    });
    set('palette', colors.length ? colors : [[180, 180, 180]]);
    set('posterizeColors', Math.max(2, k));
  };

  // Swap the source image while keeping every tuned knob. Decoding replaces the
  // reactive image/file/filename signals, which re-derives the preview + count.
  const onSwapFile = async (file: File): Promise<void> => {
    try {
      const decoded = await decodeFileToImageData(file);
      swapErrorSig.value = null;
      imageSig.value = decoded;
      fileSig.value = file;
      filenameSig.value = file.name;
    } catch {
      swapErrorSig.value = `Could not read "${file.name}".`;
    }
  };

  // Recompute the voxel layout whenever a parameter changes. Cheap: it walks
  // the downsampled pixels once (≤ maxSize²) without allocating a grid.
  const layout = useMemo(
    () => (image
      ? computeImageVoxelLayout(image, opts)
      : { tw: 0, th: 0, columns: [], voxelCount: 0, dims: { x: 0, y: 0, z: 0 } }),
    [image, opts],
  );

  // When "Editable code" is selected, work out up front whether the model fits
  // in readable builder calls or will fall back to the compact blob — so the
  // choice isn't a silent surprise at import time. Since calls ≤ voxelCount,
  // only the ambiguous (> cap) case needs the pricier exact decomposition.
  const callPlan = useMemo(() => {
    if (opts.codeStyle !== 'calls' || !image || layout.voxelCount === 0) return null;
    if (layout.voxelCount <= MAX_BUILDER_CALLS) return { fallback: false, count: null as number | null };
    const count = countVoxelBuilderCalls(imageDataToVoxelGrid(image, opts));
    return { fallback: count > MAX_BUILDER_CALLS, count };
  }, [image, opts, layout.voxelCount]);

  // Draw the front-view preview. Heightmap mode shades each pixel by its
  // resulting column height so the relief reads at a glance.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const { tw, th, columns, dims } = layout;
    canvas.width = Math.max(1, tw);
    canvas.height = Math.max(1, th);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!columns.length) return;
    const img = ctx.createImageData(tw, th);
    const maxH = Math.max(1, dims.y);
    for (const c of columns) {
      const shade = opts.mode === 'heightmap' ? 0.35 + 0.65 * (c.height / maxH) : 1;
      const o = (c.py * tw + c.px) * 4;
      img.data[o] = Math.round(c.color[0] * shade);
      img.data[o + 1] = Math.round(c.color[1] * shade);
      img.data[o + 2] = Math.round(c.color[2] * shade);
      img.data[o + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
  }, [layout, opts.mode]);

  const heavy = layout.voxelCount > HEAVY_VOXEL_COUNT;
  const empty = layout.voxelCount === 0;

  // Modal-first: no image picked yet. Show just the "Choose image…" call to
  // action; the controls + preview appear once an image is loaded.
  if (!image) {
    return (
      <div class="flex flex-col items-center gap-3 py-8 text-center">
        <p class="text-[12px] text-zinc-300 font-medium">Import an image as a voxel model</p>
        <p class="text-[11px] text-zinc-500 max-w-[260px] leading-relaxed">
          Pick a picture (PNG, JPG, GIF, WebP) — a logo, sprite, or small photo. You'll tune resolution, color, and depth next.
        </p>
        <input
          ref={swapInputRef}
          data-testid="voxel-image-input"
          type="file"
          accept="image/png,image/jpeg,image/gif,image/webp,image/bmp,image/*"
          class="hidden"
          onChange={e => {
            const f = (e.target as HTMLInputElement).files?.[0];
            if (f) void onSwapFile(f);
            (e.target as HTMLInputElement).value = '';
          }}
        />
        <button type="button" class={BUTTON_PRIMARY} onClick={() => swapInputRef.current?.click()}>
          Choose image…
        </button>
        {swapErrorSig.value && (
          <div class="text-[10px] text-rose-400 leading-snug max-w-[260px]">{swapErrorSig.value}</div>
        )}
      </div>
    );
  }

  return (
    <div class="flex flex-col gap-3">
      <p class="text-[11px] text-zinc-400 leading-relaxed">
        Import <span class="text-zinc-200 font-medium">{filenameSig.value}</span> as voxels.
      </p>

      <div class="flex gap-3">
        {/* Live preview */}
        <div class="shrink-0 flex flex-col items-center gap-1">
          <div
            class="rounded border border-zinc-700 flex items-center justify-center bg-zinc-900"
            style="width:140px;height:140px;"
          >
            <canvas
              ref={canvasRef}
              class="max-w-[136px] max-h-[136px]"
              style="image-rendering:pixelated;"
            />
          </div>
          <div class={`text-[10px] tabular-nums ${heavy ? 'text-amber-400' : 'text-zinc-400'}`}>
            ≈ {layout.voxelCount.toLocaleString()} voxels
          </div>
          <div class="text-[10px] text-zinc-500 tabular-nums">
            {layout.dims.x}×{layout.dims.y}×{layout.dims.z}
          </div>
          {/* Swap the source image while keeping all tuned settings. */}
          <input
            ref={swapInputRef}
            data-testid="voxel-image-input"
            type="file"
            accept="image/png,image/jpeg,image/gif,image/webp,image/bmp,image/*"
            class="hidden"
            onChange={e => {
              const f = (e.target as HTMLInputElement).files?.[0];
              if (f) void onSwapFile(f);
              (e.target as HTMLInputElement).value = '';
            }}
          />
          <button
            type="button"
            class="mt-0.5 px-2 py-1 rounded text-[10px] font-medium bg-zinc-700 text-zinc-200 hover:bg-zinc-600 transition-colors"
            onClick={() => swapInputRef.current?.click()}
          >
            Choose a different image…
          </button>
          {swapErrorSig.value && (
            <div class="text-[10px] text-rose-400 leading-snug max-w-[140px] text-center">{swapErrorSig.value}</div>
          )}
        </div>

        {/* Controls */}
        <div class="flex-1 flex flex-col gap-2.5 min-w-0">
          <div>
            <div class="text-[11px] text-zinc-400 mb-0.5">Mode</div>
            <div class="flex gap-1">
              <SegButton<ImageVoxelMode> value="billboard" current={opts.mode} onPick={v => set('mode', v)}>
                Billboard
              </SegButton>
              <SegButton<ImageVoxelMode> value="heightmap" current={opts.mode} onPick={v => set('mode', v)}>
                Heightmap
              </SegButton>
            </div>
            <div class="text-[10px] text-zinc-500 mt-0.5 leading-snug">
              {opts.mode === 'billboard'
                ? 'A flat standing picture extruded to a uniform thickness.'
                : 'Pixel brightness drives a per-column height — a 3D relief.'}
            </div>
          </div>

          <Slider label="Resolution (longest side)" value={opts.maxSize} min={8} max={128} suffix=" px"
            onChange={v => set('maxSize', v)} />

          {opts.mode === 'billboard' ? (
            <Slider label="Thickness" value={opts.depth} min={1} max={32} suffix=" vox"
              onChange={v => set('depth', v)} />
          ) : (
            <>
              <Slider label="Max relief height" value={opts.maxHeight} min={1} max={64} suffix=" vox"
                onChange={v => set('maxHeight', v)} />
              <Slider label="Base thickness" value={opts.baseThickness} min={0} max={16} suffix=" vox"
                onChange={v => set('baseThickness', v)} />
              <label class="flex items-center gap-2 text-[11px] text-zinc-300 cursor-pointer">
                <input type="checkbox" class="accent-blue-500" checked={opts.invert}
                  onChange={e => set('invert', (e.target as HTMLInputElement).checked)} />
                Invert (dark areas raised)
              </label>
              <Slider label="Gamma (midtone curve)" value={opts.gamma} min={0.2} max={3} step={0.1}
                onChange={v => set('gamma', v)} />
            </>
          )}

          <Slider label="Transparency cutoff (alpha)" value={opts.alphaThreshold} min={0} max={255}
            onChange={v => set('alphaThreshold', v)} />

          <label class="flex items-center gap-2 text-[11px] text-zinc-300 cursor-pointer">
            <input type="checkbox" class="accent-blue-500" checked={opts.removeBackground}
              onChange={e => set('removeBackground', (e.target as HTMLInputElement).checked)} />
            Remove background (auto-detect)
          </label>

          <div>
            <div class="text-[11px] text-zinc-400 mb-0.5">Color</div>
            <div class="flex gap-1 items-center">
              <SegButton<ImageVoxelColorMode> value="original" current={opts.colorMode} onPick={v => set('colorMode', v)}>
                Original
              </SegButton>
              <SegButton<ImageVoxelColorMode> value="grayscale" current={opts.colorMode} onPick={v => set('colorMode', v)}>
                Gray
              </SegButton>
              <SegButton<ImageVoxelColorMode> value="flat" current={opts.colorMode} onPick={v => set('colorMode', v)}>
                Flat
              </SegButton>
              {opts.colorMode === 'flat' && (
                <input
                  type="color"
                  class="w-7 h-7 rounded border border-zinc-700 bg-transparent cursor-pointer shrink-0"
                  value={toHex(opts.flatColor)}
                  onInput={e => set('flatColor', fromHex((e.target as HTMLInputElement).value))}
                />
              )}
            </div>
            {opts.colorMode === 'original' && (
              <div class="mt-1.5">
                <div class="flex gap-1">
                  <SegButton<ColorReduction> value="all" current={reductionOf(opts)} onPick={pickReduction}>
                    All colors
                  </SegButton>
                  <SegButton<ColorReduction> value="posterize" current={reductionOf(opts)} onPick={pickReduction}>
                    Posterize
                  </SegButton>
                  <SegButton<ColorReduction> value="palette" current={reductionOf(opts)} onPick={pickReduction}>
                    Palette
                  </SegButton>
                </div>
                {reductionOf(opts) === 'posterize' && (
                  <label class="flex items-center gap-2 text-[11px] text-zinc-300 mt-1.5">
                    Colors
                    <input
                      type="range"
                      class="flex-1 accent-blue-500"
                      min={2} max={12} step={1}
                      value={opts.posterizeColors}
                      onInput={e => set('posterizeColors', Number((e.target as HTMLInputElement).value))}
                    />
                    <span class="text-zinc-200 tabular-nums">{opts.posterizeColors}</span>
                  </label>
                )}
                {reductionOf(opts) === 'palette' && <PaletteEditor image={image} opts={opts} set={set} />}
              </div>
            )}
          </div>

          <div>
            <div class="text-[11px] text-zinc-400 mb-0.5">Editor code</div>
            <div class="flex gap-1">
              <SegButton<'decode' | 'calls'> value="decode" current={opts.codeStyle} onPick={v => set('codeStyle', v)}>
                Compact data
              </SegButton>
              <SegButton<'decode' | 'calls'> value="calls" current={opts.codeStyle} onPick={v => set('codeStyle', v)}>
                Editable code
              </SegButton>
            </div>
            <div class="text-[10px] text-zinc-500 mt-0.5 leading-snug">
              {opts.codeStyle === 'decode'
                ? 'A compact voxels.decode("…") blob — small and fast to load.'
                : 'Readable v.fillBox(…) / v.set(…) you can hand-edit.'}
            </div>
            {callPlan && callPlan.fallback && (
              <div class="text-[10px] text-amber-400 mt-0.5 leading-snug">
                {callPlan.count!.toLocaleString()} blocks exceeds the {MAX_BUILDER_CALLS.toLocaleString()}-block limit, so this saves as compact data instead. Lower the resolution or use a Palette to keep it editable.
              </div>
            )}
            {callPlan && !callPlan.fallback && (
              <div class="text-[10px] text-emerald-400 mt-0.5 leading-snug">
                {callPlan.count != null ? `≈ ${callPlan.count.toLocaleString()} editable calls.` : 'Editable builder calls ✓'}
              </div>
            )}
          </div>

          <details class="text-[11px]">
            <summary class="text-zinc-400 cursor-pointer select-none">Image adjustments</summary>
            <div class="flex flex-col gap-2 mt-1.5">
              <Slider label="Brightness" value={opts.brightness} min={-1} max={1} step={0.05}
                onChange={v => set('brightness', v)} />
              <Slider label="Contrast" value={opts.contrast} min={-1} max={1} step={0.05}
                onChange={v => set('contrast', v)} />
              <Slider label="Saturation" value={opts.saturation} min={-1} max={1} step={0.05}
                onChange={v => set('saturation', v)} />
            </div>
          </details>
        </div>
      </div>

      {heavy && (
        <p class="text-[10px] text-amber-400 leading-snug">
          That's a lot of voxels — meshing and editing may be slow. Lower the resolution or relief height to lighten it.
        </p>
      )}
      {empty && (
        <p class="text-[10px] text-rose-400 leading-snug">
          No voxels at these settings — every sampled pixel was dropped. Lower the transparency cutoff{opts.mode === 'heightmap' ? ' or raise the base thickness' : ''}.
        </p>
      )}
    </div>
  );
}

function emitOptions(o: Opts): ImageToVoxelOptions {
  const out: ImageToVoxelOptions = {
    maxSize: o.maxSize,
    mode: o.mode,
    depth: o.depth,
    maxHeight: o.maxHeight,
    baseThickness: o.baseThickness,
    invert: o.invert,
    alphaThreshold: o.alphaThreshold,
    colorMode: o.colorMode,
    flatColor: o.flatColor,
    gamma: o.gamma,
    brightness: o.brightness,
    contrast: o.contrast,
    saturation: o.saturation,
    posterizeColors: o.posterizeColors,
    removeBackground: o.removeBackground,
    codeStyle: o.codeStyle,
  };
  // Only emit a fixed palette when one is actually in use (original mode).
  if (o.colorMode === 'original' && o.palette && o.palette.length > 0) out.palette = o.palette;
  return out;
}

function ImageVoxelFooter(props: {
  imageSig: Signal<ImageDataLike | null>;
  state: Signal<Opts>;
  onImport: (opts: ImageToVoxelOptions) => void;
  onCancel: () => void;
}) {
  const opts = props.state.value;
  const image = props.imageSig.value;
  // Disabled until an image is picked and it yields at least one voxel.
  const empty = !image || computeImageVoxelLayout(image, opts).voxelCount === 0;
  return (
    <>
      <button type="button" class={BUTTON_CANCEL} onClick={props.onCancel}>Cancel</button>
      <button
        type="button"
        class={BUTTON_PRIMARY}
        disabled={empty}
        style={empty ? 'opacity:0.5;cursor:not-allowed;' : ''}
        onClick={() => { if (!empty) props.onImport(emitOptions(opts)); }}
      >Import</button>
    </>
  );
}

/** Show the image-to-voxel parameter modal. Resolves to the chosen options
 *  plus the (possibly swapped-in) image + source File, or `null` on cancel. */
export function showImageVoxelImportModal(opts: ImageVoxelModalOptions): Promise<ImageVoxelModalResult | null> {
  return new Promise(resolve => {
    let result: ImageVoxelModalResult | null = null;
    const state = signal<Opts>(seedOpts(opts.initialOptions));
    // Image / file / name are reactive so "Choose (a different) image…" swaps
    // the source in place without tearing down the modal or losing tuned knobs.
    // image starts null in the modal-first flow (no file picked yet).
    const imageSig = signal<ImageDataLike | null>(opts.image ?? null);
    const fileSig = signal<File | null>(opts.file ?? null);
    const filenameSig = signal<string>(opts.filename ?? '');
    const swapErrorSig = signal<string | null>(null);
    mountPreactModal(
      {
        title: 'Image → Voxel',
        scrollable: true,
        onClose: () => resolve(result),
      },
      close => ({
        body: <ImageVoxelBody imageSig={imageSig} filenameSig={filenameSig} fileSig={fileSig} swapErrorSig={swapErrorSig} state={state} />,
        footer: (
          <ImageVoxelFooter
            imageSig={imageSig}
            state={state}
            onImport={o => {
              // Import is only enabled once an image is loaded, so this is set.
              result = { options: o, image: imageSig.value!, file: fileSig.value, filename: filenameSig.value };
              close();
            }}
            onCancel={() => { result = null; close(); }}
          />
        ),
      }),
    );
  });
}
