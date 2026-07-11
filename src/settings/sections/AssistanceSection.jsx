import { H, SettingsCard, Row, Segmented, Toggle, Select, FontSizeStepper } from '../settingsControls.jsx';
import { platformApi } from '../../platform/index.js';
import { uniqueOptions, mnAiInput, mnSettingsInput } from '../settingsPrimitives.jsx';
const { useState: useStateS, useEffect: useEffectS, useRef: useRefS } = React;

const MN_AI_PROVIDERS = [
  {
    id: 'ollama',
    label: 'Ollama',
    sub: 'Local models on this machine',
    badge: 'Local',
    defaultModel: 'gemma3',
    baseField: 'ollamaHost',
    baseDefault: 'http://127.0.0.1:11434',
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    sub: 'Route through many hosted models',
    badge: 'Cloud',
    keyField: 'openrouterApiKey',
    baseField: 'openrouterBaseUrl',
    baseDefault: 'https://openrouter.ai/api/v1',
    defaultModel: 'openai/gpt-4o-mini',
  },
  {
    id: 'openai',
    label: 'OpenAI',
    sub: 'OpenAI chat completions',
    badge: 'Cloud',
    keyField: 'openaiApiKey',
    baseField: 'openaiBaseUrl',
    baseDefault: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4o-mini',
  },
  {
    id: 'anthropic',
    label: 'Anthropic',
    sub: 'Claude Messages API',
    badge: 'Cloud',
    keyField: 'anthropicApiKey',
    baseField: 'anthropicBaseUrl',
    baseDefault: 'https://api.anthropic.com',
    defaultModel: 'claude-sonnet-4-5-20250929',
  },
  {
    id: 'gemini',
    label: 'Gemini',
    sub: 'Google Gemini API',
    badge: 'Cloud',
    keyField: 'geminiApiKey',
    baseField: 'geminiBaseUrl',
    baseDefault: 'https://generativelanguage.googleapis.com/v1beta',
    defaultModel: 'gemini-2.5-flash',
  },
  {
    id: 'custom',
    label: 'Custom',
    sub: 'OpenAI-compatible endpoint',
    badge: 'Custom',
    keyField: 'customApiKey',
    baseField: 'customBaseUrl',
    baseDefault: '',
    defaultModel: '',
  },
];

function mnAiProviderMeta(id) {
  return MN_AI_PROVIDERS.find(p => p.id === id) || MN_AI_PROVIDERS[0];
}

