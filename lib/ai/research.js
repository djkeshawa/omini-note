function createResearchDomain(scope) {
  const CONFIG = scope.CONFIG;
  const MAX_CONTEXT_CHARS = scope.MAX_CONTEXT_CHARS;
  const MAX_NOTE_BODY_CHARS = scope.MAX_NOTE_BODY_CHARS;
  const MAX_RAG_PROMPT_CHARS = scope.MAX_RAG_PROMPT_CHARS;
  const NOTE_RESEARCH_ARG_CHARS = scope.NOTE_RESEARCH_ARG_CHARS;
  const NOTE_RESEARCH_MAX_NOTES = scope.NOTE_RESEARCH_MAX_NOTES;
  const NOTE_RESEARCH_MAX_ROUNDS = scope.NOTE_RESEARCH_MAX_ROUNDS;
  const NOTE_RESEARCH_MAX_SUMMARIES = scope.NOTE_RESEARCH_MAX_SUMMARIES;
  const NOTE_RESEARCH_MAX_TOOL_CALLS = scope.NOTE_RESEARCH_MAX_TOOL_CALLS;
  const NOTE_RESEARCH_MAX_TOOL_CALLS_PER_ROUND = scope.NOTE_RESEARCH_MAX_TOOL_CALLS_PER_ROUND;
  const NOTE_RESEARCH_TOOL_RESULT_CHARS = scope.NOTE_RESEARCH_TOOL_RESULT_CHARS;
  const QUERY_CACHE_MS = scope.QUERY_CACHE_MS;
  const SELECTED_NOTE_LIMIT = scope.SELECTED_NOTE_LIMIT;
  const TRAVERSAL_MAX_NOTES = scope.TRAVERSAL_MAX_NOTES;
  const TRAVERSAL_SEED_LIMIT = scope.TRAVERSAL_SEED_LIMIT;
  const TRAVERSAL_SHARED_TAG_LIMIT = scope.TRAVERSAL_SHARED_TAG_LIMIT;
  const WHOLE_VAULT_MAX_CHARS = scope.WHOLE_VAULT_MAX_CHARS;
  const WHOLE_VAULT_MAX_NOTES = scope.WHOLE_VAULT_MAX_NOTES;
  const embedQueryCached = (...args) => scope.embedQueryCached(...args);
  const idx = scope.idx;
  const isUsefulResearchSummary = (...args) => scope.isUsefulResearchSummary(...args);
  const providerChat = (...args) => scope.providerChat(...args);
  const retrievalCache = scope.retrievalCache;
  const vaultStore = scope.vaultStore;
  const SYSTEM_PROMPT = `You are an assistant that answers questions strictly from the user's personal notes.
  
  Rules:
  - Use only the provided context. If the context doesn't contain the answer, say so plainly.
  - Quote short phrases verbatim when useful, in "quotes".
  - Cite sources by the note title in square brackets after each claim, like: [Note Title].
  - Context may also include items from the assistant's long-term memory (not notes). Cite those as [Memory] so the user can tell memory-based claims from note-based ones.
  - Never cite context labels such as [Note 1], [Context item], [Memory item 2], or note ids.
  - Use modifiedAt as the last saved edit time. Use noteDate as the note's own front-matter date.
  - If the context says only selected notes were included and the question is broad, mention that briefly.
  - Be concise. Prefer 2–4 short paragraphs or a tight bulleted list.
  - Format intentionally: use markdown headings for section titles, bullets only for real list items, and do not put every line in a bullet list.
  - Emoji are allowed when they naturally improve tone or scanability, but do not overuse them.`;
  
  const EDIT_SYSTEM_PROMPT = `You are an editing assistant inside a note-taking app.
  
  Rules:
  - Return only the edited replacement text.
  - Do not wrap the result in markdown fences.
  - Preserve the user's meaning unless the instruction asks for summarization.
  - Preserve useful markdown structure, wiki-links, tags, task markers, and headings when possible.
  - Do not explain what you changed.`;
  
  const CHAT_SYSTEM_PROMPT = `You are VispNote's local AI assistant.
  
  Rules:
  - Be conversational, concise, and helpful.
  - You can explain that you can answer questions about notes, create pages, link notes, and edit or format the current page when the app asks you to.
  - Do not pretend you searched the user's notes unless note context is provided.
  - If the user asks about their notes but no note context is provided, ask them to phrase it as a note question or use the Ask AI notes flow.
  - Format intentionally: use markdown headings for section titles, bullets only for real list items, and short paragraphs for explanation.
  - Emoji are allowed when they naturally improve tone or scanability, but do not overuse them.`;
  
  const MEMORY_RECALL_LIMIT = 6;
  const MEMORY_RECALL_TIMEOUT_MS = 4000;
  const MEMORY_PROMPT_CHARS = 700;
  
  // Injected by the main process so Ask AI can blend llm-memory recall into
  // answers without lib/ai.js knowing about plugin config or IPC.
  let memoryRecallProvider = null;
  
  function setMemoryRecallProvider(provider) {
    memoryRecallProvider = typeof provider === 'function' ? provider : null;
  }
  
  // Memory recall must never block or fail an Ask AI answer: a disabled
  // bridge, an unreachable server, or a slow response all degrade to "no
  // memories" and the notes-only flow continues unchanged.
  async function recallMemoryContext(query) {
    if (!memoryRecallProvider) return [];
    try {
      const rows = await Promise.race([
        memoryRecallProvider({ query: String(query || ''), limit: MEMORY_RECALL_LIMIT }),
        new Promise(resolve => {
          const timer = setTimeout(() => resolve(null), MEMORY_RECALL_TIMEOUT_MS);
          timer.unref?.();
        }),
      ]);
      if (!Array.isArray(rows)) return [];
      return rows
        .map(row => ({
          id: String(row?.id || ''),
          content: String(row?.content || '').trim(),
          layer: String(row?.layer || ''),
          category: String(row?.category || ''),
          importance: Number(row?.importance) || 0,
          tags: Array.isArray(row?.tags) ? row.tags.map(t => String(t)) : [],
          createdAt: row?.createdAt ? String(row.createdAt) : '',
        }))
        .filter(memory => memory.content)
        .slice(0, MEMORY_RECALL_LIMIT);
    } catch {
      return [];
    }
  }
  
  function memoryTitle(memory) {
    const firstLine = String(memory.content || '').split('\n').find(line => line.trim()) || '';
    return firstLine.trim().slice(0, 80) || memory.category || 'Memory';
  }
  
  function memorySources(memories = []) {
    return memories.map(memory => ({
      kind: 'memory',
      type: 'memory',
      id: memory.id ? `memory:${memory.id}` : '',
      title: memoryTitle(memory),
      snippet: String(memory.content || '').slice(0, 200),
      createdAt: memory.createdAt,
      importance: memory.importance,
    }));
  }
  
  function isRecencyQuery(query) {
    const q = String(query || '').toLowerCase();
    const recency = /(latest|newest|most recent|recent|last|updated|update|modified|changed|saved|edited)/;
    const noteish = /(note|notes|update|updates|edit|edits|change|changes|wrote|writing|vault)/;
    return recency.test(q) && noteish.test(q);
  }
  
  function isBroadVaultSummaryQuery(query) {
    const q = String(query || '').toLowerCase();
    if (isRecencyQuery(q)) return false;
    return /\b(summari[sz]e|summary|overview|recap)\b/.test(q) &&
      /\b(all|my|entire|whole|vault|everything)\b/.test(q) &&
      /\bnotes?|pages?|vault|everything\b/.test(q);
  }
  
  function fastChatAnswer(input) {
    const text = String(input || '').trim();
    const normalized = text.toLowerCase().replace(/[!?.\s]+$/g, '');
    if (/^(hi|hello|hey|yo|sup|good morning|good afternoon|good evening)$/.test(normalized)) {
      return 'Hello. Ask me about your notes, or tell me an app action like "open settings", "create a note", or "tag this note as reading".';
    }
    if (/^(thanks|thank you|ok|okay|cool|nice)$/.test(normalized)) {
      return 'Done.';
    }
    if (/^(help|capabilities)$/.test(normalized) ||
        /\b(who are you|what are you|describe yourself|introduce yourself|tell me about yourself|what can you do|how do you work|what are your capabilities)\b/.test(normalized)) {
      return 'I am VispNote\'s AI assistant. I can answer questions from your notes, summarize note context, create pages, edit the current page, add tags, open VispNote views, and use enabled app/plugin tools when the request calls for them.';
    }
    return '';
  }
  
  function noteTextLength(note) {
    return [
      note.title || '',
      note.date || '',
      note.modifiedAt || '',
      (note.tags || []).join(' '),
      note.body || '',
    ].join('\n').length;
  }
  
  function sortByModified(notes) {
    return [...notes].sort((a, b) => {
      const bm = new Date(b.modifiedAt || b.date || 0).getTime();
      const am = new Date(a.modifiedAt || a.date || 0).getTime();
      return bm - am;
    });
  }
  
  function stripPromptPropertyLines(body) {
    return String(body || '').replace(/^[a-zA-Z_][a-zA-Z0-9_-]*::\s.*$/gm, '').trim();
  }
  
  function fitNotes(notes, maxChars = MAX_CONTEXT_CHARS) {
    const selected = [];
    let used = 0;
    for (const note of notes) {
      const body = stripPromptPropertyLines(note.body);
      const bodyLimit = Math.min(MAX_NOTE_BODY_CHARS, Math.max(1200, maxChars - used));
      const clippedBody = body.length > bodyLimit
        ? body.slice(0, bodyLimit).trimEnd() + '\n...[truncated]'
        : body;
      const next = { ...note, body: clippedBody };
      const cost = noteTextLength(next) + 180;
      if (selected.length && used + cost > maxChars) break;
      selected.push(next);
      used += cost;
      if (used >= maxChars) break;
    }
    return { notes: selected, usedChars: used, capped: selected.length < notes.length };
  }
  
  async function retrievalNoteIds(vaultId, query, st, options = {}) {
    const cacheKey = `${vaultId}\n${CONFIG.embedModel}\n${st.embedModelOk ? 'semantic' : 'keyword'}\n${String(query || '').trim().toLowerCase().slice(0, 1000)}`;
    const cached = retrievalCache.get(cacheKey);
    if (cached && Date.now() - cached.at < QUERY_CACHE_MS) return [...cached.value];
    const ids = [];
    const add = (noteId) => {
      if (noteId && !ids.includes(noteId)) ids.push(noteId);
    };
    if (st.embedModelOk) {
      try {
        const qVec = await embedQueryCached(query, { signal: options.signal });
        for (const hit of idx.vectorSearch(vaultId, qVec, CONFIG.ragTopK)) add(hit.noteId);
      } catch (e) {
        if (e.name !== 'AbortError' && e.code !== 'ABORT_ERR' && e.code !== 'EMBED_MODEL_UNSUPPORTED') {
          console.warn('[ai] vector retrieval failed', e.message);
        }
      }
    }
    for (const hit of idx.lexicalContextSearch(vaultId, query, CONFIG.ragTopK)) add(hit.noteId);
    retrievalCache.set(cacheKey, { at: Date.now(), value: [...ids] });
    if (retrievalCache.size > 80) {
      const first = retrievalCache.keys().next().value;
      retrievalCache.delete(first);
    }
    return ids;
  }
  
  function titleKey(value) {
    return String(value || '').trim().toLowerCase();
  }
  
  function extractWikiLinkTitles(text = '') {
    const titles = [];
    const re = /\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|[^\]]+)?\]\]/g;
    let match;
    while ((match = re.exec(String(text || '')))) {
      const title = String(match[1] || '').trim();
      if (title && !titles.includes(title)) titles.push(title);
    }
    return titles;
  }
  
  function queryMentionsCurrentNote(query) {
    return /\b(this|current)\s+(page|note)\b|\b(on|in)\s+this\b/i.test(String(query || ''));
  }
  
  function shouldUseRecursiveNoteResearch(query, seedIds = [], options = {}) {
    if (options.recursiveResearch === false) return false;
    if (options.recursiveResearch === true) return !isBroadVaultSummaryQuery(query);
    return false;
  }
  
  function buildNoteResearchCorpus(allNotes = []) {
    const byId = new Map();
    const byTitle = new Map();
    const metaById = new Map();
    const notesByTag = new Map();
    const backlinksByTitle = new Map();
    for (const note of allNotes) {
      byId.set(note.id, note);
      const noteTitleKey = titleKey(note.title);
      if (noteTitleKey) byTitle.set(noteTitleKey, note);
      const tagLower = (note.tags || []).map(value => String(value || '').toLowerCase());
      const outgoingTitleKeys = extractWikiLinkTitles(note.body || '').map(titleKey);
      const meta = {
        note,
        titleKey: noteTitleKey,
        titleLower: String(note.title || '').toLowerCase(),
        bodyLower: String(note.body || '').toLowerCase(),
        tagLower,
        outgoingTitleKeys,
        modifiedTime: new Date(note.modifiedAt || note.date || 0).getTime(),
      };
      metaById.set(note.id, meta);
      for (const tag of tagLower) {
        if (!notesByTag.has(tag)) notesByTag.set(tag, []);
        notesByTag.get(tag).push(note);
      }
      for (const targetTitleKey of outgoingTitleKeys) {
        if (!backlinksByTitle.has(targetTitleKey)) backlinksByTitle.set(targetTitleKey, []);
        backlinksByTitle.get(targetTitleKey).push(note);
      }
    }
    return {
      byId,
      byTitle,
      metaById,
      metaList: [...metaById.values()],
      notesByTag,
      backlinksByTitle,
    };
  }
  
  function expandTraversalCandidates(seedIds = [], allNotes = [], query = '', options = {}) {
    const corpus = options.corpus || buildNoteResearchCorpus(allNotes);
    const byId = corpus.byId;
    const byTitle = corpus.byTitle;
    const scores = new Map();
    const reasons = new Map();
    const add = (id, score, reason) => {
      if (!id || !byId.has(id)) return;
      scores.set(id, (scores.get(id) || 0) + score);
      if (!reasons.has(id)) reasons.set(id, new Set());
      reasons.get(id).add(reason);
    };
  
    if (options.currentNoteId && byId.has(options.currentNoteId) && queryMentionsCurrentNote(query)) {
      add(options.currentNoteId, 120, 'current note');
    }
  
    seedIds.slice(0, TRAVERSAL_SEED_LIMIT).forEach((id, index) => add(id, 100 - index * 4, 'retrieval match'));
  
    const seedSet = new Set([...scores.keys()].slice(0, TRAVERSAL_SEED_LIMIT));
    for (const seedId of seedSet) {
      const seed = byId.get(seedId);
      if (!seed) continue;
      for (const linkedTitle of extractWikiLinkTitles(seed.body || '')) {
        const linked = byTitle.get(titleKey(linkedTitle));
        if (linked) add(linked.id, 36, `linked from ${seed.title || 'note'}`);
      }
      for (const candidate of corpus.backlinksByTitle.get(titleKey(seed.title)) || []) {
        if (candidate.id !== seedId) add(candidate.id, 32, `backlinks to ${seed.title || 'note'}`);
      }
      const seedTags = (seed.tags || []).filter(Boolean).slice(0, TRAVERSAL_SHARED_TAG_LIMIT);
      for (const tag of seedTags) {
        for (const candidate of corpus.notesByTag.get(String(tag).toLowerCase()) || []) {
          if (candidate.id !== seedId) add(candidate.id, 12, `shares #${tag}`);
        }
      }
    }
  
    return [...scores.entries()]
      .map(([id, score]) => {
        const note = byId.get(id);
        return {
          note,
          score,
          reasons: [...(reasons.get(id) || [])],
          modifiedTime: new Date(note.modifiedAt || note.date || 0).getTime(),
        };
      })
      .sort((a, b) => b.score - a.score || b.modifiedTime - a.modifiedTime)
      .slice(0, TRAVERSAL_MAX_NOTES);
  }
  
  function notePreview(note, maxChars = 240) {
    return String(note?.body || '')
      .replace(/^[a-zA-Z_][a-zA-Z0-9_-]*::\s.*$/gm, '')
      .replace(/\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|([^\]]+))?\]\]/g, (_match, title, alias) => alias || title)
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, maxChars);
  }
  
  function compactNoteForResearch(note) {
    return {
      id: note.id,
      title: note.title || 'Untitled',
      tags: note.tags || [],
      modifiedAt: note.modifiedAt || note.date || null,
      links: extractWikiLinkTitles(note.body || '').slice(0, 8),
      preview: notePreview(note),
    };
  }
  
  function lexicalScoreMeta(meta, query) {
    const terms = String(query || '').toLowerCase().split(/[^a-z0-9_-]+/).filter(term => term.length > 1);
    if (!terms.length) return 0;
    let score = 0;
    const tags = meta.tagLower.join(' ');
    for (const term of terms) {
      if (meta.titleLower.includes(term)) score += 8;
      if (tags.includes(term)) score += 5;
      if (meta.bodyLower.includes(term)) score += 1;
    }
    return score;
  }
  
  function parseResearchToolCalls(text) {
    const raw = String(text || '').trim()
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim();
    if (!raw) return [];
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      const arrayMatch = raw.match(/\[[\s\S]*\]/);
      if (!arrayMatch) return [];
      try { parsed = JSON.parse(arrayMatch[0]); } catch { return []; }
    }
    const calls = Array.isArray(parsed) ? parsed : (Array.isArray(parsed?.calls) ? parsed.calls : []);
    return calls
      .map(call => ({
        tool: String(call?.tool || call?.name || call?.action || '').trim().toLowerCase(),
        args: call?.args && typeof call.args === 'object' ? call.args : call,
      }))
      .filter(call => call.tool)
      .slice(0, NOTE_RESEARCH_MAX_TOOL_CALLS_PER_ROUND);
  }
  
  function normalizeResearchToolCalls(value) {
    return (Array.isArray(value) ? value : parseResearchToolCalls(value))
      .map(call => ({
        tool: String(call?.tool || '').trim().toLowerCase(),
        args: call?.args && typeof call.args === 'object' ? call.args : {},
      }))
      .filter(call => call.tool)
      .slice(0, NOTE_RESEARCH_MAX_TOOL_CALLS_PER_ROUND);
  }
  
  function capResearchArg(value, max = NOTE_RESEARCH_ARG_CHARS) {
    return String(value || '').slice(0, max);
  }
  
  function makeResearchToolResult(tool, items = [], extra = {}) {
    return {
      tool,
      items: items.slice(0, 10).map(item => {
        if (item?.id && item?.title) return compactNoteForResearch(item);
        return item;
      }),
      ...extra,
    };
  }
  
  function buildResearchPlannerMessages(query, evidenceNotes, toolLog, round) {
    const evidence = evidenceNotes.slice(0, NOTE_RESEARCH_MAX_NOTES).map(compactNoteForResearch);
    const recentToolLog = toolLog.slice(-8).map(entry => ({
      tool: entry.tool,
      count: entry.count,
      result: String(entry.summary || '').slice(0, NOTE_RESEARCH_TOOL_RESULT_CHARS),
    }));
    return [
      {
        role: 'system',
        content: [
          'You are a read-only note research planner inside VispNote.',
          'Choose safe note-inspection tool calls that gather missing evidence before a final answer.',
          'Return only JSON: an array of tool calls.',
          'Allowed tools:',
          '- search_notes: {"tool":"search_notes","query":"...","limit":5}',
          '- get_note: {"tool":"get_note","id":"note-id"}',
          '- get_links: {"tool":"get_links","id":"note-id"}',
          '- get_backlinks: {"tool":"get_backlinks","id":"note-id","limit":5}',
          '- get_notes_by_tag: {"tool":"get_notes_by_tag","tag":"tag","limit":5}',
          '- summarize_subset: {"tool":"summarize_subset","noteIds":["id"],"question":"..."}',
          '- finish: {"tool":"finish"}',
          'Do not request code execution, shell commands, plugins, filesystem access, or network access.',
          'Prefer 1-4 high-value calls. Use finish when enough evidence is available.',
        ].join('\n'),
      },
      {
        role: 'user',
        content: [
          `Question: ${query}`,
          `Round: ${round}`,
          `Evidence notes (${evidence.length}):\n${JSON.stringify(evidence, null, 2)}`,
          `Recent tool results:\n${JSON.stringify(recentToolLog, null, 2)}`,
          'Return JSON tool calls only.',
        ].join('\n\n'),
      },
    ];
  }
  
  async function summarizeResearchSubset(notes, query, signal) {
    const fit = fitNotes(notes, 8000);
    const body = fit.notes.map(note => [
      `title: ${note.title || 'Untitled'}`,
      `id: ${note.id}`,
      `tags: ${(note.tags || []).join(', ') || 'none'}`,
      '',
      String(note.body || '').trim(),
    ].join('\n')).join('\n\n---\n\n');
    const { text } = await providerChat([
      {
        role: 'system',
        content: 'Summarize only the provided notes for the user question. Preserve concrete facts, decisions, tasks, dates, and source note titles. Be concise.',
      },
      {
        role: 'user',
        content: `Question: ${query}\n\nNotes:\n${body}`,
      },
    ], { signal, maxTokens: 1024, timeoutMs: 30000 });
    return String(text || '').trim();
  }
  
  async function executeResearchCall(call, state) {
    const { corpus, byId, byTitle, query, signal } = state;
    const args = call.args || {};
    const limit = Math.max(1, Math.min(Number(args.limit) || 5, 10));
    const addEvidence = (note, reason) => {
      if (!note?.id || state.evidence.has(note.id) || state.evidence.size >= NOTE_RESEARCH_MAX_NOTES) return;
      state.evidence.set(note.id, { note, reason });
    };
  
    if (call.tool === 'finish') return { done: true, result: { tool: 'finish', count: 0, summary: 'Planner finished.' } };
  
    if (call.tool === 'search_notes') {
      const q = capResearchArg(args.query || query || '', 200);
      const matches = corpus.metaList
        .map(meta => ({ note: meta.note, score: lexicalScoreMeta(meta, q), modifiedTime: meta.modifiedTime }))
        .filter(item => item.score > 0)
        .sort((a, b) => b.score - a.score || b.modifiedTime - a.modifiedTime)
        .slice(0, limit)
        .map(item => item.note);
      matches.forEach(note => addEvidence(note, `search:${q}`));
      return {
        result: makeResearchToolResult('search_notes', matches, {
          count: matches.length,
          summary: matches.map(note => `${note.title}: ${notePreview(note, 120)}`).join('\n'),
        }),
      };
    }
  
    if (call.tool === 'get_note') {
      const note = byId.get(String(args.id || ''));
      if (note) addEvidence(note, 'get_note');
      return {
        result: makeResearchToolResult('get_note', note ? [note] : [], {
          count: note ? 1 : 0,
          summary: note ? `${note.title}: ${notePreview(note, 400)}` : 'Note not found.',
        }),
      };
    }
  
    if (call.tool === 'get_links') {
      const source = byId.get(String(args.id || ''));
      const linked = source
        ? extractWikiLinkTitles(source.body || '')
          .map(title => byTitle.get(titleKey(title)))
          .filter(Boolean)
          .slice(0, limit)
        : [];
      linked.forEach(note => addEvidence(note, `linked:${source?.title || ''}`));
      return {
        result: makeResearchToolResult('get_links', linked, {
          count: linked.length,
          summary: linked.map(note => `${note.title}: ${notePreview(note, 120)}`).join('\n') || 'No resolved links.',
        }),
      };
    }
  
    if (call.tool === 'get_backlinks') {
      const target = byId.get(String(args.id || ''));
      const backlinks = target
        ? (corpus.backlinksByTitle.get(titleKey(target.title)) || [])
          .filter(note => note.id !== target.id)
          .slice(0, limit)
        : [];
      backlinks.forEach(note => addEvidence(note, `backlink:${target?.title || ''}`));
      return {
        result: makeResearchToolResult('get_backlinks', backlinks, {
          count: backlinks.length,
          summary: backlinks.map(note => `${note.title}: ${notePreview(note, 120)}`).join('\n') || 'No backlinks.',
        }),
      };
    }
  
    if (call.tool === 'get_notes_by_tag') {
      const tag = String(args.tag || '').replace(/^#/, '').trim().toLowerCase().slice(0, 80);
      const tagged = tag
        ? (corpus.notesByTag.get(tag) || []).slice(0, limit)
        : [];
      tagged.forEach(note => addEvidence(note, `tag:${tag}`));
      return {
        result: makeResearchToolResult('get_notes_by_tag', tagged, {
          count: tagged.length,
          summary: tagged.map(note => `${note.title}: ${notePreview(note, 120)}`).join('\n') || 'No notes for tag.',
        }),
      };
    }
  
    if (call.tool === 'summarize_subset') {
      if (state.summaryCount >= NOTE_RESEARCH_MAX_SUMMARIES) {
        return { result: { tool: 'summarize_subset', count: 0, summary: 'Summary limit reached.' } };
      }
      const ids = Array.isArray(args.noteIds) ? args.noteIds.map(id => String(id || '')) : [];
      const notes = ids.map(id => byId.get(id)).filter(Boolean).slice(0, 6);
      if (!notes.length) return { result: { tool: 'summarize_subset', count: 0, summary: 'No valid notes to summarize.' } };
      state.summaryCount++;
      const summary = await summarizeResearchSubset(notes, capResearchArg(args.question || query || ''), signal);
      if (!isUsefulResearchSummary(summary)) {
        return { result: { tool: 'summarize_subset', count: 0, summary: 'Summary was empty or failed validation.' } };
      }
      state.summaries.push({ noteIds: notes.map(note => note.id), summary });
      notes.forEach(note => addEvidence(note, 'summarized'));
      return { result: { tool: 'summarize_subset', count: notes.length, summary } };
    }
  
    return { result: { tool: call.tool, count: 0, summary: 'Rejected unknown note research tool.' } };
  }
  
  async function runRecursiveNoteResearch({ query, allNotes, seedIds = [], options = {} }) {
    const corpus = options.corpus || buildNoteResearchCorpus(allNotes);
    const byId = corpus.byId;
    const byTitle = corpus.byTitle;
    const state = {
      allNotes,
      corpus,
      byId,
      byTitle,
      query,
      signal: options.signal,
      evidence: new Map(),
      summaries: [],
      summaryCount: 0,
    };
    const addInitial = (id, reason) => {
      const note = byId.get(id);
      if (note && state.evidence.size < NOTE_RESEARCH_MAX_NOTES) state.evidence.set(id, { note, reason });
    };
    seedIds.slice(0, TRAVERSAL_SEED_LIMIT).forEach(id => addInitial(id, 'seed'));
    if (options.currentNoteId && queryMentionsCurrentNote(query)) addInitial(options.currentNoteId, 'current note');
  
    const toolLog = [];
    let toolCalls = 0;
    for (let round = 1; round <= NOTE_RESEARCH_MAX_ROUNDS && toolCalls < NOTE_RESEARCH_MAX_TOOL_CALLS; round++) {
      const evidenceNotes = [...state.evidence.values()].map(item => item.note);
      const planner = options.planNoteResearch || (async ({ messages }) => {
        const { text } = await providerChat(messages, { signal: options.signal, maxTokens: 900, timeoutMs: 30000 });
        return parseResearchToolCalls(text);
      });
      let calls = [];
      try {
        calls = await planner({
          query,
          round,
          evidenceNotes,
          toolLog,
          messages: buildResearchPlannerMessages(query, evidenceNotes, toolLog, round),
        });
      } catch (e) {
        console.warn('[ai] recursive note planner failed', e.message || String(e));
        break;
      }
      calls = normalizeResearchToolCalls(calls);
      if (!calls.length) break;
  
      let done = false;
      for (const call of calls) {
        if (toolCalls >= NOTE_RESEARCH_MAX_TOOL_CALLS) break;
        toolCalls++;
        const { done: callDone, result } = await executeResearchCall(call, state);
        toolLog.push({
          tool: result.tool,
          count: result.count || 0,
          summary: result.summary || '',
        });
        if (callDone) {
          done = true;
          break;
        }
      }
      if (done || state.evidence.size >= NOTE_RESEARCH_MAX_NOTES) break;
    }
  
    return {
      notes: [...state.evidence.values()].map(item => item.note),
      summaries: state.summaries,
      toolLog,
      toolCalls,
    };
  }
  
  async function buildVaultContext(vaultId, query, st, storeApi = vaultStore, options = {}) {
    const vault = await storeApi.loadVault(vaultId);
    const allNotes = sortByModified(vault.notes || []);
    const allChars = allNotes.reduce((sum, note) => sum + noteTextLength(note), 0);
    const recency = isRecencyQuery(query);
    const broadSummary = isBroadVaultSummaryQuery(query);
    const wholeVault = allNotes.length <= WHOLE_VAULT_MAX_NOTES && allChars <= WHOLE_VAULT_MAX_CHARS;
  
    if (recency) {
      const fit = fitNotes(allNotes.slice(0, SELECTED_NOTE_LIMIT));
      return {
        mode: 'recent',
        notes: fit.notes,
        totalNotes: allNotes.length,
        capped: allNotes.length > fit.notes.length || fit.capped,
        reason: 'the question asks about recent or latest notes; notes are sorted newest first by modifiedAt, so context item 1 is the latest saved note',
      };
    }
  
    if (wholeVault || broadSummary) {
      const fit = fitNotes(allNotes, broadSummary ? MAX_RAG_PROMPT_CHARS : MAX_CONTEXT_CHARS);
      return {
        mode: broadSummary && !wholeVault ? 'broad-summary' : 'whole-vault',
        notes: fit.notes,
        totalNotes: allNotes.length,
        capped: fit.capped,
        reason: broadSummary && !wholeVault
          ? 'the question asks for a whole-vault summary, so notes were included in recent-edit order up to the prompt budget'
          : 'the active vault is small enough to include in full',
      };
    }
  
    const ids = await retrievalNoteIds(vaultId, query, st, options);
    const corpus = buildNoteResearchCorpus(allNotes);
    const expanded = expandTraversalCandidates(ids, allNotes, query, { ...options, corpus });
    let research = null;
    const seedIds = expanded.map(item => item.note?.id).filter(Boolean);
    if (shouldUseRecursiveNoteResearch(query, seedIds, options)) {
      research = await runRecursiveNoteResearch({
        query,
        allNotes,
        seedIds,
        options: { ...options, corpus },
      });
    }
    const selected = [
      ...(research?.notes || []),
      ...expanded.map(item => item.note).filter(Boolean),
    ].filter((note, index, arr) => note?.id && arr.findIndex(item => item?.id === note.id) === index);
    const withRecentFallback = selected.length ? selected : allNotes.slice(0, Math.min(SELECTED_NOTE_LIMIT, allNotes.length));
    const fit = fitNotes(withRecentFallback);
    const usedTraversal = expanded.some(item => item.reasons.some(reason => reason !== 'retrieval match'));
    const usedRecursive = !!research?.toolCalls;
    return {
      mode: selected.length ? (usedRecursive ? 'recursive-traversal' : (usedTraversal ? 'traversal' : (st.embedModelOk ? 'semantic' : 'keyword'))) : 'recent-fallback',
      notes: fit.notes,
      researchSummaries: research?.summaries || [],
      researchToolCalls: research?.toolCalls || 0,
      totalNotes: allNotes.length,
      capped: fit.capped || allNotes.length > fit.notes.length,
      reason: selected.length
        ? (usedRecursive
          ? 'seed notes matched retrieval, then a bounded read-only note research loop inspected search results, links, backlinks, tags, and summaries'
          : 'seed notes matched semantic or keyword retrieval, then related wiki-links, backlinks, and shared tags were traversed within limits')
        : 'no direct match was found, so recent notes were used',
    };
  }
  return { SYSTEM_PROMPT, EDIT_SYSTEM_PROMPT, CHAT_SYSTEM_PROMPT, MEMORY_RECALL_LIMIT, MEMORY_RECALL_TIMEOUT_MS, MEMORY_PROMPT_CHARS, memoryRecallProvider, setMemoryRecallProvider, recallMemoryContext, memoryTitle, memorySources, isRecencyQuery, isBroadVaultSummaryQuery, fastChatAnswer, noteTextLength, sortByModified, stripPromptPropertyLines, fitNotes, retrievalNoteIds, titleKey, extractWikiLinkTitles, queryMentionsCurrentNote, shouldUseRecursiveNoteResearch, buildNoteResearchCorpus, expandTraversalCandidates, notePreview, compactNoteForResearch, lexicalScoreMeta, parseResearchToolCalls, normalizeResearchToolCalls, capResearchArg, makeResearchToolResult, buildResearchPlannerMessages, summarizeResearchSubset, executeResearchCall, runRecursiveNoteResearch, buildVaultContext };
}

module.exports = { createResearchDomain };
