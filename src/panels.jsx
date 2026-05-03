// Overlay panels: Todos aggregator, Today view, Quick-capture, Reminder toast, Tweaks

const { useState: useStateP, useMemo: useMemoP, useEffect: useEffectP, useRef: useRefP } = React;

// ────────────────────────────────────────────────────────────
// Aggregated Todos
// ────────────────────────────────────────────────────────────
function MnTodosPanel({ notes, tags, onOpen, onToggleCheck, T, theme, variant }) {
  const tagHue = useMemoP(() => {
    const m = {}; tags.forEach(t => m[t.name] = t.hue); return m;
  }, [tags]);

  // Gather all todos and reminders from block data so duplicate text toggles
  // the intended task.
  const items = useMemoP(() => {
    const acc = [];
    const remind = window.MN_REMIND;
    notes.forEach(n => {
      if (n.blocks?.length && window.mnWalk) {
        window.mnWalk(n.blocks, block => {
          const parsed = remind?.parse?.(block.content || '');
          if (block.kind === 'todo') {
            acc.push({
              noteId: n.id, noteTitle: n.title, noteTags: n.tags,
              blockId: block.id,
              text: block.content || '',
              checked: !!block.checked,
              remindAt: parsed,
              noteDate: n.date,
            });
          } else if (parsed) {
            acc.push({
              noteId: n.id, noteTitle: n.title, noteTags: n.tags,
              blockId: block.id,
              text: remind?.strip?.(block.content || '') || block.content || '',
              checked: false,
              isReminderOnly: true,
              remindAt: parsed,
              noteDate: n.date,
            });
          }
        });
        return;
      }
      const lines = String(n.body || '').split('\n');
      lines.forEach((line, lineNum) => {
        const m = line.match(/^(\s*)-\s+\[([ xX])\]\s+(.*)$/);
        if (m) {
          const checked = /[xX]/.test(m[2]);
          const parsed = remind?.parse?.(m[3]);
          acc.push({
            noteId: n.id, noteTitle: n.title, noteTags: n.tags,
            text: m[3], checked, line: lineNum,
            remindAt: parsed,
            noteDate: n.date,
          });
        }
      });
      // Also capture bare @remind directives not inside checkboxes
      lines.forEach((line, lineNum) => {
        if (/^\s*-\s+\[/.test(line)) return;
        const parsed = remind?.parse?.(line);
        if (parsed) {
          acc.push({
            noteId: n.id, noteTitle: n.title, noteTags: n.tags,
            text: remind?.strip?.(line) || line, checked: false, line: lineNum,
            isReminderOnly: true,
            remindAt: parsed, noteDate: n.date,
          });
        }
      });
    });
    return acc;
  }, [notes]);

  const open = items.filter(i => !i.checked);
  const done = items.filter(i => i.checked);
  const withRem = open.filter(i => i.remindAt);

  const Card = ({ it, idx }) => {
    const isOverdue = it.remindAt && it.remindAt.at < new Date();
    const label = window.MN_REMIND?.strip?.(it.text) || String(it.text || '').trim();
    return (
      <div key={idx}
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
          <button onClick={(e) => { e.stopPropagation(); onToggleCheck(it); }} style={{
            width: 15, height: 15, marginTop: 2, flexShrink: 0,
            border: `1.5px solid ${it.checked ? T.accent : T.line}`,
            background: it.checked ? T.accent : 'transparent',
            borderRadius: 4, cursor: 'pointer', padding: 0,
          }} />
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
              <span key={t} style={{
                color: mnGetTagColor(tagHue[t] ?? 240, theme),
              }}>#{t}</span>
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
  };

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
          color: T.ink, marginBottom: 3, letterSpacing: '-0.015em',
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
                fontFamily: 'var(--mn-mono)', fontSize: 10,
                letterSpacing: '0.12em', textTransform: 'uppercase',
                color: T.inkDim, margin: '2px 4px 10px',
                display: 'flex', justifyContent: 'space-between',
              }}>
                <span>{b.label}</span>
                <span>{b.items.length}</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {b.items.map((it, i) => <Card key={i} it={it} idx={i} />)}
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
          color: T.ink, marginBottom: 3, letterSpacing: '-0.02em',
        }}>Todos</div>
        <div style={{
          fontFamily: 'var(--mn-mono)', fontSize: 10.5, color: T.inkDim,
          letterSpacing: '0.06em', marginBottom: 24,
        }}>{open.length} open · {done.length} done · {withRem.length} with reminders</div>

        {withRem.length > 0 && (
          <>
            <SectionHead T={T} label="Reminders" count={withRem.length} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 28 }}>
              {withRem.map((it, i) => <Card key={i} it={it} idx={i} />)}
            </div>
          </>
        )}

        <SectionHead T={T} label="Open" count={open.filter(i => !i.remindAt).length} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 28 }}>
          {open.filter(i => !i.remindAt).map((it, i) => <Card key={i} it={it} idx={'o' + i} />)}
        </div>

        {done.length > 0 && (
          <>
            <SectionHead T={T} label="Done" count={done.length} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {done.map((it, i) => <Card key={i} it={it} idx={'d' + i} />)}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function SectionHead({ label, count, T }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10,
      fontFamily: 'var(--mn-mono)', fontSize: 10,
      letterSpacing: '0.12em', textTransform: 'uppercase',
      color: T.inkDim,
    }}>
      <span>{label}</span>
      <span>{count}</span>
      <div style={{ flex: 1, borderTop: `1px solid ${T.lineSub}` }} />
    </div>
  );
}

