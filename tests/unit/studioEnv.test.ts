import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { studioPresetFor, createStudioMaterial } from '../../src/renderer/studioEnv';

describe('studioEnv', () => {
  it('gives distinct dark and light presets', () => {
    const dark = studioPresetFor('dark');
    const light = studioPresetFor('light');
    // Dark stage is darker than the light seamless studio.
    expect(dark.bgBottom).toBeLessThan(light.bgBottom);
    expect(dark.floorColor).toBeLessThan(light.floorColor);
    // Both define a tunable contact-shadow strength in range.
    for (const p of [dark, light]) {
      expect(p.shadowStrength).toBeGreaterThan(0);
      expect(p.shadowStrength).toBeLessThanOrEqual(1);
    }
  });

  it('builds a PBR material honoring the preset for the unpainted case', () => {
    const preset = studioPresetFor('dark');
    const mat = createStudioMaterial(preset, false);
    expect(mat).toBeInstanceOf(THREE.MeshStandardMaterial);
    expect(mat.vertexColors).toBe(false);
    expect(mat.color.getHex()).toBe(preset.matColor);
    expect(mat.roughness).toBe(preset.matRoughness);
    expect(mat.metalness).toBe(preset.matMetalness);
    expect(mat.side).toBe(THREE.DoubleSide);
  });

  it('uses a white base when vertex colors drive the look (painted models)', () => {
    const mat = createStudioMaterial(studioPresetFor('light'), true);
    expect(mat.vertexColors).toBe(true);
    expect(mat.color.getHex()).toBe(0xffffff);
  });
});
