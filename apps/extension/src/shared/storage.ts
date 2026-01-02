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
  passiveRulesByUser?: PassiveRulesByUser;
  passiveObservationsByUser?: PassiveObservationsByUser;
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

export type MonitoringMode = 'server' | 'passive';

export interface PassiveRule {
  id: string;
  userId: string;
  workspaceId: string;
  name: string;
  ruleType: 'price' | 'availability' | 'text' | 'number';
  enabled: boolean;
  createdAt: number;
  captureIntervalSeconds: number;

  url: string;
  urlKey: string; // origin + pathname (ignores query/hash) for matching
  selector: string;
  alternativeSelectors?: string[];
}

export interface PassiveObservation {
  id: string;
  userId: string;
  ruleId: string;
  capturedAt: string; // ISO
  url: string;
  urlKey: string;
  value: string;
}

export type PassiveRulesByUser = Record<string, PassiveRule[]>;
export type PassiveObservationsByUser = Record<string, PassiveObservation[]>;

async function getPassiveStorage(): Promise<{
  passiveRulesByUser?: PassiveRulesByUser;
  passiveObservationsByUser?: PassiveObservationsByUser;
}> {
  return new Promise((resolve) => {
    chrome.storage.local.get(['passiveRulesByUser', 'passiveObservationsByUser'], (result) => {
      resolve(result as any);
    });
  });
}

export function computeUrlKey(url: string): string | null {
  try {
    const u = new URL(url);
    const path = u.pathname.length > 1 ? u.pathname.replace(/\/+$/, '') : u.pathname;
    return `${u.origin}${path}`;
  } catch {
    return null;
  }
}

function generateId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }
}

export function createPassiveRule(input: Omit<PassiveRule, 'id' | 'createdAt' | 'urlKey'>): PassiveRule {
  const urlKey = computeUrlKey(input.url) ?? input.url;
  return {
    ...input,
    id: generateId(),
    createdAt: Date.now(),
    urlKey,
  };
}

export function createPassiveObservation(input: Omit<PassiveObservation, 'id' | 'capturedAt' | 'urlKey'>): PassiveObservation {
  const urlKey = computeUrlKey(input.url) ?? input.url;
  return {
    ...input,
    id: generateId(),
    capturedAt: new Date().toISOString(),
    urlKey,
  };
}

export async function getPassiveRulesForUser(userId: string): Promise<PassiveRule[]> {
  const { passiveRulesByUser } = await getPassiveStorage();
  return passiveRulesByUser?.[userId] ?? [];
}

export async function upsertPassiveRuleForUser(userId: string, rule: PassiveRule): Promise<void> {
  const data = await getPassiveStorage();
  const passiveRulesByUser: PassiveRulesByUser = data.passiveRulesByUser ?? {};
  const existing = passiveRulesByUser[userId] ?? [];
  const idx = existing.findIndex(r => r.id === rule.id);
  const nextRules = idx >= 0 ? existing.map(r => (r.id === rule.id ? rule : r)) : [rule, ...existing];
  passiveRulesByUser[userId] = nextRules;
  await setStorageData({ passiveRulesByUser });
}

export async function deletePassiveRuleForUser(userId: string, ruleId: string): Promise<void> {
  const data = await getPassiveStorage();
  const passiveRulesByUser: PassiveRulesByUser = data.passiveRulesByUser ?? {};
  const passiveObservationsByUser: PassiveObservationsByUser = data.passiveObservationsByUser ?? {};

  const existingRules = passiveRulesByUser[userId] ?? [];
  passiveRulesByUser[userId] = existingRules.filter(r => r.id !== ruleId);

  const existingObs = passiveObservationsByUser[userId] ?? [];
  passiveObservationsByUser[userId] = existingObs.filter(o => o.ruleId !== ruleId);

  await setStorageData({ passiveRulesByUser, passiveObservationsByUser });
}

const MAX_PASSIVE_OBSERVATIONS_PER_USER = 5000;

export async function addPassiveObservationForUser(userId: string, obs: PassiveObservation): Promise<void> {
  const data = await getPassiveStorage();
  const passiveObservationsByUser: PassiveObservationsByUser = data.passiveObservationsByUser ?? {};
  const existing = passiveObservationsByUser[userId] ?? [];

  const next = [obs, ...existing];
  passiveObservationsByUser[userId] = next.slice(0, MAX_PASSIVE_OBSERVATIONS_PER_USER);
  await setStorageData({ passiveObservationsByUser });
}

export async function getPassiveObservationsForUser(userId: string): Promise<PassiveObservation[]> {
  const { passiveObservationsByUser } = await getPassiveStorage();
  return passiveObservationsByUser?.[userId] ?? [];
}

export async function clearPassiveDataForUser(userId: string): Promise<void> {
  const data = await getPassiveStorage();
  const passiveRulesByUser: PassiveRulesByUser = data.passiveRulesByUser ?? {};
  const passiveObservationsByUser: PassiveObservationsByUser = data.passiveObservationsByUser ?? {};

  delete passiveRulesByUser[userId];
  delete passiveObservationsByUser[userId];

  await setStorageData({ passiveRulesByUser, passiveObservationsByUser });
}
