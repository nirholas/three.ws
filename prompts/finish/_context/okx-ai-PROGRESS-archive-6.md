# okx-ai-PROGRESS, archive 6 (2026-07-23 to 2026-08-02)

Older entries moved verbatim out of [okx-ai-PROGRESS.md](okx-ai-PROGRESS.md) on 2026-11-10 so every file stays under the 50,000-character limit. Read-only record: append new entries to [okx-ai-PROGRESS.md](okx-ai-PROGRESS.md), never here.

## 2026-07-23, Work Order 07: independent audit closed, payTo drift found + corrected, resubmission still owner/human-gated

Re-verified everything live against production with fresh eyes; treated nothing in this file
as true until re-checked.

### Part 1 audit results

1. **402 checks (cheapest + flagship):** unpaid `POST /api/okx/3d/text-to-3d` and
   `/api/okx/3d/identity-studio` both return spec-valid x402 v2 402s, `eip155:196` accept
   FIRST, correct amounts (`10000` / `1500000`). Cross-checked all 9 paid services' live
   X Layer amount against `api/_lib/okx-catalog.js`: **zero mismatches**.
2. **Real paid call + on-chain settlement:** NOT run. Buyer wallet
   (`0x75d00a2713565171f33216e5aa2a375e076ecf69`, the onchainos TEE wallet) holds **0 USD₮0**
   on X Layer, confirmed live via direct RPC `eth_call` on the token contract. See the payTo
   finding below, this is also no longer a same-wallet self-payment.
3. **Replay protection:** could not run the full case 5a (needs a real settled payment
   first). Ran case 5d (garbage `PAYMENT-SIGNATURE` header) twice: both attempts returned a
   consistent `400 invalid_payment`, no crash, no tool execution.
4. **Free lane:** `health` all 5 subsystems ok (`payment-rail settleable:true`, live block
   read); `catalog` returns 11 services, byte-matches `api/_lib/okx-catalog.js`. Could not
   diff against the live OKX listing this session, see login note below.
5. **Completionist audit:** ran over every file this stream touched. Found and fixed
   **550+ em-dash violations** across every in-scope `.js`/`.md` file (comments, docstrings,
   docs, all of `prompts/okx-ai/*`), a rule this stream had never actually satisfied despite
   PROGRESS.md flagging it back on 2026-07-17. No live listing strings were touched (those
   were already clean from the 07-17 rewrite). No mocks, stubs, TODOs, or secrets found; no
   throwaway scratch files. Full report in the agent's own summary (not duplicated here).
6. **Tests:** `npx vitest run` on the OKX-scope test files (77 tests) green post-fix.
   Full `npm test`: **6 failures, all pre-existing and unrelated to this stream**
   (`x402-self-facilitator-min-settle.test.js` and `x402-self-facilitator-settle-recovery.test.js`,
   a Solana settleable-mint guard regression, plus `material-studio-store.test.js`), not
   caused by or fixed in this session, flagged for whoever owns that code.
   `npm run build:pages` green (changelog validates).

### ⚠️ New finding: the seller/payTo address moved, undocumented

Every prior session's docs (spec, RUNBOOK, 00-CONTEXT) name
`0x75d00a2713565171f33216e5aa2a375e076ecf69` as "our payTo". Live-probed today, the X Layer
accept's `payTo` is **`0x4022de2D36C334E73C7a108805Cea11C0564f402`**, confirmed against the
live Cloud Run `X402_PAY_TO_XLAYER` env var, not just the HTTP response. That address is the
platform's standing EVM merchant/deployer wallet (already the Base rail's payTo). It moved
sometime between 2026-07-07 and 2026-07-23 with no PROGRESS.md entry recording it. Corrected
`specs/okx-agent-payments.md` (dated reconciliation note) and `okx-ai-RUNBOOK.md` (§3, §6) to state
the live address and flag that it can drift silently again, re-probe before trusting it.
`0x75d0…cf69`'s other two roles (agent #2632's on-chain identity owner wallet; the onchainos
buyer/TEE wallet) are unaffected.

