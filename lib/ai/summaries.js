function createSummaryDomain(scope) {
  const CONFIG = scope.CONFIG;
  const MAX_RAG_PROMPT_CHARS = scope.MAX_RAG_PROMPT_CHARS;
  const QUERY_CACHE_MS = scope.QUERY_CACHE_MS;
  const SUMMARY_BATCH_MAX_CHARS = scope.SUMMARY_BATCH_MAX_CHARS;
  const SUMMARY_BATCH_MAX_NOTES = scope.SUMMARY_BATCH_MAX_NOTES;
  const SUMMARY_MAP_MAX_TOKENS = scope.SUMMARY_MAP_MAX_TOKENS;
  const SUMMARY_NOTE_BODY_CHARS = scope.SUMMARY_NOTE_BODY_CHARS;
  const SUMMARY_REDUCE_MAX_TOKENS = scope.SUMMARY_REDUCE_MAX_TOKENS;
  const SUMMARY_REQUEST_TIMEOUT_MS = scope.SUMMARY_REQUEST_TIMEOUT_MS;
  const chatUnavailableReason = (...args) => scope.chatUnavailableReason(...args);
  const crypto = scope.crypto;
  const notePreview = (...args) => scope.notePreview(...args);
  const providerChat = (...args) => scope.providerChat(...args);
  const sortByModified = (...args) => scope.sortByModified(...args);
  const stripPromptPropertyLines = (...args) => scope.stripPromptPropertyLines(...args);
  const summaryCache = scope.summaryCache;
  function hashText(value) {
    return crypto.createHash('sha1').update(String(value || '')).digest('hex');
  }
  
  function summaryNoteFingerprint(note) {
    return [
      note?.id || '',
      note?.modifiedAt || note?.date || '',
      String(note?.body || '').length,
      hashText(String(note?.title || '') + '\n' + String(note?.body || '').slice(0, 4000)).slice(0, 16),
    ].join(':');
  }
  
  function formatSummaryNote(note, index) {
    const tags = (note.tags || []).map(tag => `#${tag}`).join(' ') || 'none';
    const body = stripPromptPropertyLines(note.body || '').slice(0, SUMMARY_NOTE_BODY_CHARS);
    return [
      `<note index="${index + 1}">`,
      `<title>${note.title || 'Untitled'}</title>`,
      `<modifiedAt>${note.modifiedAt || note.date || 'unknown'}</modifiedAt>`,
      `<tags>${tags}</tags>`,
      '<content>',
      body || '(empty note)',
      '</content>',
      '</note>',
    ].join('\n');
  }
  
  function batchNotesForSummary(notes, options = {}) {
    const maxChars = Math.max(2500, Math.min(Number(options.batchMaxChars) || SUMMARY_BATCH_MAX_CHARS, 20000));
    const maxNotes = Math.max(1, Math.min(Number(options.batchMaxNotes) || SUMMARY_BATCH_MAX_NOTES, 20));
    const batches = [];
    let batch = [];
    let used = 0;
    for (const note of sortByModified(notes || [])) {
      const formatted = formatSummaryNote(note, batch.length);
      const cost = formatted.length + 2;
      if (batch.length && (batch.length >= maxNotes || used + cost > maxChars)) {
        batches.push(batch);
        batch = [];
        used = 0;
      }
      batch.push(note);
      used += cost;
    }
    if (batch.length) batches.push(batch);
    return batches;
  }
  
  function fallbackBatchSummary(notes = [], reason = '') {
    const lines = [];
    for (const note of notes) {
      const preview = notePreview(note, 180);
      lines.push(`- ${note.title || 'Untitled'}${preview ? `: ${preview}` : ''}`);
    }
    return [
      reason ? `AI summary fallback (${reason}).` : 'AI summary fallback.',
      ...lines,
    ].join('\n');
  }
  
  function collectSummarySources(notes = [], limit = 80) {
    return sortByModified(notes).slice(0, limit).map(note => ({
      id: note.id,
      title: note.title || 'Untitled',
      modifiedAt: note.modifiedAt,
      snippet: notePreview(note, 220),
    }));
  }
  
  function summaryCacheKey(kind, parts = []) {
    return `${CONFIG.provider}:${CONFIG.chatModel}:${kind}:${hashText(parts.join('\n'))}`;
  }
  
  function getCachedSummary(key) {
    const cached = summaryCache.get(key);
    if (cached && Date.now() - cached.at < QUERY_CACHE_MS * 4) return cached.value;
    return null;
  }
  
  function setCachedSummary(key, value) {
    summaryCache.set(key, { at: Date.now(), value });
    if (summaryCache.size > 120) {
      const first = summaryCache.keys().next().value;
      summaryCache.delete(first);
    }
  }
  
  function summaryHeadingKey(text) {
    return String(text || '')
      .toLowerCase()
      .replace(/[*_`#:[\]()]/g, '')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  }
  
  const GENERIC_SUMMARY_HEADING_KEYS = new Set([
    'notes summary',
    'summary',
    'summary of all notes',
    'all notes summary',
    'vault summary',
  ]);
  
  function isGenericSummaryHeadingLine(line) {
    const match = String(line || '').trim().match(/^#{1,3}\s+(.+)$/);
    if (!match) return false;
    return GENERIC_SUMMARY_HEADING_KEYS.has(summaryHeadingKey(match[1]));
  }
  
  function normalizeFinalSummaryBody(summary = '') {
    const lines = String(summary || '').replace(/\r\n/g, '\n').trim().split('\n');
    while (lines.length && !lines[0].trim()) lines.shift();
    while (lines.length && isGenericSummaryHeadingLine(lines[0])) {
      lines.shift();
      while (lines.length && !lines[0].trim()) lines.shift();
    }
    return lines.join('\n').trim();
  }
  
  async function summarizeNoteBatch(batch, query, options = {}) {
    const fingerprints = batch.map(summaryNoteFingerprint);
    const cacheKey = summaryCacheKey('batch', [String(query || ''), ...fingerprints]);
    const cached = getCachedSummary(cacheKey);
    if (cached) return cached;
    const docs = batch.map((note, index) => formatSummaryNote(note, index)).join('\n\n');
    const messages = [
      {
        role: 'system',
        content: [
          'You summarize batches of personal notes for VispNote.',
          'Use only the provided notes.',
          'Return concise markdown bullets.',
          'Preserve concrete decisions, tasks, dates, names, and important references.',
          'Cite note titles in brackets when useful.',
        ].join('\n'),
      },
      {
        role: 'user',
        content: [
          `User request: ${query}`,
          '',
          'Summarize this batch. Include:',
          '- Key themes',
          '- Important decisions or facts',
          '- Open tasks',
          '- Notable dates/names',
          '',
          docs,
        ].join('\n'),
      },
    ];
    const { text } = await providerChat(messages, {
      signal: options.signal,
      timeoutMs: options.timeoutMs || SUMMARY_REQUEST_TIMEOUT_MS,
      maxTokens: options.maxTokens || SUMMARY_MAP_MAX_TOKENS,
    });
    const summary = String(text || '').trim();
    const value = summary || fallbackBatchSummary(batch, 'empty model response');
    setCachedSummary(cacheKey, value);
    return value;
  }
  
  function formatFinalSummary({ query, summaries, notes, failures = [] } = {}) {
    const sourceLines = sortByModified(notes || []).slice(0, 80).map(note => `- [[${note.title || 'Untitled'}]]`);
    const body = (summaries || [])
      .map(normalizeFinalSummaryBody)
      .filter(Boolean)
      .join('\n\n');
    return [
      '# Notes summary',
      '',
      failures.length ? `> Partial AI summary: ${failures.length} batch${failures.length === 1 ? '' : 'es'} used a fallback because the model timed out or failed.` : null,
      '',
      body,
      '',
      '## Source notes',
      sourceLines.join('\n'),
      '',
      `Request: ${query}`,
    ].filter(item => item !== null).join('\n').replace(/\n{3,}/g, '\n\n').trim();
  }
  
  async function reduceBatchSummaries(summaries, query, notes, options = {}) {
    if (summaries.length <= 1) return summaries[0] || '';
    const combined = summaries.map((summary, index) => `--- Batch ${index + 1} ---\n${summary}`).join('\n\n');
    const cacheKey = summaryCacheKey('reduce', [String(query || ''), combined]);
    const cached = getCachedSummary(cacheKey);
    if (cached) return cached;
    const messages = [
      {
        role: 'system',
        content: [
          'You combine batch summaries into one final markdown note.',
          'Use only the batch summaries.',
          'Do not invent facts.',
          'Keep the final note useful, concise, and structured.',
        ].join('\n'),
      },
      {
        role: 'user',
        content: [
          `User request: ${query}`,
          '',
          'Combine these batch summaries into one final note with sections:',
          '## Overview',
          '## Key points',
          '## Decisions and facts',
          '## Tasks',
          '## Source themes',
          '',
          combined.slice(0, MAX_RAG_PROMPT_CHARS),
        ].join('\n'),
      },
    ];
    try {
      const { text } = await providerChat(messages, {
        signal: options.signal,
        timeoutMs: options.timeoutMs || SUMMARY_REQUEST_TIMEOUT_MS,
        maxTokens: options.maxTokens || SUMMARY_REDUCE_MAX_TOKENS,
      });
      const reduced = String(text || '').trim();
      if (reduced) {
        setCachedSummary(cacheKey, reduced);
        return reduced;
      }
    } catch (e) {
      if (e.name === 'AbortError' || e.code === 'ABORT_ERR') throw e;
      console.warn('[ai] summary reduce failed', e.message || String(e));
    }
    return formatFinalSummary({ query, summaries, notes });
  }
  
  async function summarizeVaultInternal(vaultId, query, st, storeApi, options = {}) {
    const vault = await storeApi.loadVault(vaultId);
    const notes = sortByModified(vault.notes || []);
    if (!notes.length) return { ok: true, answer: 'No notes were found in this vault.', sources: [], mode: 'summary-empty' };
    if (!st?.reachable || !st?.chatModelOk) {
      return {
        ok: false,
        error: chatUnavailableReason(st || {}),
        setupRequired: true,
        sources: collectSummarySources(notes),
      };
    }
    const batches = batchNotesForSummary(notes, options);
    const summaries = [];
    const failures = [];
    for (let i = 0; i < batches.length; i++) {
      if (options.signal?.aborted) throw options.signal.reason || new Error('AI summary cancelled');
      try {
        options.onProgress && options.onProgress({ phase: 'map', index: i + 1, total: batches.length });
        summaries.push(await summarizeNoteBatch(batches[i], query, options));
      } catch (e) {
        if (e.name === 'AbortError' || e.code === 'ABORT_ERR') throw e;
        failures.push({ index: i + 1, error: e.message || String(e) });
        summaries.push(fallbackBatchSummary(batches[i], e.message || 'model failed'));
      }
    }
    options.onProgress && options.onProgress({ phase: 'reduce', index: batches.length, total: batches.length });
    const reduced = await reduceBatchSummaries(summaries, query, notes, options);
    const answer = formatFinalSummary({
      query,
      summaries: [reduced],
      notes,
      failures,
    });
    return {
      ok: true,
      answer,
      sources: collectSummarySources(notes),
      mode: 'map-reduce-summary',
      batches: batches.length,
      partial: failures.length > 0,
      failures,
    };
  }
  return { hashText, summaryNoteFingerprint, formatSummaryNote, batchNotesForSummary, fallbackBatchSummary, collectSummarySources, summaryCacheKey, getCachedSummary, setCachedSummary, summaryHeadingKey, GENERIC_SUMMARY_HEADING_KEYS, isGenericSummaryHeadingLine, normalizeFinalSummaryBody, summarizeNoteBatch, formatFinalSummary, reduceBatchSummaries, summarizeVaultInternal };
}

module.exports = { createSummaryDomain };
