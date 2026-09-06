const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const store = require('../lib/store');

async function runCheckboxRenderingScenario(win, { seedEditorNote, evaluate, waitFor }) {
  const id = 'qe_checkbox_rendering';
  const title = 'QE Checkbox Rendering';
  const body = '- [ ]\n- [x] Finished task\n- [ ] A longer task with enough text to wrap onto a second line when the note is narrow, while the checkbox remains aligned with the first line.\n  - [ ] Nested task';
  const prefs = await store.getPrefs();
  const originalTheme = prefs.tweaks?.theme || 'light';
  const originalSize = prefs.tweaks?.fontSize || 'default';
  try {
    await seedEditorNote(win, { id, title, body, expect: '' });
    for (const [theme, fontSize] of [['light', 'default'], ['dark', 'x-large']]) {
      await store.setPrefs({ tweaks: { theme, fontSize } });
      win.webContents.reload();
      await waitFor(win, `${theme} checkboxes reload as tasks`, async () => ({
        ok: await evaluate(win, `!document.querySelector('#mn-boot-splash') && document.querySelectorAll('.mn-block-row[data-block-kind="todo"]').length === 4`),
      }));
      const boxes = await evaluate(win, `Array.from(document.querySelectorAll('.mn-block-row')).map(row => {
        const control = row.querySelector('button[role="checkbox"]');
        const text = row.querySelector('[data-mn-block-content="display"]');
        if (!control || !text) return null;
        const target = control.getBoundingClientRect();
        const glyph = control.querySelector('span').getBoundingClientRect();
        const content = text.getBoundingClientRect();
        const style = getComputedStyle(text);
        return {
          width: target.width, height: target.height, checked: control.getAttribute('aria-checked'),
          alignment: Math.abs(glyph.y + glyph.height / 2 - content.y - parseFloat(style.paddingTop) - parseFloat(style.lineHeight) / 2),
        };
      })`);
      assert.equal(boxes.length, 4);
      for (const box of boxes) {
        assert.ok(box && box.width >= 24 && box.height >= 24, 'checkboxes need a usable click target');
        assert.ok(box.alignment <= 1.5, `checkbox is ${box.alignment}px away from the first-line center`);
      }
      assert.deepEqual(boxes.map(box => box.checked), ['false', 'true', 'false', 'false']);
      if (process.env.VISPNOTE_RENDER_REVIEW_DIR) {
        fs.mkdirSync(process.env.VISPNOTE_RENDER_REVIEW_DIR, { recursive: true });
        fs.writeFileSync(path.join(process.env.VISPNOTE_RENDER_REVIEW_DIR, `checkboxes-${theme}.png`), (await win.webContents.capturePage()).toPNG());
      }
    }
    await evaluate(win, `document.querySelector('.mn-block-row button[role="checkbox"]').focus()`);
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Space' });
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Space' });
    await waitFor(win, 'keyboard checkbox toggle is saved', async () => {
      const note = await store.getNote(prefs.activeVaultId, id);
      return { ok: /^- \[x\]/.test(note.body) };
    });
    win.webContents.reload();
    await waitFor(win, 'empty completed checkbox stays completed after reload', async () => ({
      ok: await evaluate(win, `document.querySelector('.mn-block-row button[role="checkbox"]')?.getAttribute('aria-checked') === 'true'`),
    }));
  } finally {
    await store.setPrefs({ tweaks: { theme: originalTheme, fontSize: originalSize } });
  }
}

module.exports = { runCheckboxRenderingScenario };
