const fs = require('fs');
const os = require('os');
const path = require('path');

const parentPid = Number(process.argv[2]);
const target = path.resolve(String(process.argv[3] || ''));
const tempRoot = path.resolve(os.tmpdir());

function isSafeTarget() {
  const relative = path.relative(tempRoot, target);
  return Number.isInteger(parentPid)
    && parentPid > 0
    && Boolean(relative)
    && !relative.startsWith('..')
    && !path.isAbsolute(relative)
    && path.basename(target).startsWith('vispnote-');
}

function parentIsRunning() {
  try {
    process.kill(parentPid, 0);
    return true;
  } catch {
    return false;
  }
}

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function removeTarget() {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      fs.rmSync(target, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
      return;
    } catch {
      await wait(250);
    }
  }
}

async function main() {
  if (!isSafeTarget()) return;
  for (let attempt = 0; attempt < 600 && parentIsRunning(); attempt += 1) {
    await wait(100);
  }
  if (!parentIsRunning()) await removeTarget();
}

main().catch(() => {});
