const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ops = require('../src/editorOps.js');
const tableOps = require('../src/tableOps.js');
const appHelpers = require('../src/appHelpers.js');
const appNovelist = require('../src/appNovelist.js');
const appMutations = require('../src/appMutations.js');
const appCanvasActions = require('../src/appCanvasActions.js');
const panelHelpers = require('../src/panelHelpers.js');
const { block, loadOutlineForTest, withIsolatedStore } = require('./helpers/common.js');

test('First-run seed creates one notes vault and one novelist vault', async () => {
  await withIsolatedStore(async (store) => {
    const vaults = await store.listVaults();
    assert.equal(vaults.length, 2);
    assert.deepEqual(vaults.map(v => v.name), ['Personal', 'Novel']);

    const personalVault = vaults.find(v => v.name === 'Personal');
    const novelVault = vaults.find(v => v.name === 'Novel');
    assert.equal(personalVault.novelistMode, false);
    assert.equal(novelVault.novelistMode, true);

    const personal = await store.loadVault(personalVault.id);
    const novel = await store.loadVault(novelVault.id);

    assert.equal(personal.notes.length, 3);
    assert.deepEqual(personal.notes.map(note => note.title).sort(), ['Project plan', 'Reading notes', 'Welcome to VispNote']);
    assert.equal(novel.notes.length, 3);
    assert.deepEqual(novel.notes.map(note => note.title).sort(), ['Act 1', 'Chapter 1', 'Scene 1']);
    assert.match(novel.notes.find(note => note.title === 'Chapter 1').body, /act:: \[\[Act 1\]\]/);
    assert.match(novel.notes.find(note => note.title === 'Scene 1').body, /::: plot-points/);
  });
});

test('New vault creation never reuses stale vault folders', async () => {
  await withIsolatedStore(async (store) => {
    const staleDir = path.join(store.ROOT, 'novel');
    fs.mkdirSync(staleDir, { recursive: true });
    fs.writeFileSync(
      path.join(staleDir, 'n_old.md'),
      '---\nid: n_old\ntitle: Previous Novel\ntags: [novel-scene]\n---\n\nOld scene\n',
      'utf8'
    );

    const vault = await store.createVault('Novel', { type: 'novelist' });
    assert.equal(vault.slug, 'novel-2');

    const loaded = await store.loadVault(vault.id);
    assert.equal(loaded.novelistMode, true);
    assert.equal(loaded.notes.some(note => note.id === 'n_old'), false);
    assert.equal(loaded.notes.length, 3);
    assert.deepEqual(loaded.notes.map(note => note.title).sort(), ['Act 1', 'Chapter 1', 'Scene 1']);
    assert.equal(loaded.notes.some(note => (note.tags || []).includes('novel-manuscript')), false);
    assert.equal(loaded.notes.some(note => (note.tags || []).includes('novel-arc')), false);
    assert.match(loaded.notes.find(note => note.title === 'Chapter 1').body, /act:: \[\[Act 1\]\]/);
    assert.match(loaded.notes.find(note => note.title === 'Scene 1').body, /::: plot-points/);
  });
});

test('Vault registry repairs externally deleted vault folders', async () => {
  await withIsolatedStore(async (store) => {
    const vaults = await store.listVaults();
    assert.ok(vaults.length >= 2);
    const deleted = vaults[0];
    fs.rmSync(path.join(store.ROOT, deleted.slug), { recursive: true, force: true });

    const repaired = await store.listVaults();
    assert.equal(repaired.some(v => v.id === deleted.id), false);
    assert.ok(repaired.length >= 1);

    await assert.rejects(
      () => store.loadVault(deleted.id),
      /Vault not found/
    );
    assert.equal(fs.existsSync(path.join(store.ROOT, deleted.slug)), false);
  });
});

test('Vault registry creates one fallback vault if every folder is externally deleted', async () => {
  await withIsolatedStore(async (store) => {
    const vaults = await store.listVaults();
    vaults.forEach(v => fs.rmSync(path.join(store.ROOT, v.slug), { recursive: true, force: true }));

    const repaired = await store.listVaults();
    assert.equal(repaired.length, 1);
    assert.equal(repaired[0].name, 'Personal');
    assert.equal(fs.existsSync(path.join(store.ROOT, repaired[0].slug)), true);
    const loaded = await store.loadVault(repaired[0].id);
    assert.equal(loaded.notes.length, 1);
  });
});