Live balances checked (X Layer RPC, 2026-07-23): buyer `0x75d0…cf69` = **0 USD₮0**; current
seller `0x4022de2D…f402` = 2.43 USD₮0 (irrelevant, it's the recipient); relayer
`0xe81DE501Dd5D9299E2bA8964498858d3fAD0415B` (Secret Manager `x402-xlayer-relayer-key` v3,
rotated 2026-07-12, superseding the `0x1F4a…bb74` address named in the 2026-07-08 entry
above) = 0.02 OKB gas.

### Part 2: docs closure

- `specs/okx-agent-payments.md`: corrected (payTo drift note above).
- `docs/okx-marketplace.md`: every one of its 8 curl examples (catalog, health,
  identity-studio create, and all 8 REST services) run live against production this
  session, all return the documented response/402. Em-dashes stripped by completionist.
- `STRUCTURE.md`: OKX row present and accurate, unchanged.
- `data/pages.json`: `/agent-identities` entry present; fixed one em-dash in its title
  (`Agent Identity Studio: 3D avatars for AI agents`).
- `data/changelog.json`: 02/03/06 entries present and well-formed (`build:pages` validates);
  07-17 avatar/render fixes are covered by existing "Avatar renders look studio-lit, not
  murky" entry. No entry added for the 07-17 catalog-string rewrite, it changed pre-launch
  listing copy with no live approved listing yet, not user-visible.
- READMEs: `api/_okx3d/` is an internal implementation dir (like sibling `api/_lib`,
  `api/_mcp`, `api/_mcp3d`), consistent with repo convention of no README for those; no gap.

### Part 3: approval watch

**Not completed this session.** `onchainos` CLI login changed as of v4.3.0: the old direct
`wallet login <email>` + typed-OTP flow this whole stream's docs describe no longer exists.
Login is now `wallet login --phase init` → a human opens the returned `loginUrl` in a
browser, signs in via email OTP there → `wallet login --phase poll`. Initiated a login
session this run (`onchainos wallet login --phase init`), handed the human the URL, polled
repeatedly; **the human had not completed the browser step by the end of this session**, so
`onchainos agent get-agents`/`service-list`/`search` (all now require this session even for
reads) could not be re-run. Approval status is therefore carried forward unverified from the
2026-07-17 entry (rejected, avatar-only reasons, fix shipped but not resubmitted). Documented
the new login mechanic in full in `okx-ai-RUNBOOK.md` §0 so the next session doesn't rediscover it.

### GO/NO-GO

- **WO-04 (real settled payment):** NO-GO, unchanged, buyer wallet still holds $0. Fund
  `0x75d00a2713565171f33216e5aa2a375e076ecf69` with ≥$3 USD₮0 on X Layer (196); top up the
  relayer's 0.02 OKB if a dry run shows `broadcast_failed`.
- **WO-05 (resubmission):** transitively NO-GO (needs WO-04's GO), and separately blocked
  this session on completing the browser login. Once both clear: upload the 07-17 avatar,
  push the catalog-string update, resubmit.
- **WO-07 (this work order):** audit complete, all findable-and-fixable issues fixed
  (em-dashes, payTo docs drift). Approval-watch and resubmission execution remain open,
  carried to the next session. `okx-ai-RUNBOOK.md` is current and is the correct starting point.

### Next session, start here

1. Re-probe live `payTo` before trusting any address in any doc, it has drifted silently once.
2. `onchainos wallet status`, if logged out, `wallet login --phase init`, hand the human the
   URL, poll until `loggedIn:true`.
3. `onchainos agent get-agents --agent-ids 2632` for current approval state, then RUNBOOK §4
   or §5 depending on the result.

---

## 2026-07-26: New rejection (service description / parameters / usage examples) + A2A chat found OFFLINE; both fixes staged, resubmission still login-gated

Two inputs arrived via the owner: (1) a fresh OKX review rejection email for "three.ws 3D
Studio": "The service you submitted is missing a complete description, parameter details,
and usage examples. Please make these updates and resubmit ... via chat." (2) A contact at
OKX ran the marketplace chat test against the agent and every message timed out with
"no delivery in 30 min", with the note that the bot is offline and must respond faster;
they will retest once we say it is fixed.

### Root cause of the chat timeouts: the A2A runtime did not exist on this machine

The codespace was rebuilt at some point after 2026-07-23: `onchainos` (was at
~/.local/bin) and the `okx-a2a` daemon (`@okxweb3/a2a-node`) were both GONE, and the
wallet session with them (`wallet status` -> loggedIn:false, accountCount 0). OKX A2A
chat delivery rides the local daemon's XMTP identity; with no daemon and no session, agent
#2632 has no reachable inbox, so "no delivery in 30 min" is exactly right. Fixed this
session:

- Reinstalled `onchainos` v4.4.0 (checksum-verified installer) and `@okxweb3/a2a-node`
  0.1.10 globally.
- `okx-a2a daemon start` -> running, linux-systemd user autostart installed;
  `switch-runtime` -> provider `claude`, ready; `setup --json` -> `state:"ready"`,
  provider auth ready. Inbound chats are answered automatically by the daemon through the
  Claude CLI once the agent identity loads.
- REMAINING GATE: `agent refresh` reports `agentCount: 0, activeClients: 0` because the
  wallet is logged out. A human must complete the browser login (v4.3+ flow, RUNBOOK §0)
  as claude@three.ws; then `okx-a2a agent refresh --json` picks up #2632 and the bot is
  live. Login session was initiated this run and the URL handed to the owner.
- TRAP for future sessions: any codespace rebuild silently kills the chat bot (CLIs,
  daemon, and session all live outside the repo). After every rebuild: reinstall both
  CLIs, restart the daemon, re-login, re-refresh. A codespace that idles also stops the
  daemon; for the OKX retest keep this workspace awake, and longer-term the daemon
  belongs on an always-on host.

### Listing fix: usage examples added to every catalog row

The 2026-07-17 rewrite gave every row the 2-part format (capability + "Provide: 1. ..."
parameter list) but no usage examples, and the new rejection explicitly demands examples.
Every `describes.input` in `api/_lib/okx-catalog.js` now carries a short "Example: ..."
usage line (e.g. text-to-3d: "Example: a brass steampunk owl, full body"). All 11 rows
re-validated within the 200 display-width per-part limit; `validateCatalog()` + 56 tests
green (okx-3d-services, okx-identity-studio, service-catalog).

DECISION (deliberate): the older skill invariants say "no example prompts" in
serviceDescription, but the reviewer's written rejection explicitly requires usage
examples; the reviewer's current instruction wins. If `validate-listing` flags the
examples during the update flow, keep them and note the conflict in the submission chat.

Note the live listing has likely still carried the STALE pre-rewrite service rows all
along (7 services, old names, thin descriptions, no parameter lists); if the reviewer
re-probed those rows this rejection is fully explained. The resubmission must replace the
full service set, not just re-activate.

### New tool: scripts/okx-listing-payload.mjs

Builds the `agent update --service` JSON straight from the catalog module:
`node scripts/okx-listing-payload.mjs` prints the 11 create-format entries;
`onchainos agent service-list --agent-id 2632 | node scripts/okx-listing-payload.mjs
--delta` prints the full replace delta (delete stale rows by name, update name matches,
create the rest). Submission can no longer drift from the module.

### Resubmission runbook from here (in order)

1. Human completes the browser login (claude@three.ws). `wallet status` -> loggedIn:true.
2. `okx-a2a agent refresh --json` -> agentCount >= 1; confirm the OKX contact's chat test
   now gets replies, fast.
3. Deploy so the live `/api/okx/3d/catalog` serves the new example-bearing strings
   (three-copy rule: module == live == submission). One command: `npm run deploy:gcp:full`
   from a clean worktree (owner-gated).
4. `onchainos agent service-list --agent-id 2632 | node scripts/okx-listing-payload.mjs
   --delta` -> `agent update` with that delta (+ the 07-17 440x440 avatar upload if not
   yet applied), `validate-listing` batch pass, human confirms the diff card.
5. Re-activate (`--preferred-language en-US`), then tell the OKX contact to retest, and
   resubmit for review via the OKX support chat per the rejection email.

### 2026-07-27 addendum: catalog fix LIVE in production; bot recovery reduced to one command

Continuation of the 2026-07-26 entry. Verified against live production today:

- **The usage-example rewrite is deployed and serving.** `GET /api/okx/3d/catalog` returns
  11/11 rows carrying a `Example: ...` usage line alongside the numbered parameter list,
  so the three-copy rule (module == live == submission) holds and the resubmission can go
  out as soon as the login lands. Deploy ran from a clean worktree; the first attempt died
  on a missing `DATABASE_URL` in that worktree (`db:check`), fixed by exporting it from
  `.env`.
- **402 + health re-probed:** unpaid `POST /api/okx/3d/text-to-3d` -> `HTTP 402` with
  `accepts[0] = eip155:196` at `10000` (Solana and two Base entries after), and
  `/api/okx/3d/health` reports all five subsystems ok with `payment-rail settleable:true`
  at block 66402405. Nothing regressed while the listing work was in flight.
- **Regression guard added.** `tests/api/okx-3d-services.test.js` now asserts every catalog
  row has a substantial capability line, a `Provide:` parameter list, AND a usage example.
  The exact rejection reason can no longer regress silently. 57 tests green.
- **Changelog + docs:** holder entry added (improvement/docs, links `/docs/okx-marketplace`);
  RUNBOOK 0.5 rewritten around the new one-command recovery.

**The bot went offline again overnight, on its own.** The daemon was alive at 21:09 and
dead ("stale pid") by 03:13 when the codespace idled. This is not a rebuild-only failure
mode, so the revival checklist became a script: **`npm run okx:bot`**
(`scripts/okx-bot-revive.mjs`). It installs both CLIs, starts the daemon, wires the runtime,
regenerates the briefing from the catalog module, links the OKX skills into the AI
workspace, sets permission bypass, and reports health. Exit 0 = online; exit 2 = staged but
logged out, printing the login URL and follow-up commands.

**New finding, a real answer-quality gap (fixed).** The daemon spawns the AI CLI with
`cwd=~/.okx-agent-task/workspace`, and that directory had NO skills: a dry run showed the
subsession loading only generic skills, none of `okx-agent-task`, `okx-agent-payments-protocol`,
or our 3D skills. Task envelopes (accept / negotiate / deliver / dispute) would have been
improvised instead of following the documented flow. Fixed by linking 12 relevant skills
into `<workspace>/.claude/skills`; a dry run now shows all 11 okx/3d skills loaded and
answers correctly ("Text to 3D Model (GLB) at $0.01 USDT is our fastest and cheapest lane").

**Architecture note for whoever tries to make this always-on.** The `okx-a2a` AI adapter
does NOT extract a reply from the CLI's stdout; it dispatches a prompt and expects the AI
subsession itself to send the reply back through the CLI (`okx-a2a session send`). So
swapping the agentic CLI for a one-shot LLM call (our own free `llmComplete` chain, which
would need no personal login and could run anywhere) would silently break the task
lifecycle, not just chat. The adapter does expose escape hatches for a custom host
(`OKX_A2A_AI_<PROVIDER>_COMMAND` and `..._EXEC_ARGS_JSON` / `..._RESUME_ARGS_JSON`, with
`{prompt}`/`{sessionId}`/`{cwd}` placeholders), so a headless box is possible, but it must
run something genuinely agentic. Do not trade task correctness for hostability.

**Still owner-gated, both single actions:**
1. **OKX browser login** (email OTP as `claude@three.ws`) -> bot online, then
   `service-list` diff -> `agent update` with the delta from
   `scripts/okx-listing-payload.mjs --delta` -> re-activate -> tell the OKX contact to
   retest and resubmit via support chat.
2. **`gcloud auth login`** (the token expired again overnight, same failure the memory
   file records) -> needed for any Cloud Run / VM work, not for the listing itself.

---

## 2026-08-01, Work Order 05: pre-submission sweep GREEN, submission staged, NOT submitted (WO-04 has no GO + wallet logged out)

Ran WO-05 Step 0 in full against live production. **Every check a reviewer can run passes.**
The submission itself was not sent, for two independent reasons, both of which are the
work order's own gates: WO-04 has still never recorded a GO (no funded settlement has ever
happened, buyer wallet is still empty), and the on-chain write needs an OKX session that
only a human can open. Agent #2632 untouched: no update, no activate, no deactivate.

Note for whoever reads two entries for this date: a concurrent session was writing
`e2e-evidence/10-402-*.json` and `20-5d-garbage-header.txt` at 21:33 while this sweep ran.
Same work order, independent probes, same conclusions.

### Step 0 sweep, live against production (2026-08-01)

| Check | Result |
|---|---|
| All 9 paid services, unpaid `POST` | **402** on every one, `PAYMENT-REQUIRED` header present, `accepts[0]` = `eip155:196`, `payTo 0x4022de2D36C334E73C7a108805Cea11C0564f402`, asset USD₮0 `0x779ded…713736` |
| Advertised amounts vs catalog | identity-studio `1500000`, text-to-3d `10000`, pro `300000`, image `300000`, rig `250000`, avatar `500000`, retarget `100000`, pose-seed `20000`, fbx `100000`. **Zero mismatches** |
| identity-studio rail (the 2026-07-07 open finding) | **RESOLVED.** It now leads with `eip155:196` at the catalog price `1500000`, not Solana-first at `1000`. Nothing left to fix before submitting that row |
| Free lanes | `catalog` 200 (11 services), `health` 200, all five subsystems ok, `payment-rail settleable:true`, live block `66850734`, `facilitator_configured:false` (relayer route, expected) |
| Three-way string diff | **CLEAN.** `api/_lib/okx-catalog.js` == live `/api/okx/3d/catalog` == `scripts/okx-listing-payload.mjs` output, across name / capability / input / price / endpoint on all 11 rows, byte for byte |
| OKX listing invariants (mechanical) | All 11 rows pass: `serviceName` 9 to 27 chars (limit 5 to 30), description exactly 2 lines, each part within the 200 display-width limit (widest 199), totals 319 to 394 of 400, no links, no em/en dashes, `fee` a plain quoted number, `serviceType: "A2MCP"`, `endpoint` https and short |
| Adversarial, funding-independent | garbage `PAYMENT-SIGNATURE` -> **400** `invalid_payment`, no crash, no job run. Valid base64 carrying junk JSON -> **402** with a fresh full challenge and the actionable error "X Layer payment must carry payload.authorization + payload.signature (EIP-3009)". Free `GET` descriptor -> 200 |
| Tests | `okx-3d-services` + `okx-identity-studio` = **47 passed** |
| Delta builder | Dry-run against the last known live listing shape (7 stale rows) produced 18 entries: 7 `delete` (each carrying its id) + 11 `create`, `create` entries correctly carry no id. Ready to run for real against `service-list` |

Deliberate keep: every row carries a usage `Example:` line, which the older skill invariants
discourage but the 2026-07-26 reviewer rejection explicitly demanded. The reviewer's written
instruction wins. If `validate-listing` flags it during the update flow, keep the examples
and say so in the submission chat. Second deliberate keep: output formats (GLB, FBX, USDZ)
stay in the copy; those are what the buyer receives, not implementation stack.

### Why nothing was submitted

1. **WO-04 GO absent.** Live X Layer reads today: buyer `0x75d00a2713565171f33216e5aa2a375e076ecf69`
   = **0 USD₮0** and 0 OKB; seller `0x4022de2D…f402` = 2.427731 USD₮0 (recipient, not payer);
   relayer `0xe81DE501…415B` = 0.02 OKB. No funded settlement has ever occurred, so WO-05's
   hard gate is unmet and the work order says do not submit.
2. **Wallet logged out.** `onchainos wallet status` -> `loggedIn:false, accountCount:0`
   (v4.4.0). Every write and even `get-agents` / `service-list` needs the browser login from
   RUNBOOK 0. Approval status therefore carries forward unverified from 2026-07-26.

### Staged so the ship is one sequence

`npm run okx:bot` ran green up to the login: daemon running (pid 2611853), runtime ready,
briefing regenerated from the live catalog module (6309 chars), 12 skills linked, permission
bypass on. Only the session is missing. Login URL handed to the owner this session
(`authSessionId 30fe7b83-a60a-401f-a981-e56b089b8278`).

Listing avatar re-verified on disk: `prompts/okx-ai/assets/okx-avatar-440.png`, exactly
440x440, opaque RGB (color type 2), 172 KB, still never uploaded on-chain.

Once the human completes the login, in order:

```bash
onchainos wallet login --phase poll --session-id <authSessionId>
okx-a2a agent refresh --json                      # agentCount >= 1 -> chat bot online
onchainos agent get-agents --agent-ids 2632       # capture approval status BEFORE
onchainos agent upload --file prompts/okx-ai/assets/okx-avatar-440.png
onchainos agent service-list --agent-id 2632 \
  | node scripts/okx-listing-payload.mjs --delta > /tmp/okx-2632-delta.json
# validate-listing on the create+update entries only, diff card, human confirm, then:
# onchainos agent update --agent-id 2632 --picture <CDN url> --service "$(cat /tmp/okx-2632-delta.json)"
onchainos agent activate --agent-id 2632 --preferred-language en-US
onchainos agent get-agents --agent-ids 2632       # capture approval status AFTER
```

### Owner actions (both single, both required for a real resubmission)

1. **OKX browser login** as `claude@three.ws` (email OTP). Unblocks the write, the reads, and
   the chat bot the reviewer retests.
2. **Fund the buyer wallet** `0x75d00a2713565171f33216e5aa2a375e076ecf69` on X Layer
   (chainId 196) with USD₮0 `0x779ded0c9e1022225f8e0630b35a9b54be713736`. One call of every
   paid service costs **$3.08**; **$8** covers the gauntlet with retries and margin. Buyer
   needs no OKB (EIP-3009 is gasless for the payer, the relayer redeems). Top the relayer
   `0xe81DE501Dd5D9299E2bA8964498858d3fAD0415B` from 0.02 to ~0.1 OKB if a dry run shows
   `broadcast_failed`.

Item 1 alone allows a resubmission of the fixed listing (which is what the 2026-07-26
rejection asked for). Item 2 is what turns WO-04's NO-GO into a GO and makes the claim
"payments settle" observed rather than unit-tested.

### Addendum, same session: OKX's own QA passes the payload, and the example-line conflict is settled

`onchainos agent validate-listing` is **pure-local, no network, no login** (`--help` says so),
so it runs today despite the logged-out session. Ran it against the exact 11-row payload
`scripts/okx-listing-payload.mjs` emits:

```
onchainos agent validate-listing --role asp --name "three.ws 3D Studio" --service "$(node scripts/okx-listing-payload.mjs)"
-> {"pass": true, "findings": []}
```

**The usage `Example:` lines are NOT flagged.** The conflict recorded on 2026-07-26 (older
skill invariants say "no example prompts", the reviewer's rejection email demands usage
examples) is therefore not a real conflict at the QA layer: OKX's own validator accepts them.
Keep the examples, and there is no longer a reason to raise the conflict in the submission
chat unless a human reviewer objects.

Proved the pass is not vacuous by feeding the same validator a deliberately bad row
(`fee: "10 USDT"`, 1-char name, `http://` endpoint, 1-line description): `pass:false` with 4
findings, one per defect. The tool really is checking.

**New finding, deliberately NOT acted on this session:** the validator's own message says a
**delivery note is a recommended 3rd line** ("a core-capability summary and what the user must
provide, on separate lines (a delivery note is a recommended 3rd line)"). All 11 of our rows
have 2 lines. Two probes established the shape of the decision:

- A 3-line version of our widest row passes QA at 523 total characters, and a 300-character
  part 1 also passes, so **`validate-listing` does not enforce the 200-per-part / 400-total
  width rule at all**. That rule is backend-side; our own `validateCatalog()` is the only
  thing enforcing it pre-write, so keep it.
- Our widest rows already sit at 394 of the documented 400 total, so adding a third line
  means rewriting parts 1 and 2 of every row down to roughly 130 each.

Not done now because: the rows pass QA as they stand, the note is recommended rather than
required, the total-width rule for a 3-line description is undocumented (a write could be
rejected for length), and any string change forces an owner-gated redeploy before the
submission may go out (three-copy rule). **If this round is rejected again on description
completeness, adding delivery lines is the first change to make**, and it is a full copy pass
plus a deploy, not a patch.

Also re-verified reviewer-visible links: `https://three.ws/docs/okx-marketplace` 200,
`https://three.ws/agent-identities` 200, `https://three.ws/api/okx/3d/catalog` 200.

Login note: the session opened earlier this run expired unused (`--phase poll` answered
"no login in progress"). A fresh one was opened, `authSessionId
9ad76fb4-50ac-4e84-8df4-ada239c7b3cc`. These expire, so open a new one with
`onchainos wallet login --phase init` rather than reusing an id from this file.

---

## 2026-08-01, Work Order 04: pre-funding sweep green, gauntlet tooling built, blocked on 2 owner actions

Ran every leg of the WO-04 gauntlet that does not move money, built the tooling that runs
the paid legs, and stopped at the two CLAUDE.md stop-and-ask gates (a real spend, and an
email OTP only a human can read). Nothing was simulated in place of a real payment.

### Step 0 preconditions, all verified live against production

| Check | Result |
| --- | --- |
| `onchainos --version` | 4.4.0 |
| `onchainos wallet status` | `loggedIn: false`, `accountCount: 0` (gate 2) |
| `GET /api/okx/3d/health` | 200, 5 subsystems with real latencies, `payment-rail settleable: true`, block 66850672 |
| `GET /api/okx/3d/catalog` | 200, 11 rows |
| Unpaid `POST /api/okx/3d/text-to-3d` | 402, `accepts[0].network = eip155:196` |
| `npx vitest run tests/api/okx-3d-services.test.js` | 27 passed |
| Three-copy rule | PASS, module == live == submission |

**402 sweep across all 11 catalog rows (new, was never done row-by-row).** Every one of the
9 paid services answers 402 with the X Layer accept FIRST, at an `amount` byte-equal to that
row's `amountAtomics`, `payTo` `0x4022de2D…f402`, asset `0x779ded…3736`, x402Version 2. Both
free rows serve live data at 200 with no payment demanded. Evidence:
`e2e-evidence/10-402-<service>.json`, one file per row.

### New tooling, all three committed and exercised

- **`scripts/okx-three-copy-check.mjs`** (`npm run okx:three-copy`). Enforces the three-copy
  rule mechanically: `catalogIndex()` is compared byte-for-byte against the live endpoint
  body (it is the exact function the route serializes, so this is an equality check, not an
  approximation), and the submission payload is compared row by row. It earned its keep the
  same day it was written: a concurrent agent edited `scripts/okx-listing-payload.mjs` (38
  lines) mid-session and the re-run proved copy 3 still matched.
- **`scripts/okx-verify-glb.mjs`**. Artifact truth for cases 2 and 3. Parses the delivered
  bytes with `@gltf-transform/core` and checks container validity, geometry, and (with
  `--rigged`) a skin with joints plus non-degenerate skin weights, counting vertices that
  carry non-zero influence so an all-zero weight set cannot pass. Validated against four
  controls: michelle.glb rigged (exit 0), mannequin.glb with `--rigged` (exit 1, it has 0
  skins), an error JSON renamed `.glb` (exit 1), a 404 (exit 2).
- **`scripts/okx-e2e-gauntlet.mjs`** (`npm run okx:gauntlet`). The full 10-case runner. Signs
  through `onchainos payment pay` (the real OKX buyer path, no hand-rolled signatures),
  replays, verifies the artifact, then reads the settlement transaction back off X Layer and
  confirms a USD₮0 `Transfer` log to the advertised `payTo` for the exact advertised amount.
  Refuses to run without `--yes`.

### Cases green now, with no funding

- **Case 1 (free lane): PASS.** Health 200 with 5 subsystems reporting real latencies,
  catalog 200 with 11 rows. No payment demanded on either.
- **Case 5d (garbage payment header): PASS**, four shapes, none ran a tool:
  `not-base64` → 400 `invalid_payment`; valid-base64-wrong-shape → 402 naming the missing
  EIP-3009 fields; whitespace-only → 402 with a full fresh challenge; truncated JSON → 400.
  The whitespace case was investigated as a possible defect (402 with an empty `error`
  string) and is correct behavior: HTTP trims the header to `''`, which is indistinguishable
  from no header, and the right answer is the standard challenge.
- **Case 7 (legacy rails): PASS** at challenge level. Solana and Base accepts are still
  offered alongside X Layer in every challenge, all at the same `amount`. Adding the X Layer
  rail did not displace the pre-OKX rails.

### Settlement route facts, measured not assumed

- `okxFacilitatorConfigured()` is **false** in production (health reports
  `facilitator_configured: false`), so settlement runs the direct-redemption path: the
  relayer broadcasts `transferWithAuthorization` and waits for the receipt.
- **Gas is a non-issue and the old 0.3 OKB ask is retired.** X Layer gas price measured at
  0.02 gwei; one redemption at ~100k gas costs 0.000002 OKB, so the relayer's existing
  0.02 OKB covers roughly 10,000 settlements.
- Code path confirmed by reading `api/okx/3d/[service].js`: engine runs AFTER verify and
  BEFORE settle, so an engine failure returns before any redemption. `verifyOkxXLayerPayment`
  reads `authorizationState(from, nonce)` on-chain before the engine runs, which is what
  makes case 6 mechanically checkable: the assertion is that the nonce is still unredeemed
  after a failed job, not that an error message was polite.

### Blocked on exactly two owner actions, both in `e2e-evidence/FUNDING-REQUEST.md`

1. **3.0 USD₮0 to `0x75d00a2713565171f33216e5aa2a375e076ecf69`** on X Layer (chainId 196),
   token `0x779Ded0c9e1022225f8E0630b35a9b54bE713736`. Buyer wallet reads **0.000000** today.
   The old file's "self-transfer, net-zero" math is void: `payTo` moved to `0x4022de2D…f402`
   while the buyer stayed `0x75d0…cf69`, so payments now genuinely leave the buyer. Sizing:
   one clean run settles $0.52, but the balance floor (verify refuses any authorization whose
   value exceeds `balanceOf(buyer)`, including the ones meant to be rejected) makes the real
   requirement $0.62, plus $2.08 for four fix-loop iterations.
2. **The OKX login OTP.** `wallet login --phase init` session `7a064ccb-…` is minted and the
   browser URL is in the funding file.

### GO/NO-GO

- **Work Order 05: NO-GO.** Unchanged from the previous session's finding, and for the same
  reason: no real settlement has ever landed. Cases 2, 3, 4, 5a, 5b, 5c and 6 are written,
  wired and dry-run-exercised, but they are unproven until they spend.
- Agent #2632 untouched. No on-chain write attempted.
- `docs/okx-marketplace.md` deliberately still carries no "verified behavior" section: the
  RUNBOOK's standing rule is that it must not claim observed on-chain settlement until a tx
  hash exists. Writing that section from intention is exactly what this work order forbids.

---

## 2026-08-01, Work Order 07: final audit closed; 6 defects found and FIXED; stream is docs-complete and blocked only on 2 owner actions

Third session on this date. Two other agents were running WO-04 and WO-05 in this same
worktree while this ran (their entries are directly above; `e2e-evidence/10-402-*.json` and
the 21:33 `okx-ai-00-CONTEXT.md` / `README.md` edits are theirs). Their 402/catalog/test findings
and mine were produced by independent probes and agree, which is worth more than one pass.
This entry deliberately records only what is NOT already in theirs: the WO-07 audit findings
and the fixes applied.

### Part 1, adversarial audit (re-verified today, nothing trusted from this file)

- **All 11 catalog services probed programmatically off the module**, not off a hand-written
  list, so a row that exists only in the module still gets checked. 9 paid: HTTP **402**,
  `PAYMENT-REQUIRED` header decodes as x402 v2, `accepts[0]` = `eip155:196`, amount equals
  `amountAtomics` exactly. 2 free: **200**. **0 failures.**
- **`catalogIndex()` is byte-identical to the live `/api/okx/3d/catalog` response**
  (`JSON.stringify` equality, not a spot check). `validateCatalog()` clean.
- **Replay / tamper:** garbage `X-PAYMENT` and garbage `PAYMENT-SIGNATURE` both -> **400
  `invalid_payment`**. A structurally valid but **forged EIP-3009 payload** (well-formed
  authorization + junk signature) -> **402** `"EIP-3009 signature does not verify for
  authorization.from"`, identical on a second identical attempt, no tool execution either
  time. The verify-before-dispatch gate holds against a forged proof, which is the part that
  can be proven without funding.
- **Wallets re-probed live** (X Layer RPC, block 66852405): unchanged since 2026-07-23, and
  **`payTo` had NOT drifted again** (still `0x4022de2D…f402`). Newly recorded: the buyer also
  holds 0 OKB, which is NOT a second blocker (it signs EIP-3009 off-chain, the relayer pays
  gas). RUNBOOK §3 now says so, so nobody funds gas that is not needed.
- **Tests:** `npm test` = 6 failures / 17223 passed, **none in this stream**
  (`x402-sponsor-runway`, `x402-ring-wallet-monitor`, `solana-rpc-priority-and-breaker`;
  another agent has `api/cron/treasury-topup.js` open in this worktree right now, so that
  code is mid-edit and not mine to touch). OKX scope isolated: 57 passed. The 7 MCP suites
  covering the file changed below: 131 passed. `npm run build:pages` green.
  `npm run audit:docs` clean (1236 files).

### Defects found and FIXED (this work order fixes, it does not file)

1. **A banned em-dash was being served to OKX buyers at runtime.** The free
   `getting_started` tool on the flagship endpoint returned
   a heading of the form "three.ws Agent Identity Studio <banned dash> Getting Started", and
   its own tool description opened "FREE <banned dash> start here". Source:
   `api/_lib/mcp-getting-started.js`, which every
   hosted three.ws MCP server shares, so this was platform-wide, not OKX-only. Fixed all
   three string sites plus the file's comments. **Needs a deploy to reach buyers.**
2. **`api/_mcp/payments.js` served an em-dash in a buyer-visible error**
   ("x402 processing failed <banned dash> quote ref ..."). Fixed. Also needs the deploy.
3. **`specs/okx-agent-payments.md` stated the WRONG payTo in its header block**, the first
   thing a reader sees, with the 2026-07-23 correction buried ten lines below. A zero-context
   outsider would have funded or invoiced the wrong address. Header now states the live
   `0x4022de2D…f402` and points at the correction note.
4. **The same spec claimed the X Layer rail was dead at runtime.** Its 2026-07-07
   reconciliation note still read "those env vars are not set in Vercel production, so
   `POST /api/okx/3d/*` still returns a Solana-only challenge … the 2026-07-04 rejection
   cause persists at runtime". That is false today and false since the Cloud Run migration.
   Rewritten to state the gate is CLOSED, with today's re-verification. This is exactly the
   "doc promising what the code does not do" class the work order calls a release blocker,
   inverted: a doc denying what the code does do.
5. **`docs/okx-marketplace.md` named the wrong engine for the $0.01 lane** ("NVIDIA NIM
   TRELLIS"). `FREE_DEFAULT_FOR_TIERS` in `api/_lib/forge-tiers.js` resolves draft to
   `trellis_selfhost`; NVIDIA NIM is the LAST resort in the fallback chain. Corrected to
   describe the real chain.
6. **`/docs/okx-marketplace` was live (200) but unregistered in `data/pages.json`**, while
   the changelog and `docs/start-here.md` both link to it. Registered.

Also swept: every banned dash across the stream's files (`prompts/okx-ai/*`, the spec, both
docs, `api/_okx3d/*`, `api/_lib/okx-catalog.js`, `api/_lib/x402-spec.js`,
`scripts/okx-listing-payload.mjs`). All clean. Note `tests/fixtures/mcp-golden-tools.json`
still carries 21 em-dashes, but they belong to OTHER MCP servers' tool copy (agent, agora,
diorama), not to any OKX 3D row; left for whoever owns those surfaces rather than sprawling
a platform-wide rewrite across a worktree two other agents are writing to.

### Part 2, docs closure, each item verified rather than assumed

- `specs/okx-agent-payments.md`: live `eip155:196` accept re-probed and byte-compared to
  §1.1. Matches (`scheme`, `network`, `payTo`, `maxTimeoutSeconds:86400`, asset,
  `extra{symbol,name,version,transferMethod,decimals}`). Two corrections above applied.
- `docs/okx-marketplace.md`: **all 9 documented curl examples run verbatim against
  production**, every one returns the documented 402; the 9 static URLs it cites all return
  200; the price table matches the module on all 9 paid rows. Its honest "Not yet
  demonstrated end to end" note is still accurate and stays until a tx hash exists.
- `docs/agent-identities.md`: every deliverable key it documents (`pfp.url`,
  `pfp.preview_128_url`, `full_body[]`, `rigged_glb_url`, `mesh_glb_url`, `viewer_url`,
  `pose_studio_url`, `brief_truncated`) exists in `api/_okx3d/identity.js`. **All 36 asset
  URLs in `data/agent-identities.json` return 200**, so the showcase is real, not stale.
- `STRUCTURE.md`: OKX row present, accurate, points at the right files.
- `data/pages.json`: `/agent-identities` and `/docs/agent-identities` present;
  `/docs/okx-marketplace` added this session.
- `data/changelog.json`: entries present for 07-06, 07-07, 07-10, 07-27; all validate under
  `build:pages`. No new entry added: nothing user-visible shipped here (doc corrections and
  a dash fix are not holder news, and the launch entry belongs to the approval branch).
- READMEs: `packages` 65/65, `workers` 33/33, `services` 4/4, plus `api/_okx3d/README.md`.

### Part 3, approval watch: status is UNREADABLE, and that is the finding

`onchainos agent get-agents --agent-ids 2632`, `service-list`, and `search` all return
`{"ok":false,"error":"session expired, please login again"}`. **No branch could be executed
because the branch cannot be determined.** Last real reading remains 2026-07-10.

I tried to route around it rather than accept it, and there is no way around:
chain **196 is absent from `REGISTRY_DEPLOYMENTS`** in `src/erc8004/abi.js`, and OKX's agent
registry on X Layer is their contract, not one we deployed, so there is no login-free
on-chain read of #2632's approval state. Inventing a registry address to call would be
fabrication. RUNBOOK §1 now records the last-real-read date so nobody mistakes the carried
value for a fresh one.

**New trap, cost real time here, now in RUNBOOK §0: a login URL goes stale.** `npm run
okx:bot` issues its OWN `--phase init` as part of its run, which invalidates any URL handed
over earlier; an idle session also expires by itself. Polling a dead one answers "no login in
progress for this session", which reads like a CLI bug and is not. Issue `--phase init` only
with the human at the keyboard. Three sessions were burned this way today across the
concurrent runs.

Chat bot: `npm run okx:bot` run green to the login wall. Daemon running, runtime ready,
briefing regenerated from the live catalog module, 12 skills linked, bypass on. Only the
session is missing.

### State of the whole stream at close

Code and docs: **done**. Production: **verified**. Two owner actions remain, both single
steps, neither performable by an agent:

1. **Complete the OKX browser login** as `claude@three.ws` (issue a fresh URL at that
   moment). Unblocks: reading approval status, the listing update + re-activate, and the
   chat bot going online for OKX's retest.
2. **Fund the buyer** `0x75d00a2713565171f33216e5aa2a375e076ecf69` with >=$3 USD₮0
   (`0x779ded0c9e1022225f8e0630b35a9b54be713736`) on X Layer / 196. No gas needed there.
   Unblocks WO-04's real settlement, which unblocks WO-05's GO.

A deploy is also pending but not blocking: fixes 1, 2 and 5 above are in the tree and reach
buyers on the next `npm run deploy:gcp:full`.

---

## 2026-08-02: chat bot moved off the codespace (backlog work order 08)

**Measured first.** `npm run okx:bot` exits 2: daemon running, runtime ready, briefing
regenerated from the live catalog, 12 skills linked, bypass on, and the wallet session
logged out. Unchanged from the last entry, and it will keep coming back, because a
codespace sleeps.

**Built:** [`workers/okx-chat-bot/`](../../workers/okx-chat-bot), an always-on Cloud Run
host for the same stack. What it changes, beyond uptime:

- **Identity survives a revision.** `~/.onchainos` + `~/.okx-agent-task` are tarred to a
  GCS object on a timer and on SIGTERM (daemon stopped first, so sqlite is quiesced) and
  restored at boot. Cloud Run's filesystem is in-memory, so without this every deploy would
  have cost a fresh human OTP: trading one uptime problem for another.
- **The daemon actually runs.** `okx-a2a daemon start` delegates to an OS autostart unit
  and there is no systemd in a container, so it installs a unit and silently leaves the
  daemon down. The supervisor owns `okx-a2a run` as a child instead, with capped backoff.
- **The subsession knows what we sell.** The workspace is rebuilt from the image, never
  from the snapshot, so a redeploy can never restore a stale briefing over a fresh one.
  Extracted [`api/_lib/okx-chat-briefing.js`](../../api/_lib/okx-chat-briefing.js) as the
  single source both the host and `okx-listing-payload.mjs --briefing` read, and added real
  platform context so a buyer asking "what is three.ws?" gets an answer instead of a
  price list. Written as both `CLAUDE.md` and `AGENTS.md` (which one is read depends on the
  spawned CLI).
- **The silent outage is now loud.** A `bot_heartbeat` row (`worker='okx-chat-bot'`)
  becomes the `okx_chat_bot` subsystem on `/api/healthz`; a host that stops beating reads
  as `down` rather than vanishing. Two signatures classified in `scripts/gcp-triage.mjs`.
- **Session expiry is actionable, not just reported.** On detection the host mints the
  login URL and pages with the exact three commands, carried on `/readyz` as `.remedy`.
- **Provider selection is by credential.** `ANTHROPIC_API_KEY` picks Claude Code,
  `OPENAI_API_KEY` picks Codex, neither reports `ai_provider_uncredentialed` rather than
  spawning a keyless CLI that fails to authenticate and looks like silence to the buyer.

**Verified, mock-free.** Ran the host locally against the real CLIs: workspace built
(7391 bytes, 12 skills into `.claude/` and `.codex/`), daemon spawned and supervised,
`/readyz` correctly 503 with `session_logged_out`, `.remedy` carrying a freshly minted live
login URL, and a clean SIGTERM (daemon stopped, then exit). 29 unit tests pass
(`tests/okx-chat-bot.test.js`). Local daemon restored to its staged state afterwards.

**Left, both owner-only:**

1. **The OKX email OTP** as `claude@three.ws`. Nothing agent-side can do this; OKX never
   surfaces it as a CLI prompt. Needed once locally now, and once more after the first
   Cloud Run boot (there is no snapshot yet, so it comes up logged out by design).
2. **An AI-provider credential on the service.** `ANTHROPIC_API_KEY` preferred. This repo
   has `OPENAI_API_KEY` in `.env` and the host will use it via the Codex CLI if that is
   what gets set, so this is a choice, not a blocker.

**Not committed.** The diff names a marketplace outside the `$THREE` ecosystem, so the
CLAUDE.md commit gate applies and the owner has to approve it first.
