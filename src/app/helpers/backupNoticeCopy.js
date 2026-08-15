// One export, three honest outcomes: complete, incomplete, and written but too
// big to restore. The file list is capped because the notice dialog is a fixed
// 400px shell with no scroll container — an uncapped list pushes OK off screen.
// The cap covers the notes and canvases together, or a vault with both kinds
// broken re-creates the overflow the cap exists to stop.
const MN_BACKUP_FILE_CAP = 5;

// An unreadable canvas used to be reported as a missing note and counted into
// the notes denominator, so the notice named the wrong thing and got the total
// wrong at the same time.
function mnBackupMissingTitle(noteMisses, canvasMisses) {
  if (noteMisses && canvasMisses) {
    const items = noteMisses + canvasMisses;
    return `Backup saved, ${items} item${items === 1 ? '' : 's'} missing`;
  }
  if (canvasMisses) return `Backup saved, ${canvasMisses} canvas${canvasMisses === 1 ? '' : 'es'} missing`;
  return `Backup saved, ${noteMisses} note${noteMisses === 1 ? '' : 's'} missing`;
}

function mnBackupExportOutcome(result = {}) {
  const warnings = Array.isArray(result.warnings) ? result.warnings : [];
  // A status-write failure means the file itself is fine, so it is never
  // counted as a note that went missing.
  const missing = warnings.filter(w => w?.type !== 'backup-too-large' && w?.type !== 'backup-status');
  const tooLarge = warnings.find(w => w?.type === 'backup-too-large');
  const dateNote = warnings.some(w => w?.type === 'backup-status')
    ? '\n\nThe file is complete, but the last-backup date could not be updated.'
    : '';
  const oversize = tooLarge
    ? `\n\nThis backup holds ${tooLarge.noteCount} notes (${tooLarge.sizeMb} MB) and is over the restore limit (${tooLarge.limit} notes / ${tooLarge.sizeLimitMb} MB). The file was written, but importing it back will fail.`
    : '';
  if (missing.length) {
    // Anything that is not explicitly a canvas read is a note read, which keeps
    // an unrecognised warning behaving the way it always has.
    const canvasMissing = missing.filter(w => w?.type === 'canvas-read');
    const noteMissing = missing.filter(w => w?.type !== 'canvas-read');
    const names = [...noteMissing, ...canvasMissing].map(w => w.file || w.noteId || w.canvasId || w.message || 'an unnamed file');
    const listed = names.slice(0, MN_BACKUP_FILE_CAP);
    if (names.length > MN_BACKUP_FILE_CAP) listed.push(`+ ${names.length - MN_BACKUP_FILE_CAP} more`);
    const clauses = [];
    if (noteMissing.length) clauses.push(`VispNote could not read ${noteMissing.length} of ${(result.noteCount || 0) + noteMissing.length} notes`);
    if (canvasMissing.length) clauses.push(`VispNote could not read ${canvasMissing.length} of ${(result.canvasCount || 0) + canvasMissing.length} canvases`);
    return {
      tone: 'warn',
      title: mnBackupMissingTitle(noteMissing.length, canvasMissing.length),
      message: `${clauses.join(' and ')}, so they are not in this backup:\n${listed.join('\n')}\n\nThe originals are still on disk. Because this file is incomplete, the last-backup date has not been updated.${oversize}`,
      recordBackup: false,
    };
  }
  const vaultCount = result.vaultCount || 0;
  const fileName = String(result.filePath || '').split(/[\\/]/).pop() || 'the backup file';
  return {
    tone: tooLarge || dateNote ? 'warn' : 'success',
    title: 'Backup exported',
    message: `${vaultCount} vault${vaultCount === 1 ? '' : 's'} saved to ${fileName}.\nAttachments are not included in backups yet — only note text, properties and canvases.${oversize}${dateNote}`,
    recordBackup: !warnings.length,
  };
}

export { MN_BACKUP_FILE_CAP, mnBackupExportOutcome };
