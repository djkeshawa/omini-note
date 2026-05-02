// Standardized settings modal with tabbed sections.
const { useState: useStateS, useEffect: useEffectS } = React;

function MnSettingsModal({ tweaks, setTweak, T, onClose, stats, vaults, activeVaultId, activeVault, onCreateVault, onDeleteVault, onSetVaultNovelistMode }) {
  const [section, setSection] = useStateS('appearance');

  const sections = [
    { k: 'appearance', label: 'Appearance', group: 'Workspace', sub: 'Theme, density, fonts', icon: iconAppearance },
    { k: 'editor', label: 'Editor', group: 'Workspace', sub: 'Writing behavior', icon: iconEditor },
    { k: 'notes', label: 'Notes & Tags', group: 'Workspace', sub: 'Lists and rollups', icon: iconNotes },
    { k: 'reminders', label: 'Reminders', group: 'Automation', sub: 'Alerts and snooze', icon: iconBell },
    { k: 'ai', label: 'AI', group: 'Automation', sub: 'Models and providers', icon: iconAI },
    { k: 'data', label: 'Data & Sync', group: 'System', sub: 'Vaults and storage', icon: iconData },
    { k: 'shortcuts', label: 'Shortcuts', group: 'System', sub: 'Keyboard map', icon: iconKey },
    { k: 'about', label: 'About', group: 'System', sub: 'Version and stats', icon: iconInfo },
  ];
  const activeSection = sections.find(s => s.k === section) || sections[0];
  const groups = [...new Set(sections.map(s => s.group))];

  return (
    <div onClick={onClose} style={{
      position: 'absolute', inset: 0, zIndex: 60,
      background: `color-mix(in oklab, ${T.ink} 32%, transparent)`,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      animation: 'mnFadeIn 140ms ease', backdropFilter: 'blur(2px)',
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        width: 'min(980px, calc(100vw - 48px))',
        height: 'min(720px, calc(100vh - 48px))',
        minHeight: 'min(560px, calc(100vh - 48px))',
        background: T.bg,
        borderRadius: 12,
        border: `1px solid ${T.line}`, overflow: 'hidden',
        boxShadow: `0 24px 60px color-mix(in oklab, ${T.ink} 28%, transparent)`,
        display: 'flex', flexDirection: 'column',
      }}>
        <div style={{
          padding: '14px 16px', borderBottom: `1px solid ${T.lineSub}`,
          display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0,
          background: `linear-gradient(180deg, ${T.bgSub}, ${T.bg})`,
        }}>
          <div style={{
            width: 30,
            height: 30,
            borderRadius: 7,
            border: `1px solid ${T.lineSub}`,
            background: T.bg,
            color: T.inkMed,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}>
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3">
              <circle cx="8" cy="8" r="2.2"/>
              <path d="M8 1.5V3M8 13V14.5M14.5 8H13M3 8H1.5M12.6 3.4L11.5 4.5M4.5 11.5L3.4 12.6M12.6 12.6L11.5 11.5M4.5 4.5L3.4 3.4" strokeLinecap="round"/>
            </svg>
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontFamily: 'var(--mn-ui)', fontSize: 14, fontWeight: 700, color: T.ink }}>Settings</div>
            <div style={{ fontFamily: 'var(--mn-mono)', fontSize: 10.5, color: T.inkDim, marginTop: 2 }}>
              {activeSection.label} · {activeSection.sub}
            </div>
          </div>
          <div style={{ flex: 1 }} />
          <button onClick={onClose} style={{
            width: 28,
            height: 28,
            borderRadius: 6,
            border: `1px solid ${T.lineSub}`,
            background: T.bg,
            cursor: 'pointer',
            color: T.inkDim,
            padding: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }} title="Close settings" aria-label="Close settings">
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6">
              <path d="M4 4L12 12M12 4L4 12" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
          <div style={{
            width: 230,
            background: T.bgSub,
            borderRight: `1px solid ${T.lineSub}`,
            padding: '12px 10px',
            overflow: 'auto',
            flexShrink: 0,
          }}>
            {groups.map(group => (
              <div key={group} style={{ marginBottom: 12 }}>
                <div style={{
                  fontFamily: 'var(--mn-mono)',
                  fontSize: 9.5,
                  color: T.inkDim,
                  letterSpacing: '0.08em',
                  textTransform: 'uppercase',
                  padding: '0 9px 6px',
                }}>{group}</div>
                {sections.filter(s => s.group === group).map(s => {
                  const active = section === s.k;
                  return (
                    <button key={s.k} onClick={() => setSection(s.k)} style={{
                      width: '100%',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 9,
                      padding: '8px 9px',
                      borderRadius: 7,
                      cursor: 'pointer',
                      fontFamily: 'var(--mn-ui)',
                      textAlign: 'left',
                      background: active ? T.bg : 'transparent',
                      color: active ? T.ink : T.inkMed,
                      border: active ? `1px solid ${T.lineSub}` : '1px solid transparent',
                      boxShadow: active ? `0 7px 18px color-mix(in oklab, ${T.ink} 5%, transparent)` : 'none',
                      marginBottom: 2,
                    }}>
                      <span style={{
                        width: 26,
                        height: 26,
                        borderRadius: 6,
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: active ? T.accent : T.inkDim,
                        background: active ? T.accentSoft : T.bg,
                        border: `1px solid ${active ? T.selLine : T.lineSub}`,
                        flexShrink: 0,
                      }}>{s.icon}</span>
                      <span style={{ minWidth: 0 }}>
                        <span style={{ display: 'block', fontSize: 12.5, fontWeight: active ? 650 : 500 }}>{s.label}</span>
                        <span style={{
                          display: 'block',
                          marginTop: 2,
                          fontFamily: 'var(--mn-body)',
                          fontSize: 11.5,
                          lineHeight: 1.25,
                          color: T.inkDim,
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                        }}>{s.sub}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            ))}
          </div>

          <div style={{
            flex: 1,
            overflow: 'auto',
            padding: '24px 32px',
            background: `linear-gradient(180deg, ${T.bg}, color-mix(in oklab, ${T.bgSub} 38%, ${T.bg}))`,
          }}>
            {section === 'appearance' && <SectionAppearance tweaks={tweaks} setTweak={setTweak} T={T} />}
            {section === 'editor' && <SectionEditor tweaks={tweaks} setTweak={setTweak} T={T} />}
            {section === 'notes' && <SectionNotes tweaks={tweaks} setTweak={setTweak} T={T} stats={stats} />}
            {section === 'reminders' && <SectionReminders tweaks={tweaks} setTweak={setTweak} T={T} />}
            {section === 'ai' && <SectionAI T={T} />}
            {section === 'data' && (
              <SectionData
                tweaks={tweaks}
                setTweak={setTweak}
                T={T}
                stats={stats}
                vaults={vaults || []}
                activeVaultId={activeVaultId}
                activeVault={activeVault}
                onCreateVault={onCreateVault}
                onDeleteVault={onDeleteVault}
                onSetVaultNovelistMode={onSetVaultNovelistMode}
              />
            )}
            {section === 'shortcuts' && <SectionShortcuts T={T} />}
            {section === 'about' && <SectionAbout T={T} stats={stats} />}
          </div>
        </div>
      </div>
    </div>
  );
}

// ───── building blocks ─────

function H({ T, label, sub }) {
  return (
    <div style={{ marginBottom: 18 }}>
      <div style={{ fontFamily: 'var(--mn-ui)', fontSize: 22, fontWeight: 750, color: T.ink, letterSpacing: 0 }}>{label}</div>
      {sub && <div style={{ fontFamily: 'var(--mn-body)', fontSize: 13.5, color: T.inkMed, marginTop: 4, lineHeight: 1.45 }}>{sub}</div>}
    </div>
  );
}

function SettingsCard({ T, children, style = {} }) {
  return (
    <div style={{
      border: `1px solid ${T.lineSub}`,
      borderRadius: 8,
      background: T.bg,
      overflow: 'hidden',
      boxShadow: `0 12px 30px color-mix(in oklab, ${T.ink} 4%, transparent)`,
      ...style,
    }}>
      {children}
    </div>
  );
}

function Row({ T, label, sub, children, last = false }) {
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: 'minmax(0, 1fr) auto',
      alignItems: 'center',
      gap: 18,
      padding: '14px 16px',
      borderBottom: last ? 'none' : `1px solid ${T.lineSub}`,
      background: T.bg,
    }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontFamily: 'var(--mn-ui)', fontSize: 13.2, fontWeight: 650, color: T.ink }}>{label}</div>
        {sub && <div style={{ fontFamily: 'var(--mn-body)', fontSize: 12, color: T.inkMed, marginTop: 2, lineHeight: 1.45 }}>{sub}</div>}
      </div>
      <div style={{ minWidth: 0, justifySelf: 'end' }}>{children}</div>
    </div>
  );
}

