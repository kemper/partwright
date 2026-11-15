// Pure ranking + grouping for the command palette (src/ui/commandPalette.ts).
// Dependency-free so the unit tier can test it without a DOM.
//
// Matching is forgiving on purpose: people search by what they want ("textr",
// "scal", "colour"), not by our exact labels. Every whitespace-separated token
// must match *something* in the command (title, keywords, category, description)
// — by exact word, word prefix, substring, in-order letters, or a one/two-letter
// typo — and the per-token scores add up. Title hits outrank keyword hits, which
// outrank category/description hits, so "export stl" still puts "Export STL"
// first.

export interface SearchableCommand {
  id: string;
  title: string;
  hint?: string;
  keywords?: string;
  description?: string;
}

/** Field weights: a hit in the title counts most. */
const FIELD_WEIGHTS = { title: 3, keywords: 2, hint: 1.5, description: 1 } as const;

/** Match-kind scores before the field weight is applied. */
const KIND_SCORE = { exact: 10, prefix: 8, substring: 5, typo: 4, subsequence: 2 } as const;

function words(text: string): string[] {
  return text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}

/** Edit distance counting an adjacent swap as one edit (optimal string
 *  alignment), bailing out once it exceeds `max`. */
function editDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev2: number[] = [];
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let d = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d = Math.min(d, prev2[j - 2] + 1);
      cur[j] = d;
      if (d < rowMin) rowMin = d;
    }
    if (rowMin > max) return max + 1;
    prev2 = prev;
    prev = cur;
  }
  return prev[b.length];
}

/** True when every char of `needle` appears in `hay` in order, within a window
 *  no longer than twice the needle (so "srfc" hits "surface" but scattered
 *  letters across a long sentence don't). */
function compactSubsequence(needle: string, hay: string): boolean {
  if (needle.length < 3) return false;
  for (let start = hay.indexOf(needle[0]); start !== -1; start = hay.indexOf(needle[0], start + 1)) {
    let j = 1;
    let k = start + 1;
    const limit = start + needle.length * 2;
    while (j < needle.length && k < hay.length && k < limit) {
      if (hay[k] === needle[j]) j++;
      k++;
    }
    if (j === needle.length) return true;
  }
  return false;
}

/** Best score of one lowercase token against one field's text (0 = no match). */
function scoreTokenInField(token: string, text: string): number {
  if (!text) return 0;
  const lower = text.toLowerCase();
  const ws = words(lower);
  if (ws.includes(token)) return KIND_SCORE.exact;
  if (ws.some(w => w.startsWith(token))) return KIND_SCORE.prefix;
  if (lower.includes(token)) return KIND_SCORE.substring;
  if (token.length >= 4) {
    const maxTypos = token.length >= 7 ? 2 : 1;
    // Compare against the word and against a same-length prefix of it, so a
    // typo in a partial word ("textr" → "textures") still counts. A full word
    // shorter than the query ranks a little lower: "textr" is more likely the
    // start of "textures" than a typo of "text".
    let typo = 0;
    for (const w of ws) {
      if (w.length > token.length && editDistance(token, w.slice(0, token.length), maxTypos) <= maxTypos) typo = Math.max(typo, KIND_SCORE.typo);
      else if (editDistance(token, w, maxTypos) <= maxTypos) typo = Math.max(typo, w.length < token.length ? KIND_SCORE.typo - 1 : KIND_SCORE.typo);
    }
    if (typo) return typo;
  }
  if (ws.some(w => compactSubsequence(token, w))) return KIND_SCORE.subsequence;
  return 0;
}

/**
 * Score a command against a query. Returns 0 when any token fails to match;
 * otherwise a positive score (higher = better). An empty query scores 1 for
 * every command.
 */
export function scoreCommand(cmd: SearchableCommand, query: string): number {
  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return 1;
  let total = 0;
  for (const tok of tokens) {
    let best = 0;
    for (const field of ['title', 'keywords', 'hint', 'description'] as const) {
      const s = scoreTokenInField(tok, cmd[field] ?? '') * FIELD_WEIGHTS[field];
      if (s > best) best = s;
    }
    if (best === 0) return 0;
    total += best;
  }
  // Small bonus when the whole query is a prefix of the title ("export s").
  if (cmd.title.toLowerCase().startsWith(query.trim().toLowerCase())) total += 5;
  return total;
}

/** Commands matching `query`, best first; ties keep registration order. */
export function rankCommands<T extends SearchableCommand>(cmds: T[], query: string): T[] {
  return cmds
    .map((cmd, i) => ({ cmd, i, score: scoreCommand(cmd, query) }))
    .filter(r => r.score > 0)
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .map(r => r.cmd);
}

/** Category display order for the browse view; unknown categories follow
 *  alphabetically, then uncategorised commands under "Other". */
const CATEGORY_ORDER = ['Tools', 'Inspect', 'Create', 'Editor', 'Session', 'View', 'Tab', 'Export', 'Share', 'Navigate', 'Settings', 'Help'];

export interface CommandSection<T> {
  /** Section heading, e.g. "Recent" or a category name. */
  label: string;
  items: T[];
}

/**
 * Browse view for an empty query: recently used commands first (most recent
 * first, only those currently available), then every command grouped by
 * category. A recent command also stays listed under its category.
 */
export function groupForBrowse<T extends SearchableCommand>(cmds: T[], recentIds: string[]): CommandSection<T>[] {
  const sections: CommandSection<T>[] = [];
  const byId = new Map(cmds.map(c => [c.id, c]));
  const recent = recentIds.map(id => byId.get(id)).filter((c): c is T => !!c);
  if (recent.length) sections.push({ label: 'Recent', items: recent });

  const groups = new Map<string, T[]>();
  for (const c of cmds) {
    const key = c.hint || 'Other';
    const list = groups.get(key);
    if (list) list.push(c); else groups.set(key, [c]);
  }
  const rank = (k: string) => {
    if (k === 'Other') return CATEGORY_ORDER.length + 1;
    const i = CATEGORY_ORDER.indexOf(k);
    return i === -1 ? CATEGORY_ORDER.length : i;
  };
  const keys = [...groups.keys()].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
  for (const k of keys) sections.push({ label: k, items: groups.get(k)! });
  return sections;
}

/** Push `id` to the front of a recent-ids list, de-duplicated and capped. */
export function pushRecent(recentIds: string[], id: string, max: number): string[] {
  return [id, ...recentIds.filter(r => r !== id)].slice(0, Math.max(0, max));
}
