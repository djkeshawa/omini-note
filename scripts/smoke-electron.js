const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.VISPNOTE_DISABLE_SINGLE_INSTANCE = '1';
process.env.VISPNOTE_DISABLE_GLOBAL_SHORTCUTS = '1';
const smokeHome = process.env.VISPNOTE_HOME || fs.mkdtempSync(path.join(os.tmpdir(), 'vispnote-smoke-'));
process.env.VISPNOTE_HOME = smokeHome;
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
  win.webContents.on('console-message', (_event, details) => {
    const level = details?.level ?? 'log';
    const message = details?.message ?? '';
    const sourceId = details?.sourceId ?? '';
    const line = details?.lineNumber ?? 0;
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
  if (process.env.VISPNOTE_KEEP_SMOKE_HOME) return;
  // Release the FTS index DB handle before deleting; on Windows an open
  // SQLite file blocks removal of the temp home with EPERM.
  try { require('../lib/index').close(); } catch {}
  let lastError = null;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      fs.rmSync(smokeHome, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
      lastError = null;
      break;
    } catch (error) {
      lastError = error;
      await wait(250);
    }
  }
  if (lastError) {
    console.warn(`Could not remove smoke temp home ${smokeHome}: ${lastError?.message || String(lastError)}`);
  }
}

app.whenReady().then(async () => {
  const win = await waitForMainWindow();
  await waitForRenderer(win);
  console.log('Renderer smoke booted');
  await removeSmokeHome();
  app.exit(0);
}).catch(async (error) => {
  console.error(error);
  await removeSmokeHome();
  app.exit(1);
});
