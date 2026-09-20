# The prompt library

[three.ws/prompts](https://three.ws/prompts) is a library of prompts written to
be copied out and pasted into your own assistant. Each one is a complete
instruction: what to build, which endpoint or tool to use, and what to hand back.
You replace the parts in `<angle brackets>` and send it.

It exists because the gap between "three.ws has a free text-to-3D API" and "my
Claude just made me a rigged avatar" is a paragraph of prose that nobody should
have to write twice. The library writes it once, correctly, for the paths that
actually work.

Everything in it is real. The endpoints are live, the tool names are the ones the
servers advertise, and nothing in a prompt asks an assistant to pretend.

## The three ways in

Most prompts need nothing installed. The rest ask for one connection you make
once and keep.

| Setup | What it means | How |
|---|---|---|
| **No setup** | The prompt tells your assistant which public endpoint to call. It works anywhere Claude can make an HTTP request or run a command. | Nothing to do. |
| **Free MCP server** | The three.ws 3D Studio as native tools: generate, rig, refine, look at a model, give it a persona. No account, no key, no payment. | `claude mcp add --transport http three-ws-studio https://three.ws/api/mcp-studio`, or add that URL as a custom connector in the Claude apps with authentication set to None. See [MCP Studio](./mcp-studio.md). |
| **Skills pack** | The [Agent Skills](./agent-skills.md) pack, so your assistant already knows the platform's endpoints and rules and your prompts can be one sentence long. | Install the `three-ws-core` plugin, or copy a folder from `.agents/skills/` into your project's `.claude/skills/`. |
| **Agent wallet** | A funded agent wallet, for the prompts that buy or sell calls in the x402 economy. | Start at [three.ws/start](https://three.ws/start). |

## Using one well

- **Replace every placeholder.** `<a weathered brass diving helmet>` is a slot,
  not a suggestion. A prompt sent with the brackets still in it produces a
  diving helmet.
- **Keep the verification lines.** Several prompts end by telling the assistant
  to look at the result before declaring success, or to poll a queued job instead
  of giving up on the first pending response. Those lines are there because
  removing them is how you get a confident answer about a model that never
  finished generating.
- **Keep the stop lines.** The prompts under "the agent economy" that can spend
  money are written so the assistant has to show you the amount and the recipient
  and wait for your yes. That sentence is load-bearing. Do not trim it.
- **Edit freely otherwise.** These are starting points. The library's job is to
  get the endpoint, the polling and the failure handling right so you can spend
  your attention on the part that is specific to you.

## Machine-readable

The library is published as data, so an agent can read the whole thing without
scraping the page:

```bash
curl -s https://three.ws/prompts.json     # structured: categories, setups, tags, prompts
curl -s https://three.ws/prompts.txt      # the same prompts as plain text
```

`prompts.json` carries the counts and indexes the page renders from
(`categories`, `setups`, `tags`, `byCategory`, `bySetup`), and every prompt
object holds `id`, `title`, `summary`, `category`, `setup`, `prompt`, `returns`,
`tags` and `links`. `prompts.txt` is the version to pipe into another assistant
whole:

```bash
curl -s https://three.ws/prompts.txt | pbcopy
```

Deep-link to a single prompt with its id: `https://three.ws/prompts#rig-my-glb`.
Filters live in the URL too, so a link can carry a whole view:
`https://three.ws/prompts?category=create&setup=none`.

## Adding a prompt

The library is one file: [`data/prompt-library.json`](https://github.com/nirholas/three.ws/blob/main/data/prompt-library.json).
A prompt is an object in `prompts`, with the body written as an array of lines
so a diff shows what changed:

```jsonc
{
  "id": "rig-my-glb",
  "title": "Rig a GLB you already have",
  "summary": "Add a humanoid skeleton and skin weights to a static model.",
  "category": "create",          // must exist in `categories`
  "setup": "mcp-studio",         // must exist in `setups`
  "tags": ["rigging", "glb", "mcp"],
  "prompt": ["Rig this GLB so it can be animated: <https://example.com/x.glb>", "", "..."],
  "returns": "A rigged GLB plus a pose-studio link to check the joints.",
  "links": [{ "label": "Rig Doctor", "href": "/rig-doctor" }],
  "added": "2026-09-20"
}
```

Then rebuild the published files:

```bash
npm run build:prompt-library
```

`scripts/build-prompt-library.mjs` writes `public/prompts.json` and
`public/prompts.txt`, and validates the entry on the way through: ids are unique
and kebab-case, the category and setup exist, placeholder brackets are balanced,
every internal link is a route declared in `data/pages.json`, and the house ban
on dash glyphs holds. `npm run check:prompt-library` runs the same validation
without writing, and it is wired into `npm run gate`, so an edit that never got
built cannot ship a stale library.

Write a prompt the way you would write an instruction to a capable colleague who
has never used the platform: name the endpoint or the tool, say what to do when
it returns a pending job, and say what you want handed back. If a prompt can
spend money, make it stop for a confirmation.

## Related

- [Agent Skills](./agent-skills.md): the same capabilities as skills your
  assistant loads automatically, rather than prompts you paste.
- [MCP Studio](./mcp-studio.md): the free 3D MCP server most of these prompts use.
- [3D API](./3d-api.md): the keyless HTTP endpoints behind the no-setup prompts.
- [Embedding](./embedding.md): what the web-component prompts are driving.
