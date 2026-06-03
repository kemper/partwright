// THE shared top navigation for every non-editor surface — the landing page,
// the static content pages (/catalog, /help, /legal, /whats-new), and the
// in-app /ideas page. Keeping one builder guarantees the header is identical
// everywhere outside the editor.
//
// Pure (no DOM, no app runtime, no node) so it can be used at build time by the
// static-page pre-renderer AND at runtime by the app (ideas page, via
// innerHTML). The markup mirrors the landing header in index.html — same
// voxel-P mark, "Partwright" wordmark, Beta pill, links, and "Open editor" CTA,
// using inline styles so it renders consistently with or without the app CSS.

import { partwrightMarkSvg } from '../ui/brand';

interface HeaderLink {
  href: string;
  label: string;
  /** Clean path this link targets, used to highlight the current page. */
  path?: string;
}

/** Shared header for all non-editor pages. `currentPath` highlights the active
 *  link (and points "For AI agents" at the landing's agent section). */
export function contentHeaderHtml(currentPath: string): string {
  const agentHref = currentPath === '/' ? '#li-agent-section' : '/#li-agent-section';
  const links: HeaderLink[] = [
    { href: '/ideas', label: 'Ideas', path: '/ideas' },
    { href: '/catalog', label: 'Catalog', path: '/catalog' },
    { href: '/help', label: 'How it works', path: '/help' },
    { href: agentHref, label: 'For AI agents' },
    { href: '/whats-new', label: "What’s new", path: '/whats-new' },
  ];
  const linksHtml = links
    .map((l) => {
      const current = !!l.path && l.path === currentPath;
      const color = current ? '#fafafa' : '#a1a1aa';
      return `<a href="${l.href}" style="color:${color};text-decoration:none"${current ? ' aria-current="page"' : ''}>${l.label}</a>`;
    })
    .join('');
  // Wrapped in a full-width sticky bar so the nav stays visible on scroll —
  // including when an in-page anchor like "For AI agents" jumps deep into a
  // page. The bar is a subtle frosted layer over whatever scrolls beneath it.
  return `<style>@media(max-width:767px){.pw-navlinks{display:none!important}}</style>
<div class="pw-headerbar" style="position:sticky;top:0;z-index:30;width:100%;background:rgba(24,24,27,0.72);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);border-bottom:1px solid rgba(39,39,42,0.6)">
  <header class="pw-header" style="width:100%;max-width:72rem;margin:0 auto;padding:16px 24px;display:flex;align-items:center;justify-content:space-between;box-sizing:border-box">
    <a href="/" aria-label="Partwright home" style="display:flex;align-items:center;gap:10px;text-decoration:none">
      ${partwrightMarkSvg(30)}
      <span style="font-weight:700;font-size:18px;letter-spacing:-0.025em;color:#fafafa;font-family:'Sora',system-ui,sans-serif">Partwright</span>
      <span style="font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;padding:2px 6px;border-radius:999px;background:rgba(245,158,11,0.15);color:#fbbf24;border:1px solid rgba(245,158,11,0.25)">Beta</span>
    </a>
    <nav class="pw-navlinks" style="display:flex;align-items:center;gap:28px;font-size:14px">${linksHtml}</nav>
    <div style="display:flex;align-items:center;gap:12px">
      <a href="/editor" style="padding:8px 16px;border-radius:8px;font-size:14px;font-weight:600;color:#1c1917;text-decoration:none;background:linear-gradient(135deg,#fcd34d,#f59e0b)">Open editor &#8594;</a>
    </div>
  </header>
</div>`;
}
