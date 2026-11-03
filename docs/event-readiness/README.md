# Event readiness: prompt pack

Twenty-four self-contained agent prompts to get three.ws, and especially the /play world, to 100% before the event. Files 01-10 audit and fix what exists; files 11-16 build new event features; files 17-24 build new capabilities, things players can DO in the virtual world, by wiring in subsystems that are already built but unreachable from /play. Each file is a complete prompt: paste it into a fresh Claude Code session (or hand it to a subagent) and it runs end to end, fixing or building, then reporting.

Suggested order and parallelism (audits):

| # | Prompt | Surface | Can run in parallel with |
|---|--------|---------|--------------------------|
| 1 | [01-play-first-impression.md](01-play-first-impression.md) | /play load, intro, onboarding UX | 4, 5, 7, 8 |
| 2 | [02-play-mobile.md](02-play-mobile.md) | /play on phones (stability + touch) | 7, 8 |
| 3 | [03-play-performance.md](03-play-performance.md) | /play load weight, FPS, memory | 7, 8 |
| 4 | [04-play-multiplayer-net.md](04-play-multiplayer-net.md) | WebSocket, reconnects, voice, crowd | 1, 5 |
| 5 | [05-play-economy-loops.md](05-play-economy-loops.md) | Store, bank, wheel, combat, quests, cosmetics | 1, 4 |
| 6 | [06-play-auth-errors.md](06-play-auth-errors.md) | Sign-in, gates, error/empty states, console | after 1 |
| 7 | [07-platform-smoke-sweep.md](07-platform-smoke-sweep.md) | Every page on the live site | 1, 2, 3 |
| 8 | [08-api-production-health.md](08-api-production-health.md) | Cloud Run, crons, logs, DB, x402 | 1, 2, 3 |
| 9 | [09-accessibility-i18n.md](09-accessibility-i18n.md) | Keyboard, ARIA, contrast, translations | after 1 |
| 10 | [10-event-day-runbook.md](10-event-day-runbook.md) | Pre-scale, monitoring loop, rollback | last, after all fixes deploy |

Feature builds (run after audits 1-3 land, or in parallel if staffed; 12, 14, and 16 interlink but each stands alone):

| # | Prompt | Builds | Depends on |
|---|--------|--------|------------|
| 11 | [11-event-live-ops.md](11-event-live-ops.md) | Operator broadcast, go-live moment, live event config | nothing |
| 12 | [12-photo-mode-share.md](12-photo-mode-share.md) | Photo mode with branded one-tap share | nothing |
| 13 | [13-event-quests-leaderboard.md](13-event-quests-leaderboard.md) | Time-boxed quest line + live leaderboard + cosmetic reward | nothing (better with 12) |
| 14 | [14-welcome-concierge.md](14-welcome-concierge.md) | Greeter NPC, guided tour, event-aware opening line | nothing |
| 15 | [15-live-hype-feed.md](15-live-hype-feed.md) | Activity ticker + market hype moments | nothing (better with 13) |
| 16 | [16-invite-flow.md](16-invite-flow.md) | Invite sheet, QR, OG card truth, arrival continuity | nothing (better with 14) |

Capability builds (17-24): each wires an existing, finished subsystem into the world or adds a missing social primitive. All stand alone; the noted pairings just make them better together.

| # | Prompt | Builds | Wires in / pairs with |
|---|--------|--------|-----------------------|
| 17 | [17-plaza-live-show.md](17-plaza-live-show.md) | Live hosted show on a plaza stage, with $THREE tips | StageRoom + ShowDirector (built, unreachable from /play) |
| 18 | [18-coin-wars-portal.md](18-coin-wars-portal.md) | In-world Coin Wars portal: standings, queue, spectate | ClashRoom + war standings (built, arena-page only) |
| 19 | [19-forge-props-live.md](19-forge-props-live.md) | Text-to-3D prop generation inside build mode | Forge lane + the networked prop pipeline |
| 20 | [20-world-chat-scrollback.md](20-world-chat-scrollback.md) | Chat scrollback for late joiners + community-feed bridge | the WalkRoom relay + api/community/messages |
| 21 | [21-party-system.md](21-party-system.md) | Parties: form, see, reach, and talk to your crew | friends/presence stack; pairs with 13, 16 |
| 22 | [22-venue-projector-mode.md](22-venue-projector-mode.md) | Broadcast spectator view for the venue big screen | camera rig + event.json; pairs with 15, 16, 17 |
| 23 | [23-signature-wall.md](23-signature-wall.md) | Persistent signature wall, the event's artifact | world-persist patterns + name safety |
| 24 | [24-dance-off.md](24-dance-off.md) | Judged dance-off rounds with crowd voting and tips | dance floor beat + King of the Totem round machine |

