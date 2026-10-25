import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  MEDIUM_CUSTOM_TOOLS,
  SLIM_CUSTOM_TOOLS,
  compactTool,
  contextFromLlamaCppProps,
  contextWindowsFromLmStudio,
  contextWindowsFromModelList,
  contextWindowsFromOllamaPs,
  customContextWindow,
  detectContextWindows,
  firstSentence,
  parseCustomContext,
  resolveCustomPromptTier,
  serverRoot,
  toolsForCustomTier,
} from '../../src/ai/customContext';
import { ALL_TOOL_NAMES, buildToolList, type ToolDefinition } from '../../src/ai/tools';
import { loadSettings } from '../../src/ai/settings';
import { parseBackup, seedEndpoint, serializeBackup, withEndpointDefaults, newEndpoint } from '../../src/ai/endpointProfiles';
import type { CustomContextSettings } from '../../src/ai/types';

function ctx(over: Partial<CustomContextSettings> = {}, model = 'm'): { customModel: string; customContext: CustomContextSettings } {
  return { customModel: model, customContext: { window: 0, modelWindows: {}, promptTier: 'auto', ...over } };
}

describe('custom endpoint context window + tier', () => {
  it('prefers the typed window, then the detected one for the selected model', () => {
    expect(customContextWindow(ctx())).toBe(0);
    expect(customContextWindow(ctx({ modelWindows: { m: 8192, other: 4096 } }))).toBe(8192);
    expect(customContextWindow(ctx({ window: 32768, modelWindows: { m: 8192 } }))).toBe(32768);
    expect(customContextWindow(ctx({ modelWindows: { other: 4096 } }))).toBe(0);
  });

  it('Auto stays Full when the window is unknown (a bridge in front of a frontier model)', () => {
    expect(resolveCustomPromptTier(ctx())).toBe('full');
  });

  it('Auto picks Slim / Medium / Full from the window', () => {
    expect(resolveCustomPromptTier(ctx({ window: 8192 }))).toBe('slim');
    expect(resolveCustomPromptTier(ctx({ window: 32768 }))).toBe('medium');
    expect(resolveCustomPromptTier(ctx({ window: 131072 }))).toBe('medium');
    expect(resolveCustomPromptTier(ctx({ window: 200_000 }))).toBe('full');
  });

  it('an explicit tier wins over the window', () => {
    expect(resolveCustomPromptTier(ctx({ window: 8192, promptTier: 'full' }))).toBe('full');
    expect(resolveCustomPromptTier(ctx({ promptTier: 'slim' }))).toBe('slim');
  });

  it('parseCustomContext defaults junk and drops bad window entries', () => {
    expect(parseCustomContext(undefined)).toEqual({ window: 0, modelWindows: {}, promptTier: 'auto' });
    expect(parseCustomContext({ window: -5, promptTier: 'huge', modelWindows: { a: 4096.7, b: 'x', c: 0 } }))
      .toEqual({ window: 0, modelWindows: { a: 4096 }, promptTier: 'auto' });
  });
});

describe('custom tier tool lists', () => {
  const tools = buildToolList({ ...loadSettings().toggles, provider: 'custom', autoResume: true });

  it('every tier tool name is a real tool', () => {
    const all = new Set(ALL_TOOL_NAMES);
    expect(MEDIUM_CUSTOM_TOOLS.filter(n => !all.has(n))).toEqual([]);
  });

  it('Full is the gated list untouched', () => {
    expect(toolsForCustomTier(tools, 'full')).toBe(tools);
  });

  it('Medium and Slim keep their subset of the GATED list, far smaller', () => {
    const full = JSON.stringify(tools).length;
    const medium = toolsForCustomTier(tools, 'medium');
    const slim = toolsForCustomTier(tools, 'slim');
    expect(medium.every(t => MEDIUM_CUSTOM_TOOLS.includes(t.name))).toBe(true);
    expect(slim.every(t => SLIM_CUSTOM_TOOLS.includes(t.name))).toBe(true);
    expect(slim.map(t => t.name)).toContain('runAndSave');
    expect(slim.map(t => t.name)).toContain('readDoc');
    expect(JSON.stringify(medium).length).toBeLessThan(full / 5);
    expect(JSON.stringify(slim).length).toBeLessThan(JSON.stringify(medium).length);
    // Toggle gating still applies: a tool the toggles hide stays hidden.
    const noViews = buildToolList({ ...loadSettings().toggles, provider: 'custom', vision: { ...loadSettings().toggles.vision, views: false } });
    expect(toolsForCustomTier(noViews, 'slim').map(t => t.name)).not.toContain('renderView');
  });

  it('compactTool keeps types, enums and required but trims descriptions', () => {
    const t: ToolDefinition = {
      name: 'x',
      description: 'Does a thing. Then a long second sentence nobody needs.',
      input_schema: {
        type: 'object',
        properties: {
          mode: { type: 'string', enum: ['a', 'b'], description: 'Pick one. Details follow.' },
          pts: { type: 'array', items: { type: 'object', properties: { p: { type: 'number', description: 'deep' } } } },
        },
        required: ['mode'],
      },
    };
    const medium = compactTool(t, 200, 80);
    expect(medium.description).toBe('Does a thing.');
    const props = medium.input_schema.properties as Record<string, Record<string, unknown>>;
    expect(props.mode).toEqual({ type: 'string', enum: ['a', 'b'], description: 'Pick one.' });
    expect(medium.input_schema.required).toEqual(['mode']);
    const slim = compactTool(t, 200, 0);
    expect(JSON.stringify(slim.input_schema)).not.toContain('description');
    expect((slim.input_schema.properties as Record<string, Record<string, unknown>>).mode.enum).toEqual(['a', 'b']);
  });

  it('firstSentence caps long text', () => {
    expect(firstSentence('No period here at all', 8)).toBe('No peri…');
    expect(firstSentence('v1.2 is fine. Next.', 100)).toBe('v1.2 is fine.');
  });
});

