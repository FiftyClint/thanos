/**
 * Service worker registration.
 *
 * The previous version noticed a new build and wrote "please refresh" to the
 * console — which nobody sees, so an installed PWA could serve stale code for
 * as long as it stayed installed. This activates the new worker and reloads
 * once, at a moment that cannot interrupt logging: never while a workout page
 * has unsaved state on screen.
 */
export function registerServiceWorker(): void {
  if (!("serviceWorker" in navigator)) return;

  window.addEventListener("load", async () => {
    try {
      const registration = await navigator.serviceWorker.register("/sw.js", { scope: "/" });

      registration.addEventListener("updatefound", () => {
        const installing = registration.installing;
        if (!installing) return;

        installing.addEventListener("statechange", () => {
          // `controller` present means this is an update, not a first install.
          if (installing.state === "installed" && navigator.serviceWorker.controller) {
            applyUpdateWhenSafe(installing);
          }
        });
      });

      // Check for a new build when the app is brought back to the foreground.
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") void registration.update();
      });
    } catch (error) {
      console.error("Service worker registration failed:", error);
    }
  });
}

/** Reloading mid-set would throw away everything typed but not yet saved. */
function isSafeToReload(): boolean {
  return !window.location.pathname.startsWith("/workout/");
}

function applyUpdateWhenSafe(worker: ServiceWorker): void {
  let reloaded = false;

  const activate = () => {
    if (reloaded || !isSafeToReload()) return;
    reloaded = true;
    worker.postMessage("SKIP_WAITING");
  };

  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (reloaded) window.location.reload();
  });

  activate();
  // If the user was mid-workout, take the update once they navigate away.
  window.addEventListener("popstate", activate);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") activate();
  });
}
