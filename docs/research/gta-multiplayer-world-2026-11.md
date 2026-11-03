# A realistic GTA-style multiplayer world for three.ws (research, 2026-11-03)

Goal: host a realistic, open-world, crime/driving/shooting multiplayer game alongside `/play` (which stays exactly as it is), reachable from three.ws, with $THREE wired in. This note covers what exists, what we can legally adopt, what it costs, and the recommended path.

## TL;DR

- **Nothing open source is "GTA Online, ready to host."** Every project that looks like it ships GTA itself either needs Rockstar's game files or gets taken down.
- **The realistic route is Unreal Engine 5:** Epic's free **City Sample** (the Matrix Awakens city: 13 drivable vehicles, crowds, traffic, Nanite/Lumen), plus off-the-shelf **replicated multiplayer kits** from Fab for vehicles and weapons, run on a **dedicated server** and **streamed to the browser with Pixel Streaming** from GCP L4 GPUs. That is how the "photoreal game in a browser tab" demos people post on X work.
- **For the Call of Duty feel:** Epic's free **Lyra Starter Game** is a multiplayer shooter with dedicated-server support out of the box. It uses the same pipeline.
- **GCP credits pay for it.** Per-player GPU streaming is the main cost, and it is a pre-approved GCP surface.
- **Avoid FiveM/alt:V, the viral GTA V/GTA III browser ports, and the Call of Duty "Moon Zombies" remake.** Reasons are under "Ruled out."

## Finished GTA-style projects we could adopt as-is (added 2026-11-03)

Nothing is realistic, multiplayer, finished and open all at once. These are the closest finished games, ranked by how well they fit three.ws.

