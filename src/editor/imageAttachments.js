// Image attachment helpers for the block editor: clipboard/drop detection and
// saving pasted images into the active vault's attachments folder.

(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : window, function () {
  function asFileList(value) {
    try {
      return Array.from(value || []);
    } catch (e) {
      return [];
    }
  }

  function mnImageFilesFromDataTransfer(dataTransfer) {
    return asFileList(dataTransfer && dataTransfer.files)
      .filter(file => /^image\//i.test(String((file && file.type) || '')));
  }

  function mnDataTransferHasFiles(dataTransfer) {
    const types = asFileList(dataTransfer && dataTransfer.types);
    return types.includes('Files');
  }

  function mnImageAltText(name) {
    const base = String(name || '')
      .replace(/\\/g, '/')
      .split('/')
      .pop()
      .replace(/\.[A-Za-z0-9]{1,8}$/, '')
      .replace(/[\[\]()`*~\\\r\n]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 80);
    return base || 'image';
  }

  // Saves each image file through the IPC bridge and returns markdown snippets
  // for the ones that succeeded plus error messages for the ones that failed.
  async function mnSaveImageAttachments(files, options = {}) {
    const bridge = options.bridge || null;
    const vaultId = String(options.vaultId || '');
    const list = asFileList(files);
    if (!list.length) return { markdowns: [], errors: [] };
    if (!vaultId || !bridge || typeof bridge.saveAttachment !== 'function') {
      return { markdowns: [], errors: ['Attachments are unavailable'] };
    }
    const markdowns = [];
    const errors = [];
    for (const file of list) {
      try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        const res = await bridge.saveAttachment(vaultId, {
          name: String(file.name || ''),
          mimeType: String(file.type || ''),
          bytes,
        });
        if (res && res.ok && res.value && res.value.relPath) {
          markdowns.push(`![${mnImageAltText(file.name)}](${res.value.relPath})`);
        } else {
          errors.push((res && res.error) || 'Could not save image');
        }
      } catch (e) {
        errors.push((e && e.message) || String(e));
      }
    }
    return { markdowns, errors };
  }

  return {
    mnImageFilesFromDataTransfer,
    mnDataTransferHasFiles,
    mnImageAltText,
    mnSaveImageAttachments,
  };
});
