# three.ws marketing command center

This is the operating plan for the 90-day growth push beginning **2026-09-15**. It turns
the existing partner relationships, $THREE utility, community, product surface, and
finished campaign assets into a measured publishing and co-marketing system.

The strategy in one sentence:

> Put a working three.ws proof on a partner-owned surface, connect it to one real $THREE
> utility or community action, give the partner a small and explicit amplification ask,
> and turn the response into the next event, listing, or customer story.

This directory is the operational layer above the repo's deeper source material:

- [Channel and content audit](./channel-audit.md): where three.ws already publishes, what
  performed, and what can be pushed again.
- [Opportunity register](./opportunities.md): partner-by-partner asks, new relationship
  targets, official intake paths, and the big-brand engagement ladder.
- [GitHub and ecosystem growth surfaces](./github-growth-surfaces.md): the starter-template,
  Marketplace Action, curated-directory, adopter-story, and startup-program acquisition loops.
- [External directory submission kit](./submissions/README.md): verified listing copy,
  evidence, and dispatch instructions for the first two high-intent directories.
- [90-day campaigns](./campaigns.csv): one row per campaign, with channel, CTA, partner ask,
  KPI, date, and status.
- [Opportunity tracker](./opportunities.csv): the machine-readable pipeline. This is where
  a status or next action changes first.
- [Measurement](./measurement.md): the UTM convention, campaign scorecard, and weekly review.
- [Co-marketing templates](./templates.md): a one-page partner brief, social amplification
  request, event invitation, and post-campaign proof note.

The existing [partnership pipeline](../../docs/partners/opportunities.md) remains the source
of truth for the state of a listing or partner program. The existing
[publishing program](../../docs/publishing-program-2026-09.md) remains the source of truth
for long-form drafts. This command center sequences and measures both.

## What the evidence says

The best available quantitative baseline is the repository's
[@trythreews X analysis](../../docs/x-archive/trythreews-engagement.md), covering 158 usable
original posts from a 214-post archive through 2026-08-12:

| Signal                   | Median engagement | Lift over the 12-engagement corpus median |
| ------------------------ | ----------------: | ----------------------------------------: |
| Token / $THREE           |               160 |                                **13.33x** |
| Partner / ecosystem      |                76 |                                 **6.33x** |
| Mentions another account |                54 |                                 **4.50x** |
| Multi-paragraph          |                33 |                                 **2.75x** |
| Shipped / changelog      |                30 |                                 **2.50x** |
| Has an image             |                28 |                                 **2.33x** |
| Text only                |                11 |                                     0.88x |

The samples for token and partner subjects are small, so they are a direction, not a
forecast. The direction is nevertheless decisive: community response is strongest when
$THREE utility and a recognizable partner are attached to visible proof. The best post in
the corpus was the IBM in-world meetup announcement: 359 engagements and 41 replies.

The content supply is not the constraint. The
[announcement coverage ledger](../../docs/announcement-coverage.md) records at least **166
unannounced product surfaces** across its main product, build, labs, and agent-economy
sections. The repo also holds eleven unposted long-form drafts and multiple finished partner
campaign kits. The constraint is selection, dispatch, and follow-through.

## Ninety-day outcomes

By **2026-12-14**, the program aims to produce:

1. **Four partner amplifications**: a comment, repost, newsletter mention, or partner-authored
   post from four distinct partner or ecosystem accounts.
2. **Three new partner-owned listings**: priority order is IBM Agent Connect, the OpenAI
   directory/showcase surfaces, and Google Cloud's AI-agent discovery path. A marketplace
   listing counts; a three.ws-owned partner page does not.
3. **Three live community events**: one per month, beginning with the existing IBM Community
   user group. Each event gets an announcement, live moment, replay clip, and 24-hour recap.
4. **Twelve anchor campaigns**: one meaningful story each week, not a daily stream of
   disconnected feature announcements.
5. **Twelve $THREE utility proofs**: each demonstrates one shipped action and sends people to
   a place where they can use or verify it. No price prediction or guaranteed-return framing.
6. **A complete measurement loop**: every anchor link uses a campaign ID, every partner ask
   is logged, and every campaign receives a seven-day result row.

