# VispNote Roadmap — the private thinking partner

VispNote is not trying to be Obsidian. Obsidian's moat is a thousand community
plugins; ours is a different bet:

> **Local-first notes that think with you.** On-device AI that reads, links,
> and remembers your knowledge — without any of it leaving your machine — and
> a vault that doubles as durable, human-readable memory for your AI agents.

Everything below is prioritized through that lens. Parity features earn a slot
only when their absence blocks adoption ("table stakes"), not because Obsidian
has them.

## Where we are (done)

- Local-first multi-vault markdown store, block outliner, agenda/workflow
  states, graph, whiteboard canvas, smart views, themes, versions + trash
- Multi-provider local-capable AI: Ollama-first RAG over `sqlite-vec`
  embeddings, agentic note research, inline writing tools, PII scrubbing
- Zotero read integration
- Recent: image attachments (paste/drop), rename-safe wiki links, quick
  switcher (⌘P)

## The bet: notes as shared memory (human + agents)

The differentiating pillar. VispNote already has the storage, index, and
embedding layers; what is missing is the interop surface.

### A1. VispNote MCP server (L)

Expose the active vault to local AI agents (Claude Code, or any MCP client)
over a localhost MCP server:

- Tools: `search_notes` (FTS + vector), `get_note`, `get_backlinks`,
  `list_by_tag`, `append_to_note`, `create_note`, `get_agenda`
- Reuses `lib/index.js` and `lib/store.js` directly — the same bounded tool
  surface the built-in note-research agent already uses (`lib/ai.js`)
- Opt-in per vault, capability-scoped (read-only by default, write behind a
  setting), localhost only — same trust posture as the Zotero client
- Outcome: any coding/personal agent can use your notes as its knowledge base
  without cloud sync. "Agents are our plugins."

### A2. llm-memory bridge (M)

Two-way bridge to the llm-memory MCP server (the durable agent-memory store
already used during VispNote development):

- **Memories → notes**: materialize memory items as markdown notes in a
  dedicated `Memory` section/vault with provenance front matter
  (`source: llm-memory`, repo/topic ids). Memories become searchable,
  linkable, editable — human curation of agent memory.
- **Notes → memories**: a "Remember this" block/note action (slash command +
  palette) that writes a distilled memory back through the bridge.
- Conflict rule: notes are the human-owned copy; the bridge never silently
  overwrites an edited note.

### A3. Memory-aware Ask AI (M)

`aiRuntime` gains a recall step: before RAG, query the llm-memory bridge and
blend recalled memories into context with distinct citations ("from memory"
vs "from notes"). Honors the existing PII scrubber and provider config.

## Self-organizing knowledge

Make the vault wire itself together — locally.

### B1. Connections panel (M)

Per-note side panel: semantically related notes (existing `vectorSearch`),
unlinked mentions (existing FTS), one-click "link it" that inserts the
`[[wiki link]]`. This is where the embedding index becomes visible value.

### B2. Suggested tags & properties (S/M)

On save, a local model proposes tags/properties as *suggestions* (chips to
accept, never silent writes). Reuses the embed/chat pipeline.

### B3. Daily digest (M)

The Today view gains an on-device AI digest: what changed yesterday, what is
due, stale TODOs, notes touched but never linked. Pairs with a true
daily-note-per-day journal file (small, and it anchors the habit).

## Thinking surfaces

### C1. Canvas note-cards (M/L)

Place real notes on the whiteboard canvas and draw edges between them. Merges
our two visual features into something neither Obsidian Canvas nor Excalidraw
is: a spatial view over live notes, with the sketch tools already built.

### C2. Local graph (S)

Per-note neighborhood graph (1–2 hops) in the connections panel; fix the
O(n²) force sim before large vaults hit it (Barnes-Hut or capped node counts).

## Table stakes we still owe (kept deliberately small)

- **D1. Export pack (S/M)**: per-note PDF (`printToPDF`), HTML, copy-as-
  markdown; include attachments in backup export/import.
- **D2. Live with external sync (M)**: file watching so Syncthing/Dropbox/git
  edits appear without reload; document the BYO-sync story. (We are not
  building a sync service yet; E2E sync can become the paid tier later.)
- **D3. Editor completeness drip (S each)**: callouts, footnotes, inline
  `$math$`, real syntax highlighting (highlight.js/Shiki), import from
  Obsidian/Logseq folders.

## Engineering guardrails (prerequisites, not features)

- Split `app.jsx` (~200 KB), `outliner.jsx` (~170 KB), `ai.jsx` (~140 KB)
  into the focused modules `AGENTS.md` already mandates — A1/B1/C1 all touch
  these files and get riskier the longer this waits.
- Replace renderer full-`allNotes` scans (block-ref resolution, backlink
  fallback) with index-backed lookups before promoting 5k+ note vaults.
- Prioritize embedding backfill by recency so big imports become AI-searchable
  fast.
- Every phase lands with node tests + an Electron regression scenario, per
  the existing release gate.

## What we are deliberately NOT doing

- No community JS plugin marketplace — MCP/agent interop is our extension
  story, with a real security model instead of "plugins run with full access".
- No publish-to-web service, no mobile app yet (BYO-sync + future viewer
  first), no cloud accounts.
- No feature-for-feature Obsidian chase.

## Deferred parity backlog (not scheduled, not forgotten)

Items from the original gap analysis that lost priority under this strategy.
They re-enter the roadmap only when something above unblocks or demands them:

- **Tabs & split panes** — strongest deferred candidate; "write while
  referencing" serves the thinking-partner vision too. Gated on the `app.jsx`
  split (guardrails), so revisit right after that refactor lands.
- **Typed properties UI + query language (Dataview-lite)** — B2's suggested
  properties may grow into this; needs a real YAML parser first.
- **Vault encryption at rest** — aligns with the privacy positioning; pairs
  naturally with a future paid E2E sync tier.
- **Vim mode, rebindable shortcuts, custom CSS, multi-window** — personal
  polish; none blocks the strategy.
- **Mobile & publish** — see "not doing"; BYO-sync plus a read-only viewer is
  the likely first step if demand shows up.

## Suggested order

| # | Item | Size | Why first |
|---|------|------|-----------|
| 1 | B1 Connections panel | M | Fastest visible payoff from the embedding index; no new architecture |
| 2 | A1 MCP server | L | The moat; design its tool surface while B1 exercises the same queries |
| 3 | A2 llm-memory bridge | M | Builds on A1's plumbing and trust model |
| 4 | D1 Export pack | S/M | Cheap trust-builder, fits between larger items |
| 5 | A3 Memory-aware Ask AI | M | Completes the memory loop |
| 6 | B3 Daily digest + daily notes | M | Habit anchor on top of A3/B2 pieces |
| 7 | C1 Canvas note-cards | M/L | Headline visual feature once panels/refactor land |

Sizes: S ≈ a day, M ≈ 2–4 days, L ≈ a week+, at the current test bar.
