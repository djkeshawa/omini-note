// Overlay panels: Todos aggregator, Today view, Quick-capture, Reminder toast, Tweaks

const { useState: useStateP, useMemo: useMemoP, useEffect: useEffectP, useRef: useRefP } = React;

// ────────────────────────────────────────────────────────────
// Aggregated Todos
// ────────────────────────────────────────────────────────────
const { SectionHead } = window.MN_PANEL_COMPONENTS || {};

const MN_PANEL_HELPERS = window.MN_PANEL_HELPERS || {};
const {
  mnNovelistAiConfigKey,
  mnReadNovelistAiConfig,
  mnWriteNovelistAiConfig,
  mnNormalizeNovelistAiConfig,
} = MN_PANEL_HELPERS;

// ────────────────────────────────────────────────────────────
// Novelist workspace
// ────────────────────────────────────────────────────────────
function MnNovelistPanel({
  notes, novelistNotes, tags, vaultId = '', workflowStates, workflowItems,
  novelistStructure,
  onOpen, onCreateNote, onLinkChapter, onLinkScene,
  onSetOrder, onRenameNote, onConvertNoteType,
  onDeleteNote,
  onCreateTag, onRemoveSupportingType,
  initialAiConfig = null, onAiConfigChange,
  T
}) {
  const [linkMenu, setLinkMenu] = useStateP(null);
  const [createMenu, setCreateMenu] = useStateP(null);
  const [activeTab, setActiveTab] = useStateP('plan');
  const [addingSupportType, setAddingSupportType] = useStateP(false);
  const [supportTypeDraft, setSupportTypeDraft] = useStateP('');
  const [collapsed, setCollapsed] = useStateP({});
  const [noteMenu, setNoteMenu] = useStateP(null);
  const [linkNotice, setLinkNotice] = useStateP(null);
  const [editDialog, setEditDialog] = useStateP(null);
  const [aiConfig, setAiConfig] = useStateP(() => mnNormalizeNovelistAiConfig(initialAiConfig || mnReadNovelistAiConfig(vaultId)));
  const [aiWordLimitDraft, setAiWordLimitDraft] = useStateP(() => String(mnNormalizeNovelistAiConfig(initialAiConfig || mnReadNovelistAiConfig(vaultId)).wordLimit));
  const editInputRef = useRefP(null);
  const linkNoticeTimer = useRefP(null);
  useEffectP(() => {
    return () => {
      if (linkNoticeTimer.current) window.clearTimeout(linkNoticeTimer.current);
    };
  }, []);
  useEffectP(() => {
    const next = mnNormalizeNovelistAiConfig(initialAiConfig || mnReadNovelistAiConfig(vaultId));
    setAiConfig(next);
    setAiWordLimitDraft(String(next.wordLimit));
  }, [vaultId, initialAiConfig]);
  useEffectP(() => {
    if (!noteMenu && !createMenu && !linkMenu) return;
    const close = () => {
      setNoteMenu(null);
      setCreateMenu(null);
      setLinkMenu(null);
    };
    const closeOnEscape = (event) => {
      if (event.key === 'Escape') close();
    };
    window.addEventListener('click', close);
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      window.removeEventListener('click', close);
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [noteMenu, createMenu, linkMenu]);
  useEffectP(() => {
    if (!editDialog) return;
    const handle = window.setTimeout(() => editInputRef.current?.focus(), 0);
    return () => window.clearTimeout(handle);
  }, [editDialog]);
  const novelNotes = novelistNotes || (notes || []).filter(n => (n.tags || []).some(t => t.startsWith('novel-')));
  const byTag = (tag) => novelNotes.filter(n => (n.tags || []).includes(tag));
  const acts = novelistStructure?.acts || byTag('novel-act');
  const chapters = novelistStructure?.chapters || byTag('novel-chapter');
  const scenes = novelistStructure?.scenes || byTag('novel-scene');
  const childrenByActId = novelistStructure?.childrenByActId || {};
  const childrenByChapterId = novelistStructure?.childrenByChapterId || {};
  const parentByChapterId = novelistStructure?.parentByChapterId || {};
  const parentBySceneId = novelistStructure?.parentBySceneId || {};
  const structureTagNames = new Set(['novel-act', 'novel-chapter', 'novel-scene']);
  const supportTypeDefaults = {
    'novel-character': {
      label: 'Character',
      sectionTitle: 'Characters',
      body: 'want:: \nneed:: \nsecret:: \nchange:: ',
    },
    'novel-location': {
      label: 'Location',
      sectionTitle: 'Locations',
      body: 'mood:: \nsensory-details:: \nrules-or-constraints:: ',
    },
    'novel-plot': {
      label: 'Plot Thread',
      sectionTitle: 'Plot Threads',
      body: 'status:: IDEA\n- Promise\n- Setup\n- Payoff',
    },
    'novel-research': {
      label: 'Research',
      sectionTitle: 'Research',
      body: 'source:: \n## Notes\n- ',
    },
    'novel-revision': {
      label: 'Revision Note',
      sectionTitle: 'Revision Notes',
      body: 'status:: IDEA\n## Notes\n- ',
    },
  };
  const titleFromTag = (tagName) => String(tagName || '')
    .replace(/^novel-/, '')
    .split('-')
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ') || 'Note';
  const pluralize = (label) => {
    if (/s$/i.test(label)) return label;
    if (/y$/i.test(label)) return `${label.slice(0, -1)}ies`;
    return `${label}s`;
  };
  const normalizeSupportingTypeTag = (raw) => {
    const clean = String(raw || '').trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9_-]+/g, '').replace(/^-+|-+$/g, '');
    if (!clean) return '';
    return clean.startsWith('novel-') ? clean : `novel-${clean}`;
  };
  const supportingTypes = (tags || [])
    .filter(tag => tag?.name?.startsWith('novel-') && !structureTagNames.has(tag.name))
    .filter((tag, index, arr) => arr.findIndex(item => item.name === tag.name) === index)
    .map(tag => {
      const fallbackLabel = titleFromTag(tag.name);
      const defaults = supportTypeDefaults[tag.name] || {};
      return {
        tag: tag.name,
        label: defaults.label || fallbackLabel,
        sectionTitle: defaults.sectionTitle || pluralize(fallbackLabel),
        body: defaults.body || '## Notes\n- ',
      };
    });
  const supportingTotal = supportingTypes.reduce((sum, type) => sum + byTag(type.tag).length, 0);

  const uniqueTitle = (base) => {
    const existing = new Set((notes || []).map(note => String(note.title || '').toLowerCase()));
    if (!existing.has(base.toLowerCase())) return base;
    for (let i = 2; i < 1000; i++) {
      const next = `${base} ${i}`;
      if (!existing.has(next.toLowerCase())) return next;
    }
    return `${base} ${Date.now().toString(36)}`;
  };
  const readOrder = (note) => {
    if (typeof mnNoteOrderValue === 'function') return mnNoteOrderValue(note);
    const raw = String(note?.body || '').match(/^\s*-?\s*order::\s*(.*)$/im)?.[1];
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : null;
  };
  const setBodyProperty = (body, key, value) => {
    if (typeof mnSetBodyProperty === 'function') return mnSetBodyProperty(body, key, value);
    const source = String(body || '');
    const re = new RegExp(`^\\s*(?:-\\s*)?${key}::\\s*.*$`, 'im');
    if (re.test(source)) return source.replace(re, () => `${key}:: ${value}`.trimEnd());
    return `${key}:: ${value}\n${source}`.trimEnd();
  };
  const nextOrder = (kind, parent = null) => {
    const values = (items, step, base) => {
      let maxOrder = null;
      for (const item of items) {
        const value = readOrder(item);
        if (value == null) continue;
        maxOrder = maxOrder == null ? value : Math.max(maxOrder, value);
      }
      return maxOrder != null ? maxOrder + step : base + step;
    };
    if (kind === 'act') return values(acts, 100, 0);
    if (kind === 'chapter') {
      const base = readOrder(parent) ?? 100;
      return values(parent ? childrenForAct(parent) : chapters, 10, base);
    }
    const base = readOrder(parent) ?? 100;
    return values(parent ? childrenForChapter(parent) : scenes, 1, base);
  };
  const createChapterForAct = (act) => {
    if (!act) return;
    const title = uniqueTitle(`${act.title || 'Act'} Chapter`);
    const body = `status:: OUTLINE\norder:: ${nextOrder('chapter', act)}\nact:: [[${act.title || 'Act'}]]\n## Scenes\n- Chapter goal\n- Scene list\n- Revision notes`;
    const id = onCreateNote?.({ title, body, tags: ['novel-chapter'] });
    if (id) onLinkChapter?.(act.id, id, title);
    showLinkNotice(`Created and linked ${title} to ${act.title || 'act'}`, act.id);
  };
  const createSceneForChapter = (chapter) => {
    if (!chapter) return;
    const act = (notes || []).find(note => note.id === parentByChapterId[chapter.id]);
    const title = uniqueTitle(`${chapter.title || 'Chapter'} Scene`);
    const body = `status:: DRAFT\norder:: ${nextOrder('scene', chapter)}\n${act ? `act:: [[${act.title}]]\n` : ''}chapter:: [[${chapter.title || 'Chapter'}]]\npov:: \nsetting:: \npurpose:: \n::: plot-points\n- Opening beat\n:::\nDraft the scene here.`;
    const id = onCreateNote?.({ title, body, tags: ['novel-scene'] });
    if (id) onLinkScene?.(chapter.id, id, title);
    showLinkNotice(`Created and linked ${title} to ${chapter.title || 'chapter'}`, chapter.id);
  };
  const createSceneForAct = (act) => {
    const chaptersForThisArc = childrenForAct(act);
    if (chaptersForThisArc[0]) {
      createSceneForChapter(chaptersForThisArc[0]);
      return;
    }
    const chapterTitle = uniqueTitle(`${act.title || 'Act'} Chapter`);
    const sceneTitle = uniqueTitle(`${chapterTitle} Scene`);
    const chapterBody = `status:: OUTLINE\norder:: ${nextOrder('chapter', act)}\nact:: [[${act.title || 'Act'}]]\n## Scenes\n- [[${sceneTitle}]]`;
    const chapterId = onCreateNote?.({ title: chapterTitle, body: chapterBody, tags: ['novel-chapter'] });
    if (!chapterId) return;
    onLinkChapter?.(act.id, chapterId, chapterTitle);
    const sceneBody = `status:: DRAFT\norder:: ${nextOrder('scene', { id: chapterId, title: chapterTitle, body: chapterBody })}\nact:: [[${act.title || 'Act'}]]\nchapter:: [[${chapterTitle}]]\npov:: \nsetting:: \npurpose:: \n::: plot-points\n- Opening beat\n:::\nDraft the scene here.`;
    onCreateNote?.({ title: sceneTitle, body: sceneBody, tags: ['novel-scene'] });
  };
  const createParentActForChapter = (chapter) => {
    const title = uniqueTitle(`${chapter.title || 'Chapter'} Act`);
    const body = `status:: OUTLINE\norder:: ${nextOrder('act')}\npurpose:: \n## Chapters`;
    const id = onCreateNote?.({ title, body, tags: ['novel-act'] });
    if (id) onLinkChapter?.(id, chapter.id, chapter.title);
  };
  const createParentChapterForScene = (scene) => {
    const title = uniqueTitle(`${scene.title || 'Scene'} Chapter`);
    const body = `status:: OUTLINE\norder:: ${nextOrder('chapter')}\n## Scenes`;
    const id = onCreateNote?.({ title, body, tags: ['novel-chapter'] });
    if (id) onLinkScene?.(id, scene.id, scene.title);
  };
  const promptRename = (note) => {
    setEditDialog({ type: 'rename', note, value: note?.title || '', error: '' });
  };
  const promptSetOrder = (note) => {
    const current = readOrder(note);
    setEditDialog({ type: 'order', note, value: current == null ? '' : String(current), error: '' });
  };
  const submitEditDialog = () => {
    if (!editDialog?.note) return;
    const value = String(editDialog.value || '').trim();
    if (editDialog.type === 'rename') {
      if (!value) {
        setEditDialog(current => current ? { ...current, error: 'Title is required.' } : current);
        return;
      }
      onRenameNote?.(editDialog.note.id, value);
      setEditDialog(null);
      return;
    }
    if (value && !Number.isFinite(Number(value))) {
      setEditDialog(current => current ? { ...current, error: 'Order must be a number or blank.' } : current);
      return;
    }
    onSetOrder?.(editDialog.note.id, value);
    setEditDialog(null);
  };
  const openNoteMenu = (e, note) => {
    if (!note) return;
    e.preventDefault();
    e.stopPropagation();
    setNoteMenu({ note, x: e.clientX, y: e.clientY });
  };

  const templates = [
    { title: 'Act', tags: ['novel-act'], body: 'status:: OUTLINE\norder:: \npurpose:: \n## Chapters' },
    { title: 'Chapter', tags: ['novel-chapter'], body: 'status:: OUTLINE\norder:: \nact:: \n## Scenes' },
    { title: 'Scene', tags: ['novel-scene'], body: 'status:: DRAFT\norder:: \nchapter:: \npov:: \nsetting:: \npurpose:: \n::: plot-points\n- Opening beat\n:::\nDraft the scene here.' },
    ...supportingTypes.map(type => ({ title: type.label, tags: [type.tag], body: type.body })),
  ];
  const updateAiConfig = (updater) => {
    setAiConfig(current => {
      const next = mnNormalizeNovelistAiConfig(typeof updater === 'function' ? updater(current) : updater);
      mnWriteNovelistAiConfig(next, vaultId);
      onAiConfigChange && onAiConfigChange(next);
      return next;
    });
  };
  const commitAiWordLimit = () => {
    const parsed = Number(aiWordLimitDraft);
    const next = mnNormalizeNovelistAiConfig({
      ...aiConfig,
      wordLimit: Number.isFinite(parsed) ? parsed : aiConfig.wordLimit,
    });
    setAiConfig(next);
    setAiWordLimitDraft(String(next.wordLimit));
    mnWriteNovelistAiConfig(next, vaultId);
    onAiConfigChange && onAiConfigChange(next);
  };
  const addAiPrompt = () => {
    updateAiConfig(current => ({
      ...current,
      prompts: [
        ...(current.prompts || []),
        {
          id: `prompt-${Date.now().toString(36)}`,
          name: 'New prompt',
          prompt: '',
        },
      ],
    }));
  };
  const updateAiPrompt = (id, patch) => {
    updateAiConfig(current => ({
      ...current,
      prompts: (current.prompts || []).map(item => item.id === id ? { ...item, ...patch } : item),
    }));
  };
  const removeAiPrompt = (id) => {
    updateAiConfig(current => ({
      ...current,
      prompts: (current.prompts || []).filter(item => item.id !== id),
    }));
  };
  const noteById = new Map((notes || []).map(note => [note.id, note]));
  const childrenForAct = (act) => (childrenByActId[act.id] || []).map(id => noteById.get(id)).filter(Boolean);
  const childrenForChapter = (chapter) => (childrenByChapterId[chapter.id] || []).map(id => noteById.get(id)).filter(Boolean);
  const unlinkedChapters = chapters.filter(chapter => !parentByChapterId[chapter.id]);
  const unlinkedScenes = scenes.filter(scene => !parentBySceneId[scene.id]);
  const isNonStructureNovel = (note) => (note?.tags || []).some(tag =>
    tag.startsWith('novel-') && !['novel-chapter', 'novel-scene'].includes(tag)
  );
  const chapterCandidatesForAct = (act) => (notes || []).filter(note =>
    note.id !== act.id &&
    !parentByChapterId[note.id] &&
    !parentBySceneId[note.id] &&
    !isNonStructureNovel(note) &&
    !(note.tags || []).includes('novel-scene')
  );
  const sceneCandidatesForChapter = (chapter) => (notes || []).filter(note =>
    note.id !== chapter.id &&
    !parentBySceneId[note.id] &&
    !isNonStructureNovel(note) &&
    !(note.tags || []).includes('novel-chapter')
  );
  const actForChapter = (chapter) => noteById.get(parentByChapterId[chapter?.id]);
  const chapterForScene = (scene) => noteById.get(parentBySceneId[scene?.id]);
  const actForScene = (scene) => {
    const chapter = chapterForScene(scene);
    return chapter ? actForChapter(chapter) : null;
  };
  const showLinkNotice = (text, parentId = null) => {
    setLinkNotice({ text, parentId, at: Date.now() });
    if (linkNoticeTimer.current) window.clearTimeout(linkNoticeTimer.current);
    linkNoticeTimer.current = window.setTimeout(() => setLinkNotice(null), 3200);
  };
  const addSupportingType = () => {
    const tagName = normalizeSupportingTypeTag(supportTypeDraft);
    if (!tagName || structureTagNames.has(tagName)) return;
    onCreateTag?.(tagName);
    setSupportTypeDraft('');
    setAddingSupportType(false);
  };
  const createSupportingNote = (type) => {
    const title = uniqueTitle(type.label);
    onCreateNote?.({
      title,
      tags: [type.tag],
      body: type.body,
    });
  };

  const TypeLine = ({ label, linkedTo, extraParent, count }) => (
    <div style={{
      marginTop: 3,
      fontFamily: 'var(--mn-mono)',
      fontSize: 9.5,
      color: T.inkDim,
      textTransform: 'uppercase',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap',
    }}>
      {label}{typeof count === 'number' ? ` · ${count}` : ''}
      {linkedTo ? ` · Linked to ${linkedTo.title || 'Untitled'}${extraParent ? ` · ${extraParent.title || 'Untitled'}` : ''}` : ''}
    </div>
  );

  const NoteCard = ({ note }) => (
    <button
      key={note.id}
      onClick={() => onOpen && onOpen(note.id)}
      onContextMenu={(e) => openNoteMenu(e, note)}
      style={{
        border: `1px solid ${T.lineSub}`,
        borderRadius: 7,
        background: T.bg,
        color: T.ink,
        padding: '9px 10px',
        cursor: 'pointer',
        textAlign: 'left',
        minHeight: 58,
        display: 'flex',
        flexDirection: 'column',
        gap: 5,
      }}
      onMouseEnter={e => e.currentTarget.style.background = T.bgHover}
      onMouseLeave={e => e.currentTarget.style.background = T.bg}>
      <div style={{
        fontFamily: 'var(--mn-ui)',
        fontSize: 13.5,
        fontWeight: 650,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
      }}>{note.title || 'Untitled'}</div>
      <TypeLine label={(note.tags || []).find(t => t.startsWith('novel-'))?.replace('novel-', '') || 'note'} />
    </button>
  );

  const Section = ({ type, items, empty }) => (
    <section style={{
      border: `1px solid ${T.lineSub}`,
      borderRadius: 8,
      background: T.bg,
      padding: 12,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
        <div style={{ fontFamily: 'var(--mn-ui)', fontSize: 14, fontWeight: 700, color: T.ink, minWidth: 0, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{type.sectionTitle}</div>
        <div style={{ fontFamily: 'var(--mn-mono)', fontSize: 10, color: T.inkDim }}>{items.length}</div>
        <button
          onClick={() => createSupportingNote(type)}
          style={mnPanelMiniButton(T)}>
          + Note
        </button>
        <button
          onClick={() => onRemoveSupportingType?.(type.tag)}
          title={`Remove ${type.sectionTitle} from Supporting Notes`}
          style={{ ...mnPanelMiniButton(T), color: T.inkDim }}>
          Remove type
        </button>
      </div>
      <div style={{ display: 'grid', gap: 7 }}>
        {items.slice(0, 6).map(note => <NoteCard key={note.id} note={note} />)}
        {!items.length && (
          <div style={{
            border: `1px dashed ${T.line}`,
            borderRadius: 7,
            padding: 16,
            textAlign: 'center',
            color: T.inkDim,
            fontFamily: 'var(--mn-body)',
            fontSize: 12.5,
          }}>{empty}</div>
        )}
      </div>
    </section>
  );

  const LinkNoticeChip = ({ parentId }) => (
    linkNotice && linkNotice.parentId === parentId ? (
      <span style={{
        fontFamily: 'var(--mn-ui)',
        fontSize: 11.5,
        color: T.accent,
        background: T.accentSoft,
        border: `1px solid color-mix(in oklab, ${T.accent} 24%, transparent)`,
        borderRadius: 999,
        padding: '2px 7px',
        whiteSpace: 'nowrap',
      }}>
        {linkNotice.text}
      </span>
    ) : null
  );

  const StructureNoteButton = ({ note, label, linkedTo, extraParent, count, depth = 0 }) => (
    <button
      onClick={(e) => { e.stopPropagation(); onOpen && onOpen(note.id); }}
      onContextMenu={(e) => openNoteMenu(e, note)}
      title={`Open ${note.title}`}
      style={{
        border: 'none',
        background: 'transparent',
        color: T.ink,
        padding: 0,
        minWidth: 0,
        textAlign: 'left',
        cursor: 'pointer',
        fontFamily: 'var(--mn-ui)',
        flex: 1,
      }}>
      <div style={{
        fontSize: depth ? 13 : 14,
        fontWeight: depth ? 650 : 720,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
        maxWidth: '100%',
      }}>{note.title || label}</div>
      <TypeLine label={label} linkedTo={linkedTo} extraParent={extraParent} count={count} />
    </button>
  );

  const InlineEmpty = ({ children }) => (
    <div style={{
      border: `1px dashed ${T.lineSub}`,
      borderRadius: 7,
      color: T.inkDim,
      background: T.bgSub,
      padding: '7px 9px',
      fontFamily: 'var(--mn-ui)',
      fontSize: 12,
    }}>{children}</div>
  );

  const ToggleButton = ({ expanded, onClick }) => (
    <button
      onClick={onClick}
      title={expanded ? 'Collapse' : 'Expand'}
      style={{
        width: 24,
        height: 24,
        borderRadius: 6,
        border: `1px solid ${T.lineSub}`,
        background: T.bgSub,
        color: T.inkDim,
        cursor: 'pointer',
        padding: 0,
        flexShrink: 0,
        fontFamily: 'var(--mn-ui)',
        fontWeight: 700,
      }}>
      {expanded ? '-' : '+'}
    </button>
  );

  const LinkMenu = ({ type, parent, candidates }) => {
    const open = linkMenu?.type === type && linkMenu?.parentId === parent.id;
    if (!open) return null;
    return (
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          marginTop: 7,
          border: `1px solid ${T.lineSub}`,
          borderRadius: 7,
          background: T.bg,
          boxShadow: `0 10px 24px color-mix(in oklab, ${T.ink} 12%, transparent)`,
          overflow: 'hidden',
          maxWidth: 420,
          flexBasis: '100%',
        }}>
        <div style={{
          padding: '7px 10px 6px',
          borderBottom: `1px solid ${T.lineSub}`,
          fontFamily: 'var(--mn-ui)',
          fontSize: 12,
          color: T.inkMed,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}>
          Link {type} to {parent.title || 'Untitled'}
        </div>
        {candidates.length === 0 && (
          <div style={{ padding: '8px 10px', fontFamily: 'var(--mn-ui)', fontSize: 12, color: T.inkDim }}>
            No unlinked {type === 'chapter' ? 'chapters' : 'scenes'}
          </div>
        )}
        {candidates.map(candidate => (
          <button
            key={candidate.id}
            onClick={(e) => {
              e.stopPropagation();
              if (type === 'chapter') {
                onLinkChapter?.(parent.id, candidate.id, candidate.title);
                showLinkNotice(`Linked ${candidate.title || 'chapter'} to ${parent.title || 'act'}`, parent.id);
              } else {
                onLinkScene?.(parent.id, candidate.id, candidate.title);
                showLinkNotice(`Linked ${candidate.title || 'scene'} to ${parent.title || 'chapter'}`, parent.id);
              }
              setLinkMenu(null);
            }}
            style={{
              width: '100%',
              border: 'none',
              borderBottom: `1px solid ${T.lineSub}`,
              background: T.bg,
              color: T.ink,
              padding: '8px 10px',
              textAlign: 'left',
              cursor: 'pointer',
              fontFamily: 'var(--mn-ui)',
              fontSize: 12.5,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}>
            {candidate.title || 'Untitled'}
          </button>
        ))}
      </div>
    );
  };

  const AttachMenu = () => {
    if (!linkMenu?.type?.startsWith('attach-')) return null;
    const isChapter = linkMenu.type === 'attach-chapter';
    const child = noteById.get(linkMenu.childId);
    const parents = isChapter ? acts : chapters;
    return (
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          position: 'fixed',
          left: linkMenu.x,
          top: linkMenu.y,
          zIndex: 125,
          minWidth: 220,
          maxWidth: 320,
          border: `1px solid ${T.lineSub}`,
          borderRadius: 7,
          background: T.bg,
          boxShadow: `0 14px 34px color-mix(in oklab, ${T.ink} 18%, transparent)`,
          padding: 4,
        }}>
        <div style={{
          padding: '7px 10px 6px',
          fontFamily: 'var(--mn-ui)',
          fontSize: 12,
          color: T.inkMed,
          borderBottom: `1px solid ${T.lineSub}`,
          marginBottom: 4,
        }}>
          Attach {child?.title || (isChapter ? 'chapter' : 'scene')}
        </div>
        {parents.map(parent => (
          <button
            key={parent.id}
            onClick={() => {
              if (isChapter) onLinkChapter?.(parent.id, child.id, child.title);
              else onLinkScene?.(parent.id, child.id, child.title);
              setLinkMenu(null);
            }}
            style={mnPanelMenuItem(T)}>
            {parent.title || 'Untitled'}
          </button>
        ))}
        {!parents.length && (
          <div style={{ padding: 10, color: T.inkDim, fontFamily: 'var(--mn-ui)', fontSize: 12 }}>
            No {isChapter ? 'acts' : 'chapters'} available
          </div>
        )}
      </div>
    );
  };

  const StructureActions = ({ parent, type, onAdd, onAddScene, candidates }) => (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
      <button
        onClick={(e) => { e.stopPropagation(); onAdd(parent); }}
        style={mnPanelMiniButton(T)}>
        + {type === 'chapter' ? 'Chapter' : 'Scene'}
      </button>
      {type === 'chapter' && (
        <button
          onClick={(e) => { e.stopPropagation(); onAddScene?.(parent); }}
          style={mnPanelMiniButton(T)}>
          + Scene
        </button>
      )}
      <button
        onClick={(e) => {
          e.stopPropagation();
          setLinkMenu(current => current?.type === type && current?.parentId === parent.id ? null : { type, parentId: parent.id });
        }}
        style={mnPanelMiniButton(T)}>
        {type === 'chapter' ? 'Link existing chapter' : 'Link existing scene'}
      </button>
      <button
        onClick={(e) => { e.stopPropagation(); promptSetOrder(parent); }}
        style={mnPanelMiniButton(T)}>
        Set order
      </button>
      {type === 'chapter' && (
        <button
          onClick={(e) => { e.stopPropagation(); promptRename(parent); }}
          style={mnPanelMiniButton(T)}>
          Rename
        </button>
      )}
      <LinkNoticeChip parentId={parent.id} />
      <LinkMenu type={type} parent={parent} candidates={candidates || []} />
    </div>
  );

  const SceneRow = ({ scene }) => (
    <div
      onContextMenu={(e) => openNoteMenu(e, scene)}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 9,
        minHeight: 42,
        padding: '7px 0 7px 32px',
        borderTop: `1px solid ${T.lineSub}`,
      }}>
      <StructureNoteButton
        note={scene}
        label="Scene"
        linkedTo={chapterForScene(scene)}
        extraParent={actForScene(scene)}
        depth={2}
      />
    </div>
  );

  const ChapterRow = ({ chapter }) => {
    const scenesForThisChapter = childrenForChapter(chapter);
    const isCollapsed = collapsed[chapter.id] === true;
    return (
      <div
        onContextMenu={(e) => openNoteMenu(e, chapter)}
        style={{
          border: `1px solid ${T.lineSub}`,
          borderRadius: 7,
          background: T.bgSub,
          padding: 10,
          height: 220,
          minHeight: 220,
          display: 'flex',
          flexDirection: 'column',
          boxSizing: 'border-box',
          overflow: 'hidden',
        }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 9 }}>
          <ToggleButton
            expanded={!isCollapsed}
            onClick={(e) => { e.stopPropagation(); setCollapsed(c => ({ ...c, [chapter.id]: !isCollapsed })); }}
          />
          <StructureNoteButton
            note={chapter}
            label="Chapter"
            linkedTo={actForChapter(chapter)}
            count={scenesForThisChapter.length}
            depth={1}
          />
        </div>
        {!isCollapsed && (
          <div style={{ display: 'grid', gap: 7, marginTop: 8, minHeight: 0, flex: 1 }}>
            <div style={{ display: 'grid', gap: 7, overflowY: 'auto', minHeight: 0, paddingRight: 2 }}>
            {scenesForThisChapter.length
              ? scenesForThisChapter.map(scene => <SceneRow key={scene.id} scene={scene} />)
              : <div style={{ paddingLeft: 32 }}><InlineEmpty>No scenes linked</InlineEmpty></div>}
            </div>
            <div style={{ paddingLeft: 32 }}>
              <StructureActions
                parent={chapter}
                type="scene"
                onAdd={createSceneForChapter}
                candidates={sceneCandidatesForChapter(chapter)}
              />
            </div>
          </div>
        )}
      </div>
    );
  };

  const ActRow = ({ act }) => {
    const chaptersForThisArc = childrenForAct(act);
    const isCollapsed = collapsed[act.id] === true;
    return (
      <div
        onContextMenu={(e) => openNoteMenu(e, act)}
        style={{
          border: `1px solid ${T.lineSub}`,
          borderRadius: 8,
          background: T.bg,
          padding: 12,
        }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 9 }}>
          <ToggleButton
            expanded={!isCollapsed}
            onClick={(e) => { e.stopPropagation(); setCollapsed(c => ({ ...c, [act.id]: !isCollapsed })); }}
          />
          <StructureNoteButton
            note={act}
            label="Act"
            count={chaptersForThisArc.length}
          />
        </div>
        {!isCollapsed && (
          <div style={{ display: 'grid', gap: 8, marginTop: 9 }}>
            {chaptersForThisArc.length
              ? <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 8 }}>
                  {chaptersForThisArc.map(chapter => <ChapterRow key={chapter.id} chapter={chapter} />)}
                </div>
              : <div style={{ paddingLeft: 33 }}><InlineEmpty>No chapters linked</InlineEmpty></div>}
            <div style={{ paddingLeft: 33 }}>
              <StructureActions
                parent={act}
                type="chapter"
                onAdd={createChapterForAct}
                onAddScene={createSceneForAct}
                candidates={chapterCandidatesForAct(act)}
              />
            </div>
          </div>
        )}
      </div>
    );
  };

  const LooseStructureSection = ({ title, items, empty, render }) => (
    <div style={{
      border: `1px solid ${T.lineSub}`,
      borderRadius: 8,
      background: T.bg,
      padding: 12,
    }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 8 }}>
        <div style={{ fontFamily: 'var(--mn-ui)', fontSize: 13, fontWeight: 700, color: T.ink }}>{title}</div>
        <div style={{ fontFamily: 'var(--mn-mono)', fontSize: 10, color: T.inkDim }}>{items.length}</div>
      </div>
      <div style={{ display: 'grid', gap: 7 }}>
        {items.map(render)}
        {!items.length && <InlineEmpty>{empty}</InlineEmpty>}
      </div>
    </div>
  );

  const plainNoteText = (note) => String(note?.body || '')
    .replace(/::: plot-points[\s\S]*?:::/g, ' ')
    .split('\n')
    .filter(line => !/^\s*-?\s*[a-zA-Z][a-zA-Z0-9_-]*::\s*/.test(line))
    .join(' ')
    .replace(/\[\[([^\]]+)\]\]/g, '$1')
    .replace(/[#*_`>|-]/g, ' ');
  const wordCountForNote = (note) => plainNoteText(note).trim().split(/\s+/).filter(Boolean).length;
  const statusForNote = (note) => String((typeof mnBodyPropertyValue === 'function' ? mnBodyPropertyValue(note?.body || '', 'status') : '') || '').trim().toUpperCase() || 'NONE';
  const statRows = acts.map(act => {
    const actChapters = childrenForAct(act);
    const actScenes = actChapters.flatMap(chapter => childrenForChapter(chapter));
    return {
      act,
      chapters: actChapters,
      scenes: actScenes,
      words: wordCountForNote(act) + actChapters.reduce((sum, chapter) => sum + wordCountForNote(chapter), 0) + actScenes.reduce((sum, scene) => sum + wordCountForNote(scene), 0),
    };
  });
  const totalDraftWords = [...acts, ...chapters, ...scenes].reduce((sum, note) => sum + wordCountForNote(note), 0);
  const averageWordsPerScene = scenes.length ? Math.round(scenes.reduce((sum, scene) => sum + wordCountForNote(scene), 0) / scenes.length) : 0;
  const statusCounts = [...acts, ...chapters, ...scenes].reduce((acc, note) => {
    const key = statusForNote(note);
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
  const characterNotes = byTag('novel-character');
  const characterAliases = characterNotes.map(note => {
    const readProp = (key) => (typeof mnBodyPropertyValue === 'function' ? mnBodyPropertyValue(note.body || '', key) : '')
      .split(',')
      .map(value => value.replace(/\[\[([^\]]+)\]\]/g, '$1').trim())
      .filter(Boolean);
    const aliases = [...readProp('names'), ...readProp('name'), note.title || 'Untitled']
      .filter((value, index, arr) => arr.findIndex(item => item.toLowerCase() === value.toLowerCase()) === index);
    return { note, aliases };
  });
  const characterSceneCounts = characterAliases.map(character => ({
    ...character,
    sceneCounts: scenes.map(scene => {
      const haystack = plainNoteText(scene).toLowerCase();
      return character.aliases.reduce((sum, alias) => {
        const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        return sum + ((haystack.match(new RegExp(`\\b${escaped}\\b`, 'gi')) || []).length);
      }, 0);
    }),
  }));
  const maxCharacterHits = Math.max(1, ...characterSceneCounts.flatMap(row => row.sceneCounts));
  const completionCoverage = scenes.length
    ? Math.round((scenes.filter(scene => statusForNote(scene) === 'FINAL').length / scenes.length) * 100)
    : 0;

  const StatusSection = () => (
    <div style={{ display: 'grid', gap: 12 }}>
      <section style={{ border: `1px solid ${T.lineSub}`, borderRadius: 8, background: T.bg, padding: 12 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 8 }}>
          {[
            ['Draft words', totalDraftWords],
            ['Avg words / scene', averageWordsPerScene],
            ['Unlinked items', unlinkedChapters.length + unlinkedScenes.length],
            ['Scene completion', `${completionCoverage}%`],
          ].map(([label, value]) => (
            <div key={label} style={{ border: `1px solid ${T.lineSub}`, borderRadius: 7, background: T.bgSub, padding: 10 }}>
              <div style={{ fontFamily: 'var(--mn-mono)', fontSize: 10, color: T.inkDim, textTransform: 'uppercase' }}>{label}</div>
              <div style={{ marginTop: 5, fontFamily: 'var(--mn-ui)', fontSize: 22, fontWeight: 740, color: T.ink }}>{value}</div>
            </div>
          ))}
        </div>
      </section>
      <section style={{ border: `1px solid ${T.lineSub}`, borderRadius: 8, background: T.bg, padding: 12 }}>
        <div style={{ fontFamily: 'var(--mn-ui)', fontSize: 14, fontWeight: 720, color: T.ink, marginBottom: 10 }}>Word Count by Act</div>
        <div style={{ display: 'grid', gap: 8 }}>
          {statRows.map(row => (
            <div key={row.act.id} style={{ display: 'grid', gap: 6 }}>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center', fontFamily: 'var(--mn-ui)', fontSize: 12.5 }}>
                <strong style={{ color: T.ink, flex: 1 }}>{row.act.title}</strong>
                <span style={{ color: T.inkDim }}>{row.words} words</span>
              </div>
              <div style={{ height: 7, borderRadius: 999, background: T.bgSub, overflow: 'hidden' }}>
                <div style={{ width: `${Math.min(100, totalDraftWords ? (row.words / totalDraftWords) * 100 : 0)}%`, height: '100%', background: T.accent }} />
              </div>
              {row.chapters.map(chapter => (
                <div key={chapter.id} style={{ marginLeft: 12, display: 'flex', justifyContent: 'space-between', gap: 10, fontFamily: 'var(--mn-ui)', fontSize: 12, color: T.inkMed }}>
                  <span>{chapter.title}</span>
                  <span>{wordCountForNote(chapter) + childrenForChapter(chapter).reduce((sum, scene) => sum + wordCountForNote(scene), 0)} words</span>
                </div>
              ))}
            </div>
          ))}
          {!statRows.length && <InlineEmpty>Create acts to start status tracking.</InlineEmpty>}
        </div>
      </section>
      <section style={{ border: `1px solid ${T.lineSub}`, borderRadius: 8, background: T.bg, padding: 12 }}>
        <div style={{ fontFamily: 'var(--mn-ui)', fontSize: 14, fontWeight: 720, color: T.ink, marginBottom: 10 }}>Workflow Status Counts</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: 8 }}>
          {Object.entries(statusCounts).map(([status, count]) => (
            <div key={status} style={{ border: `1px solid ${T.lineSub}`, borderRadius: 7, background: T.bgSub, padding: 9 }}>
              <div style={{ fontFamily: 'var(--mn-mono)', fontSize: 10, color: T.inkDim }}>{status}</div>
              <div style={{ fontFamily: 'var(--mn-ui)', fontSize: 20, fontWeight: 700, color: T.ink, marginTop: 4 }}>{count}</div>
            </div>
          ))}
        </div>
      </section>
      <section style={{ border: `1px solid ${T.lineSub}`, borderRadius: 8, background: T.bg, padding: 12 }}>
        <div style={{ fontFamily: 'var(--mn-ui)', fontSize: 14, fontWeight: 720, color: T.ink, marginBottom: 10 }}>Character Appearance Heat Map</div>
        <div style={{ overflowX: 'auto' }}>
          <div style={{ display: 'grid', gridTemplateColumns: `140px repeat(${Math.max(1, scenes.length)}, 42px)`, gap: 3, alignItems: 'center' }}>
            <div />
            {scenes.map(scene => <div key={scene.id} title={scene.title} style={{ fontFamily: 'var(--mn-mono)', fontSize: 9, color: T.inkDim, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{scene.title}</div>)}
            {characterSceneCounts.map(row => (
              <React.Fragment key={row.note.id}>
                <div style={{ fontFamily: 'var(--mn-ui)', fontSize: 12, color: T.ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.note.title}</div>
                {row.sceneCounts.map((count, index) => (
                  <div key={`${row.note.id}:${index}`} title={`${count} mention${count === 1 ? '' : 's'}`} style={{
                    height: 24,
                    borderRadius: 4,
                    border: `1px solid ${T.lineSub}`,
                    background: count ? `color-mix(in oklab, ${T.accent} ${Math.min(85, 18 + (count / maxCharacterHits) * 67)}%, ${T.bgSub})` : T.bgSub,
                    fontFamily: 'var(--mn-mono)',
                    fontSize: 10,
                    color: count ? T.bg : T.inkDim,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}>{count || ''}</div>
                ))}
              </React.Fragment>
            ))}
          </div>
        </div>
        {!characterSceneCounts.length && <div style={{ marginTop: 8 }}><InlineEmpty>Create character notes with names:: aliases to populate the heat map.</InlineEmpty></div>}
      </section>
    </div>
  );

  const AiConfigurationSection = () => (
    <section style={{ border: `1px solid ${T.lineSub}`, borderRadius: 8, background: T.bg, padding: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <div style={{ fontFamily: 'var(--mn-ui)', fontSize: 14, fontWeight: 700, color: T.ink }}>AI Config</div>
        <div style={{ fontFamily: 'var(--mn-mono)', fontSize: 10, color: T.inkDim }}>v{aiConfig.version || 2}</div>
        <div style={{ flex: 1 }} />
        <button onClick={addAiPrompt} style={mnPanelMiniButton(T)}>+ Prompt</button>
      </div>
      <div style={{ display: 'grid', gap: 12 }}>
        <div style={{ border: `1px solid ${T.lineSub}`, borderRadius: 7, background: T.bgSub, padding: 10 }}>
          <div style={{ fontFamily: 'var(--mn-mono)', fontSize: 10, color: T.inkDim, textTransform: 'uppercase', marginBottom: 8 }}>General</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 8 }}>
            <label style={{ display: 'grid', gap: 5, fontFamily: 'var(--mn-ui)', fontSize: 12, color: T.inkMed }}>
              <span>Preset</span>
              <select value={aiConfig.preset || ''} onChange={(e) => updateAiConfig(current => ({ ...current, preset: e.target.value }))} style={mnPanelInputStyle(T)}>
                {['Balanced draft', 'Fast outline', 'Line edit', 'Continuity pass'].map(preset => <option key={preset} value={preset}>{preset}</option>)}
              </select>
            </label>
            <label style={{ display: 'grid', gap: 5, fontFamily: 'var(--mn-ui)', fontSize: 12, color: T.inkMed }}>
              <span>Model collection</span>
              <select value={aiConfig.activeModelCollectionId || ''} onChange={(e) => updateAiConfig(current => ({ ...current, activeModelCollectionId: e.target.value }))} style={mnPanelInputStyle(T)}>
                {(aiConfig.modelCollections || []).map(collection => <option key={collection.id} value={collection.id}>{collection.name}</option>)}
              </select>
            </label>
            <label style={{ display: 'grid', gap: 5, fontFamily: 'var(--mn-ui)', fontSize: 12, color: T.inkMed }}>
              <span>Model override</span>
              <input value={aiConfig.model || ''} onChange={(e) => updateAiConfig(current => ({ ...current, model: e.target.value }))} placeholder="Use global AI model" style={mnPanelInputStyle(T)} />
            </label>
            <label style={{ display: 'grid', gap: 5, fontFamily: 'var(--mn-ui)', fontSize: 12, color: T.inkMed }}>
              <span>Prompt type</span>
              <select value={aiConfig.promptType || 'draft'} onChange={(e) => updateAiConfig(current => ({ ...current, promptType: e.target.value }))} style={mnPanelInputStyle(T)}>
                <option value="draft">Draft</option>
                <option value="revise">Revise</option>
                <option value="summarize">Summarize</option>
                <option value="analyze">Analyze</option>
              </select>
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 7, fontFamily: 'var(--mn-ui)', fontSize: 12, color: T.inkMed }}>
              <input type="checkbox" checked={aiConfig.moderation !== false} onChange={(e) => updateAiConfig(current => ({ ...current, moderation: e.target.checked }))} />
              <span>Moderation enabled</span>
            </label>
          </div>
        </div>
        <div style={{ border: `1px solid ${T.lineSub}`, borderRadius: 7, background: T.bgSub, padding: 10 }}>
          <div style={{ fontFamily: 'var(--mn-mono)', fontSize: 10, color: T.inkDim, textTransform: 'uppercase', marginBottom: 8 }}>Instructions</div>
          <div style={{ display: 'grid', gap: 8 }}>
            <label style={{ display: 'grid', gap: 5, fontFamily: 'var(--mn-ui)', fontSize: 12, color: T.inkMed }}>
              <span>Words</span>
              <input type="number" min="100" max="12000" step="50" value={aiWordLimitDraft} onChange={(e) => setAiWordLimitDraft(e.target.value)} onBlur={commitAiWordLimit} onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }} style={{ ...mnPanelInputStyle(T), width: 150 }} />
            </label>
            <label style={{ display: 'grid', gap: 5, fontFamily: 'var(--mn-ui)', fontSize: 12, color: T.inkMed }}>
              <span>Instructions</span>
              <textarea value={aiConfig.instructions || ''} onChange={(e) => updateAiConfig(current => ({ ...current, instructions: e.target.value }))} rows={3} style={mnPanelTextareaStyle(T)} />
            </label>
            <label style={{ display: 'grid', gap: 5, fontFamily: 'var(--mn-ui)', fontSize: 12, color: T.inkMed }}>
              <span>Additional Context</span>
              <textarea value={aiConfig.additionalContext || ''} onChange={(e) => updateAiConfig(current => ({ ...current, additionalContext: e.target.value }))} rows={3} style={mnPanelTextareaStyle(T)} />
            </label>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', fontFamily: 'var(--mn-ui)', fontSize: 12, color: T.inkMed }}>
              {Object.keys(aiConfig.includedComponents || {}).map(key => (
                <label key={key} style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
                  <input type="checkbox" checked={!!aiConfig.includedComponents?.[key]} onChange={(e) => updateAiConfig(current => ({ ...current, includedComponents: { ...(current.includedComponents || {}), [key]: e.target.checked } }))} />
                  <span>{key.replace(/([A-Z])/g, ' $1')}</span>
                </label>
              ))}
            </div>
          </div>
        </div>
        <div style={{ border: `1px solid ${T.lineSub}`, borderRadius: 7, background: T.bgSub, padding: 10 }}>
          <div style={{ fontFamily: 'var(--mn-mono)', fontSize: 10, color: T.inkDim, textTransform: 'uppercase', marginBottom: 8 }}>Advanced</div>
          <div style={{ display: 'grid', gap: 8 }}>
            <label style={{ display: 'grid', gap: 5, fontFamily: 'var(--mn-ui)', fontSize: 12, color: T.inkMed }}>
              <span>System message</span>
              <textarea value={aiConfig.systemMessage || ''} onChange={(e) => updateAiConfig(current => ({ ...current, systemMessage: e.target.value }))} rows={3} style={mnPanelTextareaStyle(T)} />
            </label>
            <label style={{ display: 'grid', gap: 5, fontFamily: 'var(--mn-ui)', fontSize: 12, color: T.inkMed }}>
              <span>User message</span>
              <textarea value={aiConfig.userMessage || ''} onChange={(e) => updateAiConfig(current => ({ ...current, userMessage: e.target.value }))} rows={3} style={mnPanelTextareaStyle(T)} />
            </label>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 8 }}>
              <label style={{ display: 'grid', gap: 5, fontFamily: 'var(--mn-ui)', fontSize: 12, color: T.inkMed }}>
                <span>Temperature</span>
                <input value={aiConfig.advanced?.temperature || ''} onChange={(e) => updateAiConfig(current => ({ ...current, advanced: { ...(current.advanced || {}), temperature: e.target.value } }))} placeholder="provider default" style={mnPanelInputStyle(T)} />
              </label>
              <label style={{ display: 'grid', gap: 5, fontFamily: 'var(--mn-ui)', fontSize: 12, color: T.inkMed }}>
                <span>Max tokens</span>
                <input value={aiConfig.advanced?.maxTokens || ''} onChange={(e) => updateAiConfig(current => ({ ...current, advanced: { ...(current.advanced || {}), maxTokens: e.target.value } }))} placeholder="provider default" style={mnPanelInputStyle(T)} />
              </label>
            </div>
          </div>
        </div>
      </div>
      {!!(aiConfig.prompts || []).length && (
        <label style={{ display: 'grid', gap: 5, margin: '12px 0 10px', fontFamily: 'var(--mn-ui)', fontSize: 12, color: T.inkMed }}>
          <span>Default writing prompt</span>
          <select
            value={aiConfig.defaultPromptId || ''}
            onChange={(e) => updateAiConfig(current => ({ ...current, defaultPromptId: e.target.value }))}
            style={{ ...mnPanelInputStyle(T), maxWidth: 260 }}>
            {(aiConfig.prompts || []).map(prompt => (
              <option key={prompt.id} value={prompt.id}>{prompt.name || 'Untitled prompt'}</option>
            ))}
          </select>
        </label>
      )}
      <div style={{ display: 'grid', gap: 8 }}>
        {(aiConfig.prompts || []).map(prompt => (
          <div
            key={prompt.id}
            style={{
              border: `1px solid ${T.lineSub}`,
              borderRadius: 7,
              background: T.bgSub,
              padding: 8,
            }}>
            <div style={{ display: 'flex', gap: 7, alignItems: 'center', marginBottom: 7 }}>
              <input
                aria-label="Prompt name"
                value={prompt.name}
                onChange={(e) => updateAiPrompt(prompt.id, { name: e.target.value })}
                placeholder="Prompt name"
                style={{
                  minWidth: 0,
                  flex: 1,
                  border: `1px solid ${T.lineSub}`,
                  borderRadius: 6,
                  background: T.bg,
                  color: T.ink,
                  padding: '6px 8px',
                  fontFamily: 'var(--mn-ui)',
                  fontSize: 12.5,
                  outline: 'none',
                }}
              />
              <button
                onClick={() => removeAiPrompt(prompt.id)}
                style={{ ...mnPanelMiniButton(T), color: T.inkDim }}>
                Remove
              </button>
            </div>
            <textarea
              aria-label={`${prompt.name || 'Prompt'} instructions`}
              value={prompt.prompt}
              onChange={(e) => updateAiPrompt(prompt.id, { prompt: e.target.value })}
              placeholder="Writing prompt"
              rows={3}
              style={{
                width: '100%',
                minHeight: 76,
                resize: 'vertical',
                border: `1px solid ${T.lineSub}`,
                borderRadius: 6,
                background: T.bg,
                color: T.ink,
                padding: '7px 8px',
                fontFamily: 'var(--mn-body)',
                fontSize: 12.5,
                lineHeight: 1.45,
                outline: 'none',
                boxSizing: 'border-box',
              }}
            />
          </div>
        ))}
        {!(aiConfig.prompts || []).length && <InlineEmpty>Add a prompt for AI writing.</InlineEmpty>}
      </div>
    </section>
  );

  return (
    <div style={{
      flex: 1,
      height: '100%',
      overflow: 'auto',
      background: T.bgSub,
      padding: '24px 32px',
      color: T.ink,
    }}>
      <div style={{ maxWidth: 1120, margin: '0 auto' }}>
        <header style={{
          border: `1px solid ${T.lineSub}`,
          borderRadius: 8,
          background: T.bg,
          padding: 14,
          marginBottom: 14,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: 210 }}>
              <div style={{ fontFamily: 'var(--mn-ui)', fontSize: 22, fontWeight: 740, color: T.ink }}>Novelist</div>
              <div style={{ marginTop: 4, display: 'flex', gap: 12, flexWrap: 'wrap', fontFamily: 'var(--mn-ui)', fontSize: 12.5, color: T.inkDim }}>
                <span>{novelNotes.length} story note{novelNotes.length === 1 ? '' : 's'}</span>
                <span>{acts.length} act{acts.length === 1 ? '' : 's'}</span>
                <span>{chapters.length} chapter{chapters.length === 1 ? '' : 's'}</span>
                <span>{scenes.length} scene{scenes.length === 1 ? '' : 's'}</span>
              </div>
            </div>
            {linkNotice && (
              <div style={{
                fontFamily: 'var(--mn-ui)',
                fontSize: 12,
                color: T.accent,
                background: T.accentSoft,
                border: `1px solid color-mix(in oklab, ${T.accent} 25%, transparent)`,
                borderRadius: 999,
                padding: '4px 9px',
                maxWidth: 360,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}>
                {linkNotice.text}
              </div>
            )}
          </div>
          <div style={{ display: 'flex', gap: 6, marginTop: 12, borderTop: `1px solid ${T.lineSub}`, paddingTop: 10 }}>
            {[
              ['plan', 'Plan'],
              ['status', 'Status'],
              ['aiconfig', 'AI Config'],
            ].map(([id, label]) => (
              <button
                key={id}
                onClick={() => setActiveTab(id)}
                style={{
                  ...mnPanelMiniButton(T),
                  background: activeTab === id ? T.ink : T.bgSub,
                  color: activeTab === id ? T.bg : T.inkMed,
                  border: `1px solid ${activeTab === id ? T.ink : T.lineSub}`,
                }}>
                {label}
              </button>
            ))}
          </div>
        </header>

        {activeTab === 'plan' && (
          <>
        <section style={{
          border: `1px solid ${T.lineSub}`,
          borderRadius: 8,
          background: T.bgSub,
          padding: 12,
          marginBottom: 14,
        }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 10 }}>
            <div style={{ fontFamily: 'var(--mn-ui)', fontSize: 15, fontWeight: 750, color: T.ink }}>Story Structure</div>
            <div style={{ fontFamily: 'var(--mn-mono)', fontSize: 10.5, color: T.inkDim }}>{'Act -> Chapter -> Scene'}</div>
          </div>
          <div style={{ display: 'grid', gap: 10 }}>
            {acts.length
              ? acts.map(act => <ActRow key={act.id} act={act} />)
              : <InlineEmpty>Create an act to group chapters.</InlineEmpty>}
          </div>
          {(unlinkedChapters.length > 0 || unlinkedScenes.length > 0) && (
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
              gap: 10,
              marginTop: 10,
            }}>
              {unlinkedChapters.length > 0 && (
                <LooseStructureSection
                  title="Unlinked chapters"
                  items={unlinkedChapters}
                  empty="No unlinked chapters"
                  render={chapter => (
                    <div key={chapter.id} style={{ display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'wrap' }}>
                      <StructureNoteButton note={chapter} label="Chapter" count={childrenForChapter(chapter).length} depth={1} />
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setLinkMenu({ type: 'attach-chapter', childId: chapter.id, x: e.clientX, y: e.clientY });
                        }}
                        style={mnPanelMiniButton(T)}>
                        Attach to act
                      </button>
                      <button onClick={() => createParentActForChapter(chapter)} style={mnPanelMiniButton(T)}>
                        Create parent act
                      </button>
                      <button
                        onClick={() => onConvertNoteType?.(chapter.id, 'novel-scene')}
                        style={mnPanelMiniButton(T)}>
                        Convert to scene
                      </button>
                    </div>
                  )}
                />
              )}
              {unlinkedScenes.length > 0 && (
                <LooseStructureSection
                  title="Unlinked scenes"
                  items={unlinkedScenes}
                  empty="No unlinked scenes"
                  render={scene => (
                    <div key={scene.id} style={{ display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'wrap' }}>
                      <StructureNoteButton note={scene} label="Scene" depth={1} />
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setLinkMenu({ type: 'attach-scene', childId: scene.id, x: e.clientX, y: e.clientY });
                        }}
                        style={mnPanelMiniButton(T)}>
                        Attach to chapter
                      </button>
                      <button onClick={() => createParentChapterForScene(scene)} style={mnPanelMiniButton(T)}>
                        Create parent chapter
                      </button>
                    </div>
                  )}
                />
              )}
            </div>
          )}
        </section>

        <section style={{
          border: `1px solid ${T.lineSub}`,
          borderRadius: 8,
          background: T.bgSub,
          padding: 12,
          marginBottom: 14,
        }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 10 }}>
            <div style={{ fontFamily: 'var(--mn-ui)', fontSize: 15, fontWeight: 750, color: T.ink }}>Supporting Notes</div>
            <div style={{ fontFamily: 'var(--mn-mono)', fontSize: 10.5, color: T.inkDim }}>
              {supportingTotal} notes
            </div>
            <div style={{ flex: 1 }} />
            <button
              onClick={() => setAddingSupportType(value => !value)}
              style={mnPanelMiniButton(T)}>
              Add type
            </button>
          </div>
          {addingSupportType && (
            <div
              onClick={(e) => e.stopPropagation()}
              style={{
                display: 'flex',
                gap: 7,
                alignItems: 'center',
                flexWrap: 'wrap',
                border: `1px solid ${T.lineSub}`,
                borderRadius: 7,
                background: T.bg,
                padding: 8,
                marginBottom: 10,
              }}>
              <input
                value={supportTypeDraft}
                onChange={(e) => setSupportTypeDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') addSupportingType();
                  if (e.key === 'Escape') {
                    setSupportTypeDraft('');
                    setAddingSupportType(false);
                  }
                }}
                placeholder="type name, e.g. Theme"
                style={{
                  minWidth: 190,
                  flex: 1,
                  border: `1px solid ${T.lineSub}`,
                  borderRadius: 6,
                  background: T.bgSub,
                  color: T.ink,
                  padding: '6px 8px',
                  fontFamily: 'var(--mn-ui)',
                  fontSize: 12.5,
                  outline: 'none',
                }}
              />
              <button onClick={addSupportingType} style={mnPanelMiniButton(T)}>Add</button>
              <button
                onClick={() => {
                  setSupportTypeDraft('');
                  setAddingSupportType(false);
                }}
                style={{ ...mnPanelMiniButton(T), color: T.inkDim }}>
                Cancel
              </button>
            </div>
          )}
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
            gap: 10,
          }}>
            {supportingTypes.map(type => (
              <Section
                key={type.tag}
                type={type}
                items={byTag(type.tag)}
                empty={`Create a ${type.label.toLowerCase()} note.`}
              />
            ))}
            {!supportingTypes.length && <InlineEmpty>Add a supporting note type to organize story material.</InlineEmpty>}
          </div>
        </section>
          </>
        )}
        {activeTab === 'status' && <StatusSection />}
        {activeTab === 'aiconfig' && <AiConfigurationSection />}
      </div>
      {editDialog && (
        <div
          onClick={() => setEditDialog(null)}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 130,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: `color-mix(in oklab, ${T.ink} 24%, transparent)`,
            backdropFilter: 'blur(2px)',
          }}>
          <div
            role="dialog"
            aria-modal="true"
            aria-label={editDialog.type === 'rename' ? 'Rename note' : 'Set order'}
            onClick={(e) => e.stopPropagation()}
            style={{
              width: 360,
              maxWidth: 'calc(100vw - 36px)',
              border: `1px solid ${T.line}`,
              borderRadius: 9,
              background: T.bg,
              color: T.ink,
              boxShadow: `0 22px 60px color-mix(in oklab, ${T.ink} 24%, transparent)`,
              overflow: 'hidden',
              fontFamily: 'var(--mn-ui)',
            }}>
            <div style={{
              padding: '13px 15px',
              borderBottom: `1px solid ${T.lineSub}`,
              background: T.bgSub,
            }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: T.ink }}>
                {editDialog.type === 'rename' ? 'Rename note' : 'Set order'}
              </div>
              <div style={{
                marginTop: 3,
                fontSize: 12,
                color: T.inkDim,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}>
                {editDialog.note?.title || 'Untitled'}
              </div>
            </div>
            <div style={{ padding: 15 }}>
              <input
                ref={editInputRef}
                value={editDialog.value}
                onChange={(e) => setEditDialog(current => current ? { ...current, value: e.target.value, error: '' } : current)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    submitEditDialog();
                  }
                  if (e.key === 'Escape') {
                    e.preventDefault();
                    setEditDialog(null);
                  }
                }}
                placeholder={editDialog.type === 'rename' ? 'Note title' : 'Blank or numeric order'}
                style={{
                  width: '100%',
                  boxSizing: 'border-box',
                  height: 34,
                  border: `1px solid ${editDialog.error ? T.danger || T.warn : T.lineSub}`,
                  borderRadius: 6,
                  background: T.bgSub,
                  color: T.ink,
                  outline: 'none',
                  padding: '0 9px',
                  fontFamily: editDialog.type === 'order' ? 'var(--mn-mono)' : 'var(--mn-ui)',
                  fontSize: 13,
                }}
              />
              {editDialog.error && (
                <div style={{
                  marginTop: 7,
                  color: T.danger || T.warn,
                  fontSize: 12,
                  lineHeight: 1.35,
                }}>
                  {editDialog.error}
                </div>
              )}
              {editDialog.type === 'order' && (
                <div style={{
                  marginTop: 7,
                  color: T.inkDim,
                  fontSize: 11.5,
                  lineHeight: 1.4,
                }}>
                  Leave blank to remove order:: from this note.
                </div>
              )}
            </div>
            <div style={{
              display: 'flex',
              justifyContent: 'flex-end',
              gap: 8,
              padding: '0 15px 15px',
            }}>
              <button
                onClick={() => setEditDialog(null)}
                style={{ ...mnPanelMiniButton(T), background: T.bg, color: T.inkMed }}>
                Cancel
              </button>
              <button
                onClick={submitEditDialog}
                style={{
                  ...mnPanelMiniButton(T),
                  background: T.ink,
                  color: T.bg,
                  border: `1px solid ${T.ink}`,
                }}>
                Save
              </button>
            </div>
          </div>
        </div>
      )}
      <AttachMenu />
      {noteMenu && (
        <div
          onClick={(e) => e.stopPropagation()}
          style={{
            position: 'fixed',
            left: noteMenu.x,
            top: noteMenu.y,
            zIndex: 120,
            minWidth: 170,
            border: `1px solid ${T.lineSub}`,
            borderRadius: 7,
            background: T.bg,
            boxShadow: `0 14px 34px color-mix(in oklab, ${T.ink} 18%, transparent)`,
            padding: 4,
          }}>
          <button
            onClick={() => {
              onOpen?.(noteMenu.note.id);
              setNoteMenu(null);
            }}
            style={mnPanelMenuItem(T)}>
            Open note
          </button>
          <button
            onClick={() => {
              promptRename(noteMenu.note);
              setNoteMenu(null);
            }}
            style={mnPanelMenuItem(T)}>
            Rename
          </button>
          <button
            onClick={() => {
              promptSetOrder(noteMenu.note);
              setNoteMenu(null);
            }}
            style={mnPanelMenuItem(T)}>
            Set order
          </button>
          <button
            onClick={() => {
              onDeleteNote?.(noteMenu.note.id);
              setNoteMenu(null);
            }}
            style={{ ...mnPanelMenuItem(T), color: T.danger || T.warn }}>
            Delete note
          </button>
        </div>
      )}
      {createMenu && (
        <div
          onClick={(e) => e.stopPropagation()}
          style={{
            position: 'fixed',
            left: createMenu.x,
            top: createMenu.y,
            zIndex: 125,
            minWidth: 230,
            maxWidth: 320,
            border: `1px solid ${T.lineSub}`,
            borderRadius: 7,
            background: T.bg,
            boxShadow: `0 14px 34px color-mix(in oklab, ${T.ink} 18%, transparent)`,
            padding: 4,
          }}>
          <div style={{
            padding: '7px 10px 6px',
            fontFamily: 'var(--mn-ui)',
            fontSize: 12,
            color: T.inkMed,
            borderBottom: `1px solid ${T.lineSub}`,
            marginBottom: 4,
          }}>
            {createMenu.type === 'chapter' ? 'Choose act for new Chapter' : 'Choose chapter for new Scene'}
          </div>
          {(createMenu.type === 'chapter' ? acts : chapters).map(parent => (
            <button
              key={parent.id}
              onClick={() => {
                if (createMenu.type === 'chapter') createChapterForAct(parent);
                else createSceneForChapter(parent);
                setCreateMenu(null);
              }}
              style={mnPanelMenuItem(T)}>
              {parent.title || 'Untitled'}
            </button>
          ))}
          <div style={{ height: 1, background: T.lineSub, margin: '4px 6px' }} />
          <button
            onClick={() => {
              const template = createMenu.type === 'chapter'
                ? templates.find(item => item.title === 'Chapter')
                : templates.find(item => item.title === 'Scene');
              if (template) {
                const title = uniqueTitle(template.title);
                onCreateNote && onCreateNote({ ...template, title, body: template.body });
              }
              setCreateMenu(null);
            }}
            style={{ ...mnPanelMenuItem(T), color: T.inkDim }}>
            Create standalone
          </button>
        </div>
      )}
    </div>
  );
}

