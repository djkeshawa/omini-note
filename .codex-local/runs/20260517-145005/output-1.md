Implemented a scoped storage hardening fix.

Changed:
- [lib/store.js](/home/dinethj/Documents/projects/my_notes/lib/store.js:275): configured vault slugs are now validated before use, and vault directory checks use `lstat` so symlinked vault folders are ignored instead of followed.
- [lib/store.js](/home/dinethj/Documents/projects/my_notes/lib/store.js:781): first-run seed now reserves fresh vault directories, avoiding pre-existing stale or unsafe folders.
- [tests/store-safety.test.js](/home/dinethj/Documents/projects/my_notes/tests/store-safety.test.js:39): updated stale-folder expectations.
- [tests/store-safety.test.js](/home/dinethj/Documents/projects/my_notes/tests/store-safety.test.js:304): added regressions for symlinked vault folders and unsafe path-like configured slugs.

Verification:
- `node --test tests/store-safety.test.js` passed: 27/27
- `npm run test:editor` passed: 123/123
- `npm run check:main` passed

Remaining note: I left the existing untracked `.codex-local/runs/20260517-145005/` directory untouched.