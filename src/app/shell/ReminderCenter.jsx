import MN_APP_SHELL_HELPERS from '../appHelpers.js';
import { DsEmptyState } from '../../shared/components/DesignPrimitives.jsx';

function mnReminderDisplayDate(item) {
  return MN_APP_SHELL_HELPERS.reminderDisplayDate ? MN_APP_SHELL_HELPERS.reminderDisplayDate(item) : '';
}

function mnReminderStatusLabel(status) {
  return MN_APP_SHELL_HELPERS.reminderStatusLabel ? MN_APP_SHELL_HELPERS.reminderStatusLabel(status) : 'Upcoming';
}

function MnReminderCenter({ open, items, dueCount, onToggle, onClose, onOpenNote, topOffset = 14, T }) {
  const visibleItems = items;
  return (
    <div
      className="mn-reminder-center"
      style={{
        position: 'fixed',
        top: topOffset,
        right: 12,
        zIndex: 90,
      }}>
      <button
        onClick={onToggle}
        title="Reminder notifications"
        aria-label="Reminder notifications"
        style={{
          position: 'relative',
          zIndex: 2,
          width: 28,
          height: 28,
          borderRadius: 8,
          border: `1px solid ${open ? T.selLine : 'transparent'}`,
          background: open ? T.accentSoft : 'transparent',
          color: open ? T.accent : T.inkMed,
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          outline: 'none',
          boxShadow: open ? `0 8px 20px color-mix(in oklab, ${T.ink} 8%, transparent)` : 'none',
        }}>
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
          <path d="M4.2 7.2C4.2 4.8 5.6 3.2 8 3.2C10.4 3.2 11.8 4.8 11.8 7.2V9.8L13 11H3L4.2 9.8V7.2Z" strokeLinejoin="round"/>
          <path d="M6.6 12.1C6.9 12.8 7.4 13.2 8 13.2C8.6 13.2 9.1 12.8 9.4 12.1" strokeLinecap="round"/>
          <path d="M8 1.8V3.1" strokeLinecap="round"/>
        </svg>
        {dueCount > 0 && (
          <span style={{
            position: 'absolute',
            top: -5,
            right: -6,
            minWidth: 16,
            height: 16,
            padding: '0 4px',
            borderRadius: 999,
            background: T.warn,
            color: T.bg,
            border: `1px solid ${T.bg}`,
            fontFamily: 'var(--mn-mono)',
            fontSize: 9,
            fontWeight: 600,
            lineHeight: '15px',
            textAlign: 'center',
          }}>{dueCount > 9 ? '9+' : dueCount}</span>
        )}
      </button>
      {open && (
        <>
          <button
            aria-label="Close reminder notifications"
            onClick={onClose}
            style={{
              position: 'fixed',
              inset: 0,
              zIndex: 1,
              border: 'none',
              background: 'transparent',
              cursor: 'default',
            }}
          />
          <div
            role="dialog"
            aria-label="Reminder notifications"
            style={{
              position: 'absolute',
              zIndex: 3,
              top: 36,
              right: 0,
              width: 340,
              maxWidth: 'calc(100vw - 36px)',
              maxHeight: 'min(520px, calc(100vh - 72px))',
              overflow: 'hidden',
              display: 'flex',
              flexDirection: 'column',
              background: T.bg,
              border: `1px solid ${T.line}`,
              borderRadius: 8,
              boxShadow: `0 18px 50px color-mix(in oklab, ${T.ink} 18%, transparent)`,
            }}>
            <div style={{
              padding: '12px 13px',
              borderBottom: `1px solid ${T.lineSub}`,
              display: 'flex',
              alignItems: 'center',
              gap: 8,
            }}>
              <div style={{
                fontFamily: 'var(--mn-ui)',
                fontSize: 13,
                fontWeight: 600,
                color: T.ink,
              }}>Reminders</div>
              <div style={{ flex: 1 }} />
              <div style={{
                fontFamily: 'var(--mn-mono)',
                fontSize: 10,
                color: dueCount ? T.warn : T.inkDim,
              }}>{dueCount} due</div>
            </div>
            <div style={{ overflow: 'auto', padding: 6 }}>
              {visibleItems.length === 0 ? (
                <DsEmptyState
                  T={T}
                  compact
                  icon={(
                    <svg width="17" height="17" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden="true">
                      <path d="M4 11V7C4 5 5.5 3.5 8 3.5C10.5 3.5 12 5 12 7V11L13 12.5H3L4 11Z" strokeLinejoin="round" /><path d="M7 14H9" strokeLinecap="round" />
                    </svg>
                  )}
                  headline="No reminders in this vault"
                  body="Add @remind followed by a date to any block and it will show up here."
                />
              ) : visibleItems.map(item => (
                <button
                  key={item.key}
                  onClick={() => onOpenNote(item)}
                  style={{
                    width: '100%',
                    display: 'block',
                    textAlign: 'left',
                    border: 'none',
                    background: item.status === 'due'
                      ? `color-mix(in oklab, ${T.warn} 9%, transparent)`
                      : 'transparent',
                    borderRadius: 6,
                    cursor: 'pointer',
                    padding: '8px 9px',
                    color: T.ink,
                    fontFamily: 'var(--mn-ui)',
                  }}
                  onMouseEnter={e => e.currentTarget.style.background = item.status === 'due'
                    ? `color-mix(in oklab, ${T.warn} 14%, transparent)`
                    : T.bgHover}
                  onMouseLeave={e => e.currentTarget.style.background = item.status === 'due'
                    ? `color-mix(in oklab, ${T.warn} 9%, transparent)`
                    : 'transparent'}>
                  <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    marginBottom: 3,
                  }}>
                    <span style={{
                      fontFamily: 'var(--mn-ui)', fontWeight: 600,
                      fontSize: 11,
                      color: item.status === 'due' ? T.warn : T.inkDim,
                    }}>{mnReminderStatusLabel(item.status)}</span>
                    <span style={{
                      fontFamily: 'var(--mn-mono)',
                      fontSize: 10,
                      color: T.inkDim,
                    }}>{mnReminderDisplayDate(item)}</span>
                  </div>
                  <div style={{
                    fontSize: 12.5,
                    lineHeight: 1.35,
                    color: T.ink,
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}>{item.text || 'Reminder'}</div>
                  <div style={{
                    marginTop: 2,
                    fontFamily: 'var(--mn-mono)',
                    fontSize: 10,
                    color: T.inkDim,
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}>from {item.noteTitle}</div>
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export { MnReminderCenter };
