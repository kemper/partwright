// Unit tests for the shared SSE event reader (src/ai/sse.ts). Node has native
// fetch/Response/ReadableStream/TextEncoder, so this dependency-free module
// runs in the fast vitest tier — moved out of tests/ai-providers.spec.ts,
// which used to boot a whole browser page just to reach `readSseStream`.

import { describe, test, expect } from 'vitest';
import { readSseStream } from '../../src/ai/sse';

describe('readSseStream', () => {
  test('handles CRLF event framing (Gemini)', async () => {
    // Regression: Gemini frames streamGenerateContent SSE events with
    // CRLF (`\r\n\r\n`). The reader used to split only on `\n\n`, so it
    // never found a boundary and dropped the whole stream — the Gemini
    // turn "exited without a final message" with 0 tokens. Feed the
    // reader a CRLF-framed body and confirm it yields both events.
    const body = 'data: {"x":1}\r\n\r\ndata: {"y":2}\r\n\r\ndata: [DONE]\r\n\r\n';
    const res = new Response(new Blob([body]), { headers: { 'Content-Type': 'text/event-stream' } });
    const out: string[] = [];
    for await (const e of readSseStream(res)) out.push(e);
    expect(out).toEqual(['{"x":1}', '{"y":2}', '[DONE]']);
  });

  test('handles CRLF split across network chunks', async () => {
    // The real-world bug: a `\r\n` straddles two chunks (one ends with
    // `\r`, the next starts with `\n`). A per-chunk `\r\n`→`\n` replace
    // misses that, dropping events — which manifested as truncated
    // assistant text and spurious stalls. Feed deliberately awkward
    // chunk splits and confirm every event still parses.
    // Full stream is three CRLF-separated events:
    //   data: {"a":1}\r\n\r\ndata: {"b":2}\r\n\r\ndata: {"c":3}\r\n\r\n
    // but the network chunk boundaries deliberately fall mid-CRLF (a
    // chunk ends with '\r', the next starts with '\n'), the case a
    // per-chunk `\r\n`→`\n` replace mishandles.
    const chunks = [
      'data: {"a":1}\r\n\r',
      '\ndata: {"b":2}\r',
      '\n\r\ndata: {"c":3}\r\n\r\n',
    ];
    const enc = new TextEncoder();
    const stream = new ReadableStream({
      start(c) { for (const ch of chunks) c.enqueue(enc.encode(ch)); c.close(); },
    });
    const res = new Response(stream, { headers: { 'Content-Type': 'text/event-stream' } });
    const out: string[] = [];
    for await (const e of readSseStream(res)) out.push(e);
    expect(out).toEqual(['{"a":1}', '{"b":2}', '{"c":3}']);
  });
});
