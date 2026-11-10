# event/ progress log

Cross-chat handoff log for the $THREE Community Day pack. Append an entry when you finish (or partially finish) an order: date, order, what shipped with commit SHAs, what remains, evidence (commands run, what they printed).

**Older entries:** [event-PROGRESS-archive-1.md](event-PROGRESS-archive-1.md) (2026-08-07 to 2026-09-02). They were moved there verbatim on 2026-11-10 to keep every file under the 50,000-character limit; search them too when you need history.

## 2026-09-04 · The souvenir log read ran: zero grants, finding corroborated

The 2026-09-02 entry determined by code argument that no `laurel-meetup` souvenir
could have been granted during the 2026-08-09 window, and left two reads open
behind a `gcloud` token. `gcloud` answered today, so the first one ran, comfortably
ahead of the ~2026-09-08 retention deadline:

```bash
gcloud logging read 'resource.type="cloud_run_revision"
  resource.labels.service_name="three-ws-multiplayer"
  textPayload:"souvenir laurel-meetup"' \
  --freshness=30d --project aerial-vehicle-466722-p5 --format='value(textPayload)'
```

**Zero lines.** Exit 0, no error. A control query without the `textPayload` filter
returned current entries for the same service (`[walk_world ...] -leave ...`,
timestamped today), which is what makes the empty result evidence rather than an
artifact of a broken query, a wrong service name, or an expired window: the stream
is intact and `--freshness=30d` from 2026-09-04 still reaches 2026-08-05, four days
before the event.

So two independent lines of evidence now agree that nobody left the event with a
souvenir: the code argument (`event-drop.js` landed 2026-08-07, after the running
image was built) and the absence of any grant line in the logs that image wrote.

**The second read stays open, and not because of `gcloud`.** The durable Upstash
`player:*` scan is still the stronger source, and it remains the only thing that
could overturn this. It cannot run from this workspace for a newly measured reason:
`UPSTASH_REDIS_REST_URL` on both `three-ws-api` and `three-ws-multiplayer` points at
`10.128.15.228`, a private SRH proxy reachable only through the `three-ws-vpc`
connector, so a token is not enough and no amount of re-auth helps. It needs
in-VPC execution; creating the read-only Cloud Run job for that was refused by this
environment's tool policy. Since it can now only confirm what two sources already
agree on, it should not gate the closeout.

**Consequence for OWNER-ACTIONS row 13.** The decision is unchanged in substance,
but it is better founded: settling from nothing is no longer an inference, it is a
measurement. Row 15 no longer gates it.

## 2026-09-02 · Order 08 · Independent corroboration of the closeout, from a source outside this repo

Ran the order in a second session while the entry above was being written. Reached the same two
findings by different evidence, which is worth recording because OWNER-ACTIONS row 13 asks the owner
to decide from them.

**The API/frontend half is confirmed by a third-party timestamp, not only by our own progress log.**
The entry above dates the deploy from `production-100-PROGRESS.md` (Cloud Build `015cc079`, revision
`00365` at `4a748fbde`), which is an agent's own record of its own work. The community Telegram
channel is an independent, externally timestamped copy of the same fact. `/api/cron/changelog-push`
posts from `public/changelog.json` **baked into the running image**, on a 20-minute Cloud Scheduler
cadence, so its post times date the image rather than the repo. Read from the public channel preview
(`https://t.me/s/three_ws?q=<term>`, no credentials):

```
2026-08-09 11:20:22Z  Update - The world knows when the meetup is, and throws fireworks when it starts
2026-08-09 11:20:47Z  Update - The wardrobe panel no longer glitches shut when you reopen it quickly
2026-08-09 11:40:06Z  Update - Show up to a live event and you keep something from it
2026-08-09 11:40:20Z  Update - The meetup has its own jobs, and a live leaderboard to race on
2026-08-09 12:20:07Z  Update - Play now counts down to the next community event
```

Two properties make this decisive. The times land exactly on 20-minute boundaries (:20, :40, :00),
which is the Cloud Scheduler cron and not a hand-run `changelog:push`. And the second line is the
entry dated 2026-08-09 that reached `public/changelog.json` only in `4a748fbde` (feeds regenerated
2026-08-09 09:54:19Z). An image serving that entry at 11:20 UTC must have been built at or after
09:54 UTC that morning, which is after every event commit and 5h40m before the 17:00 window opened.
So the countdown, `/event`, and the in-world meetup layer were live ahead of the window on evidence
that does not depend on any agent's self-report.

**The service-name defect in the order was found independently here too.** The order's log query
names `hyperfy-world`. That service is the Hyperfy world behind `world.three.ws`
(`deploy/world/cloudrun.yaml`, `STRUCTURE.md` row "Multiplayer 3D world"), a different deployment
from the Colyseus server that runs `/play` and carries `_grantEventSouvenir`. Anyone running the
order's query verbatim would have read zero rows from a service that never had the code and
reported a false zero for the right answer's wrong reason. Use `three-ws-multiplayer`.

