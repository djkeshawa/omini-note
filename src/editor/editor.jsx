// Editor pane: VispNote block outliner. Shows note title, date, tags, backlinks.

const { useState: useStateE, useMemo: useMemoE, useRef: useRefE, useEffect: useEffectE } = React;
const { mkBlock } = window.MN_OUTLINE || {};
const MnOutliner = window.MnOutliner;

function mnEditorPropertyParts(content = '') {
  const match = String(content || '').match(/^\s*([a-zA-Z][a-zA-Z0-9_-]*)::\s*(.*)$/);
  return match ? { key: match[1], value: match[2] || '' } : null;
}

function mnEditorSplitPropertyBlocks(blocks = []) {
  const safeBlocks = Array.isArray(blocks) ? blocks : [];
  let index = 0;
  const propertyBlocks = [];
  while (index < safeBlocks.length) {
    const block = safeBlocks[index];
    const prop = block?.kind === 'paragraph' ? mnEditorPropertyParts(block.content) : null;
    if (!prop) break;
    propertyBlocks.push(block);
    index++;
  }
  return {
    propertyBlocks,
    contentBlocks: safeBlocks.slice(index),
    properties: propertyBlocks.map(block => ({
      ...mnEditorPropertyParts(block.content),
      block,
    })),
  };
}

function mnEditorCleanPropertyKey(raw = '') {
  return String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9_-]+/g, '')
    .replace(/^[^a-z]+/, '')
    .slice(0, 40);
}