function mnPanelButton(T, primary = false) {
  return {
    minHeight: 34,
    borderRadius: 7,
    border: `1px solid ${primary ? T.ink : T.line}`,
    background: primary ? T.ink : T.bg,
    color: primary ? T.bg : T.inkMed,
    fontFamily: 'var(--mn-ui)',
    fontSize: 12.5,
    fontWeight: 600,
    cursor: 'pointer',
    padding: '7px 11px',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
  };
}

function mnPanelMiniButton(T) {
  return {
    minHeight: 26,
    borderRadius: 6,
    border: `1px solid ${T.lineSub}`,
    background: T.bgSub,
    color: T.inkMed,
    fontFamily: 'var(--mn-ui)',
    fontSize: 11.5,
    fontWeight: 600,
    cursor: 'pointer',
    padding: '4px 8px',
  };
}

function mnPanelInputStyle(T) {
  return {
    minHeight: 32,
    border: `1px solid ${T.lineSub}`,
    borderRadius: 6,
    background: T.bg,
    color: T.ink,
    padding: '6px 8px',
    fontFamily: 'var(--mn-ui)',
    fontSize: 12.5,
    outline: 'none',
    boxSizing: 'border-box',
  };
}

function mnPanelTextareaStyle(T) {
  return {
    width: '100%',
    minHeight: 76,
    resize: 'vertical',
    border: `1px solid ${T.lineSub}`,
    borderRadius: 6,
    background: T.bg,
    color: T.ink,
    padding: '7px 8px',
    fontFamily: 'var(--mn-body)',
    fontSize: 12.5,
    lineHeight: 1.45,
    outline: 'none',
    boxSizing: 'border-box',
  };
}

