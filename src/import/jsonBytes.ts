// JSON parser that works on UTF-8 bytes instead of one big string.
//
// `JSON.parse(await blob.text())` first decodes the whole file into ONE string,
// and V8 caps a string at ~512M chars (2^29 − 24). A big .partwright.json (base64
// imported meshes, embedded meshes, long histories) is over that cap, so the
// `text()` call throws `RangeError: Invalid string length` before parsing even
// starts. This parser walks the bytes and only decodes each string value on its
// own, so the full text never exists as a single string. The result matches
// `JSON.parse` (same values, same errors-on-invalid-input in practice), with
// these two documented differences, both harmless for session files:
//   - a raw control character inside an escape-free string is accepted
//     (JSON.parse rejects it); checking would cost a pass over every base64 byte.
//   - the error messages differ.
// A leading UTF-8 BOM is skipped, as `blob.text()` does.

const QUOTE = 0x22;
const BACKSLASH = 0x5c;
const NUMBER_RE = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/;

/** Files at or above this many bytes skip the `text()` + `JSON.parse` path.
 *  Structural, not a tuning knob: half of V8's max string length, so the fast
 *  native path is only taken when its single string certainly fits. */
const BYTE_PARSE_THRESHOLD = 2 ** 28;

/** Parse a JSON Blob/File, falling back to the byte parser for files too big to
 *  hold as one string. */
export async function parseJsonBlob(blob: Blob): Promise<unknown> {
  if (blob.size < BYTE_PARSE_THRESHOLD) {
    try {
      return JSON.parse(await blob.text());
    } catch (e) {
      // A huge non-ASCII text can still overflow below the threshold; anything
      // else (a real syntax error) is rethrown.
      if (!(e instanceof RangeError)) throw e;
    }
  }
  return parseJsonBytes(new Uint8Array(await blob.arrayBuffer()));
}

/** Parse UTF-8 JSON bytes into a value, like `JSON.parse(new TextDecoder().decode(bytes))`. */
export function parseJsonBytes(bytes: Uint8Array): unknown {
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const n = bytes.length;
  let i = 0;
  if (n >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) i = 3;

  const fail = (what: string): never => {
    throw new SyntaxError(`${what} in JSON at position ${i}`);
  };
  const skipWs = (): void => {
    while (i < n) {
      const c = bytes[i];
      if (c === 0x20 || c === 0x0a || c === 0x0d || c === 0x09) i++;
      else break;
    }
  };
  const expectWord = (word: string, value: unknown): unknown => {
    for (let k = 0; k < word.length; k++) {
      if (bytes[i + k] !== word.charCodeAt(k)) fail('Unexpected token');
    }
    i += word.length;
    return value;
  };

  const parseString = (): string => {
    // bytes[i] is the opening quote.
    const start = i + 1;
    const close = bytes.indexOf(QUOTE, start);
    if (close < 0) fail('Unterminated string');
    // Search only up to the first quote: an unbounded indexOf would rescan the
    // rest of the file for every string (quadratic).
    if (bytes.subarray(start, close).indexOf(BACKSLASH) < 0) {
      // Fast path: no escapes, so the bytes between the quotes ARE the string.
      i = close + 1;
      return decoder.decode(bytes.subarray(start, close));
    }
    // Slow path: walk to the real closing quote, then let JSON.parse handle the
    // escapes. Escaped strings in a session file are code/notes — small.
    let j = start;
    while (j < n) {
      const c = bytes[j];
      if (c === BACKSLASH) j += 2;
      else if (c === QUOTE) break;
      else j++;
    }
    if (j >= n) fail('Unterminated string');
    const literal = decoder.decode(bytes.subarray(i, j + 1));
    i = j + 1;
    return JSON.parse(literal) as string;
  };

  const parseNumber = (): number => {
    const start = i;
    while (i < n) {
      const c = bytes[i];
      // digits, '-', '+', '.', 'e', 'E'
      if ((c >= 0x30 && c <= 0x39) || c === 0x2d || c === 0x2b || c === 0x2e || c === 0x65 || c === 0x45) i++;
      else break;
    }
    let text = '';
    for (let k = start; k < i; k++) text += String.fromCharCode(bytes[k]);
    if (!NUMBER_RE.test(text)) { i = start; fail('Invalid number'); }
    return Number(text);
  };

  const setKey = (obj: Record<string, unknown>, key: string, value: unknown): void => {
    // `obj.__proto__ = v` would swap the prototype; JSON.parse makes it an own
    // property instead, and so must we.
    if (key === '__proto__') {
      Object.defineProperty(obj, key, { value, writable: true, enumerable: true, configurable: true });
    } else {
      obj[key] = value;
    }
  };

  const parseValue = (): unknown => {
    skipWs();
    if (i >= n) fail('Unexpected end');
    const c = bytes[i];
    if (c === QUOTE) return parseString();
    if (c === 0x7b) { // {
      i++;
      const obj: Record<string, unknown> = {};
      skipWs();
      if (bytes[i] === 0x7d) { i++; return obj; }
      for (;;) {
        skipWs();
        if (bytes[i] !== QUOTE) fail('Expected property name');
        const key = parseString();
        skipWs();
        if (bytes[i] !== 0x3a) fail("Expected ':'");
        i++;
        setKey(obj, key, parseValue());
        skipWs();
        if (bytes[i] === 0x2c) { i++; continue; }
        if (bytes[i] === 0x7d) { i++; return obj; }
        fail("Expected ',' or '}'");
      }
    }
    if (c === 0x5b) { // [
      i++;
      const arr: unknown[] = [];
      skipWs();
      if (bytes[i] === 0x5d) { i++; return arr; }
      for (;;) {
        arr.push(parseValue());
        skipWs();
        if (bytes[i] === 0x2c) { i++; continue; }
        if (bytes[i] === 0x5d) { i++; return arr; }
        fail("Expected ',' or ']'");
      }
    }
    if (c === 0x74) return expectWord('true', true);
    if (c === 0x66) return expectWord('false', false);
    if (c === 0x6e) return expectWord('null', null);
    if (c === 0x2d || (c >= 0x30 && c <= 0x39)) return parseNumber();
    return fail('Unexpected token');
  };

  const value = parseValue();
  skipWs();
  if (i < n) fail('Unexpected non-whitespace character after JSON');
  return value;
}
