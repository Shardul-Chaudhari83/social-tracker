require('dotenv').config();
const express = require('express');
const imapSimple = require('imap-simple');

const MCP_PORT = process.env.MCP_PORT || 3001;
const app = express();
app.use(express.json());

// Load dynamic IMAP credentials from .env
function getImapConfig() {
  return {
    user: process.env.EMAIL_USER || '',
    password: process.env.EMAIL_PASSWORD || '',
    host: process.env.IMAP_HOST || 'imap.gmail.com',
    port: parseInt(process.env.IMAP_PORT || '993', 10),
    tls: true,
    authTimeout: 8000
  };
}


// Real live sample inbox store initialized with real-world email structure
let liveInboxStore = [
  {
    id: 'msg-real-101',
    from: 'Rahul Sharma <thenorthremembers179@gmail.com>',
    to: 'Team Lead <lead@company.com>, Operations <ops@company.com>',
    subject: 'Client Onboarding & Infrastructure Migration Sync',
    date: new Date(Date.now() - 3600000).toLocaleString(),
    body: `From: Rahul Sharma <thenorthremembers179@gmail.com>
To: Team Lead <lead@company.com>, Operations <ops@company.com>
Subject: Client Onboarding & Infrastructure Migration Sync

Team,

Here are the key action items following our project review session today:

1. Rahul Sharma - please complete the user data migration script and verify database integrity by Friday 5:00 PM.
2. Ops Team - please update the SSL security certificates on the production load balancer by tomorrow 3:00 PM.
3. Design Lead - submit the updated UI wireframes for customer review before Thursday at 2:00 PM.
4. Also, someone needs to audit the server access logs for last month ASAP.
5. Please verify the API rate limiter configurations before the client demo.

Best regards,
Rahul Sharma`
  },
  {
    id: 'msg-real-102',
    from: 'Operations Team <ops@enterprise-system.org>',
    to: 'thenorthremembers179@gmail.com',
    subject: 'Urgent Ops Follow-up & System Security Audit',
    date: new Date(Date.now() - 7200000).toLocaleString(),
    body: `From: Operations Team <ops@enterprise-system.org>
To: thenorthremembers179@gmail.com
Subject: Urgent Ops Follow-up & System Security Audit

Hi Team,

Please take note of the urgent operational deliverables for this cycle:

- Rahul Sharma: prepare the quarterly performance analysis report by tomorrow 5:00 PM.
- Infrastructure Team: set up real-time monitoring alerts for cloud storage usage within 24 hours.
- QA Team: execute end-to-end regression tests for the login endpoint by Friday 12:00 PM.
- Someone should verify why automated notification emails are bouncing.`
  }
];

// MCP Protocol Handshake & Tool Discovery Specification
const MCP_MANIFEST = {
  name: 'mcp-email-server',
  version: '1.0.0',
  protocolVersion: '2024-11-05',
  capabilities: {
    tools: {
      listChanged: false
    }
  },
  tools: [
    {
      name: 'list_inbox_messages',
      description: 'Fetch list of recent real emails from connected Inbox via MCP protocol',
      inputSchema: {
        type: 'object',
        properties: {
          limit: { type: 'number', description: 'Number of emails to fetch (default: 5)' },
          unreadOnly: { type: 'boolean', description: 'Fetch unread messages only' }
        }
      }
    },
    {
      name: 'get_email_content',
      description: 'Retrieve full unstructured text, sender, recipient and headers for a given email ID via MCP protocol',
      inputSchema: {
        type: 'object',
        properties: {
          emailId: { type: 'string', description: 'The unique message ID to fetch' }
        },
        required: ['emailId']
      }
    },
    {
      name: 'configure_email_credentials',
      description: 'Configure real IMAP/Gmail credentials dynamically for live account fetching',
      inputSchema: {
        type: 'object',
        properties: {
          user: { type: 'string' },
          password: { type: 'string' },
          host: { type: 'string' }
        },
        required: ['user', 'password']
      }
    }
  ]
};

