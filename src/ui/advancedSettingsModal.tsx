// Advanced Settings modal — power-user overrides for numeric constants that
// control AI loop behavior, rendering quality, import limits, and UI timing.
// All values default to the factory defaults in src/config/appConfig.ts.
// Changes persist to localStorage and take effect immediately (renderer
// settings marked "reload" need a page refresh to rebuild Three.js objects).

import { signal, computed, useSignal, type Signal } from '@preact/signals';
import type { ComponentChildren } from 'preact';
import { mountPreactModal } from './preact/mount';
import {
  loadAppConfig,
  saveAppConfig,
  resetAppConfig,
  APP_CONFIG_DEFAULTS,
  type AppConfig,
} from '../config/appConfig';
import { showUninstallModal } from './uninstallModal';
import {
  ENGINE_SANDBOX_MODES,
  defaultEngineSandboxMode,
  engineSandboxOriginAvailable,
  getEngineSandboxMode,
  isEngineSandboxMode,
  setEngineSandboxMode,
  type EngineSandboxMode,
} from '../sandbox/engineSandboxSetting';
import { getEngineSandboxStatus } from '../sandbox/sandboxHost';
import { registerTool, createToolNote, type ToolOpenContext, type ToolOpenResult } from './toolRegistry';

// ─── helpers ──────────────────────────────────────────────────────────────────

/** Deep-clone an AppConfig so mutations don't alias the cached instance. */
function cloneConfig(c: AppConfig): AppConfig {
  return {
    ai: { ...c.ai },
    renderer: { ...c.renderer },
    import: { ...c.import },
    ui: { ...c.ui },
    geometry: { ...c.geometry },
    segmentation: { ...c.segmentation },
  };
}

// ─── sub-components ──────────────────────────────────────────────────────────

interface FieldProps {
  /** `section.key` of the AppConfig field — the `focus` target of
   *  openTool('open-quality', {focus}). Rendered as data-setting. */
  cfgKey?: string;
  label: string;
  unit?: string;
  hint?: string;
  /** Detailed explanation shown in the "?" hover tooltip. */
  tooltip?: string;
  defaultValue: number;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  integer?: boolean;
  onChange: (v: number) => void;
}

function Field(props: FieldProps) {
  const { cfgKey, label, unit, hint, tooltip, defaultValue, value, min, max, step, integer, onChange } = props;
  const changed = value !== defaultValue;
  const effectiveStep = step ?? (integer ? 1 : 'any');

  function onInput(raw: string): void {
    const parsed = integer ? parseInt(raw, 10) : parseFloat(raw);
    if (!Number.isFinite(parsed)) return;
    const clamped = min !== undefined && max !== undefined
      ? Math.min(max, Math.max(min, parsed))
      : min !== undefined ? Math.max(min, parsed)
      : max !== undefined ? Math.min(max, parsed)
      : parsed;
    onChange(integer ? Math.round(clamped) : clamped);
  }

  return (
    <div class="flex flex-col gap-1 rounded" data-setting={cfgKey}>
      <div class="flex items-center gap-2">
        <label class="text-xs font-medium text-zinc-300 flex-1">{label}</label>
        {tooltip && (
          <div class="relative group/tip">
            <button
              type="button"
              aria-label={`Help: ${label}`}
              class="flex items-center justify-center w-4 h-4 rounded-full bg-zinc-700 text-[9px] font-bold text-zinc-400 hover:bg-zinc-600 hover:text-zinc-200 transition-colors cursor-help select-none"
            >?</button>
            <div class="absolute right-0 bottom-6 z-50 w-60 rounded border border-zinc-600 bg-zinc-800 p-2 text-[10px] leading-snug text-zinc-300 shadow-lg opacity-0 pointer-events-none group-hover/tip:opacity-100 transition-opacity">
              {tooltip}
            </div>
          </div>
        )}
        {changed && (
          <span class="text-[9px] text-amber-400 border border-amber-400/30 rounded px-1 py-px uppercase tracking-wide">
            modified
          </span>
        )}
      </div>
      <div class="flex items-center gap-2">
        <input
          type="number"
          min={min}
          max={max}
          step={effectiveStep}
          value={value}
          class="w-32 px-2 py-1 rounded bg-zinc-900 border border-zinc-700 text-sm text-zinc-100 focus:border-blue-500 focus:outline-none"
          onInput={e => onInput((e.currentTarget as HTMLInputElement).value)}
          onChange={e => onInput((e.currentTarget as HTMLInputElement).value)}
        />
        {unit && <span class="text-xs text-zinc-500">{unit}</span>}
        {changed && (
          <span class="text-[10px] text-zinc-500">default: {defaultValue}</span>
        )}
      </div>
      {hint && <p class="text-[10px] text-zinc-500 leading-snug">{hint}</p>}
    </div>
  );
}

interface ToggleFieldProps {
  cfgKey?: string;
  label: string;
  hint?: string;
  defaultValue: boolean;
  value: boolean;
  onChange: (v: boolean) => void;
}

function ToggleField(props: ToggleFieldProps) {
  const { cfgKey, label, hint, defaultValue, value, onChange } = props;
  const changed = value !== defaultValue;
  return (
    <div class="flex flex-col gap-1 rounded" data-setting={cfgKey}>
      <label class="flex items-center gap-2 cursor-pointer">
        <input
          type="checkbox"
          checked={value}
          class="w-4 h-4 accent-blue-500"
          onChange={e => onChange((e.currentTarget as HTMLInputElement).checked)}
        />
        <span class="text-xs font-medium text-zinc-300 flex-1">{label}</span>
        {changed && (
          <span class="text-[9px] text-amber-400 border border-amber-400/30 rounded px-1 py-px uppercase tracking-wide">
            modified
          </span>
        )}
      </label>
      {hint && <p class="text-[10px] text-zinc-500 leading-snug pl-6">{hint}</p>}
    </div>
  );
}

interface SectionProps {
  title: string;
  children: ComponentChildren;
}

function Section({ title, children }: SectionProps) {
  return (
    <div class="flex flex-col gap-3">
      <div class="text-[10px] uppercase tracking-wider font-semibold text-zinc-500 border-b border-zinc-700 pb-1">
        {title}
      </div>
      {children}
    </div>
  );
}

// ─── engine sandbox (per-browser setting, not part of AppConfig) ─────────────

const SANDBOX_MODE_LABELS: Record<EngineSandboxMode, string> = {
  off: 'Off — run model code in a plain Worker',
  origin: 'Separate origin — iframe on the sandbox host',
};

function SandboxModeField() {
  const mode = useSignal<EngineSandboxMode>(getEngineSandboxMode());
  const originAvailable = engineSandboxOriginAvailable();
  const status = getEngineSandboxStatus();
  const def = defaultEngineSandboxMode();
  return (
    <div class="flex flex-col gap-1 rounded" data-setting="security.engineSandbox">
      <div class="flex items-center gap-2">
        <label class="text-xs font-medium text-zinc-300 flex-1" for="engine-sandbox-mode">Engine sandbox</label>
        {mode.value !== def && (
          <span class="text-[9px] text-amber-400 border border-amber-400/30 rounded px-1 py-px uppercase tracking-wide">
            modified
          </span>
        )}
      </div>
      <select
        id="engine-sandbox-mode"
        class="px-2 py-1 rounded bg-zinc-900 border border-zinc-700 text-xs text-zinc-100 focus:border-blue-500 focus:outline-none"
        value={mode.value}
        onChange={e => {
          const v = (e.currentTarget as HTMLSelectElement).value;
          if (!isEngineSandboxMode(v)) return;
          mode.value = v;
          setEngineSandboxMode(v);
        }}
      >
        {ENGINE_SANDBOX_MODES.map(m => (
          <option value={m} disabled={m === 'origin' && !originAvailable}>
            {SANDBOX_MODE_LABELS[m]}{m === def ? ' (default)' : ''}{m === 'origin' && !originAvailable ? ' (not configured for this site)' : ''}
          </option>
        ))}
      </select>
      <p class="text-[10px] text-zinc-500 leading-snug">
        Runs model code (yours, the AI's, or an imported session's) in a hidden iframe on a separate origin, so it
        can't read this site's saved sessions or AI keys, and its network access is blocked. On by default where this
        site has a sandbox host; "Off" is the kill switch. Reload to apply.
        This tab: <span class="text-zinc-300" data-engine-sandbox-status="">{status.active}
          {status.state === 'unavailable' ? ` — unavailable (${status.unavailableReason})` : ''}
          {status.state === 'bypassed' ? ' — bypassed for this tab' : ''}</span>
        {mode.value !== status.requested && <span class="text-amber-300"> · after reload: {mode.value}</span>}.
        Not reset by "Reset to defaults".
      </p>
    </div>
  );
}

// ─── body ─────────────────────────────────────────────────────────────────────

