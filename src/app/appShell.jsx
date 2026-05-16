// App shell components shared by the renderer app.
const { useState: useStateA, useEffect: useEffectA, useMemo: useMemoA, useCallback: useCallbackA, useRef: useRefA } = React;
const MN_APP_SHELL_HELPERS = window.MN_APP_HELPERS || {};

function mnReminderDisplayDate(item) {
  return MN_APP_SHELL_HELPERS.reminderDisplayDate ? MN_APP_SHELL_HELPERS.reminderDisplayDate(item) : '';
}

function mnReminderStatusLabel(status) {
  return MN_APP_SHELL_HELPERS.reminderStatusLabel ? MN_APP_SHELL_HELPERS.reminderStatusLabel(status) : 'Upcoming';
}

const MN_LAUNCH_BLOOMS = [
  { color: '#f3bfd8', duration: '7.6s', delay: '-1.2s' },
  { color: '#a9c2ff', duration: '8.8s', delay: '-3.4s' },
  { color: '#9fe2c9', duration: '9.6s', delay: '-5.1s' },
];

function MnBootLogo() {
  return (
    <div className="mn-boot-brand" aria-label="VispNote">
      <img className="mn-boot-logo" src="assets/vispnote-loading-transparent.png" alt="VispNote" />
      <div className="mn-boot-title mn-boot-wordmark">VispNote</div>
      <div className="mn-boot-tagline"><span>Capture</span><i /><span>Organize</span><i /><span>Remember</span></div>
    </div>
  );
}

function MnLaunchScreen({ state, error, T }) {
  const loading = state === 'loading';
  return (
    <div className="mn-boot-splash" style={{ position: 'relative', zIndex: 'auto', width: '100vw', height: '100vh' }}>
      <div className="mn-boot-grid" />
      <div className="mn-boot-light-field" aria-hidden="true">
        {MN_LAUNCH_BLOOMS.map((item, i) => (
          <span
            key={`${item.color}-${i}`}
            className="mn-light-bloom"
            style={{
              '--bloom-color': item.color,
              '--bloom-duration': item.duration,
              '--bloom-delay': item.delay,
              animationPlayState: loading ? 'running' : 'paused',
            }}
          />
        ))}
      </div>
      <div className="mn-boot-core">
        <MnBootLogo />
        <div className="mn-boot-subtitle" style={{ color: loading ? '#667187' : '#b84b42' }}>
          {loading ? 'Connecting your workspace' : 'Launch interrupted'}
        </div>

        {loading ? (
          <>
            <div className="mn-boot-status">Opening vault and indexing notes</div>
            <div className="mn-boot-progress"><div /></div>
          </>
        ) : (
          <div style={{
            position: 'relative',
            zIndex: 1,
            width: 'min(420px, calc(100vw - 48px))',
            marginTop: 24,
            padding: '12px 14px',
            borderRadius: 8,
            background: 'rgba(255,255,255,0.56)',
            border: '1px solid rgba(120,130,152,0.22)',
            color: '#56647c',
            fontFamily: 'var(--mn-mono)',
            fontSize: 11,
            lineHeight: 1.55,
            textAlign: 'left',
            wordBreak: 'break-word',
          }}>{error || 'Unknown startup error'}</div>
        )}
      </div>
    </div>
  );
}

const HAS_DISK = typeof window !== 'undefined' && !!window.mn;

