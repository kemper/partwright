---
session: "01BsPPSVZ2oFGFXTxRyBtu1M"
timestamp: "2026-10-23T15:53:49Z"
model: claude-opus-5-5
tools: [subagent, git-worktree, playwright, model-preview]
---

## Human

Implement issue #1059 on top of PR #1057 (Funko/chibi figure-library
features): Character Creator spec v2. Bump SPEC_VERSION to 2 with a v1 → v2
migration whose defaults reproduce today's output. Add body.proportions
(realistic/chibi/funko), body.headScale, face.layout {eyeSpread, eyeHeight},
the 'mop'/'anime' hair styles and their lock knobs, pose.hold (ball) and
colors.ball, all validated and enum-synced with the library. Codegen emits the
new options (F.heldSphere + a soccer pattern, F.place), with v1 specs staying
byte-identical. Panel: a Style segmented control, a head-size slider,
style-dependent hair knobs and a Holding control, working at 375 px with 44 px
targets. AI parity: a buildCharacter tool, getCharacterSpec(), and a
"figure from a photo" recipe in figure.md / ai.md. Add unit + e2e tests.
Validate by building the Captain Tsubasa Funko from a spec and scoring it
with photoMatch against the hand-written v5 (0.876 front / 0.881 back).

## Assistant

## Key decisions

**Migration via one flag, not many.** Every new field already has a default
that emits nothing: realistic proportions, null headScale/layout, library
lock-knob defaults, hold none, eyeSize 1, mouth on. Only the new `place`
flag differs. New specs default to `place: true` and finish with
`F.place(model, rig, { face: '+X' })`, the figure-library convention that
photoMatch's azimuth 0 assumes. A v1 header, or a spec object with
`version: 1`, gets `place: false`. Before changing any code, I captured the
v1 codegen output for the default, all presets and four variants as
`tests/unit/fixtures/characterV1Code.json`. A test asserts byte-identical
output below the header line, both from the header path and from the
object-version path.

**`null` means "the style's default".** headScale and face.layout are
nullable. A Funko figure therefore inherits the library preset unless the
user overrides it. `STYLE_DEFAULTS` mirrors the library's PROPORTION_PRESETS,
and a unit test builds real rigs to keep the two in sync.

**One field tree for validation and the AI schema.** `SPEC_FIELDS` drives
`validateSpec`, which reports path-prefixed errors for enums, the library's
own ranges, hex colours and unknown keys. It also drives `specJsonSchema`,
which uses only Gemini-safe keywords. Enum arrays are exported and reused by
the types, the panel and the schema. The sync test reads the allowed lists
back out of the library's `assertEnum` error messages, so the internal
library constants did not need to be exported.

**Beyond the issue's field list: eyeSize and mouth.** The first spec-built
Tsubasa had pin-prick eyes and a lip ridge. A Funko's likeness is mostly its
big bead eyes and its lack of a mouth. Both fields are cheap, and their
defaults reproduce v1. The Funko style preset sets eyeSize 1.8 and mouth off.

**Scale edgeLength with height for placed specs.** At height 100 the fixed
0.55 edge produced 561k triangles, which is over budget. v1 specs keep the
fixed value.

**AI tool always saves and does not echo code.** The `buildCharacter` tool is
SAVE_GATED. It drops the multi-KB `code` from its result (it returns
`codeChars` instead), which keeps the spec → build → photoMatch loop cheap.
`getCharacterSpec` is a pure read, available in every mode.

**UI collisions.** The new "Chibi" style segment clashed with the "Chibi"
preset button, and the Mouth toggle clashed with the Mouth select. I gave the
presets a labelled group, named the style row "Proportions" and named the
toggle "Show mouth".

**Validation result.** The spec-built Tsubasa reached photoMatch IoU 0.856
front and 0.868 back, against 0.876 / 0.881 for the hand-written version.
The spec is 909 characters against 5,691 characters of code. The spec cannot
express the N and 10 numerals, the collar and cuff trim, the socks with
bands, or the chunky custom sneakers.
