/**
 * Sentinel Extension - Background Service Worker
 *
 * Handles:
 * - Element selection storage (from content script)
 * - Badge updates showing unread alerts count
 * - Context menu for quick rule creation
 * - Periodic polling for new alerts
 */

import {
  SelectedElement,
  getStorageData,
  setStorageData,
  apiRequest,
  StorageData,
} from '../shared/storage';

// Extended storage interface for badge tracking
interface ExtendedStorageData extends StorageData {
  lastSeenAlertTime?: string;
  unreadAlertCount?: number;
}

// Alert polling interval (30 seconds)
const ALERT_POLL_INTERVAL_MS = 30000;

// Badge colors
const BADGE_COLOR_ALERT = '#EF4444'; // Red for alerts
const BADGE_COLOR_NORMAL = '#4f46e5'; // Indigo when logged in

// Store alarm name
const ALERT_POLL_ALARM = 'sentinel-alert-poll';

// Fetch unread alerts count from API
async function fetchUnreadAlertsCount(): Promise<number> {
  try {
    const { authToken } = await getStorageData();
    if (!authToken) return 0;

    // Get last seen time from storage
    const storage = await chrome.storage.local.get(['lastSeenAlertTime']);
    const lastSeenTime = storage.lastSeenAlertTime;

    // Get workspaces first
    const workspaces = await apiRequest<{ id: string }[]>('/workspaces');
    if (!workspaces || workspaces.length === 0) return 0;

    // Fetch open alerts (not acknowledged or resolved)
    const url = `/alerts?workspaceId=${workspaces[0].id}&status=open&limit=100`;

    // API returns { alerts: [...], count: N }
    const response = await apiRequest<{ alerts: { id: string; createdAt: string }[]; count: number }>(url);

    // Filter client-side: only count alerts created after lastSeenTime
    if (lastSeenTime && response?.alerts) {
      const lastSeenDate = new Date(lastSeenTime);
      const newAlerts = response.alerts.filter(a => new Date(a.createdAt) > lastSeenDate);
      return newAlerts.length;
    }

    return response?.count || 0;
  } catch (error) {
    console.error('Failed to fetch alerts count:', error);
    return 0;
  }
}

// Update badge with alert count
async function updateAlertBadge(): Promise<void> {
  try {
    const { authToken } = await getStorageData();

    if (!authToken) {
      // Not logged in - clear badge
      chrome.action.setBadgeText({ text: '' });
      return;
    }

    const count = await fetchUnreadAlertsCount();

    // Save count to storage
    await chrome.storage.local.set({ unreadAlertCount: count });

    if (count > 0) {
      // Show count (max "99+" for large numbers)
      const badgeText = count > 99 ? '99+' : String(count);
      chrome.action.setBadgeText({ text: badgeText });
      chrome.action.setBadgeBackgroundColor({ color: BADGE_COLOR_ALERT });
    } else {
      // No alerts - show empty badge
      chrome.action.setBadgeText({ text: '' });
      chrome.action.setBadgeBackgroundColor({ color: BADGE_COLOR_NORMAL });
    }
  } catch (error) {
    console.error('Failed to update alert badge:', error);
  }
}

// Clear badge and mark alerts as seen
async function clearBadge(): Promise<void> {
  // Set last seen time to now
  await chrome.storage.local.set({
    lastSeenAlertTime: new Date().toISOString(),
    unreadAlertCount: 0,
  });
  chrome.action.setBadgeText({ text: '' });
}

// Setup periodic alert polling using chrome.alarms
function setupAlertPolling(): void {
  // Create alarm for periodic polling
  chrome.alarms.create(ALERT_POLL_ALARM, {
    periodInMinutes: ALERT_POLL_INTERVAL_MS / 60000,
  });

  // Initial poll
  updateAlertBadge();
}

// Badge Management for tab (deprecated - now using global badge)
async function updateBadgeForTab(tabId: number): Promise<void> {
  // No-op - badge is now global, updated by alert polling
}

// Context Menu
function setupContextMenu(): void {
  // Remove existing to avoid duplicates
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: 'sentinel-monitor',
      title: 'Monitor this element with Sentinel',
      contexts: ['selection', 'link', 'image'],
    });
  });
}

