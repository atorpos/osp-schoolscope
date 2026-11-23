import { api } from './api';
import { ApiError } from './session';

/** Apple serves the newest MapKit JS 5 release at this address */
const MAPKIT_SCRIPT = 'https://cdn.apple-mapkit.com/mk/5.x.x/mapkit.js';

let loading: Promise<typeof mapkit> | null = null;
let failure: string | null = null;
const failureListeners = new Set<(message: string) => void>();

function loadScript(): Promise<void> {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = MAPKIT_SCRIPT;
    script.crossOrigin = 'anonymous';
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => {
      script.remove();
      reject(new Error('Apple Maps could not be loaded'));
    };
    document.head.append(script);
  });
}

/**
 * Loads MapKit JS and initializes it with tokens from `GET /api/mapkit/token`, which the API signs with the
 * MapKit key; the key itself never reaches the browser. Rejects with `ApiError` 503 when the server has no
 * MapKit key, before loading Apple's script.
 */
export function loadMapKit(): Promise<typeof mapkit> {
  loading ??= (async () => {
    // A token first: it tells whether Apple Maps is set up, and serves MapKit's first authorization request
    let firstToken: string | null = (await api.mapKitToken()).token;
    await loadScript();
    mapkit.addEventListener('error', event => {
      // "Unauthorized": Apple rejected the token, e.g. a wrong key, team or origin
      failure = event.status === 'Unauthorized'
        ? 'Apple Maps rejected this server’s MapKit key'
        : 'Apple Maps is temporarily unavailable';
      for (const listener of failureListeners) listener(failure);
    });
    mapkit.init({
      language: navigator.language || 'en',
      authorizationCallback: done => {
        if (firstToken) {
          done(firstToken);
          firstToken = null;
          return;
        }
        // MapKit asks again when the token is about to expire. An empty token makes it report "Unauthorized".
        api.mapKitToken().then(({ token }) => done(token), () => done(''));
      },
    });
    return mapkit;
  })();
  // Try again next time after a network problem, but not when the server has no MapKit key (that needs a restart)
  loading.catch(error => { if (!(error instanceof ApiError && error.status === 503)) loading = null; });
  return loading;
}

/** Calls the listener when MapKit JS reports it can't work, including a failure before it subscribed */
export function onMapKitFailure(listener: (message: string) => void): () => void {
  if (failure) listener(failure);
  failureListeners.add(listener);
  return () => { failureListeners.delete(listener); };
}
