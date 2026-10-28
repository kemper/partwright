// AI Settings → Custom (OpenAI) tab: a list of saved endpoints plus a
// top-to-bottom editor for the selected one.
//
// Each saved endpoint (src/ai/endpointProfiles.ts) remembers its name, base
// URL, API key, default model, last model list and reasoning opt-in, so once
// a connection works nobody has to paste a key again — switching endpoints is
// one click, and the list survives settings resets and session switches
// (IndexedDB, persistent storage, optional backup file).
//
// Two editor layouts share one component:
//   - CLIProxyAPI: the bridge's setup IS the form — install, the endpoint's
//     own API key (generated once and kept; editable; appended to the bridge
//     config, never replacing other keys), log in, connect, pick a model.
//   - Any other OpenAI-compatible endpoint (remote CLIProxyAPI, vLLM,
//     llama.cpp, LM Studio, a hosted gateway): URL, optional key, connect,
//     model.
//
// The selected endpoint is copied onto the Custom provider's toggles (what
// the chat Worker reads) when the user clicks "Use", saves/activates from the
// footer, or edits the endpoint already in use.

import { useEffect, useMemo, useRef } from 'preact/hooks';
import { signal, useSignal } from '@preact/signals';
import type { ComponentChildren } from 'preact';

import { listModels as listCustomModels } from '../../ai/custom';
import {
  customContextWindow,
  detectContextWindows,
  resolveCustomPromptTier,
  toolsForCustomTier,
  REDUCED_TOOLS_NOTE,
  type ResolvedCustomTier,
} from '../../ai/customContext';
import { buildLocalSystemPrompt, buildMediumLocalSystemPrompt } from '../../ai/systemPrompt';
import { buildToolList } from '../../ai/tools';
import type { CustomPromptTier } from '../../ai/types';
import { getConfig } from '../../config/appConfig';
import { loadToolsDefinition, selectOfferedTools } from '../../ai/toolGroups';
import {
  addKeyCommand,
  classifyBridgeError,
  defaultConfigPath,
  detectBridgeOs,
  diagnoseBridgeModels,
  generateApiKey,
  listKeysCommand,
  loginCommand,
  manualAddKeyText,
  pickDefaultModel,
  CLI_PROXY_STATUS_URL,
  type BridgeOs,
} from '../../ai/cliProxy';
import {
  mergeBackup,
  nameFromUrl,
  newEndpoint,
  parseBackup,
  serializeBackup,
  type EndpointKind,
  type SavedEndpoint,
} from '../../ai/endpointProfiles';
import {
  deleteEndpoint,
  ensureEndpointsSeeded,
  listEndpoints,
  putEndpoint,
  putEndpoints,
  syncLegacyCustomKey,
  findActiveEndpoint,
} from '../../ai/customEndpoints';
import {
  loadSettings,
  setCustomBaseUrl,
  setCustomContext,
  setCustomModel,
  setCustomModels,
  setCustomReasoningEffort,
} from '../../ai/settings';
import { generateId } from '../../storage/db';
import { downloadBlob } from '../../export/download';
import { confirmDialog } from '../dialogs';
import { showToast } from '../toast';
import { BUTTON_SMALL_DANGER } from '../styleConstants';

import { settingsSignal, setSettings } from './settingsStore';
import { Divider, Section, Pill, PrimaryButton, SecondaryButton } from './primitives';
import { BridgeIntro, CopyRow, InstallStep, OsPills, Step } from './cliBridgeSetup';

/** The base URL of the endpoint open in the editor — the footer's / Enable
 *  row's "ready" check reads it, since activating applies THAT endpoint.
 *  Null while the tab isn't mounted (fall back to the toggles' URL). */
export const customEditorUrl = signal<string | null>(null);

type Tone = 'ok' | 'warn' | 'err' | 'busy';
interface Status { tone: Tone; text: string; command?: string }

const INPUT = 'w-full px-3 py-2 rounded bg-zinc-900 border border-zinc-600 text-zinc-100 text-sm placeholder:text-zinc-600 focus:outline-none focus:border-blue-500';

