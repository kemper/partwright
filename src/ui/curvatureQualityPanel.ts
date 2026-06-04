// Quality logic for per-language curvature (circular-segment) settings.
// Keeps separate SCAD and JS quality preferences so a SCAD session's medium
// default doesn't overwrite the user's JS quality. The DOM lives in
// simplifyUI.ts (the Quality panel), which calls saveQualityForLang() when
// the user picks a preset and notifyLanguageChange() when languages switch.

import { getConfig } from '../config/appConfig';
import {
  loadQualitySettings,
  saveQualitySettings,
  saveQualitySettingsSilent,
  clampCustomSegments,
  segmentsToPreset,
  type QualitySettings,
} from '../geometry/qualitySettings';
import type { Language } from '../geometry/engine';

export function loadScadSettings(): QualitySettings {
  const segs = clampCustomSegments(getConfig().ui.scadDefaultQuality);
  const preset = segmentsToPreset(segs);
  return { quality: preset, customSegments: segs };
}

export function isScad(lang: Language): boolean {
  return lang === 'scad';
}

// ---- Module state -------------------------------------------------------

let currentLang: Language = 'manifold-js';
// JS quality saved before entering a SCAD session so it can be restored on
// switch-back (prevents SCAD's medium default from permanently overwriting
// the user's JS quality preference in the shared main quality key).
let savedNonScadQuality: QualitySettings | null = null;

// ---- Public API --------------------------------------------------------

/** Set up the initial language; call once before any language switches. */
export function initQualityLogic(initialLang: Language): void {
  currentLang = initialLang;
}

/** Apply a quality preset for the current language. Updates the in-memory
 *  cache and fires the quality listener so the engine re-runs at the new
 *  segment count. Quality is not persisted across page reloads; the default
 *  comes from Settings (Advanced). */
export function saveQualityForLang(next: QualitySettings): void {
  saveQualitySettings(next);
}

/** Called by main.ts when the active language changes (e.g. JS → SCAD).
 *  Saves the outgoing JS quality and silently applies the incoming language's
 *  quality default so the next engine run uses the right segment count. */
export function notifyLanguageChange(lang: Language): void {
  if (lang === currentLang) return;
  const prevIsScad = isScad(currentLang);
  const nextIsScad = isScad(lang);
  currentLang = lang;

  if (!prevIsScad && nextIsScad) {
    savedNonScadQuality = loadQualitySettings();
    saveQualitySettingsSilent(loadScadSettings());
  } else if (prevIsScad && !nextIsScad) {
    if (savedNonScadQuality) {
      saveQualitySettingsSilent(savedNonScadQuality);
      savedNonScadQuality = null;
    }
  }
}
