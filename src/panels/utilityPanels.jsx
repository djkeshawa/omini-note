// Today, quick-capture, reminder toast, and panel grip components.

const { useState: useStateP, useMemo: useMemoP, useEffect: useEffectP, useRef: useRefP } = React;

function MnTodayPanel({ notes, tags, onOpen, T, theme, rollupFormat = 'long' }) {
  const tagHue = useMemoP(() => {
    const m = {}; tags.forEach(t => m[t.name] = t.hue); return m;
  }, [tags]);
  // Group notes by day
  const groups = useMemoP(() => {
    const g = {};
    [...notes].sort((a, b) => new Date(b.date) - new Date(a.date)).forEach(n => {
      const d = new Date(n.date);
      const key = d.toDateString();
      if (!g[key]) g[key] = { date: d, notes: [] };
      g[key].notes.push(n);
    });
    return Object.values(g);
  }, [notes]);

  return (
    <div style={{
      flex: 1, height: '100%', background: T.bg,
      padding: '40px 28px 28px', overflow: 'auto',
    }}>
      <div style={{ maxWidth: 760, margin: '0 auto' }}>
        <div style={{
          fontFamily: 'var(--mn-ui)', fontSize: 26, fontWeight: 600,
          color: T.ink, marginBottom: 3, letterSpacing: 0,
        }}>Daily rollup</div>
        <div style={{
          fontFamily: 'var(--mn-mono)', fontSize: 10.5, color: T.inkDim,
          letterSpacing: '0.06em', marginBottom: 28,
        }}>notes grouped by the day they were written</div>

        {groups.map(g => (
          <div key={g.date.toISOString().slice(0, 10)} style={{ marginBottom: 28 }}>
            <div style={{
              display: 'flex', alignItems: 'baseline', gap: 12,
              marginBottom: 10,
            }}>
              <div style={{
                fontFamily: 'var(--mn-body)', fontSize: 16, fontWeight: 600,
                color: T.ink, letterSpacing: 0,
              }}>{g.date.toLocaleDateString([], rollupFormat === 'short'
                ? { weekday: 'short', month: 'short', day: 'numeric' }
                : { weekday: 'long', month: 'long', day: 'numeric' })}</div>
              <div style={{
                fontFamily: 'var(--mn-mono)', fontSize: 10.5, color: T.inkDim,
              }}>{g.notes.length} note{g.notes.length > 1 ? 's' : ''}</div>
              <div style={{ flex: 1, borderTop: `1px solid ${T.lineSub}` }} />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {g.notes.map(n => (
                <div key={n.id} onClick={() => onOpen(n.id)} style={{
                  padding: '8px 12px', borderRadius: 6, cursor: 'pointer',
                  display: 'flex', alignItems: 'baseline', gap: 10,
                }}
                onMouseEnter={e => e.currentTarget.style.background = T.bgHover}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                  <div style={{
                    fontFamily: 'var(--mn-mono)', fontSize: 10.5, color: T.inkDim,
                    width: 46, flexShrink: 0,
                  }}>{new Date(n.date).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</div>
                  <div style={{
                    fontFamily: 'var(--mn-ui)', fontSize: 14, color: T.ink, flex: 1,
                  }}>{n.title}</div>
                  <div style={{ display: 'flex', gap: 4 }}>
                    {n.tags.map(t => (
                      <span key={t} style={{
                        width: 6, height: 6, borderRadius: '50%',
                        background: mnGetTagColor(tagHue[t] ?? 240, theme),
                        display: 'inline-block',
                      }} />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function MnRecentlyDeletedPanel({
  items = [], loading = false, error = '', onRefresh, onRestore, onPurge, T,
}) {
  const [confirmTrashId, setConfirmTrashId] = useStateP('');
  const [busyTrashId, setBusyTrashId] = useStateP('');
  const total = items.length;
  const noteCount = items.filter(item => item.sourceType !== 'canvas').length;
  const canvasCount = items.filter(item => item.sourceType === 'canvas').length;

  const runRestore = async (item) => {
    setBusyTrashId(item.trashId);
    setConfirmTrashId('');
    try {
      const result = await onRestore?.(item);
      if (result?.ok !== false) await onRefresh?.();
    } finally {
      setBusyTrashId('');
    }
  };

  const runPurge = async (item) => {
    if (confirmTrashId !== item.trashId) {
      setConfirmTrashId(item.trashId);
      return;
    }
    setBusyTrashId(item.trashId);
    try {
      const result = await onPurge?.(item);
      if (result?.ok !== false) await onRefresh?.();
    } finally {
      setBusyTrashId('');
      setConfirmTrashId('');
    }
  };

  const stat = (label, value) => (
    <div style={{
      border: `1px solid ${T.lineSub}`,
      borderRadius: 8,
      background: T.bgSub,
      padding: '10px 12px',
      minWidth: 0,
    }}>
      <div style={{ fontFamily: 'var(--mn-mono)', fontSize: 10, color: T.inkDim, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{label}</div>
      <div style={{ marginTop: 4, fontSize: 20, fontWeight: 720, color: T.ink }}>{value}</div>
    </div>
  );

  return (
    <div style={{
      flex: 1,
      height: '100%',
      background: T.bg,
      overflow: 'auto',
      padding: '34px 28px 28px',
    }}>
      <div style={{ maxWidth: 860, margin: '0 auto' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16, marginBottom: 22 }}>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{
              fontFamily: 'var(--mn-ui)',
              fontSize: 25,
              fontWeight: 680,
              color: T.ink,
              letterSpacing: 0,
            }}>Recently deleted</div>
            <div style={{
              marginTop: 5,
              fontFamily: 'var(--mn-body)',
              fontSize: 13,
              lineHeight: 1.45,
              color: T.inkDim,
              maxWidth: 620,
            }}>Deleted notes and canvases stay here before cleanup. Restore anything you still need, or permanently delete items you are sure are no longer useful.</div>
          </div>
          <button
            onClick={onRefresh}
            disabled={loading || !onRefresh}
            style={{
              border: `1px solid ${T.line}`,
              borderRadius: 7,
              background: T.bg,
              color: loading ? T.inkDim : T.inkMed,
              cursor: loading || !onRefresh ? 'default' : 'pointer',
              padding: '7px 11px',
              fontFamily: 'var(--mn-ui)',
              fontSize: 12.5,
              fontWeight: 620,
              flexShrink: 0,
            }}>{loading ? 'Refreshing...' : 'Refresh'}</button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 10, marginBottom: 18 }}>
          {stat('Pending cleanup', total)}
          {stat('Notes', noteCount)}
          {stat('Canvases', canvasCount)}
        </div>

        {error && (
          <div style={{
            marginBottom: 12,
            border: `1px solid color-mix(in oklab, ${T.danger || T.warn} 32%, ${T.lineSub})`,
            borderRadius: 8,
            background: `color-mix(in oklab, ${T.danger || T.warn} 8%, ${T.bgSub})`,
            color: T.danger || T.warn,
            padding: '10px 12px',
            fontSize: 12.5,
          }}>{error}</div>
        )}

        {!loading && total === 0 && !error && (
          <div style={{
            border: `1px dashed ${T.line}`,
            borderRadius: 10,
            background: T.bgSub,
            padding: '34px 18px',
            textAlign: 'center',
          }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: T.ink }}>No deleted items</div>
            <div style={{ marginTop: 6, fontSize: 13, color: T.inkDim }}>Notes and canvases you delete will appear here until cleanup.</div>
          </div>
        )}

        {total > 0 && (
          <div style={{ display: 'grid', gap: 8 }}>
            {items.map(item => {
              const confirming = confirmTrashId === item.trashId;
              const busy = busyTrashId === item.trashId;
              const typeLabel = item.sourceType === 'canvas' ? 'Canvas' : 'Note';
              return (
                <div key={item.trashId} style={{
                  display: 'grid',
                  gridTemplateColumns: 'minmax(0, 1fr) auto',
                  gap: 12,
                  alignItems: 'center',
                  padding: '12px 13px',
                  border: `1px solid ${confirming ? `color-mix(in oklab, ${T.danger || T.warn} 42%, ${T.lineSub})` : T.lineSub}`,
                  borderRadius: 8,
                  background: confirming ? `color-mix(in oklab, ${T.danger || T.warn} 6%, ${T.bgSub})` : T.bgSub,
                }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                      <span style={{
                        fontFamily: 'var(--mn-mono)',
                        fontSize: 10,
                        color: item.sourceType === 'canvas' ? T.accent : T.inkDim,
                        border: `1px solid ${T.lineSub}`,
                        borderRadius: 999,
                        background: T.bg,
                        padding: '2px 6px',
                        flexShrink: 0,
                      }}>{typeLabel}</span>
                      <div style={{
                        minWidth: 0,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        fontSize: 14,
                        fontWeight: 680,
                        color: T.ink,
                      }}>{item.title || 'Untitled'}</div>
                    </div>
                    <div style={{
                      marginTop: 5,
                      fontFamily: 'var(--mn-mono)',
                      fontSize: 10.5,
                      color: T.inkDim,
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}>
                      Deleted {item.deletedAt ? new Date(item.deletedAt).toLocaleString() : 'recently'}
                      {item.originalId ? ` · ${item.originalId}` : ''}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                    {confirming && (
                      <button
                        onClick={() => setConfirmTrashId('')}
                        disabled={busy}
                        style={{
                          border: `1px solid ${T.lineSub}`,
                          borderRadius: 6,
                          background: T.bg,
                          color: T.inkMed,
                          cursor: busy ? 'default' : 'pointer',
                          padding: '7px 10px',
                          fontFamily: 'var(--mn-ui)',
                          fontSize: 12,
                        }}>Cancel</button>
                    )}
                    <button
                      onClick={() => runRestore(item)}
                      disabled={busy || !onRestore}
                      style={{
                        border: `1px solid ${T.line}`,
                        borderRadius: 6,
                        background: T.bg,
                        color: T.inkMed,
                        cursor: busy || !onRestore ? 'default' : 'pointer',
                        padding: '7px 10px',
                        fontFamily: 'var(--mn-ui)',
                        fontSize: 12,
                        fontWeight: 620,
                      }}>{busy ? 'Working...' : 'Restore'}</button>
                    <button
                      onClick={() => runPurge(item)}
                      disabled={busy || !onPurge}
                      style={{
                        border: `1px solid ${confirming ? (T.danger || T.warn) : T.lineSub}`,
                        borderRadius: 6,
                        background: confirming ? (T.danger || T.warn) : T.bg,
                        color: confirming ? T.bg : (T.danger || T.warn),
                        cursor: busy || !onPurge ? 'default' : 'pointer',
                        padding: '7px 10px',
                        fontFamily: 'var(--mn-ui)',
                        fontSize: 12,
                        fontWeight: 650,
                      }}>{confirming ? 'Confirm delete' : 'Delete permanently'}</button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────
// Quick-capture popover (floating)
// ────────────────────────────────────────────────────────────
function MnQuickCapture({ onSave, onClose, tags, T, theme }) {
  const [title, setTitle] = useStateP('');
  const [body, setBody] = useStateP('');
  const [selected, setSelected] = useStateP([]);
  const titleRef = useRefP(null);

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
    onSave({ title: title.trim() || 'Untitled', body, tags: selected });
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

          <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginTop: 12 }}>
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
          }}>dated {new Date().toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</div>
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
          }}>Save note</button>
        </div>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────
// Reminder toast
// ────────────────────────────────────────────────────────────
function MnReminderToast({ toast, onDismiss, onSnooze, onOpen, T, variant }) {
  if (!toast) return null;
  const compact = typeof window !== 'undefined' && window.innerWidth <= 1180;

  if (variant === 'banner') {
    return (
      <div style={{
        position: 'absolute', top: 0, left: 0, right: 0, zIndex: 50,
        padding: '8px 16px', display: 'flex', alignItems: 'center', gap: 10,
        background: `color-mix(in oklab, ${T.warn} 14%, ${T.bg})`,
        borderBottom: `1px solid color-mix(in oklab, ${T.warn} 30%, transparent)`,
        fontFamily: 'var(--mn-ui)', fontSize: 12.5, color: T.ink,
        animation: 'mnSlideDown 200ms ease',
      }}>
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke={T.warn} strokeWidth="1.5">
          <circle cx="8" cy="9" r="5.5"/><path d="M8 6V9L10 10" strokeLinecap="round"/>
          <path d="M3 3L4.5 4.5M13 3L11.5 4.5" strokeLinecap="round"/>
        </svg>
        <span style={{ fontWeight: 500 }}>Reminder:</span>
        <span style={{ color: T.inkMed }}>{toast.text}</span>
        <div style={{ flex: 1 }} />
        <button onClick={() => onOpen(toast.noteId)} style={{
          padding: '2px 8px', borderRadius: 4, cursor: 'pointer',
          background: 'transparent', border: `1px solid ${T.line}`, color: T.inkMed,
          fontFamily: 'var(--mn-ui)', fontSize: 11.5,
        }}>Open note</button>
        <button onClick={onDismiss} style={{
          background: 'none', border: 'none', cursor: 'pointer',
          color: T.inkDim, padding: 4, fontSize: 14,
        }}>✕</button>
      </div>
    );
  }

  // Default: card toast bottom-right
  return (
    <div style={{
      position: 'absolute', bottom: compact ? 12 : 18, right: compact ? 12 : 18, zIndex: 50,
      width: compact ? 280 : 300,
      maxWidth: 'calc(100vw - 28px)',
      background: T.bgElevated || T.bg,
      borderRadius: 9,
      border: `1px solid ${T.line}`,
      boxShadow: typeof mnShadow === 'function'
        ? mnShadow(T, 'elevated')
        : `0 12px 40px color-mix(in oklab, ${T.ink} 18%, transparent)`,
      padding: compact ? 11 : 13,
      animation: 'mnSlideUp 220ms cubic-bezier(.2,.8,.2,1)',
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 6,
        fontFamily: 'var(--mn-mono)', fontSize: 9.5,
        color: T.warn, letterSpacing: '0.1em', textTransform: 'uppercase',
        marginBottom: compact ? 6 : 8, fontWeight: 600,
      }}>
        <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
          <circle cx="8" cy="9" r="5.5"/><path d="M8 6V9L10 10" strokeLinecap="round"/>
        </svg>
        Reminder
        <div style={{ flex: 1 }} />
        <button onClick={onDismiss} style={{
          background: 'none', border: 'none', cursor: 'pointer',
          color: T.inkDim, padding: 0, fontSize: 14,
        }}>✕</button>
      </div>
      <div style={{
        fontFamily: 'var(--mn-body)', fontSize: compact ? 13.2 : 14, color: T.ink,
        lineHeight: 1.5, marginBottom: 4,
      }}>{toast.text}</div>
      <div style={{
        fontFamily: 'var(--mn-mono)', fontSize: 10.5, color: T.inkDim,
        marginBottom: compact ? 8 : 10,
      }}>from {toast.noteTitle}</div>
      <div style={{ display: 'flex', gap: 6 }}>
        <button onClick={() => onOpen(toast.noteId)} style={{
          flex: 1, padding: compact ? '4px 10px' : '5px 10px', borderRadius: 5, cursor: 'pointer',
          background: T.ink, color: T.bg, border: 'none',
          fontFamily: 'var(--mn-ui)', fontSize: 12, fontWeight: 500,
        }}>Open note</button>
        <button onClick={onSnooze || onDismiss} style={{
          padding: compact ? '4px 9px' : '5px 10px', borderRadius: 5, cursor: 'pointer',
          background: T.bg, color: T.inkMed, border: `1px solid ${T.line}`,
          fontFamily: 'var(--mn-ui)', fontSize: 12,
        }}>Snooze</button>
      </div>
    </div>
  );
}

window.MnTodayPanel = MnTodayPanel;
window.MnRecentlyDeletedPanel = MnRecentlyDeletedPanel;
window.MnQuickCapture = MnQuickCapture;
window.MnReminderToast = MnReminderToast;

// ────────────────────────────────────────────────────────────
// Panel grip: thin vertical divider between panels with an always-visible
// pill button at vertical center for collapse/expand. The pill is centered
// so the collapsed-state peek handle aligns at the same Y.
// ────────────────────────────────────────────────────────────

// Icon: a panel + an arrow pointing in the action direction.
const PanelIcon = ({ direction }) => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor"
       strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"
       style={{ transform: direction === 'right' ? 'scaleX(-1)' : 'none' }}>
    <rect x="2" y="3" width="12" height="10" rx="1.5"/>
    <path d="M6 3V13"/>
    <path d="M11 6L9 8L11 10"/>
  </svg>
);

// Top offset so both grip buttons sit at the same Y as the editor toolbar
// buttons — collapsed peek and open grip naturally align across the row.
const GRIP_TOP = 14;

function MnPanelGrip({ side, onCollapse, T }) {
  const [hover, setHover] = useStateP(false);
  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        width: 1, flexShrink: 0, position: 'relative',
        background: T.line, zIndex: 5,
      }}>
      <button
        onClick={onCollapse}
        title={`Hide ${side === 'sidebar' ? 'sidebar' : 'note list'}`}
        style={{
          position: 'absolute',
          left: -12, top: GRIP_TOP,
          width: 24, height: 24, padding: 0,
          borderRadius: 6,
          border: `1px solid ${T.line}`,
          background: hover ? T.bgHover : T.bg,
          color: hover ? T.ink : T.inkMed,
          cursor: 'pointer',
          transition: 'background 120ms, color 120ms',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          boxShadow: hover
            ? `0 2px 6px color-mix(in oklab, ${T.ink} 14%, transparent)`
            : `0 1px 2px color-mix(in oklab, ${T.ink} 6%, transparent)`,
        }}>
        <PanelIcon direction="left" />
      </button>
    </div>
  );
}

function MnPanelGripPeek({ onExpand, T, title }) {
  const [hover, setHover] = useStateP(false);
  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        width: 1, flexShrink: 0, position: 'relative',
        background: T.line, zIndex: 5,
      }}>
      <button
        onClick={onExpand}
        title={title}
        style={{
          position: 'absolute',
          left: -12, top: GRIP_TOP,
          width: 24, height: 24, padding: 0,
          borderRadius: 6,
          border: `1px solid ${T.line}`,
          background: hover ? T.bgHover : T.bg,
          color: hover ? T.ink : T.inkMed,
          cursor: 'pointer',
          transition: 'background 120ms, color 120ms',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          boxShadow: hover
            ? `0 2px 6px color-mix(in oklab, ${T.ink} 14%, transparent)`
            : `0 1px 2px color-mix(in oklab, ${T.ink} 6%, transparent)`,
        }}>
        <PanelIcon direction="right" />
      </button>
    </div>
  );
}

window.MnPanelGrip = MnPanelGrip;
window.MnPanelGripPeek = MnPanelGripPeek;
