const { app, BrowserWindow, dialog } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { configureIsolatedUserData, scheduleTempCleanupAfterExit } = require('./test-temp-home');

process.env.VISPNOTE_DISABLE_SINGLE_INSTANCE = '1';
process.env.VISPNOTE_DISABLE_GLOBAL_SHORTCUTS = '1';
process.env.VISPNOTE_EPHEMERAL_SESSION = '1';
const suppliedRegressionHome = process.env.VISPNOTE_HOME;
const ownsRegressionHome = !suppliedRegressionHome;
const regressionHome = suppliedRegressionHome || fs.mkdtempSync(path.join(os.tmpdir(), 'vispnote-regression-'));
process.env.VISPNOTE_HOME = regressionHome;
configureIsolatedUserData(app, regressionHome);

const markdownImportFixture = path.join(regressionHome, '.regression-markdown-import');
fs.mkdirSync(path.join(markdownImportFixture, 'assets'), { recursive: true });
fs.writeFileSync(path.join(markdownImportFixture, 'assets', 'pixel.png'), Buffer.from([137, 80, 78, 71]));
fs.writeFileSync(path.join(markdownImportFixture, 'QE User Scenario Note.md'), [
  '---',
  'title: QE User Scenario Note',
  'aliases: [Portable source]',
  '---',
  '',
  '# Portable source',
  '',
  '[Child](Child.md)',
  '![Pixel](assets/pixel.png)',
  '![Unsafe](../outside.png)',
].join('\n'));
fs.writeFileSync(path.join(markdownImportFixture, 'Child.md'), '# Child\n\nSee [[QE User Scenario Note]].\n');
const nativeShowOpenDialog = dialog.showOpenDialog.bind(dialog);
dialog.showOpenDialog = async (...args) => {
  const options = args.length > 1 ? args[1] : args[0];
  if (options?.title === 'Import Markdown folder') {
    return { canceled: false, filePaths: [markdownImportFixture] };
  }
  return nativeShowOpenDialog(...args);
};

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
        sidebarVisible: buttons.some(btn => btn.text === 'New note') && bodyText.includes('All notes'),
        seededNoteVisible: bodyText.includes('Welcome to VispNote') || bodyText.includes('Project plan') || bodyText.includes('Reading notes'),
        selectedTitle: titleInput?.value || '',
        editorBodyVisible: Boolean(document.querySelector('.mn-block-row')) || bodyText.includes('Try the basics'),
        quickCaptureOpen: bodyText.includes('Quick capture') && buttons.some(btn => btn.text.startsWith('Save')),
        settingsOpen: dialogs.some(text => text.includes('Settings')) || bodyText.includes('General · A calm default experience'),
        commandPaletteOpen: Boolean(document.querySelector('[data-mn-palette-root="true"]')),
        dialogs,
        buttons,
        text: bodyText.slice(0, 2000),
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

async function setControlByPlaceholder(win, placeholder, value) {
  const result = await evaluate(win, `
    (() => {
      const target = ${JSON.stringify(placeholder)};
      const value = ${JSON.stringify(value)};
      const visible = (el) => {
        if (!el) return false;
        const style = getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        return style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && rect.height > 0;
      };
      const controls = [...document.querySelectorAll('input, textarea')].filter(visible);
      const el = controls.find(item => (item.getAttribute('placeholder') || '') === target)
        || controls.find(item => (item.getAttribute('placeholder') || '').includes(target));
      if (!el) return { ok: false, placeholders: controls.map(item => item.getAttribute('placeholder') || '').slice(0, 40) };
      const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
      if (setter) setter.call(el, value);
      else el.value = value;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      el.focus();
      return { ok: true };
    })()
  `);
  if (!result.ok) throw new Error(`Control not found for placeholder ${JSON.stringify(placeholder)}: ${JSON.stringify(result.placeholders)}`);
}

async function setSelectByAria(win, ariaLabel, value) {
  const result = await evaluate(win, `
    (() => {
      const el = document.querySelector('select[aria-label=${JSON.stringify(ariaLabel)}]');
      if (!el) return { ok: false };
      const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
      if (setter) setter.call(el, ${JSON.stringify(value)});
      else el.value = ${JSON.stringify(value)};
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return { ok: el.value === ${JSON.stringify(value)}, value: el.value };
    })()
  `);
  if (!result.ok) throw new Error(`Select not found or unchanged for ${ariaLabel}: ${JSON.stringify(result)}`);
}

async function setTitleInput(win, value) {
  const result = await evaluate(win, `
    (() => {
      const value = ${JSON.stringify(value)};
      const el = document.querySelector('.mn-note-title-input');
      if (!el) return { ok: false };
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      if (setter) setter.call(el, value);
      else el.value = value;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      el.focus();
      return { ok: true };
    })()
  `);
  if (!result.ok) throw new Error('Note title input not found');
}

async function setActiveEditorText(win, value) {
  const result = await evaluate(win, `
    (() => {
      const value = ${JSON.stringify(value)};
      const el = document.activeElement?.getAttribute?.('data-mn-block-content') === 'editor'
        ? document.activeElement
        : document.querySelector('[data-mn-block-content="editor"]');
      if (!el) return { ok: false };
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
      if (setter) setter.call(el, value);
      else el.value = value;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      el.focus();
      el.setSelectionRange(value.length, value.length);
      return { ok: true };
    })()
  `);
  if (!result.ok) throw new Error('Active editor textarea not found');
}

async function typeActiveEditorText(win, text) {
  for (const ch of String(text || '')) {
    const result = await evaluate(win, `
      (() => {
        const ch = ${JSON.stringify(ch)};
        const el = document.activeElement?.getAttribute?.('data-mn-block-content') === 'editor'
          ? document.activeElement
          : document.querySelector('[data-mn-block-content="editor"]');
        if (!el) return { ok: false };
        const start = el.selectionStart ?? el.value.length;
        const end = el.selectionEnd ?? start;
        const next = el.value.slice(0, start) + ch + el.value.slice(end);
        const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
        if (setter) setter.call(el, next);
        else el.value = next;
        const pos = start + ch.length;
        el.setSelectionRange(pos, pos);
        const event = typeof InputEvent === 'function'
          ? new InputEvent('input', { bubbles: true, inputType: 'insertText', data: ch })
          : new Event('input', { bubbles: true });
        el.dispatchEvent(event);
        el.focus();
        return { ok: true, value: next };
      })()
    `);
    if (!result.ok) throw new Error('Active editor textarea not found for typing');
    await wait(50);
  }
}

async function ensureEditorRowTypingFocus(win, index, label) {
  const rowIndex = Number(index) || 0;
  const result = await evaluate(win, `
    (() => {
      const rows = [...document.querySelectorAll('.mn-block-row[data-block-id]')];
      const row = rows[${rowIndex}];
      if (!row) return { ok: false, missing: true, rows: rows.length };
      const editor = row.querySelector('[data-mn-block-content="editor"]');
      if (editor) {
        editor.focus();
        const end = editor.value.length;
        editor.setSelectionRange(end, end);
        return { ok: true, rows: rows.length, value: editor.value };
      }
      const target = row.querySelector('[data-mn-block-content="display"]') || row;
      target.click();
      return { ok: false, clicked: true, rows: rows.length };
    })()
  `);
  if (result.ok) return;
  if (result.missing) throw new Error(`Could not find editor row ${rowIndex}: ${JSON.stringify(result)}`);
  await waitForEditorLayout(win, label || `editor row ${rowIndex} active for typing`, rows => rows[rowIndex]?.editing && rows[rowIndex]?.active);
  await evaluate(win, `
    (() => {
      const rows = [...document.querySelectorAll('.mn-block-row[data-block-id]')];
      const editor = rows[${rowIndex}]?.querySelector('[data-mn-block-content="editor"]');
      if (!editor) return false;
      editor.focus();
      const end = editor.value.length;
      editor.setSelectionRange(end, end);
      return true;
    })()
  `);
}

async function typeEditorRowText(win, index, text) {
  const rowIndex = Number(index) || 0;
  for (const ch of String(text || '')) {
    await ensureEditorRowTypingFocus(win, rowIndex, `editor row ${rowIndex} active before typing`);
    const result = await evaluate(win, `
      (() => {
        const ch = ${JSON.stringify(ch)};
        const rows = [...document.querySelectorAll('.mn-block-row[data-block-id]')];
        const row = rows[${rowIndex}];
        const el = row?.querySelector('[data-mn-block-content="editor"]');
        if (!el) return { ok: false, rows: rows.length };
        const start = el.selectionStart ?? el.value.length;
        const end = el.selectionEnd ?? start;
        const next = el.value.slice(0, start) + ch + el.value.slice(end);
        const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
        if (setter) setter.call(el, next);
        else el.value = next;
        const pos = start + ch.length;
        el.setSelectionRange(pos, pos);
        const event = typeof InputEvent === 'function'
          ? new InputEvent('input', { bubbles: true, inputType: 'insertText', data: ch })
          : new Event('input', { bubbles: true });
        el.dispatchEvent(event);
        el.focus();
        return { ok: true, value: next };
      })()
    `);
    if (!result.ok) throw new Error(`Editor row ${rowIndex} textarea not found for typing`);
    await wait(50);
  }
}

async function clickVisibleText(win, text) {
  const result = await evaluate(win, `
    (() => {
      const targetText = ${JSON.stringify(text)};
      const visible = (el) => {
        if (!el) return false;
        const style = getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        return style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && rect.height > 0;
      };
      const candidates = [...document.querySelectorAll('button, [role="button"], span, div')]
        .filter(visible)
        .filter(el => (el.textContent || '').trim() === targetText)
        .sort((a, b) => (a.textContent || '').length - (b.textContent || '').length);
      const el = candidates[0];
      if (!el) return { ok: false, sample: [...document.querySelectorAll('button, span, div')].filter(visible).map(item => (item.textContent || '').trim()).filter(Boolean).slice(0, 60) };
      const clickable = el.closest('button, [role="button"]') || el;
      clickable.click();
      return { ok: true };
    })()
  `);
  if (!result.ok) throw new Error(`Visible text not found: ${text}. Sample: ${JSON.stringify(result.sample)}`);
}

async function runCommandPaletteCommand(win, query, resultText) {
  await pressAccelerator(win, 'K', ['control']);
  await waitFor(win, `command palette open for ${query}`, async () => {
    const current = await state(win);
    return { ok: current.commandPaletteOpen, current };
  });
  await setControlByPlaceholder(win, 'Search notes and actions', query);
  await waitFor(win, `command palette result ${resultText}`, async () => {
    const current = await state(win);
    return {
      ok: current.commandPaletteOpen && (
        current.text.includes(resultText)
        || current.buttons.some(btn => String(btn.text || '').includes(resultText))
      ),
      current,
    };
  });
  await clickVisibleText(win, resultText);
  await waitFor(win, `command palette closed after ${resultText}`, async () => {
    const current = await state(win);
    return { ok: !current.commandPaletteOpen, current };
  });
}

async function availableCommandIds(win) {
  await pressAccelerator(win, 'K', ['control']);
  await waitFor(win, 'command palette open for availability audit', async () => {
    const ids = await evaluate(win, `
      document.querySelector('[data-mn-available-command-ids]')?.getAttribute('data-mn-available-command-ids') || ''
    `);
    return { ok: Boolean(ids), ids };
  });
  const ids = await evaluate(win, `
    (document.querySelector('[data-mn-available-command-ids]')?.getAttribute('data-mn-available-command-ids') || '')
      .split(/\\s+/)
      .filter(Boolean)
  `);
  await pressAccelerator(win, 'Escape');
  await waitFor(win, 'command palette closed after availability audit', async () => {
    const current = await state(win);
    return { ok: !current.commandPaletteOpen, current };
  });
  return ids;
}

async function setPackEnabledForRegression(win, packId, enabled) {
  await clickButton(win, { titleIncludes: 'Open settings' });
  await waitFor(win, `settings open for ${packId}`, async () => {
    const current = await state(win);
    return { ok: current.settingsOpen, current };
  });
  await clickVisibleText(win, 'Advanced');
  await waitFor(win, `${packId} pack toggle visible`, async () => {
    const current = await evaluate(win, `
      (() => {
        const toggle = document.querySelector('[data-mn-pack-id=${JSON.stringify(packId)}]');
        return toggle ? { found: true, pressed: toggle.getAttribute('aria-pressed') === 'true', disabled: toggle.disabled } : { found: false };
      })()
    `);
    return { ok: current.found && !current.disabled, current };
  });
  await evaluate(win, `
    (() => {
      const toggle = document.querySelector('[data-mn-pack-id=${JSON.stringify(packId)}]');
      const next = ${enabled ? 'true' : 'false'};
      if (toggle && (toggle.getAttribute('aria-pressed') === 'true') !== next) toggle.click();
    })()
  `);
  await waitFor(win, `${packId} pack ${enabled ? 'enabled' : 'disabled'}`, async () => {
    const pressed = await evaluate(win, `document.querySelector('[data-mn-pack-id=${JSON.stringify(packId)}]')?.getAttribute('aria-pressed') === 'true'`);
    return { ok: pressed === enabled, pressed };
  });
  await clickButton(win, { aria: 'Close settings' });
  await waitFor(win, `settings closed after ${packId}`, async () => {
    const current = await state(win);
    return { ok: !current.settingsOpen, current };
  });
}

async function setSidebarDestinationsForRegression(win, updates) {
  const requested = Object.entries(updates);
  const description = requested.map(([label, enabled]) => `${label}:${enabled}`).join(', ');
  await clickButton(win, { titleIncludes: 'Open settings' });
  await waitFor(win, `settings open for sidebar destinations ${description}`, async () => {
    const current = await state(win);
    return { ok: current.settingsOpen, current };
  });
  await clickVisibleText(win, 'Advanced');
  await waitFor(win, 'sidebar destination toggles visible', async () => {
    const current = await evaluate(win, `
      (() => {
        const requested = ${JSON.stringify(requested)};
        const buttons = [...document.querySelectorAll('button[aria-label]')];
        const toggles = requested.map(([label, enabled]) => {
          const toggle = buttons.find(button => button.getAttribute('aria-label') === 'Toggle ' + label + ' in More');
          return {
            label,
            enabled,
            found: Boolean(toggle),
            pressed: toggle?.getAttribute('aria-pressed') === 'true',
            disabled: Boolean(toggle?.disabled),
          };
        });
        return { toggles };
      })()
    `);
    return {
      ok: current.toggles.every(toggle => toggle.found && !toggle.disabled),
      current,
    };
  });
  await evaluate(win, `
    (() => {
      const requested = ${JSON.stringify(requested)};
      const buttons = [...document.querySelectorAll('button[aria-label]')];
      for (const [label, enabled] of requested) {
        const toggle = buttons.find(button => button.getAttribute('aria-label') === 'Toggle ' + label + ' in More');
        if (toggle && (toggle.getAttribute('aria-pressed') === 'true') !== enabled) toggle.click();
      }
    })()
  `);
  await waitFor(win, `sidebar destinations updated: ${description}`, async () => {
    const current = await evaluate(win, `
      (() => {
        const requested = ${JSON.stringify(requested)};
        const buttons = [...document.querySelectorAll('button[aria-label]')];
        return requested.map(([label, enabled]) => {
          const toggle = buttons.find(button => button.getAttribute('aria-label') === 'Toggle ' + label + ' in More');
          return { label, enabled, pressed: toggle?.getAttribute('aria-pressed') === 'true' };
        });
      })()
    `);
    return {
      ok: current.every(toggle => toggle.pressed === toggle.enabled),
      current,
    };
  });
  await clickButton(win, { aria: 'Close settings' });
  await waitFor(win, 'settings closed after sidebar destination update', async () => {
    const current = await state(win);
    return { ok: !current.settingsOpen, current };
  });
}

async function setInputByAria(win, ariaLabel, value) {
  const result = await evaluate(win, `
    (() => {
      const value = ${JSON.stringify(value)};
      const el = document.querySelector('input[aria-label=' + ${JSON.stringify(JSON.stringify(ariaLabel))} + ']');
      if (!el) return { ok: false };
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      if (setter) setter.call(el, value);
      else el.value = value;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      return { ok: true };
    })()
  `);
  if (!result.ok) throw new Error('Input not found for aria-label: ' + ariaLabel);
}

async function renameActiveView(win, value) {
  const result = await evaluate(win, `
    (() => {
      const value = ${JSON.stringify(value)};
      const el = document.querySelector('input[aria-label="View name"]');
      if (!el) return { ok: false };
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      if (setter) setter.call(el, value);
      else el.value = value;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      return { ok: true };
    })()
  `);
  if (!result.ok) throw new Error('Views rename input not found');
}

async function viewsTableTitles(win) {
  return evaluate(win, `(() => {
    const table = document.querySelector('[data-mn-views-table]');
    if (!table) return [];
    return [...table.querySelectorAll('[data-mn-view-row]')].map(row => (row.children[1]?.textContent || '').trim());
  })()`);
}

async function viewsTabTitles(win) {
  return evaluate(win, `(() => {
    const bar = document.querySelector('[role="tablist"][aria-label="Saved views"]');
    if (!bar) return [];
    return [...bar.querySelectorAll('[role="tab"]')].map(el => (el.firstChild?.textContent || '').trim());
  })()`);
}

async function viewsSaveStateText(win) {
  return evaluate(win, `(() => {
    const bar = document.querySelector('[role="tablist"][aria-label="Saved views"]');
    return bar ? (bar.textContent || '') : '';
  })()`);
}

async function setViewsRowSearch(win, value) {
  const result = await evaluate(win, `
    (() => {
      const value = ${JSON.stringify(value)};
      const el = document.querySelector('input[aria-label="Search these rows"]');
      if (!el) return { ok: false };
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      if (setter) setter.call(el, value);
      else el.value = value;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      return { ok: true };
    })()
  `);
  if (!result.ok) throw new Error('Views row search input not found');
}

async function viewsRowCount(win) {
  return evaluate(win, `document.querySelector('[data-mn-views-body]')?.querySelectorAll('[data-mn-view-row]').length ?? -1`);
}

// A card is clicked by the note it shows, not by its whole text: the card's
// textContent is the title, the source, a preview and its tags run together.
async function clickViewsCard(win, text) {
  const result = await evaluate(win, `
    (() => {
      const cards = [...document.querySelectorAll('[data-mn-views-body] [data-mn-view-row]')];
      const card = cards.find(el => (el.textContent || '').includes(${JSON.stringify(text)}));
      if (!card) return { ok: false, cards: cards.map(el => (el.textContent || '').trim().slice(0, 40)) };
      card.click();
      return { ok: true };
    })()
  `);
  if (!result.ok) throw new Error(`Views card not found for ${text}: ${JSON.stringify(result.cards)}`);
}

