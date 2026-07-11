const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.VISPNOTE_DISABLE_SINGLE_INSTANCE = '1';
process.env.VISPNOTE_DISABLE_GLOBAL_SHORTCUTS = '1';
process.env.VISPNOTE_EPHEMERAL_SESSION = '1';
const regressionHome = process.env.VISPNOTE_HOME || fs.mkdtempSync(path.join(os.tmpdir(), 'vispnote-ai-regression-'));
process.env.VISPNOTE_HOME = regressionHome;

const ai = require('../lib/ai');

const FIXTURE_IDS = {
  format: 'qe_format_note',
  character: 'qe_character_note',
  location: 'qe_location_note',
  scene: 'qe_scene_note',
  source: 'qe_source_note',
};

function installAiFixture() {
  ai.status = async () => ({
    reachable: true,
    models: ['qe-fixture'],
    embedModelOk: true,
    chatModelOk: true,
    chatModel: 'qe-fixture',
    askMode: 'semantic',
    ready: true,
    reason: 'QE AI fixture ready',
    setupRequired: false,
    setupSteps: [],
    setupMessage: '',
    config: {
      provider: 'openai',
      chatModel: 'qe-fixture',
      embedModel: 'qe-fixture-embed',
      enabled: true,
    },
  });

  ai.editText = async ({ text, scope = '' } = {}) => {
    const source = String(text || '').trim();
    const scopeText = String(scope || '');
    if (/supporting novel note/i.test(scopeText)) {
      return {
        ok: true,
        text: [
          `QE_SUPPORT_UPDATED ${scopeText}`,
          '',
          source,
        ].join('\n'),
      };
    }
    return {
      ok: true,
      text: [
        'QE_FORMATTED current page',
        '',
        source,
      ].join('\n'),
    };
  };

  ai.ask = async () => ({
    ok: true,
    answer: 'Fixture source answer from QE Source Target.',
    sources: [{
      id: FIXTURE_IDS.source,
      title: 'QE Source Target',
      snippet: 'Fixture source snippet',
    }],
    mode: 'qe-fixture',
  });

  ai.askStream = async (_vaultId, _query, _store, options = {}) => {
    const answer = 'Fixture source answer from QE Source Target.';
    if (typeof options.onToken === 'function') options.onToken(answer);
    return {
      ok: true,
      answer,
      sources: [{
        id: FIXTURE_IDS.source,
        title: 'QE Source Target',
        snippet: 'Fixture source snippet',
      }],
      mode: 'qe-fixture',
    };
  };

  ai.chat = async () => ({ ok: true, answer: 'QE fixture chat response.' });
  ai.chatStream = async ({ onToken } = {}) => {
    if (typeof onToken === 'function') onToken('QE fixture chat response.');
    return { ok: true, answer: 'QE fixture chat response.' };
  };
  ai.toolPlan = async ({ messages = [] } = {}) => {
    const text = (messages || []).map(message => String(message?.content || '')).join('\n').toLowerCase();
    if (text.includes('format this page')) {
      return {
        ok: true,
        answer: '',
        toolCalls: [{
          name: 'edit-current-page',
          args: { instruction: 'Format this page.' },
        }],
      };
    }
    if (text.includes('improve all supporting notes')) {
      return {
        ok: true,
        answer: '',
        toolCalls: [{
          name: 'edit-supporting-notes',
          args: { instruction: 'Improve all supporting notes.' },
        }],
      };
    }
    if (text.includes('qe source target')) {
      return {
        ok: true,
        answer: '',
        toolCalls: [{
          name: 'answer-notes',
          args: { query: 'qe source target' },
        }],
      };
    }
    return { ok: true, answer: '', toolCalls: [] };
  };
  ai.scheduleEmbed = () => {};
}

installAiFixture();
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
  throw new Error('AI regression timed out waiting for BrowserWindow');
}

async function evaluate(win, source) {
  return await win.webContents.executeJavaScript(source, true);
}

