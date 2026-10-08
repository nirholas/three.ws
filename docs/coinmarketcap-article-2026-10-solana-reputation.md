---
venue: CoinMarketCap Community (Articles Management > Add a new article)
account: three.ws (official)
categories: Solana, AI, Announcements
assets: THREE
status: draft, owner approval required before posting (external-channel gate in CLAUDE.md)
format_notes: |
  CMC caps the title and the meta description at 191 characters each. The body editor
  offers H2 and H3 only and has no table support (a markdown table pastes as one
  run-on line), so every list below is plain lines. Cover art: 640x360 or that
  proportion, under 10 MB. Owner directive: positive framing only. The body describes
  what each piece does and guarantees, states rollout status as what is live and what
  activates next, and carries no limitation sections. The opening sections are plain
  language for a newcomer; the technical depth sits in the middle and the end.
accuracy_notes: |
  The agent count (4,356) was read from https://three.ws/api/three-token/stats on
  2026-10-08 and is labelled with that date; it counts agents on the platform, not
  agents minted on-chain. The 3,000 validator attestations and the 126,522 custody
  proofs across 244 epochs come from the open-source audit dated 2026-08-25 and are
  labelled with that date. The 418 custody epochs and 492 wallets in the latest epoch
  were read from https://three.ws/api/custody/integrity on 2026-10-08. That same read
  reported epochs_anchored 0 (anchor_status anchor_failed, anchor_network devnet), so
  the body describes each epoch's Merkle root as a published, reproducible commitment
  verifiable at /proof, and describes on-chain anchoring as built into the pipeline
  and activated by a configured, funded attester key (docs/custody.md). It does NOT
  claim any root is currently anchored on-chain. Every mechanism, constant and status
  line comes from the repo: docs/solana.md (identity, registration checks),
  docs/solana-reputation.md and api/_lib/solana-attestations.js (envelope kinds,
  validation, verified rules, 10-minute crawl, 8-second Passport polling),
  api/agents/solana/_handlers.js (per-attester averaging, the four tiers, the response
  fields, the 90-day history endpoint, and the event-attested tier counting only
  feedback whose signature has a row in solana_attest_event_claims, i.e. attestations
  the platform's own attester minted through the exactly-once pipeline in
  api/_lib/attest-event.js), docs/sas-attestations.md (verified-client and
  audited-validation credentials), docs/custody.md, api/_lib/custody-proof.js and
  src/proof-of-custody/merkle.js (custody epochs, leaf contents, reconciliation, 6-hour
  cron in vercel.json), docs/reputation-staking-market.md and
  specs/REPUTATION_STAKING_MARKET.md (stake wire format, earnings function, principal
  never slashed, staker-signed withdrawal proof valid 5 minutes, devnet open and
  mainnet activated by REPUTATION_MARKET_ALLOW_MAINNET), contracts/README.md (skill_license
  and agent_invocation: not deployed, program ids reserved, 21 and 11 tests),
  packages/skill-license/README.md, api/_lib/skill-nft.js, api/_lib/skill-license-verify.js,
  api/_lib/agent-invocation-onchain.js and api/_lib/labor-settle.js (labor settlement is
  wired to call the invocation program), docs/skill-royalties.md and
  specs/SKILL_ROYALTY_SPLIT.md (royalty split, 250 bps default, 5,000 bps clamp, daily
  03:00 UTC settle cron with a $0.01 floor, EVM 7710 leg gated by
  SKILL_ROYALTIES_EVM_7710_ENABLED), docs/labor-market.md and api/_lib/labor-economics.js
  ($THREE escrow, 10% labor-market royalty default, 35% reputation weight). Gate status
  was cross-checked on 2026-10-08: none of REPUTATION_MARKET_ALLOW_MAINNET,
  SKILL_LICENSE_ENFORCE or SKILL_ROYALTIES_EVM_7710_ENABLED is set on the production
  service, which is why the body describes each as an activation step rather than as
  live. The third-party Solana task-coordination program is described without its
  name, so no other project is promoted. Partner designations are quoted exactly as
  docs/partners.md and docs/listings.md state them: OpenAI Select Partner; IBM Business
  Partner (with the independence phrase for the public Granite tools); AWS Partner
  with the Marketplace listing described as coming; member of Google Cloud for Web3
  Startups; Alibaba Cloud International Marketplace listing live; NVIDIA Inception
  member (2026-07); HackerNoon publishing partnership; Quicknode Startup Program
  accepted (2026-07). The Official MCP Registry listing is Live per docs/listings.md.
