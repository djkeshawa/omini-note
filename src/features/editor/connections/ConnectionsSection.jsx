function mnRenderMentionSnippet(snippet, T) {
  const parts = String(snippet || '').split(/<mark>|<\/mark>/);
  return parts.map((part, index) => index % 2
    ? <mark key={index} style={{ background: 'transparent', color: T.accent, fontWeight: 600 }}>{part}</mark>
    : <React.Fragment key={index}>{part}</React.Fragment>);
}

function mnConnectionActionStyle(T, primary = false) {
  return {
    border: `1px solid ${primary ? T.accent : T.lineSub}`,
    borderRadius: 6,
    background: primary ? T.accentSoft : 'transparent',
    color: primary ? T.accent : T.inkDim,
    cursor: 'pointer',
    fontFamily: 'var(--mn-ui)',
    fontSize: 11,
    fontWeight: 650,
    minHeight: 32,
    padding: '4px 8px',
  };
}

function mnConnectionGroupLabelStyle(T) {
  return {
    fontFamily: 'var(--mn-ui)',
    fontSize: 11,
    fontWeight: 650,
    color: T.inkDim,
    marginBottom: 7,
  };
}

function mnConnectionRowStyle(T) {
  return {
    width: '100%',
    padding: '9px 4px',
    border: 0,
    borderBottom: `1px solid ${T.lineSub}`,
    background: 'transparent',
    color: T.ink,
    cursor: 'pointer',
    textAlign: 'left',
  };
}