**Re-verified from scratch, all agreeing with the entry above:** `/health` on the world server is
`{"ok":true,"name":"three.ws-multiplayer"}`; `/population?by=coin` answers with a `byCoin` map and
`byCoin` entered `multiplayer/src/index.js` in `ad4d3b713` (2026-08-17), so the image serving today
postdates the event by eight days; `/api/play/population` answers `{"ok":false,"reason":"unavailable"}`
against a world server that answers `ok:true` (OWNER-ACTIONS row 18); `/api/play/event-leaderboard`
answers `no_event`.

**On the two blocked reads.** Confirmed dead here as well, and by one more route than the entry above
records: the stored-credential paths are refused by this session's tool policy on top of the
Workspace reauth policy, so `gcloud`, application-default credentials, and a direct token exchange
are all unavailable without the owner. Nothing in this session narrowed row 15.

**One hazard cleared, not a finding.** The shared index held a stale entry for this file that would
have deleted the closeout entry (123 lines) on the next `git commit` run without explicit paths,
even though `9cff4cb2a` had already committed it. Reset with
`git restore --staged prompts/finish/_context/event-PROGRESS.md`; no working-tree content was touched.

**Not run here.** Orders 02 and 06 stay open. 06 is under active work by a concurrent agent
(`1c7410eef`, 2026-09-02 19:01Z, the photo-mode retake fix), so it was left alone. 02 needs the
in-world browser walkthrough it has always needed, and the box is at load average 62 on 16 cores,
the same contention that defeated the order-04 and order-07 agents; a walkthrough run under that
would not be trustworthy evidence even if it completed. The pack therefore cannot retire yet.

## 2026-09-02 · Order 02 · The in-world walk was driven for the first time, and the box refused to let it be measured

**The residual that has blocked this order since 2026-08-08 is retired: the /play world DOES boot
headless on this machine.** Both the order-04 and order-07 agents recorded that it would not (`page.goto`
timeout, `Page crashed`, "the 3D boot OOMs the browser under load") and verified their work against
harnesses instead. It boots. `scripts/play-journey-audit.mjs` under headless Chromium with
`--use-gl=swiftshader --enable-unsafe-swiftshader` drove a real cold load, the lobby, search, the create
modal, the gallery, entry into the $THREE world, the HUD, and the store / bank / wheel / emote panel
probes. There is no need for anyone to build a new harness for this order; the one in `scripts/` reaches
every surface the order asks about.

**What it could not do is measure, and the reason is the box, not the code.** Two runs:

1. **Load average 43 on 16 cores.** Reached the world at +332s. The shared Vite dev server on port 3000
   died at +67s and never came back inside the run, so from there every line is
   `net::ERR_CONNECTION_REFUSED`: the store panel's lazy chunk, `/avatars/default.glb`, the animation
   clips, `/api/auth/me`, the world save. A `LOADER NEVER CLEARED` and a "failed to load dynamically
   imported module" in that run are artifacts of a dead server, not defects, and it would have been easy
   and wrong to file them.
2. **Load average 220 on 16 cores.** The harness printed `LOBBY NEVER BECAME VISIBLE` at +125s and then
   `[state:lobby-first-paint] {"cards":21,"skeletons":0}` at +211s, and printed
   `GRID NEVER RESOLVED (no cards, no empty state, no error state)` about a grid holding 21 cards. Every
   verdict in that run is a false negative. Stopped it rather than let it add load and produce a defect
   list made of contention.

The harness measures with wall-clock waits, so contention does not slow it down, it makes it lie. That
is now written into the order as a precondition with the numbers above, so the next agent checks
`uptime` before believing anything it prints.

**What was verified anyway, from the uncontended first minutes:** `[focus:lobby] 114 tabbable, 0 kinds
without a focus ring, 0 that refuse focus` at 1440x900, 21 coin cards, 0 skeletons, no empty state. That
agrees with the preflight's independent lobby pass (130 desktop / 91 mobile tab stops, 0 missing rings).

**Two harness readings documented as noise rather than filed as defects,** because a later agent would
otherwise chase them: the `[overflow:panel:*]` rows for `div.cc-label.ac-name`, `div.ac-prompt`,
`span.ac-key`, `div.tik-prompt`, `div.npc-prompt` and `div.cc-label.npc-name` are world-space billboard
labels, so an `x` of 5746 or -287 is them behaving correctly when their subject is off camera; and
`[panel:bank] no trigger visible` is right, because the bank is proximity-gated behind its ATM by design
and has no HUD button, as is the Wheel of Fortune behind its station.

**Shipped:** `prompts/finish/011-event-02-play-polish-sweep.md` rewritten to its remainder. It now carries
the quiet-box precondition with the measured failure modes, the three exact runs to make (desktop, 375,
320), the two readings to ignore, and the same task list scoped to the in-world half only, with the
lobby half marked verified and off limits.

