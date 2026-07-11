function createContextualAiHelpers(scope = {}) {
  const CONTEXTUAL_AI_PROVIDER_LABELS = scope.CONTEXTUAL_AI_PROVIDER_LABELS;
  const CONTEXTUAL_AI_SECTION_KINDS = scope.CONTEXTUAL_AI_SECTION_KINDS;
  const rollupAppendMarkdownSection = (...args) => scope.rollupAppendMarkdownSection(...args);
  const rollupDateKey = (...args) => scope.rollupDateKey(...args);
  const rollupDecisionLines = (...args) => scope.rollupDecisionLines(...args);
  const rollupFilterReminderItems = (...args) => scope.rollupFilterReminderItems(...args);
  const rollupFilterTaskItems = (...args) => scope.rollupFilterTaskItems(...args);
  const rollupNoteLine = (...args) => scope.rollupNoteLine(...args);
  const rollupNotePreview = (...args) => scope.rollupNotePreview(...args);
  const rollupNoteSortTime = (...args) => scope.rollupNoteSortTime(...args);
  const rollupSourceLine = (...args) => scope.rollupSourceLine(...args);
  const rollupTitleDateKey = (...args) => scope.rollupTitleDateKey(...args);
  const todayIsoDate = (...args) => scope.todayIsoDate(...args);
  function contextualAiCleanText(value = '', max = 4000) {
    const clean = String(value || '').replace(/\s+/g, ' ').trim();
    if (!Number.isFinite(Number(max)) || Number(max) <= 0) return clean;
    return clean.length > Number(max) ? `${clean.slice(0, Number(max)).trimEnd()}...` : clean;
  }
  
  function contextualAiProviderMeta(input = {}) {
    const source = input?.config && typeof input.config === 'object' ? input.config : input;
    const provider = String(source?.provider || input?.provider || 'ollama').trim().toLowerCase() || 'ollama';
    const model = contextualAiCleanText(source?.chatModel || source?.model || input?.model || '', 160);
    const providerLabel = CONTEXTUAL_AI_PROVIDER_LABELS[provider] || 'AI provider';
    return {
      provider,
      providerLabel,
      model,
      providerModelLabel: model ? `${providerLabel} - ${model}` : providerLabel,
      hosted: provider !== 'ollama',
      piiReduction: source?.piiReduction !== false,
    };
  }
  
  function contextualAiSourceFromNote(note = {}, options = {}) {
    if (!note || typeof note !== 'object') return null;
    const id = contextualAiCleanText(note.id || note.noteId || '', 180);
    if (!id && options.requireId !== false) return null;
    const title = contextualAiCleanText(note.title || note.noteTitle || 'Untitled', 180) || 'Untitled';
    const snippetLimit = Math.max(0, Math.min(Number(options.snippetLimit) || 220, 1000));
    const snippet = contextualAiCleanText(
      options.snippet || note.snippet || note.__searchSnippet || rollupNotePreview(note, 2) || note.body || '',
      snippetLimit
    );
    return {
      type: 'note',
      id,
      noteId: id,
      title,
      snippet,
      modifiedAt: note.modifiedAt || note.date || '',
    };
  }
  
  function contextualAiSourcesFromNotes(notes = [], options = {}) {
    const limit = Math.max(1, Math.min(Number(options.limit) || 12, 40));
    const seen = new Set();
    const out = [];
    (notes || []).forEach(note => {
      const source = contextualAiSourceFromNote(note, options);
      if (!source) return;
      const key = source.id || source.title.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      out.push(source);
    });
    return out.slice(0, limit);
  }
  
  function contextualAiNormalizeSection(section = {}) {
    const kind = CONTEXTUAL_AI_SECTION_KINDS.includes(section.kind) ? section.kind : 'fact';
    const title = contextualAiCleanText(section.title || (kind === 'fact' ? 'Facts' : kind === 'suggestion' ? 'Suggestions' : 'Preview'), 120);
    const content = contextualAiCleanText(section.content || section.text || '', 8000);
    const sourceIds = Array.isArray(section.sourceIds)
      ? section.sourceIds.map(id => contextualAiCleanText(id, 180)).filter(Boolean)
      : [];
    return { kind, title, content, sourceIds };
  }
  
  function contextualAiNormalizeSections(sections = []) {
    const list = Array.isArray(sections)
      ? sections
      : [
        ...(Array.isArray(sections.facts) ? sections.facts.map(item => ({ ...item, kind: 'fact' })) : []),
        ...(Array.isArray(sections.suggestions) ? sections.suggestions.map(item => ({ ...item, kind: 'suggestion' })) : []),
        ...(Array.isArray(sections.previews) ? sections.previews.map(item => ({ ...item, kind: 'preview' })) : []),
      ];
    return list
      .map(contextualAiNormalizeSection)
      .filter(section => section.title || section.content);
  }
  
  function contextualAiResult(input = {}) {
    const meta = contextualAiProviderMeta(input.status || input.config || input);
    return {
      type: 'contextual-ai-result',
      outputKind: contextualAiCleanText(input.outputKind || input.kind || 'contextual', 80) || 'contextual',
      title: contextualAiCleanText(input.title || 'Contextual AI result', 180),
      provider: meta.provider,
      providerLabel: meta.providerLabel,
      model: meta.model,
      providerModelLabel: meta.providerModelLabel,
      hosted: meta.hosted,
      piiReduction: meta.piiReduction,
      sources: Array.isArray(input.sources) ? contextualAiSourcesFromNotes(input.sources, { requireId: false }) : [],
      sections: contextualAiNormalizeSections(input.sections || []),
      createdAt: input.createdAt || new Date().toISOString(),
    };
  }
  
  function contextualAiMarkdownMarkers(text = '') {
    const body = String(text || '');
    const collect = (re, map = value => value) => {
      const seen = new Set();
      const out = [];
      let match;
      while ((match = re.exec(body))) {
        const value = contextualAiCleanText(map(match), 180);
        if (!value || seen.has(value.toLowerCase())) continue;
        seen.add(value.toLowerCase());
        out.push(value);
      }
      return out;
    };
    return {
      wikiLinks: collect(/\[\[([^\]]+)\]\]/g, match => match[1]),
      tags: collect(/(^|[\s(])#([A-Za-z0-9_-]+)/g, match => match[2]),
      properties: collect(/^\s*-?\s*([A-Za-z_][A-Za-z0-9_-]*)::\s.*$/gm, match => match[1]),
      taskCount: (body.match(/^\s*[-*]\s+\[[ xX]\]\s+/gm) || []).length,
    };
  }
  
  function contextualAiCompareMarkdownMarkers(before = '', after = '') {
    const left = contextualAiMarkdownMarkers(before);
    const right = contextualAiMarkdownMarkers(after);
    const missing = (from, to) => from.filter(value => !to.some(item => item.toLowerCase() === value.toLowerCase()));
    const missingWikiLinks = missing(left.wikiLinks, right.wikiLinks);
    const missingTags = missing(left.tags, right.tags);
    const missingProperties = missing(left.properties, right.properties);
    const taskCountReduced = right.taskCount < left.taskCount;
    return {
      ok: !missingWikiLinks.length && !missingTags.length && !missingProperties.length && !taskCountReduced,
      before: left,
      after: right,
      missingWikiLinks,
      missingTags,
      missingProperties,
      taskCountReduced,
    };
  }
  
  function contextualAiActionLabel(item = {}) {
    return contextualAiCleanText(item.label || item.text || item.title || 'Untitled action', 220);
  }
  
  // Open todos living in notes untouched for `staleDays` — the "open loops
  // you probably forgot" digest section, oldest first.
  function digestStaleTodoItems(tasks = [], notes = [], { now = new Date(), staleDays = 14, limit = 6 } = {}) {
    const cutoff = now.getTime() - Math.max(1, staleDays) * 24 * 60 * 60 * 1000;
    const noteById = new Map((notes || []).map(note => [note.id, note]));
    return (tasks || [])
      .filter(item => item?.type === 'todo' && !item.checked)
      .map(item => {
        const note = noteById.get(item.noteId);
        const touched = Date.parse(note?.modifiedAt || note?.date || '') || 0;
        return { item, touched };
      })
      .filter(({ touched }) => touched > 0 && touched < cutoff)
      .sort((a, b) => a.touched - b.touched)
      .slice(0, Math.max(1, limit))
      .map(({ item, touched }) => ({ ...item, staleSince: new Date(touched).toISOString() }));
  }
  
  // Recently edited notes that neither link out nor receive links — fresh
  // thinking that never got wired into the vault. Date-titled daily notes
  // are excluded; they live unlinked by design.
  function digestUnlinkedRecentNotes(notes = [], links = [], { now = new Date(), days = 7, limit = 6 } = {}) {
    const cutoff = now.getTime() - Math.max(1, days) * 24 * 60 * 60 * 1000;
    const linked = new Set();
    (links || []).forEach(link => { linked.add(link.source); linked.add(link.target); });
    return (notes || [])
      .filter(note => {
        if (!note?.id || linked.has(note.id)) return false;
        if (rollupTitleDateKey(note)) return false;
        const touched = Date.parse(note.modifiedAt || note.date || '') || 0;
        return touched >= cutoff;
      })
      .sort((a, b) => (Date.parse(b.modifiedAt || b.date || '') || 0) - (Date.parse(a.modifiedAt || a.date || '') || 0))
      .slice(0, Math.max(1, limit))
      .map(note => ({ id: note.id, title: note.title || 'Untitled', modifiedAt: note.modifiedAt || note.date || '' }));
  }
  
  function digestActionItemKey(item = {}) {
    const label = contextualAiActionLabel(item).toLowerCase().replace(/\s+/g, ' ');
    const when = [item?.remindAt?.date, item?.remindAt?.time, item?.rollupDateKey].filter(Boolean).join(':');
    return [item?.noteId || '', label, when].join('|');
  }
  
  function digestUniqueActionItems(items = [], { limit = 50, excludeKeys = [] } = {}) {
    const excluded = new Set(excludeKeys || []);
    const seen = new Set();
    const out = [];
    for (const item of items || []) {
      const key = digestActionItemKey(item);
      if (!item || excluded.has(key) || seen.has(key)) continue;
      seen.add(key);
      out.push(item);
      if (out.length >= Math.max(1, Number(limit) || 50)) break;
    }
    return out;
  }
  
  // A small resurfacing queue for Today. This intentionally favors useful
  // unfinished context over random old notes and explains why each note is
  // shown, so resurfacing never feels mysterious.
  function digestResurfacedNotes(notes = [], links = [], { now = new Date(), minDays = 2, maxDays = 45, limit = 5, excludeIds = [] } = {}) {
    const nowTime = now.getTime();
    const newest = nowTime - Math.max(1, minDays) * 24 * 60 * 60 * 1000;
    const oldest = nowTime - Math.max(minDays + 1, maxDays) * 24 * 60 * 60 * 1000;
    const excluded = new Set(excludeIds || []);
    const connectionCount = new Map();
    (links || []).forEach(link => {
      if (link?.source) connectionCount.set(link.source, (connectionCount.get(link.source) || 0) + 1);
      if (link?.target) connectionCount.set(link.target, (connectionCount.get(link.target) || 0) + 1);
    });
    return (notes || [])
      .filter(note => {
        if (!note?.id || excluded.has(note.id) || rollupTitleDateKey(note)) return false;
        const touched = Date.parse(note.modifiedAt || note.date || '') || 0;
        return touched >= oldest && touched <= newest;
      })
      .map(note => {
        const body = String(note.body || '');
        const openLoop = /^\s*[-*]\s+\[ \]\s+/m.test(body);
        const connections = connectionCount.get(note.id) || 0;
        const reason = note.pinned ? 'Pinned'
          : openLoop ? 'Open loop'
          : connections ? 'Connected context'
          : 'Recently changed';
        const score = (note.pinned ? 100 : 0) + (openLoop ? 60 : 0) + Math.min(30, connections * 5)
          + ((Date.parse(note.modifiedAt || note.date || '') || 0) / 1e13);
        return { id: note.id, title: note.title || 'Untitled', reason, score, modifiedAt: note.modifiedAt || note.date || '' };
      })
      .sort((a, b) => b.score - a.score || (Date.parse(b.modifiedAt || '') || 0) - (Date.parse(a.modifiedAt || '') || 0))
      .slice(0, Math.max(1, Number(limit) || 5))
      .map(({ score, ...note }) => note);
  }
  
  function contextualAiBuildTodayRecapContext({ notes = [], tasks = [], reminders = [], agendaItems = [], links = [], now = new Date(), weekStart = 'monday', limit = 6 } = {}) {
    const today = todayIsoDate(now);
    const maxItems = Math.max(1, Math.min(Number(limit) || 6, 12));
    const noteById = new Map((notes || []).map(note => [note.id, note]));
    const todayNotes = (notes || [])
      .filter(note => {
        const titleDate = rollupTitleDateKey(note);
        return titleDate === today || rollupDateKey(note?.date) === today || rollupDateKey(note?.modifiedAt) === today;
      })
      .sort((a, b) => rollupNoteSortTime(b, 'modified') - rollupNoteSortTime(a, 'modified'))
      .slice(0, maxItems);
    const openTasks = rollupFilterTaskItems(tasks, notes, { range: 'today', now, weekStart }).slice(0, maxItems);
    const dueReminders = rollupFilterReminderItems(reminders, notes, { range: 'today', now, weekStart }).slice(0, maxItems);
    const todayAgenda = (agendaItems || []).slice(0, maxItems);
    const staleTodos = digestStaleTodoItems(tasks, notes, { now, limit: maxItems });
    const unlinkedNotes = digestUnlinkedRecentNotes(notes, links, { now, limit: maxItems });
    const sourceIds = new Set();
    todayNotes.forEach(note => note?.id && sourceIds.add(note.id));
    [...openTasks, ...dueReminders, ...todayAgenda, ...staleTodos].forEach(item => item?.noteId && sourceIds.add(item.noteId));
    unlinkedNotes.forEach(note => sourceIds.add(note.id));
    const sourceNotes = [...sourceIds].map(id => noteById.get(id)).filter(Boolean);
    const sources = contextualAiSourcesFromNotes(sourceNotes.length ? sourceNotes : todayNotes, { limit: maxItems * 2 });
    return {
      today,
      notes: todayNotes,
      tasks: openTasks,
      reminders: dueReminders,
      agendaItems: todayAgenda,
      staleTodos,
      unlinkedNotes,
      sources,
    };
  }
  
  function contextualAiBuildTodayRecapPrompt(context = {}) {
    const sourceLine = source => `- ${source.title}${source.snippet ? `: ${source.snippet}` : ''}`;
    const actionLine = item => `- ${contextualAiActionLabel(item)} (${item.noteTitle || item.noteId || 'source note'})`;
    return [
      `Create a concise daily recap for ${context.today || todayIsoDate()}.`,
      'Use only the source notes and action items below.',
      'Return exactly these Markdown headings: Changed today, Open loops, Tomorrow planning suggestions.',
      'Keep facts separate from suggestions and cite source note titles in the text when useful.',
      '',
      'Source notes:',
      ...(context.sources?.length ? context.sources.map(sourceLine) : ['- No source notes today.']),
      '',
      'Open tasks:',
      ...(context.tasks?.length ? context.tasks.map(actionLine) : ['- None.']),
      '',
      'Reminders:',
      ...(context.reminders?.length ? context.reminders.map(actionLine) : ['- None.']),
      '',
      'Agenda today:',
      ...(context.agendaItems?.length ? context.agendaItems.map(actionLine) : ['- None.']),
      '',
      'Stale todos (their notes untouched for 2+ weeks):',
      ...(context.staleTodos?.length ? context.staleTodos.map(actionLine) : ['- None.']),
      '',
      'Recently edited notes with no links in or out:',
      ...(context.unlinkedNotes?.length ? context.unlinkedNotes.map(note => `- ${note.title}`) : ['- None.']),
    ].join('\n');
  }
  
  function contextualAiExtractMarkdownSection(text = '', labels = []) {
    const wanted = (labels || []).map(label => contextualAiCleanText(label).toLowerCase()).filter(Boolean);
    if (!wanted.length) return '';
    const lines = String(text || '').split(/\r?\n/);
    let collecting = false;
    const out = [];
    for (const line of lines) {
      const heading = line.replace(/^#{1,6}\s+/, '').replace(/[:*]+$/g, '').trim().toLowerCase();
      const isHeading = /^#{1,6}\s+/.test(line) || wanted.includes(heading);
      if (isHeading && wanted.includes(heading)) {
        collecting = true;
        continue;
      }
      if (collecting && /^#{1,6}\s+/.test(line)) break;
      if (collecting) out.push(line);
    }
    return out.join('\n').trim();
  }
  
  function contextualAiBuildTodayRecapResult({ aiText = '', context = {}, status = null, createdAt = null } = {}) {
    const sourceIds = (context.sources || []).map(source => source.id).filter(Boolean);
    const changedFallback = context.sources?.length
      ? context.sources.map(source => `${source.title}${source.snippet ? `: ${source.snippet}` : ''}`).join('\n')
      : 'No source notes were captured today.';
    const loops = [
      ...(context.tasks || []).map(contextualAiActionLabel),
      ...(context.reminders || []).map(contextualAiActionLabel),
      ...(context.agendaItems || []).map(contextualAiActionLabel),
    ].filter(Boolean);
    const loopsFallback = loops.length ? loops.map(item => `- ${item}`).join('\n') : 'No open loops found for today.';
    const tomorrowFallback = loops.length
      ? loops.slice(0, 4).map(item => `- Plan ${item}`).join('\n')
      : '- Review today and choose one next action.';
    const changed = contextualAiExtractMarkdownSection(aiText, ['Changed today', 'What changed today'])
      || contextualAiCleanText(aiText, 1200)
      || changedFallback;
    const openLoops = contextualAiExtractMarkdownSection(aiText, ['Open loops', 'What remains open'])
      || loopsFallback;
    const tomorrow = contextualAiExtractMarkdownSection(aiText, ['Tomorrow planning suggestions', 'Tomorrow planning', 'What should I plan tomorrow'])
      || tomorrowFallback;
    return contextualAiResult({
      status,
      title: `Today AI recap - ${context.today || todayIsoDate()}`,
      outputKind: 'today-recap',
      sources: context.sources || [],
      sections: [
        { kind: 'fact', title: 'Changed today', content: changed, sourceIds },
        { kind: 'fact', title: 'Open loops', content: openLoops, sourceIds },
        { kind: 'suggestion', title: 'Tomorrow planning suggestions', content: tomorrow, sourceIds },
      ],
      createdAt,
    });
  }
  
  function rollupBuildEndDayRecap({ notes = [], tasks = [], reminders = [], now = new Date(), limit = 5 } = {}) {
    const today = todayIsoDate(now);
    const todayNotes = (notes || [])
      .filter(note => {
        const titleDate = rollupTitleDateKey(note);
        return titleDate === today || rollupDateKey(note?.date) === today || rollupDateKey(note?.modifiedAt) === today;
      })
      .slice(0, limit);
    const openTasks = (tasks || [])
      .filter(item => item && !item.checked && !item.isReminderOnly && item.type !== 'reminder')
      .slice(0, limit);
    const visibleReminders = rollupFilterReminderItems(reminders, notes, { range: 'today', now }).slice(0, limit);
    const tomorrowCandidates = [
      ...openTasks.slice(0, Math.ceil(limit / 2)),
      ...visibleReminders.filter(item => item.rollupStatus === 'upcoming').slice(0, Math.floor(limit / 2)),
    ].slice(0, limit);
    const list = (items, mapItem, empty) => (items.length ? items.map(mapItem) : [`- ${empty}`]);
  
    return [
      `## End-day recap - ${today}`,
      '',
      '### Highlights',
      ...list(todayNotes, rollupNoteLine, 'No notes captured today.'),
      '',
      '### Decisions',
      ...rollupDecisionLines(todayNotes.length ? todayNotes : notes, now, limit),
      '',
      '### Open loops',
      ...list(openTasks, rollupSourceLine, 'No open loops captured.'),
      '',
      '### Tomorrow candidates',
      ...list(tomorrowCandidates, rollupSourceLine, 'No tomorrow candidates yet.'),
    ].join('\n');
  }
  
  function rollupAppendEndDayRecap(body = '', context = {}) {
    return rollupAppendMarkdownSection(body, rollupBuildEndDayRecap(context));
  }
  return { contextualAiCleanText, contextualAiProviderMeta, contextualAiSourceFromNote, contextualAiSourcesFromNotes, contextualAiNormalizeSection, contextualAiNormalizeSections, contextualAiResult, contextualAiMarkdownMarkers, contextualAiCompareMarkdownMarkers, contextualAiActionLabel, digestStaleTodoItems, digestUnlinkedRecentNotes, digestActionItemKey, digestUniqueActionItems, digestResurfacedNotes, contextualAiBuildTodayRecapContext, contextualAiBuildTodayRecapPrompt, contextualAiExtractMarkdownSection, contextualAiBuildTodayRecapResult, rollupBuildEndDayRecap, rollupAppendEndDayRecap };
}

module.exports = { createContextualAiHelpers };
