import { describe, it, expect } from 'vitest';
import { buildPartTree, groupNames } from '../../src/ui/partTree';
import type { Part } from '../../src/storage/db';

/** Minimal Part factory — only the fields the tree logic reads matter here. */
function part(name: string, order: number, group?: string): Part {
  return { id: `id-${order}`, sessionId: 's', name, order, ...(group ? { group } : {}), created: 0, updated: 0 };
}

describe('buildPartTree', () => {
  it('keeps ungrouped parts as top-level leaves in order', () => {
    const tree = buildPartTree([part('a', 0), part('b', 1), part('c', 2)]);
    expect(tree.map(n => n.kind)).toEqual(['part', 'part', 'part']);
    expect(tree.map(n => (n.kind === 'part' ? n.part.name : ''))).toEqual(['a', 'b', 'c']);
  });

  it('collects same-group parts under one node at the first member position', () => {
    const tree = buildPartTree([
      part('frame', 0),
      part('helmet', 1, 'Armor'),
      part('chestplate', 2, 'Armor'),
      part('stand', 3),
    ]);
    expect(tree.map(n => n.kind)).toEqual(['part', 'group', 'part']);
    const group = tree[1];
    expect(group.kind).toBe('group');
    if (group.kind === 'group') {
      expect(group.name).toBe('Armor');
      expect(group.parts.map(p => p.name)).toEqual(['helmet', 'chestplate']);
    }
  });

  it('pulls non-contiguous members into a single group (never two headers)', () => {
    const tree = buildPartTree([
      part('helmet', 0, 'Armor'),
      part('frame', 1),
      part('greaves', 2, 'Armor'),
    ]);
    // One group node (placed at helmet), then the ungrouped frame trails it.
    expect(tree.map(n => n.kind)).toEqual(['group', 'part']);
    const group = tree[0];
    if (group.kind === 'group') {
      expect(group.parts.map(p => p.name)).toEqual(['helmet', 'greaves']);
    }
  });

  it('treats a blank/whitespace group as ungrouped', () => {
    const tree = buildPartTree([part('a', 0, '   '), part('b', 1, '')]);
    expect(tree.every(n => n.kind === 'part')).toBe(true);
  });

  it('handles multiple distinct groups', () => {
    const tree = buildPartTree([
      part('a', 0, 'G1'),
      part('b', 1, 'G2'),
      part('c', 2, 'G1'),
    ]);
    expect(tree.map(n => (n.kind === 'group' ? n.name : n.part.name))).toEqual(['G1', 'G2']);
    const g1 = tree[0];
    if (g1.kind === 'group') expect(g1.parts.map(p => p.name)).toEqual(['a', 'c']);
  });
});

describe('groupNames', () => {
  it('returns distinct group names in first-appearance order', () => {
    expect(groupNames([
      part('a', 0, 'Armor'),
      part('b', 1),
      part('c', 2, 'Frame'),
      part('d', 3, 'Armor'),
    ])).toEqual(['Armor', 'Frame']);
  });

  it('is empty when nothing is grouped', () => {
    expect(groupNames([part('a', 0), part('b', 1)])).toEqual([]);
  });
});
