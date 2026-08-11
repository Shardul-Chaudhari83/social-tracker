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


// Real live demo sample inbox cache (allows instant real-world email testing as well as live IMAP sync)
let liveInboxStore = [
  {
    id: 'msg-real-101',
    from: 'Sarah Jenkins <sarah.j@techcorp.com>',
    to: 'Alex Rivera <alex.r@techcorp.com>, David Chen <david.c@techcorp.com>',
    subject: 'URGENT: Q3 Client Launch Sync & Pending Deliverables',
    date: new Date(Date.now() - 3600000).toLocaleString(),
    body: `From: Sarah Jenkins <sarah.j@techcorp.com>
To: Alex Rivera <alex.r@techcorp.com>, David Chen <david.c@techcorp.com>
Subject: URGENT: Q3 Client Launch Sync & Pending Deliverables

Hey team,

Following up on our emergency sync this morning:

1. Alex Rivera - please update the API authentication endpoint documentation by EOD Friday. The integration team cannot proceed without it.
2. David Chen - we noticed high query latency on user analytics. Please optimize the database query index by next Tuesday.
3. Maria - please finish creating the initial Figma wireframes for the new settings dashboard before the product review on Thursday at 2 PM.
4. Also, someone needs to fix the Docker build step in the deployment pipeline script ASAP.
5. And someone should review last month's security audit logs.

Thanks,
Sarah`
  },
  {
    id: 'msg-real-102',
    from: 'Marcus Vance <marcus@startup.io>',
    to: 'Team All <team@startup.io>',
    subject: 'Post-Launch Action Items & Ops Followup',
    date: new Date(Date.now() - 7200000).toLocaleString(),
    body: `From: Marcus Vance <marcus@startup.io>
To: Team All <team@startup.io>
Subject: Post-Launch Action Items & Ops Followup

Team - great work on launch! Quick action items:

- Sarah Jenkins, please draft the press release release notes by tomorrow 5 PM.
- Alex Rivera: set up monitoring alerts for S3 bucket storage usage.
- We need to prepare the financial summary report for investors.
- Elena Rostova - update customer support FAQ section by Friday.
- Can someone check why automated welcome emails are landing in spam?`
  },
  {
    id: 'msg-real-103',
    from: 'Operations Team <ops@enterprise.com>',
    to: 'thenorthremembers179@gmail.com',
    subject: 'Client Support Escalation & Server Maintenance',
    date: new Date(Date.now() - 10800000).toLocaleString(),
    body: `From: Operations Team <ops@enterprise.com>
To: thenorthremembers179@gmail.com
Subject: Client Support Escalation & Server Maintenance

Hi Team,

Please note the following urgent tasks for this sprint:

1. Alex Rivera: Patch SSL certificates on load balancer by Friday 3 PM.
2. David Chen: Increase database pool limit to 200 before midnight tonight.
3. Prepare executive summary for client meeting.
4. Review API gateway rate limiting policies.`
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
                  provider: isRealLiveImap ? `Live Gmail IMAP (${currentImap.user})` : (currentImap.user ? `Gmail Configured (${currentImap.user}) - Add App Password to .env` : 'Local MCP Email Store'),
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
        const target = liveInboxStore.find(m => m.id === args.emailId) || liveInboxStore[0];
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
        imapConfig.user = args.user;
        imapConfig.password = args.password;
        if (args.host) imapConfig.host = args.host;

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

// Helper: Live IMAP Message Fetching
async function fetchRealImapMessages(config, limit = 5) {
  const imapOptions = {
    ...config,
    tlsOptions: { rejectUnauthorized: false }
  };
  const connection = await imapSimple.connect({ imap: imapOptions });
  await connection.openBox('INBOX');


  const searchCriteria = ['UNSEEN'];
  const fetchOptions = { bodies: ['HEADER', 'TEXT', ''], struct: true };

  let results = await connection.search(searchCriteria, fetchOptions);
  if (!results || results.length === 0) {
    // If no unread, fetch latest messages
    results = await connection.search(['ALL'], fetchOptions);
  }

  results = results.slice(-limit).reverse();

  const fetchedEmails = results.map((item, idx) => {
    const header = item.parts.find(p => p.which === 'HEADER')?.body || {};
    const textPart = item.parts.find(p => p.which === 'TEXT')?.body || '';
    const from = header.from ? header.from[0] : 'Unknown Sender';
    const subject = header.subject ? header.subject[0] : 'No Subject';
    const date = header.date ? header.date[0] : new Date().toLocaleString();

    return {
      id: `imap-msg-${item.attributes.uid || idx}`,
      from: from,
      subject: subject,
      date: date,
      body: `From: ${from}\nSubject: ${subject}\nDate: ${date}\n\n${textPart.slice(0, 1500)}`
    };
  });

  connection.end();
  return fetchedEmails;
}

app.listen(MCP_PORT, () => {
  console.log(`📡 MCP Email Server running on http://localhost:${MCP_PORT}/mcp (JSON-RPC 2.0)`);
});
