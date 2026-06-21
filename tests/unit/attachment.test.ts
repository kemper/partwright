import { describe, it, expect } from 'vitest';
import {
  inferMediaType,
  inferAttachmentKind,
  normalizeAttachment,
  attachmentKindLabel,
  ATTACHMENT_KINDS,
} from '../../src/storage/attachment';

describe('inferMediaType', () => {
  it('reads the MIME from a data URL prefix', () => {
    expect(inferMediaType('data:image/png;base64,AAAA')).toBe('image/png');
    expect(inferMediaType('data:application/pdf;base64,AAAA')).toBe('application/pdf');
    expect(inferMediaType('data:text/markdown,hello')).toBe('text/markdown');
  });

  it('falls back to a filename/URL extension', () => {
    expect(inferMediaType('https://x.com/model.stl')).toBe('model/stl');
    expect(inferMediaType('https://x.com/a/b/photo.JPG')).toBe('image/jpeg');
    expect(inferMediaType(undefined, 'spec.pdf')).toBe('application/pdf');
  });

  it('ignores query/hash when reading the extension', () => {
    expect(inferMediaType('https://x.com/p.png?w=10#frag')).toBe('image/png');
  });

  it('returns undefined when nothing is determinable', () => {
    expect(inferMediaType('https://x.com/noext')).toBeUndefined();
    expect(inferMediaType(undefined)).toBeUndefined();
  });
});

describe('inferAttachmentKind', () => {
  it('classifies images', () => {
    expect(inferAttachmentKind('image/png')).toBe('image');
    expect(inferAttachmentKind(undefined, 'a.webp')).toBe('image');
  });
  it('classifies models', () => {
    expect(inferAttachmentKind('model/stl')).toBe('model');
    expect(inferAttachmentKind(undefined, 'part.step')).toBe('model');
    expect(inferAttachmentKind(undefined, 'part.3mf')).toBe('model');
    // octet-stream STL: MIME is unhelpful, extension wins.
    expect(inferAttachmentKind('application/octet-stream', 'part.stl')).toBe('model');
  });
  it('classifies documents and text', () => {
    expect(inferAttachmentKind('application/pdf')).toBe('document');
    expect(inferAttachmentKind('text/markdown')).toBe('text');
    expect(inferAttachmentKind('application/json')).toBe('text');
    expect(inferAttachmentKind(undefined, 'notes.md')).toBe('text');
  });
  it('falls back to other', () => {
    expect(inferAttachmentKind('application/zip')).toBe('other');
    expect(inferAttachmentKind(undefined, 'mystery.xyz')).toBe('other');
  });
});

describe('normalizeAttachment', () => {
  it('fills kind + mediaType from the src and assigns a fallback id', () => {
    const a = normalizeAttachment({ src: 'data:image/png;base64,AAAA' }, 'fallback-id');
    expect(a.id).toBe('fallback-id');
    expect(a.kind).toBe('image');
    expect(a.mediaType).toBe('image/png');
  });

  it('preserves an explicit id, kind, and trims the label', () => {
    const a = normalizeAttachment(
      { id: 'x1', src: 'https://x.com/p.bin', kind: 'model', label: '  Reference  ' },
      'unused',
    );
    expect(a.id).toBe('x1');
    expect(a.kind).toBe('model');
    expect(a.label).toBe('Reference');
  });

  it('drops an empty label and omits addedAt/source when absent', () => {
    const a = normalizeAttachment({ src: 'data:image/png;base64,AAAA', label: '   ' }, 'id');
    expect(a.label).toBeUndefined();
    expect(a.addedAt).toBeUndefined();
    expect(a.source).toBeUndefined();
  });

  it('carries a trimmed description through, dropping an empty one', () => {
    const a = normalizeAttachment(
      { src: 'data:image/png;base64,AAAA', description: '  match the rounded corners  ' },
      'id',
    );
    expect(a.description).toBe('match the rounded corners');
    const b = normalizeAttachment({ src: 'data:image/png;base64,AAAA', description: '   ' }, 'id');
    expect(b.description).toBeUndefined();
  });

  it('keeps addedAt and source when provided', () => {
    const a = normalizeAttachment(
      { src: 'data:image/png;base64,AAAA', addedAt: 123, source: 'chat' },
      'id',
    );
    expect(a.addedAt).toBe(123);
    expect(a.source).toBe('chat');
  });

  it('migrates a legacy image row (no kind) to a typed image attachment', () => {
    // The shape old sessions stored: {id, src, label} with no kind/mediaType.
    const a = normalizeAttachment(
      { id: 'old', src: 'data:image/jpeg;base64,AAAA', label: 'Front' },
      'gen',
    );
    expect(a.kind).toBe('image');
    expect(a.mediaType).toBe('image/jpeg');
    expect(a.id).toBe('old');
  });
});

describe('attachmentKindLabel', () => {
  it('has a noun for every kind', () => {
    for (const k of ATTACHMENT_KINDS) {
      expect(attachmentKindLabel(k).length).toBeGreaterThan(0);
    }
    expect(attachmentKindLabel('image')).toBe('Image');
    expect(attachmentKindLabel('other')).toBe('File');
  });
});