function SectionAI({ T, assistanceEnabled = false, onAssistanceChange }) {
  const [config, setConfig] = useStateS(null);
  const [status, setStatus] = useStateS(null);
  const [busy, setBusy] = useStateS(false);
  const [message, setMessage] = useStateS('');

  const load = async () => {
    if (!platformApi.ai) return;
    setBusy(true);
    try {
      const cfg = await platformApi.ai.getConfig();
      if (cfg.ok) setConfig({ ...cfg.value, enabled: assistanceEnabled });
      const st = await platformApi.ai.status();
      if (st.ok) setStatus(st.value);
    } finally {
      setBusy(false);
    }
  };

  useEffectS(() => { load(); }, []);

  const save = async (patch, refresh = true) => {
    const next = { ...(config || {}), ...patch };
    setConfig(next);
    setMessage('');
    if (!platformApi.ai) return;
    const res = await platformApi.ai.setConfig(patch);
    if (res.ok) {
      setConfig(res.value);
      if (Object.prototype.hasOwnProperty.call(patch, 'enabled')) onAssistanceChange?.(res.value?.enabled === true);
    }
    else setMessage(res.error || 'Could not save AI settings');
    if (refresh) {
      const st = await platformApi.ai.status();
      if (st.ok) setStatus(st.value);
    }
  };

  const selectProvider = (providerId) => {
    const meta = mnAiProviderMeta(providerId);
    const patch = {
      provider: providerId,
      chatModel: meta.defaultModel || config?.chatModel || '',
    };
    if (meta.baseField && config?.[meta.baseField] == null && meta.baseDefault) patch[meta.baseField] = meta.baseDefault;
    save(patch, true);
  };

  const connect = async () => {
    if (!platformApi.ai) return;
    setBusy(true);
    setMessage('Connecting to Ollama...');
    try {
      const res = await platformApi.ai.connect();
      if (res.ok) {
        setStatus(res.value);
        setConfig(res.value.config || config);
        setMessage(res.value.reachable
          ? 'Connected to Ollama.'
          : (res.value.connectError || res.value.reason || 'Could not connect to Ollama.'));
      } else {
        setMessage(res.error || 'Could not connect.');
      }
    } finally {
      setBusy(false);
    }
  };

  const provider = config?.provider || 'ollama';
  const providerMeta = mnAiProviderMeta(provider);
  const models = status?.models || [];
  const chatOptions = uniqueOptions([config?.chatModel || 'gemma3', ...models]);
  const embedOptions = uniqueOptions([config?.embedModel || 'nomic-embed-text', ...models]);
  const reachable = !!status?.reachable;
  const providerReady = provider === 'ollama' ? reachable : !!status?.providerReady;
  const aiStatusText = provider === 'ollama'
    ? (reachable
      ? (status?.chatModelOk === false
        ? `Local chat setup needed. Install a model with: ollama pull ${status?.config?.chatModel || config?.chatModel}`
        : status?.embedModelOk === false
          ? (status?.embedModelReason || `${models.length} Ollama model${models.length === 1 ? '' : 's'} available. Ask AI will use keyword search until ${status?.config?.embedModel || config?.embedModel} is installed.`)
          : `${models.length} Ollama model${models.length === 1 ? '' : 's'} available`)
      : status?.reason || status?.connectError || 'Ollama is not responding yet.')
    : (providerReady
      ? `${providerMeta.label} is configured. Ask AI will use hosted chat with keyword/recent-note context.`
      : status?.reason || `${providerMeta.label} needs an API key and model.`);
  const showApiKey = !!providerMeta.keyField;
  const apiKeyValue = showApiKey ? (config?.[providerMeta.keyField] || '') : '';
  const apiKeyConfigured = apiKeyValue === 'configured';
  const apiKeyDirty = showApiKey ? !!config?.[`${providerMeta.keyField}Dirty`] : false;
  const baseValue = config?.[providerMeta.baseField] || providerMeta.baseDefault || '';
  const statusButtonLabel = busy
    ? 'Checking...'
    : providerReady
      ? (provider === 'ollama' ? 'Connected' : 'Ready')
      : (provider === 'ollama' ? 'Connect' : 'Check');

  return (
    <div>
      <H T={T} label="Assistance" sub="Optional AI that works with your notes and stays out of the way when disabled." />
      <SettingsCard T={T} style={{
        padding: 14,
        border: `1px solid ${providerReady ? T.success : T.lineSub}`,
        background: `linear-gradient(180deg, ${T.bgSub}, ${T.bg})`,
        marginBottom: 14,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{
            width: 9, height: 9, borderRadius: '50%',
            background: providerReady ? T.success : T.warn,
            boxShadow: providerReady ? `0 0 0 3px color-mix(in oklab, ${T.success} 14%, transparent)` : 'none',
          }} />
          <div style={{ flex: 1 }}>
            <div style={{ fontFamily: 'var(--mn-ui)', fontSize: 13, fontWeight: 600, color: T.ink }}>
              {providerReady ? `${providerMeta.label} ready` : `${providerMeta.label} not ready`}
            </div>
            <div style={{ fontFamily: 'var(--mn-body)', fontSize: 12, color: T.inkMed, marginTop: 2 }}>
              {aiStatusText}
            </div>
          </div>
          {provider === 'ollama' ? (
            <button onClick={connect} disabled={busy} style={{
              padding: '6px 12px',
              borderRadius: 6,
              border: `1px solid ${T.line}`,
              background: T.ink,
              color: T.bg,
              fontFamily: 'var(--mn-ui)',
              fontSize: 12,
              fontWeight: 500,
              cursor: busy ? 'not-allowed' : 'pointer',
              opacity: busy ? 0.6 : 1,
            }}>{statusButtonLabel}</button>
          ) : (
            <BtnOutline T={T} onClick={load} disabled={busy}>{statusButtonLabel}</BtnOutline>
          )}
        </div>
        {message && (
          <div style={{
            marginTop: 10,
            fontFamily: 'var(--mn-mono)',
            fontSize: 10.5,
            color: reachable ? T.success : T.inkDim,
          }}>{message}</div>
        )}
      </SettingsCard>

      <SettingsCard T={T} style={{ marginBottom: 12 }}>
        <Row T={T} label="Enable assistance" sub="Show Ask AI and allow note-aware assistance.">
          <Toggle T={T} checked={config?.enabled === true} onChange={v => save({ enabled: v }, false)} />
        </Row>
        <Row T={T} label="Where it runs" sub="Local keeps requests on this machine; Hosted uses your configured provider." last>
          <Segmented T={T} value={provider === 'ollama' ? 'local' : 'hosted'}
            onChange={value => selectProvider(value === 'local' ? 'ollama' : (provider === 'ollama' ? 'openai' : provider))}
            options={[{ value: 'local', label: 'Local AI' }, { value: 'hosted', label: 'Hosted AI' }]} />
        </Row>
      </SettingsCard>

      <details style={{ marginBottom: 12 }}>
        <summary style={{ cursor: 'pointer', fontFamily: 'var(--mn-ui)', fontSize: 12.5, color: T.inkMed, marginBottom: 10 }}>
          Advanced provider settings
        </summary>
      <SettingsCard T={T} style={{ padding: 12, marginBottom: 12 }}>
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
          gap: 8,
        }}>
          {MN_AI_PROVIDERS.map(item => (
            <button
              key={item.id}
              onClick={() => selectProvider(item.id)}
              style={{
                textAlign: 'left',
                border: `1px solid ${provider === item.id ? T.accent : T.lineSub}`,
                borderRadius: 7,
                background: provider === item.id ? T.accentSoft : T.bgSub,
                color: T.ink,
                padding: '10px 11px',
                cursor: 'pointer',
                fontFamily: 'var(--mn-ui)',
                minHeight: 70,
              }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                <span style={{ fontSize: 13, fontWeight: 650, color: provider === item.id ? T.accent : T.ink }}>{item.label}</span>
                <span style={{
                  marginLeft: 'auto',
                  fontFamily: 'var(--mn-mono)',
                  fontSize: 9.5,
                  color: provider === item.id ? T.accent : T.inkDim,
                  border: `1px solid ${provider === item.id ? T.selLine : T.lineSub}`,
                  borderRadius: 999,
                  padding: '1px 6px',
                  background: T.bg,
                }}>{item.badge}</span>
              </div>
              <div style={{ fontSize: 11.5, color: T.inkMed, lineHeight: 1.35 }}>{item.sub}</div>
            </button>
          ))}
        </div>
      </SettingsCard>

      <SettingsCard T={T}>
        <Row T={T} label="Enable AI" sub="When disabled, Ask AI and embedding jobs will not run.">
          <Toggle T={T} checked={config?.enabled === true} onChange={v => save({ enabled: v }, false)} />
        </Row>
        <Row T={T} label="PII reduction" sub="Redact common identifiers before hosted or custom AI requests.">
          <Toggle T={T} checked={config?.piiReduction !== false} onChange={v => save({ piiReduction: v }, false)} />
        </Row>
        {showApiKey && (
          <Row T={T} label={`${providerMeta.label} API key`} sub="Stored locally in VispNote settings. It is used only from this app.">
            <input
              type="password"
              value={apiKeyConfigured ? '' : apiKeyValue}
              onChange={(e) => setConfig(c => ({ ...(c || {}), [providerMeta.keyField]: e.target.value, [`${providerMeta.keyField}Dirty`]: true }))}
              onBlur={(e) => {
                if (apiKeyConfigured && !apiKeyDirty && !e.target.value.trim()) return;
                save({ [providerMeta.keyField]: e.target.value }, true);
              }}
              placeholder={apiKeyConfigured ? 'Configured. Type a new key to replace it.' : 'Paste API key'}
              style={mnAiInput(T, 260)}
            />
          </Row>
        )}
        <Row T={T} label={provider === 'ollama' ? 'Ollama host' : 'Base URL'} sub={provider === 'custom' ? 'OpenAI-compatible chat completions base URL.' : provider === 'ollama' ? 'Default local Ollama endpoint. Change only if your server uses another address.' : 'Provider API base URL. Change only for proxies or gateways.'}>
          <input value={baseValue}
            onChange={(e) => setConfig(c => ({ ...(c || {}), [providerMeta.baseField]: e.target.value }))}
            onBlur={(e) => save({ [providerMeta.baseField]: e.target.value }, true)}
            placeholder={providerMeta.baseDefault || 'https://api.example.com/v1'}
            style={mnAiInput(T, 280)} />
        </Row>
        <Row T={T} label="Chat model" sub={provider === 'ollama' ? 'Used for answers in Ask AI. Pick an installed local model.' : 'Used for answers, note creation, and page editing.'}>
          {provider === 'ollama' ? (
            <Select T={T} value={config?.chatModel || providerMeta.defaultModel || 'gemma3'} onChange={v => save({ chatModel: v }, true)}
              options={chatOptions} />
          ) : (
            <input
              value={config?.chatModel || providerMeta.defaultModel || ''}
              onChange={(e) => setConfig(c => ({ ...(c || {}), chatModel: e.target.value }))}
              onBlur={(e) => save({ chatModel: e.target.value }, true)}
              placeholder={providerMeta.defaultModel || 'model name'}
              style={mnAiInput(T, 260)}
            />
          )}
        </Row>
        <Row T={T} label="Retrieval mode" sub={provider === 'ollama' ? 'Ollama can use semantic embeddings when the embedding model is installed.' : 'Hosted providers use keyword and recent-note context. Local Ollama embeddings can still improve retrieval if indexed.'}>
          {provider === 'ollama' ? (
            <Select T={T} value={config?.embedModel || 'nomic-embed-text'} onChange={v => save({ embedModel: v }, true)}
              options={embedOptions} />
          ) : (
            <StaticValue T={T}>Keyword + recent notes</StaticValue>
          )}
        </Row>
        <Row T={T} label={provider === 'ollama' ? 'Refresh models' : 'Refresh status'} sub={provider === 'ollama' ? 'Reload the list of models available from the local provider.' : 'Re-check the saved provider configuration.'} last>
          <BtnOutline T={T} onClick={load}>{busy ? 'Refreshing...' : 'Refresh'}</BtnOutline>
        </Row>
      </SettingsCard>
      </details>
      <div style={{
        marginTop: 14,
        padding: '10px 12px',
        borderRadius: 6,
        border: `1px solid ${T.lineSub}`,
        background: T.bgSub,
        color: T.inkMed,
        fontFamily: 'var(--mn-body)',
        fontSize: 12.5,
        lineHeight: 1.45,
      }}>
        Cloud providers are used for chat, note creation, and editing. Note indexing stays local; without a local embedding model, Ask AI selects context with keyword search and recent notes.
      </div>
    </div>
  );
}

export { SectionAI };