async function waitFor(win, label, predicate, timeoutMs = 30000) {
  const started = Date.now();
  let lastState = null;
  while (Date.now() - started < timeoutMs) {
    if (win.isDestroyed()) throw new Error(`AI regression window was destroyed while waiting for ${label}`);
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
      const askInput = document.querySelector('textarea[placeholder^="Ask anything"]');
      return {
        mounted: Boolean(root?.children.length),
        bootSplashVisible: visible(bootSplash),
        launchError: bodyText.includes('Launch interrupted'),
        selectedTitle: titleInput?.value || '',
        askOpen: Boolean(askInput),
        askEnabled: Boolean(askInput) && ![...document.querySelectorAll('button')]
          .some(button => (button.textContent || '').trim() === 'Ask' && button.disabled),
        text: bodyText.slice(0, 1200),
      };
    })()
  `;
}

async function state(win) {
  return await evaluate(win, rendererStateScript());
}

async function waitForRendererBoot(win) {
  return await waitFor(win, 'renderer boot', async () => {
    const current = await state(win);
    if (current.launchError) return { fatal: current.text };
    return {
      ok: current.mounted && !current.bootSplashVisible && current.selectedTitle,
      current,
    };
  });
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
          && (!matcher.textIncludes || text.includes(matcher.textIncludes))
          && (!matcher.titleIncludes || title.includes(matcher.titleIncludes))
          && (!matcher.aria || aria === matcher.aria)
          && (!matcher.enabled || !btn.disabled);
      });
      if (!button) return { ok: false, buttons: buttons.map(btn => ({
        text: (btn.textContent || '').trim(),
        title: btn.getAttribute('title') || '',
        aria: btn.getAttribute('aria-label') || '',
        disabled: btn.disabled,
      })).slice(0, 50) };
      button.click();
      return { ok: true };
    })()
  `);
  if (!result.ok) throw new Error(`Button not found for ${JSON.stringify(matcher)}: ${JSON.stringify(result.buttons)}`);
}

async function clickVisibleText(win, text) {
  const result = await evaluate(win, `
    (() => {
      const targetText = ${JSON.stringify(text)};
      const visible = (el) => {
        const style = getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        return style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && rect.height > 0;
      };
      const elements = [...document.querySelectorAll('body *')]
        .filter(visible)
        .filter(el => (el.textContent || '').includes(targetText));
      const element = elements
        .sort((a, b) => (a.textContent || '').length - (b.textContent || '').length)[0];
      if (!element) return { ok: false, candidates: [] };
      element.click();
      return { ok: true, text: (element.textContent || '').trim().slice(0, 120) };
    })()
  `);
  if (!result.ok) throw new Error(`Visible text not found: ${text}`);
}

async function pressAccelerator(win, keyCode, modifiers = []) {
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode, modifiers });
  win.webContents.sendInputEvent({ type: 'keyUp', keyCode, modifiers });
  await wait(120);
}

async function seedFixtureNotes(win) {
  return await evaluate(win, `
    (async () => {
      const ids = ${JSON.stringify(FIXTURE_IDS)};
      const unwrap = (result, label) => {
        if (!result?.ok) throw new Error(label + ': ' + (result?.error || 'failed'));
        return result.data ?? result.value;
      };
      const vaultResult = unwrap(await window.mn.vaults.listVaults(), 'listVaults');
      const vaults = Array.isArray(vaultResult) ? vaultResult : (vaultResult?.vaults || []);
      const prefs = unwrap(await window.mn.preferences.getPrefs(), 'getPrefs');
      const active = vaults.find(v => v.id === prefs.activeVaultId) || vaults[0];
      if (!active) throw new Error('No vault available for AI regression');
      const vaultId = active.id;
      const now = new Date().toISOString();
      const notes = [
        {
          id: ids.format,
          title: 'QE Format Target',
          body: 'rough text for the formatter\\n- [ ] keep this task',
          tags: ['qe'],
        },
        {
          id: ids.character,
          title: 'QE Character',
          body: 'Mara wants to leave the harbor.',
          tags: ['novel-character'],
        },
        {
          id: ids.location,
          title: 'QE Location',
          body: 'The harbor has fog and bells.',
          tags: ['novel-location'],
        },
        {
          id: ids.scene,
          title: 'QE Scene',
          body: 'status:: DRAFT\\n\\nScene prose should not be edited by supporting-note action.',
          tags: ['novel-scene'],
        },
        {
          id: ids.source,
          title: 'QE Source Target',
          body: 'Source note body used for source navigation.',
          tags: ['qe'],
        },
      ];
      for (const note of notes) {
        const saved = await window.mn.notes.saveNote(vaultId, {
          ...note,
          date: now,
          modifiedAt: now,
        }, {});
        unwrap(saved, 'saveNote ' + note.id);
      }
      unwrap(await window.mn.vaults.saveVaultMeta(vaultId, {
        lastSelectedId: ids.format,
        tags: [
          { name: 'qe', hue: 120 },
          { name: 'novel-character', hue: 40 },
          { name: 'novel-location', hue: 80 },
          { name: 'novel-scene', hue: 190 },
        ],
      }), 'saveVaultMeta');
      return { vaultId };
    })()
  `);
}