function MnDeleteNoteDialog({ note, T, onCancel, onConfirm }) {
  const cancelRef = useRefA(null);
  const mountedRef = useRefA(false);

  useEffectA(() => {
    mountedRef.current = true;
    const onKey = (e) => {
      if (e.key === 'Escape') onCancel && onCancel();
    };
    window.addEventListener('keydown', onKey);
    const handle = setTimeout(() => { if (mountedRef.current) cancelRef.current?.focus(); }, 0);
    return () => {
      mountedRef.current = false;
      window.removeEventListener('keydown', onKey);
      clearTimeout(handle);
    };
  }, [onCancel]);

  if (!note) return null;
  const blockCount = (window.MN_OUTLINE?.mnFlatten?.(note.blocks || [], 0, false) || []).length;
  const tagText = (note.tags || []).length
    ? (note.tags || []).map(t => `#${t}`).join(' ')
    : 'No tags';

  const btnBase = {
    height: 32,
    padding: '0 13px',
    borderRadius: 6,
    cursor: 'pointer',
    fontFamily: 'var(--mn-ui)',
    fontSize: 12.5,
    fontWeight: 600,
  };

  return (
    <div
      className="mn-delete-note-dialog"
      onClick={onCancel}
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 90,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: `color-mix(in oklab, ${T.ink} 30%, transparent)`,
        backdropFilter: 'blur(2px)',
        animation: 'mnFadeIn 120ms ease',
      }}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="mn-delete-note-title"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 420,
          maxWidth: 'calc(100vw - 40px)',
          background: T.bg,
          color: T.ink,
          border: `1px solid ${T.line}`,
          borderRadius: 10,
          boxShadow: `0 24px 70px color-mix(in oklab, ${T.ink} 26%, transparent)`,
          overflow: 'hidden',
          fontFamily: 'var(--mn-ui)',
        }}>
        <div style={{
          display: 'flex',
          gap: 12,
          padding: '18px 18px 14px',
          borderBottom: `1px solid ${T.lineSub}`,
          background: T.bgSub,
        }}>
          <div style={{
            width: 34,
            height: 34,
            borderRadius: 8,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
            color: T.danger,
            background: `color-mix(in oklab, ${T.danger} 12%, transparent)`,
            border: `1px solid color-mix(in oklab, ${T.danger} 24%, ${T.lineSub})`,
          }}>
            <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.45">
              <path d="M3 4.5H13M6 4.5V3C6 2.5 6.5 2 7 2H9C9.5 2 10 2.5 10 3V4.5M5 4.5V13C5 13.5 5.5 14 6 14H10C10.5 14 11 13.5 11 13V4.5" strokeLinecap="round"/>
            </svg>
          </div>
          <div style={{ minWidth: 0 }}>
            <div id="mn-delete-note-title" style={{
              fontSize: 15,
              fontWeight: 700,
              color: T.ink,
              marginBottom: 4,
            }}>Delete note?</div>
            <div style={{
              fontFamily: 'var(--mn-body)',
              fontSize: 13,
              lineHeight: 1.45,
              color: T.inkMed,
            }}>This moves the note to Recently deleted for 30 days.</div>
          </div>
        </div>
        <div style={{ padding: '16px 18px 10px' }}>
          <div style={{
            border: `1px solid ${T.lineSub}`,
            borderRadius: 8,
            background: T.bgSub,
            padding: '11px 12px',
          }}>
            <div style={{
              fontSize: 13.5,
              fontWeight: 650,
              color: T.ink,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              marginBottom: 5,
            }}>{note.title || 'Untitled'}</div>
            <div style={{
              display: 'flex',
              gap: 8,
              flexWrap: 'wrap',
              fontSize: 11.5,
              color: T.inkDim,
            }}>
              <span>{blockCount} {blockCount === 1 ? 'block' : 'blocks'}</span>
              <span style={{ color: T.line }}>•</span>
              <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{tagText}</span>
            </div>
          </div>
          <div style={{
            marginTop: 11,
            fontFamily: 'var(--mn-body)',
            fontSize: 12.5,
            lineHeight: 1.45,
            color: T.inkMed,
          }}>You can restore this note from Recently deleted.</div>
        </div>
        <div style={{
          display: 'flex',
          justifyContent: 'flex-end',
          gap: 8,
          padding: '12px 18px 16px',
        }}>
          <button
            ref={cancelRef}
            onClick={onCancel}
            style={{
              ...btnBase,
              background: T.bg,
              color: T.inkMed,
              border: `1px solid ${T.line}`,
            }}>
            Cancel
          </button>
          <button
            onClick={onConfirm}
            style={{
              ...btnBase,
              background: T.danger,
              color: T.bg,
              border: `1px solid ${T.danger}`,
              boxShadow: `0 8px 20px color-mix(in oklab, ${T.danger} 20%, transparent)`,
            }}>
            Move to trash
          </button>
        </div>
      </div>
    </div>
  );
}

