export const BASE_SLASH_COMMANDS = [
  { id: 'h1', label: 'Heading 1', hint: 'Large section title', kbd: '#', icon: 'H1', kind: 'heading', level: 1 },
  { id: 'h2', label: 'Heading 2', hint: 'Medium section title', kbd: '##', icon: 'H2', kind: 'heading', level: 2 },
  { id: 'h3', label: 'Heading 3', hint: 'Subsection', kbd: '###', icon: 'H3', kind: 'heading', level: 3 },
  { id: 'p', label: 'Paragraph', hint: 'Plain text', kbd: '', icon: '¶', kind: 'paragraph' },
  { id: 'bullet', label: 'Bullet', hint: 'List item', kbd: '-', icon: '•', kind: 'bullet' },
  { id: 'todo', label: 'To-do', hint: 'Task with checkbox', kbd: '[ ]', icon: '☐', kind: 'todo', checked: false },
  { id: 'quote', label: 'Quote', hint: 'Blockquote', kbd: '>', icon: '❝', kind: 'quote' },
  { id: 'code', label: 'Code block', hint: 'Monospaced fenced', kbd: '```', icon: '{}', kind: 'code' },
  { id: 'table', label: 'Table', hint: 'Markdown table', kbd: '|', icon: '▦', kind: 'table', content: '| Column 1 | Column 2 |\n| --- | --- |\n|  |  |' },
  { id: 'div', label: 'Divider', hint: 'Horizontal rule', kbd: '---', icon: '—', kind: 'divider' },
  { id: 'canvas', label: 'Attach canvas', hint: 'Embed an existing or new canvas', kbd: '/canvas', icon: '□', canvasAction: true },
  { id: 'link', label: 'Link to note', hint: 'Wiki-link to a note', kbd: '[[', icon: '⇉', insert: '[[' },
  { id: 'tag', label: 'Tag', hint: 'Categorize', kbd: '#tag', icon: '#', insert: '#' },
  { id: 'block-label', label: 'Label', hint: 'Add attention label to this block', kbd: '/label', icon: 'Lbl', blockLabelAction: true },
  {
    id: 'date', label: "Today's date", hint: 'Insert YYYY-MM-DD', kbd: '@today', icon: '☉',
    insertFn: () => {
      const date = new Date();
      return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    },
  },
  { id: 'remind', label: 'Reminder', hint: 'Schedule reminder', kbd: '@remind', icon: '⏰', insertFn: () => window.MN_REMIND?.defaultText?.() || '@remind YYYY-MM-DD 09:00 ' },
  { id: 'ai-improve-page', label: 'AI: Improve writing on this page', hint: 'Rewrite the whole page body', kbd: '/ai improve', icon: '✦', aiAction: 'improve', aiScope: 'page' },
  { id: 'ai-format-page', label: 'AI: Format this page', hint: 'Clean up the whole page body', kbd: '/ai format', icon: 'AI', aiAction: 'format', aiScope: 'page' },
  { id: 'ai-summarize-page', label: 'AI: Summarize this page', hint: 'Replace page body with a summary', kbd: '/ai summary', icon: 'Σ', aiAction: 'summarize', aiScope: 'page' },
  { id: 'ai-concise-page', label: 'AI: Make this page concise', hint: 'Shorten the whole page body', kbd: '/ai concise', icon: '↘', aiAction: 'concise', aiScope: 'page' },
  { id: 'ai-fix-page', label: 'AI: Fix spelling on this page', hint: 'Correct the whole page body', kbd: '/ai fix', icon: '✓', aiAction: 'fix', aiScope: 'page' },
  { id: 'ai-write-section', label: 'AI: Write in this section', hint: 'Preview generated text before applying', kbd: '/ai write', icon: '+', aiAction: 'write', aiScope: 'section' },
];

const NOVELIST_SLASH_COMMANDS = [
  { id: 'plot-points', label: 'Plot Points', hint: 'Scene beats and context', kbd: '/plot points', icon: '~', kind: 'plot-points', content: 'Plot Points', beats: ['Opening beat'], contexts: [] },
];

function workflowSlashCommands() {
  const states = window.MN_LOGSEQ?.WORKFLOW_STATES || [];
  return states.map(state => ({
    id: `wf-${String(state.id || '').toLowerCase()}`,
    label: `Marker: ${state.id}`,
    hint: `Add a block marker for ${state.id.toLowerCase()}`,
    kbd: `/${state.id}`,
    icon: String(state.id || '?').slice(0, 1),
    workflow: state.id,
  }));
}

export function slashCommands(options = {}) {
  return [
    ...BASE_SLASH_COMMANDS,
    ...(options.novelistMode ? NOVELIST_SLASH_COMMANDS : []),
    ...workflowSlashCommands(),
  ];
}

export function findSlashCommandTrigger(text, cursor) {
  const before = text.slice(0, cursor);
  const match = before.match(/(^|[^A-Za-z0-9_])\/([A-Za-z0-9-]*)$/);
  if (!match) return null;
  return { query: match[2], start: before.length - match[2].length - 1, end: cursor };
}

export function slashCommandScore(command, query) {
  const normalized = (query || '').toLowerCase();
  if (!normalized) return 100;
  const label = command.label.toLowerCase();
  const id = command.id.toLowerCase();
  const hint = command.hint.toLowerCase();
  const shortcut = (command.kbd || '').replace(/^\//, '').toLowerCase();
  if (label === normalized || id === normalized || shortcut === normalized) return 0;
  if (label.startsWith(normalized) || id.startsWith(normalized) || shortcut.startsWith(normalized)) return 10;
  if (hint.includes(normalized)) return 50;
  if (label.includes(normalized) || id.includes(normalized)) return 60;
  return Infinity;
}
