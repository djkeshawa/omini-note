import { mnPanelMiniButton } from '../../shared/panels/panelStyles.js';

function NovelistStatusSection({ T, totalDraftWords, averageWordsPerScene, unlinkedChapters, unlinkedScenes, completionCoverage, statRows, wordCountForNote, childrenForChapter, statusCounts, scenes, characterSceneCounts, maxCharacterHits, InlineEmpty }) {
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <section style={{ border: `1px solid ${T.lineSub}`, borderRadius: 8, background: T.bg, padding: 12 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 8 }}>
          {[
            ['Draft words', totalDraftWords],
            ['Avg words / scene', averageWordsPerScene],
            ['Unlinked items', unlinkedChapters.length + unlinkedScenes.length],
            ['Scene completion', `${completionCoverage}%`],
          ].map(([label, value]) => (
            <div key={label} style={{ border: `1px solid ${T.lineSub}`, borderRadius: 7, background: T.bgSub, padding: 10 }}>
              <div style={{ fontFamily: 'var(--mn-ui)', fontWeight: 600, fontSize: 11, color: T.inkDim, }}>{label}</div>
              <div style={{ marginTop: 5, fontFamily: 'var(--mn-ui)', fontSize: 22, fontWeight: 740, color: T.ink }}>{value}</div>
            </div>
          ))}
        </div>
      </section>
      <section style={{ border: `1px solid ${T.lineSub}`, borderRadius: 8, background: T.bg, padding: 12 }}>
        <div style={{ fontFamily: 'var(--mn-ui)', fontSize: 14, fontWeight: 720, color: T.ink, marginBottom: 10 }}>Word Count by Act</div>
        <div style={{ display: 'grid', gap: 8 }}>
          {statRows.map(row => (
            <div key={row.act.id} style={{ display: 'grid', gap: 6 }}>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center', fontFamily: 'var(--mn-ui)', fontSize: 12.5 }}>
                <strong style={{ color: T.ink, flex: 1 }}>{row.act.title}</strong>
                <span style={{ color: T.inkDim }}>{row.words} words</span>
              </div>
              <div style={{ height: 7, borderRadius: 999, background: T.bgSub, overflow: 'hidden' }}>
                <div style={{ width: `${Math.min(100, totalDraftWords ? (row.words / totalDraftWords) * 100 : 0)}%`, height: '100%', background: T.accent }} />
              </div>
              {row.chapters.map(chapter => (
                <div key={chapter.id} style={{ marginLeft: 12, display: 'flex', justifyContent: 'space-between', gap: 10, fontFamily: 'var(--mn-ui)', fontSize: 12, color: T.inkMed }}>
                  <span>{chapter.title}</span>
                  <span>{wordCountForNote(chapter) + childrenForChapter(chapter).reduce((sum, scene) => sum + wordCountForNote(scene), 0)} words</span>
                </div>
              ))}
            </div>
          ))}
          {!statRows.length && <InlineEmpty>Create acts to start status tracking.</InlineEmpty>}
        </div>
      </section>
      <section style={{ border: `1px solid ${T.lineSub}`, borderRadius: 8, background: T.bg, padding: 12 }}>
        <div style={{ fontFamily: 'var(--mn-ui)', fontSize: 14, fontWeight: 720, color: T.ink, marginBottom: 10 }}>Workflow Status Counts</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: 8 }}>
          {Object.entries(statusCounts).map(([status, count]) => (
            <div key={status} style={{ border: `1px solid ${T.lineSub}`, borderRadius: 7, background: T.bgSub, padding: 9 }}>
              <div style={{ fontFamily: 'var(--mn-mono)', fontSize: 10, color: T.inkDim }}>{status}</div>
              <div style={{ fontFamily: 'var(--mn-ui)', fontSize: 20, fontWeight: 700, color: T.ink, marginTop: 4 }}>{count}</div>
            </div>
          ))}
        </div>
      </section>
      <section style={{ border: `1px solid ${T.lineSub}`, borderRadius: 8, background: T.bg, padding: 12 }}>
        <div style={{ fontFamily: 'var(--mn-ui)', fontSize: 14, fontWeight: 720, color: T.ink, marginBottom: 10 }}>Character Appearance Heat Map</div>
        <div style={{ overflowX: 'auto' }}>
          <div style={{ display: 'grid', gridTemplateColumns: `140px repeat(${Math.max(1, scenes.length)}, 42px)`, gap: 3, alignItems: 'center' }}>
            <div />
            {scenes.map(scene => <div key={scene.id} title={scene.title} style={{ fontFamily: 'var(--mn-mono)', fontSize: 9, color: T.inkDim, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{scene.title}</div>)}
            {characterSceneCounts.map(row => (
              <React.Fragment key={row.note.id}>
                <div style={{ fontFamily: 'var(--mn-ui)', fontSize: 12, color: T.ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.note.title}</div>
                {row.sceneCounts.map((count, index) => (
                  <div key={`${row.note.id}:${index}`} title={`${count} mention${count === 1 ? '' : 's'}`} style={{
                    height: 24,
                    borderRadius: 4,
                    border: `1px solid ${T.lineSub}`,
                    background: count ? `color-mix(in oklab, ${T.accent} ${Math.min(85, 18 + (count / maxCharacterHits) * 67)}%, ${T.bgSub})` : T.bgSub,
                    fontFamily: 'var(--mn-mono)',
                    fontSize: 10,
                    color: count ? T.bg : T.inkDim,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}>{count || ''}</div>
                ))}
              </React.Fragment>
            ))}
          </div>
        </div>
        {!characterSceneCounts.length && <div style={{ marginTop: 8 }}><InlineEmpty>Create character notes with names:: aliases to populate the heat map.</InlineEmpty></div>}
      </section>
    </div>
  );
}

function NovelistAiConfigurationSection({ T, aiConfig, addAiPrompt, aiWordLimitDraft, setAiWordLimitDraft, commitAiWordLimit, updateAiConfig, removeAiPrompt, updateAiPrompt, InlineEmpty }) {
  return (
    <section style={{ border: `1px solid ${T.lineSub}`, borderRadius: 8, background: T.bg, padding: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <div style={{ fontFamily: 'var(--mn-ui)', fontSize: 14, fontWeight: 700, color: T.ink }}>AI Config</div>
        <div style={{ fontFamily: 'var(--mn-mono)', fontSize: 10, color: T.inkDim }}>v{aiConfig.version || 2}</div>
        <div style={{ flex: 1 }} />
        <button onClick={addAiPrompt} style={mnPanelMiniButton(T)}>+ Prompt</button>
      </div>
      <div style={{ display: 'grid', gap: 12 }}>
        <div style={{ border: `1px solid ${T.lineSub}`, borderRadius: 7, background: T.bgSub, padding: 10 }}>
          <div style={{ fontFamily: 'var(--mn-ui)', fontWeight: 600, fontSize: 11, color: T.inkDim, marginBottom: 8 }}>General</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 8 }}>
            <label style={{ display: 'grid', gap: 5, fontFamily: 'var(--mn-ui)', fontSize: 12, color: T.inkMed }}>
              <span>Preset</span>
              <select value={aiConfig.preset || ''} onChange={(e) => updateAiConfig(current => ({ ...current, preset: e.target.value }))} style={mnPanelInputStyle(T)}>
                {['Balanced draft', 'Fast outline', 'Line edit', 'Continuity pass'].map(preset => <option key={preset} value={preset}>{preset}</option>)}
              </select>
            </label>
            <label style={{ display: 'grid', gap: 5, fontFamily: 'var(--mn-ui)', fontSize: 12, color: T.inkMed }}>
              <span>Model collection</span>
              <select value={aiConfig.activeModelCollectionId || ''} onChange={(e) => updateAiConfig(current => ({ ...current, activeModelCollectionId: e.target.value }))} style={mnPanelInputStyle(T)}>
                {(aiConfig.modelCollections || []).map(collection => <option key={collection.id} value={collection.id}>{collection.name}</option>)}
              </select>
            </label>
            <label style={{ display: 'grid', gap: 5, fontFamily: 'var(--mn-ui)', fontSize: 12, color: T.inkMed }}>
              <span>Model override</span>
              <input value={aiConfig.model || ''} onChange={(e) => updateAiConfig(current => ({ ...current, model: e.target.value }))} placeholder="Use global AI model" style={mnPanelInputStyle(T)} />
            </label>
            <label style={{ display: 'grid', gap: 5, fontFamily: 'var(--mn-ui)', fontSize: 12, color: T.inkMed }}>
              <span>Prompt type</span>
              <select value={aiConfig.promptType || 'draft'} onChange={(e) => updateAiConfig(current => ({ ...current, promptType: e.target.value }))} style={mnPanelInputStyle(T)}>
                <option value="draft">Draft</option>
                <option value="revise">Revise</option>
                <option value="summarize">Summarize</option>
                <option value="analyze">Analyze</option>
              </select>
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 7, fontFamily: 'var(--mn-ui)', fontSize: 12, color: T.inkMed }}>
              <input type="checkbox" checked={aiConfig.moderation !== false} onChange={(e) => updateAiConfig(current => ({ ...current, moderation: e.target.checked }))} />
              <span>Moderation enabled</span>
            </label>
          </div>
        </div>
        <div style={{ border: `1px solid ${T.lineSub}`, borderRadius: 7, background: T.bgSub, padding: 10 }}>
          <div style={{ fontFamily: 'var(--mn-ui)', fontWeight: 600, fontSize: 11, color: T.inkDim, marginBottom: 8 }}>Instructions</div>
          <div style={{ display: 'grid', gap: 8 }}>
            <label style={{ display: 'grid', gap: 5, fontFamily: 'var(--mn-ui)', fontSize: 12, color: T.inkMed }}>
              <span>Words</span>
              <input type="number" min="100" max="12000" step="50" value={aiWordLimitDraft} onChange={(e) => setAiWordLimitDraft(e.target.value)} onBlur={commitAiWordLimit} onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }} style={{ ...mnPanelInputStyle(T), width: 150 }} />
            </label>
            <label style={{ display: 'grid', gap: 5, fontFamily: 'var(--mn-ui)', fontSize: 12, color: T.inkMed }}>
              <span>Instructions</span>
              <textarea value={aiConfig.instructions || ''} onChange={(e) => updateAiConfig(current => ({ ...current, instructions: e.target.value }))} rows={3} style={mnPanelTextareaStyle(T)} />
            </label>
            <label style={{ display: 'grid', gap: 5, fontFamily: 'var(--mn-ui)', fontSize: 12, color: T.inkMed }}>
              <span>Additional context</span>
              <textarea value={aiConfig.additionalContext || ''} onChange={(e) => updateAiConfig(current => ({ ...current, additionalContext: e.target.value }))} rows={3} style={mnPanelTextareaStyle(T)} />
            </label>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', fontFamily: 'var(--mn-ui)', fontSize: 12, color: T.inkMed }}>
              {Object.keys(aiConfig.includedComponents || {}).map(key => (
                <label key={key} style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
                  <input type="checkbox" checked={!!aiConfig.includedComponents?.[key]} onChange={(e) => updateAiConfig(current => ({ ...current, includedComponents: { ...(current.includedComponents || {}), [key]: e.target.checked } }))} />
                  <span>{key.replace(/([A-Z])/g, ' $1')}</span>
                </label>
              ))}
            </div>
          </div>
        </div>
        <div style={{ border: `1px solid ${T.lineSub}`, borderRadius: 7, background: T.bgSub, padding: 10 }}>
          <div style={{ fontFamily: 'var(--mn-ui)', fontWeight: 600, fontSize: 11, color: T.inkDim, marginBottom: 8 }}>Advanced</div>
          <div style={{ display: 'grid', gap: 8 }}>
            <label style={{ display: 'grid', gap: 5, fontFamily: 'var(--mn-ui)', fontSize: 12, color: T.inkMed }}>
              <span>System message</span>
              <textarea value={aiConfig.systemMessage || ''} onChange={(e) => updateAiConfig(current => ({ ...current, systemMessage: e.target.value }))} rows={3} style={mnPanelTextareaStyle(T)} />
            </label>
            <label style={{ display: 'grid', gap: 5, fontFamily: 'var(--mn-ui)', fontSize: 12, color: T.inkMed }}>
              <span>User message</span>
              <textarea value={aiConfig.userMessage || ''} onChange={(e) => updateAiConfig(current => ({ ...current, userMessage: e.target.value }))} rows={3} style={mnPanelTextareaStyle(T)} />
            </label>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 8 }}>
              <label style={{ display: 'grid', gap: 5, fontFamily: 'var(--mn-ui)', fontSize: 12, color: T.inkMed }}>
                <span>Temperature</span>
                <input value={aiConfig.advanced?.temperature || ''} onChange={(e) => updateAiConfig(current => ({ ...current, advanced: { ...(current.advanced || {}), temperature: e.target.value } }))} placeholder="provider default" style={mnPanelInputStyle(T)} />
              </label>
              <label style={{ display: 'grid', gap: 5, fontFamily: 'var(--mn-ui)', fontSize: 12, color: T.inkMed }}>
                <span>Max tokens</span>
                <input value={aiConfig.advanced?.maxTokens || ''} onChange={(e) => updateAiConfig(current => ({ ...current, advanced: { ...(current.advanced || {}), maxTokens: e.target.value } }))} placeholder="provider default" style={mnPanelInputStyle(T)} />
              </label>
            </div>
          </div>
        </div>
      </div>
      {!!(aiConfig.prompts || []).length && (
        <label style={{ display: 'grid', gap: 5, margin: '12px 0 10px', fontFamily: 'var(--mn-ui)', fontSize: 12, color: T.inkMed }}>
          <span>Default writing prompt</span>
          <select
            value={aiConfig.defaultPromptId || ''}
            onChange={(e) => updateAiConfig(current => ({ ...current, defaultPromptId: e.target.value }))}
            style={{ ...mnPanelInputStyle(T), maxWidth: 260 }}>
            {(aiConfig.prompts || []).map(prompt => (
              <option key={prompt.id} value={prompt.id}>{prompt.name || 'Untitled prompt'}</option>
            ))}
          </select>
        </label>
      )}
      <div style={{ display: 'grid', gap: 8 }}>
        {(aiConfig.prompts || []).map(prompt => (
          <div
            key={prompt.id}
            style={{
              border: `1px solid ${T.lineSub}`,
              borderRadius: 7,
              background: T.bgSub,
              padding: 8,
            }}>
            <div style={{ display: 'flex', gap: 7, alignItems: 'center', marginBottom: 7 }}>
              <input
                aria-label="Prompt name"
                value={prompt.name}
                onChange={(e) => updateAiPrompt(prompt.id, { name: e.target.value })}
                placeholder="Prompt name"
                style={{
                  minWidth: 0,
                  flex: 1,
                  border: `1px solid ${T.lineSub}`,
                  borderRadius: 6,
                  background: T.bg,
                  color: T.ink,
                  padding: '6px 8px',
                  fontFamily: 'var(--mn-ui)',
                  fontSize: 12.5,
                  outline: 'none',
                }}
              />
              <button
                onClick={() => removeAiPrompt(prompt.id)}
                style={{ ...mnPanelMiniButton(T), color: T.inkDim }}>
                Remove
              </button>
            </div>
            <textarea
              aria-label={`${prompt.name || 'Prompt'} instructions`}
              value={prompt.prompt}
              onChange={(e) => updateAiPrompt(prompt.id, { prompt: e.target.value })}
              placeholder="Writing prompt"
              rows={3}
              style={{
                width: '100%',
                minHeight: 76,
                resize: 'vertical',
                border: `1px solid ${T.lineSub}`,
                borderRadius: 6,
                background: T.bg,
                color: T.ink,
                padding: '7px 8px',
                fontFamily: 'var(--mn-body)',
                fontSize: 12.5,
                lineHeight: 1.45,
                outline: 'none',
                boxSizing: 'border-box',
              }}
            />
          </div>
        ))}
        {!(aiConfig.prompts || []).length && <InlineEmpty>Add a prompt for AI writing.</InlineEmpty>}
      </div>
    </section>
  );
}

export { NovelistStatusSection, NovelistAiConfigurationSection };
import { mnPanelInputStyle, mnPanelTextareaStyle } from '../../shared/panels/panelStyles.js';