export function CustomEndpointsTab(props: {
  /** Notify the modal + AI panel that settings changed. */
  onChange: () => void;
  /** The tab registers how to commit its edits; `activate` = the footer's
   *  "Save & activate" / the Enable row, which apply the open endpoint. */
  registerFlush: (fn: ((activate: boolean) => Promise<void>) | null) => void;
  /** The system-prompt section, rendered at the bottom. */
  systemPrompt: ComponentChildren;
}) {
  const { onChange, registerFlush } = props;
  const endpoints = useSignal<SavedEndpoint[]>([]);
  const draft = useSignal<SavedEndpoint | null>(null);
  /** Id of the endpoint whose settings the Custom provider currently uses. */
  const appliedId = useSignal<string | null>(null);
  const loaded = useSignal(false);
  const status = useSignal<Status | null>(null);
  const os = useSignal<BridgeOs>(detectBridgeOs());
  const showKey = useSignal(false);
  const showInstall = useSignal(false);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    const t = loadSettings().toggles;
    void ensureEndpointsSeeded(
      { baseUrl: t.customBaseUrl, model: t.customModel, models: t.customModels, reasoningEffort: t.customReasoningEffort, context: t.customContext },
      generateId(),
    ).then(async list => {
      const applied = await findActiveEndpoint(t.customBaseUrl, list);
      if (cancelled) return;
      endpoints.value = list;
      appliedId.value = applied?.id ?? null;
      select(applied ?? list[0] ?? null);
      loaded.value = true;
    }).catch(err => {
      if (cancelled) return;
      status.value = { tone: 'err', text: `Couldn't load saved endpoints: ${err instanceof Error ? err.message : String(err)}` };
      loaded.value = true;
    });
    return () => { cancelled = true; customEditorUrl.value = null; };
  }, []);

  useEffect(() => {
    registerFlush(async activate => {
      const d = draft.value;
      if (!d) return;
      // persist() re-applies the in-use endpoint when something changed; an
      // untouched one is NOT re-applied, so a plain Save never overwrites a
      // model the session picked from the AI panel.
      await persist({});
      if (activate) await apply(draft.value!);
    });
    return () => registerFlush(null);
  }, []);

  function select(e: SavedEndpoint | null): void {
    draft.value = e ? { ...e } : null;
    customEditorUrl.value = e?.baseUrl ?? null;
    status.value = null;
    showKey.value = false;
    showInstall.value = false;
  }

  function replaceInList(e: SavedEndpoint): void {
    const i = endpoints.value.findIndex(x => x.id === e.id);
    endpoints.value = i >= 0
      ? endpoints.value.map(x => (x.id === e.id ? e : x))
      : [...endpoints.value, e];
  }

  /** Copy an endpoint onto the Custom provider's settings + key row. */
  async function apply(e: SavedEndpoint): Promise<void> {
    let s = setCustomBaseUrl(loadSettings(), e.baseUrl);
    s = setCustomModel(s, e.model.trim());
    s = setCustomModels(s, e.models);
    s = setCustomReasoningEffort(s, e.reasoningEffort);
    s = setCustomContext(s, e.context);
    setSettings(s);
    await syncLegacyCustomKey(e.apiKey);
    appliedId.value = e.id;
    onChange();
  }

  /** Save the draft (plus `patch`) to its endpoint; re-apply it when it's
   *  the one in use, so edits take effect without another click. With
   *  `targetId` naming an endpoint that's no longer open in the editor (an
   *  async Connect finishing after the user switched rows), the patch goes to
   *  that endpoint's stored row and the open draft is left alone. */
  async function persist(patch: Partial<SavedEndpoint>, targetId?: string): Promise<SavedEndpoint | null> {
    const inDraft = !targetId || draft.value?.id === targetId;
    const d = inDraft ? draft.value : endpoints.value.find(x => x.id === targetId) ?? null;
    if (!d) return null;
    const m: SavedEndpoint = { ...d, ...patch };
    // A generic endpoint still carrying its placeholder name takes its host's
    // name once it has a URL ("vllm.example.com" beats "OpenAI-compatible endpoint 2").
    const placeholder = m.kind === 'openai-compatible' && /^OpenAI-compatible endpoint( \d+)?$/.test(m.name.trim());
    const next: SavedEndpoint = {
      ...m,
      name: (placeholder && m.baseUrl.trim() ? nameFromUrl(m.baseUrl) : m.name.trim()) || 'Custom endpoint',
      baseUrl: m.baseUrl.trim(),
      apiKey: m.apiKey.trim(),
      model: m.model.trim(),
      configPath: m.configPath.trim(),
      updatedAt: Date.now(),
    };
    // Nothing changed (e.g. switching rows, or the footer's flush) → no write,
    // so `updatedAt` keeps meaning "last edited" for tie-breaks and backups.
    const stored = endpoints.value.find(x => x.id === next.id);
    if (stored && sameEndpoint(stored, next)) {
      if (inDraft) draft.value = { ...stored };
      return stored;
    }
    if (inDraft) {
      draft.value = next;
      customEditorUrl.value = next.baseUrl;
    }
    replaceInList(next);
    await putEndpoint(next);
    if (appliedId.value === next.id) await apply(next);
    return next;
  }

  async function useEndpoint(e: SavedEndpoint): Promise<void> {
    if (draft.value?.id !== e.id) select(e);
    await apply(e);
    showToast(`Custom provider now uses “${e.name}”.`, { variant: 'success', source: 'ai' });
  }

  async function addEndpoint(kind: EndpointKind): Promise<void> {
    const e = newEndpoint(kind, generateId());
    const taken = new Set(endpoints.value.map(x => x.name));
    for (let n = 2; taken.has(e.name); n++) e.name = `${newEndpoint(kind, '').name} ${n}`;
    await putEndpoint(e);
    replaceInList(e);
    select(e);
  }

  async function removeEndpoint(e: SavedEndpoint): Promise<void> {
    const ok = await confirmDialog(`Delete the saved endpoint “${e.name}”? Its API key is forgotten too (a CLIProxyAPI bridge keeps it in its own config).`, { danger: true, confirmLabel: 'Delete' });
    if (!ok) return;
    await deleteEndpoint(e.id);
    endpoints.value = endpoints.value.filter(x => x.id !== e.id);
    if (appliedId.value === e.id) {
      // Forget the mirrored key too, or chats would keep sending it (and the
      // next open would re-seed the deleted endpoint from it).
      await syncLegacyCustomKey('');
      appliedId.value = null;
      onChange();
    }
    select(endpoints.value[0] ?? null);
  }

  async function newKey(): Promise<void> {
    const d = draft.value;
    if (!d) return;
    if (d.apiKey) {
      const ok = await confirmDialog('Replace this endpoint’s API key with a new one? You’ll need to run step 2’s command again to add it to the bridge. The old key keeps working in the bridge until you remove it from its config.', { confirmLabel: 'New key' });
      if (!ok) return;
    }
    showKey.value = true;
    await persist({ apiKey: generateApiKey() });
  }

  async function connect(): Promise<void> {
    const d = await persist({});
    if (!d) return;
    if (!d.baseUrl.trim()) { status.value = { tone: 'err', text: 'Enter the endpoint’s base URL first.' }; return; }
    status.value = { tone: 'busy', text: 'Connecting…' };
    // The user may switch rows while this awaits: results go to THIS
    // endpoint (by id), and the status only shows if it's still open.
    const stillOpen = () => draft.value?.id === d.id;
    try {
      const list = await listCustomModels(d.baseUrl, d.apiKey);
      const ids = list.map(m => m.id);
      // A bridge fronts hosted models (big windows, Full payload); anything
      // else may be a small local server — ask it what it runs with.
      const detected = d.kind === 'cliproxyapi' ? {} : await detectContextWindows(d.baseUrl, d.apiKey, ids);
      const cur = stillOpen() ? draft.value! : endpoints.value.find(x => x.id === d.id);
      if (!cur) return; // deleted meanwhile
      const model = cur.model.trim() || (d.kind === 'cliproxyapi' ? pickDefaultModel(ids) : (ids.length === 1 ? ids[0] : ''));
      const context = Object.keys(detected).length > 0 ? { ...cur.context, modelWindows: detected } : cur.context;
      const saved = await persist({ models: ids, model, lastConnectedAt: Date.now(), context }, d.id);
      if (!stillOpen()) return;
      const hint = d.kind === 'cliproxyapi' ? diagnoseBridgeModels(ids, saved?.model ?? model, os.value) : null;
      const ctxNote = model && detected[model] ? ` Context window: ${detected[model].toLocaleString()} tokens.` : '';
      status.value = hint
        ? { tone: 'warn', text: hint.text, command: hint.command }
        : { tone: 'ok', text: ids.length ? `Connected — ${ids.length} model(s) available.${model ? '' : ' Pick one below.'}${ctxNote}` : 'Connected, but the endpoint reported no models — type the model id below.' };
    } catch (err) {
      if (!stillOpen()) return;
      status.value = explainConnectError(err instanceof Error ? err.message : String(err), d, os.value);
    }
  }

  async function exportBackup(): Promise<void> {
    const ok = await confirmDialog('The backup file holds every saved endpoint INCLUDING its API key, in plain text. Keep it somewhere private, and only restore backups you made yourself.', { confirmLabel: 'Download backup' });
    if (!ok) return;
    const list = await listEndpoints();
    downloadBlob(new Blob([serializeBackup(list)], { type: 'application/json' }), 'partwright-ai-endpoints.json');
    showToast(`Backed up ${list.length} endpoint(s). The file contains your API keys — keep it private.`, { variant: 'success', source: 'ai' });
  }

  async function importBackup(file: File): Promise<void> {
    try {
      const incoming = parseBackup(await file.text());
      const { list, changed } = mergeBackup(await listEndpoints(), incoming);
      await putEndpoints(list);
      endpoints.value = await listEndpoints();
      // Re-open from the stored rows, so a stale draft can't write the
      // pre-restore copy back over what was just restored.
      select(endpoints.value.find(x => x.id === draft.value?.id) ?? endpoints.value[0] ?? null);
      showToast(changed ? `Restored ${changed} endpoint(s).` : 'Those endpoints are already saved here.', { variant: 'success', source: 'ai' });
    } catch (err) {
      showToast(`Couldn't restore endpoints: ${err instanceof Error ? err.message : String(err)}`, { variant: 'warn', source: 'ai' });
    }
  }

  const d = draft.value;
  const appliedUrl = settingsSignal.value.toggles.customBaseUrl;

  return (
    <>
      <Section label="Saved endpoints">
        <p class="text-[11px] text-zinc-300 leading-snug">
          Point Partwright at any <strong>OpenAI-compatible</strong> chat endpoint — a CLIProxyAPI subscription bridge (local or remote), a self-hosted <code>llama.cpp</code> / vLLM / LM Studio server, or a hosted gateway. Each endpoint keeps its URL, API key and default model, so switching is one click.
        </p>
        <div class="flex flex-col gap-1" data-testid="custom-endpoint-list">
          {!loaded.value && <span class="text-[11px] text-zinc-500">Loading…</span>}
          {endpoints.value.map(e => (
            <EndpointRow
              key={e.id}
              e={e}
              selected={d?.id === e.id}
              applied={appliedId.value === e.id}
              onSelect={() => { void (async () => { if (draft.value) await persist({}); select(e); })(); }}
              onUse={() => { void useEndpoint(e); }}
            />
          ))}
        </div>
        <div class="flex flex-wrap items-center gap-1.5">
          <SecondaryButton label="+ CLIProxyAPI bridge" size="sm" onClick={() => { void addEndpoint('cliproxyapi'); }} />
          <SecondaryButton label="+ Other endpoint" size="sm" onClick={() => { void addEndpoint('openai-compatible'); }} />
          <span class="flex-1" />
          <SecondaryButton label="Back up…" size="sm" title="Download every saved endpoint (including API keys) as a JSON file." onClick={() => { void exportBackup(); }} />
          <SecondaryButton label="Restore…" size="sm" title="Add endpoints from a backup file." onClick={() => fileInput.current?.click()} />
          <input
            ref={fileInput}
            type="file"
            accept="application/json,.json"
            class="hidden"
            onChange={e => {
              const input = e.currentTarget as HTMLInputElement;
              const f = input.files?.[0];
              input.value = '';
              if (f) void importBackup(f);
            }}
          />
        </div>
        <span class="text-[10px] text-zinc-500 leading-snug">
          Saved in this browser until you delete them — settings resets, presets and session switches leave them alone. Keys never leave the browser except to the endpoint itself. Back up to move them to another browser or keep them through clearing site data.
        </span>
      </Section>
      <Divider />
      {d && (
        <EndpointEditor
          d={d}
          applied={appliedId.value === d.id}
          appliedElsewhere={!!appliedUrl && appliedId.value !== d.id}
          os={os.value}
          onOs={v => { os.value = v; }}
          status={status.value}
          showKey={showKey.value}
          onToggleKey={() => { showKey.value = !showKey.value; }}
          showInstall={showInstall.value || !d.lastConnectedAt}
          onShowInstall={() => { showInstall.value = true; }}
          edit={patch => { draft.value = { ...draft.value!, ...patch }; if ('baseUrl' in patch) customEditorUrl.value = patch.baseUrl ?? null; }}
          commit={patch => { void persist(patch ?? {}); }}
          onNewKey={() => { void newKey(); }}
          onConnect={() => { void connect(); }}
          onUse={() => { void useEndpoint(d); }}
          onDelete={() => { void removeEndpoint(d); }}
        />
      )}
      {loaded.value && !d && (
        <p class="text-[11px] text-zinc-400">No saved endpoints. Add a CLIProxyAPI bridge or another endpoint above.</p>
      )}
      <Divider />
      {props.systemPrompt}
    </>
  );
}

