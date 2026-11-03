// Chunked JSON → Blob serializer.
//
// `JSON.stringify` builds the whole document as ONE string, and V8 caps a
// string at ~512 MB (2^29 − 24 chars). A large session — base64 imported
// meshes, embedded latest meshes, long version history — blows past that and
// throws `RangeError: Invalid string length`. This walker emits the same text
// as `JSON.stringify(value, null, indent)` but as many small strings that are
// flushed into Blob parts, so no single string ever holds the full document.
// (A single leaf string over the cap would still be unrepresentable, but such a
// string could never have been created in memory in the first place.)

/** Buffered text is flushed into a Blob part once it reaches this many chars.
 *  Structural buffer size, not a tuning knob: any value well under the string
 *  cap works; ~8M chars keeps the part count low without large spikes. */
const FLUSH_CHARS = 8 * 1024 * 1024;

type Json = unknown;

/** Value after `toJSON` (Date, etc.) — mirrors JSON.stringify's SerializeJSONProperty. */
function resolve(holderKey: string, value: Json): Json {
  if (value !== null && typeof value === 'object'
    && typeof (value as { toJSON?: unknown }).toJSON === 'function') {
    return (value as { toJSON: (k: string) => Json }).toJSON(holderKey);
  }
  if (typeof value === 'bigint') {
    // Match JSON.stringify, which throws on BigInt.
    throw new TypeError('Do not know how to serialize a BigInt');
  }
  return value;
}

/** True when JSON.stringify would omit this value as an object member. */
function isSkippable(v: Json): boolean {
  return v === undefined || typeof v === 'function' || typeof v === 'symbol';
}

/**
 * Serialize `value` to a Blob with the same bytes as
 * `JSON.stringify(value, null, indent)`, without ever materializing the full
 * text as one string. Throws the same TypeError on circular references.
 */
export function jsonToBlob(value: Json, indent = 0, type = 'application/json'): Blob {
  const parts: BlobPart[] = [];
  let buf: string[] = [];
  let bufLen = 0;
  const gap = ' '.repeat(Math.max(0, Math.min(10, indent)));
  const stack = new Set<object>();

  const push = (s: string): void => {
    buf.push(s);
    bufLen += s.length;
    if (bufLen >= FLUSH_CHARS) flush();
  };
  const flush = (): void => {
    if (buf.length) parts.push(buf.join(''));
    buf = [];
    bufLen = 0;
  };

  const write = (v: Json, indentStr: string): void => {
    if (v === null) { push('null'); return; }
    switch (typeof v) {
      case 'string': push(JSON.stringify(v)); return;
      case 'number': push(Number.isFinite(v) ? String(v) : 'null'); return;
      case 'boolean': push(v ? 'true' : 'false'); return;
      case 'object': break;
      default: push('null'); return; // only reached for array slots (undefined/function/symbol)
    }
    const obj = v as object;
    // Boxed primitives serialize as their primitive value.
    if (obj instanceof Number || obj instanceof String || obj instanceof Boolean) {
      write(obj.valueOf(), indentStr);
      return;
    }
    if (stack.has(obj)) throw new TypeError('Converting circular structure to JSON');
    stack.add(obj);
    const inner = indentStr + gap;
    const sep = gap ? ',\n' + inner : ',';
    if (Array.isArray(obj)) {
      if (obj.length === 0) { push('[]'); stack.delete(obj); return; }
      push(gap ? '[\n' + inner : '[');
      for (let i = 0; i < obj.length; i++) {
        if (i > 0) push(sep);
        const item = resolve(String(i), obj[i]);
        write(isSkippable(item) ? null : item, inner);
      }
      push(gap ? '\n' + indentStr + ']' : ']');
    } else {
      let first = true;
      const rec = obj as Record<string, Json>;
      for (const key of Object.keys(rec)) {
        const item = resolve(key, rec[key]);
        if (isSkippable(item)) continue;
        push(first ? (gap ? '{\n' + inner : '{') : sep);
        first = false;
        push(JSON.stringify(key));
        push(gap ? ': ' : ':');
        write(item, inner);
      }
      push(first ? '{}' : (gap ? '\n' + indentStr + '}' : '}'));
    }
    stack.delete(obj);
  };

  const root = resolve('', value);
  if (isSkippable(root)) throw new TypeError('Value is not JSON-serializable');
  write(root, '');
  flush();
  return new Blob(parts, { type });
}