function AdvancedSettingsBody(props: { cfg: Signal<AppConfig>; onReset: () => void }) {
  const { cfg, onReset } = props;

  const hasAnyOverride = computed(() => {
    const c = cfg.value;
    const d = APP_CONFIG_DEFAULTS;
    return (
      Object.entries(c.ai).some(([k, v]) => v !== (d.ai as Record<string, unknown>)[k]) ||
      Object.entries(c.renderer).some(([k, v]) => v !== (d.renderer as Record<string, unknown>)[k]) ||
      Object.entries(c.import).some(([k, v]) => v !== (d.import as Record<string, unknown>)[k]) ||
      Object.entries(c.ui).some(([k, v]) => v !== (d.ui as Record<string, unknown>)[k])
    );
  });

  function set<S extends keyof AppConfig>(section: S, key: keyof AppConfig[S], value: number | boolean): void {
    const next = cloneConfig(cfg.value);
    (next[section] as Record<string, unknown>)[key as string] = value;
    cfg.value = next;
    saveAppConfig(next);
  }

  const c = cfg.value;

  return (
    <div class="flex flex-col gap-5" data-settings-body="">
      <p class="text-xs text-zinc-400 leading-relaxed">
        Override default numeric constants. Changes take effect immediately unless marked
        <span class="text-zinc-300 font-medium"> (reload)</span>.
        Modified values appear in amber; click <span class="text-zinc-300 font-medium">Reset to defaults</span> to restore all at once.
      </p>

      <Section title="AI — loop">
        <Field cfgKey="ai.maxConsecutiveAutoResumes"
          label="Max consecutive auto-resumes"
          hint="Hard ceiling on nudges with no tool call before the loop stops. Resets on any tool call."
          tooltip="When an AI turn ends without calling 'finish', auto-continue nudges the model to keep going. This cap prevents an infinite loop if the model repeatedly ignores the nudge — it trips after this many consecutive resume attempts with zero tool calls between them. Increase it for complex multi-step tasks that legitimately need many iterations."
          defaultValue={APP_CONFIG_DEFAULTS.ai.maxConsecutiveAutoResumes}
          value={c.ai.maxConsecutiveAutoResumes}
          min={1} max={64} integer
          onChange={v => set('ai', 'maxConsecutiveAutoResumes', v)}
        />
        <Field cfgKey="ai.maxTransientRetries"
          label="Max transient API retries"
          unit="retries"
          hint="How many times a provider call is retried after a transient failure (HTTP 429/5xx, dropped stream) before the turn surfaces a hard error."
          tooltip="Provider servers occasionally return rate-limit (429) or server (5xx) errors, or drop the streaming connection. Rather than tearing the whole agent loop down — which is especially disruptive mid auto-continue — the chat loop retries the same request with exponential backoff up to this many times. These retries do NOT consume the agent's per-turn iteration budget. Set to 0 to disable and fail fast. Note: this value is read from defaults inside the agent Worker, so overriding it only affects the local (WebGPU) provider."
          defaultValue={APP_CONFIG_DEFAULTS.ai.maxTransientRetries}
          value={c.ai.maxTransientRetries}
          min={0} max={10} integer
          onChange={v => set('ai', 'maxTransientRetries', v)}
        />
        <Field cfgKey="ai.transientRetryBaseMs"
          label="Transient retry base backoff"
          unit="ms"
          hint="Base wait between transient-error retries; grows exponentially with jitter."
          tooltip="The first transient-error retry waits up to this long, the second up to 2×, the third up to 4×, and so on (with random jitter), capped by the max backoff below. Larger values are gentler on a struggling server but slow recovery from a brief blip."
          defaultValue={APP_CONFIG_DEFAULTS.ai.transientRetryBaseMs}
          value={c.ai.transientRetryBaseMs}
          min={100} max={30_000} integer
          onChange={v => set('ai', 'transientRetryBaseMs', v)}
        />
        <Field cfgKey="ai.transientRetryMaxMs"
          label="Transient retry max backoff"
          unit="ms"
          hint="Ceiling on a single transient-error backoff wait."
          tooltip="Caps how long any one transient-error retry will wait, so exponential growth can't stall the turn for minutes. The actual wait is a random value up to min(base · 2^(attempt-1), this ceiling)."
          defaultValue={APP_CONFIG_DEFAULTS.ai.transientRetryMaxMs}
          value={c.ai.transientRetryMaxMs}
          min={1_000} max={120_000} integer
          onChange={v => set('ai', 'transientRetryMaxMs', v)}
        />
        <Field cfgKey="ai.slowToolMs"
          label="Slow-tool warning threshold"
          unit="ms"
          hint="Tool calls exceeding this time emit a console warning (does not affect behavior)."
          tooltip="A diagnostic threshold only — no functional impact. When any AI tool call (e.g. runCode, renderViews) takes longer than this, a warning is logged in the browser console. Useful for identifying slow geometry evaluations or render bottlenecks. Raise it to silence warnings for expected slow operations."
          defaultValue={APP_CONFIG_DEFAULTS.ai.slowToolMs}
          value={c.ai.slowToolMs}
          min={50} max={30_000} integer
          onChange={v => set('ai', 'slowToolMs', v)}
        />
        <Field cfgKey="ai.toolCallTimeoutMs"
          label="Tool-call timeout (Worker)"
          unit="ms"
          hint="If a tool call (e.g. a render) hasn't finished within this time, it's cancelled and reported back to the agent as a failed step — the turn keeps going."
          tooltip="The AI agent runs in a background Worker and calls tools (geometry execution, rendering, etc.) on the main thread. If a tool doesn't finish within this timeout — e.g. a very heavy boolean/BREP/SCAD evaluation, or WASM still initializing — the in-flight execution is cancelled and the agent receives an error result for that step, so it can react (simplify, retry) without the chat getting stuck. Increase for very slow machines or genuinely heavy models."
          defaultValue={APP_CONFIG_DEFAULTS.ai.toolCallTimeoutMs}
          value={c.ai.toolCallTimeoutMs}
          min={5_000} max={600_000} integer
          onChange={v => set('ai', 'toolCallTimeoutMs', v)}
        />
        <Field cfgKey="ai.diagnosticsRingSize"
          label="Diagnostics ring-buffer size"
          unit="events"
          hint="Max AI call log entries kept in memory."
          tooltip="The AI Call Log (🩺 button in the AI panel header) stores the last N provider API calls in memory. Each entry includes request timing, token counts, stop reason, and any error details. Older entries are evicted when the buffer is full. Increase to keep more history for diagnosing intermittent issues; decrease to reduce memory use during long sessions."
          defaultValue={APP_CONFIG_DEFAULTS.ai.diagnosticsRingSize}
          value={c.ai.diagnosticsRingSize}
          min={10} max={500} integer
          onChange={v => set('ai', 'diagnosticsRingSize', v)}
        />
        <Field cfgKey="ai.maxAttachments"
          label="Max recent attachments"
          unit="images"
          hint="Images kept in the recent-attachments picker (IndexedDB rows)."
          tooltip="The AI panel's image attachment picker shows recently used images so you can re-attach them without re-uploading. This cap controls how many are persisted in IndexedDB. Older images are evicted when the cap is reached. Increase to keep more images in the picker; decrease to free IndexedDB space on storage-constrained devices."
          defaultValue={APP_CONFIG_DEFAULTS.ai.maxAttachments}
          value={c.ai.maxAttachments}
          min={1} max={100} integer
          onChange={v => set('ai', 'maxAttachments', v)}
        />
        <Field cfgKey="ai.keepRecentToolImages"
          label="Recent render images kept in context"
          unit="images"
          hint="For providers without history caching (Custom, Local, or Anthropic with caching off): how many of the latest render snapshots stay in the request."
          tooltip="renderView / renderViews / runIsolated return PNG snapshots so the agent can see the model. Every snapshot is otherwise re-sent to the provider on every subsequent turn, so a long session's image tokens compound. This keeps only the N most-recent render images in the request (their text stats always stay); older ones are replaced with a short note. The on-screen transcript still shows every image — only the wire request is trimmed. Raise it to give the model more visual memory at higher token cost; set very high to disable trimming. Providers that cache the history use the two stepped limits below instead."
          defaultValue={APP_CONFIG_DEFAULTS.ai.keepRecentToolImages}
          value={c.ai.keepRecentToolImages}
          min={0} max={50} integer
          onChange={v => set('ai', 'keepRecentToolImages', v)}
        />
        <ToggleField cfgKey="ai.cacheConversationHistory"
          label="Cache the conversation history (Anthropic)"
          hint="Every agent step re-sends the whole conversation. With this on, the repeated part is billed at Anthropic's cache-read rate (~10% of normal input) instead of full price. OpenAI and Gemini do this automatically."
          defaultValue={APP_CONFIG_DEFAULTS.ai.cacheConversationHistory}
          value={c.ai.cacheConversationHistory}
          onChange={v => set('ai', 'cacheConversationHistory', v)}
        />
        <Field cfgKey="ai.cachedImageLimit"
          label="Render images before a trim (cached providers)"
          unit="images"
          hint="Anthropic (with caching on), OpenAI and Gemini: render images pile up to this many before older ones are trimmed."
          tooltip="Cached images are cheap to re-send, but trimming one edits an earlier message and makes the provider re-bill everything after it. So instead of dropping one image per render, images accumulate to this limit and are then cut back to the 'trim down to' count in one step, keeping the cached history valid in between."
          defaultValue={APP_CONFIG_DEFAULTS.ai.cachedImageLimit}
          value={c.ai.cachedImageLimit}
          min={1} max={50} integer
          onChange={v => set('ai', 'cachedImageLimit', v)}
        />
        <Field cfgKey="ai.cachedImageTrimTo"
          label="…then trim down to"
          unit="images"
          hint="How many recent render images remain after a trim on cached providers."
          tooltip="When the image limit above is exceeded, older render images are dropped until this many remain. A bigger gap between the two numbers means fewer cache-breaking trims; a smaller one keeps the request leaner. Set it equal to the limit for a one-in-one-out sliding window."
          defaultValue={APP_CONFIG_DEFAULTS.ai.cachedImageTrimTo}
          value={c.ai.cachedImageTrimTo}
          min={1} max={50} integer
          onChange={v => set('ai', 'cachedImageTrimTo', v)}
        />
        <Field cfgKey="ai.autoCompactMaxTokens"
          label="Auto-compact token ceiling"
          unit="tokens"
          hint="In the Auto compaction mode, compact once the conversation passes this size, even if that's under 70% of the model's context window."
          tooltip="On 1M-token models, 70% of the window is ~700k tokens. Long before that, each cache miss (for example after a pause of more than ~5 minutes) re-bills the whole conversation at full price, so a smaller ceiling keeps those moments cheap. Compaction summarizes older turns and keeps recent ones verbatim."
          defaultValue={APP_CONFIG_DEFAULTS.ai.autoCompactMaxTokens}
          value={c.ai.autoCompactMaxTokens}
          min={10_000} max={1_000_000} integer
          onChange={v => set('ai', 'autoCompactMaxTokens', v)}
        />
        <Field cfgKey="ai.compactionKeepImages"
          label="Attached images kept through compaction"
          unit="images"
          hint="Reference images you attached are carried forward when older turns are compacted, instead of being dropped."
          tooltip="Compaction replaces older turns with a text summary. Without this, a photo you attached early on (a 'make it look like this' reference) would disappear from what the model sees. The newest N of your attached images are re-attached just before the summary. The agent's own render screenshots aren't kept — it can re-render. Set 0 to drop attachments like before."
          defaultValue={APP_CONFIG_DEFAULTS.ai.compactionKeepImages}
          value={c.ai.compactionKeepImages}
          min={0} max={12} integer
          onChange={v => set('ai', 'compactionKeepImages', v)}
        />
        <ToggleField cfgKey="ai.pruneStaleToolPayloads"
          label="Trim dead tool payloads from the request"
          hint="Every agent step re-sends the whole conversation. This leaves out code the agent has since replaced, repeated doc reads, and the bulky inputs of failed calls, each replaced with a one-line note (call getCode / readDoc for the current copy). Your transcript is unchanged."
          defaultValue={APP_CONFIG_DEFAULTS.ai.pruneStaleToolPayloads}
          value={c.ai.pruneStaleToolPayloads}
          onChange={v => set('ai', 'pruneStaleToolPayloads', v)}
        />
        <Field cfgKey="ai.keepRecentCodeBodies"
          label="Recent code bodies kept in context"
          unit="copies"
          hint="How many of the newest code arguments (runAndSave, setCode, runCode …) and getCode results stay verbatim; older ones become a short note."
          tooltip="The newest copy is what's in the editor, and the model can always call getCode. Raise this to let the model compare more of its earlier attempts at a higher token cost."
          defaultValue={APP_CONFIG_DEFAULTS.ai.keepRecentCodeBodies}
          value={c.ai.keepRecentCodeBodies}
          min={1} max={50} integer
          onChange={v => set('ai', 'keepRecentCodeBodies', v)}
        />
        <Field cfgKey="ai.codeBodyTrimBatch"
          label="…older code trimmed in batches of"
          unit="copies"
          hint="Older code piles up this far before it's trimmed back in one step, so the provider's cached history (and a local server's prompt cache) stays valid in between. 0 trims every step."
          defaultValue={APP_CONFIG_DEFAULTS.ai.codeBodyTrimBatch}
          value={c.ai.codeBodyTrimBatch}
          min={0} max={50} integer
          onChange={v => set('ai', 'codeBodyTrimBatch', v)}
        />
        <Field cfgKey="ai.failedCallInputTurns"
          label="Drop failed calls' inputs after"
          unit="turns"
          hint="A failed tool call's large inputs are left out once this many newer agent turns have passed. Its error message stays."
          tooltip="A failed run keeps its full code (or point list) in the history, though the model has moved on. After this many newer assistant turns, inputs larger than the size below are replaced with a note; the error text the model learned from is kept."
          defaultValue={APP_CONFIG_DEFAULTS.ai.failedCallInputTurns}
          value={c.ai.failedCallInputTurns}
          min={1} max={50} integer
          onChange={v => set('ai', 'failedCallInputTurns', v)}
        />
        <Field cfgKey="ai.failedCallInputMinChars"
          label="…only inputs larger than"
          unit="chars"
          hint="Failed calls with smaller inputs are kept as they are."
          defaultValue={APP_CONFIG_DEFAULTS.ai.failedCallInputMinChars}
          value={c.ai.failedCallInputMinChars}
          min={100} max={100_000} integer
          onChange={v => set('ai', 'failedCallInputMinChars', v)}
        />
        <Field cfgKey="ai.failedCallValueMinChars"
          label="…and within one, values larger than"
          unit="chars"
          hint="Only a failed call's large arguments (code, point lists) are replaced; short ones like a label or colour stay readable."
          defaultValue={APP_CONFIG_DEFAULTS.ai.failedCallValueMinChars}
          value={c.ai.failedCallValueMinChars}
          min={20} max={100_000} integer
          onChange={v => set('ai', 'failedCallValueMinChars', v)}
        />
        <Field cfgKey="ai.customSlimMaxContext"
          label="Custom endpoint: Slim prompt below"
          unit="tokens"
          hint="With prompt size on Auto, an endpoint whose context window is smaller than this gets the Slim prompt and core tools (~4k tokens)."
          tooltip="Set per endpoint on the Custom tab of AI settings. The window comes from Connect's detection or what you typed there; an unknown window always gets the Full payload."
          defaultValue={APP_CONFIG_DEFAULTS.ai.customSlimMaxContext}
          value={c.ai.customSlimMaxContext}
          min={1024} max={1_000_000} integer
          onChange={v => set('ai', 'customSlimMaxContext', v)}
        />
        <Field cfgKey="ai.customMediumMaxContext"
          label="Custom endpoint: Medium prompt below"
          unit="tokens"
          hint="…and smaller than this, the Medium prompt and everyday tools (~10k tokens). Larger windows get everything (~100k tokens)."
          defaultValue={APP_CONFIG_DEFAULTS.ai.customMediumMaxContext}
          value={c.ai.customMediumMaxContext}
          min={1024} max={10_000_000} integer
          onChange={v => set('ai', 'customMediumMaxContext', v)}
        />
        <Field cfgKey="ai.customToolDescriptionChars"
          label="Custom endpoint: tool description length (Medium/Slim)"
          unit="chars"
          hint="Each tool's description is cut to its first sentence, at most this long."
          defaultValue={APP_CONFIG_DEFAULTS.ai.customToolDescriptionChars}
          value={c.ai.customToolDescriptionChars}
          min={40} max={5000} integer
          onChange={v => set('ai', 'customToolDescriptionChars', v)}
        />
        <Field cfgKey="ai.customParamDescriptionChars"
          label="Custom endpoint: parameter description length (Medium)"
          unit="chars"
          hint="Each parameter's description is cut to its first sentence, at most this long. Slim leaves parameter descriptions out."
          defaultValue={APP_CONFIG_DEFAULTS.ai.customParamDescriptionChars}
          value={c.ai.customParamDescriptionChars}
          min={0} max={2000} integer
          onChange={v => set('ai', 'customParamDescriptionChars', v)}
        />
        <Field cfgKey="ai.customOverflowWarnFraction"
          label="Custom endpoint: warn when the prompt uses more than"
          unit="of the window"
          hint="The Context size settings warn when the chosen prompt size's fixed payload takes more than this fraction of the endpoint's context window (0.8 = 80%)."
          defaultValue={APP_CONFIG_DEFAULTS.ai.customOverflowWarnFraction}
          value={c.ai.customOverflowWarnFraction}
          min={0.1} max={1}
          onChange={v => set('ai', 'customOverflowWarnFraction', v)}
        />
        <Field cfgKey="ai.customContextProbeTimeoutMs"
          label="Custom endpoint: context detection timeout"
          unit="ms"
          hint="How long Connect waits for each server-metadata probe (llama.cpp /props, Ollama /api/ps, LM Studio, /v1/models)."
          defaultValue={APP_CONFIG_DEFAULTS.ai.customContextProbeTimeoutMs}
          value={c.ai.customContextProbeTimeoutMs}
          min={250} max={30_000} integer
          onChange={v => set('ai', 'customContextProbeTimeoutMs', v)}
        />
        <Field cfgKey="ai.reviewReferenceImages"
          label="Reference images sent to reviews"
          hint="How many of your attached images a review (automatic or 👁) sees next to the renders."
          tooltip="A review grades the model against your request. When you attached reference images (a photo, a sketch), the newest N are sent with the renders so the reviewer can compare the result to them. Set 0 to send renders only."
          defaultValue={APP_CONFIG_DEFAULTS.ai.reviewReferenceImages}
          value={c.ai.reviewReferenceImages}
          min={0} max={12} integer
          onChange={v => set('ai', 'reviewReferenceImages', v)}
        />
        <Field cfgKey="ai.reviewConversationMaxChars"
          label="Your messages sent to reviews (chars)"
          hint="How much of what you wrote in this chat a review sees, newest first. The agent's replies are never sent."
          tooltip="So the reviewer grades against every requirement and correction you gave — not only your latest message — your own chat messages are sent with the review (when 'Your messages' is on). Older messages beyond this budget are left out. After a compaction, the agent's summary of the deleted early turns is sent too (labelled as the agent's) when it fits. Set 0 to send none."
          defaultValue={APP_CONFIG_DEFAULTS.ai.reviewConversationMaxChars}
          value={c.ai.reviewConversationMaxChars}
          min={0} max={100000} integer
          onChange={v => set('ai', 'reviewConversationMaxChars', v)}
        />
        <Field cfgKey="ai.reviewNoteMaxChars"
          label="Review note length (chars)"
          hint="How much of a 👁 review is copied into the session note the agent reads on its next turn."
          tooltip="A manual 👁 review is posted to the chat in full and also saved as a [REVIEW from …] session note, which the agent reads via getSessionContext. Longer notes keep every finding; shorter ones save context."
          defaultValue={APP_CONFIG_DEFAULTS.ai.reviewNoteMaxChars}
          value={c.ai.reviewNoteMaxChars}
          min={200} max={8000} integer
          onChange={v => set('ai', 'reviewNoteMaxChars', v)}
        />
      </Section>

      <Section title="AI — geometry timeouts">
        <div class="text-[10px] text-zinc-500 leading-snug">Safety timeouts for background Worker operations that have no Cancel button. Rendering itself is <em>not</em> timed out — a slow run is bounded by the elapsed-time counter and the Cancel button instead.</div>
        <Field cfgKey="ai.geometryTimeoutScadMs"
          label="OpenSCAD timeout"
          unit="ms"
          tooltip="Wall-clock ceiling for OpenSCAD Worker operations that have no Cancel affordance — source validation and include-dependency detection. SCAD compiles BOSL2-style libraries from source on every run, so the 3-minute default gives ample headroom. (The render path itself has no timeout.)"
          defaultValue={APP_CONFIG_DEFAULTS.ai.geometryTimeoutScadMs}
          value={c.ai.geometryTimeoutScadMs}
          min={5_000} max={600_000} integer
          onChange={v => set('ai', 'geometryTimeoutScadMs', v)}
        />
        <Field cfgKey="ai.geometryTimeoutReplicadMs"
          label="BREP/replicad timeout"
          unit="ms"
          tooltip="Wall-clock ceiling for replicad/OpenCASCADE Worker operations that have no Cancel affordance — STEP export/import and BREP-shape cleanup. OCCT operations on complex STEP assemblies can be slow, so increase this if you work with large imported STEP files. (The render path itself has no timeout.)"
          defaultValue={APP_CONFIG_DEFAULTS.ai.geometryTimeoutReplicadMs}
          value={c.ai.geometryTimeoutReplicadMs}
          min={5_000} max={600_000} integer
          onChange={v => set('ai', 'geometryTimeoutReplicadMs', v)}
        />
      </Section>

      <Section title="AI — local model (WebLLM)">
        <div class="text-[10px] text-zinc-500 leading-snug">Token budgets for the in-browser local model. Only used when the Local (WebGPU) provider is active.</div>
        <Field cfgKey="ai.localPromptBudgetMedium"
          label="Prompt budget — medium tier"
          unit="tokens"
          tooltip="The portion of the local model's context window allocated to the system prompt when using a medium-tier model (e.g. Qwen-7B). Larger models can handle more context; reduce this if you're getting truncation errors on a small-context model."
          defaultValue={APP_CONFIG_DEFAULTS.ai.localPromptBudgetMedium}
          value={c.ai.localPromptBudgetMedium}
          min={200} max={4096} integer
          onChange={v => set('ai', 'localPromptBudgetMedium', v)}
        />
        <Field cfgKey="ai.localPromptBudgetSlim"
          label="Prompt budget — slim tier"
          unit="tokens"
          tooltip="The portion of the context window for the system prompt when using a slim/small model. Slim models have tighter context windows, so the budget is lower to leave room for the conversation."
          defaultValue={APP_CONFIG_DEFAULTS.ai.localPromptBudgetSlim}
          value={c.ai.localPromptBudgetSlim}
          min={100} max={2048} integer
          onChange={v => set('ai', 'localPromptBudgetSlim', v)}
        />
        <Field cfgKey="ai.localToolsBudgetNative"
          label="Tool budget — native"
          unit="tokens"
          tooltip="Tokens reserved for tool-call schemas when the model supports native function calling. Native tool schemas are compact JSON — 100 tokens covers the full Partwright tool set."
          defaultValue={APP_CONFIG_DEFAULTS.ai.localToolsBudgetNative}
          value={c.ai.localToolsBudgetNative}
          min={50} max={1000} integer
          onChange={v => set('ai', 'localToolsBudgetNative', v)}
        />
        <Field cfgKey="ai.localToolsBudgetPromptEngineered"
          label="Tool budget — prompt-engineered"
          unit="tokens"
          tooltip="Tokens reserved for tool schemas when they're injected as plain text (for models without native function calling). Prompt-engineering the schema requires more tokens than native calling."
          defaultValue={APP_CONFIG_DEFAULTS.ai.localToolsBudgetPromptEngineered}
          value={c.ai.localToolsBudgetPromptEngineered}
          min={100} max={2000} integer
          onChange={v => set('ai', 'localToolsBudgetPromptEngineered', v)}
        />
        <Field cfgKey="ai.localAttentionSinkMargin"
          label="Attention sink margin"
          unit="tokens"
          tooltip="Safety buffer added when computing the total attention-sink context allocation. Prevents off-by-one overflows when the model's reported context length is approximate."
          defaultValue={APP_CONFIG_DEFAULTS.ai.localAttentionSinkMargin}
          value={c.ai.localAttentionSinkMargin}
          min={50} max={500} integer
          onChange={v => set('ai', 'localAttentionSinkMargin', v)}
        />
        <Field cfgKey="ai.localAttentionSinkMax"
          label="Attention sink max"
          unit="tokens"
          tooltip="Hard cap on the total attention-sink token budget (prompt + tools + margin). Prevents the local model from trying to allocate more context than it can physically handle."
          defaultValue={APP_CONFIG_DEFAULTS.ai.localAttentionSinkMax}
          value={c.ai.localAttentionSinkMax}
          min={512} max={8192} integer
          onChange={v => set('ai', 'localAttentionSinkMax', v)}
        />
      </Section>

      <Section title="AI — thinking budgets">
        <div class="text-[10px] text-zinc-500 leading-snug">Anthropic extended-thinking token budgets (tokens). Only models that take a fixed budget use these (Haiku 4.5, Sonnet/Opus 4.5 and earlier) — newer models (4.6+, Sonnet 5, Opus 5.x, Fable) use adaptive thinking with an effort level, sized by the thinking output ceilings below. Which shape a model takes comes from the model catalog, or is learned from the API. XHigh and Max use the High budget.</div>
        <Field cfgKey="ai.thinkingBudgetAnthropicLow"
          label="Anthropic — Low"
          unit="tokens"
          tooltip="The 'budget_tokens' sent to Anthropic's API when thinking level is set to Low. A higher budget gives the model more space to reason before answering, improving accuracy on complex geometry tasks at the cost of latency and token spend."
          defaultValue={APP_CONFIG_DEFAULTS.ai.thinkingBudgetAnthropicLow}
          value={c.ai.thinkingBudgetAnthropicLow}
          min={1024} max={100_000} integer
          onChange={v => set('ai', 'thinkingBudgetAnthropicLow', v)}
        />
        <Field cfgKey="ai.thinkingBudgetAnthropicMedium"
          label="Anthropic — Medium"
          unit="tokens"
          tooltip="The thinking budget for Anthropic models at Medium thinking level. Suitable for moderately complex CAD tasks — the model can work through multi-step geometry without the cost of High."
          defaultValue={APP_CONFIG_DEFAULTS.ai.thinkingBudgetAnthropicMedium}
          value={c.ai.thinkingBudgetAnthropicMedium}
          min={1024} max={100_000} integer
          onChange={v => set('ai', 'thinkingBudgetAnthropicMedium', v)}
        />
        <Field cfgKey="ai.thinkingBudgetAnthropicHigh"
          label="Anthropic — High"
          unit="tokens"
          tooltip="The thinking budget for Anthropic models at High thinking level. Use for the most complex parametric or BREP tasks. Note that Anthropic requires max_tokens > budget_tokens, so the 'Anthropic answer headroom' field below must also be large enough."
          defaultValue={APP_CONFIG_DEFAULTS.ai.thinkingBudgetAnthropicHigh}
          value={c.ai.thinkingBudgetAnthropicHigh}
          min={1024} max={200_000} integer
          onChange={v => set('ai', 'thinkingBudgetAnthropicHigh', v)}
        />
        <div class="text-[10px] text-zinc-500 leading-snug mt-1">Gemini thinking budgets (tokens).</div>
        <Field cfgKey="ai.thinkingBudgetGeminiLow"
          label="Gemini — Low"
          unit="tokens"
          tooltip="The thinking budget for Gemini models at Low level. Gemini combines reasoning and answer tokens in one ceiling — setting this too high can crowd out the answer."
          defaultValue={APP_CONFIG_DEFAULTS.ai.thinkingBudgetGeminiLow}
          value={c.ai.thinkingBudgetGeminiLow}
          min={1024} max={100_000} integer
          onChange={v => set('ai', 'thinkingBudgetGeminiLow', v)}
        />
        <Field cfgKey="ai.thinkingBudgetGeminiMedium"
          label="Gemini — Medium"
          unit="tokens"
          tooltip="The thinking budget for Gemini at Medium level. See the Gemini max output tokens field — the total output ceiling must be at least this large."
          defaultValue={APP_CONFIG_DEFAULTS.ai.thinkingBudgetGeminiMedium}
          value={c.ai.thinkingBudgetGeminiMedium}
          min={1024} max={100_000} integer
          onChange={v => set('ai', 'thinkingBudgetGeminiMedium', v)}
        />
        <Field cfgKey="ai.thinkingBudgetGeminiHigh"
          label="Gemini — High"
          unit="tokens"
          tooltip="The thinking budget for Gemini at High level. The Gemini max output tokens must exceed this value to avoid 400 errors from the API."
          defaultValue={APP_CONFIG_DEFAULTS.ai.thinkingBudgetGeminiHigh}
          value={c.ai.thinkingBudgetGeminiHigh}
          min={1024} max={200_000} integer
          onChange={v => set('ai', 'thinkingBudgetGeminiHigh', v)}
        />
        <Field cfgKey="ai.answerHeadroomTokens"
          label="Anthropic answer headroom"
          unit="tokens"
          hint="Output token headroom above the thinking budget (API requires max_tokens > budget)."
          tooltip="Anthropic's API requires that max_tokens > budget_tokens. This value is added on top of the active thinking budget to set max_tokens. If you raise a thinking budget above the current Anthropic max output tokens limit, raise this headroom too to avoid API 400 errors."
          defaultValue={APP_CONFIG_DEFAULTS.ai.answerHeadroomTokens}
          value={c.ai.answerHeadroomTokens}
          min={1024} max={50_000} integer
          onChange={v => set('ai', 'answerHeadroomTokens', v)}
        />
      </Section>

      <Section title="AI — output tokens">
        <Field cfgKey="ai.maxOutputTokensAnthropic"
          label="Anthropic max output tokens"
          unit="tokens"
          tooltip="The max_tokens value sent to Anthropic on turns without adaptive thinking — the ceiling on one response, including any budgeted thinking tokens. Output is billed by what the model actually generates, not by this cap, so it guards against runaway responses rather than setting a budget. It's raised automatically above a thinking budget, and every Anthropic ceiling is capped at the model's own output limit."
          defaultValue={APP_CONFIG_DEFAULTS.ai.maxOutputTokensAnthropic}
          value={c.ai.maxOutputTokensAnthropic}
          min={1024} max={200_000} integer
          onChange={v => set('ai', 'maxOutputTokensAnthropic', v)}
        />
        <Field cfgKey="ai.maxOutputTokensAnthropicThinking"
          label="Anthropic max output tokens (thinking)"
          unit="tokens"
          tooltip="The max_tokens value sent to Anthropic when a Claude 4.6+ model runs adaptive thinking (any Thinking level above Off, or a model that always thinks). Thinking tokens count against this ceiling and adaptive thinking has no separate budget, so it must be large — too low and high-effort turns stop mid-thought. Output is billed by what the model actually generates, not by this cap."
          defaultValue={APP_CONFIG_DEFAULTS.ai.maxOutputTokensAnthropicThinking}
          value={c.ai.maxOutputTokensAnthropicThinking}
          min={4096} max={64_000} integer
          onChange={v => set('ai', 'maxOutputTokensAnthropicThinking', v)}
        />
        <Field cfgKey="ai.maxOutputTokensAnthropicThinkingDeep"
          label="Anthropic max output tokens (XHigh / Max thinking)"
          unit="tokens"
          tooltip="The max_tokens value for adaptive-thinking turns at the XHigh or Max Thinking level, which think the longest — too low and a deep turn stops mid-thought with max_tokens. Every Claude 4.6+ model accepts at least 64k (Sonnet 4.6's cap), so higher values can error on some models. Output is billed by what the model actually generates, not by this cap."
          defaultValue={APP_CONFIG_DEFAULTS.ai.maxOutputTokensAnthropicThinkingDeep}
          value={c.ai.maxOutputTokensAnthropicThinkingDeep}
          min={4096} max={128_000} integer
          onChange={v => set('ai', 'maxOutputTokensAnthropicThinkingDeep', v)}
        />
        <Field cfgKey="ai.maxOutputTokensOpenai"
          label="OpenAI max output tokens"
          unit="tokens"
          tooltip="The max_output_tokens (Responses API) or max_tokens (Chat Completions) value sent to OpenAI. Reasoning models (o1/o3/o4/gpt-5) route to the Responses API; all others use Chat Completions — this cap applies to both. Increase for very long code generation turns."
          defaultValue={APP_CONFIG_DEFAULTS.ai.maxOutputTokensOpenai}
          value={c.ai.maxOutputTokensOpenai}
          min={1024} max={200_000} integer
          onChange={v => set('ai', 'maxOutputTokensOpenai', v)}
        />
        <Field cfgKey="ai.maxOutputTokensGemini"
          label="Gemini max output tokens"
          unit="tokens"
          hint="Combined ceiling for reasoning + answer on thinking models."
          tooltip="The maxOutputTokens value for Gemini. For thinking-enabled models this is a shared ceiling for both reasoning tokens and the answer — if the thinking budget is close to this value, the model may not have room to output a response. Keep this well above your highest Gemini thinking budget."
          defaultValue={APP_CONFIG_DEFAULTS.ai.maxOutputTokensGemini}
          value={c.ai.maxOutputTokensGemini}
          min={1024} max={500_000} integer
          onChange={v => set('ai', 'maxOutputTokensGemini', v)}
        />
        <Field cfgKey="ai.charsPerToken"
          label="Chars-per-token estimate"
          unit="chars"
          hint="Rough ratio used for token-count estimation in the context meter."
          tooltip="The context-meter bar in the AI panel estimates token counts by dividing character counts by this ratio. It's a heuristic — actual tokenization varies by model and language. English prose averages ~4 chars/token; code with many symbols may be closer to 3. Adjust if the meter consistently over- or under-estimates."
          defaultValue={APP_CONFIG_DEFAULTS.ai.charsPerToken}
          value={c.ai.charsPerToken}
          min={1} max={20}
          onChange={v => set('ai', 'charsPerToken', v)}
        />
        <Field cfgKey="ai.imageTokenEstimate"
          label="Image token estimate"
          unit="tokens"
          hint="Estimated tokens per attached image block (used in the context meter)."
          tooltip="A flat per-image token estimate used by the context meter. Vision models process images at varying resolutions — the actual token cost depends on image size and provider. Anthropic charges ~1600 tokens for a standard image; Gemini varies by resolution. Adjust if the meter is clearly off for your typical attachments."
          defaultValue={APP_CONFIG_DEFAULTS.ai.imageTokenEstimate}
          value={c.ai.imageTokenEstimate}
          min={100} max={10_000} integer
          onChange={v => set('ai', 'imageTokenEstimate', v)}
        />
      </Section>

      <Section title="Rendering (reload to apply)">
        <Field cfgKey="renderer.fov"
          label="Camera field-of-view"
          unit="°"
          tooltip="The vertical field of view for the Three.js perspective camera. A narrower FOV (e.g. 30°) produces an orthographic-like projection good for inspecting flat faces; a wider FOV (e.g. 75°) gives a more immersive perspective. Takes effect after a page reload."
          defaultValue={APP_CONFIG_DEFAULTS.renderer.fov}
          value={c.renderer.fov}
          min={10} max={120} integer
          onChange={v => set('renderer', 'fov', v)}
        />
        <Field cfgKey="renderer.maxPixelRatio"
          label="Max device pixel ratio"
          hint="Cap on devicePixelRatio. Lower = less GPU work; higher = sharper on HiDPI screens."
          tooltip="On Retina/HiDPI screens the browser's devicePixelRatio can be 2–3×, meaning the renderer draws 4–9× as many pixels. This cap limits the ratio to save GPU work. At 1.0 you get 1:1 pixel mapping (fastest); at 2.0 you get full Retina sharpness. Takes effect after a page reload."
          defaultValue={APP_CONFIG_DEFAULTS.renderer.maxPixelRatio}
          value={c.renderer.maxPixelRatio}
          min={0.5} max={4} step={0.5}
          onChange={v => set('renderer', 'maxPixelRatio', v)}
        />
        <Field cfgKey="renderer.interactionRenderScale"
          label="Interaction render scale"
          hint="Render resolution fraction during orbit/pan/zoom (0–1, lower = faster)."
          tooltip="While you're actively orbiting, panning, or zooming, the viewport renders at this fraction of its full resolution to keep the frame rate smooth. At 0.6 (the default) each dimension is 60% of full resolution — 36% of total pixels. It snaps back to full resolution when you stop moving. Lower this on slow GPUs; raise it if you don't notice quality differences during orbit."
          defaultValue={APP_CONFIG_DEFAULTS.renderer.interactionRenderScale}
          value={c.renderer.interactionRenderScale}
          min={0.1} max={1} step={0.05}
          onChange={v => set('renderer', 'interactionRenderScale', v)}
        />
        <Field cfgKey="renderer.isolateGhostOpacity"
          label="Isolate ghost opacity"
          hint="How visible the rest of the object stays when one part is isolated (0–1)."
          tooltip="Isolating a part from the Objects list (◐ Isolate) draws that part solid and the rest of the object as a translucent ghost — a part fused into a solid can't be hidden on its own. This is the ghost's opacity: lower makes the rest fainter, higher keeps more context. Takes effect the next time you isolate."
          defaultValue={APP_CONFIG_DEFAULTS.renderer.isolateGhostOpacity}
          value={c.renderer.isolateGhostOpacity}
          min={0} max={0.9} step={0.05}
          onChange={v => set('renderer', 'isolateGhostOpacity', v)}
        />
        <Field cfgKey="renderer.creaseEdgeMaxTriangles"
          label="Crease edges up to"
          unit="triangles"
          hint="Thumbnails and rendered views skip crease edges on meshes denser than this."
          tooltip="Version thumbnails and renderViews outline a model's sharp edges (creases). Finding them scans every edge on the main thread, which froze the app for seconds after importing a dense scan — and at that density the lines are noise anyway. Above this many triangles the outline is skipped. 0 = never draw crease edges."
          defaultValue={APP_CONFIG_DEFAULTS.renderer.creaseEdgeMaxTriangles}
          value={c.renderer.creaseEdgeMaxTriangles}
          min={0} max={50_000_000} step={50_000} integer
          onChange={v => set('renderer', 'creaseEdgeMaxTriangles', v)}
        />
        <Field cfgKey="renderer.lazyManifoldMinTriangles"
          label="Defer solid rebuild from"
          unit="triangles"
          hint="Big models skip rebuilding the solid after each run until a slice or boolean needs it."
          tooltip="After every run the editor rebuilds a solid (Manifold) copy of the model for slicing, measuring and booleans. On a multi-million-triangle import that rebuild froze the app for seconds. From this many triangles, the engine computes the model's stats itself and the rebuild waits until a tool actually needs the solid. Deferred models skip the stats' automatic quartile cross-sections (meshes over 250k triangles skip them anyway). 0 = always defer."
          defaultValue={APP_CONFIG_DEFAULTS.renderer.lazyManifoldMinTriangles}
          value={c.renderer.lazyManifoldMinTriangles}
          min={0} max={50_000_000} step={50_000} integer
          onChange={v => set('renderer', 'lazyManifoldMinTriangles', v)}
        />
        <Field cfgKey="renderer.thumbnailMaxTriangles"
          label="Thumbnail detail up to"
          unit="triangles"
          hint="Version thumbnails of bigger meshes are drawn from a simplified copy."
          tooltip="A version thumbnail is a small image. Drawing a multi-million-triangle mesh into one uploads it to the GPU a second time and rasterizes detail no pixel can show, which stalled the app for seconds after a big import. Above this many triangles the thumbnail is drawn from a simplified copy of about this size (the model itself, and rendered views like renderViews, are untouched). 0 = always draw the full mesh."
          defaultValue={APP_CONFIG_DEFAULTS.renderer.thumbnailMaxTriangles}
          value={c.renderer.thumbnailMaxTriangles}
          min={0} max={50_000_000} step={50_000} integer
          onChange={v => set('renderer', 'thumbnailMaxTriangles', v)}
        />
        <Field cfgKey="renderer.containmentSamples"
          label="Enclosed-piece samples"
          hint="Points tested per piece when checking big models for pieces sealed inside others."
          tooltip="For big models the engine checks whether a separate piece sits entirely inside another (an internal part, a sealed cavity) by testing a few points of it. Enclosed pieces don't trigger the floating-part warning. More points catch odd shapes that poke out between samples, at a small cost in speed."
          defaultValue={APP_CONFIG_DEFAULTS.renderer.containmentSamples}
          value={c.renderer.containmentSamples}
          min={1} max={256} integer
          onChange={v => set('renderer', 'containmentSamples', v)}
        />
        <Field cfgKey="renderer.modelLogMaxLines"
          label="Model log lines"
          hint="console.log lines from model code kept per run."
          tooltip="Model code's console.log / warn / error output is captured and returned as `logs` by run and runAndSave (and the AI's runCode tool), so an agent can debug without throwing errors. Lines past this limit are counted, not kept."
          defaultValue={APP_CONFIG_DEFAULTS.renderer.modelLogMaxLines}
          value={c.renderer.modelLogMaxLines}
          min={0} max={10_000} integer
          onChange={v => set('renderer', 'modelLogMaxLines', v)}
        />
        <Field cfgKey="renderer.modelLogMaxChars"
          label="Model log characters"
          hint="Characters of model-code console output kept per run."
          tooltip="Caps the total size of the captured console output of one run, so a log in a loop can't flood the result an agent reads."
          defaultValue={APP_CONFIG_DEFAULTS.renderer.modelLogMaxChars}
          value={c.renderer.modelLogMaxChars}
          min={0} max={1_000_000} step={1000} integer
          onChange={v => set('renderer', 'modelLogMaxChars', v)}
        />
        <Field cfgKey="renderer.gridRoomFactor"
          label="Grid room factor"
          unit="× model"
          tooltip="How far the ground grid extends, as a multiple of the model's largest dimension. The grid now scales with the model — spanning the studio 'room' around it — instead of being a fixed-size patch, so it stays useful from tiny parts to large models. Higher = a bigger grid around the model. Takes effect on the next render or 'Reset view'."
          defaultValue={APP_CONFIG_DEFAULTS.renderer.gridRoomFactor}
          value={c.renderer.gridRoomFactor}
          min={1} max={40} step={0.5}
          onChange={v => set('renderer', 'gridRoomFactor', v)}
        />
        <Field cfgKey="renderer.gridDivisions"
          label="Grid divisions"
          tooltip="The number of cells the grid is divided into across its full width. Since the grid scales to the model, this sets cell density (more divisions = finer cells). Takes effect after a page reload."
          defaultValue={APP_CONFIG_DEFAULTS.renderer.gridDivisions}
          value={c.renderer.gridDivisions}
          min={2} max={200} integer
          onChange={v => set('renderer', 'gridDivisions', v)}
        />
        <Field cfgKey="renderer.assemblyPoolSize"
          label="Assembly build workers"
          hint="Objects the Assembly (all-objects) view builds in parallel. Clamped to CPU cores − 1."
          tooltip="The Assembly view meshes every object of a session at once. Each parallel worker boots its own manifold-3d WASM instance, so this trades memory for grid fill speed. 1 serializes the builds (still fills progressively). Clamped at runtime to your CPU core count minus one."
          defaultValue={APP_CONFIG_DEFAULTS.renderer.assemblyPoolSize}
          value={c.renderer.assemblyPoolSize}
          min={1} max={16} integer
          onChange={v => set('renderer', 'assemblyPoolSize', v)}
        />
        <Field cfgKey="renderer.exportPoolSize"
          label="Export build workers"
          hint="Objects a multi-object export bakes in parallel. Clamped to CPU cores − 1 and the object count."
          tooltip="A multi-object export (3MF / OBJ / STL / GLB) re-runs each object's code to bake its mesh. Baking them in parallel across several geometry workers cuts the wall-clock time for large assemblies. Each worker boots its own manifold-3d WASM instance, so this trades memory for speed. 1 bakes objects one at a time. Clamped at runtime to your CPU core count minus one and to the number of objects you're exporting."
          defaultValue={APP_CONFIG_DEFAULTS.renderer.exportPoolSize}
          value={c.renderer.exportPoolSize}
          min={1} max={16} integer
          onChange={v => set('renderer', 'exportPoolSize', v)}
        />
        <Field cfgKey="renderer.exportMaxSplitItems"
          label="Export split limit"
          hint="Most pieces or parts one object can split into when exporting."
          tooltip="The export picker can split one object into its separate pieces (connected solids) or its labelled parts, so each lands as its own object in the file. An object with more pieces or parts than this offers only Whole: thousands of loose shells aren't worth spreading over build plates."
          defaultValue={APP_CONFIG_DEFAULTS.renderer.exportMaxSplitItems}
          value={c.renderer.exportMaxSplitItems}
          min={2} max={5000} integer
          onChange={v => set('renderer', 'exportMaxSplitItems', v)}
        />
        <Field cfgKey="renderer.assemblyGridGutter"
          label="Assembly grid gutter"
          unit="× cell"
          hint="Spacing between objects in the Assembly grid, as a fraction of the largest object."
          tooltip="How much empty space sits between cells in the all-objects grid, as a fraction of the largest object's footprint. 0.25 leaves a quarter-cell gap; 0 packs objects edge to edge."
          defaultValue={APP_CONFIG_DEFAULTS.renderer.assemblyGridGutter}
          value={c.renderer.assemblyGridGutter}
          min={0} max={2} step={0.05}
          onChange={v => set('renderer', 'assemblyGridGutter', v)}
        />
        <Field cfgKey="renderer.ambientLightIntensity"
          label="Ambient light intensity"
          tooltip="The intensity of the omnidirectional ambient light in the viewport. Ambient light illuminates all surfaces equally regardless of normal direction — raising it reduces harsh shadows. Combined with the directional lights, the total scene illumination is ambient + primary + secondary. Takes effect after a page reload."
          defaultValue={APP_CONFIG_DEFAULTS.renderer.ambientLightIntensity}
          value={c.renderer.ambientLightIntensity}
          min={0} max={3} step={0.05}
          onChange={v => set('renderer', 'ambientLightIntensity', v)}
        />
        <Field cfgKey="renderer.primaryLightIntensity"
          label="Primary light intensity"
          tooltip="The intensity of the main directional light. This is the dominant light source that creates highlights and defines the model's primary shading. Raising it increases contrast; lowering it flattens the look. Takes effect after a page reload."
          defaultValue={APP_CONFIG_DEFAULTS.renderer.primaryLightIntensity}
          value={c.renderer.primaryLightIntensity}
          min={0} max={3} step={0.05}
          onChange={v => set('renderer', 'primaryLightIntensity', v)}
        />
        <Field cfgKey="renderer.secondaryLightIntensity"
          label="Secondary light intensity"
          tooltip="The intensity of the secondary fill directional light, positioned on the opposite side from the primary. It softens harsh shadows cast by the primary light. Raising it produces a more evenly-lit appearance; setting it to 0 gives hard one-sided lighting. Takes effect after a page reload."
          defaultValue={APP_CONFIG_DEFAULTS.renderer.secondaryLightIntensity}
          value={c.renderer.secondaryLightIntensity}
          min={0} max={2} step={0.05}
          onChange={v => set('renderer', 'secondaryLightIntensity', v)}
        />
        <Field cfgKey="renderer.orbitDampingFactor"
          label="Orbit damping factor"
          tooltip="The inertia factor for OrbitControls. At 0 the camera stops instantly when you release the mouse; higher values (up to 1) add a momentum effect that coasts to a stop. The default 0.1 gives a slight coast. Takes effect after a page reload."
          defaultValue={APP_CONFIG_DEFAULTS.renderer.orbitDampingFactor}
          value={c.renderer.orbitDampingFactor}
          min={0} max={0.9} step={0.05}
          onChange={v => set('renderer', 'orbitDampingFactor', v)}
        />
        <Field cfgKey="renderer.orbitDampingReferenceFps"
          label="Orbit damping reference fps"
          tooltip="The frame rate the orbit damping factor is tuned for. The coast is re-derived from the real frame delta so it decays at a constant rate per second — without this, a heavy mesh that drops the frame rate makes the same drag coast for far longer and the model lags behind the cursor (sluggish, slow rotation). Leave at 60 unless you target a different refresh rate."
          defaultValue={APP_CONFIG_DEFAULTS.renderer.orbitDampingReferenceFps}
          value={c.renderer.orbitDampingReferenceFps}
          min={30} max={240} step={5}
          onChange={v => set('renderer', 'orbitDampingReferenceFps', v)}
        />
        <Field cfgKey="renderer.maxZoomOutFactor"
          label="Max zoom-out factor"
          tooltip="How far you can zoom the camera out, as a multiple of the model's largest dimension. The default framing sits at roughly 2× that dimension, so a value of 12 lets you pull back about 6× from the default before hitting the limit. Lower it to keep the model filling more of the view; raise it for more room. Re-applied each time the model is framed."
          defaultValue={APP_CONFIG_DEFAULTS.renderer.maxZoomOutFactor}
          value={c.renderer.maxZoomOutFactor}
          min={3} max={100} step={1}
          onChange={v => set('renderer', 'maxZoomOutFactor', v)}
        />
        <Field cfgKey="renderer.defaultFrameFactor"
          label="Default zoom (framing)"
          tooltip="How zoomed-out the default view is, as a multiple of the model's largest dimension along each axis (view distance ≈ factor × 1.7 × that dimension). Higher leaves more margin around the model; lower fills more of the viewport. Applied on every fresh render and when you click Reset view."
          defaultValue={APP_CONFIG_DEFAULTS.renderer.defaultFrameFactor}
          value={c.renderer.defaultFrameFactor}
          min={1} max={3} step={0.1}
          onChange={v => set('renderer', 'defaultFrameFactor', v)}
        />
        <Field cfgKey="renderer.gizmoSizePx"
          label="Orientation gizmo size"
          unit="px"
          tooltip="The canvas size in CSS pixels of the orientation gizmo (the XYZ cube in the viewport corner). Larger makes the axis labels easier to read; smaller keeps it out of the way. Takes effect after a page reload."
          defaultValue={APP_CONFIG_DEFAULTS.renderer.gizmoSizePx}
          value={c.renderer.gizmoSizePx}
          min={48} max={256} integer
          onChange={v => set('renderer', 'gizmoSizePx', v)}
        />
        <Field cfgKey="renderer.gizmoMarginPx"
          label="Orientation gizmo margin"
          unit="px"
          tooltip="Distance in CSS pixels from the viewport corner to the gizmo. Increase if the gizmo overlaps toolbar buttons; decrease to tuck it closer to the edge. Takes effect after a page reload."
          defaultValue={APP_CONFIG_DEFAULTS.renderer.gizmoMarginPx}
          value={c.renderer.gizmoMarginPx}
          min={0} max={32} integer
          onChange={v => set('renderer', 'gizmoMarginPx', v)}
        />
        <Field cfgKey="renderer.gizmoHitRadius"
          label="Gizmo hit radius"
          tooltip="How close (in gizmo orthographic units, range 0–2) your click must land to an axis label to trigger a snap. A larger radius makes the labels easier to click; a smaller radius requires more precision. Takes effect after a page reload."
          defaultValue={APP_CONFIG_DEFAULTS.renderer.gizmoHitRadius}
          value={c.renderer.gizmoHitRadius}
          min={0.1} max={1} step={0.05}
          onChange={v => set('renderer', 'gizmoHitRadius', v)}
        />
        <Field cfgKey="renderer.gizmoSnapDurationSec"
          label="Gizmo snap duration"
          unit="s"
          tooltip="How long (in seconds) the animated snap-to-face transition takes when you click a gizmo axis label. Lower is snappier; higher is smoother. Takes effect after a page reload."
          defaultValue={APP_CONFIG_DEFAULTS.renderer.gizmoSnapDurationSec}
          value={c.renderer.gizmoSnapDurationSec}
          min={0.05} max={2} step={0.05}
          onChange={v => set('renderer', 'gizmoSnapDurationSec', v)}
        />
        <Field cfgKey="renderer.offscreenIdleDisposeMs"
          label="Offscreen renderer idle timeout"
          unit="ms"
          tooltip="The multi-view render panel (used for AI snapshots) keeps its WebGL renderer alive after a render in case another is requested soon. If no render is requested within this window, it disposes the WebGL context and canvas to free GPU memory. Lower this if you're memory-constrained; raise it if multi-view renders feel slow to start. Takes effect without reload."
          defaultValue={APP_CONFIG_DEFAULTS.renderer.offscreenIdleDisposeMs}
          value={c.renderer.offscreenIdleDisposeMs}
          min={1_000} max={300_000} integer
          onChange={v => set('renderer', 'offscreenIdleDisposeMs', v)}
        />
        <Field cfgKey="renderer.pointerGraceMs"
          label="Pointer grace period"
          unit="ms"
          tooltip="How long after your last pointer movement the viewport continues rendering every frame (instead of only on demand). A longer grace period keeps the frame rate smooth during fast mouse movements; a shorter one conserves GPU time when you stop. Takes effect without reload."
          defaultValue={APP_CONFIG_DEFAULTS.renderer.pointerGraceMs}
          value={c.renderer.pointerGraceMs}
          min={50} max={2_000} integer
          onChange={v => set('renderer', 'pointerGraceMs', v)}
        />
        <Field cfgKey="renderer.thumbnailTimeoutMs"
          label="Thumbnail generation timeout"
          unit="ms"
          tooltip="How long to wait for the browser to encode a version thumbnail in the background before encoding it directly instead (a brief pause, but the thumbnail is never lost). After a very large import the background encode can be held up for seconds."
          defaultValue={APP_CONFIG_DEFAULTS.renderer.thumbnailTimeoutMs}
          value={c.renderer.thumbnailTimeoutMs}
          min={500} max={30_000} integer
          onChange={v => set('renderer', 'thumbnailTimeoutMs', v)}
        />
        <Field cfgKey="renderer.enhanceWarnTriangles"
          label="Enhance warn triangles"
          unit="tris"
          tooltip="When the Quality panel's Apply projects an enhance result above this triangle count, it asks for a Proceed/Cancel confirmation first — a model this dense is slow to display and edit."
          defaultValue={APP_CONFIG_DEFAULTS.renderer.enhanceWarnTriangles}
          value={c.renderer.enhanceWarnTriangles}
          min={10_000} max={50_000_000} integer
          onChange={v => set('renderer', 'enhanceWarnTriangles', v)}
        />
        <Field cfgKey="renderer.enhanceMaxTriangles"
          label="Enhance max triangles"
          unit="tris"
          tooltip="Hard ceiling on an enhance result. The geometry worker refuses to return a refined mesh larger than this, and Apply won't run a target above it — prevents a runaway refine from freezing the page when the giant result is committed to the viewport."
          defaultValue={APP_CONFIG_DEFAULTS.renderer.enhanceMaxTriangles}
          value={c.renderer.enhanceMaxTriangles}
          min={100_000} max={100_000_000} integer
          onChange={v => set('renderer', 'enhanceMaxTriangles', v)}
        />
        <Field cfgKey="renderer.surfaceTexturePersistMaxTriangles"
          label="Persist surface textures up to"
          unit="tris"
          tooltip="Computed api.surface.* textures are saved with the version so reopening the session renders them instantly. Above this triangle count the texture is not persisted (the version still saves; reopening just recomputes the texture on demand). A textured mesh costs roughly 18 bytes per triangle of storage."
          defaultValue={APP_CONFIG_DEFAULTS.renderer.surfaceTexturePersistMaxTriangles}
          value={c.renderer.surfaceTexturePersistMaxTriangles}
          min={0} max={20_000_000} integer
          onChange={v => set('renderer', 'surfaceTexturePersistMaxTriangles', v)}
        />
        <Field cfgKey="renderer.storedArrayBlobMinKB"
          label="Store big arrays as files from"
          unit="KB"
          hint="Mesh data at least this big is saved as a Blob, so saving and opening big versions doesn't freeze the app."
          tooltip="A saved version's mesh arrays (an imported model's vertices and triangles, a persisted texture, detected parts) are copied on the main thread when written to or read from browser storage as plain arrays — about half a second for a 3.7M-triangle import. Arrays at least this big are stored as Blobs instead, which the browser writes and reads in the background. 0 stores every array as a Blob. Versions saved either way load the same."
          defaultValue={APP_CONFIG_DEFAULTS.renderer.storedArrayBlobMinKB}
          value={c.renderer.storedArrayBlobMinKB}
          min={0} max={1_048_576} integer
          onChange={v => set('renderer', 'storedArrayBlobMinKB', v)}
        />
        <Field cfgKey="renderer.paintRefinePersistMaxTriangles"
          label="Cache smooth-paint mesh up to"
          unit="tris"
          tooltip="Smooth paint (brush strokes, smooth slabs/boxes/cylinders, smooth patterns) subdivides the mesh under its edges. That refined mesh is cached locally in this browser (never in exports or share links) so reopening a painted version skips rebuilding every smooth edge. Above this triangle count it is not cached (reopening rebuilds the edges, which can take a while). 0 = never cache. Costs roughly 20 bytes per triangle."
          defaultValue={APP_CONFIG_DEFAULTS.renderer.paintRefinePersistMaxTriangles}
          value={c.renderer.paintRefinePersistMaxTriangles}
          min={0} max={20_000_000} integer
          onChange={v => set('renderer', 'paintRefinePersistMaxTriangles', v)}
        />
        <Field cfgKey="renderer.paintRefineCacheMaxMB"
          label="Smooth-paint mesh cache size"
          unit="MB"
          tooltip="Total size of the local smooth-paint mesh cache. When it is full, the least recently used meshes are dropped (their versions just rebuild their smooth edges on the next open)."
          defaultValue={APP_CONFIG_DEFAULTS.renderer.paintRefineCacheMaxMB}
          value={c.renderer.paintRefineCacheMaxMB}
          min={0} max={4096} integer
          onChange={v => set('renderer', 'paintRefineCacheMaxMB', v)}
        />
        <Field cfgKey="renderer.paintRefineCacheTouchMinutes"
          label="Smooth-paint cache touch interval"
          unit="min"
          tooltip="Reopening a cached version marks its mesh as recently used at most this often (marking rewrites the entry). Lower = more precise least-recently-used eviction, more writes."
          defaultValue={APP_CONFIG_DEFAULTS.renderer.paintRefineCacheTouchMinutes}
          value={c.renderer.paintRefineCacheTouchMinutes}
          min={0} max={10_080} integer
          onChange={v => set('renderer', 'paintRefineCacheTouchMinutes', v)}
        />
        <Field cfgKey="renderer.probePixelsMaxPixels"
          label="probePixels batch limit"
          unit="px"
          tooltip="The most pixels one partwright.probePixels call may cast a ray through. Each pixel is one ray against the model."
          defaultValue={APP_CONFIG_DEFAULTS.renderer.probePixelsMaxPixels}
          value={c.renderer.probePixelsMaxPixels}
          min={1} max={100_000} integer
          onChange={v => set('renderer', 'probePixelsMaxPixels', v)}
        />
        <Field cfgKey="renderer.sdfPreviewScale"
          label="SDF fast-preview coarsening"
          unit="×"
          hint="Higher = faster but rougher preview. Set to 1 to disable the preview pass."
          tooltip="SDF models (figures) render in two passes: a fast, coarse preview shown immediately, then the full-quality mesh that replaces it. This is how much coarser the preview march is than the model's real edgeLength — at 2.5× a figure that takes 20-40s roughs out in ~1-2s. The preview also skips fine detail regions (faces, hands). Set to 1 or below to turn the preview off and always render at full quality directly."
          defaultValue={APP_CONFIG_DEFAULTS.renderer.sdfPreviewScale}
          value={c.renderer.sdfPreviewScale}
          min={1} max={6} step={0.5}
          onChange={v => set('renderer', 'sdfPreviewScale', v)}
        />
      </Section>

      <Section title="Import">
        <Field cfgKey="import.stlWeldTolerance"
          label="STL weld tolerance"
          unit="units"
          hint="Initial vertex-merge threshold for STL imports. Larger = more aggressive welding."
          tooltip="STL files store triangles as disconnected vertex triplets — adjacent triangles share edge vertices by value, not by reference. The weld step merges vertices within this distance to create a proper manifold mesh. Too small: gaps remain and boolean operations fail. Too large: nearby-but-intentionally-separate vertices merge, distorting the geometry. The default 1e-5 works for most models; very small-scale precision models may need 1e-6 or smaller."
          defaultValue={APP_CONFIG_DEFAULTS.import.stlWeldTolerance}
          value={c.import.stlWeldTolerance}
          min={1e-8} max={0.1} step={1e-6}
          onChange={v => set('import', 'stlWeldTolerance', v)}
        />
        <Field cfgKey="import.threeMfMaxTriangles"
          label="3MF max triangles"
          unit="tris"
          hint="Largest mesh a 3MF import may expand to before it's refused."
          tooltip="3MF files can reference the same object many times (instances and nested components), so a small file can describe an enormous mesh. Imports that would expand past this many triangles are rejected with an error instead of freezing the tab."
          defaultValue={APP_CONFIG_DEFAULTS.import.threeMfMaxTriangles}
          value={c.import.threeMfMaxTriangles}
          min={10_000} max={200_000_000} integer
          onChange={v => set('import', 'threeMfMaxTriangles', v)}
        />
        <Field cfgKey="import.threeMfMaxEntryMB"
          label="3MF max part size"
          unit="MB"
          hint="Largest decompressed file allowed inside a 3MF package."
          tooltip="A 3MF is a ZIP archive. This caps how large any single file inside it may decompress to, so a maliciously compressed archive (a zip bomb) can't exhaust memory. Real model files are rarely above a few hundred MB."
          defaultValue={APP_CONFIG_DEFAULTS.import.threeMfMaxEntryMB}
          value={c.import.threeMfMaxEntryMB}
          min={16} max={8192} integer
          onChange={v => set('import', 'threeMfMaxEntryMB', v)}
        />
        <Field cfgKey="import.threeMfMaxColors"
          label="3MF max colours"
          unit="colours"
          hint="3MF files with more distinct colours import as mesh only."
          tooltip="Slicer projects carry a handful of filament colours, but per-triangle-coloured scans can carry thousands. Each colour becomes a paint region, so beyond this many the import keeps the mesh and skips colour (with a notice) rather than creating thousands of regions."
          defaultValue={APP_CONFIG_DEFAULTS.import.threeMfMaxColors}
          value={c.import.threeMfMaxColors}
          min={1} max={4096} integer
          onChange={v => set('import', 'threeMfMaxColors', v)}
        />
        <Field cfgKey="import.maxSplitObjects"
          label="Max objects per split import"
          unit="objects"
          hint="Most objects a 3MF or STL import may be split into."
          tooltip="A multi-object 3MF can import one object per 3MF object or per plate, and a multi-piece STL can be split into one object per piece. Each becomes its own object with a saved version, so very large splits take a while; past this many the split option is unavailable and the file imports as one object."
          defaultValue={APP_CONFIG_DEFAULTS.import.maxSplitObjects}
          value={c.import.maxSplitObjects}
          min={2} max={1000} integer
          onChange={v => set('import', 'maxSplitObjects', v)}
        />
        <Field cfgKey="import.maxImportFiles"
          label="Max files per import"
          unit="files"
          hint="Most STL / 3MF files you can import at once."
          tooltip="Choosing or dropping several STL and 3MF files imports them together. Every file is read before the import dialog opens, so very large batches take a while and hold all their meshes in memory; past this many the import is refused with a notice."
          defaultValue={APP_CONFIG_DEFAULTS.import.maxImportFiles}
          value={c.import.maxImportFiles}
          min={2} max={1000} integer
          onChange={v => set('import', 'maxImportFiles', v)}
        />
        <Field cfgKey="import.multiImportGridGap"
          label="Grid gap"
          unit="× size"
          hint="Space between models when a multi-file import arranges them in a grid."
          tooltip="A fraction of the models' average footprint size: 0.2 leaves a fifth of a typical model's width between neighbours."
          defaultValue={APP_CONFIG_DEFAULTS.import.multiImportGridGap}
          value={c.import.multiImportGridGap}
          min={0} max={5} step={0.05}
          onChange={v => set('import', 'multiImportGridGap', v)}
        />
        <Field cfgKey="import.maxImportTotalTriangles"
          label="Max triangles per multi-file import"
          unit="tris"
          hint="Most triangles all the files imported together may hold."
          tooltip="Files imported together are merged into one mesh (plus a laid-out copy) before their objects are cut out, so a batch of big files needs several times their size in memory. Past this many triangles in total the import is refused with a notice; import the files in smaller batches."
          defaultValue={APP_CONFIG_DEFAULTS.import.maxImportTotalTriangles}
          value={c.import.maxImportTotalTriangles}
          min={10_000} max={200_000_000} integer
          onChange={v => set('import', 'maxImportTotalTriangles', v)}
        />
        <Field cfgKey="import.multiImportOverlapRatio"
          label="Grid suggestion: overlap"
          hint="How much two models must overlap for a multi-file import to suggest the grid layout."
          tooltip="A fraction of the smaller model's footprint. Separately made parts are usually modelled around the origin, so they overlap almost completely; parts of an assembly sit side by side. Above this overlap (between models of similar size, below) the dialog starts on Arrange in a grid instead of Keep file positions."
          defaultValue={APP_CONFIG_DEFAULTS.import.multiImportOverlapRatio}
          value={c.import.multiImportOverlapRatio}
          min={0} max={1} step={0.05}
          onChange={v => set('import', 'multiImportOverlapRatio', v)}
        />
        <Field cfgKey="import.multiImportSimilarSizeRatio"
          label="Grid suggestion: similar size"
          hint="How close in size two overlapping models must be for the grid to be suggested."
          tooltip="The smaller footprint as a fraction of the bigger. A small part inside a big one (a pin in a case) overlaps it fully but is an assembly, so below this ratio the dialog keeps the file positions."
          defaultValue={APP_CONFIG_DEFAULTS.import.multiImportSimilarSizeRatio}
          value={c.import.multiImportSimilarSizeRatio}
          min={0} max={1} step={0.05}
          onChange={v => set('import', 'multiImportSimilarSizeRatio', v)}
        />
        <Field cfgKey="import.voxelDefaultMaxSize"
          label="Voxel default max size"
          unit="voxels"
          hint="Default max voxel grid dimension for image → voxel imports."
          tooltip="When importing an image as a voxel model, this caps the longest grid dimension. A 64-voxel grid produces at most 64×64×64 = 262,144 voxels. Larger grids produce more detailed models but take longer to mesh and paint. The import wizard lets you override this per-import; this is just the starting value."
          defaultValue={APP_CONFIG_DEFAULTS.import.voxelDefaultMaxSize}
          value={c.import.voxelDefaultMaxSize}
          min={4} max={256} integer
          onChange={v => set('import', 'voxelDefaultMaxSize', v)}
        />
        <Field cfgKey="import.voxelHeavyThreshold"
          label="Voxel heavy-model threshold"
          unit="voxels"
          hint="Voxel count above which the import wizard shows a performance warning."
          tooltip="The import wizard shows a 'this may be slow' warning when the resulting voxel count exceeds this threshold. The voxel mesher is linear in occupied voxels, so very large grids can take several seconds. Raise this if you have a fast machine and don't want the warning; lower it on slow hardware to get warned earlier."
          defaultValue={APP_CONFIG_DEFAULTS.import.voxelHeavyThreshold}
          value={c.import.voxelHeavyThreshold}
          min={10_000} max={5_000_000} integer
          onChange={v => set('import', 'voxelHeavyThreshold', v)}
        />
        <Field cfgKey="import.voxelSdfMaxSamples"
          label="Voxel SDF sample budget"
          unit="cells"
          hint="Max lattice cells v.sdf() may sample in one call before it refuses."
          tooltip="When voxel code rasterizes an SDF expression with v.sdf(node), it samples the field once per voxel over the model's bounds. A tiny `res` over large bounds can explode into hundreds of millions of samples and freeze the engine. Past this budget the call throws and asks for a coarser `res` or tighter bounds. Raise it on a fast machine for very high-resolution SDF voxelization."
          defaultValue={APP_CONFIG_DEFAULTS.import.voxelSdfMaxSamples}
          value={c.import.voxelSdfMaxSamples}
          min={100_000} max={64_000_000} integer
          onChange={v => set('import', 'voxelSdfMaxSamples', v)}
        />
        <Field cfgKey="import.reliefMaxResolution"
          label="Relief max resolution"
          unit="px"
          hint="Maximum image resolution (pixels per side) for relief/keychain imports."
          tooltip="Relief and keychain imports downsample the source image to this resolution before generating depth geometry. Higher resolutions produce more detailed reliefs but take longer to process and generate more triangles. The default 512 px balances detail against performance; for intricate designs or very large prints, try 1024 px."
          defaultValue={APP_CONFIG_DEFAULTS.import.reliefMaxResolution}
          value={c.import.reliefMaxResolution}
          min={32} max={4096} integer
          onChange={v => set('import', 'reliefMaxResolution', v)}
        />
        <Field cfgKey="import.remoteFetchTimeoutMs"
          label="Remote fetch timeout"
          unit="ms"
          hint="Timeout for fetching a file by URL in the import-from-URL flow."
          tooltip="When you import a model or image by URL, the app fetches it with this timeout. Slow or geographically distant servers may need a longer timeout. If you frequently see 'fetch timed out' errors on large files from slow hosts, increase this value."
          defaultValue={APP_CONFIG_DEFAULTS.import.remoteFetchTimeoutMs}
          value={c.import.remoteFetchTimeoutMs}
          min={1_000} max={120_000} integer
          onChange={v => set('import', 'remoteFetchTimeoutMs', v)}
        />
        <Field cfgKey="import.prefillImageSrcMaxChars"
          label="AI image prefill: max src length"
          unit="chars"
          hint="Longest image src (e.g. a data URL) an AI can hand to a tool it opens for you."
          tooltip="When the AI opens Image paint, the relief wizard or image → voxel for you with an image already loaded, it passes the image as a data URL, an https URL or an attachment id. Longer src strings are rejected before anything is fetched or decoded."
          defaultValue={APP_CONFIG_DEFAULTS.import.prefillImageSrcMaxChars}
          value={c.import.prefillImageSrcMaxChars}
          min={10_000} max={50_000_000} integer
          onChange={v => set('import', 'prefillImageSrcMaxChars', v)}
        />
        <Field cfgKey="import.prefillImageMaxPixels"
          label="AI image prefill: max pixels"
          unit="px"
          hint="Largest image (width × height) an AI-opened tool will decode."
          tooltip="Images the AI stages into a tool are checked for size before they're decoded into memory; anything with more pixels than this is rejected with an error instead of opening the tool."
          defaultValue={APP_CONFIG_DEFAULTS.import.prefillImageMaxPixels}
          value={c.import.prefillImageMaxPixels}
          min={10_000} max={200_000_000} integer
          onChange={v => set('import', 'prefillImageMaxPixels', v)}
        />
        <Field cfgKey="import.filamentMatchThreshold"
          label="Filament match threshold"
          hint="Color-distance threshold for filament swap matching (lower = stricter)."
          tooltip="The filament swap guide compares the relief's dominant colors against your filament palette using this distance threshold. Colors within this distance are considered a match. Smaller values require a very close color match before suggesting a swap; larger values are more permissive and may suggest swaps for loosely similar colors. The value is in perceptual color space (0–1 range)."
          defaultValue={APP_CONFIG_DEFAULTS.import.filamentMatchThreshold}
          value={c.import.filamentMatchThreshold}
          min={0.01} max={1} step={0.01}
          onChange={v => set('import', 'filamentMatchThreshold', v)}
        />
        <Field cfgKey="import.filamentConfidenceWarnThreshold"
          label="Filament confidence warn threshold"
          hint="Confidence score below which the swap guide shows a warning (0–1)."
          tooltip="When the filament swap guide's confidence in its color matching is below this score, it shows a caution indicator. A score of 0.9 means it warns unless it's 90%+ confident. Lower this to suppress warnings on ambiguous matches; raise it to be warned more readily."
          defaultValue={APP_CONFIG_DEFAULTS.import.filamentConfidenceWarnThreshold}
          value={c.import.filamentConfidenceWarnThreshold}
          min={0.1} max={1} step={0.05}
          onChange={v => set('import', 'filamentConfidenceWarnThreshold', v)}
        />
        <Field cfgKey="import.reconstructCellBudget"
          label="Convert-to-code cell budget"
          unit="cells"
          hint="levelSet resolution budget for convertToCode at 'standard' quality."
          tooltip="Converting a mesh import to code rebuilds it as a smooth levelSet whose grid resolution is derived from this sample budget (draft quality = ×0.25, fine = ×4). More cells = a smoother, more faithful remake but a slower build — build time is roughly proportional to this number. 6M ≈ ten seconds on a mid-size model."
          defaultValue={APP_CONFIG_DEFAULTS.import.reconstructCellBudget}
          value={c.import.reconstructCellBudget}
          min={200_000} max={100_000_000} integer
          onChange={v => set('import', 'reconstructCellBudget', v)}
        />
        <Field cfgKey="import.reconstructEvalSamples"
          label="Reconstruction eval samples"
          unit="points"
          hint="Surface samples per mesh for convertToCode / evalAgainstImport reports."
          tooltip="The faithfulness report (chamfer/hausdorff) samples this many points on each surface and measures nearest-neighbor distances. More samples tighten the measurement's noise floor (reported as sampleSpacing) at the cost of a slower report."
          defaultValue={APP_CONFIG_DEFAULTS.import.reconstructEvalSamples}
          value={c.import.reconstructEvalSamples}
          min={500} max={100_000} integer
          onChange={v => set('import', 'reconstructEvalSamples', v)}
        />
        <Field cfgKey="import.photoMatchTargetHeight"
          label="Photo match: target height"
          unit="px"
          hint="Height both silhouettes are resampled to before comparing."
          tooltip="The photo-match score crops the photo's and the model's silhouettes to their bounding boxes and resamples both to this height before measuring overlap, band widths and regions. Higher catches finer detail but costs more time."
          defaultValue={APP_CONFIG_DEFAULTS.import.photoMatchTargetHeight}
          value={c.import.photoMatchTargetHeight}
          min={48} max={1024} integer
          onChange={v => set('import', 'photoMatchTargetHeight', v)}
        />
        <Field cfgKey="import.photoMatchBgToleranceMin"
          label="Photo match: background tolerance floor"
          unit="RGB"
          hint="Minimum colour distance from the backdrop that counts as subject."
          tooltip="The photo's backdrop colour is estimated from a ring inside its border, and the tolerance adapts to the backdrop's noise above this floor. Keep it low so dark hair on a black backdrop still counts as subject; raise it for noisy, compressed photos."
          defaultValue={APP_CONFIG_DEFAULTS.import.photoMatchBgToleranceMin}
          value={c.import.photoMatchBgToleranceMin}
          min={1} max={120} integer
          onChange={v => set('import', 'photoMatchBgToleranceMin', v)}
        />
        <Field cfgKey="import.photoMatchBgTolerance"
          label="Photo match: explicit-bg tolerance"
          unit="RGB"
          hint="Tolerance around a bg colour passed without its own bgTolerance."
          tooltip="When a caller names the photo's background colour but no tolerance, pixels within this RGB distance of it count as background."
          defaultValue={APP_CONFIG_DEFAULTS.import.photoMatchBgTolerance}
          value={c.import.photoMatchBgTolerance}
          min={1} max={200} integer
          onChange={v => set('import', 'photoMatchBgTolerance', v)}
        />
        <Field cfgKey="import.photoMatchKmeansIterations"
          label="Photo match: k-means iterations"
          unit="passes"
          hint="Refinement passes when matching the model's colours to the photo."
          tooltip="The photo's subject pixels are clustered with k-means, seeded with the model's region colours, so each region finds its pixels in the photo despite shading. More passes let the clusters adapt further to the photo's lighting."
          defaultValue={APP_CONFIG_DEFAULTS.import.photoMatchKmeansIterations}
          value={c.import.photoMatchKmeansIterations}
          min={0} max={50} integer
          onChange={v => set('import', 'photoMatchKmeansIterations', v)}
        />
        <Field cfgKey="import.photoMatchBands"
          label="Photo match: bands"
          unit="bands"
          hint="Horizontal bands in the width profile."
          tooltip="The silhouette is split into this many horizontal bands, top to bottom, and each band's width and centre are compared between photo and model."
          defaultValue={APP_CONFIG_DEFAULTS.import.photoMatchBands}
          value={c.import.photoMatchBands}
          min={2} max={40} integer
          onChange={v => set('import', 'photoMatchBands', v)}
        />
        <Field cfgKey="import.photoMatchColorShiftWarn"
          label="Photo match: colour mismatch threshold"
          unit="ΔE"
          hint="Colour difference above which a region is flagged."
          tooltip="A model region whose colour differs from the photo's colour in the same place by more than this (CIE ΔE, lightness weighted half to forgive shading) is reported as a colour mismatch."
          defaultValue={APP_CONFIG_DEFAULTS.import.photoMatchColorShiftWarn}
          value={c.import.photoMatchColorShiftWarn}
          min={5} max={150} integer
          onChange={v => set('import', 'photoMatchColorShiftWarn', v)}
        />
        <Field cfgKey="import.photoMatchMaxRegionDistance"
          label="Photo match: region reach"
          unit="× height"
          hint="How far a photo pixel may be from a model region of its colour and still count toward it."
          tooltip="Photo pixels are credited to the nearest model region of the same colour, but only within this distance (as a fraction of the figure's height). Pixels further away are photo details the model has no counterpart for — e.g. a ball's black patches are not hair — and are left out of the region statistics."
          defaultValue={APP_CONFIG_DEFAULTS.import.photoMatchMaxRegionDistance}
          value={c.import.photoMatchMaxRegionDistance}
          min={0.01} max={1} step={0.01}
          onChange={v => set('import', 'photoMatchMaxRegionDistance', v)}
        />
        <Field cfgKey="import.photoMatchRenderSize"
          label="Photo match: render size"
          unit="px"
          hint="Size of the flat model render compared against the photo."
          tooltip="The model is rendered flat (no lighting, region colours only) at this size from the requested camera before the comparison."
          defaultValue={APP_CONFIG_DEFAULTS.import.photoMatchRenderSize}
          value={c.import.photoMatchRenderSize}
          min={128} max={2048} integer
          onChange={v => set('import', 'photoMatchRenderSize', v)}
        />
        <Field cfgKey="import.photoMatchMinSubjectPx"
          label="Photo match: minimum subject height"
          unit="px"
          hint="Warn when the photo's subject is shorter than this."
          tooltip="A reference whose subject is only a couple of hundred pixels tall can't resolve fine outline detail — a one-pixel edge error becomes several percent of the height. Below this size the score adds a warning so agents don't chase noise."
          defaultValue={APP_CONFIG_DEFAULTS.import.photoMatchMinSubjectPx}
          value={c.import.photoMatchMinSubjectPx}
          min={0} max={4000} integer
          onChange={v => set('import', 'photoMatchMinSubjectPx', v)}
        />
        <Field cfgKey="import.photoMatchAmbiguousDeltaE"
          label="Photo match: ambiguous-colour threshold"
          unit="ΔE"
          hint="Regions whose photo colours are closer than this are low-confidence."
          tooltip="When two parts look the same colour in the photo (white jersey vs white ball on a dim photo), the photo can't say where one ends and the other begins, so their size/position findings are unreliable. Such regions — and same-coloured parts that touch — are flagged low-confidence and their shape findings suppressed. 0 turns the detection off."
          defaultValue={APP_CONFIG_DEFAULTS.import.photoMatchAmbiguousDeltaE}
          value={c.import.photoMatchAmbiguousDeltaE}
          min={0} max={60} step={0.5}
          onChange={v => set('import', 'photoMatchAmbiguousDeltaE', v)}
        />
        <Field cfgKey="import.photoMatchOutlineMinPct"
          label="Photo match: outline threshold"
          unit="% height"
          hint="Smallest edge offset the outline diff reports."
          tooltip="The outline diff lists where the photo's outline sticks out past the model's (photo-only) or the model's past the photo's (model-only), per band and side. Offsets smaller than this percentage of the figure height are ignored."
          defaultValue={APP_CONFIG_DEFAULTS.import.photoMatchOutlineMinPct}
          value={c.import.photoMatchOutlineMinPct}
          min={0.1} max={20} step={0.1}
          onChange={v => set('import', 'photoMatchOutlineMinPct', v)}
        />
        <Field cfgKey="import.photoMatchOutlineMaxLines"
          label="Photo match: outline lines"
          unit="lines"
          hint="Maximum number of outline-diff lines."
          tooltip="Caps the textual outline diff so the output stays compact; the most severe offsets are kept."
          defaultValue={APP_CONFIG_DEFAULTS.import.photoMatchOutlineMaxLines}
          value={c.import.photoMatchOutlineMaxLines}
          min={1} max={40} integer
          onChange={v => set('import', 'photoMatchOutlineMaxLines', v)}
        />
        <Field cfgKey="import.photoMatchBusyBorderTolerance"
          label="Photo match: busy-background threshold"
          unit="RGB"
          hint="Border noise above which the background is treated as busy."
          tooltip="The photo's backdrop is normally estimated from a ring inside its border. When that ring is so varied (halftone, scenery) that its estimated tolerance reaches this value (the estimate itself tops out at 90), the automatic mode switches to a colour-model segmentation (GrabCut-lite) that learns subject vs backdrop colours instead. It also switches when the border estimate finds almost no subject."
          defaultValue={APP_CONFIG_DEFAULTS.import.photoMatchBusyBorderTolerance}
          value={c.import.photoMatchBusyBorderTolerance}
          min={10} max={90} integer
          onChange={v => set('import', 'photoMatchBusyBorderTolerance', v)}
        />
      </Section>

      <Section title="Geometry warnings">
        <Field cfgKey="geometry.triCountWarnBudget"
          label="Triangle-count warning budget"
          unit="triangles"
          hint="Live model warns above this triangle count."
          tooltip="When the model exceeds this many triangles, the geometry warnings (shown to you and to the AI agent) flag it as heavy to slice and over the catalog budget. Mirrors the headless model:preview tri-budget warning. Raise it if you routinely build dense organic models; lower it to be nudged toward lighter geometry sooner."
          defaultValue={APP_CONFIG_DEFAULTS.geometry.triCountWarnBudget}
          value={c.geometry.triCountWarnBudget}
          min={10_000} max={2_000_000} integer
          onChange={v => set('geometry', 'triCountWarnBudget', v)}
        />
        <Field cfgKey="geometry.minEdgeLengthWarn"
          label="Minimum edge-length warning"
          unit="units (≈mm)"
          hint="Warns when the smallest mesh edge is below this."
          tooltip="Features whose mesh edges fall below a typical FDM extrusion width silently disappear on the print. When the shortest edge is under this threshold, the geometry warnings flag possible sub-extrusion detail. Mirrors model:preview's sub-0.4 mm detail warning. Lower it if you print on a fine nozzle; raise it for chunky FDM."
          defaultValue={APP_CONFIG_DEFAULTS.geometry.minEdgeLengthWarn}
          value={c.geometry.minEdgeLengthWarn}
          min={0} max={5} step={0.05}
          onChange={v => set('geometry', 'minEdgeLengthWarn', v)}
        />
        <Field cfgKey="geometry.aspectRatioWarn"
          label="Aspect-ratio warning"
          unit=": 1"
          hint="Warns when longest ÷ shortest dimension exceeds this."
          tooltip="Tall, thin parts (high bounding-box aspect ratio) are fragile and tip-prone on an FDM bed. When the ratio of the longest to the shortest non-zero dimension exceeds this, the geometry warnings flag it. Mirrors model:preview. Raise it if you intentionally build slender parts; lower it to be warned earlier."
          defaultValue={APP_CONFIG_DEFAULTS.geometry.aspectRatioWarn}
          value={c.geometry.aspectRatioWarn}
          min={2} max={100} step={1}
          onChange={v => set('geometry', 'aspectRatioWarn', v)}
        />
        <Field
          label="High engine-memory threshold"
          unit="% of 4 GB"
          hint="Warns and resets the geometry engine above this heap use."
          tooltip="The geometry kernel runs in WebAssembly, whose heap is capped at about 4 GB and never shrinks. When a run grows it past this share of the ceiling, the geometry warnings (shown to you and to the AI agent) flag the model as memory-heavy before it fails with 'memory access out of bounds', and the engine is restarted once it is idle so the next run starts on a fresh heap. Set 100 to turn both off."
          defaultValue={APP_CONFIG_DEFAULTS.geometry.engineHeapHighPct}
          value={c.geometry.engineHeapHighPct}
          min={10} max={100} integer
          onChange={v => set('geometry', 'engineHeapHighPct', v)}
        />
        <Field
          label="Undeclared-name check limit"
          unit="characters"
          hint="Longer model code skips the 'X is not defined' check."
          tooltip="Model code runs in a hardened sandbox where an undeclared name would read as undefined; before each run the code is scanned so a typo throws 'X is not defined' like normal JavaScript. The scan costs about half a millisecond per KB of code on every run, so code longer than this skips it (undeclared names then read as undefined). Applies to geometry engines started after the change."
          defaultValue={APP_CONFIG_DEFAULTS.geometry.sesUndeclaredCheckMaxChars}
          value={c.geometry.sesUndeclaredCheckMaxChars}
          min={0} max={10_000_000} integer
          onChange={v => set('geometry', 'sesUndeclaredCheckMaxChars', v)}
        />
      </Section>

      <Section title="Part detection">
        <ToggleField cfgKey="segmentation.autoDetectOnImport"
          label="Detect parts on STL import"
          hint="After importing an STL, look for separate parts automatically. When it finds some (e.g. one body per colour), the Detect parts panel opens on them; otherwise the convert-to-code prompt offers a Detect parts button."
          defaultValue={APP_CONFIG_DEFAULTS.segmentation.autoDetectOnImport}
          value={c.segmentation.autoDetectOnImport}
          onChange={v => set('segmentation', 'autoDetectOnImport', v)}
        />
        <Field cfgKey="segmentation.autoDetectMaxTriangles"
          label="Auto-detect triangle limit"
          unit="triangles"
          hint="Larger imports skip the automatic pass."
          tooltip="The automatic import-time pass analyses the whole surface before the next-step prompt appears, which takes a few seconds on very large scans (about 1 s for 460k triangles). Imports above this size skip it; the Detect parts button still works."
          defaultValue={APP_CONFIG_DEFAULTS.segmentation.autoDetectMaxTriangles}
          value={c.segmentation.autoDetectMaxTriangles}
          min={10_000} max={20_000_000} integer
          onChange={v => set('segmentation', 'autoDetectMaxTriangles', v)}
        />
        <Field cfgKey="segmentation.autoDetectMaxParts"
          label="Auto-detect part limit"
          unit="parts"
          hint="Proposals with more parts are dropped."
          tooltip="An automatic proposal with more parts than this (an assembly, or a scan with loose debris) is not shown; the convert-to-code prompt appears instead. Running Separate pieces yourself is not limited."
          defaultValue={APP_CONFIG_DEFAULTS.segmentation.autoDetectMaxParts}
          value={c.segmentation.autoDetectMaxParts}
          min={2} max={1000} integer
          onChange={v => set('segmentation', 'autoDetectMaxParts', v)}
        />
        <Field cfgKey="segmentation.absorbMinAreaFrac"
          label="Absorb-specks threshold"
          unit="of surface"
          hint="Islands smaller than this fraction are folded into neighbours."
          tooltip="The Part Detection panel's Absorb specks action reassigns every disconnected fragment of a part whose area is below this fraction of the whole surface to the neighbouring part it touches most. 0.002 = 0.2%. Raise it to clean up larger leaks; lower it to keep small genuine parts such as buttons or pupils."
          defaultValue={APP_CONFIG_DEFAULTS.segmentation.absorbMinAreaFrac}
          value={c.segmentation.absorbMinAreaFrac}
          min={0} max={0.1} step={0.001}
          onChange={v => set('segmentation', 'absorbMinAreaFrac', v)}
        />
        <Field cfgKey="segmentation.smoothBoundaryIterations"
          label="Tidy-edges passes"
          unit="passes"
          hint="Boundary clean-up passes per Tidy edges click."
          tooltip="Each pass switches a boundary triangle to the part held by a majority of its neighbours, shaving single-triangle stair-steps and spurs. More passes give smoother but slightly shifted boundaries."
          defaultValue={APP_CONFIG_DEFAULTS.segmentation.smoothBoundaryIterations}
          value={c.segmentation.smoothBoundaryIterations}
          min={1} max={20} integer
          onChange={v => set('segmentation', 'smoothBoundaryIterations', v)}
        />
        <Field cfgKey="segmentation.maxListedParts"
          label="Parts listed in summaries"
          unit="parts"
          hint="Console/AI part lists truncate beyond this."
          tooltip="detectParts / editParts / getPartDraft list at most this many parts (the rest are counted in partsTruncated) so an over-segmented mesh doesn't flood the AI's context."
          defaultValue={APP_CONFIG_DEFAULTS.segmentation.maxListedParts}
          value={c.segmentation.maxListedParts}
          min={10} max={1000} integer
          onChange={v => set('segmentation', 'maxListedParts', v)}
        />
        <Field cfgKey="segmentation.undoDepth"
          label="Undo depth"
          unit="edits"
          hint="Edit batches the part draft can undo."
          tooltip="How many editParts batches (merge, rename, reassign, re-run…) a part-detection draft keeps for Undo. Each step holds a copy of the per-triangle part map, so very high values use more memory on large meshes."
          defaultValue={APP_CONFIG_DEFAULTS.segmentation.undoDepth}
          value={c.segmentation.undoDepth}
          min={1} max={200} integer
          onChange={v => set('segmentation', 'undoDepth', v)}
        />
        <Field cfgKey="segmentation.labelGridResolution"
          label="Part-number placement grid"
          unit="cells"
          hint="Resolution used to find where each part is visible."
          tooltip="renderParts draws each part's number on a spot where that part is visible. Visibility is decided on a coarse depth grid this many cells across; raise it to label smaller visible slivers, lower it for speed."
          defaultValue={APP_CONFIG_DEFAULTS.segmentation.labelGridResolution}
          value={c.segmentation.labelGridResolution}
          min={40} max={600} integer
          onChange={v => set('segmentation', 'labelGridResolution', v)}
        />
        <Field cfgKey="segmentation.seedMissEdgeLengths"
          label="Seed miss distance"
          unit="edges"
          hint="previewSeeds flags seeds farther than this from the surface."
          tooltip="previewSeeds reports a seed as a miss when it lies farther than this many median edge lengths from the model's surface (detection would still snap it to the nearest triangle, usually not the intended spot)."
          defaultValue={APP_CONFIG_DEFAULTS.segmentation.seedMissEdgeLengths}
          value={c.segmentation.seedMissEdgeLengths}
          min={0.5} max={100} step={0.5}
          onChange={v => set('segmentation', 'seedMissEdgeLengths', v)}
        />
        <Field cfgKey="segmentation.focusPadding"
          label="Focused render padding"
          unit="×"
          hint="Margin around a part when renderParts focuses on it."
          tooltip="renderParts({ focus: 'part' }) frames the camera on that part's bounding box, padded by this fraction of its largest dimension."
          defaultValue={APP_CONFIG_DEFAULTS.segmentation.focusPadding}
          value={c.segmentation.focusPadding}
          min={0} max={2} step={0.05}
          onChange={v => set('segmentation', 'focusPadding', v)}
        />
        <Field cfgKey="segmentation.liveDebounceMs"
          label="Live re-detect delay"
          unit="ms"
          hint="Live mode waits this long after your last change."
          tooltip="With Live on in the Part Detection panel, detection re-runs automatically once you stop moving seeds or changing settings for this long. Raise it on very large meshes so a re-run doesn't start mid-adjustment."
          defaultValue={APP_CONFIG_DEFAULTS.segmentation.liveDebounceMs}
          value={c.segmentation.liveDebounceMs}
          min={0} max={5000} integer
          onChange={v => set('segmentation', 'liveDebounceMs', v)}
        />
        <Field cfgKey="segmentation.edgeSmoothingDebounceMs"
          label="Edge-smoothness delay"
          unit="ms"
          hint="Wait after the Edge smoothness slider before recomputing."
          tooltip="Smooth part edges are recomputed (in the background) once the Edge smoothness slider has been still for this long."
          defaultValue={APP_CONFIG_DEFAULTS.segmentation.edgeSmoothingDebounceMs}
          value={c.segmentation.edgeSmoothingDebounceMs}
          min={0} max={5000} integer
          onChange={v => set('segmentation', 'edgeSmoothingDebounceMs', v)}
        />
        <Field cfgKey="segmentation.presetThumbSize"
          label="Preset thumbnail size"
          unit="px"
          hint="Size of the preset filmstrip tiles."
          tooltip="The Presets strip renders each preset's result as a small thumbnail of this size. Larger tiles show more detail but take longer to draw."
          defaultValue={APP_CONFIG_DEFAULTS.segmentation.presetThumbSize}
          value={c.segmentation.presetThumbSize}
          min={64} max={320} integer
          onChange={v => set('segmentation', 'presetThumbSize', v)}
        />
        <Field cfgKey="segmentation.defaultEdgeSmoothing"
          label="Default edge smoothness"
          unit="passes"
          hint="Edge-smoothing passes a new part draft starts with."
          tooltip="Smooth part edges draw boundaries through triangles so stair-stepped boundaries curve, and Accept cuts the mesh along them. This is the starting value of the panel's Edge smoothness slider (and of drafts the AI creates). 0 = keep boundaries on triangle edges and never re-mesh on accept."
          defaultValue={APP_CONFIG_DEFAULTS.segmentation.defaultEdgeSmoothing}
          value={c.segmentation.defaultEdgeSmoothing}
          min={0} max={20} integer
          onChange={v => set('segmentation', 'defaultEdgeSmoothing', v)}
        />
        <Field cfgKey="segmentation.edgePinCreaseDeg"
          label="Keep boundaries on sharp folds"
          unit="°"
          hint="Smoothing leaves boundaries on folds this sharp alone."
          tooltip="Where a part boundary runs along an edge whose faces meet at least this many degrees apart (a hard edge such as a box corner), it already sits on the seam, so smooth edges leave it there. Sculpted grooves on scans usually fold 30–60° per edge, so they still smooth at the default 60°. Lower it to keep more boundaries in place; 0 smooths every boundary."
          defaultValue={APP_CONFIG_DEFAULTS.segmentation.edgePinCreaseDeg}
          value={c.segmentation.edgePinCreaseDeg}
          min={0} max={90} step={1}
          onChange={v => set('segmentation', 'edgePinCreaseDeg', v)}
        />
        <Field cfgKey="segmentation.seedsFromPartsMinRegionFrac"
          label="Convert-to-seeds speck size"
          unit="of part"
          hint="Smaller regions of a part get no seed of their own."
          tooltip="Convert to seeds drops one seed in each separate region of every part. Regions smaller than this fraction of their part are skipped, so stray specks follow the part's main seed. 0.01 = 1%."
          defaultValue={APP_CONFIG_DEFAULTS.segmentation.seedsFromPartsMinRegionFrac}
          value={c.segmentation.seedsFromPartsMinRegionFrac}
          min={0} max={0.5} step={0.005}
          onChange={v => set('segmentation', 'seedsFromPartsMinRegionFrac', v)}
        />
        <Field cfgKey="segmentation.seedDotFraction"
          label="Seed dot size"
          unit="of model"
          hint="Seed-marker dot radius, as a fraction of the model's size."
          tooltip="Seed dots are sized from the model's bounding-box diagonal so they read the same on a small figurine and a large scan. 0.008 = 0.8% of the diagonal."
          defaultValue={APP_CONFIG_DEFAULTS.segmentation.seedDotFraction}
          value={c.segmentation.seedDotFraction}
          min={0.001} max={0.05} step={0.001}
          onChange={v => set('segmentation', 'seedDotFraction', v)}
        />
        <Field cfgKey="segmentation.seedTagScreenFraction"
          label="Seed label size"
          unit="of view"
          hint="Seed name-tag height, as a fraction of the viewport height."
          tooltip="Seed name tags stay the same size on screen however far you zoom. 0.026 ≈ 2.6% of the viewport height."
          defaultValue={APP_CONFIG_DEFAULTS.segmentation.seedTagScreenFraction}
          value={c.segmentation.seedTagScreenFraction}
          min={0.01} max={0.08} step={0.002}
          onChange={v => set('segmentation', 'seedTagScreenFraction', v)}
        />
        <Field cfgKey="segmentation.fixBrushRadiusFrac"
          label="Fix brush size"
          unit="of model"
          hint="Radius of the part panel's Fix brush."
          tooltip="The Fix tool paints triangles into a chosen part with a round brush this big (a fraction of the model's bounding-box diagonal). Fixed triangles stay put when pins move. 0.012 = 1.2%."
          defaultValue={APP_CONFIG_DEFAULTS.segmentation.fixBrushRadiusFrac}
          value={c.segmentation.fixBrushRadiusFrac}
          min={0.002} max={0.1} step={0.001}
          onChange={v => set('segmentation', 'fixBrushRadiusFrac', v)}
        />
        <Field cfgKey="segmentation.chipMissAreaFrac"
          label="Label chip miss threshold"
          unit="of surface"
          hint="A label chip's pin counts as missed below this part size."
          tooltip="When a label-chip pin grows a part smaller than this fraction of the model's surface (or none at all), the chip shows “missed — click again” and a warning. 0.0005 = 0.05%."
          defaultValue={APP_CONFIG_DEFAULTS.segmentation.chipMissAreaFrac}
          value={c.segmentation.chipMissAreaFrac}
          min={0} max={0.05} step={0.0005}
          onChange={v => set('segmentation', 'chipMissAreaFrac', v)}
        />
        <Field cfgKey="segmentation.autoAbsorbSpeckFrac"
          label="Auto-absorb specks below"
          unit="of surface"
          hint="Detection folds tiny stray regions into their neighbour."
          tooltip="After detection (and after each pin re-grow), regions smaller than this fraction of the model's surface join the neighbouring part they border most — only when nothing claims them: no pin, no Fix-brush stroke, and a part nobody named, coloured or locked. 0 turns it off. 0.002 = 0.2%."
          defaultValue={APP_CONFIG_DEFAULTS.segmentation.autoAbsorbSpeckFrac}
          value={c.segmentation.autoAbsorbSpeckFrac}
          min={0} max={0.05} step={0.0005}
          onChange={v => set('segmentation', 'autoAbsorbSpeckFrac', v)}
        />
        <Field cfgKey="segmentation.fusedPieceMinTris"
          label="Fused figure threshold"
          unit="triangles"
          hint="When to open the part panel ready to label a fused figure."
          tooltip="If the import-time Separate-pieces pass finds only 1–2 pieces and the largest has at least this many triangles, the mesh is treated as a fused figure: the part panel opens with the first label chip armed, so the first click on the model labels it."
          defaultValue={APP_CONFIG_DEFAULTS.segmentation.fusedPieceMinTris}
          value={c.segmentation.fusedPieceMinTris}
          min={0} max={1_000_000} step={100} integer
          onChange={v => set('segmentation', 'fusedPieceMinTris', v)}
        />
        <Field cfgKey="segmentation.mobileSheetHeightFrac"
          label="Phone panel height"
          unit="of window"
          hint="Height of the part panel's bottom sheet below 768 px."
          tooltip="On narrow screens the Detect parts panel docks to the bottom as a sheet this fraction of the window height, so the model stays visible and clickable above it. 0.45 = 45%."
          defaultValue={APP_CONFIG_DEFAULTS.segmentation.mobileSheetHeightFrac}
          value={c.segmentation.mobileSheetHeightFrac}
          min={0.25} max={0.9} step={0.05}
          onChange={v => set('segmentation', 'mobileSheetHeightFrac', v)}
        />
      </Section>

      <Section title="Security — engine sandbox (reload to apply)">
        <SandboxModeField />
        <Field cfgKey="renderer.engineSandboxBootTimeoutMs"
          label="Sandbox start timeout"
          unit="ms"
          hint="How long the sandbox frame may take to start before model code is blocked (never falls back on its own)."
          tooltip="With the engine sandbox on, the geometry Worker lives in a hidden cross-origin iframe. If that frame doesn't load and report cross-origin isolation within this time, the sandbox is marked unavailable: model code won't run in the tab, and a status pill offers an explicit “Run without sandbox (this tab)”. A sandboxed Worker that gets stuck starting after the frame is up restarts the frame instead."
          defaultValue={APP_CONFIG_DEFAULTS.renderer.engineSandboxBootTimeoutMs}
          value={c.renderer.engineSandboxBootTimeoutMs}
          min={2_000} max={120_000} integer
          onChange={v => set('renderer', 'engineSandboxBootTimeoutMs', v)}
        />
        <Field cfgKey="renderer.engineSandboxMaxFrameRestarts"
          label="Sandbox frame restarts"
          hint="Times in a row the sandbox frame may be restarted after a crash before model code is blocked."
          tooltip="If the hidden sandbox frame crashes (e.g. a model ran it out of memory) or a sandboxed Worker gets stuck starting, Partwright replaces the frame and retries — never falling back to an unsandboxed Worker. After this many consecutive failed restarts the sandbox is marked unavailable for the tab."
          defaultValue={APP_CONFIG_DEFAULTS.renderer.engineSandboxMaxFrameRestarts}
          value={c.renderer.engineSandboxMaxFrameRestarts}
          min={0} max={10} integer
          onChange={v => set('renderer', 'engineSandboxMaxFrameRestarts', v)}
        />
        <Field cfgKey="renderer.engineSandboxHeartbeatMs"
          label="Sandbox liveness ping"
          unit="ms"
          hint="How often the app checks the sandbox frame is alive (a dead frame is replaced after ~3 missed pings)."
          tooltip="A model that exhausts memory can crash the hidden sandbox frame's renderer without the app hearing about it. The app pings the frame at this interval; when about three pings in a row go unanswered it replaces the frame, so the stuck run fails instead of hanging. Lower = faster recovery, higher = fewer wake-ups."
          defaultValue={APP_CONFIG_DEFAULTS.renderer.engineSandboxHeartbeatMs}
          value={c.renderer.engineSandboxHeartbeatMs}
          min={500} max={30_000} integer
          onChange={v => set('renderer', 'engineSandboxHeartbeatMs', v)}
        />
      </Section>

      <Section title="UI">
        <ToggleField cfgKey="ui.editorHintsEnabled"
          label="Show editor hints"
          hint={'The "Did you know?" strip at the top of the editor that rotates through tips. Off hides it everywhere; the strip’s ✕ only hides it for the current tab.'}
          defaultValue={APP_CONFIG_DEFAULTS.ui.editorHintsEnabled}
          value={c.ui.editorHintsEnabled}
          onChange={v => set('ui', 'editorHintsEnabled', v)}
        />
        <Field cfgKey="ui.hintRotationMs"
          label="Hint rotation interval"
          unit="ms"
          hint="How long each editor hint shows before the strip rotates to the next."
          tooltip="The 'Did you know?' strip auto-advances to the next tip after this long. Hovering the strip pauses rotation; the ‹ › arrows step manually. Raise it to read each tip longer; lower it to cycle faster."
          defaultValue={APP_CONFIG_DEFAULTS.ui.hintRotationMs}
          value={c.ui.hintRotationMs}
          min={3_000} max={60_000} integer
          onChange={v => set('ui', 'hintRotationMs', v)}
        />
        <Field cfgKey="ui.toolDialogOpenWaitMs"
          label="AI-opened dialog wait"
          unit="ms"
          hint="How long an AI openTool waits for an export / publish dialog to appear."
          tooltip="When the AI opens an export or publish dialog for you, a pre-export confirm (e.g. unsaved objects) can appear first. After this long the AI is told the values are staged for when the dialog opens, instead of waiting on you."
          defaultValue={APP_CONFIG_DEFAULTS.ui.toolDialogOpenWaitMs}
          value={c.ui.toolDialogOpenWaitMs}
          min={500} max={60_000} integer
          onChange={v => set('ui', 'toolDialogOpenWaitMs', v)}
        />
        <Field cfgKey="ui.paintAdjacencyWorkerMinTriangles"
          label="Prepare paint in background from"
          unit="triangles"
          hint="Bigger meshes prepare paint tools in a background worker."
          tooltip="After each run the app prepares the triangle-neighbour graph the paint tools use, so Paint opens instantly. On a big mesh that takes a second or more and froze the app while it looked idle (e.g. right after switching objects). From this many triangles it is built in a background worker when you open Paint instead; paint clicks wait the moment it takes. 0 = always in the background."
          defaultValue={APP_CONFIG_DEFAULTS.ui.paintAdjacencyWorkerMinTriangles}
          value={c.ui.paintAdjacencyWorkerMinTriangles}
          min={0} max={50_000_000} step={50_000} integer
          onChange={v => set('ui', 'paintAdjacencyWorkerMinTriangles', v)}
        />
        <Field cfgKey="ui.paintAdjacencyWorkerTimeoutMs"
          label="Background paint prep timeout"
          unit="ms"
          hint="Fall back to preparing paint on the main thread after this long."
          tooltip="If the background worker preparing the paint tools doesn't answer within this time (for example, the browser stopped it for using too much memory), the app prepares them on the main thread instead, which may pause the app briefly but keeps Paint working."
          defaultValue={APP_CONFIG_DEFAULTS.ui.paintAdjacencyWorkerTimeoutMs}
          value={c.ui.paintAdjacencyWorkerTimeoutMs}
          min={5_000} max={600_000} step={5_000} integer
          onChange={v => set('ui', 'paintAdjacencyWorkerTimeoutMs', v)}
        />
        <Field cfgKey="ui.paintBrushSliverPx"
          label="Brush sliver catch"
          unit="px"
          hint="Paint thin triangles the brush can't see (0 = off)."
          tooltip="With smooth edges off, the brush paints the triangles visible under it on screen. Very thin triangles along a seam can be narrower than a pixel and get skipped, leaving a fine line of the old colour. Triangles thinner than this many pixels next to the painted area are painted too."
          defaultValue={APP_CONFIG_DEFAULTS.ui.paintBrushSliverPx}
          value={c.ui.paintBrushSliverPx}
          min={0} max={10} step={0.5}
          onChange={v => set('ui', 'paintBrushSliverPx', v)}
        />
        <Field cfgKey="ui.partBoxSelectSamples"
          label="Box-select samples per part"
          unit="tris"
          hint="How many of a part's triangles Shift-drag box select checks."
          tooltip="Shift-dragging a box in the viewport selects every part with geometry inside it. Each part is tested by projecting up to this many of its triangle centres onto the screen; higher catches thin slivers of very big parts at the cost of a slower box select."
          defaultValue={APP_CONFIG_DEFAULTS.ui.partBoxSelectSamples}
          value={c.ui.partBoxSelectSamples}
          min={50} max={1_000_000} integer
          onChange={v => set('ui', 'partBoxSelectSamples', v)}
        />
        <Field cfgKey="ui.partArrangeGapRatio"
          label="Part arrange gap"
          unit="× size"
          hint="Gap between parts when the Parts panel arranges or copies them."
          tooltip="Grid, pack, bed packing and copies leave this much space between parts, as a fraction of the parts' average footprint (0.2 = a fifth of a part's width). The Parts panel's gap box overrides it for one action."
          defaultValue={APP_CONFIG_DEFAULTS.ui.partArrangeGapRatio}
          value={c.ui.partArrangeGapRatio}
          min={0} max={5} step={0.05}
          onChange={v => set('ui', 'partArrangeGapRatio', v)}
        />
        <Field cfgKey="ui.partSnapStep"
          label="Part snap step"
          unit="units"
          hint="Grid step for the Parts panel's “Snap to grid”."
          tooltip="“Snap to grid” moves each part's lower corner onto the nearest multiple of this step on X and Y."
          defaultValue={APP_CONFIG_DEFAULTS.ui.partSnapStep}
          value={c.ui.partSnapStep}
          min={0.001} max={10_000} step={0.5}
          onChange={v => set('ui', 'partSnapStep', v)}
        />
        <Field cfgKey="ui.partNudgeStep"
          label="Part nudge step"
          unit="units"
          hint="How far an arrow key moves the selected parts."
          tooltip="With the Parts panel open, the arrow keys move the selected parts by this much on X and Y (PageUp/PageDown on Z). Hold Shift for ten times the step."
          defaultValue={APP_CONFIG_DEFAULTS.ui.partNudgeStep}
          value={c.ui.partNudgeStep}
          min={0.001} max={10_000} step={0.5}
          onChange={v => set('ui', 'partNudgeStep', v)}
        />
        <Field cfgKey="ui.partNudgeSaveDelayMs"
          label="Part nudge save delay"
          unit="ms"
          hint="How long after the last arrow-key nudge it is saved as a version."
          tooltip="Holding an arrow key moves the selected parts step by step, but the whole move is saved as one version (and one Undo step) once the keys have been idle for this long."
          defaultValue={APP_CONFIG_DEFAULTS.ui.partNudgeSaveDelayMs}
          value={c.ui.partNudgeSaveDelayMs}
          min={100} max={30_000} step={100} integer
          onChange={v => set('ui', 'partNudgeSaveDelayMs', v)}
        />
        <Field cfgKey="ui.partEditUndoDepth"
          label="Part edit undo depth"
          unit="edits"
          hint="How many part edits the Parts panel can undo."
          tooltip="Each arrange, copy or group action remembers the code before it so Undo can put it back. Past this many, the oldest are forgotten."
          defaultValue={APP_CONFIG_DEFAULTS.ui.partEditUndoDepth}
          value={c.ui.partEditUndoDepth}
          min={1} max={500} integer
          onChange={v => set('ui', 'partEditUndoDepth', v)}
        />
        <Field cfgKey="ui.partMaxCopies"
          label="Max part copies"
          unit="copies"
          hint="Most copies one duplicate or array action makes."
          tooltip="Duplicate, array and grid array refuse to make more copies than this in one step, so a typo can't freeze the app."
          defaultValue={APP_CONFIG_DEFAULTS.ui.partMaxCopies}
          value={c.ui.partMaxCopies}
          min={1} max={10_000} integer
          onChange={v => set('ui', 'partMaxCopies', v)}
        />
        <Field cfgKey="ui.maxPendingAppliedNotes"
          label="AI applied-notes kept"
          unit="notes"
          hint="How many “[UI · app note] user applied …” notes wait for the AI's next turn."
          tooltip="When you apply something from a tool the AI opened for you, a one-line note tells the AI what you settled on at the start of its next turn. Only the latest note per tool is kept; past this many, the oldest are dropped."
          defaultValue={APP_CONFIG_DEFAULTS.ui.maxPendingAppliedNotes}
          value={c.ui.maxPendingAppliedNotes}
          min={1} max={50} integer
          onChange={v => set('ui', 'maxPendingAppliedNotes', v)}
        />
        <Field cfgKey="ui.maxAppliedNoteChars"
          label="AI applied-note length"
          unit="chars"
          hint="Longest “[UI · app note] user applied …” note line (truncated past it)."
          tooltip="Caps how much of the tool's settings each applied-note carries into the AI's next turn, so a panel with many settings can't bloat the prompt."
          defaultValue={APP_CONFIG_DEFAULTS.ui.maxAppliedNoteChars}
          value={c.ui.maxAppliedNoteChars}
          min={80} max={4_000} integer
          onChange={v => set('ui', 'maxAppliedNoteChars', v)}
        />
        <Field cfgKey="ui.toastDurationMs"
          label="Toast duration"
          unit="ms"
          hint="How long notification toasts stay on screen."
          tooltip="The duration notifications (save confirmations, export success/error, etc.) remain visible before automatically dismissing. Raise this if you miss toasts; lower it if they feel intrusive."
          defaultValue={APP_CONFIG_DEFAULTS.ui.toastDurationMs}
          value={c.ui.toastDurationMs}
          min={500} max={15_000} integer
          onChange={v => set('ui', 'toastDurationMs', v)}
        />
        <Field cfgKey="ui.exportColorMergeTolerance"
          label="Export colour merging"
          unit="ΔE"
          hint="Default tolerance of the 3MF export's Filament colors step."
          tooltip="Every distinct painted colour becomes its own filament in Bambu Studio / OrcaSlicer. The 3MF export opens a Filament colors step that merges near-identical shades (closer than this perceptual colour difference) into one filament. ~2 is barely noticeable; 10 merges colours that look the same on the model; 0 keeps every shade. You can always adjust it in the dialog."
          defaultValue={APP_CONFIG_DEFAULTS.ui.exportColorMergeTolerance}
          value={c.ui.exportColorMergeTolerance}
          min={0} max={30} integer
          onChange={v => set('ui', 'exportColorMergeTolerance', v)}
        />
        <Field cfgKey="ui.undoToastDurationMs"
          label="Undo toast duration"
          unit="ms"
          hint="How long a toast with an Undo button (after deleting) stays on screen."
          tooltip="Deleting an object, part or piece shows a toast with an Undo button. It stays up longer than a plain toast so the button is reachable. After it fades, Recover deleted in the Objects list still brings the item back."
          defaultValue={APP_CONFIG_DEFAULTS.ui.undoToastDurationMs}
          value={c.ui.undoToastDurationMs}
          min={2000} max={60_000} integer
          onChange={v => set('ui', 'undoToastDurationMs', v)}
        />
        <Field cfgKey="ui.deletedObjectRetentionDays"
          label="Keep deleted objects"
          unit="days"
          hint="How long deleted objects stay recoverable before they are permanently removed."
          tooltip="Deleting an object moves it (with all of its versions) to the Recover deleted bin for this session. Entries older than this are purged permanently the next time the bin is read. Removed parts and pieces live in the code, so they never expire."
          defaultValue={APP_CONFIG_DEFAULTS.ui.deletedObjectRetentionDays}
          value={c.ui.deletedObjectRetentionDays}
          min={1} max={365} integer
          onChange={v => set('ui', 'deletedObjectRetentionDays', v)}
        />
        <Field cfgKey="ui.paneSlideMs"
          label="Pane slide"
          unit="ms"
          hint="How long the side panes (AI panel, code editor) take to slide open/closed."
          tooltip="The docked AI panel and code editor pane animate their layout so the viewport grows/shrinks smoothly instead of snapping. Lower for a snappier toggle, 0 for instant. Ignored when your OS is set to reduce motion."
          defaultValue={APP_CONFIG_DEFAULTS.ui.paneSlideMs}
          value={c.ui.paneSlideMs}
          min={0} max={600} integer
          onChange={v => set('ui', 'paneSlideMs', v)}
        />
        <Field cfgKey="ui.codeMinimapWidthPx"
          label="Mini code map width"
          unit="px"
          hint="Width of the compact code map the code pane shows by default."
          tooltip="The code pane starts as a narrow, syntax-colored map of the file — hover it to peek at the code, click to open the full editor there. This sets how wide that strip is. Wider shows more of each line; narrower leaves more room for the viewport."
          defaultValue={APP_CONFIG_DEFAULTS.ui.codeMinimapWidthPx}
          value={c.ui.codeMinimapWidthPx}
          min={80} max={320} integer
          onChange={v => set('ui', 'codeMinimapWidthPx', v)}
        />
        <Field cfgKey="ui.defaultPaletteCapacity"
          label="Default palette capacity"
          hint="How many filament slots the paint panel assumes your printer has."
          tooltip="The default number of colour slots (e.g. 4 for one Bambu AMS). Drives the paint panel's over-budget warning when a model uses more colours than your printer can load. Never blocks painting or export — it's just a heads-up."
          defaultValue={APP_CONFIG_DEFAULTS.ui.defaultPaletteCapacity}
          value={c.ui.defaultPaletteCapacity}
          min={1} max={16} integer
          onChange={v => set('ui', 'defaultPaletteCapacity', v)}
        />
        <Field cfgKey="ui.paletteHistoryMax"
          label="Palette history size"
          hint="How many recent colours the palette keeps in its history."
          tooltip="The size of the palette's recent-colour history ring. Raise it to keep more previously-used colours one click away; lower it to keep the history compact."
          defaultValue={APP_CONFIG_DEFAULTS.ui.paletteHistoryMax}
          value={c.ui.paletteHistoryMax}
          min={8} max={256} integer
          onChange={v => set('ui', 'paletteHistoryMax', v)}
        />
        <Field cfgKey="ui.paintStrokeResolution"
          label="Paint stroke detail"
          hint="Default paintStroke resolution: target edge = radius ÷ this."
          tooltip="How finely a console/AI paintStroke approximates curves when the call gives no resolution. The painted edge is cut exactly either way, so higher values only smooth curves further, at the cost of more triangles that every saved session must rebuild when it opens."
          defaultValue={APP_CONFIG_DEFAULTS.ui.paintStrokeResolution}
          value={c.ui.paintStrokeResolution}
          min={2} max={1024} integer
          onChange={v => set('ui', 'paintStrokeResolution', v)}
        />
        <Field cfgKey="ui.paintStrokePathSpacing"
          label="Paint stroke path spacing"
          hint="Gap filled between paintStroke path points, as a fraction of the radius."
          tooltip="paintStroke and paintAirbrush treat their points as a path and fill the gaps so the band is continuous. This sets the largest gap left between samples, relative to the brush radius. Smaller values give a smoother band edge at the cost of more samples."
          defaultValue={APP_CONFIG_DEFAULTS.ui.paintStrokePathSpacing}
          value={c.ui.paintStrokePathSpacing}
          min={0.05} max={1}
          onChange={v => set('ui', 'paintStrokePathSpacing', v)}
        />
        <Field cfgKey="ui.boundaryPaintMaxLoops"
          label="Boundary paint loop limit"
          unit="loops"
          hint="paintAlongBoundary paints at most this many seam loops."
          tooltip="paintAlongBoundary paints one smooth stroke per seam loop between two parts. A noisy seam can break into many small loops; only the longest this many are painted and the rest are reported as skippedLoops."
          defaultValue={APP_CONFIG_DEFAULTS.ui.boundaryPaintMaxLoops}
          value={c.ui.boundaryPaintMaxLoops}
          min={1} max={200} integer
          onChange={v => set('ui', 'boundaryPaintMaxLoops', v)}
        />
        <Field cfgKey="ui.tooltipDelayMs"
          label="Tooltip delay"
          unit="ms"
          hint="Hover delay before a tooltip appears."
          tooltip="How long you must hover over a button or icon before its tooltip appears. Set to 0 for instant tooltips; increase if tooltips appear too eagerly while you move the mouse across the toolbar."
          defaultValue={APP_CONFIG_DEFAULTS.ui.tooltipDelayMs}
          value={c.ui.tooltipDelayMs}
          min={0} max={2000} integer
          onChange={v => set('ui', 'tooltipDelayMs', v)}
        />
        <Field cfgKey="ui.editorFontSizeDefault"
          label="Default editor font size"
          unit="px"
          hint="Seeds a fresh tab; change the live size from the editor's ⚙ menu (−/+)."
          tooltip="The code editor's starting font size. The active size is remembered per browser tab via the ⚙ Editor menu's −/+ stepper; this default applies to a fresh tab and is the value the stepper returns to. Must sit within the min/max bounds below."
          defaultValue={APP_CONFIG_DEFAULTS.ui.editorFontSizeDefault}
          value={c.ui.editorFontSizeDefault}
          min={6} max={48} integer
          onChange={v => set('ui', 'editorFontSizeDefault', v)}
        />
        <Field cfgKey="ui.editorFontSizeMin"
          label="Min editor font size"
          unit="px"
          hint="Lower bound for the editor's −/+ font stepper."
          tooltip="The smallest font size the editor's ⚙ menu −/+ stepper will go down to."
          defaultValue={APP_CONFIG_DEFAULTS.ui.editorFontSizeMin}
          value={c.ui.editorFontSizeMin}
          min={6} max={24} integer
          onChange={v => set('ui', 'editorFontSizeMin', v)}
        />
        <Field cfgKey="ui.editorFontSizeMax"
          label="Max editor font size"
          unit="px"
          hint="Upper bound for the editor's −/+ font stepper."
          tooltip="The largest font size the editor's ⚙ menu −/+ stepper will go up to."
          defaultValue={APP_CONFIG_DEFAULTS.ui.editorFontSizeMax}
          value={c.ui.editorFontSizeMax}
          min={12} max={64} integer
          onChange={v => set('ui', 'editorFontSizeMax', v)}
        />
        <Field cfgKey="ui.codeEditorErrorIdleMs"
          label="Code editor error idle delay"
          unit="ms"
          tooltip="After you stop typing, the code editor waits this long before showing error annotations (red underlines, error panel). This prevents the error display from flickering while you're mid-edit. Lower it for faster feedback; raise it if error annotations distract you while typing."
          defaultValue={APP_CONFIG_DEFAULTS.ui.codeEditorErrorIdleMs}
          value={c.ui.codeEditorErrorIdleMs}
          min={0} max={5_000} integer
          onChange={v => set('ui', 'codeEditorErrorIdleMs', v)}
        />
        <Field cfgKey="ui.codeEditorScrollPinMs"
          label="Code editor bottom-scroll stabilizer"
          unit="ms"
          tooltip="When the code editor is scrolled near the very bottom, real Chrome can snap the visible code by a line whenever CodeMirror re-measures (a focus change, opening a tool menu/panel, etc.). The stabilizer reverts that one-line snap so the code doesn't stutter, while always honoring real scrolling. This is the input-grace window: a wheel/scrollbar/touch/keyboard scroll within this window is treated as your intent and never reverted. Set to 0 to disable."
          defaultValue={APP_CONFIG_DEFAULTS.ui.codeEditorScrollPinMs}
          value={c.ui.codeEditorScrollPinMs}
          min={0} max={1_000} integer
          onChange={v => set('ui', 'codeEditorScrollPinMs', v)}
        />
        <Field cfgKey="ui.companionDraftDebounceMs"
          label="Companion draft autosave debounce"
          unit="ms"
          tooltip="After you stop typing in a SCAD companion file, the editor waits this long before autosaving the draft so the edit survives a reload. Coalesces keystrokes so IndexedDB isn't written on every key. Lower it to capture edits sooner; raise it to write less often."
          defaultValue={APP_CONFIG_DEFAULTS.ui.companionDraftDebounceMs}
          value={c.ui.companionDraftDebounceMs}
          min={0} max={5_000} integer
          onChange={v => set('ui', 'companionDraftDebounceMs', v)}
        />
        <Field cfgKey="ui.workCameraSaveDebounceMs"
          label="Working-view camera save debounce"
          unit="ms"
          tooltip="After you finish orbiting or zooming the 3D viewport, the app waits this long before saving the camera angle to the session so it's restored on reload. Coalesces a burst of adjustments into one write. Lower it to capture the angle sooner; raise it to write less often."
          defaultValue={APP_CONFIG_DEFAULTS.ui.workCameraSaveDebounceMs}
          value={c.ui.workCameraSaveDebounceMs}
          min={0} max={5_000} integer
          onChange={v => set('ui', 'workCameraSaveDebounceMs', v)}
        />
        <Field cfgKey="ui.surfacePreviewDebounceMs"
          label="Surface preview debounce"
          unit="ms"
          tooltip="When adjusting parameters in the surface-modifier panel (texture, fuzzy, etc.), this debounce delays the preview render until you've stopped changing values for this long. Lower it for more responsive live preview; raise it if previewing is slow on your machine."
          defaultValue={APP_CONFIG_DEFAULTS.ui.surfacePreviewDebounceMs}
          value={c.ui.surfacePreviewDebounceMs}
          min={0} max={2_000} integer
          onChange={v => set('ui', 'surfacePreviewDebounceMs', v)}
        />
        <Field cfgKey="ui.characterPreviewDebounceMs"
          label="Character preview debounce"
          unit="ms"
          tooltip="Debounce delay for the Character Creator's live figure preview. An SDF figure rebuild is heavy, so this is longer than the surface debounce — it coalesces rapid slider edits into a single rebuild once you settle. Lower for snappier preview; raise if rebuilds stack up."
          defaultValue={APP_CONFIG_DEFAULTS.ui.characterPreviewDebounceMs}
          value={c.ui.characterPreviewDebounceMs}
          min={0} max={3_000} integer
          onChange={v => set('ui', 'characterPreviewDebounceMs', v)}
        />
        <Field cfgKey="ui.reliefPreviewDebounceMs"
          label="Relief 2D preview debounce"
          unit="ms"
          tooltip="Debounce delay for the 2D image preview in the relief import wizard. While you adjust sliders (brightness, contrast, depth), this delay prevents a new preview from firing on every pixel of slider movement. Lower = more responsive; raise if CPU spikes during slider drag."
          defaultValue={APP_CONFIG_DEFAULTS.ui.reliefPreviewDebounceMs}
          value={c.ui.reliefPreviewDebounceMs}
          min={0} max={2_000} integer
          onChange={v => set('ui', 'reliefPreviewDebounceMs', v)}
        />
        <Field cfgKey="ui.reliefPreview3dDebounceMs"
          label="Relief 3D preview debounce"
          unit="ms"
          tooltip="Debounce delay for the 3D geometry preview in the relief import wizard. The 3D preview involves geometry generation, which is more expensive than the 2D preview — this longer default avoids re-generating on every incremental slider change."
          defaultValue={APP_CONFIG_DEFAULTS.ui.reliefPreview3dDebounceMs}
          value={c.ui.reliefPreview3dDebounceMs}
          min={0} max={2_000} integer
          onChange={v => set('ui', 'reliefPreview3dDebounceMs', v)}
        />
        <Field cfgKey="ui.progressModalShowDelayMs"
          label="Progress modal show delay"
          unit="ms"
          tooltip="The progress overlay (shown during paint subdivision, simplify, and other multi-second operations) waits this long before appearing. Operations that finish faster than this delay show no overlay at all — avoiding a flash for quick operations. Raise it to keep the overlay from appearing on fast machines; lower it to see progress sooner on slow ones."
          defaultValue={APP_CONFIG_DEFAULTS.ui.progressModalShowDelayMs}
          value={c.ui.progressModalShowDelayMs}
          min={0} max={2_000} integer
          onChange={v => set('ui', 'progressModalShowDelayMs', v)}
        />
        <Field cfgKey="ui.sessionLockHeartbeatMs"
          label="Session lock heartbeat"
          unit="ms"
          tooltip="How often the active tab broadcasts its 'I am the session leader' heartbeat to other tabs watching the same session. If this tab goes silent (tab crash, sleep), other tabs detect staleness after the stale threshold elapses and take over. Reduce for faster failover detection; increase to reduce cross-tab storage activity."
          defaultValue={APP_CONFIG_DEFAULTS.ui.sessionLockHeartbeatMs}
          value={c.ui.sessionLockHeartbeatMs}
          min={500} max={30_000} integer
          onChange={v => set('ui', 'sessionLockHeartbeatMs', v)}
        />
        <Field cfgKey="ui.sessionLockStaleMs"
          label="Session lock stale threshold"
          unit="ms"
          hint="Time after which a silent heartbeat is considered stale."
          tooltip="If the active tab's heartbeat hasn't been seen for this long, other tabs treat the session lock as stale and compete to take over. This should be at least 2–3× the heartbeat interval to avoid false positives (a single missed heartbeat shouldn't trigger takeover). Raise it if you see unexpected session takeovers during normal use."
          defaultValue={APP_CONFIG_DEFAULTS.ui.sessionLockStaleMs}
          value={c.ui.sessionLockStaleMs}
          min={1_000} max={60_000} integer
          onChange={v => set('ui', 'sessionLockStaleMs', v)}
        />
        <Field cfgKey="ui.defaultQuality"
          label="Default geometry quality"
          unit="segments"
          hint="Default circular segment count for manifold-js and BREP renders. 128 = Very High. Takes effect on next page load."
          tooltip="Controls how many segments are used for circles and curved surfaces in manifold-js and BREP geometry. More segments = smoother curves, more triangles, slower renders. Named presets: Low=16, Medium=32, High=64, Very High=128, Ultra=1024. Enter any value from 3–4096; values not matching a preset use 'Custom' mode. Takes effect on next page load."
          defaultValue={APP_CONFIG_DEFAULTS.ui.defaultQuality}
          value={c.ui.defaultQuality}
          min={3} max={4096} integer
          onChange={v => set('ui', 'defaultQuality', v)}
        />
        <Field cfgKey="ui.scadDefaultQuality"
          label="Default OpenSCAD quality ($fn)"
          unit="segments"
          hint="Default $fn for OpenSCAD renders. 32 = Medium. Takes effect on next page load."
          tooltip="Controls the default $fn value used when rendering OpenSCAD code. Higher values produce smoother curves but much slower renders, since SCAD recompiles the full model on every run. Named presets: Low=16, Medium=32, High=64, Very High=128, Ultra=1024. Takes effect on next page load."
          defaultValue={APP_CONFIG_DEFAULTS.ui.scadDefaultQuality}
          value={c.ui.scadDefaultQuality}
          min={3} max={4096} integer
          onChange={v => set('ui', 'scadDefaultQuality', v)}
        />
        <Field cfgKey="ui.workerRunHistorySize"
          label="Worker run-history size"
          unit="runs"
          hint="Recent geometry runs kept in the worker health panel."
          tooltip="The Workers half of the ⚠ Diagnostics panel keeps the last N geometry runs in memory with their wall-clock and worker-side timing. Older runs are evicted when the buffer is full. Increase to keep more history for spotting slow-render patterns; decrease to reduce memory use."
          defaultValue={APP_CONFIG_DEFAULTS.ui.workerRunHistorySize}
          value={c.ui.workerRunHistorySize}
          min={10} max={500} integer
          onChange={v => set('ui', 'workerRunHistorySize', v)}
        />
        <Field cfgKey="ui.workerPanelRefreshMs"
          label="Worker panel refresh"
          unit="ms"
          hint="How often the Diagnostics panel re-polls worker in-flight counts while open."
          tooltip="The Workers half of the Diagnostics panel polls live values (in-flight operation counts, worker liveness) on this interval, since those change without firing an update event. Lower = snappier live readout, slightly more work while the panel is open. Only affects the panel while it's visible."
          defaultValue={APP_CONFIG_DEFAULTS.ui.workerPanelRefreshMs}
          value={c.ui.workerPanelRefreshMs}
          min={200} max={10_000} integer
          onChange={v => set('ui', 'workerPanelRefreshMs', v)}
        />
        <Field cfgKey="ui.diagnosticLogApiLimit"
          label="Diagnostic log entries for agents"
          unit="entries"
          hint="How many recent Diagnostic Log entries partwright.getDiagnosticLog() and the AI tool return when no limit is given."
          tooltip="AI agents call getDiagnosticLog() to answer 'why did that fail?'. It returns the newest entries first, with secrets (API keys, auth headers, key-bearing URLs) redacted. A larger default gives the agent more history per call at the cost of a bigger tool result; callers can always pass an explicit limit."
          defaultValue={APP_CONFIG_DEFAULTS.ui.diagnosticLogApiLimit}
          value={c.ui.diagnosticLogApiLimit}
          min={1} max={200} integer
          onChange={v => set('ui', 'diagnosticLogApiLimit', v)}
        />
      </Section>

      <Section title="Data">
        <div class="flex items-center justify-between">
          <div>
            <div class="text-xs font-medium text-zinc-300">Uninstall / start fresh</div>
            <div class="text-xs text-zinc-500 mt-0.5">Delete sessions, AI keys, settings, or other local browser data.</div>
          </div>
          <button
            type="button"
            class="ml-4 shrink-0 px-3 py-1.5 rounded text-xs font-medium text-red-400 border border-red-400/30 hover:bg-red-400/10 transition-colors"
            onClick={() => showUninstallModal()}
          >
            Uninstall…
          </button>
        </div>
      </Section>

      {hasAnyOverride.value && (
        <div class="flex justify-end pt-1">
          <button
            type="button"
            class="px-3 py-1.5 rounded text-xs font-medium text-amber-400 border border-amber-400/30 hover:bg-amber-400/10 transition-colors"
            onClick={onReset}
          >
            Reset all to defaults
          </button>
        </div>
      )}
    </div>
  );
}

