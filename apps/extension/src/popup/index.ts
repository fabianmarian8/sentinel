/**
 * Sentinel Extension - Popup Script
 *
 * Handles the popup UI for the Chrome extension:
 * - Login/Register flow
 * - Element picker activation
 * - Rule creation form
 * - Display pending element from storage
 */

import {
  User,
  SelectedElement,
  getStorageData,
  setStorageData,
  removeStorageKeys,
  apiRequest,
  clearLegacyCredentials,
} from '../shared/storage';

interface Workspace {
  id: string;
  name: string;
}

interface AlertCondition {
  type: string;
  severity: string;
  threshold?: number;
  value?: string;
}

interface AlertPolicy {
  conditions: AlertCondition[];
  channels?: string[];
  cooldownSeconds?: number;
}

interface Rule {
  id: string;
  name: string;
  ruleType: string;
  enabled: boolean;
  healthScore: number;
  source: {
    url: string;
    domain: string;
  };
  observationCount?: number;
  currentState?: {
    lastStable: any;
    updatedAt?: string;
  } | null;
  nextRunAt?: string;
  alertPolicy?: AlertPolicy;
}

// State
let currentUser: User | null = null;
let workspaces: Workspace[] = [];
let rules: Rule[] = [];
let pendingElement: SelectedElement | null = null;
let currentTab: chrome.tabs.Tab | null = null;
let isRegisterMode = false;

// DOM Elements
const loginView = document.getElementById('login-view') as HTMLDivElement;
const pickerView = document.getElementById('picker-view') as HTMLDivElement;
const statusView = document.getElementById('status-view') as HTMLDivElement;

const authTitle = document.getElementById('auth-title') as HTMLHeadingElement;
const loginForm = document.getElementById('login-form') as HTMLFormElement;
const emailInput = document.getElementById('email') as HTMLInputElement;
const passwordInput = document.getElementById('password') as HTMLInputElement;
const authSubmitBtn = document.getElementById('auth-submit-btn') as HTMLButtonElement;
const authToggleText = document.getElementById('auth-toggle-text') as HTMLSpanElement;
const authToggleLink = document.getElementById('auth-toggle-link') as HTMLAnchorElement;

const pageTitle = document.getElementById('page-title') as HTMLHeadingElement;
const pageUrl = document.getElementById('page-url') as HTMLParagraphElement;

const startPickerBtn = document.getElementById('start-picker') as HTMLButtonElement;
const selectionPreview = document.getElementById('selection-preview') as HTMLDivElement;
const previewSelectorText = document.getElementById('preview-selector-text') as HTMLElement;
const previewValueText = document.getElementById('preview-value-text') as HTMLSpanElement;

// Accordion elements
const pickerAccordion = document.getElementById('picker-accordion') as HTMLDivElement;
const pickerAccordionToggle = document.getElementById('picker-accordion-toggle') as HTMLButtonElement;

const createRuleForm = document.getElementById('create-rule-form') as HTMLFormElement;
const ruleNameInput = document.getElementById('rule-name') as HTMLInputElement;
const ruleTypeSelect = document.getElementById('rule-type') as HTMLSelectElement;
const workspaceSelect = document.getElementById('workspace-id') as HTMLSelectElement;
const intervalSelect = document.getElementById('interval') as HTMLSelectElement;

const rulesList = document.getElementById('rules-list') as HTMLDivElement;
const settingsBtn = document.getElementById('settings-btn') as HTMLButtonElement;
const rememberMeCheckbox = document.getElementById('remember-me') as HTMLInputElement;

// Modal elements
const ruleConfigModal = document.getElementById('rule-config-modal') as HTMLDivElement;
const modalClose = document.getElementById('modal-close') as HTMLButtonElement;
const ruleConfigForm = document.getElementById('rule-config-form') as HTMLFormElement;
const configRuleId = document.getElementById('config-rule-id') as HTMLInputElement;
const alertOnChange = document.getElementById('alert-on-change') as HTMLInputElement;
const alertOnIncrease = document.getElementById('alert-on-increase') as HTMLInputElement;
const alertOnDecrease = document.getElementById('alert-on-decrease') as HTMLInputElement;
const alertIncreaseLabel = document.getElementById('alert-increase-label') as HTMLLabelElement;
const alertDecreaseLabel = document.getElementById('alert-decrease-label') as HTMLLabelElement;
const thresholdGroup = document.getElementById('threshold-group') as HTMLDivElement;
const thresholdType = document.getElementById('threshold-type') as HTMLSelectElement;
const thresholdValue = document.getElementById('threshold-value') as HTMLInputElement;

