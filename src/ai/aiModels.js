import { AI_REPORT_TARGETS, reportAiOutput } from '../features/ai/index.js';
import { mnBlocksToMd } from '../editor/outline.jsx';

const MN_ASK_EDIT_ACTIONS = {
  format: 'Format and organize this page. Preserve meaning, markdown, wiki-links, tags, tasks, and headings.',
  improve: 'Improve the writing on this page. Preserve meaning, markdown, wiki-links, tags, tasks, and headings.',
  summarize: 'Summarize this page concisely. Preserve concrete decisions, tasks, dates, and named references.',
  concise: 'Make this page more concise while preserving important meaning and markdown structure.',
  fix: 'Fix spelling, grammar, and punctuation only. Do not rewrite more than necessary.',
  link: 'Add useful wiki-links using the existing note titles provided below. Preserve the page structure and do not add unrelated links.',
};

const MN_NOVEL_STRUCTURE_TAGS = new Set(['novel-act', 'novel-chapter', 'novel-scene']);

function mnIsSupportingNovelNote(note) {
  return (note?.tags || []).some(tag => {
    const clean = String(tag || '').toLowerCase();
    return clean.startsWith('novel-') && !MN_NOVEL_STRUCTURE_TAGS.has(clean);
  });
}

function mnSupportingNovelNotes(notes = []) {
  return (notes || []).filter(mnIsSupportingNovelNote);
}

function mnSupportingNotesEditInstruction(action, userInstruction = '') {
  const request = String(userInstruction || '').trim();
  const base = action === 'format'
    ? 'Format this supporting novel note as clean Markdown. Preserve every fact, name, relationship, worldbuilding detail, task, wiki-link, tag, and source detail. Use concise headings and bullet lists where useful. Do not convert it into story prose.'
    : 'Improve the clarity, organization, and wording of this supporting novel note. Preserve every fact, name, relationship, worldbuilding detail, task, wiki-link, tag, and source detail. Do not invent new story facts or convert it into story prose.';
  return request ? `${base}\n\nUser request: ${request}` : base;
}

const MN_ASK_SUGGESTIONS = [
  'What changed most recently in this vault?',
  'Summarize open tasks from my notes',
  'Create a page called Launch checklist',
  'Format this page and link things together',
];

const MN_AI_PLANNER_TIMEOUT_MS = 8000;
const MN_AI_CHAT_TIMEOUT_MS = 45000;
const MN_AI_NOTES_TIMEOUT_MS = 90000;
const MN_AI_VIRTUAL_WRITE_TOOLS = new Set(['edit-current-page', 'edit-supporting-notes']);

const MN_AI_REPORT_TARGETS = AI_REPORT_TARGETS;

const MN_AI_VIRTUAL_TOOLS = [
  {
    name: 'answer-notes',
    title: 'Answer from notes',
    description: 'Answer a specific question by searching and reading the active vault notes. Use for latest note, recent note, task, tag, decision, date, link, backlink, page, or note-content questions. Do not use for whole-vault summaries when summarize-vault is available.',
    risk: 'safe',
    readOnly: true,
    kind: 'read',
    examples: ['what is my latest note?', 'what changed most recently in this vault?', 'summarize open tasks from my notes', 'what decisions did I write down last week?'],
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', maxLength: 2000 },
      },
      required: ['query'],
      additionalProperties: false,
    },
    outputSchema: {
      type: 'object',
      properties: {
        answer: { type: 'string' },
        sources: { type: 'array', items: { type: 'object', additionalProperties: true } },
      },
      additionalProperties: true,
    },
  },
  {
    name: 'summarize-vault',
    title: 'Summarize vault',
    description: 'Create a whole-vault summary across all notes using the active vault. Use only when the user explicitly asks to summarize, recap, or overview all notes, the whole vault, everything, or the entire notebook.',
    risk: 'safe',
    readOnly: true,
    kind: 'read',
    examples: ['summarize all my notes', 'give me an overview of the whole vault', 'recap everything in this notebook'],
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', maxLength: 2000 },
      },
      required: ['query'],
      additionalProperties: false,
    },
    outputSchema: {
      type: 'object',
      properties: {
        answer: { type: 'string' },
        sources: { type: 'array', items: { type: 'object', additionalProperties: true } },
      },
      additionalProperties: true,
    },
  },
  {
    name: 'edit-current-page',
    title: 'Edit current page',
    description: 'Rewrite, format, summarize, improve, fix grammar, or link the currently open page. Use only when the user explicitly asks to change the current page.',
    risk: 'confirm',
    readOnly: false,
    inputSchema: {
      type: 'object',
      properties: {
        instruction: { type: 'string', maxLength: 4000 },
      },
      required: ['instruction'],
      additionalProperties: false,
    },
  },
  {
    name: 'edit-supporting-notes',
    title: 'Edit supporting novel notes',
    description: 'Format, improve, clean up, or update every supporting novel note in the active vault. Use when the user asks for all supporting notes, support notes, character notes, location notes, plot notes, research notes, or revision notes. Do not use for act, chapter, or scene story pages.',
    risk: 'confirm',
    readOnly: false,
    inputSchema: {
      type: 'object',
      properties: {
        instruction: { type: 'string', maxLength: 4000 },
      },
      required: ['instruction'],
      additionalProperties: false,
    },
  },
];

