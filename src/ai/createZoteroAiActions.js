import { platformApi } from '../platform/index.js';
import { MN_AI_CHAT_TIMEOUT_MS, mnWantsZoteroAssistedNoteEdit, mnWantsZoteroSummaryNote } from './aiModels.js';

function createZoteroAiActions({ aiRuntime, setActiveAction, currentNote, onApplyCurrentPageBody, makeVirtualWriteReview, onCreateNote }) {
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
  
    const zoteroEditInstruction = (readResult, originalQuery) => {
      const context = zoteroSummaryContext(readResult, originalQuery).slice(0, 3200);
      return [
        'Improve the current VispNote page using the Zotero paper context below.',
        'Add relevant details under existing sections where they fit. Preserve existing headings, markdown, wiki-links, tags, tasks, and user-written facts.',
        'Use only facts supported by the Zotero metadata, abstract, or full text excerpt. If full text is unavailable, rely only on metadata and abstract.',
        '',
        `User request: ${originalQuery}`,
        '',
        'Zotero context:',
        context,
      ].join('\n');
    };
  
    const summarizeZoteroRead = async ({ readResult, query, jobId }) => {
      if (!platformApi.ai?.chat) {
        const item = readResult?.item || {};
        return [
          `I found "${item.title || 'the Zotero item'}" in Zotero, but AI chat is unavailable for summarizing it.`,
          item.abstractNote ? `Abstract: ${item.abstractNote}` : '',
          readResult?.fullTextError ? readResult.fullTextError : '',
        ].filter(Boolean).join('\n\n');
      }
      const context = zoteroSummaryContext(readResult, query);
      const r = await platformApi.ai.chat({
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
  
    const formatZoteroList = (items = []) => {
      const rows = (Array.isArray(items) ? items : [])
        .filter(item => item?.key)
        .slice(0, 20);
      if (!rows.length) return 'I checked Zotero, but no papers were found.';
      const lines = rows.map((item, index) => {
        const meta = [item.creators, item.date].filter(Boolean).join(', ');
        return `${index + 1}. ${item.title || item.key}${meta ? ` - ${meta}` : ''}`;
      });
      return `I found ${rows.length} Zotero paper${rows.length === 1 ? '' : 's'}:\n\n${lines.join('\n')}`;
    };
  
    const runZoteroDocumentRequest = async ({ q, actionQuery, jobId, run }) => {
      const registry = window.MN_APP_ACTIONS;
      if (!registry?.run || !registry?.validate) {
        return { answer: 'I cannot search Zotero because app actions are not available.', sources: [], clarify: true };
      }
      if (!zoteroTools().length) {
        return { answer: aiRuntime.zoteroUnavailableMessage?.() || 'I cannot search Zotero because the Zotero reader plugin is not enabled.', sources: [], clarify: true };
      }
      if (!platformApi.integrations.zotero?.status) {
        return { answer: 'I cannot search Zotero because this build does not expose the Zotero connector.', sources: [], clarify: true };
      }
      setActiveAction('Checking Zotero...');
      const statusResult = await platformApi.integrations.zotero.status();
      if (!statusResult.ok) return { answer: `I cannot check Zotero: ${statusResult.error || 'unknown error'}`, sources: [], clarify: true };
      if (!statusResult.value?.reachable) {
        return { answer: zoteroStatusMessage(statusResult.value), sources: [], clarify: true };
      }
  
      if (aiRuntime.isZoteroListRequest?.(actionQuery) || aiRuntime.isZoteroListRequest?.(q)) {
        setActiveAction('Listing Zotero papers...');
        aiRuntime.recordTrace?.(run, 'tool.run', { actionId: 'zotero-list', actionLabel: 'List Zotero papers', args: { limit: 20 } });
        const listArgs = registry.validate('zotero-list', { limit: 20 });
        const listResult = await registry.run('zotero-list', listArgs, {});
        if (listResult.ok === false) return { answer: listResult.message || 'Could not list Zotero papers.', sources: [], clarify: true };
        const results = Array.isArray(listResult.results) ? listResult.results : [];
        aiRuntime.recordTrace?.(run, 'tool.done', { actionId: 'zotero-list', actionLabel: 'List Zotero papers', affected: results.length });
        return {
          answer: formatZoteroList(results),
          sources: results.map(item => ({ type: 'zotero', id: item.key, title: item.title || item.key, snippet: 'Zotero' })),
          action: true,
        };
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
      if (mnWantsZoteroAssistedNoteEdit(q)) {
        if (!currentNote || !onApplyCurrentPageBody) {
          return {
            answer: 'I read the Zotero paper, but no current page is open for me to improve.',
            sources: [{ type: 'zotero', id: readResult.item?.key || item.key, title: readResult.item?.title || item.title || item.key, snippet: 'Zotero' }],
            clarify: true,
          };
        }
        return await makeVirtualWriteReview('edit-current-page', { instruction: zoteroEditInstruction(readResult, q) }, q);
      }
      setActiveAction('Summarizing Zotero paper...');
      const answer = await summarizeZoteroRead({ readResult, query: q, jobId });
      if (mnWantsZoteroSummaryNote(q)) {
        if (!onCreateNote) {
          return {
            answer: 'I summarized the Zotero paper, but page creation is not available here.',
            sources: [{ type: 'zotero', id: readResult.item?.key || item.key, title: readResult.item?.title || item.title || item.key, snippet: 'Zotero' }],
            clarify: true,
          };
        }
        const title = `${readResult.item?.title || item.title || 'Zotero paper'} summary`;
        const body = [
          `# ${title}`,
          '',
          answer,
        ].join('\n');
        const id = onCreateNote({ title, body, tags: ['reading'], open: false });
        return {
          answer: `Created page "${title}" from the Zotero paper.`,
          sources: [
            id ? { type: 'note', id, title, snippet: body.slice(0, 200) } : null,
            { type: 'zotero', id: readResult.item?.key || item.key, title: readResult.item?.title || item.title || item.key, snippet: 'Zotero' },
          ].filter(Boolean),
          action: true,
        };
      }
      return {
        answer,
        sources: [{ type: 'zotero', id: readResult.item?.key || item.key, title: readResult.item?.title || item.title || item.key, snippet: 'Zotero' }],
        action: true,
      };
    };
  return { runZoteroDocumentRequest };
}

export { createZoteroAiActions };
