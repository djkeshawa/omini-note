(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : window, function () {
  const MAX_PREVIEW_ITEMS = 1000;
  const MAX_PREVIEW_WARNINGS = 201;

  function cleanText(value, maxLength = 500) {
    return String(value || '').replace(/\0/g, '').trim().slice(0, maxLength);
  }

  /**
   * @typedef {Object} ImportPreview
   * @property {string} token Opaque, short-lived main-process transaction id.
   * @property {number} noteCount Number of notes that will be created.
   * @property {number} attachmentCount Number of unique safe attachments copied.
   * @property {Array<{source:string,sourceTitle:string,title:string,collision:boolean,attachmentCount:number}>} items
   * @property {Array<{source:string,message:string,omitted?:boolean}>} warnings
   */
  function normalizeImportPreview(value = {}) {
    const token = cleanText(value?.token, 160);
    const items = (Array.isArray(value?.items) ? value.items : [])
      .slice(0, MAX_PREVIEW_ITEMS)
      .map(item => ({
        source: cleanText(item?.source, 500),
        sourceTitle: cleanText(item?.sourceTitle, 240),
        title: cleanText(item?.title, 240) || 'Untitled',
        collision: item?.collision === true,
        attachmentCount: Math.max(0, Math.min(2000, Number(item?.attachmentCount) || 0)),
      }));
    const warnings = (Array.isArray(value?.warnings) ? value.warnings : [])
      .slice(0, MAX_PREVIEW_WARNINGS)
      .map(warning => ({
        source: cleanText(warning?.source, 500),
        message: cleanText(warning?.message, 1000),
        omitted: warning?.omitted === true,
      }))
      .filter(warning => warning.message);
    return {
      token: /^markdown-import-[A-Za-z0-9-]{8,}$/.test(token) ? token : '',
      noteCount: items.length,
      attachmentCount: Math.max(0, Math.min(2000, Number(value?.attachmentCount) || 0)),
      items,
      warnings,
    };
  }

  return { MAX_PREVIEW_ITEMS, MAX_PREVIEW_WARNINGS, normalizeImportPreview };
});
