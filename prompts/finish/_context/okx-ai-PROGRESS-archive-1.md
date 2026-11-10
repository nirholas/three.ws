# okx-ai-PROGRESS, archive 1 (2026-09-09 to 2026-09-09)

Older entries moved verbatim out of [okx-ai-PROGRESS.md](okx-ai-PROGRESS.md) on 2026-11-10 so every file stays under the 50,000-character limit. Read-only record: append new entries to [okx-ai-PROGRESS.md](okx-ai-PROGRESS.md), never here.

## 2026-09-09 20:00 UTC, WO-07 closing audit, second pass: two defects found by re-running the gates, both fixed

A second independent WO-07 audit, run against production the same day as the one below it and
trusting none of its readings. **Every claim in that entry that could be re-tested survived**,
with one arithmetic correction. The value of the pass is what re-running the gates turned up
rather than what it confirmed: two real defects, one in a public endpoint and one in the gate
that was supposed to answer the rejection, plus one stale doc promise.

### Re-verified independently, today

| Claim | How it was re-tested | Verdict |
| --- | --- | --- |
| 402 spec-valid on the cheapest and the flagship row | raw `curl -i`, decoded `PAYMENT-REQUIRED` | PASS, `x402Version 2`, `accepts[0]` = `exact` / `eip155:196` / USD₮0 / `payTo 0x4022de2D…f402` / 10000 and 250000 |
| OKX's own validator | `agent x402-check`, four rows | `valid: true`, `amountMinimal` 10000 / 50000 / 250000 / 250000 |
| Reviewer probe shapes | `scripts/okx-compliance-probe.mjs` | `PASS 20 probes` |
| Signed authorization accepted | `scripts/okx-payment-leg-probe.mjs` | `PASS 4 paid rows`, each stopped only at `insufficient_balance`, nothing spent |
| Adversarial protections | `okx-e2e-gauntlet.mjs --no-spend` (the peer's new flag, on the fixed script) | 5/5 exercised PASS, 9 SKIP for want of a funded buyer, 0 settlements |
| Free lane honest | `catalog` 200 (7 rows), `health` 200 (6 subsystems ok), four paid rows 402 with MCP headers, `forge-status` GET 405 | PASS |
| Product delivers | free-lane job `1bf45ddd-9b12-476d-8ade-95ae192e90e1` on `trellis_selfhost` reached `done` on the first poll; `okx-verify-glb.mjs` reads glTF v2, 1,461,464 bytes, 8,413 vertices, 12,568 triangles | PASS |
| Doc examples run | `docs/okx-marketplace.md`'s own curls: `catalog` 200, `health` 200, `forge-standard` unpaid 402, `forge-status` on a real job returns exactly the documented `done` key set | PASS |
| Identity Studio matches its doc | `/agent-identities` 200, `/api/agent-identities` `count 4 ready 4`, ledgerlynx `rigged: true, joints: 52`, `create_identity` named identically in doc, catalog module and API | PASS |
| Module == live == submission | `npm run okx:three-copy` | PASS on the three local copies |
| What OKX stores | same run, on-chain copy | **FAIL, 7 divergences, unchanged.** Two-part descriptions stored against four-part generated |
| Listing state | `agent get-my-agents` | `approvalDisplayStatus 5`, `Listing rejected`, `status 2`, `soldCount 2` |
| Audit-address instruction honoured | grep of the whole payment path | one hit, a comment. No per-address branch exists |
| OKX unit suites | six files (`okx-402-dialect`, `okx-3d-services`, `okx-identity-studio`, `okx-forge`, `okx-xlayer-verify`, `okx-chat-bot`) | 201 passed |
| Whole API surface | `npx vitest run tests/api/` | 522 files, 7,735 passed, 0 failed |
| Docs | `npm run audit:docs` | clean, 1,595 files |
| Changelog | `npm run build:pages` | exit 0, 928 pages, entry validated |
| Chat bot | `/api/healthz` | still `degraded`, Vertex `Lightning dunning decision is deny`. Owner action, unchanged |

### Defect 1: the free health lane called the rail settleable without checking it could settle

`/api/okx/3d/health` reported `settleable` straight out of `xlayerSettleable()`, which answers
"is a payTo, an asset and a route configured". With no OKX facilitator credentials that route
is the relayer, which redeems the buyer's EIP-3009 authorization and pays the X Layer gas
itself, so a relayer with an empty OKB balance would have turned a collected payment into a
502 after the buyer had committed, while the free page a buyer checks first read green.
`xlayerRailHealth()` was already measuring that balance and the handler dropped the field.

The `payment-rail` row now carries `relayer_funded` and fails the subsystem when nothing can
settle, which is the same never-402-then-502 rule the challenge gate enforces. Two cases in
`tests/api/okx-identity-studio.test.js` pin both directions. Commit `4e9ad0419`. It needs a
deploy to reach production; the reading it would report today is green either way.

Measured on-chain at block 70213511, and this is why the field is worth having: the relayer
`0xe81DE501…415B` holds **0.020 OKB at a 0.021 gwei gas price, about 7,900 settlements**, and
its nonce is still 0, so it has never broadcast one. Buyer `0x75d0…cf69` 0 USD₮0 / 0 OKB
(23-byte `0xef0100…` delegation), seller `0x4022de2D…f402` 2.427731 USD₮0 / 0.839596 OKB, OKX
audit `0xbc59eb75…2033` 19.547973 USD₮0, down another 110 atomics since this morning's
19.548083, so their QA agent is still buying from other sellers on this rail.

### Defect 2: the gate that answers "quotation cannot be parsed" was reading with our parser

The rejection's internal note is a verdict from OKX's parser: *"x402 quotation cannot be parsed
or is non-compliant (parsing failed / no exact / missing amount), and has not entered the
payment stage"*. Every gate we had reads the challenge with our own code, which cannot answer
it. `@okxweb3/app-x402-core` is already a declared dependency of this repo and exports the
seller SDK's own `parsePaymentRequired`.

`scripts/okx-compliance-probe.mjs` now reads every 402 back with it, on both copies: the
`PAYMENT-REQUIRED` header (where OKX's own resource server puts the challenge) and the body.
**All 20 probes across the four paid rows report `parsed` on both**, so the note is not
reproducible against production today. Capture:
`prompts/okx-ai/e2e-evidence/102-2026-09-09-okx-sdk-schema-read.json`. Commit `6b757caee`.

A trap worth carrying: `parsePaymentRequired` is a zod SAFE parse. It returns
`{ success, error }` and never throws, so the first version of this check (a `try`/`catch`)
passed `{}` as green. The verdict reads `result.success` and reports the failing field paths.

### The correction: the remark's "4109 characters" is a counting artifact

The entry below identifies rejection #3's `approvalRemark` by a 4109-character length. Python
reads 4101 on the same string: the remark carries CJK bracket and emoji code points, so
JavaScript's UTF-16 `.length` and Python's code-point `len()` differ by 8 on identical bytes.
`get-my-agents` and `service-list` return byte-identical text. The RUNBOOK now identifies it by
sha256 `c30676a2b95d7c84a9fb26e48b3ff07798664d9d3eb42873d956b1070c9fff0d` instead, with the
command to re-derive it, so a future session cannot read a counting difference as a new verdict.

### One stale doc promise, corrected

`specs/okx-agent-payments.md` still said the v2 header-name fix "Ships on the next deploy". It
shipped: an unpaid `POST /api/okx/3d/forge-draft` answers with `error` =
`"PAYMENT-SIGNATURE header is required (X-PAYMENT is also accepted)"`, read off production
today. A spec that promises what the code already does is the same defect class as one that
promises what it does not.

### RUNBOOK: every command in it was executed

§1's `get-my-agents` one-liner (`Listing rejected | status not listed | sold 2`), §2's
`service-list`, §3's balance reads, §4.2's buyer search parser (10 rows, `#11167 #2023 #6023
#6087 #9626 #6732 #6731 #2135 #9976 #4543`, none of them us, correct while `status` is "not
listed"), §5.1's remark one-liner, §5.5's five gates, §7's probe loop (four 402s and the 405).
All ran as written. The three edits above are the only drift found.

### Launch branch executed: REJECTED, so nothing was announced

`approvalLabel` reads `Listing rejected` and has not moved, so §4's approved branch does not
apply and no listing changelog entry was written. §5's rejected branch was executed: the remark
is captured verbatim in the entries below and re-read today, and it maps to three things. Two
are code and both are fixed and live (the 402 quotation shape, and the EIP-7702 signature
refusal). The third is the stored descriptions, which is an on-chain write.

**Nothing in code remains to fix for this rejection**, and the case is now made with OKX's own
reader rather than ours.

### The audit of the audit: the health fix shipped with a defect of its own

The `completionist` subagent was run over the three commits and caught something this session
had not. `xlayerRailHealth()` sets `relayer = { configured: true, error }` with **no `funded`
key** when the balance read throws, and the first version of the fix read
`relayer.funded === true`, which collapses "unreadable" into "empty". A public endpoint would
have answered `503` with a confident `out of gas (OKB balance 0)` for an account whose balance
nobody had actually seen, and dropped the read error entirely.

Three states are now kept apart (funded / measured zero / unreadable), the unreadable case
carries its own message plus `relayer_error`, and a third test case covers the throwing read
(`20a1a249d`). Two lessons worth keeping: a boolean derived from an optional field is a lie
whenever the field is absent, and this class of defect survived a green suite because both new
cases exercised readings that succeeded.

The same audit found two documentation gaps in the same work, both closed in that commit.
`relayer_funded` is a developer-visible field on the endpoint the new changelog entry links to,
so `docs/okx-marketplace.md` now documents the whole `payment-rail` row and the 503. And the
RUNBOOK note pinned itself to "live on the next deploy", which is the exact rotting
construction this pass had just deleted from `specs/okx-agent-payments.md`; it now names the
commits and gives the field to curl for.

`tests/api/` re-run after all of it: 522 files, 7,736 passed, 0 failed.

### The owner actions, unchanged

1. **Approve the resubmission** (two on-chain writes, delta first, RUNBOOK §5.5). Wallet
   session is live, so no OTP is pending.
2. **Fund the buyer** `0x75d00a2713565171f33216e5aa2a375e076ecf69` with >=$3 USD₮0 on X Layer
   for the first settlement. Does not gate the resubmission; it gates case 5a, 2, 3, 4, 6 and 7
   of the gauntlet, which is every case that is still SKIP.
3. **Clear the GCP billing hold**, so the marketplace chat bot can author replies.

One deploy is owed and is not owner-gated work: `4e9ad0419` (health) and the AI-lane chain the
entry below names are both committed and neither is live.

---

## 2026-09-09 19:45 UTC, backlog-08: the last local footgun is closed, after it went off

Fourth session on the chat host today. The state it inherited was correct and unchanged, so
this entry is not another re-measurement: it is the one thing left that an agent could still
do, found by running the work order's own instructions and watching them cause the failure
they were written before.

### Re-measured first, from the heartbeat row (no `gcloud`, still expired here)

| Read | Value at 19:35 UTC |
|---|---|
| Host | `cloudrun:okx-chat-bot (okx-chat-bot-00001-926)`, `hostDurable: true`, boot 2026-09-05T00:33Z (4.8 days) |
| Beat | 13 s old |
| Delivery | `loggedIn: true`, `agentCount: 1`, `activeClients: 1`, `daemonRestarts: 0` |
| Reply lane | `providerVerdict: unauthorized`, `providerTransport: vertex` |
| Serving revision | still predates `ad723e87f`: the beat carries no `providerLane` or `providerChain` key |

Unchanged from the entry below it, five hours later. Both owner actions still stand.

### The incident: the work order's first instruction starts a second writer

`prompts/finish/907-...md` opened with **"Immediate revive (do this first, it takes one
command): `npm run okx:bot`"**, written when the codespace WAS the host. Running it today,
to verify the definition-of-done line that names it, did exactly what the deployed host's
`--max-instances=1` exists to prevent: it installed the CLIs, started a local daemon
(`pid=54287`), installed a systemd autostart unit, and came up
`agentCount=1 activeClients=1` against the same XMTP inbox and the same wallet keyring
Cloud Run owns.

Stopped three minutes later (`okx-a2a daemon stop`, autostart unit deleted). The deployed
host never missed a beat: `daemonRestarts: 0` and `activeClients: 1` before, during and
after, re-read at 19:42. Nothing was seeded to GCS, so the shared state object was never
written from here. No harm; the point is that nothing except the operator's memory stood
between that command and a torn identity, and a torn identity costs a human email OTP.

### Closed mechanically, not with a warning

`scripts/lib/okx-bot-host-guard.mjs` is a pure classifier plus one credential-free read,
and `scripts/okx-bot-revive.mjs` now runs it before it installs or starts anything.
Fail-open on ignorance, fail-closed on evidence:

| Health endpoint says | Verdict |
|---|---|
| unreachable | allowed, with a warning: an emergency revive must not require the internet |
| `no heartbeat reported yet` | allowed, nothing has ever hosted this bot |
| `down`, heartbeat stale | allowed, this is the emergency the script exists for |
| a beat whose host is this machine | allowed, re-staging where the daemon already runs adds no writer |
| a beat from another host | refused, exit 3, `--force` to override |
| a beat naming no host | refused |

That last row is not hypothetical, and getting it wrong is what let the daemon start: the
first cut of the guard read "degraded, no host named" as an all-clear, and production's API
build predates the `host` field, so that is exactly what it answered. Not knowing WHICH
machine is serving chat is not a licence to add a second one. Verified against live
production after the fix: `node scripts/okx-bot-revive.mjs` now exits 3 with
`REFUSED: the bot reports degraded, so a host is serving agent #2632, but the health
endpoint does not name it`, and installs nothing.

The read is `GET /api/healthz` and nothing else, deliberately: no `DATABASE_URL`, no
`gcloud`, no secret, because the machine most likely to run this by mistake is a fresh
clone with none of them. To make that read exact,
`classifyOkxChatBotBeat()` now puts `host` and `hostDurable` on the `okx_chat_bot`
subsystem as fields rather than only inside an English sentence (additive, `null` for a
beat that predates them).

### Verified

- `tests/okx-chat-bot.test.js`: **84 pass** (13 new: seven guard verdicts, two on the
  non-throwing fetch, four on the new subsystem fields).
- `tests/subsystem-health.test.js` + `tests/api/uptime-status.test.js`: 32 pass, so the
  additive fields broke no existing consumer.
- The guard's refusal was exercised against the live endpoint, not a fixture.

### Also fixed

`prompts/finish/907-backlog-08-okx-chat-bot-always-on.md` no longer opens with the
instruction that caused this. It now leads with "do NOT start a local daemon", carries the
measured state, and its definition-of-done lines carry per-line verdicts instead of empty
boxes. The peer session below left that file alone on the understanding that every order in
`prompts/finish/` had been retired; the retirement never landed on disk, the files are
still tracked at HEAD, and the owner handed this one to a session today. A work order that
still exists is still an instruction.

### What is left, and who owns it

Unchanged, and both owner-gated: fund one AI lane (clearing the GCP billing hold fixes the
platform's Vertex anchor too), and deploy `workers/okx-chat-bot/cloudbuild.yaml` so the
elected-lane chain is actually running. Nothing else in this order is engineering.

## 2026-09-09, WO-07 closing audit: everything re-verified from scratch, and the one blocker is unchanged

The last WO-07 session ran this morning; this one trusted none of it and re-measured every
claim against production and against the chain. **Every claim in the entries below that this
session could re-test survived re-verification.** The findings here are the two that did not,
both in the RUNBOOK, plus a broken test outside this stream that was blocking a green suite.

The owner retired all 30 work orders in `prompts/finish/` mid-session
(`_context/00-RETIRED-BY-OWNER.md`), including this one, so this log and the RUNBOOK are now
the only homes for the stream's state.

### Re-verified today, independently

| Claim | How it was re-tested | Verdict |
| --- | --- | --- |
| 402 is spec-valid on the cheapest and the flagship row | raw `curl` on `forge-draft` + `forge-hd`, decoded the `PAYMENT-REQUIRED` header | PASS, `x402Version 2`, `accepts[0]` = `exact` / `eip155:196` / USD₮0 / `payTo 0x4022de2D...f402` / 10000 and 250000 |
| OKX's own validator accepts all four paid rows | `onchainos agent x402-check`, four rows | `valid: true` on all four, `amountMinimal` 10000 / 50000 / 250000 / 250000 |
| Compliance across the reviewer's probe shapes | `scripts/okx-compliance-probe.mjs` | `PASS 20 probes` |
| A real TEE-signed authorization is accepted | `scripts/okx-payment-leg-probe.mjs` | `PASS 4 paid rows`, each stopped only at `insufficient_balance`, nothing spent |
| Replay and adversarial protection | `okx-e2e-gauntlet.mjs --yes --only 1,1d,5b,5c,5d` | 5/5 PASS, 0 settlements. 5b dies at `signed payment amount 10000 is below required 250000`; 5c is refused with a fresh challenge naming expiry; 5d answers 402 on all four garbage headers |
| Free lane honest | `GET /catalog` 200 (7 rows), `GET /health` 200 with six subsystems `ok` and `settleable: true` at block 70196469, `forge-status` GET 405, four paid rows 402 with the MCP headers sent | PASS |
| Product actually delivers | free-lane job `f82a43b8-34e9-46c9-bab9-e9fbff5e4c6d` on `trellis_selfhost` reached `done` with a real GLB; `scripts/okx-verify-glb.mjs` reads glTF v2, 1,646,228 bytes, 7,919 vertices, 12,262 triangles | PASS |
| The delivery outage cleared | `forge_creations`: 170 `done` rows in 24 h, and in the last 6 h 26 done on `trellis_selfhost` against 1 failure, versus 44 of 91 failing when it was first found | PASS |
| Module == live == submission | `npm run okx:three-copy` local three copies | PASS |
| What OKX stores | same run, on-chain copy read from `agent service-list` | **FAIL, 7 divergences, unchanged.** All seven stored descriptions still carry two parts where the module emits four |
| Listing state | `agent get-my-agents` | `approvalDisplayStatus 5`, `Listing rejected`, `status 2`, `soldCount 2`, `approvalRemark` 4109 chars, byte-identical to rejection #3 |
| Reviews | `agent feedback-list --agent-id 2632` | `total: 0` |
| Every OKX unit suite | `okx-forge` + `okx-xlayer-verify` + `okx-3d-services` + `okx-identity-studio` + `okx-chat-bot` | 197 passed |
| Docs | `npm run audit:docs` | clean, 1590 files |
| Changelog well-formed | `npm run build:pages` | exit 0, 926 pages, entries validated |

### The listing's stored copy, re-confirmed against OKX's own contract

`onchainos agent update --help` was read directly rather than quoted from this log. It states
that an A2MCP `serviceDescription` is four newline-separated parts (what it does / parameter
spec / request method / a working `curl`) and that **"an A2MCP listing missing any is rejected
at listing QA"**. The seven rows OKX stores carry two. The delta that fixes it was generated and
inspected end to end this session: seven `update` operations carrying the existing service ids
39975 to 39981, four parts each, 255 to 673 characters (OKX's cap is 2000 half-width), correct
`serviceType`, `fee` and `endpoint`, no `subscription` key. **Every one of the seven `curl`
examples the delta would publish was executed against production**: the four paid rows answer
402 and the three free rows answer 200, so a reviewer running the listing's own example gets
the documented result.

### The rejection remark's other instruction, checked in code rather than assumed

The remark asks that verification logic not intercept OKX's audit address
`0xbc59eb75C55e3bF1E63aaeE653C2b8E02BFd2033`. Grepped the whole payment path
(`x402-xlayer-okx.js`, `_mcp/payments.js`, `okx/3d/[service].js`): the address appears exactly
once, in a comment explaining the EIP-7702 root cause. **There is no per-address allow, deny or
branch anywhere in the payment path**, so that instruction is satisfied by construction.

### Wallets, read direct from X Layer at block 70197447

| Wallet | USD₮0 | OKB | Code |
| --- | --- | --- | --- |
| buyer `0x75d0…cf69` | 0.000000 | 0.000000 | 23 B `0xef0100…` (EIP-7702 delegated) |
| seller / payTo `0x4022de2D…f402` | 2.427731 | 0.839596 | EOA |
| relayer `0xe81DE501…415B` | 0.000000 | 0.020000 | EOA |
| OKX audit `0xbc59eb75…2033` | 19.548083 | 0.000000 | 23 B `0xef0100…` (EIP-7702 delegated) |

Two things worth carrying forward. The buyer and OKX's audit wallet have the *same* delegated
shape, so the `eip3009SignatureIsValid()` fix is being exercised by exactly the wallet class the
reviewer pays from. And the audit wallet has spent 2,130 atomics since the 2026-09-04 reading
(19.550213 to 19.548083), so OKX's QA agent is actively paying other sellers on this rail; its
test is a real purchase, not a dry run.

### RUNBOOK drift found by running it, and fixed

1. **§1 quoted a stale status line as if current.** It ended with "Verified 2026-09-02:
   `Listing under review | status not listed | sold 2`". Running the command today prints
   `Listing rejected`. Rewritten to give both readings with their dates and to say plainly that
   the older one is not the current state.
2. **§4.2's buyer search could not work as written.** Results live at `data.table.rows`, not at
   `data`, so the obvious one-liner prints `0` on a healthy response and reads as "we are
   invisible". The section now carries a working parser, the row shape, and today's readings:
   `"3D avatar rigging GLB"` and `"text to 3D model GLB generation"` both return the same 10
   rows, the marketplace's top sellers by `soldCount` (#11167 with 3304 sales, #2023 with 1374,
   #6023 with 1061), none of them 3D, so relevance is not applied to those queries today, while
   `"3D model avatar rendering game asset"` returns 1 real match (#6731 Agent Reel, 576 sales).
   Agent 2632 was absent from all three, which is correct while `status` is "not listed".

Also worth recording against the CONTEXT file's competitive section, which warns it has gone
stale once: it has gone stale again. The 2026-09-02 reading of 112 results for the third query
is 1 today.

### One test fixed outside this stream, because it blocked a green suite

`tests/sitemap-type.test.js` asserted the core sitemap always advertises `xmlns:xhtml`. Commit
`95c190180` held `public/locales/manifest.json` back to English alone, and `alternatesFor()`
returns no alternates below two locales, so the handler correctly stops emitting the namespace.
The code was right and the test pinned one side of that switch. It now reads the same manifest
the handler reads and asserts the relationship, so it holds in both worlds.

Full suite after that fix: **29,374 passed, 3 failed**, none of them this stream's and none of
them code defects:

- `tests/audit-guards.test.js` and `tests/guard-wiring.test.js` want registry rows for
  `check:home-matrix`, `i18n:home` (added to `gate` by `91893eb2d`) and
  `check:windows-widget:live` (`23ea927b7`). Every `data/guards.json` entry must carry a proof
  fixture the auditor actually applies, and `guard-wiring.md` wants a measured runtime; writing
  either for another lane's guard would be inventing evidence. Both lanes have `data/guards.json`
  and `docs/guards.md` open in the working tree right now, so they are mid-fix.
- `tests/multiplayer-server-boot.test.js` failed only under a concurrent peer vitest run and
  passes 13/13 in isolation. Port contention, not a defect.

### Launch branch executed: REJECTED, so no announcement

`approvalLabel` reads `Listing rejected` and has not moved, so the approved branch (§4: confirm
activation, changelog entry, buyer search) does not apply and no changelog entry was written.
The rejected branch (§5) was executed: the remark is captured verbatim above and in the entries
below, and it maps to two things, both already fixed in code and live (the 402 quotation shape
and the EIP-7702 signature refusal) plus one that is not (the stored descriptions). Nothing in
code remains to fix for this rejection.

### The three owner actions, unchanged and each a single step

1. **Approve the resubmission.** Two on-chain writes, in this order. The delta was regenerated
   and validated this session; the wallet session is live, so no OTP is pending.

   ```bash
   onchainos agent service-list --agent-id 2632 \
     | node scripts/okx-listing-payload.mjs --delta > /tmp/okx-2632-delta.json
   onchainos agent update --agent-id 2632 --service "$(cat /tmp/okx-2632-delta.json)"
   onchainos agent activate --agent-id 2632 --preferred-language en-US
   ```

2. **Fund the buyer** `0x75d00a2713565171f33216e5aa2a375e076ecf69` with >=$3 USD₮0
   (`0x779ded0c9e1022225f8e0630b35a9b54be713736`) on X Layer / 196, for the first real
   settlement. No OKB needed; the relayer pays gas. This does NOT gate the resubmission.
3. **Clear the GCP billing hold** on `aerial-vehicle-466722-p5`. `/api/healthz` still reads
   `okx_chat_bot: degraded`, "chat is delivered but the AI provider refuses this host's
   credential", so a reviewer who chat-tests the listing gets silence.

---

## 2026-09-09, backlog-08 re-verified with no `gcloud`: the host is unchanged, the lane chain is committed but has never shipped

Independent re-measurement of the chat-bot work order a few hours after the entry below it,
by a session that could not use `gcloud` at all: the workspace's user credential and its ADC
both answer `Reauthentication failed. cannot prompt during non-interactive execution`, and a
peer session recorded the same block on an unrelated read (`6e45a8b42`). So none of the
`gcloud run services describe` reads that earlier entries lean on were available here.

**That turned out not to matter, and the substitute path is worth keeping.** Everything the
work order asks about is readable without a Google credential:

| Read | Command | Value, 2026-09-09 14:48 UTC |
|---|---|---|
| Host identity and uptime | `SELECT meta FROM bot_heartbeat WHERE worker='okx-chat-bot'` | `cloudrun:okx-chat-bot (okx-chat-bot-00001-926)`, `hostDurable: true`, `bootAt 2026-09-05T00:33Z` |
| Beat freshness | same row's `last_beat_at` | 17 s old |
| Delivery | same row | `loggedIn: true`, `activeClients: 1`, `agentCount: 1`, `daemonRestarts: 0` |
| Reply lane | same row | `providerVerdict: unauthorized`, probed 2 min earlier |
| Platform view | `curl -s https://three.ws/api/healthz` | `okx_chat_bot` degraded, quoting the dunning 403 |
| Alerting | `SELECT ... FROM ops_alerts WHERE title ILIKE '%OKX%'` | the worker's own alert at `x22` since 2026-09-04, plus an hourly re-escalation row from `uptime-check` |
| Service exists | `curl https://okx-chat-bot-93741856042.us-central1.run.app/readyz` | `403` (the service is there; only the identity token was missing) |

### The finding: the running revision predates the AI-lane chain

`ad723e87f` (committed 14:06 today) gave the worker an ordered provider chain, and
`heartbeat()` in that code writes `providerLane` and `providerChain` into the beat. **The live
beat carries neither key**, and both would serialize even when empty (`null` and `[]`). So the
revision serving today is the single-lane 2026-09-04 build: it is pinned to Vertex, and it
cannot pick up a funded lane even if the owner funds one. The chain exists only in git.

That makes the deploy the load-bearing half of the handoff, not a formality. It also gives
future sessions a way to tell which code a Cloud Run worker is running without `gcloud`:
**diff the heartbeat meta's key set against `heartbeat()` in the tree.**

### The block is platform-wide, not OKX-specific

`ops_alerts` says so in the platform's own words, no probing needed:

- `LLM providers DOWN`, count **657**, last seen 14:00 today:
  `openrouter: 402 Payment Required | openai: 429 Too Many Requests | vertex-gemini: 403 Forbidden`.
- `agent-sniper: named LLM judges are NOT answering`, count **1105**: 144/144 verdicts served
  by the free fallback chain.

So the same hold that silences this bot has also taken out the platform's LLM reliability
anchor, and the free-first chain in `api/_lib/llm.js` is what is keeping user-facing AI up.
Clearing the GCP billing hold is one action that fixes both. Nothing else here is engineering.

### Definition of done, line by line

| Line | Verdict |
|---|---|
| `npm run okx:bot` exits 0, chat delivery verified end to end | **Superseded and blocked.** `okx:bot` is the codespace stopgap and must stay stopped (`pgrep` confirms nothing local is running; Cloud Run is the sole GCS state writer). Inbound delivery is proven by `activeClients: 1`; the reply half cannot pass while no lane is funded |
| Runs on an always-on host | **DONE**, 4.6 days of continuous beats, 0 daemon restarts |
| Workspace carries real three.ws context | **Mechanical half done.** `buildChatBriefing()` renders 10,068 bytes naming three.ws, the forge and agent #2632, and its source module is `JSON.stringify`-identical to what `GET /api/okx/3d/catalog` serves in production, so the briefing rebuilt on every boot cannot quote a stale price. Asking the bot a question needs a funded lane |
| Health endpoint plus an alert on an offline session | **DONE**, and proven from two independent paths: the worker's own `sendOpsAlert` row (deduped to one row at `x22`) and `uptime-check`'s hourly subsystem re-escalation |
| PROGRESS updated with host details | **DONE** (the entry below plus this one) |

`tests/okx-chat-bot.test.js`: 71 pass.

### Fixed here

Two documents were telling the next agent to do something now unsafe or untrue.

`STRUCTURE.md` line 81 still read `Built · deploy owner-gated` five days after the service went
live, and still described Vertex as "the deploy's transport ... no secret to mint", which the
chain commit made false. Both corrected, with the live per-lane refusals named so the next
reader does not re-probe them.

RUNBOOK section 0.5 opened by describing the bot as "a LOCAL `okx-a2a` daemon", led with
`npm run okx:bot`, and closed by recommending it "before an OKX retest window". Following that
today starts a **second writer** against the GCS state object and the XMTP identity that Cloud
Run owns, which `--max-instances=1` exists to prevent. The section now opens with that warning,
demotes the whole local path to an emergency used only when the Cloud Run host is gone, and
carries the two `gcloud`-free reads used above. (The backlog work order carried the same
hazardous "do this first" instruction; it was not edited because the owner retired every file in
`prompts/finish/` the same day, so the durable homes are this log, the INDEX and the RUNBOOK.)

### What is left, and who owns it

1. **Owner: fund one AI lane.** Clearing the GCP billing hold is the one that also restores the
   platform's Vertex anchor. OpenRouter credit or an OpenAI reactivation each work too.
2. **Owner: deploy the worker**, so the chain from `ad723e87f` is actually running:
   `gcloud builds submit --config workers/okx-chat-bot/cloudbuild.yaml --region us-central1 --project aerial-vehicle-466722-p5 --substitutions=SHORT_SHA=manual$(date +%s) .`
   Order does not matter: whichever lands second is picked up on the next 15-minute election.
3. **Owner or a session with a browser: `gcloud auth login`.** Every `gcloud` read in this
   runbook is unavailable in this workspace until that is redone.

---

## 2026-09-09, WO-07 final audit: the listing OKX stores fails OKX's own description rule, and nothing was comparing that copy

Third OKX session on this date; two peers were running WO-04 and WO-05 in this worktree at the
same time and their entries are directly above. Their probes and mine were independent and
agree on everything they both cover, so this entry records only what is new: the audit findings
and the fixes.

### Re-verified today against production, nothing trusted from this file

| Claim re-checked | Verdict |
| --- | --- |
| `okx-compliance-probe.mjs` | PASS 20 probes (`90-2026-09-09-compliance-probe.json`) |
| `okx-payment-leg-probe.mjs` | PASS, 4 paid rows accepted a signed authorization, buyer still empty so nothing spent |
| `onchainos agent x402-check`, all four paid rows | `valid: true`, `eip155:196` / `exact` / USD₮0 / `payTo 0x4022de2D...f402`, amounts 10000 / 50000 / 250000 / 250000 |
| Module catalog vs `GET /api/okx/3d/catalog` | byte-identical (`JSON.stringify` equality), `validateCatalog()` clean |
| Free lane | `catalog` 200, `health` 200 with all six subsystems ok, `forge-status` GET 405, four paid rows 402 |
| Live 402 vs `specs/okx-agent-payments.md` §1.1 | every required field matches, `Access-Control-Expose-Headers` present, error string names the v2 header first |
| Verify-before-dispatch | a forged EIP-3009 signature is refused identically on two identical attempts (`402`, quotation re-issued, no job started); a $0.01 authorization replayed at the $0.25 row dies at the amount check |
| Wallets, X Layer block 70163162 | buyer 0 USD₮0 / 0 OKB, seller 2.427731 / 0.839596 OKB, relayer 0 / 0.02 OKB, `payTo` had not drifted |
| `agent get-my-agents` | `approvalDisplayStatus: 5`, "Listing rejected", `status: 2`, `soldCount: 2`, `approvalRemark` 4109 chars, byte-identical to rejection #3 |
| `agent feedback-list --agent-id 2632` | works, `total: 0` reviews |
| `npm run build:pages` / `npm run audit:docs` | green / clean (1589 files) |

### The finding: the seven rows OKX stores are missing three of the four required description parts

`onchainos agent update --help` states the contract in OKX's own words: an A2MCP
`serviceDescription` is four newline-separated parts (what it does / parameter spec / request
method / a working curl) and *"an A2MCP listing missing any is rejected at listing QA"*.

The rows OKX stores carry TWO parts, the prose form submitted on 2026-08-27. The module began
generating all four on 2026-09-02 (`6435b9c07`) and no `agent update` has gone out since. So for
a week the listing has been in exactly the state rejection #2 (2026-07-26, "service description /
parameters / usage examples") described, while three sessions reported it as drift-free,
including the entry directly above this one, which concluded "no service delta is needed" from a
comparison of names, endpoints, fees and `serviceType` only.

Nothing was comparing the copy that matters. `scripts/okx-three-copy-check.mjs` compared the
module, the live endpoint and the submission payload: three copies that all derive from the same
module and therefore cannot disagree in production. The 2026-09-02 session checked the on-chain
rows by hand, found them identical, and that hand check was never mechanised.

**Fixed:** the script now reads a FOURTH copy, the rows OKX actually stores
(`onchainos agent service-list`), and fails on drift in description, fee or endpoint, plus rows
present on one side only. It is on by default, takes the agent id from the catalog module
(`AGENT_ID` overrides), accepts a saved capture with `--listing <file>`, narrows to the local
copies with `--no-onchain`, and prints `on-chain  NOT COMPARED (<why>)` rather than passing
silently when there is no wallet session. `npm run okx:three-copy` today reads
`COPY CHECK: FAIL (7 divergences across all four copies)`. It is check 5 of the RUNBOOK's
pre-resubmission gate.

### What that changes about the resubmission

It is no longer a bare `activate`. The delta goes out first, and both are on-chain writes that
wait for the owner:

```bash
onchainos agent service-list --agent-id 2632 \
  | node scripts/okx-listing-payload.mjs --delta > /tmp/okx-2632-delta.json
onchainos agent update --agent-id 2632 --service "$(cat /tmp/okx-2632-delta.json)"
onchainos agent activate --agent-id 2632 --preferred-language en-US
```

The delta is seven `update` operations, each carrying its existing service id (39975 to 39981),
so no row is deleted and no id is lost. That is the concern the entry above raises about running
a delta, and it does not apply to this one: it is an update-in-place, not the retired WO-05
create/delete churn.

### Second finding: the chat bot cannot answer a reviewer, and its documented fallback is dead too

`/api/healthz` reads `okx_chat_bot: degraded`. The host is deployed and healthy in every other
respect (Cloud Run `okx-chat-bot`, up 4.2 days, daemon supervised, wallet session live as
`claude@three.ws`, chat delivered, `lastOnlineTime` seconds old), but the AI provider refuses its
credential: Vertex answers `403 Lightning dunning decision is deny for project:
projects/93741856042`, which is a project-wide billing hold, not IAM. No reply can be authored,
which is the failure mode that got the listing flagged offline on 2026-07-26.

The host's own remedy lists three ways out. Option 3 (pin `OKX_BOT_AI_PROVIDER=codex` on the
existing `openai-api-key` secret) was tested rather than assumed: the key authenticates
(`/v1/models` 200) but a real completion answers `429 billing_not_active`. Both providers are
billing-blocked, so no config change on this machine can restore the bot. Owner action.

### Third finding, outside this stream, recorded because it costs a buyer their money

`forge_generation` reads `down`: 44 of 91 outcomes in six hours failed, all of them
`trellis_selfhost` on the image path, none marked `superseded_by`, so the poll-time failover did
not re-dispatch them. Root cause from the worker's own logs, not a guess: `model-trellis` dies in
TRELLIS `postprocessing_utils._fill_holes` with `RuntimeError: Cuda error: 2` from
`nvdiffrast.rasterize`, i.e. `cudaErrorMemoryAllocation` on the L4. Container concurrency is 80
but the worker holds `MAX_CONCURRENT=1` and frees GPU memory per job, so this is not parallel
inference; it needs GPU-side debugging and a worker redeploy, and it is not a config lever.
A draft-tier job submitted during this session landed on `hunyuan3d` and delivered a real
3,058,208-byte GLB, so the lane that an OKX buyer hits is serving today.

### Not fixed here, deliberately

- `STRUCTURE.md` line 81 still reads `Built · deploy owner-gated` for the chat bot host, which
  has been a live Cloud Run service since 2026-09-05. Another session is mid-rewrite on that file
  (staged and unstaged home-lane edits), so correcting one status word would either mix their
  work into this commit or lose it. Whoever edits `STRUCTURE.md` next: change that status to Live.
- `tests/audit-guards.test.js` fails on `gate steps missing from data/guards.json:
  check:windows-widget`, from commit `727869703` eleven minutes before this session's sweep. The
  registry entry needs a proof fixture only that guard's author can write. Not this stream's, and
  it blocks nothing here. `tests/version-endpoint.test.js` also failed once in shard 2 on the
  build-info snapshot, which a concurrent build in this worktree explains.

### State of the stream at close

Code and production: verified. Docs: the RUNBOOK's §1 reading, §2 drift correction, §5.5 fifth
gate and §6 first-sale table are corrected and every command in §1, §5, §5.5, §6 and §7 was
executed this session. Three owner actions remain, all single steps:

1. **Approve the resubmission** (the two on-chain writes above). Wallet session is live, no OTP
   pending.
2. **Fund the buyer** `0x75d00a2713565171f33216e5aa2a375e076ecf69` with >=$3 USD₮0
   (`0x779ded0c9e1022225f8e0630b35a9b54be713736`) on X Layer / 196 for the first real settlement.
   No OKB needed; the relayer pays gas.
3. **Clear the GCP billing hold** on project `aerial-vehicle-466722-p5` so the marketplace chat
   bot can author replies before OKX's review chat-tests it.

---

## 2026-09-09, WO-05 refused and deleted; the three pre-resubmission gates are green on today's production

Asked to execute `912-okx-ai-05-relisting-resubmission.md`. **It was not executed, and the file
is now gone from the queue.** Its own banner already marked it retired; every claim behind that
banner was re-verified live before deleting it, and one of them had rotted:

- `api/_lib/okx-catalog.js` and `https://three.ws/api/okx/3d/catalog` both report the same split:
  `services` = the seven Forge rows (`forge-draft`, `forge-standard`, `forge-hd`, `forge-image`,
  `forge-status`, `catalog`, `health`), `unlisted` = the nine back-burner rows including
  `identity-studio`. `node scripts/okx-listing-payload.mjs` emits 7 rows, not the 11 WO-05 was
  written around, so running WO-05 would have deleted seven live, reviewed rows and put a retired
  line-up in their place.
- **Stale claim corrected:** the banner says #2632 has read `Listing under review` since
  2026-08-27. It does not. `onchainos agent get-my-agents` today reads
  `approvalDisplayStatus: 5`, `approvalLabel: "Listing rejected"`, `status: 2` ("not listed"),
  `soldCount: 2`, carrying the same rejection #3 remark (the four Forge rows plus the internal
  note about the x402 quotation). So the resubmission is still open, it just belongs to
  [`911-okx-ai-08-forge-relisting.md`](../911-okx-ai-08-forge-relisting.md).

### The 2026-09-07 deploy blocker is gone: the fix is live

Production reads commit `880bdcef8` (`three-ws-api-00418-j26`, built 2026-09-08 19:05 UTC).
`d7e5e5277`, the commit the previous session staged and could not submit, is an ancestor of it,
and `/workspaces/.deploy-wt-okx5` has been cleaned up. Nothing about the x402 fix is waiting on a
deploy any more.

### RUNBOOK 5.5, re-run against that revision. All three green

| Check | Result | Capture |
|---|---|---|
| `scripts/okx-compliance-probe.mjs` | `PASS 20 probes against https://three.ws` | `prompts/okx-ai/e2e-evidence/86-2026-09-09-compliance-probe.json` |
| `scripts/okx-payment-leg-probe.mjs` | `PASS 4 paid rows accepted a signed authorization` | `prompts/okx-ai/e2e-evidence/87-2026-09-09-payment-leg-replay.json` |
| `onchainos agent x402-check` (4 paid rows) | `valid: true` on all four, `eip155:196` / `exact` / USD₮0 / `payTo 0x4022de2D...f402`, `amountMinimal` 10000 / 50000 / 250000 / 250000 | `prompts/okx-ai/e2e-evidence/88-2026-09-09-okx-x402-check.json` |

The payment-leg probe spent nothing: the buyer `0x75d0...cf69` still holds 0 USD₮0, so every row
answered `insufficient_balance`, which is thrown only after the signature, recipient, amount,
validity window and nonce have all been accepted.

### No service delta is needed

`onchainos agent service-list --agent-id 2632` publishes seven rows whose endpoints, fees
(0.01 / 0.05 / 0.25 / 0.25 and three free) and `serviceType: A2MCP` match the catalog module
exactly (service ids 39975 to 39981). Piping it through `okx-listing-payload.mjs --delta` yields
7 `update` operations and zero creates or deletes. Per RUNBOOK 5.5, do not run the WO-08 service
delta in this state: it would churn correct rows and lose their ids.

### The one open step, owner-gated

```bash
onchainos agent activate --agent-id 2632 --preferred-language en-US
```

An irreversible on-chain write, so it waits for an explicit yes. Wallet session is live
(`onchainos wallet status` -> `loggedIn: true`, `claude@three.ws`), so no OTP is pending.

Docs repointed away from the deleted order in the same commit: `okx-ai-README.md` (row 5 marked
retired, row 8 added), `okx-ai-00-CONTEXT.md`, `okx-ai-RUNBOOK.md`, `prompts/README.md`,
`911-okx-ai-08-forge-relisting.md`, and the stale X Layer creds row in
`docs/ops/gcp-production.md` (the rail it says is missing has been live for weeks).

---
