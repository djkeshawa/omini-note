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
    background: primary ? T.accentSoft : T.bg,
    color: primary ? T.accent : T.inkDim,
    cursor: 'pointer',
    fontFamily: 'var(--mn-ui)',
    fontSize: 11,
    fontWeight: 650,
    padding: '4px 8px',
  };
}

function ConnectionsSection({
  suggestedConnections, backlinks, mentions, passiveRelatedItems, connected, related,
  onOpen, onLinkMention, linkMention, note, acceptSuggestedConnection, ignoreSuggestedConnection, T,
}) {
  return (
    <>
{(suggestedConnections.length > 0 || backlinks.length > 0 || mentions.length > 0 || passiveRelatedItems.length > 0 || connected.items.length > 0) && (
            <div style={{ marginTop: 40, paddingTop: 20, borderTop: `1px solid ${T.lineSub}` }}>
              <div style={{
                fontFamily: 'var(--mn-ui)', fontSize: 15, fontWeight: 720,
                color: T.ink, marginBottom: suggestedConnections.length ? 10 : 2,
              }}>Connections</div>
              {suggestedConnections.length > 0 && (
                <div style={{ marginBottom: 18 }}>
                  <div style={{ fontFamily: 'var(--mn-mono)', fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: T.inkDim, marginBottom: 7 }}>
                    Suggested links
                  </div>
                  {suggestedConnections.map(item => (
                    <div key={item.noteId || item.id} style={{
                      display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto auto', gap: 6, alignItems: 'center',
                      padding: '9px 10px', marginBottom: 6, borderRadius: 6,
                      background: T.bgSub, border: `1px solid ${T.lineSub}`,
                    }}>
                      <button type="button" onClick={() => onOpen(item.noteId || item.id)} style={{
                        minWidth: 0, border: 0, background: 'transparent', color: T.ink,
                        textAlign: 'left', cursor: 'pointer', fontFamily: 'var(--mn-ui)', fontSize: 12.5,
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      }}>{item.title || 'Untitled'}</button>
                      {item.reason && <span style={{ gridColumn: '1 / -1', fontFamily: 'var(--mn-mono)', fontSize: 9.5, color: T.inkDim }}>{item.reason}</span>}
                      <button type="button" aria-label={`Accept connection to ${item.title || 'note'}`} onClick={() => acceptSuggestedConnection(item)} style={mnConnectionActionStyle(T, true)}>Accept</button>
                      <button type="button" aria-label={`Ignore connection to ${item.title || 'note'}`} onClick={() => ignoreSuggestedConnection(item)} style={mnConnectionActionStyle(T, false)}>Ignore</button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {backlinks.length > 0 && (
            <div style={{
              marginTop: 18,
            }}>
              <div style={{
                fontFamily: 'var(--mn-mono)', fontSize: 10,
                letterSpacing: '0.12em', textTransform: 'uppercase',
                color: T.inkDim, marginBottom: 10,
              }}>← {backlinks.length} backlink{backlinks.length > 1 ? 's' : ''}</div>
              {backlinks.map(b => (
                <div key={b.id} onClick={() => onOpen(b.id)} style={{
                  padding: '10px 12px', marginBottom: 6, borderRadius: 6,
                  background: T.bgSub, border: `1px solid ${T.lineSub}`,
                  cursor: 'pointer',
                }}
                onMouseEnter={e => e.currentTarget.style.background = T.bgHover}
                onMouseLeave={e => e.currentTarget.style.background = T.bgSub}>
                  <div style={{
                    fontFamily: 'var(--mn-ui)', fontSize: 12, fontWeight: 500,
                    color: T.ink, marginBottom: 3,
                  }}>{b.title}</div>
                  <div style={{
                    fontFamily: 'var(--mn-body)', fontSize: 12.5,
                    color: T.inkMed, lineHeight: 1.5,
                  }}>{b.context.replace(/\[\[([^\]]+)\]\]/g, '$1').replace(/^[-#>*\s]*\s*/, '')}</div>
                </div>
              ))}
            </div>
          )}

          {mentions.length > 0 && (
            <div style={{
              marginTop: 18,
            }}>
              <div style={{
                fontFamily: 'var(--mn-mono)', fontSize: 10,
                letterSpacing: '0.12em', textTransform: 'uppercase',
                color: T.inkDim, marginBottom: 10,
              }}>~ {mentions.length} unlinked mention{mentions.length > 1 ? 's' : ''}</div>
              {mentions.map(m => (
                <div key={m.id} style={{
                  display: 'grid', gridTemplateColumns: '1fr auto', gap: 10, alignItems: 'center',
                  padding: '10px 12px', marginBottom: 6, borderRadius: 6,
                  background: T.bgSub, border: `1px solid ${T.lineSub}`,
                }}>
                  <div onClick={() => onOpen(m.id)} style={{ cursor: 'pointer', minWidth: 0 }}>
                    <div style={{
                      fontFamily: 'var(--mn-ui)', fontSize: 12, fontWeight: 500,
                      color: T.ink, marginBottom: 3,
                    }}>{m.title}</div>
                    <div style={{
                      fontFamily: 'var(--mn-body)', fontSize: 12.5,
                      color: T.inkMed, lineHeight: 1.5,
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>{mnRenderMentionSnippet(m.snippet, T)}</div>
                  </div>
                  {onLinkMention && (
                    <button
                      onClick={() => linkMention(m)}
                      title={`Link this mention to “${note.title}”`}
                      style={{
                        border: `1px solid ${T.lineSub}`, borderRadius: 6,
                        background: T.bg, color: T.accent, cursor: 'pointer',
                        fontFamily: 'var(--mn-ui)', fontSize: 11.5, fontWeight: 600,
                        padding: '5px 10px', whiteSpace: 'nowrap',
                      }}>
                      Link
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}

          {passiveRelatedItems.length > 0 && (
            <div style={{
              marginTop: 18,
            }}>
              <div style={{
                fontFamily: 'var(--mn-mono)', fontSize: 10,
                letterSpacing: '0.12em', textTransform: 'uppercase',
                color: T.inkDim, marginBottom: 10,
                display: 'flex', alignItems: 'center', gap: 8,
              }}>
                <span>≈ {passiveRelatedItems.length} related</span>
                {related.mode && (
                  <span style={{
                    fontSize: 9, letterSpacing: '0.1em',
                    color: T.inkDim, opacity: 0.7,
                  }}>{related.mode === 'semantic' ? 'semantic' : 'keyword'}</span>
                )}
              </div>
              {passiveRelatedItems.map(r => (
                <div key={r.noteId} onClick={() => onOpen(r.noteId)} style={{
                  padding: '10px 12px', marginBottom: 6, borderRadius: 6,
                  background: T.bgSub, border: `1px solid ${T.lineSub}`,
                  cursor: 'pointer',
                }}
                onMouseEnter={e => e.currentTarget.style.background = T.bgHover}
                onMouseLeave={e => e.currentTarget.style.background = T.bgSub}>
                  <div style={{
                    fontFamily: 'var(--mn-ui)', fontSize: 12, fontWeight: 500,
                    color: T.ink, marginBottom: 3,
                  }}>{r.title}</div>
                  {r.snippet && (
                    <div style={{
                      fontFamily: 'var(--mn-body)', fontSize: 12.5,
                      color: T.inkMed, lineHeight: 1.5,
                    }}>{r.snippet}</div>
                  )}
                </div>
              ))}
            </div>
          )}
          {connected.items.length > 0 && (
            <div style={{
              marginTop: 18,
            }}>
              <div style={{
                fontFamily: 'var(--mn-mono)', fontSize: 10,
                letterSpacing: '0.12em', textTransform: 'uppercase',
                color: T.inkDim, marginBottom: 10,
                display: 'flex', alignItems: 'center', gap: 8,
              }}>
                <span>◆ {connected.items.length} in memory</span>
                <span style={{
                  fontSize: 9, letterSpacing: '0.1em',
                  color: T.inkDim, opacity: 0.7,
                }}>{connected.via === 'link' ? 'graph' : 'similar'}</span>
              </div>
              {connected.explanation && (
                <div style={{
                  fontFamily: 'var(--mn-body)', fontSize: 11.5,
                  color: T.inkDim, lineHeight: 1.45, marginBottom: 10, fontStyle: 'italic',
                }}>{connected.explanation}</div>
              )}
              {connected.items.map(item => (
                <div key={item.id} title={item.content} style={{
                  padding: '10px 12px', marginBottom: 6, borderRadius: 6,
                  background: T.bgSub, border: `1px solid ${T.lineSub}`,
                }}>
                  <div style={{
                    fontFamily: 'var(--mn-ui)', fontSize: 12, fontWeight: 500,
                    color: T.ink, marginBottom: 3,
                    display: 'flex', alignItems: 'center', gap: 6,
                  }}>
                    <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.title}</span>
                    {item.category && (
                      <span style={{
                        fontFamily: 'var(--mn-mono)', fontSize: 8.5, letterSpacing: '0.08em',
                        textTransform: 'uppercase', color: T.inkDim, opacity: 0.75, flexShrink: 0,
                      }}>{item.category}</span>
                    )}
                  </div>
                  {item.snippet && (
                    <div style={{
                      fontFamily: 'var(--mn-body)', fontSize: 12.5,
                      color: T.inkMed, lineHeight: 1.5,
                    }}>{item.snippet}</div>
                  )}
                </div>
              ))}
            </div>
          )}
    </>
  );
}

export { ConnectionsSection };
