function createCaptureHelpers(scope = {}) {
  const rollupFindDailyNote = (...args) => scope.rollupFindDailyNote(...args);
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
  return { NOTE_TEMPLATES, CAPTURE_DESTINATIONS, CAPTURE_TEMPLATES, SMART_VIEW_FORMAT, SMART_VIEW_TYPES, SMART_VIEW_SORT_FIELDS, CONTEXTUAL_AI_SECTION_KINDS, ZOTERO_ITEM_KEY_RE, ZOTERO_SOURCE_TAGS, PHASE5_METRICS_FORMAT, PHASE5_METRIC_KEYS, PHASE5_METRIC_DETAIL_KEYS, CONTEXTUAL_AI_PROVIDER_LABELS, todayIsoDate, captureCleanText, captureSlug, captureUniqueTags, captureReplaceTokens, expandTemplate, templateById, captureTemplateById, captureTemplateChoices, expandCaptureTemplate, captureFindInboxNote, captureDestinationChoices, captureDestinationById, captureBuildAppendMarkdown, captureBuildSavePlan, phase5MetricChoices, phase5NormalizeMetricKey, phase5CleanMetricDetailValue, phase5SanitizeMetricDetails, phase5SanitizeMetrics, phase5RecordMetric, phase5MetricCount };
}

module.exports = { createCaptureHelpers };