function mnPanelMenuItem(T) {
  return {
    width: '100%',
    border: 'none',
    borderRadius: 5,
    background: 'transparent',
    color: T.ink,
    cursor: 'pointer',
    padding: '8px 10px',
    textAlign: 'left',
    fontFamily: 'var(--mn-ui)',
    fontSize: 12.5,
  };
}

// ────────────────────────────────────────────────────────────
// Workflow aggregate panel
// ────────────────────────────────────────────────────────────
function MnWorkflowPanel({
  workflowStates, workflowItems, archivedNotes = [], tags,
  onOpen, onWorkflowStatesChange, onSetWorkflow, onSetWorkflowArchived, onSetNoteTags, T, theme
}) {
  const [mode, setMode] = useStateP('kanban');
  const [dragItem, setDragItem] = useStateP(null);
  const [dragOverState, setDragOverState] = useStateP(null);
  const [dragPreview, setDragPreview] = useStateP(null);
  const [showArchived, setShowArchived] = useStateP(false);
  const [stateDraft, setStateDraft] = useStateP('');
  const dragItemRef = useRefP(null);
  const suppressCardClickRef = useRefP(false);
  const cardDragCleanupRef = useRefP(null);
  const tagHue = useMemoP(() => {
    const m = {}; tags.forEach(t => m[t.name] = t.hue); return m;
  }, [tags]);
  const countFor = (id) => (workflowItems?.[id] || []).length;
  const total = (workflowStates || []).reduce((sum, state) => {
    return sum + countFor(state.id);
  }, 0);
  const populatedStateCount = (workflowStates || []).filter(state => countFor(state.id) > 0).length;
  const stateCount = Math.max(1, (workflowStates || []).length);
  const kanbanMinWidth = Math.max(760, stateCount * 172);
  const normalizeStateId = (raw) => window.MN_LOGSEQ?.mnNormalizeWorkflowId
    ? window.MN_LOGSEQ.mnNormalizeWorkflowId(raw)
    : String(raw || '').trim().toUpperCase().replace(/[^A-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 18);
  const normalizeStates = (states) => window.MN_LOGSEQ?.mnNormalizeWorkflowStates
    ? (Array.isArray(states) && states.length === 0 ? [] : window.MN_LOGSEQ.mnNormalizeWorkflowStates(states))
    : states;
  const isClosedState = (state) => window.MN_LOGSEQ?.mnWorkflowIsClosed
    ? window.MN_LOGSEQ.mnWorkflowIsClosed(state)
    : state?.next === null;
  const stateColor = (index) => {
    const hues = [30, 250, 145, 290, 15, 60, 205, 330, 115, 275, 180, 5];
    return hues[index % hues.length];
  };

  const dragTypes = (event) => Array.from(event?.dataTransfer?.types || []);
  const hasWorkflowDropData = (event) => {
    const types = dragTypes(event);
    return !!dragItemRef.current || !!dragItem || types.includes('text/mn-workflow') || types.includes('text/mn-note') || types.includes('text/plain');
  };
  const readDropNoteId = (event) => {
    if (dragItemRef.current?.noteId) return dragItemRef.current.noteId;
    if (dragItem?.noteId) return dragItem.noteId;
    for (const type of ['text/mn-workflow', 'text/mn-note']) {
      const raw = event.dataTransfer.getData(type);
      if (!raw) continue;
      try {
        const parsed = JSON.parse(raw);
        if (parsed?.noteId) return parsed.noteId;
      } catch {}
    }
    const plain = event.dataTransfer.getData('text/plain') || '';
    const match = plain.match(/^mn-note:(.+)$/);
    return match ? match[1] : '';
  };
  const moveWorkflowNote = (noteId, itemId, stateId, currentWorkflow = null) => {
    if (!noteId || currentWorkflow === stateId) return;
    onSetWorkflow && onSetWorkflow(noteId, itemId || null, stateId);
  };
  const moveItem = (item, stateId) => {
    if (!item) return;
    moveWorkflowNote(item.noteId, item.id, stateId, item.workflow);
  };
  const setActiveDragItem = (item) => {
    dragItemRef.current = item || null;
    setDragItem(item || null);
  };
  const clearActiveDragItem = () => {
    dragItemRef.current = null;
    setDragItem(null);
    setDragOverState(null);
    setDragPreview(null);
  };
  useEffectP(() => {
    return () => {
      cardDragCleanupRef.current?.();
      cardDragCleanupRef.current = null;
    };
  }, []);
  const updateDragPreview = (item, state, event) => {
    if (!item || !event?.clientX || !event?.clientY) return;
    setDragPreview({
      item,
      stateId: state?.id || item.workflow,
      x: event.clientX,
      y: event.clientY,
    });
  };
  const setTransparentDragImage = (event) => {
    try {
      const canvas = document.createElement('canvas');
      canvas.width = 1;
      canvas.height = 1;
      event.dataTransfer.setDragImage(canvas, 0, 0);
    } catch {}
  };
  const workflowStateFromPoint = (clientX, clientY) => {
    const target = document.elementFromPoint(clientX, clientY);
    return target?.closest?.('[data-mn-workflow-state]')?.getAttribute('data-mn-workflow-state') || '';
  };
  const beginCardPointerDrag = (event, item) => {
    if (event.button !== 0) return;
    if (event.target?.closest?.('button, select, input, textarea, a')) return;
    const startX = event.clientX;
    const startY = event.clientY;
    let active = false;
    const onMove = (moveEvent) => {
      const distance = Math.hypot(moveEvent.clientX - startX, moveEvent.clientY - startY);
      if (!active && distance < 5) return;
      active = true;
      suppressCardClickRef.current = true;
      setActiveDragItem(item);
      const stateId = workflowStateFromPoint(moveEvent.clientX, moveEvent.clientY);
      setDragOverState(stateId);
      updateDragPreview(item, stateId ? (workflowStates || []).find(state => state.id === stateId) : null, moveEvent);
      moveEvent.preventDefault();
    };
    const onUp = (upEvent) => {
      cleanup();
      const stateId = active ? workflowStateFromPoint(upEvent.clientX, upEvent.clientY) : '';
      if (stateId) moveItem(item, stateId);
      clearActiveDragItem();
      if (active) window.setTimeout(() => { suppressCardClickRef.current = false; }, 0);
    };
    const cleanup = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      if (cardDragCleanupRef.current === cleanup) cardDragCleanupRef.current = null;
    };
    cardDragCleanupRef.current?.();
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    cardDragCleanupRef.current = cleanup;
  };

  const archiveNote = (noteId, archived) => {
    onSetWorkflowArchived && onSetWorkflowArchived(noteId, archived);
  };

  const addWorkflowState = () => {
    const id = normalizeStateId(stateDraft);
    if (!id || (workflowStates || []).some(state => state.id === id)) return;
    const hue = stateColor((workflowStates || []).length);
    const next = normalizeStates([
      ...(workflowStates || []),
      {
        id,
        color: `oklch(0.55 0.16 ${hue})`,
        bg: `oklch(0.95 0.04 ${hue})`,
      },
    ]);
    onWorkflowStatesChange && onWorkflowStatesChange(next);
    setStateDraft('');
  };

  const removeWorkflowState = (stateId) => {
    onWorkflowStatesChange && onWorkflowStatesChange(
      normalizeStates((workflowStates || []).filter(state => state.id !== stateId))
    );
  };

  const ModeButton = ({ id, label }) => (
    <button onClick={() => setMode(id)} style={{
      padding: '5px 10px',
      borderRadius: 5,
      border: 'none',
      background: mode === id ? T.bg : 'transparent',
      color: mode === id ? T.ink : T.inkMed,
      fontFamily: 'var(--mn-ui)',
      fontSize: 12,
      fontWeight: mode === id ? 600 : 500,
      cursor: 'pointer',
      boxShadow: mode === id ? `0 1px 3px color-mix(in oklab, ${T.ink} 10%, transparent)` : 'none',
    }}>{label}</button>
  );

  const renderWorkflowStateManager = () => (
    <div style={{
      border: `1px solid ${T.lineSub}`,
      borderRadius: 8,
      background: T.bgSub,
      padding: 9,
      marginBottom: 14,
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      flexWrap: 'wrap',
    }}>
      <span style={{
        fontFamily: 'var(--mn-mono)',
        fontSize: 10,
        color: T.inkDim,
        letterSpacing: '0.1em',
        textTransform: 'uppercase',
        marginRight: 2,
      }}>Columns</span>
      {(workflowStates || []).map(state => (
        <span key={state.id} style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 4,
          padding: '2px 3px 2px 6px',
          borderRadius: 4,
          background: state.bg,
          color: state.color,
          fontFamily: 'var(--mn-mono)',
          fontSize: 9.5,
          fontWeight: 700,
          letterSpacing: '0.06em',
        }}>
          {state.id}
          <button
            type="button"
            title={`Remove ${state.id}`}
            onClick={() => removeWorkflowState(state.id)}
            style={{
              width: 16,
              height: 16,
              border: 'none',
              borderRadius: 3,
              background: 'transparent',
              color: 'currentColor',
              cursor: 'pointer',
              opacity: 0.75,
              padding: 0,
              lineHeight: 1,
            }}>x</button>
        </span>
      ))}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 5,
        marginLeft: 'auto',
        minWidth: 190,
      }}>
        <input
          value={stateDraft}
          onChange={(e) => setStateDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              addWorkflowState();
            }
          }}
          placeholder="new column"
          style={{
            minWidth: 0,
            flex: 1,
            height: 26,
            border: `1px solid ${T.line}`,
            borderRadius: 5,
            background: T.bg,
            color: T.ink,
            fontFamily: 'var(--mn-ui)',
            fontSize: 12,
            padding: '0 8px',
            outline: 'none',
          }}
        />
        <button
          type="button"
          onClick={addWorkflowState}
          disabled={!normalizeStateId(stateDraft)}
          style={{
            height: 26,
            padding: '0 9px',
            borderRadius: 5,
            border: `1px solid ${T.line}`,
            background: normalizeStateId(stateDraft) ? T.ink : T.bg,
            color: normalizeStateId(stateDraft) ? T.bg : T.inkDim,
            fontFamily: 'var(--mn-ui)',
            fontSize: 12,
            cursor: normalizeStateId(stateDraft) ? 'pointer' : 'default',
          }}>Add</button>
      </div>
    </div>
  );

  const SummaryStat = ({ label, value, accent }) => (
    <div style={{
      minWidth: 92,
      padding: '8px 10px',
      borderRadius: 7,
      border: `1px solid ${T.lineSub}`,
      background: `color-mix(in oklab, ${accent || T.bgSub} 12%, ${T.bg})`,
      display: 'flex',
      alignItems: 'baseline',
      justifyContent: 'space-between',
      gap: 10,
    }}>
      <span style={{
        fontFamily: 'var(--mn-mono)',
        fontSize: 10,
        color: T.inkDim,
        letterSpacing: '0.08em',
        textTransform: 'uppercase',
        whiteSpace: 'nowrap',
      }}>{label}</span>
      <span style={{
        fontFamily: 'var(--mn-ui)',
        fontSize: 16,
        fontWeight: 650,
        color: accent || T.ink,
        lineHeight: 1,
      }}>{value}</span>
    </div>
  );

  const StatePill = ({ state }) => (
    <span style={{
      fontFamily: 'var(--mn-mono)', fontSize: 9.5,
      fontWeight: 700, letterSpacing: '0.06em',
      color: state.color, background: state.bg,
      padding: '2px 6px', borderRadius: 3,
      maxWidth: '100%',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap',
      flexShrink: 0,
    }}>{state.id}</span>
  );

  const ArchiveButton = ({ item, compact = false }) => (
    <button
      type="button"
      title="Archive note from workflow"
      onClick={(e) => {
        e.stopPropagation();
        archiveNote(item.noteId, true);
      }}
      style={{
        height: compact ? 24 : 22,
        padding: compact ? '0 8px' : '0 6px',
        borderRadius: 5,
        border: `1px solid ${T.lineSub}`,
        background: T.bg,
        color: T.inkDim,
        fontFamily: 'var(--mn-ui)',
        fontSize: compact ? 11.5 : 11,
        cursor: 'pointer',
        flexShrink: 0,
      }}>
      Archive
    </button>
  );

  const TagEditorCell = ({ item }) => {
    const current = item.noteTags || [];
    const available = tags.filter(t => !current.includes(t.name));
    const setTagsForNote = (nextTags) => onSetNoteTags && onSetNoteTags(item.noteId, nextTags);
    return (
      <div style={{
        display: 'flex', gap: 5, alignItems: 'center',
        flexWrap: 'wrap', minWidth: 0, maxHeight: 50,
        overflow: 'hidden',
      }}>
        {current.slice(0, 3).map(t => (
          <button
            key={t}
            type="button"
            title="Remove tag"
            onClick={(e) => {
              e.stopPropagation();
              setTagsForNote(current.filter(x => x !== t));
            }}
            style={{
              maxWidth: 92,
              padding: '2px 6px',
              borderRadius: 999,
              border: `1px solid ${T.lineSub}`,
              background: mnGetTagBg(tagHue[t] ?? 240, theme),
              color: mnGetTagColor(tagHue[t] ?? 240, theme),
              fontFamily: 'var(--mn-mono)',
              fontSize: 10,
              cursor: 'pointer',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}>#{t}</button>
        ))}
        {current.length > 3 && (
          <span style={{ fontFamily: 'var(--mn-mono)', fontSize: 10, color: T.inkDim }}>+{current.length - 3}</span>
        )}
        <select
          value=""
          title="Add tag"
          disabled={!available.length}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => {
            if (!e.target.value) return;
            setTagsForNote([...current, e.target.value]);
            e.target.value = '';
          }}
          style={{
            maxWidth: 92,
            border: `1px dashed ${T.line}`,
            borderRadius: 999,
            background: T.bg,
            color: T.inkDim,
            fontFamily: 'var(--mn-mono)',
            fontSize: 10,
            padding: '2px 5px',
            cursor: available.length ? 'pointer' : 'default',
          }}>
          <option value="">+ tag</option>
          {available.map(t => <option key={t.name} value={t.name}>{t.name}</option>)}
        </select>
      </div>
    );
  };

  const Card = ({ item, state }) => (
    <div
      draggable
      onDragStart={(e) => {
        setActiveDragItem(item);
        updateDragPreview(item, state, e);
        setTransparentDragImage(e);
        const payload = JSON.stringify({ noteId: item.noteId });
        e.dataTransfer.setData('text/mn-workflow', payload);
        e.dataTransfer.setData('text/mn-note', payload);
        e.dataTransfer.setData('text/plain', `mn-note:${item.noteId}`);
        e.dataTransfer.effectAllowed = 'move';
      }}
      onDrag={(e) => {
        updateDragPreview(item, state, e);
        const stateId = e.clientX && e.clientY ? workflowStateFromPoint(e.clientX, e.clientY) : '';
        if (stateId) setDragOverState(stateId);
      }}
      onDragEnd={clearActiveDragItem}
      onPointerDown={(e) => beginCardPointerDrag(e, item)}
      onClick={(e) => {
        if (suppressCardClickRef.current) {
          e.preventDefault();
          e.stopPropagation();
          return;
        }
        onOpen(item.noteId);
      }}
      style={{
        height: 116,
        padding: '10px 11px',
        borderRadius: 6,
        background: T.bg,
        border: `1px solid ${T.lineSub}`,
        borderLeft: `3px solid ${state.color}`,
        cursor: dragItem?.id === item.id ? 'grabbing' : 'grab',
        display: 'flex',
        flexDirection: 'column',
        gap: 7,
        overflow: 'hidden',
        opacity: dragItem?.id === item.id ? 0.5 : 1,
        boxShadow: dragItem?.id === item.id
          ? 'none'
          : `0 1px 2px color-mix(in oklab, ${T.ink} 5%, transparent)`,
      }}
      onMouseEnter={e => e.currentTarget.style.background = T.bgHover}
      onMouseLeave={e => e.currentTarget.style.background = T.bg}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
        <div style={{
          fontFamily: 'var(--mn-ui)', fontSize: 13.5, fontWeight: 600,
          color: T.ink,
          minWidth: 0, flex: 1,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>{item.noteTitle || 'Untitled'}</div>
        <StatePill state={state} />
        <ArchiveButton item={item} />
      </div>
      <div style={{
        fontFamily: 'var(--mn-body)', fontSize: 13.5,
        color: isClosedState(state) ? T.inkDim : T.ink,
        lineHeight: 1.42,
        display: '-webkit-box',
        WebkitLineClamp: 2,
        WebkitBoxOrient: 'vertical',
        overflow: 'hidden',
      }}>{item.text || <span style={{ color: T.inkDim, fontStyle: 'italic' }}>No preview</span>}</div>
      <div style={{ flex: 1 }} />
      <div style={{
        display: 'flex', gap: 5, alignItems: 'center',
        overflow: 'hidden', minHeight: 19,
      }}>
        {item.noteTags.slice(0, 3).map(t => (
          <span key={t} style={{
            maxWidth: 82,
            padding: '2px 6px',
            borderRadius: 999,
            background: `color-mix(in oklab, ${mnGetTagColor(tagHue[t] ?? 240, theme)} 13%, ${T.bgSub})`,
            border: `1px solid ${T.lineSub}`,
            color: mnGetTagColor(tagHue[t] ?? 240, theme),
            fontFamily: 'var(--mn-mono)',
            fontSize: 10,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            flexShrink: 0,
          }}>#{t}</span>
        ))}
        {item.noteTags.length > 3 && (
          <span style={{ fontFamily: 'var(--mn-mono)', fontSize: 10, color: T.inkDim }}>+{item.noteTags.length - 3}</span>
        )}
        {!item.noteTags.length && (
          <span style={{ fontFamily: 'var(--mn-mono)', fontSize: 10, color: T.inkDim }}>no tags</span>
        )}
        <span style={{ marginLeft: 'auto', fontFamily: 'var(--mn-mono)', fontSize: 10, color: T.inkDim, flexShrink: 0 }}>{item.kind}</span>
      </div>
    </div>
  );

  const WorkflowDragPreview = () => {
    if (!dragPreview?.item) return null;
    const targetState = (workflowStates || []).find(state => state.id === (dragOverState || dragPreview.stateId))
      || (workflowStates || []).find(state => state.id === dragPreview.item.workflow)
      || workflowStates?.[0]
      || { id: dragPreview.item.workflow || 'STATUS', color: T.accent, bg: T.accentSoft };
    return (
      <div style={{
        position: 'fixed',
        left: Math.max(12, Math.min(Math.max(12, window.innerWidth - 286), dragPreview.x + 14)),
        top: Math.max(12, Math.min(Math.max(12, window.innerHeight - 128), dragPreview.y + 14)),
        width: 272,
        zIndex: 160,
        pointerEvents: 'none',
        borderRadius: 8,
        border: `1px solid ${T.line}`,
        borderLeft: `4px solid ${targetState.color}`,
        background: T.bg,
        color: T.ink,
        boxShadow: `0 18px 48px color-mix(in oklab, ${T.ink} 22%, transparent)`,
        padding: '10px 11px',
        fontFamily: 'var(--mn-ui)',
        transform: 'rotate(1deg)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          <div style={{
            flex: 1,
            minWidth: 0,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            fontSize: 13.5,
            fontWeight: 700,
          }}>{dragPreview.item.noteTitle || 'Untitled'}</div>
          <StatePill state={targetState} />
        </div>
        <div style={{
          marginTop: 7,
          fontFamily: 'var(--mn-body)',
          fontSize: 12.5,
          lineHeight: 1.35,
          color: T.inkMed,
          display: '-webkit-box',
          WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical',
          overflow: 'hidden',
        }}>{dragPreview.item.text || 'No preview'}</div>
      </div>
    );
  };

  const ArchivedNotes = () => (
    <div style={{
      border: `1px solid ${T.lineSub}`,
      borderRadius: 8,
      background: T.bgSub,
      padding: 10,
      marginBottom: 16,
    }}>
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 10,
        marginBottom: 8,
      }}>
        <div style={{
          fontFamily: 'var(--mn-mono)',
          fontSize: 10,
          letterSpacing: '0.12em',
          textTransform: 'uppercase',
          color: T.inkDim,
        }}>Archived from workflow</div>
        <span style={{ fontFamily: 'var(--mn-mono)', fontSize: 10.5, color: T.inkDim }}>
          {archivedNotes.length}
        </span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {archivedNotes.map(note => (
          <div key={note.id} style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '9px 10px',
            border: `1px solid ${T.lineSub}`,
            borderRadius: 6,
            background: T.bg,
          }}>
            <div onClick={() => onOpen(note.id)} style={{
              flex: 1,
              minWidth: 0,
              cursor: 'pointer',
            }}>
              <div style={{
                fontFamily: 'var(--mn-ui)',
                fontSize: 13.5,
                fontWeight: 600,
                color: T.ink,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}>{note.title || 'Untitled'}</div>
              <div style={{
                marginTop: 3,
                fontFamily: 'var(--mn-mono)',
                fontSize: 10,
                color: T.inkDim,
              }}>{note.workflow || 'workflow'} note status</div>
            </div>
            <button
              type="button"
              onClick={() => archiveNote(note.id, false)}
              style={{
                height: 26,
                padding: '0 9px',
                borderRadius: 5,
                border: `1px solid ${T.line}`,
                background: T.bg,
                color: T.ink,
                fontFamily: 'var(--mn-ui)',
                fontSize: 12,
                cursor: 'pointer',
                flexShrink: 0,
              }}>
              Restore
            </button>
          </div>
        ))}
        {!archivedNotes.length && (
          <div style={{
            padding: 14,
            textAlign: 'center',
            fontFamily: 'var(--mn-body)',
            fontSize: 12.5,
            color: T.inkDim,
            fontStyle: 'italic',
          }}>No archived workflow notes</div>
        )}
      </div>
    </div>
  );

  const DropColumn = ({ state, children, empty }) => (
    <div
      data-mn-workflow-state={state.id}
      onDragOver={(e) => {
        if (!hasWorkflowDropData(e)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        const activeItem = dragItemRef.current || dragItem;
        if (activeItem) updateDragPreview(activeItem, state, e);
        setDragOverState(state.id);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setDragOverState(null);
      }}
      onDrop={(e) => {
        e.preventDefault();
        const noteId = readDropNoteId(e);
        const activeItem = dragItemRef.current || dragItem;
        if (activeItem) moveItem(activeItem, state.id);
        else moveWorkflowNote(noteId, null, state.id);
        clearActiveDragItem();
      }}
      style={{
        background: dragOverState === state.id ? T.bgHover : T.bgSub,
        border: `1px solid ${dragOverState === state.id ? T.accent : T.lineSub}`,
        borderRadius: 8,
        padding: 9,
        minHeight: mode === 'kanban' ? 'min(470px, calc(100vh - 230px))' : 0,
        transition: 'background 100ms',
        minWidth: 0,
      }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        margin: '0 1px 9px',
        position: 'sticky',
        top: 0,
        zIndex: 1,
        background: dragOverState === state.id ? T.bgHover : T.bgSub,
        paddingBottom: 1,
      }}>
        <StatePill state={state} />
        <span style={{
          fontFamily: 'var(--mn-mono)',
          fontSize: 10.5,
          color: T.inkDim,
          background: T.bg,
          border: `1px solid ${T.lineSub}`,
          borderRadius: 999,
          padding: '1px 6px',
        }}>{countFor(state.id)}</span>
      </div>
      {dragOverState === state.id && (
        <div style={{
          margin: '-2px 0 8px',
          border: `1px dashed ${state.color}`,
          borderRadius: 6,
          background: `color-mix(in oklab, ${state.bg} 55%, ${T.bg})`,
          color: state.color,
          fontFamily: 'var(--mn-ui)',
          fontSize: 12,
          fontWeight: 650,
          textAlign: 'center',
          padding: '7px 8px',
        }}>Release to move to {state.id}</div>
      )}
      {children}
      {empty && (
        <div style={{
          padding: '18px 10px', textAlign: 'center',
          fontFamily: 'var(--mn-body)', fontSize: 12.5,
          color: T.inkDim, fontStyle: 'italic',
          border: `1px dashed ${T.lineSub}`,
          borderRadius: 6,
          background: `color-mix(in oklab, ${T.bg} 70%, transparent)`,
        }}>Drop here</div>
      )}
    </div>
  );

  const allItems = (workflowStates || []).flatMap(state => {
    return (workflowItems?.[state.id] || []).map(item => ({ ...item, state }));
  });

  return (
    <div style={{
      flex: 1, height: '100%', background: T.bg,
      padding: '30px clamp(14px, 2vw, 28px) 24px',
      overflow: 'auto',
      minWidth: 0,
    }}>
      <div style={{ width: '100%', maxWidth: 1480, margin: '0 auto', minWidth: 0 }}>
        <div style={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: 14,
          flexWrap: 'wrap',
          marginBottom: 14,
        }}>
          <div style={{ minWidth: 180 }}>
            <div style={{
              fontFamily: 'var(--mn-ui)', fontSize: 25, fontWeight: 650,
              color: T.ink, marginBottom: 4, letterSpacing: 0,
            }}>Workflow</div>
            <div style={{
              fontFamily: 'var(--mn-mono)', fontSize: 10.5, color: T.inkDim,
              letterSpacing: '0.06em',
            }}>{total} workflow note{total === 1 ? '' : 's'} across this vault</div>
          </div>
          <div style={{
            display: 'flex',
            gap: 2,
            padding: 3,
            marginRight: 54,
            border: `1px solid ${T.lineSub}`,
            borderRadius: 7,
            background: T.bgSub,
            flexShrink: 0,
          }}>
            <ModeButton id="kanban" label="Kanban" />
            <ModeButton id="table" label="Table" />
            <ModeButton id="list" label="List" />
            <button onClick={() => setShowArchived(v => !v)} style={{
              padding: '5px 10px',
              borderRadius: 5,
              border: 'none',
              background: showArchived ? T.bg : 'transparent',
              color: showArchived ? T.ink : T.inkMed,
              fontFamily: 'var(--mn-ui)',
              fontSize: 12,
              fontWeight: showArchived ? 600 : 500,
              cursor: 'pointer',
              boxShadow: showArchived ? `0 1px 3px color-mix(in oklab, ${T.ink} 10%, transparent)` : 'none',
            }}>Archived {archivedNotes.length}</button>
          </div>
        </div>
        {showArchived ? <ArchivedNotes /> : (
          <>
            {renderWorkflowStateManager()}
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(112px, 1fr))',
              gap: 8,
              marginBottom: 16,
            }}>
              <SummaryStat label="Items" value={total} accent={T.accent} />
              <SummaryStat label="Columns" value={(workflowStates || []).length} accent={T.warn} />
              <SummaryStat label="Active cols" value={populatedStateCount} accent={T.inkMed} />
              <SummaryStat label="Archived" value={archivedNotes.length} accent={T.success} />
            </div>

            {mode === 'kanban' && (
              <div style={{
                overflowX: 'auto',
                overflowY: 'visible',
                paddingBottom: 10,
              }}>
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: `repeat(${stateCount}, minmax(172px, 1fr))`,
                  gap: 10,
                  minWidth: kanbanMinWidth,
                }}>
                  {(workflowStates || []).map(state => {
                    const items = workflowItems?.[state.id] || [];
                    return (
                      <DropColumn key={state.id} state={state} empty={!items.length}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                          {items.map(item => <Card key={item.id} item={item} state={state} />)}
                        </div>
                      </DropColumn>
                    );
                  })}
                </div>
              </div>
            )}

            {mode === 'table' && (
              <div style={{
                border: `1px solid ${T.lineSub}`,
                borderRadius: 8,
                overflowX: 'auto',
                overflowY: 'auto',
                maxHeight: 'calc(100vh - 205px)',
              }}>
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: '108px minmax(220px, 1.5fr) minmax(150px, 0.8fr) minmax(180px, 1fr) 176px',
                  gap: 0,
                  padding: '8px 12px',
                  background: T.bgSub,
                  borderBottom: `1px solid ${T.lineSub}`,
                  position: 'sticky',
                  top: 0,
                  zIndex: 1,
                  fontFamily: 'var(--mn-mono)',
                  fontSize: 10,
                  color: T.inkDim,
                  letterSpacing: '0.1em',
                  textTransform: 'uppercase',
                  minWidth: 880,
                  boxSizing: 'border-box',
                }}>
                  <span>Status</span><span>Note</span><span>Title</span><span>Tags</span><span>Change</span>
                </div>
                {allItems.map(({ state, ...item }) => (
                  <div key={item.id} style={{
                    display: 'grid',
                    gridTemplateColumns: '108px minmax(220px, 1.5fr) minmax(150px, 0.8fr) minmax(180px, 1fr) 176px',
                    gap: 0,
                    padding: '10px 12px',
                    borderBottom: `1px solid ${T.lineSub}`,
                    alignItems: 'start',
                    fontFamily: 'var(--mn-ui)',
                    fontSize: 13,
                    minWidth: 880,
                    boxSizing: 'border-box',
                    background: T.bg,
                  }}>
                    <div style={{ minWidth: 0, paddingTop: 3, overflow: 'hidden' }}>
                      <StatePill state={state} />
                    </div>
                    <span onClick={() => onOpen(item.noteId)} style={{
                      color: T.ink, cursor: 'pointer',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'normal',
                      lineHeight: 1.35,
                      paddingTop: 3,
                      minWidth: 0,
                    }}>{item.text || 'No preview'}</span>
                    <span onClick={() => onOpen(item.noteId)} style={{
                      color: T.inkMed,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      cursor: 'pointer',
                      paddingTop: 3,
                      minWidth: 0,
                    }}>{item.noteTitle}</span>
                    <TagEditorCell item={item} />
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center', minWidth: 0 }}>
                      <select value={state.id} onChange={(e) => moveItem(item, e.target.value)} style={{
                        border: `1px solid ${T.line}`,
                        borderRadius: 5,
                        background: T.bg,
                        color: T.ink,
                        fontFamily: 'var(--mn-ui)',
                        fontSize: 12,
                        padding: '4px 6px',
                        minWidth: 0,
                        flex: 1,
                        boxSizing: 'border-box',
                      }}>
                        {(workflowStates || []).map(s => <option key={s.id} value={s.id}>{s.id}</option>)}
                      </select>
                      <ArchiveButton item={item} compact />
                    </div>
                  </div>
                ))}
                {!allItems.length && (
                  <div style={{ padding: 22, textAlign: 'center', color: T.inkDim, fontFamily: 'var(--mn-body)', fontStyle: 'italic' }}>No workflow notes yet</div>
                )}
              </div>
            )}

            {mode === 'list' && (workflowStates || []).map(state => {
              const items = workflowItems?.[state.id] || [];
              return (
                <div key={state.id} style={{ marginBottom: 20 }}>
                  <SectionHead T={T} label={state.id} count={items.length} />
                  {items.length ? (
                    <div style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(auto-fill, minmax(min(260px, 100%), 1fr))',
                      gap: 8,
                    }}>
                      {items.map(item => <Card key={item.id} item={item} state={state} />)}
                    </div>
                  ) : (
                    <div style={{
                      padding: 14, textAlign: 'center',
                      fontFamily: 'var(--mn-body)', fontSize: 12.5,
                      color: T.inkDim, fontStyle: 'italic',
                      background: T.bgSub, border: `1px solid ${T.lineSub}`,
                      borderRadius: 6,
                    }}>No workflow notes</div>
                  )}
                </div>
              );
            })}
            <WorkflowDragPreview />
          </>
        )}
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────
// Today view (note rollup)
// ────────────────────────────────────────────────────────────

window.MnWorkflowPanel = MnWorkflowPanel;
window.MnNovelistPanel = MnNovelistPanel;
