const test = require('node:test');
const assert = require('node:assert/strict');

const retry = require('../scripts/release-tools/retry-command.js');

// retry-command wraps flaky release steps in CI. Behaviours: a success stops
// the retries, failures back off with growing delays and clean between
// attempts, the final exit code is the real one, and the cleaner can never
// escape the working directory.

function harness({ outcomes }) {
  const calls = { runs: [], cleans: [], waits: [], logs: [], errors: [] };
  let attempt = 0;
  return {
    calls,
    options: {
      attempts: 3, delayMs: 100, cleanPaths: [], command: 'build', commandArgs: ['--flag'],
      run: (command, args) => { calls.runs.push([command, ...args]); return outcomes[attempt++] || { status: 0 }; },
      clean: target => calls.cleans.push(target),
      wait: async ms => calls.waits.push(ms),
      log: { log: m => calls.logs.push(m), error: m => calls.errors.push(m) },
    },
  };
}

test('a success on the first attempt runs once and exits zero', async () => {
  const { options, calls } = harness({ outcomes: [{ status: 0 }] });
  const status = await retry.retryCommand(options);
  assert.equal(status, 0);
  assert.equal(calls.runs.length, 1);
  assert.deepEqual(calls.waits, [], 'no delay after a success');
});

test('failures retry with a growing backoff and clean between attempts', async () => {
  const { options, calls } = harness({ outcomes: [{ status: 1 }, { status: 1 }, { status: 0 }] });
  options.cleanPaths = ['dist'];
  const status = await retry.retryCommand(options);
  assert.equal(status, 0, 'the eventual success must win');
  assert.equal(calls.runs.length, 3);
  assert.deepEqual(calls.waits, [100, 200], 'the delay should grow with the attempt number');
  assert.deepEqual(calls.cleans, ['dist', 'dist'], 'the workspace should be cleaned before each retry');
});

test('exhausted attempts return the real exit code, and do not clean after the last try', async () => {
  const { options, calls } = harness({ outcomes: [{ status: 7 }, { status: 8 }, { status: 9 }] });
  options.cleanPaths = ['dist'];
  const status = await retry.retryCommand(options);
  assert.equal(status, 9, 'the last real exit code must surface to CI');
  assert.equal(calls.cleans.length, 2, 'cleaning after the final failure would destroy the evidence');
});

test('a command that cannot start is reported and still retried', async () => {
  const { options, calls } = harness({
    outcomes: [{ error: new Error('ENOENT: no such command') }, { status: 0 }],
  });
  const status = await retry.retryCommand(options);
  assert.equal(status, 0);
  assert.ok(calls.errors.some(m => /could not start/.test(m)));
});

test('the argument parser understands the CI invocation', () => {
  const options = retry.parseArgs(['--attempts', '5', '--delay-ms', '50', '--clean', 'dist', '--', 'npm', 'run', 'build']);
  assert.equal(options.attempts, 5);
  assert.equal(options.delayMs, 50);
  assert.deepEqual(options.cleanPaths, ['dist']);
  assert.equal(options.command, 'npm');
  assert.deepEqual(options.commandArgs, ['run', 'build']);
});

test('malformed invocations fail with usage instead of running nothing', () => {
  assert.throws(() => retry.parseArgs(['npm', 'run', 'build']), /Usage/, 'a missing -- separator must not silently no-op');
  assert.throws(() => retry.parseArgs(['--']), /Usage/, 'a separator with no command must fail');
  assert.throws(() => retry.parseArgs(['--attempts', '0', '--', 'x']), /positive integer/);
  assert.throws(() => retry.parseArgs(['--attempts', 'lots', '--', 'x']), /positive integer/);
  assert.throws(() => retry.parseArgs(['--bogus', '1', '--', 'x']), /Unknown option/);
});

test('the cleaner refuses paths outside the working directory', () => {
  // A misconfigured --clean ../.. in CI would delete the runner's home.
  for (const target of ['..', '../sibling', '/etc', '../../up']) {
    assert.throws(() => retry.defaultClean(target), /outside the working directory/,
      `${target} was allowed`);
  }
});
