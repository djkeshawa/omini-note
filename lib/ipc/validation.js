const ID_RE = /^[A-Za-z0-9_-]+$/;
const MAX_NAME_LENGTH = 120;
const MAX_NOTE_CONTENT_LENGTH = 2 * 1024 * 1024;

function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function assertPlainObject(value, label = 'payload') {
  if (!isPlainObject(value)) throw validationError(`Invalid ${label}`);
  return value;
}

function validationError(message) {
  const error = new Error(message);
  error.code = 'VALIDATION_ERROR';
  return error;
}

function cleanId(value, label) {
  const id = String(value || '').trim();
  if (!ID_RE.test(id)) throw validationError(`Invalid ${label}`);
  return id;
}

function cleanOptionalId(value, label) {
  if (value == null || value === '') return null;
  return cleanId(value, label);
}

function cleanName(value, label = 'name') {
  const name = String(value || '').replace(/\0/g, '').trim();
  if (!name) throw validationError(`${label} is required`);
  if (name.length > MAX_NAME_LENGTH) throw validationError(`${label} is too long`);
  if (/[\\/]/.test(name)) throw validationError(`${label} cannot contain path separators`);
  return name;
}

function cleanNoteContent(value) {
  const content = String(value ?? '').replace(/\0/g, '');
  if (Buffer.byteLength(content, 'utf8') > MAX_NOTE_CONTENT_LENGTH) {
    throw validationError('Note content is too large');
  }
  return content;
}

function validateNoteListRequest(payload = {}) {
  const input = payload == null ? {} : assertPlainObject(payload);
  return { vaultId: cleanOptionalId(input.vaultId, 'vault id') };
}

function validateNoteOpenRequest(payload) {
  const input = assertPlainObject(payload);
  return {
    vaultId: cleanId(input.vaultId, 'vault id'),
    noteId: cleanId(input.noteId, 'note id'),
  };
}

function validateNoteSaveRequest(payload) {
  const input = assertPlainObject(payload);
  const note = isPlainObject(input.note) ? { ...input.note } : {};
  const noteId = cleanId(input.noteId || note.id, 'note id');
  note.id = noteId;
  if (Object.prototype.hasOwnProperty.call(input, 'content')) {
    note.body = cleanNoteContent(input.content);
  } else if (Object.prototype.hasOwnProperty.call(note, 'body')) {
    note.body = cleanNoteContent(note.body);
  }
  return {
    vaultId: cleanId(input.vaultId, 'vault id'),
    noteId,
    note,
    options: isPlainObject(input.options) ? input.options : {},
  };
}

function validateNoteDeleteRequest(payload) {
  const input = assertPlainObject(payload);
  return {
    vaultId: cleanId(input.vaultId, 'vault id'),
    noteId: cleanId(input.noteId, 'note id'),
    noteSnapshot: isPlainObject(input.noteSnapshot) ? input.noteSnapshot : null,
    permanent: input.permanent === true,
  };
}

function validateVaultCreateRequest(payload) {
  const input = assertPlainObject(payload);
  return {
    name: cleanName(input.name, 'vault name'),
    options: isPlainObject(input.options) ? input.options : {},
  };
}

function validateVaultRenameRequest(payload) {
  const input = assertPlainObject(payload);
  return {
    vaultId: cleanId(input.vaultId, 'vault id'),
    name: cleanName(input.name, 'vault name'),
  };
}

function validateVaultIdRequest(payload) {
  const input = assertPlainObject(payload);
  return { vaultId: cleanId(input.vaultId, 'vault id') };
}

function validateContractResponse(response) {
  if (!response || typeof response !== 'object') throw validationError('Invalid IPC response');
  if (response.ok === true && isPlainObject(response.data)) return response;
  if (response.ok === false && isPlainObject(response.error) && typeof response.error.message === 'string') return response;
  throw validationError('Invalid IPC response');
}

module.exports = {
  validateContractResponse,
  validateNoteDeleteRequest,
  validateNoteListRequest,
  validateNoteOpenRequest,
  validateNoteSaveRequest,
  validateVaultCreateRequest,
  validateVaultIdRequest,
  validateVaultRenameRequest,
};