**Remains:** the in-world defect list itself, one quiet-box session. Nothing about it is blocked on a
credential, a deploy, or an owner.

**Not mine, in flight.** Order 06 is being worked by a concurrent agent in this same worktree right now
(`1c7410eef` 19:01Z, `37f60a291` 19:07Z, `ad129473d` 19:19Z, `ac68136d4` 19:25Z: the retake fix, unit
tests, a photo-mode check script, and an e2e driving the real capture path). Left entirely alone. Its
changelog entry was still absent at 19:26Z and belongs to that agent's run, not to a second hand.

**Order 08 is complete and its file is deleted.** Its closeout is the entry above this one; its two
blocked cloud reads are OWNER-ACTIONS rows 13 and 15, and the production defect it turned up is row 18.
Its last task, retiring the pack, is now a line in [README.md](event-README.md), since it can only happen
after 02 and 06 land.

## Retire this file when the campaign is done (required)

This file is shared context rather than a single order, so it outlives the
prompts that cite it. Delete it in the commit that closes the LAST prompt of
this campaign, once nothing else in `prompts/finish/` references it:

       grep -rl 'event-PROGRESS' prompts/finish/
       git rm prompts/finish/_context/event-PROGRESS.md

While any sibling prompt of this campaign is still on disk, leave this file in
place and keep it accurate instead. The shrinking directory is the only signal
to the next agent that a campaign is closed.

## 2026-09-02 · Order 06 · Photo mode was shipped broken; fixed, proven in two engines, documented

**The finding.** Photo mode already existed (`a8b75a1a5`), so step 0's "extend rather than
duplicate" applied. Reading it before touching it turned up the reason nobody had ever been handed
a photo: **every single press failed.** `src/game/photo-mode.js` carries its own copy of the `el()`
helper from `coincommunities-ui.js`, and the copy had drifted, losing two features the card
actually uses. `el('button', {...}, ['✕'])` called `appendChild('✕')`, which throws
`TypeError: parameter 1 is not of type 'Node'` in every browser; `takePhoto`'s own catch swallowed
it and toasted "Couldn't photograph the world just now". The second loss was quieter: `html:` fell
through to `setAttribute`, so the hint line rendered as `<p html="...">` with no visible text.
Reproduced against jsdom before changing anything, so the fix was aimed at a measured failure.

**Shipped** (all swept into other agents' `git add -A` commits before staging, content verified at
HEAD; the last three are mine end to end):

- `1c7410eef` the `el()` fix, plus two defects the fix exposed: a retake left the outgoing sheet
  fading for 220ms under its replacement, where a click on the stale backdrop dismissed the fresh
  card (`closePhotoPreview({ immediate: true })` on the retake path, `pointer-events: none` on a
  sheet that is not `.cc-on`).
- `2a8f58946` the hint promises `P` takes another, and the card's capture-phase key handler was
  swallowing it. `P` is now let through to /play's own handler, which routes it back into
  `takePhoto`, so the promise is true.
- `37f60a291`, `ac68136d4`, `ea67086e7` the tests.
- `9647898af` a busy state on the HUD button (below).
- `e84ea35d9` / `46c61547f` the changelog entry; `0f37c78ef` the `STRUCTURE.md` row.

**Verified, in this order.** `tests/photo-mode.test.js` (13 cases, jsdom: compositor geometry at
landscape/portrait/tiny, the preview sheet, Escape, the clipboard fallback, the event stamp) and
`tests/e2e/play-photo-mode.spec.js` (8 cases, **real Chromium and real WebKit**, the half a unit
test cannot own: it builds a live WebGL world on a known clear colour, presses the shutter through
the real module, decodes the PNG the player would download and samples it). The black-frame bug is
measured three ways, and the clear colour round-trips as exactly `18,92,176,255`, which also pins
the render target's colour space. Then the whole thing driven in the real `/play` world: the card
opens, the hint reads "The world keeps running behind this card. P takes another.", the close glyph
is `✕`, the file is `threews-three-2026-09-02_205528.png` at `1440 × 970` (a 1440x900 world plus a
70px signature bar).

**Two things the browser run taught that no test would have.**

1. **The capture is not free.** End to end it took **59.5s** on this box (`toBlob` alone 5.1s):
   software GL, several agents sharing the machine. A 260ms shutter flash followed by a minute of
   nothing reads as a dead button, so the HUD control now holds `aria-busy` for the whole press
   (`cc-photo-working`, `cursor: progress`, still under `prefers-reduced-motion`). Confirmed live:
   `aria-busy` true 3s in, cleared on open, transitions `true|false` then `null|true`.
