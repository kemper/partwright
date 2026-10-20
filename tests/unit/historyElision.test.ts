import { describe, it, expect } from 'vitest';
import { elideStaleToolImages, imagesToElide, providerCachesHistory, ELIDED_IMAGE_NOTE } from '../../src/ai/historyElision';
import type { ChatMessage, ImageSource, PersistedToolResult } from '../../src/ai/types';

const img = (tag: string): ImageSource => ({ data: `bytes-${tag}`, mediaType: 'image/png' });

function userTurn(seq: number, results: PersistedToolResult[]): ChatMessage {
  return {
    id: `m${seq}`,
    sessionId: 's',
    role: 'user',
    blocks: [],
    toolResults: results,
    seq,
    createdAt: seq,
  };
}

function renderResult(tag: string): PersistedToolResult {
  return { toolUseId: `t-${tag}`, content: `{"isManifold":true,"tag":"${tag}"}`, image: img(tag) };
}

describe('elideStaleToolImages', () => {
  it('returns the same array when nothing needs trimming', () => {
    const history = [userTurn(0, [renderResult('a'), renderResult('b')])];
    expect(elideStaleToolImages(history, 3)).toBe(history); // <= keep ⇒ identity
  });

  it('keeps the most-recent N images and strips older ones', () => {
    const history = [
      userTurn(0, [renderResult('a')]),
      userTurn(1, [renderResult('b')]),
      userTurn(2, [renderResult('c')]),
      userTurn(3, [renderResult('d')]),
    ];
    const out = elideStaleToolImages(history, 2);
    const images = out.flatMap(m => (m.toolResults ?? []).map(r => r.image?.data ?? null));
    // a,b stripped (oldest); c,d kept (newest two)
    expect(images).toEqual([null, null, 'bytes-c', 'bytes-d']);
  });

  it('annotates stripped results so the model knows an image was omitted', () => {
    const history = [userTurn(0, [renderResult('a')]), userTurn(1, [renderResult('b')])];
    const out = elideStaleToolImages(history, 1);
    expect(out[0].toolResults![0].image).toBeUndefined();
    expect(out[0].toolResults![0].content).toContain(ELIDED_IMAGE_NOTE.trim());
    expect(out[1].toolResults![0].image).toEqual(img('b')); // newest kept intact
  });

  it('strips every image when keepLastImages is 0', () => {
    const history = [userTurn(0, [renderResult('a')]), userTurn(1, [renderResult('b')])];
    const out = elideStaleToolImages(history, 0);
    expect(out.every(m => (m.toolResults ?? []).every(r => r.image === undefined))).toBe(true);
  });

  it('does not mutate the input history', () => {
    const history = [userTurn(0, [renderResult('a')]), userTurn(1, [renderResult('b')])];
    const snapshot = JSON.stringify(history);
    elideStaleToolImages(history, 0);
    expect(JSON.stringify(history)).toBe(snapshot);
  });

  it('is idempotent — re-running does not double-append the note', () => {
    const history = [userTurn(0, [renderResult('a')]), userTurn(1, [renderResult('b')])];
    const once = elideStaleToolImages(history, 1);
    const twice = elideStaleToolImages(once, 1);
    const note = once[0].toolResults![0].content.split(ELIDED_IMAGE_NOTE.trim()).length;
    const noteTwice = twice[0].toolResults![0].content.split(ELIDED_IMAGE_NOTE.trim()).length;
    expect(noteTwice).toBe(note); // still exactly one occurrence
  });

  it('leaves user-attached image blocks untouched (only tool results are trimmed)', () => {
    const withBlockImage: ChatMessage = {
      id: 'u', sessionId: 's', role: 'user',
      blocks: [{ type: 'image', source: img('photo') }],
      seq: 0, createdAt: 0,
    };
    const history = [withBlockImage, userTurn(1, [renderResult('a')]), userTurn(2, [renderResult('b')])];
    const out = elideStaleToolImages(history, 1);
    expect(out[0].blocks[0]).toEqual({ type: 'image', source: img('photo') });
  });
});

describe('imagesToElide (stepped trimming for cached providers)', () => {
  it('sliding when trimTo is omitted: keeps exactly maxImages', () => {
    expect(imagesToElide(3, 3)).toBe(0);
    expect(imagesToElide(4, 3)).toBe(1);
    expect(imagesToElide(10, 3)).toBe(7);
  });

  it('stepped: accumulates to max, then cuts back to trimTo in one go', () => {
    // max 15, trimTo 8 → kept count cycles 8…15; one trim per 8 renders.
    const kept = (n: number) => n - imagesToElide(n, 15, 8);
    expect(kept(15)).toBe(15);
    expect(kept(16)).toBe(8);
    expect(kept(23)).toBe(15);
    expect(kept(24)).toBe(8);
    for (let n = 16; n <= 60; n++) {
      expect(kept(n)).toBeGreaterThanOrEqual(8);
      expect(kept(n)).toBeLessThanOrEqual(15);
    }
  });

  it('stepped: the elided set only changes at a trim, so the cached prefix is stable between trims', () => {
    const changes: number[] = [];
    let prev = imagesToElide(15, 15, 8);
    for (let n = 16; n <= 40; n++) {
      const e = imagesToElide(n, 15, 8);
      if (e !== prev) changes.push(n);
      prev = e;
    }
    expect(changes).toEqual([16, 24, 32, 40]);
  });

  it('never trims below one image, so the latest render survives a cut', () => {
    expect(16 - imagesToElide(16, 15, 0)).toBe(1);
    expect(imagesToElide(5, 0, 0)).toBe(5); // keep-none still strips everything
  });

  it('elideStaleToolImages honours trimTo', () => {
    const history = Array.from({ length: 6 }, (_, i) => userTurn(i, [renderResult(String(i))]));
    const out = elideStaleToolImages(history, 5, 2);
    const images = out.flatMap(m => (m.toolResults ?? []).map(r => r.image?.data ?? null));
    expect(images).toEqual([null, null, null, null, 'bytes-4', 'bytes-5']);
  });
});

describe('providerCachesHistory', () => {
  it('Anthropic follows the setting; OpenAI/Gemini always; Custom/Local never', () => {
    expect(providerCachesHistory('anthropic', true)).toBe(true);
    expect(providerCachesHistory('anthropic', false)).toBe(false);
    expect(providerCachesHistory('openai', false)).toBe(true);
    expect(providerCachesHistory('gemini', false)).toBe(true);
    expect(providerCachesHistory('custom', true)).toBe(false);
    expect(providerCachesHistory('local', true)).toBe(false);
  });
});