---

# CoinMarketCap article: reputation that costs something

Paste-ready for the CoinMarketCap form.

## Title (162 characters)

```
Reputation That Costs Something: How AI Agents on three.ws Earn, Stake and Prove Trust on Solana With Signed Attestations, Escrowed Conviction and Skill Royalties
```

## Meta description (186 characters)

```
On three.ws a Solana agent's identity is a Metaplex Core asset, its reputation is signed memo envelopes anyone can re-crawl, and conviction is escrowed SOL that earns from attested work.
```

## Body

---

Think about the last time you chose a restaurant, a plumber or an app. Chances are you looked at reviews first. A good reputation is how strangers decide to trust each other, and it is one of the most useful inventions in commerce.

Now picture the same decision made by software. AI agents are starting to hire each other, pay each other and work for each other. An agent that wants to buy a service from another agent has to decide, in a fraction of a second, whether the other side is worth trusting. It cannot read reviews the way you do. It needs a trust signal it can read in code, from a source it can check for itself, before any money moves.

That is what three.ws builds on Solana: reputation for AI agents that any program can read, any stranger can verify, and anyone can back with real value. This article explains it in plain language first, then walks through every mechanism in full technical detail for readers who want to check each piece.

three.ws builds this on Solana, the platform's home chain. The pieces are an agent identity minted as a Metaplex Core asset, reputation and validation written as signed SPL Memo envelopes, Merkle-committed proofs of custody, a reputation staking market where conviction sits in escrow and earns from an agent's attested work, on-chain skill licenses, and royalties paid to a skill's author whenever another agent uses the work.

$THREE is the platform's coin, at FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump on Solana.

## Reputation in plain words

A few ideas make the rest of this article easy to follow.

An agent is an AI program with its own identity, its own wallet, and its own public page. On three.ws, agents often have 3D bodies too, so you can see and talk to them.

An identity is how you tell one agent from another. On three.ws, every Solana agent's identity is a unique on-chain asset, a little like a digital passport that lives on the blockchain.

An attestation is a signed statement written to the blockchain. "I worked with this agent and it was excellent, five stars" is an attestation. So is "this agent's 3D model passed validation." Because it is signed, everyone knows who said it. Because it is on the blockchain, it is permanent and public.

A reputation is what you get when you gather an agent's attestations together and summarize them. On three.ws, that summary is a simple letter grade from A to D, plus the detail behind it.

Staking means putting real value behind your opinion. On three.ws, you can lock SOL behind an agent you believe in. If that agent does real, verified work, your stake earns a share of a reward pool.

With those ideas, you already understand the core of the system: agents have permanent identities, people and programs leave signed statements about them, those statements become a grade anyone can recompute, and anyone who believes in an agent can back that belief with real value.

## A quick tour for newcomers

Here is what you can do with agent reputation on three.ws today.

Look up any agent's reputation. The Agent Passport shows an agent's trust grade at a glance, and the Reputation Explorer at /reputation lets you inspect any agent's score and attestations.

Leave a vouch. Connect a Solana wallet and rate an agent from 1 to 5. Your rating is written to Solana as a signed transaction for the cost of a single network fee, and it appears in the agent's reputation within seconds.

Back an agent with conviction. At /reputation/market you can stake SOL behind an agent, watch your earnings accrue day by day as the agent does attested work, and withdraw principal plus earnings whenever you choose.

Check how the platform holds agent funds. At /proof, an agent owner can verify, inside their own browser, that their custodial wallet is included in the platform's latest proof of custody.

Earn from your skills. Publish a skill, set a price per call, and every time another wallet or agent uses it, your share is paid straight to your own wallet.

The tutorial at /tutorials/solana-agent-reputation walks through reading a grade and leaving your first on-chain vouch.

## Four questions every reputation system answers

A reputation system earns trust by answering four questions well. Each piece of the three.ws design answers one of them.

Who is being rated? A durable identity means a reputation stays attached to the agent that earned it. On three.ws, that identity is an on-chain asset with a public key anyone can fetch.

Who is doing the rating? Knowing who stands behind each rating lets a reader weigh it. On three.ws, every rating is signed by a wallet, and the strongest ratings come from wallets that are credentialed or that provably transacted with the agent.

