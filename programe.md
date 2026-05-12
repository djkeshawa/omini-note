# VispNote Autoresearch Program

This program is an autonomous improvement loop for VispNote. The goal is to let an LLM agent repeatedly inspect the app, make one focused improvement at a time, verify it, and keep only changes that improve reliability, security, performance, maintainability, or the user interface without adding needless complexity.

VispNote is a local-first Electron and React desktop note app. It stores user notes as markdown files, maintains SQLite-backed search and backlink indexes, exposes a constrained IPC bridge through `preload.js`, and supports optional local AI through Ollama.

## Setup

To start a fresh run:

1. Confirm the run branch:
   - Use the branch `autoresearch`.
   - If it already exists, continue from it only if the user wants to resume that run.
   - Otherwise create it from the current main development branch.

2. Create or enter the branch:

   ```bash
   git checkout -b autoresearch
   ```

   If the branch already exists and the user asked to resume:

   ```bash
   git checkout autoresearch
   ```

3. Read the in-scope files before making changes:
   - `README.md` for project context and commands.
   - `package.json` for scripts, dependencies, and supported Node/npm versions.
   - `main.js` for Electron main process, IPC handlers, filesystem access, updater, shortcuts, spellcheck, and app lifecycle.
   - `preload.js` for the renderer IPC bridge and security boundary.
   - `lib/store.js` for vault and note filesystem behavior.
   - `lib/index.js` for SQLite search, tags, backlinks, and index behavior.
   - `lib/ai.js`, `lib/ollama.js`, and `src/ai/` when working on AI behavior.
   - `src/app/`, `src/editor/`, `src/panels/`, `src/canvas/`, `src/settings/`, and `src/shared/` for renderer behavior.
   - `tests/` and `scripts/` for existing verification patterns.

4. Verify dependencies exist:
   - If `node_modules/` is missing, tell the human to run `npm install`.
   - Do not install new dependencies unless the user explicitly approves.

5. Initialize `results.tsv` if it does not exist. Keep it untracked by git.

   ```text
   commit	score	status	category	description	verification
   ```

6. Confirm setup:
   - Current branch is `autoresearch`.
   - Worktree state is understood.
   - Dependencies are available.
   - `results.tsv` is present or intentionally skipped by the user.

## Objective

Improve the app steadily while preserving the core promise: user notes remain local, plain, recoverable, and safe.

Good improvements include:

- Reliability fixes: data loss prevention, autosave correctness, recovery paths, crash prevention, stale state bugs, race conditions, cross-platform path handling, updater failure behavior, Electron lifecycle bugs.
- Security fixes: IPC validation, path traversal prevention, prototype pollution hardening, unsafe external URL handling, renderer isolation, markdown or Mermaid rendering safety, AI tool input limits, backup import safety.
- Performance work: faster startup, lower renderer re-render cost, less synchronous work on hot paths, better indexing behavior, large-vault responsiveness, search responsiveness, memory reduction.
- UI improvements: clearer interaction states, better keyboard flow, responsive layout fixes, dialogs that prevent destructive mistakes, consistent spacing and density, accessible labels and focus behavior.
- Maintainability: focused refactors that reduce duplication, clarify ownership boundaries, or make risky code testable.
- Test coverage: regression tests for high-risk behavior or newly fixed bugs.

Bad improvements include:

- Cosmetic churn without a concrete user benefit.
- Large rewrites without strong evidence.
- New dependencies for problems the current stack can solve.
- Changes that weaken local-first behavior.
- Changes that make notes less usable as plain markdown files.
- Changes that hide failures instead of handling them.

## Hard Constraints

- Do not modify user vault data or generated local app data.
- Do not commit `node_modules/`, build outputs, Electron packages, local databases, logs, or personal notes.
- Do not add hosted AI or telemetry behavior.
- Do not loosen IPC, filesystem, URL, backup import, or AI input validation.
- Do not bypass the existing preload boundary by exposing raw Electron APIs to the renderer.
- Do not remove tests simply to make a run pass.
- Do not make unrelated formatting changes across the repo.
- Keep every experiment focused. One idea per commit is the default.

