# VispNote Roadmap — the private thinking partner

VispNote is not an Obsidian clone. The bet:

> **Local-first notes that think with you.** On-device AI that reads, links,
> and remembers your knowledge — without any of it leaving your machine — and
> a vault that doubles as durable, human-readable memory for your AI agents.

This revision adds a product/UX lens to the original engineering plan: canvas,
Ask AI, and workflow improvements, plus everyday usability work that makes the
app feel valuable in the first ten minutes, not just architecturally sound.

## Shipped (0.2.0)

Image attachments (paste/drop) · rename-safe wiki links · quick switcher (⌘P)
· unlinked mentions with one-click linking · connections footer (backlinks +
semantic related notes) · local MCP server (`bin/vispnote-mcp.js`) · per-note
export (MD/HTML/PDF) · Today housekeeping digest · live note cards on the
canvas · **llm-memory bridge** (import memories as notes, remember notes) ·
two-round audited quality pass (rename races, paste data loss, mention
corruption, per-keystroke performance, 43% smaller bundle).

---

## Track 1 — Intelligence (the moat)

| Item | Size | What the user gets |
|---|---|---|
| **A3. Memory-aware Ask AI** | M | Ask AI blends llm-memory recall into answers with distinct "from memory" vs "from notes" citations. The `recall` IPC hook is already wired. |
| Memory bridge deepening | S–M | Refresh un-edited memory notes when the upstream memory changed; "remember this block" slash command; scheduled auto-import; importance shown on memory notes. |
| B2. Suggested tags & properties | M | On save, a local model proposes tags/properties as accept-or-ignore chips — never silent writes. |
| MCP server v2 | S–M | Semantic (vector) search tool + `get_agenda`, so agents get the same recall quality the app has. |

## Track 2 — Canvas UX

Note cards made the canvas a thinking surface; these make it a *good* one.

| Item | Size | What the user gets |
|---|---|---|
| **Anchored connectors** | M | Arrows that attach to cards and follow them when dragged — edges between ideas that survive rearranging. Today's arrows are free-floating. |
| Send to canvas | S | "Add to canvas…" on notes (palette + note list context menu) instead of only pulling from inside the canvas. |
| Promote sticky → note | S | Turn a sketch-phase sticky into a real note (and card) in place; thinking hardens into knowledge without retyping. |
| Zoom-to-fit + minimap | S | One key to see everything; orientation on large boards. |
| Alignment & tidy | S–M | Snap-to-grid, drag alignment guides, "arrange selection" auto-layout. |
| Groups/frames | M | Labeled frames that move their children together — chapters, clusters, swimlanes. |
| Canvas export | S | PNG/SVG export of the board (the graph already exports SVG). |

## Track 3 — Ask AI UX

The engine is strong (multi-provider, RAG, PII scrubbing); the surface can
earn more trust and reuse.

| Item | Size | What the user gets |
|---|---|---|
| **Context transparency chips** | M | Before the answer streams, show which notes/memories were retrieved as removable chips — see and steer what the AI read. |
| Clickable citations + hover preview | S | Sources open the note; hovering previews it. Trust through verifiability. |
| Save answer as note | S | One click turns a good answer into a note (tagged, source-linked) — today good answers evaporate. |
| Prompt library | S–M | Reusable prompts (e.g. "weekly review", "critique this draft") surfaced in the chat input and palette. |
| Regenerate / stop / model badge | S | Visible model + status, stop button, one-click regenerate. |
| Selection → Ask AI polish | S | Make the existing selection AI menu discoverable (hint on first selection, palette entry "Ask AI about selection"). |

## Track 4 — Workflow & agenda UX

The task model (states, dated todos, reminders) outclasses most note apps;
the views underuse it.

| Item | Size | What the user gets |
|---|---|---|
| **Kanban board view** | M | Drag notes/tasks between workflow states (TODO → DOING → DONE). The states and workflow panel exist; the board makes them tactile. |
| Natural-language reminders | S–M | `@remind tomorrow 9am`, `@remind next friday` — parsed locally into the existing syntax. |
| Recurring reminders | M | `@remind every monday 09:00`; completions roll the date forward. |
| Inline check-off everywhere | S | Tick todos directly in Today, calendar, and note list previews without opening the note. |
| Note progress chips | S | "3/7 todos" chip in the note list for notes with open tasks. |
| Calendar week view + drag-to-reschedule | M | Drag a task to another day; see the week, not just the month. |

## Track 5 — Everyday usability (first-ten-minutes value)

| Item | Size | What the user gets |
|---|---|---|
| **Search UX upgrade** | M | `tag:` / `in:` filters, match highlighting in the opened note, jump-to-next-match. FTS already supports the queries. |
| Version diff view | S–M | The version history dialog shows *what changed* between versions, not just timestamps. Pairs with retention age-tiers (Track 6). |
| Template picker on new note | S | Long-press/dropdown on ⌘N offering note templates (they exist as plugins; surface them). |
| Onboarding polish | S–M | First-run checklist (make a note → link it → try ⌘P → try the canvas), refreshed seed vault, actionable empty states. |
| Trust panel | S | A settings card stating plainly what stays local, where files live, and one-click "open vault folder" / backup reminder. |
| Note list at scale | M | Virtualized rows + memoized snippets — smoothness at 5k+ notes (flagged in both perf reviews). |
| Accessibility pass | M | Focus traps in modals, aria labels on icon buttons, reduced-motion support, contrast audit via the existing theme validator. |

## Track 6 — Foundations (protects everything above)

| Item | Size | Why |
|---|---|---|
| **CI workflow** | S | Node tests + lint + renderer build on every PR. 13 PRs merged this cycle with zero machine checks. Do this first. |
| **D2. File watching** | M | External edits (Syncthing/git/agents via MCP) appear live; removes the documented MCP-write conflict caveat. The honest multi-device story. |
| `app.jsx` refactor | L | ~4,900 lines; every feature pays a tax. Unlocks tabs/split panes. |
| Tabs & split panes | M (after refactor) | Write in one pane while referencing another — the one parity feature worth reclaiming. |
| Version retention age tiers | S–M | Keep all recent, hourly for a day, daily for 30 — today ~4 minutes of typing can evict a note's older history. |
| Perf follow-ups | S | `dirtyNotes` callback churn; embedding backfill progress surfacing. |
| Editor completeness drip | S each | Callouts, footnotes, inline `$math$`, real syntax highlighting, Obsidian/Logseq importers. |

## Deferred / positioning

Typed properties UI growing into a query language · vault encryption at rest
(pairs with a future paid E2E sync tier) · attachments in backup export ·
rebindable shortcuts, vim mode, custom CSS, multi-window · mobile & publish
(BYO-sync + read-only viewer first, if demand shows).

**Not doing:** community JS plugin marketplace (MCP/agents are the extension
story) · cloud accounts · feature-for-feature Obsidian chase.

## Suggested sequence

1. **CI + A3** — protect the codebase, finish the memory loop (the strategic headline).
2. **Canvas pack 1**: anchored connectors + send-to-canvas + zoom-to-fit — makes 0.2.0's headline feature sing.
3. **Ask AI trust pack**: context chips + clickable citations + save-answer-as-note.
4. **Workflow pack**: kanban board + natural-language reminders + inline check-off.
5. **D2 file watching**, then the **`app.jsx` refactor → tabs/panes**.
6. Usability drip (search UX, version diff, onboarding, virtualization) woven between the larger items.

Sizes: S ≈ a day, M ≈ 2–4 days, L ≈ a week+, at the current test bar.