// Ticks the row that shows a particular line, not whichever card happens to be
// first. A view can hold several open tasks at once, and "the first checkbox on
// screen" quietly becomes the wrong one the moment another task is added.
async function clickViewsRowCheck(win, text) {
  const result = await evaluate(win, `
    (() => {
      const rows = [...document.querySelectorAll('[data-mn-views-body] [data-mn-view-row]')];
      const row = rows.find(el => (el.textContent || '').includes(${JSON.stringify(text)}));
      if (!row) return { ok: false, rows: rows.map(el => (el.textContent || '').trim().slice(0, 40)) };
      const box = row.querySelector('button[aria-label="Complete task"], button[aria-label="Reopen task"]');
      if (!box) return { ok: false, box: false };
      box.click();
      return { ok: true };
    })()
  `);
  if (!result.ok) throw new Error(`Views row check not found for ${text}: ${JSON.stringify(result)}`);
}

// Commits an inline title the way a person does: type, then Enter.
async function commitViewsInlineTitle(win, ariaLabel, value) {
  const result = await evaluate(win, `
    (() => {
      const el = document.querySelector('input[aria-label=' + ${JSON.stringify(JSON.stringify(ariaLabel))} + ']');
      if (!el) return { ok: false, inputs: [...document.querySelectorAll('input')].map(input => input.getAttribute('aria-label')) };
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      if (setter) setter.call(el, ${JSON.stringify(value)});
      else el.value = ${JSON.stringify(value)};
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      return { ok: true };
    })()
  `);
  if (!result.ok) throw new Error(`Views inline title not found for ${ariaLabel}: ${JSON.stringify(result.inputs)}`);
}

// A board drag, one event per turn of the loop. Dispatching dragstart, dragover
// and drop in a single script would read stale handlers: each one sets state
// the next one depends on, and React has not re-rendered in between. Waiting on
// what each step makes visible is also the assertion that the step worked.
async function dragViewsCardToColumn(win, cardText, columnKey) {
  const started = await evaluate(win, `
    (() => {
      const cards = [...document.querySelectorAll('[data-mn-views-board-column] [data-mn-view-row]')];
      const card = cards.find(el => (el.textContent || '').includes(${JSON.stringify(cardText)}));
      if (!card) return { ok: false, cards: cards.map(el => (el.textContent || '').trim().slice(0, 40)) };
      if (card.getAttribute('draggable') !== 'true') return { ok: false, draggable: false };
      card.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: new DataTransfer() }));
      return { ok: true };
    })()
  `);
  if (!started.ok) throw new Error(`Views board card not draggable for ${cardText}: ${JSON.stringify(started)}`);

  await waitFor(win, `views board card ${cardText} picks up`, async () => {
    const current = await evaluate(win, `(() => {
      const cards = [...document.querySelectorAll('[data-mn-views-board-column] [data-mn-view-row]')];
      const card = cards.find(el => (el.textContent || '').includes(${JSON.stringify(cardText)}));
      return { opacity: card ? getComputedStyle(card).opacity : '' };
    })()`);
    return { ok: Number(current.opacity) < 1, current };
  });

  await evaluate(win, `(() => {
    const column = document.querySelector('[data-mn-views-board-column=' + ${JSON.stringify(JSON.stringify(columnKey))} + ']');
    if (!column) return false;
    column.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: new DataTransfer() }));
    return true;
  })()`);
  await waitFor(win, `views board column ${columnKey} offers the drop`, async () => {
    const current = await evaluate(win, `(() => {
      const column = document.querySelector('[data-mn-views-board-column=' + ${JSON.stringify(JSON.stringify(columnKey))} + ']');
      return { release: /Release to move here/.test(column ? column.textContent : '') };
    })()`);
    return { ok: current.release, current };
  });

  await evaluate(win, `(() => {
    const column = document.querySelector('[data-mn-views-board-column=' + ${JSON.stringify(JSON.stringify(columnKey))} + ']');
    if (!column) return false;
    column.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: new DataTransfer() }));
    return true;
  })()`);
}

async function runViewsPanelScenario(win) {
  await setPackEnabledForRegression(win, 'views', true);
  try {
    await clickVisibleText(win, 'Views');
    await waitFor(win, 'views panel renders a saved view', async () => {
      const current = await evaluate(win, `(() => {
        const panel = document.querySelector('[data-mn-views-panel]');
        if (!panel) return { panel: false };
        const tabs = panel.querySelector('[role="tablist"][aria-label="Saved views"]');
        return {
          panel: true,
          views: tabs ? tabs.querySelectorAll('[role="tab"]').length : 0,
          // Every tab states its own count, so a tab bar of empty labels fails.
          counted: tabs
            ? [...tabs.querySelectorAll('[role="tab"]')].filter(el => /\\d/.test(el.textContent || '')).length
            : 0,
          layouts: panel.querySelectorAll('[role="tablist"][aria-label="Layout"] [role="tab"]').length,
          search: Boolean(panel.querySelector('input[aria-label="Search these rows"]')),
          newView: Boolean(panel.querySelector('button[aria-label="New view"]')),
          saveState: /Saved/.test(panel.textContent || ''),
          rowsChip: /Rows/.test(panel.textContent || ''),
        };
      })()`);
      // The two-row chrome from the prototype: view tabs carrying counts, the
      // row search, the new-view control, the state pill, the Rows chip, and
      // all six layout segments. An empty shell fails every one of these.
      return {
        ok: current.panel && current.views > 0 && current.counted > 0 && current.layouts === 6
          && current.search && current.newView && current.saveState && current.rowsChip,
        current,
      };
    });

    // Views dropdowns share one owner: opening another replaces the current
    // menu, and clicking the page outside the menu closes it.
    await clickButton(win, { aria: 'Scope' });
    await waitFor(win, 'views scope dropdown opens', async () => {
      const current = await evaluate(win, `(() => ({
        scope: Boolean(document.querySelector('[data-mn-views-scope]')),
        scopeExpanded: document.querySelector('button[aria-label="Scope"]')?.getAttribute('aria-expanded'),
      }))()`);
      return { ok: current.scope && current.scopeExpanded === 'true', current };
    });
    await clickButton(win, { aria: 'Conditions' });
    await waitFor(win, 'opening another views dropdown replaces the first', async () => {
      const current = await evaluate(win, `(() => ({
        scope: Boolean(document.querySelector('[data-mn-views-scope]')),
        conditions: Boolean(document.querySelector('[data-mn-views-conditions]')),
        scopeExpanded: document.querySelector('button[aria-label="Scope"]')?.getAttribute('aria-expanded'),
        conditionsExpanded: document.querySelector('button[aria-label="Conditions"]')?.getAttribute('aria-expanded'),
      }))()`);
      return {
        ok: !current.scope && current.conditions
          && current.scopeExpanded === 'false' && current.conditionsExpanded === 'true',
        current,
      };
    });
    await evaluate(win, `(() => {
      const target = document.querySelector('[data-mn-views-body]');
      if (!target) return false;
      target.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
      target.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      return true;
    })()`);
    await waitFor(win, 'clicking outside closes the views dropdown', async () => {
      const current = await evaluate(win, `(() => ({
        scope: Boolean(document.querySelector('[data-mn-views-scope]')),
        conditions: Boolean(document.querySelector('[data-mn-views-conditions]')),
        columns: Boolean(document.querySelector('[data-mn-views-columns]')),
        expanded: [...document.querySelectorAll('button[aria-label="Scope"], button[aria-label="Conditions"], button[aria-label="Columns"]')]
          .map(button => button.getAttribute('aria-expanded')),
      }))()`);
      return {
        ok: !current.scope && !current.conditions && !current.columns
          && current.expanded.every(value => value === 'false'),
        current,
      };
    });

    // The row search must actually narrow the rows, not just render a box.
    // A nonsense term empties the view; clearing brings every row back.
    const allRows = await viewsRowCount(win);
    if (allRows <= 0) throw new Error(`Views list rendered no rows to search: ${allRows}`);
    await setViewsRowSearch(win, 'zzqx-no-such-row');
    await waitFor(win, 'views row search narrows the list', async () => {
      const rows = await viewsRowCount(win);
      const empty = await evaluate(win, `/No rows match that search/.test(document.querySelector('[data-mn-views-body]')?.textContent || '')`);
      return { ok: rows === 0 && empty, rows, empty, allRows };
    });
    await clickButton(win, { aria: 'Clear row search' });
    await waitFor(win, 'clearing views row search restores the rows', async () => {
      const rows = await viewsRowCount(win);
      return { ok: rows === allRows, rows, allRows };
    });

    // Board and calendar must draw something real, not an empty frame. Both
    // run against a view that has rows, so an empty result set cannot be
    // mistaken for a working layout.
    await clickVisibleText(win, 'Board');
    await waitFor(win, 'views board renders columns', async () => {
      const current = await evaluate(win, `(() => {
        const panel = document.querySelector('[data-mn-views-body]');
        if (!panel) return { panel: false };
        const headers = [...panel.querySelectorAll('div')]
          .filter(el => el.children.length === 2 && /^\\D+\\d+$/.test((el.textContent || '').trim()));
        return { panel: true, columns: headers.length };
      })()`);
      return { ok: current.panel && current.columns > 0, current };
    });
    await clickVisibleText(win, 'Calendar');
    await waitFor(win, 'views calendar renders a month grid', async () => {
      const current = await evaluate(win, `(() => {
        const panel = document.querySelector('[data-mn-views-body]');
        if (!panel) return { panel: false };
        const dayCells = [...panel.querySelectorAll('span')].filter(el => /^\\d{1,2}$/.test((el.textContent || '').trim()));
        return {
          panel: true,
          nextMonth: Boolean(panel.querySelector('button[aria-label="Next month"]')),
          dayCells: dayCells.length,
        };
      })()`);
      return { ok: current.panel && current.nextMonth && current.dayCells >= 28, current };
    });

    // The table is the prototype's, not the one inherited from Smart Views:
    // a sortable header per column, with property-sourced keys shown as key::.
    await clickVisibleText(win, 'Table');
    await waitFor(win, 'views table renders sortable headers', async () => {
      const current = await evaluate(win, `(() => {
        const table = document.querySelector('[data-mn-views-table]');
        if (!table) return { table: false };
        const heads = [...table.querySelectorAll('[role="columnheader"] > button')];
        const sorted = table.querySelectorAll('[role="columnheader"][aria-sort]').length;
        return {
          table: true,
          heads: heads.map(el => (el.textContent || '').trim()),
          titled: heads.filter(el => /Read from the note|property line/.test(el.getAttribute('title') || '')).length,
          sorted,
          rows: table.querySelectorAll('[data-mn-view-row]').length,
        };
      })()`);
      return {
        ok: current.table && current.heads.length >= 4 && current.rows > 0 && current.sorted === 1
          && current.titled === current.heads.length,
        current,
      };
    });

    // Sorting has to actually reorder the rows, not just paint an arrow.
    const titlesBefore = await viewsTableTitles(win);
    await clickButton(win, { aria: 'Sort by Title' });
    await waitFor(win, 'sorting the table reorders its rows', async () => {
      const titles = await viewsTableTitles(win);
      const expected = [...titlesBefore].sort((a, b) => a.localeCompare(b));
      return { ok: titles.length === titlesBefore.length && titles.join('|') === expected.join('|'), titles, titlesBefore };
    });
    await clickButton(win, { aria: 'Sort by Title' });
    await waitFor(win, 'sorting again reverses the rows', async () => {
      const titles = await viewsTableTitles(win);
      const expected = [...titlesBefore].sort((a, b) => b.localeCompare(a));
      return { ok: titles.join('|') === expected.join('|'), titles };
    });

    // Columns are discovered, not configured: a key exists in this menu only
    // because it was written into a note. Seed one and check it turns up.
    await seedEditorNote(win, {
      id: 'qe_views_prop',
      title: 'QE Views Property Note',
      body: 'A note that carries a property line.\n\nowner:: sam\n',
      expect: 'A note that carries a property line',
    });
    await clickVisibleText(win, 'Views');
    await clickVisibleText(win, 'Recent notes');
    await clickVisibleText(win, 'Table');
    await clickButton(win, { aria: 'Columns' });
    await waitFor(win, 'the columns menu finds a key that was written', async () => {
      const current = await evaluate(win, `(() => {
        const menu = document.querySelector('[data-mn-views-columns]');
        if (!menu) return { menu: false };
        return {
          menu: true,
          text: (menu.textContent || '').slice(0, 400),
          owner: Boolean(menu.querySelector('button[aria-label="Show the owner column"]')),
          declared: /Nothing here was declared/.test(menu.textContent || ''),
          coverage: /1 of \\d+/.test(menu.textContent || ''),
        };
      })()`);
      return { ok: current.menu && current.owner && current.declared && current.coverage, current };
    });

    // Turning it on has to add a real column to the table, headed with the
    // key and its colons, and mark the view as changed.
    await clickButton(win, { aria: 'Show the owner column' });
    await waitFor(win, 'turning a property on adds its column', async () => {
      const current = await evaluate(win, `(() => {
        const table = document.querySelector('[data-mn-views-table]');
        const bar = document.querySelector('[role="tablist"][aria-label="Saved views"]');
        const heads = table ? [...table.querySelectorAll('[role="columnheader"] > button')].map(el => (el.textContent || '').trim()) : [];
        const cells = table ? [...table.querySelectorAll('[data-mn-view-row]')].map(row => (row.textContent || '')) : [];
        return { heads, dirty: /Unsaved changes/.test(bar ? bar.textContent : ''), sam: cells.filter(text => text.includes('sam')).length };
      })()`);
      return { ok: current.heads.includes('owner::') && current.dirty && current.sam === 1, current };
    });
    await clickVisibleText(win, 'Save view');
    await waitFor(win, 'a chosen column is stored with the view', async () => {
      const current = await evaluate(win, `(async () => {
        const prefs = await window.mn?.preferences?.getPrefs?.();
        const views = prefs?.value?.smartViews || [];
        const recent = views.find(view => view && view.title === 'Recent notes');
        return { columns: recent ? recent.columns : null };
      })()`);
      return { ok: Array.isArray(current.columns) && current.columns.includes('owner'), current };
    });

    // Conditions keep or drop rows once scope has picked the notes. The
    // seeded note carries owner:: sam, so a condition on it must leave one row
    // and its opposite must leave none.
    await clickButton(win, { aria: 'Conditions' });
    await waitFor(win, 'the conditions menu offers a written key', async () => {
      const current = await evaluate(win, `(() => {
        const menu = document.querySelector('[data-mn-views-conditions]');
        if (!menu) return { menu: false };
        return {
          menu: true,
          add: Boolean(menu.querySelector('button[aria-label="Add condition"]')),
          match: Boolean(menu.querySelector('[role="tablist"][aria-label="Match"]')),
          empty: /every row that scope let through/.test(menu.textContent || ''),
        };
      })()`);
      return { ok: current.menu && current.add && current.match && current.empty, current };
    });

    await clickButton(win, { aria: 'Add condition' });
    await waitFor(win, 'a condition row appears on a key someone wrote', async () => {
      const current = await evaluate(win, `(() => {
        const menu = document.querySelector('[data-mn-views-conditions]');
        const key = menu?.querySelector('select[aria-label="Condition 1 property"]');
        return {
          key: key ? key.value : '',
          value: Boolean(menu?.querySelector('input[aria-label="Condition 1 value"]')),
          test: Boolean(menu?.querySelector('select[aria-label="Condition 1 test"]')),
        };
      })()`);
      return { ok: current.key === 'owner' && current.value && current.test, current };
    });

    await setInputByAria(win, 'Condition 1 value', 'sam');
    await waitFor(win, 'a condition narrows the rows to the ones that match', async () => {
      const current = await evaluate(win, `(() => {
        const table = document.querySelector('[data-mn-views-table]');
        const chip = document.querySelector('button[aria-label="Conditions"]');
        return {
          rows: table ? table.querySelectorAll('[data-mn-view-row]').length : -1,
          chip: chip ? (chip.textContent || '').trim() : '',
        };
      })()`);
      return { ok: current.rows === 1 && /owner is sam/.test(current.chip), current };
    });

    // "is not" has to be the opposite, not a no-op — an operator that silently
    // falls back to "is" would still look like it worked.
    await setSelectByAria(win, 'Condition 1 test', 'not');
    await waitFor(win, 'is-not excludes what is matched', async () => {
      const current = await evaluate(win, `(() => {
        const table = document.querySelector('[data-mn-views-table]');
        const body = document.querySelector('[data-mn-views-body]');
        return {
          rows: table ? table.querySelectorAll('[data-mn-view-row]').length : 0,
          empty: /Nothing matches this view yet/.test(body ? body.textContent : ''),
        };
      })()`);
      return { ok: current.rows === 0 && current.empty, current };
    });

    // Asking whether a key is missing must not require it to be present.
    await setSelectByAria(win, 'Condition 1 test', 'empty');
    await waitFor(win, 'is-empty finds the notes without the key', async () => {
      const rows = await evaluate(win, `document.querySelector('[data-mn-views-table]')?.querySelectorAll('[data-mn-view-row]').length ?? -1`);
      return { ok: rows === 2, rows };
    });

    await clickVisibleText(win, 'Clear all');
    await clickButton(win, { aria: 'Conditions' });
    await waitFor(win, 'clearing conditions brings every row back', async () => {
      const current = await evaluate(win, `(() => {
        const table = document.querySelector('[data-mn-views-table]');
        const chip = document.querySelector('button[aria-label="Conditions"]');
        return {
          rows: table ? table.querySelectorAll('[data-mn-view-row]').length : -1,
          chip: chip ? (chip.textContent || '').trim() : '',
        };
      })()`);
      return { ok: current.rows === 3 && /None/.test(current.chip), current };
    });

    // Scope narrows which notes the view looks at, and the chip has to say so
    // — an unexplained short list is indistinguishable from a broken query.
    await clickButton(win, { aria: 'Scope' });
    await waitFor(win, 'the scope menu offers the vault tags', async () => {
      const current = await evaluate(win, `(() => {
        const menu = document.querySelector('[data-mn-views-scope]');
        if (!menu) return { menu: false };
        const rows = [...menu.querySelectorAll('[role="menuitemcheckbox"]')].map(el => (el.textContent || '').trim());
        return { menu: true, rows, every: /every tag you pick/.test(menu.textContent || '') };
      })()`);
      return { ok: current.menu && current.rows.includes('#qe-regression') && current.every, current };
    });

    const scopedFrom = await viewsRowCount(win);
    await clickVisibleText(win, '#qe-regression');
    await waitFor(win, 'choosing a tag scopes the view and the chip says so', async () => {
      const current = await evaluate(win, `(() => {
        const strip = document.querySelector('button[aria-label="Scope"]');
        const table = document.querySelector('[data-mn-views-table]');
        return {
          chip: strip ? (strip.textContent || '').trim() : '',
          rows: table ? table.querySelectorAll('[data-mn-view-row]').length : -1,
        };
      })()`);
      return { ok: /qe-regression/.test(current.chip) && current.rows === 1 && current.rows < scopedFrom, current, scopedFrom };
    });
    await clickVisibleText(win, 'Whole vault');
    await waitFor(win, 'clearing scope brings the rest back', async () => {
      const current = await evaluate(win, `(() => {
        const strip = document.querySelector('button[aria-label="Scope"]');
        const table = document.querySelector('[data-mn-views-table]');
        return {
          chip: strip ? (strip.textContent || '').trim() : '',
          rows: table ? table.querySelectorAll('[data-mn-view-row]').length : -1,
        };
      })()`);
      return { ok: /Whole vault/.test(current.chip) && current.rows === scopedFrom, current, scopedFrom };
    });
    await clickButton(win, { aria: 'Scope' });

    // View management: a view you make, name, shape and save has to be there
    // afterwards. Each step is checked by what the tab bar actually shows.
    const before = await viewsTabTitles(win);
    await clickButton(win, { aria: 'New view' });
    await waitFor(win, 'a new view appears as a tab', async () => {
      const titles = await viewsTabTitles(win);
      return { ok: titles.length === before.length + 1 && titles.includes('New view'), titles, before };
    });

    await clickButton(win, { aria: 'View options' });
    await clickVisibleText(win, 'Rename');
    await renameActiveView(win, 'QE Renamed View');
    await waitFor(win, 'renaming a view relabels its tab', async () => {
      const titles = await viewsTabTitles(win);
      return { ok: titles.includes('QE Renamed View') && !titles.includes('New view'), titles };
    });

    // Changing the layout is a draft until saved: the pill has to say so, and
    // saving has to make it stick across a switch away and back.
    await clickVisibleText(win, 'Cards');
    await waitFor(win, 'an unsaved layout change is announced', async () => {
      const text = await viewsSaveStateText(win);
      return { ok: /Unsaved changes/.test(text), text };
    });
    await clickVisibleText(win, 'Save view');
    await waitFor(win, 'saving a view clears the unsaved state', async () => {
      const text = await viewsSaveStateText(win);
      return { ok: /Saved/.test(text) && !/Unsaved changes/.test(text), text };
    });
    await clickVisibleText(win, before[0]);
    await clickVisibleText(win, 'QE Renamed View');
    await waitFor(win, 'a saved layout is what the view reopens as', async () => {
      const current = await evaluate(win, `(() => {
        const strip = document.querySelector('[role="tablist"][aria-label="Layout"]');
        const on = strip ? [...strip.querySelectorAll('[role="tab"]')].find(el => el.getAttribute('aria-selected') === 'true') : null;
        return { layout: on ? (on.textContent || '').trim() : '' };
      })()`);
      return { ok: current.layout === 'Cards', current };
    });

    // The point of saving is that it outlives the window, so check the stored
    // preference rather than only the pixels the panel is showing.
    await waitFor(win, 'a saved view is written to preferences', async () => {
      const current = await evaluate(win, `(async () => {
        const prefs = await window.mn?.preferences?.getPrefs?.();
        const views = prefs?.value?.smartViews || [];
        const made = views.find(view => view && view.title === 'QE Renamed View');
        return { count: views.length, layout: made ? made.layout : '', found: Boolean(made) };
      })()`);
      return { ok: current.found && current.layout === 'cards', current };
    });

    await clickButton(win, { aria: 'View options' });
    await clickVisibleText(win, 'Delete');
    await clickVisibleText(win, 'Delete view');
    await waitFor(win, 'deleting a view removes its tab', async () => {
      const titles = await viewsTabTitles(win);
      return { ok: !titles.includes('QE Renamed View') && titles.length === before.length, titles };
    });
    await waitFor(win, 'a deleted view is gone from preferences too', async () => {
      const current = await evaluate(win, `(async () => {
        const prefs = await window.mn?.preferences?.getPrefs?.();
        const views = prefs?.value?.smartViews || [];
        return { titles: views.map(view => view && view.title) };
      })()`);
      return { ok: !current.titles.includes('QE Renamed View'), current };
    });

    // A card is editable where it sits. Clicking the space in a card opens the
    // small edit; the title it commits has to be the note's title on disk, not
    // a label that reverts the next time the query runs.
    await seedEditorNote(win, {
      id: 'qe_views_card',
      title: 'QE Views Card Note',
      body: 'Parent\n\nstatus:: doing\n',
      expect: 'Parent',
    });
    await clickVisibleText(win, 'Views');
    await clickVisibleText(win, 'Recent notes');
    await clickVisibleText(win, 'Cards');
    await waitFor(win, 'a views card carries a hue open mark and a hover bar', async () => {
      const current = await evaluate(win, `(() => {
        const card = [...document.querySelectorAll('[data-mn-views-body] [data-mn-view-row]')]
          .find(el => (el.textContent || '').includes('QE Views Card Note'));
        if (!card) return { card: false };
        const bar = card.querySelector('.mn-view-card-bar');
        return {
          card: true,
          bar: Boolean(bar),
          // Hidden until the pointer arrives, but present and reachable.
          hidden: bar ? getComputedStyle(bar).opacity === '0' : false,
          open: Boolean(card.querySelector('button[aria-label^="Open "]')),
          // The solid Open button the dashboard drew is gone from a card.
          solid: [...card.querySelectorAll('button')].some(el => (el.textContent || '').trim() === 'Open'),
        };
      })()`);
      return { ok: current.card && current.bar && current.hidden && current.open && !current.solid, current };
    });
    await clickViewsCard(win, 'QE Views Card Note');
    await commitViewsInlineTitle(win, 'Rename QE Views Card Note', 'QE Views Renamed Card');
    await waitForPersistedNote(win, 'QE Views Renamed Card', note => /status::\s*doing/.test(String(note.body || '')));

    // Dragging a card to another board column writes the property the board is
    // grouped by. The seeded note carries `status:: doing`, so the board has a
    // doing column to drop into and a note without a status to drop.
    await clickVisibleText(win, 'Board');
    await waitFor(win, 'the board offers the column the seeded status made', async () => {
      const current = await evaluate(win, `(() => {
        const columns = [...document.querySelectorAll('[data-mn-views-board-column]')].map(el => el.getAttribute('data-mn-views-board-column'));
        return { columns, hint: /Drag a card to another column to set its status/.test(document.querySelector('[data-mn-views-body]')?.textContent || '') };
      })()`);
      return { ok: current.columns.includes('doing') && current.hint, current };
    });
    await dragViewsCardToColumn(win, 'QE Views Property Note', 'doing');
    await waitForPersistedNote(win, 'QE Views Property Note', note => /status::\s*doing/.test(String(note.body || '')));

    // Dragging the last card out of a column must not erase the column: the
    // grouping only makes buckets for values still present in notes, so the
    // board remembers columns it has shown. A column you cannot see is one
    // you cannot drag a card back into.
    await seedEditorNote(win, {
      id: 'qe_views_review',
      title: 'QE Views Review Note',
      body: 'Parent\n\nstatus:: review\n',
      expect: 'Parent',
    });
    await clickVisibleText(win, 'Views');
    await clickVisibleText(win, 'Recent notes');
    await clickVisibleText(win, 'Board');
    await dragViewsCardToColumn(win, 'QE Views Review Note', 'doing');
    await waitFor(win, 'the emptied review column stays on screen', async () => {
      const current = await evaluate(win, `(() => ({
        columns: [...document.querySelectorAll('[data-mn-views-board-column]')].map(el => el.getAttribute('data-mn-views-board-column')),
      }))()`);
      return { ok: current.columns.includes('review') && current.columns.includes('doing'), current };
    });
    await dragViewsCardToColumn(win, 'QE Views Review Note', 'review');
    await waitForPersistedNote(win, 'QE Views Review Note', note => /status::\s*review/.test(String(note.body || '')));

    // The calendar plans as well as reports: adding a todo on a day writes a
    // real `- [ ]` line into a real note, the way the agenda does.
    await clickVisibleText(win, 'Calendar');
    await clickButton(win, { aria: 'Add to the selected day' });
    await setInputByAria(win, 'New item text', 'qe views calendar todo');
    await setSelectByAria(win, 'Note this item lives in', 'qe_views_card');
    await clickButton(win, { text: 'Add' });
    await waitForPersistedNote(win, 'QE Views Renamed Card', note => /- \[ \]\s+qe views calendar todo @remind \d{4}-\d{2}-\d{2}/.test(String(note.body || '')));

    // Picking a chip edits the row it came from. Clearing its date is the write
    // in reverse, and it also puts the vault back the way the later scenarios
    // expect it: a dated item is what makes the app infer the planning pack, so
    // leaving one here would hand every scenario after this an Agenda it never
    // asked for.
    await clickVisibleText(win, 'Open tasks');
    await clickVisibleText(win, 'Calendar');
    await clickVisibleText(win, 'qe views calendar todo');
    await waitFor(win, 'picking a calendar chip opens the row editor', async () => {
      const current = await evaluate(win, `(() => {
        const strip = document.querySelector('[data-mn-views-planner]');
        const input = strip?.querySelector('input[aria-label="Row text"]');
        return { strip: Boolean(strip), value: input ? input.value : '', clear: Boolean([...(strip?.querySelectorAll('button') || [])].find(el => (el.textContent || '').trim() === 'Clear date')) };
      })()`);
      return { ok: current.value === 'qe views calendar todo' && current.clear, current };
    });
    await clickVisibleText(win, 'Clear date');
    await waitForPersistedNote(win, 'QE Views Renamed Card', note => /- \[ \]\s+qe views calendar todo\s*$/m.test(String(note.body || '')));

    // A note chip is the note itself: picking it offers a rename, never the
    // date form — a note's date is the file's own modified time, and a form
    // that could only refuse taught that the editor was broken. The renamed
    // card was written to a moment ago, so it sits within the two chips a
    // day shows.
    await clickVisibleText(win, 'Recent notes');
    await clickVisibleText(win, 'Calendar');
    await clickVisibleText(win, 'QE Views Renamed Card');
    await waitFor(win, 'a note chip opens a rename editor, not a date form', async () => {
      const current = await evaluate(win, `(() => {
        const strip = document.querySelector('[data-mn-views-planner]');
        return {
          strip: Boolean(strip),
          value: strip?.querySelector('input[aria-label="Row text"]')?.value || '',
          date: Boolean(strip?.querySelector('input[aria-label="Row date"]')),
          renames: /Saving renames it/.test(strip?.textContent || ''),
        };
      })()`);
      return { ok: current.strip && current.value === 'QE Views Renamed Card' && !current.date && current.renames, current };
    });
    await setInputByAria(win, 'Row text', 'QE Views Redux Card');
    await clickVisibleText(win, 'Save');
    // The rename went through the app rename, so the body — the status line
    // and the todo added above — survived it untouched.
    await waitForPersistedNote(win, 'QE Views Redux Card', note => /status::\s*doing/.test(String(note.body || '')) && /- \[ \]\s+qe views calendar todo/.test(String(note.body || '')));

    // "New note for this item" makes the note and then the item: the note is
    // not in the app's list until the next render, so the item write is
    // deferred — the todo line landing in the brand-new note is the proof.
    await clickVisibleText(win, 'Open tasks');
    await clickVisibleText(win, 'Calendar');
    await clickButton(win, { aria: 'Add to the selected day' });
    await setInputByAria(win, 'New item text', 'qe views planner fresh note');
    await setSelectByAria(win, 'Note this item lives in', '__mn_views_new_note');
    await clickButton(win, { text: 'Add' });
    await waitForPersistedNote(win, 'qe views planner fresh note', note => /- \[ \]\s+qe views planner fresh note @remind \d{4}-\d{2}-\d{2}/.test(String(note.body || '')));
    // Undate it so this scenario leaves the vault the way it found it — a
    // dated item is what makes the app infer the planning pack.
    await clickVisibleText(win, 'qe views planner fresh note');
    await waitFor(win, 'the fresh todo opens in the row editor', async () => {
      const current = await evaluate(win, `(() => {
        const strip = document.querySelector('[data-mn-views-planner]');
        return { value: strip?.querySelector('input[aria-label="Row text"]')?.value || '' };
      })()`);
      return { ok: current.value === 'qe views planner fresh note', current };
    });
    await clickVisibleText(win, 'Clear date');
    await waitForPersistedNote(win, 'qe views planner fresh note', note => /- \[ \]\s+qe views planner fresh note\s*$/m.test(String(note.body || '')));

    // Ticking a task from the board must change the note on disk, not just
    // the pixel. Last, because completing it empties the Open tasks view.
    await seedEditorNote(win, {
      id: 'qe_views_task',
      title: 'QE Views Task Note',
      body: 'Parent\n\n- [ ] ship the views board\n',
    });
    await clickVisibleText(win, 'Views');
    await clickVisibleText(win, 'Open tasks');
    await clickVisibleText(win, 'Board');
    await waitFor(win, 'views board shows the seeded task', async () => {
      const current = await evaluate(win, `(() => {
        const panel = document.querySelector('[data-mn-views-panel]');
        return {
          panel: Boolean(panel),
          box: Boolean(panel?.querySelector('button[aria-label="Complete task"]')),
          text: panel ? panel.textContent.slice(0, 160) : '',
        };
      })()`);
      return { ok: current.panel && current.box, current };
    });
    // Enter pressed on the checkbox itself belongs to the checkbox. The card
    // around it also listens for Enter, and used to hijack the bubbled key
    // and open the note instead of completing the task.
    const dispatchedKey = await evaluate(win, `(() => {
      const rows = [...document.querySelectorAll('[data-mn-views-body] [data-mn-view-row]')];
      const row = rows.find(el => (el.textContent || '').includes('ship the views board'));
      const box = row?.querySelector('button[aria-label="Complete task"]');
      if (!box) return false;
      box.focus();
      box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
      return true;
    })()`);
    if (!dispatchedKey) throw new Error('Could not aim Enter at the views task checkbox');
    await waitFor(win, 'views panel survives keyboard on the checkbox', async () => {
      const current = await evaluate(win, `(() => ({
        panel: Boolean(document.querySelector('[data-mn-views-panel]')),
      }))()`);
      return { ok: current.panel, current };
    });
    await clickViewsRowCheck(win, 'ship the views board');
    await waitForPersistedNote(win, 'QE Views Task Note', note => /- \[x\]\s+ship the views board/i.test(String(note.body || '')));
  } finally {
    await setPackEnabledForRegression(win, 'views', false);
  }
}