// ─── public entry point ───────────────────────────────────────────────────────

let settingsHandle: { close: () => void } | null = null;
let focusedKey: string | null = null;

/** Every `section.key` the settings modal can focus (from the config defaults). */
function settingKeys(): string[] {
  return Object.entries(APP_CONFIG_DEFAULTS).flatMap(([sec, fields]) => Object.keys(fields as object).map(k => `${sec}.${k}`));
}

/** Scroll to and highlight one field (no value is changed). Returns false when
 *  the field isn't rendered in the modal. */
function focusSetting(key: string): boolean {
  const el = document.querySelector<HTMLElement>(`[data-settings-body] [data-setting="${CSS.escape(key)}"]`);
  if (!el) return false;
  document.querySelectorAll('[data-setting-focus]').forEach(n => {
    n.removeAttribute('data-setting-focus');
    n.classList.remove('ring-2', 'ring-violet-400/70', 'bg-violet-500/10', 'p-1.5', '-m-1.5');
  });
  el.setAttribute('data-setting-focus', '');
  el.classList.add('ring-2', 'ring-violet-400/70', 'bg-violet-500/10', 'p-1.5', '-m-1.5');
  el.scrollIntoView({ block: 'center' });
  el.querySelector<HTMLInputElement>('input')?.focus({ preventScroll: true });
  focusedKey = key;
  return true;
}