const MN_NOVELIST_AI_CONFIG_KEY = 'mn_novelist_ai_config_v1';

function mnNovelistAiConfigKey(vaultId = '') {
  const cleanVaultId = String(vaultId || '').trim();
  return cleanVaultId ? `${MN_NOVELIST_AI_CONFIG_KEY}:${cleanVaultId}` : MN_NOVELIST_AI_CONFIG_KEY;
}

function mnDefaultNovelistAiPrompts() {
  return [
    {
      id: 'write-novel',
      name: 'AI write novel',
      prompt: 'Write polished novel prose from the selected story notes. Preserve continuity, point of view, tense, and the established character voices.',
    },
    {
      id: 'continue-draft',
      name: 'Continue draft',
      prompt: 'Continue the current scene from the last paragraph. Keep the same voice, pacing, and emotional direction.',
    },
    {
      id: 'revise-prose',
      name: 'Revise prose',
      prompt: 'Revise the selected prose for clarity, rhythm, and stronger sensory detail without changing story facts.',
    },
  ];
}

function mnNormalizeNovelistAiConfig(raw) {
  const defaults = { wordLimit: 800, prompts: mnDefaultNovelistAiPrompts() };
  const parsedLimit = Number(raw?.wordLimit);
  const wordLimit = Number.isFinite(parsedLimit)
    ? Math.min(12000, Math.max(100, Math.round(parsedLimit)))
    : defaults.wordLimit;
  const sourcePrompts = Array.isArray(raw?.prompts) ? raw.prompts : defaults.prompts;
  const prompts = sourcePrompts
    .map((item, index) => ({
      id: String(item?.id || `prompt-${index + 1}`),
      name: String(item?.name || '').trim(),
      prompt: String(item?.prompt ?? item?.text ?? ''),
    }))
    .slice(0, 12);
  const requestedDefault = String(raw?.defaultPromptId || '').trim();
  const defaultPromptId = prompts.some(item => item.id === requestedDefault)
    ? requestedDefault
    : prompts[0]?.id || '';
  return { wordLimit, defaultPromptId, prompts };
}

function mnReadNovelistAiConfig(vaultId = '') {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return mnNormalizeNovelistAiConfig(null);
    const raw = window.localStorage.getItem(mnNovelistAiConfigKey(vaultId));
    return mnNormalizeNovelistAiConfig(raw ? JSON.parse(raw) : null);
  } catch {
    return mnNormalizeNovelistAiConfig(null);
  }
}

function mnWriteNovelistAiConfig(config, vaultId = '') {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return;
    window.localStorage.setItem(mnNovelistAiConfigKey(vaultId), JSON.stringify(config));
  } catch {}
}

if (typeof window !== 'undefined') {
  window.mnReadNovelistAiConfig = mnReadNovelistAiConfig;
}

