export function buildDynamicActions(ctx) {
  const { zoteroReaderEnabled, platform, appHelpers, notesWithBody, setSelectedId, navigateView, noteAffected, uniqueNoteTitle, createNote, recordPhase5Metric, plugins, pluginApi, runPlugin, noteTemplates, createNoteFromTemplate, vaultsForSidebar, activeVaultId, selectVault, canvases, openCanvas, objectSchema, stringArg, integerArg } = ctx;
  const desktopBridge = platform;
  const MN_APP_HELPERS = appHelpers;
  const MN_PLUGIN_API = pluginApi;
  const MN_NOTE_TEMPLATES = noteTemplates;
  return [
    ...(zoteroReaderEnabled ? [
      {
        id: 'zotero-list',
        label: 'List Zotero papers',
        description: 'List recent Zotero Desktop papers and references without searching for a title.',
        section: 'Zotero',
        keywords: 'zotero paper papers documents references bibliography library list show',
        risk: 'safe',
        kind: 'read',
        readOnly: true,
        inputSchema: objectSchema({ limit: integerArg(20) }),
        outputSchema: { type: 'object', additionalProperties: true },
        run: async (args) => {
          if (!desktopBridge?.zotero?.list) return { ok: false, message: 'Zotero integration is unavailable.' };
          const res = await desktopBridge.zotero.list({ limit: args.limit || 20 });
          if (!res.ok) return { ok: false, message: res.error || 'Could not list Zotero papers.' };
          const results = res.value?.results || [];
          return {
            message: results.length ? `Found ${results.length} Zotero item${results.length === 1 ? '' : 's'}.` : 'No Zotero papers were found.',
            results,
            affected: results.map(item => ({ type: 'zotero', id: item.key, title: item.title || item.key })),
          };
        },
      },
      {
        id: 'zotero-search',
        label: 'Search Zotero',
        description: 'Search Zotero Desktop documents by title, author, abstract, note, and indexed full text.',
        section: 'Zotero',
        keywords: 'zotero paper papers documents references bibliography library research pdf search find',
        risk: 'safe',
        kind: 'read',
        readOnly: true,
        inputSchema: objectSchema({ query: stringArg(300), limit: integerArg(8) }, ['query']),
        outputSchema: { type: 'object', additionalProperties: true },
        run: async (args) => {
          if (!desktopBridge?.zotero?.search) return { ok: false, message: 'Zotero integration is unavailable.' };
          const res = await desktopBridge.zotero.search({ query: args.query, limit: args.limit || 8 });
          if (!res.ok) return { ok: false, message: res.error || 'Could not search Zotero.' };
          const results = res.value?.results || [];
          return {
            message: results.length ? `Found ${results.length} Zotero item${results.length === 1 ? '' : 's'}.` : 'No Zotero items matched that search.',
            results,
            affected: results.map(item => ({ type: 'zotero', id: item.key, title: item.title || item.key })),
          };
        },
      },
      {
        id: 'zotero-read',
        label: 'Read Zotero item',
        description: 'Read Zotero item metadata, attachments, and available indexed attachment full text.',
        section: 'Zotero',
        keywords: 'zotero read paper document reference attachment full text pdf',
        risk: 'safe',
        kind: 'read',
        readOnly: true,
        inputSchema: objectSchema({ itemKey: stringArg(80), includeFullText: { type: 'boolean', default: true } }, ['itemKey']),
        outputSchema: { type: 'object', additionalProperties: true },
        run: async (args) => {
          if (!desktopBridge?.zotero?.read) return { ok: false, message: 'Zotero integration is unavailable.' };
          const res = await desktopBridge.zotero.read({ itemKey: args.itemKey, includeFullText: args.includeFullText !== false });
          if (!res.ok) return { ok: false, message: res.error || 'Could not read Zotero item.' };
          const value = res.value || {};
          const item = value.item || {};
          return {
            message: value.fullText
              ? `Read "${item.title || args.itemKey}" with indexed full text.`
              : `Read "${item.title || args.itemKey}" metadata${value.fullTextError ? `; ${value.fullTextError}` : '.'}`,
            item,
            attachments: value.attachments || [],
            fullText: value.fullText || '',
            fullTextItemKey: value.fullTextItemKey || '',
            fullTextTruncated: !!value.fullTextTruncated,
            fullTextError: value.fullTextError || '',
            affected: item.key ? [{ type: 'zotero', id: item.key, title: item.title || item.key }] : [],
          };
        },
      },
      {
        id: 'zotero-source-note',
        label: 'Create Zotero source note',
        description: 'Create or open a VispNote source note linked to a Zotero item key.',
        section: 'Zotero',
        keywords: 'zotero source note paper document reference bibliography create open',
        risk: 'safe',
        idempotent: true,
        inputSchema: objectSchema({ itemKey: stringArg(80), includeFullText: { type: 'boolean', default: true } }, ['itemKey']),
        outputSchema: { type: 'object', additionalProperties: true },
        run: async (args) => {
          const itemKey = MN_APP_HELPERS.zoteroCleanItemKey
            ? MN_APP_HELPERS.zoteroCleanItemKey(args.itemKey)
            : String(args.itemKey || '').trim();
          if (!itemKey) return { ok: false, message: 'A valid Zotero item key is required.' };
          const existing = MN_APP_HELPERS.zoteroFindSourceNote
            ? MN_APP_HELPERS.zoteroFindSourceNote(notesWithBody, itemKey)
            : null;
          if (existing) {
            setSelectedId(existing.id);
            navigateView('notes');
            return {
              message: `Opened existing Zotero source note "${existing.title || itemKey}".`,
              itemKey,
              noteId: existing.id,
              mode: 'open',
              affected: noteAffected(existing),
            };
          }
          if (!desktopBridge?.zotero?.status || !desktopBridge?.zotero?.read) {
            return { ok: false, message: 'Zotero integration is unavailable.' };
          }
          const status = await desktopBridge.zotero.status();
          if (!status.ok) return { ok: false, message: status.error || 'Could not check Zotero.' };
          if (!status.value?.reachable) {
            return { ok: false, message: status.value?.error || 'Zotero Desktop is not reachable.' };
          }
          const res = await desktopBridge.zotero.read({ itemKey, includeFullText: args.includeFullText !== false });
          if (!res.ok) return { ok: false, message: res.error || 'Could not read Zotero item.' };
          const plan = MN_APP_HELPERS.zoteroBuildSourceNotePlan
            ? MN_APP_HELPERS.zoteroBuildSourceNotePlan({ readResult: res.value, itemKey, notes: notesWithBody })
            : null;
          if (!plan || plan.action === 'unavailable') {
            return { ok: false, message: plan?.error || 'Could not build Zotero source note.' };
          }
          if (plan.action === 'open' && plan.noteId) {
            setSelectedId(plan.noteId);
            navigateView('notes');
            return {
              message: `Opened existing Zotero source note "${plan.noteTitle || itemKey}".`,
              itemKey: plan.itemKey || itemKey,
              noteId: plan.noteId,
              mode: 'open',
              affected: noteAffected(plan.existingNote),
            };
          }
          const title = uniqueNoteTitle(plan.createNote.title || plan.source?.title || itemKey);
          const id = createNote({
            title,
            body: plan.createNote.body || '',
            tags: plan.createNote.tags || [],
          });
          recordPhase5Metric('zotero_source_notes', { mode: 'create' });
          return {
            message: `Created Zotero source note "${title}".`,
            itemKey: plan.itemKey || itemKey,
            noteId: id,
            mode: 'create',
            affected: [
              { type: 'note', id, title },
              { type: 'zotero', id: plan.itemKey || itemKey, title: plan.source?.title || itemKey },
            ],
          };
        },
      },
    ] : []),
    ...plugins.filter(plugin => plugin.enabled !== false).map(plugin => ({
      id: `plugin-${plugin.id}`,
      label: MN_PLUGIN_API.commandTitle ? MN_PLUGIN_API.commandTitle(plugin) : plugin.name,
      description: plugin.purpose || `Run ${plugin.name || 'plugin'}.`,
      section: 'Plugins',
      keywords: `${plugin.type} ${plugin.purpose || ''}`,
      risk: plugin.type === 'open-url' ? 'external' : 'safe',
      inputSchema: objectSchema(),
      preview: () => ({ title: MN_PLUGIN_API.commandTitle ? MN_PLUGIN_API.commandTitle(plugin) : plugin.name, message: `Run plugin "${plugin.name || plugin.id}".`, steps: [plugin.type === 'open-url' ? 'Open external URL' : 'Run plugin action'], affected: [{ type: 'plugin', id: plugin.id, title: plugin.name }] }),
      run: async () => runPlugin(plugin),
    })),
    ...MN_NOTE_TEMPLATES.map(template => ({
      id: `template-${template.id}`,
      label: `New ${template.title}`,
      description: `Create a note from the ${template.title} template.`,
      section: 'Templates',
      keywords: `${template.id} template create note`,
      inputSchema: objectSchema(),
      run: () => {
        const id = createNoteFromTemplate(template.id);
        return { message: `Created ${template.title}.`, affected: id ? [{ type: 'note', id, title: template.title }] : [] };
      },
    })),
    ...vaultsForSidebar.map(vault => ({
      id: `vault-${vault.id}`,
      label: `Switch to ${vault.name}`,
      description: `Switch active vault to ${vault.name}.`,
      section: 'Vaults',
      keywords: 'switch workspace vault',
      enabled: vault.id !== activeVaultId,
      inputSchema: objectSchema(),
      run: () => { selectVault(vault.id); return { message: `Switched to ${vault.name}.`, affected: [{ type: 'vault', id: vault.id, title: vault.name }] }; },
    })),
    ...canvases.slice(0, 60).map(canvas => ({
      id: `canvas-${canvas.id}`,
      label: canvas.title || 'Untitled canvas',
      description: 'Open canvas.',
      section: 'Canvases',
      keywords: 'canvas board',
      inputSchema: objectSchema(),
      run: async () => {
        const opened = await openCanvas(canvas.id);
        return { message: `Opened ${opened?.title || canvas.title || 'canvas'}.`, affected: [{ type: 'canvas', id: canvas.id, title: canvas.title }] };
      },
    })),
    ...notesWithBody.slice(0, 120).map(note => ({
      id: `note-${note.id}`,
      label: note.title || 'Untitled',
      description: 'Open note.',
      section: 'Notes',
      keywords: `${(note.tags || []).join(' ')} ${note.body || ''}`.slice(0, 500),
      inputSchema: objectSchema(),
      run: () => {
        setSelectedId(note.id);
        navigateView('notes');
        return { message: `Opened "${note.title || 'Untitled'}".`, affected: noteAffected(note) };
      },
    })),

  ];
}
