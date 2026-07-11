const { useState: useStateP, useMemo: useMemoP, useEffect: useEffectP, useRef: useRefP } = React;

function MnQuickCapture({ onSave, onClose, tags, destinations = [], templates = [], T, theme }) {
  const [title, setTitle] = useStateP('');
  const [body, setBody] = useStateP('');
  const [selected, setSelected] = useStateP([]);
  const [destinationId, setDestinationId] = useStateP('today');
  const [templateId, setTemplateId] = useStateP('raw');
  const [moreOpen, setMoreOpen] = useStateP(false);
  const titleRef = useRefP(null);
  const destinationChoices = destinations.length
    ? destinations
    : [{ id: 'new', label: 'New note', noteTitle: 'New note', disabled: false }];
  const templateChoices = [
    { id: 'raw', title: 'No template' },
    ...templates,
  ];
  const activeDestination = destinationChoices.find(item => item.id === destinationId && !item.disabled)
    || destinationChoices.find(item => !item.disabled)
    || destinationChoices[0];
  const activeTemplate = templateChoices.find(item => item.id === templateId) || templateChoices[0];

  useEffectP(() => {
    const focusHandle = setTimeout(() => titleRef.current?.focus(), 60);
    const esc = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', esc);
    return () => {
      clearTimeout(focusHandle);
      window.removeEventListener('keydown', esc);
    };
  }, []);

  const submit = () => {
    if (!title.trim() && !body.trim()) return onClose();
    onSave({
      title: title.trim() || 'Untitled',
      body,
      tags: selected,
      destinationId: activeDestination?.id || 'new',
      templateId: activeTemplate?.id === 'raw' ? '' : activeTemplate?.id,
    });
  };

  return (
    <div onClick={onClose} style={{
      position: 'absolute', inset: 0, zIndex: 40,
      background: `color-mix(in oklab, ${T.ink} 22%, transparent)`,
      display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
      paddingTop: 100, animation: 'mnFadeIn 120ms ease',
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        width: 540, background: T.bg, borderRadius: 12,
        border: `1px solid ${T.line}`,
        boxShadow: `0 24px 60px color-mix(in oklab, ${T.ink} 25%, transparent)`,
        overflow: 'hidden',
      }}>
        <div style={{
          padding: '10px 14px', borderBottom: `1px solid ${T.lineSub}`,
          fontFamily: 'var(--mn-mono)', fontSize: 10.5,
          color: T.inkDim, letterSpacing: '0.08em', textTransform: 'uppercase',
          display: 'flex', alignItems: 'center', gap: 8,
        }}>
          <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
            <path d="M2.5 6L8 2L13.5 6V13C13.5 13.5 13 14 12.5 14H3.5C3 14 2.5 13.5 2.5 13V6Z"/>
          </svg>
          Quick capture
          <div style={{ flex: 1 }} />
          <span style={{
            fontFamily: 'var(--mn-mono)', fontSize: 10,
            padding: '2px 5px', borderRadius: 3,
            background: T.bgSub, border: `1px solid ${T.lineSub}`,
          }}>⌘⇧N</span>
        </div>
        <div style={{ padding: 16 }}>
          <div style={{
            display: moreOpen ? 'grid' : 'none',
            gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)',
            gap: 8,
            marginBottom: 12,
          }}>
            <select
              value={activeDestination?.id || 'new'}
              onChange={e => setDestinationId(e.target.value)}
              aria-label="Capture destination"
              style={{
                minWidth: 0,
                padding: '6px 8px',
                borderRadius: 6,
                border: `1px solid ${T.line}`,
                background: T.bg,
                color: T.ink,
                fontFamily: 'var(--mn-ui)',
                fontSize: 12,
              }}>
              {destinationChoices.map(item => (
                <option key={item.id} value={item.id} disabled={item.disabled}>
                  {item.label || item.noteTitle || item.id}
                </option>
              ))}
            </select>
            <select
              value={activeTemplate?.id || 'raw'}
              onChange={e => setTemplateId(e.target.value)}
              aria-label="Capture template"
              style={{
                minWidth: 0,
                padding: '6px 8px',
                borderRadius: 6,
                border: `1px solid ${T.line}`,
                background: T.bg,
                color: T.ink,
                fontFamily: 'var(--mn-ui)',
                fontSize: 12,
              }}>
              {templateChoices.map(item => (
                <option key={item.id} value={item.id}>
                  {item.title || item.id}
                </option>
              ))}
            </select>
          </div>
          <input ref={titleRef} value={title} onChange={(e) => setTitle(e.target.value)}
            placeholder="Title"
            style={{
              width: '100%', border: 'none', outline: 'none', background: 'transparent',
              fontFamily: 'var(--mn-body)', fontSize: 20, fontWeight: 600,
              color: T.ink, letterSpacing: 0, marginBottom: 10,
            }}/>
          <textarea value={body} onChange={(e) => setBody(e.target.value)}
            placeholder="Write a note… use [[double brackets]] to link, - [ ] for todos, @remind YYYY-MM-DD to schedule"
            style={{
              width: '100%', minHeight: 120,
              fontFamily: 'var(--mn-body)', fontSize: 14.5, lineHeight: 1.6,
              color: T.ink, background: 'transparent', border: 'none', outline: 'none',
              resize: 'none', padding: 0,
            }} />

          <button type="button" onClick={() => setMoreOpen(value => !value)} style={{
            marginTop: 8, padding: 0, border: 'none', background: 'transparent',
            color: T.inkDim, fontFamily: 'var(--mn-ui)', fontSize: 12, cursor: 'pointer',
          }}>{moreOpen ? 'Hide options' : 'More options'}</button>

          <div style={{ display: moreOpen ? 'flex' : 'none', gap: 5, flexWrap: 'wrap', marginTop: 12 }}>
            {tags.map(t => {
              const on = selected.includes(t.name);
              return (
                <button key={t.name}
                  onClick={() => setSelected(s => on ? s.filter(x => x !== t.name) : [...s, t.name])}
                  style={{
                    fontFamily: 'var(--mn-mono)', fontSize: 10.5,
                    padding: '3px 8px', borderRadius: 4, cursor: 'pointer',
                    color: on ? mnGetTagColor(t.hue, theme) : T.inkDim,
                    background: on ? mnGetTagBg(t.hue, theme) : 'transparent',
                    border: `1px solid ${on ? 'transparent' : T.line}`,
                  }}>#{t.name}</button>
              );
            })}
          </div>
        </div>
        <div style={{
          padding: '10px 14px', borderTop: `1px solid ${T.lineSub}`,
          background: T.bgSub, display: 'flex', alignItems: 'center', gap: 8,
        }}>
          <div style={{
            fontFamily: 'var(--mn-mono)', fontSize: 10, color: T.inkDim,
          }}>{activeDestination?.label || 'New note'} · {activeTemplate?.title || 'No template'}</div>
          <div style={{ flex: 1 }} />
          <button onClick={onClose} style={{
            padding: '4px 12px', borderRadius: 5,
            border: `1px solid ${T.line}`, background: T.bg, color: T.inkMed,
            fontFamily: 'var(--mn-ui)', fontSize: 12, cursor: 'pointer',
          }}>Cancel</button>
          <button onClick={submit} style={{
            padding: '4px 14px', borderRadius: 5, border: 'none',
            background: T.ink, color: T.bg,
            fontFamily: 'var(--mn-ui)', fontSize: 12, fontWeight: 500, cursor: 'pointer',
          }}>Save{activeDestination?.id === 'today' ? ' to Today' : ''}</button>
        </div>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────
// Reminder toast
// ────────────────────────────────────────────────────────────

export { MnQuickCapture };
