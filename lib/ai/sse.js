async function readSseData(response, onData) {
  const reader = response?.body?.getReader?.();
  if (!reader) return { supported: false, eventCount: 0, doneSeen: false };
  const decoder = new TextDecoder();
  let buffer = '';
  let bodyComplete = false;
  let eventCount = 0;
  let doneSeen = false;

  const processBlock = (block) => {
    const data = String(block || '').split('\n')
      .filter(line => line.startsWith('data:'))
      .map(line => line.slice(5).trimStart())
      .join('\n')
      .trim();
    if (!data) return false;
    if (data === '[DONE]') {
      doneSeen = true;
      return true;
    }
    eventCount++;
    onData(data);
    return false;
  };

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) {
        bodyComplete = true;
        break;
      }
      buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n');
      const blocks = buffer.split('\n\n');
      buffer = blocks.pop() || '';
      for (const block of blocks) {
        if (processBlock(block)) return { supported: true, eventCount, doneSeen };
      }
    }
    buffer += decoder.decode().replace(/\r\n/g, '\n');
    if (buffer.trim()) processBlock(buffer);
    return { supported: true, eventCount, doneSeen };
  } finally {
    if (!bodyComplete) await reader.cancel().catch(() => {});
  }
}

function parseJsonSseEvent(data, providerLabel) {
  try {
    return JSON.parse(data);
  } catch {
    console.warn(`[${providerLabel || 'AI provider'}] ignored malformed stream event`);
    return null;
  }
}

module.exports = { readSseData, parseJsonSseEvent };