2. **`phase`, not the HUD, is when the world is playable.** `/play` unhides `#cc-hud` while still
   `phase === 'loading'`, and every world hotkey is gated on `phase === 'world'`, which landed
   **142s after** the HUD appeared here (the local Colyseus join retries; the world becomes playable
   independently, by design). A harness that waits on the HUD presses `P` into a handler correctly
   ignoring it and reports a working feature as broken, which is exactly what the first walkthrough
   run did. A concurrent agent hit the same wall in `scripts/play-photo-mode-check.mjs` and solved
   it better, by retrying the press and reporting the dead window as the measurement, so their
   script was left alone.

**Evidence on disk (not committed, per the no-screenshots hygiene rule):** the preview sheet with a
real card in it, captured from the live world at 1440x900, in
`/tmp/claude-1000/-workspaces-three-ws/e041b23d-2096-4e66-a073-67542a5717a3/scratchpad/photo-evidence/preview-sheet-1440x900.png`.
A second run to dump the decoded PNG on its own timed out at 240s rather than 59s: the box was at a
load average of 58 by then, with several agents' suites running. Nothing was inferred from that
timeout, and the card's actual bytes are asserted per-pixel in the e2e spec instead.

**Suite.** `npx vitest run`: 27,304 passed, 12 failed across 10 files, none of them photo-mode
(`x402-discovery-parity`, `x402-discovery-green`, `cron-scheduler-sync`, `branding`,
`deploy-artifacts`, `asset-host-liveness`, `no-nul-bytes`, `mcp-model-inspect-tools`,
`oracle-calibrate-cron`, `vanity-grinder-progress`), all other agents' in-flight work in this shared
worktree. `npm run check:rules` clean on every file touched.

**Remains.** Nothing in this order. It is behind the deploy gap like everything else on `main`:
production still serves the broken shutter until the next deploy carries these commits, and deploys
are owner-gated.

## 2026-09-02 · Order 06, second pass: cross-engine capture proof, and a duplicate announcement caught before it shipped

Ran as an independent verification of 06 while another session was fixing it. Both sessions
converged on the same two facts from opposite directions, which is worth more than either run
alone; this entry records only what is not already above.

**The harness, and why it has two modes.** `scripts/play-photo-mode-check.mjs` (`MODE=world`,
`MODE=scene`). World mode boots the real `/play` world and drives the key and the HUD button the
way a player does. Scene mode stands a real `WebGLRenderer` up on the `/play` page and drives the
SHIPPED `takePhoto` over it, which is the only way to answer the black-frame question on an engine
that has no swiftshader switch: webkit will not boot the world here at all, so "verified on a
second engine" is unreachable without it. Same capture path, same compositor, same preview sheet,
seconds instead of minutes.

**Measured, both engines, scene mode: 20/20 each.**

| Fact | chromium | webkit |
|---|---|---|
| capture is not a black frame | 100% non-black, mean luma 53.5 | 100% non-black, mean luma 53.6 |
| capture holds a rendered scene, not a flat fill | 24 distinct colours | 22 distinct colours |
| Download writes real PNG bytes | magic `89504e470d0a1a0a` | same |
| Copy reaches the clipboard | "Copied. Paste it straight into a post." | same |
| retake leaves exactly one sheet | 1 | 1 |

The downloaded file and the composited card are byte-identical in size on each engine (40,494 on
chromium, 21,870 on webkit), so what the player saves is the card that was measured.

**Three harness bugs found by disbelieving its own failures, each a lesson.**

1. It reported the HUD photo button as failing a 40px touch bar at 92x34. It is not a defect:
   `coincommunities.css` raises that whole right-edge stack under `@media (pointer: coarse)` and
   leaves the fine-pointer rail at its designed 34px. A touch bar asserted against a mouse reports
   the design as a bug. The check now asserts the bar that matches the pointer under test.
2. It filtered visible overlays with `offsetParent`, which is null for every `position: fixed`
   element, so the one overlay it existed to name was the one it could never see.
3. It read the copy status 1.5s after the click and reported "Copying..." as the outcome. It now
   polls for a terminal status. Separately, chromium's headless clipboard denies image writes
   unless the origin is granted, so the run only ever exercised the honest fallback; granting it
   proves the success path, and those permission names are chromium's alone (asking webkit for them
   poisons the context so every later call fails).

**The inert-HUD window, measured rather than inferred.** Independently found and quantified: the
HUD is painted by `ui.enterWorld()` at `coincommunities.js:1455` and `phase = 'world'` is not set
until line 1898, after the whole async world build. Every world hotkey and every HUD button routes
through a `phase !== 'world'` guard that returns silently, so the window is not "slow", it is
unresponsive with no feedback. Four runs here measured 240.6s, 292.6s, 392.8s and (in the other
session) 142s. Those magnitudes are swiftshader on a shared box, not production, but the mechanism
is real and shows on any slow device. Not fixed here on purpose: two commits landed on that exact
code path from another session while this was being measured (`9647898af` the button busy state,
`36ed209bf` the parallel-compile guard), and a third hand in one method is how work gets lost.
World mode names the window as its own measurement rather than reporting it as a dead key binding.

