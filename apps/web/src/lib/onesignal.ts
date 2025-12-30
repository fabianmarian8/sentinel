import OneSignal from 'react-onesignal';

const ONESIGNAL_APP_ID = 'd2a6756a-e9d6-4162-9c86-0869bde9328b';

let isInitialized = false;

export async function initOneSignal(): Promise<void> {
  if (typeof window === 'undefined') return;
  if (isInitialized) return;

  try {
    await OneSignal.init({
      appId: ONESIGNAL_APP_ID,
      allowLocalhostAsSecureOrigin: true,
      serviceWorkerPath: '/OneSignalSDK.sw.js',
    });
    isInitialized = true;
  } catch (error) {
    console.error('Failed to initialize OneSignal:', error);
  }
}

export async function requestPushPermission(): Promise<string | null> {
  if (typeof window === 'undefined') return null;

  try {
    // Initialize if not already done
    await initOneSignal();

    // Request permission
    await OneSignal.Notifications.requestPermission();

    // Check if permission granted
    const permission = await OneSignal.Notifications.permission;
    if (!permission) {
      return null;
    }

    // Get the player ID (subscription ID)
    const playerId = await OneSignal.User.PushSubscription.id;
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
    const playerId = await OneSignal.User.PushSubscription.id;
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
    const permission = await OneSignal.Notifications.permission;
    return !!permission;
  } catch (error) {
    return false;
  }
}
