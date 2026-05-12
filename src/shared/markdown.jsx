// Lightweight markdown renderer for VispNote.
// Supports: headings, collapsible H2/H3, checkboxes, [[wiki-links]], #tags,
// @remind, blockquotes, bullets, bold/italic/code, horizontal rule.
// Headings are collapsible — click to fold the following block until the next heading of same-or-higher level.

const { useState, useMemo, useCallback, useEffect, useRef } = React;

const MN_REMINDER_PATTERN = /@remind\s+(\d{4}-\d{2}-\d{2})(?:\s+(\d{2}:\d{2}))?/;
const MN_REMINDER_INLINE_PATTERN = /@remind\s+\d{4}-\d{2}-\d{2}(?:\s+\d{2}:\d{2})?/g;

function mnHeadingId(text, index) {
  const base = String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return base ? `heading-${base}` : `heading-${index}`;
}

function mnDefaultReminderText() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `@remind ${yyyy}-${mm}-${dd} 09:00 `;
}

function mnParseReminder(text) {
  const match = String(text || '').match(MN_REMINDER_PATTERN);
  if (!match) return null;
  const date = match[1];
  const time = match[2] || '';
  const dateTime = new Date(`${date}T${time || '00:00'}:00`);
  if (Number.isNaN(dateTime.getTime())) return null;
  return {
    date,
    time,
    at: dateTime,
    raw: match[0],
    index: match.index || 0,
  };
}

function mnStripReminder(text) {
  return String(text || '').replace(MN_REMINDER_INLINE_PATTERN, '').trim();
}

window.MN_REMIND = {
  pattern: MN_REMINDER_PATTERN,
  inlinePattern: MN_REMINDER_INLINE_PATTERN,
  defaultText: mnDefaultReminderText,
  parse: mnParseReminder,
  strip: mnStripReminder,
};

// Parse a markdown string into a flat block list.
function mnParse(md) {
  const lines = md.split('\n');
  const blocks = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    // Heading
    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if (h) {
      blocks.push({ type: 'heading', level: h[1].length, text: h[2], idx: blocks.length });
      i++; continue;
    }
    // Blockquote
    if (line.startsWith('> ')) {
      const buf = [];
      while (i < lines.length && lines[i].startsWith('> ')) { buf.push(lines[i].slice(2)); i++; }
      blocks.push({ type: 'quote', text: buf.join('\n'), idx: blocks.length });
      continue;
    }
    // List (todo or bullet)
    if (/^\s*-\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^\s*-\s+/.test(lines[i])) {
        const m = lines[i].match(/^(\s*)-\s+(\[[ xX]\]\s+)?(.*)$/);
        const indent = m[1].length;
        const checked = m[2] ? /[xX]/.test(m[2]) : null;
        items.push({ indent, checked, text: m[3] });
        i++;
      }
      blocks.push({ type: 'list', items, idx: blocks.length });
      continue;
    }
    // Horizontal rule
    if (/^---+$/.test(line)) {
      blocks.push({ type: 'hr', idx: blocks.length }); i++; continue;
    }
    // Blank line
    if (line.trim() === '') { i++; continue; }
    // Paragraph — coalesce until blank or next block
    const buf = [line];
    i++;
    while (i < lines.length && lines[i].trim() !== '' &&
           !/^(#{1,4})\s+/.test(lines[i]) &&
           !/^\s*-\s+/.test(lines[i]) &&
           !lines[i].startsWith('> ') &&
           !/^---+$/.test(lines[i])) {
      buf.push(lines[i]); i++;
    }
    blocks.push({ type: 'p', text: buf.join(' '), idx: blocks.length });
  }
  return blocks;
}

