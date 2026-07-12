import MN_FEATURES from './featureRegistry.js';
import { ResponsiveListPane } from '../shared/layout/ResponsiveListPane.jsx';
import { shortcutLabel, useShortcutPlatform } from '../platform/shortcuts.js';

function AppView({ model }) {
  const { HAS_DISK, MN_APP_HELPERS, MN_APP_MUTATIONS, MnAiChatHistory, MnAiNotice, MnAppNoticeDialog, MnAskAI, MnCalendarPanel, MnCanvasPanel, MnCommandPalette, MnDeleteNoteDialog, MnEditor, MnGraph, MnLaunchScreen, MnNoteList, MnNovelImportPreviewDialog, MnNovelistPanel, MnPanelGrip, MnPanelGripPeek, MnQuickCapture, MnQuickSwitcher, MnRecentlyDeletedPanel, MnReferencePane, MnReminderCenter, MnReminderToast, MnSaveConflictDialog, MnSettingsModal, MnSidebar, MnSmartViewsPanel, MnTodayPanel, MnTodosPanel, MnVaultHealthDialog, MnVersionHistoryDialog, MnWorkflowPanel, SEED_NOTES, SEED_TAGS, SEED_VAULTS, T, acceptSuggestedConnection, activeAskAiSession, activeCanvas, activeSmartViewId, activeVault, activeVaultId, addNoteToCanvas, addQuickTodayTask, addTag, addTodayEndDayRecap, addTodayReflection, aiChatListVisible, aiNoteBodyRestoreRef, aiNotice, analyzeNovelImportFiles, appActionRegistry, appNotice, appStats, appendToTodayDailyNote, applyAiCurrentPageBody, applyLinkedNoteUpdates, applyNovelImportPreview, applyWorkflowStates, archiveAskAiChat, askAiSeed, askAiSessions, assistanceEnabled, baseThemeMap, blockingOverlayOpen, bootError, bootState, buildLinks, calendarActionItems, calendarTaskItems, canvasTextEditing, canvases, captureOpen, cloneNoteForMetadataHistory, closeNovelImportDialog, closeReferencePane, commandPaletteOpen, commands, conflictNotice, connectionsRefreshToken, convertNovelistType, createAskAiChat, createCalendarTaskItem, createCanvas, createDailyNote, createNote, createNoteFromTemplate, createRuntimeNoteId, createVault, customThemes, deleteAskAiChat, deleteCanvas, deleteNote, deleteTargetId, deleteTargetNote, deleteVault, dirtyMissingWarnedRef, dirtyNotes, dirtyNotesRef, dirtyRevisionRef, dismissedReminderKeys, duplicateNote, enabledPacks, endNoteMetadataEdit, exportBackup, featureState, filteredNotes, findNotesForVault, fontMap, fonts, generateTodayAiRecap, goBackView, graphFilter, graphVisibleNotes, handleAppActionResult, importBackup, importNovelFiles, importThemeFile, keepConflictAsDuplicate, linkNovelistChapter, linkNovelistScene, links, listDeletedItems, loadVaultBundle, markDirty, markTagsDirty, mkBlock, mnBlocksToMd, mnBodyPropertyValue, mnCloneBlocks, mnLocate, mnMdToBlocks, mnNormalizeNoteBody, mnNormalizeNoteStatus, mnShadow, mnWalk, mnWriteSnoozedReminder, navigateView, nextStoryOrder, normalWorkflowStates, normalizeFeaturePacks, normalizeRuntimeNote, noteDiskStampRef, noteListHidden, noteListSubtitle, noteListTitle, noteListVisible, noteMetadataHistoryRef, notes, notesRef, notesWithBody, notesWithBodyCacheRef, notesWithBodyRef, notifyAskAiComplete, novelImportDialog, novelImportSeq, novelistNotes, novelistStructure, novelistWorkflowStates, openAskAi, openCanvas, openCanvasDashboard, openNoteById, openReferencePane, openSmartView, overlayNoteList, pendingDirtyKeysRef, persistNovelistSetup, plugins, prependDeletedItem, promptNewTag, purgeDeletedNote, query, quickCaptureAppendBody, quickCaptureMergeTags, quickCaptureRawMarkdown, quickSwitcherOpen, quietedReminderKeys, rebuildIndex, recentNoteIds, recordFeatureUsage, recordNoteMetadataHistory, recordPhase5Metric, redoNoteMetadataEdit, referenceNote, referenceNoteId, referencePaneOpen, refreshDeletedItems, refreshVaultRegistry, reloadConflictFromDisk, reminderCenterItems, reminderCenterOpen, reminderCenterTop, reminderDueCount, removeNovelistSupportingType, removeTag, renameAskAiChat, renameNoteTitle, renameVault, requestDeleteNote, restoreAiCurrentPageBody, restoreDeletedNote, restoreNoteMetadataSnapshot, restoreNoteVersion, runNaturalCommand, runPlugin, saveCanvas, saveDirtyNotesNow, saveQuickCapture, saveVaultMetaNow, savedSmartViews, savingDirtyKeysRef, searchUsageActiveRef, selectReferenceNote, selectVault, selectedId, selectedNote, selectedTag, selectedWorkflow, setActiveAskAiSession, setActiveAskAiSessionId, setActiveCanvas, setActiveSmartViewId, setActiveVaultId, setActiveVaultNovelistMode, setAiNotice, setAppNotice, setAssistanceEnabled, setCanvasTextEditing, setCanvases, setCaptureOpen, setCommandPaletteOpen, setConflictNotice, setConnectionsRefreshToken, setCustomThemes, setDeleteTargetId, setDirtyNotes, setEnabledPacks, setGraphFilter, setNoteListHidden, setNotes, setNovelImportDialog, setNovelistOrder, setPackEnabled, setQuery, setQuickSwitcherOpen, setRecentNoteIds, setReferenceNoteListVisible, setReminderCenterOpen, setSavedSmartViews, setSelectedId, setSelectedTag, setSelectedWorkflow, setSettingsOpen, setSidebarHidden, setTags, setToast, setTweak, setTweaks, setVaultHealthOpen, setVaults, setVersionTargetId, setView, settingsOpen, showAppNotice, sidebarHidden, smartViewDefinitions, snoozeCalendarTaskItem, tagCurrentNoteFromAi, tags, tagsDirty, theme, themeMap, themeOptions, titleUpdateTimerRef, toast, toastRef, todayAgendaItems, todayAiContext, todayAiRecap, todayAiRecapBusy, todayAiRecapError, todayDailyNote, todayDigest, toggleCheckFromAggregate, trashError, trashItems, trashLoading, tweakInitialized, tweaks, undoNoteMetadataEdit, uniqueNoteTitle, updateDirtyNotes, updateNote, updateNoteBlocks, updateNoteBodies, updateNoteBody, updateNoteTags, updateNovelistAiConfig, updateTaskItemSource, updateWorkflowArchived, updateWorkflowNoteStatus, updateWorkflowStates, vaultActivationSeq, vaultHealthOpen, vaults, vaultsForSidebar, vaultsRef, versionTargetId, view, workflowData, workflowStates, workflowViewData } = model;
    const shortcutPlatform = useShortcutPlatform();
    const listPaneLeft = sidebarHidden ? 0 : (tweaks.density === 'compact' ? 221 : 261);
    const compactEditorOwnsNoteListTrigger = overlayNoteList
      && (view === 'notes' || view === 'pinned')
      && !!selectedNote;
    const selectedNoteIsDirty = HAS_DISK && selectedNote && [...dirtyNotes.values()].some(entry => (
      entry?.vaultId === activeVaultId && entry?.id === selectedNote.id
    ));
    const editorSaveStatus = selectedNote && conflictNotice?.vaultId === activeVaultId && conflictNotice?.noteId === selectedNote.id
      ? 'Conflict'
      : selectedNoteIsDirty ? 'Saving' : 'Saved';
    if (bootState !== 'ready') {
      return <MnLaunchScreen state={bootState} error={bootError} T={T} />;
    }
  
    return (
      <div data-mn-layout={overlayNoteList ? 'compact' : 'three-pane'} style={{
        width: '100vw',
        height: '100vh',
        background: `
          radial-gradient(circle at 18% 12%, color-mix(in oklab, ${T.accent} 12%, transparent), transparent 26%),
          radial-gradient(circle at 92% 8%, color-mix(in oklab, ${T.success || T.accent} 10%, transparent), transparent 24%),
          ${T.bgOuter || T.bg}`,
        position: 'relative',
        fontFamily: 'var(--mn-ui)', overflow: 'hidden',
        fontSize: 'var(--mn-app-font-size)',
        padding: 0,
      }}>
          <div style={{
            display: 'flex',
            height: '100%',
            minWidth: 0,
            overflow: 'hidden',
            border: `1px solid ${T.line}`,
            borderRadius: 0,
            background: T.bg,
            boxShadow: typeof mnShadow === 'function'
              ? mnShadow(T, 'elevated')
              : `0 18px 46px color-mix(in oklab, ${T.ink} 18%, transparent)`,
          }}>
            {!sidebarHidden && (
              <MnSidebar
                tags={tags} notes={notesWithBody}
                selectedTag={selectedTag}
                selectedWorkflow={selectedWorkflow}
                workflowStates={workflowStates}
                workflowCounts={workflowData.counts}
                workflowTotal={workflowData.total}
                onSelectTag={(t) => { setSelectedTag(t); setSelectedWorkflow(null); navigateView('notes'); if (overlayNoteList) setNoteListHidden(false); }}
                onSelectWorkflow={(wf) => { setSelectedWorkflow(wf); setSelectedTag(null); navigateView('notes'); if (overlayNoteList) setNoteListHidden(false); }}
                onOpenWorkflowPanel={() => { navigateView('workflow'); setSelectedTag(null); setSelectedWorkflow(null); if (overlayNoteList) setNoteListHidden(false); }}
                onOpenNovelist={() => { navigateView('novelist'); setSelectedTag(null); setSelectedWorkflow(null); setQuery(''); }}
                onOpenAgenda={() => { navigateView('calendar'); setSelectedTag(null); setSelectedWorkflow(null); }}
                onOpenToday={() => { navigateView('today'); setSelectedTag(null); setSelectedWorkflow(null); }}
                onOpenPinned={() => { navigateView('pinned'); setSelectedTag(null); setSelectedWorkflow(null); setQuery(''); if (overlayNoteList) setNoteListHidden(false); }}
                onOpenSmartViews={() => openSmartView()}
                onOpenGraph={() => { navigateView('graph'); setSelectedTag(null); setSelectedWorkflow(null); }}
                onOpenCanvas={openCanvasDashboard}
                onOpenTrash={() => { navigateView('trash'); setSelectedTag(null); setSelectedWorkflow(null); }}
                onOpenAskAI={HAS_DISK ? openAskAi : null}
                todayActive={view === 'today'}
                pinnedActive={view === 'pinned'}
                agendaActive={view === 'calendar'}
                graphActive={view === 'graph'}
                smartViewsActive={view === 'smart-views'}
                smartViewCount={smartViewDefinitions.length}
                workflowActive={view === 'workflow'}
                novelistActive={view === 'novelist'}
                novelistEnabled={!!activeVault?.novelistMode}
                novelistCount={novelistNotes.length}
                canvasActive={view === 'canvas'}
                canvasCount={canvases.length}
                trashActive={view === 'trash'}
                trashCount={trashItems.length}
                calendarActive={view === 'calendar'}
                aiActive={view === 'ai'}
                onNewTag={promptNewTag}
                onDeleteTag={removeTag}
                onNew={() => { createNote(); if (overlayNoteList) setNoteListHidden(true); }}
                onOpenSettings={() => setSettingsOpen(true)}
                onCollapse={() => setSidebarHidden(true)}
                vaults={vaultsForSidebar}
                activeVaultId={activeVaultId}
                onSelectVault={selectVault}
                onCreateVault={createVault}
                onRefreshVaults={refreshVaultRegistry}
                onRenameVault={renameVault}
                onDeleteVault={deleteVault}
                featureState={featureState}
                newNoteShortcut={shortcutLabel('newNote', shortcutPlatform, { compact: true })}
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
              <ResponsiveListPane
                overlay={overlayNoteList}
                left={listPaneLeft}
                label="Note list"
                returnFocusLabel="Show note list"
                onDismiss={() => setNoteListHidden(true)}
                T={T}>
                <MnNoteList
                  notes={filteredNotes}
                  selectedId={selectedId}
                  onSelect={(id) => {
                    setSelectedId(id);
                    if (overlayNoteList) setNoteListHidden(true);
                    if (view !== 'notes' && view !== 'pinned') navigateView('notes');
                  }}
                  title={noteListTitle}
                  subtitle={noteListSubtitle}
                  query={query}
                  onQueryChange={setQuery}
                  novelistStructure={activeVault?.novelistMode && view === 'notes' && !query.trim() && !selectedTag && !selectedWorkflow ? novelistStructure : null}
                  allNotes={notesWithBody}
                  onRenameNote={renameNoteTitle}
                  onDuplicateNote={duplicateNote}
                  onDeleteNote={requestDeleteNote}
                  onAddToCanvas={featureState.showCanvas ? async (id) => handleAppActionResult(await addNoteToCanvas(id)) : null}
                  onOpenReference={openReferencePane}
                  tags={tags} theme={theme} density={tweaks.density} T={T}
                />
                <MnPanelGrip side="notelist" onCollapse={() => setNoteListHidden(true)} T={T} />
              </ResponsiveListPane>
            )}
            {noteListVisible && noteListHidden && !compactEditorOwnsNoteListTrigger && (
              <MnPanelGripPeek onExpand={() => setNoteListHidden(false)} T={T} title="Show note list" />
            )}
  
            {aiChatListVisible && !noteListHidden && (
              <ResponsiveListPane
                overlay={overlayNoteList}
                left={listPaneLeft}
                label="AI chat list"
                returnFocusLabel="Show AI chats"
                onDismiss={() => setNoteListHidden(true)}
                T={T}>
                <MnAiChatHistory
                  sessions={askAiSessions}
                  activeId={activeAskAiSession?.id || ''}
                  onSelect={(id) => { setActiveAskAiSessionId(id); if (overlayNoteList) setNoteListHidden(true); }}
                  onNew={createAskAiChat}
                  onDelete={deleteAskAiChat}
                  onArchive={archiveAskAiChat}
                  onRename={renameAskAiChat}
                  T={T}
                />
                <MnPanelGrip side="notelist" onCollapse={() => setNoteListHidden(true)} T={T} />
              </ResponsiveListPane>
            )}
            {aiChatListVisible && noteListHidden && (
              <MnPanelGripPeek onExpand={() => setNoteListHidden(false)} T={T} title="Show AI chats" />
            )}
  
            {(view === 'notes' || view === 'pinned') && selectedNote && (
              <MnEditor
                note={selectedNote} notes={notesWithBody} tags={tags} links={links}
                vaultId={activeVaultId}
                searchQuery={query}
                connectionsRefreshToken={connectionsRefreshToken}
                memoryEnabled={featureState.showAgents && HAS_DISK && plugins.some(plugin => plugin.enabled !== false && plugin.type === 'llm-memory')}
                canvases={featureState.showCanvas ? canvases : []}
                onOpenCanvas={featureState.showCanvas ? openCanvas : null}
                onCreateCanvas={featureState.showCanvas ? createCanvas : null}
                aiEnabled={featureState.showAskAi}
                onOpen={(id) => { setSelectedId(id); navigateView('notes'); }}
                onLinkMention={(mentionNoteId) => {
                  const title = String(selectedNote?.title || '').trim();
                  const target = notesWithBody.find(n => n.id === mentionNoteId);
                  if (!title || !target || !MN_APP_MUTATIONS.linkMentionInBody) return false;
                  const currentBody = mnNormalizeNoteBody(mnBlocksToMd(target.blocks || []), target.title || 'Untitled');
                  const { body, linked } = MN_APP_MUTATIONS.linkMentionInBody(currentBody, title);
                  if (!linked) return false;
                  setNotes(ns => ns.map(n => n.id === mentionNoteId
                    ? MN_APP_MUTATIONS.applyNoteBodyUpdate(n, body, {
                        normalizeNoteBody: mnNormalizeNoteBody,
                        blocksToMd: mnBlocksToMd,
                        mdToBlocks: mnMdToBlocks,
                      })
                    : n));
                  markDirty(mentionNoteId);
                  return true;
                }}
                onAcceptSuggestedConnection={acceptSuggestedConnection}
                onIgnoreSuggestedConnection={() => recordFeatureUsage('connections', 'used')}
                onCreateLinkedNote={(title) => {
                  const cleanTitle = String(title || '').trim();
                  if (!cleanTitle) return null;
                  if (!featureState.showWriter) return createNote({ title: cleanTitle, body: '', tags: [] });
                  const selectedStage = novelistStructure.stageByNoteId?.[selectedNote.id];
                  if (selectedStage === 'act') {
                    return createNote({
                      title: cleanTitle,
                      body: `status:: OUTLINE\norder:: ${nextStoryOrder('chapter', selectedNote.id)}\nact:: [[${selectedNote.title}]]\n## Scenes\n- Goal\n- Scene list\n- Revision notes`,
                      tags: ['novel-chapter'],
                    });
                  }
                  if (selectedStage === 'chapter') {
                    const act = notesWithBody.find(n => n.id === novelistStructure.parentByChapterId?.[selectedNote.id]);
                    return createNote({
                      title: cleanTitle,
                      body: `status:: DRAFT\norder:: ${nextStoryOrder('scene', selectedNote.id)}\n${act ? `act:: [[${act.title}]]\n` : ''}chapter:: [[${selectedNote.title}]]\npov:: \nsetting:: \npurpose:: \nDraft the scene here.`,
                      tags: ['novel-scene'],
                    });
                  }
                  const lowerTitle = cleanTitle.toLowerCase();
                  const inferredTags = lowerTitle.includes('scene')
                    ? ['novel-scene']
                    : lowerTitle.includes('chapter')
                    ? ['novel-chapter']
                    : lowerTitle.includes('act')
                    ? ['novel-act']
                    : [];
                  return createNote({ title: cleanTitle, body: '', tags: inferredTags });
                }}
                onOpenTag={(t) => {
                  if (!tags.find(x => x.name === t)) addTag(t);
                  setSelectedTag(t); setSelectedWorkflow(null); navigateView('notes');
                }}
                onBlocksChange={(blocks) => updateNoteBlocks(selectedNote.id, blocks)}
                onTitleChange={(title) => updateNote(selectedNote.id, { title }, { historyKey: `note:${selectedNote.id}:title` })}
                onEndNoteMetadataEdit={endNoteMetadataEdit}
                onUndoNoteEdit={() => undoNoteMetadataEdit(selectedNote.id)}
                onRedoNoteEdit={() => redoNoteMetadataEdit(selectedNote.id)}
                onAddTag={(t) => updateNote(selectedNote.id, { tags: [...selectedNote.tags, t] }, { historyKey: `note:${selectedNote.id}:tag:${t}:add` })}
                onCreateTag={(raw) => {
                  const name = addTag(raw);
                  if (name && !selectedNote.tags.includes(name)) {
                    updateNote(selectedNote.id, { tags: [...selectedNote.tags, name] }, { historyKey: `note:${selectedNote.id}:tag:${name}:create` });
                  }
                }}
                onRemoveTag={(t) => updateNote(selectedNote.id, { tags: selectedNote.tags.filter(x => x !== t) }, { historyKey: `note:${selectedNote.id}:tag:${t}:remove` })}
                onPinToggle={() => updateNote(selectedNote.id, { pinned: !selectedNote.pinned }, { historyKey: `note:${selectedNote.id}:pin:${selectedNote.pinned ? 'off' : 'on'}` })}
                onDuplicate={() => duplicateNote(selectedNote.id)}
                onDelete={() => requestDeleteNote(selectedNote.id)}
                onOpenVersions={HAS_DISK ? () => setVersionTargetId(selectedNote.id) : null}
                onExport={HAS_DISK ? async (format) => {
                  try {
                    const result = await appActionRegistry.run(`export-note-${format}`, {}, { confirmed: true });
                    handleAppActionResult(result);
                  } catch (error) {
                    showAppNotice('Export failed', error.message || String(error), 'warn');
                  }
                } : null}
                referencePaneOpen={referencePaneOpen}
                onToggleReferencePane={() => referencePaneOpen ? closeReferencePane() : openReferencePane()}
                onOpenGraph={featureState.showLabs ? () => { navigateView('graph'); setSelectedTag(null); setSelectedWorkflow(null); } : null}
                onOpenCalendar={featureState.showAgenda ? () => { navigateView('calendar'); setSelectedTag(null); setSelectedWorkflow(null); } : null}
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
                novelistPath={featureState.showWriter && activeVault?.novelistMode ? novelistStructure.pathByNoteId?.[selectedNote.id] : null}
                novelistMode={featureState.showWriter && !!activeVault?.novelistMode}
                workflowStates={featureState.showWorkflow ? workflowStates : []}
                workflowStatus={mnNormalizeNoteStatus(
                  mnBodyPropertyValue(notesWithBody.find(n => n.id === selectedNote.id)?.body || '', 'status'),
                  featureState.showWorkflow ? workflowStates : []
                )}
                onSetWorkflowStatus={featureState.showWorkflow ? (status) => updateWorkflowNoteStatus(selectedNote.id, null, status) : null}
                saveStatus={editorSaveStatus}
                theme={theme} T={T}
              />
            )}
  
            {(view === 'notes' || view === 'pinned') && referencePaneOpen && (
              <MnReferencePane
                note={referenceNote}
                notes={notesWithBody}
                onSelect={selectReferenceNote}
                onOpenAsMain={(id) => { setSelectedId(id); navigateView('notes'); }}
                onOpenLink={(label) => {
                  const cleanTitle = String(label || '').split('|')[0].split('#')[0].trim().toLowerCase();
                  const target = notesWithBody.find(note => String(note.title || '').trim().toLowerCase() === cleanTitle);
                  if (target) selectReferenceNote(target.id);
                }}
                onClose={closeReferencePane}
                T={T}
              />
            )}
  
            {featureState.showAskAi && view === 'ai' && activeAskAiSession && (
              <MnAskAI
                vaultId={activeVaultId}
                currentNote={selectedNote ? {
                  ...selectedNote,
                  body: mnNormalizeNoteBody(mnBlocksToMd(selectedNote.blocks || []), selectedNote.title || 'Untitled'),
                } : null}
                allNotes={notesWithBody}
                initialQuery={askAiSeed}
                onClose={goBackView}
                onOpenNote={openNoteById}
                onCreateNote={({ title, body, tags: noteTags }) => createNote({ title, body, tags: noteTags || [] }, { open: false })}
                onTagCurrentNote={tagCurrentNoteFromAi}
                onApplyCurrentPageBody={(body, options) => {
                  if (!selectedNote) return { ok: false, error: 'No selected note.' };
                  return applyAiCurrentPageBody(selectedNote.id, body, options);
                }}
                onRestoreCurrentPageBody={restoreAiCurrentPageBody}
                onOpenCurrentNoteVersions={(noteId) => setVersionTargetId(noteId || selectedNote?.id || null)}
                onApplyNoteBodies={updateNoteBodies}
                session={activeAskAiSession}
                setSession={setActiveAskAiSession}
                onBackgroundComplete={notifyAskAiComplete}
                embedded
                T={T} />
            )}
  
            {featureState.showAskAi && view === 'ai' && !activeAskAiSession && (
              <div style={{
                flex: 1,
                minWidth: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: 32,
                color: T.inkMed,
              }}>
                <div style={{ textAlign: 'center', maxWidth: 320 }}>
                  <div style={{ fontSize: 15, fontWeight: 700, color: T.ink, marginBottom: 8 }}>No AI chats</div>
                  <div style={{ fontSize: 12.5, lineHeight: 1.45, color: T.inkDim, marginBottom: 14 }}>
                    Start a new chat when you need note-aware help.
                  </div>
                  <button onClick={createAskAiChat} style={{
                    border: `1px solid ${T.line}`,
                    borderRadius: 7,
                    background: T.ink,
                    color: T.bg,
                    padding: '7px 12px',
                    fontFamily: 'var(--mn-ui)',
                    fontSize: 12.5,
                    fontWeight: 650,
                    cursor: 'pointer',
                  }}>New chat</button>
                </div>
              </div>
            )}
  
            {featureState.showLabs && view === 'graph' && (
              <MnGraph
                notes={graphVisibleNotes} links={links} tags={tags}
                focusId={selectedId}
                style={tweaks.graphStyle}
                graphFilter={activeVault?.novelistMode ? graphFilter : null}
                onGraphFilterChange={setGraphFilter}
                onOpen={(id) => { setSelectedId(id); navigateView('notes'); }}
                T={T}
              />
            )}
  
            {featureState.showAgenda && view === 'todos' && (
              <MnTodosPanel
                notes={notesWithBody} tags={tags}
                onOpen={(id) => { setSelectedId(id); navigateView('notes'); }}
                onToggleCheck={toggleCheckFromAggregate}
                T={T} theme={theme} variant={tweaks.todoVariant}
              />
            )}
            {featureState.showAgenda && view === 'calendar' && (
              <MnCalendarPanel
                notes={notesWithBody}
                tags={tags}
                items={calendarActionItems}
                selectedNoteId={selectedId || ''}
                weekStart={tweaks.weekStart || 'monday'}
                snoozeMinutes={tweaks.snoozeMinutes || '15'}
                onOpen={(id) => { setSelectedId(id); navigateView('notes'); }}
                onCreateItem={createCalendarTaskItem}
                onUpdateItem={updateTaskItemSource}
                onToggleCheck={toggleCheckFromAggregate}
                onSnoozeItem={snoozeCalendarTaskItem}
                T={T}
                theme={theme}
              />
            )}
            {featureState.showLabs && view === 'smart-views' && (
              <MnSmartViewsPanel
                notes={notesWithBody}
                tags={tags}
                definitions={smartViewDefinitions}
                activeDefinitionId={activeSmartViewId}
                onActiveDefinitionChange={setActiveSmartViewId}
                onOpen={(id) => { setSelectedId(id); navigateView('notes'); }}
                onOpenAllNotes={() => { setSelectedTag(null); setSelectedWorkflow(null); setQuery(''); navigateView('notes'); }}
                T={T}
                theme={theme}
              />
            )}
            {featureState.showWorkflow && view === 'workflow' && (
              <MnWorkflowPanel
                notes={notesWithBody}
                tags={tags}
                workflowStates={workflowStates}
                workflowItems={workflowViewData.byState}
                archivedNotes={workflowViewData.archivedNotes}
                onWorkflowStatesChange={updateWorkflowStates}
                onOpen={(id) => { setSelectedId(id); navigateView('notes'); }}
                onSetWorkflow={updateWorkflowNoteStatus}
                onSetWorkflowArchived={updateWorkflowArchived}
                onSetNoteTags={updateNoteTags}
                T={T} theme={theme}
              />
            )}
            {featureState.showWriter && view === 'novelist' && !!activeVault?.novelistMode && (
              <MnNovelistPanel
                notes={notesWithBody}
                novelistNotes={novelistNotes}
                tags={tags}
                vaultId={activeVaultId}
                workflowStates={workflowStates}
                workflowItems={workflowViewData.byState}
                novelistStructure={novelistStructure}
                onOpen={(id) => { setSelectedId(id); navigateView('notes'); }}
                onCreateNote={({ title, body, tags: noteTags }) => createNote({ title, body, tags: noteTags || [] }, { open: false })}
                onLinkChapter={linkNovelistChapter}
                onLinkScene={linkNovelistScene}
                onSetOrder={setNovelistOrder}
                onRenameNote={renameNoteTitle}
                onConvertNoteType={convertNovelistType}
                onDeleteNote={requestDeleteNote}
                onCreateTag={addTag}
                onRemoveSupportingType={removeNovelistSupportingType}
                initialAiConfig={activeVault?.novelistAiConfig || null}
                onAiConfigChange={updateNovelistAiConfig}
                T={T}
                theme={theme}
              />
            )}
            {view === 'today' && (
              <MnTodayPanel
                helpers={MN_APP_HELPERS}
                notes={notesWithBody}
                tags={tags}
                tasks={calendarTaskItems}
                reminders={reminderCenterItems}
                todayNote={todayDailyNote}
                agendaItems={todayAgendaItems}
                staleTasks={todayDigest.staleTodos}
                unlinkedNotes={todayDigest.unlinkedNotes}
                resurfacedNotes={todayDigest.resurfacedNotes}
                onOpen={(id) => { setSelectedId(id); navigateView('notes'); }}
                onOpenOrCreateDailyNote={createDailyNote}
                onAddQuickTask={addQuickTodayTask}
                onAddReflection={addTodayReflection}
                onEndDayRecap={addTodayEndDayRecap}
                todayAiRecap={todayAiRecap}
                todayAiRecapBusy={todayAiRecapBusy}
                todayAiRecapError={todayAiRecapError}
                onGenerateAiRecap={featureState.showAskAi ? generateTodayAiRecap : null}
                onOpenAgenda={featureState.showAgenda ? () => { navigateView('calendar'); setSelectedTag(null); setSelectedWorkflow(null); } : null}
                onPlanItem={featureState.showAgenda ? () => { navigateView('calendar'); setSelectedTag(null); setSelectedWorkflow(null); } : null}
                rollupFormat={tweaks.rollupFormat || 'long'}
                rollupDefaultRange={tweaks.rollupDefaultRange || 'today'}
                rollupGroupBy={tweaks.rollupGroupBy || 'created'}
                rollupShowPreviews={tweaks.rollupShowPreviews !== false}
                rollupShowTasks={tweaks.rollupShowTasks !== false}
                rollupShowReminders={tweaks.rollupShowReminders !== false}
                rollupCollapseOlder={tweaks.rollupCollapseOlder !== false}
                weekStart={tweaks.weekStart || 'monday'}
                T={T} theme={theme}
              />
            )}
            {view === 'trash' && (
              <MnRecentlyDeletedPanel
                items={trashItems}
                loading={trashLoading}
                error={trashError}
                onRefresh={refreshDeletedItems}
                onRestore={restoreDeletedNote}
                onPurge={purgeDeletedNote}
                T={T}
              />
            )}
            {featureState.showCanvas && view === 'canvas' && (
              <MnCanvasPanel
                canvases={canvases}
                activeCanvas={activeCanvas}
                onCreate={createCanvas}
                onOpen={openCanvas}
                onBack={openCanvasDashboard}
                onSave={saveCanvas}
                onDelete={deleteCanvas}
                notes={notesWithBody}
                onOpenNote={(id) => { setSelectedId(id); navigateView('notes'); }}
                onTextEditingChange={setCanvasTextEditing}
                T={T}
              />
            )}
          </div>
  
          <MnCommandPalette
            open={commandPaletteOpen}
            commands={commands}
            onNaturalAction={runNaturalCommand}
            onClose={() => setCommandPaletteOpen(false)}
            T={T}
          />
          {MnQuickSwitcher && (
            <MnQuickSwitcher
              open={quickSwitcherOpen}
              notes={notes}
              recentIds={recentNoteIds}
              onPick={(id) => openNoteById(id)}
              onCreate={(title) => { createNote({ title }); setSelectedTag(null); setSelectedWorkflow(null); setQuery(''); }}
              onClose={() => setQuickSwitcherOpen(false)}
              T={T}
            />
          )}
          {vaultHealthOpen && (
            <MnVaultHealthDialog
              vaultId={activeVaultId}
              onClose={() => setVaultHealthOpen(false)}
              onRebuildIndex={rebuildIndex}
              T={T}
            />
          )}
  
          {captureOpen && (
            <MnQuickCapture
              tags={tags}
              destinations={MN_APP_HELPERS.captureDestinationChoices
                ? MN_APP_HELPERS.captureDestinationChoices({ notes: notesWithBody, currentNote: selectedNote })
                : []}
              templates={MN_APP_HELPERS.captureTemplateChoices
                ? MN_APP_HELPERS.captureTemplateChoices().filter(template => (
                  !MN_FEATURES.isActionAvailable
                    || MN_FEATURES.isActionAvailable(`capture-template-${template.id}`, featureState)
                ))
                : []}
              onClose={() => setCaptureOpen(false)}
              onSave={(capture) => {
                saveQuickCapture(capture);
                setCaptureOpen(false);
              }}
              T={T} theme={theme}
            />
          )}
          <MnReminderToast
            toast={blockingOverlayOpen || canvasTextEditing ? null : toast}
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
          <MnAiNotice
            notice={featureState.showAskAi ? aiNotice : null}
            onOpen={openAskAi}
            onDismiss={() => setAiNotice(null)}
            T={T}
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
            topOffset={reminderCenterTop}
            T={T}
          />
  
          {/* FAB */}
          {view !== 'ai' && (
            <button type="button" onClick={() => setCaptureOpen(true)} title={`Quick capture (${shortcutLabel('quickCapture', shortcutPlatform, { compact: true })})`}
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
          )}
  
          {settingsOpen && (
            <MnSettingsModal tweaks={tweaks} setTweak={setTweak} T={T}
              themeOptions={themeOptions}
              stats={appStats}
              vaults={vaultsForSidebar}
              activeVaultId={activeVaultId}
              activeVault={activeVault}
              onCreateVault={createVault}
              onDeleteVault={deleteVault}
              onSetVaultNovelistMode={setActiveVaultNovelistMode}
              onListDeletedNotes={listDeletedItems}
              onRestoreDeletedNote={restoreDeletedNote}
              onPurgeDeletedNote={purgeDeletedNote}
              onExportBackup={exportBackup}
              onImportBackup={importBackup}
              onImportThemeFile={importThemeFile}
              onImportNovelFiles={importNovelFiles}
              onOpenVaultHealth={() => setVaultHealthOpen(true)}
              onRebuildIndex={rebuildIndex}
              enabledPacks={enabledPacks}
              featureState={featureState}
              onSetPack={setPackEnabled}
              assistanceEnabled={assistanceEnabled}
              onAssistanceChange={setAssistanceEnabled}
              onClose={() => setSettingsOpen(false)} />
          )}
          <MnNovelImportPreviewDialog
            dialog={novelImportDialog}
            T={T}
            onApply={applyNovelImportPreview}
            onClose={closeNovelImportDialog}
          />
          {deleteTargetNote && (
            <MnDeleteNoteDialog
              note={deleteTargetNote}
              T={T}
              onCancel={() => setDeleteTargetId(null)}
              onConfirm={() => deleteNote(deleteTargetNote.id)}
            />
          )}
          {appNotice && (
            <MnAppNoticeDialog
              notice={appNotice}
              T={T}
              onClose={() => setAppNotice(null)}
            />
          )}
          {conflictNotice && (
            <MnSaveConflictDialog
              conflict={conflictNotice}
              T={T}
              onReloadDisk={reloadConflictFromDisk}
              onKeepCopy={keepConflictAsDuplicate}
              onDismiss={() => setConflictNotice(null)}
            />
          )}
          {versionTargetId && (
            <MnVersionHistoryDialog
              note={notesWithBody.find(note => note.id === versionTargetId)}
              vaultId={activeVaultId}
              T={T}
              onClose={() => setVersionTargetId(null)}
              onRestore={restoreNoteVersion}
            />
          )}
      </div>
    );
}

export { AppView };