Can the rating be checked? A rating anyone can verify is a rating that travels. On three.ws, every attestation is a public Solana transaction, and the pipeline that turns them into a grade can be rerun by anyone.

What does a rating cost? When expressing conviction ties up real value, the signal becomes stronger. On three.ws, staked conviction sits in escrow, and it earns only when the agent does real, attested work.

## Identity: the asset pubkey is the agent id

On EVM chains, agent identity has a canonical home in a registry contract. Solana's design is different, and three.ws builds natively for it: each agent is minted as a Metaplex Core asset, a single-account NFT standard with a name and metadata URI built in, and the asset's public key is the agent's canonical identifier. The platform stores the mint transaction signature alongside it, so the on-chain record can always be re-verified.

Registration is four steps: link a Solana wallet with a Sign-In with Solana challenge, receive an unsigned Metaplex Core create transaction from the server, sign and submit it from your own wallet, and let the server confirm.

Confirmation is where the identity becomes verified fact rather than a claim. The server re-fetches the transaction from the cluster and checks that it landed successfully, that the asset pubkey is among its account keys, that the linked wallet signed it, that the asset exists on-chain as a Metaplex Core asset owned by that wallet, that the transaction version matches the prepared one, and that this mint is not already registered to another agent. Each identity therefore belongs to exactly one agent and to the wallet that owns it.

The asset itself carries an on-chain Attributes plugin with the three.ws brand block and an enforced Royalties plugin, and it is minted into a three.ws Agents collection when one is configured for the network, with the collection authority co-signing so on-chain metadata can be curated on the owner's behalf.

Anyone can resolve a Solana agent from any RPC: fetch the asset with Metaplex Core, read its metadata JSON, and open the mint transaction on a block explorer.

Every attestation below names that asset pubkey, so a reviewer rates a specific Solana account anyone can fetch.

### One agent, two chains

A single three.ws agent can hold both a Solana identity and an EVM identity under ERC-8004. The Solana agent SDK folds identities into one 32-byte identifier space with namespaced SHA-256 hashing, and when an agent has both, a composite hash binds the two proofs together so neither can be swapped later. The SDK also builds a resolvable metadata URI under three.ws/.well-known/agent.json that a counterparty on either chain can fetch to discover the agent's full identity. In the agent card, both registrations sit side by side as chain-qualified references. Reputation from each chain is read on its own terms, so a reader can weigh the full picture. Solana is the home chain and the place this stack is built first.

## Attestations: reputation as signed memo envelopes

On three.ws, a vouch, a validation, a dispute or a stake is an ordinary Solana transaction carrying a small JSON envelope through the SPL Memo program. There is no custom contract in the path, which keeps the system simple and the data universal. The memo is signed by its author, timestamped by the chain, and permanent. The agent's asset pubkey is attached to the transaction as a read-only key, so every attestation about an agent is discoverable by asking any Solana RPC for the signatures touching that asset.

### The envelope format

Every envelope has a version field set to 1, a kind, and the agent's asset pubkey. A feedback envelope adds an integer score from 1 to 5, an optional comment and a timestamp. There are nine kinds, and a single map in the source code is the one authoritative list:

Feedback (threews.feedback.v1): a 1 to 5 score, the basic vouch.

Stake (threews.stake.v1): a score backed by a real SOL transfer in the same transaction.

Unstake (threews.unstake.v1): retires the conviction a specific stake expressed. It carries the staking signature and the principal as a decimal string, so even very large amounts survive the JSON round trip exactly.

Validation (threews.validation.v1): a pass or fail check, including a glb-schema subkind for 3D model validation, the Solana counterpart of an EVM validation registry attestation.

Task (threews.task.v1): an agent advertising a task.

Accept (threews.accept.v1): the agent owner acknowledging a task, which is what verifies the feedback tied to it.

Dispute (threews.dispute.v1): the owner disputing an attestation about their agent.

Revoke (threews.revoke.v1): an attester withdrawing their own attestation.

Review (threews.review.v1): a 1 to 5 rating tied to a specific review id, for structured marketplace-style reviews.

Each kind has a strict schema, and the indexer stores every envelope that satisfies it.

### Who can write what

Writing an envelope is open to everyone. Anyone with a wallet can leave feedback on any agent, by design: an open system lets every participant speak.

The weight an envelope carries is earned. The indexer computes a verified flag for each attestation:

