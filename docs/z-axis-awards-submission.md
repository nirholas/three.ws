# Z-Axis Awards 2026 submission plan

Z-Axis Awards (founded by Meshy, Make it 3D Fund). $300k pool, free to enter, worldwide.
Submissions: Nov 17, 2026 to Jan 24, 2027 (UTC). Judging Jan 25 to Feb 14. Winners Feb 17, 2027. Gala at GDC, March 2027.
Contact: zaxisawards@meshy.ai

Every entry is eligible for all three award families (Track, Build in Public, Best Use). Entries are free and unlimited, so enter more than one work.

## Fit by track

| Track | Fit | Entry |
|---|---|---|
| XR (explorable virtual worlds, ready-to-use avatars) | Strongest | `/play` shared 3D world (parties, plaza stage, vehicles, in-world Forge) plus rigged talking avatars from the Forge. See [play-forge-in-world.md](play-forge-in-world.md), [play-parties.md](play-parties.md), [play-vehicles.md](play-vehicles.md). |
| Gaming (playable games, demos, mods) | Strong | `/play` as a playable multiplayer demo. Gacha ([play-gacha.md](play-gacha.md)) and UFO ([play-ufo.md](play-ufo.md)) are the game-shaped loops. |
| Film & Visuals | Possible | Hero clips pipeline (`docs/hero-clips`) and Director mode ([play-director-mode.md](play-director-mode.md)) if a short can be cut from them. |
| 3D Printing, Tabletop, Robotics | Skip | No finished physical output in this product. |

Recommended: two entries. Entry A in XR (avatars plus world). Entry B in Gaming (`/play` as a game). Same product, two framings, different demo videos.

## Best Use of Meshy

The Meshy MCP is already wired into this workspace and Meshy 6 is a selectable BYOK geometry engine in the Forge ([forge.md](forge.md), [mcp-3d-studio.md](mcp-3d-studio.md)). To qualify, the entry has to credit Meshy and show real use. Plan:

1. Generate the hero assets for the entry demo with Meshy (text-to-3D, retexture, rig, animate) using the Meshy account, and keep task IDs as evidence.
2. Show those assets loaded into a three.ws agent avatar and into `/play`.
3. Name Meshy in the entry description, the demo video, and the Build in Public posts.

Meshy credits cost money. Check `meshy_check_balance` and confirm the plan with the owner before spending (Meshy's own cost rule), then generate.

## Build in Public ($150k pool, up to 10 rewarded posts, up to $5k per post)

Every approved post is rewarded by views. Plan 10 short videos, one per beat:

1. Prompt to rigged avatar in the Forge.
2. Avatar talks (voice, Grok).
3. Drop the avatar into `/play`.
4. Party up, plaza stage.
5. Drive a vehicle.
6. In-world Forge: make a prop live.
7. Gacha pull.
8. UFO.
9. Agent with its own wallet.
10. Behind the scenes: the worker grid and engine routing.

Post to X, YouTube, TikTok or Instagram, paste each link into the entry's Build in Public step. Posting is an external-channel action: owner approves each post (CLAUDE.md gate 2).

## Entry copy (draft)

Title: three.ws, the 3D agent world
One line: Type a prompt, get a rigged 3D character with a voice and a wallet, then walk it into a shared multiplayer world.
Tools credited: Meshy (hero asset generation, rigging, animation), three.ws Forge (engine routing, auto-rig), Three.js, glTF.

## Remaining steps and owners

| Step | Owner |
|---|---|
| Confirm Meshy credit spend and generate hero assets | Owner approves, agent runs |
| Record entry demo videos (2) | Owner or agent with `/play` browser harness |
| Create entry on the Z-Axis site and submit | Owner (account, external form) |
| Post Build in Public videos and paste links | Owner approves each post |
| Claim Meshy creator perk (1000 credits) | Owner |

Deadline for all of it: Jan 24, 2027.
