// Static model catalog backed by a build-time snapshot of models.dev data.
//
// The snapshot at src/ai/generated/modelsCatalog.json is refreshed by
// `scripts/refreshModelsSnapshot.mjs` (run weekly by the refresh-models-catalog
// scheduled Claude trigger, which opens a PR into main), filtered to providers
// we wire up (anthropic / openai / google) and to models whose `release_date` is
// within the last year. That keeps the bundle small and the picker focused on
// current models without us hand-maintaining the list.
//
// Source of truth for: per-provider picker menus, USD pricing for the cost
// meter, the reasoning/vision capability flags that drive endpoint routing,
// and the context/output token limits that flow into request builders and
// auto-compaction. Anything not in the snapshot falls back to a per-provider
// hardcoded default — that's the path for custom user-typed ids (dated
// snapshots, brand-new models the snapshot hasn't ingested yet) plus the
// always-present back-compat ids in settings.ts.
//
// 'google' in models.dev maps to our 'gemini' provider, and 'local' has no
// catalog entry (the WebLLM model registry lives in localModels.ts).

import catalogJson from './generated/modelsCatalog.json' with { type: 'json' };
import type { Provider } from './types';

interface RawCost {
  input: number;
  output: number;
  cache_read?: number;
  cache_write?: number;
  reasoning?: number;
  tiers?: RawCostTier[];
}

interface RawCostTier {
  tier: { size: number; type?: 'context' };
  input: number;
  output: number;
  cache_read?: number;
  cache_write?: number;
}

interface RawLimit {
  context: number;
  output: number;
  input?: number;
}

interface RawModalities {
  input: string[];
  output: string[];
}

interface RawModel {
  id?: string;
  name: string;
  family?: string;
  release_date: string;
  last_updated?: string;
  knowledge?: string;
  attachment: boolean;
  reasoning: boolean;
  tool_call: boolean;
  structured_output?: boolean;
  temperature?: boolean;
  open_weights?: boolean;
  modalities: RawModalities;
  limit: RawLimit;
  cost?: RawCost;
}

interface RawProvider {
  id: string;
  name: string;
  doc?: string;
  npm?: string;
  models: Record<string, RawModel>;
}

type RawCatalog = Record<string, RawProvider>;

const CATALOG = catalogJson as unknown as RawCatalog;

/** models.dev publishes Gemini models under the 'google' provider id.
 *  'local' (WebLLM) and 'custom' (a user-supplied OpenAI-compatible endpoint)
 *  have no catalog entry, so they're excluded here and `rawProvider` returns
 *  null for them — callers then fall back to their per-provider defaults. */
const CATALOG_PROVIDER_ID: Record<Exclude<Provider, 'local' | 'custom'>, string> = {
  anthropic: 'anthropic',
  openai: 'openai',
  gemini: 'google',
};

/** Camel-cased shape exposed to callers — the rest of the codebase uses
 *  camelCase (TurnUsage.cacheReadInputTokens, etc.). */
export interface CatalogPricing {
  /** USD per 1M input tokens. */
  input: number;
  /** USD per 1M output tokens. */
  output: number;
  /** USD per 1M cache-read tokens (Anthropic, OpenAI). */
  cacheRead?: number;
  /** USD per 1M cache-write tokens (Anthropic only — OpenAI prices cache
   *  reads at a discount automatically and surfaces no separate write line). */
  cacheWrite?: number;
  /** USD per 1M reasoning tokens — present on a few models that meter
   *  thinking separately from output. */
  reasoning?: number;
  /** Sorted-ascending pricing tiers that kick in once the input exceeds a
   *  context size. Gemini's >200k bracket is the canonical case. */
  tiers?: CatalogPricingTier[];
}

export interface CatalogPricingTier {
  /** Total input-token threshold above which this tier's rates apply. */
  thresholdTokens: number;
  input: number;
  output: number;
  cacheRead?: number;
  cacheWrite?: number;
}

