import { H, SettingsCard, Row, Segmented, Toggle, Select, FontSizeStepper } from '../settingsControls.jsx';
import { SectionPlugins } from './PluginSection.jsx';

import { MN_PLUGINS as MN_SETTINGS_PLUGINS } from '../../shared/plugins.js';
import MN_FEATURES from '../../app/featureRegistry.js';
import { mnSettingsInput } from '../settingsPrimitives.jsx';

const SIDEBAR_MORE_DESTINATIONS = [
  {
    key: 'showTodayInSidebar',
    label: 'Today',
    sub: 'Show the Today dashboard shortcut inside More.',
  },
  {
    key: 'showThinkingBoardInSidebar',
    label: 'Thinking Board',
    sub: 'Show this shortcut inside More whenever Thinking Board is available.',
  },
  {
    key: 'showWorkflowInSidebar',
    label: 'Workflow',
    sub: 'Show the Workflow board and status shortcuts inside More whenever Workflow is available.',
  },
  {
    key: 'showQuickCaptureInSidebar',
    label: 'Quick Capture',
    sub: 'Show a second Quick Capture shortcut inside More; the app-bar action stays available.',
  },
];

function SectionAppearance({ tweaks, setTweak, T, themeOptions = [] }) {
  const builtIns = [
    { value: 'light', label: 'Light' },
    { value: 'dark', label: 'Dark' },
    { value: 'pastel', label: 'Pastel' },
  ];
  const currentLegacyTheme = !builtIns.some(option => option.value === tweaks.theme)
    ? themeOptions.find(option => option.value === tweaks.theme)
    : null;
  const options = currentLegacyTheme ? [...builtIns, { ...currentLegacyTheme, label: `${currentLegacyTheme.label} (existing)` }] : builtIns;
  return (
    <div>
      <H T={T} label="General" sub="Comfortable defaults with only the choices that matter every day." />
      <SettingsCard T={T}>
        <Row T={T} label="Theme" sub="Choose a curated VispNote theme.">
          <select value={tweaks.theme || 'light'} onChange={(e) => setTweak('theme', e.target.value)} style={{
            padding: '6px 10px',
            borderRadius: 6,
            border: `1px solid ${T.line}`,
            background: T.bg,
            color: T.ink,
            fontFamily: 'var(--mn-ui)',
            fontSize: 12.5,
            cursor: 'pointer',
            minWidth: 190,
            outline: 'none',
          }}>
            {options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </Row>
        <Row T={T} label="Interface density" sub="Tighter rows fit more on screen.">
          <Segmented T={T} value={tweaks.density} onChange={v => setTweak('density', v)}
            options={[{ value: 'comfortable', label: 'Comfortable' }, { value: 'compact', label: 'Compact' }]} />
        </Row>
        <Row T={T} label="App font size" sub="Scale the interface for comfortable reading." last>
          <FontSizeStepper T={T} value={tweaks.appFontSize || 'default'} onChange={v => setTweak('appFontSize', v)} />
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
        <Row T={T} label="Show pinned notes first" sub="Pin a note from its toolbar." last>
          <Toggle T={T} checked={tweaks.pinnedFirst !== false} onChange={v => setTweak('pinnedFirst', v)} />
        </Row>
      </SettingsCard>
      <details style={{ marginTop: 12 }}>
        <summary style={{ cursor: 'pointer', fontFamily: 'var(--mn-ui)', fontSize: 12.5, color: T.inkMed, marginBottom: 10 }}>
          Advanced Today and graph preferences
        </summary>
      <SettingsCard T={T}>
        <Row T={T} label="Today heading format" sub="How Today view groups notes.">
          <Segmented T={T} value={tweaks.rollupFormat || 'long'}
            onChange={v => setTweak('rollupFormat', v)}
            options={[{ value: 'long', label: 'Long' }, { value: 'short', label: 'Short' }]} />
        </Row>
        <Row T={T} label="Today dashboard default range" sub="Initial range used when opening Today.">
          <Segmented T={T} value={tweaks.rollupDefaultRange || 'today'}
            onChange={v => setTweak('rollupDefaultRange', v)}
            options={[{ value: 'today', label: 'Today' }, { value: 'yesterday', label: 'Yesterday' }, { value: 'week', label: 'This week' }, { value: 'month', label: 'This month' }]} />
        </Row>
        <Row T={T} label="Today dashboard grouping" sub="Date source used for day groups.">
          <Segmented T={T} value={tweaks.rollupGroupBy || 'created'}
            onChange={v => setTweak('rollupGroupBy', v)}
            options={[{ value: 'created', label: 'Created' }, { value: 'modified', label: 'Modified' }, { value: 'title-date', label: 'Title date' }]} />
        </Row>
        <Row T={T} label="Show Today previews" sub="Show a short note excerpt in Today.">
          <Toggle T={T} checked={tweaks.rollupShowPreviews !== false} onChange={v => setTweak('rollupShowPreviews', v)} />
        </Row>
        <Row T={T} label="Show Today open loops" sub="Show open checklist items in Today.">
          <Toggle T={T} checked={tweaks.rollupShowTasks !== false} onChange={v => setTweak('rollupShowTasks', v)} />
        </Row>
        <Row T={T} label="Show Today reminders" sub="Show overdue and due reminders in Today.">
          <Toggle T={T} checked={tweaks.rollupShowReminders !== false} onChange={v => setTweak('rollupShowReminders', v)} />
        </Row>
        <Row T={T} label="Collapse older Today days" sub="Keep older Today day groups compact by default.">
          <Toggle T={T} checked={tweaks.rollupCollapseOlder !== false} onChange={v => setTweak('rollupCollapseOlder', v)} />
        </Row>
        <Row T={T} label="Graph style" sub="How connection overlay is drawn." last>
          <Segmented T={T} value={tweaks.graphStyle} onChange={v => setTweak('graphStyle', v)}
            options={[{ value: 'force', label: 'Force' }, { value: 'timeline', label: 'Timeline' }, { value: 'cluster', label: 'Cluster' }]} />
        </Row>
      </SettingsCard>
      </details>
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
          <Segmented T={T} value={tweaks.weekStart || 'monday'}
            onChange={v => setTweak('weekStart', v)}
            options={[{ value: 'monday', label: 'Monday' }, { value: 'sunday', label: 'Sunday' }]} />
        </Row>
      </SettingsCard>
    </div>
  );
}


function SectionAdvanced({ tweaks, setTweak, T, enabledPacks = [], featureState = {}, onSetPack }) {
  const packs = MN_FEATURES.PACKS || [];
  const inferred = new Set(featureState.inferred || []);
  const plugins = MN_SETTINGS_PLUGINS.normalizeAll ? MN_SETTINGS_PLUGINS.normalizeAll(tweaks.plugins) : [];
  return (
    <div>
      <H T={T} label="More menu items" sub="Choose which optional destinations appear when More is expanded." />
      <SettingsCard T={T}>
        {SIDEBAR_MORE_DESTINATIONS.map((item, index) => (
          <Row key={item.key} T={T} label={item.label} sub={item.sub}
            last={index === SIDEBAR_MORE_DESTINATIONS.length - 1}>
            <Toggle
              T={T}
              checked={tweaks[item.key] === true}
              label={`Toggle ${item.label} in More`}
              onChange={value => setTweak(item.key, value)}
            />
          </Row>
        ))}
      </SettingsCard>
      <div style={{ marginTop: 28 }}>
        <H T={T} label="Optional packs" sub="Enable specialist tools only when they support your work." />
        <SettingsCard T={T}>
          {packs.map((pack, index) => {
            // The toggle reports whether you turned the pack on, not whether its
            // views happen to be showing. Those are different things: a pack is
            // also revealed by matching notes, and reading that back as "on" left
            // the control checked and disabled with nothing the user could do —
            // which is how a vault with workflow notes but no dated ones ended up
            // unable to reach Agenda at all.
            const checked = enabledPacks.includes(pack.id);
            const detected = inferred.has(pack.id);
            const note = detected
              ? (checked
                ? ' Also found in your notes, so its views stay even if you turn this off.'
                : ' Already showing where your notes support it. Turn on for the rest.')
              : '';
            return (
              <Row key={pack.id} T={T} label={pack.label}
                sub={`${pack.description}${note}`}
                last={index === packs.length - 1}>
                <Toggle T={T} checked={checked}
                  label={`${checked ? 'Disable' : 'Enable'} ${pack.label} pack`}
                  dataId={pack.id}
                  onChange={value => onSetPack?.(pack.id, value)} />
              </Row>
            );
          })}
        </SettingsCard>
      </div>
      {plugins.length > 0 && <SectionPlugins tweaks={tweaks} setTweak={setTweak} T={T} />}
      {plugins.length === 0 && (
        <div style={{ marginTop: 14, padding: '11px 13px', borderRadius: 7, border: `1px solid ${T.lineSub}`, background: T.bgSub, color: T.inkMed, fontSize: 12.5, lineHeight: 1.5 }}>
          Legacy no-code action creation is hidden. Quick Capture and templates are built in; Research and Agents are available as packs.
        </div>
      )}
    </div>
  );
}

export { SectionAppearance, SectionEditor, SectionNotes, SectionReminders, SectionAdvanced };
