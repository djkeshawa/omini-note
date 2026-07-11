const NOVEL_IMPORT_TOOL = {
  name: 'propose-novel-import',
  title: 'Propose novel import notes',
  description: 'Return structured novelist notes extracted from imported text files.',
  readOnly: true,
  inputSchema: {
    type: 'object', additionalProperties: false,
    properties: { notes: { type: 'array', items: {
      type: 'object', additionalProperties: false,
      properties: {
        title: { type: 'string' }, kind: { type: 'string', enum: ['act', 'chapter', 'scene', 'character', 'location', 'plot', 'research', 'revision'] },
        body: { type: 'string' }, actTitle: { type: 'string' }, chapterTitle: { type: 'string' }, order: { type: 'string' },
        pov: { type: 'string' }, purpose: { type: 'string' }, sourceFile: { type: 'string' }, confidence: { type: 'string' },
        plotPoints: { type: 'array', items: { type: 'string' } },
      }, required: ['title', 'kind', 'body'],
    } } },
    required: ['notes'],
  },
};

function novelImportChunks(files = [], maxChars = 11000) {
  const chunks = [];
  for (const file of files || []) {
    const text = String(file?.text || '');
    for (let start = 0; start < text.length; start += maxChars) {
      chunks.push({ fileName: file.name || 'imported-file', index: Math.floor(start / maxChars) + 1, text: text.slice(start, start + maxChars) });
    }
  }
  return chunks.filter(chunk => chunk.text.trim());
}

function novelImportExistingSummary(notes = []) {
  return (notes || []).filter(note => (note.tags || []).some(tag => String(tag || '').startsWith('novel-')))
    .slice(0, 50).map(note => `- ${String(note.title || 'Untitled').slice(0, 80)} [${(note.tags || []).join(', ')}]`).join('\n');
}

function novelImportExtractionPrompt(chunk, existingSummary) {
  return ['Analyze this imported novel file chunk and call the propose-novel-import tool.',
    'Classify content as story structure, story draft, or supporting notes.',
    'Use kind=act/chapter/scene for actual story structure or prose.',
    'Use kind=character/location/plot/research/revision for supporting details.',
    'If the chunk has both story and support material, return both.',
    'Do not invent facts. Keep bodies concise but useful.', 'Use existing titles when they clearly match.', '',
    'Existing novelist notes:', existingSummary || '- None', '', `Source file: ${chunk.fileName} (chunk ${chunk.index})`, 'Text:', chunk.text].join('\n');
}

function novelImportConsolidationPrompt(candidates, existingSummary) {
  return ['Consolidate these extracted novelist import candidates and call propose-novel-import.',
    'Merge duplicates, preserve useful details, and keep act/chapter/scene relationships.',
    'Return only candidates that should become or update app notes.', '', 'Existing novelist notes:', existingSummary || '- None', '',
    'Candidates JSON:', JSON.stringify({ notes: candidates })].join('\n');
}

function novelImportToolArgs(response) {
  if (!response || response.ok === false) throw new Error(response?.error || 'AI import analysis failed.');
  const value = response.value || response;
  if (value.ok === false) throw new Error(value.error || 'AI import analysis failed.');
  const call = (value.toolCalls || []).find(item => item.name === 'propose-novel-import') || (value.toolCalls || [])[0];
  if (call?.args && typeof call.args === 'object') return call.args;
  const answer = String(value.answer || '').trim();
  if (answer.startsWith('{')) { try { return JSON.parse(answer); } catch {} }
  return { notes: [] };
}

export {
  NOVEL_IMPORT_TOOL, novelImportChunks, novelImportExistingSummary,
  novelImportExtractionPrompt, novelImportConsolidationPrompt, novelImportToolArgs,
};
