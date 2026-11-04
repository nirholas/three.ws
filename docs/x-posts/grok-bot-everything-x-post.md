# X posts: Grok Bot can use all of three.ws

Announcement copy for the Grok push: three.ws on Grok Bot is no longer only a 3D connector. Signed
in, the same connector runs the user's agents and reads the Solana market; three.ws events can start
a Grok Bot routine; and Grok Build gets a native plugin. Internal staging only. Posting is
owner-gated (CLAUDE.md gate 2), and every post goes from `@trythreews` (see
[`x-accounts.md`](../x-accounts.md)).

**Hold all four until production is deployed.** The market tools on `/api/mcp-grok`, the
`market-brief` prompt and webhook bearer tokens were built on 2026-11-04 and are not live until
the next deploy (and the `20261104200000_webhook_bearer_token` migration, which must land first).
The Grok Build plugin post also waits for `git push`, because the install copies the folder from
GitHub. Verify each claim against production before posting, then post in the order below.

**Every claim below is true in the code as of 2026-11-04:**

- The Grok connector (`https://three.ws/api/mcp-grok`) serves the free studio anonymously, and
  signed in (OAuth 2.1 or a connector key) it adds the account's agent tools plus read-only market
  tools: `pumpfun_recent_graduations`, `pumpfun_token_intel`, `oracle_top_plays`,
  `sentiment_scout`, `token_due_diligence`, `trader_leaderboard`, `solana_agent_passport` and
  others ([`api/_mcp-studio/account-tools.js`](../../api/_mcp-studio/account-tools.js)).
- A tool is admitted there only if it is not in the financial tier, needs no wallet, payment or
  trade scope, and carries no price. No tool on it trades, sends or spends.
- `market-brief` is a guided MCP prompt with optional `focus` and `count` (1 to 5) arguments.
- A developer webhook can carry a bearer token, sent as `Authorization: Bearer`, stored with
  AES-256-GCM, never returned by any API (`has_bearer_token` instead). That is what a Grok Bot
  routine webhook trigger needs.
- The Grok Build plugin is [`integrations/grok/three-ws`](../../integrations/grok/three-ws/README.md):
  one MCP server, six skills, one command, no hooks, no scripts, no API key.

**Things to NOT claim:**

1. **No partnership, endorsement or listing by xAI.** We are a connector users add themselves. The
   xAI plugin marketplace PR is drafted in [`docs/partners/grok-bot-listings.md`](../partners/grok-bot-listings.md),
   not opened. Say "plugin", never "official plugin", until it merges.
2. **Do not say Grok "trades" or "finds alpha" with three.ws.** It reads. The brief prompt itself
   refuses to suggest a buy, a sell or a size.
3. **Do not say `@grok` on X can do this.** The `@grok` reply bot on X does not have our connector.
   Grok Bot (grok.com and the apps) does, once a user adds it. Do not reply to `@grok` threads asking
   it to make a 3D model; it will fail in public.
4. **Do not name or price any coin other than $THREE** in a post, and no performance figures.

---

## 1. Main post

276 characters with X's 23-character URL count (`three.ws` and `pump.fun` both autolink, so each costs 23).

> Grok Bot can now use everything we build, not just the 3D.
>
> One connector and Grok can:
> - turn a photo into a rigged 3D avatar
> - run your AI agents
> - read the Solana market: pump.fun graduations, top traders
>
> Read-only. It never trades.
>
> three.ws/grok

Why this one: it names the reframe (not just 3D) in the first line and spends the list on the three
things a Grok user can do today. "Read-only. It never trades." pre-empts the first objection anyone
in crypto replies with.

## 2. The scheduled brief (reply to post 1, or a day later)

268 characters with X's 23-character URL count (`three.ws` and `pump.fun` both autolink, so each costs 23).

> Schedule this in Grok Bot:
>
> "Every morning, run the market-brief prompt from three-ws-grok with 3 coins."
>
> Fresh token graduations, Oracle conviction, due diligence on the top 3, and who trades them well.
>
> It never buys, sells or picks a size.
>
> three.ws/grok

The quote is a complete Grok Bot schedule, copy-pasteable as written. It is the most likely post to
be tried, and a tried post is the one that gets quote-tweeted with a screenshot.

## 3. Routine triggers (developer audience)

268 characters with X's 23-character URL count (`three.ws` and `pump.fun` both autolink, so each costs 23).

> New: our events can wake your Grok Bot.
>
> Give a Grok routine a webhook trigger, paste its URL and key into your developer dashboard, and each finished generation or agent run starts the routine.
>
> The key is stored encrypted, never shown again.
>
> three.ws/docs/grok-bot

## 4. Grok Build plugin (after `git push`)

278 characters with X's 23-character URL count (`three.ws` and `pump.fun` both autolink, so each costs 23).

> Grok Build users: three.ws is a plugin now.
>
> Free text or photo to 3D, rigged avatars, auto-rigging, a CC0 asset catalog and 3D cutaways of machines. One MCP server, six skills, no hooks, no API key.
>
> Copy one folder into ~/.grok/plugins.
>
> three.ws/grok

Post this one after the plugin folder is public on GitHub. If the xAI marketplace PR has merged by
then, replace the last line before the link with "Install it from the Marketplace tab (/plugins)."
and recount.

---

## Getting the attention of xAI and Elon Musk

Nothing here guarantees an interaction, and a post that tags `@elonmusk` asking for one reads as
spam and lowers the odds. What raises them:

- **A video of Grok Bot doing something nobody has seen it do.** A 30-second screen recording of
  Grok Bot, on a schedule, posting a morning market brief, or turning a photo into a rigged avatar
  that then talks, is the asset. Elon reposts demos of Grok doing new things, not announcements
  about them. Attach it to post 1.
- **Be inside the xAI catalog.** A merged entry in xai-org/plugin-marketplace puts three.ws in front
  of the xAI team in review and in front of every Grok Build user who asks for 3D. It is also the
  only "listed by xAI" claim we could ever make honestly.
- **Tag `@xai` and `@grok` only where the post is about their product** (posts 1 and 4), never in
  replies to their threads.
- **Reply with substance.** When xAI posts about Grok Bot connectors or Grok Build plugins, a reply
  with the 30-second clip and the one-line ask outperforms any announcement of our own.
