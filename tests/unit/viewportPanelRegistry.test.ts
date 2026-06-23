import { describe, it, expect, beforeEach } from 'vitest';
import {
  openViewportPanel,
  closeViewportPanel,
  getActiveViewportPanel,
  onViewportPanelOpen,
  type ViewportPanel,
} from '../../src/ui/viewportPanelRegistry';

// The registry is a dependency-free leaf: it enforces "one viewport panel open
// at a time" and notifies open-listeners so the host can step the AI panel out
// of the way — but only for genuine, non-silent, user-initiated opens.

function panel(): ViewportPanel & { closed: number } {
  return { closed: 0, close() { this.closed++; } };
}

describe('viewportPanelRegistry', () => {
  let opens: number;
  beforeEach(() => {
    opens = 0;
    onViewportPanelOpen(() => { opens++; });
    // Reset the singleton's active panel between tests by opening + closing a
    // throwaway (silent so it doesn't perturb the open count).
    const reset = panel();
    openViewportPanel(reset, { silent: true });
    closeViewportPanel(reset);
  });

  it('opening a panel notifies open-listeners', () => {
    const before = opens;
    openViewportPanel(panel());
    expect(opens).toBe(before + 1);
  });

  it('a silent open does NOT notify listeners (so the AI panel stays put)', () => {
    const before = opens;
    openViewportPanel(panel(), { silent: true });
    expect(opens).toBe(before);
  });

  it('opening a new panel closes the previously-active one', () => {
    const a = panel();
    const b = panel();
    openViewportPanel(a);
    openViewportPanel(b);
    expect(a.closed).toBe(1);
    expect(b.closed).toBe(0);
  });

  it('re-asserting the already-active panel does not re-notify', () => {
    const a = panel();
    openViewportPanel(a);
    const after = opens;
    openViewportPanel(a); // same panel again
    expect(opens).toBe(after);
    expect(a.closed).toBe(0); // and it isn't closed against itself
  });

  it('getActiveViewportPanel reflects the open menu — so an auto-opening panel can defer to it', () => {
    const a = panel();
    const b = panel();
    expect(getActiveViewportPanel()).toBeNull();
    openViewportPanel(a);
    expect(getActiveViewportPanel()).toBe(a);
    // Opening b makes b current (a is closed) — switching parts while a tool is
    // open keeps SOME panel as "the current menu".
    openViewportPanel(b);
    expect(getActiveViewportPanel()).toBe(b);
    closeViewportPanel(b);
    expect(getActiveViewportPanel()).toBeNull();
  });

  it('closeViewportPanel only clears when the given panel is active', () => {
    const a = panel();
    const b = panel();
    openViewportPanel(a);
    closeViewportPanel(b); // b isn't active — no-op
    const after = opens;
    openViewportPanel(a); // a still active → re-assert, no notify
    expect(opens).toBe(after);
  });
});
