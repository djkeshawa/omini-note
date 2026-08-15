// Renders a note's markdown body to a standalone HTML document for export.
// Reuses the editor's inline parser and table converter so exported output
// matches what the editor renders. Attachment images are embedded as data
// URIs, making the exported file fully self-contained.

const markdownRules = require('../src/editor/markdownInputRules.js');
const tableOps = require('../src/editor/tableOps.js');

const MAX_EMBEDDED_IMAGE_BYTES = 20 * 1024 * 1024;

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Plain-text segments still carry wiki links, tags, and block-label syntax.
function renderSpecialText(text) {
  let html = escapeHtml(text);
  html = html.replace(/\{\{label:[a-z0-9_-]+\|([^}]*)\}\}/gi, (_m, label) => `<span class="label">${label}</span>`);
  html = html.replace(/\[\[([^\]]+)\]\]/g, (_m, target) => `<span class="wiki">${target.split('|').pop()}</span>`);
  html = html.replace(/(^|\s)#([a-zA-Z][\w-]*)/g, (_m, lead, tag) => `${lead}<span class="tag">#${tag}</span>`);
  return html;
}

async function renderInline(text, ctx = {}) {
  const segments = markdownRules.parseInlineMarkdown(String(text || ''));
  let out = '';
  for (const segment of segments) {
    if (segment.kind === 'bold') out += `<strong>${renderSpecialText(segment.text)}</strong>`;
    else if (segment.kind === 'italic') out += `<em>${renderSpecialText(segment.text)}</em>`;
    else if (segment.kind === 'strike') out += `<del>${renderSpecialText(segment.text)}</del>`;
    else if (segment.kind === 'code') out += `<code>${escapeHtml(segment.text)}</code>`;
    else if (segment.kind === 'link') {
      out += `<a href="${escapeHtml(segment.url)}">${escapeHtml(segment.label || segment.url)}</a>`;
    } else if (segment.kind === 'image') {
      out += await renderImage(segment, ctx);
    } else {
      out += renderSpecialText(segment.text);
    }
  }
  return out;
}

