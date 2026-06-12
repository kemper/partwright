/** Classification of provider stream errors into transient (worth retrying as-is)
 *  vs fatal (would just fail again). Pure logic, no dependencies — kept out of
 *  chatLoop so it can be unit-tested in the node tier. */

/** Pull an HTTP status code out of a thrown provider error. The Anthropic SDK
 *  attaches a numeric `.status`; the raw-fetch providers (OpenAI/Gemini/custom)
 *  throw `new Error("OpenAI 503: …")`, so we parse the leading status token. */
export function httpStatusOf(err: unknown): number | null {
  const e = err as { status?: unknown; message?: unknown };
  if (typeof e?.status === 'number') return e.status;
  const msg = typeof e?.message === 'string' ? e.message : '';
  // The raw-fetch providers throw "<Provider> <status>: <body>" (and custom
  // throws "<status>: <body>" with no name), so anchor to the START of the
  // message and require the trailing colon. Matching a bare 3-digit run
  // anywhere (the old pattern) could pick a status out of the error *body*
  // (e.g. "OpenAI 400: … model gpt-512 …") and misclassify a fatal request as
  // transient or vice-versa.
  const m = msg.match(/^(?:OpenAI|Gemini|Anthropic|Custom)?\s*(\d{3}):/);
  return m ? Number(m[1]) : null;
}

/** A transient failure is one worth retrying as-is: the request was well-formed
 *  but the server/network hiccuped (rate limit, 5xx, dropped stream). Fatal
 *  errors (auth, bad request, missing key, user abort) are NOT retried — they'd
 *  just fail again. */
export function isTransientError(err: unknown): boolean {
  const e = err as { name?: unknown; message?: unknown };
  if (e?.name === 'AbortError') return false; // user/stop abort — never retry
  const status = httpStatusOf(err);
  if (status !== null) {
    // 408 timeout, 409 conflict, 425 too-early, 429 rate-limit, all 5xx
    // (incl. Anthropic's 529 "overloaded"). 4xx auth/validation are fatal.
    return status === 408 || status === 409 || status === 425 || status === 429 || status >= 500;
  }
  // No status → likely a network-layer failure (fetch rejects with a TypeError)
  // or a mid-stream drop. Match on the common phrasings.
  const msg = (typeof e?.message === 'string' ? e.message : '').toLowerCase();
  return /failed to fetch|networkerror|network error|connection|econnreset|socket|timeout|timed out|temporarily|overloaded|interrupted|terminated|premature|stream/.test(msg);
}
