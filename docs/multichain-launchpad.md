# The multichain launchpad

[three.ws/launch/multichain](https://three.ws/launch/multichain) launches a coin about a piece of
three.ws: one animation, an avatar, a 3D agent, or all of them together. The launchpad covers four
chains:

| Chain | Venues | Signer |
| --- | --- | --- |
| Solana | pump.fun | your agent's wallet, or your own Solana wallet |
| BNB Chain | four.meme, flap.sh | your agent's EVM wallet, or your own EVM wallet |
| Base | flap.sh | your agent's EVM wallet, or your own EVM wallet |
| Robinhood Chain | flap.sh | your agent's EVM wallet, or your own EVM wallet |

Every coin gets a permanent showcase page at `three.ws/l/<id>`. It plays what the coin is about
(the avatar performing the animation, the avatar alone, or the agent), and links to the coin on
its venue and on the chain explorer. The coin's website field points at this page, so traders who
find the coin on the venue land back on the 3D subject.

## What a coin can be about

| Kind | What it links | Example |
| --- | --- | --- |
| `animation` | an avatar performing one clip | an avatar doing `av-offabean-dance` |
| `avatar` | an avatar, no clip | a character from your library |
| `agent` | a 3D agent, its body and its page | your agent |
| `bundle` | an agent, its avatar and a clip together | an agent known for one dance |

The pieces can be linked together or kept apart. An animation launch does not need an agent,
and an agent launch does not need an animation. A public avatar anyone has shared can be the
subject: paste its `/pose` or `/avatars` link into the launchpad.

Pose Studio links straight in. Its **Launch a coin** button opens the launchpad with the avatar
and the clip that is currently playing, for example
`/launch/multichain?avatar=847f7261-4c79-4cdc-ab72-326bad2e1cf0&anim=av-offabean-dance`. The
launchpad also reads `agent`, `kind` and `chain` from the query string.

## How a launch runs

1. **Subject.** `POST /api/multichain-launch/subject` records what the coin is about and returns
   its `/l/:id` page. Nothing is sent to any chain yet.
2. **Quote.** Solana quotes come from the pump.fun launch config. EVM quotes come from
   `POST /api/multichain-launch/quote`. That endpoint estimates gas on the real chain and reads
   four.meme's launch and trading fee live from its TokenManager2 contract. The quote lists every
   fee and blocks the launch when the signer cannot cover it.
3. **Confirm.** The launchpad shows a table with the signer, the contract, the chain, the coin,
   every fee and the total. Nothing is signed until you confirm it, and the real-funds risk
   acknowledgement is required too.
4. **Send.**
   - *Agent signer (EVM):* `POST /api/multichain-launch/launch` signs from the agent's custodial
     wallet under the same gates as every custodial spend: ownership, platform-signing mode, the
     real-funds agreement, the per-chain USD spend policy, and an audited key decrypt. The call
     takes an `Idempotency-Key`, so a retry returns the same launch. `GET /api/launches/:id`
     follows it to completion.
   - *Wallet signer (EVM):* the wallet signs a three.ws ownership message first. Then
     `POST /prepare` returns the unsigned transaction, the wallet sends it, and `POST /confirm`
     reads the receipt. The launchpad switches the wallet to the right chain, or adds the chain
     when the wallet does not know it.
   - *Solana:* the existing pump.fun launch path runs, from the agent's wallet or the connected
     wallet. Then `POST /solana-link` ties the minted coin to its subject.
5. **Live.** The token address is read from the creation event of the venue's own contract. A
   matching event from any other contract is ignored. The coin is listed in `fixed_supply_launches`,
   so it shows on [/launches](https://three.ws/launches) and on the agent's profile.

The `/l/:id` page settles a submitted agent-signed launch on its own, so it goes live even after
the creator closes the launchpad.

## Venue details

**four.meme (BNB Chain).** four.meme only creates tokens that its own API has signed. The
launchpad signs in to four.meme with the creator's wallet and uploads the logo. It then requests
the signed `createArg` and sends `TokenManager2.createToken`. An agent key signs only four.meme's
exact login text (`You are sign in Meme <nonce>`) and nothing else. The supply is 1,000,000,000.
The curve graduates to PancakeSwap after 24 BNB is raised. The opening buy is capped at 5 BNB.

**flap.sh (BNB Chain, Base, Robinhood Chain).** The launch calls the flap Portal's `newTokenV6`
with a tax token. The creator picks a buy and sell tax of 1, 2, 3, 5 or 10 percent, and it is paid
to the signing wallet on every trade. flap requires tax tokens to sit at an address ending in
`7777`. The server finds a CREATE2 salt that gives such an address and checks the prediction
before sending. Metadata is pinned through flap's upload endpoint, which is the only place
flap's indexer reads from.

| Chain | Portal | Tax token implementation |
| --- | --- | --- |
| BNB Chain | `0xe2cE6ab80874Fa9Fa2aAE65D277Dd6B8e65C9De0` | `0x024f18294970B5c76c0691b87f138A0317156422` |
| Base | `0x0000BC1c4fD15Dd79029AF8F5d77D68ae4490000` | `0x777782e7EbB89802E2379E5fFcF7336538f43333` |
| Robinhood Chain | `0x26605f322f7fF986f381bB9A6e3f5DAb0bEaEb09` | `0x7777C8743C88B3aff3cf262135beF2c8b2e83333` |

three.ws takes no launch fee on any of these venues. The full fee comparison across every lane is
in [launch-lanes.md](launch-lanes.md).

## API

All routes live under `/api/multichain-launch/`. Writes need a signed-in session or an API key,
plus a same-site origin from the browser.

| Method and path | What it does |
| --- | --- |
| `GET venues` | chains, venues, contracts, wallet chain params, curated animations |
| `POST subject` | create a launch subject, returns its `/l/:id` page |
| `GET subject?id=` | public view of a subject, its coin and its links |
| `GET mine` | your recent launches |
| `GET logo?subject=` | the subject's logo image, used for venue uploads |
| `POST quote` | priced quote for an agent (`agent_id`) or a wallet (`wallet`) |
| `POST launch` | agent-signed EVM launch (`Idempotency-Key` header) |
| `POST four-meme-sign` | agent signs four.meme's login text |
| `POST prepare` | unsigned transaction for a wallet-signed EVM launch |
| `POST confirm` | record a wallet-signed launch from its transaction hash |
| `POST solana-link` | tie a pump.fun coin launched from this account to its subject |

Code: the page is [src/launch-multichain/page.js](../src/launch-multichain/page.js), the showcase
is [src/launch-multichain/subject-page.js](../src/launch-multichain/subject-page.js), the HTTP
handler is [api/multichain-launch/[action].js](../api/multichain-launch/[action].js), the venue
logic is [api/_lib/evm-leg/venue-launch.js](../api/_lib/evm-leg/venue-launch.js), and the subjects
are in [api/_lib/launch-subjects.js](../api/_lib/launch-subjects.js). Tests:
[tests/multichain-launchpad.test.js](../tests/multichain-launchpad.test.js).

Coin names, tickers and descriptions are creator-supplied text. They are escaped on every page,
links render only when they are https, and no on-chain or venue text is ever treated as an
instruction.
