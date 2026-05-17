Implemented a scoped storage hardening fix.

Changed:
- [lib/store.js](/home/dinethj/Documents/projects/my_notes/lib/store.js:137): `readJsonSafe()` now opens JSON files with `O_NOFOLLOW`, requires regular files, and quarantines symlinked JSON instead of reading through them.
- [lib/store.js](/home/dinethj/Documents/projects/my_notes/lib/store.js:887): `secureConfigFile()` now uses `lstat()` so it does not `chmod` through a symlinked `.config.json`.
- [tests/store-safety.test.js](/home/dinethj/Documents/projects/my_notes/tests/store-safety.test.js:302): added regression coverage for symlinked vault `.meta.json` and global `.config.json`.

Verified:
- `node --test tests/store-safety.test.js`
- `npm run check:main`
- `npm run test:editor`
- `git diff --check`

Working tree note: existing untracked `.codex-local/` remains untouched.

Remaining risk: the subagent identified a separate `vaultHealth()` wiki-link anchor false positive (`[[Note#Section]]`) that I did not fix in this iteration to keep the change focused.