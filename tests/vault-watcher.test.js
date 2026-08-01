const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createVaultWatcher, isRelevantVaultFile, DEFAULT_MTIME_SKEW_MS } = require('../lib/vaultWatcher');

// fs.watch is replaced so a test can deliver events deterministically; the
// directory and the files in it are real, because mtime is what the watcher
// now reasons about.
const DEBOUNCE_MS = 50;
const SETTLE_TIMEOUT_MS = 4000;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function harness({ mtimeSkewMs } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vispnote-watch-'));
  const seen = [];
  let deliver = () => {};
  const watcher = createVaultWatcher({
    debounceMs: DEBOUNCE_MS,
    mtimeSkewMs,
    onChange: change => seen.push(change),
    watch: (_watchPath, _options, listener) => {
      deliver = listener;
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
      deliver('change', name);
    },
    emit: (eventType, fileName) => deliver(eventType, fileName),
    // Waits for the watcher's debounce to flush.
    //
    // A test that expects events polls for them, so a loaded CI runner cannot
    // fail a test that was merely late. A test that expects none has nothing to
    // poll for and must wait out a window — but it waits a stated multiple of
    // the debounce rather than a magic 160ms, so the margin is visible and
    // scales if the debounce changes.
    async settle(expectedEvents = 0) {
      await sleep(DEBOUNCE_MS * 3);
      if (!expectedEvents) return;
      const deadline = Date.now() + SETTLE_TIMEOUT_MS;
      while (seen.length < expectedEvents && Date.now() < deadline) await sleep(10);
    },
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
    await h.settle(1);
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
    await h.settle(1);
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
    await h.settle(1);
    assert.equal(h.seen.length, 1, 'a rewatched vault starts with no assumptions');
  } finally {
    h.cleanup();
  }
});

test('an edit made before our own save is still reported, not swallowed by it', async () => {
  const h = harness();
  try {
    // Somebody else edits a note, and before the debounce closes our autosave
    // lands on a different one. Against a single vault-wide stamp their edit
    // looked older than our newest write and vanished — and with autosave every
    // 500ms that was most of the time the user was typing.
    h.write('theirs.md', 'their content');
    await new Promise(resolve => setTimeout(resolve, 12));
    h.write('ours.md', 'our content');
    h.watcher.markInternal('v1', ['ours']);
    await h.settle(1);
    assert.equal(h.seen.length, 1);
    assert.equal(h.seen[0].fileName, 'theirs.md');
  } finally {
    h.cleanup();
  }
});

test('every note a link-rename cascade wrote counts as ours', async () => {
  const h = harness();
  try {
    h.write('a.md', 'one');
    h.write('b.md', 'two');
    h.write('c.md', 'three');
    h.watcher.markInternal('v1', ['a', 'b', 'c']);
    await h.settle();
    assert.deepEqual(h.seen, [], 'a save plus its cascade is one internal mutation');
  } finally {
    h.cleanup();
  }
});

test('a mutation that cannot name its notes still suppresses vault-wide', async () => {
  const h = harness();
  try {
    h.write('ours.md', 'our content');
    h.watcher.markInternal('v1');
    await h.settle();
    assert.deepEqual(h.seen, [], 'the blunt fallback stays available for callers without note ids');
  } finally {
    h.cleanup();
  }
});

test('the newest applicable mutation stamp wins across file and vault scopes', async () => {
  const h = harness();
  try {
    h.watcher.markInternal('v1', ['note']);
    await new Promise(resolve => setTimeout(resolve, 12));
    h.write('note.md', 'written by a later broad mutation');
    await new Promise(resolve => setTimeout(resolve, 12));
    h.watcher.markInternal('v1');
    await h.settle();
    assert.deepEqual(h.seen, [], 'a stale file stamp must not override a newer vault-wide stamp');

    h.watcher.markInternal('v1');
    await new Promise(resolve => setTimeout(resolve, 12));
    h.write('other.md', 'written by a later named mutation');
    h.watcher.markInternal('v1', ['other']);
    await h.settle();
    assert.deepEqual(h.seen, [], 'a stale vault-wide stamp must not override a newer file stamp');
  } finally {
    h.cleanup();
  }
});

test('one debounce reports every external Markdown file in a single batch', async () => {
  const h = harness();
  try {
    h.write('one.md', 'one');
    h.write('two.md', 'two');
    h.write('ours.md', 'internal');
    h.watcher.markInternal('v1', ['ours']);
    await h.settle(1);

    assert.equal(h.seen.length, 1, 'a vault batch emits once');
    assert.equal(h.seen[0].fileName, 'one.md', 'legacy consumers still receive the first filename');
    assert.deepEqual(h.seen[0].fileNames, ['one.md', 'two.md']);
    assert.deepEqual(h.seen[0].changes, [
      { fileName: 'one.md', eventType: 'change' },
      { fileName: 'two.md', eventType: 'change' },
    ]);
  } finally {
    h.cleanup();
  }
});

test('a watcher event without a filename requests a full-vault refresh', async () => {
  const h = harness();
  try {
    h.emit('change', null);
    await h.settle(1);

    assert.equal(h.seen.length, 1);
    assert.equal(h.seen[0].fullVault, true);
    assert.equal(h.seen[0].fileName, '');
    assert.deepEqual(h.seen[0].fileNames, []);
    assert.deepEqual(h.seen[0].changes, [{ fileName: null, eventType: 'change' }]);
  } finally {
    h.cleanup();
  }
});

