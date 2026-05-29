// Bridge between the existing vanilla-TS `modalShell` (which owns the
// overlay, focus trap, Escape handling, and click-outside) and Preact.
// Preact renders the body + footer trees; the shell keeps doing the
// hard-won focus and lifecycle work.
//
// This is deliberately the cohabitation seam — proving we can adopt
// Preact one surface at a time without rewriting modalShell or the
// rest of the app.

import { render } from 'preact';
import type { ComponentChildren } from 'preact';
import { createModalShell, type ModalShellOptions } from '../modalShell';

export interface PreactModalHandle {
  close: () => void;
}

export interface PreactModalSlots {
  body: ComponentChildren;
  footer: ComponentChildren;
}

export interface MountOptions {
  /** Tailwind class adjustments applied to the shell's body element
   *  after mount (e.g. swapping `gap-3` for `gap-4` when sections need
   *  more breathing room). Pairs as [removeClass, addClass]. */
  bodyClassPatches?: [string, string][];
}

/** Mount a Preact tree into the shared modal shell. `renderSlots` runs
 *  once with the imperative `close` so the component can wire its own
 *  Done button. */
export function mountPreactModal(
  shellOpts: ModalShellOptions,
  renderSlots: (close: () => void) => PreactModalSlots,
  mountOpts: MountOptions = {},
): PreactModalHandle {
  let body: HTMLElement | null = null;
  let footer: HTMLElement | null = null;

  const shell = createModalShell({
    ...shellOpts,
    onClose: () => {
      if (body) render(null, body);
      if (footer) render(null, footer);
      shellOpts.onClose?.();
    },
  });
  body = shell.body;
  footer = shell.footer;

  for (const [remove, add] of mountOpts.bodyClassPatches ?? []) {
    shell.body.classList.remove(remove);
    shell.body.classList.add(add);
  }

  const slots = renderSlots(shell.close);
  render(slots.body, shell.body);
  render(slots.footer, shell.footer);

  return { close: shell.close };
}
