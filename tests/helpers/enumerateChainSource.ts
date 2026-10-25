// In-Worker twin of `enumerateChain` (src/geometry/workerLockdown.ts), as JS
// source text so e2e model code can run it inside the real (locked-down)
// engine Worker: tests/engine-lockdown.spec.ts embeds it, and
// tests/unit/workerLockdown.test.ts evaluates the same text against a fake
// global and compares it with the real `enumerateChain`, so the two can't
// drift apart silently. Same owner labels (`describe`), symbol labels
// (`symbolLabel`) and inert rule (`isInertDescriptor`).
//
// The source is a function expression: `(root, rootLabel) => ChainEntry[]`.
export const ENUMERATE_CHAIN_SOURCE = String.raw`(root, rootLabel) => {
  const WK = ['asyncIterator', 'hasInstance', 'isConcatSpreadable', 'iterator', 'match', 'matchAll',
    'replace', 'search', 'species', 'split', 'toPrimitive', 'toStringTag', 'unscopables', 'dispose', 'asyncDispose'];
  const symbolLabel = (k) => {
    for (const w of WK) if (Symbol[w] === k) return '@@' + w;
    const key = Symbol.keyFor(k);
    return key !== undefined ? '@@for(' + key + ')' : '@@unique(' + (k.description ?? '') + ')';
  };
  const out = [];
  for (let o = root; o !== null; o = Object.getPrototypeOf(o)) {
    let owner = rootLabel;
    if (o !== root) {
      const c = Object.getOwnPropertyDescriptor(o, 'constructor');
      const name = c && c.value ? c.value.name : undefined;
      owner = typeof name === 'string' && name ? name + '.prototype' : rootLabel + '<proto>';
    }
    for (const k of Reflect.ownKeys(o)) {
      const d = Object.getOwnPropertyDescriptor(o, k);
      if (!d) continue;
      const symbol = typeof k === 'symbol';
      const v = 'value' in d ? d.value : undefined;
      const inert = 'value' in d && (v === null || (typeof v !== 'object' && typeof v !== 'function'));
      out.push({ owner, label: symbol ? symbolLabel(k) : k, symbol, inert });
    }
  }
  return out;
}`;
