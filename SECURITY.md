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

**Well-known dependencies.** Everything the browser loads comes from established open-source libraries:

| Package | Purpose | Loaded |
|---------|---------|--------|
| `manifold-3d` | WASM mesh geometry engine | always |
| `three`, `three-mesh-bvh` | 3D rendering and ray-casting | always |
| `codemirror` + `@codemirror/*` | Code editor | always |
| `preact`, `@preact/signals` | UI components | always |
| `opentype.js`, `js-beautify` | 3D text fonts, code formatting | always |
| `openscad-wasm-prebuilt` | OpenSCAD engine | only when you use OpenSCAD |
| `replicad`, `replicad-opencascadejs` | BREP / OpenCASCADE engine | only when you use BREP |
| `@anthropic-ai/sdk` | Talks to Anthropic's API with your own key | only when you connect Anthropic |
| `@mlc-ai/web-llm` | Runs a local AI model on your GPU | only when you choose a local model |

The other entries in `package.json` are build and test tooling (Vite, Tailwind, Playwright, sharp) that never ships to the browser. There are no bundled analytics SDKs and no ad frameworks. The only analytics is Cloudflare's edge-injected, cookieless Web Analytics beacon, which is not an npm dependency.

**Content Security Policy.** The CSP header blocks:
- Inline scripts (`<script>alert(1)</script>`)
- External script loading (`<script src="evil.com/...">`), except the Cloudflare analytics beacon
- External font/image loading (fingerprinting vectors)
- Plugins (`<object>`/`<embed>`) and form posts to other sites

The CSP does **not** restrict which HTTPS hosts the page can `fetch`. `connect-src` allows `https:` (plus `localhost`) on purpose, so that a **Custom (OpenAI-compatible) AI endpoint** you host yourself and **Import from URL** can reach any address you give them. The app only makes these requests when you trigger them: it talks to the AI provider you connected, downloads local-model weights you chose, and fetches URLs you import.

**Geometry data is numbers only.** The `#geometry-data` DOM element (read by AI agents for model stats) contains only computed numerical values — vertex counts, volumes, bounding boxes. User code never appears in this element.

## Code execution model

The geometry editor executes user-written JavaScript via `new Function('api', code)`. This is **not a security sandbox** — it's equivalent to `eval()` with strict mode. User code can access `window`, `document`, and browser APIs.

This is by design: Partwright is a code editor, like CodePen or JSFiddle. You should only run code you trust, just as you would in a browser dev console.

The `api` parameter provides only geometry primitives (`Manifold`, `CrossSection`, etc.) — no browser APIs are passed in. But the sandbox boundary is convention, not enforcement.

## How to verify

If you want to audit the app yourself:

1. **Read the source.** Start with `index.html`, `src/main.ts`, and `public/ai.md`. Everything AI-related lives in `src/ai/`.
2. **Check the CSP.** Open DevTools → Network → look at response headers for `Content-Security-Policy`.
3. **Search for hidden text.** In DevTools Console: `document.querySelectorAll('[style*="display:none"], [style*="visibility:hidden"], [aria-hidden]')` — should return only the `#geometry-data` stats element.
4. **Monitor network.** Open DevTools → Network tab. After the initial page load, the only outbound requests are the analytics beacon and the ones you trigger: AI turns to the provider you connected, a local model download you chose, or a URL import.
5. **Review dependencies.** `npm ls --depth=0` shows all direct dependencies. `npm audit` checks for known vulnerabilities.

## Reporting vulnerabilities

If you find a security issue, please report it privately through GitHub's [private vulnerability reporting](https://github.com/kemper/partwright/security/advisories/new) rather than in a public issue. If that form isn't available, open a short issue asking for a private contact (no vulnerability details) and the maintainer will follow up. For anything else — bugs, feature ideas, questions — see [Feedback & support](README.md#feedback--support).
