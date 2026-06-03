// Legal page — privacy, terms/no-warranty, and a code-execution disclaimer.
// Content lives in src/content/data/legal.ts (shared with the static
// pre-rendered /legal page); this module is the in-app DOM renderer.

import { LEGAL_INTRO, LEGAL_SECTIONS } from '../content/data/legal';

export interface LegalCallbacks {
  onBack: () => void;
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
  subtitle.innerHTML = LEGAL_INTRO;
  content.appendChild(subtitle);

  for (const section of LEGAL_SECTIONS) {
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