## Editable Areas

Everything in the app may be edited when relevant, but choose the smallest surface that solves the problem:

- Electron main process: `main.js`
- Preload bridge: `preload.js`
- Backend helpers: `lib/`
- Renderer app code: `src/`
- Tests and scripts: `tests/`, `scripts/`
- Documentation: `README.md`, `docs/`
- Packaging config: `electron-builder.yml`, `package.json` only when the change requires it

Avoid editing:

- Generated build output under `build/` or `dist/`
- `node_modules/`
- Local vaults, caches, databases, or environment files

## Baseline

The first run should establish the current verification baseline before changing code.

Run the fastest meaningful baseline first:

```bash
npm run check:main
npm run test:editor
```

If Electron is available in the environment, also run:

```bash
npm run regression:renderer
```

For release-sensitive changes, run:

```bash
npm run test:all
```

Record the baseline in `results.tsv` with the current commit hash and a short note.

## Scoring

This app does not have a single numeric metric like model loss. Use a practical score from 0 to 5:

- `5`: clear user-facing improvement or high-confidence security/data-loss fix with tests.
- `4`: meaningful reliability, performance, or UX improvement with suitable verification.
- `3`: useful cleanup or small bug fix with low risk.
- `2`: neutral or uncertain value; usually discard unless it simplifies code.
- `1`: worse complexity, weak evidence, or questionable behavior.
- `0`: crash, broken tests, failed startup, or abandoned attempt.

Keep a change only when its value is clear and its complexity cost is justified.

## Logging Results

After each experiment, append one row to `results.tsv`.

Columns:

```text
commit	score	status	category	description	verification
```

Rules:

- `commit`: short 7-character git commit hash, or `0000000` for a crash before commit.
- `score`: integer from `0` to `5`.
- `status`: `keep`, `discard`, or `crash`.
- `category`: `reliability`, `security`, `performance`, `ui`, `tests`, `docs`, or `maintainability`.
- `description`: short text. Do not use tabs.
- `verification`: commands run and the result. Do not use tabs.

Example:

```text
commit	score	status	category	description	verification
a1b2c3d	3	keep	tests	baseline	npm run check:main pass; npm run test:editor pass
b2c3d4e	5	keep	security	harden external URL handling	npm run test:all pass
c3d4e5f	2	discard	ui	restyle settings controls	npm run test:editor pass; screenshot showed cramped controls
d4e5f6g	0	crash	performance	cache graph layout	renderer regression crashed during startup
```

Do not commit `results.tsv`.

## Experiment Loop

Loop until the user stops the run:

1. Inspect state:

   ```bash
   git status --short --branch
   git log --oneline -5
   ```

2. Choose one focused idea.

   Prefer ideas from:
   - Failing tests, lint, or smoke checks.
   - TODO-like comments in risky modules.
   - Repeated code that hides inconsistent behavior.
   - IPC handlers accepting untrusted renderer input.
   - File operations that touch vault paths, trash, backups, or versions.
   - Large renderer components with stale state or expensive recalculation.
   - UI states that can lead to destructive action or lost work.

3. Make the smallest practical code change.

4. Add or update targeted tests when the behavior is testable.

5. Commit the experiment:

   ```bash
   git add <changed-files>
   git commit -m "<category>: <short experiment description>"
   ```

6. Verify:

   Start with targeted checks. Then run broader checks based on risk.

   Common commands:

   ```bash
   npm run check:main
   npm run test:editor
   npm run regression:renderer
   npm run smoke:electron
   npm run test:all
   ```

7. Decide:
   - Keep if verification passes and the improvement is valuable.
   - Discard if value is weak, complexity is not justified, or behavior regresses.
   - Treat crashes, startup failures, or broken core workflows as failed unless quickly fixed.

