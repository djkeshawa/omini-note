// Editor pane: VispNote block outliner with focused title, tags, metadata, and connections.

import { DS_PANE, DS_RADIUS } from '../shared/designSystem.js';
import { useResponsiveLayout } from '../shared/layout/useResponsiveLayout.js';
import {
  cleanPropertyKey,
  ConnectionsSection,
  createPropertyBlock,
  PropertiesPanel,
  propertyParts,
  splitPropertyBlocks,
  useConnectionsController,
} from '../features/editor/index.js';
import { MnOutliner } from './outliner.jsx';
import { EditorHeader } from './EditorHeader.jsx';
import { ContextualAssistance } from '../features/assistance/index.js';
import { MnContextualTip } from '../features/onboarding/index.js';
import { mkBlock, mnBlocksToMd, mnWalk } from './outline.jsx';
import { mnGetTagBg, mnGetTagColor, mnIconButtonStyle } from '../shared/theme.jsx';
import MN_EDITOR_SEARCH from './searchNavigation.js';

const { useState: useStateE, useMemo: useMemoE, useRef: useRefE, useEffect: useEffectE } = React;
const mnEditorSplitPropertyBlocks = splitPropertyBlocks;
const mnEditorPropertyParts = propertyParts;
const mnEditorCleanPropertyKey = cleanPropertyKey;
const mnEditorCreatePropertyBlock = (key, value) => createPropertyBlock(key, value, mkBlock);