function Segmented({ T, value, onChange, options }) {
  return (
    <div style={{
      display: 'inline-flex', background: T.bgSub,
      border: `1px solid ${T.lineSub}`, borderRadius: 7, padding: 2,
      maxWidth: '100%',
    }}>
      {options.map(o => (
        <button key={o.value} onClick={() => onChange(o.value)} style={{
          padding: '5px 12px', borderRadius: 5, border: 'none',
          background: value === o.value ? T.bg : 'transparent',
          color: value === o.value ? T.ink : T.inkMed,
          fontFamily: 'var(--mn-ui)', fontSize: 12, cursor: 'pointer',
          fontWeight: value === o.value ? 500 : 400,
          boxShadow: value === o.value ? `0 1px 2px color-mix(in oklab, ${T.ink} 10%, transparent)` : 'none',
          textTransform: 'capitalize',
          whiteSpace: 'nowrap',
        }}>{o.label}</button>
      ))}
    </div>
  );
}

function Toggle({ T, checked, onChange }) {
  return (
    <button onClick={() => onChange(!checked)} style={{
      width: 34, height: 20, borderRadius: 10, border: 'none', padding: 0,
      background: checked ? T.accent : T.line, cursor: 'pointer',
      position: 'relative', transition: 'background 140ms',
    }}>
      <span style={{
        position: 'absolute', top: 2, left: checked ? 16 : 2,
        width: 16, height: 16, borderRadius: '50%',
        background: T.bg, transition: 'left 140ms',
        boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
      }} />
    </button>
  );
}

