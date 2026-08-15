const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const helpers = require('../src/app/appHelpers.js');
const retryPolicy = require('../src/shared/saveRetryPolicy.js');

// Two lies the save path used to tell:
//
//   1. A failed save logged, popped a modal, and left the pill on "Saving"
//      forever. Nothing retried, because the dirty map was never touched.
//   2. Every note in every vault was rewritten from the novelist vocabulary
//      ("arc::" -> "act::") on its way to disk, novelist vault or not.
//
// This file pins both closed.

function source(relativePath) {
  return fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');
}

const blocksToMd = blocks => blocks.map(block => block.content).join('\n');

// A scheduler the test drives by hand, so "waited 4 seconds" is an assertion
// rather than a four-second test.
function manualClock() {
  const queue = [];
  let nextId = 1;
  return {
    queue,
    delays: [],
    schedule(fn, delayMs) {
      const id = nextId++;
      this.delays.push(delayMs);
      queue.push({ id, fn });
      return id;
    },
    cancel(id) {
      const index = queue.findIndex(job => job.id === id);
      if (index >= 0) queue.splice(index, 1);
    },
    // Runs whatever is queued, letting each job queue its own successor,
    // and refuses to spin forever so a hot loop fails loudly.
    async drain(limit = 12) {
      let ran = 0;
      while (queue.length) {
        assert.ok(ran < limit, `the retry queue never drained after ${limit} jobs — this is a hot loop`);
        ran++;
        await queue.shift().fn();
      }
      return ran;
    },
  };
}

test('the retry policy backs off three times and then stops', () => {
  assert.equal(retryPolicy.SAVE_RETRY_MAX_ATTEMPTS, 3);
  assert.deepEqual(retryPolicy.SAVE_RETRY_DELAYS_MS, [1000, 4000, 15000]);
  assert.deepEqual(retryPolicy.nextRetry(0), { delayMs: 1000, phase: 'retrying' });
  assert.deepEqual(retryPolicy.nextRetry(1), { delayMs: 4000, phase: 'retrying' });
  assert.deepEqual(retryPolicy.nextRetry(2), { delayMs: 15000, phase: 'retrying' });
  assert.deepEqual(retryPolicy.nextRetry(3), { delayMs: null, phase: 'exhausted' },
    'after the last delay the app stops on its own');
  assert.deepEqual(retryPolicy.nextRetry(99), { delayMs: null, phase: 'exhausted' });
  assert.deepEqual(retryPolicy.nextRetry(), { delayMs: 1000, phase: 'retrying' }, 'no attempts yet means the first delay');
});

test('a saveNote that keeps rejecting is retried on the backoff, capped, with one notice', async () => {
  const clock = manualClock();
  const notices = [];
  const phases = [];
  const key = 'vault-1::note-1';
  const tracker = retryPolicy.createSaveRetryTracker({
    schedule: (fn, delayMs) => clock.schedule(fn, delayMs),
    cancel: id => clock.cancel(id),
    log: () => {},
    onChange: next => phases.push(next.get(key)?.phase || ''),
  });

  let saveCalls = 0;
  const saveNote = async () => {
    saveCalls++;
    throw new Error('EACCES: permission denied');
  };
  const runSave = async () => {
    try {
      await saveNote();
      tracker.clear(key);
      return true;
    } catch (error) {
      tracker.fail(key, {
        error,
        id: 'note-1',
        vaultId: 'vault-1',
        revision: 7,
        title: 'Chapter one',
        notify: (title, message, tone) => notices.push({ title, message, tone }),
        retry: runSave,
      });
      return false;
    }
  };

  await runSave();
  assert.equal(saveCalls, 1);
  assert.equal(tracker.phaseFor(key), 'retrying', 'the first failure moves the pill off "Saving" immediately');
  assert.deepEqual(notices, [], 'no modal while the app is still trying');

  // No further user input from here — only the scheduler.
  const ran = await clock.drain();

  assert.equal(ran, 3, 'exactly three retries were scheduled and run');
  assert.equal(saveCalls, 4, 'the first attempt plus three retries');
  assert.deepEqual(clock.delays, [1000, 4000, 15000], 'the waits are the policy backoff, in order');
  assert.equal(clock.queue.length, 0, 'nothing is scheduled after the cap — the app stops instead of spinning');
  assert.equal(tracker.phaseFor(key), 'exhausted');
  assert.deepEqual(phases, ['retrying', 'retrying', 'retrying', 'exhausted'],
    'the pill holds "Retrying" across the whole backoff and never flashes back to "Saving"');

  assert.equal(notices.length, 1, 'exactly one notice per failure episode, on exhaustion');
  assert.equal(notices[0].title, 'Not saved yet');
  assert.equal(notices[0].tone, 'warn');
  assert.match(notices[0].message, /tried three times to save “Chapter one”/);
  assert.match(notices[0].message, /nothing has been lost/);
  assert.match(notices[0].message, /\nEACCES: permission denied$/, 'the OS reason goes on its own line');

  // And it really has stopped: another drain finds nothing to do.
  assert.equal(await clock.drain(), 0);
  assert.equal(saveCalls, 4);
});

