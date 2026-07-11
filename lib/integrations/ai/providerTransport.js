const DEFAULT_PROVIDER_TIMEOUT_MS = 45000;

function withProviderTimeoutSignal(signal, timeoutMs = DEFAULT_PROVIDER_TIMEOUT_MS) {
  const controller = new AbortController();
  let didTimeout = false;
  const onAbort = () => controller.abort(signal.reason);
  if (signal?.aborted) controller.abort(signal.reason);
  else signal?.addEventListener?.('abort', onAbort, { once: true });
  const timer = setTimeout(() => {
    didTimeout = true;
    controller.abort(new Error('Provider request timed out'));
  }, timeoutMs);
  return {
    signal: controller.signal,
    timedOut: () => didTimeout,
    cleanup: () => {
      clearTimeout(timer);
      signal?.removeEventListener?.('abort', onAbort);
    },
  };
}

function scrubSecretText(value) {
  return String(value || '')
    .replace(/([?&]key=)[^&\s]+/gi, '$1[redacted]')
    .replace(/(authorization:\s*bearer\s+)[^\s,;]+/gi, '$1[redacted]')
    .replace(/(x-api-key:\s*)[^\s,;]+/gi, '$1[redacted]');
}

async function providerFetch(url, init, providerLabel, options = {}) {
  const timeout = withProviderTimeoutSignal(init?.signal, options.timeoutMs ?? DEFAULT_PROVIDER_TIMEOUT_MS);
  try {
    const response = await fetch(url, { ...init, signal: timeout.signal });
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
    const response = await fetch(url, { ...init, signal: timeout.signal });
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      timeout.cleanup();
      throw new Error(scrubSecretText(`${providerLabel} ${response.status} ${response.statusText}: ${text.slice(0, 220)}`));
    }
    return { response, res: response, timedOut: timeout.timedOut, cleanup: timeout.cleanup };
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
  createPiiTokenEmitter,
  providerFetch,
  providerFetchStream,
  scrubSecretText,
  withProviderTimeoutSignal,
};
