const NOTES_VAULTS_CHANNELS = Object.freeze({
  noteList: 'vispnote:v1:note:list',
  noteOpen: 'vispnote:v1:note:open',
  noteSave: 'vispnote:v1:note:save',
  noteDelete: 'vispnote:v1:note:delete',
  vaultList: 'vispnote:v1:vault:list',
  vaultCreate: 'vispnote:v1:vault:create',
  vaultRename: 'vispnote:v1:vault:rename',
  vaultDelete: 'vispnote:v1:vault:delete',
  vaultSelect: 'vispnote:v1:vault:select',
});

/**
 * @typedef {{ ok: true, data: object }} IpcSuccessResponse
 * @typedef {{ ok: false, error: { code: string, message: string, details?: object } }} IpcErrorResponse
 * @typedef {IpcSuccessResponse | IpcErrorResponse} IpcContractResponse
 *
 * @typedef {{ vaultId?: string | null }} NoteListRequest
 * @typedef {{ noteId: string, vaultId: string }} NoteOpenRequest
 * @typedef {{ noteId?: string, vaultId: string, note?: object, content?: string, options?: object }} NoteSaveRequest
 * @typedef {{ noteId: string, vaultId: string, noteSnapshot?: object | null, options?: object }} NoteDeleteRequest
 * @typedef {{ name: string, options?: object }} VaultCreateRequest
 * @typedef {{ vaultId: string, name: string }} VaultRenameRequest
 * @typedef {{ vaultId: string }} VaultDeleteRequest
 * @typedef {{ vaultId: string }} VaultSelectRequest
 */

function channelList() {
  return Object.values(NOTES_VAULTS_CHANNELS);
}

module.exports = {
  NOTES_VAULTS_CHANNELS,
  channelList,
};
