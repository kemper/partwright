// Help page — explains what Partwright is and how to use it

export interface HelpCallbacks {
  onBack: () => void;
  onStartTour: () => void;
}

export function createHelpPage(
  container: HTMLElement,
  callbacks: HelpCallbacks,
): HTMLElement {
  const page = document.createElement('div');
  page.id = 'help-page';
  page.className = 'flex flex-col items-center w-full h-full overflow-auto bg-zinc-900 text-zinc-100';

  const content = document.createElement('div');
  content.className = 'max-w-2xl w-full px-6 py-12';

  // Back button
  const backBtn = document.createElement('button');
  backBtn.className = 'text-xs text-zinc-500 hover:text-zinc-300 mb-8 transition-colors';
  backBtn.textContent = '\u2190 Back';
  backBtn.addEventListener('click', callbacks.onBack);
  content.appendChild(backBtn);

  // Title
  const title = document.createElement('h1');
  title.className = 'text-2xl font-bold mb-6';
  title.textContent = 'How Partwright works';
  content.appendChild(title);

  // Sections
  const sections: { heading: string; body: string }[] = [
    {
      heading: 'What is Partwright?',
      body: 'Partwright is a browser-based parametric CAD tool powered by <a href="https://github.com/elalish/manifold" class="text-blue-400 hover:underline">manifold-3d</a> (compiled to WebAssembly). It supports two modeling languages: <strong class="text-zinc-300">JavaScript</strong> (default, using the manifold-3d API) and <strong class="text-zinc-300">OpenSCAD</strong> (standard .scad syntax via WASM). You write code that constructs 3D geometry, and the result renders live in the viewport.',
    },
    {
      heading: 'Choosing a language',
      body: 'Use the <strong class="text-zinc-300">JS / SCAD</strong> toggle in the toolbar to switch languages. JavaScript is the default and offers fast execution with the full manifold-3d API. OpenSCAD is great if you\'re familiar with .scad syntax or porting existing OpenSCAD code. Switching languages creates a new session. Each session uses one language for all its versions.',
    },
    {
      heading: 'The editor',
      body: 'The left pane is a code editor with syntax highlighting for both JavaScript and OpenSCAD. In JavaScript mode, your code receives an <code class="text-emerald-400 bg-zinc-800 px-1 rounded">api</code> object and must <code class="text-emerald-400 bg-zinc-800 px-1 rounded">return</code> a Manifold object. In OpenSCAD mode, use standard SCAD syntax (no return needed). The right pane shows a live 3D viewport, plus isometric views, elevation comparisons, and a version gallery.',
    },
    {
      heading: 'Building geometry',
      body: '<strong class="text-zinc-300">JavaScript:</strong> Start with primitives like <code class="text-emerald-400 bg-zinc-800 px-1 rounded">Manifold.cube()</code>, <code class="text-emerald-400 bg-zinc-800 px-1 rounded">Manifold.cylinder()</code>, or <code class="text-emerald-400 bg-zinc-800 px-1 rounded">Manifold.sphere()</code>. Combine them with boolean operations: <code class="text-emerald-400 bg-zinc-800 px-1 rounded">.add()</code> (union), <code class="text-emerald-400 bg-zinc-800 px-1 rounded">.subtract()</code>, <code class="text-emerald-400 bg-zinc-800 px-1 rounded">.intersect()</code>.<br><br><strong class="text-zinc-300">OpenSCAD:</strong> Use standard primitives like <code class="text-emerald-400 bg-zinc-800 px-1 rounded">cube()</code>, <code class="text-emerald-400 bg-zinc-800 px-1 rounded">cylinder()</code>, <code class="text-emerald-400 bg-zinc-800 px-1 rounded">sphere()</code> with boolean operations <code class="text-emerald-400 bg-zinc-800 px-1 rounded">difference()</code>, <code class="text-emerald-400 bg-zinc-800 px-1 rounded">union()</code>, <code class="text-emerald-400 bg-zinc-800 px-1 rounded">intersection()</code>. Note: <code class="text-emerald-400 bg-zinc-800 px-1 rounded">text()</code> is not available (fonts not loaded).',
    },
    {
      heading: 'Sessions & versions',
      body: 'Sessions track design iterations. Create a session, save versions as you iterate, and compare them side-by-side in the Gallery tab. Each version captures the code, a thumbnail, and geometry stats (volume, dimensions, manifold validity). This makes it easy to experiment and backtrack.',
    },
    {
      heading: 'Exporting',
      body: 'Export your geometry as 3MF, OBJ, STL, or GLB using the Export dropdown in the toolbar. 3MF is recommended for 3D printing — it carries color regions natively and imports cleanly into Bambu Studio and other slicers. Use GLB for web preview only (slicers do not read it).',
    },
    {
      heading: 'AI agent workflow',
      body: 'Partwright is designed to be driven by AI agents. An agent navigates to the app, writes geometry code, and uses the <code class="text-emerald-400 bg-zinc-800 px-1 rounded">window.partwright</code> console API to create sessions, run code, validate results, and save versions — all programmatically. The legacy <code class="text-emerald-400 bg-zinc-800 px-1 rounded">window.mainifold</code> alias still works during migration. <a href="/ai.md" class="text-blue-400 hover:underline">Full agent instructions \u2192</a>',
    },
    {
      heading: 'Connecting an AI agent',
      body: 'There are three ways to give an AI agent browser access:<br><br>' +
        '<strong class="text-zinc-300">Claude in Chrome extension</strong> — Install the extension and Claude Desktop can control your active tab directly. Best for interactive sessions.<br><br>' +
        '<strong class="text-zinc-300">Chrome DevTools MCP</strong> — Enable remote debugging in Chrome settings, then add the MCP server to Claude. Uses your existing browser session.<br><br>' +
        '<strong class="text-zinc-300">Playwright MCP</strong> — Launches a separate browser, no Chrome setup needed. Best for automated or headless workflows.',
    },
    {
      heading: 'Try it with an AI agent',
      body: (() => {
        const origin = window.location.origin;
        return 'Copy and paste this prompt into Claude Code, ChatGPT, or any AI agent with browser access to verify everything works end-to-end:' +
          '<pre class="bg-zinc-800 rounded-lg p-4 text-xs leading-relaxed overflow-x-auto mt-3 mb-3 whitespace-pre-wrap"><code class="text-zinc-300">' +
          `Read the AI agent instructions at ${origin}/ai.md to understand how to use this tool.\n\n` +
          `Then navigate to ${origin}/editor?view=ai and use the window.partwright console API to:\n\n` +
          '1. Create a session called "Standard Lego Brick"\n' +
          '2. Build a standard 2x4 Lego brick (approximately 31.8mm x 15.8mm x 11.4mm with studs on top and hollow underside with tubes)\n' +
          '3. Save each major step as a version (e.g. v1 - base block, v2 - add studs, v3 - hollow underside with tubes)\n' +
          '4. Use assertions to verify each version is a valid manifold with maxComponents: 1\n' +
          '5. Give me the gallery URL when done so I can review the versions</code></pre>' +
          'The agent should read <code class="text-emerald-400 bg-zinc-800 px-1 rounded">ai.md</code>, create a named session, iterate through versions, and hand back a gallery link for review.';
      })(),
    },
    {
      heading: 'Quick example',
      body: '<pre class="bg-zinc-800 rounded-lg p-4 text-xs leading-relaxed overflow-x-auto mt-2"><code class="text-zinc-300">const { Manifold } = api;\n\n// Create a box and subtract a cylinder\nconst box = Manifold.cube([20, 20, 10], true);\nconst hole = Manifold.cylinder(12, 4, 4, 32);\n\nreturn box.subtract(hole);</code></pre>',
    },
  ];

  for (const section of sections) {
    const h = document.createElement('h2');
    h.className = 'text-sm font-semibold text-zinc-300 uppercase tracking-wide mt-8 mb-3';
    h.textContent = section.heading;
    content.appendChild(h);

    const p = document.createElement('div');
    p.className = 'text-sm text-zinc-400 leading-relaxed';
    p.innerHTML = section.body;
    content.appendChild(p);
  }

  // Tour CTA
  const tourCTA = document.createElement('div');
  tourCTA.className = 'mt-10 p-4 rounded-lg bg-zinc-800 border border-zinc-700 flex items-center justify-between';

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
