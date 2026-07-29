// The Memory actions, lifted out of useAppActionRegistry so that file stays
// under the 800-line hard limit. Same ctx-bag contract as buildDynamicActions.
export function buildMemoryActions(ctx) {
  const {
    HAS_DISK, memoryActions, platform, plugins, activeVaultId, activeVault,
    mnMdToBlocks, objectSchema, normalizeNotes, setNotes, selectedNote,
    noteAffected, setConnectionsRefreshToken,
  } = ctx;
  const desktopBridge = platform;
  const MN_MEMORY_ACTIONS = memoryActions;
  return [
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
  ];
}
