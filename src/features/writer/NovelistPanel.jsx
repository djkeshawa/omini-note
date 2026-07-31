const { useState: useStateP, useMemo: useMemoP, useEffect: useEffectP, useRef: useRefP } = React;
import { SectionHead } from '../../panels/panelShared.jsx';
import { mnNormalizeNovelistAiConfig, mnReadNovelistAiConfig, mnWriteNovelistAiConfig } from '../../panels/panelHelpers.js';
import { SupportingNoteSection } from './SupportingNoteSection.jsx';
import { createNovelistHelpers } from './novelistHelpers.js';
import { buildNovelistStatusModel } from './novelistStatusModel.js';
import { NovelistStatusSection, NovelistAiConfigurationSection } from './NovelistSections.jsx';
import { NovelistPanelView } from './NovelistPanelView.jsx';
import { TypeLine } from './TypeLine.jsx';
import { NOVELIST_STRUCTURE_TAGS, buildNovelistTemplates, buildSupportingTypes,
  nextNovelistOrder, normalizeSupportingTypeTag, readNovelistOrder, uniqueNovelistTitle } from './novelistPanelModel.js';
import { mnPanelButton, mnPanelMiniButton, mnPanelInputStyle, mnPanelTextareaStyle, mnPanelMenuItem } from '../../shared/panels/panelStyles.js';
const { bodyPropertyValue: mnBodyPropertyValue, noteOrderValue: mnNoteOrderValue } = createNovelistHelpers();

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
  const structureTagNames = new Set(NOVELIST_STRUCTURE_TAGS);
  const supportingTypes = buildSupportingTypes(tags);
  const supportingTotal = supportingTypes.reduce((sum, type) => sum + byTag(type.tag).length, 0);

  const uniqueTitle = (base) => uniqueNovelistTitle(base, notes);
  const readOrder = (note) => readNovelistOrder(note, mnNoteOrderValue);
  const nextOrder = (kind, parent = null) => nextNovelistOrder(kind, parent, {
    acts, chapters, scenes, childrenForAct, childrenForChapter, readOrder,
  });
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

  const templates = buildNovelistTemplates(supportingTypes);
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

  const Section = props => <SupportingNoteSection {...props} T={T} onOpen={onOpen} openNoteMenu={openNoteMenu} createSupportingNote={createSupportingNote} onRemoveSupportingType={onRemoveSupportingType} />;

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

  // These inline structure components contain no text inputs, so remounting
  // cannot disturb caret or drag interactions.
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
      <TypeLine label={label} linkedTo={linkedTo} extraParent={extraParent} count={count} T={T} />
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

  const {
    wordCountForNote, statRows, totalDraftWords, averageWordsPerScene, statusCounts,
    characterSceneCounts, maxCharacterHits, completionCoverage,
  } = buildNovelistStatusModel({ acts, chapters, scenes, childrenForAct, childrenForChapter, byTag, bodyPropertyValue: mnBodyPropertyValue });

  const StatusSection = () => <NovelistStatusSection T={T} totalDraftWords={totalDraftWords} averageWordsPerScene={averageWordsPerScene} unlinkedChapters={unlinkedChapters} unlinkedScenes={unlinkedScenes} completionCoverage={completionCoverage} statRows={statRows} wordCountForNote={wordCountForNote} childrenForChapter={childrenForChapter} statusCounts={statusCounts} scenes={scenes} characterSceneCounts={characterSceneCounts} maxCharacterHits={maxCharacterHits} InlineEmpty={InlineEmpty} />;
  const AiConfigurationSection = () => <NovelistAiConfigurationSection T={T} aiConfig={aiConfig} addAiPrompt={addAiPrompt} aiWordLimitDraft={aiWordLimitDraft} setAiWordLimitDraft={setAiWordLimitDraft} commitAiWordLimit={commitAiWordLimit} updateAiConfig={updateAiConfig} removeAiPrompt={removeAiPrompt} updateAiPrompt={updateAiPrompt} InlineEmpty={InlineEmpty} />;

  return <NovelistPanelView model={{
    T,
    novelNotes,
    acts,
    chapters,
    scenes,
    linkNotice,
    setActiveTab,
    activeTab,
    ActRow,
    InlineEmpty,
    unlinkedChapters,
    unlinkedScenes,
    LooseStructureSection,
    childrenForChapter,
    StructureNoteButton,
    setLinkMenu,
    createParentActForChapter,
    onConvertNoteType,
    createParentChapterForScene,
    supportingTotal,
    setAddingSupportType,
    addingSupportType,
    supportTypeDraft,
    setSupportTypeDraft,
    addSupportingType,
    supportingTypes,
    Section,
    byTag,
    StatusSection,
    AiConfigurationSection,
    editDialog,
    setEditDialog,
    editInputRef,
    submitEditDialog,
    AttachMenu,
    noteMenu,
    setNoteMenu,
    onOpen,
    promptRename,
    promptSetOrder,
    onDeleteNote,
    createMenu,
    setCreateMenu,
    createChapterForAct,
    createSceneForChapter,
    templates,
    uniqueTitle,
    onCreateNote,
  }} />;
}

export { MnNovelistPanel };