async function renderImage(segment, ctx) {
  const alt = escapeHtml(segment.label || '');
  const url = String(segment.url || '');
  if (markdownRules.isVaultAttachmentPath && markdownRules.isVaultAttachmentPath(url)) {
    const fileName = url.slice('attachments/'.length);
    const resolved = typeof ctx.resolveAttachment === 'function'
      ? await ctx.resolveAttachment(fileName).catch(() => null)
      : null;
    if (resolved?.buffer && resolved.buffer.length <= MAX_EMBEDDED_IMAGE_BYTES) {
      const mime = resolved.mimeType || 'application/octet-stream';
      return `<img alt="${alt}" src="data:${mime};base64,${resolved.buffer.toString('base64')}">`;
    }
    return `<span class="missing-image">[image: ${escapeHtml(fileName)}]</span>`;
  }
  if (/^https:\/\//.test(url)) return `<img alt="${alt}" src="${escapeHtml(url)}">`;
  return `<span class="missing-image">[image: ${alt || 'unavailable'}]</span>`;
}

function stripStructuredPrefixes(line) {
  // Workflow markers stay as visible text; block labels are handled inline.
  return line;
}

// Soft breaks: two implementations of one rule. The editor's reader is the fold
// loop in `mnMdToBlocks` (src/editor/outline.jsx) — change one and you must
// change the other. The editor writes a Shift+Enter break by doubling the
// broken line's own trailing backslash run and then appending one marker
// backslash, so an odd run ends in a marker (drop it, halve the rest, join to
// the next line with a newline) and an even run is the content's own (halve it,
// join the way a wrapped line always joined: with a space). A run with nothing
// to fold into is left exactly as written, which is what keeps a path like
// C:\notes\ — and every file 0.2.5 wrote before markers existed — printing as
// the user typed it.
const SOFT_BREAK_CONSTRUCT = /^(?:#{1,6}\s|\s*(?:-\s+|\d+[.)]\s+)|>\s|`{3,}|\||---+$|:::)/;

function trailingBackslashRun(line) {
  return (String(line).match(/\\+$/) || [''])[0].length;
}

function readTrailingRun(line, run, fold) {
  if (run % 2 === 1 && !fold) return line;
  return line.slice(0, line.length - run) + '\\'.repeat(fold ? (run - 1) / 2 : run / 2);
}

// Only a continuation line that would read as its own block carries the extra
// leading backslash the editor's writer adds, so stripping it here is exact.
function unescapeConstruct(line) {
  return line.startsWith('\\') && SOFT_BREAK_CONSTRUCT.test(line.replace(/^\\+/, '')) ? line.slice(1) : line;
}

// Folds the soft-break continuations of ONE escaped-kind line — a quote or a
// list item — starting at `start`. Paragraphs keep their own joiner below
// because they also fold ordinary wrapped lines with a space; a quote and a
// list item are single lines that only ever gain a marked break.
//
// Only kinds the editor's writer puts through `mnSoftBreaks` may be decoded
// here. Headings, tables, dividers and fenced code are emitted raw, so running
// the codec over them would halve backslash runs nobody doubled.
function foldSoftBreakLine(lines, start) {
  const folds = (k) => {
    const next = lines[k + 1];
    return trailingBackslashRun(lines[k]) % 2 === 1 && next != null && next.trim() !== ''
      && !SOFT_BREAK_CONSTRUCT.test(next);
  };
  let i = start;
  let fold = folds(i);
  let text = readTrailingRun(lines[i], trailingBackslashRun(lines[i]), fold);
  while (fold) {
    const next = lines[++i];
    fold = folds(i);
    text += '\n' + unescapeConstruct(readTrailingRun(next, trailingBackslashRun(next), fold));
  }
  return { text, endIndex: i };
}

// Joins one paragraph's raw lines: soft-joined lines with '\n', ordinary
// wrapped lines with ' '. A marker on the paragraph's last line has nothing to
// fold into, so it stays literal.
function joinParagraphLines(lines) {
  let text = '';
  let continuation = false;
  for (let k = 0; k < lines.length; k++) {
    const run = trailingBackslashRun(lines[k]);
    const fold = run % 2 === 1 && k + 1 < lines.length;
    const piece = readTrailingRun(lines[k], run, fold);
    // Only a line the previous one folded into is a continuation, so only that
    // line can be carrying the writer's leading escape.
    text += continuation ? unescapeConstruct(piece) : piece;
    if (k + 1 < lines.length) text += fold ? '\n' : ' ';
    continuation = fold;
  }
  return text;
}

async function renderBlocks(body, ctx = {}) {
  const lines = String(body || '').split('\n');
  const parts = [];
  let paragraph = [];
  let listOpen = false;

  const flushParagraph = async () => {
    if (!paragraph.length) return;
    const text = joinParagraphLines(paragraph).trim();
    paragraph = [];
    // renderInline runs over the whole joined string first: escapeHtml leaves
    // \n alone, and inline markdown spanning the break still parses. Inserting
    // <br> first would get it escaped; splitting per line first would break a
    // **bold** run that spans the break.
    if (text) parts.push(`<p>${(await renderInline(text, ctx)).replace(/\n/g, '<br>')}</p>`);
  };
  const closeList = () => {
    if (listOpen) { parts.push('</ul>'); listOpen = false; }
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    const openFence = line.match(/^(`{3,})\s*([A-Za-z0-9_+#.-]*)\s*$/);
    if (openFence) {
      await flushParagraph(); closeList();
      const language = openFence[2];
      // Matches the editor's reader: only a fence at least as long closes the
      // block, so exported code that quotes ``` is not cut off at that line.
      const closeFence = new RegExp(`^\`{${openFence[1].length},}\\s*$`);
      const codeLines = [];
      i++;
      while (i < lines.length && !closeFence.test(lines[i])) { codeLines.push(lines[i]); i++; }
      parts.push(`<pre><code${language ? ` data-language="${escapeHtml(language)}"` : ''}>${escapeHtml(codeLines.join('\n'))}</code></pre>`);
      continue;
    }
    // Plot-points blocks are a single unit in the editor. Mirror its reader
    // (outline.jsx) — including matching the raw line, not the trimmed one — so
    // an exported note shows what the editor shows instead of leaking the :::
    // markers as body text.
    if (/^:::\s*plot-points\s*$/i.test(line)) {
      // Only consume a block that is actually closed. The editor's reader runs
      // to end of input, but an export must never drop prose to a fence someone
      // forgot to close: losing a writer's words is far worse than showing a
      // stray marker. Unterminated, this falls through and renders as text.
      let close = i + 1;
      while (close < lines.length && !/^:::\s*$/.test(lines[close])) close++;
      if (close < lines.length) {
        await flushParagraph(); closeList();
        const beats = [];
        const contexts = [];
        for (let j = i + 1; j < close; j++) {
          const context = lines[j].match(/^\s{2,}-\s*context::\s*(.*)$/i) || lines[j].match(/^\s*context::\s*(.*)$/i);
          const beat = lines[j].match(/^\s*-\s+(.*)$/);
          if (context) contexts.push(context[1].trim());
          else if (beat) beats.push(beat[1].trim());
        }
        const beatItems = [];
        for (const beat of beats) beatItems.push(`<li>${await renderInline(beat, ctx)}</li>`);
        const contextItems = [];
        for (const context of contexts) contextItems.push(`<div class="plot-context">${await renderInline(context, ctx)}</div>`);
        parts.push([
          '<div class="plot-points">',
          '<div class="plot-points-title">Plot Points</div>',
          beatItems.length ? `<ul>${beatItems.join('')}</ul>` : '',
          contextItems.join(''),
          '</div>',
        ].filter(Boolean).join(''));
        i = close;
        continue;
      }
    }
    if (!trimmed) { await flushParagraph(); closeList(); continue; }
    if (/^---+$/.test(trimmed)) { await flushParagraph(); closeList(); parts.push('<hr>'); continue; }

    const heading = trimmed.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      await flushParagraph(); closeList();
      const level = heading[1].length;
      parts.push(`<h${level}>${await renderInline(stripStructuredPrefixes(heading[2]), ctx)}</h${level}>`);
      continue;
    }
    if (/^>\s?/.test(trimmed)) {
      await flushParagraph(); closeList();
      const folded = foldSoftBreakLine(lines, i);
      i = folded.endIndex;
      const quoted = folded.text.trim().replace(/^>\s?/, '');
      parts.push(`<blockquote>${(await renderInline(quoted, ctx)).replace(/\n/g, '<br>')}</blockquote>`);
      continue;
    }
    if (/^\|.*\|$/.test(trimmed)) {
      await flushParagraph(); closeList();
      const tableLines = [line];
      while (i + 1 < lines.length && /^\|.*\|$/.test(lines[i + 1].trim())) { i++; tableLines.push(lines[i]); }
      parts.push(tableOps.markdownTableToHtml(tableLines.join('\n')) || `<p>${escapeHtml(tableLines.join(' '))}</p>`);
      continue;
    }
    // `[^\S\n]*` indent and a `[\s\S]*` tail: after a fold the item holds a \n,
    // and `\s`/`.` would read its second line as the indent or stop at it.
    const foldedItem = foldSoftBreakLine(lines, i);
    const listItem = foldedItem.text.match(/^([^\S\n]*)-\s+(\[( |x|X)\]\s+)?([\s\S]*)$/);
    if (listItem) {
      await flushParagraph();
      i = foldedItem.endIndex;
      if (!listOpen) { parts.push('<ul>'); listOpen = true; }
      const depth = Math.floor((listItem[1] || '').length / 2);
      const isTodo = !!listItem[2];
      const checked = /x/i.test(listItem[3] || '');
      const marker = isTodo ? `<span class="check">${checked ? '☑' : '☐'}</span> ` : '';
      const cls = isTodo && checked ? ' class="done"' : '';
      parts.push(`<li${cls} style="margin-left:${depth * 20}px">${marker}${(await renderInline(listItem[4], ctx)).replace(/\n/g, '<br>')}</li>`);
      continue;
    }
    const property = trimmed.match(/^([a-zA-Z][a-zA-Z0-9_-]*)::\s*(.*)$/);
    if (property) {
      await flushParagraph(); closeList();
      parts.push(`<div class="prop"><span class="prop-key">${escapeHtml(property[1])}</span> ${await renderInline(property[2], ctx)}</div>`);
      continue;
    }
    // A paragraph ends any open list. Without this the paragraph is flushed
    // while <ul> is still open and lands inside it as invalid markup.
    closeList();
    paragraph.push(trimmed);
  }
  await flushParagraph();
  closeList();
  return parts.join('\n');
}

const DOCUMENT_CSS = `
  :root { color-scheme: light; }
  body { font-family: -apple-system, "Segoe UI", Roboto, "Helvetica Neue", sans-serif;
         color: #1f2430; max-width: 760px; margin: 48px auto; padding: 0 24px; line-height: 1.6; }
  h1, h2, h3, h4, h5, h6 { line-height: 1.25; }
  h1.note-title { margin-bottom: 4px; }
  .note-meta { color: #6b7280; font-size: 13px; margin-bottom: 28px; }
  .note-meta .tag, .tag { color: #4b5563; background: #f3f4f6; border: 1px solid #e5e7eb;
         border-radius: 4px; padding: 0 6px; font-size: 0.85em; }
  code { background: #f3f4f6; border: 1px solid #e5e7eb; border-radius: 4px; padding: 1px 5px; font-size: 0.9em; }
  pre { background: #f6f8fa; border: 1px solid #e5e7eb; border-radius: 8px; padding: 14px; overflow-x: auto; }
  pre code { background: none; border: none; padding: 0; }
  blockquote { border-left: 3px solid #d1d5db; margin: 0; padding: 2px 16px; color: #4b5563; }
  table { border-collapse: collapse; margin: 12px 0; }
  th, td { border: 1px solid #d1d5db; padding: 6px 12px; text-align: left; }
  th { background: #f9fafb; }
  ul { padding-left: 22px; }
  li.done { color: #6b7280; text-decoration: line-through; }
  li .check { text-decoration: none; display: inline-block; }
  img { max-width: 100%; border-radius: 8px; }
  hr { border: none; border-top: 1px solid #e5e7eb; margin: 24px 0; }
  .wiki { color: #4f6fd5; border-bottom: 1px dotted #4f6fd5; }
  .prop { font-size: 13px; color: #4b5563; }
  .prop-key { font-weight: 600; }
  .plot-points { border: 1px solid #e5e7eb; border-radius: 8px; padding: 10px 14px;
         margin: 12px 0; background: #fafafa; }
  .plot-points-title { font-size: 12px; font-weight: 600; text-transform: uppercase;
         letter-spacing: 0.04em; color: #6b7280; margin-bottom: 6px; }
  .plot-points ul { margin: 0; }
  .plot-context { font-size: 13px; color: #6b7280; margin-top: 6px; }
  .label { background: #eef2ff; border-radius: 4px; padding: 0 6px; font-size: 0.85em; }
  .missing-image { color: #9ca3af; font-style: italic; }
`;

async function renderNoteHtml(note = {}, ctx = {}) {
  const title = String(note.title || 'Untitled');
  const tags = Array.isArray(note.tags) ? note.tags : [];
  const dateText = note.date ? String(note.date).slice(0, 10) : '';
  const metaParts = [
    dateText ? `<span>${escapeHtml(dateText)}</span>` : '',
    ...tags.map(tag => `<span class="tag">#${escapeHtml(tag)}</span>`),
  ].filter(Boolean);
  const bodyHtml = await renderBlocks(note.body, ctx);
  return [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${escapeHtml(title)}</title>`,
    `<style>${DOCUMENT_CSS}</style>`,
    '</head>',
    '<body>',
    `<h1 class="note-title">${escapeHtml(title)}</h1>`,
    metaParts.length ? `<div class="note-meta">${metaParts.join(' ')}</div>` : '',
    bodyHtml,
    '</body>',
    '</html>',
  ].filter(Boolean).join('\n');
}

function exportMarkdown(note = {}) {
  const title = String(note.title || 'Untitled');
  const body = String(note.body || '');
  return `# ${title}\n\n${body}\n`;
}

module.exports = { renderNoteHtml, exportMarkdown, __test: { renderInline, renderBlocks, escapeHtml } };
