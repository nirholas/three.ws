# Announcement pack: the authorization spine, published by AWS

**Surface:** [the article on the AWS Builder Center](https://builder.aws.com/content/3JAVvvItd3ZSVjYCDb4qjj5VBb9/budgets-entitlements-and-the-dollarthree-token-layer-how-we-authorize-autonomous-agent-spending-or-threews-an-aws-partner)
· **Ledger key:** `aws-builder-center` · **Stage:** drafted
· **Published:** 2026-09-11 · **Announced externally:** never

Written against [the announcement voice](../announce-voice.md). The surface here is not a three.ws
route: it is a 34,000-character engineering article on Amazon's own builder platform, under the
three.ws byline, with `$THREE` in the headline. The repo copy is
[aws-builder-center-before-the-signature.md](../aws-builder-center-before-the-signature.md) and the
index of everything we have published there is [aws-builder-center.md](../aws-builder-center.md).

This is our third article on that platform and the second under our own byline. The news is not
that we wrote something. It is that the token layer is documented as engineering, on AWS, in a
piece an AWS builder can check line by line against open source.

---

## The claim, and where it is checked

> three.ws is a verified AWS Partner, the agent never holds a key, and both the authorization
> spine and the `$THREE` layer are now written up on Amazon's own builder platform.

| Part of the claim | Where it is real |
|---|---|
| Verified AWS Partner | Stated in the article's own status note and in the published title, which reads "three.ws an AWS Partner". The AWS Partner Network listing is the external check |
| Published on the AWS Builder Center | The live URL above, and the captured frame: AWS chrome, our byline, "Published Sep 11, 2026" |
| `$THREE` in the headline on an AWS property | On screen in the frame. The slug renders the `$` as `dollarthree`, which is the platform's own transform, not ours |
| The agent never holds a key | Section 3 splits custody, authority and execution: the platform's wallet signs, the agent holds a bounded session token, and section 5 enforces the budget as a predicate inside the `UPDATE` |
| The `$THREE` layer | Section 9: the five split policies in basis points, the no-platform-burns policy, the fail-closed treasury address, the buyback engine, and the holder pass |
| Second in the three.ws series | The series block in the frame reads "Series: three.ws (2 articles)" |

Do not claim the article documents a live `$THREE` revenue rail. The piece says plainly that the
fund-routing wallets are unset on the running service, so the strict lookup refuses rather than
paying an unset address, and `GET /api/token/config` reports `"treasury_configured": false` from
outside. The post does not touch that either way; a reply that does must keep it accurate.

## Media

Captured from the live page by `npm run announce:media`. Provenance (route, commit, time, sha256)
is in [`public/announce/media-manifest.json`](../../public/announce/media-manifest.json).

| Shot | File | Notes |
|---|---|---|
| `aws-builder-center-authorization-spine` | `/announce/img/aws-builder-center-authorization-spine.webp` | 1800x1013. AWS navigation, the headline carrying `$THREE`, and the three.ws byline in one frame. The proof is the chrome around the title, so do not crop it out. |

**Alt text, required on the post:**

> The article live on the AWS Builder Center under the three.ws byline, headlined "Budgets,
> entitlements, and the $THREE token layer: how we authorize autonomous agent spending", published
> 11 September 2026 as the second article in the three.ws series

## The post

[`aws-builder-center-authorization-spine.post.txt`](./aws-builder-center-authorization-spine.post.txt),
169 weighted characters, inside the archive's 3.0x band, verified with `node scripts/post-tweet.mjs --file <pack>.post.txt --dry-run`.

Two deliberate choices in the wording.

**The partner credential leads.** Being a verified AWS Partner is the part of this a reader cannot
get anywhere else, and it is checkable in the published title itself. It also earns the `@awscloud`
tag, which the archive measures at 4.5x, and which voice rule 4 only permits when the tag is true.

**The mechanism is stated sovereignty-positive, not custody-negative.** An earlier draft opened
"an agent with a private key is a liability", which is the article's own thesis and is correct
inside the piece. On a crypto-native timeline it reads as "custody bad, cloud good", next to an
`@awscloud` tag, to an audience that holds "not your keys" as a value. "The agent still never holds
a key" is the same engineering claim pointed the right way: the owner keeps custody, and what the
agent gets is a bounded grant. Nothing about the platform's design changed; only the sentence did.

`$THREE` is named in the body, which the archive measures at 13.3x median lift. One link, one
image, no hashtags, no emoji.

**What the post does not say, and must not.** It does not claim the budget rail runs on AWS. It
does not run on AWS: enforcement is Postgres, settlement is USDC on Solana through our own
facilitator, and AWS is one procurement front door plus the venue that published the write-up. A
reply that blurs that is worse than no reply.

## Alternate, if a token-forward lead is wanted instead

> $THREE split policies are leg-lists in basis points, and one that does not sum to 10,000 throws
> before it can mis-pay. The authorization spine, on @awscloud: <url>

181 weighted characters. It leads with `$THREE` and a mechanism, which is the higher-lift shape on
paper, at the cost of narrowing a broad article to one of its sections. Pick one; do not post both.

## Follow-ups this unlocks

Two sections were cut from the article for the platform's 40,000-character limit, and both are
whole in [aws-builder-center-agent-commerce-spine.md](../aws-builder-center-agent-commerce-spine.md):
the agent-vitals readiness check, and the fabrication gate that stands between a prompt and a
manufactured object. Each is its own article and its own announcement beat. Do not spend them here.