test('New novelist vaults stay isolated and persist novelist AI config', async () => {
  await withIsolatedStore(async (store) => {
    const first = await store.createVault('Novel One', { type: 'novelist' });
    await store.saveNote(first.id, {
      id: 'n_custom_scene',
      title: 'Custom Scene',
      date: new Date().toISOString(),
      tags: ['novel-scene'],
      body: 'status:: DRAFT\nchapter:: [[Chapter 1]]\nOnly in the first vault.',
    });

    const second = await store.createVault('Novel Two', { type: 'novelist' });
    await store.saveVaultMeta(second.id, {
      novelistAiConfig: {
        version: 2,
        wordLimit: 1200,
        prompts: [{ id: 'draft', name: 'Draft', prompt: 'Write a scene.' }],
      },
    });

    const firstLoaded = await store.loadVault(first.id);
    const secondLoaded = await store.loadVault(second.id);
    const listed = await store.listVaults();
    const secondMeta = listed.find(v => v.id === second.id);

    assert.equal(firstLoaded.notes.some(note => note.id === 'n_custom_scene'), true);
    assert.equal(secondLoaded.notes.some(note => note.id === 'n_custom_scene'), false);
    assert.deepEqual(secondLoaded.notes.map(note => note.title).sort(), ['Act 1', 'Chapter 1', 'Scene 1']);
    assert.equal(secondLoaded.novelistAiConfig.wordLimit, 1200);
    assert.equal(secondMeta.novelistAiConfig.wordLimit, 1200);
  });
});

test('Note saves create restorable versions and reject stale disk writes', async () => {
  await withIsolatedStore(async (store) => {
    const [vault] = await store.listVaults();
    const loaded = await store.loadVault(vault.id);
    const note = loaded.notes[0];

    await new Promise(resolve => setTimeout(resolve, 12));
    const first = await store.saveNote(vault.id, {
      ...note,
      body: 'first saved body',
    }, { expectedModifiedAt: note.diskModifiedAt });

    await new Promise(resolve => setTimeout(resolve, 12));
    await store.saveNote(vault.id, {
      ...first,
      body: 'second saved body',
    }, { expectedModifiedAt: first.diskModifiedAt });

    const versions = await store.listNoteVersions(vault.id, note.id);
    assert.ok(versions.length >= 2);
    assert.match(versions[0].versionId, /^ver_/);

    await assert.rejects(
      () => store.saveNote(vault.id, {
        ...first,
        body: 'stale overwrite',
      }, { expectedModifiedAt: first.diskModifiedAt }),
      err => err.code === 'NOTE_CONFLICT'
    );

    const restored = await store.restoreNoteVersion(vault.id, note.id, versions[0].versionId);
    assert.equal(restored.id, note.id);
    assert.match(restored.body, /first saved body|Welcome/i);
  });
});

test('Deleted notes move to trash and can be restored or purged', async () => {
  await withIsolatedStore(async (store) => {
    const [vault] = await store.listVaults();
    const loaded = await store.loadVault(vault.id);
    const note = loaded.notes[0];

    const deleted = await store.deleteNote(vault.id, note.id);
    assert.ok(deleted.trashId);
    assert.equal((await store.loadVault(vault.id)).notes.some(n => n.id === note.id), false);

    const trash = await store.listDeletedNotes(vault.id);
    assert.equal(trash.length, 1);
    assert.equal(trash[0].originalId, note.id);

    const restored = await store.restoreDeletedNote(vault.id, trash[0].trashId);
    assert.equal(restored.id, note.id);
    assert.equal((await store.loadVault(vault.id)).notes.some(n => n.id === note.id), true);

    const deletedAgain = await store.deleteNote(vault.id, note.id);
    await store.purgeDeletedNote(vault.id, deletedAgain.trashId);
    assert.equal((await store.listDeletedNotes(vault.id)).some(item => item.trashId === deletedAgain.trashId), false);
  });
});

