# 05. Announcement automation

Read `docs/prompts/event-markets/README.md` first.

## The problem

A market that is not announced does not get picks. The announcement is the distribution: it tags the entrants, who then show their own audiences. Doing it by hand per event does not scale, and posting without the owner's approval is not allowed (gate 2).

## Build

Check for the contract in `api/_lib/event-markets/`. If absent, create the minimal seam from the README first. Read how existing announcement lanes work (`data/announce-priority.json`, `docs/` pages on announcements, the X posting policy from the account and social brief if it has landed) and reuse them.

1. `event_market_announcements` table: `market_id`, `kind` (`opened`, `locking_soon`, `odds_shift`, `resolved`), `draft_text`, `card_url`, `tags` (entrant handles), `status` (`draft`, `approved`, `posted`, `rejected`), `approved_by`, `posted_at`, `post_url`.
2. Drafter: `api/_lib/event-markets/announce.js` builds text per kind from live data. Opened: the question, the entrants tagged where we hold a verified handle for them, the link and card. Locking soon: current leader and odds. Odds shift: only when a defined threshold is crossed. Resolved: the winner, evidence link, top forecasters. Positive framing only, no fabricated claims, no price promises, no other-coin mentions.
3. Entrant handles come only from handles the entrant linked to their own profile. Never scrape or guess a handle. An entrant with no linked handle is named, not tagged.
4. Cron reads the outbox of `event_market.opened` and lifecycle changes and writes drafts. It never posts.
5. Admin review queue: approve, edit, reject. Approval of a batch is one action. The poster module is the single place that sends, and it refuses anything not `approved`.
6. Posting is owner-gated: wire the real poster through the account's existing X integration, but leave sending behind explicit approval and a feature flag that defaults off. Prepare everything so enabling it is one command, and say exactly what the owner must approve.
7. Rate limits and dedupe: one post per kind per market, with a daily cap.

## Docs and wiring

`docs/event-markets.md` section "Announcements", `STRUCTURE.md`, changelog entry tagged `feature`.

## Acceptance

- Open a market locally and see a correct draft with the card URL and tags only for linked handles.
- Approve one draft in the queue and show that the poster would send exactly that text (dry run output). Nothing is sent without approval.
- Tests cover each draft kind, the dedupe and the refusal to send unapproved drafts. `npm test` green.
