---
session: "01BsPPSVZ2oFGFXTxRyBtu1M"
timestamp: "2026-10-25T13:45:00Z"
model: claude-opus-5-5
sequence: 2
---

## Human

Review follow-ups on the allowlist-audit PR:
1. `URL.createObjectURL` is still live via the allowlisted `URL`. A probe
   minted a real `blob:` URL into the origin-wide blob registry, which is a
   cross-context write channel. Stub `createObjectURL`/`revokeObjectURL` and
   have verifyLockdown check them.
2. If a browser exposes an unremovable, non-allowlisted global, no model code
   runs at all. That failure, including the names, must reach the app's
   Diagnostic Log (source 'engine'). The user-visible error must say the engine
   refused to start for security reasons. Document that an allowlist entry
   fixes a non-Chromium failure of this kind.
3. Symbol and string labels share one namespace. Separate them.
4. The e2e enumeration re-implements symbolLabel/isInertDescriptor as a
   string. Add a drift test against enumerateChain.
5. Docs: the guarantee rests on removing capability entry points. Removed
   constructors stay reachable from instances.

## Assistant

## Key decisions

**URL statics are stubbed, not deleted.** They become frozen throwing stubs
pinned non-configurable on the constructor, the same treatment as
`importScripts`, so the error says it's disabled instead of reading as
`undefined is not a function`. verifyLockdown accepts them only if the value
is one of *our* stubs (a module-private WeakSet), so a lookalike can't pass.
`URL` itself stays, because asset paths are resolved with it.

**One refusal format shared by the Worker and the app.** `lockdownRefusal.ts`
is a pure module that formats and parses the refusal text, so both sides
import it. The main-thread logger lives in its own module
(`lockdownRefusalLog.ts`, which imports errorLog) so the Worker graph never
pulls in errorLog. The refusal is deterministic for a given browser, so it is
logged once per page per detail. The editor recycle stays quiet ('debug' level)
so the same failure isn't logged twice. The Assembly pool calls `refuseAll`
instead of respawning, because respawning used to burn the budget and replace
the real reason with "failed to initialise". main.ts treats the refusal like
the sandbox-unavailable error, so API and AI callers get the real message
instead of the retryable "superseded".

**Testing the main-thread path.** A real refusal needs a browser whose global
can't be scrubbed. The e2e test therefore has model code post the Worker's own
refusal message, which drives the identical main-thread path. I also checked a
real refusal once, with a temporary forced verify failure (not committed). The
run error, the status bar, the pool and the Diagnostic Log all showed the
offending name.

**Separate namespaces rather than just a prefix.** Symbol labels now read
`@@toStringTag`, `@@for(k)` or `@@unique(d)`, and they are matched only
against a group's `symbols` list. A string key spelled `@@toStringTag`
therefore can't match a symbol entry, or the other way round. Runtime key
lookup is keyed by kind + label.

**Drift test.** The in-Worker enumeration moved to
`tests/helpers/enumerateChainSource.ts` (test-only, not shipped). The unit
test evaluates that exact text against a fake global, before and after
lockdown, and compares the result with the now-exported `enumerateChain`.
