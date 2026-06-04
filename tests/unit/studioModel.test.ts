import { describe, it, expect } from 'vitest';
import {
  presetAngles,
  newStudioState,
  setPreset,
  frontView,
  anglePrompt,
  carveableViews,
  buildReconInput,
  referenceImages,
  buildModelingBrief,
  readiness,
  serializeStudio,
  deserializeStudio,
  type StudioState,
} from '../../src/recon/studioModel';

describe('presetAngles', () => {
  it('cardinal = 6 ortho views (front/sides/back + top + bottom), Front first', () => {
    const a = presetAngles('cardinal');
    expect(a.length).toBe(6);
    expect(a[0]).toMatchObject({ azimuth: 0, elevation: 0, label: 'Front' });
    expect(a.map(x => x.azimuth)).toEqual(expect.arrayContaining([0, 90, 180, 270]));
    expect(a.find(x => x.elevation >= 45)!.label).toBe('Top');
    expect(a.find(x => x.elevation <= -45)!.label).toBe('Bottom');
  });

  it('isometric = 6 angled 3/4 views, Front first', () => {
    const a = presetAngles('isometric');
    expect(a.length).toBe(6);
    expect(a[0]).toMatchObject({ azimuth: 0, elevation: 0 });
    expect(a.filter(x => x.elevation === 30).length).toBe(4); // four 3/4 corners
  });

  it('full = 13 views (12 azimuths + top), Front first', () => {
    const a = presetAngles('full');
    expect(a.length).toBe(13);
    expect(a[0]).toMatchObject({ azimuth: 0, elevation: 0 });
    expect(a.filter(x => x.elevation === 0).length).toBe(12);
    expect(a.some(x => x.elevation >= 45)).toBe(true);
  });
});

describe('newStudioState / setPreset', () => {
  it('defaults to cardinal with the Front slot as source, rest gemini', () => {
    const s = newStudioState();
    expect(s.preset).toBe('cardinal');
    const front = frontView(s)!;
    expect(front.origin).toBe('source');
    expect(front.angle).toMatchObject({ azimuth: 0, elevation: 0 });
    expect(s.views.filter(v => v.origin === 'gemini').length).toBe(s.views.length - 1);
    expect(s.views.every(v => v.status === 'empty' && v.src === null && v.include)).toBe(true);
  });

  it('switching presets preserves the source photo and overlapping angles', () => {
    const s = newStudioState('cardinal');
    const front = frontView(s)!;
    front.src = 'data:image/png;base64,SRC'; front.status = 'ready';
    const right = s.views.find(v => v.angle.azimuth === 90 && v.angle.elevation === 0)!;
    right.src = 'data:image/png;base64,RIGHT'; right.status = 'ready';

    setPreset(s, 'full');
    expect(s.preset).toBe('full');
    expect(s.views.length).toBe(13);
    // Front (source) + Right both carry over (same angles exist in 'full').
    expect(frontView(s)!.src).toBe('data:image/png;base64,SRC');
    expect(s.views.find(v => v.angle.azimuth === 90 && v.angle.elevation === 0)!.src).toBe('data:image/png;base64,RIGHT');
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
    const s = newStudioState('cardinal');
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

  it('readiness needs at least two ready views', () => {
    const s = newStudioState('cardinal');
    expect(readiness(s).canBuild).toBe(false);
    const one = s.views[0]; one.src = 'data:,x'; one.status = 'ready';
    expect(readiness(s).canBuild).toBe(false);
    const two = s.views[1]; two.src = 'data:,y'; two.status = 'ready';
    expect(readiness(s).canBuild).toBe(true);
  });
});

describe('AI handoff', () => {
  function withReadyAngles(): StudioState {
    const s = newStudioState('cardinal');
    for (const az of [0, 90, 180]) {
      const v = s.views.find(x => x.angle.azimuth === az && x.angle.elevation === 0)!;
      v.src = `data:image/png;base64,IMG${az}`;
      v.status = 'ready';
    }
    return s;
  }

  it('referenceImages returns included ready views with angle captions', () => {
    const s = withReadyAngles();
    s.views.find(v => v.angle.azimuth === 180)!.include = false;
    const refs = referenceImages(s);
    expect(refs.map(r => r.label).sort()).toEqual(['Front', 'Right']);
    expect(refs.every(r => r.src.startsWith('data:image/png'))).toBe(true);
  });

  it('buildModelingBrief lists the angles and asks the AI to pick an engine + iterate', () => {
    const brief = buildModelingBrief(withReadyAngles());
    expect(brief).toMatch(/3 reference views/);
    expect(brief).toMatch(/Front/);
    expect(brief).toMatch(/Right/);
    expect(brief).toMatch(/azimuth 90/);
    expect(brief).toMatch(/engine/i);
    expect(brief).toMatch(/renderViews?/);
  });
});

describe('serialize/deserialize', () => {
  it('round-trips state including images and carve settings', () => {
    const s = newStudioState('full');
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
    const s = newStudioState('cardinal');
    s.views[1].status = 'generating'; // in-flight when persisted
    const restored = deserializeStudio(serializeStudio(s));
    expect(restored.views[1].status).toBe('empty');
  });
});
