// Bambu Studio / OrcaSlicer per-triangle "paint_color" multi-material encoding.
//
// Bambu/Orca store painted filament assignments as a bare `paint_color`
// attribute on each `<triangle>` in `3D/3dmodel.model`. The value is an
// UPPERCASE hex string encoding a recursive triangle-split tree as a bitstream
// (the format PrusaSlicer calls `mmu_segmentation`; Bambu forked it and renamed
// the attribute). The encoding has no official spec — these helpers are derived
// from PrusaSlicer's `TriangleSelector` serialize/deserialize + `Model.cpp`
// string packing (see the PR description for source links) and validated by the
// round-trip unit tests in `tests/unit/paintColor3mf.test.ts`.
//
// Partwright bakes exactly ONE colour per triangle, so we only ever need the
// *leaf* (un-split) case: the whole triangle is a single filament `state`. We
// never emit the split-node form, which keeps this to the three prefix-coded
// leaf widths below.
//
// Wire format (per the serialize() prefix codes), reading low bits first:
//   leaf, states 0–2:    nibble `xxyy`            yy=0b00 (0 split sides), xx=state
//   leaf, states 3–16:   `zzzz` + `xxyy`          xx=0b11 (escape), zzzz=state-3
//   leaf, states 17–255: `vvvvvvvv` + `zzzz`+`xxyy` zzzz=0b1110 (escape2), vvvvvvvv=state-17
// The bitstream packs 4 bits per nibble LSB-first; the hex STRING is the nibble
// sequence reversed (the decoder reads it right-to-left). `state` is the 1-based
// filament/extruder slot index (state 1 = filament 1); state 0 = NONE, which is
// represented by OMITTING the attribute (the triangle inherits the object's
// default extruder) — `encodePaintColorState(0)` returns ''.

/** Bambu's painted states are capped at 254 in the wire format. */
export const MAX_PAINT_STATE = 254;

/**
 * Encode a 1-based filament slot index as a Bambu `paint_color` hex string.
 * Returns '' for state 0 (NONE → omit the attribute). Throws on out-of-range.
 */
export function encodePaintColorState(state: number): string {
  if (!Number.isInteger(state)) throw new Error(`paint_color state must be an integer, got ${state}`);
  if (state < 0 || state > MAX_PAINT_STATE) throw new Error(`paint_color state out of range [0,${MAX_PAINT_STATE}]: ${state}`);
  if (state === 0) return '';

  // states 1–2: single nibble (state << 2) | 0b00
  if (state <= 2) {
    return ((state << 2) & 0xf).toString(16).toUpperCase();
  }

  // states 3–16: nibble0 = 0b1100 (0xC = escape, 0 split), nibble1 = state-3.
  // String = reversed nibbles = [state-3][C].
  if (state <= 16) {
    return (state - 3).toString(16).toUpperCase() + 'C';
  }

  // states 17–254: nibble0 = 0xC, nibble1 = 0xE (escape2), then 8 bits = state-17
  // split across nibble2 (low) and nibble3 (high). String = reversed =
  // [vHigh][vLow][E][C].
  const v = state - 17;
  const hi = ((v >> 4) & 0xf).toString(16).toUpperCase();
  const lo = (v & 0xf).toString(16).toUpperCase();
  return hi + lo + 'EC';
}

/**
 * Decode a Bambu `paint_color` leaf string back to its 1-based filament state.
 * The inverse of {@link encodePaintColorState} — used by the round-trip tests
 * (and available for any future import path). Throws on a split-node string
 * (which Partwright never emits) or malformed input. '' → 0 (NONE).
 */
export function decodePaintColorState(hex: string): number {
  if (hex === '') return 0;
  if (!/^[0-9A-F]+$/.test(hex)) throw new Error(`paint_color must be uppercase hex, got "${hex}"`);

  // Expand the hex string into a bitstream. The decoder reads chars
  // right-to-left, each char's 4 bits appended LSB-first.
  const bits: number[] = [];
  for (let i = hex.length - 1; i >= 0; i--) {
    const d = parseInt(hex[i], 16);
    bits.push(d & 1, (d >> 1) & 1, (d >> 2) & 1, (d >> 3) & 1);
  }
  const nibbleAt = (off: number) =>
    bits[off] | (bits[off + 1] << 1) | (bits[off + 2] << 2) | (bits[off + 3] << 3);

  const root = nibbleAt(0);
  const splitSides = root & 0b11;       // yy
  if (splitSides !== 0) throw new Error('paint_color split-node form is not supported (expected a leaf)');
  const xx = (root >> 2) & 0b11;
  if (xx !== 0b11) return xx;            // states 0–2

  const zzzz = nibbleAt(4);             // escape nibble
  if (zzzz !== 0b1110) return 3 + zzzz; // states 3–16

  // states 17–254: 8 bits of (state-17) in nibble2 (low) + nibble3 (high)
  const v = nibbleAt(8) | (nibbleAt(12) << 4);
  return 17 + v;
}
