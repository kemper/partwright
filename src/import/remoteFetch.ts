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
  /** fetch redirect mode (default 'follow'). 'error' refuses any redirect —
   *  the request a redirect would make never fires. */
  redirect?: RequestRedirect;
  /** Schemes the FINAL URL may have (default http: + https:). */
  allowedProtocols?: string[];
  /** Message for a network / CORS failure (default: the Import-from-URL text). */
  networkErrorMessage?: string;
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
      res = await fetch(url, { signal: controller.signal, redirect: opts.redirect ?? 'follow' });
    } catch (e) {
      if ((e as Error).name === 'AbortError') throw new Error('The request timed out.');
      throw new Error(opts.networkErrorMessage ?? 'Could not fetch that URL. The server may block cross-origin requests, or the URL may point to a page rather than a direct file — try finding the direct file URL, or download and upload instead.');
    }
    if (!res.ok) throw new Error(`The server responded ${res.status} ${res.statusText}.`);

    // Defense-in-depth: the caller only vetted the *initial* URL's scheme.
    // With redirect: 'follow', the final URL could in theory be a non-http(s)
    // scheme; browsers already block http(s)→file:/data: redirects, but
    // re-check the resolved URL before touching the body just in case.
    if (res.url) {
      let finalProtocol: string;
      try { finalProtocol = new URL(res.url).protocol; } catch { controller.abort(); throw new Error('The remote server redirected to an invalid URL.'); }
      if (!(opts.allowedProtocols ?? ['http:', 'https:']).includes(finalProtocol)) {
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

/** True for hostnames an AI-supplied URL must not reach: `localhost`
 *  (+ subdomains), `.local` mDNS names, and loopback / private / link-local IP
 *  literals — 127/8, 10/8, 172.16/12, 192.168/16, 169.254/16, 0/8, ::1, ::,
 *  fc00::/7, fe80::/10 and IPv4-mapped IPv6 forms of those. Pure. */
export function isLocalOrPrivateHost(hostname: string): boolean {
  let h = hostname.trim().toLowerCase().replace(/\.$/, '');
  if (h.startsWith('[') && h.endsWith(']')) h = h.slice(1, -1);
  if (h === '' || h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local')) return true;
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    return a === 127 || a === 10 || a === 0 || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168) || (a === 169 && b === 254);
  }
  if (h.includes(':')) {
    if (h === '::1' || h === '::') return true;
    const mapped = /^::ffff:(.+)$/.exec(h);
    if (mapped) {
      const tail = mapped[1];
      if (tail.includes('.')) return isLocalOrPrivateHost(tail);
      // ::ffff:7f00:1 style — rebuild the dotted quad.
      const parts = tail.split(':');
      if (parts.length === 2) {
        const hi = parseInt(parts[0], 16), lo = parseInt(parts[1], 16);
        return isLocalOrPrivateHost(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
      }
      return true;
    }
    const first = parseInt(h.split(':')[0] || '0', 16);
    if ((first & 0xfe00) === 0xfc00) return true; // fc00::/7 unique-local
    if ((first & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  }
  return false;
}
