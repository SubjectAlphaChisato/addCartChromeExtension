// Background service worker for Smart Cart Assistant
console.log('Smart Cart Assistant background script loaded');

// Handle extension installation
chrome.runtime.onInstalled.addListener((details) => {
    console.log('Extension installed/updated:', details.reason);
    
    // Set default settings
    chrome.storage.local.set({
        extensionEnabled: true,
        maxResults: 5,
        autoAddToCart: true
    });

    // Create context menu (optional)
    chrome.contextMenus.create({
        id: 'smartCartAssistant',
        title: 'Add to cart with Smart Cart Assistant',
        contexts: ['selection'],
        documentUrlPatterns: ['*://*.amazon.com/*']
    });
});

// Handle context menu clicks
chrome.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId === 'smartCartAssistant' && info.selectionText) {
        // Send selected text to popup for processing
        chrome.storage.local.set({
            selectedText: info.selectionText,
            fromContextMenu: true
        });
        
        // Open popup
        chrome.action.openPopup();
    }
});

// Handle messages from content scripts and popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    console.log('Background received message:', request);

    if (request.action === 'openaiRequest') {
        // Proxy OpenAI requests to avoid CORS issues
        handleOpenAIRequest(request.data)
            .then(response => sendResponse({ success: true, data: response }))
            .catch(error => sendResponse({ success: false, error: error.message }));
        return true; // Keep message channel open
    }

    if (request.action === 'logAnalytics') {
        // Log usage analytics (privacy-friendly)
        logUsageAnalytics(request.data);
        sendResponse({ success: true });
    }

    if (request.action === 'getTabInfo') {
        // Get current tab information
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (tabs[0]) {
                sendResponse({
                    success: true,
                    tab: {
                        url: tabs[0].url,
                        title: tabs[0].title,
                        isAmazon: tabs[0].url.includes('amazon.com')
                    }
                });
            } else {
                sendResponse({ success: false, error: 'No active tab' });
            }
        });
        return true;
    }
});

// Handle OpenAI API requests
async function handleOpenAIRequest(requestData) {
    try {
        const response = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${requestData.apiKey}`
            },
            body: JSON.stringify(requestData.payload)
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error?.message || 'OpenAI API error');
        }

        return await response.json();
    } catch (error) {
        console.error('OpenAI request error:', error);
        throw error;
    }
}

// Log usage analytics (privacy-friendly)
function logUsageAnalytics(data) {
    // Store basic usage statistics locally (no personal data)
    chrome.storage.local.get(['analytics'], (result) => {
        const analytics = result.analytics || {
            totalSearches: 0,
            successfulAdditions: 0,
            lastUsed: null,
            version: chrome.runtime.getManifest().version
        };

        if (data.type === 'search') {
            analytics.totalSearches++;
        } else if (data.type === 'addToCart' && data.success) {
            analytics.successfulAdditions++;
        }

        analytics.lastUsed = Date.now();

        chrome.storage.local.set({ analytics });
    });
}

// Handle tab updates to inject content script if needed
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.status === 'complete' && tab.url && tab.url.includes('amazon.com')) {
        console.log('Amazon page loaded, content script should be active');
    }
});

// Handle extension icon clicks
chrome.action.onClicked.addListener((tab) => {
    // This will open the popup automatically due to the manifest configuration
    console.log('Extension icon clicked');
});

// Periodic cleanup of old data
chrome.alarms.create('cleanup', { periodInMinutes: 60 * 24 }); // Daily cleanup

chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === 'cleanup') {
        cleanupOldData();
    }
});

function cleanupOldData() {
    chrome.storage.local.get(null, (items) => {
        const keysToRemove = [];
        const oneWeekAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);

        for (const [key, value] of Object.entries(items)) {
            // Remove old temporary data
            if (key.startsWith('temp_') && value.timestamp && value.timestamp < oneWeekAgo) {
                keysToRemove.push(key);
            }
        }

        if (keysToRemove.length > 0) {
            chrome.storage.local.remove(keysToRemove);
            console.log('Cleaned up old data:', keysToRemove);
        }
    });
}

// Error handling
chrome.runtime.onSuspend.addListener(() => {
    console.log('Background script suspending');
});

self.addEventListener('error', (event) => {
    console.error('Background script error:', event.error);
});

self.addEventListener('unhandledrejection', (event) => {
    console.error('Background script unhandled promise rejection:', event.reason);
});

console.log('Smart Cart Assistant background script initialized');
