const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const baseline = require('./architecture-baseline.json');
const failures = [];
const warnings = [];

function posix(file) {
  return path.relative(ROOT, file).split(path.sep).join('/');
}

function sourceFiles(target) {
  const result = [];
  const visit = (file) => {
    const stat = fs.statSync(file);
    if (stat.isDirectory()) {
      for (const name of fs.readdirSync(file)) visit(path.join(file, name));
      return;
    }
    if (/\.(?:js|jsx|mjs)$/.test(file)) result.push(file);
  };
  visit(target);
  return result;
}

const rendererFiles = sourceFiles(path.join(ROOT, 'src'));
const checkedFiles = [
  path.join(ROOT, 'main.js'),
  path.join(ROOT, 'preload.js'),
  ...rendererFiles,
  ...sourceFiles(path.join(ROOT, 'lib')),
];
const lineCounts = new Map();

for (const folder of ['src/features', 'src/platform', 'src/shared']) {
  if (!fs.existsSync(path.join(ROOT, folder))) failures.push(`Missing architecture folder: ${folder}`);
}

for (const file of checkedFiles) {
  const name = posix(file);
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/).length;
  lineCounts.set(name, lines);
  const allowance = Number(baseline.lineBudgets?.[name]) || 0;
  if (lines > 500) {
    const reason = baseline.softLimitExceptions?.[name];
    if (!allowance) failures.push(`${name} exceeds the 500-line soft limit without a legacy line budget (${lines})`);
    else if (lines > allowance) failures.push(`${name} grew beyond its legacy line budget (${lines} > ${allowance})`);
    const details = [
      reason ? `documented exception: ${String(reason).replace(/[.;]\s*$/, '')}` : '',
      allowance ? `no-growth budget ${allowance}` : '',
    ].filter(Boolean).join('; ');
    warnings.push(`${name}: ${lines} lines${details ? ` (${details})` : ''}`);
  }
  if (lines <= 800) continue;
  if (!allowance) failures.push(`${name} exceeds the 800-line hard limit (${lines})`);
}

for (const name of Object.keys(baseline.lineBudgets || {})) {
  const lines = lineCounts.get(name);
  if (lines == null) warnings.push(`Legacy line budget can be removed because the file is gone: ${name}`);
  else if (lines <= 500) warnings.push(`Legacy line budget can be removed because the file is ${lines} lines: ${name}`);
}

const directBridgeFiles = new Set();
const assignedGlobals = new Set();
const legacyGlobalReads = new Set();
for (const file of rendererFiles) {
  const name = posix(file);
  const source = fs.readFileSync(file, 'utf8');
  if (/\bwindow\.mn\b/.test(source) && !name.startsWith('src/platform/')) directBridgeFiles.add(name);
  if (/\b(?:window|globalThis)\.(?:MN_[A-Z0-9_]+|Mn[A-Z][A-Za-z0-9_]*|mn[A-Z][A-Za-z0-9_]*)\b/.test(source)) legacyGlobalReads.add(name);
  for (const match of source.matchAll(/\bwindow\.([A-Za-z0-9_]+)\s*=/g)) assignedGlobals.add(match[1]);
}

const allowedBridgeFiles = new Set(baseline.directBridgeFiles);
for (const file of directBridgeFiles) {
  if (!allowedBridgeFiles.has(file)) failures.push(`Direct preload bridge access outside src/platform: ${file}`);
}
for (const file of allowedBridgeFiles) {
  if (!directBridgeFiles.has(file)) warnings.push(`Direct bridge allowlist can shrink: ${file}`);
}
if (assignedGlobals.size !== baseline.legacyGlobalAssignments) {
  failures.push(`Renderer global count differs from the required baseline (${assignedGlobals.size} !== ${baseline.legacyGlobalAssignments})`);
}
for (const file of legacyGlobalReads) failures.push(`Renderer feature global access is forbidden: ${file}`);

const importPattern = /(?:import\s+(?:[^'\"]*?\s+from\s+)?|export\s+[^'\"]*?\s+from\s+)["']([^"']+)["']/g;
const graph = new Map();
function resolveImport(file, request) {
  if (!request.startsWith('.')) return null;
  const base = path.resolve(path.dirname(file), request);
  for (const candidate of [base, `${base}.js`, `${base}.jsx`, `${base}.mjs`, path.join(base, 'index.js')]) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  }
  return null;
}

for (const file of rendererFiles) {
  const name = posix(file);
  const imports = [];
  const source = fs.readFileSync(file, 'utf8');
  for (const match of source.matchAll(importPattern)) {
    const target = resolveImport(file, match[1]);
    if (!target) continue;
    const targetName = posix(target);
    imports.push(target);
    if (name.startsWith('src/shared/') && /src\/(?:app|features)\//.test(targetName)) {
      failures.push(`Shared module imports an upper layer: ${name} -> ${targetName}`);
    }
    if (name.startsWith('src/platform/') && /src\/(?:app|features)\//.test(targetName)) {
      failures.push(`Platform module imports an upper layer: ${name} -> ${targetName}`);
    }
    if (name.startsWith('src/features/') && targetName.startsWith('src/app/')) {
      failures.push(`Feature imports app composition: ${name} -> ${targetName}`);
    }
    if (!name.startsWith('src/features/') && targetName.startsWith('src/features/') && !targetName.endsWith('/index.js')) {
      failures.push(`Feature internal imported outside its public entry point: ${name} -> ${targetName}`);
    }
  }
  graph.set(file, imports);
}

const visiting = new Set();
const visited = new Set();
function visit(file, stack = []) {
  if (visiting.has(file)) {
    const start = stack.indexOf(file);
    failures.push(`Renderer import cycle: ${stack.slice(start).concat(file).map(posix).join(' -> ')}`);
    return;
  }
  if (visited.has(file)) return;
  visiting.add(file);
  for (const dependency of graph.get(file) || []) visit(dependency, stack.concat(file));
  visiting.delete(file);
  visited.add(file);
}
for (const file of rendererFiles) visit(file);

if (warnings.length) {
  console.log('Architecture debt report:');
  for (const warning of warnings) console.log(`  - ${warning}`);
}
if (failures.length) {
  console.error('Architecture checks failed:');
  for (const failure of [...new Set(failures)]) console.error(`  - ${failure}`);
  process.exit(1);
}
console.log(`Architecture checks passed (${rendererFiles.length} renderer modules, ${assignedGlobals.size} legacy globals).`);
