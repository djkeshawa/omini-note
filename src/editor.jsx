// Editor pane: OminiNote block outliner. Shows note title, date, tags, backlinks.

const { useState: useStateE, useMemo: useMemoE, useRef: useRefE, useEffect: useEffectE } = React;

function MnEditor({
  note, notes, tags, links, vaultId,
  canvases = [], onOpenCanvas, onCreateCanvas,
  onOpen, onCreateLinkedNote, onOpenTag,
  onBlocksChange, onTitleChange, onAddTag, onCreateTag, onRemoveTag,
  onPinToggle, onDelete, onOpenGraph, onBack,
  onToggleSidebar, sidebarHidden,
  onToggleNoteList, noteListHidden,
  editorWidth = 'medium', fontSize = 'default',
  indentGuides = true, spellCheck = true, autoLink = true, collapseByDefault = false,
  novelistPath = null,
  theme, T,
}) {
  const HAS_DISK_E = typeof window !== 'undefined' && !!window.mn;
  const [showTags, setShowTags] = useStateE(false);
  const [tagDraft, setTagDraft] = useStateE('');
  const [zoomBlockId, setZoomBlockId] = useStateE(null);
  const [toast, setToast] = useStateE(null);

  // Reset zoom when note changes
  useEffectE(() => { setZoomBlockId(null); }, [note.id]);

  const onShowToast = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2200);
  };

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
    return notes.filter(n => {
      if (n.id === note.id) return false;
      const body = n.body || mnBlocksToMd(n.blocks || []);
      const re = new RegExp(`\\[\\[${note.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\]\\]`, 'i');
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
  }, [vaultId, note.id, note.title, note.blocks]);

  const backlinks = diskBacklinks != null ? diskBacklinks : inMemoryBacklinks;

  // Word count from blocks
  const wordCount = useMemoE(() => {
    let count = 0;
    mnWalk(note.blocks || [], (b) => {
      count += b.content.split(/\s+/).filter(Boolean).length;
    });
    return count;
  }, [note.blocks]);

  const setBlocks = (updater) => {
    onBlocksChange(updater);
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
      flex: 1, height: '100%', background: T.bg,
      display: 'flex', flexDirection: 'column', position: 'relative',
      minWidth: 0,
    }}>
      {/* Toolbar */}
      <div style={{
        padding: '14px 76px 10px 28px', display: 'flex', alignItems: 'center', gap: 8,
      }}>
        {onBack && (
          <button onClick={onBack} title="Back to previous view" style={iconBtn(T)}>
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7">
              <path d="M10 3L5 8L10 13" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        )}
        <div style={{ flex: 1 }} />

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
        <button onClick={onDelete} title="Delete" style={iconBtn(T)}>
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3">
            <path d="M3 4.5H13M6 4.5V3C6 2.5 6.5 2 7 2H9C9.5 2 10 2.5 10 3V4.5M5 4.5V13C5 13.5 5.5 14 6 14H10C10.5 14 11 13.5 11 13V4.5" strokeLinecap="round"/>
          </svg>
        </button>
      </div>

      <div style={{ flex: 1, overflow: 'auto', padding: '0 56px 40px' }}>
        <div style={{
          maxWidth: editorWidth === 'narrow' ? 720
                  : editorWidth === 'wide' ? 1280
                  : editorWidth === 'full' ? 'none'
                  : 1000,
          margin: '0 auto', paddingTop: 12,
          fontSize: fontSize === 'small' ? '13px' : fontSize === 'large' ? '16px' : '14.5px',
        }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8,
            fontFamily: 'var(--mn-mono)', fontSize: 10.5, color: T.inkDim,
            letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 10,
          }}>
            <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3">
              <rect x="2" y="3" width="12" height="11" rx="1.5"/>
              <path d="M5 2V4M11 2V4M2 7H14" strokeLinecap="round"/>
            </svg>
            <span>{dateText}</span>
            <span style={{ color: T.lineSub }}>·</span>
            <span>{timeText}</span>
            <span style={{ color: T.lineSub }}>·</span>
            <span>{wordCount} words</span>
          </div>

          {Array.isArray(novelistPath) && novelistPath.length > 1 && (
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: 5,
              flexWrap: 'wrap',
              margin: '-3px 0 10px',
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
                      maxWidth: 180,
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

          <input
            value={note.title}
            onChange={(e) => onTitleChange(e.target.value)}
            spellCheck={spellCheck}
            onKeyDown={(e) => {
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
              fontFamily: 'var(--mn-body)', fontSize: 30, fontWeight: 600,
              color: T.ink, letterSpacing: '-0.02em', marginBottom: 14,
              padding: 0,
            }}
          />

          <div style={{
            display: 'flex', gap: 6, marginBottom: 20, alignItems: 'center', flexWrap: 'wrap'
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

          {/* Outliner */}
          <MnOutliner
            blocks={note.blocks || []}
            setBlocks={setBlocks}
            allNotes={notes}
            allCanvases={canvases}
            noteTitle={note.title}
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
            T={T}
          />

          {backlinks.length > 0 && (
            <div style={{
              marginTop: 40, paddingTop: 20,
              borderTop: `1px solid ${T.lineSub}`,
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
    </div>
  );
}

function iconBtn(T, active) {
  return {
    width: 28, height: 26, borderRadius: 5,
    border: `1px solid ${active ? T.accent : T.lineSub}`,
    background: active ? T.accentSoft : T.bg,
    color: active ? T.accent : T.inkMed,
    cursor: 'pointer', padding: 0,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  };
}

window.MnEditor = MnEditor;
