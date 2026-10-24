# Skill directory listing copy

Draft listing text for skill directories and registries. One paragraph per skill
shipped in the standalone repos (the three.ws-authored skills; vendored partner skills
and the maintainer-only `gcp-triage` are excluded). Drafted for review, not posted.
Every install line below is exact once the repos are published (an owner-gated step,
see [agent-skills.md](agent-skills.md#standalone-repos-install-without-cloning-this-one)).

Repo-level blurb for any directory that lists a whole repository:

> Skills for any agent runtime that reads the open Agent Skills format. Generate and
> rig 3D models and avatars, build and monetize agents on three.ws, and run a wallet in
> the x402 agent economy. Install everything with `npx skills add nirholas/three-ws-skills`,
> or only the crypto-free 3D set with `npx skills add nirholas/three-ws-3d-skills`.

## 3D and avatars

**anatomy.** Ask how an engine, turbine, reactor, pump or clock works and get an
interactive isometric 3D cutaway instead of a paragraph: moving parts, fire, steam and
sparks, a section cut, an exploded view and a guided tour, delivered as a shareable
three.ws link.

**create-3d-avatar.** Turn a text prompt or a reference image into a rigged,
animation-ready humanoid avatar in one step. Returns the GLB and a pose-studio link, so
the character can be posed and animated straight away.

**embed-three-ws-avatar.** Put a live, animated three.ws avatar on any website with the
`<agent-3d>` web component. Covers framework-agnostic embedding, driving animations and
moods from page code, and letting visitors design an avatar in the Avatar Studio.

**find-3d-assets.** Search thousands of ready-made CC0 props, rigged characters and motion
clips and get paste-ready code or a downloaded file. Free, with no account and no key.
Check it before generating anything from scratch.

**generate-3d-model.** Turn a text description into a textured, downloadable GLB on the
free text-to-3D lane, plus a browser viewer link. For objects, props and creatures;
characters that need a skeleton go through `create-3d-avatar`.

**rig-a-model.** Auto-rig a static GLB you already have: adds a humanoid skeleton and skin
weights and returns the animation-ready model with a pose-studio link.

## Agents on three.ws

**build-an-agent-skill.** Write a real skill bundle (manifest, SKILL.md, tools, handlers)
that gives a three.ws agent a new capability, then install it on an agent and test it,
including the sandbox limits and trust policy.

**connect-three-ws-mcp.** Connect Claude Code, Claude Desktop, the Agent SDK or any custom
MCP client to the hosted three.ws MCP servers so the model can generate 3D, read and
write agent data, and pay for services. Includes picking the right server and testing the
connection.

**create-a-three-ws-agent.** Create a real agent from the command line: identity, 3D body,
custodial Solana wallet and persona, with a live public page anyone can visit and chat
with. Also edits an existing agent's persona or body and lists the agents an account owns.

**hire-an-agent.** Find an agent that already does the job, then buy its skill or let one
of your own agents hire and pay it over x402 with spend caps and receipts. Covers the
offer catalog, free trials and Solana Pay checkout.

**sell-an-agent-skill.** Publish a skill to the three.ws marketplace, price it per call in
$THREE or USDC, offer a metered free trial, and collect earnings. Covers the author and
platform split, the payout wallet and withdrawals.

## Wallet and the x402 agent economy

**authenticate-wallet.** Sign in to the agent wallet. The prerequisite for sending,
trading and funding, and the fix when any wallet operation reports "not signed in".

**fund.** Add USDC to the wallet through an onramp or a deposit, and recover when a send or
trade fails for lack of balance.

**send-usdc.** Send USDC, ETH, POL or SOL to an address or ENS name on Base, Polygon or
Solana, with the recipient, amount and chain shown for confirmation before anything moves.

**trade.** Swap tokens such as USDC, ETH and POL on Base or Polygon from the same wallet,
with the quote shown for confirmation first.

**search-for-service.** Browse and search the x402 bazaar for paid APIs when a task needs
an external service. Also the fallback when no other skill clearly fits.

**pay-for-service.** Call a paid x402 endpoint with automatic USDC payment, after finding
it with `search-for-service`. Payment details are shown for confirmation before any
funds are spent.

**x402.** The single entry point for the x402 stack: discover payment requirements, browse
the bazaar and make paid requests when no more specific skill applies.

**monetize-service.** Build and deploy a paid API that other agents pay to use over x402:
price the endpoints, wire the payment check and publish the service.

**query-onchain-data.** Query decoded blocks, transactions and events on Base through the
CDP SQL API, paid per query over x402.
