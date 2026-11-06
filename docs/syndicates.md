# Syndicates: copy-trade as a team

A syndicate is a named team of copiers who follow the same one to three
verified trader agents together. The team shares a flag (a name, a motto and a
color), a public page with its roster, a group equity curve built from its
members' real copies, and a standing on a board against every other syndicate,
with the rival one rank away named on the page.

Pages: [/syndicates](https://three.ws/syndicates) (the board and founding) ·
`/syndicates/<slug>` (one syndicate) · API: `/api/syndicates`

## What it is not

A syndicate never pools money. There is no shared wallet, no vault and no
custody. Every member copies from their **own** wallet with their **own**
per-trade cap, daily budget and drawdown limit, exactly as a solo copier on
[copy trading](copy-trading.md) does, and every copy is still an intent the
member signs. Joining creates ordinary copy subscriptions; leaving stops them.
That keeps a syndicate fully reversible: nothing about it can move a member's
funds that a solo follow could not.

## How it works

1. **Found one.** Pick a name (it becomes the address, `three.ws/syndicates/<slug>`),
   an optional motto, a flag color, and one to three leaders. Every leader must
   be a public trader agent that clears the copyable bar (at least 5 closed
   round-trips over at least 24 hours with at least 0.1 SOL deployed; see
   `LEADER_ELIGIBILITY` in `api/_lib/copy-eligibility.js`). Founding moves no
   money and subscribes nobody. A user may run at most 3 active syndicates per
   network. A leader's own owner may found one as their fan club; it is marked
   **Official** on the board.
2. **Join it.** A member enters the Solana wallet they copy from and their
   caps. The join runs the same guarded follow path as a single follow on a
   trader profile (`api/_lib/copy-subscribe.js`): the self-copy refusal, the
   copyable bar and the caps validation. It creates one copy subscription per
   leader. If the member already copies one of the leaders, that subscription is
   **linked, not overwritten**, so joining never silently changes caps someone
   set earlier. A join is all or nothing: if any follow fails, the membership and
   any subscription it created are rolled back.
3. **Ride together.** When a leader trades, each member gets a sized, safety
   checked intent on [/dashboard/copy](https://three.ws/dashboard/copy), exactly
   like a solo follow. Pause, resume or change caps per leader there.
   A copy is skipped, with the reason shown on the skipped row
   (`leader_linked_to_creator`), when the leader's wallet scores as the same
   controller as that coin's creator, so nobody mirrors a creator's own buy of
   their own launch.
4. **Leave.** Leaving stops only the subscriptions the join created. A
   subscription the member had before joining keeps running exactly as it was.
   Positions already held are never touched.

One syndicate per copier per network. A syndicate is a side you are on, and two
memberships would also count the same copy twice in two group curves.

## The numbers, and why they are honest

- **Group P&L** is the sum, over every member's acted copies whose leader
  position has closed, of `planned_sol x leader realized return`. That is the
  same profit basis the performance fee uses (`api/_lib/copy-earnings.js`), so a
  syndicate cannot look better than what its members would be billed on.
  Losers count. Only copies made while a member was in the syndicate count.
- **Leaders since formed** is what the followed leaders did on-chain since the
  syndicate was founded: live closes only (paper trades never generate copy
  intents, so they are excluded), realized P&L and ROI on capital deployed. It
  is measurable before any member has copied anything.
- **Leader records** on the page are whole closed records, losses included,
  with the copyable verdict and every unmet criterion named.
- **The roster** shows usernames only. A member's wallet and sizes are never
  public.

Nothing stores a performance number. Every figure is computed on read from
`copy_executions` and `agent_sniper_positions`.

## API

All responses are JSON. Errors use the platform shape
`{ "error": "<code>", "error_description": "<message>" }`.

### `GET /api/syndicates`

The board. Public and cacheable.

| Param | Default | Meaning |
|---|---|---|
| `network` | `mainnet` | `mainnet` or `devnet` |
| `sort` | `profit` | `profit`, `members` or `new` |
| `limit` | `24` | 1 to 100 |
| `offset` | `0` | for paging |
| `leader` | none | an agent id: only syndicates following that agent (ranks stay board-wide) |
| `include` | none | `candidates` to always include the founding candidates |

Returns `{ total, matched, syndicates: [...], colors, max_leaders, candidates? }`.
Each syndicate carries `rank` (its profit rank on the whole board), `members`,
`leaders`, `performance` and `since_founding`. While the board is empty,
`candidates` lists the leaders a first syndicate could form around.

```bash
curl -s 'https://three.ws/api/syndicates?sort=profit&limit=5'
```

### `GET /api/syndicates/leaders`

Leaders a syndicate can be founded around, each with its whole record and
copyable verdict, copyable first. Public. `network`, `limit` (1 to 50).

### `GET /api/syndicates/:slug`

One syndicate: `syndicate`, `leaders`, `members` (`count`, `copying`,
`alumni`, `list`), `performance` (including `curve.points`), `since_founding`,
`standing` (`rank`, `total`, `rival`), and `joinable`. Public and cacheable.

### `POST /api/syndicates`

Found a syndicate. Auth required (session cookie with a CSRF token, or a
bearer key).

```json
{ "name": "Night Shift Degens", "motto": "We ride the 3am tape together.",
  "color": "#22d3ee", "leader_agent_ids": ["<agent uuid>"] }
```

`201 { syndicate, official }`. Refusals: `invalid_syndicate` (400),
`leader_not_found` (404), `leader_not_copyable` (409, with `leaders[].unmet`),
`name_taken` (409), `founder_limit` (409).

### `GET /api/syndicates/membership?slug=<slug>`

The signed-in viewer's relationship to a syndicate: `member` (with the
subscriptions the membership rides on and which ones the join created),
`owns_leader`, `is_founder`, and `other_syndicate` when they ride elsewhere.

### `POST /api/syndicates/membership`

Join:

```json
{ "slug": "night-shift-degens", "action": "join",
  "copier_wallet": "<your Solana address>", "sizing_rule": "fixed", "fixed_sol": 0.1,
  "per_trade_cap_sol": 0.5, "daily_budget_sol": 1, "max_drawdown_pct": 35 }
```

Every tunable `/api/copy/subscriptions` accepts is accepted here and applied to
each leader. `201 { joined: true, membership }`, or `200 { already: true }` when
already a member. Refusals: `invalid_wallet`, `invalid_config` (400),
`self_copy` (403), `already_in_syndicate` (409, with `current`),
`leader_not_copyable` (409).

Leave: `{ "slug": "night-shift-degens", "action": "leave" }` returns
`{ left: true, stopped_subscriptions, kept_subscriptions }`.

## Data

Migration `api/_lib/migrations/20260929120000_copy_syndicates.sql`:
`copy_syndicates`, `copy_syndicate_leaders`, `copy_syndicate_members` (a
partial unique index enforces one active team per copier per network) and
`copy_syndicate_member_subs` (which subscriptions a membership rides on, and
whether the join created them). Code: `api/_lib/syndicates.js`,
`api/syndicates/*`, `src/syndicates.js`, `src/syndicate.js`.

## Related

- [Copy trading](copy-trading.md): the engine underneath, the fee and the caps
- [Ghost-copy](ghost-copy.md): paper-copy a leader before joining anything
- [Trading quests](trading-quests.md): daily goals and XP around the same loop
- Every trader profile (`/trader/<id>`) lists the syndicates following that trader
