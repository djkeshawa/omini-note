import { dsGroupLabelStyle, dsMachineStyle } from '../shared/designSystem.js';
const { useEffect, useRef, useState } = React;

function LocalStatusPopover({ activeVault, saveStatus = 'Saved', lastBackupAt = null, onOpenVaultHealth, onExportBackup, onOpenSettings, T }) {
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

  const statusColor = saveStatus === 'Conflict'
    ? (T.danger || T.warn)
    : saveStatus === 'Saving' ? (T.warn || T.accent) : T.success;
  const backupLabel = lastBackupAt && Number.isFinite(new Date(lastBackupAt).getTime())
    ? new Date(lastBackupAt).toLocaleString()
    : 'No backup recorded';
  const runBackup = async () => {
    if (!onExportBackup || backupBusy) return;
    setBackupBusy(true);
    try { await onExportBackup(); }
    finally { setBackupBusy(false); }
  };

  return (
    <div ref={rootRef} style={{
      padding: '7px 10px', borderTop: `1px solid ${T.lineSub}`,
      display: 'flex', alignItems: 'center', gap: 6,
      flexShrink: 0, minWidth: 0, position: 'relative',
    }}>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`Local status: ${saveStatus}`}
        title="Local vault status"
        onClick={() => setOpen(value => !value)}
        style={{
          minWidth: 0, flex: 1, minHeight: 32, padding: '4px 6px',
          display: 'flex', alignItems: 'center', gap: 7,
          border: `1px solid ${open ? T.lineSub : 'transparent'}`, borderRadius: 7,
          background: open ? T.bg : 'transparent', color: T.inkDim, cursor: 'pointer',
          fontFamily: 'var(--mn-ui)', fontSize: 11, textAlign: 'left',
        }}>
        <span aria-hidden="true" style={{ width: 7, height: 7, borderRadius: '50%', background: statusColor, flexShrink: 0 }} />
        <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>Local</span>
        {saveStatus !== 'Saved' && (
          <span style={{ marginLeft: 'auto', flexShrink: 0, color: saveStatus === 'Conflict' ? (T.danger || T.warn) : T.inkDim }}>{saveStatus}</span>
        )}
      </button>
      <button type="button" onClick={onOpenSettings} aria-label="Open settings" title="Settings" style={{
        width: 32, height: 32, borderRadius: 7,
        background: 'transparent', border: 'none', color: T.inkMed, cursor: 'pointer',
        padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
      }}>
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden="true">
          <circle cx="8" cy="8" r="2.2"/>
          <path d="M8 1.5V3M8 13V14.5M14.5 8H13M3 8H1.5M12.6 3.4L11.5 4.5M4.5 11.5L3.4 12.6M12.6 12.6L11.5 11.5M4.5 4.5L3.4 3.4" strokeLinecap="round"/>
        </svg>
      </button>
      {open && (
        <div role="dialog" aria-label="Local vault status" style={{
          position: 'absolute', left: 10, right: 10, bottom: 'calc(100% + 6px)', zIndex: 80,
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