const mnReportAiOutput = reportAiOutput;


function mnAskAiJobId() {
  return `ask_${Date.now().toString(36)}_${Math.floor(Math.random() * 100000).toString(36)}`;
}

function mnAskMessageId(role = 'message') {
  const id = globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `${role}-${String(id).replace(/[^a-zA-Z0-9_-]/g, '')}`;
}

function mnNormalizeAskMessages(messages = []) {
  return (messages || []).map(m => m?.id ? m : { ...(m || {}), id: mnAskMessageId(m?.role || 'message') });
}

function mnAskMessageThreadText(message = {}) {
  const text = String(message.text || message.content || '').trim();
  const sources = Array.isArray(message.sources) ? message.sources : [];
  const sourceText = sources.slice(0, 5)
    .map(source => {
      const title = String(source?.title || source?.id || '').trim();
      const snippet = String(source?.snippet || '').trim();
      return title ? `- ${title}${snippet ? `: ${snippet}` : ''}` : '';
    })
    .filter(Boolean)
    .join('\n');
  return [
    text,
    sourceText ? `Referenced notes:\n${sourceText}` : '',
  ].filter(Boolean).join('\n\n').slice(0, 4000);
}

function mnBuildAskThreadMessages(priorMessages = [], currentQuery = '', options = {}) {
  const limit = Math.max(1, Math.min(Number(options.limit) || 8, 12));
  const history = (priorMessages || [])
    .filter(message => message && (message.role === 'user' || message.role === 'assistant'))
    .map(message => ({
      role: message.role === 'assistant' ? 'assistant' : 'user',
      content: mnAskMessageThreadText(message),
    }))
    .filter(message => message.content)
    .slice(-limit);
  const query = String(currentQuery || '').trim();
  return query ? [...history, { role: 'user', content: query }] : history;
}

function mnBuildAskThreadPrompt(priorMessages = [], currentQuery = '') {
  const history = mnBuildAskThreadMessages(priorMessages, '', { limit: 6 });
  const query = String(currentQuery || '').trim();
  if (!history.length) return query;
  return [
    'Conversation so far:',
    ...history.map(message => `${message.role}: ${message.content}`),
    '',
    `Current question: ${query}`,
  ].join('\n');
}

function mnRecentAskThreadNote(priorMessages = []) {
  for (const message of [...(priorMessages || [])].reverse()) {
    const source = (message.sources || []).find(item => {
      if (!item?.id || !item?.title) return false;
      if (item.type && item.type !== 'note') return false;
      return String(item.snippet || '').trim().toLowerCase() !== 'zotero';
    });
    if (source) {
      return {
        id: source.id,
        title: source.title,
        snippet: source.snippet || '',
      };
    }
  }
  return null;
}

function mnLastAskMessage(priorMessages = [], role = '') {
  return [...(priorMessages || [])].reverse().find(message => message?.role === role) || null;
}

function mnLooksLikeNoteEditRequest(text) {
  return /\b(add|append|include|insert|write|draft|create|make|format|rewrite|improve|summari[sz]e|compare|comparison|table|list|bullet|update)\b/i.test(String(text || ''));
}

function mnMentionsThreadNote(text) {
  return /\b(above|that|same|previous|created|new|current|this|it)\s+(note|page)\b/i.test(String(text || '')) ||
    /\b(to|in|into|for)\s+(the\s+)?(above|that|same|previous|created|new|current|this)\b/i.test(String(text || ''));
}

function mnAssistantAskedForActionDetail(message = {}) {
  const text = String(message.text || message.content || '').toLowerCase();
  return !!message.clarify ||
    /\bplease provide\b/.test(text) ||
    /\bspecific (differences|details|points|formatting)\b/.test(text) ||
    /\bformatting preferences\b/.test(text);
}

