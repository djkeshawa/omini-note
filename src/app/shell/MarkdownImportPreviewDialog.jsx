import { useDialogFocus } from '../../shared/useDialogFocus.js';
const { useRef: useRefM } = React;

function MnMarkdownImportPreviewDialog({ state, onApply, onClose, T }) {
  const cancelRef = useRefM(null);
  const busy = state?.phase === 'applying';
  const dialogRef = useDialogFocus({
    active: !!state,
    initialFocusRef: cancelRef,
    onEscape: busy ? null : onClose,
  });
  if (!state) return null;
  const preview = state.preview || {};
  const warnings = Array.isArray(preview.warnings) ? preview.warnings : [];
  return (
    <div
      role="presentation"
      onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose?.(); }}
      style={{
        position: 'fixed', inset: 0, zIndex: 130,
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
        background: `color-mix(in oklab, ${T.ink} 38%, transparent)`,
        backdropFilter: 'blur(3px)',
      }}>
      <section
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="mn-markdown-import-title"
        style={{
          width: 'min(680px, calc(100vw - 48px))',
          maxHeight: 'min(720px, calc(100vh - 48px))',
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
          border: `1px solid ${T.line}`, borderRadius: 12,
          background: T.bgElevated || T.bg,
          boxShadow: `0 28px 80px color-mix(in oklab, ${T.ink} 30%, transparent)`,
          fontFamily: 'var(--mn-ui)', color: T.ink,
        }}>
        <header style={{ padding: '18px 20px 15px', borderBottom: `1px solid ${T.lineSub}`, background: T.bgSub }}>
          <div id="mn-markdown-import-title" style={{ fontSize: 16, fontWeight: 720 }}>Preview Markdown import</div>
          <div style={{ marginTop: 5, fontFamily: 'var(--mn-body)', fontSize: 13, lineHeight: 1.45, color: T.inkMed }}>
            Source files stay untouched. VispNote will add {preview.noteCount || 0} note{preview.noteCount === 1 ? '' : 's'} and copy {preview.attachmentCount || 0} safe attachment{preview.attachmentCount === 1 ? '' : 's'}.
          </div>
        </header>
        <div style={{ padding: 20, overflow: 'auto' }}>
          <div style={{ display: 'grid', gap: 7 }}>
            {(preview.items || []).slice(0, 100).map((item, index) => (
              <div key={`${item.source}-${index}`} style={{
                display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', gap: 12,
                alignItems: 'center', padding: '10px 12px',
                border: `1px solid ${T.lineSub}`, borderRadius: 8, background: T.bgSub,
              }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 650, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.title}</div>
                  <div title={item.source} style={{ marginTop: 3, fontFamily: 'var(--mn-mono)', fontSize: 10.5, color: T.inkDim, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.source}</div>
                </div>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  {item.collision && <span style={{ padding: '3px 6px', borderRadius: 999, background: T.accentSoft, color: T.accent, fontSize: 10.5 }}>Renamed</span>}
                  {item.attachmentCount > 0 && <span style={{ fontFamily: 'var(--mn-mono)', fontSize: 10.5, color: T.inkDim }}>{item.attachmentCount} file{item.attachmentCount === 1 ? '' : 's'}</span>}
                </div>
              </div>
            ))}
            {(preview.items || []).length > 100 && (
              <div style={{ padding: '7px 4px', fontFamily: 'var(--mn-mono)', fontSize: 11, color: T.inkDim }}>
                + {(preview.items || []).length - 100} more notes in this import
              </div>
            )}
          </div>
          {warnings.length > 0 && (
            <div style={{ marginTop: 16, padding: '11px 12px', border: `1px solid ${T.warn}`, borderRadius: 8, background: `color-mix(in oklab, ${T.warn} 8%, ${T.bg})` }}>
              <div style={{ fontSize: 12.5, fontWeight: 700, color: T.warn }}>{warnings.length} warning{warnings.length === 1 ? '' : 's'}</div>
              <div style={{ marginTop: 6, display: 'grid', gap: 4 }}>
                {warnings.slice(0, 8).map((warning, index) => (
                  <div key={index} style={{ fontFamily: 'var(--mn-body)', fontSize: 12, lineHeight: 1.4, color: T.inkMed }}>
                    {warning.source ? `${warning.source}: ` : ''}{warning.message}
                  </div>
                ))}
                {warnings.length > 8 && <div style={{ fontSize: 11, color: T.inkDim }}>+ {warnings.length - 8} more warnings</div>}
              </div>
            </div>
          )}
          {state.error && (
            <div role="alert" style={{ marginTop: 14, padding: '10px 12px', borderRadius: 8, background: `color-mix(in oklab, ${T.danger} 9%, ${T.bg})`, color: T.danger, fontSize: 12.5 }}>
              {state.error}
            </div>
          )}
        </div>
        <footer style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, padding: '13px 20px 17px', borderTop: `1px solid ${T.lineSub}` }}>
          <button ref={cancelRef} type="button" disabled={busy} onClick={onClose} style={dialogButton(T, false, busy)}>Cancel</button>
          <button type="button" disabled={busy || !preview.noteCount} onClick={onApply} style={dialogButton(T, true, busy || !preview.noteCount)}>
            {busy ? 'Importing…' : `Import ${preview.noteCount || 0} note${preview.noteCount === 1 ? '' : 's'}`}
          </button>
        </footer>
      </section>
    </div>
  );
}

function dialogButton(T, primary, disabled) {
  return {
    minHeight: 34, padding: '7px 12px', borderRadius: 7,
    border: `1px solid ${primary ? T.ink : T.line}`,
    background: primary ? T.ink : T.bg,
    color: primary ? T.bg : T.inkMed,
    fontFamily: 'var(--mn-ui)', fontSize: 12.5, fontWeight: 650,
    cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.55 : 1,
  };
}

export { MnMarkdownImportPreviewDialog };
