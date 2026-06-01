// Viewport overlay panel for adjusting the circular segment count (curvature
// quality) used during geometry runs. Mirrors the pattern of paramsPanel.ts:
// draggable by the header, closeable via X or Escape, appended to viewportPane.
//
// Per-language defaults: SCAD defaults to "medium" (32 segments) because
// scripts with explicit $fn values are common and the preview pass already
// runs at low quality; non-SCAD defaults to "highest" (128 segments) matching
// the pre-existing default in qualitySettings.ts.
//
// SCAD settings are stored under a separate key so changing quality in a SCAD
// session doesn't silently alter a JS session open in another tab.

import { readPerTabPref, writePerTabPref } from '../storage/perTabPref';
import {
  loadQualitySettings,
  saveQualitySettings,
  saveQualitySettingsSilent,
  QUALITY_OPTIONS,
  QUALITY_SEGMENTS,
  type QualityPreset,
  type QualitySettings,
} from '../geometry/qualitySettings';
import type { Language } from '../geometry/engine';

const SCAD_STORAGE_KEY = 'partwright-quality-scad-v1';

const SCAD_DEFAULT: QualitySettings = { quality: 'medium', customSegments: 128 };

function loadScadSettings(): QualitySettings {
  try {
    const raw = readPerTabPref(SCAD_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<QualitySettings>;
      const q = parsed.quality;
      const quality: QualitySettings['quality'] =
        q === 'custom' || (q != null && q in QUALITY_SEGMENTS) ? q : SCAD_DEFAULT.quality;
      const customSegments =
        typeof parsed.customSegments === 'number' ? parsed.customSegments : SCAD_DEFAULT.customSegments;
      return { quality, customSegments };
    }
  } catch {
    // Fall through to default.
  }
  return { ...SCAD_DEFAULT };
}

function saveScadSettings(next: QualitySettings): void {
  writePerTabPref(SCAD_STORAGE_KEY, JSON.stringify(next));
}

function isScad(lang: Language): boolean {
  return lang === 'scad';
}

function getSettingsForLang(lang: Language): QualitySettings {
  return isScad(lang) ? loadScadSettings() : loadQualitySettings();
}

// ---- Panel state -------------------------------------------------------

let currentLang: Language = 'manifold-js';
let panelEl: HTMLElement | null = null;
let viewportPaneRef: HTMLElement | null = null;
let radioEls: HTMLInputElement[] = [];
let openState = false;
// JS quality saved before entering a SCAD session so it can be restored on
// switch-back (prevents SCAD's medium default from permanently overwriting
// the user's JS quality preference in the shared main quality key).
let savedNonScadQuality: QualitySettings | null = null;

// ---- Public API --------------------------------------------------------

export function initCurvatureQualityPanel(
  clipControls: HTMLElement,
  viewportPane: HTMLElement,
  initialLang: Language,
): void {
  currentLang = initialLang;
  viewportPaneRef = viewportPane;
  buildPanel(viewportPane);
  buildButton(clipControls);
}

export function notifyLanguageChange(lang: Language): void {
  if (lang === currentLang) return;
  const prevIsScad = isScad(currentLang);
  const nextIsScad = isScad(lang);
  currentLang = lang;

  if (!prevIsScad && nextIsScad) {
    // Entering SCAD: save the current JS quality and apply the SCAD default
    // silently so the language-switch re-run uses the right segment count
    // without firing an extra re-run from the quality listener.
    savedNonScadQuality = loadQualitySettings();
    saveQualitySettingsSilent(loadScadSettings());
    refreshRadios();
  } else if (prevIsScad && !nextIsScad) {
    // Leaving SCAD: restore the saved JS quality (or keep whatever is in the
    // main key if we never saved one — e.g. app started in SCAD mode).
    if (savedNonScadQuality) {
      saveQualitySettingsSilent(savedNonScadQuality);
      savedNonScadQuality = null;
    }
    refreshRadios();
  }
}

export function isCurvatureQualityOpen(): boolean {
  return openState;
}

export function closeCurvatureQuality(): void {
  if (!openState) return;
  openState = false;
  panelEl?.remove();
}

// ---- Build helpers -----------------------------------------------------

