// Main App — composes sidebar, note list, editor, panels, overlays.
// Disk-backed via window.mn (Electron preload IPC). Falls back to in-memory
// seed when running outside Electron (e.g. opened directly in a browser).

const { useState: useStateA, useEffect: useEffectA, useMemo: useMemoA, useCallback: useCallbackA, useRef: useRefA } = React;

const MN_TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "theme": "light",
  "density": "comfortable",
  "graphStyle": "force",
  "todoVariant": "list",
  "toastVariant": "card",
  "fontChoice": "Editorial (Newsreader + Inter)",
  "showNoteList": true,
  "showSidebar": true,
  "editorWidth": "medium",
  "fontSize": "default",
  "appFontSize": "default",
  "indentGuides": true,
  "spellCheck": true,
  "autoLink": true,
  "collapseByDefault": false,
  "sortBy": "modified",
  "defaultTags": "",
  "pinnedFirst": true,
  "rollupFormat": "long",
  "reminderSound": false,
  "showOverdue": true,
  "snoozeMinutes": "15",
  "weekStart": "monday",
  "workflowStates": null,
  "autoSave": true,
  "storageFormat": "markdown",
  "sync": "local"
}/*EDITMODE-END*/;

const MN_NOVELIST_TAGS = [
  { name: 'novel-act', hue: 30 },
  { name: 'novel-chapter', hue: 220 },
  { name: 'novel-scene', hue: 190 },
  { name: 'novel-character', hue: 330 },
  { name: 'novel-location', hue: 145 },
  { name: 'novel-plot', hue: 35 },
  { name: 'novel-research', hue: 280 },
  { name: 'novel-revision', hue: 15 },
];

const MN_NOVELIST_WORKFLOW_STATES = [
  { id: 'IDEA', next: 'OUTLINE', color: 'oklch(0.55 0.17 35)', bg: 'oklch(0.96 0.04 35)' },
  { id: 'OUTLINE', next: 'DRAFT', color: 'oklch(0.55 0.15 250)', bg: 'oklch(0.95 0.04 250)' },
  { id: 'DRAFT', next: 'REVISE', color: 'oklch(0.55 0.14 205)', bg: 'oklch(0.95 0.04 205)' },
  { id: 'REVISE', next: 'FINAL', color: 'oklch(0.55 0.16 290)', bg: 'oklch(0.95 0.04 290)' },
  { id: 'FINAL', next: null, color: 'oklch(0.55 0.15 145)', bg: 'oklch(0.95 0.04 145)' },
];

const MN_APP_HELPERS = window.MN_APP_HELPERS || {};
const MN_APP_MUTATIONS = window.MN_APP_MUTATIONS || {};
const MN_APP_CANVAS_ACTIONS = window.MN_APP_CANVAS_ACTIONS || {};
const MN_NOTE_TEMPLATES = MN_APP_HELPERS.NOTE_TEMPLATES || [];

const MN_NOVELIST_STARTERS = [
  {
    title: 'Act 1',
    tags: ['novel-act'],
    body: 'status:: OUTLINE\norder:: 100\npurpose:: \n## Chapters\n- [[Chapter 1]]\n- Major turn\n- Open questions',
  },
  {
    title: 'Chapter 1',
    tags: ['novel-chapter'],
    body: 'status:: OUTLINE\norder:: 110\nact:: [[Act 1]]\n## Scenes\n- [[Scene 1]]\n- Chapter goal\n- Scene list\n- Revision notes',
  },
  {
    title: 'Scene 1',
    tags: ['novel-scene'],
    body: 'status:: DRAFT\norder:: 111\nact:: [[Act 1]]\nchapter:: [[Chapter 1]]\npov:: \npurpose:: \n::: plot-points\n- Opening beat\n:::\nDraft the scene here.',
  },
  {
    title: 'Characters',
    tags: ['novel-character'],
    body: '- Create one note per major character.\n- Track goals, secrets, relationships, and changes.',
  },
  {
    title: 'Locations',
    tags: ['novel-location'],
    body: '- Capture places, sensory details, constraints, and recurring imagery.',
  },
  {
    title: 'Plot Threads',
    tags: ['novel-plot'],
    body: 'status:: IDEA\n- Main promise of the story\n- Act turns\n- Open continuity questions',
  },
  {
    title: 'Research',
    tags: ['novel-research'],
    body: '- Sources, facts, questions, and reminders that support the novel.',
  },
  {
    title: 'Revision Notes',
    tags: ['novel-revision'],
    body: 'status:: IDEA\n- Changes to make in the next pass.',
  },
];

function mnNovelistNoteId(title, vaultId = '') {
  return MN_APP_HELPERS.novelistNoteId(title, vaultId);
}

function mnEnsureNovelistTags(existingTags = []) {
  return MN_APP_HELPERS.ensureNovelistTags(existingTags, MN_NOVELIST_TAGS);
}

function mnBuildNovelistStarterNotes(notes = [], mnMdToBlocks, vaultId = '') {
  return MN_APP_HELPERS.buildNovelistStarterNotes(notes, mnMdToBlocks, vaultId, MN_NOVELIST_STARTERS);
}

function mnDirtyNoteKey(vaultId, noteId) {
  return MN_APP_HELPERS.dirtyNoteKey(vaultId, noteId);
}

function mnIsNovelistNote(note) {
  return MN_APP_HELPERS.isNovelistNote(note);
}

function mnNormalizeNovelistLegacyTags(tags = []) {
  return MN_APP_HELPERS.normalizeNovelistLegacyTags(tags);
}

function mnNormalizeNovelistLegacyBody(body = '') {
  return MN_APP_HELPERS.normalizeNovelistLegacyBody(body);
}

function mnEnsureScenePlotPoints(body = '', tags = []) {
  return MN_APP_HELPERS.ensureScenePlotPoints(body, tags);
}

function mnNovelTitleKey(title) {
  return MN_APP_HELPERS.novelTitleKey(title);
}

function mnNovelWikiTitles(body = '') {
  return MN_APP_HELPERS.novelWikiTitles(body);
}

function mnReplaceWikiLinkTitle(body = '', oldTitle = '', newTitle = '') {
  return MN_APP_HELPERS.replaceWikiLinkTitle(body, oldTitle, newTitle);
}

function mnBodyPropertyLineRe(key = '') {
  return MN_APP_HELPERS.bodyPropertyLineRe(key);
}

function mnBodyPropertyValue(body = '', key = '') {
  return MN_APP_HELPERS.bodyPropertyValue(body, key);
}

function mnBodyPropertyTitle(body = '', key = '') {
  return MN_APP_HELPERS.bodyPropertyTitle(body, key);
}

function mnBodyPropertyInsertIndex(lines) {
  return MN_APP_HELPERS.bodyPropertyInsertIndex(lines);
}

function mnSetBodyProperty(body = '', key = '', value = '') {
  return MN_APP_HELPERS.setBodyProperty(body, key, value);
}

function mnRemoveBodyProperty(body = '', key = '') {
  return MN_APP_HELPERS.removeBodyProperty(body, key);
}

function mnBodyPropertyParts(line = '') {
  return MN_APP_HELPERS.bodyPropertyParts(line);
}

function mnNormalizeBodyPropertySyntax(body = '') {
  return MN_APP_HELPERS.normalizeBodyPropertySyntax(body);
}

function mnStripDuplicateTitleHeading(body = '', title = '') {
  return MN_APP_HELPERS.stripDuplicateTitleHeading(body, title);
}

function mnNormalizeNoteBody(body = '', title = '') {
  return MN_APP_HELPERS.normalizeNoteBody(body, title);
}

function mnNoteOrderValue(note) {
  return MN_APP_HELPERS.noteOrderValue(note);
}

function mnCompareStoryNotes(a, b) {
  return MN_APP_HELPERS.compareStoryNotes(a, b);
}

function mnNovelOutlineLinks(body = '') {
  return MN_APP_HELPERS.novelOutlineLinks(body);
}

function mnNovelPropertyTitle(body = '', key = '') {
  return MN_APP_HELPERS.novelPropertyTitle(body, key);
}

function mnNovelHasWikiLink(body = '', title = '') {
  return MN_APP_HELPERS.novelHasWikiLink(body, title);
}

function mnNovelEnsureWikiLink(body = '', title = '') {
  return MN_APP_HELPERS.novelEnsureWikiLink(body, title);
}

function mnNovelEnsureWikiLinkInSection(body = '', title = '', sectionTitle = '') {
  return MN_APP_HELPERS.novelEnsureWikiLinkInSection(body, title, sectionTitle);
}

function mnNovelUpsertPropertyLink(body = '', key = '', title = '') {
  return MN_APP_HELPERS.novelUpsertPropertyLink(body, key, title);
}

function mnBuildNovelistStructure(notes = []) {
  return MN_APP_HELPERS.buildNovelistStructure(notes);
}

// Convert raw notes (with markdown body) to runtime form (with parsed blocks).
function normalizeNotes(notes, mnMdToBlocks) {
  return MN_APP_HELPERS.normalizeNotes(notes, mnMdToBlocks);
}

// Strip in-memory-only fields before persisting to disk.
function noteForDisk(n, mnBlocksToMd) {
  return MN_APP_HELPERS.noteForDisk(n, mnBlocksToMd);
}

function mnNormalizeNoteStatus(raw, states = []) {
  return MN_APP_HELPERS.normalizeWorkflowStatus
    ? MN_APP_HELPERS.normalizeWorkflowStatus(raw, states, window.MN_LOGSEQ?.mnNormalizeWorkflowId)
    : ((states || []).some(state => state.id === String(raw || '').trim().toUpperCase()) ? String(raw || '').trim().toUpperCase() : '');
}

function mnWorkflowNotePreview(note) {
  return MN_APP_HELPERS.workflowNotePreview ? MN_APP_HELPERS.workflowNotePreview(note) : String(note?.body || '').slice(0, 180);
}

function collectWorkflowNotes(notes, states) {
  return MN_APP_HELPERS.collectWorkflowNotes
    ? MN_APP_HELPERS.collectWorkflowNotes(notes, states, {
      propertyValue: mnBodyPropertyValue,
      normalizeId: window.MN_LOGSEQ?.mnNormalizeWorkflowId,
    })
    : { counts: {}, byState: {}, noteIdsByState: {}, archivedNotes: [], total: 0 };
}

function collectWorkflowBlocks(notes, states) {
  return collectWorkflowNotes(notes, states);
}

function normalizeTagName(name) {
  return MN_APP_HELPERS.normalizeTagName(name);
}

function mnParseDefaultTags(value) {
  return MN_APP_HELPERS.parseDefaultTags(value);
}

function mnNormalizeWorkflowStatesForApp(states) {
  if (Array.isArray(states) && states.length === 0) return [];
  return (window.MN_LOGSEQ?.mnNormalizeWorkflowStates || ((value) => value))(
    Array.isArray(states) && states.length
      ? states
      : (window.MN_LOGSEQ?.DEFAULT_WORKFLOW_STATES || window.MN_LOGSEQ?.WORKFLOW_STATES || [])
  );
}

function mnReminderKey(item) {
  return MN_APP_HELPERS.reminderKey ? MN_APP_HELPERS.reminderKey(item) : [item.noteId, item.line ?? item.blockId ?? '', item.remindAt?.date || '', item.remindAt?.time || '', item.text || ''].join('|');
}

function mnReadSnoozedReminders() {
  try { return JSON.parse(localStorage.getItem('mn:snoozedReminders') || '{}') || {}; }
  catch { return {}; }
}

function mnWriteSnoozedReminder(key, until) {
  const data = mnReadSnoozedReminders();
  data[key] = until;
  try { localStorage.setItem('mn:snoozedReminders', JSON.stringify(data)); } catch (e) {}
}

function mnCollectReminderItems(notes) {
  return MN_APP_HELPERS.collectReminderItems
    ? MN_APP_HELPERS.collectReminderItems(notes, window.MN_REMIND, window.mnWalk)
    : [];
}

function mnPlayReminderSound() {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = 740;
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.05, ctx.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.22);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.24);
    setTimeout(() => ctx.close?.(), 400);
  } catch (e) {}
}

function mnReminderDisplayDate(item) {
  return MN_APP_HELPERS.reminderDisplayDate ? MN_APP_HELPERS.reminderDisplayDate(item) : '';
}

function mnReminderStatusLabel(status) {
  return MN_APP_HELPERS.reminderStatusLabel ? MN_APP_HELPERS.reminderStatusLabel(status) : 'Upcoming';
}

const MN_LAUNCH_BLOOMS = [
  { color: '#f3bfd8', duration: '7.6s', delay: '-1.2s' },
  { color: '#a9c2ff', duration: '8.8s', delay: '-3.4s' },
  { color: '#9fe2c9', duration: '9.6s', delay: '-5.1s' },
];

function MnBootLogo() {
  return (
    <div className="mn-boot-brand" aria-label="VispNote">
      <img className="mn-boot-logo" src="assets/vispnote-loading-transparent.png" alt="VispNote" />
      <div className="mn-boot-title mn-boot-wordmark">VispNote</div>
      <div className="mn-boot-tagline"><span>Capture</span><i /><span>Organize</span><i /><span>Remember</span></div>
    </div>
  );
}

function MnLaunchScreen({ state, error, T }) {
  const loading = state === 'loading';
  return (
    <div className="mn-boot-splash" style={{ position: 'relative', zIndex: 'auto', width: '100vw', height: '100vh' }}>
      <div className="mn-boot-grid" />
      <div className="mn-boot-light-field" aria-hidden="true">
        {MN_LAUNCH_BLOOMS.map((item, i) => (
          <span
            key={`${item.color}-${i}`}
            className="mn-light-bloom"
            style={{
              '--bloom-color': item.color,
              '--bloom-duration': item.duration,
              '--bloom-delay': item.delay,
              animationPlayState: loading ? 'running' : 'paused',
            }}
          />
        ))}
      </div>
      <div className="mn-boot-core">
        <MnBootLogo />
        <div className="mn-boot-subtitle" style={{ color: loading ? '#667187' : '#b84b42' }}>
          {loading ? 'Connecting your workspace' : 'Launch interrupted'}
        </div>

        {loading ? (
          <>
            <div className="mn-boot-status">Opening vault and indexing notes</div>
            <div className="mn-boot-progress"><div /></div>
          </>
        ) : (
          <div style={{
            position: 'relative',
            zIndex: 1,
            width: 'min(420px, calc(100vw - 48px))',
            marginTop: 24,
            padding: '12px 14px',
            borderRadius: 8,
            background: 'rgba(255,255,255,0.56)',
            border: '1px solid rgba(120,130,152,0.22)',
            color: '#56647c',
            fontFamily: 'var(--mn-mono)',
            fontSize: 11,
            lineHeight: 1.55,
            textAlign: 'left',
            wordBreak: 'break-word',
          }}>{error || 'Unknown startup error'}</div>
        )}
      </div>
    </div>
  );
}

const HAS_DISK = typeof window !== 'undefined' && !!window.mn;

function MnDeleteNoteDialog({ note, T, onCancel, onConfirm }) {
  const cancelRef = useRefA(null);

  useEffectA(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onCancel && onCancel();
    };
    window.addEventListener('keydown', onKey);
    const handle = setTimeout(() => cancelRef.current?.focus(), 0);
    return () => {
      window.removeEventListener('keydown', onKey);
      clearTimeout(handle);
    };
  }, [onCancel]);

  if (!note) return null;
  const blockCount = (window.MN_OUTLINE?.mnFlatten?.(note.blocks || [], 0, false) || []).length;
  const tagText = (note.tags || []).length
    ? (note.tags || []).map(t => `#${t}`).join(' ')
    : 'No tags';

  const btnBase = {
    height: 32,
    padding: '0 13px',
    borderRadius: 6,
    cursor: 'pointer',
    fontFamily: 'var(--mn-ui)',
    fontSize: 12.5,
    fontWeight: 600,
  };

  return (
    <div
      className="mn-delete-note-dialog"
      onClick={onCancel}
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 90,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: `color-mix(in oklab, ${T.ink} 30%, transparent)`,
        backdropFilter: 'blur(2px)',
        animation: 'mnFadeIn 120ms ease',
      }}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="mn-delete-note-title"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 420,
          maxWidth: 'calc(100vw - 40px)',
          background: T.bg,
          color: T.ink,
          border: `1px solid ${T.line}`,
          borderRadius: 10,
          boxShadow: `0 24px 70px color-mix(in oklab, ${T.ink} 26%, transparent)`,
          overflow: 'hidden',
          fontFamily: 'var(--mn-ui)',
        }}>
        <div style={{
          display: 'flex',
          gap: 12,
          padding: '18px 18px 14px',
          borderBottom: `1px solid ${T.lineSub}`,
          background: T.bgSub,
        }}>
          <div style={{
            width: 34,
            height: 34,
            borderRadius: 8,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
            color: T.danger,
            background: `color-mix(in oklab, ${T.danger} 12%, transparent)`,
            border: `1px solid color-mix(in oklab, ${T.danger} 24%, ${T.lineSub})`,
          }}>
            <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.45">
              <path d="M3 4.5H13M6 4.5V3C6 2.5 6.5 2 7 2H9C9.5 2 10 2.5 10 3V4.5M5 4.5V13C5 13.5 5.5 14 6 14H10C10.5 14 11 13.5 11 13V4.5" strokeLinecap="round"/>
            </svg>
          </div>
          <div style={{ minWidth: 0 }}>
            <div id="mn-delete-note-title" style={{
              fontSize: 15,
              fontWeight: 700,
              color: T.ink,
              marginBottom: 4,
            }}>Delete note?</div>
            <div style={{
              fontFamily: 'var(--mn-body)',
              fontSize: 13,
              lineHeight: 1.45,
              color: T.inkMed,
            }}>This moves the note to Recently deleted for 30 days.</div>
          </div>
        </div>
        <div style={{ padding: '16px 18px 10px' }}>
          <div style={{
            border: `1px solid ${T.lineSub}`,
            borderRadius: 8,
            background: T.bgSub,
            padding: '11px 12px',
          }}>
            <div style={{
              fontSize: 13.5,
              fontWeight: 650,
              color: T.ink,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              marginBottom: 5,
            }}>{note.title || 'Untitled'}</div>
            <div style={{
              display: 'flex',
              gap: 8,
              flexWrap: 'wrap',
              fontSize: 11.5,
              color: T.inkDim,
            }}>
              <span>{blockCount} {blockCount === 1 ? 'block' : 'blocks'}</span>
              <span style={{ color: T.line }}>•</span>
              <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{tagText}</span>
            </div>
          </div>
          <div style={{
            marginTop: 11,
            fontFamily: 'var(--mn-body)',
            fontSize: 12.5,
            lineHeight: 1.45,
            color: T.inkMed,
          }}>You can restore this note from Settings → Data & Sync.</div>
        </div>
        <div style={{
          display: 'flex',
          justifyContent: 'flex-end',
          gap: 8,
          padding: '12px 18px 16px',
        }}>
          <button
            ref={cancelRef}
            onClick={onCancel}
            style={{
              ...btnBase,
              background: T.bg,
              color: T.inkMed,
              border: `1px solid ${T.line}`,
            }}>
            Cancel
          </button>
          <button
            onClick={onConfirm}
            style={{
              ...btnBase,
              background: T.danger,
              color: T.bg,
              border: `1px solid ${T.danger}`,
              boxShadow: `0 8px 20px color-mix(in oklab, ${T.danger} 20%, transparent)`,
            }}>
            Move to trash
          </button>
        </div>
      </div>
    </div>
  );
}

