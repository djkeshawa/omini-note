import { platformApi } from '../../platform/index.js';

function MnVaultHealthDialog({ vaultId, onClose, onRebuildIndex, T }) {
  const [health, setHealth] = useStateA(null);
  const [error, setError] = useStateA(null);
  const closeRef = useRefA(null);
  useEffectA(() => {
    let alive = true;
    setHealth(null);
    setError(null);
    if (!HAS_DISK || !vaultId) return;
    platformApi.search.vaultHealth(vaultId).then(res => {
      if (!alive) return;
      if (res.ok) setHealth(res.value);
      else setError(res.error || 'Could not load vault health');
    }).catch(e => alive && setError(e.message || String(e)));
    return () => { alive = false; };
  }, [vaultId]);
  useEffectA(() => {
    closeRef.current?.focus?.();
    const closeOnEscape = event => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      onClose();
    };
    document.addEventListener('keydown', closeOnEscape, true);
    return () => document.removeEventListener('keydown', closeOnEscape, true);
  }, [onClose]);
  const stat = (label, value) => (
    <div style={{ border: `1px solid ${T.lineSub}`, borderRadius: 7, padding: 10, background: T.bgSub }}>
      <div style={{ fontFamily: 'var(--mn-mono)', fontSize: 10, color: T.inkDim, textTransform: 'uppercase' }}>{label}</div>
      <div style={{ marginTop: 4, fontSize: 18, fontWeight: 720, color: T.ink }}>{value}</div>
    </div>
  );
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 250, background: 'color-mix(in oklab, oklch(0.2 0.02 240) 32%, transparent)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <section role="dialog" aria-modal="true" aria-labelledby="mn-vault-health-title" onClick={e => e.stopPropagation()} style={{ width: 'min(760px, 100%)', maxHeight: '86vh', overflow: 'auto', background: T.bg, color: T.ink, border: `1px solid ${T.line}`, borderRadius: 10, boxShadow: `0 24px 70px color-mix(in oklab, ${T.ink} 28%, transparent)` }}>
        <div style={{ padding: 16, borderBottom: `1px solid ${T.lineSub}`, display: 'flex', alignItems: 'center', gap: 12 }}>
          <div id="mn-vault-health-title" style={{ flex: 1, fontSize: 16, fontWeight: 720 }}>Vault Health</div>
          <button onClick={onRebuildIndex} style={mnSmallActionButton(T)}>Rebuild index</button>
          <button ref={closeRef} onClick={onClose} style={mnSmallActionButton(T)}>Close</button>
        </div>
        <div style={{ padding: 16 }}>
          {error && <div style={{ color: T.warn || '#b33', fontSize: 13 }}>{error}</div>}
          {!health && !error && <div style={{ color: T.inkDim, fontSize: 13 }}>Checking vault...</div>}
          {health && (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 10 }}>
                {stat('Notes', health.noteCount)}
                {stat('Tags', health.tagCount)}
                {stat('Canvases', health.canvasCount)}
                {stat('Words', health.wordCount)}
              </div>
              {health.indexStatus && typeof health.indexStatus === 'object' && (
                <div style={{ marginTop: 12, border: `1px solid ${T.lineSub}`, borderRadius: 8, overflow: 'hidden', background: T.bgSub }}>
                  <div style={{ padding: '9px 11px', borderBottom: `1px solid ${T.lineSub}`, fontSize: 12, fontWeight: 700 }}>Index Health</div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 8, padding: 10 }}>
                    {stat('FTS notes', health.indexStatus.ftsIndexedNoteCount ?? '—')}
                    {stat('Embed notes', health.indexStatus.embeddingNoteCount ?? '—')}
                    {stat('Chunks', health.indexStatus.embeddingChunkCount ?? '—')}
                    {stat('Missing', health.indexStatus.missingEmbeddingCount ?? '—')}
                  </div>
                  <div style={{ padding: '0 11px 11px', fontSize: 12, color: T.inkDim, fontFamily: 'var(--mn-body)' }}>
                    {health.indexStatus.failureReason
                      ? `Fallback reason: ${health.indexStatus.failureReason}`
                      : `Model: ${health.indexStatus.model || 'unknown'} · Backfill: ${health.indexStatus.backfill?.running ? `${health.indexStatus.backfill.done || 0}/${health.indexStatus.backfill.total || 0}` : (health.indexStatus.backfill?.lastBackfill ? `last ran ${new Date(health.indexStatus.backfill.lastBackfill).toLocaleString()}` : 'idle')}`}
                  </div>
                </div>
              )}
              <div style={{ marginTop: 16, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                <MnHealthList title="Broken Links" items={health.brokenLinks || []} empty="No broken wiki links" render={item => `${item.noteTitle} -> ${item.target}`} T={T} />
                <MnHealthList title="Orphan Notes" items={health.orphanNotes || []} empty="No orphan notes" render={item => item.title} T={T} />
              </div>
            </>
          )}
        </div>
      </section>
    </div>
  );
}

function MnHealthList({ title, items, empty, render, T }) {
  return (
    <div style={{ border: `1px solid ${T.lineSub}`, borderRadius: 8, overflow: 'hidden' }}>
      <div style={{ padding: '9px 11px', borderBottom: `1px solid ${T.lineSub}`, fontSize: 12, fontWeight: 700 }}>{title}</div>
      <div style={{ maxHeight: 220, overflow: 'auto' }}>
        {items.length ? items.slice(0, 80).map((item, index) => (
          <div key={index} style={{ padding: '8px 11px', borderBottom: `1px solid ${T.lineSub}`, fontSize: 12.5, color: T.inkMed }}>{render(item)}</div>
        )) : <div style={{ padding: 12, fontSize: 12.5, color: T.inkDim }}>{empty}</div>}
      </div>
    </div>
  );
}

function mnSmallActionButton(T) {
  return {
    border: `1px solid ${T.lineSub}`,
    background: T.bg,
    color: T.inkMed,
    borderRadius: 6,
    minHeight: 36,
    padding: '7px 10px',
    cursor: 'pointer',
    fontFamily: 'var(--mn-ui)',
    fontSize: 12,
  };
}

export { MnVaultHealthDialog };
import { hasDesktopBridge } from '../../platform/index.js';
const HAS_DISK = hasDesktopBridge();
const { useEffect: useEffectA, useRef: useRefA, useState: useStateA } = React;
