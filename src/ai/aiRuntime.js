// Provider-neutral Ask AI execution helpers.
// The runtime keeps routing, planning validation, review handling, and traces
// out of the React component so AI execution is deterministic and inspectable.

(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.MN_AI_RUNTIME = api;
})(typeof globalThis !== 'undefined' ? globalThis : window, function () {
  const MAX_TOOL_CALLS = 5;
  const MAX_REPAIR_ROUNDS = 1;
  const TRACE_LIMIT = 40;
  const recentTraces = [];

  function nowIso() {
    return new Date().toISOString();
  }

  function makeRun({ runId, query, mode = 'chat' } = {}) {
    return {
      runId,
      query: String(query || ''),
      status: 'running',
      mode,
      messages: [],
      steps: [],
      toolCalls: [],
      affected: [],
      sources: [],
      error: null,
      startedAt: nowIso(),
      completedAt: null,
      cancelledAt: null,
    };
  }

  function recordTrace(run, event, data = {}) {
    const item = {
      at: nowIso(),
      runId: run?.runId || '',
      mode: run?.mode || '',
      event,
      ...data,
    };
    item.label = item.label || traceLabel(item);
    if (run) {
      if (!Array.isArray(run.trace)) run.trace = [];
      run.trace.push(item);
    }
    recentTraces.push(item);
    while (recentTraces.length > TRACE_LIMIT) recentTraces.shift();
    return item;
  }

  function completeRun(run, patch = {}) {
    return {
      ...(run || {}),
      ...patch,
      status: patch.status || 'completed',
      completedAt: patch.completedAt || nowIso(),
    };
  }

  function failRun(run, error) {
    return completeRun(run, {
      status: 'failed',
      error: String(error?.message || error || 'AI run failed'),
    });
  }

  function isClearlyNoteQuestion(q) {
    const text = String(q || '').trim().toLowerCase();
    if (!text) return false;
    if (/\b(summari[sz]e|summary|explain|find|search|list|show|what|who|when|where|why|how)\b/.test(text) &&
        /\b(my|all|this|current|latest|recent|vault|notes?|pages?|tasks?|todos?|tags?|links?|backlinks?)\b/.test(text)) {
      return true;
    }
    return /^(can you|could you|please)?\s*(summari[sz]e|explain|tell me|what|who|when|where|why|how)\b/.test(text) &&
      /\bnotes?|vault|page|tasks?|todos?\b/.test(text);
  }

  function isCasualChat(q) {
    const normalized = String(q || '').toLowerCase().trim().replace(/[!?.\s]+$/g, '');
    return /^(hi|hello|hey|yo|sup|thanks|thank you|ok|okay|cool|nice|good morning|good afternoon|good evening)$/.test(normalized) ||
      /\b(who are you|what can you do|help|how do you work|what are your capabilities)\b/.test(normalized);
  }

  function isLikelyDocumentQuestion(q) {
    const text = String(q || '').toLowerCase();
    if (!text) return false;
    const hasDocumentNoun = /\bzotero\b/.test(text) || /\b(papers?|articles?|documents?|publications?|references?|citations?|pdfs?|stud(?:y|ies))\b/.test(text);
    if (!hasDocumentNoun) return false;
    if (/\b(summari[sz]e|summary|get|read|explain|find|search|show|what|why|how|tell me|review)\b/.test(text)) return true;
    return documentSearchQuery(text).split(/\s+/).filter(Boolean).length >= 2;
  }

  function zoteroUnavailableMessage() {
    return 'I cannot search Zotero because the Zotero reader plugin is not enabled. Enable it in Settings > Plugins and keep Zotero Desktop running.';
  }

  function hasRegistryAction(registry, actionId) {
    try {
      return !!registry?.list?.({ includeHidden: true })?.some?.(item => item?.id === actionId && item.enabled !== false);
    } catch (e) {
      return false;
    }
  }

  function documentSearchQuery(q) {
    return String(q || '')
      .replace(/^(?:(?:ok(?:ay)?|alright|sure|yes|yeah|yep|now|then|so|cool|great|thanks|thank you)[\s.,:;!-]+)+/ig, ' ')
      .replace(/\b(can you|could you|please)\b/ig, ' ')
      .replace(/\b(tell me|what is|what are|give me|use zotero|go to zotero|from zotero|in zotero|search zotero|look up|lookup)\b/ig, ' ')
      .replace(/\b(get|give me|make|create|write)\b\s+(?:a\s+)?\b(summari[sz]e|summary)\b/ig, ' ')
      .replace(/\b(summari[sz]e|summary|explain|read|review|find|search|show|paper|article|document|publication|reference|citation|pdf)\b/ig, ' ')
      .replace(/^(?:now|then|about|for|on)\s+/ig, ' ')
      .replace(/\b(in|from|of|about|on|the|a|an)\b/ig, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function makeZoteroSearchPlan(query) {
    const cleanQuery = documentSearchQuery(query) || String(query || '').trim();
    return {
      type: 'app-action-plan',
      intent: 'zotero-document-search',
      confidence: 'high',
      source: 'document-router',
      title: 'Search Zotero',
      steps: [{ actionId: 'zotero-search', args: { query: cleanQuery, limit: 8 }, label: 'Search Zotero' }],
      requiresConfirmation: false,
      message: '',
    };
  }

  function isLikelyAppOperation(q) {
    const text = String(q || '').toLowerCase();
    if (isLikelyDocumentQuestion(text)) return true;
    if (isClearlyNoteQuestion(text) && !/\b(create|make|new|delete|rename|duplicate|tag|untag|label|mark|move|set|change|update|archive|restore|import|export|rebuild|backfill|refresh|open settings|go to settings|add|append|todo|task|remind|reminder|link|wikilink|search|find|read|zotero)\b/.test(text)) {
      return false;
    }
    return /\b(open|show|go to|create|make|new|delete|rename|duplicate|tag|untag|label|mark|move|set|change|update|archive|restore|import|export|rebuild|backfill|refresh|settings|graph|canvas|todos?|tasks?|plugin|backup|vault health|add|append|remind|reminder|link|wikilink|search|find|read|zotero|papers?|articles?|documents?|publications?|references?|pdfs?)\b/.test(text);
  }

  function isVagueCommand(q) {
    const text = String(q || '').toLowerCase().trim().replace(/[!?.\s]+$/g, '');
    return /^(fix|do|make|change|update|clean|improve|rewrite|summari[sz]e)(\s+(it|this|that|please))?$/.test(text) ||
      /^(fix|do|make|change|update|clean|improve|rewrite|summari[sz]e)\s+(it|this|that)$/.test(text);
  }

  function routeRequest({ query, aiActions, appRegistry } = {}) {
    const text = String(query || '').trim();
    if (isVagueCommand(text)) {
      return {
        mode: 'clarify',
        type: 'clarify',
        activeLabel: 'Clarifying...',
        message: 'What should I apply that to? For example: "fix grammar in this note", "summarize this page", or "clean up the current note".',
      };
    }
    const classified = aiActions?.classifyPrompt ? aiActions.classifyPrompt(text) : { type: 'notes' };
    if (classified?.type === 'chat' || isCasualChat(text)) return { mode: 'chat', type: 'chat', activeLabel: 'Thinking...' };
    if (classified?.type === 'action' && classified?.action?.type === 'action-plan') {
      return { mode: 'app_action', type: 'legacy_action', action: classified.action, activeLabel: 'Starting task...' };
    }

    if (isLikelyDocumentQuestion(text)) {
      if (hasRegistryAction(appRegistry, 'zotero-search')) {
        return { mode: 'app_action', type: 'app_action', plan: makeZoteroSearchPlan(text), activeLabel: 'Searching Zotero...' };
      }
      return { mode: 'clarify', type: 'clarify', activeLabel: 'Zotero unavailable', message: zoteroUnavailableMessage() };
    }

    let appPlan = null;
    if (appRegistry?.findForText && isLikelyAppOperation(text)) {
      try { appPlan = appRegistry.findForText(text); } catch (e) { appPlan = null; }
    }
    if (appPlan || isLikelyAppOperation(text)) {
      return { mode: 'app_action', type: 'app_action', plan: appPlan, activeLabel: appPlan ? 'Starting task...' : 'Planning app actions...' };
    }
    if (classified?.type === 'action') return { mode: 'app_action', type: 'legacy_action', action: classified.action, activeLabel: 'Starting task...' };
    return { mode: 'rag_answer', type: 'notes', activeLabel: 'Researching notes...' };
  }

  function traceLabel(item) {
    const event = String(item?.event || '');
    if (item?.label) return item.label;
    if (event === 'route.selected') {
      const type = item?.type || item?.routeType;
      if (type === 'app_action' || type === 'legacy_action') return 'Mapped request to app tools';
      if (type === 'notes') return 'Searching note context';
      if (type === 'chat') return 'Preparing a direct answer';
      return 'Chose execution route';
    }
    if (event === 'planner.direct') return 'Using a fast built-in action';
    if (event === 'planner.request') return 'Asking the model to choose app tools';
    if (event === 'planner.result') return 'Validated the model tool plan';
    if (event === 'planner.repair') return 'Repairing invalid tool arguments';
    if (event === 'tool.preview') return `Checking ${item?.actionLabel || item?.actionId || 'action'} before running`;
    if (event === 'tool.run') return `Running ${item?.actionLabel || item?.actionId || 'action'}`;
    if (event === 'tool.done') return `Finished ${item?.actionLabel || item?.actionId || 'action'}`;
    if (event === 'run.review_required') return 'Waiting for your confirmation';
    if (event === 'run.clarify') return 'Needs a little more detail';
    if (event === 'run.failed') return 'Action failed';
    if (event === 'run.completed') return 'Completed';
    return event.replace(/[._-]+/g, ' ').trim() || 'Working';
  }

  function parsePlannerJson(text) {
    const raw = String(text || '').trim()
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim();
    if (!raw) return null;
    try { return JSON.parse(raw); } catch (e) {}
    const objectMatch = raw.match(/\{[\s\S]*\}/);
    if (!objectMatch) return null;
    try { return JSON.parse(objectMatch[0]); } catch (e) { return null; }
  }

  function normalizeToolCalls(parsed) {
    const rawCalls = Array.isArray(parsed?.calls) ? parsed.calls
      : Array.isArray(parsed?.plan) ? parsed.plan
        : Array.isArray(parsed?.tool_calls) ? parsed.tool_calls
          : [];
    return rawCalls.slice(0, MAX_TOOL_CALLS).map(call => ({
      actionId: String(call?.actionId || call?.tool || call?.name || call?.function?.name || '').trim(),
      args: call?.args && typeof call.args === 'object'
        ? call.args
        : call?.input && typeof call.input === 'object'
          ? call.input
          : call?.function?.arguments && typeof call.function.arguments === 'object'
            ? call.function.arguments
            : {},
      reason: String(call?.reason || '').trim(),
    })).filter(call => call.actionId);
  }

  function buildPlannerPrompt({ query, functions, feedback = '' } = {}) {
    return [
      'You are VispNote\'s app-action planner.',
      'Return only JSON in this exact shape:',
      '{"intent":"...","mode":"app_action|clarify","confidence":"high|medium|low","missing":[],"plan":[{"tool":"registered_tool_id","args":{},"reason":"short user-visible reason"}]}',
      'Use only registered tool ids. Do not invent shell, filesystem, network, plugin internals, or direct file access.',
      'If the user is asking a note/RAG question, return {"mode":"clarify","confidence":"low","missing":[],"plan":[]}.',
      'Use high confidence only when the action and required arguments are explicit.',
      'Use clarify when required arguments are missing.',
      feedback ? `Previous invalid planner output feedback: ${feedback}` : '',
      '',
      `Registered tools:\n${JSON.stringify(functions || [], null, 2)}`,
      '',
      `User request: ${query}`,
    ].filter(Boolean).join('\n');
  }

  function plannerOutputToPlan({ answer, registry, fallbackPlan } = {}) {
    const parsed = parsePlannerJson(answer);
    if (!parsed) return { kind: 'invalid', message: 'Planner did not return valid JSON.' };
    if (parsed.mode === 'clarify') {
      return {
        kind: 'clarify',
        message: (Array.isArray(parsed.missing) && parsed.missing.length)
          ? `I need ${parsed.missing.join(', ')} before I can do that.`
          : 'I could not map that safely to an app action. Please phrase it as a direct command.',
      };
    }
    const calls = normalizeToolCalls(parsed);
    if (!calls.length) {
      return fallbackPlan ? { kind: 'plan', plan: fallbackPlan } : { kind: 'clarify', message: 'I need a more specific app action before I can run that.' };
    }
    const steps = [];
    for (const call of calls) {
      try {
        const args = registry.validate(call.actionId, call.args || {});
        const meta = registry.list?.({ includeHidden: true })?.find?.(item => item.id === call.actionId);
        steps.push({ actionId: call.actionId, args, label: meta?.label || call.actionId, reason: call.reason });
      } catch (e) {
        return { kind: 'invalid', message: e.message || String(e) };
      }
    }
    return {
      kind: 'plan',
      plan: {
        type: 'app-action-plan',
        intent: String(parsed.intent || fallbackPlan?.intent || 'app-action'),
        confidence: ['high', 'medium', 'low'].includes(parsed.confidence) ? parsed.confidence : 'medium',
        source: 'model-planner',
        title: fallbackPlan?.title || steps[0]?.label || 'App action',
        steps,
      },
    };
  }

  function toolPlanResultToPlan({ result, registry, fallbackPlan } = {}) {
    const value = result?.value || result || {};
    if (value.ok === false) {
      return fallbackPlan ? { kind: 'plan', plan: fallbackPlan } : { kind: 'clarify', message: value.error || 'The AI tool planner is not available.' };
    }
    const calls = normalizeToolCalls({ tool_calls: value.toolCalls || value.calls || [] });
    if (!calls.length) {
      const answer = String(value.answer || '').trim();
      if (answer) return { kind: 'clarify', message: answer };
      return fallbackPlan ? { kind: 'plan', plan: fallbackPlan } : { kind: 'clarify', message: 'I need a more specific app action before I can run that.' };
    }
    const steps = [];
    for (const call of calls) {
      try {
        const args = registry.validate(call.actionId, call.args || {});
        const meta = registry.list?.({ includeHidden: true })?.find?.(item => item.id === call.actionId);
        steps.push({ actionId: call.actionId, args, label: meta?.label || call.actionId, reason: call.reason });
      } catch (e) {
        return { kind: 'invalid', message: e.message || String(e) };
      }
    }
    return {
      kind: 'plan',
      plan: {
        type: 'app-action-plan',
        intent: fallbackPlan?.intent || 'app-action',
        confidence: 'high',
        source: value.native ? 'provider-tools' : 'json-tool-planner',
        title: fallbackPlan?.title || steps[0]?.label || 'App action',
        steps,
      },
    };
  }

  function makeClarify(message, extra = {}) {
    return {
      answer: String(message || 'I need a little more detail before I can do that.'),
      action: false,
      clarify: true,
      sources: [],
      ...extra,
    };
  }

  function lowConfidenceMessage(plan) {
    const first = plan?.steps?.[0];
    if (first?.label) return `I interpreted that as "${first.label}", but I am not confident enough to run it. Please confirm with a more direct command.`;
    return 'I could not confidently map that request to an app action. Try a direct command like "open settings", "create a note called Ideas", or "tag this note as reading".';
  }

  function makeReview({ query, plan, result } = {}) {
    return {
      query,
      title: result?.preview?.title || result?.title || 'Review action',
      message: result?.preview?.message || result?.message || '',
      risk: result?.risk,
      steps: plan?.steps || [],
      preview: result?.preview || null,
    };
  }

  function stripPropertyLines(body) {
    return String(body || '').replace(/^[a-zA-Z_][a-zA-Z0-9_-]*::\s.*$/gm, '').trim();
  }

  function notePreview(note, max = 180) {
    const body = stripPropertyLines(note?.body || '');
    const first = body
      .split(/\n+/)
      .map(line => line.replace(/^#{1,6}\s+/, '').trim())
      .find(Boolean) || '';
    return first.length > max ? `${first.slice(0, max).trimEnd()}...` : first;
  }

  function taskLines(note, limit = 4) {
    const out = [];
    for (const line of String(note?.body || '').split('\n')) {
      const match = line.match(/^\s*[-*]\s+\[[ xX]\]\s+(.+)/);
      if (match?.[1]) out.push(match[1].trim());
      if (out.length >= limit) break;
    }
    return out;
  }

  function headingLines(note, limit = 4) {
    const out = [];
    for (const line of String(note?.body || '').split('\n')) {
      const match = line.match(/^#{1,3}\s+(.+)/);
      if (match?.[1]) out.push(match[1].trim());
      if (out.length >= limit) break;
    }
    return out;
  }

  function sortByModified(notes) {
    return [...(notes || [])].sort((a, b) => {
      const bm = new Date(b?.modifiedAt || b?.date || 0).getTime();
      const am = new Date(a?.modifiedAt || a?.date || 0).getTime();
      return bm - am;
    });
  }

  function buildFastVaultSummary(notes = [], options = {}) {
    const sorted = sortByModified(notes).filter(note => note && note.id);
    const tagCounts = new Map();
    const tasks = [];
    const headings = [];
    for (const note of sorted) {
      for (const tag of note.tags || []) {
        const clean = String(tag || '').trim();
        if (clean) tagCounts.set(clean, (tagCounts.get(clean) || 0) + 1);
      }
      for (const task of taskLines(note)) {
        if (tasks.length < 20) tasks.push({ note, task });
      }
      for (const heading of headingLines(note)) {
        if (headings.length < 24) headings.push({ note, heading });
      }
    }
    const title = options.title || 'Notes summary';
    const recentLimit = Math.max(1, Math.min(Number(options.recentLimit) || 12, 30));
    const sourceLimit = Math.max(1, Math.min(Number(options.sourceLimit) || 40, 100));
    const recent = sorted.slice(0, recentLimit);
    const topTags = [...tagCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12);
    const lines = [
      `# ${title}`,
      '',
      `Generated: ${new Date().toLocaleString()}`,
      `Notes reviewed: ${sorted.length}`,
      '',
      '## Recent notes',
      ...(recent.length ? recent.map(note => {
        const preview = notePreview(note);
        return `- [[${note.title || 'Untitled'}]]${preview ? ` - ${preview}` : ''}`;
      }) : ['- No notes found.']),
      '',
      '## Common tags',
      ...(topTags.length ? topTags.map(([tag, count]) => `- #${tag} (${count})`) : ['- No tags found.']),
      '',
      '## Open tasks and checklist items',
      ...(tasks.length ? tasks.map(item => `- [ ] ${item.task} ([[${item.note.title || 'Untitled'}]])`) : ['- No task items found.']),
      '',
      '## Notable headings',
      ...(headings.length ? headings.map(item => `- ${item.heading} ([[${item.note.title || 'Untitled'}]])`) : ['- No headings found.']),
      '',
      '## Source notes',
      ...sorted.slice(0, sourceLimit).map(note => `- [[${note.title || 'Untitled'}]]`),
      sorted.length > sourceLimit ? `- ...and ${sorted.length - sourceLimit} more notes.` : '',
    ].filter(line => line !== '');
    return {
      answer: lines.join('\n'),
      sources: sorted.slice(0, sourceLimit).map(note => ({
        id: note.id,
        title: note.title || 'Untitled',
        snippet: notePreview(note, 200),
      })),
      mode: 'local-vault-summary',
    };
  }

  function getRecentTraces() {
    return recentTraces.slice();
  }

  return {
    MAX_TOOL_CALLS,
    MAX_REPAIR_ROUNDS,
    makeRun,
    completeRun,
    failRun,
    recordTrace,
    routeRequest,
    isClearlyNoteQuestion,
    isLikelyDocumentQuestion,
    zoteroUnavailableMessage,
    documentSearchQuery,
    isLikelyAppOperation,
    isVagueCommand,
    parsePlannerJson,
    buildPlannerPrompt,
    plannerOutputToPlan,
    toolPlanResultToPlan,
    traceLabel,
    makeClarify,
    lowConfidenceMessage,
    makeReview,
    buildFastVaultSummary,
    getRecentTraces,
  };
});
