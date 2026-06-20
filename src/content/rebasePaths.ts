// Pure helper to rebase root-relative paths inside an HTML string under a
// deployment base (`/`, `/v2/`, …). Used where paths are embedded in HTML that
// Vite's `base` handling does NOT rewrite — content-page nav hrefs (generated
// AND embedded in shared content data), static-shell links, and the in-app
// content pages' data-driven innerHTML.
//
// Kept dependency-free (NO `import.meta`) so it's safe to import in BOTH the
// Node build context (the prerender Vite plugin) and the browser runtime —
// unlike the `BASE`-reading wrappers in src/deployment.ts. The caller passes the
// base explicitly: `config.base` at build time, `BASE` at runtime.

/** Rewrite root-relative **anchor** hrefs (`<a … href="/x">`) in an HTML string
 *  to sit under `base`. Deliberately scoped to `<a>` only: Vite already prefixes
 *  every asset/script/css/`<link>`/`<img>` URL (and the canonical link) with the
 *  base at build time, so rewriting those here too would double-base them — but
 *  Vite leaves `<a>` navigation hrefs alone, which is exactly the gap this fills
 *  (in both the prerendered content shells and the in-app pages' data-driven
 *  innerHTML). Leaves protocol-relative (`//`), absolute (`http…`), and anchor
 *  (`#`) hrefs untouched. A strict no-op at base `/`. Handles both quote styles.
 *    rebaseHtmlPaths('<a href="/editor">', '/v2/') → '<a href="/v2/editor">'
 *    rebaseHtmlPaths('<a class="x" href="/">', '/v2/') → '<a class="x" href="/v2/">' */
export function rebaseHtmlPaths(html: string, base: string): string {
  const prefix = basePrefix(base);
  if (prefix === '') return html; // base '/' (or empty) — nothing to do
  return html.replace(
    /(<a\b[^>]*?\shref=)(["'])\/(?!\/)/gi,
    (_m, pre: string, quote: string) => `${pre}${quote}${prefix}/`,
  );
}

/** The base with a single trailing slash stripped: '/' → '', '/v2/' → '/v2',
 *  '/v2' → '/v2', '' → ''. The prefix to splice in front of a root-relative
 *  path (which keeps its own leading slash). Empty ⇒ no rebasing needed. */
export function basePrefix(base: string | undefined | null): string {
  let b = (base ?? '/').trim();
  if (b === '' || b === '/') return '';
  if (!b.startsWith('/')) b = '/' + b;
  return b.endsWith('/') ? b.slice(0, -1) : b;
}
