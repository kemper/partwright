import * as THREE from 'three';
import type { Theme } from '../ui/theme';

// "Studio space" rendering for the interactive viewport: instead of a flat color
// void, the model sits in a graded backdrop with image-based PBR lighting, a
// floor, and a contact shadow that grounds it in the space. Driven by the
// light/dark theme — dark is a spotlit "stage", light is a soft seamless studio.

// Note: the light-rig *intensities* stay user-tunable in appConfig.renderer
// (ambient/primary/secondary) and are read by the viewport — they are not in
// this preset. The preset owns only the look-defining, theme-dependent bits.
export interface StudioPreset {
  /** Vertical background gradient (top → bottom). */
  bgTop: number;
  bgBottom: number;
  /** Floor plane base color. */
  floorColor: number;
  /** Image-based-lighting (RoomEnvironment) contribution. */
  envIntensity: number;
  /** ACES tone-mapping exposure. */
  exposure: number;
  /** Contact-shadow darkness (ShadowMaterial opacity, 0..1). */
  shadowStrength: number;
  /** Default (unpainted) model material. */
  matColor: number;
  matRoughness: number;
  matMetalness: number;
}

const STUDIO_PRESETS: Record<Theme, StudioPreset> = {
  // Dark studio stage — a graded charcoal "spotlit stage" with rim highlights
  // from the environment and a strong contact shadow. The default look.
  dark: {
    bgTop: 0x2b2f36,
    bgBottom: 0x14161a,
    floorColor: 0x14161a,
    envIntensity: 0.7,
    exposure: 1.05,
    shadowStrength: 0.55,
    matColor: 0xb8c0cc,
    matRoughness: 0.45,
    matMetalness: 0.1,
  },
  // Light soft studio — near-white seamless paper, neutral matte object, soft
  // grounding shadow. The "product photo on seamless paper" look.
  light: {
    bgTop: 0xf6f4f0,
    bgBottom: 0xe4ded4,
    floorColor: 0xe9e3da,
    envIntensity: 1.0,
    exposure: 1.0,
    shadowStrength: 0.28,
    matColor: 0x9aa3ad,
    matRoughness: 0.6,
    matMetalness: 0.0,
  },
};

export function studioPresetFor(theme: Theme): StudioPreset {
  return STUDIO_PRESETS[theme];
}

/** Vertical gradient background as a small CanvasTexture. */
export function makeGradientTexture(topHex: number, bottomHex: number): THREE.Texture {
  const canvas = document.createElement('canvas');
  canvas.width = 2;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;
  const grad = ctx.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, '#' + topHex.toString(16).padStart(6, '0'));
  grad.addColorStop(1, '#' + bottomHex.toString(16).padStart(6, '0'));
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 2, 256);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

/** Default (unpainted / vertex-colored) model material for a studio preset. */
export function createStudioMaterial(preset: StudioPreset, vertexColors: boolean): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: vertexColors ? 0xffffff : preset.matColor,
    roughness: preset.matRoughness,
    metalness: preset.matMetalness,
    side: THREE.DoubleSide,
    vertexColors,
  });
}
