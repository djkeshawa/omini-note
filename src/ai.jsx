// Ask-AI modal: query → RAG over your notes via local Ollama.
// Lives as an overlay (similar to MnSettingsModal / MnQuickCapture).

const { useState: useStateAI, useEffect: useEffectAI, useRef: useRefAI } = React;

const MN_ASK_EDIT_ACTIONS = {
  format: 'Format and organize this page. Preserve meaning, markdown, wiki-links, tags, tasks, and headings.',
  improve: 'Improve the writing on this page. Preserve meaning, markdown, wiki-links, tags, tasks, and headings.',
  summarize: 'Summarize this page concisely. Preserve concrete decisions, tasks, dates, and named references.',
  concise: 'Make this page more concise while preserving important meaning and markdown structure.',
  fix: 'Fix spelling, grammar, and punctuation only. Do not rewrite more than necessary.',
  link: 'Add useful wiki-links using the existing note titles provided below. Preserve the page structure and do not add unrelated links.',
};

const MN_ASK_SUGGESTIONS = [
  'What changed most recently in this vault?',
  'Summarize open tasks from my notes',
  'Create a page called Launch checklist',
  'Format this page and link things together',
];

function mnAskAiJobId() {
  return `ask_${Date.now().toString(36)}_${Math.floor(Math.random() * 100000).toString(36)}`;
}

function mnAskStatusText(status) {
  if (!status) return 'Checking local AI';
  if (!status.reachable) return 'Ollama is offline';
  if (!status.chatModelOk) return `Missing ${status?.config?.chatModel || 'chat model'}`;
  if (!status.embedModelOk) return 'Keyword search mode';
  return 'Semantic search ready';
}