async function loadFixtureNotes(win, vaultId) {
  return await evaluate(win, `
    (async () => {
      const result = await window.mn.notes.loadVault(${JSON.stringify(vaultId)});
      if (!result?.ok) throw new Error(result?.error || 'loadVault failed');
      const ids = ${JSON.stringify(FIXTURE_IDS)};
      const byId = {};
      for (const note of result.value.notes || []) {
        if (Object.values(ids).includes(note.id)) byId[note.id] = note;
      }
      return byId;
    })()
  `);
}

async function openAskAi(win) {
  await pressAccelerator(win, 'K', ['control', 'shift']);
  await waitFor(win, 'Ask AI open', async () => {
    const current = await state(win);
    return { ok: current.askOpen, current };
  });
}

async function clearAskAiIfNeeded(win) {
  const hasClear = await evaluate(win, `
    (() => [...document.querySelectorAll('button')]
      .some(button => (button.textContent || '').trim() === 'Clear'))()
  `);
  if (!hasClear) return;
  await clickButton(win, { text: 'Clear' });
  await wait(150);
}

async function submitAsk(win, prompt) {
  await waitFor(win, 'Ask AI composer ready', async () => {
    const current = await state(win);
    return { ok: current.askOpen, current };
  });
  await evaluate(win, `
    (() => {
      const textarea = document.querySelector('textarea[placeholder^="Ask anything"]');
      if (!textarea) throw new Error('Ask AI textarea not found');
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
      setter.call(textarea, ${JSON.stringify(prompt)});
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
      textarea.focus();
    })()
  `);
  await waitFor(win, 'Ask button enabled', async () => {
    const enabled = await evaluate(win, `
      (() => [...document.querySelectorAll('button')]
        .some(button => (button.textContent || '').trim() === 'Ask' && !button.disabled))()
    `);
    return { ok: enabled, enabled };
  });
  await clickButton(win, { text: 'Ask', enabled: true });
}

async function openFirstSource(win, sourceTitle) {
  await clickButton(win, { titleIncludes: 'Show sources' });
  await waitFor(win, `source ${sourceTitle} visible`, async () => {
    const current = await state(win);
    return { ok: current.text.includes(sourceTitle), current };
  });
  await clickVisibleText(win, sourceTitle);
}

async function confirmAiReview(win, label, expectedText) {
  await waitFor(win, `${label} review shown`, async () => {
    const current = await state(win);
    return { ok: current.text.includes(expectedText), current };
  });
  await clickButton(win, { text: 'Confirm', enabled: true });
}

