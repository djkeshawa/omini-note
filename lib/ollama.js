// Thin HTTP client for a local Ollama server. Uses Node's built-in fetch
// (Electron 33 → Node 20).

const DEFAULT_HOST = 'http://127.0.0.1:11434';
let hostOverride = null;

function getHost() {
  return hostOverride || process.env.OLLAMA_HOST || DEFAULT_HOST;
}

function setHost(host) {
  const next = String(host || '').trim();
  hostOverride = next || null;
}

async function _fetch(path, init) {
  const url = getHost() + path;
  const res = await fetch(url, init);
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Ollama ${res.status} ${res.statusText} at ${path}: ${text.slice(0, 200)}`);
  }
  return res;
}

// Probe whether the daemon is up. Resolves to true/false, never throws.
async function ping() {
  try {
    const res = await fetch(getHost() + '/api/tags', { method: 'GET' });
    return res.ok;
  } catch {
    return false;
  }
}

// List installed models: [{ name, size, modified_at, ... }]
async function tags() {
  const res = await _fetch('/api/tags', { method: 'GET' });
  const data = await res.json();
  return data.models || [];
}

// Embed a single string. Returns Float32Array.
async function embed(model, text, opts = {}) {
  const res = await _fetch('/api/embeddings', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    signal: opts.signal,
    body: JSON.stringify({ model, prompt: text, keep_alive: opts.keep_alive }),
  });
  const data = await res.json();
  if (!Array.isArray(data.embedding)) {
    throw new Error('Ollama embeddings: unexpected response shape');
  }
  return Float32Array.from(data.embedding);
}

// Generate a completion for a prompt. Non-streaming. Returns { text, ... }.
async function generate(model, prompt, opts = {}) {
  const res = await _fetch('/api/generate', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    signal: opts.signal,
    body: JSON.stringify({
      model, prompt, stream: false,
      options: opts.options || {},
      keep_alive: opts.keep_alive,
    }),
  });
  const data = await res.json();
  return { text: data.response || '', raw: data };
}

// Chat-style completion with messages. Non-streaming.
// messages = [{ role: 'system'|'user'|'assistant', content: '...' }, ...]
async function chat(model, messages, opts = {}) {
  const res = await _fetch('/api/chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    signal: opts.signal,
    body: JSON.stringify({
      model, messages, stream: false,
      options: opts.options || {},
      keep_alive: opts.keep_alive,
    }),
  });
  const data = await res.json();
  return { text: data.message?.content || '', raw: data };
}

// Chat-style completion with incremental token callbacks.
async function chatStream(model, messages, opts = {}) {
  const res = await _fetch('/api/chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    signal: opts.signal,
    body: JSON.stringify({
      model, messages, stream: true,
      options: opts.options || {},
      keep_alive: opts.keep_alive,
    }),
  });
  const reader = res.body?.getReader?.();
  if (!reader) return await chat(model, messages, opts);
  const decoder = new TextDecoder();
  let buffer = '';
  let text = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const line of lines) {
      const raw = line.trim();
      if (!raw) continue;
      const data = JSON.parse(raw);
      const token = data.message?.content || '';
      if (token) {
        text += token;
        opts.onToken && opts.onToken(token);
      }
    }
  }
  buffer += decoder.decode();
  if (buffer.trim()) {
    const data = JSON.parse(buffer.trim());
    const token = data.message?.content || '';
    if (token) {
      text += token;
      opts.onToken && opts.onToken(token);
    }
  }
  return { text, raw: null };
}

module.exports = { ping, tags, embed, generate, chat, chatStream, DEFAULT_HOST, getHost, setHost };
