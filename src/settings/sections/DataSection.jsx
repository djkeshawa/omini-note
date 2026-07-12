import { H, SettingsCard, Row, Segmented, Toggle, Select, FontSizeStepper } from '../settingsControls.jsx';
import { mnSettingsInput, BtnOutline, StaticValue } from '../settingsPrimitives.jsx';
import { SectionUsagePrivacy } from './UsagePrivacySection.jsx';
const { useState: useStateS, useEffect: useEffectS, useRef: useRefS } = React;

function SectionData({
  tweaks, setTweak, T, stats, vaults, activeVaultId, activeVault,
  onCreateVault, onDeleteVault, onSetVaultNovelistMode,
  onListDeletedNotes, onRestoreDeletedNote, onPurgeDeletedNote,
  onExportBackup, onImportBackup, onImportMarkdown, onImportNovelFiles, onOpenVaultHealth, onRebuildIndex,
  writerEnabled = false,
}) {
  const [newVaultName, setNewVaultName] = useStateS('');
  const [newVaultMode, setNewVaultMode] = useStateS('general');
  const [confirmingDelete, setConfirmingDelete] = useStateS(false);
  const [confirmText, setConfirmText] = useStateS('');
  const [busy, setBusy] = useStateS(false);
  const [error, setError] = useStateS('');
  const [deletedNotes, setDeletedNotes] = useStateS([]);
  const [deletedBusy, setDeletedBusy] = useStateS(false);
  const [deletedError, setDeletedError] = useStateS('');
  const deletedLoadSeq = useRefS(0);
  const currentVault = activeVault || vaults.find(v => v.id === activeVaultId) || null;
  const canDeleteVault = !!currentVault && vaults.length > 1;
  const deleteReady = canDeleteVault && confirmText.trim() === currentVault.name;
  const loadDeletedNotes = async () => {
    if (!onListDeletedNotes) return;
    const seq = ++deletedLoadSeq.current;
    setDeletedBusy(true);
    setDeletedError('');
    try {
      const next = await onListDeletedNotes();
      if (seq === deletedLoadSeq.current) setDeletedNotes(next);
    } catch (e) {
      if (seq === deletedLoadSeq.current) setDeletedError(e.message || String(e));
    } finally {
      if (seq === deletedLoadSeq.current) setDeletedBusy(false);
    }
  };
  useEffectS(() => {
    loadDeletedNotes();
  }, [activeVaultId]);
  useEffectS(() => {
    if (!confirmingDelete) return;
    const onKey = (e) => {
      if (e.key === 'Escape') {
        setConfirmingDelete(false);
        setConfirmText('');
        setError('');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [confirmingDelete]);
  const submitCreateVault = async () => {
    const name = newVaultName.trim();
    if (!name || !onCreateVault) return;
    setError('');
    setBusy(true);
    try {
      await onCreateVault(name, {
        type: newVaultMode === 'writer' ? 'novelist' : 'notes',
        onboardingMode: newVaultMode,
      });
      setNewVaultName('');
      setNewVaultMode('general');
      setConfirmingDelete(false);
      setConfirmText('');
    } finally {
      setBusy(false);
    }
  };
  const submitDeleteVault = async () => {
    if (!deleteReady || !onDeleteVault) return;
    setError('');
    setBusy(true);
    try {
      const result = await onDeleteVault(currentVault.id);
      if (result && result.ok === false) {
        setError(result.error || 'Could not delete vault.');
        return;
      }
      setConfirmingDelete(false);
      setConfirmText('');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div>
      <H T={T} label="Data & Sync" sub="Where VispNote keeps your markdown files." />
      <SettingsCard T={T}>
        <Row T={T} label="Current vault" sub="Folder on disk where this vault's markdown files are stored.">
          <div style={{
            fontFamily: 'var(--mn-mono)', fontSize: 11.5, color: T.inkMed,
            padding: '6px 10px', border: `1px solid ${T.line}`, borderRadius: 6,
            background: T.bgSub,
            maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }} title={currentVault?.path || ''}>{currentVault?.path || '~/VispNote/vault'}</div>
        </Row>
        <Row T={T} label="Create vault" sub="Start a separate local workspace with its own notes and tags.">
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            {writerEnabled && <Segmented T={T} value={newVaultMode} onChange={setNewVaultMode}
              options={[{ value: 'general', label: 'Personal' }, { value: 'writer', label: 'Writer' }]} />}
            <input
              value={newVaultName}
              onChange={e => setNewVaultName(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') submitCreateVault();
              }}
              placeholder="Vault name"
              style={mnSettingsInput(T, { width: 180 })}
            />
            <BtnOutline T={T} disabled={busy || !newVaultName.trim()} onClick={submitCreateVault}>Create</BtnOutline>
          </div>
        </Row>
        {writerEnabled && <Row T={T} label="Vault mode" sub="Convert this vault into a focused long-form writing workspace.">
          <Segmented T={T} value={currentVault?.novelistMode ? 'novelist' : 'notes'}
            onChange={async (mode) => {
              if (!onSetVaultNovelistMode) return;
              setBusy(true);
              setError('');
              try {
                const result = await onSetVaultNovelistMode(mode === 'novelist');
                if (result && result.ok === false) setError(result.error || 'Could not update vault mode.');
              } finally {
                setBusy(false);
              }
            }}
            options={[{ value: 'notes', label: 'Notes vault' }, { value: 'novelist', label: 'Novelist vault' }]} />
        </Row>}
        <Row T={T} label="Auto-save" sub="Persist changes to disk as you type.">
          <StaticValue T={T}>Always on</StaticValue>
        </Row>
        <Row T={T} label="Storage format" sub="Every note is saved as a standalone file.">
          <StaticValue T={T}>Markdown</StaticValue>
        </Row>
        <Row T={T} label="Sync backend" sub="Keep notes in sync across devices.">
          <StaticValue T={T}>Local only</StaticValue>
        </Row>
        <Row T={T} label="Backup and restore" sub="Export all vaults or restore a backup into new vaults.">
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
            <BtnOutline T={T} disabled={!onExportBackup} onClick={onExportBackup}>Export backup</BtnOutline>
            <BtnOutline T={T} disabled={!onImportBackup} onClick={onImportBackup}>Import backup</BtnOutline>
          </div>
        </Row>
        <Row T={T} label="Import Markdown" sub="Preview notes, title collisions, links, and safe relative attachments before adding anything.">
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
            <BtnOutline T={T} disabled={!onImportMarkdown} onClick={() => onImportMarkdown?.('files')}>Choose files</BtnOutline>
            <BtnOutline T={T} disabled={!onImportMarkdown} onClick={() => onImportMarkdown?.('folder')}>Choose folder</BtnOutline>
          </div>
        </Row>
        {writerEnabled && <Row T={T} label="Import novel files" sub={currentVault?.novelistMode ? "Analyze text files and preview generated novel notes before applying them." : "Switch this vault to Writer mode before importing novel files."}>
          <BtnOutline
            T={T}
            disabled={busy || !currentVault?.novelistMode || !onImportNovelFiles}
            onClick={onImportNovelFiles}
          >Import novel files</BtnOutline>
        </Row>}
        <Row T={T} label="Vault health" sub="Check broken links, orphan notes, and search index status.">
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
            <BtnOutline T={T} disabled={!onOpenVaultHealth} onClick={onOpenVaultHealth}>Open health</BtnOutline>
            <BtnOutline T={T} disabled={!onRebuildIndex} onClick={onRebuildIndex}>Rebuild index</BtnOutline>
          </div>
        </Row>
        <Row T={T} label="Delete current vault" sub={canDeleteVault ? "Permanently remove this vault and every note file inside it." : "Create another vault before deleting this one."} last>
          <BtnOutline
            T={T}
            danger
            disabled={busy || !canDeleteVault}
            onClick={() => {
              setError('');
              setConfirmingDelete(true);
              setConfirmText('');
            }}
          >Delete vault...</BtnOutline>
        </Row>
      </SettingsCard>
      <SectionUsagePrivacy T={T} />
      <SettingsCard T={T} style={{ marginTop: 14 }}>
        <Row
          T={T}
          label="Recently deleted"
          sub="Deleted notes are kept for 30 days before cleanup."
          last={deletedNotes.length === 0}
        >
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'flex-end' }}>
            <StaticValue T={T}>{deletedNotes.length} note{deletedNotes.length === 1 ? '' : 's'}</StaticValue>
            <BtnOutline T={T} disabled={deletedBusy || !onListDeletedNotes} onClick={loadDeletedNotes}>Refresh</BtnOutline>
          </div>
        </Row>
        {deletedError && (
          <div style={{ padding: '0 18px 12px', fontSize: 12, color: T.danger }}>{deletedError}</div>
        )}
        {deletedNotes.length > 0 && (
          <div style={{ padding: '0 18px 14px', display: 'flex', flexDirection: 'column', gap: 6 }}>
            {deletedNotes.slice(0, 8).map(item => (
              <div key={item.trashId} style={{
                display: 'grid',
                gridTemplateColumns: 'minmax(0, 1fr) auto auto',
                gap: 8,
                alignItems: 'center',
                padding: '8px 10px',
                border: `1px solid ${T.lineSub}`,
                borderRadius: 7,
                background: T.bgSub,
              }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{
                    fontFamily: 'var(--mn-ui)',
                    fontSize: 12.5,
                    fontWeight: 650,
                    color: T.ink,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}>{item.title || 'Untitled'}</div>
                  <div style={{
                    marginTop: 2,
                    fontFamily: 'var(--mn-mono)',
                    fontSize: 10,
                    color: T.inkDim,
                  }}>{item.sourceType === 'canvas' ? 'Canvas' : 'Note'} · Deleted {item.deletedAt ? new Date(item.deletedAt).toLocaleString() : 'recently'}</div>
                </div>
                <BtnOutline
                  T={T}
                  disabled={deletedBusy || !onRestoreDeletedNote}
                  onClick={async () => {
                    setDeletedBusy(true);
                    const result = await onRestoreDeletedNote(item);
                    if (result?.ok !== false) await loadDeletedNotes();
                    setDeletedBusy(false);
                  }}
                >Restore</BtnOutline>
                <BtnOutline
                  T={T}
                  danger
                  disabled={deletedBusy || !onPurgeDeletedNote}
                  onClick={async () => {
                    setDeletedBusy(true);
                    const result = await onPurgeDeletedNote(item);
                    if (result?.ok !== false) await loadDeletedNotes();
                    setDeletedBusy(false);
                  }}
                >Delete permanently</BtnOutline>
              </div>
            ))}
          </div>
        )}
      </SettingsCard>
      {error && !confirmingDelete && <div style={{
        marginTop: 10,
        fontFamily: 'var(--mn-ui)',
        fontSize: 12,
        color: T.danger,
      }}>{error}</div>}
      {confirmingDelete && currentVault && (
        <div
          onClick={() => {
            if (busy) return;
            setConfirmingDelete(false);
            setConfirmText('');
            setError('');
          }}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 90,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 20,
            background: `color-mix(in oklab, ${T.ink} 34%, transparent)`,
            backdropFilter: 'blur(2px)',
            animation: 'mnFadeIn 120ms ease',
          }}>
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="mn-delete-vault-title"
            onClick={(e) => e.stopPropagation()}
            style={{
              width: 440,
              maxWidth: 'calc(100vw - 40px)',
              background: T.bg,
              color: T.ink,
              border: `1px solid ${T.line}`,
              borderRadius: 10,
              boxShadow: `0 24px 70px color-mix(in oklab, ${T.ink} 26%, transparent)`,
              overflow: 'hidden',
              fontFamily: 'var(--mn-ui)',
            }}>
            <div style={{
              display: 'flex',
              gap: 12,
              padding: '18px 18px 14px',
              borderBottom: `1px solid ${T.lineSub}`,
              background: T.bgSub,
            }}>
              <div style={{
                width: 34,
                height: 34,
                borderRadius: 8,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
                color: T.danger,
                background: `color-mix(in oklab, ${T.danger} 12%, transparent)`,
                border: `1px solid color-mix(in oklab, ${T.danger} 24%, ${T.lineSub})`,
              }}>
                <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.45">
                  <path d="M3 4.5H13M6 4.5V3C6 2.5 6.5 2 7 2H9C9.5 2 10 2.5 10 3V4.5M5 4.5V13C5 13.5 5.5 14 6 14H10C10.5 14 11 13.5 11 13V4.5" strokeLinecap="round"/>
                </svg>
              </div>
              <div style={{ minWidth: 0 }}>
                <div id="mn-delete-vault-title" style={{
                  fontSize: 15,
                  fontWeight: 700,
                  color: T.ink,
                  marginBottom: 4,
                }}>Delete vault?</div>
                <div style={{
                  fontFamily: 'var(--mn-body)',
                  fontSize: 13,
                  lineHeight: 1.45,
                  color: T.inkMed,
                }}>This permanently removes the current vault folder and every note file inside it.</div>
              </div>
            </div>
            <div style={{ padding: '16px 18px 10px' }}>
              <div style={{
                border: `1px solid ${T.lineSub}`,
                borderRadius: 8,
                background: T.bgSub,
                padding: '11px 12px',
              }}>
                <div style={{
                  fontSize: 13.5,
                  fontWeight: 650,
                  color: T.ink,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}>{currentVault.name}</div>
                <div style={{
                  marginTop: 5,
                  fontFamily: 'var(--mn-mono)',
                  fontSize: 10.5,
                  color: T.inkDim,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }} title={currentVault.path || ''}>{currentVault.path || '~/VispNote/vault'}</div>
              </div>
              <label style={{
                display: 'block',
                marginTop: 12,
                fontFamily: 'var(--mn-mono)',
                fontSize: 10.5,
                color: T.inkDim,
                textTransform: 'uppercase',
              }}>Type vault name to confirm</label>
              <input
                autoFocus
                value={confirmText}
                onChange={e => setConfirmText(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && deleteReady && !busy) submitDeleteVault();
                }}
                placeholder={currentVault.name}
                style={mnSettingsInput(T, {
                  width: '100%',
                  marginTop: 6,
                  border: `1px solid ${deleteReady ? T.danger : T.line}`,
                })}
              />
              {error && <div style={{
                marginTop: 8,
                fontFamily: 'var(--mn-ui)',
                fontSize: 12,
                color: T.danger,
              }}>{error}</div>}
            </div>
            <div style={{
              display: 'flex',
              justifyContent: 'flex-end',
              gap: 8,
              padding: '12px 18px 16px',
            }}>
              <BtnOutline
                T={T}
                disabled={busy}
                onClick={() => {
                  setConfirmingDelete(false);
                  setConfirmText('');
                  setError('');
                }}
              >Cancel</BtnOutline>
              <BtnOutline T={T} danger disabled={busy || !deleteReady} onClick={submitDeleteVault}>Delete permanently</BtnOutline>
            </div>
          </div>
        </div>
      )}
      <div style={{
        marginTop: 16, fontFamily: 'var(--mn-mono)', fontSize: 11, color: T.inkDim,
      }}>Vault: {stats.noteCount} notes · approx. {(stats.charCount / 1024).toFixed(1)} KB</div>
    </div>
  );
}

export { SectionData };
