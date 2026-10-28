---
session: "01BsPPSVZ2oFGFXTxRyBtu1M"
timestamp: "2026-10-26T03:15:00Z"
model: claude-opus-5-5
tools: [playwright]
sequence: 4
---

## Human

[Coordinator, after a re-review of c4c64a9f: no escape, no channel between
runs.] Should-fix regression: the undeclared-name trap's setter defines a data
property, so `let width = 10; widht = 20;` and an undeclared `for (i = 0; …)`
now silently succeed under SES (a raw Compartment, strict JS and the kill-switch
path all throw ReferenceError). Make the setter throw; keep define-on-set only
when the analysis sees `globalThis` escape (computed `globalThis[expr]`, or
`globalThis` used as a value) and expose that as a flag. Nits: unicode-escaped
identifiers break the analysis (Lezer doesn't decode them) — skip the analysis
then; `typeof toString` answers 'undefined' because `known` lacks inherited
names; note that the stack-line parse is V8-only; make the first-line count a
single pass, share the parse with the neutralizer if easy, otherwise add a
source-size threshold (appConfig) since the analysis is ~176 ms on the 363 KB
benchy-reconstruction and runs every keystroke; harden OCCT's embind error
classes after init. Add the by-design CodeQL "Improper code sanitization" alert
on sesModelSource.ts to the release skill.

## Assistant

## Key decisions

**Setter throws unless globals can be created dynamically.** `analyzeFreeGlobals`
now reports `globalThisEscapes`: true for `globalThis[expr]` with a non-literal
key, `globalThis` in any non-member position (passed, assigned, spread), or any
`eval` reference (indirect eval can declare globals). Only then does assigning a
trapped name create a global — the one case where `x = v` and `globalThis[k] = v`
are indistinguishable at the accessor. Otherwise the setter throws the same
ReferenceError as the getter, matching strict JS and the kill-switch path.

**Bail on any Lezer error node, not just backslashes.** Lezer doesn't support
`\uXXXX` identifiers at all — it emits an error node and a mangled
`u0061` definition — so a slice check can't catch them. Bailing on any error
node also covers syntax errors (the compile fails anyway) and syntax newer than
the grammar; bailing means "trap nothing", the conservative direction. Checked
that no catalog source (252 JS versions) produces an error node, so the
false-positive sweep still exercises the analysis on all of them.

**No shared parse; a size threshold instead.** The neutralizer only parses when
`import(`/`eval(`/HTML markers appear, so sharing would not help the common
case. Added AppConfig `geometry.sesUndeclaredCheckMaxChars` (default 150 000;
bounds + Advanced Settings field per the config rules), passed to each engine
Worker in its `init` message because a Worker's getConfig() only sees defaults.
The Worker's self-test of the trap only runs when the limit allows it, so
setting the limit to 0 doesn't fail SES startup.

**OCCT error classes** are hardened right after OCCT init. I couldn't provoke
one from model code — the BREP wrappers validate arguments and translate OCCT
exceptions into plain Errors — so there's no stamp seed for it.
