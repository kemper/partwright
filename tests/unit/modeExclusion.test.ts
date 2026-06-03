import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  registerExclusiveMode,
  deactivateMode,
  type ExclusiveMode,
} from '../../src/ui/modeExclusion';

// The registry is module-global; register fresh spies per test (later
// registrations overwrite earlier ones for the same id).
describe('modeExclusion', () => {
  let paint: ReturnType<typeof vi.fn>;
  let pen: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    paint = vi.fn();
    pen = vi.fn();
    registerExclusiveMode('paint', paint);
    registerExclusiveMode('pen', pen);
  });

  it('deactivateMode calls the registered deactivator for that id only', () => {
    deactivateMode('paint');
    expect(paint).toHaveBeenCalledTimes(1);
    expect(pen).not.toHaveBeenCalled();
  });

  it('forwards opts verbatim (e.g. keepSession for the annotate trio)', () => {
    deactivateMode('pen', { keepSession: true });
    expect(pen).toHaveBeenCalledWith({ keepSession: true });
  });

  it('is a no-op for an unregistered id', () => {
    expect(() => deactivateMode('nonexistent' as ExclusiveMode)).not.toThrow();
  });

  it('the latest registration wins for a given id', () => {
    const newer = vi.fn();
    registerExclusiveMode('paint', newer);
    deactivateMode('paint');
    expect(newer).toHaveBeenCalledTimes(1);
    expect(paint).not.toHaveBeenCalled();
  });
});