function MnAppNoticeDialog({ notice, T, onClose }) {
  const closeRef = useRefA(null);
  const mountedRef = useRefA(false);

  useEffectA(() => {
    if (!notice) return;
    mountedRef.current = true;
    const onKey = (e) => {
      if (e.key === 'Escape' || e.key === 'Enter') onClose && onClose();
    };
    window.addEventListener('keydown', onKey);
    const handle = setTimeout(() => { if (mountedRef.current) closeRef.current?.focus(); }, 0);
    return () => {
      mountedRef.current = false;
      window.removeEventListener('keydown', onKey);
      clearTimeout(handle);
    };
  }, [notice, onClose]);

  if (!notice) return null;
  const title = notice.title || 'Something went wrong';
  const message = notice.message || notice.error || 'The operation could not be completed.';

  return (
    <div
      className="mn-app-notice-dialog"
      onClick={onClose}
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 92,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: `color-mix(in oklab, ${T.ink} 26%, transparent)`,
        backdropFilter: 'blur(2px)',
        animation: 'mnFadeIn 120ms ease',
      }}>
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="mn-app-notice-title"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 400,
          maxWidth: 'calc(100vw - 40px)',
          background: T.bg,
          color: T.ink,
          border: `1px solid ${T.line}`,
          borderRadius: 10,
          boxShadow: `0 24px 70px color-mix(in oklab, ${T.ink} 24%, transparent)`,
          overflow: 'hidden',
          fontFamily: 'var(--mn-ui)',
        }}>
        <div style={{
          display: 'flex',
          gap: 12,
          padding: '17px 18px 14px',
          borderBottom: `1px solid ${T.lineSub}`,
          background: T.bgSub,
        }}>
          <div style={{
            width: 34,
            height: 34,
            borderRadius: 8,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
            color: notice.tone === 'warn' ? T.warn : T.danger,
            background: `color-mix(in oklab, ${notice.tone === 'warn' ? T.warn : T.danger} 12%, transparent)`,
            border: `1px solid color-mix(in oklab, ${notice.tone === 'warn' ? T.warn : T.danger} 24%, ${T.lineSub})`,
          }}>
            <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.45">
              <path d="M8 2L14 13H2L8 2Z" strokeLinejoin="round"/>
              <path d="M8 6V9M8 11.7V11.8" strokeLinecap="round"/>
            </svg>
          </div>
          <div style={{ minWidth: 0 }}>
            <div id="mn-app-notice-title" style={{
              fontSize: 15,
              fontWeight: 700,
              color: T.ink,
              marginBottom: 4,
            }}>{title}</div>
            <div style={{
              fontFamily: 'var(--mn-body)',
              fontSize: 13,
              lineHeight: 1.45,
              color: T.inkMed,
              whiteSpace: 'pre-wrap',
              overflowWrap: 'anywhere',
            }}>{message}</div>
          </div>
        </div>
        <div style={{
          display: 'flex',
          justifyContent: 'flex-end',
          padding: '12px 18px 16px',
        }}>
          <button
            ref={closeRef}
            onClick={onClose}
            style={{
              height: 32,
              padding: '0 14px',
              borderRadius: 6,
              cursor: 'pointer',
              fontFamily: 'var(--mn-ui)',
              fontSize: 12.5,
              fontWeight: 650,
              background: T.ink,
              color: T.bg,
              border: `1px solid ${T.ink}`,
            }}>
            OK
          </button>
        </div>
      </div>
    </div>
  );
}