**A duplicate community announcement, caught and removed (`c71cfae49`).** Both sessions wrote a
changelog entry for photo mode within the same hour, and both were committed by other agents'
`git add -A` sweeps before either could be reconciled. The feed baked into the next image would
have carried two entries for one feature, and `/api/cron/changelog-push` diffs that feed against DB
state, so the community Telegram channel would have received two posts about the same thing. The
surviving entry is the other session's, which is the more accurate of the two: it announces the fix
that made the feature work at all, rather than announcing a feature that had never once produced a
photo. The duplicate `STRUCTURE.md` row went with it; the surviving row is more complete and
already cites this harness. Feeds regenerated so the data and the generated output agree.

**Also repaired on the way through, both self-inflicted or inherited, both worth naming.**
`f1f28f19c` restores an `inert` attribute on the `/create` hero card that an earlier commit of mine
dropped: a private index read from `HEAD` a moment before another commit landed carries that
commit's file back to its earlier state, so a private-index commit needs its parent pinned and
`git update-ref HEAD <new> <old>` as a compare-and-swap, not a bare `update-ref`. Twice during this
session the SHARED index also held stale entries that a plain `git commit` from any agent would
have turned into a revert of committed work, once including 67 lines of the closeout entry above.
Both were cleared with a path-scoped `git reset` after confirming the worktree already matched
`HEAD`, which touches no file on disk.

**Correction to the above, from the last world run.** World mode's own diagnostic caught the thing
its headline was denying: it printed `sheet=true` with focus on the Download link, so **the card did
open in the real world**, roughly a minute past the 240s `CAPTURE_MS` budget. Two bugs in the check
had hidden that (`10f377b10`): `waitForResponse` only sees responses that arrive after it is
attached, so a module returning in the gap between the key press and the await was invisible to it
and the loop called a live key binding dead, and a preview that lands after the budget was reported
as "no card" rather than as a slow capture. The failure line now distinguishes the two and names the
knob. So the honest statement is that the world capture works and this box cannot photograph it
inside four minutes, not that world mode cannot complete.

**Remains.** World mode still does not finish here, so its last five checks (zen mode, the HUD
button path, overflow) go unverified by this harness at these load averages; they are covered by the
other session's `tests/e2e/play-photo-mode.spec.js`. A real GPU, a quiet machine, or a raised
`CAPTURE_MS` gets the rest. `ENGINE=firefox` needs `npx playwright install firefox` (the installed
build is not the one this Playwright expects).
Sample cards for eyeballing: `photo-scene-chromium/card.png` and `photo-scene-webkit/card.png` under
`/tmp/claude-1000/-workspaces-three-ws/ca2699d0-9f18-493e-ad30-4677e38f0a7f/scratchpad/`.

## 2026-09-02 · Order 02 · /play polish sweep, the in-world half, closed

**Shipped.** Three clean harness runs (desktop, 375, 320) on a quiet box, run sequentially, all three ending: **0 page errors, 0 touch targets under 40px, 0 focus stops without a ring, 0 network failures.** CLS 0.009 / 0.0045 / 0.0053. Logs in the session scratchpad as `final-{desktop,375,320}.log`; load at start of the set was 11.2 on 16 cores, so every wait ran at the harness's 1x scale.

**What the sweep found and fixed, worst first.**