These are output and relationship targets for the first cycle. Conversion baselines are set
during the first four weeks; percentage-growth targets should only be added after that data
exists.

## The four audiences

| Audience                            | What they care about                                             | Message                                                                  | Primary action                                           |
| ----------------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------ | -------------------------------------------------------- |
| Community and $THREE holders        | Proof the platform keeps building and the token does useful work | “Here is the utility that shipped, and here is how to use or verify it.” | Try, hold-check, pay, unlock, attend, or share           |
| Open-source and AI builders         | Useful code, a live demo, and a tractable way to contribute      | “Give an agent a body on any page, then inspect the implementation.”     | Run demo, install, star, open an issue or PR             |
| Partner product and community teams | A credible story that makes their technology look useful         | “Here is a measured, visual implementation your audience can reproduce.” | Comment, repost, list, provide a speaker, or co-publish  |
| Enterprise buyers and integrators   | Governance, procurement, deployment, and a business outcome      | “Deploy an embodied agent through infrastructure you already trust.”     | Request demo, install from catalog, or begin procurement |

One post should not try to speak to all four. Every campaign row in
[`campaigns.csv`](./campaigns.csv) names its audience and one primary action.

## The campaign format

Every anchor campaign has five parts:

1. **Visible proof.** A 10 to 30 second clip, interactive page, partner-domain article, public
   receipt, benchmark, or source diff. Never lead with a logo wall.
2. **One claim.** One product outcome that the linked proof verifies.
3. **One partner.** Tag the team whose technology is genuinely used and tell their part of
   the story in their vocabulary.
4. **One $THREE action.** When relevant, show a shipped utility: access, discount, payment,
   marketplace use, event access, or transparent treasury data. Do not force the token into
   a technical venue whose rules exclude it.
5. **One ask.** For the audience, one CTA. For the partner, one request: comment, repost,
   listing, speaker, newsletter, or case-study introduction.

The content atomization pattern is:

```text
working proof
  -> partner-domain technical post
  -> 15-second social clip
  -> X anchor post + community discussion
  -> live event or office hours
  -> recap with metrics
  -> directory, showcase, or customer-story pitch
```

Reusing an idea is encouraged. Reposting the same body is not. Every version needs a new
opening, current proof, and a venue-native CTA.

## The three pillars

### 1. Partner proof before partner promotion

Big brands are most likely to engage with content they can safely stand behind. Publish the
implementation on their developer or community surface first, then ask the social team to
amplify that link. The partner-domain page is both proof and permission.

The first sequence is IBM Community, GitHub Open Source Friday, NVIDIA Developer Forums,
OpenAI Showcase, and AWS Builder Center. All have an existing relationship or accepted
route, and all have prepared material in the repo.

### 2. $THREE utility as a weekly product series

Run **“What $THREE does this week”** once a week. Each edition contains:

- a single live utility;
- a screen recording or verifiable public response;
- the exact action the user can take;
- the canonical contract address;
- a plain statement of what is live versus planned;
- no price target, urgency, or return language.

The first eight editions are hold-to-access tiers, plan discounts, marketplace settlement,
agent labor, token-gated embeds, on-chain agent deployment discounts, in-world purchases,
and x402 acceptance. The underlying claims are already audited in
[the $THREE thesis](../../docs/three-thesis.md).

### 3. The community becomes the stage

Run a monthly **Three World Session** inside `three.ws/play`. The event itself demonstrates
the product: attendees arrive as avatars, use spatial voice, and leave with a shareable
artifact or attendance souvenir.

The repeatable event package:

| Timing   | Action                                                                             |
| -------- | ---------------------------------------------------------------------------------- |
| T-21     | Confirm topic, date, guest, approval wording, and partner amplification commitment |
| T-14     | Publish partner/community event page and open registration                         |
| T-7      | Release the 20-second demo clip and community challenge                            |
| T-1      | Post one reminder with exact UTC and local times                                   |
| Live     | Demo first, guest discussion second, community showcase third, Q&A last            |
| T+1 day  | Publish the replay clip, metrics, links, and next date                             |
| T+7 days | Send the partner a concise proof note and ask for the next-level placement         |

