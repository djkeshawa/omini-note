(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.MN_TABLE_OPS = api;
})(typeof globalThis !== 'undefined' ? globalThis : window, function () {
  function cleanCell(value) {
    return String(value == null ? '' : value)
      .replace(/\u00a0/g, ' ')
      .replace(/\r?\n+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function escapeMarkdownCell(value) {
    return cleanCell(value).replace(/\\/g, '\\\\').replace(/\|/g, '\\|');
  }

  function normalizeRows(rows) {
    const cleanRows = (rows || [])
      .map(row => (row || []).map(cleanCell))
      .filter(row => row.some(cell => cell.length > 0));
    const width = Math.max(0, ...cleanRows.map(row => row.length));
    if (!width) return [];
    return cleanRows.map(row => {
      const next = row.slice(0, width);
      while (next.length < width) next.push('');
      return next;
    });
  }

  function rowsToMarkdownTable(rows) {
    const normalized = normalizeRows(rows);
    if (!normalized.length) return '';
    const width = normalized[0].length;
    const line = row => `| ${row.map(escapeMarkdownCell).join(' | ')} |`;
    return [
      line(normalized[0]),
      `| ${Array.from({ length: width }, () => '---').join(' | ')} |`,
      ...normalized.slice(1).map(line),
    ].join('\n');
  }

  function splitMarkdownRow(line) {
    let text = String(line || '').trim();
    if (text.startsWith('|')) text = text.slice(1);
    if (text.endsWith('|')) text = text.slice(0, -1);
    const cells = [];
    let current = '';
    let escaped = false;
    for (const ch of text) {
      if (escaped) {
        current += ch;
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === '|') {
        cells.push(cleanCell(current));
        current = '';
      } else {
        current += ch;
      }
    }
    cells.push(cleanCell(current));
    return cells;
  }

  function isMarkdownTableSeparator(line) {
    const cells = splitMarkdownRow(line);
    return cells.length >= 2 && cells.every(cell => /^:?-{3,}:?$/.test(cell.replace(/\s+/g, '')));
  }

  function isMarkdownTable(text) {
    const lines = String(text || '').trim().split(/\r?\n/).filter(Boolean);
    return lines.length >= 2 && lines[0].includes('|') && isMarkdownTableSeparator(lines[1]);
  }

  function markdownTableToRows(text) {
    if (!isMarkdownTable(text)) return [];
    const lines = String(text || '').trim().split(/\r?\n/).filter(Boolean);
    return normalizeRows([splitMarkdownRow(lines[0]), ...lines.slice(2).map(splitMarkdownRow)]);
  }

  function normalizeMarkdownTable(text) {
    const rows = markdownTableToRows(text);
    return rows.length ? rowsToMarkdownTable(rows) : '';
  }

  function readMarkdownTable(lines, startIndex) {
    if (!Array.isArray(lines) || startIndex < 0 || startIndex >= lines.length - 1) return null;
    const first = lines[startIndex];
    const second = lines[startIndex + 1];
    if (!String(first || '').includes('|') || !isMarkdownTableSeparator(second)) return null;
    const tableLines = [first, second];
    let i = startIndex + 2;
    while (i < lines.length && String(lines[i] || '').includes('|') && String(lines[i] || '').trim()) {
      tableLines.push(lines[i]);
      i++;
    }
    return {
      markdown: normalizeMarkdownTable(tableLines.join('\n')),
      endIndex: i - 1,
    };
  }

  function parseDelimitedText(text) {
    const raw = String(text || '').trim();
    if (!raw || !raw.includes('\t')) return [];
    const rows = raw.split(/\r?\n/).map(line => line.split('\t'));
    const normalized = normalizeRows(rows);
    return normalized.length && normalized[0].length >= 2 ? normalized : [];
  }

  function htmlTableToRows(html) {
    const source = String(html || '');
    if (!/<table[\s>]/i.test(source)) return [];
    if (typeof DOMParser !== 'undefined') {
      const doc = new DOMParser().parseFromString(source, 'text/html');
      const table = doc.querySelector('table');
      if (!table) return [];
      return normalizeRows([...table.querySelectorAll('tr')].map(tr =>
        [...tr.querySelectorAll('th,td')].map(cell => cell.textContent || '')
      ));
    }
    const tableMatch = source.match(/<table[\s\S]*?<\/table>/i);
    if (!tableMatch) return [];
    const rowMatches = tableMatch[0].match(/<tr[\s\S]*?<\/tr>/gi) || [];
    return normalizeRows(rowMatches.map(row => {
      const cells = row.match(/<t[dh][\s\S]*?<\/t[dh]>/gi) || [];
      return cells.map(cell => cleanCell(cell.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '')));
    }));
  }

  function clipboardToMarkdownTable({ html, text } = {}) {
    const htmlRows = htmlTableToRows(html);
    if (htmlRows.length) return rowsToMarkdownTable(htmlRows);
    if (isMarkdownTable(text)) return normalizeMarkdownTable(text);
    const delimitedRows = parseDelimitedText(text);
    if (delimitedRows.length) return rowsToMarkdownTable(delimitedRows);
    return '';
  }

  function clipboardEventToMarkdownTable(event) {
    const data = event && event.clipboardData;
    if (!data) return '';
    return clipboardToMarkdownTable({
      html: data.getData('text/html'),
      text: data.getData('text/plain'),
    });
  }

  function markdownTableToHtml(text) {
    const rows = markdownTableToRows(text);
    if (!rows.length) return '';
    const esc = value => cleanCell(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
    const head = `<thead><tr>${rows[0].map(cell => `<th>${esc(cell)}</th>`).join('')}</tr></thead>`;
    const body = rows.slice(1).length
      ? `<tbody>${rows.slice(1).map(row => `<tr>${row.map(cell => `<td>${esc(cell)}</td>`).join('')}</tr>`).join('')}</tbody>`
      : '';
    return `<table>${head}${body}</table>`;
  }

  return {
    cleanCell,
    normalizeRows,
    rowsToMarkdownTable,
    isMarkdownTableSeparator,
    isMarkdownTable,
    markdownTableToRows,
    normalizeMarkdownTable,
    readMarkdownTable,
    parseDelimitedText,
    htmlTableToRows,
    clipboardToMarkdownTable,
    clipboardEventToMarkdownTable,
    markdownTableToHtml,
  };
});
