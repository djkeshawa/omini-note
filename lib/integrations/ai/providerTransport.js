const dns = require('node:dns');
const http = require('node:http');
const https = require('node:https');
const net = require('node:net');
const { Readable } = require('node:stream');

const DEFAULT_PROVIDER_TIMEOUT_MS = 45000;
const MAX_PROVIDER_BODY_BYTES = 10 * 1024 * 1024;
const MAX_PROVIDER_REDIRECTS = 3;

const defaultTransportDependencies = Object.freeze({
  lookup: (hostname, options) => dns.promises.lookup(hostname, options),
  request: https.request,
});
let transportDependencyOverrides = null;

// The timeout is idle-based for streams: touch() re-arms it, and the stream
// reader touches it on every chunk that arrives. A generation is only cut off
// when the provider goes quiet, not for taking longer than the budget — a
// 45-second total cap silently truncated any long answer, and the caller got
// partial text with no failure to notice.
function withProviderTimeoutSignal(signal, timeoutMs = DEFAULT_PROVIDER_TIMEOUT_MS) {
  const controller = new AbortController();
  let didTimeout = false;
  let timer = null;
  const onAbort = () => controller.abort(signal.reason);
  if (signal?.aborted) controller.abort(signal.reason);
  else signal?.addEventListener?.('abort', onAbort, { once: true });
  const arm = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      didTimeout = true;
      controller.abort(new Error('Provider request timed out'));
    }, timeoutMs);
    timer.unref?.();
  };
  arm();
  return {
    signal: controller.signal,
    timedOut: () => didTimeout,
    touch: () => { if (!didTimeout && !controller.signal.aborted) arm(); },
    cleanup: () => {
      clearTimeout(timer);
      signal?.removeEventListener?.('abort', onAbort);
    },
  };
}

function scrubSecretText(value) {
  return String(value || '')
    .replace(/([?&](?:key|api[_-]?key|token|access[_-]?token)=)[^&\s]+/gi, '$1[redacted]')
    .replace(/(authorization:\s*bearer\s+)[^\s,;]+/gi, '$1[redacted]')
    .replace(/((?:x-)?api-key:\s*)[^\s,;]+/gi, '$1[redacted]')
    .replace(/("(?:api[_-]?key|access[_-]?token|authorization)"\s*:\s*")[^"]+/gi, '$1[redacted]');
}

function normalizeHostname(hostname) {
  return String(hostname || '')
    .replace(/^\[|\]$/g, '')
    .trim()
    .toLowerCase()
    .replace(/%2e/gi, '.')
    .replace(/\.+$/g, '');
}

function ipv4FromMappedIpv6(hostname) {
  const host = normalizeHostname(hostname);
  const prefixes = ['::ffff:', '0:0:0:0:0:ffff:'];
  const prefix = prefixes.find(item => host.startsWith(item));
  if (!prefix) return '';
  const value = host.slice(prefix.length);
  if (net.isIP(value) === 4) return value;
  const match = value.match(/^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (!match) return '';
  const high = Number.parseInt(match[1], 16);
  const low = Number.parseInt(match[2], 16);
  return `${(high >> 8) & 255}.${high & 255}.${(low >> 8) & 255}.${low & 255}`;
}

function isNonGlobalIp(address) {
  const host = normalizeHostname(address);
  const version = net.isIP(host);
  if (version === 4) {
    const parts = host.split('.').map(Number);
    const [a, b, c] = parts;
    return a === 0
      || a === 10
      || a === 127
      || a >= 224
      || (a === 100 && b >= 64 && b <= 127)
      || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 0 && c === 0)
      || (a === 192 && b === 0 && c === 2)
      || (a === 192 && b === 88 && c === 99)
      || (a === 192 && b === 168)
      || (a === 198 && (b === 18 || b === 19))
      || (a === 198 && b === 51 && c === 100)
      || (a === 203 && b === 0 && c === 113);
  }
  if (version === 6) {
    const mappedIpv4 = ipv4FromMappedIpv6(host);
    if (mappedIpv4) return isNonGlobalIp(mappedIpv4);
    if (host === '::' || host === '::1') return true;
    const [firstText = '0', secondText = '0'] = host.split(':');
    const first = Number.parseInt(firstText || '0', 16);
    const second = Number.parseInt(secondText || '0', 16);
    if (first < 0x2000 || first > 0x3fff) return true;
    if (first === 0x2001 && (
      second === 0x0000
      || second === 0x0002
      || second === 0x0db8
      || (second >= 0x0010 && second <= 0x002f)
    )) {
      return true;
    }
    // Transitional addresses can encapsulate a different destination and
    // should not bypass the direct-address allowlist.
    if (first === 0x2002) return true;
    if (first === 0x3fff) return true;
    return false;
  }
  return true;
}

