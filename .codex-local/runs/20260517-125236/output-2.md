Implemented a scoped vault-health fix.

Changed:
- [lib/store.js](/home/dinethj/Documents/projects/my_notes/lib/store.js:480): `extractWikiTargets()` now strips wiki-link anchors before resolving note titles, so `[[Note#Section]]` and `[[Note#Section|alias]]` resolve to `Note`; anchor-only links like `[[#Section]]` are ignored.
- [tests/store-safety.test.js](/home/dinethj/Documents/projects/my_notes/tests/store-safety.test.js:336): added regression coverage for anchored links, aliased anchored links, local anchor links, and genuinely missing anchored links.

Verified:
- `node --test tests/store-safety.test.js`
- `npm run check:main`
- `npm run test:editor`
- `git diff --check`

Remaining risk: none identified in this scoped path. Existing untracked `.codex-local/` loop artifacts remain untouched.