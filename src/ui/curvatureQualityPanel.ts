// Quality logic for per-language curvature (circular-segment) settings.
// Keeps separate SCAD and JS quality preferences so a SCAD session's medium
// default doesn't overwrite the user's JS quality. The DOM lives in
// simplifyUI.ts (the Quality panel), which calls saveQualityForLang() when
// the user picks a preset and notifyLanguageChange() when languages switch.

import { readPerTabPref, writePerTabPref } from '../storage/perTabPref';
import {
  loadQualitySettings,
  saveQualitySettings,
  saveQualitySettingsSilent,
  QUALITY_SEGMENTS,
  type QualitySettings,
} from '../geometry/qualitySettings';
import type { Language } from '../geometry/engine';

const SCAD_STORAGE_KEY = 'partwright-quality-scad-v1';
const SCAD_DEFAULT: QualitySettings = { quality: 'medium', customSegments: 128 };

export function loadScadSettings(): QualitySettings {
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

/** Apply a quality preset for the current language. Writes to the
 *  language-appropriate storage key(s) and fires the quality listener so
 *  the engine re-runs at the new segment count. */
export function saveQualityForLang(next: QualitySettings): void {
  if (isScad(currentLang)) {
    saveScadSettings(next);   // persist SCAD preference
    saveQualitySettings(next); // update shared key + fire re-run
  } else {
    saveQualitySettings(next);
  }
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
