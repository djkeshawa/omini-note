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

const MN_AI_PLANNER_TIMEOUT_MS = 8000;
const MN_AI_CHAT_TIMEOUT_MS = 45000;
const MN_AI_NOTES_TIMEOUT_MS = 90000;

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

const MN_AI_VIRTUAL_TOOLS = [
  {
    name: 'answer-notes',
    title: 'Answer from notes',
    description: 'Answer a question by searching and reading the active vault notes. Use when the user asks about their notes, pages, tasks, tags, decisions, dates, links, or vault content.',
    risk: 'safe',
    readOnly: true,
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', maxLength: 2000 },
      },
      required: ['query'],
      additionalProperties: false,
    },
  },
  {
    name: 'edit-current-page',
    title: 'Edit current page',
    description: 'Rewrite, format, summarize, improve, fix grammar, or link the currently open page. Use only when the user explicitly asks to change the current page.',
    risk: 'safe',
    readOnly: false,
    inputSchema: {
      type: 'object',
      properties: {
        instruction: { type: 'string', maxLength: 4000 },
      },
      required: ['instruction'],
      additionalProperties: false,
    },
  },
];

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

function mnAskMessageId(role = 'message') {
  const id = globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `${role}-${String(id).replace(/[^a-zA-Z0-9_-]/g, '')}`;
}

function mnNormalizeAskMessages(messages = []) {
  return (messages || []).map(m => m?.id ? m : { ...(m || {}), id: mnAskMessageId(m?.role || 'message') });
}

function mnAskMessageThreadText(message = {}) {
  const text = String(message.text || message.content || '').trim();
  const sources = Array.isArray(message.sources) ? message.sources : [];
  const sourceText = sources.slice(0, 5)
    .map(source => {
      const title = String(source?.title || source?.id || '').trim();
      const snippet = String(source?.snippet || '').trim();
      return title ? `- ${title}${snippet ? `: ${snippet}` : ''}` : '';
    })
    .filter(Boolean)
    .join('\n');
  return [
    text,
    sourceText ? `Referenced notes:\n${sourceText}` : '',
  ].filter(Boolean).join('\n\n').slice(0, 4000);
}

function mnBuildAskThreadMessages(priorMessages = [], currentQuery = '', options = {}) {
  const limit = Math.max(1, Math.min(Number(options.limit) || 8, 12));
  const history = (priorMessages || [])
    .filter(message => message && (message.role === 'user' || message.role === 'assistant'))
    .map(message => ({
      role: message.role === 'assistant' ? 'assistant' : 'user',
      content: mnAskMessageThreadText(message),
    }))
    .filter(message => message.content)
    .slice(-limit);
  const query = String(currentQuery || '').trim();
  return query ? [...history, { role: 'user', content: query }] : history;
}

function mnBuildAskThreadPrompt(priorMessages = [], currentQuery = '') {
  const history = mnBuildAskThreadMessages(priorMessages, '', { limit: 6 });
  const query = String(currentQuery || '').trim();
  if (!history.length) return query;
  return [
    'Conversation so far:',
    ...history.map(message => `${message.role}: ${message.content}`),
    '',
    `Current question: ${query}`,
  ].join('\n');
}

function mnRecentAskThreadNote(priorMessages = []) {
  for (const message of [...(priorMessages || [])].reverse()) {
    const source = (message.sources || []).find(item => item?.id && item?.title);
    if (source) {
      return {
        id: source.id,
        title: source.title,
        snippet: source.snippet || '',
      };
    }
  }
  return null;
}

function mnLastAskMessage(priorMessages = [], role = '') {
  return [...(priorMessages || [])].reverse().find(message => message?.role === role) || null;
}

function mnLooksLikeNoteEditRequest(text) {
  return /\b(add|append|include|insert|write|draft|create|make|format|rewrite|improve|summari[sz]e|compare|comparison|table|list|bullet|update)\b/i.test(String(text || ''));
}

function mnMentionsThreadNote(text) {
  return /\b(above|that|same|previous|created|new|current|this|it)\s+(note|page)\b/i.test(String(text || '')) ||
    /\b(to|in|into|for)\s+(the\s+)?(above|that|same|previous|created|new|current|this)\b/i.test(String(text || ''));
}

function mnAssistantAskedForActionDetail(message = {}) {
  const text = String(message.text || message.content || '').toLowerCase();
  return !!message.clarify ||
    /\bplease provide\b/.test(text) ||
    /\bspecific (differences|details|points|formatting)\b/.test(text) ||
    /\bformatting preferences\b/.test(text);
}

function mnBuildContextualActionQuery(priorMessages = [], currentQuery = '') {
  const query = String(currentQuery || '').trim();
  if (!query) return query;
  const note = mnRecentAskThreadNote(priorMessages);
  if (!note) return query;

  const previousUser = mnLastAskMessage(priorMessages, 'user');
  const previousAssistant = mnLastAskMessage(priorMessages, 'assistant');
  const previousUserText = String(previousUser?.text || previousUser?.content || '').trim();
  const previousWasNoteEdit = mnLooksLikeNoteEditRequest(previousUserText) && mnMentionsThreadNote(previousUserText);
  const currentIsNoteEdit = mnLooksLikeNoteEditRequest(query) && mnMentionsThreadNote(query);
  const currentLooksLikeDetail = !mnMentionsThreadNote(query) &&
    /\b(table|markdown|format|formatting|bullet|list|nice|comparison|compare|difference|different|details?)\b/i.test(query);

  if (currentIsNoteEdit) {
    return `${query}\n\nTarget note from this chat: "${note.title}" (${note.id}).`;
  }
  if (previousWasNoteEdit && mnAssistantAskedForActionDetail(previousAssistant) && currentLooksLikeDetail) {
    return `${previousUserText}\n\nAdditional detail from the user: ${query}\n\nTarget note from this chat: "${note.title}" (${note.id}).`;
  }
  return query;
}

function mnAiCurrentNoteMarkdown(note) {
  if (!note) return '';
  if (typeof note.body === 'string') return note.body;
  try {
    return window.MN_OUTLINE?.mnBlocksToMd?.(note.blocks || []) || '';
  } catch (e) {
    return '';
  }
}

function mnAiCurrentContextMessage(currentNote) {
  if (!currentNote) return '';
  const body = mnAiCurrentNoteMarkdown(currentNote);
  return [
    'Current VispNote context:',
    `- Current page title: ${currentNote.title || 'Untitled'}`,
    `- Current page id: ${currentNote.id || ''}`,
    currentNote.tags?.length ? `- Current page tags: ${currentNote.tags.map(tag => `#${tag}`).join(' ')}` : '',
    body ? `- Current page body excerpt:\n${body.slice(0, 6000)}` : '',
    '',
    'Use this context for references like "this page", "current note", "it", or "that".',
  ].filter(Boolean).join('\n');
}

function mnAiToolCallsFromPlanResult(result = {}) {
  const value = result?.value || result || {};
  if (value.ok === false) return { answer: String(value.error || '').trim(), toolCalls: [] };
  const toolCalls = Array.isArray(value.toolCalls) ? value.toolCalls
    : Array.isArray(value.calls) ? value.calls
      : [];
  return {
    answer: String(value.answer || '').trim(),
    toolCalls: toolCalls.map(call => ({
      name: String(call?.name || call?.tool || call?.function?.name || '').trim(),
      args: call?.args && typeof call.args === 'object'
        ? call.args
        : call?.input && typeof call.input === 'object'
          ? call.input
          : {},
      reason: String(call?.reason || '').trim(),
    })).filter(call => call.name),
  };
}

