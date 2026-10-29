let registrationPromise;

/**
 * Register the production app shell. Standalone file previews and Vite dev
 * sessions intentionally never register a worker. Listen for:
 * - impact23-offline-ready: detail { registration }
 * - impact23-update-ready: detail { registration, worker }
 * Send worker.postMessage({ type: 'SKIP_WAITING' }) only after user approval;
 * the caller can then reload on navigator.serviceWorker's controllerchange.
 */
export function registerServiceWorker() {
  if (!import.meta.env?.PROD || typeof window === 'undefined' ||
    !['https:', 'http:'].includes(window.location.protocol) ||
    !('serviceWorker' in navigator)) return Promise.resolve(null);
  if (registrationPromise) return registrationPromise;

  registrationPromise = (async () => {
    try {
      const registration = await navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' });
      let readyAnnounced = false;
      const announceReady = () => {
        if (readyAnnounced) return;
        readyAnnounced = true;
        window.dispatchEvent(new CustomEvent('impact23-offline-ready', { detail: { registration } }));
      };
      const announceUpdate = (worker) => {
        window.dispatchEvent(new CustomEvent('impact23-update-ready', { detail: { registration, worker } }));
      };
      const observe = (worker) => {
        if (!worker) return;
        worker.addEventListener('statechange', () => {
          if (worker.state === 'installed' && navigator.serviceWorker.controller) announceUpdate(registration.waiting || worker);
          if (worker.state === 'activated') announceReady();
        });
      };
      registration.addEventListener('updatefound', () => observe(registration.installing));
      observe(registration.installing);
      if (registration.waiting) announceUpdate(registration.waiting);
      if (registration.active?.state === 'activated') announceReady();
      void navigator.serviceWorker.ready.then(announceReady);
      return registration;
    } catch {
      window.dispatchEvent(new CustomEvent('impact23-offline-error', { detail: { message: 'The offline app could not be installed. Reconnect and reload to try again.' } }));
      registrationPromise = undefined;
      return null;
    }
  })();
  return registrationPromise;
}

/** Call in response to the user's install/offline action; failure is nonfatal. */
export async function requestPersistStorage() {
  try {
    if (typeof navigator === 'undefined' || !navigator.storage?.persist) return false;
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}
