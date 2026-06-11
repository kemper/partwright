import { describe, it, expect } from 'vitest';
import { elideStaleToolImages, ELIDED_IMAGE_NOTE } from '../../src/ai/historyElision';
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