// Helper Functions
function showView(view: 'login' | 'picker' | 'status'): void {
  loginView.classList.add('hidden');
  pickerView.classList.add('hidden');
  statusView.classList.add('hidden');

  switch (view) {
    case 'login':
      loginView.classList.remove('hidden');
      break;
    case 'picker':
      pickerView.classList.remove('hidden');
      break;
    case 'status':
      statusView.classList.remove('hidden');
      break;
  }
}

function showToast(message: string, type: 'success' | 'error' | 'info' = 'info'): void {
  document.querySelectorAll('.toast').forEach(t => t.remove());

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  document.body.appendChild(toast);

  setTimeout(() => toast.remove(), 3000);
}

function updateAuthUI(): void {
  if (isRegisterMode) {
    authTitle.textContent = 'Create Account';
    authSubmitBtn.textContent = 'Sign Up';
    authToggleText.textContent = 'Already have an account?';
    authToggleLink.textContent = 'Login';
  } else {
    authTitle.textContent = 'Login to Sentinel';
    authSubmitBtn.textContent = 'Login';
    authToggleText.textContent = 'No account?';
    authToggleLink.textContent = 'Sign up';
  }
}

// Authentication
async function checkAuth(): Promise<boolean> {
  const { authToken, user } = await getStorageData();

  if (authToken && user) {
    currentUser = user;
    return true;
  }

  return false;
}

async function register(email: string, password: string): Promise<void> {
  const response = await apiRequest<{ accessToken: string; user: User }>('/auth/register', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });

  await setStorageData({
    authToken: response.accessToken,
    user: response.user,
  });

  currentUser = response.user;

  // Create default workspace for new user
  try {
    await apiRequest('/workspaces', {
      method: 'POST',
      body: JSON.stringify({ name: 'My Workspace', type: 'ecommerce' }),
    });
  } catch (e) {
    // Ignore if workspace creation fails
    console.log('Default workspace may already exist');
  }

  await initPickerView();
}

async function login(email: string, password: string): Promise<void> {
  const response = await apiRequest<{ accessToken: string; user: User }>('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });

  await setStorageData({
    authToken: response.accessToken,
    user: response.user,
  });

  currentUser = response.user;

  // Refresh alert badge after login
  chrome.runtime.sendMessage({ action: 'refreshAlertBadge' }).catch(() => {});

  await initPickerView();
}

async function logout(): Promise<void> {
  await removeStorageKeys(['authToken', 'user', 'pendingElement', 'savedEmail']);
  currentUser = null;
  isRegisterMode = false;
  updateAuthUI();
  emailInput.value = '';
  passwordInput.value = '';
  rememberMeCheckbox.checked = false;
  showView('login');
}

// Workspaces
async function loadWorkspaces(): Promise<void> {
  try {
    console.log('=== LOAD WORKSPACES DEBUG ===');
    workspaces = await apiRequest<Workspace[]>('/workspaces');
    console.log('Workspaces from API:', JSON.stringify(workspaces, null, 2));

    // If no workspaces exist, create one automatically
    if (workspaces.length === 0) {
      console.log('No workspaces found, creating default...');
      const newWorkspace = await apiRequest<Workspace>('/workspaces', {
        method: 'POST',
        body: JSON.stringify({ name: 'My Workspace', type: 'ecommerce' }),
      });
      console.log('Created workspace:', JSON.stringify(newWorkspace, null, 2));
      workspaces = [newWorkspace];
      showToast('Created default workspace', 'success');
    }

    workspaceSelect.innerHTML = '<option value="">Select workspace...</option>';
    workspaces.forEach(ws => {
      console.log(`Adding option: value="${ws.id}", text="${ws.name}"`);
      const option = document.createElement('option');
      option.value = ws.id;
      option.textContent = ws.name;
      workspaceSelect.appendChild(option);
    });

    // Auto-select first workspace if only one
    if (workspaces.length === 1) {
      workspaceSelect.value = workspaces[0].id;
      console.log('Auto-selected workspace:', workspaces[0].id);
    }
  } catch (error: any) {
    console.error('Failed to load workspaces:', error);
    // If session expired, show login
    if (error.message === 'Session expired') {
      showView('login');
      showToast('Session expired. Please login again.', 'error');
      return;
    }
    // Create default workspace option
    workspaceSelect.innerHTML = '<option value="">No workspaces - create one first</option>';
  }
}

// Current Tab Info
async function loadCurrentTab(): Promise<void> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  currentTab = tab;

  if (tab) {
    pageTitle.textContent = tab.title || 'Untitled Page';
    pageUrl.textContent = tab.url || '';
  }
}