function mnEditorCreatePropertyBlock(key = '', value = '') {
  const content = `${key}:: ${value || ''}`.trimEnd();
  if (typeof mkBlock === 'function') return mkBlock({ kind: 'paragraph', content });
  return {
    id: `b_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    kind: 'paragraph',
    content,
    level: 0,
    checked: null,
    children: [],
    collapsed: false,
    annotations: [],
    workflow: null,
    language: '',
  };
}

function mnRenderMentionSnippet(snippet, T) {
  const parts = String(snippet || '').split(/<mark>|<\/mark>/);
  return parts.map((part, index) => index % 2
    ? <mark key={index} style={{ background: 'transparent', color: T.accent, fontWeight: 600 }}>{part}</mark>
    : <React.Fragment key={index}>{part}</React.Fragment>);
}

function mnMemoryNodeTitle(node) {
  const firstLine = String(node?.content || '')
    .split('\n')
    .map(line => line.replace(/^[#>\-*\s]+/, '').trim())
    .find(Boolean) || '';
  return firstLine.slice(0, 80) || node?.category || 'Memory';
}

function MnEditor({
  note, notes, tags, links, vaultId,
  searchQuery = '',
  connectionsRefreshToken = 0,
  memoryEnabled = false,
  canvases = [], onOpenCanvas, onCreateCanvas,
  onOpen, onCreateLinkedNote, onOpenTag, onLinkMention, onAcceptSuggestedConnection, onIgnoreSuggestedConnection,
  onBlocksChange, onTitleChange, onAddTag, onCreateTag, onRemoveTag,
  onEndNoteMetadataEdit, onUndoNoteEdit, onRedoNoteEdit,
  onPinToggle, onDuplicate, onDelete, onOpenVersions, onOpenGraph, onOpenCalendar, onBack,
  referencePaneOpen = false, onToggleReferencePane,
  onToggleSidebar, sidebarHidden,
  onToggleNoteList, noteListHidden,
  editorWidth = 'medium', fontSize = 'default',
  indentGuides = true, spellCheck = true, autoLink = true, collapseByDefault = false,
  novelistPath = null, novelistMode = false,
  workflowStates = [], workflowStatus = '', onSetWorkflowStatus,
  theme, T,
}) {
  const HAS_DISK_E = typeof window !== 'undefined' && !!window.mn;
  const [showTags, setShowTags] = useStateE(false);
  const [tagDraft, setTagDraft] = useStateE('');
  const [zoomBlockId, setZoomBlockId] = useStateE(null);
  const [toast, setToast] = useStateE(null);
  const toastTimerRef = useRefE(null);
  const editorSearchScopeRef = useRefE(null);
  const [searchMatch, setSearchMatch] = useStateE({ count: 0, activeIndex: 0 });
  const propertySplit = useMemoE(
    () => mnEditorSplitPropertyBlocks(note.blocks || []),
    [note.blocks]
  );
  const metadataProperties = propertySplit.properties || [];
  const contentBlocks = propertySplit.contentBlocks || [];
  const visibleMetadataProperties = metadataProperties.filter(prop => String(prop.key || '').toLowerCase() !== 'status');
  const hasStatusProperty = metadataProperties.some(prop => String(prop.key || '').toLowerCase() === 'status');
  const hasStatusRow = workflowStates.length > 0 || hasStatusProperty;
  const hasMetadataRows = hasStatusRow || visibleMetadataProperties.length > 0;
  const [addingProperty, setAddingProperty] = useStateE(false);
  const [propertyKeyDraft, setPropertyKeyDraft] = useStateE('');
  const [propertyValueDraft, setPropertyValueDraft] = useStateE('');

  // Reset zoom when note changes
  useEffectE(() => { setZoomBlockId(null); }, [note.id]);
  useEffectE(() => { setSearchMatch({ count: 0, activeIndex: 0 }); }, [note.id, searchQuery]);

  useEffectE(() => {
    const search = window.MN_EDITOR_SEARCH;
    if (!search?.applyEditorSearchHighlights) return undefined;
    const handle = requestAnimationFrame(() => {
      const result = search.applyEditorSearchHighlights(
        editorSearchScopeRef.current,
        searchQuery,
        searchMatch.activeIndex
      );
      setSearchMatch(current => (
        current.count === result.count && current.activeIndex === Math.max(0, result.activeIndex)
          ? current
          : { count: result.count, activeIndex: Math.max(0, result.activeIndex) }
      ));
      result.targets?.[result.activeIndex]?.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
    });
    return () => {
      cancelAnimationFrame(handle);
      search.clearEditorSearchHighlights?.();
    };
  }, [note.id, note.blocks, searchQuery, searchMatch.activeIndex]);

  const onShowToast = (msg) => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToast(msg);
    toastTimerRef.current = setTimeout(() => {
      setToast(null);
      toastTimerRef.current = null;
    }, 2200);
  };
  useEffectE(() => () => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
  }, []);

  const tagHue = useMemoE(() => {
    const m = {}; tags.forEach(t => m[t.name] = t.hue); return m;
  }, [tags]);

  const d = new Date(note.date);
  const dateText = d.toLocaleDateString([], {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric'
  });
  const timeText = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

  // Backlinks: prefer SQLite-backed lookup; fall back to in-memory scan
  // when running outside Electron (no window.mn).
  const inMemoryBacklinks = useMemoE(() => {
    // Electron always uses the SQLite result below; skip the full-vault
    // regex scan (it would otherwise run per keystroke and be discarded).
    if (HAS_DISK_E) return [];
    const re = new RegExp(`\\[\\[${note.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\]\\]`, 'i');
    return notes.filter(n => {
      if (n.id === note.id) return false;
      const body = n.body || mnBlocksToMd(n.blocks || []);
      return re.test(body);
    }).map(n => {
      const body = n.body || mnBlocksToMd(n.blocks || []);
      const line = body.split('\n').find(l =>
        l.toLowerCase().includes(`[[${note.title.toLowerCase()}]]`));
      return { id: n.id, title: n.title, context: line || '' };
    });
  }, [note, notes]);

  const [diskBacklinks, setDiskBacklinks] = useStateE(null);
  useEffectE(() => {
    if (!HAS_DISK_E || !vaultId) { setDiskBacklinks(null); return; }
    let cancelled = false;
    // Small debounce so live edits don't spam IPC mid-typing
    const handle = setTimeout(async () => {
      try {
        const res = await window.mn.backlinks(vaultId, note.title);
        if (!cancelled && res.ok) setDiskBacklinks(res.value);
      } catch (e) { console.error('backlinks failed', e); }
    }, 200);
    return () => { cancelled = true; clearTimeout(handle); };
    // Backlinks come from OTHER notes' bodies; editing this note's blocks
    // cannot change them, so blocks are deliberately not a dependency. The
    // refresh token bumps when a rename rewrites other notes on disk.
  }, [vaultId, note.id, note.title, connectionsRefreshToken]);

  const backlinks = diskBacklinks != null ? diskBacklinks : inMemoryBacklinks;

  // Unlinked mentions: notes whose text mentions this title without linking
  // to it. Debounced like backlinks; rows are removed optimistically when the
  // user links one.
  const [mentions, setMentions] = useStateE([]);
  useEffectE(() => {
    if (!HAS_DISK_E || !vaultId || !window.mn.unlinkedMentions || !String(note.title || '').trim()) {
      setMentions([]);
      return;
    }
    let cancelled = false;
    const handle = setTimeout(async () => {
      try {
        const res = await window.mn.unlinkedMentions(vaultId, note.title, 8);
        if (!cancelled && res.ok) setMentions(res.value || []);
      } catch (e) { console.error('unlinked mentions failed', e); }
    }, 250);
    return () => { cancelled = true; clearTimeout(handle); };
  }, [vaultId, note.id, note.title, connectionsRefreshToken]);

  const linkMention = (mention) => {
    if (!onLinkMention) return;
    onLinkMention(mention.id);
    // Remove the row either way: on success the mention became a link; on
    // failure the indexed mention no longer exists in the note's current
    // (unsaved) text, so leaving a dead row with a silent button is worse.
    setMentions(items => items.filter(item => item.id !== mention.id));
  };

  // Related notes via embeddings (semantic) with FTS top-up. Debounced so the
  // IPC fires once the note settles, and re-runs on note id only — content
  // edits don't move similarity meaningfully on every keystroke.
  const [related, setRelated] = useStateE({ items: [], mode: null, loading: false });
  useEffectE(() => {
    if (!HAS_DISK_E || !vaultId || !note.id) {
      setRelated({ items: [], mode: null, loading: false });
      return;
    }
    let cancelled = false;
    setRelated(prev => ({ ...prev, loading: true }));
    const handle = setTimeout(async () => {
      try {
        const res = await window.mn.ai.related(vaultId, note.id, { limit: 6 });
        if (cancelled) return;
        if (res?.ok && res.value?.ok) setRelated({ items: res.value.items || [], mode: res.value.mode, loading: false });
        else setRelated({ items: [], mode: null, loading: false });
      } catch (e) {
        if (!cancelled) setRelated({ items: [], mode: null, loading: false });
      }
    }, 400);
    return () => { cancelled = true; clearTimeout(handle); };
  }, [vaultId, note.id]);

  const ignoredConnectionsKey = `mn:ignoredConnections:${vaultId || 'local'}:${note.id}`;
  const [ignoredConnectionIds, setIgnoredConnectionIds] = useStateE(() => (
    window.MN_STORAGE?.getJson?.(ignoredConnectionsKey, []) || []
  ));
  useEffectE(() => {
    setIgnoredConnectionIds(window.MN_STORAGE?.getJson?.(ignoredConnectionsKey, []) || []);
  }, [ignoredConnectionsKey]);
  const suggestedConnections = useMemoE(() => (
    window.MN_CONNECTIONS_MODEL?.suggestedConnections?.({
      noteId: note.id,
      currentNote: note,
      notes,
      related: related.items,
      mode: related.mode,
      links,
      ignoredIds: ignoredConnectionIds,
      limit: 4,
    }) || []
  ), [note.id, note.title, note.tags, notes, related.items, related.mode, links, ignoredConnectionIds]);
  const suggestedConnectionIds = useMemoE(
    () => new Set(suggestedConnections.map(item => String(item.noteId || item.id || ''))),
    [suggestedConnections]
  );
  const passiveRelatedItems = useMemoE(
    () => related.items.filter(item => !suggestedConnectionIds.has(String(item.noteId || item.id || ''))),
    [related.items, suggestedConnectionIds]
  );
  const ignoreSuggestedConnection = (item) => {
    const id = window.MN_CONNECTIONS_MODEL?.connectionNoteId?.(item) || item?.noteId || item?.id;
    if (!id) return;
    setIgnoredConnectionIds(current => {
      const next = [...new Set([...(current || []), String(id)])];
      window.MN_STORAGE?.setJson?.(ignoredConnectionsKey, next);
      return next;
    });
    onIgnoreSuggestedConnection?.(item);
  };
  const acceptSuggestedConnection = (item) => {
    if (onAcceptSuggestedConnection?.(item) !== false) ignoreSuggestedConnection(item);
  };

  // Connected memories: this note's neighbors in the llm-memory knowledge graph.
  // Only runs when the bridge is enabled; a disabled/unreachable server or an
  // un-remembered note degrades to an empty panel (no error surfaced). The seed
  // node and low-relevance neighbors are filtered so the panel stays a signal,
  // not a firehose.
  const [connected, setConnected] = useStateE({ items: [], explanation: '', via: '', loading: false });
  useEffectE(() => {
    if (!HAS_DISK_E || !memoryEnabled || !vaultId || !note.id || !window.mn.memory?.connected) {
      setConnected({ items: [], explanation: '', via: '', loading: false });
      return;
    }
    let cancelled = false;
    setConnected(prev => ({ ...prev, loading: true }));
    const handle = setTimeout(async () => {
      try {
        const res = await window.mn.memory.connected(vaultId, note.id, { limit: 8 });
        if (cancelled) return;
        const value = res?.ok ? res.value : null;
        const neighbors = value?.neighbors;
        if (!neighbors || !Array.isArray(neighbors.nodes) || !neighbors.nodes.length) {
          setConnected({ items: [], explanation: '', via: '', loading: false });
          return;
        }
        const items = neighbors.nodes
          .filter(n => n.id && n.id !== value.memoryId)
          .filter(n => n.relevanceScore == null || n.relevanceScore >= 0.2)
          .slice(0, 6)
          .map(n => ({
            id: n.id,
            title: mnMemoryNodeTitle(n),
            content: String(n.content || '').replace(/\s+/g, ' ').trim(),
            snippet: String(n.content || '').replace(/\s+/g, ' ').trim().slice(0, 160),
            category: n.category || '',
          }));
        setConnected({ items, explanation: String(neighbors.explanation || ''), via: value.via || '', loading: false });
      } catch (e) {
        if (!cancelled) setConnected({ items: [], explanation: '', via: '', loading: false });
      }
    }, 500);
    return () => { cancelled = true; clearTimeout(handle); };
  }, [vaultId, note.id, memoryEnabled, connectionsRefreshToken]);

  // Word count from blocks
  const wordCount = useMemoE(() => {
    let count = 0;
    mnWalk(contentBlocks || [], (b) => {
      count += b.content.split(/\s+/).filter(Boolean).length;
    });
    return count;
  }, [contentBlocks]);

  const setBlocks = (updater) => {
    onBlocksChange(prevBlocks => {
      const prevSplit = mnEditorSplitPropertyBlocks(prevBlocks || []);
      const nextContent = typeof updater === 'function'
        ? updater(prevSplit.contentBlocks || [])
        : updater;
      return [...(prevSplit.propertyBlocks || []), ...(nextContent || [])];
    });
  };

  const updateMetadataProperty = (key, value) => {
    onBlocksChange(prevBlocks => {
      const prevSplit = mnEditorSplitPropertyBlocks(prevBlocks || []);
      const lowerKey = String(key || '').toLowerCase();
      const nextPropertyBlocks = (prevSplit.propertyBlocks || []).map(block => {
        const prop = mnEditorPropertyParts(block.content);
        if (!prop || prop.key.toLowerCase() !== lowerKey) return block;
        return { ...block, content: `${prop.key}:: ${value || ''}`.trimEnd() };
      });
      return [...nextPropertyBlocks, ...(prevSplit.contentBlocks || [])];
    });
  };

  const removeMetadataProperty = (key) => {
    const lowerKey = String(key || '').toLowerCase();
    if (lowerKey === 'status') {
      onSetWorkflowStatus && onSetWorkflowStatus(null);
      return;
    }
    onBlocksChange(prevBlocks => {
      const prevSplit = mnEditorSplitPropertyBlocks(prevBlocks || []);
      const nextPropertyBlocks = (prevSplit.propertyBlocks || []).filter(block => {
        const prop = mnEditorPropertyParts(block.content);
        return !prop || prop.key.toLowerCase() !== lowerKey;
      });
      return [...nextPropertyBlocks, ...(prevSplit.contentBlocks || [])];
    });
  };

  const addMetadataProperty = () => {
    const cleanKey = mnEditorCleanPropertyKey(propertyKeyDraft);
    if (!cleanKey) return;
    const cleanValue = String(propertyValueDraft || '').trim();
    if (cleanKey === 'status') {
      onSetWorkflowStatus && onSetWorkflowStatus(cleanValue || null);
      setPropertyKeyDraft('');
      setPropertyValueDraft('');
      setAddingProperty(false);
      return;
    }
    onBlocksChange(prevBlocks => {
      const prevSplit = mnEditorSplitPropertyBlocks(prevBlocks || []);
      const exists = (prevSplit.propertyBlocks || []).some(block => {
        const prop = mnEditorPropertyParts(block.content);
        return prop && prop.key.toLowerCase() === cleanKey;
      });
      const nextPropertyBlocks = exists
        ? (prevSplit.propertyBlocks || []).map(block => {
          const prop = mnEditorPropertyParts(block.content);
          if (!prop || prop.key.toLowerCase() !== cleanKey) return block;
          return { ...block, content: `${prop.key}:: ${cleanValue}`.trimEnd() };
        })
        : [...(prevSplit.propertyBlocks || []), mnEditorCreatePropertyBlock(cleanKey, cleanValue)];
      return [...nextPropertyBlocks, ...(prevSplit.contentBlocks || [])];
    });
    setPropertyKeyDraft('');
    setPropertyValueDraft('');
    setAddingProperty(false);
  };

  const createAndApplyTag = () => {
    const raw = tagDraft.trim();
    if (!raw) return;
    if (onCreateTag) onCreateTag(raw);
    setTagDraft('');
    setShowTags(false);
  };

  return (
    <div style={{
      flex: 1, height: '100%',
      background: `
        linear-gradient(180deg, ${T.bgElevated || T.bg} 0%, ${T.bg} 24%, ${T.bg} 100%)`,
      display: 'flex', flexDirection: 'column', position: 'relative',
      minWidth: 0,
    }}>
      {/* Toolbar */}
      <div style={{
        padding: '12px clamp(18px, 4vw, 76px) 10px clamp(18px, 3vw, 28px)',
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        minHeight: 54,
        borderBottom: `1px solid ${T.lineSub}`,
        background: `color-mix(in oklab, ${T.bgElevated || T.bg} 88%, transparent)`,
        backdropFilter: 'blur(12px)',
      }}>
        {onBack && (
          <button onClick={onBack} title="Back to previous view" style={iconBtn(T)}>
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7">
              <path d="M10 3L5 8L10 13" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        )}
        {Array.isArray(novelistPath) && novelistPath.length > 1 && (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 5,
            flexWrap: 'wrap',
            minWidth: 0,
            fontFamily: 'var(--mn-ui)',
            fontSize: 11.5,
            color: T.inkDim,
          }}>
            {novelistPath.map((item, index) => (
              <React.Fragment key={item.id}>
                {index > 0 && <span style={{ color: T.line }}>›</span>}
                <button
                  onClick={() => onOpen && onOpen(item.id)}
                  disabled={item.id === note.id}
                  style={{
                    border: 'none',
                    background: 'transparent',
                    color: item.id === note.id ? T.inkDim : T.inkMed,
                    cursor: item.id === note.id ? 'default' : 'pointer',
                    padding: '1px 2px',
                    fontFamily: 'var(--mn-ui)',
                    fontSize: 11.5,
                    maxWidth: 170,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}>
                  {item.title || 'Untitled'}
                </button>
              </React.Fragment>
            ))}
          </div>
        )}
        <div style={{ flex: 1 }} />
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 7,
          fontFamily: 'var(--mn-mono)',
          fontSize: 10.5,
          color: T.inkDim,
          textTransform: 'uppercase',
          whiteSpace: 'nowrap',
          maxWidth: 'min(48vw, 560px)',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}>
          <span>{dateText}</span>
          <span style={{ color: T.lineSub }}>·</span>
          <span>{timeText}</span>
          <span style={{ color: T.lineSub }}>·</span>
          <span>{wordCount} words</span>
        </div>

        <button onClick={onPinToggle} title="Pin" style={iconBtn(T, note.pinned)}>
          <svg width="12" height="12" viewBox="0 0 16 16" fill={note.pinned ? T.accent : 'none'} stroke={note.pinned ? T.accent : 'currentColor'} strokeWidth="1.3">
            <path d="M10 1.5L14.5 6L11 7L8 10L6 8L9 5L10 1.5Z"/>
            <path d="M6 8L2.5 11.5" strokeLinecap="round"/>
          </svg>
        </button>
        <button onClick={onOpenGraph} title="Graph (⌘G)" style={iconBtn(T)}>
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3">
            <circle cx="4" cy="4" r="1.6"/><circle cx="12" cy="4" r="1.6"/><circle cx="8" cy="12" r="1.6"/>
            <path d="M5.5 5L10.5 5M5.3 5.8L6.8 10.4M10.7 5.8L9.2 10.4"/>
          </svg>
        </button>
        {onOpenCalendar && (
          <button onClick={onOpenCalendar} title="Agenda" aria-label="Agenda" style={iconBtn(T)}>
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3">
              <rect x="2.5" y="3.5" width="11" height="10" rx="1.4"/>
              <path d="M5 2.5V5M11 2.5V5M2.5 7H13.5" strokeLinecap="round"/>
              <circle cx="8" cy="10.3" r="1.3" fill="currentColor" stroke="none"/>
            </svg>
          </button>
        )}
        <button onClick={onDuplicate} title="Duplicate note" style={iconBtn(T)}>
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3">
            <rect x="5" y="5" width="8" height="8" rx="1.2"/>
            <path d="M3 10.5V3H10.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>
        {onOpenVersions && (
          <button onClick={onOpenVersions} title="Version history" style={iconBtn(T)}>
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3">
              <path d="M4 4.5C5 3.3 6.5 2.5 8.2 2.5C11.2 2.5 13.5 4.8 13.5 7.8C13.5 10.8 11.2 13.2 8.2 13.2C5.7 13.2 3.7 11.6 3 9.4" strokeLinecap="round"/>
              <path d="M3 4.5H4.8V2.7M8 5.4V8.2L10 9.3" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
        )}
        {onToggleReferencePane && (
          <button onClick={onToggleReferencePane} title={referencePaneOpen ? 'Close reference pane' : 'Open reference pane'} aria-label={referencePaneOpen ? 'Close reference pane' : 'Open reference pane'} style={iconBtn(T, referencePaneOpen)}>
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden="true">
              <rect x="2.5" y="2.5" width="11" height="11" rx="1.5" />
              <path d="M9 2.5v11M10.8 5h1" strokeLinecap="round" />
            </svg>
          </button>
        )}
        <button onClick={onDelete} title="Delete" style={iconBtn(T)}>
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3">
            <path d="M3 4.5H13M6 4.5V3C6 2.5 6.5 2 7 2H9C9.5 2 10 2.5 10 3V4.5M5 4.5V13C5 13.5 5.5 14 6 14H10C10.5 14 11 13.5 11 13V4.5" strokeLinecap="round"/>
          </svg>
        </button>
      </div>

      <div style={{ flex: 1, overflow: 'auto', padding: '0 clamp(18px, 4.5vw, 56px) 44px' }}>
        <div ref={editorSearchScopeRef} style={{
          maxWidth: editorWidth === 'narrow' ? 720
                  : editorWidth === 'wide' ? 1280
                  : editorWidth === 'full' ? 'none'
                  : 1000,
          margin: '0 auto', paddingTop: 22,
          fontSize: fontSize === 'small' ? '13px' : fontSize === 'large' ? '16px' : '14.5px',
        }}>
          <input
            className="mn-note-title-input"
            value={note.title}
            onChange={(e) => onTitleChange(e.target.value)}
            onBlur={() => onEndNoteMetadataEdit && onEndNoteMetadataEdit()}
            spellCheck={spellCheck}
            onKeyDown={(e) => {
              const isMod = e.metaKey || e.ctrlKey;
              const lower = String(e.key || '').toLowerCase();
              if (isMod && lower === 'z' && !e.shiftKey && onUndoNoteEdit) {
                e.preventDefault();
                onUndoNoteEdit();
                return;
              }
              if (((isMod && e.shiftKey && lower === 'z') || (isMod && lower === 'y')) && onRedoNoteEdit) {
                e.preventDefault();
                onRedoNoteEdit();
                return;
              }
              if (e.key === 'Enter' || e.key === 'ArrowDown' || (e.key === 'Tab' && !e.shiftKey)) {
                e.preventDefault();
                // Focus first block in outliner
                const first = document.querySelector('.mn-block-row');
                if (first) {
                  const editArea = first.querySelector('div[style*="cursor: text"]');
                  if (editArea) editArea.click();
                  setTimeout(() => {
                    const ta = first.querySelector('textarea');
                    if (ta) { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); }
                  }, 30);
                }
              }
            }}
            placeholder="Untitled"
            style={{
              width: '100%', border: 'none', outline: 'none', background: 'transparent',
              fontFamily: 'var(--mn-body)', fontSize: 'clamp(27px, 2.3vw, 34px)', fontWeight: 600,
              color: T.ink, letterSpacing: 0, marginBottom: 12,
              padding: 0,
            }}
          />

          {!!String(searchQuery || '').trim() && (
            <div data-mn-search-toolbar="true" role="group" aria-label="Search matches in this note" style={{
              display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 6,
              margin: '-3px 0 13px', fontFamily: 'var(--mn-ui)', fontSize: 11.5, color: T.inkDim,
            }}>
              <span aria-live="polite">
                {searchMatch.count ? `${searchMatch.activeIndex + 1} of ${searchMatch.count}` : 'No matches in this note'}
              </span>
              <button type="button" aria-label="Previous search match" disabled={!searchMatch.count} onClick={() => {
                setSearchMatch(current => ({ ...current, activeIndex: current.count ? (current.activeIndex - 1 + current.count) % current.count : 0 }));
              }} style={iconBtn(T)}>
                <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
                  <path d="M2.5 7.5L6 4L9.5 7.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
              <button type="button" aria-label="Next search match" disabled={!searchMatch.count} onClick={() => {
                setSearchMatch(current => ({ ...current, activeIndex: current.count ? (current.activeIndex + 1) % current.count : 0 }));
              }} style={iconBtn(T)}>
                <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
                  <path d="M2.5 4.5L6 8L9.5 4.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            </div>
          )}

          <div style={{
            display: 'flex', gap: 6, marginBottom: 9, alignItems: 'center', flexWrap: 'wrap'
          }}>
            {note.tags.map(t => (
              <span key={t} onClick={() => onRemoveTag(t)} style={{
                fontFamily: 'var(--mn-mono)', fontSize: 10.5,
                color: mnGetTagColor(tagHue[t] ?? 240, theme),
                padding: '2px 7px', borderRadius: 4,
                background: mnGetTagBg(tagHue[t] ?? 240, theme),
                cursor: 'pointer',
              }} title="Click to remove">#{t}</span>
            ))}
            <div style={{ position: 'relative' }}>
              <button onClick={() => setShowTags(v => !v)} style={{
                fontFamily: 'var(--mn-mono)', fontSize: 10.5,
                color: T.inkDim, padding: '2px 7px', borderRadius: 4,
                background: 'transparent', border: `1px dashed ${T.line}`,
                cursor: 'pointer',
              }}>+ tag</button>
              {showTags && (
                <div style={{
                  position: 'absolute', top: '100%', left: 0, marginTop: 4,
                  background: T.bg, border: `1px solid ${T.line}`,
                  borderRadius: 6, padding: 4, zIndex: 10, minWidth: 180,
                  boxShadow: `0 8px 24px color-mix(in oklab, ${T.ink} 12%, transparent)`,
                }}>
                  <div style={{ display: 'flex', gap: 4, padding: 4 }}>
                    <input
                      value={tagDraft}
                      onChange={(e) => setTagDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') { e.preventDefault(); createAndApplyTag(); }
                        if (e.key === 'Escape') { e.preventDefault(); setShowTags(false); }
                      }}
                      placeholder="new tag"
                      style={{
                        flex: 1, minWidth: 0, border: `1px solid ${T.lineSub}`,
                        borderRadius: 5, padding: '5px 7px',
                        background: T.bgSub, color: T.ink,
                        fontFamily: 'var(--mn-ui)', fontSize: 12,
                        outline: 'none',
                      }}
                    />
                    <button
                      onMouseDown={(e) => { e.preventDefault(); createAndApplyTag(); }}
                      disabled={!tagDraft.trim()}
                      title="Create tag"
                      style={{
                        width: 28, borderRadius: 5,
                        border: `1px solid ${T.lineSub}`,
                        background: tagDraft.trim() ? T.ink : T.bg,
                        color: tagDraft.trim() ? T.bg : T.inkDim,
                        cursor: tagDraft.trim() ? 'pointer' : 'default',
                        padding: 0,
                      }}>+</button>
                  </div>
                  <div style={{ height: 1, background: T.lineSub, margin: '2px 4px 4px' }} />
                  {tags.filter(t => !note.tags.includes(t.name)).map(t => (
                    <div key={t.name} onClick={() => { onAddTag(t.name); setShowTags(false); }}
                      style={{
                        padding: '5px 8px', borderRadius: 4, cursor: 'pointer',
                        fontFamily: 'var(--mn-ui)', fontSize: 12.5,
                        display: 'flex', alignItems: 'center', gap: 6,
                      }}
                      onMouseEnter={e => e.currentTarget.style.background = T.bgHover}
                      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                      <span style={{ width: 6, height: 6, borderRadius: '50%',
                        background: mnGetTagColor(t.hue, theme) }} />
                      {t.name}
                    </div>
                  ))}
                  {tags.filter(t => !note.tags.includes(t.name)).length === 0 && (
                    <div style={{ padding: '6px 8px', fontSize: 11.5, color: T.inkDim, fontStyle: 'italic' }}>all tags applied</div>
                  )}
                </div>
              )}
            </div>
          </div>

          <div style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(72px, max-content) minmax(150px, 360px) 22px',
            columnGap: 8,
            rowGap: 3,
            alignItems: 'center',
            margin: hasMetadataRows || addingProperty ? '0 0 18px' : '-2px 0 18px',
            padding: hasMetadataRows || addingProperty ? '10px 12px' : 0,
            width: 'fit-content',
            maxWidth: '100%',
            border: hasMetadataRows || addingProperty ? `1px solid ${T.lineSub}` : 'none',
            borderRadius: hasMetadataRows || addingProperty ? 8 : 0,
            background: hasMetadataRows || addingProperty ? T.bgSub : 'transparent',
          }}>
            {hasStatusRow && (
              <>
                <div style={mnMetadataKeyStyle(T)}>status::</div>
                <select
                  value={workflowStatus || ''}
                  onChange={(e) => onSetWorkflowStatus && onSetWorkflowStatus(e.target.value || null)}
                  spellCheck={false}
                  style={{
                    ...mnMetadataValueStyle(T),
                    width: 'auto',
                    minWidth: 110,
                    maxWidth: 180,
                    border: `1px solid ${T.lineSub}`,
                    borderRadius: 4,
                    padding: '2px 24px 2px 6px',
                    color: T.inkMed,
                  }}>
                  <option value="">None</option>
                  {workflowStates.map(state => <option key={state.id} value={state.id}>{state.id}</option>)}
                </select>
                <button
                  onClick={() => removeMetadataProperty('status')}
                  title="Remove status"
                  style={mnMetadataIconButton(T)}>x</button>
              </>
            )}
            {visibleMetadataProperties.map(prop => (
              <React.Fragment key={`${prop.block.id}:${prop.key}`}>
                <div style={mnMetadataKeyStyle(T)}>{prop.key}::</div>
                <input
                  value={prop.value || ''}
                  onChange={(e) => updateMetadataProperty(prop.key, e.target.value)}
                  spellCheck={spellCheck}
                  style={mnMetadataValueStyle(T)}
                />
                <button
                  onClick={() => removeMetadataProperty(prop.key)}
                  title={`Remove ${prop.key}`}
                  style={mnMetadataIconButton(T)}>x</button>
              </React.Fragment>
            ))}
            {addingProperty && (
              <>
                <input
                  value={propertyKeyDraft}
                  onChange={(e) => setPropertyKeyDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') { e.preventDefault(); addMetadataProperty(); }
                    if (e.key === 'Escape') { e.preventDefault(); setAddingProperty(false); setPropertyKeyDraft(''); setPropertyValueDraft(''); }
                  }}
                  autoFocus
                  placeholder="property"
                  spellCheck={false}
                  style={{ ...mnMetadataValueStyle(T), color: T.inkDim }}
                />
                <input
                  value={propertyValueDraft}
                  onChange={(e) => setPropertyValueDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') { e.preventDefault(); addMetadataProperty(); }
                    if (e.key === 'Escape') { e.preventDefault(); setAddingProperty(false); setPropertyKeyDraft(''); setPropertyValueDraft(''); }
                  }}
                  placeholder="value"
                  spellCheck={spellCheck}
                  style={mnMetadataValueStyle(T)}
                />
                <button
                  onClick={addMetadataProperty}
                  disabled={!mnEditorCleanPropertyKey(propertyKeyDraft)}
                  title="Add property"
                  style={mnMetadataIconButton(T)}>+</button>
              </>
            )}
            {!addingProperty && (
              <button
                onClick={() => setAddingProperty(true)}
                style={{
                  gridColumn: '1 / span 2',
                  width: 'fit-content',
                  border: 'none',
                  background: 'transparent',
                  color: T.inkDim,
                  cursor: 'pointer',
                  fontFamily: 'var(--mn-mono)',
                  fontSize: 10.5,
                  padding: '2px 0',
                }}>+ property</button>
            )}
          </div>

          {/* Outliner */}
          <MnOutliner
            blocks={contentBlocks}
            setBlocks={setBlocks}
            allNotes={notes}
            allCanvases={canvases}
            noteId={note.id}
            noteTitle={note.title}
            noteTags={note.tags || []}
            vaultId={vaultId}
            zoomBlockId={zoomBlockId}
            onZoomBlock={setZoomBlockId}
            onShowToast={onShowToast}
            onOpen={(label, noteId, blockId) => {
              // Multi-mode:
              //   onOpen(label) → open by title (wiki-link)
              //   onOpen(null, noteId) → open by id (page embed)
              //   onOpen(null, noteId, blockId) → open by id + zoom into block (block ref)
              if (noteId) {
                onOpen(noteId);
                if (blockId) setZoomBlockId(blockId);
                return;
              }
              const target = notes.find(n => n.title.toLowerCase() === label.toLowerCase());
              if (target) onOpen(target.id);
              else if (onCreateLinkedNote) onCreateLinkedNote(label);
            }}
            onTagClick={onOpenTag}
            onOpenCanvas={onOpenCanvas}
            onCreateCanvas={onCreateCanvas}
            fontSize={fontSize}
            indentGuides={indentGuides}
            spellCheck={spellCheck}
            autoLink={autoLink}
            collapseByDefault={collapseByDefault}
            novelistMode={novelistMode}
            T={T}
          />

          {(suggestedConnections.length > 0 || backlinks.length > 0 || mentions.length > 0 || passiveRelatedItems.length > 0 || connected.items.length > 0) && (
            <div style={{ marginTop: 40, paddingTop: 20, borderTop: `1px solid ${T.lineSub}` }}>
              <div style={{
                fontFamily: 'var(--mn-ui)', fontSize: 15, fontWeight: 720,
                color: T.ink, marginBottom: suggestedConnections.length ? 10 : 2,
              }}>Connections</div>
              {suggestedConnections.length > 0 && (
                <div style={{ marginBottom: 18 }}>
                  <div style={{ fontFamily: 'var(--mn-mono)', fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: T.inkDim, marginBottom: 7 }}>
                    Suggested links
                  </div>
                  {suggestedConnections.map(item => (
                    <div key={item.noteId || item.id} style={{
                      display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto auto', gap: 6, alignItems: 'center',
                      padding: '9px 10px', marginBottom: 6, borderRadius: 6,
                      background: T.bgSub, border: `1px solid ${T.lineSub}`,
                    }}>
                      <button type="button" onClick={() => onOpen(item.noteId || item.id)} style={{
                        minWidth: 0, border: 0, background: 'transparent', color: T.ink,
                        textAlign: 'left', cursor: 'pointer', fontFamily: 'var(--mn-ui)', fontSize: 12.5,
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      }}>{item.title || 'Untitled'}</button>
                      {item.reason && <span style={{ gridColumn: '1 / -1', fontFamily: 'var(--mn-mono)', fontSize: 9.5, color: T.inkDim }}>{item.reason}</span>}
                      <button type="button" aria-label={`Accept connection to ${item.title || 'note'}`} onClick={() => acceptSuggestedConnection(item)} style={mnConnectionActionStyle(T, true)}>Accept</button>
                      <button type="button" aria-label={`Ignore connection to ${item.title || 'note'}`} onClick={() => ignoreSuggestedConnection(item)} style={mnConnectionActionStyle(T, false)}>Ignore</button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {backlinks.length > 0 && (
            <div style={{
              marginTop: 18,
            }}>
              <div style={{
                fontFamily: 'var(--mn-mono)', fontSize: 10,
                letterSpacing: '0.12em', textTransform: 'uppercase',
                color: T.inkDim, marginBottom: 10,
              }}>← {backlinks.length} backlink{backlinks.length > 1 ? 's' : ''}</div>
              {backlinks.map(b => (
                <div key={b.id} onClick={() => onOpen(b.id)} style={{
                  padding: '10px 12px', marginBottom: 6, borderRadius: 6,
                  background: T.bgSub, border: `1px solid ${T.lineSub}`,
                  cursor: 'pointer',
                }}
                onMouseEnter={e => e.currentTarget.style.background = T.bgHover}
                onMouseLeave={e => e.currentTarget.style.background = T.bgSub}>
                  <div style={{
                    fontFamily: 'var(--mn-ui)', fontSize: 12, fontWeight: 500,
                    color: T.ink, marginBottom: 3,
                  }}>{b.title}</div>
                  <div style={{
                    fontFamily: 'var(--mn-body)', fontSize: 12.5,
                    color: T.inkMed, lineHeight: 1.5,
                  }}>{b.context.replace(/\[\[([^\]]+)\]\]/g, '$1').replace(/^[-#>*\s]*\s*/, '')}</div>
                </div>
              ))}
            </div>
          )}

          {mentions.length > 0 && (
            <div style={{
              marginTop: 18,
            }}>
              <div style={{
                fontFamily: 'var(--mn-mono)', fontSize: 10,
                letterSpacing: '0.12em', textTransform: 'uppercase',
                color: T.inkDim, marginBottom: 10,
              }}>~ {mentions.length} unlinked mention{mentions.length > 1 ? 's' : ''}</div>
              {mentions.map(m => (
                <div key={m.id} style={{
                  display: 'grid', gridTemplateColumns: '1fr auto', gap: 10, alignItems: 'center',
                  padding: '10px 12px', marginBottom: 6, borderRadius: 6,
                  background: T.bgSub, border: `1px solid ${T.lineSub}`,
                }}>
                  <div onClick={() => onOpen(m.id)} style={{ cursor: 'pointer', minWidth: 0 }}>
                    <div style={{
                      fontFamily: 'var(--mn-ui)', fontSize: 12, fontWeight: 500,
                      color: T.ink, marginBottom: 3,
                    }}>{m.title}</div>
                    <div style={{
                      fontFamily: 'var(--mn-body)', fontSize: 12.5,
                      color: T.inkMed, lineHeight: 1.5,
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>{mnRenderMentionSnippet(m.snippet, T)}</div>
                  </div>
                  {onLinkMention && (
                    <button
                      onClick={() => linkMention(m)}
                      title={`Link this mention to “${note.title}”`}
                      style={{
                        border: `1px solid ${T.lineSub}`, borderRadius: 6,
                        background: T.bg, color: T.accent, cursor: 'pointer',
                        fontFamily: 'var(--mn-ui)', fontSize: 11.5, fontWeight: 600,
                        padding: '5px 10px', whiteSpace: 'nowrap',
                      }}>
                      Link
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}

          {passiveRelatedItems.length > 0 && (
            <div style={{
              marginTop: 18,
            }}>
              <div style={{
                fontFamily: 'var(--mn-mono)', fontSize: 10,
                letterSpacing: '0.12em', textTransform: 'uppercase',
                color: T.inkDim, marginBottom: 10,
                display: 'flex', alignItems: 'center', gap: 8,
              }}>
                <span>≈ {passiveRelatedItems.length} related</span>
                {related.mode && (
                  <span style={{
                    fontSize: 9, letterSpacing: '0.1em',
                    color: T.inkDim, opacity: 0.7,
                  }}>{related.mode === 'semantic' ? 'semantic' : 'keyword'}</span>
                )}
              </div>
              {passiveRelatedItems.map(r => (
                <div key={r.noteId} onClick={() => onOpen(r.noteId)} style={{
                  padding: '10px 12px', marginBottom: 6, borderRadius: 6,
                  background: T.bgSub, border: `1px solid ${T.lineSub}`,
                  cursor: 'pointer',
                }}
                onMouseEnter={e => e.currentTarget.style.background = T.bgHover}
                onMouseLeave={e => e.currentTarget.style.background = T.bgSub}>
                  <div style={{
                    fontFamily: 'var(--mn-ui)', fontSize: 12, fontWeight: 500,
                    color: T.ink, marginBottom: 3,
                  }}>{r.title}</div>
                  {r.snippet && (
                    <div style={{
                      fontFamily: 'var(--mn-body)', fontSize: 12.5,
                      color: T.inkMed, lineHeight: 1.5,
                    }}>{r.snippet}</div>
                  )}
                </div>
              ))}
            </div>
          )}
          {connected.items.length > 0 && (
            <div style={{
              marginTop: 18,
            }}>
              <div style={{
                fontFamily: 'var(--mn-mono)', fontSize: 10,
                letterSpacing: '0.12em', textTransform: 'uppercase',
                color: T.inkDim, marginBottom: 10,
                display: 'flex', alignItems: 'center', gap: 8,
              }}>
                <span>◆ {connected.items.length} in memory</span>
                <span style={{
                  fontSize: 9, letterSpacing: '0.1em',
                  color: T.inkDim, opacity: 0.7,
                }}>{connected.via === 'link' ? 'graph' : 'similar'}</span>
              </div>
              {connected.explanation && (
                <div style={{
                  fontFamily: 'var(--mn-body)', fontSize: 11.5,
                  color: T.inkDim, lineHeight: 1.45, marginBottom: 10, fontStyle: 'italic',
                }}>{connected.explanation}</div>
              )}
              {connected.items.map(item => (
                <div key={item.id} title={item.content} style={{
                  padding: '10px 12px', marginBottom: 6, borderRadius: 6,
                  background: T.bgSub, border: `1px solid ${T.lineSub}`,
                }}>
                  <div style={{
                    fontFamily: 'var(--mn-ui)', fontSize: 12, fontWeight: 500,
                    color: T.ink, marginBottom: 3,
                    display: 'flex', alignItems: 'center', gap: 6,
                  }}>
                    <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.title}</span>
                    {item.category && (
                      <span style={{
                        fontFamily: 'var(--mn-mono)', fontSize: 8.5, letterSpacing: '0.08em',
                        textTransform: 'uppercase', color: T.inkDim, opacity: 0.75, flexShrink: 0,
                      }}>{item.category}</span>
                    )}
                  </div>
                  {item.snippet && (
                    <div style={{
                      fontFamily: 'var(--mn-body)', fontSize: 12.5,
                      color: T.inkMed, lineHeight: 1.5,
                    }}>{item.snippet}</div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
      {toast && (
        <div style={{
          position: 'absolute', bottom: 24, left: '50%',
          transform: 'translateX(-50%)',
          padding: '8px 14px',
          background: T.ink, color: T.bg,
          borderRadius: 6,
          fontFamily: 'var(--mn-ui)', fontSize: 12.5,
          boxShadow: '0 4px 16px rgba(0,0,0,0.18)',
          zIndex: 60,
          pointerEvents: 'none',
        }}>{toast}</div>
      )}
      <style>{`
        ::highlight(mn-search-all) { background: color-mix(in oklab, ${T.accent} 30%, transparent); }
        ::highlight(mn-search-active) { background: color-mix(in oklab, ${T.accent} 58%, transparent); color: ${T.ink}; }
        [data-mn-search-match="true"] { background: color-mix(in oklab, ${T.accent} 18%, transparent); border-radius: 4px; }
        [data-mn-search-active="true"] { box-shadow: 0 0 0 2px color-mix(in oklab, ${T.accent} 50%, transparent); }
      `}</style>
    </div>
  );
}

function iconBtn(T, active) {
  return {
    ...(typeof mnIconButtonStyle === 'function' ? mnIconButtonStyle(T, active, 28) : {}),
    height: 26,
    borderRadius: 6,
    border: `1px solid ${active ? T.selLine || T.accent : T.lineSub}`,
    background: active ? T.accentSoft : (T.bgElevated || T.bg),
    color: active ? T.accent : T.inkMed,
    cursor: 'pointer',
    padding: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  };
}

function mnConnectionActionStyle(T, primary = false) {
  return {
    border: `1px solid ${primary ? T.accent : T.lineSub}`,
    borderRadius: 6,
    background: primary ? T.accentSoft : T.bg,
    color: primary ? T.accent : T.inkDim,
    cursor: 'pointer',
    fontFamily: 'var(--mn-ui)',
    fontSize: 11,
    fontWeight: 650,
    padding: '4px 8px',
  };
}

function mnMetadataKeyStyle(T) {
  return {
    fontFamily: 'var(--mn-mono)',
    fontSize: 10.5,
    color: T.inkDim,
    textTransform: 'lowercase',
    padding: '2px 0',
  };
}

function mnMetadataValueStyle(T) {
  return {
    minWidth: 0,
    border: 'none',
    outline: 'none',
    background: 'transparent',
    color: T.inkMed,
    fontFamily: 'var(--mn-mono)',
    fontSize: 11.5,
    padding: '2px 0',
  };
}

function mnMetadataIconButton(T) {
  return {
    width: 20,
    height: 20,
    border: `1px solid transparent`,
    borderRadius: 5,
    background: 'transparent',
    color: T.inkDim,
    cursor: 'pointer',
    fontFamily: 'var(--mn-mono)',
    fontSize: 11,
    lineHeight: 1,
    padding: 0,
  };
}

window.MnEditor = MnEditor;
