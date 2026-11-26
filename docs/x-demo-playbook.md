# How the best Grok Bot demos are posted, and what three.ws should copy

Research note, 2026-11-26. It studies @poteto (Lauren, on the Grok @bot team at xAI, 340k followers), named by the owner as the account that posts the best demos. Source: her latest 100 original posts (2026-10-18 to 2026-11-25), pulled from the X API with [scripts/x-user-timeline.mjs](../scripts/x-user-timeline.mjs), plus the full text of her article "Automate Anything with Grok Bot". Companion to [x-timeline-ideas.md](x-timeline-ideas.md) and [grok-showcase-and-tools.md](grok-showcase-and-tools.md).

Re-pull at any time: `GCP_PROJECT=three-ws node scripts/x-user-timeline.mjs poteto --max 3200` (about 355 paid reads at $0.005, under $2). Raw output lands in `data/x-research/`, which is gitignored.

## What the numbers say

Median post: 181k impressions. Her top posts, by impressions:

1. **AIE conference talk link**, "how the grok @bot team ships so quickly": 3.39M impressions, 9.9k bookmarks.
2. **X Article, "Automate Anything with Grok Bot"**: 3.13M impressions, **33.7k bookmarks**, the most saved post in the set by far.
3. **"Day 28/ tibo's game has landed"**, a browser game built in four days: 2.27M impressions.
4. A hot take on agent code review: 1.46M.
5. **A bullet-list guide to building bots**, ending "ask @bot to read this post and help you improve your team!": 1.38M impressions, 19.6k bookmarks.
6. **"Sharing my bot tibot today"**, a ready-to-install bot template: 1.02M.

By format, photo posts (median 226k) and plain text (206k) beat video (162k, only 4 posts) and quote or link posts (163k) in that window. **Shipped things, guides people save, and installable templates carry her account.**

### Most engaged, all time

A second pull ranks by engagement (likes, reposts, replies, quotes and bookmarks) across 452 posts: every original post since 2026-08-23 from the timeline API (its 3,200-post window counts replies and reposts, so it reaches back no further), plus her all-time top posts from the syndication feed with metrics refreshed through `GET /2/tweets`. The median post earns 1.2k engagements. The top seven:

1. **A native 38 minute video talk**, "here's how i shipped 2,500 PRs last month to production" (2026-09-21): 64k engagements, 4.7M impressions, 38k bookmarks. It was a conference talk she could not attend, so she uploaded it to X for free with "watch it on 2x speed".
2. **X Article "Automate Anything with Grok Bot"** (2026-11-18): 56k.
3. **The bullet guide to building bots**, "ask @bot to read this post" (2026-10-31): 34k.
4. **X Article "A guide to pstack, part one"** (2026-08-31): 29k, with 19k bookmarks.
5. **One prompt, quoted** (2026-09-29): "restate in your own words what you think my goals are and what the problem i'm trying to solve is". 27k engagements from a single sentence.
6. **The AIE talk link** (2026-11-14): 23k.
7. **"copy this post/link and give it to your @bot or agent!"**, a four-point checklist with a diagram (2026-10-16): 21k.

What the format medians say:
- **Articles**: 5 posts, median 18.6k engagements, 15 times her typical post.
- **Posts written for a bot to run** ("give it to your @bot", "ask @bot to read this"): 4 posts, median 21.5k, the strongest format she has.
- **Short clips**: 14 videos, median 1.35k, about the same as any post. One long native video, a full talk with real substance, is her single best post. Native long-form video works; short clips do not stand out.

## The patterns

