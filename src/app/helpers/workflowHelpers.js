function createWorkflowHelpers(scope = {}) {
  const ZOTERO_ITEM_KEY_RE = scope.ZOTERO_ITEM_KEY_RE;
  const ZOTERO_SOURCE_TAGS = scope.ZOTERO_SOURCE_TAGS;
  const bodyPropertyValue = (...args) => scope.bodyPropertyValue(...args);
  const captureCleanText = (...args) => scope.captureCleanText(...args);
  const captureUniqueTags = (...args) => scope.captureUniqueTags(...args);
  const todayIsoDate = (...args) => scope.todayIsoDate(...args);
  function zoteroCleanItemKey(value = '') {
    const key = String(value || '').trim();
    return ZOTERO_ITEM_KEY_RE.test(key) ? key : '';
  }
  
  function zoteroCleanOneLine(value = '', max = 300) {
    return captureCleanText(value, max).replace(/\s+/g, ' ').trim();
  }
  
  function zoteroYear(value = '') {
    const match = String(value || '').match(/\b(1[5-9]\d{2}|20\d{2}|21\d{2})\b/);
    return match ? match[1] : '';
  }
  
  function zoteroCreatorsText(value = '') {
    if (Array.isArray(value)) {
      return value
        .map(creator => [creator.firstName, creator.lastName].filter(Boolean).join(' ').trim() || String(creator.name || '').trim())
        .filter(Boolean)
        .slice(0, 8)
        .join(', ');
    }
    return zoteroCleanOneLine(value, 500);
  }
  
  function zoteroNormalizeAttachment(attachment = {}) {
    return {
      key: zoteroCleanItemKey(attachment.key),
      title: zoteroCleanOneLine(attachment.title || attachment.filename || 'Attachment', 180),
      contentType: zoteroCleanOneLine(attachment.contentType, 120),
      filename: zoteroCleanOneLine(attachment.filename, 180),
    };
  }
  
  function zoteroNormalizeSource(readResult = {}) {
    const item = readResult.item || readResult;
    const itemKey = zoteroCleanItemKey(item.key || readResult.itemKey || readResult.key);
    const title = zoteroCleanOneLine(item.title || (itemKey ? `Zotero source ${itemKey}` : 'Zotero source'), 180);
    const date = zoteroCleanOneLine(item.date || item.year, 120);
    const fullText = captureCleanText(readResult.fullText || '', 1800).trim();
    return {
      itemKey,
      title,
      itemType: zoteroCleanOneLine(item.itemType, 80),
      creators: zoteroCreatorsText(item.creators),
      date,
      year: zoteroYear(date),
      publicationTitle: zoteroCleanOneLine(item.publicationTitle || item.bookTitle || item.proceedingsTitle, 180),
      url: zoteroCleanOneLine(item.url, 500),
      doi: zoteroCleanOneLine(item.doi || item.DOI, 180),
      abstractNote: captureCleanText(item.abstractNote, 2400).trim(),
      attachments: (Array.isArray(readResult.attachments) ? readResult.attachments : [])
        .map(zoteroNormalizeAttachment)
        .filter(attachment => attachment.key || attachment.title),
      fullTextExcerpt: fullText,
      fullTextItemKey: zoteroCleanItemKey(readResult.fullTextItemKey),
      fullTextTruncated: !!readResult.fullTextTruncated,
      fullTextError: zoteroCleanOneLine(readResult.fullTextError, 240),
    };
  }
  
  function zoteroFormatAttachment(attachment = {}) {
    const parts = [
      attachment.title || 'Attachment',
      attachment.filename && attachment.filename !== attachment.title ? attachment.filename : '',
      attachment.contentType,
      attachment.key,
    ].filter(Boolean);
    return `- ${parts.join(' - ')}`;
  }
  
  function zoteroSourceNoteProperties(source = {}) {
    return [
      ['type', 'source'],
      ['source', 'zotero'],
      ['zoteroKey', source.itemKey],
      ['itemType', source.itemType],
      ['creators', source.creators],
      ['year', source.year],
      ['publication', source.publicationTitle],
      ['doi', source.doi],
      ['url', source.url],
    ]
      .filter(([, value]) => String(value || '').trim())
      .map(([key, value]) => `${key}:: ${value}`)
      .join('\n');
  }
  
  function zoteroBuildSourceNoteBody(source = {}) {
    const sections = [
      `# ${source.title || 'Zotero source'}`,
      zoteroSourceNoteProperties(source),
    ];
    if (source.abstractNote) sections.push(`## Abstract\n${source.abstractNote}`);
    if (source.attachments?.length) sections.push(`## Attachments\n${source.attachments.map(zoteroFormatAttachment).join('\n')}`);
    if (source.fullTextExcerpt) {
      const excerpt = `## Full text excerpt\n${source.fullTextExcerpt}`;
      sections.push(source.fullTextTruncated ? `${excerpt}\n\nExcerpt truncated by VispNote.` : excerpt);
    }
    sections.push('## Reading tasks\n- [ ] Read source and confirm metadata\n- [ ] Extract key claims\n- [ ] Capture useful quotes\n- [ ] Link related VispNote notes');
    return `${sections.filter(Boolean).join('\n\n')}\n`;
  }
  
  function zoteroBuildSourceNoteDraft(readResult = {}, options = {}) {
    const source = zoteroNormalizeSource(readResult);
    const title = captureCleanText(options.title || source.title || 'Zotero source', 180).trim() || 'Zotero source';
    return {
      type: 'zotero-source-note-draft',
      itemKey: source.itemKey,
      title,
      source,
      tags: captureUniqueTags(options.tags || [], ZOTERO_SOURCE_TAGS),
      body: zoteroBuildSourceNoteBody({ ...source, title }),
    };
  }
  
  function zoteroFindSourceNote(notes = [], itemKey = '') {
    const key = zoteroCleanItemKey(itemKey).toLowerCase();
    if (!key) return null;
    return (notes || []).find(note => zoteroCleanItemKey(bodyPropertyValue(note?.body || '', 'zoteroKey')).toLowerCase() === key) || null;
  }
  
  function zoteroBuildSourceNotePlan(options = {}) {
    const notes = Array.isArray(options.notes) ? options.notes : [];
    const requestedKey = zoteroCleanItemKey(options.itemKey || options.readResult?.item?.key || options.readResult?.key);
    const existing = zoteroFindSourceNote(notes, requestedKey);
    if (existing) {
      return {
        type: 'zotero-source-note-plan',
        action: 'open',
        mode: 'open',
        itemKey: requestedKey,
        noteId: existing.id || null,
        noteTitle: existing.title || requestedKey,
        existingNote: existing,
        draft: null,
        createNote: null,
      };
    }
    const draft = zoteroBuildSourceNoteDraft(options.readResult || {}, options);
    if (!draft.itemKey) {
      return {
        type: 'zotero-source-note-plan',
        action: 'unavailable',
        mode: 'unavailable',
        itemKey: requestedKey,
        error: 'A valid Zotero item key is required.',
        existingNote: null,
        draft: null,
        createNote: null,
      };
    }
    const existingFromDraft = zoteroFindSourceNote(notes, draft.itemKey);
    if (existingFromDraft) {
      return {
        type: 'zotero-source-note-plan',
        action: 'open',
        mode: 'open',
        itemKey: draft.itemKey,
        noteId: existingFromDraft.id || null,
        noteTitle: existingFromDraft.title || draft.itemKey,
        existingNote: existingFromDraft,
        draft: null,
        createNote: null,
      };
    }
    return {
      type: 'zotero-source-note-plan',
      action: 'create',
      mode: 'create',
      itemKey: draft.itemKey,
      source: draft.source,
      existingNote: null,
      draft,
      createNote: {
        title: draft.title,
        body: draft.body,
        tags: draft.tags,
      },
    };
  }
  
  function filterCommands(commands = [], query = '', limit = 12) {
    const q = String(query || '').trim().toLowerCase();
    return (commands || [])
      .filter(cmd => cmd && cmd.enabled !== false)
      .map(cmd => {
        const hay = `${cmd.title || ''} ${cmd.section || ''} ${cmd.keywords || ''}`.toLowerCase();
        const score = !q ? 0 : hay.includes(q) ? hay.indexOf(q) : 9999;
        return { cmd, score };
      })
      .filter(item => !q || item.score < 9999)
      .sort((a, b) => a.score - b.score || String(a.cmd.title || '').localeCompare(String(b.cmd.title || '')))
      .slice(0, limit)
      .map(item => item.cmd);
  }
  
  function decorateNotesWithSearchDetails(notes = [], searchDetails = new Map()) {
    const details = searchDetails instanceof Map
      ? searchDetails
      : new Map(Object.entries(searchDetails || {}));
    return (notes || []).map(note => {
      const detail = details.get(note.id);
      return detail ? { ...note, __searchSnippet: detail.snippet, __matchedFields: detail.matchedFields } : note;
    });
  }
  
  function normalizeWorkflowStatus(raw, states = [], normalizeId) {
    const id = typeof normalizeId === 'function'
      ? normalizeId(raw)
      : String(raw || '').trim().toUpperCase().replace(/[^A-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 18);
    return (states || []).some(state => state.id === id) ? id : '';
  }
  
  function workflowNotePreview(note) {
    return String(note?.body || '')
      .split('\n')
      .filter(line => !/^\s*-?\s*[a-zA-Z][a-zA-Z0-9_-]*::\s*/.test(line))
      .join('\n')
      .replace(/^#{1,4}\s+.*/gm, '')
      .replace(/\[\[([^\]]+)\]\]/g, '$1')
      .replace(/[`*>#]/g, '')
      .replace(/-\s+\[[ x]\]/g, '')
      .replace(/-\s+/g, '')
      .trim()
      .replace(/\s+/g, ' ')
      .slice(0, 180);
  }
  
  function collectWorkflowNotes(notes = [], states = [], options = {}) {
    const safeStates = states || [];
    const stateIds = safeStates.map(s => s.id);
    const counts = Object.fromEntries(stateIds.map(id => [id, 0]));
    const byState = Object.fromEntries(stateIds.map(id => [id, []]));
    const noteIdsByState = Object.fromEntries(stateIds.map(id => [id, new Set()]));
    const archivedNotes = [];
    const propertyRegexCache = new Map();
    const propertyValue = typeof options.propertyValue === 'function'
      ? options.propertyValue
      : (body, key) => {
        let regex = propertyRegexCache.get(key);
        if (!regex) {
          const safeKey = String(key || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          regex = new RegExp(`^\\s*(?:-\\s*)?${safeKey}::\\s*(.*)$`, 'im');
          propertyRegexCache.set(key, regex);
        }
        const match = String(body || '').match(regex);
        return match ? String(match[1] || '').trim() : '';
      };
  
    (notes || []).forEach(note => {
      const workflow = normalizeWorkflowStatus(propertyValue(note.body || '', 'status'), safeStates, options.normalizeId);
      if (!workflow || !Object.prototype.hasOwnProperty.call(counts, workflow)) return;
      const item = {
        id: note.id,
        noteId: note.id,
        noteTitle: note.title,
        title: note.title,
        noteTags: note.tags || [],
        text: workflowNotePreview(note),
        kind: 'note',
        workflow,
        modifiedAt: note.modifiedAt || note.date,
      };
      if (note.workflowArchived) {
        archivedNotes.push({
          id: note.id,
          title: note.title,
          tags: note.tags || [],
          workflow,
          workflowCount: 1,
        });
        return;
      }
      counts[item.workflow]++;
      noteIdsByState[item.workflow].add(note.id);
      byState[item.workflow].push(item);
    });
  
    return {
      counts,
      byState,
      noteIdsByState,
      archivedNotes,
      total: Object.values(counts).reduce((sum, count) => sum + count, 0),
    };
  }
  
  function reminderKey(item) {
    return [item.noteId, item.line ?? item.blockId ?? '', item.remindAt?.date || '', item.remindAt?.time || '', item.text || ''].join('|');
  }
  
  function collectReminderItems(notes = [], parser, walk) {
    if (!parser?.parse) return [];
    const out = [];
    (notes || []).forEach(note => {
      const pushItem = (text, meta = {}) => {
        const remindAt = parser.parse(text);
        if (!remindAt) return;
        const defer = agendaParseDeferMarker(text);
        out.push({
          noteId: note.id,
          noteTitle: note.title,
          text: agendaStripDeferMarkers(parser.strip ? parser.strip(text) : String(text || '').replace(remindAt.raw, '').trim()),
          remindAt,
          deferUntil: defer?.date || '',
          ...meta,
        });
      };
      if (note.blocks?.length && typeof walk === 'function') {
        walk(note.blocks, block => {
          if (block.kind === 'todo' && block.checked) return;
          pushItem(block.content || '', { blockId: block.id });
        });
        return;
      }
      String(note.body || '').split('\n').forEach((line, lineIndex) => {
        if (/^\s*-\s+\[[xX]\]/.test(line)) return;
        pushItem(line, { line: lineIndex });
      });
    });
    return out.map(item => ({ ...item, key: reminderKey(item) }));
  }
  
  function taskItemKey(item) {
    return [
      item.type || (item.isReminderOnly ? 'reminder' : 'todo'),
      item.noteId,
      item.blockId ?? item.line ?? '',
      item.remindAt?.date || '',
      item.remindAt?.time || '',
      item.deferUntil || '',
      item.text || '',
    ].join('|');
  }
  
  function agendaParseDeferMarker(text = '') {
    const pattern = /(^|\s)@(defer|hide-until)\s+(\d{4}-\d{2}-\d{2})(?=\s|$)/ig;
    let match;
    while ((match = pattern.exec(String(text || '')))) {
      if (!rollupIsValidIsoDateKey(match[3])) continue;
      return {
        raw: match[0].trim(),
        date: match[3],
        marker: String(match[2] || '').toLowerCase(),
      };
    }
    return null;
  }
  
  function agendaStripDeferMarkers(text = '') {
    return String(text || '')
      .replace(/(^|\s)@(defer|hide-until)\s+\d{4}-\d{2}-\d{2}(?=\s|$)/ig, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }
  
  function agendaCleanActionText(text = '') {
    return agendaStripDeferMarkers(String(text || '')
      .replace(/^\s*[-*]\s+\[[ xX]\]\s*/, '')
      .replace(/@remind\s+\d{4}-\d{2}-\d{2}(?:\s+\d{2}:\d{2})?/ig, ' '))
      .replace(/\s+/g, ' ')
      .trim();
  }
  
  function agendaBuildTaskContent(text = '', date = '', time = '', deferUntil = '') {
    const clean = agendaCleanActionText(text);
    if (!clean) return '';
    const cleanDate = String(date || '').trim();
    const cleanTime = String(time || '').trim();
    const cleanDefer = String(deferUntil || '').trim();
    const parts = [clean];
    if (rollupIsValidIsoDateKey(cleanDate)) {
      parts.push(`@remind ${[cleanDate, cleanTime].filter(Boolean).join(' ')}`);
    }
    if (rollupIsValidIsoDateKey(cleanDefer)) {
      parts.push(`@defer ${cleanDefer}`);
    }
    return parts.join(' ');
  }
  
  function agendaIsDeferred(item = {}, now = new Date()) {
    const parsed = item.deferUntil || agendaParseDeferMarker(item.text || item.label || '')?.date || '';
    const deferUntil = String(parsed || '').trim();
    if (!rollupIsValidIsoDateKey(deferUntil) || item.checked) return false;
    return deferUntil > todayIsoDate(now);
  }
  
  function agendaNormalizeActionIdentity(text = '') {
    return agendaCleanActionText(text).toLowerCase();
  }
  
  function agendaLineLooksAction(line = '') {
    return /^\s*[-*]\s+\[[ xX]\]\s+/.test(String(line || ''))
      || /@(remind|defer|hide-until)\s+\d{4}-\d{2}-\d{2}/i.test(String(line || ''));
  }
  
  function agendaBodyHasActionText(body = '', text = '') {
    const target = agendaNormalizeActionIdentity(text);
    if (!target) return false;
    return String(body || '').split('\n')
      .some(line => agendaLineLooksAction(line) && agendaNormalizeActionIdentity(line) === target);
  }
  
  function agendaReplaceUniqueSourceText(body = '', source = '', nextText = '') {
    const text = String(body || '');
    const needle = String(source || '').trim();
    if (!needle) return text;
    const first = text.indexOf(needle);
    if (first < 0) return text;
    const second = text.indexOf(needle, first + needle.length);
    if (second >= 0) return text;
    return `${text.slice(0, first)}${nextText}${text.slice(first + needle.length)}`;
  }
  
  function collectTaskItems(notes = [], parser, walk) {
    const out = [];
    const seenSources = new Set();
    const parse = text => parser?.parse?.(text) || null;
    const strip = text => parser?.strip ? parser.strip(text) : String(text || '').replace(/@remind\s+\d{4}-\d{2}-\d{2}(?:\s+\d{2}:\d{2})?/g, '').trim();
    const push = (note, text, meta = {}) => {
      const raw = String(text || '');
      const remindAt = parse(raw);
      const defer = agendaParseDeferMarker(raw);
      const isTodo = meta.kind === 'todo';
      if (!isTodo && !remindAt) return;
      const sourceKey = [
        note.id,
        meta.blockId ?? meta.line ?? agendaNormalizeActionIdentity(raw),
        isTodo ? 'todo' : 'reminder',
      ].join('|');
      if (seenSources.has(sourceKey)) return;
      seenSources.add(sourceKey);
      const item = {
        type: isTodo ? 'todo' : 'reminder',
        noteId: note.id,
        noteTitle: note.title || 'Untitled',
        noteTags: Array.isArray(note.tags) ? note.tags : [],
        text: raw,
        label: agendaCleanActionText(strip(raw)),
        checked: !!meta.checked,
        isReminderOnly: !isTodo,
        remindAt,
        deferUntil: defer?.date || '',
        noteDate: note.date,
        blockId: meta.blockId,
        line: meta.line,
      };
      out.push({ ...item, key: taskItemKey(item) });
    };
  
    (notes || []).forEach(note => {
      if (note.blocks?.length && typeof walk === 'function') {
        walk(note.blocks, block => {
          if (block.kind === 'todo') {
            push(note, block.content || '', { kind: 'todo', checked: !!block.checked, blockId: block.id });
          } else {
            push(note, block.content || '', { kind: 'reminder', blockId: block.id });
          }
        });
        return;
      }
      String(note.body || '').split('\n').forEach((line, lineIndex) => {
        const match = line.match(/^(\s*)-\s+\[([ xX])\]\s+(.*)$/);
        if (match) {
          push(note, match[3], { kind: 'todo', checked: /[xX]/.test(match[2]), line: lineIndex });
          return;
        }
        push(note, line, { kind: 'reminder', line: lineIndex });
      });
    });
    return out;
  }
  
  function rollupNormalizeRange(range = 'today') {
    return ['today', 'yesterday', 'week', 'month'].includes(range) ? range : 'today';
  }
  
  function rollupNormalizeGroupBy(groupBy = 'created') {
    return ['created', 'modified', 'title-date'].includes(groupBy) ? groupBy : 'created';
  }
  
  function rollupDateKey(value) {
    if (!value) return '';
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return date.toISOString().slice(0, 10);
  }
  
  function rollupIsValidIsoDateKey(value = '') {
    const key = String(value || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return false;
    return rollupDateKey(`${key}T00:00:00.000Z`) === key;
  }
  
  function rollupShiftDateKey(key, days) {
    if (!rollupIsValidIsoDateKey(key)) return '';
    const date = new Date(`${key}T00:00:00.000Z`);
    date.setUTCDate(date.getUTCDate() + days);
    return rollupDateKey(date);
  }
  
  function rollupDateRangeBounds(range = 'today', now = new Date(), weekStart = 'monday') {
    const today = rollupDateKey(now) || todayIsoDate();
    const start = new Date(`${today}T00:00:00.000Z`);
    const end = new Date(start);
    const normalized = rollupNormalizeRange(range);
    if (normalized === 'yesterday') {
      start.setUTCDate(start.getUTCDate() - 1);
      end.setUTCDate(end.getUTCDate() - 1);
    } else if (normalized === 'week') {
      const day = start.getUTCDay();
      const offset = weekStart === 'sunday' ? day : (day + 6) % 7;
      start.setUTCDate(start.getUTCDate() - offset);
    } else if (normalized === 'month') {
      start.setUTCDate(1);
    }
    return {
      start: rollupDateKey(start),
      end: rollupDateKey(end),
      today,
    };
  }
  
  function rollupDateKeyInRange(key, range = 'today', now = new Date(), weekStart = 'monday') {
    if (!rollupIsValidIsoDateKey(key)) return false;
    const bounds = rollupDateRangeBounds(range, now, weekStart);
    return key >= bounds.start && key <= bounds.end;
  }
  
  function rollupTitleDateKey(note) {
    const match = String(note?.title || '').trim().match(/^(\d{4}-\d{2}-\d{2})(?:\b|$)/);
    return match && rollupIsValidIsoDateKey(match[1]) ? match[1] : '';
  }
  
  function rollupNoteDateKey(note, groupBy = 'created') {
    const normalized = rollupNormalizeGroupBy(groupBy);
    if (normalized === 'title-date') return rollupTitleDateKey(note) || rollupDateKey(note?.date);
    if (normalized === 'modified') return rollupDateKey(note?.modifiedAt || note?.date);
    return rollupDateKey(note?.date);
  }
  
  function rollupNoteSortTime(note, groupBy = 'created') {
    const normalized = rollupNormalizeGroupBy(groupBy);
    const source = normalized === 'modified'
      ? (note?.modifiedAt || note?.date)
      : normalized === 'title-date'
        ? (rollupTitleDateKey(note) ? `${rollupTitleDateKey(note)}T00:00:00.000Z` : note?.date)
        : note?.date;
    const time = new Date(source || 0).getTime();
    return Number.isNaN(time) ? 0 : time;
  }
  return { zoteroCleanItemKey, zoteroCleanOneLine, zoteroYear, zoteroCreatorsText, zoteroNormalizeAttachment, zoteroNormalizeSource, zoteroFormatAttachment, zoteroSourceNoteProperties, zoteroBuildSourceNoteBody, zoteroBuildSourceNoteDraft, zoteroFindSourceNote, zoteroBuildSourceNotePlan, filterCommands, decorateNotesWithSearchDetails, normalizeWorkflowStatus, workflowNotePreview, collectWorkflowNotes, reminderKey, collectReminderItems, taskItemKey, agendaParseDeferMarker, agendaStripDeferMarkers, agendaCleanActionText, agendaBuildTaskContent, agendaIsDeferred, agendaNormalizeActionIdentity, agendaLineLooksAction, agendaBodyHasActionText, agendaReplaceUniqueSourceText, collectTaskItems, rollupNormalizeRange, rollupNormalizeGroupBy, rollupDateKey, rollupIsValidIsoDateKey, rollupShiftDateKey, rollupDateRangeBounds, rollupDateKeyInRange, rollupTitleDateKey, rollupNoteDateKey, rollupNoteSortTime };
}

module.exports = { createWorkflowHelpers };
