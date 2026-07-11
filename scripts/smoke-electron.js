const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { configureIsolatedUserData, scheduleTempCleanupAfterExit } = require('./test-temp-home');

process.env.VISPNOTE_DISABLE_SINGLE_INSTANCE = '1';
process.env.VISPNOTE_DISABLE_GLOBAL_SHORTCUTS = '1';
process.env.VISPNOTE_EPHEMERAL_SESSION = '1';
const suppliedSmokeHome = process.env.VISPNOTE_HOME;
const ownsSmokeHome = !suppliedSmokeHome;
const smokeHome = suppliedSmokeHome || fs.mkdtempSync(path.join(os.tmpdir(), 'vispnote-smoke-'));
process.env.VISPNOTE_HOME = smokeHome;
configureIsolatedUserData(app, smokeHome);
require('../main');

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitForMainWindow(timeoutMs = 30000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const win = BrowserWindow.getAllWindows().find(item => !item.isDestroyed());
    if (win) return win;
    await wait(100);
  }
  throw new Error('Smoke test timed out waiting for BrowserWindow');
}

async function waitForRenderer(win, timeoutMs = 30000) {
  win.webContents.on('console-message', (_event, details, legacyMessage, legacyLine, legacySourceId) => {
    const structured = details && typeof details === 'object' ? details : null;
    const level = structured?.level ?? details ?? 'log';
    const message = structured?.message ?? legacyMessage ?? '';
    const sourceId = structured?.sourceId ?? legacySourceId ?? '';
    const line = structured?.lineNumber ?? legacyLine ?? 0;
    console.log(`[renderer:${level}] ${message} (${sourceId}:${line})`);
  });
  const started = Date.now();
  let lastState = null;
  while (Date.now() - started < timeoutMs) {
    if (win.isDestroyed()) throw new Error('Smoke test window was destroyed');
    let state = null;
    try {
      state = await win.webContents.executeJavaScript(`
        (() => {
          const root = document.querySelector('#root');
          const splash = document.querySelector('.mn-boot-splash');
          const text = document.body?.textContent || '';
          return {
            mounted: Boolean(root?.children.length),
            loading: Boolean(splash) && text.includes('Opening vault and indexing notes'),
            error: Boolean(splash) && text.includes('Launch interrupted'),
            text: text.slice(0, 300),
          };
        })()
      `);
    } catch {}
    if (state) {
      lastState = state;
      if (state.mounted && !state.loading && !state.error) return;
      if (state.error) throw new Error(`Renderer boot failed: ${state.text}`);
    }
    await wait(250);
  }
  throw new Error(`Smoke test timed out waiting for renderer boot: ${JSON.stringify(lastState)}`);
}

async function removeSmokeHome() {
  if (process.env.VISPNOTE_KEEP_SMOKE_HOME || !ownsSmokeHome) return;
  try { require('../lib/index').close(); } catch {}
  scheduleTempCleanupAfterExit(smokeHome);
}

app.whenReady().then(async () => {
  const win = await waitForMainWindow();
  await waitForRenderer(win);
  console.log('Renderer smoke booted');
  if (!win.isDestroyed()) win.destroy();
  await wait(150);
  await removeSmokeHome();
  app.exit(0);
}).catch(async (error) => {
  console.error(error);
  await removeSmokeHome();
  app.exit(1);
});
