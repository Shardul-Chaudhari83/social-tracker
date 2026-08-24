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

  let samples = {};

  // Check MCP Server status
  checkMcpStatus();

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