function shortKey(key: string): string {
  return key.length > 14 ? `${key.slice(0, 7)}…${key.slice(-4)}` : key;
}

function sameEndpoint(a: SavedEndpoint, b: SavedEndpoint): boolean {
  return JSON.stringify({ ...a, updatedAt: 0 }) === JSON.stringify({ ...b, updatedAt: 0 });
}

function EndpointRow(props: { e: SavedEndpoint; selected: boolean; applied: boolean; onSelect: () => void; onUse: () => void }) {
  const { e } = props;
  return (
    <div
      data-testid="custom-endpoint-row"
      class={'flex items-center gap-2 rounded border px-2 py-1.5 ' + (props.selected ? 'border-blue-600 bg-blue-950/30' : 'border-zinc-700 hover:bg-zinc-800/60')}
    >
      <button type="button" class="flex-1 min-w-0 text-left" onClick={props.onSelect} title="Edit this endpoint">
        <div class="flex items-center gap-1.5 min-w-0">
          <span class="text-xs text-zinc-100 truncate">{e.name}</span>
          <span class="shrink-0 px-1 rounded text-[9px] uppercase tracking-wide bg-zinc-700 text-zinc-300">{e.kind === 'cliproxyapi' ? 'CLIProxyAPI' : 'OpenAI-compatible'}</span>
        </div>
        <div class="text-[10px] text-zinc-500 font-mono truncate">
          {e.baseUrl || '(no URL yet)'}{e.model ? ` · ${e.model}` : ''}{e.apiKey ? ' · key saved' : ''}
        </div>
      </button>
      {props.applied
        ? <span class="shrink-0 px-1.5 py-0.5 rounded text-[10px] bg-emerald-900/40 text-emerald-300 border border-emerald-700/50">In use</span>
        : <SecondaryButton label="Use" size="sm" disabled={!e.baseUrl.trim()} title="Make the Custom provider use this endpoint." onClick={props.onUse} />}
    </div>
  );
}

