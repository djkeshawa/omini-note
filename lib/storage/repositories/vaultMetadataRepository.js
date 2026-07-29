function createVaultMetadataRepository(d) {
  async function vault(vaultId) {
    const cfg = await d.loadConfig();
    const id = d.validateEntityId(vaultId, 'vault');
    const found = cfg.vaults.find(item => item.id === id);
    if (!found) throw new Error('Vault not found: ' + id);
    return found;
  }

  async function updateVaultMeta(vaultId, mutator) {
    if (typeof mutator !== 'function') throw new Error('Vault metadata mutator is required');
    return d.withMetadataLock(vaultId, async () => {
      const currentVault = await vault(vaultId);
      const current = await d.readJsonSafe(d.vaultMetaFile(currentVault.slug), {});
      const draft = d.cloneData(current);
      const result = await mutator(draft);
      await d.writeJson(d.vaultMetaFile(currentVault.slug), draft);
      return { metadata: d.cloneData(draft), result };
    });
  }

  async function saveVaultMeta(vaultId, patch) {
    const cleanPatch = d.sanitizeVaultMetaPatch(patch);
    const { metadata } = await updateVaultMeta(vaultId, current => {
      Object.assign(current, cleanPatch);
    });
    return metadata;
  }

  async function vaultHealth(vaultId) {
    const loaded = await d.loadVault(vaultId);
    const notes = loaded.notes || [];
    const canvases = await d.listCanvases(vaultId);
    const titleToIds = new Map();
    for (const note of notes) {
      const key = String(note.title || '').trim().toLowerCase();
      if (!key) continue;
      if (!titleToIds.has(key)) titleToIds.set(key, []);
      titleToIds.get(key).push(note.id);
    }
    const outgoing = new Map();
    const incoming = new Map(notes.map(note => [note.id, 0]));
    const brokenLinks = [];
    for (const note of notes) {
      const targets = d.extractWikiTargets(note.body || '');
      outgoing.set(note.id, targets.length);
      for (const target of targets) {
        const ids = titleToIds.get(target.toLowerCase());
        if (!ids?.length) brokenLinks.push({ noteId: note.id, noteTitle: note.title, target });
        else ids.forEach(id => incoming.set(id, (incoming.get(id) || 0) + 1));
      }
    }
    return {
      noteCount: notes.length,
      tagCount: loaded.tags?.length || 0,
      canvasCount: canvases.length,
      wordCount: notes.reduce((sum, note) => sum + `${note.title || ''} ${note.body || ''}`.trim().split(/\s+/).filter(Boolean).length, 0),
      brokenLinks,
      orphanNotes: notes.filter(note => !(outgoing.get(note.id) || 0) && !(incoming.get(note.id) || 0)).map(note => ({ id: note.id, title: note.title })),
      indexStatus: 'ready',
      checkedAt: new Date().toISOString(),
    };
  }

  return { updateVaultMeta, saveVaultMeta, vaultHealth };
}

module.exports = { createVaultMetadataRepository };
