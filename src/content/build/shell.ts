// Shared chrome (nav + footer) for the statically pre-rendered content pages
// (/catalog, /help, /legal, /whats-new, /ideas). Pure HTML-string builders, run at
// build time in Node. Tailwind classes here are picked up by Tailwind's
// source scan (this is a .ts file under src/), so the utilities ship in the
// app CSS that every content page links.
//
// These pages deliberately load NO app JavaScript — just the Tailwind CSS —
// so they paint instantly for users and crawlers without booting the editor.

// The top navigation is the shared header used by every non-editor surface
// (landing, content pages, ideas) — see src/content/chrome.ts.
import { contentHeaderHtml } from '../chrome';

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

/** Wrap a page's inner content with the shared header + footer. The main column
 *  matches the header's 72rem max width so the two align (like the landing). */
export function pageShell(currentPath: string, innerHtml: string): string {
  return `${contentHeaderHtml(currentPath)}
<main class="mx-auto max-w-6xl px-6 pt-4 pb-12 w-full">${innerHtml}</main>
${footerHtml()}`;
}