function openSettingsWithPrefill(p: Record<string, unknown> | undefined, ctx: ToolOpenContext): ToolOpenResult {
  const focus = p?.focus as string | undefined;
  if (focus !== undefined && !settingKeys().includes(focus)) {
    const [sec] = focus.split('.');
    const inSec = settingKeys().filter(k => k.startsWith(`${sec}.`));
    return { error: `focus "${focus}" is not a setting (use "section.key"; ${inSec.length ? `${sec} keys: ${inSec.map(k => k.slice(sec.length + 1)).join(', ')}` : `sections: ${Object.keys(APP_CONFIG_DEFAULTS).join(', ')}`})` };
  }
  if (!settingsHandle) showAdvancedSettingsModal();
  const body = document.querySelector<HTMLElement>('[data-settings-body]');
  if (body) {
    body.parentElement?.querySelector(':scope > [data-tool-note]')?.remove();
    if (ctx.note) body.parentElement?.prepend(createToolNote(ctx.note, ctx.source));
  }
  if (focus !== undefined && !focusSetting(focus)) return { applied: {}, ignored: ['focus'] };
  return { applied: focus !== undefined ? { focus } : {}, ignored: [] };
}

registerTool({
  id: 'open-quality',
  title: 'Settings',
  hint: 'Settings',
  prefillSchema: {
    focus: { type: 'string', maxLength: 80, description: 'Scroll to + highlight one setting, as "section.key" (e.g. "renderer.circularSegments"). Values are never changed.' },
  },
  open: (prefill, ctx) => openSettingsWithPrefill(prefill, ctx),
  getState: () => (settingsHandle ? { focus: focusedKey } : null),
  isOpen: () => settingsHandle !== null,
  close: () => settingsHandle?.close(),
});

export function showAdvancedSettingsModal(): void {
  if (settingsHandle) return; // one at a time — a second open is a no-op
  const cfg = signal<AppConfig>(cloneConfig(loadAppConfig()));
  focusedKey = null;

  function handleReset(): void {
    resetAppConfig();
    cfg.value = cloneConfig(loadAppConfig());
  }

  settingsHandle = mountPreactModal(
    { title: 'Settings', scrollable: true, onClose: () => { settingsHandle = null; focusedKey = null; } },
    close => ({
      body: <AdvancedSettingsBody cfg={cfg} onReset={handleReset} />,
      footer: (
        <button
          type="button"
          class="px-3 py-1.5 rounded text-xs font-medium bg-blue-600 hover:bg-blue-500 text-white"
          onClick={close}
        >Done</button>
      ),
    }),
    { bodyClassPatches: [['gap-3', 'gap-5']] },
  );
}
