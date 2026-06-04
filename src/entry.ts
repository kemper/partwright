// The single statically-loaded module. It does the bare minimum — decide
// whether this navigation is the landing route, then dynamically import the
// matching bundle. Keeping the two as separate dynamic imports lets Vite split
// them, so the landing route never fetches the multi-megabyte app bundle
// (src/main.ts and its Three.js / CodeMirror / manifold graph). The app loads
// only when you navigate into the editor/catalog/etc.
//
// The landing predicate must match shouldShowLanding() in src/main.ts and the
// pre-paint check in public/route-init.js: pathname "/" with no editor view
// state in the query or a share hash.
function isLandingRoute(): boolean {
  const p = window.location.pathname;
  const q = window.location.search;
  const h = window.location.hash;
  return (
    (p === '/' || p === '') &&
    !h.startsWith('#share=') &&
    q.indexOf('view=') < 0 &&
    q.indexOf('session=') < 0 &&
    q.indexOf('gallery') < 0 &&
    q.indexOf('versions') < 0 &&
    q.indexOf('images') < 0 &&
    q.indexOf('diff') < 0 &&
    q.indexOf('notes') < 0 &&
    q.indexOf('data') < 0
  );
}

if (isLandingRoute()) {
  void import('./landing/landingEntry');
} else {
  void import('./main');
}
