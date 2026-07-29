function mnAiContentFingerprint(value = '') {
  const text = String(value || '');
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `${text.length}:${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

function mnAiNoteEditOwner({ vaultId = '', noteId = '', body = '', diskRevision = null } = {}) {
  return {
    vaultId: String(vaultId || ''),
    noteId: String(noteId || ''),
    baseRevision: diskRevision || null,
    bodyHash: mnAiContentFingerprint(body),
  };
}

function mnAiValidateNoteEditOwner(owner, { vaultId = '', note = null, body = '' } = {}) {
  if (!owner?.noteId || !note?.id) {
    return { ok: false, error: 'The target note is no longer available.' };
  }
  if (String(owner.vaultId || '') !== String(vaultId || '') || String(owner.noteId) !== String(note.id)) {
    return { ok: false, error: 'The AI preview belongs to a different vault or note.' };
  }
  if (owner.baseRevision && note.diskRevision && owner.baseRevision !== note.diskRevision) {
    return { ok: false, error: 'The note changed on disk after this AI preview was created.' };
  }
  if (owner.bodyHash !== mnAiContentFingerprint(body)) {
    return { ok: false, error: 'The note changed after this AI preview was created. Generate a new preview.' };
  }
  return { ok: true };
}

export { mnAiContentFingerprint, mnAiNoteEditOwner, mnAiValidateNoteEditOwner };
