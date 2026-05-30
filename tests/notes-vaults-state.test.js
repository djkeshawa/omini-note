const test = require('node:test');
const assert = require('node:assert/strict');

const state = require('../src/app/notesVaultsState.js');

test('notes/vault state helpers update notes and vault lists immutably', () => {
  const notes = [{ id: 'n1', title: 'One' }, { id: 'n2', title: 'Two' }];
  const stamped = state.updateNoteDiskStamp(notes, 'n1', '2026-05-27T00:00:00.000Z');
  assert.equal(stamped[0].diskModifiedAt, '2026-05-27T00:00:00.000Z');
  assert.notEqual(stamped, notes);

  const removed = state.removeNote(notes, 'n1');
  assert.deepEqual(removed.map(note => note.id), ['n2']);

  const vaults = state.upsertVault([{ id: 'v1', name: 'One' }], { id: 'v2', name: 'Two' });
  assert.deepEqual(vaults.map(vault => vault.id), ['v1', 'v2']);
  assert.deepEqual(state.removeVault(vaults, 'v1').map(vault => vault.id), ['v2']);
});