async function runPackIsolationScenario(win) {
  const cases = [
    { id: 'planning', commands: ['calendar', 'set-workflow-status', 'template-project'], labels: ['Agenda'] },
    { id: 'canvas', commands: ['canvas', 'create-canvas'], labels: [] },
    { id: 'research', commands: ['template-reading'], labels: [] },
    { id: 'writer', commands: ['template-novel-scene'], labels: [] },
    { id: 'agents', commands: [], labels: [] },
    // No label here on purpose: the check is a substring match on body text
    // and 'Views' is contained in 'Smart Views'. The command id isolates it,
    // and the dedicated Views scenario probes the panel by attribute.
    { id: 'views', commands: ['views'], labels: [] },
    { id: 'labs', commands: ['graph', 'smart-views'], labels: ['Smart Views', 'Graph'] },
  ];
  const specialistCommands = new Set(cases.flatMap(item => item.commands));
  const specialistLabels = [...new Set(cases.flatMap(item => item.labels))];

  // Views is the fresh-install default. Remove it before checking that each
  // optional pack exposes only its own commands and destinations.
  await setPackEnabledForRegression(win, 'views', false);
  await setSidebarMoreExpanded(win, true);

  for (const item of cases) {
    await setPackEnabledForRegression(win, item.id, true);
    const ids = await availableCommandIds(win);
    for (const commandId of item.commands) {
      if (!ids.includes(commandId)) throw new Error(`${item.id} pack did not expose ${commandId}: ${JSON.stringify(ids)}`);
    }
    for (const commandId of specialistCommands) {
      if (!item.commands.includes(commandId) && ids.includes(commandId)) {
        throw new Error(`${item.id} pack leaked ${commandId}`);
      }
    }
    const bodyText = await evaluate(win, `document.body?.textContent || ''`);
    for (const label of item.labels) {
      if (!bodyText.includes(label)) throw new Error(`${item.id} pack did not expose ${label}`);
    }
    for (const label of specialistLabels) {
      if (!item.labels.includes(label) && bodyText.includes(label)) {
        throw new Error(`${item.id} pack leaked ${label}`);
      }
    }
    if (item.labels.length) {
      await setSidebarMoreExpanded(win, false);
      const collapsedSidebarText = await evaluate(win, `document.querySelector('[data-mn-sidebar="true"]')?.textContent || ''`);
      for (const label of item.labels) {
        if (collapsedSidebarText.includes(label)) throw new Error(`${item.id} left ${label} visible outside More`);
      }
      await setSidebarMoreExpanded(win, true);
    }
    await setPackEnabledForRegression(win, item.id, false);
  }

  const finalIds = await availableCommandIds(win);
  for (const commandId of specialistCommands) {
    if (finalIds.includes(commandId)) throw new Error(`disabled packs left ${commandId} available`);
  }
}

async function setSidebarMoreExpanded(win, expanded) {
  const read = () => evaluate(win, `(() => {
    const toggle = [...document.querySelectorAll('button')]
      .find(button => (button.textContent || '').trim() === 'More');
    return {
      found: Boolean(toggle),
      expanded: toggle?.getAttribute('aria-expanded') === 'true',
      list: Boolean(document.querySelector('[data-mn-sidebar-more]')),
    };
  })()`);

  let current = await read();
  if (!current.found) throw new Error('Sidebar More disclosure was not found');
  if (current.expanded !== expanded) await clickButton(win, { text: 'More' });
  await waitFor(win, `sidebar More ${expanded ? 'expanded' : 'collapsed'}`, async () => {
    current = await read();
    return { ok: current.expanded === expanded && current.list === expanded, current };
  });
}

async function runSidebarMoreDisclosureScenario(win) {
  const layout = async () => evaluate(win, `(() => {
    const visible = element => {
      if (!element) return false;
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && rect.height > 0;
    };
    const toggle = [...document.querySelectorAll('button')]
      .find(button => (button.textContent || '').trim() === 'More');
    const more = document.querySelector('[data-mn-sidebar-more]');
    const item = more?.querySelector('[role="button"][aria-label^="Recently deleted,"]');
    const items = [...(more?.querySelectorAll('[role="button"]') || [])]
      .filter(visible)
      .map(row => (row.getAttribute('aria-label') || '').split(',')[0]);
    const toggleRect = toggle?.getBoundingClientRect();
    const itemRect = visible(item) ? item.getBoundingClientRect() : null;
    return {
      found: Boolean(toggle),
      expanded: toggle?.getAttribute('aria-expanded') === 'true',
      toggleTop: toggleRect?.top ?? -1,
      itemVisible: Boolean(itemRect),
      itemTop: itemRect?.top ?? -1,
      itemBottom: itemRect?.bottom ?? -1,
      items,
    };
  })()`);

  let current = await layout();
  if (!current.found) throw new Error('Sidebar More disclosure was not found');
  await setSidebarMoreExpanded(win, false);
  current = await layout();
  const collapsedTop = current.toggleTop;

  await clickButton(win, { text: 'More' });
  await waitFor(win, 'sidebar More expands its list above the control', async () => {
    current = await layout();
    return {
      ok: current.expanded && current.itemVisible
        && current.itemTop < current.toggleTop
        && current.itemBottom <= current.toggleTop
        && current.items.at(-1) === 'Recently deleted'
        && current.toggleTop > collapsedTop,
      current,
      collapsedTop,
    };
  });

  await clickButton(win, { text: 'More' });
  await waitFor(win, 'sidebar More returns to its collapsed separator position', async () => {
    current = await layout();
    return {
      ok: !current.expanded && !current.itemVisible
        && current.items.length === 0
        && Math.abs(current.toggleTop - collapsedTop) < 1,
      current,
      collapsedTop,
    };
  });
}

