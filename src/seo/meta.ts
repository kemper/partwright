// Per-route SEO metadata. Updates <title>, meta description, canonical, and
// Open Graph / Twitter card tags as the SPA navigates so search engines and
// social-card unfurlers see the right content for each route.
//
// The build-time `absoluteUrls` Vite plugin in vite.config.ts only rewrites
// the static tags in index.html. Anything we set here at runtime stays on
// the path it's given (which is fine — the browser resolves relative URLs
// against the current origin, and unfurl bots fetch each route fresh).

export type RouteName = 'landing' | 'editor' | 'help' | 'catalog' | '404';

interface RouteMeta {
  title: string;
  description: string;
  path: string;
  ogImage?: string;
}

const BASE_TITLE = 'Partwright';

const ROUTE_META: Record<RouteName, RouteMeta> = {
  landing: {
    title: `${BASE_TITLE} — AI-Driven Parametric CAD in Your Browser`,
    description:
      'Describe a part, get a printable 3D model. Partwright is a browser-based parametric CAD tool with a programmatic API designed for AI agents — no signup, no installs, powered by manifold-3d.',
    path: '/',
    ogImage: '/og-image.png',
  },
  editor: {
    title: `Editor — ${BASE_TITLE}`,
    description:
      'Write JavaScript or OpenSCAD that constructs 3D geometry with boolean operations, and see it render live. Save versions, paint colored regions, and export GLB / STL / OBJ / 3MF.',
    path: '/editor',
    ogImage: '/og-image.png',
  },
  help: {
    title: `How it works — ${BASE_TITLE}`,
    description:
      'Learn how to drive Partwright by hand or with an AI agent: code editor, manifold-3d API, OpenSCAD, sessions, versioning, color regions, exports, and the window.partwright console API.',
    path: '/help',
    ogImage: '/og-image.png',
  },
  catalog: {
    title: `Catalog — ${BASE_TITLE}`,
    description:
      'Browse a curated catalog of example Partwright sessions: vases, gears, chess pieces, holiday ornaments and more. One click loads any example into the editor for inspection or remixing.',
    path: '/catalog',
    ogImage: '/og-image.png',
  },
  '404': {
    title: `Not Found — ${BASE_TITLE}`,
    description: 'This page does not exist. Return to the Partwright home page or open the editor.',
    path: '/',
    ogImage: '/og-image.png',
  },
};

/** Resolve a relative path against the current origin (or `<base>` if set). */
function absolutize(path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  return new URL(path, window.location.origin).toString();
}

function setMeta(selector: string, value: string) {
  const el = document.head.querySelector(selector);
  if (el instanceof HTMLMetaElement) el.content = value;
}

function setLink(rel: string, href: string) {
  const el = document.head.querySelector(`link[rel="${rel}"]`);
  if (el instanceof HTMLLinkElement) el.href = href;
}

/** Apply meta tags for the given route, optionally overriding the title. */
export function applyRouteMeta(route: RouteName, overrides?: { title?: string }) {
  const meta = ROUTE_META[route];
  const title = overrides?.title ?? meta.title;
  const url = absolutize(meta.path);
  const ogImage = absolutize(meta.ogImage ?? '/og-image.png');

  document.title = title;
  setMeta('meta[name="description"]', meta.description);
  setLink('canonical', url);

  setMeta('meta[property="og:title"]', title);
  setMeta('meta[property="og:description"]', meta.description);
  setMeta('meta[property="og:url"]', url);
  setMeta('meta[property="og:image"]', ogImage);

  setMeta('meta[name="twitter:title"]', title);
  setMeta('meta[name="twitter:description"]', meta.description);
  setMeta('meta[name="twitter:image"]', ogImage);
}

/** Title text for a route — used by the document-title guard in main.ts. */
export function routeTitle(route: RouteName): string {
  return ROUTE_META[route].title;
}
