// Ask AI: query -> RAG over your notes via local Ollama or configured providers.
// Renders as the main AI workspace and can still run as a compact overlay.

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

const MN_AI_REPORT_TARGETS = {
  openai: {
    label: 'OpenAI',
    url: 'https://help.openai.com/en/articles/10245791-reporting-content-in-chatgpt-and-openai-platforms',
  },
  openrouter: {
    label: 'OpenRouter',
    url: 'https://openrouter.ai/docs/guides/overview/report-feedback',
  },
  anthropic: {
    label: 'Anthropic',
    url: 'mailto:usersafety@anthropic.com?subject=AI%20safety%20feedback',
  },
  gemini: {
    label: 'Gemini',
    url: 'https://support.google.com/gemini/answer/13275746',
  },
  ollama: {
    label: 'Ollama or local model provider',
    url: 'https://github.com/ollama/ollama/issues',
  },
  custom: {
    label: 'Custom provider',
    url: '',
  },
};

async function mnAiProviderReportInfo() {
  let config = null;
  try {
    const status = await window.mn?.ai?.status?.();
    config = status?.value?.config || null;
  } catch (e) {}
  if (!config) {
    try {
      const res = await window.mn?.ai?.getConfig?.();
      config = res?.value || null;
    } catch (e) {}
  }
  const provider = String(config?.provider || 'ollama').toLowerCase();
  const target = MN_AI_REPORT_TARGETS[provider] || MN_AI_REPORT_TARGETS.custom;
  let url = target.url;
  if (!url && provider === 'custom') {
    try {
      const base = new URL(String(config?.customBaseUrl || '').trim());
      url = base.origin;
    } catch (e) {}
  }
  return {
    provider,
    label: target.label,
    model: config?.chatModel || '',
    url,
  };
}

async function mnReportAiOutput({ prompt = '', output = '', scope = 'AI output' } = {}) {
  const info = await mnAiProviderReportInfo();
  const report = [
    `Provider: ${info.label}`,
    info.model ? `Model: ${info.model}` : null,
    `Scope: ${scope}`,
    prompt ? `Prompt:\n${String(prompt).slice(0, 4000)}` : null,
    output ? `Generated output:\n${String(output).slice(0, 8000)}` : null,
  ].filter(Boolean).join('\n\n');
  try { await navigator.clipboard?.writeText(report); } catch (e) {}
  if (info.url && window.mn?.openExternal) {
    const res = await window.mn.openExternal(info.url);
    if (res && res.ok === false) throw new Error(res.error || 'Could not open provider report page');
  }
  return info;
}

