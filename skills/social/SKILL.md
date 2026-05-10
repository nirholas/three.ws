---
name: social
description: Web3-native social media posting — X (Twitter), Farcaster, Reddit. Pay per post with USDC via x402. On-chain price correlation analytics.
triggers:
  - post_to_social
  - tweet
  - share_content
  - announce
  - social_media
  - farcaster_cast
  - schedule_post
cost: medium
---

# Agent Social

Post to social media platforms from within the agent context. Always call `social_platforms` first to discover what credentials each platform needs.

## Workflow

1. **Discover** — call `social_platforms` to see supported platforms and credential requirements
2. **Post** — call `social_post` with platform, content, and credentials
3. **Schedule** — pass `schedule_at` to `social_post` to defer delivery
4. **Track** — call `social_list` or `social_get` to check status
5. **Analyze** — call `social_analytics` for engagement metrics and Pump.fun price correlation

## Platforms

### X (Twitter)
- Content limit: 280 characters
- Supports: threads, media (up to 4 images/videos), replies
- Required credentials: `consumer_key`, `consumer_secret`, `access_token`, `access_secret`
- Get these at https://developer.twitter.com

### Farcaster / Warpcast
- Content limit: 1024 characters
- Supports: media embeds, channels, replies
- Required credentials: `neynar_key`, `signer_uuid`
- Get these at https://neynar.com (free tier available)
- Settings: `channel_id` (e.g. "dev"), `parent_url`

### Reddit
- Content limit: 40,000 characters
- Required credentials: `access_token` (OAuth 2.0 with submit scope)
- Required settings: `subreddit` (without r/), `title`
- Optional settings: `kind` ("self" for text post, "link" for URL post)

## Price Correlation

Call `social_analytics` with a Twitter post URL and a Pump.fun mint address to get the price impact of the post on the token — how much the price moved in the 30 minutes after posting.

## Scheduling

Pass `schedule_at` (ISO 8601 timestamp) to post in the future. Credentials are encrypted and stored server-side. The post runs automatically within 1 minute of the scheduled time.

## Rules

- Never post more than once to the same platform in the same turn unless the user explicitly requests it
- Verify credentials are available before attempting to post — check environment or ask the user
- For scheduled posts, confirm the schedule time with the user before submitting
- After posting, always return the post URL so the user can see it
