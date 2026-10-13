# Docs PR: docs.json navigation entry

In `docs.json`, the `Extensions` group lives at
`navigation.tabs[4].groups[1].pages[3]` and is a flat, alphabetically sorted
list of page paths. Add `"api-reference/server/extensions/pipecat-threews"`
after `pipecat-duplexjev` and before `voicemail`:

```json
{
  "group": "Extensions",
  "pages": [
    "api-reference/server/extensions/ivr",
    "api-reference/server/extensions/pipecat-backchannel",
    "api-reference/server/extensions/pipecat-duplexjev",
    "api-reference/server/extensions/pipecat-threews",
    "api-reference/server/extensions/voicemail"
  ]
}
```

No `redirects` entry is needed: this is a brand-new page with no prior URL,
and the other community extension pages (`pipecat-backchannel`,
`pipecat-duplexjev`) have none either.
