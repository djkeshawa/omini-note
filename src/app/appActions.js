(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.MN_APP_ACTIONS_FACTORY = api;
})(typeof globalThis !== 'undefined' ? globalThis : window, function () {
  const CONFIRM_RISKS = new Set(['confirm', 'destructive', 'external']);
  const KNOWN_RISKS = new Set(['safe', 'confirm', 'destructive', 'external']);

  function isPlainObject(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
  }

  function normalizeRisk(risk) {
    return KNOWN_RISKS.has(risk) ? risk : 'safe';
  }

  function cleanAction(action = {}) {
    const id = String(action.id || '').trim();
    if (!id) throw new Error('App action is missing an id');
    if (typeof action.run !== 'function') throw new Error(`App action ${id} is missing run()`);
    const risk = normalizeRisk(action.risk);
    return {
      ...action,
      id,
      label: String(action.label || action.title || id).trim(),
      title: String(action.title || action.label || id).trim(),
      description: String(action.description || action.keywords || '').trim(),
      section: String(action.section || 'Command').trim(),
      keywords: String(action.keywords || '').trim(),
      kind: String(action.kind || (risk === 'external' ? 'external' : risk === 'destructive' ? 'destructive' : 'write')).trim(),
      examples: Array.isArray(action.examples) ? action.examples.map(item => String(item || '').trim()).filter(Boolean).slice(0, 8) : [],
      requires: Array.isArray(action.requires) ? action.requires.map(item => String(item || '').trim()).filter(Boolean).slice(0, 8) : [],
      outputSchema: isPlainObject(action.outputSchema) ? action.outputSchema : { type: 'object', additionalProperties: true },
      resolveArgs: typeof action.resolveArgs === 'function' ? action.resolveArgs : null,
      aiHidden: action.aiHidden === true,
      risk,
      inputSchema: isPlainObject(action.inputSchema) ? action.inputSchema : { type: 'object', additionalProperties: false },
    };
  }

  function validateValue(value, schema = {}, path = 'value') {
    if (!schema || !schema.type) return value;
    if (schema.type === 'string') {
      if (value === undefined || value === null) return schema.default !== undefined ? schema.default : '';
      if (typeof value !== 'string') throw new Error(`${path} must be a string`);
      const max = Number(schema.maxLength || 0);
      const next = value.trim();
      if (schema.enum && !schema.enum.includes(next)) throw new Error(`${path} must be one of: ${schema.enum.join(', ')}`);
      return max ? next.slice(0, max) : next;
    }
    if (schema.type === 'boolean') return !!value;
    if (schema.type === 'number' || schema.type === 'integer') {
      const n = Number(value);
      if (!Number.isFinite(n)) throw new Error(`${path} must be a number`);
      return schema.type === 'integer' ? Math.trunc(n) : n;
    }
    if (schema.type === 'array') {
      if (value === undefined || value === null) return [];
      if (!Array.isArray(value)) throw new Error(`${path} must be an array`);
      return value.map((item, index) => validateValue(item, schema.items || {}, `${path}[${index}]`));
    }
    if (schema.type === 'object') return validateArgs(schema, value || {});
    return value;
  }

  function validateArgs(schema = {}, args = {}) {
    if (!isPlainObject(args)) throw new Error('Action arguments must be an object');
    const props = isPlainObject(schema.properties) ? schema.properties : {};
    const required = Array.isArray(schema.required) ? schema.required : [];
    const out = {};
    for (const key of required) {
      if (args[key] === undefined || args[key] === null || args[key] === '') throw new Error(`Missing action argument: ${key}`);
    }
    for (const [key, value] of Object.entries(args)) {
      if (!props[key]) {
        if (schema.additionalProperties === false) throw new Error(`Unsupported action argument: ${key}`);
        out[key] = value;
        continue;
      }
      out[key] = validateValue(value, props[key], key);
    }
    for (const [key, propSchema] of Object.entries(props)) {
      if (out[key] === undefined && propSchema.default !== undefined) out[key] = propSchema.default;
    }
    return out;
  }

  function actionPublicShape(action) {
    const enabled = typeof action.enabled === 'function' ? !!action.enabled() : action.enabled !== false;
    return {
      id: action.id,
      label: action.label,
      title: action.title || action.label,
      description: action.description,
      section: action.section,
      shortcut: action.shortcut || '',
      keywords: action.keywords || '',
      inputSchema: action.inputSchema,
      outputSchema: action.outputSchema,
      kind: action.kind,
      examples: action.examples || [],
      requires: action.requires || [],
      risk: action.risk,
      enabled,
      hidden: !!action.hidden,
      aiHidden: !!action.aiHidden,
    };
  }

  function sourceForAction(action, result = {}) {
    if (Array.isArray(result.affected) && result.affected.length) return result.affected;
    if (result.id || result.title) return [{ type: action.section || 'action', id: result.id || action.id, title: result.title || action.label }];
    return [];
  }

  function makeActionResult(action, patch = {}) {
    const ok = patch.ok !== false;
    return {
      ok,
      actionId: action.id,
      title: patch.title || action.label,
      message: patch.message || (ok ? `${action.label} completed.` : `${action.label} failed.`),
      affected: sourceForAction(action, patch),
      requiresConfirmation: !!patch.requiresConfirmation,
      risk: action.risk,
      preview: patch.preview || null,
      ...patch,
    };
  }

  function defaultPreview(action, args) {
    const affected = [];
    if (args.noteId) affected.push({ type: 'note', id: args.noteId, title: args.title || args.noteId });
    if (args.canvasId) affected.push({ type: 'canvas', id: args.canvasId, title: args.title || args.canvasId });
    if (args.vaultId) affected.push({ type: 'vault', id: args.vaultId, title: args.vaultId });
    return {
      title: action.label,
      message: action.description || `${action.label} is ready to run.`,
      steps: [action.label],
      affected,
    };
  }

  function tokenize(value) {
    return String(value || '').toLowerCase().split(/[^a-z0-9_-]+/).filter(Boolean);
  }

  function scoreAction(action, query) {
    const q = String(query || '').trim().toLowerCase();
    if (!q) return 0;
    const hay = `${action.label} ${action.description} ${action.section} ${action.keywords}`.toLowerCase();
    if (hay.includes(q)) return 1000 - hay.indexOf(q);
    const terms = tokenize(q);
    if (!terms.length) return 0;
    let score = 0;
    for (const term of terms) {
      if (hay.includes(term)) score += term.length >= 4 ? 8 : 3;
    }
    return score;
  }

  function extractQuoted(query) {
    return String(query || '').match(/["“']([^"”']+)["”']/)?.[1] || '';
  }

  function normalizeTagName(value) {
    return String(value || '')
      .trim()
      .replace(/^(?:it|this|current|new|the)\s+(?:under|as|with|for|in)\s+/i, '')
      .replace(/^(?:it|this|current|new|the)\s+/i, '')
      .replace(/^#/, '')
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48);
  }

  function cleanTagCandidate(value) {
    return String(value || '')
      .replace(/\b(?:and|then|after|also)\b.*$/i, '')
      .replace(/[.?!]$/g, '')
      .trim();
  }

  function cleanCommandText(value) {
    return String(value || '')
      .replace(/\b(?:and then|then|after that|also)\b.*$/i, '')
      .replace(/[.?!]+$/g, '')
      .trim();
  }

  function cleanTitleCandidate(value) {
    return cleanCommandText(value)
      .replace(/^["“']|["”']$/g, '')
      .replace(/\s+\b(?:summari[sz]e|summary)\b\s+(?:all|my|the|vault)?\s*notes?.*$/i, '')
      .trim();
  }

  function cleanNoteTargetCandidate(value) {
    return cleanCommandText(value)
      .replace(/^["“']|["”']$/g, '')
      .replace(/^(?:please\s+)?(?:the\s+)?(?:note|page)\s+(?:called|named|titled)\s+/i, '')
      .replace(/^(?:please\s+)?(?:the|a|an)\s+/i, '')
      .replace(/\s+(?:note|page)$/i, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function isImplicitNoteTarget(value) {
    return /^(?:it|this|that|current|selected|open|active|new|new one|current note|selected note|open note|active note|current page|selected page|open page|active page|note|page)$/i
      .test(String(value || '').trim());
  }

  function isCreateNoteCommand(query) {
    const q = String(query || '').toLowerCase();
    return /\b(?:create|make|new)\b.*\b(?:note|page|not|one)\b/.test(q) ||
      /\b(?:create|make)\s+(?:a\s+)?new\s+one\b/.test(q);
  }

  function extractCreateTitle(query) {
    const text = String(query || '');
    const quoted = extractQuoted(text);
    const patterns = [
      /\b(?:note|page|not)\s+(?:called|named|titled)\s+(.+?)(?:\s+(?:and|then|also|after that|with)\s+(?=(?:tag|tags?|#|summari[sz]e|summary|add|append|link|connect|remind|set|open|create|make|put|file)\b)|[.?!]?$)/i,
      /\b(?:create|make|new)\s+(?:a\s+)?(?:new\s+)?(?:note|page|not)\s+(?:called|named|titled)\s+(.+?)(?:\s+(?:and|then|also|after that|with)\s+(?=(?:tag|tags?|#|summari[sz]e|summary|add|append|link|connect|remind|set|open|create|make|put|file)\b)|[.?!]?$)/i,
      /\b(?:create|make|new)\s+(?:a\s+)?(?:note|page|not)\s+(?:about|for)\s+(.+?)(?:\s+(?:and|then|also|after that|with)\s+(?=(?:tag|tags?|#|summari[sz]e|summary|add|append|link|connect|remind|set|open|create|make|put|file)\b)|[.?!]?$)/i,
      /\b(?:create|make|new)\s+(?:a\s+)?(?:note|page|not)\s+(.+?)(?:\s+(?:and|then|also|after that|with)\s+(?=(?:tag|tags?|#|summari[sz]e|summary|add|append|link|connect|remind|set|open|create|make|put|file)\b)|[.?!]?$)/i,
    ];
    if (quoted && isCreateNoteCommand(text)) return cleanTitleCandidate(quoted);
    for (const pattern of patterns) {
      const title = cleanTitleCandidate(text.match(pattern)?.[1] || '');
      if (title && !/^(called|named|titled|about|for)$/i.test(title)) return title;
    }
    return '';
  }

  function extractSearchQuery(query) {
    const text = String(query || '');
    const patterns = [
      /\b(?:search|find)\s+(?:my\s+)?(?:notes?|pages?|content|vault)\s+(?:for|about|matching|on)\s+(.+?)(?:$|[.?!])/i,
      /\b(?:search|find)\s+(?:for\s+)?(.+?)\s+(?:in|across)\s+(?:my\s+)?(?:notes?|pages?|vault|content)(?:$|[.?!])/i,
    ];
    for (const pattern of patterns) {
      const match = text.match(pattern);
      const value = cleanCommandText(match?.[1] || '');
      if (value) return value;
    }
    return '';
  }

  function extractTodoText(query) {
    const text = String(query || '');
    const patterns = [
      /\b(?:add|create|make)\s+(?:a\s+)?(?:todo|task|checklist\s+item)\s+(?:to|in|on)?\s*(?:this|current)?\s*(?:note|page)?\s*(?:for|to|called|named)?\s+(.+?)(?:$|[.?!])/i,
      /\b(?:put|add)\s+(.+?)\s+(?:as\s+)?(?:a\s+)?(?:todo|task)\s+(?:in|on|to)\s+(?:this|current)?\s*(?:note|page)?(?:$|[.?!])/i,
    ];
    for (const pattern of patterns) {
      const match = text.match(pattern);
      const value = cleanCommandText(match?.[1] || '');
      if (value) return value;
    }
    return '';
  }

  function extractReminderText(query) {
    const text = String(query || '');
    const patterns = [
      /\bremind\s+me\s+to\s+(.+?)(?:$|[.?!])/i,
      /\b(?:add|create|make)\s+(?:a\s+)?reminder\s+(?:to|in|on)?\s*(?:this|current)?\s*(?:note|page)?\s*(?:for|to)?\s+(.+?)(?:$|[.?!])/i,
    ];
    for (const pattern of patterns) {
      const match = text.match(pattern);
      const value = cleanCommandText(match?.[1] || '');
      if (value) return value;
    }
    return '';
  }

  function extractLinkTarget(query) {
    const text = String(query || '');
    const hasLinkIntent = /\b(?:link|connect)\b|\b(?:add|insert)\s+(?:a\s+)?(?:wiki\s*)?link\b/i.test(text);
    if (!hasLinkIntent) return '';
    const quoted = extractQuoted(text);
    if (quoted) return quoted.trim();
    const patterns = [
      /\b(?:link|connect)\s+(?:this|current)?\s*(?:note|page)?\s+(?:to|with)\s+(.+?)(?:$|[.?!])/i,
      /\b(?:add|insert)\s+(?:a\s+)?(?:wiki\s*)?link\s+(?:to|for)\s+(.+?)(?:$|[.?!])/i,
    ];
    for (const pattern of patterns) {
      const match = text.match(pattern);
      const value = cleanCommandText(match?.[1] || '');
      if (value) return value;
    }
    return '';
  }

  function extractAppendText(query) {
    const text = String(query || '');
    const patterns = [
      /\b(?:append|add)\s+(.+?)\s+(?:to|into|in|on)\s+(?:this|current)\s+(?:note|page)(?:$|[.?!])/i,
      /\b(?:append|add)\s+(?:to|into|in|on)\s+(?:this|current)\s+(?:note|page)\s+(.+?)(?:$|[.?!])/i,
    ];
    for (const pattern of patterns) {
      const match = text.match(pattern);
      const value = cleanCommandText(match?.[1] || '');
      if (value) return value;
    }
    return '';
  }

  function extractTagName(query) {
    const text = String(query || '');
    const tagged = text.match(/#([a-zA-Z0-9][a-zA-Z0-9_-]{0,47})/)?.[1];
    if (tagged) return normalizeTagName(tagged);
    const patterns = [
      /\b(?:tag|tags|tagged|label|categorize|file)\s+(?:the\s+)?(?:.+?)\s+(?:as|with|for|under|in|to)\s+#?([a-zA-Z0-9][a-zA-Z0-9 _-]{0,60})/i,
      /\b(?:tag|tags|tagged|mark|label|categorize|file)\s+(?:it|this|current|(?:this|current)\s+(?:page|note)|the\s+(?:new\s+)?(?:page|note|one)|(?:new\s+)?one)?\s*(?:as|with|for|under|in)\s+#?([a-zA-Z0-9][a-zA-Z0-9 _-]{0,60})/i,
      /\b(?:put|file|categorize)\s+(?:it|this|current|(?:new\s+)?(?:note|page|one))\s+(?:under|in|as|with|for)\s+#?([a-zA-Z0-9][a-zA-Z0-9 _-]{0,60})/i,
      /\b(?:under|with|as|for)\s+#?([a-zA-Z0-9][a-zA-Z0-9 _-]{0,60})\s+(?:tag|tags?)\b/i,
      /\b(?:add|apply|set)\s+(?:the\s+)?#?([a-zA-Z0-9][a-zA-Z0-9 _-]{0,60})\s+tag\b/i,
    ];
    for (const pattern of patterns) {
      const match = text.match(pattern);
      const tag = normalizeTagName(cleanTagCandidate(match?.[1] || ''));
      if (tag) return tag;
    }
    return '';
  }

  function extractTagTargetTitle(query) {
    const text = String(query || '');
    const patterns = [
      /\b(?:tag|tags|tagged|label|categorize|file)\s+(?:the\s+)?(.+?)\s+(?:as|with|for|under|in|to)\s+#?[a-zA-Z0-9][a-zA-Z0-9 _-]{0,60}/i,
      /\b(?:put|file|categorize)\s+(?:the\s+)?(.+?)\s+(?:under|in|as|with|for)\s+#?[a-zA-Z0-9][a-zA-Z0-9 _-]{0,60}/i,
    ];
    for (const pattern of patterns) {
      const target = cleanNoteTargetCandidate(text.match(pattern)?.[1] || '');
      if (target && !isImplicitNoteTarget(target)) return target;
    }
    return '';
  }

  function cleanStatusCandidate(value) {
    return String(value || '')
      .replace(/\b(?:and|then|after|also)\b.*$/i, '')
      .replace(/[.?!,;]+$/g, '')
      .trim()
      .replace(/\s+/g, ' ')
      .slice(0, 80);
  }

  function extractStatusChange(query) {
    const text = String(query || '');
    const patterns = [
      {
        re: /\b(?:set|change|update)\s+(?:the\s+)?(?:workflow\s+)?(?:status|state|column)\s+(?:of|for)\s+(?:the\s+)?(.+?)\s+(?:to|as|into)\s+(.+?)(?=\s*(?:[,;.]|\band\b|\bthen\b|\balso\b|$))/i,
        target: 1,
        status: 2,
      },
      {
        re: /\b(?:set|change|update|move)\s+(?:the\s+)?(?:workflow\s+)?(?:status|state|column)\s+(?:to|as|into)\s+(.+?)(?=\s*(?:[,;.]|\band\b|\bthen\b|\balso\b|$))/i,
        target: 0,
        status: 1,
      },
      {
        re: /\bmove\s+(?:the\s+)?(.+?)\s+(?:to|into|as)\s+(.+?)(?=\s*(?:[,;.]|\band\b|\bthen\b|\balso\b|$))/i,
        target: 1,
        status: 2,
      },
      {
        re: /\bmark\s+(?:the\s+)?(.+?)\s+as\s+(todo|to\s*do|doing|done|draft|review|outline|revise|final|later|now|wait|waiting|blocked|cancelled|canceled|in\s*progress|in-?progress)\b/i,
        target: 1,
        status: 2,
      },
      {
        re: /\bmark\s+(?:(?:it|this|that|current|selected|open|active)(?:\s+(?:note|page))?|(?:the\s+)?(?:note|page))?\s*(?:as\s+)?(todo|to\s*do|doing|done|draft|review|outline|revise|final|later|now|wait|waiting|blocked|cancelled|canceled|in\s*progress|in-?progress)\b/i,
        target: 0,
        status: 1,
      },
    ];
    for (const item of patterns) {
      const match = text.match(item.re);
      const status = cleanStatusCandidate(match?.[item.status] || '');
      if (!status) continue;
      const target = item.target ? cleanNoteTargetCandidate(match?.[item.target] || '') : '';
      return {
        status,
        noteTitle: target && !isImplicitNoteTarget(target) ? target : '',
      };
    }
    return { status: '', noteTitle: '' };
  }

  function makePlan({ title, intent = 'app-action', confidence = 'high', source = 'direct-router', steps = [] } = {}) {
    return {
      type: 'app-action-plan',
      intent,
      confidence,
      source,
      title: title || steps[0]?.label || 'App action',
      steps,
      requiresConfirmation: false,
      message: '',
    };
  }

  function naturalPlan(query, actions = []) {
    const text = String(query || '').trim();
    const q = text.toLowerCase();
    if (!q) return null;
    if (/\b(summari[sz]e|summary)\b/.test(q) && /\bnotes?\b/.test(q) && /\b(create|make|new)\b/.test(q)) return null;
    const byId = new Map(actions.map(action => [action.id, action]));
    const firstEnabled = (ids) => ids.map(id => byId.get(id)).find(action => action && action.enabled !== false);
    const quoted = extractQuoted(text);
    const titleFrom = (fallback = '') => (quoted || fallback || '').trim();
    const newTitle = extractCreateTitle(text);
    const tag = extractTagName(text);
    const statusChange = extractStatusChange(text);
    const tagTargetTitle = extractTagTargetTitle(text);
    const mutationNoteTitle = statusChange.noteTitle || tagTargetTitle;
    const openNote = text.match(/\b(?:open|show|go to)\s+(?:the\s+)?(?:note|page)\s+(.+?)(?:$|[.?!])/i)?.[1] || quoted;
    const status = statusChange.status ||
      text.match(/\b(?:set|move|change).{0,24}\bstatus\s+(?:to|as)\s+([a-zA-Z0-9 _-]+)/i)?.[1] ||
      text.match(/\b(?:mark|set|move|change).{0,24}\b(?:todo|doing|done|draft|review)\b/i)?.[0];
    const appVerbCount = (q.match(/\b(?:create|make|new|add|append|tag|untag|link|open|search|find|remind|delete|rename|duplicate|archive|restore|import|export|rebuild|backfill)\b/g) || []).length;

    const noteMutationSteps = [];
    const noteTargetArgs = mutationNoteTitle ? { noteTitle: mutationNoteTitle } : {};
    if (status) {
      const action = firstEnabled(['set-workflow-status']);
      if (action) noteMutationSteps.push({ actionId: action.id, args: { ...noteTargetArgs, status: cleanStatusCandidate(status) }, label: action.label });
    }
    if (tag && /\b(?:untag|remove\s+tag)\b/.test(q)) {
      const action = firstEnabled(['untag-note']);
      if (action) noteMutationSteps.push({ actionId: action.id, args: { ...noteTargetArgs, tag }, label: action.label });
    } else if (tag && /\b(?:tag|tags?|tagged|label|mark|categorize|file|under|with|as|for)\b/.test(q)) {
      const action = firstEnabled(['tag-note']);
      if (action) noteMutationSteps.push({ actionId: action.id, args: { ...noteTargetArgs, tag }, label: action.label });
    }
    if (noteMutationSteps.length > 1 || (mutationNoteTitle && noteMutationSteps.length)) {
      return makePlan({
        title: noteMutationSteps.length > 1 ? 'Update note' : noteMutationSteps[0].label,
        intent: noteMutationSteps.length > 1 ? 'update-note' : noteMutationSteps[0].actionId,
        steps: noteMutationSteps,
      });
    }

    if (appVerbCount > 1 && /\b(?:and then|then|also|after that|and)\b/.test(q)) return null;

    if (isCreateNoteCommand(text)) {
      const action = firstEnabled(['new-note']);
      if (action) return makePlan({ title: action.label, intent: action.id, steps: [{ actionId: action.id, args: newTitle ? { title: newTitle } : {}, label: action.label }] });
    }

    const searchQuery = extractSearchQuery(text);
    if (searchQuery) {
      const action = firstEnabled(['search-notes']);
      if (action) return makePlan({ title: action.label, intent: action.id, steps: [{ actionId: action.id, args: { query: searchQuery, limit: 8 }, label: action.label }] });
    }
    const todoText = extractTodoText(text);
    if (todoText) {
      const action = firstEnabled(['add-todo-to-note']);
      if (action) return makePlan({ title: action.label, intent: action.id, steps: [{ actionId: action.id, args: { text: todoText }, label: action.label }] });
    }
    const reminderText = extractReminderText(text);
    if (reminderText) {
      const action = firstEnabled(['add-reminder-to-note']);
      if (action) return makePlan({ title: action.label, intent: action.id, steps: [{ actionId: action.id, args: { text: reminderText }, label: action.label }] });
    }
    const linkTarget = extractLinkTarget(text);
    if (linkTarget) {
      const action = firstEnabled(['link-note']);
      if (action) return makePlan({ title: action.label, intent: action.id, steps: [{ actionId: action.id, args: { targetTitle: linkTarget }, label: action.label }] });
    }
    const appendText = extractAppendText(text);
    if (appendText && !/\b(?:todo|task|remind|reminder|link)\b/.test(q)) {
      const action = firstEnabled(['append-to-note']);
      if (action) return makePlan({ title: action.label, intent: action.id, steps: [{ actionId: action.id, args: { content: appendText }, label: action.label }] });
    }

    const direct = [
      [/\b(?:create|make|new)\b.*\b(?:note|page|one)\b/, 'new-note', newTitle ? { title: newTitle } : {}],
      [/\bquick\s+capture\b|\bcapture\b/, 'quick-capture', {}],
      [/\b(?:daily|today'?s)\s+(?:note|page|journal)\b/, 'daily-note', {}],
      [/\bask\s+ai\b|\bopen\s+(?:ai|assistant)\b/, 'ask-ai', {}],
      [/\bsettings?|preferences?\b/, 'settings', {}],
      [/\bgraph\b/, 'graph', {}],
      [/\bcalendar\b|\bagenda\b|\bschedule\b/, 'calendar', {}],
      [/\btoday\b/, 'today', {}],
      [/^(?:to-?dos?|tasks?)$|\b(?:open|show|go to|view|list)\s+(?:my\s+)?(?:to-?dos?|tasks?)\b/, 'todos', {}],
      [/\bcanvas(?:\s+dashboard)?\b/, 'canvas', {}],
      [/\bvault\s+health\b|\bhealth\b/, 'vault-health', {}],
      [/\brebuild\b.*\bindex\b|\bindex\b.*\brebuild\b/, 'rebuild-index', {}],
      [/\bbackfill\b.*\bai\b|\bembedding\b.*\bbackfill\b|\brefresh\b.*\bai\s+index\b/, 'ai-backfill', {}],
      [/\bexport\b.*\bbackup\b/, 'export-backup', {}],
      [/\bimport\b.*\bbackup\b/, 'import-backup', {}],
      [/\bduplicate\b.*\b(?:this|current|note|page)\b/, 'duplicate-note', {}],
      [/\bdelete\b.*\b(?:this|current|note|page)\b/, 'delete-note', {}],
      [/\barchive\b.*\b(?:workflow|this|current|note|page)\b/, 'archive-workflow-note', { archived: true }],
      [/\brestore\b.*\b(?:trash|deleted)\b/, 'restore-trash-item', {}],
    ];
    for (const [re, id, args] of direct) {
      if (re.test(q)) {
        const action = firstEnabled([id]);
        if (action) return makePlan({ title: action.label, intent: id, steps: [{ actionId: id, args, label: action.label }] });
      }
    }
    if (/\brename\b/.test(q)) {
      const title = titleFrom(text.match(/\b(?:to|as)\s+(.+?)(?:$|[.?!])/i)?.[1] || '');
      const action = firstEnabled(['rename-note']);
      if (action && title) return makePlan({ title: action.label, intent: action.id, steps: [{ actionId: action.id, args: { title }, label: action.label }] });
    }
    if (tag && /\b(?:untag|remove\s+tag)\b/.test(q)) {
      const action = firstEnabled(['untag-note']);
      if (action) return makePlan({ title: action.label, intent: action.id, steps: [{ actionId: action.id, args: { ...noteTargetArgs, tag }, label: action.label }] });
    }
    if (tag && /\b(?:tag|label|mark)\b/.test(q)) {
      const action = firstEnabled(['tag-note']);
      if (action) return makePlan({ title: action.label, intent: action.id, steps: [{ actionId: action.id, args: { ...noteTargetArgs, tag }, label: action.label }] });
    }
    if (status) {
      const action = firstEnabled(['set-workflow-status']);
      if (action) return makePlan({ title: action.label, intent: action.id, steps: [{ actionId: action.id, args: { ...noteTargetArgs, status: cleanStatusCandidate(status) }, label: action.label }] });
    }
    if (openNote) {
      const notes = actions.filter(action => action.id.startsWith('note-'));
      const match = notes
        .map(action => ({ action, score: scoreAction(action, openNote) }))
        .filter(item => item.score > 0)
        .sort((a, b) => b.score - a.score)[0]?.action;
      if (match) return makePlan({ title: match.label, intent: 'open-note', steps: [{ actionId: match.id, args: {}, label: match.label }] });
    }
    const best = actions
      .filter(action => action.enabled !== false && !action.hidden)
      .map(action => ({ action, score: scoreAction(action, text) }))
      .filter(item => item.score > 0)
      .sort((a, b) => b.score - a.score)[0]?.action;
    return best ? makePlan({ title: best.label, intent: best.id, confidence: 'low', steps: [{ actionId: best.id, args: {}, label: best.label }] }) : null;
  }

  function createRegistry(rawActions = []) {
    const actions = rawActions.map(cleanAction);
    const byId = new Map(actions.map(action => [action.id, action]));

    async function preview(actionId, args = {}) {
      const action = byId.get(String(actionId || ''));
      if (!action) throw new Error(`Unknown app action: ${actionId}`);
      const cleanArgs = await resolveActionArgs(action, validateArgs(action.inputSchema, args), { preview: true });
      const value = typeof action.preview === 'function'
        ? await action.preview(cleanArgs)
        : defaultPreview(action, cleanArgs);
      return value || defaultPreview(action, cleanArgs);
    }

    async function resolveActionArgs(action, args, context = {}) {
      if (typeof action.resolveArgs !== 'function') return args;
      const resolved = await action.resolveArgs(args, context);
      return validateArgs(action.inputSchema, resolved || args);
    }

    async function run(actionId, args = {}, options = {}) {
      const action = byId.get(String(actionId || ''));
      if (!action) throw new Error(`Unknown app action: ${actionId}`);
      const enabled = typeof action.enabled === 'function' ? !!action.enabled() : action.enabled !== false;
      if (!enabled) return makeActionResult(action, { ok: false, message: `${action.label} is currently unavailable.` });
      const cleanArgs = await resolveActionArgs(action, validateArgs(action.inputSchema, args), options || {});
      if (CONFIRM_RISKS.has(action.risk) && !options.confirmed) {
        return makeActionResult(action, {
          requiresConfirmation: true,
          preview: await preview(action.id, cleanArgs),
          message: `${action.label} needs confirmation before it runs.`,
        });
      }
      const result = await action.run(cleanArgs, options);
      return makeActionResult(action, result || {});
    }

    function list(options = {}) {
      const includeHidden = !!options.includeHidden;
      return actions.map(actionPublicShape).filter(action => includeHidden || !action.hidden);
    }

    function describeForAi() {
      return list({ includeHidden: true })
        .filter(action => action.enabled)
        .filter(action => !action.aiHidden)
        .filter(action => !/^note-|^vault-|^canvas-/.test(action.id))
        .map(action => ({
          name: action.id,
          title: action.title || action.label,
          description: `${action.label}. ${action.description}`.trim(),
          section: action.section,
          input_schema: action.inputSchema,
          inputSchema: action.inputSchema,
          output_schema: action.outputSchema,
          outputSchema: action.outputSchema,
          kind: action.kind,
          examples: action.examples || [],
          requires: action.requires || [],
          risk: action.risk,
          readOnly: !!action.readOnly,
          destructive: action.risk === 'destructive',
          external: action.risk === 'external',
          confirm: action.risk === 'confirm',
          idempotent: !!action.idempotent,
        }));
    }

    function findForText(query) {
      return naturalPlan(query, actions);
    }

    return {
      list,
      preview,
      run,
      describeForAi,
      findForText,
      validate: (actionId, args = {}) => {
        const action = byId.get(String(actionId || ''));
        if (!action) throw new Error(`Unknown app action: ${actionId}`);
        return validateArgs(action.inputSchema, args);
      },
      __actions: actions,
    };
  }

  return {
    createRegistry,
    validateArgs,
    normalizeRisk,
    extractTagName,
    makePlan,
    CONFIRM_RISKS: [...CONFIRM_RISKS],
  };
});
