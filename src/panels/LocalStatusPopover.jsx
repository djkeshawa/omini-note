import { DS_RADIUS, dsGroupLabelStyle, dsMachineStyle, dsToneColor } from '../shared/designSystem.js';
const { useEffect, useRef, useState } = React;

// Mirrors SAVE_TONES in the editor header. It used to be a ternary chain that
// fell through to T.success, so "Not saved" would have shown a green dot.
const SAVE_TONES = {
  Saved: 'success', Saving: 'warn', Retrying: 'warn',
  'Not saved': 'danger', Conflict: 'danger', Offline: 'warn',
};

function LocalStatusPopover({ activeVault, saveStatus = 'Saved', lastBackupAt = null, onOpenVaultHealth, onExportBackup, T }) {
  const [open, setOpen] = useState(false);
  const [backupBusy, setBackupBusy] = useState(false);
  const rootRef = useRef(null);
  const triggerRef = useRef(null);
  const healthRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    healthRef.current?.focus?.();
    const closeOutside = event => {
      if (!rootRef.current?.contains(event.target)) setOpen(false);
    };
    const closeOnEscape = event => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      setOpen(false);
      triggerRef.current?.focus?.();
    };
    document.addEventListener('pointerdown', closeOutside);
    document.addEventListener('keydown', closeOnEscape, true);
    return () => {
      document.removeEventListener('pointerdown', closeOutside);
      document.removeEventListener('keydown', closeOnEscape, true);
    };
  }, [open]);

  const statusColor = dsToneColor(T, SAVE_TONES[saveStatus] || 'neutral');
  const backupLabel = lastBackupAt && Number.isFinite(new Date(lastBackupAt).getTime())
    ? new Date(lastBackupAt).toLocaleString()
    : 'No backup recorded';
  const backupShort = lastBackupAt && Number.isFinite(new Date(lastBackupAt).getTime())
    ? new Date(lastBackupAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : '';
  const runBackup = async () => {
    if (!onExportBackup || backupBusy) return;
    setBackupBusy(true);
    try { await onExportBackup(); }
    finally { setBackupBusy(false); }
  };

  return (
    <div ref={rootRef} style={{
      flexShrink: 0, margin: 10, position: 'relative',
    }}>
      {/* The footer states where the vault is and whether it is saved. The
          button opens the detail; settings live in the app bar. */}
      <div style={{
        padding: '10px 11px', borderRadius: DS_RADIUS.row,
        background: T.bgElevated || T.bg, border: `1px solid ${T.lineSub}`,
        display: 'grid', gridTemplateColumns: 'auto minmax(0,1fr) auto',
        alignItems: 'center', gap: 9,
      }}>
        <span aria-hidden="true" style={{
          width: 8, height: 8, borderRadius: '50%', background: statusColor,
          boxShadow: `0 0 0 3px color-mix(in oklab, ${statusColor} 16%, transparent)`,
        }} />
        <div style={{ minWidth: 0 }}>
          <div style={{ fontFamily: 'var(--mn-ui)', fontSize: 12, fontWeight: 600, color: T.ink }}>
            {saveStatus === 'Saved' ? 'All changes saved' : saveStatus}
          </div>
          <div title={activeVault?.path || ''} style={{
            marginTop: 2, ...dsMachineStyle(T), fontSize: 9.5,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>{activeVault?.path || 'Unavailable'}{lastBackupAt ? ` · backed up ${backupShort}` : ''}</div>
        </div>
        <button
          ref={triggerRef}
          type="button"
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-label={`Local status: ${saveStatus}`}
          title="Local vault status"
          onClick={() => setOpen(value => !value)}
          style={{
            width: 24, height: 24, borderRadius: DS_RADIUS.icon,
            border: `1px solid ${T.lineSub}`, background: T.bgSub, color: T.inkMed,
            cursor: 'pointer', padding: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
            <path d="M4 6.5L8 10.5L12 6.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>
      {open && (
        <div role="dialog" aria-label="Local vault status" style={{
          position: 'absolute', left: 0, right: 0, bottom: 'calc(100% + 6px)', zIndex: 80,
          padding: 11, border: `1px solid ${T.line}`, borderRadius: 9,
          background: T.bg, color: T.ink,
          boxShadow: `0 14px 36px color-mix(in oklab, ${T.ink} 20%, transparent)`,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: '50%', background: statusColor }} />
            <strong style={{ fontFamily: 'var(--mn-ui)', fontSize: 12.5 }}>{saveStatus}</strong>
            <span style={{ marginLeft: 'auto', ...dsGroupLabelStyle(T) }}>Local-first</span>
          </div>
          <StatusDetail label="Vault folder" value={activeVault?.path || 'Unavailable'} T={T} />
          <StatusDetail label="Last backup" value={backupLabel} T={T} />
          <div style={{ display: 'flex', gap: 7, marginTop: 11 }}>
            <button ref={healthRef} type="button" onClick={() => { setOpen(false); onOpenVaultHealth?.(); }} style={actionButton(T)}>
              Vault health
            </button>
            <button type="button" disabled={backupBusy || !onExportBackup} onClick={runBackup} style={actionButton(T, true)}>
              {backupBusy ? 'Backing up…' : 'Back up now'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function StatusDetail({ label, value, T }) {
  return (
    <div style={{ marginTop: 8 }}>
      <div style={dsGroupLabelStyle(T)}>{label}</div>
      <div title={value} style={{ marginTop: 3, ...dsMachineStyle(T, T.inkMed), fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{value}</div>
    </div>
  );
}

function actionButton(T, primary = false) {
  return {
    flex: 1, minHeight: 36, padding: '6px 8px', borderRadius: 7,
    border: `1px solid ${primary ? T.ink : T.lineSub}`,
    background: primary ? T.ink : T.bgSub,
    color: primary ? T.bg : T.inkMed,
    cursor: 'pointer', fontFamily: 'var(--mn-ui)', fontSize: 11.5, fontWeight: 650,
  };
}

export { LocalStatusPopover };
