---
name: changelog-and-docs
description: Rules for the user-visible changelog entry and the feature documentation every change ships with (pages.json, READMEs, STRUCTURE.md, docs/, specs/, audit:docs).
when_to_use: When finishing any feature, fix, SDK or page that users or developers will notice, and before claiming a task done.
---

# Changelog: every user-visible change gets an entry

The three.ws community follows the public changelog (three.ws/changelog, RSS, JSON, Telegram). Keep it alive:

- **New page?** Nothing extra: the `added` date in `data/pages.json` feeds the changelog automatically.
- **Everything else users would notice** (feature, improvement, fix, SDK release, security work): append an entry to `data/changelog.json` with date, community-readable title + summary (plain language, no commit jargon), and tags from: feature, improvement, fix, sdk, infra, docs, security. Optional `link` must be a live page path.
- `npm run build:pages` regenerates CHANGELOG.md, public/changelog.json, and public/changelog.xml. It also validates your entry and fails the build on a malformed one.
- **Delivery to the community is automatic.** `/api/cron/changelog-push` (Cloud Scheduler, every 20 min) reads the feed baked into the running image, diffs it against DB state (`app_settings`), and posts anything new to two lanes: the community Telegram channel (`TELEGRAM_CHANGELOG_CHAT_ID`, @three_ws) gets every entry, and a reply thread on @trythreews (`pushXLane`) gets every entry that passes `data/changelog-x-filter.json`. That filter keeps a public, unattended feed free of wallet and payment internals, keys, outages, security work, other coins, and bare fixes; extend it there, with a reason, rather than in code. X was retired on 2026-07-18 and turned back on by the owner on 2026-09-24. The three reviewed feature posts a day are a separate pipeline (`docs/x-content-pipeline.md`). An entry goes out on its own shortly after the deploy that ships it; there is no manual push step. Credentials live on the Cloud Run service. Do NOT run `npm run changelog:push` / `changelog:push:x` for routine releases anymore: their file-based state (`data/changelog-*-state.json`) is separate from the cron's DB state, so a manual push double-posts. The scripts remain for `--dry-run` previews and owner-directed backfills only.
- Internal-only chores (CI, lockfiles, refactors with no visible effect) do NOT get entries.

## Documentation: every feature ships with its docs

We have strong product-level docs (README, STRUCTURE.md, changelog) but feature-level docs have drifted: half-built features land with no doc explaining what they are or how to use them. That stops now. **Documentation is part of the feature, not a follow-up.** A feature is not done until someone who didn't build it could find it, understand what it does, and use it from the docs alone.

Match the doc to the kind of work. Do every layer that applies, skip the ones that don't:

- **New page or public route** → add it to `data/pages.json` (path, title, description, `added` date). This feeds the sitemap, `llms.txt`, `features.json`, and the changelog automatically. This is the one mandatory step for anything user-reachable.
- **New SDK, package, worker, service, or top-level directory** → a `README.md` *in that directory* is required: what it does, how to install/use it, its public API/exports, and one runnable example. New package under `packages/*`, new `workers/<name>/`, new SDK: no exceptions. Coverage under `packages/`, `workers/`, and `services/` is 100%, every directory carrying a README, and it has stayed there while all three grew (the counts quoted here previously went stale within weeks, so verify rather than trust a number: `for d in packages workers services; do for x in $d/*/; do [ -f "$x/README.md" ] || echo "$x"; done; done` prints nothing when the standard holds). That is a standard to hold, not a stat to admire: the next directory that lands without one breaks it.
- **New product surface or directory** → add a row to `STRUCTURE.md` mapping it to its location and status. Nothing enforces this in CI, so it's on you. If you moved or graduated a surface, update its existing row.
- **New developer-facing capability** (API endpoint, MCP tool, protocol, integration, CLI) → add or update the relevant file in `docs/` (`docs/api-reference.md`, `docs/mcp.md`, `docs/tutorials/*`, etc.). Follow the format of the neighboring docs in that folder. A genuinely new subsystem gets its own `docs/<feature>.md` linked from `docs/start-here.md`.
- **New load-bearing contract or wire format** (manifest schema, on-chain interface, embed protocol, permission model) → write or update the spec in `specs/`. Specs are contracts other code depends on, not tutorials.
- **Always** → add the `data/changelog.json` entry per the Changelog section above. Use the `docs` tag when the change *is* documentation.

Rules:
- **Public, non-obvious surfaces get a doc.** Internal refactors, one-off scripts, and changes with no user- or developer-visible effect do not. Don't manufacture filler docs for them.
- **Write for the reader who has zero context.** No commit jargon, no "see the code." Explain the why, show a working example, link to related surfaces (`STRUCTURE.md`, the page, the spec).
- **Docs are real implementations too.** The no-mocks, no-placeholders, no-stubs rules apply. Every code sample must actually run. Every link must resolve to a live path. A deferred-docs marker in place of real documentation is a failed feature, not a doc.
- **Update, don't duplicate.** If a doc already covers the area, extend it. Read the neighboring docs before adding a new file so you match their structure and depth.
- **If you touched a feature and its existing docs are now wrong, fix them in the same change.** Stale docs are worse than none.
- **Verify with `npm run audit:docs` before claiming a docs task done.** It mechanically catches dead relative links, site links that match no route, commands naming a script that no longer exists, and `packages/*`/`workers/*` directories missing a README. Renaming, moving, or deleting a file is exactly when it earns its keep. It is not wired into the deploy path, so nothing runs it for you.

---
