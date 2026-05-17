Implemented a scoped storage hardening fix.

Changed:
- [lib/store.js](/home/dinethj/Documents/projects/my_notes/lib/store.js): replaced remaining direct `fsp.readFile`/`stat` paths for deleted notes, note versions, canvas deletion, and deleted canvas listing/restoration with the existing no-follow `readRegularUtf8File` helper. Symlinked trash/version/canvas files are now skipped in list views or rejected on restore/delete.
- [tests/store-safety.test.js](/home/dinethj/Documents/projects/my_notes/tests/store-safety.test.js): added regression coverage proving symlinked trash notes, note versions, active canvas files, and deleted canvas files do not leak external file contents.

Validated:
- Reproduced the original leak with a symlink in `.trash/notes`.
- `node --test tests/store-safety.test.js`
- `npm run check:main`
- `npm run test:editor` passes: 120 tests
- `git diff --check`

Remaining notes:
- Existing untracked `.codex-local/` loop artifacts were left untouched.
- A renderer exploration found separate possible table/editor issues, but I did not widen this iteration beyond the reproduced storage safety fix.