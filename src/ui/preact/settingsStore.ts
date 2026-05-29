// Signal-backed view of the AI settings localStorage blob, used as the
// shared state for the Preact-rendered AI Settings modal.
//
// Vanilla TS code in the rest of the app keeps calling `loadSettings()` /
// `saveSettings()` from `src/ai/settings.ts` directly — that's the source
// of truth on disk. This module wraps a `signal` around the same data so
// Preact components auto-re-render on writes WITHIN the modal, and re-syncs
// the signal whenever the modal opens (in case vanilla code mutated
// settings while the modal was closed).

import { signal } from '@preact/signals';
import { loadSettings, saveSettings as persist } from '../../ai/settings';
import type { AiSettings } from '../../ai/settings';

export const settingsSignal = signal<AiSettings>(loadSettings());

/** Persist + propagate. Replaces direct `saveSettings()` calls inside
 *  Preact components so subscribers re-render. */
export function setSettings(next: AiSettings): void {
  persist(next);
  settingsSignal.value = next;
}

/** Pull the on-disk settings into the signal. Called when the modal
 *  opens so any vanilla-TS writes since the last open are reflected. */
export function resyncSettings(): void {
  settingsSignal.value = loadSettings();
}
