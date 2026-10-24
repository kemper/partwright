// Pure line-level code diff, shared by the console API (forkVersion /
// modifyAndTest's codeDiff) and the AI diffVersions tool. Dependency-free so
// both main.ts and src/ai/tools.ts can import it without a cycle.

/** Compact line-level diff for surfacing what a fork/transform actually
 *  changed in the source — the cheapest way for an agent to confirm a
 *  patch landed (a no-op patch shows `changed: false`). LCS-based so
 *  insertions/deletions align; output is capped to keep the token cost of
 *  a large rewrite bounded. */
export function computeCodeDiff(before: string, after: string, maxLines = 60): { changed: boolean; added: number; removed: number; diff: string | null } {
  if (before === after) return { changed: false, added: 0, removed: 0, diff: null };
  const a = before.split('\n');
  const b = after.split('\n');
  const n = a.length, m = b.length;
  // The LCS table below is O(n·m). CAD scripts are small, but guard against a
  // pathologically large rewrite by falling back to a cheap multiset line
  // count (still surfaces "something changed" without allocating a huge table).
  if (n * m > 2_000_000) {
    const minus = (from: string[], against: string[]): number => {
      const counts = new Map<string, number>();
      for (const l of against) counts.set(l, (counts.get(l) ?? 0) + 1);
      let extra = 0;
      for (const l of from) {
        const c = counts.get(l) ?? 0;
        if (c > 0) counts.set(l, c - 1); else extra++;
      }
      return extra;
    };
    return { changed: true, added: minus(b, a), removed: minus(a, b), diff: '(diff too large to render line-by-line)' };
  }
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const lines: string[] = [];
  let added = 0, removed = 0, i = 0, j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { lines.push(`- ${a[i]}`); removed++; i++; }
    else { lines.push(`+ ${b[j]}`); added++; j++; }
  }
  while (i < n) { lines.push(`- ${a[i]}`); removed++; i++; }
  while (j < m) { lines.push(`+ ${b[j]}`); added++; j++; }
  const diff = lines.length > maxLines
    ? `${lines.slice(0, maxLines).join('\n')}\n… (${lines.length - maxLines} more changed lines)`
    : lines.join('\n');
  return { changed: true, added, removed, diff };
}