async function runSidebarDestinationVisibilityScenario(win) {
  const settingsLabels = ['Today', 'Thinking Board', 'Workflow', 'Quick Capture'];
  const sidebarLabels = ['Today', 'Thinking Board', 'Workflow', 'Quick capture'];
  const readRows = () => evaluate(win, `
    [...(document.querySelector('[data-mn-sidebar-more]')?.querySelectorAll('[role="button"]') || [])]
      .map(row => (row.getAttribute('aria-label') || '').split(',')[0])
  `);
  const assertHidden = async (label) => {
    await setSidebarMoreExpanded(win, true);
    await waitFor(win, label, async () => {
      const rows = await readRows();
      return {
        ok: sidebarLabels.every(item => !rows.includes(item))
          && rows.at(-1) === 'Recently deleted',
        rows,
      };
    });
  };

  await assertHidden('optional sidebar destinations hidden by default');
  await setPackEnabledForRegression(win, 'planning', true);
  await setPackEnabledForRegression(win, 'canvas', true);
  await assertHidden('available sidebar destinations stay hidden until enabled');

  await setSidebarDestinationsForRegression(
    win,
    Object.fromEntries(settingsLabels.map(label => [label, true]))
  );
  await setSidebarMoreExpanded(win, true);
  await waitFor(win, 'enabled optional sidebar destinations appear inside More', async () => {
    const rows = await readRows();
    return {
      ok: sidebarLabels.every(label => rows.includes(label))
        && rows.at(-1) === 'Recently deleted',
      rows,
    };
  });

  await setSidebarDestinationsForRegression(
    win,
    Object.fromEntries(settingsLabels.map(label => [label, false]))
  );
  await assertHidden('disabled optional sidebar destinations leave More');
  await setPackEnabledForRegression(win, 'planning', false);
  await setPackEnabledForRegression(win, 'canvas', false);
}

async function activeVaultId(win) {
  return await evaluate(win, `
    (async () => {
      const unwrap = (result, label) => {
        if (!result?.ok) throw new Error(label + ': ' + (result?.error || 'failed'));
        return result.data ?? result.value;
      };
      const vaultResult = unwrap(await window.mn.vaults.listVaults(), 'listVaults');
      const vaults = Array.isArray(vaultResult) ? vaultResult : (vaultResult?.vaults || []);
      const prefs = unwrap(await window.mn.preferences.getPrefs(), 'getPrefs');
      const active = vaults.find(v => v.id === prefs.activeVaultId) || vaults[0];
      if (!active) throw new Error('No active vault');
      return active.id;
    })()
  `);
}

async function loadActiveVault(win) {
  const vaultId = await activeVaultId(win);
  return await evaluate(win, `
    (async () => {
      const res = await window.mn.notes.loadVault(${JSON.stringify(vaultId)});
      if (!res?.ok) throw new Error(res?.error || 'loadVault failed');
      return res.value;
    })()
  `);
}

async function waitForPersistedNote(win, title, predicate = () => true) {
  return await waitFor(win, `persisted note ${title}`, async () => {
    const vault = await loadActiveVault(win);
    const note = (vault.notes || []).find(item => item.title === title);
    return { ok: !!note && predicate(note), note };
  });
}

async function waitForPersistedBody(win, text) {
  return await waitFor(win, `persisted capture ${text}`, async () => {
    const vault = await loadActiveVault(win);
    const note = (vault.notes || []).find(item => String(item.body || '').includes(text));
    return { ok: !!note, note };
  });
}

async function waitForDeletedNote(win, title) {
  const vaultId = await activeVaultId(win);
  return await waitFor(win, `deleted note ${title}`, async () => {
    const res = await evaluate(win, `
      (async () => {
        const result = await window.mn.notes.listDeletedNotes(${JSON.stringify(vaultId)});
        if (!result?.ok) throw new Error(result?.error || 'listDeletedNotes failed');
        return result.value || [];
      })()
    `);
    const item = res.find(row => row.title === title);
    return { ok: !!item, item, deleted: res.map(row => row.title).slice(0, 20) };
  });
}

async function waitForCanvas(win, title) {
  const vaultId = await activeVaultId(win);
  return await waitFor(win, `canvas ${title}`, async () => {
    const res = await evaluate(win, `
      (async () => {
        const result = await window.mn.canvas.listCanvases(${JSON.stringify(vaultId)});
        if (!result?.ok) throw new Error(result?.error || 'listCanvases failed');
        return result.value || [];
      })()
    `);
    const canvas = res.find(row => row.title === title);
    return { ok: !!canvas, canvas };
  });
}

async function loadCanvasByTitle(win, title) {
  const vaultId = await activeVaultId(win);
  return await evaluate(win, `
    (async () => {
      const listResult = await window.mn.canvas.listCanvases(${JSON.stringify(vaultId)});
      if (!listResult?.ok) throw new Error(listResult?.error || 'listCanvases failed');
      const canvas = (listResult.value || []).find(row => row.title === ${JSON.stringify(title)});
      if (!canvas) return null;
      const getResult = await window.mn.canvas.getCanvas(${JSON.stringify(vaultId)}, canvas.id);
      if (!getResult?.ok) throw new Error(getResult?.error || 'getCanvas failed');
      return getResult.value || null;
    })()
  `);
}

async function waitForCanvasContent(win, title, label, predicate) {
  return await waitFor(win, `${label} in canvas ${title}`, async () => {
    const canvas = await loadCanvasByTitle(win, title);
    if (!canvas) return { ok: false, canvas: null };
    const result = predicate(canvas);
    if (result && typeof result === 'object') return { canvas, ...result, ok: !!result.ok };
    return { ok: !!result, canvas };
  });
}

async function canvasStageRect(win) {
  const rect = await evaluate(win, `
    (() => {
      const el = document.querySelector('[data-mn-canvas-stage="true"]');
      if (!el) return { ok: false, reason: 'missing canvas stage' };
      const style = getComputedStyle(el);
      const box = el.getBoundingClientRect();
      const visible = style.visibility !== 'hidden' && style.display !== 'none' && box.width > 0 && box.height > 0;
      return {
        ok: visible,
        reason: visible ? '' : 'canvas stage hidden',
        x: box.x,
        y: box.y,
        width: box.width,
        height: box.height,
      };
    })()
  `);
  if (!rect.ok) throw new Error(`Canvas stage unavailable: ${JSON.stringify(rect)}`);
  return rect;
}

async function mouseDrag(win, from, to, steps = 8) {
  const point = (raw) => ({ x: Math.round(raw.x), y: Math.round(raw.y) });
  const start = point(from);
  const end = point(to);
  win.webContents.sendInputEvent({ type: 'mouseMove', ...start });
  await wait(30);
  win.webContents.sendInputEvent({ type: 'mouseDown', ...start, button: 'left', clickCount: 1 });
  await wait(30);
  for (let i = 1; i <= steps; i++) {
    const x = start.x + ((end.x - start.x) * i / steps);
    const y = start.y + ((end.y - start.y) * i / steps);
    win.webContents.sendInputEvent({ type: 'mouseMove', ...point({ x, y }), button: 'left' });
    await wait(25);
  }
  win.webContents.sendInputEvent({ type: 'mouseUp', ...end, button: 'left', clickCount: 1 });
  await wait(150);
}

async function assertViewportUsable(win, label) {
  const metrics = await evaluate(win, `
    (() => {
      const visible = (el) => {
        if (!el) return false;
        const style = getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        return style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && rect.height > 0;
      };
      const doc = document.documentElement;
      const body = document.body;
      const buttons = [...document.querySelectorAll('button')]
        .filter(visible)
        .map(el => ({
          text: (el.textContent || '').trim(),
          title: el.getAttribute('title') || '',
          aria: el.getAttribute('aria-label') || '',
        }));
      const horizontalOverflow = doc.scrollWidth > doc.clientWidth + 2 || body.scrollWidth > body.clientWidth + 2;
      const overflowers = [...document.querySelectorAll('body *')]
        .filter(visible)
        .map(el => {
          const rect = el.getBoundingClientRect();
          return {
            tag: el.tagName,
            className: typeof el.className === 'string' ? el.className : '',
            id: el.id || '',
            left: Math.round(rect.left),
            right: Math.round(rect.right),
            width: Math.round(rect.width),
            text: (el.textContent || '').trim().slice(0, 80),
          };
        })
        .filter(item => item.left < -2 || item.right > doc.clientWidth + 2)
        .slice(0, 10);
      return {
        label: ${JSON.stringify(label)},
        innerWidth: window.innerWidth,
        innerHeight: window.innerHeight,
        clientWidth: doc.clientWidth,
        scrollWidth: doc.scrollWidth,
        bodyClientWidth: body.clientWidth,
        bodyScrollWidth: body.scrollWidth,
        horizontalOverflow,
        overflowers,
        hasNewNote: buttons.some(btn => btn.text === 'New note'),
        hasQuickCapture: buttons.some(btn => String(btn.title || '').includes('Quick capture'))
          || [...document.querySelectorAll('[role="button"][aria-label^="Quick capture"]')].some(visible)
          || buttons.some(btn => btn.text === 'More'),
        hasSettings: buttons.some(btn => String(btn.title || '').toLowerCase().includes('settings')),
        hasSearch: [...document.querySelectorAll('input')].filter(visible).some(el => el.getAttribute('aria-label') === 'Search note contents'),
      };
    })()
  `);
  if (metrics.horizontalOverflow || !metrics.hasNewNote || !metrics.hasQuickCapture || !metrics.hasSettings || !metrics.hasSearch) {
    throw new Error(`Viewport ${label} is not usable: ${JSON.stringify(metrics)}`);
  }
  return metrics;
}

async function setAssistanceEnabledForRegression(win, enabled) {
  await clickButton(win, { titleIncludes: 'Open settings' });
  await waitFor(win, 'settings open for assistance', async () => {
    const current = await state(win);
    return { ok: current.settingsOpen, current };
  });
  await clickVisibleText(win, 'Assistance');
  await waitFor(win, 'assistance toggle synced with persisted config', async () => {
    const result = await evaluate(win, `
      (async () => {
        const label = [...document.querySelectorAll('div')]
          .find(element => element.children.length === 0 && (element.textContent || '').trim() === 'Enable assistance');
        const toggle = label?.parentElement?.parentElement?.querySelector('button[aria-pressed]');
        const response = await window.mn.ai.getConfig();
        const persisted = response?.value?.enabled === true;
        const pressed = toggle?.getAttribute('aria-pressed') === 'true';
        return { found: Boolean(toggle), disabled: toggle?.disabled === true, loaded: response?.ok === true, pressed, persisted };
      })()
    `);
    return { ok: result.found && !result.disabled && result.loaded && result.pressed === result.persisted, result };
  });
  await evaluate(win, `
    (() => {
      const label = [...document.querySelectorAll('div')]
        .find(element => element.children.length === 0 && (element.textContent || '').trim() === 'Enable assistance');
      const toggle = label?.parentElement?.parentElement?.querySelector('button[aria-pressed]');
      const next = ${enabled ? 'true' : 'false'};
      if (toggle && (toggle.getAttribute('aria-pressed') === 'true') !== next) toggle.click();
    })()
  `);
  await waitFor(win, `assistance ${enabled ? 'enabled' : 'disabled'}`, async () => {
    const result = await evaluate(win, `
      (async () => {
        const label = [...document.querySelectorAll('div')]
          .find(element => element.children.length === 0 && (element.textContent || '').trim() === 'Enable assistance');
        const pressed = label?.parentElement?.parentElement?.querySelector('button[aria-pressed]')?.getAttribute('aria-pressed') === 'true';
        const response = await window.mn.ai.getConfig();
        return { loaded: response?.ok === true, pressed, persisted: response?.value?.enabled === true };
      })()
    `);
    return { ok: result.loaded && result.pressed === enabled && result.persisted === enabled, result };
  });
  await clickButton(win, { aria: 'Close settings' });
  await waitFor(win, 'settings closed after assistance change', async () => {
    const current = await state(win);
    return { ok: !current.settingsOpen, current };
  });
}

async function runFirstRunGuidanceScenario(win) {
  const vault = await loadActiveVault(win);
  const welcome = (vault.notes || []).find(note => note.title === 'Welcome to VispNote');
  const welcomeTime = Date.parse(welcome?.date || '');
  const welcomeAge = Date.now() - welcomeTime;
  if (!welcome
    || welcome.pinned !== false
    || !String(welcome.body || '').includes('Write · Connect · Act.')
    || /^\s*\d+[.)]\s+/m.test(String(welcome.body || ''))
    || !Number.isFinite(welcomeTime)
    || welcomeAge < 0
    || welcomeAge > 5 * 60 * 1000) {
    throw new Error(`First-run welcome is not installation-time guidance: ${JSON.stringify(welcome)}`);
  }

  await waitFor(win, 'new-note guidance is ready', async () => {
    const tip = await evaluate(win, `
      document.querySelector('[data-mn-onboarding-tip]')?.getAttribute('data-mn-onboarding-tip') || ''
    `);
    return { ok: tip === 'new-note', tip };
  });

  await clickButton(win, { aria: 'Dismiss new-note tip' });
  await waitFor(win, 'new-note guidance dismissed', async () => {
    const tip = await evaluate(win, `document.querySelector('[data-mn-onboarding-tip]')?.getAttribute('data-mn-onboarding-tip') || ''`);
    return { ok: tip === '', tip };
  });

  await clickButton(win, { text: 'New note' });
  await waitFor(win, 'linking guidance shown on the first user note', async () => {
    const result = await evaluate(win, `({
      title: document.querySelector('.mn-note-title-input')?.value || '',
      tip: document.querySelector('[data-mn-onboarding-tip]')?.getAttribute('data-mn-onboarding-tip') || ''
    })`);
    return { ok: result.title === 'Untitled' && result.tip === 'linking', result };
  });
  await setTitleInput(win, 'First useful note');
  await ensureEditorRowTypingFocus(win, 0, 'first useful note body ready');
  await setActiveEditorText(win, 'A thought worth keeping.');
  await waitForPersistedNote(win, 'First useful note', note => String(note.body || '').includes('thought worth keeping'));

  await clickButton(win, { aria: 'Dismiss linking tip' });
  await waitFor(win, 'checkbox guidance shown after linking guidance', async () => {
    const tip = await evaluate(win, `document.querySelector('[data-mn-onboarding-tip]')?.getAttribute('data-mn-onboarding-tip') || ''`);
    return { ok: tip === 'checkboxes', tip };
  });
  await clickButton(win, { aria: 'Dismiss checkboxes tip' });
  await waitFor(win, 'all contextual guidance dismissed and persisted', async () => {
    const result = await evaluate(win, `
      (async () => {
        const prefs = await window.mn.preferences.getPrefs();
        return {
          tip: document.querySelector('[data-mn-onboarding-tip]')?.getAttribute('data-mn-onboarding-tip') || '',
          dismissed: (prefs?.data || prefs?.value || {}).tweaks?.onboardingTipsDismissed || ''
        };
      })()
    `);
    return { ok: result.tip === '' && result.dismissed === 'new-note,linking,checkboxes', result };
  });
}

async function runEmptyTodayScenario(win) {
  await runCommandPaletteCommand(win, 'open today', 'Open today');
  await waitFor(win, 'calm empty Today surface', async () => {
    const result = await evaluate(win, `
      (() => {
        const root = document.querySelector('[data-mn-today-root="true"]');
        const buttons = root ? [...root.querySelectorAll('button')].map(button => (button.textContent || '').trim()) : [];
        const sections = root ? [...root.querySelectorAll('[data-mn-today-section]')].map(section => section.getAttribute('data-mn-today-section')) : [];
        return {
          empty: root?.getAttribute('data-mn-today-empty') || '',
          createDaily: buttons.filter(text => text === 'Create daily note').length,
          quickTask: Boolean(root?.querySelector('input[aria-label="Quick task"]')),
          secondaryActions: buttons.filter(text => ['Add reflection', 'End-day recap', 'AI recap'].includes(text)),
          sections,
        };
      })()
    `);
    return {
      ok: result.empty === 'true'
        && result.createDaily === 1
        && result.quickTask
        && result.secondaryActions.length === 0
        && result.sections.length === 0,
      result,
    };
  });
  await clickVisibleText(win, 'All notes');
  await waitFor(win, 'note editor restored after empty Today check', async () => {
    const current = await state(win);
    return { ok: current.selectedTitle && current.editorBodyVisible, current };
  });
}

async function runPopulatedTodayScenario(win) {
  await runCommandPaletteCommand(win, 'open today', 'Open today');
  await waitFor(win, 'populated Today adapts without duplicate daily actions', async () => {
    const result = await evaluate(win, `
      (() => {
        const root = document.querySelector('[data-mn-today-root="true"]');
        const buttons = root ? [...root.querySelectorAll('button')].map(button => (button.textContent || '').trim()) : [];
        const sections = root ? [...root.querySelectorAll('[data-mn-today-section]')].map(section => section.getAttribute('data-mn-today-section')) : [];
        return {
          empty: root?.getAttribute('data-mn-today-empty') || '',
          dailyActions: buttons.filter(text => text === 'Create daily note' || text === 'Open daily note').length,
          sections,
        };
      })()
    `);
    return {
      ok: result.empty === 'false'
        && result.dailyActions === 1
        && result.sections.includes('agenda')
        && result.sections.includes('notes')
        && result.sections.includes('open-loops'),
      result,
    };
  });
  const dailyAction = await evaluate(win, `
    [...document.querySelectorAll('[data-mn-today-root="true"] button')]
      .map(button => (button.textContent || '').trim())
      .find(text => text === 'Open daily note' || text === 'Create daily note') || ''
  `);
  if (!dailyAction) throw new Error('Today did not expose its one daily-note action');
  await clickButton(win, { text: dailyAction });
  await waitFor(win, 'Today daily-note action opens the note editor', async () => {
    const current = await state(win);
    return { ok: current.selectedTitle && current.editorBodyVisible, current };
  });
  await clickVisibleText(win, 'All notes');
  await waitFor(win, 'note editor restored after populated Today check', async () => {
    const current = await state(win);
    return { ok: current.selectedTitle && current.editorBodyVisible, current };
  });
}