function explainConnectError(message: string, d: SavedEndpoint, os: BridgeOs): Status {
  const bridge = d.kind === 'cliproxyapi';
  const kind = classifyBridgeError(message);
  if (bridge && kind === 'bridge-key') {
    return { tone: 'err', text: `The bridge doesn't accept this endpoint's key yet. Run step 2's command (it adds the key and keeps any others), then Connect again. (${message})` };
  }
  if (bridge && kind === 'subscription-auth') {
    return { tone: 'err', text: `The bridge answered, but its subscription login is missing or expired. Run this, then Connect again. (${message})`, command: loginCommand(d.model || 'claude', os) };
  }
  if (bridge && /failed to fetch|networkerror|load failed/i.test(message)) {
    return { tone: 'err', text: `Couldn't reach the bridge at ${d.baseUrl}. Is it running (step 1)? ${CLI_PROXY_STATUS_URL} shows its status and any config errors.` };
  }
  return { tone: 'err', text: message };
}

function EndpointEditor(props: {
  d: SavedEndpoint;
  applied: boolean;
  appliedElsewhere: boolean;
  os: BridgeOs;
  onOs: (os: BridgeOs) => void;
  status: Status | null;
  showKey: boolean;
  onToggleKey: () => void;
  showInstall: boolean;
  onShowInstall: () => void;
  /** Update the draft locally (while typing). */
  edit: (patch: Partial<SavedEndpoint>) => void;
  /** Save the draft (optionally with a patch). */
  commit: (patch?: Partial<SavedEndpoint>) => void;
  onNewKey: () => void;
  onConnect: () => void;
  onUse: () => void;
  onDelete: () => void;
}) {
  const { d, os, edit, commit } = props;
  const bridge = d.kind === 'cliproxyapi';
  const connected = d.lastConnectedAt > 0;
  /** Reached, and serving models — so the key and the login both work. */
  const working = connected && d.models.length > 0 && props.status?.tone !== 'err' && props.status?.tone !== 'warn';
  // The config-path field only shows off macOS, so a path saved there (or
  // restored from another machine's backup) never steers the brew command.
  const cfgPath = os === 'mac' ? undefined : d.configPath;
  const addCmd = bridge ? addKeyCommand(d.apiKey, os, cfgPath) : null;
  const listCmd = bridge ? listKeysCommand(os, cfgPath) : null;
  let n = 0;

  const header = (
    <div class="flex items-end gap-2">
      <label class="flex-1 flex flex-col gap-1 min-w-0">
        <span class="text-xs text-zinc-400">Name</span>
        <input
          type="text"
          data-testid="custom-endpoint-name"
          class={INPUT}
          value={d.name}
          onInput={e => edit({ name: (e.currentTarget as HTMLInputElement).value })}
          onChange={() => commit()}
        />
      </label>
      {props.applied
        ? <span class="shrink-0 mb-2 text-[11px] text-emerald-300">In use by the Custom provider</span>
        : <SecondaryButton label="Use this endpoint" size="sm" disabled={!d.baseUrl.trim()} onClick={props.onUse} />}
      <button type="button" class={`shrink-0 mb-1 ${BUTTON_SMALL_DANGER}`} onClick={props.onDelete}>Delete</button>
    </div>
  );

  const urlField = (
    <label class="flex flex-col gap-1">
      <span class="text-xs text-zinc-400">Base URL</span>
      <input
        type="text"
        data-testid="custom-endpoint-url"
        placeholder={bridge ? 'http://localhost:8317/v1' : 'https://my-server.example.com/v1'}
        class={INPUT + ' font-mono'}
        spellcheck={false}
        value={d.baseUrl}
        onInput={e => edit({ baseUrl: (e.currentTarget as HTMLInputElement).value })}
        onChange={() => commit()}
      />
      <span class="text-[10px] text-zinc-500">
        {bridge
          ? <>The bridge’s default is <code>http://localhost:8317/v1</code>. Running it on another machine? Use that machine’s address — over <strong>HTTPS</strong>, since browsers block plain <code>http</code> from this site except for localhost.</>
          : <>Include the version path (most servers serve under <code>/v1</code>). The endpoint must allow this site via <strong>CORS</strong>, and be <strong>HTTPS</strong> unless it’s on <code>localhost</code>.</>}
      </span>
    </label>
  );

  const keyField = (
    <div class="flex flex-col gap-1">
      <div class="flex items-center gap-1.5">
        <input
          type={props.showKey ? 'text' : 'password'}
          data-testid="custom-endpoint-key"
          placeholder={bridge ? 'paste the bridge’s key, or click New key' : 'leave blank if the endpoint needs no auth'}
          class={INPUT + ' flex-1 font-mono'}
          spellcheck={false}
          autocomplete="off"
          value={d.apiKey}
          onInput={e => edit({ apiKey: (e.currentTarget as HTMLInputElement).value })}
          onChange={() => commit()}
          // Pasting is how most keys arrive — save right away instead of
          // waiting for blur.
          onPaste={() => { setTimeout(() => commit(), 0); }}
        />
        <SecondaryButton label={props.showKey ? 'Hide' : 'Show'} size="sm" onClick={props.onToggleKey} />
        {d.apiKey && <CopyButton text={d.apiKey} />}
        {bridge && <SecondaryButton label="New key" size="sm" title="Generate a fresh random key for this endpoint." onClick={props.onNewKey} />}
      </div>
      <span class="text-[10px] text-zinc-500">
        Saved with this endpoint and sent as <code>Authorization: Bearer …</code>{bridge ? ' — it stays the same until you change it, so the bridge never needs updating again.' : '.'}
      </span>
    </div>
  );

  const connectRow = (
    <div class="flex flex-col gap-1.5">
      <div class="flex items-center gap-2 flex-wrap">
        <PrimaryButton label={props.status?.tone === 'busy' ? 'Connecting…' : connected ? 'Reconnect & refresh models' : 'Connect'} disabled={props.status?.tone === 'busy'} onClick={props.onConnect} />
        {connected && !props.status && <span class="text-[10px] text-zinc-500">Last connected {new Date(d.lastConnectedAt).toLocaleString()}</span>}
      </div>
      {props.status && props.status.tone !== 'busy' && <StatusBox status={props.status} />}
    </div>
  );

  const modelField = (
    <div class="flex flex-col gap-1.5">
      <input
        type="text"
        data-testid="custom-endpoint-model"
        placeholder={bridge ? 'e.g. claude-sonnet-5-5' : 'e.g. llama-3.3-70b-instruct'}
        class={INPUT + ' font-mono'}
        spellcheck={false}
        value={d.model}
        onInput={e => edit({ model: (e.currentTarget as HTMLInputElement).value })}
        onChange={() => commit()}
      />
      {d.models.length > 0 && (
        <div class="flex flex-wrap gap-1">
          {d.models.map(id => <Pill key={id} active={d.model === id} label={id} onClick={() => commit({ model: id })} />)}
        </div>
      )}
      <span class="text-[10px] text-zinc-500">{d.models.length ? 'The default model for this endpoint. You can also switch models from the AI panel.' : 'Connect to list what the endpoint serves, or type the id.'}</span>
      <label class="flex items-start gap-2 text-[11px] text-zinc-300">
        <input
          type="checkbox"
          class="mt-0.5"
          data-testid="custom-reasoning-effort"
          checked={d.reasoningEffort}
          onChange={e => commit({ reasoningEffort: (e.currentTarget as HTMLInputElement).checked })}
        />
        <span><strong class="text-zinc-200">Send the Thinking level as <code>reasoning_effort</code>.</strong> <span class="text-zinc-400">Lets the 🧠 pill set reasoning depth (Low → Max sent as-is; Off and Default send nothing). Made for CLIProxyAPI; servers that only accept low/medium/high may reject XHigh/Max, and Ollama rejects it on models that don’t think.</span></span>
      </label>
    </div>
  );

  return (
    <div class="flex flex-col gap-3" data-testid="custom-endpoint-editor">
      {header}
      {props.appliedElsewhere && (
        <p class="text-[10px] text-zinc-500">Editing a saved endpoint. The Custom provider uses another one until you click <strong>Use this endpoint</strong> (or Save &amp; activate).</p>
      )}
      {bridge ? (
        <div class="rounded border border-blue-800/40 bg-blue-950/20 px-3 py-3 flex flex-col gap-3">
          <BridgeIntro />
          <OsPills os={os} onSelect={props.onOs} />
          <Step n={++n} title="Install & start the bridge" done={connected}>
            {props.showInstall
              ? <InstallStep os={os} />
              : <button type="button" class="self-start text-[11px] text-zinc-400 hover:text-zinc-200 underline" onClick={props.onShowInstall}>Done — the bridge answered. Show the install commands</button>}
          </Step>
          <Step n={++n} title="API key" done={working}>
            {keyField}
            {os !== 'mac' && os !== 'windows' && (
              <label class="flex items-center gap-2">
                <span class="shrink-0 text-[10px] text-zinc-500">Config file</span>
                <input
                  type="text"
                  data-testid="custom-endpoint-config"
                  class="flex-1 min-w-0 px-2 py-1 rounded bg-zinc-900 border border-zinc-700 text-zinc-100 text-[11px] font-mono placeholder:text-zinc-600 focus:outline-none focus:border-blue-500"
                  placeholder={defaultConfigPath(os)}
                  spellcheck={false}
                  value={d.configPath}
                  onInput={e => edit({ configPath: (e.currentTarget as HTMLInputElement).value })}
                  onChange={() => commit()}
                />
              </label>
            )}
            {d.apiKey.trim() ? (
              <>
                <span class="text-[10px] text-zinc-400">Add it to the bridge — keeps any keys already there, so other browsers stay connected. Safe to re-run.</span>
                {addCmd ? <CopyRow cmd={addCmd} summary={`# add ${shortKey(d.apiKey)} to ${cfgPath?.trim() || defaultConfigPath(os)}${os === 'mac' ? ', then restart the bridge' : ''}`} testId="bridge-add-key-cmd" /> : <p class="text-[11px] text-amber-200 leading-snug">{manualAddKeyText(d.apiKey.trim())}</p>}
              </>
            ) : (
              <span class="text-[10px] text-amber-200">Click <strong>New key</strong> (or paste one the bridge already accepts) — CLIProxyAPI won’t start until its config has a real key.</span>
            )}
            {listCmd && (
              <details class="text-[10px] text-zinc-400">
                <summary class="cursor-pointer select-none hover:text-zinc-200">Bridge already set up, e.g. from another browser? Reuse its key</summary>
                <div class="flex flex-col gap-1 mt-1">
                  <span>Print the keys the bridge accepts, then paste one into the field above:</span>
                  <CopyRow cmd={listCmd} testId="bridge-list-keys-cmd" />
                </div>
              </details>
            )}
          </Step>
          <Step n={++n} title="Log in with your subscription" done={working}>
            <CopyRow cmd={loginCommand('claude', os)} />
            <span class="text-[10px] text-zinc-500">Opens a browser to authorize your Claude plan. Use <code>{loginCommand('gpt', os)}</code> for ChatGPT/Codex. Logins can expire — if chats start failing with an auth error, Partwright will tell you to run this again.</span>
          </Step>
          <Step n={++n} title="Connect" done={connected && props.status?.tone !== 'err'}>
            {urlField}
            {connectRow}
          </Step>
          <Step n={++n} title="Choose a default model" done={!!d.model.trim()}>
            {modelField}
          </Step>
          <p class="text-[10px] text-zinc-500 leading-snug">
            Keep a local bridge bound to <code>127.0.0.1</code> (the default) — don’t expose it on your network without TLS and a key. Using a subscription outside its official app is community-supported and not endorsed by Anthropic or OpenAI; confirm it’s allowed under your plan.
          </p>
        </div>
      ) : (
        <div class="flex flex-col gap-3">
          <Step n={++n} title="Endpoint">{urlField}</Step>
          <Step n={++n} title="API key (optional)">{keyField}</Step>
          <Step n={++n} title="Connect" done={connected && props.status?.tone !== 'err'}>{connectRow}</Step>
          <Step n={++n} title="Choose a default model" done={!!d.model.trim()}>{modelField}</Step>
          <Step n={++n} title="Context size">
            <ContextField d={d} commit={commit} />
          </Step>
        </div>
      )}
    </div>
  );
}

