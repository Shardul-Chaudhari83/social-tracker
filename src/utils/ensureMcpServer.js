// Reuses an already-running MCP Email Server if one is reachable, otherwise
// forks a temporary one and waits for it to come up. Shared by any
// standalone script that needs to send/fetch email without requiring the
// full server.js (and its auto-forked MCP child) to already be running.

const path = require('path');
const { fork } = require('child_process');
const { MCP_SERVER_URL } = require('./mcpClient');

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function pingMcpServer() {
  try {
    const res = await fetch(MCP_SERVER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'initialize', id: 1 })
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Ensures an MCP Email Server is reachable at MCP_SERVER_URL.
 * @returns {Promise<import('child_process').ChildProcess|null>} the forked
 *   child process if one was started (caller should `.kill()` it when done),
 *   or null if an existing server was reused (caller should leave it alone).
 */
async function ensureMcpServer() {
  if (await pingMcpServer()) {
    console.log('[MCP] Reusing already-running MCP Email Server on port 3001.');
    return null;
  }

  console.log('[MCP] No MCP Email Server detected — starting a temporary one...');
  const child = fork(path.join(__dirname, '..', '..', 'mcp-email-server.js'));

  for (let i = 0; i < 20; i++) {
    await sleep(300);
    if (await pingMcpServer()) {
      console.log('[MCP] Temporary MCP Email Server is ready.');
      return child;
    }
  }

  child.kill();
  throw new Error('MCP Email Server did not become ready within 6s');
}

module.exports = { ensureMcpServer, pingMcpServer };
