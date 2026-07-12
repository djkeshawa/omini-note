// Inline markdown and annotation renderers for outliner text.

import { platformApi } from '../platform/index.js';
import { MnBlockRef } from './blockFeatures.jsx';
import { AttachmentChip } from './AttachmentChip.jsx';
import { MnInline } from '../shared/markdown.jsx';
import MN_MARKDOWN_INPUT_RULES from './markdownInputRules.js';


function mnRenderSpecialInlineText(text, T, onOpen, onTagClick, allNotes) {
  const value = String(text || '');
  const out = [];
  const re = /(\(\([A-Za-z0-9_-]+\)\))|(\[\[[^\]]+\]\])|(#[a-zA-Z][\w-]*)|(@remind\s+\d{4}-\d{2}-\d{2}(?:\s+\d{2}:\d{2})?)/g;
  let last = 0, match, key = 0;
  while ((match = re.exec(value))) {
    if (match.index > last) out.push(<span key={key++}>{value.slice(last, match.index)}</span>);
    const whole = match[0];
    if (whole.startsWith('((')) {
      const refId = whole.slice(2, -2);
      if (MnBlockRef) {
        out.push(
          <span key={key++}>
            <MnBlockRef refId={refId} allNotes={allNotes} T={T}
              onOpenBlock={(noteId, blockId) => onOpen && onOpen(null, noteId, blockId)} />
          </span>
        );
      } else {
        out.push(<span key={key++} style={{ fontFamily: 'var(--mn-mono)', fontSize: '0.85em', color: T.inkDim }}>{whole}</span>);
      }
    } else if (whole.startsWith('[[')) {
      const label = whole.slice(2, -2);
      out.push(
        <a key={key++} onClick={(e) => { e.preventDefault(); onOpen && onOpen(label); }}
           style={{
             color: T.accent, cursor: 'pointer', borderBottom: `1px dotted ${T.accent}`,
             padding: '0 1px', textDecoration: 'none', fontFamily: 'inherit',
           }}>{label}</a>
      );
    } else if (whole.startsWith('#')) {
      const tag = whole.slice(1);
      out.push(
        <a key={key++} onClick={(e) => { e.preventDefault(); onTagClick && onTagClick(tag); }}
           style={{
             color: T.inkMed, cursor: 'pointer', fontFamily: 'var(--mn-mono)',
             fontSize: '0.88em', background: T.bgSub,
             padding: '1px 6px', borderRadius: 4, textDecoration: 'none',
             border: `1px solid ${T.lineSub}`,
           }}>#{tag}</a>
      );
    } else if (whole.startsWith('@remind')) {
      const parts = whole.split(/\s+/);
      out.push(
        <span key={key++} style={{
          display: 'inline-flex', alignItems: 'center', gap: 4,
          fontFamily: 'var(--mn-mono)', fontSize: '0.78em',
          lineHeight: 1.2, verticalAlign: 'baseline',
          color: T.warn, background: `color-mix(in oklab, ${T.warn} 10%, transparent)`,
          padding: '0 5px', borderRadius: 3,
          border: `1px solid color-mix(in oklab, ${T.warn} 30%, transparent)`,
        }}>
          <svg width="10" height="10" viewBox="0 0 16 16" fill="none">
            <circle cx="8" cy="9" r="5.5" stroke="currentColor" strokeWidth="1.3"/>
            <path d="M8 6.5V9l1.5 1" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
            <path d="M3.5 3.5L5 5M12.5 3.5L11 5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
          </svg>
          remind {parts.slice(1).join(' ')}
        </span>
      );
    }
    last = match.index + whole.length;
  }
  if (last < value.length) out.push(<span key={key++}>{value.slice(last)}</span>);
  return <>{out}</>;
}