| Project | What you get | Multiplayer | Realism | License / price | Fit |
|---|---|---|---|---|---|
| [Overdrive City](https://github.com/appleweiping/overdrive-city) ([play](https://appleweiping.github.io/overdrive-city/)) | On foot plus driving, fists/pistol/SMG, carjacking, lane-following traffic, 5-star police (foot cops, then ramming cruisers), arrest/death penalties, 10 job types (deliveries, taxi, stealth, races, drift, bounties), day/night. About 3,400 lines of plain three.js ES modules, no build, no asset files | No | Stylized, procedural | MIT (plain, no added clauses). Pushed 2026-10-23 | Best. Same stack as `/play`: add multiplayer through our Colyseus server (`multiplayer/`), swap in three.ws avatars, add Sketchbook's vehicle controllers |
| [Advanced Multiplayer Game Template](https://assetstore.unity.com/packages/templates/systems/advanced-multiplayer-game-template-241288) (Redicion Studio) | Complete Unity 6 game marketed as "GTA Online in Unity": open world, car theft, vehicle damage, projectile weapons | Yes (networking library and dedicated-server support not published) | Mid (HDRP/URP) | $70, Unity Asset Store EULA. v1.14, 2026-03-29, ~54 reviews | Best finished multiplayer one. In the browser it needs a URP WebGL build (HDRP cannot target WebGL) or GPU streaming |
| [Gangster Crime Simulator](https://assets4unity.com/downloads/gangster-crime-simulator/) | Complete Unity 2022.3 project: shooting, cars/bikes/helicopters/tanks, missions, police chases, city | No | Mobile-game grade | $99.99. Resale rights not stated | Single player, arcade (super powers, cheats) |

Avoid kits sold under GTA names or advertising a "full GTA 5 map" (for example NeezGames' "Grand Theft Auto V Remake Unity Template"): they carry Rockstar trademarks or content and invite takedowns.

## Recommended path: UE5 city + Pixel Streaming (codename "three.ws City")

| Layer | What | Cost / license |
|---|---|---|
| World | [City Sample](https://www.fab.com/listings/4898e707-7855-404b-af0e-a505ee690e68) (free; separate packs for buildings, 13 vehicles and rigged crowds) | Free, "UE-Only" license: commercial use allowed in any Unreal-built product ([Epic forum confirmation](https://forums.unrealengine.com/t/commercial-use-of-free-matrix-city-sample/611823)). The Fab version is now PCG-driven and has Unreal MCP building primitives, so an LLM can lay out city blocks. |
| Multiplayer base | [make-live/multiplayer](https://github.com/make-live/multiplayer) (MIT): UE5 template with World Partition 2x2 km map, Gameplay Ability System, Pixel Streaming already enabled | Free. Dated (2022), so expect a port to current UE5. It is a reference, not a dependency. |
| Vehicles | [Drivable Cars: Advanced Multiplayer Vehicle System](https://www.fab.com/listings/65a0844c-6be4-4e38-9d7a-b9697681a274): fully replicated Chaos vehicles, enter/exit, damage, listen + dedicated server | Paid Fab asset (one-time) |
| Weapons / characters | [Multiplayer Game Template (MPGT) for TPS & FPS](https://www.fab.com/listings/e89364ce-5efa-47db-907a-c88c15e1675d) or [FPS Multiplayer Template 6](https://www.fab.com/listings/29219f54-56aa-45bb-92f9-01ca45833fe5) | Paid Fab asset. Note: MPGT says its own vehicles are "not fully replicated", so pair it with the vehicle system above. |
| Shooter mode | [Lyra Starter Game](https://www.fab.com/listings/93faede1-4434-47c0-85f1-bf27c0820ad0): Epic's multiplayer shooter sample; dedicated servers work with no code changes | Free, Unreal EULA (source-available, not OSI open source) |
| Browser delivery | Epic's Pixel Streaming 2 + [PixelStreamingInfrastructure](https://github.com/EpicGames/PixelStreamingInfrastructure) (signalling server, web player) | Free/MIT |
| Hosting | Dedicated game server on CPU (Compute Engine or GKE). One UE render instance per player on G2 (NVIDIA L4) VMs, plus a TURN relay | GCP credits |

### How it plugs into three.ws

- New route (for example `/city`) with its own page. `/play` is untouched.
- The page embeds the Pixel Streaming web player. Its **data channel** carries JSON between the page and the game, so our existing web code stays the single source of truth for login, the wallet, and $THREE: sign-in, the cash/bank balance and purchases are done in the page and pushed into the game as events. No wallet code runs inside Unreal.
- Avatars: three.ws GLBs can be imported at runtime with the glTFRuntime plugin and retargeted to the UE mannequin, so a player's three.ws avatar is their character in the city.
- A downloadable native client (Windows/Linux) costs us only the dedicated server. That serves players with a GPU and leaves streaming for everyone else.

### Cost model (GCP, us-central1, Oct 2026 list prices)

g2-standard-4 (1x L4) is $0.70/hr on demand, about $0.42/hr spot, and $0.32/hr on a 3-year commitment ([source](https://computeprices.com/providers/google/gpus/l4)). Running 2-3 UE instances per L4 is feasible at 720p/medium settings, but the photoreal city needs closer to one per GPU.

| Peak concurrent players | Hours/day | On-demand, 1 per GPU | Spot |
|---|---|---|---|
| 10 | 8 | ~$1,700/mo | ~$1,000/mo |
| 50 | 8 | ~$8,400/mo | ~$5,000/mo |
| 200 | 10 | ~$42,000/mo | ~$25,000/mo |

Plus egress (about 3-5 GB per player-hour at 1080p) and a small dedicated-server VM. Autoscale GPU instances to zero when idle, because warm idle GPUs are the main source of waste ([cost guide](https://www.strayspark.studio/blog/pixel-streaming-ue5-cloud-gaming-demo)). Managed alternatives, if we don't want to run the GPU fleet ourselves: [Streampixel](https://www.streampixel.io/pricing) at EUR 99/mo for 2 concurrent users plus EUR 45/mo per extra user, or Arcware at about $0.50-1.00 per stream-hour.

### What it takes

1. An Unreal developer (C++/Blueprints, UE dedicated servers) for the game itself. Our current stack is JS/three.js, so this is either a hire/contract or a long ramp. This is the real cost, not hosting.
2. A GCP GPU quota increase for G2/L4 in us-central1. Request it early, because approval can take days.
3. A Linux source build of UE5 for the dedicated server target.
4. Milestones: (a) City Sample streaming to a three.ws page for one player; (b) dedicated server with 8-16 players driving; (c) weapons, police/wanted system, missions; (d) data-channel bridge for wallet, cash and $THREE; (e) autoscaling fleet and matchmaking.

## Browser-native alternative (cheaper, less realistic)

If per-player GPU cost or the Unreal skill gap is the blocker, keep it in three.js and reuse our own Colyseus server (`multiplayer/`):

- [swift502/Sketchbook](https://github.com/swift502/Sketchbook) (MIT, 1.7k stars): three.js + cannon.js sandbox with GTA-style walk/drive/fly (cars, helicopters, airplanes), enter/exit animations. Single player, last pushed 2024. Its character and vehicle controllers are the best open three.js base for this genre.
- [depixeled-chris/gta7](https://github.com/depixeled-chris/gta7) (MIT): a small TypeScript + three.js open-world driving slice. Useful as reference only.

Realism tops out well below UE5 (no Lumen/Nanite-class lighting or density), but it costs almost nothing per player and runs on phones.

## Other platforms considered

- **s&box** ([Facepunch/sbox-public](https://github.com/Facepunch/sbox-public), MIT on top of proprietary Source 2; launched 2026-04-28): built-in multiplayer, and a Valve deal allows royalty-free standalone Steam releases. But it is a Steam/desktop platform, not embeddable in three.ws, and Source 2 visuals are below UE5.
- **OpenLiberty** (Godot, MIT), **OpenRW**, **SanAndreasUnity**: open engines that **require the original GTA game files** to have a world. That makes them unusable for a hosted product.

## Ruled out (and why)

- **FiveM / RedM / alt:V (GTA V roleplay servers).** These are the most "GTA Online" experience, but Rockstar's Mod Guidelines (2026-09-10) and the Cfx.re platform license ban cryptocurrency, NFTs, crypto advertising, gacha/loot boxes and selling in-game currency, and limit monetization to Rockstar's approved Tebex flow ([summary](https://techwiser.com/rockstar-games-official-modding-guidelines/), [monetization rules](https://www.gameserverkings.com/knowledge-base/fivem/server-monetisation/)). A $THREE world would break those terms on day one. Every player would also need a paid GTA V PC copy, and none of it runs in a browser.
- **Viral GTA V / GTA III / Vice City browser ports (playgta5.com, quenq, "GTA 5 web port" sites).** These are WebAssembly builds of Rockstar code and assets. The original GTA V site went offline within hours ([background](https://portedgames.com/gta-3/)).
- **"Call of Duty in the browser" remakes.** The three.js recreation of the Black Ops Zombies map "Moon" was DMCA'd by Activision on 2026-10-10. Recreating a specific franchise's maps, characters or names is a takedown waiting to happen. An original city and original modes are the only safe route.
- **NotBlox** ([iErcann/Notblox](https://github.com/iErcann/Notblox)): three.js + Rapier multiplayer with cars, explicitly "GTA-like" in intent. Its MIT license adds a clause **forbidding any use related to blockchain or cryptocurrency**, so we cannot adopt or fork it.
- **Glavin001/open-world** (OSM-generated multiplayer city): abandoned since 2018 and unlicensed.