// Load Rules
async function loadRules(): Promise<void> {
  if (workspaces.length === 0) return;

  try {
    const workspaceId = workspaces[0].id;
    rules = await apiRequest<Rule[]>(`/rules?workspaceId=${workspaceId}`);
    displayRules();
  } catch (error: any) {
    console.error('Failed to load rules:', error);
    if (error.message === 'Session expired') {
      showView('login');
      showToast('Session expired. Please login again.', 'error');
    }
  }
}

function displayRules(): void {
  if (rules.length === 0) {
    rulesList.innerHTML = '<p class="text-muted text-center">Žiadne pravidlá. Vyber element na stránke!</p>';
    return;
  }

  rulesList.innerHTML = rules.map(rule => `
    <div class="rule-item ${rule.enabled ? '' : 'disabled'}" data-rule-id="${rule.id}">
      <div class="rule-header">
        <span class="rule-name" title="${escapeHtml(rule.name)}">${escapeHtml(rule.name)}</span>
        <div class="rule-actions">
          <button class="rule-action-btn" data-action="config" data-rule-id="${rule.id}" title="Nastavenia upozornení">
            🔔
          </button>
          <button class="rule-action-btn" data-action="toggle" data-rule-id="${rule.id}" title="${rule.enabled ? 'Vypnúť' : 'Zapnúť'}">
            ${rule.enabled ? '⏸️' : '▶️'}
          </button>
          <button class="rule-action-btn delete" data-action="delete" data-rule-id="${rule.id}" title="Vymazať">
            🗑️
          </button>
        </div>
      </div>
      <a href="${escapeHtml(rule.source.url)}" class="rule-url" target="_blank" title="Otvoriť stránku">
        🔗 ${escapeHtml(rule.source.domain)}
      </a>
      <div class="rule-details">
        <span class="rule-type badge">${rule.ruleType}</span>
        ${rule.currentState?.lastStable ? `
          <span class="rule-value">Hodnota: <strong>${escapeHtml(formatValue(rule.currentState.lastStable, rule.ruleType))}</strong></span>
          ${rule.currentState.updatedAt ? `<span class="rule-time text-muted">${formatTime(rule.currentState.updatedAt)}</span>` : ''}
        ` : `<span class="rule-value text-muted">${rule.nextRunAt ? `Ďalšie načítanie: ${formatTime(rule.nextRunAt)}` : 'Čaká na prvé načítanie...'}</span>`}
      </div>
      <div class="rule-status">
        <span class="health-score" style="color: ${rule.healthScore > 70 ? '#059669' : rule.healthScore > 40 ? '#d97706' : '#dc2626'}">
          ● Zdravie: ${rule.healthScore}%
        </span>
        ${rule.observationCount ? `<span class="text-muted text-small" style="margin-left: 8px">${rule.observationCount} pozorovaní</span>` : ''}
      </div>
    </div>
  `).join('');

  // Add event listeners for rule actions
  rulesList.querySelectorAll('.rule-action-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      const action = (btn as HTMLElement).dataset.action;
      const ruleId = (btn as HTMLElement).dataset.ruleId;
      if (!ruleId) return;

      if (action === 'delete') {
        if (confirm('Naozaj chceš vymazať toto pravidlo?')) {
          await deleteRule(ruleId);
        }
      } else if (action === 'toggle') {
        await toggleRule(ruleId);
      } else if (action === 'config') {
        openConfigModal(ruleId);
      }
    });
  });
}

