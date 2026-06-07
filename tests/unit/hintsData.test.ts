import { describe, it, expect } from 'vitest';
import { HINTS, DEFAULT_CTA_LABEL, type Hint } from '../../src/ui/hints/hintsData';

// Command ids the hints may reference. Mirrors the registerCommands(...) call in
// src/main.ts — keep in sync so a typo'd CTA id is caught here rather than
// silently no-op'ing at runtime (runCommandById returns false for unknown ids).
const REGISTERED_COMMAND_IDS = new Set([
  'run', 'save', 'format', 'new-session', 'open-sessions',
  'tab-interactive', 'tab-gallery', 'tab-versions', 'tab-images', 'tab-diff', 'tab-notes', 'tab-data',
  'export-glb', 'export-stl', 'export-obj', 'export-3mf', 'export-vox', 'export-step',
  'share-link',
  'tool-measure', 'tool-cross-section', 'tool-paint', 'tool-palette', 'tool-image-paint',
  'tool-annotate', 'tool-quality', 'tool-customize',
  'toggle-ai', 'toggle-diagnostics',
  'open-catalog', 'open-ideas', 'open-help', 'open-whats-new',
  'open-quality', 'retake-tour', 'toggle-hints',
]);

describe('hints dataset', () => {
  it('is non-empty', () => {
    expect(HINTS.length).toBeGreaterThan(0);
  });

  it('has unique ids', () => {
    const ids = HINTS.map(h => h.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every hint has text and an id', () => {
    for (const h of HINTS) {
      expect(h.id, JSON.stringify(h)).toBeTruthy();
      expect(h.text.trim().length, h.id).toBeGreaterThan(0);
    }
  });

  it('command/coach CTAs reference only registered command ids', () => {
    const referenced: string[] = [];
    for (const h of HINTS) {
      if (h.cta.kind === 'command') referenced.push(h.cta.id);
      if (h.cta.kind === 'coach') referenced.push(...(h.cta.prep ?? []));
    }
    for (const id of referenced) {
      expect(REGISTERED_COMMAND_IDS.has(id), `unknown command id: ${id}`).toBe(true);
    }
  });

  it('coach CTAs have a CSS-selector target and an openSelector that is a selector', () => {
    for (const h of HINTS) {
      if (h.cta.kind !== 'coach') continue;
      expect(h.cta.target.startsWith('#') || h.cta.target.startsWith('['), h.id).toBe(true);
      if (h.cta.openSelector) {
        expect(h.cta.openSelector.startsWith('#') || h.cta.openSelector.startsWith('['), h.id).toBe(true);
      }
    }
  });

  it('open CTAs target a known overlay', () => {
    for (const h of HINTS) {
      if (h.cta.kind !== 'open') continue;
      expect(['commandPalette', 'shortcuts']).toContain(h.cta.what);
    }
  });

  it('exposes a default CTA label', () => {
    expect(DEFAULT_CTA_LABEL.length).toBeGreaterThan(0);
  });
});

// Type smoke: the exported Hint type is usable.
const _sample: Hint = HINTS[0];
void _sample;
