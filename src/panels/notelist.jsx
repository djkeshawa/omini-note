// Middle pane: list of notes (filtered). Click to select.
import { MN_DEFAULT_WORKFLOW_STATES, MN_WORKFLOW_STATES } from '../editor/blockFeatures.jsx';
import { mnGetTagColor } from '../shared/theme.jsx';
import { DS_RADIUS, dsButtonStyle, dsMachineStyle, dsPaneWidth } from '../shared/designSystem.js';
import { DsEmptyState } from '../shared/components/DesignPrimitives.jsx';

const { useMemo: useMemoL, useState: useStateL, useEffect: useEffectL } = React;

function mnFormatDate(iso) {
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const yest = new Date(now); yest.setDate(now.getDate() - 1);
  const sameYest = d.toDateString() === yest.toDateString();
  if (sameDay) return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (sameYest) return 'Yesterday';
  if (now - d < 7 * 864e5) return d.toLocaleDateString([], { weekday: 'short' });
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function mnPreview(body) {
  // Strip markdown, take first ~90 chars of content after title-like heading
  let s = body
    .replace(/^#{1,4}\s+.*/gm, '')
    .replace(/\[\[([^\]]+)\]\]/g, '$1')
    .replace(/[`*>#]/g, '')
    .replace(/-\s+\[[ xX]\]/g, '✓')
    .replace(/-\s+/g, '')
    .replace(/@remind\s+\S+\s*\S*/g, '')
    .trim()
    .replace(/\s+/g, ' ');
  return s.slice(0, 120);
}

// mnSnippet runs once per visible note row per render; cache the workflow
// regex so the escape/sort/compile work happens only when the states change.
let mnWorkflowRegexCache = { states: null, regex: null };

function mnWorkflowRegex() {
  const states = MN_WORKFLOW_STATES || MN_DEFAULT_WORKFLOW_STATES || [];
  if (mnWorkflowRegexCache.states === states) return mnWorkflowRegexCache.regex;
  const workflowPattern = states
    .map(s => s.id)
    .filter(Boolean)
    .sort((a, b) => b.length - a.length)
    .map(id => id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('|');
  const regex = workflowPattern ? new RegExp(`^(${workflowPattern})\\s+`, 'gm') : null;
  mnWorkflowRegexCache = { states, regex };
  return regex;
}

function mnSnippet(body, query) {
  const plain = body
    .split('\n')
    .filter(l => !/^[a-zA-Z][a-zA-Z0-9_-]*::\s/.test(l))  // skip page properties
    .join('\n')
    .replace(/\{\{embed\s+[^}]+\}\}/g, '')                  // skip embeds
    .replace(/\(\([A-Za-z0-9_-]+\)\)/g, '')                 // skip block refs
    .replace(/\[\[([^\]]+)\]\]/g, '$1')
    .replace(/[`*>#]/g, '')
    .replace(/-\s+\[[ xX]\]/g, '✓')
    .replace(/-\s+/g, '')
    .replace(/@remind\s+\S+\s*\S*/g, '')
    .replace(mnWorkflowRegex() || /$^/, '')
    .trim().replace(/\s+/g, ' ');
  if (!query) return plain.slice(0, 140);
  const idx = plain.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return plain.slice(0, 140);
  const start = Math.max(0, idx - 40);
  const end = Math.min(plain.length, idx + query.length + 100);
  return (start > 0 ? '…' : '') + plain.slice(start, end) + (end < plain.length ? '…' : '');
}

function mnHighlight(text, query, T) {
  if (!query) return text;
  const parts = [];
  const qLower = query.toLowerCase();
  const tLower = text.toLowerCase();
  let i = 0;
  while (i < text.length) {
    const idx = tLower.indexOf(qLower, i);
    if (idx === -1) { parts.push(text.slice(i)); break; }
    if (idx > i) parts.push(text.slice(i, idx));
    parts.push(React.createElement('mark', {
      key: idx,
      style: {
        background: `color-mix(in oklab, ${T.accent} 25%, transparent)`,
        color: T.ink, padding: '0 2px', borderRadius: 2,
      }
    }, text.slice(idx, idx + query.length)));
    i = idx + query.length;
  }
  return parts;
}

function MnNoteList({
  notes, selectedId, onSelect, title, subtitle,
  query, onQueryChange,
  novelistStructure = null,
  allNotes = null,
  onRenameNote,
  onDuplicateNote,
  onDeleteNote,
  onCreateNote = null,
  onAddToCanvas = null,
  onOpenReference = null,
  tags, theme, density, T,
}) {
  const [collapsed, setCollapsed] = useStateL({});
  const [menu, setMenu] = useStateL(null);
  const [renameId, setRenameId] = useStateL(null);
  const [renameValue, setRenameValue] = useStateL('');
  const [visibleLimit, setVisibleLimit] = useStateL(160);
  const tagHue = useMemoL(() => {
    const m = {}; tags.forEach(t => m[t.name] = t.hue); return m;
  }, [tags]);
  const novelistList = useMemoL(() => {
    if (!novelistStructure) return null;
    const sourceNotes = allNotes || notes || [];
    const noteById = new Map(sourceNotes.map(note => [note.id, note]));
    const visibleIds = new Set((notes || []).map(note => note.id));
    const used = new Set();
    const acts = (novelistStructure.acts || []).filter(note => visibleIds.has(note.id));
    const chapterIdsByAct = {};
    const sceneIdsByChapter = {};
    const addUnique = (bucket, parentId, childId) => {
      if (!parentId || !childId) return;
      if (!bucket[parentId]) bucket[parentId] = [];
      if (!bucket[parentId].includes(childId)) bucket[parentId].push(childId);
    };
    Object.entries(novelistStructure.childrenByActId || {}).forEach(([actId, chapterIds]) => {
      (chapterIds || []).forEach(chapterId => addUnique(chapterIdsByAct, actId, chapterId));
    });
    Object.entries(novelistStructure.parentByChapterId || {}).forEach(([chapterId, actId]) => {
      addUnique(chapterIdsByAct, actId, chapterId);
    });
    Object.entries(novelistStructure.childrenByChapterId || {}).forEach(([chapterId, sceneIds]) => {
      (sceneIds || []).forEach(sceneId => addUnique(sceneIdsByChapter, chapterId, sceneId));
    });
    Object.entries(novelistStructure.parentBySceneId || {}).forEach(([sceneId, chapterId]) => {
      addUnique(sceneIdsByChapter, chapterId, sceneId);
    });
    const chapterIds = new Set((novelistStructure.chapters || []).map(note => note.id));
    const sceneIds = new Set((novelistStructure.scenes || []).map(note => note.id));
    const chaptersForAct = (act) => (chapterIdsByAct[act.id] || [])
      .map(id => noteById.get(id))
      .filter(note => note && chapterIds.has(note.id) && visibleIds.has(note.id));
    const scenesForChapter = (chapter) => (sceneIdsByChapter[chapter.id] || [])
      .map(id => noteById.get(id))
      .filter(note => note && sceneIds.has(note.id) && visibleIds.has(note.id));
    acts.forEach(act => {
      used.add(act.id);
      chaptersForAct(act).forEach(chapter => {
        used.add(chapter.id);
        scenesForChapter(chapter).forEach(scene => used.add(scene.id));
      });
    });
    const looseChapters = (novelistStructure.chapters || [])
      .filter(note => visibleIds.has(note.id) && !used.has(note.id));
    looseChapters.forEach(chapter => {
      used.add(chapter.id);
      scenesForChapter(chapter).forEach(scene => used.add(scene.id));
    });
    const looseScenes = (novelistStructure.scenes || [])
      .filter(note => visibleIds.has(note.id) && !used.has(note.id));
    looseScenes.forEach(scene => used.add(scene.id));
    const other = (notes || []).filter(note => !used.has(note.id));
    return { acts, looseChapters, looseScenes, chaptersForAct, scenesForChapter, other };
  }, [notes, allNotes, novelistStructure]);

  useEffectL(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', onKey);
    };
  }, [menu]);

  useEffectL(() => { setVisibleLimit(160); }, [notes.length, query]);
  const visibleNotes = novelistStructure ? notes : (notes || []).slice(0, visibleLimit);

  const startRename = (note) => {
    if (!note) return;
    setMenu(null);
    setRenameId(note.id);
    setRenameValue(note.title || 'Untitled');
    onSelect(note.id);
  };

  const submitRename = () => {
    const title = renameValue.trim();
    if (renameId && title) onRenameNote && onRenameNote(renameId, title);
    setRenameId(null);
    setRenameValue('');
  };

  const NoteRow = ({ n, depth = 0, compact = false, meta = '' }) => {
    const active = n.id === selectedId;
    const isRenaming = renameId === n.id;
    return (
      <div
        key={n.id}
        data-mn-note-row="true"
        data-mn-note-row-active={active ? 'true' : 'false'}
        role="option"
        aria-selected={active}
        tabIndex={0}
        draggable
        onDragStart={(e) => {
          const payload = JSON.stringify({ noteId: n.id });
          e.dataTransfer.setData('text/mn-note', payload);
          e.dataTransfer.setData('text/plain', `mn-note:${n.id}`);
          e.dataTransfer.effectAllowed = 'copyMove';
        }}
        onClick={() => { if (!isRenaming) onSelect(n.id); }}
        onKeyDown={(e) => {
          if (!isRenaming && (e.key === 'Enter' || e.key === ' ')) {
            e.preventDefault();
            onSelect(n.id);
          }
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setMenu({ x: e.clientX, y: e.clientY, note: n });
        }}
        style={{
          padding: density === 'compact' || compact ? '8px 11px' : '10px 12px',
          paddingLeft: 12 + depth * 16,
          margin: '0 0 2px',
          border: `1px solid ${active ? T.selLine : 'transparent'}`,
          borderRadius: DS_RADIUS.row,
          cursor: 'pointer',
          background: active ? (T.bgElevated || T.bg) : 'transparent',
          position: 'relative',
          boxShadow: active ? `0 2px 8px color-mix(in oklab, ${T.ink} 6%, transparent)` : 'none',
          transition: 'background 100ms ease',
        }}
        onMouseEnter={e => !active && (e.currentTarget.style.background = T.bgHover)}
        onMouseLeave={e => !active && (e.currentTarget.style.background = 'transparent')}>
        {active && (
          <span style={{
            position: 'absolute', left: 0, top: 12, bottom: 12,
            width: 2.5, borderRadius: '0 2px 2px 0', background: T.accent,
          }} />
        )}
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
          {n.pinned && (
            <svg width="9" height="9" viewBox="0 0 10 10" fill={T.accent}>
              <circle cx="5" cy="5" r="3" />
            </svg>
          )}
          {isRenaming ? (
            <input
              autoFocus
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onClick={(e) => e.stopPropagation()}
              onBlur={submitRename}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { e.preventDefault(); submitRename(); }
                if (e.key === 'Escape') {
                  e.preventDefault();
                  setRenameId(null);
                  setRenameValue('');
                }
              }}
              style={{
                flex: 1,
                minWidth: 0,
                border: `1px solid ${T.accent}`,
                borderRadius: 5,
                background: T.bg,
                color: T.ink,
                padding: '4px 6px',
                outline: 'none',
                fontFamily: 'var(--mn-ui)',
                fontSize: 13,
                fontWeight: 600,
              }}
            />
          ) : (
            <div style={{
              flex: 1, fontFamily: 'var(--mn-ui)',
              fontSize: 13.5, fontWeight: depth ? 500 : 600,
              color: T.ink, letterSpacing: 0,
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>{mnHighlight(n.title, query, T)}</div>
          )}
          <div style={{
            fontFamily: 'var(--mn-mono)', fontSize: 10, color: T.inkDim,
            flexShrink: 0,
          }}>{mnFormatDate(n.date)}</div>
        </div>
        {density !== 'compact' && !compact && (
          <div style={{
            fontFamily: 'var(--mn-body)', fontSize: 13,
            color: T.inkMed, lineHeight: 1.5,
            marginTop: 3, display: '-webkit-box',
            WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
          }}>{mnHighlight(String(n.__searchSnippet || '').replace(/<\/?mark>/g, '') || mnSnippet(n.body, query), query, T)}</div>
        )}
        {!compact && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 7, flexWrap: 'wrap' }}>
            {query && Array.isArray(n.__matchedFields) && n.__matchedFields.length > 0 && (
              <span style={{
                fontFamily: 'var(--mn-ui)', fontSize: 11, color: T.accent,
              }}>{n.__matchedFields.join(', ')}</span>
            )}
            {(n.tags || []).map(t => (
              <React.Fragment key={t}>
                <span style={{
                  width: 6, height: 6, borderRadius: '50%', flexShrink: 0,
                  background: mnGetTagColor(tagHue[t] ?? 240, theme),
                }} />
                <span style={{
                  fontFamily: 'var(--mn-ui)', fontSize: 11,
                  color: active ? T.inkMed : T.inkDim,
                }}>{t}</span>
              </React.Fragment>
            ))}
          </div>
        )}
        {meta && (
          <div style={{
            marginTop: compact ? 2 : 5,
            fontFamily: 'var(--mn-ui)',
            fontSize: 11.5,
            color: T.inkDim,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}>{meta}</div>
        )}
      </div>
    );
  };

  const GroupHeader = ({ note, depth = 0, count = 0, type = '', linkedTo = '' }) => {
    const isCollapsed = collapsed[note.id] === true;
    const toggle = () => setCollapsed(current => ({ ...current, [note.id]: !isCollapsed }));
    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 7,
        padding: density === 'compact' ? '8px 14px' : '10px 16px',
        paddingLeft: 16 + depth * 16,
        borderBottom: `1px solid ${T.lineSub}`,
        background: note.id === selectedId ? T.selBg : T.bgSub,
        cursor: 'pointer',
      }}
      onClick={toggle}>
        <button
          onClick={(e) => {
            e.stopPropagation();
            toggle();
          }}
          title={isCollapsed ? 'Expand' : 'Collapse'}
          style={{
            width: 22,
            height: 22,
            borderRadius: 5,
            border: `1px solid ${T.lineSub}`,
            background: T.bg,
            color: T.inkDim,
            cursor: 'pointer',
            padding: 0,
            flexShrink: 0,
          }}>
          {isCollapsed ? '+' : '−'}
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onSelect(note.id);
          }}
          style={{
            minWidth: 0,
            flex: 1,
            border: 'none',
            background: 'transparent',
            padding: 0,
            color: T.ink,
            cursor: 'pointer',
            textAlign: 'left',
            fontFamily: 'var(--mn-ui)',
          }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 7 }}>
            <span style={{
              minWidth: 0,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              fontSize: 13,
              fontWeight: 650,
            }}>{note.title || 'Untitled'}</span>
            {type && (
              <span style={{
                fontFamily: 'var(--mn-ui)', fontWeight: 600,
                fontSize: 11,
                color: T.inkDim,
              }}>{type}</span>
            )}
            <span style={{ fontFamily: 'var(--mn-mono)', fontSize: 9.5, color: T.inkDim }}>{count}</span>
          </div>
          {linkedTo && (
            <div style={{
              marginTop: 3,
              fontFamily: 'var(--mn-ui)',
              fontSize: 11,
              color: T.inkDim,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}>{linkedTo}</div>
          )}
        </button>
      </div>
    );
  };

  const CollectionHeader = ({ id, label, count, depth = 0 }) => {
    const isCollapsed = collapsed[id] === true;
    const toggle = () => setCollapsed(current => ({ ...current, [id]: !isCollapsed }));
    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 7,
        padding: density === 'compact' ? '8px 14px' : '10px 16px',
        paddingLeft: 16 + depth * 16,
        borderBottom: `1px solid ${T.lineSub}`,
        background: T.bgSub,
        cursor: 'pointer',
      }}
      onClick={toggle}>
        <button
          onClick={(e) => {
            e.stopPropagation();
            toggle();
          }}
          title={isCollapsed ? 'Expand' : 'Collapse'}
          style={{
            width: 22,
            height: 22,
            borderRadius: 5,
            border: `1px solid ${T.lineSub}`,
            background: T.bg,
            color: T.inkDim,
            cursor: 'pointer',
            padding: 0,
            flexShrink: 0,
          }}>
          {isCollapsed ? '+' : '−'}
        </button>
        <div style={{
          minWidth: 0,
          flex: 1,
          display: 'flex',
          alignItems: 'baseline',
          gap: 7,
          fontFamily: 'var(--mn-ui)',
          color: T.ink,
        }}>
          <span style={{ fontSize: 13, fontWeight: 650 }}>{label}</span>
          <span style={{ fontFamily: 'var(--mn-mono)', fontSize: 9.5, color: T.inkDim }}>{count}</span>
        </div>
      </div>
    );
  };

  return (
    <div style={{
      width: dsPaneWidth('noteList', density), height: '100%',
      background: T.bgSub,
      borderRight: `1px solid ${T.line}`,
      display: 'flex', flexDirection: 'column', flexShrink: 0,
    }}>
      {/* Header */}
      <div style={{
        padding: '16px 14px 12px', background: T.bgSub,
        display: 'flex', flexDirection: 'column', gap: 12,
      }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
          <div style={{
            fontFamily: 'var(--mn-ui)', fontSize: 17, fontWeight: 600,
            color: T.ink, letterSpacing: '-0.01em',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>{title}</div>
          <div style={{ ...dsMachineStyle(T), flex: 1 }}>{subtitle}</div>
        </div>

        {/* Search */}
        <div style={{
          position: 'relative', height: 34,
          display: 'flex', alignItems: 'center',
          background: T.bg, borderRadius: 9,
          border: `1px solid ${query ? T.selLine : T.lineSub}`,
          transition: 'border 120ms',
        }}>
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke={T.inkDim} strokeWidth="1.4"
            style={{ position: 'absolute', left: 9, pointerEvents: 'none' }}>
            <circle cx="7" cy="7" r="4"/>
            <path d="M10 10L13.5 13.5" strokeLinecap="round"/>
          </svg>
          <input
            value={query || ''}
            onChange={(e) => onQueryChange(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Escape') onQueryChange(''); }}
            aria-label="Search note contents"
            placeholder="Filter this list"
            style={{
              flex: 1, border: 'none', outline: 'none', background: 'transparent',
              padding: '0 26px 0 28px', height: '100%',
              fontFamily: 'var(--mn-ui)', fontSize: 12.5, color: T.ink,
            }}
          />
          {query && (
            <button onClick={() => onQueryChange('')} title="Clear (Esc)" style={{
              position: 'absolute', right: 5,
              width: 18, height: 18, borderRadius: 4,
              background: 'transparent', border: 'none', color: T.inkDim,
              cursor: 'pointer', padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <svg width="9" height="9" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.4">
                <path d="M2 2L8 8M8 2L2 8" strokeLinecap="round"/>
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* List */}
      <div role="listbox" aria-label={`${title} notes`} style={{ flex: 1, overflow: 'auto', padding: '5px 0 12px' }}>
        {notes.length === 0 && (query ? (
          <DsEmptyState
            T={T}
            icon={(
              <svg width="17" height="17" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.35" aria-hidden="true">
                <circle cx="7" cy="7" r="4.2" /><path d="M10.2 10.2L13.5 13.5" strokeLinecap="round" />
              </svg>
            )}
            headline={`No notes match “${query}”`}
            body="Search covers titles, body text and tags in this vault only."
            action={(
              <button onClick={() => onQueryChange('')} style={dsButtonStyle(T)}>Clear search</button>
            )}
          />
        ) : (
          <DsEmptyState
            T={T}
            icon={(
              <svg width="17" height="17" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.35" aria-hidden="true">
                <rect x="3" y="2.5" width="10" height="11" rx="1.5" /><path d="M5.5 6h5M5.5 8.5h5M5.5 11h3" strokeLinecap="round" />
              </svg>
            )}
            headline="No notes yet"
            body="Notes are markdown files on disk. Anything you write here stays readable without the app."
            action={onCreateNote ? (
              <button onClick={() => onCreateNote()} style={{
                ...dsButtonStyle(T, 'default', { height: 30 }),
                background: T.accentSoft, borderColor: T.selLine, color: T.accent,
              }}>New note</button>
            ) : null}
          />
        ))}
        {novelistList ? (
          <>
            {novelistList.acts.map(act => {
              const chapters = novelistList.chaptersForAct(act);
              const actCollapsed = collapsed[act.id] === true;
              return (
                <React.Fragment key={act.id}>
                  <GroupHeader note={act} count={chapters.length} type="act" />
                  {!actCollapsed && chapters.map(chapter => {
                    const scenes = novelistList.scenesForChapter(chapter);
                    const chapterCollapsed = collapsed[chapter.id] === true;
                    return (
                      <React.Fragment key={chapter.id}>
                        <GroupHeader note={chapter} depth={1} count={scenes.length} type="chapter" linkedTo={`Linked to ${act.title || 'act'}`} />
                        {!chapterCollapsed && scenes.map(scene => <NoteRow key={scene.id} n={scene} depth={2} compact meta={`Linked to ${chapter.title || 'chapter'}`} />)}
                      </React.Fragment>
                    );
                  })}
                </React.Fragment>
              );
            })}
            {novelistList.looseChapters.length > 0 && (
              <>
                <CollectionHeader id="mn-loose-chapters" label="Unlinked chapters" count={novelistList.looseChapters.length} />
                {collapsed['mn-loose-chapters'] !== true && novelistList.looseChapters.map(chapter => {
                  const scenes = novelistList.scenesForChapter(chapter);
                  const chapterCollapsed = collapsed[chapter.id] === true;
                  return (
                    <React.Fragment key={chapter.id}>
                      <GroupHeader note={chapter} depth={1} count={scenes.length} type="chapter" />
                      {!chapterCollapsed && scenes.map(scene => <NoteRow key={scene.id} n={scene} depth={2} compact meta={`Linked to ${chapter.title || 'chapter'}`} />)}
                    </React.Fragment>
                  );
                })}
              </>
            )}
            {novelistList.looseScenes.length > 0 && (
              <>
                <CollectionHeader id="mn-loose-scenes" label="Unlinked scenes" count={novelistList.looseScenes.length} />
                {collapsed['mn-loose-scenes'] !== true && novelistList.looseScenes.map(scene => (
                  <NoteRow key={scene.id} n={scene} depth={1} compact />
                ))}
              </>
            )}
            {novelistList.other.length > 0 && (
              <div style={{
                padding: '12px 18px 6px',
                fontFamily: 'var(--mn-ui)', fontWeight: 600,
                fontSize: 11,
                color: T.inkDim,
                borderBottom: `1px solid ${T.lineSub}`,
              }}>Other notes</div>
            )}
            {novelistList.other.map(n => <NoteRow key={n.id} n={n} />)}
          </>
        ) : visibleNotes.map(n => <NoteRow key={n.id} n={n} />)}
        {!novelistList && visibleLimit < notes.length && (
          <button type="button" onClick={() => setVisibleLimit(limit => limit + 160)} style={{
            width: 'calc(100% - 16px)', margin: '4px 8px 8px', padding: '9px 10px',
            border: `1px solid ${T.lineSub}`, borderRadius: 7, background: T.bg,
            color: T.inkMed, cursor: 'pointer', fontFamily: 'var(--mn-ui)', fontSize: 12,
          }}>Show 160 more · {notes.length - visibleLimit} remaining</button>
        )}
      </div>
      {menu && (
        <div
          onMouseDown={(e) => e.stopPropagation()}
          style={{
            position: 'fixed',
            left: menu.x,
            top: menu.y,
            zIndex: 90,
            minWidth: 158,
            padding: 5,
            background: T.bg,
            border: `1px solid ${T.line}`,
            borderRadius: 7,
            boxShadow: `0 10px 28px color-mix(in oklab, ${T.ink} 18%, transparent)`,
            fontFamily: 'var(--mn-ui)',
          }}>
          {[
            { label: 'Rename', action: () => startRename(menu.note) },
            { label: 'Duplicate', action: () => { setMenu(null); onDuplicateNote && onDuplicateNote(menu.note?.id); } },
            ...(onOpenReference ? [{ label: 'Open as reference', action: () => { setMenu(null); onOpenReference(menu.note?.id); } }] : []),
            ...(onAddToCanvas ? [{ label: 'Add to canvas', action: () => { setMenu(null); onAddToCanvas(menu.note?.id); } }] : []),
            { label: 'Delete', danger: true, action: () => { setMenu(null); onDeleteNote && onDeleteNote(menu.note?.id); } },
          ].map(item => (
            <button
              key={item.label}
              type="button"
              onClick={item.action}
              style={{
                width: '100%',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '7px 8px',
                border: 'none',
                borderRadius: 5,
                background: 'transparent',
                color: item.danger ? (T.danger || T.warn) : T.inkMed,
                cursor: 'pointer',
                fontFamily: 'var(--mn-ui)',
                fontSize: 12.5,
                textAlign: 'left',
              }}
              onMouseEnter={e => e.currentTarget.style.background = T.bgHover}
              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
              <span style={{ width: 14, color: item.danger ? (T.danger || T.warn) : T.inkDim }}>
                {item.label === 'Rename' ? 'R' : item.label === 'Duplicate' ? '+' : item.label === 'Open as reference' ? 'O' : item.label === 'Add to canvas' ? 'C' : 'x'}
              </span>
              <span>{item.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export { MnNoteList, mnFormatDate, mnHighlight };
