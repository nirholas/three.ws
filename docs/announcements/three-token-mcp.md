# Announcement pack: the $THREE token MCP server

**Surface:** [`@three-ws/three-token-mcp`](https://www.npmjs.com/package/@three-ws/three-token-mcp) ·
**Ledger key:** `@three-ws/three-token-mcp` · **Stage:** drafted · **Published to npm:** 1.1.3 is `latest`
· **Announced externally:** never

Listed as never announced in [the coverage audit](../announcement-coverage.md), which flags it as the
$THREE-native post that "writes itself". Token topic is the account's highest measured lift (13.3x),
and this is a feature that genuinely touches the token rather than mentioning it. Written against
[the announcement voice](../announce-voice.md).

---

## The claim, and where it is checked

> An MCP server that lets an AI assistant burn $THREE on Solana. Its burn tool is declared
> irreversible to the client, and by default the server refuses to sign until the call carries
> `confirm: true`.

| Part of the claim | Where it is real |
|---|---|
| It is a published MCP server anyone can run | `npm view @three-ws/three-token-mcp` returns 1.1.3 as `latest` (4 versions, Apache-2.0, maintainer `three-ws`). Running `npx -y @three-ws/three-token-mcp@1.1.3` over stdio on 2026-09-17 answered `initialize` as `three-token-mcp` 1.1.3 and `tools/list` with exactly `three_price`, `three_balance`, `three_burn`. |
| It burns $THREE on Solana | [`packages/three-token-mcp/src/lib/token.js`](../../packages/three-token-mcp/src/lib/token.js) `burnThree()` builds one Solana mainnet transaction (SPL transfer per leg plus a memo), signs, sends, and confirms. The live catalog detail reads "signs and broadcasts on Solana mainnet". |
| It can only ever burn $THREE | `assertCanonicalThree()` in the same file refuses to sign unless the mint served by `/api/token/config` equals `THREE_MINT` in [`src/config.js`](../../packages/three-token-mcp/src/config.js) (`FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump`). Not in the post, but it is why the post is safe to make. |
| Flagged irreversible | `annotations: { readOnlyHint: false, destructiveHint: true, ... }` in [`src/tools/three-burn.js`](../../packages/three-token-mcp/src/tools/three-burn.js). The public [MCP Tool Catalog](https://three.ws/mcp-tools?server=three-token-mcp) classifies it as **Irreversible** ("Cannot be undone once it runs.") and the two reads as **Read-only**; that page is generated from tool source, so the label cannot drift. |
| By default it will not sign without `confirm: true` | The handler in `three-burn.js` returns `confirmation_required` before `burnThree()` is ever called when `REQUIRE_CONFIRM && confirm !== true`, and `REQUIRE_CONFIRM` in `config.js` is `true` unless the operator sets it to `0`/`false`. Confirmed live: a `three_burn { usd: 1 }` call against the published 1.1.3 package came back `"error": "confirmation_required"` with nothing signed. |
| Where the burned tokens go | The burn leg routes to the Solana incinerator (`1nc1nerator11111111111111111111111111111111`). `computeSplit()` sends the rest to the treasury only when the live config has one; `/api/token/config` currently serves `"treasury": null`, so today a burn sends 100% to the incinerator. This is why the post says "burn" and does not promise a treasury split. |

Full mechanism: [`packages/three-token-mcp/README.md`](../../packages/three-token-mcp/README.md);
install lines for every three.ws server: [docs/mcp.md](../mcp.md).

## Media

Captured from the live route by `npm run announce:media` against the recipe below. Provenance
(route, commit, time, sha256) lands in
[`public/announce/media-manifest.json`](../../public/announce/media-manifest.json).

| Shot | File | Notes |
|---|---|---|
| `three-token-mcp-hero` | `/announce/img/three-token-mcp-hero.webp` | 1800x1013, signed out. The MCP Tool Catalog filtered to this server: the "Let your assistant run the safe ones by itself" policy with its Strict, Balanced and Open profiles, then the server's three tools with `three_burn` badged Irreversible and the two reads badged Read-only. |

**Alt text, required on the post:**

> The three.ws MCP Tool Catalog filtered to the @three-ws/three-token-mcp server: 3 of 321 tools,
> with three_balance and three_price labelled read-only and three_burn labelled irreversible, all free

What the recipe frames out, and why. The catalog's tool subtitles and descriptions name the
third-party price source the tools quote from, which would put another crypto project into a
committed frame; they are hidden (`.mc-title`, `.mc-desc`), leaving each tool's name and its safety
and price badges, which are the subject. The policy snippet block (`.mc-policy-out`) is hidden so the
profiles and the three tools fit one 16:9 frame. Nothing is restaged: every badge, count and label is
what the live page rendered.

The two existing `three-token-hero` and `three-token-trades` shots already carry this package as
their surface, and were checked before this one was captured. They were not reused: they frame
`/three-token`, show no part of the MCP server, were captured 2026-09-04 with a price that no longer
matches the live page, and carry third-party venue buttons in the frame.

## The post

Pattern: mechanism lead. **179 weighted characters** by `post-tweet.mjs` (which counts the bare
link at its real 41 characters; X itself counts it as 23, so it lands near 161 on the platform),
inside the 100 to 179 band. Tags `@solana` because the burn is a Solana mainnet transaction and
$THREE is an SPL token.

Postable file: [`three-token-mcp.post.txt`](./three-token-mcp.post.txt).

```text
An MCP server that lets an AI burn $THREE on @solana. three_burn is flagged irreversible and by default won't sign without confirm: true. three.ws/mcp-tools?server=three-token-mcp
```

Ship it with `three-token-mcp-hero` attached and the alt text above.

### Why it is written that way

A token burn tool invites two readings: a gimmick, or a foot-gun that lets a model spend your
wallet. The second is the objection a developer actually raises, so the post answers it inside
the mechanism instead of hyping the first. "Flagged irreversible" is the MCP annotation clients
use to decide whether to prompt; "won't sign without confirm: true" is the server-side gate that
holds even against a client that ignores the annotation. Both are checkable in the linked page.

`@AnthropicAI` was considered (MCP is their protocol, and the voice guide allows the tag for an
MCP server) and left off: the post already carries the tag the mechanism depends on, and a second
tag spends characters the band does not have. The `npx` line is not in the post on purpose: X
would parse `@three-ws` in `@three-ws/three-token-mcp` as a mention of an account we do not own.
The linked catalog entry carries the exact install command.

Cut to hold the band, all true and all in the Telegram variant: the canonical-mint assertion, the
default $100 per-burn cap, and the two read-only tools.

## Telegram variant

```text
The $THREE token now has its own MCP server, and it has never been posted about.

npx -y @three-ws/three-token-mcp

Any MCP client (Claude Code, Claude Desktop, Cursor) gets three tools:

- three_price: the live USD price of $THREE, and how much $THREE a USD amount buys. Read-only.
- three_balance: the $THREE and SOL balance of any Solana wallet. Read-only.
- three_burn: burns a USD amount of $THREE your wallet already holds, in one Solana transaction.

The burn is built to be hard to misuse:

- It is flagged irreversible, so clients that honour MCP annotations ask you before it runs.
- The server itself refuses until the call carries confirm: true, whatever the client does.
- Each burn is capped at $100 by default (MAX_BURN_USD).
- Before signing, it checks the token is the canonical $THREE mint, so a bad config can never
  point it at another token.

See all three tools and their safety labels: three.ws/mcp-tools?server=three-token-mcp
```

## Changelog

**No new entry.** The package shipped with the 2026-06-13 entry ("All 14 three.ws MCP servers are
now live on npm and the official MCP registry"). This pack announces an existing package externally
for the first time; it ships nothing new.

## Posting

Publishing to an external channel is owner-gated under the operating rules, every time. Nothing in
this pipeline posts. The queue item is `three-token-mcp` (lane `token`, pattern `mechanism`). Its
status in `data/x-content/queue.json` is now `posted` (marked in the 2026-10-13 shipped-posts
sweep), while [the coverage ledger](../announcement-coverage.md) still lists the package as never
announced, so confirm against the account before any re-send. Preview with:

```bash
node scripts/post-tweet.mjs --file docs/announcements/three-token-mcp.post.txt --dry-run
npm run x:content -- run --dry-run --id three-token-mcp
```
