// Middle pane: list of notes (filtered). Click to select.
const { useMemo: useMemoL, useState: useStateL } = React;

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
    .replace(/-\s+\[[ x]\]/g, '✓')
    .replace(/-\s+/g, '')
    .replace(/@remind\s+\S+\s*\S*/g, '')
    .trim()
    .replace(/\s+/g, ' ');
  return s.slice(0, 120);
}

function mnSnippet(body, query) {
  const states = window.MN_LOGSEQ?.WORKFLOW_STATES || window.MN_LOGSEQ?.DEFAULT_WORKFLOW_STATES || [];
  const workflowPattern = states
    .map(s => s.id)
    .filter(Boolean)
    .sort((a, b) => b.length - a.length)
    .map(id => id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('|');
  const plain = body
    .split('\n')
    .filter(l => !/^[a-zA-Z][a-zA-Z0-9_-]*::\s/.test(l))  // skip page properties
    .join('\n')
    .replace(/\{\{embed\s+[^}]+\}\}/g, '')                  // skip embeds
    .replace(/\(\([A-Za-z0-9_-]+\)\)/g, '')                 // skip block refs
    .replace(/\[\[([^\]]+)\]\]/g, '$1')
    .replace(/[`*>#]/g, '')
    .replace(/-\s+\[[ x]\]/g, '✓')
    .replace(/-\s+/g, '')
    .replace(/@remind\s+\S+\s*\S*/g, '')
    .replace(workflowPattern ? new RegExp(`^(${workflowPattern})\\s+`, 'gm') : /$^/, '')
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
  tags, theme, density, T,
}) {
  const [collapsed, setCollapsed] = useStateL({});
  const tagHue = useMemoL(() => {
    const m = {}; tags.forEach(t => m[t.name] = t.hue); return m;
  }, [tags]);
  const novelistList = useMemoL(() => {
    if (!novelistStructure) return null;
    const sourceNotes = allNotes || notes || [];
    const noteById = new Map(sourceNotes.map(note => [note.id, note]));
    const visibleIds = new Set((notes || []).map(note => note.id));
    const used = new Set();
    const arcs = (novelistStructure.arcs || []).filter(note => visibleIds.has(note.id));
    const chapterIdsByArc = {};
    const sceneIdsByChapter = {};
    const addUnique = (bucket, parentId, childId) => {
      if (!parentId || !childId) return;
      if (!bucket[parentId]) bucket[parentId] = [];
      if (!bucket[parentId].includes(childId)) bucket[parentId].push(childId);
    };
    Object.entries(novelistStructure.childrenByArcId || {}).forEach(([arcId, chapterIds]) => {
      (chapterIds || []).forEach(chapterId => addUnique(chapterIdsByArc, arcId, chapterId));
    });
    Object.entries(novelistStructure.parentByChapterId || {}).forEach(([chapterId, arcId]) => {
      addUnique(chapterIdsByArc, arcId, chapterId);
    });
    Object.entries(novelistStructure.childrenByChapterId || {}).forEach(([chapterId, sceneIds]) => {
      (sceneIds || []).forEach(sceneId => addUnique(sceneIdsByChapter, chapterId, sceneId));
    });
    Object.entries(novelistStructure.parentBySceneId || {}).forEach(([sceneId, chapterId]) => {
      addUnique(sceneIdsByChapter, chapterId, sceneId);
    });
    const chapterIds = new Set((novelistStructure.chapters || []).map(note => note.id));
    const sceneIds = new Set((novelistStructure.scenes || []).map(note => note.id));
    const chaptersForArc = (arc) => (chapterIdsByArc[arc.id] || [])
      .map(id => noteById.get(id))
      .filter(note => note && chapterIds.has(note.id) && visibleIds.has(note.id));
    const scenesForChapter = (chapter) => (sceneIdsByChapter[chapter.id] || [])
      .map(id => noteById.get(id))
      .filter(note => note && sceneIds.has(note.id) && visibleIds.has(note.id));
    arcs.forEach(arc => {
      used.add(arc.id);
      chaptersForArc(arc).forEach(chapter => {
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
    return { arcs, looseChapters, looseScenes, chaptersForArc, scenesForChapter, other };
  }, [notes, allNotes, novelistStructure]);

  const NoteRow = ({ n, depth = 0, compact = false, meta = '' }) => {
    const active = n.id === selectedId;
    return (
      <div
        key={n.id}
        draggable
        onDragStart={(e) => {
          const payload = JSON.stringify({ noteId: n.id });
          e.dataTransfer.setData('text/mn-note', payload);
          e.dataTransfer.setData('text/plain', `mn-note:${n.id}`);
          e.dataTransfer.effectAllowed = 'copyMove';
        }}
        onClick={() => onSelect(n.id)}
        style={{
        padding: density === 'compact' || compact ? '9px 18px' : '14px 20px',
        paddingLeft: 20 + depth * 16,
        borderBottom: `1px solid ${T.lineSub}`,
        cursor: 'grab',
        background: active ? T.selBg : 'transparent',
        borderLeft: active ? `2px solid ${T.accent}` : '2px solid transparent',
        position: 'relative',
        transition: 'background 80ms',
      }}
      onMouseEnter={e => !active && (e.currentTarget.style.background = T.bgHover)}
      onMouseLeave={e => !active && (e.currentTarget.style.background = 'transparent')}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
          {n.pinned && (
            <svg width="9" height="9" viewBox="0 0 10 10" fill={T.accent}>
              <circle cx="5" cy="5" r="3" />
            </svg>
          )}
          <div style={{
            flex: 1, fontFamily: 'var(--mn-ui)',
            fontSize: 13.5, fontWeight: depth ? 500 : 600,
            color: T.ink, letterSpacing: '-0.005em',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>{mnHighlight(n.title, query, T)}</div>
          <div style={{
            fontFamily: 'var(--mn-mono)', fontSize: 10, color: T.inkDim,
            flexShrink: 0,
          }}>{mnFormatDate(n.date)}</div>
        </div>
        {density !== 'compact' && !compact && (
          <div style={{
            fontFamily: 'var(--mn-body)', fontSize: 12.5,
            color: T.inkMed, lineHeight: 1.5,
            marginTop: 4, display: '-webkit-box',
            WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
          }}>{mnHighlight(mnSnippet(n.body, query), query, T)}</div>
        )}
        {!compact && (
          <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
            {(n.tags || []).map(t => (
              <span key={t} style={{
                fontFamily: 'var(--mn-mono)', fontSize: 9.5,
                letterSpacing: '0.03em',
                color: mnGetTagColor(tagHue[t] ?? 240, theme),
                padding: '1px 6px', borderRadius: 3,
                background: mnGetTagBg(tagHue[t] ?? 240, theme),
              }}>#{t}</span>
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
                fontFamily: 'var(--mn-mono)',
                fontSize: 9,
                color: T.inkDim,
                textTransform: 'uppercase',
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
      width: density === 'compact' ? 270 : 320, height: '100%',
      background: T.bg,
      borderRight: `1px solid ${T.line}`,
      display: 'flex', flexDirection: 'column', flexShrink: 0,
    }}>
      {/* Header */}
      <div style={{
        padding: '40px 20px 12px', borderBottom: `1px solid ${T.lineSub}`,
      }}>
        <div style={{
          fontFamily: 'var(--mn-ui)', fontSize: 17, fontWeight: 600,
          color: T.ink, letterSpacing: '-0.01em',
        }}>{title}</div>
        <div style={{
          fontFamily: 'var(--mn-mono)', fontSize: 10.5, color: T.inkDim,
          letterSpacing: '0.06em', marginTop: 4,
        }}>{subtitle}</div>

        {/* Search */}
        <div style={{
          marginTop: 12, position: 'relative',
          display: 'flex', alignItems: 'center',
          background: T.bgSub, borderRadius: 6,
          border: `1px solid ${query ? T.line : 'transparent'}`,
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
            placeholder="Search notes…"
            style={{
              flex: 1, border: 'none', outline: 'none', background: 'transparent',
              padding: '6px 26px 6px 28px',
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
      <div style={{ flex: 1, overflow: 'auto' }}>
        {notes.length === 0 && (
          <div style={{
            padding: '40px 20px', textAlign: 'center',
            fontFamily: 'var(--mn-body)', fontSize: 13,
            color: T.inkDim,
          }}>
            {query
              ? <>No notes match <strong style={{ color: T.ink, fontWeight: 500 }}>“{query}”</strong></>
              : <span style={{ fontStyle: 'italic' }}>No notes yet.</span>}
          </div>
        )}
        {novelistList ? (
          <>
            {novelistList.arcs.map(arc => {
              const chapters = novelistList.chaptersForArc(arc);
              const arcCollapsed = collapsed[arc.id] === true;
              return (
                <React.Fragment key={arc.id}>
                  <GroupHeader note={arc} count={chapters.length} type="arc" />
                  {!arcCollapsed && chapters.map(chapter => {
                    const scenes = novelistList.scenesForChapter(chapter);
                    const chapterCollapsed = collapsed[chapter.id] === true;
                    return (
                      <React.Fragment key={chapter.id}>
                        <GroupHeader note={chapter} depth={1} count={scenes.length} type="chapter" linkedTo={`Linked to ${arc.title || 'arc'}`} />
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
                fontFamily: 'var(--mn-mono)',
                fontSize: 10,
                color: T.inkDim,
                textTransform: 'uppercase',
                borderBottom: `1px solid ${T.lineSub}`,
              }}>Other notes</div>
            )}
            {novelistList.other.map(n => <NoteRow key={n.id} n={n} />)}
          </>
        ) : notes.map(n => <NoteRow key={n.id} n={n} />)}
      </div>
    </div>
  );
}

window.MnNoteList = MnNoteList;
window.mnFormatDate = mnFormatDate;
window.mnHighlight = mnHighlight;