export interface CatalogCapabilities {
  reasoning: boolean;
  toolCall: boolean;
  /** Vision / pdf / file inputs supported. */
  attachment: boolean;
  structuredOutput: boolean;
  /** Input modalities the model accepts ('text' | 'image' | 'audio' | 'video' | 'pdf'). */
  modalitiesIn: string[];
}

export interface CatalogLimits {
  /** Total context window. */
  context: number;
  /** Max output tokens per response. */
  output: number;
  /** Max input tokens — present on a subset of models. */
  input?: number;
}

export interface CatalogModel {
  id: string;
  name: string;
  releaseDate: string;
  family?: string;
  knowledge?: string;
  pricing?: CatalogPricing;
  capabilities: CatalogCapabilities;
  limits: CatalogLimits;
}

/** Picker option for a single model — `id` is the wire id sent to the
 *  provider; `label` is the human display string (e.g. "Claude Haiku 4.5"). */
export interface ModelOption {
  id: string;
  label: string;
}

function rawProvider(provider: Provider): RawProvider | null {
  if (provider === 'local' || provider === 'custom') return null;
  return CATALOG[CATALOG_PROVIDER_ID[provider]] ?? null;
}

function rawModel(provider: Provider, modelId: string): RawModel | null {
  const prov = rawProvider(provider);
  return prov?.models[modelId] ?? null;
}

function toPricing(cost: RawCost | undefined): CatalogPricing | undefined {
  if (!cost) return undefined;
  const tiers = cost.tiers?.map<CatalogPricingTier>((t) => ({
    thresholdTokens: t.tier.size,
    input: t.input,
    output: t.output,
    cacheRead: t.cache_read,
    cacheWrite: t.cache_write,
  }));
  // Tiers are sorted ascending so cost.ts can scan once when picking a bracket.
  if (tiers) tiers.sort((a, b) => a.thresholdTokens - b.thresholdTokens);
  return {
    input: cost.input,
    output: cost.output,
    cacheRead: cost.cache_read,
    cacheWrite: cost.cache_write,
    reasoning: cost.reasoning,
    tiers,
  };
}

function toCapabilities(m: RawModel): CatalogCapabilities {
  return {
    reasoning: m.reasoning,
    toolCall: m.tool_call,
    attachment: m.attachment,
    structuredOutput: m.structured_output === true,
    modalitiesIn: m.modalities.input,
  };
}

function toLimits(m: RawModel): CatalogLimits {
  return { context: m.limit.context, output: m.limit.output, input: m.limit.input };
}

function toCatalogModel(modelId: string, m: RawModel): CatalogModel {
  return {
    id: modelId,
    name: m.name,
    releaseDate: m.release_date,
    family: m.family,
    knowledge: m.knowledge,
    pricing: toPricing(m.cost),
    capabilities: toCapabilities(m),
    limits: toLimits(m),
  };
}

/** Sorted picker options for the given provider — newest release first so
 *  the most current models surface at the top of the dropdown. Returns []
 *  for local (no catalog entry — local picker lives in localModels.ts). */
export function getModelOptions(provider: Provider): ModelOption[] {
  const prov = rawProvider(provider);
  if (!prov) return [];
  return Object.entries(prov.models)
    .map(([id, m]) => ({ id, label: m.name, _date: m.release_date }))
    .sort((a, b) => (a._date < b._date ? 1 : a._date > b._date ? -1 : a.id.localeCompare(b.id)))
    .map(({ id, label }) => ({ id, label }));
}

/** Full catalog entry for a single model, or null when it isn't in the
 *  snapshot (user-typed custom id, expired-out-of-window legacy id). */
export function getCatalogModel(provider: Provider, modelId: string): CatalogModel | null {
  const m = rawModel(provider, modelId);
  return m ? toCatalogModel(modelId, m) : null;
}

export function getPricing(provider: Provider, modelId: string): CatalogPricing | null {
  return getCatalogModel(provider, modelId)?.pricing ?? null;
}

