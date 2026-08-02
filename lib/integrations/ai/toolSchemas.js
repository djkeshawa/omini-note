const { restorePiiText } = require('../../aiPii');

const MAX_TOOLS = 100;
const MAX_CALLS = 8;
const MAX_SCHEMA_DEPTH = 8;
const TOOL_NAME_RE = /^[A-Za-z0-9_-]{1,64}$/;

function sanitizeToolSchema(schema, depth = 0) {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema) || depth > MAX_SCHEMA_DEPTH) {
    return { type: 'object', additionalProperties: false };
  }
  const out = {};
  const copyString = (key, max = 500) => {
    if (schema[key] !== undefined && schema[key] !== null) out[key] = String(schema[key]).slice(0, max);
  };
  copyString('type', 40);
  copyString('description', 500);
  copyString('default', 500);
  if (typeof schema.maxLength === 'number') out.maxLength = Math.max(1, Math.min(20000, Math.round(schema.maxLength)));
  if (typeof schema.minimum === 'number') out.minimum = schema.minimum;
  if (typeof schema.maximum === 'number') out.maximum = schema.maximum;
  if (Array.isArray(schema.enum)) out.enum = schema.enum.slice(0, 80).map(value => String(value).slice(0, 160));
  if (Array.isArray(schema.required)) out.required = schema.required.map(value => String(value || '').trim()).filter(Boolean).slice(0, 80);
  if (schema.items) out.items = sanitizeToolSchema(schema.items, depth + 1);
  if (schema.properties && typeof schema.properties === 'object' && !Array.isArray(schema.properties)) {
    out.properties = {};
    for (const [key, value] of Object.entries(schema.properties).slice(0, 120)) {
      if (/^[A-Za-z0-9_-]{1,80}$/.test(key)) out.properties[key] = sanitizeToolSchema(value, depth + 1);
    }
  }
  if (Object.prototype.hasOwnProperty.call(schema, 'additionalProperties')) out.additionalProperties = schema.additionalProperties === true;
  if (!out.type && out.properties) out.type = 'object';
  if (!out.type) out.type = 'string';
  if (out.type === 'object' && !out.properties) out.properties = {};
  if (out.type === 'object' && out.additionalProperties === undefined) out.additionalProperties = false;
  return out;
}

function sanitizeAiTools(tools = []) {
  return (Array.isArray(tools) ? tools : []).map(tool => {
    const name = String(tool?.name || tool?.id || '').trim();
    if (!TOOL_NAME_RE.test(name)) return null;
    const title = String(tool.title || tool.label || name).trim().slice(0, 120);
    const description = String(tool.description || title || name).trim().slice(0, 1400);
    const risk = ['safe', 'confirm', 'destructive', 'external'].includes(tool.risk) ? tool.risk : 'safe';
    return {
      name,
      title,
      description,
      section: String(tool.section || '').trim().slice(0, 80),
      kind: String(tool.kind || '').trim().slice(0, 40),
      inputSchema: sanitizeToolSchema(tool.inputSchema || tool.input_schema || { type: 'object', additionalProperties: false }),
      outputSchema: sanitizeToolSchema(tool.outputSchema || tool.output_schema || { type: 'object', additionalProperties: true }),
      requires: (Array.isArray(tool.requires) ? tool.requires : []).map(item => String(item || '').trim().slice(0, 160)).filter(Boolean).slice(0, 8),
      examples: (Array.isArray(tool.examples) ? tool.examples : []).map(item => String(item || '').trim().slice(0, 240)).filter(Boolean).slice(0, 8),
      risk,
      readOnly: !!tool.readOnly,
      destructive: risk === 'destructive' || !!tool.destructive,
      external: risk === 'external' || !!tool.external,
      confirm: risk === 'confirm' || !!tool.confirm,
      idempotent: !!tool.idempotent,
    };
  }).filter(Boolean).slice(0, MAX_TOOLS);
}

function toolPlannerSystemPrompt() {
  return [
    'You are VispNote\'s chat agent and tool planner.',
    'Choose from the provided VispNote APIs and return tool calls when a tool can answer or perform the request.',
    'Use the provided tools to answer questions about notes, perform app actions, inspect notes, edit the current page, navigate the app, and run enabled plugin actions.',
    'When the tool list includes answer-notes and the user asks a specific question about vault content, latest notes, recent changes, latest updates, notes, pages, tasks, tags, decisions, dates, links, or backlinks, call answer-notes with the user query.',
    'When the tool list includes summarize-vault and the user explicitly asks to summarize, recap, or overview all notes, the whole vault, everything, or the entire notebook, call summarize-vault instead of answer-notes.',
    'Plugin APIs appear as plugin-* tools. Treat enabled plugin tools as part of the registered VispNote API surface.',
    'Answer directly only when the user asks a general question and no note/app/plugin tool is needed.',
    'Call tools when the user asks VispNote to do something. Do not claim you cannot call tools if an appropriate tool exists.',
    'Use read/search tools first if target details are missing. Use write tools only when the requested action and arguments are clear.',
    'For create-note and append-to-note requests, draft concise Markdown content in the tool arguments when the user asks for generated content.',
    'Use current note context for phrases such as this page, current note, it, or that when available.',
    'When answering directly, format intentionally: use markdown headings for section titles, bullets only for real list items, and short paragraphs for explanation.',
    'Emoji are allowed when they naturally improve tone or scanability, but do not overuse them.',
    'Do not invent tool names or arguments. Use only the provided JSON Schemas.',
    'If no tool is appropriate, answer briefly or ask for the missing detail.',
  ].join('\n');
}

