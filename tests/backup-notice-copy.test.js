const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadRendererModule } = require('./helpers/rendererModule.js');

const { MN_BACKUP_FILE_CAP, mnBackupExportOutcome } = loadRendererModule('src/app/helpers/backupNoticeCopy.js');

function noteMiss(file) { return { type: 'note-read', vaultId: 'v1', file }; }
function canvasMiss(canvasId) { return { type: 'canvas-read', vaultId: 'v1', canvasId }; }

// An unreadable canvas used to be reported as a missing note, and counted into
// the notes denominator on the way, so the notice named the wrong thing and got
// the total wrong at the same time.
test('a backup missing only notes counts and names notes', () => {
  const outcome = mnBackupExportOutcome({
    noteCount: 8, canvasCount: 4,
    warnings: [noteMiss('n_one.md'), noteMiss('n_two.md')],
  });
  assert.equal(outcome.tone, 'warn');
  assert.equal(outcome.recordBackup, false);
  assert.equal(outcome.title, 'Backup saved, 2 notes missing');
  assert.match(outcome.message, /^VispNote could not read 2 of 10 notes, so they are not in this backup:/);
  assert.doesNotMatch(outcome.message, /canvas/);
  assert.match(outcome.message, /n_one\.md\nn_two\.md/);
});

test('a backup missing one note says note, not notes', () => {
  const outcome = mnBackupExportOutcome({ noteCount: 3, canvasCount: 0, warnings: [noteMiss('n_one.md')] });
  assert.equal(outcome.title, 'Backup saved, 1 note missing');
  assert.match(outcome.message, /could not read 1 of 4 notes/);
});

test('a backup missing only canvases counts and names canvases', () => {
  const outcome = mnBackupExportOutcome({
    noteCount: 8, canvasCount: 4,
    warnings: [canvasMiss('c_one'), canvasMiss('c_two')],
  });
  assert.equal(outcome.title, 'Backup saved, 2 canvases missing');
  assert.match(outcome.message, /^VispNote could not read 2 of 6 canvases, so they are not in this backup:/);
  assert.doesNotMatch(outcome.message, /notes/, 'the canvases were counted against the note total');
  assert.match(outcome.message, /c_one\nc_two/);
});

test('a backup missing one canvas says canvas, never canvas(es)', () => {
  const outcome = mnBackupExportOutcome({ noteCount: 2, canvasCount: 1, warnings: [canvasMiss('c_one')] });
  assert.equal(outcome.title, 'Backup saved, 1 canvas missing');
  assert.match(outcome.message, /could not read 1 of 2 canvases/);
  const source = fs.readFileSync(path.join(__dirname, '../src/app/helpers/backupNoticeCopy.js'), 'utf8');
  assert.doesNotMatch(source, /canvas\(es\)/);
});

test('a backup missing both kinds says items and gives each kind its own denominator', () => {
  const outcome = mnBackupExportOutcome({
    noteCount: 10, canvasCount: 3,
    warnings: [noteMiss('n_one.md'), noteMiss('n_two.md'), canvasMiss('c_one')],
  });
  assert.equal(outcome.title, 'Backup saved, 3 items missing');
  assert.match(
    outcome.message,
    /^VispNote could not read 2 of 12 notes and VispNote could not read 1 of 4 canvases, so they are not in this backup:/
  );
  // Notes first, then canvases, in one combined list.
  assert.match(outcome.message, /n_one\.md\nn_two\.md\nc_one/);
});

test('one missing note and one missing canvas is 2 items, not 1 note', () => {
  const outcome = mnBackupExportOutcome({
    noteCount: 1, canvasCount: 1,
    warnings: [noteMiss('n_one.md'), canvasMiss('c_one')],
  });
  assert.equal(outcome.title, 'Backup saved, 2 items missing');
});

