// "What's new" page — a succinct, human-readable changelog of recently shipped
// features, grouped by week (most recent first). This is curated by hand (not
// generated from git) so it reads as release notes rather than a commit dump.
// When you ship a notable user-facing feature, add a bullet to the most recent
// week's entry here (and to public/llms.txt / the help page if it warrants it).

import { partwrightMarkSvg } from './brand';
import { appPath, assetPath } from '../deployment';
import { getTheme, onThemeChange, toggleTheme } from './theme';
import { WHATS_NEW_INTRO, WHATS_NEW_WEEKS, type WeekEntry } from '../content/data/whatsNew';

export interface WhatsNewCallbacks {
  onBack: () => void;
  onOpenEditor: () => void;
}

const WEEKS: WeekEntry[] = WHATS_NEW_WEEKS;

export function createWhatsNewPage(
  container: HTMLElement,
  callbacks: WhatsNewCallbacks,
): HTMLElement {
  const page = document.createElement('div');
  page.id = 'whats-new-page';
  page.className = 'flex flex-col items-center w-full h-full overflow-auto bg-zinc-900 text-zinc-100 relative';

  // Top-right theme toggle (mirrors landing / catalog pages).
  const themeBtn = document.createElement('button');
  themeBtn.textContent = 'Dark Mode';
  const themeActive = 'absolute top-4 right-4 px-3 py-1 rounded text-xs font-medium transition-colors bg-zinc-700 text-zinc-100';
  const themeInactive = 'absolute top-4 right-4 px-3 py-1 rounded text-xs font-medium transition-colors text-zinc-500 hover:text-zinc-300 border border-zinc-600';
  const syncThemeBtn = (theme: 'light' | 'dark') => {
    const on = theme === 'dark';
    themeBtn.className = on ? themeActive : themeInactive;
    themeBtn.title = on ? 'Dark mode on — click to switch to light' : 'Dark mode off — click to switch to dark';
    themeBtn.setAttribute('aria-pressed', String(on));
  };
  syncThemeBtn(getTheme());
  themeBtn.addEventListener('click', () => { toggleTheme(); });
  onThemeChange(syncThemeBtn);
  page.appendChild(themeBtn);

  const content = document.createElement('div');
  content.className = 'max-w-3xl w-full px-6 py-12';

  // Back button
  const back = document.createElement('button');
  back.className = 'text-xs text-zinc-500 hover:text-zinc-300 mb-8 transition-colors';
  back.textContent = '← Back';
  back.addEventListener('click', callbacks.onBack);
  content.appendChild(back);

  // Title
  const titleWrap = document.createElement('div');
  titleWrap.className = 'flex items-center gap-3 mb-3';
  titleWrap.innerHTML = `${partwrightMarkSvg(32)}<h1 class="text-2xl font-bold tracking-tight">What’s new</h1>`;
  content.appendChild(titleWrap);

  const subtitle = document.createElement('p');
  subtitle.className = 'text-sm text-zinc-400 leading-relaxed mb-10';
  subtitle.textContent = WHATS_NEW_INTRO;
  content.appendChild(subtitle);

  // Timeline of weeks
  const timeline = document.createElement('div');
  timeline.className = 'relative border-l border-zinc-800 pl-6 space-y-12';

  for (const week of WEEKS) {
    timeline.appendChild(buildWeek(week));
  }
  content.appendChild(timeline);

  // CTA footer
  const cta = document.createElement('div');
  cta.className = 'mt-14 p-4 rounded-lg bg-zinc-800 border border-zinc-700 flex items-center justify-between gap-4';
  const ctaText = document.createElement('span');
  ctaText.className = 'text-sm text-zinc-300';
  ctaText.textContent = 'Want to try the latest? Jump into the editor.';
  cta.appendChild(ctaText);
  const ctaBtn = document.createElement('button');
  ctaBtn.className = 'px-4 py-1.5 rounded text-xs bg-blue-600 hover:bg-blue-500 text-white transition-colors shrink-0';
  ctaBtn.textContent = 'Open editor';
  ctaBtn.addEventListener('click', callbacks.onOpenEditor);
  cta.appendChild(ctaBtn);
  content.appendChild(cta);

  const footer = document.createElement('div');
  footer.className = 'mt-10 pt-6 border-t border-zinc-800 text-xs text-zinc-600';
  footer.innerHTML =
    `More detail in the <a href="${appPath('/help')}" class="text-zinc-500 hover:text-zinc-300 transition-colors">help guide</a> and the <a href="${assetPath('/ai.md')}" class="text-zinc-500 hover:text-zinc-300 transition-colors">AI agent docs</a>.`;
  content.appendChild(footer);

  page.appendChild(content);
  container.appendChild(page);
  return page;
}

function buildWeek(week: WeekEntry): HTMLElement {
  const section = document.createElement('section');
  section.className = 'relative';

  // Timeline dot
  const dot = document.createElement('span');
  dot.className = 'absolute -left-[31px] top-1.5 w-3 h-3 rounded-full bg-blue-500 ring-4 ring-zinc-900';
  section.appendChild(dot);

  const range = document.createElement('div');
  range.className = 'text-xs font-mono text-blue-400 mb-1';
  range.textContent = week.range;
  section.appendChild(range);

  const headline = document.createElement('h2');
  headline.className = 'text-lg font-semibold text-zinc-100 mb-5';
  headline.textContent = week.headline;
  section.appendChild(headline);

  for (const group of week.groups) {
    if (group.label) {
      const label = document.createElement('h3');
      label.className = 'text-[11px] font-semibold text-zinc-500 uppercase tracking-widest mt-5 mb-2';
      label.textContent = group.label;
      section.appendChild(label);
    }
    const list = document.createElement('ul');
    list.className = 'space-y-2.5';
    for (const item of group.items) {
      const li = document.createElement('li');
      li.className = 'text-sm leading-relaxed';
      const title = document.createElement('span');
      title.className = 'font-medium text-zinc-200';
      title.textContent = `${item.title} — `;
      const body = document.createElement('span');
      body.className = 'text-zinc-400';
      body.textContent = item.body;
      li.appendChild(title);
      li.appendChild(body);
      list.appendChild(li);
    }
    section.appendChild(list);
  }

  return section;
}
