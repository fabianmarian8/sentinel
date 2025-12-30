const ONESIGNAL_APP_ID = 'd2a6756a-e9d6-4162-9c86-0869bde9328b';
// Use Cloudflare Workers proxy to bypass ad blockers
const ONESIGNAL_PROXY_URL = 'https://onesignal-proxy.fabianmarian8.workers.dev';

let isInitialized = false;
let initPromise: Promise<void> | null = null;

// Declare global OneSignal types
declare global {
  interface Window {
    OneSignalDeferred?: Array<(OneSignal: any) => void>;
    OneSignal?: any;
  }
}

function loadOneSignalScript(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined') {
      reject(new Error('Window is undefined'));
      return;
    }

    // Check if script is already loaded
    if (window.OneSignal) {
      resolve();
      return;
    }

    // Check if script tag already exists
    const existingScript = document.querySelector('script[src*="OneSignalSDK"]');
    if (existingScript) {
      // Wait for it to load
      const checkLoaded = setInterval(() => {
        if (window.OneSignal) {
          clearInterval(checkLoaded);
          resolve();
        }
      }, 100);

      setTimeout(() => {
        clearInterval(checkLoaded);
        reject(new Error('OneSignal script load timeout'));
      }, 10000);
      return;
    }

    // Initialize deferred array
    window.OneSignalDeferred = window.OneSignalDeferred || [];

    // Create and load script via proxy to bypass ad blockers
    const script = document.createElement('script');
    script.src = `${ONESIGNAL_PROXY_URL}/sdks/web/v16/OneSignalSDK.page.js`;
    script.defer = true;

    script.onload = () => {
      // Wait for OneSignal to be available
      const checkLoaded = setInterval(() => {
        if (window.OneSignal) {
          clearInterval(checkLoaded);
          resolve();
        }
      }, 100);

      setTimeout(() => {
        clearInterval(checkLoaded);
        reject(new Error('OneSignal initialization timeout'));
      }, 10000);
    };

    script.onerror = () => {
      reject(new Error('Failed to load OneSignal SDK script'));
    };

    document.head.appendChild(script);
  });
}

export async function initOneSignal(): Promise<void> {
  if (typeof window === 'undefined') return;
  if (isInitialized) return;

  // Return existing promise if init is in progress
  if (initPromise) return initPromise;

  initPromise = (async () => {
    try {
      await loadOneSignalScript();

      if (!window.OneSignal) {
        throw new Error('OneSignal not loaded');
      }

      await window.OneSignal.init({
        appId: ONESIGNAL_APP_ID,
        allowLocalhostAsSecureOrigin: true,
        serviceWorkerParam: { scope: '/' },
        serviceWorkerPath: '/OneSignalSDKWorker.js',
      });

      isInitialized = true;
      console.log('OneSignal initialized successfully');
    } catch (error) {
      console.error('Failed to initialize OneSignal:', error);
      initPromise = null;
      throw error;
    }
  })();

  return initPromise;
}

export async function requestPushPermission(): Promise<string | null> {
  if (typeof window === 'undefined') return null;

  try {
    await initOneSignal();

    if (!window.OneSignal) {
      console.error('OneSignal not available');
      return null;
    }

    // Request permission
    await window.OneSignal.Notifications.requestPermission();

    // Check if permission granted
    const permission = await window.OneSignal.Notifications.permission;
    if (!permission) {
      return null;
    }

    // Get the player ID (subscription ID)
    const playerId = await window.OneSignal.User.PushSubscription.id;
    return playerId || null;
  } catch (error) {
    console.error('Failed to request push permission:', error);
    return null;
  }
}

export async function getPlayerId(): Promise<string | null> {
  if (typeof window === 'undefined') return null;

  try {
    await initOneSignal();
    if (!window.OneSignal) return null;
    const playerId = await window.OneSignal.User.PushSubscription.id;
    return playerId || null;
  } catch (error) {
    console.error('Failed to get player ID:', error);
    return null;
  }
}

export async function isPushEnabled(): Promise<boolean> {
  if (typeof window === 'undefined') return false;

  try {
    await initOneSignal();
    if (!window.OneSignal) return false;
    const permission = await window.OneSignal.Notifications.permission;
    return !!permission;
  } catch (error) {
    return false;
  }
}
