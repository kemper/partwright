// "Import colours from a photo" — a modal for building the palette from a
// reference image (e.g. a screenshot of your filament spools / Bambu Studio
// colour list). Two complementary ways to pick:
//   • Detected colours — the image's dominant colours (k-means via the shared
//     `extractImagePalette`), shown as toggle swatches; select the ones you want.
//   • Eyedropper — click anywhere on the photo to sample that exact pixel.
// The union of both selections is handed back to the caller to add as slots.

import { createModalShell } from '../ui/modalShell';
import { BUTTON_PRIMARY, BUTTON_CANCEL } from '../ui/styleConstants';
import { showToast } from '../ui/toast';
import { extractImagePalette } from '../import/imageToVoxel';
import { rgbToHex } from './palette';

const DISPLAY_MAX = 1024; // decode/sample resolution cap (keeps it snappy)

async function decodeToCanvas(file: File): Promise<{ canvas: HTMLCanvasElement; imageData: ImageData }> {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, DISPLAY_MAX / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * scale));
  const h = Math.max(1, Math.round(bmp.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(bmp, 0, 0, w, h);
  bmp.close();
  return { canvas, imageData: ctx.getImageData(0, 0, w, h) };
}

/** Open the photo colour picker. `onAdd` receives the chosen hex colours (lower
 *  case `#rrggbb`), de-duplicated, in selection order. `onClose` fires when the
 *  modal is dismissed (after Add or Cancel) — callers use it to return to the
 *  palette manager (which modalShell auto-closed when this opened). */
export function openPhotoColorPicker(onAdd: (hexes: string[]) => void, onClose?: () => void): void {
  const shell = createModalShell({
    title: '🖼️ Import colours from a photo',
    widthClass: 'max-w-lg',
    scrollable: true,
    onClose,
  });

  // Selection state (insertion-ordered, deduped).
  const selected = new Set<string>();

  const intro = document.createElement('p');
  intro.className = 'text-xs text-zinc-400 leading-snug';
  intro.textContent = 'Upload a photo of your filament spools (or a screenshot of your slicer’s colour list). Toggle the detected colours you want, and/or click the photo to eyedrop exact pixels.';
  shell.body.appendChild(intro);

  // Hidden file input + chooser button.
  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = 'image/*';
  fileInput.className = 'hidden';
  shell.body.appendChild(fileInput);

  const chooseBtn = document.createElement('button');
  chooseBtn.className = `${BUTTON_CANCEL} mt-2`;
  chooseBtn.textContent = 'Choose photo…';
  chooseBtn.addEventListener('click', () => fileInput.click());
  shell.body.appendChild(chooseBtn);

  // Stage (image + swatches), populated after a file loads.
  const stage = document.createElement('div');
  stage.className = 'mt-3 flex flex-col gap-3';
  shell.body.appendChild(stage);

  // Footer.
  const cancelBtn = document.createElement('button');
  cancelBtn.className = BUTTON_CANCEL;
  cancelBtn.textContent = 'Cancel';
  cancelBtn.addEventListener('click', () => shell.close());
  const addBtn = document.createElement('button');
  addBtn.className = BUTTON_PRIMARY;
  addBtn.disabled = true;
  addBtn.style.opacity = '0.5';
  addBtn.textContent = 'Add to palette';
  addBtn.addEventListener('click', () => {
    if (selected.size === 0) return;
    onAdd([...selected]);
    showToast(`Added ${selected.size} colour${selected.size === 1 ? '' : 's'} to the palette`, { variant: 'success', source: 'import' });
    shell.close();
  });
  shell.footer.append(cancelBtn, addBtn);

  function refreshAddBtn(): void {
    const n = selected.size;
    addBtn.disabled = n === 0;
    addBtn.style.opacity = n === 0 ? '0.5' : '1';
    addBtn.textContent = n === 0 ? 'Add to palette' : `Add ${n} to palette`;
  }

  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    chooseBtn.textContent = 'Change photo…';
    try {
      const { canvas, imageData } = await decodeToCanvas(file);
      buildStage(canvas, imageData);
    } catch {
      showToast('Could not read that image', { variant: 'warn', source: 'import' });
    }
  });

  function buildStage(canvas: HTMLCanvasElement, imageData: ImageData): void {
    stage.replaceChildren();
    selected.clear();
    refreshAddBtn();

    // — Photo with eyedropper —
    canvas.className = 'w-full max-h-64 object-contain rounded border border-zinc-700 cursor-crosshair bg-zinc-900';
    canvas.title = 'Click to eyedrop a colour';
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    canvas.addEventListener('click', (e) => {
      const rect = canvas.getBoundingClientRect();
      const x = Math.round((e.clientX - rect.left) * (canvas.width / rect.width));
      const y = Math.round((e.clientY - rect.top) * (canvas.height / rect.height));
      const px = ctx.getImageData(Math.max(0, Math.min(canvas.width - 1, x)), Math.max(0, Math.min(canvas.height - 1, y)), 1, 1).data;
      const hex = rgbToHex([px[0] / 255, px[1] / 255, px[2] / 255]);
      addPicked(hex);
    });
    stage.appendChild(canvas);

    // — Detected colours (with a count slider) —
    const detLabel = document.createElement('div');
    detLabel.className = 'flex items-center justify-between';
    const detTitle = document.createElement('span');
    detTitle.className = 'text-[10px] text-zinc-500 uppercase tracking-wider font-medium';
    detTitle.textContent = 'Detected colours';
    const countWrap = document.createElement('label');
    countWrap.className = 'flex items-center gap-1.5 text-[10px] text-zinc-500';
    const countInput = document.createElement('input');
    countInput.type = 'range';
    countInput.min = '4';
    countInput.max = '16';
    countInput.value = '12';
    countInput.className = 'w-24 accent-blue-500';
    const countVal = document.createElement('span');
    countVal.className = 'tabular-nums w-5 text-right';
    countVal.textContent = '12';
    countWrap.append(countInput, countVal);
    detLabel.append(detTitle, countWrap);
    stage.appendChild(detLabel);

    const detGrid = document.createElement('div');
    detGrid.className = 'grid grid-cols-8 gap-1.5';
    stage.appendChild(detGrid);

    const renderDetected = () => {
      const k = parseInt(countInput.value, 10);
      countVal.textContent = String(k);
      detGrid.replaceChildren();
      const colors = extractImagePalette(imageData, k, { maxSize: 256 });
      for (const rgb of colors) {
        const hex = rgbToHex([rgb[0] / 255, rgb[1] / 255, rgb[2] / 255]);
        detGrid.appendChild(makeToggle(hex));
      }
    };
    countInput.addEventListener('input', renderDetected);
    renderDetected();

    // — Eyedropped colours —
    const pickTitle = document.createElement('div');
    pickTitle.className = 'text-[10px] text-zinc-500 uppercase tracking-wider font-medium';
    pickTitle.textContent = 'Eyedropped';
    const pickGrid = document.createElement('div');
    pickGrid.className = 'grid grid-cols-8 gap-1.5';
    const pickWrap = document.createElement('div');
    pickWrap.className = 'hidden flex-col gap-1.5';
    pickWrap.append(pickTitle, pickGrid);
    stage.appendChild(pickWrap);

    function addPicked(hex: string): void {
      pickWrap.classList.remove('hidden');
      pickWrap.classList.add('flex');
      // De-dupe within the eyedropped row.
      if (pickGrid.querySelector(`[data-hex="${hex}"]`)) {
        selected.add(hex);
        refreshAddBtn();
        return;
      }
      const sw = makeToggle(hex, true);
      pickGrid.appendChild(sw);
    }

    // A toggle swatch. `preselect` selects it immediately (used for eyedropped).
    function makeToggle(hex: string, preselect = false): HTMLElement {
      const btn = document.createElement('button');
      btn.dataset.hex = hex;
      btn.className = 'w-7 h-7 rounded border-2 transition-colors';
      btn.style.backgroundColor = hex;
      btn.title = hex;
      const sync = () => {
        const on = selected.has(hex);
        btn.classList.toggle('border-white/90', on);
        btn.classList.toggle('ring-2', on);
        btn.classList.toggle('ring-blue-400/50', on);
        btn.classList.toggle('border-transparent', !on);
      };
      btn.addEventListener('click', () => {
        if (selected.has(hex)) selected.delete(hex); else selected.add(hex);
        sync();
        refreshAddBtn();
      });
      if (preselect) selected.add(hex);
      sync();
      refreshAddBtn();
      return btn;
    }
  }
}
