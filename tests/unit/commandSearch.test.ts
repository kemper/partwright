import { describe, it, expect } from 'vitest';
import { scoreCommand, rankCommands, groupForBrowse, pushRecent } from '../../src/ui/commandSearch';

const CMDS = [
  { id: 'export-stl', title: 'Export STL', hint: 'Export', keywords: 'download print' },
  { id: 'export-3mf', title: 'Export 3MF', hint: 'Export', keywords: 'download print color' },
  { id: 'tool-annotate', title: 'Annotate (draw / text)', hint: 'Tools', keywords: 'draw pen text' },
  { id: 'tool-surface', title: 'Surface textures', hint: 'Tools', keywords: 'fuzzy knit cable waffle' },
  { id: 'tool-resize', title: 'Resize / scale model', hint: 'Tools', keywords: 'scale resize size dimensions' },
  { id: 'tool-paint', title: 'Paint colors', hint: 'Tools', keywords: 'color region brush', description: 'Colour regions of the model for multi-filament prints.' },
  { id: 'tab-notes', title: 'Go to Notes', hint: 'Tab', keywords: 'session notes' },
  { id: 'open-help', title: 'Open help', hint: 'Navigate' },
  { id: 'misc', title: 'Something else' },
];

const ids = (q: string) => rankCommands(CMDS, q).map(c => c.id);

describe('commandSearch', () => {
  it('empty query matches everything in registration order', () => {
    expect(ids('')).toEqual(CMDS.map(c => c.id));
  });

  it('every token must match', () => {
    expect(ids('export stl')).toEqual(['export-stl']);
    expect(ids('zzzznotacommand')).toEqual([]);
  });

  it('title hits outrank keyword hits', () => {
    // "scale" is a keyword of resize; "Resize" title starts with "res".
    expect(ids('resize')[0]).toBe('tool-resize');
    expect(ids('color')[0]).toBe('tool-paint');
  });

  it('accepts partial words and typos', () => {
    expect(ids('scal')).toContain('tool-resize');
    expect(ids('textr')[0]).toBe('tool-surface');
    expect(ids('srface')[0]).toBe('tool-surface');
    expect(ids('notse')[0]).toBe('tab-notes');
  });

  it('searches descriptions', () => {
    expect(ids('filament')).toEqual(['tool-paint']);
  });

  it('does not match scattered letters', () => {
    expect(scoreCommand(CMDS[0], 'xq')).toBe(0);
  });

  it('groups browse view by category with recents first', () => {
    const sections = groupForBrowse(CMDS, ['tab-notes', 'gone', 'tool-paint']);
    expect(sections.map(s => s.label)).toEqual(['Recent', 'Tools', 'Tab', 'Export', 'Navigate', 'Other']);
    expect(sections[0].items.map(c => c.id)).toEqual(['tab-notes', 'tool-paint']);
    expect(sections[1].items.map(c => c.id)).toEqual(['tool-annotate', 'tool-surface', 'tool-resize', 'tool-paint']);
  });

  it('pushRecent de-duplicates and caps', () => {
    expect(pushRecent(['a', 'b', 'c'], 'b', 3)).toEqual(['b', 'a', 'c']);
    expect(pushRecent(['a', 'b', 'c'], 'd', 3)).toEqual(['d', 'a', 'b']);
  });
});
