# Threads, bolts & nuts (`api.threads`)

Real **ISO-metric helical threads** — threaded rods, hex/socket bolts, and hex
nuts — built as a true swept helix, not a fake twist. Available in the
**manifold-js** engine as `api.threads.*`. Read this before modeling any
fastener; a hand-rolled helix is the classic way to produce a non-manifold mesh.

All dimensions are millimetres, Z-up. A rod/bolt shank rises along +Z from
`z=0`; a bolt's head sits below `z=0`. Builders **throw a clear error** on bad
input so you can self-correct.

## Sizing — metric table or explicit

Give **either** a metric `size` (coarse pitch looked up for you) **or** an
explicit `diameter` + `pitch`:

```js
api.threads.metric            // frozen table: M2 M2_5 M3 M4 M5 M6 M8 M10 M12 M16 M20
api.threads.rod({ size: 'M8', length: 20 });            // coarse pitch 1.25 mm
api.threads.rod({ size: 'M8', pitch: 1.0, length: 20 }); // fine pitch override
api.threads.rod({ diameter: 9, pitch: 1.5, length: 20 }); // non-standard
```

## Threaded rod

```js
return api.threads.rod({ size: 'M8', length: 20 });
```

| key | meaning | default |
|---|---|---|
| `size` *or* `diameter`+`pitch` | thread size — **required** | — |
| `length` | threaded length along +Z | — |
| `handed` | `'right'` (normal) or `'left'` | `'right'` |
| `chamfer` | lead-in chamfer at the top: `true`/`false`/number (mm) | `true` |
| `segments` | facets per turn / on the core | 24 / 48 |

## Bolt

`bolt(opts)` adds a head below `z=0` to a threaded shank. `headType` is `'hex'`
(default) or `'socket'` (cylindrical cap). An optional unthreaded `shank` length
sits between head and threads.

```js
return api.threads.bolt({ size: 'M8', length: 20 });            // hex bolt
return api.threads.bolt({ size: 'M6', length: 16, headType: 'socket', shank: 4 });
```

Extra options: `headWidth` (across-flats / cap diameter), `headHeight`, `shank`.

## Nut

`nut(opts)` is a hex prism with an internal thread sized to accept a same-size
`bolt`/`rod`. **The nut carries the print clearance** (`fit`, default 0.2 mm
radial) so a printed bolt threads into a printed nut — the rod/bolt itself is
modelled at nominal size.

```js
return api.threads.nut({ size: 'M8' });
return api.threads.nut({ size: 'M8', thickness: 8, width: 14, fit: 0.3 });
```

| key | meaning | default |
|---|---|---|
| `size` *or* `diameter`+`pitch` | thread size — **required** | — |
| `thickness` | nut height | `0.8 · diameter` |
| `width` | hex across-flats | `1.8 · diameter` |
| `fit` | radial clearance added to the internal thread (mm) | `0.2` |
| `handed` | must match the bolt | `'right'` |

## Verification & printing

- A rod/bolt is a single solid: expect `isManifold: true`, `componentCount: 1`.
  A nut reports `genus: 1` (the through-hole) — expected.
- **Print clearance is the whole game.** A nominal bolt + a `fit: 0.2` nut is a
  good FDM starting point; loosen `fit` if the printed pair binds, tighten if
  loose. For tapped holes in your own parts, model the *bolt* and subtract it
  with a small radial offset rather than cutting a perfect thread.
- Threads are real helical geometry — they print and export (STL/3MF) correctly,
  but very fine pitches (< ~0.5 mm) approach FDM resolution; prefer resin or a
  coarser size for tiny fasteners.
- `handed` must match between a bolt and its nut (both `'right'` by default).
