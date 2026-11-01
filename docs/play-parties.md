# Parties in /play

A party is a small group (up to 8) that stays together across the world. Members get a distinct sky-blue nameplate accent, minimap blips, screen-edge direction chips for members who are off the minimap, a private chat scope, and a one-tap "go to" action.

## Using it

- **Invite.** Open a player's inspect panel and press "Invite to party" (works for guests too), or press the party icon on a friend in the friends drawer (the friend must be online).
- **Respond.** An invite arrives as a card with Accept and Decline. The inviter gets a toast either way. Invites expire after 2 minutes.
- **Leave.** Open the party pill (top of the screen) and press Leave. When the last other member leaves, the party dissolves.
- **Cap.** 8 members. The roster shows "n / 8". Inviting into a full party tells you it is full. A player already in a party cannot be invited.
- **Chat.** The chat bar has a World / Party scope button. `/p text` sends to the party from any scope. Party lines have a distinct style.
- **Go to.** In the roster, "Go to" next to a member:
  - Same world: the server teleports you to a safe spot beside them (never inside a block or another player), facing them, with a 20 second cooldown and an arrival ring effect for everyone nearby.
  - Different world: a dialog shows the coin (art, name, symbol, tier) and a Join button that deep links to `/play?coin=...&name=...&symbol=...&image=...&party=<id>`, keeping the party intact. A member standing on the mainland (no coin) cannot be handed off.
- **Edge chips.** A member beyond the minimap range gets a chip at the screen edge showing name and distance. Tap it to go to them.

## Architecture

All traffic is off-schema over one Colyseus message type, `party`, with an `op` field. Server modules:

- `multiplayer/src/party-store.js`: state, no sockets. Same pluggable KV shape as `social-hub.js`: `MemoryKV` locally, `RedisKV` (Upstash REST) when `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` (or the `three_KV_*` / `KV_*` equivalents) are set, via `createKv(env)`.
- `multiplayer/src/party-service.js`: the socket half. Validates, runs the 5 second sweep, relays chat, performs the teleport.
- `multiplayer/src/rooms/WalkRoom.js`: four lines (message route, attach, detach).

Client modules: `src/game/party.js` and `src/game/party.css`, hooked into `coincommunities.js`, `coincommunities-ui.js`, `friends-panel.js` and `community-net.js`.

### Identity

A member is `u:<accountUid>` when signed in, else `p:<playerKey>` (stable guest key). It survives reconnects and moving between worlds.

### Keys and TTLs

| Key | Purpose | TTL |
| --- | --- | --- |
| `party:<pid>` | members, leader, pending invites | 1800 s, refreshed on activity |
| `partyof:<key>` | member to party (NX, so one party per member) | 1800 s |
| `partyinv:<key>` | invites addressed to a member | 120 s |
| `partyloc:<key>` | liveness heartbeat: room, coin, tier | 75 s, renewed every 25 s |
| `partychat:<pid>` | last 30 chat lines | 1800 s |
| `partylock:<pid>` | short NX lock for mutations | few seconds |

### No ghost parties

Every connected member heartbeats `partyloc`. When a member's last socket detaches, a 45 second grace record is written (so a refresh or world hop does not drop them). If a process is hard-killed, the heartbeat stops and the key expires within 75 seconds. A sweep every 5 seconds prunes members whose loc is gone, re-elects the leader, expires stale invites, and dissolves a party that is empty or a lone leader with nothing pending.

### Teleport validation

The server accepts a go-to only if the requester and target are in the same party per the store, both are in the same room, neither is dead, the requester is not driving, and the 20 second cooldown has passed. The arrival spot is on a ring (1.8 m, then 2.6 m) at 8 angles around the target, behind them first, rejecting spots outside the world bounds, inside build blocks, or within 1.1 m of another player.

### Known limits

- Cross-instance invite delivery relies on the sweep, so it can lag up to 5 seconds when inviter and invitee are on different server processes.
- Invites by account id require the invitee to be online (presence record).

## Tests

`tests/party-store.test.js` and `tests/party-service.test.js` cover the store (memory and a Redis-shaped fake client), pruning, the lifecycle, teleport rules and the hard-kill sweep.