function embeddedIpv4FromWildcardDns(hostname) {
  const host = normalizeHostname(hostname);
  const suffix = ['.nip.io', '.sslip.io'].find(item => host.endsWith(item));
  if (!suffix) return '';
  const match = host.slice(0, -suffix.length)
    .match(/(?:^|[.-])(\d{1,3})[.-](\d{1,3})[.-](\d{1,3})[.-](\d{1,3})$/);
  if (!match) return '';
  const parts = match.slice(1).map(Number);
  return parts.every(part => Number.isInteger(part) && part >= 0 && part <= 255)
    ? parts.join('.')
    : '';
}

function isUnsafeHostname(hostname) {
  const host = normalizeHostname(hostname);
  if (!host || host === 'localhost' || host.endsWith('.localhost')) return true;
  const embeddedIpv4 = embeddedIpv4FromWildcardDns(host);
  if (embeddedIpv4 && isNonGlobalIp(embeddedIpv4)) return true;
  return net.isIP(host) ? isNonGlobalIp(host) : false;
}

function assertSafeProviderUrl(value) {
  let parsed;
  try {
    parsed = value instanceof URL ? new URL(value.href) : new URL(String(value || ''));
  } catch {
    throw new Error('Invalid hosted provider URL');
  }
  if (parsed.protocol !== 'https:') throw new Error('Hosted provider URL must use HTTPS');
  if (parsed.username || parsed.password) throw new Error('Hosted provider URL cannot contain credentials');
  if (isUnsafeHostname(parsed.hostname)) throw new Error('Hosted provider URL cannot target a local or non-global host');
  return parsed;
}

function transportDependencies(options = {}) {
  return {
    ...defaultTransportDependencies,
    ...(transportDependencyOverrides || {}),
    ...(options.dependencies || {}),
  };
}

function setTransportDependenciesForTests(overrides) {
  const previous = transportDependencyOverrides;
  transportDependencyOverrides = overrides ? { ...overrides } : null;
  return () => {
    transportDependencyOverrides = previous;
  };
}

function abortable(promise, signal) {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(signal.reason || new Error('Provider request aborted'));
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(signal.reason || new Error('Provider request aborted'));
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      value => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      error => {
        signal.removeEventListener('abort', onAbort);
        reject(error);
      }
    );
  });
}

async function resolvePublicAddress(parsed, dependencies, signal) {
  const hostname = normalizeHostname(parsed.hostname);
  const results = net.isIP(hostname)
    ? [{ address: hostname, family: net.isIP(hostname) }]
    : await abortable(
      Promise.resolve(dependencies.lookup(hostname, { all: true, verbatim: true })),
      signal
    );
  const addresses = (Array.isArray(results) ? results : [results])
    .map(result => ({
      address: normalizeHostname(result?.address),
      family: Number(result?.family) || net.isIP(normalizeHostname(result?.address)),
    }))
    .filter(result => result.address && result.family);
  if (!addresses.length) throw new Error(`Hosted provider hostname ${hostname} did not resolve`);
  if (addresses.some(result => isNonGlobalIp(result.address))) {
    throw new Error(`Hosted provider hostname ${hostname} resolved to a non-global address`);
  }
  return addresses[0];
}

function pinnedLookup(address) {
  return (_hostname, options, callback) => {
    const lookupOptions = typeof options === 'object' && options ? options : {};
    const done = typeof options === 'function' ? options : callback;
    if (lookupOptions.all) done(null, [address]);
    else done(null, address.address, address.family);
  };
}

function requestOnce(parsed, init, address, dependencies, signal) {
  const hostname = normalizeHostname(parsed.hostname);
  const body = init?.body;
  const headers = { ...(init?.headers || {}) };
  delete headers.host;
  delete headers.Host;
  return new Promise((resolve, reject) => {
    let settled = false;
    let request;
    try {
      request = dependencies.request({
        protocol: 'https:',
        hostname,
        port: parsed.port || 443,
        method: init?.method || 'GET',
        path: `${parsed.pathname}${parsed.search}`,
        headers,
        lookup: pinnedLookup(address),
        servername: net.isIP(hostname) ? undefined : hostname,
        signal,
      }, response => {
        settled = true;
        resolve(response);
      });
    } catch (error) {
      reject(error);
      return;
    }
    request.once('error', error => {
      if (!settled) reject(error);
    });
    try {
      if (body != null) request.write(body);
      request.end();
    } catch (error) {
      request.destroy?.();
      reject(error);
    }
  });
}

function redirectLocation(response) {
  const status = Number(response?.statusCode);
  if (![301, 302, 303, 307, 308].includes(status)) return '';
  return String(response.headers?.location || '');
}