function Select({ T, value, onChange, options }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} style={{
      padding: '6px 10px', borderRadius: 6, border: `1px solid ${T.line}`,
      background: T.bg, color: T.ink, fontFamily: 'var(--mn-ui)', fontSize: 12.5,
      cursor: 'pointer', minWidth: 190,
      outline: 'none',
    }}>
      {options.map(o => <option key={o} value={o}>{o}</option>)}
    </select>
  );
}

const FONT_SIZE_OPTIONS = [
  { value: 'small', label: 'Small' },
  { value: 'default', label: 'Default' },
  { value: 'large', label: 'Large' },
  { value: 'x-large', label: 'XL' },
];

function FontSizeStepper({ T, value, onChange }) {
  const current = value || 'default';
  const idx = FONT_SIZE_OPTIONS.findIndex(o => o.value === current);
  const safeIdx = idx === -1 ? 1 : idx;
  const setByDelta = (delta) => {
    const next = Math.max(0, Math.min(FONT_SIZE_OPTIONS.length - 1, safeIdx + delta));
    onChange(FONT_SIZE_OPTIONS[next].value);
  };
  return (
    <div style={{
      display: 'inline-flex', alignItems: 'center',
      border: `1px solid ${T.lineSub}`, borderRadius: 6,
      background: T.bgSub, overflow: 'hidden',
    }}>
      <button onClick={() => setByDelta(-1)} disabled={safeIdx === 0} style={stepBtn(T, safeIdx === 0)}>-</button>
      <select value={current} onChange={(e) => onChange(e.target.value)} style={{
        border: 'none', borderLeft: `1px solid ${T.lineSub}`, borderRight: `1px solid ${T.lineSub}`,
        background: T.bg, color: T.ink, fontFamily: 'var(--mn-ui)', fontSize: 12,
        padding: '5px 8px', outline: 'none',
      }}>
        {FONT_SIZE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      <button onClick={() => setByDelta(1)} disabled={safeIdx === FONT_SIZE_OPTIONS.length - 1} style={stepBtn(T, safeIdx === FONT_SIZE_OPTIONS.length - 1)}>+</button>
    </div>
  );
}

function stepBtn(T, disabled) {
  return {
    width: 28, height: 28,
    border: 'none', background: 'transparent',
    color: disabled ? T.inkDim : T.ink,
    cursor: disabled ? 'default' : 'pointer',
    fontFamily: 'var(--mn-ui)', fontSize: 14,
  };
}

// ───── sections ─────

function SectionAppearance({ tweaks, setTweak, T }) {
  return (
    <div>
      <H T={T} label="Appearance" sub="Make VispNote look the way you think." />
      <SettingsCard T={T}>
        <Row T={T} label="Theme" sub="Light or dark color scheme.">
          <Segmented T={T} value={tweaks.theme} onChange={v => setTweak('theme', v)}
            options={[{ value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }]} />
        </Row>
        <Row T={T} label="Interface density" sub="Tighter rows fit more on screen.">
          <Segmented T={T} value={tweaks.density} onChange={v => setTweak('density', v)}
            options={[{ value: 'comfortable', label: 'Comfortable' }, { value: 'compact', label: 'Compact' }]} />
        </Row>
        <Row T={T} label="Typography" sub="Font pairing used across the app.">
          <Select T={T} value={tweaks.fontChoice} onChange={v => setTweak('fontChoice', v)}
            options={Object.keys(MN_FONTS)} />
        </Row>
        <Row T={T} label="App font size" sub="Scale the surrounding app interface.">
          <FontSizeStepper T={T} value={tweaks.appFontSize || 'default'} onChange={v => setTweak('appFontSize', v)} />
        </Row>
        <Row T={T} label="Show note list pane" sub="Hide to give the editor full width.">
          <Toggle T={T} checked={tweaks.showNoteList !== false} onChange={v => setTweak('showNoteList', v)} />
        </Row>
        <Row T={T} label="Show sidebar" sub="Tags, Today, Todos, and Graph shortcuts." last>
          <Toggle T={T} checked={tweaks.showSidebar !== false} onChange={v => setTweak('showSidebar', v)} />
        </Row>
      </SettingsCard>
    </div>
  );
}

function SectionEditor({ tweaks, setTweak, T }) {
  return (
    <div>
      <H T={T} label="Editor" sub="Outliner behavior and block display." />
      <SettingsCard T={T}>
        <Row T={T} label="Editor width" sub="Reading comfort vs. information density.">
          <Segmented T={T} value={tweaks.editorWidth || 'medium'}
            onChange={v => setTweak('editorWidth', v)}
            options={[{ value: 'narrow', label: 'Narrow' }, { value: 'medium', label: 'Medium' }, { value: 'wide', label: 'Wide' }]} />
        </Row>
        <Row T={T} label="Font size" sub="Scale block text. Default 14.5px.">
          <FontSizeStepper T={T} value={tweaks.fontSize || 'default'} onChange={v => setTweak('fontSize', v)} />
        </Row>
        <Row T={T} label="Indent guides" sub="Show vertical lines for nested bullets.">
          <Toggle T={T} checked={tweaks.indentGuides !== false} onChange={v => setTweak('indentGuides', v)} />
        </Row>
        <Row T={T} label="Spell check" sub="Browser spell-check on block text.">
          <Toggle T={T} checked={tweaks.spellCheck !== false} onChange={v => setTweak('spellCheck', v)} />
        </Row>
        <Row T={T} label="Auto-link notes" sub="Show [[suggestions]] as you type.">
          <Toggle T={T} checked={tweaks.autoLink !== false} onChange={v => setTweak('autoLink', v)} />
        </Row>
        <Row T={T} label="Collapse new sections by default" sub="Keep long notes scannable." last>
          <Toggle T={T} checked={tweaks.collapseByDefault === true} onChange={v => setTweak('collapseByDefault', v)} />
        </Row>
      </SettingsCard>
    </div>
  );
}

function SectionNotes({ tweaks, setTweak, T, stats }) {
  return (
    <div>
      <H T={T} label="Notes & Tags" sub="Default note properties and organization." />
      <SettingsCard T={T}>
        <Row T={T} label="Sort notes by" sub="Applied to the All notes list.">
          <Segmented T={T} value={tweaks.sortBy || 'modified'}
            onChange={v => setTweak('sortBy', v)}
            options={[{ value: 'modified', label: 'Modified' }, { value: 'created', label: 'Created' }, { value: 'title', label: 'Title' }]} />
        </Row>
        <Row T={T} label="Default new-note tags" sub="Tags applied automatically to every new note.">
          <input type="text" value={tweaks.defaultTags || ''}
            onChange={(e) => setTweak('defaultTags', e.target.value)}
            placeholder="ideas, inbox"
            style={mnSettingsInput(T, { minWidth: 190, fontFamily: 'var(--mn-mono)' })} />
        </Row>
        <Row T={T} label="Show pinned notes first" sub="Pin a note from its toolbar.">
          <Toggle T={T} checked={tweaks.pinnedFirst !== false} onChange={v => setTweak('pinnedFirst', v)} />
        </Row>
        <Row T={T} label="Daily rollup heading format" sub="How Today view groups notes.">
          <Segmented T={T} value={tweaks.rollupFormat || 'long'}
            onChange={v => setTweak('rollupFormat', v)}
            options={[{ value: 'long', label: 'Long' }, { value: 'short', label: 'Short' }]} />
        </Row>
        <Row T={T} label="Todo layout" sub="How the aggregated Todos view is arranged.">
          <Segmented T={T} value={tweaks.todoVariant} onChange={v => setTweak('todoVariant', v)}
            options={[{ value: 'list', label: 'List' }, { value: 'kanban', label: 'Kanban' }]} />
        </Row>
        <Row T={T} label="Graph style" sub="How connection overlay is drawn." last>
          <Segmented T={T} value={tweaks.graphStyle} onChange={v => setTweak('graphStyle', v)}
            options={[{ value: 'force', label: 'Force' }, { value: 'timeline', label: 'Timeline' }, { value: 'cluster', label: 'Cluster' }]} />
        </Row>
      </SettingsCard>
      <div style={{
        marginTop: 16, padding: '10px 14px', background: T.bgSub,
        border: `1px solid ${T.lineSub}`, borderRadius: 6,
        fontFamily: 'var(--mn-mono)', fontSize: 11, color: T.inkMed,
      }}>{stats.noteCount} notes · {stats.tagCount} tags · {stats.linkCount} links</div>
    </div>
  );
}

function SectionReminders({ tweaks, setTweak, T }) {
  return (
    <div>
      <H T={T} label="Reminders" sub="Control how @remind directives surface." />
      <SettingsCard T={T}>
        <Row T={T} label="Notification style" sub="Where reminder alerts appear.">
          <Segmented T={T} value={tweaks.toastVariant} onChange={v => setTweak('toastVariant', v)}
            options={[{ value: 'card', label: 'Card' }, { value: 'banner', label: 'Banner' }]} />
        </Row>
        <Row T={T} label="Sound" sub="Play a short chime when a reminder fires.">
          <Toggle T={T} checked={tweaks.reminderSound === true} onChange={v => setTweak('reminderSound', v)} />
        </Row>
        <Row T={T} label="Show overdue on launch" sub="Surface missed reminders when the app opens.">
          <Toggle T={T} checked={tweaks.showOverdue !== false} onChange={v => setTweak('showOverdue', v)} />
        </Row>
        <Row T={T} label="Default snooze duration" sub="Applied when snoozing a reminder toast.">
          <Segmented T={T} value={tweaks.snoozeMinutes || '15'}
            onChange={v => setTweak('snoozeMinutes', v)}
            options={[{ value: '5', label: '5m' }, { value: '15', label: '15m' }, { value: '60', label: '1h' }, { value: '1440', label: '1d' }]} />
        </Row>
        <Row T={T} label="Week starts on" sub="Affects calendar picker for reminders." last>
          <StaticValue T={T}>No calendar picker yet</StaticValue>
        </Row>
      </SettingsCard>
    </div>
  );
}

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

function SectionAI({ T }) {
  const [config, setConfig] = useStateS(null);
  const [status, setStatus] = useStateS(null);
  const [busy, setBusy] = useStateS(false);
  const [message, setMessage] = useStateS('');

  const load = async () => {
    if (!window.mn?.ai) return;
    setBusy(true);
    try {
      const cfg = await window.mn.ai.getConfig();
      if (cfg.ok) setConfig(cfg.value);
      const st = await window.mn.ai.status();
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
    if (!window.mn?.ai) return;
    const res = await window.mn.ai.setConfig(patch);
    if (res.ok) setConfig(res.value);
    if (refresh) {
      const st = await window.mn.ai.status();
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
    if (!window.mn?.ai) return;
    setBusy(true);
    setMessage('Connecting to Ollama...');
    try {
      const res = await window.mn.ai.connect();
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
        ? `Chat model missing: ${status?.config?.chatModel || config?.chatModel}`
        : status?.embedModelOk === false
          ? `${models.length} Ollama model${models.length === 1 ? '' : 's'} available. Ask AI will use keyword search until ${status?.config?.embedModel || config?.embedModel} is installed.`
          : `${models.length} Ollama model${models.length === 1 ? '' : 's'} available`)
      : status?.reason || status?.connectError || 'Ollama is not responding yet.')
    : (providerReady
      ? `${providerMeta.label} is configured. Ask AI will use hosted chat with keyword/recent-note context.`
      : status?.reason || `${providerMeta.label} needs an API key and model.`);
  const showApiKey = !!providerMeta.keyField;
  const apiKeyValue = showApiKey ? (config?.[providerMeta.keyField] || '') : '';
  const baseValue = config?.[providerMeta.baseField] || providerMeta.baseDefault || '';

  return (
    <div>
      <H T={T} label="AI" sub="Choose the model provider Ask AI uses for answers and note actions." />
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
            }}>{busy ? 'Checking...' : 'Connect'}</button>
          ) : (
            <BtnOutline T={T} onClick={load} disabled={busy}>{busy ? 'Checking...' : 'Check'}</BtnOutline>
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
          <Toggle T={T} checked={config?.enabled !== false} onChange={v => save({ enabled: v }, false)} />
        </Row>
        {showApiKey && (
          <Row T={T} label={`${providerMeta.label} API key`} sub="Stored locally in VispNote settings. It is used only from this app.">
            <input
              type="password"
              value={apiKeyValue}
              onChange={(e) => setConfig(c => ({ ...(c || {}), [providerMeta.keyField]: e.target.value }))}
              onBlur={(e) => save({ [providerMeta.keyField]: e.target.value }, true)}
              placeholder="Paste API key"
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

function uniqueOptions(values) {
  return [...new Set(values.filter(Boolean))];
}

function mnAiInput(T, minWidth = 220) {
  return {
    padding: '6px 10px',
    borderRadius: 6,
    border: `1px solid ${T.line}`,
    background: T.bg,
    color: T.ink,
    fontFamily: 'var(--mn-mono)',
    fontSize: 12,
    minWidth,
    outline: 'none',
  };
}

function mnSettingsInput(T, options = {}) {
  return {
    width: options.width,
    flex: options.flex,
    minWidth: options.minWidth ?? 180,
    padding: '6px 10px',
    borderRadius: 6,
    border: options.border || `1px solid ${T.line}`,
    background: T.bg,
    color: T.ink,
    fontFamily: options.fontFamily || 'var(--mn-ui)',
    fontSize: 12,
    outline: 'none',
  };
}

function SectionData({ tweaks, setTweak, T, stats, vaults, activeVaultId, activeVault, onCreateVault, onDeleteVault, onSetVaultNovelistMode }) {
  const [newVaultName, setNewVaultName] = useStateS('');
  const [newVaultType, setNewVaultType] = useStateS('notes');
  const [confirmingDelete, setConfirmingDelete] = useStateS(false);
  const [confirmText, setConfirmText] = useStateS('');
  const [busy, setBusy] = useStateS(false);
  const [error, setError] = useStateS('');
  const currentVault = activeVault || vaults.find(v => v.id === activeVaultId) || null;
  const canDeleteVault = !!currentVault && vaults.length > 1;
  const deleteReady = canDeleteVault && confirmText.trim() === currentVault.name;
  const submitCreateVault = async () => {
    const name = newVaultName.trim();
    if (!name || !onCreateVault) return;
    setError('');
    setBusy(true);
    try {
      await onCreateVault(name, { type: newVaultType });
      setNewVaultName('');
      setNewVaultType('notes');
      setConfirmingDelete(false);
      setConfirmText('');
    } finally {
      setBusy(false);
    }
  };
  const submitDeleteVault = async () => {
    if (!deleteReady || !onDeleteVault) return;
    setError('');
    setBusy(true);
    try {
      const result = await onDeleteVault(currentVault.id);
      if (result && result.ok === false) {
        setError(result.error || 'Could not delete vault.');
        return;
      }
      setConfirmingDelete(false);
      setConfirmText('');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div>
      <H T={T} label="Data & Sync" sub="Where VispNote keeps your markdown files." />
      <SettingsCard T={T}>
        <Row T={T} label="Current vault" sub="Folder on disk where this vault's markdown files are stored.">
          <div style={{
            fontFamily: 'var(--mn-mono)', fontSize: 11.5, color: T.inkMed,
            padding: '6px 10px', border: `1px solid ${T.line}`, borderRadius: 6,
            background: T.bgSub,
            maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }} title={currentVault?.path || ''}>{currentVault?.path || '~/VispNote/vault'}</div>
        </Row>
        <Row T={T} label="Create vault" sub="Start a separate local workspace with its own notes and tags.">
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            <Segmented T={T} value={newVaultType} onChange={setNewVaultType}
              options={[{ value: 'notes', label: 'Notes' }, { value: 'novelist', label: 'Novelist' }]} />
            <input
              value={newVaultName}
              onChange={e => setNewVaultName(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') submitCreateVault();
              }}
              placeholder="Vault name"
              style={mnSettingsInput(T, { width: 180 })}
            />
            <BtnOutline T={T} disabled={busy || !newVaultName.trim()} onClick={submitCreateVault}>Create</BtnOutline>
          </div>
        </Row>
        <Row T={T} label="Vault mode" sub="Convert this vault into a focused novel-writing workspace.">
          <Segmented T={T} value={currentVault?.novelistMode ? 'novelist' : 'notes'}
            onChange={async (mode) => {
              if (!onSetVaultNovelistMode) return;
              setBusy(true);
              setError('');
              try {
                const result = await onSetVaultNovelistMode(mode === 'novelist');
                if (result && result.ok === false) setError(result.error || 'Could not update vault mode.');
              } finally {
                setBusy(false);
              }
            }}
            options={[{ value: 'notes', label: 'Notes vault' }, { value: 'novelist', label: 'Novelist vault' }]} />
        </Row>
        <Row T={T} label="Auto-save" sub="Persist changes to disk as you type.">
          <StaticValue T={T}>Always on</StaticValue>
        </Row>
        <Row T={T} label="Storage format" sub="Every note is saved as a standalone file.">
          <StaticValue T={T}>Markdown</StaticValue>
        </Row>
        <Row T={T} label="Sync backend" sub="Keep notes in sync across devices.">
          <StaticValue T={T}>Local only</StaticValue>
        </Row>
        <Row T={T} label="Delete current vault" sub={canDeleteVault ? "Permanently remove this vault and every note file inside it." : "Create another vault before deleting this one."} last>
          <BtnOutline
            T={T}
            danger
            disabled={busy || !canDeleteVault}
            onClick={() => {
              setError('');
              setConfirmingDelete(v => !v);
              setConfirmText('');
            }}
          >Delete vault...</BtnOutline>
        </Row>
      </SettingsCard>
      {error && !confirmingDelete && <div style={{
        marginTop: 10,
        fontFamily: 'var(--mn-ui)',
        fontSize: 12,
        color: T.danger,
      }}>{error}</div>}
      {confirmingDelete && currentVault && (
        <div style={{
          marginTop: 12,
          padding: '12px 14px',
          borderRadius: 6,
          border: `1px solid color-mix(in oklab, ${T.danger} 35%, ${T.lineSub})`,
          background: `color-mix(in oklab, ${T.danger} 8%, ${T.bg})`,
        }}>
          <div style={{ fontFamily: 'var(--mn-ui)', fontSize: 13, fontWeight: 650, color: T.danger }}>
            Delete "{currentVault.name}" permanently
          </div>
          <div style={{ marginTop: 4, fontFamily: 'var(--mn-body)', fontSize: 12.5, lineHeight: 1.45, color: T.inkMed }}>
            This removes the vault folder, its markdown files, tags, and search index entries. This cannot be undone.
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10 }}>
            <input
              value={confirmText}
              onChange={e => setConfirmText(e.target.value)}
              placeholder={`Type ${currentVault.name}`}
              style={mnSettingsInput(T, { flex: 1, minWidth: 0, border: `1px solid ${deleteReady ? T.danger : T.line}` })}
            />
            <BtnOutline T={T} danger disabled={busy || !deleteReady} onClick={submitDeleteVault}>Delete permanently</BtnOutline>
          </div>
          {error && <div style={{
            marginTop: 8,
            fontFamily: 'var(--mn-ui)',
            fontSize: 12,
            color: T.danger,
          }}>{error}</div>}
        </div>
      )}
      <div style={{ display: 'flex', gap: 8, marginTop: 18 }}>
        <BtnOutline T={T}>Export vault…</BtnOutline>
        <BtnOutline T={T}>Import notes…</BtnOutline>
        <BtnOutline T={T} danger>Reset app data</BtnOutline>
      </div>
      <div style={{
        marginTop: 16, fontFamily: 'var(--mn-mono)', fontSize: 11, color: T.inkDim,
      }}>Vault: {stats.noteCount} notes · approx. {(stats.charCount / 1024).toFixed(1)} KB</div>
    </div>
  );
}

function BtnOutline({ T, children, danger, disabled, onClick }) {
  return (
    <button disabled={disabled} onClick={onClick} style={{
      minHeight: 30,
      padding: '6px 12px',
      borderRadius: 6,
      cursor: disabled ? 'default' : 'pointer',
      background: T.bg,
      border: `1px solid ${danger ? T.danger : T.line}`,
      color: disabled ? T.inkDim : danger ? T.danger : T.inkMed,
      fontFamily: 'var(--mn-ui)', fontSize: 12, fontWeight: 500,
      opacity: disabled ? 0.62 : 1,
    }}>{children}</button>
  );
}

function StaticValue({ T, children }) {
  return (
    <span style={{
      minHeight: 28,
      display: 'inline-flex',
      alignItems: 'center',
      padding: '5px 10px',
      borderRadius: 6,
      border: `1px solid ${T.lineSub}`,
      background: T.bgSub,
      color: T.inkMed,
      fontFamily: 'var(--mn-ui)',
      fontSize: 12,
      whiteSpace: 'nowrap',
    }}>{children}</span>
  );
}

function SectionShortcuts({ T }) {
  const sc = [
    { k: '⌘ N', v: 'New note' },
    { k: '⌘ ⇧ N', v: 'Quick capture' },
    { k: '⌘ G', v: 'Open graph' },
    { k: '⌘ K', v: 'Open Ask AI' },
    { k: '⌘ \\', v: 'Toggle sidebar' },
    { k: '⌘ ⇧ \\', v: 'Toggle note list' },
    { k: '⌘ Z', v: 'Undo editor change' },
    { k: '⌘ ⇧ Z / ⌘ Y', v: 'Redo editor change' },
    { k: 'Tab', v: 'Indent bullet' },
    { k: '⇧ Tab', v: 'Outdent bullet' },
    { k: 'Enter', v: 'New sibling bullet' },
    { k: 'Backspace (empty)', v: 'Delete bullet' },
    { k: '⌘ Enter', v: 'Zoom into focused block' },
    { k: '⌥ ↑ / ⌥ ↓', v: 'Move focused block' },
    { k: '⌘ D', v: 'Duplicate focused block' },
    { k: '⌘ Backspace', v: 'Delete focused block' },
    { k: '[[', v: 'Start wiki-link suggestion' },
    { k: '#', v: 'Start tag' },
    { k: '@remind YYYY-MM-DD', v: 'Schedule reminder' },
    { k: 'Esc', v: 'Close overlay' },
  ];
  return (
    <div>
      <H T={T} label="Keyboard shortcuts" sub="All the ways to get around faster." />
      <SettingsCard T={T}>
        {sc.map((s, i) => (
          <div key={i} style={{
            display: 'flex', alignItems: 'center',
            padding: '9px 14px',
            borderTop: i === 0 ? 'none' : `1px solid ${T.lineSub}`,
            background: i % 2 ? T.bgSub : T.bg,
          }}>
            <div style={{
              fontFamily: 'var(--mn-ui)', fontSize: 12.5, color: T.ink, flex: 1,
            }}>{s.v}</div>
            <code style={{
              fontFamily: 'var(--mn-mono)', fontSize: 11, color: T.inkMed,
              padding: '2px 7px', borderRadius: 4,
              background: T.bg, border: `1px solid ${T.lineSub}`,
            }}>{s.k}</code>
          </div>
        ))}
      </SettingsCard>
    </div>
  );
}

function SectionAbout({ T, stats }) {
  return (
    <div>
      <H T={T} label="About VispNote" sub="Local-first, markdown-native notes." />
      <SettingsCard T={T} style={{ padding: 18, background: T.bgSub, marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
          <div style={{
            width: 34, height: 34, borderRadius: 7, background: T.bgSub, border: `1px solid ${T.line}`,
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 4,
          }}><img src="assets/vispnote-icon.png" alt="" aria-hidden="true" style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }} /></div>
          <div>
            <div style={{ fontFamily: 'var(--mn-ui)', fontSize: 15, fontWeight: 600, color: T.ink }}>VispNote</div>
            <div style={{ fontFamily: 'var(--mn-mono)', fontSize: 11, color: T.inkDim }}>Version 0.1.5 · Prototype</div>
          </div>
        </div>
        <div style={{
          fontFamily: 'var(--mn-body)', fontSize: 13, color: T.inkMed, lineHeight: 1.55,
        }}>Notes you actually keep. Everything is a block, blocks nest, and every file on disk is plain markdown you own.</div>
      </SettingsCard>
      <div style={{ display: 'flex', gap: 16, marginBottom: 16, flexWrap: 'wrap' }}>
        <Stat T={T} label="Notes" value={stats.noteCount} />
        <Stat T={T} label="Tags" value={stats.tagCount} />
        <Stat T={T} label="Links" value={stats.linkCount} />
        <Stat T={T} label="Words" value={stats.wordCount.toLocaleString()} />
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <BtnOutline T={T}>Release notes</BtnOutline>
        <BtnOutline T={T}>Send feedback</BtnOutline>
      </div>
    </div>
  );
}

function Stat({ T, label, value }) {
  return (
    <div style={{
      padding: '10px 14px', border: `1px solid ${T.lineSub}`, borderRadius: 6,
      minWidth: 90, background: T.bg,
    }}>
      <div style={{
        fontFamily: 'var(--mn-body)', fontSize: 22, fontWeight: 600,
        color: T.ink, letterSpacing: '-0.02em', lineHeight: 1,
      }}>{value}</div>
      <div style={{
        fontFamily: 'var(--mn-mono)', fontSize: 9.5, color: T.inkDim,
        letterSpacing: '0.08em', textTransform: 'uppercase', marginTop: 4,
      }}>{label}</div>
    </div>
  );
}

// ───── icons ─────
const iconAppearance = (<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3"><circle cx="8" cy="8" r="5.5"/><path d="M8 2.5V13.5M2.5 8H13.5"/></svg>);
const iconEditor = (<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3"><path d="M3 12L12 3L13.5 4.5L4.5 13.5L2.5 14L3 12Z"/></svg>);
const iconNotes = (<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3"><path d="M3 2.5H11L13 4.5V13.5H3V2.5Z"/><path d="M11 2.5V4.5H13"/><path d="M5 7H11M5 9.5H11M5 12H9"/></svg>);
const iconBell = (<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3"><path d="M4 11V7C4 5 5.5 3.5 8 3.5C10.5 3.5 12 5 12 7V11L13 12.5H3L4 11Z"/><path d="M7 14H9"/></svg>);
const iconAI = (<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3"><path d="M8 2L9.5 6.5L14 8L9.5 9.5L8 14L6.5 9.5L2 8L6.5 6.5L8 2Z" strokeLinejoin="round"/><path d="M4 3.5L4.8 5.2L6.5 6L4.8 6.8L4 8.5L3.2 6.8L1.5 6L3.2 5.2L4 3.5Z" strokeLinejoin="round"/></svg>);
const iconData = (<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3"><ellipse cx="8" cy="4" rx="5" ry="1.8"/><path d="M3 4V8C3 9 5.2 10 8 10S13 9 13 8V4M3 8V12C3 13 5.2 14 8 14S13 13 13 12V8"/></svg>);
const iconKey = (<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3"><rect x="2" y="4" width="12" height="8" rx="1"/><path d="M5 7V7.01M8 7V7.01M11 7V7.01M5 10H11"/></svg>);
const iconInfo = (<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3"><circle cx="8" cy="8" r="5.5"/><path d="M8 7V11M8 5V5.01" strokeLinecap="round"/></svg>);

window.MnSettingsModal = MnSettingsModal;
