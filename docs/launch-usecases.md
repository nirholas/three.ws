# Launch Studio — coin-launch use cases

The **Launch Studio** ([three.ws/launch-studio](https://three.ws/launch-studio))
is a catalog of 50 ready-made coin-launch recipes. Each recipe pulls a live
signal, turns it into a concrete coin identity, and routes the coin's creator
fees — then previews exactly what it would mint **right now** before you launch
on pump.fun in one click.

It's built on the shared [launch use-case engine](../api/_lib/launch/README.md).

## Two kinds of recipe

| Mode | What it mints | Where fees go |
|---|---|---|
| **Reward** (`attribution`) | A coin *for* a real subject — a trending GitHub repo or creator. | The subject's GitHub account, via the fee-sharing / social-fee system. This is the `$THREE → @nirholas` pattern, automated. |
| **Theme** (`narrative`) | An original coin riding a live cultural, news, or onchain narrative. | The launching agent (creator fees) — delegate later from the [fees panel](../public/studio/fees-panel.js). |

## The catalog (50 recipes, 6 categories)

- **GitHub (12)** — trending repos and creators, by language (Rust, TypeScript,
  Python, Go, Solidity, AI/ML notebooks), fresh weekly breakouts, surging
  established projects, and top builders. Fees route to the repo owner / creator.
- **Onchain (8)** — pump.fun venue signals: breakout categories, oracle
  conviction sectors, blended momentum, AI-agent and degen metas.
- **News (8)** — Hacker News tech zeitgeist, Google search surges, Wikipedia top
  events, and crossover blends.
- **Culture (10)** — fresh confirmed memes, Reddit hot, X chatter, and broad
  meme mixes.
- **Events (6)** — what the world is looking up: Wikipedia top-of-day, live search
  spikes, sports/entertainment moments.
- **Community (6)** — ecosystem contributors and builders (reward coins) plus
  cross-source culture blends.

## How a preview works

1. Open `/launch-studio`. Search across all 50 recipes, filter by category
   (colour-themed tabs) or type (Reward / Theme), star favourites, or hit
   **Surprise me** for a random one. `/` focuses search; `Esc` closes.
2. Click a recipe to open the **live preview drawer** — the coins it would mint
   right now from live data, each with an avatar, name, ticker, description, a
   signal-strength bar, and its reward routing.
3. Hit **Launch this coin** to open the existing [`/launch`](https://three.ws/launch)
   wizard with the identity prefilled, then mint on-chain from your wallet or an
   agent's custodial wallet.

## Reward routing — to anyone, not just GitHub

The preview drawer has a **reward planner**: route a coin's creator fees to any of

| Target | What it does |
|---|---|
| **As designed** | The recipe's built-in routing (e.g. the repo owner). |
| **Creator** | Fees stay with the launching wallet. |
| **GitHub @user** | 100% to a GitHub account (pump.fun social platform 2). |
| **X @handle** | 100% to an X / Twitter account (pump.fun social platform 1). |
| **Wallet / .sol** | 100% to a fixed Solana address or name. |

Every target in that table survives the handoff to the launch wizard, which is
the point: a target the launch flow cannot apply is a promise the product does
not keep. (Cashback and buyback used to appear here and were exactly that.
Cashback is a read-only pump.fun pool property with no create-time control, and
the launch panel's buyback slider burns *agent revenue* rather than routing
creator fees, so neither is offered.)

### The `?reward=` handoff

"Launch this coin" builds a deep link to `/launch` carrying the coin identity
**and** the chosen routing:

```
/launch?name=Deepseek+Harness&symbol=DEEPSEEKH&description=…&image=…&reward=github:deepseek-ai
```

`reward` takes one of three forms, and anything else is ignored rather than
blocking a launch:

| Value | Recipient |
|---|---|
| `github:<login>` | A GitHub account, resolved to its three.ws-linked payout wallet. |
| `x:<handle>` | An X account, same resolver. |
| `wallet:<address or name.sol>` | A fixed Solana recipient. |

[`public/launch/launch.js`](../public/launch/launch.js) parses it, the launch
panel shows the routing on the form before the mint ("Creator fees route to
@deepseek-ai on GitHub"), and the moment the coin lands the post-launch
[fees panel](../public/studio/fees-panel.js) mounts on the success screen with
that recipient already filled in at 100%. It is a draft, not an automatic write:
the creator still reviews and signs the split, and a coin that already has
shareholders is never re-seeded.

The same generalisation powers that fees panel on its own: its recipient box
accepts a **GitHub @user**, an **X handle** (`x:@handle`), a raw **Solana
wallet**, or an **owner/repo** to split across contributors. All of it resolves
through one shared resolver ([`api/_lib/github-reward.js`](../api/_lib/github-reward.js),
`resolveSocialReward`) so GitHub and X route identically.

## API

Public, rate-limited, read-only. Reward routing in `preview` is **intent-only** —
it never reveals whether a GitHub user has a linked wallet; the concrete address
resolves on the authed launch path.

### List recipes

```
GET /api/pump/launch-studio?action=list[&category=github&mode=attribution]
```

```json
{
  "count": 50,
  "categories": ["github", "onchain", "news", "culture", "events", "community"],
  "use_cases": [
    {
      "id": "github-trending-repos",
      "title": "Trending GitHub repos → reward coins",
      "description": "...",
      "category": "github",
      "mode": "attribution",
      "tags": ["github", "attribution", "rewards"],
      "source": "github-repos",
      "reward_label": "Creator fees → the repo owner"
    }
  ]
}
```

### Preview a recipe (live)

```
GET /api/pump/launch-studio?action=preview&id=github-fresh-breakouts&limit=6
```

```json
{
  "id": "github-fresh-breakouts",
  "mode": "attribution",
  "network": "mainnet",
  "generated_at": "2026-06-30T23:00:00.000Z",
  "items": [
    {
      "subject": "acme/widget",
      "signal": { "source": "github", "detail": "★5243 · Python" },
      "identity": { "name": "widget", "symbol": "WIDGET", "description": "...", "image": "https://github.com/acme.png" },
      "reward": { "kind": "github-owner", "github_username": "acme", "mode": "pending", "note": "Creator fees route to @acme — resolved to their wallet (or a social-fee escrow) at launch." }
    }
  ]
}
```

## Related

- [Launch use-case engine](../api/_lib/launch/README.md) — internals + how to add a recipe.
- [Coin Launches](./coin-launches.md) — the underlying launch mechanism.
- [Launch a Coin](https://three.ws/launch) — the wizard each recipe hands off to.
- Fee sharing & GitHub reward routing — [`public/studio/fees-panel.js`](../public/studio/fees-panel.js).
