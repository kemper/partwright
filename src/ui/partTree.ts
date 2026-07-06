// Pure grouping logic for the part list's threaded view. Kept DOM-free (and
// dependency-free beyond the `Part` type) so it can be unit-tested in the fast
// vitest tier — the rendering in `partList.ts` consumes what this produces.

import type { Part } from '../storage/db';

export interface PartGroupNode {
  kind: 'group';
  /** The group's display name (the shared `Part.group`). */
  name: string;
  /** Members, in the order they appeared in the input (i.e. by part `order`). */
  parts: Part[];
}

export interface PartLeafNode {
  kind: 'part';
  part: Part;
}

export type PartTreeNode = PartGroupNode | PartLeafNode;

/**
 * Fold a flat, order-sorted part list into a threaded tree: ungrouped parts stay
 * as top-level leaves at their own position, while parts sharing a `group` are
 * collected under a single group node placed at the position of the group's
 * FIRST member. Non-contiguous members of the same group are pulled together
 * under that one node (so a group is never split into two headers). Input order
 * is assumed to already be ascending by `Part.order`.
 */
export function buildPartTree(parts: Part[]): PartTreeNode[] {
  const result: PartTreeNode[] = [];
  const groups = new Map<string, PartGroupNode>();
  for (const part of parts) {
    const g = part.group?.trim();
    if (!g) {
      result.push({ kind: 'part', part });
      continue;
    }
    let node = groups.get(g);
    if (!node) {
      node = { kind: 'group', name: g, parts: [] };
      groups.set(g, node);
      result.push(node);
    }
    node.parts.push(part);
  }
  return result;
}

/** The distinct group names present in a part list, in first-appearance order. */
export function groupNames(parts: Part[]): string[] {
  const seen: string[] = [];
  const set = new Set<string>();
  for (const p of parts) {
    const g = p.group?.trim();
    if (g && !set.has(g)) { set.add(g); seen.push(g); }
  }
  return seen;
}
