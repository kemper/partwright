---
session: "01U8g7w9"
timestamp: "2026-11-03T06:00:00Z"
sequence: 14
---

## Human

Keep both character builders (api.human and sdf.figure). After that, merge all
your PRs.

## Assistant

## Key decisions

**Keeping both builders.** #1170 was rewritten: the Character Creator gets a
top-level Realistic (api.human) / Avatar (sdf.figure) choice instead of
replacing the old builder. The issue lists the work; none of it is in this
merge.

**One merge for the stack.** The seven human PRs form one straight chain, so
main (201 commits ahead) was merged into the top branch only, and that PR
carries the whole chain into main.

**Conflicts.** Main removed the engine sandbox's opaque mode, so the CORS
lines this stack added for `/human/*` went with it. In origin mode the sandbox
host serves the whole build, so the human assets are same-origin there. Main's
wording wins elsewhere; the stack's `fitHuman` lines were kept on top.

**AI tool budget.** Main left 150 characters of room in the tool-schema budget
(260,000), and `fitHumanToPhoto` was about 2,900. The budget was not raised.
Instead:
- `fitHumanToPhoto` was cut to a short schema that points to
  `/ai/human.md#fit-to-a-photo`. Main's newer check requires every object
  parameter to declare its fields, so its free-form `base` became `baseJson`,
  a JSON string; human.md says so.
- The surface-texture and photoMatch tools lost explanations their subdocs
  already hold (`textures.md`, `reference-images.md#photo-match`), and
  buildCharacter's photo-loop sentence got shorter. Parameter names all stay.
- The tool joins the `characters` group, so it isn't in the first request.