Only IBM is a confirmed partner venue for the first event. Other companies may be invited
as speakers, but their names and logos do not appear as co-hosts until they approve that
wording.

## First 14 days

The execution order is deliberately narrow:

1. Book the approved [GitHub Open Source Friday issue #254](https://github.com/githubevents/open-source-friday/issues/254),
   then activate the existing announcement and stream plan.
2. Send one IBM relationship note covering the second event, the promised IBM-domain page,
   the promised social co-promotion, and Partner Plus marketing access. Send the Agent Connect
   `APP_ID` request separately to its program inbox.
3. Submit the prepared OpenAI Showcase packet and request that three.ws be made visible in the
   OpenAI Partner Locator if it is absent from the authenticated partner record.
4. Publish one finished NVIDIA technical post, then use the live NVIDIA-domain URL as the
   amplification asset. Continue the existing Inception email thread; do not start another.
5. Create the AWS Marketplace product. Once it is live, submit the launch assets for AWS
   review before posting; AWS explicitly says it may repost approved seller announcements.
6. Establish the measurement baseline using the campaign IDs and scorecard in
   [measurement.md](./measurement.md).
7. Open the installable-distribution wave: package the finished VS Code 3D extension,
   add official Registry metadata to the ComfyUI nodes, and complete Blender's required
   online-access compliance before its Extension submission.

## Weekly operating rhythm

| Day              | Work                                                                                |
| ---------------- | ----------------------------------------------------------------------------------- |
| Monday           | Reconcile opportunity statuses; choose one anchor story; send the partner brief     |
| Tuesday          | Capture proof and publish the partner/domain version                                |
| Wednesday        | Publish the X anchor and Telegram/community version; answer every substantive reply |
| Thursday         | Run a live demo, office hour, or build-in-public follow-up                          |
| Friday           | Publish the $THREE utility edition; prepare next week's partner asset               |
| Following Monday | Record seven-day outcomes, partner response, and the next earned placement          |

No campaign is “done” when the post is published. It is done when its seven-day result and
partner response are recorded.

## Editorial and brand guardrails

- Name the precise relationship. “Member of NVIDIA Inception,” “OpenAI Select Partner,” and
  “IBM Business Partner” are not interchangeable with endorsement.
- Use partner marks only under the applicable kit and approval rules. The existing
  [press kit](../../docs/press-kit.md) and partner campaign folders hold the approved assets.
- $THREE is marketed through shipped utility and verifiable economics, never a promised
  return. Distinguish live, enabled-but-off, and planned functionality.
- Use the canonical $THREE address everywhere:
  `FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump`.
- Do not describe a partner invitation as a co-host, listing, or partnership before the
  partner confirms it.
- Do not manufacture engagement. Ask the community to try, build, contribute, or attend;
  never ask for empty replies or coordinated spam.
- External publishing remains owner-gated. Drafting, scheduling, and preparing submissions
  in this repo does not authorize a post or form submission by itself.

## Source-of-truth map

| Question                                  | Source                                                                 |
| ----------------------------------------- | ---------------------------------------------------------------------- |
| What relationships may we claim?          | [Partner ecosystem](../../docs/partners.md)                            |
| What listing is blocked, and by whom?     | [Partnership pipeline](../../docs/partners/opportunities.md)           |
| What long-form content is ready?          | [Publishing program](../../docs/publishing-program-2026-09.md)         |
| What product pages were never announced?  | [Announcement coverage](../../docs/announcement-coverage.md)           |
| What has performed on X?                  | [X engagement analysis](../../docs/x-archive/trythreews-engagement.md) |
| What is published in the IBM group?       | [IBM Community catalog](../../docs/ibm-community.md)                   |
| What exists on Hugging Face?              | [Hugging Face index](../../docs/huggingface.md)                        |
| What can be claimed about $THREE utility? | [$THREE thesis](../../docs/three-thesis.md)                            |
| What is the Open Source Friday state?     | [Stream plan](../../docs/open-source-friday-plan.md)                   |

Last verified: **2026-09-15**.