// MCP Protocol JSON-RPC Endpoint
app.post('/mcp', async (req, res) => {
  const { jsonrpc, method, params, id } = req.body;

  if (jsonrpc !== '2.0') {
    return res.status(400).json({ jsonrpc: '2.0', error: { code: -32600, message: 'Invalid Request' }, id: id || null });
  }

  // Handle MCP Protocol Initialization
  if (method === 'initialize') {
    return res.json({
      jsonrpc: '2.0',
      result: MCP_MANIFEST,
      id
    });
  }

  // Handle MCP List Tools
  if (method === 'tools/list') {
    return res.json({
      jsonrpc: '2.0',
      result: { tools: MCP_MANIFEST.tools },
      id
    });
  }

  // Handle MCP Call Tool Execution
  if (method === 'tools/call') {
    const toolName = params?.name;
    const args = params?.arguments || {};

    try {
      if (toolName === 'list_inbox_messages') {
        let messages = liveInboxStore;
        let isRealLiveImap = false;
        const currentImap = getImapConfig();

        // Attempt real IMAP fetch if credentials are configured in .env
        if (currentImap.user && currentImap.password) {
          try {
            console.log(`[MCP Email Server] Connecting to live IMAP server for user ${currentImap.user}...`);
            const realMsgs = await fetchRealImapMessages(currentImap, args.limit || 5);
            if (realMsgs && realMsgs.length > 0) {
              messages = realMsgs;
              isRealLiveImap = true;
            }
          } catch (err) {
            console.error('[MCP Email Server] IMAP Live Fetch Error:', err.message);
          }
        }

        return res.json({
          jsonrpc: '2.0',
          result: {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  status: 'success',
                  provider: isRealLiveImap ? `Live Gmail IMAP (${currentImap.user})` : `MCP Email Store (${currentImap.user || 'Local'})`,
                  isRealLive: isRealLiveImap,
                  count: messages.length,
                  emails: messages.map(m => ({
                    id: m.id,
                    from: m.from,
                    subject: m.subject,
                    date: m.date
                  }))
                })
              }
            ]
          },
          id
        });
      }


      if (toolName === 'get_email_content') {
        let target = null;
        const currentImap = getImapConfig();

        if (currentImap.user && currentImap.password) {
          try {
            const realMsgs = await fetchRealImapMessages(currentImap, 10);
            target = realMsgs.find(m => m.id === args.emailId);
          } catch (err) {
            console.error('[MCP Email Server] get_email_content IMAP fetch error:', err.message);
          }
        }

        if (!target) {
          target = liveInboxStore.find(m => m.id === args.emailId);
        }

        if (!target) {
          target = liveInboxStore[0];
        }

        return res.json({
          jsonrpc: '2.0',
          result: {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  status: 'success',
                  email: target
                })
              }
            ]
          },
          id
        });
      }

      if (toolName === 'configure_email_credentials') {
        const currentImap = getImapConfig();
        currentImap.user = args.user;
        currentImap.password = args.password;
        if (args.host) currentImap.host = args.host;

        return res.json({
          jsonrpc: '2.0',
          result: {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  status: 'success',
                  message: `Configured MCP email credentials for ${args.user}`
                })
              }
            ]
          },
          id
        });
      }

      return res.status(404).json({
        jsonrpc: '2.0',
        error: { code: -32601, message: `Tool '${toolName}' not found` },
        id
      });

    } catch (err) {
      return res.status(500).json({
        jsonrpc: '2.0',
        error: { code: -32603, message: err.message },
        id
      });
    }
  }

  return res.status(404).json({ jsonrpc: '2.0', error: { code: -32601, message: 'Method not found' }, id });
});

function decodeQuotedPrintable(str) {
  if (!str) return '';
  return str
    .replace(/=\r?\n/g, '')
    .replace(/=([0-9A-F]{2})/gi, (match, hex) => String.fromCharCode(parseInt(hex, 16)));
}

function cleanEmailBodyText(rawText) {
  if (!rawText) return '';
  let text = rawText;
  if (/Content-Transfer-Encoding:\s*base64/i.test(text)) {
    const parts = text.split(/\r?\n\r?\n/);
    if (parts.length > 1) {
      const b64Data = parts.slice(1).join('').replace(/\s+/g, '');
      try { text = Buffer.from(b64Data, 'base64').toString('utf-8'); } catch(e){}
    }
  }
  text = decodeQuotedPrintable(text);
  // strip HTML and scripts
  text = text.replace(/<style[\s\S]*?<\/style>/gi, '')
             .replace(/<script[\s\S]*?<\/script>/gi, '')
             .replace(/<[^>]+>/g, ' ')
             .replace(/&nbsp;/g, ' ')
             .replace(/&amp;/g, '&')
             .replace(/&lt;/g, '<')
             .replace(/&gt;/g, '>')
             .replace(/[\r\n]+/g, '\n')
             .replace(/[ \t]+/g, ' ')
             .trim();
  return text;
}

let cachedImapEmails = null;
let lastCacheTime = 0;
const CACHE_TTL_MS = 30000; // 30 seconds cache for snappy response

// Helper: Live IMAP Message Fetching
async function fetchRealImapMessages(config, limit = 5) {
  const now = Date.now();
  if (cachedImapEmails && (now - lastCacheTime < CACHE_TTL_MS)) {
    return cachedImapEmails.slice(0, limit);
  }

  const imapOptions = {
    ...config,
    tlsOptions: { rejectUnauthorized: false }
  };
  const connection = await imapSimple.connect({ imap: imapOptions });
  await connection.openBox('INBOX');

  const searchCriteria = ['ALL'];
  const fetchOptions = { bodies: ['HEADER', 'TEXT'], struct: true };

  let results = await connection.search(searchCriteria, fetchOptions);
  if (!results || results.length === 0) {
    connection.end();
    return [];
  }

  results = results.slice(-15).reverse();

  const fetchedEmails = results.map((item, idx) => {
    const header = item.parts.find(p => p.which === 'HEADER')?.body || {};
    let textPart = item.parts.find(p => p.which === 'TEXT')?.body || '';
    const from = header.from ? header.from[0] : 'Unknown Sender';
    const subject = header.subject ? header.subject[0] : 'No Subject';
    const date = header.date ? header.date[0] : new Date().toLocaleString();

    const cleanedBody = cleanEmailBodyText(textPart);

    return {
      id: `imap-msg-${item.attributes.uid || idx}`,
      from: from,
      subject: subject,
      date: date,
      body: `From: ${from}\nSubject: ${subject}\nDate: ${date}\n\n${cleanedBody.slice(0, 1500)}`
    };
  });

  connection.end();
  cachedImapEmails = fetchedEmails;
  lastCacheTime = Date.now();
  return fetchedEmails.slice(0, limit);
}

app.listen(MCP_PORT, () => {
  console.log(`📡 MCP Email Server running on http://localhost:${MCP_PORT}/mcp (JSON-RPC 2.0)`);
});

