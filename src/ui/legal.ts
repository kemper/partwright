// Legal page — privacy, terms/no-warranty, and a code-execution disclaimer.

export interface LegalCallbacks {
  onBack: () => void;
}

interface LegalSection {
  id: string;
  heading: string;
  body: string;
}

export function createLegalPage(
  container: HTMLElement,
  callbacks: LegalCallbacks,
): HTMLElement {
  const page = document.createElement('div');
  page.id = 'legal-page';
  page.className = 'flex flex-col items-center w-full h-full overflow-auto bg-zinc-900 text-zinc-100';

  const content = document.createElement('div');
  content.className = 'max-w-3xl w-full px-6 py-12';

  const backBtn = document.createElement('button');
  backBtn.className = 'text-xs text-zinc-500 hover:text-zinc-300 mb-8 transition-colors';
  backBtn.textContent = '← Back';
  backBtn.addEventListener('click', callbacks.onBack);
  content.appendChild(backBtn);

  const title = document.createElement('h1');
  title.className = 'text-2xl font-bold mb-3';
  title.textContent = 'Legal';
  content.appendChild(title);

  const subtitle = document.createElement('p');
  subtitle.className = 'text-sm text-zinc-400 leading-relaxed mb-8';
  subtitle.innerHTML = 'Privacy, terms of use, and a note on running code in your browser. Partwright is a passion project shared openly — please read the disclaimers below before relying on it for anything important.';
  content.appendChild(subtitle);

  const sections: LegalSection[] = [
    {
      id: 'privacy',
      heading: 'Privacy',
      body:
        'Partwright has <strong class="text-zinc-300">no backend and no server</strong>. There is no account, no analytics, and no telemetry. Nothing you create is uploaded to us.<br><br>' +
        'All of your work — sessions, saved versions, notes, annotations, painted color regions, and attached images — is stored <strong class="text-zinc-300">locally in your own browser</strong> via <code class="text-emerald-400 bg-zinc-800 px-1 rounded">localStorage</code> and <code class="text-emerald-400 bg-zinc-800 px-1 rounded">IndexedDB</code>. Clearing your browser data, or using "Uninstall / start fresh" in Settings → Advanced, removes it permanently.<br><br>' +
        '<strong class="text-zinc-300">AI keys and requests.</strong> If you connect a hosted AI provider (Anthropic, OpenAI, or Google Gemini), your API key is stored only in this browser\'s IndexedDB, and every request goes <strong class="text-zinc-300">directly from your browser to that provider</strong> — Partwright never sees your key or your conversation. Local (WebGPU) models run entirely on your machine and make no network requests at all. Read the provider\'s own privacy policy to understand how they handle the data you send.',
    },
    {
      id: 'terms',
      heading: 'Terms of use & no warranty',
      body:
        'Partwright is provided <strong class="text-zinc-300">"as is", without warranty of any kind</strong>, express or implied. The geometry it produces may be wrong, non-manifold, not watertight, or otherwise unsuitable for manufacturing or any other purpose. <strong class="text-zinc-300">Always inspect and validate any model before printing, machining, ordering, or otherwise relying on it.</strong> You use Partwright and its output entirely at your own risk.<br><br>' +
        '<strong class="text-zinc-300">AI costs are yours.</strong> When you connect your own AI provider, requests are billed to <em>your</em> account using <em>your</em> API key. AI-driven CAD is unpredictable and a model may iterate many times before producing something usable (or never get there). There are guardrails to help limit runaway spend, but no guarantee they work perfectly. By connecting an AI agent you accept responsibility for any API costs incurred, regardless of output quality.<br><br>' +
        '<strong class="text-zinc-300">License.</strong> Partwright is <strong class="text-zinc-300">source-available and free for non-commercial use</strong> under the <a href="https://polyformproject.org/licenses/noncommercial/1.0.0" target="_blank" rel="noopener" class="text-blue-400 hover:underline">PolyForm Noncommercial License 1.0.0</a>. Commercial use is not permitted under this license; commercial rights are reserved by the copyright holder. The full license text ships with the source as <code class="text-emerald-400 bg-zinc-800 px-1 rounded">LICENSE</code>.',
    },
    {
      id: 'code-execution',
      heading: 'Code execution — only run code you trust',
      body:
        'Partwright runs JavaScript and OpenSCAD <strong class="text-zinc-300">in your browser</strong> to build geometry. That code — whether you typed it, an AI agent wrote it, or it came in with an imported session — is evaluated with <code class="text-emerald-400 bg-zinc-800 px-1 rounded">new Function</code> in the page, <strong class="text-zinc-300">not inside a hardened security sandbox</strong>. It runs with the same capabilities as the rest of the page.<br><br>' +
        '<strong class="text-zinc-300">Importing a <code class="text-emerald-400 bg-zinc-800 px-1 rounded">.partwright.json</code> session executes the code it contains</strong> (each version\'s code is run to regenerate its thumbnail). Treat an imported session like any other code you would run on your machine.<br><br>' +
        '<strong class="text-zinc-300">Only run or import code from sources you trust.</strong> Partwright enforces a strict Content Security Policy and makes no outbound network requests of its own, which limits the blast radius, but it is not a substitute for caution with untrusted code.',
    },
  ];

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

  const footer = document.createElement('div');
  footer.className = 'mt-12 pt-6 border-t border-zinc-800 text-xs text-zinc-600';
  footer.innerHTML = 'More about how the app works: <a href="/help" class="text-zinc-500 hover:text-zinc-300 transition-colors">/help</a>';
  content.appendChild(footer);

  page.appendChild(content);
  container.appendChild(page);
  return page;
}
