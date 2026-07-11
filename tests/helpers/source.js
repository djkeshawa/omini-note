const fs = require('node:fs');
const path = require('node:path');

function outlinerSource(testDir) {
  const editorRoot = path.join(testDir, '../src/editor');
  return [
    fs.readFileSync(path.join(editorRoot, 'outliner.jsx'), 'utf8'),
    ...fs.readdirSync(path.join(editorRoot, 'outliner')).sort()
      .map(name => fs.readFileSync(path.join(editorRoot, 'outliner', name), 'utf8')),
  ].join('\n');
}

function appSource(testDir) {
  const appRoot = path.join(testDir, '../src/app');
  return [
    fs.readFileSync(path.join(appRoot, 'app.jsx'), 'utf8'),
    fs.readFileSync(path.join(appRoot, 'AppView.jsx'), 'utf8'),
    ...fs.readdirSync(path.join(appRoot, 'controllers')).sort()
      .map(name => fs.readFileSync(path.join(appRoot, 'controllers', name), 'utf8')),
  ].join('\n');
}

function appHelpersSource(testDir) {
  const appRoot = path.join(testDir, '../src/app');
  return [
    fs.readFileSync(path.join(appRoot, 'appHelpers.js'), 'utf8'),
    ...fs.readdirSync(path.join(appRoot, 'helpers')).sort()
      .map(name => fs.readFileSync(path.join(appRoot, 'helpers', name), 'utf8')),
  ].join('\n');
}

function backendAiSource(testDir) {
  const libRoot = path.join(testDir, '../lib');
  return [
    fs.readFileSync(path.join(libRoot, 'ai.js'), 'utf8'),
    ...fs.readdirSync(path.join(libRoot, 'ai')).sort()
      .map(name => fs.readFileSync(path.join(libRoot, 'ai', name), 'utf8')),
  ].join('\n');
}

module.exports = { appHelpersSource, appSource, backendAiSource, outlinerSource };
