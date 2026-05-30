# Smoke Test

Manually verify the app after touching routing, Vite config, index.html, or initialization code. Start the dev server (`npm run dev`) then check each item in a browser:

1. **Landing page**: Navigate to `http://localhost:5173/` — shows hero section ("Partwright", "AI-driven parametric CAD in your browser"), CTA buttons, Recent Sessions grid (or empty state).
2. **Open Editor**: Click "Open Editor" — URL changes to `/editor`, status shows "Ready" (green), code editor on left with default example, 3D model renders on right.
3. **WASM engine loads**: Status pill says "Ready" (green), NOT "Loading WASM…" or "WASM failed". If "WASM failed": check `manifold.wasm` (no 403 — if 403, check `server.fs.strict` in vite.config.ts), and COEP/COOP headers present on responses (from the server — Vite `server.headers` in dev, `public/_headers` in prod; the offline service worker `src/sw.ts` re-applies them on cached documents offline).
4. **Help page**: Click `?` in toolbar — navigates to `/help`, shows help content. "Back" returns to the editor.
5. **AI agent bypass**: `http://localhost:5173/editor` goes straight to the editor. `window.partwright.renderViews({views:"box"})` returns a 6-face composite PNG data URL.
6. **Session loading**: Click a session tile on the landing page — loads session code in editor, shows session name in session bar, URL updates to `/editor?session=<id>`.
7. **Build**: `npm run build` succeeds with no TypeScript errors.
8. **Paint mode**: Click Paint button in viewport overlay — color picker panel appears. Click a face — paints the coplanar region in the selected color. Paint button badge shows region count.
9. **Editor lock**: After painting, editor shows lock banner ("This version has color regions applied.") and is read-only. Run button disabled.
10. **Unlock modal**: Click "Unlock to edit" — modal shows two options. Clicking "Unlock editor" with default "preserve" saves the colored version and creates a new uncolored version. Editor unlocks.
11. **Gallery badges**: Colored versions show small color-swatch dots next to the version label.
12. **Color export**: With regions painted, export GLB — file carries vertex colors. Export 3MF — includes `<basematerials>` and per-triangle `pid` attributes.
13. **Annotations per-version**: Annotate v1, save v2 (annotations persist). Clear, draw a different annotation, save v3. Navigating v1↔v2↔v3 swaps annotations to match (v1 empty, v2 first set, v3 second set). Importing a schema-1.2 file (top-level `annotations`) attaches those annotations to the latest version.
14. **Local model picker**: Click `✦ Connect AI` → follow "Run a local model in your browser" → second modal lists Small/Medium/Large/Vision with download sizes. WebGPU banner green on Chrome/Edge/Safari 26+, red elsewhere. "Use this model"/"Download X GB" only triggers a network request the first time; cached models show "Downloaded" pill and skip to GPU load.
15. **STL import**: With no session (or expendable starter) — import lands directly as new session, no modal. With a real session — import-target modal shows New part / Add to current part / New session. "New part" is default. Editor shows `return Manifold.ofMesh(api.imports[0])` wrapper, mesh renders, version label is "imported". Editing the wrapper re-renders correctly. Close and reopen — imported mesh restores from IndexedDB.
16. **Merge parts**: Check two+ parts in the Parts rail — bulk-action bar shows **Merge N** beside Delete. Opens modal: combine into new part (keeps originals) or merge into one (replaces). Works for hand-coded parts, not just imported. Current part's unsaved edits are saved first.
