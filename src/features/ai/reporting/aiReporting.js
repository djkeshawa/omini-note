import { platformApi } from '../../../platform/index.js';

export const AI_REPORT_TARGETS = {
  openai: { label: 'OpenAI', url: 'https://help.openai.com/en/articles/10245791-reporting-content-in-chatgpt-and-openai-platforms' },
  openrouter: { label: 'OpenRouter', url: 'https://openrouter.ai/docs/guides/overview/report-feedback' },
  anthropic: { label: 'Anthropic', url: 'mailto:usersafety@anthropic.com?subject=AI%20safety%20feedback' },
  gemini: { label: 'Gemini', url: 'https://support.google.com/gemini/answer/13275746' },
  ollama: { label: 'Ollama or local model provider', url: 'https://github.com/ollama/ollama/issues' },
  custom: { label: 'Custom provider', url: '' },
};

async function providerReportInfo() {
  let config = null;
  try {
    const status = await platformApi.ai.status?.();
    config = status?.value?.config || null;
  } catch (_error) {}
  if (!config) {
    try {
      const response = await platformApi.ai.getConfig?.();
      config = response?.value || null;
    } catch (_error) {}
  }
  const provider = String(config?.provider || 'ollama').toLowerCase();
  const target = AI_REPORT_TARGETS[provider] || AI_REPORT_TARGETS.custom;
  let url = target.url;
  if (!url && provider === 'custom') {
    try {
      url = new URL(String(config?.customBaseUrl || '').trim()).origin;
    } catch (_error) {}
  }
  return { provider, label: target.label, model: config?.chatModel || '', url };
}

export async function reportAiOutput({ prompt = '', output = '', scope = 'AI output' } = {}) {
  const info = await providerReportInfo();
  const report = [
    `Provider: ${info.label}`,
    info.model ? `Model: ${info.model}` : null,
    `Scope: ${scope}`,
    prompt ? `Prompt:\n${String(prompt).slice(0, 4000)}` : null,
    output ? `Generated output:\n${String(output).slice(0, 8000)}` : null,
  ].filter(Boolean).join('\n\n');
  try { await navigator.clipboard?.writeText(report); } catch (_error) {}
  if (info.url && platformApi.available) {
    const response = await platformApi.app.openExternal(info.url);
    if (response && response.ok === false) throw new Error(response.error || 'Could not open provider report page');
  }
  return info;
}
