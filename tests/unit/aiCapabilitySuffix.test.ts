// Unit test for the per-turn capability suffix (src/ai/systemPrompt.ts). Pure
// logic — settings.ts's localStorage read is wrapped in try/catch and falls
// back to defaults when localStorage is unavailable (as in plain Node), so no
// browser is needed. Moved out of tests/ai-providers.spec.ts, which used to
// pay a ~2s page boot just to reach this assertion.

import { describe, expect, test } from 'vitest';
import { loadSettings, setToggles } from '../../src/ai/settings';
import { toggleSuffix } from '../../src/ai/systemPrompt';

describe('Capability suffix', () => {
  // Regression: when the user flipped the Paint toggle ON mid-conversation,
  // the per-turn system suffix merely dropped its "you cannot paint"
  // restriction line — it never positively asserted that paint was now
  // available. The model kept claiming paint was off on the first request
  // after enabling, only believing the user once told a second time. The
  // suffix now declares each capability ON/OFF explicitly so a freshly
  // enabled tool is unambiguous on the very next turn.
  test('positively declares paint ON/OFF based on the toggle', () => {
    const base = loadSettings();
    const off = setToggles(base, { scope: { paintFaces: false } }).toggles;
    const on = setToggles(base, { scope: { paintFaces: true } }).toggles;
    const offSuffix = toggleSuffix(off);
    const onSuffix = toggleSuffix(on);

    // OFF: explicit OFF in the capability list + a behavioural reminder.
    expect(offSuffix).toContain('Paint / color regions: OFF');
    expect(offSuffix).toContain('Paint is OFF');

    // ON: explicit ON, and no lingering "off" signal for paint that the
    // model could anchor on.
    expect(onSuffix).toContain('Paint / color regions: ON');
    expect(onSuffix).not.toContain('Paint / color regions: OFF');
    expect(onSuffix).not.toContain('Paint is OFF');
    // The override directive that tells the model the list beats earlier turns.
    expect(onSuffix).toContain('OVERRIDES anything said earlier');
  });
});
