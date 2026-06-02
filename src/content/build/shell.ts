// Shared chrome (nav + footer) for the statically pre-rendered content pages
// (/catalog, /help, /legal, /whats-new). Pure HTML-string builders, run at
// build time in Node. Tailwind classes here are picked up by Tailwind's
// source scan (this is a .ts file under src/), so the utilities ship in the
// app CSS that every content page links.
//
// These pages deliberately load NO app JavaScript — just the Tailwind CSS —
// so they paint instantly for users and crawlers without booting the editor.

import { partwrightMarkSvg } from '../../ui/brand';

interface NavLink {
  href: string;
  label: string;
  /** Marks the link for the current page (rendered inert + highlighted). */
  current?: boolean;
}

/** Top navigation bar, shared across all content pages. `currentPath` lets the
 *  active page render its own link as a non-link highlight. */
export function navHtml(currentPath: string): string {
  const links: NavLink[] = [
    { href: '/catalog', label: 'Catalog', current: currentPath === '/catalog' },
    { href: '/ideas', label: 'Ideas' },
    { href: '/help', label: 'How it works', current: currentPath === '/help' },
    { href: '/whats-new', label: "What's new", current: currentPath === '/whats-new' },
  ];
  const linksHtml = links
    .map((l) =>
      l.current
        ? `<span class="text-sm text-zinc-200 font-medium" aria-current="page">${l.label}</span>`
        : `<a href="${l.href}" class="text-sm text-zinc-400 hover:text-zinc-100 transition-colors">${l.label}</a>`,
    )
    .join('');
  return `<header class="w-full border-b border-zinc-800 bg-zinc-900/80 sticky top-0 z-10 backdrop-blur">
  <nav class="mx-auto max-w-5xl px-6 py-4 flex items-center justify-between gap-4">
    <a href="/" class="flex items-center gap-2.5 shrink-0" aria-label="Partwright home">
      ${partwrightMarkSvg(30)}
      <span class="text-base font-semibold tracking-tight text-zinc-100">Partwright</span>
    </a>
    <div class="hidden md:flex items-center gap-6">${linksHtml}</div>
    <a href="/editor" class="shrink-0 px-4 py-2 rounded-lg text-sm font-semibold text-zinc-900" style="background:linear-gradient(135deg,#fcd34d,#f59e0b)">Open editor &#8594;</a>
  </nav>
</header>`;
}

/** Shared footer with cross-links + a non-commercial note. */
export function footerHtml(): string {
  const cols: { title: string; links: { href: string; label: string }[] }[] = [
    {
      title: 'Explore',
      links: [
        { href: '/editor', label: 'Editor' },
        { href: '/catalog', label: 'Catalog' },
        { href: '/ideas', label: 'Ideas' },
      ],
    },
    {
      title: 'Learn',
      links: [
        { href: '/help', label: 'How it works' },
        { href: '/whats-new', label: "What's new" },
        { href: '/ai.md', label: 'AI agent docs' },
      ],
    },
    {
      title: 'About',
      links: [
        { href: '/legal', label: 'Legal & privacy' },
      ],
    },
  ];
  const colsHtml = cols
    .map(
      (c) => `<div class="flex flex-col gap-2">
      <div class="text-xs uppercase tracking-wider text-zinc-500 font-semibold">${c.title}</div>
      ${c.links.map((l) => `<a href="${l.href}" class="text-sm text-zinc-400 hover:text-zinc-200 transition-colors">${l.label}</a>`).join('')}
    </div>`,
    )
    .join('');
  return `<footer class="w-full border-t border-zinc-800 mt-16">
  <div class="mx-auto max-w-5xl px-6 py-10 grid grid-cols-2 sm:grid-cols-3 gap-8">${colsHtml}</div>
  <div class="mx-auto max-w-5xl px-6 pb-10 text-xs text-zinc-600">
    Partwright — AI-driven parametric CAD in your browser. Source-available, free for non-commercial use.
  </div>
</footer>`;
}

/** Wrap a page's inner content with the shared nav + footer. */
export function pageShell(currentPath: string, innerHtml: string): string {
  return `${navHtml(currentPath)}
<main class="mx-auto max-w-5xl px-6 py-12 w-full">${innerHtml}</main>
${footerHtml()}`;
}
