# Builder competitions: how to run one

[/compete](https://three.ws/compete) lists every competition configured in [data/competitions.json](../data/competitions.json). The file ships as an empty array, and with it empty the page and the API say "no competition is running". Running one is a config edit and a deploy, not a build.

## The format

A builder enters an agent, launches that agent's coin through three.ws before the tokenize deadline, and ranks on a live leaderboard by the creator fees the agent earns. An entry is **tokenized** when its agent launched a mainnet coin through three.ws (a row in `pump_agent_mints`) between `starts_at` and `tokenize_by`. Fees come from the creator-earnings snapshot behind the [agent earnings page](https://three.ws/leaderboard?tab=earned), attributed by the same rule, so the board and an agent's own page never disagree. Untokenized entries are listed after the ranked ones.

## Add a competition

Append an object to `data/competitions.json`. Every field is validated when the API reads the file; an invalid file answers `competitions_config_invalid` naming the field, and `tests/competitions.test.js` fails in CI.

| Field | Meaning |
|---|---|
| `slug` | URL id, lowercase letters, digits and `-`. The page is `/compete/<slug>`. |
| `title`, `summary` | Heading and one-line description. |
| `starts_at` | Registration opens (ISO 8601). Launches count from here. |
| `register_by` | Registration closes. |
| `tokenize_by` | Last moment a coin launch counts. |
| `ends_at` | Competition ends. Order: `starts_at` < `register_by` and `tokenize_by` <= `ends_at`. |
| `tracks` | `[{ name, description }]`. When present, an entry must pick one. |
| `prizes` | `[{ place, amount, asset, vesting }]`. Display only; paying a prize is a spend and goes through the normal confirmation. |
| `judges` | `[{ name, role, url }]`. |
| `rules` | List of rule sentences. |
| `winners` | After judging: `[{ place, agent_id, note }]`. Shown when the competition has ended. |

Phases, from the clock: `upcoming` (before `starts_at`), `open` (registration), `building` (registration closed), `ended`. The hero counts down to the next deadline.

## Example

```json
[
  {
    "slug": "autumn-build",
    "title": "Autumn Agent Build",
    "summary": "Ship an agent, launch its coin, earn the most creator fees.",
    "starts_at": "2026-11-01T00:00:00Z",
    "register_by": "2026-11-20T23:59:00Z",
    "tokenize_by": "2026-12-05T23:59:00Z",
    "ends_at": "2026-12-12T23:59:00Z",
    "tracks": [{ "name": "Trading", "description": "Agents that trade on Solana." }],
    "prizes": [{ "place": "1st", "amount": 5000, "asset": "USDC", "vesting": "Paid within 14 days of the end." }],
    "judges": [{ "name": "Jane Doe", "role": "Judge" }],
    "rules": ["The agent must be public.", "The coin must be launched through three.ws inside the window."]
  }
]
```

## API

- `GET /api/competitions` lists competitions with their phase.
- `GET /api/competitions/:slug` returns the competition, the ranked entries, the ranking method and the viewer's own entries.
- `GET /api/competitions/:slug/entries` returns the entries alone.
- `POST /api/competitions/:slug/entries` registers `{ agent_id, track, team_name, x_handle }` for the signed-in caller. It enforces the registration window, that the agent belongs to the caller and is public, a known track, and one entry per agent.

Registrations live in `competition_entries` ([migration](../api/_lib/migrations/20261023200000_competition_entries.sql)). Code: [api/_lib/competitions.js](../api/_lib/competitions.js), [api/competitions.js](../api/competitions.js), [src/compete.js](../src/compete.js).
