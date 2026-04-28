// Main App — composes sidebar, note list, editor, panels, overlays.
// Disk-backed via window.mn (Electron preload IPC). Falls back to in-memory
// seed when running outside Electron (e.g. opened directly in a browser).

const { useState: useStateA, useEffect: useEffectA, useMemo: useMemoA, useCallback: useCallbackA, useRef: useRefA } = React;

const MN_TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "theme": "light",
  "density": "comfortable",
  "graphStyle": "force",
  "todoVariant": "list",
  "toastVariant": "card",
  "fontChoice": "Editorial (Newsreader + Inter)",
  "showNoteList": true,
  "showSidebar": true,
  "editorWidth": "medium",
  "fontSize": "default",
  "appFontSize": "default",
  "indentGuides": true,
  "spellCheck": true,
  "autoLink": true,
  "collapseByDefault": false,
  "sortBy": "modified",
  "defaultTags": "",
  "pinnedFirst": true,
  "rollupFormat": "long",
  "reminderSound": false,
  "showOverdue": true,
  "snoozeMinutes": "15",
  "weekStart": "monday",
  "workflowStates": null,
  "autoSave": true,
  "storageFormat": "markdown",
  "sync": "local"
}/*EDITMODE-END*/;

// Convert raw notes (with markdown body) to runtime form (with parsed blocks).
function normalizeNotes(notes, mnMdToBlocks) {
  return (notes || []).map(n => ({
    ...n,
    blocks: n.blocks || mnMdToBlocks(n.body || ''),
  }));
}

// Strip in-memory-only fields before persisting to disk.
function noteForDisk(n, mnBlocksToMd) {
  return {
    id: n.id,
    title: n.title || 'Untitled',
    date: n.date || new Date().toISOString(),
    tags: Array.isArray(n.tags) ? n.tags : [],
    pinned: !!n.pinned,
    workflowArchived: !!n.workflowArchived,
    body: mnBlocksToMd(n.blocks || []),
  };
}

function collectWorkflowBlocks(notes, states, mnWalk) {
  const stateIds = states.map(s => s.id);
  const counts = Object.fromEntries(stateIds.map(id => [id, 0]));
  const byState = Object.fromEntries(stateIds.map(id => [id, []]));
  const noteIdsByState = Object.fromEntries(stateIds.map(id => [id, new Set()]));
  const archivedNotes = [];

  notes.forEach(note => {
    const noteItems = [];
    mnWalk(note.blocks || [], (block) => {
      if (!block.workflow || !counts.hasOwnProperty(block.workflow)) return;
      noteItems.push({
        id: block.id,
        noteId: note.id,
        noteTitle: note.title,
        noteTags: note.tags || [],
        text: block.content || '',
        kind: block.kind,
        workflow: block.workflow,
      });
    });
    if (note.workflowArchived) {
      if (noteItems.length) {
        archivedNotes.push({
          id: note.id,
          title: note.title,
          tags: note.tags || [],
          workflowCount: noteItems.length,
        });
      }
      return;
    }
    noteItems.forEach(item => {
      counts[item.workflow]++;
      noteIdsByState[item.workflow].add(note.id);
      byState[item.workflow].push(item);
    });
  });

  return {
    counts,
    byState,
    noteIdsByState,
    archivedNotes,
    total: Object.values(counts).reduce((sum, count) => sum + count, 0),
  };
}

function normalizeTagName(name) {
  return String(name || '').trim().toLowerCase().replace(/\s+/g, '-').replace(/^-+|-+$/g, '');
}

function mnParseDefaultTags(value) {
  return String(value || '')
    .split(',')
    .map(normalizeTagName)
    .filter(Boolean)
    .filter((tag, index, arr) => arr.indexOf(tag) === index);
}

function mnNormalizeWorkflowStatesForApp(states) {
  return (window.MN_LOGSEQ?.mnNormalizeWorkflowStates || ((value) => value))(
    Array.isArray(states) && states.length
      ? states
      : (window.MN_LOGSEQ?.DEFAULT_WORKFLOW_STATES || window.MN_LOGSEQ?.WORKFLOW_STATES || [])
  );
}

function mnReminderKey(item) {
  return [item.noteId, item.line ?? item.blockId ?? '', item.remindAt?.date || '', item.remindAt?.time || '', item.text || ''].join('|');
}

function mnReadSnoozedReminders() {
  try { return JSON.parse(localStorage.getItem('mn:snoozedReminders') || '{}') || {}; }
  catch { return {}; }
}

function mnWriteSnoozedReminder(key, until) {
  const data = mnReadSnoozedReminders();
  data[key] = until;
  try { localStorage.setItem('mn:snoozedReminders', JSON.stringify(data)); } catch (e) {}
}

function mnCollectReminderItems(notes) {
  const parser = window.MN_REMIND;
  if (!parser?.parse) return [];
  const out = [];
  notes.forEach(note => {
    const pushItem = (text, meta = {}) => {
      const remindAt = parser.parse(text);
      if (!remindAt) return;
      out.push({
        noteId: note.id,
        noteTitle: note.title,
        text: parser.strip ? parser.strip(text) : String(text || '').replace(remindAt.raw, '').trim(),
        remindAt,
        ...meta,
      });
    };
    if (note.blocks?.length && window.mnWalk) {
      window.mnWalk(note.blocks, block => {
        if (block.kind === 'todo' && block.checked) return;
        pushItem(block.content || '', { blockId: block.id });
      });
      return;
    }
    String(note.body || '').split('\n').forEach((line, lineIndex) => {
      if (/^\s*-\s+\[[xX]\]/.test(line)) return;
      pushItem(line, { line: lineIndex });
    });
  });
  return out.map(item => ({ ...item, key: mnReminderKey(item) }));
}

function mnPlayReminderSound() {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = 740;
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.05, ctx.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.22);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.24);
    setTimeout(() => ctx.close?.(), 400);
  } catch (e) {}
}

