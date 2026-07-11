import { mnPanelMiniButton, mnPanelMenuItem } from '../../shared/panels/panelStyles.js';

function NovelistPanelView({ model }) {
  const {
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
  } = model;
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

export { NovelistPanelView };
