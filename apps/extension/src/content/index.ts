/**
 * Sentinel Extension - Content Script
 *
 * Injected into all pages to:
 * - Enable element picker for rule creation
 * - Highlight monitored elements
 * - Extract element selectors
 */

interface SelectedElement {
  selector: string;
  value: string;
  tagName: string;
}

// State
let isPicking = false;
let highlightElement: HTMLDivElement | null = null;
let highlightLabel: HTMLDivElement | null = null;
let lastHoveredElement: Element | null = null;

// Styles for highlight overlay
const HIGHLIGHT_STYLES = `
  .sentinel-highlight {
    position: fixed;
    pointer-events: none;
    z-index: 2147483647;
    border: 2px solid #4f46e5;
    background: rgba(79, 70, 229, 0.1);
    transition: all 0.1s ease-out;
    box-sizing: border-box;
  }

  .sentinel-highlight-label {
    position: absolute;
    top: -24px;
    left: 0;
    background: #4f46e5;
    color: white;
    padding: 2px 8px;
    font-size: 11px;
    font-family: 'SF Mono', Monaco, 'Courier New', monospace;
    border-radius: 4px;
    white-space: nowrap;
    max-width: 300px;
    overflow: hidden;
    text-overflow: ellipsis;
    box-sizing: border-box;
  }

  .sentinel-picker-active {
    cursor: crosshair !important;
  }

  .sentinel-picker-active * {
    cursor: crosshair !important;
  }
`;

// Inject styles
function injectStyles(): void {
  if (document.getElementById('sentinel-styles')) return;

  const style = document.createElement('style');
  style.id = 'sentinel-styles';
  style.textContent = HIGHLIGHT_STYLES;
  document.head.appendChild(style);
}

// Create highlight overlay
function createHighlight(): void {
  if (highlightElement) return;

  highlightElement = document.createElement('div');
  highlightElement.className = 'sentinel-highlight';
  highlightElement.style.display = 'none';

  highlightLabel = document.createElement('div');
  highlightLabel.className = 'sentinel-highlight-label';
  highlightElement.appendChild(highlightLabel);

  document.body.appendChild(highlightElement);
}

// Remove highlight overlay
function removeHighlight(): void {
  highlightElement?.remove();
  highlightElement = null;
  highlightLabel = null;
}

// Update highlight position
function updateHighlight(element: Element): void {
  if (!highlightElement || !highlightLabel) return;

  const rect = element.getBoundingClientRect();

  highlightElement.style.display = 'block';
  highlightElement.style.left = `${rect.left}px`;
  highlightElement.style.top = `${rect.top}px`;
  highlightElement.style.width = `${rect.width}px`;
  highlightElement.style.height = `${rect.height}px`;

  // Update label
  const selector = generateSelector(element);
  highlightLabel.textContent = selector;

  // Adjust label position if off-screen
  if (rect.top < 24) {
    highlightLabel.style.top = 'auto';
    highlightLabel.style.bottom = '-24px';
  } else {
    highlightLabel.style.top = '-24px';
    highlightLabel.style.bottom = 'auto';
  }
}

// Generate unique CSS selector for element
function generateSelector(element: Element): string {
  // Try ID first
  if (element.id) {
    return `#${CSS.escape(element.id)}`;
  }

  // Build path from element to document
  const path: string[] = [];
  let current: Element | null = element;

  while (current && current !== document.body) {
    let selector = current.tagName.toLowerCase();

    // Add classes that seem meaningful (not random/generated)
    const classes = Array.from(current.classList)
      .filter(cls =>
        !cls.match(/^[a-z]{1,2}\d+/i) && // Skip random classes like "a1b2"
        !cls.match(/^\d/) && // Skip classes starting with numbers
        cls.length < 30 // Skip very long classes
      )
      .slice(0, 2); // Take max 2 classes

    if (classes.length > 0) {
      selector += '.' + classes.map(c => CSS.escape(c)).join('.');
    }

    // Add nth-child if needed for uniqueness
    const parent = current.parentElement;
    if (parent) {
      const siblings = Array.from(parent.children).filter(
        child => child.tagName === current!.tagName
      );
      if (siblings.length > 1) {
        const index = siblings.indexOf(current) + 1;
        selector += `:nth-child(${index})`;
      }
    }

    path.unshift(selector);
    current = current.parentElement;

    // Stop if we have a unique selector
    if (path.length >= 2) {
      const testSelector = path.join(' > ');
      try {
        if (document.querySelectorAll(testSelector).length === 1) {
          return testSelector;
        }
      } catch {
        // Invalid selector, continue
      }
    }

    // Limit depth
    if (path.length > 5) break;
  }

  return path.join(' > ');
}

