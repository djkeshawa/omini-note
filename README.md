# VispNote

VispNote is a local-first desktop note app for individual knowledge workers who want to **write, connect, and act** without configuring a productivity system first.

The default experience stays deliberately small: Notes, Today, Pinned, Tags, fast capture, search, and note-level connections. Your notes remain usable as plain files even if you stop using the app.

## Highlights

- **Local-first vaults**: notes are stored on disk as markdown files with front matter.
- **Block editor**: write nested paragraphs, headings, bullets, todos, quotes, code blocks, and dividers.
- **Fast editing**: keyboard shortcuts, block zoom, block movement, duplication, undo, redo, and area selection.
- **Attachments**: paste or drag images, PDFs, text/Markdown, CSV, common office documents, and audio into notes. Images render inline; other files appear as compact Open chips, and everything stays in the vault under `attachments/`.
- **Export**: save any note as Markdown, self-contained HTML, or PDF from the command palette.
- **Canvas**: freeform whiteboard with sketching tools, plus live note cards — place notes on the canvas, arrange and connect them, double-click to open.
- **Knowledge navigation**: quick switcher (⌘P), backlinks, unlinked mentions with one-click linking, related notes, wiki links, tag filtering, and graph view.
- **Agenda workflows**: dated todos, today view, workflow states, and reminder-style syntax.
- **Local search**: SQLite-backed search and backlink indexes.
- **Optional local AI**: Ask AI and writing tools can run through Ollama without hosted API keys.
- **Preview-first assistance**: create a brief, outline, decisions note, or next-actions note from the open note. Every result is reviewed first, saved as ordinary Markdown, and linked back to its source.
- **Visible local state**: the sidebar status reveals Saved, Saving, or Conflict, the active vault folder, the last successful backup, and one-click Vault Health.
- **Themed desktop UI**: settings, launch screen, editor toolbar, note list, and dialogs follow the same visual system.

## Product focus

The core loop is intentionally simple:

1. **Write** in local Markdown with a fast block editor and one-step capture to Today.
2. **Connect** with wiki links, backlinks, unlinked mentions, related notes, and search.
3. **Act** by reviewing focus, open loops, due items, and resurfaced notes in Today.

Specialist capabilities live in optional packs so they do not become setup work:

| Pack | Purpose |
|---|---|
| Planning | Agenda and workflow views when dated tasks or workflow data exist. |
| Thinking Board | Arrange notes, stickies, and connections spatially. |
| Research | Zotero-assisted source reading and synthesis. |
| Writer | Long-form structure, scenes, and novelist-compatible vault metadata. |
| Agents | MCP and local llm-memory integration. |
| Labs | Global graph, Smart Views, and experimental specialist tools. |

Activation never changes note content. Existing canvases, novelist vaults, Zotero configuration, and memory configuration are detected automatically. Ask AI is optional and appears only after assistance is enabled.

VispNote can also keep a private, allowlisted feature-usage report on the device. It contains aggregate counters and repeat-use days—including first-note completion, successful capture, search-result opening, and Today actions—never note text, titles, tags, searches, prompts, filenames, paths, vault IDs, or secrets. The report can be previewed, exported, cleared, or disabled. Anonymous aggregate sharing is separately opt-in and appears only in builds configured with `VISPNOTE_TELEMETRY_ENDPOINT`.

## Tech Stack

- Electron
- React
- esbuild-bundled React renderer
- SQLite via `better-sqlite3`
- `sqlite-vec` for vector indexing support
- Ollama integration for optional local AI
- Node.js built-in `node:test` for fast editor operation tests

## Requirements

- Node.js 24.15.0 or newer within Node 24
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
npm run regression:renderer
npm run benchmark:10k
```

The 10,000-note benchmark uses an isolated temporary vault and enforces a 100 ms p95 budget for direct result projection plus a one-second p95 budget for indexed search. See [Final hardening](docs/final-hardening.md) for the compatibility, privacy, accessibility, and packaging gates.

Run the Electron smoke test:

```bash
npm run smoke:electron
npm run regression:renderer
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
│   ├── main.jsx             # Renderer bootstrap and import order
│   ├── app/                 # App shell, mutations, canvas actions, App API registry
│   ├── ai/                  # Ask AI UI and AI action planning helpers
│   ├── editor/              # Note editor, outliner, markdown model, editor operations
│   ├── panels/              # Sidebar, note list, graph, agenda, today, workflow panels
│   ├── canvas/              # Canvas dashboard view
│   ├── settings/            # Settings modal
│   └── shared/              # Theme, markdown rendering, plugins, storage utilities
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

## Agent Access (MCP)

VispNote ships a local MCP (Model Context Protocol) server so AI agents such
as Claude Code can use your vaults as a knowledge base — entirely on your
machine, with no cloud sync.