8. Log the result in `results.tsv`.

9. If discarding, reset only the experiment commit:

   ```bash
   git reset --hard HEAD~1
   ```

   Only do this when the commit is definitely the agent's own latest experiment. Never reset unrelated user work.

10. Continue with the next idea.

## Verification Guidance

Use risk-based verification:

- Editor or markdown behavior:
  - `npm run test:editor`
  - Add tests in `tests/editor-ops.test.js`, `tests/outline-markdown.test.js`, or related files.

- Main process, IPC, storage, AI backend, or security changes:
  - `npm run check:main`
  - Add or update node tests in `tests/`.
  - Run `npm run test:all` for broad changes.

- Renderer UI changes:
  - `npm run build:renderer`
  - `npm run regression:renderer` when Electron can run.
  - Use screenshots or manual inspection when layout is the point of the change.

- Packaging changes:
  - `npm run build:renderer`
  - `npm run verify:package-renderer`
  - Platform build only when necessary.

If a command cannot run in the current environment, log that clearly.

## Security Checklist

For every security-focused experiment, check:

- Renderer input is validated in `main.js`, not trusted because it came through `preload.js`.
- Vault, note, canvas, trash, backup, and version identifiers cannot escape the intended vault root.
- Patch-like objects reject `__proto__`, `prototype`, and `constructor` keys where relevant.
- External URLs are restricted to safe schemes before opening with `shell.openExternal`.
- Backup import handles size limits, path traversal, and overwrite behavior explicitly.
- Markdown, Mermaid, KaTeX, and HTML-like content cannot execute script in the renderer.
- AI request payloads have size limits and cancellation behavior.
- Secrets and local notes are not logged unnecessarily.

## UI Checklist

For UI work, verify:

- The first screen remains the actual app experience, not a marketing page.
- Text does not overlap or overflow at common desktop widths.
- Destructive actions have clear confirmation or recovery.
- Keyboard and focus behavior stay usable.
- Empty, loading, error, and disabled states are handled.
- Visual changes match the existing VispNote style instead of introducing a separate design language.
- The app remains comfortable for repeated note-taking work, not just a one-off demo screen.

## Performance Checklist

For performance work, prefer measurable hot paths:

- Startup and renderer bundle build time.
- Large-vault note loading and note list filtering.
- Search, backlinks, tag counts, and graph rendering.
- Autosave and dirty-note flushing.
- AI streaming and cancellation.
- Expensive React recalculation or unnecessary global state churn.

Do not keep micro-optimizations that reduce clarity without visible or measured benefit.

## Crash Handling

If an experiment crashes:

1. Read the failure:

   ```bash
   tail -n 80 <log-file>
   ```

2. If it is a simple typo or missing import, fix and rerun.

3. If the idea is flawed or takes multiple repair attempts, log it as `crash`, discard the commit, and move on.

## Rewind Rules

Rewind sparingly.

Use `git reset --hard HEAD~1` only to discard the current agent-owned experiment commit. Before resetting, confirm:

- The branch is `autoresearch`.
- The commit being removed is the current experiment.
- No uncommitted user work is present.

Never reset, clean, or delete unrelated files to make the worktree look tidy.

## Research Prompts

When stuck, search the local code for one of these themes:

```bash
rg "TODO|FIXME|HACK|unsafe|sanitize|validate|escape|path|openExternal|innerHTML|dangerouslySetInnerHTML|ipcMain|invoke|autosave|dirty|trash|backup|version|cancel|timeout|error"
```

Then choose one concrete risk and write a targeted regression test before or alongside the fix.

## Completion Report

When the user asks for status, report:

- Current branch and HEAD commit.
- Best kept changes.
- Discarded attempts worth knowing about.
- Verification commands and whether they passed.
- Any known gaps or commands that could not run.

Do not claim a security, performance, or reliability win unless the code and verification support it.
