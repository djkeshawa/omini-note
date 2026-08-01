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

The final July 13, 2026 Windows/Electron verification measured a 164.04 ms index build, 0.33 ms direct-result p95, and 10.89 ms search p95. Treat these numbers as one machine's evidence; rerun the command on release hardware instead of assuming they remain constant.

## Upgrade and release compatibility

- Existing Markdown/front matter contracts remain unchanged.
- Preference and backup-status writes are tested byte-for-byte against an existing note file.
- Unknown front matter, comments, portable list structure, relative links, and attachment paths retain their existing round-trip tests.
- Renderer regression covers the minimum 900 px layout and the 1440 px three-pane layout, keyboard focus, dialogs, light/dark theme contracts, capture, search, Today, connections, and optional-pack isolation.
- Release verification requires `npm run test:all`, a required live
  `regression:memory` run, `npm run benchmark:10k`, and a native platform build.
  The unpacked and final-installer verifiers compare renderer SHA-256 and
  package version, parse the Electron/native-module CPU, test archive
  integrity, and reject anything outside the fixed per-platform inventory.
- A publish tag must be exactly `v${package.json.version}`. Matrix CLI
  `--x64`/`--arm64` flags are the only package-architecture authority.
- macOS signing is conditional on credentials, and fails closed when they exist.
  If `MAC_CSC_LINK` is configured, the job requires the full Developer ID and
  App Store Connect set and then verifies `codesign`, Gatekeeper, and the
  stapled notarization ticket. If no signing secrets are configured at all, the
  build is deterministically unsigned (`CSC_IDENTITY_AUTO_DISCOVERY=false`) and
  the signature verification is skipped via `--verify-mac-signing false`.
  A partial credential set still fails; only a complete absence relaxes it.
  **This was changed for 0.2.3.** Requiring signing unconditionally meant every
  release after v0.2.1 (2026-07-25) failed at the signing step, and 0.2.2 was
  never published as a result. Unsigned macOS builds warn under Gatekeeper on
  first launch. Restoring signed releases needs the five secrets plus
  `mac.notarize: true` in `electron-builder.yml`.
  macOS updates remain manual and `latest-mac.yml` is excluded.
- CI keeps the production dependency audit blocking. Development-only build
  tool advisories remain visible without weakening the shipped-dependency gate.
