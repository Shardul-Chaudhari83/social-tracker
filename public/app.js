document.addEventListener('DOMContentLoaded', () => {
  const emailInput = document.getElementById('emailInput');
  const btnProcess = document.getElementById('btnProcess');
  const btnSample1 = document.getElementById('btn-sample-1');
  const btnSample2 = document.getElementById('btn-sample-2');
  const btnFetchMcp = document.getElementById('btnFetchMcp');
  const mcpDrawer = document.getElementById('mcpDrawer');
  const btnCloseDrawer = document.getElementById('btnCloseDrawer');
  const mcpEmailList = document.getElementById('mcpEmailList');
  const mcpBadge = document.getElementById('mcpBadge');
  const mcpText = document.getElementById('mcpText');
  const btnClearLog = document.getElementById('btnClearLog');
  const logContainer = document.getElementById('logContainer');
  const tableBody = document.getElementById('tableBody');
  const itemCountBadge = document.getElementById('itemCountBadge');
  const statusIndicator = document.getElementById('statusIndicator');
  const remindersTableBody = document.getElementById('remindersTableBody');
  const reminderCountBadge = document.getElementById('reminderCountBadge');
  const btnRefreshReminders = document.getElementById('btnRefreshReminders');
  const aiSummaryBanner = document.getElementById('aiSummaryBanner');
  const aiSummaryText = document.getElementById('aiSummaryText');
  const btnUploadFile = document.getElementById('btnUploadFile');
  const fileUploadInput = document.getElementById('fileUploadInput');
  const contactForm = document.getElementById('contactForm');
  const contactName = document.getElementById('contactName');
  const contactEmail = document.getElementById('contactEmail');
  const contactTelegram = document.getElementById('contactTelegram');
  const contactPhone = document.getElementById('contactPhone');
  const contactsTableBody = document.getElementById('contactsTableBody');
  const contactCountBadge = document.getElementById('contactCountBadge');

  let samples = {};

  // Check MCP Server status
  checkMcpStatus();

  // Which integrations are actually configured (email/Telegram/WhatsApp/AI)
  checkSystemStatus();

  // Reminders dashboard
  loadReminders();
  btnRefreshReminders.addEventListener('click', loadReminders);

  // Contact directory
  loadContacts();

  async function loadReminders() {
    try {
      const res = await fetch('/api/reminders?limit=25');
      const data = await res.json();
      renderReminders(data.data || []);
    } catch (err) {
      console.error('Failed to load reminders:', err.message);
    }
  }

  function renderReminders(reminders) {
    if (!reminders || reminders.length === 0) {
      remindersTableBody.innerHTML = '<tr class="empty-row"><td colspan="6">No reminders yet. Process an email above to schedule some.</td></tr>';
      reminderCountBadge.textContent = '0 Active';
      return;
    }

    const activeStatuses = ['PENDING', 'MESSAGED', 'CALL_SCHEDULED'];
    const activeCount = reminders.filter(r => activeStatuses.includes(r.status)).length;
    reminderCountBadge.textContent = `${activeCount} Active`;

    remindersTableBody.innerHTML = '';
    reminders.forEach(r => {
      const row = document.createElement('tr');
      const dueDate = new Date(r.due_at);
      const dueLabel = isNaN(dueDate.getTime()) ? r.due_at : dueDate.toLocaleString();
      const hasContact = !!(r.contact_email || r.contact_telegram_chat_id || r.contact_phone);
      const contact = r.contact_email || r.contact_telegram_chat_id || r.contact_phone || 'No contact on file';
      const canSend = hasContact && !['RESOLVED', 'FAILED', 'SATISFIED'].includes(r.status);

      row.innerHTML = `
        <td><span class="owner-chip">${escapeHtml(r.recipient_name)}</span></td>
        <td>${escapeHtml(r.task_title)}</td>
        <td>${escapeHtml(dueLabel)}</td>
        <td>${escapeHtml(contact)}</td>
        <td><span class="reminder-status-pill status-${r.status.toLowerCase()}">${escapeHtml(r.status)}</span></td>
        <td class="actions-cell">
          <button type="button" class="btn-secondary btn-tiny btn-send-now" data-id="${r.id}" ${canSend ? '' : 'disabled title="No contact on file, or already resolved"'}>Send Now</button>
          <button type="button" class="btn-secondary btn-tiny btn-history" data-id="${r.id}">History</button>
        </td>
      `;
      remindersTableBody.appendChild(row);
    });

    remindersTableBody.querySelectorAll('.btn-send-now').forEach(btn => {
      btn.addEventListener('click', () => sendReminderNowUI(btn.dataset.id, btn));
    });
    remindersTableBody.querySelectorAll('.btn-history').forEach(btn => {
      btn.addEventListener('click', () => toggleHistory(btn.dataset.id, btn));
    });
  }

  async function sendReminderNowUI(reminderId, buttonEl) {
    buttonEl.disabled = true;
    buttonEl.textContent = 'Sending...';
    try {
      const res = await fetch(`/api/reminders/${reminderId}/send-now`, { method: 'POST' });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'Send failed');
      await loadReminders();
    } catch (err) {
      alert('Send failed: ' + err.message);
      buttonEl.disabled = false;
      buttonEl.textContent = 'Send Now';
    }
  }

  async function toggleHistory(reminderId, buttonEl) {
    const existingRow = document.getElementById(`history-row-${reminderId}`);
    if (existingRow) {
      existingRow.remove();
      buttonEl.textContent = 'History';
      return;
    }

    buttonEl.textContent = 'Loading...';
    try {
      const res = await fetch(`/api/reminders/${reminderId}`);
      const data = await res.json();
      const logs = (data.data && data.data.escalation_logs) || [];

      const logsHtml = logs.length > 0
        ? logs.map(l => `<div class="history-entry"><span class="history-time">${new Date(l.created_at).toLocaleString()}</span><span class="history-action">${escapeHtml(l.action_type)}</span></div>`).join('')
        : '<div class="history-entry">No actions logged yet.</div>';

      const row = document.createElement('tr');
      row.id = `history-row-${reminderId}`;
      row.className = 'history-row';
      row.innerHTML = `<td colspan="6"><div class="history-panel">${logsHtml}</div></td>`;

      buttonEl.closest('tr').after(row);
      buttonEl.textContent = 'Hide';
    } catch (err) {
      buttonEl.textContent = 'History';
      alert('Failed to load history: ' + err.message);
    }
  }

  // Contact Directory
  async function loadContacts() {
    try {
      const res = await fetch('/api/contacts');
      const data = await res.json();
      renderContacts(data.data || []);
    } catch (err) {
      console.error('Failed to load contacts:', err.message);
    }
  }

  function renderContacts(contacts) {
    contactCountBadge.textContent = `${contacts.length} Contact${contacts.length === 1 ? '' : 's'}`;

    if (contacts.length === 0) {
      contactsTableBody.innerHTML = '<tr class="empty-row"><td colspan="5">No contacts yet. Add one above.</td></tr>';
      return;
    }

    contactsTableBody.innerHTML = '';
    contacts.forEach(c => {
      const row = document.createElement('tr');
      row.innerHTML = `
        <td><span class="owner-chip">${escapeHtml(c.name)}</span></td>
        <td>${escapeHtml(c.email || '—')}</td>
        <td>${escapeHtml(c.telegram || '—')}</td>
        <td>${escapeHtml(c.phone || '—')}</td>
        <td><button type="button" class="btn-secondary btn-tiny btn-delete-contact" data-name="${escapeHtml(c.name)}">Delete</button></td>
      `;
      contactsTableBody.appendChild(row);
    });

    contactsTableBody.querySelectorAll('.btn-delete-contact').forEach(btn => {
      btn.addEventListener('click', () => deleteContact(btn.dataset.name));
    });
  }

  contactForm.addEventListener('submit', async e => {
    e.preventDefault();
    const name = contactName.value.trim();
    if (!name) return;

    try {
      const res = await fetch('/api/contacts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          email: contactEmail.value.trim() || null,
          telegram: contactTelegram.value.trim() || null,
          phone: contactPhone.value.trim() || null
        })
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'Failed to save contact');

      contactForm.reset();
      await loadContacts();
    } catch (err) {
      alert('Failed to save contact: ' + err.message);
    }
  });

  async function deleteContact(name) {
    if (!confirm(`Remove contact "${name}"?`)) return;
    try {
      const res = await fetch(`/api/contacts/${encodeURIComponent(name)}`, { method: 'DELETE' });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'Failed to delete contact');
      await loadContacts();
    } catch (err) {
      alert('Failed to delete contact: ' + err.message);
    }
  }

  async function checkMcpStatus() {
    try {
      const res = await fetch('/api/mcp/status');
      const data = await res.json();
      if (data.connected) {
        mcpBadge.classList.add('online');
        mcpText.textContent = `MCP Server Online (${data.server.name})`;
      } else {
        mcpBadge.classList.remove('online');
        mcpText.textContent = 'MCP Offline';
      }
    } catch (err) {
      mcpBadge.classList.remove('online');
      mcpText.textContent = 'MCP Connection Error';
    }
  }

  // Shows which channels (email/Telegram/WhatsApp) and the AI pipeline
  // are actually configured, so a viewer sees at a glance what's live.
  async function checkSystemStatus() {
    try {
      const res = await fetch('/api/system-status');
      const status = await res.json();

      setIntegrationPill('pill-email', status.email.configured, status.email.channel);
      setIntegrationPill('pill-telegram', status.telegram.configured, status.telegram.channel);
      setIntegrationPill(
        'pill-whatsapp',
        status.whatsapp.configured && status.whatsapp.templateConfigured,
        status.whatsapp.note
      );
      setIntegrationPill('pill-ai', status.ai.configured, status.ai.note);
    } catch (err) {
      console.error('Failed to load system status:', err.message);
    }
  }

  function setIntegrationPill(id, isOn, title) {
    const pill = document.getElementById(id);
    if (!pill) return;
    pill.classList.toggle('online', !!isOn);
    if (title) pill.title = title;
  }

  // File upload — reads the file client-side and drops it straight into
  // the same textarea the paste/MCP-fetch flows already use, so it goes
  // through the identical pipeline with zero backend changes.
  btnUploadFile.addEventListener('click', () => fileUploadInput.click());

  fileUploadInput.addEventListener('change', () => {
    const file = fileUploadInput.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      emailInput.value = reader.result;
      appendLog('System', 'mcp-event', `Loaded file "${file.name}" (${file.size} bytes) into the input.`);
      statusIndicator.textContent = 'File Loaded';
    };
    reader.onerror = () => alert('Failed to read file: ' + reader.error.message);
    reader.readAsText(file);
    fileUploadInput.value = ''; // allow re-selecting the same file later
  });

  // Fetch real emails via MCP Protocol tool
  btnFetchMcp.addEventListener('click', async () => {
    mcpDrawer.classList.remove('hidden');
    mcpEmailList.innerHTML = '<div class="loading-spinner">📡 Querying MCP Server via JSON-RPC 2.0...</div>';

    try {
      const res = await fetch('/api/mcp/emails');
      const data = await res.json();
      
      if (data.emails && data.emails.length > 0) {
        renderMcpEmailList(data.emails, data.provider, data.isRealLive);
      } else {
        mcpEmailList.innerHTML = '<div class="empty-msg">No emails retrieved from MCP server.</div>';
      }
    } catch (err) {
      mcpEmailList.innerHTML = `<div class="error-msg">Failed to query MCP server: ${err.message}</div>`;
    }
  });

  btnCloseDrawer.addEventListener('click', () => {
    mcpDrawer.classList.add('hidden');
  });

  function renderMcpEmailList(emails, providerInfo, isRealLive) {
    mcpEmailList.innerHTML = '';

    const statusHeader = document.createElement('div');
    statusHeader.className = 'mcp-provider-banner';
    statusHeader.innerHTML = `
      <span class="mcp-provider-label">Source: <strong>${escapeHtml(providerInfo || 'MCP Email Server')}</strong></span>
      ${isRealLive ? '<span class="live-pill">LIVE IMAP</span>' : '<span class="notice-pill">Enter App Password in .env to sync live Inbox</span>'}
    `;
    mcpEmailList.appendChild(statusHeader);

    emails.forEach(item => {
      const card = document.createElement('div');
      card.className = 'mcp-email-item';
      card.innerHTML = `
        <div class="mcp-item-header">
          <span class="mcp-from">${escapeHtml(item.from)}</span>
          <span class="mcp-date">${escapeHtml(item.date)}</span>
        </div>
        <div class="mcp-subject">📧 ${escapeHtml(item.subject)}</div>
      `;
      card.addEventListener('click', () => loadMcpEmailContent(item.id, true));
      mcpEmailList.appendChild(card);
    });
  }


  async function loadMcpEmailContent(emailId, autoRun = false) {
    try {
      statusIndicator.textContent = 'Fetching email content...';
      const res = await fetch(`/api/mcp/emails/${emailId}`);
      const data = await res.json();

      if (data.email && data.email.body) {
        emailInput.value = data.email.body;
        mcpDrawer.classList.add('hidden');
        appendLog('System', 'mcp-event', `Loaded real email via MCP Server ID: [${emailId}] Subject: "${data.email.subject || 'Real Email'}"`);
        statusIndicator.textContent = 'Real Email Loaded';
        if (autoRun) {
          startWorkflow();
        }
      }
    } catch (err) {
      alert('Error fetching full email content from MCP server: ' + err.message);
      statusIndicator.textContent = 'Error';
    }
  }

  // Auto-fetch latest real email from connected MCP Server on load
  async function loadInitialRealEmail() {
    try {
      statusIndicator.textContent = 'Loading live email...';
      const res = await fetch('/api/mcp/emails');
      const data = await res.json();
      if (data.emails && data.emails.length > 0) {
        // Load content of first real email from inbox
        const firstId = data.emails[0].id;
        await loadMcpEmailContent(firstId, false);
      }
    } catch (err) {
      console.log('Falling back to static samples:', err.message);
      statusIndicator.textContent = 'Ready';
    }
  }

  // Load samples from backend as fallback
  fetch('/api/samples')
    .then(res => res.json())
    .then(data => {
      samples = data;
      loadInitialRealEmail();
    })
    .catch(err => console.error('Failed to load samples:', err));

  btnSample1.addEventListener('click', () => {
    if (samples.messy_sprint) emailInput.value = samples.messy_sprint;
  });

  btnSample2.addEventListener('click', () => {
    if (samples.vague_launch) emailInput.value = samples.vague_launch;
  });

  btnClearLog.addEventListener('click', () => {
    logContainer.innerHTML = '<div class="log-placeholder"><p>Log cleared. Ready for next workflow run.</p></div>';
  });

  btnProcess.addEventListener('click', startWorkflow);

  async function startWorkflow() {
    const text = emailInput.value.trim();
    if (!text) {
      alert('Please enter or paste an email thread to process.');
      return;
    }

    // Reset UI state
    btnProcess.disabled = true;
    statusIndicator.textContent = 'Processing...';
    logContainer.innerHTML = ''; // clear previous logs
    tableBody.innerHTML = '<tr class="empty-row"><td colspan="5">Processing email thread through AI agent team...</td></tr>';
    itemCountBadge.textContent = '0 Items';
    aiSummaryBanner.hidden = true;

    try {
      const response = await fetch('/api/process-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ emailText: text })
      });

      if (!response.ok) {
        throw new Error(`Server returned HTTP ${response.status}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buffer = '';

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        
        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split('\n\n');
        buffer = events.pop(); // keep partial chunk

        for (const rawEvent of events) {
          if (!rawEvent.trim()) continue;
          
          let eventType = 'message';
          let dataStr = '';

          const lines = rawEvent.split('\n');
          for (const line of lines) {
            if (line.startsWith('event: ')) {
              eventType = line.slice(7).trim();
            } else if (line.startsWith('data: ')) {
              dataStr = line.slice(6).trim();
            }
          }

          if (dataStr) {
            try {
              const data = JSON.parse(dataStr);
              handleSSEEvent(eventType, data);
            } catch (e) {
              console.error('Failed to parse SSE JSON:', e, dataStr);
            }
          }
        }
      }

      statusIndicator.textContent = 'Completed';
    } catch (err) {
      console.error(err);
      appendLog('System', 'error', 'Error running workflow: ' + err.message);
      statusIndicator.textContent = 'Error';
    } finally {
      btnProcess.disabled = false;
    }
  }

  function handleSSEEvent(eventType, data) {
    if (eventType === 'status') {
      appendLog(data.agent, data.type, data.message);
    } else if (eventType === 'final-report') {
      appendLog(data.agent, data.type, data.message);
      renderTable(data.items);
      renderAiSummary(data.summary);
      loadReminders();
    } else if (eventType === 'error') {
      appendLog('System', 'error', data.message);
    }
  }

  function appendLog(agent, type, message) {
    // Remove placeholder if present
    const placeholder = logContainer.querySelector('.log-placeholder');
    if (placeholder) placeholder.remove();

    const entry = document.createElement('div');
    entry.className = `log-entry ${type || ''}`;

    const timestamp = new Date().toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });

    let agentColor = '#94a3b8';
    if (agent === 'Extraction Agent') agentColor = 'var(--agent-extraction)';
    else if (agent === 'Assignment Sub-Agent') agentColor = 'var(--agent-assignment)';
    else if (agent === 'QA Sub-Agent') agentColor = 'var(--agent-qa)';
    else if (agent === 'Report Agent') agentColor = 'var(--agent-report)';

    entry.innerHTML = `
      <span class="log-timestamp">[${timestamp}]</span>
      <span class="log-agent" style="color: ${agentColor}">${agent}</span>
      <span class="log-message">${escapeHtml(message)}</span>
    `;

    logContainer.appendChild(entry);
    logContainer.scrollTop = logContainer.scrollHeight;
  }

  function renderTable(items) {
    if (!items || items.length === 0) {
      tableBody.innerHTML = '<tr class="empty-row"><td colspan="5">No action items found.</td></tr>';
      itemCountBadge.textContent = '0 Items';
      return;
    }

    itemCountBadge.textContent = `${items.length} Items`;
    tableBody.innerHTML = '';

    items.forEach((item, index) => {
      const row = document.createElement('tr');

      const isVerified = item.status === 'Verified';
      const statusClass = isVerified ? 'verified' : 'human-review';
      const statusIcon = isVerified ? '✓' : '🚨';
      const statusText = isVerified ? 'Verified' : 'Needs Human Review';
      const tooltip = item.flagReason ? `title="${escapeHtml(item.flagReason)}"` : '';

      row.innerHTML = `
        <td><strong>${index + 1}</strong></td>
        <td>${escapeHtml(item.task)}</td>
        <td><span class="owner-chip">${escapeHtml(item.owner || 'Unassigned')}</span></td>
        <td>${escapeHtml(item.deadline || 'Unspecified')}</td>
        <td>
          <span class="status-pill ${statusClass}" ${tooltip}>
            ${statusIcon} ${statusText}
          </span>
        </td>
      `;

      tableBody.appendChild(row);
    });
  }

  function renderAiSummary(summary) {
    if (!summary) {
      aiSummaryBanner.hidden = true;
      return;
    }
    aiSummaryText.textContent = summary;
    aiSummaryBanner.hidden = false;
  }

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }
});
