// Turn-0 context budget for the in-app AI (#1175). Before any user text, a
// hosted request carries the system prompt (preamble + ai.md), the per-turn
// suffix and the tool schemas. That grew back to ~110K tokens after the May
// split (#355) because nothing measured it, so these ceilings fail the unit
// tier when it grows. Ratchet them DOWN as each phase lands — never raise one
// to make a feature fit; move the new text into a subdoc or the new tool into
// a group (src/ai/toolGroups.ts) instead.
//
// `npm run ai:budget` prints the per-piece / per-group / heaviest-tool report.

import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { buildToolList, type ToolDefinition } from '../../src/ai/tools';
import { buildSystemPrompt, toggleSuffix } from '../../src/ai/systemPrompt';
import { toolsForRequest, turnToolList } from '../../src/ai/chatLoop';
import { CORE_TOOLS, TOOL_GROUPS } from '../../src/ai/toolGroups';
import { applyPreset, loadSettings } from '../../src/ai/settings';
import type { ChatToggles } from '../../src/ai/types';

/** Ceilings in characters (≈ 3.7 chars per token). */
const BUDGET = {
  /** Preamble + ai.md. Phase 1 (the in-app core prompt) lowers this. */
  systemPrompt: 168_000,
  /** Tool schemas sent on the first request, default (Standard) toggles. */
  turn0Tools: 70_000,
  /** Every tool schema (on-demand groups switched off), all toggles on. */
  allTools: 260_000,
  /** One tool's schema. Long guidance belongs in its readDoc topic. */
  perTool: 6_000,
};

/** Tools already over BUDGET.perTool. Shrink them (Phase 3) and delete the
 *  entry; don't add to this list. */
const PER_TOOL_ALLOWLIST = new Set(['buildCharacter', 'detectParts', 'comparePartDetectors']);

const CHARS_PER_TOKEN = 3.7;
const tok = (chars: number) => Math.round(chars / CHARS_PER_TOKEN);
const size = (tools: ToolDefinition[]) => JSON.stringify(tools).length;

const aiMd = readFileSync(new URL('../../public/ai.md', import.meta.url), 'utf8');
const standard: ChatToggles = loadSettings().toggles;
const allOn: ChatToggles = applyPreset(loadSettings(), 'full').toggles;

function turn0(t: ChatToggles) {
  const gated = turnToolList(t, []);
  const { tools, suffixLine } = toolsForRequest(t, gated, []);
  const system = buildSystemPrompt(aiMd).length;
  const suffix = toggleSuffix(t).length + suffixLine.length;
  return { gated, tools, system, suffix, toolChars: size(tools), total: system + suffix + size(tools) };
}

describe('AI turn-0 context budget', () => {
  const s = turn0(standard);

  test('system prompt stays under budget', () => {
    expect(s.system, `preamble + ai.md is ${s.system} chars (~${tok(s.system)} tokens); move detail into a readDoc subdoc`).toBeLessThanOrEqual(BUDGET.systemPrompt);
  });

  test('first-request tool schemas stay under budget', () => {
    expect(s.toolChars, `turn-0 tools are ${s.toolChars} chars (~${tok(s.toolChars)} tokens); put new tools in a TOOL_GROUPS entry, not CORE_TOOLS`).toBeLessThanOrEqual(BUDGET.turn0Tools);
  });

  test('the full tool list stays under budget', () => {
    const all = size(buildToolList(allOn, []));
    expect(all, `all tool schemas are ${all} chars (~${tok(all)} tokens)`).toBeLessThanOrEqual(BUDGET.allTools);
  });

  test('no single tool schema is oversized', () => {
    const over = buildToolList(allOn, [])
      .map(t => ({ name: t.name, chars: JSON.stringify(t).length }))
      .filter(t => t.chars > BUDGET.perTool && !PER_TOOL_ALLOWLIST.has(t.name));
    expect(over, 'shorten these descriptions; move examples into the matching subdoc').toEqual([]);
  });

  test('report', () => {
    if (!process.env.AI_BUDGET_REPORT) return;
    const all = buildToolList(allOn, []);
    const byName = new Map(all.map(t => [t.name, JSON.stringify(t).length]));
    const sum = (names: readonly string[]) => names.reduce((n, x) => n + (byName.get(x) ?? 0), 0);
    const lines = [
      '',
      'AI turn-0 context (Standard preset, Anthropic, chars ÷ 3.7 ≈ tokens)',
      `  system prompt (preamble + ai.md)  ${s.system.toLocaleString().padStart(9)} chars  ~${tok(s.system).toLocaleString()} tok   (budget ${BUDGET.systemPrompt.toLocaleString()})`,
      `  per-turn suffix                   ${s.suffix.toLocaleString().padStart(9)} chars  ~${tok(s.suffix).toLocaleString()} tok`,
      `  tool schemas sent (${String(s.tools.length).padStart(3)} tools)     ${s.toolChars.toLocaleString().padStart(9)} chars  ~${tok(s.toolChars).toLocaleString()} tok   (budget ${BUDGET.turn0Tools.toLocaleString()})`,
      `  TOTAL                             ${s.total.toLocaleString().padStart(9)} chars  ~${tok(s.total).toLocaleString()} tok`,
      '',
      `All tools, every toggle on: ${all.length} tools, ${size(all).toLocaleString()} chars (~${tok(size(all)).toLocaleString()} tok)`,
      '',
      'By group (all toggles on):',
      `  ${'core'.padEnd(12)} ${String(CORE_TOOLS.length).padStart(3)} tools  ~${tok(sum(CORE_TOOLS)).toLocaleString()} tok`,
      ...TOOL_GROUPS.map(g => `  ${g.id.padEnd(12)} ${String(g.tools.length).padStart(3)} tools  ~${tok(sum(g.tools)).toLocaleString()} tok`),
      '',
      'Heaviest tool schemas:',
      ...[...byName].sort((a, b) => b[1] - a[1]).slice(0, 15).map(([n, c]) => `  ${n.padEnd(24)} ${c.toLocaleString().padStart(7)} chars`),
      '',
      'ai.md sections over 3K chars:',
      ...sections(aiMd).filter(x => x.chars > 3000).sort((a, b) => b.chars - a.chars).map(x => `  ${x.chars.toLocaleString().padStart(7)}  ${x.heading}`),
      '',
    ];
    console.log(lines.join('\n'));
  });
});

function sections(md: string): Array<{ heading: string; chars: number }> {
  const out: Array<{ heading: string; chars: number }> = [];
  let cur = { heading: '(preamble)', chars: 0 };
  for (const line of md.split('\n')) {
    if (/^## /.test(line)) { out.push(cur); cur = { heading: line, chars: 0 }; }
    cur.chars += line.length + 1;
  }
  out.push(cur);
  return out;
}
