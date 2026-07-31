function MnBlockRowView({ model }) {
  const { MN_APP_HELPERS, MN_BLOCK_LABEL_COLORS, MN_CODE_LANGUAGES, MN_LOGSEQ, MnBlockEmbed, MnCanvasEmbed, MnCanvasPicker, MnDisclosure, MnInlineAiButton, MnMarkdownTable, MnMathBlock, MnMermaidBlock, MnPageEmbed, MnPopover, MnPopoverHeader, MnPopoverItem, MnPropertyRow, MnSmartViewEmbed, MnSpellSuggestionMenu, MnWorkflowPill, T, addBlockLabel, aiActive, aiEnabled, aiTarget, allCanvases, allNotes, applyEditorValue, applySlashCmd, applySpellSuggestion, attachmentFiles, autoIdx, autoLink, autoQ, block, blockAcceptsAttachmentDrops, blockLabels, canvasPicker, collapseByDefault, depth, displayAnnotations, displayBlock, displaySourceOffset, displayTextRef, dropPos, editing, editingLabelId, editorFontSize, editorValue, focusId, fontStyle, handleCopy, handleCut, handleEnter, handleInput, handleKey, handlePaste, handleSelect, hasChildren, ignoreSpellWord, ignoredSpellWords, indentGuides, indentPx, inputRef, insertAttachmentMarkdown, isList, labelMenu, latestContentRef, markdownDisplayProjection, mnAffordancePadTop, mnBlockLabelPalette, mnCodeLanguageLabel, mnGripPadTop, mnIsPropertyLine, mnNormalizeCodeLanguage, mnParseProperty, mnPlaceholder, mnRenderAnnotated, mnRenderCode, mnRenderSpellCheckedText, mnWorkflow, novelistMode, onAiAction, onBeginContentEdit, onBlockMouseDown, onBlockMouseEnter, onChange, onChangeKind, onClearAnnotation, onContextMenu, onCreateCanvas, onDelete, onEndContentEdit, onFocusNext, onFocusPrev, onIndent, onInsertBlocksAt, onMergePrev, onMove, onOpen, onOpenCanvas, onOutdent, onSelectionChange, onSetAnnotation, onSplit, onTagClick, onToggleCheck, onToggleCollapse, onZoom, parseClipboardBlocks, pendingCaretRef, pickSuggestion, removeBlockLabel, selectedAsArea, selectedBlockIds, setAutoIdx, setAutoQ, setBlockLabels, setCanvasPicker, setDropPos, setEditing, setEditingLabelId, setFocusId, setIgnoredSpellWords, setLabelMenu, setSlashIdx, setSlashQ, setSpellIssues, setSpellMenu, slashIdx, slashMatches, slashQ, spellCheck, spellIssues, spellMenu, startEdit, textOffsetFromPoint, updateBlockLabel, vaultId, wikiSuggestions, workflowEnabled } = model;
    return (
      <div
        className="mn-block-row"
        data-block-id={block.id}
        data-block-kind={block.kind || 'paragraph'}
        data-block-depth={depth} data-mn-area-selected={selectedAsArea ? 'true' : undefined}
        onDragOver={(e) => {
          if (attachmentFiles.mnDataTransferHasFiles(e.dataTransfer) && blockAcceptsAttachmentDrops) {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'copy';
            setDropPos('child');
            return;
          }
          if (!e.dataTransfer.types.includes('text/mn-block')) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
          const rect = e.currentTarget.getBoundingClientRect();
          const y = e.clientY - rect.top;
          const h = rect.height;
          // Top 25% → before, bottom 25% → after, middle → child
          if (y < h * 0.25) setDropPos('before');
          else if (y > h * 0.75) setDropPos('after');
          else setDropPos('child');
        }}
        onDragLeave={() => setDropPos(null)}
        onDrop={(e) => {
          const files = attachmentFiles.mnFilesFromDataTransfer(e.dataTransfer) || [];
          if (files.length && blockAcceptsAttachmentDrops) {
            e.preventDefault();
            setDropPos(null);
            const length = String(block.content || '').length;
            void insertAttachmentMarkdown(files, length, length);
            return;
          }
          const srcId = e.dataTransfer.getData('text/mn-block');
          if (!srcId || !dropPos) { setDropPos(null); return; }
          e.preventDefault();
          onMove && onMove(srcId, block.id, dropPos);
          setDropPos(null);
        }}
        onMouseDown={(e) => onBlockMouseDown && onBlockMouseDown(block.id, e)}
        onMouseEnter={() => onBlockMouseEnter && onBlockMouseEnter(block.id)}
        style={{
          display: 'flex', alignItems: 'flex-start',
          paddingLeft: indentPx,
          marginTop: displayBlock.kind === 'heading'
            ? (displayBlock.level === 1 ? 22 : displayBlock.level === 2 ? 16 : 10)
            : (block.kind === 'paragraph' && depth === 0 ? 4 : 1),
          position: 'relative',
          ...(dropPos === 'before' ? { boxShadow: `inset 0 2px 0 0 ${T.accent}` } : {}),
          ...(dropPos === 'after' ? { boxShadow: `inset 0 -2px 0 0 ${T.accent}` } : {}),
          ...(dropPos === 'child' ? { background: T.bgHover, outline: `1px dashed ${T.accent}`, outlineOffset: -2 } : {}),
          ...(selectedAsArea ? { background: T.selBg, outline: `1px solid color-mix(in oklab, ${T.accent || T.ink} 32%, transparent)`, outlineOffset: -1 } : {}),
        }}>
        {/* Vertical guide lines for each ancestor level */}
        {indentGuides && Array.from({ length: depth }, (_, i) => (
          <div key={i} style={{
            position: 'absolute',
            // Align with the bullet center of the ancestor at depth i:
            // paddingLeft (i*24) + bullet halfWidth (9) = i*24 + 9. The
            // disclosure is no longer in the flow, so it adds nothing here.
            left: i * 24 + 9, top: 0, bottom: 0,
            width: 1, background: T.line,
            pointerEvents: 'none',
            opacity: 0.55,
          }} />
        ))}
  
        {/* Disclosure triangle, parked in the gutter just left of this row's
            indent so the text column starts at the same place on every line.
            Only a block with children has anything to fold, so only such a
            block gets one. */}
        {hasChildren && (
          <MnDisclosure
            open={!block.collapsed}
            onClick={() => onToggleCollapse(block.id)}
            padTop={mnGripPadTop(block)}
            left={indentPx - 18}
            T={T}
          />
        )}
  
        {/* Block-kind affordance: bullet dot + drag handle */}
        <div
          title="Drag to move · Click to zoom · Right-click for menu"
          draggable
          onDragStart={(e) => {
            e.dataTransfer.setData('text/mn-block', block.id);
            e.dataTransfer.effectAllowed = 'move';
          }}
          onContextMenu={(e) => {
            e.preventDefault();
            if (onContextMenu) onContextMenu(block.id, e.clientX, e.clientY);
          }}
          onClick={(e) => {
            // Click on bullet (not drag) zooms into the block.
            // Only fire on plain left click without modifiers.
            if (e.button === 0 && !e.shiftKey && !e.altKey && !e.metaKey && !e.ctrlKey) {
              if (onZoom) { e.stopPropagation(); onZoom(block.id); }
            }
          }}
          style={{
            flexShrink: 0,
            display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
            paddingTop: mnAffordancePadTop(displayBlock),
            // A list marker is content — a bullet, a number, a checkbox — and
            // earns its indent. For heading, paragraph, quote and code this
            // slot holds only the hover-revealed grip, so it joins the
            // disclosure in the gutter and prose starts where the title does.
            ...(['todo', 'ordered', 'bullet'].includes(block.kind)
              ? { marginRight: 8, minWidth: 18 }
              : { position: 'absolute', left: indentPx - 36, top: 0, marginRight: 0, minWidth: 18 }),
            cursor: 'grab',
          }}>
          {block.kind === 'todo' ? (
            <button
              type="button"
              aria-label={block.checked ? 'Reopen todo' : 'Complete todo'}
              title={block.checked ? 'Reopen todo' : 'Complete todo'}
              onClick={(e) => { e.stopPropagation(); onToggleCheck(block.id); }}
              style={{
                width: 15, height: 15,
                border: `1.5px solid ${block.checked ? T.accent : T.line}`,
                background: block.checked ? T.accent : 'transparent',
                borderRadius: 3, cursor: 'pointer', padding: 0, marginTop: 1,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
              {block.checked && (
                <svg width="9" height="9" viewBox="0 0 10 10" fill="none">
                  <path d="M2 5L4 7L8 3" stroke="white" strokeWidth="1.6"
                    strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              )}
            </button>
          ) : block.kind === 'ordered' ? (
            <span style={{
              minWidth: 18,
              color: T.inkMed,
              fontFamily: 'var(--mn-mono)',
              fontSize: 11.5,
              lineHeight: '14px',
              textAlign: 'right',
            }}>
              {Math.max(1, Number(block.listNumber) || 1)}{block.listDelimiter === ')' ? ')' : '.'}
            </span>
          ) : block.kind === 'bullet' ? (
            // Real bullet — a small filled dot. Becomes filled-with-halo when collapsed.
            <span style={{
              width: 14, height: 14, borderRadius: '50%',
              background: hasChildren && block.collapsed ? T.bgActive : 'transparent',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              marginTop: 0,
              transition: 'background 120ms',
            }}>
              <span style={{
                width: 5, height: 5, borderRadius: '50%',
                background: T.ink,
              }} />
            </span>
          ) : block.kind === 'divider' ? (
            <span style={{ width: 0 }} />
          ) : (
            // Heading, paragraph, quote, code — no visible dot in default state.
            // Hover-revealed 6-dot grip handle for drag + zoom + right-click context.
            <span className="mn-grip" style={{
              width: 14, height: 14, borderRadius: 3,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              marginTop: mnGripPadTop(displayBlock),
              opacity: 0,
              transition: 'opacity 100ms, background 100ms',
              color: T.inkDim,
            }}>
              <svg width="10" height="14" viewBox="0 0 10 14" fill="currentColor">
                <circle cx="2.5" cy="3"  r="1"/>
                <circle cx="7.5" cy="3"  r="1"/>
                <circle cx="2.5" cy="7"  r="1"/>
                <circle cx="7.5" cy="7"  r="1"/>
                <circle cx="2.5" cy="11" r="1"/>
                <circle cx="7.5" cy="11" r="1"/>
              </svg>
            </span>
          )}
        </div>
  
        {/* Content */}
        <div className={aiActive ? 'mn-ai-text-working' : ''} style={{
          flex: 1,
          minWidth: 0,
          maxWidth: '100%',
          position: 'relative',
          borderRadius: aiActive ? 6 : undefined,
          paddingInline: aiActive ? 3 : undefined,
          ...(block.kind === 'quote' ? {
            borderLeft: `3px solid ${T.line}`, paddingLeft: 14,
          } : {}),
          ...(block.kind === 'code' ? {
            background: T.bgSub, border: `1px solid ${T.lineSub}`,
            borderRadius: 6, padding: '8px 12px',
          } : {}),
        }}>
          {block.kind === 'code' && (
            <div
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
              style={{
                display: 'flex', alignItems: 'center', gap: 8,
                marginBottom: 8, paddingBottom: 7,
                borderBottom: `1px solid ${T.lineSub}`,
              }}>
              <select
                value={mnNormalizeCodeLanguage(block.language)}
                onChange={(e) => onChangeKind(block.id, { language: e.target.value })}
                title="Code language"
                spellCheck={false}
                style={{
                  maxWidth: 170,
                  border: `1px solid ${T.lineSub}`,
                  background: T.bg,
                  color: T.inkMed,
                  borderRadius: 5,
                  padding: '3px 24px 3px 7px',
                  fontFamily: 'var(--mn-mono)',
                  fontSize: 10.5,
                  outline: 'none',
                }}>
                {MN_CODE_LANGUAGES.map(lang => (
                  <option key={lang.value || 'plain'} value={lang.value}>{lang.label}</option>
                ))}
              </select>
              <span style={{
                fontFamily: 'var(--mn-mono)', fontSize: 10,
                color: T.inkDim,
              }}>{mnCodeLanguageLabel(block.language)}</span>
            </div>
          )}
          {(blockLabels.length > 0 || labelMenu) && (
            <div
              onMouseDown={(e) => e.stopPropagation()}
              style={{
                display: 'flex',
                alignItems: 'center',
                flexWrap: 'wrap',
                gap: 4,
                margin: blockLabels.length ? '0 0 3px' : 0,
              }}>
              {blockLabels.map(label => {
                const palette = mnBlockLabelPalette(label.color);
                const editingLabel = editingLabelId === label.id || !String(label.text || '').trim();
                const inputWidth = Math.max(42, Math.min(170, (String(label.text || '').length || 5) * 7 + 22));
                return (
                  <span
                    key={label.id}
                    onClick={(e) => { e.stopPropagation(); setEditingLabelId(label.id); }}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setLabelMenu({ labelId: label.id, x: e.clientX, y: e.clientY });
                    }}
                    title="Click to edit label · Right-click to change color"
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 4,
                      minHeight: 20,
                      borderRadius: 4,
                      border: `1px solid ${palette.border}`,
                      background: palette.bg,
                      color: palette.ink,
                      padding: '1px 4px',
                      fontFamily: 'var(--mn-mono)',
                      fontSize: 10.5,
                      lineHeight: 1.2,
                      cursor: 'text',
                    }}>
                    {editingLabel ? (
                      <input
                        value={label.text || ''}
                        autoFocus
                        onChange={(e) => updateBlockLabel(label.id, { text: e.target.value })}
                        onBlur={() => setEditingLabelId(current => current === label.id ? null : current)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') { e.preventDefault(); setEditingLabelId(null); }
                          if (e.key === 'Escape') { e.preventDefault(); setEditingLabelId(null); }
                        }}
                        placeholder="label"
                        spellCheck={false}
                        style={{
                          width: inputWidth,
                          border: 'none',
                          outline: 'none',
                          background: 'transparent',
                          color: palette.ink,
                          fontFamily: 'var(--mn-mono)',
                          fontSize: 10.5,
                          padding: 0,
                        }}
                      />
                    ) : (
                      <span>{label.text}</span>
                    )}
                    <button
                      onClick={(e) => { e.stopPropagation(); removeBlockLabel(label.id); }}
                      title="Remove label"
                      style={{
                        width: 14,
                        height: 14,
                        border: 'none',
                        background: 'transparent',
                        color: palette.ink,
                        opacity: 0.72,
                        cursor: 'pointer',
                        padding: 0,
                        fontFamily: 'var(--mn-mono)',
                        fontSize: 10,
                        lineHeight: 1,
                      }}>x</button>
                  </span>
                );
              })}
              {labelMenu && (
                <div
                  className="mn-label-color-menu"
                  onMouseDown={(e) => e.stopPropagation()}
                  style={{
                    position: 'fixed',
                    left: Math.min(labelMenu.x, window.innerWidth - 174),
                    top: Math.min(labelMenu.y, window.innerHeight - 94),
                    zIndex: 260,
                    display: 'grid',
                    gridTemplateColumns: 'repeat(3, 1fr)',
                    gap: 4,
                    width: 166,
                    padding: 6,
                    borderRadius: 7,
                    border: `1px solid ${T.line}`,
                    background: T.bg,
                    boxShadow: `0 10px 28px color-mix(in oklab, ${T.ink} 18%, transparent)`,
                  }}>
                  {MN_BLOCK_LABEL_COLORS.map(color => (
                    <button
                      key={color.id}
                      onClick={(e) => {
                        e.stopPropagation();
                        updateBlockLabel(labelMenu.labelId, { color: color.id });
                        setLabelMenu(null);
                      }}
                      title={color.label}
                      style={{
                        height: 24,
                        borderRadius: 5,
                        border: `1px solid ${color.border}`,
                        background: color.bg,
                        color: color.ink,
                        cursor: 'pointer',
                        fontFamily: 'var(--mn-mono)',
                        fontSize: 9.5,
                      }}>{color.label}</button>
                  ))}
                </div>
              )}
            </div>
          )}
          {editing ? (
            <>
              <textarea
                data-mn-block-content="editor"
                ref={inputRef}
                value={editorValue}
                onChange={handleInput}
                onPaste={handlePaste}
                onCopy={handleCopy}
                onCut={handleCut}
                onSelect={handleSelect}
                onMouseUp={handleSelect}
                onKeyUp={handleSelect}
                onBlur={() => {
                  setTimeout(() => {
                    onEndContentEdit && onEndContentEdit(block.id);
                    setEditing(false); setAutoQ(null); setSlashQ(null);
                  }, 100);
                }}
                onKeyDown={handleKey}
                spellCheck={block.kind === 'code' ? false : spellCheck}
                rows={1}
                placeholder={mnPlaceholder(block)}
                style={{
                  width: '100%', border: 'none', outline: 'none',
                  background: 'transparent', resize: 'none', padding: 0,
                  ...fontStyle,
                  lineHeight: fontStyle.lineHeight || 1.55,
                  overflow: 'hidden',
                }} />
              {wikiSuggestions.length > 0 && (
                <MnPopover T={T} anchorRef={inputRef}>
                  <MnPopoverHeader T={T}>Link to note</MnPopoverHeader>
                  {wikiSuggestions.map((s, i) => (
                    <MnPopoverItem
                      key={s.id}
                      active={i === autoIdx}
                      onMouseDown={(e) => { e.preventDefault(); pickSuggestion(s.title); }}
                      onMouseEnter={() => setAutoIdx(i)}
                      T={T}>
                      {s.title}
                    </MnPopoverItem>
                  ))}
                </MnPopover>
              )}
              {slashQ != null && (
                <MnPopover T={T} wide anchorRef={inputRef}>
                  <MnPopoverHeader T={T}>
                    Insert{slashQ.query ? <> <span style={{opacity:0.5}}>/</span><span style={{color:T.ink, textTransform:'none', letterSpacing:0}}>{slashQ.query}</span></> : null}
                  </MnPopoverHeader>
                  {slashMatches.length === 0 ? (
                    <div style={{
                      padding: '12px 10px', fontFamily: 'var(--mn-ui)', fontSize: 12.5,
                      color: T.inkDim, textAlign: 'center',
                    }}>No matching commands</div>
                  ) : slashMatches.map((cmd, i) => (
                    <div key={cmd.id}
                      onMouseDown={(e) => { e.preventDefault(); applySlashCmd(cmd); }}
                      onMouseEnter={() => setSlashIdx(i)}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 10,
                        padding: '7px 10px', borderRadius: 5, cursor: 'pointer',
                        background: i === slashIdx ? T.selBg : 'transparent',
                      }}>
                      <div style={{
                        width: 26, height: 26, borderRadius: 5, flexShrink: 0,
                        background: T.bg, border: `1px solid ${T.lineSub}`,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontFamily: 'var(--mn-mono)', fontSize: 11, fontWeight: 500,
                        color: T.inkMed,
                      }}>{cmd.icon}</div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{
                          fontFamily: 'var(--mn-ui)', fontSize: 13, color: T.ink,
                          fontWeight: i === slashIdx ? 500 : 400,
                        }}>{cmd.label}</div>
                        <div style={{
                          fontFamily: 'var(--mn-ui)', fontSize: 11, color: T.inkDim,
                          marginTop: 1,
                        }}>{cmd.hint}</div>
                      </div>
                      {cmd.kbd && (
                        <div style={{
                          fontFamily: 'var(--mn-mono)', fontSize: 10, color: T.inkDim,
                          padding: '2px 5px', borderRadius: 3,
                          background: T.bgSub, border: `1px solid ${T.lineSub}`,
                          flexShrink: 0,
                        }}>{cmd.kbd}</div>
                      )}
                    </div>
                  ))}
                </MnPopover>
              )}
            </>
          ) : (
            <div
              data-mn-block-content="display"
              onClick={startEdit}
              onCopy={handleCopy}
              spellCheck={false}
              style={{
                ...fontStyle,
                lineHeight: fontStyle.lineHeight || 1.55,
                color: block.checked ? T.inkDim : fontStyle.color,
                textDecoration: block.checked ? 'line-through' : (fontStyle.textDecoration || 'none'),
                cursor: 'text', padding: '1px 2px', borderRadius: 3,
                minHeight: 18,
                whiteSpace: 'pre-wrap',
              }}>
              {workflowEnabled && block.workflow && (
                <MnWorkflowPill
                  state={block.workflow}
                  onClick={(e) => {
                    e.stopPropagation();
                    const cur = mnWorkflow(block.workflow);
                    onChangeKind(block.id, { workflow: cur?.next || null });
                  }}
                  T={T}
                />
              )}
              <span ref={displayTextRef}>
                {(() => {
                  const content = displayBlock.content || '';
                  // Page-property line: key:: value
                  if (!markdownDisplayProjection && mnIsPropertyLine(content)) {
                    const prop = mnParseProperty(content);
                    if (prop) return <MnPropertyRow property={prop} T={T} />;
                  }
                  // Block-level embed: {{embed [[Page]]}} or {{embed ((id))}}
                  const pageEmbed = !markdownDisplayProjection && content.match(/^\{\{embed\s+\[\[(.+?)\]\]\}\}$/);
                  if (pageEmbed) {
                    return <MnPageEmbed title={pageEmbed[1]} allNotes={allNotes} T={T} onOpenNote={(id) => onOpen && onOpen(null, id)} />;
                  }
                  const blockEmbed = !markdownDisplayProjection && content.match(/^\{\{embed\s+\(\(([^)]+)\)\)\}\}$/);
                  if (blockEmbed) {
                    return <MnBlockEmbed refId={blockEmbed[1]} allNotes={allNotes} T={T} onOpenBlock={(noteId, blockId) => onOpen && onOpen(null, noteId, blockId)} />;
                  }
                  const canvasEmbed = !markdownDisplayProjection && content.match(/^\{\{canvas\s+([A-Za-z0-9_-]+)\}\}$/);
                  if (canvasEmbed) {
                    return <MnCanvasEmbed canvasId={canvasEmbed[1]} canvases={allCanvases} T={T} onOpenCanvas={onOpenCanvas} />;
                  }
                  const smartViewEmbed = !markdownDisplayProjection && MN_APP_HELPERS.smartViewParseEmbedBlock
                    ? MN_APP_HELPERS.smartViewParseEmbedBlock(content, MN_APP_HELPERS.currentSmartViewDefinitions || [])
                    : null;
                  if (smartViewEmbed) {
                    return <MnSmartViewEmbed embed={smartViewEmbed} allNotes={allNotes} T={T} onOpen={onOpen} />;
                  }
                  if (block.kind === 'table') {
                    return <MnMarkdownTable markdown={content} T={T} />;
                  }
                  if (block.kind === 'code') {
                    if (!content) {
                      return <span style={{ color: T.inkDim, fontStyle: 'italic' }}>{mnPlaceholder(block)}</span>;
                    }
                    const lang = mnNormalizeCodeLanguage(block.language);
                    if (lang === 'math') return <MnMathBlock source={content} T={T} />;
                    if (lang === 'mermaid') return <MnMermaidBlock source={content} T={T} />;
                    return mnRenderCode(content, block.language, T);
                  }
                  if (content) {
                    const renderSpellText = spellCheck && Object.keys(spellIssues || {}).length
                      ? (text, offset) => mnRenderSpellCheckedText(text, spellIssues, T, setSpellMenu, displaySourceOffset + offset)
                      : null;
                    return mnRenderAnnotated(content, displayAnnotations, T, onOpen, onTagClick, allNotes, renderSpellText, vaultId);
                  }
                  return <span style={{ color: T.inkDim, fontStyle: 'italic' }}>{mnPlaceholder(displayBlock)}</span>;
                })()}
              </span>
              <MnSpellSuggestionMenu
                menu={spellMenu}
                onPick={applySpellSuggestion}
                onAdd={ignoreSpellWord}
                onClose={() => setSpellMenu(null)}
                T={T}
              />
              {canvasPicker && (
                <MnCanvasPicker
                  canvases={allCanvases}
                  onPick={(canvasId) => {
                    onChange(block.id, `{{canvas ${canvasId}}}`);
                    setCanvasPicker(false);
                    setFocusId && setFocusId(block.id);
                  }}
                  onCreate={async () => {
                    const canvas = await onCreateCanvas?.('Untitled canvas', { open: false });
                    if (canvas?.id) {
                      onChange(block.id, `{{canvas ${canvas.id}}}`);
                      setCanvasPicker(false);
                      setFocusId && setFocusId(block.id);
                    }
                  }}
                  onClose={() => setCanvasPicker(false)}
                  T={T}
                />
              )}
              {block.collapsed && hasChildren && (
                <span style={{
                  marginLeft: 8, fontFamily: 'var(--mn-mono)',
                  fontSize: 10, color: T.inkDim, fontWeight: 400,
                  padding: '1px 6px', borderRadius: 3,
                  background: T.bgSub, border: `1px solid ${T.lineSub}`,
                }}>
                  {block.children.length} hidden
                </span>
              )}
            </div>
          )}
        </div>
        {aiEnabled && (
          <MnInlineAiButton
            block={block}
            T={T}
            onAiAction={onAiAction}
          />
        )}
      </div>
    );
  }

export { MnBlockRowView };
