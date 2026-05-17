Implemented two scoped fixes.

Changed:
- [main.js](/home/dinethj/Documents/projects/my_notes/main.js:744): optional search index write failures now mark the index unavailable through `noteSearchIndexFailure`, so health/search state does not stay falsely green.
- [main.js](/home/dinethj/Documents/projects/my_notes/main.js:1101): explicit rebuild failures now invalidate index availability before returning the error.
- [src/app/appActions.js](/home/dinethj/Documents/projects/my_notes/src/app/appActions.js:66): required app action string args now fail after trimming, so whitespace-only required inputs are rejected.
- [tests/app-actions.test.js](/home/dinethj/Documents/projects/my_notes/tests/app-actions.test.js:30) and [tests/store-safety.test.js](/home/dinethj/Documents/projects/my_notes/tests/store-safety.test.js:517): added regressions for those behaviors.

Verification:
- `node --test tests/app-actions.test.js tests/store-safety.test.js` passed: 35/35
- `npm run test:editor` passed: 123/123
- `npm run check:main` passed

Remaining note: existing untracked `.codex-local/runs/20260517-145005/` files were left untouched.