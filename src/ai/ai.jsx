// Ask AI: query -> RAG over your notes via local Ollama or configured providers.
// Renders as the main AI workspace and can still run as a compact overlay.

import { platformApi } from '../platform/index.js';
import { getAppActionRegistry } from '../app/actions/actionRegistryRuntime.js';
import { aiActions } from './aiActions.js';
import { aiRuntime } from './aiRuntime.js';

const { useState: useStateAI, useEffect: useEffectAI, useRef: useRefAI } = React;
import { createAiReviewActions } from './createAiReviewActions.js';
import { createAiOrchestrator } from './createAiOrchestrator.js';
import { createVirtualWriteActions } from './createVirtualWriteActions.js';
import { createZoteroAiActions } from './createZoteroAiActions.js';
import { AskAiWorkspace } from './AskAiWorkspace.jsx';
import { mnAiContentFingerprint } from './aiOwnership.js';
import * as aiModels from './aiModels.js';
import * as aiPresentation from './aiPresentation.jsx';
const { MN_ASK_EDIT_ACTIONS, MN_NOVEL_STRUCTURE_TAGS, mnIsSupportingNovelNote, mnSupportingNovelNotes, mnSupportingNotesEditInstruction, MN_ASK_SUGGESTIONS, MN_AI_PLANNER_TIMEOUT_MS, MN_AI_CHAT_TIMEOUT_MS, MN_AI_NOTES_TIMEOUT_MS, MN_AI_VIRTUAL_WRITE_TOOLS, MN_AI_REPORT_TARGETS, MN_AI_VIRTUAL_TOOLS, mnReportAiOutput, mnAskAiJobId, mnAskMessageId, mnNormalizeAskMessages, mnAskMessageThreadText, mnBuildAskThreadMessages, mnBuildAskThreadPrompt, mnRecentAskThreadNote, mnLastAskMessage, mnLooksLikeNoteEditRequest, mnMentionsThreadNote, mnAssistantAskedForActionDetail, mnBuildContextualActionQuery, mnAiCurrentNoteMarkdown, mnAiMarkdownMarkers, mnAiMissingMarkdownMarkers, mnAiBuildMarkdownPreview, mnAiShouldShareCurrentContext, mnWantsZoteroAssistedNoteEdit, mnWantsZoteroSummaryNote, mnAiCurrentContextMessage, mnAiVirtualToolMeta, mnAiCleanVirtualToolArgs, mnAiToolCallsFromPlanResult } = aiModels;
const { mnAiPlainInlineText, mnAiLooksLikeSectionLabel, mnAskStatusText, mnAiProviderLabel, mnAskFooterHint, MnAiSetupNotice, mnAiWikiLinkParts, mnAiHeadingKey, MN_AI_GENERIC_SUMMARY_HEADINGS, mnAiIsGenericSummaryHeading, mnNormalizeAiResponseBlocks, mnAiInlineText, mnParseAiResponseBlocks, MnAiFormattedResponse, MnCurrentNoteSuggestionsCard } = aiPresentation;