Rules that apply to every prompt in this pack:

- The canonical test URL for the world is the $THREE community: `https://three.ws/play?coin=FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump&name=three.ws&symbol=three&image=%2Fapi%2Fimg%3Furl%3Dhttps%253A%252F%252Fipfs.io%252Fipfs%252Fbafybeihe22b5sxr3ihnxt7pregfieyteqvubqhik3j3y4bbx243xlqjw3q%26seed%3DFeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump`
- Fix what you find. Do not produce a findings report and stop; the report is what you fixed plus what genuinely cannot be fixed in-session and why.
- Verify locally with `npm run dev` (port 3000) plus the named audit scripts before claiming done. `npm test` must stay green.
- Commit finished work promptly with explicit paths (concurrent agents share this worktree; never `git add -A`).
- Deploys stay owner-gated. Prepare everything so shipping is one command (`npm run deploy:gcp:full`), then say so in the report.

## Repeatable client audit: `npm run audit:event-client`

One command re-runs the measurable parts of audits 01, 02, 03, 06 and 09 against the canonical $THREE world link and exits non-zero on a regression. Run it before every event and after any change to `src/game/`.

```bash
npm run audit:event-client                                  # every step, ephemeral local Vite on a free port
npm run audit:event-client -- --base https://three.ws       # production ground truth
npm run audit:event-client -- --only mobile:chromium,touch  # a subset
npm run audit:event-client -- --run-ms 300000               # 5-minute soak, for heap growth
npm run audit:event-client -- --limit chromium.maxTransferMB=1   # seed a regression to prove the gate trips
npm run audit:event-client -- --json docs/event-readiness/results/2026-11-06.json
```

| Step | Harness | What fails it |
| --- | --- | --- |
| `mobile:chromium` | `scripts/play-mobile-repro.mjs` in an emulated iPhone | over a limit in the baseline (time to a visible world, transfer MB, peak heap, heap growth, worst frame while walking), a duplicate GLB or clip download, a page error, a console error from our code, or a socket that dropped and never came back |
| `mobile:webkit` | the same harness in WebKit | the same checks; WebKit reproduces the iOS Safari memory kills |
| `touch` | `scripts/mobile-touch-audit.mjs` on /play | a visible control under 44 px, a canvas without `touch-action`, a fixed bar ignoring the safe-area inset, sideways overflow |
| `console` | `scripts/audit-console.mjs /play` | any console error or warning on desktop or phone |
| `failures` | `scripts/audit-play-failure-modes.mjs` | a broken state with no session, blocked IPFS or GLB, hostile query strings, or an expired pass |

The limits live in `scripts/audit-event-client.baseline.json`, one block per engine. They describe the production bundle, so they are judged only against a built deploy (`--base https://three.ws`). Against a Vite dev server, which serves every module unbundled, the run still fails on duplicate downloads, page errors, console errors and dropped sockets, and says it skipped the ceilings. Each run prints the folder holding every harness summary and full log (GLB call stacks, failed requests). The limits are set from measured production runs with headroom for a shared machine; tighten them when a performance fix lands and note the new numbers in the commit. The verdict logic is `scripts/lib/event-client-verdict.mjs`, unit-tested in `tests/audit-event-client-verdict.test.js`.

Exit codes: `0` every step passed, `1` a real regression, `3` a step never got a fair reading (a navigation timeout or `net::ERR_NETWORK_CHANGED` on a busy box) even after one automatic retry. `3` means "rerun when the machine is quiet", never "fine".

