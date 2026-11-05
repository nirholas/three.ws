# packages/

Packages for the three.ws platform: client SDKs, agent tooling, engine bridges, and a large family of MCP servers under the `@three-ws/*` scope. The first table below is everything publishable; the second is internal packages and engine plugins that do not go to npm. Several are npm workspaces declared in the root [package.json](../package.json). Publishing is decided by the filesystem, not by a hand-kept list: a directory holding a `server.json` publishes through `npm run publish:mcp` (npm plus the official MCP registry), everything else with a non-private `package.json` through `npm run publish:packages` (both have `--dry-run` variants). `npm run sync:repos` stages each one as a standalone GitHub mirror under `dist/standalone-mirrors/` and prints the push command; publishing is the owner's call. [data/standalone-mirrors.json](../data/standalone-mirrors.json) is the source of truth for which directory maps to which repo. The full runbook, including the publish preflight, is in [docs/contributing.md](../docs/contributing.md#publishing-packages--standalone-mirrors). Each package's README covers its install, API, and examples.

## Publishable packages

Every directory with a non-private `package.json`: what `npm run publish:packages` and `npm run publish:mcp` ship.

| Package | Description |
| --- | --- |
| [activity-mcp](activity-mcp/README.md) | Read-only MCP server for live discovery: trending agents and coins, the $THREE holder leaderboard, and the activity ticker. |
| [agenc](agenc/README.md) | Client SDK for the AgenC agent-coordination protocol on Solana: tasks, lifecycle, and the agent registry. |
| [agenc-mcp](agenc-mcp/README.md) | MCP server for AgenC coordination: on-chain task marketplace, agent registry, and x402 service discovery. |
| [agent-cli](agent-cli/README.md) | Run a three.ws agent on your own machine: the platform's MCP tools and agent wallet, local files and shell in a resource-limited sandbox, and an approval gate on every risky call. |
| [agent-glance](agent-glance/README.md) | Puts a live three.ws agent on any surface with a slot: home-screen widgets, README badges, Slack unfurls, and an `<agent-glance>` web component. |
| [agent-guards](agent-guards/README.md) | Per-agent spend policies and trade guards that cap what an agent can spend before a transaction is signed. |
| [agent-memory](agent-memory/README.md) | Persistent embeddings-backed memory for agents: store facts, recall semantically, surface working context. |
| [agent-runtime](agent-runtime/README.md) | The three.ws agent engine: a plan and execute decision loop with human-approval gates and a seven-layer GuardChain. |
| [agent-sniper](agent-sniper/README.md) | Embeddable pump.fun sniper engine: library, CLI, MCP server, and x402 paid API. |
| [agent-trader-mcp](agent-trader-mcp/README.md) | MCP server to arm a three.ws agent on Oracle conviction calls, watch what it did, and stop it. Defaults to simulate; live spend is explicit and gated server-side. |
| [agent-vitals](agent-vitals/README.md) | Capability attestation for agents: models an agent's preconditions as a causal graph and returns the root blocker plus the command that clears it. |
| [agentcore-payments-mcp](agentcore-payments-mcp/README.md) | MCP server for platform-managed payment sessions: budgeted, governed x402 spending without private keys. |
| [agents-sdk](agents-sdk/README.md) | Typed TypeScript client for the three.ws v1 Agents API: create, start and chat with agents, run goals, automate, and trade from Solana agent wallets. |
| [agora-mcp](agora-mcp/README.md) | MCP server for Agora, the agent and human economy: job board, economy pulse, passports, and signed real work. |
| [ai-sdk](ai-sdk/README.md) | AI SDK `tool()` definitions for three.ws: forge, rig, render and animate 3D models, and chat with a three.ws agent, from any AI SDK agent loop. |
| [alerts-mcp](alerts-mcp/README.md) | MCP server to manage pump.fun alert rules with in-app, webhook, and Telegram delivery. |
| [alibaba-cloud-mcp](alibaba-cloud-mcp/README.md) | MCP server for Alibaba Cloud DashScope: Qwen chat, embeddings, and model discovery with your own key. |
| [ar-studio](ar-studio/README.md) | A full augmented-reality studio for any web page: place 3D models in your room through the camera, generate new ones from text, share the scene as a link or QR code, and build together in a live room, plus an MCP server for agents. |
| [assets-cli](assets-cli/README.md) | Find a ready-made 3D prop, rigged character or motion clip on three.ws and add it to your project with the code that renders it. Free, with no account or key. |
| [assistant-mcp](assistant-mcp/README.md) | MCP server that generates paste-ready three.ws assistant widget embed code, offline and deterministic. |
| [audio-mcp](audio-mcp/README.md) | MCP server for voice and face: TTS, STT, audio-to-face lipsync, and the motion-capture clip library. |
| [autopilot-mcp](autopilot-mcp/README.md) | MCP server for an agent's autonomous-execution control plane: scopes, daily spend cap, and the propose, execute, undo loop. |
| [avatar-agent-mcp](avatar-agent-mcp/README.md) | MCP server that spawns a textured GLB avatar with a Solana wallet, a voice, and pump.fun launch powers. |
| [avatar-cli](avatar-cli/README.md) | Terminal tooling to scaffold, validate, hash, and preview avatar manifests from your shell or CI. |
| [avatar-schema](avatar-schema/README.md) | JSON Schema and validator for three.ws on-chain avatar manifests. |
| [avatar-stream](avatar-stream/README.md) | Progressive 3D over plain HTTP: a layered A3S stream whose first 50 KB is already a complete, skinned avatar, refined in place by byte-range requests. |
| [billing-mcp](billing-mcp/README.md) | Read-only MCP server for account economics: quotas, metered usage, invoices, receipts, and earnings. |
| [blender-mcp](blender-mcp/README.md) | MCP server that drives a local headless Blender: inspect and convert 3D files, render previews the assistant can see, run bpy scripts, and generate models on the free Forge lane. |
| [brain-mcp](brain-mcp/README.md) | MCP server for the multi-provider LLM router: discover models and run chat completions through any of them. |
| [brownout](brownout/README.md) | Data-provenance headers plus request-scoped fault injection, so you can break an API's upstreams on purpose and prove your integration survives it. |
| [clash-mcp](clash-mcp/README.md) | MCP server for Coin Clash: read the live battle board, or enlist a wallet and rally power for a faction. |
| [concierge-mcp](concierge-mcp/README.md) | MCP server that answers grounded questions about any website and generates Concierge embed code. |
| [copy-mcp](copy-mcp/README.md) | MCP server to manage copy-trade follows: leaders, sizing and guard rules, intent inbox, and fees owed. |
| [create-agent](create-agent/README.md) | One command from a sentence to a rigged, animated 3D agent: `npm create @three-ws/agent`. |
| [forge](forge/README.md) | Generation SDK: text, image, or sketch to a textured, rig-ready GLB in one call. |
| [glb-diff](glb-diff/README.md) | Structural diff for glTF/GLB: geometry, materials, textures, skeletons, and animations, with rename detection, as a library and a CI-ready CLI. |
| [glb-tools](glb-tools/README.md) | Inspect, re-theme, and bake GLB models from the shell or CI over live three.ws endpoints. |
| [guardian](guardian/README.md) | Content safety and governance: risk classification, moderation, autonomous-send caps, and a tamper-evident audit ledger. |
| [herald-mcp](herald-mcp/README.md) | MCP server that has a 3D character walk onto the browser tab a human already has open and say something out loud. |
| [home-bridge](home-bridge/README.md) | Connects an agent to a real Home Assistant instance: live entity state, guarded service calls, and a room graph for the 3D scene. |
| [home-mcp](home-mcp/README.md) | MCP server giving an assistant safe control of a real Home Assistant house, behind a gate that refuses anything which opens the building. |
| [hq-mcp](hq-mcp/README.md) | Read-only MCP server for DeFi market tools from three.ws HQ: yields, chain TVL, funding, liquidations, whale flow, gas, and a portfolio risk score. |
| [ibm-watsonx-mcp](ibm-watsonx-mcp/README.md) | MCP server for IBM watsonx.ai with Granite foundation models, using your own IBM Cloud credentials. |
| [ibm-x402-mcp](ibm-x402-mcp/README.md) | x402 pay-per-use MCP server for IBM Granite AI, paid in USDC on Solana, no IBM account required. |
| [intel](intel/README.md) | Intelligence SDK: sentiment pulse, narrative intel, momentum-ranked scans, and live Solana token snapshots. |
| [intel-mcp](intel-mcp/README.md) | Read-only MCP server for market intelligence: smart-money scoring, wallet intel, signals, and KOL leaderboards. |
| [irl](irl/README.md) | Client for geofenced real-world presence: check-ins, nearby discovery, encounters, drops, and proof-of-presence quests. |
| [knock-mcp](knock-mcp/README.md) | MCP server to reach a real person: read what they charge, browse open doors, knock, and read the reply. Quotes paid doors, holds no wallet. |
| [knock-sdk](knock-sdk/README.md) | Publish a priced door and let anyone pay to send one message through, delivered in person by the recipient's 3D companion. |
| [kol-mcp](kol-mcp/README.md) | Read-only MCP server for one tracked KOL wallet: portfolio P&L and its trades on a given mint. |
| [langchain](langchain/README.md) | LangChain JS `tool()` definitions for three.ws: forge, rig, render and animate 3D models, and chat with a three.ws agent, from any LangChain agent. |
| [loom-mcp](loom-mcp/README.md) | MCP server for the Loom community 3D-creation gallery: browse the feed, fetch a creation, submit your own. |
| [marketplace-mcp](marketplace-mcp/README.md) | Read-only MCP server for the agent marketplace and skills catalog. |
| [mcp](mcp/README.md) | One stdio MCP server for every three.ws tool: a zero-dependency proxy to the unified `https://three.ws/mcp` endpoint, authenticated with `THREE_WS_API_KEY`. |
| [mcp-policy](mcp-policy/README.md) | The shared three.ws MCP tool policy: every tool's group and tier, read-only by default, with money behind a named confirm flag and a fresh preview id. |
| [metaplex-agent-mcp](metaplex-agent-mcp/README.md) | MCP server that deploys an agent on-chain into the Metaplex Agent Registry on Solana in one atomic transaction. |
| [mocap](mocap/README.md) | Motion capture as an API: webcam or video to face, pose, and hand animation clips, replayable on any avatar. |
| [motion](motion/README.md) | Text and structure to a three.js AnimationClip: forward and inverse kinematics, balance, ground contact, and secondary motion, with no mocap data. |
| [names](names/README.md) | ENS and SNS name resolution, threews.sol subdomain minting, and pay-by-name in one import. |
| [naming-mcp](naming-mcp/README.md) | MCP server to resolve .sol names and check threews.sol agent-handle availability. |
| [notifications-mcp](notifications-mcp/README.md) | MCP server for the notification inbox: list events, mark read, tune delivery, register Web Push devices. |
| [onchain-agent-wallets](onchain-agent-wallets/README.md) | Gives an agent a real Solana wallet with a spending allowance instead of your keys. |
| [oracle-mcp](oracle-mcp/README.md) | Read-only MCP server for the three.ws Oracle: live pump.fun conviction feed, scored coins, resolved wins, backtests, and wallet intelligence. |
| [oracle-model](oracle-model/README.md) | The three.ws Oracle conviction model running locally: score any pump.fun launch offline from the real bucket weights, no API key. |
| [portal](portal/README.md) | Turns any website into a walkable 3D city: sections become buildings, links become doors, images become billboards. |
| [portfolio-mcp](portfolio-mcp/README.md) | MCP server for an agent's trading state: portfolio, balances, PnL feed, and one signed Solana transfer. |
| [pose](pose/README.md) | Deterministic named pose seeds: a natural-language prompt to a stable seed and full joint-rotation map. |
| [provenance-mcp](provenance-mcp/README.md) | MCP server for the agent action-provenance log: append-only, ERC-191 signed, on-chain verifiable. |
| [pumpfun-mcp](pumpfun-mcp/README.md) | Free read-only pump.fun and Solana MCP server: token discovery, curve and holder analysis, fee tracking, quotes. |
| [pumpfun-skills](pumpfun-skills/README.md) | pump.fun launch and trade skills as composable agent tools, with a runtime-supplied mint. |
| [react](react/README.md) | React components for embedding three.ws 3D AI agents in two lines. |
| [readme-3d](readme-3d/README.md) | Converts GLB, glTF, OBJ, and STL models into ASCII STL blocks GitHub renders as live 3D viewers in a README. |
| [render](render/README.md) | Renders rigged, animated avatars to PNG, GIF, and truecolor terminal ANSI with no GPU, no WebGL, and no headless browser. |
| [reputation](reputation/README.md) | SDK to read ERC-8004 agent trust scores and attest agent-to-agent feedback on-chain. |
| [retarget](retarget/README.md) | Retargets animations onto any humanoid GLB by canonicalizing bone names across every major rig convention. |
| [scene-mcp](scene-mcp/README.md) | MCP server that turns one sentence into a placed 3D diorama over the live three.ws pipeline. |
| [see](see/README.md) | Lets an agent see a 3D model: renders any GLB from several angles and returns frames it can look at, plus the geometry facts. |
| [shipfeed](shipfeed/README.md) | Turns raw commit history into a release feed humans read: conventional-commit parsing, audience classification, and changelog-to-commit provenance. |
| [sign-language](sign-language/README.md) | American Sign Language for 3D avatars: compiles text into one continuous signed animation clip, fingerspelling what it does not know. |
| [signals-mcp](signals-mcp/README.md) | MCP server for copy-trade signal feeds: marketplace, publisher leaderboard, subscribe, and kill switch. |
| [skill-license](skill-license/README.md) | On-chain skill licenses: each purchased skill is a 1/1 SPL NFT plus a deterministic PDA. |
| [solana-memo-media-mcp](solana-memo-media-mcp/README.md) | Keyless, read-only MCP server that extracts, validates and displays image data URIs embedded in Solana SPL Memo instructions. |
| [spatial-mcp](spatial-mcp/README.md) | Validator, builder, and conformance fixtures for the Spatial MCP spec (live 3D scenes as MCP tool results). |
| [strategies](strategies/README.md) | Automated on-chain trading strategies for agents: DCA, copy-trading, and mirror execution. |
| [three-token-mcp](three-token-mcp/README.md) | MCP server that lets agents price, hold, and burn $THREE on-chain via the live token rail. |
| [three-ws](three-ws/README.md) | The unscoped `npx three-ws setup` command: a thin launcher for `@three-ws/cli`. |
| [three-ws-cli](three-ws-cli/README.md) | One command to connect any MCP client to three.ws: sign in with OAuth or an API key, write the hosted servers into Claude Code, Cursor, VS Code and more, and verify each with a live `tools/list`. |
| [threews-avatar-mcp](threews-avatar-mcp/README.md) | MCP server that renders a live rotatable avatar inline, plus embed iframe and metadata. |
| [trading-mcp](trading-mcp/README.md) | Quote and fill guarded Solana swaps from a three.ws agent wallet, from any MCP client. The agent never sells $THREE. |
| [tty-3d](tty-3d/README.md) | The terminal 3D renderer core: GLB in, skinned and animated ANSI frames out, plus the `three-tty` CLI. |
| [tty-avatar](tty-avatar/README.md) | A live 3D avatar in the terminal: any GLB or three.ws avatar/agent rendered to truecolor half-blocks or braille, with moods, and Claude Code hooks that make it your coding agent's face. |
| [tutor-mcp](tutor-mcp/README.md) | MCP server for the Pay-As-You-Learn tutor ledger: itemized running tab and attested invoice. |
| [unity-bridge](unity-bridge/README.md) | Unity UPM package (`com.three-ws.forge-bridge`) that generates a 3D model from a text prompt or reference image with the public Forge API and imports it with glTFast. |
| [vanity](vanity/README.md) | WASM-accelerated Solana vanity address mining in the browser or Node, with a paid x402 fallback. |
| [vanity-mcp](vanity-mcp/README.md) | Read-only MCP server for the vanity grind-bounty market and proof-of-grind rarity gallery. |
| [viewer-presets](viewer-presets/README.md) | Tuned visual presets for avatar viewers: light rigs, floor reflection, bloom, and PBR materials. |
| [vision-mcp](vision-mcp/README.md) | MCP server that analyzes and describes images through the three.ws vision pipeline. |
| [voice](voice/README.md) | Speech for avatars: ASR, TTS, and Audio2Face lipsync visemes in one import. |
| [vscode-3d](vscode-3d/README.md) | VS Code extension that renders .glb and .gltf files in an editor tab, retargets library or text-described animations onto them and bakes the result, generates and refines models, optimizes and git-diffs them, AI quality-checks a render, and lint-checks `<agent-3d>` embeds with quick fixes. |
| [vscode-x402](vscode-x402/README.md) | VS Code extension to browse the x402 bazaar, decode 402 challenges, and pay per call from the editor. |
| [witness](witness/README.md) | Records a real user session as intent, not pixels, and compiles it into a Playwright spec that stays red until the reported bug is fixed. |
| [x402-fetch](x402-fetch/README.md) | Drop-in fetch wrapper that automatically pays x402 payment challenges. |
| [x402-mcp](x402-mcp/README.md) | MCP server giving any agent a self-custodial x402 wallet: search the bazaar, inspect prices, pay and call. |
| [x402-preflight](x402-preflight/README.md) | Verifies a signed, time-bounded payability attestation from an x402 seller before you sign anything, and routes you to a rail that works. |
| [x402-server](x402-server/README.md) | The merchant side of x402: issue 402 challenges, price SKUs, verify and settle payments on Solana and Base. |

