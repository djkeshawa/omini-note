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

module.exports = { outlinerSource };