A stake is verified when the lamports actually transferred, read from the transaction's balance changes, meet the 0.001 SOL minimum.

An accept or dispute is verified when its signer is the agent's owner wallet.

A revoke counts when its signer authored the attestation it targets.

Feedback, validation and task envelopes are verified when well-formed, and their trust tier is decided at read time.

The Passport's rating panel also keeps one vote per wallet per agent: rating the same agent again from the same wallet updates that wallet's score.

### Credentialed attestations

A second class of attestation carries the platform's own signature. Credentialed attestations use the Solana Attestation Service and are signed by a single three.ws authority keypair, the only key that can close an attestation it issued. Two schemas ship today.

Verified client (threews.verified-client.v1) states that a wallet has been verified by three.ws, through a method such as payment history or a trusted introduction. Feedback from a verified client sits in the strongest reputation tier.

Audited validation (threews.audited-validation.v1) records that an authorized validator reviewed an agent's task result, with a hash of the task bundle, a pass or fail, and a link to the validator's full report. It carries more weight than a self-attested validation, and the reputation API reports audited validations in their own field.

Credentials are public to read at GET /api/agents/sas-credentials, filtered to active, unexpired attestations for a subject.

### How a stranger verifies

A scheduled job runs every 10 minutes. For each agent it asks the RPC for signatures touching the asset account since a saved cursor, fetches the transactions, extracts and validates each memo, computes the verified flag, and stores the row. Revocations and disputes update the rows they target. The reputation API aggregates those rows, and the Agent Passport polls the chain about every 8 seconds, so a fresh vouch shows up within seconds.

Every input in that pipeline is public. A verifier can rerun the same crawl from the same memos and arrive at the same numbers. The letter grade is a fast, reproducible summary of that public data, computed by three.ws for convenience and recomputable by anyone.

## Four tiers, one grade

The reputation endpoint, GET /api/agents/solana-reputation, returns the same score computed at four trust levels, strongest first.

Credentialed: feedback from wallets holding an unexpired verified-client credential.

Verified: feedback whose task id matches an accept signed by the agent's owner, evidence that the reviewer actually transacted with the agent.

Event-attested: feedback produced by the platform's own market-behaviour monitors. This tier counts an attestation only when the platform's own attester minted it through the exactly-once event pipeline, so every event-attested rating traces back to a monitored event and to the three.ws attester key. Each monitored event carries a deterministic event id, and a claim row is written before the transaction is sent, so one event produces exactly one on-chain attestation, even across retries. A cleanup job clears any claim that did not complete, so the event can be attested on the next pass.

Community: raw feedback from any wallet.

Two design choices make the grade robust. Per-attester averaging collapses each wallet's opinions to one value before averaging across wallets, so a hundred memos from one wallet count once. Tier priority means the grade comes from the strongest tier that has data, so credentialed and verified voices lead whenever they are present.

### The grade

The grade is a short published formula. Take the best tier's average. Adjust it by half a point if any attestation is disputed, and by a full point if the validation pass rate is below one half. A result of 4.5 or higher is an A, 3.8 or higher a B, 3.0 or higher a C, and anything else a D. An agent with no attestations yet shows as unknown, because a new agent deserves a fresh start.

### What the reputation response contains

The response goes well beyond the grade, so an integrator can build exactly the view they need:

Feedback counts at every tier, with the number of unique attesters per tier, raw and per-attester-weighted averages, and the number of disputed attestations.

Validations, split into self-attested, event-attested and audited, each with passes and fails.

Tasks offered and tasks accepted, disputes filed, and revoked attestations.

Stake, reported net, gross and retired, with unique stakers and the top stakers.

The agent's confirmed payment activity and token activity on the platform.

The time the agent was last indexed.

A companion endpoint returns a daily reputation history for up to 90 days, scoring each day from its strongest populated tier, ready to chart.

### Validation as checkable fact

Validation captures fact rather than opinion. When an agent with a 3D avatar registers, the server records a glb-schema validation of the model, signed by the platform validator, with a proof hash of the model. At the open-source audit dated 2026-08-25, 3,000 validator attestations had been written under the validation envelope. Validations feed both the grade and the staking market's measure of an agent's work.

## Proof of custody, in epochs

Many three.ws agents hold custodial Solana wallets. A different trust question is whether the platform's account of those wallets matches reality, and three.ws answers it with proof of custody, run in epochs.

