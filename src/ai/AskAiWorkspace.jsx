import { MN_ASK_SUGGESTIONS, mnReportAiOutput } from './aiModels.js';
import { MnAiSetupNotice, MnCurrentNoteSuggestionsCard, MnAiFormattedResponse } from './aiPresentation.jsx';
import { StatusPill, iconBtn, mnAskPrimaryButton, mnAskReportButton, mnAskSecondaryButton } from './aiUi.jsx';

function AskAiWorkspace({ model }) {
  const {
    onKey,
    embedded,
    T,
    pending,
    activeAction,
    statusText,
    status,
    messages,
    clearConversation,
    closeOrBackground,
    inputRef,
    query,
    setQuery,
    onComposerKeyDown,
    pickSuggestion,
    footerHint,
    currentNote,
    requestCurrentNoteSuggestions,
    noteSuggestionsBusy,
    submit,
    canAsk,
    stopRun,
    scrollRef,
    rememberScrollPosition,
    error,
    noteSuggestions,
    noteSuggestionsError,
    rejectCurrentNoteSuggestions,
    onOpenNote,
    onClose,
    noteIdSet,
    latestResponseIndex,
    aiSession,
    aiRuntime,
    allNotes,
    openSources,
    cancelReview,
    editReviewArgs,
    confirmReview,
    toggleSources,
    onRestoreCurrentPageBody,
    restoreAiEdit,
    onOpenCurrentNoteVersions,
    openAiEditVersionHistory,
    scrollBottomRef,
  } = model;
  const content = (
        <div onClick={e => e.stopPropagation()} onKeyDown={onKey} style={{
          width: '100%', maxWidth: embedded ? 'none' : 820, height: embedded ? '100%' : 'auto', maxHeight: embedded ? 'none' : '86vh',
          background: T.bg, color: T.ink, borderRadius: 12,
          border: embedded ? 'none' : `1px solid ${T.line}`,
          boxShadow: embedded ? 'none' : `0 24px 60px color-mix(in oklab, ${T.ink} 30%, transparent)`,
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
          animation: embedded ? 'none' : 'mnSlideDown 160ms ease',
        }}>
          <div style={{
            padding: embedded ? '12px 60px 12px 18px' : '12px 18px',
            borderBottom: `1px solid ${T.lineSub}`,
            background: T.bg,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{
                width: 26,
                height: 26,
                borderRadius: 6,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: T.accent,
                background: T.accentSoft,
                flexShrink: 0,
              }}>
                <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.45">
                  <path d="M8 2.4L9.1 5.9L12.6 7L9.1 8.1L8 11.6L6.9 8.1L3.4 7L6.9 5.9L8 2.4Z" strokeLinejoin="round" />
                  <path d="M12.4 10.4L13 12L14.6 12.6L13 13.2L12.4 14.8L11.8 13.2L10.2 12.6L11.8 12L12.4 10.4Z" strokeLinejoin="round" />
                </svg>
              </div>
              <div style={{ minWidth: 0, flex: 1, display: 'flex', alignItems: 'baseline', gap: 8 }}>
                <div style={{ fontSize: 14, fontWeight: 650, color: T.ink, flexShrink: 0 }}>Ask AI</div>
                <div style={{
                  fontFamily: 'var(--mn-mono)',
                  fontSize: 10.5,
                  color: T.inkDim,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  minWidth: 0,
                }}>
                  {pending ? activeAction || 'Working on your request' : statusText}
                </div>
              </div>
              <StatusPill status={status} T={T} />
              {messages.length > 0 && (
                <button
                  onClick={clearConversation}
                  disabled={pending}
                  title="Clear conversation"
                  style={{
                    ...mnAskSecondaryButton(T),
                    opacity: pending ? 0.45 : 1,
                    cursor: pending ? 'default' : 'pointer',
                  }}>
                  Clear
                </button>
              )}
              {!embedded && (
                <button onClick={closeOrBackground} title={pending ? 'Run in background' : 'Close (Esc)'} style={iconBtn(T)}>
                  <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6">
                    <path d="M4 4L12 12M12 4L4 12" strokeLinecap="round"/>
                  </svg>
                </button>
              )}
            </div>
          </div>
  
          <div style={{ order: 3, padding: '10px 18px 12px', borderTop: `1px solid ${T.lineSub}`, background: `color-mix(in oklab, ${T.bg} 88%, ${T.bgSub})`, flexShrink: 0 }}>
            <textarea
              ref={inputRef}
              value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={onComposerKeyDown}
              placeholder="Ask anything about your notes…"
              rows={1}
              style={{
                width: '100%', resize: 'none',
                border: `1px solid ${T.lineSub}`,
                borderRadius: 8, padding: '10px 12px',
                fontFamily: 'var(--mn-body)', fontSize: 14.5,
                background: T.bgSub, color: T.ink, outline: 'none',
                lineHeight: 1.4,
                minHeight: 42,
                height: 42,
                maxHeight: 142,
                overflowY: 'auto',
                boxShadow: `inset 0 1px 0 color-mix(in oklab, ${T.bg} 85%, white)`,
              }}
            />
            {messages.length === 0 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginTop: 9 }}>
                {MN_ASK_SUGGESTIONS.map(item => (
                  <button
                    key={item}
                    onClick={() => pickSuggestion(item)}
                    style={{
                      border: `1px solid ${T.lineSub}`,
                      background: T.bg,
                      color: T.inkMed,
                      borderRadius: 999,
                      padding: '5px 9px',
                      cursor: 'pointer',
                      fontFamily: 'var(--mn-ui)',
                      fontSize: 12,
                    }}>
                    {item}
                  </button>
                ))}
              </div>
            )}
            <div style={{
              display: 'flex', alignItems: 'center', gap: 10, marginTop: 10,
            }}>
              <div style={{ flex: 1, fontSize: 11, color: T.inkDim, fontFamily: 'var(--mn-mono)' }}>
                {footerHint}
              </div>
              {currentNote && (
                <button
                  type="button"
                  onClick={requestCurrentNoteSuggestions}
                  disabled={pending || noteSuggestionsBusy}
                  style={{
                    ...mnAskSecondaryButton(T),
                    cursor: pending || noteSuggestionsBusy ? 'not-allowed' : 'pointer',
                    opacity: pending || noteSuggestionsBusy ? 0.6 : 1,
                  }}>
                  {noteSuggestionsBusy ? 'Checking note...' : 'Suggest for note'}
                </button>
              )}
              <button onClick={submit} disabled={pending || !query.trim() || !canAsk}
                style={{
                  ...mnAskPrimaryButton(T),
                  background: pending ? T.bgSub : T.ink,
                  color: pending ? T.inkDim : T.bg,
                  cursor: pending || !query.trim() || !canAsk ? 'not-allowed' : 'pointer',
                  opacity: pending || !query.trim() || !canAsk ? 0.6 : 1,
                }}>
                {pending ? 'Thinking…' : 'Ask'}
              </button>
              {pending && (
                <button
                  onClick={stopRun}
                  style={{
                    ...mnAskSecondaryButton(T),
                    border: `1px solid color-mix(in oklab, ${T.warn || T.danger || T.ink} 42%, ${T.line})`,
                    background: `color-mix(in oklab, ${T.warn || T.danger || T.ink} 9%, ${T.bg})`,
                    color: T.warn || T.danger || T.inkMed,
                  }}>
                  Stop
                </button>
              )}
              {pending && (
                <button
                  onClick={closeOrBackground}
                  style={mnAskSecondaryButton(T)}>
                  Run in background
                </button>
              )}
            </div>
          </div>
  
          <div ref={scrollRef} onScroll={rememberScrollPosition} style={{ order: 2, flex: 1, overflow: 'auto', padding: '18px 18px', position: 'relative', background: T.bg }}>
            <style>{`
              .mn-ask-ai-shimmer {
                animation: mnAskAiShimmer 1.5s ease-in-out infinite;
              }
              @keyframes mnAskAiShimmer {
                0%, 100% {
                  opacity: 0.44;
                  box-shadow: inset 0 0 0 1px color-mix(in oklab, ${T.accent || T.ink} 8%, transparent);
                }
                50% {
                  opacity: 0.78;
                  box-shadow: inset 0 0 0 1px color-mix(in oklab, ${T.accent || T.ink} 18%, transparent), 0 8px 28px color-mix(in oklab, ${T.accent || T.ink} 8%, transparent);
                }
              }
            `}</style>
            {error && (
              <div style={{
                padding: 12, borderRadius: 8, background: T.bgSub,
                border: `1px solid ${T.line}`, color: T.warn || '#c33',
                fontFamily: 'var(--mn-mono)', fontSize: 12.5, whiteSpace: 'pre-wrap',
              }}>{error}</div>
            )}
            {messages.length === 0 && <MnAiSetupNotice status={status} T={T} />}
            {(noteSuggestions || noteSuggestionsBusy || noteSuggestionsError) && (
              <MnCurrentNoteSuggestionsCard
                result={noteSuggestions}
                busy={noteSuggestionsBusy}
                error={noteSuggestionsError}
                T={T}
                onRefresh={requestCurrentNoteSuggestions}
                onReject={rejectCurrentNoteSuggestions}
                onOpenNote={onOpenNote}
                onClose={onClose}
                embedded={embedded}
                noteIdSet={noteIdSet}
              />
            )}
            {messages.map((m, idx) => {
              const previousUser = [...messages.slice(0, idx)].reverse().find(item => item.role === 'user')?.text || '';
              const canReport = m.role === 'assistant' && !m.error && !m.stopped && String(m.text || '').trim();
              const hasSources = m.sources?.length > 0;
              const sourcesOpen = hasSources && !!openSources[m.id];
              const traceLabels = m.role === 'assistant' && m.streaming
                ? (aiSession.activeRun?.trace || [])
                  .map(item => item?.label || aiRuntime.traceLabel?.(item) || item?.event)
                  .filter(Boolean)
                  .filter((label, index, arr) => label !== arr[index - 1])
                  .slice(-5)
                : [];
              return (
              <div key={m.id} data-mn-latest-response={idx === latestResponseIndex ? 'true' : undefined} style={{
                marginBottom: 14,
                display: 'flex',
                justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start',
              }}>
                <div style={{
                  maxWidth: m.role === 'user' ? '72%' : '100%',
                  padding: m.role === 'user' ? '9px 12px' : '2px 0',
                  borderRadius: m.role === 'user' ? 16 : 0,
                  background: m.role === 'user' ? T.ink : 'transparent',
                  color: m.role === 'user' ? T.bg : (m.error ? (T.warn || '#c33') : T.ink),
                  border: 'none',
                  fontFamily: 'var(--mn-body)', fontSize: 14.5, lineHeight: 1.6,
                  whiteSpace: m.role === 'user' || m.error || m.stopped ? 'pre-wrap' : 'normal',
                  boxShadow: 'none',
                }}>
                  {m.role !== 'user' && (
                    <div style={{
                      fontFamily: 'var(--mn-mono)',
                      fontSize: 10,
                      color: m.error ? (T.warn || '#c33') : T.inkDim,
                      marginBottom: 5,
                      textTransform: 'uppercase',
                      letterSpacing: '0.08em',
                    }}>
                      {m.error ? 'Error' : m.stopped ? 'Stopped' : m.action ? 'Action' : m.streaming ? 'Answering' : 'Answer'}
                    </div>
                  )}
                  {m.role !== 'user' && !m.error && !m.stopped && m.text
                    ? <MnAiFormattedResponse
                        text={m.text}
                        T={T}
                        allNotes={allNotes}
                        onOpenNote={onOpenNote}
                        onClose={onClose}
                        embedded={embedded}
                      />
                    : (m.text || (m.streaming ? activeAction || 'Thinking...' : ''))}
                  {traceLabels.length > 0 && (
                    <div style={{
                      marginTop: 10,
                      display: 'grid',
                      gap: 5,
                      fontFamily: 'var(--mn-mono)',
                      fontSize: 11,
                      color: T.inkDim,
                      whiteSpace: 'normal',
                    }}>
                      {traceLabels.map((label, traceIndex) => (
                        <div key={`${label}-${traceIndex}`} style={{ display: 'flex', gap: 7, alignItems: 'center' }}>
                          <span style={{
                            width: 6,
                            height: 6,
                            borderRadius: 6,
                            background: traceIndex === traceLabels.length - 1 ? (T.accent || T.ink) : T.line,
                            flex: '0 0 auto',
                          }} />
                          <span>{label}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  {m.review && (
                    <div style={{
                      marginTop: 12,
                      padding: 12,
                      borderRadius: 8,
                      background: T.bgSub,
                      border: `1px solid color-mix(in oklab, ${T.warn || T.danger || T.ink} 34%, ${T.lineSub})`,
                      color: T.ink,
                    }}>
                      <div style={{ fontSize: 13, fontWeight: 720, color: T.ink }}>{m.review.title || 'Review action'}</div>
                      {m.review.risk && (
                        <div style={{ marginTop: 3, fontFamily: 'var(--mn-mono)', fontSize: 10.5, color: T.inkDim, textTransform: 'uppercase' }}>
                          {m.review.risk} action
                        </div>
                      )}
                      {m.review.preview?.steps?.length > 0 && (
                        <div style={{ marginTop: 9, display: 'grid', gap: 5 }}>
                          {m.review.preview.steps.map((step, reviewIndex) => (
                            <div key={reviewIndex} style={{ fontSize: 12.5, color: T.inkMed }}>{reviewIndex + 1}. {step}</div>
                          ))}
                        </div>
                      )}
                      {m.review.preview?.affected?.length > 0 && (
                        <div style={{ marginTop: 9, fontSize: 12, color: T.inkDim }}>
                          Affects {m.review.preview.affected.map(item => item.title || item.id).join(', ')}
                        </div>
                      )}
                      {m.review.message && (
                        <div style={{ marginTop: 9, fontSize: 12.5, color: T.inkMed }}>{m.review.message}</div>
                      )}
                      {m.review.preview?.markdownPreview && (
                        <div style={{
                          marginTop: 10,
                          border: `1px solid ${T.lineSub}`,
                          borderRadius: 7,
                          background: T.bg,
                          overflow: 'hidden',
                        }}>
                          <div style={{
                            display: 'flex',
                            gap: 8,
                            alignItems: 'center',
                            padding: '7px 9px',
                            borderBottom: `1px solid ${T.lineSub}`,
                            fontFamily: 'var(--mn-ui)',
                            fontSize: 12,
                            color: T.inkMed,
                          }}>
                            <span style={{ fontWeight: 720, color: T.ink }}>Exact Markdown preview</span>
                            <span style={{ fontFamily: 'var(--mn-mono)', color: T.inkDim }}>
                              {m.review.preview.markdownPreview.beforeLines} {'->'} {m.review.preview.markdownPreview.afterLines} lines
                            </span>
                          </div>
                          {m.review.preview.markerWarnings?.length > 0 && (
                            <div style={{
                              padding: '7px 9px',
                              borderBottom: `1px solid ${T.lineSub}`,
                              background: `color-mix(in oklab, ${T.warn || T.danger || T.ink} 8%, ${T.bg})`,
                              color: T.warn || T.danger || T.ink,
                              fontFamily: 'var(--mn-ui)',
                              fontSize: 12,
                              lineHeight: 1.45,
                            }}>
                              <div style={{ fontWeight: 720 }}>Markdown preservation check</div>
                              {m.review.preview.markerWarnings.map((warning, warningIndex) => (
                                <div key={warningIndex}>{warning}</div>
                              ))}
                            </div>
                          )}
                          <div style={{
                            display: 'grid',
                            gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
                          }}>
                            {[
                              ['Before', m.review.preview.markdownPreview.before, 'before'],
                              ['After', m.review.preview.markdownPreview.after, 'after'],
                            ].map(([label, value, key]) => (
                              <div key={key} style={{ minWidth: 0, borderRight: key === 'before' ? `1px solid ${T.lineSub}` : 'none' }}>
                                <div style={{
                                  padding: '5px 10px',
                                  borderBottom: `1px solid ${T.lineSub}`,
                                  color: T.inkDim,
                                  fontFamily: 'var(--mn-mono)',
                                  fontSize: 10.5,
                                }}>{label}</div>
                                <pre data-mn-ai-edit-preview={key} style={{
                                  margin: 0,
                                  padding: 10,
                                  maxHeight: 230,
                                  overflow: 'auto',
                                  whiteSpace: 'pre-wrap',
                                  fontFamily: 'var(--mn-mono)',
                                  fontSize: 11.5,
                                  lineHeight: 1.55,
                                  color: T.ink,
                                }}>{value}</pre>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                      {m.review.steps?.length > 0 && (
                        <pre style={{
                          marginTop: 9,
                          padding: 8,
                          borderRadius: 6,
                          background: T.bg,
                          border: `1px solid ${T.lineSub}`,
                          color: T.inkDim,
                          fontFamily: 'var(--mn-mono)',
                          fontSize: 11,
                          whiteSpace: 'pre-wrap',
                          overflow: 'auto',
                          maxHeight: 150,
                        }}>{JSON.stringify(m.review.steps.map(step => ({ actionId: step.actionId, args: step.args || {} })), null, 2)}</pre>
                      )}
                      <div style={{ marginTop: 12, display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                        <button
                          onClick={() => cancelReview(m.id)}
                          disabled={m.reviewBusy}
                          style={mnAskSecondaryButton(T)}>
                          Cancel
                        </button>
                        <button
                          onClick={() => editReviewArgs(m.id, m.review)}
                          disabled={m.reviewBusy || !!m.review.preview?.markdownPreview}
                          style={mnAskSecondaryButton(T)}>
                          Edit Args
                        </button>
                        <button
                          onClick={() => confirmReview(m.id, m.review)}
                          disabled={m.reviewBusy}
                          style={{
                            ...mnAskPrimaryButton(T),
                            background: m.reviewBusy ? T.bgSub : T.ink,
                            color: m.reviewBusy ? T.inkDim : T.bg,
                            opacity: m.reviewBusy ? 0.7 : 1,
                          }}>
                          {m.reviewBusy ? 'Working...' : 'Confirm'}
                        </button>
                      </div>
                    </div>
                  )}
                  {hasSources && (
                  <div style={{ marginTop: 12, paddingTop: 9, borderTop: `1px solid ${T.lineSub}` }}>
                    <button
                      type="button"
                      onClick={() => toggleSources(m.id)}
                      aria-expanded={sourcesOpen}
                      title={sourcesOpen ? 'Hide sources' : 'Show sources'}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 7,
                        border: `1px solid ${T.lineSub}`,
                        borderRadius: 999,
                        background: sourcesOpen ? T.bgSub : T.bg,
                        color: T.inkDim,
                        cursor: 'pointer',
                        padding: '5px 9px',
                        fontFamily: 'var(--mn-ui)',
                        fontSize: 12,
                      }}>
                      <span style={{ fontFamily: 'var(--mn-mono)', fontSize: 10 }}>
                        {sourcesOpen ? 'v' : '>'}
                      </span>
                      <span>Sources ({m.sources.length})</span>
                    </button>
                    {sourcesOpen && (
                      <div style={{ marginTop: 9 }}>
                        {m.sources.map((s, sourceIndex) => {
                          const sourceId = String(s?.id || '');
                          const isMemorySource = s?.kind === 'memory' || sourceId.startsWith('memory:');
                          const sourceBadge = isMemorySource ? 'from memory' : (s?.kind === 'note' ? 'from notes' : '');
                          const canOpenSource = !isMemorySource && !!sourceId && noteIdSet.has(sourceId);
                          return (
                            <div key={sourceId || sourceIndex}
                              onClick={() => {
                                if (!canOpenSource) return;
                                const opened = onOpenNote?.(sourceId);
                                if (opened !== false && !embedded) onClose && onClose();
                              }}
                              style={{
                                padding: '9px 10px', marginBottom: 6, borderRadius: 7,
                                background: T.bg, border: `1px solid ${T.lineSub}`,
                                cursor: canOpenSource ? 'pointer' : 'default',
                              }}
                              onMouseEnter={e => { if (canOpenSource) e.currentTarget.style.background = T.bgHover; }}
                              onMouseLeave={e => e.currentTarget.style.background = T.bg}>
                              <div style={{ fontSize: 12.5, fontWeight: 500, color: T.ink }}>
                                {sourceIndex + 1}. {s.title}
                                {sourceBadge && (
                                  <span style={{
                                    marginLeft: 6, padding: '1px 6px', borderRadius: 999,
                                    border: `1px solid ${T.lineSub}`, background: T.bgSub,
                                    fontFamily: 'var(--mn-mono)', fontSize: 10, fontWeight: 400,
                                    color: T.inkDim, verticalAlign: 'middle',
                                  }}>{sourceBadge}</span>
                                )}
                              </div>
                              <div style={{
                                fontSize: 12, color: T.inkDim, marginTop: 2,
                                fontFamily: 'var(--mn-body)', lineHeight: 1.5,
                                display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
                                overflow: 'hidden',
                              }}>{s.snippet}</div>
                              {(s.modifiedAt || s.createdAt) && (
                                <div style={{ marginTop: 5, fontFamily: 'var(--mn-mono)', fontSize: 10, color: T.inkDim }}>
                                  {new Date(s.modifiedAt || s.createdAt).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
                {m.restore && (
                  <div style={{
                    marginTop: 10,
                    padding: 10,
                    borderRadius: 8,
                    border: `1px solid ${T.lineSub}`,
                    background: T.bgSub,
                    display: 'flex',
                    gap: 8,
                    alignItems: 'center',
                    flexWrap: 'wrap',
                  }}>
                    <div style={{ flex: 1, minWidth: 180, fontFamily: 'var(--mn-ui)', fontSize: 12.5, color: T.inkMed }}>
                      Previous note body saved for this AI edit.
                    </div>
                    {onRestoreCurrentPageBody && (
                      <button
                        type="button"
                        onClick={() => restoreAiEdit(m.id, m.restore)}
                        disabled={m.restoreBusy}
                        style={mnAskSecondaryButton(T)}>
                        {m.restoreBusy ? 'Restoring...' : 'Undo AI edit'}
                      </button>
                    )}
                    {onOpenCurrentNoteVersions && (
                      <button
                        type="button"
                        onClick={() => openAiEditVersionHistory(m.restore)}
                        style={mnAskSecondaryButton(T)}>
                        Version history
                      </button>
                    )}
                  </div>
                )}
                {canReport && (
                  <div style={{ marginTop: 8, display: 'flex', justifyContent: 'flex-end' }}>
                    <button
                      onClick={() => mnReportAiOutput({ prompt: previousUser, output: m.text, scope: m.action ? 'AI page action' : 'Ask AI answer' })}
                      title="Report this AI output to the configured provider"
                      style={mnAskReportButton(T)}>
                      Report AI output
                    </button>
                  </div>
                )}
                </div>
              </div>
            );})}
            {pending && !messages.some(m => m.streaming) && (
              <div className="mn-ask-ai-shimmer" data-mn-pending-response="true" style={{
                padding: '10px 12px',
                borderRadius: 8,
                background: T.bgSub,
                border: `1px solid ${T.lineSub}`,
                color: T.inkDim,
                fontSize: 12.5,
                fontFamily: 'var(--mn-ui)',
                display: 'flex',
                alignItems: 'center',
                gap: 9,
              }}>
                <span style={{
                  width: 7,
                  height: 7,
                  borderRadius: 999,
                  background: T.accent,
                  boxShadow: `0 0 0 4px color-mix(in oklab, ${T.accent} 14%, transparent)`,
                  flexShrink: 0,
                }} />
                <span style={{ flex: 1 }}>{activeAction || 'Thinking…'}</span>
              </div>
            )}
            {!pending && messages.length === 0 && !error && (
              <div style={{
                border: `1px dashed ${T.line}`,
                borderRadius: 8,
                background: T.bgSub,
                padding: '22px 18px',
                color: T.inkDim,
                fontSize: 12.5,
                lineHeight: 1.6,
                textAlign: 'center',
              }}>
                <div style={{ color: T.inkMed, fontSize: 14, fontWeight: 650, fontFamily: 'var(--mn-ui)', marginBottom: 5 }}>
                  Ask about the vault or ask for a page action.
                </div>
                Answers cite your notes, plus remembered context when the memory bridge is on.
              </div>
            )}
            <div ref={scrollBottomRef} data-mn-chat-bottom="true" style={{ height: 1 }} />
          </div>
        </div>
    );
  
    if (embedded) {
      return (
        <div style={{ flex: 1, minWidth: 0, height: '100%', background: T.bg }}>
          {content}
        </div>
      );
    }
  
    return (
      <div onClick={closeOrBackground} style={{
        position: 'fixed', inset: 0, zIndex: 200,
        background: 'color-mix(in oklab, oklch(0.2 0.02 240) 30%, transparent)',
        display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
        padding: '8vh 24px 24px', animation: 'mnFadeIn 140ms ease',
      }}>
        {content}
      </div>
    );
}

export { AskAiWorkspace };
