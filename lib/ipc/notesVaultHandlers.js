const { NOTES_VAULTS_CHANNELS } = require('./contracts');
const { normalizeIpcError, ok } = require('./errors');
const linkRename = require('../linkRename');
const {
  validateNoteDeleteRequest,
  validateNoteListRequest,
  validateNoteOpenRequest,
  validateNoteSaveRequest,
  validateVaultCreateRequest,
  validateVaultIdRequest,
  validateVaultRenameRequest,
  validateContractResponse,
} = require('./validation');

async function loadVaultForNote(store, vaultId) {
  const vault = await store.loadVault(vaultId);
  return vault;
}

function noteSummary(note) {
  return {
    id: note.id,
    path: note.path || null,
    title: note.title || 'Untitled',
    updatedAt: note.modifiedAt || note.diskModifiedAt || note.date || null,
  };
}

function noteRecord(note) {
  return {
    id: note.id,
    path: note.path || null,
    title: note.title || 'Untitled',
    frontmatter: {
      date: note.date || null,
      tags: Array.isArray(note.tags) ? note.tags : [],
      pinned: !!note.pinned,
      workflowArchived: !!note.workflowArchived,
    },
    blocks: Array.isArray(note.blocks) ? note.blocks : [],
    links: Array.isArray(note.links) ? note.links : [],
    raw: note.body || '',
    updatedAt: note.modifiedAt || note.diskModifiedAt || note.date || null,
  };
}

function normalizeVault(vault) {
  return {
    ...vault,
    path: vault.path || null,
    isDefault: !!vault.isDefault,
  };
}

async function getActiveVaultId(store) {
  const prefs = await store.getPrefs();
  return prefs.activeVaultId || null;
}

function createNotesVaultHandlers(deps) {
  const {
    store, idx, ai, withIndexVaultLock, runOptionalSearchIndexTask,
    onBeforeVaultMutation = () => {},
    onVaultRegistryChange = async () => {},
  } = deps;

  return {
    async listNotes(payload) {
      const { vaultId } = validateNoteListRequest(payload);
      const targetVaultId = vaultId || await getActiveVaultId(store);
      if (!targetVaultId) return ok({ notes: [], vaultId: null });
      const vault = await loadVaultForNote(store, targetVaultId);
      return ok({ vaultId: targetVaultId, notes: (vault.notes || []).map(noteSummary) });
    },

    async openNote(payload) {
      const { vaultId, noteId } = validateNoteOpenRequest(payload);
      const vault = await loadVaultForNote(store, vaultId);
      const note = (vault.notes || []).find(item => item.id === noteId);
      if (!note) throw new Error('Note not found: ' + noteId);
      return ok({ note: noteRecord(note) });
    },

    async saveNote(payload) {
      const { vaultId, note, options } = validateNoteSaveRequest(payload);
      onBeforeVaultMutation(vaultId);
      const { saved, linkedNoteUpdates, linkedNoteRename } = await withIndexVaultLock(vaultId, async () => {
        const previousNote = typeof store.getNote === 'function'
          ? await store.getNote(vaultId, note.id).catch(() => null)
          : null;
        const result = await store.saveNote(vaultId, note, options || {});
        const indexed = runOptionalSearchIndexTask('index note', () => idx.indexNote(vaultId, result));
        if (indexed !== null) ai.scheduleEmbed(vaultId, result);
        const updates = await linkRename.renameLinksAfterSave({
          store,
          vaultId,
          previousNote,
          savedNote: result,
          onNoteUpdated: (updated) => {
            const linkIndexed = runOptionalSearchIndexTask('index link-renamed note', () => idx.indexNote(vaultId, updated));
            if (linkIndexed !== null) ai.scheduleEmbed(vaultId, updated);
          },
        });
        return {
          saved: result,
          linkedNoteUpdates: updates,
          linkedNoteRename: updates.length
            ? { oldTitle: previousNote?.title || '', newTitle: result.title || '' }
            : null,
        };
      });
      return ok({
        note: saved,
        updatedAt: saved.diskModifiedAt || saved.modifiedAt || null,
        linkedNoteUpdates,
        linkedNoteRename,
      });
    },

    async deleteNote(payload) {
      const { vaultId, noteId, noteSnapshot } = validateNoteDeleteRequest(payload);
      onBeforeVaultMutation(vaultId);
      const removed = await withIndexVaultLock(vaultId, async () => {
        const result = await store.deleteNote(vaultId, noteId, noteSnapshot);
        runOptionalSearchIndexTask('remove note from index', () => idx.removeNote(vaultId, noteId));
        return result;
      });
      return ok({ removed: !!removed, deleted: removed });
    },

    async listVaults() {
      const vaults = await store.listVaults();
      const activeVaultId = await getActiveVaultId(store);
      return ok({ vaults: vaults.map(normalizeVault), activeVaultId });
    },

    async createVault(payload) {
      const { name, options } = validateVaultCreateRequest(payload);
      const vault = await store.createVault(name, options);
      const data = await store.loadVault(vault.id);
      await withIndexVaultLock(vault.id, async () => {
        runOptionalSearchIndexTask('rescan created vault', () => idx.rescanVault(vault.id, data.notes));
      });
      await onVaultRegistryChange();
      return ok({ vault: normalizeVault(vault) });
    },

    async renameVault(payload) {
      const { vaultId, name } = validateVaultRenameRequest(payload);
      const vault = await store.renameVault(vaultId, name);
      return ok({ vault: normalizeVault(vault) });
    },

    async deleteVault(payload) {
      const { vaultId } = validateVaultIdRequest(payload);
      const result = await withIndexVaultLock(vaultId, async () => {
        const deleted = await store.deleteVault(vaultId);
        runOptionalSearchIndexTask('remove vault from index', () => idx.removeVault(vaultId));
        return deleted;
      });
      await onVaultRegistryChange();
      return ok({ ...result, deleted: true, vaults: (result.vaults || []).map(normalizeVault) });
    },

    async selectVault(payload) {
      const { vaultId } = validateVaultIdRequest(payload);
      await store.setActiveVault(vaultId);
      const vaults = await store.listVaults();
      const vault = vaults.find(item => item.id === vaultId);
      if (!vault) throw new Error('Vault not found: ' + vaultId);
      return ok({ activeVaultId: vaultId, vault: normalizeVault(vault) });
    },
  };
}

function registerNotesVaultHandlers(ipcMain, deps) {
  const handlers = createNotesVaultHandlers(deps);
  const register = (channel, handler) => {
    ipcMain.handle(channel, async (_event, payload = {}) => {
      try {
        return validateContractResponse(await handler(payload));
      } catch (error) {
        return normalizeIpcError(error, { channel });
      }
    });
  };

  register(NOTES_VAULTS_CHANNELS.noteList, handlers.listNotes);
  register(NOTES_VAULTS_CHANNELS.noteOpen, handlers.openNote);
  register(NOTES_VAULTS_CHANNELS.noteSave, handlers.saveNote);
  register(NOTES_VAULTS_CHANNELS.noteDelete, handlers.deleteNote);
  register(NOTES_VAULTS_CHANNELS.vaultList, handlers.listVaults);
  register(NOTES_VAULTS_CHANNELS.vaultCreate, handlers.createVault);
  register(NOTES_VAULTS_CHANNELS.vaultRename, handlers.renameVault);
  register(NOTES_VAULTS_CHANNELS.vaultDelete, handlers.deleteVault);
  register(NOTES_VAULTS_CHANNELS.vaultSelect, handlers.selectVault);
}

module.exports = {
  createNotesVaultHandlers,
  registerNotesVaultHandlers,
};
