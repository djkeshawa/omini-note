function parseFrontMatter(text) {
  if (!text.startsWith('---\n')) return { meta: {}, body: text };
  const end = text.indexOf('\n---', 4);
  if (end < 0) return { meta: {}, body: text };
  const head = text.slice(4, end);
  const body = text.slice(end + 4).replace(/^\n+/, '');
  const meta = {};
  for (const raw of head.split('\n')) {
    const match = raw.match(/^([a-zA-Z_][a-zA-Z0-9_]*):\s*(.*)$/);
    if (!match) continue;
    let value = match[2].trim();
    if (value === 'true') value = true;
    else if (value === 'false') value = false;
    else if (/^\[.*\]$/.test(value)) {
      value = value.slice(1, -1).split(',').map(item => item.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
    } else if (value.startsWith('"') && value.endsWith('"')) {
      try { value = JSON.parse(value); } catch {}
    }
    meta[match[1]] = value;
  }
  return { meta, body };
}

function serializeFrontMatter(meta, body) {
  const lines = ['---'];
  for (const [key, value] of Object.entries(meta)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      lines.push(`${key}: [${value.map(item => /[,\[\]"]/.test(String(item)) ? JSON.stringify(item) : item).join(', ')}]`);
    } else if (typeof value === 'boolean' || typeof value === 'number') {
      lines.push(`${key}: ${value}`);
    } else {
      const text = String(value);
      lines.push(`${key}: ${/[:#"'\[\]\n]/.test(text) ? JSON.stringify(text) : text}`);
    }
  }
  lines.push('---', '', body || '');
  return lines.join('\n');
}

module.exports = { parseFrontMatter, serializeFrontMatter };
