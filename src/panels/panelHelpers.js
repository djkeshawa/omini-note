import { storage } from '../shared/storageUtils.js';

const MN_NOVELIST_AI_CONFIG_KEY = 'mn_novelist_ai_config_v2';
const MN_NOVELIST_AI_CONFIG_LEGACY_KEY = 'mn_novelist_ai_config_v1';

function mnNovelistAiConfigKey(vaultId = '') {
  const cleanVaultId = String(vaultId || '').trim();
  return cleanVaultId ? `${MN_NOVELIST_AI_CONFIG_KEY}:${cleanVaultId}` : MN_NOVELIST_AI_CONFIG_KEY;
}

function mnNovelistLegacyAiConfigKey(vaultId = '') {
  const cleanVaultId = String(vaultId || '').trim();
  return cleanVaultId ? `${MN_NOVELIST_AI_CONFIG_LEGACY_KEY}:${cleanVaultId}` : MN_NOVELIST_AI_CONFIG_LEGACY_KEY;
}

function mnDefaultNovelistAiPrompts() {
  return [
    {
      id: 'write-novel',
      name: 'AI write novel',
      prompt: 'Write polished novel prose from the selected story notes. Preserve continuity, point of view, tense, and the established character voices.',
    },
    {
      id: 'continue-draft',
      name: 'Continue draft',
      prompt: 'Continue the current scene from the last paragraph. Keep the same voice, pacing, and emotional direction.',
    },
    {
      id: 'revise-prose',
      name: 'Revise prose',
      prompt: 'Revise the selected prose for clarity, rhythm, and stronger sensory detail without changing story facts.',
    },
  ];
}

function mnNormalizeNovelistAiConfig(raw) {
  const defaults = {
    version: 2,
    preset: 'Balanced draft',
    modelCollections: [
      { id: 'local', name: 'Local', models: ['gemma3', 'llama3.1', 'mistral'] },
      { id: 'cloud', name: 'Cloud', models: ['gpt-4o-mini', 'openai/gpt-4o-mini', 'claude-3-5-haiku-latest'] },
    ],
    activeModelCollectionId: 'local',
    model: '',
    promptType: 'draft',
    moderation: true,
    wordLimit: 800,
    instructions: '',
    additionalContext: '',
    includedComponents: { plotPoints: true, selectedContext: true, noteBody: true, storyStructure: true },
    systemMessage: 'You are a careful novelist assistant. Preserve continuity, point of view, tense, and established character voices.',
    userMessage: 'Use the current scene, plot points, and selected context to help draft or revise the novel text.',
    advanced: { temperature: '', maxTokens: '' },
    prompts: mnDefaultNovelistAiPrompts(),
  };
  const parsedLimit = Number(raw?.wordLimit);
  const wordLimit = Number.isFinite(parsedLimit)
    ? Math.min(12000, Math.max(100, Math.round(parsedLimit)))
    : defaults.wordLimit;
  const included = raw?.includedComponents && typeof raw.includedComponents === 'object'
    ? { ...defaults.includedComponents, ...raw.includedComponents }
    : defaults.includedComponents;
  const advanced = raw?.advanced && typeof raw.advanced === 'object'
    ? { ...defaults.advanced, ...raw.advanced }
    : defaults.advanced;
  const modelCollections = Array.isArray(raw?.modelCollections) && raw.modelCollections.length
    ? raw.modelCollections.map((collection, index) => ({
      id: String(collection?.id || `collection-${index + 1}`),
      name: String(collection?.name || `Collection ${index + 1}`),
      models: Array.isArray(collection?.models)
        ? collection.models.map(model => String(model || '').trim()).filter(Boolean).slice(0, 24)
        : [],
    })).slice(0, 8)
    : defaults.modelCollections;
  const sourcePrompts = Array.isArray(raw?.prompts) ? raw.prompts : defaults.prompts;
  const prompts = sourcePrompts
    .map((item, index) => ({
      id: String(item?.id || `prompt-${index + 1}`),
      name: String(item?.name || '').trim(),
      prompt: String(item?.prompt ?? item?.text ?? ''),
    }))
    .slice(0, 12);
  const requestedDefault = String(raw?.defaultPromptId || '').trim();
  const defaultPromptId = prompts.some(item => item.id === requestedDefault)
    ? requestedDefault
    : prompts[0]?.id || '';
  return {
    version: 2,
    preset: String(raw?.preset || defaults.preset),
    modelCollections,
    activeModelCollectionId: String(raw?.activeModelCollectionId || modelCollections[0]?.id || ''),
    model: String(raw?.model || ''),
    promptType: String(raw?.promptType || 'draft'),
    moderation: raw?.moderation === false ? false : true,
    wordLimit,
    instructions: String(raw?.instructions ?? ''),
    additionalContext: String(raw?.additionalContext ?? ''),
    includedComponents: included,
    systemMessage: String(raw?.systemMessage || defaults.systemMessage),
    userMessage: String(raw?.userMessage || defaults.userMessage),
    advanced,
    defaultPromptId,
    prompts,
  };
}

function mnReadNovelistAiConfig(vaultId = '') {
  const saved = storage.getJson(mnNovelistAiConfigKey(vaultId), null);
  if (saved) return mnNormalizeNovelistAiConfig(saved);
  const legacy = storage.getJson(mnNovelistLegacyAiConfigKey(vaultId), null);
  return mnNormalizeNovelistAiConfig(legacy || null);
}

function mnWriteNovelistAiConfig(config, vaultId = '') {
  if (!config) {
    storage.remove(mnNovelistAiConfigKey(vaultId));
    return;
  }
  storage.setJson(mnNovelistAiConfigKey(vaultId), config);
}


export {
  MN_NOVELIST_AI_CONFIG_KEY, MN_NOVELIST_AI_CONFIG_LEGACY_KEY,
  mnDefaultNovelistAiPrompts, mnNormalizeNovelistAiConfig, mnNovelistAiConfigKey,
  mnNovelistLegacyAiConfigKey, mnReadNovelistAiConfig, mnWriteNovelistAiConfig,
};
