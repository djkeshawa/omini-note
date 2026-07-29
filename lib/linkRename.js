// Rename-safe wiki links: when a note's title changes, rewrite [[Old Title]]
// links (including [[Old#heading]] and [[Old|alias]] forms) in the other notes
// of the vault so they keep pointing at the renamed note.
//
// Matching is case-insensitive to mirror how links resolve at click time and
// how the SQLite backlink index compares titles.

const WIKI_LINK_RE = /\[\[([^\]|#\n]+)((?:#[^\]\n|]+)?(?:\|[^\]\n]+)?)\]\]/g;

function normalizeTitleKey(title) {
  return String(title || '').trim().toLowerCase();
}

function shouldRenameLinks(oldTitle, newTitle) {
  const oldKey = normalizeTitleKey(oldTitle);
  const newKey = normalizeTitleKey(newTitle);
  // A case-only rename keeps resolving because lookups are case-insensitive.
  return !!oldKey && !!newKey && oldKey !== newKey;
}

function rewriteWikiLinks(body, oldTitle, newTitle) {
  const target = normalizeTitleKey(oldTitle);
  const replacement = String(newTitle || '').trim();
  if (!target || !replacement) return { body: String(body || ''), count: 0 };
  let count = 0;
  const next = String(body || '').replace(WIKI_LINK_RE, (whole, title, suffix) => {
    if (normalizeTitleKey(title) !== target) return whole;
    count++;
    return `[[${replacement}${suffix || ''}]]`;
  });
  return { body: next, count };
}

// Rewrites links across the vault after a rename. Returns the notes that were
// updated on disk plus the ones skipped because of save conflicts. Skips
// everything when another note still carries the old title (links would keep
// resolving to that note, so rewriting them would change their meaning).
async function renameNoteLinks(store, vaultId, { renamedNoteId, oldTitle, newTitle } = {}) {
  const result = { updatedNotes: [], skippedNotes: [], linkCount: 0 };
  if (!shouldRenameLinks(oldTitle, newTitle)) return result;
  const vault = await store.loadVault(vaultId);
  const notes = Array.isArray(vault?.notes) ? vault.notes : [];
  const oldKey = normalizeTitleKey(oldTitle);
  const titleStillTaken = notes.some(note =>
    note.id !== renamedNoteId && normalizeTitleKey(note.title) === oldKey);
  if (titleStillTaken) return result;
  for (const note of notes) {
    if (note.id === renamedNoteId) continue;
    const { body, count } = rewriteWikiLinks(note.body, oldTitle, newTitle);
    if (!count) continue;
    try {
      const saved = await store.saveNote(vaultId, { ...note, body }, {
        expectedRevision: note.diskRevision,
      });
      result.updatedNotes.push(saved);
      result.linkCount += count;
    } catch (e) {
      result.skippedNotes.push({ id: note.id, title: note.title, error: e?.message || String(e) });
    }
  }
  return result;
}

// Shared post-save hook used by both the v1 contract handler and the legacy
// IPC handler. Reads nothing itself: callers pass the pre-save note snapshot.
async function renameLinksAfterSave({ store, vaultId, previousNote, savedNote, onNoteUpdated } = {}) {
  if (!previousNote || !savedNote) return [];
  if (!shouldRenameLinks(previousNote.title, savedNote.title)) return [];
  const renamed = await renameNoteLinks(store, vaultId, {
    renamedNoteId: savedNote.id,
    oldTitle: previousNote.title,
    newTitle: savedNote.title,
  });
  if (renamed.skippedNotes.length) {
    console.warn('link rename skipped notes', vaultId, renamed.skippedNotes);
  }
  if (typeof onNoteUpdated === 'function') {
    for (const updated of renamed.updatedNotes) await onNoteUpdated(updated);
  }
  return renamed.updatedNotes;
}

module.exports = {
  shouldRenameLinks,
  rewriteWikiLinks,
  renameNoteLinks,
  renameLinksAfterSave,
};