function mnAiPlainInlineText(text) {
  return String(text || '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .trim();
}

function mnAiLooksLikeSectionLabel(text) {
  const clean = mnAiPlainInlineText(text);
  if (!clean.endsWith(':')) return false;
  const label = clean.slice(0, -1).trim();
  if (!label || label.length > 80) return false;
  if (/[.!?]/.test(label)) return false;
  const words = label.split(/\s+/).filter(Boolean);
  if (words.length > 8) return false;
  return words.some(word => /^[A-Z0-9]/.test(word));
}

function mnAskStatusText(status) {
  const provider = String(status?.config?.provider || 'ollama').toLowerCase();
  const providerLabel = mnAiProviderLabel(provider);
  if (!status) return provider === 'ollama' ? 'Checking local AI' : `Checking ${providerLabel}`;
  if (provider !== 'ollama') return status.chatModelOk ? `${providerLabel} ready` : 'Setup needed';
  if (!status.reachable) return 'Setup needed';
  if (!status.chatModelOk) return 'Setup needed';
  if (!status.embedModelOk) return 'Keyword search mode';
  return 'Semantic search ready';
}

function mnAiProviderLabel(provider) {
  return ({
    ollama: 'Ollama',
    openrouter: 'OpenRouter',
    openai: 'OpenAI',
    anthropic: 'Anthropic',
    gemini: 'Gemini',
    custom: 'Custom provider',
  })[String(provider || 'ollama').toLowerCase()] || 'AI provider';
}

function mnAskFooterHint(status, embedded) {
  const closeHint = embedded ? '' : ' · Esc to close';
  const askHint = `Enter to ask · Shift+Enter for newline${closeHint}`;
  if (!status) return `Checking AI setup · ${askHint}`;
  const provider = String(status?.config?.provider || 'ollama').toLowerCase();
  const providerLabel = mnAiProviderLabel(provider);
  if (provider !== 'ollama') {
    if (status.chatModelOk) return `${providerLabel} ready · ${askHint}`;
    return `${providerLabel} setup needed - check Settings > AI`;
  }
  if (status.reachable === false) return 'Local AI setup needed - Ask can still search notes and show setup steps';
  if (!status.chatModelOk) return 'Local chat model setup needed - Ask can still search notes and show setup steps';
  if (!status.embedModelOk) {
    return status?.embedModelReason || `Using keyword search. For semantic search: \`ollama pull ${status?.config?.embedModel}\``;
  }
  return `Semantic search ready · ${askHint}`;
}

function MnAiSetupNotice({ status, T }) {
  if (!status?.setupRequired) return null;
  const steps = Array.isArray(status.setupSteps) ? status.setupSteps.filter(Boolean).slice(0, 5) : [];
  const reason = String(status.reason || 'AI setup is incomplete.').trim();
  return (
    <div style={{
      padding: 13,
      borderRadius: 8,
      border: `1px solid color-mix(in oklab, ${T.warn || T.accent || T.ink} 36%, ${T.lineSub})`,
      background: `color-mix(in oklab, ${T.warn || T.accent || T.ink} 8%, ${T.bgSub})`,
      color: T.ink,
      marginBottom: 14,
    }}>
      <div style={{ fontFamily: 'var(--mn-ui)', fontSize: 13.5, fontWeight: 700, color: T.ink }}>
        AI setup needed
      </div>
      <div style={{ marginTop: 5, fontFamily: 'var(--mn-body)', fontSize: 13, lineHeight: 1.45, color: T.inkMed }}>
        {reason}
      </div>
      {steps.length > 0 && (
        <ol style={{
          margin: '9px 0 0',
          paddingLeft: 18,
          display: 'grid',
          gap: 4,
          fontFamily: 'var(--mn-body)',
          fontSize: 12.5,
          lineHeight: 1.45,
          color: T.inkMed,
        }}>
          {steps.map((step, index) => <li key={`${step}-${index}`}>{step}</li>)}
        </ol>
      )}
    </div>
  );
}

function mnAiInlineText(text, T) {
  const source = String(text || '');
  const parts = [];
  const re = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*]+\*)/g;
  let last = 0;
  let match;
  let key = 0;
  while ((match = re.exec(source))) {
    if (match.index > last) parts.push(<span key={key++}>{source.slice(last, match.index)}</span>);
    const token = match[0];
    if (token.startsWith('`')) {
      parts.push(
        <code key={key++} style={{
          fontFamily: 'var(--mn-mono)',
          fontSize: '0.9em',
          background: T.bgSub,
          border: `1px solid ${T.lineSub}`,
          borderRadius: 4,
          padding: '1px 5px',
          color: T.ink,
        }}>{token.slice(1, -1)}</code>
      );
    } else if (token.startsWith('**')) {
      parts.push(<strong key={key++} style={{ color: T.ink, fontWeight: 700 }}>{token.slice(2, -2)}</strong>);
    } else {
      parts.push(<em key={key++}>{token.slice(1, -1)}</em>);
    }
    last = match.index + token.length;
  }
  if (last < source.length) parts.push(<span key={key++}>{source.slice(last)}</span>);
  return parts;
}

