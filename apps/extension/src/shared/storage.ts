/**
 * Shared storage utilities for Sentinel extension
 */

export interface User {
  id: string;
  email: string;
  name: string;
}

export interface SelectedElement {
  selector: string;
  value: string;
  tagName: string;
  pageUrl: string;
  pageTitle: string;
  timestamp: number;
}

export interface StorageData {
  authToken?: string;
  user?: User;
  apiBaseUrl?: string;
  rulesCache?: RuleCache;
  pendingElement?: SelectedElement;
  savedCredentials?: {
    email: string;
    password: string;
  };
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
    chrome.storage.local.get(['authToken', 'user', 'apiBaseUrl', 'rulesCache', 'pendingElement', 'savedCredentials'], (result) => {
      resolve(result as StorageData);
    });
  });
}

export async function setStorageData(data: Partial<StorageData>): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.local.set(data, resolve);
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
    if (response.status === 401) {
      await setStorageData({ authToken: undefined, user: undefined });
      throw new Error('Session expired');
    }
    const error = await response.json().catch(() => ({}));
    throw new Error(error.message || `HTTP ${response.status}`);
  }

  return response.json();
}