function MnAskAI({
  vaultId, currentNote, allNotes, onClose, onOpenNote, onCreateNote, onApplyCurrentPageBody,
  session, setSession, onBackgroundComplete, T,
}) {
  const [query, setQuery] = useStateAI('');
  const [status, setStatus] = useStateAI(null);
  const [localSession, setLocalSession] = useStateAI({
    messages: [],
    pending: false,
    error: null,
    activeAction: null,
    background: false,
  });
  const inputRef = useRefAI(null);
  const scrollRef = useRefAI(null);
  const backgroundRef = useRefAI(false);
  const stoppedJobRef = useRefAI(null);

  const aiSession = session || localSession;
  const updateSession = setSession || setLocalSession;
  const messages = aiSession.messages || [];
  const pending = !!aiSession.pending;
  const error = aiSession.error || null;
  const activeAction = aiSession.activeAction || null;
  const lastAssistant = [...messages].reverse().find(m => m.role === 'assistant' && !m.error);
  const latestSourceCount = lastAssistant?.sources?.length || 0;

  useEffectAI(() => {
    inputRef.current?.focus();
    if (window.mn?.ai) {
      window.mn.ai.status().then(r => { if (r.ok) setStatus(r.value); });
    }
  }, []);

  useEffectAI(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, pending]);

  const setActiveAction = (label) => {
    updateSession(prev => ({ ...(prev || {}), activeAction: label }));
  };

  const closeOrBackground = () => {
    if (pending) {
      backgroundRef.current = true;
      updateSession(prev => ({ ...(prev || {}), background: true }));
    }
    onClose && onClose();
  };

  const detectAction = (q) => {
    const s = q.toLowerCase();
    const quoted = q.match(/["“']([^"”']+)["”']/)?.[1];
    if (/\b(create|make|new)\b.*\b(page|note)\b/.test(s)) {
      const title =
        quoted ||
        q.match(/\b(?:called|titled|named)\s+(.+)$/i)?.[1]?.trim().replace(/[.?!]$/, '') ||
        q.match(/\b(?:page|note)\s+(?:about|for)\s+(.+)$/i)?.[1]?.trim().replace(/[.?!]$/, '') ||
        'AI draft';
      return { type: 'create-note', title };
    }
    if (/\b(link|wikilink|connect)\b.*\b(page|note|this|things|together)\b/.test(s)) {
      const wantsFormat = /\b(format|clean up|organize|improve|polish)\b/.test(s);
      return { type: 'edit-current', action: wantsFormat ? 'format-link' : 'link' };
    }
    if (/\b(format|clean up|organize)\b.*\b(page|note|this|current)\b/.test(s)) {
      return { type: 'edit-current', action: 'format' };
    }
    if (/\b(improve|rewrite|polish)\b.*\b(page|note|writing|this|current)\b/.test(s)) {
      return { type: 'edit-current', action: 'improve' };
    }
    if (/\b(summarize|summary)\b.*\b(page|note|this|current)\b/.test(s)) {
      return { type: 'edit-current', action: 'summarize' };
    }
    if (/\b(concise|shorten)\b.*\b(page|note|this|current)\b/.test(s)) {
      return { type: 'edit-current', action: 'concise' };
    }
    if (/\b(fix|correct)\b.*\b(grammar|spelling|page|note|this|current)\b/.test(s)) {
      return { type: 'edit-current', action: 'fix' };
    }
    return null;
  };

  const classifyPrompt = (q) => {
    const action = detectAction(q);
    if (action) return { type: 'action', action };
    const s = q.toLowerCase().trim();
    const normalized = s.replace(/[!?.\s]+$/g, '');
    if (/^(hi|hello|hey|yo|sup|thanks|thank you|ok|okay|cool|nice|good morning|good afternoon|good evening)$/.test(normalized)) {
      return { type: 'chat' };
    }
    if (/\b(who are you|what can you do|help|how do you work|what are your capabilities)\b/.test(s)) {
      return { type: 'chat' };
    }
    if (/\b(my|this|current|latest|recent|last|note|notes|page|pages|vault|tag|tags|task|tasks|todo|todos|reminder|reminders|decide|decided|wrote|writing|link|links|backlink|backlinks|summarize.*notes|search)\b/.test(s)) {
      return { type: 'notes' };
    }
    return { type: 'notes' };
  };

  const askEdit = async ({ text, instruction, scope, jobId }) => {
    const r = await window.mn.ai.edit({ text, instruction, scope, jobId });
    if (!r.ok) throw new Error(r.error || 'AI action failed');
    if (r.value && !r.value.ok) throw new Error(r.value.error || 'AI action failed');
    return r.value.text;
  };

  const runAction = async (q, action, jobId) => {
    if (action.type === 'create-note') {
      if (!onCreateNote) throw new Error('Page creation is not available here');
      setActiveAction('Creating page...');
      const body = await askEdit({
        scope: 'new page',
        instruction: 'Create a useful markdown note body for this request. Return only the body; do not include a title heading unless it adds value.',
        text: q,
        jobId,
      });
      const id = onCreateNote({ title: action.title || 'AI draft', body });
      return { answer: `Created page "${action.title || 'AI draft'}".`, sources: id ? [{ id, title: action.title || 'AI draft', snippet: body.slice(0, 200) }] : [] };
    }

    if (action.type === 'edit-current') {
      if (!currentNote || !onApplyCurrentPageBody) throw new Error('No current page is open to edit');
      setActiveAction(action.action === 'link' ? 'Linking page...' : 'Editing page...');
      const body = currentNote.body || window.MN_OUTLINE.mnBlocksToMd(currentNote.blocks || []);
      const noteTitles = (allNotes || [])
        .filter(n => n.id !== currentNote.id)
        .map(n => `- ${n.title}`)
        .join('\n');
      const instruction = action.action === 'link' || action.action === 'format-link'
        ? `${action.action === 'format-link' ? MN_ASK_EDIT_ACTIONS.format + '\n\n' : ''}${MN_ASK_EDIT_ACTIONS.link}\n\nExisting note titles:\n${noteTitles}`
        : MN_ASK_EDIT_ACTIONS[action.action];
      const edited = await askEdit({ scope: 'current page', instruction, text: body, jobId });
      onApplyCurrentPageBody(edited);
      return { answer: `${action.action === 'link' || action.action === 'format-link' ? 'Linked' : 'Updated'} "${currentNote.title}".`, sources: [{ id: currentNote.id, title: currentNote.title, snippet: edited.slice(0, 200) }] };
    }

    return null;
  };

  const submit = async () => {
    const q = query.trim();
    if (!q || pending) return;
    const jobId = mnAskAiJobId();
    const route = classifyPrompt(q);
    const priorMessages = messages;
    const userMsg = { role: 'user', text: q };
    backgroundRef.current = false;
    stoppedJobRef.current = null;
    updateSession(prev => ({
      ...(prev || {}),
      messages: [...(prev?.messages || []), userMsg],
      pending: true,
      error: null,
      activeAction: route.type === 'notes' ? 'Searching notes...' : route.type === 'chat' ? 'Thinking...' : 'Starting task...',
      background: false,
      jobId,
      lastQuery: q,
      completedAt: null,
    }));
    setQuery('');
    let finalError = null;
    let stopped = false;
    try {
      if (route.type === 'action') {
        const actionResult = await runAction(q, route.action, jobId);
        if (stoppedJobRef.current === jobId) return;
        updateSession(prev => ({
          ...(prev || {}),
          messages: [...(prev?.messages || []), { role: 'assistant', text: actionResult.answer, sources: actionResult.sources || [], action: true }],
        }));
      } else if (route.type === 'notes') {
        setActiveAction('Searching notes...');
        const qForAsk = priorMessages.length
          ? `Conversation so far:\n${priorMessages.slice(-6).map(m => `${m.role}: ${m.text}`).join('\n')}\n\nCurrent question: ${q}`
          : q;
        const r = await window.mn.ai.ask(vaultId, qForAsk, { jobId });
        if (stoppedJobRef.current === jobId) return;
        if (!r.ok) {
          throw new Error(r.error || 'Unknown error');
        } else if (r.value && !r.value.ok) {
          throw new Error(r.value.error || 'Unknown error');
        } else {
          updateSession(prev => ({
            ...(prev || {}),
            messages: [...(prev?.messages || []), { role: 'assistant', text: r.value.answer, sources: r.value.sources || [] }],
          }));
        }
      } else {
        setActiveAction('Thinking...');
        const chatMessages = [
          ...priorMessages.slice(-6).map(m => ({ role: m.role, content: m.text })),
          { role: 'user', content: q },
        ];
        const r = await window.mn.ai.chat({ messages: chatMessages, jobId });
        if (stoppedJobRef.current === jobId) return;
        if (!r.ok) throw new Error(r.error || 'Unknown error');
        if (r.value && !r.value.ok) throw new Error(r.value.error || 'Unknown error');
        updateSession(prev => ({
          ...(prev || {}),
          messages: [...(prev?.messages || []), { role: 'assistant', text: r.value.answer }],
        }));
      }
    } catch (e) {
      const msg = e.message || String(e);
      stopped = stoppedJobRef.current === jobId || /abort|cancel/i.test(msg);
      if (stopped) return;
      finalError = msg;
      updateSession(prev => ({
        ...(prev || {}),
        error: msg,
        messages: [...(prev?.messages || []), { role: 'assistant', text: msg, error: true }],
      }));
    } finally {
      if (!stopped && stoppedJobRef.current !== jobId) {
        updateSession(prev => ({
          ...(prev || {}),
          pending: false,
          activeAction: null,
          jobId: null,
          completedAt: new Date().toISOString(),
        }));
      }
      if (!stopped && stoppedJobRef.current !== jobId && backgroundRef.current) {
        onBackgroundComplete && onBackgroundComplete({ query: q, error: finalError });
      }
    }
  };

  const stopRun = async () => {
    const jobId = aiSession.jobId;
    if (!pending || !jobId) return;
    stoppedJobRef.current = jobId;
    backgroundRef.current = false;
    try { await window.mn?.ai?.cancel?.(jobId); } catch (e) {}
    updateSession(prev => ({
      ...(prev || {}),
      pending: false,
      activeAction: null,
      background: false,
      jobId: null,
      error: null,
      completedAt: new Date().toISOString(),
      messages: [...(prev?.messages || []), { role: 'assistant', text: 'Stopped.', stopped: true }],
    }));
  };

  const clearConversation = () => {
    if (pending) return;
    updateSession(prev => ({
      ...(prev || {}),
      messages: [],
      error: null,
      activeAction: null,
      background: false,
      jobId: null,
      completedAt: null,
      lastQuery: null,
    }));
    setQuery('');
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  const pickSuggestion = (text) => {
    setQuery(text);
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  const onKey = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); closeOrBackground(); }
    else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); submit(); }
  };

  const reachable = status?.reachable;
  const chatOk = status?.chatModelOk;
  const embedOk = status?.embedModelOk;
  const canAsk = reachable && chatOk;
  const statusText = mnAskStatusText(status);

  return (
    <div onClick={closeOrBackground} style={{
      position: 'fixed', inset: 0, zIndex: 200,
      background: 'color-mix(in oklab, oklch(0.2 0.02 240) 30%, transparent)',
      display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
      padding: '8vh 24px 24px', animation: 'mnFadeIn 140ms ease',
    }}>
      <div onClick={e => e.stopPropagation()} onKeyDown={onKey} style={{
        width: '100%', maxWidth: 820, maxHeight: '86vh',
        background: T.bg, color: T.ink, borderRadius: 12,
        border: `1px solid ${T.line}`,
        boxShadow: `0 24px 60px color-mix(in oklab, ${T.ink} 30%, transparent)`,
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
        animation: 'mnSlideDown 160ms ease',
      }}>
        <div style={{
          padding: '15px 18px 12px',
          borderBottom: `1px solid ${T.lineSub}`,
          background: `linear-gradient(180deg, ${T.bg}, color-mix(in oklab, ${T.bgSub} 48%, ${T.bg}))`,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{
              width: 34,
              height: 34,
              borderRadius: 8,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: T.accent,
              background: T.accentSoft,
              border: `1px solid ${T.selLine}`,
              flexShrink: 0,
            }}>
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.45">
                <path d="M8 2.4L9.1 5.9L12.6 7L9.1 8.1L8 11.6L6.9 8.1L3.4 7L6.9 5.9L8 2.4Z" strokeLinejoin="round" />
                <path d="M12.4 10.4L13 12L14.6 12.6L13 13.2L12.4 14.8L11.8 13.2L10.2 12.6L11.8 12L12.4 10.4Z" strokeLinejoin="round" />
              </svg>
            </div>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: T.ink }}>Ask AI</div>
              <div style={{
                marginTop: 2,
                fontFamily: 'var(--mn-mono)',
                fontSize: 10.5,
                color: T.inkDim,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
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
            <button onClick={closeOrBackground} title={pending ? 'Run in background' : 'Close (Esc)'} style={iconBtn(T)}>
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6">
                <path d="M4 4L12 12M12 4L4 12" strokeLinecap="round"/>
              </svg>
            </button>
          </div>
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
            gap: 8,
            marginTop: 12,
          }}>
            <MnAskInfoChip label="Vault context" value={`${(allNotes || []).length} note${(allNotes || []).length === 1 ? '' : 's'}`} T={T} />
            <MnAskInfoChip label="Current page" value={currentNote?.title || 'None open'} T={T} />
            <MnAskInfoChip label="Latest answer" value={latestSourceCount ? `${latestSourceCount} source${latestSourceCount === 1 ? '' : 's'}` : messages.length ? 'No sources' : 'Not asked yet'} T={T} />
          </div>
        </div>

        <div style={{ padding: '14px 18px 12px', borderBottom: `1px solid ${T.lineSub}` }}>
          <textarea
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Ask anything about your notes…"
            rows={3}
            style={{
              width: '100%', resize: 'none',
              border: `1px solid ${T.lineSub}`,
              borderRadius: 8, padding: '11px 12px',
              fontFamily: 'var(--mn-body)', fontSize: 14.5,
              background: T.bgSub, color: T.ink, outline: 'none',
              lineHeight: 1.45,
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
              {reachable === false
                ? 'Ollama not running — start it with `ollama serve`'
                : (!chatOk && status)
                  ? `Chat model not installed: \`ollama pull ${status?.config?.chatModel}\``
                : (!embedOk && status)
                    ? `Using keyword search. For semantic search: \`ollama pull ${status?.config?.embedModel}\``
                    : '⌘+Enter to ask · Esc to close'
              }
            </div>
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

        <div ref={scrollRef} style={{ flex: 1, overflow: 'auto', padding: '16px 18px', position: 'relative', background: T.bg }}>
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
          {messages.map((m, idx) => (
            <div key={idx} style={{
              marginBottom: 14,
              display: 'flex',
              justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start',
            }}>
              <div style={{
                maxWidth: m.role === 'user' ? '78%' : '88%',
                padding: m.role === 'user' ? '8px 11px' : '11px 13px',
                borderRadius: 8,
                background: m.role === 'user' ? T.ink : T.bgSub,
                color: m.role === 'user' ? T.bg : (m.error ? (T.warn || '#c33') : T.ink),
                border: m.role === 'user' ? 'none' : `1px solid ${T.lineSub}`,
                fontFamily: 'var(--mn-body)', fontSize: 14.5, lineHeight: 1.6,
                whiteSpace: 'pre-wrap',
                boxShadow: m.role === 'user' ? 'none' : `0 8px 24px color-mix(in oklab, ${T.ink} 5%, transparent)`,
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
                    {m.error ? 'Error' : m.stopped ? 'Stopped' : m.action ? 'Action' : 'Answer'}
                  </div>
                )}
                {m.text}
                {m.sources?.length > 0 && (
                <div style={{ marginTop: 12, paddingTop: 10, borderTop: `1px solid ${T.lineSub}` }}>
                  <div style={{
                    fontFamily: 'var(--mn-mono)', fontSize: 10,
                    letterSpacing: '0.12em', textTransform: 'uppercase',
                    color: T.inkDim, marginBottom: 8,
                  }}>Sources</div>
                  {m.sources.map(s => (
                    <div key={s.id}
                      onClick={() => { onOpenNote?.(s.id); onClose(); }}
                      style={{
                        padding: '9px 10px', marginBottom: 6, borderRadius: 7,
                        background: T.bg, border: `1px solid ${T.lineSub}`,
                        cursor: 'pointer',
                      }}
                      onMouseEnter={e => e.currentTarget.style.background = T.bgHover}
                      onMouseLeave={e => e.currentTarget.style.background = T.bg}>
                      <div style={{ fontSize: 12.5, fontWeight: 500, color: T.ink }}>{s.title}</div>
                      <div style={{
                        fontSize: 12, color: T.inkDim, marginTop: 2,
                        fontFamily: 'var(--mn-body)', lineHeight: 1.5,
                        display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
                        overflow: 'hidden',
                      }}>{s.snippet}</div>
                    </div>
                  ))}
                </div>
              )}
              </div>
            </div>
          ))}
          {pending && (
            <div className="mn-ask-ai-shimmer" style={{
              padding: 13,
              borderRadius: 8,
              background: `linear-gradient(90deg, ${T.bgSub}, color-mix(in oklab, ${T.accent || T.ink} 5%, ${T.bgSub}), ${T.bgSub})`,
              border: `1px solid ${T.lineSub}`,
              color: T.inkDim,
              fontSize: 13,
              fontFamily: 'var(--mn-ui)',
              display: 'flex',
              alignItems: 'center',
              gap: 10,
            }}>
              <span style={{
                width: 8,
                height: 8,
                borderRadius: 999,
                background: T.accent,
                boxShadow: `0 0 0 5px color-mix(in oklab, ${T.accent} 12%, transparent)`,
                flexShrink: 0,
              }} />
              <span style={{ flex: 1 }}>{activeAction || 'Thinking...'}</span>
              <button onClick={stopRun} style={{ ...mnAskSecondaryButton(T), height: 28, padding: '0 10px' }}>Stop</button>
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
              Answers cite note sources when they use your notes.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function StatusPill({ status, T }) {
  if (!status) return (
    <Pill T={T} color={T.inkDim}>checking…</Pill>
  );
  if (!status.reachable) return (
    <Pill T={T} color="#c33">offline</Pill>
  );
  if (!status.chatModelOk) return (
    <Pill T={T} color="#a60">model missing</Pill>
  );
  if (!status.embedModelOk) return (
    <Pill T={T} color="#a60">keyword mode</Pill>
  );
  return <Pill T={T} color="#070">ready</Pill>;
}
function MnAskInfoChip({ label, value, T }) {
  return (
    <div style={{
      minWidth: 0,
      border: `1px solid ${T.lineSub}`,
      borderRadius: 7,
      background: `color-mix(in oklab, ${T.bg} 78%, ${T.bgSub})`,
      padding: '7px 9px',
    }}>
      <div style={{
        fontFamily: 'var(--mn-mono)',
        fontSize: 9.5,
        color: T.inkDim,
        textTransform: 'uppercase',
        letterSpacing: '0.08em',
        marginBottom: 3,
      }}>{label}</div>
      <div style={{
        fontFamily: 'var(--mn-ui)',
        fontSize: 12.5,
        color: T.inkMed,
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
      }}>{value}</div>
    </div>
  );
}
function Pill({ T, color, children }) {
  return (
    <span style={{
      fontSize: 10, fontFamily: 'var(--mn-mono)', textTransform: 'uppercase',
      letterSpacing: '0.08em', padding: '2px 7px', borderRadius: 99,
      border: `1px solid ${T.lineSub}`, color,
      background: T.bgSub,
    }}>{children}</span>
  );
}
function mnAskPrimaryButton(T) {
  return {
    padding: '7px 14px',
    borderRadius: 6,
    border: `1px solid ${T.line}`,
    fontFamily: 'var(--mn-ui)',
    fontSize: 12.5,
    fontWeight: 650,
  };
}
function mnAskSecondaryButton(T) {
  return {
    padding: '7px 12px',
    borderRadius: 6,
    border: `1px solid ${T.line}`,
    background: T.bg,
    color: T.inkMed,
    fontFamily: 'var(--mn-ui)',
    fontSize: 12.5,
    fontWeight: 550,
    cursor: 'pointer',
  };
}
function iconBtn(T) {
  return {
    width: 24, height: 24, borderRadius: 5,
    border: `1px solid ${T.lineSub}`, background: T.bg, color: T.inkMed,
    cursor: 'pointer', padding: 0,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  };
}

window.MnAskAI = MnAskAI;
