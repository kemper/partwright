// Tiny Server-Sent Events reader. The OpenAI Chat Completions and Google
// Gemini streamGenerateContent endpoints both return SSE; both providers
// just need someone to chunk the response body into `data: ...` payloads.
// Yielding strings (one per data line) keeps the per-provider code small.

export async function* readSseStream(res: Response, signal?: AbortSignal): AsyncGenerator<string> {
  if (!res.body) return;
  const reader = res.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';

  try {
    while (true) {
      if (signal?.aborted) {
        try { await reader.cancel(); } catch { /* already done */ }
        return;
      }
      const { value, done } = await reader.read();
      if (done) break;
      // Strip ALL carriage returns before buffering. The SSE spec allows
      // events to be separated by CR, LF, or CRLF; OpenAI uses bare LF,
      // Google Gemini frames events with CRLF (`\r\n\r\n`). We normalize
      // to LF so a single `\n\n` boundary check works for both.
      //
      // Critically, we strip every CR rather than replacing `\r\n` → `\n`:
      // a CRLF sequence routinely straddles two network chunks (one chunk
      // ends with `\r`, the next starts with `\n`), and a per-chunk
      // `\r\n` replace misses that split. The leftover CR then breaks
      // boundary detection, so events get dropped — which showed up as
      // truncated assistant text (only stray fragments survived) and as
      // spurious stalls (no deltas reached the watchdog, so it aborted
      // the stream with "signal is aborted without reason"). Removing
      // every CR byte is split-safe because SSE payloads never contain a
      // literal CR (JSON escapes it as \r, two chars).
      buffer += decoder.decode(value, { stream: true }).replace(/\r/g, '');
      // SSE events are terminated by a blank line (\n\n). Process each
      // complete event and keep the trailing partial in the buffer.
      let eventBoundary;
      while ((eventBoundary = buffer.indexOf('\n\n')) !== -1) {
        const rawEvent = buffer.slice(0, eventBoundary);
        buffer = buffer.slice(eventBoundary + 2);
        const payload = extractData(rawEvent);
        if (payload !== null) yield payload;
      }
    }
    // Flush a final event if the connection closed without the trailing \n\n.
    if (buffer.trim().length > 0) {
      const payload = extractData(buffer);
      if (payload !== null) yield payload;
    }
  } finally {
    try { reader.releaseLock(); } catch { /* already released */ }
  }
}

/** Pull the `data:` portion(s) out of a raw SSE event. Multi-line data
 *  fields are joined with `\n` per the spec — though both OpenAI and
 *  Gemini stick to single-line frames in practice. */
function extractData(rawEvent: string): string | null {
  const lines = rawEvent.split('\n');
  const dataLines: string[] = [];
  for (const line of lines) {
    if (line.startsWith('data:')) {
      dataLines.push(line.slice(5).trimStart());
    }
  }
  if (dataLines.length === 0) return null;
  return dataLines.join('\n');
}
