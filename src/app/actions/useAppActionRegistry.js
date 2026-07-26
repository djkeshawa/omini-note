import { buildDynamicActions } from './buildDynamicActions.js';
import { createActionResolvers } from './actionResolvers.js';
import { shortcutLabel, useShortcutPlatform } from '../../platform/shortcuts.js';

const { useMemo } = React;

export function useAppActionRegistry(ctx) {
  const shortcutPlatform = useShortcutPlatform();
  const {
    activeCanvas, activeVault, activeVaultId, addNoteToCanvas, canvases, closeReferencePane,
    createCanvas, createDailyNote, createNote, createNoteFromTemplate, deleteCanvas, deleteNote,
    duplicateNote, exportBackup, importBackup, markDirty, notesWithBody, openAskAi, openCanvas,
    openCanvasDashboard, openReferencePane, openSmartView, plugins, rebuildIndex, recordPhase5Metric,
    referencePaneOpen, restoreDeletedNote, runPlugin, selectVault, selectedNote, smartViewDefinitions,
    uniqueNoteTitle, updateNote, updateNoteBody, updateWorkflowArchived, updateWorkflowNoteStatus,
    vaultsForSidebar, workflowStates, navigateView, showAppNotice, appActionsFactory, appHelpers,
    appMutations, hasDisk, platform, setNotes, setSelectedTag, setSelectedWorkflow, setCaptureOpen,
    setSettingsOpen, setVaultHealthOpen, normalizeNotes, markdownToBlocks,
    setConnectionsRefreshToken, memoryActions, renameNoteTitle, setSelectedId, addTag,
    normalizeTagName, normalizeNoteStatus, pluginApi, noteTemplates,
    featureRegistry, featureState,
  } = ctx;
  const MN_APP_ACTIONS_FACTORY = appActionsFactory;
  const MN_APP_HELPERS = appHelpers;
  const MN_APP_MUTATIONS = appMutations;
  const MN_MEMORY_ACTIONS = memoryActions;
  const MN_PLUGIN_API = pluginApi;
  const MN_NOTE_TEMPLATES = noteTemplates;
  const MN_FEATURES = featureRegistry;
  const HAS_DISK = hasDisk;
  const desktopBridge = platform;
  const mnMdToBlocks = markdownToBlocks;
  const mnNormalizeNoteStatus = normalizeNoteStatus;
  return useMemo(() => {
    const makeRegistry = MN_APP_ACTIONS_FACTORY.createRegistry || ((actions) => ({
      list: () => actions,
      run: (id) => actions.find(action => action.id === id)?.run?.(),
      preview: () => null,
      describeForAi: () => [],
      findForText: () => null,
    }));
    const stringArg = (maxLength = 160) => ({ type: 'string', maxLength });
    const integerArg = (defaultValue = 8) => ({ type: 'integer', default: defaultValue });
    const objectSchema = (properties = {}, required = []) => ({ type: 'object', properties, required, additionalProperties: false });
    const zoteroReaderEnabled = plugins.some(plugin => plugin.enabled !== false && plugin.type === 'zotero-reader');
    const {
      byNoteId,
      noteTitleArg,
      noteByTitle,
      currentOrArgNote,
      metadataNote,
      writableMetadataNote,
      writableBodyNote,
      noteAffected,
    } = createActionResolvers(notesWithBody, selectedNote);
    const updateNoteTagsById = (noteId, updater) => {
      if (!noteId) return;
      setNotes(ns => ns.map(note => {
        if (note.id !== noteId) return note;
        const nextTags = typeof updater === 'function' ? updater(note.tags || []) : updater;
        return MN_APP_MUTATIONS.applyNotePatch(note, { tags: Array.isArray(nextTags) ? nextTags : [] });
      }));
      markDirty(noteId);
    };
    const appendToBody = (note, content) => {
      const clean = String(content || '').trim();
      if (!note || !clean) return false;
      updateNoteBody(note.id, body => {
        const base = String(body || '').trimEnd();
        return `${base}${base ? '\n' : ''}${clean}`;
      });
      return true;
    };
    const cleanWikiTitle = (title) => String(title || '')
      .trim()
      .replace(/^\[\[|\]\]$/g, '')
      .replace(/[#[\]\n\r]/g, '')
      .slice(0, 180);
    const resolveCanvas = (args = {}) => {
      if (args.canvasId) return (canvases || []).find(item => item.id === args.canvasId) || null;
      const title = String(args.canvasTitle || args.title || '').trim().toLowerCase();
      if (!title) return activeCanvas || null;
      return (canvases || []).find(item => String(item.title || '').trim().toLowerCase() === title)
        || (canvases || []).find(item => String(item.title || '').trim().toLowerCase().includes(title))
        || null;
    };
    const resolveVault = (args = {}) => {
      const id = String(args.vaultId || '').trim();
      if (id) return vaultsForSidebar.find(vault => vault.id === id) || null;
      const name = String(args.vaultName || args.name || '').trim().toLowerCase();
      if (!name) return activeVault || null;
      return vaultsForSidebar.find(vault => String(vault.name || '').trim().toLowerCase() === name)
        || vaultsForSidebar.find(vault => String(vault.name || '').trim().toLowerCase().includes(name))
        || null;
    };
    const scoreNoteForQuery = (note, terms) => {
      const title = String(note.title || '').toLowerCase();
      const tags = (note.tags || []).join(' ').toLowerCase();
      const body = String(note.body || '').toLowerCase();
      let score = 0;
      for (const term of terms) {
        if (!term) continue;
        if (title.includes(term)) score += 12;
        if (tags.includes(term)) score += 8;
        if (body.includes(term)) score += 2;
      }
      return score;
    };
    const searchNotesFast = async (query, limit = 8) => {
      const cleanQuery = String(query || '').trim();
      const max = Math.max(1, Math.min(Number(limit) || 8, 30));
      if (!cleanQuery) return [];
      if (HAS_DISK && activeVaultId && desktopBridge.search?.searchDetailedStatus) {
        try {
          const res = await desktopBridge.search.searchDetailedStatus(activeVaultId, cleanQuery, max);
          const value = res?.value;
          const rows = Array.isArray(value?.results) ? value.results
            : Array.isArray(value?.value?.results) ? value.value.results
              : Array.isArray(value) ? value
                : [];
          if (rows.length) {
            return rows.slice(0, max).map(row => ({
              id: row.id || row.noteId,
              title: row.title || 'Untitled',
              snippet: row.snippet || row.preview || row.bodySnippet || '',
              score: Number(row.score || row.rank || 0),
            })).filter(row => row.id);
          }
        } catch (e) {
          // Fall back to the in-memory search below; command execution should stay fast.
        }
      }
      const terms = cleanQuery.toLowerCase().split(/[^a-z0-9_-]+/).filter(Boolean);
      return notesWithBody
        .map(note => ({
          id: note.id,
          title: note.title || 'Untitled',
          snippet: String(note.body || '').replace(/\s+/g, ' ').trim().slice(0, 220),
          score: scoreNoteForQuery(note, terms),
        }))
        .filter(row => row.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, max);
    };
    const clearFilters = () => { setSelectedTag(null); setSelectedWorkflow(null); };
    const openView = (nextView) => {
      clearFilters();
      navigateView(nextView);
      return { message: `Opened ${nextView}.` };
    };
    const noteActionSchema = objectSchema({ noteId: stringArg(120), noteTitle: stringArg(180) });
    const titleActionSchema = objectSchema({ noteId: stringArg(120), noteTitle: stringArg(180), title: stringArg(180) }, ['title']);
    const tagActionSchema = objectSchema({ noteId: stringArg(120), noteTitle: stringArg(180), tag: stringArg(64) }, ['tag']);
    const canvasActionSchema = objectSchema({ canvasId: stringArg(120), canvasTitle: stringArg(180), title: stringArg(180) });
    const vaultActionSchema = objectSchema({ vaultId: stringArg(120), vaultName: stringArg(180), name: stringArg(180) });

    const actions = [
      {
        id: 'new-note',
        label: 'New note',
        description: 'Create a blank note or a note with a supplied title, body, and tags.',
        section: 'Create',
        shortcut: shortcutLabel('newNote', shortcutPlatform, { compact: true }),
        keywords: 'page capture create',
        inputSchema: objectSchema({ title: stringArg(180), body: stringArg(20000), tags: { type: 'array', items: stringArg(64) }, open: { type: 'boolean' } }),
        run: (args) => {
          const title = args.title || undefined;
          const id = createNote({ title, body: args.body || '', tags: args.tags || [] }, { open: args.open !== false });
          return { title: 'Note created', message: `Created "${title || 'Untitled'}".`, affected: [{ type: 'note', id, title: title || 'Untitled' }] };
        },
      },
      {
        id: 'quick-capture',
        label: 'Quick capture',
        description: 'Open the quick capture dialog.',
        section: 'Create',
        shortcut: shortcutLabel('quickCapture', shortcutPlatform, { compact: true }),
        keywords: 'inbox capture',
        inputSchema: objectSchema(),
        run: () => { setCaptureOpen(true); return { message: 'Opened quick capture.' }; },
      },
      {
        id: 'daily-note',
        label: 'Open daily note',
        description: 'Open or create today’s daily note.',
        section: 'Create',
        keywords: 'today journal daily',
        inputSchema: objectSchema(),
        run: () => {
          const id = createDailyNote();
          return { message: 'Opened daily note.', affected: id ? [{ type: 'note', id, title: 'Daily note' }] : [] };
        },
      },
      {
        id: 'reference-pane',
        label: referencePaneOpen ? 'Close reference pane' : 'Open reference pane',
        description: 'Keep one note visible beside the editor without opening a second workspace.',
        section: 'Navigate',
        shortcut: shortcutLabel('referencePane', shortcutPlatform, { compact: true }),
        keywords: 'side by side read companion note',
        enabled: notesWithBody.length > 0,
        inputSchema: noteActionSchema,
        run: args => {
          if (referencePaneOpen) {
            closeReferencePane();
            return { message: 'Closed reference pane.' };
          }
          const target = args.noteId || args.noteTitle ? currentOrArgNote(args) : null;
          return openReferencePane(target?.id || '');
        },
      },
      {
        id: 'ask-ai',
        label: 'Ask AI',
        description: 'Open the Ask AI workspace.',
        section: 'AI',
        shortcut: shortcutLabel('askAi', shortcutPlatform, { compact: true }),
        keywords: 'assistant chat',
        enabled: HAS_DISK,
        aiHidden: true,
        inputSchema: objectSchema({ query: stringArg(1000) }),
        run: (args) => { openAskAi(args.query || ''); return { message: 'Opened Ask AI.' }; },
      },
      {
        id: 'settings',
        label: 'Open settings',
        description: 'Open settings, optionally with a named section request.',
        section: 'System',
        keywords: 'preferences configuration',
        inputSchema: objectSchema({ section: stringArg(80) }),
        run: () => { setSettingsOpen(true); return { message: 'Opened settings.' }; },
      },
      { id: 'graph', label: 'Open graph', description: 'Show the note graph.', section: 'Navigate', shortcut: shortcutLabel('graph', shortcutPlatform, { compact: true }), inputSchema: objectSchema(), run: () => openView('graph') },
      { id: 'calendar', label: 'Open agenda', description: 'Show scheduled todos and reminders.', section: 'Navigate', keywords: 'calendar schedule agenda reminder date', inputSchema: objectSchema(), run: () => openView('calendar') },
      { id: 'today', label: 'Open today', description: 'Show the Today dashboard.', section: 'Navigate', inputSchema: objectSchema(), run: () => openView('today') },
      { id: 'smart-views', label: 'Open smart views', description: 'Show saved Smart View dashboards.', section: 'Navigate', keywords: 'saved smart views dashboard query tasks reminders', inputSchema: objectSchema(), run: () => openSmartView() },
      { id: 'todos', label: 'Open agenda', description: 'Open the calendar planner for tasks and reminders.', section: 'Navigate', keywords: 'tasks checklist todos agenda calendar', hidden: true, aiHidden: true, inputSchema: objectSchema(), run: () => openView('calendar') },
      { id: 'canvas', label: 'Open canvas dashboard', description: 'Open the canvas dashboard.', section: 'Navigate', inputSchema: objectSchema(), run: () => { openCanvasDashboard(); return { message: 'Opened canvas dashboard.' }; } },
      ...smartViewDefinitions.map(definition => ({
        id: `smart-view-${definition.id}`,
        label: `Open ${definition.title}`,
        description: 'Open a saved Smart View.',
        section: 'Smart Views',
        keywords: `smart view saved dashboard ${definition.type || ''}`,
        inputSchema: objectSchema(),
        run: () => openSmartView(definition.id),
      })),
      {
        id: 'vault-health',
        label: 'Open vault health',
        description: 'Open vault health diagnostics.',
        section: 'Vault',
        enabled: HAS_DISK,
        inputSchema: objectSchema(),
        run: () => { setVaultHealthOpen(true); return { message: 'Opened vault health.' }; },
      },
      {
        id: 'export-backup',
        label: 'Export backup',
        description: 'Export a backup through the operating system save dialog.',
        section: 'Vault',
        risk: 'external',
        enabled: HAS_DISK,
        inputSchema: objectSchema(),
        preview: () => ({ title: 'Export backup', message: 'VispNote will open a save dialog and write a backup file to the selected location.', steps: ['Open save dialog', 'Write backup JSON'], affected: [{ type: 'vault', id: activeVaultId, title: activeVault?.name || activeVaultId }] }),
        run: async () => { await exportBackup(); return { message: 'Backup export finished or was cancelled.' }; },
      },
      ...['md', 'html', 'pdf'].map(format => ({
        id: `export-note-${format}`,
        label: `Export note as ${format === 'md' ? 'Markdown' : format.toUpperCase()}`,
        description: `Export the current note to a ${format === 'md' ? 'Markdown' : format.toUpperCase()} file through the operating system save dialog.`,
        section: 'Note',
        risk: 'external',
        enabled: HAS_DISK && !!selectedNote,
        inputSchema: objectSchema(),
        preview: () => ({
          title: `Export note as ${format.toUpperCase()}`,
          message: 'VispNote will open a save dialog and write the exported file to the selected location.',
          steps: ['Open save dialog', `Write ${format.toUpperCase()} file`],
          affected: noteAffected(selectedNote),
        }),
        run: async () => {
          if (!selectedNote) return { message: 'No note is selected.' };
          const res = await desktopBridge.notes.exportNote(activeVaultId, selectedNote.id, format);
          if (res?.ok === false) throw new Error(res.error || 'Export failed');
          return { message: res?.value?.canceled ? 'Export cancelled.' : `Note exported to ${res?.value?.filePath || 'file'}.` };
        },
      })),
      {
        id: 'memory-import',
        label: 'Import memories as notes',
        description: 'Pull memories from the local llm-memory server into this vault as editable notes with provenance.',
        section: 'Memory',
        enabled: HAS_DISK && plugins.some(plugin => plugin.enabled !== false && plugin.type === 'llm-memory'),
        inputSchema: objectSchema(),
        preview: () => ({
          title: 'Import memories as notes',
          message: 'VispNote will fetch memories from the local llm-memory server and create a note per memory. Existing memory notes are never overwritten.',
          steps: ['Fetch memories from 127.0.0.1', 'Create missing memory notes', 'Index new notes'],
          affected: [{ type: 'vault', id: activeVaultId, title: activeVault?.name || activeVaultId }],
        }),
        run: async () => {
          const res = await desktopBridge.integrations.memory.import(activeVaultId);
          if (res?.ok === false) throw new Error(res.error || 'Memory import failed');
          const value = res?.value || {};
          const created = Array.isArray(value.notes) ? normalizeNotes(value.notes, mnMdToBlocks) : [];
          if (created.length) setNotes(ns => [...created, ...ns]);
          return { message: `Imported ${value.imported || 0} memor${(value.imported || 0) === 1 ? 'y' : 'ies'} (${value.skipped || 0} already present).` };
        },
      },
      {
        id: 'memory-remember',
        label: 'Remember this note',
        description: 'Distill the current note into the local llm-memory server so agents can recall it.',
        section: 'Memory',
        risk: 'confirm',
        enabled: HAS_DISK && !!selectedNote && plugins.some(plugin => plugin.enabled !== false && plugin.type === 'llm-memory'),
        inputSchema: objectSchema(),
        preview: () => ({
          title: 'Remember this note',
          message: 'VispNote will send this note\'s title and body to the local llm-memory server as a new memory.',
          steps: ['Send note content to 127.0.0.1', 'Store as an episodic memory'],
          affected: noteAffected(selectedNote),
        }),
        run: async () => {
          if (!selectedNote) return { message: 'No note is selected.' };
          const res = await desktopBridge.integrations.memory.remember(activeVaultId, selectedNote.id);
          if (res?.ok === false) throw new Error(res.error || 'Could not store the memory');
          setConnectionsRefreshToken(token => token + 1);
          return { message: `Stored “${selectedNote.title || 'Untitled'}” as memory ${res?.value?.id ? res.value.id.slice(0, 8) : ''}.` };
        },
      },
      {
        id: 'memory-sync-links',
        label: 'Sync note links to memory graph',
        description: 'Add or refresh this vault\'s current [[wiki-links]] in the llm-memory graph without overwriting unrelated relationships.',
        section: 'Memory',
        enabled: HAS_DISK && plugins.some(plugin => plugin.enabled !== false && plugin.type === 'llm-memory'),
        inputSchema: objectSchema(),
        preview: () => ({
          title: 'Sync note links to memory graph',
          message: 'VispNote adds new relationships and refreshes weights on relationships it previously managed. Unrelated relationships are preserved. Removed wiki-links are reported as stale because the current memory server cannot delete relationships.',
          steps: ['Map remembered notes within this vault', 'Resolve and weight current [[wiki-links]]', 'Create or refresh VispNote-managed relationships on 127.0.0.1'],
          affected: [{ type: 'vault', id: activeVaultId, title: activeVault?.name || activeVaultId }],
        }),
        run: async () => {
          const res = await desktopBridge.integrations.memory.syncLinks(activeVaultId);
          if (res?.ok === false) throw new Error(res.error || 'Link sync failed');
          const value = res?.value || {};
          setConnectionsRefreshToken(token => token + 1);
          return { message: MN_MEMORY_ACTIONS.syncResultMessage(value) };
        },
      },
      {
        id: 'memory-insights',
        label: 'Memory graph insights',
        description: 'Show a health summary of the local llm-memory knowledge graph: memories, relationships, and duplicate candidates.',
        section: 'Memory',
        enabled: HAS_DISK && plugins.some(plugin => plugin.enabled !== false && plugin.type === 'llm-memory'),
        inputSchema: objectSchema(),
        preview: () => ({
          title: 'Memory graph insights',
          message: 'VispNote will fetch a summary report from the local llm-memory server: total memories and relationships, active intents, and duplicate candidates.',
          steps: ['Fetch memory-intelligence report from 127.0.0.1', 'Fetch duplicate candidates', 'Summarize'],
          affected: [],
        }),
        run: async () => {
          const [reportRes, dupRes] = await Promise.all([
            desktopBridge.integrations.memory.intelligence({ limit: 5 }),
            desktopBridge.integrations.memory.duplicates({ limit: 20 }),
          ]);
          return { message: MN_MEMORY_ACTIONS.insightsResultMessage(reportRes, dupRes) };
        },
      },
      {
        id: 'import-backup',
        label: 'Import backup',
        description: 'Import a backup into new vaults through the operating system open dialog.',
        section: 'Vault',
        risk: 'destructive',
        enabled: HAS_DISK,
        inputSchema: objectSchema(),
        preview: () => ({ title: 'Import backup', message: 'VispNote will read a selected backup file and create imported vaults.', steps: ['Open file dialog', 'Read backup JSON', 'Create imported vaults'], affected: [{ type: 'vault', id: activeVaultId, title: activeVault?.name || activeVaultId }] }),
        run: async () => { await importBackup(); return { message: 'Backup import finished or was cancelled.' }; },
      },
      {
        id: 'rebuild-index',
        label: 'Rebuild search index',
        description: 'Rebuild the full text search index for the active vault.',
        section: 'Vault',
        enabled: HAS_DISK,
        inputSchema: objectSchema(),
        run: async () => { await rebuildIndex(); return { message: 'Search index rebuild requested.' }; },
      },
      {
        id: 'ai-backfill',
        label: 'Refresh AI index',
        description: 'Backfill missing embeddings for the active vault.',
        section: 'AI',
        enabled: HAS_DISK,
        inputSchema: objectSchema(),
        run: async () => {
          const res = await desktopBridge?.ai?.backfill?.(activeVaultId);
          if (res && !res.ok) throw new Error(res.error || 'AI index backfill failed');
          const value = res?.value || {};
          const embedded = Number(value.embedded || 0);
          showAppNotice('AI index refreshed', value.reason || `${embedded} note${embedded === 1 ? '' : 's'} embedded.`, value.ok === false ? 'warn' : 'info');
          return { message: value.reason || `AI index refreshed (${embedded} embedded).` };
        },
      },
      {
        id: 'rename-note',
        label: 'Rename note',
        description: 'Rename a note and update wiki links that point to its old title.',
        section: 'Notes',
        risk: 'confirm',
        inputSchema: titleActionSchema,
        preview: (args) => {
          const note = currentOrArgNote(args);
          return { title: 'Rename note', message: `Rename "${note?.title || 'current note'}" to "${args.title}".`, steps: ['Rename note title', 'Update matching wiki links'], affected: noteAffected(note) };
        },
        run: (args) => {
          const note = currentOrArgNote(args);
          if (!note) return { ok: false, message: 'No note is available to rename.' };
          renameNoteTitle(note.id, args.title);
          return { message: `Renamed "${note.title || 'Untitled'}" to "${args.title}".`, affected: noteAffected({ ...note, title: args.title }) };
        },
      },
      {
        id: 'duplicate-note',
        label: 'Duplicate note',
        description: 'Duplicate the current or selected note.',
        section: 'Notes',
        inputSchema: noteActionSchema,
        run: (args) => {
          const note = currentOrArgNote(args);
          if (!note) return { ok: false, message: 'No note is available to duplicate.' };
          const id = duplicateNote(note.id);
          return { title: 'Note duplicated', message: `Duplicated "${note.title || 'Untitled'}".`, affected: [{ type: 'note', id, title: `${note.title || 'Untitled'} copy` }] };
        },
      },
      {
        id: 'delete-note',
        label: 'Delete note',
        description: 'Move the current or selected note to recently deleted.',
        section: 'Notes',
        risk: 'destructive',
        inputSchema: noteActionSchema,
        preview: (args) => {
          const note = currentOrArgNote(args);
          return { title: 'Delete note', message: `Move "${note?.title || 'current note'}" to recently deleted.`, steps: ['Remove note from the active vault', 'Keep it recoverable in trash'], affected: noteAffected(note) };
        },
        run: async (args) => {
          const note = currentOrArgNote(args);
          if (!note) return { ok: false, message: 'No note is available to delete.' };
          await deleteNote(note.id);
          return { message: `Deleted "${note.title || 'Untitled'}".`, affected: noteAffected(note) };
        },
      },
      {
        id: 'search-notes',
        label: 'Search notes',
        description: 'Search note titles, tags, and indexed content for matching notes. Use this before editing or linking when the target note is not explicit.',
        section: 'Notes',
        kind: 'read',
        readOnly: true,
        idempotent: true,
        keywords: 'find lookup content semantic keyword vector full text',
        examples: ['search notes for reading list', 'find notes about quarterly planning'],
        inputSchema: objectSchema({ query: stringArg(500), limit: integerArg(8) }, ['query']),
        outputSchema: objectSchema({ results: { type: 'array', items: { type: 'object', additionalProperties: true } } }),
        run: async (args) => {
          const results = await searchNotesFast(args.query, args.limit || 8);
          const affected = results.map(row => ({ type: 'note', id: row.id, title: row.title || 'Untitled' }));
          return {
            title: 'Search complete',
            message: results.length ? `Found ${results.length} matching note${results.length === 1 ? '' : 's'}.` : 'No matching notes found.',
            affected,
            results,
          };
        },
      },
      {
        id: 'read-note',
        label: 'Read note',
        description: 'Read a note by note id or note title before deciding what action to take.',
        section: 'Notes',
        kind: 'read',
        readOnly: true,
        idempotent: true,
        requires: ['noteId or noteTitle'],
        examples: ['read Daily Updates Checklist', 'inspect the note called Project Plan'],
        inputSchema: objectSchema({ noteId: stringArg(120), noteTitle: stringArg(180) }),
        outputSchema: objectSchema({ note: { type: 'object', additionalProperties: true } }),
        run: (args) => {
          const note = currentOrArgNote(args);
          if (!note) return { ok: false, message: noteTitleArg(args) ? `Could not find a note matching "${noteTitleArg(args)}".` : 'No note was specified.' };
          return {
            title: 'Note read',
            message: `Read "${note.title || 'Untitled'}".`,
            affected: noteAffected(note),
            note: {
              id: note.id,
              title: note.title || 'Untitled',
              tags: note.tags || [],
              modifiedAt: note.modifiedAt || note.date || null,
              body: String(note.body || '').slice(0, 12000),
            },
          };
        },
      },
      {
        id: 'open-note',
        label: 'Open note',
        description: 'Open a note by note id or note title.',
        section: 'Notes',
        kind: 'read',
        readOnly: true,
        idempotent: true,
        requires: ['noteId or noteTitle'],
        examples: ['open Daily Updates Checklist', 'show the note called Project Plan'],
        inputSchema: objectSchema({ noteId: stringArg(120), noteTitle: stringArg(180) }),
        run: (args) => {
          const note = currentOrArgNote(args);
          if (!note) return { ok: false, message: noteTitleArg(args) ? `Could not find a note matching "${noteTitleArg(args)}".` : 'No note was specified.' };
          setSelectedId(note.id);
          navigateView('notes');
          return { message: `Opened "${note.title || 'Untitled'}".`, affected: noteAffected(note) };
        },
      },
      {
        id: 'append-to-note',
        label: 'Append to note',
        description: 'Append plain Markdown content to the current or selected note.',
        section: 'Notes',
        kind: 'write',
        requires: ['current note unless noteId or noteTitle is provided'],
        examples: ['append these meeting notes to the current note'],
        inputSchema: objectSchema({ noteId: stringArg(120), noteTitle: stringArg(180), content: stringArg(20000) }, ['content']),
        run: (args) => {
          const note = writableBodyNote(args);
          if (!note) return { ok: false, message: noteTitleArg(args) ? `Could not find a note matching "${noteTitleArg(args)}".` : 'No note is available to update.' };
          if (!appendToBody(note, args.content)) return { ok: false, message: 'There is no content to append.' };
          return { message: `Updated "${note.title || 'Untitled'}".`, affected: noteAffected(note) };
        },
      },
      {
        id: 'add-todo-to-note',
        label: 'Add todo to note',
        description: 'Append a Markdown todo item to the current or selected note.',
        section: 'Notes',
        kind: 'write',
        requires: ['current note unless noteId or noteTitle is provided'],
        examples: ['add todo call Nimal to this note', 'add a task to follow up on the draft'],
        inputSchema: objectSchema({ noteId: stringArg(120), noteTitle: stringArg(180), text: stringArg(500) }, ['text']),
        run: (args) => {
          const note = writableBodyNote(args);
          if (!note) return { ok: false, message: noteTitleArg(args) ? `Could not find a note matching "${noteTitleArg(args)}".` : 'No note is available to update.' };
          const text = String(args.text || '').replace(/^\s*[-*]\s+\[[ xX]\]\s*/, '').trim();
          if (!text) return { ok: false, message: 'Todo text is empty.' };
          appendToBody(note, `- [ ] ${text}`);
          return { message: `Added a todo to "${note.title || 'Untitled'}".`, affected: noteAffected(note) };
        },
      },
      {
        id: 'add-reminder-to-note',
        label: 'Add reminder to note',
        description: 'Append a todo-style reminder to the current or selected note. Date and time can be supplied when the user gives them.',
        section: 'Notes',
        kind: 'write',
        requires: ['current note unless noteId or noteTitle is provided'],
        examples: ['remind me to renew the license tomorrow', 'add reminder follow up on invoice on 2026-05-20'],
        inputSchema: objectSchema({ noteId: stringArg(120), noteTitle: stringArg(180), text: stringArg(500), date: stringArg(80), time: stringArg(40) }, ['text']),
        run: (args) => {
          const note = writableBodyNote(args);
          if (!note) return { ok: false, message: noteTitleArg(args) ? `Could not find a note matching "${noteTitleArg(args)}".` : 'No note is available to update.' };
          const text = String(args.text || '').replace(/^\s*[-*]\s+\[[ xX]\]\s*/, '').trim();
          if (!text) return { ok: false, message: 'Reminder text is empty.' };
          const date = String(args.date || '').trim();
          const time = String(args.time || '').trim();
          const suffix = [date, time].filter(Boolean).join(' ');
          appendToBody(note, `- [ ] ${text}${suffix ? ` @remind ${suffix}` : ' @remind'}`);
          return { message: `Added a reminder to "${note.title || 'Untitled'}".`, affected: noteAffected(note) };
        },
      },
      {
        id: 'link-note',
        label: 'Link note',
        description: 'Add a wiki link from the current or selected note to another note title.',
        section: 'Notes',
        kind: 'write',
        requires: ['current note unless noteId or noteTitle is provided', 'target note title'],
        examples: ['link this note to Reading List', 'connect the current note with Project Plan'],
        inputSchema: objectSchema({ noteId: stringArg(120), noteTitle: stringArg(180), targetTitle: stringArg(180) }, ['targetTitle']),
        run: (args) => {
          const note = writableBodyNote(args);
          if (!note) return { ok: false, message: noteTitleArg(args) ? `Could not find a note matching "${noteTitleArg(args)}".` : 'No note is available to update.' };
          const targetTitle = cleanWikiTitle(args.targetTitle);
          if (!targetTitle) return { ok: false, message: 'Target note title is empty.' };
          const link = `[[${targetTitle}]]`;
          if (String(note.body || '').includes(link)) {
            return { message: `"${note.title || 'Untitled'}" already links to "${targetTitle}".`, affected: noteAffected(note) };
          }
          appendToBody(note, `Related: ${link}`);
          const target = notesWithBody.find(item => String(item.title || '').toLowerCase() === targetTitle.toLowerCase());
          return {
            message: `Linked "${note.title || 'Untitled'}" to "${targetTitle}".`,
            affected: [...noteAffected(note), ...noteAffected(target)],
          };
        },
      },
      {
        id: 'tag-note',
        label: 'Tag note',
        description: 'Apply a tag to the current, selected, or named note.',
        section: 'Notes',
        requires: ['current note unless noteId or noteTitle is provided'],
        examples: ['tag this note under reading', 'tag Daily update checklist as todo'],
        inputSchema: tagActionSchema,
        run: (args) => {
          const note = writableMetadataNote(args);
          if (!note) return { ok: false, message: noteTitleArg(args) ? `Could not find a note matching "${noteTitleArg(args)}".` : 'No note is available to tag.' };
          const clean = addTag(args.tag);
          if (!clean) return { ok: false, message: 'Tag name is empty.' };
          if (!(note.tags || []).includes(clean)) updateNoteTagsById(note.id, tags => tags.includes(clean) ? tags : [...tags, clean]);
          return { message: (note.tags || []).includes(clean) ? `"${note.title}" already has #${clean}.` : `Tagged "${note.title}" with #${clean}.`, affected: noteAffected(note) };
        },
      },
      {
        id: 'untag-note',
        label: 'Remove note tag',
        description: 'Remove a tag from the current, selected, or named note.',
        section: 'Notes',
        requires: ['current note unless noteId or noteTitle is provided'],
        inputSchema: tagActionSchema,
        run: (args) => {
          const note = writableMetadataNote(args);
          if (!note) return { ok: false, message: noteTitleArg(args) ? `Could not find a note matching "${noteTitleArg(args)}".` : 'No note is available to untag.' };
          const clean = normalizeTagName(args.tag);
          updateNoteTagsById(note.id, tags => tags.filter(tag => tag !== clean));
          return { message: `Removed #${clean} from "${note.title}".`, affected: noteAffected(note) };
        },
      },
      {
        id: 'set-workflow-status',
        label: 'Set workflow status',
        description: 'Set the workflow status property on the current, selected, or named note.',
        section: 'Workflow',
        keywords: 'todo doing done draft review status',
        requires: ['current note unless noteId or noteTitle is provided'],
        examples: ['move Daily update checklist to inprogress', 'set this note status to done'],
        inputSchema: objectSchema({ noteId: stringArg(120), noteTitle: stringArg(180), status: stringArg(80) }, ['status']),
        run: (args) => {
          const note = writableMetadataNote(args);
          if (!note) return { ok: false, message: noteTitleArg(args) ? `Could not find a note matching "${noteTitleArg(args)}".` : 'No note is available to update.' };
          const status = mnNormalizeNoteStatus(args.status, workflowStates) || String(args.status || '').trim().toUpperCase().replace(/[^A-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 18);
          updateWorkflowNoteStatus(note.id, null, status);
          return { message: `Set "${note.title}" to ${status || 'no status'}.`, affected: noteAffected(note) };
        },
      },
      {
        id: 'archive-workflow-note',
        label: 'Archive workflow note',
        description: 'Archive or restore the current or selected workflow note.',
        section: 'Workflow',
        inputSchema: objectSchema({ noteId: stringArg(120), noteTitle: stringArg(180), archived: { type: 'boolean', default: true } }),
        run: (args) => {
          const note = writableMetadataNote(args);
          if (!note) return { ok: false, message: noteTitleArg(args) ? `Could not find a note matching "${noteTitleArg(args)}".` : 'No note is available to archive.' };
          updateWorkflowArchived(note.id, args.archived !== false);
          return { message: `${args.archived === false ? 'Restored' : 'Archived'} "${note.title}".`, affected: noteAffected(note) };
        },
      },
      {
        id: 'create-canvas',
        label: 'Create canvas',
        description: 'Create a new canvas.',
        section: 'Canvas',
        inputSchema: canvasActionSchema,
        run: async (args) => {
          const canvas = await createCanvas(args.title || 'Untitled canvas');
          return { message: `Created "${canvas?.title || args.title || 'Untitled canvas'}".`, affected: canvas ? [{ type: 'canvas', id: canvas.id, title: canvas.title }] : [] };
        },
      },
      {
        id: 'open-canvas',
        label: 'Open canvas',
        description: 'Open a specific canvas or the canvas dashboard.',
        section: 'Canvas',
        inputSchema: canvasActionSchema,
        run: async (args) => {
          const target = resolveCanvas(args);
          const canvas = target?.id ? await openCanvas(target.id) : null;
          if (!target?.id) openCanvasDashboard();
          return { message: canvas ? `Opened "${canvas.title}".` : 'Opened canvas dashboard.', affected: canvas ? [{ type: 'canvas', id: canvas.id, title: canvas.title }] : [] };
        },
      },
      {
        id: 'add-note-to-canvas',
        label: 'Add note to canvas',
        description: 'Place the current or named note on a canvas as a live note card.',
        section: 'Canvas',
        keywords: 'send to canvas note card board place',
        inputSchema: objectSchema({ title: stringArg(180), noteTitle: stringArg(180), canvasId: stringArg(120), canvasTitle: stringArg(180) }),
        run: async (args) => {
          const note = writableMetadataNote({ title: args.noteTitle || args.title });
          if (!note) return { ok: false, message: 'No note is available to add to a canvas.' };
          const canvas = args.canvasId || args.canvasTitle ? resolveCanvas({ canvasId: args.canvasId, canvasTitle: args.canvasTitle }) : null;
          return await addNoteToCanvas(note.id, canvas?.id || null);
        },
      },
      {
        id: 'delete-canvas',
        label: 'Delete canvas',
        description: 'Move a canvas to recently deleted.',
        section: 'Canvas',
        risk: 'destructive',
        inputSchema: canvasActionSchema,
        preview: (args) => {
          const canvas = resolveCanvas(args);
          return { title: 'Delete canvas', message: `Move "${canvas?.title || 'the canvas'}" to recently deleted.`, steps: ['Remove canvas from the dashboard', 'Keep it recoverable in trash'], affected: canvas ? [{ type: 'canvas', id: canvas.id, title: canvas.title }] : [] };
        },
        run: async (args) => {
          const canvasId = resolveCanvas(args)?.id;
          if (!canvasId) return { ok: false, message: 'No canvas is available to delete.' };
          await deleteCanvas(canvasId);
          return { message: 'Canvas deleted.' };
        },
      },
      {
        id: 'switch-vault',
        label: 'Switch vault',
        description: 'Switch to a vault by id or name.',
        section: 'Vaults',
        kind: 'read',
        readOnly: true,
        idempotent: true,
        inputSchema: vaultActionSchema,
        run: (args) => {
          const vault = resolveVault(args);
          if (!vault) return { ok: false, message: args.vaultName || args.name ? `Could not find a vault matching "${args.vaultName || args.name}".` : 'No vault was specified.' };
          selectVault(vault.id);
          return { message: `Switched to ${vault.name}.`, affected: [{ type: 'vault', id: vault.id, title: vault.name }] };
        },
      },
      {
        id: 'restore-trash-item',
        label: 'Restore trash item',
        description: 'Restore a deleted note or canvas by trash id.',
        section: 'Vault',
        risk: 'confirm',
        enabled: HAS_DISK,
        inputSchema: objectSchema({ trashId: stringArg(140), sourceType: stringArg(20) }, ['trashId']),
        preview: (args) => ({ title: 'Restore trash item', message: `Restore trash item ${args.trashId}.`, steps: ['Read recently deleted item', 'Restore it to the active vault'], affected: [{ type: args.sourceType || 'trash', id: args.trashId, title: args.trashId }] }),
        run: async (args) => {
          const result = await restoreDeletedNote({ trashId: args.trashId, sourceType: args.sourceType || 'note' });
          return result?.ok === false ? { ok: false, message: result.error || 'Could not restore trash item.' } : { message: 'Trash item restored.' };
        },
      },
      ...buildDynamicActions({
        zoteroReaderEnabled,
        platform,
        appHelpers,
        notesWithBody,
        setSelectedId,
        navigateView,
        noteAffected,
        uniqueNoteTitle,
        createNote,
        recordPhase5Metric,
        plugins,
        pluginApi,
        runPlugin,
        noteTemplates,
        createNoteFromTemplate,
        vaultsForSidebar,
        activeVaultId,
        selectVault,
        canvases,
        openCanvas,
        objectSchema,
        stringArg,
        integerArg,
      }),
    ];
    const availableActions = MN_FEATURES?.isActionAvailable
      ? actions.filter(action => MN_FEATURES.isActionAvailable(action.id, featureState))
      : actions;
    return makeRegistry(availableActions);
  }, [activeCanvas, activeVault?.name, activeVaultId, addNoteToCanvas, canvases, closeReferencePane, createCanvas, createDailyNote, createNote, createNoteFromTemplate, deleteCanvas, deleteNote, duplicateNote, exportBackup, featureState, importBackup, markDirty, notesWithBody, openAskAi, openCanvas, openCanvasDashboard, openReferencePane, openSmartView, plugins, rebuildIndex, recordPhase5Metric, referencePaneOpen, restoreDeletedNote, runPlugin, selectVault, selectedNote, shortcutPlatform, smartViewDefinitions, uniqueNoteTitle, updateNote, updateNoteBody, updateWorkflowArchived, updateWorkflowNoteStatus, vaultsForSidebar, workflowStates, navigateView, showAppNotice]);
}
