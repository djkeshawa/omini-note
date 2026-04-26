const { app } = require('electron');
const store = require('../lib/store');
const idx = require('../lib/index');

app.whenReady().then(async () => {
  const cfg = await store.loadConfig();
  idx.init();

  for (const vault of cfg.vaults) {
    const data = await store.loadVault(vault.id);
    idx.rescanVault(vault.id, data.notes);
    const firstNote = data.notes[0] || {};
    const query = (firstNote.title || firstNote.body || '').match(/[A-Za-z0-9]+/)?.[0] || 'note';
    const result = idx.search(vault.id, query, 5);
    if (data.notes.length && !result.length) {
      throw new Error(`Search smoke failed for ${vault.name} with query "${query}"`);
    }
    console.log(`${vault.name}: ${data.notes.length} notes, ${result.length} search hits`);
  }

  idx.close();
  app.quit();
}).catch((error) => {
  console.error(error);
  try { idx.close(); } catch {}
  app.exit(1);
});
