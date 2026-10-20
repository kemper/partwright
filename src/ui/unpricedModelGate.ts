// Authorization gate for hosted models with no known pricing.
//
// The cost meter never guesses a price (see src/ai/cost.ts): a model newer
// than the deployed catalog snapshot — typically one picked from the live
// "Load models from your key" list — has no dollar figure, so its turns show
// "cost unknown" and the $ spend cap can't bound them. Before the first paid
// call on such a model we tell the user that and ask them to authorize it.
//
// Authorizations are held in module memory, so they're per tab and last for
// the page's lifetime: a reload, or another window, asks again. That keeps
// one tab's "yes" from silently authorizing spend in another (see CLAUDE.md
// "Cross-Tab Isolation").

import { hasKnownPricing } from '../ai/cost';
import { confirmDialog } from './dialogs';

const authorized = new Set<string>();

/** Resolves true when turns on `provider`/`model` may proceed: the model is
 *  priced (or free), was already authorized in this tab, or the user just
 *  authorized it. False when the user declined. */
export async function confirmUnpricedModel(provider: string, model: string): Promise<boolean> {
  if (hasKnownPricing(provider, model)) return true;
  const key = `${provider}/${model}`;
  if (authorized.has(key)) return true;
  const ok = await confirmDialog(
    `Partwright has no pricing data for "${model}", so it can't estimate what this model costs. `
    + 'Turns on it will show "cost unknown", and your $ spend cap can\'t stop it. '
    + 'Check your provider\'s billing console for actual charges. Continue with this model?',
    { title: 'Unknown model pricing', confirmLabel: 'Continue without cost tracking' },
  );
  if (ok) authorized.add(key);
  return ok;
}