const TIER_OPTIONS: { id: CustomPromptTier; label: string }[] = [
  { id: 'auto', label: 'Auto' },
  { id: 'full', label: 'Full' },
  { id: 'medium', label: 'Medium' },
  { id: 'slim', label: 'Slim' },
];

function tierHint(tier: ResolvedCustomTier): string {
  if (tier === 'medium') return 'compact prompt + everyday tools, docs read on demand';
  if (tier === 'slim') return 'smallest prompt + core tools, docs read on demand';
  return getConfig().ai.onDemandToolGroups
    ? 'all of ai.md + the core tools, more loaded on demand — for big hosted models'
    : 'all of ai.md + every tool — for big hosted models';
}

/** Rough tokens each tier sends before the conversation starts (Full's
 *  ai.md isn't loaded here, so its figure covers the tool schemas only).
 *  Full sends the core tools + loadTools when on-demand tool groups are on
 *  (chatLoop's toolsForRequest), every gated tool otherwise. */
function tierTokenEstimates(): Record<ResolvedCustomTier, number> {
  const tools = buildToolList(loadSettings().toggles);
  const cfg = getConfig().ai;
  const cpt = cfg.charsPerToken;
  const est = (tier: ResolvedCustomTier, promptChars: number) =>
    Math.round((promptChars + JSON.stringify(toolsForCustomTier(tools, tier)).length) / cpt);
  const fullTools = cfg.onDemandToolGroups ? selectOfferedTools(tools, new Set(), loadToolsDefinition()) : tools;
  return {
    full: Math.round(JSON.stringify(fullTools).length / cpt),
    medium: est('medium', buildMediumLocalSystemPrompt().length + REDUCED_TOOLS_NOTE.length),
    slim: est('slim', buildLocalSystemPrompt().length + REDUCED_TOOLS_NOTE.length),
  };
}

