# Site snapshots

A daily visual record of how every page on three.ws looks, so we can always see
what a page looked like before a drastic redesign.

## Capture a snapshot

```bash
node scripts/page-snapshot.mjs            # all public pages, desktop + mobile, against https://three.ws
node scripts/page-snapshot.mjs --desktop-only
node scripts/page-snapshot.mjs / /ibm /pay   # just a few routes
BASE_URL=http://localhost:3000 node scripts/page-snapshot.mjs   # snapshot a local build
```

or `npm run snapshot`.

Pages come from [`data/pages.json`](../pages.json), the same manifest that
drives `/sitemap`, `llms.txt`, and the page audit. Add a page there and it's
snapshotted automatically. Auth-gated pages are skipped unless named explicitly.

## How it's stored (and why)

Screenshots are written to **stable paths** under `current/` and overwritten on
every run:

```
current/
  index.html        ← open this: a browsable gallery of the latest set
  manifest.json     ← machine-readable index, stamped with the capture date
  desktop/<slug>.jpg
  mobile/<slug>.jpg
```

The **archive is git history**. Committing `data/snapshots/` each day captures that
day; the working tree stays at ~one day's size instead of growing forever.

- Browse today: open `current/index.html`
- A page's history: `git log --follow -- data/snapshots/current/desktop/home.jpg`
- Recover a past day: `scripts/snapshot-export-day.sh 2026-06-05`
  (writes `exported/<date>/` — gitignored, just for viewing)

## Daily run

The capture script is wired and tested. The daily trigger (GitHub Action cron or
a scheduled agent) is added separately once the output is confirmed.