## Internal and engine-bridge packages

Not published to npm: a `private` package.json (consumed inside this repo or not yet released), or no package.json at all (the Godot and Unreal bridges ship through their engines' own plugin channels).

| Package | Description |
| --- | --- |
| [companion-sdk](companion-sdk/README.md) | Gives a person's notifications a body: a BYOK harness that triages what matters from Telegram, a calendar, an inbox or a phone and hands it to a 3D character that says it aloud, with browser, Node, CLI and MCP clients. |
| [defi-utils](defi-utils/README.md) | Zero-dependency chain IDs, token addresses, ERC-20 ABI fragments, and address validation for EVM chains and Solana. |
| [godot-bridge](godot-bridge/README.md) | Godot 4 addon that generates a 3D model from a text prompt or reference image with the public Forge API and imports it through Godot's native glTF importer. Ships as an addon, not an npm package. |
| [hood-portfolios-sdk](hood-portfolios-sdk/README.md) | Zero-dependency client for Robinhood Chain portfolios: read the holdable universe, generate a basket from a sentence, backtest it, and canonicalise a manifest to the bytes its on-chain hash commits. |
| [node-operator](node-operator/README.md) | Operator client for the three.ws open inference network: a Solana ed25519 node identity, the platform job queue, real local inference, and signed results. |
| [skill-import](skill-import/README.md) | Turns an OpenAPI spec, a GitHub repository or a Solana Anchor IDL into a three.ws skill bundle (`manifest.json`, `tools.json`, `handlers.js`, `SKILL.md`). |
| [tool-sdk](tool-sdk/README.md) | Typed tool authoring for three.ws MCP servers, with per-tool permission manifests. |
| [unreal-bridge](unreal-bridge/README.md) | Unreal Engine plugin that generates a 3D model from a text prompt or reference image with the public Forge API and imports it through Unreal's Interchange glTF pipeline. Ships as a plugin, not an npm package. |
| [wallet-linkage](wallet-linkage/README.md) | Scores whether two to ten Solana wallets share a controller from six on-chain signals (account control, shared fee payer, peer and common first funder, direct transfer, funding burst) combined by noisy-OR into a 0-100 score with evidence. |
