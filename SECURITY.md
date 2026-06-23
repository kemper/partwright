# Security Model

Partwright is a client-side CAD tool designed to be controlled by AI agents. This document explains the security properties of the app so you can make an informed decision about running it with your AI.

## Threat model: AI prompt injection

When you point an AI agent (Claude, GPT, etc.) at a web app, the app becomes an attack surface. A malicious app could embed hidden instructions in the DOM, invisible text, or API responses to trick your AI into:

- Exfiltrating data from your system
- Running destructive commands
- Making unauthorized API calls

### Why Partwright is safe

**No backend for your data.** The app runs entirely in your browser — there are no servers storing your work and no accounts. The only first-party telemetry is privacy-first [Cloudflare Web Analytics](https://www.cloudflare.com/web-analytics/): a cookieless beacon that records aggregate page-view counts (no cookies, no fingerprinting, and nothing about the models you make). Beyond that beacon — and any AI provider you explicitly connect, which your browser talks to directly with your own key — the app makes no outbound requests of its own.

**No hidden instructions.** The only AI-facing content is [`/ai.md`](public/ai.md), explicitly linked via `<link rel="ai-instructions">` in index.html. You can read it yourself — it contains only API documentation for the geometry engine. There are no hidden DOM elements, invisible text, data attributes, or encoded payloads containing instructions.

**Minimal dependencies.** The app has 7 runtime dependencies, all well-known open source libraries:

| Package | Purpose |
|---------|---------|
| `manifold-3d` | WASM geometry engine |
| `three` | 3D rendering |
| `codemirror` + plugins | Code editor |
| `tailwindcss` | CSS styling |

There are no network libraries, no bundled analytics SDKs, and no ad frameworks — the only analytics is Cloudflare's edge-injected, cookieless Web Analytics beacon (not an npm dependency).

**Content Security Policy.** The CSP header blocks:
- Inline scripts (`<script>alert(1)</script>`)
- External script loading (`<script src="evil.com/...">`)
- Outbound network requests (`fetch("evil.com/...")`)
- External font/image loading (fingerprinting vectors)

**Geometry data is numbers only.** The `#geometry-data` DOM element (read by AI agents for model stats) contains only computed numerical values — vertex counts, volumes, bounding boxes. User code never appears in this element.

## Code execution model

The geometry editor executes user-written JavaScript via `new Function('api', code)`. This is **not a security sandbox** — it's equivalent to `eval()` with strict mode. User code can access `window`, `document`, and browser APIs.

This is by design: Partwright is a code editor, like CodePen or JSFiddle. You should only run code you trust, just as you would in a browser dev console.

The `api` parameter provides only geometry primitives (`Manifold`, `CrossSection`, etc.) — no browser APIs are passed in. But the sandbox boundary is convention, not enforcement.

## How to verify

If you want to audit the app yourself:

1. **Read the source.** The app is ~3,000 lines of TypeScript. Start with `index.html`, `src/main.ts`, and `public/ai.md`.
2. **Check the CSP.** Open DevTools → Network → look at response headers for `Content-Security-Policy`.
3. **Search for hidden text.** In DevTools Console: `document.querySelectorAll('[style*="display:none"], [style*="visibility:hidden"], [aria-hidden]')` — should return only the `#geometry-data` stats element.
4. **Monitor network.** Open DevTools → Network tab. The app makes zero outbound requests after initial page load.
5. **Review dependencies.** `npm ls --depth=0` shows all direct dependencies. `npm audit` checks for known vulnerabilities.

## Reporting vulnerabilities

If you find a security issue, please open a GitHub issue or contact the maintainer directly.