## Net and economy harnesses (meetup 3, 2026-11-06)

Two scripts audit the /play world end to end against the real multiplayer server. Both boot their own server on a free port, exit 0 only when every check holds, and accept `--seed-fault` to prove they can fail.

### `node scripts/play-net-audit.mjs`

Two real browsers (Playwright) load the real `CommunityNet` client from Vite and play against a freshly booted `multiplayer/src/index.js`. Vite runs with HMR and file watching off, so edits elsewhere in the tree cannot reload the pages mid-run.

| Check | What must hold |
|-------|----------------|
| join | both clients reach `online` and see each other |
| movement | a 4.8 m walk by one client is seen by the other |
| chat | relay works, markup arrives as inert text, the 200-char cap and the burst throttle hold |
| emote | an emote reaches the other client |
| disconnect | 10 s offline (`context.setOffline`), the client reconnects by itself and the other side holds no ghost. An offline socket sends no close frame, so the server only reaps it on the ping budget (5 s x 6, about 30 s); a 10 s outage can end in a resume or a fresh join, and both must be clean |
| background | the page is frozen (CDP lifecycle), then `resume()` puts it back online seeing the room |
| handshake | an unreachable server ends in `failed` with a readable error, and `retry()` joins |
| console | zero console errors from every page across the run (each error names the failing URL) |

Flags: `--quick` (15 s background instead of 120 s), `--background-ms N`, `--only join,chat,...`, `--clients N` (adds the scale pass), `--seed-fault`, `--json`.

### `node scripts/play-event-window-audit.mjs`

Boots the server once per window state with `WORLD_API_BASE` pointed at a local config origin, then asks the server itself whether the event is live, which event jobs it offers, and whether accepting the landmark tour is allowed. The gate in `multiplayer/src/event-window.js` must fail closed.

| Case | Expected |
|------|----------|
| upcoming (starts in 2 h) | closed, accept refused with "That job only runs during the live event." |
| live (started 10 min ago) | open, 4 event jobs, tour accepted |
| ended (an hour ago) | closed |
| crosses-end (ends 25 s after the first read) | open, then closed, and the accepted run is dropped |
| unreachable (both config paths 503) | closed |
| malformed (no usable `startsAt`) | closed |

Flags: `--only live,ended`, `--seed-fault` (serves the upcoming window to the live case).

### Results, 2026-11-03

Measured on a shared dev host (32 cores, load average 35 to 115 from other agents' jobs during the runs), against a local server booted by the harness.

| Run | Result |
|-----|--------|
| `play-net-audit.mjs` (120 s background) | 8/8 pass, exit 0. Reconnect after the 10 s outage 0.3 s after the network returned, no ghost; frozen 120 s page recovered on resume in the same session |
| `play-net-audit.mjs --quick --seed-fault` | exit 1 (disconnect and background checks fail as designed) |
| `play-net-audit.mjs --only scale --clients 25` | pass, exit 0, zero console errors. All 25 saw the full room. Server CPU 5% of one core while all 25 moved at about 14 Hz |
| `play-net-audit.mjs --only scale --clients 4` | pass, server CPU 4%, emote fan-out 122 ms, client frame 16.9 ms |
| `play-event-window-audit.mjs` | 6/6 pass, exit 0 |
| `play-event-window-audit.mjs --seed-fault --only live` | exit 1 |

Reading the 25-client numbers: the server cost is the real figure (5% of one core). The 25-client join time (643 s), emote fan-out (3.3 s) and client frame time (237 ms) measure 25 headless Chromium pages competing for a saturated host, not the server; at 4 clients on the same host the fan-out is 122 ms and frames run at 60 fps. The server's `/health` reports liveness only, so tick time is not exposed and was not measured.

Capacity assumption: `multiplayer/deploy-cloudrun.sh` pins the service to max-instances 1 (4 vCPU, 8 GiB, concurrency 1000) while `REDIS_URI` is unset, so every player in a coin world lands on the same instance. At about 5% of one core per 25 moving players the single instance has headroom well past the meetup's expected crowd; going above one instance needs `REDIS_URI` for the shared room registry first.
