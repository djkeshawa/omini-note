function createMetadataModels({ cleanString, isPlainObject, validateNoteId }) {
  function normalizeTagName(name) {
    return String(name || '').trim().toLowerCase().replace(/^#+/, '')
      .replace(/\s+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64);
  }

  function normalizeTags(tags) {
    if (!Array.isArray(tags)) return [];
    const seen = new Set();
    return tags.map(tag => {
      const name = normalizeTagName(typeof tag === 'string' ? tag : tag?.name);
      if (!name || seen.has(name)) return null;
      seen.add(name);
      const hue = Number(tag?.hue);
      return { name, hue: Number.isFinite(hue) ? Math.max(0, Math.min(360, hue)) : 240 };
    }).filter(Boolean);
  }

  function normalizeWorkflowId(raw) {
    return String(raw || '').trim().toUpperCase().replace(/[^A-Z0-9_-]+/g, '-')
      .replace(/^-+|-+$/g, '').slice(0, 18);
  }

  function normalizeWorkflowStates(states) {
    if (states === null || states === undefined) return null;
    if (!Array.isArray(states)) throw new Error('Invalid workflow states');
    const seen = new Set();
    const next = states.map(state => {
      const id = normalizeWorkflowId(typeof state === 'string' ? state : state?.id);
      if (!id || seen.has(id)) return null;
      seen.add(id);
      const normalized = { id };
      if (typeof state?.color === 'string') normalized.color = state.color.slice(0, 80);
      if (typeof state?.bg === 'string') normalized.bg = state.bg.slice(0, 80);
      if (Object.prototype.hasOwnProperty.call(state || {}, 'next')) normalized.next = state.next ? normalizeWorkflowId(state.next) || null : null;
      return normalized;
    }).filter(Boolean);
    const validIds = new Set(next.map(state => state.id));
    return next.map(state => ({ ...state, next: state.next && validIds.has(state.next) ? state.next : (state.next === undefined ? undefined : null) }));
  }

  function sanitizeNovelistAiConfig(raw) {
    if (raw == null) return null;
    if (!isPlainObject(raw)) throw new Error('Invalid novelist AI config patch');
    const text = (value, max = 5000) => cleanString(value, '', max);
    const parsedLimit = Number(raw.wordLimit);
    const maxTokens = Number(raw.advanced?.maxTokens);
    const temperature = Number(raw.advanced?.temperature);
    const prompts = Array.isArray(raw.prompts) ? raw.prompts.map((prompt, index) => ({
      id: cleanString(prompt?.id || `prompt-${index + 1}`, `prompt-${index + 1}`, 80).replace(/[^a-zA-Z0-9_-]+/g, '-'),
      name: text(prompt?.name, 120), prompt: text(prompt?.prompt ?? prompt?.text, 5000),
    })).filter(prompt => prompt.prompt).slice(0, 12) : [];
    const modelCollections = Array.isArray(raw.modelCollections) ? raw.modelCollections.map((collection, index) => ({
      id: cleanString(collection?.id || `collection-${index + 1}`, `collection-${index + 1}`, 80).replace(/[^a-zA-Z0-9_-]+/g, '-'),
      name: text(collection?.name, 120),
      models: Array.isArray(collection?.models) ? collection.models.map(model => text(model, 120)).filter(Boolean).slice(0, 24) : [],
    })).slice(0, 8) : [];
    return {
      version: 2, preset: text(raw.preset, 120), modelCollections,
      activeModelCollectionId: text(raw.activeModelCollectionId, 80), model: text(raw.model, 120),
      promptType: text(raw.promptType, 80), moderation: raw.moderation !== false,
      wordLimit: Number.isFinite(parsedLimit) ? Math.min(12000, Math.max(100, Math.round(parsedLimit))) : undefined,
      instructions: text(raw.instructions, 10000), additionalContext: text(raw.additionalContext, 10000),
      includedComponents: isPlainObject(raw.includedComponents) ? {
        plotPoints: raw.includedComponents.plotPoints !== false,
        selectedContext: raw.includedComponents.selectedContext !== false,
        noteBody: raw.includedComponents.noteBody !== false,
        storyStructure: raw.includedComponents.storyStructure !== false,
      } : undefined,
      systemMessage: text(raw.systemMessage, 5000), userMessage: text(raw.userMessage, 5000),
      advanced: {
        temperature: Number.isFinite(temperature) ? Math.max(0, Math.min(2, temperature)) : '',
        maxTokens: Number.isFinite(maxTokens) ? Math.max(128, Math.min(8192, Math.round(maxTokens))) : '',
      },
      defaultPromptId: text(raw.defaultPromptId, 80), prompts,
    };
  }

  function sanitizeVaultMetaPatch(patch) {
    if (!isPlainObject(patch)) throw new Error('Invalid vault metadata patch');
    const allowed = new Set(['tags', 'lastSelectedId', 'novelistMode', 'workflowStates', 'novelistAiConfig']);
    const unknown = Object.keys(patch).filter(key => !allowed.has(key));
    if (unknown.length) throw new Error('Unsupported vault metadata field: ' + unknown[0]);
    const next = {};
    if (Object.prototype.hasOwnProperty.call(patch, 'tags')) next.tags = normalizeTags(patch.tags);
    if (Object.prototype.hasOwnProperty.call(patch, 'lastSelectedId')) next.lastSelectedId = patch.lastSelectedId ? validateNoteId(patch.lastSelectedId) : null;
    if (Object.prototype.hasOwnProperty.call(patch, 'novelistMode')) next.novelistMode = !!patch.novelistMode;
    if (Object.prototype.hasOwnProperty.call(patch, 'workflowStates')) next.workflowStates = normalizeWorkflowStates(patch.workflowStates);
    if (Object.prototype.hasOwnProperty.call(patch, 'novelistAiConfig')) next.novelistAiConfig = patch.novelistAiConfig == null ? null : sanitizeNovelistAiConfig(patch.novelistAiConfig);
    return next;
  }

  return { normalizeTagName, normalizeTags, normalizeWorkflowStates, sanitizeNovelistAiConfig, sanitizeVaultMetaPatch };
}

module.exports = { createMetadataModels };
