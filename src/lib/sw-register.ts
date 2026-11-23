// Registers the app-shell service worker (src/sw/, emitted as /sw.js
// by the build). Production builds only: in dev the Vite server owns
// every request and a worker would serve stale modules. Failure is
// silent — the app works without it, it just cannot reload offline.

export interface SwEnv {
  prod: boolean;
  navigator?: { serviceWorker?: { register(url: string, opts?: RegistrationOptions): Promise<unknown> } } | null;
  secure?: boolean;
}

export function registerServiceWorker(
  env: SwEnv = {
    prod: import.meta.env.PROD,
    navigator: typeof navigator === 'undefined' ? null : navigator,
    secure: typeof window === 'undefined' ? false : window.isSecureContext,
  },
): Promise<boolean> {
  const sw = env.navigator?.serviceWorker;
  if (!env.prod || !sw || env.secure === false) return Promise.resolve(false);
  return sw.register('/sw.js', { scope: '/' }).then(
    () => true,
    (e) => {
      console.warn('service worker registration failed', e);
      return false;
    },
  );
}
