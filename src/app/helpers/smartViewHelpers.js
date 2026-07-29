function createSmartViewHelpers(scope = {}) {
  const SMART_VIEW_FORMAT = scope.SMART_VIEW_FORMAT;
  const SMART_VIEW_FORMATS = scope.SMART_VIEW_FORMATS || [scope.SMART_VIEW_FORMAT];
  const SMART_VIEW_LAYOUTS = scope.SMART_VIEW_LAYOUTS || ['list'];
  const SMART_VIEW_SORT_FIELDS = scope.SMART_VIEW_SORT_FIELDS;
  const SMART_VIEW_PROPERTY_OPS = scope.SMART_VIEW_PROPERTY_OPS || ['is'];
  const SMART_VIEW_TYPES = scope.SMART_VIEW_TYPES;
  const agendaCleanActionText = (...args) => scope.agendaCleanActionText(...args);
  const agendaIsDeferred = (...args) => scope.agendaIsDeferred(...args);
  const bodyPropertyLineRe = (...args) => scope.bodyPropertyLineRe(...args);
  const bodyPropertyValue = (...args) => scope.bodyPropertyValue(...args);
  const collectTaskItems = (...args) => scope.collectTaskItems(...args);
  const normalizeTagName = (...args) => scope.normalizeTagName(...args);
  const normalizeWorkflowStatus = (...args) => scope.normalizeWorkflowStatus(...args);
  const novelTitleKey = (...args) => scope.novelTitleKey(...args);
  const novelWikiTitles = (...args) => scope.novelWikiTitles(...args);
  const rollupDateKey = (...args) => scope.rollupDateKey(...args);
  const rollupIsValidIsoDateKey = (...args) => scope.rollupIsValidIsoDateKey(...args);
  const taskItemKey = (...args) => scope.taskItemKey(...args);
  function smartViewCleanText(value = '') {
    return String(value ?? '').trim();
  }
  
  function smartViewCleanList(value = []) {
    const raw = Array.isArray(value)
      ? value
      : String(value || '').split(',');
    return raw
      .map(item => smartViewCleanText(item))
      .filter(Boolean)
      .filter((item, index, arr) => arr.indexOf(item) === index);
  }
  
  function smartViewDateKey(value = '') {
    const clean = smartViewCleanText(value);
    if (!clean) return '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(clean)) return rollupIsValidIsoDateKey(clean) ? clean : '';
    return rollupDateKey(clean);
  }
  
  function smartViewWorkflowKey(value = '') {
    return smartViewCleanText(value)
      .toUpperCase()
      .replace(/[^A-Z0-9_-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 18);
  }
  
  function smartViewNormalizeType(value = 'notes') {
    return SMART_VIEW_TYPES.includes(value) ? value : 'notes';
  }
  
  function smartViewNormalizeActionStatus(value = '') {
    const clean = smartViewCleanText(value).toLowerCase().replace(/_/g, '-');
    if (clean === 'done' || clean === 'complete') return 'completed';
    return ['open', 'completed', 'deferred', 'reminder'].includes(clean) ? clean : '';
  }
  
  function smartViewNormalizeActionType(value = '') {
    const clean = smartViewCleanText(value).toLowerCase().replace(/_/g, '-');
    if (clean === 'todo' || clean === 'todos' || clean === 'task' || clean === 'tasks') return 'task';
    if (clean === 'reminder' || clean === 'reminders') return 'reminder';
    return '';
  }
  
  // A property condition is a key, an operator and the values it compares
  // against. Everything written before operators existed carried no `op`, so
  // the default is `is` and those definitions keep meaning what they meant.
  function smartViewNormalizePropertyOp(value) {
    const op = smartViewCleanText(value).toLowerCase();
    return SMART_VIEW_PROPERTY_OPS.includes(op) ? op : 'is';
  }

  function smartViewNormalizePropertyFilters(filters = {}) {
    const out = [];
    const add = (key, value, op) => {
      const cleanKey = smartViewCleanText(key);
      if (!cleanKey) return;
      const values = smartViewCleanList(value);
      out.push({ key: cleanKey, values, op: smartViewNormalizePropertyOp(op) });
    };
  
    if (filters.property && typeof filters.property === 'object' && !Array.isArray(filters.property)) {
      add(filters.property.key, filters.property.value, filters.property.op);
    }
    if (Array.isArray(filters.properties)) {
      filters.properties.forEach(item => {
        // `value` is what a saved definition carries and `values` is what a
        // normalized one carries. Both are read because smartViewQuery
        // normalizes and then hands the result to smartViewQueryNotes, which
        // normalizes again — reading only `value` silently emptied every
        // property condition on the second pass, so a filter with a value
        // behaved like "just has this key".
        if (item && typeof item === 'object') add(item.key, item.values ?? item.value, item.op);
      });
    } else if (filters.properties && typeof filters.properties === 'object') {
      Object.entries(filters.properties).forEach(([key, value]) => add(key, value));
    }
    add(filters.propertyKey, filters.propertyValue);
  
    return out;
  }
  
  function smartViewNormalizeFilters(filters = {}) {
    const source = filters && typeof filters === 'object' ? filters : {};
    return {
      titleContains: smartViewCleanText(source.titleContains || source.title),
      tags: smartViewCleanList(source.tags || source.tag).map(normalizeTagName).filter(Boolean),
      createdFrom: smartViewDateKey(source.createdFrom || source.createdAfter),
      createdTo: smartViewDateKey(source.createdTo || source.createdBefore),
      modifiedFrom: smartViewDateKey(source.modifiedFrom || source.modifiedAfter),
      modifiedTo: smartViewDateKey(source.modifiedTo || source.modifiedBefore),
      properties: smartViewNormalizePropertyFilters(source),
      propertiesMatch: smartViewCleanText(source.propertiesMatch).toLowerCase() === 'any' ? 'any' : 'all',
      workflowStatuses: smartViewCleanList(source.workflowStatuses || source.workflowStatus)
        .map(smartViewWorkflowKey)
        .filter(Boolean),
      linkedNotes: smartViewCleanList(source.linkedNotes || source.linkedNote),
      actionStatuses: smartViewCleanList(source.actionStatuses || source.actionStatus || source.taskStatus)
        .map(smartViewNormalizeActionStatus)
        .filter(Boolean),
      actionTypes: smartViewCleanList(source.actionTypes || source.actionType)
        .map(smartViewNormalizeActionType)
        .filter(Boolean),
      reminderFrom: smartViewDateKey(source.reminderFrom || source.remindFrom || source.dueFrom),
      reminderTo: smartViewDateKey(source.reminderTo || source.remindTo || source.dueTo),
    };
  }
  
  function smartViewNormalizeSort(sort = {}) {
    const field = SMART_VIEW_SORT_FIELDS.includes(sort?.field) ? sort.field : 'modified';
    return {
      field,
      direction: sort?.direction === 'asc' ? 'asc' : 'desc',
    };
  }
  
  function smartViewNormalizeLimit(value = 100) {
    const parsed = Number(value == null || value === '' ? 100 : value);
    if (!Number.isFinite(parsed)) return 100;
    return Math.max(1, Math.min(500, Math.floor(parsed)));
  }
  
  function smartViewNormalizeLayout(value = 'list') {
    const clean = smartViewCleanText(value).toLowerCase();
    return SMART_VIEW_LAYOUTS.includes(clean) ? clean : 'list';
  }

  // group.by is any property key found on notes, the literal 'tag', or a date
  // field. Null means "do not group" — the only way to say it.
  function smartViewNormalizeGroup(group = null) {
    if (!group || typeof group !== 'object') return null;
    const by = smartViewCleanText(group.by);
    if (!by) return null;
    return {
      by,
      direction: smartViewCleanText(group.direction).toLowerCase() === 'desc' ? 'desc' : 'asc',
    };
  }

  // Columns are discovered from the notes, never declared in a schema file, so
  // this only cleans what the caller chose to pin.
  function smartViewNormalizeColumns(columns = null) {
    if (!Array.isArray(columns)) return null;
    const clean = columns.map(item => smartViewCleanText(item)).filter(Boolean);
    return clean.length ? [...new Set(clean)] : null;
  }

  function smartViewNormalizeDefinition(definition = {}) {
    const source = definition && typeof definition === 'object' ? definition : {};
    return {
      id: smartViewCleanText(source.id),
      title: smartViewCleanText(source.title) || 'Smart view',
      type: smartViewNormalizeType(source.type || 'notes'),
      filters: smartViewNormalizeFilters(source.filters || source.query || {}),
      sort: smartViewNormalizeSort(source.sort || {}),
      limit: smartViewNormalizeLimit(source.limit),
      // v2 keys. A v1 definition reads back as list / ungrouped / no columns.
      layout: smartViewNormalizeLayout(source.layout),
      group: smartViewNormalizeGroup(source.group),
      columns: smartViewNormalizeColumns(source.columns),
    };
  }
  
  function smartViewBodyHasProperty(body = '', key = '') {
    if (!key) return false;
    return bodyPropertyLineRe(key).test(String(body || ''));
  }
  
  // Ordering compares numerically when both sides are numbers and lexically
  // otherwise, which is what ISO dates want: 2026-08-02 < 2026-08-10 as text.
  function smartViewCompareProperty(actual, expected) {
    const left = Number(actual);
    const right = Number(expected);
    if (Number.isFinite(left) && Number.isFinite(right)) return left - right;
    return String(actual).localeCompare(String(expected));
  }

  function smartViewMatchesPropertyFilter(note, filter) {
    const body = note?.body || '';
    const present = smartViewBodyHasProperty(body, filter.key);
    const actual = present ? bodyPropertyValue(body, filter.key) : '';
    const op = filter.op || 'is';

    // Asking whether something is missing must not first require it to exist.
    if (op === 'empty') return !present || !actual;
    if (op === 'filled') return present && Boolean(actual);
    if (!present) return false;
    if (!filter.values.length) return true;

    const lower = String(actual).toLowerCase();
    switch (op) {
      case 'not': return !filter.values.some(value => value.toLowerCase() === lower);
      case 'has': return filter.values.some(value => lower.includes(value.toLowerCase()));
      case 'lt': return filter.values.some(value => smartViewCompareProperty(actual, value) < 0);
      case 'gt': return filter.values.some(value => smartViewCompareProperty(actual, value) > 0);
      default: return filter.values.some(value => value.toLowerCase() === lower);
    }
  }

  function smartViewMatchesProperties(note, propertyFilters = [], match = 'all') {
    const list = propertyFilters || [];
    if (!list.length) return true;
    return match === 'any'
      ? list.some(filter => smartViewMatchesPropertyFilter(note, filter))
      : list.every(filter => smartViewMatchesPropertyFilter(note, filter));
  }
  
  function smartViewNoteWorkflowStatus(note, options = {}) {
    const raw = bodyPropertyValue(note?.body || '', 'status');
    const states = options.workflowStates || options.states || [];
    return normalizeWorkflowStatus(raw, states, options.normalizeId) || smartViewWorkflowKey(raw);
  }
  
  function smartViewNoteLookup(options = {}) {
    const out = new Map();
    const add = (note) => {
      if (!note) return;
      const id = smartViewCleanText(note.id);
      const titleKey = novelTitleKey(note.title || '');
      if (id) out.set(id, note);
      if (titleKey) out.set(titleKey, note);
    };
    const explicit = options.notesById;
    if (explicit instanceof Map) {
      explicit.forEach(note => add(note));
    } else if (explicit && typeof explicit === 'object') {
      Object.values(explicit).forEach(note => add(note));
    }
    (options.allNotes || options.notes || []).forEach(add);
    return out;
  }
  
  function smartViewLinkedTargetKeys(target = '', options = {}) {
    const out = new Set();
    const clean = smartViewCleanText(target);
    const directKey = novelTitleKey(clean);
    if (directKey) out.add(directKey);
    const lookup = options.smartViewNoteLookup || smartViewNoteLookup(options);
    const linkedNote = lookup.get(clean) || lookup.get(directKey);
    if (linkedNote) {
      const titleKey = novelTitleKey(linkedNote.title || '');
      if (titleKey) out.add(titleKey);
    }
    return out;
  }
  
  function smartViewMatchesLinkedNotes(note, linkedNotes = [], options = {}) {
    if (!linkedNotes.length) return true;
    const noteLinks = new Set(novelWikiTitles(note?.body || '').map(novelTitleKey).filter(Boolean));
    return linkedNotes.every(target => {
      const targetKeys = smartViewLinkedTargetKeys(target, options);
      return [...targetKeys].some(key => noteLinks.has(key));
    });
  }
  
  function smartViewNoteDateInRange(note, field, from = '', to = '') {
    if (!from && !to) return true;
    const source = field === 'modified' ? (note?.modifiedAt || note?.date) : note?.date;
    const key = rollupDateKey(source);
    if (!key) return false;
    if (from && key < from) return false;
    if (to && key > to) return false;
    return true;
  }
  
  function smartViewMatchesNormalizedNote(note, definition = {}, options = {}) {
    const filters = definition.filters || {};
    if (!note) return false;
    if (filters.titleContains && !String(note.title || '').toLowerCase().includes(filters.titleContains.toLowerCase())) return false;
  
    if (filters.tags.length) {
      const noteTags = new Set((note.tags || []).map(normalizeTagName).filter(Boolean));
      if (!filters.tags.every(tag => noteTags.has(tag))) return false;
    }
  
    if (!smartViewNoteDateInRange(note, 'created', filters.createdFrom, filters.createdTo)) return false;
    if (!smartViewNoteDateInRange(note, 'modified', filters.modifiedFrom, filters.modifiedTo)) return false;
    if (!smartViewMatchesProperties(note, filters.properties, filters.propertiesMatch)) return false;
  
    if (filters.workflowStatuses.length) {
      const workflow = smartViewNoteWorkflowStatus(note, options);
      if (!filters.workflowStatuses.includes(workflow)) return false;
    }
  
    return smartViewMatchesLinkedNotes(note, filters.linkedNotes, options);
  }
  
  function smartViewMatchesNote(note, definition = {}, options = {}) {
    return smartViewMatchesNormalizedNote(note, smartViewNormalizeDefinition(definition), options);
  }
  
  function smartViewSortValue(note, field = 'modified') {
    if (field === 'title') return String(note?.title || '').toLowerCase();
    const source = field === 'created' ? note?.date : (note?.modifiedAt || note?.date);
    const time = new Date(source || 0).getTime();
    return Number.isNaN(time) ? 0 : time;
  }
  
  function smartViewCompareNotes(a, b, sort = {}, ai = 0, bi = 0) {
    const av = smartViewSortValue(a, sort.field);
    const bv = smartViewSortValue(b, sort.field);
    const primary = typeof av === 'string'
      ? av.localeCompare(String(bv || ''), undefined, { sensitivity: 'base' })
      : av - bv;
    const ordered = sort.direction === 'desc' ? -primary : primary;
    if (ordered) return ordered;
    const byTitle = String(a?.title || '').localeCompare(String(b?.title || ''), undefined, { sensitivity: 'base' });
    if (byTitle) return byTitle;
    const byId = String(a?.id || '').localeCompare(String(b?.id || ''));
    return byId || ai - bi;
  }
  
  function smartViewNoteResult(note) {
    return {
      type: 'note',
      id: note?.id || '',
      noteId: note?.id || '',
      title: note?.title || 'Untitled',
      note,
      tags: Array.isArray(note?.tags) ? [...note.tags] : [],
      createdAt: note?.date || '',
      modifiedAt: note?.modifiedAt || note?.date || '',
      createdDate: rollupDateKey(note?.date),
      modifiedDate: rollupDateKey(note?.modifiedAt || note?.date),
    };
  }
  
  function smartViewQueryNotes(notes = [], definition = {}, options = {}) {
    const normalized = smartViewNormalizeDefinition(definition);
    const matchOptions = {
      ...options,
      allNotes: options.allNotes || notes || [],
      smartViewNoteLookup: smartViewNoteLookup({ ...options, allNotes: options.allNotes || notes || [] }),
    };
    return (notes || [])
      .map((note, index) => ({ note, index }))
      .filter(item => smartViewMatchesNormalizedNote(item.note, normalized, matchOptions))
      .sort((a, b) => smartViewCompareNotes(a.note, b.note, normalized.sort, a.index, b.index))
      .slice(0, normalized.limit)
      .map(item => smartViewNoteResult(item.note));
  }
  
  const smartViewDefaultReminderParser = {
    parse(text) {
      const match = String(text || '').match(/@remind\s+(\d{4}-\d{2}-\d{2})(?:\s+(\d{2}:\d{2}))?/);
      if (!match) return null;
      const date = match[1];
      const time = match[2] || '';
      const at = new Date(`${date}T${time || '00:00'}:00`);
      if (Number.isNaN(at.getTime())) return null;
      return { date, time, at, raw: match[0], index: match.index || 0 };
    },
    strip(text) {
      return String(text || '').replace(/@remind\s+\d{4}-\d{2}-\d{2}(?:\s+\d{2}:\d{2})?/g, '').trim();
    },
  };
  
  function smartViewActionStatus(item = {}, now = new Date()) {
    if (item.isReminderOnly || item.type === 'reminder') return 'reminder';
    if (item.checked) return 'completed';
    if (agendaIsDeferred(item, now)) return 'deferred';
    return 'open';
  }
  
  function smartViewActionResult(item = {}, note = null, options = {}) {
    const type = item.isReminderOnly || item.type === 'reminder' ? 'reminder' : 'task';
    const status = smartViewActionStatus(item, options.now || new Date());
    const label = item.label || agendaCleanActionText(item.text || '') || 'Untitled action';
    return {
      type,
      id: item.key || taskItemKey(item),
      key: item.key || taskItemKey(item),
      noteId: item.noteId || '',
      noteTitle: item.noteTitle || note?.title || 'Untitled',
      sourceNoteTitle: item.noteTitle || note?.title || 'Untitled',
      noteTags: Array.isArray(item.noteTags) ? [...item.noteTags] : [],
      label,
      title: label,
      text: item.text || '',
      checked: !!item.checked,
      completed: status === 'completed',
      deferred: status === 'deferred',
      status,
      remindAt: item.remindAt || null,
      reminderDate: item.remindAt?.date || '',
      deferUntil: item.deferUntil || '',
      noteDate: item.noteDate || note?.date || '',
      noteModifiedAt: note?.modifiedAt || note?.date || '',
      source: {
        noteId: item.noteId || '',
        noteTitle: item.noteTitle || note?.title || 'Untitled',
        blockId: item.blockId || '',
        line: item.line ?? null,
        key: item.key || taskItemKey(item),
        text: item.text || '',
      },
      sourceNote: note || null,
    };
  }
  
  function smartViewMatchesActionFilters(result = {}, definition = {}) {
    const filters = definition.filters || {};
    if (definition.type === 'tasks' && result.type !== 'task') return false;
    if (definition.type === 'reminders' && result.type !== 'reminder') return false;
    if (filters.actionTypes.length && !filters.actionTypes.includes(result.type)) return false;
    if (filters.actionStatuses.length && !filters.actionStatuses.includes(result.status)) return false;
    if ((filters.reminderFrom || filters.reminderTo) && !smartViewDateInRange(result.reminderDate, filters.reminderFrom, filters.reminderTo)) return false;
    return true;
  }
  
  function smartViewDateInRange(key = '', from = '', to = '') {
    if (!from && !to) return true;
    if (!rollupIsValidIsoDateKey(key)) return false;
    if (from && key < from) return false;
    if (to && key > to) return false;
    return true;
  }
  
  function smartViewActionSortValue(result = {}, field = 'modified') {
    if (field === 'title') return String(result.label || result.title || '').toLowerCase();
    if (field === 'reminder') {
      const time = result.remindAt?.at ? new Date(result.remindAt.at).getTime() : new Date(`${result.reminderDate || '1970-01-01'}T00:00:00`).getTime();
      return Number.isNaN(time) ? 0 : time;
    }
    const source = field === 'created' ? result.noteDate : result.noteModifiedAt;
    const time = new Date(source || 0).getTime();
    return Number.isNaN(time) ? 0 : time;
  }
  
  function smartViewCompareActionResults(a, b, sort = {}) {
    const av = smartViewActionSortValue(a, sort.field);
    const bv = smartViewActionSortValue(b, sort.field);
    const primary = typeof av === 'string'
      ? av.localeCompare(String(bv || ''), undefined, { sensitivity: 'base' })
      : av - bv;
    const ordered = sort.direction === 'desc' ? -primary : primary;
    if (ordered) return ordered;
    const byNote = String(a.noteTitle || '').localeCompare(String(b.noteTitle || ''), undefined, { sensitivity: 'base' });
    if (byNote) return byNote;
    return String(a.key || '').localeCompare(String(b.key || ''));
  }
  
  function smartViewQueryActions(notes = [], definition = {}, options = {}) {
    const normalized = smartViewNormalizeDefinition(definition);
    const parser = options.parser || options.reminderParser || smartViewDefaultReminderParser;
    const noteLookup = new Map((notes || []).map(note => [note.id, note]));
    const matchOptions = {
      ...options,
      allNotes: options.allNotes || notes || [],
      smartViewNoteLookup: smartViewNoteLookup({ ...options, allNotes: options.allNotes || notes || [] }),
    };
    const matchingNotes = (notes || []).filter(note => smartViewMatchesNormalizedNote(note, normalized, matchOptions));
    const seen = new Set();
    return collectTaskItems(matchingNotes, parser, options.walk)
      .map(item => smartViewActionResult(item, noteLookup.get(item.noteId), options))
      .filter(result => {
        const sourceSlot = result.source.blockId || (result.source.line ?? '');
        const key = `${result.type}|${result.source.noteId}|${sourceSlot}|${result.label}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return smartViewMatchesActionFilters(result, normalized);
      })
      .sort((a, b) => smartViewCompareActionResults(a, b, normalized.sort))
      .slice(0, normalized.limit);
  }
  
  function smartViewQuery(notes = [], definition = {}, options = {}) {
    const normalized = smartViewNormalizeDefinition(definition);
    if (normalized.type === 'notes') return smartViewQueryNotes(notes, normalized, options);
    return smartViewQueryActions(notes, normalized, options);
  }
  
  // Grouping is a pure post-pass over smartViewQuery results — same query, one
  // more arrangement of it. Notes lacking the key land in a terminal "No <key>"
  // group that is never hidden: it is how you find unfiled work.
  function smartViewGroup(results = [], group = null, options = {}) {
    const normalized = smartViewNormalizeGroup(group);
    if (!normalized) return [{ key: '', label: '', items: [...results] }];
    const by = normalized.by;
    const readKey = (result) => {
      // A note result carries its note on `.note`; an action result carries
      // the note it came from on `.sourceNote`. Without the second, grouping
      // tasks or reminders by any body property read an empty body and put
      // every row in the unfiled bucket.
      const note = result?.note || result?.sourceNote || result || {};
      if (by === 'tag') {
        // Action results expose the note's tags as noteTags, not tags.
        const source = Array.isArray(note.tags) && note.tags.length ? note.tags
          : Array.isArray(result?.tags) && result.tags.length ? result.tags
          : Array.isArray(result?.noteTags) ? result.noteTags : [];
        const tags = source.filter(Boolean);
        return tags.length ? tags : [''];
      }
      if (typeof options.valueFor === 'function') return [options.valueFor(note, by) ?? ''];
      return [smartViewCleanText(bodyPropertyValue(note.body || '', by))];
    };
    const buckets = new Map();
    results.forEach(result => {
      readKey(result).forEach(value => {
        const key = smartViewCleanText(value);
        if (!buckets.has(key)) buckets.set(key, []);
        buckets.get(key).push(result);
      });
    });
    const unfiledLabel = `No ${by}`;
    const named = [...buckets.entries()].filter(([key]) => key !== '');
    named.sort((a, b) => (normalized.direction === 'desc'
      ? b[0].localeCompare(a[0])
      : a[0].localeCompare(b[0])));
    const out = named.map(([key, items]) => ({ key, label: key, items }));
    // The unfiled bucket always exists and always sits last.
    out.push({ key: '', label: unfiledLabel, items: buckets.get('') || [] });
    return out;
  }

  function smartViewIsPlainObject(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
  }
  
  function smartViewAssertAllowedKeys(value = {}, allowed = [], label = 'Smart View object') {
    Object.keys(value || {}).forEach(key => {
      if (!allowed.includes(key)) throw new Error(`${label} contains unsupported key: ${key}`);
    });
  }
  
  function smartViewValidateDateFilters(filters = {}) {
    [
      'createdFrom',
      'createdTo',
      'createdAfter',
      'createdBefore',
      'modifiedFrom',
      'modifiedTo',
      'modifiedAfter',
      'modifiedBefore',
      'reminderFrom',
      'reminderTo',
      'remindFrom',
      'remindTo',
      'dueFrom',
      'dueTo',
    ].forEach(key => {
      if (filters[key] == null || filters[key] === '') return;
      if (!smartViewDateKey(filters[key])) throw new Error(`Invalid Smart View date filter: ${key}`);
    });
  }
  
  function smartViewValidateActionFilters(filters = {}) {
    smartViewCleanList(filters.actionStatuses || filters.actionStatus || filters.taskStatus).forEach(status => {
      if (!smartViewNormalizeActionStatus(status)) throw new Error('Invalid Smart View action status');
    });
    smartViewCleanList(filters.actionTypes || filters.actionType).forEach(type => {
      if (!smartViewNormalizeActionType(type)) throw new Error('Invalid Smart View action type');
    });
  }
  
  function smartViewValidateSavedDefinition(definition = {}) {
    if (!smartViewIsPlainObject(definition)) throw new Error('Smart View definition must be an object');
    smartViewAssertAllowedKeys(definition, ['format', 'id', 'title', 'type', 'filters', 'sort', 'limit', 'layout', 'group', 'columns'], 'Smart View definition');
    // Accept every format we have ever written, not just the one we write now,
    // so a view saved before v2 still opens.
    if (definition.format && !SMART_VIEW_FORMATS.includes(definition.format)) throw new Error('Unsupported Smart View format');
    if (definition.layout != null && !SMART_VIEW_LAYOUTS.includes(definition.layout)) throw new Error('Invalid Smart View layout');
    if (definition.group != null) {
      if (!smartViewIsPlainObject(definition.group)) throw new Error('Smart View group must be an object');
      smartViewAssertAllowedKeys(definition.group, ['by', 'direction'], 'Smart View group');
      if (!smartViewCleanText(definition.group.by)) throw new Error('Smart View group needs a by key');
    }
    if (definition.columns != null && !Array.isArray(definition.columns)) throw new Error('Smart View columns must be an array');
    const id = smartViewCleanText(definition.id);
    if (!/^[A-Za-z][A-Za-z0-9_-]{1,63}$/.test(id)) throw new Error('Invalid Smart View id');
    const title = smartViewCleanText(definition.title);
    if (!title) throw new Error('Smart View title is required');
    if (definition.type && !SMART_VIEW_TYPES.includes(definition.type)) throw new Error('Invalid Smart View type');
    const filters = definition.filters == null ? {} : definition.filters;
    if (!smartViewIsPlainObject(filters)) throw new Error('Smart View filters must be an object');
    smartViewAssertAllowedKeys(filters, [
      'title',
      'titleContains',
      'tag',
      'tags',
      'createdFrom',
      'createdTo',
      'createdAfter',
      'createdBefore',
      'modifiedFrom',
      'modifiedTo',
      'modifiedAfter',
      'modifiedBefore',
      'property',
      'properties',
      'propertiesMatch',
      'propertyKey',
      'propertyValue',
      'workflowStatus',
      'workflowStatuses',
      'linkedNote',
      'linkedNotes',
      'actionStatus',
      'actionStatuses',
      'taskStatus',
      'actionType',
      'actionTypes',
      'reminderFrom',
      'reminderTo',
      'remindFrom',
      'remindTo',
      'dueFrom',
      'dueTo',
    ], 'Smart View filters');
    smartViewValidateDateFilters(filters);
    smartViewValidateActionFilters(filters);
  
    const sort = definition.sort == null ? {} : definition.sort;
    if (!smartViewIsPlainObject(sort)) throw new Error('Smart View sort must be an object');
    smartViewAssertAllowedKeys(sort, ['field', 'direction'], 'Smart View sort');
    if (sort.field && !SMART_VIEW_SORT_FIELDS.includes(sort.field)) throw new Error('Invalid Smart View sort field');
    if (sort.direction && !['asc', 'desc'].includes(sort.direction)) throw new Error('Invalid Smart View sort direction');
    if (definition.limit != null && (!Number.isFinite(Number(definition.limit)) || Number(definition.limit) < 1 || Number(definition.limit) > 500)) throw new Error('Invalid Smart View limit');
  
    return {
      format: SMART_VIEW_FORMAT,
      ...smartViewNormalizeDefinition({
        id, title, type: definition.type || 'notes', filters, sort, limit: definition.limit,
        layout: definition.layout, group: definition.group, columns: definition.columns,
      }),
    };
  }
  
  function smartViewYamlScalar(value) {
    if (Array.isArray(value) || smartViewIsPlainObject(value)) return JSON.stringify(value);
    const text = String(value ?? '');
    if (!text || /[:#\n\r]/.test(text) || /^\s|\s$/.test(text)) return JSON.stringify(text);
    return text;
  }
  
  function smartViewParseYamlScalar(value) {
    const text = String(value || '').trim();
    if (!text) return '';
    if ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith('[') && text.endsWith(']')) || (text.startsWith('{') && text.endsWith('}'))) {
      return JSON.parse(text);
    }
    if (text.startsWith("'") && text.endsWith("'")) return text.slice(1, -1).replace(/''/g, "'");
    return text;
  }
  
  function smartViewParseDefinitionYaml(text = '') {
    const root = {};
    let activeMapKey = null;
    for (const rawLine of String(text || '').split(/\r?\n/)) {
      if (!rawLine.trim() || rawLine.trimStart().startsWith('#')) continue;
      if (/^\t/.test(rawLine)) throw new Error('Smart View YAML cannot use tabs for indentation');
      const indent = rawLine.match(/^ */)[0].length;
      const line = rawLine.trim();
      const match = line.match(/^([A-Za-z][A-Za-z0-9_-]*):(?:\s*(.*))?$/);
      if (!match) throw new Error(`Unsupported Smart View YAML line: ${line.slice(0, 80)}`);
      const key = match[1];
      const value = match[2] || '';
      if (indent === 0) {
        if (value === '') {
          root[key] = {};
          activeMapKey = key;
        } else {
          root[key] = smartViewParseYamlScalar(value);
          activeMapKey = null;
        }
        continue;
      }
      if (indent < 2 || !activeMapKey || !smartViewIsPlainObject(root[activeMapKey])) {
        throw new Error(`Unsupported Smart View YAML indentation near ${key}`);
      }
      root[activeMapKey][key] = smartViewParseYamlScalar(value);
    }
    return root;
  }
  
  function smartViewSerializeDefinition(definition = {}, options = {}) {
    const format = typeof options === 'string' ? options : options.format || 'json';
    const saved = smartViewValidateSavedDefinition(definition);
    if (format === 'yaml' || format === 'yml') {
      const lines = [
        `format: ${smartViewYamlScalar(saved.format)}`,
        `id: ${smartViewYamlScalar(saved.id)}`,
        `title: ${smartViewYamlScalar(saved.title)}`,
        `type: ${smartViewYamlScalar(saved.type)}`,
        'filters:',
      ];
      Object.entries(saved.filters).forEach(([key, value]) => {
        if (value === '' || (Array.isArray(value) && !value.length)) return;
        lines.push(`  ${key}: ${smartViewYamlScalar(value)}`);
      });
      lines.push('sort:');
      lines.push(`  field: ${smartViewYamlScalar(saved.sort.field)}`);
      lines.push(`  direction: ${smartViewYamlScalar(saved.sort.direction)}`);
      lines.push(`limit: ${saved.limit}`);
      lines.push(`layout: ${smartViewYamlScalar(saved.layout)}`);
      if (saved.group) {
        // group is a nested map, which the two-level parser already handles.
        lines.push('group:');
        lines.push(`  by: ${smartViewYamlScalar(saved.group.by)}`);
        lines.push(`  direction: ${smartViewYamlScalar(saved.group.direction)}`);
      }
      // columns goes through the scalar writer, which JSON-stringifies arrays.
      if (saved.columns) lines.push(`columns: ${smartViewYamlScalar(saved.columns)}`);
      return `${lines.join('\n')}\n`;
    }
    return JSON.stringify(saved, null, 2);
  }
  
  function smartViewParseDefinitionText(text = '', fileName = 'smart-view.json') {
    const clean = String(text || '').trim();
    const name = String(fileName || '').toLowerCase();
    const raw = name.endsWith('.yaml') || name.endsWith('.yml') || (!clean.startsWith('{') && !clean.startsWith('['))
      ? smartViewParseDefinitionYaml(clean)
      : JSON.parse(clean);
    return smartViewValidateSavedDefinition(raw);
  }
  
  function smartViewParseEmbedBlock(text = '', savedViews = []) {
    const raw = String(text || '');
    const match = raw.trim().match(/^\{\{\s*smart-view(?:\s+([\s\S]*?))?\s*\}\}$/i);
    if (!match) return null;
    const body = String(match[1] || '').trim();
    const base = { raw, marker: 'smart-view' };
    if (!body) return { ...base, ok: false, error: 'Missing Smart View definition.' };
  
    const saved = (Array.isArray(savedViews) ? savedViews : [])
      .map(definition => {
        try { return smartViewValidateSavedDefinition(definition); } catch { return null; }
      })
      .filter(Boolean)
      .find(definition => definition.id === body || definition.title.toLowerCase() === body.toLowerCase());
    if (saved) {
      return { ...base, ok: true, mode: 'saved', id: saved.id, definition: saved };
    }
  
    if (/^[A-Za-z][A-Za-z0-9_-]{1,63}$/.test(body)) {
      return { ...base, ok: false, mode: 'saved', id: body, error: `Unknown saved Smart View: ${body}` };
    }
  
    try {
      const definition = smartViewParseDefinitionText(body, body.startsWith('{') ? 'smart-view-embed.json' : 'smart-view-embed.yaml');
      return { ...base, ok: true, mode: 'inline', id: definition.id, definition };
    } catch (error) {
      return { ...base, ok: false, mode: 'inline', error: error?.message || 'Invalid Smart View embed.' };
    }
  }
  
  function smartViewUpsertSavedDefinition(savedViews = [], definition = {}) {
    const saved = smartViewValidateSavedDefinition(definition);
    const current = Array.isArray(savedViews) ? savedViews : [];
    return [
      ...current.filter(item => item?.id !== saved.id),
      saved,
    ];
  }
  return { smartViewCleanText, smartViewCleanList, smartViewDateKey, smartViewWorkflowKey, smartViewNormalizeType, smartViewNormalizeActionStatus, smartViewNormalizeActionType, smartViewNormalizePropertyFilters, smartViewNormalizeFilters, smartViewNormalizeSort, smartViewNormalizeLimit, smartViewNormalizeDefinition, smartViewBodyHasProperty, smartViewMatchesProperties, smartViewNoteWorkflowStatus, smartViewNoteLookup, smartViewLinkedTargetKeys, smartViewMatchesLinkedNotes, smartViewNoteDateInRange, smartViewMatchesNormalizedNote, smartViewMatchesNote, smartViewSortValue, smartViewCompareNotes, smartViewNoteResult, smartViewQueryNotes, smartViewDefaultReminderParser, smartViewActionStatus, smartViewActionResult, smartViewMatchesActionFilters, smartViewDateInRange, smartViewActionSortValue, smartViewCompareActionResults, smartViewQueryActions, smartViewQuery, smartViewGroup, smartViewNormalizeLayout, smartViewNormalizeGroup, smartViewNormalizeColumns, smartViewIsPlainObject, smartViewAssertAllowedKeys, smartViewValidateDateFilters, smartViewValidateActionFilters, smartViewValidateSavedDefinition, smartViewYamlScalar, smartViewParseYamlScalar, smartViewParseDefinitionYaml, smartViewSerializeDefinition, smartViewParseDefinitionText, smartViewParseEmbedBlock, smartViewUpsertSavedDefinition };
}

module.exports = { createSmartViewHelpers };
