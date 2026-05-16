const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.VISPNOTE_DISABLE_SINGLE_INSTANCE = '1';
process.env.VISPNOTE_DISABLE_GLOBAL_SHORTCUTS = '1';
const regressionHome = process.env.VISPNOTE_HOME || fs.mkdtempSync(path.join(os.tmpdir(), 'vispnote-regression-'));
process.env.VISPNOTE_HOME = regressionHome;

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
  throw new Error('Regression test timed out waiting for BrowserWindow');
}

async function evaluate(win, source) {
  return await win.webContents.executeJavaScript(source, true);
}

async function waitFor(win, label, predicate, timeoutMs = 30000) {
  const started = Date.now();
  let lastState = null;
  while (Date.now() - started < timeoutMs) {
    if (win.isDestroyed()) throw new Error(`Regression window was destroyed while waiting for ${label}`);
    try {
      lastState = await predicate();
      if (lastState?.ok) return lastState;
      if (lastState?.fatal) throw new Error(`${label}: ${lastState.fatal}`);
    } catch (error) {
      lastState = { error: error.message || String(error) };
    }
    await wait(150);
  }
  throw new Error(`Timed out waiting for ${label}: ${JSON.stringify(lastState)}`);
}

function rendererStateScript() {
  return `
    (() => {
      const visible = (el) => {
        if (!el) return false;
        const style = getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        return style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && rect.height > 0;
      };
      const bodyText = document.body?.textContent || '';
      const root = document.querySelector('#root');
      const bootSplash = document.querySelector('#mn-boot-splash');
      const titleInput = document.querySelector('.mn-note-title-input');
      const dialogs = [...document.querySelectorAll('[role="dialog"], [role="alertdialog"]')]
        .filter(visible)
        .map(el => (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 120));
      const buttons = [...document.querySelectorAll('button')]
        .filter(visible)
        .map(el => ({ text: (el.textContent || '').trim(), title: el.getAttribute('title') || '', aria: el.getAttribute('aria-label') || '' }));
      return {
        mounted: Boolean(root?.children.length),
        bootSplashVisible: visible(bootSplash),
        launchError: bodyText.includes('Launch interrupted'),
        sidebarVisible: buttons.some(btn => btn.text === 'New note') && bodyText.includes('All Notes'),
        seededNoteVisible: bodyText.includes('Welcome to VispNote') || bodyText.includes('Project plan') || bodyText.includes('Reading notes'),
        selectedTitle: titleInput?.value || '',
        editorBodyVisible: Boolean(document.querySelector('.mn-block-row')) || bodyText.includes('Try the basics'),
        quickCaptureOpen: bodyText.includes('Quick capture') && buttons.some(btn => btn.text === 'Save note'),
        settingsOpen: dialogs.some(text => text.includes('Settings')) || bodyText.includes('Appearance · Theme, density, fonts'),
        commandPaletteOpen: dialogs.some(text => text.includes('Command palette')) || Boolean(document.querySelector('input[placeholder="Run a command or open a note..."]')),
        dialogs,
        buttons,
        text: bodyText.slice(0, 500),
      };
    })()
  `;
}

async function state(win) {
  return await evaluate(win, rendererStateScript());
}

async function clickButton(win, matcher) {
  const result = await evaluate(win, `
    (() => {
      const matcher = ${JSON.stringify(matcher)};
      const visible = (el) => {
        const style = getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        return style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && rect.height > 0;
      };
      const buttons = [...document.querySelectorAll('button')].filter(visible);
      const button = buttons.find(btn => {
        const text = (btn.textContent || '').trim();
        const title = btn.getAttribute('title') || '';
        const aria = btn.getAttribute('aria-label') || '';
        return (!matcher.text || text === matcher.text)
          && (!matcher.titleIncludes || title.includes(matcher.titleIncludes))
          && (!matcher.aria || aria === matcher.aria);
      });
      if (!button) return { ok: false, buttons: buttons.map(btn => ({
        text: (btn.textContent || '').trim(),
        title: btn.getAttribute('title') || '',
        aria: btn.getAttribute('aria-label') || '',
      })).slice(0, 40) };
      button.click();
      return { ok: true };
    })()
  `);
  if (!result.ok) throw new Error(`Button not found for ${JSON.stringify(matcher)}: ${JSON.stringify(result.buttons)}`);
}

async function pressAccelerator(win, keyCode, modifiers = []) {
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode, modifiers });
  win.webContents.sendInputEvent({ type: 'keyUp', keyCode, modifiers });
  await wait(100);
}

async function runRegression() {
  const win = await waitForMainWindow();
  win.webContents.on('console-message', (_event, details) => {
    const level = details?.level ?? 'log';
    const message = details?.message ?? '';
    const sourceId = details?.sourceId ?? '';
    const line = details?.lineNumber ?? 0;
    console.log(`[renderer:${level}] ${message} (${sourceId}:${line})`);
  });
  win.webContents.on('render-process-gone', (_event, details) => {
    console.error('Renderer process exited unexpectedly', details);
  });

  await waitFor(win, 'renderer boot', async () => {
    const current = await state(win);
    if (current.launchError) return { fatal: current.text };
    return {
      ok: current.mounted
        && !current.bootSplashVisible
        && current.sidebarVisible
        && current.seededNoteVisible
        && current.selectedTitle
        && current.editorBodyVisible,
      current,
    };
  });

  await clickButton(win, { text: 'New note' });
  await waitFor(win, 'new note selection', async () => {
    const current = await state(win);
    return { ok: /^Untitled/.test(current.selectedTitle), current };
  });

  await clickButton(win, { titleIncludes: 'Quick capture' });
  await waitFor(win, 'quick capture open', async () => {
    const current = await state(win);
    return { ok: current.quickCaptureOpen, current };
  });
  await pressAccelerator(win, 'Escape');
  await waitFor(win, 'quick capture close', async () => {
    const current = await state(win);
    return { ok: !current.quickCaptureOpen, current };
  });

  await clickButton(win, { titleIncludes: 'Settings' });
  await waitFor(win, 'settings open', async () => {
    const current = await state(win);
    return { ok: current.settingsOpen, current };
  });
  await clickButton(win, { aria: 'Close settings' });
  await waitFor(win, 'settings close', async () => {
    const current = await state(win);
    return { ok: !current.settingsOpen, current };
  });

  await pressAccelerator(win, 'K', ['control']);
  await waitFor(win, 'command palette open', async () => {
    const current = await state(win);
    return { ok: current.commandPaletteOpen, current };
  });
  await pressAccelerator(win, 'Escape');
  await waitFor(win, 'command palette close', async () => {
    const current = await state(win);
    return { ok: !current.commandPaletteOpen, current };
  });

  const finalState = await state(win);
  if (finalState.launchError) throw new Error(`Launch error screen appeared: ${finalState.text}`);
  console.log('Renderer regression workflows passed');
}

function cleanupAndExit(code) {
  if (!process.env.VISPNOTE_KEEP_REGRESSION_HOME) {
    try {
      fs.rmSync(regressionHome, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    } catch (error) {
      console.warn(`Could not remove regression temp home ${regressionHome}: ${error?.message || String(error)}`);
    }
  }
  app.exit(code);
}

app.whenReady().then(async () => {
  try {
    await runRegression();
    cleanupAndExit(0);
  } catch (error) {
    console.error(error);
    cleanupAndExit(1);
  }
});
