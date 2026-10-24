// Guarded remote fetch — shared by "Import from URL…" (main.ts) and image
// prefills for AI-opened tools (src/ui/prefillImage.ts): a timeout, a check
// that a redirect didn't land on a non-http(s) scheme, a Content-Length cap
// up front and a streamed byte cap as the backstop.

export interface RemoteFetchOptions {
  /** Abort after this long (ms). */
  timeoutMs: number;
  /** Hard cap on the body (bytes). */
  maxBytes: number;
  /** Inspect the response before the body is read (content type, final URL);
   *  return an error message to reject it. */
  check?: (res: Response) => string | null;
}

export interface RemoteFetchResult {
  bytes: Uint8Array;
  contentType: string | null;
  /** The final URL after redirects ('' when the browser doesn't report it). */
  finalUrl: string;
}

const mb = (n: number): string => `${(n / 1048576).toFixed(n % 1048576 === 0 ? 0 : 1)} MB`;

/** Fetch `url` with the guards above. Throws an Error with a human-readable
 *  message on any failure. */
export async function fetchRemoteBytes(url: string, opts: RemoteFetchOptions): Promise<RemoteFetchResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs);
  try {
    let res: Response;
    try {
      res = await fetch(url, { signal: controller.signal, redirect: 'follow' });
    } catch (e) {
      if ((e as Error).name === 'AbortError') throw new Error('The request timed out.');
      throw new Error('Could not fetch that URL. The server may block cross-origin requests, or the URL may point to a page rather than a direct file — try finding the direct file URL, or download and upload instead.');
    }
    if (!res.ok) throw new Error(`The server responded ${res.status} ${res.statusText}.`);

    // Defense-in-depth: the caller only vetted the *initial* URL's scheme.
    // With redirect: 'follow', the final URL could in theory be a non-http(s)
    // scheme; browsers already block http(s)→file:/data: redirects, but
    // re-check the resolved URL before touching the body just in case.
    if (res.url) {
      let finalProtocol: string;
      try { finalProtocol = new URL(res.url).protocol; } catch { controller.abort(); throw new Error('The remote server redirected to an invalid URL.'); }
      if (finalProtocol !== 'http:' && finalProtocol !== 'https:') {
        controller.abort();
        throw new Error(`The remote server redirected to an unsupported URL (got "${finalProtocol}").`);
      }
    }

    // Up-front size guard from Content-Length when present.
    const declared = Number(res.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > opts.maxBytes) {
      controller.abort();
      throw new Error(`That file is too large (${(declared / 1048576).toFixed(1)} MB; limit ${mb(opts.maxBytes)}).`);
    }

    const rejected = opts.check?.(res) ?? null;
    if (rejected) { controller.abort(); throw new Error(rejected); }

    // Stream the body with a hard byte cap as a backstop for servers that omit
    // or under-report Content-Length.
    let bytes: Uint8Array;
    try {
      bytes = await readBodyCapped(res, opts.maxBytes, controller);
    } catch (e) {
      if ((e as Error).name === 'AbortError') throw new Error('The request timed out.');
      throw e;
    }
    return { bytes, contentType: res.headers.get('content-type'), finalUrl: res.url ?? '' };
  } finally {
    clearTimeout(timer);
  }
}

/** Read a fetch Response body into a Uint8Array, aborting once the streamed
 *  total exceeds `cap`. Falls back to a plain arrayBuffer() read (still cap-
 *  checked) when the body isn't a readable stream. */
async function readBodyCapped(res: Response, cap: number, controller: AbortController): Promise<Uint8Array> {
  const body = res.body;
  if (!body || typeof body.getReader !== 'function') {
    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.byteLength > cap) throw new Error(`That file is too large (limit ${mb(cap)}).`);
    return buf;
  }
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      total += value.byteLength;
      if (total > cap) {
        controller.abort();
        try { await reader.cancel(); } catch { /* ignore */ }
        throw new Error(`That file is too large (limit ${mb(cap)}).`);
      }
      chunks.push(value);
    }
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) { out.set(c, offset); offset += c.byteLength; }
  return out;
}