async function openEditorMoreMenu(win) {
  await clickButton(win, { aria: 'More note actions' });
  await waitFor(win, 'editor More menu open', async () => {
    const result = await evaluate(win, `
      (() => {
        const menu = document.querySelector('[role="menu"][aria-label="More note actions"]');
        return { ok: Boolean(menu), text: menu?.textContent || '' };
      })()
    `);
    return { ok: result.ok, result };
  });
}

async function runEditorUsabilityScenario(win) {
  await clickButton(win, { text: 'New note' });
  await waitFor(win, 'blank note editor ready', async () => {
    const result = await evaluate(win, `
      (() => {
        const title = document.querySelector('.mn-note-title-input');
        const header = document.querySelector('[data-mn-editor-header="true"]');
        const properties = document.querySelector('[data-mn-properties-panel="true"]');
        const firstBlock = document.querySelector('.mn-block-row');
        const saveStatus = document.querySelector('[data-mn-editor-save-status="true"]');
        const activeNoteRow = document.querySelector('[data-mn-note-row-active="true"]');
        const primaryCreate = document.querySelector('[data-mn-primary-create="true"]');
        const floatingCapture = [...document.querySelectorAll('button')]
          .some(button => (button.getAttribute('title') || '').startsWith('Quick capture ('));
        const headerButtons = [...(header?.querySelectorAll('button') || [])].map(button => ({
          text: (button.textContent || '').trim(),
          aria: button.getAttribute('aria-label') || '',
        }));
        return {
          ok: Boolean(title && header && firstBlock)
            && !properties
            // Save state is a persistent status pill in the design system, so
            // it is present (and politely announced) even when everything is
            // saved. State is stated, not hidden.
            && Boolean(saveStatus)
            && saveStatus.getAttribute('aria-live') === 'polite'
            && header.textContent.includes('0 words')
            && headerButtons.some(button => button.aria === 'Pin note' && !button.text)
            && headerButtons.some(button => button.aria === 'More note actions' && !button.text)
            && !headerButtons.some(button => ['Duplicate note', 'Version history', 'Delete note', 'Open graph', 'Open agenda'].includes(button.text))
            && Boolean(primaryCreate)
            && !floatingCapture
            // Exactly one row lifts off the pane: the selected one.
            && (!activeNoteRow || activeNoteRow.style.boxShadow !== 'none'),
          title: title?.value || '',
          properties: Boolean(properties),
          headerText: header?.textContent || '',
          headerButtons,
          titleTop: title?.getBoundingClientRect().top || 0,
          firstBlockTop: firstBlock?.getBoundingClientRect().top || 0,
        };
      })()
    `);
    return { ok: result.ok && result.titleTop < result.firstBlockTop, result };
  });

  await openEditorMoreMenu(win);
  const menuState = await evaluate(win, `
    (() => {
      const menu = document.querySelector('[role="menu"][aria-label="More note actions"]');
      const text = menu?.textContent || '';
      return {
        text,
        hasCoreActions: ['Duplicate note', 'Version history', 'Export as Markdown', 'Delete note'].every(label => text.includes(label)),
        hasDisabledPackActions: text.includes('Open graph') || text.includes('Open agenda'),
      };
    })()
  `);
  if (!menuState.hasCoreActions || menuState.hasDisabledPackActions) {
    throw new Error(`Editor More menu is not focused: ${JSON.stringify(menuState)}`);
  }
  await waitFor(win, 'editor More menu focuses its first action', async () => {
    const activeLabel = await evaluate(win, `document.activeElement?.getAttribute('aria-label') || ''`);
    return { ok: activeLabel === 'Duplicate note', activeLabel };
  });
  await pressAccelerator(win, 'Down');
  await waitFor(win, 'editor More menu supports arrow navigation', async () => {
    const activeLabel = await evaluate(win, `document.activeElement?.getAttribute('aria-label') || ''`);
    return { ok: activeLabel === 'Version history', activeLabel };
  });
  await pressAccelerator(win, 'Escape');

  await clickButton(win, { text: '+ Tag' });
  await waitFor(win, 'tag picker focuses its input', async () => {
    const activeLabel = await evaluate(win, `document.activeElement?.getAttribute('aria-label') || ''`);
    return { ok: activeLabel === 'New tag name', activeLabel };
  });
  await pressAccelerator(win, 'Escape');
  await waitFor(win, 'tag picker returns focus to its trigger', async () => {
    const activeText = await evaluate(win, `(document.activeElement?.textContent || '').trim()`);
    return { ok: activeText === '+ Tag', activeText };
  });

  await clickButton(win, { aria: 'Show note properties' });
  await waitFor(win, 'property editor opens on demand', async () => {
    const result = await evaluate(win, `
      (() => ({
        panel: Boolean(document.querySelector('[data-mn-properties-panel="true"]')),
        propertyName: Boolean(document.querySelector('input[aria-label="Property name"]')),
      }))()
    `);
    return { ok: result.panel && result.propertyName, result };
  });
  await pressAccelerator(win, 'Escape');
  await waitFor(win, 'empty property editor dismisses without metadata', async () => {
    const panel = await evaluate(win, `Boolean(document.querySelector('[data-mn-properties-panel="true"]'))`);
    return { ok: !panel, panel };
  });
}

async function runValueHardeningSurfaceScenario(win) {
  await waitFor(win, 'local status reaches a settled state', async () => {
    const result = await evaluate(win, `
      (() => {
        const button = document.querySelector('button[aria-label^="Local status:"]');
        return { found: Boolean(button), label: button?.getAttribute('aria-label') || '' };
      })()
    `);
    return { ok: result.found && !result.label.includes('Saving'), result };
  });
  await evaluate(win, `document.querySelector('button[aria-label^="Local status:"]')?.click()`);
  await waitFor(win, 'local status reveals recovery details', async () => {
    const result = await evaluate(win, `
      (() => {
        const dialog = document.querySelector('[role="dialog"][aria-label="Local vault status"]');
        const text = dialog?.textContent || '';
        return {
          open: Boolean(dialog),
          folder: text.includes('Vault folder'),
          backup: text.includes('Last backup'),
          health: text.includes('Vault health'),
          backupAction: text.includes('Back up now'),
        };
      })()
    `);
    return { ok: result.open && result.folder && result.backup && result.health && result.backupAction, result };
  });
  await pressAccelerator(win, 'Escape');
  await waitFor(win, 'local status closes and returns focus', async () => {
    const result = await evaluate(win, `({
      open: Boolean(document.querySelector('[role="dialog"][aria-label="Local vault status"]')),
      focus: document.activeElement?.getAttribute('aria-label') || '',
    })`);
    return { ok: !result.open && result.focus.startsWith('Local status:'), result };
  });

  const sourceNoteVisible = await evaluate(win, `
    [...document.querySelectorAll('[role="option"]')]
      .some(element => (element.textContent || '').includes('First useful note'))
  `);
  if (!sourceNoteVisible) {
    await clickButton(win, { aria: 'Show note list' });
    await waitFor(win, 'compact note list reveals the assistance source note', async () => {
      const visible = await evaluate(win, `
        [...document.querySelectorAll('[role="option"]')]
          .some(element => (element.textContent || '').includes('First useful note'))
      `);
      return { ok: visible, visible };
    });
  }
  await clickVisibleText(win, 'First useful note');
  await waitFor(win, 'meaningful source note opens for assistance', async () => {
    const current = await state(win);
    return { ok: current.selectedTitle === 'First useful note', current };
  });
  await setAssistanceEnabledForRegression(win, true);
  await waitFor(win, 'contextual assistance stays compact in the editor header', async () => {
    const result = await evaluate(win, `
      (() => {
        const trigger = document.querySelector('button[aria-label="Work with this note"]');
        return {
          found: Boolean(trigger),
          inHeader: Boolean(trigger?.closest('[data-mn-editor-header="true"]')),
          expanded: trigger?.getAttribute('aria-expanded') || '',
          popoverOpen: Boolean(document.querySelector('[data-mn-contextual-assistance-popover="true"]')),
          previewOpen: Boolean(document.querySelector('[aria-labelledby="mn-assistance-preview-title"]')),
        };
      })()
    `);
    return {
      ok: result.found && result.inHeader && result.expanded === 'false'
        && !result.popoverOpen && !result.previewOpen,
      result,
    };
  });
  await clickButton(win, { aria: 'Work with this note', enabled: true });
  await waitFor(win, 'contextual assistance reveals four preview-first actions on demand', async () => {
    const result = await evaluate(win, `
      (() => {
        const popover = document.querySelector('[data-mn-contextual-assistance-popover="true"]');
        const labels = [...(popover?.querySelectorAll('button') || [])]
          .map(button => button.getAttribute('aria-label') || '');
        return {
          found: Boolean(popover),
          actionCount: ['Brief from ', 'Outline from ', 'Decisions from ', 'Next actions from ']
            .filter(prefix => labels.some(label => label.startsWith(prefix))).length,
          text: popover?.textContent || '',
          focused: document.activeElement?.getAttribute('aria-label') || '',
        };
      })()
    `);
    return {
      ok: result.found && result.actionCount === 4
        && result.text.includes('Create a linked note after reviewing the result')
        && result.focused.startsWith('Brief from '),
      result,
    };
  });
  await pressAccelerator(win, 'Down');
  await waitFor(win, 'contextual assistance supports arrow-key navigation', async () => {
    const focused = await evaluate(win, `document.activeElement?.getAttribute('aria-label') || ''`);
    return { ok: focused.startsWith('Outline from '), focused };
  });
  await pressAccelerator(win, 'Escape');
  await waitFor(win, 'contextual assistance closes and returns focus', async () => {
    const result = await evaluate(win, `({
      open: Boolean(document.querySelector('[data-mn-contextual-assistance-popover="true"]')),
      focused: document.activeElement?.getAttribute('aria-label') || '',
    })`);
    return { ok: !result.open && result.focused === 'Work with this note', result };
  });
  if (process.env.VISPNOTE_VALUE_SCREENSHOT) {
    await evaluate(win, `document.querySelector('button[aria-label^="Local status:"]')?.click()`);
    await waitFor(win, 'local status reopens for screenshot', async () => {
      const open = await evaluate(win, `Boolean(document.querySelector('[role="dialog"][aria-label="Local vault status"]'))`);
      return { ok: open, open };
    });
    const screenshotPath = path.resolve(process.env.VISPNOTE_VALUE_SCREENSHOT);
    fs.mkdirSync(path.dirname(screenshotPath), { recursive: true });
    win.webContents.debugger.attach('1.3');
    try {
      const capture = await win.webContents.debugger.sendCommand('Page.captureScreenshot', {
        format: 'png',
        fromSurface: true,
        captureBeyondViewport: false,
      });
      fs.writeFileSync(screenshotPath, Buffer.from(capture.data, 'base64'));
    } finally {
      if (win.webContents.debugger.isAttached()) win.webContents.debugger.detach();
    }
    await pressAccelerator(win, 'Escape');
  }
  await setAssistanceEnabledForRegression(win, false);
}

async function editorRows(win) {
  return await evaluate(win, `
    (() => {
      const visible = (el) => {
        if (!el) return false;
        const style = getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        return style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && rect.height > 0;
      };
      return [...document.querySelectorAll('.mn-block-row[data-block-id]')]
        .filter(visible)
        .map((row, index) => {
          const editor = row.querySelector('[data-mn-block-content="editor"]');
          const display = row.querySelector('[data-mn-block-content="display"]');
          const style = getComputedStyle(row);
          return {
            index,
            id: row.dataset.blockId || '',
            kind: row.dataset.blockKind || '',
            depth: Number(row.dataset.blockDepth || 0),
            paddingLeft: parseFloat(style.paddingLeft || '0') || 0,
            editing: !!editor,
            active: row.contains(document.activeElement),
            value: editor ? editor.value : '',
            text: ((editor ? editor.value : display?.textContent) || '').trim().slice(0, 120),
          };
        });
    })()
  `);
}

async function editorBlockSelectionState(win) {
  return await evaluate(win, `
    [...document.querySelectorAll('.mn-outliner .mn-block-row[data-block-id]')]
      .map(row => ({
        id: row.dataset.blockId || '',
        kind: row.dataset.blockKind || '',
        active: row.contains(document.activeElement),
        editing: Boolean(row.querySelector('[data-mn-block-content="editor"]')),
        selected: row.dataset.mnAreaSelected === 'true',
      }))
  `);
}

async function runScenario(win, area, name, fn) {
  try {
    await fn();
    console.log(`[scenario:pass] ${area} - ${name}`);
  } catch (error) {
    let current = null;
    let rows = null;
    try { current = await state(win); } catch {}
    try { rows = await editorRows(win); } catch {}
    throw new Error(`[${area}] ${name} failed: ${error?.message || String(error)}\nState: ${JSON.stringify(current)}\nEditor rows: ${JSON.stringify(rows)}`);
  }
}

async function seedEditorNote(win, { id, title, body, expect = 'Parent' }) {
  await evaluate(win, `
    (async () => {
      const unwrap = (result, label) => {
        if (!result?.ok) throw new Error(label + ': ' + (result?.error || 'failed'));
        return result.data ?? result.value;
      };
      const vaultResult = unwrap(await window.mn.vaults.listVaults(), 'listVaults');
      const vaults = Array.isArray(vaultResult) ? vaultResult : (vaultResult?.vaults || []);
      const prefs = unwrap(await window.mn.preferences.getPrefs(), 'getPrefs');
      const active = vaults.find(v => v.id === prefs.activeVaultId) || vaults[0];
      if (!active) throw new Error('No vault available for editor regression');
      const now = new Date().toISOString();
      unwrap(await window.mn.notes.saveNote(active.id, {
        id: ${JSON.stringify(id)},
        title: ${JSON.stringify(title)},
        body: ${JSON.stringify(body)},
        tags: ['qe-regression'],
        date: now,
        modifiedAt: now,
      }, { expectedRevision: null }), 'saveNote');
      unwrap(await window.mn.vaults.saveVaultMeta(active.id, {
        lastSelectedId: ${JSON.stringify(id)},
      }), 'saveVaultMeta');
    })()
  `);
  win.webContents.reload();
  await waitFor(win, `editor note loaded: ${title}`, async () => {
    const current = await state(win);
    const rows = await editorRows(win);
    return {
      ok: current.selectedTitle === title
        && rows.length >= 1
        && rows[0].text.includes(expect),
      current,
      rows,
    };
  });
}

async function focusEditorRow(win, index) {
  const result = await evaluate(win, `
    (() => {
      const rows = [...document.querySelectorAll('.mn-block-row[data-block-id]')];
      const row = rows[${Number(index) || 0}];
      if (!row) return { ok: false, rows: rows.length };
      const target = row.querySelector('[data-mn-block-content="display"]')
        || row.querySelector('[data-mn-block-content="editor"]')
        || row;
      target.click();
      return { ok: true, rows: rows.length };
    })()
  `);
  if (!result.ok) throw new Error(`Could not focus editor row ${index}: ${JSON.stringify(result)}`);
  await waitFor(win, `editor row ${index} editing`, async () => {
    const rows = await editorRows(win);
    return { ok: rows[index]?.editing && rows[index]?.active, rows };
  });
  await evaluate(win, `
    (() => {
      const active = document.activeElement;
      if (!active || active.getAttribute('data-mn-block-content') !== 'editor') return false;
      const end = active.value.length;
      active.setSelectionRange(end, end);
      return true;
    })()
  `);
}

async function waitForEditorLayout(win, label, predicate) {
  return await waitFor(win, `editor layout: ${label}`, async () => {
    const rows = await editorRows(win);
    return { ok: predicate(rows), rows };
  });
}

async function dragEditorBlockRangeAcrossScroll(win, startIndex, endIndex) {
  const pointForRow = async (index) => {
    const result = await evaluate(win, `
      (() => {
        const rows = [...document.querySelectorAll('.mn-outliner .mn-block-row[data-block-id]')];
        const row = rows[${Number(index)}];
        if (!row) return { ok: false, rows: rows.length };
        row.scrollIntoView({ block: 'center' });
        const rect = row.getBoundingClientRect();
        return {
          ok: rect.width > 0 && rect.height > 0,
          rows: rows.length,
          x: rect.left + Math.min(120, rect.width / 2),
          y: rect.top + rect.height / 2,
        };
      })()
    `);
    if (!result.ok) throw new Error(`Could not position editor row ${index}: ${JSON.stringify(result)}`);
    return { x: Math.round(result.x), y: Math.round(result.y) };
  };

  const start = await pointForRow(startIndex);
  win.webContents.sendInputEvent({ type: 'mouseMove', ...start });
  await wait(30);
  win.webContents.sendInputEvent({ type: 'mouseDown', ...start, button: 'left', clickCount: 1 });
  await wait(30);
  const end = await pointForRow(endIndex);
  win.webContents.sendInputEvent({ type: 'mouseMove', ...end, button: 'left' });
  await wait(60);
  win.webContents.sendInputEvent({ type: 'mouseUp', ...end, button: 'left', clickCount: 1 });
}

async function runLargeBlockSelectionDeleteScenario(win) {
  const blockCount = 60;
  const body = Array.from({ length: blockCount }, (_, index) => `Selection block ${String(index).padStart(2, '0')}`).join('\n\n');
  await seedEditorNote(win, {
    id: 'qe_editor_large_block_selection',
    title: 'QE Large Block Selection',
    body,
    expect: 'Selection block 00',
  });

  const original = await editorBlockSelectionState(win);
  if (original.length !== blockCount) throw new Error(`Expected ${blockCount} blocks, got ${original.length}`);
  const startIndex = 2;
  const endIndex = blockCount - 3;
  const expectedSelectedIds = original.slice(startIndex, endIndex + 1).map(row => row.id);
  const expectedRemainingIds = original
    .filter((_, index) => index < startIndex || index > endIndex)
    .map(row => row.id);

  const exerciseDelete = async (keyCode, fromIndex, toIndex) => {
    await dragEditorBlockRangeAcrossScroll(win, fromIndex, toIndex);
    await waitFor(win, `${keyCode} range selected across editor scroll`, async () => {
      const rows = await editorBlockSelectionState(win);
      const selectedIds = rows.filter(row => row.selected).map(row => row.id);
      return {
        ok: JSON.stringify(selectedIds) === JSON.stringify(expectedSelectedIds),
        selectedIds,
      };
    });
    await pressAccelerator(win, keyCode);
    await waitFor(win, `${keyCode} removes the complete block range`, async () => {
      const rows = await editorBlockSelectionState(win);
      return {
        ok: JSON.stringify(rows.map(row => row.id)) === JSON.stringify(expectedRemainingIds),
        rows,
      };
    });
    await pressAccelerator(win, 'Z', ['control']);
    await waitFor(win, `${keyCode} block deletion undoes in one step`, async () => {
      const rows = await editorBlockSelectionState(win);
      return {
        ok: JSON.stringify(rows.map(row => row.id)) === JSON.stringify(original.map(row => row.id)),
        rows: rows.length,
      };
    });
  };

  await exerciseDelete('Backspace', startIndex, endIndex);
  await exerciseDelete('Delete', endIndex, startIndex);

  await dragEditorBlockRangeAcrossScroll(win, 0, blockCount - 1);
  await pressAccelerator(win, 'Backspace');
  await waitFor(win, 'deleting every block leaves one focused empty paragraph', async () => {
    const rows = await editorBlockSelectionState(win);
    return {
      ok: rows.length === 1 && rows[0].kind === 'paragraph' && rows[0].editing && rows[0].active,
      rows,
    };
  });
  await pressAccelerator(win, 'Z', ['control']);
  await waitFor(win, 'full block deletion undoes in one step', async () => {
    const rows = await editorBlockSelectionState(win);
    return {
      ok: JSON.stringify(rows.map(row => row.id)) === JSON.stringify(original.map(row => row.id)),
      rows: rows.length,
    };
  });
}

