function createWindowSecurity({ Menu, protocol, assetScheme, attachments, isAllowedAppNavigation }) {
  function attachEditContextMenu(win) {
    win.webContents.on('context-menu', (_event, params) => {
      const flags = params.editFlags || {};
      const template = [];
      if (params.isEditable) {
        const suggestions = Array.isArray(params.dictionarySuggestions) ? params.dictionarySuggestions.slice(0, 5) : [];
        if (params.misspelledWord && suggestions.length) {
          suggestions.forEach(word => template.push({
            label: word,
            click: () => win.webContents.replaceMisspelling(word),
          }));
          template.push({ type: 'separator' });
        }
        template.push(
          { label: 'Undo', role: 'undo', enabled: !!flags.canUndo },
          { label: 'Redo', role: 'redo', enabled: !!flags.canRedo },
          { type: 'separator' },
          { label: 'Cut', role: 'cut', enabled: !!flags.canCut },
          { label: 'Copy', role: 'copy', enabled: !!flags.canCopy },
          { label: 'Paste', role: 'paste', enabled: !!flags.canPaste },
          { label: 'Delete', role: 'delete', enabled: !!flags.canDelete },
          { type: 'separator' },
          { label: 'Select All', role: 'selectAll', enabled: !!flags.canSelectAll }
        );
        if (params.misspelledWord) {
          template.push(
            { type: 'separator' },
            {
              label: `Add "${params.misspelledWord}" to Dictionary`,
              click: () => win.webContents.session.addWordToSpellCheckerDictionary(params.misspelledWord),
            }
          );
        }
      } else if (params.selectionText) {
        template.push(
          { label: 'Copy', role: 'copy', enabled: !!flags.canCopy },
          { type: 'separator' },
          { label: 'Select All', role: 'selectAll', enabled: !!flags.canSelectAll }
        );
      }
      if (template.length) Menu.buildFromTemplate(template).popup({ window: win });
    });
  }

  function registerAssetProtocol() {
    protocol.handle(assetScheme, async request => {
      try {
        const url = new URL(request.url);
        if (url.host !== 'attachment') return new Response('Not found', { status: 404 });
        const segments = url.pathname.split('/').filter(Boolean).map(part => decodeURIComponent(part));
        if (segments.length !== 2) return new Response('Not found', { status: 404 });
        const [vaultId, fileName] = segments;
        const { buffer, mimeType } = await attachments.readAttachment(vaultId, fileName);
        return new Response(buffer, {
          headers: {
            'Content-Type': mimeType || 'application/octet-stream',
            'Content-Security-Policy': "default-src 'none'",
            'X-Content-Type-Options': 'nosniff',
          },
        });
      } catch {
        return new Response('Not found', { status: 404 });
      }
    });
  }

  function hardenWindow(win) {
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', (event, targetUrl) => {
      if (!isAllowedAppNavigation(targetUrl)) event.preventDefault();
    });
    win.webContents.session.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  }

  return { attachEditContextMenu, registerAssetProtocol, hardenWindow };
}

module.exports = { createWindowSecurity };