function mnBuildContextualActionQuery(priorMessages = [], currentQuery = '') {
  const query = String(currentQuery || '').trim();
  if (!query) return query;
  const note = mnRecentAskThreadNote(priorMessages);
  if (!note) return query;

  const previousUser = mnLastAskMessage(priorMessages, 'user');
  const previousAssistant = mnLastAskMessage(priorMessages, 'assistant');
  const previousUserText = String(previousUser?.text || previousUser?.content || '').trim();
  const previousWasNoteEdit = mnLooksLikeNoteEditRequest(previousUserText) && mnMentionsThreadNote(previousUserText);
  const currentIsNoteEdit = mnLooksLikeNoteEditRequest(query) && mnMentionsThreadNote(query);
  const currentLooksLikeDetail = !mnMentionsThreadNote(query) &&
    /\b(table|markdown|format|formatting|bullet|list|nice|comparison|compare|difference|different|details?)\b/i.test(query);

  if (currentIsNoteEdit) {
    return `${query}\n\nTarget note from this chat: "${note.title}" (${note.id}).`;
  }
  if (previousWasNoteEdit && mnAssistantAskedForActionDetail(previousAssistant) && currentLooksLikeDetail) {
    return `${previousUserText}\n\nAdditional detail from the user: ${query}\n\nTarget note from this chat: "${note.title}" (${note.id}).`;
  }
  return query;
}

function mnAiCurrentNoteMarkdown(note) {
  if (!note) return '';
  if (typeof note.body === 'string') return note.body;
  try {
    return mnBlocksToMd(note.blocks || []);
  } catch (e) {
    return '';
  }
}

