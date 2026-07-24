/*
 * inject.js — Page Context Script
 * 
 * This script runs in the actual page context (NOT content script sandbox).
 * This allows it to intercept real XMLHttpRequest and fetch calls made by
 * LinkedIn's own JavaScript, capturing API response bodies that may contain
 * email addresses.
 * 
 * Communication: Posts messages to content.js via window.postMessage
 */

(function () {
  'use strict';

  // Prevent double-injection
  if (window.__linkedinEmailScraperInjected) return;
  window.__linkedinEmailScraperInjected = true;

  // ─── Email Regex ─────────────────────────────────────────────────────────

  // Comprehensive email regex that catches common patterns
  const EMAIL_REGEX = /(?:[a-zA-Z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-zA-Z0-9!#$%&'*+/=?^_`{|}~-]+)*@(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?\.)+[a-zA-Z]{2,})/g;

  // Emails to ignore (LinkedIn system emails, image URLs, etc.)
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
    /mailer-daemon@/i
  ];

  /**
   * Extract valid emails from text
   */
  function extractEmails(text) {
    if (!text || typeof text !== 'string') return [];

    const matches = text.match(EMAIL_REGEX);
    if (!matches) return [];

    return [...new Set(matches)].filter(email => {
      return !IGNORE_PATTERNS.some(pattern => pattern.test(email));
    });
  }

  /**
   * Send found emails to content script
   */
  function reportEmails(emails, source) {
    if (emails.length === 0) return;

    window.postMessage({
      type: '__LINKEDIN_SCRAPER_EMAILS__',
      emails: emails.map(email => ({
        email: email,
        source: source,
        context: '',
        posterName: '',
        timestamp: new Date().toISOString()
      }))
    }, '*');
  }

  /**
   * Safely try to parse and scan response text
   */
  function scanResponseText(text, url) {
    try {
      const emails = extractEmails(text);
      if (emails.length > 0) {
        console.log(`[LinkedIn Scraper] Found ${emails.length} email(s) in network response: ${url}`);
        reportEmails(emails, `network:${new URL(url).pathname}`);
      }
    } catch (e) {
      // Silently ignore parsing errors
    }
  }

  // ─── XMLHttpRequest Interception ─────────────────────────────────────────

  const OriginalXHR = window.XMLHttpRequest;
  const originalOpen = OriginalXHR.prototype.open;
  const originalSend = OriginalXHR.prototype.send;

  OriginalXHR.prototype.open = function (method, url, ...args) {
    this.__scraperUrl = url;
    this.__scraperMethod = method;
    return originalOpen.call(this, method, url, ...args);
  };

  OriginalXHR.prototype.send = function (body) {
    this.addEventListener('load', function () {
      try {
        // Only scan responses from LinkedIn domains
        const url = this.__scraperUrl || '';
        if (typeof url === 'string' && (
          url.includes('linkedin.com') ||
          url.startsWith('/') // relative URLs
        )) {
          const text = this.responseText;
          if (text) {
            scanResponseText(text, url.startsWith('/') ? `https://www.linkedin.com${url}` : url);
          }
        }
      } catch (e) {
        // Silently ignore
      }
    });

    // Also scan the request body for any email being sent
    if (body && typeof body === 'string') {
      const emails = extractEmails(body);
      if (emails.length > 0) {
        reportEmails(emails, 'xhr-request-body');
      }
    }

    return originalSend.call(this, body);
  };

  // ─── Fetch Interception ──────────────────────────────────────────────────

  const originalFetch = window.fetch;

  window.fetch = async function (input, init) {
    const response = await originalFetch.call(this, input, init);

    try {
      const url = typeof input === 'string' ? input : (input instanceof Request ? input.url : '');

      if (url.includes('linkedin.com') || url.startsWith('/')) {
        // Clone the response so the original can still be consumed
        const clone = response.clone();

        // Read the clone asynchronously — don't block the original fetch
        clone.text().then(text => {
          const fullUrl = url.startsWith('/') ? `https://www.linkedin.com${url}` : url;
          scanResponseText(text, fullUrl);
        }).catch(() => {});
      }
    } catch (e) {
      // Silently ignore
    }

    return response;
  };

  // ─── Console Interception ────────────────────────────────────────────────

  const originalConsoleLog = console.log;
  const originalConsoleInfo = console.info;
  const originalConsoleDebug = console.debug;
  const originalConsoleWarn = console.warn;

  function interceptConsole(originalFn) {
    return function (...args) {
      // Scan console output for emails
      try {
        const text = args.map(a => {
          if (typeof a === 'string') return a;
          try { return JSON.stringify(a); } catch (e) { return String(a); }
        }).join(' ');

        const emails = extractEmails(text);
        if (emails.length > 0) {
          reportEmails(emails, 'console');
        }
      } catch (e) {
        // Silently ignore
      }

      return originalFn.apply(console, args);
    };
  }

  console.log = interceptConsole(originalConsoleLog);
  console.info = interceptConsole(originalConsoleInfo);
  console.debug = interceptConsole(originalConsoleDebug);
  console.warn = interceptConsole(originalConsoleWarn);

  // ─── WebSocket Interception ──────────────────────────────────────────────

  const OriginalWebSocket = window.WebSocket;

  if (OriginalWebSocket) {
    window.WebSocket = function (...args) {
      const ws = new OriginalWebSocket(...args);

      ws.addEventListener('message', function (event) {
        try {
          const data = typeof event.data === 'string' ? event.data : '';
          if (data) {
            const emails = extractEmails(data);
            if (emails.length > 0) {
              reportEmails(emails, 'websocket');
            }
          }
        } catch (e) {
          // Silently ignore
        }
      });

      return ws;
    };

    // Copy static properties
    window.WebSocket.prototype = OriginalWebSocket.prototype;
    window.WebSocket.CONNECTING = OriginalWebSocket.CONNECTING;
    window.WebSocket.OPEN = OriginalWebSocket.OPEN;
    window.WebSocket.CLOSING = OriginalWebSocket.CLOSING;
    window.WebSocket.CLOSED = OriginalWebSocket.CLOSED;
  }

  console.log('[LinkedIn Scraper] Page context hooks installed (XHR, Fetch, Console, WebSocket)');
})();
