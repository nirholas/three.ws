# Dance-off

A timed, crowd-judged dance contest on the /play dance floor. Dancers on the floor perform, everyone else votes with the reaction bar, and the winner gets a spotlight, confetti, a jumbotron feature and a permanent aura.

Built for $THREE Community Meetup #3 (see `public/event.json`, agenda segment "Dance-off on the floor") but it runs in every walk room.

## Round flow

Server-authoritative. The machine lives in `multiplayer/src/dance-off.js` (pure, injected time) and the room glue in `multiplayer/src/dance-off-room.js`. `WalkRoom` carries four one-line hooks.

| Phase | Default length | What happens |
| --- | --- | --- |
| idle | cooldown | Floor behaves normally. |
| joining | 20 s | Round announced. Step onto the floor (radius 4 around 14, -10) to enter. |
| performing | 75 s | Contestants are snapshotted (max 8). Crowd votes. |
| tally | 4 s | Voting closed, standings shown. |
| winner | 15 s | Spotlight, confetti, jumbotron card, reward, tip card. |

Fewer than two contestants when joining closes dissolves the round quietly. If a disconnect leaves one dancer mid-round the round dissolves. No votes means no winner.

### Cadence

- Inside the event window: a new round every 2.5 minutes after a result, retry after 60 s if a round dissolved.
- Outside it: at most one round every 10 minutes, only when two people are already on the floor, retry after 4 minutes.
- On demand: anyone on the floor can start a round when two are on the floor, 45 s after the previous round, one request per player per 10 s.

## Voting

Vote = a reaction from the reaction bar. The client attaches a target: the pinned contestant chip, otherwise the contestant nearest the screen centre (never yourself). Rules:

- One counted vote per voter per round. Later reactions are confetti only (`dance:ack` has `counted: false`).
- No self-votes. Only contestants can receive votes.
- A leaver's cast vote is removed. A leaving contestant's received votes are removed and those voters may vote again.
- Ties go to whoever reached the tied count first.

Live counts are shown in the HUD during the performance.

## Reward

The winner is granted the event-tier aura `aura-spotlight-dance-champ` (`multiplayer/src/cosmetics-catalog.js`, price 0, never sold) through the idempotent `grantCosmetic`, then `_persistEcon` and `_sendProfile`. A `souvenir` message is sent on the first win only. A repeat win grants nothing new. Every win posts a `dance-off` feed event (`{actor, votes, contestants, coin}`, dedupe key `roomId:roundId`).

## Winner moment (client)

`src/game/dance-off.js` (`DanceOffClient`): HUD, floor rings and spotlight beam, confetti, a jumbotron card with the winner's name, votes and an avatar snapshot (offscreen render target, letter disc fallback), and the tip card.

## Tipping the winner

The tip is an x402 payment and is never automatic. The card fetches the real challenge from `GET /api/x402/dance-tip`, shows recipient, network, amount and what it pays for, and requires an explicit "Confirm and pay" click, after which the standard checkout asks the wallet to approve. The recipient is the platform club stage wallet, not the winner, and the card says so.

## Dev knobs (server env)

- `DANCE_OFF=off` disables the feature.
- `DANCE_OFF_TIMINGS="joinMs=6000,performMs=14000,..."` overrides timings (keys: joinMs, performMs, tallyMs, winnerMs, cooldownMs, eventCooldownMs, retryMs, eventRetryMs, onDemandGapMs).
- `DANCE_OFF_FORCE_LIVE=1` treats the event window as open.

## Tests

`tests/dance-off.test.js` (tally and transitions), `tests/dance-off-room.test.js` (room glue, grant-once, feed event, disconnects).
