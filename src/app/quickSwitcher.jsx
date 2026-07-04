// Quick switcher (Ctrl/Cmd+P): fuzzy-jump to a note by title, recents first.

const {
  useState: useStateQS,
  useEffect: useEffectQS,
  useMemo: useMemoQS,
  useRef: useRefQS,
} = React;

const MN_QS_MODEL = window.MN_QUICK_SWITCHER_MODEL || {};

function mnQuickSwitcherDate(note) {
  const stamp = note?.modifiedAt || note?.diskModifiedAt || note?.date || '';
  const time = Date.parse(stamp);
  if (!Number.isFinite(time)) return '';
  try {
    return new Date(time).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  } catch (e) {
    return '';
  }
}

function MnQuickSwitcher({ open, notes, recentIds, onPick, onCreate, onClose, T }) {
  const [query, setQuery] = useStateQS('');
  const [active, setActive] = useStateQS(0);
  const inputRef = useRefQS(null);
  const mountedRef = useRefQS(false);

  useEffectQS(() => {
    if (!open) return;
    mountedRef.current = true;
    setQuery('');
    setActive(0);
    const handle = setTimeout(() => { if (mountedRef.current) inputRef.current?.focus(); }, 0);
    return () => {
      mountedRef.current = false;
      clearTimeout(handle);
    };
  }, [open]);

  const results = useMemoQS(() => {
    if (!MN_QS_MODEL.mnQuickSwitcherResults) return { items: [], createTitle: null };
    return MN_QS_MODEL.mnQuickSwitcherResults({ notes, query, recentIds, limit: 12 });
  }, [notes, query, recentIds]);

  const rows = useMemoQS(() => {
    const noteRows = results.items.map(note => ({ key: `note-${note.id}`, note }));
    if (results.createTitle && typeof onCreate === 'function') {
      noteRows.push({ key: 'create', createTitle: results.createTitle });
    }
    return noteRows;
  }, [results, onCreate]);

  useEffectQS(() => setActive(0), [query]);
  if (!open) return null;

  const run = (row) => {
    if (!row) return;
    onClose();
    setTimeout(() => {
      if (row.note) onPick?.(row.note.id);
      else if (row.createTitle) onCreate?.(row.createTitle);
    }, 0);
  };

  return (
    <div role="presentation" onClick={onClose} style={{
      position: 'fixed', inset: 0, zIndex: 260,
      background: 'color-mix(in oklab, oklch(0.2 0.02 240) 34%, transparent)',
      display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
      padding: '9vh 18px 18px',
    }}>
      <div role="dialog" aria-modal="true" aria-label="Quick switcher" onClick={e => e.stopPropagation()} style={{
        width: 'min(640px, 100%)',
        background: T.bg,
        color: T.ink,
        border: `1px solid ${T.line}`,
        borderRadius: 10,
        boxShadow: `0 24px 70px color-mix(in oklab, ${T.ink} 30%, transparent)`,
        overflow: 'hidden',
      }}>
        <input
          ref={inputRef}
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Escape') { e.preventDefault(); onClose(); }
            if (e.key === 'ArrowDown') { e.preventDefault(); setActive(i => Math.min(rows.length - 1, i + 1)); }
            if (e.key === 'ArrowUp') { e.preventDefault(); setActive(i => Math.max(0, i - 1)); }
            if (e.key === 'Enter') { e.preventDefault(); run(rows[active]); }
          }}
          placeholder="Jump to a note..."
          style={{
            width: '100%',
            border: 'none',
            borderBottom: `1px solid ${T.lineSub}`,
            outline: 'none',
            background: T.bg,
            color: T.ink,
            padding: '15px 16px',
            fontFamily: 'var(--mn-ui)',
            fontSize: 15,
          }}
        />
        <div style={{ maxHeight: 420, overflow: 'auto', padding: 6 }}>
          {rows.map((row, index) => (
            <button
              key={row.key}
              onMouseEnter={() => setActive(index)}
              onClick={() => run(row)}
              style={{
                width: '100%',
                display: 'grid',
                gridTemplateColumns: '1fr auto',
                gap: 12,
                alignItems: 'center',
                border: 'none',
                borderRadius: 7,
                background: index === active ? T.selBg : 'transparent',
                color: T.ink,
                padding: '10px 11px',
                textAlign: 'left',
                cursor: 'pointer',
                fontFamily: 'var(--mn-ui)',
              }}>
              {row.note ? (
                <>
                  <span style={{ minWidth: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 13.5, fontWeight: 650, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {row.note.title || 'Untitled'}
                    </span>
                    {!!row.note.pinned && <span style={{ fontSize: 10, color: T.inkDim }}>pinned</span>}
                    {(row.note.tags || []).slice(0, 3).map(tag => (
                      <span key={tag} style={{
                        fontFamily: 'var(--mn-mono)', fontSize: 10, color: T.inkMed,
                        background: T.bgSub, border: `1px solid ${T.lineSub}`,
                        borderRadius: 4, padding: '0 5px', whiteSpace: 'nowrap',
                      }}>#{tag}</span>
                    ))}
                  </span>
                  <span style={{ fontFamily: 'var(--mn-mono)', fontSize: 10.5, color: T.inkDim }}>
                    {mnQuickSwitcherDate(row.note)}
                  </span>
                </>
              ) : (
                <span style={{ fontSize: 13.5, color: T.inkMed }}>
                  Create note “{row.createTitle}”
                </span>
              )}
            </button>
          ))}
          {!rows.length && (
            <div style={{ padding: 18, color: T.inkDim, fontSize: 13, textAlign: 'center' }}>No matching notes</div>
          )}
        </div>
      </div>
    </div>
  );
}

window.MnQuickSwitcher = MnQuickSwitcher;
