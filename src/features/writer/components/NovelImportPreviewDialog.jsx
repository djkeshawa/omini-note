function NovelImportPreviewDialog({ dialog, T, onApply, onClose }) {
  if (!dialog) return null;
  const plan = dialog.plan || {};
  const loading = dialog.phase === 'analyzing';
  const errored = dialog.phase === 'error';
  const created = plan.created || [];
  const updated = plan.updated || [];
  const skipped = [...(dialog.skipped || []), ...(plan.skipped || [])];
  const renderItems = (label, items) => (
    <section style={{ border: `1px solid ${T.lineSub}`, borderRadius: 8, padding: 10, background: T.bgSub }}>
      <div style={{ fontFamily: 'var(--mn-ui)', fontSize: 13, fontWeight: 700, color: T.ink, marginBottom: 8 }}>{label}</div>
      <div style={{ display: 'grid', gap: 6 }}>
        {items.length ? items.slice(0, 18).map(item => (
          <div key={`${label}:${item.id || item.title}:${item.reason || ''}`} style={{ display: 'flex', gap: 8, alignItems: 'baseline', fontFamily: 'var(--mn-ui)', fontSize: 12, color: T.inkMed }}>
            <span style={{ fontFamily: 'var(--mn-mono)', fontSize: 10, color: T.inkDim }}>{item.kind || 'file'}</span>
            <span style={{ color: T.ink }}>{item.title || item.name}</span>
            {item.reason && <span style={{ color: T.inkDim }}>{item.reason}</span>}
          </div>
        )) : <div style={{ fontFamily: 'var(--mn-ui)', fontSize: 12, color: T.inkDim }}>None</div>}
        {items.length > 18 && <div style={{ fontFamily: 'var(--mn-mono)', fontSize: 10, color: T.inkDim }}>+{items.length - 18} more</div>}
      </div>
    </section>
  );
  return (
    <div onClick={onClose} style={{ position: 'absolute', inset: 0, zIndex: 72, background: T.overlay || `color-mix(in oklab, ${T.ink} 34%, transparent)`, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div onClick={event => event.stopPropagation()} style={{ width: 'min(760px, calc(100vw - 48px))', maxHeight: 'min(680px, calc(100vh - 48px))', overflow: 'auto', borderRadius: 10, border: `1px solid ${T.line}`, background: T.bg, boxShadow: `0 24px 60px color-mix(in oklab, ${T.ink} 28%, transparent)`, padding: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontFamily: 'var(--mn-ui)', fontSize: 17, fontWeight: 760, color: T.ink }}>Novel import preview</div>
            <div style={{ fontFamily: 'var(--mn-ui)', fontSize: 12, color: T.inkDim, marginTop: 3 }}>
              {loading ? (dialog.progress || 'Analyzing imported files...') : errored ? 'No notes were changed.' : `${created.length} create, ${updated.length} merge`}
            </div>
          </div>
          <button onClick={onClose} style={{ width: 28, height: 28, borderRadius: 6, border: `1px solid ${T.lineSub}`, background: T.bgSub, color: T.inkDim, cursor: 'pointer' }} title="Close" aria-label="Close">×</button>
        </div>
        {loading && <div style={{ border: `1px solid ${T.lineSub}`, borderRadius: 8, padding: 14, background: T.bgSub, fontFamily: 'var(--mn-ui)', fontSize: 13, color: T.inkMed }}>{dialog.progress || 'Reading source material and asking AI to classify story and supporting details.'}</div>}
        {errored && <div style={{ border: `1px solid ${T.lineSub}`, borderRadius: 8, padding: 14, background: T.bgSub, fontFamily: 'var(--mn-ui)', fontSize: 13, color: T.inkMed }}>{dialog.error || 'AI could not analyze the imported files.'}</div>}
        {!loading && !errored && <div style={{ display: 'grid', gap: 10 }}>{renderItems('Create', created)}{renderItems('Merge into existing notes', updated)}{renderItems('Skipped', skipped)}</div>}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 14 }}>
          <button onClick={onClose} style={{ border: `1px solid ${T.lineSub}`, background: T.bgSub, color: T.inkMed, borderRadius: 7, padding: '7px 11px', fontFamily: 'var(--mn-ui)', fontSize: 12, cursor: 'pointer' }}>{loading ? 'Hide' : 'Cancel'}</button>
          {!loading && !errored && <button onClick={onApply} disabled={!plan.changedIds?.length} style={{ border: `1px solid ${T.ink}`, background: T.ink, color: T.bg, borderRadius: 7, padding: '7px 11px', fontFamily: 'var(--mn-ui)', fontSize: 12, cursor: plan.changedIds?.length ? 'pointer' : 'not-allowed', opacity: plan.changedIds?.length ? 1 : 0.55 }}>Apply</button>}
        </div>
      </div>
    </div>
  );
}

export { NovelImportPreviewDialog };
