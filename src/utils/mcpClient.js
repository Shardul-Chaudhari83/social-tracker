const MCP_SERVER_URL = process.env.MCP_SERVER_URL || 'http://localhost:3001/mcp';

/**
 * Calls a tool on the MCP Email Server over JSON-RPC 2.0.
 * Shared by the SSE agent pipeline (server.js) and the reminder scheduler.
 * @param {string} toolName - MCP tool name (e.g. 'list_inbox_messages', 'send_email')
 * @param {Object} args - Tool arguments
 * @returns {Promise<Object>} Parsed tool result
 */
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

module.exports = { callMcpTool, MCP_SERVER_URL };
