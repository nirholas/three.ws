# Docs PR: supported-services.mdx row

Add this row to the `## Extensions` table in
`api-reference/server/services/supported-services.mdx` (alphabetical by
link text, after "Pipecat Backchannel" and before "Turn Blend"; table
re-measured 2026-11-14 against `pipecat-ai/docs` main):

```
| [three.ws Avatar](/api-reference/server/extensions/pipecat-threews)           | `uv add pipecat-threews`                                                   | Community  |
```

Full table after the addition:

```
| Extension                                                                     | Setup                                                                      | Maintainer |
| ----------------------------------------------------------------------------- | -------------------------------------------------------------------------- | ---------- |
| [DuplexJev Turn Analyzer](/api-reference/server/extensions/pipecat-duplexjev) | `uv add pipecat-duplexjev`                                                 | Community  |
| [IVRNavigator](/api-reference/server/extensions/ivr)                          | Built in                                                                   | Pipecat    |
| [Pipecat Backchannel](/api-reference/server/extensions/pipecat-backchannel)   | `uv add pipecat-backchannel`                                               | Community  |
| [three.ws Avatar](/api-reference/server/extensions/pipecat-threews)           | `uv add pipecat-threews`                                                   | Community  |
| [Turn Blend](/api-reference/server/extensions/pipecat-turn-blend)             | `uv pip install git+https://github.com/adhiraj4802/pipecat-turn-blend.git` | Community  |
| [VoicemailDetector](/api-reference/server/extensions/voicemail)               | Built in                                                                   | Pipecat    |
```
