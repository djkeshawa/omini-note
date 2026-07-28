import { dsMachineStyle } from '../shared/designSystem.js';
import { mnGetTagColor } from '../shared/theme.jsx';
import { mnCalendarTimeText } from './calendarDates.js';

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


// The rail's item card, at module scope like MnDayChip above — inside the
// panel it was a new component type per render, so every background note
// change rebuilt each card's DOM instead of updating it.
function MnItemCard({ item, compact = false, ctx }) {
  const { T, theme, tagHue, notes, helpers, activeKey, setActiveKey, onToggleCheck } = ctx;
  const overdue = item.remindAt?.at && item.remindAt.at < new Date();
  const label = item.label || item.text || 'Reminder';
  const detail = item.actionDetail || helpers.agendaActionDetail?.(item, notes) || {};
  const detailTags = detail.inheritedTags || item.noteTags || [];
  const dateDetails = [
    detail.scheduledDate ? `scheduled ${detail.scheduledDate}${detail.scheduledTime ? ` ${detail.scheduledTime}` : ''}` : '',
    detail.createdDate ? `created ${detail.createdDate}` : detail.titleDate ? `title ${detail.titleDate}` : '',
    detail.modifiedDate ? `modified ${detail.modifiedDate}` : '',
  ].filter(Boolean);
  return (
    <div
      onClick={() => setActiveKey(item.key)}
      style={{
        border: `1px solid ${activeKey === item.key ? T.selLine : T.lineSub}`,
        background: activeKey === item.key ? T.selBg : T.bg,
        borderLeft: `3px solid ${item.isReminderOnly ? T.warn : overdue ? T.danger : T.accent}`,
        borderRadius: 7,
        padding: compact ? '7px 8px' : '9px 10px',
        cursor: 'pointer',
        minWidth: 0,
      }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, minWidth: 0 }}>
        {item.isReminderOnly ? (
          <span style={{
            color: T.warn,
            flexShrink: 0,
            marginTop: 2,
            display: 'inline-flex',
          }}>
            {mnCalendarIcon('bell', T)}
          </span>
        ) : (
          <button
            type="button"
            aria-label={`${item.checked ? 'Reopen' : 'Complete'} ${label}`}
            title={item.checked ? 'Reopen todo' : 'Complete todo'}
            onClick={(event) => {
              event.stopPropagation();
              onToggleCheck?.(item);
            }}
            style={{
              width: 15,
              height: 15,
              marginTop: 2,
              flexShrink: 0,
              border: `1.5px solid ${item.checked ? T.accent : T.line}`,
              background: item.checked ? T.accent : 'transparent',
              borderRadius: 4,
              cursor: 'pointer',
              padding: 0,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}>
            {item.checked && (
              <svg width="9" height="9" viewBox="0 0 10 10" fill="none">
                <path d="M2 5L4 7L8 3" stroke="white" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            )}
          </button>
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontFamily: 'var(--mn-body)',
            fontSize: compact ? 12.5 : 13.5,
            lineHeight: 1.35,
            color: item.checked ? T.inkDim : T.ink,
            textDecoration: item.checked ? 'line-through' : 'none',
            whiteSpace: compact ? 'nowrap' : 'normal',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}>{label}</div>
          {!compact && (
            <div style={{
              marginTop: 5,
              display: 'flex',
              alignItems: 'center',
              gap: 7,
              flexWrap: 'wrap',
              color: T.inkDim,
              fontFamily: 'var(--mn-ui)',
              fontSize: 11,
            }}>
              <span style={{ color: T.inkMed }}>{detail.sourceNoteTitle || item.noteTitle}</span>
              {detail.reason && <span style={{ color: overdue ? T.danger : T.accent }}>{detail.reason}</span>}
              {item.remindAt && <span style={{ color: overdue ? T.danger : T.warn }}>{mnCalendarTimeText(item)}</span>}
              {detailTags.slice(0, 3).map(tag => (
                <span key={tag} style={{ color: mnGetTagColor(tagHue[tag] ?? 240, theme) }}>#{tag}</span>
              ))}
              {dateDetails.slice(0, 2).map(text => <span key={text}>{text}</span>)}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export { mnCalendarIcon, mnAgendaStepBtn, mnCalendarInput, mnCalendarPrimaryButton , MnDayChip , MnItemCard };