function MnAskAI({
  vaultId, currentNote, allNotes, onClose, onOpenNote, onCreateNote, onApplyCurrentPageBody, onApplyNoteBodies, onTagCurrentNote,
  onRestoreCurrentPageBody, onOpenCurrentNoteVersions, session, setSession, onBackgroundComplete, initialQuery, T, embedded = false,
}) {
  const [query, setQuery] = useStateAI('');
  const [status, setStatus] = useStateAI(null);
  const [openSources, setOpenSources] = useStateAI({});
  const [noteSuggestions, setNoteSuggestions] = useStateAI(null);
  const [noteSuggestionsBusy, setNoteSuggestionsBusy] = useStateAI(false);
  const [noteSuggestionsError, setNoteSuggestionsError] = useStateAI('');
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
  const backgroundJobsRef = useRefAI(new Set());
  const stoppedJobsRef = useRefAI(new Set());
  const suggestionRequestRef = useRefAI(0);

  const aiSession = session || localSession;
  const rawUpdateSession = setSession || setLocalSession;
  const updateSession = (updater) => {
    rawUpdateSession(prev => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      return { ...(next || {}), messages: mnNormalizeAskMessages(next?.messages || []) };
    });
  };
  const messages = aiSession.messages || [];
  const noteIdSet = new Set((allNotes || []).map(note => String(note?.id || '')).filter(Boolean));
  const suggestionOwner = `${vaultId || ''}:${currentNote?.id || ''}:${mnAiContentFingerprint(mnAiCurrentNoteMarkdown(currentNote))}`;
  const suggestionOwnerRef = useRefAI(suggestionOwner);
  suggestionOwnerRef.current = suggestionOwner;

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
    if (platformApi.ai) {
      platformApi.ai.status().then(r => { if (r.ok) setStatus(r.value); });
    }
  }, []);

  useEffectAI(() => {
    if (!initialQuery) return;
    setQuery(initialQuery);
    setTimeout(() => inputRef.current?.focus(), 0);
  }, [initialQuery]);

  useEffectAI(() => {
    suggestionRequestRef.current++;
    setNoteSuggestions(null);
    setNoteSuggestionsError('');
    setNoteSuggestionsBusy(false);
  }, [suggestionOwner]);

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
      if (aiSession.jobId) backgroundJobsRef.current.add(aiSession.jobId);
      updateSession(prev => ({ ...(prev || {}), background: true }));
    }
    onClose && onClose();
  };

  const classifyPrompt = (q) => {
    return (aiActions.classifyPrompt || (() => ({ type: 'notes' })))(q);
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
        !/\b(create|make|new|open|show|go to|delete|rename|duplicate|tag|untag|archive|restore|import|export|rebuild|backfill|refresh|settings|graph|calendar|agenda|schedule|canvas|todos?|zotero)\b/i.test(text)) {
      return null;
    }
    const registry = getAppActionRegistry();
    if (!registry?.findForText) return null;
    try { return registry.findForText(q); } catch (e) { return null; }
  };

  const shouldUseModelPlanner = (plan, q) => {
    if (platformApi.ai?.toolPlan) return true;
    if (!plan) return true;
    if (plan.confidence === 'high' && plan.source === 'direct-router') return false;
    if (isClearlyNoteQuestion(q)) return false;
    const text = String(q || '').toLowerCase();
    if (/\b(open|show|go to|settings|graph|calendar|agenda|schedule|todos?|tasks?|canvas|tag|untag|rename|duplicate|delete|archive|restore|import|export|rebuild|backfill|refresh)\b/.test(text)) {
      return plan.confidence !== 'high';
    }
    return false;
  };

  const planAppActionsWithModel = async (q, fallbackPlan, jobId, run, priorMessages = []) => {
    const registry = getAppActionRegistry();
    if (!registry?.describeForAi || !registry?.validate || !platformApi.ai?.toolPlan) return fallbackPlan;
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
      return await platformApi.ai.toolPlan({
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

  const { askEdit, askNotes, askVaultSummary, runSupportingNotesEdit, makeVirtualWriteReview, runConfirmedVirtualWriteTool } = createVirtualWriteActions({
    vaultId, currentNote, setActiveAction, allNotes, onApplyNoteBodies, onApplyCurrentPageBody, aiRuntime,
  });

  const { runZoteroDocumentRequest } = createZoteroAiActions({
    aiRuntime, setActiveAction, currentNote, onApplyCurrentPageBody, makeVirtualWriteReview, onCreateNote,
  });

  const { orchestratorTools, executeOrchestratorTool, runLlmOrchestrator, runActionPlan, runAppActionPlan } = createAiOrchestrator({
    currentNote, setActiveAction, aiRuntime, askEdit, askNotes, askVaultSummary, makeVirtualWriteReview, onCreateNote,
  });

  const { confirmReview, cancelReview, editReviewArgs, restoreAiEdit, openAiEditVersionHistory } = createAiReviewActions({
    updateSession, aiRuntime, runConfirmedVirtualWriteTool, onRestoreCurrentPageBody, currentNote, onOpenCurrentNoteVersions,
  });

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

    if (action.type === 'edit-supporting-notes') {
      return await makeVirtualWriteReview('edit-supporting-notes', { instruction: q }, q);
    }

    if (action.type === 'edit-current') {
      if (!currentNote || !onApplyCurrentPageBody) throw new Error('No current page is open to edit');
      const noteTitles = (allNotes || [])
        .filter(n => n.id !== currentNote.id)
        .map(n => `- ${n.title}`)
        .join('\n');
      const instruction = action.action === 'link' || action.action === 'format-link'
        ? `${action.action === 'format-link' ? MN_ASK_EDIT_ACTIONS.format + '\n\n' : ''}${MN_ASK_EDIT_ACTIONS.link}\n\nExisting note titles:\n${noteTitles}`
        : MN_ASK_EDIT_ACTIONS[action.action];
      return await makeVirtualWriteReview('edit-current-page', { instruction }, q);
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
      ? aiRuntime.routeRequest({ query: actionQuery, aiActions, appRegistry: getAppActionRegistry() })
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
    backgroundJobsRef.current.delete(jobId);
    stoppedJobsRef.current.delete(jobId);
    updateSession(prev => ({
      ...(prev || {}),
      messages: [...(prev?.messages || []), userMsg],
      pending: true,
      error: null,
      activeAction: platformApi.ai?.toolPlan ? 'Understanding request...' : (route.activeLabel || (route.type === 'notes' ? 'Researching notes...' : route.type === 'chat' ? 'Thinking...' : 'Starting task...')),
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
      if (stoppedJobsRef.current.has(jobId)) return;
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
      const skipLlmFirst = !platformApi.ai?.toolPlan ||
        route.type === 'clarify' ||
        route.plan?.intent === 'zotero-document-search';
      const orchestrated = skipLlmFirst ? null : await runLlmOrchestrator({ q, actionQuery, priorMessages, jobId, run });
      if (orchestrated) {
        if (stoppedJobsRef.current.has(jobId)) return;
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
          if (stoppedJobsRef.current.has(jobId)) return;
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
        if (stoppedJobsRef.current.has(jobId)) return;
        aiRuntime.recordTrace?.(run, actionResult.review ? 'run.review_required' : 'run.completed', { action: true });
        putAssistant({ text: actionResult.answer, sources: actionResult.sources || [], action: true, review: actionResult.review || null, streaming: false, trace: run?.trace || [] });
      } else if (route.type === 'legacy_action' || route.type === 'action') {
        const actionResult = await runAction(actionQuery, route.action, jobId);
        if (stoppedJobsRef.current.has(jobId)) return;
        aiRuntime.recordTrace?.(run, actionResult.review ? 'run.review_required' : 'run.completed', { legacyAction: route.action?.type || '' });
        updateSession(prev => ({
          ...(prev || {}),
          messages: [...(prev?.messages || []), { role: 'assistant', text: actionResult.answer, sources: actionResult.sources || [], action: true, review: actionResult.review || null, trace: run?.trace || [] }],
        }));
      } else if (route.type === 'notes') {
        setActiveAction('Researching notes...');
        const qForAsk = mnBuildAskThreadPrompt(priorMessages, q);
        putAssistant({ text: '', streaming: true });
        const askStream = platformApi.ai?.askStream;
        const r = askStream
          ? await askStream(vaultId, qForAsk, { jobId, currentNoteId: currentNote?.id || null, timeoutMs: MN_AI_NOTES_TIMEOUT_MS, onToken: appendAssistantToken })
          : await platformApi.ai.ask(vaultId, qForAsk, { jobId, currentNoteId: currentNote?.id || null, timeoutMs: MN_AI_NOTES_TIMEOUT_MS });
        if (stoppedJobsRef.current.has(jobId)) return;
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
        const chatStream = platformApi.ai?.chatStream;
        const r = chatStream
          ? await chatStream({ messages: chatMessages, jobId, timeoutMs: MN_AI_CHAT_TIMEOUT_MS, maxTokens: 700, onToken: appendAssistantToken })
          : await platformApi.ai.chat({ messages: chatMessages, jobId, timeoutMs: MN_AI_CHAT_TIMEOUT_MS, maxTokens: 700 });
        if (stoppedJobsRef.current.has(jobId)) return;
        if (!r.ok) throw new Error(r.error || 'Unknown error');
        if (r.value && !r.value.ok) throw new Error(r.value.error || 'Unknown error');
        aiRuntime.recordTrace?.(run, 'run.completed', { chat: true });
        putAssistant({ text: r.value.answer, streaming: false, trace: run?.trace || [] });
      }
    } catch (e) {
      const msg = e.message || String(e);
      stopped = stoppedJobsRef.current.has(jobId) || /abort|cancel/i.test(msg);
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
      if (!stopped && !stoppedJobsRef.current.has(jobId)) {
        updateSession(prev => ({
          ...(prev || {}),
          pending: false,
          activeAction: null,
          jobId: null,
          activeRun: null,
          completedAt: new Date().toISOString(),
        }));
      }
      if (!stopped && !stoppedJobsRef.current.has(jobId) && backgroundJobsRef.current.has(jobId)) {
        onBackgroundComplete && onBackgroundComplete({ query: q, error: finalError });
      }
      backgroundJobsRef.current.delete(jobId);
    }
  };

  const stopRun = async () => {
    const jobId = aiSession.jobId;
    if (!pending || !jobId) return;
    stoppedJobsRef.current.add(jobId);
    backgroundJobsRef.current.delete(jobId);
    try { await platformApi.ai?.cancel?.(jobId); } catch (e) {}
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

  const rejectCurrentNoteSuggestions = () => {
    if (noteSuggestionsBusy) return;
    setNoteSuggestions(null);
    setNoteSuggestionsError('');
  };

  const requestCurrentNoteSuggestions = async () => {
    if (noteSuggestionsBusy) return null;
    if (!currentNote) {
      setNoteSuggestionsError('Open a note before requesting suggestions.');
      return null;
    }
    if (!aiRuntime.buildCurrentNoteSuggestionPrompt || !aiRuntime.makeCurrentNoteSuggestionResult) {
      setNoteSuggestionsError('Current note suggestions are unavailable in this build.');
      return null;
    }
    if (!platformApi.ai?.chat) {
      setNoteSuggestionsError('AI chat is unavailable in this build.');
      return null;
    }
    const jobId = mnAskAiJobId();
    const requestId = ++suggestionRequestRef.current;
    const requestOwner = suggestionOwner;
    const ownsRequest = () => (
      requestId === suggestionRequestRef.current &&
      requestOwner === suggestionOwnerRef.current
    );
    setNoteSuggestionsBusy(true);
    setNoteSuggestionsError('');
    try {
      let statusValue = status;
      try {
        const statusResult = await platformApi.ai.status?.();
        if (statusResult?.ok && ownsRequest()) {
          statusValue = statusResult.value;
          setStatus(statusResult.value);
        }
      } catch (e) {}
      const prompt = aiRuntime.buildCurrentNoteSuggestionPrompt({ note: currentNote, allNotes });
      const response = await platformApi.ai.chat({
        jobId,
        timeoutMs: MN_AI_CHAT_TIMEOUT_MS,
        maxTokens: 900,
        messages: [
          {
            role: 'system',
            content: 'You produce grounded current-note suggestions for VispNote. Use only supplied sources, keep facts separate from suggestions, and cite evidence refs.',
          },
          { role: 'user', content: prompt },
        ],
      });
      if (!response?.ok) throw new Error(response?.error || 'Current note suggestions failed.');
      if (response.value && response.value.ok === false) throw new Error(response.value.error || 'Current note suggestions failed.');
      if (!ownsRequest()) return null;
      const aiText = String(response.value?.answer || response.answer || '').trim();
      const result = aiRuntime.makeCurrentNoteSuggestionResult({
        aiText,
        note: currentNote,
        allNotes,
        status: statusValue,
        createdAt: new Date().toISOString(),
      });
      setNoteSuggestions(result);
      return result;
    } catch (e) {
      if (!ownsRequest()) return null;
      const message = e?.message || String(e) || 'Current note suggestions failed.';
      setNoteSuggestionsError(message);
      return null;
    } finally {
      if (ownsRequest()) setNoteSuggestionsBusy(false);
    }
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

  return <AskAiWorkspace model={{
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
  }} />;
}


export { MnAskAI };
