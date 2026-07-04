(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.MN_MARKDOWN_INPUT_RULES = api;
})(typeof globalThis !== 'undefined' ? globalThis : window, function () {
  const BLOCK_STARTERS = [
    { marker: '- [ ] ', kind: 'todo', checked: false },
    { marker: '- [x] ', kind: 'todo', checked: true },
    { marker: '- [X] ', kind: 'todo', checked: true },
    { marker: '###### ', kind: 'heading', level: 6 },
    { marker: '##### ', kind: 'heading', level: 5 },
    { marker: '#### ', kind: 'heading', level: 4 },
    { marker: '### ', kind: 'heading', level: 3 },
    { marker: '## ', kind: 'heading', level: 2 },
    { marker: '# ', kind: 'heading', level: 1 },
    { marker: '- ', kind: 'bullet' },
    { marker: '> ', kind: 'quote' },
    { marker: '```', kind: 'code', language: '' },
    { marker: '---', kind: 'divider' },
  ];

  const INLINE_MARKERS = [
    { kind: 'bold', marker: '**' },
    { kind: 'italic', marker: '*' },
    { kind: 'code', marker: '`' },
    { kind: 'strike', marker: '~~' },
    { kind: 'link', marker: '[]()' },
    { kind: 'image', marker: '![]()' },
  ];

  const VAULT_ATTACHMENT_PATH_RE = /^attachments\/[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/;

  const SPECIALIZED_BLOCK_KINDS = new Set(['code', 'table', 'plot-points']);
  const NON_PLAIN_BLOCK_KINDS = new Set(['heading', 'bullet', 'todo', 'quote', 'code', 'table', 'divider', 'plot-points']);
  const TODO_CONTINUATION_MARKERS = [
    { marker: '[ ] ', checked: false },
    { marker: '[x] ', checked: true },
    { marker: '[X] ', checked: true },
  ];

  function asText(value) {
    return String(value == null ? '' : value);
  }

  function normalizeCursor(text, cursor) {
    const value = asText(text);
    if (cursor == null) return value.length;
    return Math.max(0, Math.min(value.length, Number(cursor) || 0));
  }

  function isPlainEditableBlock(block) {
    const kind = asText(block?.kind || 'paragraph');
    return !NON_PLAIN_BLOCK_KINDS.has(kind);
  }

  function isSpecializedPlainContext(text) {
    const value = asText(text);
    const trimmed = value.trim();
    return /^\|.*\|$/.test(trimmed)
      || /^```/.test(trimmed)
      || /^:::\s*plot-points\b/i.test(trimmed)
      || /^\{\{label:[a-z0-9_-]+\|[^}]*\}\}/i.test(trimmed)
      || /^[a-zA-Z][a-zA-Z0-9_-]*::/.test(trimmed)
      || /^\[\[[^\]]+\]\]$/.test(trimmed)
      || /^#[a-zA-Z][\w-]*$/.test(trimmed)
      || /^@remind\b/.test(trimmed);
  }

  function shouldHandleTextInput(inputType) {
    return inputType === 'insertText';
  }

  function shouldSkipMarkdownInputRules(block, text) {
    const kind = asText(block?.kind || 'paragraph');
    return SPECIALIZED_BLOCK_KINDS.has(kind) || isSpecializedPlainContext(text);
  }

  function blockStarterPatch(starter) {
    return {
      kind: starter.kind,
      level: starter.level || 0,
      checked: Object.prototype.hasOwnProperty.call(starter, 'checked') ? starter.checked : null,
      content: '',
      language: starter.language || '',
    };
  }

  function structuralEditPrefix(block) {
    const kind = asText(block?.kind || 'paragraph');
    if (kind === 'heading') return `${'#'.repeat(Math.max(1, Math.min(6, Number(block?.level) || 1)))} `;
    if (kind === 'bullet') return '- ';
    if (kind === 'todo') return block?.checked ? '- [x] ' : '- [ ] ';
    if (kind === 'quote') return '> ';
    return '';
  }

  function editableMarkdownForBlock(block) {
    if (!block) return '';
    if (block.kind === 'divider') return '---';
    return structuralEditPrefix(block) + asText(block.content);
  }

  function editorOffsetToContentOffset(block, offset) {
    const prefix = structuralEditPrefix(block);
    return Math.max(0, Number(offset) - prefix.length || 0);
  }

  function contentOffsetToEditorOffset(block, offset) {
    const prefix = structuralEditPrefix(block);
    return prefix.length + Math.max(0, Number(offset) || 0);
  }

  function displayProjectionForMarkdownSourceBlock(block) {
    if (asText(block?.kind || 'paragraph') !== 'paragraph') return null;
    const value = asText(block?.content);
    const heading = value.match(/^(#{1,6})\s+(.*)$/s);
    if (!heading) return null;
    const sourcePrefix = `${heading[1]} `;
    return {
      block: {
        ...block,
        kind: 'heading',
        level: heading[1].length,
        content: heading[2],
      },
      sourcePrefix,
      sourceOffset: sourcePrefix.length,
    };
  }

  function parseEditableMarkdownBlock({ block, text } = {}) {
    const value = asText(text);
    const heading = value.match(/^(#{1,6})\s(.*)$/s);
    if (heading) {
      return {
        patch: { kind: 'heading', level: heading[1].length, checked: null, content: heading[2], language: '' },
      };
    }
    const todo = value.match(/^-\s+\[([ xX])\]\s(.*)$/s);
    if (todo) {
      return {
        patch: { kind: 'todo', level: 0, checked: /[xX]/.test(todo[1]), content: todo[2], language: '' },
      };
    }
    const bullet = value.match(/^-\s(.*)$/s);
    if (bullet) {
      return {
        patch: { kind: 'bullet', level: 0, checked: null, content: bullet[1], language: '' },
      };
    }
    const quote = value.match(/^>\s?(.*)$/s);
    if (quote) {
      return {
        patch: { kind: 'quote', level: 0, checked: null, content: quote[1], language: '' },
      };
    }
    if (/^---+$/.test(value)) {
      return {
        patch: { kind: 'divider', level: 0, checked: null, content: '', language: '' },
      };
    }
    if (['heading', 'bullet', 'todo', 'quote', 'divider'].includes(asText(block?.kind))) {
      return {
        patch: { kind: 'paragraph', level: 0, checked: null, content: value, language: '' },
      };
    }
    return null;
  }

  function findBlockStarterConversion({ block, text, cursor, inputType } = {}) {
    const value = asText(text);
    const pos = normalizeCursor(value, cursor);
    if (!shouldHandleTextInput(inputType)) return null;
    if (pos !== value.length) return null;
    if (asText(block?.kind || '') === 'bullet') {
      const continuation = TODO_CONTINUATION_MARKERS.find(item => value === item.marker);
      if (continuation) {
        return {
          marker: `- ${continuation.marker}`,
          patch: {
            kind: 'todo',
            level: 0,
            checked: continuation.checked,
            content: '',
            language: '',
          },
          caret: 0,
        };
      }
    }
    if (!isPlainEditableBlock(block)) return null;
    if (value[0] === ' ' || value[0] === '\t') return null;

    const starter = BLOCK_STARTERS.find(item => value === item.marker);
    if (!starter) return null;

    return {
      marker: starter.marker,
      patch: blockStarterPatch(starter),
      caret: 0,
    };
  }

  function isEscaped(text, index) {
    let count = 0;
    for (let i = index - 1; i >= 0 && text[i] === '\\'; i--) count++;
    return count % 2 === 1;
  }

  function appendText(segments, text) {
    if (!text) return;
    const last = segments[segments.length - 1];
    if (last && last.kind === 'text') last.text += text;
    else segments.push({ kind: 'text', text });
  }

  function hasLineBreak(text) {
    return /[\r\n]/.test(text);
  }

  function hasNestedMarkdownMarker(text) {
    const value = asText(text);
    for (let i = 0; i < value.length; i++) {
      if (isEscaped(value, i)) continue;
      if (value.startsWith('**', i) || value.startsWith('~~', i) || value[i] === '`' || value[i] === '[') return true;
      if (value[i] === '*' && value[i + 1] !== '*') return true;
    }
    return false;
  }

  function findClosingMarker(text, marker, from) {
    for (let i = from; i <= text.length - marker.length; i++) {
      if (text[i] === '\n' || text[i] === '\r') return -1;
      if (text.startsWith(marker, i) && !isEscaped(text, i)) return i;
    }
    return -1;
  }

  function findClosingSingleStar(text, from) {
    for (let i = from; i < text.length; i++) {
      if (text[i] === '\n' || text[i] === '\r') return -1;
      if (text[i] !== '*' || isEscaped(text, i)) continue;
      if (text[i - 1] === '*' || text[i + 1] === '*') continue;
      return i;
    }
    return -1;
  }

  function safeUrlFailure(reason, label, url) {
    return { safe: false, reason, label: asText(label), url: asText(url) };
  }

  function classifyMarkdownLink(label, url) {
    const cleanLabel = asText(label);
    const rawUrl = asText(url);
    if (!cleanLabel.trim()) return safeUrlFailure('empty-label', cleanLabel, rawUrl);
    if (!rawUrl) return safeUrlFailure('empty-url', cleanLabel, rawUrl);
    if (rawUrl.trim() !== rawUrl) return safeUrlFailure('url-whitespace', cleanLabel, rawUrl);
    if (/[\s\x00-\x1f\x7f]/.test(rawUrl)) return safeUrlFailure('url-control-or-space', cleanLabel, rawUrl);
    if (rawUrl.startsWith('//')) return safeUrlFailure('protocol-relative', cleanLabel, rawUrl);
    if (rawUrl.includes('(') || rawUrl.includes(')')) return safeUrlFailure('nested-parentheses', cleanLabel, rawUrl);
    let parsed = null;
    try {
      parsed = new URL(rawUrl);
    } catch (e) {
      return safeUrlFailure('malformed-url', cleanLabel, rawUrl);
    }
    const protocol = parsed.protocol.toLowerCase();
    if (protocol !== 'http:' && protocol !== 'https:') {
      return safeUrlFailure('unsafe-scheme', cleanLabel, rawUrl);
    }
    return { safe: true, reason: 'safe', label: cleanLabel, url: rawUrl, protocol };
  }

  function isSafeMarkdownUrl(url) {
    return classifyMarkdownLink('label', url).safe;
  }

  function isVaultAttachmentPath(url) {
    return VAULT_ATTACHMENT_PATH_RE.test(asText(url));
  }

  function classifyMarkdownImage(alt, url) {
    const cleanAlt = asText(alt);
    const rawUrl = asText(url);
    if (!rawUrl) return safeUrlFailure('empty-url', cleanAlt, rawUrl);
    if (rawUrl.trim() !== rawUrl) return safeUrlFailure('url-whitespace', cleanAlt, rawUrl);
    if (/[\s\x00-\x1f\x7f]/.test(rawUrl)) return safeUrlFailure('url-control-or-space', cleanAlt, rawUrl);
    if (rawUrl.startsWith('//')) return safeUrlFailure('protocol-relative', cleanAlt, rawUrl);
    if (rawUrl.includes('(') || rawUrl.includes(')')) return safeUrlFailure('nested-parentheses', cleanAlt, rawUrl);
    if (isVaultAttachmentPath(rawUrl)) {
      return { safe: true, reason: 'safe', label: cleanAlt, url: rawUrl, source: 'attachment' };
    }
    let parsed = null;
    try {
      parsed = new URL(rawUrl);
    } catch (e) {
      return safeUrlFailure('malformed-url', cleanAlt, rawUrl);
    }
    const protocol = parsed.protocol.toLowerCase();
    if (protocol !== 'http:' && protocol !== 'https:') {
      return safeUrlFailure('unsafe-scheme', cleanAlt, rawUrl);
    }
    return { safe: true, reason: 'safe', label: cleanAlt, url: rawUrl, source: 'remote', protocol };
  }

  function parseMarkdownLinkAt(text, start) {
    if (text[start] !== '[' || isEscaped(text, start) || text[start + 1] === '[') return null;
    const labelEnd = findClosingMarker(text, ']', start + 1);
    if (labelEnd < 0 || text[labelEnd + 1] !== '(') return null;
    const urlStart = labelEnd + 2;
    const urlEnd = findClosingMarker(text, ')', urlStart);
    if (urlEnd < 0) return null;
    const label = text.slice(start + 1, labelEnd);
    const url = text.slice(urlStart, urlEnd);
    const whole = text.slice(start, urlEnd + 1);
    if (hasLineBreak(label) || hasLineBreak(url) || hasNestedMarkdownMarker(label)) {
      return { invalid: true, whole };
    }
    const classified = classifyMarkdownLink(label, url);
    if (!classified.safe) return { invalid: true, whole, classified };
    return {
      segment: { kind: 'link', text: label, label, url, safe: true },
      end: urlEnd + 1,
    };
  }

  function parseMarkdownImageAt(text, start) {
    if (text[start] !== '!' || isEscaped(text, start) || text[start + 1] !== '[') return null;
    if (text[start + 2] === '[') return null; // leave ![[...]] (embed syntax) as plain text
    const altEnd = findClosingMarker(text, ']', start + 2);
    if (altEnd < 0 || text[altEnd + 1] !== '(') return null;
    const urlStart = altEnd + 2;
    const urlEnd = findClosingMarker(text, ')', urlStart);
    if (urlEnd < 0) return null;
    const alt = text.slice(start + 2, altEnd);
    const url = text.slice(urlStart, urlEnd);
    const whole = text.slice(start, urlEnd + 1);
    if (hasLineBreak(alt) || hasLineBreak(url) || hasNestedMarkdownMarker(alt)) {
      return { invalid: true, whole };
    }
    const classified = classifyMarkdownImage(alt, url);
    if (!classified.safe) return { invalid: true, whole, classified };
    return {
      segment: { kind: 'image', text: alt, label: alt, url, source: classified.source, safe: true },
      end: urlEnd + 1,
    };
  }

  function parseDelimitedAt(text, start, marker, kind) {
    if (isEscaped(text, start)) return null;
    const close = marker === '*'
      ? findClosingSingleStar(text, start + 1)
      : findClosingMarker(text, marker, start + marker.length);
    if (close < 0 && marker === '*') {
      const lineEndCandidates = [text.indexOf('\n', start), text.indexOf('\r', start)].filter(index => index >= 0);
      const lineEnd = lineEndCandidates.length ? Math.min(...lineEndCandidates) : text.length;
      const rest = text.slice(start, lineEnd);
      if (/\*\*[^*]+\*\*/.test(rest)) return { invalid: true, whole: rest };
    }
    if (close < 0) return null;
    const inner = text.slice(start + marker.length, close);
    const whole = text.slice(start, close + marker.length);
    if (!inner.trim() || hasLineBreak(inner)) return { invalid: true, whole };
    if (kind !== 'code' && hasNestedMarkdownMarker(inner)) return { invalid: true, whole };
    return {
      segment: { kind, text: inner, marker },
      end: close + marker.length,
    };
  }

  function parseInlineMarkdown(text) {
    const value = asText(text);
    const segments = [];
    let i = 0;
    while (i < value.length) {
      if (value[i] === '\\') {
        if (value.startsWith('**', i + 1) || value.startsWith('~~', i + 1)) {
          appendText(segments, value.slice(i, i + 3));
          i += 3;
          continue;
        }
        if ('*`~[]()!'.includes(value[i + 1] || '')) {
          appendText(segments, value.slice(i, i + 2));
          i += 2;
          continue;
        }
      }

      let parsed = null;
      if (value[i] === '`') parsed = parseDelimitedAt(value, i, '`', 'code');
      else if (value.startsWith('**', i)) parsed = parseDelimitedAt(value, i, '**', 'bold');
      else if (value.startsWith('~~', i)) parsed = parseDelimitedAt(value, i, '~~', 'strike');
      else if (value[i] === '*' && value[i + 1] !== '*') parsed = parseDelimitedAt(value, i, '*', 'italic');
      else if (value[i] === '!' && value[i + 1] === '[') parsed = parseMarkdownImageAt(value, i);
      else if (value[i] === '[') parsed = parseMarkdownLinkAt(value, i);

      if (parsed?.segment) {
        segments.push(parsed.segment);
        i = parsed.end;
        continue;
      }
      if (parsed?.invalid) {
        appendText(segments, parsed.whole);
        i += parsed.whole.length;
        continue;
      }

      appendText(segments, value[i]);
      i++;
    }
    return segments;
  }

  function serializeInlineMarkdown(segments) {
    return (segments || []).map(segment => {
      const text = asText(segment?.text);
      if (!segment || segment.kind === 'text') return text;
      if (segment.kind === 'bold') return `**${text}**`;
      if (segment.kind === 'italic') return `*${text}*`;
      if (segment.kind === 'code') return `\`${text}\``;
      if (segment.kind === 'strike') return `~~${text}~~`;
      if (segment.kind === 'link') return `[${asText(segment.label || text)}](${asText(segment.url)})`;
      if (segment.kind === 'image') return `![${asText(segment.label || text)}](${asText(segment.url)})`;
      return text;
    }).join('');
  }

  function supportedCaseMatrix() {
    return {
      blockStarters: BLOCK_STARTERS.map(item => ({ ...item })),
      inlineMarkers: INLINE_MARKERS.map(item => ({ ...item })),
    };
  }

  return {
    BLOCK_STARTERS,
    INLINE_MARKERS,
    isPlainEditableBlock,
    isSpecializedPlainContext,
    shouldHandleTextInput,
    shouldSkipMarkdownInputRules,
    findBlockStarterConversion,
    parseInlineMarkdown,
    serializeInlineMarkdown,
    classifyMarkdownLink,
    classifyMarkdownImage,
    isVaultAttachmentPath,
    isSafeMarkdownUrl,
    structuralEditPrefix,
    editableMarkdownForBlock,
    displayProjectionForMarkdownSourceBlock,
    parseEditableMarkdownBlock,
    editorOffsetToContentOffset,
    contentOffsetToEditorOffset,
    supportedCaseMatrix,
  };
});
