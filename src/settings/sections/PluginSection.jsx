import { H, SettingsCard, Row, Segmented, Toggle, Select, FontSizeStepper } from '../settingsControls.jsx';
import { MN_PLUGINS as MN_SETTINGS_PLUGINS } from '../../shared/plugins.js';
import { BtnOutline, StaticValue, mnSettingsInput } from '../settingsPrimitives.jsx';
import { shortcutLabel, useShortcutPlatform } from '../../platform/shortcuts.js';
const { useState: useStateS } = React;

function SectionPlugins({ tweaks, setTweak, T }) {
  const shortcutPlatform = useShortcutPlatform();
  const paletteShortcut = shortcutLabel('commandPalette', shortcutPlatform, { compact: true });
  const types = MN_SETTINGS_PLUGINS.TYPES || [];
  const normalizeAll = MN_SETTINGS_PLUGINS.normalizeAll || (() => []);
  const makeId = MN_SETTINGS_PLUGINS.id || (() => `plg_${Date.now()}`);
  const plugins = normalizeAll(tweaks.plugins);
  const firstType = types[0]?.id || 'note-template';
  const [draft, setDraft] = useStateS(() => mnPluginDraft(firstType));
  const selectedType = (types.find(type => type.id === draft.type) || types[0] || { defaultConfig: {} });
  const setDraftField = (key, value) => setDraft(current => ({ ...current, [key]: value }));
  const setConfigField = (key, value) => setDraft(current => ({ ...current, config: { ...(current.config || {}), [key]: value } }));
  const savePlugins = (next) => setTweak('plugins', normalizeAll(next));
  const addPlugin = () => {
    const name = draft.name.trim();
    if (!name) return;
    savePlugins([...plugins, { ...draft, id: makeId(), enabled: true }]);
    setDraft(mnPluginDraft(draft.type));
  };
  const updatePlugin = (id, patch) => savePlugins(plugins.map(plugin => plugin.id === id ? { ...plugin, ...patch } : plugin));
  const updatePluginConfig = (id, patch) => savePlugins(plugins.map(plugin => plugin.id === id ? { ...plugin, config: { ...(plugin.config || {}), ...patch } } : plugin));
  const removePlugin = (id) => savePlugins(plugins.filter(plugin => plugin.id !== id));
  const allowPluginCreation = tweaks?.legacyPluginCreationEnabled === true;

  return (
    <div>
      <H T={T} label="Existing integrations and actions" sub="Existing configurations remain editable while new generic plugin creation is deprecated." />
      {allowPluginCreation && <SettingsCard T={T} style={{ padding: 16, marginBottom: 16 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(180px, 1fr) minmax(170px, 0.8fr)', gap: 10, marginBottom: 10 }}>
          <input
            value={draft.name}
            onChange={e => setDraftField('name', e.target.value)}
            placeholder="Plugin name"
            style={mnSettingsInput(T, { width: '100%', minWidth: 0 })}
          />
          <select
            value={draft.type}
            onChange={e => {
              const nextType = e.target.value;
              const meta = types.find(type => type.id === nextType) || types[0] || {};
              setDraft(current => ({ ...current, type: nextType, purpose: meta.purpose || current.purpose, config: { ...(meta.defaultConfig || {}) } }));
            }}
            style={mnSettingsInput(T, { width: '100%', minWidth: 0 })}
          >
            {types.map(type => <option key={type.id} value={type.id}>{type.label}</option>)}
          </select>
        </div>
        <textarea
          value={draft.purpose}
          onChange={e => setDraftField('purpose', e.target.value)}
          placeholder="What does this plugin help you do?"
          rows={2}
          style={{ ...mnSettingsInput(T, { width: '100%', minWidth: 0 }), resize: 'vertical', lineHeight: 1.4, marginBottom: 10 }}
        />
        {draft.type === 'note-template' && (
          <div style={{ display: 'grid', gap: 10, marginBottom: 10 }}>
            <input value={draft.config.title || ''} onChange={e => setConfigField('title', e.target.value)} placeholder="Note title, e.g. {{date}} meeting" style={mnSettingsInput(T, { width: '100%', minWidth: 0 })} />
            <input value={draft.config.tags || ''} onChange={e => setConfigField('tags', e.target.value)} placeholder="Tags, comma separated" style={mnSettingsInput(T, { width: '100%', minWidth: 0 })} />
            <textarea value={draft.config.body || ''} onChange={e => setConfigField('body', e.target.value)} placeholder="Template body. Tokens: {{date}}, {{time}}, {{datetime}}" rows={5} style={{ ...mnSettingsInput(T, { width: '100%', minWidth: 0, fontFamily: 'var(--mn-mono)' }), resize: 'vertical', lineHeight: 1.45 }} />
          </div>
        )}
        {draft.type === 'open-url' && (
          <input value={draft.config.url || ''} onChange={e => setConfigField('url', e.target.value)} placeholder="https://example.com" style={{ ...mnSettingsInput(T, { width: '100%', minWidth: 0 }), marginBottom: 10 }} />
        )}
        {draft.type === 'quick-capture' && (
          <div style={{ fontFamily: 'var(--mn-body)', fontSize: 12.5, color: T.inkMed, lineHeight: 1.5, marginBottom: 10 }}>
            This plugin opens Quick Capture from the command palette so you can collect thoughts without switching context.
          </div>
        )}
        {draft.type === 'zotero-reader' && (
          <div style={{ fontFamily: 'var(--mn-body)', fontSize: 12.5, color: T.inkMed, lineHeight: 1.5, marginBottom: 10 }}>
            This plugin lets AI search and read Zotero Desktop documents through the local Zotero API. In Ask AI, include "Zotero" or "paper" in the request, for example: "summarize the Recursive Language Models paper from Zotero" or "use the Zotero paper to improve this note."
          </div>
        )}
        {draft.type === 'llm-memory' && (
          <div style={{ display: 'grid', gap: 10, marginBottom: 10 }}>
            <input value={draft.config.serverUrl || ''} onChange={e => setConfigField('serverUrl', e.target.value)} placeholder="Server URL (localhost only), e.g. http://127.0.0.1:8000" style={mnSettingsInput(T, { width: '100%', minWidth: 0 })} />
            <input value={draft.config.repoId || ''} onChange={e => setConfigField('repoId', e.target.value)} placeholder="Project id (optional — empty creates one from the note name)" style={mnSettingsInput(T, { width: '100%', minWidth: 0 })} />
            <input type="password" value={draft.config.apiKey || ''} onChange={e => setConfigField('apiKey', e.target.value)} placeholder="API key (leave empty for local no-auth mode)" style={mnSettingsInput(T, { width: '100%', minWidth: 0 })} />
          </div>
        )}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
          <div style={{ fontFamily: 'var(--mn-mono)', fontSize: 10.5, color: T.inkDim }}>{selectedType.purpose || 'Choose a plugin purpose.'}</div>
          <BtnOutline T={T} disabled={!draft.name.trim()} onClick={addPlugin}>Add plugin</BtnOutline>
        </div>
      </SettingsCard>}

      <SettingsCard T={T}>
        {plugins.length === 0 && (
          <div style={{ padding: 18, fontFamily: 'var(--mn-body)', fontSize: 13, color: T.inkMed, lineHeight: 1.55 }}>
            No plugins yet. Add a template, quick capture, or URL plugin above; then run it from the command palette with {paletteShortcut}.
          </div>
        )}
        {plugins.map((plugin, index) => {
          const meta = types.find(type => type.id === plugin.type) || { label: plugin.type };
          const last = index === plugins.length - 1;
          return (
            <div key={plugin.id} style={{ padding: 16, borderBottom: last ? 'none' : `1px solid ${T.lineSub}`, background: T.bg }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                <Toggle T={T} checked={plugin.enabled !== false} onChange={enabled => updatePlugin(plugin.id, { enabled })} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 8 }}>
                    <input value={plugin.name} onChange={e => updatePlugin(plugin.id, { name: e.target.value })} style={mnSettingsInput(T, { width: 210, minWidth: 160 })} />
                    <StaticValue T={T}>{meta.label}</StaticValue>
                  </div>
                  <textarea value={plugin.purpose || ''} onChange={e => updatePlugin(plugin.id, { purpose: e.target.value })} rows={2} style={{ ...mnSettingsInput(T, { width: '100%', minWidth: 0 }), resize: 'vertical', lineHeight: 1.4, marginBottom: 8 }} />
                  {plugin.type === 'note-template' && (
                    <div style={{ display: 'grid', gap: 8 }}>
                      <input value={plugin.config.title || ''} onChange={e => updatePluginConfig(plugin.id, { title: e.target.value })} placeholder="Title" style={mnSettingsInput(T, { width: '100%', minWidth: 0 })} />
                      <input value={plugin.config.tags || ''} onChange={e => updatePluginConfig(plugin.id, { tags: e.target.value })} placeholder="Tags" style={mnSettingsInput(T, { width: '100%', minWidth: 0 })} />
                      <textarea value={plugin.config.body || ''} onChange={e => updatePluginConfig(plugin.id, { body: e.target.value })} rows={4} style={{ ...mnSettingsInput(T, { width: '100%', minWidth: 0, fontFamily: 'var(--mn-mono)' }), resize: 'vertical', lineHeight: 1.45 }} />
                    </div>
                  )}
                  {plugin.type === 'open-url' && (
                    <input value={plugin.config.url || ''} onChange={e => updatePluginConfig(plugin.id, { url: e.target.value })} placeholder="https://example.com" style={mnSettingsInput(T, { width: '100%', minWidth: 0 })} />
                  )}
                  {plugin.type === 'zotero-reader' && (
                    <div style={{ fontFamily: 'var(--mn-body)', fontSize: 12.5, color: T.inkMed, lineHeight: 1.5 }}>
                      Uses Zotero Desktop at 127.0.0.1:23119. Keep Zotero open. In Ask AI, include "Zotero" or "paper", for example: "summarize the Recursive Language Models paper from Zotero" or "use the Zotero paper to improve this note."
                    </div>
                  )}
                  {plugin.type === 'llm-memory' && (
                    <div style={{ display: 'grid', gap: 8 }}>
                      <input value={plugin.config.serverUrl || ''} onChange={e => updatePluginConfig(plugin.id, { serverUrl: e.target.value })} placeholder="Server URL (localhost only)" style={mnSettingsInput(T, { width: '100%', minWidth: 0 })} />
                      <input value={plugin.config.repoId || ''} onChange={e => updatePluginConfig(plugin.id, { repoId: e.target.value })} placeholder="Project id (optional — empty creates one from the note name)" style={mnSettingsInput(T, { width: '100%', minWidth: 0 })} />
                      <input type="password" value={plugin.config.apiKey || ''} onChange={e => updatePluginConfig(plugin.id, { apiKey: e.target.value })} placeholder="API key (optional)" style={mnSettingsInput(T, { width: '100%', minWidth: 0 })} />
                      <div style={{ fontFamily: 'var(--mn-body)', fontSize: 12, color: T.inkMed, lineHeight: 1.5 }}>
                        Palette commands ({paletteShortcut}): "Import memories as notes", "Remember this note", and "Sync note links to memory graph" — the last mirrors your [[wiki-links]] into the memory graph so Ask AI can follow how pages connect. Ask AI automatically blends graph-aware memory recall into answers when this bridge is on. The server must run on this machine.
                      </div>
                    </div>
                  )}
                </div>
                <BtnOutline T={T} danger onClick={() => removePlugin(plugin.id)}>Remove</BtnOutline>
              </div>
            </div>
          );
        })}
      </SettingsCard>
    </div>
  );
}

function mnPluginDraft(typeId) {
  const meta = (MN_SETTINGS_PLUGINS.type ? MN_SETTINGS_PLUGINS.type(typeId) : null) || (MN_SETTINGS_PLUGINS.TYPES || [])[0] || { id: 'note-template', label: 'Plugin', purpose: '', defaultConfig: {} };
  return {
    type: meta.id,
    name: '',
    purpose: meta.purpose || '',
    config: { ...(meta.defaultConfig || {}) },
  };
}

export { SectionPlugins };
