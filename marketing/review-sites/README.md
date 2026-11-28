# Software review sites: listing and review kit

Everything needed to list three.ws on G2, Capterra, GetApp, Software Advice, Trustpilot and
SourceForge, and to start collecting reviews without breaking any site's rules. These pages rank
in search, and AI assistants cite them when someone asks for a software recommendation, so an
empty or missing profile is a gap in discovery.

**Status (2026-11-28): nothing is submitted.** No three.ws profile exists on any of the six sites
yet. Every step below that creates an account, claims a profile or contacts customers is the
owner's (it publishes under the company's name). Everything else is done: the copy, the
screenshots, the intake paths, and the rules.

## Why four sites are one job now

G2 announced on 2026-01-29 that it is acquiring Capterra, Software Advice and GetApp from Gartner
([G2 news](https://company.g2.com/news/g2-acquires-capterra-software-advice-getapp)), and a G2
release dated 2026-11-10 says the deal is complete, with vendors managing listings, review
collection and badges for all four sites in one platform. G2's
[community guidelines](https://legal.g2.com/community-guidelines) say a review submitted through
that flow counts toward the rating on every marketplace where the product is listed. G2 picks the
one marketplace that shows the full text, and the vendor cannot choose it. One profile and one
review request now cover four sites.

The old Gartner vendor hostnames (`digital-markets.gartner.com`, `vendors.capterra.com`) did not
resolve on 2026-11-28, and Capterra's listing-guideline pages returned 403 to automated fetches,
so the G2 path below is the verified one. If G2 does not create the Capterra, GetApp and Software
Advice profiles on its own after the G2 profile is claimed, ask the G2 rep who makes contact
during claiming.

## Order of operations (owner)

1. **G2 (covers Capterra, GetApp, Software Advice).** Open
   [sell.g2.com/create-a-profile](https://sell.g2.com/create-a-profile) and sign in with a
   `@three.ws` business email. Submit the product using the [shared profile](#shared-profile)
   below. G2 research verifies it and assigns a category in about 3 to 5 business days. Claiming
   takes another 1 to 3 business days. Claiming is free.
2. **Trustpilot.** Create the free business account at
   [business.trustpilot.com](https://business.trustpilot.com/) for the domain `three.ws` and
   confirm the domain. The free plan gives one user, a claimed profile and 50 review invitations a
   month ([pricing](https://business.trustpilot.com/pricing)). That is enough to start. Do not buy
   a paid plan before 50 a month is the bottleneck.
3. **SourceForge (business software directory).** Search
   [sourceforge.net/software](https://sourceforge.net/software/) for an existing three.ws page and
   claim it if one exists. Otherwise submit at
   [sourceforge.net/software/vendors/new](https://sourceforge.net/software/vendors/new). This is
   the commercial directory, separate from open-source project hosting. New pages sit on a review
   waitlist that has taken more than four weeks for some submitters
   ([support ticket](https://sourceforge.net/p/forge/site-support/27566/)), so submit early. The
   form asks for a founding date and a location: fill them in from the company records, because
   the repo does not record either.
4. **Collect reviews.** Once a profile is live, follow [the review playbook](#review-playbook).
5. **Record each live URL** in [docs/listings.md](../../docs/listings.md) under a new "Software
   review sites" section the day it goes live. A submission is not a listing. Only a public
   profile URL counts.

## Shared profile

Paste the same facts everywhere so every site agrees. Live numbers come from
`curl -s https://three.ws/api/home-stats` and were read on 2026-11-28. Re-read them on the day you
submit.

**Product name:** three.ws

**Company:** three.ws LLC

**Website:** https://three.ws

**Support contact:** support@three.ws (security reports: security@three.ws)

**Logo:** square 1024x1024 [`public/brand/three-ws-app-icon-1024.png`](../../public/brand/three-ws-app-icon-1024.png),
512x512 [`public/brand/three-ws-app-icon-512.png`](../../public/brand/three-ws-app-icon-512.png).
Wide lockups: [`three-ws-lockup-on-dark.png`](../../public/brand/three-ws-lockup-on-dark.png),
[`three-ws-lockup-on-light.png`](../../public/brand/three-ws-lockup-on-light.png).

**Tagline (under 60 characters):**

> Give your AI a body: 3D AI agents for any website.

**Short description (about 160 characters):**

> three.ws turns a text prompt, photo or sketch into a textured 3D model or a rigged avatar, then
> gives it an AI brain and voice and embeds it on any website.

**Long description (about 1,100 characters):**

> three.ws is an open-source (Apache-2.0), browser-native platform for building 3D AI agents.
> Type a prompt in Forge and get a textured, downloadable 3D model (GLB) in a few minutes, or start
> from a photo or a sketch. Avatar Studio builds rigged, animation-ready characters with a full
> skeleton and facial blendshapes. Give the avatar a persona, an LLM brain, a voice with lip-sync
> and its own skills, then put it on any website with one script tag: no plugins, no installs.
>
> Generation runs on a self-hosted GPU fleet on Google Cloud. Phones can place any model in the
> room through AR with one tap. Developers get an MCP server that brings free text-to-3D and rigged
> avatars into Claude Code, Claude Desktop, Cursor, VS Code, Codex and Gemini CLI, plus open npm
> SDKs and a REST API. Teams can buy through Microsoft Marketplace or by invoice, with SSO, SCIM and
> a procurement packet on the enterprise page.
>
> More than 56,000 3D models have been generated on three.ws, and the free tier needs only a free
> account.

**Pricing (from [three.ws/pricing](https://three.ws/pricing)):**

- Free: $0, no credit card. 1 agent and 1 custom avatar, unlimited embeds, 200 animation clips,
  voice chat and lip-sync, community support.
- Pro: $49 per month, or $480 per year billed annually. Unlimited agents and avatars, voice
  cloning, animation studio, custom subdomain embed, priority GPU rendering, analytics, priority
  email support.
- Enterprise: custom pricing. Self-hosted runtime option, white-label embed and API, SSO, audit
  logs, dedicated infrastructure. Contact via [three.ws/enterprise](https://three.ws/enterprise).
- Free trial: the Free plan is free forever. There is no time-limited trial of Pro.

**Deployment:** cloud (SaaS), web browser on desktop and mobile. Self-hosted runtime on Enterprise.
The source is public at https://github.com/nirholas/three.ws.

**Categories to request.** G2 assigns the category after its research review, so ask for these
and pick the closest match from each site's list:

1. 3D modeling or 3D design software (Forge, text-to-3D and image-to-3D)
2. AI avatar or digital human software (Avatar Studio, talking embeds)
3. AI agent builder software (Agent Studio, MCP server, SDKs)

**Features to tick where a site offers a feature checklist:** text-to-3D, image-to-3D,
sketch-to-3D, auto-rigging, animation library, AR preview, voice and lip-sync, website embed, REST
API, MCP server, SSO, open source.

**Integrations to list:** Claude Code, Claude Desktop, Cursor, VS Code, OpenAI Codex, Gemini CLI,
Microsoft Marketplace, Google Cloud.

**Public links:** Docs https://three.ws/docs, changelog https://three.ws/changelog, X
https://x.com/trythreews, GitHub https://github.com/nirholas/three.ws.

## Screenshots

Six 1920x1080 PNGs captured from production on 2026-11-28 by
`node scripts/capture-review-site-media.mjs`. Upload them in this order (the first is the one
category pages show) and paste the caption with each. Provenance (route, commit, sha256, and the
defect and token checks, all clean) is in [`screenshots/manifest.json`](screenshots/manifest.json).
Re-run the script before submitting if the UI has changed since.

1. [`home-1920x1080.png`](screenshots/home-1920x1080.png): three.ws: open-source,
   browser-native 3D AI agents you can embed anywhere.
2. [`forge-1920x1080.png`](screenshots/forge-1920x1080.png): Forge: type a prompt or drop an
   image and get a textured, downloadable 3D model (GLB).
3. [`avatar-studio-1920x1080.png`](screenshots/avatar-studio-1920x1080.png): Avatar Studio:
   design a rigged, animation-ready 3D avatar in the browser.
4. [`discover-1920x1080.png`](screenshots/discover-1920x1080.png): Discover: search and load
   published 3D agents in the browser.
5. [`ar-1920x1080.png`](screenshots/ar-1920x1080.png): AR: place any generated model in the
   room with one tap on a phone.
6. [`enterprise-1920x1080.png`](screenshots/enterprise-1920x1080.png): Enterprise: SSO, audit
   logs, procurement packet, and marketplace purchasing.

The Agent Studio and Showcase routes were tried and left out: Agent Studio shows only a sign-in
prompt to a logged-out browser, and Showcase leads with chain tickers and placeholder tiles,
which is the wrong first impression for a software buyer.

## Review playbook

Reviews are what make these pages rank and get cited. An empty profile is close to no profile at
all. The rules differ by site, and breaking them gets reviews removed and profiles flagged, so the
process below follows the strictest common rules.

### Who to ask

Real users with real usage, all of them, the same way:

- Every account that has generated at least one model or published an agent in the last 90 days.
- Pro subscribers and Microsoft Marketplace or invoice customers.
- Developers who connected the MCP server (they show up as API-key or OAuth accounts).
- Partners and integrators who have built on three.ws.

Never ask employees, contractors or family to review. Review sites remove vendor-affiliated
reviews.

### Rules that apply everywhere

- **Invite everyone, not just happy users.** Trustpilot bans pre-screening and sending satisfied
  customers to review while routing unhappy ones to support
  ([Trustpilot guidelines](https://corporate.trustpilot.com/legal/for-businesses/guidelines-for-businesses)).
  G2 bans filtering out negative feedback. Send the same invitation at the same point in the
  journey to every eligible account, whatever their experience was.
- **Ask for an honest review, never a positive one.** Do not suggest a star rating or wording.
- **No incentives on Trustpilot.** No discounts, credits, prize draws or freebies tied to a
  review.
- **G2 incentives are optional and capped.** G2 allows an incentive of up to $100 USD per review.
  It must not depend on the review being positive, it must be disclosed to G2, and G2 labels the
  review as incentivized. Do not offer one until the owner decides on a budget.
- **Do not post review-collection links publicly.** G2 wants collection pages shared only in
  closed channels (email, in-app, direct message), not on X or in a public Telegram channel.
- **Do not write reviews for people.** G2 asks for authentic, first-hand reviews and does not want
  AI-written text. Offer the reviewer a list of what they used, never draft text.

### Getting the direct link

- **G2:** after claiming, the review-generation tools in the G2 vendor account
  ([sell.g2.com/review-generation](https://sell.g2.com/review-generation)) give a shareable
  "write a review" link. One link feeds all four G2-owned sites.
- **Trustpilot:** the business account's invitation tools give a shareable review link and a QR
  code, and send email invitations (50 a month on the free plan).
- **SourceForge:** use the "Write a review" link on the live product page once it is approved.

### Invitation email (send to every eligible account)

Subject: How has three.ws been for you?

> Hi {first name},
>
> You have been using three.ws{, most recently {what they did, e.g. "forging 3D models"}}. We are
> a small team, and an honest review on {G2 | Trustpilot} helps other builders decide whether
> three.ws fits their work. Good or bad, we want to hear it.
>
> It takes about five minutes: {direct review link}
>
> If something is broken or missing, reply to this email too. It comes straight to us.
>
> Thank you,
> The three.ws team

Send G2 and Trustpilot requests as separate emails a few weeks apart, never both links in one
email. Each site gets its own invitation.

### After a support conversation

When a support thread closes, send the same short note to every customer whose ticket is resolved,
not only the ones who were pleased:

> Thanks for working through this with us. If you have a few minutes, an honest review of three.ws
> helps other builders: {direct review link}

### Cadence

- Week 1 after a profile goes live: send the invitation email to every eligible account.
- One reminder 7 days later to anyone who has not opened it. Never more than one reminder.
- Then monthly: invite accounts that crossed the eligibility line in the last 30 days.
- Reply publicly to every review, positive or negative, within a few days. On negative reviews,
  say what was fixed and link the changelog entry.
- Keep each profile current: update the description, screenshots and pricing whenever
  [three.ws/pricing](https://three.ws/pricing) or the main surfaces change.

## Eligibility risks to know before submitting

- G2 can refuse products that create fake or synthetic identities or impersonate brands. three.ws
  makes avatars for the user's own agents, not identities that pass as real people. If a G2
  researcher asks, describe it that way: 3D avatars and characters, not synthetic personas.
- Trustpilot can remove businesses that "may cause or create harm". The profile copy above leads
  with 3D generation and agents, the product a software buyer is evaluating.
- On-chain features are real but optional ("Do I need crypto to use three.ws? No." on the pricing
  page). The review-site copy does not lead with them.

## Sources checked on 2026-11-28

- G2 profile intake: https://sell.g2.com/create-a-profile
- G2 community guidelines (syndication, incentives, solicitation): https://legal.g2.com/community-guidelines
- G2 review generation: https://sell.g2.com/review-generation
- G2 acquisition announcement: https://company.g2.com/news/g2-acquires-capterra-software-advice-getapp
- Trustpilot business sign-up and pricing: https://business.trustpilot.com/, https://business.trustpilot.com/pricing
- Trustpilot guidelines for businesses: https://corporate.trustpilot.com/legal/for-businesses/guidelines-for-businesses
- SourceForge vendor intake: https://sourceforge.net/software/vendors/new
- Not loadable on that date: Capterra vendor FAQ, listing guidelines and community guidelines
  (403), Software Advice listing guidelines (403), `digital-markets.gartner.com` and
  `vendors.capterra.com` (did not resolve).
