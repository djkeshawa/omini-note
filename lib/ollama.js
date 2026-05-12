// Thin HTTP client for a local Ollama server. Uses Node's built-in fetch
// (Electron 33 → Node 20).

const DEFAULT_HOST = 'http://127.0.0.1:11434';
const DEFAULT_TIMEOUT_MS = 30000;
const STATUS_TIMEOUT_MS = 5000;
const CHAT_TIMEOUT_MS = 180000;
const EMBED_TIMEOUT_MS = 60000;
const OLLAMA_ALLOWED_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]', '::1']);
const OLLAMA_ALLOWED_PORTS = new Set(['11434', '11435', '11436', '11437', '11438', '11439', '11440']);
let hostOverride = null;

function getHost() {
  return hostOverride || process.env.OLLAMA_HOST || DEFAULT_HOST;
}

function validatedHost() {
  const raw = String(getHost() || DEFAULT_HOST).trim().replace(/\/+$/, '');
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error('Invalid Ollama host');
  }
  const port = parsed.port || (parsed.protocol === 'https:' ? '443' : '80');
  if (parsed.protocol !== 'http:' || !OLLAMA_ALLOWED_HOSTS.has(parsed.hostname) || !OLLAMA_ALLOWED_PORTS.has(port)) {
    throw new Error('Ollama host must be local and use port 11434-11440');
  }
  return parsed.href.replace(/\/+$/, '');
}

function setHost(host) {
  const next = String(host || '').trim();
  hostOverride = next || null;
}

function withTimeoutSignal(signal, timeoutMs) {
  if (!timeoutMs) return { signal, cleanup: () => {}, timedOut: () => false };
  const controller = new AbortController();
  let didTimeout = false;
  const onAbort = () => controller.abort(signal.reason);
  if (signal?.aborted) controller.abort(signal.reason);
  else signal?.addEventListener?.('abort', onAbort, { once: true });
  const timer = setTimeout(() => {
    didTimeout = true;
    controller.abort(new Error('Ollama request timed out'));
  }, timeoutMs);
  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timer);
      signal?.removeEventListener?.('abort', onAbort);
    },
    timedOut: () => didTimeout,
  };
}

async function _fetch(path, init = {}, opts = {}) {
  const url = validatedHost() + path;
  const timeout = withTimeoutSignal(init.signal, opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  let shouldCleanup = true;
  try {
    const res = await fetch(url, { ...init, signal: timeout.signal });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Ollama ${res.status} ${res.statusText} at ${path}: ${text.slice(0, 200)}`);
    }
    if (opts.deferCleanup) {
      shouldCleanup = false;
      Object.defineProperty(res, '_mnTimeoutCleanup', {
        value: timeout.cleanup,
        enumerable: false,
        configurable: true,
      });
      Object.defineProperty(res, '_mnTimedOut', {
        value: timeout.timedOut,
        enumerable: false,
        configurable: true,
      });
    }
    return res;
  } catch (e) {
    if (timeout.timedOut()) throw new Error(`Ollama request timed out at ${path}`);
    throw e;
  } finally {
    if (shouldCleanup) timeout.cleanup();
  }
}

async function retryOnce(fn) {
  try { return await fn(); }
  catch (e) {
    if (e?.name === 'AbortError') throw e;
    return await fn();
  }
}

// Probe whether the daemon is up. Resolves to true/false, never throws.
async function ping() {
  try {
    return await retryOnce(async () => {
      const timeout = withTimeoutSignal(null, STATUS_TIMEOUT_MS);
      try {
        const res = await fetch(validatedHost() + '/api/tags', { method: 'GET', signal: timeout.signal });
        return res.ok;
      } finally {
        timeout.cleanup();
      }
    });
  } catch {
    return false;
  }
}

// List installed models: [{ name, size, modified_at, ... }]
async function tags() {
  const res = await retryOnce(() => _fetch('/api/tags', { method: 'GET' }, { timeoutMs: STATUS_TIMEOUT_MS }));
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
  }, { timeoutMs: opts.timeoutMs ?? EMBED_TIMEOUT_MS });
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
  }, { timeoutMs: opts.timeoutMs ?? CHAT_TIMEOUT_MS });
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
  }, { timeoutMs: opts.timeoutMs ?? CHAT_TIMEOUT_MS });
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
  }, { timeoutMs: opts.timeoutMs ?? CHAT_TIMEOUT_MS, deferCleanup: true });
  const reader = res.body?.getReader?.();
  const cleanup = typeof res._mnTimeoutCleanup === 'function' ? res._mnTimeoutCleanup : () => {};
  const timedOut = typeof res._mnTimedOut === 'function' ? res._mnTimedOut : () => false;
  if (!reader) {
    cleanup();
    console.warn('[ollama] streaming response had no readable body; falling back to non-streaming chat');
    return await chat(model, messages, opts);
  }
  const decoder = new TextDecoder();
  let buffer = '';
  let text = '';
  let malformedLines = 0;
  const parseStreamLine = (raw) => {
    try {
      return JSON.parse(raw);
    } catch {
      malformedLines++;
      if (malformedLines <= 3) {
        console.warn('[ollama] ignored malformed stream chunk:', String(raw || '').slice(0, 120));
      }
      return null;
    }
  };
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        const raw = line.trim();
        if (!raw) continue;
        const data = parseStreamLine(raw);
        if (!data) continue;
        if (data.error) throw new Error(`Ollama stream error: ${data.error}`);
        const token = data.message?.content || '';
        if (token) {
          text += token;
          opts.onToken && opts.onToken(token);
        }
      }
    }
    buffer += decoder.decode();
    if (buffer.trim()) {
      const data = parseStreamLine(buffer.trim());
      if (!data) return { text, raw: null };
      if (data.error) throw new Error(`Ollama stream error: ${data.error}`);
      const token = data.message?.content || '';
      if (token) {
        text += token;
        opts.onToken && opts.onToken(token);
      }
    }
    return { text, raw: null };
  } catch (e) {
    if (timedOut() && text) return { text, raw: null, timedOut: true };
    throw e;
  } finally {
    cleanup();
  }
}

module.exports = {
  ping, tags, embed, generate, chat, chatStream,
  DEFAULT_HOST, DEFAULT_TIMEOUT_MS, STATUS_TIMEOUT_MS, CHAT_TIMEOUT_MS, EMBED_TIMEOUT_MS,
  getHost, setHost,
};
