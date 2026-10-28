// On-demand tool groups (src/ai/toolGroups.ts, #1175): hosted models start
// with CORE_TOOLS and load the rest in groups. The classification test is the
// guard that matters most: a new tool must be placed in core or exactly one
// group, so it can never silently go missing from (or bloat) the request.

import { describe, expect, test } from 'vitest';
import { ALL_TOOL_NAMES, SUBDOC_NAMES_LIST, buildToolList } from '../../src/ai/tools';
import {
  CORE_TOOLS,
  DOC_TOOL_GROUPS,
  LOAD_TOOLS_TOOL,
  TOOL_GROUPS,
  TOOL_GROUP_IDS,
  loadToolsDefinition,
  loadToolsResult,
  loadedToolGroups,
  selectOfferedTools,
  toolGroupOf,
  toolGroupsSuffix,
} from '../../src/ai/toolGroups';
import { toolsForRequest } from '../../src/ai/chatLoop';
import { loadSettings, setToggles } from '../../src/ai/settings';
import type { ChatMessage, ChatToggles } from '../../src/ai/types';

const ALL_ON = { runCode: true, saveVersions: true, paintFaces: true, sessionNotes: true };

function toggles(partial: Parameters<typeof setToggles>[1] = {}): ChatToggles {
  return setToggles(loadSettings(), partial).toggles;
}

let seq = 0;
function call(name: string, input: Record<string, unknown> = {}): ChatMessage {
  seq++;
  return {
    id: `m${seq}`, sessionId: 's', role: 'assistant', blocks: [], createdAt: 0, seq,
    toolCalls: [{ id: `t${seq}`, name, input }],
  };
}

describe('tool group classification', () => {
  test('every tool is in core or exactly one group', () => {
    const placed = new Map<string, string[]>();
    for (const n of CORE_TOOLS) placed.set(n, [...(placed.get(n) ?? []), 'core']);
    for (const g of TOOL_GROUPS) for (const n of g.tools) placed.set(n, [...(placed.get(n) ?? []), g.id]);
    const unplaced = ALL_TOOL_NAMES.filter(n => !placed.has(n));
    const doubled = [...placed].filter(([, where]) => where.length > 1);
    expect(unplaced, 'add new tools to CORE_TOOLS or a TOOL_GROUPS entry in src/ai/toolGroups.ts').toEqual([]);
    expect(doubled).toEqual([]);
  });

  test('core and groups only name real tools', () => {
    const real = new Set(ALL_TOOL_NAMES);
    const named = [...CORE_TOOLS, ...TOOL_GROUPS.flatMap(g => g.tools)];
    expect(named.filter(n => !real.has(n))).toEqual([]);
    expect(real.has(LOAD_TOOLS_TOOL)).toBe(false);
  });

  test('doc → group map uses real subdocs and groups', () => {
    const docs = new Set<string>(SUBDOC_NAMES_LIST);
    for (const [doc, groups] of Object.entries(DOC_TOOL_GROUPS)) {
      expect(docs.has(doc), doc).toBe(true);
      for (const g of groups) expect(TOOL_GROUP_IDS).toContain(g);
    }
  });

  test('loadTools schema enumerates every group and lists their tools', () => {
    const def = loadToolsDefinition();
    const items = (def.input_schema.properties.groups as { items: { enum: string[] } }).items;
    expect(items.enum).toEqual([...TOOL_GROUP_IDS]);
    for (const g of TOOL_GROUPS) for (const n of g.tools) expect(def.description).toContain(n);
  });
});

describe('loadedToolGroups', () => {
  test('starts empty', () => {
    expect([...loadedToolGroups([])]).toEqual([]);
  });

  test('loadTools, readDoc topics and grouped tool calls all load', () => {
    const history = [
      call(LOAD_TOOLS_TOOL, { groups: ['transforms', 'bogus'] }),
      call('readDoc', { name: 'colors' }),
      call('readDoc', { name: 'sdf' }),
      call('detectParts', {}),
      call('runAndSave', { code: 'return x' }),
    ];
    expect([...loadedToolGroups(history)].sort()).toEqual(['inspect', 'paint', 'parts', 'transforms']);
  });

  test('a refused call or an errored loadTools loads nothing', () => {
    const answered = (m: ChatMessage, content: string, isError: boolean): ChatMessage[] => [
      m,
      { id: `r${m.seq}`, sessionId: 's', role: 'user', blocks: [], createdAt: 0, seq: m.seq + 1, toolResults: [{ toolUseId: m.toolCalls![0].id, content, isError }] },
    ];
    const history = [
      ...answered(call('paintInBox', {}), '[Not run — paintInBox is not available while planning.]', true),
      ...answered(call(LOAD_TOOLS_TOOL, { groups: ['parts'] }), '{"error":"x"}', true),
      // A real failure of a grouped tool still shows the model wants it.
      ...answered(call('scaleModel', {}), '{"error":"factor must be positive"}', true),
    ];
    expect([...loadedToolGroups(history)]).toEqual(['transforms']);
  });

  test('legacy alias names load the group of the tool they stand for', () => {
    expect([...loadedToolGroups([call('renamePart', { name: 'x' })])]).toEqual(['objects']);
  });

  test('printing doc loads the transforms it teaches', () => {
    expect([...loadedToolGroups([call('readDoc', { name: 'printing' })])].sort()).toEqual(['printing', 'transforms']);
  });

  test('preload adds groups and ignores unknown ids', () => {
    expect([...loadedToolGroups([], ['import', 'nope'])]).toEqual(['import']);
  });
});