- **The world's join snapshot never reached a client that was still starting up.** Everything `WalkRoom.onJoin` sends a new arrival (guest token, profile, quests, build permissions, the King of the Totem sync) went out while the client was still inside `await joinRoomWithTimeout`, before one `onMessage` handler existed. Colyseus drops a message nothing claims. This was not console noise: `guestToken` is the credential a guest device replays to reclaim its progression, and it was being thrown away. `onJoin` now queues the snapshot; it is sent when the client says `ready`, and after `JOIN_SETTLE_MS` regardless for a client on an older bundle. Backwards-safe in both deploy directions: the room advertises support through a new append-only `acceptsReady` schema field and the client checks it, because an older room build answers an unknown message type by closing the socket with 4002 and would kick every player on a client-first rollout. `311bf8d3e`, `db189da99`, `d344945ee`.
- **Two dead ends worth not repeating.** A 1.2s fallback for clients that never say `ready` re-created the original bug 1.2s later, because a loaded client is not listening by then either; the fallback now matches the broadcast window. And a one-shot flush could be spent by the timer on a client that could not yet hear it, losing the data again, so `ready` always sends (every payload is a full snapshot, so a second copy is a repaint).
- **The friends drawer ignored a cancel and opened seconds later against the player's intent.** `_openFriends` was async and set `_friendsOpen` only after awaiting its chunk, so `_closeFriends` (Escape, J) short-circuited during the load. Reproduced live: `is-open` present with `transform: matrix(1,0,0,1,380,0)`. The frame is now built synchronously with a skeleton roster, a cancel is honoured, and a failed chunk gets a designed error with a retry instead of an unhandled rejection on a dead button. `3d46c7981`, `2921793a2`.
- **Three uncaught TypeErrors, all the same shape:** a `requestAnimationFrame` callback dereferencing state that `close()` had already nulled. The onboarding card threw on every Escape (`aeed7bea1`), and the avatar gallery picker threw when dismissed on the frame it opened (`3a053d758`). The third was ours by proxy: `_warmShaders` called `compileAsync` even without `KHR_parallel_shader_compile`, which buys no parallelism and leaves three.js polling `checkMaterialsReady` over a captured material set on its own rAF loop after our timeout race stopped awaiting it; a material disposed by world entry in that window throws from inside three's callback where no `try/catch` of ours can reach it (`36ed209bf`).
- **Touch targets.** The entire world HUD, the reaction pills, every panel closer, the shop chips, the onboarding skip cross, the jobs board tabs and Accept button, the lobby sort chips and the 31px-wide footer links were all under 40px at 375. Raised under `(pointer: coarse)` and the economy panel's narrow-width block only; desktop density is untouched. `2921793a2`.
- **Layout shift.** 0.2491 at 320 came almost entirely from the economy panel card: centred and content-sized, so swapping a five-row skeleton for a full jobs board grew it and its top edge climbed. At phone widths it now takes the height it was going to reach anyway and the body scrolls inside it. The lobby's preset row (0 to 50px when saved avatars land, shoving the community grid down) and the emote tray (an empty bordered pill before it fills) are reserved and `:empty`-hidden. 0.055 to 0.0045 at 375, 0.2491 to 0.0053 at 320.
- **Billboards flashing in the top-left corner.** Name plates, chat bubbles, mob health bars and the tag marker are anchored at `left:0` with a `-50%` shift, so they sit half over the screen edge for the frames between being created and first projected. Parked off-screen until placed. `44fc9d26e`.
- **Copy.** Banned dashes cleared from the cold-open intro and the onboarding card.

**The harness was lying, in four separate ways, and that is why this order was still open.** Fixed in `a1c7b0c71` and `908f5f8b4`:

- Any agent saving under `src/` hot-reloads every open page, which resets the run mid-journey. The 2026-09-02 desktop run read 0 results for a search term with hits and 8 for a nonsense term, and nothing in the output said why. The audit's context now refuses Vite's HMR socket specifically (same origin, its `?token=`, root path), leaving the world's Colyseus connection alone. `ALLOW_HMR=1` opts back in. **This is the single most important change for anyone running this harness here.**
- Fixed wall-clock waits made a busy box lie rather than run slow. Waits now scale with the load measured at start-up, printed in the run header.
- Every wait failure printed one sentence, so a crashed renderer, a destroyed context and a real timeout were indistinguishable, and the number it reported was the budget rather than the time actually spent.
- The overflow scan counted anything crossing the viewport edge, including labels the projection parks off camera, buttons scrolled out of the mobile emote tray, and closed drawers; the touch scan measured controls inside a closed, fully transparent overlay, and reported a control sitting exactly on 40px as under it. Both now judge what a player can actually see.

Also: the wheel probe matched "emote wheel" before the Wheel of Fortune and silently measured the wrong panel; the leave step referenced a Node binding inside the page and threw, so the journey never once verified the lobby came back (it does: `{"leaveButton":true,"lobbyVisible":true,"worldGone":true}`); and the `NO_WEBGL` comment claimed it measures the lobby cheaply, which it cannot, because the renderer is built in the constructor so nothing paints.

**Measured, and deliberately not "fixed".**

- `game:king` and `floor:beat` still warn 4 to 7 times per run. They arrive in a single burst at one timestamp (all nine at +230.8s in the desktop run, 156s after world entry), which is the signature of a reconnect during a multi-second software-renderer freeze: the socket buffers, and on resume Colyseus dispatches into a room that has not re-attached handlers. Holding broadcasts back further would trade real players' responsiveness for a symptom of this box. Every targeted join message (`guestToken`, `profile`, `quests`, `build-perms`, `tag`) is gone from the warning list.
- `div.cc-label.npc-name` crossing a screen edge is a nameplate tracking an NPC that is itself at the edge. Clamping it would detach it from its subject.
- `[panel:bank]` and `[panel:wheel]` reporting "no trigger visible" is correct, and is now honest: the wheel probe used to match the emote wheel and pass.
- The no-WebGL path degrades to its designed card ("WebGL unavailable", how to re-enable hardware acceleration, Try again, a way home), not a dead loader.

**Evidence.** `npm run check:rules` clean on every touched path. The 22 world-room suites pass (223 tests) and the 11 suites covering the touched client files pass (123 tests). The join handshake was verified in a real browser against the local world server: the same probe that reported nine `onMessage() not registered` warnings and no stored guest token now reports zero warnings and the token in `localStorage`. Changelog entry landed and the feeds rebuilt (`c9892dc8d`).