// The notice shell is a fixed 400px with no scroll container, so an uncapped
// list pushes OK off screen. A vault with both kinds broken would re-create
// that overflow if the cap were applied per kind.
test('the file list is capped across notes and canvases together', () => {
  const warnings = [
    ...Array.from({ length: 4 }, (_, i) => noteMiss(`n_${i}.md`)),
    ...Array.from({ length: 4 }, (_, i) => canvasMiss(`c_${i}`)),
  ];
  const outcome = mnBackupExportOutcome({ noteCount: 20, canvasCount: 20, warnings });
  assert.equal(MN_BACKUP_FILE_CAP, 5);
  assert.equal(outcome.title, 'Backup saved, 8 items missing');
  const listed = outcome.message.split('backup:\n')[1].split('\n\n')[0].split('\n');
  assert.deepEqual(listed, ['n_0.md', 'n_1.md', 'n_2.md', 'n_3.md', 'c_0', '+ 3 more']);
});

test('a status-write failure is never counted as a missing file', () => {
  const outcome = mnBackupExportOutcome({
    vaultCount: 2, filePath: '/home/u/backups/vispnote-backup.json', noteCount: 5, canvasCount: 1,
    warnings: [{ type: 'backup-status', message: 'status write failed' }],
  });
  assert.equal(outcome.tone, 'warn');
  assert.equal(outcome.title, 'Backup exported');
  assert.match(outcome.message, /2 vaults saved to vispnote-backup\.json\./);
  assert.match(outcome.message, /the last-backup date could not be updated/);
});

test('a complete export is a success with no missing-file copy', () => {
  const outcome = mnBackupExportOutcome({ vaultCount: 1, filePath: '/tmp/b.json', noteCount: 5, canvasCount: 2, warnings: [] });
  assert.equal(outcome.tone, 'success');
  assert.equal(outcome.recordBackup, true);
  assert.equal(outcome.title, 'Backup exported');
});

test('an oversize warning is appended to an incomplete backup without being counted as missing', () => {
  const outcome = mnBackupExportOutcome({
    noteCount: 9, canvasCount: 0,
    warnings: [
      noteMiss('n_one.md'),
      { type: 'backup-too-large', breached: 'notes', noteCount: 9, sizeMb: 62.5, sizeLimitMb: 50, limit: 5 },
    ],
  });
  assert.equal(outcome.title, 'Backup saved, 1 note missing');
  assert.match(outcome.message, /could not read 1 of 10 notes/);
  assert.match(outcome.message, /This backup holds 9 notes \(62\.5 MB\) and is over the restore limit/);
});

// The deleted note's snapshot is what lands in the trash and comes back on
// restore. Taken with the two-argument default it was silently rewritten.
test('the delete path tells noteForDisk which kind of vault it is snapshotting', () => {
  const actions = fs.readFileSync(path.join(__dirname, '../src/app/controllers/useAppDataActions.js'), 'utf8');
  assert.match(actions, /noteForDisk\(n, mnBlocksToMd, \{ novelistMode: /,
    'the trash snapshot still takes the arc -> act migrating default');
});

test('a plain vault round-trips arc:: through noteForDisk unchanged', () => {
  const { createNovelistHelpers } = require('../src/features/writer/novelistHelpers.js');
  const { noteForDisk } = createNovelistHelpers({});
  const note = { id: 'n_1', title: 'Onboarding', tags: [], body: 'arc:: onboarding\n\nThe rest of the note.' };
  const blocksToMd = () => '';

  const plain = noteForDisk(note, blocksToMd, { novelistMode: false });
  assert.match(plain.body, /arc:: onboarding/, "a plain vault's note was migrated to act:: on the way to the trash");
  assert.doesNotMatch(plain.body, /act:: onboarding/);

  // The novelist default is unchanged and still migrates.
  const migrated = noteForDisk(note, blocksToMd);
  assert.match(migrated.body, /act:: onboarding/, 'the novelist migration was dropped along with the bug');
});
