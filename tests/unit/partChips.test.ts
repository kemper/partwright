// Label chips (#1050): seed colours become part colours, accept carries the
// visible colour, the method-switch clear, and the chip state helper.
import { describe, expect, it } from 'vitest';
import { acceptColors } from '../../src/segmentation/draft';
import { chipState, isFusedPiecesDraft, LABEL_PRESETS, labelPreset } from '../../src/segmentation/labelPresets';
import { SegmentationRunner } from '../../src/segmentation/runner';
import type { SegMesh } from '../../src/segmentation/types';

/** V-groove heightfield over [0,1]² (a crease along x = 0.5). */
function groove(N = 21): SegMesh {
  const positions = new Float32Array(N * N * 3);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const x = i / (N - 1), y = j / (N - 1);
    positions.set([x, y, 0.3 * Math.abs(x - 0.5)], (j * N + i) * 3);
  }
  const tris: number[] = [];
  for (let j = 0; j < N - 1; j++) for (let i = 0; i < N - 1; i++) {
    const a = j * N + i, b = a + 1, c = a + N, d = c + 1;
    tris.push(a, b, d, a, d, c);
  }
  return { positions, triVerts: Uint32Array.from(tris) };
}

describe('seed colours', () => {
  it('a seeded detection colours each part from its seed', () => {
    const r = new SegmentationRunner(groove());
    const s = r.detect({
      algorithm: 'crease-watershed',
      seeds: [
        { label: 'hair', point: [0.1, 0.5, 0.12], color: '#4A2E1C' },
        { label: 'face', point: [0.9, 0.5, 0.12] },
      ],
    });
    const byName = Object.fromEntries(s.parts.map((p) => [p.name, p]));
    expect(byName.hair.color).toBe('#4a2e1c');
    expect(byName.hair.displayColor).toBe('#4a2e1c');
    expect(byName.face.color).toBeNull();
    // The draft's pins never keep the colour: a later setColor is not
    // overridden by a re-run.
    expect(s.seeds.every((sd) => !('color' in sd))).toBe(true);
    r.edit([{ op: 'setColor', id: 'hair', color: '#00ff00' }]);
    const again = r.edit([{ op: 'rerun' }]);
    expect(again.parts.find((p) => p.name === 'hair')!.color).toBe('#00ff00');
  });

  it('addSeed with a colour colours its (new) part; a bad colour is rejected', () => {
    const r = new SegmentationRunner(groove());
    r.detect({ algorithm: 'crease-watershed', seeds: [{ label: 'left', point: [0.1, 0.5, 0.12] }] });
    const s = r.edit([{ op: 'addSeed', seed: { label: 'right', point: [0.9, 0.5, 0.12], color: '#e8b98f' } }]);
    expect(s.parts.find((p) => p.name === 'right')!.color).toBe('#e8b98f');
    expect(() => r.edit([{ op: 'addSeed', seed: { label: 'x', point: [0.5, 0.5, 0], color: 'skin' } }])).toThrow(/color/);
  });

  it('clear with an algorithm switches the draft method, undoably', () => {
    const r = new SegmentationRunner(groove());
    const auto = r.detect({ algorithm: 'auto-merge' });
    expect(auto.detectorId).toBe('auto-merge');
    const cleared = r.edit([{ op: 'clear', algorithm: 'crease-watershed' }]);
    expect(cleared.parts).toHaveLength(0);
    expect(cleared.detectorId).toBe('crease-watershed');
    // A pin on the empty draft grows its part over the unassigned surface.
    const pinned = r.edit([{ op: 'addSeed', seed: { label: 'hair', point: [0.1, 0.5, 0.12], color: '#4a2e1c' } }]);
    expect(pinned.parts.map((p) => [p.name, p.color])).toEqual([['hair', '#4a2e1c']]);
    r.edit([{ op: 'undo' }]);
    const back = r.edit([{ op: 'undo' }]);
    expect(back.detectorId).toBe('auto-merge');
    expect(back.parts.length).toBe(auto.parts.length);
    expect(() => r.edit([{ op: 'clear', algorithm: 'nope' }])).toThrow(/Unknown detector/);
  });
});

describe('accept colours', () => {
  const parts = [
    { color: '#112233', displayColor: '#112233' },
    { color: null, displayColor: '#A0B0C0' },
  ];
  it('saves the visible colour: explicit, else the overlay colour', () => {
    expect(acceptColors(parts)).toEqual(['#112233', '#a0b0c0']);
  });
  it('applyColors:false saves none', () => {
    expect(acceptColors(parts, false)).toEqual([null, null]);
  });
});

describe('label chips', () => {
  it('ships a figure set of ten (key 0 picks "base") and a generic part 1…9 set, all #rrggbb', () => {
    expect(labelPreset('figure').chips.map((c) => c.name)).toEqual(['hair', 'face', 'eyes', 'shirt', 'arms', 'shorts', 'socks', 'shoes', 'ball', 'base']);
    expect(labelPreset('generic').chips[8].name).toBe('part 9');
    for (const p of LABEL_PRESETS) for (const c of p.chips) expect(c.color).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('isFusedPiecesDraft: 1–2 pieces with a big largest piece is a fused figure', () => {
    expect(isFusedPiecesDraft('pieces', [{ triCount: 450000 }, { triCount: 6000 }], 2000)).toBe(true);
    expect(isFusedPiecesDraft('pieces', [{ triCount: 12 }, { triCount: 12 }], 2000)).toBe(false);
    expect(isFusedPiecesDraft('pieces', [{ triCount: 9000 }, { triCount: 9000 }, { triCount: 9000 }], 2000)).toBe(false);
    expect(isFusedPiecesDraft('auto-merge', [{ triCount: 450000 }], 2000)).toBe(false);
  });

  it('chipState: owned beats missed; a pinned chip with no (or a speck) part is missed', () => {
    const parts = [{ name: 'hair', areaFrac: 0.2 }, { name: 'eyes', areaFrac: 0.0001 }];
    expect(chipState('hair', parts, true, 0.0005)).toBe('owned');
    expect(chipState('eyes', parts, true, 0.0005)).toBe('missed');
    expect(chipState('ball', parts, true, 0.0005)).toBe('missed');
    expect(chipState('ball', parts, false, 0.0005)).toBe('idle');
  });
});
