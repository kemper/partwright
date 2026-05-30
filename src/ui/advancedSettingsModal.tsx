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
  /** Shown after the number input in muted text, e.g. "ms" or "px". */
  unit?: string;
  /** Hint displayed under the field. */
  hint?: string;
  /** Suffix appended when the value differs from default, e.g. "default: 8". */
  defaultValue: number;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  /** When true the input shows an integer spinner (step defaults to 1). */
  integer?: boolean;
  onChange: (v: number) => void;
}

function Field(props: FieldProps) {
  const { label, unit, hint, defaultValue, value, min, max, step, integer, onChange } = props;
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
          defaultValue={APP_CONFIG_DEFAULTS.ai.maxConsecutiveAutoResumes}
          value={c.ai.maxConsecutiveAutoResumes}
          min={1} max={64} integer
          onChange={v => set('ai', 'maxConsecutiveAutoResumes', v)}
        />
        <Field
          label="Slow-tool warning threshold"
          unit="ms"
          hint="Tool calls exceeding this time emit a console warning (does not affect behavior)."
          defaultValue={APP_CONFIG_DEFAULTS.ai.slowToolMs}
          value={c.ai.slowToolMs}
          min={50} max={30_000} integer
          onChange={v => set('ai', 'slowToolMs', v)}
        />
        <Field
          label="Tool-call timeout (Worker)"
          unit="ms"
          hint="If the main thread doesn't reply to a tool call within this time, the Worker aborts it."
          defaultValue={APP_CONFIG_DEFAULTS.ai.toolCallTimeoutMs}
          value={c.ai.toolCallTimeoutMs}
          min={5_000} max={600_000} integer
          onChange={v => set('ai', 'toolCallTimeoutMs', v)}
        />
        <Field
          label="Diagnostics ring-buffer size"
          unit="events"
          hint="Max AI call log entries kept in memory."
          defaultValue={APP_CONFIG_DEFAULTS.ai.diagnosticsRingSize}
          value={c.ai.diagnosticsRingSize}
          min={10} max={500} integer
          onChange={v => set('ai', 'diagnosticsRingSize', v)}
        />
        <Field
          label="Max recent attachments"
          unit="images"
          hint="Images kept in the recent-attachments picker (IndexedDB rows)."
          defaultValue={APP_CONFIG_DEFAULTS.ai.maxAttachments}
          value={c.ai.maxAttachments}
          min={1} max={100} integer
          onChange={v => set('ai', 'maxAttachments', v)}
        />
      </Section>

      <Section title="AI — thinking budgets">
        <div class="text-[10px] text-zinc-500 leading-snug">Anthropic extended-thinking token budgets (tokens).</div>
        <Field
          label="Anthropic — Low"
          unit="tokens"
          defaultValue={APP_CONFIG_DEFAULTS.ai.thinkingBudgetAnthropicLow}
          value={c.ai.thinkingBudgetAnthropicLow}
          min={1024} max={100_000} integer
          onChange={v => set('ai', 'thinkingBudgetAnthropicLow', v)}
        />
        <Field
          label="Anthropic — Medium"
          unit="tokens"
          defaultValue={APP_CONFIG_DEFAULTS.ai.thinkingBudgetAnthropicMedium}
          value={c.ai.thinkingBudgetAnthropicMedium}
          min={1024} max={100_000} integer
          onChange={v => set('ai', 'thinkingBudgetAnthropicMedium', v)}
        />
        <Field
          label="Anthropic — High"
          unit="tokens"
          defaultValue={APP_CONFIG_DEFAULTS.ai.thinkingBudgetAnthropicHigh}
          value={c.ai.thinkingBudgetAnthropicHigh}
          min={1024} max={200_000} integer
          onChange={v => set('ai', 'thinkingBudgetAnthropicHigh', v)}
        />
        <div class="text-[10px] text-zinc-500 leading-snug mt-1">Gemini thinking budgets (tokens).</div>
        <Field
          label="Gemini — Low"
          unit="tokens"
          defaultValue={APP_CONFIG_DEFAULTS.ai.thinkingBudgetGeminiLow}
          value={c.ai.thinkingBudgetGeminiLow}
          min={1024} max={100_000} integer
          onChange={v => set('ai', 'thinkingBudgetGeminiLow', v)}
        />
        <Field
          label="Gemini — Medium"
          unit="tokens"
          defaultValue={APP_CONFIG_DEFAULTS.ai.thinkingBudgetGeminiMedium}
          value={c.ai.thinkingBudgetGeminiMedium}
          min={1024} max={100_000} integer
          onChange={v => set('ai', 'thinkingBudgetGeminiMedium', v)}
        />
        <Field
          label="Gemini — High"
          unit="tokens"
          defaultValue={APP_CONFIG_DEFAULTS.ai.thinkingBudgetGeminiHigh}
          value={c.ai.thinkingBudgetGeminiHigh}
          min={1024} max={200_000} integer
          onChange={v => set('ai', 'thinkingBudgetGeminiHigh', v)}
        />
        <Field
          label="Anthropic answer headroom"
          unit="tokens"
          hint="Output token headroom above the thinking budget (API requires max_tokens > budget)."
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
          defaultValue={APP_CONFIG_DEFAULTS.ai.maxOutputTokensAnthropic}
          value={c.ai.maxOutputTokensAnthropic}
          min={1024} max={200_000} integer
          onChange={v => set('ai', 'maxOutputTokensAnthropic', v)}
        />
        <Field
          label="OpenAI max output tokens"
          unit="tokens"
          defaultValue={APP_CONFIG_DEFAULTS.ai.maxOutputTokensOpenai}
          value={c.ai.maxOutputTokensOpenai}
          min={1024} max={200_000} integer
          onChange={v => set('ai', 'maxOutputTokensOpenai', v)}
        />
        <Field
          label="Gemini max output tokens"
          unit="tokens"
          hint="Combined ceiling for reasoning + answer on thinking models."
          defaultValue={APP_CONFIG_DEFAULTS.ai.maxOutputTokensGemini}
          value={c.ai.maxOutputTokensGemini}
          min={1024} max={500_000} integer
          onChange={v => set('ai', 'maxOutputTokensGemini', v)}
        />
        <Field
          label="Chars-per-token estimate"
          unit="chars"
          hint="Rough ratio used for token-count estimation in the context meter."
          defaultValue={APP_CONFIG_DEFAULTS.ai.charsPerToken}
          value={c.ai.charsPerToken}
          min={1} max={20}
          onChange={v => set('ai', 'charsPerToken', v)}
        />
        <Field
          label="Image token estimate"
          unit="tokens"
          hint="Estimated tokens per attached image block (used in the context meter)."
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
          defaultValue={APP_CONFIG_DEFAULTS.renderer.fov}
          value={c.renderer.fov}
          min={10} max={120} integer
          onChange={v => set('renderer', 'fov', v)}
        />
        <Field
          label="Max device pixel ratio"
          hint="Cap on devicePixelRatio. Lower = less GPU work; higher = sharper on HiDPI screens."
          defaultValue={APP_CONFIG_DEFAULTS.renderer.maxPixelRatio}
          value={c.renderer.maxPixelRatio}
          min={0.5} max={4} step={0.5}
          onChange={v => set('renderer', 'maxPixelRatio', v)}
        />
        <Field
          label="Interaction render scale"
          hint="Render resolution fraction during orbit/pan/zoom (0–1, lower = faster)."
          defaultValue={APP_CONFIG_DEFAULTS.renderer.interactionRenderScale}
          value={c.renderer.interactionRenderScale}
          min={0.1} max={1} step={0.05}
          onChange={v => set('renderer', 'interactionRenderScale', v)}
        />
        <Field
          label="Grid size"
          unit="units"
          defaultValue={APP_CONFIG_DEFAULTS.renderer.gridSize}
          value={c.renderer.gridSize}
          min={4} max={1000} integer
          onChange={v => set('renderer', 'gridSize', v)}
        />
        <Field
          label="Grid divisions"
          defaultValue={APP_CONFIG_DEFAULTS.renderer.gridDivisions}
          value={c.renderer.gridDivisions}
          min={2} max={200} integer
          onChange={v => set('renderer', 'gridDivisions', v)}
        />
      </Section>

      <Section title="Import">
        <Field
          label="STL weld tolerance"
          unit="units"
          hint="Initial vertex-merge threshold for STL imports. Larger = more aggressive welding."
          defaultValue={APP_CONFIG_DEFAULTS.import.stlWeldTolerance}
          value={c.import.stlWeldTolerance}
          min={1e-8} max={0.1} step={1e-6}
          onChange={v => set('import', 'stlWeldTolerance', v)}
        />
        <Field
          label="Voxel default max size"
          unit="voxels"
          hint="Default max voxel grid dimension for image → voxel imports."
          defaultValue={APP_CONFIG_DEFAULTS.import.voxelDefaultMaxSize}
          value={c.import.voxelDefaultMaxSize}
          min={4} max={256} integer
          onChange={v => set('import', 'voxelDefaultMaxSize', v)}
        />
        <Field
          label="Voxel heavy-model threshold"
          unit="voxels"
          hint="Voxel count above which the import wizard shows a performance warning."
          defaultValue={APP_CONFIG_DEFAULTS.import.voxelHeavyThreshold}
          value={c.import.voxelHeavyThreshold}
          min={10_000} max={5_000_000} integer
          onChange={v => set('import', 'voxelHeavyThreshold', v)}
        />
        <Field
          label="Relief max resolution"
          unit="px"
          hint="Maximum image resolution (pixels per side) for relief/keychain imports."
          defaultValue={APP_CONFIG_DEFAULTS.import.reliefMaxResolution}
          value={c.import.reliefMaxResolution}
          min={32} max={4096} integer
          onChange={v => set('import', 'reliefMaxResolution', v)}
        />
      </Section>

      <Section title="UI">
        <Field
          label="Toast duration"
          unit="ms"
          hint="How long notification toasts stay on screen."
          defaultValue={APP_CONFIG_DEFAULTS.ui.toastDurationMs}
          value={c.ui.toastDurationMs}
          min={500} max={15_000} integer
          onChange={v => set('ui', 'toastDurationMs', v)}
        />
        <Field
          label="Tooltip delay"
          unit="ms"
          hint="Hover delay before a tooltip appears."
          defaultValue={APP_CONFIG_DEFAULTS.ui.tooltipDelayMs}
          value={c.ui.tooltipDelayMs}
          min={0} max={2000} integer
          onChange={v => set('ui', 'tooltipDelayMs', v)}
        />
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
