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

function mnAskStatusText(status) {
  if (!status) return 'Checking local AI';
  if (!status.reachable) return 'Setup needed';
  if (!status.chatModelOk) return 'Setup needed';
  if (!status.embedModelOk) return 'Keyword search mode';
  return 'Semantic search ready';
}

function MnAskAI({
  vaultId, currentNote, allNotes, onClose, onOpenNote, onCreateNote, onApplyCurrentPageBody, onTagCurrentNote,
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
    if (isClearlyNoteQuestion(text) && !/\b(create|make|new|delete|rename|duplicate|tag|untag|archive|restore|import|export|rebuild|backfill|refresh|open settings|go to settings)\b/i.test(text)) {
      return null;
    }
    if (/^(what|who|when|where|why|how|which|summari[sz]e|explain|tell me)\b/i.test(text) &&
        !/\b(create|make|new|open|show|go to|delete|rename|duplicate|tag|untag|archive|restore|import|export|rebuild|backfill|refresh|settings|graph|canvas|todos?)\b/i.test(text)) {
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
    const isInspectionStep = (step) => ['search-notes', 'read-note'].includes(step?.actionId);
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
      activeAction: route.activeLabel || (route.type === 'notes' ? 'Researching notes...' : route.type === 'chat' ? 'Thinking...' : 'Starting task...'),
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
      if (route.type === 'clarify') {
        const actionResult = aiRuntime.makeClarify ? aiRuntime.makeClarify(route.message) : { answer: route.message || 'I need more detail before I can do that.' };
        updateSession(prev => ({
          ...(prev || {}),
          messages: [...(prev?.messages || []), { role: 'assistant', text: actionResult.answer, clarify: true, trace: run?.trace || [] }],
        }));
        aiRuntime.recordTrace?.(run, 'run.clarify', { message: actionResult.answer });
      } else if (route.type === 'app_action' || route.type === 'app-action') {
        putAssistant({ text: '', streaming: true, action: true });
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

  const onKey = (e) => {
    if (!embedded && e.key === 'Escape') { e.preventDefault(); closeOrBackground(); }
    else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); submit(); }
  };

  const reachable = status?.reachable;
  const chatOk = status?.chatModelOk;
  const embedOk = status?.embedModelOk;
  const canAsk = status ? true : false;
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
                ? 'Local AI setup needed — Ask can still search notes and show setup steps'
                : (!chatOk && status)
                  ? 'Local chat model setup needed — Ask can still search notes and show setup steps'
                : (!embedOk && status)
                    ? (status?.embedModelReason || `Using keyword search. For semantic search: \`ollama pull ${status?.config?.embedModel}\``)
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
          {messages.map((m, idx) => {
            const previousUser = [...messages.slice(0, idx)].reverse().find(item => item.role === 'user')?.text || '';
            const canReport = m.role === 'assistant' && !m.error && !m.stopped && String(m.text || '').trim();
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
                    {m.error ? 'Error' : m.stopped ? 'Stopped' : m.action ? 'Action' : m.streaming ? 'Answering' : 'Answer'}
                  </div>
                )}
                {m.text || (m.streaming ? activeAction || 'Thinking...' : '')}
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