**Remains.** Nothing in this order. Not deployed: pushes and production deploys are owner-gated, and the world-server change needs the multiplayer service redeployed for the handshake to take effect in production (the client half is inert until then, by design).

**Not mine.** The full `vitest run` has 12 failures across 10 files, none in /play; `tests/cron-scheduler-sync.test.js` (documented cron count vs `vercel.json`) and `tests/api/x402-discovery-parity.test.js` sit on peers' in-flight work, and the latter passes in isolation. Every file I touched was swept into other agents' commits by their `git add -A` runs before I could stage it, which is why the SHAs above are mostly not mine; content verified intact at HEAD in each case.

## 2026-09-04 · Order 02, follow-on pass: three defects inside the friends panel, and the harness bug that made every budget a fiction

Run against HEAD after the 2026-09-02 closing entry above, on a box holding load 48 to 90 on
16 cores all session. That entry and this one are complementary, not duplicates: it fixed the
join-snapshot handshake and the friends *drawer* (chunk load, cancel on Escape); these are
three separate defects in the panel *inside* that drawer, plus one in the harness itself.

**The harness was reporting budgets it never used.** `waitFor` called
`page.waitForFunction(pred, { timeout: left })`, but the signature is
`waitForFunction(fn, arg, options)`, so the options object was the predicate's ARGUMENT and
Playwright silently fell back to its 30s default. Every computed budget was fiction and the
load scaling added on 2026-09-02 was inert. The desktop run printed the contradiction in one
line: `LOADER NEVER CLEARED: Timeout 30000ms exceeded (after 30.0s of a 240s budget)`. Options
now go in the third slot. `8052120c4`. The same mistake is live in three other scripts
(`scripts/verify-ibm-pages.mjs:252`, `scripts/x402-modal-e2e.mjs:101,110`,
`scripts/verify-sign-mirror.mjs:151`); left alone deliberately, because in two of them the
accidental 30s is LONGER than the intended timeout and "fixing" it tightens someone else's
verification without their say-so.

**The friends panel printed a literal `null` on every open.** `render()` ended with
`root.append(tabs, error ? banner : null, tabBody)`. `ParentNode.append()` takes
`(Node or DOMString)`, so a null argument is stringified, not skipped. Confirmed directly in
Chromium: `append(span, null, b)` yields `<span></span>null<b></b>`. Present on both `/play`
and `/walk`, every open, whenever there was no error, which is the normal case.

**An unreachable friends API said "No friends yet".** `friends.js` sets `loadError = 'network'`
with `loaded = true`; `render()` branched only on `!loaded` and `'signin'`, so a failed read
fell through to the empty state and told the player their graph was empty when we had merely
failed to look. The file's own header claimed that state was designed. It now shows a
retryable error, and if an earlier read succeeded it keeps that roster up and marks it stale
rather than discarding a list the player can still act on.

**Recovery was invisible.** After a failed read, a successful retry set `loadError = null` but
only emitted when the graph *signature* changed, so recovering to an identical roster left the
error card up forever. Recovery now counts as a state change. `2ec4ef743`.

Reproduced and re-verified in a real browser on `/play` in the $THREE world with `/api/friends`
aborted at the route. Before: `FriendsRequestsAdd` `null` `🫂No friends yet Search to add
someone…`. After: `📡Could not reach your friends list. The connection dropped on the way.
Nothing was lost, it just needs another go. [Try again]`. Servers 200 at both ends of both runs.

**Server console.** `WalkRoom` still used the deprecated `room.send(client, type, payload)` at
two call sites (the King of the Totem join sync, and the tag handover), so every ordinary join
printed `DEPRECATION WARNING: use client.send(...)` onto the exact log a sweep reads to tell a
real join failure from a healthy one. Both now call `client.send(...)`; the wire message is
unchanged. Verified on the restarted server: 2 joins, 0 deprecation warnings. `938db1055`. The
tag test stubbed the old `room.send` and so recorded nothing after the change; the recorder now
lives on each fake client, assertions unchanged. `51efcaba4`.

**Three runs captured** (desktop with `TAB_CHECK`, 375, 320), each bracketed by server-liveness
checks that returned 200/200 at start and end. Lobby halves clean and consistent at all three
widths: 21 cards, 0 skeletons, 7 presets, 0 focus stops without a ring, 0 refusing focus, 0
touch targets under 40px, 0 network failures, CLS 0.0059 / 0.01 / 0.02, Escape closing the
create and gallery modals at every width, and 25 Tab presses reaching 24 distinct controls with
no trap. Logs in the session scratchpad under `runs/`.

**Measured and deliberately not fixed.** `div.cc-label.npc-name` crossing a screen edge (at 375
and at 320) is a nameplate tracking an NPC that is itself at the edge; clamping it would detach
it from its subject. The residual `game:king` / `floor:beat` warnings trace to joins that never
completed (`seat reservation expired`, status pill never reaching `online`), so the client's
whole `onMessage` block never ran; that is this box, and `db189da99` / `d344945ee` are the real
cure.

