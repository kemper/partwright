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

  function set<S extends keyof AppConfig>(section: S, key: keyof AppConfig[S], value: number): void {
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
          hint="If the main thread doesn't reply to a tool call within this time, the Worker aborts it."
          tooltip="The AI agent runs in a background Worker and calls tools (geometry execution, rendering, etc.) on the main thread. If the main thread doesn't respond within this timeout — e.g. because WASM initialization is still in progress or the browser is paused — the Worker treats the call as failed and surfaces an error. Increase for very slow machines or complex BREP/SCAD evaluations."
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
      </Section>

      <Section title="AI — geometry timeouts">
        <div class="text-[10px] text-zinc-500 leading-snug">Execution timeout per modeling engine. The engine Worker is restarted if a run exceeds the ceiling.</div>
        <Field
          label="Manifold-JS timeout"
          unit="ms"
          tooltip="Wall-clock ceiling for a single manifold-js geometry evaluation. If the code run exceeds this, the engine Worker is restarted and an error is surfaced. The manifold-3d kernel is typically fast — this mainly guards against infinite loops in user code. Increase for extremely complex mesh operations."
          defaultValue={APP_CONFIG_DEFAULTS.ai.geometryTimeoutManifoldMs}
          value={c.ai.geometryTimeoutManifoldMs}
          min={5_000} max={600_000} integer
          onChange={v => set('ai', 'geometryTimeoutManifoldMs', v)}
        />
        <Field
          label="OpenSCAD timeout"
          unit="ms"
          tooltip="Wall-clock ceiling for a single OpenSCAD evaluation. SCAD compiles BOSL2-style libraries from source on every run, and complex gear or thread models can legitimately take over a minute on slow hardware. The 3-minute default gives ample headroom for heavy parametric models."
          defaultValue={APP_CONFIG_DEFAULTS.ai.geometryTimeoutScadMs}
          value={c.ai.geometryTimeoutScadMs}
          min={5_000} max={600_000} integer
          onChange={v => set('ai', 'geometryTimeoutScadMs', v)}
        />
        <Field
          label="BREP/replicad timeout"
          unit="ms"
          tooltip="Wall-clock ceiling for a single replicad/OpenCASCADE evaluation. OCCT Boolean operations on complex STEP-imported assemblies can rival SCAD's worst cases. Increase if you're working with large imported STEP files or heavily-filleted BREP models."
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
          label="Grid size"
          unit="units"
          tooltip="The total side length of the ground-plane grid in model units. If your models are typically 200 units wide, set this to 400 or so to keep the grid visible around them. Takes effect after a page reload."
          defaultValue={APP_CONFIG_DEFAULTS.renderer.gridSize}
          value={c.renderer.gridSize}
          min={4} max={1000} integer
          onChange={v => set('renderer', 'gridSize', v)}
        />
        <Field
          label="Grid divisions"
          tooltip="The number of cells the grid is divided into. Combined with grid size this sets the cell size: a 40-unit grid with 40 divisions gives 1-unit cells. Takes effect after a page reload."
          defaultValue={APP_CONFIG_DEFAULTS.renderer.gridDivisions}
          value={c.renderer.gridDivisions}
          min={2} max={200} integer
          onChange={v => set('renderer', 'gridDivisions', v)}
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
      </Section>

      <Section title="UI">
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
          label="Code editor error idle delay"
          unit="ms"
          tooltip="After you stop typing, the code editor waits this long before showing error annotations (red underlines, error panel). This prevents the error display from flickering while you're mid-edit. Lower it for faster feedback; raise it if error annotations distract you while typing."
          defaultValue={APP_CONFIG_DEFAULTS.ui.codeEditorErrorIdleMs}
          value={c.ui.codeEditorErrorIdleMs}
          min={0} max={5_000} integer
          onChange={v => set('ui', 'codeEditorErrorIdleMs', v)}
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
    { title: 'Advanced Settings', scrollable: true },
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