// Handle element selection from content script
async function handleElementSelected(
  element: {
    selector: string;
    value: string;
    tagName: string;
    fingerprint?: {
      selector: string;
      alternativeSelectors?: string[];
      textAnchor?: string;
      parentContext?: { tag: string; classes: string[]; id?: string }[];
      attributes?: Record<string, string>;
    };
  },
  sender: chrome.runtime.MessageSender
): Promise<void> {
  const tab = sender.tab;
  if (!tab?.url || !tab?.title) {
    console.error('No tab info available');
    return;
  }

  const pendingElement: SelectedElement = {
    selector: element.selector,
    value: element.value,
    tagName: element.tagName,
    pageUrl: tab.url,
    pageTitle: tab.title,
    timestamp: Date.now(),
    fingerprint: element.fingerprint,
  };

  // Save to storage so popup can read it when opened
  await setStorageData({ pendingElement });

  console.log('Element saved to storage:', pendingElement);

  // Show notification that element was selected
  chrome.notifications.create('element-selected', {
    type: 'basic',
    iconUrl: 'icons/icon128.png',
    title: 'Element Selected',
    message: `Click the Sentinel icon to create a monitoring rule for: ${element.value.substring(0, 50)}${element.value.length > 50 ? '...' : ''}`,
    requireInteraction: false,
  });
}

// Event Listeners
chrome.runtime.onInstalled.addListener(() => {
  console.log('Sentinel extension installed');
  setupContextMenu();
  setupAlertPolling();
});

// Handle alarm for periodic polling
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALERT_POLL_ALARM) {
    updateAlertBadge();
  }
});

// Also check on service worker startup (in case it was terminated)
chrome.runtime.onStartup.addListener(() => {
  setupAlertPolling();
});

chrome.tabs.onActivated.addListener(async (activeInfo) => {
  try {
    await updateBadgeForTab(activeInfo.tabId);
  } catch (error) {
    console.error('Failed to handle tab activation:', error);
  }
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === 'complete') {
    updateBadgeForTab(tabId);
  }
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'sentinel-monitor' && tab?.id) {
    chrome.tabs.sendMessage(tab.id, {
      action: 'contextMenuPick',
      selectionText: info.selectionText,
      linkUrl: info.linkUrl,
      srcUrl: info.srcUrl,
    });
  }
});

chrome.notifications.onClicked.addListener(async (notificationId) => {
  if (notificationId === 'element-selected') {
    // Clear the notification
    chrome.notifications.clear(notificationId);

    // Try to use openPopup (Chrome 127+)
    if (typeof chrome.action.openPopup === 'function') {
      try {
        await chrome.action.openPopup();
        return;
      } catch {
        // openPopup may fail if no active window or other restrictions
      }
    }

    // Fallback: Focus the browser window and show a reminder notification
    try {
      const [currentWindow] = await chrome.windows.getAll({ windowTypes: ['normal'] });
      if (currentWindow?.id) {
        await chrome.windows.update(currentWindow.id, { focused: true });
      }
    } catch {
      // Window focus failed, continue anyway
    }

    // Show a brief reminder to click the icon
    chrome.notifications.create('click-icon-reminder', {
      type: 'basic',
      iconUrl: 'icons/icon128.png',
      title: 'Click the Sentinel Icon',
      message: 'Click the Sentinel icon in your toolbar to create the monitoring rule.',
      requireInteraction: false,
    });

    // Auto-clear reminder after 5 seconds
    setTimeout(() => {
      chrome.notifications.clear('click-icon-reminder');
    }, 5000);
  }
});

// Message handling
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Handle element selection from content script
  if (message.action === 'elementSelected' && message.element) {
    handleElementSelected(message.element, sender)
      .then(() => sendResponse({ success: true }))
      .catch((error) => {
        console.error('Failed to handle element selection:', error);
        sendResponse({ success: false, error: error.message });
      });
    return true; // Keep channel open for async response
  }

  if (message.action === 'refreshBadge' && sender.tab?.id) {
    updateBadgeForTab(sender.tab.id);
    sendResponse({ success: true });
    return true;
  }

  if (message.action === 'clearCache') {
    setStorageData({ rulesCache: {} }).then(() => {
      sendResponse({ success: true });
    });
    return true;
  }

  if (message.action === 'clearPendingElement') {
    setStorageData({ pendingElement: undefined }).then(() => {
      sendResponse({ success: true });
    });
    return true;
  }

  // Clear badge when popup opens (user has seen the alerts)
  if (message.action === 'popupOpened') {
    clearBadge().then(() => {
      sendResponse({ success: true });
    });
    return true;
  }

  // Force refresh badge (e.g., after login)
  if (message.action === 'refreshAlertBadge') {
    updateAlertBadge().then(() => {
      sendResponse({ success: true });
    });
    return true;
  }

  return true;
});

console.log('Sentinel background service worker started');

export {};