async function requestSafeResponse(url, init, timeout, options = {}) {
  const dependencies = transportDependencies(options);
  let parsed = assertSafeProviderUrl(url);
  for (let redirectCount = 0; ; redirectCount++) {
    const address = await resolvePublicAddress(parsed, dependencies, timeout.signal);
    const response = await requestOnce(parsed, init, address, dependencies, timeout.signal);
    const location = redirectLocation(response);
    if (!location) return response;
    response.resume?.();
    if (redirectCount >= MAX_PROVIDER_REDIRECTS) throw new Error('Hosted provider redirected too many times');
    const next = assertSafeProviderUrl(new URL(location, parsed));
    if (next.origin !== parsed.origin) throw new Error('Hosted provider cross-origin redirects are not allowed');
    const method = String(init?.method || 'GET').toUpperCase();
    if (!['GET', 'HEAD'].includes(method) && ![307, 308].includes(Number(response.statusCode))) {
      throw new Error('Hosted provider attempted an unsafe method-changing redirect');
    }
    parsed = next;
  }
}

function responseBody(response) {
  if (response?.body?.getReader) return response.body;
  return Readable.toWeb(response);
}

async function readBodyText(body, maxBytes = MAX_PROVIDER_BODY_BYTES) {
  const reader = body?.getReader?.();
  if (!reader) return '';
  const decoder = new TextDecoder();
  let size = 0;
  let text = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel().catch(() => {});
      throw new Error('Hosted provider response was too large');
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

function wrapResponse(response) {
  const body = responseBody(response);
  const status = Number(response?.statusCode ?? response?.status ?? 0);
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: response?.statusMessage || response?.statusText || http.STATUS_CODES[status] || '',
    headers: response?.headers || {},
    body,
    text: () => readBodyText(body),
    async json() {
      const text = await readBodyText(body);
      return JSON.parse(text);
    },
  };
}

async function providerFetch(url, init, providerLabel, options = {}) {
  const timeout = withProviderTimeoutSignal(init?.signal, options.timeoutMs ?? DEFAULT_PROVIDER_TIMEOUT_MS);
  try {
    const response = wrapResponse(await requestSafeResponse(url, init, timeout, options));
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(scrubSecretText(`${providerLabel} ${response.status} ${response.statusText}: ${text.slice(0, 220)}`));
    }
    return await response.json();
  } catch (error) {
    if (timeout.timedOut()) throw new Error(`${providerLabel} request timed out`);
    throw new Error(scrubSecretText(error?.message || error));
  } finally {
    timeout.cleanup();
  }
}

async function providerFetchStream(url, init, providerLabel, options = {}) {
  const timeout = withProviderTimeoutSignal(init?.signal, options.timeoutMs ?? DEFAULT_PROVIDER_TIMEOUT_MS);
  try {
    const response = wrapResponse(await requestSafeResponse(url, init, timeout, options));
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      timeout.cleanup();
      throw new Error(scrubSecretText(`${providerLabel} ${response.status} ${response.statusText}: ${text.slice(0, 220)}`));
    }
    return { response, res: response, timedOut: timeout.timedOut, cleanup: timeout.cleanup, touch: timeout.touch };
  } catch (error) {
    timeout.cleanup();
    if (timeout.timedOut()) throw new Error(`${providerLabel} request timed out`);
    throw new Error(scrubSecretText(error?.message || error));
  }
}

function createPiiTokenEmitter(replacements, onToken, restorePiiText) {
  if (typeof onToken !== 'function') return { push() {}, flush() {} };
  if (!replacements?.length) return { push: onToken, flush() {} };
  const maxPlaceholderLength = replacements.reduce(
    (max, item) => Math.max(max, String(item.placeholder || '').length),
    12
  ) + 4;
  let buffer = '';
  const emit = (text) => {
    if (text) onToken(restorePiiText(text, replacements));
  };
  return {
    push(chunk) {
      buffer += String(chunk || '');
      if (buffer.length <= maxPlaceholderLength * 2) return;
      let cut = buffer.length - maxPlaceholderLength * 2;
      const open = buffer.lastIndexOf('[', cut);
      if (open >= Math.max(0, cut - maxPlaceholderLength)) cut = open;
      if (cut <= 0) return;
      emit(buffer.slice(0, cut));
      buffer = buffer.slice(cut);
    },
    flush() {
      emit(buffer);
      buffer = '';
    },
  };
}

module.exports = {
  DEFAULT_PROVIDER_TIMEOUT_MS,
  MAX_PROVIDER_REDIRECTS,
  assertSafeProviderUrl,
  createPiiTokenEmitter,
  isNonGlobalIp,
  isUnsafeHostname,
  providerFetch,
  providerFetchStream,
  scrubSecretText,
  setTransportDependenciesForTests,
  withProviderTimeoutSignal,
};