function buildPanel(_viewportPane: HTMLElement): void {
  const root = document.createElement('div');
  root.id = 'curvature-quality-panel';
  // Default position: below the clip-controls bar (top-2 = 8px + ~30px bar ≈ top-10)
  root.className = 'absolute top-10 right-2 z-10 w-52 flex flex-col rounded-lg bg-zinc-900/85 backdrop-blur border border-zinc-700 shadow-lg text-zinc-200 pointer-events-auto';

  // Header — drag handle + title + close button
  const header = document.createElement('div');
  header.className = 'flex items-center gap-2 px-2.5 py-2 border-b border-zinc-700/70 select-none cursor-move touch-none';

  const title = document.createElement('span');
  title.className = 'text-xs font-medium text-zinc-300 flex-1 truncate';
  title.textContent = 'Curvature Quality';

  const closeBtn = document.createElement('button');
  closeBtn.className = 'text-zinc-400 hover:text-zinc-200 text-base leading-none w-5 h-5 flex items-center justify-center shrink-0 rounded hover:bg-zinc-700/60 transition-colors';
  closeBtn.textContent = '×';
  closeBtn.title = 'Close';
  closeBtn.setAttribute('aria-label', 'Close curvature quality panel');
  closeBtn.addEventListener('click', () => closeCurvatureQuality());

  header.appendChild(title);
  header.appendChild(closeBtn);
  root.appendChild(header);

  // Body — radio list
  const body = document.createElement('div');
  body.className = 'flex flex-col px-2.5 py-2 gap-1';

  radioEls = [];
  for (const opt of QUALITY_OPTIONS) {
    const label = document.createElement('label');
    label.className = 'flex items-start gap-2 cursor-pointer group';

    const radio = document.createElement('input');
    radio.type = 'radio';
    radio.name = 'curvature-quality';
    radio.value = opt.id;
    radio.className = 'mt-0.5 accent-blue-400 shrink-0';
    radio.addEventListener('change', () => {
      if (!radio.checked) return;
      const next: QualitySettings = {
        ...getSettingsForLang(currentLang),
        quality: opt.id as QualityPreset,
      };
      if (isScad(currentLang)) {
        saveScadSettings(next);
        saveQualitySettings(next);
      } else {
        saveQualitySettings(next);
      }
    });

    const text = document.createElement('span');
    text.className = 'flex flex-col';

    const labelText = document.createElement('span');
    labelText.className = 'text-xs text-zinc-200 group-hover:text-white leading-tight';
    labelText.textContent = opt.label;

    const hint = document.createElement('span');
    hint.className = 'text-[10px] text-zinc-500 leading-tight';
    hint.textContent = opt.hint;

    text.appendChild(labelText);
    text.appendChild(hint);
    label.appendChild(radio);
    label.appendChild(text);
    body.appendChild(label);
    radioEls.push(radio);
  }

  root.appendChild(body);

  // Note for SCAD
  const note = document.createElement('p');
  note.className = 'text-[10px] text-zinc-500 px-2.5 pb-2 leading-snug';
  note.textContent = 'OpenSCAD: scripts that set $fn directly override this.';
  root.appendChild(note);

  // Apply initial radio state
  refreshRadios();

  // ---- Dragging -------------------------------------------------------
  let dragged = false;
  let dragPointerId: number | null = null;
  let startX = 0, startY = 0, startLeft = 0, startTop = 0;

  function applyPos(left: number, top: number): void {
    root.style.left = `${left}px`;
    root.style.top = `${top}px`;
    root.style.right = 'auto';
    root.style.bottom = 'auto';
  }

  function clampIntoView(): void {
    const parent = root.offsetParent as HTMLElement | null;
    if (!parent || !root.isConnected) return;
    const pad = 8;
    const pr = parent.getBoundingClientRect();
    const rr = root.getBoundingClientRect();
    if (rr.width === 0 || rr.height === 0) return;
    const visTop = Math.max(pr.top, 0);
    const visBottom = Math.min(pr.bottom, window.innerHeight);
    const visLeft = Math.max(pr.left, 0);
    const visRight = Math.min(pr.right, window.innerWidth);
    const minLeft = (visLeft - pr.left) + pad;
    const minTop = (visTop - pr.top) + pad;
    const maxLeft = (visRight - pr.left) - rr.width - pad;
    const maxTop = (visBottom - pr.top) - rr.height - pad;
    const curLeft = rr.left - pr.left;
    const curTop = rr.top - pr.top;
    const left = Math.max(minLeft, Math.min(curLeft, maxLeft));
    const top = Math.max(minTop, Math.min(curTop, maxTop));
    if (dragged || Math.abs(left - curLeft) > 0.5 || Math.abs(top - curTop) > 0.5) {
      applyPos(left, top);
    }
  }

  header.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if ((e.target as HTMLElement).closest('button')) return;
    const parent = root.offsetParent as HTMLElement | null;
    if (!parent) return;
    const pr = parent.getBoundingClientRect();
    const rr = root.getBoundingClientRect();
    startLeft = rr.left - pr.left;
    startTop = rr.top - pr.top;
    startX = e.clientX;
    startY = e.clientY;
    dragPointerId = e.pointerId;
    dragged = true;
    header.setPointerCapture(e.pointerId);
    e.preventDefault();
  });

  header.addEventListener('pointermove', (e) => {
    if (dragPointerId !== e.pointerId) return;
    applyPos(startLeft + (e.clientX - startX), startTop + (e.clientY - startY));
  });

  function endDrag(e: PointerEvent): void {
    if (dragPointerId !== e.pointerId) return;
    dragPointerId = null;
    if (header.hasPointerCapture(e.pointerId)) header.releasePointerCapture(e.pointerId);
    clampIntoView();
  }
  header.addEventListener('pointerup', endDrag);
  header.addEventListener('pointercancel', endDrag);

  window.addEventListener('resize', () => { if (openState) clampIntoView(); });

  // Don't append to the DOM yet — panel is attached only when opened so its
  // radio inputs don't conflict with other DOM radio buttons while hidden.
  panelEl = root;
}

function buildButton(clipControls: HTMLElement): void {
  const btn = document.createElement('button');
  btn.id = 'curvature-quality-toggle';
  btn.className = 'px-2 py-1 rounded text-xs bg-zinc-800/80 backdrop-blur text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700/80 transition-colors border border-zinc-600/50';
  btn.textContent = '○ Quality';
  btn.title = 'Adjust curvature quality (circular segment count)';
  btn.addEventListener('click', () => {
    if (openState) {
      closeCurvatureQuality();
    } else {
      openState = true;
      if (panelEl && viewportPaneRef && !panelEl.isConnected) {
        viewportPaneRef.appendChild(panelEl);
      }
      refreshRadios();
    }
  });

  // Insert before the measure toggle, same pattern as paramsPanel button
  const measureToggle = clipControls.querySelector('#measure-toggle');
  if (measureToggle) clipControls.insertBefore(btn, measureToggle);
  else clipControls.appendChild(btn);
}

function refreshRadios(): void {
  const current = getSettingsForLang(currentLang);
  for (const radio of radioEls) {
    radio.checked = radio.value === current.quality;
  }
}
