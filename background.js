/*
 * background.js — Service Worker
 * 
 * Handles:
 * - Network request monitoring for LinkedIn API responses
 * - Central email storage management via chrome.storage.local
 * - Message passing between content scripts and popup
 */

// ─── Email Storage ───────────────────────────────────────────────────────────

const STORAGE_KEY = 'scraped_emails';

/**
 * Get all stored emails
 */
async function getStoredEmails() {
  const result = await chrome.storage.local.get(STORAGE_KEY);
  return result[STORAGE_KEY] || [];
}

/**
 * Save emails to storage, deduplicating by email address
 */
async function saveEmails(newEmails) {
  const existing = await getStoredEmails();
  const existingMap = new Map(existing.map(e => [e.email.toLowerCase(), e]));

  for (const entry of newEmails) {
    const key = entry.email.toLowerCase();
    if (!existingMap.has(key)) {
      existingMap.set(key, {
        email: entry.email,
        source: entry.source || 'unknown',
        context: entry.context || '',
        posterName: entry.posterName || '',
        timestamp: entry.timestamp || new Date().toISOString()
      });
    }
  }

  const allEmails = Array.from(existingMap.values());
  await chrome.storage.local.set({ [STORAGE_KEY]: allEmails });
  
  // Update badge with count
  updateBadge(allEmails.length);
  
  return allEmails;
}

/**
 * Clear all stored emails
 */
async function clearEmails() {
  await chrome.storage.local.set({ [STORAGE_KEY]: [] });
  updateBadge(0);
}

/**
 * Update the extension badge with email count
 */
function updateBadge(count) {
  const text = count > 0 ? String(count) : '';
  chrome.action.setBadgeText({ text });
  chrome.action.setBadgeBackgroundColor({ color: '#444444' });
}

// ─── Scraping State ──────────────────────────────────────────────────────────

let isScrapingActive = false;

// ─── Message Handling ────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message.type) {
    case 'EMAILS_FOUND':
      // Content script or inject script found emails
      saveEmails(message.emails).then(allEmails => {
        sendResponse({ success: true, totalCount: allEmails.length });
      });
      return true; // async response

    case 'GET_EMAILS':
      // Popup requesting all emails
      getStoredEmails().then(emails => {
        sendResponse({ emails });
      });
      return true;

    case 'CLEAR_EMAILS':
      clearEmails().then(() => {
        sendResponse({ success: true });
      });
      return true;

    case 'GET_SCRAPING_STATE':
      sendResponse({ isActive: isScrapingActive });
      return false;

    case 'SET_SCRAPING_STATE':
      isScrapingActive = message.isActive;
      // Notify all LinkedIn tabs about state change
      chrome.tabs.query({ url: 'https://www.linkedin.com/*' }, (tabs) => {
        tabs.forEach(tab => {
          chrome.tabs.sendMessage(tab.id, {
            type: 'SCRAPING_STATE_CHANGED',
            isActive: isScrapingActive
          }).catch(() => {});
        });
      });
      sendResponse({ success: true });
      return false;

    case 'GET_EMAIL_COUNT':
      getStoredEmails().then(emails => {
        sendResponse({ count: emails.length });
      });
      return true;

    case 'GET_SMTP_SETTINGS':
      chrome.storage.local.get('smtp_settings').then(result => {
        sendResponse({ settings: result.smtp_settings || null });
      });
      return true;

    case 'SAVE_SMTP_SETTINGS':
      chrome.storage.local.set({ smtp_settings: message.settings }).then(() => {
        sendResponse({ success: true });
      });
      return true;
  }
});

// ─── Network Request Monitoring ──────────────────────────────────────────────

// Monitor completed requests to LinkedIn API endpoints
// Note: In Manifest V3, we can't read response bodies directly from webRequest.
// The heavy lifting of response interception is done in inject.js (page context).
// Here we just track which API endpoints are being hit for debugging.

chrome.webRequest.onCompleted.addListener(
  (details) => {
    if (!isScrapingActive) return;

    // Log API calls that might contain emails
    const interestingPaths = [
      '/voyager/api/',
      '/search/results/',
      '/feed/',
      '/graphql',
      '/api/contentserving/'
    ];

    const isInteresting = interestingPaths.some(p => details.url.includes(p));
    if (isInteresting) {
      console.log('[LinkedIn Scraper] API call detected:', details.url);
    }
  },
  { urls: ['https://www.linkedin.com/*', 'https://*.linkedin.com/*'] }
);

// ─── Init ────────────────────────────────────────────────────────────────────

// Restore badge on startup
getStoredEmails().then(emails => {
  updateBadge(emails.length);
});

console.log('[LinkedIn Scraper] Background service worker initialized');
