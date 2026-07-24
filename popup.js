/*
 * popup.js — Popup Script
 * 
 * Handles:
 * - Scraper tab (loading emails, CSV export, start/stop)
 * - Sender tab (Mailto BCC logic)
 */

(function () {
  'use strict';

  // ─── DOM Elements: Tabs & Scraper ───────────────────────────────────────
  
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

  // ─── DOM Elements: Sender ───────────────────────────────────────────────

  const emailSubject = document.getElementById('emailSubject');
  const emailBody = document.getElementById('emailBody');
  const sendTargetRadios = document.getElementsByName('sendTarget');
  const selectedCountSpan = document.getElementById('selectedCount');
  const allCountSpan = document.getElementById('allCount');
  
  const sendBtn = document.getElementById('sendBtn');
  const gmailBtn = document.getElementById('gmailBtn');
  const bccWarning = document.getElementById('bccWarning');

  // ─── State ───────────────────────────────────────────────────────────────

  let emails = [];
  let isActive = false;

  // ─── Init ────────────────────────────────────────────────────────────────

  function init() {
    // Tabs
    tabBtns.forEach(btn => {
      btn.addEventListener('click', () => switchTab(btn.dataset.tab));
    });

    // Scraper state
    chrome.runtime.sendMessage({ type: 'GET_SCRAPING_STATE' }, (response) => {
      if (response) {
        isActive = response.isActive;
        updateToggleUI();
      }
    });

    // Load emails
    loadEmails();
  }

  // ─── Tab Logic ─────────────────────────────────────────────────────────

  function switchTab(tabId) {
    tabBtns.forEach(btn => btn.classList.toggle('active', btn.dataset.tab === tabId));
    tabContents.forEach(content => content.classList.toggle('active', content.id === `tab-${tabId}`));
  }

  // ─── Scraper Tab Logic ─────────────────────────────────────────────────

  function loadEmails() {
    chrome.runtime.sendMessage({ type: 'GET_EMAILS' }, (response) => {
      if (response && response.emails) {
        // Keep selection state if already loaded
        const selectedEmails = getSelectedEmails();
        emails = response.emails;
        renderTable(emails, selectedEmails);
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

      // Checkbox
      const tdCheck = document.createElement('td');
      tdCheck.className = 'checkbox-cell';
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.className = 'email-checkbox';
      checkbox.value = entry.email;
      checkbox.checked = previouslySelected.has(entry.email);
      checkbox.addEventListener('change', updateSenderCounts);
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

    updateSenderCounts();
  }

  function updateCounts() {
    emailCount.textContent = emails.length;
    exportBtn.disabled = emails.length === 0;
    clearBtn.disabled = emails.length === 0;
    updateSenderCounts();
  }

  selectAllCheckbox.addEventListener('change', (e) => {
    const checkboxes = document.querySelectorAll('.email-checkbox');
    checkboxes.forEach(cb => cb.checked = e.target.checked);
    updateSenderCounts();
  });

  function getSelectedEmails() {
    const checkboxes = document.querySelectorAll('.email-checkbox:checked');
    return new Set(Array.from(checkboxes).map(cb => cb.value));
  }

  function updateSenderCounts() {
    const total = emails.length;
    const selected = getSelectedEmails().size;
    allCountSpan.textContent = total;
    selectedCountSpan.textContent = selected;
    
    const targetSelected = document.querySelector('input[name="sendTarget"]:checked').value;
    const hasTargets = targetSelected === 'all' ? total > 0 : selected > 0;
    const hasEmail = emailSubject.value;

    sendBtn.disabled = !(hasTargets && hasEmail);
    gmailBtn.disabled = !(hasTargets && hasEmail);
    
    // Show warning if trying to BCC too many people
    const targetCount = targetSelected === 'all' ? total : selected;
    if (targetCount > 100) {
      bccWarning.classList.remove('hidden');
    } else {
      bccWarning.classList.add('hidden');
    }
  }

  // Bind inputs to validation
  emailSubject.addEventListener('input', updateSenderCounts);
  Array.from(sendTargetRadios).forEach(r => r.addEventListener('change', updateSenderCounts));

  // Toggle Scraping
  function updateToggleUI() {
    if (isActive) {
      toggleBtn.textContent = 'Stop Scraping';
      toggleBtn.classList.add('active');
      statusDot.classList.remove('inactive');
      statusDot.classList.add('active');
      statusText.textContent = 'Scraping active — scroll through posts';
    } else {
      toggleBtn.textContent = 'Start Scraping';
      toggleBtn.classList.remove('active');
      statusDot.classList.remove('active');
      statusDot.classList.add('inactive');
      statusText.textContent = 'Inactive';
    }
  }

  toggleBtn.addEventListener('click', () => {
    isActive = !isActive;
    chrome.runtime.sendMessage({ type: 'SET_SCRAPING_STATE', isActive: isActive });
    updateToggleUI();
  });

  // Export CSV
  exportBtn.addEventListener('click', () => {
    if (emails.length === 0) return;
    const headers = ['Email', 'Poster Name', 'Source', 'Context', 'Timestamp'];
    const rows = emails.map(e => [
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
      emails = [];
      renderTable([]);
      updateCounts();
    });
  });

  searchInput.addEventListener('input', () => {
    const query = searchInput.value.toLowerCase().trim();
    if (!query) {
      renderTable(emails, getSelectedEmails());
      return;
    }
    const filtered = emails.filter(e =>
      e.email.toLowerCase().includes(query) ||
      (e.posterName && e.posterName.toLowerCase().includes(query)) ||
      (e.source && e.source.toLowerCase().includes(query))
    );
    renderTable(filtered, getSelectedEmails());
  });

  setInterval(() => {
    // Only auto-refresh if scraper tab is active and not searching
    if (document.getElementById('tab-scraper').classList.contains('active') && !searchInput.value) {
      loadEmails();
    }
  }, 2000);


  // ─── Sender Tab Logic (Mailto BCC) ─────────────────────────────────────

  sendBtn.addEventListener('click', () => {
    const target = document.querySelector('input[name="sendTarget"]:checked').value;
    const recipients = target === 'all' 
      ? emails.map(e => e.email) 
      : Array.from(getSelectedEmails());

    if (recipients.length === 0) return;

    // Construct Mailto link
    const subject = encodeURIComponent(emailSubject.value);
    const body = encodeURIComponent(emailBody.value);
    const bccList = recipients.join(',');

    // Create the mailto string
    // We leave the primary "to" field blank so recipients only see themselves in BCC
    const mailtoLink = `mailto:?bcc=${bccList}&subject=${subject}&body=${body}`;

    // Open it using Chrome's tabs API, which correctly routes to the default mail handler
    // whether it's a native app (like Apple Mail) or a web handler (like Gmail in Chrome)
    chrome.tabs.create({ url: mailtoLink, active: true }, (tab) => {
      // Some web handlers might leave an empty tab open after handling the mailto link,
      // but native handlers usually close it automatically or don't even open a visible tab.
      // We will close the popup to give a smooth experience.
      window.close();
    });
  });

  gmailBtn.addEventListener('click', () => {
    const target = document.querySelector('input[name="sendTarget"]:checked').value;
    const recipients = target === 'all' 
      ? emails.map(e => e.email) 
      : Array.from(getSelectedEmails());

    if (recipients.length === 0) return;

    // Construct Gmail Compose URL
    const subject = encodeURIComponent(emailSubject.value);
    const body = encodeURIComponent(emailBody.value);
    const bccList = encodeURIComponent(recipients.join(','));

    // view=cm (compose message), fs=1 (full screen mode)
    const gmailUrl = `https://mail.google.com/mail/?view=cm&fs=1&bcc=${bccList}&su=${subject}&body=${body}`;

    chrome.tabs.create({ url: gmailUrl, active: true }, (tab) => {
      window.close();
    });
  });

  // ─── Start ──────────────────────────────────────────────────────────────
  init();
})();
