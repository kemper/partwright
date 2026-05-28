// AI Settings modal — public entry point. The body of the modal moved
// to Preact under `src/ui/preact/settingsModal.tsx`; this file is now a
// thin wrapper that mounts the Preact tree into the shared modal shell.
// The signature is unchanged so every existing caller (aiPanel.ts) keeps
// working without edits.

import { signal } from '@preact/signals';
import { loadSettings } from '../ai/settings';
import { mountPreactModal } from './preact/mount';
import { resyncSettings } from './preact/settingsStore';
import {
  SettingsModalBody,
  SettingsModalFooter,
  type AiSettingsCallbacks,
  type AiSettingsOptions,
} from './preact/settingsModal';
import type { Provider } from '../ai/types';

export type { AiSettingsCallbacks, AiSettingsOptions };

export async function showAiSettingsModal(
  cb: AiSettingsCallbacks,
  opts: AiSettingsOptions = {},
): Promise<void> {
  // Pull on-disk settings into the signal BEFORE first render so vanilla-TS
  // writes that happened while the modal was closed are reflected in the
  // very first paint (not a tick later after the on-mount effect fires).
  resyncSettings();
  const initialTab: Provider = opts.initialTab ?? loadSettings().toggles.provider;
  const tab = signal<Provider>(initialTab);

  mountPreactModal(
    { title: 'AI Settings', scrollable: true, maxWidth: 'lg' },
    close => ({
      body: <SettingsModalBody cb={cb} tab={tab} close={close} />,
      footer: <SettingsModalFooter close={close} />,
    }),
    // Match the original modal's body spacing — sections need more
    // breathing room than the default gap-3 the shell hands us.
    { bodyClassPatches: [['gap-3', 'gap-4']] },
  );
}
