// Middle pane: list of notes (filtered). Click to select.
const { useMemo: useMemoL } = React;

function mnFormatDate(iso) {
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const yest = new Date(now); yest.setDate(now.getDate() - 1);
  const sameYest = d.toDateString() === yest.toDateString();
  if (sameDay) return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (sameYest) return 'Yesterday';
  if (now - d < 7 * 864e5) return d.toLocaleDateString([], { weekday: 'short' });
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function mnPreview(body) {
  // Strip markdown, take first ~90 chars of content after title-like heading
  let s = body
    .replace(/^#{1,4}\s+.*/gm, '')
    .replace(/\[\[([^\]]+)\]\]/g, '$1')
    .replace(/[`*>#]/g, '')
    .replace(/-\s+\[[ x]\]/g, '✓')
    .replace(/-\s+/g, '')
    .replace(/@remind\s+\S+\s*\S*/g, '')
    .trim()
    .replace(/\s+/g, ' ');
  return s.slice(0, 120);
}

function mnSnippet(body, query) {
  const plain = body
    .split('\n')
    .filter(l => !/^[a-zA-Z][a-zA-Z0-9_-]*::\s/.test(l))  // skip page properties
    .join('\n')
    .replace(/\{\{embed\s+[^}]+\}\}/g, '')                  // skip embeds
    .replace(/\(\([A-Za-z0-9_-]+\)\)/g, '')                 // skip block refs
    .replace(/\[\[([^\]]+)\]\]/g, '$1')
    .replace(/[`*>#]/g, '')
    .replace(/-\s+\[[ x]\]/g, '✓')
    .replace(/-\s+/g, '')
    .replace(/@remind\s+\S+\s*\S*/g, '')
    .replace(/^(TODO|DOING|DONE|LATER|NOW|WAIT|CANCELLED)\s+/gm, '')
    .trim().replace(/\s+/g, ' ');
  if (!query) return plain.slice(0, 140);
  const idx = plain.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return plain.slice(0, 140);
  const start = Math.max(0, idx - 40);
  const end = Math.min(plain.length, idx + query.length + 100);
  return (start > 0 ? '…' : '') + plain.slice(start, end) + (end < plain.length ? '…' : '');
}

function mnHighlight(text, query, T) {
  if (!query) return text;
  const parts = [];
  const qLower = query.toLowerCase();
  const tLower = text.toLowerCase();
  let i = 0;
  while (i < text.length) {
    const idx = tLower.indexOf(qLower, i);
    if (idx === -1) { parts.push(text.slice(i)); break; }
    if (idx > i) parts.push(text.slice(i, idx));
    parts.push(React.createElement('mark', {
      key: idx,
      style: {
        background: `color-mix(in oklab, ${T.accent} 25%, transparent)`,
        color: T.ink, padding: '0 2px', borderRadius: 2,
      }
    }, text.slice(idx, idx + query.length)));
    i = idx + query.length;
  }
  return parts;
}

function MnNoteList({
  notes, selectedId, onSelect, title, subtitle,
  query, onQueryChange,
  tags, theme, density, T,
}) {
  const tagHue = useMemoL(() => {
    const m = {}; tags.forEach(t => m[t.name] = t.hue); return m;
  }, [tags]);

  return (
    <div style={{
      width: density === 'compact' ? 270 : 320, height: '100%',
      background: T.bg,
      borderRight: `1px solid ${T.line}`,
      display: 'flex', flexDirection: 'column', flexShrink: 0,
    }}>
      {/* Header */}
      <div style={{
        padding: '40px 20px 12px', borderBottom: `1px solid ${T.lineSub}`,
      }}>
        <div style={{
          fontFamily: 'var(--mn-ui)', fontSize: 17, fontWeight: 600,
          color: T.ink, letterSpacing: '-0.01em',
        }}>{title}</div>
        <div style={{
          fontFamily: 'var(--mn-mono)', fontSize: 10.5, color: T.inkDim,
          letterSpacing: '0.06em', marginTop: 4,
        }}>{subtitle}</div>

        {/* Search */}
        <div style={{
          marginTop: 12, position: 'relative',
          display: 'flex', alignItems: 'center',
          background: T.bgSub, borderRadius: 6,
          border: `1px solid ${query ? T.line : 'transparent'}`,
          transition: 'border 120ms',
        }}>
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke={T.inkDim} strokeWidth="1.4"
            style={{ position: 'absolute', left: 9, pointerEvents: 'none' }}>
            <circle cx="7" cy="7" r="4"/>
            <path d="M10 10L13.5 13.5" strokeLinecap="round"/>
          </svg>
          <input
            value={query || ''}
            onChange={(e) => onQueryChange(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Escape') onQueryChange(''); }}
            placeholder="Search notes…"
            style={{
              flex: 1, border: 'none', outline: 'none', background: 'transparent',
              padding: '6px 26px 6px 28px',
              fontFamily: 'var(--mn-ui)', fontSize: 12.5, color: T.ink,
            }}
          />
          {query && (
            <button onClick={() => onQueryChange('')} title="Clear (Esc)" style={{
              position: 'absolute', right: 5,
              width: 18, height: 18, borderRadius: 4,
              background: 'transparent', border: 'none', color: T.inkDim,
              cursor: 'pointer', padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <svg width="9" height="9" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.4">
                <path d="M2 2L8 8M8 2L2 8" strokeLinecap="round"/>
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* List */}
      <div style={{ flex: 1, overflow: 'auto' }}>
        {notes.length === 0 && (
          <div style={{
            padding: '40px 20px', textAlign: 'center',
            fontFamily: 'var(--mn-body)', fontSize: 13,
            color: T.inkDim,
          }}>
            {query
              ? <>No notes match <strong style={{ color: T.ink, fontWeight: 500 }}>“{query}”</strong></>
              : <span style={{ fontStyle: 'italic' }}>No notes yet.</span>}
          </div>
        )}
        {notes.map((n, i) => {
          const active = n.id === selectedId;
          const date = new Date(n.date);
          return (
            <div key={n.id} onClick={() => onSelect(n.id)} style={{
              padding: density === 'compact' ? '10px 18px' : '14px 20px',
              borderBottom: `1px solid ${T.lineSub}`,
              cursor: 'pointer',
              background: active ? T.selBg : 'transparent',
              borderLeft: active ? `2px solid ${T.accent}` : '2px solid transparent',
              position: 'relative',
              transition: 'background 80ms',
            }}
            onMouseEnter={e => !active && (e.currentTarget.style.background = T.bgHover)}
            onMouseLeave={e => !active && (e.currentTarget.style.background = 'transparent')}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                {n.pinned && (
                  <svg width="9" height="9" viewBox="0 0 10 10" fill={T.accent}>
                    <circle cx="5" cy="5" r="3" />
                  </svg>
                )}
                <div style={{
                  flex: 1, fontFamily: 'var(--mn-ui)',
                  fontSize: 13.5, fontWeight: 500,
                  color: T.ink, letterSpacing: '-0.005em',
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>{mnHighlight(n.title, query, T)}</div>
                <div style={{
                  fontFamily: 'var(--mn-mono)', fontSize: 10, color: T.inkDim,
                  flexShrink: 0,
                }}>{mnFormatDate(n.date)}</div>
              </div>
              {density !== 'compact' && (
                <div style={{
                  fontFamily: 'var(--mn-body)', fontSize: 12.5,
                  color: T.inkMed, lineHeight: 1.5,
                  marginTop: 4, display: '-webkit-box',
                  WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
                  overflow: 'hidden',
                }}>{mnHighlight(mnSnippet(n.body, query), query, T)}</div>
              )}
              <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
                {n.tags.map(t => (
                  <span key={t} style={{
                    fontFamily: 'var(--mn-mono)', fontSize: 9.5,
                    letterSpacing: '0.03em',
                    color: mnGetTagColor(tagHue[t] ?? 240, theme),
                    padding: '1px 6px', borderRadius: 3,
                    background: mnGetTagBg(tagHue[t] ?? 240, theme),
                  }}>#{t}</span>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

window.MnNoteList = MnNoteList;
window.mnFormatDate = mnFormatDate;
window.mnHighlight = mnHighlight;