function MnSaveConflictDialog({ conflict, T, onReloadDisk, onKeepCopy, onDismiss }) {
  if (!conflict) return null;
  const when = conflict.currentModifiedAt ? new Date(conflict.currentModifiedAt).toLocaleString() : 'recently';
  const btn = (tone = 'default') => ({
    height: 32,
    padding: '0 12px',
    borderRadius: 6,
    cursor: 'pointer',
    fontFamily: 'var(--mn-ui)',
    fontSize: 12.5,
    fontWeight: 650,
    background: tone === 'primary' ? T.ink : T.bg,
    color: tone === 'primary' ? T.bg : T.inkMed,
    border: `1px solid ${tone === 'primary' ? T.ink : T.line}`,
  });
  return (
    <div className="mn-save-conflict-dialog" onClick={onDismiss} style={{
      position: 'absolute', inset: 0, zIndex: 93,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: `color-mix(in oklab, ${T.ink} 28%, transparent)`,
      backdropFilter: 'blur(2px)', animation: 'mnFadeIn 120ms ease',
    }}>
      <div role="dialog" aria-modal="true" onClick={e => e.stopPropagation()} style={{
        width: 460, maxWidth: 'calc(100vw - 40px)',
        background: T.bg, color: T.ink, border: `1px solid ${T.line}`,
        borderRadius: 10, overflow: 'hidden',
        boxShadow: `0 24px 70px color-mix(in oklab, ${T.ink} 24%, transparent)`,
        fontFamily: 'var(--mn-ui)',
      }}>
        <div style={{ padding: '17px 18px 14px', background: T.bgSub, borderBottom: `1px solid ${T.lineSub}` }}>
          <div style={{ fontSize: 15, fontWeight: 750, marginBottom: 5 }}>Save conflict</div>
          <div style={{ fontFamily: 'var(--mn-body)', fontSize: 13, lineHeight: 1.45, color: T.inkMed }}>
            “{conflict.title || 'Untitled'}” changed on disk {when}. VispNote kept your local edits unsaved.
          </div>
        </div>
        <div style={{ padding: '14px 18px 16px', display: 'flex', justifyContent: 'flex-end', gap: 8, flexWrap: 'wrap' }}>
          <button onClick={onDismiss} style={btn()}>Keep editing</button>
          <button onClick={onKeepCopy} style={btn()}>Save local copy</button>
          <button onClick={onReloadDisk} style={btn('primary')}>Reload disk version</button>
        </div>
      </div>
    </div>
  );
}