function mnAiMarkdownMarkers(text = '') {
  const body = String(text || '');
  const collect = (re, map = value => value) => {
    const seen = new Set();
    const out = [];
    let match;
    while ((match = re.exec(body))) {
      const value = String(map(match) || '').trim();
      const key = value.toLowerCase();
      if (!value || seen.has(key)) continue;
      seen.add(key);
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

function mnAiMissingMarkdownMarkers(before = '', after = '') {
  const left = mnAiMarkdownMarkers(before);
  const right = mnAiMarkdownMarkers(after);
  const missing = (from, to) => from.filter(value => !to.some(item => item.toLowerCase() === value.toLowerCase()));
  const missingWikiLinks = missing(left.wikiLinks, right.wikiLinks);
  const missingTags = missing(left.tags, right.tags);
  const missingProperties = missing(left.properties, right.properties);
  const taskCountReduced = right.taskCount < left.taskCount;
  const warnings = [
    missingWikiLinks.length ? `Wiki links changed: ${missingWikiLinks.map(item => `[[${item}]]`).join(', ')}` : '',
    missingTags.length ? `Tags changed: ${missingTags.map(item => `#${item}`).join(', ')}` : '',
    missingProperties.length ? `Properties changed: ${missingProperties.join(', ')}` : '',
    taskCountReduced ? `Task count changed: ${left.taskCount} to ${right.taskCount}` : '',
  ].filter(Boolean);
  return {
    ok: !warnings.length,
    before: left,
    after: right,
    missingWikiLinks,
    missingTags,
    missingProperties,
    taskCountReduced,
    warnings,
  };
}

function mnAiBuildMarkdownPreview(before = '', after = '') {
  const beforeText = String(before || '');
  const afterText = String(after || '');
  return {
    before: beforeText,
    after: afterText,
    changed: beforeText !== afterText,
    beforeLines: beforeText ? beforeText.split(/\r?\n/).length : 0,
    afterLines: afterText ? afterText.split(/\r?\n/).length : 0,
    preservation: mnAiMissingMarkdownMarkers(beforeText, afterText),
  };
}

function mnAiShouldShareCurrentContext(query = '') {
  const text = String(query || '').toLowerCase();
  return /\b(this|current|open|selected|active)\s+(page|note|document)\b/.test(text)
    || /\b(format|rewrite|improve|summari[sz]e|fix|link|edit|update)\s+(it|this|that)\b/.test(text)
    || /\b(it|this|that)\s+(page|note|document)\b/.test(text);
}

function mnWantsZoteroAssistedNoteEdit(query = '') {
  const text = String(query || '').toLowerCase();
  const wantsEdit = /\b(add|append|include|insert|expand|improve|update|enhance|rewrite|fill|detail|details)\b/.test(text);
  const mentionsTarget = /\b(note|page|section|sections|details|current|this|my)\b/.test(text);
  const mentionsDocument = /\b(zotero|papers?|articles?|documents?|references?|pdfs?)\b/.test(text);
  return wantsEdit && mentionsTarget && mentionsDocument;
}

function mnWantsZoteroSummaryNote(query = '') {
  const text = String(query || '').toLowerCase();
  return /\b(create|make|write|add)\b/.test(text) &&
    /\b(new\s+)?(note|page)\b/.test(text) &&
    /\b(summari[sz]e|summari[sz]ing|summary)\b/.test(text) &&
    /\b(zotero|papers?|articles?|documents?|references?|pdfs?)\b/.test(text);
}

function mnAiCurrentContextMessage(currentNote) {
  if (!currentNote) return '';
  return [
    'Current VispNote context:',
    `- Current page title: ${currentNote.title || 'Untitled'}`,
    `- Current page id: ${currentNote.id || ''}`,
    currentNote.tags?.length ? `- Current page tags: ${currentNote.tags.map(tag => `#${tag}`).join(' ')}` : '',
    '',
    'Use this metadata only for references like "this page", "current note", "it", or "that". Read or edit the page through an explicit tool when body content is needed.',
  ].filter(Boolean).join('\n');
}

function mnAiVirtualToolMeta(name) {
  return (MN_AI_VIRTUAL_TOOLS || []).find(tool => tool.name === name) || null;
}

function mnAiCleanVirtualToolArgs(name, args = {}) {
  const meta = mnAiVirtualToolMeta(name);
  if (!meta) throw new Error(`Unknown AI tool: ${name}`);
  const out = {};
  const props = meta.inputSchema?.properties || {};
  const required = Array.isArray(meta.inputSchema?.required) ? meta.inputSchema.required : [];
  required.forEach(key => {
    if (args[key] === undefined || args[key] === null || args[key] === '') throw new Error(`Missing action argument: ${key}`);
  });
  Object.entries(args || {}).forEach(([key, value]) => {
    if (!props[key]) {
      if (meta.inputSchema?.additionalProperties === false) throw new Error(`Unsupported action argument: ${key}`);
      out[key] = value;
      return;
    }
    if (props[key].type === 'string') {
      const text = String(value == null ? '' : value).trim();
      out[key] = props[key].maxLength ? text.slice(0, props[key].maxLength) : text;
      return;
    }
    out[key] = value;
  });
  return out;
}

function mnAiToolCallsFromPlanResult(result = {}) {
  const value = result?.value || result || {};
  if (value.ok === false) return { answer: String(value.error || '').trim(), error: String(value.error || '').trim(), mode: 'error', toolCalls: [] };
  const toolCalls = Array.isArray(value.toolCalls) ? value.toolCalls
    : Array.isArray(value.calls) ? value.calls
      : [];
  return {
    answer: String(value.answer || '').trim(),
    error: String(value.error || '').trim(),
    mode: String(value.mode || '').trim(),
    toolCalls: toolCalls.map(call => ({
      name: String(call?.name || call?.tool || call?.function?.name || '').trim(),
      args: call?.args && typeof call.args === 'object'
        ? call.args
        : call?.input && typeof call.input === 'object'
          ? call.input
          : {},
      reason: String(call?.reason || '').trim(),
    })).filter(call => call.name),
  };
}

export { MN_ASK_EDIT_ACTIONS, MN_NOVEL_STRUCTURE_TAGS, mnIsSupportingNovelNote, mnSupportingNovelNotes, mnSupportingNotesEditInstruction, MN_ASK_SUGGESTIONS, MN_AI_PLANNER_TIMEOUT_MS, MN_AI_CHAT_TIMEOUT_MS, MN_AI_NOTES_TIMEOUT_MS, MN_AI_VIRTUAL_WRITE_TOOLS, MN_AI_REPORT_TARGETS, MN_AI_VIRTUAL_TOOLS, mnReportAiOutput, mnAskAiJobId, mnAskMessageId, mnNormalizeAskMessages, mnAskMessageThreadText, mnBuildAskThreadMessages, mnBuildAskThreadPrompt, mnRecentAskThreadNote, mnLastAskMessage, mnLooksLikeNoteEditRequest, mnMentionsThreadNote, mnAssistantAskedForActionDetail, mnBuildContextualActionQuery, mnAiCurrentNoteMarkdown, mnAiMarkdownMarkers, mnAiMissingMarkdownMarkers, mnAiBuildMarkdownPreview, mnAiShouldShareCurrentContext, mnWantsZoteroAssistedNoteEdit, mnWantsZoteroSummaryNote, mnAiCurrentContextMessage, mnAiVirtualToolMeta, mnAiCleanVirtualToolArgs, mnAiToolCallsFromPlanResult };