function mnReminderDisplayDate(item) {
  const at = item?.remindAt?.at;
  if (!at) return '';
  return at.toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function mnReminderStatusLabel(status) {
  if (status === 'due') return 'Due';
  if (status === 'snoozed') return 'Snoozed';
  return 'Upcoming';
}

const MN_LAUNCH_BLOOMS = [
  { color: '#f3bfd8', duration: '7.6s', delay: '-1.2s' },
  { color: '#a9c2ff', duration: '8.8s', delay: '-3.4s' },
  { color: '#9fe2c9', duration: '9.6s', delay: '-5.1s' },
];

const MN_LAUNCH_RIPPLES = [
  { color: '#f3bfd8', duration: '4.8s', delay: '0s' },
  { color: '#a9c2ff', duration: '4.8s', delay: '-1.6s' },
  { color: '#9fe2c9', duration: '4.8s', delay: '-3.2s' },
];

function MnBootLogo() {
  return (
    <div className="mn-boot-brand" aria-label="OminiNote">
      <svg className="mn-boot-logo" viewBox="0 0 240 170" role="img" aria-hidden="true">
        <path className="mn-logo-aura" d="M44 58C44 32 76 23 98 44L120 65L142 44C164 23 196 32 196 58C196 84 165 94 142 73L120 51L98 73C75 94 44 84 44 58Z" stroke="#a8c7ff" pathLength="100" />
        <path className="mn-logo-aura" d="M66 96C42 107 42 145 74 149C77 169 111 169 119 145M174 96C198 107 198 145 166 149C163 169 129 169 121 145M120 83V145" stroke="#aaa5ff" pathLength="100" />
        <path className="mn-logo-aura" d="M142 44C164 23 196 32 196 58C196 84 165 94 142 73" stroke="#ff9c92" pathLength="100" />
        <path className="mn-logo-line" d="M44 58C44 32 76 23 98 44L120 65L142 44C164 23 196 32 196 58C196 84 165 94 142 73L120 51L98 73C75 94 44 84 44 58Z" stroke="#9bbdff" pathLength="100" />
        <path className="mn-logo-line mn-logo-line-soft" d="M66 96C42 107 42 145 74 149C77 169 111 169 119 145M174 96C198 107 198 145 166 149C163 169 129 169 121 145M120 83V145" stroke="#9b99ff" pathLength="100" />
        <path className="mn-logo-line mn-logo-line-soft" d="M72 122C85 111 102 114 108 127M168 122C155 111 138 114 132 127M86 84C96 78 107 78 116 85M154 84C144 78 133 78 124 85" stroke="#8d8dff" pathLength="100" />
        <path className="mn-logo-line" d="M142 44C164 23 196 32 196 58C196 84 165 94 142 73" stroke="#ff9c92" pathLength="100" />
      </svg>
      <div className="mn-boot-title mn-boot-wordmark"><span className="mn-word-omni">Omini</span><span className="mn-word-note">Note</span></div>
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
        {MN_LAUNCH_RIPPLES.map((item, i) => (
          <span
            key={`ripple-${item.color}-${i}`}
            className="mn-light-ripple"
            style={{
              '--ripple-color': item.color,
              '--ripple-duration': item.duration,
              '--ripple-delay': item.delay,
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
            <div className="mn-boot-progress"><div /></div>
            <div style={{
              position: 'relative',
              zIndex: 1,
              marginTop: 18,
              fontFamily: 'var(--mn-ui)',
              fontSize: 12.5,
              color: '#56647c',
            }}>Opening vault and indexing notes</div>
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

  useEffectA(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onCancel && onCancel();
    };
    window.addEventListener('keydown', onKey);
    const handle = setTimeout(() => cancelRef.current?.focus(), 0);
    return () => {
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
            }}>This removes the note from the current vault.</div>
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
          }}>This action cannot be undone from the editor history.</div>
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
            Delete note
          </button>
        </div>
      </div>
    </div>
  );
}

function MnReminderCenter({ open, items, dueCount, onToggle, onClose, onOpenNote, T }) {
  const visibleItems = items;
  return (
    <div
      className="mn-reminder-center"
      style={{
        position: 'absolute',
        top: 13,
        right: 18,
        zIndex: 45,
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

function MnApp() {
  const { SEED_TAGS, SEED_NOTES, buildLinks } = window.MN_DATA;
  const { mnMdToBlocks, mnBlocksToMd, mkBlock, mnLocate, mnCloneBlocks, mnWalk } = window.MN_OUTLINE;
  // make them available to other modules via globals too
  window.mnMdToBlocks = mnMdToBlocks; window.mnBlocksToMd = mnBlocksToMd;
  window.mnWalk = mnWalk; window.mnLocate = mnLocate; window.mnCloneBlocks = mnCloneBlocks;
  window.mkBlock = mkBlock;

  const [bootState, setBootState] = useStateA('loading'); // 'loading' | 'ready' | 'error'
  const [bootError, setBootError] = useStateA(null);

  const [tweaks, setTweaks] = useStateA(MN_TWEAK_DEFAULTS);
  const [settingsOpen, setSettingsOpen] = useStateA(false);

  // ── State (populated after disk load) ───────────────────────────────────
  // vaults stores per-vault metadata + cached notes/tags (cache fills lazily)
  const [vaults, setVaults] = useStateA([]);
  const [activeVaultId, setActiveVaultId] = useStateA(null);
  const [tags, setTags] = useStateA([]);
  const [notes, setNotes] = useStateA([]);
  const [selectedId, setSelectedId] = useStateA(null);
  const [canvases, setCanvases] = useStateA([]);
  const [activeCanvas, setActiveCanvas] = useStateA(null);

  const [selectedTag, setSelectedTag] = useStateA(null);
  const [selectedWorkflow, setSelectedWorkflow] = useStateA(null);
  const [view, setView] = useStateA('notes');
  const lastViewRef = useRefA('notes');
  const [askAiOpen, setAskAiOpen] = useStateA(false);
  const [captureOpen, setCaptureOpen] = useStateA(false);
  const [deleteTargetId, setDeleteTargetId] = useStateA(null);
  const [toast, setToast] = useStateA(null);
  const [reminderCenterOpen, setReminderCenterOpen] = useStateA(false);
  const dismissedReminderKeys = useRefA(new Set());
  const [query, setQuery] = useStateA('');

  useEffectA(() => {
    if (bootState === 'loading') return;
    const splash = document.getElementById('mn-boot-splash');
    if (!splash) return;
    splash.style.opacity = '0';
    splash.style.pointerEvents = 'none';
    const handle = setTimeout(() => splash.remove(), 240);
    return () => clearTimeout(handle);
  }, [bootState]);

  const navigateView = useCallbackA((nextView) => {
    setView(current => {
      if (current !== nextView) lastViewRef.current = current;
      return nextView;
    });
  }, []);

  const goBackView = useCallbackA(() => {
    const target = lastViewRef.current || 'notes';
    setView(current => {
      lastViewRef.current = current === target ? 'notes' : current;
      return target;
    });
  }, []);

  // dirtyNotes tracks note -> owning vault. This prevents a delayed save from
  // writing an edited note into whatever vault happens to be active later.
  const [dirtyNotes, setDirtyNotes] = useStateA(() => new Map());
  const markDirty = useCallbackA((id) => {
    if (!id || !activeVaultId) return;
    setDirtyNotes(s => {
      const n = new Map(s);
      n.set(id, activeVaultId);
      return n;
    });
  }, [activeVaultId]);
  const tagsDirty = useRefA(false);
  const markTagsDirty = useCallbackA(() => { tagsDirty.current = true; }, []);

  const saveVaultMetaNow = useCallbackA(async (
    vaultId = activeVaultId,
    nextTags = tags,
    nextSelectedId = selectedId,
    forceTags = false
  ) => {
    if (!HAS_DISK || !vaultId) return;
    const patch = {};
    if (forceTags || tagsDirty.current) patch.tags = nextTags;
    if (nextSelectedId) patch.lastSelectedId = nextSelectedId;
    if (!Object.keys(patch).length) return;
    try {
      await window.mn.saveVaultMeta(vaultId, patch);
      if (patch.tags && vaultId === activeVaultId) tagsDirty.current = false;
    } catch (e) {
      console.error('saveVaultMeta failed', e);
    }
  }, [activeVaultId, tags, selectedId]);

  // ── Bootstrap from disk ─────────────────────────────────────────────────
  useEffectA(() => {
    let cancelled = false;
    (async () => {
      try {
        if (!HAS_DISK) {
          // In-browser fallback: use seed
          const seedNotes = normalizeNotes(SEED_NOTES, mnMdToBlocks);
          if (cancelled) return;
          setVaults([{
            id: 'v_personal', name: 'Personal', slug: 'personal',
            path: '~/OminiNote/personal', notes: seedNotes, tags: SEED_TAGS, canvases: [],
          }]);
          setActiveVaultId('v_personal');
          setTags(SEED_TAGS);
          setNotes(seedNotes);
          setCanvases([]);
          setSelectedId(seedNotes[0]?.id || null);
          setBootState('ready');
          return;
        }

        const prefsRes = await window.mn.getPrefs();
        if (!prefsRes.ok) throw new Error(prefsRes.error);
        const prefs = prefsRes.value;
        if (prefs.tweaks) {
          const mergedTweaks = { ...MN_TWEAK_DEFAULTS, ...prefs.tweaks };
          window.MN_LOGSEQ?.setWorkflowStates?.(mnNormalizeWorkflowStatesForApp(mergedTweaks.workflowStates));
          setTweaks(t => ({ ...t, ...prefs.tweaks }));
        }
        if (prefs.aiConfig && window.mn?.ai) await window.mn.ai.setConfig(prefs.aiConfig);

        const vlistRes = await window.mn.listVaults();
        if (!vlistRes.ok) throw new Error(vlistRes.error);
        const vlist = vlistRes.value;
        if (!vlist.length) throw new Error('No vaults found');

        const activeId = prefs.activeVaultId || vlist[0].id;

        const vaultRes = await window.mn.loadVault(activeId);
        if (!vaultRes.ok) throw new Error(vaultRes.error);
        const v = vaultRes.value;
        const loadedNotes = normalizeNotes(v.notes, mnMdToBlocks);
        let loadedCanvases = [];
        try {
          const canvasRes = await window.mn.listCanvases(activeId);
          if (canvasRes.ok) loadedCanvases = canvasRes.value || [];
        } catch (e) { console.error('listCanvases failed', activeId, e); }

        if (cancelled) return;
        setVaults(vlist.map(meta => meta.id === activeId
          ? { ...meta, notes: loadedNotes, tags: v.tags, lastSelectedId: v.lastSelectedId, canvases: loadedCanvases }
          : { ...meta, notes: null, tags: null, canvases: null }));
        setActiveVaultId(activeId);
        setTags(v.tags || []);
        setNotes(loadedNotes);
        setCanvases(loadedCanvases);
        setSelectedId(v.lastSelectedId || loadedNotes[0]?.id || null);
        setBootState('ready');
      } catch (e) {
        console.error('Bootstrap failed', e);
        if (!cancelled) { setBootError(e.message || String(e)); setBootState('error'); }
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // ── Persist tweaks ─────────────────────────────────────────────────────
  const tweakInitialized = useRefA(false);
  useEffectA(() => {
    if (!HAS_DISK) return;
    if (!tweakInitialized.current) { tweakInitialized.current = true; return; }
    const t = setTimeout(() => { window.mn.setPrefs({ tweaks }); }, 250);
    return () => clearTimeout(t);
  }, [tweaks]);

  const findNotesForVault = useCallbackA((vaultId, currentNotes = notes, currentVaults = vaults) => {
    if (vaultId === activeVaultId) return currentNotes;
    return currentVaults.find(v => v.id === vaultId)?.notes || [];
  }, [activeVaultId, notes, vaults]);

  const saveDirtyNotesNow = useCallbackA(async (entries, currentNotes = notes, currentVaults = vaults) => {
    if (!HAS_DISK || !entries?.length) return;
    for (const [id, vaultId] of entries) {
      const noteList = findNotesForVault(vaultId, currentNotes, currentVaults);
      const n = noteList.find(x => x.id === id);
      if (!n) continue;
      try {
        await window.mn.saveNote(vaultId, noteForDisk(n, mnBlocksToMd));
        setDirtyNotes(cur => {
          if (cur.get(id) !== vaultId) return cur;
          const next = new Map(cur);
          next.delete(id);
          return next;
        });
      } catch (e) {
        console.error('saveNote failed', id, e);
      }
    }
  }, [findNotesForVault, notes, vaults]);

  // ── Persist dirty notes (debounced) ────────────────────────────────────
  useEffectA(() => {
    if (!HAS_DISK || !dirtyNotes.size) return;
    const handle = setTimeout(async () => {
      await saveDirtyNotesNow([...dirtyNotes.entries()]);
    }, 500);
    return () => clearTimeout(handle);
  }, [dirtyNotes, saveDirtyNotesNow]);

  // ── Persist tags + lastSelectedId ──────────────────────────────────────
  useEffectA(() => {
    if (!HAS_DISK || !activeVaultId) return;
    if (!tagsDirty.current) return;
    saveVaultMetaNow(activeVaultId, tags, selectedId, true);
  }, [tags, activeVaultId, selectedId, saveVaultMetaNow]);

  useEffectA(() => {
    if (!HAS_DISK || !activeVaultId || !selectedId) return;
    const t = setTimeout(() => {
      saveVaultMetaNow(activeVaultId, tags, selectedId, false);
    }, 1000);
    return () => clearTimeout(t);
  }, [selectedId, activeVaultId, tags, saveVaultMetaNow]);

  // Listen for host tweak-mode messages (still supported)
  useEffectA(() => {
    const handler = (e) => {
      const msg = e.data || {};
      if (msg.type === '__activate_edit_mode') setSettingsOpen(true);
      if (msg.type === '__deactivate_edit_mode') setSettingsOpen(false);
    };
    window.addEventListener('message', handler);
    window.parent.postMessage({ type: '__edit_mode_available' }, '*');
    return () => window.removeEventListener('message', handler);
  }, []);

  const setTweak = (key, val) => {
    setTweaks(t => {
      const next = { ...t, [key]: val };
      window.parent.postMessage({ type: '__edit_mode_set_keys', edits: { [key]: val } }, '*');
      return next;
    });
  };

  const theme = tweaks.theme;
  const T = MN_THEMES[theme];
  const fonts = MN_FONTS[tweaks.fontChoice] || MN_FONTS['Editorial (Newsreader + Inter)'];
  const appScale = tweaks.appFontSize === 'small'
    ? 0.92
    : tweaks.appFontSize === 'large'
    ? 1.08
    : tweaks.appFontSize === 'x-large'
    ? 1.16
    : 1;

  useEffectA(() => {
    const root = document.documentElement;
    root.style.setProperty('--mn-ui', fonts.ui);
    root.style.setProperty('--mn-body', fonts.body);
    root.style.setProperty('--mn-mono', fonts.mono);
    root.style.setProperty('--mn-bg', T.bg);
    root.style.setProperty('--mn-app-font-size', tweaks.appFontSize === 'small' ? '12px' : tweaks.appFontSize === 'large' ? '14px' : tweaks.appFontSize === 'x-large' ? '15px' : '13px');
  }, [fonts, T, tweaks.appFontSize]);

  // ── Vault switching (lazy load from disk) ──────────────────────────────
  const selectVault = useCallbackA(async (id) => {
    if (id === activeVaultId) return;
    const pendingForCurrentVault = [...dirtyNotes.entries()].filter(([, vaultId]) => vaultId === activeVaultId);
    await saveDirtyNotesNow(pendingForCurrentVault, notes, vaults);
    await saveVaultMetaNow(activeVaultId, tags, selectedId, tagsDirty.current);
    // stash current vault's in-memory state into cache
    setVaults(vs => vs.map(v => v.id === activeVaultId
      ? { ...v, notes, tags, lastSelectedId: selectedId, canvases }
      : v));
    const target = vaults.find(v => v.id === id);
    if (!target) return;

    let targetNotes = target.notes, targetTags = target.tags, targetSel = target.lastSelectedId;
    let targetCanvases = target.canvases;
    if (!targetNotes && HAS_DISK) {
      try {
        const res = await window.mn.loadVault(id);
        if (res.ok) {
          targetNotes = normalizeNotes(res.value.notes, mnMdToBlocks);
          targetTags = res.value.tags || [];
          targetSel = res.value.lastSelectedId;
        }
      } catch (e) { console.error('loadVault failed', id, e); }
    }
    if (!targetCanvases && HAS_DISK) {
      try {
        const res = await window.mn.listCanvases(id);
        if (res.ok) targetCanvases = res.value || [];
      } catch (e) { console.error('listCanvases failed', id, e); }
    }
    targetNotes = targetNotes || [];
    targetTags = targetTags || [];
    targetCanvases = targetCanvases || [];
    setNotes(targetNotes);
    setTags(targetTags);
    setCanvases(targetCanvases);
    setActiveCanvas(null);
    setSelectedId(targetSel || targetNotes[0]?.id || null);
    setActiveVaultId(id);
    setSelectedTag(null); setSelectedWorkflow(null); navigateView('notes');
    if (HAS_DISK) window.mn.setPrefs({ activeVaultId: id });
  }, [activeVaultId, vaults, notes, tags, canvases, selectedId, dirtyNotes, saveDirtyNotesNow, saveVaultMetaNow, navigateView]);

  const createVault = useCallbackA(async (name) => {
    const pendingForCurrentVault = [...dirtyNotes.entries()].filter(([, vaultId]) => vaultId === activeVaultId);
    await saveDirtyNotesNow(pendingForCurrentVault, notes, vaults);
    await saveVaultMetaNow(activeVaultId, tags, selectedId, tagsDirty.current);
    if (!HAS_DISK) {
      // In-browser fallback (transient)
      const id = 'v_' + Date.now();
      const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
      const firstNoteId = 'n_' + Date.now();
      const newNotes = [{
        id: firstNoteId, title: 'Welcome to ' + name,
        date: new Date().toISOString(), tags: [], pinned: false,
        blocks: mnMdToBlocks(`- This is your new vault\n- Create notes with ⌘N`),
      }];
      const newCanvases = [];
      setVaults(vs => [
        ...vs.map(v => v.id === activeVaultId ? { ...v, notes, tags, lastSelectedId: selectedId, canvases } : v),
        { id, name, slug, path: `~/OminiNote/${slug}`, notes: null, tags: null, canvases: newCanvases },
      ]);
      setNotes(newNotes); setTags([]); setSelectedId(firstNoteId);
      setCanvases(newCanvases); setActiveCanvas(null);
      setActiveVaultId(id); setSelectedTag(null); setSelectedWorkflow(null); navigateView('notes');
      return;
    }
    try {
      const res = await window.mn.createVault(name);
      if (!res.ok) throw new Error(res.error);
      const v = res.value;
      // stash current
      setVaults(vs => [
        ...vs.map(x => x.id === activeVaultId ? { ...x, notes, tags, lastSelectedId: selectedId, canvases } : x),
        { ...v, notes: null, tags: null, canvases: [] },
      ]);
      // load the new vault from disk (it has the seeded welcome note)
      const loadRes = await window.mn.loadVault(v.id);
      if (!loadRes.ok) throw new Error(loadRes.error);
      const loaded = loadRes.value;
      const loadedNotes = normalizeNotes(loaded.notes, mnMdToBlocks);
      setNotes(loadedNotes); setTags(loaded.tags || []);
      setCanvases([]); setActiveCanvas(null);
      setSelectedId(loaded.lastSelectedId || loadedNotes[0]?.id || null);
      setActiveVaultId(v.id); setSelectedTag(null); setSelectedWorkflow(null); navigateView('notes');
      window.mn.setPrefs({ activeVaultId: v.id });
    } catch (e) {
      console.error('createVault failed', e); alert('Could not create vault: ' + e.message);
    }
  }, [activeVaultId, notes, vaults, tags, canvases, selectedId, dirtyNotes, saveDirtyNotesNow, saveVaultMetaNow, navigateView]);

  const renameVault = useCallbackA(async (id, name) => {
    setVaults(vs => vs.map(v => v.id === id ? { ...v, name } : v));
    if (HAS_DISK) {
      try { await window.mn.renameVault(id, name); }
      catch (e) { console.error('renameVault failed', e); }
    }
  }, []);

  const deleteVault = useCallbackA(async (id) => {
    const target = vaults.find(v => v.id === id);
    if (!target) return { ok: false, error: 'Vault not found.' };
    if (vaults.length <= 1) {
      return { ok: false, error: 'Create another vault before deleting this one.' };
    }

    const deletingActive = id === activeVaultId;
    const pendingToSave = [...dirtyNotes.entries()].filter(([, vaultId]) => vaultId !== id);
    await saveDirtyNotesNow(pendingToSave, notes, vaults);
    if (!deletingActive) await saveVaultMetaNow(activeVaultId, tags, selectedId, tagsDirty.current);

    const localRemaining = vaults.filter(v => v.id !== id);
    let nextVaults = localRemaining;
    let nextActiveId = deletingActive ? localRemaining[0]?.id : activeVaultId;

    if (HAS_DISK) {
      try {
        const res = await window.mn.deleteVault(id);
        if (!res.ok) throw new Error(res.error);
        nextVaults = (res.value?.vaults || localRemaining).map(meta => {
          const cached = localRemaining.find(v => v.id === meta.id) || {};
          return { ...meta, notes: cached.notes || null, tags: cached.tags || null, lastSelectedId: cached.lastSelectedId || null, canvases: cached.canvases || null };
        });
        nextActiveId = deletingActive ? (res.value?.activeVaultId || nextVaults[0]?.id) : activeVaultId;
      } catch (e) {
        console.error('deleteVault failed', e);
        return { ok: false, error: e.message || String(e) };
      }
    }

    setDirtyNotes(cur => {
      const next = new Map();
      cur.forEach((vaultId, noteId) => {
        if (vaultId !== id) next.set(noteId, vaultId);
      });
      return next;
    });

    if (!deletingActive) {
      setVaults(nextVaults);
      return { ok: true };
    }

    const nextMeta = nextVaults.find(v => v.id === nextActiveId) || nextVaults[0];
    if (!nextMeta) return { ok: false, error: 'No vault available after delete.' };

    let nextNotes = nextMeta.notes || [];
    let nextTags = nextMeta.tags || [];
    let nextCanvases = nextMeta.canvases || [];
    let nextSelectedId = nextMeta.lastSelectedId || null;
    if (HAS_DISK) {
      try {
        const loadRes = await window.mn.loadVault(nextMeta.id);
        if (!loadRes.ok) throw new Error(loadRes.error);
        const loaded = loadRes.value;
        nextNotes = normalizeNotes(loaded.notes, mnMdToBlocks);
        nextTags = loaded.tags || [];
        nextSelectedId = loaded.lastSelectedId || nextNotes[0]?.id || null;
        const canvasRes = await window.mn.listCanvases(nextMeta.id);
        nextCanvases = canvasRes.ok ? (canvasRes.value || []) : [];
      } catch (e) {
        console.error('loadVault after delete failed', e);
        return { ok: false, error: e.message || String(e) };
      }
    }

    setVaults(nextVaults.map(v => v.id === nextMeta.id
      ? { ...v, notes: nextNotes, tags: nextTags, lastSelectedId: nextSelectedId, canvases: nextCanvases }
      : v));
    setNotes(nextNotes);
    setTags(nextTags);
    setCanvases(nextCanvases);
    setActiveCanvas(null);
    setSelectedId(nextSelectedId || nextNotes[0]?.id || null);
    setActiveVaultId(nextMeta.id);
    setSelectedTag(null);
    setSelectedWorkflow(null);
    setQuery('');
    tagsDirty.current = false;
    navigateView('notes');
    if (HAS_DISK) window.mn.setPrefs({ activeVaultId: nextMeta.id });
    return { ok: true };
  }, [activeVaultId, vaults, notes, tags, selectedId, dirtyNotes, saveDirtyNotesNow, saveVaultMetaNow, navigateView, mnMdToBlocks]);

  const vaultsForSidebar = useMemoA(() => vaults.map(v => ({
    ...v,
    noteCount: v.id === activeVaultId ? notes.length : (v.notes?.length ?? 0),
    canvasCount: v.id === activeVaultId ? canvases.length : (v.canvases?.length ?? 0),
  })), [vaults, activeVaultId, notes, canvases]);
  const activeVault = useMemoA(() => vaults.find(v => v.id === activeVaultId) || null, [vaults, activeVaultId]);

  const sidebarHidden = tweaks.showSidebar === false;
  const setSidebarHidden = (v) => {
    const next = typeof v === 'function' ? v(sidebarHidden) : v;
    setTweak('showSidebar', !next);
  };
  const noteListHidden = tweaks.showNoteList === false;
  const setNoteListHidden = (v) => {
    const next = typeof v === 'function' ? v(noteListHidden) : v;
    setTweak('showNoteList', !next);
  };

  // Keep body (markdown) in sync for backlinks / search / save
  const notesWithBody = useMemoA(() => notes.map(n => ({
    ...n, body: mnBlocksToMd(n.blocks || []),
  })), [notes]);

  const links = useMemoA(() => buildLinks(notesWithBody), [notesWithBody]);
  const workflowStates = useMemoA(
    () => mnNormalizeWorkflowStatesForApp(tweaks.workflowStates),
    [tweaks.workflowStates]
  );
  useEffectA(() => {
    window.MN_LOGSEQ?.setWorkflowStates?.(workflowStates);
    if (selectedWorkflow && !workflowStates.some(s => s.id === selectedWorkflow)) {
      setSelectedWorkflow(null);
    }
  }, [workflowStates, selectedWorkflow]);
  const updateWorkflowStates = useCallbackA((states) => {
    setTweak('workflowStates', mnNormalizeWorkflowStatesForApp(states));
  }, []);
  const workflowData = useMemoA(
    () => collectWorkflowBlocks(notesWithBody, workflowStates, mnWalk),
    [notesWithBody, workflowStates, mnWalk]
  );

  const appStats = useMemoA(() => {
    let wordCount = 0, charCount = 0;
    notesWithBody.forEach(n => {
      const t = (n.body || '') + ' ' + (n.title || '');
      charCount += t.length;
      wordCount += t.trim().split(/\s+/).filter(Boolean).length;
    });
    return {
      noteCount: notesWithBody.length,
      tagCount: tags.length,
      linkCount: links.length,
      wordCount, charCount,
    };
  }, [notesWithBody, tags, links]);

  // SQLite-backed search: debounced IPC call returns matching IDs;
  // we intersect with in-memory notes for tag-filter compatibility.
  // searchHits = null  → no active query
  // searchHits = []    → query active but zero matches
  // searchHits = [...] → matched note ids in rank order
  const [searchHits, setSearchHits] = useStateA(null);
  useEffectA(() => {
    const q = query.trim();
    if (!q) { setSearchHits(null); return; }
    const activeVaultHasUnsaved = [...dirtyNotes.values()].some(vaultId => vaultId === activeVaultId);
    if (!HAS_DISK || !activeVaultId || activeVaultHasUnsaved) {
      // Browser fallback and dirty-note path: in-memory search reflects unsaved edits.
      const lc = q.toLowerCase();
      const ids = notesWithBody.filter(n =>
        n.title.toLowerCase().includes(lc) ||
        (n.body || '').toLowerCase().includes(lc) ||
        n.tags.some(t => t.toLowerCase().includes(lc))
      ).map(n => n.id);
      setSearchHits(ids);
      return;
    }
    const handle = setTimeout(async () => {
      try {
        const res = await window.mn.search(activeVaultId, q, 100);
        if (res.ok) setSearchHits(res.value.map(r => r.id));
      } catch (e) { console.error('search failed', e); }
    }, 150);
    return () => clearTimeout(handle);
  }, [query, activeVaultId, notesWithBody, dirtyNotes]);

  const filteredNotes = useMemoA(() => {
    let ns = [...notesWithBody];
    if (selectedTag) ns = ns.filter(n => n.tags.includes(selectedTag));
    if (selectedWorkflow) {
      const ids = workflowData.noteIdsByState[selectedWorkflow] || new Set();
      ns = ns.filter(n => ids.has(n.id));
    }
    if (searchHits != null) {
      const order = new Map(searchHits.map((id, i) => [id, i]));
      ns = ns.filter(n => order.has(n.id));
      // Preserve search rank order when querying; otherwise default sort
      ns.sort((a, b) => order.get(a.id) - order.get(b.id));
      return ns;
    }
    ns.sort((a, b) => {
      if (tweaks.pinnedFirst !== false) {
        if (a.pinned && !b.pinned) return -1;
        if (!a.pinned && b.pinned) return 1;
      }
      if ((tweaks.sortBy || 'modified') === 'title') {
        return String(a.title || '').localeCompare(String(b.title || ''), undefined, { sensitivity: 'base' });
      }
      if ((tweaks.sortBy || 'modified') === 'created') {
        return new Date(b.date || 0) - new Date(a.date || 0);
      }
      return new Date(b.modifiedAt || b.date || 0) - new Date(a.modifiedAt || a.date || 0);
    });
    return ns;
  }, [notesWithBody, selectedTag, selectedWorkflow, workflowData, searchHits, tweaks.sortBy, tweaks.pinnedFirst]);

  const workflowViewData = useMemoA(
    () => collectWorkflowBlocks(filteredNotes, workflowStates, mnWalk),
    [filteredNotes, workflowStates, mnWalk]
  );

  const selectedNote = notes.find(n => n.id === selectedId);
  const deleteTargetNote = deleteTargetId ? notes.find(n => n.id === deleteTargetId) : null;

  const reminderCenterItems = useMemoA(() => {
    const now = Date.now();
    const snoozed = mnReadSnoozedReminders();
    return mnCollectReminderItems(notesWithBody)
      .map(item => {
        const dueTime = item.remindAt?.at?.getTime?.() || 0;
        const snoozedUntil = Number(snoozed[item.key]) || 0;
        return {
          ...item,
          snoozedUntil,
          status: snoozedUntil > now ? 'snoozed' : dueTime <= now ? 'due' : 'upcoming',
        };
      })
      .sort((a, b) => {
        const rank = { due: 0, upcoming: 1, snoozed: 2 };
        const byRank = (rank[a.status] ?? 9) - (rank[b.status] ?? 9);
        if (byRank) return byRank;
        return (a.remindAt?.at || 0) - (b.remindAt?.at || 0);
      });
  }, [notesWithBody, toast]);

  const reminderDueCount = reminderCenterItems.filter(item =>
    item.status === 'due' && !dismissedReminderKeys.current.has(item.key)
  ).length;

  const createNote = useCallbackA(({ title = 'Untitled', body = '', tags: noteTags = [] } = {}) => {
    const id = 'n_' + Date.now().toString(36);
    const defaults = mnParseDefaultTags(tweaks.defaultTags);
    const cleanTags = [...noteTags, ...defaults]
      .map(normalizeTagName)
      .filter(Boolean)
      .filter((tag, index, arr) => arr.indexOf(tag) === index);
    const missingTags = cleanTags.filter(tag => !tags.some(t => t.name === tag));
    if (missingTags.length) {
      setTags(ts => {
        const existing = new Set(ts.map(t => t.name));
        const additions = missingTags
          .filter(name => !existing.has(name))
          .map(name => ({ name, hue: (Math.floor(Math.random() * 12) * 30) + 10 }));
        return additions.length ? [...ts, ...additions] : ts;
      });
      markTagsDirty();
    }
    const blocks = body ? mnMdToBlocks(body) : [mkBlock({ kind: 'paragraph', content: '' })];
    const newNote = {
      id, title, body, blocks, tags: cleanTags,
      date: new Date().toISOString(),
      modifiedAt: new Date().toISOString(),
    };
    setNotes(ns => [newNote, ...ns]);
    setSelectedId(id);
    navigateView('notes');
    markDirty(id);
    return id;
  }, [markDirty, navigateView, tweaks.defaultTags, tags]);

  const updateNote = (id, patch) => {
    setNotes(ns => ns.map(n => {
      if (n.id !== id) return n;
      const resolved = typeof patch === 'function' ? patch(n) : patch;
      return { ...n, ...resolved, modifiedAt: new Date().toISOString() };
    }));
    markDirty(id);
  };

  const updateNoteBlocks = useCallbackA((id, blocksOrUpdater) => {
    setNotes(ns => ns.map(n => {
      if (n.id !== id) return n;
      const prevBlocks = n.blocks || [];
      const nextBlocks = window.MN_EDITOR_OPS.resolveBlocksChange(prevBlocks, blocksOrUpdater);
      return { ...n, blocks: nextBlocks, modifiedAt: new Date().toISOString() };
    }));
    markDirty(id);
  }, [markDirty]);

  const toggleCheckFromAggregate = (it) => {
    if (it.isReminderOnly) return;
    const n = notes.find(x => x.id === it.noteId);
    if (!n) return;
    if (it.blockId) {
      const nextBlocks = mnCloneBlocks(n.blocks || []);
      const loc = mnLocate(nextBlocks, it.blockId);
      if (loc?.block?.kind === 'todo') {
        loc.block.checked = !loc.block.checked;
        updateNote(it.noteId, { blocks: nextBlocks });
      }
      return;
    }
    const target = it.text.trim();
    let changed = false;
    const walkMutate = (bs) => bs.map(b => {
      if (!changed && b.kind === 'todo' && b.content.trim() === target) {
        changed = true;
        return { ...b, checked: !b.checked, children: walkMutate(b.children) };
      }
      return { ...b, children: walkMutate(b.children) };
    });
    updateNote(it.noteId, { blocks: walkMutate(n.blocks || []) });
  };

  const updateWorkflowBlockState = useCallbackA((noteId, blockId, workflow) => {
    const n = notes.find(x => x.id === noteId);
    if (!n) return;
    const nextBlocks = mnCloneBlocks(n.blocks || []);
    const loc = mnLocate(nextBlocks, blockId);
    if (!loc) return;
    loc.block.workflow = workflow;
    updateNote(noteId, { blocks: nextBlocks });
  }, [notes, mnCloneBlocks, mnLocate]);

  const updateWorkflowArchived = useCallbackA((noteId, workflowArchived) => {
    updateNote(noteId, { workflowArchived: !!workflowArchived });
  }, [updateNote]);

  const updateNoteTags = useCallbackA((noteId, noteTags) => {
    updateNote(noteId, { tags: noteTags });
  }, [updateNote]);

  const addTag = (name) => {
    const clean = normalizeTagName(name);
    if (!clean) return null;
    if (tags.find(t => t.name === clean)) return clean;
    const hue = (Math.floor(Math.random() * 12) * 30) + 10;
    setTags(ts => ts.find(t => t.name === clean) ? ts : [...ts, { name: clean, hue }]);
    markTagsDirty();
    return clean;
  };

  const promptNewTag = (name) => {
    const raw = typeof name === 'string' ? name : window.prompt('New tag name (no spaces):', '');
    if (raw) addTag(raw);
  };

  const requestDeleteNote = (id) => {
    if (!notes.find(x => x.id === id)) return;
    setDeleteTargetId(id);
  };

  const deleteNote = async (id) => {
    const n = notes.find(x => x.id === id);
    if (!n) return;
    setDeleteTargetId(null);
    setDirtyNotes(cur => {
      if (!cur.has(id)) return cur;
      const next = new Map(cur);
      next.delete(id);
      return next;
    });
    setNotes(ns => ns.filter(x => x.id !== id));
    const rest = notes.filter(x => x.id !== id);
    setSelectedId(rest[0]?.id || null);
    if (HAS_DISK && activeVaultId) {
      try { await window.mn.deleteNote(activeVaultId, id); }
      catch (e) { console.error('deleteNote failed', e); }
    }
  };

  const summarizeCanvas = (canvas) => ({
    ...canvas,
    id: canvas.id,
    title: canvas.title || 'Untitled canvas',
    createdAt: canvas.createdAt,
    modifiedAt: canvas.modifiedAt,
    elementCount: (canvas.elements || []).length,
  });

  const upsertCanvasList = (list, canvas) => {
    const summary = summarizeCanvas(canvas);
    return [summary, ...(list || []).filter(c => c.id !== summary.id)]
      .sort((a, b) => new Date(b.modifiedAt || 0) - new Date(a.modifiedAt || 0));
  };

  const cacheCanvases = useCallbackA((nextCanvases) => {
    setCanvases(nextCanvases);
    setVaults(vs => vs.map(v => v.id === activeVaultId ? { ...v, canvases: nextCanvases } : v));
  }, [activeVaultId]);

  const upsertCanvasSummary = useCallbackA((canvas) => {
    setCanvases(cur => upsertCanvasList(cur, canvas));
    setVaults(vs => vs.map(v => v.id === activeVaultId
      ? { ...v, canvases: upsertCanvasList(v.canvases || [], canvas) }
      : v));
  }, [activeVaultId]);

  const openCanvasDashboard = useCallbackA(() => {
    setActiveCanvas(null);
    setSelectedTag(null);
    setSelectedWorkflow(null);
    setQuery('');
    navigateView('canvas');
  }, [navigateView]);

  const openCanvas = useCallbackA(async (canvasId) => {
    if (!canvasId) {
      openCanvasDashboard();
      return null;
    }
    let canvas = null;
    if (HAS_DISK && activeVaultId) {
      try {
        const res = await window.mn.getCanvas(activeVaultId, canvasId);
        if (!res.ok) throw new Error(res.error);
        canvas = res.value;
      } catch (e) {
        console.error('getCanvas failed', canvasId, e);
      }
    } else {
      canvas = canvases.find(c => c.id === canvasId) || null;
    }
    if (!canvas) return null;
    setActiveCanvas(canvas);
    setSelectedTag(null);
    setSelectedWorkflow(null);
    setQuery('');
    navigateView('canvas');
    return canvas;
  }, [activeVaultId, canvases, navigateView, openCanvasDashboard]);

  const createCanvas = useCallbackA(async (title = 'Untitled canvas', options = {}) => {
    const makeCanvas = window.mnNewCanvas || ((name) => ({
      id: `c_${Date.now().toString(36)}`,
      title: name,
      createdAt: new Date().toISOString(),
      modifiedAt: new Date().toISOString(),
      viewport: { x: 0, y: 0, scale: 1 },
      elements: [],
    }));
    const initial = makeCanvas(title);
    let saved = initial;
    if (HAS_DISK && activeVaultId) {
      try {
        const res = await window.mn.saveCanvas(activeVaultId, initial);
        if (!res.ok) throw new Error(res.error);
        saved = res.value;
      } catch (e) {
        console.error('saveCanvas failed', e);
        alert('Could not create canvas: ' + (e.message || String(e)));
        return null;
      }
    }
    upsertCanvasSummary(saved);
    if (options.open !== false) {
      setActiveCanvas(saved);
      setSelectedTag(null);
      setSelectedWorkflow(null);
      setQuery('');
      navigateView('canvas');
    }
    return saved;
  }, [activeVaultId, navigateView, upsertCanvasSummary]);

  const saveCanvas = useCallbackA(async (canvas) => {
    if (!canvas?.id) return null;
    let saved = canvas;
    if (HAS_DISK && activeVaultId) {
      try {
        const res = await window.mn.saveCanvas(activeVaultId, canvas);
        if (!res.ok) throw new Error(res.error);
        saved = res.value;
      } catch (e) {
        console.error('saveCanvas failed', canvas.id, e);
        return null;
      }
    }
    setActiveCanvas(saved);
    upsertCanvasSummary(saved);
    return saved;
  }, [activeVaultId, upsertCanvasSummary]);

  const deleteCanvas = useCallbackA(async (canvasId) => {
    if (!canvasId) return;
    if (HAS_DISK && activeVaultId) {
      try {
        const res = await window.mn.deleteCanvas(activeVaultId, canvasId);
        if (!res.ok) throw new Error(res.error);
      } catch (e) {
        console.error('deleteCanvas failed', canvasId, e);
        alert('Could not delete canvas: ' + (e.message || String(e)));
        return;
      }
    }
    const next = canvases.filter(c => c.id !== canvasId);
    cacheCanvases(next);
    if (activeCanvas?.id === canvasId) setActiveCanvas(null);
    navigateView('canvas');
  }, [activeVaultId, activeCanvas, canvases, cacheCanvases, navigateView]);

  useEffectA(() => {
    const h = (e) => {
      const isMod = e.metaKey || e.ctrlKey;
      const key = e.key || '';
      const lowerKey = key.toLowerCase();
      const isBackslashKey = key === '\\' || key === '|' || e.code === 'Backslash';
      if (isMod && e.shiftKey && lowerKey === 'n') {
        e.preventDefault(); setCaptureOpen(true);
      } else if (isMod && lowerKey === 'n' && !e.shiftKey) {
        e.preventDefault(); createNote();
      } else if (isMod && lowerKey === 'g') {
        e.preventDefault();
        navigateView(view === 'graph' ? 'notes' : 'graph');
        setSelectedTag(null); setSelectedWorkflow(null);
      } else if (isMod && lowerKey === 'k') {
        e.preventDefault(); setAskAiOpen(v => !v);
      } else if (isMod && e.shiftKey && isBackslashKey) {
        e.preventDefault(); setNoteListHidden(v => !v);
      } else if (isMod && isBackslashKey && !e.shiftKey) {
        e.preventDefault(); setSidebarHidden(v => !v);
      } else if (e.key === 'Escape') {
        setSettingsOpen(false); setAskAiOpen(false); setReminderCenterOpen(false);
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [createNote, view, navigateView]);

  // Runtime reminder scan over @remind directives in the active vault.
  useEffectA(() => {
    if (bootState !== 'ready') return;
    const check = () => {
      if (toast) return;
      const now = Date.now();
      const today = new Date().toDateString();
      const snoozed = mnReadSnoozedReminders();
      const due = mnCollectReminderItems(notesWithBody)
        .filter(item => {
          const dueTime = item.remindAt?.at?.getTime?.();
          if (!dueTime || dueTime > now) return false;
          if (tweaks.showOverdue === false && item.remindAt.at.toDateString() !== today) return false;
          if (dismissedReminderKeys.current.has(item.key)) return false;
          if ((Number(snoozed[item.key]) || 0) > now) return false;
          return true;
        })
        .sort((a, b) => a.remindAt.at - b.remindAt.at);
      if (!due.length) return;
      const next = due[0];
      setToast(next);
      if (tweaks.reminderSound === true) mnPlayReminderSound();
    };
    check();
    const tm = setInterval(check, 60000);
    return () => clearInterval(tm);
  }, [bootState, notesWithBody, tweaks.showOverdue, tweaks.reminderSound, toast]);

  // Push vault + selected note into the OS title bar
  useEffectA(() => {
    if (!HAS_DISK) return;
    const vname = vaults.find(v => v.id === activeVaultId)?.name;
    const nname = selectedNote?.title;
    const t = [vname, nname].filter(Boolean).join(' — ') || 'OminiNote';
    window.mn.setTitle(t === 'OminiNote' ? t : `${t} — OminiNote`);
  }, [activeVaultId, vaults, selectedNote]);

  const noteListVisible = view === 'notes' || view === 'graph' || view === 'workflow';
  const noteListTitle = query.trim()
    ? 'Search'
    : selectedTag
    ? `#${selectedTag}`
    : selectedWorkflow
    ? selectedWorkflow
    : (view === 'workflow' ? 'Workflow notes' : view === 'todos' ? 'Todos' : view === 'today' ? 'Daily rollup' : 'All notes');
  const noteListSubtitle = query.trim()
    ? `${filteredNotes.length} match${filteredNotes.length === 1 ? '' : 'es'}`
    : view === 'workflow'
    ? `${filteredNotes.length} note${filteredNotes.length === 1 ? '' : 's'} · ${workflowViewData.total} workflow item${workflowViewData.total === 1 ? '' : 's'}`
    : `${filteredNotes.length} note${filteredNotes.length === 1 ? '' : 's'}${selectedTag ? ' tagged' : selectedWorkflow ? ' with workflow' : ''}`;

  // ── Loading / error screens ─────────────────────────────────────────────
  if (bootState !== 'ready') {
    return <MnLaunchScreen state={bootState} error={bootError} T={T} />;
  }

  return (
    <div style={{
      width: `calc(100vw / ${appScale})`,
      height: `calc(100vh / ${appScale})`,
      background: T.bg, position: 'relative',
      fontFamily: 'var(--mn-ui)', overflow: 'hidden',
      fontSize: 'var(--mn-app-font-size)',
      transform: `scale(${appScale})`,
      transformOrigin: 'top left',
    }}>
        <div style={{ display: 'flex', height: '100%' }}>
          {!sidebarHidden && (
            <MnSidebar
              tags={tags} notes={notesWithBody}
              selectedTag={selectedTag}
              selectedWorkflow={selectedWorkflow}
              workflowStates={workflowStates}
              workflowCounts={workflowData.counts}
              workflowTotal={workflowData.total}
              onSelectTag={(t) => { setSelectedTag(t); setSelectedWorkflow(null); navigateView('notes'); }}
              onSelectWorkflow={(wf) => { setSelectedWorkflow(wf); setSelectedTag(null); navigateView('notes'); }}
              onOpenWorkflowPanel={() => { navigateView('workflow'); setSelectedTag(null); setSelectedWorkflow(null); }}
              onOpenTodos={() => { navigateView('todos'); setSelectedTag(null); setSelectedWorkflow(null); }}
              onOpenToday={() => { navigateView('today'); setSelectedTag(null); setSelectedWorkflow(null); }}
              onOpenGraph={() => { navigateView('graph'); setSelectedTag(null); setSelectedWorkflow(null); }}
              onOpenCanvas={openCanvasDashboard}
              onOpenAskAI={HAS_DISK ? () => setAskAiOpen(true) : null}
              todayActive={view === 'today'}
              todosActive={view === 'todos'}
              graphActive={view === 'graph'}
              workflowActive={view === 'workflow'}
              canvasActive={view === 'canvas'}
              canvasCount={canvases.length}
              onNewTag={promptNewTag}
              onNew={() => setCaptureOpen(true)}
              onOpenSettings={() => setSettingsOpen(true)}
              onCollapse={() => setSidebarHidden(true)}
              vaults={vaultsForSidebar}
              activeVaultId={activeVaultId}
              onSelectVault={selectVault}
              onCreateVault={createVault}
              onRenameVault={renameVault}
              T={T} density={tweaks.density} theme={theme}
            />
          )}

          {!sidebarHidden && (
            <MnPanelGrip side="sidebar" onCollapse={() => setSidebarHidden(true)} T={T} />
          )}
          {sidebarHidden && (
            <MnPanelGripPeek onExpand={() => setSidebarHidden(false)} T={T} title="Show sidebar" />
          )}

          {noteListVisible && !noteListHidden && (
            <MnNoteList
              notes={filteredNotes}
              selectedId={selectedId}
              onSelect={(id) => {
                setSelectedId(id);
                if (view === 'notes') return;
              }}
              title={noteListTitle}
              subtitle={noteListSubtitle}
              query={query}
              onQueryChange={setQuery}
              tags={tags} theme={theme} density={tweaks.density} T={T}
            />
          )}

          {noteListVisible && !noteListHidden && (
            <MnPanelGrip side="notelist" onCollapse={() => setNoteListHidden(true)} T={T} />
          )}
          {noteListVisible && noteListHidden && (
            <MnPanelGripPeek onExpand={() => setNoteListHidden(false)} T={T} title="Show note list" />
          )}

          {view === 'notes' && selectedNote && (
            <MnEditor
              note={selectedNote} notes={notesWithBody} tags={tags} links={links}
              vaultId={activeVaultId}
              canvases={canvases}
              onOpenCanvas={openCanvas}
              onCreateCanvas={createCanvas}
              onOpen={(id) => { setSelectedId(id); navigateView('notes'); }}
              onOpenTag={(t) => {
                if (!tags.find(x => x.name === t)) addTag(t);
                setSelectedTag(t); setSelectedWorkflow(null); navigateView('notes');
              }}
              onBlocksChange={(blocks) => updateNoteBlocks(selectedNote.id, blocks)}
              onTitleChange={(title) => updateNote(selectedNote.id, { title })}
              onAddTag={(t) => updateNote(selectedNote.id, { tags: [...selectedNote.tags, t] })}
              onCreateTag={(raw) => {
                const name = addTag(raw);
                if (name && !selectedNote.tags.includes(name)) {
                  updateNote(selectedNote.id, { tags: [...selectedNote.tags, name] });
                }
              }}
              onRemoveTag={(t) => updateNote(selectedNote.id, { tags: selectedNote.tags.filter(x => x !== t) })}
              onPinToggle={() => updateNote(selectedNote.id, { pinned: !selectedNote.pinned })}
              onDelete={() => requestDeleteNote(selectedNote.id)}
              onOpenGraph={() => { navigateView('graph'); setSelectedTag(null); setSelectedWorkflow(null); }}
              onBack={goBackView}
              onToggleSidebar={() => setSidebarHidden(v => !v)}
              sidebarHidden={sidebarHidden}
              onToggleNoteList={() => setNoteListHidden(v => !v)}
              noteListHidden={noteListHidden}
              editorWidth={tweaks.editorWidth}
              fontSize={tweaks.fontSize}
              indentGuides={tweaks.indentGuides !== false}
              spellCheck={tweaks.spellCheck !== false}
              autoLink={tweaks.autoLink !== false}
              collapseByDefault={tweaks.collapseByDefault === true}
              theme={theme} T={T}
            />
          )}

          {view === 'graph' && (
            <MnGraph
              notes={filteredNotes} links={links} tags={tags}
              focusId={selectedId}
              style={tweaks.graphStyle}
              onOpen={(id) => { setSelectedId(id); navigateView('notes'); }}
              T={T}
            />
          )}

          {view === 'todos' && (
            <MnTodosPanel
              notes={notesWithBody} tags={tags}
              onOpen={(id) => { setSelectedId(id); navigateView('notes'); }}
              onToggleCheck={toggleCheckFromAggregate}
              T={T} theme={theme} variant={tweaks.todoVariant}
            />
          )}
          {view === 'workflow' && (
            <MnWorkflowPanel
              notes={notesWithBody}
              tags={tags}
              workflowStates={workflowStates}
              workflowItems={workflowViewData.byState}
              archivedNotes={workflowViewData.archivedNotes}
              onWorkflowStatesChange={updateWorkflowStates}
              onOpen={(id) => { setSelectedId(id); navigateView('notes'); }}
              onSetWorkflow={updateWorkflowBlockState}
              onSetWorkflowArchived={updateWorkflowArchived}
              onSetNoteTags={updateNoteTags}
              T={T} theme={theme}
            />
          )}
          {view === 'today' && (
            <MnTodayPanel
              notes={notesWithBody} tags={tags}
              onOpen={(id) => { setSelectedId(id); navigateView('notes'); }}
              rollupFormat={tweaks.rollupFormat || 'long'}
              T={T} theme={theme}
            />
          )}
          {view === 'canvas' && (
            <MnCanvasPanel
              canvases={canvases}
              activeCanvas={activeCanvas}
              onCreate={createCanvas}
              onOpen={openCanvas}
              onBack={openCanvasDashboard}
              onSave={saveCanvas}
              onDelete={deleteCanvas}
              T={T}
            />
          )}
        </div>

        {captureOpen && (
          <MnQuickCapture
            tags={tags}
            onClose={() => setCaptureOpen(false)}
            onSave={({ title, body, tags: noteTags }) => {
              createNote({ title, body, tags: noteTags });
              setCaptureOpen(false);
            }}
            T={T} theme={theme}
          />
        )}
        <MnReminderToast
          toast={toast}
          onDismiss={() => {
            if (toast?.key) dismissedReminderKeys.current.add(toast.key);
            setToast(null);
          }}
          onSnooze={() => {
            if (toast?.key) {
              const minutes = Number(tweaks.snoozeMinutes || 15) || 15;
              mnWriteSnoozedReminder(toast.key, Date.now() + minutes * 60000);
            }
            setToast(null);
          }}
          onOpen={(id) => {
            if (toast?.key) dismissedReminderKeys.current.add(toast.key);
            setSelectedId(id); navigateView('notes'); setToast(null);
          }}
          T={T} variant={tweaks.toastVariant}
        />

        <MnReminderCenter
          open={reminderCenterOpen}
          items={reminderCenterItems}
          dueCount={reminderDueCount}
          onToggle={() => setReminderCenterOpen(v => !v)}
          onClose={() => setReminderCenterOpen(false)}
          onOpenNote={(item) => {
            if (item?.key && item.status === 'due') dismissedReminderKeys.current.add(item.key);
            setSelectedId(item.noteId);
            navigateView('notes');
            setReminderCenterOpen(false);
            if (toast?.key === item?.key) setToast(null);
          }}
          T={T}
        />

        {/* FAB */}
        <button onClick={() => setCaptureOpen(true)} title="Quick capture (⌘⇧N)"
          style={{
            position: 'absolute', bottom: 22, right: 22, zIndex: 20,
            width: 44, height: 44, borderRadius: '50%', cursor: 'pointer',
            background: T.ink, color: T.bg, border: 'none',
            boxShadow: `0 8px 24px color-mix(in oklab, ${T.ink} 30%, transparent)`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7">
            <path d="M8 3V13M3 8H13" strokeLinecap="round"/>
          </svg>
        </button>

        {settingsOpen && (
          <MnSettingsModal tweaks={tweaks} setTweak={setTweak} T={T}
            stats={appStats}
            vaults={vaultsForSidebar}
            activeVaultId={activeVaultId}
            activeVault={activeVault}
            onCreateVault={createVault}
            onDeleteVault={deleteVault}
            onClose={() => setSettingsOpen(false)} />
        )}
        {deleteTargetNote && (
          <MnDeleteNoteDialog
            note={deleteTargetNote}
            T={T}
            onCancel={() => setDeleteTargetId(null)}
            onConfirm={() => deleteNote(deleteTargetNote.id)}
          />
        )}
        {askAiOpen && (
          <MnAskAI
            vaultId={activeVaultId}
            currentNote={selectedNote ? { ...selectedNote, body: mnBlocksToMd(selectedNote.blocks || []) } : null}
            allNotes={notesWithBody}
            onClose={() => setAskAiOpen(false)}
            onOpenNote={(id) => { setSelectedId(id); navigateView('notes'); }}
            onCreateNote={({ title, body, tags: noteTags }) => createNote({ title, body, tags: noteTags || [] })}
            onApplyCurrentPageBody={(body) => {
              if (!selectedNote) return;
              updateNote(selectedNote.id, { body, blocks: mnMdToBlocks(body) });
            }}
            T={T} />
        )}
    </div>
  );
}

window.MnApp = MnApp;
