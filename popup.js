/*
 * popup.js — Popup Script
 * 
 * Handles:
 * - Scraper tab (loading emails, CSV export, start/stop)
 * - Sender tab (SMTP settings, composed email, bulk/selective sending)
 * - API communication with local Node.js server
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

  const serverWarning = document.getElementById('serverWarning');
  
  const smtpPreset = document.getElementById('smtpPreset');
  const smtpHost = document.getElementById('smtpHost');
  const smtpPort = document.getElementById('smtpPort');
  const smtpSecure = document.getElementById('smtpSecure');
  const smtpUser = document.getElementById('smtpUser');
  const smtpPass = document.getElementById('smtpPass');
  const senderName = document.getElementById('senderName');
  const testSmtpBtn = document.getElementById('testSmtpBtn');
  const smtpTestResult = document.getElementById('smtpTestResult');

  const emailSubject = document.getElementById('emailSubject');
  const emailBody = document.getElementById('emailBody');
  const sendTargetRadios = document.getElementsByName('sendTarget');
  const selectedCountSpan = document.getElementById('selectedCount');
  const allCountSpan = document.getElementById('allCount');
  const sendDelay = document.getElementById('sendDelay');
  
  const sendBtn = document.getElementById('sendBtn');
  const cancelSendBtn = document.getElementById('cancelSendBtn');
  const progressContainer = document.getElementById('sendProgressContainer');
  const progressText = document.getElementById('progressText');
  const progressStats = document.getElementById('progressStats');
  const progressBar = document.getElementById('progressBar');
  const resultsLog = document.getElementById('resultsLog');

  // ─── State ───────────────────────────────────────────────────────────────

  let emails = [];
  let isActive = false;
  let API_URL = 'http://localhost:3847';
  let progressPollInterval = null;

  // ─── Init ────────────────────────────────────────────────────────────────

  async function init() {
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

    // Load emails and SMTP settings
    loadEmails();
    loadSmtpSettings();
    checkServerStatus();

    // Check server status periodically
    setInterval(checkServerStatus, 5000);
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
    const hasConfig = smtpHost.value && smtpPort.value && smtpUser.value && smtpPass.value;
    const hasEmail = emailSubject.value;

    sendBtn.disabled = !(hasTargets && hasConfig && hasEmail && serverWarning.classList.contains('hidden'));
  }

  // Bind inputs to validation
  [smtpHost, smtpPort, smtpUser, smtpPass, emailSubject].forEach(el => {
    el.addEventListener('input', updateSenderCounts);
  });
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

  // Export CSV & Clear (keeping from original)
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


  // ─── Sender Tab Logic ──────────────────────────────────────────────────

  const SMTP_PRESETS = {
    gmail: { host: 'smtp.gmail.com', port: 587, secure: false },
    outlook: { host: 'smtp-mail.outlook.com', port: 587, secure: false },
    yahoo: { host: 'smtp.mail.yahoo.com', port: 465, secure: true }
  };

  smtpPreset.addEventListener('change', () => {
    const preset = SMTP_PRESETS[smtpPreset.value];
    if (preset) {
      smtpHost.value = preset.host;
      smtpPort.value = preset.port;
      smtpSecure.checked = preset.secure;
      saveSmtpSettings();
      updateSenderCounts();
    }
  });

  function loadSmtpSettings() {
    chrome.runtime.sendMessage({ type: 'GET_SMTP_SETTINGS' }, (response) => {
      if (response && response.settings) {
        const s = response.settings;
        smtpPreset.value = s.preset || 'custom';
        smtpHost.value = s.host || '';
        smtpPort.value = s.port || '';
        smtpSecure.checked = s.secure || false;
        smtpUser.value = s.user || '';
        smtpPass.value = s.pass || '';
        senderName.value = s.senderName || '';
        emailSubject.value = s.subject || '';
        emailBody.value = s.body || '';
        updateSenderCounts();
      }
    });
  }

  function saveSmtpSettings() {
    chrome.runtime.sendMessage({
      type: 'SAVE_SMTP_SETTINGS',
      settings: {
        preset: smtpPreset.value,
        host: smtpHost.value,
        port: smtpPort.value,
        secure: smtpSecure.checked,
        user: smtpUser.value,
        pass: smtpPass.value,
        senderName: senderName.value,
        subject: emailSubject.value,
        body: emailBody.value
      }
    });
  }

  // Save on input
  [smtpHost, smtpPort, smtpSecure, smtpUser, smtpPass, senderName, emailSubject, emailBody].forEach(el => {
    el.addEventListener('change', saveSmtpSettings);
  });

  function getSmtpConfig() {
    return {
      host: smtpHost.value,
      port: Number(smtpPort.value),
      secure: smtpSecure.checked,
      user: smtpUser.value,
      pass: smtpPass.value
    };
  }

  function showMessage(el, text, isSuccess) {
    el.textContent = text;
    el.className = `form-message ${isSuccess ? 'success' : 'error'}`;
    setTimeout(() => { el.style.display = 'none'; }, 5000);
  }

  // Server API calls
  async function checkServerStatus() {
    try {
      const res = await fetch(`${API_URL}/status`);
      if (res.ok) {
        serverWarning.classList.add('hidden');
        const data = await res.json();
        if (data.bulk && data.bulk.status === 'sending') {
          showProgressUI();
          updateProgressUI(data.bulk);
          startProgressPolling();
        }
      }
    } catch (e) {
      serverWarning.classList.remove('hidden');
      sendBtn.disabled = true;
    }
  }

  testSmtpBtn.addEventListener('click', async () => {
    testSmtpBtn.disabled = true;
    testSmtpBtn.textContent = 'Testing...';
    try {
      const res = await fetch(`${API_URL}/test-connection`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(getSmtpConfig())
      });
      const data = await res.json();
      showMessage(smtpTestResult, data.message, data.success);
    } catch (e) {
      showMessage(smtpTestResult, 'Server error: ' + e.message, false);
    } finally {
      testSmtpBtn.disabled = false;
      testSmtpBtn.textContent = 'Test Connection';
    }
  });

  // Bulk Sending
  sendBtn.addEventListener('click', async () => {
    const target = document.querySelector('input[name="sendTarget"]:checked').value;
    const recipients = target === 'all' 
      ? emails.map(e => e.email) 
      : Array.from(getSelectedEmails());

    if (recipients.length === 0) return;
    if (!confirm(`Ready to send ${recipients.length} emails?`)) return;

    const payload = {
      smtp: getSmtpConfig(),
      email: {
        to: 'ignored_in_bulk',
        subject: emailSubject.value,
        body: emailBody.value,
        senderName: senderName.value,
        html: emailBody.value.includes('<')
      },
      recipients: recipients,
      delayMs: Number(sendDelay.value)
    };

    try {
      sendBtn.disabled = true;
      const res = await fetch(`${API_URL}/send-bulk`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      
      const data = await res.json();
      if (data.success) {
        showProgressUI();
        startProgressPolling();
      } else {
        alert(data.message);
        sendBtn.disabled = false;
      }
    } catch (e) {
      alert('Error starting send: ' + e.message);
      sendBtn.disabled = false;
    }
  });

  cancelSendBtn.addEventListener('click', async () => {
    try {
      await fetch(`${API_URL}/cancel`, { method: 'POST' });
      cancelSendBtn.disabled = true;
      cancelSendBtn.textContent = 'Cancelling...';
    } catch (e) {
      console.error('Cancel failed', e);
    }
  });

  function showProgressUI() {
    progressContainer.classList.remove('hidden');
    sendBtn.classList.add('hidden');
    cancelSendBtn.classList.remove('hidden');
    cancelSendBtn.disabled = false;
    cancelSendBtn.textContent = 'Cancel';
    resultsLog.innerHTML = '';
  }

  function hideProgressUI() {
    sendBtn.classList.remove('hidden');
    cancelSendBtn.classList.add('hidden');
    updateSenderCounts();
  }

  function startProgressPolling() {
    if (progressPollInterval) clearInterval(progressPollInterval);
    
    progressPollInterval = setInterval(async () => {
      try {
        const res = await fetch(`${API_URL}/status`);
        if (res.ok) {
          const data = await res.json();
          updateProgressUI(data.bulk);
          
          if (['done', 'cancelled'].includes(data.bulk.status)) {
            clearInterval(progressPollInterval);
            setTimeout(hideProgressUI, 2000);
          }
        }
      } catch (e) {
        console.error('Polling error', e);
      }
    }, 1000);
  }

  function updateProgressUI(bulk) {
    if (!bulk) return;
    
    const pct = bulk.total > 0 ? Math.round(((bulk.sent + bulk.failed) / bulk.total) * 100) : 0;
    progressBar.style.width = `${pct}%`;
    progressStats.textContent = `${bulk.sent + bulk.failed}/${bulk.total}`;
    
    if (bulk.status === 'sending') {
      progressText.textContent = `Sending to: ${bulk.current}...`;
    } else if (bulk.status === 'done') {
      progressText.textContent = `Complete! Sent: ${bulk.sent}, Failed: ${bulk.failed}`;
      progressBar.style.background = '#22c55e';
    } else if (bulk.status === 'cancelled') {
      progressText.textContent = `Cancelled. Sent: ${bulk.sent}`;
      progressBar.style.background = '#f59e0b';
    }

    // Update log
    if (bulk.results && bulk.results.length > 0) {
      const logs = bulk.results.map(r => 
        `<div class="${r.success ? 'log-success' : 'log-error'}">[${r.timestamp.split('T')[1].split('.')[0]}] ${r.success ? '✓' : '✗'} ${r.to}${r.success ? '' : ' - ' + r.message}</div>`
      );
      resultsLog.innerHTML = logs.reverse().join('');
    }
  }

  // ─── Start ──────────────────────────────────────────────────────────────
  init();
})();
