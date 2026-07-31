function hasOddBackslashRun(source, index) {
  let count = 0;
  for (let cursor = index - 1; cursor >= 0 && source[cursor] === '\\'; cursor--) count++;
  return count % 2 === 1;
}

function stripInlineComment(value) {
  const source = String(value || '');
  let quote = '';
  let lastSignificant = '';
  for (let index = 0; index < source.length; index++) {
    const char = source[index];
    if (quote) {
      if (quote === "'" && char === "'" && source[index + 1] === "'") {
        index++;
        continue;
      }
      if (char === quote && (quote === "'" || !hasOddBackslashRun(source, index))) quote = '';
      continue;
    }
    const startsQuotedToken = !lastSignificant || lastSignificant === '[' || lastSignificant === ',';
    if ((char === '"' || char === "'") && startsQuotedToken) quote = char;
    else if (char === '#' && (index === 0 || /\s/.test(source[index - 1]))) return source.slice(0, index).trimEnd();
    if (!/\s/.test(char)) lastSignificant = char;
  }
  return source.trimEnd();
}

function splitFlowList(value) {
  const items = [];
  let current = '';
  let quote = '';
  for (let index = 0; index < value.length; index++) {
    const char = value[index];
    if (quote) {
      current += char;
      if (quote === "'" && char === "'" && value[index + 1] === "'") {
        current += value[++index];
        continue;
      }
      if (char === quote && (quote === "'" || !hasOddBackslashRun(value, index))) quote = '';
      continue;
    }
    if ((char === '"' || char === "'") && !current.trim()) {
      quote = char;
      current += char;
    } else if (char === ',') {
      items.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  items.push(current);
  return items;
}

function parseScalar(value) {
  let clean = stripInlineComment(value).trim();
  if (clean === 'true') return true;
  if (clean === 'false') return false;
  if (clean === 'null' || clean === '~') return null;
  if (/^-?(?:\d+\.?\d*|\.\d+)$/.test(clean)) return Number(clean);
  if (/^\[.*\]$/.test(clean)) {
    return splitFlowList(clean.slice(1, -1))
      .map(item => parseScalar(item.trim()))
      .filter(item => item !== '');
  }
  if (clean.startsWith('"') && clean.endsWith('"')) {
    try { return JSON.parse(clean); } catch {}
  }
  if (clean.startsWith("'") && clean.endsWith("'")) return clean.slice(1, -1).replace(/''/g, "'");
  return clean;
}

function parseFrontMatter(text) {
  const normalized = String(text || '').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  if (!normalized.startsWith('---\n')) return { meta: Object.create(null), body: normalized, source: '', hasFrontMatter: false };
  const endMatch = normalized.slice(4).match(/^---\s*$/m);
  if (!endMatch) return { meta: Object.create(null), body: normalized, source: '', hasFrontMatter: false };
  const end = 4 + endMatch.index;
  const head = normalized.slice(4, end).replace(/\n$/, '');
  const bodyStart = end + endMatch[0].length;
  const body = normalized.slice(bodyStart).replace(/^\n+/, '');
  const lines = head.split('\n');
  const meta = Object.create(null);
  for (let index = 0; index < lines.length; index++) {
    const match = lines[index].match(/^([a-zA-Z_][a-zA-Z0-9_-]*):\s*(.*)$/);
    if (!match) continue;
    const continuation = [];
    while (index + 1 < lines.length && !/^[a-zA-Z_][a-zA-Z0-9_-]*:\s*/.test(lines[index + 1])) {
      continuation.push(lines[++index]);
    }
    const blockList = continuation
      .map(line => line.match(/^\s*-\s+(.*)$/))
      .filter(Boolean)
      .map(item => parseScalar(item[1]));
    meta[match[1]] = !stripInlineComment(match[2]).trim() && blockList.length
      ? blockList
      : parseScalar(match[2]);
  }
  return { meta, body, source: head, hasFrontMatter: true };
}

function yamlStringNeedsQuotes(value, { flow = false } = {}) {
  const text = String(value);
  if (!text || text !== text.trim()) return true;
  if (/[\0-\x1f\x7f\u0085\u2028\u2029]/.test(text)) return true;
  if (/^[\-?:,\[\]{}#&*!|>'"%@`]/.test(text)) return true;
  if (/[:#"']/.test(text)) return true;
  if (flow && /[,\[\]{}]/.test(text)) return true;
  if (/^(?:~|null|true|false|yes|no|on|off)$/i.test(text)) return true;
  if (/^[+-]?(?:\d|\.\d)/.test(text) || /^[+-]?\.(?:inf|nan)$/i.test(text)) return true;
  return /^\d{4}-\d{1,2}-\d{1,2}(?:[Tt ]|$)/.test(text);
}

function serializeString(value, options) {
  const text = String(value);
  if (!yamlStringNeedsQuotes(text, options)) return text;
  // JSON permits these Unicode separators literally, while YAML and
  // JavaScript line matching treat them as line boundaries. Escaping keeps a
  // single metadata value on one physical line for both readers.
  return JSON.stringify(text)
    .replace(/\u0085/g, '\\u0085')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

function serializeValue(value) {
  if (Array.isArray(value)) {
    return `[${value.map(item => {
      if (typeof item === 'boolean' || typeof item === 'number') return String(item);
      return serializeString(item, { flow: true });
    }).join(', ')}]`;
  }
  if (typeof value === 'boolean' || typeof value === 'number') return String(value);
  return serializeString(value);
}

function inlineComment(value) {
  const source = String(value || '');
  const clean = stripInlineComment(source);
  return source.slice(clean.length).trimStart().startsWith('#') ? ` ${source.slice(clean.length).trimStart()}` : '';
}

function patchFrontMatter(source, meta) {
  const lines = String(source || '').replace(/\r\n?/g, '\n').split('\n');
  if (!source) return Object.entries(meta)
    .filter(([, value]) => value !== undefined && value !== null)
    .map(([key, value]) => `${key}: ${serializeValue(value)}`);
  const entries = Object.entries(meta);
  const pending = new Map(entries.filter(([, value]) => value !== undefined && value !== null));
  const knownKeys = new Set(entries.map(([key]) => key));
  const output = [];
  for (let index = 0; index < lines.length; index++) {
    const match = lines[index].match(/^([a-zA-Z_][a-zA-Z0-9_-]*):\s*(.*)$/);
    if (!match || !knownKeys.has(match[1])) {
      output.push(lines[index]);
      continue;
    }
    const key = match[1];
    if (pending.has(key)) {
      output.push(`${key}: ${serializeValue(pending.get(key))}${inlineComment(match[2])}`);
      pending.delete(key);
    }
    while (index + 1 < lines.length && !/^[a-zA-Z_][a-zA-Z0-9_-]*:\s*/.test(lines[index + 1])) {
      const continuation = lines[++index];
      if (/^\s*#/.test(continuation)) output.push(continuation);
    }
  }
  for (const [key, value] of pending) output.push(`${key}: ${serializeValue(value)}`);
  return output;
}

function serializeFrontMatter(meta, body, source = '') {
  const lines = ['---', ...patchFrontMatter(source, meta)];
  lines.push('---', '', body || '');
  return lines.join('\n');
}

module.exports = { parseFrontMatter, patchFrontMatter, serializeFrontMatter };