1. **Ship a real thing, then post the thing.** tibo.dog is a playable game, not a clip of one. The launch post is three lines and a link. A follow-up "trivia" post gives the proof (about 1,150 PRs in four days, a lint rule written for every bug found, TLA+ used for the state machines) and drew 557k impressions on its own.
2. **Countdown before the drop.** "i bought a new domain too" (a GIF, 898k impressions) and "day 28" teased the game days before it landed, so the launch arrived to an audience already waiting.
3. **Posts that run.** Her guides end with "ask @bot to read this post and guide you through it". The post is the documentation and the bot is the installer. That is why her guides get 20k to 34k bookmarks.
4. **Installable artifacts over descriptions.** "hire tibot today", "Dr Eggbot v2 bot template", and "pstack" (a Grok Bot plugin at x.ai/bot/plugin/9717366, auto-updated for users). Every claim comes with something the reader can install in one tap.
5. **Long form as an X Article, not a blog link.** Her biggest guide stays on X, so it is not taxed as an outbound link and readers save it in place.
6. **The making-of is a second post.** "i asked grok bot to make a video about how the music was made" (162k) turned the game's audio into another post. The agent produced a storyboard and animatic before the full video.
7. **The game plays inside X.** tibo.dog serves `twitter:card=player` with the page itself as the player (480x480), plus an `og:video` MP4 and a static `card.jpg` as fallbacks. She wrote "if i did it right you should be able to play it inside of X too". Whether a player card renders for a domain outside X's allowlist is still unverified.
8. **A weekly prompt to the audience.** "what did you get done with grok @bot last week?" reached 699k with no media at all. Asking users what they built is a free engagement loop.
9. **Teaching the vocabulary.** Her favourite technique: tell the bot "i lack the vocabulary to describe what i want", and have it restate the request "in your own words" before doing anything. She packages these as skills (/sharpen, /reframe, /in-your-own-words).

## What three.ws does with this

Each item names the existing surface it builds on. Posting from our accounts stays owner-gated.

1. **A three.ws plugin for Grok Bot.** pstack proves plugins ship to Grok Bot users at x.ai/bot/plugin/<id> and auto-update. Package our free studio MCP (text to 3D, avatar, rig, pose) and the anatomy skill as one plugin. "@bot make me a 3D avatar of my dog" then works inside Grok Bot for every user. This is the highest-leverage item on the page: it puts us where her 340k followers already are. Builds on the hosted MCP servers and [connect-three-ws-mcp](../.agents/skills/connect-three-ws-mcp/SKILL.md).
2. **Guides that run.** Write one X Article per capability ("Give your Grok Bot a 3D body", "Explain any machine as a 3D cutaway") that ends with "ask @bot to read this and set it up for you". Every step in it calls a real three.ws endpoint or MCP tool, so the bot can actually do it.
3. **A playable launch, with a countdown.** Take one flagship demo from the showcase doc (Zoom to the atom, or Guess the Machine), tease it daily for a week with clips, then launch a link that plays. Our forge share and agent pages already carry the player card tags behind `X_PLAYER_CARD_APPROVED`. Match her fallbacks (an `og:video` loop and a static card image), so the link still sells when the player does not render.
4. **The proof post.** After each launch, post the build receipts the way her trivia post does: how many forge runs, which Grok steps, what the render-check loop caught. We already record that data (forge job stats, the x-content reel of filmed proof runs in `api/_lib/x-content/reel.js`).
5. **Templates, not features.** Ship installable bot templates for Grok Bot users: an "avatar agent" (a persona plus a three.ws body plus voice), and a "3D product shot bot" for small shops. Each gets its own one-tap post, like tibot.
6. **A weekly "what did you make" post** from @trythreews, quoting the best user creations with their rendered clip. It costs no rendering, and the replies supply next week's content.
7. **One long native talk.** Record a 20 to 40 minute "how we built three.ws with agents" walkthrough (the forge pipeline, the render-check loop, the Grok steps) and upload it to X natively, not as a YouTube link. Her best post ever is exactly this.
8. **Making-of clips through engine 1.** Every big creation gets a second post: the turntable, the cutaway tour, or the storyboard. That is the scene-to-clip engine from the showcase doc, and it costs nothing beyond the render.

## Not worth copying

- The personal and confrontational posts (blocking trolls, "mogging"). They travel on her personality, not on the product.
- Short clips as the main format. Her data says shipped artifacts, saved guides and one long native talk beat clips. Our video replies (idea 1 in x-timeline-ideas.md) still matter for the mention bot, where a summoned reply with media is the cheapest post X sells. For launches, lead with the playable link, and for depth, upload the whole talk natively.
