/**
 * Shared storage utilities for Sentinel extension
 */

export interface User {
  id: string;
  email: string;
  name: string;
}

export interface SelectorFingerprint {
  /** Primary CSS selector */
  selector: string;
  /** Alternative selectors for fallback */
  alternativeSelectors?: string[];
  /** Text content anchor for validation */
  textAnchor?: string;
  /** Parent element context (2 levels) */
  parentContext?: {
    tag: string;
    classes: string[];
    id?: string;
  }[];
  /** Element attributes for verification */
  attributes?: Record<string, string>;
}

export interface SelectedElement {
  selector: string;
  value: string;
  tagName: string;
  pageUrl: string;
  pageTitle: string;
  timestamp: number;
  /** Enhanced fingerprint for auto-healing */
  fingerprint?: SelectorFingerprint;
}

export interface StorageData {
  authToken?: string;
  user?: User;
  apiBaseUrl?: string;
  rulesCache?: RuleCache;
  pendingElement?: SelectedElement;
  /**
   * Saved email for convenience (NOT password - security risk)
   * Password should never be stored, use authToken instead
   */
  savedEmail?: string;
}

export interface RuleCache {
  [domain: string]: {
    count: number;
    lastUpdated: number;
  };
}

export const DEFAULT_API_URL = 'https://sentinel.taxinearme.sk/api';

export async function getStorageData(): Promise<StorageData> {
  return new Promise((resolve) => {
    chrome.storage.local.get(['authToken', 'user', 'apiBaseUrl', 'rulesCache', 'pendingElement', 'savedEmail'], (result) => {
      resolve(result as StorageData);
    });
  });
}

/**
 * Clear any legacy saved credentials (password) for security
 * Call this on extension update to clean up old data
 */
export async function clearLegacyCredentials(): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.local.remove(['savedCredentials'], resolve);
  });
}

export async function setStorageData(data: Partial<StorageData>): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.local.set(data, resolve);
  });
}

export async function removeStorageKeys(keys: (keyof StorageData)[]): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.local.remove(keys, resolve);
  });
}

export async function getApiUrl(): Promise<string> {
  const data = await getStorageData();
  return data.apiBaseUrl || DEFAULT_API_URL;
}

export async function apiRequest<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const { authToken } = await getStorageData();
  const apiUrl = await getApiUrl();

  const headers: HeadersInit = {
    'Content-Type': 'application/json',
    ...options.headers,
  };

  if (authToken) {
    (headers as Record<string, string>)['Authorization'] = `Bearer ${authToken}`;
  }

  const response = await fetch(`${apiUrl}${endpoint}`, {
    ...options,
    headers,
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));

    // For auth endpoints (login/register), show the actual error message
    const isAuthEndpoint = endpoint.startsWith('/auth/');

    if (response.status === 401 && !isAuthEndpoint) {
      // Session expired - clear tokens and show message
      await setStorageData({ authToken: undefined, user: undefined });
      throw new Error('Session expired');
    }

    // For auth endpoints or other errors, show the real message
    throw new Error(error.message || `HTTP ${response.status}`);
  }

  return response.json();
}
