const MN_APP_SHELL_HELPERS = window.MN_APP_HELPERS || {};

function MnCommandPalette({ open, commands, onClose, onNaturalAction, T }) {
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
  }, [open]);
  const naturalPlan = useMemoA(() => {
    const q = query.trim();
    if (!q || !window.MN_APP_ACTIONS?.findForText) return null;
    try { return window.MN_APP_ACTIONS.findForText(q); } catch (e) { return null; }
  }, [query]);
  const items = useMemoA(() => {
    const filtered = MN_APP_SHELL_HELPERS.filterCommands
      ? MN_APP_SHELL_HELPERS.filterCommands(commands, query, 12)
      : (commands || []).filter(cmd => cmd.enabled !== false).slice(0, 12);
    if (!naturalPlan?.steps?.length) return filtered;
    const firstStep = naturalPlan.steps[0];
    const firstActionId = firstStep.actionId;
    const alreadyShown = filtered.some(cmd => cmd.id === firstActionId);
    const naturalItem = {
      id: `natural-${firstActionId}`,
      title: naturalPlan.title || firstStep.label || 'Run app action',
      section: naturalPlan.steps.length > 1 ? `${naturalPlan.steps.length} interpreted actions` : 'Interpreted request',
      __naturalPlan: naturalPlan,
      run: () => onNaturalAction?.(naturalPlan),
    };
    return alreadyShown ? filtered : [naturalItem, ...filtered].slice(0, 12);
  }, [commands, query, naturalPlan, onNaturalAction]);
  useEffectA(() => setActive(0), [query]);
  if (!open) return null;
  const run = (cmd) => {
    if (!cmd) return;
    onClose();
    setTimeout(() => cmd.run?.(), 0);
  };
  return (
    <div role="presentation" onClick={onClose} style={{
      position: 'fixed', inset: 0, zIndex: 260,
      background: 'color-mix(in oklab, oklch(0.2 0.02 240) 34%, transparent)',
      display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
      padding: '9vh 18px 18px',
    }}>
      <div role="dialog" aria-modal="true" aria-label="Command palette" onClick={e => e.stopPropagation()} style={{
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
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Escape') { e.preventDefault(); onClose(); }
            if (e.key === 'ArrowDown') { e.preventDefault(); setActive(i => Math.min(items.length - 1, i + 1)); }
            if (e.key === 'ArrowUp') { e.preventDefault(); setActive(i => Math.max(0, i - 1)); }
            if (e.key === 'Enter') { e.preventDefault(); run(items[active]); }
          }}
          placeholder="Run a command or open a note..."
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
        <div style={{ maxHeight: 440, overflow: 'auto', padding: 6 }}>
          {items.map((cmd, index) => (
            <button
              key={cmd.id}
              onMouseEnter={() => setActive(index)}
              onClick={() => run(cmd)}
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
              <span style={{ minWidth: 0 }}>
                <span style={{ display: 'block', fontSize: 13.5, fontWeight: 650, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{cmd.title}</span>
                <span style={{ display: 'block', marginTop: 2, fontSize: 11, color: T.inkDim }}>{cmd.section || 'Command'}</span>
              </span>
              {cmd.shortcut && <span style={{ fontFamily: 'var(--mn-mono)', fontSize: 10.5, color: T.inkDim }}>{cmd.shortcut}</span>}
            </button>
          ))}
          {!items.length && (
            <div style={{ padding: 18, color: T.inkDim, fontSize: 13, textAlign: 'center' }}>No commands found</div>
          )}
        </div>
      </div>
    </div>
  );
}

export { MnCommandPalette };