describe('selectOfferedTools', () => {
  const all = buildToolList(toggles({ scope: ALL_ON }));
  const load = loadToolsDefinition();

  test('nothing loaded → core + loadTools only', () => {
    const out = selectOfferedTools(all, new Set(), load).map(t => t.name);
    const core = new Set([...CORE_TOOLS, LOAD_TOOLS_TOOL]);
    expect(out.every(n => core.has(n))).toBe(true);
    expect(out).toContain('runAndSave');
    expect(out).not.toContain('paintInBox');
  });

  test('a loaded group is appended after the unchanged core prefix', () => {
    const base = selectOfferedTools(all, new Set(), load).map(t => t.name);
    const withPaint = selectOfferedTools(all, new Set(['paint']), load).map(t => t.name);
    expect(withPaint.slice(0, base.length)).toEqual(base);
    expect(withPaint).toContain('paintInBox');
    expect(withPaint.every(n => toolGroupOf(n) === undefined || toolGroupOf(n) === 'paint')).toBe(true);
  });

  test('never adds a tool the gates switched off', () => {
    const noPaint = buildToolList(toggles({ scope: { ...ALL_ON, paintFaces: false } }));
    const out = selectOfferedTools(noPaint, new Set(['paint']), load).map(t => t.name);
    expect(out).not.toContain('paintInBox');
    expect(out).not.toContain('paintByLabel');
  });
});

describe('loadToolsResult', () => {
  const gated = new Set(buildToolList(toggles({ scope: { ...ALL_ON, paintFaces: false } })).map(t => t.name));

  test('lists the loaded tools the gates allow', () => {
    const r = loadToolsResult({ groups: ['transforms'] }, gated);
    expect(r.isError).toBe(false);
    expect(JSON.parse(r.content).loaded.transforms).toContain('scaleModel');
  });

  test('a switched-off group comes back unavailable', () => {
    // Every transforms tool is save-gated.
    const noSave = new Set(buildToolList(toggles({ scope: { ...ALL_ON, runCode: false, saveVersions: false } })).map(t => t.name));
    const r = JSON.parse(loadToolsResult({ groups: ['transforms'] }, noSave).content);
    expect(r.loaded).toEqual({});
    expect(r.unavailable).toMatch(/transforms/);
  });

  test('rejects missing or all-unknown groups', () => {
    expect(loadToolsResult({}, gated).isError).toBe(true);
    expect(loadToolsResult({ groups: ['nope'] }, gated).content).toMatch(/unknown group/);
  });

  test('unknown ids beside valid ones are reported, not fatal', () => {
    const r = loadToolsResult({ groups: ['transforms', 'nope'] }, gated);
    expect(r.isError).toBe(false);
    const body = JSON.parse(r.content);
    expect(body.loaded.transforms).toContain('scaleModel');
    expect(body.ignored).toMatch(/nope/);
  });

  test('the doc → group list in the description comes from the map', () => {
    for (const doc of Object.keys(DOC_TOOL_GROUPS)) expect(loadToolsDefinition().description).toContain(`${doc} →`);
  });
});

describe('toolGroupsSuffix', () => {
  const gated = new Set(ALL_TOOL_NAMES);
  test('names loaded and pending groups', () => {
    const line = toolGroupsSuffix(new Set(['paint']), gated);
    expect(line).toContain('loaded: core, paint');
    expect(line).toContain('transforms');
  });
  test('empty once every available group is loaded', () => {
    expect(toolGroupsSuffix(new Set(TOOL_GROUP_IDS), gated)).toBe('');
  });
});

describe('toolsForRequest', () => {
  test('hosted providers get core + loaded groups and a suffix line', () => {
    const t = toggles({ scope: ALL_ON });
    const gated = buildToolList(t);
    const first = toolsForRequest(t, gated, []);
    expect(first.tools.length).toBeLessThan(gated.length / 2);
    expect(first.tools.map(x => x.name)).toContain(LOAD_TOOLS_TOOL);
    expect(first.suffixLine).toContain('Not loaded yet');
    const later = toolsForRequest(t, gated, [call(LOAD_TOOLS_TOOL, { groups: ['paint'] })]);
    expect(later.tools.map(x => x.name)).toContain('paintInBox');
  });

  test('plan mode and local keep their own lists', () => {
    const plan = toggles({ planFirst: true });
    expect(toolsForRequest(plan, buildToolList(plan), []).tools.map(x => x.name)).not.toContain(LOAD_TOOLS_TOOL);
    const local = toggles({ provider: 'local' });
    const gated = buildToolList(local);
    expect(toolsForRequest(local, gated, []).tools).toEqual(gated);
  });
});
