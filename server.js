const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Sample emails for instant live demo testing
const SAMPLE_EMAILS = {
  messy_sprint: `From: Sarah Jenkins <sarah.j@techcorp.com>
To: Alex Rivera <alex.r@techcorp.com>, David Chen <david.c@techcorp.com>, Maria Santos <maria.s@techcorp.com>
Subject: Re: Sprint Sync & Q3 Deliverables Urgent Updates

Hey team,

Thanks for joining the call earlier. I wanted to summarize what we talked about since things got a bit chaotic:

First off, Alex - can you update the API authentication endpoint documentation by EOD Friday? The client integration team is waiting on this.

Also David, we noticed high latency on the user analytics query. We need you to optimize the database query index by next Tuesday. 

Maria mentioned she will handle creating the initial Figma wireframes for the new settings dashboard. Let's make sure that's ready before the product review on Thursday at 2 PM.

Wait, who is updating the deployment pipeline script? We spoke about fixing the Docker build step... someone needs to look into that ASAP.

Also, someone should review the security audit logs for last month.

Thanks,
Sarah`,

  vague_launch: `From: Marcus Vance <marcus@startup.io>
To: Team All <team@startup.io>
Subject: Post-Launch Action Items

Team - great launch yesterday! Quick follow ups:

1. Sarah, please draft the press release release notes by tomorrow 5 PM.
2. Alex: set up the monitoring alerts for S3 bucket storage usage.
3. We need to prepare the financial summary report for investors.
4. Elena - update the customer support FAQ section by Friday.
5. Can someone check why the automated welcome emails are landing in spam?`
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
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  const tasks = [];

  // Match common task patterns or line items
  const sentencePattern = /(?:can you|please|need you to|will handle|should|needs to|action item|1\.|2\.|3\.|4\.|5\.|first off|also)/i;
  
  // Extract senders and recipients from headers if present
  let senders = [];
  const fromMatch = text.match(/From:\s*([^\n<]+)/i);
  if (fromMatch) senders.push(fromMatch[1].trim());

  lines.forEach(line => {
    if (line.startsWith('From:') || line.startsWith('To:') || line.startsWith('Subject:') || line.startsWith('Hey') || line.startsWith('Thanks')) {
      return;
    }

    if (sentencePattern.test(line) || line.length > 20) {
      // Parse task details
      let initialOwner = null;
      let initialDeadline = null;
      let cleanTask = line.replace(/^(?:\d+\.\s*|-|\*)/, '').trim();

      // Check explicit owner mentions
      if (/\bAlex\b/i.test(line)) initialOwner = 'Alex Rivera';
      else if (/\bDavid\b/i.test(line)) initialOwner = 'David Chen';
      else if (/\bMaria\b/i.test(line)) initialOwner = 'Maria Santos';
      else if (/\bSarah\b/i.test(line)) initialOwner = 'Sarah Jenkins';
      else if (/\bElena\b/i.test(line)) initialOwner = 'Elena Rostova';

      // Check explicit deadlines
      if (/EOD Friday|by Friday/i.test(line)) initialDeadline = 'Friday 5:00 PM';
      else if (/next Tuesday/i.test(line)) initialDeadline = 'Next Tuesday 12:00 PM';
      else if (/Thursday at 2 PM|Thursday/i.test(line)) initialDeadline = 'Thursday 2:00 PM';
      else if (/tomorrow 5 PM|tomorrow/i.test(line)) initialDeadline = 'Tomorrow 5:00 PM';

      tasks.push({
        rawSnippet: line,
        initialTask: cleanTask,
        initialOwner: initialOwner,
        initialDeadline: initialDeadline
      });
    }
  });

  if (tasks.length === 0) {
    tasks.push({
      rawSnippet: text.slice(0, 80),
      initialTask: 'Review raw email content and extract action steps',
      initialOwner: null,
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

  // On Attempt 1: Keep initial parsed or infer owner if obvious
  if (item.attempts === 1) {
    if (!owner) {
      if (/docker|deployment|pipeline|build/i.test(task)) {
        owner = 'Alex Rivera (DevOps)';
      } else if (/database|analytics|latency|query/i.test(task)) {
        owner = 'David Chen (Backend)';
      }
    }
  }

  // On Attempt 2: If deadline is missing, infer from relative keywords or standard SLA
  if (item.attempts === 2) {
    if (!deadline) {
      if (/ASAP|urgently|high latency|security|spam/i.test(fullEmailText + task)) {
        deadline = 'Within 24 Hours (Urgent SLA)';
      } else {
        deadline = 'End of Week (Friday 5:00 PM)';
      }
    }
    if (!owner) {
      if (/security|audit/i.test(task)) {
        owner = 'Sarah Jenkins (SecOps)';
      } else if (/welcome email|spam/i.test(task)) {
        owner = 'Alex Rivera (Infrastructure)';
      } else if (/financial|investor/i.test(task)) {
        owner = 'Marcus Vance (Finance Lead)';
      }
    }
  }

  // On Attempt 3: Provide best effort fallback
  if (item.attempts === 3) {
    if (!owner) {
      owner = 'Unassigned (Requires Lead Triage)';
    }
    if (!deadline) {
      deadline = 'TBD (Needs Owner Input)';
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

app.listen(PORT, () => {
  console.log(`Email to Action Tracker server running on http://localhost:${PORT}`);
});
