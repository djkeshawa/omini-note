// Renderer entry manifest.
//
// The current renderer is still a browser-global bundle. Keeping the load
// sequence in one entry file makes the modularization target explicit while
// scripts/build-renderer.js continues to wrap each source in an isolated scope.
import './theme.jsx';
import './storageUtils.js';
import './data.jsx';
import './markdown.jsx';
import './blockFeatures.jsx';
import './tableOps.js';
import './outline.jsx';
import './editorOps.js';
import './codeHighlighter.jsx';
import './outlinerHistory.js';
import './outliner.jsx';
import './graph.jsx';
import './sidebar.jsx';
import './notelist.jsx';
import './editor.jsx';
import './panelHelpers.js';
import './panels.jsx';
import './canvas.jsx';
import './plugins.js';
import './settings.jsx';
import './aiActions.js';
import './ai.jsx';
import './appHelpers.js';
import './appNovelist.js';
import './appMutations.js';
import './appCanvasActions.js';
import './appShell.jsx';
import './app.jsx';
