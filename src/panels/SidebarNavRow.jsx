// Sidebar navigation row — the "selected row" pattern from the design system.
// selBg fill, selLine border, 2.5px accent bar inset left. One per pane.

function SidebarNavRow({
  icon, label, count, hint = '', badge = false, active, onClick, accent, T,
  height = DS_HEIGHT.navRow, fontSize,
}) {
  const activate = event => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    onClick?.();
  };

  const rowStyle = dsSelectedRow(T, active, { height });
  const barInset = Math.max(4, Math.round((height - 20) / 2));

  return (
    <div
      role="button"
      tabIndex={0}
      aria-current={active ? 'page' : undefined}
      aria-label={`${label}${count != null ? `, ${count}` : ''}${hint ? `, ${hint}` : ''}`}
      onClick={onClick}
      onKeyDown={activate}
      style={fontSize ? { ...rowStyle, fontSize } : rowStyle}
      onMouseEnter={event => !active && (event.currentTarget.style.background = T.bgHover)}
      onMouseLeave={event => !active && (event.currentTarget.style.background = 'transparent')}>
      {active && <span style={dsSelectedBarStyle(T, barInset)} />}
      <span style={{
        width: 16, height: 16, flexShrink: 0, display: 'inline-flex',
        alignItems: 'center', justifyContent: 'center',
        color: accent || (active ? T.accent : T.inkDim),
      }}>{icon}</span>
      <span style={{
        flex: 1, minWidth: 0, color: 'inherit',
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>{label}</span>
      {hint && (
        <span aria-hidden="true" style={dsMachineStyle(T, T.inkDim)}>{hint}</span>
      )}
      {count != null && (badge
        ? (
          <span style={{
            minWidth: 18, height: 18, padding: '0 6px', borderRadius: 9,
            background: T.accent, color: T.bg,
            fontFamily: 'var(--mn-mono)', fontSize: 10, fontWeight: 400,
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          }}>{count}</span>
        )
        : (
          <span style={{
            ...dsMachineStyle(T, active ? T.inkMed : T.inkDim), fontWeight: 400,
          }}>{count}</span>
        )
      )}
    </div>
  );
}

export { SidebarNavRow };
import { DS_HEIGHT, dsMachineStyle, dsSelectedBarStyle, dsSelectedRow } from '../shared/designSystem.js';