Every six hours a scheduled job runs one epoch. It snapshots each custodial agent wallet's public facts: the agent, the address, the live on-chain balance read from mainnet, and a commitment to the head of the wallet's custody event trail, the most recent recorded movement. Every key recovery, withdrawal, spend, limit change and freeze toggle is written to that trail, and the trail is also the ledger the wallet's rolling daily cap is computed from.

Each wallet becomes a leaf in a Merkle tree, with leaves and internal nodes hashed under different domain prefixes so a node can never pass as a leaf. The epoch, its root and its leaves are persisted and published.

Folding the trail head into the leaf is the elegant part. Every authorized movement advances the head, so each change in a wallet's leaf between epochs maps to a logged reason. Each epoch also runs a reconciliation pass: every balance decrease since the previous epoch is matched against authorized withdrawal and spend events, plus a fee tolerance. "Every outflow is explained" is a checked property.

At /proof, an owner fetches their wallet's inclusion proof and re-verifies it in their own browser with an independent verifier: it recomputes the leaf hash from the public fields, walks the Merkle path, and checks the result against the epoch's published root. Prover and verifier share one hashing module, so they always agree on how a leaf is built. The aggregate view, with the latest epoch, its root, wallet count and recent epochs, is public at GET /api/custody/integrity and GET /api/custody/anchor.

Every leaf holds a balance read live from the chain for that epoch, so every committed figure is a measured one. On-chain anchoring of each root as a signed SPL Memo envelope of kind threews.custody.v1 is built into the pipeline and activates with a configured, funded attester key, with the anchor network chosen per deployment.

At the audit dated 2026-08-25, 126,522 custody proofs had been written across 244 epochs. On 2026-10-08, the live integrity endpoint reported 418 epochs since the series began on 2026-06-23, with 492 wallets in the latest epoch.

## Why conviction should cost something

When expressing an opinion ties up real value, the opinion becomes a stronger signal. Per-attester averaging ensures each wallet counts once. Adding value behind a vouch means that building consensus requires real capital, and that capital earns only when the agent does real work. three.ws offers two layers of this.

### The staked vouch

A reviewer can add a SOL transfer of at least 0.001 SOL to the agent's owner wallet in the same transaction as their rating, and the envelope's kind becomes threews.stake.v1. A staked vouch shows that the reviewer moved real money behind their words, and the reputation API reports it in the stake block.

### The Reputation Staking Market

The market turns staked conviction into escrowed positions that earn from an agent's attested history. Principal goes to a dedicated market escrow, and earnings depend on the agent's attested behaviour each day. The load-bearing contract is a public spec, rsm.v1, in the repository.

A stake is one transaction the staker signs and broadcasts; the market never signs a stake on anyone's behalf. It contains two instructions: a SOL transfer to the escrow, and an envelope of kind threews.stake.v1 that also carries a market field set to rsm.v1, the agent's asset pubkey, a 1 to 5 conviction score, and the escrow pubkey. The transaction signature is the position id, so recording the same stake twice simply returns the same position.

The server verifies every stake against the chain. The memo must name the rsm.v1 market and the configured escrow, the escrow's balance must rise by at least 0.001 SOL in that transaction, and the fee payer must be someone other than the escrow. The principal is the escrow's balance change as the chain recorded it, so every position's size is exactly what the chain shows.

On the page, you connect a Solana wallet at /reputation/market, pick an agent, choose an amount and a conviction score, and sign. From code, a single helper builds the exact transaction, and one POST indexes it.

### Earnings come from attested work

Each epoch is one UTC day. A fixed reward pool splits across open positions in proportion to principal, times the fraction of the day each position was open, times the agent's weight that epoch.

The weight comes from the agent's attestations. A verified accept adds 1 to work, a verified task 0.6, a passed validation 1, task-linked feedback 0.75 and other feedback 0.35. A failed validation, a verified dispute and a verified revoke each count as a fault. Quality maps average feedback onto a 0 to 1 scale and sits at a neutral one half when there is no feedback yet. Integrity is work divided by work plus twice the faults, so consistent clean work is what lifts it. The weight is quality times integrity times the base-2 logarithm of one plus work.

That logarithm is a deliberate design choice. Yield grows with activity on a gentle curve, so steady, genuine work is rewarded and a burst of cheap attestations adds little. Stake and unstake envelopes do not count toward weight, so conviction and yield stay cleanly separate. Values are rounded to nine decimals so the server and the browser compute identical results from one shared implementation.

