require('dotenv').config();
const express = require('express');
const path = require('path');
const { fork } = require('child_process');

const { initDatabase } = require('./src/db/database');
const reminderRoutes = require('./src/routes/reminderRoutes');
const { callMcpTool, MCP_SERVER_URL } = require('./src/utils/mcpClient');
const { startScheduler } = require('./src/services/schedulerService');
const reminderService = require('./src/services/reminderService');
const { resolveDueDate } = require('./src/utils/deadlineResolver');
const { lookupContact } = require('./src/services/ownerDirectoryService');
const { runAgentPipeline } = require('./src/services/pipelineService');

// Initialize Persistence Layer (SQLite with WAL mode)
initDatabase();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Mount Automated Reminder Management System Routes
app.use('/api/reminders', reminderRoutes);

// Sample emails for instant live demo testing (Real-world project & account sync samples)
const SAMPLE_EMAILS = {
  messy_sprint: `From: Rahul Sharma <thenorthremembers179@gmail.com>
To: Lead Engineer <lead@techcorp.com>, DevOps Team <ops@techcorp.com>
Subject: Re: Production Release & Database Audit Sprint Tasks

Hey team,

Following up on our project status review today:

1. Rahul Sharma - please complete the user data migration script and verify database integrity by Friday 5:00 PM.
2. Ops Team - please update the SSL security certificates on the production load balancer by tomorrow 3:00 PM.
3. Design Lead - submit the updated UI wireframes for customer review before Thursday at 2:00 PM.
4. Also, someone needs to audit the server access logs for last month ASAP.
5. Please verify the API rate limiter configurations before the client demo.

Best regards,
Rahul Sharma`,

  vague_launch: `From: Operations Team <ops@enterprise-system.org>
To: thenorthremembers179@gmail.com
Subject: Post-Launch Operational Deliverables & Security Audit

Team - following up on system updates:

- Rahul Sharma: prepare the quarterly performance analysis report by tomorrow 5:00 PM.
- Infrastructure Team: set up real-time monitoring alerts for cloud storage usage within 24 hours.
- QA Lead: execute end-to-end regression tests for the authentication API by Friday 12:00 PM.
- Elena: update the user onboarding documentation section by Friday.
- Can someone verify why automated system notifications are landing in spam?`
};

app.get('/api/samples', (req, res) => {
  res.json(SAMPLE_EMAILS);
});

// MCP Status Endpoint
app.get('/api/mcp/status', async (req, res) => {
  try {
    const initRes = await fetch(MCP_SERVER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'initialize', id: 1 })
    });
    const data = await initRes.json();
    res.json({ connected: true, server: data.result });
  } catch (err) {
    res.json({ connected: false, error: err.message });
  }
});

// Fetch Real Emails from MCP Server Endpoint
app.get('/api/mcp/emails', async (req, res) => {
  try {
    const data = await callMcpTool('list_inbox_messages', { limit: 5 });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch emails from MCP Server: ' + err.message });
  }
});

// Get Specific Email Content from MCP Server Endpoint
app.get('/api/mcp/emails/:id', async (req, res) => {
  try {
    const data = await callMcpTool('get_email_content', { emailId: req.params.id });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: 'Failed to get email from MCP Server: ' + err.message });
  }
});

// Configure MCP Email Credentials Endpoint
app.post('/api/mcp/credentials', async (req, res) => {
  try {
    const { user, password, host } = req.body;
    const data = await callMcpTool('configure_email_credentials', { user, password, host });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: 'Failed to configure MCP credentials: ' + err.message });
  }
});


// SSE Pipeline Execution Endpoint
app.post('/api/process-email', async (req, res) => {
  const { emailText } = req.body;

  if (!emailText || typeof emailText !== 'string' || !emailText.trim()) {
    return res.status(400).json({ error: 'Email text is required' });
  }

  // Set SSE Headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const sendEvent = (type, data) => {
    res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  try {
    // Runs the shared Extraction -> Assignment -> QA -> Report Agent pipeline
    // (src/services/pipelineService.js), streaming each step out as an SSE
    // 'status' event with the small pacing delays the live log relies on.
    const { processedItems, groupedItems, aiSummary } = await runAgentPipeline(emailText, {
      onEvent: event => sendEvent('status', event),
      withDelays: true
    });

    // Persist verified items as reminders so the scheduler can act on them.
    // Items still flagged 'Needs Human Review' are surfaced in the tracker
    // but intentionally not scheduled — a human needs to fill the gaps first.
    let remindersCreated = 0;
    for (const item of processedItems) {
      if (item.status !== 'Verified') continue;

      const dueDate = resolveDueDate(item.deadline);
      const contact = lookupContact(item.owner);

      try {
        const reminder = reminderService.createReminder({
          source: 'email',
          recipient_name: item.owner,
          contact_email: contact.email,
          contact_phone: contact.phone,
          contact_telegram_chat_id: contact.telegram,
          task_title: item.task.length > 140 ? item.task.slice(0, 137) + '...' : item.task,
          task_details: item.rawSnippet,
          due_at: dueDate.toISOString(),
          status: 'PENDING'
        });

        item.reminderId = reminder.id;
        item.reminderDueAt = reminder.due_at;

        sendEvent('status', {
          agent: 'Report Agent',
          type: 'reminder-created',
          itemId: item.id,
          message: contact.email
            ? `📌 Reminder scheduled for "${item.owner}" — due ${reminder.due_at} (will notify ${contact.email})`
            : `📌 Reminder scheduled for "${item.owner}" — due ${reminder.due_at} (no contact on file — add one to src/config/owner-directory.json to enable auto-send)`,
          reminder
        });
        remindersCreated++;
      } catch (err) {
        console.error(`Failed to create reminder for item ${item.id}:`, err.message);
        sendEvent('status', {
          agent: 'Report Agent',
          type: 'reminder-error',
          itemId: item.id,
          message: `⚠️ Failed to schedule reminder for "${item.task}": ${err.message}`
        });
      }
    }
    sendEvent('final-report', {
      agent: 'Report Agent',
      type: 'report-complete',
      message: `Final Action Tracker compiled successfully! ${remindersCreated} reminder(s) scheduled.`,
      items: processedItems,
      grouped: groupedItems,
      remindersCreated,
      summary: aiSummary
    });

    res.write('event: end\ndata: {}\n\n');
    res.end();

  } catch (err) {
    console.error(err);
    sendEvent('error', { message: 'Workflow execution failed: ' + err.message });
    res.end();
  }
});

if (require.main === module) {
  // Spawn background MCP Email Server on port 3001
  fork(path.join(__dirname, 'mcp-email-server.js'));

  app.listen(PORT, () => {
    console.log(`Email to Action Tracker server running on http://localhost:${PORT}`);
  });

  // Start the reminder scheduler (polls due reminders + inbox replies)
  startScheduler();
}

module.exports = app;


