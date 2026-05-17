Implemented a scoped AI streaming cleanup fix.

Changed:
- [lib/ai.js](/home/dinethj/Documents/projects/my_notes/lib/ai.js:1644): `readSseData()` now cancels the response body reader when it exits early, such as after an SSE `[DONE]` marker, so hosted provider streams do not leave open bodies hanging.
- [tests/ollama.test.js](/home/dinethj/Documents/projects/my_notes/tests/ollama.test.js:294): added a regression test for hosted chat streams that emit `[DONE]` while the body remains open.

Verification:
- `node --test tests/ollama.test.js` passed: 13/13
- `npm run test:editor` passed: 126/126
- `npm run check:main` passed

Left untouched:
- Existing untracked `.codex-local/runs/20260517-145005/` loop artifacts.

Remaining risk:
- The explorer identified separate hosted SSE robustness candidates around malformed or empty SSE frames. I kept this iteration focused on the reproduced stream resource cleanup bug.