Yield follows work: each day's earnings come from that day's attested activity, so stakers are rewarded alongside agents that are actively delivering. The market quotes the realized rate from earnings actually accrued, so every rate shown is one that happened.

Pending earnings recompute on every read, and every position carries a per-epoch breakdown, so the figure on the page is auditable against the spec, epoch by epoch.

### Principal protection by design

Positions in the market are principal-protected by design. Staking expresses conviction in an agent, conviction is rewarded through yield tied to the agent's attested work, and principal always returns in full when a staker withdraws.

### Withdrawal, net conviction and solvency

There is no lockup. Withdraw any time. Only the wallet that opened a position can withdraw it: the staker signs a short unstake message naming the network, the stake signature and the current time, and the server accepts that proof for five minutes. The market page does this in one wallet prompt, with no fee. The escrow then signs one settlement transaction paying principal plus earnings to the staker recorded on-chain, with a threews.unstake.v1 memo carrying both figures. A position moves to settling before the payout is signed, so a retried withdrawal completes exactly once, and a second request for a closed position returns the original settlement.

Solvency is a hard rule. Principal and the reward surplus are separate pots, and earnings are paid from the surplus. If accrued earnings ever exceeded the surplus, the payout would be clamped to it and recorded as clamped, while principal always returns in full. The pool is a fixed per-epoch budget set by the operator, and the spec's default is zero, so the market always holds what it owes.

Withdrawal also updates the agent's public reputation. Stake is reported net: once a settlement lands, that conviction stops counting and the staker is no longer listed as a backer, so an agent's backing always reflects current conviction. Gross and retired amounts are reported alongside, so the full history is kept and "1 SOL staked, 3 SOL withdrawn" stays distinguishable from "1 SOL staked". Only the escrow's own settlements retire stake, so each agent's backing changes only through real settlements.

### Verify the market yourself

The database behind the market is an index of the chain. Every position can be re-derived by replaying stake memos into the escrow and unstake memos out of it.

A proof script in the repository runs the whole contract against Solana devnet, from funding through staking, verification, accrual against real attested history, withdrawal, and a re-read of the settlement on chain. It can fund itself from any devnet keypair, and it also runs fully offline against a local test validator, which bundles the same SPL Memo program the attestations use.

### Status: live on devnet, mainnet activation built in

The market is fully open on Solana devnet today, with airdropped lamports as the free path to try every step. Mainnet activation is built into the service as a single owner setting, one command, and everything that works on devnet works on mainnet unchanged once it is on.

### Delivery under stake

Reputation captures what others say about an agent. Delivery captures what an agent did. For that second signal, three.ws integrates a Solana task-coordination program in which agents register with a minimum 0.001 SOL stake, start at a neutral reputation of 5,000 on a scale to 10,000, claim tasks gated by capability and minimum reputation, and gain reputation each time a task creator accepts their completed work, with stake and reputation that also answer for disputes. Paid MCP tools read its agent and task accounts, including a task's full lifecycle timeline with signatures, and the Solana agent SDK exposes registering, creating, claiming and completing tasks. Together, the attestation layer and this program give a reader both halves of an agent's record.

## Skill licenses: a purchase you can hold

Does a wallet own the right to use a skill? three.ws puts the answer on Solana.

### Licenses minted at purchase

When a skill purchase confirms, the server mints an NFT to the buyer. Each agent owns a per-agent Metaplex Core collection, created on its first sale, and every purchased skill is minted as a Core asset inside it, owned by the buyer and verified into the collection at creation, on mainnet by default. A database grant sits alongside as the fast entitlement check. The license is something the buyer holds in their own wallet.

### The skill_license program

The next layer is an Anchor program, skill_license. Each purchase becomes a real 1-of-1 SPL NFT, zero decimals with supply locked at one, paired with a deterministic SkillLicense account derived from the owner, the agent's skill-collection mint and the SHA-256 of the skill name. Anyone can re-derive that address and read it in one RPC call: if it exists and its revoked timestamp is zero, the wallet owns the skill. No authentication, no API key, no database.

Minting is idempotent, since a second mint for the same owner, agent and skill fails, so one purchase yields exactly one license. A refund freezes the holder's token account and stamps a revocation time while leaving the record readable, so every license's state is visible on-chain.

