// Gate predicate tests — the acceptance logic itself, no meshes involved.
import { describe, expect, it } from 'vitest';
// @ts-expect-error — plain .mjs module without type declarations
import { evaluateGates, compositeScore, gatesToMarkdown, GATE_THRESHOLDS } from '../../scripts/inverse-cad/gates.mjs';

function goodInputs() {
  return {
    distance: {
      chamfer: 0.03,
      hausdorff: 0.3,
      candToTarget: { p99: 0.15, excessArea_mm2: 1, missingArea_mm2: 1 },
      targetToCand: { p99: 0.12, excessArea_mm2: 1, missingArea_mm2: 1 },
    },
    voxel: { volumeIoU: 0.985, findings: [], excess_mm3: 0.5, missing_mm3: 0.4 },
    targetTopology: { genus: 1, components: 1 },
    candidateStats: { genus: 1, componentCount: 1, volume: 160, surfaceArea: 350 },
    targetStats: { volume_mm3: 159, surfaceArea_mm2: 352 },
  };
}

describe('inverse-cad/gates', () => {
  it('passes a matching candidate', () => {
    const res = evaluateGates(goodInputs());
    expect(res.pass).toBe(true);
    expect(res.failed).toEqual([]);
  });

  it('fails on topology mismatch with a named gate', () => {
    const inputs = goodInputs();
    inputs.candidateStats.genus = 0; // missing through-hole
    const res = evaluateGates(inputs);
    expect(res.pass).toBe(false);
    expect(res.failed).toContain('topology');
  });

  it('fails on a large localized finding even when chamfer is tiny', () => {
    const inputs = goodInputs();
    inputs.voxel.findings = [
      { id: 'F1', sign: 'missing', volume_mm3: 9.7, relCentroid: [0.5, 0.5, 0.5], classification: 'compact-feature' },
    ];
    const res = evaluateGates(inputs);
    expect(res.pass).toBe(false);
    expect(res.failed).toContain('worst finding');
  });

  it('fails on volume ratio drift', () => {
    const inputs = goodInputs();
    inputs.candidateStats.volume = 159 * 1.07;
    const res = evaluateGates(inputs);
    expect(res.failed).toContain('volume ratio');
  });

  it('treats chamfer as advisory only', () => {
    const inputs = goodInputs();
    inputs.distance.chamfer = 0.3; // terrible chamfer, everything else fine
    const res = evaluateGates(inputs);
    expect(res.pass).toBe(true);
    expect(res.should.find((g: { name: string }) => g.name === 'chamfer')!.pass).toBe(false);
  });

  it('threshold overrides apply', () => {
    const res = evaluateGates(goodInputs(), { ...GATE_THRESHOLDS, volumeIoU: 0.999 });
    expect(res.failed).toContain('volume IoU');
  });

  it('compositeScore orders better candidates lower', () => {
    const good = compositeScore(goodInputs());
    const bad = compositeScore({
      ...goodInputs(),
      distance: { ...goodInputs().distance, chamfer: 0.4, candToTarget: { p99: 1.5 }, targetToCand: { p99: 1.2 } },
      voxel: { volumeIoU: 0.8, findings: [{ volume_mm3: 20 }] },
    });
    expect(good).toBeLessThan(bad);
  });

  it('renders a markdown table with MUST failures called out', () => {
    const inputs = goodInputs();
    inputs.candidateStats.genus = 0;
    const md = gatesToMarkdown(evaluateGates(inputs));
    expect(md).toContain('| topology (MUST) |');
    expect(md).toContain('**FAIL**');
  });
});
