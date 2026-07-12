(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MN_ATTACHMENT_DESCRIPTOR = api;
})(typeof globalThis !== 'undefined' ? globalThis : window, function () {
  /**
   * @typedef {object} AttachmentDescriptor
   * @property {string} fileName Safe file name stored under attachments/.
   * @property {string} relPath Portable vault-relative path.
   * @property {string} mimeType Canonical MIME type.
   * @property {number} size Size in bytes.
   * @property {'image'|'document'|'audio'} kind Presentation category.
   * @property {string} typeLabel Short user-facing type label.
   * @property {boolean} isImage Whether the file can render inline as an image.
   */

  const MAX_ATTACHMENT_BYTES = 50 * 1024 * 1024;

  const TYPE_SPECS = Object.freeze([
    { extensions: ['png'], mimeTypes: ['image/png'], mimeType: 'image/png', kind: 'image', typeLabel: 'PNG image' },
    { extensions: ['jpg', 'jpeg'], mimeTypes: ['image/jpeg'], mimeType: 'image/jpeg', kind: 'image', typeLabel: 'JPEG image' },
    { extensions: ['gif'], mimeTypes: ['image/gif'], mimeType: 'image/gif', kind: 'image', typeLabel: 'GIF image' },
    { extensions: ['webp'], mimeTypes: ['image/webp'], mimeType: 'image/webp', kind: 'image', typeLabel: 'WebP image' },
    { extensions: ['avif'], mimeTypes: ['image/avif'], mimeType: 'image/avif', kind: 'image', typeLabel: 'AVIF image' },
    { extensions: ['bmp'], mimeTypes: ['image/bmp', 'image/x-ms-bmp'], mimeType: 'image/bmp', kind: 'image', typeLabel: 'Bitmap image' },
    { extensions: ['svg'], mimeTypes: ['image/svg+xml'], mimeType: 'image/svg+xml', kind: 'image', typeLabel: 'SVG image' },
    { extensions: ['pdf'], mimeTypes: ['application/pdf'], mimeType: 'application/pdf', kind: 'document', typeLabel: 'PDF' },
    { extensions: ['txt'], mimeTypes: ['text/plain'], mimeType: 'text/plain', kind: 'document', typeLabel: 'Text' },
    { extensions: ['md', 'markdown'], mimeTypes: ['text/markdown', 'text/x-markdown', 'text/plain'], mimeType: 'text/markdown', kind: 'document', typeLabel: 'Markdown' },
    { extensions: ['csv'], mimeTypes: ['text/csv', 'application/csv', 'text/plain'], mimeType: 'text/csv', kind: 'document', typeLabel: 'CSV' },
    { extensions: ['rtf'], mimeTypes: ['application/rtf', 'text/rtf'], mimeType: 'application/rtf', kind: 'document', typeLabel: 'Rich text' },
    { extensions: ['doc'], mimeTypes: ['application/msword'], mimeType: 'application/msword', kind: 'document', typeLabel: 'Word document' },
    { extensions: ['docx'], mimeTypes: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'], mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', kind: 'document', typeLabel: 'Word document' },
    { extensions: ['xls'], mimeTypes: ['application/vnd.ms-excel'], mimeType: 'application/vnd.ms-excel', kind: 'document', typeLabel: 'Excel spreadsheet' },
    { extensions: ['xlsx'], mimeTypes: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'], mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', kind: 'document', typeLabel: 'Excel spreadsheet' },
    { extensions: ['ppt'], mimeTypes: ['application/vnd.ms-powerpoint'], mimeType: 'application/vnd.ms-powerpoint', kind: 'document', typeLabel: 'PowerPoint presentation' },
    { extensions: ['pptx'], mimeTypes: ['application/vnd.openxmlformats-officedocument.presentationml.presentation'], mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', kind: 'document', typeLabel: 'PowerPoint presentation' },
    { extensions: ['odt'], mimeTypes: ['application/vnd.oasis.opendocument.text'], mimeType: 'application/vnd.oasis.opendocument.text', kind: 'document', typeLabel: 'OpenDocument text' },
    { extensions: ['ods'], mimeTypes: ['application/vnd.oasis.opendocument.spreadsheet'], mimeType: 'application/vnd.oasis.opendocument.spreadsheet', kind: 'document', typeLabel: 'OpenDocument spreadsheet' },
    { extensions: ['odp'], mimeTypes: ['application/vnd.oasis.opendocument.presentation'], mimeType: 'application/vnd.oasis.opendocument.presentation', kind: 'document', typeLabel: 'OpenDocument presentation' },
    { extensions: ['mp3'], mimeTypes: ['audio/mpeg', 'audio/mp3'], mimeType: 'audio/mpeg', kind: 'audio', typeLabel: 'MP3 audio' },
    { extensions: ['m4a'], mimeTypes: ['audio/mp4', 'audio/x-m4a'], mimeType: 'audio/mp4', kind: 'audio', typeLabel: 'M4A audio' },
    { extensions: ['wav'], mimeTypes: ['audio/wav', 'audio/x-wav'], mimeType: 'audio/wav', kind: 'audio', typeLabel: 'WAV audio' },
    { extensions: ['ogg'], mimeTypes: ['audio/ogg', 'application/ogg'], mimeType: 'audio/ogg', kind: 'audio', typeLabel: 'Ogg audio' },
    { extensions: ['opus'], mimeTypes: ['audio/opus', 'audio/ogg'], mimeType: 'audio/opus', kind: 'audio', typeLabel: 'Opus audio' },
    { extensions: ['flac'], mimeTypes: ['audio/flac', 'audio/x-flac'], mimeType: 'audio/flac', kind: 'audio', typeLabel: 'FLAC audio' },
    { extensions: ['aac'], mimeTypes: ['audio/aac', 'audio/x-aac'], mimeType: 'audio/aac', kind: 'audio', typeLabel: 'AAC audio' },
  ]);

  const TYPE_BY_EXTENSION = new Map();
  const TYPES_BY_MIME = new Map();
  for (const spec of TYPE_SPECS) {
    for (const extension of spec.extensions) TYPE_BY_EXTENSION.set(extension, spec);
    for (const mimeType of spec.mimeTypes) {
      const current = TYPES_BY_MIME.get(mimeType) || [];
      current.push(spec);
      TYPES_BY_MIME.set(mimeType, current);
    }
  }

  function cleanMimeType(value) {
    return String(value || '').split(';')[0].trim().toLowerCase();
  }

  function attachmentExtension(name) {
    const match = String(name || '').match(/\.([A-Za-z0-9]{1,10})$/);
    return match ? match[1].toLowerCase() : '';
  }

  function classifyAttachment(name, mimeType) {
    const extension = attachmentExtension(name);
    const cleanMime = cleanMimeType(mimeType);
    let spec = extension ? TYPE_BY_EXTENSION.get(extension) : null;
    if (spec && cleanMime && !spec.mimeTypes.includes(cleanMime)) return null;
    if (!spec && !extension && cleanMime) {
      const matches = TYPES_BY_MIME.get(cleanMime) || [];
      if (matches.length) spec = matches[0];
    }
    if (!spec) return null;
    return {
      extension: extension || spec.extensions[0],
      mimeType: spec.mimeType,
      kind: spec.kind,
      typeLabel: spec.typeLabel,
      isImage: spec.kind === 'image',
    };
  }

  function normalizeAttachmentDescriptor(value = {}) {
    const fileName = String(value.fileName || '').slice(0, 120);
    const relPath = String(value.relPath || '').slice(0, 132);
    const classified = classifyAttachment(fileName, value.mimeType);
    if (!classified || relPath !== `attachments/${fileName}`) return null;
    return {
      fileName,
      relPath,
      mimeType: classified.mimeType,
      size: Math.max(0, Math.min(MAX_ATTACHMENT_BYTES, Math.trunc(Number(value.size) || 0))),
      kind: classified.kind,
      typeLabel: classified.typeLabel,
      isImage: classified.isImage,
    };
  }

  function formatAttachmentSize(bytes) {
    const size = Math.max(0, Number(bytes) || 0);
    if (size < 1024) return `${Math.round(size)} B`;
    if (size < 1024 * 1024) return `${Math.max(0.1, size / 1024).toFixed(size < 10 * 1024 ? 1 : 0)} KB`;
    return `${Math.max(0.1, size / (1024 * 1024)).toFixed(size < 10 * 1024 * 1024 ? 1 : 0)} MB`;
  }

  return {
    MAX_ATTACHMENT_BYTES,
    TYPE_SPECS,
    attachmentExtension,
    classifyAttachment,
    cleanMimeType,
    formatAttachmentSize,
    normalizeAttachmentDescriptor,
  };
});
