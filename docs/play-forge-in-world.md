# Forge in world: spawn items into a `/play` server from a prompt

In [`/play`](https://three.ws/play), every coin is its own live server. Until now you could
only place props that already existed: a hand-authored catalog piece, a community gallery
model, or a `.glb` you uploaded yourself. Forge-in-world removes that last limit. Describe
an item in words, or hand it a photo, place its hologram where you want it, and when the
forge finishes (about 90 seconds on a warm lane) a real textured 3D model lands on that
spot, visible to everyone connected to that server.

Nothing is faked. The text goes to the same free forge lane that powers
[`/forge`](https://three.ws/forge), the result is a genuine GLB in three.ws storage, and it
reaches other players over the world's existing object channel, which means it persists in
the world exactly like a block you placed by hand.

## Using it

### From the build palette

1. Enter a world and press `B` (or tap **Build**) to open build mode.
2. In the **Props** palette, click **Forge**.
3. Type what you want, for example `a mossy stone lantern with a copper roof`.
4. Optionally click **Photo** and attach a PNG, JPEG, or WebP reference image (up to
   8 MB). With a photo attached, the prompt becomes a hint rather than the whole brief.
5. Click **Forge**. A hologram of the item is armed straight away as
   `<name> (forging)` in the palette. Click the ground to place it: a translucent,
   scanning box marks the spot with a small card above it showing the real job state
   (`Sending to the forge…`, `Forging: waiting for a slot…`, `Forging your model (25s in)…`)
   and a **Cancel** button. `R` rotates the hologram before you commit.
6. Keep building while it forges. When the model is ready it is checked against your
   device's size budget, then it lands exactly where the hologram stood, with the
   hologram dissolving into it. The room broadcasts it to everyone in the server.

If the forge finishes before you place the hologram (a cached prompt answers in about
3 seconds), the finished model is armed instead and lands wherever you click.

**When a forge fails** (the lane refuses the prompt, the photo is the wrong format, the
model is too detailed to simplify), a placed hologram turns red and becomes an error
marker with the reason, **Retry** (forge again for the same spot) and **Dismiss**.
Keyboard focus moves to Retry. A failure never touches your build budget: the hologram is
local until a real model lands, so only a landed item counts against the per-player cap.

**Session history.** Under the form, *This session* lists every forge you started:
finished ones show how long they took and their triangle count with a **Place** button
to put down another copy, failed ones show the reason with **Retry**. The hint above it
quotes your own last generation time next to the typical one, so the wait is honest.

### From world chat

Type a slash command into the chat box:

```
/forge a brass telescope on a tripod
```

Chat is the fastest path because you do not have to open the palette first. The command
answers locally (it is never broadcast to the other players), and when the model is ready
build mode opens with the new prop armed and waiting for your click. A bare `/forge` with
no description replies with a usage hint instead of sending `/forge` to the room.

## What everyone else sees

The moment you place a forged item, it becomes a `WorldObject` in the room's authoritative
state and Colyseus broadcasts it to every other client in that server. Their client reads
the model URL off the object itself, so nobody needs your palette entry, a page reload, or
the same version of the app. The world's persistence layer saves it with the rest of the
build, so the item is still standing when the room is next created.

That is the whole point of forging inside a server rather than on `/forge`: the thing you
imagined is instantly part of a shared place, not a file in your downloads folder.

## Cost and limits

| | |
|---|---|
| Price | Free. Forge-in-world uses the draft tier, which needs no account, wallet, or key. |
| Typical time | About 90 seconds on a warm lane, up to 6 minutes when the lane is busy or waking up. A repeat of a cached prompt answers in about 3 seconds. Measured on production on 2026-11-03: 88 s, 92 s, and 355 s for three fresh prompts. |
| Concurrency | One forge at a time per player in the client. The server adds a 20 second cooldown per player and admits at most 4 in-world forges per world per 90 seconds. |
| Rate limit replies | A refused in-world forge returns HTTP 429 with `scope` (`player` or `world`) and `retry_after` seconds. The client says which one tripped and how long to wait. A world refusal refunds the player's cooldown. |
| World caps | Forged props count against the normal build budget: 200 objects per world, 30 per player. A failed forge counts against neither. |
| Size ceilings | See below. |

### Size ceilings

Every forged model is downloaded and measured (bytes from `Content-Length`, triangles
from the GLB itself) before it is placed. The ceiling depends on the device's render
tier, and a touch-first (coarse pointer) device steps down one tier:

| Tier | Triangles | File size |
|---|---|---|
| high | 100,000 | 8 MB |
| medium | 60,000 | 6 MB |
| low | 30,000 | 3 MB |

A model over budget is simplified server-side (`/api/forge-remesh`) and the simplified copy
is mirrored into world storage. If it still does not fit, the forge fails with a message
that says how big it was. The tiers live in
[src/game/prop-budget.js](../src/game/prop-budget.js).

The room enforces its own ceiling regardless of client: before admitting any model prop,
`WalkRoom` sends a `HEAD` to the asset and refuses anything over 8 MB with
`obj:reject { reason: 'asset_size' }`. An unreachable probe fails open so a storage hiccup
never blocks building, and results are cached per URL.

Forged models are recorded against the same anonymous client id `/forge` uses
(`localStorage['forge:cid']`), so anything you make in-world also appears in that browser's
forge history.

## How it fits together

```
palette form / "/forge" chat        src/game/coincommunities-ui.js
  -> onForgeProp handler            src/game/coincommunities.js   (_forgeProp)
    -> ForgeSession.begin()         src/game/forge-session.js     (job state + history)
    -> arm hologram                 FORGE_HOLO_TYPE in world-objects.js, PropGhost tint
    -> click -> ForgeHologram       src/game/forge-hologram.js    (placed, card, tick)
    -> forgeWorldProp()             src/game/forge-prop.js
      -> POST /api/forge {world}    free draft lane; 429 carries scope + retry_after
      -> GET  /api/forge?job=<id>   polled to completion
      -> enforcePropBudget()        measure, remesh if over the device tier
    -> registerUploadedProp(url)    src/game/world-objects.js
  -> net.spawnObject(..., id)       obj:spawn at the hologram pose, tracked by PendingSpawns
    -> WalkRoom._handleObjSpawn     multiplayer/src/rooms/WalkRoom.js
      -> normalizePropAssetUrl      multiplayer/src/build-limits.js  (allow-list)
      -> probePropAsset             HEAD size check, 8 MB room ceiling
      -> state.objects broadcast    every client renders it; hologram materializes
      -> or obj:reject {reason,id}  client rolls back the palette entry
```

Two details worth knowing if you are extending this:

**The forge URL is already trusted.** Finished models are served from three.ws storage
(`https://three.ws/cdn/forge/...`), which is on the world asset allow-list
(`normalizePropAssetUrl` in [multiplayer/src/build-limits.js](../multiplayer/src/build-limits.js)).
An off-list host is refused with `obj:reject` carrying `reason: 'asset_url'`.

**Refusals roll back.** The room echoes the client's spawn id on `obj:reject`, so the client
knows exactly which model was refused. For a model the room cannot load (`asset_url`,
`asset_size`) the client removes its palette entry and prop definition, so no phantom
button is left behind, and a forge hologram that was waiting on that spawn becomes an error
marker. Budget and placement refusals (`world_full`, `player_full`, `protected`, `dense`) keep the
model in the palette; a waiting hologram shows the reason with **Place again**, so the
model can go down elsewhere or once space frees up, without forging it a second time.

**Reduced motion.** With `prefers-reduced-motion`, the hologram does not pulse or sweep and
the landing is instant instead of a dissolve.

**Nothing new is on the wire.** Forged props travel as ordinary world objects. The `url`
field that carries player uploads carries these too, so older clients, the persistence
layer, ownership checks, and the per-player object cap all apply without modification.

## Related

- [3D asset pipeline](3d-asset-pipeline.md): what the forge lanes are and how they differ
- [In-game economy](in-game-economy.md): the rest of what you can do inside a `/play` world
- [/forge](https://three.ws/forge): the full studio, with paid tiers, rigging, and game-ready export
