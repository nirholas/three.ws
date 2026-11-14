# Docs PR: docs.json navigation entry

In `docs.json`, the `Extensions` group lives at
`navigation.tabs[4].groups[2].pages[5]` (re-measured 2026-11-14 against `pipecat-ai/docs` main) and is a flat, alphabetically sorted
list of page paths. Add `"api-reference/server/extensions/pipecat-threews"`
after `pipecat-duplexjev` and before `pipecat-turn-blend`:

```json
{
  "group": "Extensions",
  "pages": [
    "api-reference/server/extensions/ivr",
    "api-reference/server/extensions/pipecat-backchannel",
    "api-reference/server/extensions/pipecat-duplexjev",
    "api-reference/server/extensions/pipecat-threews",
    "api-reference/server/extensions/pipecat-turn-blend",
    "api-reference/server/extensions/voicemail"
  ]
}
```

No `redirects` entry is needed. `COMMUNITY_INTEGRATIONS.md` says to add one
"following the existing pattern", and the existing pattern for a brand-new
community extension page is none: `docs.json` holds 483 redirects, and the only
`extensions` ones map the old `utilities/extensions/ivr` and `voicemail` URLs.
`pipecat-backchannel`, `pipecat-duplexjev` and `pipecat-turn-blend` (merged
2026-11-13) have no redirect entry.
