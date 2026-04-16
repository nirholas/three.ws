# Task 08 — E2E smoke test + findings report

## Why this exists

Tasks 01–07 ship the full flow. This one is the proof. Before we claim the band is done, an agent or human walks the whole thing end-to-end across every major paste surface, on desktop AND mobile, signed-in AND signed-out, with the worst-case models. Any failure becomes a new follow-up prompt — not a same-PR fix.

This prompt is a checklist, not a build. The deliverable is a report posted in the PR (or as a GitHub issue) with pass/fail for every row.

## Prerequisites

- Branches/PRs for tasks 01–07 are merged to `main`.
- `npm install && npm run build` succeeds locally.
- You have a signed-in account (or can register one: `/register`) and one signed-out browser profile (Incognito / Private).
- You have access to at least one paste surface per category below.

## Golden path (required — this must pass)

| # | Action | Expected | Pass/Fail |
|---|---|---|---|
| 1 | Load `http://localhost:3000` in Incognito | Default model loads, no editor folder (signed-out gates later) or editor visible with grayed-out publish — match task 01 decision | |
| 2 | Drag a ~2 MB `.glb` onto the page | Model loads, editor folder appears, `📤 publish as embed` present | |
| 3 | Change one material's base color via Material Editor | Color updates live in viewport | |
| 4 | Click `📤 publish as embed` | Modal opens, shows "Sign in to publish" (task 04) | |
| 5 | Click Sign in | Lands on `/login?next=…&resume=…&publish=1` | |
| 6 | Sign in | Lands back on `/`, same model re-loads, your color edit is still applied | |
| 7 | Publish modal auto-opens and runs through Export → Upload → Register → Widget steps | All four steps complete, result modal shows 3 snippets | |
| 8 | Click `Copy` on the iframe snippet, paste into `test.html` locally, open in browser | Avatar renders | |
| 9 | Click `Open` on the link row | `/w/<id>` opens in a new tab with the avatar | |
| 10 | Paste the `/w/<id>` link into a Slack channel | Unfurls with an OG card (task 07) | |
| 11 | Paste into a Notion page | Auto-embeds via oEmbed | |
| 12 | Return to `/`, change the color again, click Publish | Modal offers `Update` vs `Create new` (task 05) — `Update` is the default radio | |
| 13 | Click `Go` with Update | Result modal says "Updated ✓", same `/w/<id>` URL | |
| 14 | Reload the Slack message / Notion block (where possible) | New color is visible | |

## Edge cases (must be exercised; each becomes a follow-up prompt if it fails)

| # | Action | Expected | Pass/Fail | Follow-up prompt name |
|---|---|---|---|---|
| E1 | Drop a 30 MB glb | Modal shows `SizeTooLargeError` with plan cap (task 06) | | 09-size-error-copy.md |
| E2 | Load `#model=<cross-origin-CORS-blocked-url>`, edit, publish | `SourceFetchError` with the clear remediation copy (task 06) | | 09-cors-fallback.md |
| E3 | Publish anonymously-public widget, set `is_public: false` via Studio, re-paste | Unfurl shows "Private widget," no leak (task 07) | | 09-private-unfurl.md |
| E4 | Publish on `/` with kiosk mode on (`#kiosk=true`) | Editor + publish button are absent, no errors | | 09-kiosk-regression.md |
| E5 | Load `#widget=<someone-else's-public-widget>`, edit, publish → Update | Server returns 403; modal flips to Create new with friendly copy | | 09-foreign-widget-copy.md |
| E6 | Publish a widget whose GLB uses Draco + KTX2 compression | Export succeeds, published widget renders same as original | | 09-compressed-glb.md |
| E7 | Refresh page mid-upload (step 3 of the 4-step progress) | No orphan avatar row; re-publish works | | 09-upload-abort-cleanup.md |
| E8 | Two tabs publishing at once | Both succeed, no race on the slug generator | | 09-slug-race.md |

## Paste-surface matrix (must cover at least one per row)

For each surface, paste the `/w/<id>` URL and record unfurl behavior.

| Surface | Expected | Pass/Fail |
|---|---|---|
| Slack channel | Full OG card + iframe preview (Slack may expand the iframe in unfurl; may not — just the card is OK) | |
| Discord server | Embed with OG image + title + description | |
| X (Twitter) post | Summary-large-image card | |
| iMessage | Link preview with image | |
| WhatsApp | Same | |
| Notion page | oEmbed → auto-iframe | |
| WordPress post | oEmbed → auto-iframe | |
| Ghost post | oEmbed → auto-iframe | |
| Raw `<iframe src="…/w/<id>">` in a vanilla HTML file | Renders | |
| `<agent-3d src="…">` web-component snippet in a vanilla HTML file | Renders | |
| Claude.ai artifact (paste iframe snippet in a conversation with HTML rendering) | Renders | |
| LobeHub plugin slot | Renders | |
| **SperaxOS chat** | Either an iframe render (if they allow HTML) or an OG-style preview (if they only render links) | |

If SperaxOS doesn't render iframes and their link preview doesn't fire from oEmbed, file a follow-up (`09-sperax-preview-adapter.md`) describing the exact behavior you saw.

## Mobile

Run rows 1–10 above on at least one mobile browser (Safari iOS + Chrome Android ideally). GLB sizes should be smaller for mobile (you don't need a 30 MB file — 1 MB is enough). Report anything that differs from desktop.

## Report structure

At the end of this task, produce a single Markdown file `prompts/drop-edit-embed/SMOKE-REPORT.md` (or post as a GitHub issue and link). Include:

- Date, commit SHA, build number.
- Full filled-in tables above.
- A "Follow-up prompts to create" list for every failing row, each pointing at the suggested filename.
- Screenshots for each paste-surface unfurl (or note "couldn't test — why").

## Files you own

- Create: `prompts/drop-edit-embed/SMOKE-REPORT.md`
- Create: any `09-*.md` follow-up prompts that the smoke exposes.

## Files off-limits

- Everything else. This task does not fix bugs — it finds them.

## Reporting

Point the reviewer at `SMOKE-REPORT.md`. Summarize in the PR description: total rows passed / failed / skipped, and link the biggest follow-ups.
