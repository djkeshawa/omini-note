

function MnSaveConflictDialog({ conflict, T, onReloadDisk, onKeepCopy, onDismiss }) {
  if (!conflict) return null;
  const when = conflict.currentModifiedAt ? new Date(conflict.currentModifiedAt).toLocaleString() : 'recently';
  const btn = (tone = 'default') => ({
    height: 32,
    padding: '0 12px',
    borderRadius: 6,
    cursor: 'pointer',
    fontFamily: 'var(--mn-ui)',
    fontSize: 12.5,
    fontWeight: 650,
    background: tone === 'primary' ? T.ink : T.bg,
    color: tone === 'primary' ? T.bg : T.inkMed,
    border: `1px solid ${tone === 'primary' ? T.ink : T.line}`,
  });
  return (
    <div className="mn-save-conflict-dialog" onClick={onDismiss} style={{
      position: 'absolute', inset: 0, zIndex: 93,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: `color-mix(in oklab, ${T.ink} 28%, transparent)`,
      backdropFilter: 'blur(2px)', animation: 'mnFadeIn 120ms ease',
    }}>
      <div role="dialog" aria-modal="true" aria-label="Save conflict" onClick={e => e.stopPropagation()} style={{
        width: 460, maxWidth: 'calc(100vw - 40px)',
        background: T.bg, color: T.ink, border: `1px solid ${T.line}`,
        borderRadius: 10, overflow: 'hidden',
        boxShadow: `0 24px 70px color-mix(in oklab, ${T.ink} 24%, transparent)`,
        fontFamily: 'var(--mn-ui)',
      }}>
        <div style={{ padding: '17px 18px 14px', background: T.bgSub, borderBottom: `1px solid ${T.lineSub}` }}>
          <div style={{ fontSize: 15, fontWeight: 750, marginBottom: 5 }}>Save conflict</div>
          <div style={{ fontFamily: 'var(--mn-body)', fontSize: 13, lineHeight: 1.45, color: T.inkMed }}>
            “{conflict.title || 'Untitled'}” changed on disk {when}. VispNote kept your local edits unsaved.
          </div>
        </div>
        <div style={{ padding: '14px 18px 16px', display: 'flex', justifyContent: 'flex-end', gap: 8, flexWrap: 'wrap' }}>
          <button onClick={onDismiss} style={btn()}>Keep editing</button>
          <button onClick={onKeepCopy} style={btn()}>Save local copy</button>
          <button onClick={onReloadDisk} style={btn('primary')}>Reload disk version</button>
        </div>
      </div>
    </div>
  );
}

export { MnSaveConflictDialog };