function plannerToolCatalog(tools = []) {
  return (Array.isArray(tools) ? tools : []).map(tool => ({
    name: tool.name, title: tool.title, description: tool.description, section: tool.section,
    kind: tool.kind, risk: tool.risk, readOnly: !!tool.readOnly,
    input_schema: tool.inputSchema || tool.input_schema,
    output_schema: tool.outputSchema || tool.output_schema,
    requires: tool.requires || [], examples: tool.examples || [],
  }));
}

function fallbackToolPlannerMessages(messages, tools, feedback = '') {
  const conversation = messages.map(message => ({ role: message.role, content: String(message.content || '') }));
  return [
    {
      role: 'system',
      content: [
        toolPlannerSystemPrompt(),
        'Return only JSON in this exact shape:',
        '{"answer":"","toolCalls":[{"name":"tool_name","args":{},"reason":"short reason"}]}',
        'If no tool should be called, return {"answer":"brief answer or clarification","toolCalls":[]}.',
        feedback ? `Previous invalid output feedback: ${feedback}` : '',
      ].filter(Boolean).join('\n'),
    },
    {
      role: 'user',
      content: `Structured tool-planning input:\n${JSON.stringify({
        task: 'Select the best registered VispNote API call, or answer directly only when no tool applies.',
        available_apis: plannerToolCatalog(tools),
        conversation,
      }, null, 2)}`,
    },
  ];
}

// A plan is an object. Handing back an array or a scalar lets callers pass the
// `if (parsed)` check and then find no .toolCalls and no .answer, so the request
// silently resolves to "nothing to do" instead of being retried as bad JSON.
function asPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function parseJsonObject(text) {
  const raw = String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  if (!raw) return null;
  try {
    const direct = asPlainObject(JSON.parse(raw));
    if (direct) return direct;
  } catch {}
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try { return asPlainObject(JSON.parse(match[0])); } catch { return null; }
}

function restorePiiDeep(value, replacements = []) {
  if (!replacements.length) return value;
  if (typeof value === 'string') return restorePiiText(value, replacements);
  if (Array.isArray(value)) return value.map(item => restorePiiDeep(item, replacements));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, restorePiiDeep(item, replacements)]));
  return value;
}

function parseToolArgs(value, replacements = []) {
  let args = {};
  if (typeof value === 'string') {
    // The same guard as the object branch below. The tool runner indexes into
    // args, so an array, a scalar or null must not reach it -- `null` in
    // particular turns the first property read into a TypeError.
    try { args = asPlainObject(value.trim() ? JSON.parse(value) : {}) || {}; } catch { args = {}; }
  } else if (value && typeof value === 'object' && !Array.isArray(value)) args = value;
  return restorePiiDeep(args, replacements);
}

function normalizeToolCalls(calls = [], replacements = []) {
  return (Array.isArray(calls) ? calls : []).map((call, index) => {
    const name = String(call?.name || call?.tool || call?.function?.name || '').trim();
    if (!TOOL_NAME_RE.test(name)) return null;
    return {
      id: String(call.id || call.toolUseId || `tool_${index + 1}`).slice(0, 120),
      name,
      args: parseToolArgs(call.args ?? call.input ?? call.function?.arguments ?? {}, replacements),
      reason: String(call.reason || '').slice(0, 500),
    };
  }).filter(Boolean).slice(0, MAX_CALLS);
}

function openAiToolDefinitions(tools) {
  return tools.map(tool => ({ type: 'function', function: { name: tool.name, description: tool.description, parameters: tool.inputSchema } }));
}

function anthropicToolDefinitions(tools) {
  return tools.map(tool => ({ name: tool.name, description: tool.description, input_schema: tool.inputSchema }));
}

function geminiToolDefinitions(tools) {
  return [{ functionDeclarations: tools.map(tool => ({ name: tool.name, description: tool.description, parameters: tool.inputSchema })) }];
}

module.exports = {
  anthropicToolDefinitions,
  fallbackToolPlannerMessages,
  geminiToolDefinitions,
  normalizeToolCalls,
  openAiToolDefinitions,
  parseJsonObject,
  sanitizeAiTools,
  sanitizeToolSchema,
  toolPlannerSystemPrompt,
};
