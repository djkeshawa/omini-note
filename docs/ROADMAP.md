# VispNote roadmap — write, connect, act

VispNote is not an Obsidian clone and will not compete through plugin count, customization depth, or feature parity.

> **Write, connect, act — without configuring a productivity system first.**

The primary user is an individual knowledge worker. Local Markdown ownership, reliable autosave, history, trash, backups, and fast writing are product foundations. Advanced capabilities remain compatible, but live in optional packs until real use justifies wider exposure.

## Product principles

1. A fresh install starts with one Personal vault, one welcome note, and no setup questionnaire.
2. Notes, Today, Pinned, Tags, capture, search, and Connections form the default product.
3. AI is optional, transparent, source-linked, and never silently edits notes.
4. Specialist features are hidden before they are deleted. Existing data always remains readable.
5. New features must reduce work or improve thinking; visual configuration alone is not a roadmap goal.

## Now — strengthen the core loop

| Priority | Outcome |
|---|---|
| Reliability | File watching for external edits, conflict-safe saves, backup confidence, and performance at large vault sizes. |
| Writing | Faster editing, Markdown compatibility, accessibility, reduced motion, keyboard clarity, and a single optional reference pane. |
| Search | Highlight matches in the opened note, jump between results, improve ranking, and keep navigation fast. |
| Connections | Unify backlinks, unlinked mentions, related notes, and suggested connections with accept/ignore controls. |
| Today | One review for focus, open loops, due items, recently changed notes, and useful resurfaced context without duplicated tasks. |
| History | Show readable diffs between note versions and improve retention rules. |

## Next — useful assistance

| Item | User value |
|---|---|
| Transparent context | Show which notes and memories assistance used, with removable context and clickable citations. |
| Turn these notes into… | Create a brief, outline, decision summary, or project next steps with source links. |
| Save useful answers | Convert an answer into an ordinary, editable Markdown note with its sources. |
| Suggested connections | Propose links and explain why; the user accepts or ignores every change. |
| Local/Hosted choice | Keep the normal decision to two choices while provider URLs, keys, and model IDs stay under Advanced. |

## Optional packs

| Pack | Direction |
|---|---|
| Planning | Keep Agenda and workflow states for users with dated or structured work. Do not grow into a general project manager. |
| Thinking Board | Arrange notes, stickies, and connections, then convert a board into an outline or brief. Stop at a focused thinking surface. |
| Research | Make Zotero source reading, source notes, and cited synthesis straightforward after explicit activation. |
| Writer | Preserve novel structure and existing novelist vaults as an optional long-form Writer pack. |
| Agents | Keep MCP and llm-memory as a technical differentiator; improve setup toward one click before promoting it broadly. |
| Labs | Hold global graph, Smart Views machinery, and experiments away from first-run navigation. |

## Measure before deletion

Use `vispnote.featureUsage.v1` for allowlisted, on-device aggregate counters, activation dates, and repeat-use days. Never record note content, titles, tags, searches, prompts, paths, filenames, vault IDs, relationship contents, or API configuration.

- Local measurement is on-device by default and can be previewed, exported, cleared, or disabled.
- Anonymous upload is separately opt-in, off by default, and unavailable unless the build defines a first-party `VISPNOTE_TELEMETRY_ENDPOINT`.
- Uploaded data is limited to aggregates, app version, OS family, and a rotating monthly random identifier.

Review after six weeks:

- Promote only when a feature supports the product promise and at least 25% of active testers use it repeatedly.
- Keep an optional pack when reach is low but at least 40% of activators return.
- Consider retirement when activation is below 10%, repeat use is below 20%, and interviews find no critical workflow.
- Require at least ten active testers; otherwise use 30 active dogfood days plus interviews.

## Paused indefinitely

Do not spend roadmap time on:

- Kanban boards
- calendar week views
- recurring reminders
- prompt libraries
- community theme import or custom CSS expansion
- generic/no-code plugin creation
- typed query languages
- canvas minimaps, frames, or drawing-app parity
- Excalidraw-style tool expansion
- feature-for-feature Obsidian parity

Existing configurations continue to run during the measurement period; these items are paused, not destructively migrated.

## Engineering foundations

- Keep CI gates for lint, Node tests, Electron smoke, renderer regressions, deterministic AI regression, and dependency audits.
- Continue extracting cohesive modules from `app.jsx`, `main.js`, editor surfaces, and AI orchestration.
- Preserve the plain Markdown format and compatibility with existing vaults, canvases, plugins, AI settings, and specialist metadata.
- Add renderer regressions for the minimal default and each optional pack independently.