// Render inline markdown: bold, italic, code, [[wiki-links]], #tags, @remind-directive,
// ((block-refs)), {{embed inline}}.
function MnInline({ text, onOpen, onTagClick, T, allNotes }) {
  // Tokenize
  const out = [];
  const re = /(\(\([A-Za-z0-9_-]+\)\))|(\[\[[^\]]+\]\])|(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*]+\*)|(#[a-zA-Z][\w-]*)|(@remind\s+\d{4}-\d{2}-\d{2}(?:\s+\d{2}:\d{2})?)/g;
  let last = 0, m, key = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(<span key={key++}>{text.slice(last, m.index)}</span>);
    const [whole] = m;
    if (whole.startsWith('((')) {
      const refId = whole.slice(2, -2);
      if (window.MnBlockRef) {
        out.push(
          <span key={key++}>
            <window.MnBlockRef refId={refId} allNotes={allNotes} T={T}
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
    } else if (whole.startsWith('`')) {
      out.push(
        <code key={key++} style={{
          fontFamily: 'var(--mn-mono)', fontSize: '0.9em',
          background: T.bgSub, padding: '1px 5px', borderRadius: 4,
          border: `1px solid ${T.lineSub}`,
        }}>{whole.slice(1, -1)}</code>
      );
    } else if (whole.startsWith('**')) {
      out.push(<strong key={key++} style={{ fontWeight: 600, color: T.ink }}>{whole.slice(2, -2)}</strong>);
    } else if (whole.startsWith('*')) {
      out.push(<em key={key++}>{whole.slice(1, -1)}</em>);
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
    last = m.index + whole.length;
  }
  if (last < text.length) out.push(<span key={key++}>{text.slice(last)}</span>);
  return <>{out}</>;
}

function MnMarkdown({ md, onOpen, onTagClick, onToggleCheck, T }) {
  const blocks = useMemo(() => mnParse(md), [md]);
  const [collapsed, setCollapsed] = useState({});

  // For each heading, determine what blocks it "owns" (until next heading of same-or-higher level).
  const foldedIndices = useMemo(() => {
    const folded = new Set();
    for (let i = 0; i < blocks.length; i++) {
      const b = blocks[i];
      if (b.type === 'heading' && collapsed[i]) {
        for (let j = i + 1; j < blocks.length; j++) {
          const nb = blocks[j];
          if (nb.type === 'heading' && nb.level <= b.level) break;
          folded.add(j);
        }
      }
    }
    return folded;
  }, [blocks, collapsed]);

  return (
    <div style={{ color: T.ink }}>
      {blocks.map((b, i) => {
        if (foldedIndices.has(i)) return null;
        if (b.type === 'heading') {
          const Tag = `h${Math.min(b.level + 0, 6)}`;
          const sizes = { 1: 28, 2: 21, 3: 17, 4: 15 };
          const isCollapsed = !!collapsed[i];
          const canCollapse = b.level >= 2;
          return (
            <Tag key={i}
              id={mnHeadingId(b.text || b.content || '', i)}
              onClick={() => canCollapse && setCollapsed(c => ({ ...c, [i]: !c[i] }))}
              style={{
                fontFamily: 'var(--mn-body)', fontSize: sizes[b.level] || 15,
                fontWeight: b.level === 1 ? 600 : 600,
                letterSpacing: b.level === 1 ? '-0.02em' : '-0.01em',
                margin: b.level === 1 ? '0 0 12px' : '22px 0 8px',
                color: T.ink, cursor: canCollapse ? 'pointer' : 'default',
                display: 'flex', alignItems: 'center', gap: 6,
                userSelect: 'none',
              }}>
              {canCollapse && (
                <span style={{
                  fontSize: 10, color: T.inkDim, width: 12, display: 'inline-block',
                  transform: isCollapsed ? 'rotate(-90deg)' : 'rotate(0)',
                  transition: 'transform 120ms ease',
                }}>▾</span>
              )}
              <span><MnInline text={b.text} onOpen={onOpen} onTagClick={onTagClick} T={T} /></span>
              {isCollapsed && (
                <span style={{
                  fontSize: 11, color: T.inkDim, fontWeight: 400,
                  fontFamily: 'var(--mn-mono)', marginLeft: 4,
                }}>folded</span>
              )}
            </Tag>
          );
        }
        if (b.type === 'p') {
          return (
            <p key={i} style={{
              fontFamily: 'var(--mn-body)', fontSize: 15.5, lineHeight: 1.65,
              margin: '0 0 14px', color: T.ink,
            }}>
              <MnInline text={b.text} onOpen={onOpen} onTagClick={onTagClick} T={T} />
            </p>
          );
        }
        if (b.type === 'quote') {
          return (
            <blockquote key={i} style={{
              margin: '0 0 16px', padding: '6px 14px',
              borderLeft: `2px solid ${T.line}`,
              fontFamily: 'var(--mn-body)', fontSize: 15, fontStyle: 'italic',
              color: T.inkMed, lineHeight: 1.6,
            }}>
              <MnInline text={b.text} onOpen={onOpen} onTagClick={onTagClick} T={T} />
            </blockquote>
          );
        }
        if (b.type === 'list') {
          return (
            <ul key={i} style={{ listStyle: 'none', padding: 0, margin: '0 0 14px' }}>
              {b.items.map((it, j) => (
                <li key={j} style={{
                  display: 'flex', alignItems: 'flex-start', gap: 8,
                  paddingLeft: it.indent * 14,
                  padding: `3px 0 3px ${it.indent * 14}px`,
                  fontFamily: 'var(--mn-body)', fontSize: 15.5, lineHeight: 1.7,
                  color: it.checked ? T.inkDim : T.ink,
                }}>
                  {it.checked !== null ? (
                    <button
                      onClick={() => onToggleCheck && onToggleCheck(b.idx, j)}
                      style={{
                        width: 16, height: 16, marginTop: 5, flexShrink: 0,
                        border: `1.5px solid ${it.checked ? T.accent : T.line}`,
                        background: it.checked ? T.accent : 'transparent',
                        borderRadius: 4, cursor: 'pointer', padding: 0,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                      }}>
                      {it.checked && (
                        <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                          <path d="M2 5L4 7L8 3" stroke="white" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                      )}
                    </button>
                  ) : (
                    <span style={{
                      width: 4, height: 4, marginTop: 11, borderRadius: '50%',
                      background: T.inkDim, flexShrink: 0,
                    }} />
                  )}
                  <span style={{ textDecoration: it.checked ? 'line-through' : 'none' }}>
                    <MnInline text={it.text} onOpen={onOpen} onTagClick={onTagClick} T={T} />
                  </span>
                </li>
              ))}
            </ul>
          );
        }
        if (b.type === 'hr') {
          return <hr key={i} style={{ border: 0, borderTop: `1px solid ${T.lineSub}`, margin: '18px 0' }} />;
        }
        return null;
      })}
    </div>
  );
}

window.MnMarkdown = MnMarkdown;
window.mnParse = mnParse;
window.MnInline = MnInline;