// stat is injected so mtime is stated outright rather than raced for. The bug
// this covers is a clock disagreement, not a scheduling one, so nothing here
// depends on how fast the machine is.
function skewHarness(mtimeSkewMs) {
  const seen = [];
  let deliver = () => {};
  let mtimeMs = 0;
  const watcher = createVaultWatcher({
    debounceMs: DEBOUNCE_MS,
    mtimeSkewMs,
    onChange: change => seen.push(change),
    stat: async () => ({ mtimeMs }),
    watch: (_watchPath, _options, listener) => {
      deliver = listener;
      return { close() {}, on() {} };
    },
  });
  watcher.refresh([{ id: 'v1', path: path.join(os.tmpdir(), 'vispnote-skew-none') }]);
  return {
    seen,
    watcher,
    async changeWithMtime(at) {
      mtimeMs = at;
      deliver('change', 'note.md');
      await sleep(DEBOUNCE_MS * 3);
    },
    cleanup: () => watcher.close(),
  };
}

test('the vault-wide fallback tolerates clock skew, because it has no file to measure', async () => {
  // Windows stamps Date.now() from a ~15.6ms-granular clock while NTFS records
  // file times from a finer source, so a file we just wrote reads as tens of
  // milliseconds newer than the moment we recorded finishing it. At the old
  // 2ms tolerance that surfaced the user's own writes as external edits, and
  // took Windows release validation down at random.
  const h = skewHarness(50);
  try {
    const markedAt = Date.now();
    h.watcher.markInternal('v1');

    await h.changeWithMtime(markedAt + 30);
    assert.deepEqual(h.seen, [], '30ms of clock skew is still our own write');

    // Tolerance, not blindness: past the window it is somebody else.
    await h.changeWithMtime(Date.now() + 5000);
    assert.equal(h.seen.length, 1, 'a genuinely later write is still reported');
    assert.equal(h.seen[0].fileName, 'note.md');
  } finally {
    h.cleanup();
  }
});

test('the fallback tolerance is what decides it, so the platform default has to be wide enough', async () => {
  // Proves the constant is load-bearing rather than decorative: the same 30ms
  // skew that passes above is reported as external under the old 2ms value.
  const h = skewHarness(2);
  try {
    const markedAt = Date.now();
    h.watcher.markInternal('v1');
    await h.changeWithMtime(markedAt + 30);
    assert.equal(h.seen.length, 1, 'this is the failure the platform default exists to prevent');
  } finally {
    h.cleanup();
  }

  assert.ok(DEFAULT_MTIME_SKEW_MS >= 2, 'some tolerance is always needed');
  if (process.platform === 'win32') {
    assert.ok(
      DEFAULT_MTIME_SKEW_MS >= 16,
      'Windows needs more than one system clock tick (~15.6ms) of tolerance'
    );
  }
});

// Both stat entry points are injected, so the "filesystem clock" can be placed
// anywhere relative to Date.now() and the named path can be tested for what it
// actually promises: that the wall clock never enters into it.
function namedHarness({ mtimeSkewMs = 0 } = {}) {
  const seen = [];
  let deliver = () => {};
  let mtimeMs = 0;
  const watcher = createVaultWatcher({
    debounceMs: DEBOUNCE_MS,
    mtimeSkewMs,
    onChange: change => seen.push(change),
    stat: async () => ({ mtimeMs }),
    statSync: () => ({ mtimeMs }),
    watch: (_watchPath, _options, listener) => {
      deliver = listener;
      return { close() {}, on() {} };
    },
  });
  watcher.refresh([{ id: 'v1', path: path.join(os.tmpdir(), 'vispnote-named-none') }]);
  return {
    seen,
    watcher,
    setMtime(value) { mtimeMs = value; },
    async change() {
      deliver('change', 'note.md');
      await sleep(DEBOUNCE_MS * 3);
    },
    cleanup: () => watcher.close(),
  };
}

test('a named mutation needs no clock tolerance, however far the clocks disagree', async () => {
  // Zero tolerance, and a filesystem reading an hour ahead of Date.now(). No
  // skew constant could survive that, which is the point: markInternal reads
  // the mtime its own write produced, so both sides of the comparison come
  // from the same clock and the wall clock is never consulted.
  const h = namedHarness({ mtimeSkewMs: 0 });
  try {
    const ourWrite = Date.now() + 3600_000;
    h.setMtime(ourWrite);
    h.watcher.markInternal('v1', ['note']);

    await h.change();
    assert.deepEqual(h.seen, [], 'our own write is ours whatever the clocks say');

    // One millisecond past what we wrote is somebody else, with no grace.
    h.setMtime(ourWrite + 1);
    await h.change();
    assert.equal(h.seen.length, 1, 'a later write is reported with no tolerance to hide in');
    assert.equal(h.seen[0].fileName, 'note.md');
  } finally {
    h.cleanup();
  }
});

test('a named mutation to one note says nothing about another', async () => {
  // The stamp is the mtime of the file we named. A second file sharing that
  // mtime must not inherit the suppression.
  const h = namedHarness({ mtimeSkewMs: 0 });
  try {
    h.setMtime(Date.now());
    h.watcher.markInternal('v1', ['other']);
    await h.change();
    assert.equal(h.seen.length, 1, 'note.md was never claimed by a mutation to other.md');
  } finally {
    h.cleanup();
  }
});
