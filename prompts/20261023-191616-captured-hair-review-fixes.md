---
session: "01BsPPSVZ2oFGFXTxRyBtu1M"
timestamp: "2026-10-23T19:16:16Z"
tools: [subagent, vite-node]
---

## Human

Review follow-ups on the captured-hair commit:
- odd or NaN grid sizes break the build and the capture script;
- `box.displace(1, …)` bloats the mesher bounds on small figures and turns a NaN into solid;
- a preset name starting with a digit gives an invalid identifier, and the input basename is not escaped in the header comment;
- quantization divides by zero when `rMax == rMin`;
- lazy-load the 24 KB preset if that is feasible in the sync SDF build.

Touch only the hair-capture files, the script and the tests.

## Assistant

## Key decisions

**Grid sizes.** `assertGridSize` in field.ts requires positive even integers. Even is needed because the build samples the skin at half resolution. It is enforced in three places:
- `decodePreset`, so a bad preset fails with a named error instead of NaN arrays;
- `captureHair`;
- the CLI's `--grid` parse, which now uses an `^\d+x\d+$` regex and exits 2 with a message.

**Carrying the field.** `carryField(box, field, pad)` returns `box.displace(pad, (box − field) / pad)`. This still evaluates to exactly the field, but the bounds grow only by the existing pad instead of a fixed world unit. A non-finite field sample maps to 1e9 (far outside). `displace` zeroes a non-finite field, which would have returned the box's own negative interior as solid hair. It is exported and unit-tested with a plain box.

**Script hygiene.** The export identifier maps non-identifier characters to `_` and prefixes a leading digit with `_`. The script prints the identifier, since the preset must be registered under that name. Text placed in `//` comments (the name, the source and the input basename) has control characters and line separators replaced. Regenerating the tsubasa preset gives a byte-identical file.

**Quantization.** It moved into `quantizeRadii`, which widens a zero span to 1e-3.

**Lazy loading is not done.** `F.hair` builds its node synchronously inside the user's model code, so a dynamic import cannot be awaited there. Making it lazy would need the engine worker to preload the preset before running code that mentions `'captured'`, the way `sourceUsesBrep` preloads OpenCASCADE. That lives in `engineWorker.ts` / `manifoldJs.ts`, which are outside this change's scope. Decoding is already lazy and cached, so only the ~24 KB string is paid up front.