/** Tier/family tokens per provider, most specific first — `flash-lite` must
 *  win over `flash`, `mini` over the unsuffixed base. An id's family is the
 *  first token that appears in it as a whole `-`/`.`/`_`-delimited segment. */
const FAMILY_TOKENS: Record<Exclude<Provider, 'local' | 'custom'>, string[]> = {
  gemini: ['flash-lite', 'flash', 'pro'],
  anthropic: ['haiku', 'sonnet', 'opus'],
  openai: ['nano', 'mini'],
};

/** Specialty variants whose pricing isn't representative of their family's
 *  chat model (image output, realtime audio, agent harnesses). Never used as
 *  a family-pricing donor. */
const SPECIALTY_VARIANT = /image|live|audio|tts|realtime|computer-use|customtools|deep-research/i;

function familyOf(provider: Provider, modelId: string): string | null {
  if (provider === 'local' || provider === 'custom') return null;
  for (const token of FAMILY_TOKENS[provider]) {
    const re = new RegExp(`(^|[-._])${token}($|[-._])`, 'i');
    if (re.test(modelId)) return token;
  }
  return null;
}

/** Pricing borrowed from the newest priced catalog model in the same family
 *  (e.g. an unknown `gemini-3.9-flash` → the newest `*-flash` in the
 *  snapshot). Covers ids that shipped after the deployed build's snapshot was
 *  taken — the live "Load models from your key" list surfaces them long
 *  before a release refreshes the catalog — so the cost meter lands in the
 *  right price bracket instead of the flat median fallback, which over-reports
 *  a Flash model ~4×. Returns null when the id has no recognizable family, is
 *  itself a specialty variant, or the family has no priced donor. */
export function getFamilyPricing(provider: Provider, modelId: string): CatalogPricing | null {
  const prov = rawProvider(provider);
  const family = familyOf(provider, modelId);
  if (!prov || !family || SPECIALTY_VARIANT.test(modelId)) return null;
  let best: { date: string; cost: RawCost } | null = null;
  for (const [id, m] of Object.entries(prov.models)) {
    if (!m.cost || SPECIALTY_VARIANT.test(id) || familyOf(provider, id) !== family) continue;
    if (!best || m.release_date > best.date) best = { date: m.release_date, cost: m.cost };
  }
  return best ? toPricing(best.cost) ?? null : null;
}

export function getCapabilities(provider: Provider, modelId: string): CatalogCapabilities | null {
  return getCatalogModel(provider, modelId)?.capabilities ?? null;
}

export function getLimits(provider: Provider, modelId: string): CatalogLimits | null {
  return getCatalogModel(provider, modelId)?.limits ?? null;
}

/** True iff the catalog has an entry for this id. Used by capability-driven
 *  routing as the precondition before reading flags — a `false` return
 *  means callers fall back to their per-provider regex sniff. */
export function hasModel(provider: Provider, modelId: string): boolean {
  return rawModel(provider, modelId) !== null;
}

/** Pricing-bracket lookup: picks the right tier given a total input-token
 *  count for this turn. Returns the base pricing when no tier applies (or
 *  no tiers are defined), so callers can treat the result uniformly. */
export function pricingTierFor(pricing: CatalogPricing, inputTokens: number): {
  input: number; output: number; cacheRead?: number; cacheWrite?: number;
} {
  if (!pricing.tiers || pricing.tiers.length === 0) {
    return { input: pricing.input, output: pricing.output, cacheRead: pricing.cacheRead, cacheWrite: pricing.cacheWrite };
  }
  // Tiers are sorted ascending; walk from the top so the highest matching
  // threshold wins. The base rate applies under the smallest threshold.
  for (let i = pricing.tiers.length - 1; i >= 0; i--) {
    const t = pricing.tiers[i];
    if (inputTokens >= t.thresholdTokens) {
      return { input: t.input, output: t.output, cacheRead: t.cacheRead, cacheWrite: t.cacheWrite };
    }
  }
  return { input: pricing.input, output: pricing.output, cacheRead: pricing.cacheRead, cacheWrite: pricing.cacheWrite };
}