**Remains, and why this prompt file stays on disk.** The order's first definition-of-done line
is "three clean harness runs captured on a quiet box". Load never fell below 46 in this session
and two of the three world halves ran against a client that never reached `online`, so that
line did not pass for me and the order's own rule is "never delete this file on a partial". The
lobby halves are sound at all three widths; the world half wants one re-run on a quiet box.

**Not mine.** `npm run test:core`: 28,586 passed, 3 files failed. `tests/walkroom-tag.test.js`
was mine and is fixed above. `tests/multiplayer-server-boot.test.js` passes in isolation (13
tests) and failed only under parallel resource contention. `tests/audit-guards.test.js` is a
peer's: `scripts/audit-ibm-hosted-page.mjs` landed in `cbf83b2a0` without a `data/guards.json`
row. Vite was killed once mid-session when another agent's i18n build wrote a large temp tree
into `scripts/.tmp-i18n-build/out/` and flooded the watcher; restarting it standalone rather
than under `dev:walk-all` (which kills both servers when either exits) is what let the later
runs finish.

## 2026-09-08 · Order 06 · Independently re-verified and retired

Order 06 was finished on 2026-09-02 by two sessions (both entries above) but its prompt file was
left on disk, which reads as open work to the next agent. This pass re-derived the state, re-ran
every definition-of-done line that can be run, and retired the file. **No product code changed:
nothing was found to fix.**

**Re-verified here, from output in front of me, not from the ledger.**

- `npx vitest run tests/photo-mode.test.js`: **13 passed**, covering the card geometry at
  landscape / portrait / tiny, the preview sheet, Escape, the retake, the clipboard fallback and
  the event stamp.
- `npm run check:rules --paths` over all six photo-mode files: clean.
- **Lazy import re-proved by reading, not by trusting the comment.** `photo-mode.js` is reached
  only through `await import('./photo-mode.js')` at `coincommunities.js:4683`; a grep for a static
  import across `src/` returns nothing but the module's own `import './photo-mode.css'`, which
  lives inside the lazy chunk. A session that never presses the button downloads none of it.
- **Both engines, scene mode, 12/13 each** (`scripts/play-photo-mode-check.mjs`). The numbers
  reproduce the 2026-09-02 run almost exactly, which is the point of re-running it:

  | Fact | chromium | webkit |
  |---|---|---|
  | capture is not a black frame | 100% non-black, mean luma 53.5 | 100% non-black, mean luma 53.6 |
  | a real rendered scene, not a flat fill | 24 distinct colours | 22 distinct colours |
  | card PNG on disk | magic `89504e470d0a1a0a`, 960x654, 40,513 B | same magic, 960x654, 21,928 B |
  | focus lands on Download | true | true |
  | console errors or warnings from photo mode | none | none |

  (The byte counts differ from the earlier run's 40,494 / 21,870 by the width of the timestamp
  drawn into the card, which is the expected difference for a different day.)

**The one line I could not close, and why it is not a product defect.** The 13th check, clicking
Download and reading the saved file, timed out both times at the harness's 30s
`page.click`. The box was at a **load average of 292** with three other agents' Playwright gates
running. The locator resolved to the right element every time and the log names it in full: the
anchor carries `download="threews-three-2026-09-08_172847.png"` and a live `blob:` href, and
playwright was still in "waiting for element to be visible, enabled and stable" when it gave up,
which is a thrashing machine, not a dead button. What the click would have proved is proved
anyway from the other side: the composited card was written to disk by both engines and is a real
PNG containing the world (magic and dimensions above), and the 2026-09-02 run asserted the
downloaded bytes on a quieter box. Sample card for the owner to eyeball:
`.../scratchpad/photo-chromium/card.png` (session scratchpad, per the no-screenshots hygiene
rule). It renders the world, the three.ws mark, the `$THREE · three.ws` subline and `Sep 8, 2026`;
no event stamp, correctly, since no event window is open today.

**Suite.** `npm run test:core`: **29,005 passed, 4 failed across 3 files, none of them photo-mode.**
All three traced to other agents' work in this shared worktree, none fixed here because none block
this order: `tests/resilience-shared.test.js` is a TTL-cache timing assertion that **passes in
isolation** and failed only under the load above; `tests/money-rpc-resilience.test.js` exercises
`getGcpAccessToken` and fails against a peer's **uncommitted 95-line edit to
`api/_lib/gcp-auth.js`** sitting in the tree; `tests/audit-guards.test.js` is the guards-registry
failure already named in the 2026-09-02 entry.

**Remains.** Nothing in this order. Photo mode is still behind the same deploy gap as the rest of
`main`: production serves the pre-fix build until an owner-gated deploy carries these commits.