// ────────────────────────────────────────────────────────────
// Novelist workspace
// ────────────────────────────────────────────────────────────
function MnNovelistPanel({
  notes, novelistNotes, tags, vaultId = '', workflowStates, workflowItems,
  novelistStructure,
  onOpen, onCreateNote, onLinkChapter, onLinkScene,
  onSetOrder, onRenameNote, onConvertNoteType,
  onDeleteNote,
  onCreateTag, onRemoveSupportingType, T
}) {
  const [linkMenu, setLinkMenu] = useStateP(null);
  const [createMenu, setCreateMenu] = useStateP(null);
  const [addingSupportType, setAddingSupportType] = useStateP(false);
  const [supportTypeDraft, setSupportTypeDraft] = useStateP('');
  const [collapsed, setCollapsed] = useStateP({});
  const [noteMenu, setNoteMenu] = useStateP(null);
  const [linkNotice, setLinkNotice] = useStateP(null);
  const [editDialog, setEditDialog] = useStateP(null);
  const [aiConfig, setAiConfig] = useStateP(() => mnReadNovelistAiConfig(vaultId));
  const [aiWordLimitDraft, setAiWordLimitDraft] = useStateP(() => String(mnReadNovelistAiConfig(vaultId).wordLimit));
  const editInputRef = useRefP(null);
  const linkNoticeTimer = useRefP(null);
  useEffectP(() => {
    const next = mnReadNovelistAiConfig(vaultId);
    setAiConfig(next);
    setAiWordLimitDraft(String(next.wordLimit));
  }, [vaultId]);
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
  const arcs = novelistStructure?.arcs || byTag('novel-arc');
  const chapters = novelistStructure?.chapters || byTag('novel-chapter');
  const scenes = novelistStructure?.scenes || byTag('novel-scene');
  const manuscripts = novelistStructure?.manuscripts || byTag('novel-manuscript');
  const manuscript = novelistStructure?.manuscript || manuscripts[0] || null;
  const childrenByArcId = novelistStructure?.childrenByArcId || {};
  const childrenByChapterId = novelistStructure?.childrenByChapterId || {};
  const parentByChapterId = novelistStructure?.parentByChapterId || {};
  const parentBySceneId = novelistStructure?.parentBySceneId || {};
  const structureTagNames = new Set(['novel-manuscript', 'novel-arc', 'novel-chapter', 'novel-scene']);
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
      const ordered = items.map(readOrder).filter(value => value != null);
      return ordered.length ? Math.max(...ordered) + step : base + step;
    };
    if (kind === 'arc') return values(arcs, 100, 0);
    if (kind === 'chapter') {
      const base = readOrder(parent) ?? 100;
      return values(parent ? childrenForArc(parent) : chapters, 10, base);
    }
    const base = readOrder(parent) ?? 100;
    return values(parent ? childrenForChapter(parent) : scenes, 1, base);
  };
  const bodyWithTitleAndOrder = (template, title, order) => {
    let body = String(template.body || '');
    if (order != null) body = setBodyProperty(body, 'order', String(order));
    return body;
  };
  const createTemplate = (template, e) => {
    if ((template.tags || []).includes('novel-chapter') && arcs.length) {
      if (arcs.length === 1) {
        createChapterForArc(arcs[0]);
        return;
      }
      setCreateMenu({ type: 'chapter', x: e?.clientX || 0, y: e?.clientY || 0 });
      return;
    }
    if ((template.tags || []).includes('novel-scene') && chapters.length) {
      if (chapters.length === 1) {
        createSceneForChapter(chapters[0]);
        return;
      }
      setCreateMenu({ type: 'scene', x: e?.clientX || 0, y: e?.clientY || 0 });
      return;
    }
    const title = uniqueTitle(template.title);
    const order = (template.tags || []).includes('novel-arc') ? nextOrder('arc') : null;
    onCreateNote && onCreateNote({ ...template, title, body: bodyWithTitleAndOrder(template, title, order) });
  };
  const createChapterForArc = (arc) => {
    if (!arc) return;
    const title = uniqueTitle(`${arc.title || 'Arc'} Chapter`);
    const body = `status:: OUTLINE\norder:: ${nextOrder('chapter', arc)}\narc:: [[${arc.title || 'Arc'}]]\n## Scenes\n- Chapter goal\n- Scene list\n- Revision notes`;
    const id = onCreateNote?.({ title, body, tags: ['novel-chapter'] });
    if (id) onLinkChapter?.(arc.id, id, title);
    showLinkNotice(`Created and linked ${title} to ${arc.title || 'arc'}`, arc.id);
  };
  const createSceneForChapter = (chapter) => {
    if (!chapter) return;
    const arc = (notes || []).find(note => note.id === parentByChapterId[chapter.id]);
    const title = uniqueTitle(`${chapter.title || 'Chapter'} Scene`);
    const body = `status:: DRAFT\norder:: ${nextOrder('scene', chapter)}\n${arc ? `arc:: [[${arc.title}]]\n` : ''}chapter:: [[${chapter.title || 'Chapter'}]]\npov:: \nsetting:: \npurpose:: \nDraft the scene here.`;
    const id = onCreateNote?.({ title, body, tags: ['novel-scene'] });
    if (id) onLinkScene?.(chapter.id, id, title);
    showLinkNotice(`Created and linked ${title} to ${chapter.title || 'chapter'}`, chapter.id);
  };
  const createSceneForArc = (arc) => {
    const chaptersForThisArc = childrenForArc(arc);
    if (chaptersForThisArc[0]) {
      createSceneForChapter(chaptersForThisArc[0]);
      return;
    }
    const chapterTitle = uniqueTitle(`${arc.title || 'Arc'} Chapter`);
    const sceneTitle = uniqueTitle(`${chapterTitle} Scene`);
    const chapterBody = `status:: OUTLINE\norder:: ${nextOrder('chapter', arc)}\narc:: [[${arc.title || 'Arc'}]]\n## Scenes\n- [[${sceneTitle}]]`;
    const chapterId = onCreateNote?.({ title: chapterTitle, body: chapterBody, tags: ['novel-chapter'] });
    if (!chapterId) return;
    onLinkChapter?.(arc.id, chapterId, chapterTitle);
    const sceneBody = `status:: DRAFT\norder:: ${nextOrder('scene', { id: chapterId, title: chapterTitle, body: chapterBody })}\narc:: [[${arc.title || 'Arc'}]]\nchapter:: [[${chapterTitle}]]\npov:: \nsetting:: \npurpose:: \nDraft the scene here.`;
    onCreateNote?.({ title: sceneTitle, body: sceneBody, tags: ['novel-scene'] });
  };
  const createParentArcForChapter = (chapter) => {
    const title = uniqueTitle(`${chapter.title || 'Chapter'} Arc`);
    const body = `status:: OUTLINE\norder:: ${nextOrder('arc')}\npurpose:: \n## Chapters`;
    const id = onCreateNote?.({ title, body, tags: ['novel-arc'] });
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
    { title: 'Manuscript', tags: ['novel-manuscript'], body: 'status:: OUTLINE\norder:: 0\n## Arcs' },
    { title: 'Arc', tags: ['novel-arc'], body: 'status:: OUTLINE\norder:: \npurpose:: \n## Chapters' },
    { title: 'Chapter', tags: ['novel-chapter'], body: 'status:: OUTLINE\norder:: \narc:: \n## Scenes' },
    { title: 'Scene', tags: ['novel-scene'], body: 'status:: DRAFT\norder:: \nchapter:: \npov:: \nsetting:: \npurpose:: \nDraft the scene here.' },
    ...supportingTypes.map(type => ({ title: type.label, tags: [type.tag], body: type.body })),
  ];
  const updateAiConfig = (updater) => {
    setAiConfig(current => {
      const next = mnNormalizeNovelistAiConfig(typeof updater === 'function' ? updater(current) : updater);
      mnWriteNovelistAiConfig(next, vaultId);
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
  const childrenForArc = (arc) => (childrenByArcId[arc.id] || []).map(id => noteById.get(id)).filter(Boolean);
  const childrenForChapter = (chapter) => (childrenByChapterId[chapter.id] || []).map(id => noteById.get(id)).filter(Boolean);
  const unlinkedChapters = chapters.filter(chapter => !parentByChapterId[chapter.id]);
  const unlinkedScenes = scenes.filter(scene => !parentBySceneId[scene.id]);
  const isNonStructureNovel = (note) => (note?.tags || []).some(tag =>
    tag.startsWith('novel-') && !['novel-chapter', 'novel-scene'].includes(tag)
  );
  const chapterCandidatesForArc = (arc) => (notes || []).filter(note =>
    note.id !== arc.id &&
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
  const arcForChapter = (chapter) => noteById.get(parentByChapterId[chapter?.id]);
  const chapterForScene = (scene) => noteById.get(parentBySceneId[scene?.id]);
  const arcForScene = (scene) => {
    const chapter = chapterForScene(scene);
    return chapter ? arcForChapter(chapter) : null;
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
                showLinkNotice(`Linked ${candidate.title || 'chapter'} to ${parent.title || 'arc'}`, parent.id);
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
    const parents = isChapter ? arcs : chapters;
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
            No {isChapter ? 'arcs' : 'chapters'} available
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
        extraParent={arcForScene(scene)}
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
          borderTop: `1px solid ${T.lineSub}`,
          padding: '8px 0 0 18px',
        }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 9 }}>
          <ToggleButton
            expanded={!isCollapsed}
            onClick={(e) => { e.stopPropagation(); setCollapsed(c => ({ ...c, [chapter.id]: !isCollapsed })); }}
          />
          <StructureNoteButton
            note={chapter}
            label="Chapter"
            linkedTo={arcForChapter(chapter)}
            count={scenesForThisChapter.length}
            depth={1}
          />
        </div>
        {!isCollapsed && (
          <div style={{ display: 'grid', gap: 7, marginTop: 8 }}>
            {scenesForThisChapter.length
              ? scenesForThisChapter.map(scene => <SceneRow key={scene.id} scene={scene} />)
              : <div style={{ paddingLeft: 32 }}><InlineEmpty>No scenes linked</InlineEmpty></div>}
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

  const ArcRow = ({ arc }) => {
    const chaptersForThisArc = childrenForArc(arc);
    const isCollapsed = collapsed[arc.id] === true;
    return (
      <div
        onContextMenu={(e) => openNoteMenu(e, arc)}
        style={{
          border: `1px solid ${T.lineSub}`,
          borderRadius: 8,
          background: T.bg,
          padding: 12,
        }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 9 }}>
          <ToggleButton
            expanded={!isCollapsed}
            onClick={(e) => { e.stopPropagation(); setCollapsed(c => ({ ...c, [arc.id]: !isCollapsed })); }}
          />
          <StructureNoteButton
            note={arc}
            label="Arc"
            count={chaptersForThisArc.length}
          />
        </div>
        {!isCollapsed && (
          <div style={{ display: 'grid', gap: 8, marginTop: 9 }}>
            {chaptersForThisArc.length
              ? chaptersForThisArc.map(chapter => <ChapterRow key={chapter.id} chapter={chapter} />)
              : <div style={{ paddingLeft: 33 }}><InlineEmpty>No chapters linked</InlineEmpty></div>}
            <div style={{ paddingLeft: 33 }}>
              <StructureActions
                parent={arc}
                type="chapter"
                onAdd={createChapterForArc}
                onAddScene={createSceneForArc}
                candidates={chapterCandidatesForArc(arc)}
              />
            </div>
          </div>
        )}
      </div>
    );
  };

  const ManuscriptRoot = ({ note }) => (
    <div style={{
      display: 'flex',
      alignItems: 'flex-start',
      gap: 9,
      padding: '4px 0 10px',
      borderBottom: `1px solid ${T.lineSub}`,
      marginBottom: 10,
    }}>
      <StructureNoteButton
        note={note}
        label="Manuscript"
        count={arcs.length}
      />
    </div>
  );

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

  const CreateButtonGroup = ({ items }) => (
    <div style={{
      display: 'flex',
      gap: 7,
      flexWrap: 'wrap',
      alignItems: 'center',
    }}>
      <div style={{
        fontFamily: 'var(--mn-mono)',
        fontSize: 10,
        color: T.inkDim,
        textTransform: 'uppercase',
        letterSpacing: '0.08em',
      }}>Create</div>
      {items.map(template => (
        <button key={template.title} onClick={(e) => createTemplate(template, e)} style={mnPanelButton(T)}>
          {template.title}
        </button>
      ))}
    </div>
  );

  const AiConfigurationSection = () => (
    <section style={{ border: `1px solid ${T.lineSub}`, borderRadius: 8, background: T.bg, padding: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <div style={{ fontFamily: 'var(--mn-ui)', fontSize: 14, fontWeight: 700, color: T.ink }}>AI Configuration</div>
        <div style={{ flex: 1 }} />
        <button onClick={addAiPrompt} style={mnPanelMiniButton(T)}>+ Prompt</button>
      </div>
      <label style={{ display: 'grid', gap: 5, marginBottom: 10, fontFamily: 'var(--mn-ui)', fontSize: 12, color: T.inkMed }}>
        <span>Default word limit</span>
        <input
          type="number"
          min="100"
          max="12000"
          step="50"
          value={aiWordLimitDraft}
          onChange={(e) => setAiWordLimitDraft(e.target.value)}
          onBlur={commitAiWordLimit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur();
          }}
          style={{
            width: 150,
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
      </label>
      {!!(aiConfig.prompts || []).length && (
        <label style={{ display: 'grid', gap: 5, marginBottom: 10, fontFamily: 'var(--mn-ui)', fontSize: 12, color: T.inkMed }}>
          <span>Default writing prompt</span>
          <select
            value={aiConfig.defaultPromptId || ''}
            onChange={(e) => updateAiConfig(current => ({ ...current, defaultPromptId: e.target.value }))}
            style={{
              maxWidth: 260,
              border: `1px solid ${T.lineSub}`,
              borderRadius: 6,
              background: T.bgSub,
              color: T.ink,
              padding: '6px 8px',
              fontFamily: 'var(--mn-ui)',
              fontSize: 12.5,
              outline: 'none',
            }}>
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
                <span>{arcs.length} arc{arcs.length === 1 ? '' : 's'}</span>
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
          <div style={{ marginTop: 12 }}>
            <CreateButtonGroup items={templates} />
          </div>
        </header>

        <section style={{
          border: `1px solid ${T.lineSub}`,
          borderRadius: 8,
          background: T.bgSub,
          padding: 12,
          marginBottom: 14,
        }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 10 }}>
            <div style={{ fontFamily: 'var(--mn-ui)', fontSize: 15, fontWeight: 750, color: T.ink }}>Story Structure</div>
            <div style={{ fontFamily: 'var(--mn-mono)', fontSize: 10.5, color: T.inkDim }}>Manuscript -> Arc -> Chapter -> Scene</div>
          </div>
          {manuscript && <ManuscriptRoot note={manuscript} />}
          <div style={{ display: 'grid', gap: 10 }}>
            {arcs.length
              ? arcs.map(arc => <ArcRow key={arc.id} arc={arc} />)
              : <InlineEmpty>Create an arc to group chapters.</InlineEmpty>}
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
                        Attach to arc
                      </button>
                      <button onClick={() => createParentArcForChapter(chapter)} style={mnPanelMiniButton(T)}>
                        Create parent arc
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

        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 320px), 1fr))',
          gap: 10,
        }}>
          <section style={{ border: `1px solid ${T.lineSub}`, borderRadius: 8, background: T.bg, padding: 12 }}>
            <div style={{ fontFamily: 'var(--mn-ui)', fontSize: 14, fontWeight: 700, color: T.ink, marginBottom: 10 }}>Workflow Status</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: 8 }}>
              {(workflowStates || []).map(state => (
                <div key={state.id} style={{
                  border: `1px solid ${T.lineSub}`,
                  borderRadius: 7,
                  background: T.bgSub,
                  padding: 9,
                }}>
                  <div style={{ fontFamily: 'var(--mn-mono)', fontSize: 10, fontWeight: 700, color: state.color }}>{state.id}</div>
                  <div style={{ fontFamily: 'var(--mn-ui)', fontSize: 20, fontWeight: 700, color: T.ink, marginTop: 4 }}>
                    {(workflowItems?.[state.id] || []).length}
                  </div>
                </div>
              ))}
            </div>
          </section>

          <AiConfigurationSection />
        </div>
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
            {createMenu.type === 'chapter' ? 'Choose arc for new Chapter' : 'Choose chapter for new Scene'}
          </div>
          {(createMenu.type === 'chapter' ? arcs : chapters).map(parent => (
            <button
              key={parent.id}
              onClick={() => {
                if (createMenu.type === 'chapter') createChapterForArc(parent);
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
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      const stateId = active ? workflowStateFromPoint(upEvent.clientX, upEvent.clientY) : '';
      if (stateId) moveItem(item, stateId);
      clearActiveDragItem();
      if (active) window.setTimeout(() => { suppressCardClickRef.current = false; }, 0);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
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
              color: T.ink, marginBottom: 4, letterSpacing: '-0.01em',
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
          color: T.ink, marginBottom: 3, letterSpacing: '-0.02em',
        }}>Daily rollup</div>
        <div style={{
          fontFamily: 'var(--mn-mono)', fontSize: 10.5, color: T.inkDim,
          letterSpacing: '0.06em', marginBottom: 28,
        }}>notes grouped by the day they were written</div>

        {groups.map((g, i) => (
          <div key={i} style={{ marginBottom: 28 }}>
            <div style={{
              display: 'flex', alignItems: 'baseline', gap: 12,
              marginBottom: 10,
            }}>
              <div style={{
                fontFamily: 'var(--mn-body)', fontSize: 16, fontWeight: 600,
                color: T.ink, letterSpacing: '-0.01em',
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

// ────────────────────────────────────────────────────────────
// Quick-capture popover (floating)
// ────────────────────────────────────────────────────────────
function MnQuickCapture({ onSave, onClose, tags, T, theme }) {
  const [title, setTitle] = useStateP('');
  const [body, setBody] = useStateP('');
  const [selected, setSelected] = useStateP([]);
  const titleRef = useRefE(null);

  useEffectP(() => {
    setTimeout(() => titleRef.current?.focus(), 60);
    const esc = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
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
              color: T.ink, letterSpacing: '-0.01em', marginBottom: 10,
            }}/>
          <textarea value={body} onChange={(e) => setBody(e.target.value)}
            placeholder="Write a note… use [[double brackets]] to link, - [ ] for todos, @remind 2026-04-30 to schedule"
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
      position: 'absolute', bottom: 18, right: 18, zIndex: 50,
      width: 300, background: T.bg, borderRadius: 10,
      border: `1px solid ${T.line}`,
      boxShadow: `0 12px 40px color-mix(in oklab, ${T.ink} 18%, transparent)`,
      padding: 14,
      animation: 'mnSlideUp 220ms cubic-bezier(.2,.8,.2,1)',
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 6,
        fontFamily: 'var(--mn-mono)', fontSize: 9.5,
        color: T.warn, letterSpacing: '0.1em', textTransform: 'uppercase',
        marginBottom: 8, fontWeight: 600,
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
        fontFamily: 'var(--mn-body)', fontSize: 14, color: T.ink,
        lineHeight: 1.5, marginBottom: 4,
      }}>{toast.text}</div>
      <div style={{
        fontFamily: 'var(--mn-mono)', fontSize: 10.5, color: T.inkDim,
        marginBottom: 10,
      }}>from {toast.noteTitle}</div>
      <div style={{ display: 'flex', gap: 6 }}>
        <button onClick={() => onOpen(toast.noteId)} style={{
          flex: 1, padding: '5px 10px', borderRadius: 5, cursor: 'pointer',
          background: T.ink, color: T.bg, border: 'none',
          fontFamily: 'var(--mn-ui)', fontSize: 12, fontWeight: 500,
        }}>Open note</button>
        <button onClick={onSnooze || onDismiss} style={{
          padding: '5px 10px', borderRadius: 5, cursor: 'pointer',
          background: T.bg, color: T.inkMed, border: `1px solid ${T.line}`,
          fontFamily: 'var(--mn-ui)', fontSize: 12,
        }}>Snooze</button>
      </div>
    </div>
  );
}

window.MnTodosPanel = MnTodosPanel;
window.MnWorkflowPanel = MnWorkflowPanel;
window.MnNovelistPanel = MnNovelistPanel;
window.MnTodayPanel = MnTodayPanel;
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
