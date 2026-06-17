import { describe, it, expect } from 'vitest';
// @ts-expect-error — plain .mjs CLI helper, no type decls
import { checkRequireLabels } from '../../scripts/cli/gates.mjs';

const stats = (labels: { name: string; triangleCount: number }[]) => ({ labels });

describe('checkRequireLabels', () => {
  it('no-ops when the flag is absent', () => {
    expect(checkRequireLabels(stats([]), null)).toBeNull();
    expect(checkRequireLabels(stats([]), undefined)).toBeNull();
    expect(checkRequireLabels(stats([]), '')).toBeNull();
  });

  it('errors when the flag is given but lists nothing', () => {
    expect(checkRequireLabels(stats([{ name: 'eyes', triangleCount: 10 }]), ' , ')).toMatch(/comma-separated/);
  });

  it('passes when every required label has paintable triangles', () => {
    const s = stats([
      { name: 'eyes', triangleCount: 120 },
      { name: 'iris', triangleCount: 40 },
      { name: 'skin', triangleCount: 9000 },
    ]);
    expect(checkRequireLabels(s, 'eyes,iris')).toBeNull();
    expect(checkRequireLabels(s, ' eyes , iris ')).toBeNull(); // whitespace tolerant
  });

  it('fails a label that resolved to 0 triangles (buried feature)', () => {
    const s = stats([
      { name: 'eyes', triangleCount: 0 },
      { name: 'skin', triangleCount: 9000 },
    ]);
    const err = checkRequireLabels(s, 'eyes');
    expect(err).toMatch(/'eyes' resolved to 0 paintable triangles/);
    expect(err).toMatch(/labels with paintable surface: skin/);
  });

  it('fails a label that is absent entirely (never declared / lost)', () => {
    const err = checkRequireLabels(stats([{ name: 'skin', triangleCount: 9000 }]), 'pupil');
    expect(err).toMatch(/'pupil' resolved to no paintable triangles/);
  });

  it('reports every failing label at once', () => {
    const s = stats([
      { name: 'eyes', triangleCount: 0 },
      { name: 'iris', triangleCount: 50 },
      { name: 'skin', triangleCount: 9000 },
    ]);
    const err = checkRequireLabels(s, 'eyes,iris,pupil');
    expect(err).toMatch(/'eyes' resolved to 0/);
    expect(err).toMatch(/'pupil' resolved to no/);
    expect(err).not.toMatch(/'iris'/); // iris paints fine, not listed
  });

  it('tolerates missing/empty stats.labels', () => {
    expect(checkRequireLabels({}, 'eyes')).toMatch(/'eyes' resolved to no/);
    expect(checkRequireLabels(null, 'eyes')).toMatch(/'eyes' resolved to no/);
  });
});
