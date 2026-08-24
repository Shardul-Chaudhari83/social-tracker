const express = require('express');
const path = require('path');
const { fork } = require('child_process');

const { initDatabase } = require('./src/db/database');
const reminderRoutes = require('./src/routes/reminderRoutes');

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

const MCP_SERVER_URL = process.env.MCP_SERVER_URL || 'http://localhost:3001/mcp';

// Helper: Query MCP Email Server over JSON-RPC 2.0
async function callMcpTool(toolName, args = {}) {
  const payload = {
    jsonrpc: '2.0',
    method: 'tools/call',
    params: {
      name: toolName,
      arguments: args
    },
    id: Date.now()
  };

  const response = await fetch(MCP_SERVER_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    throw new Error(`MCP Server HTTP ${response.status}`);
  }

  const resJson = await response.json();
  if (resJson.error) {
    throw new Error(`MCP Error: ${resJson.error.message}`);
  }

  const rawText = resJson.result?.content?.[0]?.text;
  return rawText ? JSON.parse(rawText) : resJson.result;
}

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
    // Pipeline Execution Engine with simulated delays for live demo visual experience
    sendEvent('status', { agent: 'System', message: 'Workflow initiated: Email to Action Tracker' });
    await delay(400);

    // 1. Extraction Agent
    sendEvent('status', { 
      agent: 'Extraction Agent', 
      type: 'agent-start',
      message: 'Reading raw email text and extracting task candidates...' 
    });
    await delay(800);

    const extractedCandidates = parseRawEmailIntoTasks(emailText);
    
    sendEvent('status', { 
      agent: 'Extraction Agent', 
      type: 'agent-complete',
      message: `Extracted ${extractedCandidates.length} candidate tasks from email thread.`,
      candidates: extractedCandidates
    });
    await delay(600);

    // 2. Processing items through Assignment Sub-Agent & QA Sub-Agent Loop
    const processedItems = [];

    for (let i = 0; i < extractedCandidates.length; i++) {
      const candidate = extractedCandidates[i];
      const itemNum = i + 1;
      
      sendEvent('status', {
        agent: 'Extraction Agent',
        type: 'item-start',
        message: `Processing Task #${itemNum}: "${candidate.rawSnippet}"`
      });
      await delay(500);

      let currentItem = {
        id: itemNum,
        rawSnippet: candidate.rawSnippet,
        task: candidate.initialTask,
        owner: candidate.initialOwner,
        deadline: candidate.initialDeadline,
        attempts: 0,
        status: 'Pending',
        logs: []
      };

      let passedQA = false;
      const maxRetries = 3;

      while (!passedQA && currentItem.attempts <= maxRetries) {
        // Step A: Assignment Sub-Agent (runs on 1st attempt or on retry)
        currentItem.attempts++;
        const attemptLabel = `Attempt ${currentItem.attempts}/${maxRetries}`;

        sendEvent('status', {
          agent: 'Assignment Sub-Agent',
          type: 'assignment-work',
          itemId: itemNum,
          attempt: currentItem.attempts,
          message: `[${attemptLabel}] Applying 'ownership-rules' skill to infer owner & deadline for Task #${itemNum}...`
        });
        await delay(700);

        // Apply ownership & deadline inference rules (progressive resolution on retry)
        currentItem = refineAssignment(currentItem, candidate, emailText);

        sendEvent('status', {
          agent: 'Assignment Sub-Agent',
          type: 'assignment-done',
          itemId: itemNum,
          attempt: currentItem.attempts,
          message: `[${attemptLabel}] Task #${itemNum} assigned -> Owner: "${currentItem.owner}", Deadline: "${currentItem.deadline}"`,
          itemState: currentItem
        });
        await delay(600);

        // Step B: QA Sub-Agent Verification
        sendEvent('status', {
          agent: 'QA Sub-Agent',
          type: 'qa-check',
          itemId: itemNum,
          attempt: currentItem.attempts,
          message: `[${attemptLabel}] Reviewing Task #${itemNum} against 'quality-check' skill criteria...`
        });
        await delay(700);

        const qaResult = evaluateQualityCheck(currentItem);

        if (qaResult.passed) {
          passedQA = true;
          currentItem.status = 'Verified';
          sendEvent('status', {
            agent: 'QA Sub-Agent',
            type: 'qa-pass',
            itemId: itemNum,
            attempt: currentItem.attempts,
            message: `✓ Task #${itemNum} PASSED QA on attempt ${currentItem.attempts}! Criteria satisfied (Clear task, named owner, explicit deadline).`,
            itemState: currentItem
          });
          await delay(600);
        } else {
          // QA Failed
          if (currentItem.attempts < maxRetries) {
            sendEvent('status', {
              agent: 'QA Sub-Agent',
              type: 'qa-retry',
              itemId: itemNum,
              attempt: currentItem.attempts,
              maxRetries: maxRetries,
              reason: qaResult.reason,
              message: `⚠️ Item ${itemNum} failed QA (${qaResult.reason}) → retrying (${currentItem.attempts}/${maxRetries}). Sending back to Assignment Sub-Agent.`
            });
            await delay(900);
          } else {
            // Maximum retries reached -> flag for human review
            currentItem.status = 'Needs Human Review';
            currentItem.flagReason = qaResult.reason;
            sendEvent('status', {
              agent: 'QA Sub-Agent',
              type: 'qa-flagged',
              itemId: itemNum,
              attempt: currentItem.attempts,
              maxRetries: maxRetries,
              reason: qaResult.reason,
              message: `🚨 Item ${itemNum} failed QA after ${maxRetries} retries (${qaResult.reason}) → Flagged for Human Review.`
            });
            await delay(800);
            break; // exit loop
          }
        }
      }

      processedItems.push(currentItem);
    }

    // 3. Report Agent aggregation
    sendEvent('status', {
      agent: 'Report Agent',
      type: 'report-building',
      message: 'Compiling finalized action items and grouping by owner...'
    });
    await delay(800);

    // Group items by owner
    const groupedItems = {};
    processedItems.forEach(item => {
      const ownerKey = item.owner || 'Unassigned';
      if (!groupedItems[ownerKey]) groupedItems[ownerKey] = [];
      groupedItems[ownerKey].push(item);
    });

    sendEvent('final-report', {
      agent: 'Report Agent',
      type: 'report-complete',
      message: 'Final Action Tracker compiled successfully!',
      items: processedItems,
      grouped: groupedItems
    });

    res.write('event: end\ndata: {}\n\n');
    res.end();

  } catch (err) {
    console.error(err);
    sendEvent('error', { message: 'Workflow execution failed: ' + err.message });
    res.end();
  }
});

