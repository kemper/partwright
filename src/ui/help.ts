// Help page — explains what Partwright is and how to use it

import { getShortcutDocs, IS_MAC, MOD_LABEL, SHIFT_LABEL, ALT_LABEL } from './shortcutDefs';

export interface HelpCallbacks {
  onBack: () => void;
  onStartTour: () => void;
}

interface HelpSection {
  id: string;
  heading: string;
  body: string;
}

export function createHelpPage(
  container: HTMLElement,
  callbacks: HelpCallbacks,
): HTMLElement {
  const page = document.createElement('div');
  page.id = 'help-page';
  page.className = 'flex flex-col items-center w-full h-full overflow-auto bg-zinc-900 text-zinc-100';

  const content = document.createElement('div');
  content.className = 'max-w-3xl w-full px-6 py-12';

  // Back button
  const backBtn = document.createElement('button');
  backBtn.className = 'text-xs text-zinc-500 hover:text-zinc-300 mb-8 transition-colors';
  backBtn.textContent = '← Back';
  backBtn.addEventListener('click', callbacks.onBack);
  content.appendChild(backBtn);

  // Title
  const title = document.createElement('h1');
  title.className = 'text-2xl font-bold mb-3';
  title.textContent = 'How Partwright works';
  content.appendChild(title);

  const subtitle = document.createElement('p');
  subtitle.className = 'text-sm text-zinc-400 leading-relaxed mb-8';
  subtitle.innerHTML = 'A complete guide to the editor, viewport, painting, sessions, exports, and the in-browser AI assistant. Skim the table of contents below, or jump straight to a section.';
  content.appendChild(subtitle);

  const sections: HelpSection[] = [
    {
      id: 'overview',
      heading: 'What is Partwright?',
      body:
        'Partwright is a browser-based parametric CAD tool powered by <a href="https://github.com/elalish/manifold" class="text-blue-400 hover:underline">manifold-3d</a> (compiled to WebAssembly). It runs entirely in your browser — no server, no account, no data leaving your machine.<br><br>' +
        'You write code that constructs 3D geometry. The result renders live in the viewport, and you can save iterations as versions, paint colored regions for multi-material 3D printing, and export to 3MF, STL, OBJ, or GLB.<br><br>' +
        'Partwright supports two modeling languages: <strong class="text-zinc-300">JavaScript</strong> (default, using the manifold-3d API) and <strong class="text-zinc-300">OpenSCAD</strong> (standard <code class="text-emerald-400 bg-zinc-800 px-1 rounded">.scad</code> syntax via WASM). Switch between them with the <strong class="text-zinc-300">JS / SCAD</strong> toggle in the toolbar — switching creates a new session, and each session uses one language for all of its versions.',
    },
    {
      id: 'editor',
      heading: 'The editor & status indicator',
      body:
        'The left pane is a CodeMirror editor with syntax highlighting for both JavaScript and OpenSCAD. In JavaScript mode, your code receives an <code class="text-emerald-400 bg-zinc-800 px-1 rounded">api</code> object and must <code class="text-emerald-400 bg-zinc-800 px-1 rounded">return</code> a Manifold object. In OpenSCAD mode, use standard SCAD syntax (no return needed).<br><br>' +
        '<strong class="text-zinc-300">Status indicator</strong> — Just above the editor, a small badge reports engine state:' +
        '<ul class="list-disc list-inside mt-2 space-y-1 text-zinc-400">' +
        '<li><span class="text-emerald-400">Ready</span> — idle, geometry rendered successfully</li>' +
        '<li><span class="text-amber-400">Running…</span> / <span class="text-amber-400">Loading…</span> — code or WASM is in flight</li>' +
        '<li><span class="text-red-400">Error</span> — compilation or runtime error; click for full message</li>' +
        '</ul><br>' +
        '<strong class="text-zinc-300">Auto-render</strong> — The <code class="text-emerald-400 bg-zinc-800 px-1 rounded">⏸ Auto</code> button toggles live re-rendering as you type. When paused, a manual <code class="text-emerald-400 bg-zinc-800 px-1 rounded">▶ Run</code> button appears. Useful when iterating on heavy geometry that you don\'t want re-running on every keystroke.',
    },
    {
      id: 'building',
      heading: 'Building geometry',
      body:
        '<strong class="text-zinc-300">JavaScript:</strong> Start with primitives like <code class="text-emerald-400 bg-zinc-800 px-1 rounded">Manifold.cube()</code>, <code class="text-emerald-400 bg-zinc-800 px-1 rounded">Manifold.cylinder()</code>, or <code class="text-emerald-400 bg-zinc-800 px-1 rounded">Manifold.sphere()</code>. Combine them with boolean operations: <code class="text-emerald-400 bg-zinc-800 px-1 rounded">.add()</code> (union), <code class="text-emerald-400 bg-zinc-800 px-1 rounded">.subtract()</code>, <code class="text-emerald-400 bg-zinc-800 px-1 rounded">.intersect()</code>.<br><br>' +
        '<strong class="text-zinc-300">OpenSCAD:</strong> Use standard primitives <code class="text-emerald-400 bg-zinc-800 px-1 rounded">cube()</code>, <code class="text-emerald-400 bg-zinc-800 px-1 rounded">cylinder()</code>, <code class="text-emerald-400 bg-zinc-800 px-1 rounded">sphere()</code> with boolean operations <code class="text-emerald-400 bg-zinc-800 px-1 rounded">difference()</code>, <code class="text-emerald-400 bg-zinc-800 px-1 rounded">union()</code>, <code class="text-emerald-400 bg-zinc-800 px-1 rounded">intersection()</code>. Note: <code class="text-emerald-400 bg-zinc-800 px-1 rounded">text()</code> is not available (fonts not loaded).<br><br>' +
        '<strong class="text-zinc-300">Coordinate system:</strong> Right-handed, <strong class="text-zinc-300">Z-up</strong>. The XY plane is the ground, Z points up. Units are arbitrary — use a consistent scale (millimetres are common for 3D printing).',
    },
    {
      id: 'quick-example',
      heading: 'Quick example',
      body:
        '<pre class="bg-zinc-800 rounded-lg p-4 text-xs leading-relaxed overflow-x-auto mt-2"><code class="text-zinc-300">const { Manifold } = api;\n\n// Create a box and subtract a cylinder\nconst box = Manifold.cube([20, 20, 10], true);\nconst hole = Manifold.cylinder(12, 4, 4);\n\nreturn box.subtract(hole);</code></pre>',
    },
    {
      id: 'tabs',
      heading: 'Tabs in the right pane',
      body:
        'The right pane is divided into tabs. Each one offers a different view of the current version:' +
        '<ul class="list-disc list-inside mt-2 space-y-1.5 text-zinc-400">' +
        '<li><strong class="text-zinc-300">Interactive</strong> — Live 3D viewport. Drag to orbit, scroll to zoom, right-drag to pan.</li>' +
        '<li><strong class="text-zinc-300">Gallery</strong> — Grid of saved versions. Click any thumbnail to load that version into the editor.</li>' +
        '<li><strong class="text-zinc-300">Images</strong> — Attach reference photos or renderings (file upload or paste URL). Each image gets a label (Front / Right / Back / Left / Top / Perspective) for ordering and reference.</li>' +
        '<li><strong class="text-zinc-300">Diff</strong> — Side-by-side comparison between any two versions: code on the left and right, plus a stats delta bar (volume, dimensions, manifold status).</li>' +
        '<li><strong class="text-zinc-300">Notes</strong> — Per-session free-text log. Use it to capture requirements, decisions, and feedback as the design evolves.</li>' +
        '</ul>',
    },
    {
      id: 'viewport-tools',
      heading: 'Viewport tools',
      body:
        'Buttons in the viewport overlay (top-right of the Interactive tab):' +
        '<ul class="list-disc list-inside mt-2 space-y-1.5 text-zinc-400">' +
        '<li><strong class="text-zinc-300">Grid</strong> — Toggle the XY ground plane grid.</li>' +
        '<li><strong class="text-zinc-300">Dimensions</strong> — Toggle the bounding-box overlay with X / Y / Z extents.</li>' +
        '<li><strong class="text-zinc-300">Orbit lock</strong> — Freeze camera rotation. Useful while painting, measuring, or annotating.</li>' +
        '<li><strong class="text-zinc-300">Measure</strong> — Click to drop point 1, drag to point 2; the distance shows as a 3D label. Click elsewhere to clear. Orbit lock engages automatically.</li>' +
        '<li><strong class="text-zinc-300">Cross-section</strong> — Toggle a horizontal clipping plane. A Z slider appears; everything above the plane is hidden and the cut face renders in red.</li>' +
        '<li><strong class="text-zinc-300">Annotate</strong> — Draw freehand strokes or drop pinned text labels on the model. Annotations are saved per version and survive export to <code class="text-emerald-400 bg-zinc-800 px-1 rounded">.partwright.json</code>.</li>' +
        '<li><strong class="text-zinc-300">Paint</strong> — Color regions of the model for multi-material printing (full details below).</li>' +
        '<li><strong class="text-zinc-300">Simplify</strong> — Reduce the model\'s triangle count. Drag the slider or type a max-triangle target, then click "Apply" to run the reduction (a progress bar tracks heavy models); exports then use the reduced mesh. "Save as version" bakes the lighter mesh into a new saved version, while "Reset" restores full detail.</li>' +
        '</ul>',
    },
    {
      id: 'paint',
      heading: 'Painting & color regions',
      body:
        'Click the <strong class="text-zinc-300">Paint</strong> button in the viewport overlay to open the color panel. Pick a tool, pick a color, and click the model. Painted regions are saved with the version and exported as native color in 3MF (for slicers like Bambu Studio), as vertex color in OBJ + MTL, and as vertex color in GLB.<br><br>' +
        '<strong class="text-zinc-300">Three paint tools:</strong>' +
        '<ul class="list-disc list-inside mt-2 space-y-1.5 text-zinc-400">' +
        '<li><strong class="text-zinc-300">Bucket</strong> (flood-fill) — Click a face; paint propagates across all coplanar neighbours within an angle tolerance you control with a slider (0° = "coplanar only" up to 180° = "whole connected mesh"). Hover for a translucent preview before committing.</li>' +
        '<li><strong class="text-zinc-300">Brush</strong> — Click and drag to paint individual triangles. Release to commit the region.</li>' +
        '<li><strong class="text-zinc-300">Slab</strong> — Pick an X/Y/Z axis, then drag a range along the model surface; every triangle whose centroid falls inside the slab gets painted. A translucent cuboid previews the slab extent.</li>' +
        '</ul><br>' +
        '<strong class="text-zinc-300">Region management:</strong> The panel lists every painted region with its color and triangle count. Use <strong class="text-zinc-300">Undo</strong> / <strong class="text-zinc-300">Redo</strong> to step through history, <strong class="text-zinc-300">Hide / Show</strong> to toggle visibility (exports still include the colors), and <strong class="text-zinc-300">Clear</strong> to remove all regions. The Paint button shows a badge with the live region count.<br><br>' +
        '<strong class="text-zinc-300">Editor lock:</strong> Once a version has any painted regions, the code editor locks (read-only) so paint and code can\'t drift out of sync. A banner appears above the editor — click <strong class="text-zinc-300">Unlock to edit</strong> and choose:' +
        '<ul class="list-disc list-inside mt-2 space-y-1 text-zinc-400">' +
        '<li><strong class="text-zinc-300">Preserve</strong> (default, recommended) — Forks a new uncolored version for editing while keeping the painted version intact in the gallery.</li>' +
        '<li><strong class="text-zinc-300">Destructive</strong> — Strips paint from the current version. Cannot be undone.</li>' +
        '</ul><br>' +
        '<strong class="text-zinc-300">Export formats and color:</strong> 3MF carries painted regions as native materials (recommended for printing). OBJ + MTL and GLB carry per-triangle vertex colors. STL is geometry-only — no color.',
    },
    {
      id: 'sessions',
      heading: 'Sessions & versions',
      body:
        'A <strong class="text-zinc-300">session</strong> is a container for a single design — its code, saved versions, notes, attached images, and annotations. All session data lives in your browser\'s IndexedDB; nothing is uploaded.<br><br>' +
        '<strong class="text-zinc-300">Creating a session</strong> — Click <strong class="text-zinc-300">+ New Session</strong> in the session bar, or start typing in the editor (Partwright auto-creates one). Each session bakes in its language (JS or SCAD) when it\'s created.<br><br>' +
        '<strong class="text-zinc-300">Saving versions</strong> — Click <strong class="text-zinc-300">💾 Save</strong> to snapshot the current code, geometry, annotations, and color regions. Versions auto-name as v1, v2, v3… and a save only happens if something actually changed. Use the <strong class="text-zinc-300">◀ / ▶</strong> arrows in the session bar (or the version dropdown) to step through history; the URL updates to <code class="text-emerald-400 bg-zinc-800 px-1 rounded">?session=&lt;id&gt;&amp;v=&lt;n&gt;</code> so browser back/forward work as expected.<br><br>' +
        '<strong class="text-zinc-300">Gallery</strong> — Each version tile shows a thumbnail, label, geometry stats (volume, dimensions, manifold status), color-region swatches, and the version\'s notes. Click a tile to load.<br><br>' +
        '<strong class="text-zinc-300">Notes</strong> — Per-session free text in the Notes tab. Add, edit, and delete entries; timestamps are recorded for each.<br><br>' +
        '<strong class="text-zinc-300">Managing sessions</strong> — Click <strong class="text-zinc-300">Sessions…</strong> in the toolbar to open the session list: rename, delete, export, or open any session. Empty sessions (no versions, no notes) are auto-cleaned when you move on.',
    },
    {
      id: 'catalog',
      heading: 'Catalog of premade models',
      body:
        'Click <strong class="text-zinc-300">☰ Catalog</strong> in the toolbar to browse a gallery of premade models — twisted vase, retro rocket, chess rook, Christmas tree, desk organizer, spur gear, and more. Each tile shows a thumbnail, the language it\'s written in, and a short description. Click a tile to preview, then <strong class="text-zinc-300">Import</strong> to load it as a fresh session — a great starting point for learning the API or remixing into your own designs.',
    },
    {
      id: 'import-export',
      heading: 'Importing & exporting',
      body:
        '<strong class="text-zinc-300">Import</strong> — Open a <code class="text-emerald-400 bg-zinc-800 px-1 rounded">.partwright.json</code> session from another machine, or load raw <code class="text-emerald-400 bg-zinc-800 px-1 rounded">.js</code> / <code class="text-emerald-400 bg-zinc-800 px-1 rounded">.scad</code> code. The Import dropdown also remembers your recent imports for one-click re-loading.<br><br>' +
        '<strong class="text-zinc-300">Export — 3D model formats:</strong>' +
        '<ul class="list-disc list-inside mt-2 space-y-1 text-zinc-400">' +
        '<li><strong class="text-zinc-300">3MF</strong> (recommended for printing) — Geometry plus native color regions. Imports cleanly into Bambu Studio and other modern slicers.</li>' +
        '<li><strong class="text-zinc-300">OBJ</strong> — Geometry plus color via an MTL sidecar. Delivered as a ZIP — extract before importing into a slicer.</li>' +
        '<li><strong class="text-zinc-300">STL</strong> — Geometry only, no color. Universal slicer support.</li>' +
        '<li><strong class="text-zinc-300">GLB</strong> — Web/preview format with vertex colors. Good for embedding online, not read by slicers.</li>' +
        '</ul><br>' +
        '<strong class="text-zinc-300">Export — Project formats:</strong>' +
        '<ul class="list-disc list-inside mt-2 space-y-1 text-zinc-400">' +
        '<li><strong class="text-zinc-300">Session (.partwright.json)</strong> — All versions, notes, annotations, color regions, and attached images. Another Partwright user can import this and pick up where you left off. A dialog lets you choose whether to embed the thumbnail, notes, annotations, and color regions.</li>' +
        '<li><strong class="text-zinc-300">Code (raw)</strong> — Just the editor contents as plain <code class="text-emerald-400 bg-zinc-800 px-1 rounded">.js</code> or <code class="text-emerald-400 bg-zinc-800 px-1 rounded">.scad</code>.</li>' +
        '</ul><br>' +
        'The Export dropdown remembers recent exports so you can download the exact same blob again without re-running the code.',
    },
    {
      id: 'quality-theme',
      heading: 'Quality settings & theme',
      body:
        '<strong class="text-zinc-300">Quality</strong> — The ⚙ icon in the toolbar opens the modeling-quality modal. Pick a preset (Ultra / Very High / High / Medium / Low) that controls how many segments approximate a circle, or choose <em>Custom</em> to type an exact count. <em>Very High</em> (128 segments) is the default; <em>Ultra</em> (1024 segments) gives near-perfect curves for smooth final output, while lower presets render faster when you\'re iterating on heavy geometry. The preset only applies to curves that don\'t pass their own segment count, so it sticks across sessions and the AI assistant honors it too.<br><br>' +
        '<strong class="text-zinc-300">Theme</strong> — Toggle <strong class="text-zinc-300">Dark Mode</strong> in the toolbar to switch the entire UI, viewport background, and grid colors between dark and light. Your choice persists across sessions.',
    },
    {
      id: 'ai-costs-risk',
      heading: 'A note on AI costs & risk',
      body: 'Partwright is an experiment — a passion project exploring what happens when you put generative AI inside a 3D modeling tool, shared openly because I\'ve found real joy in building it and hope others find value in it too. I\'ve spent my own money on this and I\'m not trying to make money from it.<br><br>' +
        'That said: <strong class="text-zinc-300">when you connect your own AI agent, it uses your API tokens.</strong> AI-driven CAD is genuinely hard and unpredictable — the agent might iterate many times before landing on something good (or give up trying). There are some guardrails in place to help limit runaway spend, but there\'s no guarantee they work perfectly in every situation. <strong class="text-zinc-300">By connecting your own AI agent, you accept responsibility for any API costs incurred, regardless of output quality.</strong><br><br>' +
        'Go in eyes open, start with small experiments, and enjoy the ride.',
    },
    {
      id: 'ai-browser',
      heading: 'AI assistant in the browser (Anthropic API key)',
      body:
        'Partwright includes a built-in AI assistant powered by Claude. The assistant runs entirely from your browser: you provide an <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener" class="text-blue-400 hover:underline">Anthropic API key</a>, and every request goes directly from your browser to Anthropic — Partwright never sees the key or the conversation.<br><br>' +
        '<strong class="text-zinc-300">Connecting a key:</strong>' +
        '<ol class="list-decimal list-inside mt-2 space-y-1 text-zinc-400">' +
        '<li>Click <strong class="text-zinc-300">Connect AI</strong> in the toolbar.</li>' +
        '<li>Paste a key (looks like <code class="text-emerald-400 bg-zinc-800 px-1 rounded">sk-ant-…</code>) into the modal.</li>' +
        '<li>Partwright sends a 1-token test request to verify it, then stores the key in your browser\'s IndexedDB.</li>' +
        '<li>The toolbar button changes to <strong class="text-zinc-300">✦ AI</strong> and the chat drawer is ready to use.</li>' +
        '</ol><br>' +
        '<div class="rounded border border-amber-700/50 bg-amber-900/20 px-3 py-2 text-xs text-amber-200 leading-snug mb-3"><strong>Recommended:</strong> use a workspace-scoped key with a monthly spend cap. Anyone who can run code in this page (browser extensions, devtools) can read the key.</div>' +
        '<strong class="text-zinc-300">What the assistant can do</strong> — The chat panel slides in from the right. Type a request, attach images for reference, or click <strong class="text-zinc-300">Show AI</strong> to snapshot the four isometric views and feed them to the model. Claude can write and run code, save versions to the gallery, paint colored regions, and iterate until your design is right.<br><br>' +
        '<strong class="text-zinc-300">Models:</strong>' +
        '<ul class="list-disc list-inside mt-2 space-y-1 text-zinc-400">' +
        '<li><strong class="text-zinc-300">Claude Haiku</strong> — fast and cheap; good for quick fixes.</li>' +
        '<li><strong class="text-zinc-300">Claude Sonnet</strong> (default) — balanced cost and capability for most tasks.</li>' +
        '<li><strong class="text-zinc-300">Claude Opus</strong> — most capable; reach for it on complex multi-step geometry.</li>' +
        '</ul><br>' +
        '<strong class="text-zinc-300">Toggles & guardrails:</strong> At the bottom of the panel are switches for auto-rendering snapshots, allowing the model to run code, allowing it to save versions, allowing it to paint, how many tool errors to silently retry, a per-turn iteration cap (4 / 16 / 64 / ∞), and a per-turn spend cap ($0.10 / $0.50 / $2 / $10 / ∞). Use presets — <em>Minimal</em>, <em>Standard</em>, <em>Full</em> — to flip whole bundles at once.<br><br>' +
        '<strong class="text-zinc-300">Costs & history:</strong> The panel shows a live cost meter. The ⚙ icon opens settings with lifetime token usage, estimated spend, when the key was added, and buttons to replace or disconnect it. Chat history is saved per session in IndexedDB; use <strong class="text-zinc-300">Compact</strong> to summarize older turns and free up context when conversations get long.',
    },
    {
      id: 'ai-external',
      heading: 'Connecting an external AI agent',
      body:
        'If you\'d rather drive Partwright from Claude Code, ChatGPT, or another agent (instead of using the in-browser assistant), there are three common setups:' +
        '<ul class="list-disc list-inside mt-2 space-y-1.5 text-zinc-400">' +
        '<li><strong class="text-zinc-300">Claude in Chrome extension</strong> — Install the extension and Claude can control your active tab directly. Best for interactive sessions where you watch and steer.</li>' +
        '<li><strong class="text-zinc-300">Chrome DevTools MCP</strong> — Enable remote debugging in Chrome, then add the MCP server to your agent. Uses your existing browser session and cookies.</li>' +
        '<li><strong class="text-zinc-300">Playwright MCP</strong> — Launches a separate browser, no Chrome setup needed. Best for automated or headless workflows.</li>' +
        '</ul><br>' +
        'Once connected, the agent navigates to Partwright, reads <a href="/ai.md" class="text-blue-400 hover:underline">/ai.md</a> for the full API reference, then drives the app via the <code class="text-emerald-400 bg-zinc-800 px-1 rounded">window.partwright</code> console API to create sessions, run code, validate results, and save versions. The legacy <code class="text-emerald-400 bg-zinc-800 px-1 rounded">window.mainifold</code> alias still works for older prompts.',
    },
    {
      id: 'ai-try',
      heading: 'Try it with an external AI agent',
      body: (() => {
        const origin = window.location.origin;
        return 'Copy and paste this prompt into Claude Code, ChatGPT, or any AI agent with browser access to verify everything works end-to-end:' +
          '<pre class="bg-zinc-800 rounded-lg p-4 text-xs leading-relaxed overflow-x-auto mt-3 mb-3 whitespace-pre-wrap"><code class="text-zinc-300">' +
          `Read the AI agent instructions at ${origin}/ai.md to understand how to use this tool.\n\n` +
          `Then navigate to ${origin}/editor and use the window.partwright console API to:\n\n` +
          '1. Create a session called "Standard Lego Brick"\n' +
          '2. Build a standard 2x4 Lego brick (approximately 31.8mm x 15.8mm x 11.4mm with studs on top and hollow underside with tubes)\n' +
          '3. Save each major step as a version (e.g. v1 - base block, v2 - add studs, v3 - hollow underside with tubes)\n' +
          '4. Use assertions to verify each version is a valid manifold with maxComponents: 1\n' +
          '5. Give me the gallery URL when done so I can review the versions</code></pre>' +
          'The agent should read <code class="text-emerald-400 bg-zinc-800 px-1 rounded">ai.md</code>, create a named session, iterate through versions, and hand back a gallery link for review.';
      })(),
    },
    {
      id: 'command-palette',
      heading: 'Command palette & cheat sheet',
      body: (() => {
        const kbd = (k: string) => `<strong class="text-zinc-300">${k}</strong>`;
        const paletteKeys = IS_MAC ? `${MOD_LABEL} K` : `${MOD_LABEL} + K`;
        return (
          `Press ${kbd(paletteKeys)} anywhere to open the <strong class="text-zinc-300">command palette</strong> — a searchable list of every action: run, save, format, switch tabs, export (3MF / STL / OBJ / GLB), toggle the AI panel or diagnostic log, start or open a session, or jump to the catalog or this help page. Type to filter, ${kbd('↑')} / ${kbd('↓')} to choose, ${kbd('Enter')} to run, ${kbd('Esc')} to close.<br><br>` +
          `Press ${kbd('?')} (when you\'re not typing in a field) to pop up the full keyboard-shortcuts cheat sheet from anywhere — the same list as below.`
        );
      })(),
    },
    {
      id: 'shortcuts',
      heading: 'Keyboard shortcuts',
      body: (() => {
        const kbd = (keys: string) => `<strong class="text-zinc-300">${keys}</strong>`;
        const modEnter = IS_MAC ? `${MOD_LABEL} Enter` : `${MOD_LABEL} + Enter`;
        const formatKeys = IS_MAC ? `${SHIFT_LABEL} ${ALT_LABEL} F` : `${SHIFT_LABEL} + ${ALT_LABEL} + F`;
        const owned = getShortcutDocs()
          .map(s => `<li>${kbd(s.keys)} — ${s.description}</li>`)
          .join('');
        return (
          '<p class="text-zinc-400">Shortcuts adapt to your operating system (⌘ on macOS, Ctrl elsewhere).</p>' +
          '<ul class="list-disc list-inside mt-2 space-y-1 text-zinc-400">' +
          owned +
          `<li>${kbd(formatKeys)} — Format the code in the editor.</li>` +
          `<li>${kbd('Escape')} — Close the open dropdown, modal, paint or annotate panel, cross-section overlay, or exit the guided tour.</li>` +
          `<li>${kbd('Enter')} / ${kbd('→')} — Next step during the guided tour.</li>` +
          `<li>${kbd('←')} — Previous step during the guided tour.</li>` +
          `<li>${kbd(modEnter)} — Save the current notes textarea.</li>` +
          `<li>${kbd('Enter')} in input modals (e.g. Connect AI, Import Preview) — Confirm.</li>` +
          '</ul>'
        );
      })(),
    },
  ];

  // Table of contents
  const toc = document.createElement('nav');
  toc.className = 'mb-10 p-4 rounded-lg bg-zinc-800/60 border border-zinc-700/60';
  const tocLabel = document.createElement('div');
  tocLabel.className = 'text-xs uppercase tracking-wider text-zinc-500 font-semibold mb-2';
  tocLabel.textContent = 'Contents';
  toc.appendChild(tocLabel);
  const tocList = document.createElement('ul');
  tocList.className = 'grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 text-sm';
  for (const section of sections) {
    const li = document.createElement('li');
    const a = document.createElement('a');
    a.href = `#${section.id}`;
    a.className = 'text-blue-400 hover:text-blue-300 hover:underline';
    a.textContent = section.heading;
    a.addEventListener('click', (e) => {
      e.preventDefault();
      const target = document.getElementById(section.id);
      if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    li.appendChild(a);
    tocList.appendChild(li);
  }
  toc.appendChild(tocList);
  content.appendChild(toc);

  // Render sections
  for (const section of sections) {
    const h = document.createElement('h2');
    h.id = section.id;
    h.className = 'text-sm font-semibold text-zinc-300 uppercase tracking-wide mt-10 mb-3 scroll-mt-8';
    h.textContent = section.heading;
    content.appendChild(h);

    const p = document.createElement('div');
    p.className = 'text-sm text-zinc-400 leading-relaxed';
    p.innerHTML = section.body;
    content.appendChild(p);
  }

  // Tour CTA
  const tourCTA = document.createElement('div');
  tourCTA.className = 'mt-12 p-4 rounded-lg bg-zinc-800 border border-zinc-700 flex items-center justify-between';

  const tourText = document.createElement('span');
  tourText.className = 'text-sm text-zinc-300';
  tourText.textContent = 'New to the editor? Walk through the key features.';
  tourCTA.appendChild(tourText);

  const tourBtn = document.createElement('button');
  tourBtn.className = 'px-4 py-1.5 rounded text-xs bg-blue-600 hover:bg-blue-500 text-white transition-colors shrink-0 ml-4';
  tourBtn.textContent = 'Take the guided tour';
  tourBtn.addEventListener('click', () => {
    callbacks.onStartTour();
  });
  tourCTA.appendChild(tourBtn);
  content.appendChild(tourCTA);

  // Footer with agent link
  const footer = document.createElement('div');
  footer.className = 'mt-12 pt-6 border-t border-zinc-800 text-xs text-zinc-600';
  footer.innerHTML = 'Full AI agent documentation: <a href="/ai.md" class="text-zinc-500 hover:text-zinc-300 transition-colors">/ai.md</a>';
  content.appendChild(footer);

  page.appendChild(content);
  container.appendChild(page);
  return page;
}