async function runEmptyNestedEnterScenario(win, { id, title, body, expectedKind }) {
  await seedEditorNote(win, { id, title, body });
  await focusEditorRow(win, 0);
  await pressAccelerator(win, 'End');
  await pressAccelerator(win, 'Enter');
  await waitForEditorLayout(win, `${title} creates sibling`, rows => (
    rows.length === 2
      && rows[0].depth === 0
      && rows[1].depth === 0
      && rows[1].kind === expectedKind
      && rows[1].editing
      && rows[1].active
  ));
  await pressAccelerator(win, 'Tab');
  await waitForEditorLayout(win, `${title} indents empty sibling`, rows => (
    rows.length === 2
      && rows[0].depth === 0
      && rows[1].depth === 1
      && rows[1].kind === expectedKind
      && rows[1].editing
      && rows[1].active
  ));
  await pressAccelerator(win, 'Enter');
  await waitForEditorLayout(win, `${title} Enter outdents empty child`, rows => (
    rows.length === 2
      && rows[0].depth === 0
      && rows[1].depth === 0
      && rows[1].kind === expectedKind
      && rows[1].editing
      && rows[1].active
  ));
}

async function runShiftTabOutdentScenario(win) {
  await seedEditorNote(win, {
    id: 'qe_editor_shift_tab_outdent',
    title: 'QE Editor Shift Tab Outdent',
    body: 'Parent',
  });
  await focusEditorRow(win, 0);
  await pressAccelerator(win, 'End');
  await pressAccelerator(win, 'Enter');
  await waitForEditorLayout(win, 'Shift+Tab creates sibling', rows => rows.length === 2 && rows[1].depth === 0 && rows[1].editing && rows[1].active);
  await pressAccelerator(win, 'Tab');
  await waitForEditorLayout(win, 'Shift+Tab indents empty paragraph', rows => rows.length === 2 && rows[1].depth === 1 && rows[1].editing && rows[1].active);
  await pressAccelerator(win, 'Tab', ['shift']);
  await waitForEditorLayout(win, 'Shift+Tab returns empty paragraph to parent level', rows => rows.length === 2 && rows[1].depth === 0 && rows[1].editing && rows[1].active);
}

async function runMarkdownTypingScenario(win) {
  await seedEditorNote(win, {
    id: 'qe_editor_markdown_typing',
    title: 'QE Editor Markdown Typing',
    body: 'Parent',
  });
  await focusEditorRow(win, 0);
  await pressAccelerator(win, 'End');
  await pressAccelerator(win, 'Enter');
  await waitForEditorLayout(win, 'markdown typing creates empty paragraph', rows => rows.length === 2 && rows[1].kind === 'paragraph' && rows[1].editing && rows[1].active);

  await typeEditorRowText(win, 1, '# ');
  await waitForEditorLayout(win, 'heading starter converts immediately', rows => rows[1]?.kind === 'heading' && rows[1]?.value === '# ' && rows[1]?.editing && rows[1]?.active);
  await typeEditorRowText(win, 1, 'Markdown heading');
  await waitForEditorLayout(win, 'heading content remains editable as markdown source', rows => rows[1]?.kind === 'heading' && rows[1]?.value === '# Markdown heading' && rows[1]?.active);

  await pressAccelerator(win, 'End');
  await pressAccelerator(win, 'Enter');
  await waitForEditorLayout(win, 'paragraph after heading is editable', rows => rows.length >= 3 && rows[2]?.kind === 'paragraph' && rows[2]?.editing && rows[2]?.active);
  await typeEditorRowText(win, 2, '- [ ] ');
  await waitForEditorLayout(win, 'todo starter converts immediately', rows => rows[2]?.kind === 'todo' && rows[2]?.value === '- [ ] ' && rows[2]?.editing && rows[2]?.active);
  await typeEditorRowText(win, 2, 'Checklist item');
  await waitForEditorLayout(win, 'todo content remains editable as markdown source', rows => rows[2]?.kind === 'todo' && rows[2]?.value === '- [ ] Checklist item' && rows[2]?.active);

  await pressAccelerator(win, 'End');
  await pressAccelerator(win, 'Enter');
  await waitForEditorLayout(win, 'paragraph after todo is editable', rows => rows.length >= 4 && rows[3]?.kind === 'todo' && rows[3]?.editing && rows[3]?.active);
  await pressAccelerator(win, 'Enter');
  await waitForEditorLayout(win, 'empty todo exits to paragraph', rows => rows.length >= 4 && rows[3]?.kind === 'paragraph' && rows[3]?.editing && rows[3]?.active);
  await typeEditorRowText(win, 3, 'Safe [Example](https://example.com) and literal [Bad](javascript:alert(1)) plus ~~strike~~.');
  await waitForEditorLayout(win, 'inline markdown content is preserved as source', rows => rows[3]?.value.includes('[Example](https://example.com)') && rows[3]?.value.includes('~~strike~~'));

  await pressAccelerator(win, 'End');
  await pressAccelerator(win, 'Enter');
  await typeEditorRowText(win, 4, '1. ');
  await waitForEditorLayout(win, 'ordered starter converts immediately', rows => rows[4]?.kind === 'ordered' && rows[4]?.value === '1. ' && rows[4]?.active);
  await typeEditorRowText(win, 4, 'First ordered item');
  await pressAccelerator(win, 'End');
  await pressAccelerator(win, 'Enter');
  await waitForEditorLayout(win, 'ordered Enter advances the portable marker', rows => rows[5]?.kind === 'ordered' && rows[5]?.value === '2. ' && rows[5]?.active);
}

async function runMarkdownCompatibilityScenario(win) {
  await seedEditorNote(win, {
    id: 'qe_editor_markdown_compatibility',
    title: 'QE Editor Markdown Compatibility',
    body: 'Parent\n\n| Name | Notes |\n| --- | --- |\n| Ada | Pipes \\\\| stay |\n\n```js\nconst answer = 42;\n```\n\n[[Wiki Page]] #tag @remind 2026-06-01 09:00',
  });
  await waitForEditorLayout(win, 'markdown table and code remain specialized', rows => (
    rows.some(row => row.kind === 'table' && row.text.includes('Ada'))
      && rows.some(row => row.kind === 'code' && row.text.includes('const answer'))
      && rows.some(row => row.text.includes('Wiki Page'))
  ));
}

async function runMarkdownPredictabilityScenario(win) {
  await seedEditorNote(win, {
    id: 'qe_editor_markdown_predictability',
    title: 'QE Editor Markdown Predictability',
    body: 'Parent',
  });
  await focusEditorRow(win, 0);
  await pressAccelerator(win, 'End');
  await pressAccelerator(win, 'Enter');
  await waitForEditorLayout(win, 'literal marker paragraph is editable', rows => rows.length === 2 && rows[1].kind === 'paragraph' && rows[1].editing);
  await typeActiveEditorText(win, ' # ');
  await waitForEditorLayout(win, 'leading-space marker remains literal', rows => rows[1]?.kind === 'paragraph' && rows[1]?.value === ' # ');
  await pressAccelerator(win, 'A', ['control']);
  await typeActiveEditorText(win, '/');
  await waitForEditorLayout(win, 'slash command text remains in editor', rows => rows[1]?.kind === 'paragraph' && rows[1]?.value.endsWith('/'));
  await pressAccelerator(win, 'Escape');
}

async function runNoteCreateEditPersistenceScenario(win) {
  const title = 'QE User Scenario Note';
  const body = 'A user can create, edit, and persist this note.';
  await clickButton(win, { text: 'New note' });
  await waitFor(win, 'blank note selected for user scenario', async () => {
    const current = await state(win);
    return { ok: /^Untitled/.test(current.selectedTitle), current };
  });
  await setTitleInput(win, title);
  await waitFor(win, 'renamed user scenario note selected', async () => {
    const current = await state(win);
    return { ok: current.selectedTitle === title, current };
  });
  await focusEditorRow(win, 0);
  await setActiveEditorText(win, body);
  await waitForEditorLayout(win, 'edited user scenario body visible', rows => rows[0]?.text.includes('create, edit, and persist'));
  await waitForPersistedNote(win, title, note => String(note.body || '').includes(body));
}

async function runQuickCaptureSaveScenario(win) {
  const body = '- [ ] QE quick capture todo';
  await openQuickCaptureFromAppBar(win);
  await waitFor(win, 'body-first quick capture open for save scenario', async () => {
    const result = await evaluate(win, `
      (() => ({
        open: Boolean(document.querySelector('[role="dialog"][aria-label="Quick capture"]')),
        bodyFocused: document.activeElement?.getAttribute('aria-label') === 'Quick capture text',
        titleVisible: Boolean(document.querySelector('input[aria-label="New note title"]')),
        optionsVisible: [...document.querySelectorAll('select[aria-label^="Capture "]')].some(select => select.getClientRects().length > 0),
      }))()
    `);
    return { ok: result.open && result.bodyFocused && !result.titleVisible && !result.optionsVisible, result };
  });
  await setControlByPlaceholder(win, 'Write it down now, file it later', body);
  await clickButton(win, { text: 'Save to Today' });
  await waitFor(win, 'quick capture saved and closed', async () => {
    const current = await state(win);
    return { ok: !current.quickCaptureOpen, current };
  });
  const persisted = await waitForPersistedBody(win, 'QE quick capture todo');
  if (String(persisted.note?.body || '').includes('Untitled')) {
    throw new Error(`Today capture leaked a synthetic title: ${persisted.note.body}`);
  }

  await openQuickCaptureFromAppBar(win);
  await waitFor(win, 'second body-first capture ready', async () => {
    const focused = await evaluate(win, `document.activeElement?.getAttribute('aria-label') === 'Quick capture text'`);
    return { ok: focused, focused };
  });
  await clickButton(win, { text: 'More options' });
  await waitFor(win, 'capture destination and template disclosed together', async () => {
    const result = await evaluate(win, `({
      destination: Boolean(document.querySelector('select[aria-label="Capture destination"]')?.getClientRects().length),
      template: Boolean(document.querySelector('select[aria-label="Capture template"]')?.getClientRects().length)
    })`);
    return { ok: result.destination && result.template, result };
  });
  await setSelectByAria(win, 'Capture destination', 'new');
  await waitFor(win, 'new-note-only title field appears', async () => {
    const visible = await evaluate(win, `Boolean(document.querySelector('input[aria-label="New note title"]'))`);
    return { ok: visible, visible };
  });
  await setControlByPlaceholder(win, 'Write it down now, file it later', '# Derived capture title\nSupporting detail.');
  await clickButton(win, { text: 'Save' });
  await waitForPersistedNote(win, 'Derived capture title', note => String(note.body || '').includes('Supporting detail.'));
}

async function openQuickCaptureFromAppBar(win) {
  await clickButton(win, { aria: 'Quick capture' });
}

async function runSearchAndClearScenario(win) {
  const title = 'QE User Scenario Note';
  await clickVisibleText(win, 'All notes');
  await waitFor(win, 'all notes view before search', async () => {
    const current = await state(win);
    return { ok: current.text.includes('All notes'), current };
  });
  await setControlByPlaceholder(win, 'Filter this list', 'QE User Scenario');
  await waitFor(win, 'search filters to user scenario note', async () => {
    const current = await state(win);
    return { ok: current.text.includes('Search') && current.text.includes(title), current };
  });
  await clickVisibleText(win, title);
  await waitFor(win, 'search result opens the expected note', async () => {
    const current = await state(win);
    return { ok: current.selectedTitle === title, current };
  });
  await pressAccelerator(win, 'Escape');
  await waitFor(win, 'search clears with Escape', async () => {
    const value = await evaluate(win, `document.querySelector('input[aria-label="Search note contents"]')?.value || ''`);
    return { ok: value === '', value };
  });
}

async function runUnifiedPaletteScenario(win) {
  await pressAccelerator(win, 'K', ['control']);
  await waitFor(win, 'mixed Notes and Actions palette opens', async () => {
    const result = await evaluate(win, `
      (() => {
        const root = document.querySelector('[data-mn-palette-root="true"]');
        if (root) root.dataset.mnRegressionIdentity = 'shared-palette';
        const frequent = [...document.querySelectorAll('[data-mn-frequent-action="true"]')];
        return {
          mode: root?.getAttribute('data-mn-palette-mode') || '',
          noteCount: document.querySelectorAll('[data-mn-palette-kind="note"]').length,
          frequentIds: frequent.map(item => item.getAttribute('data-mn-command-id')),
        };
      })()
    `);
    return {
      ok: result.mode === 'mixed'
        && result.noteCount > 0
        && JSON.stringify(result.frequentIds) === JSON.stringify(['new-note', 'quick-capture', 'today', 'settings']),
      result,
    };
  });

  await pressAccelerator(win, 'P', ['control']);
  await waitFor(win, 'same palette switches to notes-first mode', async () => {
    const result = await evaluate(win, `
      (() => {
        const root = document.querySelector('[data-mn-palette-root="true"]');
        return {
          mode: root?.getAttribute('data-mn-palette-mode') || '',
          identity: root?.dataset.mnRegressionIdentity || '',
          placeholder: root?.querySelector('input')?.getAttribute('placeholder') || '',
        };
      })()
    `);
    return { ok: result.mode === 'notes' && result.identity === 'shared-palette' && result.placeholder.includes('Open or create a note'), result };
  });

  const createdTitle = 'QE Palette Created Zyzzy';
  await setControlByPlaceholder(win, 'Open or create a note', createdTitle);
  await waitFor(win, 'unmatched palette text offers note creation', async () => {
    const result = await evaluate(win, `({
      createTitle: document.querySelector('[data-mn-palette-kind="create"]')?.textContent?.trim() || '',
      firstKind: document.querySelector('[data-mn-palette-kind]')?.getAttribute('data-mn-palette-kind') || ''
    })`);
    return { ok: result.firstKind === 'create' && result.createTitle.includes(createdTitle), result };
  });
  await pressAccelerator(win, 'Enter');
  await waitForPersistedNote(win, createdTitle);

  await pressAccelerator(win, 'P', ['control']);
  await waitFor(win, 'notes-first palette reopens', async () => {
    const mode = await evaluate(win, `document.querySelector('[data-mn-palette-root="true"]')?.getAttribute('data-mn-palette-mode') || ''`);
    return { ok: mode === 'notes', mode };
  });
  await setControlByPlaceholder(win, 'Open or create a note', 'Welcome to VispNote');
  await waitFor(win, 'existing note ranks before actions', async () => {
    const firstKind = await evaluate(win, `document.querySelector('[data-mn-palette-kind]')?.getAttribute('data-mn-palette-kind') || ''`);
    return { ok: firstKind === 'note', firstKind };
  });
  await pressAccelerator(win, 'Enter');
  await waitFor(win, 'palette opens the selected note', async () => {
    const current = await state(win);
    return { ok: current.selectedTitle === 'Welcome to VispNote' && !current.commandPaletteOpen, current };
  });
}

async function runNavigationPanelsScenario(win) {
  await runCommandPaletteCommand(win, 'open agenda', 'Open agenda');
  await waitFor(win, 'sidebar agenda opens calendar planner with captured task', async () => {
    const visible = await evaluate(win, `document.body.textContent.includes('Agenda') && document.body.textContent.includes('QE quick capture todo')`);
    return { ok: visible, visible };
  });
  await runCommandPaletteCommand(win, 'open graph', 'Open graph');
  await waitFor(win, 'graph panel opens with visible heading', async () => {
    const current = await state(win);
    return { ok: current.text.includes('Graph'), current };
  });
}

async function runCalendarPlannerScenario(win) {
  await clickVisibleText(win, 'All notes');
  await waitFor(win, 'note editor visible before calendar toolbar click', async () => {
    const current = await state(win);
    return { ok: current.selectedTitle && current.editorBodyVisible, current };
  });
  const title = (await state(win)).selectedTitle;
  await openEditorMoreMenu(win);
  await clickButton(win, { aria: 'Open agenda' });
  await waitFor(win, 'agenda panel opens from editor More menu', async () => {
    const visible = await evaluate(win, `document.body.textContent.includes('Agenda') && document.body.textContent.includes('Inbox todos')`);
    return { ok: visible, visible };
  });
  await waitFor(win, 'calendar reminder bell is fixed to app chrome', async () => {
    const result = await evaluate(win, `
      (() => {
        const el = document.querySelector('.mn-reminder-center');
        return { position: el ? getComputedStyle(el).position : '' };
      })()
    `);
    return { ok: result.position === 'fixed', result };
  });

  await clickButton(win, { titleIncludes: 'Add item on' });
  await setControlByPlaceholder(win, 'Task or reminder text', 'QE calendar reminder');
  await clickButton(win, { text: 'Add' });
  await waitForPersistedNote(win, title, note => /QE calendar reminder @remind \d{4}-\d{2}-\d{2}/.test(String(note.body || '')));

  await clickButton(win, { text: '+ New' });
  await clickButton(win, { text: 'Todo' });
  await setControlByPlaceholder(win, 'Task or reminder text', 'QE agenda dated todo');
  await clickButton(win, { text: 'Add' });
  await waitForPersistedNote(win, title, note => /QE agenda dated todo @remind \d{4}-\d{2}-\d{2}/.test(String(note.body || '')));
  await waitFor(win, 'agenda dated todo visible on selected day', async () => {
    const visible = await evaluate(win, `document.body.textContent.includes('QE agenda dated todo')`);
    return { ok: visible, visible };
  });

  await clickButton(win, { aria: 'Complete QE agenda dated todo' });
  await waitForPersistedNote(win, title, note => /- \[x\] QE agenda dated todo @remind \d{4}-\d{2}-\d{2}/.test(String(note.body || '')));
}

