import { TaskCheckbox } from '../shared/TaskCheckbox.jsx';
// Aggregated todo and reminder panel.

import MN_APP_HELPERS from '../app/appHelpers.js';
import { mnWalk } from '../editor/outline.jsx';
import { MN_REMIND } from '../shared/markdown.jsx';
import { SectionHead } from './panelShared.jsx';
import { mnGetTagColor, mnTagHueMap } from '../shared/theme.jsx';

const { useMemo: useMemoP } = React;

// Module scope so re-renders update cards in place instead of rebuilding
// them — declared inside the panel it was a new component type per render.
function Card({ it, idx, ctx }) {
  const { onOpen, onToggleCheck, T, theme, tagHue, variant } = ctx;
  const isOverdue = it.remindAt && it.remindAt.at < new Date();
  const label = it.label || MN_REMIND.strip(it.text) || String(it.text || '').trim();
  return (
    <div
      onClick={() => onOpen(it.noteId)}
      style={{
        padding: variant === 'compact' ? '8px 12px' : '12px 14px',
        background: T.bg, border: `1px solid ${T.lineSub}`,
        borderLeft: it.remindAt
          ? `3px solid ${isOverdue ? T.danger : T.warn}`
          : `3px solid ${T.lineSub}`,
        borderRadius: 6, cursor: 'pointer',
        display: 'flex', alignItems: 'flex-start', gap: 10,
        transition: 'background 80ms',
      }}
      onMouseEnter={e => e.currentTarget.style.background = T.bgHover}
      onMouseLeave={e => e.currentTarget.style.background = T.bg}>
      {it.isReminderOnly ? (
        <span style={{
          width: 15, height: 15, marginTop: 2, flexShrink: 0,
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          color: isOverdue ? T.danger : T.warn,
        }}>
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
            <circle cx="8" cy="9" r="5.5"/><path d="M8 6V9L10 10" strokeLinecap="round"/>
          </svg>
        </span>
      ) : (
        <TaskCheckbox checked={it.checked} label={`${it.checked ? 'Reopen' : 'Complete'} ${label || it.text || 'todo'}`}
          onToggle={onToggleCheck ? () => onToggleCheck(it) : null} T={T} />
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontFamily: 'var(--mn-body)', fontSize: 14.5,
          color: it.checked ? T.inkDim : T.ink,
          textDecoration: it.checked ? 'line-through' : 'none',
          lineHeight: 1.5,
        }}>
          {label || <span style={{ color: T.inkDim, fontStyle: 'italic' }}>Reminder</span>}
        </div>
        <div style={{
          marginTop: 6, display: 'flex', gap: 8, alignItems: 'center',
          fontFamily: 'var(--mn-mono)', fontSize: 10.5,
          color: T.inkDim, flexWrap: 'wrap',
        }}>
          <span style={{ color: T.inkMed }}>{it.noteTitle}</span>
          {it.noteTags.slice(0, 2).map(t => (
            <span key={t} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color: T.inkDim }}>
              <span aria-hidden="true" style={{
                width: 6, height: 6, borderRadius: '50%',
                background: mnGetTagColor(tagHue.get(t) ?? 240, theme),
              }} />
              {t}
            </span>
          ))}
          {it.remindAt && (
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: 3,
              color: isOverdue ? T.danger : T.warn, fontWeight: 500,
            }}>
              <svg width="9" height="9" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
                <circle cx="8" cy="9" r="5.5"/>
                <path d="M8 6V9L10 10" strokeLinecap="round"/>
              </svg>
              {it.remindAt.date}{it.remindAt.time ? ' ' + it.remindAt.time : ''}
              {isOverdue && ' · overdue'}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function MnTodosPanel({ notes, tags, onOpen, onToggleCheck, T, theme, variant }) {
  const tagHue = useMemoP(() => mnTagHueMap(tags), [tags]);

  const items = useMemoP(() => {
    return MN_APP_HELPERS.collectTaskItems?.(notes, MN_REMIND, mnWalk) || [];
  }, [notes]);

  const open = items.filter(i => !i.checked);
  const done = items.filter(i => i.checked);
  const withRem = open.filter(i => i.remindAt);
  const itemKey = (it, fallback) => it.key || [
    it.noteId,
    it.blockId ?? it.line ?? fallback,
    it.remindAt?.raw || it.remindAt?.date || '',
    it.text || '',
  ].join('|');

  const cardCtx = { onOpen, onToggleCheck, T, theme, tagHue, variant };

  if (variant === 'kanban') {
    const buckets = [
      { k: 'due', label: 'Due / Reminders', items: withRem },
      { k: 'open', label: 'Open', items: open.filter(i => !i.remindAt) },
      { k: 'done', label: 'Done', items: done },
    ];
    return (
      <div style={{
        flex: 1, height: '100%', background: T.bg,
        padding: '40px 28px 28px', overflow: 'auto',
      }}>
        <div style={{
          fontFamily: 'var(--mn-ui)', fontSize: 22, fontWeight: 600,
          color: T.ink, marginBottom: 3, letterSpacing: 0,
        }}>Todos</div>
        <div style={{
          fontFamily: 'var(--mn-mono)', fontSize: 10.5, color: T.inkDim,
          letterSpacing: '0.06em', marginBottom: 20,
        }}>{open.length} open · {done.length} done · {withRem.length} with reminders</div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 14 }}>
          {buckets.map(b => (
            <div key={b.k} style={{
              background: T.bgSub, borderRadius: 8, padding: 10,
              border: `1px solid ${T.lineSub}`, minHeight: 400,
            }}>
              <div style={{
                fontFamily: 'var(--mn-ui)', fontWeight: 600, fontSize: 11,
                color: T.inkDim, margin: '2px 4px 10px',
                display: 'flex', justifyContent: 'space-between',
              }}>
                <span>{b.label}</span>
                <span>{b.items.length}</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {b.items.map((it, i) => <Card key={itemKey(it, i)} it={it} idx={i} ctx={cardCtx} />)}
                {b.items.length === 0 && (
                  <div style={{
                    padding: 14, textAlign: 'center',
                    fontFamily: 'var(--mn-body)', fontSize: 12.5,
                    color: T.inkDim, fontStyle: 'italic',
                  }}>nothing here</div>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // Default: grouped list
  return (
    <div style={{
      flex: 1, height: '100%', background: T.bg,
      padding: '40px 28px 28px', overflow: 'auto',
    }}>
      <div style={{ maxWidth: 760, margin: '0 auto' }}>
        <div style={{
          fontFamily: 'var(--mn-ui)', fontSize: 26, fontWeight: 600,
          color: T.ink, marginBottom: 3, letterSpacing: 0,
        }}>Todos</div>
        <div style={{
          fontFamily: 'var(--mn-mono)', fontSize: 10.5, color: T.inkDim,
          letterSpacing: '0.06em', marginBottom: 24,
        }}>{open.length} open · {done.length} done · {withRem.length} with reminders</div>

        {withRem.length > 0 && (
          <>
            <SectionHead T={T} label="Reminders" count={withRem.length} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 28 }}>
              {withRem.map((it, i) => <Card key={itemKey(it, i)} it={it} idx={i} ctx={cardCtx} />)}
            </div>
          </>
        )}

        <SectionHead T={T} label="Open" count={open.filter(i => !i.remindAt).length} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 28 }}>
          {open.filter(i => !i.remindAt).map((it, i) => <Card key={itemKey(it, `o${i}`)} it={it} idx={'o' + i} ctx={cardCtx} />)}
        </div>

        {done.length > 0 && (
          <>
            <SectionHead T={T} label="Done" count={done.length} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {done.map((it, i) => <Card key={itemKey(it, `d${i}`)} it={it} idx={'d' + i} ctx={cardCtx} />)}
            </div>
          </>
        )}
      </div>
    </div>
  );
}


export { MnTodosPanel };
