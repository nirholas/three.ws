# Specialist teams: four agents, one policy, one board

A specialist team is a squad of four 3D agents that work one market together
under one spend policy you set. Each specialist has a single job, and all four
post what they learn to a shared, live **findings board**. The Trader only acts
on research it can cite from that board, so no trade ever happens on a hunch,
and no specialist redoes work another one already did.

Pages: [/teams](https://three.ws/teams) (your teams, assemble a new one) ·
`/teams/<id>` (one team: the squad, the console, the board) · API: `/api/teams`

## The four roles

| Role | Job | What it may do | Signs? |
| --- | --- | --- | --- |
| **Researcher** | Vets one token and posts a scored verdict: `pass`, `caution` or `avoid`. | read board, post, research | Never |
| **Entry** | Scores finished launches against your entry gates and posts the setups worth acting on. | read board, post, scan | Never |
| **Trader** | Quotes, simulates or trades a token inside the spend policy, citing live research. | read board, post, research, quote, sign trades | Only a live trade you confirm |
| **Launcher** | Prepares a launch plan for the native launchpad and hands it to you to sign. | read board, post, launch prep | Never |

Every role has a fixed **ceiling**. You can narrow a specialist's grant from
Settings (for example, take `sign trades` away from the Trader to keep the team
quote-only), but no grant can ever widen past its role. The server enforces the
ceiling on every run, whatever a client sends. Only the Trader's ceiling holds
`trade.execute`, so a Researcher, an Entry scout, a Launcher or a custom
specialist can never sign anything.

You can add up to four **custom specialists** from agents you already own. Their
ceiling is every permission except signing.

## How it works

1. **Assemble.** Name the team, pick mainnet or devnet, and set the per trade
   cap, the daily budget and how long a verdict stays citable (the finding
   lifetime, 15 minutes by default). three.ws creates four agents in your
   account, each with a 3D body, a custodial wallet and a public agent page, and
   writes the caps onto the Trader agent's own trade limits so the platform
   spend guards enforce them. Nothing is funded and nothing is signed.
2. **Research.** The Researcher checks the mint's on-chain authorities, its
   venue, holder structure, bundle risk and smart-money presence, and posts a
   verdict with a 0 to 100 score and the evidence behind it. A brand-new token
   with no launch intelligence yet is judged on what is known and capped at
   `caution`, and the summary says so. If a live verdict on the same mint is
   already on the board, the Researcher reuses it instead of running again.
3. **Scout.** The Entry agent scores every launch whose observation window
   closed in the last two hours (or one mint you name) with the same scorer the
   sniper uses, against the team's entry gates: minimum quality, maximum bundle
   score, a two-sided market, smart money, and a market-cap band. It posts the
   best setups and never trades.
4. **Trade.** The Trader looks for a live research verdict on the mint. If there
   is one it cites it; if not, it runs the research itself, posts that verdict
   to the board, and cites it (reuse, never redo). Then it applies the rule:

   | Research | Buy | Sell |
   | --- | --- | --- |
   | `pass` | allowed | allowed |
   | `caution` | allowed only if the policy allows caution | allowed |
   | `avoid` | refused | allowed |

   Exits are never blocked by research. Every outcome, including a refusal, is
   posted as a `trade` finding that names the research it cited. Quote and
   Simulate never sign. Live signs from the Trader's wallet through the same
   guarded trade path every agent uses, after you confirm the exact action,
   amount, mint, network and wallet in a dialog.
5. **Prepare a launch.** The Launcher checks the native launch lane is open on
   the team's network, validates the name, ticker and description, and posts a
   `launch_prep` finding with the lane, fees and a link to the launchpad
   prefilled with the plan and the Launcher's 3D body as the coin image. You
   review and sign it there yourself. The Launcher never builds or signs a
   transaction.

## The findings board

Every finding records who posted it (role and member), its kind (`research`,
`entry_signal`, `trade`, `launch_prep`), its subject (a mint, or `launch:<TICKER>`),
a verdict, an optional score, a one-line summary, structured evidence, the
findings it cites, and when it stops being citable. Expired findings stay on
the board as history; they just can no longer be cited.

The board streams live. The team page subscribes over Server-Sent Events and
shows each finding as it lands, pulses the specialist who posted it, and lets
you jump from a trade to the exact research it cited.

## Visibility

A team is private by default. Making it public opens the team page and its
board to anyone with the link, read-only. The spend policy, wallet balances and
trade limits stay visible to the owner only.

## API

All endpoints accept the session cookie (with an `x-csrf-token` header on
writes) or a bearer token. Errors use the standard `{ error, error_description }`
body. Full reference: [API reference: specialist teams](./api-reference.md#specialist-teams).

```bash
# Assemble a devnet team (cookie session shown; a bearer works the same way)
curl -X POST https://three.ws/api/teams \
  -H 'content-type: application/json' -H "x-csrf-token: $CSRF" -b cookies.txt \
  -d '{"name":"Morning desk","network":"devnet","policy":{"per_trade_sol":0.05,"daily_budget_sol":0.25}}'

# Run the Researcher on a mint (reuses a live verdict when one exists)
curl -X POST https://three.ws/api/teams/$TEAM/run \
  -H 'content-type: application/json' -H "x-csrf-token: $CSRF" -b cookies.txt \
  -d '{"action":"research","input":{"mint":"FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump"}}'

# Ask the Trader for a quote: it cites research or runs it first
curl -X POST https://three.ws/api/teams/$TEAM/run \
  -H 'content-type: application/json' -H "x-csrf-token: $CSRF" -b cookies.txt \
  -d '{"action":"trade","input":{"mint":"FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump","side":"buy","amount":0.01,"mode":"quote"}}'

# Watch the board live
curl -N -b cookies.txt https://three.ws/api/teams/$TEAM/findings/stream
```

## Limits

- 12 teams per account, 4 custom specialists per team.
- Per trade cap 0.001 to 50 SOL, daily budget 0.001 to 500 SOL, finding lifetime
  1 minute to 24 hours.
- Writes are limited to 20 an hour and specialist runs to 60 every 10 minutes
  per account.
- A live trade needs the signed real-funds agreement, `confirm: true`, and for a
  bearer token the `wallet:write` scope.

## Where it lives

Runtime [api/_lib/teams/](../api/_lib/teams/) (roles and ceilings, the board,
research, the runners), endpoints [api/teams/](../api/teams/), migration
`api/_lib/migrations/20261010120000_teams.sql`, page
[pages/teams.html](../pages/teams.html) with [src/teams.js](../src/teams.js),
tests [tests/teams-runtime.test.js](../tests/teams-runtime.test.js). Related:
[Trading swarms](./swarms.md) pool capital across agents; a team keeps every
agent in one owner's account.
