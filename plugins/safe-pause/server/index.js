#!/usr/bin/env node
/**
 * safe-pause MCP server — zero npm-dependency Node.js implementation.
 * Implements the MCP stdio JSON-RPC 2.0 protocol.
 *
 * Tools exposed:
 *   get_usage       — return cached usage (or fetch if stale/missing)
 *   refresh_usage   — force-fetch fresh data from claude.ai API
 *   set_credentials — store org_id + session_key in config
 *
 * Usage data is written to ~/.claude/safeclaude/usage.json so the
 * PreToolUse hook (check-usage.sh) can read it without calling the MCP.
 */

'use strict';

const https = require('https');
const fs   = require('fs');
const path = require('path');
const os   = require('os');
const readline = require('readline');

const STATE_DIR  = path.join(os.homedir(), '.claude', 'safeclaude');
const CONFIG_FILE = path.join(STATE_DIR, 'config.json');
const USAGE_FILE  = path.join(STATE_DIR, 'usage.json');
const POLL_MS     = 60_000;

// ── helpers ────────────────────────────────────────────────────────────────

function ensureDir() {
  fs.mkdirSync(STATE_DIR, { recursive: true });
}

function readConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
  } catch {
    return {};
  }
}

function writeConfig(data) {
  ensureDir();
  const existing = readConfig();
  fs.writeFileSync(CONFIG_FILE, JSON.stringify({ ...existing, ...data }, null, 2));
}

function readUsageCache() {
  try {
    const raw = JSON.parse(fs.readFileSync(USAGE_FILE, 'utf8'));
    const age = Date.now() - new Date(raw._fetched_at || 0).getTime();
    return { data: raw, staleMs: age };
  } catch {
    return { data: null, staleMs: Infinity };
  }
}

function fetchUsage(orgId, sessionKey) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'claude.ai',
      path: `/api/organizations/${orgId}/usage`,
      method: 'GET',
      headers: {
        'Cookie': `sessionKey=${sessionKey}`,
        'User-Agent': 'Claude-Code-SafePause/2.0',
        'Accept': 'application/json',
      },
    };
    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', (c) => body += c);
      res.on('end', () => {
        if (res.statusCode !== 200) {
          return reject(new Error(`HTTP ${res.statusCode}: ${body.slice(0, 200)}`));
        }
        try {
          resolve(JSON.parse(body));
        } catch (e) {
          reject(new Error('Invalid JSON from usage API'));
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(8000, () => { req.destroy(); reject(new Error('Timeout')); });
    req.end();
  });
}

async function getOrFetchUsage(forceRefresh = false) {
  const cfg = readConfig();
  const { data: cached, staleMs } = readUsageCache();

  if (!forceRefresh && cached && staleMs < POLL_MS) {
    return { source: 'cache', data: cached };
  }

  if (!cfg.org_id || !cfg.session_key) {
    if (cached) return { source: 'cache_no_creds', data: cached };
    return { source: 'error', error: 'No credentials. Run set_credentials first.' };
  }

  try {
    const data = await fetchUsage(cfg.org_id, cfg.session_key);
    const payload = { ...data, _org_id: cfg.org_id, _fetched_at: new Date().toISOString() };
    ensureDir();
    fs.writeFileSync(USAGE_FILE, JSON.stringify(payload, null, 2));
    return { source: 'live', data: payload };
  } catch (err) {
    if (cached) return { source: 'cache_fetch_failed', error: err.message, data: cached };
    return { source: 'error', error: err.message };
  }
}

// ── MCP stdio JSON-RPC ─────────────────────────────────────────────────────

function send(obj) {
  process.stdout.write(JSON.stringify(obj) + '\n');
}

function ok(id, result) {
  send({ jsonrpc: '2.0', id, result });
}

function err(id, code, message) {
  send({ jsonrpc: '2.0', id, error: { code, message } });
}

const TOOLS = [
  {
    name: 'get_usage',
    description: 'Return current Claude.ai subscription utilization (five_hour + seven_day). Uses cached data if fresh.',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'refresh_usage',
    description: 'Force-fetch fresh usage data from Claude.ai API, update local cache, and return result.',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'set_credentials',
    description: 'Store org_id and session_key so the server can fetch usage without a browser.',
    inputSchema: {
      type: 'object',
      properties: {
        org_id:      { type: 'string', description: 'Claude.ai organization ID' },
        session_key: { type: 'string', description: 'sessionKey cookie from claude.ai' },
      },
      required: ['org_id', 'session_key'],
    },
  },
];

async function handleCall(name, args) {
  if (name === 'get_usage') {
    const result = await getOrFetchUsage(false);
    return result.error
      ? `Error: ${result.error}`
      : formatUsage(result);
  }
  if (name === 'refresh_usage') {
    const result = await getOrFetchUsage(true);
    return result.error
      ? `Error: ${result.error}`
      : formatUsage(result);
  }
  if (name === 'set_credentials') {
    const { org_id, session_key } = args;
    if (!org_id || !session_key) return 'Error: org_id and session_key are required.';
    writeConfig({ org_id, session_key });
    // immediate verification fetch
    const result = await getOrFetchUsage(true);
    if (result.error) return `Credentials saved, but fetch failed: ${result.error}`;
    return `Credentials saved. ${formatUsage(result)}`;
  }
  return 'Unknown tool';
}

function formatUsage({ source, data }) {
  if (!data) return 'No usage data available.';
  const fiveH  = ((data.five_hour?.utilization  ?? 0) * 100).toFixed(1);
  const sevenD = ((data.seven_day?.utilization   ?? 0) * 100).toFixed(1);
  const at = data._fetched_at ? ` (fetched ${data._fetched_at})` : '';
  return `Usage${at} [source: ${source}]\n  five_hour:  ${fiveH}%\n  seven_day:  ${sevenD}%`;
}

async function dispatch(msg) {
  const { id, method, params } = msg;

  if (method === 'initialize') {
    return ok(id, {
      protocolVersion: '2024-11-05',
      capabilities: { tools: {} },
      serverInfo: { name: 'safe-pause', version: '2.0.0' },
    });
  }
  if (method === 'notifications/initialized') return; // no response needed
  if (method === 'tools/list') {
    return ok(id, { tools: TOOLS });
  }
  if (method === 'tools/call') {
    const { name, arguments: args = {} } = params;
    const tool = TOOLS.find((t) => t.name === name);
    if (!tool) return err(id, -32601, `Unknown tool: ${name}`);
    try {
      const text = await handleCall(name, args);
      return ok(id, { content: [{ type: 'text', text }] });
    } catch (e) {
      return err(id, -32603, e.message);
    }
  }
  // unknown method — send method not found
  if (id != null) err(id, -32601, `Unknown method: ${method}`);
}

// ── background poller ──────────────────────────────────────────────────────

function startPoller() {
  setInterval(async () => {
    const cfg = readConfig();
    if (cfg.org_id && cfg.session_key) {
      await getOrFetchUsage(true).catch(() => {});
    }
  }, POLL_MS);
}

// ── entry point ────────────────────────────────────────────────────────────

function main() {
  ensureDir();
  startPoller();

  let buf = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => {
    buf += chunk;
    const lines = buf.split('\n');
    buf = lines.pop();
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        dispatch(JSON.parse(trimmed)).catch((e) => {
          process.stderr.write(`[safe-pause] dispatch error: ${e.message}\n`);
        });
      } catch (e) {
        process.stderr.write(`[safe-pause] JSON parse error: ${e.message}\n`);
      }
    }
  });

  process.stdin.on('end', () => process.exit(0));
  process.stderr.write('[safe-pause] MCP server started\n');
}

main();