The compiled program passes 21 invariant tests in a LiteSVM suite with the real SPL Token programs loaded, and its program id is reserved. The @three-ws/skill-license npm client wraps verification in one call through a public, auth-free endpoint, and pairs with the three.ws x402 server package to gate a paid endpoint on a license the holder owns. On-chain license enforcement is an opt-in setting, and it is designed to block only on an affirmatively read revocation, so a legitimate holder keeps access through any infrastructure hiccup.

## Skill royalties: paying the author whenever another agent uses the work

A reputation economy rewards the authors whose work other agents depend on. three.ws does this through three lanes.

### Per call over x402: live

A priced skill sits behind a paid endpoint. The first request answers 402 Payment Required with the skill's per-call price, the caller pays in USDC, and the response returns the skill's tool schema and content. Every invocation is a fresh payment: authors earn per call, not per install or per month.

The 402 challenge names the author's own wallet as payee, so USDC moves from caller to author at settlement, with Solana advertised first whenever the author has a Solana wallet. Only the chains the author can receive on are advertised. The platform takes 250 basis points by default, 2.5 percent, matching the marketplace fee, clamped in code to at most 5,000 basis points.

The split is exact integer math on USDC's six decimals, with every unit accounted for and rounding in the creator's favour: a $0.25 call pays $0.243750 to the author and $0.006250 to the platform. Both properties, conservation and creator-favoured rounding, are enforced by tests, and the split function is pure, so the invariants are provable in isolation. A proof script runs the full accounting path against a real Postgres database without moving any funds.

The author of record is set from the authenticated session at publish time, and it is the only thing that decides who gets paid. Creator Studio, in the dashboard, lists every accrual newest first with the skill, the rail, the named settlement chain, the amount linked to its block explorer transaction, pending, settling and settled totals, and a CSV export at USDC's full six-decimal precision. Authors see their earnings there even if they never created an agent, and the same data is available as JSON for the signed-in author.

### Inside the platform: accrual live, settlement activates with one setting

When an agent inside three.ws calls a paid skill through the runtime, the call is billed against the agent's spending delegation and recorded as pending in the same author ledger. Settlement runs through a delegated-permission redeem leg that the owner activates with one setting. Rows are claimed atomically before any redeem, so each accrual is paid exactly once, and the daily settlement job at 03:00 UTC settles authors whose pending balance clears $0.01, so nobody spends gas moving dust.

### The labor market: live

At /labor-market, agents post paid bounties with the reward escrowed up front in $THREE, held in a dedicated platform escrow wallet. Other agents bid, the poster (or an opted-in autopilot) awards one, and a neutral verifier scores the delivery against the spec. On a pass, escrow releases the worker's payout, a skill-author royalty and any auction surplus; on a fail, the poster is refunded in full. Settlement is idempotent, so a retry pays exactly once. The default royalty is 1,000 basis points of the awarded amount, ten percent, and the legs always sum exactly to the escrowed reward.

Reputation carries 35 percent of the weight in award scoring, with a neutral prior for new agents, so a strong record wins better work and more royalties for the skills used. This is where reputation turns directly into income.

A companion Anchor program, agent_invocation, is written and covered by 11 tests, with its program id reserved, and the labor market's settlement path is already wired to call it. It moves no funds and grants no capability: it validates the caller and emits a SkillInvoked event, so each agent-to-agent hire becomes permanently auditable on-chain with an explorer link on both sides.

## The EVM side, briefly

On EVM chains, identity, reputation and validation use the ERC-8004 registries at the same address on every supported chain, with one review per wallet per agent and no self-review. An agent that holds both identities carries both records, and the composite identifier keeps them bound together. Solana remains the home chain and the place this stack is built first.

## Our partners

three.ws builds alongside a group of technology, cloud and media programmes. Each is an independent company, and each designation below describes three.ws's membership or listing exactly as it stands. The full map is at three.ws/partners.

Quicknode. three.ws is accepted into the Quicknode Startup Program (2026-07) with approved infrastructure credits. Quicknode's globally distributed RPC endpoints are a rung in the Solana RPC failover chain behind agent wallets, settlement verification and live Solana market data, the same chain access the attestation crawler, the stake verifier and the custody snapshots rely on.

Google Cloud. three.ws is a member of Google Cloud for Web3 Startups. Production runs on Google Cloud: one Cloud Run service serves the site and every API handler, and Cloud Scheduler runs the jobs this article describes, including the 10-minute attestation crawl, the six-hourly custody epochs and the daily royalty settlement. Vertex AI provides the Gemini lanes in the platform's model chain.

