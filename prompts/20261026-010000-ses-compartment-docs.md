---
session: "01BsPPSVZ2oFGFXTxRyBtu1M"
timestamp: "2026-10-26T01:00:00Z"
model: claude-opus-5-5
sequence: 2
---

## Human

[Same delegated #1127 task as sequence 1.] Docs checklist item: update the
"Locked-down environment" note in public/ai.md (which globals exist inside the
compartment; built-ins are frozen, so no patching `Array.prototype`), document
the ordering rule, the lockdown preset and why, the glue-fix transform and the
kill switch in docs/engine-sandbox.md and docs/architecture-notes.md, and
review the legal "Code execution" wording.

## Assistant

## Key decisions

**Where the detail lives.** docs/architecture-notes.md carries the full design
(ordering, preset with the measured reasons, glue fix, endowments, the
shared-state rules new engine code must follow — install-once wrappers, never
hand model code an unfreezable engine graph like a replicad shape, harden
error classes evaluated before lockdown — error UX, fail-closed, allowlist,
kill switch, the Node parity gap). docs/engine-sandbox.md gets a short section
plus the measured perf table and how to run the opt-in sweep/perf spec, since
it already hosts the iframe-sandbox measurements.

**ai.md tells the agent what it can actually name** (and what it can't —
timers, `navigator`, `self`, `crypto`, `URL`, `structuredClone`, `Intl`), that
built-ins and api objects are frozen, that `globalThis` doesn't persist between
runs, how the undeclared-name hint reads, and that `import(`/`eval(` are only
refused in code, not comments/strings — the failure modes an AI is most likely
to hit.

**Legal wording.** "Not a hardened security sandbox" is no longer accurate by
default, but I avoided overclaiming: it now says code runs in an SES
compartment inside the locked-down Worker, and that these are layers of
defence, not a guarantee (they depend on the browser and SES having no flaws;
CPU/memory and the returned geometry are still the code's to control). The
origin sandbox (#1110) is still opt-in, so it isn't claimed.
