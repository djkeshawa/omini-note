Implemented three scoped fixes.

Changed:
- [scripts/verify-packaged-renderer.js](/home/dinethj/Documents/projects/my_notes/scripts/verify-packaged-renderer.js:1): verifier now fails on missing packaged artifacts, stale unpacked renderer bundles, stale `app.asar`, and empty packaged renderer bundles. It also uses `original-fs` under Electron-as-Node.
- [tests/package-verifier.test.js](/home/dinethj/Documents/projects/my_notes/tests/package-verifier.test.js:1): added fixture-based regression coverage for those verifier cases.
- [lib/ai.js](/home/dinethj/Documents/projects/my_notes/lib/ai.js:232): tightened private-host detection for custom hosted AI endpoints, including IPv6-mapped private IPs and `nip.io` / `sslip.io` private-IP aliases.
- [tests/store-safety.test.js](/home/dinethj/Documents/projects/my_notes/tests/store-safety.test.js:513): added AI endpoint bypass regressions.
- [lib/index.js](/home/dinethj/Documents/projects/my_notes/lib/index.js:17): bounded FTS query length/term count and coerced non-string search queries safely.
- [tests/index.test.js](/home/dinethj/Documents/projects/my_notes/tests/index.test.js:79): added search query normalization regressions.

Verification:
- `node --test tests/package-verifier.test.js`
- `node --test tests/package-verifier.test.js tests/store-safety.test.js`
- `ELECTRON_RUN_AS_NODE=1 "$(node -p "require('electron')")" --test tests/index.test.js`
- `npm run check:main`
- `npm run test:editor` passes: 119 tests
- `git diff --check`

Note: plain `node --test tests/index.test.js` cannot run in this checkout because `better-sqlite3` is built for Electron’s Node ABI, so I used the project’s Electron-as-Node test path. Existing untracked `.codex-local/` loop artifacts were left untouched.