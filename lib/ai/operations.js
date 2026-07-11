function createOperationDomain(scope) {
  const ASK_MAX_TOKENS = scope.ASK_MAX_TOKENS;
  const CHAT_MAX_TOKENS = scope.CHAT_MAX_TOKENS;
  const CHAT_SYSTEM_PROMPT = scope.CHAT_SYSTEM_PROMPT;
  const CONFIG = scope.CONFIG;
  const EDIT_SYSTEM_PROMPT = scope.EDIT_SYSTEM_PROMPT;
  const TOOL_PLAN_MAX_TOKENS = scope.TOOL_PLAN_MAX_TOKENS;
  const TOOL_PLAN_TIMEOUT_MS = scope.TOOL_PLAN_TIMEOUT_MS;
  const beginCancellableJob = (...args) => scope.beginCancellableJob(...args);
  const buildRagPrompt = (...args) => scope.buildRagPrompt(...args);
  const buildVaultContext = (...args) => scope.buildVaultContext(...args);
  const currentProviderMeta = (...args) => scope.currentProviderMeta(...args);
  const fastChatAnswer = (...args) => scope.fastChatAnswer(...args);
  const finishCancellableJob = (...args) => scope.finishCancellableJob(...args);
  const memorySources = (...args) => scope.memorySources(...args);
  const normalizeToolCalls = (...args) => scope.normalizeToolCalls(...args);
  const notePreview = (...args) => scope.notePreview(...args);
  const ollama = scope.ollama;
  const providerChat = (...args) => scope.providerChat(...args);
  const providerChatStream = (...args) => scope.providerChatStream(...args);
  const providerSetupMessage = (...args) => scope.providerSetupMessage(...args);
  const providerToolPlan = (...args) => scope.providerToolPlan(...args);
  const recallMemoryContext = (...args) => scope.recallMemoryContext(...args);
  const sanitizeAiTools = (...args) => scope.sanitizeAiTools(...args);
  const status = (...args) => scope.status(...args);
  const summarizeVaultInternal = (...args) => scope.summarizeVaultInternal(...args);
  const vaultStore = scope.vaultStore;
  function providerUnavailableError(st) {
    const reason = CONFIG.provider === 'ollama'
      ? (st?.reason || `Ollama not reachable at ${ollama.getHost()}`)
      : (st?.reason || `${currentProviderMeta().label} is not configured`);
    return providerSetupMessage(reason);
  }
  
  function chatUnavailableReason(st) {
    if (!st?.reachable) return providerUnavailableError(st || {});
    const reason = CONFIG.provider === 'ollama'
      ? `Local chat model is not installed: ollama pull ${CONFIG.chatModel}`
      : (st.reason || 'Chat model is not configured');
    return providerSetupMessage(reason);
  }
  
  function buildModelSetupAnswer(query, context, st) {
    const reason = chatUnavailableReason(st);
    const snippets = (context.notes || []).slice(0, 5).map((note, index) => {
      const preview = notePreview(note, 220) || '(empty note)';
      return `${index + 1}. ${note.title || 'Untitled'} — ${preview}`;
    });
    const lines = [
      reason,
      '',
      'VispNote can still search your notes locally without a chat model. Here are the most relevant notes I found for your question:',
      snippets.length ? snippets.join('\n') : 'No matching notes were found yet.',
      '',
      CONFIG.provider === 'ollama'
        ? `After the model is installed, reopen Ask AI or click Refresh in Settings > AI. Requested question: ${String(query || '').trim()}`
        : 'Configure the selected AI provider in Settings > AI to enable generated answers.',
    ];
    return lines.filter(line => line !== null && line !== undefined).join('\n');
  }
  
  
  function buildChatSetupAnswer(st) {
    return [
      chatUnavailableReason(st),
      '',
      CONFIG.provider === 'ollama'
        ? `To enable generated chat responses, start Ollama and install the configured model with: ollama pull ${CONFIG.chatModel}`
        : 'Configure the selected AI provider in Settings > AI to enable generated chat responses.',
    ].join('\n');
  }
  
  async function modelSetupFallback(vaultId, query, st, storeApi, options) {
    const context = await buildVaultContext(
      vaultId,
      query,
      { ...(st || {}), embedModelOk: false, askMode: 'keyword' },
      storeApi,
      { ...options, recursiveResearch: false }
    );
    const sources = (context.notes || []).map(note => ({
      id: note.id,
      title: note.title,
      modifiedAt: note.modifiedAt,
      snippet: String(note.body || '').slice(0, 200),
    }));
    return {
      ok: true,
      answer: buildModelSetupAnswer(query, context, st),
      sources,
      mode: 'keyword-setup',
      setupRequired: true,
      contextCapped: context.capped,
    };
  }
  
  async function summarizeVault(vaultId, query, storeApi = vaultStore, options = {}) {
    const signal = beginCancellableJob(options.jobId);
    try {
      if (!CONFIG.enabled) return { ok: false, error: 'AI is disabled in settings' };
      const st = await status();
      return await summarizeVaultInternal(vaultId, query, st, storeApi, { ...options, signal });
    } finally {
      finishCancellableJob(options.jobId);
    }
  }
  
  // Gather vault context → chat with selected notes. Returns { answer, sources }.
  async function ask(vaultId, query, storeApi = vaultStore, options = {}) {
    const signal = beginCancellableJob(options.jobId);
    try {
      if (!CONFIG.enabled) return { ok: false, error: 'AI is disabled in settings' };
      const st = await status();
      if (!st.reachable || !st.chatModelOk) return await modelSetupFallback(vaultId, query, st, storeApi, { ...options, signal });
  
      const [context, memories] = await Promise.all([
        buildVaultContext(vaultId, query, st, storeApi, { ...options, signal }),
        recallMemoryContext(query),
      ]);
      context.memories = memories;
      if (!context.notes.length && !memories.length) {
        return { ok: true, answer: "I couldn't find anything in your notes related to that question.", sources: [] };
      }
      const messages = buildRagPrompt(query, context);
      const { text } = await providerChat(messages, {
        signal,
        model: st.chatModel,
        timeoutMs: options.timeoutMs,
        maxTokens: options.maxTokens || ASK_MAX_TOKENS,
      });
      const sources = [
        ...context.notes.map(note => ({
          kind: 'note',
          id: note.id,
          title: note.title,
          modifiedAt: note.modifiedAt,
          snippet: String(note.body || '').slice(0, 200),
        })),
        ...memorySources(memories),
      ];
      return { ok: true, answer: text.trim(), sources, mode: context.mode, contextCapped: context.capped, memoryCount: memories.length };
    } finally {
      finishCancellableJob(options.jobId);
    }
  }
  
  // Streaming variant for the Ask AI panel. It preserves the same RAG behavior as ask().
  async function askStream(vaultId, query, storeApi = vaultStore, options = {}) {
    const signal = beginCancellableJob(options.jobId);
    try {
      if (!CONFIG.enabled) return { ok: false, error: 'AI is disabled in settings' };
      const st = await status();
      if (!st.reachable || !st.chatModelOk) {
        const fallback = await modelSetupFallback(vaultId, query, st, storeApi, { ...options, signal });
        if (fallback.answer) options.onToken && options.onToken(fallback.answer);
        return fallback;
      }
  
      const [context, memories] = await Promise.all([
        buildVaultContext(vaultId, query, st, storeApi, { ...options, signal }),
        recallMemoryContext(query),
      ]);
      context.memories = memories;
      if (!context.notes.length && !memories.length) {
        return { ok: true, answer: "I couldn't find anything in your notes related to that question.", sources: [] };
      }
      const messages = buildRagPrompt(query, context);
      const { text } = await providerChatStream(messages, {
        signal,
        model: st.chatModel,
        onToken: options.onToken,
        timeoutMs: options.timeoutMs,
        maxTokens: options.maxTokens || ASK_MAX_TOKENS,
      });
      const sources = [
        ...context.notes.map(note => ({
          kind: 'note',
          id: note.id,
          title: note.title,
          modifiedAt: note.modifiedAt,
          snippet: String(note.body || '').slice(0, 200),
        })),
        ...memorySources(memories),
      ];
      return { ok: true, answer: text.trim(), sources, mode: context.mode, contextCapped: context.capped, memoryCount: memories.length };
    } finally {
      finishCancellableJob(options.jobId);
    }
  }
  
  async function editText({ text, instruction, scope, jobId, systemMessage, model, maxTokens } = {}) {
    const signal = beginCancellableJob(jobId);
    try {
      if (!CONFIG.enabled) return { ok: false, error: 'AI is disabled in settings' };
      const st = await status();
      if (!st.reachable) return { ok: false, error: providerUnavailableError(st), setupRequired: true };
      if (!st.chatModelOk) {
        return { ok: false, error: chatUnavailableReason(st), setupRequired: true };
      }
      const source = String(text || '');
      if (!source.trim()) return { ok: false, error: 'No text selected for AI editing' };
      const messages = [
        { role: 'system', content: String(systemMessage || '').trim() || EDIT_SYSTEM_PROMPT },
        { role: 'user', content:
            `Scope: ${scope || 'text'}\n` +
            `Instruction: ${instruction || 'Improve the writing.'}\n\n` +
            `Text:\n${source}`
        },
      ];
      const { text: edited } = await providerChat(messages, { signal, model: String(model || '').trim() || st.chatModel, maxTokens });
      return { ok: true, text: String(edited || '').trim() };
    } finally {
      finishCancellableJob(jobId);
    }
  }
  
  async function editTextStream({ text, instruction, scope, jobId, systemMessage, model, maxTokens, onToken } = {}) {
    const signal = beginCancellableJob(jobId);
    try {
      if (!CONFIG.enabled) return { ok: false, error: 'AI is disabled in settings' };
      const st = await status();
      if (!st.reachable) {
        return { ok: false, error: providerUnavailableError(st), setupRequired: true };
      }
      if (!st.chatModelOk) {
        return { ok: false, error: chatUnavailableReason(st), setupRequired: true };
      }
      const source = String(text || '');
      if (!source.trim()) return { ok: false, error: 'No text selected for AI editing' };
      const messages = [
        { role: 'system', content: String(systemMessage || '').trim() || EDIT_SYSTEM_PROMPT },
        { role: 'user', content:
            `Scope: ${scope || 'text'}\n` +
            `Instruction: ${instruction || 'Improve the writing.'}\n\n` +
            `Text:\n${source}`
        },
      ];
      const { text: edited } = await providerChatStream(messages, {
        signal,
        model: String(model || '').trim() || st.chatModel,
        maxTokens,
        onToken,
      });
      return { ok: true, text: String(edited || '').trim() };
    } finally {
      finishCancellableJob(jobId);
    }
  }
  
  async function chat(input) {
    const signal = beginCancellableJob(input?.jobId);
    try {
      if (!CONFIG.enabled) return { ok: false, error: 'AI is disabled in settings' };
      const provided = Array.isArray(input?.messages) ? input.messages : [{ role: 'user', content: String(input?.text || input || '') }];
      const latestUser = [...provided].reverse().find(m => m?.role === 'user' && String(m.content || '').trim());
      const fast = fastChatAnswer(latestUser?.content || '');
      if (fast) return { ok: true, answer: fast, fast: true };
      const st = await status();
      if (!st.reachable || !st.chatModelOk) {
        return { ok: true, answer: buildChatSetupAnswer(st), setupRequired: true };
      }
      const messages = [
        { role: 'system', content: CHAT_SYSTEM_PROMPT },
        ...provided
          .filter(m => m && (m.role === 'user' || m.role === 'assistant') && String(m.content || '').trim())
          .slice(-8)
          .map(m => ({ role: m.role, content: String(m.content) })),
      ];
      try {
        const { text } = await providerChat(messages, {
          signal,
          model: st.chatModel,
          timeoutMs: input?.timeoutMs,
          maxTokens: input?.maxTokens || CHAT_MAX_TOKENS,
        });
        return { ok: true, answer: String(text || '').trim() };
      } catch (e) {
        if (CONFIG.provider === 'ollama' && /model ['"]?[^'"]+['"]? not found/i.test(e.message || String(e))) {
          return { ok: true, answer: buildChatSetupAnswer({ ...st, chatModelOk: false }), setupRequired: true };
        }
        throw e;
      }
    } finally {
      finishCancellableJob(input?.jobId);
    }
  }
  
  async function toolPlan(input = {}) {
    const signal = beginCancellableJob(input?.jobId);
    try {
      if (!CONFIG.enabled) return { ok: false, error: 'AI is disabled in settings' };
      const provided = Array.isArray(input?.messages) ? input.messages : [{ role: 'user', content: String(input?.text || input || '') }];
      const messages = provided
        .filter(m => m && (m.role === 'user' || m.role === 'assistant') && String(m.content || '').trim())
        .slice(-10)
        .map(m => ({ role: m.role, content: String(m.content) }));
      if (!messages.length) return { ok: false, error: 'No user request was provided' };
      const tools = sanitizeAiTools(input?.tools || []);
      if (!tools.length) return { ok: false, error: 'No tools were provided' };
      const st = await status();
      if (!st.reachable || !st.chatModelOk) return { ok: false, error: chatUnavailableReason(st), setupRequired: true };
      const result = await providerToolPlan(messages, tools, {
        signal,
        model: st.chatModel,
        timeoutMs: input?.timeoutMs || TOOL_PLAN_TIMEOUT_MS,
        maxTokens: input?.maxTokens || TOOL_PLAN_MAX_TOKENS,
        nativeOnly: input?.nativeOnly === true,
      });
      return {
        ok: true,
        answer: String(result.answer || '').trim(),
        error: String(result.error || '').trim(),
        toolCalls: normalizeToolCalls(result.toolCalls || []),
        mode: result.mode || (result.toolCalls?.length ? 'tool_call' : (result.answer ? 'direct_answer' : 'clarify')),
        native: !!result.native,
        provider: result.provider || CONFIG.provider,
      };
    } finally {
      finishCancellableJob(input?.jobId);
    }
  }
  
  async function chatStream(input) {
    const signal = beginCancellableJob(input?.jobId);
    try {
      if (!CONFIG.enabled) return { ok: false, error: 'AI is disabled in settings' };
      const provided = Array.isArray(input?.messages) ? input.messages : [{ role: 'user', content: String(input?.text || input || '') }];
      const latestUser = [...provided].reverse().find(m => m?.role === 'user' && String(m.content || '').trim());
      const fast = fastChatAnswer(latestUser?.content || '');
      if (fast) {
        input?.onToken && input.onToken(fast);
        return { ok: true, answer: fast, fast: true };
      }
      const st = await status();
      if (!st.reachable || !st.chatModelOk) {
        const answer = buildChatSetupAnswer(st);
        if (answer) input?.onToken && input.onToken(answer);
        return { ok: true, answer, setupRequired: true };
      }
      const messages = [
        { role: 'system', content: CHAT_SYSTEM_PROMPT },
        ...provided
          .filter(m => m && (m.role === 'user' || m.role === 'assistant') && String(m.content || '').trim())
          .slice(-8)
          .map(m => ({ role: m.role, content: String(m.content) })),
      ];
      try {
        const { text } = await providerChatStream(messages, {
          signal,
          model: st.chatModel,
          onToken: input?.onToken,
          timeoutMs: input?.timeoutMs,
          maxTokens: input?.maxTokens || CHAT_MAX_TOKENS,
        });
        return { ok: true, answer: String(text || '').trim() };
      } catch (e) {
        if (CONFIG.provider === 'ollama' && /model ['"]?[^'"]+['"]? not found/i.test(e.message || String(e))) {
          const answer = buildChatSetupAnswer({ ...st, chatModelOk: false });
          if (answer) input?.onToken && input.onToken(answer);
          return { ok: true, answer, setupRequired: true };
        }
        throw e;
      }
    } finally {
      finishCancellableJob(input?.jobId);
    }
  }
  return { providerUnavailableError, chatUnavailableReason, buildModelSetupAnswer, buildChatSetupAnswer, modelSetupFallback, summarizeVault, ask, askStream, editText, editTextStream, chat, toolPlan, chatStream };
}

module.exports = { createOperationDomain };