function MnVersionHistoryDialog({ note, vaultId, T, onClose, onRestore }) {
  const [versions, setVersions] = useStateA([]);
  const [busy, setBusy] = useStateA(false);
  const [error, setError] = useStateA('');

  const load = useCallbackA(async () => {
    if (!window.mn?.listNoteVersions || !vaultId || !note?.id) return;
    setBusy(true);
    setError('');
    try {
      const res = await window.mn.listNoteVersions(vaultId, note.id);
      if (!res.ok) throw new Error(res.error || 'Could not load versions');
      setVersions(res.value || []);
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setBusy(false);
    }
  }, [vaultId, note?.id]);

  useEffectA(() => { load(); }, [load]);

  if (!note) return null;
  const btn = (danger = false) => ({
    height: 30,
    padding: '0 11px',
    borderRadius: 6,
    cursor: 'pointer',
    fontFamily: 'var(--mn-ui)',
    fontSize: 12,
    fontWeight: 600,
    background: T.bg,
    color: danger ? T.danger : T.inkMed,
    border: `1px solid ${danger ? T.danger : T.line}`,
  });
  return (
    <div className="mn-version-history-dialog" onClick={onClose} style={{
      position: 'absolute', inset: 0, zIndex: 91,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: `color-mix(in oklab, ${T.ink} 28%, transparent)`,
      backdropFilter: 'blur(2px)', animation: 'mnFadeIn 120ms ease',
    }}>
      <div role="dialog" aria-modal="true" onClick={e => e.stopPropagation()} style={{
        width: 520, maxWidth: 'calc(100vw - 40px)', maxHeight: 'calc(100vh - 56px)',
        background: T.bg, color: T.ink, border: `1px solid ${T.line}`,
        borderRadius: 10, overflow: 'hidden', fontFamily: 'var(--mn-ui)',
        boxShadow: `0 24px 70px color-mix(in oklab, ${T.ink} 24%, transparent)`,
      }}>
        <div style={{ padding: '17px 18px 14px', background: T.bgSub, borderBottom: `1px solid ${T.lineSub}` }}>
          <div style={{ fontSize: 15, fontWeight: 750, marginBottom: 4 }}>Version history</div>
          <div style={{ fontFamily: 'var(--mn-body)', fontSize: 13, color: T.inkMed }}>{note.title || 'Untitled'}</div>
        </div>
        <div style={{ padding: 14, maxHeight: 380, overflow: 'auto' }}>
          {error && <div style={{ color: T.danger, fontSize: 12, marginBottom: 10 }}>{error}</div>}
          {!busy && versions.length === 0 && (
            <div style={{ fontFamily: 'var(--mn-body)', fontSize: 13, color: T.inkDim, padding: 8 }}>No saved versions yet.</div>
          )}
          {versions.map(version => (
            <div key={version.versionId} style={{
              display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', gap: 10,
              alignItems: 'center', padding: '9px 10px', border: `1px solid ${T.lineSub}`,
              borderRadius: 7, background: T.bgSub, marginBottom: 6,
            }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 12.5, fontWeight: 650, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {version.title || 'Untitled'}
                </div>
                <div style={{ marginTop: 3, fontFamily: 'var(--mn-mono)', fontSize: 10, color: T.inkDim }}>
                  {version.createdAt ? new Date(version.createdAt).toLocaleString() : version.versionId}
                </div>
              </div>
              <button style={btn()} disabled={busy} onClick={async () => {
                setBusy(true);
                const result = await onRestore(note.id, version.versionId);
                setBusy(false);
                if (result?.ok !== false) onClose();
              }}>Restore</button>
            </div>
          ))}
        </div>
        <div style={{ padding: '12px 18px 16px', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button onClick={load} disabled={busy} style={btn()}>Refresh</button>
          <button onClick={onClose} style={btn()}>Close</button>
        </div>
      </div>
    </div>
  );
}

function MnReminderCenter({ open, items, dueCount, onToggle, onClose, onOpenNote, topOffset = 14, T }) {
  const visibleItems = items;
  return (
    <div
      className="mn-reminder-center"
      style={{
        position: 'fixed',
        top: topOffset,
        right: 18,
        zIndex: 90,
      }}>
      <button
        onClick={onToggle}
        title="Reminder notifications"
        aria-label="Reminder notifications"
        style={{
          position: 'relative',
          zIndex: 2,
          width: 30,
          height: 30,
          borderRadius: 6,
          border: `1px solid ${open ? T.accent : T.lineSub}`,
          background: open ? T.accentSoft : T.bg,
          color: open ? T.accent : T.inkMed,
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          boxShadow: `0 8px 20px color-mix(in oklab, ${T.ink} 8%, transparent)`,
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
              top: 38,
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
                <div style={{
                  padding: '26px 16px',
                  textAlign: 'center',
                  color: T.inkDim,
                  fontFamily: 'var(--mn-ui)',
                  fontSize: 12.5,
                }}>No reminders in this vault</div>
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
                      fontFamily: 'var(--mn-mono)',
                      fontSize: 9.5,
                      color: item.status === 'due' ? T.warn : T.inkDim,
                      textTransform: 'uppercase',
                      letterSpacing: '0.06em',
                      fontWeight: 600,
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

function MnAiNotice({ notice, onOpen, onDismiss, T }) {
  if (!notice) return null;
  const isError = !!notice.error;
  return (
    <div style={{
      position: 'absolute',
      right: 18,
      bottom: 18,
      zIndex: 80,
      width: 330,
      maxWidth: 'calc(100vw - 36px)',
      border: `1px solid ${isError ? `color-mix(in oklab, ${T.warn} 42%, ${T.line})` : T.line}`,
      borderRadius: 8,
      background: T.bg,
      color: T.ink,
      boxShadow: `0 18px 48px color-mix(in oklab, ${T.ink} 18%, transparent)`,
      overflow: 'hidden',
      fontFamily: 'var(--mn-ui)',
      animation: 'mnSlideUp 160ms ease',
    }}>
      <button
        onClick={onOpen}
        style={{
          width: '100%',
          border: 'none',
          background: isError ? `color-mix(in oklab, ${T.warn} 8%, ${T.bg})` : T.bg,
          color: T.ink,
          cursor: 'pointer',
          textAlign: 'left',
          padding: '12px 13px',
          display: 'flex',
          gap: 10,
          alignItems: 'flex-start',
        }}>
        <span style={{
          width: 28,
          height: 28,
          borderRadius: 7,
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          border: `1px solid ${isError ? T.warn : T.selLine}`,
          background: isError ? `color-mix(in oklab, ${T.warn} 14%, transparent)` : T.accentSoft,
          color: isError ? T.warn : T.accent,
        }}>
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.45">
            {isError ? (
              <path d="M8 3V8M8 11.4V11.5M3.4 13H12.6L8 2.8L3.4 13Z" strokeLinecap="round" strokeLinejoin="round" />
            ) : (
              <path d="M3.5 8.5L6.5 11.5L12.5 4.5" strokeLinecap="round" strokeLinejoin="round" />
            )}
          </svg>
        </span>
        <span style={{ minWidth: 0 }}>
          <span style={{ display: 'block', fontSize: 13, fontWeight: 650, color: T.ink }}>
            {isError ? 'AI task needs attention' : 'AI response ready'}
          </span>
          <span style={{
            display: 'block',
            marginTop: 3,
            fontSize: 12.5,
            lineHeight: 1.35,
            color: T.inkDim,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}>
            {notice.query || 'Open Ask AI to view the result'}
          </span>
        </span>
      </button>
      <button
        onClick={onDismiss}
        title="Dismiss"
        aria-label="Dismiss AI notification"
        style={{
          position: 'absolute',
          top: 7,
          right: 7,
          width: 24,
          height: 24,
          borderRadius: 5,
          border: `1px solid ${T.lineSub}`,
          background: T.bg,
          color: T.inkDim,
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 0,
        }}>
        <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6">
          <path d="M4 4L12 12M12 4L4 12" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  );
}

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

function MnVaultHealthDialog({ vaultId, onClose, onRebuildIndex, T }) {
  const [health, setHealth] = useStateA(null);
  const [error, setError] = useStateA(null);
  useEffectA(() => {
    let alive = true;
    setHealth(null);
    setError(null);
    if (!window.mn?.vaultHealth || !vaultId) return;
    window.mn.vaultHealth(vaultId).then(res => {
      if (!alive) return;
      if (res.ok) setHealth(res.value);
      else setError(res.error || 'Could not load vault health');
    }).catch(e => alive && setError(e.message || String(e)));
    return () => { alive = false; };
  }, [vaultId]);
  const stat = (label, value) => (
    <div style={{ border: `1px solid ${T.lineSub}`, borderRadius: 7, padding: 10, background: T.bgSub }}>
      <div style={{ fontFamily: 'var(--mn-mono)', fontSize: 10, color: T.inkDim, textTransform: 'uppercase' }}>{label}</div>
      <div style={{ marginTop: 4, fontSize: 18, fontWeight: 720, color: T.ink }}>{value}</div>
    </div>
  );
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 250, background: 'color-mix(in oklab, oklch(0.2 0.02 240) 32%, transparent)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div onClick={e => e.stopPropagation()} style={{ width: 'min(760px, 100%)', maxHeight: '86vh', overflow: 'auto', background: T.bg, color: T.ink, border: `1px solid ${T.line}`, borderRadius: 10, boxShadow: `0 24px 70px color-mix(in oklab, ${T.ink} 28%, transparent)` }}>
        <div style={{ padding: 16, borderBottom: `1px solid ${T.lineSub}`, display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ flex: 1, fontSize: 16, fontWeight: 720 }}>Vault Health</div>
          <button onClick={onRebuildIndex} style={mnSmallActionButton(T)}>Rebuild index</button>
          <button onClick={onClose} style={mnSmallActionButton(T)}>Close</button>
        </div>
        <div style={{ padding: 16 }}>
          {error && <div style={{ color: T.warn || '#b33', fontSize: 13 }}>{error}</div>}
          {!health && !error && <div style={{ color: T.inkDim, fontSize: 13 }}>Checking vault...</div>}
          {health && (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 10 }}>
                {stat('Notes', health.noteCount)}
                {stat('Tags', health.tagCount)}
                {stat('Canvases', health.canvasCount)}
                {stat('Words', health.wordCount)}
              </div>
              {health.indexStatus && typeof health.indexStatus === 'object' && (
                <div style={{ marginTop: 12, border: `1px solid ${T.lineSub}`, borderRadius: 8, overflow: 'hidden', background: T.bgSub }}>
                  <div style={{ padding: '9px 11px', borderBottom: `1px solid ${T.lineSub}`, fontSize: 12, fontWeight: 700 }}>Index Health</div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 8, padding: 10 }}>
                    {stat('FTS notes', health.indexStatus.ftsIndexedNoteCount ?? '—')}
                    {stat('Embed notes', health.indexStatus.embeddingNoteCount ?? '—')}
                    {stat('Chunks', health.indexStatus.embeddingChunkCount ?? '—')}
                    {stat('Missing', health.indexStatus.missingEmbeddingCount ?? '—')}
                  </div>
                  <div style={{ padding: '0 11px 11px', fontSize: 12, color: T.inkDim, fontFamily: 'var(--mn-body)' }}>
                    {health.indexStatus.failureReason
                      ? `Fallback reason: ${health.indexStatus.failureReason}`
                      : `Model: ${health.indexStatus.model || 'unknown'} · Backfill: ${health.indexStatus.backfill?.running ? `${health.indexStatus.backfill.done || 0}/${health.indexStatus.backfill.total || 0}` : (health.indexStatus.backfill?.lastBackfill ? `last ran ${new Date(health.indexStatus.backfill.lastBackfill).toLocaleString()}` : 'idle')}`}
                  </div>
                </div>
              )}
              <div style={{ marginTop: 16, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                <MnHealthList title="Broken Links" items={health.brokenLinks || []} empty="No broken wiki links" render={item => `${item.noteTitle} -> ${item.target}`} T={T} />
                <MnHealthList title="Orphan Notes" items={health.orphanNotes || []} empty="No orphan notes" render={item => item.title} T={T} />
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function MnHealthList({ title, items, empty, render, T }) {
  return (
    <div style={{ border: `1px solid ${T.lineSub}`, borderRadius: 8, overflow: 'hidden' }}>
      <div style={{ padding: '9px 11px', borderBottom: `1px solid ${T.lineSub}`, fontSize: 12, fontWeight: 700 }}>{title}</div>
      <div style={{ maxHeight: 220, overflow: 'auto' }}>
        {items.length ? items.slice(0, 80).map((item, index) => (
          <div key={index} style={{ padding: '8px 11px', borderBottom: `1px solid ${T.lineSub}`, fontSize: 12.5, color: T.inkMed }}>{render(item)}</div>
        )) : <div style={{ padding: 12, fontSize: 12.5, color: T.inkDim }}>{empty}</div>}
      </div>
    </div>
  );
}

function mnSmallActionButton(T) {
  return {
    border: `1px solid ${T.lineSub}`,
    background: T.bg,
    color: T.inkMed,
    borderRadius: 6,
    padding: '7px 10px',
    cursor: 'pointer',
    fontFamily: 'var(--mn-ui)',
    fontSize: 12,
  };
}


window.MN_APP_SHELL = {
  HAS_DISK,
  MnLaunchScreen,
  MnDeleteNoteDialog,
  MnAppNoticeDialog,
  MnSaveConflictDialog,
  MnVersionHistoryDialog,
  MnReminderCenter,
  MnAiNotice,
  MnCommandPalette,
  MnVaultHealthDialog,
  MnHealthList,
  mnSmallActionButton,
};
