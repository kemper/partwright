# Parametric human — `api.human` (experimental)

**When to reach for this:** the subject is a **realistic person**, meaning an
anatomically correct adult body and face rather than a stylized figurine. `api.human`
starts from MakeHuman's artist-made base mesh (CC0), shapes it with morph
targets, poses it with a real skeleton, and returns one watertight, printable
Manifold. You write numbers, not geometry: every result is a valid body.

> Status: **spike** (kemper/partwright#1151). Adults only (age 25–90), no hair or
> clothing yet, a dozen detail morphs. For a stylized figurine, Funko/chibi
> toy, hair or clothes, use `api.sdf.figure` / `buildCharacter` (`readDoc("figure")`).

> Coordinates: same as the figure rig. **Z up, front −Y, figure's left +X.**
> Soles sit at z = 0 (the base, when on, sits below them).

## One call

```js
return api.human({
  height: 60,                                       // print height, soles → crown (unposed)
  body:  { gender: 0.2, age: 30, muscle: 0.6, weight: 0.45, stature: 0.5, breast: 0.4 },
  face:  { jawWidth: 0.3, cheekbones: 0.5, noseWidth: -0.2, eyeSize: 0.2 },
  torso: { vShape: 0.3, belly: 0 },
  pose:  { armR: { raiseSide: 140, bend: 40, twist: 60 }, head: { yaw: -10 } },
  base:  true,                                      // disc under the feet (or { radius, thickness })
  colors: { skin: '#c68642', iris: '#3b6ea5' },     // optional; defaults paint every label
});
```

Every field is optional and validated. Unknown keys and out-of-range values
throw with the allowed range.

## Body (`body`)

| key | range | meaning |
|---|---|---|
| `gender` | 0–1 | 0 = female, 1 = male (blends in between) |
| `age` | 25–90 | years |
| `muscle` | 0–1 | 0.5 = average |
| `weight` | 0–1 | 0.5 = average |
| `stature` | 0–1 | real-world proportions of a tall/short person (print size is `height`) |
| `breast` | 0–1 | bust (applied on the female side of `gender`) |
| `ethnicity` | `{ african, asian, caucasian }` | relative mix, normalized (default equal thirds; at least one must be > 0) |

## Face and torso (`face`, `torso`): each −1…1, 0 = neutral

`face`: `jawWidth`, `chin` (prominence), `cheekbones`, `noseWidth`,
`noseLength`, `mouthWidth`, `eyeSize`; plus `headSquare`, which is 0–1.
`torso`: `vShape` (shoulder-to-waist taper), `belly`.

## Pose (`pose`): the same vocabulary as `api.sdf.figure`

`armL` / `armR` / `legL` / `legR`: `{ raiseSide, raiseFwd, bend, twist }` in degrees.
- `raiseSide`: 0 = hanging down, 90 = straight out, 180 = overhead.
- `raiseFwd`: + swings the limb forward (−Y).
- `bend`: elbow curls the forearm forward; knee folds the shin backward.
- `twist`: rolls the bend plane (arms: lets a raised fist curl up; legs: turnout).

`spine: { lean, turn, side }` (lean + = forward) and `head: { yaw, pitch, roll }`.

Arms default to relaxed at the sides; legs keep the natural stance unless
set. `pose: 'rest'` gives MakeHuman's A-pose.

## Printability: `weld`

- `weld: 'mesh'` (default) keeps the exact skinned surface, which gives the
  crispest detail. Good whenever the pose doesn't push skin through skin.
- `weld: 'voxel'` re-solidifies the body through a signed-distance lattice
  (`voxel`, default `height/300`; only valid with this weld). Overlaps from
  deep bends (a fully folded knee, an arm pressed into the torso) merge into
  one clean solid. You lose detail at about the voxel size and get more
  triangles (~300k at the default).

Either way the result should report `isManifold: true` and
`componentCount: 1`. Check with `runAndSave(code, label, { isManifold: true, maxComponents: 1 })`.

## Labels (paint)

`skin`, `eyes` (sclera), `iris`, `pupil`, and `base`. Each is coloured by
default; override with `colors: { … }` or `api.paint.label('iris', '#3b6ea5')`.

`api.removePart('eyes')` drops the eyeballs (the face is closed behind them).
Removing `iris` or `pupil` can't cut a hole in a closed eyeball, so that region
merges into the label around it (pupil → iris → sclera) and the removed label
disappears.

## Combining with other geometry

It's a Manifold, so union props, hair or clothing built with `api.sdf` (or
anything else) onto it. Anything you add must overlap the body by 0.5+ units
to fuse.
