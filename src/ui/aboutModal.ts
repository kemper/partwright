// About dialog — shows which build this page is running so a Cloudflare branch
// or PR preview deploy can be traced back to an exact commit. Opened from the
// toolbar ⓘ button.

import { createModalShell } from './modalShell';
import { partwrightMarkSvg } from './brand';
import {
  buildInfo,
  shortCommit,
  commitUrl,
  branchUrl,
  pullRequestsUrl,
} from '../buildInfo';

function detectEnvironment(): { label: string; cls: string } {
  const host = window.location.hostname;
  if (host === 'www.partwrightstudio.com' || host === 'partwrightstudio.com') {
    return { label: 'Production', cls: 'text-emerald-400' };
  }
  if (host.endsWith('.pages.dev')) return { label: 'Preview (Cloudflare)', cls: 'text-amber-400' };
  if (host === 'localhost' || host === '127.0.0.1') return { label: 'Local dev', cls: 'text-zinc-300' };
  return { label: host, cls: 'text-zinc-300' };
}

function formatBuildTime(iso: string): { text: string; title: string } {
  if (!iso || iso === 'unknown') return { text: 'unknown', title: '' };
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return { text: iso, title: iso };
  return { text: d.toLocaleString(), title: iso };
}

function buildInfoText(): string {
  return [
    'Partwright build',
    `branch:  ${buildInfo.branch}`,
    `commit:  ${buildInfo.commit}${buildInfo.dirty ? ' (uncommitted changes)' : ''}`,
    `built:   ${buildInfo.buildTime}`,
    `repo:    ${buildInfo.repo}`,
    `url:     ${window.location.href}`,
  ].join('\n');
}

function externalLink(text: string, href: string): HTMLAnchorElement {
  const a = document.createElement('a');
  a.href = href;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  a.className = 'text-blue-400 hover:text-blue-300 transition-colors break-all';
  a.textContent = text;
  return a;
}

function plainValue(text: string): HTMLElement {
  const s = document.createElement('span');
  s.className = 'text-zinc-200 break-all';
  s.textContent = text;
  return s;
}

function addRow(parent: HTMLElement, label: string, value: HTMLElement): void {
  const row = document.createElement('div');
  row.className = 'flex items-baseline justify-between gap-4 py-1.5';
  const l = document.createElement('span');
  l.className = 'text-xs text-zinc-500 shrink-0';
  l.textContent = label;
  value.classList.add('text-right', 'text-sm', 'min-w-0');
  row.appendChild(l);
  row.appendChild(value);
  parent.appendChild(row);
}

export function showAboutModal(): void {
  const shell = createModalShell({ title: 'About Partwright' });

  // Brand header
  const brand = document.createElement('div');
  brand.className = 'flex items-center gap-3';
  const mark = document.createElement('div');
  mark.innerHTML = partwrightMarkSvg(28);
  brand.appendChild(mark);
  const nameCol = document.createElement('div');
  nameCol.className = 'flex flex-col';
  const name = document.createElement('span');
  name.className = 'text-sm font-semibold text-zinc-100';
  name.textContent = 'Partwright';
  const tagline = document.createElement('span');
  tagline.className = 'text-xs text-zinc-500';
  tagline.textContent = 'AI-driven parametric CAD';
  nameCol.append(name, tagline);
  brand.appendChild(nameCol);
  shell.body.appendChild(brand);

  const intro = document.createElement('p');
  intro.className = 'text-xs text-zinc-400 leading-relaxed';
  intro.textContent =
    'Which build this page is running. Use it to confirm a Cloudflare branch or PR preview is serving the commit you expect.';
  shell.body.appendChild(intro);

  // Detail card
  const card = document.createElement('div');
  card.className = 'rounded-lg border border-zinc-700 bg-zinc-900/40 px-3 divide-y divide-zinc-800';

  const env = detectEnvironment();
  const envEl = document.createElement('span');
  envEl.className = `font-medium ${env.cls}`;
  envEl.textContent = env.label;
  addRow(card, 'Environment', envEl);

  const bUrl = branchUrl(buildInfo);
  const branchEl = bUrl ? externalLink(buildInfo.branch, bUrl) : plainValue(buildInfo.branch);
  branchEl.classList.add('font-mono');
  addRow(card, 'Branch', branchEl);

  const commitWrap = document.createElement('span');
  commitWrap.className = 'inline-flex items-center gap-2 justify-end flex-wrap';
  const cUrl = commitUrl(buildInfo);
  const sha = shortCommit(buildInfo.commit);
  const shaEl = cUrl ? externalLink(sha, cUrl) : plainValue(sha);
  shaEl.id = 'about-commit';
  shaEl.classList.add('font-mono');
  commitWrap.appendChild(shaEl);
  if (buildInfo.dirty) {
    const badge = document.createElement('span');
    badge.className =
      'text-[9px] uppercase tracking-wide text-amber-400 border border-amber-400/30 rounded px-1 py-px';
    badge.textContent = 'uncommitted';
    commitWrap.appendChild(badge);
  }
  addRow(card, 'Commit', commitWrap);

  const bt = formatBuildTime(buildInfo.buildTime);
  const builtEl = plainValue(bt.text);
  if (bt.title) builtEl.title = bt.title;
  addRow(card, 'Built', builtEl);

  shell.body.appendChild(card);

  // Extra action link — branch deploys have no PR number, so offer a search
  // that lists PRs opened from this branch.
  const prUrl = pullRequestsUrl(buildInfo);
  if (prUrl) {
    const links = document.createElement('div');
    links.className = 'flex flex-wrap gap-x-4 gap-y-1 text-sm';
    links.appendChild(externalLink('Find the pull request ↗', prUrl));
    shell.body.appendChild(links);
  }

  // Footer
  const copyBtn = document.createElement('button');
  copyBtn.className = 'px-3 py-1.5 rounded text-xs font-medium bg-zinc-700 hover:bg-zinc-600 text-zinc-100';
  copyBtn.textContent = 'Copy build info';
  copyBtn.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(buildInfoText());
      copyBtn.textContent = 'Copied!';
    } catch {
      copyBtn.textContent = 'Copy failed';
    }
    setTimeout(() => { copyBtn.textContent = 'Copy build info'; }, 1600);
  });
  shell.footer.appendChild(copyBtn);

  const doneBtn = document.createElement('button');
  doneBtn.className = 'px-3 py-1.5 rounded text-xs font-medium bg-blue-600 hover:bg-blue-500 text-white';
  doneBtn.textContent = 'Done';
  doneBtn.addEventListener('click', () => shell.close());
  shell.footer.appendChild(doneBtn);
}
