# Repository Guidelines

## Project Structure & Module Organization

- `main.js` and `preload.js` contain the Electron main process and IPC bridge.
- `src/` contains renderer modules. Key areas include `src/app/`, `src/editor/`, `src/ai/`, `src/canvas/`, `src/panels/`, and `src/settings/`.
- `lib/` contains backend services such as storage, indexing, AI providers, Ollama, and Zotero helpers.
- `scripts/` contains build, smoke, and Electron regression runners.
- `tests/` contains Node-based tests. Shared test helpers live under `tests/helpers/`.
- `assets/` and `docs/` hold images/docs.

## Build, Test, and Development Commands

- `npm start`: build the renderer and launch Electron.
- `npm run build:renderer`: produce `build/renderer/app.js`.
- `npm run check:main`: run ESLint and syntax checks for main process modules.
- `npm run test:editor`: run the Node test suite via `scripts/run-node-tests.js`.
- `npm run regression:renderer`: run Electron UI scenarios.
- `npm run regression:ai`: run deterministic Ask AI workflows.
- `npm run test:all`: run the full local release gate.
- `npm run build:linux`, `npm run build:mac`, `npm run build:win`: package platform builds.

## Coding Style & Naming Conventions

Use 2-space indentation and semicolons. Prefer clear function names and small helpers over broad rewrites. Use camelCase for variables/functions, PascalCase for React components, and descriptive script names such as `*-electron.js`.

Run `npm run lint` before committing when touching source files.

## Modularity & Refactoring

Do not let source files grow into large catch-all modules. When changing a broad area, extract cohesive logic into focused files or subfolders, following boundaries such as `src/editor/`, `src/ai/`, `src/app/`, and `lib/`. Keep UI components, state helpers, IPC adapters, and pure logic separate where practical. Add tests for moved behavior.

## Intent & Completion Workflow

Before continuing an existing thread, quickly check the user's latest intent and the current project state. Distinguish whether the user is asking for investigation, planning, implementation, verification, status, or final completion. If the intent is to finish or complete already-started work, carry the task through the remaining implementation, verification, memory update, and final summary instead of stopping at a plan or partial result.

## Agent Memory Workflow

Use the LLM Memory MCP as durable project memory during coding work. Before editing or investigating a non-trivial change, recall relevant memories for the task and likely files. During or after meaningful work, record concise operational memories with `repo_id` `my_notes` when they would help future agents: actions taken, design decisions, new findings, issues and root causes, how fixes were implemented, fragile areas, feature implementation details, verification notes, and follow-up warnings.

Keep memories durable and safe. Do not store credentials, API keys, Zotero secrets, personal vault data, private note contents, `.env` values, generated package contents, or verbose transcripts. Prefer short summaries tied to files, commands, decisions, and risks that future coding agents can act on.

## Testing Guidelines

Tests use Node’s built-in `node:test` and assertion modules. Name test files with `*.test.js` under `tests/`. Add focused tests near changed behavior, and add Electron regression scenarios for user-facing editor, AI, or navigation workflows. Run `npm run test:editor`, then `npm run test:all`.

## Commit & Pull Request Guidelines

Recent history uses short imperative subjects, for example `Add Zotero reader integration`, `Prepare 0.1.24 release`, and scoped forms like `ui: let safe plugins run from commands`.

Pull requests should include a problem/solution summary, linked issue when available, verification commands, and screenshots or screencasts for visible UI changes.

## Security & Configuration Tips

Do not commit credentials, AI API keys, Zotero secrets, generated packages, or personal vault data. Validate IPC inputs in `main.js`, keep external URL behavior allowlisted, and preserve data-safety tests when touching storage or import/export paths.

<!-- SPECKIT START -->
For additional context about technologies to be used, project structure,
shell commands, and other important information, read
[specs/001-architecture-refactor/plan.md](/home/dinethj/Documents/projects/my_notes/specs/001-architecture-refactor/plan.md)
<!-- SPECKIT END -->