test('a save that succeeds on retry clears the note back to a clean state', async () => {
  const clock = manualClock();
  const key = 'vault-1::note-1';
  const tracker = retryPolicy.createSaveRetryTracker({
    schedule: (fn, delayMs) => clock.schedule(fn, delayMs),
    cancel: id => clock.cancel(id),
    log: () => {},
  });

  let saveCalls = 0;
  const runSave = async () => {
    saveCalls++;
    if (saveCalls === 1) {
      tracker.fail(key, { error: new Error('EBUSY'), revision: 1, title: 'Chapter one', retry: runSave });
      return false;
    }
    tracker.clear(key);
    return true;
  };

  await runSave();
  assert.equal(tracker.phaseFor(key), 'retrying');
  await clock.drain();
  assert.equal(saveCalls, 2);
  assert.equal(tracker.phaseFor(key), '', 'the first success returns the note to "Saved"');
  assert.equal(tracker.snapshot().size, 0);
});

test('an edit during a failure episode buys the note a fresh set of retries', async () => {
  const clock = manualClock();
  const key = 'vault-1::note-1';
  const tracker = retryPolicy.createSaveRetryTracker({
    schedule: (fn, delayMs) => clock.schedule(fn, delayMs),
    cancel: id => clock.cancel(id),
    log: () => {},
  });
  const fail = revision => tracker.fail(key, { error: new Error('EBUSY'), revision, retry: () => fail(revision) });

  fail(1);
  // Only the scheduled retries spend the backoff, so the episode has to run
  // its course rather than be hurried along by four bare fail() calls.
  await clock.drain();
  assert.equal(tracker.phaseFor(key), 'exhausted');
  assert.equal(fail(1).phase, 'exhausted', 'a failure past the cap stays past the cap');
  // The user types: same note, newer dirty revision.
  const afterEdit = fail(2);
  assert.equal(afterEdit.phase, 'retrying');
  assert.equal(afterEdit.attempts, 1);
});

// ── One notice per exhaustion, and a pill that can come back ────────────────

test('the not-saved notice fires once per exhaustion, and again only after the user edits', async () => {
  const clock = manualClock();
  const notices = [];
  const key = 'vault-1::note-1';
  const tracker = retryPolicy.createSaveRetryTracker({
    schedule: (fn, delayMs) => clock.schedule(fn, delayMs),
    cancel: id => clock.cancel(id),
    log: () => {},
  });
  const fail = revision => tracker.fail(key, {
    error: new Error('EACCES: permission denied'),
    revision,
    title: 'Chapter one',
    notify: (title, message, tone) => notices.push({ title, message, tone }),
    retry: () => fail(revision),
  });

  fail(1);
  await clock.drain();
  assert.equal(tracker.phaseFor(key), 'exhausted');
  assert.equal(notices.length, 1, 'the notice belongs to the transition into "Not saved"');

  // Every later flush — a debounce landing, a window blur, the user typing in
  // some other note — re-enters the save path for this one and fails again.
  // Each of those used to pop the alertdialog, and each dialog steals the
  // caret out of the block the user is typing in.
  fail(1);
  fail(1);
  fail(1);
  assert.equal(tracker.phaseFor(key), 'exhausted', 'the pill still states the truth');
  assert.equal(notices.length, 1, 'exactly one dialog per exhaustion transition');

  // The user does what the notice asked and edits the note: a new episode,
  // the full backoff again, and — when that also fails — a second notice.
  // The flag is a per-episode latch, never a permanent mute.
  fail(2);
  assert.equal(tracker.phaseFor(key), 'retrying');
  assert.equal(notices.length, 1, 'nothing is announced while the app is still trying');
  await clock.drain();
  assert.equal(tracker.phaseFor(key), 'exhausted');
  assert.equal(notices.length, 2, 'a failure the user provoked is told about');
  assert.equal(notices[1].title, 'Not saved yet');
  assert.equal(notices[1].tone, 'warn');
});

