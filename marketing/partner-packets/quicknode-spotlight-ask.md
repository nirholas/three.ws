# Quicknode startup spotlight ask

**Target:** Quicknode Startup Program
**Program page:** https://www.quicknode.com/startup (the program text quoted below was read from
`/startup` on 2026-09-16 and is still there on 2026-11-04; the older `/startup-program` path now returns
404, so do not use it)
**Verified intake:** the program contact from the 2026-07 acceptance. The repo records acceptance and
approved credits ([docs/listings.md](../../docs/listings.md)) but **no contact name or email**. If none
exists in the owner's inbox, the public routes are https://www.quicknode.com/contact-us and the
Quicknode Discord.
**What the program publicly offers that fits:** "Join Feature Fridays to showcase your solutions",
"Present your vision at our events to an influential audience", and "partnership stages, from
Marketplace to Developer Relations" (program page, 2026-09-16). There is no published spotlight
application form.
**Deadline:** none published. The original pipeline target (2026-10-09) passed unsent; the November
kit ([MKT-2026-11-QUICKNODE](../growth/kits/MKT-2026-11-QUICKNODE.md)) schedules the send ahead of its
2026-11-17 publish date.
**Owner's one step:** reply in the existing Quicknode Startup Program thread with the email below and
attach the field note.

---

## The email

**Subject:** Feature Friday idea: what running Quicknode as a Solana failover reserve taught us

> Hi [program contact first name],
>
> three.ws joined the Quicknode Startup Program in July. We run a multi-provider Solana RPC failover
> chain in production for AI agent wallets, balance reads, and payment verification, and from July to
> early October Quicknode was the metered reserve at the end of it.
>
> We wrote up what we learned in one page, attached: why dedupe order silently turned our reserve into
> our primary until 2026-07-28, how long to bench a lane for each failure class, why a 403 is not always
> a bad key, and why breakers have to be fleet-wide. It includes what is still hard, not just what
> worked.
>
> Would the team consider it for a Feature Friday or a founder spotlight? We can present live, turn it
> into a co-authored post for your blog, or both. Two dates that work for us: Friday 2026-11-20 or
> Friday 2026-12-04. Code and docs are public: https://github.com/nirholas/three.ws and
> https://three.ws/docs/solana.
>
> Thanks,
> [Owner name]
> three.ws

Fill the two bracketed names from the real thread before sending; neither is recorded in the repo.

---

## Packet fields

**One-sentence pitch:** a startup-program member with a candid production write-up of running Quicknode
inside a multi-provider Solana failover chain.

**100-word abstract:** three.ws runs AI agent wallets, balance reads, and payment verification on
Solana through one priority-ordered RPC failover chain, with a Quicknode endpoint as its metered
reserve from July to October 2026. The field note covers four production lessons: dedupe order turned
the reserve into the primary until July 28 and exhausted its daily cap; lanes are benched from 30
seconds to 6 hours by failure class; a call-shape 403 now demotes one method instead of a whole lane;
and cooldowns are shared across the Cloud Run fleet. It closes with what failover cannot fix: capacity,
the conversation this spotlight starts.

**Working link:** https://three.ws/docs/solana (200 on 2026-09-16 and on 2026-11-04)

**Screenshot:** [images/docs-solana-failover.png](images/docs-solana-failover.png), captured 2026-09-16.
Alt text: "three.ws Solana docs explaining never to name the same endpoint as both primary and reserve,
followed by the cooldown table for failing RPC endpoints."

**Founder bio:** not recorded in the repo; add two lines under the signature if Quicknode asks.

**Two proposed dates:** Friday **2026-11-20** or Friday **2026-12-04** (proposals, nothing booked; both
are Fridays after the 2026-11-17 kit date and replace the original 2026-10-16 and 2026-10-23, which have
passed; confirm both are free before sending).

**Requested action:** consider three.ws for a Feature Friday session or a founder spotlight, with the
field note as the technical basis.