OpenAI. three.ws is an OpenAI Select Partner in the OpenAI Partner Network. The free three.ws 3D Studio connector gives ChatGPT eleven keyless 3D tools, from text to model to rigged avatars, the same kind of 3D bodies that three.ws agents wear and that receive glb-schema validation attestations when an agent registers. The three.ws MCP server is also listed live on the Official MCP Registry.

IBM. three.ws is an IBM Business Partner. Agents on three.ws can think on IBM Granite foundation models served through IBM watsonx.ai. three.ws also publishes an independent set of developer tools built on IBM's publicly available Granite models, including a Granite Guardian trust layer.

NVIDIA. three.ws is a member of NVIDIA Inception (2026-07), NVIDIA's program for startups building on accelerated computing. Every 3D generation lane on the platform runs on NVIDIA hardware, from text to 3D to rigging and motion, and NVIDIA-hosted models on NIM serve chat, vision, embeddings and more.

Amazon Web Services. three.ws is an AWS Partner. The AWS Marketplace integration is built and deployed, linking an AWS account to a three.ws account and issuing an x402 access key, the same x402 rail skill royalties settle over, and the Marketplace listing is coming.

Alibaba Cloud. three.ws is listed live on the Alibaba Cloud International Marketplace, with a storefront and an editorial feature on the Alibaba Cloud Marketplace blog. Qwen models are first-class lanes in the platform's model router.

HackerNoon. three.ws has a builder-focused publishing partnership with HackerNoon, whose import picks up three.ws announcements from the platform's RSS feed for HackerNoon's developer audience.

## What the design guarantees

Every agent identity is a verified on-chain asset owned by the wallet that minted it, one identity per agent.

Every attestation is a signed, permanent Solana transaction that anyone can re-crawl and recompute.

Each wallet's opinion counts once, and the grade comes from the strongest tier with data: credentialed, verified, event-attested, then community.

Event-attested ratings come only from attestations the platform's own attester minted, exactly once per monitored event.

Every custodial wallet is committed into a Merkle tree every six hours, with its custody trail folded into its leaf, and each owner can verify inclusion in their own browser.

Staked conviction sits in escrow, earns from attested work on a published formula, protects principal, and is reported net so backing always reflects current conviction.

Withdrawal is staker-signed, retry-safe and paid by one escrow settlement.

Skill licenses are assets the buyer holds, and royalties pay authors per call with exact, creator-favoured arithmetic.

## How to check all of this yourself

The reputation API at GET /api/agents/solana-reputation returns an agent's score at every tier, its validation record split by source, its tasks and disputes, and net, gross and retired stake. The history endpoint returns up to 90 days of daily scores. The tutorial at three.ws/tutorials/solana-agent-reputation walks through reading a grade and leaving an on-chain vouch.

three.ws/reputation is the Reputation Explorer, for inspecting any agent's score and attestations.

three.ws/reputation/market ranks agents by net staked conviction with epoch weight and realized yield, and shows any wallet's positions with a per-epoch breakdown auditable against the spec.

three.ws/proof recomputes a custodial wallet's Merkle leaf and checks it against the epoch's published root, entirely in the browser.

three.ws/labor-market shows open bounties, in-flight jobs and the settlement ticker.

For builders: three.ws/docs/solana-reputation, three.ws/docs/reputation-staking-market and three.ws/docs/skill-royalties.

For scale, the live stats endpoint reported 4,356 agents on the platform on 2026-10-08. The audit dated 2026-08-25 counted 3,000 validator attestations and 126,522 custody proofs across 244 epochs, and on 2026-10-08 the custody integrity endpoint reported 418 epochs and 492 wallets in the latest one.

## Why this matters

Agents can already pay each other. The next step for the agent economy is answering the question every payment implies: should I trust the other side?

three.ws answers it with pieces that fit together: an identity anchored to a public account, attestations any stranger can re-derive, conviction that ties up real capital and earns from real work, licenses held as assets, and royalties that pay the authors other agents depend on. Each piece is open, checkable and built on Solana.

Everything here is open source under Apache-2.0 at github.com/nirholas/three.ws, including the staking market spec, the royalty invariants, the attestation schemas and the custody prover. Start at three.ws/reputation/market.

Nothing here is financial advice.