async function runAiRegression() {
  const win = await waitForMainWindow();
  win.webContents.on('console-message', (_event, details, legacyMessage, legacyLine, legacySourceId) => {
    const structured = details && typeof details === 'object' ? details : null;
    const level = structured?.level ?? details ?? 'log';
    const message = structured?.message ?? legacyMessage ?? '';
    const sourceId = structured?.sourceId ?? legacySourceId ?? '';
    const line = structured?.lineNumber ?? legacyLine ?? 0;
    console.log(`[renderer:${level}] ${message} (${sourceId}:${line})`);
  });
  win.webContents.on('render-process-gone', (_event, details) => {
    console.error('Renderer process exited unexpectedly', details);
  });

  await waitForRendererBoot(win);
  const { vaultId } = await seedFixtureNotes(win);
  win.webContents.reloadIgnoringCache();
  await waitForRendererBoot(win);

  await waitFor(win, 'format fixture note selected', async () => {
    const current = await state(win);
    return { ok: current.selectedTitle === 'QE Format Target', current };
  });

  await openAskAi(win);
  await submitAsk(win, 'format this page');
  await confirmAiReview(win, 'format action', 'Review before AI edits "QE Format Target".');
  await waitFor(win, 'format action completed', async () => {
    const current = await state(win);
    return {
      ok: current.text.includes('Updated "QE Format Target".'),
      current,
    };
  });
  await openFirstSource(win, 'QE Format Target');
  await waitFor(win, 'formatted note visible after source click', async () => {
    const current = await state(win);
    return {
      ok: current.selectedTitle === 'QE Format Target'
        && !current.askOpen
        && current.text.includes('QE_FORMATTED current page'),
      current,
    };
  });

  await openAskAi(win);
  await clearAskAiIfNeeded(win);
  await submitAsk(win, 'what is in qe source target?');
  await waitFor(win, 'source answer completed', async () => {
    const current = await state(win);
    return { ok: current.text.includes('Fixture source answer'), current };
  });
  await openFirstSource(win, 'QE Source Target');
  await waitFor(win, 'source note selected', async () => {
    const current = await state(win);
    return {
      ok: current.selectedTitle === 'QE Source Target' && !current.askOpen,
      current,
    };
  });

  await openAskAi(win);
  await clearAskAiIfNeeded(win);
  await submitAsk(win, 'improve all supporting notes');
  await confirmAiReview(win, 'supporting notes action', 'Review before AI updates 2 supporting notes.');
  await waitFor(win, 'supporting notes action completed', async () => {
    const current = await state(win);
    return { ok: current.text.includes('Updated 2 supporting notes'), current };
  });
  await waitFor(win, 'supporting notes saved', async () => {
    const notes = await loadFixtureNotes(win, vaultId);
    const character = notes[FIXTURE_IDS.character]?.body || '';
    const location = notes[FIXTURE_IDS.location]?.body || '';
    const scene = notes[FIXTURE_IDS.scene]?.body || '';
    return {
      ok: character.includes('QE_SUPPORT_UPDATED supporting novel note: QE Character')
        && location.includes('QE_SUPPORT_UPDATED supporting novel note: QE Location')
        && !scene.includes('QE_SUPPORT_UPDATED'),
      notes,
    };
  });

  console.log('AI renderer regression workflows passed');
}

async function closeWindowsBeforeCleanup() {
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue;
    try { win.close(); } catch {}
  }
  await wait(150);
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue;
    try { win.destroy(); } catch {}
  }
  await wait(150);
}

async function cleanupAndExit(code) {
  await closeWindowsBeforeCleanup();
  if (!process.env.VISPNOTE_KEEP_AI_REGRESSION_HOME) {
    // Release the FTS index DB handle before deleting; on Windows an open
    // SQLite file blocks removal of the temp home with EPERM.
    try { require('../lib/index').close(); } catch {}
    let lastError = null;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        fs.rmSync(regressionHome, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
        lastError = null;
        break;
      } catch (error) {
        lastError = error;
        await wait(250);
      }
    }
    if (lastError) {
      console.warn(`Could not remove AI regression temp home ${regressionHome}: ${lastError?.message || String(lastError)}`);
    }
  }
  app.exit(code);
}

app.whenReady().then(async () => {
  try {
    await runAiRegression();
    await cleanupAndExit(0);
  } catch (error) {
    console.error(error);
    await cleanupAndExit(1);
  }
});
