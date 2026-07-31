const path = require('path');

function changedFileNames(event = {}) {
  const values = Array.isArray(event.changes)
    ? event.changes.map(change => change?.fileName)
    : (Array.isArray(event.fileNames) ? event.fileNames : [event.fileName]);
  const names = [];
  const seen = new Set();
  for (const value of values) {
    const name = String(value || '').trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    names.push(name);
  }
  return names;
}

function createExternalVaultChangeHandler(deps) {
  const {
    store,
    idx,
    ai,
    withIndexVaultLock,
    runOptionalSearchIndexTask,
    getIndexReadyPromise,
    notifyRenderer = () => {},
    onError = error => console.error('external vault refresh failed', error),
  } = deps;

  return function handleExternalVaultChange(event = {}) {
    const vaultId = String(event.vaultId || '');
    const fileNames = changedFileNames(event);
    const fullVault = event.fullVault === true
      || (Array.isArray(event.changes) && event.changes.some(change => !change?.fileName));
    const refresh = Promise.resolve(getIndexReadyPromise()).then(async () => {
      let notes = [];
      await withIndexVaultLock(vaultId, async () => {
        const data = await store.loadVault(vaultId);
        notes = Array.isArray(data?.notes) ? data.notes : [];
        await Promise.resolve(runOptionalSearchIndexTask(
          'rescan externally changed vault',
          () => idx.rescanVault(vaultId, notes)
        ));
      });

      if (fullVault) {
        for (const note of notes) ai.scheduleEmbed(vaultId, note);
      } else {
        const notesById = new Map(notes.map(note => [String(note.id || ''), note]));
        for (const fileName of fileNames) {
          const noteId = path.basename(fileName, path.extname(fileName));
          const note = notesById.get(noteId);
          if (note) ai.scheduleEmbed(vaultId, note);
        }
      }
    }).catch(error => onError(error, vaultId));

    notifyRenderer(event);
    return refresh;
  };
}

module.exports = { changedFileNames, createExternalVaultChangeHandler };