function kTokens(n: number): string {
  return n >= 10_000 ? `~${Math.round(n / 1000)}k` : `~${(n / 1000).toFixed(1)}k`;
}

/** The endpoint's context window (typed, or detected on Connect) and how much
 *  prompt + tool schema to send into it. */
function ContextField(props: { d: SavedEndpoint; commit: (patch?: Partial<SavedEndpoint>) => void }) {
  const { d, commit } = props;
  const estimates = useMemo(tierTokenEstimates, []);
  const ctx = { customModel: d.model, customContext: d.context };
  const ctxWindow = customContextWindow(ctx);
  const resolved = resolveCustomPromptTier(ctx);
  // What Auto would pick for this window — shown on the Auto pill even while
  // another tier is selected.
  const autoTier = resolveCustomPromptTier({ ...ctx, customContext: { ...d.context, promptTier: 'auto' } });
  const detected = d.context.modelWindows[d.model.trim()] ?? 0;
  const overflow = ctxWindow > 0 && estimates[resolved] >= ctxWindow * getConfig().ai.customOverflowWarnFraction;
  const source = d.context.window > 0
    ? 'you set it'
    : detected > 0 ? `detected for ${d.model.trim()}` : null;
  return (
    <div class="flex flex-col gap-1.5" data-testid="custom-context">
      <label class="flex items-center gap-2">
        <span class="shrink-0 text-[11px] text-zinc-300">Context window</span>
        <input
          type="number"
          min={1024}
          step={1024}
          data-testid="custom-context-window"
          class="w-32 px-2 py-1 rounded bg-zinc-900 border border-zinc-700 text-zinc-100 text-[11px] font-mono placeholder:text-zinc-600 focus:outline-none focus:border-blue-500"
          placeholder={detected > 0 ? String(detected) : 'unknown'}
          value={d.context.window > 0 ? String(d.context.window) : ''}
          onChange={e => {
            const v = Math.floor(Number((e.currentTarget as HTMLInputElement).value));
            commit({ context: { ...d.context, window: Number.isFinite(v) && v > 0 ? v : 0 } });
          }}
        />
        <span class="text-[10px] text-zinc-500">tokens{source ? ` · ${source}` : ''}</span>
      </label>
      <span class="text-[10px] text-zinc-500 leading-snug">
        {ctxWindow > 0
          ? 'Drives the context meter and Auto-compact. Leave blank to use what Connect detects.'
          : 'Connect asks the server (llama.cpp, vLLM, LM Studio, Ollama). If it can’t tell, type what the server was started with — e.g. llama.cpp’s -c, Ollama’s num_ctx — or Partwright assumes a large hosted model.'}
      </span>
      <div class="flex items-center gap-1 flex-wrap" data-testid="custom-prompt-tier">
        <span class="shrink-0 text-[11px] text-zinc-300 mr-1">Prompt size</span>
        {TIER_OPTIONS.map(o => (
          <Pill
            key={o.id}
            active={d.context.promptTier === o.id}
            label={o.id === 'auto' ? `Auto (${autoTier})` : `${o.label} ${kTokens(estimates[o.id as ResolvedCustomTier])}`}
            onClick={() => commit({ context: { ...d.context, promptTier: o.id } })}
          />
        ))}
      </div>
      <span class="text-[10px] text-zinc-500 leading-snug">
        Sent with every request: <strong class="text-zinc-300">{resolved}</strong> — {tierHint(resolved)}{resolved === 'full' ? `, ${kTokens(estimates.full)} tokens of tool schemas plus the full ai.md prompt.` : ` (${kTokens(estimates[resolved])} tokens).`}
        {d.context.promptTier === 'auto' && ` Auto uses Slim below ${getConfig().ai.customSlimMaxContext.toLocaleString()} tokens, Medium below ${getConfig().ai.customMediumMaxContext.toLocaleString()}, and Full above that or when the window is unknown.`}
      </span>
      {overflow && (
        <span class="text-[10px] text-amber-200 leading-snug" data-testid="custom-context-overflow">
          That leaves little or no room in a {ctxWindow.toLocaleString()}-token window — pick a smaller prompt size.
        </span>
      )}
    </div>
  );
}

function StatusBox(props: { status: Status }) {
  const { tone, text, command } = props.status;
  const cls = tone === 'ok'
    ? 'border-emerald-700/50 bg-emerald-900/15 text-emerald-300'
    : tone === 'warn'
      ? 'border-amber-700/50 bg-amber-900/20 text-amber-200'
      : 'border-red-800/60 bg-red-950/30 text-red-300';
  return (
    <div data-testid="custom-endpoint-status" class={`rounded border px-2 py-1.5 flex flex-col gap-1 text-[11px] leading-snug ${cls}`}>
      <span class="break-words">{text}</span>
      {command && <CopyRow cmd={command} />}
    </div>
  );
}

function CopyButton(props: { text: string }) {
  const label = useSignal('Copy');
  return (
    <SecondaryButton
      label={label.value}
      size="sm"
      onClick={() => {
        void navigator.clipboard.writeText(props.text)
          .then(() => { label.value = 'Copied!'; }, () => { label.value = 'Copy failed'; })
          .finally(() => setTimeout(() => { label.value = 'Copy'; }, 1600));
      }}
    />
  );
}
