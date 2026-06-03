import { describe, it, expect } from 'vitest';
import {
  turntableAngles,
  newStudioState,
  frontView,
  anglePrompt,
  carveableViews,
  buildReconInput,
  readiness,
  serializeStudio,
  deserializeStudio,
  type StudioState,
} from '../../src/recon/studioModel';

describe('turntableAngles', () => {
  it('spaces azimuths evenly and adds a top cap', () => {
    const a = turntableAngles('quick8');
    expect(a.length).toBe(9); // 8 azimuths + top
    const horizon = a.filter(x => x.elevation === 0);
    expect(horizon.map(x => x.azimuth)).toEqual([0, 45, 90, 135, 180, 225, 270, 315]);
    expect(a.some(x => x.elevation >= 45)).toBe(true); // a top view exists
  });

  it('labels cardinal azimuths and the top view', () => {
    const a = turntableAngles('standard12');
    expect(a.find(x => x.azimuth === 0 && x.elevation === 0)!.label).toBe('Front');
    expect(a.find(x => x.azimuth === 90)!.label).toBe('Right');
    expect(a.find(x => x.elevation >= 45)!.label).toBe('Top');
  });

  it('detailed16 has more views than standard12 than quick8', () => {
    expect(turntableAngles('detailed16').length).toBeGreaterThan(turntableAngles('standard12').length);
    expect(turntableAngles('standard12').length).toBeGreaterThan(turntableAngles('quick8').length);
  });
});

describe('newStudioState', () => {
  it('makes the first view the source (Front) slot, rest gemini', () => {
    const s = newStudioState('quick8');
    const front = frontView(s)!;
    expect(front.origin).toBe('source');
    expect(front.angle.azimuth).toBe(0);
    expect(front.angle.elevation).toBe(0);
    expect(s.views.filter(v => v.origin === 'gemini').length).toBe(s.views.length - 1);
    expect(s.views.every(v => v.status === 'empty' && v.src === null && v.include)).toBe(true);
  });
});

describe('anglePrompt', () => {
  it('describes the right viewpoint and stresses identity + plain background', () => {
    expect(anglePrompt({ azimuth: 90, elevation: 0, label: 'Right' })).toMatch(/right side/i);
    expect(anglePrompt({ azimuth: 180, elevation: 0, label: 'Back' })).toMatch(/behind/i);
    expect(anglePrompt({ azimuth: 0, elevation: 75, label: 'Top' })).toMatch(/top-down|above/i);
    const p = anglePrompt({ azimuth: 0, elevation: 0, label: 'Front' });
    expect(p).toMatch(/same subject/i);
    expect(p).toMatch(/background/i);
  });
});

describe('carve input', () => {
  function withReadyViews(): StudioState {
    const s = newStudioState('quick8');
    // Mark the front + two sides ready with fake images.
    for (const az of [0, 90, 270]) {
      const v = s.views.find(x => x.angle.azimuth === az && x.angle.elevation === 0)!;
      v.src = `data:image/png;base64,AAAA-${az}`;
      v.status = 'ready';
    }
    return s;
  }

  it('only carves included, ready views and passes carve options through', () => {
    const s = withReadyViews();
    // Exclude one ready view.
    s.views.find(v => v.angle.azimuth === 270)!.include = false;
    s.carve.resolution = 64;
    const input = buildReconInput(s);
    expect(input.views.map(v => v.azimuth).sort((a, b) => a - b)).toEqual([0, 90]);
    expect(input.options.resolution).toBe(64);
    expect(carveableViews(s).length).toBe(2);
  });

  it('readiness needs at least two carveable views', () => {
    const s = newStudioState('quick8');
    expect(readiness(s).canCarve).toBe(false);
    const one = s.views[0]; one.src = 'data:,x'; one.status = 'ready';
    expect(readiness(s).canCarve).toBe(false);
    const two = s.views[1]; two.src = 'data:,y'; two.status = 'ready';
    expect(readiness(s).canCarve).toBe(true);
  });
});

describe('serialize/deserialize', () => {
  it('round-trips state including images and carve settings', () => {
    const s = newStudioState('standard12');
    s.model = 'gemini-3-flash-image';
    s.sourceMediaType = 'image/jpeg';
    s.carve.smooth = 4;
    const front = frontView(s)!;
    front.src = 'data:image/jpeg;base64,SOURCE';
    front.status = 'ready';
    front.origin = 'source';
    const back = s.views.find(v => v.angle.azimuth === 180)!;
    back.src = 'data:image/png;base64,BACK';
    back.status = 'ready';

    const rec = serializeStudio(s);
    expect(rec.v).toBe(1);
    const restored = deserializeStudio(rec);
    expect(restored.model).toBe('gemini-3-flash-image');
    expect(restored.sourceMediaType).toBe('image/jpeg');
    expect(restored.carve.smooth).toBe(4);
    expect(frontView(restored)!.src).toBe('data:image/jpeg;base64,SOURCE');
    expect(restored.views.find(v => v.angle.azimuth === 180)!.src).toBe('data:image/png;base64,BACK');
    // Same number of views and the carve input matches.
    expect(buildReconInput(restored).views.length).toBe(buildReconInput(s).views.length);
  });

  it('demotes an interrupted "generating" view on reload', () => {
    const s = newStudioState('quick8');
    s.views[1].status = 'generating'; // in-flight when persisted
    const restored = deserializeStudio(serializeStudio(s));
    expect(restored.views[1].status).toBe('empty');
  });
});
