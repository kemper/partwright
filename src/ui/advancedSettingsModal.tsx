// Advanced Settings modal — power-user overrides for numeric constants that
// control AI loop behavior, rendering quality, import limits, and UI timing.
// All values default to the factory defaults in src/config/appConfig.ts.
// Changes persist to localStorage and take effect immediately (renderer
// settings marked "reload" need a page refresh to rebuild Three.js objects).

import { signal, computed, type Signal } from '@preact/signals';
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

// ─── helpers ──────────────────────────────────────────────────────────────────

/** Deep-clone an AppConfig so mutations don't alias the cached instance. */
function cloneConfig(c: AppConfig): AppConfig {
  return {
    ai: { ...c.ai },
    renderer: { ...c.renderer },
    import: { ...c.import },
    ui: { ...c.ui },
    geometry: { ...c.geometry },
  };
}

// ─── sub-components ──────────────────────────────────────────────────────────

interface FieldProps {
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
  const { label, unit, hint, tooltip, defaultValue, value, min, max, step, integer, onChange } = props;
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
    <div class="flex flex-col gap-1">
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
  label: string;
  hint?: string;
  defaultValue: boolean;
  value: boolean;
  onChange: (v: boolean) => void;
}

function ToggleField(props: ToggleFieldProps) {
  const { label, hint, defaultValue, value, onChange } = props;
  const changed = value !== defaultValue;
  return (
    <div class="flex flex-col gap-1">
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
    <div class="flex flex-col gap-5">
      <p class="text-xs text-zinc-400 leading-relaxed">
        Override default numeric constants. Changes take effect immediately unless marked
        <span class="text-zinc-300 font-medium"> (reload)</span>.
        Modified values appear in amber; click <span class="text-zinc-300 font-medium">Reset to defaults</span> to restore all at once.
      </p>

      <Section title="AI — loop">
        <Field
          label="Max consecutive auto-resumes"
          hint="Hard ceiling on nudges with no tool call before the loop stops. Resets on any tool call."
          tooltip="When an AI turn ends without calling 'finish', auto-continue nudges the model to keep going. This cap prevents an infinite loop if the model repeatedly ignores the nudge — it trips after this many consecutive resume attempts with zero tool calls between them. Increase it for complex multi-step tasks that legitimately need many iterations."
          defaultValue={APP_CONFIG_DEFAULTS.ai.maxConsecutiveAutoResumes}
          value={c.ai.maxConsecutiveAutoResumes}
          min={1} max={64} integer
          onChange={v => set('ai', 'maxConsecutiveAutoResumes', v)}
        />
        <Field
          label="Max transient API retries"
          unit="retries"
          hint="How many times a provider call is retried after a transient failure (HTTP 429/5xx, dropped stream) before the turn surfaces a hard error."
          tooltip="Provider servers occasionally return rate-limit (429) or server (5xx) errors, or drop the streaming connection. Rather than tearing the whole agent loop down — which is especially disruptive mid auto-continue — the chat loop retries the same request with exponential backoff up to this many times. These retries do NOT consume the agent's per-turn iteration budget. Set to 0 to disable and fail fast. Note: this value is read from defaults inside the agent Worker, so overriding it only affects the local (WebGPU) provider."
          defaultValue={APP_CONFIG_DEFAULTS.ai.maxTransientRetries}
          value={c.ai.maxTransientRetries}
          min={0} max={10} integer
          onChange={v => set('ai', 'maxTransientRetries', v)}
        />
        <Field
          label="Transient retry base backoff"
          unit="ms"
          hint="Base wait between transient-error retries; grows exponentially with jitter."
          tooltip="The first transient-error retry waits up to this long, the second up to 2×, the third up to 4×, and so on (with random jitter), capped by the max backoff below. Larger values are gentler on a struggling server but slow recovery from a brief blip."
          defaultValue={APP_CONFIG_DEFAULTS.ai.transientRetryBaseMs}
          value={c.ai.transientRetryBaseMs}
          min={100} max={30_000} integer
          onChange={v => set('ai', 'transientRetryBaseMs', v)}
        />
        <Field
          label="Transient retry max backoff"
          unit="ms"
          hint="Ceiling on a single transient-error backoff wait."
          tooltip="Caps how long any one transient-error retry will wait, so exponential growth can't stall the turn for minutes. The actual wait is a random value up to min(base · 2^(attempt-1), this ceiling)."
          defaultValue={APP_CONFIG_DEFAULTS.ai.transientRetryMaxMs}
          value={c.ai.transientRetryMaxMs}
          min={1_000} max={120_000} integer
          onChange={v => set('ai', 'transientRetryMaxMs', v)}
        />
        <Field
          label="Slow-tool warning threshold"
          unit="ms"
          hint="Tool calls exceeding this time emit a console warning (does not affect behavior)."
          tooltip="A diagnostic threshold only — no functional impact. When any AI tool call (e.g. runCode, renderViews) takes longer than this, a warning is logged in the browser console. Useful for identifying slow geometry evaluations or render bottlenecks. Raise it to silence warnings for expected slow operations."
          defaultValue={APP_CONFIG_DEFAULTS.ai.slowToolMs}
          value={c.ai.slowToolMs}
          min={50} max={30_000} integer
          onChange={v => set('ai', 'slowToolMs', v)}
        />
        <Field
          label="Tool-call timeout (Worker)"
          unit="ms"
          hint="If a tool call (e.g. a render) hasn't finished within this time, it's cancelled and reported back to the agent as a failed step — the turn keeps going."
          tooltip="The AI agent runs in a background Worker and calls tools (geometry execution, rendering, etc.) on the main thread. If a tool doesn't finish within this timeout — e.g. a very heavy boolean/BREP/SCAD evaluation, or WASM still initializing — the in-flight execution is cancelled and the agent receives an error result for that step, so it can react (simplify, retry) without the chat getting stuck. Increase for very slow machines or genuinely heavy models."
          defaultValue={APP_CONFIG_DEFAULTS.ai.toolCallTimeoutMs}
          value={c.ai.toolCallTimeoutMs}
          min={5_000} max={600_000} integer
          onChange={v => set('ai', 'toolCallTimeoutMs', v)}
        />
        <Field
          label="Diagnostics ring-buffer size"
          unit="events"
          hint="Max AI call log entries kept in memory."
          tooltip="The AI Call Log (🩺 button in the AI panel header) stores the last N provider API calls in memory. Each entry includes request timing, token counts, stop reason, and any error details. Older entries are evicted when the buffer is full. Increase to keep more history for diagnosing intermittent issues; decrease to reduce memory use during long sessions."
          defaultValue={APP_CONFIG_DEFAULTS.ai.diagnosticsRingSize}
          value={c.ai.diagnosticsRingSize}
          min={10} max={500} integer
          onChange={v => set('ai', 'diagnosticsRingSize', v)}
        />
        <Field
          label="Max recent attachments"
          unit="images"
          hint="Images kept in the recent-attachments picker (IndexedDB rows)."
          tooltip="The AI panel's image attachment picker shows recently used images so you can re-attach them without re-uploading. This cap controls how many are persisted in IndexedDB. Older images are evicted when the cap is reached. Increase to keep more images in the picker; decrease to free IndexedDB space on storage-constrained devices."
          defaultValue={APP_CONFIG_DEFAULTS.ai.maxAttachments}
          value={c.ai.maxAttachments}
          min={1} max={100} integer
          onChange={v => set('ai', 'maxAttachments', v)}
        />
        <Field
          label="Recent render images kept in context"
          unit="images"
          hint="How many of the latest render snapshots stay in the request sent to the AI."
          tooltip="renderView / renderViews / runIsolated return PNG snapshots so the agent can see the model. Every snapshot is otherwise re-sent to the provider on every subsequent turn, so a long session's image tokens compound. This keeps only the N most-recent render images in the request (their text stats always stay); older ones are replaced with a short note. The on-screen transcript still shows every image — only the wire request is trimmed. Raise it to give the model more visual memory at higher token cost; set very high to disable trimming."
          defaultValue={APP_CONFIG_DEFAULTS.ai.keepRecentToolImages}
          value={c.ai.keepRecentToolImages}
          min={0} max={50} integer
          onChange={v => set('ai', 'keepRecentToolImages', v)}
        />
      </Section>

      <Section title="AI — geometry timeouts">
        <div class="text-[10px] text-zinc-500 leading-snug">Safety timeouts for background Worker operations that have no Cancel button. Rendering itself is <em>not</em> timed out — a slow run is bounded by the elapsed-time counter and the Cancel button instead.</div>
        <Field
          label="OpenSCAD timeout"
          unit="ms"
          tooltip="Wall-clock ceiling for OpenSCAD Worker operations that have no Cancel affordance — source validation and include-dependency detection. SCAD compiles BOSL2-style libraries from source on every run, so the 3-minute default gives ample headroom. (The render path itself has no timeout.)"
          defaultValue={APP_CONFIG_DEFAULTS.ai.geometryTimeoutScadMs}
          value={c.ai.geometryTimeoutScadMs}
          min={5_000} max={600_000} integer
          onChange={v => set('ai', 'geometryTimeoutScadMs', v)}
        />
        <Field
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
        <Field
          label="Prompt budget — medium tier"
          unit="tokens"
          tooltip="The portion of the local model's context window allocated to the system prompt when using a medium-tier model (e.g. Qwen-7B). Larger models can handle more context; reduce this if you're getting truncation errors on a small-context model."
          defaultValue={APP_CONFIG_DEFAULTS.ai.localPromptBudgetMedium}
          value={c.ai.localPromptBudgetMedium}
          min={200} max={4096} integer
          onChange={v => set('ai', 'localPromptBudgetMedium', v)}
        />
        <Field
          label="Prompt budget — slim tier"
          unit="tokens"
          tooltip="The portion of the context window for the system prompt when using a slim/small model. Slim models have tighter context windows, so the budget is lower to leave room for the conversation."
          defaultValue={APP_CONFIG_DEFAULTS.ai.localPromptBudgetSlim}
          value={c.ai.localPromptBudgetSlim}
          min={100} max={2048} integer
          onChange={v => set('ai', 'localPromptBudgetSlim', v)}
        />
        <Field
          label="Tool budget — native"
          unit="tokens"
          tooltip="Tokens reserved for tool-call schemas when the model supports native function calling. Native tool schemas are compact JSON — 100 tokens covers the full Partwright tool set."
          defaultValue={APP_CONFIG_DEFAULTS.ai.localToolsBudgetNative}
          value={c.ai.localToolsBudgetNative}
          min={50} max={1000} integer
          onChange={v => set('ai', 'localToolsBudgetNative', v)}
        />
        <Field
          label="Tool budget — prompt-engineered"
          unit="tokens"
          tooltip="Tokens reserved for tool schemas when they're injected as plain text (for models without native function calling). Prompt-engineering the schema requires more tokens than native calling."
          defaultValue={APP_CONFIG_DEFAULTS.ai.localToolsBudgetPromptEngineered}
          value={c.ai.localToolsBudgetPromptEngineered}
          min={100} max={2000} integer
          onChange={v => set('ai', 'localToolsBudgetPromptEngineered', v)}
        />
        <Field
          label="Attention sink margin"
          unit="tokens"
          tooltip="Safety buffer added when computing the total attention-sink context allocation. Prevents off-by-one overflows when the model's reported context length is approximate."
          defaultValue={APP_CONFIG_DEFAULTS.ai.localAttentionSinkMargin}
          value={c.ai.localAttentionSinkMargin}
          min={50} max={500} integer
          onChange={v => set('ai', 'localAttentionSinkMargin', v)}
        />
        <Field
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
        <div class="text-[10px] text-zinc-500 leading-snug">Anthropic extended-thinking token budgets (tokens).</div>
        <Field
          label="Anthropic — Low"
          unit="tokens"
          tooltip="The 'budget_tokens' sent to Anthropic's API when thinking level is set to Low. A higher budget gives the model more space to reason before answering, improving accuracy on complex geometry tasks at the cost of latency and token spend."
          defaultValue={APP_CONFIG_DEFAULTS.ai.thinkingBudgetAnthropicLow}
          value={c.ai.thinkingBudgetAnthropicLow}
          min={1024} max={100_000} integer
          onChange={v => set('ai', 'thinkingBudgetAnthropicLow', v)}
        />
        <Field
          label="Anthropic — Medium"
          unit="tokens"
          tooltip="The thinking budget for Anthropic models at Medium thinking level. Suitable for moderately complex CAD tasks — the model can work through multi-step geometry without the cost of High."
          defaultValue={APP_CONFIG_DEFAULTS.ai.thinkingBudgetAnthropicMedium}
          value={c.ai.thinkingBudgetAnthropicMedium}
          min={1024} max={100_000} integer
          onChange={v => set('ai', 'thinkingBudgetAnthropicMedium', v)}
        />
        <Field
          label="Anthropic — High"
          unit="tokens"
          tooltip="The thinking budget for Anthropic models at High thinking level. Use for the most complex parametric or BREP tasks. Note that Anthropic requires max_tokens > budget_tokens, so the 'Anthropic answer headroom' field below must also be large enough."
          defaultValue={APP_CONFIG_DEFAULTS.ai.thinkingBudgetAnthropicHigh}
          value={c.ai.thinkingBudgetAnthropicHigh}
          min={1024} max={200_000} integer
          onChange={v => set('ai', 'thinkingBudgetAnthropicHigh', v)}
        />
        <div class="text-[10px] text-zinc-500 leading-snug mt-1">Gemini thinking budgets (tokens).</div>
        <Field
          label="Gemini — Low"
          unit="tokens"
          tooltip="The thinking budget for Gemini models at Low level. Gemini combines reasoning and answer tokens in one ceiling — setting this too high can crowd out the answer."
          defaultValue={APP_CONFIG_DEFAULTS.ai.thinkingBudgetGeminiLow}
          value={c.ai.thinkingBudgetGeminiLow}
          min={1024} max={100_000} integer
          onChange={v => set('ai', 'thinkingBudgetGeminiLow', v)}
        />
        <Field
          label="Gemini — Medium"
          unit="tokens"
          tooltip="The thinking budget for Gemini at Medium level. See the Gemini max output tokens field — the total output ceiling must be at least this large."
          defaultValue={APP_CONFIG_DEFAULTS.ai.thinkingBudgetGeminiMedium}
          value={c.ai.thinkingBudgetGeminiMedium}
          min={1024} max={100_000} integer
          onChange={v => set('ai', 'thinkingBudgetGeminiMedium', v)}
        />
        <Field
          label="Gemini — High"
          unit="tokens"
          tooltip="The thinking budget for Gemini at High level. The Gemini max output tokens must exceed this value to avoid 400 errors from the API."
          defaultValue={APP_CONFIG_DEFAULTS.ai.thinkingBudgetGeminiHigh}
          value={c.ai.thinkingBudgetGeminiHigh}
          min={1024} max={200_000} integer
          onChange={v => set('ai', 'thinkingBudgetGeminiHigh', v)}
        />
        <Field
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
        <Field
          label="Anthropic max output tokens"
          unit="tokens"
          tooltip="The max_tokens value sent to Anthropic's API on every turn. This is the total output ceiling including any thinking tokens. If you've set a High thinking budget above this value, the API will error — raise both together."
          defaultValue={APP_CONFIG_DEFAULTS.ai.maxOutputTokensAnthropic}
          value={c.ai.maxOutputTokensAnthropic}
          min={1024} max={200_000} integer
          onChange={v => set('ai', 'maxOutputTokensAnthropic', v)}
        />
        <Field
          label="OpenAI max output tokens"
          unit="tokens"
          tooltip="The max_output_tokens (Responses API) or max_tokens (Chat Completions) value sent to OpenAI. Reasoning models (o1/o3/o4/gpt-5) route to the Responses API; all others use Chat Completions — this cap applies to both. Increase for very long code generation turns."
          defaultValue={APP_CONFIG_DEFAULTS.ai.maxOutputTokensOpenai}
          value={c.ai.maxOutputTokensOpenai}
          min={1024} max={200_000} integer
          onChange={v => set('ai', 'maxOutputTokensOpenai', v)}
        />
        <Field
          label="Gemini max output tokens"
          unit="tokens"
          hint="Combined ceiling for reasoning + answer on thinking models."
          tooltip="The maxOutputTokens value for Gemini. For thinking-enabled models this is a shared ceiling for both reasoning tokens and the answer — if the thinking budget is close to this value, the model may not have room to output a response. Keep this well above your highest Gemini thinking budget."
          defaultValue={APP_CONFIG_DEFAULTS.ai.maxOutputTokensGemini}
          value={c.ai.maxOutputTokensGemini}
          min={1024} max={500_000} integer
          onChange={v => set('ai', 'maxOutputTokensGemini', v)}
        />
        <Field
          label="Chars-per-token estimate"
          unit="chars"
          hint="Rough ratio used for token-count estimation in the context meter."
          tooltip="The context-meter bar in the AI panel estimates token counts by dividing character counts by this ratio. It's a heuristic — actual tokenization varies by model and language. English prose averages ~4 chars/token; code with many symbols may be closer to 3. Adjust if the meter consistently over- or under-estimates."
          defaultValue={APP_CONFIG_DEFAULTS.ai.charsPerToken}
          value={c.ai.charsPerToken}
          min={1} max={20}
          onChange={v => set('ai', 'charsPerToken', v)}
        />
        <Field
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
        <Field
          label="Camera field-of-view"
          unit="°"
          tooltip="The vertical field of view for the Three.js perspective camera. A narrower FOV (e.g. 30°) produces an orthographic-like projection good for inspecting flat faces; a wider FOV (e.g. 75°) gives a more immersive perspective. Takes effect after a page reload."
          defaultValue={APP_CONFIG_DEFAULTS.renderer.fov}
          value={c.renderer.fov}
          min={10} max={120} integer
          onChange={v => set('renderer', 'fov', v)}
        />
        <Field
          label="Max device pixel ratio"
          hint="Cap on devicePixelRatio. Lower = less GPU work; higher = sharper on HiDPI screens."
          tooltip="On Retina/HiDPI screens the browser's devicePixelRatio can be 2–3×, meaning the renderer draws 4–9× as many pixels. This cap limits the ratio to save GPU work. At 1.0 you get 1:1 pixel mapping (fastest); at 2.0 you get full Retina sharpness. Takes effect after a page reload."
          defaultValue={APP_CONFIG_DEFAULTS.renderer.maxPixelRatio}
          value={c.renderer.maxPixelRatio}
          min={0.5} max={4} step={0.5}
          onChange={v => set('renderer', 'maxPixelRatio', v)}
        />
        <Field
          label="Interaction render scale"
          hint="Render resolution fraction during orbit/pan/zoom (0–1, lower = faster)."
          tooltip="While you're actively orbiting, panning, or zooming, the viewport renders at this fraction of its full resolution to keep the frame rate smooth. At 0.6 (the default) each dimension is 60% of full resolution — 36% of total pixels. It snaps back to full resolution when you stop moving. Lower this on slow GPUs; raise it if you don't notice quality differences during orbit."
          defaultValue={APP_CONFIG_DEFAULTS.renderer.interactionRenderScale}
          value={c.renderer.interactionRenderScale}
          min={0.1} max={1} step={0.05}
          onChange={v => set('renderer', 'interactionRenderScale', v)}
        />
        <Field
          label="Grid room factor"
          unit="× model"
          tooltip="How far the ground grid extends, as a multiple of the model's largest dimension. The grid now scales with the model — spanning the studio 'room' around it — instead of being a fixed-size patch, so it stays useful from tiny parts to large models. Higher = a bigger grid around the model. Takes effect on the next render or 'Reset view'."
          defaultValue={APP_CONFIG_DEFAULTS.renderer.gridRoomFactor}
          value={c.renderer.gridRoomFactor}
          min={1} max={40} step={0.5}
          onChange={v => set('renderer', 'gridRoomFactor', v)}
        />
        <Field
          label="Grid divisions"
          tooltip="The number of cells the grid is divided into across its full width. Since the grid scales to the model, this sets cell density (more divisions = finer cells). Takes effect after a page reload."
          defaultValue={APP_CONFIG_DEFAULTS.renderer.gridDivisions}
          value={c.renderer.gridDivisions}
          min={2} max={200} integer
          onChange={v => set('renderer', 'gridDivisions', v)}
        />
        <Field
          label="Assembly build workers"
          hint="Parts the Assembly (all-parts) view builds in parallel. Clamped to CPU cores − 1."
          tooltip="The Assembly view meshes every part of a session at once. Each parallel worker boots its own manifold-3d WASM instance, so this trades memory for grid fill speed. 1 serializes the builds (still fills progressively). Clamped at runtime to your CPU core count minus one."
          defaultValue={APP_CONFIG_DEFAULTS.renderer.assemblyPoolSize}
          value={c.renderer.assemblyPoolSize}
          min={1} max={16} integer
          onChange={v => set('renderer', 'assemblyPoolSize', v)}
        />
        <Field
          label="Assembly grid gutter"
          unit="× cell"
          hint="Spacing between parts in the Assembly grid, as a fraction of the largest part."
          tooltip="How much empty space sits between cells in the all-parts grid, as a fraction of the largest part's footprint. 0.25 leaves a quarter-cell gap; 0 packs parts edge to edge."
          defaultValue={APP_CONFIG_DEFAULTS.renderer.assemblyGridGutter}
          value={c.renderer.assemblyGridGutter}
          min={0} max={2} step={0.05}
          onChange={v => set('renderer', 'assemblyGridGutter', v)}
        />
        <Field
          label="Ambient light intensity"
          tooltip="The intensity of the omnidirectional ambient light in the viewport. Ambient light illuminates all surfaces equally regardless of normal direction — raising it reduces harsh shadows. Combined with the directional lights, the total scene illumination is ambient + primary + secondary. Takes effect after a page reload."
          defaultValue={APP_CONFIG_DEFAULTS.renderer.ambientLightIntensity}
          value={c.renderer.ambientLightIntensity}
          min={0} max={3} step={0.05}
          onChange={v => set('renderer', 'ambientLightIntensity', v)}
        />
        <Field
          label="Primary light intensity"
          tooltip="The intensity of the main directional light. This is the dominant light source that creates highlights and defines the model's primary shading. Raising it increases contrast; lowering it flattens the look. Takes effect after a page reload."
          defaultValue={APP_CONFIG_DEFAULTS.renderer.primaryLightIntensity}
          value={c.renderer.primaryLightIntensity}
          min={0} max={3} step={0.05}
          onChange={v => set('renderer', 'primaryLightIntensity', v)}
        />
        <Field
          label="Secondary light intensity"
          tooltip="The intensity of the secondary fill directional light, positioned on the opposite side from the primary. It softens harsh shadows cast by the primary light. Raising it produces a more evenly-lit appearance; setting it to 0 gives hard one-sided lighting. Takes effect after a page reload."
          defaultValue={APP_CONFIG_DEFAULTS.renderer.secondaryLightIntensity}
          value={c.renderer.secondaryLightIntensity}
          min={0} max={2} step={0.05}
          onChange={v => set('renderer', 'secondaryLightIntensity', v)}
        />
        <Field
          label="Orbit damping factor"
          tooltip="The inertia factor for OrbitControls. At 0 the camera stops instantly when you release the mouse; higher values (up to 1) add a momentum effect that coasts to a stop. The default 0.1 gives a slight coast. Takes effect after a page reload."
          defaultValue={APP_CONFIG_DEFAULTS.renderer.orbitDampingFactor}
          value={c.renderer.orbitDampingFactor}
          min={0} max={0.9} step={0.05}
          onChange={v => set('renderer', 'orbitDampingFactor', v)}
        />
        <Field
          label="Orbit damping reference fps"
          tooltip="The frame rate the orbit damping factor is tuned for. The coast is re-derived from the real frame delta so it decays at a constant rate per second — without this, a heavy mesh that drops the frame rate makes the same drag coast for far longer and the model lags behind the cursor (sluggish, slow rotation). Leave at 60 unless you target a different refresh rate."
          defaultValue={APP_CONFIG_DEFAULTS.renderer.orbitDampingReferenceFps}
          value={c.renderer.orbitDampingReferenceFps}
          min={30} max={240} step={5}
          onChange={v => set('renderer', 'orbitDampingReferenceFps', v)}
        />
        <Field
          label="Max zoom-out factor"
          tooltip="How far you can zoom the camera out, as a multiple of the model's largest dimension. The default framing sits at roughly 2× that dimension, so a value of 12 lets you pull back about 6× from the default before hitting the limit. Lower it to keep the model filling more of the view; raise it for more room. Re-applied each time the model is framed."
          defaultValue={APP_CONFIG_DEFAULTS.renderer.maxZoomOutFactor}
          value={c.renderer.maxZoomOutFactor}
          min={3} max={100} step={1}
          onChange={v => set('renderer', 'maxZoomOutFactor', v)}
        />
        <Field
          label="Default zoom (framing)"
          tooltip="How zoomed-out the default view is, as a multiple of the model's largest dimension along each axis (view distance ≈ factor × 1.7 × that dimension). Higher leaves more margin around the model; lower fills more of the viewport. Applied on every fresh render and when you click Reset view."
          defaultValue={APP_CONFIG_DEFAULTS.renderer.defaultFrameFactor}
          value={c.renderer.defaultFrameFactor}
          min={1} max={3} step={0.1}
          onChange={v => set('renderer', 'defaultFrameFactor', v)}
        />
        <Field
          label="Orientation gizmo size"
          unit="px"
          tooltip="The canvas size in CSS pixels of the orientation gizmo (the XYZ cube in the viewport corner). Larger makes the axis labels easier to read; smaller keeps it out of the way. Takes effect after a page reload."
          defaultValue={APP_CONFIG_DEFAULTS.renderer.gizmoSizePx}
          value={c.renderer.gizmoSizePx}
          min={48} max={256} integer
          onChange={v => set('renderer', 'gizmoSizePx', v)}
        />
        <Field
          label="Orientation gizmo margin"
          unit="px"
          tooltip="Distance in CSS pixels from the viewport corner to the gizmo. Increase if the gizmo overlaps toolbar buttons; decrease to tuck it closer to the edge. Takes effect after a page reload."
          defaultValue={APP_CONFIG_DEFAULTS.renderer.gizmoMarginPx}
          value={c.renderer.gizmoMarginPx}
          min={0} max={32} integer
          onChange={v => set('renderer', 'gizmoMarginPx', v)}
        />
        <Field
          label="Gizmo hit radius"
          tooltip="How close (in gizmo orthographic units, range 0–2) your click must land to an axis label to trigger a snap. A larger radius makes the labels easier to click; a smaller radius requires more precision. Takes effect after a page reload."
          defaultValue={APP_CONFIG_DEFAULTS.renderer.gizmoHitRadius}
          value={c.renderer.gizmoHitRadius}
          min={0.1} max={1} step={0.05}
          onChange={v => set('renderer', 'gizmoHitRadius', v)}
        />
        <Field
          label="Gizmo snap duration"
          unit="s"
          tooltip="How long (in seconds) the animated snap-to-face transition takes when you click a gizmo axis label. Lower is snappier; higher is smoother. Takes effect after a page reload."
          defaultValue={APP_CONFIG_DEFAULTS.renderer.gizmoSnapDurationSec}
          value={c.renderer.gizmoSnapDurationSec}
          min={0.05} max={2} step={0.05}
          onChange={v => set('renderer', 'gizmoSnapDurationSec', v)}
        />
        <Field
          label="Offscreen renderer idle timeout"
          unit="ms"
          tooltip="The multi-view render panel (used for AI snapshots) keeps its WebGL renderer alive after a render in case another is requested soon. If no render is requested within this window, it disposes the WebGL context and canvas to free GPU memory. Lower this if you're memory-constrained; raise it if multi-view renders feel slow to start. Takes effect without reload."
          defaultValue={APP_CONFIG_DEFAULTS.renderer.offscreenIdleDisposeMs}
          value={c.renderer.offscreenIdleDisposeMs}
          min={1_000} max={300_000} integer
          onChange={v => set('renderer', 'offscreenIdleDisposeMs', v)}
        />
        <Field
          label="Pointer grace period"
          unit="ms"
          tooltip="How long after your last pointer movement the viewport continues rendering every frame (instead of only on demand). A longer grace period keeps the frame rate smooth during fast mouse movements; a shorter one conserves GPU time when you stop. Takes effect without reload."
          defaultValue={APP_CONFIG_DEFAULTS.renderer.pointerGraceMs}
          value={c.renderer.pointerGraceMs}
          min={50} max={2_000} integer
          onChange={v => set('renderer', 'pointerGraceMs', v)}
        />
        <Field
          label="Thumbnail generation timeout"
          unit="ms"
          tooltip="Max time to wait for a session thumbnail render before giving up and saving without one. Thumbnails are rendered in the background when a session is saved. On slow hardware or with very complex geometry, the render may take longer than the default. Increase if your session list shows blank thumbnails."
          defaultValue={APP_CONFIG_DEFAULTS.renderer.thumbnailTimeoutMs}
          value={c.renderer.thumbnailTimeoutMs}
          min={500} max={30_000} integer
          onChange={v => set('renderer', 'thumbnailTimeoutMs', v)}
        />
        <Field
          label="Enhance warn triangles"
          unit="tris"
          tooltip="When the Quality panel's Apply projects an enhance result above this triangle count, it asks for a Proceed/Cancel confirmation first — a model this dense is slow to display and edit."
          defaultValue={APP_CONFIG_DEFAULTS.renderer.enhanceWarnTriangles}
          value={c.renderer.enhanceWarnTriangles}
          min={10_000} max={50_000_000} integer
          onChange={v => set('renderer', 'enhanceWarnTriangles', v)}
        />
        <Field
          label="Enhance max triangles"
          unit="tris"
          tooltip="Hard ceiling on an enhance result. The geometry worker refuses to return a refined mesh larger than this, and Apply won't run a target above it — prevents a runaway refine from freezing the page when the giant result is committed to the viewport."
          defaultValue={APP_CONFIG_DEFAULTS.renderer.enhanceMaxTriangles}
          value={c.renderer.enhanceMaxTriangles}
          min={100_000} max={100_000_000} integer
          onChange={v => set('renderer', 'enhanceMaxTriangles', v)}
        />
        <Field
          label="Persist surface textures up to"
          unit="tris"
          tooltip="Computed api.surface.* textures are saved with the version so reopening the session renders them instantly. Above this triangle count the texture is not persisted (the version still saves; reopening just recomputes the texture on demand). A textured mesh costs roughly 18 bytes per triangle of storage."
          defaultValue={APP_CONFIG_DEFAULTS.renderer.surfaceTexturePersistMaxTriangles}
          value={c.renderer.surfaceTexturePersistMaxTriangles}
          min={0} max={20_000_000} integer
          onChange={v => set('renderer', 'surfaceTexturePersistMaxTriangles', v)}
        />
        <Field
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
        <Field
          label="STL weld tolerance"
          unit="units"
          hint="Initial vertex-merge threshold for STL imports. Larger = more aggressive welding."
          tooltip="STL files store triangles as disconnected vertex triplets — adjacent triangles share edge vertices by value, not by reference. The weld step merges vertices within this distance to create a proper manifold mesh. Too small: gaps remain and boolean operations fail. Too large: nearby-but-intentionally-separate vertices merge, distorting the geometry. The default 1e-5 works for most models; very small-scale precision models may need 1e-6 or smaller."
          defaultValue={APP_CONFIG_DEFAULTS.import.stlWeldTolerance}
          value={c.import.stlWeldTolerance}
          min={1e-8} max={0.1} step={1e-6}
          onChange={v => set('import', 'stlWeldTolerance', v)}
        />
        <Field
          label="Voxel default max size"
          unit="voxels"
          hint="Default max voxel grid dimension for image → voxel imports."
          tooltip="When importing an image as a voxel model, this caps the longest grid dimension. A 64-voxel grid produces at most 64×64×64 = 262,144 voxels. Larger grids produce more detailed models but take longer to mesh and paint. The import wizard lets you override this per-import; this is just the starting value."
          defaultValue={APP_CONFIG_DEFAULTS.import.voxelDefaultMaxSize}
          value={c.import.voxelDefaultMaxSize}
          min={4} max={256} integer
          onChange={v => set('import', 'voxelDefaultMaxSize', v)}
        />
        <Field
          label="Voxel heavy-model threshold"
          unit="voxels"
          hint="Voxel count above which the import wizard shows a performance warning."
          tooltip="The import wizard shows a 'this may be slow' warning when the resulting voxel count exceeds this threshold. The voxel mesher is linear in occupied voxels, so very large grids can take several seconds. Raise this if you have a fast machine and don't want the warning; lower it on slow hardware to get warned earlier."
          defaultValue={APP_CONFIG_DEFAULTS.import.voxelHeavyThreshold}
          value={c.import.voxelHeavyThreshold}
          min={10_000} max={5_000_000} integer
          onChange={v => set('import', 'voxelHeavyThreshold', v)}
        />
        <Field
          label="Voxel SDF sample budget"
          unit="cells"
          hint="Max lattice cells v.sdf() may sample in one call before it refuses."
          tooltip="When voxel code rasterizes an SDF expression with v.sdf(node), it samples the field once per voxel over the model's bounds. A tiny `res` over large bounds can explode into hundreds of millions of samples and freeze the engine. Past this budget the call throws and asks for a coarser `res` or tighter bounds. Raise it on a fast machine for very high-resolution SDF voxelization."
          defaultValue={APP_CONFIG_DEFAULTS.import.voxelSdfMaxSamples}
          value={c.import.voxelSdfMaxSamples}
          min={100_000} max={64_000_000} integer
          onChange={v => set('import', 'voxelSdfMaxSamples', v)}
        />
        <Field
          label="Relief max resolution"
          unit="px"
          hint="Maximum image resolution (pixels per side) for relief/keychain imports."
          tooltip="Relief and keychain imports downsample the source image to this resolution before generating depth geometry. Higher resolutions produce more detailed reliefs but take longer to process and generate more triangles. The default 512 px balances detail against performance; for intricate designs or very large prints, try 1024 px."
          defaultValue={APP_CONFIG_DEFAULTS.import.reliefMaxResolution}
          value={c.import.reliefMaxResolution}
          min={32} max={4096} integer
          onChange={v => set('import', 'reliefMaxResolution', v)}
        />
        <Field
          label="Remote fetch timeout"
          unit="ms"
          hint="Timeout for fetching a file by URL in the import-from-URL flow."
          tooltip="When you import a model or image by URL, the app fetches it with this timeout. Slow or geographically distant servers may need a longer timeout. If you frequently see 'fetch timed out' errors on large files from slow hosts, increase this value."
          defaultValue={APP_CONFIG_DEFAULTS.import.remoteFetchTimeoutMs}
          value={c.import.remoteFetchTimeoutMs}
          min={1_000} max={120_000} integer
          onChange={v => set('import', 'remoteFetchTimeoutMs', v)}
        />
        <Field
          label="Filament match threshold"
          hint="Color-distance threshold for filament swap matching (lower = stricter)."
          tooltip="The filament swap guide compares the relief's dominant colors against your filament palette using this distance threshold. Colors within this distance are considered a match. Smaller values require a very close color match before suggesting a swap; larger values are more permissive and may suggest swaps for loosely similar colors. The value is in perceptual color space (0–1 range)."
          defaultValue={APP_CONFIG_DEFAULTS.import.filamentMatchThreshold}
          value={c.import.filamentMatchThreshold}
          min={0.01} max={1} step={0.01}
          onChange={v => set('import', 'filamentMatchThreshold', v)}
        />
        <Field
          label="Filament confidence warn threshold"
          hint="Confidence score below which the swap guide shows a warning (0–1)."
          tooltip="When the filament swap guide's confidence in its color matching is below this score, it shows a caution indicator. A score of 0.9 means it warns unless it's 90%+ confident. Lower this to suppress warnings on ambiguous matches; raise it to be warned more readily."
          defaultValue={APP_CONFIG_DEFAULTS.import.filamentConfidenceWarnThreshold}
          value={c.import.filamentConfidenceWarnThreshold}
          min={0.1} max={1} step={0.05}
          onChange={v => set('import', 'filamentConfidenceWarnThreshold', v)}
        />
        <Field
          label="Convert-to-code cell budget"
          unit="cells"
          hint="levelSet resolution budget for convertToCode at 'standard' quality."
          tooltip="Converting a mesh import to code rebuilds it as a smooth levelSet whose grid resolution is derived from this sample budget (draft quality = ×0.25, fine = ×4). More cells = a smoother, more faithful remake but a slower build — build time is roughly proportional to this number. 6M ≈ ten seconds on a mid-size model."
          defaultValue={APP_CONFIG_DEFAULTS.import.reconstructCellBudget}
          value={c.import.reconstructCellBudget}
          min={200_000} max={100_000_000} integer
          onChange={v => set('import', 'reconstructCellBudget', v)}
        />
        <Field
          label="Reconstruction eval samples"
          unit="points"
          hint="Surface samples per mesh for convertToCode / evalAgainstImport reports."
          tooltip="The faithfulness report (chamfer/hausdorff) samples this many points on each surface and measures nearest-neighbor distances. More samples tighten the measurement's noise floor (reported as sampleSpacing) at the cost of a slower report."
          defaultValue={APP_CONFIG_DEFAULTS.import.reconstructEvalSamples}
          value={c.import.reconstructEvalSamples}
          min={500} max={100_000} integer
          onChange={v => set('import', 'reconstructEvalSamples', v)}
        />
      </Section>

      <Section title="Geometry warnings">
        <Field
          label="Triangle-count warning budget"
          unit="triangles"
          hint="Live model warns above this triangle count."
          tooltip="When the model exceeds this many triangles, the geometry warnings (shown to you and to the AI agent) flag it as heavy to slice and over the catalog budget. Mirrors the headless model:preview tri-budget warning. Raise it if you routinely build dense organic models; lower it to be nudged toward lighter geometry sooner."
          defaultValue={APP_CONFIG_DEFAULTS.geometry.triCountWarnBudget}
          value={c.geometry.triCountWarnBudget}
          min={10_000} max={2_000_000} integer
          onChange={v => set('geometry', 'triCountWarnBudget', v)}
        />
        <Field
          label="Minimum edge-length warning"
          unit="units (≈mm)"
          hint="Warns when the smallest mesh edge is below this."
          tooltip="Features whose mesh edges fall below a typical FDM extrusion width silently disappear on the print. When the shortest edge is under this threshold, the geometry warnings flag possible sub-extrusion detail. Mirrors model:preview's sub-0.4 mm detail warning. Lower it if you print on a fine nozzle; raise it for chunky FDM."
          defaultValue={APP_CONFIG_DEFAULTS.geometry.minEdgeLengthWarn}
          value={c.geometry.minEdgeLengthWarn}
          min={0} max={5} step={0.05}
          onChange={v => set('geometry', 'minEdgeLengthWarn', v)}
        />
        <Field
          label="Aspect-ratio warning"
          unit=": 1"
          hint="Warns when longest ÷ shortest dimension exceeds this."
          tooltip="Tall, thin parts (high bounding-box aspect ratio) are fragile and tip-prone on an FDM bed. When the ratio of the longest to the shortest non-zero dimension exceeds this, the geometry warnings flag it. Mirrors model:preview. Raise it if you intentionally build slender parts; lower it to be warned earlier."
          defaultValue={APP_CONFIG_DEFAULTS.geometry.aspectRatioWarn}
          value={c.geometry.aspectRatioWarn}
          min={2} max={100} step={1}
          onChange={v => set('geometry', 'aspectRatioWarn', v)}
        />
      </Section>

      <Section title="UI">
        <ToggleField
          label="Show editor hints"
          hint={'The "Did you know?" strip at the top of the editor that rotates through tips. Off hides it everywhere; the strip’s ✕ only hides it for the current tab.'}
          defaultValue={APP_CONFIG_DEFAULTS.ui.editorHintsEnabled}
          value={c.ui.editorHintsEnabled}
          onChange={v => set('ui', 'editorHintsEnabled', v)}
        />
        <Field
          label="Hint rotation interval"
          unit="ms"
          hint="How long each editor hint shows before the strip rotates to the next."
          tooltip="The 'Did you know?' strip auto-advances to the next tip after this long. Hovering the strip pauses rotation; the ‹ › arrows step manually. Raise it to read each tip longer; lower it to cycle faster."
          defaultValue={APP_CONFIG_DEFAULTS.ui.hintRotationMs}
          value={c.ui.hintRotationMs}
          min={3_000} max={60_000} integer
          onChange={v => set('ui', 'hintRotationMs', v)}
        />
        <Field
          label="Toast duration"
          unit="ms"
          hint="How long notification toasts stay on screen."
          tooltip="The duration notifications (save confirmations, export success/error, etc.) remain visible before automatically dismissing. Raise this if you miss toasts; lower it if they feel intrusive."
          defaultValue={APP_CONFIG_DEFAULTS.ui.toastDurationMs}
          value={c.ui.toastDurationMs}
          min={500} max={15_000} integer
          onChange={v => set('ui', 'toastDurationMs', v)}
        />
        <Field
          label="Pane slide"
          unit="ms"
          hint="How long the side panes (AI panel, code editor) take to slide open/closed."
          tooltip="The docked AI panel and code editor pane animate their layout so the viewport grows/shrinks smoothly instead of snapping. Lower for a snappier toggle, 0 for instant. Ignored when your OS is set to reduce motion."
          defaultValue={APP_CONFIG_DEFAULTS.ui.paneSlideMs}
          value={c.ui.paneSlideMs}
          min={0} max={600} integer
          onChange={v => set('ui', 'paneSlideMs', v)}
        />
        <Field
          label="Default palette capacity"
          hint="How many filament slots the paint panel assumes your printer has."
          tooltip="The default number of colour slots (e.g. 4 for one Bambu AMS). Drives the paint panel's over-budget warning when a model uses more colours than your printer can load. Never blocks painting or export — it's just a heads-up."
          defaultValue={APP_CONFIG_DEFAULTS.ui.defaultPaletteCapacity}
          value={c.ui.defaultPaletteCapacity}
          min={1} max={16} integer
          onChange={v => set('ui', 'defaultPaletteCapacity', v)}
        />
        <Field
          label="Palette history size"
          hint="How many recent colours the palette keeps in its history."
          tooltip="The size of the palette's recent-colour history ring. Raise it to keep more previously-used colours one click away; lower it to keep the history compact."
          defaultValue={APP_CONFIG_DEFAULTS.ui.paletteHistoryMax}
          value={c.ui.paletteHistoryMax}
          min={8} max={256} integer
          onChange={v => set('ui', 'paletteHistoryMax', v)}
        />
        <Field
          label="Tooltip delay"
          unit="ms"
          hint="Hover delay before a tooltip appears."
          tooltip="How long you must hover over a button or icon before its tooltip appears. Set to 0 for instant tooltips; increase if tooltips appear too eagerly while you move the mouse across the toolbar."
          defaultValue={APP_CONFIG_DEFAULTS.ui.tooltipDelayMs}
          value={c.ui.tooltipDelayMs}
          min={0} max={2000} integer
          onChange={v => set('ui', 'tooltipDelayMs', v)}
        />
        <Field
          label="Default editor font size"
          unit="px"
          hint="Seeds a fresh tab; change the live size from the editor's ⚙ menu (−/+)."
          tooltip="The code editor's starting font size. The active size is remembered per browser tab via the ⚙ Editor menu's −/+ stepper; this default applies to a fresh tab and is the value the stepper returns to. Must sit within the min/max bounds below."
          defaultValue={APP_CONFIG_DEFAULTS.ui.editorFontSizeDefault}
          value={c.ui.editorFontSizeDefault}
          min={6} max={48} integer
          onChange={v => set('ui', 'editorFontSizeDefault', v)}
        />
        <Field
          label="Min editor font size"
          unit="px"
          hint="Lower bound for the editor's −/+ font stepper."
          tooltip="The smallest font size the editor's ⚙ menu −/+ stepper will go down to."
          defaultValue={APP_CONFIG_DEFAULTS.ui.editorFontSizeMin}
          value={c.ui.editorFontSizeMin}
          min={6} max={24} integer
          onChange={v => set('ui', 'editorFontSizeMin', v)}
        />
        <Field
          label="Max editor font size"
          unit="px"
          hint="Upper bound for the editor's −/+ font stepper."
          tooltip="The largest font size the editor's ⚙ menu −/+ stepper will go up to."
          defaultValue={APP_CONFIG_DEFAULTS.ui.editorFontSizeMax}
          value={c.ui.editorFontSizeMax}
          min={12} max={64} integer
          onChange={v => set('ui', 'editorFontSizeMax', v)}
        />
        <Field
          label="Code editor error idle delay"
          unit="ms"
          tooltip="After you stop typing, the code editor waits this long before showing error annotations (red underlines, error panel). This prevents the error display from flickering while you're mid-edit. Lower it for faster feedback; raise it if error annotations distract you while typing."
          defaultValue={APP_CONFIG_DEFAULTS.ui.codeEditorErrorIdleMs}
          value={c.ui.codeEditorErrorIdleMs}
          min={0} max={5_000} integer
          onChange={v => set('ui', 'codeEditorErrorIdleMs', v)}
        />
        <Field
          label="Code editor bottom-scroll stabilizer"
          unit="ms"
          tooltip="When the code editor is scrolled near the very bottom, real Chrome can snap the visible code by a line whenever CodeMirror re-measures (a focus change, opening a tool menu/panel, etc.). The stabilizer reverts that one-line snap so the code doesn't stutter, while always honoring real scrolling. This is the input-grace window: a wheel/scrollbar/touch/keyboard scroll within this window is treated as your intent and never reverted. Set to 0 to disable."
          defaultValue={APP_CONFIG_DEFAULTS.ui.codeEditorScrollPinMs}
          value={c.ui.codeEditorScrollPinMs}
          min={0} max={1_000} integer
          onChange={v => set('ui', 'codeEditorScrollPinMs', v)}
        />
        <Field
          label="Companion draft autosave debounce"
          unit="ms"
          tooltip="After you stop typing in a SCAD companion file, the editor waits this long before autosaving the draft so the edit survives a reload. Coalesces keystrokes so IndexedDB isn't written on every key. Lower it to capture edits sooner; raise it to write less often."
          defaultValue={APP_CONFIG_DEFAULTS.ui.companionDraftDebounceMs}
          value={c.ui.companionDraftDebounceMs}
          min={0} max={5_000} integer
          onChange={v => set('ui', 'companionDraftDebounceMs', v)}
        />
        <Field
          label="Working-view camera save debounce"
          unit="ms"
          tooltip="After you finish orbiting or zooming the 3D viewport, the app waits this long before saving the camera angle to the session so it's restored on reload. Coalesces a burst of adjustments into one write. Lower it to capture the angle sooner; raise it to write less often."
          defaultValue={APP_CONFIG_DEFAULTS.ui.workCameraSaveDebounceMs}
          value={c.ui.workCameraSaveDebounceMs}
          min={0} max={5_000} integer
          onChange={v => set('ui', 'workCameraSaveDebounceMs', v)}
        />
        <Field
          label="Surface preview debounce"
          unit="ms"
          tooltip="When adjusting parameters in the surface-modifier panel (texture, fuzzy, etc.), this debounce delays the preview render until you've stopped changing values for this long. Lower it for more responsive live preview; raise it if previewing is slow on your machine."
          defaultValue={APP_CONFIG_DEFAULTS.ui.surfacePreviewDebounceMs}
          value={c.ui.surfacePreviewDebounceMs}
          min={0} max={2_000} integer
          onChange={v => set('ui', 'surfacePreviewDebounceMs', v)}
        />
        <Field
          label="Character preview debounce"
          unit="ms"
          tooltip="Debounce delay for the Character Creator's live figure preview. An SDF figure rebuild is heavy, so this is longer than the surface debounce — it coalesces rapid slider edits into a single rebuild once you settle. Lower for snappier preview; raise if rebuilds stack up."
          defaultValue={APP_CONFIG_DEFAULTS.ui.characterPreviewDebounceMs}
          value={c.ui.characterPreviewDebounceMs}
          min={0} max={3_000} integer
          onChange={v => set('ui', 'characterPreviewDebounceMs', v)}
        />
        <Field
          label="Relief 2D preview debounce"
          unit="ms"
          tooltip="Debounce delay for the 2D image preview in the relief import wizard. While you adjust sliders (brightness, contrast, depth), this delay prevents a new preview from firing on every pixel of slider movement. Lower = more responsive; raise if CPU spikes during slider drag."
          defaultValue={APP_CONFIG_DEFAULTS.ui.reliefPreviewDebounceMs}
          value={c.ui.reliefPreviewDebounceMs}
          min={0} max={2_000} integer
          onChange={v => set('ui', 'reliefPreviewDebounceMs', v)}
        />
        <Field
          label="Relief 3D preview debounce"
          unit="ms"
          tooltip="Debounce delay for the 3D geometry preview in the relief import wizard. The 3D preview involves geometry generation, which is more expensive than the 2D preview — this longer default avoids re-generating on every incremental slider change."
          defaultValue={APP_CONFIG_DEFAULTS.ui.reliefPreview3dDebounceMs}
          value={c.ui.reliefPreview3dDebounceMs}
          min={0} max={2_000} integer
          onChange={v => set('ui', 'reliefPreview3dDebounceMs', v)}
        />
        <Field
          label="Progress modal show delay"
          unit="ms"
          tooltip="The progress overlay (shown during paint subdivision, simplify, and other multi-second operations) waits this long before appearing. Operations that finish faster than this delay show no overlay at all — avoiding a flash for quick operations. Raise it to keep the overlay from appearing on fast machines; lower it to see progress sooner on slow ones."
          defaultValue={APP_CONFIG_DEFAULTS.ui.progressModalShowDelayMs}
          value={c.ui.progressModalShowDelayMs}
          min={0} max={2_000} integer
          onChange={v => set('ui', 'progressModalShowDelayMs', v)}
        />
        <Field
          label="Session lock heartbeat"
          unit="ms"
          tooltip="How often the active tab broadcasts its 'I am the session leader' heartbeat to other tabs watching the same session. If this tab goes silent (tab crash, sleep), other tabs detect staleness after the stale threshold elapses and take over. Reduce for faster failover detection; increase to reduce cross-tab storage activity."
          defaultValue={APP_CONFIG_DEFAULTS.ui.sessionLockHeartbeatMs}
          value={c.ui.sessionLockHeartbeatMs}
          min={500} max={30_000} integer
          onChange={v => set('ui', 'sessionLockHeartbeatMs', v)}
        />
        <Field
          label="Session lock stale threshold"
          unit="ms"
          hint="Time after which a silent heartbeat is considered stale."
          tooltip="If the active tab's heartbeat hasn't been seen for this long, other tabs treat the session lock as stale and compete to take over. This should be at least 2–3× the heartbeat interval to avoid false positives (a single missed heartbeat shouldn't trigger takeover). Raise it if you see unexpected session takeovers during normal use."
          defaultValue={APP_CONFIG_DEFAULTS.ui.sessionLockStaleMs}
          value={c.ui.sessionLockStaleMs}
          min={1_000} max={60_000} integer
          onChange={v => set('ui', 'sessionLockStaleMs', v)}
        />
        <Field
          label="Default geometry quality"
          unit="segments"
          hint="Default circular segment count for manifold-js and BREP renders. 128 = Very High. Takes effect on next page load."
          tooltip="Controls how many segments are used for circles and curved surfaces in manifold-js and BREP geometry. More segments = smoother curves, more triangles, slower renders. Named presets: Low=16, Medium=32, High=64, Very High=128, Ultra=1024. Enter any value from 3–4096; values not matching a preset use 'Custom' mode. Takes effect on next page load."
          defaultValue={APP_CONFIG_DEFAULTS.ui.defaultQuality}
          value={c.ui.defaultQuality}
          min={3} max={4096} integer
          onChange={v => set('ui', 'defaultQuality', v)}
        />
        <Field
          label="Default OpenSCAD quality ($fn)"
          unit="segments"
          hint="Default $fn for OpenSCAD renders. 32 = Medium. Takes effect on next page load."
          tooltip="Controls the default $fn value used when rendering OpenSCAD code. Higher values produce smoother curves but much slower renders, since SCAD recompiles the full model on every run. Named presets: Low=16, Medium=32, High=64, Very High=128, Ultra=1024. Takes effect on next page load."
          defaultValue={APP_CONFIG_DEFAULTS.ui.scadDefaultQuality}
          value={c.ui.scadDefaultQuality}
          min={3} max={4096} integer
          onChange={v => set('ui', 'scadDefaultQuality', v)}
        />
        <Field
          label="Worker run-history size"
          unit="runs"
          hint="Recent geometry runs kept in the worker health panel."
          tooltip="The Workers half of the ⚠ Diagnostics panel keeps the last N geometry runs in memory with their wall-clock and worker-side timing. Older runs are evicted when the buffer is full. Increase to keep more history for spotting slow-render patterns; decrease to reduce memory use."
          defaultValue={APP_CONFIG_DEFAULTS.ui.workerRunHistorySize}
          value={c.ui.workerRunHistorySize}
          min={10} max={500} integer
          onChange={v => set('ui', 'workerRunHistorySize', v)}
        />
        <Field
          label="Worker panel refresh"
          unit="ms"
          hint="How often the Diagnostics panel re-polls worker in-flight counts while open."
          tooltip="The Workers half of the Diagnostics panel polls live values (in-flight operation counts, worker liveness) on this interval, since those change without firing an update event. Lower = snappier live readout, slightly more work while the panel is open. Only affects the panel while it's visible."
          defaultValue={APP_CONFIG_DEFAULTS.ui.workerPanelRefreshMs}
          value={c.ui.workerPanelRefreshMs}
          min={200} max={10_000} integer
          onChange={v => set('ui', 'workerPanelRefreshMs', v)}
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

export function showAdvancedSettingsModal(): void {
  const cfg = signal<AppConfig>(cloneConfig(loadAppConfig()));

  function handleReset(): void {
    resetAppConfig();
    cfg.value = cloneConfig(loadAppConfig());
  }

  mountPreactModal(
    { title: 'Settings', scrollable: true },
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
