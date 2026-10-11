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
import { DISCORD_INVITE_URL } from '../feedbackLinks';

// Discord's mark (simple-icons path), sized to sit beside the CTA. Kept in the
// right-hand cluster rather than the nav links so it stays visible on tablets
// and wide phones, where .pw-navlinks is hidden; below 420px it's hidden too
// (.pw-discord) so the CTA doesn't wrap — the footer still links Discord.
const DISCORD_ICON_SVG =
  '<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M20.317 4.3698a19.7913 19.7913 0 00-4.8851-1.5152.0741.0741 0 00-.0785.0371c-.211.3753-.4447.8648-.6083 1.2495-1.8447-.2762-3.68-.2762-5.4868 0-.1636-.3933-.4058-.8742-.6177-1.2495a.077.077 0 00-.0785-.037 19.7363 19.7363 0 00-4.8852 1.515.0699.0699 0 00-.0321.0277C.5334 9.0458-.319 13.5799.0992 18.0578a.0824.0824 0 00.0312.0561c2.0528 1.5076 4.0413 2.4228 5.9929 3.0294a.0777.0777 0 00.0842-.0276c.4616-.6304.8731-1.2952 1.226-1.9942a.076.076 0 00-.0416-.1057c-.6528-.2476-1.2743-.5495-1.8722-.8923a.077.077 0 01-.0076-.1277c.1258-.0943.2517-.1923.3718-.2914a.0743.0743 0 01.0776-.0105c3.9278 1.7933 8.18 1.7933 12.0614 0a.0739.0739 0 01.0785.0095c.1202.099.246.1981.3728.2924a.077.077 0 01-.0066.1276 12.2986 12.2986 0 01-1.873.8914.0766.0766 0 00-.0407.1067c.3604.698.7719 1.3628 1.225 1.9932a.076.076 0 00.0842.0286c1.961-.6067 3.9495-1.5219 6.0023-3.0294a.077.077 0 00.0313-.0552c.5004-5.177-.8382-9.6739-3.5485-13.6604a.061.061 0 00-.0312-.0286zM8.02 15.3312c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9555-2.4189 2.157-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.9555 2.4189-2.1569 2.4189zm7.9748 0c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9554-2.4189 2.1569-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.946 2.4189-2.1568 2.4189Z"/></svg>';

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
  return `<style>@media(max-width:767px){.pw-navlinks{display:none!important}}@media(max-width:419px){.pw-discord{display:none!important}}</style>
<div class="pw-headerbar" style="position:sticky;top:0;z-index:30;width:100%;background:rgba(24,24,27,0.72);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);border-bottom:1px solid rgba(39,39,42,0.6)">
  <header class="pw-header" style="width:100%;max-width:72rem;margin:0 auto;padding:16px 24px;display:flex;align-items:center;justify-content:space-between;box-sizing:border-box;font-family:'Space Grotesk',system-ui,-apple-system,sans-serif">
    <a href="/" aria-label="Partwright home" style="display:flex;align-items:center;gap:10px;text-decoration:none">
      ${partwrightMarkSvg(30)}
      <span style="font-weight:700;font-size:18px;letter-spacing:-0.025em;color:#fafafa;font-family:'Sora',system-ui,sans-serif">Partwright</span>
      <span style="font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;padding:2px 6px;border-radius:999px;background:rgba(245,158,11,0.15);color:#fbbf24;border:1px solid rgba(245,158,11,0.25)">Beta</span>
    </a>
    <nav class="pw-navlinks" style="display:flex;align-items:center;gap:28px;font-size:14px">${linksHtml}</nav>
    <div style="display:flex;align-items:center;gap:12px">
      <a class="pw-discord" href="${DISCORD_INVITE_URL}" target="_blank" rel="noopener noreferrer" aria-label="Join the Partwright Discord" title="Join our Discord" style="display:flex;align-items:center;justify-content:center;width:36px;height:36px;border-radius:8px;color:#a1a1aa;text-decoration:none">${DISCORD_ICON_SVG}</a>
      <a href="/editor" style="padding:8px 16px;border-radius:8px;font-size:14px;font-weight:600;color:#1c1917;text-decoration:none;background:linear-gradient(135deg,#fcd34d,#f59e0b)">Open editor &#8594;</a>
    </div>
  </header>
</div>`;
}
