# Final hardening

This document records the reproducible checks behind VispNote's core capture, find, connect, and act experience.

## Assistance safety

- Brief, Outline, Decisions, and Next actions operate on the currently open note only.
- Generated text is shown in a modal preview before any write is available.
- Apply creates a new ordinary Markdown note and appends one deterministic `## Source` wiki link.
- Existing AI edit actions also preview before they can replace page, section, block, or selection content.
- Enabling or disabling assistance or a feature pack does not rewrite note files.

## Local status and recovery

The sidebar local-status control reports Saved, Saving, or Conflict. Its disclosed panel shows the active vault folder, the last successful backup timestamp, Vault Health, and a manual backup action. Backup metadata stores only the timestamp; it does not add the destination path to usage reports.

## Privacy-safe value counters

The allowlisted local feature report may count:

- first note created (recorded once);
- successful captures;
- search results opened;
- completed Today actions.

The counter API accepts no payload beyond allowlisted feature and action names. Note text, titles, tags, search queries, prompts, filenames, paths, note or vault identifiers, and secrets are rejected or dropped. Local reporting can be disabled, cleared, or exported; network sharing remains separately opt-in.

## 10,000-note performance gate

Run:

```bash
npm run benchmark:10k
```

The benchmark creates and deletes an owned temporary vault, indexes 10,000 representative notes, and reports:

- index build time for context;
- p95 direct result projection, required to stay at or below 100 ms;
- p95 SQLite full-text search, required to stay below one second.

The final July 13, 2026 Windows/Electron verification measured a 161.76 ms index build, 0.30 ms direct-result p95, and 10.63 ms search p95. Treat these numbers as one machine's evidence; rerun the command on release hardware instead of assuming they remain constant.

## Upgrade and release compatibility

- Existing Markdown/front matter contracts remain unchanged.
- Preference and backup-status writes are tested byte-for-byte against an existing note file.
- Unknown front matter, comments, portable list structure, relative links, and attachment paths retain their existing round-trip tests.
- Renderer regression covers the minimum 900 px layout and the 1440 px three-pane layout, keyboard focus, dialogs, light/dark theme contracts, capture, search, Today, connections, and optional-pack isolation.
- Release verification requires `npm run test:all`, `npm run benchmark:10k`, a platform package build, and `npm run verify:package-renderer`.