// Helper: Simulated delay
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Extraction logic heuristic parser
function parseRawEmailIntoTasks(text) {
  const tasks = [];

  // Extract default owner from headers if present
  let defaultOwner = null;
  const fromMatch = text.match(/From:\s*([^<\n]+)/i);
  if (fromMatch) {
    const rawSender = fromMatch[1].trim();
    if (rawSender && !rawSender.includes('@')) {
      defaultOwner = rawSender;
    }
  }

  // Remove email header blocks before sentence extraction
  const cleanBody = text
    .replace(/From:[^\n]+\n?/gi, '')
    .replace(/To:[^\n]+\n?/gi, '')
    .replace(/Subject:[^\n]+\n?/gi, '')
    .replace(/Date:[^\n]+\n?/gi, '')
    .trim();

  // Split body into sentences or bullet points
  const rawSegments = cleanBody
    .split(/(?:\r?\n)+|(?<=[.!?])\s+/)
    .map(s => s.trim())
    .filter(s => s.length > 10);

  const sentencePattern = /(?:can you|please|need you to|will handle|should|needs to|action item|1\.|2\.|3\.|4\.|5\.|first off|also|update|fix|patch|prepare|review|check|verify|sign in|access|security|member|group|alert)/i;

  rawSegments.forEach(segment => {
    // Ignore boilerplate footers / common privacy notices
    if (segment.includes("Privacy Policy") || segment.includes("Terms of Service") || segment.includes("stop using Sign in with Google")) {
      return;
    }

    if (sentencePattern.test(segment) || segment.length > 20) {
      let initialOwner = null;
      let initialDeadline = null;

      // Clean segment of bullet points/numbers
      let cleanTask = segment.replace(/^(?:\d+\.\s*|-|\*)/, '').trim();

      // Ensure concise task summary (cap at 140 chars for clean display)
      if (cleanTask.length > 140) {
        cleanTask = cleanTask.slice(0, 137) + '...';
      }

      // Check explicit owner mentions dynamically (e.g. "Rahul Sharma - ", "Ops Team:", "@John")
      const namePrefixMatch = segment.match(/^(?:@|\b)([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\s*[:,\-]/);
      const ignoredWords = ['Hi', 'Hey', 'Dear', 'Thanks', 'Team', 'Please', 'Also', 'If', 'This', 'You', 'Wait', 'First'];
      if (namePrefixMatch && !ignoredWords.includes(namePrefixMatch[1])) {
        initialOwner = namePrefixMatch[1];
      }

      // Check explicit deadlines dynamically
      if (/EOD Friday|by Friday/i.test(segment)) initialDeadline = 'Friday 5:00 PM';
      else if (/next Tuesday/i.test(segment)) initialDeadline = 'Next Tuesday 12:00 PM';
      else if (/Thursday at 2 PM|Thursday/i.test(segment)) initialDeadline = 'Thursday 2:00 PM';
      else if (/tomorrow 5 PM|tomorrow at 3 PM|tomorrow/i.test(segment)) initialDeadline = 'Tomorrow 5:00 PM';
      else if (/tonight|by midnight/i.test(segment)) initialDeadline = 'Tonight 11:59 PM';
      else if (/ASAP|immediately|urgent/i.test(segment)) initialDeadline = 'Within 24 Hours';

      tasks.push({
        rawSnippet: segment.length > 100 ? segment.slice(0, 97) + '...' : segment,
        initialTask: cleanTask,
        initialOwner: initialOwner || defaultOwner,
        initialDeadline: initialDeadline
      });
    }
  });

  if (tasks.length === 0) {
    let summarySnippet = cleanBody.slice(0, 120);
    if (cleanBody.length > 120) summarySnippet += '...';
    tasks.push({
      rawSnippet: summarySnippet,
      initialTask: summarySnippet || 'Review email notification details',
      initialOwner: defaultOwner,
      initialDeadline: null
    });
  }

  return tasks;
}

// Assignment Sub-Agent refinement heuristics (simulating iterative intelligence)
function refineAssignment(item, candidate, fullEmailText) {
  let task = item.task;
  let owner = item.owner;
  let deadline = item.deadline;

  // Extract fallback sender/recipient from full email text
  let fallbackOwner = null;
  const fromMatch = fullEmailText.match(/From:\s*([^<\n]+)/i);
  if (fromMatch) {
    const raw = fromMatch[1].trim();
    if (raw && !raw.includes('@')) fallbackOwner = raw;
  }

  // On Attempt 1: Keep initial parsed or infer owner if obvious
  if (item.attempts === 1) {
    if (!owner) {
      if (/ssl|security|cert|auth|load balancer/i.test(task)) {
        owner = 'DevOps / Infrastructure Team';
      } else if (/database|migration|query|data/i.test(task)) {
        owner = 'Backend / Database Engineer';
      } else if (/ui|wireframe|figma|design/i.test(task)) {
        owner = 'UI/UX Design Lead';
      } else if (fallbackOwner) {
        owner = fallbackOwner;
      }
    }
  }

  // On Attempt 2: If deadline is missing, infer from relative keywords or standard SLA
  if (item.attempts === 2) {
    if (!deadline) {
      if (/ASAP|urgently|high latency|security|spam|urgent|escalation|alert/i.test(fullEmailText + task)) {
        deadline = 'Within 24 Hours (Urgent SLA)';
      } else {
        deadline = 'End of Week (Friday 5:00 PM)';
      }
    }
    if (!owner) {
      if (/security|audit|access log/i.test(task)) {
        owner = 'Security Audit Lead';
      } else if (/test|qa|regression/i.test(task)) {
        owner = 'QA Automation Lead';
      } else if (fallbackOwner) {
        owner = fallbackOwner;
      }
    }
  }

  // On Attempt 3: Provide best effort fallback
  if (item.attempts === 3) {
    if (!owner) {
      owner = fallbackOwner || 'Unassigned (Requires Lead Triage)';
    }
    if (!deadline) {
      deadline = 'Within 3 Business Days (Standard SLA)';
    }
  }

  return {
    ...item,
    task: task,
    owner: owner,
    deadline: deadline
  };
}

// QA Sub-Agent Quality Criteria Evaluation
function evaluateQualityCheck(item) {
  // Criterion 1: Clear task (length & specificity)
  if (!item.task || item.task.length < 10) {
    return { passed: false, reason: 'Task description vague or too short' };
  }

  // Criterion 2: Named owner (cannot be empty, unassigned, or generic requiring triage)
  if (!item.owner || item.owner.includes('Unassigned') || item.owner.includes('Requires Lead Triage')) {
    return { passed: false, reason: 'Missing explicit named owner' };
  }

  // Criterion 3: Deadline (cannot be empty, TBD, or unstated)
  if (!item.deadline || item.deadline.includes('TBD') || item.deadline.includes('Needs Owner Input')) {
    return { passed: false, reason: 'Missing explicit deadline' };
  }

  return { passed: true };
}

if (require.main === module) {
  // Spawn background MCP Email Server on port 3001
  fork(path.join(__dirname, 'mcp-email-server.js'));

  app.listen(PORT, () => {
    console.log(`Email to Action Tracker server running on http://localhost:${PORT}`);
  });
}

module.exports = app;