describe('context window detection', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('parses each server family', () => {
    expect(contextWindowsFromModelList({ data: [{ id: 'q', max_model_len: 32768 }, { id: 'r', meta: { n_ctx_train: 131072 } }, { id: 'o', context_length: 200000 }] }))
      .toEqual({ q: 32768, o: 200000 });
    expect(contextFromLlamaCppProps({ default_generation_settings: { n_ctx: 16384 } })).toBe(16384);
    expect(contextFromLlamaCppProps({ n_ctx: 8192 })).toBe(8192);
    expect(contextWindowsFromOllamaPs({ models: [{ name: 'qwen3:8b', model: 'qwen3:8b', context_length: 4096 }] })).toEqual({ 'qwen3:8b': 4096 });
    // An unloaded model's maximum is NOT what an on-demand load runs with.
    expect(contextWindowsFromLmStudio({ data: [{ id: 'a', loaded_context_length: 8192, max_context_length: 131072 }, { id: 'b', max_context_length: 32768 }] }))
      .toEqual({ a: 8192 });
    expect(contextWindowsFromModelList({ data: [{ id: 'lm', max_context_length: 131072 }] })).toEqual({});
    expect(serverRoot('http://localhost:8080/v1/')).toBe('http://localhost:8080');
  });

  it('merges probes: llama.cpp n_ctx over advertised maxima; failures are just missing values', async () => {
    const seen: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      seen.push(url);
      expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer k');
      if (url === 'http://h:8080/v1/models') return new Response(JSON.stringify({ data: [{ id: 'gguf', max_model_len: 131072 }] }));
      if (url === 'http://h:8080/props') return new Response(JSON.stringify({ default_generation_settings: { n_ctx: 16384 } }));
      if (url === 'http://h:8080/api/ps') throw new TypeError('Failed to fetch');
      return new Response('nope', { status: 404 });
    }));
    expect(await detectContextWindows('http://h:8080/v1', 'k', ['gguf'])).toEqual({ gguf: 16384 });
    expect(seen).toContain('http://h:8080/api/v0/models');
  });
});

describe('saved endpoints carry the context profile', () => {
  it('new endpoints and pre-existing rows default to unknown + Auto', () => {
    expect(newEndpoint('openai-compatible', 'id').context).toEqual({ window: 0, modelWindows: {}, promptTier: 'auto' });
    const legacy = { ...newEndpoint('openai-compatible', 'id') } as Partial<ReturnType<typeof newEndpoint>>;
    delete legacy.context;
    expect(withEndpointDefaults(legacy as ReturnType<typeof newEndpoint>).context.promptTier).toBe('auto');
  });

  it('seeding copies the current toggles profile; backups round-trip it', () => {
    const context = { window: 8192, modelWindows: { m: 8192 }, promptTier: 'slim' as const };
    const e = { ...seedEndpoint({ baseUrl: 'http://localhost:8080/v1', apiKey: '', model: 'm', models: ['m'], reasoningEffort: false, context }, 'id'), updatedAt: 1 };
    expect(e.context).toEqual(context);
    expect(parseBackup(serializeBackup([e]))[0].context).toEqual(context);
    const raw = JSON.parse(serializeBackup([e]));
    delete raw.endpoints[0].context;
    expect(parseBackup(JSON.stringify(raw))[0].context.promptTier).toBe('auto');
  });
});
