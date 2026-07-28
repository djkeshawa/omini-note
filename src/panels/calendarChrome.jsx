import { dsMachineStyle } from '../shared/designSystem.js';

// The agenda's small presentational pieces: the two item-kind glyphs and the
// control styles shared between the month grid and the create row.

function mnCalendarIcon(kind, T) {
  if (kind === 'bell') {
    return (
      <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
        <path d="M4.5 7C4.5 4.8 5.8 3.2 8 3.2S11.5 4.8 11.5 7V9.5L13 11H3L4.5 9.5V7Z" />
        <path d="M6.8 12.2C7.1 13 7.5 13.3 8 13.3S8.9 13 9.2 12.2" strokeLinecap="round" />
      </svg>
    );
  }
  if (kind === 'calendar') {
    return (
      <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
        <rect x="2.5" y="3.5" width="11" height="10" rx="1.4" />
        <path d="M5 2.5V5M11 2.5V5M2.5 7H13.5" strokeLinecap="round" />
      </svg>
    );
  }
  return (
    <span style={{
      width: 13,
      height: 13,
      borderRadius: 3,
      border: `1.5px solid ${T.line}`,
      display: 'inline-block',
      boxSizing: 'border-box',
    }} />
  );
}

function mnAgendaStepBtn(T) {
  return {
    width: 28, height: 28, borderRadius: 8,
    border: '1px solid transparent', background: 'transparent',
    color: T.inkMed, cursor: 'pointer', padding: 0,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  };
}

function mnCalendarInput(T) {
  return {
    width: '100%',
    minWidth: 0,
    boxSizing: 'border-box',
    border: `1px solid ${T.lineSub}`,
    borderRadius: 7,
    background: T.bgSub,
    color: T.ink,
    padding: '8px 9px',
    outline: 'none',
    fontFamily: 'var(--mn-ui)',
    fontSize: 12.5,
  };
}

function mnCalendarPrimaryButton(T, disabled) {
  return {
    minHeight: 32,
    border: `1px solid ${disabled ? T.lineSub : T.ink}`,
    background: disabled ? T.bgSub : T.ink,
    color: disabled ? T.inkDim : T.bg,
    borderRadius: 7,
    padding: '0 12px',
    fontFamily: 'var(--mn-ui)',
    fontSize: 12.5,
    fontWeight: 700,
    cursor: disabled ? 'default' : 'pointer',
  };
}

// A month-cell entry: flat tinted chip carrying the time and the label. At
// module scope so the grid rows are reconciled, not rebuilt, on re-render.
function MnDayChip({ item, first, onPick, T }) {
  const overdue = item.remindAt?.at && item.remindAt.at < new Date();
  const tone = item.isReminderOnly ? T.warn : overdue ? T.danger : T.accent;
  const stamp = item.remindAt?.time || '';
  return (
    <div
      onClick={(event) => { event.stopPropagation(); onPick?.(item.key); }}
      title={item.label || item.text || 'Reminder'}
      style={{
        marginTop: first ? 5 : 3,
        display: 'flex',
        alignItems: 'center',
        gap: 5,
        height: 19,
        padding: '0 6px',
        borderRadius: 5,
        background: `color-mix(in oklab, ${tone} 12%, ${T.bg})`,
        cursor: 'pointer',
        minWidth: 0,
      }}>
      {stamp && (
        <span style={{ ...dsMachineStyle(T), fontSize: 9.5, color: tone, flexShrink: 0 }}>{stamp}</span>
      )}
      <span style={{
        fontFamily: 'var(--mn-ui)',
        fontSize: 11,
        color: T.ink,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
        minWidth: 0,
      }}>{item.label || item.text || 'Reminder'}</span>
    </div>
  );
}

export { mnCalendarIcon, mnAgendaStepBtn, mnCalendarInput, mnCalendarPrimaryButton , MnDayChip };