function mnInlineSegmentSourceLength(segment) {
  const text = String(segment?.text || '');
  if (!segment || segment.kind === 'text') return text.length;
  if (segment.kind === 'bold') return text.length + 4;
  if (segment.kind === 'italic') return text.length + 2;
  if (segment.kind === 'code') return text.length + 2;
  if (segment.kind === 'strike') return text.length + 4;
  if (segment.kind === 'link') return String(segment.label || text).length + String(segment.url || '').length + 4;
  if (segment.kind === 'image') return String(segment.label || text).length + String(segment.url || '').length + 5;
  return text.length;
}

function mnInlineSegmentTextOffset(segment, sourceOffset) {
  if (!segment || segment.kind === 'text') return sourceOffset;
  if (segment.kind === 'bold') return sourceOffset + 2;
  if (segment.kind === 'italic') return sourceOffset + 1;
  if (segment.kind === 'code') return sourceOffset + 1;
  if (segment.kind === 'strike') return sourceOffset + 2;
  if (segment.kind === 'link') return sourceOffset + 1;
  if (segment.kind === 'image') return sourceOffset + 2;
  return sourceOffset;
}

function mnResolveInlineImageSrc(url, vaultId = '') {
  const value = String(url || '');
  const isAttachmentPath = MN_MARKDOWN_INPUT_RULES.isVaultAttachmentPath
    ? MN_MARKDOWN_INPUT_RULES.isVaultAttachmentPath(value)
    : false;
  if (isAttachmentPath) {
    if (!vaultId) return null;
    const fileName = value.slice('attachments/'.length);
    return `vispnote-asset://attachment/${encodeURIComponent(vaultId)}/${encodeURIComponent(fileName)}`;
  }
  if (/^https:\/\//.test(value)) return value;
  return null;
}

function mnRenderMarkdownInlineText(text, T, onOpen, onTagClick, allNotes, renderPlainText, baseOffset = 0, vaultId = '') {
  const value = String(text || '');
  const parseInlineMarkdown = MN_MARKDOWN_INPUT_RULES.parseInlineMarkdown;
  if (!parseInlineMarkdown) {
    return <MnInline text={value} T={T} onOpen={onOpen} onTagClick={onTagClick} allNotes={allNotes} BlockRefComponent={MnBlockRef} />;
  }
  const segments = parseInlineMarkdown(value);
  let sourceOffset = Number(baseOffset) || 0;
  return (
    <>
      {segments.map((segment, index) => {
        const textOffset = mnInlineSegmentTextOffset(segment, sourceOffset);
        sourceOffset += mnInlineSegmentSourceLength(segment);
        if (segment.kind === 'text') {
          return (
            <React.Fragment key={index}>
              {renderPlainText
                ? renderPlainText(segment.text, textOffset)
                : mnRenderSpecialInlineText(segment.text, T, onOpen, onTagClick, allNotes)}
            </React.Fragment>
          );
        }
        if (segment.kind === 'code') {
          return (
            <code key={index} style={{
              fontFamily: 'var(--mn-mono)',
              fontSize: '0.9em',
              background: T.bgSub,
              padding: '1px 5px',
              borderRadius: 4,
              border: `1px solid ${T.lineSub}`,
            }}>{segment.text}</code>
          );
        }
        if (segment.kind === 'image') {
          const src = mnResolveInlineImageSrc(segment.url, vaultId);
          if (!src) {
            return (
              <span key={index} style={{ fontFamily: 'var(--mn-mono)', fontSize: '0.85em', color: T.inkDim }}>
                {`![${segment.label || ''}](${segment.url || ''})`}
              </span>
            );
          }
          return (
            <img
              key={index}
              src={src}
              alt={segment.label || ''}
              loading="lazy"
              draggable={false}
              style={{
                display: 'inline-block',
                maxWidth: '100%',
                maxHeight: 480,
                borderRadius: 8,
                border: `1px solid ${T.lineSub}`,
                verticalAlign: 'middle',
                margin: '4px 0',
              }}
            />
          );
        }
        if (segment.kind === 'link') {
          if (segment.source === 'attachment') {
            return <AttachmentChip key={index} label={segment.label} url={segment.url} vaultId={vaultId} T={T} />;
          }
          return (
            <a
              key={index}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                platformApi.app.openExternal(segment.url);
              }}
              style={{
                color: T.accent,
                cursor: 'pointer',
                borderBottom: `1px solid ${T.accent}`,
                padding: '0 1px',
                textDecoration: 'none',
                fontFamily: 'inherit',
              }}>
              {segment.label}
            </a>
          );
        }
        const style = {};
        if (segment.kind === 'bold') style.fontWeight = 600;
        else if (segment.kind === 'italic') style.fontStyle = 'italic';
        else if (segment.kind === 'strike') style.textDecoration = 'line-through';
        return (
          <span key={index} style={style}>
            {renderPlainText
              ? renderPlainText(segment.text, textOffset)
              : mnRenderSpecialInlineText(segment.text, T, onOpen, onTagClick, allNotes)}
          </span>
        );
      })}
    </>
  );
}