window.MN_AI_REPORT = { report: mnReportAiOutput, targets: MN_AI_REPORT_TARGETS };

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
  session, setSession, onBackgroundComplete, initialQuery, T, embedded = false,
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
  const latestResponseIndex = messages.reduce((found, message, index) => (
    message.role === 'assistant' && !message.error && !message.stopped ? index : found
  ), -1);

  useEffectAI(() => {
    inputRef.current?.focus();
    if (window.mn?.ai) {
      window.mn.ai.status().then(r => { if (r.ok) setStatus(r.value); });
    }
  }, []);

  useEffectAI(() => {
    if (!initialQuery) return;
    setQuery(initialQuery);
    setTimeout(() => inputRef.current?.focus(), 0);
  }, [initialQuery]);

  useEffectAI(() => {
    const scrollNode = scrollRef.current;
    if (!scrollNode) return;
    const handle = requestAnimationFrame(() => {
      const target = pending
        ? scrollNode.querySelector('[data-mn-pending-response="true"]')
        : scrollNode.querySelector('[data-mn-latest-response="true"]');
      scrollNode.scrollTop = target
        ? Math.max(0, target.offsetTop - scrollNode.offsetTop - 12)
        : 0;
    });
    return () => cancelAnimationFrame(handle);
  }, [messages.length, pending]);

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
    if (!embedded && e.key === 'Escape') { e.preventDefault(); closeOrBackground(); }
    else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); submit(); }
  };

  const reachable = status?.reachable;
  const chatOk = status?.chatModelOk;
  const embedOk = status?.embedModelOk;
  const canAsk = reachable && chatOk;
  const statusText = mnAskStatusText(status);

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

        <div style={{ order: 3, padding: '14px 18px 16px', borderTop: `1px solid ${T.lineSub}`, background: `color-mix(in oklab, ${T.bg} 88%, ${T.bgSub})`, flexShrink: 0 }}>
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
                : embedded ? '⌘+Enter to ask' : '⌘+Enter to ask · Esc to close'
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

        <div ref={scrollRef} style={{ order: 2, flex: 1, overflow: 'auto', padding: '18px 18px', position: 'relative', background: T.bg }}>
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
          {messages.map((m, idx) => {
            const previousUser = [...messages.slice(0, idx)].reverse().find(item => item.role === 'user')?.text || '';
            const canReport = m.role === 'assistant' && !m.error && !m.stopped && String(m.text || '').trim();
            return (
            <div key={idx} data-mn-latest-response={idx === latestResponseIndex ? 'true' : undefined} style={{
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
                whiteSpace: 'pre-wrap',
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
                  {m.sources.map((s, sourceIndex) => (
                    <div key={s.id}
                      onClick={() => { onOpenNote?.(s.id); onClose && onClose(); }}
                      style={{
                        padding: '9px 10px', marginBottom: 6, borderRadius: 7,
                        background: T.bg, border: `1px solid ${T.lineSub}`,
                        cursor: 'pointer',
                      }}
                      onMouseEnter={e => e.currentTarget.style.background = T.bgHover}
                      onMouseLeave={e => e.currentTarget.style.background = T.bg}>
                      <div style={{ fontSize: 12.5, fontWeight: 500, color: T.ink }}>{sourceIndex + 1}. {s.title}</div>
                      <div style={{
                        fontSize: 12, color: T.inkDim, marginTop: 2,
                        fontFamily: 'var(--mn-body)', lineHeight: 1.5,
                        display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
                        overflow: 'hidden',
                      }}>{s.snippet}</div>
                      {s.modifiedAt && (
                        <div style={{ marginTop: 5, fontFamily: 'var(--mn-mono)', fontSize: 10, color: T.inkDim }}>
                          {new Date(s.modifiedAt).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
              {canReport && (
                <div style={{ marginTop: 8, display: 'flex', justifyContent: 'flex-end' }}>
                  <button
                    onClick={() => window.MN_AI_REPORT?.report?.({ prompt: previousUser, output: m.text, scope: m.action ? 'AI page action' : 'Ask AI answer' })}
                    title="Report this AI output to the configured provider"
                    style={mnAskReportButton(T)}>
                    Report AI output
                  </button>
                </div>
              )}
              </div>
            </div>
          );})}
          {pending && (
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
              Answers cite note sources when they use your notes.
            </div>
          )}
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

function MnAiChatHistory({ sessions = [], activeId = '', onSelect, onNew, onDelete, onArchive, onRename, T }) {
  const [showArchived, setShowArchived] = useStateAI(false);
  const [contextMenu, setContextMenu] = useStateAI(null);
  const [renameId, setRenameId] = useStateAI(null);
  const [renameValue, setRenameValue] = useStateAI('');
  const visibleSessions = sessions
    .filter(session => !!session.archived === showArchived)
    .sort((a, b) => new Date(b.updatedAt || b.createdAt || 0) - new Date(a.updatedAt || a.createdAt || 0));
  const activeCount = sessions.filter(session => !session.archived).length;
  const archivedCount = sessions.filter(session => session.archived).length;

  useEffectAI(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    const closeOnEsc = (e) => { if (e.key === 'Escape') close(); };
    const timer = setTimeout(() => document.addEventListener('mousedown', close), 0);
    document.addEventListener('keydown', closeOnEsc);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', closeOnEsc);
    };
  }, [contextMenu]);

  const openContextMenu = (e, session) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      sessionId: session.id,
      archived: !!session.archived,
    });
  };
  const startRename = (id, currentTitle) => {
    setRenameId(id);
    setRenameValue(currentTitle || '');
    setContextMenu(null);
  };
  const submitRename = () => {
    if (renameId && onRename) onRename(renameId, renameValue.trim() || 'New chat');
    setRenameId(null);
    setRenameValue('');
  };
  const cancelRename = () => {
    setRenameId(null);
    setRenameValue('');
  };

  return (
    <aside style={{
      width: 264,
      height: '100%',
      borderRight: `1px solid ${T.line}`,
      background: T.bgSub,
      display: 'flex',
      flexDirection: 'column',
      flexShrink: 0,
      minWidth: 0,
      position: 'relative',
    }}>
      <div style={{
        padding: '12px 12px 10px',
        borderBottom: `1px solid ${T.lineSub}`,
        display: 'flex',
        alignItems: 'center',
        gap: 8,
      }}>
        <div style={{ minWidth: 0, flex: 1, fontSize: 13, fontWeight: 650, color: T.ink }}>AI chats</div>
        <button onClick={onNew} title="New AI chat" style={iconBtn(T)}>
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7">
            <path d="M8 3V13M3 8H13" strokeLinecap="round"/>
          </svg>
        </button>
      </div>
      <div style={{
        display: 'flex',
        gap: 4,
        padding: '8px 10px 0',
      }}>
        <MnAiTabPill active={!showArchived} onClick={() => setShowArchived(false)} T={T} title="Show active chats">
          Active <span style={{ opacity: 0.55, marginLeft: 3 }}>{activeCount}</span>
        </MnAiTabPill>
        <MnAiTabPill active={showArchived} onClick={() => setShowArchived(true)} T={T} title="Show archived chats">
          Archived <span style={{ opacity: 0.55, marginLeft: 3 }}>{archivedCount}</span>
        </MnAiTabPill>
      </div>
      <div style={{ flex: 1, overflow: 'auto', padding: '8px 8px 10px' }}>
        {visibleSessions.map(session => {
          const active = session.id === activeId;
          const renaming = session.id === renameId;
          const messages = session.messages || [];
          const last = [...messages].reverse().find(m => m.text)?.text || 'No messages yet';
          return (
            <div
              key={session.id}
              onClick={() => { if (!renaming) onSelect?.(session.id); }}
              onContextMenu={(e) => openContextMenu(e, session)}
              onDoubleClick={(e) => {
                if (renaming) return;
                e.preventDefault();
                startRename(session.id, session.title);
              }}
              style={{
                padding: '8px 10px',
                marginBottom: 4,
                borderRadius: 7,
                border: `1px solid ${active ? T.selLine : 'transparent'}`,
                background: active ? T.accentSoft : 'transparent',
                cursor: renaming ? 'default' : 'pointer',
              }}
              onMouseEnter={(e) => { if (!active && !renaming) e.currentTarget.style.background = T.bgHover; }}
              onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = 'transparent'; }}>
              {renaming ? (
                <input
                  autoFocus
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  onClick={(e) => e.stopPropagation()}
                  onBlur={submitRename}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') { e.preventDefault(); submitRename(); }
                    else if (e.key === 'Escape') { e.preventDefault(); cancelRename(); }
                  }}
                  style={{
                    width: '100%',
                    padding: '3px 6px',
                    border: `1px solid ${T.selLine}`,
                    borderRadius: 5,
                    background: T.bg,
                    color: T.ink,
                    fontFamily: 'var(--mn-ui)',
                    fontSize: 12.5,
                    fontWeight: 600,
                    outline: 'none',
                  }}
                />
              ) : (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <div style={{
                    minWidth: 0,
                    flex: 1,
                    fontSize: 12.5,
                    fontWeight: 600,
                    color: active ? T.accent : T.ink,
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}>{session.title || 'New chat'}</div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onArchive?.(session.id, !session.archived);
                    }}
                    title={session.archived ? 'Restore chat' : 'Archive chat'}
                    style={mnAiRowActionButton(T)}>
                    {session.archived ? (
                      <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.55">
                        <path d="M4 7L8 3L12 7" strokeLinecap="round" strokeLinejoin="round"/>
                        <path d="M8 3V12" strokeLinecap="round"/>
                        <path d="M3 12.5H13" strokeLinecap="round"/>
                      </svg>
                    ) : (
                      <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.55">
                        <path d="M3 5.5H13" strokeLinecap="round"/>
                        <path d="M5 5.5V12.5H11V5.5" strokeLinejoin="round"/>
                        <path d="M6 3.5H10" strokeLinecap="round"/>
                      </svg>
                    )}
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onDelete?.(session.id);
                    }}
                    title="Delete chat"
                    style={mnAiRowActionButton(T, true)}>
                    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.55">
                      <path d="M3.5 4.5H12.5" strokeLinecap="round"/>
                      <path d="M6 4.5V3.2H10V4.5" strokeLinejoin="round"/>
                      <path d="M5 6.5L5.5 13H10.5L11 6.5" strokeLinejoin="round"/>
                    </svg>
                  </button>
                </div>
              )}
              <div style={{
                marginTop: 3,
                fontSize: 11.25,
                color: T.inkDim,
                lineHeight: 1.35,
                display: '-webkit-box',
                WebkitLineClamp: 2,
                WebkitBoxOrient: 'vertical',
                overflow: 'hidden',
              }}>{last}</div>
            </div>
          );
        })}
        {!visibleSessions.length && (
          <div style={{
            padding: 16,
            color: T.inkDim,
            fontSize: 12,
            lineHeight: 1.5,
            textAlign: 'center',
          }}>
            {showArchived ? 'No archived chats' : 'No chats yet — start one with “New”.'}
          </div>
        )}
      </div>
      {!showArchived && (
        <div style={{
          padding: '8px 12px 10px',
          borderTop: `1px solid ${T.lineSub}`,
          fontFamily: 'var(--mn-mono)',
          fontSize: 9.5,
          color: T.inkDim,
          textAlign: 'center',
        }}>
          Use the row buttons or right-click for chat actions
        </div>
      )}
      {contextMenu && (
        <div
          role="menu"
          onMouseDown={(e) => e.stopPropagation()}
          style={{
            position: 'fixed',
            top: contextMenu.y,
            left: contextMenu.x,
            zIndex: 60,
            background: T.bg,
            border: `1px solid ${T.line}`,
            borderRadius: 6,
            padding: 4,
            minWidth: 160,
            boxShadow: `0 12px 28px color-mix(in oklab, ${T.ink} 18%, transparent)`,
          }}>
          <MnAiContextMenuItem
            T={T}
            onClick={() => {
              const sess = sessions.find(s => s.id === contextMenu.sessionId);
              startRename(contextMenu.sessionId, sess?.title || '');
            }}>
            Rename
          </MnAiContextMenuItem>
          <MnAiContextMenuItem
            T={T}
            onClick={() => {
              onArchive?.(contextMenu.sessionId, !contextMenu.archived);
              setContextMenu(null);
            }}>
            {contextMenu.archived ? 'Restore chat' : 'Archive chat'}
          </MnAiContextMenuItem>
          <MnAiContextMenuItem
            T={T}
            danger
            onClick={() => {
              onDelete?.(contextMenu.sessionId);
              setContextMenu(null);
            }}>
            Delete chat
          </MnAiContextMenuItem>
        </div>
      )}
    </aside>
  );
}

