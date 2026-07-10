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
        quickCaptureOpen: bodyText.includes('Quick capture') && buttons.some(btn => btn.text.startsWith('Save')),
        settingsOpen: dialogs.some(text => text.includes('Settings')) || bodyText.includes('General · A calm default experience'),
        commandPaletteOpen: dialogs.some(text => text.includes('Command palette')) || Boolean(document.querySelector('input[placeholder="Run a command or open a note..."]')),
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
  await setControlByPlaceholder(win, 'Run a command or open a note...', query);
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

async function activeVaultId(win) {
  return await evaluate(win, `
    (async () => {
      const unwrap = (result, label) => {
        if (!result?.ok) throw new Error(label + ': ' + (result?.error || 'failed'));
        return result.value;
      };
      const vaults = unwrap(await window.mn.listVaults(), 'listVaults');
      const prefs = unwrap(await window.mn.getPrefs(), 'getPrefs');
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
      const res = await window.mn.loadVault(${JSON.stringify(vaultId)});
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
        const result = await window.mn.listDeletedNotes(${JSON.stringify(vaultId)});
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
        const result = await window.mn.listCanvases(${JSON.stringify(vaultId)});
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
      const listResult = await window.mn.listCanvases(${JSON.stringify(vaultId)});
      if (!listResult?.ok) throw new Error(listResult?.error || 'listCanvases failed');
      const canvas = (listResult.value || []).find(row => row.title === ${JSON.stringify(title)});
      if (!canvas) return null;
      const getResult = await window.mn.getCanvas(${JSON.stringify(vaultId)}, canvas.id);
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
        hasQuickCapture: buttons.some(btn => String(btn.title || '').includes('Quick capture')),
        hasSettings: buttons.some(btn => String(btn.title || '').includes('Settings')),
        hasSearch: [...document.querySelectorAll('input')].filter(visible).some(el => (el.getAttribute('placeholder') || '').includes('Search notes')),
      };
    })()
  `);
  if (metrics.horizontalOverflow || !metrics.hasNewNote || !metrics.hasQuickCapture || !metrics.hasSettings || !metrics.hasSearch) {
    throw new Error(`Viewport ${label} is not usable: ${JSON.stringify(metrics)}`);
  }
  return metrics;
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

async function seedEditorNote(win, { id, title, body }) {
  await evaluate(win, `
    (async () => {
      const unwrap = (result, label) => {
        if (!result?.ok) throw new Error(label + ': ' + (result?.error || 'failed'));
        return result.value;
      };
      const vaults = unwrap(await window.mn.listVaults(), 'listVaults');
      const prefs = unwrap(await window.mn.getPrefs(), 'getPrefs');
      const active = vaults.find(v => v.id === prefs.activeVaultId) || vaults[0];
      if (!active) throw new Error('No vault available for editor regression');
      const now = new Date().toISOString();
      unwrap(await window.mn.saveNote(active.id, {
        id: ${JSON.stringify(id)},
        title: ${JSON.stringify(title)},
        body: ${JSON.stringify(body)},
        tags: ['qe-regression'],
        date: now,
        modifiedAt: now,
      }, {}), 'saveNote');
      unwrap(await window.mn.saveVaultMeta(active.id, {
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
        && rows[0].text.includes('Parent'),
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
  const title = 'QE Quick Capture Task';
  const body = '- [ ] QE quick capture todo';
  await clickButton(win, { titleIncludes: 'Quick capture' });
  await waitFor(win, 'quick capture open for save scenario', async () => {
    const current = await state(win);
    return { ok: current.quickCaptureOpen, current };
  });
  await setControlByPlaceholder(win, 'Title', title);
  await setControlByPlaceholder(win, 'Write a note', body);
  await clickButton(win, { text: 'Save to Today' });
  await waitFor(win, 'quick capture saved and closed', async () => {
    const current = await state(win);
    return { ok: !current.quickCaptureOpen, current };
  });
  await waitForPersistedBody(win, 'QE quick capture todo');
}

async function runSearchAndClearScenario(win) {
  const title = 'QE User Scenario Note';
  await clickVisibleText(win, 'All notes');
  await waitFor(win, 'all notes view before search', async () => {
    const current = await state(win);
    return { ok: current.text.includes('All notes'), current };
  });
  await setControlByPlaceholder(win, 'Search notes', 'QE User Scenario');
  await waitFor(win, 'search filters to user scenario note', async () => {
    const current = await state(win);
    return { ok: current.text.includes('Search') && current.text.includes(title), current };
  });
  await pressAccelerator(win, 'Escape');
  await waitFor(win, 'search clears with Escape', async () => {
    const value = await evaluate(win, `document.querySelector('input[placeholder="Search notes…"]')?.value || ''`);
    return { ok: value === '', value };
  });
}

async function runNavigationPanelsScenario(win) {
  await runCommandPaletteCommand(win, 'open agenda', 'Open Agenda');
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
  await clickButton(win, { titleIncludes: 'Agenda' });
  await waitFor(win, 'agenda panel opens from editor toolbar', async () => {
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
    return { ok: current.text.includes('Canvas') && current.text.includes('canvas'), current };
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

async function runViewportAccessibilityScenario(win) {
  const original = win.getBounds();
  try {
    win.setSize(900, 700);
    await wait(250);
    await assertViewportUsable(win, 'minimum supported window');
    await clickButton(win, { titleIncludes: 'Settings' });
    await waitFor(win, 'settings open at minimum supported window', async () => {
      const current = await state(win);
      return { ok: current.settingsOpen && current.buttons.some(btn => btn.aria === 'Close settings'), current };
    });
    await pressAccelerator(win, 'Escape');
    await waitFor(win, 'settings closes with Escape at minimum supported window', async () => {
      const current = await state(win);
      return { ok: !current.settingsOpen, current };
    });

    win.setSize(1280, 860);
    await wait(250);
    await assertViewportUsable(win, 'desktop window');
  } finally {
    win.setBounds(original);
    await wait(200);
  }
}

async function runDeleteRestoreScenario(win) {
  const title = 'QE User Scenario Note';
  await clickVisibleText(win, 'All notes');
  await setControlByPlaceholder(win, 'Search notes', title);
  await waitFor(win, 'delete target visible in note search', async () => {
    const current = await state(win);
    return { ok: current.text.includes(title), current };
  });
  await clickVisibleText(win, title);
  await waitFor(win, 'delete target selected', async () => {
    const current = await state(win);
    return { ok: current.selectedTitle === title, current };
  });
  await clickButton(win, { titleIncludes: 'Delete' });
  await waitFor(win, 'delete note dialog explains recoverability', async () => {
    const current = await state(win);
    return { ok: current.dialogs.some(text => text.includes('Delete note') && text.includes('Recently deleted')), current };
  });
  await clickButton(win, { text: 'Move to trash' });
  await waitForDeletedNote(win, title);
  await clickButton(win, { text: 'More' });
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

  await runScenario(win, 'Focus', 'fresh vault exposes only the core navigation', async () => {
    await waitFor(win, 'minimal default navigation', async () => {
      const current = await state(win);
      const text = current.text;
      return {
        ok: text.includes('All notes') && text.includes('Today') && text.includes('Pinned') && text.includes('Tags')
          && !text.includes('Smart Views') && !text.includes('Thinking Board') && !text.includes('Ask AI') && !text.includes('Workflow'),
        current,
      };
    });
  });

  await runScenario(win, 'Notes', 'create, edit, and persist a note', async () => {
    await runNoteCreateEditPersistenceScenario(win);
  });
  await runScenario(win, 'Capture', 'quick capture saves a task note and closes cleanly', async () => {
    await runQuickCaptureSaveScenario(win);
  });
  await runScenario(win, 'Search', 'note search finds expected content and Escape clears it', async () => {
    await runSearchAndClearScenario(win);
  });
  await runScenario(win, 'Navigation', 'sidebar opens agenda planner and graph panels', async () => {
    await runNavigationPanelsScenario(win);
  });
  await runScenario(win, 'Agenda', 'agenda creates dated reminders and todos', async () => {
    await runCalendarPlannerScenario(win);
  });
  await runScenario(win, 'Canvas', 'create, draw, move, undo, and redo a canvas object', async () => {
    await runCanvasCreateScenario(win);
  });
  await runScenario(win, 'Trash', 'delete explains recoverability and restore returns the note', async () => {
    await runDeleteRestoreScenario(win);
  });
  await runScenario(win, 'Settings', 'settings opens with clear context and closes', async () => {
    await clickButton(win, { titleIncludes: 'Settings' });
    await waitFor(win, 'settings open', async () => {
      const current = await state(win);
      return {
        ok: current.settingsOpen && current.buttons.some(btn => String(btn.text || '').includes('General')),
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
  await runScenario(win, 'Command Palette', 'opens and closes without changing context', async () => {
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
  if (!process.env.VISPNOTE_KEEP_REGRESSION_HOME) {
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
      console.warn(`Could not remove regression temp home ${regressionHome}: ${lastError?.message || String(lastError)}`);
    }
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
