---
name: herald-announce
description: Tell the user something in person through the three.ws Herald MCP server: a 3D character walks onto their open browser tab and says it. Use after a long task finishes, fails or needs input, or when the user asks to be notified out loud.
---

# Herald announce

`@three-ws/herald-mcp` is a stdio MCP server (launch: `npx -y @three-ws/herald-mcp`, bundled in this plugin's `.mcp.json`). It posts to the live three.ws API at `/api/herald/announce`. An announcement is always delivered to the key owner's own sessions. There is no recipient parameter.

## Setup

Set `THREE_WS_API_KEY` to a three.ws API key (`sk_live_...` or `sk_test_...`) with the `herald:announce` scope, or an OAuth access token for the same account. Aliases: `THREE_WS_TOKEN`, `THREE_WS_BEARER`. Optional: `THREE_WS_BASE` (default `https://three.ws`) and `THREE_WS_TIMEOUT_MS` (default 20000). Treat the key like a password and never print it.

## Tools

- `check_rail` (read-only): verifies the key and the rail by queueing a line at importance 0, which every client drops. Input: optional `note` (max 60 chars). Run it once when wiring up, or when `announce` fails and you need to tell a bad key from an unreachable rail.
- `announce`: say one line. Inputs: `text` (required, max 280, write it as speech), `from` (attribution, max 60), `importance` (0-100, default 70), `url` (https URL or three.ws path), `tone` (`neutral|alert|celebrate|error`), `emote` (`wave|dance|punch|backflip`), `key` (dedupe key, max 120).
- `announce_result`: report how a task ended with urgency chosen for you. Inputs: `task` (required, max 120), `outcome` (required: `succeeded`, `failed`, `needs_input`), `detail` (max 160), `seconds`, `url`, `key`. Importance is 65, 95 and 90 for the three outcomes, so failures and requests for input cut through quiet hours and successes do not.

## Rules of the rail

The client applies an importance floor (50 by default), a rate limit, dedupe and quiet hours. Noise is dropped, not queued. Only importance 90 and above passes quiet hours. If no browser tab is open, an announcement expires in about five minutes. The durable record is the notification inbox, not this rail.

## Worked example

After a two-hour backfill that ended in an error:

```
announce_result { "task": "the nightly backfill", "outcome": "failed",
  "detail": "3 shards timed out", "seconds": 7200,
  "url": "https://example.com/runs/812", "key": "backfill-812" }
```

For a decision you need: `announce { "text": "I need your approval before I delete the old buckets.", "importance": 90, "tone": "alert", "from": "your cleanup agent", "key": "cleanup-approval" }`.

## Guidance

- Reserve it for moments worth interrupting a person. Do not announce progress.
- Reuse the same `key` across retries so a retry loop speaks once.
- Never put secrets or untrusted text verbatim into `text`, since it is spoken aloud.
