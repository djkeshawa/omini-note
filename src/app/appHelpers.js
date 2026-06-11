(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.MN_APP_HELPERS = api;
})(typeof globalThis !== 'undefined' ? globalThis : window, function () {
  const NOTE_TEMPLATES = [
    { id: 'daily', title: 'Daily Note', noteTitle: '{date}', tags: ['daily'], body: '# {date}\n\n## Focus\n- \n\n## Notes\n- \n\n## Tasks\n- [ ] \n' },
    { id: 'meeting', title: 'Meeting Note', noteTitle: 'Meeting - {date}', tags: ['meeting'], body: '# Meeting - {date}\n\nAttendees:: \n\n## Agenda\n- \n\n## Notes\n- \n\n## Decisions\n- \n\n## Actions\n- [ ] \n' },
    { id: 'project', title: 'Project Plan', noteTitle: 'Project plan', tags: ['project'], body: '# Project plan\n\nstatus:: TODO\n\n## Outcome\n\n## Milestones\n- \n\n## Next Actions\n- [ ] \n' },
    { id: 'reading', title: 'Reading Note', noteTitle: 'Reading note', tags: ['reading'], body: '# Reading note\n\nAuthor:: \nSource:: \n\n## Summary\n\n## Highlights\n- \n\n## Follow-up\n- [ ] \n' },
    { id: 'novel-scene', title: 'Novel Scene', noteTitle: 'Scene', tags: ['novel-scene'], body: 'status:: DRAFT\npov:: \nsetting:: \npurpose:: \n\n::: plot-points\n- Opening beat\n:::\n\nDraft the scene here.\n' },
  ];
  const CAPTURE_DESTINATIONS = [
    { id: 'today', label: "Today's daily note", action: 'append-or-create', noteTitle: '{date}', tags: ['daily'], description: 'Append to today, or create the daily note.' },
    { id: 'inbox', label: 'Inbox note', action: 'append-or-create', noteTitle: 'Inbox', tags: ['inbox'], description: 'Collect unprocessed notes in Inbox.' },
    { id: 'current', label: 'Current note', action: 'append', requiresCurrent: true, fallbackDestinationId: 'new', description: 'Append to the selected note.' },
    { id: 'new', label: 'New note', action: 'create', noteTitle: '{templateTitle}', tags: [], description: 'Create a new note from the selected template.' },
  ];
  const CAPTURE_TEMPLATES = [
    {
      id: 'meeting',
      title: 'Meeting',
      noteTitle: 'Meeting - {date}',
      tags: ['meeting'],
      body: '# Meeting - {date}\n\ntype:: meeting\ndate:: {date}\n\n## Notes\n{text}\n\n## Decisions\n- \n\n## Actions\n- [ ] \n',
    },
    {
      id: 'research',
      title: 'Research note',
      noteTitle: 'Research - {date}',
      tags: ['research'],
      body: '# Research - {date}\n\ntype:: research\ndate:: {date}\n\n## Question\n{text}\n\n## Notes\n- \n\n## Follow-up\n- [ ] \n',
    },
    {
      id: 'book-paper',
      title: 'Book/Paper',
      noteTitle: 'Source note - {date}',
      tags: ['research', 'source'],
      body: '# Source note - {date}\n\ntype:: source\ndate:: {date}\nauthor:: \nsource:: \n\n## Summary\n{text}\n\n## Highlights\n- \n\n## Reading tasks\n- [ ] Extract key claims\n',
    },
    {
      id: 'daily-reflection',
      title: 'Daily reflection',
      noteTitle: 'Reflection - {date}',
      tags: ['daily', 'reflection'],
      body: '# Reflection - {date}\n\ntype:: reflection\ndate:: {date}\n\n## Reflection\n{text}\n\n## Learnings\n- \n\n## Tomorrow\n- [ ] \n',
    },
    {
      id: 'task',
      title: 'Task',
      noteTitle: 'Task - {date}',
      tags: ['task'],
      body: '# Task - {date}\n\ntype:: task\ndate:: {date}\n\n- [ ] {text}\n',
    },
  ];
  const SMART_VIEW_FORMAT = 'vispnote.smartView.v1';
  const SMART_VIEW_TYPES = ['notes', 'tasks', 'reminders', 'actions'];
  const SMART_VIEW_SORT_FIELDS = ['title', 'created', 'modified', 'reminder'];
  const CONTEXTUAL_AI_SECTION_KINDS = ['fact', 'suggestion', 'preview'];
  const ZOTERO_ITEM_KEY_RE = /^[A-Za-z0-9_-]{1,80}$/;
  const ZOTERO_SOURCE_TAGS = ['research', 'source', 'zotero'];
  const PHASE5_METRICS_FORMAT = 'vispnote.phase5Metrics.v1';
  const PHASE5_METRIC_KEYS = [
    'capture_saves',
    'zotero_source_notes',
    'theme_installs',
    'onboarding_mode_selections',
  ];
  const PHASE5_METRIC_DETAIL_KEYS = new Set([
    'destinationId',
    'templateId',
    'mode',
    'themeId',
    'onboardingMode',
  ]);
  const CONTEXTUAL_AI_PROVIDER_LABELS = {
    ollama: 'Ollama',
    openai: 'OpenAI',
    openrouter: 'OpenRouter',
    anthropic: 'Anthropic',
    gemini: 'Gemini',
    custom: 'Custom provider',
  };

  function todayIsoDate(now = new Date()) {
    return new Date(now).toISOString().slice(0, 10);
  }

  function captureCleanText(value = '', max = 8000) {
    return String(value || '')
      .replace(/\r\n?/g, '\n')
      .replace(/\u0000/g, '')
      .slice(0, max);
  }

  function captureSlug(value = '', fallback = '') {
    const clean = String(value || '').trim().toLowerCase();
    const slug = clean.replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
    return slug || fallback;
  }

  function captureUniqueTags(...groups) {
    const seen = new Set();
    const out = [];
    groups.flat().forEach(tag => {
      const clean = captureSlug(tag);
      if (!clean || seen.has(clean)) return;
      seen.add(clean);
      out.push(clean);
    });
    return out;
  }

  function captureReplaceTokens(value = '', values = {}) {
    const date = values.date || todayIsoDate(values.now);
    const text = captureCleanText(values.text ?? values.capture ?? '');
    const templateTitle = captureCleanText(values.templateTitle || 'Captured note', 160).trim() || 'Captured note';
    return String(value || '')
      .replaceAll('{date}', date)
      .replaceAll('{text}', text)
      .replaceAll('{templateTitle}', templateTitle);
  }

  function expandTemplate(template, values = {}) {
    const source = template || NOTE_TEMPLATES[0];
    const date = values.date || todayIsoDate(values.now);
    const replaceTokens = (value) => String(value || '').replaceAll('{date}', date);
    return {
      id: source.id,
      title: source.title || 'Untitled',
      noteTitle: replaceTokens(source.noteTitle || source.title || 'Untitled'),
      body: replaceTokens(source.body || ''),
      tags: Array.isArray(source.tags) ? [...source.tags] : [],
    };
  }

  function templateById(templateId) {
    return NOTE_TEMPLATES.find(item => item.id === templateId) || NOTE_TEMPLATES[0];
  }

  function captureTemplateById(templateId) {
    const id = captureSlug(templateId, 'meeting');
    return CAPTURE_TEMPLATES.find(item => item.id === id) || CAPTURE_TEMPLATES[0];
  }

  function captureTemplateChoices() {
    return CAPTURE_TEMPLATES.map(template => ({
      id: template.id,
      title: template.title,
      noteTitle: template.noteTitle,
      tags: [...template.tags],
    }));
  }

  function expandCaptureTemplate(templateId, values = {}) {
    const source = typeof templateId === 'object' ? templateId : captureTemplateById(templateId);
    const date = values.date || todayIsoDate(values.now);
    const text = captureCleanText(values.text ?? values.capture ?? '').trim();
    const templateTitle = captureReplaceTokens(source.noteTitle || source.title || 'Captured note', {
      ...values,
      date,
      text,
      templateTitle: source.title,
    });
    return {
      id: source.id,
      title: source.title || 'Capture',
      noteTitle: captureCleanText(values.noteTitle || templateTitle, 180).trim() || 'Captured note',
      body: captureReplaceTokens(source.body || '', { ...values, date, text, templateTitle }),
      tags: captureUniqueTags(source.tags || []),
    };
  }

  function captureFindInboxNote(notes = []) {
    return (notes || []).find(note => String(note?.title || '').trim().toLowerCase() === 'inbox') || null;
  }

  function captureDestinationChoices(options = {}) {
    const notes = Array.isArray(options.notes) ? options.notes : [];
    const now = options.now || new Date();
    const date = options.date || todayIsoDate(now);
    const currentNote = options.currentNote || options.selectedNote || null;
    const todayNote = rollupFindDailyNote(notes, now);
    const inboxNote = captureFindInboxNote(notes);
    return CAPTURE_DESTINATIONS.map(destination => {
      if (destination.id === 'today') {
        return {
          ...destination,
          noteId: todayNote?.id || null,
          noteTitle: todayNote?.title || date,
          exists: !!todayNote,
          disabled: false,
        };
      }
      if (destination.id === 'inbox') {
        return {
          ...destination,
          noteId: inboxNote?.id || null,
          noteTitle: inboxNote?.title || 'Inbox',
          exists: !!inboxNote,
          disabled: false,
        };
      }
      if (destination.id === 'current') {
        const id = String(currentNote?.id || '');
        return {
          ...destination,
          noteId: id || null,
          noteTitle: currentNote?.title || 'Current note',
          exists: !!id,
          disabled: !id,
          reason: id ? '' : 'No current note selected.',
        };
      }
      return {
        ...destination,
        noteId: null,
        noteTitle: destination.noteTitle,
        exists: false,
        disabled: false,
      };
    });
  }

  function captureDestinationById(destinationId, options = {}) {
    const id = captureSlug(destinationId, 'new');
    return captureDestinationChoices(options).find(destination => destination.id === id)
      || captureDestinationChoices(options).find(destination => destination.id === 'new');
  }

  function captureBuildAppendMarkdown(expandedTemplate = {}) {
    const body = captureCleanText(expandedTemplate.body || '').trim();
    return body ? `${body}\n` : '';
  }

  function captureBuildSavePlan(options = {}) {
    const notes = Array.isArray(options.notes) ? options.notes : [];
    const now = options.now || new Date();
    const requestedDestinationId = captureSlug(options.destinationId, 'new');
    const template = expandCaptureTemplate(options.templateId || 'meeting', options);
    const destinationOptions = { notes, now, currentNote: options.currentNote || options.selectedNote || null };
    let destination = captureDestinationById(requestedDestinationId, destinationOptions);
    const fellBack = !!destination?.disabled && !!destination.fallbackDestinationId;
    if (fellBack) destination = captureDestinationById(destination.fallbackDestinationId, destinationOptions);
    const action = destination.noteId ? 'append' : 'create';
    const destinationTitle = captureReplaceTokens(destination.noteTitle || template.noteTitle, {
      ...options,
      now,
      templateTitle: template.noteTitle,
    }).trim() || template.noteTitle;
    const createTitle = destination.id === 'new' ? template.noteTitle : destinationTitle;
    const destinationTags = destination.id === 'today'
      ? ['daily']
      : destination.id === 'inbox'
        ? ['inbox']
        : [];
    const tags = captureUniqueTags(destinationTags, template.tags);
    const body = captureBuildAppendMarkdown(template);
    return {
      type: 'capture-save-plan',
      requestedDestinationId,
      destinationId: destination.id,
      destinationLabel: destination.label,
      destinationTitle: action === 'append' ? destination.noteTitle : createTitle,
      noteId: destination.noteId || null,
      action,
      mode: action,
      fellBack,
      fallbackReason: fellBack ? destination.reason || 'Requested destination was unavailable.' : '',
      template,
      tags,
      body,
      appendText: action === 'append' ? body : '',
      createNote: action === 'create'
        ? { title: createTitle, tags, body }
        : null,
    };
  }

  function phase5MetricChoices() {
    return PHASE5_METRIC_KEYS.map(id => ({ id }));
  }

  function phase5NormalizeMetricKey(value = '') {
    const key = String(value || '').trim().toLowerCase();
    return PHASE5_METRIC_KEYS.includes(key) ? key : '';
  }

  function phase5CleanMetricDetailValue(value) {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return Number.isFinite(value) ? value : '';
    const text = captureCleanText(value, 120).replace(/\s+/g, '-').replace(/[^a-zA-Z0-9_.:-]+/g, '-').replace(/^-+|-+$/g, '');
    return text.slice(0, 120);
  }

  function phase5SanitizeMetricDetails(details = {}) {
    if (!details || typeof details !== 'object' || Array.isArray(details)) return {};
    const clean = {};
    for (const [key, value] of Object.entries(details)) {
      if (!PHASE5_METRIC_DETAIL_KEYS.has(key)) continue;
      const cleaned = phase5CleanMetricDetailValue(value);
      if (cleaned === '' || cleaned == null) continue;
      clean[key] = cleaned;
    }
    return clean;
  }

  function phase5SanitizeMetrics(metrics = {}) {
    const source = metrics && typeof metrics === 'object' && !Array.isArray(metrics) ? metrics : {};
    const counters = {};
    const rawCounters = source.counters && typeof source.counters === 'object' && !Array.isArray(source.counters)
      ? source.counters
      : {};
    for (const key of PHASE5_METRIC_KEYS) {
      const count = Number(rawCounters[key]);
      if (Number.isFinite(count) && count > 0) counters[key] = Math.min(Math.floor(count), 999999);
    }
    const events = (Array.isArray(source.events) ? source.events : [])
      .map(event => {
        const key = phase5NormalizeMetricKey(event?.key);
        if (!key) return null;
        const eventTime = event?.at ? new Date(event.at) : null;
        const at = eventTime && Number.isFinite(eventTime.getTime()) ? eventTime.toISOString() : '';
        return {
          key,
          at,
          details: phase5SanitizeMetricDetails(event?.details),
        };
      })
      .filter(event => event && event.at)
      .slice(-100);
    return {
      format: PHASE5_METRICS_FORMAT,
      counters,
      events,
      updatedAt: source.updatedAt && Number.isFinite(new Date(source.updatedAt).getTime()) ? new Date(source.updatedAt).toISOString() : null,
    };
  }

  function phase5RecordMetric(metrics = {}, key = '', details = {}, options = {}) {
    const metricKey = phase5NormalizeMetricKey(key);
    if (!metricKey) throw new Error('Unsupported Phase 5 metric key');
    const now = Number.isFinite(new Date(options.now).getTime()) ? new Date(options.now).toISOString() : new Date().toISOString();
    const current = phase5SanitizeMetrics(metrics);
    const counters = { ...current.counters, [metricKey]: (current.counters[metricKey] || 0) + 1 };
    const events = [
      ...current.events,
      { key: metricKey, at: now, details: phase5SanitizeMetricDetails(details) },
    ].slice(-100);
    return {
      format: PHASE5_METRICS_FORMAT,
      counters,
      events,
      updatedAt: now,
    };
  }

  function phase5MetricCount(metrics = {}, key = '') {
    const metricKey = phase5NormalizeMetricKey(key);
    if (!metricKey) return 0;
    return phase5SanitizeMetrics(metrics).counters[metricKey] || 0;
  }

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
    const propertyValue = typeof options.propertyValue === 'function'
      ? options.propertyValue
      : (body, key) => {
        const safeKey = String(key || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const match = String(body || '').match(new RegExp(`^\\s*(?:-\\s*)?${safeKey}::\\s*(.*)$`, 'im'));
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

  function smartViewNormalizePropertyFilters(filters = {}) {
    const out = [];
    const add = (key, value) => {
      const cleanKey = smartViewCleanText(key);
      if (!cleanKey) return;
      const values = smartViewCleanList(value);
      out.push({ key: cleanKey, values });
    };

    if (filters.property && typeof filters.property === 'object' && !Array.isArray(filters.property)) {
      add(filters.property.key, filters.property.value);
    }
    if (Array.isArray(filters.properties)) {
      filters.properties.forEach(item => {
        if (item && typeof item === 'object') add(item.key, item.value);
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

  function smartViewNormalizeDefinition(definition = {}) {
    const source = definition && typeof definition === 'object' ? definition : {};
    return {
      id: smartViewCleanText(source.id),
      title: smartViewCleanText(source.title) || 'Smart view',
      type: smartViewNormalizeType(source.type || 'notes'),
      filters: smartViewNormalizeFilters(source.filters || source.query || {}),
      sort: smartViewNormalizeSort(source.sort || {}),
      limit: smartViewNormalizeLimit(source.limit),
    };
  }

  function smartViewBodyHasProperty(body = '', key = '') {
    if (!key) return false;
    return bodyPropertyLineRe(key).test(String(body || ''));
  }

  function smartViewMatchesProperties(note, propertyFilters = []) {
    return (propertyFilters || []).every(filter => {
      if (!smartViewBodyHasProperty(note?.body || '', filter.key)) return false;
      if (!filter.values.length) return true;
      const actual = bodyPropertyValue(note?.body || '', filter.key).toLowerCase();
      return filter.values.some(value => value.toLowerCase() === actual);
    });
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
    if (!smartViewMatchesProperties(note, filters.properties)) return false;

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
    smartViewAssertAllowedKeys(definition, ['format', 'id', 'title', 'type', 'filters', 'sort', 'limit'], 'Smart View definition');
    if (definition.format && definition.format !== SMART_VIEW_FORMAT) throw new Error('Unsupported Smart View format');
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
      ...smartViewNormalizeDefinition({ id, title, type: definition.type || 'notes', filters, sort, limit: definition.limit }),
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

  function rollupIsOlderGroup(dateKey, now = new Date()) {
    const yesterday = rollupDateRangeBounds('yesterday', now).start;
    return rollupIsValidIsoDateKey(dateKey) && dateKey < yesterday;
  }

  function rollupGroupNotes(notes = [], options = {}) {
    const range = rollupNormalizeRange(options.range);
    const groupBy = rollupNormalizeGroupBy(options.groupBy);
    const now = options.now || new Date();
    const weekStart = options.weekStart || 'monday';
    const groups = new Map();
    (notes || []).forEach(note => {
      const key = rollupNoteDateKey(note, groupBy);
      if (!rollupDateKeyInRange(key, range, now, weekStart)) return;
      if (!groups.has(key)) {
        groups.set(key, { key, date: new Date(`${key}T00:00:00.000Z`), notes: [] });
      }
      groups.get(key).notes.push(note);
    });
    return Array.from(groups.values())
      .map(group => ({
        ...group,
        isOlder: rollupIsOlderGroup(group.key, now),
        notes: group.notes.sort((a, b) => rollupNoteSortTime(b, groupBy) - rollupNoteSortTime(a, groupBy)),
      }))
      .sort((a, b) => String(b.key).localeCompare(String(a.key)));
  }

  function rollupPreviewLine(line = '') {
    return String(line || '')
      .replace(/^#{1,6}\s+/, '')
      .replace(/^\s*[-*]\s+\[[ xX]\]\s*/, '')
      .replace(/^\s*[-*]\s+/, '')
      .replace(/\[\[([^\]]+)\]\]/g, '$1')
      .replace(/[`*_>]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function rollupNotePreview(note, maxLines = 2) {
    return String(note?.body || '')
      .split('\n')
      .map(rollupPreviewLine)
      .filter(Boolean)
      .slice(0, Math.max(1, Number(maxLines) || 2))
      .join(' · ');
  }

  function rollupFilterTaskItems(items = [], notes = [], options = {}) {
    const noteById = new Map((notes || []).map(note => [note.id, note]));
    const range = rollupNormalizeRange(options.range);
    const groupBy = rollupNormalizeGroupBy(options.groupBy);
    const now = options.now || new Date();
    const weekStart = options.weekStart || 'monday';
    return (items || [])
      .filter(item => {
        if (agendaIsDeferred(item, now)) return false;
        if (!item || item.checked || item.isReminderOnly || item.type === 'reminder') return false;
        const note = noteById.get(item.noteId) || { date: item.noteDate, title: item.noteTitle };
        const key = rollupNoteDateKey(note, groupBy) || rollupDateKey(item.noteDate);
        return rollupDateKeyInRange(key, range, now, weekStart);
      })
      .sort((a, b) => String(a.noteTitle || '').localeCompare(String(b.noteTitle || '')) || String(a.label || a.text || '').localeCompare(String(b.label || b.text || '')));
  }

  function rollupReminderDateKey(item) {
    return rollupIsValidIsoDateKey(item?.remindAt?.date)
      ? item.remindAt.date
      : rollupDateKey(item?.remindAt?.at);
  }

  function rollupFilterReminderItems(items = [], _notes = [], options = {}) {
    const range = rollupNormalizeRange(options.range);
    const now = options.now || new Date();
    const weekStart = options.weekStart || 'monday';
    const today = rollupDateRangeBounds('today', now, weekStart).today;
    return (items || [])
      .map(item => {
        const key = rollupReminderDateKey(item);
        const status = key < today ? 'overdue' : key === today ? 'due-today' : 'upcoming';
        return { ...item, rollupDateKey: key, rollupStatus: status };
      })
      .filter(item => {
        if (agendaIsDeferred(item, now)) return false;
        if (!rollupIsValidIsoDateKey(item.rollupDateKey)) return false;
        return item.rollupDateKey < today || rollupDateKeyInRange(item.rollupDateKey, range, now, weekStart);
      })
      .sort((a, b) => String(a.rollupDateKey).localeCompare(String(b.rollupDateKey)) || ((a.remindAt?.at || 0) - (b.remindAt?.at || 0)));
  }

  function rollupFindDailyNote(notes = [], now = new Date()) {
    const key = todayIsoDate(now);
    return (notes || []).find(note => String(note?.title || '').trim() === key) || null;
  }

  function rollupTaskReasonLabel(item = {}, note = null, now = new Date()) {
    const today = todayIsoDate(now);
    const noteTitle = String(note?.title || item.noteTitle || '').trim();
    const noteDate = rollupDateKey(note?.date || item.noteDate);
    const noteModified = rollupDateKey(note?.modifiedAt);
    if (noteTitle === today && !item.remindAt) return 'unscheduled daily task';
    if (noteTitle === today) return "from today's daily note";
    if (noteDate === today) return 'captured today';
    if (noteModified === today) return 'modified today';
    if (!note) return 'source note';
    return 'from note';
  }

  function rollupReminderReasonLabel(item = {}) {
    if (item.rollupStatus === 'overdue') return 'overdue';
    if (item.rollupStatus === 'due-today') return 'due today';
    if (item.rollupStatus === 'upcoming') return 'upcoming';
    const key = rollupReminderDateKey(item);
    const today = todayIsoDate();
    if (key && key < today) return 'overdue';
    if (key === today) return 'due today';
    return 'upcoming';
  }

  function agendaActionStatus(item = {}, now = new Date()) {
    if (item.checked) return 'completed';
    if (agendaIsDeferred(item, now)) return 'deferred';
    const key = rollupReminderDateKey(item);
    const today = todayIsoDate(now);
    if (!key) return 'unscheduled';
    if (key < today) return 'overdue';
    if (key === today) return 'today';
    return 'upcoming';
  }

  function agendaActionReasonLabel(item = {}, note = null, now = new Date()) {
    const status = agendaActionStatus(item, now);
    if (status === 'completed') return 'completed';
    if (status === 'unscheduled') return rollupTaskReasonLabel(item, note, now);
    if (status === 'overdue') return 'overdue';
    if (status === 'today') return item.isReminderOnly ? 'due today' : 'scheduled today';
    return 'upcoming';
  }

  function agendaActionDetail(item = {}, notes = [], options = {}) {
    const noteById = new Map((notes || []).map(note => [note.id, note]));
    const note = noteById.get(item.noteId) || null;
    const status = agendaActionStatus(item, options.now || new Date());
    const tags = Array.from(new Set([
      ...((Array.isArray(note?.tags) ? note.tags : [])),
      ...((Array.isArray(item.noteTags) ? item.noteTags : [])),
    ].map(tag => String(tag || '').trim()).filter(Boolean)));
    const scheduledDate = rollupReminderDateKey(item);
    return {
      status,
      reason: agendaActionReasonLabel(item, note, options.now || new Date()),
      sourceNoteId: item.noteId || note?.id || '',
      sourceNoteTitle: note?.title || item.noteTitle || 'Untitled',
      titleDate: note ? rollupTitleDateKey(note) : rollupTitleDateKey({ title: item.noteTitle }),
      createdDate: rollupDateKey(note?.date || item.noteDate),
      modifiedDate: rollupDateKey(note?.modifiedAt || item.noteModifiedAt),
      scheduledDate,
      scheduledTime: item.remindAt?.time || '',
      deferUntil: item.deferUntil || '',
      inheritedTags: tags,
    };
  }

  function agendaDecorateActionItems(items = [], notes = [], options = {}) {
    return (items || []).map(item => {
      const detail = agendaActionDetail(item, notes, options);
      return { ...item, actionStatus: detail.status, actionDetail: detail };
    });
  }

  function agendaFilterActionItems(items = [], notes = [], filters = {}, options = {}) {
    const status = String(filters.status || 'all');
    const tag = String(filters.tag || '').trim();
    const sourceNoteId = String(filters.sourceNoteId || '').trim();
    return agendaDecorateActionItems(items, notes, options).filter(item => {
      const detail = item.actionDetail || {};
      if (detail.status === 'deferred' && status !== 'deferred') return false;
      if (status !== 'all' && detail.status !== status) return false;
      if (tag && !(detail.inheritedTags || []).includes(tag)) return false;
      if (sourceNoteId && detail.sourceNoteId !== sourceNoteId) return false;
      return true;
    });
  }

  function agendaLocalDateKey(date = new Date()) {
    const d = new Date(date);
    if (Number.isNaN(d.getTime())) return '';
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }

  function agendaLocalTimeKey(date = new Date()) {
    const d = new Date(date);
    if (Number.isNaN(d.getTime())) return '';
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }

  function agendaAddDays(date, days) {
    const d = new Date(date);
    d.setDate(d.getDate() + days);
    return d;
  }

  function agendaParseClock(value = '') {
    const match = String(value || '').trim().toLowerCase().match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/);
    if (!match) return '';
    let hour = Number(match[1]);
    const minute = match[2] == null ? 0 : Number(match[2]);
    const suffix = match[3] || '';
    if (!Number.isInteger(hour) || !Number.isInteger(minute) || minute < 0 || minute > 59) return '';
    if (suffix) {
      if (hour < 1 || hour > 12) return '';
      if (suffix === 'pm' && hour !== 12) hour += 12;
      if (suffix === 'am' && hour === 12) hour = 0;
    } else if (hour > 23) return '';
    return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
  }

  function agendaParseScheduleInput(value = '', options = {}) {
    const raw = String(value || '').trim();
    if (!raw) return { ok: false, error: 'Enter a schedule phrase.' };
    const input = raw.toLowerCase().replace(/[,.]+$/g, '').replace(/\s+/g, ' ');
    const now = new Date(options.now || new Date());
    if (Number.isNaN(now.getTime())) return { ok: false, error: 'Invalid reference time.' };
    const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    const make = (date, time = '') => ({ ok: true, date: agendaLocalDateKey(date), time, raw });

    if (input === 'today') return make(now);
    if (input === 'tomorrow') return make(agendaAddDays(now, 1));

    const hours = input.match(/^in\s+(\d{1,2})\s+hours?$/);
    if (hours) {
      const amount = Number(hours[1]);
      if (!Number.isInteger(amount) || amount < 1) return { ok: false, error: 'Use a positive hour count.' };
      const next = new Date(now);
      next.setHours(next.getHours() + amount);
      return make(next, agendaLocalTimeKey(next));
    }

    const dayMatch = input.match(/^(next\s+)?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)(?:\s+(.+))?$/);
    if (dayMatch) {
      const forceNext = !!dayMatch[1];
      const targetDay = dayNames.indexOf(dayMatch[2]);
      let offset = (targetDay - now.getDay() + 7) % 7;
      if (forceNext || offset === 0) offset = offset || 7;
      const date = agendaAddDays(now, offset);
      const time = dayMatch[3] ? agendaParseClock(dayMatch[3]) : '';
      if (dayMatch[3] && !time) return { ok: false, error: 'Use a valid time.' };
      return make(date, time);
    }

    return { ok: false, error: 'Unsupported schedule phrase.' };
  }

  function rollupQuickTaskLine(text = '') {
    const clean = String(text || '').replace(/\s+/g, ' ').trim();
    return clean ? `- [ ] ${clean}` : '';
  }

  function rollupAppendQuickTask(body = '', text = '') {
    const taskLine = rollupQuickTaskLine(text);
    const source = String(body || '');
    if (!taskLine) return source;
    const lines = source.replace(/\r\n/g, '\n').split('\n');
    const headingIndex = lines.findIndex(line => /^#{2,6}\s+Tasks\s*$/i.test(String(line || '').trim()));
    if (headingIndex >= 0) {
      for (let i = headingIndex + 1; i < lines.length; i += 1) {
        if (/^\s*-\s+\[\s\]\s*$/.test(lines[i])) {
          lines[i] = taskLine;
          return `${lines.join('\n').replace(/\s+$/g, '')}\n`;
        }
        if (/^#{1,6}\s+\S/.test(String(lines[i] || '').trim())) break;
      }
      let insertAt = headingIndex + 1;
      while (insertAt < lines.length && !/^#{1,6}\s+\S/.test(String(lines[insertAt] || '').trim())) {
        insertAt += 1;
      }
      if (insertAt > headingIndex + 1 && String(lines[insertAt - 1] || '').trim() === '') insertAt -= 1;
      lines.splice(insertAt, 0, taskLine);
      return `${lines.join('\n').replace(/\s+$/g, '')}\n`;
    }
    const trimmed = source.replace(/\s+$/g, '');
    return `${trimmed}${trimmed ? '\n' : ''}${taskLine}\n`;
  }

  function rollupAppendMarkdownSection(body = '', section = '') {
    const cleanSection = String(section || '').replace(/\s+$/g, '');
    if (!cleanSection) return String(body || '');
    const trimmed = String(body || '').replace(/\s+$/g, '');
    return `${trimmed}${trimmed ? '\n\n' : ''}${cleanSection}\n`;
  }

  function rollupAppendReflection(body = '', options = {}) {
    const date = todayIsoDate(options.now || new Date());
    return rollupAppendMarkdownSection(body, [
      `## Reflection - ${date}`,
      '',
      '- What stood out:',
      '- What I learned:',
      '- What to improve:',
    ].join('\n'));
  }

  function rollupItemLabel(item = {}) {
    return String(item.label || item.text || item.noteTitle || 'Untitled').replace(/\s+/g, ' ').trim();
  }

  function rollupSourceLine(item = {}) {
    const title = String(item.noteTitle || 'Untitled').replace(/\s+/g, ' ').trim();
    const label = rollupItemLabel(item);
    return label ? `- [ ] ${label} (${title})` : `- [ ] ${title}`;
  }

  function rollupNoteLine(note = {}) {
    const title = String(note.title || 'Untitled').replace(/\s+/g, ' ').trim();
    const preview = rollupNotePreview(note, 1);
    return preview ? `- [[${title}]]: ${preview}` : `- [[${title}]]`;
  }

  function rollupDecisionLines(notes = [], now = new Date(), limit = 5) {
    const today = todayIsoDate(now);
    const lines = [];
    (notes || []).forEach(note => {
      const noteTitle = String(note?.title || 'Untitled').replace(/\s+/g, ' ').trim();
      String(note?.body || '').split('\n').forEach(line => {
        const clean = rollupPreviewLine(line);
        if (!clean || !/\bdecision\b/i.test(clean)) return;
        lines.push(`- [[${noteTitle}]]: ${clean}`);
      });
    });
    if (lines.length) return lines.slice(0, limit);
    return [`- Review notes from ${today} for decisions to keep.`];
  }

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

  function contextualAiBuildTodayRecapContext({ notes = [], tasks = [], reminders = [], agendaItems = [], now = new Date(), weekStart = 'monday', limit = 6 } = {}) {
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
    const sourceIds = new Set();
    todayNotes.forEach(note => note?.id && sourceIds.add(note.id));
    [...openTasks, ...dueReminders, ...todayAgenda].forEach(item => item?.noteId && sourceIds.add(item.noteId));
    const sourceNotes = [...sourceIds].map(id => noteById.get(id)).filter(Boolean);
    const sources = contextualAiSourcesFromNotes(sourceNotes.length ? sourceNotes : todayNotes, { limit: maxItems * 2 });
    return {
      today,
      notes: todayNotes,
      tasks: openTasks,
      reminders: dueReminders,
      agendaItems: todayAgenda,
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

  function reminderDisplayDate(item) {
    const at = item?.remindAt?.at;
    if (!at) return '';
    return at.toLocaleString([], {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  }

  function reminderStatusLabel(status) {
    if (status === 'due') return 'Due';
    if (status === 'snoozed') return 'Snoozed';
    return 'Upcoming';
  }

  function slugKey(value = '') {
    return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  }

  function novelistNoteId(title, vaultId = '', fallback = Date.now().toString(36)) {
    const slug = slugKey(title) || fallback;
    const vaultSlug = slugKey(vaultId);
    return `n_novel_${vaultSlug ? `${vaultSlug}_` : ''}${slug}`;
  }

  function ensureNovelistTags(existingTags = [], novelistTags = []) {
    const byName = new Map((existingTags || []).map(tag => [tag.name, tag]));
    (novelistTags || []).forEach(tag => {
      if (!byName.has(tag.name)) byName.set(tag.name, tag);
    });
    return [...byName.values()];
  }

  function dirtyNoteKey(vaultId, noteId) {
    return `${String(vaultId || '')}::${String(noteId || '')}`;
  }

  function isNovelistNote(note) {
    return (note?.tags || []).some(tag => String(tag || '').startsWith('novel-'));
  }

  function normalizeNovelistLegacyTags(tags = []) {
    return (tags || [])
      .map(tag => tag === 'novel-arc' ? 'novel-act' : tag)
      .filter(tag => tag !== 'novel-manuscript' && tag !== 'novel-storyRoot')
      .filter((tag, index, arr) => arr.indexOf(tag) === index);
  }

  function normalizeNovelistLegacyBody(body = '') {
    return String(body || '')
      .split('\n')
      .map(line => {
        const prop = line.match(/^(\s*(?:-\s*)?)arc(::\s*.*)$/i);
        if (prop) return `${prop[1]}act${prop[2]}`;
        return line.replace(/^(##+\s+)Arcs\s*$/i, '$1Acts');
      })
      .join('\n');
  }

  function bodyPropertyLineRe(key = '') {
    const safeKey = String(key || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`^\\s*(?:-\\s*)?${safeKey}::\\s*(.*)$`, 'im');
  }

  function bodyPropertyValue(body = '', key = '') {
    if (!key) return '';
    const match = String(body || '').match(bodyPropertyLineRe(key));
    return match ? String(match[1] || '').trim() : '';
  }

  function bodyPropertyTitle(body = '', key = '') {
    const value = bodyPropertyValue(body, key);
    const wiki = value.match(/^\[\[([^\]]+)\]\]/);
    return String(wiki ? wiki[1] : value).replace(/#[^\]]+$/, '').trim();
  }

  function bodyPropertyInsertIndex(lines = []) {
    const isPropLine = (line) => /^\s*-?\s*[a-zA-Z][a-zA-Z0-9_-]*::\s*/.test(line);
    const headingIndex = lines.findIndex(line => /^#{1,3}\s+/.test(line));
    let index = headingIndex >= 0 ? headingIndex + 1 : 0;
    while (index < lines.length && isPropLine(lines[index])) index++;
    return index;
  }

  function setBodyProperty(body = '', key = '', value = '') {
    const cleanKey = String(key || '').trim();
    const cleanValue = String(value ?? '').trim();
    if (!cleanKey) return body || '';
    if (!cleanValue) return removeBodyProperty(body, cleanKey);
    const source = String(body || '');
    const lineRe = bodyPropertyLineRe(cleanKey);
    if (lineRe.test(source)) return source.replace(lineRe, () => `${cleanKey}:: ${cleanValue}`);
    const lines = source.split('\n');
    lines.splice(bodyPropertyInsertIndex(lines), 0, `${cleanKey}:: ${cleanValue}`);
    return lines.join('\n');
  }

  function removeBodyProperty(body = '', key = '') {
    const cleanKey = String(key || '').trim();
    if (!cleanKey) return body || '';
    const safeKey = cleanKey.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return String(body || '')
      .split('\n')
      .filter(line => !(new RegExp(`^\\s*-?\\s*${safeKey}::\\s*`, 'i')).test(line))
      .join('\n');
  }

  function bodyPropertyParts(line = '') {
    const match = String(line || '').match(/^\s*(?:-\s*)?([a-zA-Z][a-zA-Z0-9_-]*)::\s*(.*)$/);
    return match ? { key: match[1], value: match[2] || '' } : null;
  }

  function normalizeBodyPropertySyntax(body = '') {
    const lines = String(body || '').split('\n');
    let inFence = false;
    return lines.map(line => {
      if (/^```\s*/.test(line)) {
        inFence = !inFence;
        return line;
      }
      if (inFence) return line;
      const prop = bodyPropertyParts(line);
      return prop ? `${prop.key}:: ${prop.value}`.trimEnd() : line;
    }).join('\n');
  }

  function stripDuplicateTitleHeading(body = '', title = '') {
    const source = String(body || '');
    const cleanTitle = String(title || '').trim().toLowerCase();
    if (!cleanTitle) return source;
    const lines = source.split('\n');
    let first = 0;
    while (first < lines.length && !lines[first].trim()) first++;
    const heading = lines[first]?.match(/^#\s+(.*)$/);
    if (!heading || String(heading[1] || '').trim().toLowerCase() !== cleanTitle) return source;
    lines.splice(first, 1);
    while (lines.length && !lines[0].trim()) lines.shift();
    return lines.join('\n');
  }

  function normalizeNoteBody(body = '', title = '') {
    return normalizeBodyPropertySyntax(stripDuplicateTitleHeading(body, title));
  }

  function ensureScenePlotPoints(body = '', tags = []) {
    if (!(tags || []).includes('novel-scene')) return body || '';
    const source = String(body || '');
    if (/^:::\s*plot-points\s*$/im.test(source)) return source;
    const lines = source.split('\n');
    const insertAt = bodyPropertyInsertIndex(lines);
    lines.splice(insertAt, 0, '::: plot-points', '- Opening beat', ':::');
    return lines.join('\n');
  }

  function novelTitleKey(title) {
    return String(title || '')
      .split('|')[0]
      .replace(/#[^\]]+$/, '')
      .trim()
      .toLowerCase();
  }

  function novelWikiTitles(body = '') {
    return [...String(body || '').matchAll(/\[\[([^\]]+)\]\]/g)]
      .map(match => match[1].trim())
      .filter(Boolean);
  }

  function replaceWikiLinkTitle(body = '', oldTitle = '', newTitle = '') {
    const oldKey = novelTitleKey(oldTitle);
    const cleanNewTitle = String(newTitle || '').trim();
    if (!oldKey || !cleanNewTitle) return body || '';
    return String(body || '').replace(/\[\[([^\]]+)\]\]/g, (match, rawTarget) => {
      const target = String(rawTarget || '');
      const [targetAndAnchor, alias] = target.split('|');
      const anchorIndex = targetAndAnchor.indexOf('#');
      const targetTitle = anchorIndex >= 0 ? targetAndAnchor.slice(0, anchorIndex) : targetAndAnchor;
      const anchor = anchorIndex >= 0 ? targetAndAnchor.slice(anchorIndex) : '';
      if (novelTitleKey(targetTitle) !== oldKey) return match;
      return `[[${cleanNewTitle}${anchor}${alias != null ? `|${alias}` : ''}]]`;
    });
  }

  function noteOrderValue(note) {
    const raw = bodyPropertyValue(note?.body || '', 'order');
    if (!String(raw || '').trim()) return null;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function compareStoryNotes(a, b) {
    const ao = noteOrderValue(a);
    const bo = noteOrderValue(b);
    if (ao != null || bo != null) {
      if (ao == null) return 1;
      if (bo == null) return -1;
      if (ao !== bo) return ao - bo;
    }
    const byTitle = String(a?.title || '').localeCompare(String(b?.title || ''), undefined, { sensitivity: 'base' });
    if (byTitle) return byTitle;
    const byModified = new Date(b?.modifiedAt || b?.date || 0) - new Date(a?.modifiedAt || a?.date || 0);
    if (byModified) return byModified;
    return String(a?.id || '').localeCompare(String(b?.id || ''));
  }

  function novelOutlineLinks(body = '') {
    const stack = [];
    const links = [];
    String(body || '').split('\n').forEach(line => {
      const matches = [...line.matchAll(/\[\[([^\]]+)\]\]/g)]
        .map(match => match[1].trim())
        .filter(Boolean);
      if (!matches.length) return;
      const indent = (line.match(/^\s*/) || [''])[0].replace(/\t/g, '  ').length;
      const depth = Math.max(0, Math.floor(indent / 2));
      while (stack.length && stack[stack.length - 1].depth >= depth) stack.pop();
      const ancestors = stack.slice();
      matches.forEach(title => links.push({ title, depth, ancestors }));
      stack.push({ title: matches[0], depth });
    });
    return links;
  }

  function novelPropertyTitle(body = '', key = '') {
    return bodyPropertyTitle(body, key);
  }

  function novelHasWikiLink(body = '', title = '') {
    const target = novelTitleKey(title);
    return novelWikiTitles(body).some(link => novelTitleKey(link) === target);
  }

  function novelEnsureWikiLink(body = '', title = '') {
    const cleanTitle = String(title || '').trim();
    if (!cleanTitle || novelHasWikiLink(body, cleanTitle)) return body || '';
    const base = String(body || '').trimEnd();
    return `${base}${base ? '\n' : ''}- [[${cleanTitle}]]`;
  }

  function novelEnsureWikiLinkInSection(body = '', title = '', sectionTitle = '') {
    const cleanTitle = String(title || '').trim();
    const cleanSection = String(sectionTitle || '').trim();
    if (!cleanTitle) return body || '';
    if (!cleanSection) return novelEnsureWikiLink(body, cleanTitle);
    const lines = String(body || '').split('\n');
    const sectionRe = new RegExp(`^##+\\s+${cleanSection.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'i');
    const sectionIndex = lines.findIndex(line => sectionRe.test(line));
    if (sectionIndex < 0) {
      const base = String(body || '').trimEnd();
      return `${base}${base ? '\n' : ''}## ${cleanSection}\n- [[${cleanTitle}]]`;
    }
    let insertAt = sectionIndex + 1;
    while (insertAt < lines.length && !/^#{1,6}\s+/.test(lines[insertAt])) insertAt++;
    const existingSectionText = lines.slice(sectionIndex + 1, insertAt).join('\n');
    if (novelHasWikiLink(existingSectionText, cleanTitle)) return body || '';
    lines.splice(insertAt, 0, `- [[${cleanTitle}]]`);
    return lines.join('\n');
  }

  function novelUpsertPropertyLink(body = '', key = '', title = '') {
    const cleanTitle = String(title || '').trim();
    if (!key || !cleanTitle) return body || '';
    return setBodyProperty(body, key, `[[${cleanTitle}]]`);
  }

  function buildNovelistStructure(notes = []) {
    const allNotes = notes || [];
    const byTitle = new Map(allNotes.map(note => [novelTitleKey(note.title), note]));
    const isTagged = (note, tag) => (note?.tags || []).includes(tag);
    const stageRank = { scene: 1, chapter: 2, act: 3 };
    const stageIds = { acts: new Set(), chapters: new Set(), scenes: new Set() };
    const explicitStageByNoteId = {};
    const stageByNoteId = {};
    const childrenByActId = {};
    const childrenByChapterId = {};
    const parentByChapterId = {};
    const parentBySceneId = {};
    const actBySceneId = {};
    const noteById = new Map(allNotes.map(note => [note.id, note]));

    const addUnique = (bucket, parentId, childId) => {
      if (!parentId || !childId) return;
      if (!bucket[parentId]) bucket[parentId] = [];
      if (!bucket[parentId].includes(childId)) bucket[parentId].push(childId);
    };
    const canStage = (stage, note) => {
      const explicit = explicitStageByNoteId[note?.id];
      return !explicit || explicit === stage;
    };
    const addStage = (stage, note) => {
      if (!note || !canStage(stage, note)) return;
      const current = stageByNoteId[note.id];
      if (current && stageRank[current] >= stageRank[stage]) return;
      stageIds.acts.delete(note.id);
      stageIds.chapters.delete(note.id);
      stageIds.scenes.delete(note.id);
      if (stage === 'act') stageIds.acts.add(note.id);
      if (stage === 'chapter') stageIds.chapters.add(note.id);
      if (stage === 'scene') stageIds.scenes.add(note.id);
      stageByNoteId[note.id] = stage;
    };
    const linkChapterToAct = (chapter, act) => {
      if (!chapter || !act || chapter.id === act.id) return;
      if (!canStage('chapter', chapter) || !canStage('act', act)) return;
      addStage('act', act);
      addStage('chapter', chapter);
      if (!parentByChapterId[chapter.id]) parentByChapterId[chapter.id] = act.id;
      addUnique(childrenByActId, act.id, chapter.id);
    };
    const linkSceneToChapter = (scene, chapter, act = null) => {
      if (!scene || !chapter || scene.id === chapter.id) return;
      if (!canStage('scene', scene) || !canStage('chapter', chapter)) return;
      addStage('chapter', chapter);
      addStage('scene', scene);
      if (!parentBySceneId[scene.id]) parentBySceneId[scene.id] = chapter.id;
      addUnique(childrenByChapterId, chapter.id, scene.id);
      if (act && act.id !== scene.id) {
        linkChapterToAct(chapter, act);
        actBySceneId[scene.id] = act.id;
      }
    };
    const linkedNotes = (note) => novelWikiTitles(note?.body || '')
      .map(title => byTitle.get(novelTitleKey(title)))
      .filter(Boolean);
    const outlineNotes = (note) => novelOutlineLinks(note?.body || '')
      .map(link => ({
        ...link,
        note: byTitle.get(novelTitleKey(link.title)),
        ancestors: (link.ancestors || []).map(ancestor => ({
          ...ancestor,
          note: byTitle.get(novelTitleKey(ancestor.title)),
        })),
      }))
      .filter(link => link.note);

    allNotes.forEach(note => {
      if (isTagged(note, 'novel-act')) explicitStageByNoteId[note.id] = 'act';
      else if (isTagged(note, 'novel-chapter')) explicitStageByNoteId[note.id] = 'chapter';
      else if (isTagged(note, 'novel-scene')) explicitStageByNoteId[note.id] = 'scene';
    });
    allNotes.forEach(note => {
      if (explicitStageByNoteId[note.id]) addStage(explicitStageByNoteId[note.id], note);
    });
    allNotes.forEach(note => {
      const act = byTitle.get(novelTitleKey(novelPropertyTitle(note.body, 'act')));
      const chapter = byTitle.get(novelTitleKey(novelPropertyTitle(note.body, 'chapter')));
      if (chapter) linkSceneToChapter(note, chapter, act || null);
      else if (act) linkChapterToAct(note, act);
    });
    allNotes.filter(note => stageIds.acts.has(note.id)).forEach(act => {
      const outlined = outlineNotes(act);
      outlined.forEach(link => {
        const chapter = link.ancestors.find(ancestor => ancestor.depth === 0)?.note;
        if (link.depth <= 0) linkChapterToAct(link.note, act);
        else if (chapter) linkSceneToChapter(link.note, chapter, act);
      });
      if (!outlined.length) {
        linkedNotes(act).forEach(chapter => {
          if (!stageIds.scenes.has(chapter.id)) linkChapterToAct(chapter, act);
        });
      }
    });
    allNotes.filter(note => stageIds.chapters.has(note.id)).forEach(chapter => {
      const act = noteById.get(parentByChapterId[chapter.id]) || null;
      outlineNotes(chapter).forEach(link => linkSceneToChapter(link.note, chapter, act));
      linkedNotes(chapter).forEach(scene => {
        if (!stageIds.acts.has(scene.id) && !stageIds.chapters.has(scene.id)) linkSceneToChapter(scene, chapter, act);
      });
    });

    let acts = allNotes.filter(note => stageIds.acts.has(note.id));
    let chapters = allNotes.filter(note => stageIds.chapters.has(note.id));
    let scenes = allNotes.filter(note => stageIds.scenes.has(note.id));
    chapters.forEach(chapter => {
      const act = byTitle.get(novelTitleKey(novelPropertyTitle(chapter.body, 'act')));
      if (act) linkChapterToAct(chapter, act);
    });
    scenes.forEach(scene => {
      const chapter = byTitle.get(novelTitleKey(novelPropertyTitle(scene.body, 'chapter')));
      const act = byTitle.get(novelTitleKey(novelPropertyTitle(scene.body, 'act')));
      if (chapter) linkSceneToChapter(scene, chapter, act || null);
    });
    acts = allNotes.filter(note => stageIds.acts.has(note.id)).sort(compareStoryNotes);
    chapters = allNotes.filter(note => stageIds.chapters.has(note.id)).sort(compareStoryNotes);
    scenes = allNotes.filter(note => stageIds.scenes.has(note.id)).sort(compareStoryNotes);
    const sortChildIds = (ids = []) => [...ids]
      .map(id => noteById.get(id))
      .filter(Boolean)
      .sort(compareStoryNotes)
      .map(note => note.id);
    Object.keys(childrenByActId).forEach(actId => {
      childrenByActId[actId] = sortChildIds(childrenByActId[actId]);
    });
    Object.keys(childrenByChapterId).forEach(chapterId => {
      childrenByChapterId[chapterId] = sortChildIds(childrenByChapterId[chapterId]);
    });
    const novelNotes = allNotes.filter(note =>
      isNovelistNote(note) ||
      stageByNoteId[note.id] ||
      parentByChapterId[note.id] ||
      parentBySceneId[note.id]
    );

    const pathByNoteId = {};
    acts.forEach(act => { pathByNoteId[act.id] = [act].filter(Boolean); });
    chapters.forEach(chapter => {
      const act = noteById.get(parentByChapterId[chapter.id]);
      pathByNoteId[chapter.id] = [act, chapter].filter(Boolean);
    });
    scenes.forEach(scene => {
      const chapter = noteById.get(parentBySceneId[scene.id]);
      const act = noteById.get(chapter ? parentByChapterId[chapter.id] : actBySceneId[scene.id]);
      pathByNoteId[scene.id] = [act, chapter, scene].filter(Boolean);
    });

    return {
      novelNotes,
      acts,
      chapters,
      scenes,
      childrenByActId,
      childrenByChapterId,
      parentByChapterId,
      parentBySceneId,
      stageByNoteId,
      pathByNoteId,
    };
  }

  function buildNovelistStarterNotes(notes = [], mdToBlocks, vaultId = '', starters = []) {
    const existing = new Set((notes || []).flatMap(note => [
      String(note.title || '').toLowerCase(),
      ...(note.tags || []),
    ]));
    return (starters || [])
      .filter(item => !existing.has(String(item.title || '').toLowerCase()) && !(item.tags || []).some(tag => existing.has(tag)))
      .map(item => {
        const body = normalizeNoteBody(item.body, item.title);
        return {
          id: novelistNoteId(item.title, vaultId),
          title: item.title,
          body,
          blocks: mdToBlocks(body),
          tags: item.tags,
          pinned: item.title === 'Act 1',
          date: new Date().toISOString(),
          modifiedAt: new Date().toISOString(),
        };
      });
  }

  function normalizeNotes(notes = [], mdToBlocks) {
    return (notes || []).map(note => {
      const tags = normalizeNovelistLegacyTags(note.tags || []);
      const body = normalizeNoteBody(ensureScenePlotPoints(normalizeNovelistLegacyBody(note.body || ''), tags), note.title || 'Untitled');
      return {
        ...note,
        body,
        blocks: note.blocks || mdToBlocks(body || ''),
        tags,
      };
    });
  }

  function noteForDisk(note, blocksToMd) {
    const sourceBody = Array.isArray(note.blocks) ? blocksToMd(note.blocks || []) : (note.body || '');
    return {
      id: note.id,
      title: note.title || 'Untitled',
      date: note.date || new Date().toISOString(),
      tags: normalizeNovelistLegacyTags(Array.isArray(note.tags) ? note.tags : []),
      pinned: !!note.pinned,
      workflowArchived: !!note.workflowArchived,
      body: normalizeNoteBody(ensureScenePlotPoints(normalizeNovelistLegacyBody(sourceBody), note.tags || []), note.title || 'Untitled'),
    };
  }

  function normalizeTagName(name) {
    return String(name || '').trim().toLowerCase().replace(/\s+/g, '-').replace(/^-+|-+$/g, '');
  }

  function parseDefaultTags(value) {
    return String(value || '')
      .split(',')
      .map(normalizeTagName)
      .filter(Boolean)
      .filter((tag, index, arr) => arr.indexOf(tag) === index);
  }

  const NOVEL_IMPORT_KIND_TAGS = {
    act: 'novel-act',
    chapter: 'novel-chapter',
    scene: 'novel-scene',
    character: 'novel-character',
    location: 'novel-location',
    plot: 'novel-plot',
    research: 'novel-research',
    revision: 'novel-revision',
  };

  function normalizeNovelImportKind(value = '') {
    const clean = String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-');
    if (clean === 'act' || clean === 'part') return 'act';
    if (clean === 'chapter') return 'chapter';
    if (clean === 'scene' || clean === 'story' || clean === 'draft') return 'scene';
    if (clean === 'character' || clean === 'cast') return 'character';
    if (clean === 'location' || clean === 'setting' || clean === 'place') return 'location';
    if (clean === 'plot' || clean === 'thread' || clean === 'outline') return 'plot';
    if (clean === 'research' || clean === 'worldbuilding' || clean === 'world-building') return 'research';
    if (clean === 'revision' || clean === 'todo' || clean === 'note') return 'revision';
    return '';
  }

  function novelImportTagForKind(kind = '') {
    return NOVEL_IMPORT_KIND_TAGS[normalizeNovelImportKind(kind)] || '';
  }

  function cleanNovelImportTitle(value = '', fallback = 'Imported Note') {
    const clean = String(value || '')
      .replace(/\[\[|\]\]/g, '')
      .replace(/^#+\s*/, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 120);
    return clean || fallback;
  }

  function cleanNovelImportText(value = '', limit = 12000) {
    return String(value || '').replace(/\0/g, '').replace(/\r\n/g, '\n').trim().slice(0, limit);
  }

  function cleanNovelImportList(value = [], limit = 16) {
    const source = Array.isArray(value)
      ? value
      : String(value || '').split(/\r?\n|;/);
    return source
      .map(item => cleanNovelImportText(item, 240).replace(/^[-*]\s*/, '').trim())
      .filter(Boolean)
      .filter((item, index, arr) => arr.findIndex(other => other.toLowerCase() === item.toLowerCase()) === index)
      .slice(0, limit);
  }

  function normalizeNovelImportCandidate(raw = {}, index = 0) {
    if (!raw || typeof raw !== 'object') return null;
    const kind = normalizeNovelImportKind(raw.kind || raw.type || raw.noteType || raw.category);
    const tag = novelImportTagForKind(kind);
    if (!kind || !tag) return null;
    const title = cleanNovelImportTitle(raw.title || raw.name, `Imported ${kind} ${index + 1}`);
    return {
      title,
      kind,
      tag,
      body: cleanNovelImportText(raw.body || raw.content || raw.summary || raw.text || ''),
      actTitle: cleanNovelImportText(raw.actTitle || raw.act || '', 160).replace(/^\[\[|\]\]$/g, ''),
      chapterTitle: cleanNovelImportText(raw.chapterTitle || raw.chapter || '', 160).replace(/^\[\[|\]\]$/g, ''),
      order: cleanNovelImportText(raw.order || '', 40),
      pov: cleanNovelImportText(raw.pov || raw.pointOfView || '', 120),
      purpose: cleanNovelImportText(raw.purpose || raw.goal || '', 500),
      sourceFile: cleanNovelImportText(raw.sourceFile || raw.source || '', 180),
      confidence: cleanNovelImportText(raw.confidence || '', 40),
      plotPoints: cleanNovelImportList(raw.plotPoints || raw.beats || raw.outline || []),
    };
  }

  function normalizeNovelImportCandidates(value) {
    const source = Array.isArray(value)
      ? value
      : Array.isArray(value?.notes) ? value.notes
      : Array.isArray(value?.candidates) ? value.candidates
      : Array.isArray(value?.items) ? value.items
      : [];
    return source
      .map((item, index) => normalizeNovelImportCandidate(item, index))
      .filter(Boolean);
  }

  function novelImportRelations(candidates = []) {
    const chaptersByAct = new Map();
    const scenesByChapter = new Map();
    const add = (map, parent, child) => {
      const key = novelTitleKey(parent);
      if (!key || !child) return;
      if (!map.has(key)) map.set(key, []);
      const list = map.get(key);
      if (!list.some(item => novelTitleKey(item) === novelTitleKey(child))) list.push(child);
    };
    candidates.forEach(candidate => {
      if (candidate.kind === 'chapter') add(chaptersByAct, candidate.actTitle, candidate.title);
      if (candidate.kind === 'scene') add(scenesByChapter, candidate.chapterTitle, candidate.title);
    });
    return { chaptersByAct, scenesByChapter };
  }

  function novelImportPropertyLines(candidate) {
    const lines = [];
    if (candidate.kind === 'act' || candidate.kind === 'chapter' || candidate.kind === 'scene' || candidate.kind === 'plot' || candidate.kind === 'revision') {
      lines.push(`status:: ${candidate.kind === 'scene' ? 'DRAFT' : 'OUTLINE'}`);
    }
    if (candidate.order) lines.push(`order:: ${candidate.order}`);
    if ((candidate.kind === 'chapter' || candidate.kind === 'scene') && candidate.actTitle) lines.push(`act:: [[${candidate.actTitle}]]`);
    if (candidate.kind === 'scene' && candidate.chapterTitle) lines.push(`chapter:: [[${candidate.chapterTitle}]]`);
    if (candidate.kind === 'scene' && candidate.pov) lines.push(`pov:: ${candidate.pov}`);
    if (candidate.purpose) lines.push(`purpose:: ${candidate.purpose}`);
    if (candidate.sourceFile && !['act', 'chapter', 'scene'].includes(candidate.kind)) lines.push(`source:: ${candidate.sourceFile}`);
    return lines;
  }

  function novelImportDetails(candidate) {
    const lines = [];
    if (candidate.sourceFile && ['act', 'chapter', 'scene'].includes(candidate.kind)) lines.push(`source:: ${candidate.sourceFile}`);
    if (candidate.body) lines.push(candidate.body);
    return lines.join('\n').trim();
  }

  function novelImportLinkLines(titles = []) {
    return (titles || []).filter(Boolean).map(title => `- [[${title}]]`);
  }

  function buildNovelImportBody(candidate, relations = {}) {
    const propLines = novelImportPropertyLines(candidate);
    const details = novelImportDetails(candidate);
    const chunks = [];
    if (propLines.length) chunks.push(propLines.join('\n'));
    if (candidate.kind === 'act') {
      const chapters = novelImportLinkLines(relations.chaptersByAct?.get(novelTitleKey(candidate.title)) || []);
      chunks.push(['## Chapters', ...(chapters.length ? chapters : ['- Major turn'])].join('\n'));
      if (details) chunks.push(`## Imported Details\n${details}`);
    } else if (candidate.kind === 'chapter') {
      const scenes = novelImportLinkLines(relations.scenesByChapter?.get(novelTitleKey(candidate.title)) || []);
      chunks.push(['## Scenes', ...(scenes.length ? scenes : ['- Scene list'])].join('\n'));
      if (details) chunks.push(`## Imported Details\n${details}`);
    } else if (candidate.kind === 'scene') {
      const points = candidate.plotPoints.length ? candidate.plotPoints : ['Opening beat'];
      chunks.push(['::: plot-points', ...points.map(point => `- ${point}`), ':::'].join('\n'));
      chunks.push(details || 'Draft the scene here.');
    } else {
      chunks.push(details || `- Imported ${candidate.kind} detail`);
    }
    return normalizeNoteBody(ensureScenePlotPoints(chunks.join('\n\n'), [candidate.tag]), candidate.title);
  }

  function appendNovelImportDetails(body = '', candidate) {
    const details = novelImportDetails(candidate);
    if (!details) return body || '';
    const source = String(body || '').trimEnd();
    const meaningful = candidate.body || details;
    if (meaningful && source.toLowerCase().includes(meaningful.slice(0, 160).toLowerCase())) return body || '';
    return `${source}${source ? '\n\n' : ''}## Imported Details\n${details}`;
  }

  function mergeNovelImportBody(note, candidate, relations = {}) {
    let body = normalizeNoteBody(note?.body || '', note?.title || candidate.title);
    if (candidate.kind === 'act') {
      if (candidate.order && !bodyPropertyValue(body, 'order')) body = setBodyProperty(body, 'order', candidate.order);
      if (candidate.purpose && !bodyPropertyValue(body, 'purpose')) body = setBodyProperty(body, 'purpose', candidate.purpose);
      (relations.chaptersByAct.get(novelTitleKey(candidate.title)) || []).forEach(title => {
        body = novelEnsureWikiLinkInSection(body, title, 'Chapters');
      });
    } else if (candidate.kind === 'chapter') {
      if (candidate.order && !bodyPropertyValue(body, 'order')) body = setBodyProperty(body, 'order', candidate.order);
      if (candidate.actTitle && !bodyPropertyTitle(body, 'act')) body = novelUpsertPropertyLink(body, 'act', candidate.actTitle);
      if (candidate.purpose && !bodyPropertyValue(body, 'purpose')) body = setBodyProperty(body, 'purpose', candidate.purpose);
      (relations.scenesByChapter.get(novelTitleKey(candidate.title)) || []).forEach(title => {
        body = novelEnsureWikiLinkInSection(body, title, 'Scenes');
      });
    } else if (candidate.kind === 'scene') {
      if (candidate.order && !bodyPropertyValue(body, 'order')) body = setBodyProperty(body, 'order', candidate.order);
      if (candidate.actTitle && !bodyPropertyTitle(body, 'act')) body = novelUpsertPropertyLink(body, 'act', candidate.actTitle);
      if (candidate.chapterTitle && !bodyPropertyTitle(body, 'chapter')) body = novelUpsertPropertyLink(body, 'chapter', candidate.chapterTitle);
      if (candidate.pov && !bodyPropertyValue(body, 'pov')) body = setBodyProperty(body, 'pov', candidate.pov);
      if (candidate.purpose && !bodyPropertyValue(body, 'purpose')) body = setBodyProperty(body, 'purpose', candidate.purpose);
      body = ensureScenePlotPoints(body, [candidate.tag]);
    } else {
      body = appendNovelImportDetails(body, candidate);
    }
    return normalizeNoteBody(ensureScenePlotPoints(body, [candidate.tag]), note?.title || candidate.title);
  }

  function isNovelImportCompatible(note, candidate) {
    return !!note && (note.tags || []).includes(candidate.tag);
  }

  function uniqueNovelImportId(title, vaultId, usedIds, index) {
    let id = novelistNoteId(title, vaultId, `import_${index + 1}`);
    let suffix = 2;
    while (usedIds.has(id)) id = `${novelistNoteId(title, vaultId, `import_${index + 1}`)}_${suffix++}`;
    usedIds.add(id);
    return id;
  }

  function uniqueNovelImportTitle(notes = [], rawTitle = 'Untitled') {
    const base = cleanNovelImportTitle(rawTitle, 'Untitled');
    const existing = new Set((notes || []).map(note => String(note.title || '').trim().toLowerCase()).filter(Boolean));
    if (!existing.has(base.toLowerCase())) return base;
    let index = 2;
    while (existing.has(`${base} ${index}`.toLowerCase())) index++;
    return `${base} ${index}`;
  }

  function buildNovelImportPlan(rawCandidates = [], existingNotes = [], options = {}) {
    const candidates = normalizeNovelImportCandidates(rawCandidates);
    const now = options.now || new Date().toISOString();
    const relations = novelImportRelations(candidates);
    const existing = (existingNotes || []).map(note => ({ ...note }));
    const nextNotes = [...existing];
    const byTitle = new Map(existing.map(note => [novelTitleKey(note.title), note]));
    const usedIds = new Set(existing.map(note => note.id).filter(Boolean));
    const created = [];
    const updated = [];
    const skipped = [];
    const changedIds = [];

    candidates.forEach((candidate, index) => {
      const key = novelTitleKey(candidate.title);
      const matching = byTitle.get(key);
      if (matching && isNovelImportCompatible(matching, candidate)) {
        const mergedBody = mergeNovelImportBody(matching, candidate, relations);
        if (mergedBody === (matching.body || '')) {
          skipped.push({ title: matching.title, kind: candidate.kind, reason: 'No safe changes' });
          return;
        }
        const merged = { ...matching, body: mergedBody, modifiedAt: now };
        const noteIndex = nextNotes.findIndex(note => note.id === matching.id);
        if (noteIndex >= 0) nextNotes[noteIndex] = merged;
        byTitle.set(key, merged);
        updated.push({ id: merged.id, title: merged.title, kind: candidate.kind, tag: candidate.tag });
        changedIds.push(merged.id);
        return;
      }

      const title = uniqueNovelImportTitle(nextNotes, candidate.title);
      const titledCandidate = { ...candidate, title };
      const body = buildNovelImportBody(titledCandidate, relations);
      const note = {
        id: uniqueNovelImportId(title, options.vaultId || '', usedIds, index),
        title,
        body,
        tags: [candidate.tag],
        pinned: candidate.kind === 'act' && !nextNotes.some(item => (item.tags || []).includes('novel-act')),
        date: now,
        modifiedAt: now,
      };
      nextNotes.unshift(note);
      byTitle.set(novelTitleKey(title), note);
      created.push({ id: note.id, title, kind: candidate.kind, tag: candidate.tag });
      changedIds.push(note.id);
    });

    return {
      notes: nextNotes,
      candidates,
      created,
      updated,
      skipped,
      changedIds: changedIds.filter((id, index, arr) => id && arr.indexOf(id) === index),
      summary: {
        candidates: candidates.length,
        created: created.length,
        updated: updated.length,
        skipped: skipped.length,
      },
    };
  }

  return {
    NOTE_TEMPLATES,
    CAPTURE_DESTINATIONS,
    CAPTURE_TEMPLATES,
    SMART_VIEW_FORMAT,
    PHASE5_METRICS_FORMAT,
    PHASE5_METRIC_KEYS,
    todayIsoDate,
    expandTemplate,
    templateById,
    captureTemplateById,
    captureTemplateChoices,
    expandCaptureTemplate,
    captureDestinationChoices,
    captureDestinationById,
    captureBuildAppendMarkdown,
    captureBuildSavePlan,
    phase5MetricChoices,
    phase5NormalizeMetricKey,
    phase5SanitizeMetricDetails,
    phase5SanitizeMetrics,
    phase5RecordMetric,
    phase5MetricCount,
    zoteroCleanItemKey,
    zoteroNormalizeSource,
    zoteroBuildSourceNoteDraft,
    zoteroFindSourceNote,
    zoteroBuildSourceNotePlan,
    filterCommands,
    decorateNotesWithSearchDetails,
    normalizeWorkflowStatus,
    workflowNotePreview,
    collectWorkflowNotes,
    reminderKey,
    taskItemKey,
    collectTaskItems,
    collectReminderItems,
    rollupNormalizeRange,
    rollupNormalizeGroupBy,
    rollupDateKey,
    rollupDateRangeBounds,
    rollupDateKeyInRange,
    rollupTitleDateKey,
    rollupNoteDateKey,
    rollupIsOlderGroup,
    smartViewNormalizeDefinition,
    smartViewMatchesNote,
    smartViewQueryNotes,
    smartViewQueryActions,
    smartViewQuery,
    smartViewValidateSavedDefinition,
    smartViewSerializeDefinition,
    smartViewParseDefinitionText,
    smartViewParseEmbedBlock,
    smartViewUpsertSavedDefinition,
    rollupGroupNotes,
    rollupNotePreview,
    rollupFilterTaskItems,
    rollupFilterReminderItems,
    rollupFindDailyNote,
    rollupTaskReasonLabel,
    rollupReminderReasonLabel,
    agendaActionStatus,
    agendaActionReasonLabel,
    agendaActionDetail,
    agendaDecorateActionItems,
    agendaFilterActionItems,
    agendaParseDeferMarker,
    agendaStripDeferMarkers,
    agendaCleanActionText,
    agendaBuildTaskContent,
    agendaIsDeferred,
    agendaNormalizeActionIdentity,
    agendaBodyHasActionText,
    agendaReplaceUniqueSourceText,
    agendaParseScheduleInput,
    rollupAppendQuickTask,
    rollupAppendReflection,
    rollupBuildEndDayRecap,
    rollupAppendEndDayRecap,
    contextualAiProviderMeta,
    contextualAiSourceFromNote,
    contextualAiSourcesFromNotes,
    contextualAiNormalizeSection,
    contextualAiNormalizeSections,
    contextualAiResult,
    contextualAiMarkdownMarkers,
    contextualAiCompareMarkdownMarkers,
    contextualAiBuildTodayRecapContext,
    contextualAiBuildTodayRecapPrompt,
    contextualAiBuildTodayRecapResult,
    reminderDisplayDate,
    reminderStatusLabel,
    novelistNoteId,
    ensureNovelistTags,
    buildNovelistStarterNotes,
    dirtyNoteKey,
    isNovelistNote,
    normalizeNovelistLegacyTags,
    normalizeNovelistLegacyBody,
    ensureScenePlotPoints,
    novelTitleKey,
    novelWikiTitles,
    replaceWikiLinkTitle,
    bodyPropertyLineRe,
    bodyPropertyValue,
    bodyPropertyTitle,
    bodyPropertyInsertIndex,
    setBodyProperty,
    removeBodyProperty,
    bodyPropertyParts,
    normalizeBodyPropertySyntax,
    stripDuplicateTitleHeading,
    normalizeNoteBody,
    noteOrderValue,
    compareStoryNotes,
    novelOutlineLinks,
    novelPropertyTitle,
    novelHasWikiLink,
    novelEnsureWikiLink,
    novelEnsureWikiLinkInSection,
    novelUpsertPropertyLink,
    buildNovelistStructure,
    normalizeNotes,
    noteForDisk,
    normalizeTagName,
    parseDefaultTags,
    NOVEL_IMPORT_KIND_TAGS,
    normalizeNovelImportKind,
    novelImportTagForKind,
    normalizeNovelImportCandidates,
    buildNovelImportBody,
    mergeNovelImportBody,
    buildNovelImportPlan,
  };
});