function MnAppNoticeDialog({ notice, T, onClose }) {
  const closeRef = useRefA(null);

  useEffectA(() => {
    if (!notice) return;
    const onKey = (e) => {
      if (e.key === 'Escape' || e.key === 'Enter') onClose && onClose();
    };
    window.addEventListener('keydown', onKey);
    const handle = setTimeout(() => closeRef.current?.focus(), 0);
    return () => {
      window.removeEventListener('keydown', onKey);
      clearTimeout(handle);
    };
  }, [notice, onClose]);

  if (!notice) return null;
  const title = notice.title || 'Something went wrong';
  const message = notice.message || notice.error || 'The operation could not be completed.';

  return (
    <div
      className="mn-app-notice-dialog"
      onClick={onClose}
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 92,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: `color-mix(in oklab, ${T.ink} 26%, transparent)`,
        backdropFilter: 'blur(2px)',
        animation: 'mnFadeIn 120ms ease',
      }}>
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="mn-app-notice-title"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 400,
          maxWidth: 'calc(100vw - 40px)',
          background: T.bg,
          color: T.ink,
          border: `1px solid ${T.line}`,
          borderRadius: 10,
          boxShadow: `0 24px 70px color-mix(in oklab, ${T.ink} 24%, transparent)`,
          overflow: 'hidden',
          fontFamily: 'var(--mn-ui)',
        }}>
        <div style={{
          display: 'flex',
          gap: 12,
          padding: '17px 18px 14px',
          borderBottom: `1px solid ${T.lineSub}`,
          background: T.bgSub,
        }}>
          <div style={{
            width: 34,
            height: 34,
            borderRadius: 8,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
            color: notice.tone === 'warn' ? T.warn : T.danger,
            background: `color-mix(in oklab, ${notice.tone === 'warn' ? T.warn : T.danger} 12%, transparent)`,
            border: `1px solid color-mix(in oklab, ${notice.tone === 'warn' ? T.warn : T.danger} 24%, ${T.lineSub})`,
          }}>
            <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.45">
              <path d="M8 2L14 13H2L8 2Z" strokeLinejoin="round"/>
              <path d="M8 6V9M8 11.7V11.8" strokeLinecap="round"/>
            </svg>
          </div>
          <div style={{ minWidth: 0 }}>
            <div id="mn-app-notice-title" style={{
              fontSize: 15,
              fontWeight: 700,
              color: T.ink,
              marginBottom: 4,
            }}>{title}</div>
            <div style={{
              fontFamily: 'var(--mn-body)',
              fontSize: 13,
              lineHeight: 1.45,
              color: T.inkMed,
              whiteSpace: 'pre-wrap',
              overflowWrap: 'anywhere',
            }}>{message}</div>
          </div>
        </div>
        <div style={{
          display: 'flex',
          justifyContent: 'flex-end',
          padding: '12px 18px 16px',
        }}>
          <button
            ref={closeRef}
            onClick={onClose}
            style={{
              height: 32,
              padding: '0 14px',
              borderRadius: 6,
              cursor: 'pointer',
              fontFamily: 'var(--mn-ui)',
              fontSize: 12.5,
              fontWeight: 650,
              background: T.ink,
              color: T.bg,
              border: `1px solid ${T.ink}`,
            }}>
            OK
          </button>
        </div>
      </div>
    </div>
  );
}

function MnSaveConflictDialog({ conflict, T, onReloadDisk, onKeepCopy, onDismiss }) {
  if (!conflict) return null;
  const when = conflict.currentModifiedAt ? new Date(conflict.currentModifiedAt).toLocaleString() : 'recently';
  const btn = (tone = 'default') => ({
    height: 32,
    padding: '0 12px',
    borderRadius: 6,
    cursor: 'pointer',
    fontFamily: 'var(--mn-ui)',
    fontSize: 12.5,
    fontWeight: 650,
    background: tone === 'primary' ? T.ink : T.bg,
    color: tone === 'primary' ? T.bg : T.inkMed,
    border: `1px solid ${tone === 'primary' ? T.ink : T.line}`,
  });
  return (
    <div className="mn-save-conflict-dialog" onClick={onDismiss} style={{
      position: 'absolute', inset: 0, zIndex: 93,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: `color-mix(in oklab, ${T.ink} 28%, transparent)`,
      backdropFilter: 'blur(2px)', animation: 'mnFadeIn 120ms ease',
    }}>
      <div role="dialog" aria-modal="true" onClick={e => e.stopPropagation()} style={{
        width: 460, maxWidth: 'calc(100vw - 40px)',
        background: T.bg, color: T.ink, border: `1px solid ${T.line}`,
        borderRadius: 10, overflow: 'hidden',
        boxShadow: `0 24px 70px color-mix(in oklab, ${T.ink} 24%, transparent)`,
        fontFamily: 'var(--mn-ui)',
      }}>
        <div style={{ padding: '17px 18px 14px', background: T.bgSub, borderBottom: `1px solid ${T.lineSub}` }}>
          <div style={{ fontSize: 15, fontWeight: 750, marginBottom: 5 }}>Save conflict</div>
          <div style={{ fontFamily: 'var(--mn-body)', fontSize: 13, lineHeight: 1.45, color: T.inkMed }}>
            “{conflict.title || 'Untitled'}” changed on disk {when}. VispNote kept your local edits unsaved.
          </div>
        </div>
        <div style={{ padding: '14px 18px 16px', display: 'flex', justifyContent: 'flex-end', gap: 8, flexWrap: 'wrap' }}>
          <button onClick={onDismiss} style={btn()}>Keep editing</button>
          <button onClick={onKeepCopy} style={btn()}>Save local copy</button>
          <button onClick={onReloadDisk} style={btn('primary')}>Reload disk version</button>
        </div>
      </div>
    </div>
  );
}