// Get element text content
function getElementValue(element: Element): string {
  // For inputs, get value
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
    return element.value;
  }

  // For selects, get selected option text
  if (element instanceof HTMLSelectElement) {
    return element.options[element.selectedIndex]?.text || '';
  }

  // For images, get alt text or src
  if (element instanceof HTMLImageElement) {
    return element.alt || element.src;
  }

  // For links, get text content
  if (element instanceof HTMLAnchorElement) {
    return element.textContent?.trim() || element.href;
  }

  // Default: get text content
  return element.textContent?.trim() || '';
}

// Start element picker mode
function startPicker(): void {
  if (isPicking) return;

  isPicking = true;
  injectStyles();
  createHighlight();

  document.body.classList.add('sentinel-picker-active');

  // Add event listeners
  document.addEventListener('mousemove', handleMouseMove, true);
  document.addEventListener('click', handleClick, true);
  document.addEventListener('keydown', handleKeyDown, true);

  console.log('Sentinel: Element picker started');
}

// Stop element picker mode
function stopPicker(): void {
  if (!isPicking) return;

  isPicking = false;
  lastHoveredElement = null;

  document.body.classList.remove('sentinel-picker-active');
  removeHighlight();

  // Remove event listeners
  document.removeEventListener('mousemove', handleMouseMove, true);
  document.removeEventListener('click', handleClick, true);
  document.removeEventListener('keydown', handleKeyDown, true);

  console.log('Sentinel: Element picker stopped');
}

// Event Handlers
function handleMouseMove(event: MouseEvent): void {
  if (!isPicking) return;

  const target = event.target as Element;

  // Skip our own elements
  if (target.closest('.sentinel-highlight')) return;

  lastHoveredElement = target;
  updateHighlight(target);
}

function handleClick(event: MouseEvent): void {
  if (!isPicking) return;

  event.preventDefault();
  event.stopPropagation();

  const target = event.target as Element;

  // Skip our own elements
  if (target.closest('.sentinel-highlight')) return;

  // Generate selector and get value
  const selector = generateSelector(target);
  const value = getElementValue(target);

  const selectedElement: SelectedElement = {
    selector,
    value,
    tagName: target.tagName.toLowerCase(),
  };

  // Send to popup
  chrome.runtime.sendMessage({
    action: 'elementSelected',
    element: selectedElement,
  });

  stopPicker();
}

function handleKeyDown(event: KeyboardEvent): void {
  if (!isPicking) return;

  // Escape to cancel
  if (event.key === 'Escape') {
    event.preventDefault();
    stopPicker();
  }
}

// Message handling
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  switch (message.action) {
    case 'startPicker':
      startPicker();
      sendResponse({ success: true });
      break;

    case 'stopPicker':
      stopPicker();
      sendResponse({ success: true });
      break;

    case 'contextMenuPick':
      // Handle right-click context menu selection
      if (message.selectionText) {
        // Find element containing selected text
        const selection = window.getSelection();
        if (selection && selection.rangeCount > 0) {
          const range = selection.getRangeAt(0);
          const element = range.startContainer.parentElement;
          if (element) {
            const selectedElement: SelectedElement = {
              selector: generateSelector(element),
              value: message.selectionText,
              tagName: element.tagName.toLowerCase(),
            };
            chrome.runtime.sendMessage({
              action: 'elementSelected',
              element: selectedElement,
            });
          }
        }
      }
      sendResponse({ success: true });
      break;

    case 'highlightElement':
      // Highlight a specific element (for debugging/preview)
      if (message.selector) {
        try {
          const element = document.querySelector(message.selector);
          if (element) {
            injectStyles();
            createHighlight();
            updateHighlight(element);

            // Remove after 3 seconds
            setTimeout(() => {
              removeHighlight();
            }, 3000);
          }
        } catch (error) {
          console.error('Invalid selector:', message.selector);
        }
      }
      sendResponse({ success: true });
      break;

    case 'extractValue':
      // Extract current value of an element
      if (message.selector) {
        try {
          const element = document.querySelector(message.selector);
          const value = element ? getElementValue(element) : null;
          sendResponse({ success: true, value });
        } catch (error) {
          sendResponse({ success: false, error: 'Invalid selector' });
        }
      }
      break;

    default:
      sendResponse({ success: false, error: 'Unknown action' });
  }

  return true; // Keep channel open for async response
});

// Clean up on page unload
window.addEventListener('beforeunload', () => {
  stopPicker();
});

console.log('Sentinel content script loaded');

export {};
