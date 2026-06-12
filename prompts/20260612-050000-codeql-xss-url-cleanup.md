---
session: "6a833de5"
timestamp: "2026-06-12T05:00:00Z"
model: claude-opus-4-8
---

## Human

While preparing the June 12 staging → production release PR (#628), the CodeQL
default-setup check failed with 12 alerts. "Can you review and decide if they
are all false or won't-fix? Otherwise if they need to be addressed create PR
targeting main with the fixes/cleanup." (Alert list was pasted from the
Security ▸ Code scanning tab because this session has no gh/token access to the
code-scanning API.)

## Assistant

## Triage

Twelve alerts, none introduced by the release PR itself (it's a pure
`staging → production` promotion — same code already on `main`). Split three
ways:

**By design — leave as won't-fix (UI dismissal, can't suppress in code):**

- 6× Critical `js/code-injection` (`manifoldJs.ts:645,774`, `replicad.ts:76,183`,
  `voxel.ts:86,146`) — every one is `new Function('api', userCode)`, the
  intentional client-side modeling sandbox. The user runs their own code in
  their own browser; there is no server and no cross-user trust boundary, so
  this is the product's core mechanism, not a vulnerability. The repo uses
  CodeQL **default setup**, which honors neither inline `// codeql[...]`
  suppressions nor a `codeql-config.yml` query filter, so these can only be
  dismissed from the Security UI (needs security-write — left to the human).

- 1× High `js/unvalidated-dynamic-method-call` (`agentWorker.ts:90`) — `resolve`
  is a Promise resolver we created and stored in `pendingToolCalls`, fetched by
  a `callId` we generate and already null-guarded. Not arbitrary dispatch;
  false positive.

**Real / code-addressable — fixed here:**

- 2× High XSS (`exportConfirmModal.ts:74,90`). The interpolated values are
  actually numbers (bbox dimensions, `componentCount`), so the practical risk
  is nil, but they are genuine `innerHTML` sinks. Rather than argue
  false-positive, escape them defensively via `escapeHtml(...)` — consistent
  with the recent filament-slot-name XSS fix (`e23a4c3`) and cheap insurance if
  the source types ever widen to strings.

- 3× High `js/incomplete-url-substring-sanitization`
  (`ai-autoresume.spec.ts:55,118,174`). Test-only mock routing did
  `url.includes('generativelanguage.googleapis.com')`, which a crafted URL
  could satisfy as a substring. Switched to
  `new URL(url, location.origin).hostname !== '...'` — correct host matching,
  resolves relative URLs (e.g. `/ai.md`) to the test origin so they still pass
  through to the real fetch, and clears the alert. Test code, but the fix is
  also simply correct.

## Decision

Fixes land on a branch into **`main`** (not the release branch — the superset
rule forbids release-branch-only content). The by-design code-injection alerts
are recommended for UI dismissal as "won't fix"; migrating to CodeQL advanced
setup purely to filter them in-config would be a larger change and wasn't done.