function MnVersionHistoryDialog({ note, vaultId, T, onClose, onRestore }) {
  const [versions, setVersions] = useStateA([]);
  const [busy, setBusy] = useStateA(false);
  const [error, setError] = useStateA('');

  const load = useCallbackA(async () => {
    if (!window.mn?.listNoteVersions || !vaultId || !note?.id) return;
    setBusy(true);
    setError('');
    try {
      const res = await window.mn.listNoteVersions(vaultId, note.id);
      if (!res.ok) throw new Error(res.error || 'Could not load versions');
      setVersions(res.value || []);
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setBusy(false);
    }
  }, [vaultId, note?.id]);

  useEffectA(() => { load(); }, [load]);

  if (!note) return null;
  const btn = (danger = false) => ({
    height: 30,
    padding: '0 11px',
    borderRadius: 6,
    cursor: 'pointer',
    fontFamily: 'var(--mn-ui)',
    fontSize: 12,
    fontWeight: 600,
    background: T.bg,
    color: danger ? T.danger : T.inkMed,
    border: `1px solid ${danger ? T.danger : T.line}`,
  });
  return (
    <div className="mn-version-history-dialog" onClick={onClose} style={{
      position: 'absolute', inset: 0, zIndex: 91,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: `color-mix(in oklab, ${T.ink} 28%, transparent)`,
      backdropFilter: 'blur(2px)', animation: 'mnFadeIn 120ms ease',
    }}>
      <div role="dialog" aria-modal="true" onClick={e => e.stopPropagation()} style={{
        width: 520, maxWidth: 'calc(100vw - 40px)', maxHeight: 'calc(100vh - 56px)',
        background: T.bg, color: T.ink, border: `1px solid ${T.line}`,
        borderRadius: 10, overflow: 'hidden', fontFamily: 'var(--mn-ui)',
        boxShadow: `0 24px 70px color-mix(in oklab, ${T.ink} 24%, transparent)`,
      }}>
        <div style={{ padding: '17px 18px 14px', background: T.bgSub, borderBottom: `1px solid ${T.lineSub}` }}>
          <div style={{ fontSize: 15, fontWeight: 750, marginBottom: 4 }}>Version history</div>
          <div style={{ fontFamily: 'var(--mn-body)', fontSize: 13, color: T.inkMed }}>{note.title || 'Untitled'}</div>
        </div>
        <div style={{ padding: 14, maxHeight: 380, overflow: 'auto' }}>
          {error && <div style={{ color: T.danger, fontSize: 12, marginBottom: 10 }}>{error}</div>}
          {!busy && versions.length === 0 && (
            <div style={{ fontFamily: 'var(--mn-body)', fontSize: 13, color: T.inkDim, padding: 8 }}>No saved versions yet.</div>
          )}
          {versions.map(version => (
            <div key={version.versionId} style={{
              display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', gap: 10,
              alignItems: 'center', padding: '9px 10px', border: `1px solid ${T.lineSub}`,
              borderRadius: 7, background: T.bgSub, marginBottom: 6,
            }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 12.5, fontWeight: 650, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {version.title || 'Untitled'}
                </div>
                <div style={{ marginTop: 3, fontFamily: 'var(--mn-mono)', fontSize: 10, color: T.inkDim }}>
                  {version.createdAt ? new Date(version.createdAt).toLocaleString() : version.versionId}
                </div>
              </div>
              <button style={btn()} disabled={busy} onClick={async () => {
                setBusy(true);
                const result = await onRestore(note.id, version.versionId);
                setBusy(false);
                if (result?.ok !== false) onClose();
              }}>Restore</button>
            </div>
          ))}
        </div>
        <div style={{ padding: '12px 18px 16px', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button onClick={load} disabled={busy} style={btn()}>Refresh</button>
          <button onClick={onClose} style={btn()}>Close</button>
        </div>
      </div>
    </div>
  );
}

function MnReminderCenter({ open, items, dueCount, onToggle, onClose, onOpenNote, topOffset = 13, T }) {
  const visibleItems = items;
  return (
    <div
      className="mn-reminder-center"
      style={{
        position: 'absolute',
        top: topOffset,
        right: 18,
        zIndex: 45,
      }}>
      <button
        onClick={onToggle}
        title="Reminder notifications"
        aria-label="Reminder notifications"
        style={{
          position: 'relative',
          zIndex: 2,
          width: 30,
          height: 30,
          borderRadius: 6,
          border: `1px solid ${open ? T.accent : T.lineSub}`,
          background: open ? T.accentSoft : T.bg,
          color: open ? T.accent : T.inkMed,
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          boxShadow: `0 8px 20px color-mix(in oklab, ${T.ink} 8%, transparent)`,
        }}>
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
          <path d="M4.2 7.2C4.2 4.8 5.6 3.2 8 3.2C10.4 3.2 11.8 4.8 11.8 7.2V9.8L13 11H3L4.2 9.8V7.2Z" strokeLinejoin="round"/>
          <path d="M6.6 12.1C6.9 12.8 7.4 13.2 8 13.2C8.6 13.2 9.1 12.8 9.4 12.1" strokeLinecap="round"/>
          <path d="M8 1.8V3.1" strokeLinecap="round"/>
        </svg>
        {dueCount > 0 && (
          <span style={{
            position: 'absolute',
            top: -5,
            right: -6,
            minWidth: 16,
            height: 16,
            padding: '0 4px',
            borderRadius: 999,
            background: T.warn,
            color: T.bg,
            border: `1px solid ${T.bg}`,
            fontFamily: 'var(--mn-mono)',
            fontSize: 9,
            fontWeight: 600,
            lineHeight: '15px',
            textAlign: 'center',
          }}>{dueCount > 9 ? '9+' : dueCount}</span>
        )}
      </button>
      {open && (
        <>
          <button
            aria-label="Close reminder notifications"
            onClick={onClose}
            style={{
              position: 'fixed',
              inset: 0,
              zIndex: 1,
              border: 'none',
              background: 'transparent',
              cursor: 'default',
            }}
          />
          <div
            role="dialog"
            aria-label="Reminder notifications"
            style={{
              position: 'absolute',
              zIndex: 3,
              top: 38,
              right: 0,
              width: 340,
              maxHeight: 'min(520px, calc(100vh - 72px))',
              overflow: 'hidden',
              display: 'flex',
              flexDirection: 'column',
              background: T.bg,
              border: `1px solid ${T.line}`,
              borderRadius: 8,
              boxShadow: `0 18px 50px color-mix(in oklab, ${T.ink} 18%, transparent)`,
            }}>
            <div style={{
              padding: '12px 13px',
              borderBottom: `1px solid ${T.lineSub}`,
              display: 'flex',
              alignItems: 'center',
              gap: 8,
            }}>
              <div style={{
                fontFamily: 'var(--mn-ui)',
                fontSize: 13,
                fontWeight: 600,
                color: T.ink,
              }}>Reminders</div>
              <div style={{ flex: 1 }} />
              <div style={{
                fontFamily: 'var(--mn-mono)',
                fontSize: 10,
                color: dueCount ? T.warn : T.inkDim,
              }}>{dueCount} due</div>
            </div>
            <div style={{ overflow: 'auto', padding: 6 }}>
              {visibleItems.length === 0 ? (
                <div style={{
                  padding: '26px 16px',
                  textAlign: 'center',
                  color: T.inkDim,
                  fontFamily: 'var(--mn-ui)',
                  fontSize: 12.5,
                }}>No reminders in this vault</div>
              ) : visibleItems.map(item => (
                <button
                  key={item.key}
                  onClick={() => onOpenNote(item)}
                  style={{
                    width: '100%',
                    display: 'block',
                    textAlign: 'left',
                    border: 'none',
                    background: item.status === 'due'
                      ? `color-mix(in oklab, ${T.warn} 9%, transparent)`
                      : 'transparent',
                    borderRadius: 6,
                    cursor: 'pointer',
                    padding: '8px 9px',
                    color: T.ink,
                    fontFamily: 'var(--mn-ui)',
                  }}
                  onMouseEnter={e => e.currentTarget.style.background = item.status === 'due'
                    ? `color-mix(in oklab, ${T.warn} 14%, transparent)`
                    : T.bgHover}
                  onMouseLeave={e => e.currentTarget.style.background = item.status === 'due'
                    ? `color-mix(in oklab, ${T.warn} 9%, transparent)`
                    : 'transparent'}>
                  <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    marginBottom: 3,
                  }}>
                    <span style={{
                      fontFamily: 'var(--mn-mono)',
                      fontSize: 9.5,
                      color: item.status === 'due' ? T.warn : T.inkDim,
                      textTransform: 'uppercase',
                      letterSpacing: '0.06em',
                      fontWeight: 600,
                    }}>{mnReminderStatusLabel(item.status)}</span>
                    <span style={{
                      fontFamily: 'var(--mn-mono)',
                      fontSize: 10,
                      color: T.inkDim,
                    }}>{mnReminderDisplayDate(item)}</span>
                  </div>
                  <div style={{
                    fontSize: 12.5,
                    lineHeight: 1.35,
                    color: T.ink,
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}>{item.text || 'Reminder'}</div>
                  <div style={{
                    marginTop: 2,
                    fontFamily: 'var(--mn-mono)',
                    fontSize: 10,
                    color: T.inkDim,
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}>from {item.noteTitle}</div>
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function MnAiNotice({ notice, onOpen, onDismiss, T }) {
  if (!notice) return null;
  const isError = !!notice.error;
  return (
    <div style={{
      position: 'absolute',
      right: 18,
      bottom: 18,
      zIndex: 80,
      width: 330,
      maxWidth: 'calc(100vw - 36px)',
      border: `1px solid ${isError ? `color-mix(in oklab, ${T.warn} 42%, ${T.line})` : T.line}`,
      borderRadius: 8,
      background: T.bg,
      color: T.ink,
      boxShadow: `0 18px 48px color-mix(in oklab, ${T.ink} 18%, transparent)`,
      overflow: 'hidden',
      fontFamily: 'var(--mn-ui)',
      animation: 'mnSlideUp 160ms ease',
    }}>
      <button
        onClick={onOpen}
        style={{
          width: '100%',
          border: 'none',
          background: isError ? `color-mix(in oklab, ${T.warn} 8%, ${T.bg})` : T.bg,
          color: T.ink,
          cursor: 'pointer',
          textAlign: 'left',
          padding: '12px 13px',
          display: 'flex',
          gap: 10,
          alignItems: 'flex-start',
        }}>
        <span style={{
          width: 28,
          height: 28,
          borderRadius: 7,
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          border: `1px solid ${isError ? T.warn : T.selLine}`,
          background: isError ? `color-mix(in oklab, ${T.warn} 14%, transparent)` : T.accentSoft,
          color: isError ? T.warn : T.accent,
        }}>
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.45">
            {isError ? (
              <path d="M8 3V8M8 11.4V11.5M3.4 13H12.6L8 2.8L3.4 13Z" strokeLinecap="round" strokeLinejoin="round" />
            ) : (
              <path d="M3.5 8.5L6.5 11.5L12.5 4.5" strokeLinecap="round" strokeLinejoin="round" />
            )}
          </svg>
        </span>
        <span style={{ minWidth: 0 }}>
          <span style={{ display: 'block', fontSize: 13, fontWeight: 650, color: T.ink }}>
            {isError ? 'AI task needs attention' : 'AI response ready'}
          </span>
          <span style={{
            display: 'block',
            marginTop: 3,
            fontSize: 12.5,
            lineHeight: 1.35,
            color: T.inkDim,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}>
            {notice.query || 'Open Ask AI to view the result'}
          </span>
        </span>
      </button>
      <button
        onClick={onDismiss}
        title="Dismiss"
        aria-label="Dismiss AI notification"
        style={{
          position: 'absolute',
          top: 7,
          right: 7,
          width: 24,
          height: 24,
          borderRadius: 5,
          border: `1px solid ${T.lineSub}`,
          background: T.bg,
          color: T.inkDim,
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 0,
        }}>
        <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6">
          <path d="M4 4L12 12M12 4L4 12" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  );
}

function MnCommandPalette({ open, commands, onClose, T }) {
  const [query, setQuery] = useStateA('');
  const [active, setActive] = useStateA(0);
  const inputRef = useRefA(null);
  useEffectA(() => {
    if (!open) return;
    setQuery('');
    setActive(0);
    setTimeout(() => inputRef.current?.focus(), 0);
  }, [open]);
  const items = useMemoA(() => MN_APP_HELPERS.filterCommands
    ? MN_APP_HELPERS.filterCommands(commands, query, 12)
    : (commands || []).filter(cmd => cmd.enabled !== false).slice(0, 12),
  [commands, query]);
  useEffectA(() => setActive(0), [query]);
  if (!open) return null;
  const run = (cmd) => {
    if (!cmd) return;
    onClose();
    setTimeout(() => cmd.run?.(), 0);
  };
  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, zIndex: 260,
      background: 'color-mix(in oklab, oklch(0.2 0.02 240) 34%, transparent)',
      display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
      padding: '9vh 18px 18px',
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        width: 'min(720px, 100%)',
        background: T.bg,
        color: T.ink,
        border: `1px solid ${T.line}`,
        borderRadius: 10,
        boxShadow: `0 24px 70px color-mix(in oklab, ${T.ink} 30%, transparent)`,
        overflow: 'hidden',
      }}>
        <input
          ref={inputRef}
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Escape') { e.preventDefault(); onClose(); }
            if (e.key === 'ArrowDown') { e.preventDefault(); setActive(i => Math.min(items.length - 1, i + 1)); }
            if (e.key === 'ArrowUp') { e.preventDefault(); setActive(i => Math.max(0, i - 1)); }
            if (e.key === 'Enter') { e.preventDefault(); run(items[active]); }
          }}
          placeholder="Run a command or open a note..."
          style={{
            width: '100%',
            border: 'none',
            borderBottom: `1px solid ${T.lineSub}`,
            outline: 'none',
            background: T.bg,
            color: T.ink,
            padding: '15px 16px',
            fontFamily: 'var(--mn-ui)',
            fontSize: 15,
          }}
        />
        <div style={{ maxHeight: 440, overflow: 'auto', padding: 6 }}>
          {items.map((cmd, index) => (
            <button
              key={cmd.id}
              onMouseEnter={() => setActive(index)}
              onClick={() => run(cmd)}
              style={{
                width: '100%',
                display: 'grid',
                gridTemplateColumns: '1fr auto',
                gap: 12,
                alignItems: 'center',
                border: 'none',
                borderRadius: 7,
                background: index === active ? T.selBg : 'transparent',
                color: T.ink,
                padding: '10px 11px',
                textAlign: 'left',
                cursor: 'pointer',
                fontFamily: 'var(--mn-ui)',
              }}>
              <span style={{ minWidth: 0 }}>
                <span style={{ display: 'block', fontSize: 13.5, fontWeight: 650, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{cmd.title}</span>
                <span style={{ display: 'block', marginTop: 2, fontSize: 11, color: T.inkDim }}>{cmd.section || 'Command'}</span>
              </span>
              {cmd.shortcut && <span style={{ fontFamily: 'var(--mn-mono)', fontSize: 10.5, color: T.inkDim }}>{cmd.shortcut}</span>}
            </button>
          ))}
          {!items.length && (
            <div style={{ padding: 18, color: T.inkDim, fontSize: 13, textAlign: 'center' }}>No commands found</div>
          )}
        </div>
      </div>
    </div>
  );
}

function MnVaultHealthDialog({ vaultId, onClose, onRebuildIndex, T }) {
  const [health, setHealth] = useStateA(null);
  const [error, setError] = useStateA(null);
  useEffectA(() => {
    let alive = true;
    setHealth(null);
    setError(null);
    if (!window.mn?.vaultHealth || !vaultId) return;
    window.mn.vaultHealth(vaultId).then(res => {
      if (!alive) return;
      if (res.ok) setHealth(res.value);
      else setError(res.error || 'Could not load vault health');
    }).catch(e => alive && setError(e.message || String(e)));
    return () => { alive = false; };
  }, [vaultId]);
  const stat = (label, value) => (
    <div style={{ border: `1px solid ${T.lineSub}`, borderRadius: 7, padding: 10, background: T.bgSub }}>
      <div style={{ fontFamily: 'var(--mn-mono)', fontSize: 10, color: T.inkDim, textTransform: 'uppercase' }}>{label}</div>
      <div style={{ marginTop: 4, fontSize: 18, fontWeight: 720, color: T.ink }}>{value}</div>
    </div>
  );
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 250, background: 'color-mix(in oklab, oklch(0.2 0.02 240) 32%, transparent)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div onClick={e => e.stopPropagation()} style={{ width: 'min(760px, 100%)', maxHeight: '86vh', overflow: 'auto', background: T.bg, color: T.ink, border: `1px solid ${T.line}`, borderRadius: 10, boxShadow: `0 24px 70px color-mix(in oklab, ${T.ink} 28%, transparent)` }}>
        <div style={{ padding: 16, borderBottom: `1px solid ${T.lineSub}`, display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ flex: 1, fontSize: 16, fontWeight: 720 }}>Vault Health</div>
          <button onClick={onRebuildIndex} style={mnSmallActionButton(T)}>Rebuild index</button>
          <button onClick={onClose} style={mnSmallActionButton(T)}>Close</button>
        </div>
        <div style={{ padding: 16 }}>
          {error && <div style={{ color: T.warn || '#b33', fontSize: 13 }}>{error}</div>}
          {!health && !error && <div style={{ color: T.inkDim, fontSize: 13 }}>Checking vault...</div>}
          {health && (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 10 }}>
                {stat('Notes', health.noteCount)}
                {stat('Tags', health.tagCount)}
                {stat('Canvases', health.canvasCount)}
                {stat('Words', health.wordCount)}
              </div>
              <div style={{ marginTop: 16, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                <MnHealthList title="Broken Links" items={health.brokenLinks || []} empty="No broken wiki links" render={item => `${item.noteTitle} -> ${item.target}`} T={T} />
                <MnHealthList title="Orphan Notes" items={health.orphanNotes || []} empty="No orphan notes" render={item => item.title} T={T} />
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function MnHealthList({ title, items, empty, render, T }) {
  return (
    <div style={{ border: `1px solid ${T.lineSub}`, borderRadius: 8, overflow: 'hidden' }}>
      <div style={{ padding: '9px 11px', borderBottom: `1px solid ${T.lineSub}`, fontSize: 12, fontWeight: 700 }}>{title}</div>
      <div style={{ maxHeight: 220, overflow: 'auto' }}>
        {items.length ? items.slice(0, 80).map((item, index) => (
          <div key={index} style={{ padding: '8px 11px', borderBottom: `1px solid ${T.lineSub}`, fontSize: 12.5, color: T.inkMed }}>{render(item)}</div>
        )) : <div style={{ padding: 12, fontSize: 12.5, color: T.inkDim }}>{empty}</div>}
      </div>
    </div>
  );
}

function mnSmallActionButton(T) {
  return {
    border: `1px solid ${T.lineSub}`,
    background: T.bg,
    color: T.inkMed,
    borderRadius: 6,
    padding: '7px 10px',
    cursor: 'pointer',
    fontFamily: 'var(--mn-ui)',
    fontSize: 12,
  };
}

function MnApp() {
  const { SEED_TAGS, SEED_NOTES, SEED_VAULTS, buildLinks } = window.MN_DATA;
  const { mnMdToBlocks, mnBlocksToMd, mkBlock, mnLocate, mnCloneBlocks, mnWalk } = window.MN_OUTLINE;
  // make them available to other modules via globals too
  window.mnMdToBlocks = mnMdToBlocks; window.mnBlocksToMd = mnBlocksToMd;
  window.mnWalk = mnWalk; window.mnLocate = mnLocate; window.mnCloneBlocks = mnCloneBlocks;
  window.mkBlock = mkBlock;

  const [bootState, setBootState] = useStateA('loading'); // 'loading' | 'ready' | 'error'
  const [bootError, setBootError] = useStateA(null);

  const [tweaks, setTweaks] = useStateA(MN_TWEAK_DEFAULTS);
  const [settingsOpen, setSettingsOpen] = useStateA(false);
  const [commandPaletteOpen, setCommandPaletteOpen] = useStateA(false);
  const [vaultHealthOpen, setVaultHealthOpen] = useStateA(false);

  // ── State (populated after disk load) ───────────────────────────────────
  // vaults stores per-vault metadata + cached notes/tags (cache fills lazily)
  const [vaults, setVaults] = useStateA([]);
  const [activeVaultId, setActiveVaultId] = useStateA(null);
  const [tags, setTags] = useStateA([]);
  const [notes, setNotes] = useStateA([]);
  const [selectedId, setSelectedId] = useStateA(null);
  const [canvases, setCanvases] = useStateA([]);
  const [activeCanvas, setActiveCanvas] = useStateA(null);

  const [selectedTag, setSelectedTag] = useStateA(null);
  const [selectedWorkflow, setSelectedWorkflow] = useStateA(null);
  const [view, setView] = useStateA('notes');
  const [graphFilter, setGraphFilter] = useStateA('all-novelist');
  const lastViewRef = useRefA('notes');
  const [askAiOpen, setAskAiOpen] = useStateA(false);
  const [askAiSeed, setAskAiSeed] = useStateA('');
  const askAiOpenRef = useRefA(false);
  const [askAiSession, setAskAiSession] = useStateA({
    messages: [],
    pending: false,
    error: null,
    activeAction: null,
    background: false,
  });
  const [aiNotice, setAiNotice] = useStateA(null);
  const [captureOpen, setCaptureOpen] = useStateA(false);
  const [deleteTargetId, setDeleteTargetId] = useStateA(null);
  const [appNotice, setAppNotice] = useStateA(null);
  const [conflictNotice, setConflictNotice] = useStateA(null);
  const [versionTargetId, setVersionTargetId] = useStateA(null);
  const [toast, setToast] = useStateA(null);
  const [reminderCenterOpen, setReminderCenterOpen] = useStateA(false);
  const dismissedReminderKeys = useRefA(new Set());
  const quietedReminderKeys = useRefA(new Set());
  const [query, setQuery] = useStateA('');

  useEffectA(() => {
    askAiOpenRef.current = askAiOpen;
  }, [askAiOpen]);

  useEffectA(() => {
    if (bootState === 'loading') return;
    const splash = document.getElementById('mn-boot-splash');
    if (!splash) return;
    splash.style.opacity = '0';
    splash.style.pointerEvents = 'none';
    const handle = setTimeout(() => splash.remove(), 240);
    return () => clearTimeout(handle);
  }, [bootState]);

  const navigateView = useCallbackA((nextView) => {
    setView(current => {
      if (current !== nextView) lastViewRef.current = current;
      return nextView;
    });
  }, []);

  const goBackView = useCallbackA(() => {
    const target = lastViewRef.current || 'notes';
    setView(current => {
      lastViewRef.current = current === target ? 'notes' : current;
      return target;
    });
  }, []);

  const showAppNotice = useCallbackA((title, message, tone = 'error') => {
    setAppNotice({
      title,
      message: message || 'The operation could not be completed.',
      tone,
    });
  }, []);

  const openAskAi = useCallbackA((initialQuery = '') => {
    setAiNotice(null);
    setAskAiSeed(typeof initialQuery === 'string' ? initialQuery : '');
    setAskAiOpen(true);
  }, []);

  const notifyAskAiComplete = useCallbackA((notice) => {
    if (askAiOpenRef.current) return;
    setAiNotice({
      id: `ai_${Date.now().toString(36)}`,
      query: notice?.query || 'AI task completed',
      error: notice?.error || null,
    });
  }, []);

  // dirtyNotes is keyed by vault+note so same-title novelist starter notes in
  // different vaults cannot overwrite each other's pending saves.
  const [dirtyNotes, setDirtyNotes] = useStateA(() => new Map());
  const vaultActivationSeq = useRefA(0);
  const markDirty = useCallbackA((id) => {
    if (!id || !activeVaultId) return;
    setDirtyNotes(s => {
      const n = new Map(s);
      n.set(mnDirtyNoteKey(activeVaultId, id), { id, vaultId: activeVaultId });
      return n;
    });
  }, [activeVaultId]);
  const tagsDirty = useRefA(false);
  const markTagsDirty = useCallbackA(() => { tagsDirty.current = true; }, []);

  const saveVaultMetaNow = useCallbackA(async (
    vaultId = activeVaultId,
    nextTags = tags,
    nextSelectedId = selectedId,
    forceTags = false
  ) => {
    if (!HAS_DISK || !vaultId) return;
    const patch = {};
    if (forceTags || tagsDirty.current) patch.tags = nextTags;
    if (nextSelectedId) patch.lastSelectedId = nextSelectedId;
    if (!Object.keys(patch).length) return;
    try {
      await window.mn.saveVaultMeta(vaultId, patch);
      if (patch.tags && vaultId === activeVaultId) tagsDirty.current = false;
    } catch (e) {
      console.error('saveVaultMeta failed', e);
    }
  }, [activeVaultId, tags, selectedId]);

  const loadVaultBundle = useCallbackA(async (vaultId) => {
    const vaultRes = await window.mn.loadVault(vaultId);
    if (!vaultRes.ok) throw new Error(vaultRes.error);
    const vault = vaultRes.value;
    let loadedCanvases = [];
    try {
      const canvasRes = await window.mn.listCanvases(vaultId);
      if (canvasRes.ok) loadedCanvases = canvasRes.value || [];
    } catch (e) {
      console.error('listCanvases failed', vaultId, e);
    }
    const loadedNotes = normalizeNotes(vault.notes, mnMdToBlocks);
    const validSelectedId = loadedNotes.some(note => note.id === vault.lastSelectedId)
      ? vault.lastSelectedId
      : loadedNotes[0]?.id || null;
    return {
      notes: loadedNotes,
      tags: vault.tags || [],
      canvases: loadedCanvases,
      lastSelectedId: validSelectedId,
      novelistMode: !!vault.novelistMode,
      workflowStates: vault.workflowStates || null,
      novelistAiConfig: vault.novelistAiConfig || null,
    };
  }, [mnMdToBlocks]);

  // ── Bootstrap from disk ─────────────────────────────────────────────────
  useEffectA(() => {
    let cancelled = false;
    (async () => {
      try {
        if (!HAS_DISK) {
          // In-browser fallback: use the same starter vault shape as first-run disk seed.
          const fallbackSources = Array.isArray(SEED_VAULTS) && SEED_VAULTS.length
            ? SEED_VAULTS
            : [{
              id: 'v_personal',
              name: 'Personal',
              slug: 'personal',
              path: '~/VispNote/personal',
              notes: SEED_NOTES,
              tags: SEED_TAGS,
              novelistMode: false,
            }];
          const fallbackVaults = fallbackSources.map((vault, index) => {
            const slug = vault.slug || String(vault.name || `vault-${index + 1}`).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || `vault-${index + 1}`;
            const seedNotes = normalizeNotes(vault.notes || [], mnMdToBlocks);
            return {
              id: vault.id || `v_${slug}`,
              name: vault.name || 'Personal',
              slug,
              path: vault.path || `~/VispNote/${slug}`,
              notes: seedNotes,
              tags: vault.tags || [],
              canvases: [],
              lastSelectedId: vault.lastSelectedId || seedNotes[0]?.id || null,
              workflowStates: vault.workflowStates || (vault.novelistMode ? MN_NOVELIST_WORKFLOW_STATES : null),
              novelistAiConfig: vault.novelistAiConfig || null,
              novelistMode: !!vault.novelistMode,
            };
          });
          const activeFallback = fallbackVaults[0];
          if (cancelled) return;
          setVaults(fallbackVaults);
          setActiveVaultId(activeFallback?.id || null);
          setTags(activeFallback?.tags || []);
          setNotes(activeFallback?.notes || []);
          setCanvases([]);
          setSelectedId(activeFallback?.lastSelectedId || activeFallback?.notes?.[0]?.id || null);
          setBootState('ready');
          return;
        }

        const prefsRes = await window.mn.getPrefs();
        if (!prefsRes.ok) throw new Error(prefsRes.error);
        const prefs = prefsRes.value;
        if (prefs.tweaks) {
          const mergedTweaks = { ...MN_TWEAK_DEFAULTS, ...prefs.tweaks };
          window.MN_LOGSEQ?.setWorkflowStates?.(mnNormalizeWorkflowStatesForApp(mergedTweaks.workflowStates));
          setTweaks(t => ({ ...t, ...prefs.tweaks }));
        }
        if (prefs.aiConfig && window.mn?.ai) await window.mn.ai.setConfig(prefs.aiConfig);

        const vlistRes = await window.mn.listVaults();
        if (!vlistRes.ok) throw new Error(vlistRes.error);
        const vlist = vlistRes.value;
        if (!vlist.length) throw new Error('No vaults found');

        const activeId = vlist.some(vault => vault.id === prefs.activeVaultId)
          ? prefs.activeVaultId
          : vlist[0].id;
        const loaded = await loadVaultBundle(activeId);

        if (cancelled) return;
        setVaults(vlist.map(meta => meta.id === activeId
          ? { ...meta, novelistMode: loaded.novelistMode, workflowStates: loaded.workflowStates || meta.workflowStates || null, novelistAiConfig: loaded.novelistAiConfig || meta.novelistAiConfig || null, notes: loaded.notes, tags: loaded.tags, lastSelectedId: loaded.lastSelectedId, canvases: loaded.canvases }
          : { ...meta, notes: null, tags: null, canvases: null }));
        setActiveVaultId(activeId);
        setTags(loaded.tags || []);
        setNotes(loaded.notes);
        setCanvases(loaded.canvases);
        setSelectedId(loaded.lastSelectedId || loaded.notes[0]?.id || null);
        if (prefs.activeVaultId !== activeId) window.mn.setPrefs({ activeVaultId: activeId });
        setBootState('ready');
      } catch (e) {
        console.error('Bootstrap failed', e);
        if (!cancelled) { setBootError(e.message || String(e)); setBootState('error'); }
      }
    })();
    return () => { cancelled = true; };
  }, [loadVaultBundle]);

  // ── Persist tweaks ─────────────────────────────────────────────────────
  const tweakInitialized = useRefA(false);
  useEffectA(() => {
    if (!HAS_DISK) return;
    if (!tweakInitialized.current) { tweakInitialized.current = true; return; }
    const t = setTimeout(() => { window.mn.setPrefs({ tweaks }); }, 250);
    return () => clearTimeout(t);
  }, [tweaks]);

  const findNotesForVault = useCallbackA((vaultId, currentNotes = notes, currentVaults = vaults) => {
    if (vaultId === activeVaultId) return currentNotes;
    return currentVaults.find(v => v.id === vaultId)?.notes || [];
  }, [activeVaultId, notes, vaults]);

  const saveDirtyNotesNow = useCallbackA(async (entries, currentNotes = notes, currentVaults = vaults) => {
    if (!HAS_DISK || !entries?.length) return;
    for (const entry of entries) {
      const id = entry?.id;
      const vaultId = entry?.vaultId;
      if (!id || !vaultId) continue;
      const noteList = findNotesForVault(vaultId, currentNotes, currentVaults);
      const n = noteList.find(x => x.id === id);
      if (!n) continue;
      try {
        const res = await window.mn.saveNote(
          vaultId,
          noteForDisk(n, mnBlocksToMd),
          { expectedModifiedAt: n.diskModifiedAt || null }
        );
        if (res && res.ok === false) {
          if (res.code === 'NOTE_CONFLICT') {
            setConflictNotice({
              vaultId,
              noteId: id,
              title: n.title || 'Untitled',
              currentModifiedAt: res.currentModifiedAt || null,
              expectedModifiedAt: res.expectedModifiedAt || n.diskModifiedAt || null,
            });
            continue;
          }
          throw new Error(res.error || 'Save failed');
        }
        const saved = res?.value;
        if (saved?.diskModifiedAt || saved?.modifiedAt) {
          const diskModifiedAt = saved.diskModifiedAt || saved.modifiedAt;
          const updateDiskStamp = note => note.id === id ? { ...note, diskModifiedAt } : note;
          if (vaultId === activeVaultId) setNotes(ns => ns.map(updateDiskStamp));
          setVaults(vs => vs.map(v => v.id === vaultId && Array.isArray(v.notes)
            ? { ...v, notes: v.notes.map(updateDiskStamp) }
            : v));
        }
        setDirtyNotes(cur => {
          const key = mnDirtyNoteKey(vaultId, id);
          if (cur.get(key)?.vaultId !== vaultId) return cur;
          const next = new Map(cur);
          next.delete(key);
          return next;
        });
      } catch (e) {
        console.error('saveNote failed', id, e);
        showAppNotice('Could not save note', e.message || String(e));
      }
    }
  }, [findNotesForVault, notes, vaults, activeVaultId, showAppNotice]);

  // ── Persist dirty notes (debounced) ────────────────────────────────────
  useEffectA(() => {
    if (!HAS_DISK || !dirtyNotes.size) return;
    const handle = setTimeout(async () => {
      await saveDirtyNotesNow([...dirtyNotes.values()]);
    }, 500);
    return () => clearTimeout(handle);
  }, [dirtyNotes, saveDirtyNotesNow]);

  // ── Persist tags + lastSelectedId ──────────────────────────────────────
  useEffectA(() => {
    if (!HAS_DISK || !activeVaultId) return;
    if (!tagsDirty.current) return;
    saveVaultMetaNow(activeVaultId, tags, selectedId, true);
  }, [tags, activeVaultId, selectedId, saveVaultMetaNow]);

  useEffectA(() => {
    if (!HAS_DISK || !activeVaultId || !selectedId) return;
    const t = setTimeout(() => {
      saveVaultMetaNow(activeVaultId, tags, selectedId, false);
    }, 1000);
    return () => clearTimeout(t);
  }, [selectedId, activeVaultId, tags, saveVaultMetaNow]);

  const refreshVaultRegistry = useCallbackA(async ({ reloadActive = false, reason = '' } = {}) => {
    if (!HAS_DISK) return { ok: true };
    try {
      const res = await window.mn.listVaults();
      if (!res.ok) throw new Error(res.error);
      const metas = res.value || [];
      if (!metas.length) throw new Error('No vaults found');
      const validIds = new Set(metas.map(v => v.id));
      const nextActiveId = validIds.has(activeVaultId) ? activeVaultId : metas[0].id;
      const activeChanged = nextActiveId !== activeVaultId;
      const activeHasDirtyNotes = [...dirtyNotes.values()].some(entry => entry.vaultId === activeVaultId);
      const activeHasUnsavedChanges = activeHasDirtyNotes || tagsDirty.current;
      let activeBundle = null;

      if (activeChanged || (reloadActive && nextActiveId && !activeHasUnsavedChanges)) {
        const activationSeq = ++vaultActivationSeq.current;
        activeBundle = await loadVaultBundle(nextActiveId);
        if (activationSeq !== vaultActivationSeq.current) return { ok: false, stale: true };
      }

      setDirtyNotes(cur => {
        let changed = false;
        const next = new Map();
        cur.forEach((entry, key) => {
          if (validIds.has(entry.vaultId)) next.set(key, entry);
          else changed = true;
        });
        return changed ? next : cur;
      });

      setVaults(currentVaults => metas.map(meta => {
        const cached = currentVaults.find(v => v.id === meta.id) || {};
        if (activeBundle && meta.id === nextActiveId) {
          return {
            ...meta,
            notes: activeBundle.notes,
            tags: activeBundle.tags,
            lastSelectedId: activeBundle.lastSelectedId || activeBundle.notes[0]?.id || null,
            canvases: activeBundle.canvases,
            novelistMode: activeBundle.novelistMode,
            workflowStates: activeBundle.workflowStates || meta.workflowStates || null,
            novelistAiConfig: activeBundle.novelistAiConfig || meta.novelistAiConfig || null,
          };
        }
        if (!activeChanged && meta.id === activeVaultId) {
          return {
            ...meta,
            notes,
            tags,
            lastSelectedId: selectedId,
            canvases,
            novelistMode: !!meta.novelistMode,
            workflowStates: meta.workflowStates || cached.workflowStates || null,
            novelistAiConfig: meta.novelistAiConfig || cached.novelistAiConfig || null,
          };
        }
        return {
          ...meta,
          notes: cached.notes || null,
          tags: cached.tags || null,
          lastSelectedId: cached.lastSelectedId || null,
          canvases: cached.canvases || null,
          novelistMode: !!meta.novelistMode,
          workflowStates: meta.workflowStates || cached.workflowStates || null,
          novelistAiConfig: meta.novelistAiConfig || cached.novelistAiConfig || null,
        };
      }));

      if (activeBundle) {
        setNotes(activeBundle.notes);
        setTags(activeBundle.tags);
        setCanvases(activeBundle.canvases);
        setActiveCanvas(null);
        setSelectedId(activeBundle.lastSelectedId || activeBundle.notes[0]?.id || null);
        setActiveVaultId(nextActiveId);
        tagsDirty.current = false;
        if (activeChanged) {
          setSelectedTag(null);
          setSelectedWorkflow(null);
          setQuery('');
          navigateView('notes');
          window.mn.setPrefs({ activeVaultId: nextActiveId });
        }
      }
      return { ok: true, vaults: metas, activeVaultId: nextActiveId, reason };
    } catch (e) {
      console.error('refreshVaultRegistry failed', reason, e);
      return { ok: false, error: e.message || String(e) };
    }
  }, [activeVaultId, dirtyNotes, loadVaultBundle, notes, tags, selectedId, canvases, navigateView]);

  useEffectA(() => {
    if (!HAS_DISK || bootState !== 'ready') return;
    const refreshVisible = () => {
      if (document.visibilityState && document.visibilityState !== 'visible') return;
      refreshVaultRegistry({ reloadActive: true, reason: 'focus' });
    };
    window.addEventListener('focus', refreshVisible);
    document.addEventListener('visibilitychange', refreshVisible);
    return () => {
      window.removeEventListener('focus', refreshVisible);
      document.removeEventListener('visibilitychange', refreshVisible);
    };
  }, [bootState, refreshVaultRegistry]);

  // Listen for host tweak-mode messages (still supported)
  useEffectA(() => {
    const handler = (e) => {
      const msg = e.data || {};
      if (msg.type === '__activate_edit_mode') setSettingsOpen(true);
      if (msg.type === '__deactivate_edit_mode') setSettingsOpen(false);
    };
    window.addEventListener('message', handler);
    window.parent.postMessage({ type: '__edit_mode_available' }, '*');
    return () => window.removeEventListener('message', handler);
  }, []);

  const setTweak = (key, val) => {
    setTweaks(t => {
      const next = { ...t, [key]: val };
      window.parent.postMessage({ type: '__edit_mode_set_keys', edits: { [key]: val } }, '*');
      return next;
    });
  };

  const theme = tweaks.theme;
  const T = MN_THEMES[theme];
  const fonts = MN_FONTS[tweaks.fontChoice] || MN_FONTS['Editorial (Newsreader + Inter)'];
  useEffectA(() => {
    const root = document.documentElement;
    root.style.setProperty('--mn-ui', fonts.ui);
    root.style.setProperty('--mn-body', fonts.body);
    root.style.setProperty('--mn-mono', fonts.mono);
    root.style.setProperty('--mn-bg', T.bg);
    root.style.setProperty('--mn-focus', T.focus || T.accent);
    root.style.setProperty('--mn-app-font-size', tweaks.appFontSize === 'small' ? '12px' : tweaks.appFontSize === 'large' ? '14px' : tweaks.appFontSize === 'x-large' ? '15px' : '13px');
  }, [fonts, T, tweaks.appFontSize]);

  // ── Vault switching (lazy load from disk) ──────────────────────────────
  const selectVault = useCallbackA(async (id) => {
    if (id === activeVaultId) return;
    const activationSeq = ++vaultActivationSeq.current;
    const pendingForCurrentVault = [...dirtyNotes.values()].filter(entry => entry.vaultId === activeVaultId);
    await saveDirtyNotesNow(pendingForCurrentVault, notes, vaults);
    await saveVaultMetaNow(activeVaultId, tags, selectedId, tagsDirty.current);
    // stash current vault's in-memory state into cache
    setVaults(vs => vs.map(v => v.id === activeVaultId
      ? { ...v, notes, tags, lastSelectedId: selectedId, canvases }
      : v));
    const target = vaults.find(v => v.id === id);
    if (!target) return;

    let targetNotes = target.notes, targetTags = target.tags, targetSel = target.lastSelectedId;
    let targetNovelistMode = !!target.novelistMode;
    let targetWorkflowStates = target.workflowStates || null;
    let targetNovelistAiConfig = target.novelistAiConfig || null;
    let targetCanvases = target.canvases;
    if (!targetNotes && HAS_DISK) {
      try {
        const res = await window.mn.loadVault(id);
        if (!res.ok) throw new Error(res.error);
        targetNotes = normalizeNotes(res.value.notes, mnMdToBlocks);
        targetTags = res.value.tags || [];
        targetSel = targetNotes.some(note => note.id === res.value.lastSelectedId)
          ? res.value.lastSelectedId
          : targetNotes[0]?.id || null;
        targetNovelistMode = !!res.value.novelistMode;
        targetWorkflowStates = res.value.workflowStates || null;
        targetNovelistAiConfig = res.value.novelistAiConfig || null;
      } catch (e) {
        console.error('loadVault failed', id, e);
        await refreshVaultRegistry({ reloadActive: true, reason: 'selectVault-load-failed' });
        return;
      }
    }
    if (!targetCanvases && HAS_DISK) {
      try {
        const res = await window.mn.listCanvases(id);
        if (res.ok) targetCanvases = res.value || [];
      } catch (e) { console.error('listCanvases failed', id, e); }
    }
    targetNotes = targetNotes || [];
    targetTags = targetTags || [];
    targetCanvases = targetCanvases || [];
    if (targetSel && !targetNotes.some(note => note.id === targetSel)) targetSel = targetNotes[0]?.id || null;
    if (activationSeq !== vaultActivationSeq.current) return;
    setNotes(targetNotes);
    setTags(targetTags);
    setCanvases(targetCanvases);
    setActiveCanvas(null);
    setSelectedId(targetSel || targetNotes[0]?.id || null);
    setActiveVaultId(id);
    setVaults(vs => vs.map(v => v.id === id
      ? { ...v, notes: targetNotes, tags: targetTags, lastSelectedId: targetSel || targetNotes[0]?.id || null, canvases: targetCanvases, novelistMode: targetNovelistMode, workflowStates: targetWorkflowStates, novelistAiConfig: targetNovelistAiConfig }
      : v));
    setSelectedTag(null); setSelectedWorkflow(null); navigateView('notes');
    if (HAS_DISK) window.mn.setPrefs({ activeVaultId: id });
  }, [activeVaultId, vaults, notes, tags, canvases, selectedId, dirtyNotes, saveDirtyNotesNow, saveVaultMetaNow, refreshVaultRegistry, navigateView]);

  const persistNovelistSetup = async (vaultId, sourceNotes, sourceTags, sourceWorkflowStates = null, options = {}) => {
    const nextTags = mnEnsureNovelistTags(sourceTags);
    const nextWorkflowStates = mnNormalizeWorkflowStatesForApp(sourceWorkflowStates || MN_NOVELIST_WORKFLOW_STATES);
    const normalizedSourceNotes = (sourceNotes || []).map(note => {
      const nextTagsForNote = mnNormalizeNovelistLegacyTags(note.tags || []);
      const nextBody = mnNormalizeNoteBody(
        mnEnsureScenePlotPoints(mnNormalizeNovelistLegacyBody(note.body || mnBlocksToMd(note.blocks || [])), nextTagsForNote),
        note.title || 'Untitled'
      );
      return { ...note, tags: nextTagsForNote, body: nextBody, blocks: mnMdToBlocks(nextBody || '') };
    });
    const starterNotes = options.includeStarterNotes === false
      ? []
      : mnBuildNovelistStarterNotes(normalizedSourceNotes, mnMdToBlocks, vaultId);
    const nextNotes = [...starterNotes, ...normalizedSourceNotes];
    if (HAS_DISK && vaultId) {
      await window.mn.saveVaultMeta(vaultId, { tags: nextTags, novelistMode: true, workflowStates: nextWorkflowStates });
      for (const note of nextNotes) {
        await window.mn.saveNote(vaultId, noteForDisk(note, mnBlocksToMd));
      }
    }
    return { notes: nextNotes, tags: nextTags, workflowStates: nextWorkflowStates };
  };

  const createVault = useCallbackA(async (name, options = {}) => {
    const activationSeq = ++vaultActivationSeq.current;
    const vaultType = options.type === 'novelist' ? 'novelist' : 'notes';
    const pendingForCurrentVault = [...dirtyNotes.values()].filter(entry => entry.vaultId === activeVaultId);
    await saveDirtyNotesNow(pendingForCurrentVault, notes, vaults);
    await saveVaultMetaNow(activeVaultId, tags, selectedId, tagsDirty.current);
    if (!HAS_DISK) {
      // In-browser fallback (transient)
      const id = 'v_' + Date.now();
      const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
      const firstNoteId = 'n_' + Date.now();
      const isNovelistVault = vaultType === 'novelist';
      const newNotes = isNovelistVault ? mnBuildNovelistStarterNotes([], mnMdToBlocks, id).slice(0, 3) : [{
        id: firstNoteId,
        title: 'Welcome to ' + name,
        date: new Date().toISOString(),
        tags: [],
        pinned: false,
        body: `- This is your new vault\n- Create notes with ⌘N`,
        blocks: mnMdToBlocks(`- This is your new vault\n- Create notes with ⌘N`),
      }];
      const setup = vaultType === 'novelist'
        ? await persistNovelistSetup(id, newNotes, [], null, { includeStarterNotes: false })
        : { notes: newNotes, tags: [] };
      if (activationSeq !== vaultActivationSeq.current) return;
      const newCanvases = [];
      setVaults(vs => [
        ...vs.map(v => v.id === activeVaultId ? { ...v, notes, tags, lastSelectedId: selectedId, canvases } : v),
        { id, name, slug, path: `~/VispNote/${slug}`, notes: setup.notes, tags: setup.tags, workflowStates: setup.workflowStates || null, novelistAiConfig: null, canvases: newCanvases, novelistMode: vaultType === 'novelist' },
      ]);
      setNotes(setup.notes); setTags(setup.tags); setSelectedId(setup.notes[0]?.id || firstNoteId);
      tagsDirty.current = false;
      setCanvases(newCanvases); setActiveCanvas(null);
      setActiveVaultId(id); setSelectedTag(null); setSelectedWorkflow(null); navigateView('notes');
      return;
    }
    try {
      const res = await window.mn.createVault(name, { type: vaultType, workflowStates: vaultType === 'novelist' ? MN_NOVELIST_WORKFLOW_STATES : null });
      if (!res.ok) throw new Error(res.error);
      const v = res.value;

      // Load first, then switch atomically. This prevents the previous vault's
      // notes from appearing under the newly-created vault if disk IO is slow.
      const loadRes = await window.mn.loadVault(v.id);
      if (!loadRes.ok) throw new Error(loadRes.error);
      const loaded = loadRes.value;
      let loadedNotes = normalizeNotes(loaded.notes, mnMdToBlocks);
      let loadedTags = loaded.tags || [];
      if (vaultType === 'novelist') {
        const setup = await persistNovelistSetup(v.id, loadedNotes, loadedTags, loaded.workflowStates, { includeStarterNotes: false });
        loadedNotes = setup.notes;
        loadedTags = setup.tags;
        loaded.workflowStates = setup.workflowStates;
      }
      if (activationSeq !== vaultActivationSeq.current) return;
      setNotes(loadedNotes); setTags(loadedTags);
      tagsDirty.current = false;
      setCanvases([]); setActiveCanvas(null);
      setSelectedId(loaded.lastSelectedId || loadedNotes[0]?.id || null);
      setActiveVaultId(v.id); setSelectedTag(null); setSelectedWorkflow(null); navigateView('notes');
      setQuery('');
      setVaults(vs => [
        ...vs
          .filter(x => x.id !== v.id)
          .map(x => x.id === activeVaultId ? { ...x, notes, tags, lastSelectedId: selectedId, canvases } : x),
        { ...v, notes: loadedNotes, tags: loadedTags, lastSelectedId: loaded.lastSelectedId || loadedNotes[0]?.id || null, canvases: [], workflowStates: loaded.workflowStates || null, novelistAiConfig: loaded.novelistAiConfig || null, novelistMode: vaultType === 'novelist' },
      ]);
      window.mn.setPrefs({ activeVaultId: v.id });
    } catch (e) {
      console.error('createVault failed', e);
      showAppNotice('Could not create vault', e.message || String(e));
      await refreshVaultRegistry({ reloadActive: false, reason: 'createVault-failed' });
    }
  }, [activeVaultId, notes, vaults, tags, canvases, selectedId, dirtyNotes, saveDirtyNotesNow, saveVaultMetaNow, navigateView, mnMdToBlocks, mnBlocksToMd, showAppNotice, refreshVaultRegistry]);

  const setActiveVaultNovelistMode = useCallbackA(async (enabled) => {
    if (!activeVaultId) return { ok: false, error: 'No active vault.' };
    if (enabled) {
      try {
        const setup = await persistNovelistSetup(activeVaultId, notes, tags);
        setNotes(setup.notes);
        setTags(setup.tags);
        setVaults(vs => vs.map(v => v.id === activeVaultId
          ? { ...v, notes: setup.notes, tags: setup.tags, workflowStates: setup.workflowStates, novelistMode: true }
          : v));
        tagsDirty.current = false;
        return { ok: true };
      } catch (e) {
        console.error('enable novelist mode failed', e);
        return { ok: false, error: e.message || String(e) };
      }
    }

    try {
      if (HAS_DISK) await window.mn.saveVaultMeta(activeVaultId, { novelistMode: false, workflowStates: null });
      setVaults(vs => vs.map(v => v.id === activeVaultId ? { ...v, novelistMode: false, workflowStates: null } : v));
      if (view === 'novelist') navigateView('notes');
      return { ok: true };
    } catch (e) {
      console.error('disable novelist mode failed', e);
      return { ok: false, error: e.message || String(e) };
    }
  }, [activeVaultId, notes, tags, view, navigateView]);

  const renameVault = useCallbackA(async (id, name) => {
    const cleanName = String(name || '').trim();
    if (!cleanName) return { ok: false, error: 'Vault name is required.' };
    const previous = vaults.find(v => v.id === id)?.name || '';
    setVaults(vs => vs.map(v => v.id === id ? { ...v, name: cleanName } : v));
    if (HAS_DISK) {
      try {
        const res = await window.mn.renameVault(id, cleanName);
        if (!res.ok) throw new Error(res.error);
      }
      catch (e) {
        console.error('renameVault failed', e);
        setVaults(vs => vs.map(v => v.id === id ? { ...v, name: previous } : v));
        showAppNotice('Could not rename vault', e.message || String(e));
        return { ok: false, error: e.message || String(e) };
      }
    }
    return { ok: true };
  }, [vaults, showAppNotice]);

  const deleteVault = useCallbackA(async (id) => {
    const target = vaults.find(v => v.id === id);
    if (!target) return { ok: false, error: 'Vault not found.' };
    if (vaults.length <= 1) {
      return { ok: false, error: 'Create another vault before deleting this one.' };
    }

    const deletingActive = id === activeVaultId;
    const pendingToSave = [...dirtyNotes.values()].filter(entry => entry.vaultId !== id);
    await saveDirtyNotesNow(pendingToSave, notes, vaults);
    if (!deletingActive) await saveVaultMetaNow(activeVaultId, tags, selectedId, tagsDirty.current);

    const localRemaining = vaults.filter(v => v.id !== id);
    let nextVaults = localRemaining;
    let nextActiveId = deletingActive ? localRemaining[0]?.id : activeVaultId;

    if (HAS_DISK) {
      try {
        const res = await window.mn.deleteVault(id);
        if (!res.ok) throw new Error(res.error);
        nextVaults = (res.value?.vaults || localRemaining).map(meta => {
          const cached = localRemaining.find(v => v.id === meta.id) || {};
          return { ...meta, notes: cached.notes || null, tags: cached.tags || null, lastSelectedId: cached.lastSelectedId || null, canvases: cached.canvases || null, novelistMode: !!(meta.novelistMode ?? cached.novelistMode), workflowStates: meta.workflowStates || cached.workflowStates || null, novelistAiConfig: meta.novelistAiConfig || cached.novelistAiConfig || null };
        });
        nextActiveId = deletingActive ? (res.value?.activeVaultId || nextVaults[0]?.id) : activeVaultId;
      } catch (e) {
        console.error('deleteVault failed', e);
        return { ok: false, error: e.message || String(e) };
      }
    }

    setDirtyNotes(cur => {
      const next = new Map();
      cur.forEach((entry, key) => {
        if (entry.vaultId !== id) next.set(key, entry);
      });
      return next;
    });

    if (!deletingActive) {
      setVaults(nextVaults);
      return { ok: true };
    }

    const nextMeta = nextVaults.find(v => v.id === nextActiveId) || nextVaults[0];
    if (!nextMeta) return { ok: false, error: 'No vault available after delete.' };

    let nextNotes = nextMeta.notes || [];
    let nextTags = nextMeta.tags || [];
    let nextCanvases = nextMeta.canvases || [];
    let nextSelectedId = nextMeta.lastSelectedId || null;
    if (HAS_DISK) {
      try {
        const loadRes = await window.mn.loadVault(nextMeta.id);
        if (!loadRes.ok) throw new Error(loadRes.error);
        const loaded = loadRes.value;
        nextNotes = normalizeNotes(loaded.notes, mnMdToBlocks);
        nextTags = loaded.tags || [];
        nextSelectedId = loaded.lastSelectedId || nextNotes[0]?.id || null;
        nextMeta.novelistMode = !!loaded.novelistMode;
        nextMeta.workflowStates = loaded.workflowStates || nextMeta.workflowStates || null;
        nextMeta.novelistAiConfig = loaded.novelistAiConfig || nextMeta.novelistAiConfig || null;
        const canvasRes = await window.mn.listCanvases(nextMeta.id);
        nextCanvases = canvasRes.ok ? (canvasRes.value || []) : [];
      } catch (e) {
        console.error('loadVault after delete failed', e);
        return { ok: false, error: e.message || String(e) };
      }
    }

    setVaults(nextVaults.map(v => v.id === nextMeta.id
      ? { ...v, notes: nextNotes, tags: nextTags, lastSelectedId: nextSelectedId, canvases: nextCanvases, novelistMode: !!nextMeta.novelistMode, workflowStates: nextMeta.workflowStates || null, novelistAiConfig: nextMeta.novelistAiConfig || null }
      : v));
    setNotes(nextNotes);
    setTags(nextTags);
    setCanvases(nextCanvases);
    setActiveCanvas(null);
    setSelectedId(nextSelectedId || nextNotes[0]?.id || null);
    setActiveVaultId(nextMeta.id);
    setSelectedTag(null);
    setSelectedWorkflow(null);
    setQuery('');
    tagsDirty.current = false;
    navigateView('notes');
    if (HAS_DISK) window.mn.setPrefs({ activeVaultId: nextMeta.id });
    return { ok: true };
  }, [activeVaultId, vaults, notes, tags, selectedId, dirtyNotes, saveDirtyNotesNow, saveVaultMetaNow, navigateView, mnMdToBlocks]);

  const vaultsForSidebar = useMemoA(() => vaults.map(v => ({
    ...v,
    noteCount: v.id === activeVaultId ? notes.length : (v.notes?.length ?? 0),
    canvasCount: v.id === activeVaultId ? canvases.length : (v.canvases?.length ?? 0),
  })), [vaults, activeVaultId, notes, canvases]);
  const activeVault = useMemoA(() => vaults.find(v => v.id === activeVaultId) || null, [vaults, activeVaultId]);

  const updateNovelistAiConfig = useCallbackA((config) => {
    if (!activeVaultId) return;
    window.mnWriteNovelistAiConfig?.(config || null, activeVaultId);
    setVaults(vs => vs.map(v => v.id === activeVaultId ? { ...v, novelistAiConfig: config || null } : v));
    if (HAS_DISK) {
      window.mn.saveVaultMeta(activeVaultId, { novelistAiConfig: config || null })
        .catch(e => {
          console.error('save novelist AI config failed', e);
          showAppNotice('Could not save novelist AI configuration', e.message || String(e));
        });
    }
  }, [activeVaultId, showAppNotice]);

  useEffectA(() => {
    if (!activeVaultId || !activeVault?.novelistAiConfig) return;
    window.mnWriteNovelistAiConfig?.(activeVault.novelistAiConfig, activeVaultId);
  }, [activeVaultId, activeVault?.novelistAiConfig]);

  const sidebarHidden = tweaks.showSidebar === false;
  const setSidebarHidden = (v) => {
    const next = typeof v === 'function' ? v(sidebarHidden) : v;
    setTweak('showSidebar', !next);
  };
  const noteListHidden = tweaks.showNoteList === false;
  const setNoteListHidden = (v) => {
    const next = typeof v === 'function' ? v(noteListHidden) : v;
    setTweak('showNoteList', !next);
  };

  // Keep body (markdown) in sync for backlinks / search / save
  const notesWithBody = useMemoA(() => notes.map(n => ({
    ...n,
    body: mnNormalizeNoteBody(
      Array.isArray(n.blocks) ? mnBlocksToMd(n.blocks || []) : (n.body || ''),
      n.title || 'Untitled'
    ),
  })), [notes]);
  const novelistStructure = useMemoA(() => mnBuildNovelistStructure(notesWithBody), [notesWithBody]);
  const novelistNotes = novelistStructure.novelNotes || [];

  const links = useMemoA(() => buildLinks(notesWithBody), [notesWithBody]);
  const normalWorkflowStates = useMemoA(
    () => mnNormalizeWorkflowStatesForApp(tweaks.workflowStates),
    [tweaks.workflowStates]
  );
  const novelistWorkflowStates = useMemoA(
    () => mnNormalizeWorkflowStatesForApp(activeVault?.workflowStates || MN_NOVELIST_WORKFLOW_STATES),
    [activeVault?.workflowStates]
  );
  const workflowStates = activeVault?.novelistMode ? novelistWorkflowStates : normalWorkflowStates;
  useEffectA(() => {
    window.MN_LOGSEQ?.setWorkflowStates?.(workflowStates);
    if (selectedWorkflow && !workflowStates.some(s => s.id === selectedWorkflow)) {
      setSelectedWorkflow(null);
    }
  }, [workflowStates, selectedWorkflow]);
  const updateWorkflowStates = useCallbackA((states) => {
    const next = mnNormalizeWorkflowStatesForApp(states);
    if (activeVault?.novelistMode && activeVaultId) {
      setVaults(vs => vs.map(v => v.id === activeVaultId ? { ...v, workflowStates: next } : v));
      if (HAS_DISK) {
        window.mn.saveVaultMeta(activeVaultId, { workflowStates: next })
          .catch(e => console.error('save novelist workflow states failed', e));
      }
      return;
    }
    setTweak('workflowStates', next);
  }, [activeVault?.novelistMode, activeVaultId]);
  const workflowData = useMemoA(
    () => collectWorkflowNotes(notesWithBody, workflowStates),
    [notesWithBody, workflowStates]
  );

  const appStats = useMemoA(() => {
    let wordCount = 0, charCount = 0;
    notesWithBody.forEach(n => {
      const t = (n.body || '') + ' ' + (n.title || '');
      charCount += t.length;
      wordCount += t.trim().split(/\s+/).filter(Boolean).length;
    });
    return {
      noteCount: notesWithBody.length,
      tagCount: tags.length,
      linkCount: links.length,
      wordCount, charCount,
    };
  }, [notesWithBody, tags, links]);

  // SQLite-backed search: debounced IPC call returns matching IDs;
  // we intersect with in-memory notes for tag-filter compatibility.
  // searchHits = null  → no active query
  // searchHits = []    → query active but zero matches
  // searchHits = [...] → matched note ids in rank order
  const [searchHits, setSearchHits] = useStateA(null);
  const [searchDetails, setSearchDetails] = useStateA(new Map());
  const searchSeq = useRefA(0);
  // Legacy stabilization invariant: if (seq === searchSeq.current && res.ok) setSearchHits
  useEffectA(() => {
    const seq = ++searchSeq.current;
    const q = query.trim();
    if (!q) { setSearchHits(null); setSearchDetails(new Map()); return; }
    const activeVaultHasUnsaved = [...dirtyNotes.values()].some(entry => entry.vaultId === activeVaultId);
    if (!HAS_DISK || !activeVaultId || activeVaultHasUnsaved) {
      // Browser fallback and dirty-note path: in-memory search reflects unsaved edits.
      const lc = q.toLowerCase();
      const ids = notesWithBody.filter(n =>
        n.title.toLowerCase().includes(lc) ||
        (n.body || '').toLowerCase().includes(lc) ||
        n.tags.some(t => t.toLowerCase().includes(lc))
      ).map(n => n.id);
      if (seq === searchSeq.current) {
        setSearchHits(ids);
        setSearchDetails(new Map());
      }
      return;
    }
    const handle = setTimeout(async () => {
      try {
        const api = window.mn.searchDetailed || window.mn.search;
        const res = await api(activeVaultId, q, 100);
        if (seq === searchSeq.current && res.ok) {
          const rows = res.value || [];
          setSearchHits(rows.map(r => r.id));
          setSearchDetails(new Map(rows.map(r => [r.id, r])));
        }
      } catch (e) { console.error('search failed', e); }
    }, 150);
    return () => clearTimeout(handle);
  }, [query, activeVaultId, notesWithBody, dirtyNotes]);

  const filteredNotes = useMemoA(() => {
    let ns = [...notesWithBody];
    if (selectedTag) ns = ns.filter(n => n.tags.includes(selectedTag));
    if (selectedWorkflow) {
      const ids = workflowData.noteIdsByState[selectedWorkflow] || new Set();
      ns = ns.filter(n => ids.has(n.id));
    }
    if (searchHits != null) {
      const order = new Map(searchHits.map((id, i) => [id, i]));
      ns = ns.filter(n => order.has(n.id));
      ns = MN_APP_HELPERS.decorateNotesWithSearchDetails
        ? MN_APP_HELPERS.decorateNotesWithSearchDetails(ns, searchDetails)
        : ns.map(n => {
          const detail = searchDetails.get(n.id);
          return detail ? { ...n, __searchSnippet: detail.snippet, __matchedFields: detail.matchedFields } : n;
        });
      // Preserve search rank order when querying; otherwise default sort
      ns.sort((a, b) => order.get(a.id) - order.get(b.id));
      return ns;
    }
    ns.sort((a, b) => {
      if (tweaks.pinnedFirst !== false) {
        if (a.pinned && !b.pinned) return -1;
        if (!a.pinned && b.pinned) return 1;
      }
      if ((tweaks.sortBy || 'modified') === 'title') {
        return String(a.title || '').localeCompare(String(b.title || ''), undefined, { sensitivity: 'base' });
      }
      if ((tweaks.sortBy || 'modified') === 'created') {
        return new Date(b.date || 0) - new Date(a.date || 0);
      }
      return new Date(b.modifiedAt || b.date || 0) - new Date(a.modifiedAt || a.date || 0);
    });
    return ns;
  }, [notesWithBody, selectedTag, selectedWorkflow, workflowData, searchHits, searchDetails, tweaks.sortBy, tweaks.pinnedFirst]);

  const graphVisibleNotes = useMemoA(() => {
    if (!activeVault?.novelistMode) return filteredNotes;
    const structureIds = new Set([
      ...(novelistStructure.acts || []).map(note => note.id),
      ...(novelistStructure.chapters || []).map(note => note.id),
      ...(novelistStructure.scenes || []).map(note => note.id),
    ]);
    const sceneIds = new Set((novelistStructure.scenes || []).map(note => note.id));
    const novelistIds = new Set((novelistStructure.novelNotes || []).map(note => note.id));
    const hasTag = (note, tag) => (note.tags || []).includes(tag);
    return filteredNotes.filter(note => {
      if (graphFilter === 'structure') return structureIds.has(note.id);
      if (graphFilter === 'characters-scenes') return hasTag(note, 'novel-character') || sceneIds.has(note.id);
      if (graphFilter === 'plot-scenes') return hasTag(note, 'novel-plot') || sceneIds.has(note.id);
      if (graphFilter === 'research-scenes') return hasTag(note, 'novel-research') || sceneIds.has(note.id);
      return novelistIds.has(note.id);
    });
  }, [activeVault?.novelistMode, filteredNotes, graphFilter, novelistStructure]);

  const workflowViewData = useMemoA(
    () => collectWorkflowNotes(filteredNotes, workflowStates),
    [filteredNotes, workflowStates]
  );

  const selectedNote = notes.find(n => n.id === selectedId);
  const deleteTargetNote = deleteTargetId ? notes.find(n => n.id === deleteTargetId) : null;
  const blockingOverlayOpen = captureOpen || settingsOpen || commandPaletteOpen || vaultHealthOpen || askAiOpen || !!deleteTargetNote || !!appNotice || !!conflictNotice || !!versionTargetId;

  const reminderCenterItems = useMemoA(() => {
    const now = Date.now();
    const snoozed = mnReadSnoozedReminders();
    return mnCollectReminderItems(notesWithBody)
      .map(item => {
        const dueTime = item.remindAt?.at?.getTime?.() || 0;
        const snoozedUntil = Number(snoozed[item.key]) || 0;
        return {
          ...item,
          snoozedUntil,
          status: snoozedUntil > now ? 'snoozed' : dueTime <= now ? 'due' : 'upcoming',
        };
      })
      .sort((a, b) => {
        const rank = { due: 0, upcoming: 1, snoozed: 2 };
        const byRank = (rank[a.status] ?? 9) - (rank[b.status] ?? 9);
        if (byRank) return byRank;
        return (a.remindAt?.at || 0) - (b.remindAt?.at || 0);
      });
  }, [notesWithBody, toast]);

  const reminderDueCount = reminderCenterItems.filter(item =>
    item.status === 'due' && !dismissedReminderKeys.current.has(item.key)
  ).length;

  const nextStoryOrder = useCallbackA((kind, parentId = null) => {
    const noteById = new Map(notesWithBody.map(note => [note.id, note]));
    const values = (items, step, base) => {
      const ordered = items.map(mnNoteOrderValue).filter(value => value != null);
      return ordered.length ? Math.max(...ordered) + step : base + step;
    };
    if (kind === 'act') return values(novelistStructure.acts || [], 100, 0);
    if (kind === 'chapter') {
      const parent = noteById.get(parentId);
      const base = mnNoteOrderValue(parent) ?? 100;
      const items = (novelistStructure.childrenByActId?.[parentId] || []).map(id => noteById.get(id)).filter(Boolean);
      return values(items, 10, base);
    }
    const parent = noteById.get(parentId);
    const base = mnNoteOrderValue(parent) ?? 100;
    const items = (novelistStructure.childrenByChapterId?.[parentId] || []).map(id => noteById.get(id)).filter(Boolean);
    return values(items, 1, base);
  }, [notesWithBody, novelistStructure]);

  const uniqueNoteTitle = useCallbackA((rawTitle = 'Untitled', excludeId = null) => {
    return MN_APP_MUTATIONS.uniqueNoteTitle(notes, rawTitle, excludeId);
  }, [notes]);

  const createRuntimeNoteId = () => `n_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

  const createNote = useCallbackA(({ title = 'Untitled', body = '', tags: noteTags = [] } = {}, options = {}) => {
    const id = createRuntimeNoteId();
    const { note: newNote, missingTags } = MN_APP_MUTATIONS.createNoteDraft({
      id,
      title,
      body,
      tags: noteTags,
      defaultTags: tweaks.defaultTags,
      existingTags: tags,
      now: new Date().toISOString(),
    }, {
      normalizeTagName,
      parseDefaultTags: mnParseDefaultTags,
      normalizeNoteBody: mnNormalizeNoteBody,
      ensureScenePlotPoints: mnEnsureScenePlotPoints,
      mdToBlocks: mnMdToBlocks,
      makeEmptyBlock: () => mkBlock({ kind: 'paragraph', content: '' }),
    });
    if (missingTags.length) {
      setTags(ts => MN_APP_MUTATIONS.addTagsToList(ts, missingTags, () => (Math.floor(Math.random() * 12) * 30) + 10));
      markTagsDirty();
    }
    setNotes(ns => [newNote, ...ns]);
    if (options.open !== false) {
      setSelectedId(id);
      navigateView(options.view || 'notes');
    }
    markDirty(id);
    return id;
  }, [markDirty, navigateView, tweaks.defaultTags, tags, mnMdToBlocks, mkBlock]);

  const createNoteFromTemplate = useCallbackA((templateId) => {
    const template = MN_APP_HELPERS.templateById ? MN_APP_HELPERS.templateById(templateId) : (MN_NOTE_TEMPLATES.find(item => item.id === templateId) || MN_NOTE_TEMPLATES[0]);
    const expanded = MN_APP_HELPERS.expandTemplate
      ? MN_APP_HELPERS.expandTemplate(template)
      : { noteTitle: template?.noteTitle || template?.title || 'Untitled', body: template?.body || '', tags: template?.tags || [] };
    return createNote({ title: uniqueNoteTitle(expanded.noteTitle), body: expanded.body, tags: expanded.tags || [] });
  }, [createNote, uniqueNoteTitle]);

  const createDailyNote = useCallbackA(() => {
    const date = MN_APP_HELPERS.todayIsoDate ? MN_APP_HELPERS.todayIsoDate() : new Date().toISOString().slice(0, 10);
    const existing = notesWithBody.find(note => String(note.title || '').trim() === date);
    if (existing) {
      setSelectedId(existing.id);
      navigateView('notes');
      return existing.id;
    }
    return createNoteFromTemplate('daily');
  }, [notesWithBody, navigateView, createNoteFromTemplate]);

  const duplicateNote = useCallbackA((noteId, options = {}) => {
    const source = notesWithBody.find(n => n.id === noteId);
    if (!source) return null;
    const id = createRuntimeNoteId();
    const duplicate = MN_APP_MUTATIONS.duplicateNoteDraft(source, {
      id,
      title: uniqueNoteTitle(`${source.title || 'Untitled'} copy`),
      now: new Date().toISOString(),
    }, {
      normalizeNoteBody: mnNormalizeNoteBody,
      blocksToMd: mnBlocksToMd,
      mdToBlocks: mnMdToBlocks,
      makeEmptyBlock: () => mkBlock({ kind: 'paragraph', content: '' }),
    });
    setNotes(ns => [duplicate, ...ns]);
    if (options.open !== false) {
      setSelectedId(id);
      navigateView(options.view || 'notes');
    }
    markDirty(id);
    return id;
  }, [notesWithBody, mnBlocksToMd, mnMdToBlocks, mkBlock, uniqueNoteTitle, markDirty, navigateView]);

  const updateNote = (id, patch) => {
    setNotes(ns => ns.map(n => {
      if (n.id !== id) return n;
      return MN_APP_MUTATIONS.applyNotePatch(n, patch);
    }));
    markDirty(id);
  };

  const updateNoteBody = useCallbackA((id, bodyOrUpdater) => {
    setNotes(ns => ns.map(n => {
      if (n.id !== id) return n;
      return MN_APP_MUTATIONS.applyNoteBodyUpdate(n, bodyOrUpdater, {
        normalizeNoteBody: mnNormalizeNoteBody,
        blocksToMd: mnBlocksToMd,
        mdToBlocks: mnMdToBlocks,
      });
    }));
    markDirty(id);
  }, [markDirty, mnMdToBlocks, mnBlocksToMd]);

  const linkNovelistChapter = useCallbackA((arcId, chapterId, chapterTitle) => {
    const act = notesWithBody.find(n => n.id === arcId);
    const chapter = notesWithBody.find(n => n.id === chapterId);
    const cleanChapterTitle = chapter?.title || chapterTitle;
    if (!act || !cleanChapterTitle) return;
    updateNoteBody(act.id, body => mnNovelEnsureWikiLinkInSection(body, cleanChapterTitle, 'Chapters'));
    if (chapterId) updateNoteBody(chapterId, body => mnNovelUpsertPropertyLink(body, 'act', act.title));
  }, [notesWithBody, updateNoteBody]);

  const linkNovelistScene = useCallbackA((chapterId, sceneId, sceneTitle) => {
    const chapter = notesWithBody.find(n => n.id === chapterId);
    const scene = notesWithBody.find(n => n.id === sceneId);
    const cleanSceneTitle = scene?.title || sceneTitle;
    if (!chapter || !cleanSceneTitle) return;
    const act = notesWithBody.find(n => n.id === novelistStructure.parentByChapterId?.[chapter.id]);
    updateNoteBody(chapter.id, body => mnNovelEnsureWikiLinkInSection(body, cleanSceneTitle, 'Scenes'));
    if (sceneId) updateNoteBody(sceneId, body => {
      let next = mnNovelUpsertPropertyLink(body, 'chapter', chapter.title);
      if (act) next = mnNovelUpsertPropertyLink(next, 'act', act.title);
      return next;
    });
  }, [notesWithBody, novelistStructure, updateNoteBody]);

  const setNovelistOrder = useCallbackA((noteId, order) => {
    updateNoteBody(noteId, body => order
      ? mnSetBodyProperty(body, 'order', order)
      : mnRemoveBodyProperty(body, 'order'));
  }, [updateNoteBody]);

  const renameNoteTitle = useCallbackA((noteId, title) => {
    const result = MN_APP_MUTATIONS.renameNoteTitleDrafts(notesWithBody, noteId, title, {
      blocksToMd: mnBlocksToMd,
      mdToBlocks: mnMdToBlocks,
      replaceWikiLinkTitle: mnReplaceWikiLinkTitle,
      normalizeNoteBody: mnNormalizeNoteBody,
    });
    if (!result) return;
    setNotes(result.notes);
    result.dirtyIds.forEach(id => markDirty(id));
  }, [notesWithBody, markDirty, mnBlocksToMd, mnMdToBlocks]);

  const convertNovelistType = useCallbackA((noteId, tag) => {
    const note = notes.find(n => n.id === noteId);
    const nextTags = MN_APP_MUTATIONS.convertNovelistTypeTags(note, tag, normalizeTagName);
    if (!nextTags) return;
    updateNote(noteId, { tags: nextTags });
  }, [notes, updateNote]);

  const updateNoteBlocks = useCallbackA((id, blocksOrUpdater) => {
    setNotes(ns => ns.map(n => {
      if (n.id !== id) return n;
      return MN_APP_MUTATIONS.applyNoteBlocksUpdate(n, blocksOrUpdater, {
        resolveBlocksChange: window.MN_EDITOR_OPS.resolveBlocksChange,
      });
    }));
    markDirty(id);
  }, [markDirty]);

  const toggleCheckFromAggregate = (it) => {
    if (it.isReminderOnly) return;
    const n = notes.find(x => x.id === it.noteId);
    if (!n) return;
    if (it.blockId) {
      const nextBlocks = mnCloneBlocks(n.blocks || []);
      const loc = mnLocate(nextBlocks, it.blockId);
      if (loc?.block?.kind === 'todo') {
        loc.block.checked = !loc.block.checked;
        updateNote(it.noteId, { blocks: nextBlocks });
      }
      return;
    }
    const target = it.text.trim();
    let changed = false;
    const walkMutate = (bs) => bs.map(b => {
      if (!changed && b.kind === 'todo' && b.content.trim() === target) {
        changed = true;
        return { ...b, checked: !b.checked, children: walkMutate(b.children) };
      }
      return { ...b, children: walkMutate(b.children) };
    });
    updateNote(it.noteId, { blocks: walkMutate(n.blocks || []) });
  };

  const updateWorkflowNoteStatus = useCallbackA((noteId, _itemId, workflow) => {
    if (!notes.find(x => x.id === noteId)) return;
    updateNoteBody(noteId, body => workflow
      ? mnSetBodyProperty(body, 'status', workflow)
      : mnRemoveBodyProperty(body, 'status'));
  }, [notes, updateNoteBody]);

  const updateWorkflowArchived = useCallbackA((noteId, workflowArchived) => {
    updateNote(noteId, { workflowArchived: !!workflowArchived });
  }, [updateNote]);

  const updateNoteTags = useCallbackA((noteId, noteTags) => {
    updateNote(noteId, { tags: noteTags });
  }, [updateNote]);

  const addTag = (name) => {
    const clean = normalizeTagName(name);
    if (!clean) return null;
    if (tags.find(t => t.name === clean)) return clean;
    const hue = (Math.floor(Math.random() * 12) * 30) + 10;
    setTags(ts => ts.find(t => t.name === clean) ? ts : [...ts, { name: clean, hue }]);
    markTagsDirty();
    return clean;
  };

  const removeTag = (name) => {
    const clean = normalizeTagName(name);
    if (!clean || !tags.find(t => t.name === clean)) return;
    const tagRemoval = MN_APP_MUTATIONS.removeTagFromNotes(notes, clean);
    setTags(ts => ts.filter(t => t.name !== clean));
    if (selectedTag === clean) setSelectedTag(null);
    if (tagRemoval.dirtyIds.length) {
      setNotes(tagRemoval.notes);
      tagRemoval.dirtyIds.forEach(id => markDirty(id));
    }
    markTagsDirty();
  };

  const removeNovelistSupportingType = (name) => {
    const clean = normalizeTagName(name);
    const structureTags = new Set(['novel-act', 'novel-chapter', 'novel-scene']);
    if (!clean || structureTags.has(clean)) return;
    setTags(ts => ts.filter(t => t.name !== clean));
    if (selectedTag === clean) setSelectedTag(null);
    markTagsDirty();
  };

  const promptNewTag = (name) => {
    if (typeof name === 'string') addTag(name);
  };

  const requestDeleteNote = (id) => {
    if (!notes.find(x => x.id === id)) return;
    setDeleteTargetId(id);
  };

  const deleteNote = async (id) => {
    const n = notes.find(x => x.id === id);
    if (!n) return;
    const previousNotes = notes;
    const previousSelectedId = selectedId;
    const dirtyKey = mnDirtyNoteKey(activeVaultId, id);
    const previousDirtyEntry = dirtyNotes.get(dirtyKey);
    setDeleteTargetId(null);
    setDirtyNotes(cur => {
      if (!cur.has(dirtyKey)) return cur;
      const next = new Map(cur);
      next.delete(dirtyKey);
      return next;
    });
    setNotes(ns => ns.filter(x => x.id !== id));
    const rest = notes.filter(x => x.id !== id);
    setSelectedId(rest[0]?.id || null);
    if (HAS_DISK && activeVaultId) {
      try {
        const res = await window.mn.deleteNote(activeVaultId, id, noteForDisk(n, mnBlocksToMd));
        if (res && res.ok === false) throw new Error(res.error);
      }
      catch (e) {
        console.error('deleteNote failed', e);
        setNotes(previousNotes);
        setSelectedId(previousSelectedId);
        if (previousDirtyEntry) {
          setDirtyNotes(cur => {
            const next = new Map(cur);
            next.set(dirtyKey, previousDirtyEntry);
            return next;
          });
        }
        showAppNotice('Could not delete note', e.message || String(e));
      }
    }
  };

  const normalizeRuntimeNote = useCallbackA((note) => {
    return normalizeNotes([note], mnMdToBlocks)[0] || null;
  }, [mnMdToBlocks]);

  const listDeletedNotes = useCallbackA(async () => {
    if (!HAS_DISK || !activeVaultId) return [];
    const [noteRes, canvasRes] = await Promise.all([
      window.mn.listDeletedNotes(activeVaultId),
      window.mn.listDeletedCanvases ? window.mn.listDeletedCanvases(activeVaultId) : Promise.resolve({ ok: true, value: [] }),
    ]);
    if (!noteRes.ok) throw new Error(noteRes.error || 'Could not load deleted notes');
    if (!canvasRes.ok) throw new Error(canvasRes.error || 'Could not load deleted canvases');
    return [...(noteRes.value || []), ...(canvasRes.value || [])]
      .sort((a, b) => new Date(b.deletedAt || 0) - new Date(a.deletedAt || 0));
  }, [activeVaultId]);

  const restoreDeletedNote = useCallbackA(async (itemOrTrashId) => {
    const trashId = typeof itemOrTrashId === 'string' ? itemOrTrashId : itemOrTrashId?.trashId;
    const sourceType = typeof itemOrTrashId === 'object' ? itemOrTrashId?.sourceType : 'note';
    if (!HAS_DISK || !activeVaultId || !trashId) return { ok: false, error: 'No active vault.' };
    try {
      if (sourceType === 'canvas') {
        const res = await window.mn.restoreDeletedCanvas(activeVaultId, trashId);
        if (!res.ok) throw new Error(res.error || 'Could not restore canvas');
        const restored = summarizeCanvas(res.value);
        setCanvases(current => upsertCanvasList(current, restored));
        setVaults(vs => vs.map(v => v.id === activeVaultId
          ? { ...v, canvases: upsertCanvasList(v.canvases || [], restored) }
          : v));
        setActiveCanvas(res.value);
        navigateView('canvas');
        return { ok: true, canvas: res.value };
      }
      const res = await window.mn.restoreDeletedNote(activeVaultId, trashId);
      if (!res.ok) throw new Error(res.error || 'Could not restore note');
      const restored = normalizeRuntimeNote(res.value);
      if (!restored) throw new Error('Restored note could not be loaded');
      setNotes(ns => [restored, ...ns.filter(n => n.id !== restored.id)]);
      setVaults(vs => vs.map(v => v.id === activeVaultId && Array.isArray(v.notes)
        ? { ...v, notes: [restored, ...v.notes.filter(n => n.id !== restored.id)] }
        : v));
      setSelectedId(restored.id);
      setSelectedTag(null);
      setSelectedWorkflow(null);
      navigateView('notes');
      return { ok: true, note: restored };
    } catch (e) {
      console.error('restoreDeletedNote failed', e);
      showAppNotice('Could not restore note', e.message || String(e));
      return { ok: false, error: e.message || String(e) };
    }
  }, [activeVaultId, normalizeRuntimeNote, navigateView, showAppNotice]);

  const purgeDeletedNote = useCallbackA(async (itemOrTrashId) => {
    const trashId = typeof itemOrTrashId === 'string' ? itemOrTrashId : itemOrTrashId?.trashId;
    const sourceType = typeof itemOrTrashId === 'object' ? itemOrTrashId?.sourceType : 'note';
    if (!HAS_DISK || !activeVaultId || !trashId) return { ok: false, error: 'No active vault.' };
    try {
      const res = sourceType === 'canvas' && window.mn.purgeDeletedCanvas
        ? await window.mn.purgeDeletedCanvas(activeVaultId, trashId)
        : await window.mn.purgeDeletedNote(activeVaultId, trashId);
      if (!res.ok) throw new Error(res.error || 'Could not permanently delete note');
      return { ok: true };
    } catch (e) {
      console.error('purgeDeletedNote failed', e);
      showAppNotice('Could not permanently delete note', e.message || String(e));
      return { ok: false, error: e.message || String(e) };
    }
  }, [activeVaultId, showAppNotice]);

  const restoreNoteVersion = useCallbackA(async (noteId, versionId) => {
    if (!HAS_DISK || !activeVaultId || !noteId || !versionId) return { ok: false, error: 'No active vault.' };
    try {
      const res = await window.mn.restoreNoteVersion(activeVaultId, noteId, versionId);
      if (!res.ok) throw new Error(res.error || 'Could not restore note version');
      const restored = normalizeRuntimeNote(res.value);
      if (!restored) throw new Error('Restored version could not be loaded');
      setNotes(ns => ns.map(n => n.id === restored.id ? restored : n));
      setVaults(vs => vs.map(v => v.id === activeVaultId && Array.isArray(v.notes)
        ? { ...v, notes: v.notes.map(n => n.id === restored.id ? restored : n) }
        : v));
      setDirtyNotes(cur => {
        const key = mnDirtyNoteKey(activeVaultId, restored.id);
        if (!cur.has(key)) return cur;
        const next = new Map(cur);
        next.delete(key);
        return next;
      });
      setSelectedId(restored.id);
      navigateView('notes');
      return { ok: true, note: restored };
    } catch (e) {
      console.error('restoreNoteVersion failed', e);
      showAppNotice('Could not restore version', e.message || String(e));
      return { ok: false, error: e.message || String(e) };
    }
  }, [activeVaultId, normalizeRuntimeNote, navigateView, showAppNotice]);

  const reloadConflictFromDisk = useCallbackA(async () => {
    const conflict = conflictNotice;
    if (!conflict?.vaultId || !conflict?.noteId) return;
    try {
      const res = await window.mn.loadVault(conflict.vaultId);
      if (!res.ok) throw new Error(res.error || 'Could not reload note');
      const loaded = normalizeNotes(res.value.notes || [], mnMdToBlocks);
      const diskNote = loaded.find(note => note.id === conflict.noteId);
      if (!diskNote) throw new Error('The disk version no longer exists.');
      if (conflict.vaultId === activeVaultId) {
        setNotes(ns => ns.map(n => n.id === conflict.noteId ? diskNote : n));
      }
      setVaults(vs => vs.map(v => v.id === conflict.vaultId && Array.isArray(v.notes)
        ? { ...v, notes: v.notes.map(n => n.id === conflict.noteId ? diskNote : n) }
        : v));
      setDirtyNotes(cur => {
        const key = mnDirtyNoteKey(conflict.vaultId, conflict.noteId);
        if (!cur.has(key)) return cur;
        const next = new Map(cur);
        next.delete(key);
        return next;
      });
      setConflictNotice(null);
    } catch (e) {
      console.error('reload conflict failed', e);
      showAppNotice('Could not reload disk version', e.message || String(e));
    }
  }, [activeVaultId, conflictNotice, mnMdToBlocks, showAppNotice]);

  const keepConflictAsDuplicate = useCallbackA(async () => {
    const conflict = conflictNotice;
    if (!conflict?.vaultId || !conflict?.noteId) return;
    const source = notesWithBody.find(note => note.id === conflict.noteId);
    if (!source) return;
    const duplicateId = createRuntimeNoteId();
    const duplicateTitle = uniqueNoteTitle(`${source.title || 'Untitled'} local copy`);
    const duplicateBody = mnNormalizeNoteBody(source.body || mnBlocksToMd(source.blocks || []), duplicateTitle);
    const duplicate = {
      ...source,
      id: duplicateId,
      title: duplicateTitle,
      body: duplicateBody,
      blocks: mnMdToBlocks(duplicateBody || ''),
      pinned: false,
      date: new Date().toISOString(),
      modifiedAt: new Date().toISOString(),
      diskModifiedAt: null,
    };
    setNotes(ns => [duplicate, ...ns]);
    setVaults(vs => vs.map(v => v.id === conflict.vaultId && Array.isArray(v.notes)
      ? { ...v, notes: [duplicate, ...v.notes] }
      : v));
    markDirty(duplicateId);
    await reloadConflictFromDisk();
    setSelectedId(duplicateId);
  }, [conflictNotice, notesWithBody, uniqueNoteTitle, mnBlocksToMd, mnMdToBlocks, markDirty, reloadConflictFromDisk]);

  const summarizeCanvas = (canvas) => ({
    ...MN_APP_MUTATIONS.summarizeCanvas(canvas),
  });

  const upsertCanvasList = (list, canvas) => {
    return MN_APP_MUTATIONS.upsertCanvasList(list, canvas);
  };

  const canvasActionContext = useCallbackA((overrides = {}) => ({
    activeVaultId,
    activeCanvas,
    canvases,
    hasDisk: HAS_DISK,
    mn: window.mn,
    newCanvas: window.mnNewCanvas,
    upsertCanvasList,
    setCanvases,
    setVaults,
    setActiveCanvas,
    setSelectedTag,
    setSelectedWorkflow,
    setQuery,
    navigateView,
    showAppNotice,
    logError: (...args) => console.error(...args),
    ...overrides,
  }), [activeVaultId, activeCanvas, canvases, navigateView, showAppNotice]);

  const cacheCanvases = useCallbackA((nextCanvases) => {
    MN_APP_CANVAS_ACTIONS.cacheCanvases(nextCanvases, canvasActionContext());
  }, [canvasActionContext]);

  const upsertCanvasSummary = useCallbackA((canvas) => {
    MN_APP_CANVAS_ACTIONS.upsertCanvasSummary(canvas, canvasActionContext());
  }, [canvasActionContext]);

  const openCanvasDashboard = useCallbackA(() => {
    MN_APP_CANVAS_ACTIONS.openCanvasDashboard(canvasActionContext());
  }, [canvasActionContext]);

  const openCanvas = useCallbackA(async (canvasId) => {
    return MN_APP_CANVAS_ACTIONS.openCanvas(canvasId, canvasActionContext());
  }, [canvasActionContext]);

  const createCanvas = useCallbackA(async (title = 'Untitled canvas', options = {}) => {
    return MN_APP_CANVAS_ACTIONS.createCanvas(title, options, canvasActionContext());
  }, [canvasActionContext]);

  const saveCanvas = useCallbackA(async (canvas) => {
    return MN_APP_CANVAS_ACTIONS.saveCanvas(canvas, canvasActionContext());
  }, [canvasActionContext]);

  const deleteCanvas = useCallbackA(async (canvasId) => {
    return MN_APP_CANVAS_ACTIONS.deleteCanvas(canvasId, canvasActionContext());
  }, [canvasActionContext]);

  const exportBackup = useCallbackA(async () => {
    if (!window.mn?.exportBackup) return showAppNotice('Backup unavailable', 'This build does not expose backup export.');
    try {
      const res = await window.mn.exportBackup({});
      if (!res.ok) throw new Error(res.error);
      if (!res.value?.canceled) showAppNotice('Backup exported', `${res.value.vaultCount || 0} vault${res.value.vaultCount === 1 ? '' : 's'} saved.`, 'info');
    } catch (e) {
      showAppNotice('Could not export backup', e.message || String(e));
    }
  }, [showAppNotice]);

  const importBackup = useCallbackA(async () => {
    if (!window.mn?.importBackup) return showAppNotice('Import unavailable', 'This build does not expose backup import.');
    try {
      const res = await window.mn.importBackup({ activate: true });
      if (!res.ok) throw new Error(res.error);
      if (res.value?.canceled) return;
      await refreshVaultRegistry({ reloadActive: true, reason: 'import-backup' });
      showAppNotice('Backup imported', `${res.value.importedVaults?.length || 0} vault${res.value.importedVaults?.length === 1 ? '' : 's'} restored.`, 'info');
    } catch (e) {
      showAppNotice('Could not import backup', e.message || String(e));
    }
  }, [refreshVaultRegistry, showAppNotice]);

  const rebuildIndex = useCallbackA(async () => {
    if (!activeVaultId || !window.mn?.rebuildIndex) return;
    try {
      const res = await window.mn.rebuildIndex(activeVaultId);
      if (!res.ok) throw new Error(res.error);
      showAppNotice('Index rebuilt', `${res.value.indexed || 0} notes indexed.`, 'info');
    } catch (e) {
      showAppNotice('Could not rebuild index', e.message || String(e));
    }
  }, [activeVaultId, showAppNotice]);

  const commands = useMemoA(() => {
    const base = [
      { id: 'new-note', title: 'New note', section: 'Create', shortcut: 'Ctrl+N', keywords: 'page capture', run: () => createNote() },
      { id: 'quick-capture', title: 'Quick capture', section: 'Create', shortcut: 'Ctrl+Shift+N', keywords: 'inbox', run: () => setCaptureOpen(true) },
      { id: 'daily-note', title: 'Open daily note', section: 'Create', keywords: 'today journal', run: createDailyNote },
      { id: 'ask-ai', title: 'Ask AI', section: 'AI', shortcut: 'Ctrl+Shift+K', keywords: 'assistant chat', enabled: HAS_DISK, run: () => openAskAi() },
      { id: 'settings', title: 'Open settings', section: 'System', keywords: 'preferences', run: () => setSettingsOpen(true) },
      { id: 'graph', title: 'Open graph', section: 'Navigate', shortcut: 'Ctrl+G', run: () => { navigateView('graph'); setSelectedTag(null); setSelectedWorkflow(null); } },
      { id: 'today', title: 'Open Today', section: 'Navigate', run: () => { navigateView('today'); setSelectedTag(null); setSelectedWorkflow(null); } },
      { id: 'todos', title: 'Open Todos', section: 'Navigate', run: () => { navigateView('todos'); setSelectedTag(null); setSelectedWorkflow(null); } },
      { id: 'canvas', title: 'Open canvas dashboard', section: 'Navigate', run: openCanvasDashboard },
      { id: 'vault-health', title: 'Open vault health', section: 'Vault', enabled: HAS_DISK, run: () => setVaultHealthOpen(true) },
      { id: 'export-backup', title: 'Export backup', section: 'Vault', enabled: HAS_DISK, run: exportBackup },
      { id: 'import-backup', title: 'Import backup', section: 'Vault', enabled: HAS_DISK, run: importBackup },
      { id: 'rebuild-index', title: 'Rebuild search index', section: 'Vault', enabled: HAS_DISK, run: rebuildIndex },
      ...MN_NOTE_TEMPLATES.map(template => ({
        id: `template-${template.id}`,
        title: `New ${template.title}`,
        section: 'Templates',
        keywords: `${template.id} template`,
        run: () => createNoteFromTemplate(template.id),
      })),
      ...vaultsForSidebar.map(vault => ({
        id: `vault-${vault.id}`,
        title: `Switch to ${vault.name}`,
        section: 'Vaults',
        keywords: 'switch workspace',
        enabled: vault.id !== activeVaultId,
        run: () => selectVault(vault.id),
      })),
      ...notesWithBody.slice(0, 120).map(note => ({
        id: `note-${note.id}`,
        title: note.title || 'Untitled',
        section: 'Notes',
        keywords: `${(note.tags || []).join(' ')} ${note.body || ''}`.slice(0, 500),
        run: () => { setSelectedId(note.id); navigateView('notes'); },
      })),
    ];
    return base;
  }, [activeVaultId, createDailyNote, createNote, createNoteFromTemplate, exportBackup, importBackup, notesWithBody, openAskAi, openCanvasDashboard, rebuildIndex, selectVault, vaultsForSidebar, navigateView]);

  useEffectA(() => {
    const h = (e) => {
      const isMod = e.metaKey || e.ctrlKey;
      const key = e.key || '';
      const lowerKey = key.toLowerCase();
      const isBackslashKey = key === '\\' || key === '|' || e.code === 'Backslash';
      if (isMod && e.shiftKey && lowerKey === 'n') {
        e.preventDefault(); setCaptureOpen(true);
      } else if (isMod && lowerKey === 'n' && !e.shiftKey) {
        e.preventDefault(); createNote();
      } else if (isMod && lowerKey === 'g') {
        e.preventDefault();
        navigateView(view === 'graph' ? 'notes' : 'graph');
        setSelectedTag(null); setSelectedWorkflow(null);
      } else if (isMod && e.shiftKey && lowerKey === 'k') {
        e.preventDefault();
        openAskAi();
      } else if (isMod && lowerKey === 'k') {
        e.preventDefault();
        setCommandPaletteOpen(v => !v);
      } else if (isMod && e.shiftKey && isBackslashKey) {
        e.preventDefault(); setNoteListHidden(v => !v);
      } else if (isMod && isBackslashKey && !e.shiftKey) {
        e.preventDefault(); setSidebarHidden(v => !v);
      } else if (e.key === 'Escape') {
        setSettingsOpen(false); setAskAiOpen(false); setReminderCenterOpen(false);
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [createNote, view, navigateView, openAskAi]);

  useEffectA(() => {
    if (!toast?.key) return;
    if (blockingOverlayOpen) {
      quietedReminderKeys.current.add(toast.key);
      setToast(null);
      return;
    }
    const handle = setTimeout(() => {
      quietedReminderKeys.current.add(toast.key);
      setToast(current => current?.key === toast.key ? null : current);
    }, 9000);
    return () => clearTimeout(handle);
  }, [toast?.key, blockingOverlayOpen]);

  // Runtime reminder scan over @remind directives in the active vault.
  useEffectA(() => {
    if (bootState !== 'ready') return;
    const check = () => {
      if (toast) return;
      const now = Date.now();
      const today = new Date().toDateString();
      const snoozed = mnReadSnoozedReminders();
      const due = mnCollectReminderItems(notesWithBody)
        .filter(item => {
          const dueTime = item.remindAt?.at?.getTime?.();
          if (!dueTime || dueTime > now) return false;
          if (tweaks.showOverdue === false && item.remindAt.at.toDateString() !== today) return false;
          if (dismissedReminderKeys.current.has(item.key)) return false;
          if (quietedReminderKeys.current.has(item.key)) return false;
          if ((Number(snoozed[item.key]) || 0) > now) return false;
          return true;
        })
        .sort((a, b) => a.remindAt.at - b.remindAt.at);
      if (!due.length) return;
      const next = due[0];
      setToast(next);
      if (tweaks.reminderSound === true) mnPlayReminderSound();
    };
    check();
    const tm = setInterval(check, 60000);
    return () => clearInterval(tm);
  }, [bootState, notesWithBody, tweaks.showOverdue, tweaks.reminderSound, toast]);

  // Push vault + selected note into the OS title bar
  useEffectA(() => {
    if (!HAS_DISK) return;
    const vname = vaults.find(v => v.id === activeVaultId)?.name;
    const nname = selectedNote?.title;
    const t = [vname, nname].filter(Boolean).join(' — ') || 'VispNote';
    window.mn.setTitle(t === 'VispNote' ? t : `${t} — VispNote`);
  }, [activeVaultId, vaults, selectedNote]);

  const noteListVisible = view === 'notes' || view === 'graph' || view === 'workflow';
  const reminderCenterTop = view === 'workflow' ? 30 : view === 'graph' ? 12 : 13;
  const noteListTitle = query.trim()
    ? 'Search'
    : selectedTag
    ? `#${selectedTag}`
    : selectedWorkflow
    ? selectedWorkflow
    : (view === 'workflow' ? 'Workflow notes' : view === 'todos' ? 'Todos' : view === 'today' ? 'Daily rollup' : 'All notes');
  const noteListSubtitle = query.trim()
    ? `${filteredNotes.length} match${filteredNotes.length === 1 ? '' : 'es'}`
    : view === 'workflow'
    ? `${filteredNotes.length} note${filteredNotes.length === 1 ? '' : 's'} · ${workflowViewData.total} workflow note${workflowViewData.total === 1 ? '' : 's'}`
    : `${filteredNotes.length} note${filteredNotes.length === 1 ? '' : 's'}${selectedTag ? ' tagged' : selectedWorkflow ? ' with workflow' : ''}`;

  // ── Loading / error screens ─────────────────────────────────────────────
  if (bootState !== 'ready') {
    return <MnLaunchScreen state={bootState} error={bootError} T={T} />;
  }

  return (
    <div style={{
      width: '100vw',
      height: '100vh',
      background: T.bg, position: 'relative',
      fontFamily: 'var(--mn-ui)', overflow: 'hidden',
      fontSize: 'var(--mn-app-font-size)',
    }}>
        <div style={{ display: 'flex', height: '100%' }}>
          {!sidebarHidden && (
            <MnSidebar
              tags={tags} notes={notesWithBody}
              selectedTag={selectedTag}
              selectedWorkflow={selectedWorkflow}
              workflowStates={workflowStates}
              workflowCounts={workflowData.counts}
              workflowTotal={workflowData.total}
              onSelectTag={(t) => { setSelectedTag(t); setSelectedWorkflow(null); navigateView('notes'); }}
              onSelectWorkflow={(wf) => { setSelectedWorkflow(wf); setSelectedTag(null); navigateView('notes'); }}
              onOpenWorkflowPanel={() => { navigateView('workflow'); setSelectedTag(null); setSelectedWorkflow(null); }}
              onOpenNovelist={() => { navigateView('novelist'); setSelectedTag(null); setSelectedWorkflow(null); setQuery(''); }}
              onOpenTodos={() => { navigateView('todos'); setSelectedTag(null); setSelectedWorkflow(null); }}
              onOpenToday={() => { navigateView('today'); setSelectedTag(null); setSelectedWorkflow(null); }}
              onOpenGraph={() => { navigateView('graph'); setSelectedTag(null); setSelectedWorkflow(null); }}
              onOpenCanvas={openCanvasDashboard}
              onOpenAskAI={HAS_DISK ? openAskAi : null}
              todayActive={view === 'today'}
              todosActive={view === 'todos'}
              graphActive={view === 'graph'}
              workflowActive={view === 'workflow'}
              novelistActive={view === 'novelist'}
              novelistEnabled={!!activeVault?.novelistMode}
              novelistCount={novelistNotes.length}
              canvasActive={view === 'canvas'}
              canvasCount={canvases.length}
              onNewTag={promptNewTag}
              onDeleteTag={removeTag}
              onNew={() => setCaptureOpen(true)}
              onOpenSettings={() => setSettingsOpen(true)}
              onCollapse={() => setSidebarHidden(true)}
              vaults={vaultsForSidebar}
              activeVaultId={activeVaultId}
              onSelectVault={selectVault}
              onCreateVault={createVault}
              onRefreshVaults={refreshVaultRegistry}
              onRenameVault={renameVault}
              onDeleteVault={deleteVault}
              T={T} density={tweaks.density} theme={theme}
            />
          )}

          {!sidebarHidden && (
            <MnPanelGrip side="sidebar" onCollapse={() => setSidebarHidden(true)} T={T} />
          )}
          {sidebarHidden && (
            <MnPanelGripPeek onExpand={() => setSidebarHidden(false)} T={T} title="Show sidebar" />
          )}

          {noteListVisible && !noteListHidden && (
            <MnNoteList
              notes={filteredNotes}
              selectedId={selectedId}
              onSelect={(id) => {
                setSelectedId(id);
                if (view === 'notes') return;
              }}
              title={noteListTitle}
              subtitle={noteListSubtitle}
              query={query}
              onQueryChange={setQuery}
              novelistStructure={activeVault?.novelistMode && view === 'notes' && !query.trim() && !selectedTag && !selectedWorkflow ? novelistStructure : null}
              allNotes={notesWithBody}
              onRenameNote={renameNoteTitle}
              onDuplicateNote={duplicateNote}
              onDeleteNote={requestDeleteNote}
              tags={tags} theme={theme} density={tweaks.density} T={T}
            />
          )}

          {noteListVisible && !noteListHidden && (
            <MnPanelGrip side="notelist" onCollapse={() => setNoteListHidden(true)} T={T} />
          )}
          {noteListVisible && noteListHidden && (
            <MnPanelGripPeek onExpand={() => setNoteListHidden(false)} T={T} title="Show note list" />
          )}

          {view === 'notes' && selectedNote && (
            <MnEditor
              note={selectedNote} notes={notesWithBody} tags={tags} links={links}
              vaultId={activeVaultId}
              canvases={canvases}
              onOpenCanvas={openCanvas}
              onCreateCanvas={createCanvas}
              onOpen={(id) => { setSelectedId(id); navigateView('notes'); }}
              onCreateLinkedNote={(title) => {
                const cleanTitle = String(title || '').trim();
                if (!cleanTitle) return null;
                const selectedStage = novelistStructure.stageByNoteId?.[selectedNote.id];
                if (selectedStage === 'act') {
                  return createNote({
                    title: cleanTitle,
                    body: `status:: OUTLINE\norder:: ${nextStoryOrder('chapter', selectedNote.id)}\nact:: [[${selectedNote.title}]]\n## Scenes\n- Goal\n- Scene list\n- Revision notes`,
                    tags: ['novel-chapter'],
                  });
                }
                if (selectedStage === 'chapter') {
                  const act = notesWithBody.find(n => n.id === novelistStructure.parentByChapterId?.[selectedNote.id]);
                  return createNote({
                    title: cleanTitle,
                    body: `status:: DRAFT\norder:: ${nextStoryOrder('scene', selectedNote.id)}\n${act ? `act:: [[${act.title}]]\n` : ''}chapter:: [[${selectedNote.title}]]\npov:: \nsetting:: \npurpose:: \nDraft the scene here.`,
                    tags: ['novel-scene'],
                  });
                }
                const lowerTitle = cleanTitle.toLowerCase();
                const inferredTags = lowerTitle.includes('scene')
                  ? ['novel-scene']
                  : lowerTitle.includes('chapter')
                  ? ['novel-chapter']
                  : lowerTitle.includes('act')
                  ? ['novel-act']
                  : [];
                return createNote({ title: cleanTitle, body: '', tags: inferredTags });
              }}
              onOpenTag={(t) => {
                if (!tags.find(x => x.name === t)) addTag(t);
                setSelectedTag(t); setSelectedWorkflow(null); navigateView('notes');
              }}
              onBlocksChange={(blocks) => updateNoteBlocks(selectedNote.id, blocks)}
              onTitleChange={(title) => updateNote(selectedNote.id, { title })}
              onAddTag={(t) => updateNote(selectedNote.id, { tags: [...selectedNote.tags, t] })}
              onCreateTag={(raw) => {
                const name = addTag(raw);
                if (name && !selectedNote.tags.includes(name)) {
                  updateNote(selectedNote.id, { tags: [...selectedNote.tags, name] });
                }
              }}
              onRemoveTag={(t) => updateNote(selectedNote.id, { tags: selectedNote.tags.filter(x => x !== t) })}
              onPinToggle={() => updateNote(selectedNote.id, { pinned: !selectedNote.pinned })}
              onDuplicate={() => duplicateNote(selectedNote.id)}
              onDelete={() => requestDeleteNote(selectedNote.id)}
              onOpenVersions={HAS_DISK ? () => setVersionTargetId(selectedNote.id) : null}
              onOpenGraph={() => { navigateView('graph'); setSelectedTag(null); setSelectedWorkflow(null); }}
              onBack={goBackView}
              onToggleSidebar={() => setSidebarHidden(v => !v)}
              sidebarHidden={sidebarHidden}
              onToggleNoteList={() => setNoteListHidden(v => !v)}
              noteListHidden={noteListHidden}
              editorWidth={tweaks.editorWidth}
              fontSize={tweaks.fontSize}
              indentGuides={tweaks.indentGuides !== false}
              spellCheck={tweaks.spellCheck !== false}
              autoLink={tweaks.autoLink !== false}
              collapseByDefault={tweaks.collapseByDefault === true}
              novelistPath={activeVault?.novelistMode ? novelistStructure.pathByNoteId?.[selectedNote.id] : null}
              novelistMode={!!activeVault?.novelistMode}
              workflowStates={workflowStates}
              workflowStatus={mnNormalizeNoteStatus(
                mnBodyPropertyValue(notesWithBody.find(n => n.id === selectedNote.id)?.body || '', 'status'),
                workflowStates
              )}
              onSetWorkflowStatus={(status) => updateWorkflowNoteStatus(selectedNote.id, null, status)}
              theme={theme} T={T}
            />
          )}

          {view === 'graph' && (
            <MnGraph
              notes={graphVisibleNotes} links={links} tags={tags}
              focusId={selectedId}
              style={tweaks.graphStyle}
              graphFilter={activeVault?.novelistMode ? graphFilter : null}
              onGraphFilterChange={setGraphFilter}
              onOpen={(id) => { setSelectedId(id); navigateView('notes'); }}
              T={T}
            />
          )}

          {view === 'todos' && (
            <MnTodosPanel
              notes={notesWithBody} tags={tags}
              onOpen={(id) => { setSelectedId(id); navigateView('notes'); }}
              onToggleCheck={toggleCheckFromAggregate}
              T={T} theme={theme} variant={tweaks.todoVariant}
            />
          )}
          {view === 'workflow' && (
            <MnWorkflowPanel
              notes={notesWithBody}
              tags={tags}
              workflowStates={workflowStates}
              workflowItems={workflowViewData.byState}
              archivedNotes={workflowViewData.archivedNotes}
              onWorkflowStatesChange={updateWorkflowStates}
              onOpen={(id) => { setSelectedId(id); navigateView('notes'); }}
              onSetWorkflow={updateWorkflowNoteStatus}
              onSetWorkflowArchived={updateWorkflowArchived}
              onSetNoteTags={updateNoteTags}
              T={T} theme={theme}
            />
          )}
          {view === 'novelist' && !!activeVault?.novelistMode && (
            <MnNovelistPanel
              notes={notesWithBody}
              novelistNotes={novelistNotes}
              tags={tags}
              vaultId={activeVaultId}
              workflowStates={workflowStates}
              workflowItems={workflowViewData.byState}
              novelistStructure={novelistStructure}
              onOpen={(id) => { setSelectedId(id); navigateView('notes'); }}
              onCreateNote={({ title, body, tags: noteTags }) => createNote({ title, body, tags: noteTags || [] }, { open: false })}
              onLinkChapter={linkNovelistChapter}
              onLinkScene={linkNovelistScene}
              onSetOrder={setNovelistOrder}
              onRenameNote={renameNoteTitle}
              onConvertNoteType={convertNovelistType}
              onDeleteNote={requestDeleteNote}
              onCreateTag={addTag}
              onRemoveSupportingType={removeNovelistSupportingType}
              initialAiConfig={activeVault?.novelistAiConfig || null}
              onAiConfigChange={updateNovelistAiConfig}
              T={T}
              theme={theme}
            />
          )}
          {view === 'today' && (
            <MnTodayPanel
              notes={notesWithBody} tags={tags}
              onOpen={(id) => { setSelectedId(id); navigateView('notes'); }}
              rollupFormat={tweaks.rollupFormat || 'long'}
              T={T} theme={theme}
            />
          )}
          {view === 'canvas' && (
            <MnCanvasPanel
              canvases={canvases}
              activeCanvas={activeCanvas}
              onCreate={createCanvas}
              onOpen={openCanvas}
              onBack={openCanvasDashboard}
              onSave={saveCanvas}
              onDelete={deleteCanvas}
              T={T}
            />
          )}
        </div>

        <MnCommandPalette
          open={commandPaletteOpen}
          commands={commands}
          onClose={() => setCommandPaletteOpen(false)}
          T={T}
        />
        {vaultHealthOpen && (
          <MnVaultHealthDialog
            vaultId={activeVaultId}
            onClose={() => setVaultHealthOpen(false)}
            onRebuildIndex={rebuildIndex}
            T={T}
          />
        )}

        {captureOpen && (
          <MnQuickCapture
            tags={tags}
            onClose={() => setCaptureOpen(false)}
            onSave={({ title, body, tags: noteTags }) => {
              createNote({ title, body, tags: noteTags });
              setCaptureOpen(false);
            }}
            T={T} theme={theme}
          />
        )}
        <MnReminderToast
          toast={blockingOverlayOpen ? null : toast}
          onDismiss={() => {
            if (toast?.key) dismissedReminderKeys.current.add(toast.key);
            setToast(null);
          }}
          onSnooze={() => {
            if (toast?.key) {
              const minutes = Number(tweaks.snoozeMinutes || 15) || 15;
              mnWriteSnoozedReminder(toast.key, Date.now() + minutes * 60000);
            }
            setToast(null);
          }}
          onOpen={(id) => {
            if (toast?.key) dismissedReminderKeys.current.add(toast.key);
            setSelectedId(id); navigateView('notes'); setToast(null);
          }}
          T={T} variant={tweaks.toastVariant}
        />
        <MnAiNotice
          notice={aiNotice}
          onOpen={openAskAi}
          onDismiss={() => setAiNotice(null)}
          T={T}
        />

        <MnReminderCenter
          open={reminderCenterOpen}
          items={reminderCenterItems}
          dueCount={reminderDueCount}
          onToggle={() => setReminderCenterOpen(v => !v)}
          onClose={() => setReminderCenterOpen(false)}
          onOpenNote={(item) => {
            if (item?.key && item.status === 'due') dismissedReminderKeys.current.add(item.key);
            setSelectedId(item.noteId);
            navigateView('notes');
            setReminderCenterOpen(false);
            if (toast?.key === item?.key) setToast(null);
          }}
          topOffset={reminderCenterTop}
          T={T}
        />

        {/* FAB */}
        <button onClick={() => setCaptureOpen(true)} title="Quick capture (⌘⇧N)"
          style={{
            position: 'absolute', bottom: 22, right: 22, zIndex: 20,
            width: 44, height: 44, borderRadius: '50%', cursor: 'pointer',
            background: T.ink, color: T.bg, border: 'none',
            boxShadow: `0 8px 24px color-mix(in oklab, ${T.ink} 30%, transparent)`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7">
            <path d="M8 3V13M3 8H13" strokeLinecap="round"/>
          </svg>
        </button>

        {settingsOpen && (
          <MnSettingsModal tweaks={tweaks} setTweak={setTweak} T={T}
            stats={appStats}
            vaults={vaultsForSidebar}
            activeVaultId={activeVaultId}
            activeVault={activeVault}
            onCreateVault={createVault}
            onDeleteVault={deleteVault}
            onSetVaultNovelistMode={setActiveVaultNovelistMode}
            onListDeletedNotes={listDeletedNotes}
            onRestoreDeletedNote={restoreDeletedNote}
            onPurgeDeletedNote={purgeDeletedNote}
            onExportBackup={exportBackup}
            onImportBackup={importBackup}
            onOpenVaultHealth={() => setVaultHealthOpen(true)}
            onRebuildIndex={rebuildIndex}
            onClose={() => setSettingsOpen(false)} />
        )}
        {deleteTargetNote && (
          <MnDeleteNoteDialog
            note={deleteTargetNote}
            T={T}
            onCancel={() => setDeleteTargetId(null)}
            onConfirm={() => deleteNote(deleteTargetNote.id)}
          />
        )}
        {appNotice && (
          <MnAppNoticeDialog
            notice={appNotice}
            T={T}
            onClose={() => setAppNotice(null)}
          />
        )}
        {conflictNotice && (
          <MnSaveConflictDialog
            conflict={conflictNotice}
            T={T}
            onReloadDisk={reloadConflictFromDisk}
            onKeepCopy={keepConflictAsDuplicate}
            onDismiss={() => setConflictNotice(null)}
          />
        )}
        {versionTargetId && (
          <MnVersionHistoryDialog
            note={notesWithBody.find(note => note.id === versionTargetId)}
            vaultId={activeVaultId}
            T={T}
            onClose={() => setVersionTargetId(null)}
            onRestore={restoreNoteVersion}
          />
        )}
        {askAiOpen && (
          <MnAskAI
            vaultId={activeVaultId}
            currentNote={selectedNote ? {
              ...selectedNote,
              body: mnNormalizeNoteBody(mnBlocksToMd(selectedNote.blocks || []), selectedNote.title || 'Untitled'),
            } : null}
            allNotes={notesWithBody}
            initialQuery={askAiSeed}
            onClose={() => setAskAiOpen(false)}
            onOpenNote={(id) => { setSelectedId(id); navigateView('notes'); }}
            onCreateNote={({ title, body, tags: noteTags }) => createNote({ title, body, tags: noteTags || [] })}
            onApplyCurrentPageBody={(body) => {
              if (!selectedNote) return;
              const cleanBody = mnNormalizeNoteBody(body, selectedNote.title || 'Untitled');
              updateNote(selectedNote.id, { body: cleanBody, blocks: mnMdToBlocks(cleanBody) });
            }}
            session={askAiSession}
            setSession={setAskAiSession}
            onBackgroundComplete={notifyAskAiComplete}
            T={T} />
        )}
    </div>
  );
}

window.MnApp = MnApp;
