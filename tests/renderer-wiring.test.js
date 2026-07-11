const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { appHelpersSource, appSource, backendAiSource, outlinerSource } = require('./helpers/source.js');
const vm = require('node:vm');
const { loadRendererModule } = require('./helpers/rendererModule.js');

const ops = require('../src/editor/editorOps.js');
const tableOps = require('../src/editor/tableOps.js');
const appHelpers = require('../src/app/appHelpers.js');
const appNovelist = require('../src/app/appNovelist.js');
const appMutations = require('../src/app/appMutations.js');
const appCanvasActions = require('../src/app/appCanvasActions.js');
const { block, loadOutlineForTest, withIsolatedStore } = require('./helpers/common.js');
const projectPaths = require('./helpers/paths.js');

function mainProcessSource() {
  const files = [path.join(__dirname, '../main.js')];
  for (const folder of ['../main', '../lib/connectors/ipc']) {
    const root = path.join(__dirname, folder);
    files.push(...fs.readdirSync(root)
      .filter(name => name.endsWith('.js'))
      .sort()
      .map(name => path.join(root, name)));
  }
  return files.map(file => fs.readFileSync(file, 'utf8')).join('\n');
}

function settingsSource() {
  const root = path.join(__dirname, '../src/settings');
  const files = [
    path.join(root, 'settings.jsx'),
    path.join(root, 'settingsControls.jsx'),
    path.join(root, 'settingsPrimitives.jsx'),
    ...fs.readdirSync(path.join(root, 'sections')).sort().map(name => path.join(root, 'sections', name)),
  ];
  return files.map(file => fs.readFileSync(file, 'utf8')).join('\n');
}

function appShellSource() {
  const root = path.join(__dirname, '../src/app');
  return [
    fs.readFileSync(path.join(root, 'appShell.jsx'), 'utf8'),
    ...fs.readdirSync(path.join(root, 'shell')).sort().map(name => fs.readFileSync(path.join(root, 'shell', name), 'utf8')),
  ].join('\n');
}

function canvasSource() {
  const root = path.join(__dirname, '../src/features/canvas');
  return [
    fs.readFileSync(path.join(root, 'CanvasPanel.jsx'), 'utf8'),
    ...fs.readdirSync(path.join(root, 'components')).sort().map(name => fs.readFileSync(path.join(root, 'components', name), 'utf8')),
    fs.readFileSync(path.join(root, 'useCanvasKeyboardShortcuts.js'), 'utf8'),
  ].join('\n');
}

function specialistPanelsSource() {
  const files = [
    '../src/panels/panels.jsx',
    '../src/features/writer/NovelistPanel.jsx',
    '../src/features/writer/NovelistPanelView.jsx',
    '../src/features/writer/NovelistSections.jsx',
    '../src/features/writer/SupportingNoteSection.jsx',
    '../src/features/workflow/WorkflowPanel.jsx',
    '../src/features/workflow/WorkflowSupportPanels.jsx',
    '../src/shared/panels/panelStyles.js',
  ];
  return files.map(file => fs.readFileSync(path.join(__dirname, file), 'utf8')).join('\n');
}

function rendererAiSource() {
  const root = path.join(__dirname, '../src/ai');
  const files = fs.readdirSync(root)
    .filter(name => name === 'ai.jsx' || /^(?:ai.+|AskAi.+|create.+)\.(?:js|jsx)$/.test(name))
    .sort()
    .map(name => path.join(root, name));
  files.push(path.join(__dirname, '../src/features/ai/useAiSessionsController.js'));
  return files.map(file => fs.readFileSync(file, 'utf8')).join('\n');
}

function storeProcessSource() {
  const files = [path.join(__dirname, '../lib/store.js')];
  const visit = dir => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const target = path.join(dir, entry.name);
      if (entry.isDirectory()) visit(target);
      else if (entry.name.endsWith('.js')) files.push(target);
    }
  };
  visit(path.join(__dirname, '../lib/storage'));
  return files.map(file => fs.readFileSync(file, 'utf8')).join('\n');
}

function appCompositionSource() {
  return [
    appSource(__dirname),
    '../src/app/actions/useAppActionRegistry.js',
    '../src/app/actions/buildDynamicActions.js',
  ].map(file => file.startsWith?.('../') ? fs.readFileSync(path.join(__dirname, file), 'utf8') : file).join('\n');
}