**Approved relationship wording** (from [docs/partners.md](../../docs/partners.md) and
[docs/listings.md](../../docs/listings.md)): three.ws is a **member of the Quicknode Startup Program**,
accepted 2026-07, with approved infrastructure credits. Quicknode is **a rung in the Solana RPC
failover chain, not the whole chain** (the chain keeps a Quicknode slot; no Quicknode lane has been
configured in production since 2026-10-08, see the re-verification table). The `/partners` "Infrastructure" chip is a grouping three.ws
chose, not a Quicknode tier. Quicknode styles its own name "Quicknode" on its site.

## Metrics used

| Metric | Value | Source | Captured |
|---|---|---|---|
| Program status | Accepted 2026-07, credits approved | docs/listings.md | repo |
| Quicknode position in production chain | Reserve (`SOLANA_RPC_LAST_RESORT_URLS`) | Cloud Run service env, host name only | 2026-09-16 |
| Quicknode position in production chain | None: removed from `SOLANA_RPC_LAST_RESORT_URLS` in revision `three-ws-api-00477-grl` (2026-10-08) after the endpoint began refusing TLS | Cloud Run revision history and service env, host name only | 2026-11-04 |
| RPC lane health at capture | 3 of 3 paid lanes and 9 of 9 lanes cooling | `https://three.ws/api/healthz` | 2026-09-16T16:01Z |
| RPC lane health at capture | 2 of 2 paid lanes and 8 of 8 lanes cooling (point-in-time) | `https://three.ws/api/healthz`, `rpc_lanes` | 2026-11-04 |
| RPC request volume through Quicknode | **Not measured here.** Quicknode's own dashboard is the source; the repo keeps no per-lane request count | n/a | n/a |

## Re-verification

Re-measured 2026-11-04. Secrets were never printed: env values were reduced to "set or unset" and to host names.

| Claim | Evidence command | Result on 2026-11-04 |
|---|---|---|
| Program page `https://www.quicknode.com/startup` | `curl -s -o /dev/null -w "%{http_code}" -L https://www.quicknode.com/startup` | 200 |
| `/startup-program` also answers 200 | same command on the `/startup-program` path of the same host | **Stale, corrected.** 404; removed from the header |
| The three quoted program phrases | `curl -sL https://www.quicknode.com/startup \| grep -o "Feature Fridays\|Present your vision\|partnership stages"` | All three present, wording unchanged |
| Accepted 2026-07, credits approved | `grep -n -i quicknode docs/listings.md` | Holds, docs/listings.md line 30 |
| Relationship wording: member, a rung not the whole chain, "Infrastructure" chip is ours | `grep -n -i "rung\|groupings three.ws chose" docs/partners.md` | Holds, docs/partners.md lines 147 and 156 |
| Quicknode is the production reserve | `gcloud run revisions list --service three-ws-api --region us-central1 --format=json`, host names only | **Stale, corrected.** Removed in revision `three-ws-api-00477-grl` on 2026-10-08; email and abstract now use the past tense |
| Proposed dates 2026-10-16 and 2026-10-23 | `date -d 2026-11-20 +%A; date -d 2026-12-04 +%A` | **Stale, corrected.** Both had passed; replaced with Fridays 2026-11-20 and 2026-12-04 |
| Pipeline target 2026-10-09 | `grep -n QUICKNODE marketing/growth/campaigns.csv` | **Stale, corrected.** Passed unsent; the November kit (publish 2026-11-17) now carries the send |
| Lane health metric | `curl -s https://three.ws/api/healthz`, `rpc_lanes` | 2026-09-16 row kept as dated; 2026-11-04 row added: 2 of 2 paid, 8 of 8 lanes cooling |
| 100-word abstract | word count of the abstract paragraph | 100 words |
| Screenshot exists | `ls marketing/partner-packets/images/docs-solana-failover.png` | Present, 205,429 bytes |
| Every link in this file | `node scripts/check-kit-links.mjs marketing/partner-packets/quicknode-spotlight-ask.md` | 9 links, 0 dead |