function MnAiTabPill({ active, onClick, children, T, title }) {
  return (
    <button
      onClick={onClick}
      title={title}
      style={{
        flex: 1,
        padding: '5px 9px',
        border: `1px solid ${active ? T.selLine : T.lineSub}`,
        background: active ? T.accentSoft : T.bg,
        color: active ? T.accent : T.inkMed,
        borderRadius: 6,
        fontFamily: 'var(--mn-ui)',
        fontSize: 11.5,
        fontWeight: 600,
        cursor: 'pointer',
      }}>
      {children}
    </button>
  );
}

function mnAiRowActionButton(T, danger = false) {
  return {
    width: 24,
    height: 24,
    border: `1px solid ${T.lineSub}`,
    borderRadius: 5,
    background: T.bg,
    color: danger ? (T.danger || T.warn || T.inkDim) : T.inkDim,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    flexShrink: 0,
  };
}

function MnAiContextMenuItem({ onClick, disabled, danger, children, T }) {
  const color = disabled
    ? T.inkDim
    : danger
      ? (T.danger || T.warn || T.ink)
      : T.ink;
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        display: 'block',
        width: '100%',
        textAlign: 'left',
        padding: '7px 10px',
        background: 'transparent',
        border: 'none',
        cursor: disabled ? 'default' : 'pointer',
        color,
        fontFamily: 'var(--mn-ui)',
        fontSize: 12.5,
        borderRadius: 4,
        opacity: disabled ? 0.5 : 1,
      }}
      onMouseEnter={(e) => { if (!disabled) e.currentTarget.style.background = T.bgHover; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}>
      {children}
    </button>
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
function mnAskReportButton(T) {
  return {
    border: `1px solid ${T.lineSub}`,
    background: T.bg,
    color: T.inkDim,
    borderRadius: 6,
    padding: '4px 8px',
    fontFamily: 'var(--mn-ui)',
    fontSize: 11.5,
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
window.MnAiChatHistory = MnAiChatHistory;