test('AI menu buttons open option menus instead of running Improve directly', () => {
  const outliner = outlinerSource(__dirname);
  const keyboard = fs.readFileSync(path.join(__dirname, '../src/features/editor/outliner/useOutlinerKeyboardShortcuts.js'), 'utf8');

  assert.match(outliner, /if \(scope === 'section-menu'\)[\s\S]*setAiMenu\(\{ scope: 'section'/);
  assert.match(outliner, /onOpenAiMenu && onOpenAiMenu\(e\)/);
  assert.match(outliner, /if \(e\.key === 'ArrowDown'\)[\s\S]*setActiveIdx/);
  assert.match(outliner, /document\.addEventListener\('mousedown', onDown\)/);
  assert.match(keyboard, /window\.addEventListener\('keydown', onKey, true\)/);
  assert.match(keyboard, /undoActionRef\.current\?\.\(\)/);
  assert.match(outliner, /if \(!undoStack\.current\.length\) return false/);
  assert.match(outliner, /if \(!redoStack\.current\.length\) return false/);
  assert.match(keyboard, /stopImmediatePropagation/);
  assert.match(outliner, /const \[aiPrompt, setAiPrompt\]/);
  assert.match(outliner, /title: scope === 'page' \? 'Write on this page'/);
  assert.doesNotMatch(outliner, /window\.prompt/);
  assert.match(outliner, /onClick=\{\(e\) => \{[\s\S]*pickAction\(a\.id\);/);
  assert.doesNotMatch(outliner, /onPick\('improve'\)/);
});

test('Advertised keyboard shortcuts are wired to handlers', () => {
  const app = appSource(__dirname);
  const appRuntime = fs.readFileSync(path.join(__dirname, '../src/app/appRuntime.js'), 'utf8');
  const outliner = outlinerSource(__dirname);
  const keyboard = fs.readFileSync(path.join(__dirname, '../src/features/editor/outliner/useOutlinerKeyboardShortcuts.js'), 'utf8');
  const settings = settingsSource();

  assert.match(app, /const isBackslashKey = key === '\\\\' \|\| key === '\|'/);
  assert.match(app, /e\.code === 'Backslash'/);
  assert.match(keyboard, /const isBlockZoom = isMod && key === 'Enter'/);
  assert.match(keyboard, /const isBlockMoveUp = event\.altKey && !isMod && key === 'ArrowUp'/);
  assert.match(keyboard, /const isBlockMoveDown = event\.altKey && !isMod && key === 'ArrowDown'/);
  assert.match(keyboard, /const isBlockDuplicate = isMod && lowerKey === 'd'/);
  assert.match(keyboard, /const isBlockDelete = isMod && \(key === 'Backspace' \|\| key === 'Delete'\) && !isFormField/);
  assert.match(keyboard, /moveBlockRef\.current\?\.\(activeBlockId\(\), activeBlockId\(\), 'up'\)/);
  assert.match(keyboard, /duplicateBlockRef\.current\?\.\(activeBlockId\(\)\)/);
  assert.match(keyboard, /deleteBlockRef\.current\?\.\(activeBlockId\(\)\)/);
  assert.match(keyboard, /zoomBlockRef\.current\?\.\(activeBlockId\(\)\)/);
  assert.match(outliner, /if \(srcId === destId && position !== 'up' && position !== 'down'\) return/);
  assert.match(settings, /⌘ K/);
  assert.match(settings, /⌘ Z/);
  assert.match(settings, /⌥ ↑ \/ ⌥ ↓/);
});

test('Note tag picker can create new tags from the editor', () => {
  const editor = fs.readFileSync(path.join(__dirname, '../src/editor/editor.jsx'), 'utf8');
  const app = appSource(__dirname);
  const mutations = fs.readFileSync(path.join(__dirname, '../src/app/appMutations.js'), 'utf8');
  const sidebar = fs.readFileSync(path.join(__dirname, '../src/panels/sidebar.jsx'), 'utf8');

  assert.match(editor, /onCreateTag/);
  assert.match(editor, /placeholder="new tag"/);
  assert.match(editor, /createAndApplyTag\(\)/);
  assert.match(app, /normalizeTagName/);
  assert.match(app, /onCreateTag=\{\(raw\) =>/);
  assert.match(sidebar, /creatingTag/);
  assert.match(sidebar, /submitTag/);
  assert.match(sidebar, /onNewTag && onNewTag\(name\)/);
  assert.match(sidebar, /onDeleteTag/);
  assert.match(sidebar, /openTagMenu\(e, tag\.name\)/);
  assert.match(sidebar, /title="Remove tag"/);
  assert.match(sidebar, /Remove tag/);
  assert.match(sidebar, /if \(newTagName\.trim\(\)\) return/);
  assert.match(sidebar, /tagCreatorRef\.current\?\.contains\(e\.target\)/);
  assert.match(sidebar, /top: 50/);
  assert.match(app, /const removeTag = \(name\) =>/);
  assert.match(app, /onDeleteTag=\{removeTag\}/);
  assert.match(app, /MN_APP_MUTATIONS\.removeTagFromNotes\(notes, clean\)/);
  assert.match(mutations, /function removeTagFromNotes/);
  assert.match(mutations, /tags: \(note\.tags \|\| \[\]\)\.filter\(value => value !== tag\)/);
});

test('Note metadata edits participate in undo and redo', () => {
  const app = appSource(__dirname);
  const editor = fs.readFileSync(path.join(__dirname, '../src/editor/editor.jsx'), 'utf8');

  assert.match(app, /noteMetadataHistoryRef/);
  assert.match(app, /recordNoteMetadataHistory\(n, options\.historyKey\)/);
  assert.match(app, /restoreNoteMetadataSnapshot\('undo', noteId\)/);
  assert.match(app, /restoreNoteMetadataSnapshot\('redo', noteId\)/);
  assert.match(app, /if \(note\.id !== snapshot\.id\) return note/);
  assert.match(app, /title: snapshot\.title/);
  assert.match(app, /historyKey: `note:\$\{selectedNote\.id\}:title`/);
  assert.match(app, /historyKey: `note:\$\{selectedNote\.id\}:tag:\$\{t\}:remove`/);
  assert.match(editor, /className="mn-note-title-input"/);
  assert.match(editor, /onUndoNoteEdit/);
  assert.match(editor, /onRedoNoteEdit/);
  assert.match(editor, /onEndNoteMetadataEdit/);
});

test('Vaults can be created and deleted from settings with backend cleanup', () => {
  const app = appSource(__dirname);
  const preferenceModels = fs.readFileSync(path.join(__dirname, '../src/features/preferences/models.js'), 'utf8');
  const settings = settingsSource();
  const store = storeProcessSource();
  const seed = fs.readFileSync(path.join(__dirname, '../lib/seed.js'), 'utf8');
  const main = mainProcessSource();
  const preload = fs.readFileSync(path.join(__dirname, '../preload.js'), 'utf8');

  assert.match(store, /async function deleteVault\(id\)/);
  assert.match(store, /const APP_DIR_NAME = 'VispNote'/);
  assert.match(store, /const LEGACY_APP_DIR_NAMES = \['OminiNote', 'MyNote'\]/);
  assert.match(store, /const OVERRIDE_ROOT = process\.env\.VISPNOTE_HOME/);
  assert.match(store, /const ROOT = OVERRIDE_ROOT \|\| \(!fs\.existsSync\(PRIMARY_ROOT\) && LEGACY_ROOT \? LEGACY_ROOT : PRIMARY_ROOT\)/);
  assert.match(store, /async function repairConfigVaults\(cfg\)/);
  assert.match(store, /async function vaultDirectoryExists\(slug\)/);
  assert.match(store, /cfg\.vaults = validVaults/);
  assert.match(store, /Create another vault before deleting this one/);
  assert.match(store, /moveVaultToTrash\(removed\.slug\)/);
  assert.match(store, /deleteVault, setActiveVault/);
  assert.match(main, /ipcMain\.handle\('mn:deleteVault'/);
  assert.match(main, /idx\.removeVault\(vaultId\)/);
  assert.match(preload, /deleteVault: \(vaultId\) => ipcRenderer\.invoke\(NOTES_VAULTS_CHANNELS\.vaultDelete, \{ vaultId \}\)/);
  assert.match(app, /const deleteVault = useCallbackA\(async \(id\) =>/);
  assert.match(app, /const refreshVaultRegistry = useCallbackA/);
  assert.match(app, /refreshVaultRegistry\(\{ reloadActive: true, reason: 'focus' \}\)/);
  assert.match(app, /onRefreshVaults=\{refreshVaultRegistry\}/);
  assert.match(app, /onCreateVault=\{createVault\}/);
  assert.match(preferenceModels, /function normalizeOnboardingMode/);
  assert.match(app, /onboardingMode: onboardingMode \|\| null/);
  assert.match(settings, /const \[newVaultMode, setNewVaultMode\] = useStateS\('general'\)/);
  assert.match(settings, /onboardingMode: newVaultMode/);
  assert.match(settings, /writerEnabled && <Segmented/);
  assert.match(settings, /value: 'general', label: 'Personal'/);
  assert.match(settings, /value: 'writer', label: 'Writer'/);
  assert.match(store, /explicitOnboardingMode/);
  assert.match(store, /buildOnboardingModeSeed/);
  assert.match(seed, /const ONBOARDING_MODES = \[/);
  assert.match(seed, /function buildOnboardingModeSeed/);
  assert.match(app, /onDeleteVault=\{deleteVault\}/);
  assert.match(settings, /label="Create vault"/);
  assert.match(settings, /label="Delete current vault"/);
  assert.match(settings, /role="dialog"/);
  assert.match(settings, /aria-labelledby="mn-delete-vault-title"/);
  assert.match(settings, /Type vault name to confirm/);
  assert.match(settings, /Delete permanently/);
  assert.match(settings, /This permanently removes the current vault folder/);
});

test('Reminder center and spellcheck wiring are visible in app shell', () => {
  const app = appSource(__dirname);
  const appShell = appShellSource();
  const editor = fs.readFileSync(path.join(__dirname, '../src/editor/editor.jsx'), 'utf8');
  const outliner = outlinerSource(__dirname);
  const utilityPanels = [
    '../src/features/today/components/TodayPanel.jsx',
    '../src/features/trash/components/RecentlyDeletedPanel.jsx',
    '../src/features/capture/components/QuickCapture.jsx',
    '../src/features/reminders/components/ReminderToast.jsx',
  ].map(file => fs.readFileSync(path.join(__dirname, file), 'utf8')).join('\n');

  assert.match(appShell, /function MnReminderCenter/);
  assert.match(appShell, /className="mn-reminder-center"/);
  assert.match(app, /mnCollectReminderItems\(notesWithBody\)/);
  assert.match(app, /reminderDueCount/);
  assert.match(appShell, /Reminder notifications/);
  assert.match(appShell, /boxShadow: open \? `0 8px 20px/);
  assert.match(appShell, /: 'none'/);
  assert.match(app, /setReminderCenterOpen\(false\)/);
  assert.match(appShell, /const visibleItems = items/);
  assert.doesNotMatch(appShell, /items\.slice\(0, 12\)/);
  assert.match(editor, /padding: '12px clamp\(18px, 4vw, 76px\) 10px clamp\(18px, 3vw, 28px\)'/);
  assert.match(editor, /borderBottom: `1px solid \$\{T\.lineSub\}`/);

  assert.match(editor, /spellCheck=\{spellCheck\}/);
  assert.match(outliner, /spellCheck=\{block\.kind === 'code' \? false : spellCheck\}/);
  assert.match(outliner, /spellCheck=\{false\}/);
  assert.match(utilityPanels, /<button onClick=\{onDismiss\}[\s\S]*>✕<\/button>/);
  assert.match(utilityPanels, /<button onClick=\{onSnooze \|\| onDismiss\}[\s\S]*>Snooze<\/button>/);
});

test('Ask AI can continue in background and reopen completed responses', () => {
  const app = appCompositionSource();
  const sessionsController = fs.readFileSync(path.join(__dirname, '../src/features/ai/useAiSessionsController.js'), 'utf8');
  const appRuntime = fs.readFileSync(path.join(__dirname, '../src/app/appRuntime.js'), 'utf8');
  const appShell = appShellSource();
  const ai = rendererAiSource();
  const aiRuntime = fs.readFileSync(path.join(__dirname, '../src/ai/aiRuntime.js'), 'utf8');
  const aiUi = fs.readFileSync(path.join(__dirname, '../src/ai/aiUi.jsx'), 'utf8');
  const aiReporting = fs.readFileSync(path.join(__dirname, '../src/features/ai/reporting/aiReporting.js'), 'utf8');
  const main = mainProcessSource();
  const preload = fs.readFileSync(path.join(__dirname, '../preload.js'), 'utf8');
  const aiLib = backendAiSource(__dirname);
  const aiToolSchemas = fs.readFileSync(path.join(__dirname, '../lib/integrations/ai/toolSchemas.js'), 'utf8');
  const aiIntegrationSource = `${aiLib}\n${aiToolSchemas}`;
  const aiRegression = fs.readFileSync(path.join(__dirname, '../scripts/ai-regression-electron.js'), 'utf8');
  const ollama = fs.readFileSync(path.join(__dirname, '../lib/ollama.js'), 'utf8');
  const settings = settingsSource();

  assert.match(sessionsController, /const \[sessions, setSessions\]/);
  assert.match(sessionsController, /const \[activeSessionId, setActiveSessionId\]/);
  assert.match(appRuntime, /function mnPickActiveAskAiSession/);
  assert.match(sessionsController, /pickActiveSession\(sessions, activeSessionId\)/);
  assert.match(appRuntime, /allowArchivedPreferred !== false/);
  assert.match(sessionsController, /allowArchivedPreferred: false/);
  assert.match(app, /view === 'ai'/);
  assert.match(app, /<MnAiChatHistory/);
  assert.match(app, /archiveAskAiChat/);
  assert.match(sessionsController, /if \(!next\.length\) \{/);
  assert.match(sessionsController, /setSessions\(\[\]\)/);
  assert.match(app, /No AI chats/);
  assert.doesNotMatch(app, /!next\.some\(session => !session\.archived\)/);
  const deleteChatMatch = sessionsController.match(/const deleteChat = useCallback\([\s\S]*?\n  \}, \[activeSessionId, pickActiveSession, sessions\]\);/);
  assert.ok(deleteChatMatch);
  assert.doesNotMatch(deleteChatMatch[0], /newAiSession/);
  assert.match(appShell, /function MnAiNotice/);
  assert.match(appShell, /AI response ready/);
  assert.match(app, /onOpen=\{openAskAi\}/);
  assert.match(app, /session=\{activeAskAiSession\}/);
  assert.match(app, /setSession=\{setActiveAskAiSession\}/);
  assert.match(app, /onBackgroundComplete=\{notifyAskAiComplete\}/);
  assert.match(app, /onCreateNote=\{\(\{ title, body, tags: noteTags \}\) => createNote\(\{ title, body, tags: noteTags \|\| \[\] \}, \{ open: false \}\)\}/);
  assert.match(app, /onTagCurrentNote=\{tagCurrentNoteFromAi\}/);
  assert.match(app, /id: 'search-notes'/);
  assert.match(app, /id: 'append-to-note'/);
  assert.match(app, /id: 'add-todo-to-note'/);
  assert.match(app, /id: 'add-reminder-to-note'/);
  assert.match(app, /id: 'link-note'/);
  assert.match(app, /desktopBridge\.search\?\.searchDetailedStatus/);

  assert.match(ai, /const aiSession = session \|\| localSession/);
  assert.match(ai, /aiActions\.classifyPrompt/);
  assert.match(ai, /function mnBuildAskThreadMessages\(priorMessages = \[\], currentQuery = '', options = \{\}\)/);
  assert.match(ai, /function mnBuildAskThreadPrompt\(priorMessages = \[\], currentQuery = ''\)/);
  assert.match(ai, /function mnRecentAskThreadNote\(priorMessages = \[\]\)/);
  assert.match(ai, /function mnBuildContextualActionQuery\(priorMessages = \[\], currentQuery = ''\)/);
  assert.match(ai, /const MN_AI_VIRTUAL_TOOLS = \[/);
  assert.match(ai, /name: 'answer-notes'/);
  assert.match(ai, /latest note, recent note, task, tag, decision/);
  assert.match(ai, /name: 'summarize-vault'/);
  assert.match(ai, /Use only when the user explicitly asks to summarize, recap, or overview all notes/);
  assert.match(ai, /name: 'edit-current-page'/);
  assert.match(ai, /const MN_AI_VIRTUAL_WRITE_TOOLS = new Set/);
  assert.match(ai, /risk: 'confirm'/);
  assert.match(ai, /function mnAiCurrentContextMessage\(currentNote\)/);
  assert.match(ai, /function mnAiShouldShareCurrentContext\(query = ''\)/);
  assert.doesNotMatch(ai, /Current page body excerpt/);
  assert.match(ai, /makeVirtualWriteReview/);
  assert.match(ai, /runConfirmedVirtualWriteTool/);
  assert.match(ai, /function mnAiMarkdownMarkers/);
  assert.match(ai, /function mnAiMissingMarkdownMarkers/);
  assert.match(ai, /function mnAiBuildMarkdownPreview/);
  assert.match(ai, /Drafting page preview/);
  assert.match(ai, /reviewedBody/);
  assert.match(ai, /previousBody/);
  assert.match(ai, /markdownPreview/);
  assert.match(ai, /Exact Markdown preview/);
  assert.match(ai, /Markdown preservation check/);
  assert.match(ai, /data-mn-ai-edit-preview=\{key\}/);
  assert.match(ai, /Applying reviewed page edit/);
  assert.match(ai, /source: 'ai'/);
  assert.match(ai, /Undo AI edit/);
  assert.match(ai, /Version history/);
  assert.match(ai, /onRestoreCurrentPageBody/);
  assert.match(ai, /onOpenCurrentNoteVersions/);
  assert.match(ai, /if \(!String\(inputArgs\.instruction \|\| ''\)\.trim\(\) && q\) inputArgs\.instruction = q;/);
  assert.match(ai, /Structured VispNote API context/);
  assert.match(ai, /Plugin APIs are exposed as plugin-\* tools/);
  assert.match(ai, /Use summarize-vault only for explicit whole-vault summaries/);
  assert.match(ai, /const pluginTools = registryTools\.filter/);
  assert.doesNotMatch(ai, /planner\.fallback_to_notes/);
  assert.match(ai, /const runLlmOrchestrator = async/);
  assert.match(ai, /await runLlmOrchestrator\(\{ q, actionQuery, priorMessages, jobId, run \}\)/);
  assert.match(ai, /const skipLlmFirst = !platformApi\.ai\?\.toolPlan \|\|[\s\S]*route\.type === 'clarify'/);
  assert.match(ai, /const scrollVersion = messages\.map/);
  assert.match(ai, /onScroll=\{rememberScrollPosition\}/);
  assert.match(ai, /data-mn-chat-bottom="true"/);
  assert.match(ai, /const runActionPlan = async/);
  assert.match(ai, /traceLabels/);
  assert.match(ai, /aiRuntime\.traceLabel/);
  assert.match(ai, /tool\.run/);
  assert.match(ai, /tool\.done/);
  assert.match(ai, /const isPureInspectionRequest = \(text\) =>/);
  assert.match(ai, /if \(onlyInspectionSteps && isPureInspectionRequest\(q\)\) return plan/);
  assert.match(ai, /planAppActionsWithModel\(actionQuery, route\.plan, jobId, run, priorMessages\)/);
  assert.match(ai, /const actionQuery = mnBuildContextualActionQuery\(priorMessages, q\)/);
  assert.match(ai, /query: actionQuery, aiActions, appRegistry: getAppActionRegistry\(\)/);
  assert.match(ai, /const toolMessages = mnBuildAskThreadMessages\(priorMessages, q, \{ limit: 8 \}\)/);
  assert.match(ai, /const qForAsk = mnBuildAskThreadPrompt\(priorMessages, q\)/);
  assert.match(ai, /const chatMessages = mnBuildAskThreadMessages\(priorMessages, q, \{ limit: 8 \}\)/);
  assert.match(ai, /platformApi\.ai\.ask\(vaultId, prompt/);
  assert.match(ai, /currentNoteId: currentNote\?\.id \|\| null/);
  assert.match(main, /function sanitizeOptionalIpcId\(value, field\)[\s\S]*IPC_ID_RE\.test\(clean\)/);
  assert.match(main, /currentNoteId: sanitizeOptionalIpcId\(options\.currentNoteId, 'currentNoteId'\)/);
  assert.match(main, /function relatedNotesFromIpc\(vaultId, noteId, options\)/);
  assert.match(main, /reason: 'Vault not available'/);
  assert.match(main, /ipcMain\.handle\('mn:ai\.related',\s+wrap\(relatedNotesFromIpc\)\)/);
  assert.match(main, /smoke\|regression\|ai-regression/);
  assert.match(ai, /bodyFrom === 'previous-answer'/);
  assert.match(ai, /tag-created-note/);
  assert.match(ai, /if \(stoppedJobRef\.current === jobId\) return/);
  assert.match(aiUi, /function MnAiChatHistory/);
  assert.match(aiUi, /provider !== 'ollama'/);
  assert.match(aiUi, /AI chats/);
  assert.match(aiUi, /Show archived chats/);
  assert.match(aiUi, /Archived <span/);
  assert.match(aiUi, /Archive chat/);
  assert.match(aiUi, /Restore chat/);
  assert.match(aiUi, /function mnAiRowActionButton/);
  assert.match(ai, /embedded = false/);
  assert.match(ai, /const MN_ASK_SUGGESTIONS = \[/);
  assert.match(ai, /function mnAskStatusText/);
  assert.match(ai, /function mnAiProviderLabel/);
  assert.match(ai, /function mnAskFooterHint/);
  assert.match(ai, /provider !== 'ollama'/);
  assert.match(ai, /openrouter: 'OpenRouter'/);
  assert.match(ai, /\$\{providerLabel\} ready/);
  assert.match(ai, /Enter to ask · Shift\+Enter for newline/);
  assert.doesNotMatch(ai, /route\.type === 'notes' \|\|/);
  assert.doesNotMatch(ai, /route\.type === 'chat' \|\|/);
  assert.match(ai, /route\.plan\?\.intent === 'zotero-document-search'/);
  assert.match(ai, /const \[openSources, setOpenSources\]/);
  assert.match(ai, /const \[noteSuggestions, setNoteSuggestions\]/);
  assert.match(ai, /const \[noteSuggestionsBusy, setNoteSuggestionsBusy\]/);
  assert.match(ai, /const \[noteSuggestionsError, setNoteSuggestionsError\]/);
  assert.match(ai, /requestCurrentNoteSuggestions/);
  assert.match(ai, /buildCurrentNoteSuggestionPrompt/);
  assert.match(ai, /makeCurrentNoteSuggestionResult/);
  assert.match(ai, /Current note suggestions/);
  assert.match(ai, /providerModelLabel/);
  assert.match(ai, /Hosted provider/);
  assert.match(ai, /Evidence/);
  assert.match(ai, /Reject\s*<\/button>/);
  assert.match(ai, /Suggest for note/);
  assert.match(ai, /setNoteSuggestions\(null\)/);
  assert.match(aiRuntime, /function buildCurrentNoteSuggestionPrompt/);
  assert.match(aiRuntime, /function makeCurrentNoteSuggestionResult/);
  assert.match(aiRuntime, /Summary, Tasks, Tags, Links, Gaps or contradictions/);
  assert.match(ai, /name: 'edit-supporting-notes'/);
  assert.match(ai, /action\.type === 'edit-supporting-notes'/);
  assert.match(app, /id: 'rename-note'[\s\S]*risk: 'confirm'/);
  assert.match(ai, /onApplyNoteBodies/);
  assert.match(ai, /const noteIdSet = new Set/);
  assert.match(ai, /if \(opened !== false && !embedded\) onClose && onClose\(\);/);
  assert.match(app, /const openNoteById = useCallbackA/);
  assert.match(app, /setSelectedTag\(null\);\s*\n\s*setSelectedWorkflow\(null\);\s*\n\s*setQuery\(''\);/);
  assert.match(app, /onOpenNote=\{openNoteById\}/);
  assert.match(app, /aiNoteBodyRestoreRef/);
  assert.match(app, /const applyAiCurrentPageBody = useCallbackA/);
  assert.match(app, /const restoreAiCurrentPageBody = useCallbackA/);
  assert.match(app, /onApplyCurrentPageBody=\{\(body, options\) =>/);
  assert.match(app, /return applyAiCurrentPageBody\(selectedNote\.id, body, options\)/);
  assert.match(app, /onRestoreCurrentPageBody=\{restoreAiCurrentPageBody\}/);
  assert.match(app, /onOpenCurrentNoteVersions=\{\(noteId\) => setVersionTargetId/);
  assert.match(app, /onApplyNoteBodies=\{updateNoteBodies\}/);
  assert.match(aiRegression, /installAiFixture/);
  assert.match(aiRegression, /QE_FORMATTED current page/);
  assert.match(aiRegression, /QE_SUPPORT_UPDATED supporting novel note/);
  assert.match(aiRegression, /Fixture source answer from QE Source Target/);
  assert.match(aiRegression, /AI renderer regression workflows passed/);
  assert.match(ai, /const onComposerKeyDown = \(e\) =>/);
  assert.match(ai, /rows=\{1\}/);
  assert.match(ai, /aria-expanded=\{sourcesOpen\}/);
  assert.match(ai, /Sources \(\{m\.sources\.length\}\)/);
  assert.match(ai, /function mnParseAiResponseBlocks\(text\)/);
  assert.match(ai, /function mnAiLooksLikeSectionLabel\(text\)/);
  assert.match(ai, /promoted: true/);
  assert.match(ai, /function mnAiWikiLinkParts\(label\)/);
  assert.match(ai, /function mnNormalizeAiResponseBlocks\(blocks = \[\]\)/);
  assert.match(ai, /mnAiIsGenericSummaryHeading/);
  assert.match(ai, /token\.startsWith\('\[\['\)/);
  assert.match(ai, /onOpenWikiLink\(link\.title\)/);
  assert.match(ai, /function MnAiFormattedResponse\(\{ text, T, allNotes = \[\], onOpenNote, onClose, embedded = false \}\)/);
  assert.match(ai, /gridTemplateColumns: block\.type === 'ol'/);
  assert.match(ai, /<MnAiFormattedResponse[\s\S]*text=\{m\.text\}[\s\S]*allNotes=\{allNotes\}[\s\S]*onOpenNote=\{onOpenNote\}/);
  assert.match(ai, /mnAskPrimaryButton/);
  assert.match(ai, /mnAskSecondaryButton/);
  assert.match(ai, /Clear/);
  assert.match(aiUi, /onContextMenu=\{\(e\) => openContextMenu\(e, session\)\}/);
  assert.match(aiUi, /function MnAiContextMenuItem/);
  assert.match(aiUi, /Delete chat/);
  assert.match(aiUi, /Use the row buttons or right-click for chat actions/);
  assert.match(aiUi, /onRename\(renameId, renameValue\.trim\(\) \|\| 'New chat'\)/);
  assert.match(ai, /MN_AI_REPORT/);
  assert.match(ai, /Report AI output/);
  assert.match(aiReporting, /function providerReportInfo/);
  assert.match(aiReporting, /navigator\.clipboard\?\.writeText\(report\)/);
  assert.match(aiReporting, /platformApi\.app\.openExternal\(info\.url\)/);
  assert.match(ai, /Semantic search ready/);
  assert.match(ai, /Ask about the vault or ask for a page action/);
  assert.match(ai, /backgroundRef\.current = true/);
  assert.match(ai, /Run in background/);
  assert.match(ai, /Stop/);
  assert.match(ai, /const stopRun = async/);
  assert.match(ai, /platformApi\.ai\?\.cancel\?\.\(jobId\)/);
  assert.match(ai, /Stopped\./);
  assert.match(ai, /onBackgroundComplete && onBackgroundComplete/);
  assert.match(ai, /completedAt: new Date\(\)\.toISOString\(\)/);

  assert.match(preload, /cancel:\s+\(jobId\) => ipcRenderer\.invoke\('mn:ai\.cancel', jobId\)/);
  assert.match(preload, /openExternal: \(url\) => ipcRenderer\.invoke\('mn:openExternal', url\)/);
  assert.match(main, /ipcMain\.handle\('mn:ai\.cancel'/);
  assert.match(main, /ipcMain\.handle\('mn:openExternal'/);
  assert.match(aiLib, /const STATUS_CACHE_MS/);
  assert.match(aiLib, /const OLLAMA_KEEP_ALIVE = '10m'/);
  assert.match(aiLib, /const PROVIDERS = \{/);
  assert.match(aiIntegrationSource, /Choose from the provided VispNote APIs/);
  assert.match(aiIntegrationSource, /format intentionally: use markdown headings for section titles, bullets only for real list items/i);
  assert.match(aiIntegrationSource, /Emoji are allowed when they naturally improve tone or scanability/);
  assert.match(aiIntegrationSource, /call answer-notes with the user query/);
  assert.match(aiIntegrationSource, /call summarize-vault instead of answer-notes/);
  assert.match(aiIntegrationSource, /Plugin APIs appear as plugin-\* tools/);
  assert.match(aiIntegrationSource, /Structured tool-planning input/);
  assert.match(aiLib, /mode: 'planner_failed'/);
  assert.match(aiLib, /error: 'Planner did not return valid JSON.'/);
  assert.match(aiLib, /openrouterApiKey/);
  assert.match(aiLib, /openaiApiKey/);
  assert.match(aiLib, /anthropicApiKey/);
  assert.match(aiLib, /geminiApiKey/);
  assert.match(aiLib, /async function providerChat/);
  assert.match(aiLib, /https:\/\/openrouter\.ai\/api\/v1/);
  assert.match(aiLib, /https:\/\/api\.openai\.com\/v1/);
  assert.match(aiLib, /https:\/\/api\.anthropic\.com/);
  assert.match(aiLib, /https:\/\/generativelanguage\.googleapis\.com\/v1beta/);
  assert.match(aiLib, /anthropic-version/);
  assert.match(aiLib, /generateContent/);
  assert.match(aiLib, /const cancellableJobs = new Map\(\)/);
  assert.match(aiLib, /function cancelJob\(jobId\)/);
  assert.match(aiLib, /controller\.abort\(\)/);
  assert.match(aiLib, /cancelJob,/);
  assert.match(aiLib, /statusCache/);
  assert.match(aiLib, /ollama\.chat\(options\.model \|\| CONFIG\.chatModel, providerMessages, \{/);
  assert.match(aiLib, /timeoutMs: options\.timeoutMs/);
  assert.match(aiLib, /function isEmbeddingUnsupportedError/);
  assert.match(aiLib, /function markEmbedModelFailure/);
  assert.match(aiLib, /EMBED_MODEL_UNSUPPORTED/);
  assert.match(aiLib, /embedModelReason/);
  assert.match(aiLib, /String\(systemMessage \|\| ''\)\.trim\(\) \|\| EDIT_SYSTEM_PROMPT/);
  assert.match(main, /async function prepareAiEditPayload/);
  assert.match(main, /function sanitizeStringList/);
  assert.match(main, /section: capString\(tool\.section/);
  assert.match(main, /requires: sanitizeStringList\(tool\.requires/);
  assert.match(main, /examples: sanitizeStringList\(tool\.examples/);
  assert.doesNotMatch(main, /payload\.systemMessage \? capString\(payload\.systemMessage/);
  assert.doesNotMatch(main, /payload\.model \? capString\(payload\.model/);
  assert.match(ollama, /async function embed\(model, text, opts = \{\}\)/);
  assert.match(ollama, /signal: opts\.signal/);
  assert.match(ollama, /keep_alive: opts\.keep_alive/);

  assert.match(settings, /const MN_AI_PROVIDERS = \[/);
  assert.match(settings, /id: 'openrouter'/);
  assert.match(settings, /id: 'openai'/);
  assert.match(settings, /id: 'anthropic'/);
  assert.match(settings, /id: 'gemini'/);
  assert.match(settings, /id: 'custom'/);
  assert.match(settings, /PII reduction/);
  assert.match(settings, /Provider API base URL/);
  assert.match(settings, /Cloud providers are used for chat, note creation, and editing/);
  assert.match(settings, /const statusButtonLabel = busy[\s\S]*providerReady[\s\S]*'Connected'[\s\S]*'Ready'[\s\S]*'Connect'[\s\S]*'Check'/);
  assert.match(settings, /<BtnOutline T=\{T\} onClick=\{load\} disabled=\{busy\}>\{statusButtonLabel\}<\/BtnOutline>/);
});

test('Canvas workspace is wired through storage, navigation, and note embeds', () => {
  const html = fs.readFileSync(path.join(__dirname, '../vispnote.html'), 'utf8');
  const rendererEntry = fs.readFileSync(projectPaths.src.main, 'utf8');
  const store = storeProcessSource();
  const main = mainProcessSource();
  const preload = fs.readFileSync(path.join(__dirname, '../preload.js'), 'utf8');
  const app = appSource(__dirname);
  const appRuntime = fs.readFileSync(path.join(__dirname, '../src/app/appRuntime.js'), 'utf8');
  const canvasActions = fs.readFileSync(path.join(__dirname, '../src/app/appCanvasActions.js'), 'utf8');
  const canvasController = fs.readFileSync(path.join(__dirname, '../src/features/canvas/useCanvasController.js'), 'utf8');
  const canvasModel = fs.readFileSync(path.join(__dirname, '../src/canvas/canvasModel.js'), 'utf8');
  const sidebar = fs.readFileSync(path.join(__dirname, '../src/panels/sidebar.jsx'), 'utf8');
  const editor = fs.readFileSync(path.join(__dirname, '../src/editor/editor.jsx'), 'utf8');
  const outliner = outlinerSource(__dirname);
  const slashCommands = fs.readFileSync(path.join(__dirname, '../src/features/editor/outliner/slashCommands.js'), 'utf8');
  const canvas = canvasSource();

  assert.match(html, /src="build\/renderer\/app\.js"/);
  assert.match(app, /from '\.\.\/features\/canvas\/index\.js'/);
  assert.match(store, /function canvasDir\(slug\)/);
  assert.match(store, /async function listCanvases\(vaultId\)/);
  assert.match(store, /async function saveCanvas\(vaultId, canvas\)/);
  assert.match(store, /async function deleteCanvas\(vaultId, canvasId\)/);
  assert.match(main, /ipcMain\.handle\('mn:listCanvases'/);
  assert.match(main, /ipcMain\.handle\('mn:getCanvas'/);
  assert.match(preload, /listCanvases: \(vaultId\) => ipcRenderer\.invoke\('mn:listCanvases', vaultId\)/);
  assert.match(preload, /saveCanvas: \(vaultId, canvas\) => ipcRenderer\.invoke\('mn:saveCanvas', vaultId, canvas\)/);
  assert.match(sidebar, /label="Thinking Board"/);
  assert.match(sidebar, /canvasActive/);
  assert.match(app, /const \[canvases, setCanvases\]/);
  assert.match(app, /const \[activeCanvas, setActiveCanvas\]/);
  assert.match(app, /desktopBridge\.canvas\.listCanvases\(vaultId\)/);
  assert.match(appRuntime, /const MN_APP_CANVAS_ACTIONS = require\('\.\/appCanvasActions\.js'\)/);
  assert.match(canvasController, /canvasActions\.openCanvas\(canvasId, actionContext\(\)\)/);
  assert.match(canvasController, /canvasActions\.createCanvas\(title, options, actionContext\(\)\)/);
  assert.match(canvasActions, /async function openCanvas\(canvasId, ctx = \{\}\)/);
  assert.match(canvasActions, /ctx\.mn\.canvas\.getCanvas\(ctx\.activeVaultId, canvasId\)/);
  assert.match(canvasActions, /async function createCanvas/);
  assert.match(canvasActions, /async function saveCanvas/);
  assert.match(canvasActions, /async function deleteCanvas/);
  assert.match(app, /view === 'canvas'/);
  assert.match(app, /<MnCanvasPanel/);
  assert.match(editor, /allCanvases=\{canvases\}/);
  assert.match(slashCommands, /id: 'canvas'/);
  assert.match(outliner, /\{\{canvas/);
  assert.match(outliner, /<MnCanvasPicker/);
  assert.match(outliner, /<MnCanvasEmbed/);
  assert.match(canvasModel, /const MN_CANVAS_TOOLS = \[/);
  assert.doesNotMatch(canvasModel, /window\.MN_CANVAS_MODEL/);
  assert.match(canvas, /function MnCanvasPanel/);
  assert.match(canvas, /function MnCanvasCardMenu/);
  assert.match(canvas, /onContextMenu=\{\(e\) => openCanvasCardMenu\(e, canvas\)\}/);
  assert.match(canvas, /Delete canvas/);
  assert.match(canvas, /function MnCanvasEditor/);
  assert.match(canvas, /function MnCanvasEmbed/);
});

test('Novelist mode is a vault type with settings, templates, workflow, and dashboard wiring', () => {
  const store = storeProcessSource();
  const main = mainProcessSource();
  const preload = fs.readFileSync(path.join(__dirname, '../preload.js'), 'utf8');
  const app = appSource(__dirname);
  const appRuntime = fs.readFileSync(path.join(__dirname, '../src/app/appRuntime.js'), 'utf8');
  const helpers = appHelpersSource(__dirname);
  const appNovelistSource = fs.readFileSync(path.join(__dirname, '../src/app/appNovelist.js'), 'utf8');
  const panelHelpersSource = fs.readFileSync(path.join(__dirname, '../src/panels/panelHelpers.js'), 'utf8');
  const sidebar = fs.readFileSync(path.join(__dirname, '../src/panels/sidebar.jsx'), 'utf8');
  const settings = settingsSource();
  const panels = specialistPanelsSource();
  const editor = fs.readFileSync(path.join(__dirname, '../src/editor/editor.jsx'), 'utf8');
  const outliner = outlinerSource(__dirname);
  const graph = fs.readFileSync(path.join(__dirname, '../src/panels/graph.jsx'), 'utf8');
  const notelist = fs.readFileSync(path.join(__dirname, '../src/panels/notelist.jsx'), 'utf8');
  const ai = rendererAiSource();

  assert.match(store, /novelistMode: !!meta\.novelistMode/);
  assert.match(store, /workflowStates: Array\.isArray\(meta\.workflowStates\) \? normalizeWorkflowStates\(meta\.workflowStates\) : null/);
  assert.match(store, /async function createVault\(name, options = \{\}\)/);
  assert.match(store, /fs\.existsSync\(vaultDir\(finalSlug\)\)/);
  assert.match(main, /store\.createVault\(name, options\)/);
  assert.match(preload, /createVault: \(name, options\) => ipcRenderer\.invoke\(NOTES_VAULTS_CHANNELS\.vaultCreate, \{ name, options \}\)/);
  assert.match(appNovelistSource, /const MN_NOVELIST_TAGS = \[/);
  assert.match(appNovelistSource, /novel-act/);
  assert.match(appNovelistSource, /\[\[Act 1\]\]/);
  assert.match(appNovelistSource, /\[\[Chapter 1\]\]/);
  assert.match(appNovelistSource, /\[\[Scene 1\]\]/);
  assert.match(appNovelistSource, /const MN_NOVELIST_WORKFLOW_STATES = \[/);
  assert.match(app, /sourceWorkflowStates = null/);
  assert.match(app, /includeStarterNotes: false/);
  assert.match(app, /workflowStates: nextWorkflowStates/);
  assert.match(app, /mnBuildNovelistStarterNotes\(normalizedSourceNotes, mnMdToBlocks, vaultId\)/);
  assert.match(appNovelistSource, /function mnDirtyNoteKey\(vaultId, noteId\)/);
  assert.match(app, /const vaultActivationSeq = useRefA\(0\)/);
  assert.match(app, /const activationSeq = \+\+vaultActivationSeq\.current/);
  assert.match(app, /if \(activationSeq !== vaultActivationSeq\.current\) return/);
  assert.match(app, /const dirtyRevisionRef = useRefA\(0\)/);
  assert.match(app, /const noteDiskStampRef = useRefA\(new Map\(\)\)/);
  assert.match(app, /noteDiskStampRef\.current\.get\(dirtyKey\) \|\| saveOptions\.expectedModifiedAt/);
  assert.match(app, /noteDiskStampRef\.current\.set\(dirtyKey, diskModifiedAt\)/);
  assert.match(app, /revision: \+\+dirtyRevisionRef\.current/);
  assert.match(app, /current\.revision !== revision/);
  assert.match(app, /desktopBridge\.events\.onFlushDirtyNotes/);
  assert.match(app, /entry\.vaultId === activeVaultId/);
  assert.match(app, /notes: targetNotes, tags: targetTags/);
  assert.match(app, /saveVaultMeta\(activeVaultId, \{ novelistMode: false, workflowStates: null \}\)/);
  assert.match(app, /novelistMode: false, workflowStates: null/);
  assert.match(app, /workflowStates: vaultType === 'novelist' \? MN_NOVELIST_WORKFLOW_STATES : null/);
  assert.match(app, /const normalWorkflowStates = useMemoA/);
  assert.match(app, /const novelistWorkflowStates = useMemoA/);
  assert.match(app, /activeVault\?\.novelistMode \? novelistWorkflowStates : normalWorkflowStates/);
  assert.match(app, /saveVaultMeta\(activeVaultId, \{ workflowStates: next \}\)/);
  assert.doesNotMatch(app, /setTweak\('workflowStates', MN_NOVELIST_WORKFLOW_STATES\)/);
  assert.match(appNovelistSource, /function mnBuildNovelistStarterNotes/);
  assert.match(appNovelistSource, /function mnBuildNovelistStructure/);
  assert.match(appNovelistSource, /function mnNovelOutlineLinks/);
  assert.match(appNovelistSource, /function mnBodyPropertyValue/);
  assert.match(appNovelistSource, /function mnSetBodyProperty/);
  assert.match(appNovelistSource, /function mnRemoveBodyProperty/);
  assert.match(appNovelistSource, /function mnNoteOrderValue/);
  assert.match(appRuntime, /function collectWorkflowNotes/);
  assert.match(appRuntime, /buildNovelImportPlan/);
  assert.match(helpers, /split\('\|'\)\[0\]/);
  assert.match(helpers, /function bodyPropertyTitle/);
  assert.match(helpers, /addStage\('chapter', chapter\)/);
  assert.match(helpers, /addStage\('scene', scene\)/);
  assert.match(helpers, /function buildNovelImportPlan/);
  assert.match(helpers, /function mergeNovelImportBody/);
  assert.match(app, /mnNormalizeNovelistLegacyTags/);
  assert.match(app, /mnNormalizeNovelistLegacyBody/);
  assert.match(app, /mnEnsureScenePlotPoints/);
  assert.match(app, /selectedStage === 'act'/);
  assert.match(app, /selectedStage === 'chapter'/);
  assert.match(app, /stageByNoteId/);
  assert.match(app, /mnNovelEnsureWikiLink/);
  assert.match(app, /mnNovelEnsureWikiLinkInSection/);
  assert.match(app, /mnNovelUpsertPropertyLink/);
  assert.match(app, /const updateWorkflowNoteStatus = useCallbackA/);
  assert.match(app, /mnSetBodyProperty\(body, 'status', workflow\)/);
  assert.match(app, /const setNovelistOrder = useCallbackA/);
  assert.match(app, /const renameNoteTitle = useCallbackA/);
  assert.match(app, /const convertNovelistType = useCallbackA/);
  assert.match(app, /const graphVisibleNotes = useMemoA/);
  assert.match(app, /const setActiveVaultNovelistMode = useCallbackA/);
  assert.match(app, /view === 'novelist'/);
  assert.match(app, /<MnNovelistPanel/);
  assert.match(app, /vaultId=\{activeVaultId\}/);
  assert.match(app, /createNote\(\{ title, body, tags: noteTags \|\| \[\] \}, \{ open: false \}\)/);
  assert.match(app, /onLinkChapter=\{linkNovelistChapter\}/);
  assert.match(app, /onLinkScene=\{linkNovelistScene\}/);
  assert.match(app, /onSetOrder=\{setNovelistOrder\}/);
  assert.match(app, /onRenameNote=\{renameNoteTitle\}/);
  assert.match(app, /onConvertNoteType=\{convertNovelistType\}/);
  assert.match(app, /onDeleteNote=\{requestDeleteNote\}/);
  assert.match(app, /const removeNovelistSupportingType = \(name\) =>/);
  assert.match(app, /setTags\(ts => ts\.filter\(t => t\.name !== clean\)\)/);
  assert.match(app, /onCreateTag=\{addTag\}/);
  assert.match(app, /onRemoveSupportingType=\{removeNovelistSupportingType\}/);
  assert.match(app, /novelistPath=\{activeVault\?\.novelistMode/);
  assert.match(app, /novelistStructure=\{activeVault\?\.novelistMode/);
  assert.match(app, /onSetVaultNovelistMode=\{setActiveVaultNovelistMode\}/);
  assert.match(app, /const importNovelFiles = useCallbackA/);
  assert.match(app, /desktopBridge\.maintenance\?\.importNovelFiles/);
  assert.match(app, /desktopBridge\.ai\.toolPlan/);
  assert.match(app, /<MnNovelImportPreviewDialog/);
  assert.match(app, /onImportNovelFiles=\{importNovelFiles\}/);
  assert.match(sidebar, /label="Novelist"/);
  assert.match(sidebar, /featureState\.showWriter/);
  assert.match(settings, /Vault mode/);
  assert.match(settings, /Import novel files/);
  assert.match(settings, /currentVault\?\.novelistMode/);
  assert.match(settings, /onImportNovelFiles/);
  assert.match(settings, /writerEnabled && <Row/);
  assert.match(preload, /importNovelFiles:\(options\) => ipcRenderer\.invoke\('mn:importNovelFiles', options\)/);
  assert.match(main, /ipcMain\.handle\('mn:importNovelFiles'/);
  assert.match(main, /properties: \['openFile', 'multiSelections'\]/);
  assert.match(main, /NOVEL_IMPORT_FILE_LIMIT = 8/);
  assert.match(panels, /function MnNovelistPanel/);
  assert.match(panels, /activeTab/);
  assert.match(panels, /Plan/);
  assert.match(panels, /Status/);
  assert.match(panels, /AI Config/);
  assert.doesNotMatch(panels, /CreateButtonGroup/);
  assert.match(panels, /Story Structure/);
  assert.match(panels, /Act -> Chapter -> Scene/);
  assert.match(panels, /function MnNovelistPanel[\s\S]*childrenByActId/);
  assert.match(panels, /Word Count by Act/);
  assert.match(panels, /Character Appearance Heat Map/);
  assert.match(panelHelpersSource, /mn_novelist_ai_config_v2/);
  assert.match(panels, /supportingTypes = \(tags \|\| \[\]\)/);
  assert.match(panels, /normalizeSupportingTypeTag/);
  assert.match(panels, /onCreateTag\?\.\(tagName\)/);
  assert.match(panels, /onRemoveSupportingType\?\.\(type\.tag\)/);
  assert.match(panels, /Add type/);
  assert.match(panels, /Remove type/);
  assert.match(panels, /\+ Note/);
  assert.match(panels, /novel-character/);
  assert.match(panels, /novel-research/);
  assert.match(panels, /novel-revision/);
  assert.match(panels, /No chapters linked/);
  assert.match(panels, /No scenes linked/);
  assert.match(panels, /\+ \{type === 'chapter' \? 'Chapter' : 'Scene'\}/);
  assert.match(panels, /Link existing chapter/);
  assert.match(panels, /Link existing scene/);
  assert.match(panels, /Attach to act/);
  assert.match(panels, /Create parent act/);
  assert.match(panels, /Convert to scene/);
  assert.match(panels, /Attach to chapter/);
  assert.match(panels, /Create parent chapter/);
  assert.match(panels, /Set order/);
  assert.match(panels, /const \[editDialog, setEditDialog\] = useStateP\(null\)/);
  assert.match(panels, /Order must be a number or blank/);
  assert.doesNotMatch(panels, /window\.prompt\('Rename note:'/);
  assert.doesNotMatch(panels, /window\.prompt\('Set order:: value:'/);
  assert.match(panels, /showLinkNotice/);
  assert.match(panels, /LinkNoticeChip/);
  assert.match(panels, /linkNotice\.text/);
  assert.match(panels, /linkNotice\.parentId/);
  assert.match(panels, /Linked to \$\{linkedTo\.title/);
  assert.match(panels, /Unlinked chapters/);
  assert.match(panels, /Unlinked scenes/);
  assert.match(panels, /linkNoticeTimer/);
  assert.match(panels, /onContextMenu=\{\(e\) => openNoteMenu\(e, note\)\}/);
  assert.match(panels, /closeOnEscape/);
  assert.match(panels, /Delete note/);
  assert.match(panels, /Choose act for new Chapter/);
  assert.match(panels, /Create standalone/);
  assert.match(panels, /createChapterForAct/);
  assert.match(panels, /createSceneForChapter/);
  assert.match(editor, /novelistPath = null/);
  assert.match(editor, /workflowStatus = ''/);
  assert.match(editor, /onSetWorkflowStatus/);
  assert.match(editor, /onCreateLinkedNote/);
  assert.match(editor, /noteTags=\{note\.tags \|\| \[\]\}/);
  assert.match(editor, /vaultId=\{vaultId\}/);
  assert.match(outliner, /noteTags = \[\]/);
  assert.match(outliner, /vaultId = ''/);
  assert.match(outliner, /window\.mnReadNovelistAiConfig\?\.\(vaultId\)/);
  assert.match(outliner, /defaultPromptId: config\.defaultPromptId/);
  assert.match(outliner, /Target length: up to \$\{novelConfig\.wordLimit\} words/);
  assert.match(outliner, /Novelist writing prompt \(\$\{activePrompt\.name \|\| 'Default'\}\):/);
  assert.match(graph, /All novelist notes/);
  assert.match(graph, /Act structure/);
  assert.match(graph, /Characters \+ scenes/);
  assert.match(graph, /Plot threads \+ scenes/);
  assert.match(graph, /Research \+ scenes/);
  assert.match(graph, /padding: '0 88px 0 24px'/);
  assert.match(graph, /right: 64/);
  assert.match(notelist, /function MnNoteList[\s\S]*novelistStructure = null/);
  assert.match(notelist, /allNotes = null/);
  assert.match(notelist, /const sourceNotes = allNotes \|\| notes \|\| \[\]/);
  assert.match(notelist, /const GroupHeader/);
  assert.match(notelist, /const CollectionHeader/);
  assert.match(notelist, /chaptersForAct/);
  assert.match(notelist, /scenesForChapter/);
  assert.match(notelist, /const chapterIds = new Set/);
  assert.match(notelist, /linkedTo=\{`Linked to \$\{act\.title/);
  assert.match(notelist, /parentByChapterId/);
  assert.match(notelist, /parentBySceneId/);
  assert.match(notelist, /Unlinked chapters/);
  assert.match(notelist, /looseScenes/);
  assert.match(panels, /Supporting Notes/);
  assert.match(panels, /Workflow Status Counts/);
  assert.match(panels, /AI Config/);
  assert.match(panels, /Words/);
  assert.match(panels, /Default writing prompt/);
  assert.match(panelHelpersSource, /AI write novel/);
  assert.match(panels, /defaultPromptId/);
  assert.match(panelHelpersSource, /mn_novelist_ai_config_v2/);
  assert.match(panelHelpersSource, /function mnNovelistAiConfigKey\(vaultId = ''\)/);
  assert.match(panelHelpersSource, /function mnReadNovelistAiConfig\(vaultId = ''\)/);
  assert.match(panelHelpersSource, /mnReadNovelistAiConfig, mnWriteNovelistAiConfig/);
  assert.match(panels, /addAiPrompt/);
  assert.match(panels, /updateAiPrompt/);
  assert.doesNotMatch(panels, /AI Actions/);
  assert.doesNotMatch(panels, /const aiActions = \[/);
  assert.doesNotMatch(panels, /Novel Plot Board/);
  assert.match(ai, /initialQuery/);
});

test('Review fixes wire settings, rollup, reminders, and safe note paths', () => {
  const app = appCompositionSource();
  const preferenceModels = fs.readFileSync(path.join(__dirname, '../src/features/preferences/models.js'), 'utf8');
  const searchController = fs.readFileSync(path.join(__dirname, '../src/features/search/useSearchController.js'), 'utf8');
  const calendarModel = fs.readFileSync(path.join(__dirname, '../src/features/planning/calendarModel.js'), 'utf8');
  const bootController = fs.readFileSync(path.join(__dirname, '../src/features/boot/useBootController.js'), 'utf8');
  const todayController = fs.readFileSync(path.join(__dirname, '../src/features/today/useTodayController.js'), 'utf8');
  const appHelpers = appHelpersSource(__dirname);
  const appRuntime = fs.readFileSync(path.join(__dirname, '../src/app/appRuntime.js'), 'utf8');
  const mutations = fs.readFileSync(path.join(__dirname, '../src/app/appMutations.js'), 'utf8');
  const outliner = outlinerSource(__dirname);
  const slashCommands = fs.readFileSync(path.join(__dirname, '../src/features/editor/outliner/slashCommands.js'), 'utf8');
  const editor = fs.readFileSync(path.join(__dirname, '../src/editor/editor.jsx'), 'utf8');
  const todosPanel = fs.readFileSync(path.join(__dirname, '../src/panels/todosPanel.jsx'), 'utf8');
  const calendarPanel = fs.readFileSync(path.join(__dirname, '../src/panels/calendarPanel.jsx'), 'utf8');
  const appShell = appShellSource();
  const utilityPanels = [
    '../src/features/today/components/TodayPanel.jsx',
    '../src/features/trash/components/RecentlyDeletedPanel.jsx',
    '../src/features/capture/components/QuickCapture.jsx',
    '../src/features/reminders/components/ReminderToast.jsx',
  ].map(file => fs.readFileSync(path.join(__dirname, file), 'utf8')).join('\n');
  const sidebar = fs.readFileSync(path.join(__dirname, '../src/panels/sidebar.jsx'), 'utf8');
  const settings = settingsSource();
  const markdown = fs.readFileSync(path.join(__dirname, '../src/shared/markdown.jsx'), 'utf8');
  const store = storeProcessSource();
  const main = mainProcessSource();

  assert.match(searchController, /tweaks\.sortBy/);
  assert.match(searchController, /tweaks\.pinnedFirst/);
  assert.match(app, /parseDefaultTags: mnParseDefaultTags/);
  assert.match(app, /defaultTags: tweaks\.defaultTags/);
  assert.match(mutations, /function cleanNoteTags/);
  assert.match(app, /toggleCheckFromAggregate = \(it\) =>/);
  assert.match(app, /item\.blockId/);
  assert.match(app, /mnCollectReminderItems\(notesWithBody\)/);
  assert.match(app, /mnCollectTaskItems\(notesWithBody\)/);
  assert.match(app, /pickNewerDiskStamp/);
  assert.match(app, /savingDirtyKeysRef/);
  assert.match(app, /pendingDirtyKeysRef/);
  assert.match(app, /calendarActionItems/);
  assert.match(app, /agendaDecorateActionItems\(calendarTaskItems, notesWithBody\)/);
  assert.match(app, /items=\{calendarActionItems\}/);
  assert.match(calendarModel, /agendaBuildTaskContent/);
  assert.match(app, /agendaIsDeferred\(item\)/);
  assert.match(app, /agendaBodyHasActionText/);
  assert.match(app, /agendaReplaceUniqueSourceText/);
  assert.match(app, /patch, 'deferUntil'/);
  assert.match(app, /todayDailyNote/);
  assert.match(app, /todayAgendaItems/);
  assert.match(app, /todayAiContext/);
  assert.match(app, /generateTodayAiRecap/);
  assert.match(todayController, /contextualAiBuildTodayRecapPrompt\(aiContext\)/);
  assert.match(todayController, /ai\.chat/);
  assert.match(app, /addQuickTodayTask/);
  assert.match(app, /addTodayReflection/);
  assert.match(app, /addTodayEndDayRecap/);
  assert.match(app, /onAddQuickTask=\{addQuickTodayTask\}/);
  assert.match(app, /agendaItems=\{todayAgendaItems\}/);
  assert.match(app, /onAddReflection=\{addTodayReflection\}/);
  assert.match(app, /onEndDayRecap=\{addTodayEndDayRecap\}/);
  assert.match(app, /todayAiRecap=\{todayAiRecap\}/);
  assert.match(app, /todayAiRecapBusy=\{todayAiRecapBusy\}/);
  assert.match(app, /todayAiRecapError=\{todayAiRecapError\}/);
  assert.match(app, /onGenerateAiRecap=\{featureState\.showAskAi \? generateTodayAiRecap : null\}/);
  assert.match(app, /onOpenAgenda=\{\(\) => \{ navigateView\('calendar'\)/);
  assert.match(app, /view === 'today' \? 'Today'/);
  assert.match(preferenceModels, /function normalizeStartupView\(value\)/);
  assert.match(preferenceModels, /return value === 'today' \? 'today' : 'notes'/);
  assert.match(bootController, /startupView = normalizeStartupView\(mergedTweaks\.startupView\)/);
  assert.match(bootController, /setTweaks\(current => \(\{ \.\.\.current, \.\.\.prefs\.tweaks, startupView \}\)\)/);
  assert.match(bootController, /if \(startupView === 'today'\) setView\('today'\)/);
  assert.match(app, /id: 'today'[\s\S]*description: 'Show the Today dashboard\.'/);
  assert.doesNotMatch(app, /Daily rollup/);
  assert.match(app, /onPlanItem=\{featureState\.showAgenda \? \(\) => \{ navigateView\('calendar'\)/);
  assert.match(app, /view === 'calendar'/);
  assert.match(app, /id: 'calendar'/);
  assert.match(app, /id: 'calendar'[\s\S]*label: 'Open Agenda'[\s\S]*openView\('calendar'\)/);
  assert.match(app, /id: 'todos'[\s\S]*hidden: true[\s\S]*aiHidden: true[\s\S]*openView\('calendar'\)/);
  assert.match(app, /mnCalendarTaskContent\(text, date, type === 'reminder' \? time : ''\)/);
  assert.match(app, /mnWriteSnoozedReminder/);
  assert.match(app, /rollupAppendReflection/);
  assert.match(app, /rollupAppendEndDayRecap/);

  assert.match(outliner, /spellCheck=\{block\.kind === 'code' \? false : spellCheck\}/);
  assert.match(outliner, /indentGuides && Array\.from/);
  assert.match(outliner, /autoLink \? before\.match/);
  assert.match(outliner, /collapseByDefault && cmd\.kind === 'heading'/);
  assert.match(slashCommands, /MN_REMIND\.defaultText\(\)/);
  assert.doesNotMatch(outliner, /@remind\(tomorrow 9am\)/);

  assert.match(markdown, /const MN_REMIND = \{/);
  assert.match(markdown, /function mnDefaultReminderText/);
  assert.match(todosPanel, /collectTaskItems/);
  assert.match(todosPanel, /isReminderOnly/);
  assert.match(calendarPanel, /function MnCalendarPanel/);
  assert.match(calendarPanel, /filterStatus/);
  assert.match(calendarPanel, /createWhen/);
  assert.match(calendarPanel, /draftWhen/);
  assert.match(calendarPanel, /scheduleError/);
  assert.match(calendarPanel, /Filter Agenda by tag/);
  assert.match(calendarPanel, /Filter Agenda by source note/);
  assert.match(calendarPanel, /aria-label="Schedule phrase"/);
  assert.match(calendarPanel, /aria-label="Edit schedule phrase"/);
  assert.match(calendarPanel, /agendaParseScheduleInput/);
  assert.match(calendarPanel, /if \(!resolved\.ok\) return/);
  assert.match(calendarPanel, /\['overdue', 'Overdue'\]/);
  assert.match(calendarPanel, /\['unscheduled', 'Unscheduled'\]/);
  assert.match(calendarPanel, /Clear filters/);
  assert.match(calendarPanel, /agendaFilterActionItems/);
  assert.match(calendarPanel, /agendaActionDetail/);
  assert.match(calendarPanel, /\['Source', detail\.sourceNoteTitle/);
  assert.match(calendarPanel, /\['Reason', detail\.reason/);
  assert.match(calendarPanel, /\['Scheduled', detail\.scheduledDate/);
  assert.match(calendarPanel, /Inbox todos/);
  assert.match(calendarPanel, /createOpen/);
  assert.match(calendarPanel, /Add item on/);
  assert.match(calendarPanel, />\+ New<\/button>/);
  assert.match(calendarPanel, /onUpdateItem/);
  assert.match(calendarPanel, /aria-label=\{`\$\{item\.checked \? 'Reopen' : 'Complete'\} \$\{label\}`\}/);
  assert.match(todosPanel, /aria-label=\{`\$\{it\.checked \? 'Reopen' : 'Complete'\}/);
  assert.match(calendarPanel, /onSnoozeItem/);
  assert.doesNotMatch(appShell, /function MnAppTopToolbar/);
  assert.match(editor, /onOpenCalendar/);
  assert.match(editor, /title="Agenda"/);
  assert.match(utilityPanels, /onSnooze \|\| onDismiss/);
  assert.match(utilityPanels, /rollupFormat === 'short'/);
  assert.match(utilityPanels, /tasks = \[\], reminders = \[\], todayNote = null, agendaItems = \[\]/);
  assert.match(utilityPanels, /Quick task/);
  assert.match(utilityPanels, /Add reflection/);
  assert.match(utilityPanels, /End-day recap/);
  assert.match(utilityPanels, /AI recap/);
  assert.match(utilityPanels, /AI daily recap/);
  assert.match(utilityPanels, /providerModelLabel/);
  assert.match(utilityPanels, /sourceButton/);
  assert.match(utilityPanels, /recapSections/);
  assert.match(utilityPanels, /Agenda today/);
  assert.match(utilityPanels, /Open Agenda/);
  assert.match(utilityPanels, /No agenda items today/);
  assert.match(utilityPanels, /rollupFilterTaskItems/);
  assert.match(utilityPanels, /rollupFilterReminderItems/);
  assert.match(utilityPanels, /rollupTaskReasonLabel/);
  assert.match(utilityPanels, /rollupReminderReasonLabel/);
  assert.match(utilityPanels, /destinations = \[\]/);
  assert.match(utilityPanels, /templates = \[\]/);
  assert.match(utilityPanels, /aria-label="Capture destination"/);
  assert.match(utilityPanels, /aria-label="Capture template"/);
  assert.match(utilityPanels, /No template/);
  assert.match(utilityPanels, /destinationId: activeDestination\?\.id \|\| 'new'/);
  assert.match(utilityPanels, /templateId: activeTemplate\?\.id === 'raw' \? '' : activeTemplate\?\.id/);
  assert.match(app, /const saveQuickCapture = useCallbackA/);
  assert.match(app, /captureBuildSavePlan/);
  assert.match(app, /captureDestinationById/);
  assert.match(app, /quickCaptureAppendBody/);
  assert.match(app, /destinations=\{MN_APP_HELPERS\.captureDestinationChoices/);
  assert.match(app, /templates=\{MN_APP_HELPERS\.captureTemplateChoices/);
  assert.match(app, /saveQuickCapture\(capture\)/);
  assert.match(preferenceModels, /PHASE5_METRICS_STORAGE_KEY = 'mn_phase5_metrics_v1'/);
  assert.match(app, /const recordPhase5Metric = useCallbackA/);
  assert.match(app, /phase5RecordMetric\(mnReadLocalPhase5Metrics\(\), key, details\)/);
  assert.match(app, /recordPhase5Metric\('capture_saves'/);
  assert.match(app, /recordPhase5Metric\('zotero_source_notes'/);
  assert.match(appHelpers, /PHASE5_METRIC_KEYS/);
  assert.match(appHelpers, /function phase5RecordMetric/);
  assert.match(appHelpers, /Unsupported Phase 5 metric key/);
  assert.doesNotMatch(appHelpers, /sendBeacon|XMLHttpRequest|fetch\(/);
  assert.match(store, /const KEYS = new Set\(\['capture_saves'/);
  assert.match(store, /sanitizePhase5Metrics\(cleanPatch\.phase5Metrics, \{ rejectUnknown: true \}\)/);
  assert.match(store, /recordPhase5Metric\(cfg\.phase5Metrics, 'theme_installs'/);
  assert.match(store, /recordPhase5Metric\(cfg\.phase5Metrics, 'onboarding_mode_selections'/);
  assert.match(utilityPanels, /Title date/);
  assert.match(utilityPanels, /No notes today/);
  assert.match(utilityPanels, /dailyNote \? 'Open daily note' : 'Create daily note'/);
  assert.match(utilityPanels, />Open loops<\/div>/);
  assert.match(utilityPanels, /No open loops for this range/);
  assert.match(utilityPanels, /No reminders due in this range/);
  assert.match(utilityPanels, /label: 'Overdue'/);
  assert.match(utilityPanels, /label: 'Due today'/);
  assert.match(utilityPanels, /label: 'Upcoming'/);
  assert.match(utilityPanels, />Plan<\/button>/);
  assert.match(utilityPanels, /aria-label=\{`Plan \$\{taskLabel\(item\)\}`\}/);
  assert.match(utilityPanels, /aria-label=\{`Plan \$\{reminderLabel\(item\)\}`\}/);
  assert.doesNotMatch(utilityPanels, />Open tasks<\/div>/);
  assert.doesNotMatch(utilityPanels, /No open tasks/);
  assert.doesNotMatch(utilityPanels, /No due reminders/);
  assert.doesNotMatch(utilityPanels, /Daily rollup/);
  assert.doesNotMatch(utilityPanels, /type="date"/);
  assert.doesNotMatch(utilityPanels, /type="time"/);
  assert.doesNotMatch(utilityPanels, />Complete<\/button>/);
  assert.match(sidebar, /label="Today"/);
  assert.doesNotMatch(sidebar, /label="Daily rollup"/);
  assert.match(sidebar, /label="Agenda"/);
  assert.match(sidebar, /onOpenAgenda/);
  assert.match(sidebar, /const rollupCount = notes\.length/);

  assert.match(settings, /<StaticValue T=\{T\}>Markdown<\/StaticValue>/);
  assert.match(settings, /<StaticValue T=\{T\}>Local only<\/StaticValue>/);
  assert.match(settings, /<StaticValue T=\{T\}>Always on<\/StaticValue>/);
  assert.doesNotMatch(settings, /Todo layout/);
  assert.doesNotMatch(settings, /setTweak\('todoVariant'/);
  assert.doesNotMatch(settings, /label="Startup view"/);
  assert.doesNotMatch(settings, /setTweak\('startupView', v\)/);
  assert.match(settings, /label="Today heading format"/);
  assert.match(settings, /label="Show Today previews"/);
  assert.match(settings, /label="Show Today open loops"/);
  assert.match(settings, /label="Show Today reminders"/);
  assert.doesNotMatch(settings, /Daily rollup/);
  assert.match(settings, /setTweak\('rollupDefaultRange', v\)/);
  assert.match(settings, /setTweak\('rollupGroupBy', v\)/);
  assert.match(settings, /setTweak\('rollupShowPreviews', v\)/);
  assert.match(settings, /setTweak\('rollupShowTasks', v\)/);
  assert.match(settings, /setTweak\('rollupShowReminders', v\)/);
  assert.match(settings, /setTweak\('rollupCollapseOlder', v\)/);
  assert.match(settings, /setTweak\('weekStart', v\)/);
  assert.match(appHelpers, /function rollupGroupNotes/);
  assert.match(appHelpers, /function rollupAppendQuickTask/);
  assert.match(appHelpers, /function rollupAppendReflection/);
  assert.match(appHelpers, /function rollupBuildEndDayRecap/);
  assert.match(appHelpers, /function rollupAppendEndDayRecap/);
  assert.match(appHelpers, /function contextualAiBuildTodayRecapContext/);
  assert.match(appHelpers, /function contextualAiBuildTodayRecapPrompt/);
  assert.match(appHelpers, /function contextualAiBuildTodayRecapResult/);
  assert.match(appHelpers, /function smartViewNormalizeDefinition/);
  assert.match(appHelpers, /function smartViewMatchesNote/);
  assert.match(appHelpers, /function smartViewQueryNotes/);
  assert.match(appHelpers, /function smartViewQueryActions/);
  assert.match(appHelpers, /function smartViewQuery/);
  assert.match(appHelpers, /function smartViewValidateSavedDefinition/);
  assert.match(appHelpers, /function smartViewSerializeDefinition/);
  assert.match(appHelpers, /function smartViewParseDefinitionText/);
  assert.match(appHelpers, /function smartViewParseEmbedBlock/);
  assert.match(appHelpers, /function smartViewUpsertSavedDefinition/);
  assert.match(appHelpers, /"SMART_VIEW_FORMAT"/);
  for (const name of [
    'smartViewNormalizeDefinition', 'smartViewMatchesNote', 'smartViewQueryNotes',
    'smartViewQueryActions', 'smartViewQuery', 'smartViewValidateSavedDefinition',
    'smartViewSerializeDefinition', 'smartViewParseDefinitionText',
    'smartViewParseEmbedBlock', 'smartViewUpsertSavedDefinition',
  ]) assert.match(appHelpers, new RegExp(`"${name}"`));
  assert.match(appHelpers, /function agendaActionStatus/);
  assert.match(appHelpers, /function agendaActionDetail/);
  assert.match(appHelpers, /function agendaFilterActionItems/);
  assert.match(appHelpers, /function agendaParseDeferMarker/);
  assert.match(appHelpers, /function agendaBuildTaskContent/);
  assert.match(appHelpers, /function agendaIsDeferred/);
  assert.match(appHelpers, /function agendaBodyHasActionText/);
  assert.match(appHelpers, /function agendaReplaceUniqueSourceText/);
  assert.match(appHelpers, /"agendaBuildTaskContent"/);
  assert.match(appHelpers, /"agendaIsDeferred"/);
  assert.match(appHelpers, /function agendaParseScheduleInput/);
  assert.match(appHelpers, /"agendaParseScheduleInput"/);
  assert.match(appHelpers, /Review notes from \$\{today\} for decisions to keep\./);
  assert.match(appRuntime, /"startupView": "notes"/);
  assert.match(appRuntime, /"rollupDefaultRange": "today"/);
  assert.match(store, /'startupView'/);
  assert.match(store, /'rollupDefaultRange'/);
  assert.match(store, /'rollupShowReminders'/);
  assert.match(main, /startupView: 'notes'/);
  assert.match(main, /rollupDefaultRange: 'today'/);
  assert.match(main, /rollupShowReminders: true/);
  assert.match(store, /function validateNoteId/);
  assert.match(store, /\^\[A-Za-z0-9_-\]\+\$/);
  assert.match(store, /path\.relative\(dir, file\)/);
});

test('Smart Views panel renders shared result presentations', () => {
  const app = appCompositionSource();
  const preferenceModels = fs.readFileSync(path.join(__dirname, '../src/features/preferences/models.js'), 'utf8');
  const navigationController = fs.readFileSync(path.join(__dirname, '../src/features/navigation/useNavigationController.js'), 'utf8');
  const bootController = fs.readFileSync(path.join(__dirname, '../src/features/boot/useBootController.js'), 'utf8');
  const panels = specialistPanelsSource();
  const smartViewsPanel = fs.readFileSync(path.join(__dirname, '../src/panels/smartViewsPanel.jsx'), 'utf8');
  const sidebar = fs.readFileSync(path.join(__dirname, '../src/panels/sidebar.jsx'), 'utf8');
  const outliner = outlinerSource(__dirname);
  const main = mainProcessSource();
  const store = storeProcessSource();

  assert.match(panels, /import '\.\/smartViewsPanel\.jsx';/);
  assert.match(smartViewsPanel, /function MnSmartViewsPanel/);
  assert.match(smartViewsPanel, /useEffect: useEffectSV/);
  assert.match(smartViewsPanel, /MN_SMART_VIEW_PRESENTATIONS = \['list', 'table', 'cards', 'timeline'\]/);
  assert.match(smartViewsPanel, /helpers\.smartViewQuery/);
  assert.match(smartViewsPanel, /helpers\.smartViewQuery\(notes, activeDefinition/);
  assert.match(smartViewsPanel, /activeDefinitionId = ''/);
  assert.match(smartViewsPanel, /onActiveDefinitionChange/);
  assert.match(smartViewsPanel, /setActiveId\(activeDefinitionId\)/);
  assert.match(smartViewsPanel, /onActiveDefinitionChange\?\.\(nextId\)/);
  assert.match(smartViewsPanel, /viewMode === 'table'/);
  assert.match(smartViewsPanel, /viewMode === 'cards'/);
  assert.match(smartViewsPanel, /viewMode === 'timeline'/);
  assert.match(smartViewsPanel, /function mnSmartViewList/);
  assert.match(smartViewsPanel, /function mnSmartViewTable/);
  assert.match(smartViewsPanel, /function mnSmartViewCards/);
  assert.match(smartViewsPanel, /function mnSmartViewTimeline/);
  assert.match(smartViewsPanel, /No Smart View results/);
  assert.match(smartViewsPanel, /onOpenAllNotes/);
  assert.match(smartViewsPanel, /Open Notes/);
  assert.match(smartViewsPanel, /function MnSmartViewActionButton/);
  assert.match(smartViewsPanel, /source\?\.noteId/);
  assert.match(smartViewsPanel, /export \{ MnSmartViewsPanel \}/);
  assert.match(smartViewsPanel, /export \{ MnSmartViewsPanel \}/);
  assert.match(app, /import \{ MnSmartViewsPanel \} from '\.\.\/panels\/smartViewsPanel\.jsx'/);
  assert.match(app, /MnSmartViewsPanel/);
  assert.match(preferenceModels, /function buildDefaultSmartViewDefinitions/);
  assert.match(preferenceModels, /function normalizeSmartViews/);
  assert.match(navigationController, /const \[savedSmartViews, setSavedSmartViews\]/);
  assert.match(navigationController, /const \[activeSmartViewId, setActiveSmartViewId\]/);
  assert.match(bootController, /setSavedSmartViews\(smartViews\)/);
  assert.match(bootController, /platform\.preferences\.setPrefs\(\{ smartViews \}\)/);
  assert.match(navigationController, /const openSmartView = useCallback/);
  assert.match(app, /const smartViewDefinitions = useMemoA/);
  assert.match(app, /MN_APP_HELPERS\.currentSmartViewDefinitions = smartViewDefinitions/);
  assert.match(preferenceModels, /id: 'recent_notes'/);
  assert.match(preferenceModels, /id: 'open_tasks'/);
  assert.match(preferenceModels, /id: 'deferred_tasks'/);
  assert.match(preferenceModels, /id: 'due_reminders'/);
  assert.match(app, /id: 'smart-views'/);
  assert.match(app, /smartViewDefinitions\.map\(definition =>/);
  assert.match(app, /id: `smart-view-\$\{definition\.id\}`/);
  assert.match(app, /run: \(\) => openSmartView\(definition\.id\)/);
  assert.match(app, /onOpenSmartViews=\{\(\) => openSmartView\(\)\}/);
  assert.match(app, /smartViewsActive=\{view === 'smart-views'\}/);
  assert.match(app, /smartViewCount=\{smartViewDefinitions\.length\}/);
  assert.match(app, /view === 'smart-views'/);
  assert.match(app, /<MnSmartViewsPanel/);
  assert.match(app, /definitions=\{smartViewDefinitions\}/);
  assert.match(app, /activeDefinitionId=\{activeSmartViewId\}/);
  assert.match(app, /onActiveDefinitionChange=\{setActiveSmartViewId\}/);
  assert.match(app, /onOpenAllNotes=\{\(\) => \{ setSelectedTag\(null\); setSelectedWorkflow\(null\); setQuery\(''\); navigateView\('notes'\); \}\}/);
  assert.match(sidebar, /onOpenSmartViews, smartViewsActive = false, smartViewCount = 0/);
  assert.match(sidebar, /const iconSmartViews =/);
  assert.match(sidebar, /!smartViewsActive/);
  assert.match(sidebar, /label="Smart Views" count=\{smartViewCount\}/);
  assert.match(outliner, /import MN_APP_HELPERS from '\.\.\/app\/appHelpers\.js'/);
  assert.match(outliner, /function MnSmartViewEmbed/);
  assert.match(outliner, /function MnSmartViewEmbedFallback/);
  assert.match(outliner, /data-mn-smart-view-embed="rendered"/);
  assert.match(outliner, /smartViewParseEmbedBlock\(content, MN_APP_HELPERS\.currentSmartViewDefinitions \|\| \[\]\)/);
  assert.match(main, /PREF_TOP_LEVEL_KEYS = new Set\(\[[\s\S]*'enabledPacks'[\s\S]*'localUsageMetrics'[\s\S]*'anonymousUsageSharing'/);
  assert.match(main, /function sanitizeSmartViewsForPrefs/);
  assert.match(main, /clean\.smartViews = sanitizeSmartViewsForPrefs\(value\)/);
  assert.match(store, /smartViews: Array\.isArray\(cfg\.smartViews\) \? cfg\.smartViews : null/);
  assert.match(store, /const allowed = new Set\(\[[\s\S]*'enabledPacks'[\s\S]*'localUsageMetrics'[\s\S]*'anonymousUsageSharing'/);
  assert.match(store, /Object\.prototype\.hasOwnProperty\.call\(cleanPatch, 'smartViews'\)/);
});

test('Pastel theme is selectable and keeps existing theme contracts', () => {
  const themeSource = fs.readFileSync(path.join(__dirname, '../src/shared/theme.jsx'), 'utf8');
  const settings = settingsSource();
  const app = appSource(__dirname);
  const bootController = fs.readFileSync(path.join(__dirname, '../src/features/boot/useBootController.js'), 'utf8');
  const main = mainProcessSource();
  const preload = fs.readFileSync(path.join(__dirname, '../preload.js'), 'utf8');
  const themeLib = fs.readFileSync(path.join(__dirname, '../lib/themes.js'), 'utf8');
  const { MN_THEMES: themes } = loadRendererModule('src/shared/theme.jsx');
  const hueOf = (value) => {
    const match = String(value || '').match(/oklch\(\s*[\d.]+\s+[\d.]+\s+(-?[\d.]+)/);
    return match ? Number(match[1]) : null;
  };
  const assertHueBetween = (token, min, max) => {
    const hue = hueOf(themes.pastel[token]);
    assert.ok(hue >= min && hue <= max, `${token} hue ${hue} expected in ${min}-${max}`);
  };

  assert.ok(themes.light);
  assert.ok(themes.dark);
  assert.ok(themes.pastel);
  assert.notEqual(themes.pastel, themes.light);

  const requiredKeys = Object.keys(themes.light).sort();
  assert.deepEqual(Object.keys(themes.dark).sort(), requiredKeys);
  assert.deepEqual(Object.keys(themes.pastel).sort(), requiredKeys);
  for (const token of ['bg', 'ink', 'line', 'accent', 'focus', 'danger', 'success', 'warn']) {
    assert.match(themes.pastel[token], /^oklch\(/, token);
  }
  assert.notEqual(themes.pastel.bg, themes.light.bg);
  assert.notEqual(themes.pastel.accent, themes.light.accent);
  assert.notEqual(themes.pastel.accent, themes.dark.accent);
  assertHueBetween('bgOuter', 220, 260);
  assertHueBetween('bgSub', 280, 305);
  assertHueBetween('bgInput', 315, 340);
  assertHueBetween('danger', 5, 30);
  assertHueBetween('warn', 45, 65);
  assertHueBetween('accent', 275, 300);
  assertHueBetween('focus', 275, 300);
  assertHueBetween('selBg', 315, 340);
  const greenTokens = Object.entries(themes.pastel)
    .filter(([, value]) => {
      const hue = hueOf(value);
      return hue != null && hue >= 120 && hue <= 185;
    })
    .map(([key]) => key)
    .sort();
  assert.deepEqual(greenTokens, ['success', 'successSoft']);

  assert.match(settings, /Choose a curated VispNote theme\./);
  assert.match(settings, /<select value=\{tweaks\.theme \|\| 'light'\}/);
  assert.doesNotMatch(settings, /<Segmented T=\{T\} value=\{tweaks\.theme\}/);
  assert.doesNotMatch(settings, /Install a shared JSON or YAML theme file\./);
  assert.doesNotMatch(settings, /Theme preview swatches/);
  assert.match(settings, /value: 'light', label: 'Light'/);
  assert.match(settings, /value: 'dark', label: 'Dark'/);
  assert.match(settings, /value: 'pastel', label: 'Pastel'/);
  assert.match(app, /const \[customThemes, setCustomThemes\] = useStateA\(\[\]\)/);
  assert.match(bootController, /setCustomThemes\(normalizeThemes\(prefs\.customThemes\)\)/);
  assert.match(app, /const themeMap = useMemoA\(\(\) => \{/);
  assert.match(app, /for \(const item of customThemes\) next\[item\.id\] = item\.tokens/);
  assert.match(app, /desktopBridge\.preferences\.importThemeFile\(\)/);
  assert.match(preload, /importThemeFile: \(\) => ipcRenderer\.invoke\('mn:importThemeFile'\)/);
  assert.match(main, /async function importThemeFileFromIpc\(\)/);
  assert.match(main, /filters: \[\{ name: 'VispNote Theme', extensions: \['json', 'yaml', 'yml'\] \}\]/);
  assert.match(main, /ipcMain\.handle\('mn:importThemeFile', wrap\(importThemeFileFromIpc\)\)/);
  assert.match(themeLib, /function themeTokenCoverage/);
  assert.match(themeLib, /function themeContrastReport/);
  assert.match(themeLib, /function themePreview/);
  assert.match(themeLib, /Theme contrast is too low/);
  assert.match(themeLib, /already installed/);
  assert.doesNotMatch(settings, /ipcRenderer|require\('electron'\)|package\.json/);
});

test('Focused product shell and private usage controls are wired end to end', () => {
  const app = appSource(__dirname);
  const sidebar = fs.readFileSync(path.join(__dirname, '../src/panels/sidebar.jsx'), 'utf8');
  const settings = settingsSource();
  const preload = fs.readFileSync(path.join(__dirname, '../preload.js'), 'utf8');
  const main = mainProcessSource();

  assert.match(sidebar, /label="All notes"/);
  assert.match(sidebar, /label="Today"/);
  assert.match(sidebar, /label="Pinned"/);
  assert.match(sidebar, /label="Tags"/);
  assert.match(sidebar, /featureState\.showAgenda/);
  assert.match(sidebar, /featureState\.showCanvas/);
  assert.match(sidebar, /featureState\.showAskAi/);
  assert.match(sidebar, /label="More"/);
  assert.match(app, /MN_FEATURES\.deriveFeatureState/);
  assert.match(settings, /label: 'Data & Privacy'/);
  assert.match(settings, /label: 'Assistance'/);
  assert.match(settings, /label: 'Advanced'/);
  assert.match(settings, /Local feature report/);
  assert.match(settings, /Anonymous sharing/);
  assert.match(settings, /Advanced provider settings/);
  assert.match(preload, /featureUsage: \{/);
  assert.match(main, /mn:featureUsage\.status/);
  assert.match(main, /VISPNOTE_TELEMETRY_ENDPOINT/);
  assert.match(main, /prefs\.anonymousUsageSharing !== true/);
});

test('Reference pane and bounded note list stay optional and keyboard accessible', () => {
  const app = appCompositionSource();
  const referenceController = fs.readFileSync(path.join(__dirname, '../src/features/reference/useReferencePaneController.js'), 'utf8');
  const editor = fs.readFileSync(projectPaths.src.editor, 'utf8');
  const noteList = fs.readFileSync(path.join(__dirname, '../src/panels/notelist.jsx'), 'utf8');
  const reference = fs.readFileSync(path.join(__dirname, '../src/features/reference/components/ReferencePane.jsx'), 'utf8');
  const entry = fs.readFileSync(projectPaths.src.main, 'utf8');
  assert.match(app, /from '\.\.\/features\/reference\/index\.js'/);
  assert.match(reference, /function ReferencePane/);
  assert.match(app, /id: 'reference-pane'/);
  assert.match(app, /args\.noteId \|\| args\.noteTitle \? currentOrArgNote\(args\) : null/);
  assert.match(referenceController, /recordUsage\('reference_pane', 'opened'\)/);
  assert.match(app, /isMod && e\.shiftKey && lowerKey === 'r'/);
  assert.match(editor, /aria-label=\{referencePaneOpen \? 'Close reference pane' : 'Open reference pane'\}/);
  assert.match(noteList, /role="listbox"/);
  assert.match(noteList, /visibleLimit < notes\.length/);
  assert.match(noteList, /Open as reference/);
});

test('Electron installs native edit context menu for right-click copy paste cut', () => {
  const main = mainProcessSource();
  const html = fs.readFileSync(path.join(__dirname, '../vispnote.html'), 'utf8');
  const builder = fs.readFileSync(path.join(__dirname, '../electron-builder.yml'), 'utf8');
  const linuxAfterInstall = fs.readFileSync(path.join(__dirname, '../scripts/linux-after-install.sh'), 'utf8');
  const icon = fs.statSync(path.join(__dirname, '../assets/vispnote-icon.png'));
  const linuxIconSizes = [16, 24, 32, 48, 64, 128, 256, 512, 1024];

  assert.match(main, /APP_ICON_PATH = path\.join\(__dirname, 'assets', 'vispnote-icon\.png'\)/);
  assert.match(main, /const APP_NAME = 'VispNote'/);
  assert.match(main, /app\.setName\(APP_NAME\)/);
  assert.match(main, /app\.setDesktopName\('vispnote\.desktop'\)/);
  assert.match(main, /label: visible \? `Hide \$\{appName\}` : `Show \$\{appName\}`/);
  assert.match(main, /label: `Quit \$\{appName\}`/);
  assert.match(main, /tray\.setToolTip\(appName\)/);
  assert.match(main, /title: appName/);
  assert.match(main, /const fs = require\('fs'\)/);
  assert.match(main, /function createAppIcon\(\)/);
  assert.match(main, /function createFallbackIcon\(\)/);
  assert.match(main, /if \(!image\.isEmpty\(\)\) return image/);
  assert.match(main, /nativeImage\.createFromPath\(iconPath\)/);
  assert.match(main, /nativeImage\.createFromDataURL/);
  assert.match(main, /new Tray\(createAppIcon\(\)\)/);
  assert.match(main, /icon: createAppIcon\(\)/);
  assert.match(main, /app\.dock\?\.setIcon\(windowLifecycle\.createAppIcon\(\)\)/);
  assert.match(main, /function attachEditContextMenu\(win\)/);
  assert.match(main, /webContents\.on\('context-menu'/);
  assert.match(main, /params\.isEditable/);
  assert.match(main, /dictionarySuggestions/);
  assert.match(main, /replaceMisspelling\(word\)/);
  assert.match(main, /addWordToSpellCheckerDictionary\(params\.misspelledWord\)/);
  assert.match(main, /spellcheck: true/);
  assert.match(main, /setSpellCheckerEnabled\(true\)/);
  assert.match(main, /availableSpellCheckerLanguages/);
  assert.match(main, /setSpellCheckerLanguages\(\[language \|\| 'en-US'\]\)/);
  assert.match(main, /ipcMain\.handle\('mn:spellcheck'/);
  assert.match(main, /role: 'cut'/);
  assert.match(main, /role: 'copy'/);
  assert.match(main, /role: 'paste'/);
  assert.match(main, /role: 'selectAll'/);
  assert.match(main, /attachEditContextMenu\(win\)/);
  assert.ok(icon.size > 0);
  assert.match(html, /type="image\/png" href="assets\/vispnote-icon\.png"/);
  assert.match(builder, /appId: com\.vispnote\.app/);
  assert.match(builder, /productName: VispNote/);
  assert.match(builder, /- assets\/\*\*\/*/);
  assert.match(builder, /!VispNote\/\*\*\/*/);
  assert.match(builder, /!OminiNote\/\*\*\/*/);
  assert.match(builder, /!MyNote\/\*\*\/*/);
  assert.match(builder, /!vispnote-web\/\*\*\/*/);
  assert.match(builder, /icon: assets\/linux-icons/);
  assert.match(builder, /afterInstall: scripts\/linux-after-install\.sh/);
  assert.match(builder, /shortcutName: VispNote/);
  for (const size of linuxIconSizes) {
    assert.ok(fs.statSync(path.join(__dirname, `../assets/linux-icons/${size}x${size}.png`)).size > 0);
  }
  assert.match(linuxAfterInstall, /gtk-update-icon-cache -q -t -f \/usr\/share\/icons\/hicolor/);
  assert.match(linuxAfterInstall, /xdg-icon-resource forceupdate --theme hicolor/);
});

test('URL plugins follow the external URL security policy and surface failures', () => {
  const app = appCompositionSource();
  const plugins = fs.readFileSync(path.join(__dirname, '../src/shared/plugins.js'), 'utf8');

  assert.match(app, /appActionRegistry\.run\(action\.id, \{\}, \{ confirmed: action\.risk === 'external' \}\)/);
  assert.match(app, /risk: plugin\.type === 'open-url' \? 'external' : 'safe'/);
  assert.match(plugins, /Launch a trusted HTTPS page or mail link/);
  assert.match(app, /const runPlugin = useCallbackA\(async \(plugin\) =>/);
  assert.ok(app.includes("if (!/^(https:\\/\\/|mailto:)/i.test(url)) {"));
  assert.match(app, /must start with https:\/\/ or mailto:/);
  assert.match(app, /const res = await desktopBridge\.app\.openExternal\(url\)/);
  assert.match(app, /if \(res && res\.ok === false\) throw new Error/);
  assert.match(app, /showAppNotice\('Could not open link'/);
  assert.doesNotMatch(app, /must start with http:\/\/ or https:\/\//);
});

test('Plugin ids normalize to AI-safe action names', () => {
  const appActions = require('../src/app/appActions.js');
  const { MN_PLUGINS } = loadRendererModule('src/shared/plugins.js');

  const plugin = MN_PLUGINS.normalize({
    id: '../bad plugin:id',
    name: 'Open docs',
    purpose: 'Open documentation',
    type: 'open-url',
    config: { url: 'https://example.com' },
  });
  assert.equal(plugin.id, 'bad-plugin-id');
  assert.match(plugin.id, /^[A-Za-z0-9_-]+$/);

  const registry = appActions.createRegistry([{
    id: `plugin-${plugin.id}`,
    label: plugin.name,
    description: plugin.purpose,
    inputSchema: { type: 'object', additionalProperties: false },
    run: () => ({}),
  }]);
  assert.deepEqual(registry.describeForAi().map(action => action.name), ['plugin-bad-plugin-id']);
});

test('Main-process prefs sanitizer accepts every renderer plugin type', () => {
  const main = mainProcessSource();
  const { MN_PLUGINS } = loadRendererModule('src/shared/plugins.js');

  const allowlist = main.match(/if \(!\[([^\]]+)\]\.includes\(type\)\) throw new Error\('Invalid plugin type'\)/);
  assert.ok(allowlist, 'plugin type allowlist exists in main.js sanitizer');
  const allowedTypes = allowlist[1].split(',').map(entry => entry.trim().replace(/^'|'$/g, ''));
  for (const type of MN_PLUGINS.TYPES) {
    assert.ok(allowedTypes.includes(type.id), `main.js prefs sanitizer allows plugin type "${type.id}"`);
  }

  // llm-memory config fields must survive the sanitizer round trip.
  assert.match(main, /serverUrl: capString\(config\.serverUrl/);
  assert.match(main, /repoId: capString\(config\.repoId/);
  assert.match(main, /apiKey: capString\(config\.apiKey/);
});

test('Zotero reader is wired as a read-only AI app action', () => {
  const app = appCompositionSource();
  const plugins = fs.readFileSync(path.join(__dirname, '../src/shared/plugins.js'), 'utf8');
  const settings = settingsSource();
  const ai = rendererAiSource();
  const runtime = fs.readFileSync(path.join(__dirname, '../src/ai/aiRuntime.js'), 'utf8');
  const appActions = fs.readFileSync(path.join(__dirname, '../src/app/appActions.js'), 'utf8');
  const main = mainProcessSource();
  const preload = fs.readFileSync(path.join(__dirname, '../preload.js'), 'utf8');

  assert.match(plugins, /id: 'zotero-reader'/);
  assert.match(plugins, /Let Ask AI search and read Zotero papers/);
  assert.match(settings, /draft\.type === 'zotero-reader'/);
  assert.match(settings, /include "Zotero" or "paper"/);
  assert.match(settings, /use the Zotero paper to improve this note/);
  assert.match(app, /const zoteroReaderEnabled = plugins\.some/);
  assert.match(app, /id: 'zotero-search'/);
  assert.match(app, /id: 'zotero-read'/);
  assert.match(app, /id: 'zotero-source-note'/);
  assert.match(app, /label: 'Create Zotero source note'/);
  assert.match(app, /idempotent: true/);
  assert.match(app, /readOnly: true/);
  assert.match(app, /desktopBridge\.integrations\.zotero\.search/);
  assert.match(app, /desktopBridge\.integrations\.zotero\.read/);
  assert.match(app, /desktopBridge\.integrations\.zotero\.status/);
  assert.match(app, /zoteroFindSourceNote\(notesWithBody, itemKey\)/);
  assert.match(app, /zoteroBuildSourceNotePlan/);
  assert.match(app, /Created Zotero source note/);
  assert.match(app, /uniqueNoteTitle\(plan\.createNote\.title/);
  assert.match(ai, /runZoteroDocumentRequest/);
  assert.match(ai, /const cleanedQueries = \[/);
  assert.match(ai, /Zotero responded: Local API is not enabled/);
  assert.match(ai, /summarizeZoteroRead/);
  assert.match(ai, /function mnWantsZoteroSummaryNote/);
  assert.match(ai, /Created page "\$\{title\}" from the Zotero paper/);
  assert.match(app, /aiHidden: true/);
  assert.match(appActions, /filter\(action => !action\.aiHidden\)/);
  assert.match(runtime, /zotero/);
  assert.match(runtime, /function isLikelyDocumentQuestion/);
  assert.match(runtime, /function makeZoteroSearchPlan/);
  assert.match(main, /const zotero = require\('\.\/lib\/integrations\/zotero\/client'\)/);
  assert.match(main, /ipcMain\.handle\('mn:zotero\.search'/);
  assert.match(preload, /zotero: \{/);
  assert.match(preload, /read: \(payload\) => ipcRenderer\.invoke\('mn:zotero\.read', payload\)/);
});

test('Release metadata targets renamed VispNote repository', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '../package.json'), 'utf8'));
  const lock = JSON.parse(fs.readFileSync(path.join(__dirname, '../package-lock.json'), 'utf8'));
  const workflow = fs.readFileSync(path.join(__dirname, '../.github/workflows/release-builds.yml'), 'utf8');
  const settings = settingsSource();
  const aiSource = backendAiSource(__dirname);
  const rendererEntry = fs.readFileSync(projectPaths.src.main, 'utf8');

  assert.match(pkg.version, /^\d+\.\d+\.\d+$/);
  assert.equal(lock.version, pkg.version);
  assert.equal(lock.packages[''].version, pkg.version);
  assert.deepEqual(pkg.files, [
    'vispnote.html',
    'main.js',
    'preload.js',
    'assets/',
    'build/renderer/',
    'lib/',
    'bin/',
    'src/',
    'scripts/linux-after-install.sh',
    'scripts/before-pack.js',
    'scripts/build-renderer.js',
    'scripts/verify-packaged-renderer.js',
    'electron-builder.yml',
  ]);
  assert.equal(pkg.homepage, 'https://github.com/djkeshawa/visp-note#readme');
  assert.equal(pkg.repository.url, 'https://github.com/djkeshawa/visp-note.git');
  assert.equal(pkg.scripts['build:renderer'], 'node scripts/build-renderer.js');
  assert.equal(pkg.scripts['verify:package-renderer'], 'node scripts/verify-packaged-renderer.js');
  assert.equal(pkg.scripts['regression:ai'], 'npm run build:renderer && electron --no-sandbox scripts/ai-regression-electron.js');
  assert.match(pkg.scripts['test:all'], /npm run regression:ai/);
  assert.equal(pkg.scripts.prebuild, 'npm run build:renderer');
  assert.equal(pkg.dependencies['@babel/standalone'], undefined);
  const rendererBuild = fs.readFileSync(path.join(__dirname, '../scripts/build-renderer.js'), 'utf8');
  assert.match(rendererBuild, /esbuild\.buildSync/);
  assert.match(rendererBuild, /bundle: true/);
  assert.match(rendererEntry, /import \{ MnApp \} from '\.\/app\/app\.jsx'/);
  assert.match(rendererEntry, /React\.createElement\(MnApp\)/);
  assert.match(fs.readFileSync(path.join(__dirname, '../electron-builder.yml'), 'utf8'), /beforePack: scripts\/before-pack\.js/);
  assert.match(fs.readFileSync(path.join(__dirname, '../scripts/before-pack.js'), 'utf8'), /Refusing to package/);
  assert.match(fs.readFileSync(path.join(__dirname, '../scripts/verify-packaged-renderer.js'), 'utf8'), /Wrong-platform better-sqlite3 native module/);
  assert.match(fs.readFileSync(path.join(__dirname, '../scripts/verify-packaged-renderer.js'), 'utf8'), /Wrong-platform sqlite-vec package/);
  assert.match(workflow, /name: VispNote-\$\{\{ matrix\.name \}\}/);
  assert.match(workflow, /Verify packaged renderer bundle/);
  assert.match(workflow, /--title "VispNote \$\{tag\}"/);
  assert.match(workflow, /Automated VispNote desktop release/);
  assert.match(settings, /Version \{version\} · Prototype/);
  assert.match(aiSource, /headers\['HTTP-Referer'\] = 'https:\/\/github\.com\/djkeshawa\/visp-note'/);
  assert.match(aiSource, /headers\['X-Title'\] = 'VispNote'/);
});

test('Release builds omit AppX and MSIX Store package targets', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '../package.json'), 'utf8'));
  const builder = fs.readFileSync(path.join(__dirname, '../electron-builder.yml'), 'utf8');
  const workflow = fs.readFileSync(path.join(__dirname, '../.github/workflows/release-builds.yml'), 'utf8');

  assert.equal(pkg.scripts['build:win:appx'], undefined);
  assert.equal(pkg.scripts['build:win:msix'], undefined);
  assert.equal(pkg.scripts['build:win:store'], undefined);
  assert.doesNotMatch(builder, /^appx:/m);
  assert.doesNotMatch(workflow, /windows-appx-x64/);
  assert.doesNotMatch(workflow, /windows-msix-x64/);
  assert.doesNotMatch(workflow, /dist\/\*\.appx/);
  assert.doesNotMatch(workflow, /dist\/\*\.msix/);
  assert.equal(fs.existsSync(path.join(__dirname, '../electron-builder-msix.yml')), false);
  assert.equal(fs.existsSync(path.join(__dirname, '../docs/microsoft-store-submission.md')), false);
});

test('Vault switcher uses VispNote icon instead of letter tiles', () => {
  const sidebar = [
    '../src/panels/sidebar.jsx',
    '../src/shared/components/VaultIcon.jsx',
  ].map(file => fs.readFileSync(path.join(__dirname, file), 'utf8')).join('\n');

  assert.match(sidebar, /const VAULT_ICON_SRC = 'assets\/vispnote-icon\.png'/);
  assert.match(sidebar, /function VaultIcon/);
  assert.match(sidebar, /<img src=\{VAULT_ICON_SRC\} alt="" aria-hidden="true"/);
  assert.match(sidebar, /<MnVaultIcon T=\{T\} size=\{22\} active \/>/);
  assert.match(sidebar, /<MnVaultIcon T=\{T\} size=\{20\} active=\{active\} \/>/);
  assert.match(sidebar, /Switch vault/);
  assert.match(sidebar, /vaultKindLabel/);
  assert.match(sidebar, /vaultNoteLabel/);
  assert.match(sidebar, /maxHeight: 260/);
  assert.match(sidebar, /aria-haspopup="menu"/);
  assert.match(sidebar, /onRefreshVaults\(\{ reloadActive: false, reason: 'vault-dropdown' \}\)/);
  assert.match(sidebar, /Rename vault/);
  assert.doesNotMatch(sidebar, /activeVault\?\.name \|\| 'm'\)\[0\]\.toLowerCase/);
  assert.doesNotMatch(sidebar, /v\.name\[0\]\.toLowerCase/);
});

test('Fallback spell checker underlines misspellings and offers replacements', () => {
  const main = mainProcessSource();
  const preload = fs.readFileSync(path.join(__dirname, '../preload.js'), 'utf8');
  const outliner = outlinerSource(__dirname);
  const spellcheck = fs.readFileSync(path.join(__dirname, '../src/features/editor/outliner/spellcheck.jsx'), 'utf8');

  assert.match(main, /function spellcheckWords/);
  assert.match(main, /SPELL_DICTIONARY_PATHS/);
  assert.match(main, /const SPELL_SUGGESTION_CACHE_LIMIT = 1000/);
  assert.match(main, /async function loadSpellWords\(\)/);
  assert.match(main, /await fs\.promises\.readFile\(file, 'utf8'\)/);
  assert.match(main, /loadSpellWords\(\)\.catch/);
  assert.match(main, /spellSuggestionCache\.size >= SPELL_SUGGESTION_CACHE_LIMIT/);
  assert.match(main, /loadedDictionaryWords < MIN_USABLE_DICTIONARY_WORDS/);
  assert.match(main, /if \(!spellDictionaryAvailable\) return \{\}/);
  assert.match(main, /spellSuggestions\(word, dictionary\)/);
  assert.match(preload, /spellcheck: \(words\) => ipcRenderer\.invoke\('mn:spellcheck', words\)/);
  assert.match(spellcheck, /function renderSpellCheckedText/);
  assert.match(spellcheck, /textDecorationStyle: 'wavy'/);
  assert.match(outliner, /MnSpellSuggestionMenu/);
  assert.match(outliner, /platformApi\.app\.spellcheck\(words\)/);
  assert.match(outliner, /applySpellSuggestion/);
});

test('Workflow notes can be archived from workflow boards only', () => {
  const app = appSource(__dirname);
  const appRuntime = fs.readFileSync(path.join(__dirname, '../src/app/appRuntime.js'), 'utf8');
  const appShell = appShellSource();
  const panels = specialistPanelsSource();
  const store = storeProcessSource();
  const main = mainProcessSource();
  const preload = fs.readFileSync(path.join(__dirname, '../preload.js'), 'utf8');
  const blockFeatures = fs.readFileSync(path.join(__dirname, '../src/editor/blockFeatures.jsx'), 'utf8');
  const editor = fs.readFileSync(path.join(__dirname, '../src/editor/editor.jsx'), 'utf8');
  const outliner = outlinerSource(__dirname);
  const slashCommands = fs.readFileSync(path.join(__dirname, '../src/features/editor/outliner/slashCommands.js'), 'utf8');
  const outline = fs.readFileSync(path.join(__dirname, '../src/editor/outline.jsx'), 'utf8');
  const notelist = fs.readFileSync(path.join(__dirname, '../src/panels/notelist.jsx'), 'utf8');
  const aiSource = backendAiSource(__dirname);
  const ai = rendererAiSource();
  const ollama = fs.readFileSync(path.join(__dirname, '../lib/ollama.js'), 'utf8');
  const helpers = appHelpersSource(__dirname);

  assert.match(helpers, /workflowArchived: !!note\.workflowArchived/);
  assert.match(helpers, /if \(note\.workflowArchived\) \{/);
  assert.match(helpers, /archivedNotes\.push/);
  assert.match(app, /const updateWorkflowArchived = useCallbackA/);
  assert.match(app, /archivedNotes=\{workflowViewData\.archivedNotes\}/);
  assert.match(app, /onSetWorkflowArchived=\{updateWorkflowArchived\}/);
  assert.match(appRuntime, /"workflowStates": null/);
  assert.match(app, /mnNormalizeWorkflowStatesForApp/);
  assert.match(app, /const normalWorkflowStates = useMemoA/);
  assert.match(app, /const novelistWorkflowStates = useMemoA/);
  assert.match(app, /activeVault\?\.novelistMode \? novelistWorkflowStates : normalWorkflowStates/);
  assert.match(app, /mnSetWorkflowStates\(workflowStates\)/);
  assert.match(app, /const updateWorkflowStates = useCallbackA/);
  assert.match(app, /saveVaultMeta\(activeVaultId, \{ workflowStates: next \}\)/);
  assert.match(app, /onWorkflowStatesChange=\{updateWorkflowStates\}/);
  assert.doesNotMatch(app, /countFor\('WAIT'\) \+ countFor\('LATER'\)/);
  assert.doesNotMatch(app, /countFor\('DONE'\) \+ countFor\('CANCELLED'\)/);

  assert.match(panels, /archivedNotes = \[\]/);
  assert.match(panels, /ArchiveButton/);
  assert.match(panels, /Archive note from workflow/);
  assert.match(panels, /Archived from workflow/);
  assert.match(panels, /\{showArchived \? <ArchivedWorkflowNotes/);
  assert.match(panels, /Restore/);
  assert.match(panels, /archiveNote\(note\.id, false\)/);
  assert.match(panels, /WorkflowStateManager/);
  assert.match(panels, /Array\.isArray\(states\) && states\.length === 0 \? \[\]/);
  assert.doesNotMatch(panels, /disabled=\{\(workflowStates \|\| \[\]\)\.length <= 1\}/);
  assert.match(appRuntime, /if \(Array\.isArray\(states\) && states\.length === 0\) return \[\]/);
  assert.match(blockFeatures, /if \(Array\.isArray\(states\) && states\.length === 0\) return \[\]/);
  assert.match(panels, /new column/);
  assert.match(panels, /addWorkflowState/);
  assert.match(panels, /removeWorkflowState/);
  assert.match(panels, /onWorkflowStatesChange && onWorkflowStatesChange/);
  assert.match(panels, /const \[dragOverState, setDragOverState\] = useStateP\(null\)/);
  assert.match(panels, /const \[dragPreview, setDragPreview\] = useStateP\(null\)/);
  assert.match(panels, /const dragItemRef = useRefP\(null\)/);
  assert.match(panels, /setActiveDragItem/);
  assert.match(panels, /clearActiveDragItem/);
  assert.match(panels, /updateDragPreview/);
  assert.match(panels, /setTransparentDragImage/);
  assert.match(panels, /const WorkflowDragPreview = \(\) =>/);
  assert.match(panels, /suppressCardClickRef/);
  assert.match(panels, /workflowStateFromPoint/);
  assert.match(panels, /beginCardPointerDrag/);
  assert.match(panels, /data-mn-workflow-state=\{state\.id\}/);
  assert.match(panels, /window\.addEventListener\('pointermove', onMove\)/);
  assert.match(panels, /onDragStart=\{\(e\) =>/);
  assert.match(panels, /e\.dataTransfer\.setData\('text\/mn-workflow', payload\)/);
  assert.match(panels, /onDrag=\{\(e\) =>/);
  assert.match(panels, /Release to move to \{state\.id\}/);
  assert.match(panels, /types\.includes\('text\/mn-note'\)/);
  assert.match(panels, /types\.includes\('text\/plain'\)/);
  assert.match(panels, /readDropNoteId/);
  assert.match(panels, /moveWorkflowNote\(noteId, null, state\.id\)/);
  assert.match(panels, /marginRight: 54/);
  assert.match(notelist, /draggable/);
  assert.match(notelist, /e\.dataTransfer\.setData\('text\/mn-note', payload\)/);
  assert.match(panels, /SummaryStat label="Columns"/);
  assert.match(panels, /SummaryStat label="Active cols"/);
  assert.doesNotMatch(panels, /const waitingCount = countFor\('WAIT'\) \+ countFor\('LATER'\)/);
  assert.doesNotMatch(panels, /const closedCount = countFor\('DONE'\) \+ countFor\('CANCELLED'\)/);

  assert.match(store, /workflowArchived: !!fm\.workflowArchived/);
  assert.match(store, /workflowArchived: !!note\.workflowArchived/);
  assert.match(blockFeatures, /mnNormalizeWorkflowStates/);
  assert.match(blockFeatures, /mnNormalizeWorkflowId/);
  assert.match(blockFeatures, /let MN_WORKFLOW_STATES = MN_DEFAULT_WORKFLOW_STATES/);
  assert.match(blockFeatures, /Object\.prototype\.hasOwnProperty\.call\(state \|\| \{\}, 'next'\)/);
  assert.match(blockFeatures, /Object\.prototype\.hasOwnProperty\.call\(fallback, 'next'\)/);
  assert.match(blockFeatures, /next: state\.next === undefined/);
  assert.match(blockFeatures, /safe\[index \+ 1\]\?\.id \|\| null/);
  assert.match(blockFeatures, /function mnWorkflowIsClosed\(state\)/);
  assert.match(blockFeatures, /mnWorkflowIsClosed,/);
  assert.match(blockFeatures, /mnSetWorkflowStates/);
  assert.match(blockFeatures, /DEFAULT_WORKFLOW_STATES/);
  assert.match(panels, /const isClosedState = mnWorkflowIsClosed/);
  assert.doesNotMatch(panels, /textDecoration: isClosedState\(state\) \? 'line-through' : 'none'/);
  assert.doesNotMatch(panels, /textDecoration:[\s\S]{0,80}line-through[\s\S]{0,80}No preview/);
  assert.doesNotMatch(panels, /state\.id === 'DONE' \|\| state\.id === 'CANCELLED'/);
  assert.match(slashCommands, /function workflowSlashCommands/);
  assert.match(slashCommands, /NOVELIST_SLASH_COMMANDS/);
  assert.match(slashCommands, /options\.novelistMode \? NOVELIST_SLASH_COMMANDS : \[\]/);
  assert.match(outliner, /plot-points/);
  assert.match(outliner, /One plot point per line/);
  assert.match(outliner, /updateBeatsText/);
  assert.doesNotMatch(outliner, /Add beat/);
  assert.doesNotMatch(outliner, /Remove beat/);
  assert.match(outliner, /Find page to link/);
  assert.match(outliner, /No available pages/);
  assert.match(outliner, /contexts: \[\.\.\.contexts, `\[\[\$\{title\}\]\]`\]/);
  assert.match(outliner, /aiActive=\{aiActive\}/);
  assert.match(outliner, /AI working/);
  assert.match(outliner, /mn-ai-live-dots/);
  assert.match(outliner, /function MnInlineAiPreview/);
  assert.match(outliner, /AI preview/);
  assert.match(outliner, /mnReportAiOutput\(/);
  assert.match(outliner, /Report AI output/);
  assert.match(outliner, /mn-inline-ai-preview-streaming/);
  assert.match(editor, /noteId=\{note\.id\}/);
  assert.match(outliner, /noteIdRef/);
  assert.match(outliner, /previewForCurrentNote/);
  assert.match(outliner, /makeAiPreview\(requestNoteId/);
  assert.match(outliner, /const pageContinuationInstruction/);
  assert.match(outliner, /Continue from the end of it/);
  assert.match(outliner, /const appendPageWrite = actionId === 'write' && pageBlocks\.length > 0/);
  assert.match(outliner, /const appendPageBlocks/);
  assert.match(outliner, /kind: 'append-page'/);
  assert.match(outliner, /appendPageBlocks\(preview\.text\)/);
  assert.match(outliner, /plotPointsAction: 'write-scene'/);
  assert.match(outliner, /const appendPlotWrite = payload\.plotPointsAction === 'write-scene'/);
  assert.match(outliner, /Existing page context/);
  assert.match(outliner, /appended to the bottom of the page/);
  assert.match(outliner, /function[^\n]*plotPointsInstruction|const plotPointsInstruction/);
  assert.match(outliner, /Linked context pages/);
  assert.match(outliner, /kind: 'insert-after'/);
  assert.match(outliner, /insertBlocksAfter\(preview\.target\.blockId, parseAiBlocks\(preview\.text\)\)/);
  assert.match(outliner, /platformApi\.ai\.editStream/);
  assert.match(preload, /editStream:\(payload = \{\}, onChunk\)/);
  assert.match(main, /mn:ai\.editStream/);
  assert.match(aiSource, /async function editTextStream/);
  assert.match(ollama, /async function chatStream/);
  assert.match(ai, /platformApi\.ai\?\.askStream/);
  assert.match(ai, /platformApi\.ai\?\.chatStream/);
  assert.match(ai, /function mnAskMessageId/);
  assert.match(ai, /key=\{m\.id\}/);
  assert.match(ai, /onToken: appendAssistantToken/);
  assert.match(preload, /askStream: \(vaultId, query, options = \{\}, onChunk\)/);
  assert.match(preload, /chatStream:\(payload = \{\}, onChunk\)/);
  assert.match(preload, /delete cleanOptions\.onToken/);
  assert.match(preload, /delete cleanPayload\.onToken/);
  assert.match(main, /mn:ai\.askStream/);
  assert.match(main, /mn:ai\.chatStream/);
  assert.match(main, /function sendIpcChunk/);
  assert.match(main, /evt\.sender\?\.isDestroyed\?\.\(\)/);
  assert.match(aiSource, /async function askStream/);
  assert.match(aiSource, /async function chatStream/);
  assert.match(ollama, /const CHAT_TIMEOUT_MS = 180000/);
  assert.match(outline, /import \{ MN_DEFAULT_WORKFLOW_STATES, MN_WORKFLOW_STATES \} from '\.\/blockFeatures\.jsx'/);
  assert.doesNotMatch(outline, /\^\(TODO\|DOING\|DONE\|LATER\|NOW\|WAIT\|CANCELLED\)/);
  assert.match(notelist, /const workflowPattern = states/);
  assert.doesNotMatch(notelist, /\^\(TODO\|DOING\|DONE\|LATER\|NOW\|WAIT\|CANCELLED\)/);
  assert.match(appShell, /function MnReminderCenter\(\{ open, items, dueCount, onToggle, onClose, onOpenNote, topOffset = 14, T \}\)/);
  assert.match(appShell, /position: 'fixed'/);
  assert.match(appShell, /top: topOffset/);
  assert.match(appShell, /maxWidth: 'calc\(100vw - 36px\)'/);
  assert.match(app, /const reminderCenterTop = view === 'ai' \? 17 : 14/);
  assert.match(app, /topOffset=\{reminderCenterTop\}/);
});

test('Stabilization wiring avoids stale UI and native dialogs', () => {
  const app = appSource(__dirname);
  const searchController = fs.readFileSync(path.join(__dirname, '../src/features/search/useSearchController.js'), 'utf8');
  const appRuntime = fs.readFileSync(path.join(__dirname, '../src/app/appRuntime.js'), 'utf8');
  const appShell = appShellSource();
  const appNovelistSource = fs.readFileSync(path.join(__dirname, '../src/app/appNovelist.js'), 'utf8');
  const panelHelpersSource = fs.readFileSync(path.join(__dirname, '../src/panels/panelHelpers.js'), 'utf8');
  const html = fs.readFileSync(path.join(__dirname, '../vispnote.html'), 'utf8');
  const rendererEntry = fs.readFileSync(projectPaths.src.main, 'utf8');
  const notelist = fs.readFileSync(path.join(__dirname, '../src/panels/notelist.jsx'), 'utf8');
  const editor = fs.readFileSync(path.join(__dirname, '../src/editor/editor.jsx'), 'utf8');
  const outliner = outlinerSource(__dirname);
  const slashCommands = fs.readFileSync(path.join(__dirname, '../src/features/editor/outliner/slashCommands.js'), 'utf8');
  const blockFeatures = fs.readFileSync(path.join(__dirname, '../src/editor/blockFeatures.jsx'), 'utf8');
  const panels = specialistPanelsSource();
  const store = storeProcessSource();
  const main = mainProcessSource();
  const preload = fs.readFileSync(path.join(__dirname, '../preload.js'), 'utf8');

  assert.match(appShell, /function MnAppNoticeDialog/);
  assert.match(html, /src="build\/renderer\/app\.js"/);
  assert.match(rendererEntry, /import \{ MnApp \} from '\.\/app\/app\.jsx'/);
  assert.match(appRuntime, /const MN_APP_HELPERS = require\('\.\/appHelpers\.js'\)/);
  assert.match(appRuntime, /const MN_APP_MUTATIONS = require\('\.\/appMutations\.js'\)/);
  assert.match(appRuntime, /const MN_APP_CANVAS_ACTIONS = require\('\.\/appCanvasActions\.js'\)/);
  assert.match(searchController, /const sequence = useRef\(0\)/);
  assert.match(searchController, /if \(requestId !== sequence\.current\) return/);
  assert.match(app, /Load first, then switch atomically/);
  assert.match(panelHelpersSource, /mnReadNovelistAiConfig, mnWriteNovelistAiConfig/);
  assert.match(app, /const duplicateNote = useCallbackA/);
  assert.match(app, /showAppNotice\('Could not create vault'/);
  assert.doesNotMatch(app, /alert\(/);
  assert.doesNotMatch(app, /window\.prompt/);

  assert.match(notelist, /onRenameNote/);
  assert.match(notelist, /onDuplicateNote/);
  assert.match(notelist, /onDeleteNote/);
  assert.match(notelist, /onContextMenu=\{\(e\) =>/);
  assert.match(editor, /onDuplicate/);
  assert.match(editor, /title="Duplicate note"/);

  assert.match(outliner, /const \[aiPrompt, setAiPrompt\]/);
  assert.match(outliner, /role="dialog"/);
  assert.match(slashCommands, /Marker: \$\{state\.id\}/);
  assert.doesNotMatch(outliner, /window\.prompt/);
  assert.match(blockFeatures, /Block marker/);

  assert.match(store, /novelistAiConfig/);
  assert.match(main, /function flushDirtyNotes/);
  assert.match(preload, /onFlushDirtyNotes/);
  assert.match(app, /onNew=\{\(\) => createNote\(\)\}/);
  assert.match(app, /const baseThemeMap = MN_THEMES/);
  assert.match(app, /const themeMap = useMemoA\(\(\) => \{/);
  assert.match(panels, /initialAiConfig = null/);
  assert.match(panels, /onAiConfigChange && onAiConfigChange\(next\)/);
  assert.match(appNovelistSource, /function mnReplaceWikiLinkTitle/);
  assert.match(app, /mnWriteNovelistAiConfig\(activeVault\.novelistAiConfig, activeVaultId\)/);
});

test('Markdown input rules load before outliner modules and stay renderer-scoped', () => {
  const outliner = outlinerSource(__dirname);
  const renderers = fs.readFileSync(path.join(__dirname, '../src/editor/outlinerRenderers.jsx'), 'utf8');
  const helper = fs.readFileSync(path.join(__dirname, '../src/editor/markdownInputRules.js'), 'utf8');
  const inlineRenderers = fs.readFileSync(path.join(__dirname, '../src/editor/markdownInlineRenderers.jsx'), 'utf8');

  assert.match(outliner, /import MN_MARKDOWN_INPUT_RULES from '\.\/markdownInputRules\.js'/);
  assert.match(inlineRenderers, /import MN_MARKDOWN_INPUT_RULES from '\.\/markdownInputRules\.js'/);
  assert.match(renderers, /from '\.\/markdownInlineRenderers\.jsx'/);
  assert.match(helper, /module\.exports = api/);
  assert.match(inlineRenderers, /function mnRenderMarkdownInlineText/);
  assert.match(inlineRenderers, /MN_MARKDOWN_INPUT_RULES\.parseInlineMarkdown/);
  assert.match(inlineRenderers, /platformApi\.app\.openExternal\(segment\.url\)/);
  assert.match(outliner, /MN_MARKDOWN_INPUT_RULES\.findBlockStarterConversion/);
  assert.match(outliner, /inputType: e\.nativeEvent\?\.inputType/);
  assert.match(outliner, /onChangeKind\(block\.id, blockStarter\.patch\)/);
  assert.match(outliner, /pendingCaretRef\.current = blockStarter\.caret/);
  assert.doesNotMatch(outliner, /shell\.openExternal|ipcRenderer|require\('electron'\)/);
  assert.match(renderers, /import \{ mnRenderAnnotated, mnRenderMarkdownInlineText, mnRenderSpecialInlineText \}/);
  assert.doesNotMatch(inlineRenderers, /shell\.openExternal|ipcRenderer|require\('electron'\)/);
  assert.doesNotMatch(renderers, /shell\.openExternal|ipcRenderer|require\('electron'\)/);
});

test('Markdown input rules preserve paste, slash menu, and selection formatting hooks', () => {
  const outliner = outlinerSource(__dirname);
  const handlePasteIndex = outliner.indexOf('const handlePaste = (e) =>');
  const inputRuleIndex = outliner.indexOf('MN_MARKDOWN_INPUT_RULES.findBlockStarterConversion');
  const slashIndex = outliner.indexOf('const sm = mnFindSlashCommandTrigger(v, pos)');
  const selectionIndex = outliner.indexOf('const applyAnnotation = (kind) =>');

  assert.ok(inputRuleIndex > 0);
  assert.ok(handlePasteIndex > inputRuleIndex);
  assert.match(outliner, /const markdown = mnClipboardEventToMarkdownTable && mnClipboardEventToMarkdownTable\(e\)/);
  assert.match(outliner, /parseClipboardBlocks\?\.\(e\.clipboardData, \{ allowSingle: false \}\)/);
  assert.match(outliner, /const sm = mnFindSlashCommandTrigger\(v, pos\)/);
  assert.ok(slashIndex > inputRuleIndex);
  assert.match(outliner, /if \(slashQ != null\)/);
  assert.match(outliner, /mnApplyAnnotationRange/);
  assert.ok(selectionIndex > 0);
  assert.doesNotMatch(outliner.slice(inputRuleIndex, handlePasteIndex), /parseInlineMarkdown|mnBlocksToMd|mnMdToBlocks/);
});

test('Markdown inline rendering is preserved when spellcheck issues are present', () => {
  const outliner = outlinerSource(__dirname);
  const inlineRenderers = fs.readFileSync(path.join(__dirname, '../src/editor/markdownInlineRenderers.jsx'), 'utf8');
  const spellcheck = fs.readFileSync(path.join(__dirname, '../src/features/editor/outliner/spellcheck.jsx'), 'utf8');

  assert.match(inlineRenderers, /function mnRenderMarkdownInlineText\(text, T, onOpen, onTagClick, allNotes, renderPlainText, baseOffset = 0, vaultId = ''\)/);
  assert.match(inlineRenderers, /renderPlainText\(segment\.text, textOffset\)/);
  assert.match(inlineRenderers, /mnRenderMarkdownInlineText\(sub, T, onOpen, onTagClick, allNotes, renderPlainText, seg\.s, vaultId\)/);
  assert.match(spellcheck, /function renderSpellCheckedText\(text, issues, theme, onOpenMenu, offset = 0\)/);
  assert.match(spellcheck, /start: baseOffset \+ start/);
  assert.match(outliner, /const renderSpellText = spellCheck && Object\.keys\(spellIssues \|\| \{\}\)\.length/);
  assert.match(outliner, /mnRenderAnnotated\(content, displayAnnotations, T, onOpen, onTagClick, allNotes, renderSpellText, vaultId\)/);
  assert.doesNotMatch(outliner, /return mnRenderSpellCheckedText\(content, spellIssues, T, setSpellMenu\)/);
});

test('Structural markdown blocks edit with markdown source prefixes', () => {
  const outliner = outlinerSource(__dirname);
  const helper = fs.readFileSync(path.join(__dirname, '../src/editor/markdownInputRules.js'), 'utf8');
  const outline = fs.readFileSync(path.join(__dirname, '../src/editor/outline.jsx'), 'utf8');

  assert.match(helper, /function editableMarkdownForBlock/);
  assert.match(helper, /function parseEditableMarkdownBlock/);
  assert.match(helper, /function displayProjectionForMarkdownSourceBlock/);
  assert.ok(helper.includes('value.match(/^(#{1,6})\\s(.*)$/s)'));
  assert.ok(helper.includes('value.match(/^(#{1,6})\\s+(.*)$/s)'));
  assert.ok(outline.includes('const h = line.match(/^(#{1,6})\\s+(.*)$/);'));
  assert.match(outliner, /const editorValue = MN_MARKDOWN_INPUT_RULES\.editableMarkdownForBlock\?\.\(block\) \?\? block\.content/);
  assert.match(outliner, /const markdownDisplayProjection = MN_MARKDOWN_INPUT_RULES\.displayProjectionForMarkdownSourceBlock\?\.\(block\)/);
  assert.match(outliner, /const displayBlock = markdownDisplayProjection\?\.block \|\| block/);
  assert.match(outliner, /value=\{editorValue\}/);
  assert.match(outliner, /MN_MARKDOWN_INPUT_RULES\.parseEditableMarkdownBlock\?\.\(\{ block, text: v \}\)/);
  assert.match(outliner, /contentOffsetToEditorOffset\?\.\(block, contentCaret\)/);
  assert.match(outliner, /editorOffsetToContentOffset\?\.\(block, ta\?\.selectionStart/);
  assert.match(outliner, /displaySourceOffset \+ contentCaret/);
  assert.match(outliner, /mnRenderAnnotated\(content, displayAnnotations, T, onOpen, onTagClick, allNotes, renderSpellText, vaultId\)/);
});
