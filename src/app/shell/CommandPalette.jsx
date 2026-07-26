import MN_PALETTE_MODEL from '../paletteModel.js';
import { getAppActionRegistry } from '../actions/actionRegistryRuntime.js';
import { DS_HEIGHT, DS_RADIUS, dsGroupLabelStyle, dsMachineStyle } from '../../shared/designSystem.js';

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

// Every row carries an icon tile so the eye can sort actions from notes
// without reading. "Create" is dashed — it makes something that isn't there yet.
function paletteIconTile(T, kind, active) {
  const dashed = kind === 'create';
  return {
    width: 26, height: 26, borderRadius: 7, flexShrink: 0,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    background: active ? T.accentSoft : T.bgSub,
    border: `1px ${dashed ? 'dashed' : 'solid'} ${active ? T.selLine : T.lineSub}`,
    color: active ? T.accent : T.inkMed,
  };
}

function paletteIcon(kind) {
  if (kind === 'note') {
    return (
      <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.35" aria-hidden="true">
        <rect x="3" y="2.5" width="10" height="11" rx="1.5" /><path d="M5.5 6h5M5.5 8.5h5M5.5 11h3" strokeLinecap="round" />
      </svg>
    );
  }
  if (kind === 'create') {
    return (
      <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
        <path d="M8 3.5v9M3.5 8h9" strokeLinecap="round" />
      </svg>
    );
  }
  if (kind === 'natural') {
    return (
      <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden="true">
        <path d="M8 2L9.5 6.5L14 8L9.5 9.5L8 14L6.5 9.5L2 8L6.5 6.5L8 2Z" strokeLinejoin="round" />
      </svg>
    );
  }
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.35" aria-hidden="true">
      <path d="M4 6.5L6.5 9L4 11.5M8.5 11.5h3.5" strokeLinecap="round" strokeLinejoin="round" />
      <rect x="2" y="3" width="12" height="10" rx="1.6" />
    </svg>
  );
}

function PaletteKeyHint({ keys, label, T }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11, color: T.inkDim }}>
      <span style={{
        fontFamily: 'var(--mn-mono)', border: `1px solid ${T.lineSub}`,
        background: T.bg, borderRadius: 4, padding: '1px 5px',
      }}>{keys}</span>
      {label}
    </span>
  );
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

  // Rows are grouped under their section label, but keyboard navigation still
  // walks the flat item list, so each entry carries its original index.
  const groups = [];
  items.forEach((item, index) => {
    const section = item.section || '';
    const last = groups[groups.length - 1];
    if (last && last.section === section) last.entries.push({ item, index });
    else groups.push({ section, entries: [{ item, index }] });
  });

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
          background: T.bgElevated || T.bg,
          color: T.ink,
          border: `1px solid ${T.line}`,
          borderRadius: DS_RADIUS.panel,
          boxShadow: `0 24px 70px color-mix(in oklab, ${T.ink} 30%, transparent)`,
          overflow: 'hidden',
        }}>
        <div style={{
          height: DS_HEIGHT.panelHeader, display: 'flex', alignItems: 'center', gap: 10,
          padding: '0 16px', borderBottom: `1px solid ${T.lineSub}`,
        }}>
          <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke={T.inkDim}
            strokeWidth="1.4" aria-hidden="true" style={{ flexShrink: 0 }}>
            <circle cx="7" cy="7" r="4.2" /><path d="M10.2 10.2L13.5 13.5" strokeLinecap="round" />
          </svg>
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
          placeholder={mode === 'notes' ? 'Open or create a note' : 'Search notes and actions'}
          style={{
            flex: 1, minWidth: 0,
            border: 'none',
            outline: 'none',
            background: 'transparent',
            color: T.ink,
            padding: 0,
            fontFamily: 'var(--mn-ui)',
            fontSize: 15,
          }}
          />
          <span style={{
            height: 22, padding: '0 9px', flexShrink: 0,
            display: 'inline-flex', alignItems: 'center',
            borderRadius: DS_RADIUS.pill, background: T.bgSub,
            border: `1px solid ${T.lineSub}`,
            fontSize: 11, color: T.inkMed,
          }}>{mode === 'notes' ? 'Notes' : 'Notes & actions'}</span>
        </div>
        <div id="mn-palette-results" role="listbox" style={{ maxHeight: 420, overflow: 'auto', padding: '8px 8px 6px' }}>
          {groups.map((group, groupIndex) => (
            // A listbox may only contain options and groups, so the section
            // label rides inside a role="group" that names it for assistive
            // tech, and the visible text itself is hidden from the tree.
            <div role="group" aria-label={group.section || undefined} key={`${group.section}-${groupIndex}`}>
              {group.section && (
                <div aria-hidden="true" style={{
                  padding: groupIndex === 0 ? '8px 10px 6px' : '12px 10px 6px',
                  ...dsGroupLabelStyle(T),
                }}>{group.section}</div>
              )}
              {group.entries.map(({ item, index }) => {
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
                  gridTemplateColumns: '28px minmax(0, 1fr) auto',
                  gap: 11,
                  alignItems: 'center',
                  height: 44,
                  borderRadius: 9,
                  border: `1px solid ${index === active ? T.selLine : 'transparent'}`,
                  background: index === active ? T.selBg : 'transparent',
                  color: T.ink,
                  padding: '0 10px',
                  textAlign: 'left',
                  cursor: 'pointer',
                  fontFamily: 'var(--mn-ui)',
                }}>
                <span style={paletteIconTile(T, item.kind, index === active)}>
                  {paletteIcon(item.kind)}
                </span>
                <span style={{ minWidth: 0 }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                    <span style={{ fontSize: 13.5, fontWeight: 650, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {item.title}
                    </span>
                    {note?.pinned && <span style={{ fontSize: 11, color: T.inkDim, flexShrink: 0 }}>Pinned</span>}
                    {(note?.tags || []).slice(0, 2).map(tag => (
                      <span key={tag} style={{
                        height: 20, padding: '0 7px', flexShrink: 0,
                        display: 'inline-flex', alignItems: 'center',
                        borderRadius: DS_RADIUS.pill,
                        background: T.accentSoft, color: T.accent,
                        fontSize: 10.5, whiteSpace: 'nowrap',
                      }}>{tag}</span>
                    ))}
                  </span>
                  {item.action?.description && (
                    <span style={{
                      display: 'block', marginTop: 1, fontSize: 11, color: T.inkDim,
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>{item.action.description}</span>
                  )}
                </span>
                <span style={dsMachineStyle(T)}>
                  {shortcut || (note ? paletteNoteDate(note) : '')}
                </span>
              </button>
            );
              })}
            </div>
          ))}
          {!items.length && (
            <div style={{ padding: 18, color: T.inkDim, fontSize: 13, textAlign: 'center' }}>No notes or actions found</div>
          )}
        </div>
        <div style={{
          height: 38, display: 'flex', alignItems: 'center', gap: 16,
          padding: '0 16px', borderTop: `1px solid ${T.lineSub}`, background: T.bgSub,
        }}>
          <PaletteKeyHint keys="↑↓" label="navigate" T={T} />
          <PaletteKeyHint keys="↵" label="open" T={T} />
          <PaletteKeyHint keys="esc" label="close" T={T} />
          <span style={{ flex: 1 }} />
          <span style={{ fontSize: 11, color: T.inkDim, whiteSpace: 'nowrap' }}>
            Searching {(notes || []).length} notes locally
          </span>
        </div>
      </div>
    </div>
  );
}

export { MnCommandPalette };
