// Unit test for the auto-continue (`finish` sentinel tool) gating logic —
// pure filtering over the static tool list (src/ai/tools.ts) plus the
// system-prompt suffix (src/ai/systemPrompt.ts). Moved out of
// tests/ai-autoresume.spec.ts, which used to pay a ~2s page boot just to
// reach these request-builder-adjacent assertions. The rest of that spec
// drives the real chatLoop, which persists to IndexedDB (unavailable in
// plain Node) and stays in Playwright.

import { describe, expect, test } from 'vitest';
import { buildToolList } from '../../src/ai/tools';
import { loadSettings, setToggles } from '../../src/ai/settings';
import { toggleSuffix } from '../../src/ai/systemPrompt';

describe('Auto-continue (finish-tool resume) gating', () => {
  test('finish tool + prompt instruction appear only when auto-continue is ON', () => {
    const base = loadSettings();
    const onToggles = setToggles(base, { autoResume: true }).toggles;
    const offToggles = setToggles(base, { autoResume: false }).toggles;

    const onHasFinish = buildToolList(onToggles).some(t => t.name === 'finish');
    const offHasFinish = buildToolList(offToggles).some(t => t.name === 'finish');
    const onSuffix = toggleSuffix(onToggles);
    const offSuffix = toggleSuffix(offToggles);

    expect(onHasFinish).toBe(true);
    expect(offHasFinish).toBe(false);
    expect(onSuffix).toMatch(/auto-continue is on/i);
    expect(onSuffix).toMatch(/finish/);
    expect(offSuffix).not.toMatch(/auto-continue is on/i);
  });
});
