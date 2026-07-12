// General attachment helpers for block-editor clipboard and drop insertion.

(function (root, factory) {
  const descriptorApi = typeof module === 'object' && module.exports
    ? require('../shared/attachmentDescriptor.js')
    : root.MN_ATTACHMENT_DESCRIPTOR;
  const api = factory(descriptorApi);
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : window, function (descriptorApi) {
  const MAX_FILES_PER_INSERT = 20;

  function asFileList(value) {
    try {
      return Array.from(value || []);
    } catch {
      return [];
    }
  }

  function mnAttachmentFilesFromDataTransfer(dataTransfer) {
    return mnFilesFromDataTransfer(dataTransfer)
      .filter(file => descriptorApi.classifyAttachment(file?.name, file?.type));
  }

  function mnFilesFromDataTransfer(dataTransfer) {
    return asFileList(dataTransfer?.files);
  }

  function mnDataTransferHasFiles(dataTransfer) {
    return asFileList(dataTransfer?.types).includes('Files');
  }

  function markdownSafeLabel(name, fallback = 'attachment') {
    const clean = String(name || '')
      .replace(/\\/g, '/')
      .split('/')
      .pop()
      .replace(/[\[\]()`*~\\\r\n]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 100);
    return clean || fallback;
  }

  function imageAltText(name) {
    const withoutExtension = markdownSafeLabel(name, 'image').replace(/\.[A-Za-z0-9]{1,10}$/, '').trim();
    return withoutExtension || 'image';
  }

  function attachmentMarkdown(descriptor, originalName) {
    const normalized = descriptorApi.normalizeAttachmentDescriptor(descriptor);
    if (!normalized) return '';
    if (normalized.isImage) return `![${imageAltText(originalName)}](${normalized.relPath})`;
    return `[${markdownSafeLabel(originalName, normalized.fileName)}](${normalized.relPath})`;
  }

  async function mnSaveAttachments(files, options = {}) {
    const bridge = options.bridge || null;
    const vaultId = String(options.vaultId || '');
    const allFiles = asFileList(files);
    const list = allFiles.slice(0, MAX_FILES_PER_INSERT);
    if (!list.length) return { markdowns: [], descriptors: [], errors: [] };
    if (!vaultId || !bridge || typeof bridge.saveAttachment !== 'function') {
      return { markdowns: [], descriptors: [], errors: ['Attachments are unavailable'] };
    }
    const markdowns = [];
    const descriptors = [];
    const errors = allFiles.length > MAX_FILES_PER_INSERT
      ? [`Only the first ${MAX_FILES_PER_INSERT} files were considered.`]
      : [];
    for (const file of list) {
      if (!descriptorApi.classifyAttachment(file?.name, file?.type)) {
        errors.push(`Unsupported file type: ${markdownSafeLabel(file?.name)}`);
        continue;
      }
      const declaredSize = Number(file?.size);
      if (Number.isFinite(declaredSize) && declaredSize > descriptorApi.MAX_ATTACHMENT_BYTES) {
        errors.push(`${markdownSafeLabel(file?.name)} is larger than 50 MB.`);
        continue;
      }
      try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        const res = await bridge.saveAttachment(vaultId, {
          name: String(file.name || ''),
          mimeType: String(file.type || ''),
          bytes,
        });
        const descriptor = res?.ok ? descriptorApi.normalizeAttachmentDescriptor(res.value) : null;
        const markdown = descriptor ? attachmentMarkdown(descriptor, file.name) : '';
        if (descriptor && markdown) {
          descriptors.push(descriptor);
          markdowns.push(markdown);
        } else {
          errors.push(res?.error || `Could not save ${markdownSafeLabel(file.name)}`);
        }
      } catch (error) {
        errors.push(error?.message || String(error));
      }
    }
    return { markdowns, descriptors, errors };
  }

  return {
    MAX_FILES_PER_INSERT,
    attachmentMarkdown,
    imageAltText,
    markdownSafeLabel,
    mnAttachmentFilesFromDataTransfer,
    mnDataTransferHasFiles,
    mnFilesFromDataTransfer,
    mnSaveAttachments,
  };
});
