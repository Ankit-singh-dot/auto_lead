/*
 * popup.js — Popup Script
 * 
 * Handles:
 * - Scraper tab (loading emails, CSV export, start/stop)
 * - Sender tab (Mailto BCC logic with usage tracking)
 * - License tab (SHA-256 hashed master password verification)
 */

(function () {
  'use strict';

  // --- State ---
  let scrapedEmails = [];
  let isScanning = false;
  let activeTabId = null;
  let isPro = false;
  let freeSendsUsed = 0;
  const FREE_LIMIT = 2;

  // --- DOM Elements: Tabs & Scraper ---
  const tabBtns = document.querySelectorAll('.tab-btn');
  const tabContents = document.querySelectorAll('.tab-content');
  
  const toggleBtn = document.getElementById('toggleBtn');
  const exportBtn = document.getElementById('exportBtn');
  const clearBtn = document.getElementById('clearBtn');
  const emailCount = document.getElementById('emailCount');
  const statusDot = document.querySelector('.status-dot');
  const statusText = document.getElementById('statusText');
  const searchInput = document.getElementById('searchInput');
  const emailTableBody = document.getElementById('emailTableBody');
  const emailTable = document.getElementById('emailTable');
  const emptyState = document.getElementById('emptyState');
  const selectAllCheckbox = document.getElementById('selectAllCheckbox');

  // --- DOM Elements: Sender ---
  const emailSubject = document.getElementById('emailSubject');
  const emailBody = document.getElementById('emailBody');
  const sendTargetRadios = document.getElementsByName('sendTarget');
  const selectedCountSpan = document.getElementById('selectedCount');
  const allCountSpan = document.getElementById('allCount');
  
  const sendBtn = document.getElementById('sendBtn');
  const gmailBtn = document.getElementById('gmailBtn');
  const bccWarning = document.getElementById('bccWarning');
  const usageLimitWarning = document.getElementById('usageLimitWarning');
  
  // --- DOM Elements: License ---
  const upgradeUi = document.getElementById('upgradeUi');
  const proActiveUi = document.getElementById('proActiveUi');
  const licenseKeyInput = document.getElementById('licenseKeyInput');
  const verifyLicenseBtn = document.getElementById('verifyLicenseBtn');
  const licenseMessage = document.getElementById('licenseMessage');
  
  // SHA-256 hash of the master password (AUTO-LINKED-2410)
  const MASTER_HASH = "5a8201593978ba6c443a149543e54b5c73813bfaba7c89dc4d1a7820f1c94166";

  // ─── Initialization ─────────────────────────────────────────────────────

  async function init() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    activeTabId = tab.id;

    // Load stored state (pro status, usage count)
    chrome.storage.local.get(['isPro', 'freeSendsUsed'], (result) => {
      if (result.isPro) {
        isPro = true;
        upgradeUi.classList.add('hidden');
        proActiveUi.classList.remove('hidden');
      }
      if (result.freeSendsUsed) freeSendsUsed = result.freeSendsUsed;
      updateSenderUI();
    });

    // Tabs
    tabBtns.forEach(btn => {
      btn.addEventListener('click', () => switchTab(btn.dataset.tab));
    });

    // Check scraper state
    chrome.runtime.sendMessage({ type: 'GET_SCRAPING_STATE' }, (response) => {
      if (response) {
        isScanning = response.isActive;
        updateScraperUI();
      }
    });

    // Load emails
    loadEmails();
  }

  // ─── Tab Logic ──────────────────────────────────────────────────────────

  function switchTab(tabId) {
    tabBtns.forEach(btn => btn.classList.toggle('active', btn.dataset.tab === tabId));
    tabContents.forEach(content => content.classList.toggle('active', content.id === `tab-${tabId}`));
  }

  // ─── Scraper Tab Logic ──────────────────────────────────────────────────

  function loadEmails() {
    chrome.runtime.sendMessage({ type: 'GET_EMAILS' }, (response) => {
      if (response && response.emails) {
        const previouslySelected = new Set(getSelectedEmailsList());
        scrapedEmails = response.emails;
        renderTable(scrapedEmails, previouslySelected);
        updateCounts();
      }
    });
  }

  function renderTable(data, previouslySelected = new Set()) {
    emailTableBody.innerHTML = '';

    if (data.length === 0) {
      emailTable.classList.add('hidden');
      emptyState.classList.remove('hidden');
      return;
    }

    emailTable.classList.remove('hidden');
    emptyState.classList.add('hidden');

    data.forEach(entry => {
      const tr = document.createElement('tr');

      const tdCheck = document.createElement('td');
      tdCheck.className = 'checkbox-cell';
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.className = 'email-checkbox';
      checkbox.value = entry.email;
      checkbox.checked = previouslySelected.has(entry.email);
      checkbox.addEventListener('change', updateSenderUI);
      tdCheck.appendChild(checkbox);

      const tdEmail = document.createElement('td');
      tdEmail.textContent = entry.email;
      tdEmail.title = entry.email;

      const tdPoster = document.createElement('td');
      tdPoster.textContent = entry.posterName || '—';
      tdPoster.title = entry.context || entry.posterName || '';

      const tdSource = document.createElement('td');
      tdSource.textContent = entry.source || '—';

      tr.appendChild(tdCheck);
      tr.appendChild(tdEmail);
      tr.appendChild(tdPoster);
      tr.appendChild(tdSource);
      emailTableBody.appendChild(tr);
    });

    updateSenderUI();
  }

  function updateCounts() {
    emailCount.textContent = scrapedEmails.length;
    allCountSpan.textContent = scrapedEmails.length;
    exportBtn.disabled = scrapedEmails.length === 0;
    clearBtn.disabled = scrapedEmails.length === 0;
    updateSenderUI();
  }

  selectAllCheckbox.addEventListener('change', (e) => {
    const checkboxes = document.querySelectorAll('.email-checkbox');
    checkboxes.forEach(cb => cb.checked = e.target.checked);
    updateSenderUI();
  });

  // ─── SHA-256 Hashing Helper ─────────────────────────────────────────────

  async function sha256(message) {
    const msgBuffer = new TextEncoder().encode(message);
    const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  }

  // ─── License Verification ──────────────────────────────────────────────

  verifyLicenseBtn.addEventListener('click', async () => {
    const key = licenseKeyInput.value.trim();
    if (!key) return;
    
    verifyLicenseBtn.textContent = 'Verifying...';
    verifyLicenseBtn.disabled = true;
    
    const inputHash = await sha256(key);
    
    if (inputHash === MASTER_HASH) {
      isPro = true;
      chrome.storage.local.set({ isPro: true });
      
      // Hide the upgrade form and show the success screen
      upgradeUi.classList.add('hidden');
      proActiveUi.classList.remove('hidden');
      
      updateSenderUI();
    } else {
      licenseMessage.textContent = '✗ Invalid Password. Please try again.';
      licenseMessage.className = 'form-message error';
      licenseMessage.classList.remove('hidden');
    }
    
    verifyLicenseBtn.textContent = 'Unlock Pro';
    verifyLicenseBtn.disabled = false;
  });

  // ─── Sender Logic (BCC Method) ─────────────────────────────────────────

  // Returns an array of selected email strings
  function getSelectedEmailsList() {
    const checkboxes = document.querySelectorAll('.email-checkbox:checked');
    return Array.from(checkboxes).map(cb => cb.value);
  }

  // Returns emails based on the radio button selection (selected or all)
  function getTargetEmails() {
    const target = document.querySelector('input[name="sendTarget"]:checked').value;
    if (target === 'all') {
      return scrapedEmails.map(e => e.email);
    }
    return getSelectedEmailsList();
  }

  function updateSenderUI() {
    const selectedCount = getSelectedEmailsList().length;
    const targetEmails = getTargetEmails();
    const count = targetEmails.length;
    
    // Update counts
    selectedCountSpan.textContent = selectedCount;
    allCountSpan.textContent = scrapedEmails.length;
    
    // Check if free limit is reached
    const limitReached = !isPro && freeSendsUsed >= FREE_LIMIT;

    // Enable/disable send buttons
    const hasSubject = emailSubject.value.trim().length > 0;
    if (count > 0 && hasSubject && !limitReached) {
      sendBtn.disabled = false;
      gmailBtn.disabled = false;
    } else {
      sendBtn.disabled = true;
      gmailBtn.disabled = true;
    }
    
    // Show/hide usage limit warning
    if (limitReached) {
      usageLimitWarning.classList.remove('hidden');
    } else {
      usageLimitWarning.classList.add('hidden');
    }

    // Show/hide BCC count warning
    if (count > 100) {
      bccWarning.classList.remove('hidden');
    } else {
      bccWarning.classList.add('hidden');
    }
  }

  // Increment the free usage counter
  function trackUsage() {
    if (!isPro) {
      freeSendsUsed++;
      chrome.storage.local.set({ freeSendsUsed: freeSendsUsed });
      updateSenderUI();
    }
  }

  function openEmailClient(isGmail) {
    const emails = getTargetEmails();
    if (emails.length === 0) return;
    
    // Final limit check before sending
    if (!isPro && freeSendsUsed >= FREE_LIMIT) {
      alert('You have reached your free limit (2 sends). Please upgrade to Pro in the License tab.');
      return;
    }

    const bccString = emails.join(',');
    const subject = encodeURIComponent(emailSubject.value.trim());
    const body = encodeURIComponent(emailBody.value.trim());

    let url = '';
    if (isGmail) {
      const bccEncoded = encodeURIComponent(bccString);
      url = `https://mail.google.com/mail/?view=cm&fs=1&tf=1&bcc=${bccEncoded}&su=${subject}&body=${body}`;
    } else {
      url = `mailto:?bcc=${bccString}&subject=${subject}&body=${body}`;
    }

    if (isGmail) {
      chrome.tabs.create({ url: url, active: true });
    } else {
      chrome.tabs.create({ url: url, active: true }, () => {
        // mailto will be handled by default mail client
      });
    }
    
    trackUsage();
    window.close();
  }

  sendBtn.addEventListener('click', () => openEmailClient(false));
  gmailBtn.addEventListener('click', () => openEmailClient(true));

  // Bind inputs to update sender UI validation
  emailSubject.addEventListener('input', updateSenderUI);
  Array.from(sendTargetRadios).forEach(r => r.addEventListener('change', updateSenderUI));

  // ─── Scraper Controls ──────────────────────────────────────────────────

  function updateScraperUI() {
    if (isScanning) {
      toggleBtn.textContent = 'Stop Scraping';
      toggleBtn.classList.add('active');
      statusDot.className = 'status-dot active';
      statusText.textContent = 'Scraping active — scroll through posts';
    } else {
      toggleBtn.textContent = 'Start Scraping';
      toggleBtn.classList.remove('active');
      statusDot.className = 'status-dot inactive';
      statusText.textContent = 'Inactive';
    }
  }

  toggleBtn.addEventListener('click', () => {
    isScanning = !isScanning;
    chrome.runtime.sendMessage({ type: 'SET_SCRAPING_STATE', isActive: isScanning });
    updateScraperUI();
  });

  // Export CSV
  exportBtn.addEventListener('click', () => {
    if (scrapedEmails.length === 0) return;
    const headers = ['Email', 'Poster Name', 'Source', 'Context', 'Timestamp'];
    const rows = scrapedEmails.map(e => [
      escapeCsvField(e.email), escapeCsvField(e.posterName || ''),
      escapeCsvField(e.source || ''), escapeCsvField(e.context || ''),
      escapeCsvField(e.timestamp || '')
    ]);
    const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `linkedin_emails_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  });

  function escapeCsvField(field) {
    if (!field) return '""';
    return `"${field.replace(/"/g, '""').replace(/\n/g, ' ')}"`;
  }

  clearBtn.addEventListener('click', () => {
    if (!confirm('Clear all scraped emails?')) return;
    chrome.runtime.sendMessage({ type: 'CLEAR_EMAILS' }, () => {
      scrapedEmails = [];
      renderTable([]);
      updateCounts();
    });
  });

  searchInput.addEventListener('input', () => {
    const query = searchInput.value.toLowerCase().trim();
    if (!query) {
      renderTable(scrapedEmails, new Set(getSelectedEmailsList()));
      return;
    }
    const filtered = scrapedEmails.filter(e =>
      e.email.toLowerCase().includes(query) ||
      (e.posterName && e.posterName.toLowerCase().includes(query)) ||
      (e.source && e.source.toLowerCase().includes(query))
    );
    renderTable(filtered, new Set(getSelectedEmailsList()));
  });

  // Auto-refresh emails while scraping
  setInterval(() => {
    if (document.getElementById('tab-scraper').classList.contains('active') && !searchInput.value) {
      loadEmails();
    }
  }, 2000);

  // ─── Start ──────────────────────────────────────────────────────────────
  init();
})();
