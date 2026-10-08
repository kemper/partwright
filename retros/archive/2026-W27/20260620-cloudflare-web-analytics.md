# Retro — Cloudflare Web Analytics (enable + disclose)

**Task:** Add cheap usage tracking. Landed as: Cloudflare Web Analytics beacon in
all HTML entry points + CSP allowance + truthful rewrite of every "no analytics"
claim (PR #802). Deferred feature-event tracking + opt-out to #803.

## Liked
- The privacy promise being *single-claimed in six places* meant a grep for
  `no analytics|no telemetry|no outbound` instantly surfaced the full blast
  radius — the rewrite was complete because the search was, not because I
  remembered every page.
- `npm run build` + grep for the token across `dist/` was a fast, total proof of
  coverage (caught that `editor.html` and `/v1/` inherit the beacon for free).
- Verifying against the live Cloudflare preview (curl for the tag AND the CSP
  header) confirmed the _headers change end-to-end — something the dev server
  can't show, since `_headers` is Cloudflare-only.

## Lacked
- No single shared HTML `<head>`/shell: the six prerendered entry points
  duplicate head boilerplate, so the beacon had to be pasted six times. A shared
  shell (or a one-line transformIndexHtml inject) would make site-wide `<head>`
  additions a one-touch change instead of six.

## Learned
- For Cloudflare **Pages**, the beacon can be auto-injected at the edge (dashboard
  toggle, no code) OR added as a manual snippet — but **never both**, or it
  double-counts. Worth stating explicitly whenever wiring CF analytics.
- The strict `script-src 'self'` CSP silently blocks the beacon; enabling
  analytics is a *two-part* change (snippet + CSP host), and the copy claims that
  must change live in product code, docs, AND security policy — not just /legal.

## Longed for
- A lint/test asserting the privacy copy and the actual network surface agree —
  right now "no outbound requests" in prose can drift from the real CSP/markup
  with nothing to catch it. A tiny e2e that fails if an HTML entry point gains a
  third-party `<script>` host not named in the privacy page would have made this
  self-policing.
