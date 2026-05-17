Implemented a scoped table parsing fix.

Changed:
- [src/editor/tableOps.js](/home/dinethj/Documents/projects/my_notes/src/editor/tableOps.js:68): `splitMarkdownRow` now preserves literal backslashes and only treats `\|` / `\\` as table-cell escapes.
- [tests/editor-ops.test.js](/home/dinethj/Documents/projects/my_notes/tests/editor-ops.test.js:188): added helper coverage for `C:\temp\notes`.
- [tests/outline-markdown.test.js](/home/dinethj/Documents/projects/my_notes/tests/outline-markdown.test.js:56): added markdown import regression coverage for table cells with backslashes.

Verified:
- `node --test tests/editor-ops.test.js`
- `node --test tests/outline-markdown.test.js`
- `npm run test:editor` passes: 121 tests
- `npm run check:main`
- `git diff --check`

Remaining notes:
- Existing untracked `.codex-local/` loop artifacts were left untouched.
- I did not run Electron UI regressions; this was a parser/import fix covered by Node tests.