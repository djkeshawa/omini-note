// Renderer entry manifest.
//
// The renderer still exposes browser-global component bridges for compatibility.
// Keeping the load sequence in one entry file makes those dependencies explicit
// while scripts/build-renderer.js bundles the feature folders.
import './shared/theme.jsx';
import './shared/storageUtils.js';
import './shared/data.jsx';
import './shared/markdown.jsx';
import './editor/blockFeatures.jsx';
import './editor/tableOps.js';
import './editor/outline.jsx';
import './editor/editorOps.js';
import './editor/markdownInputRules.js';
import './editor/imageAttachments.js';
import './editor/markdownInlineRenderers.jsx';
import './editor/codeHighlighter.jsx';
import './editor/outlinerHistory.js';
import './editor/outlinerRenderers.jsx';
import './editor/outliner.jsx';
import './panels/graph.jsx';
import './panels/sidebar.jsx';
import './panels/notelist.jsx';
import './editor/editor.jsx';
import './panels/panelHelpers.js';
import './panels/panelShared.jsx';
import './panels/todosPanel.jsx';
import './panels/calendarPanel.jsx';
import './panels/panels.jsx';
import './panels/utilityPanels.jsx';
import './canvas/canvasModel.js';
import './canvas/canvas.jsx';
import './shared/plugins.js';
import './settings/settingsControls.jsx';
import './settings/settings.jsx';
import './ai/aiActions.js';
import './ai/aiRuntime.js';
import './app/appActions.js';
import './ai/aiUi.jsx';
import './ai/ai.jsx';
import './app/appHelpers.js';
import './app/appNovelist.js';
import './app/appMutations.js';
import './app/appCanvasActions.js';
import './app/notesVaultsState.js';
import './app/notesVaultsService.js';
import './app/vaultsService.js';
import './app/appRuntime.js';
import './app/appShell.jsx';
import './app/quickSwitcherModel.js';
import './app/quickSwitcher.jsx';
import './app/app.jsx';

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(React.createElement(window.MnApp));
