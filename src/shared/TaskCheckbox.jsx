function TaskCheckbox({ checked = false, onToggle, label, T, size = 16, style }) {
  const action = checked ? 'Reopen task' : 'Complete task';
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={!!checked}
      aria-label={label || action}
      title={label || action}
      disabled={!onToggle}
      className="mn-task-checkbox"
      onMouseDown={event => event.stopPropagation()}
      onClick={event => { event.stopPropagation(); onToggle?.(); }}
      style={{
        width: 24, height: 24, padding: 0, flexShrink: 0,
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        border: 0, borderRadius: 5, background: 'transparent',
        cursor: onToggle ? 'pointer' : 'default', verticalAlign: 'middle',
        ...style,
      }}>
      <span aria-hidden="true" style={{
        width: size, height: size, boxSizing: 'border-box', flexShrink: 0,
        border: `1.5px solid ${checked ? T.accent : T.inkDim}`,
        background: checked ? T.accent : 'transparent', borderRadius: 4,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        {checked && (
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
            <path d="M2 5L4 7L8 3" stroke={T.bg} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </span>
    </button>
  );
}

export { TaskCheckbox };
