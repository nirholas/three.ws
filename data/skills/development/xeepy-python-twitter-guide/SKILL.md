---
name: xeepy-python-twitter-guide
description: Guide to xeepy — a comprehensive Python library for X (Twitter) with 154 files and 44K+ lines of code. Features full API v2 coverage, spaces, communities, lists, polls, Grok integration, and async support. 57 stars. The most complete Python X library.
license: MIT
metadata:
  category: development
  difficulty: intermediate
  author: nich
  tags: [development, xeepy-python-twitter-guide]
---

# xeepy — Python X/Twitter Library Guide

xeepy is the most comprehensive Python library for X (Twitter) with 154 files and 44,000+ lines of code. Full API v2 coverage, Spaces, Communities, async support, and Grok integration.

## Why xeepy?

| Feature | xeepy | tweepy | snscrape |
|---------|-------|--------|----------|
| API v2 | ✅ Full | Partial | ❌ |
| Spaces | ✅ | ❌ | ❌ |
| Communities | ✅ | ❌ | ❌ |
| Grok | ✅ | ❌ | ❌ |
| Polls | ✅ | Partial | ❌ |
| Lists | ✅ | Partial | ❌ |
| Async | ✅ | ❌ | ❌ |
| Scraping | ✅ | ❌ | ✅ |
| MCP Server | ✅ | ❌ | ❌ |

## Quick Start

```bash
pip install xeepy
```

```python
from xeepy import XClient

client = XClient(
    api_key='your-api-key',
    api_secret='your-api-secret',
    access_token='your-access-token',
    access_secret='your-access-secret'
)
```

## Tweets

### Post
```python
# Simple tweet
tweet = await client.tweet("Sperax USDs auto-yield is like free money 💰")

# With media
tweet = await client.tweet(
    "Check out this chart!",
    media=["chart.png"],
    alt_text="SPA price chart"
)

# Thread
await client.thread([
    "Understanding impermanent loss 🧵",
    "1/ IL happens when token prices in your LP change...",
    "2/ The greater the divergence, the more IL...",
    "3/ Fees can offset IL if the pool is active enough"
])

# Quote tweet
await client.quote(original_tweet_id, "This is huge for DeFi!")

# Reply
await client.reply(tweet_id, "Great point about USDs yield!")
```

### Search
```python
# Basic search
tweets = await client.search("sperax USDs", limit=100)

# Advanced search
tweets = await client.search(
    query="$SPA OR $USDs",
    start_time="2024-01-01T00:00:00Z",
    end_time="2024-12-31T23:59:59Z",
    tweet_fields=["public_metrics", "created_at", "author_id"],
    sort_order="relevancy",
    max_results=100
)

# Filtered stream
rules = [
    {"value": "sperax OR USDs OR SPA -is:retweet", "tag": "sperax"},
    {"value": "defi yield arbitrum -is:retweet", "tag": "defi"},
]
async for tweet in client.stream(rules):
    print(f"[{tweet.tag}] {tweet.text}")
```

## Spaces

```python
# Get live Spaces
spaces = await client.get_spaces(query="crypto defi")

# Get Space details
space = await client.get_space(space_id)
# { title, host, speakers, listeners, started_at, ... }

# Create a Space (requires host permissions)
space = await client.create_space(
    title="Sperax Community AMA",
    scheduled_start="2024-12-01T18:00:00Z"
)
```

## Communities

```python
# Get community info
community = await client.get_community(community_id)

# Get community tweets
tweets = await client.get_community_tweets(community_id, limit=50)

# Post to community
await client.community_tweet(community_id, "New farm pools are live! 🌾")
```

## User Management

```python
# Get user profile
user = await client.get_user("SperaxOfficial")
# { id, name, username, followers_count, following_count, ... }

# Get followers
followers = await client.get_followers("SperaxOfficial", limit=1000)

# Get following
following = await client.get_following("SperaxOfficial", limit=1000)

# Follow/unfollow
await client.follow(user_id)
await client.unfollow(user_id)
```

## Lists

```python
# Create a list
crypto_list = await client.create_list(
    name="Crypto DeFi Leaders",
    description="Top DeFi project accounts"
)

# Add members
await client.add_list_member(crypto_list.id, user_id)

# Get list tweets
tweets = await client.get_list_tweets(crypto_list.id, limit=50)
```

## Polls

```python
# Create a poll
await client.tweet(
    "What's your favorite DeFi strategy?",
    poll_options=["Yield Farming", "LP Provision", "Stablecoin Yield", "Staking"],
    poll_duration_minutes=1440  # 24 hours
)
```

## Analytics

```python
# Tweet metrics
metrics = await client.get_tweet_metrics(tweet_id)
# { impressions, likes, retweets, replies, quotes, url_clicks }

# Account analytics
analytics = await client.get_account_analytics(
    start="2024-01-01",
    end="2024-12-31",
    granularity="monthly"
)
```

## Async Support

```python
import asyncio
from xeepy import AsyncXClient

async def main():
    client = AsyncXClient(...)
    
    # Parallel requests
    tasks = [
        client.search("sperax"),
        client.get_user("SperaxOfficial"),
        client.get_trending()
    ]
    results = await asyncio.gather(*tasks)

asyncio.run(main())
```

## MCP Server

```json
{
  "mcpServers": {
    "x-social": {
      "command": "xeepy",
      "args": ["serve", "--mcp"],
      "env": {
        "X_API_KEY": "your-key",
        "X_API_SECRET": "your-secret"
      }
    }
  }
}
```

## Links

- GitHub: https://github.com/nirholas/xeepy
- PyPI: https://pypi.org/project/xeepy/
- X API v2 Docs: https://developer.x.com/en/docs/twitter-api
- Sperax: https://app.sperax.io
