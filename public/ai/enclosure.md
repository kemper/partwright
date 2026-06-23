# Enclosures & boxes (`api.enclosure`)

Two-part **project boxes**, the rounded **shells** they're made of, and PCB
**standoff** posts — the single most-printed functional object. Available in the
**manifold-js** engine as `api.enclosure.*`. The lid-to-base fit (a nesting lip
with the right clearance, or corner screw bosses that line up with the lid's
holes) is the fiddly part this gets right for you, **composing the
[fasteners](/ai/fasteners.md) library** for the screw variant.

All dimensions are millimetres, Z-up. A box is built with its base floor on
`z=0`; the returned `lid` is already seated on the base (assembled) so the fit
previews directly. Builders **throw a clear error** on bad input.

## The one rule of fit

A correctly-fitting two-part box reports **`componentCount === 2`** — the
clearance gap keeps base and lid as separate solids. A fused `1` means the gap
is too small: loosen `fit` (`'snug'` → `'normal'` → `'loose'`).

## Two-part box

```js
const { enclosure, labeledUnion } = api;
const { base, lid } = enclosure.box({ size: [60, 40, 30], wall: 2, radius: 3, type: 'lip' });
return labeledUnion([
  { name: 'base', shape: base, color: '#4f86c6' },
  { name: 'lid',  shape: lid,  color: '#e0a458' },
]);
```

`box(opts)` returns `{ base, lid }` (both Manifolds). `size` is the assembled
**outer** size `[x, y, z]`; the seam sits `lidHeight` below the top.

| key | meaning | default |
|---|---|---|
| `size` | assembled outer `[x, y, z]` — **required** | — |
| `wall` | side-wall thickness | `2` |
| `floor` | floor/ceiling thickness | `wall` |
| `radius` | vertical-edge corner radius | `2` |
| `lidHeight` | height of the lid portion above the seam | ~18% of `z` |
| `type` | `'lip'` (nesting plug) or `'screw'` (corner bosses) | `'lip'` |
| `fit` | mate clearance: `'press'`/`'snug'`/`'normal'`/`'loose'`/`'free'` or a mm number | `'snug'` |
| `lip` | `{ depth? }` — plug depth (type `'lip'`) | ~10% of `z` |
| `screw` | `{ size?, count?, inset?, head? }` — see below (type `'screw'`) | — |

**Lip lid** (`type: 'lip'`): the lid's lower section narrows into a plug that
nests inside the base opening with `fit` clearance; the full-width upper section
overhangs and rests on the base rim. No hardware needed — friction/snap closure.

**Screw lid** (`type: 'screw'`): four corner **bosses** rise inside the base,
tapped for `screw.size` (self-tapping — the screw cuts its own thread), and the
lid gets four matching **countersunk clearance holes**. The bores come from the
M2–M8 metric table via `api.fasteners`.

```js
const { base, lid } = api.enclosure.box({
  size: [70, 50, 28], wall: 2.4, type: 'screw',
  screw: { size: 'M3', head: 'countersunk' },   // size from the metric table
});
```

`screw` options: `size` (`'M3'` default, any table key M2–M8), `head`
(`'countersunk'` | `'socket'` | `'pan'` | `'none'`), `inset` (corner inset of
the boss centres), `count` (fixed at `4` in v1).

## Shell (the box primitive)

`shell(opts)` is one open-top (or fully closed) rounded box — the piece every
box is built from. Use it directly when you want a custom closure.

```js
return api.enclosure.shell({ size: [40, 40, 25], wall: 2, radius: 4, open: 'top' });
```

| key | meaning | default |
|---|---|---|
| `size` | outer `[x, y, z]` — **required** | — |
| `wall` / `floor` | wall / floor thickness | `2` / `wall` |
| `radius` | vertical-edge corner radius | `2` |
| `open` | `'top'` (open box) or `'none'` (sealed) | `'top'` |

## PCB standoffs

`standoff(opts)` is a mounting post for a board — `union` it onto the floor and
pattern the positions with `api.linearPattern` / `circularPattern`.

```js
const { enclosure, linearPattern } = api;
const post = enclosure.standoff({ size: 'M3', height: 6, bore: 'tap' });
// four posts on a 50×30 hole pattern:
let posts = post.translate([-25, -15, 0]);
posts = posts.add(post.translate([25, -15, 0]))
             .add(post.translate([-25, 15, 0]))
             .add(post.translate([25, 15, 0]));
return posts;
```

| key | meaning | default |
|---|---|---|
| `size` | screw size from the metric table | `'M3'` |
| `height` | post height (mm) | `6` |
| `od` | outer diameter | tap dia + 4.4 |
| `bore` | `'tap'` (self-tapping pilot) or `'through'` (clearance) | `'tap'` |

## Tips

- **Vents/grilles** aren't a builder yet (v1) — subtract your own slot pattern
  from a `shell` (e.g. a `linearPattern` of thin `Manifold.cube` cutters).
- **Verify the fit:** check `componentCount === 2` after a `box`. If it's `1`,
  loosen `fit`; if the lid falls off in preview, tighten it.
- The lid is returned **assembled** on the base. To print, lay each flat /
  translate the lid clear; for export they're already one watertight scene.
