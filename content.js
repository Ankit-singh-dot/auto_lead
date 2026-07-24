/*
 * content.js — Content Script
 * 
 * Runs in the LinkedIn page context (content script sandbox).
 * 
 * Handles:
 * - Deep DOM scanning for email addresses in post text
 * - MutationObserver for dynamically loaded content (infinite scroll)
 * - Extracting context: poster name, post snippet
 * - Injecting inject.js into the page context
 * - Receiving emails from inject.js via window.postMessage
 * - Forwarding all found emails to background.js
 */

(function () {
  'use strict';

  // ─── Email Regex ─────────────────────────────────────────────────────────

  const EMAIL_REGEX = /(?:[a-zA-Z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-zA-Z0-9!#$%&'*+/=?^_`{|}~-]+)*@(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?\.)+[a-zA-Z]{2,})/g;

  // Obfuscated email patterns people use to avoid scraping
  // e.g., "user [at] domain [dot] com", "user(at)domain(dot)com"
  const OBFUSCATED_AT = /\s*[\[\(]\s*(?:at|AT|@)\s*[\]\)]\s*/g;
  const OBFUSCATED_DOT = /\s*[\[\(]\s*(?:dot|DOT|\.)\s*[\]\)]\s*/g;
  const SPACED_AT = /\s+at\s+/gi;
  const SPACED_DOT = /\s+dot\s+/gi;

  const IGNORE_PATTERNS = [
    /.*@linkedin\.com$/i,
    /.*@licdn\.com$/i,
    /.*@static\.com$/i,
    /.*\.png$/i,
    /.*\.jpg$/i,
    /.*\.jpeg$/i,
    /.*\.gif$/i,
    /.*\.svg$/i,
    /.*\.webp$/i,
    /noreply@/i,
    /no-reply@/i,
    /notifications@/i,
    /mailer-daemon@/i,
    /.*@sentry\.io$/i,
    /.*@sentry-next\.wixpress\.com$/i
  ];

  // ─── State ───────────────────────────────────────────────────────────────

  let isScrapingActive = false;
  let scannedTexts = new Set(); // Avoid re-scanning same text blocks
  let foundEmailsSet = new Set(); // Track already-found emails
  let observer = null;
  let scanInterval = null;

  // ─── Helpers ─────────────────────────────────────────────────────────────

  /**
   * Normalize obfuscated emails
   */
  function deobfuscateText(text) {
    return text
      .replace(OBFUSCATED_AT, '@')
      .replace(OBFUSCATED_DOT, '.')
      .replace(SPACED_AT, '@')
      .replace(SPACED_DOT, '.');
  }

  /**
   * Extract emails from text, including obfuscated forms
   */
  function extractEmails(text) {
    if (!text || typeof text !== 'string') return [];

    // Also try deobfuscated version
    const combined = text + '\n' + deobfuscateText(text);
    const matches = combined.match(EMAIL_REGEX);
    if (!matches) return [];

    return [...new Set(matches)].filter(email => {
      return !IGNORE_PATTERNS.some(pattern => pattern.test(email));
    });
  }

  /**
   * Get poster name from a post element
   */
  function getPosterName(postElement) {
    // LinkedIn uses various selectors for poster names
    const nameSelectors = [
      '.update-components-actor__name .visually-hidden',
      '.update-components-actor__name',
      '.feed-shared-actor__name .visually-hidden',
      '.feed-shared-actor__name',
      '.update-components-actor__title .visually-hidden',
      '.update-components-actor__title',
      'a.app-aware-link span[aria-hidden="true"]',
      '.feed-shared-actor__title span[aria-hidden="true"]',
      // Search results specific
      '.entity-result__title-text a span[aria-hidden="true"]',
      '.update-components-actor__meta-link span',
      // General fallbacks
      '.feed-shared-header__text-view span',
      '.update-components-text-view span'
    ];

    for (const sel of nameSelectors) {
      const el = postElement.querySelector(sel);
      if (el) {
        const name = el.textContent.trim();
        if (name && name.length > 1 && name.length < 100) {
          return name;
        }
      }
    }

    return '';
  }

  /**
   * Get a text snippet from a post element
   */
  function getPostSnippet(postElement) {
    const textSelectors = [
      '.feed-shared-update-v2__description',
      '.update-components-text',
      '.feed-shared-text',
      '.break-words',
      '.update-components-update-v2__commentary',
      // Search results
      '.update-components-text__text-view',
      '.feed-shared-inline-show-more-text'
    ];

    for (const sel of textSelectors) {
      const el = postElement.querySelector(sel);
      if (el) {
        const text = el.textContent.trim();
        if (text.length > 10) {
          return text.substring(0, 200) + (text.length > 200 ? '...' : '');
        }
      }
    }

    return '';
  }

  /**
   * Send emails to background script
   */
  function reportEmails(emailEntries) {
    if (emailEntries.length === 0) return;

    // Filter out already found
    const newEntries = emailEntries.filter(e => {
      const key = e.email.toLowerCase();
      if (foundEmailsSet.has(key)) return false;
      foundEmailsSet.add(key);
      return true;
    });

    if (newEntries.length === 0) return;

    console.log(`[LinkedIn Scraper] Sending ${newEntries.length} new email(s) to background`);

    chrome.runtime.sendMessage({
      type: 'EMAILS_FOUND',
      emails: newEntries
    }).catch(() => {});
  }

  // ─── DOM Scanning ────────────────────────────────────────────────────────

  /**
   * Scan a specific DOM element for emails
   */
  function scanElement(element) {
    if (!isScrapingActive) return;

    const text = element.textContent || '';
    if (text.length < 5) return;

    // Create a hash to avoid re-scanning
    const hash = text.substring(0, 100) + text.length;
    if (scannedTexts.has(hash)) return;
    scannedTexts.add(hash);

    const emails = extractEmails(text);
    if (emails.length === 0) return;

    // Try to find context
    const postElement = element.closest(
      '.feed-shared-update-v2, .occludable-update, .search-results__result-item, ' +
      '.reusable-search__result-container, .update-components-actor, ' +
      '[data-urn], .scaffold-finite-scroll__content > div'
    ) || element;

    const posterName = getPosterName(postElement);
    const snippet = getPostSnippet(postElement);

    const entries = emails.map(email => ({
      email,
      source: 'dom',
      context: snippet,
      posterName: posterName,
      timestamp: new Date().toISOString()
    }));

    reportEmails(entries);
  }

  /**
   * Full page scan — walks through all relevant DOM elements
   */
  function fullPageScan() {
    if (!isScrapingActive) return;

    // Target post containers and text elements
    const selectors = [
      // Feed posts
      '.feed-shared-update-v2',
      '.occludable-update',
      // Search results
      '.reusable-search__result-container',
      '.search-results__result-item',
      // Post text
      '.feed-shared-text',
      '.update-components-text',
      '.break-words',
      // Comments
      '.comments-comment-item__main-content',
      '.comments-comment-texteditor',
      // Articles
      '.feed-shared-article',
      // Any element with text that might contain emails
      '.update-components-update-v2__commentary',
      '.feed-shared-inline-show-more-text',
      // Profile sections in posts
      '.update-components-actor__description',
      '.update-components-actor__sub-description'
    ];

    const elements = document.querySelectorAll(selectors.join(', '));
    elements.forEach(el => scanElement(el));

    // Also do a brute-force scan of all text nodes in the main content area
    const mainContent = document.querySelector('.scaffold-layout__main') ||
      document.querySelector('.search-results-container') ||
      document.querySelector('#main') ||
      document.body;

    const walker = document.createTreeWalker(
      mainContent,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode: function (node) {
          const text = node.textContent.trim();
          if (text.length < 5) return NodeFilter.FILTER_REJECT;
          if (text.includes('@') || text.toLowerCase().includes(' at ')) {
            return NodeFilter.FILTER_ACCEPT;
          }
          return NodeFilter.FILTER_REJECT;
        }
      }
    );

    while (walker.nextNode()) {
      const textNode = walker.currentNode;
      const text = textNode.textContent;
      const emails = extractEmails(text);

      if (emails.length > 0) {
        // Find the closest parent that gives us context
        const parent = textNode.parentElement;
        if (parent) {
          scanElement(parent);
        }
      }
    }

    // Scan mailto: links
    const mailtoLinks = document.querySelectorAll('a[href^="mailto:"]');
    mailtoLinks.forEach(link => {
      const email = link.href.replace('mailto:', '').split('?')[0].trim();
      if (email) {
        const postElement = link.closest('.feed-shared-update-v2, .occludable-update, [data-urn]') || link.parentElement;
        reportEmails([{
          email,
          source: 'mailto-link',
          context: getPostSnippet(postElement),
          posterName: getPosterName(postElement),
          timestamp: new Date().toISOString()
        }]);
      }
    });

    // Scan all href attributes for emails
    const allLinks = document.querySelectorAll('a[href]');
    allLinks.forEach(link => {
      const href = link.href || '';
      const emails = extractEmails(href);
      emails.forEach(email => {
        reportEmails([{
          email,
          source: 'link-href',
          context: link.textContent.trim().substring(0, 200),
          posterName: '',
          timestamp: new Date().toISOString()
        }]);
      });
    });

    // Scan data attributes and title attributes
    const allElements = mainContent.querySelectorAll('*');
    allElements.forEach(el => {
      // Check title, alt, data-* attributes
      const attrs = ['title', 'alt', 'aria-label'];
      attrs.forEach(attr => {
        const val = el.getAttribute(attr);
        if (val) {
          const emails = extractEmails(val);
          if (emails.length > 0) {
            reportEmails(emails.map(email => ({
              email,
              source: `attribute:${attr}`,
              context: val.substring(0, 200),
              posterName: '',
              timestamp: new Date().toISOString()
            })));
          }
        }
      });
    });
  }

  // ─── MutationObserver ────────────────────────────────────────────────────

  function startObserver() {
    if (observer) return;

    observer = new MutationObserver((mutations) => {
      if (!isScrapingActive) return;

      for (const mutation of mutations) {
        // Scan added nodes
        for (const node of mutation.addedNodes) {
          if (node.nodeType === Node.ELEMENT_NODE) {
            scanElement(node);
          }
        }
      }
    });

    const target = document.querySelector('.scaffold-layout__main') ||
      document.querySelector('#main') ||
      document.body;

    observer.observe(target, {
      childList: true,
      subtree: true
    });

    console.log('[LinkedIn Scraper] MutationObserver started');
  }

  function stopObserver() {
    if (observer) {
      observer.disconnect();
      observer = null;
      console.log('[LinkedIn Scraper] MutationObserver stopped');
    }
  }

  // ─── Periodic Scan ──────────────────────────────────────────────────────

  function startPeriodicScan() {
    if (scanInterval) return;
    // Scan every 3 seconds to catch lazy-loaded content
    scanInterval = setInterval(() => {
      if (isScrapingActive) {
        fullPageScan();
      }
    }, 3000);
  }

  function stopPeriodicScan() {
    if (scanInterval) {
      clearInterval(scanInterval);
      scanInterval = null;
    }
  }

  // ─── Scroll Detection ───────────────────────────────────────────────────

  let scrollTimeout;
  function onScroll() {
    if (!isScrapingActive) return;
    clearTimeout(scrollTimeout);
    scrollTimeout = setTimeout(() => {
      fullPageScan();
    }, 500);
  }

  // ─── Inject Page Script ──────────────────────────────────────────────────

  function injectPageScript() {
    try {
      const script = document.createElement('script');
      script.src = chrome.runtime.getURL('inject.js');
      script.onload = function () {
        this.remove();
      };
      (document.head || document.documentElement).appendChild(script);
      console.log('[LinkedIn Scraper] inject.js loaded into page context');
    } catch (e) {
      console.error('[LinkedIn Scraper] Failed to inject page script:', e);
    }
  }

  // ─── Listen for Messages from inject.js ──────────────────────────────────

  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    if (!event.data || event.data.type !== '__LINKEDIN_SCRAPER_EMAILS__') return;
    if (!isScrapingActive) return;

    // Forward emails from inject.js to background
    reportEmails(event.data.emails);
  });

  // ─── Listen for Messages from Background ─────────────────────────────────

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    switch (message.type) {
      case 'SCRAPING_STATE_CHANGED':
        isScrapingActive = message.isActive;
        if (isScrapingActive) {
          startScraping();
        } else {
          stopScraping();
        }
        sendResponse({ success: true });
        return false;

      case 'FORCE_SCAN':
        if (isScrapingActive) {
          fullPageScan();
        }
        sendResponse({ success: true });
        return false;
    }
  });

  // ─── Start / Stop ────────────────────────────────────────────────────────

  function startScraping() {
    console.log('[LinkedIn Scraper] Starting DOM scraping');
    isScrapingActive = true;
    injectPageScript();
    startObserver();
    startPeriodicScan();
    window.addEventListener('scroll', onScroll, { passive: true });
    // Initial full scan
    fullPageScan();
  }

  function stopScraping() {
    console.log('[LinkedIn Scraper] Stopping DOM scraping');
    isScrapingActive = false;
    stopObserver();
    stopPeriodicScan();
    window.removeEventListener('scroll', onScroll);
  }

  // ─── Init ────────────────────────────────────────────────────────────────

  // Check if scraping is already active
  chrome.runtime.sendMessage({ type: 'GET_SCRAPING_STATE' }, (response) => {
    if (response && response.isActive) {
      startScraping();
    }
  });

  console.log('[LinkedIn Scraper] Content script loaded on:', window.location.href);
})();
