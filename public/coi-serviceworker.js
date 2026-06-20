/*! coi-serviceworker v0.1.7 - Guido Zuidhof and nicosResearchWorker, licensed under MIT */
let coepCredentialless = false;
if (typeof window === 'undefined') {
  self.addEventListener("install", () => self.skipWaiting());
  self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
  self.addEventListener("message", (ev) => {
    if (ev.data && ev.data.type === "deregister") {
      self.registration
        .unregister()
        .then(() => self.clients.matchAll())
        .then((clients) => clients.forEach((client) => client.navigate(client.url)));
    }
  });
  self.addEventListener("fetch", function (e) {
    if (
      e.request.cache === "only-if-cached" &&
      e.request.mode !== "same-origin"
    ) {
      return;
    }
    e.respondWith(
      fetch(e.request)
        .then((res) => {
          if (res.status === 0) return res;
          const newHeaders = new Headers(res.headers);
          newHeaders.set("Cross-Origin-Embedder-Policy",
            coepCredentialless ? "credentialless" : "require-corp"
          );
          newHeaders.set("Cross-Origin-Opener-Policy", "same-origin");
          return new Response(res.body, {
            status: res.status,
            statusText: res.statusText,
            headers: newHeaders,
          });
        })
        .catch((e) => console.error(e))
    );
  });
} else {
  (() => {
    const reloadedByCOI = window.sessionStorage.getItem("coiReloadedByCOI");
    window.sessionStorage.removeItem("coiReloadedByCOI");
    const coiError = () => {};
    if (window.crossOriginIsolated !== false || reloadedByCOI) return;
    if (!window.isSecureContext) {
      !reloadedByCOI && coiError();
      return;
    }
    const n = navigator;
    if (n.serviceWorker && n.serviceWorker.controller) {
      n.serviceWorker.controller.postMessage({ type: "coepCredentialless", value: coepCredentialless });
      if (reloadedByCOI) return;
      window.sessionStorage.setItem("coiReloadedByCOI", "true");
      window.location.reload();
    } else if (n.serviceWorker) {
      // Register this very file as the service worker. Must NOT use `import.meta`
      // here: this script is loaded as a CLASSIC <script src> (not type=module),
      // so `import.meta` is a *parse-time* SyntaxError that discards the whole
      // file — silently breaking COI registration on every load. `currentScript`
      // is reliable for a synchronous classic script and already carries the
      // build's base prefix (e.g. /v1/coi-serviceworker.js), so it stays
      // base-correct for versioned (/vN/) deploys. Mirrors route-init.js.
      var swUrl = (document.currentScript && document.currentScript.src) || "coi-serviceworker.js";
      n.serviceWorker.register(swUrl).then(
        (registration) => {
          registration.addEventListener("updatefound", () => {
            const newSW = registration.installing;
            newSW.addEventListener("statechange", () => {
              if (newSW.state === "activated") {
                window.sessionStorage.setItem("coiReloadedByCOI", "true");
                window.location.reload();
              }
            });
          });
        },
        (err) => {
          coiError();
          console.error("COOP/COEP Service Worker failed to register:", err);
        }
      );
    }
  })();
}
