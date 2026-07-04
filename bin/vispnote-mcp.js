#!/usr/bin/env node
// VispNote MCP server (stdio). Exposes the local vaults to MCP clients such
// as Claude Code so agents can search and read notes — and, only when
// started with --allow-writes, create or append to them.
//
// Usage:
//   node bin/vispnote-mcp.js [--allow-writes]
//
// Respects VISPNOTE_HOME the same way the app does, so it reads and writes
// the exact same vaults and search index (SQLite WAL handles the app and
// this process running concurrently).

const fs = require('fs');
const path = require('path');
const { createMcpServer, attachStdio } = require(path.join(__dirname, '..', 'lib', 'mcp', 'server'));
const { createVaultTools } = require(path.join(__dirname, '..', 'lib', 'mcp', 'tools'));
const store = require(path.join(__dirname, '..', 'lib', 'store'));
const idx = require(path.join(__dirname, '..', 'lib', 'index'));
const pkg = require(path.join(__dirname, '..', 'package.json'));

const allowWrites = process.argv.includes('--allow-writes');

// First-run seeding assumes the data root exists (the app creates it during
// boot); a standalone MCP process must do the same.
try { fs.mkdirSync(store.ROOT, { recursive: true }); } catch {}

const server = createMcpServer({
  name: 'vispnote',
  version: pkg.version,
  tools: createVaultTools({ store, idx, allowWrites }),
});

const transport = attachStdio(server, { input: process.stdin, output: process.stdout });
console.error(`[vispnote-mcp] ready (writes ${allowWrites ? 'ENABLED' : 'disabled'}, tools: ${server.toolNames().join(', ')})`);

process.stdin.on('end', async () => {
  await transport.idle();
  try { idx.close(); } catch {}
  process.exit(0);
});