test('a conflict, and a delete, both let the status pill return to idle', async () => {
  const clock = manualClock();
  const tracker = retryPolicy.createSaveRetryTracker({
    schedule: (fn, delayMs) => clock.schedule(fn, delayMs),
    cancel: id => clock.cancel(id),
    log: () => {},
  });
  const exhaust = async key => {
    const fail = () => tracker.fail(key, { error: new Error('EBUSY'), id: key, vaultId: 'vault-1', revision: 1, retry: fail });
    fail();
    assert.equal(await clock.drain(), retryPolicy.SAVE_RETRY_MAX_ATTEMPTS);
  };

  // (a) The note then hits a save conflict. The conflict dialog owns the
  //     recovery from here, so the retry episode is over — without the
  //     clear() the pill would read "Not saved" long after it was resolved.
  const conflicted = 'vault-1::note-1';
  await exhaust(conflicted);
  assert.equal(tracker.phaseFor(conflicted), 'exhausted');
  tracker.clear(conflicted);
  assert.equal(tracker.phaseFor(conflicted), '');
  assert.equal(tracker.snapshot().has(conflicted), false);

  // (b) The note is deleted while it is failing. Nothing will ever clear it,
  //     and the sidebar takes the worst status across every vault.
  const deleted = 'vault-1::note-2';
  const kept = 'vault-1::note-3';
  await exhaust(deleted);
  await exhaust(kept);
  assert.equal(tracker.snapshot().size, 2);
  const removed = tracker.prune(new Map([[kept, { id: 'note-3' }]]));
  assert.equal(removed, 1);
  assert.equal(tracker.phaseFor(deleted), '', 'the deleted note stops pinning the sidebar on "Not saved"');
  assert.equal(tracker.snapshot().has(deleted), false);
  assert.equal(tracker.phaseFor(kept), 'exhausted', 'the note that is still dirty keeps its state');

  // Pruning nothing must not hand React a new map, or the effect that calls
  // it re-renders itself forever.
  const before = tracker.snapshot();
  assert.equal(tracker.prune(new Map([[kept, { id: 'note-3' }]])), 0);
  assert.equal(tracker.snapshot(), before, 'a prune that removes nothing commits nothing');
});

test('only a scheduled retry spends a step of the backoff', async () => {
  const clock = manualClock();
  const key = 'vault-1::note-1';
  const tracker = retryPolicy.createSaveRetryTracker({
    schedule: (fn, delayMs) => clock.schedule(fn, delayMs),
    cancel: id => clock.cancel(id),
    log: () => {},
  });
  // Identical calls either way: what differs is whether a retry this module
  // scheduled produced it, or whether the user typing in another note swept
  // this one into the same flush.
  const fail = () => tracker.fail(key, { error: new Error('EBUSY'), revision: 4, title: 'Chapter one', retry: fail });
  const scheduledRetry = () => clock.queue.shift().fn();

  fail();
  assert.deepEqual(clock.delays, [1000]);
  assert.equal(tracker.snapshot().get(key).attempts, 1);

  fail();
  fail();
  assert.deepEqual(clock.delays, [1000], 'an unrelated flush does not burn a retry');
  assert.equal(tracker.snapshot().get(key).attempts, 1, 'the episode is where the policy left it');
  assert.equal(tracker.phaseFor(key), 'retrying');
  assert.equal(clock.queue.length, 1, 'and no second timer is armed for the same note');

  await scheduledRetry();
  assert.deepEqual(clock.delays, [1000, 4000]);
  fail();
  await scheduledRetry();
  assert.deepEqual(clock.delays, [1000, 4000, 15000]);
  fail();
  fail();
  await scheduledRetry();

  assert.deepEqual(clock.delays, [1000, 4000, 15000], 'the waits are still the policy backoff, in order');
  assert.equal(tracker.phaseFor(key), 'exhausted');
  assert.equal(clock.queue.length, 0);
});

test('unmounting cancels pending retries instead of firing into a dead tree', async () => {
  const clock = manualClock();
  const tracker = retryPolicy.createSaveRetryTracker({
    schedule: (fn, delayMs) => clock.schedule(fn, delayMs),
    cancel: id => clock.cancel(id),
    log: () => {},
  });
  let retries = 0;
  tracker.fail('vault-1::note-1', { error: new Error('EBUSY'), revision: 1, retry: () => { retries++; } });
  assert.equal(clock.queue.length, 1);
  tracker.dispose();
  assert.equal(clock.queue.length, 0);
  assert.equal(await clock.drain(), 0);
  assert.equal(retries, 0);
});

// ── The novelist rewrite gate ───────────────────────────────────────────────

const LEGACY_BODY = 'arc:: onboarding\n\n## Arcs\n\n- The first beat\n';

