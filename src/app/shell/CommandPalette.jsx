import MN_PALETTE_MODEL from '../paletteModel.js';
import { getAppActionRegistry } from '../actions/actionRegistryRuntime.js';

const { useEffect: useEffectA, useMemo: useMemoA, useRef: useRefA, useState: useStateA } = React;

function paletteNoteDate(note) {
  const time = Date.parse(note?.modifiedAt || note?.diskModifiedAt || note?.date || '');
  if (!Number.isFinite(time)) return '';
  try {
    return new Date(time).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  } catch (error) {
    return '';
  }
}

function MnCommandPalette({
  open,
  mode = 'mixed',
  commands,
  notes,
  recentIds,
  onPickNote,
  onCreateNote,
  onClose,
  onNaturalAction,
  T,
}) {
  const [query, setQuery] = useStateA('');
  const [active, setActive] = useStateA(0);
  const inputRef = useRefA(null);
  const mountedRef = useRefA(false);

  useEffectA(() => {
    if (!open) return;
    mountedRef.current = true;
    setQuery('');
    setActive(0);
    const handle = setTimeout(() => { if (mountedRef.current) inputRef.current?.focus(); }, 0);
    return () => {
      mountedRef.current = false;
      clearTimeout(handle);
    };
  }, [mode, open]);

  const naturalPlan = useMemoA(() => {
    const q = query.trim();
    const registry = getAppActionRegistry();
    if (!q || !registry?.findForText) return null;
    try {
      return registry.findForText(q);
    } catch (error) {
      return null;
    }
  }, [query]);

  const items = useMemoA(() => (
    MN_PALETTE_MODEL.mnPaletteItems
      ? MN_PALETTE_MODEL.mnPaletteItems({ notes, commands, query, recentIds, mode, naturalPlan, limit: 14 })
      : []
  ), [commands, mode, naturalPlan, notes, query, recentIds]);

  useEffectA(() => setActive(0), [mode, query]);
  useEffectA(() => {
    setActive(current => Math.max(0, Math.min(current, items.length - 1)));
  }, [items.length]);

  if (!open) return null;

  const run = (item) => {
    if (!item) return;
    onClose();
    setTimeout(() => {
      if (item.kind === 'note') onPickNote?.(item.note.id);
      else if (item.kind === 'create') onCreateNote?.(item.createTitle);
      else if (item.kind === 'natural') onNaturalAction?.(item.naturalPlan);
      else item.action?.run?.();
    }, 0);
  };
  const availableIds = (commands || [])
    .filter(command => command.enabled !== false)
    .map(command => command.id)
    .join(' ');

  return (
    <div role="presentation" onClick={onClose} style={{
      position: 'fixed', inset: 0, zIndex: 260,
      background: 'color-mix(in oklab, oklch(0.2 0.02 240) 34%, transparent)',
      display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
      padding: '9vh 18px 18px',
    }}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        data-mn-palette-root="true"
        data-mn-palette-mode={mode}
        data-mn-available-command-ids={availableIds}
        onClick={event => event.stopPropagation()}
        style={{
          width: 'min(720px, 100%)',
          background: T.bg,
          color: T.ink,
          border: `1px solid ${T.line}`,
          borderRadius: 10,
          boxShadow: `0 24px 70px color-mix(in oklab, ${T.ink} 30%, transparent)`,
          overflow: 'hidden',
        }}>
        <input
          ref={inputRef}
          role="combobox"
          aria-autocomplete="list"
          aria-controls="mn-palette-results"
          aria-expanded="true"
          aria-activedescendant={items[active] ? `mn-palette-${items[active].id}` : undefined}
          value={query}
          onChange={event => setQuery(event.target.value)}
          onKeyDown={event => {
            if (event.key === 'Escape') { event.preventDefault(); onClose(); }
            if (event.key === 'ArrowDown') { event.preventDefault(); setActive(index => items.length ? Math.min(items.length - 1, index + 1) : 0); }
            if (event.key === 'ArrowUp') { event.preventDefault(); setActive(index => Math.max(0, index - 1)); }
            if (event.key === 'Enter') { event.preventDefault(); run(items[active]); }
          }}
          placeholder={mode === 'notes' ? 'Open or create a note…' : 'Search notes and actions…'}
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
        <div id="mn-palette-results" role="listbox" style={{ maxHeight: 440, overflow: 'auto', padding: 6 }}>
          {items.map((item, index) => {
            const note = item.note;
            const shortcut = item.action?.shortcut || '';
            return (
              <button
                id={`mn-palette-${item.id}`}
                key={item.id}
                type="button"
                role="option"
                aria-selected={index === active}
                data-mn-palette-item-id={item.id}
                data-mn-palette-kind={item.kind}
                data-mn-command-id={item.action?.id || undefined}
                data-mn-frequent-action={item.section === 'Frequent action' ? 'true' : undefined}
                onMouseEnter={() => setActive(index)}
                onClick={() => run(item)}
                style={{
                  width: '100%',
                  display: 'grid',
                  gridTemplateColumns: 'minmax(0, 1fr) auto',
                  gap: 12,
                  alignItems: 'center',
                  minHeight: 44,
                  border: 'none',
                  borderRadius: 7,
                  background: index === active ? T.selBg : 'transparent',
                  color: T.ink,
                  padding: '9px 11px',
                  textAlign: 'left',
                  cursor: 'pointer',
                  fontFamily: 'var(--mn-ui)',
                }}>
                <span style={{ minWidth: 0 }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 7, minWidth: 0 }}>
                    <span style={{ fontSize: 13.5, fontWeight: 650, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {item.title}
                    </span>
                    {note?.pinned && <span style={{ fontSize: 10, color: T.inkDim }}>pinned</span>}
                    {(note?.tags || []).slice(0, 3).map(tag => (
                      <span key={tag} style={{
                        fontFamily: 'var(--mn-mono)', fontSize: 10, color: T.inkMed,
                        background: T.bgSub, border: `1px solid ${T.lineSub}`,
                        borderRadius: 4, padding: '0 5px', whiteSpace: 'nowrap',
                      }}>#{tag}</span>
                    ))}
                  </span>
                  <span style={{ display: 'block', marginTop: 2, fontSize: 11, color: T.inkDim }}>{item.section}</span>
                </span>
                {(shortcut || note) && (
                  <span style={{ fontFamily: 'var(--mn-mono)', fontSize: 10.5, color: T.inkDim }}>
                    {shortcut || paletteNoteDate(note)}
                  </span>
                )}
              </button>
            );
          })}
          {!items.length && (
            <div style={{ padding: 18, color: T.inkDim, fontSize: 13, textAlign: 'center' }}>No notes or actions found</div>
          )}
        </div>
      </div>
    </div>
  );
}

export { MnCommandPalette };
