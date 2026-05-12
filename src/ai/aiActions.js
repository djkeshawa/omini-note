(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.MN_AI_ACTIONS = api;
})(typeof globalThis !== 'undefined' ? globalThis : window, function () {
  const NOTEISH_RE = /\b(my|this|current|latest|recent|last|note|notes|page|pages|vault|tag|tags|task|tasks|todo|todos|reminder|reminders|decide|decided|wrote|writing|link|links|backlink|backlinks|summarize.*notes|search)\b/;
  const HIGH_RISK_RE = /\b(?:run|execute|exec|eval|spawn|launch|call|invoke|use)\s+(?:code|scripts?|shell|terminal|commands?|cmd|bash|python|node|plugins?)\b|\b(?:read|write|modify|delete|open|inspect|access)\s+(?:files?|filesystem|file system)\b|\b(?:make|send|perform)\s+(?:a\s+)?(?:network|http|https)\s+(?:request|call)\b|\b(?:fetch|curl|wget)\s+(?:url|https?:\/\/|\S+\.\w{2,})\b/;

  function cleanTitle(value) {
    return String(value || '').trim().replace(/[.?!]$/, '').trim();
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

  function extractCreateTitle(q) {
    const quoted = q.match(/["“']([^"”']+)["”']/)?.[1];
    const explicit = quoted ||
      q.match(/\b(?:called|titled|named)\s+(.+?)(?:\s+(?:and|then|also|after that|with)\s+(?=(?:tag|tags?|#|summari[sz]e|summary|add|append|link|connect|remind|set|open|create|make|put|file)\b)|[.?!]?$)/i)?.[1] ||
      q.match(/\b(?:page|note|not)\s+(?:about|for)\s+(.+?)(?:\s+(?:and|then|also|after that|with)\s+(?=(?:tag|tags?|#|summari[sz]e|summary|add|append|link|connect|remind|set|open|create|make|put|file)\b)|[.?!]?$)/i)?.[1];
    if (explicit) return cleanTitle(explicit);
    if (wantsVaultSummary(q)) return 'Notes summary';
    return 'AI draft';
  }

  function extractTagNames(q) {
    const text = String(q || '');
    const found = [];
    const add = (value) => {
      const clean = normalizeTagName(value);
      if (clean && !found.includes(clean)) found.push(clean);
    };
    for (const match of text.matchAll(/#([a-zA-Z0-9][a-zA-Z0-9_-]{0,47})/g)) add(match[1]);
    for (const match of text.matchAll(/\b(?:tag|tags|tagged|mark|label|categorize|file)\s+(?:it|this|current|(?:this|current)\s+(?:page|note)|the\s+(?:new\s+)?(?:page|note|one)|(?:new\s+)?one)?\s*(?:as|with|for|under|in)\s+#?([a-zA-Z0-9][a-zA-Z0-9 _-]{0,60})/gi)) {
      add(match[1].replace(/\b(?:and|then|after|also)\b.*$/i, ''));
    }
    for (const match of text.matchAll(/\b(?:put|file|categorize)\s+(?:it|this|current|(?:new\s+)?(?:note|page|one))\s+(?:under|in|as|with|for)\s+#?([a-zA-Z0-9][a-zA-Z0-9 _-]{0,60})/gi)) {
      add(match[1].replace(/\b(?:and|then|after|also)\b.*$/i, ''));
    }
    for (const match of text.matchAll(/\b(?:under|with|as|for)\s+#?([a-zA-Z0-9][a-zA-Z0-9 _-]{0,60})\s+(?:tag|tags?)\b/gi)) add(match[1]);
    for (const match of text.matchAll(/\b(?:add|apply|set)\s+(?:the\s+)?#?([a-zA-Z0-9][a-zA-Z0-9 _-]{0,60})\s+tag\b/gi)) add(match[1]);
    return found;
  }

  function extractTagName(q) {
    return extractTagNames(q)[0] || '';
  }

  function wantsCreateNote(q) {
    const s = String(q || '').toLowerCase();
    return /\b(create|make|new)\b.*\b(page|note|not|one)\b/.test(s) ||
      /\b(create|make)\s+(?:a\s+)?new\s+one\b/.test(s) ||
      /\b(summarize|summarise|summary)\b.*\bnotes?\b.*\b(create|make|new)\b/.test(s);
  }

  function wantsVaultSummary(q) {
    const s = String(q || '').toLowerCase();
    return /\b(summarize|summarise|summary)\b.*\b(all|my|vault|notes?)\b.*\bnotes?\b/.test(s) ||
      /\b(all|my|vault)\b.*\bnotes?\b.*\b(summarize|summarise|summary)\b/.test(s);
  }

  function wantsCurrentTarget(q) {
    const s = String(q || '').toLowerCase();
    return /\b(this|current)\b.*\b(page|note)\b/.test(s) ||
      /\b(page|note)\b.*\b(this|current)\b/.test(s) ||
      /\btag\s+this\b/.test(s) ||
      /\btag\s+for\b/.test(s);
  }

  function buildActionPlan(q) {
    const text = String(q || '');
    const s = text.toLowerCase();
    if (!wantsCreateNote(s)) return null;
    const steps = [];
    const tags = extractTagNames(text);
    const title = extractCreateTitle(text);
    const summary = wantsVaultSummary(s);
    if (summary) {
      steps.push({
        type: 'notes-answer',
        purpose: 'summary',
        prompt: `${text}\n\nReturn a concise markdown note body only. Focus on the notes, decisions, tasks, dates, and named references that matter.`,
      });
    }
    steps.push({
      type: 'create-note',
      title,
      bodyFrom: summary ? 'previous-answer' : 'generate',
      tags: tags.slice(),
    });
    tags.forEach(tag => steps.push({ type: 'tag-created-note', tag }));
    if (steps.length > 1 || summary || tags.length) {
      return { type: 'action-plan', title, confidence: 'high', source: 'direct-router', steps };
    }
    return null;
  }

  function detectAction(q) {
    const text = String(q || '');
    const s = text.toLowerCase();
    if (HIGH_RISK_RE.test(s)) {
      return {
        type: 'high-risk-disabled',
        reason: 'This AI capability is not enabled. Code execution, shell commands, plugin execution, and model-controlled filesystem or network access require an explicit Settings toggle with a clear warning.',
      };
    }
    const actionPlan = buildActionPlan(text);
    if (actionPlan) return actionPlan;
    const tagName = extractTagName(text);
    const asksTagLookup = /\b(which|what|show|find|list|search|filter)\b/.test(s);
    const addTagCommand = /\b(?:add|apply|set)\b.*\btag\b/.test(s);
    if (tagName && (wantsCurrentTarget(text) || addTagCommand) && /\b(tag|mark|label|categorize|file|add|apply|set)\b/.test(s) && !asksTagLookup) {
      return { type: 'tag-current-note', tag: tagName };
    }
    if (/\b(create|make|new)\b.*\b(page|note|not)\b/.test(s)) {
      return { type: 'create-note', title: extractCreateTitle(text) };
    }
    if (/\b(link|wikilink|connect)\b.*\b(page|note|this|things|together)\b/.test(s)) {
      const wantsFormat = /\b(format|clean up|organize|improve|polish)\b/.test(s);
      return { type: 'edit-current', action: wantsFormat ? 'format-link' : 'link' };
    }
    if (/\b(format|clean up|organize)\b.*\b(page|note|this|current)\b/.test(s)) {
      return { type: 'edit-current', action: 'format' };
    }
    if (/\b(improve|rewrite|polish)\b.*\b(page|note|writing|this|current)\b/.test(s)) {
      return { type: 'edit-current', action: 'improve' };
    }
    if (/\b(summarize|summary)\b.*\b(page|note|this|current)\b/.test(s)) {
      return { type: 'edit-current', action: 'summarize' };
    }
    if (/\b(concise|shorten)\b.*\b(page|note|this|current)\b/.test(s)) {
      return { type: 'edit-current', action: 'concise' };
    }
    if (/\b(fix|correct)\b.*\b(grammar|spelling|page|note|this|current)\b/.test(s)) {
      return { type: 'edit-current', action: 'fix' };
    }
    return null;
  }

  function classifyPrompt(q) {
    const action = detectAction(q);
    if (action) return { type: 'action', action };
    const s = String(q || '').toLowerCase().trim();
    const normalized = s.replace(/[!?.\s]+$/g, '');
    if (/^(hi|hello|hey|yo|sup|thanks|thank you|ok|okay|cool|nice|good morning|good afternoon|good evening)$/.test(normalized)) {
      return { type: 'chat' };
    }
    if (/\b(who are you|what can you do|help|how do you work|what are your capabilities)\b/.test(s)) {
      return { type: 'chat' };
    }
    if (NOTEISH_RE.test(s)) return { type: 'notes' };
    return { type: 'notes' };
  }

  return {
    detectAction,
    classifyPrompt,
    normalizeTagName,
    extractTagName,
    extractTagNames,
    buildActionPlan,
  };
});
