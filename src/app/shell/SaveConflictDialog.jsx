

function ConflictVersion({ T, tone, label, detail }) {
  return (
    <div style={{
      display: 'grid', gridTemplateColumns: 'auto minmax(0,1fr)', gap: 10, alignItems: 'center',
      padding: '10px 12px', borderRadius: DS_RADIUS.row,
      background: T.bgSub, border: `1px solid ${T.lineSub}`,
    }}>
      <span style={{ width: 7, height: 7, borderRadius: '50%', background: dsToneColor(T, tone) }} />
      <div style={{ minWidth: 0 }}>
        <span style={{ fontSize: 12.5, fontWeight: 600, color: T.ink }}>{label}</span>
        <span style={{ fontSize: 12, color: T.inkDim }}> · {detail}</span>
      </div>
    </div>
  );
}

function MnSaveConflictDialog({ conflict, T, onReloadDisk, onKeepCopy, onDismiss }) {
  if (!conflict) return null;
  const when = conflict.currentModifiedAt ? new Date(conflict.currentModifiedAt).toLocaleString() : 'recently';
  return (
    <DsDialogShell
      className="mn-save-conflict-dialog"
      tone="warn"
      titleId="mn-save-conflict-title"
      title="This note changed on disk"
      consequence={`Something else edited “${conflict.title || 'Untitled'}” ${when} while you had unsaved changes. Nothing has been overwritten.`}
      width={460}
      zIndex={93}
      T={T}
      onDismiss={onDismiss}
      icon={(
        <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.45">
          <path d="M8 2L14 13H2L8 2Z" strokeLinejoin="round"/>
          <path d="M8 6V9M8 11.7V11.8" strokeLinecap="round"/>
        </svg>
      )}
      actions={(
        <>
          <button onClick={onDismiss} style={dsButtonStyle(T, 'ghost', { height: DS_HEIGHT.primary })}>Keep editing</button>
          <span style={{ flex: 1 }} />
          <button onClick={onKeepCopy} style={dsButtonStyle(T, 'default', { height: DS_HEIGHT.primary })}>Save mine as a copy</button>
          <button onClick={onReloadDisk} style={dsButtonStyle(T, 'primary', { height: DS_HEIGHT.primary })}>Load disk version</button>
        </>
      )}>
      {/* Only what the app can actually report — no invented word counts. */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <ConflictVersion T={T} tone="accent" label="Your version" detail="unsaved edits, still in the editor" />
        <ConflictVersion T={T} tone="warn" label="Disk version" detail={`written ${when}`} />
      </div>
    </DsDialogShell>
  );
}

export { MnSaveConflictDialog };
import { DS_HEIGHT, DS_RADIUS, dsButtonStyle, dsToneColor } from '../../shared/designSystem.js';
import { DsDialogShell } from '../../shared/components/DesignPrimitives.jsx';
