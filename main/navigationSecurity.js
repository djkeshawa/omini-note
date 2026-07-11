const fs = require('fs');
const { fileURLToPath } = require('url');

function createNavigationSecurity(appHtmlPath) {
  let appHtmlRealPath = null;

  function isAllowedAppNavigation(rawUrl) {
    try {
      const target = new URL(rawUrl);
      if (target.protocol !== 'file:') return false;
      if (!appHtmlRealPath) appHtmlRealPath = fs.realpathSync(appHtmlPath);
      return fs.realpathSync(fileURLToPath(target)) === appHtmlRealPath;
    } catch {
      return false;
    }
  }

  function sanitizeExternalUrl(rawUrl) {
    const value = String(rawUrl || '').trim();
    if (!value || value.length > 2048) throw new Error('Invalid external URL');
    let parsed;
    try {
      parsed = new URL(value);
    } catch {
      throw new Error('Invalid external URL');
    }
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'mailto:') {
      throw new Error('Unsupported external URL protocol');
    }
    if (parsed.protocol === 'mailto:') {
      if (/[\r\n\x00-\x1f\x7f]/.test(value) || /%0d|%0a/i.test(value)) throw new Error('Invalid external URL');
      const address = decodeURIComponent(parsed.pathname || '').trim();
      if (!address || /\s/.test(address) || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(address)) throw new Error('Invalid mailto URL');
    }
    return parsed.href;
  }

  return { isAllowedAppNavigation, sanitizeExternalUrl };
}

module.exports = { createNavigationSecurity };
