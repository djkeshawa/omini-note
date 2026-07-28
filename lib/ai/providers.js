function createProviderDomain(scope) {
  const CONFIG = scope.CONFIG;
  const MAX_RAG_PROMPT_CHARS = scope.MAX_RAG_PROMPT_CHARS;
  const MEMORY_PROMPT_CHARS = scope.MEMORY_PROMPT_CHARS;
  const OLLAMA_KEEP_ALIVE = scope.OLLAMA_KEEP_ALIVE;
  const SYSTEM_PROMPT = scope.SYSTEM_PROMPT;
  const TOOL_PLAN_MAX_TOKENS = scope.TOOL_PLAN_MAX_TOKENS;
  const TOOL_PLAN_TIMEOUT_MS = scope.TOOL_PLAN_TIMEOUT_MS;
  const chatNumPredict = (...args) => scope.chatNumPredict(...args);
  const currentProviderMeta = (...args) => scope.currentProviderMeta(...args);
  const integrationAnthropicToolDefinitions = (...args) => scope.integrationAnthropicToolDefinitions(...args);
  const integrationFallbackToolPlannerMessages = (...args) => scope.integrationFallbackToolPlannerMessages(...args);
  const integrationGeminiToolDefinitions = (...args) => scope.integrationGeminiToolDefinitions(...args);
  const integrationNormalizeToolCalls = (...args) => scope.integrationNormalizeToolCalls(...args);
  const integrationOpenAiToolDefinitions = (...args) => scope.integrationOpenAiToolDefinitions(...args);
  const integrationParseJsonObject = (...args) => scope.integrationParseJsonObject(...args);
  const integrationSanitizeAiTools = (...args) => scope.integrationSanitizeAiTools(...args);
  const integrationSanitizeToolSchema = (...args) => scope.integrationSanitizeToolSchema(...args);
  const integrationToolPlannerSystemPrompt = (...args) => scope.integrationToolPlannerSystemPrompt(...args);
  const ollama = scope.ollama;
  const parseJsonSseEvent = (...args) => scope.parseJsonSseEvent(...args);
  const providerApiKey = (...args) => scope.providerApiKey(...args);
  const providerBaseUrl = (...args) => scope.providerBaseUrl(...args);
  const providerChatModel = (...args) => scope.providerChatModel(...args);
  const providerFetch = (...args) => scope.providerFetch(...args);
  const providerFetchStream = (...args) => scope.providerFetchStream(...args);
  const providerTransport = scope.providerTransport;
  const readSseData = (...args) => scope.readSseData(...args);
  const reducePiiMessages = (...args) => scope.reducePiiMessages(...args);
  const restorePiiResult = (...args) => scope.restorePiiResult(...args);
  const restorePiiText = (...args) => scope.restorePiiText(...args);
  const shouldReducePiiForProvider = (...args) => scope.shouldReducePiiForProvider(...args);
  const stripPromptPropertyLines = (...args) => scope.stripPromptPropertyLines(...args);
  function buildRagPrompt(query, context) {
    let usedChars = 0;
    let promptCapped = false;
    const ctx = context.notes.map((note, i) => {
      const tags = (note.tags || []).map(t => `#${t}`).join(' ') || 'none';
      const header = [
        `--- Context item ${i + 1} ---`,
        `title: ${note.title || 'Untitled'}`,
        `id: ${note.id}`,
        `noteDate: ${note.date || 'unknown'}`,
        `modifiedAt: ${note.modifiedAt || 'unknown'}`,
        `tags: ${tags}`,
        '',
      ].join('\n');
      const remaining = Math.max(0, MAX_RAG_PROMPT_CHARS - usedChars - header.length - 240);
      let body = stripPromptPropertyLines(note.body) || '(empty note)';
      if (body.length > remaining) {
        body = `${body.slice(0, Math.max(0, remaining)).trimEnd()}\n...[truncated for prompt budget]`;
        promptCapped = true;
      }
      const item = `${header}${body}`;
      usedChars += item.length + 2;
      return item;
    }).join('\n\n');
    const memories = Array.isArray(context.memories) ? context.memories : [];
    const selection = [
      `Selection mode: ${context.mode}`,
      `Selection reason: ${context.reason}`,
      `Notes provided: ${context.notes.length} of ${context.totalNotes}`,
      memories.length ? `Memory items provided: ${memories.length}` : null,
      context.researchToolCalls ? `Read-only research tool calls: ${context.researchToolCalls}` : null,
      `Context capped: ${context.capped || promptCapped ? 'yes' : 'no'}`,
      promptCapped ? 'Prompt budget: context was truncated to stay within the model prompt budget' : null,
    ].filter(Boolean).join('\n');
    const research = (context.researchSummaries || []).length
      ? `Research summaries:\n${context.researchSummaries.map((item, index) => (
        `Summary ${index + 1} from notes ${item.noteIds.join(', ')}:\n${item.summary}`
      )).join('\n\n')}\n\n`
      : '';
    const memoryCtx = memories.length
      ? `Context from the assistant's long-term memory (cite as [Memory], not a note title):\n\n${memories.map((memory, index) => {
        const kind = [memory.category, memory.layer].filter(Boolean).join('/');
        let content = memory.content;
        if (content.length > MEMORY_PROMPT_CHARS) content = `${content.slice(0, MEMORY_PROMPT_CHARS).trimEnd()}\n...[truncated for prompt budget]`;
        return [
          `--- Memory item ${index + 1} ---`,
          kind ? `kind: ${kind}` : null,
          memory.createdAt ? `recorded: ${memory.createdAt}` : null,
          memory.tags.length ? `tags: ${memory.tags.map(t => `#${t}`).join(' ')}` : null,
          '',
          content,
        ].filter(line => line !== null).join('\n');
      }).join('\n\n')}\n\n`
      : '';
    return [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content:
          `Context selection:\n${selection}\n\n` +
          research +
          memoryCtx +
          `Context from my notes:\n\n${ctx || '(no matching notes)'}\n\n` +
          `Question: ${query}\n\n` +
          `Answer using only the context above.`
      },
    ];
  }
  
  function createPiiTokenEmitter(replacements, onToken) {
    return providerTransport.createPiiTokenEmitter(replacements, onToken, restorePiiText);
  }
  
  function openAiCompatibleEndpoint(baseUrl) {
    if (/\/chat\/completions\/?$/.test(baseUrl)) return baseUrl;
    return `${baseUrl}/chat/completions`;
  }
  
  function collectSystem(messages) {
    return messages
      .filter(m => m.role === 'system')
      .map(m => String(m.content || '').trim())
      .filter(Boolean)
      .join('\n\n');
  }
  
  function nonSystemMessages(messages) {
    return messages
      .filter(m => m && (m.role === 'user' || m.role === 'assistant') && String(m.content || '').trim())
      .map(m => ({ role: m.role, content: String(m.content) }));
  }
  
  function sanitizeToolSchema(schema, depth = 0) {
    return integrationSanitizeToolSchema(schema, depth);
  }
  
  function sanitizeAiTools(tools = []) {
    return integrationSanitizeAiTools(tools);
  }
  
  function toolPlannerSystemPrompt() {
    return integrationToolPlannerSystemPrompt();
  }
  
  function fallbackToolPlannerMessages(messages, tools, feedback = '') {
    return integrationFallbackToolPlannerMessages(messages, tools, feedback);
  }
  
  function parseJsonObject(text) {
    return integrationParseJsonObject(text);
  }
  
  function normalizeToolCalls(calls = [], replacements = []) {
    return integrationNormalizeToolCalls(calls, replacements);
  }
  
  function openAiToolDefinitions(tools) {
    return integrationOpenAiToolDefinitions(tools);
  }
  
  function anthropicToolDefinitions(tools) {
    return integrationAnthropicToolDefinitions(tools);
  }
  
  function geminiToolDefinitions(tools) {
    return integrationGeminiToolDefinitions(tools);
  }
  
  async function providerChat(messages, options = {}) {
    const pii = reducePiiMessages(messages, shouldReducePiiForProvider());
    const providerMessages = pii.messages;
    if (CONFIG.provider === 'ollama') {
      return await ollama.chat(options.model || CONFIG.chatModel, providerMessages, {
        keep_alive: OLLAMA_KEEP_ALIVE,
        signal: options.signal,
        timeoutMs: options.timeoutMs,
        options: { num_predict: chatNumPredict(options.maxTokens) },
      });
    }
    const meta = currentProviderMeta();
    const apiKey = providerApiKey(meta);
    const baseUrl = providerBaseUrl(meta);
    const model = options.model || providerChatModel(meta);
    if (!apiKey) throw new Error(`${meta.label} API key is missing`);
    if (!model) throw new Error(`${meta.label} chat model is missing`);
    if (CONFIG.provider === 'custom' && !baseUrl) throw new Error('Custom provider base URL is missing');
  
    if (meta.compatible === 'anthropic') {
      const system = collectSystem(providerMessages);
      const data = await providerFetch(`${baseUrl}/v1/messages`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        signal: options.signal,
        body: JSON.stringify({
          model,
          max_tokens: chatNumPredict(options.maxTokens),
          ...(system ? { system } : {}),
          messages: nonSystemMessages(providerMessages),
        }),
      }, meta.label, { timeoutMs: options.timeoutMs });
      const text = (data.content || [])
        .filter(part => part?.type === 'text')
        .map(part => part.text || '')
        .join('\n')
        .trim();
      return restorePiiResult({ text, raw: data }, pii.replacements);
    }
  
    if (meta.compatible === 'gemini') {
      const system = collectSystem(providerMessages);
      const contents = nonSystemMessages(providerMessages).map(m => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }],
      }));
      const data = await providerFetch(`${baseUrl}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        signal: options.signal,
        body: JSON.stringify({
          ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
          contents,
          generationConfig: { maxOutputTokens: chatNumPredict(options.maxTokens) },
        }),
      }, meta.label, { timeoutMs: options.timeoutMs });
      const text = (data.candidates?.[0]?.content?.parts || [])
        .map(part => part.text || '')
        .join('')
        .trim();
      return restorePiiResult({ text, raw: data }, pii.replacements);
    }
  
    const headers = {
      'content-type': 'application/json',
      'authorization': `Bearer ${apiKey}`,
    };
    if (CONFIG.provider === 'openrouter') {
      headers['HTTP-Referer'] = 'https://github.com/djkeshawa/visp-note';
      headers['X-Title'] = 'VispNote';
    }
    const data = await providerFetch(openAiCompatibleEndpoint(baseUrl), {
      method: 'POST',
      headers,
      signal: options.signal,
      body: JSON.stringify({
        model,
        messages: providerMessages,
        max_tokens: chatNumPredict(options.maxTokens),
        stream: false,
      }),
    }, meta.label, { timeoutMs: options.timeoutMs });
    return restorePiiResult({ text: String(data.choices?.[0]?.message?.content || '').trim(), raw: data }, pii.replacements);
  }
  
  async function fallbackJsonToolPlan(messages, tools, options = {}) {
    const attempts = ['', options.feedback || ''].filter((item, index, arr) => index === 0 || item);
    let lastError = '';
    for (const feedback of attempts) {
      const result = await providerChat(fallbackToolPlannerMessages(messages, tools, feedback || lastError), {
        signal: options.signal,
        model: options.model,
        timeoutMs: options.timeoutMs || TOOL_PLAN_TIMEOUT_MS,
        maxTokens: options.maxTokens || TOOL_PLAN_MAX_TOKENS,
      });
      const parsed = parseJsonObject(result.text || '');
      if (parsed) {
        const toolCalls = normalizeToolCalls(parsed.toolCalls || parsed.calls || parsed.plan || []);
        const answer = String(parsed.answer || '').trim();
        return {
          answer,
          toolCalls,
          mode: toolCalls.length
            ? 'tool_call'
            : (answer ? 'direct_answer' : 'clarify'),
          native: false,
          provider: CONFIG.provider,
          raw: result.raw || null,
        };
      }
      lastError = 'Planner did not return valid JSON.';
    }
    return { answer: '', error: 'Planner did not return valid JSON.', toolCalls: [], mode: 'planner_failed', native: false, provider: CONFIG.provider, raw: null };
  }
  
  async function providerToolPlan(messages, tools, options = {}) {
    const cleanTools = sanitizeAiTools(tools);
    const providerMessagesBase = [
      { role: 'system', content: toolPlannerSystemPrompt() },
      ...nonSystemMessages(messages).slice(-10),
    ];
    if (!cleanTools.length) return { answer: '', error: 'No tools were provided.', toolCalls: [], mode: 'no_tools', native: false, provider: CONFIG.provider };
    if (CONFIG.provider === 'ollama') return await fallbackJsonToolPlan(providerMessagesBase, cleanTools, options);
  
    const pii = reducePiiMessages(providerMessagesBase, shouldReducePiiForProvider());
    const providerMessages = pii.messages;
    const meta = currentProviderMeta();
    const apiKey = providerApiKey(meta);
    const baseUrl = providerBaseUrl(meta);
    const model = options.model || providerChatModel(meta);
    if (!apiKey) throw new Error(`${meta.label} API key is missing`);
    if (!model) throw new Error(`${meta.label} chat model is missing`);
    if (CONFIG.provider === 'custom' && !baseUrl) throw new Error('Custom provider base URL is missing');
  
    try {
      if (meta.compatible === 'anthropic') {
        const system = collectSystem(providerMessages);
        const data = await providerFetch(`${baseUrl}/v1/messages`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
          },
          signal: options.signal,
          body: JSON.stringify({
            model,
            max_tokens: chatNumPredict(options.maxTokens || TOOL_PLAN_MAX_TOKENS),
            ...(system ? { system } : {}),
            messages: nonSystemMessages(providerMessages),
            tools: anthropicToolDefinitions(cleanTools),
            tool_choice: { type: 'auto' },
          }),
        }, meta.label, { timeoutMs: options.timeoutMs || TOOL_PLAN_TIMEOUT_MS });
        const content = Array.isArray(data.content) ? data.content : [];
        const answer = content.filter(part => part?.type === 'text').map(part => part.text || '').join('\n').trim();
        const toolCalls = content
          .filter(part => part?.type === 'tool_use')
          .map(part => ({ id: part.id, name: part.name, args: part.input || {} }));
        return {
          answer: restorePiiText(answer, pii.replacements),
          toolCalls: normalizeToolCalls(toolCalls, pii.replacements),
          mode: toolCalls.length ? 'tool_call' : (answer ? 'direct_answer' : 'clarify'),
          native: true,
          provider: CONFIG.provider,
          raw: data,
        };
      }
  
      if (meta.compatible === 'gemini') {
        const system = collectSystem(providerMessages);
        const contents = nonSystemMessages(providerMessages).map(m => ({
          role: m.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: m.content }],
        }));
        const data = await providerFetch(`${baseUrl}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          signal: options.signal,
          body: JSON.stringify({
            ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
            contents,
            tools: geminiToolDefinitions(cleanTools),
            generationConfig: { maxOutputTokens: chatNumPredict(options.maxTokens || TOOL_PLAN_MAX_TOKENS) },
          }),
        }, meta.label, { timeoutMs: options.timeoutMs || TOOL_PLAN_TIMEOUT_MS });
        const parts = data.candidates?.[0]?.content?.parts || [];
        const answer = parts.map(part => part.text || '').join('').trim();
        const toolCalls = parts
          .filter(part => part.functionCall)
          .map((part, index) => ({ id: `gemini_${index + 1}`, name: part.functionCall.name, args: part.functionCall.args || {} }));
        return {
          answer: restorePiiText(answer, pii.replacements),
          toolCalls: normalizeToolCalls(toolCalls, pii.replacements),
          mode: toolCalls.length ? 'tool_call' : (answer ? 'direct_answer' : 'clarify'),
          native: true,
          provider: CONFIG.provider,
          raw: data,
        };
      }
  
      const headers = {
        'content-type': 'application/json',
        'authorization': `Bearer ${apiKey}`,
      };
      if (CONFIG.provider === 'openrouter') {
        headers['HTTP-Referer'] = 'https://github.com/djkeshawa/visp-note';
        headers['X-Title'] = 'VispNote';
      }
      const data = await providerFetch(openAiCompatibleEndpoint(baseUrl), {
        method: 'POST',
        headers,
        signal: options.signal,
        body: JSON.stringify({
          model,
          messages: providerMessages,
          tools: openAiToolDefinitions(cleanTools),
          tool_choice: 'auto',
          max_tokens: chatNumPredict(options.maxTokens || TOOL_PLAN_MAX_TOKENS),
          stream: false,
        }),
      }, meta.label, { timeoutMs: options.timeoutMs || TOOL_PLAN_TIMEOUT_MS });
      const message = data.choices?.[0]?.message || {};
      const toolCalls = (message.tool_calls || []).map(call => ({
        id: call.id,
        name: call.function?.name,
        args: call.function?.arguments || {},
      }));
      return {
        answer: restorePiiText(String(message.content || '').trim(), pii.replacements),
        toolCalls: normalizeToolCalls(toolCalls, pii.replacements),
        mode: toolCalls.length ? 'tool_call' : (String(message.content || '').trim() ? 'direct_answer' : 'clarify'),
        native: true,
        provider: CONFIG.provider,
        raw: data,
      };
    } catch (e) {
      if (options.nativeOnly) throw e;
      return await fallbackJsonToolPlan(providerMessagesBase, cleanTools, {
        ...options,
        feedback: `Native tool planning failed: ${e.message || String(e)}`,
      });
    }
  }
  
  async function providerChatStream(messages, options = {}) {
    const pii = reducePiiMessages(messages, shouldReducePiiForProvider());
    const providerMessages = pii.messages;
    if (CONFIG.provider === 'ollama' && ollama.chatStream) {
      return await ollama.chatStream(options.model || CONFIG.chatModel, providerMessages, {
        keep_alive: OLLAMA_KEEP_ALIVE,
        signal: options.signal,
        onToken: options.onToken,
        timeoutMs: options.timeoutMs,
        options: { num_predict: chatNumPredict(options.maxTokens) },
      });
    }
    const meta = currentProviderMeta();
    const apiKey = providerApiKey(meta);
    const baseUrl = providerBaseUrl(meta);
    const model = options.model || providerChatModel(meta);
    if (!apiKey) throw new Error(`${meta.label} API key is missing`);
    if (!model) throw new Error(`${meta.label} chat model is missing`);
    if (CONFIG.provider === 'custom' && !baseUrl) throw new Error('Custom provider base URL is missing');
  
    const emitter = createPiiTokenEmitter(pii.replacements, options.onToken);
    let text = '';
    const pushToken = (token) => {
      const chunk = String(token || '');
      if (!chunk) return;
      text += chunk;
      emitter.push(chunk);
    };
    const fallback = async () => {
      const result = await providerChat(messages, options);
      if (result.text) options.onToken && options.onToken(result.text);
      return result;
    };
    let stream = null;
    try {
      if (meta.compatible === 'anthropic') {
        const system = collectSystem(providerMessages);
        stream = await providerFetchStream(`${baseUrl}/v1/messages`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
          },
          signal: options.signal,
          body: JSON.stringify({
            model,
            max_tokens: chatNumPredict(options.maxTokens),
            stream: true,
            ...(system ? { system } : {}),
            messages: nonSystemMessages(providerMessages),
          }),
        }, meta.label, { timeoutMs: options.timeoutMs });
        const read = await readSseData(stream.res, data => {
          const parsed = parseJsonSseEvent(data, meta.label);
          if (!parsed) return;
          if (parsed.type === 'content_block_delta' && parsed.delta?.text) pushToken(parsed.delta.text);
          if (parsed.type === 'error') throw new Error(parsed.error?.message || `${meta.label} stream error`);
        }, stream.touch);
        if (!read.supported || !text.trim()) return await fallback();
      } else if (meta.compatible === 'gemini') {
        const system = collectSystem(providerMessages);
        const contents = nonSystemMessages(providerMessages).map(m => ({
          role: m.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: m.content }],
        }));
        stream = await providerFetchStream(`${baseUrl}/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse&key=${encodeURIComponent(apiKey)}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          signal: options.signal,
          body: JSON.stringify({
            ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
            contents,
            generationConfig: { maxOutputTokens: chatNumPredict(options.maxTokens) },
          }),
        }, meta.label, { timeoutMs: options.timeoutMs });
        const read = await readSseData(stream.res, data => {
          const parsed = parseJsonSseEvent(data, meta.label);
          if (!parsed) return;
          for (const part of parsed.candidates?.[0]?.content?.parts || []) pushToken(part.text || '');
        }, stream.touch);
        if (!read.supported || !text.trim()) return await fallback();
      } else {
        const headers = {
          'content-type': 'application/json',
          'authorization': `Bearer ${apiKey}`,
        };
        if (CONFIG.provider === 'openrouter') {
          headers['HTTP-Referer'] = 'https://github.com/djkeshawa/visp-note';
          headers['X-Title'] = 'VispNote';
        }
        stream = await providerFetchStream(openAiCompatibleEndpoint(baseUrl), {
          method: 'POST',
          headers,
          signal: options.signal,
          body: JSON.stringify({
            model,
            messages: providerMessages,
            max_tokens: chatNumPredict(options.maxTokens),
            stream: true,
          }),
        }, meta.label, { timeoutMs: options.timeoutMs });
        const read = await readSseData(stream.res, data => {
          const parsed = parseJsonSseEvent(data, meta.label);
          if (!parsed) return;
          if (parsed.error) throw new Error(parsed.error.message || `${meta.label} stream error`);
          const delta = parsed.choices?.[0]?.delta || {};
          pushToken(delta.content || delta.text || '');
        }, stream.touch);
        if (!read.supported || !text.trim()) return await fallback();
      }
      emitter.flush();
      return restorePiiResult({ text: text.trim(), raw: null }, pii.replacements);
    } catch (e) {
      if (stream?.timedOut?.() && text) {
        emitter.flush();
        return restorePiiResult({ text: text.trim(), raw: null, timedOut: true }, pii.replacements);
      }
      throw e;
    } finally {
      stream?.cleanup?.();
    }
  }
  return { buildRagPrompt, createPiiTokenEmitter, openAiCompatibleEndpoint, collectSystem, nonSystemMessages, sanitizeToolSchema, sanitizeAiTools, toolPlannerSystemPrompt, fallbackToolPlannerMessages, parseJsonObject, normalizeToolCalls, openAiToolDefinitions, anthropicToolDefinitions, geminiToolDefinitions, providerChat, fallbackJsonToolPlan, providerToolPlan, providerChatStream };
}

module.exports = { createProviderDomain };
