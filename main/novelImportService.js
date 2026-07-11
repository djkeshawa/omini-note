function createNovelImportService({ fs, path, dialog, getMainWindow, limits }) {
  function isBinaryLikeText(buffer, text) {
    if (!buffer || !buffer.length) return false;
    if (buffer.includes(0)) return true;
    const replacementCount = (String(text || '').match(/\uFFFD/g) || []).length;
    if (replacementCount > Math.max(3, text.length * 0.01)) return true;
    const sample = buffer.subarray(0, Math.min(buffer.length, 4096));
    let control = 0;
    for (const byte of sample) {
      if (byte < 32 && byte !== 9 && byte !== 10 && byte !== 13) control++;
    }
    return control > Math.max(8, sample.length * 0.04);
  }

  async function readFile(filePath, remainingBytes) {
    const name = path.basename(filePath || 'file');
    const stat = await fs.promises.lstat(filePath);
    if (stat.isSymbolicLink()) return { skipped: { name, reason: 'Symlinks are not allowed.' } };
    if (!stat.isFile()) return { skipped: { name, reason: 'Only files can be imported.' } };
    if (stat.size <= 0) return { skipped: { name, reason: 'File is empty.' } };
    if (stat.size > limits.fileBytes) return { skipped: { name, reason: 'File is larger than 750 KB.' } };
    if (remainingBytes <= 0 || stat.size > remainingBytes) return { skipped: { name, reason: 'Selected files exceed the 2 MB import limit.' } };
    const buffer = await fs.promises.readFile(filePath);
    let text = buffer.toString('utf8').replace(/\r\n/g, '\n').replace(/\0/g, '').trim();
    if (isBinaryLikeText(buffer, text)) return { skipped: { name, reason: 'File does not look like readable UTF-8 text.' } };
    if (!text) return { skipped: { name, reason: 'File has no readable text.' } };
    if (Buffer.byteLength(text, 'utf8') > remainingBytes) return { skipped: { name, reason: 'Selected files exceed the 2 MB import limit.' } };
    return { file: { name, size: stat.size, text } };
  }

  async function importFiles() {
    const result = await dialog.showOpenDialog(getMainWindow(), {
      title: 'Import novel files',
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: 'Text-like files', extensions: ['txt', 'md', 'markdown', 'text', 'csv', 'json', 'log'] },
        { name: 'All files', extensions: ['*'] },
      ],
    });
    if (result.canceled || !result.filePaths?.length) return { canceled: true, files: [], skipped: [] };
    const filePaths = result.filePaths.slice(0, limits.fileCount);
    const skipped = result.filePaths.slice(limits.fileCount)
      .map(filePath => ({ name: path.basename(filePath), reason: 'Only the first 8 files were imported.' }));
    const files = [];
    let remainingBytes = limits.totalTextBytes;
    for (const filePath of filePaths) {
      try {
        const item = await readFile(filePath, remainingBytes);
        if (item.file) {
          files.push(item.file);
          remainingBytes -= Buffer.byteLength(item.file.text, 'utf8');
        } else if (item.skipped) skipped.push(item.skipped);
      } catch (error) {
        skipped.push({ name: path.basename(filePath || 'file'), reason: error.message || String(error) });
      }
    }
    return { canceled: false, files, skipped };
  }

  return { importFiles };
}

module.exports = { createNovelImportService };
