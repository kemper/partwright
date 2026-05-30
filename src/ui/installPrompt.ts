// PWA install affordance — captures the browser's `beforeinstallprompt` event so
// the landing page can offer a first-party "Install app" CTA instead of relying
// on Chrome's easy-to-miss address-bar icon.
//
// Browser support reality (why this module is more than one line):
//   - Chrome / Edge / Android Chrome fire `beforeinstallprompt` once the PWA is
//     installable (HTTPS + manifest + service worker — we have all three). We
//     stash the event and replay it on a user click.
//   - The event can fire BEFORE the landing page renders, so `init()` must run
//     at app startup (from main.ts), and the CTA subscribes for state changes.
//   - iOS Safari never fires the event and exposes no install API at all —
//     install there is a manual Share -> "Add to Home Screen". We detect iOS
//     and surface a text hint instead of a dead button.
//   - Firefox (desktop) has no install concept; the CTA simply stays hidden.

// The `beforeinstallprompt` event isn't in the DOM lib's typings.
interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  prompt(): Promise<void>;
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

let deferredPrompt: BeforeInstallPromptEvent | null = null;
let installed = false;
const listeners = new Set<() => void>();

function notify(): void {
  for (const cb of listeners) cb();
}

/**
 * Wire up the global listeners. Call once, as early as possible in app startup,
 * so we don't miss a `beforeinstallprompt` that fires before any UI mounts.
 */
export function initInstallPrompt(): void {
  if (typeof window === 'undefined') return;
  window.addEventListener('beforeinstallprompt', (e) => {
    // Stop Chrome's default mini-infobar so OUR CTA is the entry point.
    e.preventDefault();
    deferredPrompt = e as BeforeInstallPromptEvent;
    notify();
  });
  window.addEventListener('appinstalled', () => {
    installed = true;
    deferredPrompt = null;
    notify();
  });
}

/** True when the app is running as an installed PWA (standalone window). */
export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  // `navigator.standalone` is the iOS-Safari-only signal for home-screen apps.
  const iosStandalone = (navigator as unknown as { standalone?: boolean }).standalone === true;
  return window.matchMedia?.('(display-mode: standalone)').matches === true || iosStandalone;
}

/** Already installed (this session installed it, or we're running standalone). */
export function isAppInstalled(): boolean {
  return installed || isStandalone();
}

/** A live `beforeinstallprompt` is held and we're not already standalone. */
export function canInstall(): boolean {
  return deferredPrompt !== null && !isStandalone();
}

/**
 * True on Chromium browsers (Chrome / Edge / Brave / Opera, desktop + Android)
 * that support the programmatic install flow — detected via the presence of the
 * `onbeforeinstallprompt` handler, which Firefox and desktop Safari lack.
 *
 * This is deliberately broader than `canInstall()`: it stays true even when we
 * DON'T currently hold a `beforeinstallprompt` event (e.g. Chrome stops firing
 * it after the user dismisses the prompt once). That lets the CTA persist on
 * every page load and fall back to manual instructions, instead of vanishing
 * the moment the native prompt is dismissed.
 */
export function isInstallSupported(): boolean {
  if (typeof window === 'undefined') return false;
  return 'onbeforeinstallprompt' in window;
}

function isIOS(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  // iPadOS 13+ reports as MacIntel but has a touch screen.
  return /iphone|ipad|ipod/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

/**
 * iOS Safari (the only iOS browser that can install to the home screen) where
 * we aren't already standalone. These users get a manual-steps hint, since iOS
 * exposes no programmatic install prompt.
 */
export function isIOSInstallable(): boolean {
  if (!isIOS() || isStandalone()) return false;
  const ua = navigator.userAgent;
  // Chrome/Firefox/Edge on iOS (CriOS/FxiOS/EdgiOS) can't add to home screen.
  return /safari/i.test(ua) && !/crios|fxios|edgios/i.test(ua);
}

/**
 * Trigger the native install prompt. Resolves with the user's choice, or
 * 'unavailable' when no deferred prompt is held. The event is single-use, so we
 * drop it afterwards and notify subscribers to hide the CTA.
 */
export async function promptInstall(): Promise<'accepted' | 'dismissed' | 'unavailable'> {
  const evt = deferredPrompt;
  if (!evt) return 'unavailable';
  await evt.prompt();
  const { outcome } = await evt.userChoice;
  deferredPrompt = null;
  notify();
  return outcome;
}

/** Subscribe to install-availability changes. Returns an unsubscribe fn. */
export function onInstallStateChange(cb: () => void): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}
