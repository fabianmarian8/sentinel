/**
 * Sentinel Extension - Background Service Worker
 *
 * Handles:
 * - Element selection storage (from content script)
 * - Badge updates showing active rules count
 * - Context menu for quick rule creation
 */

import {
  SelectedElement,
  getStorageData,
  setStorageData,
} from '../shared/storage';


// Badge Management - simplified, no API call (just show if logged in)
async function updateBadgeForTab(tabId: number): Promise<void> {
  try {
    const { authToken } = await getStorageData();

    if (authToken) {
      // Show a dot to indicate logged in
      chrome.action.setBadgeText({ tabId, text: '' });
      chrome.action.setBadgeBackgroundColor({ tabId, color: '#4f46e5' });
    } else {
      chrome.action.setBadgeText({ tabId, text: '' });
    }
  } catch (error) {
    console.error('Failed to update badge:', error);
  }
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
  element: { selector: string; value: string; tagName: string },
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

chrome.notifications.onClicked.addListener((notificationId) => {
  if (notificationId === 'element-selected') {
    // Open popup by clicking the extension icon programmatically
    // This is not directly possible, but we can open the popup.html in a new tab as fallback
    chrome.tabs.create({ url: chrome.runtime.getURL('popup.html') });
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

  return true;
});

console.log('Sentinel background service worker started');

export {};