test('Canvas deletes are soft-deleted into the vault trash folder', async () => {
  await withIsolatedStore(async (store) => {
    const [vault] = await store.listVaults();
    await store.saveCanvas(vault.id, { id: 'c_safety', title: 'Safety canvas', elements: [] });

    const deleted = await store.deleteCanvas(vault.id, 'c_safety');
    assert.ok(deleted.trashId);
    assert.equal((await store.listCanvases(vault.id)).some(canvas => canvas.id === 'c_safety'), false);
    assert.equal(
      fs.existsSync(path.join(store.ROOT, vault.slug, '.trash', 'canvases', `${deleted.trashId}.json`)),
      true
    );

    const trash = await store.listDeletedCanvases(vault.id);
    assert.equal(trash.some(item => item.trashId === deleted.trashId && item.sourceType === 'canvas'), true);
    const restored = await store.restoreDeletedCanvas(vault.id, deleted.trashId);
    assert.equal(restored.id, 'c_safety');
    assert.equal((await store.listCanvases(vault.id)).some(canvas => canvas.id === 'c_safety'), true);
  });
});

test('Security hardening blocks navigation, unsafe metadata, and unsafe AI endpoints', () => {
  const main = fs.readFileSync(path.join(__dirname, '../main.js'), 'utf8');
  const html = fs.readFileSync(path.join(__dirname, '../OminiNote.html'), 'utf8');
  const app = fs.readFileSync(path.join(__dirname, '../src/app.jsx'), 'utf8');
  const markdown = fs.readFileSync(path.join(__dirname, '../src/markdown.jsx'), 'utf8');
  const storeSource = fs.readFileSync(path.join(__dirname, '../lib/store.js'), 'utf8');
  const indexSource = fs.readFileSync(path.join(__dirname, '../lib/index.js'), 'utf8');
  const aiSource = fs.readFileSync(path.join(__dirname, '../lib/ai.js'), 'utf8');
  const store = require('../lib/store');
  const ai = require('../lib/ai');

  assert.match(main, /const \{ pathToFileURL \} = require\('url'\)/);
  assert.match(main, /function hardenWindow\(win\)/);
  assert.match(main, /setWindowOpenHandler\(\(\) => \(\{ action: 'deny' \}\)\)/);
  assert.match(main, /webContents\.on\('will-navigate'/);
  assert.match(main, /setPermissionRequestHandler/);
  assert.match(main, /sandbox: true/);
  assert.match(main, /webSecurity: true/);
  assert.match(main, /allowRunningInsecureContent: false/);
  assert.match(main, /async function setPrefsFromIpc\(patch\)/);
  assert.match(main, /function sanitizePrefsPatchFromIpc\(patch\)/);
  assert.match(main, /const PREF_TWEAK_KEYS = new Set\(Object\.keys\(PREF_TWEAK_DEFAULTS\)\)/);
  assert.match(main, /if \(!PREF_TOP_LEVEL_KEYS\.has\(key\)\) throw new Error\('Unsupported preferences field: ' \+ key\)/);
  assert.match(main, /if \(!PREF_TWEAK_KEYS\.has\(key\)\) throw new Error\('Unsupported tweak field: ' \+ key\)/);
  assert.match(main, /const cleanPatch = sanitizePrefsPatchFromIpc\(patch\)/);
  assert.match(main, /Object\.prototype\.hasOwnProperty\.call\(cleanPatch, 'aiConfig'\)/);
  assert.match(main, /const config = ai\.setConfig\(cleanPatch\.aiConfig\)/);
  assert.match(main, /store\.setPrefs\(\{ \.\.\.cleanPatch, aiConfig: config \}\)/);
  assert.match(main, /ipcMain\.handle\('mn:setPrefs',\s+wrap\(setPrefsFromIpc\)\)/);
  assert.doesNotMatch(main, /ipcMain\.handle\('mn:setPrefs',\s+wrap\(store\.setPrefs\)\)/);
  assert.match(main, /ai\.setConfig\(prefs\.aiConfig, \{ rejectUnknown: false \}\)/);
  assert.match(main, /saved AI config ignored/);
  assert.match(main, /idx\.init\(\)/);
  assert.match(main, /result\?\.config\?\.provider === 'ollama'/);
  assert.match(main, /store\.setPrefs\(\{ aiConfig: ai\.getConfig\(\) \}\)/);
  assert.match(indexSource, /db\.transaction\(\(\) => \{/);
  assert.match(indexSource, /DROP TABLE note_embeddings/);
  assert.match(app, /replace\(\/\[\^A-Z0-9_-\]\+\/g, '-'\)/);

  assert.match(html, /Content-Security-Policy/);
  assert.match(html, /default-src 'self'/);
  assert.match(html, /script-src 'self'/);
  assert.doesNotMatch(html, /unsafe-eval/);
  assert.doesNotMatch(html, /type="text\/babel"/);
  assert.doesNotMatch(html, /@babel\/standalone/);
  assert.match(html, /react\.production\.min\.js/);
  assert.match(html, /react-dom\.production\.min\.js/);
  assert.match(html, /dist\/renderer\/app\.js/);
  assert.match(html, /object-src 'none'/);
  assert.match(html, /frame-ancestors 'none'/);

  assert.doesNotMatch(markdown, /dangerouslySetInnerHTML/);
  assert.doesNotMatch(markdown, /\.innerHTML\s*=/);

  assert.match(storeSource, /function sanitizeVaultMetaPatch/);
  assert.match(storeSource, /Unsupported vault metadata field/);
  assert.match(storeSource, /if \(states === null \|\| states === undefined\) return null/);
  assert.match(storeSource, /Unsupported preferences field/);

  const cleanMeta = store.__test.sanitizeVaultMetaPatch({
    tags: [{ name: ' Novel Cast ', hue: 999 }, 'novel-research'],
    lastSelectedId: 'n_valid-1',
    novelistMode: true,
    workflowStates: [],
    novelistAiConfig: { wordLimit: 900 },
  });
  assert.deepEqual(cleanMeta.tags, [
    { name: 'novel-cast', hue: 360 },
    { name: 'novel-research', hue: 240 },
  ]);
  assert.equal(cleanMeta.lastSelectedId, 'n_valid-1');
  assert.equal(cleanMeta.novelistMode, true);
  assert.deepEqual(cleanMeta.workflowStates, []);
  assert.deepEqual(cleanMeta.novelistAiConfig, { wordLimit: 900 });
  assert.throws(() => store.__test.sanitizeVaultMetaPatch({ slug: '../x' }), /Unsupported vault metadata field/);
  assert.throws(() => store.__test.sanitizeVaultMetaPatch({ lastSelectedId: '../x' }), /Invalid note id/);
  assert.throws(() => store.__test.sanitizeVaultMetaPatch({ novelistAiConfig: 'bad' }), /Invalid novelist AI config patch/);

  assert.match(aiSource, /function sanitizeConfigPatch/);
  assert.match(aiSource, /SECRET_CONFIG_KEYS/);
  assert.match(aiSource, /piiReduction/);
  assert.match(aiSource, /Invalid \$\{field\} protocol/);
  assert.match(aiSource, /config: publicConfig\(\)/);
  assert.throws(() => ai.__test.sanitizeConfigPatch({ customBaseUrl: 'file:///tmp/model' }), /Invalid customBaseUrl protocol/);
  assert.throws(() => ai.__test.sanitizeConfigPatch({ surprise: true }), /Unsupported AI config field/);
  assert.equal(ai.__test.sanitizeConfigPatch({ piiReduction: false }).piiReduction, false);
  assert.equal(
    ai.__test.sanitizeConfigPatch({ customBaseUrl: 'http://localhost:11434/v1/' }).customBaseUrl,
    'http://localhost:11434/v1'
  );
  assert.equal(
    ai.__test.publicConfig({ openaiApiKey: 'secret-key', provider: 'openai' }).openaiApiKey,
    'configured'
  );
});

test('AI PII reduction masks hosted provider requests and restores local placeholders', async () => {
  const ai = require('../lib/ai');
  const originalConfig = ai.getConfig();
  const originalFetch = global.fetch;
  const sensitive = [
    'Email jane.doe@example.com',
    'phone +1 (415) 555-0134',
    'SSN 123-45-6789',
    'card 4111 1111 1111 1111',
    'address 123 Market Street',
    'token sk-1234567890abcdefghijkl',
    'IP 10.0.0.5',
  ].join(', ');
  const reduced = ai.__test.reducePiiMessages([{ role: 'user', content: sensitive }]);
  const redacted = reduced.messages[0].content;

  assert.match(redacted, /\[EMAIL_1\]/);
  assert.match(redacted, /\[PHONE_1\]/);
  assert.match(redacted, /\[SSN_1\]/);
  assert.match(redacted, /\[CARD_1\]/);
  assert.match(redacted, /\[ADDRESS_1\]/);
  assert.match(redacted, /\[SECRET_1\]/);
  assert.match(redacted, /\[IP_1\]/);
  assert.doesNotMatch(redacted, /jane\.doe@example\.com/);
  assert.equal(
    ai.__test.restorePiiText('Reply to [EMAIL_1] at [PHONE_1].', reduced.replacements),
    'Reply to jane.doe@example.com at +1 (415) 555-0134.'
  );

  let capturedBody = null;
  global.fetch = async (_url, init) => {
    capturedBody = JSON.parse(init.body);
    return {
      ok: true,
      json: async () => ({
        choices: [{ message: { content: 'Use [EMAIL_1] and [PHONE_1].' } }],
      }),
    };
  };

  try {
    ai.setConfig({
      provider: 'custom',
      customBaseUrl: 'https://example.invalid/v1',
      customApiKey: 'test-key',
      chatModel: 'test-model',
      piiReduction: true,
    });
    const result = await ai.__test.providerChat([{ role: 'user', content: sensitive }]);
    const sentMessages = JSON.stringify(capturedBody.messages);
    assert.match(sentMessages, /\[EMAIL_1\]/);
    assert.match(sentMessages, /\[PHONE_1\]/);
    assert.doesNotMatch(sentMessages, /jane\.doe@example\.com/);
    assert.doesNotMatch(sentMessages, /\+1 \(415\) 555-0134/);
    assert.equal(result.text, 'Use jane.doe@example.com and +1 (415) 555-0134.');

    ai.setConfig({ piiReduction: false });
    await ai.__test.providerChat([{ role: 'user', content: 'Email jane.doe@example.com' }]);
    assert.match(JSON.stringify(capturedBody.messages), /jane\.doe@example\.com/);
  } finally {
    global.fetch = originalFetch;
    ai.setConfig(originalConfig, { rejectUnknown: false });
  }
});

test('Data safety wiring exposes trash, versions, and save conflict recovery', () => {
  const main = fs.readFileSync(path.join(__dirname, '../main.js'), 'utf8');
  const preload = fs.readFileSync(path.join(__dirname, '../preload.js'), 'utf8');
  const store = fs.readFileSync(path.join(__dirname, '../lib/store.js'), 'utf8');
  const app = fs.readFileSync(path.join(__dirname, '../src/app.jsx'), 'utf8');
  const settings = fs.readFileSync(path.join(__dirname, '../src/settings.jsx'), 'utf8');
  const editor = fs.readFileSync(path.join(__dirname, '../src/editor.jsx'), 'utf8');

  assert.match(store, /atomicWriteFile/);
  assert.match(store, /NOTE_CONFLICT/);
  assert.match(store, /listDeletedNotes/);
  assert.match(store, /restoreNoteVersion/);
  assert.match(store, /restoreDeletedCanvas/);
  assert.match(main, /mn:listDeletedNotes/);
  assert.match(main, /mn:restoreDeletedCanvas/);
  assert.match(main, /mn:restoreNoteVersion/);
  assert.match(preload, /listNoteVersions/);
  assert.match(preload, /listDeletedCanvases/);
  assert.match(preload, /restoreDeletedNote/);

  assert.match(app, /expectedModifiedAt: n\.diskModifiedAt/);
  assert.match(app, /MnSaveConflictDialog/);
  assert.match(app, /MnVersionHistoryDialog/);
  assert.match(settings, /Recently deleted/);
  assert.match(settings, /onRestoreDeletedNote/);
  assert.match(editor, /Version history/);
});