async function runCanvasCreateScenario(win) {
  const title = 'QE Scenario Canvas';
  await runCommandPaletteCommand(win, 'canvas dashboard', 'Open canvas dashboard');
  await waitFor(win, 'canvas dashboard visible', async () => {
    const current = await state(win);
    return { ok: current.text.includes('Thinking Board') && current.text.includes('canvas'), current };
  });
  await setControlByPlaceholder(win, 'Canvas name', title);
  await clickButton(win, { text: 'Create' });
  await waitForCanvas(win, title);
  await waitFor(win, 'created canvas visible to user', async () => {
    const current = await state(win);
    const titleInputVisible = await evaluate(win, `
      (() => [...document.querySelectorAll('input')]
        .some(el => {
          const style = getComputedStyle(el);
          const rect = el.getBoundingClientRect();
          return el.value === ${JSON.stringify(title)}
            && style.visibility !== 'hidden'
            && style.display !== 'none'
            && rect.width > 0
            && rect.height > 0;
        }))()
    `);
    return { ok: titleInputVisible && current.buttons.some(btn => btn.title === 'Select'), current };
  });

  await clickButton(win, { titleIncludes: 'Rectangle' });
  const stage = await canvasStageRect(win);
  const start = {
    x: stage.x + Math.min(220, Math.max(120, stage.width * 0.22)),
    y: stage.y + Math.min(180, Math.max(100, stage.height * 0.24)),
  };
  const end = { x: start.x + 128, y: start.y + 84 };
  await mouseDrag(win, start, end, 10);
  const created = await waitForCanvasContent(win, title, 'drawn rectangle persisted', canvas => {
    const element = (canvas.elements || []).find(item => item.type === 'rect' && item.w >= 80 && item.h >= 50);
    return { ok: !!element, element, elements: canvas.elements };
  });

  await clickButton(win, { titleIncludes: 'Select' });
  const element = created.element;
  const center = {
    x: stage.x + element.x + element.w / 2,
    y: stage.y + element.y + element.h / 2,
  };
  const movedTo = { x: center.x + 58, y: center.y + 34 };
  await mouseDrag(win, center, movedTo, 8);
  const moved = await waitForCanvasContent(win, title, 'moved rectangle persisted', canvas => {
    const current = (canvas.elements || []).find(item => item.id === element.id);
    return {
      ok: !!current && current.x >= element.x + 35 && current.y >= element.y + 20,
      element: current,
    };
  });

  await pressAccelerator(win, 'Z', ['control']);
  await waitForCanvasContent(win, title, 'canvas undo restores rectangle position', canvas => {
    const current = (canvas.elements || []).find(item => item.id === element.id);
    return {
      ok: !!current && Math.abs(current.x - element.x) <= 3 && Math.abs(current.y - element.y) <= 3,
      element: current,
    };
  });
  await pressAccelerator(win, 'Y', ['control']);
  await waitForCanvasContent(win, title, 'canvas redo reapplies rectangle move', canvas => {
    const current = (canvas.elements || []).find(item => item.id === element.id);
    return {
      ok: !!current && Math.abs(current.x - moved.element.x) <= 3 && Math.abs(current.y - moved.element.y) <= 3,
      element: current,
    };
  });
}

async function waitForLayoutMode(win, expectedMode) {
  return await waitFor(win, `${expectedMode} layout mode`, async () => {
    const result = await evaluate(win, `({
      mode: document.querySelector('[data-mn-layout]')?.getAttribute('data-mn-layout') || '',
      width: window.innerWidth,
    })`);
    return { ok: result.mode === expectedMode, result };
  });
}

async function clearRegressionViewportOverride(win) {
  if (!win.__vispnoteViewportOverride) return;
  try {
    await win.webContents.debugger.sendCommand('Emulation.clearDeviceMetricsOverride');
  } finally {
    if (win.webContents.debugger.isAttached()) win.webContents.debugger.detach();
    win.__vispnoteViewportOverride = false;
  }
  await wait(80);
}

async function setRegressionWindowSize(win, width, height) {
  await clearRegressionViewportOverride(win);
  win.setSize(width, height);
  await wait(80);
  const viewport = await evaluate(win, `({ width: window.innerWidth, height: window.innerHeight })`);
  const resizeWasIgnored = Math.abs(viewport.width - width) > 24
    || Math.abs(viewport.height - height) > 64;
  if (resizeWasIgnored) {
    win.webContents.debugger.attach('1.3');
    try {
      await win.webContents.debugger.sendCommand('Emulation.setDeviceMetricsOverride', {
        width,
        height,
        deviceScaleFactor: 1,
        mobile: false,
        screenWidth: width,
        screenHeight: height,
      });
      win.__vispnoteViewportOverride = true;
    } catch (error) {
      if (win.webContents.debugger.isAttached()) win.webContents.debugger.detach();
      throw error;
    }
    await wait(80);
  }
  // Electron's programmatic resize can update innerWidth without delivering a
  // renderer resize event on some Windows runners. Dispatch the browser event
  // so this regression deterministically exercises the production listener.
  await evaluate(win, `window.dispatchEvent(new Event('resize'))`);
}

async function runViewportAccessibilityScenario(win) {
  const original = win.getBounds();
  try {
    await setRegressionWindowSize(win, 900, 700);
    await waitForLayoutMode(win, 'compact');
    const compactListOpen = await evaluate(win, `Boolean(document.querySelector('[data-mn-note-list-mode="overlay"]'))`);
    if (!compactListOpen) {
      await clickButton(win, { aria: 'Show note list' });
      await waitFor(win, 'compact note list opens for viewport checks', async () => {
        const overlay = await evaluate(win, `Boolean(document.querySelector('[data-mn-note-list-mode="overlay"]'))`);
        return { ok: overlay, overlay };
      });
    }
    await assertViewportUsable(win, 'minimum supported window');
    const compact = await evaluate(win, `
      (() => {
        const root = document.querySelector('[data-mn-layout]');
        const overlay = document.querySelector('[data-mn-note-list-mode="overlay"]');
        const headerButtons = [...document.querySelectorAll('[data-mn-editor-header="true"] button')]
          .map(button => button.getBoundingClientRect())
          .filter(rect => rect.width > 0 && rect.height > 0);
        return {
          mode: root?.getAttribute('data-mn-layout') || '',
          overlay: Boolean(overlay),
          targetsMeetMinimum: headerButtons.every(rect => rect.width >= 24 && rect.height >= 24),
        };
      })()
    `);
    if (compact.mode !== 'compact' || !compact.overlay || !compact.targetsMeetMinimum) {
      throw new Error(`Compact note-list layout is not usable: ${JSON.stringify(compact)}`);
    }
    await pressAccelerator(win, 'Escape');
    await waitFor(win, 'compact note list closes with Escape', async () => {
      const result = await evaluate(win, `({
        overlay: Boolean(document.querySelector('[data-mn-note-list-mode="overlay"]')),
        showButton: Boolean(document.querySelector('button[aria-label="Show note list"]')),
        activeLabel: document.activeElement?.getAttribute('aria-label') || '',
      })`);
      return { ok: !result.overlay && result.showButton && result.activeLabel === 'Show note list', result };
    });
    await setRegressionWindowSize(win, 1440, 900);
    await waitForLayoutMode(win, 'three-pane');
    await assertViewportUsable(win, 'desktop restored after compact selection');
    const restoredDesktopMode = await evaluate(win, `document.querySelector('[data-mn-layout]')?.getAttribute('data-mn-layout') || ''`);
    if (restoredDesktopMode !== 'three-pane') {
      throw new Error(`Desktop layout did not restore after closing the compact drawer: ${restoredDesktopMode}`);
    }
    await setRegressionWindowSize(win, 900, 700);
    await waitFor(win, 'compact editor remains focused after resize round trip', async () => {
      const result = await evaluate(win, `({
        mode: document.querySelector('[data-mn-layout]')?.getAttribute('data-mn-layout') || '',
        overlay: Boolean(document.querySelector('[data-mn-note-list-mode="overlay"]')),
        showButton: Boolean(document.querySelector('button[aria-label="Show note list"]')),
      })`);
      return { ok: result.mode === 'compact' && !result.overlay && result.showButton, result };
    });
    await clickButton(win, { aria: 'Show note list' });
    await waitFor(win, 'compact note list reopens from editor navigation', async () => {
      const overlay = await evaluate(win, `Boolean(document.querySelector('[data-mn-note-list-mode="overlay"]'))`);
      return { ok: overlay, overlay };
    });

    await clickVisibleText(win, 'Graph');
    await waitFor(win, 'compact graph keeps its note list drawer', async () => {
      const result = await evaluate(win, `({
        graph: document.body.textContent.includes('Graph'),
        overlay: Boolean(document.querySelector('[data-mn-note-list-mode="overlay"]')),
      })`);
      return { ok: result.graph && result.overlay, result };
    });
    await clickButton(win, { titleIncludes: 'Hide note list' });
    await waitFor(win, 'compact graph exposes an external note list opener', async () => {
      const result = await evaluate(win, `({
        overlay: Boolean(document.querySelector('[data-mn-note-list-mode="overlay"]')),
        showButton: Boolean(document.querySelector('button[title="Show note list"]')),
        editorHeader: Boolean(document.querySelector('[data-mn-editor-header="true"]')),
      })`);
      return { ok: !result.overlay && result.showButton && !result.editorHeader, result };
    });
    await clickButton(win, { titleIncludes: 'Show note list' });
    await waitFor(win, 'compact graph note list reopens', async () => {
      const overlay = await evaluate(win, `Boolean(document.querySelector('[data-mn-note-list-mode="overlay"]'))`);
      return { ok: overlay, overlay };
    });
    // The overlay can appear a frame before its rows do — wait for a row
    // instead of clicking into the gap and calling it a failure.
    // Wait for a row rather than clicking into the render gap. The overlay
    // text rides along so a failure says what the list was showing — this is
    // how a stale-search-results bug was diagnosed rather than retried away.
    await waitFor(win, 'compact graph note list has a note', async () => {
      const current = await evaluate(win, `(() => {
        const overlay = document.querySelector('[data-mn-note-list-mode="overlay"]');
        return {
          present: Boolean(overlay?.querySelector('[role="option"]')),
          text: overlay ? overlay.textContent.slice(0, 120) : '(no overlay)',
        };
      })()`);
      return { ok: current.present, current };
    });
    const openedGraphNote = await evaluate(win, `
      (() => {
        const option = document.querySelector('[data-mn-note-list-mode="overlay"] [role="option"]');
        option?.click();
        return Boolean(option);
      })()
    `);
    if (!openedGraphNote) throw new Error('Compact graph note list did not contain a note to open');
    await waitFor(win, 'compact graph note selection returns to the editor', async () => {
      const result = await evaluate(win, `({
        editor: Boolean(document.querySelector('.mn-note-title-input')),
        overlay: Boolean(document.querySelector('[data-mn-note-list-mode="overlay"]')),
      })`);
      return { ok: result.editor && !result.overlay, result };
    });

    await setAssistanceEnabledForRegression(win, true);
    await waitFor(win, 'compact Ask AI navigation ready', async () => {
      const visible = await evaluate(win, `
        (() => {
          const row = document.querySelector('[role="button"][aria-label="Ask AI"]');
          if (!row) return false;
          const style = getComputedStyle(row);
          const rect = row.getBoundingClientRect();
          return style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && rect.height > 0;
        })()
      `);
      return { ok: visible, visible };
    });
    await clickVisibleText(win, 'Ask AI');
    await waitFor(win, 'compact Ask AI exposes its hidden chat history', async () => {
      const result = await evaluate(win, `({
        askAi: document.body.textContent.includes('Ask AI'),
        overlay: Boolean(document.querySelector('[data-mn-note-list-mode="overlay"]')),
        showButton: Boolean(document.querySelector('button[title="Show AI chats"]')),
      })`);
      return { ok: result.askAi && !result.overlay && result.showButton, result };
    });
    await clickButton(win, { titleIncludes: 'Show AI chats' });
    await waitFor(win, 'compact Ask AI chat history opens', async () => {
      const overlay = await evaluate(win, `Boolean(document.querySelector('[data-mn-note-list-mode="overlay"]'))`);
      return { ok: overlay, overlay };
    });
    await clickButton(win, { titleIncludes: 'Hide note list' });
    await waitFor(win, 'compact Ask AI exposes a chat history opener', async () => {
      const result = await evaluate(win, `({
        overlay: Boolean(document.querySelector('[data-mn-note-list-mode="overlay"]')),
        showButton: Boolean(document.querySelector('button[title="Show AI chats"]')),
      })`);
      return { ok: !result.overlay && result.showButton, result };
    });
    await clickButton(win, { titleIncludes: 'Show AI chats' });
    await waitFor(win, 'compact Ask AI chat history reopens', async () => {
      const overlay = await evaluate(win, `Boolean(document.querySelector('[data-mn-note-list-mode="overlay"]'))`);
      return { ok: overlay, overlay };
    });
    await clickVisibleText(win, 'All notes');
    await waitFor(win, 'compact Ask AI returns to notes', async () => {
      const editor = await evaluate(win, `Boolean(document.querySelector('.mn-note-title-input'))`);
      return { ok: editor, editor };
    });
    await setAssistanceEnabledForRegression(win, false);

    await clickButton(win, { titleIncludes: 'Open settings' });
    await waitFor(win, 'settings open at minimum supported window', async () => {
      const current = await state(win);
      return { ok: current.settingsOpen && current.buttons.some(btn => btn.aria === 'Close settings'), current };
    });
    await pressAccelerator(win, 'Escape');
    await waitFor(win, 'settings closes with Escape at minimum supported window', async () => {
      const current = await state(win);
      return { ok: !current.settingsOpen, current };
    });

    await setRegressionWindowSize(win, 1280, 860);
    await waitForLayoutMode(win, 'three-pane');
    await assertViewportUsable(win, 'desktop window');
    const desktop = await evaluate(win, `
      (() => ({
        mode: document.querySelector('[data-mn-layout]')?.getAttribute('data-mn-layout') || '',
        overlay: Boolean(document.querySelector('[data-mn-note-list-mode="overlay"]')),
      }))()
    `);
    if (desktop.mode !== 'three-pane' || desktop.overlay) {
      throw new Error(`Desktop three-pane layout is not active: ${JSON.stringify(desktop)}`);
    }

    await clickButton(win, { titleIncludes: 'Hide note list' });
    await waitFor(win, 'desktop note-list preference is hidden', async () => {
      const result = await evaluate(win, `({
        list: Boolean(document.querySelector('button[title="Hide note list"]')),
        showButton: Boolean(document.querySelector('button[title="Show note list"]')),
      })`);
      return { ok: !result.list && result.showButton, result };
    });
    await setRegressionWindowSize(win, 900, 700);
    await waitForLayoutMode(win, 'compact');
    if (await evaluate(win, `Boolean(document.querySelector('[data-mn-note-list-mode="overlay"]'))`)) {
      await pressAccelerator(win, 'Escape');
    }
    await waitFor(win, 'compact note-list drawer is closed over a hidden desktop preference', async () => {
      const result = await evaluate(win, `({
        overlay: Boolean(document.querySelector('[data-mn-note-list-mode="overlay"]')),
        showButton: Boolean(document.querySelector('button[aria-label="Show note list"]')),
      })`);
      return { ok: !result.overlay && result.showButton, result };
    });
    await pressAccelerator(win, '\\', ['control', 'shift']);
    await waitFor(win, 'compact note-list shortcut opens without changing desktop preference', async () => {
      const overlay = await evaluate(win, `Boolean(document.querySelector('[data-mn-note-list-mode="overlay"]'))`);
      return { ok: overlay, overlay };
    });
    await setRegressionWindowSize(win, 1280, 860);
    await waitFor(win, 'desktop note-list preference remains hidden after compact use', async () => {
      const result = await evaluate(win, `({
        mode: document.querySelector('[data-mn-layout]')?.getAttribute('data-mn-layout') || '',
        list: Boolean(document.querySelector('button[title="Hide note list"]')),
        showButton: Boolean(document.querySelector('button[title="Show note list"]')),
      })`);
      return { ok: result.mode === 'three-pane' && !result.list && result.showButton, result };
    });
    await clickButton(win, { titleIncludes: 'Show note list' });
    await waitFor(win, 'desktop note list is restored for later scenarios', async () => {
      const list = await evaluate(win, `Boolean(document.querySelector('button[title="Hide note list"]'))`);
      return { ok: list, list };
    });
  } finally {
    await clearRegressionViewportOverride(win);
    win.setBounds(original);
    await wait(80);
    await evaluate(win, `window.dispatchEvent(new Event('resize'))`);
    await wait(120);
  }
}

async function runPrivateValueCounterScenario(win) {
  await waitFor(win, 'privacy-safe core value counters persist', async () => {
    const result = await evaluate(win, `
      (async () => {
        const response = await window.mn.integrations.featureUsage.status();
        const value = response?.value || response?.data || {};
        return value.report || {};
      })()
    `);
    const counters = result.counters || {};
    const serialized = JSON.stringify(result);
    return {
      ok: counters.first_note?.created === 1
        && counters.capture?.completed >= 2
        && counters.search?.result_opened >= 1
        && counters.today?.completed >= 1
        && !serialized.includes('QE User Scenario')
        && !serialized.includes('quick capture todo'),
      counters,
    };
  });
}

async function runThemeAccessibilityScenario(win) {
  const originalBounds = win.getBounds();
  try {
    await setRegressionWindowSize(win, 1440, 900);
    await waitForLayoutMode(win, 'three-pane');
    await clickButton(win, { titleIncludes: 'Open settings' });
    await waitFor(win, 'theme settings are available', async () => {
      const result = await evaluate(win, `
        (() => {
          const select = [...document.querySelectorAll('select')]
            .find(element => [...element.options].some(option => option.value === 'light')
              && [...element.options].some(option => option.value === 'dark'));
          return { found: Boolean(select), value: select?.value || '' };
        })()
      `);
      return { ok: result.found, result };
    });
    const surfaces = {};
    for (const themeId of ['dark', 'light']) {
      await evaluate(win, `
        (() => {
          const select = [...document.querySelectorAll('select')]
            .find(element => [...element.options].some(option => option.value === 'light')
              && [...element.options].some(option => option.value === 'dark'));
          if (!select) return false;
          select.value = ${JSON.stringify(themeId)};
          select.dispatchEvent(new Event('change', { bubbles: true }));
          return true;
        })()
      `);
      await waitFor(win, `${themeId} theme applies`, async () => {
        const result = await evaluate(win, `
          (() => {
            const select = [...document.querySelectorAll('select')]
              .find(element => [...element.options].some(option => option.value === 'light')
                && [...element.options].some(option => option.value === 'dark'));
            const dialog = document.querySelector('[role="dialog"][aria-labelledby="mn-settings-title"]');
            return { value: select?.value || '', background: dialog?.style.background || '' };
          })()
        `);
        return { ok: result.value === themeId && Boolean(result.background), result };
      });
      surfaces[themeId] = await evaluate(win, `document.querySelector('[role="dialog"][aria-labelledby="mn-settings-title"]')?.style.background || ''`);
      await assertViewportUsable(win, `${themeId} theme at 1440px`);
    }
    if (!surfaces.dark || !surfaces.light || surfaces.dark === surfaces.light) {
      throw new Error(`Light and dark theme surfaces did not remain distinct: ${JSON.stringify(surfaces)}`);
    }
    await clickButton(win, { aria: 'Close settings' });
  } finally {
    await clearRegressionViewportOverride(win);
    win.setBounds(originalBounds);
    await evaluate(win, `window.dispatchEvent(new Event('resize'))`);
    await wait(80);
  }
}

