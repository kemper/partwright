// Registry of captured hair presets for `F.hair(rig, { style: 'captured', preset })`.
// Add a preset: run `node scripts/capture-hair.mjs <mesh> --out
// src/geometry/hairCapture/presets/<name>.ts`, then list it here.
import type { HairCapturePreset } from '../field';
import { tsubasa } from './tsubasa';

export const HAIR_PRESETS: Readonly<Record<string, HairCapturePreset>> = { tsubasa };
