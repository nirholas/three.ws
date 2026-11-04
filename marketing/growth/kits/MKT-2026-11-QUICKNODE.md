# MKT-2026-11-QUICKNODE: how the production RPC path fails over without losing the user

**Kit status:** copy complete, verified 2026-09-17 and re-verified 2026-11-04 (table at the end). Not
blocked on engineering. campaigns.csv status `awaiting_outreach`: the spotlight email and field note are
ready and unsent, and the program contact's name is not recorded in the repo. One fact changed since the
copy was written: no Quicknode lane has been configured in production since 2026-10-08 (see "Quicknode
is no longer a live rung" below).

## At a glance

| Field | Value |
|---|---|
| Campaign id | `MKT-2026-11-QUICKNODE` |
| Publish date | 2026-11-17 |
| Summary | A candid field note: how a metered Quicknode reserve silently became the Solana RPC primary, and the four rules that now keep a multi-provider failover chain honest |
| Audience | Solana developers |
| Primary channel | Quicknode community or blog (Feature Friday or founder spotlight) |
| Secondary channels | X, GitHub Discussions, three.ws news |
| Proof | https://three.ws/docs/solana |
| Tracked links | X `https://three.ws/docs/solana?utm_source=x&utm_medium=social&utm_campaign=mkt-2026-11-quicknode&utm_content=anchor`; GitHub `...utm_source=github&utm_medium=community&...&utm_content=discussion`; partner email `...utm_source=quicknode&utm_medium=email&...&utm_content=field-note` |
| The single CTA | Read the field note and test the open implementation |
| Partner ask | Founder spotlight or co-authored technical post |
| KPI | doc reads, repo visits, and partner placement |

## Audit: what already exists

| Channel | Existing asset | State | How this kit uses it |
|---|---|---|---|
| Partner ask (primary route) | [marketing/partner-packets/quicknode-spotlight-ask.md](../../partner-packets/quicknode-spotlight-ask.md) | Ready | Is the partner message, with one refresh below |
| Field note | [marketing/partner-packets/quicknode-rpc-failover-field-note.md](../../partner-packets/quicknode-rpc-failover-field-note.md) | Ready; stale sentences corrected 2026-11-04 | Attachment and the source for every post |
| Program membership graphics | [marketing/quicknode/](../../quicknode/) | Exist | Not used; this is a technical beat, not a membership beat |
| Media | [partner-packets/images/docs-solana-failover.png](../../partner-packets/images/docs-solana-failover.png) | Exists | Anchor image |
| X, GitHub Discussions, news | none | Missing | Written below |

**Stale sentence, fixed 2026-11-04:** the field note said the recovery-probe change from commit
`ac1ba86ad` was "not yet deployed". That commit is an ancestor of the 2026-09-17 live commit `477eb6f8c`
and of the 2026-11-04 live commit `0a913e8a7`, so the note now says it was live in production by
2026-09-17.

**Quicknode is no longer a live rung (found 2026-11-04):** the Quicknode endpoint sat in
`SOLANA_RPC_LAST_RESORT_URLS` from revision `three-ws-api-00325-pc6` (2026-07-28) until revision
`three-ws-api-00477-grl` (2026-10-08), which removed it after the endpoint began refusing every TLS
handshake ([docs/ops/solana-rpc-lanes.md](../../../docs/ops/solana-rpc-lanes.md)). A `getHealth` call to
that endpoint still fails with `tlsv1 alert internal error` on 2026-11-04, and `SOLANA_RPC_URL`,
`QUICKNODE_RPC_URL` and `SOLANA_RPC_LAST_RESORT_URLS` are all unset on the service. The field note and
email now describe the reserve in the past tense. If the owner restores a working endpoint from the
program credits before sending, return them to the present tense and record the restore date.

## X

**Media:** `marketing/partner-packets/images/docs-solana-failover.png`.
**Alt text:** three.ws Solana docs explaining never to name the same endpoint as both primary and reserve,
followed by the cooldown table for failing RPC endpoints.

**Anchor** (170 weighted characters):

```text
We once set our metered @Quicknode reserve as the Solana RPC primary too. The chain keeps the first copy of a URL, so the reserve took every call: https://three.ws/docs/solana?utm_source=x&utm_medium=social&utm_campaign=mkt-2026-11-quicknode&utm_content=anchor
```

This is a correction lead (voice contract pattern 3). The tag is defensible: the Quicknode endpoint was
the production reserve from 2026-07-28 to 2026-10-08, and the post describes that past configuration. It
does not blame Quicknode; the misconfiguration was ours.

**Thread (optional):**

2/ (210)
```text
The fix was a rule, not code: a reserve URL appears in the reserve list and nowhere else. Then we sized the bench to the failure: 6h on quota, 30m on a bad key, 10m on a 429, 2m on a 5xx, 30s on a network blip.
```

3/ (192)
```text
A 403 is not always a bad key. Some providers refuse one call shape and serve the rest, so now only that method is demoted on that endpoint, for 15 minutes, instead of benching the whole lane.
```

4/
```text
When every lane fails, the last good answer for the same read is served with an x-solana-rpc-stale header carrying its age, instead of an error. The code: https://github.com/nirholas/three.ws/blob/main/api/_lib/solana/connection.js
```

## GitHub Discussions (category: Show and tell)

**Title:** Field note: running a Solana RPC failover chain in production

```text
We wrote up what running a multi-provider Solana RPC failover chain in production taught us, including the day our metered reserve quietly became the primary.

Four rules we now hold:
1. Dedupe order is policy. The chain keeps the first copy of a URL, so a reserve must appear in the reserve list and nowhere else.
2. Size the bench to the failure: 6 hours on quota exhaustion, 30 minutes on a bad key, 10 minutes on a 429, 2 minutes on a provider 5xx, 30 seconds on a network error.
3. A 403 can be one method, not the lane: demote that method on that endpoint for 15 minutes.
4. Breakers are fleet-wide, so a new instance inherits "this lane is out of quota" instead of paying to learn it.

Docs: https://three.ws/docs/solana?utm_source=github&utm_medium=community&utm_campaign=mkt-2026-11-quicknode&utm_content=discussion
Code: api/_lib/solana/connection.js

If you run more than one RPC provider, what cooldowns do you use, and what did you get wrong first?
```

## three.ws news blurb

We published a field note on how three.ws keeps Solana RPC calls alive across several providers, starting
with the misconfiguration that turned our metered reserve into the primary. It covers dedupe order,
cooldowns sized to each failure class, per-method demotion for call-shape errors, and fleet-wide breakers,
with links to the open code. Read it in the Solana docs: https://three.ws/docs/solana.

## Partner message

Send the email in [marketing/partner-packets/quicknode-spotlight-ask.md](../../partner-packets/quicknode-spotlight-ask.md)
as a reply in the existing Quicknode Startup Program thread, with the field note attached. Refresh before
sending:

1. Fill `[program contact first name]` and `[Owner name]` from the real thread; neither is in the repo.
2. Its two proposed Fridays were moved on 2026-11-04 from 2026-10-16 and 2026-10-23 (both passed) to
   2026-11-20 and 2026-12-04. Confirm both are free.
3. The stale "not yet deployed" sentence in the field note was fixed on 2026-11-04 (above).
4. Swap the docs link in the email for the tracked
   `https://three.ws/docs/solana?utm_source=quicknode&utm_medium=email&utm_campaign=mkt-2026-11-quicknode&utm_content=field-note`.

If no thread exists in the owner's inbox, the packet names the public routes:
`https://www.quicknode.com/contact-us` and the Quicknode Discord.

## T+7 result fields

| Field | Source |
|---|---|
| Doc reads | web analytics, `/docs/solana` sessions with `utm_campaign=mkt-2026-11-quicknode` |
| Repo visits | GitHub Insights traffic for the week |
| Discussion replies | the Show and tell thread |
| Partner placement | Feature Friday slot, blog post URL, or "no response" |

## Claims check

| Claim | Proof | Verified |
|---|---|---|
| Production named the metered reserve as primary until 2026-07-28; `-32003` daily cap | [docs/solana.md](../../../docs/solana.md) line 71 | 2026-09-17 |
| Chain dedupes by URL and keeps the first occurrence | same doc; `solanaRpcEndpoints()` in `api/_lib/solana/connection.js` | 2026-09-17 |
| Cooldowns 6h, 30m, 10m, 2m, 30s | `QUOTA_COOLDOWN_MS`, `AUTH_COOLDOWN_MS`, `RATE_LIMIT_COOLDOWN_MS`, `SERVER_COOLDOWN_MS`, `NETWORK_COOLDOWN_MS` in `connection.js` | 2026-09-17 |
| Per-method demotion for 15 minutes | `METHOD_DEMOTION_MS = 15 * 60_000` in `connection.js` | 2026-09-17 |
| Last good answer served with `x-solana-rpc-stale` | `serveLastGood()` in `connection.js` (line 361 on 2026-11-04) | 2026-09-17 |
| Fleet-wide breakers | field note source table; `rpcLaneHealth()` comment in `connection.js` | repo |
| Member of the Quicknode Startup Program; Quicknode is a rung, not the whole chain | [docs/partners.md](../../../docs/partners.md); no Quicknode lane configured in production since 2026-10-08 | repo |
| Recovery-probe commit `ac1ba86ad` is deployed | `git merge-base --is-ancestor ac1ba86ad 477eb6f8c` succeeds; `/api/version` commit `477eb6f8c` | 2026-09-17 |

Dropped: the point-in-time "all lanes cooling" health reading from 2026-09-16 (a snapshot, not a claim to
repeat publicly), and request volume through Quicknode (not measured in the repo).

## Owner does

Reply in the existing Quicknode Startup Program thread with the refreshed email and field note, then post
the X anchor with the docs image.

## Re-verification

Re-measured 2026-11-04. Run `node scripts/check-kit-links.mjs` on this kit and both partner packets again on
the send day; it exits 0 only when every link answers.

| Claim | Evidence command | Result on 2026-11-04 |
|---|---|---|
| Metered reserve was named as primary until 2026-07-28; `-32003` | `sed -n 71p docs/solana.md` | Holds |
| Dedupe keeps the first occurrence | `grep -n "dedupe(\[" api/_lib/solana/connection.js` and docs/solana.md line 71 | Holds |
| Cooldowns 6h, 30m, 10m, 2m, 30s | `grep -n "COOLDOWN_MS = " api/_lib/solana/connection.js` | Holds (lines 200 to 209) |
| Per-method demotion for 15 minutes | `grep -n "METHOD_DEMOTION_MS = " api/_lib/solana/connection.js` | Holds (line 400) |
| `x-solana-rpc-stale` last-good serve | `grep -n "function serveLastGood" api/_lib/solana/connection.js` | Holds; the line moved from about 340 to 361 (claims table updated) |
| Fleet-wide breakers | `grep -n "COOLDOWN_CACHE_KEY" api/_lib/solana/connection.js` | Holds |
| Quicknode endpoint is a real rung in the production chain | `gcloud run revisions list` and `gcloud run services describe three-ws-api`, host names only | **Stale, corrected.** No Quicknode lane since revision `three-ws-api-00477-grl` (2026-10-08); the removed endpoint still fails TLS |
| Recovery-probe commit deployed | `git merge-base --is-ancestor ac1ba86ad 0a913e8a7`; live commit from `curl -s https://three.ws/api/version` | Holds; field note sentence fixed |
| X anchor 170, post 2 210, post 3 192 weighted characters | URLs counted as 23 characters, every other character as 1 | 170, 210, 192 (unchanged) |
| Proposed Fridays | `date -d 2026-11-20 +%A; date -d 2026-12-04 +%A` | Both Friday; applied to the spotlight ask |
| Every link in this kit | `node scripts/check-kit-links.mjs marketing/growth/kits/MKT-2026-11-QUICKNODE.md` | 14 links, 0 dead |
