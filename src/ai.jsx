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

function MnAskAI({ vaultId, currentNote, allNotes, onClose, onOpenNote, onCreateNote, onApplyCurrentPageBody, T }) {
  const [query, setQuery] = useStateAI('');
  const [status, setStatus] = useStateAI(null);
  const [pending, setPending] = useStateAI(false);
  const [messages, setMessages] = useStateAI([]);
  const [error, setError] = useStateAI(null);
  const [activeAction, setActiveAction] = useStateAI(null);
  const inputRef = useRefAI(null);
  const scrollRef = useRefAI(null);

  useEffectAI(() => {
    inputRef.current?.focus();
    if (window.mn?.ai) {
      window.mn.ai.status().then(r => { if (r.ok) setStatus(r.value); });
    }
  }, []);

  useEffectAI(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, pending]);

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

  const askEdit = async ({ text, instruction, scope }) => {
    const r = await window.mn.ai.edit({ text, instruction, scope });
    if (!r.ok) throw new Error(r.error || 'AI action failed');
    if (r.value && !r.value.ok) throw new Error(r.value.error || 'AI action failed');
    return r.value.text;
  };

  const runAction = async (q, action) => {
    if (action.type === 'create-note') {
      if (!onCreateNote) throw new Error('Page creation is not available here');
      setActiveAction('Creating page...');
      const body = await askEdit({
        scope: 'new page',
        instruction: 'Create a useful markdown note body for this request. Return only the body; do not include a title heading unless it adds value.',
        text: q,
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
      const edited = await askEdit({ scope: 'current page', instruction, text: body });
      onApplyCurrentPageBody(edited);
      return { answer: `${action.action === 'link' || action.action === 'format-link' ? 'Linked' : 'Updated'} "${currentNote.title}".`, sources: [{ id: currentNote.id, title: currentNote.title, snippet: edited.slice(0, 200) }] };
    }

    return null;
  };

  const submit = async () => {
    const q = query.trim();
    if (!q || pending) return;
    const route = classifyPrompt(q);
    const priorMessages = messages;
    const userMsg = { role: 'user', text: q };
    setMessages(prev => [...prev, userMsg]);
    setQuery('');
    setPending(true); setError(null);
    try {
      if (route.type === 'action') {
        const actionResult = await runAction(q, route.action);
        setMessages(prev => [...prev, { role: 'assistant', text: actionResult.answer, sources: actionResult.sources || [], action: true }]);
      } else if (route.type === 'notes') {
        setActiveAction('Searching notes...');
        const qForAsk = priorMessages.length
          ? `Conversation so far:\n${priorMessages.slice(-6).map(m => `${m.role}: ${m.text}`).join('\n')}\n\nCurrent question: ${q}`
          : q;
        const r = await window.mn.ai.ask(vaultId, qForAsk);
        if (!r.ok) {
          throw new Error(r.error || 'Unknown error');
        } else if (r.value && !r.value.ok) {
          throw new Error(r.value.error || 'Unknown error');
        } else {
          setMessages(prev => [...prev, { role: 'assistant', text: r.value.answer, sources: r.value.sources || [] }]);
        }
      } else {
        setActiveAction('Thinking...');
        const chatMessages = [
          ...priorMessages.slice(-6).map(m => ({ role: m.role, content: m.text })),
          { role: 'user', content: q },
        ];
        const r = await window.mn.ai.chat({ messages: chatMessages });
        if (!r.ok) throw new Error(r.error || 'Unknown error');
        if (r.value && !r.value.ok) throw new Error(r.value.error || 'Unknown error');
        setMessages(prev => [...prev, { role: 'assistant', text: r.value.answer }]);
      }
    } catch (e) {
      const msg = e.message || String(e);
      setError(msg);
      setMessages(prev => [...prev, { role: 'assistant', text: msg, error: true }]);
    } finally {
      setPending(false);
      setActiveAction(null);
    }
  };

  const onKey = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); onClose(); }
    else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); submit(); }
  };

  const reachable = status?.reachable;
  const chatOk = status?.chatModelOk;
  const embedOk = status?.embedModelOk;
  const canAsk = reachable && chatOk;

  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, zIndex: 200,
      background: 'color-mix(in oklab, oklch(0.2 0.02 240) 30%, transparent)',
      display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
      padding: '14vh 24px 24px', animation: 'mnFadeIn 140ms ease',
    }}>
      <div onClick={e => e.stopPropagation()} onKeyDown={onKey} style={{
        width: '100%', maxWidth: 720, maxHeight: '76vh',
        background: T.bg, color: T.ink, borderRadius: 12,
        border: `1px solid ${T.line}`,
        boxShadow: `0 24px 60px color-mix(in oklab, ${T.ink} 30%, transparent)`,
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
        animation: 'mnSlideDown 160ms ease',
      }}>
        {/* Header / status */}
        <div style={{
          padding: '14px 18px', borderBottom: `1px solid ${T.lineSub}`,
          display: 'flex', alignItems: 'center', gap: 10,
        }}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
            <circle cx="8" cy="8" r="5.5" /><path d="M8 5V8.5L10 10" strokeLinecap="round"/>
          </svg>
          <div style={{ flex: 1, fontSize: 13, fontWeight: 600 }}>Ask your notes</div>
          <StatusPill status={status} T={T} />
          <button onClick={onClose} title="Close (Esc)" style={iconBtn(T)}>
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6">
              <path d="M4 4L12 12M12 4L4 12" strokeLinecap="round"/>
            </svg>
          </button>
        </div>

        {/* Input */}
        <div style={{ padding: '14px 18px', borderBottom: `1px solid ${T.lineSub}` }}>
          <textarea
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Ask anything about your notes…"
            rows={2}
            style={{
              width: '100%', resize: 'none',
              border: `1px solid ${T.lineSub}`,
              borderRadius: 8, padding: '10px 12px',
              fontFamily: 'var(--mn-body)', fontSize: 14.5,
              background: T.bgSub, color: T.ink, outline: 'none',
              lineHeight: 1.45,
            }}
          />
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
                padding: '7px 14px', borderRadius: 6,
                border: `1px solid ${T.line}`,
                background: pending ? T.bgSub : T.ink,
                color: pending ? T.inkDim : T.bg,
                fontFamily: 'var(--mn-ui)', fontSize: 12.5, fontWeight: 500,
                cursor: pending || !query.trim() || !canAsk ? 'not-allowed' : 'pointer',
                opacity: pending || !query.trim() || !canAsk ? 0.6 : 1,
              }}>
              {pending ? 'Thinking…' : 'Ask'}
            </button>
          </div>
        </div>

        {/* Conversation */}
        <div ref={scrollRef} style={{ flex: 1, overflow: 'auto', padding: '14px 18px', position: 'relative' }}>
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
              marginBottom: 12,
              display: 'flex',
              justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start',
            }}>
              <div style={{
                maxWidth: '88%',
                padding: m.role === 'user' ? '8px 10px' : '10px 12px',
                borderRadius: 8,
                background: m.role === 'user' ? T.ink : T.bgSub,
                color: m.role === 'user' ? T.bg : (m.error ? (T.warn || '#c33') : T.ink),
                border: m.role === 'user' ? 'none' : `1px solid ${T.lineSub}`,
                fontFamily: 'var(--mn-body)', fontSize: 14.5, lineHeight: 1.6,
                whiteSpace: 'pre-wrap',
              }}>
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
                        padding: '8px 10px', marginBottom: 4, borderRadius: 6,
                        background: T.bgSub, border: `1px solid ${T.lineSub}`,
                        cursor: 'pointer',
                      }}
                      onMouseEnter={e => e.currentTarget.style.background = T.bgHover}
                      onMouseLeave={e => e.currentTarget.style.background = T.bgSub}>
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
              padding: 12,
              borderRadius: 8,
              background: `linear-gradient(90deg, ${T.bgSub}, color-mix(in oklab, ${T.accent || T.ink} 5%, ${T.bgSub}), ${T.bgSub})`,
              border: `1px solid ${T.lineSub}`,
              color: T.inkDim,
              fontSize: 13,
              fontFamily: 'var(--mn-ui)',
            }}>
              {activeAction || 'Thinking...'}
            </div>
          )}
          {!pending && messages.length === 0 && !error && (
            <div style={{ color: T.inkDim, fontSize: 12.5, lineHeight: 1.6 }}>
              <div style={{ marginBottom: 8 }}>Try things like:</div>
              <div style={{ paddingLeft: 8 }}>
                · <i>What did I decide about the graph overlay?</i><br/>
                · <i>Create a page called Launch checklist</i><br/>
                · <i>Format this page and link things together</i>
              </div>
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
function iconBtn(T) {
  return {
    width: 24, height: 24, borderRadius: 5,
    border: `1px solid ${T.lineSub}`, background: T.bg, color: T.inkMed,
    cursor: 'pointer', padding: 0,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  };
}

window.MnAskAI = MnAskAI;
