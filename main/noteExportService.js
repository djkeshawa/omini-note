const NOTE_EXPORT_FORMATS = {
  md: { name: 'Markdown', extensions: ['md'] },
  html: { name: 'HTML', extensions: ['html'] },
  pdf: { name: 'PDF', extensions: ['pdf'] },
};
const PDF_EXPORT_TIMEOUT_MS = 20000;

function exportFileNameForNote(note, format) {
  const base = String(note.title || 'note')
    .replace(/[^\w\s-]+/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 80) || 'note';
  return `${base}.${format}`;
}

function createNoteExportService({ app, BrowserWindow, fs, path, store, dialog, exportHtml, attachments, getMainWindow }) {
  async function renderHtmlToPdf(html) {
    const win = new BrowserWindow({
      show: false,
      webPreferences: {
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        webSecurity: true,
      },
    });
    const tmpDir = await fs.promises.mkdtemp(path.join(app.getPath('temp'), 'vispnote-export-'));
    const tmpFile = path.join(tmpDir, 'note.html');
    const timeout = label => new Promise((_resolve, reject) => {
      setTimeout(() => reject(new Error(`PDF export timed out (${label})`)), PDF_EXPORT_TIMEOUT_MS).unref?.();
    });
    try {
      await fs.promises.writeFile(tmpFile, html, 'utf8');
      await Promise.race([win.loadFile(tmpFile), timeout('load')]);
      return await Promise.race([
        win.webContents.printToPDF({
          printBackground: true,
          pageSize: 'A4',
          margins: { top: 0.6, bottom: 0.6, left: 0.6, right: 0.6 },
        }),
        timeout('print'),
      ]);
    } finally {
      win.destroy();
      fs.promises.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    }
  }

  async function exportNote(vaultId, noteId, rawFormat) {
    const format = Object.prototype.hasOwnProperty.call(NOTE_EXPORT_FORMATS, rawFormat) ? rawFormat : 'md';
    const note = await store.getNote(vaultId, noteId);
    if (!note) throw new Error('Note not found');
    const result = await dialog.showSaveDialog(getMainWindow(), {
      title: `Export note as ${format.toUpperCase()}`,
      defaultPath: exportFileNameForNote(note, format),
      filters: [NOTE_EXPORT_FORMATS[format]],
    });
    if (result.canceled || !result.filePath) return { canceled: true };
    try {
      const targetStat = await fs.promises.lstat(result.filePath);
      if (targetStat.isSymbolicLink()) throw new Error('Note export target cannot be a symlink');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    if (format === 'md') {
      await store.atomicWriteFile(result.filePath, exportHtml.exportMarkdown(note), 'utf8');
      return { canceled: false, filePath: result.filePath, format };
    }
    const html = await exportHtml.renderNoteHtml(note, {
      resolveAttachment: async fileName => {
        try { return await attachments.readAttachment(vaultId, fileName); } catch { return null; }
      },
    });
    if (format === 'html') {
      await store.atomicWriteFile(result.filePath, html, 'utf8');
      return { canceled: false, filePath: result.filePath, format };
    }
    const pdf = await renderHtmlToPdf(html);
    await store.atomicWriteFile(result.filePath, pdf, null);
    return { canceled: false, filePath: result.filePath, format };
  }

  return { exportNote };
}

module.exports = { NOTE_EXPORT_FORMATS, exportFileNameForNote, createNoteExportService };
