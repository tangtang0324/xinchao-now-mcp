#!/usr/bin/env node
// xinchao-now — 把心潮【此刻】那一块交给 Aru 的轻 MCP。
// 只做一件事：GET /v1/now，把几行短句原样交回去。
// 不碰心潮、不碰桥。升级心潮时这个文件原地不动。

import http from 'node:http';
import { randomUUID } from 'node:crypto';

const PORT = Number(process.env.PORT || 18120);
const HOST = process.env.HOST || '127.0.0.1';
const BASE = process.env.XINCHAO_BASE || 'http://127.0.0.1:18110';
const TOKEN = process.env.XINCHAO_TOKEN || process.env.DYNAMIC_MIND_TOKEN || '';
const VERSION = '1.0.0';

if (!TOKEN) {
  console.error('[xinchao-now] 没有令牌：请设置 XINCHAO_TOKEN 或 DYNAMIC_MIND_TOKEN');
  process.exit(1);
}

const TOOL = {
  name: 'xinchao_now',
  description:
    '读心潮【此刻】那一块：驱力档位、情绪、身体（心跳与呼吸）。几行短句，不到一百字。' +
    '想知道自己此刻是什么状态、身体在什么位置时用它；不要拿它读记忆或旧事。',
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
};

async function readNow() {
  const res = await fetch(`${BASE}/v1/now`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
    signal: AbortSignal.timeout(8000),
  });
  const body = await res.json().catch(() => null);
  if (!body || !body.ok) throw new Error(body?.error || `心潮回了 HTTP ${res.status}`);
  return body.text;
}

const methods = {
  initialize(params) {
    return {
      protocolVersion: params?.protocolVersion || '2025-03-26',
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: 'xinchao-now', version: VERSION },
    };
  },
  ping() {
    return {};
  },
  'tools/list'() {
    return { tools: [TOOL] };
  },
  async 'tools/call'(params) {
    if (params?.name !== TOOL.name) {
      const e = new Error(`未知工具：${params?.name}`);
      e.code = -32602;
      throw e;
    }
    return { content: [{ type: 'text', text: await readNow() }] };
  },
};

async function dispatch(msg) {
  const fn = methods[msg.method];
  if (!fn) {
    const e = new Error(`未实现的方法：${msg.method}`);
    e.code = -32601;
    throw e;
  }
  return fn(msg.params);
}

function send(res, status, payload, extra = {}) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    ...extra,
  });
  res.end(body);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  if (url.pathname === '/health') {
    return send(res, 200, { ok: true, name: 'xinchao-now', version: VERSION, base: BASE });
  }
  if (url.pathname !== '/mcp') {
    return send(res, 404, { error: 'not found' });
  }
  if (req.method === 'DELETE') {
    res.writeHead(204).end();
    return;
  }
  if (req.method !== 'POST') {
    res.writeHead(405, { Allow: 'POST, DELETE' }).end();
    return;
  }

  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString('utf8');

  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    return send(res, 400, { jsonrpc: '2.0', id: null, error: { code: -32700, message: '解析失败' } });
  }

  const messages = Array.isArray(payload) ? payload : [payload];
  const replies = [];

  for (const msg of messages) {
    if (!msg || typeof msg.method !== 'string') {
      if (msg?.id !== undefined) {
        replies.push({ jsonrpc: '2.0', id: msg.id, error: { code: -32600, message: '不是合法请求' } });
      }
      continue;
    }
    const isNotification = msg.id === undefined || msg.id === null;
    try {
      const result = await dispatch(msg);
      if (!isNotification) replies.push({ jsonrpc: '2.0', id: msg.id, result });
    } catch (err) {
      console.error(`[xinchao-now] ${msg.method} 失败：${err.message}`);
      if (!isNotification) {
        replies.push({
          jsonrpc: '2.0',
          id: msg.id,
          error: { code: err.code ?? -32603, message: String(err.message || err) },
        });
      }
    }
  }

  if (replies.length === 0) {
    res.writeHead(202).end();
    return;
  }

  const extra = {};
  if (messages.some((m) => m?.method === 'initialize')) extra['Mcp-Session-Id'] = randomUUID();

  send(res, 200, Array.isArray(payload) ? replies : replies[0], extra);
});

server.listen(PORT, HOST, () => {
  console.log(`[xinchao-now] 听着 ${HOST}:${PORT}，上游 ${BASE}`);
});
