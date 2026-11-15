// afterNextPaint (src/ui/afterPaint.ts): resolves after a painted frame, and
// never waits where no frame is coming.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { afterNextPaint } from '../../src/ui/afterPaint';

afterEach(() => vi.unstubAllGlobals());

/** A stand-in document + rAF the test drives by hand. */
function stubPage(hidden: boolean) {
  const listeners = new Set<() => void>();
  const doc = {
    hidden,
    addEventListener: (_: string, fn: () => void) => listeners.add(fn),
    removeEventListener: (_: string, fn: () => void) => listeners.delete(fn),
  };
  let frame: (() => void) | null = null;
  vi.stubGlobal('document', doc);
  vi.stubGlobal('requestAnimationFrame', (fn: () => void) => { frame = fn; return 1; });
  return { doc, listeners, runFrame: () => frame?.(), hide: () => { doc.hidden = true; for (const fn of [...listeners]) fn(); } };
}

const settled = async (p: Promise<void>): Promise<boolean> => {
  let done = false;
  void p.then(() => { done = true; });
  await new Promise(r => setTimeout(r, 5));
  return done;
};

describe('afterNextPaint', () => {
  it('resolves at once with no document (a Worker) or a hidden tab', async () => {
    expect(await settled(afterNextPaint())).toBe(true);
    stubPage(true);
    expect(await settled(afterNextPaint())).toBe(true);
  });

  it('waits for the frame, then resolves after it', async () => {
    const page = stubPage(false);
    const p = afterNextPaint();
    expect(await settled(p)).toBe(false);
    page.runFrame();
    expect(await settled(p)).toBe(true);
    expect(page.listeners.size).toBe(0);
  });

  it('stops waiting when the tab is hidden before the frame comes', async () => {
    const page = stubPage(false);
    const p = afterNextPaint();
    expect(await settled(p)).toBe(false);
    page.hide();
    expect(await settled(p)).toBe(true);
    expect(page.listeners.size).toBe(0);
  });
});
