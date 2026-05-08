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
      .replace(/^#/, '')
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48);
  }

  function extractCreateTitle(q) {
    const quoted = q.match(/["“']([^"”']+)["”']/)?.[1];
    return cleanTitle(
      quoted ||
      q.match(/\b(?:called|titled|named)\s+(.+)$/i)?.[1] ||
      q.match(/\b(?:page|note)\s+(?:about|for)\s+(.+)$/i)?.[1] ||
      'AI draft'
    );
  }

  function extractTagName(q) {
    const quoted = q.match(/["“']#?([^"”']+)["”']/)?.[1];
    const hash = q.match(/#([a-zA-Z0-9][a-zA-Z0-9_-]{0,47})/)?.[1];
    const preposition = q.match(/\b(?:tag|mark|label|categorize|file)\s+(?:(?:this|current)\s+)?(?:page|note|it)?\s*(?:as|with|for|under)?\s+#?([a-zA-Z0-9][a-zA-Z0-9 _-]{0,60})/i)?.[1];
    const addTag = q.match(/\b(?:add|apply|create|set)\s+(?:the\s+)?#?([a-zA-Z0-9][a-zA-Z0-9 _-]{0,60})\s+tag\b/i)?.[1];
    const raw = quoted || hash || preposition || addTag || '';
    return normalizeTagName(raw.replace(/\b(?:tag|to|this|current|page|note|it)\b.*$/i, ''));
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
    const tagName = extractTagName(text);
    const asksTagLookup = /\b(which|what|show|find|list|search|filter)\b/.test(s);
    if (tagName && /\b(tag|mark|label|categorize|file|add|apply|set)\b/.test(s) && !asksTagLookup) {
      return { type: 'tag-current-note', tag: tagName };
    }
    if (/\b(create|make|new)\b.*\b(page|note)\b/.test(s)) {
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
  };
});
