#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

function parsePositiveInteger(value, name) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}

function parseArgs(argv) {
  const separator = argv.indexOf('--');
  if (separator < 0 || separator === argv.length - 1) {
    throw new Error('Usage: retry-command [--attempts N] [--delay-ms N] [--clean PATH] -- command [args...]');
  }

  const options = {
    attempts: 3,
    delayMs: 20000,
    cleanPaths: [],
    command: argv[separator + 1],
    commandArgs: argv.slice(separator + 2),
  };
  const flags = argv.slice(0, separator);
  for (let index = 0; index < flags.length; index += 1) {
    const flag = flags[index];
    const value = flags[index + 1];
    if (flag === '--attempts') {
      options.attempts = parsePositiveInteger(value, '--attempts');
      index += 1;
    } else if (flag === '--delay-ms') {
      options.delayMs = parsePositiveInteger(value, '--delay-ms');
      index += 1;
    } else if (flag === '--clean') {
      if (!value) throw new Error('--clean requires a path');
      options.cleanPaths.push(value);
      index += 1;
    } else {
      throw new Error(`Unknown option: ${flag}`);
    }
  }
  return options;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function defaultRun(command, args) {
  const isWindows = process.platform === 'win32';
  const executable = isWindows && command === 'npm' ? 'npm.cmd' : command;
  return spawnSync(executable, args, {
    cwd: process.cwd(),
    env: process.env,
    stdio: 'inherit',
    // Node refuses to spawn a .cmd without a shell since the CVE-2024-27980
    // fix, so npm.cmd fails with EINVAL and the Windows release build never
    // starts. Only Windows needs this; elsewhere a shell would just add a
    // quoting hazard for nothing. Release arguments are bare flags, so there
    // is nothing here for cmd.exe to mis-split.
    shell: isWindows,
  });
}

function defaultClean(target) {
  const resolved = path.resolve(process.cwd(), target);
  const relative = path.relative(process.cwd(), resolved);
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`Refusing to clean path outside the working directory: ${target}`);
  }
  fs.rmSync(resolved, { recursive: true, force: true });
}

async function retryCommand({
  attempts,
  delayMs,
  cleanPaths = [],
  command,
  commandArgs = [],
  run = defaultRun,
  clean = defaultClean,
  wait = sleep,
  log = console,
}) {
  let lastStatus = 1;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    log.log(`Attempt ${attempt}/${attempts}: ${[command, ...commandArgs].join(' ')}`);
    const result = run(command, commandArgs);
    if (!result.error && result.status === 0) return 0;

    lastStatus = Number.isInteger(result.status) ? result.status : 1;
    if (result.error) log.error(`Attempt ${attempt} could not start: ${result.error.message}`);
    else if (result.signal) log.error(`Attempt ${attempt} ended from signal ${result.signal}`);
    else log.error(`Attempt ${attempt} failed with exit code ${lastStatus}`);

    if (attempt === attempts) break;
    for (const target of cleanPaths) clean(target);
    await wait(delayMs * attempt);
  }
  return lastStatus;
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const status = await retryCommand(options);
  process.exitCode = status;
}

if (require.main === module) {
  main().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = {
  defaultClean,
  defaultRun,
  main,
  parseArgs,
  retryCommand,
};
