---
name: agent-social
description: Web3-native social media posting for AI agents. Post to X (Twitter), Farcaster/Warpcast, and Reddit. Schedule posts, upload media, and correlate posts with on-chain token price movements. No subscription — pay per post with USDC via x402.
metadata:
  openclaw:
    requirements:
      env:
        - SOCIAL_X_CONSUMER_KEY
        - SOCIAL_X_CONSUMER_SECRET
        - SOCIAL_X_ACCESS_TOKEN
        - SOCIAL_X_ACCESS_SECRET
      optional_env:
        - SOCIAL_FC_NEYNAR_KEY
        - SOCIAL_FC_SIGNER_UUID
        - SOCIAL_REDDIT_ACCESS_TOKEN
---

# Agent Social

Social media posting API for AI agents. Works with Claude Code, OpenClaw, or any agent that can make HTTP requests.

**Better than Postiz:**
- Pay per post with USDC (x402) — no subscription required
- Farcaster / Warpcast support (web3-native)
- On-chain price correlation — see how your posts affect token prices
- Post-to-price analytics via Pump.fun integration
- Works natively with your agent's ERC-8004 identity

## Quick Start

```bash
# Discover platforms and credential requirements
curl https://three.ws/api/social/platforms

# Post immediately to X (Twitter)
curl -X POST https://three.ws/api/social/post \
  -H 'Content-Type: application/json' \
  -d '{
    "platform": "x",
    "content": "Hello from my AI agent!",
    "credentials": {
      "consumer_key": "$SOCIAL_X_CONSUMER_KEY",
      "consumer_secret": "$SOCIAL_X_CONSUMER_SECRET",
      "access_token": "$SOCIAL_X_ACCESS_TOKEN",
      "access_secret": "$SOCIAL_X_ACCESS_SECRET"
    }
  }'

# Post to Farcaster
curl -X POST https://three.ws/api/social/post \
  -H 'Content-Type: application/json' \
  -d '{
    "platform": "farcaster",
    "content": "gm from my onchain agent",
    "credentials": {
      "neynar_key": "$SOCIAL_FC_NEYNAR_KEY",
      "signer_uuid": "$SOCIAL_FC_SIGNER_UUID"
    },
    "settings": { "channel_id": "dev" }
  }'

# Schedule a post for tomorrow 9am UTC
curl -X POST https://three.ws/api/social/post \
  -H 'Content-Type: application/json' \
  -d '{
    "platform": "x",
    "content": "Scheduled announcement!",
    "schedule_at": "2026-05-11T09:00:00Z",
    "credentials": { ... }
  }'

# List scheduled posts
curl https://three.ws/api/social/list?status=scheduled

# Cancel a scheduled post
curl -X DELETE https://three.ws/api/social/abc-123

# Correlate a tweet with a token price
curl "https://three.ws/api/social/analytics?post_url=https://x.com/user/status/123&mint=TOKEN_MINT"
```

## API Reference

| Endpoint | Method | Description |
|---|---|---|
| `/api/social/platforms` | GET | List platforms, credentials, limits |
| `/api/social/post` | POST | Create/schedule a post |
| `/api/social/list` | GET | List posts (filter by status, platform) |
| `/api/social/:id` | GET | Get a single post |
| `/api/social/:id` | DELETE | Cancel a scheduled post |
| `/api/social/analytics` | GET | Post analytics + price correlation |
| `/api/social/upload` | POST | Upload media, get public URL |

## Platform Credentials

### X (Twitter)
```json
{
  "consumer_key": "from developer.twitter.com",
  "consumer_secret": "from developer.twitter.com",
  "access_token": "user-level OAuth 1.0a token",
  "access_secret": "user-level OAuth 1.0a secret"
}
```

### Farcaster
```json
{
  "neynar_key": "from neynar.com (free tier available)",
  "signer_uuid": "registered signer for your FID"
}
```

### Reddit
```json
{
  "access_token": "OAuth 2.0 user token with submit scope"
}
```
Settings also require: `{ "subreddit": "programming", "title": "Post Title" }`

## On-Chain Price Correlation

After posting about a token, call `/api/social/analytics` with the tweet URL and the Pump.fun mint address. The API returns how much the token price changed in a configurable time window around the post.

```json
{
  "type": "price_correlation",
  "deltaPct": 4.7,
  "deltaVolPct": 12.3,
  "summary": "Price up 4.70% in the 30-minute window after @user's post. Volume +12.30%."
}
```

## Scheduling

Posts scheduled via `schedule_at` are processed every minute by the platform cron. Credentials are encrypted with AES-256-GCM and cleared after publishing.

## Agent Identity

Pass `agent_id` in the post body to attribute posts to your ERC-8004 agent. Analytics can be filtered by agent.
