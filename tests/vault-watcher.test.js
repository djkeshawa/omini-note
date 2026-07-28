const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createVaultWatcher, isRelevantVaultFile } = require('../lib/vaultWatcher');

// fs.watch is replaced so a test can deliver events deterministically; the
// directory and the files in it are real, because mtime is what the watcher
// now reasons about.
function harness() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vispnote-watch-'));
  const seen = [];
  let emit = () => {};
  const watcher = createVaultWatcher({
    debounceMs: 50,
    onChange: change => seen.push(change),
    watch: (_watchPath, _options, listener) => {
      emit = listener;
      return { close() {}, on() {} };
    },
  });
  watcher.refresh([{ id: 'v1', path: dir }]);
  return {
    dir,
    seen,
    watcher,
    write(name, text) {
      fs.writeFileSync(path.join(dir, name), text);
      emit('change', name);
    },
    settle: () => new Promise(resolve => setTimeout(resolve, 160)),
    cleanup() {
      watcher.close();
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

test('a write the app performed itself is not reported as an outside change', async () => {
  const h = harness();
  try {
    h.write('note.md', 'our content');
    h.watcher.markInternal('v1');
    await h.settle();
    assert.deepEqual(h.seen, [], 'our own save must not surface as an external edit');
  } finally {
    h.cleanup();
  }
});

test('an edit made after our save is reported however recently we wrote', async () => {
  const h = harness();
  try {
    // Our save, announced. This is the state that used to open a blind window.
    h.write('note.md', 'our content');
    h.watcher.markInternal('v1');
    await h.settle();
    assert.deepEqual(h.seen, []);

    // Something else writes the same file immediately afterwards. Under the
    // old timer this landed inside the suppression window and was dropped
    // permanently — continuous autosave kept the window open indefinitely.
    await new Promise(resolve => setTimeout(resolve, 12));
    h.write('note.md', 'edited in another app');
    await h.settle();
    assert.equal(h.seen.length, 1, 'the external edit is reported');
    assert.equal(h.seen[0].fileName, 'note.md');
    assert.equal(h.seen[0].vaultId, 'v1');
  } finally {
    h.cleanup();
  }
});

test('a save that lands long after it was announced is still recognised as ours', async () => {
  const h = harness();
  try {
    // Mirrors a save delayed behind the vault lock by a boot rescan or a
    // link-rename cascade: the announcement is old by the time the file moves.
    h.watcher.markInternal('v1');
    await new Promise(resolve => setTimeout(resolve, 30));
    h.write('note.md', 'written late');
    h.watcher.markInternal('v1');
    await h.settle();
    assert.deepEqual(h.seen, [], 'marking after the write is what makes this work');
  } finally {
    h.cleanup();
  }
});

test('an external edit to a second file is reported even while our own save is pending', async () => {
  const h = harness();
  try {
    h.write('ours.md', 'our content');
    h.watcher.markInternal('v1');
    await new Promise(resolve => setTimeout(resolve, 12));
    h.write('theirs.md', 'their content');
    await h.settle();
    assert.equal(h.seen.length, 1);
    assert.equal(h.seen[0].fileName, 'theirs.md', 'suppression is per file, not per vault');
  } finally {
    h.cleanup();
  }
});

test('watcher only considers markdown files in the vault root', () => {
  assert.equal(isRelevantVaultFile('note.md'), true);
  assert.equal(isRelevantVaultFile('.hidden.md'), false);
  assert.equal(isRelevantVaultFile('sub/note.md'), false);
  assert.equal(isRelevantVaultFile('image.png'), false);
  assert.equal(isRelevantVaultFile(''), false);
});

test('closing a vault clears the state that decides what is ours', async () => {
  const h = harness();
  try {
    h.write('note.md', 'our content');
    h.watcher.markInternal('v1');
    // Dropping the vault must not leave a suppression timestamp behind for a
    // vault id that is later recreated.
    h.watcher.refresh([]);
    h.watcher.refresh([{ id: 'v1', path: h.dir }]);
    h.write('note.md', 'changed while unwatched');
    await h.settle();
    assert.equal(h.seen.length, 1, 'a rewatched vault starts with no assumptions');
  } finally {
    h.cleanup();
  }
});
