# 923 Builder competition: remaining owner-gated steps

The competition feature is built and committed (`/compete`, `/compete/:slug`, `/api/competitions`, `competition_entries` migration, `docs/competitions.md`, empty `data/competitions.json`). What remains:

1. Apply the migration (not yet applied to production): `npm run db:status`, then `node scripts/apply-migrations.mjs --apply --file 20261023200000_competition_entries.sql`. Until applied, `/api/competitions/:slug` returns 500 against production; the list endpoint already works.
2. Deploy (owner-gated).
3. Owner supplies the competition parameters, then add them to `data/competitions.json` following the example in `docs/competitions.md`: slug, title, dates (registration open and close, tokenize-by, end), tracks, prize pool and funding source, judges, eligibility and rules.
4. Prize payouts are spends: render recipient, amount and token for explicit approval before any transfer.
5. When the first competition goes live, add a `data/changelog.json` entry and run `npm run build:pages`.