function ConnectionsSection({
  suggestedConnections, backlinks, mentions, passiveRelatedItems, connected, related,
  onOpen, onLinkMention, linkMention, note, acceptSuggestedConnection, ignoreSuggestedConnection,
  expanded = false, onExpandedChange, rail = false, onOpenGraph, T,
}) {
  const connectionCount = suggestedConnections.length
    + backlinks.length
    + mentions.length
    + passiveRelatedItems.length
    + connected.items.length;

  if (!connectionCount) return null;

  // In the rail the panel is permanent, so the disclosure would be a control
  // that can only ever do one thing. The header becomes a title instead.
  const open = rail || expanded;

  return (
    <section
      data-mn-connections-section="true"
      data-mn-connections-rail={rail ? 'true' : undefined}
      style={rail
        ? { display: 'flex', flexDirection: 'column', gap: 4, minHeight: 0 }
        : { marginTop: 34, borderTop: `1px solid ${T.lineSub}` }}>
      {rail ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: T.ink }}>Connections</span>
          <span style={{ fontFamily: 'var(--mn-mono)', fontSize: 10.5, color: T.inkDim }}>{connectionCount}</span>
          <span style={{ flex: 1 }} />
          {onOpenGraph && (
            <button
              type="button"
              onClick={onOpenGraph}
              style={{
                height: 22, padding: '0 8px', borderRadius: 6,
                border: `1px solid ${T.lineSub}`, background: T.bg, color: T.inkMed,
                fontFamily: 'var(--mn-ui)', fontSize: 11, cursor: 'pointer',
              }}>Graph</button>
          )}
        </div>
      ) : (
      <button
        type="button"
        data-mn-connections-toggle="true"
        aria-expanded={expanded}
        aria-controls="mn-connections-panel"
        aria-label={`${expanded ? 'Hide' : 'Show'} ${connectionCount} connection${connectionCount === 1 ? '' : 's'}`}
        onClick={() => onExpandedChange?.(!expanded)}
        style={{
          width: '100%', minHeight: 44, padding: '9px 2px',
          display: 'flex', alignItems: 'center', gap: 8,
          border: 0, background: 'transparent', color: T.inkMed,
          cursor: 'pointer', textAlign: 'left', fontFamily: 'var(--mn-ui)',
        }}
        onMouseEnter={event => { event.currentTarget.style.color = T.ink; }}
        onMouseLeave={event => { event.currentTarget.style.color = T.inkMed; }}>
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true" style={{
          transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)',
          transition: 'transform 120ms ease',
          color: T.inkDim,
        }}>
          <path d="M4.5 2.5L8 6L4.5 9.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span style={{ fontSize: 12.5, fontWeight: 650 }}>Connections</span>
        <span style={{ fontFamily: 'var(--mn-mono)', fontSize: 10, color: T.inkDim }}>{connectionCount}</span>
      </button>
      )}

      {open && (
        <div
          id="mn-connections-panel"
          data-mn-connections-panel="true"
          style={rail
            ? { minHeight: 0, overflow: 'auto', paddingRight: 2 }
            : { padding: '2px 0 10px 20px' }}>
          {suggestedConnections.length > 0 && (
            <div style={{ marginBottom: 18 }}>
              <div style={mnConnectionGroupLabelStyle(T)}>Suggested links</div>
              {suggestedConnections.map(item => (
                <div key={item.noteId || item.id} style={{
                  display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto auto', gap: 6, alignItems: 'center',
                  padding: '8px 9px', marginBottom: 5, borderRadius: 7,
                  background: T.bgSub,
                }}>
                  <button type="button" aria-label={`Open suggested connection ${item.title || 'Untitled'}`} onClick={() => onOpen?.(item.noteId || item.id)} style={{
                    minWidth: 0, border: 0, background: 'transparent', color: T.ink,
                    textAlign: 'left', cursor: 'pointer', fontFamily: 'var(--mn-ui)', fontSize: 12.5,
                    minHeight: 32, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>{item.title || 'Untitled'}</button>
                  <button type="button" aria-label={`Accept connection to ${item.title || 'note'}`} onClick={() => acceptSuggestedConnection(item)} style={mnConnectionActionStyle(T, true)}>Accept</button>
                  <button type="button" aria-label={`Ignore connection to ${item.title || 'note'}`} onClick={() => ignoreSuggestedConnection(item)} style={mnConnectionActionStyle(T)}>Ignore</button>
                  {item.reason && <span style={{ gridColumn: '1 / -1', fontFamily: 'var(--mn-ui)', fontSize: 10.5, color: T.inkDim }}>{item.reason}</span>}
                </div>
              ))}
            </div>
          )}

          {backlinks.length > 0 && (
            <div style={{ marginTop: 15 }}>
              <div style={mnConnectionGroupLabelStyle(T)}>{backlinks.length} backlink{backlinks.length > 1 ? 's' : ''}</div>
              {backlinks.map(backlink => (
                <button
                  key={backlink.id}
                  type="button"
                  onClick={() => onOpen?.(backlink.id)}
                  style={mnConnectionRowStyle(T)}
                  onMouseEnter={event => { event.currentTarget.style.background = T.bgHover; }}
                  onMouseLeave={event => { event.currentTarget.style.background = 'transparent'; }}>
                  <span style={{ display: 'block', fontFamily: 'var(--mn-ui)', fontSize: 12, fontWeight: 550, color: T.ink, marginBottom: 3 }}>{backlink.title}</span>
                  <span style={{ display: 'block', fontFamily: 'var(--mn-body)', fontSize: 12.5, color: T.inkMed, lineHeight: 1.5 }}>
                    {String(backlink.context || '').replace(/\[\[([^\]]+)\]\]/g, '$1').replace(/^[-#>*\s]*\s*/, '')}
                  </span>
                </button>
              ))}
            </div>
          )}

          {mentions.length > 0 && (
            <div style={{ marginTop: 15 }}>
              <div style={mnConnectionGroupLabelStyle(T)}>{mentions.length} unlinked mention{mentions.length > 1 ? 's' : ''}</div>
              {mentions.map(mention => (
                <div key={mention.id} style={{
                  display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', gap: 10, alignItems: 'center',
                  borderBottom: `1px solid ${T.lineSub}`,
                }}>
                  <button type="button" onClick={() => onOpen?.(mention.id)} style={{ ...mnConnectionRowStyle(T), minWidth: 0, borderBottom: 0 }}>
                    <span style={{ display: 'block', fontFamily: 'var(--mn-ui)', fontSize: 12, fontWeight: 550, color: T.ink, marginBottom: 3 }}>{mention.title}</span>
                    <span style={{ display: 'block', fontFamily: 'var(--mn-body)', fontSize: 12.5, color: T.inkMed, lineHeight: 1.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {mnRenderMentionSnippet(mention.snippet, T)}
                    </span>
                  </button>
                  {onLinkMention && (
                    <button type="button" onClick={() => linkMention(mention)} title={`Link this mention to “${note.title}”`} style={mnConnectionActionStyle(T, true)}>Link</button>
                  )}
                </div>
              ))}
            </div>
          )}

          {passiveRelatedItems.length > 0 && (
            <div style={{ marginTop: 15 }}>
              <div style={{ ...mnConnectionGroupLabelStyle(T), display: 'flex', gap: 7 }}>
                <span>{passiveRelatedItems.length} related</span>
                {related.mode && <span style={{ fontWeight: 450, color: T.inkDim }}>· {related.mode === 'semantic' ? 'semantic' : 'keyword'}</span>}
              </div>
              {passiveRelatedItems.map(item => (
                <button
                  key={item.noteId}
                  type="button"
                  onClick={() => onOpen?.(item.noteId)}
                  style={mnConnectionRowStyle(T)}
                  onMouseEnter={event => { event.currentTarget.style.background = T.bgHover; }}
                  onMouseLeave={event => { event.currentTarget.style.background = 'transparent'; }}>
                  <span style={{ display: 'block', fontFamily: 'var(--mn-ui)', fontSize: 12, fontWeight: 550, color: T.ink, marginBottom: item.snippet ? 3 : 0 }}>{item.title}</span>
                  {item.snippet && <span style={{ display: 'block', fontFamily: 'var(--mn-body)', fontSize: 12.5, color: T.inkMed, lineHeight: 1.5 }}>{item.snippet}</span>}
                </button>
              ))}
            </div>
          )}

          {connected.items.length > 0 && (
            <div style={{ marginTop: 15 }}>
              <div style={{ ...mnConnectionGroupLabelStyle(T), display: 'flex', gap: 7 }}>
                <span>{connected.items.length} in memory</span>
                <span style={{ fontWeight: 450, color: T.inkDim }}>· {connected.via === 'link' ? 'graph' : 'similar'}</span>
              </div>
              {connected.explanation && (
                <div style={{ fontFamily: 'var(--mn-body)', fontSize: 11.5, color: T.inkDim, lineHeight: 1.45, marginBottom: 8, fontStyle: 'italic' }}>
                  {connected.explanation}
                </div>
              )}
              {connected.items.map(item => (
                <div key={item.id} title={item.content} style={{ padding: '9px 4px', borderBottom: `1px solid ${T.lineSub}` }}>
                  <div style={{ fontFamily: 'var(--mn-ui)', fontSize: 12, fontWeight: 550, color: T.ink, marginBottom: item.snippet ? 3 : 0, display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.title}</span>
                    {item.category && <span style={{ fontSize: 9, fontWeight: 450, color: T.inkDim, flexShrink: 0 }}>{item.category}</span>}
                  </div>
                  {item.snippet && <div style={{ fontFamily: 'var(--mn-body)', fontSize: 12.5, color: T.inkMed, lineHeight: 1.5 }}>{item.snippet}</div>}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

export { ConnectionsSection };
