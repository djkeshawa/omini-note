Implemented a scoped vault registry hardening fix.

Changed:
- [lib/store.js](/home/dinethj/Documents/projects/my_notes/lib/store.js:873): `repairConfigVaults()` now normalizes persisted vault records by rejecting unsafe folders, repairing invalid vault IDs, de-duplicating IDs, canonicalizing `path`, and remapping `activeVaultId` when it was tied to a repaired ID.
- [tests/store-safety.test.js](/home/dinethj/Documents/projects/my_notes/tests/store-safety.test.js:359): added a regression for a tampered config with `id: "../bad"` and a forged external path.

Verification:
- `node --test tests/store-safety.test.js` passed: 28/28
- `npm run check:main` passed
- `npm run test:editor` passed: 125/125

Left untouched:
- Existing untracked `.codex-local/runs/20260517-145005/` files.

Remaining risk:
- The parallel explorer found separate AI streaming robustness candidates, but I kept this iteration focused on the validated store registry issue.