function formatTime(isoString: string): string {
  const date = new Date(isoString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const absDiffMs = Math.abs(diffMs);
  const diffMins = Math.floor(absDiffMs / 60000);
  const diffHours = Math.floor(absDiffMs / 3600000);
  const diffDays = Math.floor(absDiffMs / 86400000);

  // Future dates
  if (diffMs < 0) {
    if (diffMins < 1) return 'o chvíľu';
    if (diffMins < 60) return `o ${diffMins} min`;
    if (diffHours < 24) return `o ${diffHours} hod`;
    return `o ${diffDays} dní`;
  }

  // Past dates
  if (diffMins < 1) return 'práve teraz';
  if (diffMins < 60) return `pred ${diffMins} min`;
  if (diffHours < 24) return `pred ${diffHours} hod`;
  return `pred ${diffDays} dňami`;
}

function formatValue(value: any, ruleType: string): string {
  if (value === null || value === undefined) return 'Žiadne dáta';

  // Handle object values (structured data from worker)
  if (typeof value === 'object') {
    // Price/Number type: { value: 123, currency: "EUR" }
    if ('value' in value && typeof value.value === 'number') {
      return String(value.value);
    }
    // Legacy price format: { amount: 123, currency: "€" }
    if ('amount' in value) {
      return String(value.amount);
    }
    // Availability type: { inStock: true/false }
    if ('inStock' in value) {
      return value.inStock ? 'Na sklade' : 'Nedostupné';
    }
    // Text type: { snippet: "..." }
    if ('snippet' in value) {
      const snippet = value.snippet || '';
      return snippet.length > 30 ? snippet.substring(0, 30) + '...' : snippet;
    }
    // Generic object - try to stringify
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }

  // Primitive values
  return String(value);
}

async function deleteRule(ruleId: string): Promise<void> {
  try {
    await apiRequest(`/rules/${ruleId}`, { method: 'DELETE' });
    rules = rules.filter(r => r.id !== ruleId);
    displayRules();
    showToast('Pravidlo vymazané', 'success');
  } catch (error) {
    showToast(`Chyba: ${(error as Error).message}`, 'error');
  }
}

async function toggleRule(ruleId: string): Promise<void> {
  const rule = rules.find(r => r.id === ruleId);
  if (!rule) return;

  try {
    const endpoint = rule.enabled ? `/rules/${ruleId}/pause` : `/rules/${ruleId}/resume`;
    await apiRequest(endpoint, { method: 'POST' });
    rule.enabled = !rule.enabled;
    displayRules();
    showToast(rule.enabled ? 'Pravidlo zapnuté' : 'Pravidlo vypnuté', 'success');
  } catch (error) {
    showToast(`Chyba: ${(error as Error).message}`, 'error');
  }
}

// Modal functions
function openConfigModal(ruleId: string): void {
  const rule = rules.find(r => r.id === ruleId);
  if (!rule) return;

  configRuleId.value = ruleId;

  // Show/hide price-specific options
  const isPriceOrNumber = rule.ruleType === 'price' || rule.ruleType === 'number';
  alertIncreaseLabel.style.display = isPriceOrNumber ? 'flex' : 'none';
  alertDecreaseLabel.style.display = isPriceOrNumber ? 'flex' : 'none';
  thresholdGroup.style.display = isPriceOrNumber ? 'block' : 'none';

  // Update labels for non-price types
  if (rule.ruleType === 'number') {
    alertIncreaseLabel.querySelector('span')!.textContent = 'Hodnota sa zvýši';
    alertDecreaseLabel.querySelector('span')!.textContent = 'Hodnota sa zníži';
  } else {
    alertIncreaseLabel.querySelector('span')!.textContent = 'Cena sa zvýši';
    alertDecreaseLabel.querySelector('span')!.textContent = 'Cena sa zníži';
  }

  // Populate from current alertPolicy
  const policy = rule.alertPolicy;
  alertOnChange.checked = false;
  alertOnIncrease.checked = false;
  alertOnDecrease.checked = false;
  thresholdType.value = '';
  thresholdValue.value = '';

  if (policy?.conditions) {
    for (const condition of policy.conditions) {
      if (condition.type === 'value_changed') alertOnChange.checked = true;
      if (condition.type === 'value_increased') alertOnIncrease.checked = true;
      if (condition.type === 'value_decreased') alertOnDecrease.checked = true;
      if (condition.type === 'value_above') {
        thresholdType.value = 'above';
        thresholdValue.value = String(condition.threshold || '');
      }
      if (condition.type === 'value_below') {
        thresholdType.value = 'below';
        thresholdValue.value = String(condition.threshold || '');
      }
    }
  }

  ruleConfigModal.classList.remove('hidden');
}

function closeConfigModal(): void {
  ruleConfigModal.classList.add('hidden');
}

async function saveRuleConfig(e: Event): Promise<void> {
  e.preventDefault();

  const ruleId = configRuleId.value;
  if (!ruleId) return;

  const conditions: AlertCondition[] = [];

  if (alertOnChange.checked) {
    conditions.push({ type: 'value_changed', severity: 'medium' });
  }
  if (alertOnIncrease.checked) {
    conditions.push({ type: 'value_increased', severity: 'high' });
  }
  if (alertOnDecrease.checked) {
    conditions.push({ type: 'value_decreased', severity: 'high' });
  }
  if (thresholdType.value && thresholdValue.value) {
    const threshold = parseFloat(thresholdValue.value);
    if (!isNaN(threshold)) {
      conditions.push({
        type: thresholdType.value === 'above' ? 'value_above' : 'value_below',
        severity: 'high',
        threshold,
      });
    }
  }

  // If no conditions selected, add default
  if (conditions.length === 0) {
    conditions.push({ type: 'value_changed', severity: 'medium' });
  }

  try {
    // Fetch all notification channels and add their IDs
    let channelIds: string[] = [];
    if (workspaces.length > 0) {
      try {
        const channels = await apiRequest<{ id: string; enabled: boolean }[]>(
          `/notification-channels?workspaceId=${workspaces[0].id}`
        );
        channelIds = channels.filter(c => c.enabled).map(c => c.id);
      } catch (err) {
        console.log('Could not load notification channels:', err);
      }
    }

    await apiRequest(`/rules/${ruleId}`, {
      method: 'PATCH',
      body: JSON.stringify({
        alertPolicy: { conditions, channels: channelIds },
      }),
    });

    // Update local state
    const rule = rules.find(r => r.id === ruleId);
    if (rule) {
      rule.alertPolicy = { conditions, channels: channelIds };
    }

    closeConfigModal();
    showToast('Nastavenia uložené', 'success');
  } catch (error) {
    showToast(`Chyba: ${(error as Error).message}`, 'error');
  }
}

function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Load pending element from storage (selected via picker)
async function loadPendingElement(): Promise<void> {
  const { pendingElement: stored } = await getStorageData();

  if (stored) {
    pendingElement = stored;

    // Expand accordion and show the selected element
    pickerAccordion.classList.remove('collapsed');
    selectionPreview.classList.remove('hidden');
    previewSelectorText.textContent = stored.selector;
    previewValueText.textContent = stored.value || '(empty)';

    // Update page info to show the page where element was selected
    pageTitle.textContent = stored.pageTitle || 'Unknown Page';
    pageUrl.textContent = stored.pageUrl || '';

    createRuleForm.classList.remove('hidden');

    // Auto-detect rule type based on value
    const value = stored.value.trim();
    if (/^[\$€£¥]?\s*[\d,]+\.?\d*\s*[\$€£¥]?$/.test(value)) {
      ruleTypeSelect.value = 'price';
    } else if (/^\d+$/.test(value)) {
      ruleTypeSelect.value = 'number';
    } else if (/in stock|out of stock|available|unavailable/i.test(value)) {
      ruleTypeSelect.value = 'availability';
    } else {
      ruleTypeSelect.value = 'text';
    }

    // Auto-fill rule name
    if (!ruleNameInput.value) {
      ruleNameInput.value = `Monitor: ${stored.value.substring(0, 30)}${stored.value.length > 30 ? '...' : ''}`;
    }
  }
}

// Element Picker
async function startElementPicker(): Promise<void> {
  if (!currentTab?.id) {
    showToast('Žiadna aktívna záložka', 'error');
    return;
  }

  // Check if it's a special page where content scripts don't work
  const url = currentTab.url || '';
  if (url.startsWith('chrome://') || url.startsWith('chrome-extension://') ||
      url.startsWith('about:') || url.startsWith('edge://') ||
      url.startsWith('moz-extension://') || url === '') {
    showToast('Na tejto stránke nemožno vyberať elementy', 'error');
    return;
  }

  try {
    // First, clear any pending element
    await removeStorageKeys(['pendingElement']);

    // Send message to content script to start picking
    await chrome.tabs.sendMessage(currentTab.id, { action: 'startPicker' });

    // Close popup - user will pick element on the page
    window.close();
  } catch (error) {
    console.error('Failed to start picker:', error);
    // More helpful error message
    showToast('Obnov stránku (F5) a skús znova', 'error');
  }
}

// Rule Creation
async function createRule(event: Event): Promise<void> {
  event.preventDefault();

  if (!pendingElement) {
    showToast('Please select an element first', 'error');
    return;
  }

  const ruleName = ruleNameInput.value.trim();
  const ruleType = ruleTypeSelect.value;
  const workspaceId = workspaceSelect.value;
  const intervalSeconds = parseInt(intervalSelect.value, 10);

  // Debug logging
  console.log('=== CREATE RULE DEBUG ===');
  console.log('workspaceId:', workspaceId);
  console.log('workspaceId type:', typeof workspaceId);
  console.log('workspaceId length:', workspaceId?.length);
  console.log('All workspaces:', workspaces);
  console.log('Selected option:', workspaceSelect.selectedOptions[0]?.textContent);

  if (!ruleName || !ruleType) {
    showToast('Please fill in all required fields', 'error');
    return;
  }

  if (!workspaceId) {
    showToast('Please select a workspace', 'error');
    return;
  }

  const submitBtn = createRuleForm.querySelector('button[type="submit"]') as HTMLButtonElement;
  submitBtn.disabled = true;
  submitBtn.textContent = 'Creating...';

  try {
    // First, create or get the source for this URL
    const sourcePayload = {
      url: pendingElement.pageUrl,
      workspaceId,
    };
    console.log('Creating source with payload:', JSON.stringify(sourcePayload, null, 2));

    let sourceId: string;
    try {
      const sourceResponse = await apiRequest<{ id: string }>('/sources', {
        method: 'POST',
        body: JSON.stringify(sourcePayload),
      });
      console.log('Source created:', sourceResponse);
      sourceId = sourceResponse.id;
    } catch (sourceError: any) {
      // If source already exists, find it
      if (sourceError.message?.includes('already exists')) {
        console.log('Source already exists, fetching...');
        const sources = await apiRequest<{ id: string; url: string }[]>(
          `/sources?workspaceId=${workspaceId}`
        );
        const existingSource = sources.find(s => s.url === pendingElement!.pageUrl);
        if (!existingSource) {
          throw new Error('Could not find existing source');
        }
        sourceId = existingSource.id;
        console.log('Found existing source:', sourceId);
      } else {
        throw sourceError;
      }
    }

    // Then create the rule
    // Cap jitter at 300 seconds max
    const jitterSeconds = Math.min(Math.floor(intervalSeconds * 0.1), 300);

    await apiRequest('/rules', {
      method: 'POST',
      body: JSON.stringify({
        name: ruleName,
        ruleType,
        sourceId,
        extraction: {
          method: 'css',
          selector: pendingElement.selector,
          attribute: 'text',
        },
        selectorFingerprint: pendingElement.fingerprint,
        schedule: {
          intervalSeconds,
          jitterSeconds,
        },
        normalization: {
          type: ruleType === 'price' ? 'price' : ruleType === 'number' ? 'number' : 'text',
        },
        alertPolicy: {
          conditions: [
            {
              type: 'value_changed',
              severity: 'medium',
            },
          ],
        },
      }),
    });

    showToast('Pravidlo vytvorené!', 'success');

    // Clear pending element from storage (properly remove the key)
    await removeStorageKeys(['pendingElement']);

    // Send message to content script to remove highlight
    if (currentTab?.id) {
      chrome.tabs.sendMessage(currentTab.id, { action: 'clearSelection' }).catch(() => {
        // Ignore errors if content script not loaded
      });
    }

    // Reset form and collapse accordion
    createRuleForm.reset();
    createRuleForm.classList.add('hidden');
    selectionPreview.classList.add('hidden');
    previewSelectorText.textContent = '';
    previewValueText.textContent = '';
    pendingElement = null;
    pickerAccordion.classList.add('collapsed');

    // Refresh rules list to show the new rule
    await loadRules();

  } catch (error) {
    showToast(`Failed to create rule: ${(error as Error).message}`, 'error');
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Create Rule';
  }
}

// Initialization
async function initPickerView(): Promise<void> {
  showView('picker');

  // Load tab info first (MUST await to prevent race condition)
  await loadCurrentTab();

  // CRITICAL: Load workspaces FIRST before showing form
  // This fixes the race condition where form could show before workspaces are ready
  await loadWorkspaces();

  // Collapse accordion by default BEFORE checking pending element
  // (loadPendingElement will expand it if there's a pending element)
  pickerAccordion.classList.add('collapsed');

  // Only after workspaces are loaded, check for pending element and show form
  await loadPendingElement();

  // Load rules after workspaces are loaded
  await loadRules();
}

async function init(): Promise<void> {
  // SECURITY: Clear any legacy saved passwords on startup
  await clearLegacyCredentials();

  // Notify background that popup was opened (clears badge)
  chrome.runtime.sendMessage({ action: 'popupOpened' }).catch(() => {
    // Ignore errors if background script not ready
  });

  const isAuthenticated = await checkAuth();

  if (isAuthenticated) {
    await initPickerView();
  } else {
    showView('login');
    updateAuthUI();

    // Load saved email for convenience (NOT password - security risk)
    const { savedEmail } = await getStorageData();
    if (savedEmail) {
      emailInput.value = savedEmail;
      rememberMeCheckbox.checked = true;
      // User must enter password manually - this is intentional for security
    }
  }

  // Auth form handler
  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = emailInput.value.trim();
    const password = passwordInput.value;
    const rememberMe = rememberMeCheckbox.checked;

    if (!email || !password) {
      showToast('Please enter email and password', 'error');
      return;
    }

    if (password.length < 6) {
      showToast('Password must be at least 6 characters', 'error');
      return;
    }

    authSubmitBtn.disabled = true;
    authSubmitBtn.textContent = isRegisterMode ? 'Creating account...' : 'Logging in...';

    try {
      if (isRegisterMode) {
        await register(email, password);
        showToast('Account created!', 'success');
      } else {
        await login(email, password);
        showToast('Login successful!', 'success');
      }

      // Save email only (NOT password) if "Remember me" is checked
      // Password is never stored - user uses authToken for session
      if (rememberMe) {
        await setStorageData({ savedEmail: email });
      } else {
        await setStorageData({ savedEmail: undefined });
      }
    } catch (error) {
      showToast(`${isRegisterMode ? 'Registration' : 'Login'} failed: ${(error as Error).message}`, 'error');
    } finally {
      authSubmitBtn.disabled = false;
      authSubmitBtn.textContent = isRegisterMode ? 'Sign Up' : 'Login';
    }
  });

  // Toggle between login and register
  authToggleLink.addEventListener('click', (e) => {
    e.preventDefault();
    isRegisterMode = !isRegisterMode;
    updateAuthUI();
    loginForm.reset();
  });

  startPickerBtn.addEventListener('click', startElementPicker);
  createRuleForm.addEventListener('submit', createRule);

  // Accordion toggle (collapsed by default is set in initPickerView)
  pickerAccordionToggle.addEventListener('click', () => {
    pickerAccordion.classList.toggle('collapsed');
  });

  // Modal event listeners
  modalClose.addEventListener('click', closeConfigModal);
  ruleConfigModal.addEventListener('click', (e) => {
    if (e.target === ruleConfigModal) closeConfigModal();
  });
  ruleConfigForm.addEventListener('submit', saveRuleConfig);

  // Settings button - for now, just show logout option
  settingsBtn.addEventListener('click', async () => {
    if (currentUser) {
      if (confirm(`Logged in as ${currentUser.email}\n\nDo you want to logout?`)) {
        await logout();
        showToast('Logged out', 'info');
      }
    }
  });
}

document.addEventListener('DOMContentLoaded', init);

export { logout };
