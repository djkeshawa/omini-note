import { hasDesktopBridge, platformApi } from '../../platform/index.js';
const HAS_DISK = hasDesktopBridge();

function MnVersionHistoryDialog({ note, vaultId, T, onClose, onRestore }) {
  const [versions, setVersions] = useStateA([]);
  const [busy, setBusy] = useStateA(false);
  const [error, setError] = useStateA('');
  const [preview, setPreview] = useStateA(null);

  const load = useCallbackA(async () => {
    if (!HAS_DISK || !vaultId || !note?.id) return;
    setBusy(true);
    setError('');
    try {
      const res = await platformApi.notes.listNoteVersions(vaultId, note.id);
      if (!res.ok) throw new Error(res.error || 'Could not load versions');
      setVersions(res.value || []);
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setBusy(false);
    }
  }, [vaultId, note?.id]);

  useEffectA(() => { load(); }, [load]);
  useEffectA(() => {
    const onKeyDown = event => { if (event.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const previewVersion = useCallbackA(async (version) => {
    if (!HAS_DISK) return;
    setBusy(true);
    setError('');
    try {
      const res = await platformApi.notes.getNoteVersion(vaultId, note.id, version.versionId);
      if (!res.ok) throw new Error(res.error || 'Could not load this version');
      const currentBody = String(note.body || (window.mnBlocksToMd?.(note.blocks || []) || ''));
      const diff = window.MN_VERSION_DIFF?.lineDiff?.(res.value?.body || '', currentBody) || { rows: [], added: 0, removed: 0 };
      setPreview({ version, value: res.value, diff });
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setBusy(false);
    }
  }, [vaultId, note]);

  if (!note) return null;
  const btn = (danger = false) => ({
    height: 30,
    padding: '0 11px',
    borderRadius: 6,
    cursor: 'pointer',
    fontFamily: 'var(--mn-ui)',
    fontSize: 12,
    fontWeight: 600,
    background: T.bg,
    color: danger ? T.danger : T.inkMed,
    border: `1px solid ${danger ? T.danger : T.line}`,
  });
  return (
    <div className="mn-version-history-dialog" onClick={onClose} style={{
      position: 'absolute', inset: 0, zIndex: 91,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: `color-mix(in oklab, ${T.ink} 28%, transparent)`,
      backdropFilter: 'blur(2px)', animation: 'mnFadeIn 120ms ease',
    }}>
      <div role="dialog" aria-modal="true" aria-label="Version history" onClick={e => e.stopPropagation()} style={{
        width: 820, maxWidth: 'calc(100vw - 40px)', maxHeight: 'calc(100vh - 56px)',
        background: T.bg, color: T.ink, border: `1px solid ${T.line}`,
        borderRadius: 10, overflow: 'hidden', fontFamily: 'var(--mn-ui)',
        boxShadow: `0 24px 70px color-mix(in oklab, ${T.ink} 24%, transparent)`,
      }}>
        <div style={{ padding: '17px 18px 14px', background: T.bgSub, borderBottom: `1px solid ${T.lineSub}` }}>
          <div style={{ fontSize: 15, fontWeight: 750, marginBottom: 4 }}>Version history</div>
          <div style={{ fontFamily: 'var(--mn-body)', fontSize: 13, color: T.inkMed }}>{note.title || 'Untitled'}</div>
        </div>
        <div style={{ padding: 14, maxHeight: 'min(560px, calc(100vh - 190px))', overflow: 'auto' }}>
          {error && <div style={{ color: T.danger, fontSize: 12, marginBottom: 10 }}>{error}</div>}
          {!busy && versions.length === 0 && (
            <div style={{ fontFamily: 'var(--mn-body)', fontSize: 13, color: T.inkDim, padding: 8 }}>No saved versions yet.</div>
          )}
          {versions.map(version => (
            <div key={version.versionId} style={{
              display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', gap: 10,
              alignItems: 'center', padding: '9px 10px', border: `1px solid ${T.lineSub}`,
              borderRadius: 7, background: T.bgSub, marginBottom: 6,
            }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 12.5, fontWeight: 650, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {version.title || 'Untitled'}
                </div>
                <div style={{ marginTop: 3, fontFamily: 'var(--mn-mono)', fontSize: 10, color: T.inkDim }}>
                  {version.createdAt ? new Date(version.createdAt).toLocaleString() : version.versionId}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <button style={btn()} disabled={busy} aria-label={`Compare version from ${version.createdAt || version.versionId}`} onClick={() => previewVersion(version)}>Compare</button>
                <button style={btn()} disabled={busy} onClick={async () => {
                  setBusy(true);
                  const result = await onRestore(note.id, version.versionId);
                  setBusy(false);
                  if (result?.ok !== false) onClose();
                }}>Restore</button>
              </div>
            </div>
          ))}
          {preview && (
            <div style={{ marginTop: 12, border: `1px solid ${T.lineSub}`, borderRadius: 8, overflow: 'hidden' }}>
              <div style={{ padding: '9px 10px', background: T.bgSub, borderBottom: `1px solid ${T.lineSub}`, display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
                <strong style={{ fontSize: 12.5 }}>Changes since this version</strong>
                <span style={{ fontFamily: 'var(--mn-mono)', fontSize: 10.5, color: T.inkDim }}>+{preview.diff.added} / -{preview.diff.removed}</span>
                {preview.diff.truncated && <span style={{ fontSize: 10.5, color: T.inkDim }}>large comparison simplified</span>}
              </div>
              <div aria-label="Version comparison" style={{ maxHeight: 270, overflow: 'auto', background: T.bg, padding: '6px 0' }}>
                {preview.diff.rows.map((row, index) => (
                  <div key={`${index}:${row.type}`} style={{
                    display: 'grid', gridTemplateColumns: '22px minmax(0, 1fr)', gap: 6,
                    padding: '1px 9px', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere',
                    background: row.type === 'add' ? `color-mix(in oklab, ${T.accent} 12%, ${T.bg})`
                      : row.type === 'remove' ? `color-mix(in oklab, ${T.danger} 10%, ${T.bg})` : T.bg,
                    color: row.type === 'same' ? T.inkDim : T.inkMed,
                    fontFamily: 'var(--mn-mono)', fontSize: 10.5, lineHeight: 1.45,
                  }}>
                    <span aria-hidden="true">{row.type === 'add' ? '+' : row.type === 'remove' ? '-' : ' '}</span>
                    <span>{row.text || ' '}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
        <div style={{ padding: '12px 18px 16px', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button onClick={load} disabled={busy} style={btn()}>Refresh</button>
          <button onClick={onClose} style={btn()}>Close</button>
        </div>
      </div>
    </div>
  );
}

export { MnVersionHistoryDialog };
