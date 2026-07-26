// Rail body for the connections column, built from the prototype's notes view.
//
// Three groups in a fixed order: the one suggestion worth acting on, what
// already points here, and what mentions this note without linking it. Each
// group states its own count, so the rail never needs a legend.

function RailGroupLabel({ children, T, style }) {
  return <div style={{ ...dsGroupLabelStyle(T), ...style }}>{children}</div>;
}

function RailRowTitle({ children, T }) {
  return (
    <div style={{
      fontSize: 12, fontWeight: 550, color: T.ink,
      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
    }}>{children}</div>
  );
}

// Snippets are prose, so they are set in the writing voice.
function RailSnippet({ children, clamp = 2, T }) {
  const clamped = clamp > 1
    ? { display: '-webkit-box', WebkitLineClamp: clamp, WebkitBoxOrient: 'vertical', overflow: 'hidden' }
    : { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' };
  return (
    <div style={{
      marginTop: 3, fontFamily: 'var(--mn-body)', fontSize: 12.5,
      color: T.inkMed, lineHeight: 1.5, ...clamped,
    }}>{children}</div>
  );
}

function railLinkButton(T) {
  return {
    height: 26, borderRadius: 7,
    border: `1px solid ${T.accent}`, background: T.accentSoft, color: T.accent,
    fontFamily: 'var(--mn-ui)', fontSize: 11, fontWeight: 650, cursor: 'pointer',
  };
}

function ConnectionsRail({
  suggestedConnections = [], backlinks = [], mentions = [],
  onOpen, onLinkMention, linkMention, note,
  acceptSuggestedConnection, ignoreSuggestedConnection, T,
}) {
  const suggestion = suggestedConnections[0] || null;
  const countLabel = (n, one, many) => `${n} ${n === 1 ? one : many}`;

  return (
    <>
      {suggestion && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <RailGroupLabel T={T}>Suggested</RailGroupLabel>
          <div style={{
            padding: '10px 11px', borderRadius: DS_RADIUS.row,
            background: T.bgElevated || T.bg, border: `1px solid ${T.selLine}`,
          }}>
            <div style={{
              fontSize: 12.5, fontWeight: 600, color: T.ink,
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>{suggestion.title || 'Untitled'}</div>
            {suggestion.reason && (
              <div style={{ marginTop: 3, fontSize: 11, color: T.inkDim }}>{suggestion.reason}</div>
            )}
            <div style={{ display: 'flex', gap: 6, marginTop: 9 }}>
              <button
                type="button"
                onClick={() => acceptSuggestedConnection?.(suggestion)}
                style={{ ...railLinkButton(T), flex: 1 }}>Link</button>
              <button
                type="button"
                onClick={() => ignoreSuggestedConnection?.(suggestion)}
                style={{
                  flex: 1, height: 26, borderRadius: 7,
                  border: `1px solid ${T.lineSub}`, background: 'transparent', color: T.inkDim,
                  fontFamily: 'var(--mn-ui)', fontSize: 11, fontWeight: 650, cursor: 'pointer',
                }}>Dismiss</button>
            </div>
          </div>
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <RailGroupLabel T={T} style={{ marginBottom: 3 }}>
          {countLabel(backlinks.length, 'backlink', 'backlinks')}
        </RailGroupLabel>
        {backlinks.map(item => (
          <div
            key={item.noteId || item.id}
            role="button"
            tabIndex={0}
            onClick={() => onOpen?.(item.noteId || item.id)}
            onKeyDown={event => {
              if (event.key !== 'Enter' && event.key !== ' ') return;
              event.preventDefault();
              onOpen?.(item.noteId || item.id);
            }}
            style={{ padding: '8px 4px', borderBottom: `1px solid ${T.lineSub}`, cursor: 'pointer' }}>
            <RailRowTitle T={T}>{item.title || 'Untitled'}</RailRowTitle>
            {item.snippet && <RailSnippet T={T}>{item.snippet}</RailSnippet>}
          </div>
        ))}
        {!backlinks.length && (
          <div style={{
            padding: '10px 4px', fontFamily: 'var(--mn-body)',
            fontSize: 12.5, lineHeight: 1.5, color: T.inkDim,
          }}>Nothing points here yet. Links appear when another note mentions this one.</div>
        )}
      </div>

      {mentions.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <RailGroupLabel T={T} style={{ marginBottom: 3 }}>
            {countLabel(mentions.length, 'unlinked mention', 'unlinked mentions')}
          </RailGroupLabel>
          {mentions.map(item => (
            <div
              key={item.noteId || item.id}
              style={{
                display: 'grid', gridTemplateColumns: 'minmax(0,1fr) auto',
                alignItems: 'center', gap: 10,
                padding: '8px 4px', borderBottom: `1px solid ${T.lineSub}`,
              }}>
              <div
                role="button"
                tabIndex={0}
                onClick={() => onOpen?.(item.noteId || item.id)}
                onKeyDown={event => {
                  if (event.key !== 'Enter' && event.key !== ' ') return;
                  event.preventDefault();
                  onOpen?.(item.noteId || item.id);
                }}
                style={{ minWidth: 0, cursor: 'pointer' }}>
                <RailRowTitle T={T}>{item.title || 'Untitled'}</RailRowTitle>
                {item.snippet && <RailSnippet clamp={1} T={T}>{item.snippet}</RailSnippet>}
              </div>
              <button
                type="button"
                aria-label={`Link mention in ${item.title || 'Untitled'}`}
                onClick={() => (linkMention ? linkMention(item) : onLinkMention?.(item.noteId || item.id, note?.id))}
                style={{ ...railLinkButton(T), padding: '0 9px' }}>Link</button>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

export { ConnectionsRail };
import { DS_RADIUS, dsGroupLabelStyle } from '../../../shared/designSystem.js';