test('a note in a plain vault is written to disk byte-identical', () => {
  const note = {
    id: 'n1',
    title: 'Roadmap',
    date: '2026-05-06T00:00:00.000Z',
    tags: ['novel-arc', 'planning'],
    body: LEGACY_BODY,
  };

  const disk = helpers.noteForDisk(note, blocksToMd, { novelistMode: false });

  assert.equal(disk.body, LEGACY_BODY, 'no arc->act and no Arcs->Acts rewrite outside a novelist vault');
  assert.ok(disk.body.includes('arc:: onboarding'));
  assert.ok(disk.body.includes('## Arcs'));
  assert.deepEqual(disk.tags, ['novel-arc', 'planning'], 'the tag vocabulary is left alone too');
});

test('a note in a novelist vault still gets the legacy migration', () => {
  const note = {
    id: 'n1',
    title: 'Roadmap',
    date: '2026-05-06T00:00:00.000Z',
    tags: ['novel-arc', 'planning'],
    body: LEGACY_BODY,
  };

  const disk = helpers.noteForDisk(note, blocksToMd, { novelistMode: true });

  assert.match(disk.body, /^act:: onboarding$/m);
  assert.match(disk.body, /^## Acts$/m);
  assert.ok(!disk.body.includes('arc:: onboarding'));
  assert.deepEqual(disk.tags, ['novel-act', 'planning']);

  // The two-argument call is what every other caller uses, and it must keep
  // migrating: tests/app-helpers.test.js and tests/novelist-body-helpers.test.js
  // depend on that default and are outside this lane.
  assert.deepEqual(helpers.noteForDisk(note, blocksToMd), disk);
});

// ── Wiring ──────────────────────────────────────────────────────────────────
//
// The pieces above are pure and unit-testable; the bug was in how they are
// joined up. These assertions are the regression guard for the wiring itself.

test('the save loop schedules retries and no longer fires a modal per attempt', () => {
  const controller = source('src/app/controllers/useAppPersistenceController.js');

  assert.match(controller, /saveRetryRef\.current\.fail\(dirtyKey, \{/, 'a failed save records retry state');
  assert.match(controller, /saveRetryRef\.current\.clear\(dirtyKey\)/, 'a success clears it');
  assert.doesNotMatch(controller, /showAppNotice\('Could not save note'/,
    'the per-attempt modal is gone; the one notice comes from the exhausted policy');
  assert.match(controller, /useSaveRetries\(\{ useStateA, useRefA, useEffectA \}\)/);
  assert.match(controller, /noteForDisk\(n, mnBlocksToMd, \{ novelistMode: /,
    'the save path tells noteForDisk which kind of vault it is writing to');

  // A conflict hands recovery to the conflict dialog, so the retry episode is
  // over. Without this the pill still read "Not saved" after it was resolved.
  const conflictAt = controller.indexOf("res.code === 'NOTE_CONFLICT'");
  const conflictBranch = controller.slice(conflictAt, controller.indexOf("throw new Error(res.error || 'Save failed')", conflictAt));
  assert.ok(conflictBranch, 'the NOTE_CONFLICT branch is still where it was');
  assert.match(conflictBranch, /saveRetryRef\.current\.clear\(dirtyKey\);/,
    'a conflict ends the retry episode instead of leaving it stuck');

  // And a note that is no longer dirty at all — deleted, say — must not keep
  // an entry the sidebar's worst-across-vaults status can trip over.
  assert.match(controller, /saveRetryRef\.current\.prune\(dirtyNotes\)/);
});

test('the status pill states retrying and not-saved distinctly, in colour', () => {
  const header = source('src/editor/EditorHeader.jsx');
  const popover = source('src/panels/LocalStatusPopover.jsx');
  const view = source('src/app/AppView.jsx');

  assert.match(header, /Retrying: 'warn'/);
  assert.match(header, /'Not saved': 'danger'/);
  // Asserted verbatim by tests/calm-interface.test.js as well — the pill
  // itself does not change, only the tones it can resolve.
  assert.match(header, /<DsStatusPill tone=\{SAVE_TONES\[saveStatus\] \|\| 'neutral'\}/);

  // The old ternary fell through to T.success, so "Not saved" would have
  // rendered with a green dot beside it.
  assert.match(popover, /dsToneColor\(T, SAVE_TONES\[saveStatus\] \|\| 'neutral'\)/);
  assert.match(popover, /'Not saved': 'danger'/);
  assert.doesNotMatch(popover, /aria-live/, 'the editor pill is the only announcer');

  // Conflict > Not saved > Retrying > Saving > Saved, and the sidebar takes
  // the worst state across every vault.
  assert.match(view, /selectedRetryPhase === 'exhausted' \? 'Not saved'/);
  assert.match(view, /selectedRetryPhase === 'retrying' \? 'Retrying'/);
  assert.match(view, /retryEntries\.some\(entry => entry\.phase === 'exhausted'\) \? 'Not saved'/);
  assert.match(view, /retryEntries\.some\(entry => entry\.phase === 'retrying'\) \? 'Retrying'/);
});