function mnRenderAnnotated(text, annotations, T, onOpen, onTagClick, allNotes, renderPlainText, vaultId = '') {
  if (!annotations || annotations.length === 0) {
    return mnRenderMarkdownInlineText(text, T, onOpen, onTagClick, allNotes, renderPlainText, 0, vaultId);
  }
  const points = new Set([0, text.length]);
  for (const a of annotations) { points.add(a.start); points.add(a.end); }
  const sorted = [...points].sort((a, b) => a - b);
  const segs = [];
  for (let i = 0; i < sorted.length - 1; i++) {
    const s = sorted[i], e = sorted[i + 1];
    if (s === e) continue;
    const kinds = annotations.filter(a => a.start <= s && a.end >= e).map(a => a.kind);
    segs.push({ s, e, kinds });
  }
  return (
    <>
      {segs.map((seg, i) => {
        const sub = text.slice(seg.s, seg.e);
        const content = mnRenderMarkdownInlineText(sub, T, onOpen, onTagClick, allNotes, renderPlainText, seg.s, vaultId);
        const style = {};
        for (const k of seg.kinds) {
          if (k === 'bold') style.fontWeight = 600;
          else if (k === 'italic') style.fontStyle = 'italic';
          else if (k === 'strike') style.textDecoration = 'line-through';
          else if (k === 'underline') style.textDecoration = (style.textDecoration ? `${style.textDecoration} underline` : 'underline');
          else if (k === 'code') {
            style.fontFamily = 'var(--mn-mono)';
            style.fontSize = '0.92em';
            style.background = T.bgSub;
            style.padding = '1px 5px';
            style.borderRadius = 3;
            style.border = `1px solid ${T.lineSub}`;
          }
          else if (k === 'hi-yellow') style.background = 'oklch(0.93 0.10 95 / 0.55)';
          else if (k === 'hi-green')  style.background = 'oklch(0.92 0.09 145 / 0.55)';
          else if (k === 'hi-pink')   style.background = 'oklch(0.90 0.08 0 / 0.55)';
          else if (k === 'hi-blue')   style.background = 'oklch(0.91 0.08 240 / 0.55)';
          else if (k === 'color-red')    style.color = 'oklch(0.55 0.18 27)';
          else if (k === 'color-blue')   style.color = 'oklch(0.50 0.16 240)';
          else if (k === 'color-purple') style.color = 'oklch(0.50 0.18 290)';
          else if (k === 'color-green')  style.color = 'oklch(0.50 0.13 150)';
          else if (k === 'fs-small') style.fontSize = '0.88em';
          else if (k === 'fs-default') style.fontSize = '1em';
          else if (k === 'fs-large') style.fontSize = '1.14em';
          else if (k === 'fs-x-large') style.fontSize = '1.3em';
        }
        return <span key={i} style={style}>{content}</span>;
      })}
    </>
  );
}

export { mnRenderAnnotated, mnRenderMarkdownInlineText, mnRenderSpecialInlineText };