function MnEditor({
  note, notes, tags, links, vaultId,
  searchQuery = '',
  connectionsRefreshToken = 0,
  memoryEnabled = false,
  aiEnabled = false,
  canvases = [], onOpenCanvas, onCreateCanvas,
  onOpen, onCreateLinkedNote, onOpenTag, onLinkMention, onAcceptSuggestedConnection, onIgnoreSuggestedConnection,
  onBlocksChange, onTitleChange, onAddTag, onCreateTag, onRemoveTag,
  onEndNoteMetadataEdit, onUndoNoteEdit, onRedoNoteEdit,
  onPinToggle, onDuplicate, onDelete, onOpenVersions, onExport, onOpenGraph, onOpenCalendar, onBack,
  referencePaneOpen = false, onToggleReferencePane,
  onToggleSidebar, sidebarHidden,
  onToggleNoteList, noteListHidden,
  editorWidth = 'medium', fontSize = 'default',
  indentGuides = true, spellCheck = true, autoLink = true, collapseByDefault = false,
  novelistPath = null, novelistMode = false,
  workflowStates = [], workflowStatus = '', onSetWorkflowStatus,
  saveStatus = 'Saved',
  contextualTip = null, onDismissContextualTip,
  onCreateAssistanceOutput,
  theme, T,
}) {
  const { connectionsRail } = useResponsiveLayout();
  const [showTags, setShowTags] = useStateE(false);
  const [tagDraft, setTagDraft] = useStateE('');
  const tagButtonRef = useRefE(null);
  const [zoomBlockId, setZoomBlockId] = useStateE(null);
  const [metadataOpen, setMetadataOpen] = useStateE(false);
  const [connectionsOpen, setConnectionsOpen] = useStateE(false);
  // The rail is permanent by default but must be dismissible — it takes 292px
  // from the prose column, and not every note is about its links.
  const [railHidden, setRailHidden] = useStateE(false);
  const [toast, setToast] = useStateE(null);
  const toastTimerRef = useRefE(null);
  const editorSearchScopeRef = useRefE(null);
  const connectionsRef = useRefE(null);
  const [searchMatch, setSearchMatch] = useStateE({ count: 0, activeIndex: 0 });
  const propertySplit = useMemoE(
    () => mnEditorSplitPropertyBlocks(note.blocks || []),
    [note.blocks]
  );
  const metadataProperties = propertySplit.properties || [];
  const contentBlocks = propertySplit.contentBlocks || [];
  const hasStatusProperty = metadataProperties.some(prop => String(prop.key || '').toLowerCase() === 'status');
  const workflowStatusEnabled = workflowStates.length > 0 && typeof onSetWorkflowStatus === 'function';
  const visibleMetadataProperties = metadataProperties.filter(prop => (
    !workflowStatusEnabled || String(prop.key || '').toLowerCase() !== 'status'
  ));
  const hasStatusRow = workflowStatusEnabled && hasStatusProperty;
  const [addingProperty, setAddingProperty] = useStateE(false);
  const [propertyKeyDraft, setPropertyKeyDraft] = useStateE('');
  const [propertyValueDraft, setPropertyValueDraft] = useStateE('');

  // Reset zoom when note changes
  useEffectE(() => { setZoomBlockId(null); }, [note.id]);
  useEffectE(() => {
    setMetadataOpen(false);
    setConnectionsOpen(false);
    setAddingProperty(false);
    setPropertyKeyDraft('');
    setPropertyValueDraft('');
  }, [note.id]);
  useEffectE(() => { setSearchMatch({ count: 0, activeIndex: 0 }); }, [note.id, searchQuery]);

  useEffectE(() => {
    const search = MN_EDITOR_SEARCH;
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

  const {
    backlinks,
    mentions,
    linkMention,
    related,
    suggestedConnections,
    passiveRelatedItems,
    ignoreSuggestedConnection,
    acceptSuggestedConnection,
    connected,
  } = useConnectionsController({
    note,
    notes,
    links,
    vaultId,
    memoryEnabled,
    connectionsRefreshToken,
    blocksToMarkdown: mnBlocksToMd,
    onLinkMention,
    onAcceptSuggestedConnection,
    onIgnoreSuggestedConnection,
  });

  // Word count from blocks
  const wordCount = useMemoE(() => {
    let count = 0;
    mnWalk(contentBlocks || [], (b) => {
      count += b.content.split(/\s+/).filter(Boolean).length;
    });
    return count;
  }, [contentBlocks]);
  const connectionCount = suggestedConnections.length
    + backlinks.length
    + mentions.length
    + passiveRelatedItems.length
    + connected.items.length;
  const metadataPropertyCount = visibleMetadataProperties.length + (hasStatusRow ? 1 : 0);

  const connectionsProps = {
    suggestedConnections, backlinks, mentions, passiveRelatedItems, connected, related,
    onOpen, onLinkMention, linkMention, note,
    acceptSuggestedConnection, ignoreSuggestedConnection, T,
  };

  const revealConnections = () => {
    if (connectionsRail) {
      // In rail mode the control is a toggle: the panel is already on screen,
      // so "show connections" can only sensibly mean "hide them again".
      setRailHidden(hidden => !hidden);
      return;
    }
    setConnectionsOpen(true);
    requestAnimationFrame(() => connectionsRef.current?.scrollIntoView?.({ block: 'start', behavior: 'smooth' }));
  };

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
    if (lowerKey === 'status' && workflowStatusEnabled) {
      onSetWorkflowStatus(null);
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
    if (cleanKey === 'status' && workflowStatusEnabled) {
      onSetWorkflowStatus(cleanValue || null);
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

  const toggleMetadata = () => {
    if (metadataOpen) {
      setMetadataOpen(false);
      setAddingProperty(false);
      setPropertyKeyDraft('');
      setPropertyValueDraft('');
      return;
    }
    setMetadataOpen(true);
    if (!metadataPropertyCount) setAddingProperty(true);
  };

  const createAndApplyTag = () => {
    const raw = tagDraft.trim();
    if (!raw) return;
    if (onCreateTag) onCreateTag(raw);
    setTagDraft('');
    setShowTags(false);
    tagButtonRef.current?.focus?.();
  };

  return (
    <div style={{
      flex: 1, height: '100%',
      background: `
        linear-gradient(180deg, ${T.bgElevated || T.bg} 0%, ${T.bg} 24%, ${T.bg} 100%)`,
      display: 'flex', flexDirection: 'column', position: 'relative',
      minWidth: 0,
    }}>
      <EditorHeader
        T={T}
        note={note}
        saveStatus={saveStatus}
        wordCount={wordCount}
        connectionCount={connectionCount}
        novelistPath={novelistPath}
        onOpen={onOpen}
        onBack={onBack}
        sidebarHidden={sidebarHidden}
        noteListHidden={noteListHidden}
        onToggleSidebar={onToggleSidebar}
        onToggleNoteList={onToggleNoteList}
        onPinToggle={onPinToggle}
        onScrollToConnections={revealConnections}
        connectionsRailOpen={connectionsRail && !railHidden && connectionCount > 0}
        onDuplicate={onDuplicate}
        onOpenVersions={onOpenVersions}
        onExport={onExport}
        referencePaneOpen={referencePaneOpen}
        onToggleReferencePane={onToggleReferencePane}
        onOpenGraph={onOpenGraph}
        onOpenCalendar={onOpenCalendar}
        onDelete={onDelete}
        assistanceControl={(
          <ContextualAssistance
            enabled={aiEnabled}
            note={note}
            sourceMarkdown={mnBlocksToMd(note.blocks || [])}
            vaultId={vaultId}
            onCreateOutput={onCreateAssistanceOutput}
            T={T}
          />
        )}
      />

      <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
      {/* Frame 1b draws 34px above the title and a 40px gutter. The gutter
          only shrinks below the design width, never grows past it. */}
      <div style={{
        flex: 1, minWidth: 0, overflow: 'auto',
        padding: `34px clamp(20px, 3vw, ${DS_PANE.editorGutter}px) 44px`,
      }}>
        <div ref={editorSearchScopeRef} style={{
          // The default caps at the design system's prose measure; wider
          // settings stay available as deliberate overrides.
          maxWidth: editorWidth === 'narrow' ? 560
                  : editorWidth === 'wide' ? 1280
                  : editorWidth === 'full' ? 'none'
                  : DS_PANE.editorColumn,
          margin: '0 auto',
          fontSize: fontSize === 'small' ? '13px' : fontSize === 'large' ? '16px' : '14.5px',
        }}>
          <MnContextualTip tip={contextualTip} onDismiss={onDismissContextualTip} T={T} />
          <input
            className="mn-note-title-input"
            aria-label="Note title"
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
              <button type="button" key={t} onClick={() => onRemoveTag(t)} aria-label={`Remove tag ${t}`} style={{
                // A tag is a pill with its own colour; the dot inherits it, so
                // the hash is redundant.
                display: 'inline-flex', alignItems: 'center', gap: 6,
                height: 24, padding: '0 9px', borderRadius: DS_RADIUS.pill,
                fontFamily: 'var(--mn-ui)', fontSize: 11.5, fontWeight: 500,
                color: mnGetTagColor(tagHue[t] ?? 240, theme),
                background: mnGetTagBg(tagHue[t] ?? 240, theme),
                border: 'none', cursor: 'pointer',
              }} title={`Remove tag ${t}`}>
                <span aria-hidden="true" style={{
                  width: 5, height: 5, borderRadius: '50%', background: 'currentColor',
                }} />
                {t}
              </button>
            ))}
            <div style={{ position: 'relative' }}>
              <button ref={tagButtonRef} type="button" aria-haspopup="dialog" aria-expanded={showTags} onClick={() => setShowTags(v => !v)} style={{
                height: 24, padding: '0 9px', borderRadius: DS_RADIUS.pill,
                fontFamily: 'var(--mn-ui)', fontSize: 11.5, color: T.inkDim,
                background: 'transparent', border: `1px dashed ${T.line}`,
                cursor: 'pointer',
              }}>+ Tag</button>
              {showTags && (
                <div role="dialog" aria-label="Add tag" style={{
                  position: 'absolute', top: '100%', left: 0, marginTop: 4,
                  background: T.bg, border: `1px solid ${T.line}`,
                  borderRadius: 6, padding: 4, zIndex: 10, minWidth: 180,
                  boxShadow: `0 8px 24px color-mix(in oklab, ${T.ink} 12%, transparent)`,
                }}>
                  <div style={{ display: 'flex', gap: 4, padding: 4 }}>
                    <input
                      autoFocus
                      aria-label="New tag name"
                      value={tagDraft}
                      onChange={(e) => setTagDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') { e.preventDefault(); createAndApplyTag(); }
                        if (e.key === 'Escape') {
                          e.preventDefault();
                          setShowTags(false);
                          tagButtonRef.current?.focus?.();
                        }
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
                      type="button"
                      aria-label="Create tag"
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
                    <button type="button" key={t.name} onClick={() => {
                      onAddTag(t.name);
                      setShowTags(false);
                      tagButtonRef.current?.focus?.();
                    }}
                      style={{
                        width: '100%', minHeight: 32, padding: '5px 8px', borderRadius: 4, cursor: 'pointer',
                        fontFamily: 'var(--mn-ui)', fontSize: 12.5,
                        display: 'flex', alignItems: 'center', gap: 6,
                        border: 0, background: 'transparent', color: T.ink, textAlign: 'left',
                      }}
                      onMouseEnter={e => e.currentTarget.style.background = T.bgHover}
                      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                      <span style={{ width: 6, height: 6, borderRadius: '50%',
                        background: mnGetTagColor(t.hue, theme) }} />
                      {t.name}
                    </button>
                  ))}
                  {tags.filter(t => !note.tags.includes(t.name)).length === 0 && (
                    <div style={{ padding: '6px 8px', fontSize: 11.5, color: T.inkDim, fontStyle: 'italic' }}>all tags applied</div>
                  )}
                </div>
              )}
            </div>
            <button
              type="button"
              data-mn-properties-toggle="true"
              aria-controls="mn-properties-panel"
              aria-expanded={metadataOpen}
              aria-label={`${metadataOpen ? 'Hide' : 'Show'} note properties${metadataPropertyCount ? `, ${metadataPropertyCount}` : ''}`}
              onClick={toggleMetadata}
              style={{
                minHeight: 28, padding: '2px 8px', borderRadius: 5,
                border: `1px solid ${metadataOpen ? T.selLine : 'transparent'}`,
                background: metadataOpen ? T.accentSoft : 'transparent',
                color: metadataOpen ? T.accent : T.inkDim,
                cursor: 'pointer',
                fontFamily: 'var(--mn-ui)', fontSize: 10.5, fontWeight: 600,
              }}>
              {metadataPropertyCount ? `Properties ${metadataPropertyCount}` : 'Add property'}
            </button>
          </div>

          {metadataOpen && (
            <PropertiesPanel
              T={T}
              visibleProperties={visibleMetadataProperties}
              hasStatusRow={hasStatusRow}
              workflowStatus={workflowStatus}
              workflowStates={workflowStates}
              onSetWorkflowStatus={onSetWorkflowStatus}
              removeProperty={removeMetadataProperty}
              updateProperty={updateMetadataProperty}
              spellCheck={spellCheck}
              addingProperty={addingProperty}
              setAddingProperty={setAddingProperty}
              propertyKeyDraft={propertyKeyDraft}
              setPropertyKeyDraft={setPropertyKeyDraft}
              propertyValueDraft={propertyValueDraft}
              setPropertyValueDraft={setPropertyValueDraft}
              addProperty={addMetadataProperty}
              cleanPropertyKey={mnEditorCleanPropertyKey}
              onDismiss={() => setMetadataOpen(false)}
            />
          )}

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
            aiEnabled={aiEnabled}
            workflowEnabled={workflowStates.length > 0}
            T={T}
          />

          {/* Below the rail breakpoint connections fall back to the accordion
              under the note, so they are never simply unreachable. */}
          {(!connectionsRail || railHidden) && (
            <div ref={connectionsRef}>
              <ConnectionsSection {...connectionsProps} expanded={connectionsOpen} onExpandedChange={setConnectionsOpen} />
            </div>
          )}

        </div>
      </div>
        {connectionsRail && !railHidden && connectionCount > 0 && (
          <aside
            ref={connectionsRef}
            aria-label="Connections"
            style={{
              width: DS_PANE.connections, flexShrink: 0,
              borderLeft: `1px solid ${T.lineSub}`, background: T.bgSub,
              padding: '20px 16px', display: 'flex', flexDirection: 'column', gap: 18,
              overflow: 'hidden', boxSizing: 'border-box',
            }}>
            <ConnectionsSection {...connectionsProps} rail onOpenGraph={onOpenGraph} />
          </aside>
        )}
      </div>
      {toast && (
        <div style={{
          position: 'absolute', bottom: 22, left: '50%',
          transform: 'translateX(-50%)',
          display: 'flex', alignItems: 'center', gap: 10,
          height: 38, padding: '0 14px',
          background: T.ink, color: T.bg,
          borderRadius: DS_RADIUS.pill,
          fontFamily: 'var(--mn-ui)', fontSize: 12.5,
          boxShadow: `0 14px 30px color-mix(in oklab, ${T.ink} 30%, transparent)`,
          zIndex: 60,
          pointerEvents: 'none',
        }}>
          {/* A toast only ever reports something that already happened. */}
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: T.success, flexShrink: 0 }} />
          {toast}
        </div>
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
    ...(typeof mnIconButtonStyle === 'function' ? mnIconButtonStyle(T, active, 32) : {}),
    height: 32,
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

export { MnEditor };
