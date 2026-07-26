const { useState: useStateP, useMemo: useMemoP, useEffect: useEffectP, useRef: useRefP } = React;
import { DS_RADIUS } from '../../../shared/designSystem.js';
import { DsEmptyState } from '../../../shared/components/DesignPrimitives.jsx';

function MnRecentlyDeletedPanel({
  items = [], loading = false, error = '', onRefresh, onRestore, onPurge, T,
}) {
  const [confirmTrashId, setConfirmTrashId] = useStateP('');
  const [busyTrashId, setBusyTrashId] = useStateP('');
  const total = items.length;
  const noteCount = items.filter(item => item.sourceType !== 'canvas').length;
  const canvasCount = items.filter(item => item.sourceType === 'canvas').length;

  const runRestore = async (item) => {
    setBusyTrashId(item.trashId);
    setConfirmTrashId('');
    try {
      const result = await onRestore?.(item);
      if (result?.ok !== false) await onRefresh?.();
    } finally {
      setBusyTrashId('');
    }
  };

  const runPurge = async (item) => {
    if (confirmTrashId !== item.trashId) {
      setConfirmTrashId(item.trashId);
      return;
    }
    setBusyTrashId(item.trashId);
    try {
      const result = await onPurge?.(item);
      if (result?.ok !== false) await onRefresh?.();
    } finally {
      setBusyTrashId('');
      setConfirmTrashId('');
    }
  };

  const stat = (label, value) => (
    <div style={{
      border: `1px solid ${T.lineSub}`,
      borderRadius: 8,
      background: T.bgSub,
      padding: '10px 12px',
      minWidth: 0,
    }}>
      <div style={{ fontFamily: 'var(--mn-ui)', fontWeight: 600, fontSize: 11, color: T.inkDim, }}>{label}</div>
      <div style={{ marginTop: 4, fontSize: 20, fontWeight: 720, color: T.ink }}>{value}</div>
    </div>
  );

  return (
    <div style={{
      flex: 1,
      height: '100%',
      background: T.bg,
      overflow: 'auto',
      padding: '34px 28px 28px',
    }}>
      <div style={{ maxWidth: 860, margin: '0 auto' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16, marginBottom: 22 }}>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{
              fontFamily: 'var(--mn-ui)',
              fontSize: 25,
              fontWeight: 680,
              color: T.ink,
              letterSpacing: 0,
            }}>Recently deleted</div>
            <div style={{
              marginTop: 5,
              fontFamily: 'var(--mn-body)',
              fontSize: 13,
              lineHeight: 1.45,
              color: T.inkDim,
              maxWidth: 620,
            }}>Deleted notes and canvases stay here before cleanup. Restore anything you still need, or permanently delete items you are sure are no longer useful.</div>
          </div>
          <button
            onClick={onRefresh}
            disabled={loading || !onRefresh}
            style={{
              border: `1px solid ${T.line}`,
              borderRadius: 7,
              background: T.bg,
              color: loading ? T.inkDim : T.inkMed,
              cursor: loading || !onRefresh ? 'default' : 'pointer',
              padding: '7px 11px',
              fontFamily: 'var(--mn-ui)',
              fontSize: 12.5,
              fontWeight: 620,
              flexShrink: 0,
            }}>{loading ? 'Refreshing...' : 'Refresh'}</button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 10, marginBottom: 18 }}>
          {stat('Pending cleanup', total)}
          {stat('Notes', noteCount)}
          {stat('Canvases', canvasCount)}
        </div>

        {error && (
          <div style={{
            marginBottom: 12,
            border: `1px solid color-mix(in oklab, ${T.danger || T.warn} 32%, ${T.lineSub})`,
            borderRadius: 8,
            background: `color-mix(in oklab, ${T.danger || T.warn} 8%, ${T.bgSub})`,
            color: T.danger || T.warn,
            padding: '10px 12px',
            fontSize: 12.5,
          }}>{error}</div>
        )}

        {!loading && total === 0 && !error && (
          <div style={{
            border: `1px dashed ${T.line}`,
            borderRadius: DS_RADIUS.row,
            background: T.bgSub,
          }}>
            <DsEmptyState
              T={T}
              tone="success"
              icon={(
                <svg width="17" height="17" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.35" aria-hidden="true">
                  <path d="M3 4.5H13M6 4.5V3C6 2.5 6.5 2 7 2H9C9.5 2 10 2.5 10 3V4.5M5 4.5V13C5 13.5 5.5 14 6 14H10C10.5 14 11 13.5 11 13V4.5" strokeLinecap="round"/>
                </svg>
              )}
              headline="No deleted items"
              body="Notes and canvases you delete will appear here until cleanup."
            />
          </div>
        )}

        {total > 0 && (
          <div style={{ display: 'grid', gap: 8 }}>
            {items.map(item => {
              const confirming = confirmTrashId === item.trashId;
              const busy = busyTrashId === item.trashId;
              const typeLabel = item.sourceType === 'canvas' ? 'Canvas' : 'Note';
              return (
                <div key={item.trashId} style={{
                  display: 'grid',
                  gridTemplateColumns: 'minmax(0, 1fr) auto',
                  gap: 12,
                  alignItems: 'center',
                  padding: '12px 13px',
                  border: `1px solid ${confirming ? `color-mix(in oklab, ${T.danger || T.warn} 42%, ${T.lineSub})` : T.lineSub}`,
                  borderRadius: 8,
                  background: confirming ? `color-mix(in oklab, ${T.danger || T.warn} 6%, ${T.bgSub})` : T.bgSub,
                }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                      <span style={{
                        fontFamily: 'var(--mn-mono)',
                        fontSize: 10,
                        color: item.sourceType === 'canvas' ? T.accent : T.inkDim,
                        border: `1px solid ${T.lineSub}`,
                        borderRadius: 999,
                        background: T.bg,
                        padding: '2px 6px',
                        flexShrink: 0,
                      }}>{typeLabel}</span>
                      <div style={{
                        minWidth: 0,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        fontSize: 14,
                        fontWeight: 680,
                        color: T.ink,
                      }}>{item.title || 'Untitled'}</div>
                    </div>
                    <div style={{
                      marginTop: 5,
                      fontFamily: 'var(--mn-mono)',
                      fontSize: 10.5,
                      color: T.inkDim,
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}>
                      Deleted {item.deletedAt ? new Date(item.deletedAt).toLocaleString() : 'recently'}
                      {item.originalId ? ` · ${item.originalId}` : ''}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                    {confirming && (
                      <button
                        onClick={() => setConfirmTrashId('')}
                        disabled={busy}
                        style={{
                          border: `1px solid ${T.lineSub}`,
                          borderRadius: 6,
                          background: T.bg,
                          color: T.inkMed,
                          cursor: busy ? 'default' : 'pointer',
                          padding: '7px 10px',
                          fontFamily: 'var(--mn-ui)',
                          fontSize: 12,
                        }}>Cancel</button>
                    )}
                    <button
                      onClick={() => runRestore(item)}
                      disabled={busy || !onRestore}
                      style={{
                        border: `1px solid ${T.line}`,
                        borderRadius: 6,
                        background: T.bg,
                        color: T.inkMed,
                        cursor: busy || !onRestore ? 'default' : 'pointer',
                        padding: '7px 10px',
                        fontFamily: 'var(--mn-ui)',
                        fontSize: 12,
                        fontWeight: 620,
                      }}>{busy ? 'Working...' : 'Restore'}</button>
                    <button
                      onClick={() => runPurge(item)}
                      disabled={busy || !onPurge}
                      style={{
                        border: `1px solid ${confirming ? (T.danger || T.warn) : T.lineSub}`,
                        borderRadius: 6,
                        background: confirming ? (T.danger || T.warn) : T.bg,
                        color: confirming ? T.bg : (T.danger || T.warn),
                        cursor: busy || !onPurge ? 'default' : 'pointer',
                        padding: '7px 10px',
                        fontFamily: 'var(--mn-ui)',
                        fontSize: 12,
                        fontWeight: 650,
                      }}>{confirming ? 'Confirm delete' : 'Delete permanently'}</button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────
// Quick-capture popover (floating)
// ────────────────────────────────────────────────────────────

export { MnRecentlyDeletedPanel };
