// Help page — explains what Partwright is and how to use it

import { getShortcutDocs, IS_MAC, MOD_LABEL, SHIFT_LABEL, ALT_LABEL } from './shortcutDefs';
import { HELP_INTRO, HELP_STATIC_SECTIONS, helpDynamicSections } from '../content/data/help';
import { appPath, assetPath, BASE } from '../deployment';
import { rebaseHtmlPaths } from '../content/rebasePaths';

export interface HelpCallbacks {
  onBack: () => void;
  onStartTour: () => void;
}

/** Build the OS-resolved dynamic-section args for {@link helpDynamicSections},
 *  shared single source of the help copy. */
function helpDynamicArgs() {
  const kbd = (k: string) => `<strong class="text-zinc-300">${k}</strong>`;
  return {
    origin: window.location.origin,
    paletteKeys: IS_MAC ? `${MOD_LABEL} K` : `${MOD_LABEL} + K`,
    modEnterKeys: IS_MAC ? `${MOD_LABEL} Enter` : `${MOD_LABEL} + Enter`,
    formatKeys: IS_MAC ? `${SHIFT_LABEL} ${ALT_LABEL} F` : `${SHIFT_LABEL} + ${ALT_LABEL} + F`,
    ownedShortcutsHtml: getShortcutDocs().map((s) => `<li>${kbd(s.keys)} — ${s.description}</li>`).join(''),
  };
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
  subtitle.className = 'text-sm text-zinc-400 leading-relaxed mb-4';
  subtitle.innerHTML = HELP_INTRO;
  content.appendChild(subtitle);

  // "What's new" callout — points at the recently-shipped-features changelog.
  const whatsNewCallout = document.createElement('a');
  whatsNewCallout.href = appPath('/whats-new');
  whatsNewCallout.className = 'inline-flex items-center gap-2 mb-8 text-sm text-blue-400 hover:text-blue-300 transition-colors';
  whatsNewCallout.innerHTML = '<span class="text-[10px] font-semibold uppercase tracking-wider rounded bg-blue-500/15 text-blue-300 px-1.5 py-0.5">New</span> See what’s shipped recently →';
  content.appendChild(whatsNewCallout);

  const sections = [...HELP_STATIC_SECTIONS, ...helpDynamicSections(helpDynamicArgs())];

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
    // Section bodies are shared content data with embedded nav links
    // (e.g. /ideas, /ai.md); rebase them under the deployment mount. No-op at /.
    p.innerHTML = rebaseHtmlPaths(section.body, BASE);
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
  footer.innerHTML = `Full AI agent documentation: <a href="${assetPath('/ai.md')}" class="text-zinc-500 hover:text-zinc-300 transition-colors">/ai.md</a>`;
  content.appendChild(footer);

  page.appendChild(content);
  container.appendChild(page);
  return page;
}