function mnParseAiResponseBlocks(text) {
  const lines = String(text || '').replace(/\r\n/g, '\n').split('\n');
  const blocks = [];
  let paragraph = [];
  let code = null;
  const flushParagraph = () => {
    if (!paragraph.length) return;
    blocks.push({ type: 'p', text: paragraph.join(' ').trim() });
    paragraph = [];
  };
  for (const rawLine of lines) {
    const fence = rawLine.match(/^```(\w+)?\s*$/);
    if (fence) {
      if (code) {
        blocks.push({ type: 'code', lang: code.lang, text: code.lines.join('\n') });
        code = null;
      } else {
        flushParagraph();
        code = { lang: fence[1] || '', lines: [] };
      }
      continue;
    }
    if (code) {
      code.lines.push(rawLine);
      continue;
    }
    const line = rawLine.trim();
    if (!line) {
      flushParagraph();
      continue;
    }
    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      flushParagraph();
      blocks.push({ type: 'heading', level: heading[1].length, text: heading[2].trim() });
      continue;
    }
    const ordered = line.match(/^(\d+)\.\s+(.+)$/);
    if (ordered) {
      flushParagraph();
      const prev = blocks[blocks.length - 1];
      const item = { index: ordered[1], text: ordered[2].trim() };
      if (prev?.type === 'ol') prev.items.push(item);
      else blocks.push({ type: 'ol', items: [item] });
      continue;
    }
    const bullet = line.match(/^[-*]\s+(.+)$/);
    if (bullet) {
      flushParagraph();
      if (mnAiLooksLikeSectionLabel(bullet[1])) {
        blocks.push({ type: 'heading', level: 3, text: bullet[1].trim(), promoted: true });
        continue;
      }
      const prev = blocks[blocks.length - 1];
      const item = bullet[1].trim();
      if (prev?.type === 'ul') prev.items.push(item);
      else blocks.push({ type: 'ul', items: [item] });
      continue;
    }
    const quote = line.match(/^>\s+(.+)$/);
    if (quote) {
      flushParagraph();
      const prev = blocks[blocks.length - 1];
      if (prev?.type === 'quote') prev.lines.push(quote[1].trim());
      else blocks.push({ type: 'quote', lines: [quote[1].trim()] });
      continue;
    }
    paragraph.push(line);
  }
  flushParagraph();
  if (code) blocks.push({ type: 'code', lang: code.lang, text: code.lines.join('\n') });
  return blocks;
}

function MnAiFormattedResponse({ text, T }) {
  const blocks = React.useMemo(() => mnParseAiResponseBlocks(text), [text]);
  if (!blocks.length) return null;
  return (
    <div style={{
      display: 'grid',
      gap: 9,
      fontFamily: 'var(--mn-body)',
      fontSize: 14.5,
      lineHeight: 1.62,
      color: T.ink,
    }}>
      {blocks.map((block, index) => {
        if (block.type === 'heading') {
          return (
            <div key={index} style={{
              marginTop: index === 0 ? 0 : 6,
              paddingBottom: 3,
              borderBottom: block.level <= 2 ? `1px solid ${T.lineSub}` : 'none',
              fontFamily: 'var(--mn-ui)',
              fontSize: block.level === 1 ? 15.5 : 14.5,
              fontWeight: 750,
              lineHeight: 1.35,
              color: T.ink,
            }}>{mnAiInlineText(block.text, T)}</div>
          );
        }
        if (block.type === 'ul' || block.type === 'ol') {
          return (
            <div key={index} style={{ display: 'grid', gap: 5 }}>
              {block.items.map((item, itemIndex) => {
                const textValue = typeof item === 'string' ? item : item.text;
                const marker = block.type === 'ol' ? `${item.index || itemIndex + 1}.` : '';
                return (
                  <div key={itemIndex} style={{
                    display: 'grid',
                    gridTemplateColumns: block.type === 'ol' ? '24px minmax(0, 1fr)' : '14px minmax(0, 1fr)',
                    gap: 7,
                    alignItems: 'start',
                  }}>
                    <span style={{
                      marginTop: block.type === 'ol' ? 0 : 9,
                      width: block.type === 'ol' ? 24 : 5,
                      height: block.type === 'ol' ? 'auto' : 5,
                      borderRadius: 5,
                      background: block.type === 'ol' ? 'transparent' : T.accent,
                      color: T.inkDim,
                      fontFamily: 'var(--mn-mono)',
                      fontSize: 11,
                      lineHeight: 1.6,
                    }}>{marker}</span>
                    <span>{mnAiInlineText(textValue, T)}</span>
                  </div>
                );
              })}
            </div>
          );
        }
        if (block.type === 'quote') {
          return (
            <blockquote key={index} style={{
              margin: 0,
              padding: '7px 11px',
              borderLeft: `2px solid ${T.accent}`,
              background: T.bgSub,
              color: T.inkMed,
              borderRadius: 6,
            }}>{mnAiInlineText(block.lines.join(' '), T)}</blockquote>
          );
        }
        if (block.type === 'code') {
          return (
            <div key={index} style={{
              borderRadius: 7,
              border: `1px solid ${T.lineSub}`,
              background: T.bgSub,
              overflow: 'hidden',
            }}>
              {block.lang && (
                <div style={{
                  padding: '5px 10px',
                  borderBottom: `1px solid ${T.lineSub}`,
                  color: T.inkDim,
                  fontFamily: 'var(--mn-mono)',
                  fontSize: 10.5,
                }}>{block.lang}</div>
              )}
              <pre style={{
                margin: 0,
                padding: '10px 11px',
                color: T.ink,
                overflow: 'auto',
                fontFamily: 'var(--mn-mono)',
                fontSize: 12,
                lineHeight: 1.55,
                whiteSpace: 'pre',
              }}><code>{block.text}</code></pre>
            </div>
          );
        }
        return <p key={index} style={{ margin: 0 }}>{mnAiInlineText(block.text, T)}</p>;
      })}
    </div>
  );
}

function MnAskAI({
  vaultId, currentNote, allNotes, onClose, onOpenNote, onCreateNote, onApplyCurrentPageBody, onTagCurrentNote,
  session, setSession, onBackgroundComplete, initialQuery, T, embedded = false,
}) {
  const [query, setQuery] = useStateAI('');
  const [status, setStatus] = useStateAI(null);
  const [openSources, setOpenSources] = useStateAI({});
  const [localSession, setLocalSession] = useStateAI({
    messages: [],
    pending: false,
    error: null,
    activeAction: null,
    background: false,
  });
  const inputRef = useRefAI(null);
  const scrollRef = useRefAI(null);
  const scrollBottomRef = useRefAI(null);
  const shouldAutoScrollRef = useRefAI(true);
  const backgroundRef = useRefAI(false);
  const stoppedJobRef = useRefAI(null);

  const aiSession = session || localSession;
  const rawUpdateSession = setSession || setLocalSession;
  const updateSession = (updater) => {
    rawUpdateSession(prev => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      return { ...(next || {}), messages: mnNormalizeAskMessages(next?.messages || []) };
    });
  };
  const messages = aiSession.messages || [];
  const aiRuntime = window.MN_AI_RUNTIME || {};

  useEffectAI(() => {
    if ((aiSession.messages || []).some(m => !m?.id)) {
      updateSession(prev => ({ ...(prev || {}), messages: mnNormalizeAskMessages(prev?.messages || []) }));
    }
  }, [aiSession.messages]);
  const pending = !!aiSession.pending;
  const error = aiSession.error || null;
  const activeAction = aiSession.activeAction || null;
  const latestResponseIndex = messages.reduce((found, message, index) => (
    message.role === 'assistant' && !message.error && !message.stopped ? index : found
  ), -1);
  const scrollVersion = messages.map(message => [
    message.id || '',
    String(message.text || '').length,
    message.streaming ? 'streaming' : '',
    message.sources?.length || 0,
    message.review ? 'review' : '',
  ].join(':')).join('|');

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
    const shouldScroll = pending || shouldAutoScrollRef.current || messages.length <= 1;
    const handle = requestAnimationFrame(() => {
      if (!shouldScroll) return;
      scrollBottomRef.current?.scrollIntoView?.({ block: 'end' });
      scrollNode.scrollTop = scrollNode.scrollHeight;
    });
    return () => cancelAnimationFrame(handle);
  }, [scrollVersion, pending, activeAction]);

  const rememberScrollPosition = () => {
    const scrollNode = scrollRef.current;
    if (!scrollNode) return;
    const distanceFromBottom = scrollNode.scrollHeight - scrollNode.scrollTop - scrollNode.clientHeight;
    shouldAutoScrollRef.current = distanceFromBottom < 160;
  };

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

  const classifyPrompt = (q) => {
    return (window.MN_AI_ACTIONS?.classifyPrompt || (() => ({ type: 'notes' })))(q);
  };

  const isClearlyNoteQuestion = (q) => {
    const text = String(q || '').trim().toLowerCase();
    if (!text) return false;
    if (/\b(summari[sz]e|summary|explain|find|search|list|show|what|who|when|where|why|how)\b/.test(text) &&
        /\b(my|all|this|current|latest|recent|vault|notes?|pages?|tasks?|todos?|tags?|links?|backlinks?)\b/.test(text)) {
      return true;
    }
    return /^(can you|could you|please)?\s*(summari[sz]e|explain|tell me|what|who|when|where|why|how)\b/.test(text) &&
      /\bnotes?|vault|page|tasks?|todos?\b/.test(text);
  };

  const initialAppPlan = (q) => {
    const text = String(q || '').trim();
    if (isClearlyNoteQuestion(text) && !/\b(create|make|new|delete|rename|duplicate|tag|untag|archive|restore|import|export|rebuild|backfill|refresh|open settings|go to settings|zotero)\b/i.test(text)) {
      return null;
    }
    if (/^(what|who|when|where|why|how|which|summari[sz]e|explain|tell me)\b/i.test(text) &&
        !/\b(create|make|new|open|show|go to|delete|rename|duplicate|tag|untag|archive|restore|import|export|rebuild|backfill|refresh|settings|graph|canvas|todos?|zotero)\b/i.test(text)) {
      return null;
    }
    if (!window.MN_APP_ACTIONS?.findForText) return null;
    try { return window.MN_APP_ACTIONS.findForText(q); } catch (e) { return null; }
  };

  const shouldUseModelPlanner = (plan, q) => {
    if (window.mn?.ai?.toolPlan) return true;
    if (!plan) return true;
    if (plan.confidence === 'high' && plan.source === 'direct-router') return false;
    if (isClearlyNoteQuestion(q)) return false;
    const text = String(q || '').toLowerCase();
    if (/\b(open|show|go to|settings|graph|todos?|tasks?|canvas|tag|untag|rename|duplicate|delete|archive|restore|import|export|rebuild|backfill|refresh)\b/.test(text)) {
      return plan.confidence !== 'high';
    }
    return false;
  };

  const planAppActionsWithModel = async (q, fallbackPlan, jobId, run, priorMessages = []) => {
    const registry = window.MN_APP_ACTIONS;
    if (!registry?.describeForAi || !registry?.validate || !window.mn?.ai?.toolPlan) return fallbackPlan;
    const functions = registry.describeForAi()
      .slice(0, 100);
    if (!functions.length) return fallbackPlan;
    const isInspectionStep = (step) => {
      const meta = registry.list?.({ includeHidden: true })?.find?.(item => item.id === step?.actionId);
      return !!meta?.readOnly || ['search-notes', 'read-note'].includes(step?.actionId);
    };
    const isPureInspectionRequest = (text) => {
      const lower = String(text || '').toLowerCase();
      return /\b(search|find|read|show|list)\b/.test(lower) &&
        !/\b(create|make|new|delete|rename|duplicate|tag|untag|label|mark|move|set|change|update|archive|restore|add|append|todo|task|remind|reminder|link|wikilink)\b/.test(lower);
    };
    const toolMessages = mnBuildAskThreadMessages(priorMessages, q, { limit: 8 });
    const appendToolResults = (results) => {
      toolMessages.push({
        role: 'assistant',
        content: `Tool results:\n${JSON.stringify(results, null, 2).slice(0, 12000)}`,
      });
      toolMessages.push({
        role: 'user',
        content: 'Use those tool results to choose the next VispNote tool call. If the requested action is now clear, call the write/navigation tool. If it is still ambiguous, ask for clarification.',
      });
    };
    const executeReadSteps = async (steps) => {
      const out = [];
      for (const step of steps.slice(0, 4)) {
        const args = registry.validate(step.actionId, step.args || {});
        const result = await registry.run(step.actionId, args, {});
        out.push({
          tool: step.actionId,
          args,
          ok: result?.ok !== false,
          message: result?.message || '',
          structuredContent: {
            results: result?.results || undefined,
            note: result?.note || undefined,
            item: result?.item || undefined,
            attachments: result?.attachments || undefined,
            fullText: result?.fullText || undefined,
            fullTextError: result?.fullTextError || undefined,
            affected: result?.affected || [],
          },
        });
      }
      return out;
    };
    const askPlanner = async (feedback = '') => {
      setActiveAction('Planning app actions...');
      aiRuntime.recordTrace?.(run, 'planner.request', { feedback: !!feedback, tools: functions.length });
      const messages = feedback
        ? [...toolMessages, { role: 'user', content: `Previous invalid tool plan feedback: ${feedback}` }]
        : toolMessages;
      return await window.mn.ai.toolPlan({
        jobId,
        timeoutMs: MN_AI_PLANNER_TIMEOUT_MS,
        maxTokens: 700,
        tools: functions,
        messages,
      });
    };
    const parsePlan = (answer) => {
      if (aiRuntime.toolPlanResultToPlan) {
        const planned = aiRuntime.toolPlanResultToPlan({ result: answer, registry, fallbackPlan });
        if (planned.kind === 'plan') return planned.plan;
        if (planned.kind === 'clarify') return { type: 'clarify', message: planned.message };
        throw new Error(planned.message || 'Planner output did not validate.');
      }
      return fallbackPlan;
    };
    try {
      for (let round = 0; round < 3; round++) {
        const r = await askPlanner();
        if (!r.ok || (r.value && r.value.ok === false)) return fallbackPlan;
        const plan = parsePlan(r.value || r);
        aiRuntime.recordTrace?.(run, 'planner.result', { source: plan?.source || 'fallback', confidence: plan?.confidence || '', round: round + 1 });
        if (plan?.type === 'clarify') return plan;
        const inspectionSteps = (plan?.steps || []).filter(isInspectionStep);
        const onlyInspectionSteps = inspectionSteps.length > 0 && inspectionSteps.length === (plan?.steps || []).length;
        if (onlyInspectionSteps && isPureInspectionRequest(q)) return plan;
        if (inspectionSteps.length && round < 2) {
          const results = await executeReadSteps(inspectionSteps);
          aiRuntime.recordTrace?.(run, 'tool.done', { actionId: inspectionSteps.map(step => step.actionId).join(','), actionLabel: 'read tools', affected: results.length });
          appendToolResults(results);
          continue;
        }
        return plan;
      }
      return fallbackPlan;
    } catch (e) {
      try {
        const feedback = e.message || 'Planner output did not validate against registered actions.';
        const r = await askPlanner(feedback);
        if (!r.ok || (r.value && r.value.ok === false)) return fallbackPlan;
        const plan = parsePlan(r.value || r);
        aiRuntime.recordTrace?.(run, 'planner.repaired', { source: plan?.source || 'fallback', confidence: plan?.confidence || '' });
        return plan;
      } catch (e2) {
        aiRuntime.recordTrace?.(run, 'planner.failed', { error: e2.message || String(e2) });
        return fallbackPlan;
      }
    }
  };

  const zoteroTools = () => (window.MN_APP_ACTIONS?.describeForAi?.() || [])
    .filter(tool => /^zotero-/.test(tool.name));

  const zoteroStatusMessage = (statusValue) => {
    const error = String(statusValue?.error || '').trim();
    if (/local api is not enabled/i.test(error)) {
      return 'I cannot search Zotero because Zotero responded: Local API is not enabled. Enable Zotero local API/connector access, then try again.';
    }
    if (error) return `I cannot search Zotero: ${error}`;
    return 'I cannot search Zotero because Zotero Desktop is not reachable at 127.0.0.1:23119.';
  };

  const zoteroTitleKey = (value) => String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '');

  const zoteroLikelyMatch = (item, queryText) => {
    const queryKey = zoteroTitleKey(queryText);
    const titleKey = zoteroTitleKey(item?.title);
    if (!queryKey || !titleKey) return false;
    return titleKey.includes(queryKey) || queryKey.includes(titleKey);
  };

  const zoteroSummaryContext = (readResult, originalQuery) => {
    const item = readResult?.item || {};
    return [
      `User request: ${originalQuery}`,
      `Title: ${item.title || ''}`,
      `Type: ${item.itemType || ''}`,
      `Authors: ${item.creators || ''}`,
      `Date: ${item.date || ''}`,
      `Publication: ${item.publicationTitle || ''}`,
      `DOI: ${item.doi || ''}`,
      `URL: ${item.url || ''}`,
      `Abstract: ${item.abstractNote || ''}`,
      `Attachment full text available: ${readResult?.fullText ? 'yes' : 'no'}`,
      readResult?.fullTextError ? `Full text note: ${readResult.fullTextError}` : '',
      readResult?.fullText ? `Full text excerpt:\n${readResult.fullText}` : '',
    ].filter(Boolean).join('\n\n');
  };

  const summarizeZoteroRead = async ({ readResult, query, jobId }) => {
    if (!window.mn?.ai?.chat) {
      const item = readResult?.item || {};
      return [
        `I found "${item.title || 'the Zotero item'}" in Zotero, but AI chat is unavailable for summarizing it.`,
        item.abstractNote ? `Abstract: ${item.abstractNote}` : '',
        readResult?.fullTextError ? readResult.fullTextError : '',
      ].filter(Boolean).join('\n\n');
    }
    const context = zoteroSummaryContext(readResult, query);
    const r = await window.mn.ai.chat({
      jobId,
      timeoutMs: MN_AI_CHAT_TIMEOUT_MS,
      maxTokens: 900,
      messages: [
        {
          role: 'user',
          content: [
            'Summarize this Zotero paper for the user. Use only the Zotero metadata and full text excerpt below.',
            'If full text is unavailable, say that and summarize the metadata/abstract only.',
            'Keep the answer concise, with key idea, method, results, and limitations when available.',
            '',
            context,
          ].join('\n'),
        },
      ],
    });
    if (!r.ok) throw new Error(r.error || 'Could not summarize Zotero item.');
    if (r.value && !r.value.ok) throw new Error(r.value.error || 'Could not summarize Zotero item.');
    return String(r.value?.answer || '').trim() || 'I found the Zotero item, but the model did not return a summary.';
  };

  const runZoteroDocumentRequest = async ({ q, actionQuery, jobId, run }) => {
    const registry = window.MN_APP_ACTIONS;
    if (!registry?.run || !registry?.validate) {
      return { answer: 'I cannot search Zotero because app actions are not available.', sources: [], clarify: true };
    }
    if (!zoteroTools().length) {
      return { answer: aiRuntime.zoteroUnavailableMessage?.() || 'I cannot search Zotero because the Zotero reader plugin is not enabled.', sources: [], clarify: true };
    }
    if (!window.mn?.zotero?.status) {
      return { answer: 'I cannot search Zotero because this build does not expose the Zotero connector.', sources: [], clarify: true };
    }
    setActiveAction('Checking Zotero...');
    const statusResult = await window.mn.zotero.status();
    if (!statusResult.ok) return { answer: `I cannot check Zotero: ${statusResult.error || 'unknown error'}`, sources: [], clarify: true };
    if (!statusResult.value?.reachable) {
      return { answer: zoteroStatusMessage(statusResult.value), sources: [], clarify: true };
    }

    const cleanedQueries = [
      aiRuntime.documentSearchQuery?.(actionQuery),
      aiRuntime.documentSearchQuery?.(q),
    ].map(value => String(value || '').trim()).filter((value, index, arr) => value && arr.indexOf(value) === index);
    const queryCandidates = cleanedQueries.length ? cleanedQueries : [String(q || '').trim()].filter(Boolean);
    let queryText = queryCandidates[0] || String(q || '').trim();
    let searchResult = null;
    for (const candidate of queryCandidates) {
      setActiveAction('Searching Zotero...');
      aiRuntime.recordTrace?.(run, 'tool.run', { actionId: 'zotero-search', actionLabel: 'Search Zotero', args: { query: candidate, limit: 8 } });
      const searchArgs = registry.validate('zotero-search', { query: candidate, limit: 8 });
      const result = await registry.run('zotero-search', searchArgs, {});
      if (result.ok === false) return { answer: result.message || 'Could not search Zotero.', sources: [], clarify: true };
      const hasResults = Array.isArray(result.results) && result.results.length > 0;
      searchResult = result;
      queryText = candidate;
      if (hasResults) break;
    }
    const rawResults = Array.isArray(searchResult?.results) ? searchResult.results : [];
    const candidates = rawResults.filter(item => item?.key && item.itemType !== 'note' && item.itemType !== 'attachment' && !item.parentItem);
    const results = candidates.length ? candidates : rawResults.filter(item => item?.key);
    if (!results.length) {
      return { answer: `I searched Zotero for "${queryText}" but found no matching paper.`, sources: [], clarify: true };
    }
    const exact = results.find(item => zoteroLikelyMatch(item, queryText));
    if (!exact && results.length > 1) {
      const choices = results.slice(0, 5).map((item, index) => `${index + 1}. ${item.title || item.key}${item.creators ? ` - ${item.creators}` : ''}${item.date ? ` (${item.date})` : ''}`).join('\n');
      return { answer: `I found multiple Zotero matches for "${queryText}". Which one should I summarize?\n\n${choices}`, sources: [], clarify: true };
    }
    const item = exact || results[0];
    aiRuntime.recordTrace?.(run, 'tool.done', { actionId: 'zotero-search', actionLabel: 'Search Zotero', affected: results.length });
    setActiveAction('Reading Zotero item...');
    aiRuntime.recordTrace?.(run, 'tool.run', { actionId: 'zotero-read', actionLabel: 'Read Zotero item', args: { itemKey: item.key, includeFullText: true } });
    const readArgs = registry.validate('zotero-read', { itemKey: item.key, includeFullText: true });
    const readResult = await registry.run('zotero-read', readArgs, {});
    if (readResult.ok === false) return { answer: readResult.message || 'Could not read Zotero item.', sources: [], clarify: true };
    aiRuntime.recordTrace?.(run, 'tool.done', { actionId: 'zotero-read', actionLabel: 'Read Zotero item', affected: 1 });
    setActiveAction('Summarizing Zotero paper...');
    const answer = await summarizeZoteroRead({ readResult, query: q, jobId });
    return {
      answer,
      sources: [{ id: readResult.item?.key || item.key, title: readResult.item?.title || item.title || item.key, snippet: 'Zotero' }],
      action: true,
    };
  };

  const askEdit = async ({ text, instruction, scope, jobId }) => {
    if (!window.mn?.ai?.edit) throw new Error('AI editing is not available');
    const r = await window.mn.ai.edit({ text, instruction, scope, jobId });
    if (!r.ok) throw new Error(r.error || 'AI action failed');
    if (r.value && !r.value.ok) throw new Error(r.value.error || 'AI action failed');
    return r.value.text;
  };

  const askNotes = async ({ prompt, jobId }) => {
    if (!window.mn?.ai?.ask) throw new Error('AI notes search is not available');
    const r = await window.mn.ai.ask(vaultId, prompt, { jobId, currentNoteId: currentNote?.id || null, timeoutMs: MN_AI_NOTES_TIMEOUT_MS });
    if (!r.ok) throw new Error(r.error || 'AI action failed');
    if (r.value && !r.value.ok) throw new Error(r.value.error || 'AI action failed');
    return {
      answer: String(r.value?.answer || '').trim(),
      sources: r.value?.sources || [],
    };
  };

  const askVaultSummary = async ({ prompt, jobId }) => {
    if (window.mn?.ai?.summarizeVault) {
      setActiveAction('Summarizing notes in batches...');
      const r = await window.mn.ai.summarizeVault(vaultId, prompt, { jobId, currentNoteId: currentNote?.id || null, timeoutMs: MN_AI_NOTES_TIMEOUT_MS });
      if (!r.ok) throw new Error(r.error || 'AI summary failed');
      if (r.value && !r.value.ok) throw new Error(r.value.error || 'AI summary failed');
      return {
        answer: String(r.value?.answer || '').trim(),
        sources: r.value?.sources || [],
      };
    }
    return askNotes({ prompt, jobId });
  };

  const buildOrchestratorMessages = (q, priorMessages = []) => {
    const conversation = mnBuildAskThreadMessages(priorMessages, q, { limit: 8 });
    const context = mnAiCurrentContextMessage(currentNote);
    if (!context) return conversation;
    return [
      { role: 'user', content: context },
      ...conversation,
    ];
  };

  const orchestratorTools = () => {
    const registryTools = window.MN_APP_ACTIONS?.describeForAi?.() || [];
    const tools = [...MN_AI_VIRTUAL_TOOLS, ...registryTools].slice(0, 100);
    return currentNote
      ? tools
      : tools.filter(tool => tool.name !== 'edit-current-page');
  };

  const executeOrchestratorTool = async ({ call, q, jobId, run }) => {
    const name = String(call?.name || '').trim();
    const args = call?.args && typeof call.args === 'object' ? call.args : {};
    if (name === 'answer-notes') {
      setActiveAction('Researching notes...');
      aiRuntime.recordTrace?.(run, 'tool.run', { actionId: name, actionLabel: 'Answer from notes', args });
      const prompt = String(args.query || q || '').trim();
      const result = /\b(summari[sz]e|summary|overview|recap)\b/i.test(prompt) && /\b(all|my|entire|whole|vault|everything)\b/i.test(prompt)
        ? await askVaultSummary({ prompt, jobId })
        : await askNotes({ prompt, jobId });
      aiRuntime.recordTrace?.(run, 'tool.done', { actionId: name, actionLabel: 'Answer from notes', affected: result.sources?.length || 0 });
      return { final: { answer: result.answer, sources: result.sources || [] } };
    }
    if (name === 'edit-current-page') {
      if (!currentNote || !onApplyCurrentPageBody) throw new Error('No current page is open to edit');
      const instruction = String(args.instruction || q || '').trim();
      if (!instruction) throw new Error('Edit instruction is empty');
      setActiveAction('Editing page...');
      aiRuntime.recordTrace?.(run, 'tool.run', { actionId: name, actionLabel: 'Edit current page', args: { instruction } });
      const body = mnAiCurrentNoteMarkdown(currentNote);
      const edited = await askEdit({ scope: 'current page', instruction, text: body, jobId });
      onApplyCurrentPageBody(edited);
      aiRuntime.recordTrace?.(run, 'tool.done', { actionId: name, actionLabel: 'Edit current page', affected: 1 });
      return {
        final: {
          answer: `Updated "${currentNote.title || 'current page'}".`,
          sources: [{ id: currentNote.id, title: currentNote.title || 'Current page', snippet: edited.slice(0, 200) }],
          action: true,
        },
      };
    }

    const registry = window.MN_APP_ACTIONS;
    if (!registry?.run || !registry?.validate) throw new Error('App actions are not available');
    const meta = registry.list?.({ includeHidden: true })?.find?.(item => item.id === name);
    const cleanArgs = registry.validate(name, args);
    const step = { actionId: name, args: cleanArgs, label: meta?.label || name, risk: meta?.risk || 'safe' };
    setActiveAction(step.label);
    aiRuntime.recordTrace?.(run, 'tool.preview', { actionId: name, actionLabel: step.label, risk: step.risk });
    const result = await registry.run(name, cleanArgs, {});
    run?.toolCalls?.push?.({ actionId: name, args: cleanArgs, ok: result?.ok !== false, requiresConfirmation: !!result?.requiresConfirmation });
    if (result.requiresConfirmation) {
      return {
        final: {
          answer: result.preview?.message || result.message || 'Review this action before it runs.',
          action: true,
          review: aiRuntime.makeReview
            ? aiRuntime.makeReview({ query: q, plan: { steps: [step] }, result })
            : { query: q, steps: [step], preview: result.preview || null },
          sources: [],
        },
      };
    }
    if (result.ok === false) throw new Error(result.message || 'App action failed');
    aiRuntime.recordTrace?.(run, 'tool.done', { actionId: name, actionLabel: step.label, affected: result.affected?.length || 0 });
    if (meta?.readOnly && ['search-notes', 'read-note'].includes(name)) {
      return {
        toolResult: {
          tool: name,
          args: cleanArgs,
          ok: true,
          message: result.message || '',
          structuredContent: {
            results: result.results || undefined,
            note: result.note || undefined,
            affected: result.affected || [],
          },
        },
      };
    }
    return {
      final: {
        answer: result.message || result.title || `${step.label} completed.`,
        sources: (result.affected || []).filter(item => item?.id).map(item => ({
          id: item.id,
          title: item.title || item.id,
          snippet: item.type || 'App action',
        })),
        action: true,
      },
    };
  };

  const runLlmOrchestrator = async ({ q, actionQuery, priorMessages, jobId, run }) => {
    if (!window.mn?.ai?.toolPlan) return null;
    const tools = orchestratorTools();
    if (!tools.length) return null;
    const toolMessages = buildOrchestratorMessages(actionQuery, priorMessages);
    for (let round = 0; round < 4; round++) {
      setActiveAction(round === 0 ? 'Understanding request...' : 'Using tool results...');
      aiRuntime.recordTrace?.(run, 'planner.request', { tools: tools.length, round: round + 1, llmFirst: true });
      const response = await window.mn.ai.toolPlan({
        jobId,
        timeoutMs: MN_AI_PLANNER_TIMEOUT_MS,
        maxTokens: 900,
        tools,
        messages: toolMessages,
      });
      if (!response.ok || (response.value && response.value.ok === false)) return null;
      const planned = mnAiToolCallsFromPlanResult(response.value || response);
      aiRuntime.recordTrace?.(run, 'planner.result', { toolCalls: planned.toolCalls.length, answer: !!planned.answer, round: round + 1 });
      if (!planned.toolCalls.length) {
        return {
          answer: planned.answer || 'I need a little more detail before I can help with that.',
          sources: [],
          clarify: !planned.answer,
        };
      }
      const toolResults = [];
      for (const call of planned.toolCalls.slice(0, 4)) {
        const result = await executeOrchestratorTool({ call, q, jobId, run });
        if (result.final) return result.final;
        if (result.toolResult) toolResults.push(result.toolResult);
      }
      if (!toolResults.length) {
        return {
          answer: planned.answer || 'Done.',
          sources: [],
          action: true,
        };
      }
      toolMessages.push({
        role: 'assistant',
        content: `Tool results:\n${JSON.stringify(toolResults, null, 2).slice(0, 12000)}`,
      });
      toolMessages.push({
        role: 'user',
        content: 'Use these tool results to answer the user directly. If more action is necessary, call the next best tool. Do not repeat tool results as raw JSON.',
      });
    }
    return { answer: 'I inspected the available context, but I need a more specific instruction before I can continue.', sources: [], clarify: true };
  };

  const runActionPlan = async (q, plan, jobId) => {
    if (!Array.isArray(plan.steps) || !plan.steps.length) throw new Error('No AI action steps found');
    let previousAnswer = '';
    let created = null;
    const sources = [];
    const completed = [];
    const createdTags = (plan.steps || [])
      .filter(step => step?.type === 'tag-created-note' && step.tag)
      .map(step => step.tag)
      .filter((tag, index, arr) => arr.indexOf(tag) === index);

    for (const step of plan.steps) {
      if (!step || !step.type) continue;
      if (step.type === 'notes-answer') {
        setActiveAction(step.purpose === 'summary' ? 'Summarizing notes...' : 'Researching notes...');
        const result = step.purpose === 'summary'
          ? await askVaultSummary({ prompt: step.prompt || q, jobId })
          : await askNotes({ prompt: step.prompt || q, jobId });
        previousAnswer = result.answer;
        result.sources.forEach(source => {
          if (source?.id && !sources.some(item => item.id === source.id)) sources.push(source);
        });
        completed.push(step.purpose === 'summary' ? 'summarized your notes' : 'researched your notes');
      } else if (step.type === 'create-note') {
        if (!onCreateNote) throw new Error('Page creation is not available here');
        setActiveAction('Creating page...');
        const title = step.title || plan.title || 'AI draft';
        const tags = [...(step.tags || []), ...createdTags]
          .filter(Boolean)
          .filter((tag, index, arr) => arr.indexOf(tag) === index);
        const body = step.bodyFrom === 'previous-answer'
          ? previousAnswer
          : await askEdit({
              scope: 'new page',
              instruction: 'Create a useful markdown note body for this request. Return only the body; do not include a title heading unless it adds value.',
              text: q,
              jobId,
            });
        const id = onCreateNote({ title, body, tags, open: false });
        created = { id, title, body, tags };
        completed.push(`created "${title}"`);
      } else if (step.type === 'tag-created-note') {
        if (!created) continue;
        completed.push(`tagged it #${step.tag}`);
      } else {
        throw new Error(`Unsupported AI action step: ${step.type}`);
      }
    }

    const createdSource = created?.id
      ? [{ id: created.id, title: created.title, snippet: String(created.body || '').slice(0, 200) }]
      : [];
    const answer = created
      ? `I ${completed.filter((item, index, arr) => arr.indexOf(item) === index).join(', ')}.`
      : `I ${completed.join(', ')}.`;
    return {
      answer,
      sources: [
        ...createdSource,
        ...sources.filter(source => source?.id !== created?.id),
      ],
      action: true,
    };
  };

  const runAppActionPlan = async (q, plan, jobId, run) => {
    const registry = window.MN_APP_ACTIONS;
    if (!registry?.run) throw new Error('App actions are not available');
    if (!Array.isArray(plan?.steps) || !plan.steps.length) throw new Error('No app action steps found');
    const completed = [];
    const sources = [];
    let lastNote = null;
    const noteFollowupActions = new Set(['append-to-note', 'add-todo-to-note', 'add-reminder-to-note', 'link-note', 'tag-note', 'untag-note', 'set-workflow-status']);
    for (const step of plan.steps) {
      setActiveAction(step.label || 'Running app action...');
      const args = { ...(step.args || {}) };
      if (!args.noteId && lastNote && noteFollowupActions.has(step.actionId)) {
        args.noteId = lastNote.id;
      }
      aiRuntime.recordTrace?.(run, 'tool.preview', { actionId: step.actionId, actionLabel: step.label || step.actionId, risk: step.risk || '' });
      if (step.actionId === 'new-note' && !String(args.body || '').trim()) {
        setActiveAction('Drafting page...');
        args.body = await askEdit({
          scope: 'new page',
          instruction: 'Create a useful markdown note body for this request. Return only the body; do not include a title heading unless it adds value.',
          text: q,
          jobId,
        });
      }
      aiRuntime.recordTrace?.(run, 'tool.run', { actionId: step.actionId, actionLabel: step.label || step.actionId, args });
      const result = await registry.run(step.actionId, args, {});
      run?.toolCalls?.push?.({ actionId: step.actionId, args, ok: result?.ok !== false, requiresConfirmation: !!result?.requiresConfirmation });
      if (result.requiresConfirmation) {
        return {
          answer: result.preview?.message || result.message || 'Review this action before it runs.',
          action: true,
          review: aiRuntime.makeReview
            ? aiRuntime.makeReview({ query: q, plan, result })
            : {
                query: q,
                title: result.preview?.title || result.title || 'Review action',
                message: result.preview?.message || result.message || '',
                risk: result.risk,
                steps: plan.steps,
                preview: result.preview,
              },
          sources,
        };
      }
      if (result.ok === false) throw new Error(result.message || 'App action failed');
      aiRuntime.recordTrace?.(run, 'tool.done', { actionId: step.actionId, actionLabel: step.label || step.actionId, affected: result.affected?.length || 0 });
      const noteAffected = (result.affected || []).find(item => item?.type === 'note' && item.id);
      if (noteAffected) lastNote = { id: noteAffected.id, title: noteAffected.title || noteAffected.id };
      completed.push(result.message || result.title || step.actionId);
      (result.affected || []).forEach(item => {
        if (item?.id && !sources.some(source => source.id === item.id)) {
          sources.push({ id: item.id, title: item.title || item.id, snippet: item.type || 'App action' });
        }
      });
    }
    return {
      answer: completed.length ? completed.join('\n') : 'Done.',
      sources,
      action: true,
    };
  };

  const confirmReview = async (messageId, review) => {
    const registry = window.MN_APP_ACTIONS;
    if (!registry?.run || !review?.steps?.length) return;
    updateSession(prev => ({
      ...(prev || {}),
      messages: (prev?.messages || []).map(m => m.id === messageId ? { ...m, reviewBusy: true } : m),
    }));
    try {
      const completed = [];
      const sources = [];
      for (const step of review.steps) {
        const result = await registry.run(step.actionId, step.args || {}, { confirmed: true });
        if (result.ok === false) throw new Error(result.message || 'App action failed');
        completed.push(result.message || result.title || step.actionId);
        (result.affected || []).forEach(item => {
          if (item?.id && !sources.some(source => source.id === item.id)) sources.push({ id: item.id, title: item.title || item.id, snippet: item.type || 'App action' });
        });
      }
      updateSession(prev => ({
        ...(prev || {}),
        messages: (prev?.messages || []).map(m => m.id === messageId
          ? { ...m, text: completed.join('\n') || 'Confirmed and completed.', sources, review: null, reviewBusy: false }
          : m),
      }));
    } catch (e) {
      updateSession(prev => ({
        ...(prev || {}),
        messages: (prev?.messages || []).map(m => m.id === messageId
          ? { ...m, text: e.message || String(e), error: true, review: null, reviewBusy: false }
          : m),
      }));
    }
  };

  const cancelReview = (messageId) => {
    updateSession(prev => ({
      ...(prev || {}),
      messages: (prev?.messages || []).map(m => m.id === messageId
        ? { ...m, text: 'Cancelled.', review: null, reviewBusy: false, stopped: true }
        : m),
    }));
  };

  const editReviewArgs = async (messageId, review) => {
    const registry = window.MN_APP_ACTIONS;
    if (!registry?.validate || !review?.steps?.length) return;
    const currentSteps = review.steps.map(step => ({ actionId: step.actionId, args: step.args || {} }));
    const raw = window.prompt?.('Edit action arguments as JSON.', JSON.stringify(currentSteps, null, 2));
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw);
      const nextSteps = (Array.isArray(parsed) ? parsed : [parsed]).map((item, index) => {
        const original = review.steps[index] || review.steps[0];
        const actionId = String(item.actionId || item.tool || original.actionId || '').trim();
        const args = registry.validate(actionId, item.args && typeof item.args === 'object' ? item.args : {});
        return { ...original, actionId, args };
      });
      updateSession(prev => ({
        ...(prev || {}),
        messages: (prev?.messages || []).map(m => m.id === messageId
          ? { ...m, review: { ...review, steps: nextSteps, message: 'Review updated. Confirm to run the edited action.' } }
          : m),
      }));
    } catch (e) {
      updateSession(prev => ({
        ...(prev || {}),
        messages: (prev?.messages || []).map(m => m.id === messageId
          ? { ...m, text: e.message || String(e), error: true, reviewBusy: false }
          : m),
      }));
    }
  };

  const runAction = async (q, action, jobId) => {
    if (action.type === 'high-risk-disabled') {
      return { answer: action.reason, sources: [], action: true };
    }

    if (action.type === 'action-plan') {
      return runActionPlan(q, action, jobId);
    }

    if (action.type === 'create-note') {
      if (!onCreateNote) throw new Error('Page creation is not available here');
      setActiveAction('Creating page...');
      const body = await askEdit({
        scope: 'new page',
        instruction: 'Create a useful markdown note body for this request. Return only the body; do not include a title heading unless it adds value.',
        text: q,
        jobId,
      });
      const id = onCreateNote({ title: action.title || 'AI draft', body, open: false });
      return { answer: `Created page "${action.title || 'AI draft'}".`, sources: id ? [{ id, title: action.title || 'AI draft', snippet: body.slice(0, 200) }] : [] };
    }

    if (action.type === 'tag-current-note') {
      if (!currentNote || !onTagCurrentNote) throw new Error('No current page is open to tag');
      setActiveAction('Tagging page...');
      const result = onTagCurrentNote(action.tag);
      const tag = result?.tag || action.tag;
      return {
        answer: result?.alreadyHadTag
          ? `"${currentNote.title}" already has #${tag}.`
          : `Tagged "${currentNote.title}" with #${tag}.`,
        sources: [{ id: currentNote.id, title: currentNote.title, snippet: `#${tag}` }],
      };
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
    const priorMessages = messages;
    const actionQuery = mnBuildContextualActionQuery(priorMessages, q);
    const route = aiRuntime.routeRequest
      ? aiRuntime.routeRequest({ query: actionQuery, aiActions: window.MN_AI_ACTIONS, appRegistry: window.MN_APP_ACTIONS })
      : (() => {
          const classifiedRoute = classifyPrompt(actionQuery);
          const appPlan = classifiedRoute.type === 'action' ? null : initialAppPlan(actionQuery);
          return classifiedRoute.type === 'action'
            ? classifiedRoute
            : (appPlan ? { type: 'app-action', plan: appPlan } : classifiedRoute);
        })();
    const run = aiRuntime.makeRun ? aiRuntime.makeRun({ runId: jobId, query: q, mode: route.mode || route.type }) : null;
    aiRuntime.recordTrace?.(run, 'route.selected', { routeType: route.type, mode: route.mode || route.type, hasPlan: !!route.plan, contextual: actionQuery !== q });
    const userMsg = { role: 'user', text: q };
    backgroundRef.current = false;
    stoppedJobRef.current = null;
    updateSession(prev => ({
      ...(prev || {}),
      messages: [...(prev?.messages || []), userMsg],
      pending: true,
      error: null,
      activeAction: window.mn?.ai?.toolPlan ? 'Understanding request...' : (route.activeLabel || (route.type === 'notes' ? 'Researching notes...' : route.type === 'chat' ? 'Thinking...' : 'Starting task...')),
      background: false,
      jobId,
      activeRun: run,
      lastQuery: q,
      completedAt: null,
    }));
    setQuery('');
    let finalError = null;
    let stopped = false;
    let streamingAssistantId = null;
    const putAssistant = (patch) => {
      if (!streamingAssistantId) streamingAssistantId = `assistant-${jobId}`;
      updateSession(prev => {
        const current = prev?.messages || [];
        const idx = current.findIndex(m => m.id === streamingAssistantId);
        const nextMessage = {
          id: streamingAssistantId,
          role: 'assistant',
          text: '',
          streaming: true,
          ...(idx >= 0 ? current[idx] : {}),
          ...patch,
        };
        const nextMessages = idx >= 0
          ? current.map((m, i) => i === idx ? nextMessage : m)
          : [...current, nextMessage];
        return { ...(prev || {}), messages: nextMessages };
      });
    };
    const appendAssistantToken = (token) => {
      if (stoppedJobRef.current === jobId) return;
      const chunk = String(token || '');
      if (!chunk) return;
      if (!streamingAssistantId) streamingAssistantId = `assistant-${jobId}`;
      updateSession(prev => {
        const current = prev?.messages || [];
        const idx = current.findIndex(m => m.id === streamingAssistantId);
        const base = idx >= 0 ? current[idx] : { id: streamingAssistantId, role: 'assistant', text: '', streaming: true };
        const nextMessage = {
          ...base,
          text: String(base.text || '') + chunk,
          streaming: true,
        };
        const nextMessages = idx >= 0
          ? current.map((m, i) => i === idx ? nextMessage : m)
          : [...current, nextMessage];
        return { ...(prev || {}), messages: nextMessages, activeAction: 'Answering...' };
      });
    };
    try {
      const orchestrated = await runLlmOrchestrator({ q, actionQuery, priorMessages, jobId, run });
      if (orchestrated) {
        if (stoppedJobRef.current === jobId) return;
        aiRuntime.recordTrace?.(run, orchestrated.review ? 'run.review_required' : orchestrated.clarify ? 'run.clarify' : 'run.completed', {
          action: !!orchestrated.action,
          sources: orchestrated.sources?.length || 0,
        });
        putAssistant({
          text: orchestrated.answer,
          sources: orchestrated.sources || [],
          action: !!orchestrated.action,
          review: orchestrated.review || null,
          clarify: !!orchestrated.clarify,
          streaming: false,
          trace: run?.trace || [],
        });
        return;
      }

      if (route.type === 'clarify') {
        const actionResult = aiRuntime.makeClarify ? aiRuntime.makeClarify(route.message) : { answer: route.message || 'I need more detail before I can do that.' };
        updateSession(prev => ({
          ...(prev || {}),
          messages: [...(prev?.messages || []), { role: 'assistant', text: actionResult.answer, clarify: true, trace: run?.trace || [] }],
        }));
        aiRuntime.recordTrace?.(run, 'run.clarify', { message: actionResult.answer });
      } else if (route.type === 'app_action' || route.type === 'app-action') {
        putAssistant({ text: '', streaming: true, action: true });
        if (route.plan?.intent === 'zotero-document-search' || aiRuntime.isLikelyDocumentQuestion?.(actionQuery)) {
          const actionResult = await runZoteroDocumentRequest({ q, actionQuery, jobId, run });
          if (stoppedJobRef.current === jobId) return;
          aiRuntime.recordTrace?.(run, actionResult.clarify ? 'run.clarify' : 'run.completed', { action: true });
          putAssistant({ text: actionResult.answer, sources: actionResult.sources || [], action: true, clarify: !!actionResult.clarify, streaming: false, trace: run?.trace || [] });
          return;
        }
        const plan = shouldUseModelPlanner(route.plan, actionQuery)
          ? await planAppActionsWithModel(actionQuery, route.plan, jobId, run, priorMessages)
          : route.plan;
        if (plan?.type === 'clarify') {
          const actionResult = aiRuntime.makeClarify ? aiRuntime.makeClarify(plan.message) : { answer: plan.message, sources: [] };
          aiRuntime.recordTrace?.(run, 'run.clarify', { message: actionResult.answer });
          putAssistant({ text: actionResult.answer, streaming: false, clarify: true, trace: run?.trace || [] });
          return;
        }
        if (!plan?.steps?.length) {
          const actionResult = aiRuntime.makeClarify ? aiRuntime.makeClarify('I need a more specific app command before I can run that.') : { answer: 'I need a more specific app command before I can run that.', sources: [] };
          aiRuntime.recordTrace?.(run, 'run.clarify', { message: actionResult.answer });
          putAssistant({ text: actionResult.answer, streaming: false, clarify: true, trace: run?.trace || [] });
          return;
        }
        if (plan?.source === 'direct-router') {
          setActiveAction('Planned locally...');
          aiRuntime.recordTrace?.(run, 'planner.direct', { steps: plan.steps.length });
        }
        if (plan?.confidence && plan.confidence !== 'high') {
          const msg = aiRuntime.lowConfidenceMessage ? aiRuntime.lowConfidenceMessage(plan) : 'I could not confidently map that request to an app action.';
          aiRuntime.recordTrace?.(run, 'run.low_confidence', { confidence: plan.confidence });
          putAssistant({ text: msg, streaming: false, clarify: true, trace: run?.trace || [] });
          return;
        }
        const actionResult = await runAppActionPlan(actionQuery, plan, jobId, run);
        if (stoppedJobRef.current === jobId) return;
        aiRuntime.recordTrace?.(run, actionResult.review ? 'run.review_required' : 'run.completed', { action: true });
        putAssistant({ text: actionResult.answer, sources: actionResult.sources || [], action: true, review: actionResult.review || null, streaming: false, trace: run?.trace || [] });
      } else if (route.type === 'legacy_action' || route.type === 'action') {
        const actionResult = await runAction(actionQuery, route.action, jobId);
        if (stoppedJobRef.current === jobId) return;
        aiRuntime.recordTrace?.(run, 'run.completed', { legacyAction: route.action?.type || '' });
        updateSession(prev => ({
          ...(prev || {}),
          messages: [...(prev?.messages || []), { role: 'assistant', text: actionResult.answer, sources: actionResult.sources || [], action: true, trace: run?.trace || [] }],
        }));
      } else if (route.type === 'notes') {
        setActiveAction('Researching notes...');
        const qForAsk = mnBuildAskThreadPrompt(priorMessages, q);
        putAssistant({ text: '', streaming: true });
        const askStream = window.mn?.ai?.askStream;
        const r = askStream
          ? await askStream(vaultId, qForAsk, { jobId, currentNoteId: currentNote?.id || null, timeoutMs: MN_AI_NOTES_TIMEOUT_MS, onToken: appendAssistantToken })
          : await window.mn.ai.ask(vaultId, qForAsk, { jobId, currentNoteId: currentNote?.id || null, timeoutMs: MN_AI_NOTES_TIMEOUT_MS });
        if (stoppedJobRef.current === jobId) return;
        if (!r.ok) {
          throw new Error(r.error || 'Unknown error');
        } else if (r.value && !r.value.ok) {
          throw new Error(r.value.error || 'Unknown error');
        } else {
          aiRuntime.recordTrace?.(run, 'run.completed', { sources: r.value.sources?.length || 0 });
          putAssistant({ text: r.value.answer, sources: r.value.sources || [], streaming: false, trace: run?.trace || [] });
        }
      } else {
        setActiveAction('Thinking...');
        const chatMessages = mnBuildAskThreadMessages(priorMessages, q, { limit: 8 });
        putAssistant({ text: '', streaming: true });
        const chatStream = window.mn?.ai?.chatStream;
        const r = chatStream
          ? await chatStream({ messages: chatMessages, jobId, timeoutMs: MN_AI_CHAT_TIMEOUT_MS, maxTokens: 700, onToken: appendAssistantToken })
          : await window.mn.ai.chat({ messages: chatMessages, jobId, timeoutMs: MN_AI_CHAT_TIMEOUT_MS, maxTokens: 700 });
        if (stoppedJobRef.current === jobId) return;
        if (!r.ok) throw new Error(r.error || 'Unknown error');
        if (r.value && !r.value.ok) throw new Error(r.value.error || 'Unknown error');
        aiRuntime.recordTrace?.(run, 'run.completed', { chat: true });
        putAssistant({ text: r.value.answer, streaming: false, trace: run?.trace || [] });
      }
    } catch (e) {
      const msg = e.message || String(e);
      stopped = stoppedJobRef.current === jobId || /abort|cancel/i.test(msg);
      if (stopped) return;
      finalError = msg;
      aiRuntime.recordTrace?.(run, 'run.failed', { error: msg });
      if (streamingAssistantId) {
        putAssistant({ text: msg, error: true, streaming: false });
        updateSession(prev => ({ ...(prev || {}), error: msg }));
      } else {
        updateSession(prev => ({
          ...(prev || {}),
          error: msg,
          messages: [...(prev?.messages || []), { role: 'assistant', text: msg, error: true }],
        }));
      }
    } finally {
      if (!stopped && stoppedJobRef.current !== jobId) {
        updateSession(prev => ({
          ...(prev || {}),
          pending: false,
          activeAction: null,
          jobId: null,
          activeRun: null,
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
      activeRun: null,
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
      activeRun: null,
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

  const resizeComposer = () => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(Math.max(el.scrollHeight, 42), 142)}px`;
  };

  useEffectAI(() => {
    resizeComposer();
  }, [query]);

  const onKey = (e) => {
    if (!embedded && e.key === 'Escape') { e.preventDefault(); closeOrBackground(); }
  };

  const onComposerKeyDown = (e) => {
    if (e.nativeEvent?.isComposing) return;
    if (e.key !== 'Enter' || e.shiftKey || e.altKey || e.ctrlKey || e.metaKey) return;
    e.preventDefault();
    submit();
  };

  const toggleSources = (messageId) => {
    setOpenSources(prev => ({ ...prev, [messageId]: !prev?.[messageId] }));
  };

  const canAsk = status ? true : false;
  const statusText = mnAskStatusText(status);
  const footerHint = mnAskFooterHint(status, embedded);

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
                  ? <MnAiFormattedResponse text={m.text} T={T} />
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
                        disabled={m.reviewBusy}
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
              Answers cite note sources when they use your notes.
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

const {
  StatusPill,
  mnAskPrimaryButton,
  mnAskSecondaryButton,
  mnAskReportButton,
  iconBtn,
} = window.MN_AI_UI || {};

window.MnAskAI = MnAskAI;
