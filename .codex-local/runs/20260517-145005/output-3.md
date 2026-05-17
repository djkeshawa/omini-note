Implemented two scoped hardening fixes.

Changed:
- [lib/ai.js](/home/dinethj/Documents/projects/my_notes/lib/ai.js): hosted AI URL private-host checks now normalize trailing dots and `%2E`, blocking `localhost.`, `localhost%2E`, and `127.0.0.1.` variants.
- [main.js](/home/dinethj/Documents/projects/my_notes/main.js) and [src/shared/plugins.js](/home/dinethj/Documents/projects/my_notes/src/shared/plugins.js): plugin IDs now normalize to AI-safe action/tool-name characters, preventing malformed persisted plugin IDs from breaking AI planning.
- [tests/store-safety.test.js](/home/dinethj/Documents/projects/my_notes/tests/store-safety.test.js) and [tests/renderer-wiring.test.js](/home/dinethj/Documents/projects/my_notes/tests/renderer-wiring.test.js): added regressions for both behaviors.

Verification:
- `node --test tests/store-safety.test.js tests/renderer-wiring.test.js` passed: 47/47
- `npm run check:main` passed
- `npm run test:editor` passed: 124/124

Left untouched:
- Existing untracked `.codex-local/runs/20260517-145005/` files.