```bash
node bin/vispnote-mcp.js                 # read-only (default)
node bin/vispnote-mcp.js --allow-writes  # also enables create_note / append_to_note
```

Example Claude Code configuration (`.mcp.json`):

```json
{
  "mcpServers": {
    "vispnote": {
      "command": "node",
      "args": ["/path/to/visp-note/bin/vispnote-mcp.js"]
    }
  }
}
```

Tools: `list_vaults`, `search_notes`, `get_note`, `get_backlinks`,
`get_unlinked_mentions`, `list_notes_by_tag`, and (only with
`--allow-writes`) `create_note` and `append_to_note`. The server reads the
same vaults and SQLite index as the app (safe to run alongside it), is
read-only by default, and never listens on the network — it speaks MCP over
stdio to the process that launched it.

Note on concurrent edits: if an agent appends to a note that is open with
unsaved changes in the app, the app's next autosave detects the conflict and
asks which version to keep — choosing "keep mine" discards the agent's
append. Prefer agent writes to notes you are not actively editing.

## LLM Memory Bridge

VispNote can pair with a local [llm-memory](https://github.com/djkeshawa/llm-memory)
server so your notes and your agents share one memory:

1. Run the llm-memory server locally (`llm-memory serve`).
2. Enable the **Agents** pack in Advanced settings. Existing LLM Memory bridge
   configurations remain editable there; set the localhost server URL,
   repository id, and API key if the server requires one.
3. From the command palette: **Import memories as notes** materializes
   memories as editable notes tagged `#memory` with provenance properties
   (`memoryId::`, `memoryLayer::`, ...). Imported notes are yours — re-imports
   never overwrite them.
4. **Remember this note** distills the open note back into the memory server
   so agents can recall it. If the configured project does not exist on the
   server it is registered automatically, and when no project id is configured
   at all, a project is created from the note's name. VispNote records both the
   note and vault identities so notes with the same id in different vaults stay
   isolated.
5. Ask AI can blend relevant llm-memory recall into its answers, and the note
   footer shows memories connected to the open note.
6. **Synchronize note links to memory** creates new managed relationships and
   updates their weights when the note graph changes. It preserves unmanaged
   relationships and reports stale managed links; deletion remains manual until
   llm-memory provides a relationship-delete API.

`npm run regression:memory` exercises the whole bridge against a real
llm-memory server (for example the Docker container): create → recall →
import-as-note → remember → cleanup, all inside an isolated
`vispnote_regression` repo id. If no server is reachable the run is skipped,
so it remains an optional local integration check. `npm run test:all` runs the
self-contained release gates; `npm run test:all:with-memory` adds the optional
live regression. Set `VISPNOTE_MEMORY_REQUIRED=1` to make an unreachable server
a failure and use `VISPNOTE_MEMORY_URL` / `VISPNOTE_MEMORY_API_KEY` for a
loopback service with non-default settings.

## AI Setup

AI features are optional and disabled until enabled in **Settings > Assistance**.

Typical flow:

1. Install and start Ollama.
2. Pull a chat model, for example `gemma3`.
3. Pull an embedding model, for example `nomic-embed-text`.
4. Choose **Local AI** in Assistance and connect the local provider. Hosted
   providers remain available through **Hosted AI**, with URLs and model IDs
   under Advanced provider settings.

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

- Run `npm run test:all`
- Run `VISPNOTE_MEMORY_REQUIRED=1 npm run regression:memory` against a
  provisioned local llm-memory service
- Run `npm run benchmark:10k`
- Build each desktop installer on its matching OS; the app ships native SQLite modules
- Pass the target architecture on the command line (`--x64` or `--arm64`);
  the builder configuration intentionally has no fallback architecture list
- Run `npm run verify:package-renderer -- --platform <platform> --arch <arch>`
  and stage/verify final installers under `dist/release-output` before uploading
- Tag the release with the exact package version, for example package `0.2.2`
  must use tag `v0.2.2`
- Confirm `.gitignore` is not allowing local vault data or database files
- Review `git status --ignored` if local tool or generated files are present

The release workflow uploads a fixed, per-matrix inventory into separate
artifact directories and refuses missing, extra, empty, duplicate, corrupt, or
wrong-CPU packages. macOS publishing additionally requires `MAC_CSC_LINK`,
`MAC_CSC_KEY_PASSWORD`, `APPLE_API_KEY_BASE64`, `APPLE_API_KEY_ID`, and
`APPLE_API_ISSUER`; signing, Gatekeeper assessment, and notarization ticket
validation all fail closed. Set the `VISPNOTE_MEMORY_IMAGE` repository variable
to a pinned llm-memory service image before publishing; an optional
`VISPNOTE_MEMORY_API_KEY` secret is passed to secured images. macOS updates
remain manual, so macOS updater metadata is intentionally not published.

## Pricing

The desktop app is free.

## License

VispNote is licensed under the Apache License 2.0. See [LICENSE](LICENSE).
