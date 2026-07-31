import { mnReadNovelistAiConfig } from '../../panels/panelHelpers.js';
import { mnAiAction } from '../outlinerRenderers.jsx';

function createOutlinerAiInstructions({ noteTags, vaultId, allNotes }) {
  const readNovelistAiConfig = () => {
    if (!(noteTags || []).some(tag => String(tag || '').startsWith('novel-'))) return null;
    const config = mnReadNovelistAiConfig(vaultId);
    if (!config) return null;
    return {
      wordLimit: config.wordLimit,
      defaultPromptId: config.defaultPromptId,
      model: config.model || '',
      systemMessage: config.systemMessage || '',
      userMessage: config.userMessage || '',
      instructions: config.instructions || '',
      additionalContext: config.additionalContext || '',
      includedComponents: config.includedComponents || {},
      advanced: config.advanced || {},
      prompts: Array.isArray(config.prompts) ? config.prompts : [],
    };
  };

  const activeNovelistPrompt = (novelConfig) => (
    (novelConfig?.prompts || []).find(item => item.id === novelConfig.defaultPromptId)
      || (novelConfig?.prompts || []).find(item => item.prompt)
  );

  const novelistInstructionContext = () => {
    const novelConfig = readNovelistAiConfig();
    const activePrompt = activeNovelistPrompt(novelConfig);
    return [
      novelConfig?.wordLimit ? `Target length: up to ${novelConfig.wordLimit} words unless the user asks otherwise.` : null,
      activePrompt?.prompt ? `Novelist writing prompt (${activePrompt.name || 'Default'}):\n${activePrompt.prompt}` : null,
      novelConfig?.instructions ? `Vault instructions:\n${novelConfig.instructions}` : null,
      novelConfig?.additionalContext ? `Additional context:\n${novelConfig.additionalContext}` : null,
      novelConfig?.userMessage ? `User message template:\n${novelConfig.userMessage}` : null,
    ];
  };

  const writeInstruction = (scope, userRequest, sourceText) => [
    ...novelistInstructionContext(),
    mnAiAction('write').instruction,
    `User request: ${userRequest}`,
    sourceText?.trim()
      ? 'Use the existing text below as local context. Replace it with the newly written text.'
      : 'Write new text for this empty location.',
  ].filter(Boolean).join('\n\n');

  const pageContinuationInstruction = (userRequest, sourceText) => [
    ...novelistInstructionContext(),
    'Write new markdown that continues the existing page.',
    `User request: ${userRequest}`,
    sourceText?.trim()
      ? 'Use the full existing page below as context. Continue from the end of it. Do not repeat, summarize, move, or rewrite the existing content. Return only the new markdown that should be appended below the current last block.'
      : 'The page is empty. Return only the new markdown for the page.',
  ].filter(Boolean).join('\n\n');

  const plotPointsContextText = (block) => {
    const titles = new Set(
      (block.contexts || [])
        .map(context => String(context || '').replace(/^\[\[|\]\]$/g, '').trim().toLowerCase())
        .filter(Boolean)
    );
    if (!titles.size) return '';
    return (allNotes || [])
      .filter(note => titles.has(String(note?.title || '').trim().toLowerCase()))
      .slice(0, 8)
      .map(note => `[[${note.title}]]\n${String(note.body || '').slice(0, 2500)}`)
      .join('\n\n');
  };

  const plotPointsInstruction = (plotAction, userRequest, sourceText, contextText = '', pageText = '') => {
    const task = plotAction === 'write-scene'
      ? 'Write the scene prose from these plot points.'
      : plotAction === 'improve'
        ? 'Turn these plot points into a clearer, more useful scene plan.'
        : 'Summarize these plot points into concise scene planning notes.';
    return [
      ...novelistInstructionContext(),
      task,
      'Use the beat lines and linked context pages as source material. Do not rewrite the Plot Points block itself.',
      plotAction === 'write-scene' && pageText?.trim()
        ? 'Continue from the end of the existing page. Do not insert content above existing draft text, repeat existing prose, summarize it, or rewrite it.'
        : null,
      userRequest?.trim() ? `User request: ${userRequest.trim()}` : null,
      plotAction === 'write-scene'
        ? 'Return only markdown that should be appended to the bottom of the page after the user approves it.'
        : 'Return only markdown that should be inserted below the Plot Points block after the user approves it.',
      sourceText?.trim() ? `Plot Points source:\n${sourceText}` : null,
      contextText?.trim() ? `Linked context pages:\n${contextText}` : null,
      pageText?.trim() ? `Existing page context:\n${pageText}` : null,
    ].filter(Boolean).join('\n\n');
  };

  return {
    pageContinuationInstruction,
    plotPointsContextText,
    plotPointsInstruction,
    readNovelistAiConfig,
    writeInstruction,
  };
}

export { createOutlinerAiInstructions };
