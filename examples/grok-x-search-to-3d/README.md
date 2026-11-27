# What is X talking about? Turn it into a 3D prop.

Grok searches X for a topic from the last seven days and summarizes the
conversation. It designs one physical prop that captures the conversation and
drafts a short post introducing it. The three.ws studio server makes that prop
as a textured GLB, and the script prints the draft post with the prop's 3D
viewer link filled in. **It never posts anything.** You copy the draft if you
like it.

Zero dependencies: Node's built-in `fetch` calls the xAI **Responses API** with
the `x_search` tool, then the three.ws studio server over MCP.

## Prerequisites

- Node 22 or newer.
- `XAI_API_KEY`: an xAI API key from [console.x.ai](https://console.x.ai), for
  the X search.
- `THREE_WS_API_KEY`: a free three.ws account key from
  [three.ws/dashboard/api-keys](https://three.ws/dashboard/api-keys), to make
  the prop. Without it, the closest free catalog asset stands in.

## Run it

```bash
cd examples/grok-x-search-to-3d
npm ci            # nothing to download: it records the Node version only

# three.ws leg only: lists the studio tools and runs a catalog search (no keys)
npm run check

# print the exact request sent to xAI (no key, no call)
npm run dry-run

# the full run: X search, the prop, the draft post
XAI_API_KEY=... THREE_WS_API_KEY=... node index.mjs "lunar landers"

# skip Grok and make a prop from your own prompt
THREE_WS_API_KEY=... node index.mjs --prop "a chrome lunar lander with gold foil legs"

npm test          # request shape, answer parsing, link filling, busy retries
```

| Variable | Default | Purpose |
|---|---|---|
| `XAI_API_KEY` (or `GROK_API_KEY`) | none | Required for the X search. |
| `THREE_WS_API_KEY` | none | Makes the prop. Without it, a catalog asset stands in. |
| `XAI_MODEL` | `grok-4.7` | Any xAI model with the `x_search` tool. |
| `THREE_WS_MCP_URL` | `https://three.ws/api/mcp-studio` | Point at a local server while developing. |

Exit codes: `0` success, `1` a call failed, `2` no xAI key.

## How it works

1. **X search with a fixed answer shape.** The request has two parts:

   ```js
   tools: [{ type: 'x_search', from_date: '2026-11-13', to_date: '2026-11-20' }],
   text: { format: { type: 'json_schema', name: 'prop_brief', schema: BRIEF_SCHEMA, strict: true } },
   ```

   Grok answers with `{ topic_summary, prop_prompt, draft_post }`. The prop
   prompt describes one object by shape, material and color, with no people, no
   logos and no text. The draft post carries a `{link}` slot. The script prints
   how many searches Grok ran and the X posts it cited.

2. **The prop.** The script opens an MCP session with the studio server, calls
   `forge_free` with the prop prompt, then polls `check_job` until the GLB is
   ready, for up to six minutes. A busy generator says how long to wait, and
   the script retries up to five times with the same idempotency key, so a retry
   never starts a second generation.

3. **The draft.** `{link}` becomes the three.ws viewer link. The script prints
   the draft and stops there.

## Sample output

`npm run check`, captured 2026-11-27 against production:

```text
server   three-ws-3d-studio-free (https://three.ws/api/mcp-studio), 21 tools
catalog  Moon Rock 01  https://pub-2534e921bf9c4314addcd4d8a6e98b7b.r2.dev/objects/polyhaven/glb/moon_rock_01.glb
ok       three.ws leg is live
```

`XAI_API_KEY=... THREE_WS_API_KEY=... node index.mjs "lunar landers"`, the full
run, captured 2026-11-27 against production. Grok searched X, wrote the brief,
and the prop was made on the free lane:

```text
x_search "lunar landers", last 7 days
grok     2 search call(s), 13 posts fetched
cited    https://x.com/i/status/2124974223093625158
cited    https://x.com/i/status/2126363956944265506
cited    https://x.com/i/status/2124959056741970050
cited    https://x.com/i/status/2124973920168399075
cited    https://x.com/i/status/2126382323490845004
summary  People on X are talking up commercial lunar landers from Firefly, Intuitive Machines, and SpaceX’s Starship HLS as bets on Artemis and a future lunar economy. Skeptics counter that a huge Starship-style lander is too inefficient and risky, while others point to smaller designs, Artemis timelines, and international plans.
prop     A squat brushed-silver metal cylinder on four thin splayed legs with broad pads, standing on a rough charcoal-gray cratered disc.
job      pending (running), checking again in 20s
glb      https://three.ws/cdn/forge/anon/3a089254-f1da-4027-90c9-a1505e1f10bc.glb  (made in 80s)
viewer   https://three.ws/viewer?src=https%3A%2F%2Fthree.ws%2Fcdn%2Fforge%2Fanon%2F3a089254-f1da-4027-90c9-a1505e1f10bc.glb&title=Squat%20silver%20cylinder%20with%20brushed%20metal%20grain%2C%20on%20four%20thin%20legs%20with%20broad%20ma%E2%80%A6

draft post (not posted, copy it if you like it):

X is split on lunar landers: huge Starship or smaller craft. One quiet silver prop for the argument. https://three.ws/viewer?src=https%3A%2F%2Fthree.ws%2Fcdn%2Fforge%2Fanon%2F3a089254-f1da-4027-90c9-a1505e1f10bc.glb&title=Squat%20silver%20cylinder%20with%20brushed%20metal%20grain%2C%20on%20four%20thin%20legs%20with%20broad%20ma%E2%80%A6
```

A prop made on the free lane with a free three.ws key and no xAI key
(`node index.mjs --prop "a low-poly wooden chair"`), captured the same day:

```text
prop     a low-poly wooden chair
job      pending (running), checking again in 20s
job      pending (running), checking again in 12s
glb      https://three.ws/cdn/forge/anon/4e8135ca-2974-4028-82fe-6a3f7aad6a22.glb  (made in 83s)
viewer   https://three.ws/viewer?src=https%3A%2F%2Fthree.ws%2Fcdn%2Fforge%2Fanon%2F4e8135ca-2974-4028-82fe-6a3f7aad6a22.glb&title=Low-poly%20wooden%20chair%20with%20simple%20cubic%20seat%2C%20back%2C%20and%20legs%2C%20matte%20wood%20grain%2C%E2%80%A6
```

`--prop` with no three.ws key, so a catalog asset stands in (captured 2026-11-20):

```text
prop     a chrome lunar lander with gold foil legs
note     THREE_WS_API_KEY is not set, so the closest free catalog asset stands in (free key: https://three.ws/dashboard/api-keys)
glb      https://pub-2534e921bf9c4314addcd4d8a6e98b7b.r2.dev/objects/polyhaven/glb/brass_pan_01.glb  (catalog: Brass Pan 01)
viewer   https://three.ws/viewer?src=https%3A%2F%2Fpub-2534e921bf9c4314addcd4d8a6e98b7b.r2.dev%2Fobjects%2Fpolyhaven%2Fglb%2Fbrass_pan_01.glb
```

The full run with an xAI key that is not valid (captured 2026-11-20). The
request really reaches `api.x.ai`, and the error is xAI's own:

```text
x_search "lunar landers", last 7 days
error    xAI answered HTTP 400: {"code":"invalid-argument","error":"Incorrect API key provided. You can obtain an API key from https://console.x.ai."}
```

## Cost

- **three.ws:** free. Catalog search needs no account, and making the prop runs
  on the free lane with a free account.
- **xAI:** Grok's tokens at your model's [xAI rate](https://docs.x.ai/docs/models),
  plus xAI's per-source price for the X search (the response's
  `server_side_tool_usage_details` reports the posts fetched). One run is one
  search turn of up to four tool rounds.