async function runDeleteRestoreScenario(win) {
  const title = 'QE User Scenario Note';
  await clickVisibleText(win, 'All notes');
  await setControlByPlaceholder(win, 'Filter this list', title);
  await waitFor(win, 'delete target visible in note search', async () => {
    const current = await state(win);
    return { ok: current.text.includes(title), current };
  });
  await clickVisibleText(win, title);
  await waitFor(win, 'delete target selected', async () => {
    const current = await state(win);
    return { ok: current.selectedTitle === title, current };
  });
  await openEditorMoreMenu(win);
  await clickButton(win, { aria: 'Delete note' });
  await waitFor(win, 'delete note dialog explains recoverability', async () => {
    const current = await state(win);
    return { ok: current.dialogs.some(text => text.includes('Delete note') && text.includes('Recently deleted')), current };
  });
  await clickButton(win, { text: 'Move to trash' });
  await waitForDeletedNote(win, title);
  await setSidebarMoreExpanded(win, true);
  await clickVisibleText(win, 'Recently deleted');
  await waitFor(win, 'recently deleted view shows deleted note', async () => {
    const current = await state(win);
    return { ok: current.text.includes('Recently deleted') && current.text.includes(title), current };
  });
  await clickVisibleText(win, 'Restore');
  await waitFor(win, 'restored note reopens in notes view', async () => {
    const current = await state(win);
    return { ok: current.selectedTitle === title, current };
  });
  await waitForPersistedNote(win, title, note => String(note.body || '').includes('create, edit, and persist'));
}

async function runGeneralAttachmentScenario(win) {
  await seedEditorNote(win, {
    id: 'qe_general_attachment',
    title: 'QE General Attachment',
    body: 'Parent',
  });
  await focusEditorRow(win, 0);
  const dispatched = await evaluate(win, `
    (() => {
      const row = document.querySelector('.mn-block-row[data-block-id]');
      if (!row || typeof DataTransfer !== 'function' || typeof File !== 'function') return false;
      const transfer = new DataTransfer();
      transfer.items.add(new File(
        [new Uint8Array([37, 80, 68, 70, 45, 49, 46, 52])],
        'QE Project Brief.pdf',
        { type: 'application/pdf' }
      ));
      row.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: transfer }));
      row.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }));
      return true;
    })()
  `);
  if (!dispatched) throw new Error('Could not dispatch a general attachment drop');
  await waitForEditorLayout(win, 'general attachment markdown inserted', rows => (
    rows[0]?.editing
      && rows[0]?.value.includes('[QE Project Brief.pdf](attachments/QE-Project-Brief-')
      && rows[0]?.value.endsWith('.pdf)')
  ));
  await waitForPersistedNote(win, 'QE General Attachment', note => (
    String(note.body || '').includes('[QE Project Brief.pdf](attachments/QE-Project-Brief-')
  ));
  // The renderer persists which note is selected into .meta.json on a
  // debounced timer, and the reload below kills that timer with the write
  // still pending. Reloading before it lands boots the app back on whatever
  // note the meta last flushed — so the reload waits for the meta, not luck.
  await waitFor(win, 'general attachment selection persists to vault meta', async () => {
    const vault = await loadActiveVault(win);
    return { ok: vault.lastSelectedId === 'qe_general_attachment', lastSelectedId: vault.lastSelectedId };
  });
  win.webContents.reload();
  await waitFor(win, 'general attachment note reloads in display mode', async () => {
    const current = await state(win);
    const rows = await editorRows(win);
    return {
      ok: current.selectedTitle === 'QE General Attachment'
        && rows[0]?.text.includes('QE Project Brief.pdf')
        && !rows[0]?.editing,
      current,
      rows,
    };
  });
  await waitFor(win, 'general attachment renders as a described chip', async () => {
    const chip = await evaluate(win, `
      (() => {
        const el = document.querySelector('[data-mn-attachment-chip="true"]');
        const button = el?.querySelector('button');
        return {
          text: el?.textContent || '',
          aria: button?.getAttribute('aria-label') || '',
          disabled: Boolean(button?.disabled),
        };
      })()
    `);
    return {
      ok: chip.text.includes('QE Project Brief.pdf')
        && chip.text.includes('PDF')
        && chip.text.includes('8 B')
        && chip.aria === 'Open attachment QE Project Brief.pdf'
        && !chip.disabled,
      chip,
    };
  });
  if (process.env.VISPNOTE_ATTACHMENT_SCREENSHOT) {
    const bounds = await evaluate(win, `
      (() => {
        const rect = document.querySelector('[data-mn-attachment-chip="true"]')?.getBoundingClientRect();
        if (!rect) return null;
        return {
          x: 0,
          y: Math.max(0, Math.floor(rect.top - 12)),
          width: Math.max(1, Math.ceil(rect.right + 12)),
          height: Math.max(1, Math.ceil(rect.height + 24)),
        };
      })()
    `);
    if (!bounds) throw new Error('Could not locate attachment chip for screenshot');
    const screenshotPath = path.resolve(process.env.VISPNOTE_ATTACHMENT_SCREENSHOT);
    fs.mkdirSync(path.dirname(screenshotPath), { recursive: true });
    win.webContents.debugger.attach('1.3');
    try {
      const capture = await win.webContents.debugger.sendCommand('Page.captureScreenshot', {
        format: 'png',
        fromSurface: true,
        clip: { ...bounds, scale: 1 },
      });
      fs.writeFileSync(screenshotPath, Buffer.from(capture.data, 'base64'));
    } finally {
      if (win.webContents.debugger.isAttached()) win.webContents.debugger.detach();
    }
  }
  const storedFiles = fs.readdirSync(regressionHome, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && !entry.name.startsWith('.'))
    .flatMap(entry => {
      try { return fs.readdirSync(path.join(regressionHome, entry.name, 'attachments')); }
      catch { return []; }
    });
  if (!storedFiles.some(name => /^QE-Project-Brief-\d{14}\.pdf$/.test(name))) {
    throw new Error(`General attachment was not stored in the vault: ${JSON.stringify(storedFiles)}`);
  }
}

async function runRegression() {
  const win = await waitForMainWindow();
  win.webContents.on('console-message', (_event, detailsOrLevel, legacyMessage, legacyLine, legacySourceId) => {
    const details = detailsOrLevel && typeof detailsOrLevel === 'object'
      ? detailsOrLevel
      : { level: detailsOrLevel, message: legacyMessage, lineNumber: legacyLine, sourceId: legacySourceId };
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

  await runScenario(win, 'Focus', 'fresh vault exposes the requested core navigation', async () => {
    await setSidebarMoreExpanded(win, false);
    await waitFor(win, 'default sidebar order and collapsed destinations', async () => {
      const current = await evaluate(win, `(() => {
        const labels = [...document.querySelectorAll('[data-mn-sidebar-primary] [role="button"]')]
          .map(row => (row.getAttribute('aria-label') || '').split(',')[0]);
        const sidebarText = document.querySelector('[data-mn-sidebar="true"]')?.textContent || '';
        const moreToggle = [...document.querySelectorAll('button')]
          .find(button => (button.textContent || '').trim() === 'More');
        return {
          labels,
          sidebarText,
          moreExpanded: moreToggle?.getAttribute('aria-expanded') === 'true',
          moreList: Boolean(document.querySelector('[data-mn-sidebar-more]')),
        };
      })()`);
      return {
        ok: JSON.stringify(current.labels) === JSON.stringify(['All notes', 'Pinned', 'Views'])
          && current.sidebarText.includes('Tags')
          && !current.sidebarText.includes('Today')
          && !current.sidebarText.includes('Smart Views')
          && !current.sidebarText.includes('Thinking Board')
          && !current.sidebarText.includes('Ask AI')
          && !current.sidebarText.includes('Workflow')
          && !current.sidebarText.includes('Graph')
          && !current.sidebarText.includes('Agenda')
          && !current.moreExpanded
          && !current.moreList,
        current,
      };
    });
    const controls = await evaluate(win, `
      [...document.querySelectorAll('button')]
        .map(button => button.getAttribute('title') || button.getAttribute('aria-label') || '')
        .filter(Boolean)
    `);
    for (const specialistControl of ['AI actions for this section', 'Graph', 'Agenda']) {
      if (controls.some(label => label.includes(specialistControl))) {
        throw new Error(`default surface exposed ${specialistControl}`);
      }
    }
    const ids = await availableCommandIds(win);
    if (!ids.includes('views')) throw new Error(`default command surface omitted views: ${JSON.stringify(ids)}`);
    for (const commandId of [
      'graph', 'smart-views', 'calendar', 'set-workflow-status', 'canvas',
      'create-canvas', 'template-reading', 'template-novel-scene', 'memory-import', 'ask-ai',
    ]) {
      if (ids.includes(commandId)) throw new Error(`default command surface exposed ${commandId}`);
    }

    await setAssistanceEnabledForRegression(win, true);
    await waitFor(win, 'Ask AI joins the primary destinations in order', async () => {
      const labels = await evaluate(win, `
        [...document.querySelectorAll('[data-mn-sidebar-primary] [role="button"]')]
          .map(row => (row.getAttribute('aria-label') || '').split(',')[0])
      `);
      return {
        ok: JSON.stringify(labels) === JSON.stringify(['All notes', 'Pinned', 'Views', 'Ask AI']),
        labels,
      };
    });
    await setAssistanceEnabledForRegression(win, false);
  });

  await runScenario(win, 'Navigation', 'sidebar More expands above its control', async () => {
    await runSidebarMoreDisclosureScenario(win);
  });

  await runScenario(win, 'Navigation', 'optional More destinations follow visibility toggles', async () => {
    await runSidebarDestinationVisibilityScenario(win);
  });

  await runScenario(win, 'Today', 'fresh vault shows only calm capture actions', async () => {
    await runEmptyTodayScenario(win);
  });

  await runScenario(win, 'First run', 'creates a useful note with optional contextual guidance', async () => {
    await runFirstRunGuidanceScenario(win);
  });

  await runScenario(win, 'Focus', 'each optional pack stays isolated when enabled alone', async () => {
    await runPackIsolationScenario(win);
  });
  await runScenario(win, 'Views', 'the views pack adds one saved-view surface', async () => {
    await runViewsPanelScenario(win);
  });

  await runScenario(win, 'Editor', 'blank notes prioritize writing and disclose secondary actions', async () => {
    await runEditorUsabilityScenario(win);
  });
  await runScenario(win, 'Value', 'local status and contextual assistance stay transparent and preview-first', async () => {
    await runValueHardeningSurfaceScenario(win);
  });

  await runScenario(win, 'Notes', 'create, edit, and persist a note', async () => {
    await runNoteCreateEditPersistenceScenario(win);
  });
  await runScenario(win, 'Attachments', 'drops a PDF into the vault and renders a safe file chip', async () => {
    await runGeneralAttachmentScenario(win);
  });
  await runScenario(win, 'Reference', 'keeps a read-only note beside the editor and restores the note list', async () => {
    const mainTitle = (await state(win)).selectedTitle;
    await openEditorMoreMenu(win);
    await clickButton(win, { aria: 'Open reference pane' });
    await waitFor(win, 'reference pane open', async () => {
      const current = await evaluate(win, `
        (() => {
          const pane = document.querySelector('aside[aria-label="Reference note"]');
          const select = pane?.querySelector('select[aria-label="Reference note"]');
          return {
            ok: Boolean(pane && select && select.options.length >= 2),
            title: document.querySelector('.mn-note-title-input')?.value || '',
            noteListVisible: Boolean(document.querySelector('input[aria-label="Search note contents"]')),
            text: pane?.textContent || '',
          };
        })()
      `);
      return { ok: current.ok && current.title === mainTitle && !current.noteListVisible && current.text.includes('read only'), current };
    });
    const changed = await evaluate(win, `
      (() => {
        const select = document.querySelector('aside[aria-label="Reference note"] select');
        if (!select || select.options.length < 2) return false;
        const next = [...select.options].find(option => option.value !== select.value);
        if (!next) return false;
        select.value = next.value;
        select.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      })()
    `);
    if (!changed) throw new Error('Could not choose a second reference note');
    await pressAccelerator(win, 'R', ['control', 'shift']);
    await waitFor(win, 'reference pane close', async () => {
      const current = await evaluate(win, `
        (() => ({
          paneOpen: Boolean(document.querySelector('aside[aria-label="Reference note"]')),
          noteListVisible: Boolean(document.querySelector('input[aria-label="Search note contents"]')),
          title: document.querySelector('.mn-note-title-input')?.value || '',
        }))()
      `);
      return { ok: !current.paneOpen && current.noteListVisible && current.title === mainTitle, current };
    });
  });
  await runScenario(win, 'Capture', 'quick capture saves a task note and closes cleanly', async () => {
    await runQuickCaptureSaveScenario(win);
  });
  await runScenario(win, 'Search', 'note search finds expected content and Escape clears it', async () => {
    await runSearchAndClearScenario(win);
  });
  await runScenario(win, 'Navigation', 'sidebar opens agenda planner and graph panels', async () => {
    await setPackEnabledForRegression(win, 'planning', true);
    await setPackEnabledForRegression(win, 'labs', true);
    await runNavigationPanelsScenario(win);
  });
  await runScenario(win, 'Agenda', 'agenda creates dated reminders and todos', async () => {
    await runCalendarPlannerScenario(win);
  });
  await runScenario(win, 'Today', 'populated vault surfaces current work without duplicate daily actions', async () => {
    await runPopulatedTodayScenario(win);
  });
  await runScenario(win, 'Privacy', 'core value counters remain aggregate-only', async () => {
    await runPrivateValueCounterScenario(win);
  });
  await runScenario(win, 'Canvas', 'create, draw, move, undo, and redo a canvas object', async () => {
    await setPackEnabledForRegression(win, 'canvas', true);
    await runCanvasCreateScenario(win);
  });
  await runScenario(win, 'Trash', 'delete explains recoverability and restore returns the note', async () => {
    await runDeleteRestoreScenario(win);
  });
  await runScenario(win, 'Settings', 'settings opens with clear context and closes', async () => {
    await clickButton(win, { titleIncludes: 'Open settings' });
    await waitFor(win, 'settings open', async () => {
      const current = await state(win);
      return {
        ok: current.settingsOpen && current.buttons.some(btn => String(btn.text || '').includes('General')),
        current,
      };
    });
    await clickVisibleText(win, 'Data & Privacy');
    await waitFor(win, 'Markdown import offers file and folder previews', async () => {
      const current = await state(win);
      return {
        ok: current.buttons.some(button => button.text === 'Choose files')
          && current.buttons.some(button => button.text === 'Choose folder'),
        current,
      };
    });
    const sourceBeforePreview = fs.readFileSync(path.join(markdownImportFixture, 'QE User Scenario Note.md'), 'utf8');
    await clickButton(win, { text: 'Choose folder' });
    await waitFor(win, 'Markdown import previews collisions, attachments, and warnings', async () => {
      const previewState = await evaluate(win, `({
        text: document.querySelector('section[aria-labelledby="mn-markdown-import-title"]')?.textContent || '',
        active: document.activeElement?.textContent || '',
      })`);
      return {
        ok: previewState.text.includes('2 notes')
          && previewState.text.includes('1 safe attachment')
          && previewState.text.includes('Renamed')
          && previewState.text.includes('warning')
          && previewState.active.trim() === 'Cancel',
        previewState,
      };
    });
    await pressAccelerator(win, 'Escape');
    await waitFor(win, 'canceling Markdown import returns to settings without writes', async () => {
      const current = await state(win);
      return {
        ok: !current.dialogs.some(text => text.includes('Preview Markdown import'))
          && current.buttons.some(button => button.aria === 'Close settings')
          && fs.readFileSync(path.join(markdownImportFixture, 'QE User Scenario Note.md'), 'utf8') === sourceBeforePreview,
        current,
      };
    });
    await clickButton(win, { aria: 'Close settings' });
    await waitFor(win, 'settings close', async () => {
      const current = await state(win);
      return { ok: !current.settingsOpen, current };
    });
  });
  await runScenario(win, 'Layout', 'minimum and desktop windows keep core controls usable', async () => {
    await runViewportAccessibilityScenario(win);
  });
  await runScenario(win, 'Theme', 'light and dark settings stay usable at 1440 pixels', async () => {
    await runThemeAccessibilityScenario(win);
  });
  await runScenario(win, 'Palette', 'shares Notes and Actions across mixed and notes-first modes', async () => {
    await runUnifiedPaletteScenario(win);
  });

  await runScenario(win, 'Editor', 'empty paragraph Enter-Tab-Enter returns to parent level', async () => {
    await runEmptyNestedEnterScenario(win, {
      id: 'qe_editor_paragraph_enter_outdent',
      title: 'QE Editor Paragraph Outdent',
      body: 'Parent',
      expectedKind: 'paragraph',
    });
  });
  await runScenario(win, 'Editor', 'empty bullet Enter-Tab-Enter returns to parent level', async () => {
    await runEmptyNestedEnterScenario(win, {
      id: 'qe_editor_bullet_enter_outdent',
      title: 'QE Editor Bullet Outdent',
      body: '- Parent',
      expectedKind: 'bullet',
    });
  });
  await runScenario(win, 'Editor', 'Shift+Tab returns an empty nested paragraph to parent level', async () => {
    await runShiftTabOutdentScenario(win);
  });
  await runScenario(win, 'Editor', 'markdown starters convert while typing and inline markdown stays portable', async () => {
    await runMarkdownTypingScenario(win);
  });
  await runScenario(win, 'Editor', 'existing markdown tables, code, and app syntax stay compatible', async () => {
    await runMarkdownCompatibilityScenario(win);
  });
  await runScenario(win, 'Editor', 'literal markers and slash commands remain predictable after markdown rules', async () => {
    await runMarkdownPredictabilityScenario(win);
  });
  await runScenario(win, 'Editor', 'large scrolled block ranges delete completely and undo once', async () => {
    await runLargeBlockSelectionDeleteScenario(win);
  });

  const finalState = await state(win);
  if (finalState.launchError) throw new Error(`Launch error screen appeared: ${finalState.text}`);
  console.log('Renderer regression workflows passed');
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
  if (!process.env.VISPNOTE_KEEP_REGRESSION_HOME && ownsRegressionHome) {
    try { require('../lib/index').close(); } catch {}
    scheduleTempCleanupAfterExit(regressionHome);
  }
  app.exit(code);
}

app.whenReady().then(async () => {
  try {
    await runRegression();
    await cleanupAndExit(0);
  } catch (error) {
    console.error(error);
    await cleanupAndExit(1);
  }
});
