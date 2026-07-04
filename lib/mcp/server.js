// Minimal MCP (Model Context Protocol) server core over JSON-RPC 2.0.
// Implements the subset every MCP client uses — initialize, ping,
// tools/list, tools/call — with no external dependencies. Transport is
// newline-delimited JSON over stdio (see attachStdio / bin/vispnote-mcp.js).

const SUPPORTED_PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];
const LATEST_PROTOCOL_VERSION = SUPPORTED_PROTOCOL_VERSIONS[0];
const MAX_MESSAGE_BYTES = 4 * 1024 * 1024;

function rpcResult(id, result) {
  return { jsonrpc: '2.0', id, result };
}

function rpcError(id, code, message) {
  return { jsonrpc: '2.0', id, error: { code, message: String(message || 'Error') } };
}

function toolResultContent(value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  return { content: [{ type: 'text', text }], isError: false };
}

function toolErrorContent(message) {
  return { content: [{ type: 'text', text: String(message || 'Tool failed') }], isError: true };
}

function createMcpServer({ name = 'vispnote', version = '0.0.0', tools = [] } = {}) {
  const registry = new Map();
  for (const tool of tools) {
    if (!tool?.name || typeof tool.handler !== 'function') continue;
    registry.set(tool.name, tool);
  }

  async function handleMessage(message) {
    if (!message || typeof message !== 'object' || message.jsonrpc !== '2.0') {
      return rpcError(message?.id ?? null, -32600, 'Invalid JSON-RPC request');
    }
    const { id, method, params } = message;
    const isNotification = !Object.prototype.hasOwnProperty.call(message, 'id');
    if (typeof method !== 'string') {
      return isNotification ? null : rpcError(id, -32600, 'Missing method');
    }
    if (method.startsWith('notifications/')) return null;

    try {
      if (method === 'initialize') {
        const requested = String(params?.protocolVersion || '');
        const protocolVersion = SUPPORTED_PROTOCOL_VERSIONS.includes(requested)
          ? requested
          : LATEST_PROTOCOL_VERSION;
        return rpcResult(id, {
          protocolVersion,
          capabilities: { tools: {} },
          serverInfo: { name, version },
        });
      }
      if (method === 'ping') return rpcResult(id, {});
      if (method === 'tools/list') {
        return rpcResult(id, {
          tools: [...registry.values()].map(tool => ({
            name: tool.name,
            description: tool.description || '',
            inputSchema: tool.inputSchema || { type: 'object', properties: {} },
          })),
        });
      }
      if (method === 'tools/call') {
        const toolName = String(params?.name || '');
        const tool = registry.get(toolName);
        if (!tool) return rpcResult(id, toolErrorContent(`Unknown tool: ${toolName}`));
        try {
          const value = await tool.handler(params?.arguments || {});
          return rpcResult(id, toolResultContent(value));
        } catch (e) {
          return rpcResult(id, toolErrorContent(e?.message || e));
        }
      }
      if (isNotification) return null;
      return rpcError(id, -32601, `Method not found: ${method}`);
    } catch (e) {
      return isNotification ? null : rpcError(id, -32603, e?.message || 'Internal error');
    }
  }

  return { name, version, handleMessage, toolNames: () => [...registry.keys()] };
}

// Newline-delimited JSON transport over the given streams. Returns a handle
// whose idle() resolves once every received request has been answered, so
// callers can drain in-flight work before exiting on stdin close.
function attachStdio(server, { input, output } = {}) {
  let buffer = '';
  const pending = new Set();
  const write = (response) => {
    if (response) output.write(JSON.stringify(response) + '\n');
  };
  input.setEncoding('utf8');
  input.on('data', (chunk) => {
    buffer += chunk;
    if (buffer.length > MAX_MESSAGE_BYTES) {
      write(rpcError(null, -32600, 'Message too large'));
      buffer = '';
      return;
    }
    let newline;
    while ((newline = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (!line) continue;
      let message;
      try {
        message = JSON.parse(line);
      } catch (e) {
        write(rpcError(null, -32700, 'Parse error'));
        continue;
      }
      const task = Promise.resolve(server.handleMessage(message)).then(write).catch(e => {
        write(rpcError(message?.id ?? null, -32603, e?.message || 'Internal error'));
      });
      pending.add(task);
      task.finally(() => pending.delete(task));
    }
  });
  return {
    async idle() {
      while (pending.size) await Promise.allSettled([...pending]);
    },
  };
}

module.exports = {
  createMcpServer,
  attachStdio,
  SUPPORTED_PROTOCOL_VERSIONS,
};
