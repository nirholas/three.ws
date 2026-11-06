# Event markets briefs: archive

Briefs whose definition of done is verified, moved here from [../](../README.md) so the open set
is the folder above.

- [03 Auto-resolution](03-auto-resolution.md): production auto-resolved "Who wins Daily Arena,
  Nov 5?" from the tournament's final standings and stored that evidence on the market; the tie,
  no-data and cancelled paths are covered in `tests/event-market-resolvers.test.js` (all
  event-markets suites pass, 228 tests, 2026-11-06).
- [04 Auto-open for every event](04-auto-open-for-every-event.md): production opens a market per
  Arena tournament on its own; duplicate and late-entrant handling are covered in
  `tests/event-markets-auto-open.test.js`.
