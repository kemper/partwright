import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  getSelectedId,
  setSelectedId,
  onSelectionChange,
} from '../../src/annotations/selectionState';

describe('selectionState', () => {
  beforeEach(() => {
    setSelectedId(null);
  });

  it('round-trips the selected id', () => {
    setSelectedId('abc');
    expect(getSelectedId()).toBe('abc');
  });

  it('notifies subscribers on change with the new id', () => {
    const fn = vi.fn();
    const off = onSelectionChange(fn);
    setSelectedId('x');
    expect(fn).toHaveBeenCalledWith('x');
    off();
  });

  it('does not notify when the id is unchanged', () => {
    setSelectedId('same');
    const fn = vi.fn();
    onSelectionChange(fn);
    setSelectedId('same');
    expect(fn).not.toHaveBeenCalled();
  });

  it('stops notifying after unsubscribe', () => {
    const fn = vi.fn();
    const off = onSelectionChange(fn);
    off();
    setSelectedId('y');
    expect(fn).not.toHaveBeenCalled();
  });
});
