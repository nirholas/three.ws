# The /launch launchpad

[three.ws/launch](https://three.ws/launch) is the pump.fun launchpad for 3D AI agents. A creator
picks one of their agents, names a coin, and launches it on pump.fun from their own wallet or from
the agent's wallet. Creator rewards stay claimable on the same page under **My coins**.

Solana is the home chain: every coin here is a pump.fun bonding-curve launch on Solana mainnet.

## What a launch does

1. **Link a 3D agent.** The coin belongs to one of your agents. `POST /api/pump/build-metadata`
   pins the image and metadata JSON and links the agent into it:
   - `website` and `external_url` point at `https://three.ws/agents/<agent_id>`
   - `attributes` carries a `3D Agent` trait with that URL
   - `animation_url`, `properties.files` and `agent.model` carry the avatar GLB, but only when the
     avatar is `public` or `unlisted` (token metadata is permanent and public)
2. **Name it.** Name (32 characters), ticker (2 to 10 letters or digits), optional description and
   social links. The image defaults to the agent's portrait.
3. **Choose settings.**
   - Launch from **your wallet** (you sign; rewards go to that wallet) or **the agent's wallet**
     (the custodial agent wallet signs and earns; no wallet prompt).
   - Pair with **SOL** or **USDC**.
   - Creator rewards to the **creator** or to **holders** (pump.fun holder rewards; not claimable
     here, they pay out to holders).
   - Optional **dev buy**, **Mayhem mode**, and the **transaction format**.
4. **Launch.** The server builds the transaction, the wallet signs it, the page confirms it on
   Solana and records it (`launch-confirm`), and the coin appears on
   [/launches](https://three.ws/launches) and its coin page `/launches/<mint>`.

The mint address is ground server-side to carry the `3ws` mark and co-signs before the transaction
reaches the browser, so the wallet adds exactly one signature.

## Fees

| Cost | Paid to | Amount |
| --- | --- | --- |
| Create + rent | pump.fun / Solana | about 0.022 SOL |
| Dev buy | the bonding curve | whatever you choose, 0 by default |
| three.ws launch fee | platform treasury | 1% of the dev buy (`PUMP_LAUNCH_FEE_BPS`) |

The launch fee rides in the same transaction and is shown in the cost panel before you sign. No dev
buy, no fee. Details and env vars: [pump-platform-fee.md](./pump-platform-fee.md#launch-fee-on-by-default).

## Transaction formats

A pump.fun create with a dev buy measured 1,229 bytes against Solana's 1,232-byte legacy limit, so
anything added to it used to overflow. `api/_lib/pump-launch-tx.js` fixes that two ways:

- **v0 with pump.fun's address lookup table** (`7mFD2mUtRS65XstiSAvCJuYmdesZoQwCwRJhq1p3eRMe` on
  mainnet). A SOL launch with a dev buy and the fee compiles to about 1,030 bytes. Every wallet
  signs v0.
- **Solana transaction v1** (feature `txv1aq4pp281K9um3tnPgkfX8UqtFT6wcVW3hNezGLL`, active on mainnet
  since slot 447,120,000). A 4,096-byte envelope with explicit compute and data limits. USDC-paired
  launches with a dev buy only fit here (about 1,600 bytes).

The **Auto** format (default) uses v0 when it fits and v1 only when v0 overflows and the connected
wallet advertises v1 through Wallet Standard (`solana:signTransaction` with
`supportedTransactionVersions` including `1`). A launch that needs v1 on a wallet without it gets a
clear error instead of a failed signature. You can pin v0 or v1 under **Transaction format**.

## Claiming creator rewards

pump.fun pools creator rewards per creator wallet, not per coin. **My coins**
(`GET /api/pump/my-coins`) groups your coins by the wallet that earns their rewards and reads the
live unclaimed balance for every quote mint (bonding curve and PumpSwap vaults both).

- **Your wallet:** Claim builds `collect-creator-fee-prep` with `all_quotes: true`, your wallet signs,
  the page confirms it.
- **Agent wallet:** Claim calls `collect-creator-fee-agent`; the agent wallet signs server-side.
- Coins with rewards routed to holders, split by a fee-sharing config, or created by a wallet not
  linked to your account are listed separately with the reason.

You do not need the pump.fun app to claim: any coin launched here can be claimed here.

## API

All endpoints live under `/api/pump/`. Money-moving calls need a signed-in session and a wallet
linked to it (`/api/auth/wallets/link-solana`).

| Endpoint | Purpose |
| --- | --- |
| `GET launch-config` | Live launch fee bps, fee recipient, create-cost estimate, v1 activation, whether the PumpAgent buyback binding is available. Public. |
| `POST build-metadata` | Pin image + metadata linked to the agent. Returns `metadata_url`, `agent_url`, `agent_model_url`. |
| `POST launch-prep` | Build the launch transaction. New fields: `transaction_version` (`'auto'`, `0`, `1`), `v1_capable`. Returns `transaction_version`, `tx_bytes`, `tx_limit_bytes`, `platform_fee`, `mint_presigned`. |
| `POST launch-confirm` | Verify the confirmed transaction (pump.fun program invoked, launch fee paid) and record the launch. |
| `POST launch-agent` | Launch signed by the agent's custodial wallet. Returns `platform_fee` with `settlement`. |
| `GET my-coins` | Your coins plus unclaimed rewards per creator wallet. |
| `POST collect-creator-fee-prep` | Claim transaction for a wallet creator. `all_quotes: true` sweeps SOL and USDC vaults. |
| `POST collect-creator-fee-agent` | Server-signed claim for an agent-wallet creator. |

```bash
curl -s https://three.ws/api/pump/launch-config
```

## Agent buyback binding

Older launches bound an on-chain PumpAgent with a buyback share. The PumpAgent program currently
rejects new agents (custom error 6015, `AgentInitializationNotSupported`, simulated on mainnet
2026-09-16), which reverted every launch that included it. The binding is skipped unless an operator
sets `PUMP_AGENT_INIT_ENABLED=1` after confirming the program accepts it again; `launch-prep`
reports `buyback_available`.

## Deep links

`/launch` accepts `?avatar=<id|slug>`, `?name=`, `?symbol=`, `?description=`, `?initialBuy=`,
`?image=<https url>`, `?imageSession=1` (image from the viewer snapshot) and `?tab=coins`.
Launch Studio recipes that route rewards (`?reward=github:<login>|x:<handle>|wallet:<address>`)
open the full studio launch panel, which owns the fee-split handoff.

Related: [agent tokens](./agent-tokens.md), [Launch Studio](https://three.ws/launch-studio),
[STRUCTURE.md](../STRUCTURE.md).
