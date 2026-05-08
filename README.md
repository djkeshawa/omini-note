# VispNote

VispNote is a local-first desktop note app for structured thinking. It combines markdown files, a block-based editor, graph navigation, task views, and optional local AI assistance in an Electron app.

The project is designed around a simple rule: your notes should stay usable as plain files, even if you stop using the app.

## Highlights

- **Local-first vaults**: notes are stored on disk as markdown files with front matter.
- **Block editor**: write nested paragraphs, headings, bullets, todos, quotes, code blocks, and dividers.
- **Fast editing**: keyboard shortcuts, block zoom, block movement, duplication, undo, redo, and area selection.
- **Knowledge navigation**: backlinks, wiki links, tag filtering, and graph view.
- **Task workflows**: todos, today view, workflow states, and reminder-style syntax.
- **Local search**: SQLite-backed search and backlink indexes.
- **Optional local AI**: Ask AI and writing tools can run through Ollama without hosted API keys.
- **Themed desktop UI**: settings, launch screen, editor toolbar, note list, and dialogs follow the same visual system.

## Tech Stack

- Electron
- React
- Babel standalone for renderer JSX loading
- SQLite via `better-sqlite3`
- `sqlite-vec` for vector indexing support
- Ollama integration for optional local AI
- Node.js built-in `node:test` for fast editor operation tests

## Requirements

- Node.js 20 or newer
- npm
- Linux, macOS, or Windows environment capable of running Electron
- Optional: Ollama for local AI features

## Getting Started

Install dependencies:

```bash
npm install
```

Start the app:

```bash
npm start
```

Run the main checks:

```bash
npm run test:editor
npm run check:main
```

Run the Electron smoke test:

```bash
HOME=/tmp/vispnote-smoke npm run smoke:electron
```

## Project Structure

```text
.
├── vispnote.html            # Electron renderer entry point
├── main.js                  # Electron main process and IPC handlers
├── preload.js               # Safe renderer bridge
├── lib/
│   ├── store.js             # Filesystem vault storage
│   ├── index.js             # SQLite search/backlink/tag index
│   ├── ai.js                # Local AI orchestration
│   ├── ollama.js            # Ollama client helpers
│   └── seed.js              # First-run seed vaults
├── src/
│   ├── app.jsx              # App shell and state orchestration
│   ├── editor.jsx           # Note editor pane
│   ├── outliner.jsx         # Block editor UI
│   ├── editorOps.js         # Pure editor operations
│   ├── outline.jsx          # Block model and markdown conversion
│   ├── sidebar.jsx          # Vault/tag/navigation sidebar
│   ├── notelist.jsx         # Note list pane
│   ├── graph.jsx            # Knowledge graph view
│   ├── panels.jsx           # Todos, today, workflow panels
│   ├── settings.jsx         # Settings modal
│   ├── blockFeatures.jsx    # Block menu, refs, embeds, and workflow helpers
│   ├── ai.jsx               # Ask AI modal
│   ├── markdown.jsx         # Inline markdown rendering
│   ├── theme.jsx            # Design tokens
│   └── data.jsx             # Browser fallback seed data
├── tests/
│   └── editor-ops.test.js   # Regression tests for editor behavior
└── scripts/
    └── smoke-electron.js    # Electron startup smoke test
```

## Local Data

New installs store vault data in:

```text
~/VispNote
```

Existing data under `~/OminiNote` or `~/MyNote` is still supported as a compatibility fallback when `~/VispNote` does not exist.

The repository intentionally ignores local vault data, SQLite databases, generated build output, local tool state, and environment files. Do not commit personal notes, local indexes, `.env` files, or generated app packages.

## AI Setup

AI features are optional. By default, VispNote is built for local Ollama usage.

Typical flow:

1. Install and start Ollama.
2. Pull a chat model, for example `gemma3`.
3. Pull an embedding model, for example `nomic-embed-text`.
4. Open VispNote settings and connect the local provider.

If Ollama is not available, the core note app still works.

## Testing Notes

`npm run test:editor` covers the high-risk editor behaviors, including:

- atomic Enter splits
- annotation splitting and merging
- undo and redo behavior
- block area selection
- shortcut wiring
- tag creation
- launch screen regression checks

`npm run check:main` syntax-checks the Electron main/preload and backend modules.

## Publishing Notes

Before publishing a release:

- Run `npm run test:editor`
- Run `npm run check:main`
- Run the Electron smoke test
- Build each desktop installer on its matching OS; the app ships native SQLite modules
- Confirm `.gitignore` is not allowing local vault data or database files
- Review `git status --ignored` if local tool or generated files are present

## License

VispNote is licensed under the Apache License 2.0. See [LICENSE](LICENSE).
