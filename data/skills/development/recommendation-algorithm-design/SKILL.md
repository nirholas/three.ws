---
name: recommendation-algorithm-design
description: Complete mastery guide for designing social media recommendation algorithms — understanding candidate generation, ranking models, engagement prediction, content graph modeling, collaborative filtering, embedding spaces, real-time personalization, exploration vs exploitation tradeoffs, feedback loops, filter bubble mitigation, and building recommendation systems from scratch. Based on analysis of production systems like Twitter/X's open-source algorithm, with applications to crypto community feeds and DeFi content curation.
license: MIT
metadata:
  category: development
  difficulty: advanced
  author: nich
  tags: [development, recommendation-algorithm-design]
---

# Recommendation Algorithm Design — From First Principles

This skill teaches you to build recommendation systems that surface the right content to the right person at the right time. You'll learn the full pipeline — from candidate generation to final ranking — and understand why feeds feel the way they do.

## The Recommendation Pipeline

Every major social platform follows the same high-level architecture:

```
┌─────────────────────────────────────────────────────────────┐
│              THE RECOMMENDATION PIPELINE                     │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ALL CONTENT (millions)                                      │
│       │                                                      │
│       ▼                                                      │
│  ┌─────────────┐                                             │
│  │  CANDIDATE   │  Filter: ~10,000 posts worth considering   │
│  │  GENERATION  │  (follows, topics, graph neighbors)        │
│  └──────┬──────┘                                             │
│         │                                                    │
│         ▼                                                    │
│  ┌─────────────┐                                             │
│  │   RANKING    │  Score each candidate: P(engagement)       │
│  │   MODEL      │  (neural network, 100+ features)           │
│  └──────┬──────┘                                             │
│         │                                                    │
│         ▼                                                    │
│  ┌─────────────┐                                             │
│  │  FILTERING   │  Remove: spam, duplicates, policy          │
│  │  & MIXING    │  Inject: diversity, exploration, ads       │
│  └──────┬──────┘                                             │
│         │                                                    │
│         ▼                                                    │
│  FINAL FEED (~50 posts for this session)                     │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

## Stage 1: Candidate Generation

The universe of content is too large to score every item. Candidate generation narrows millions of posts to thousands worth evaluating.

### Sources of Candidates

| Source | What It Catches | Latency |
|--------|----------------|---------|
| **In-Network** | Posts from people you follow | Low |
| **Social Graph** | Posts liked by people you follow | Medium |
| **Topic Graph** | Posts in topics you engage with | Medium |
| **Embedding Similarity** | Posts similar to your past engagement | High |
| **Trending** | High-velocity posts across the platform | Low |
| **Exploration** | Random high-quality posts (serendipity) | Low |

### Two-Tower Retrieval Model

The standard architecture for large-scale candidate generation:

```
┌──────────────────┐    ┌──────────────────┐
│   USER TOWER     │    │   ITEM TOWER     │
├──────────────────┤    ├──────────────────┤
│                  │    │                  │
│ User features:   │    │ Post features:   │
│ - Follow graph   │    │ - Text embedding │
│ - Past likes     │    │ - Author stats   │
│ - Topic prefs    │    │ - Engagement rate│
│ - Demographics   │    │ - Recency        │
│ - Activity time  │    │ - Media type     │
│                  │    │                  │
│    ┌─────┐       │    │    ┌─────┐       │
│    │ MLP │       │    │    │ MLP │       │
│    └──┬──┘       │    │    └──┬──┘       │
│       │          │    │       │          │
│    ┌──▼──┐       │    │    ┌──▼──┐       │
│    │128-d│       │    │    │128-d│       │
│    │embed│       │    │    │embed│       │
│    └──┬──┘       │    │    └──┬──┘       │
└───────┼──────────┘    └───────┼──────────┘
        │                       │
        └───────┐   ┌──────────┘
                │   │
            cosine_sim(u, i) → relevance score
```

```python
class TwoTowerModel(nn.Module):
    """Dual encoder for user-item matching."""

    def __init__(self, user_dim, item_dim, embed_dim=128):
        super().__init__()
        self.user_tower = nn.Sequential(
            nn.Linear(user_dim, 512),
            nn.ReLU(),
            nn.Linear(512, 256),
            nn.ReLU(),
            nn.Linear(256, embed_dim),
            nn.LayerNorm(embed_dim)
        )
        self.item_tower = nn.Sequential(
            nn.Linear(item_dim, 512),
            nn.ReLU(),
            nn.Linear(512, 256),
            nn.ReLU(),
            nn.Linear(256, embed_dim),
            nn.LayerNorm(embed_dim)
        )

    def forward(self, user_features, item_features):
        user_embed = self.user_tower(user_features)
        item_embed = self.item_tower(item_features)
        # Cosine similarity as relevance score
        score = F.cosine_similarity(user_embed, item_embed)
        return score
```

#### Approximate Nearest Neighbor (ANN) for Speed

You can't compute similarity against every post in real-time. Use ANN indices:

```python
import faiss

# Offline: index all post embeddings
post_embeddings = model.item_tower(all_posts)  # [N, 128]
index = faiss.IndexIVFFlat(
    faiss.IndexFlatIP(128),  # Inner product similarity
    128,                      # Dimension
    1024                      # Number of clusters
)
index.train(post_embeddings)
index.add(post_embeddings)

# Online: find 1000 nearest candidates for a user
user_embed = model.user_tower(user_features)  # [1, 128]
distances, indices = index.search(user_embed, k=1000)
candidates = [all_posts[i] for i in indices[0]]
```

## Stage 2: Ranking

### Feature Engineering

The ranking model sees rich features for each (user, post) pair:

```python
def extract_features(user, post):
    """Generate feature vector for ranking model."""
    return {
        # Author features
        "author_followers": post.author.follower_count,
        "author_verified": post.author.is_verified,
        "author_age_days": post.author.account_age_days,
        "user_follows_author": user.follows(post.author),
        "user_interacted_author_7d": user.interactions_with(post.author, days=7),

        # Content features
        "post_length": len(post.text),
        "has_image": post.has_image,
        "has_video": post.has_video,
        "has_link": post.has_link,
        "language_match": post.language == user.language,
        "topic_embedding": post.topic_vector,

        # Engagement signals (social proof)
        "likes_count": post.likes,
        "retweets_count": post.retweets,
        "replies_count": post.replies,
        "engagement_rate": (post.likes + post.retweets) / max(post.impressions, 1),
        "engagement_velocity": post.likes_per_minute,

        # Temporal features
        "post_age_minutes": (now() - post.created_at).total_seconds() / 60,
        "user_active_time_match": abs(user.typical_active_hour - now().hour),

        # Graph features
        "mutual_followers_engaged": count_mutual_followers_who_liked(user, post),
        "cluster_overlap": jaccard(user.interest_clusters, post.topic_clusters),

        # Historical interaction pattern
        "user_like_rate_this_topic": user.like_rate_for_topic(post.topic),
        "user_avg_session_duration": user.avg_session_minutes,
    }
```

### Multi-Objective Ranking

Real feeds optimize for multiple engagement types simultaneously:

```python
class MultiObjectiveRanker(nn.Module):
    """Predict probability of each engagement type."""

    def __init__(self, feature_dim):
        super().__init__()
        self.shared = nn.Sequential(
            nn.Linear(feature_dim, 1024),
            nn.ReLU(),
            nn.Dropout(0.2),
            nn.Linear(1024, 512),
            nn.ReLU(),
        )
        # Separate heads for each engagement type
        self.like_head = nn.Linear(512, 1)
        self.retweet_head = nn.Linear(512, 1)
        self.reply_head = nn.Linear(512, 1)
        self.click_head = nn.Linear(512, 1)
        self.dwell_head = nn.Linear(512, 1)  # Time spent reading
        self.negative_head = nn.Linear(512, 1)  # Report/hide

    def forward(self, features):
        shared = self.shared(features)
        return {
            "p_like": torch.sigmoid(self.like_head(shared)),
            "p_retweet": torch.sigmoid(self.retweet_head(shared)),
            "p_reply": torch.sigmoid(self.reply_head(shared)),
            "p_click": torch.sigmoid(self.click_head(shared)),
            "p_dwell": torch.sigmoid(self.dwell_head(shared)),
            "p_negative": torch.sigmoid(self.negative_head(shared)),
        }

def final_score(predictions):
    """Weighted combination of objectives."""
    return (
        predictions["p_like"] * 0.5 +
        predictions["p_retweet"] * 2.0 +    # Retweets valued 4× likes
        predictions["p_reply"] * 1.0 +
        predictions["p_click"] * 0.1 +       # Clicks alone = clickbait
        predictions["p_dwell"] * 1.5 +       # Dwell time = quality signal
        predictions["p_negative"] * -10.0     # Heavy penalty for reports
    )
```

### The X/Twitter Algorithm (Open-Sourced)

Twitter made their algorithm public. Key insights:

```
Twitter's Ranking Formula (Simplified):
──────────────────────────────────────

Score = (
    P(like)     × 0.5  +
    P(retweet)  × 1.0  +
    P(reply)    × 13.5 +    ← Replies weighted HEAVILY
    P(bookmark) × ???   +   ← New signal, weight growing
    P(profile_click) × 12 + ← Strong intent signal
    P(negative) × -74.0     ← Reports are devastating
)

Key Insights:
- In-network (follows) get ~50% of feed
- Out-of-network sourced from "RealGraph" (interaction-weighted social graph)
- Author reputation ("TweetCred") heavily influences score
- New accounts penalized until behavior established
- Viral tweets get logarithmic boost (diminishing returns)
```

## Stage 3: Post-Ranking Adjustments

### Diversity Injection

Without diversity rules, feeds become echo chambers:

```python
def inject_diversity(ranked_posts, rules):
    """Modify final feed for variety and exploration."""
    final_feed = []
    recent_authors = set()
    recent_topics = Counter()
    consecutive_same_type = 0

    for post in ranked_posts:
        # Rule 1: No more than 2 posts from same author in 10 posts
        if post.author in recent_authors and len(recent_authors) < 3:
            continue

        # Rule 2: No more than 3 consecutive posts on same topic
        if recent_topics[post.topic] >= 3:
            continue

        # Rule 3: Mix content types (text, image, video, link)
        if consecutive_same_type >= 2 and post.type == final_feed[-1].type:
            continue

        # Rule 4: Inject exploration posts every 10 items
        if len(final_feed) % 10 == 9:
            exploration_post = sample_exploration_post(
                exclude_topics=recent_topics.keys()
            )
            final_feed.append(exploration_post)

        final_feed.append(post)
        recent_authors.add(post.author)
        recent_topics[post.topic] += 1

        if len(final_feed) >= rules.feed_size:
            break

    return final_feed
```

### Exploration vs Exploitation

The classic multi-armed bandit problem applied to content:

```python
class ThompsonSampling:
    """Balance showing proven content vs. exploring new content."""

    def __init__(self):
        # Each content category has a Beta distribution
        self.alphas = defaultdict(lambda: 1)  # Successes
        self.betas = defaultdict(lambda: 1)   # Failures

    def should_explore(self, category):
        """Sample from posterior to decide."""
        # Higher uncertainty → more likely to explore
        sampled_rate = np.random.beta(
            self.alphas[category],
            self.betas[category]
        )
        return sampled_rate

    def update(self, category, engaged):
        """Update beliefs after showing content."""
        if engaged:
            self.alphas[category] += 1
        else:
            self.betas[category] += 1
```

## Feedback Loops & Filter Bubbles

### The Engagement Trap

```
┌─────────────────────────────────────────────────────────┐
│              THE ENGAGEMENT TRAP                         │
├─────────────────────────────────────────────────────────┤
│                                                          │
│   User engages with crypto content                       │
│        ↓                                                 │
│   Algorithm shows MORE crypto content                    │
│        ↓                                                 │
│   User engages MORE (because that's all they see)        │
│        ↓                                                 │
│   Algorithm becomes MORE certain user wants crypto       │
│        ↓                                                 │
│   User lives in a crypto echo chamber                    │
│                                                          │
│   This INCREASES engagement metrics but                  │
│   DECREASES user satisfaction long-term.                 │
│                                                          │
│   Solution: Measure LONG-TERM retention, not just        │
│   session engagement. A healthy feed keeps users         │
│   coming back next week, not just scrolling today.       │
│                                                          │
└─────────────────────────────────────────────────────────┘
```

### Breaking the Bubble

```python
class BubbleBreaker:
    """Intentionally inject cross-interest content."""

    def __init__(self, user):
        self.user = user
        self.interest_distribution = user.topic_distribution
        self.exploration_rate = 0.15  # 15% of feed is exploration

    def generate_exploration_candidates(self, all_topics):
        """Find high-quality content from underserved topics."""
        # Topics the user engages with sorted by frequency
        familiar = set(self.user.top_topics(n=10))

        # Topics with universally high engagement but this user hasn't seen
        underrepresented = [
            t for t in all_topics
            if t not in familiar and t.global_engagement_rate > 0.05
        ]

        # Sample proportional to global quality, not user history
        candidates = []
        for topic in underrepresented:
            top_posts = topic.get_top_posts(limit=5, min_quality=0.8)
            candidates.extend(top_posts)

        return candidates
```

## Building a Community Feed (Crypto-Specific)

For a crypto community platform (like the SperaxOS community feed), recommendations must handle domain-specific signals:

### Crypto-Native Ranking Features

```python
def crypto_community_features(user, post):
    """Features specific to crypto/DeFi community feeds."""
    return {
        # Credential signals
        "author_on_chain_activity": post.author.tx_count_30d,
        "author_portfolio_size_tier": post.author.portfolio_tier,  # whale/dolphin/shrimp
        "author_has_ens": post.author.has_ens_name,
        "author_erc8004_registered": post.author.has_agent_nft,

        # Content quality for crypto
        "mentions_contract_address": has_valid_contract(post.text),
        "includes_on_chain_proof": has_tx_hash(post.text),
        "thesis_with_data": post.has_charts or post.has_stats,
        "speculative_vs_analytical": classify_sentiment(post.text),

        # Community-specific
        "in_user_watchlist_tokens": overlap(post.mentioned_tokens, user.watchlist),
        "sperax_ecosystem_relevant": mentions_sperax_tokens(post.text),
        "user_holds_mentioned_tokens": overlap(post.mentioned_tokens, user.portfolio),

        # Temporal crypto signals
        "posted_near_price_move": post.token_price_moved_5pct_within_1h,
        "sentiment_alignment_with_market": market_correlation(post.sentiment),
    }
```

### Content Quality Scoring

```python
def quality_score(post):
    """Score content quality independent of engagement."""
    score = 0.0

    # Positive signals
    if post.word_count > 100:
        score += 0.1  # Thoughtful posts
    if post.has_data or post.has_charts:
        score += 0.2  # Data-driven
    if post.has_on_chain_proof:
        score += 0.3  # Verifiable claims
    if post.author.historical_accuracy > 0.7:
        score += 0.2  # Author track record
    if post.has_nuanced_sentiment:
        score += 0.1  # Not pure hype or FUD

    # Negative signals
    if post.all_caps_ratio > 0.5:
        score -= 0.2  # SHOUTING
    if post.emoji_ratio > 0.3:
        score -= 0.1  # 🚀🚀🚀🔥🔥🔥
    if "guaranteed" in post.text.lower() or "100x" in post.text.lower():
        score -= 0.3  # Hyperbolic claims
    if post.link_to_unknown_domain:
        score -= 0.2  # Potential scam link

    return max(0, min(1, score))
```

## Evaluation Metrics

| Metric | What It Measures | Target |
|--------|-----------------|--------|
| **CTR** | Click-through rate | Higher ≠ better (clickbait) |
| **Dwell Time** | Seconds spent reading | Best proxy for quality |
| **Session Duration** | Total time per visit | Engagement depth |
| **D7 Retention** | % users returning in 7 days | Long-term health |
| **Content Diversity** | Unique topics/authors per feed | Bubble prevention |
| **Negative Actions** | Hides, reports, unfollows | Should decrease |
| **Exploration Success** | % of explored content that gets positive engagement | Algorithm learning |

```python
def evaluate_feed(feed_logs, window_days=30):
    """Holistic feed health evaluation."""
    return {
        "engagement": {
            "dwell_time_p50": median([l.dwell_time for l in feed_logs]),
            "like_rate": sum(l.liked for l in feed_logs) / len(feed_logs),
            "reply_rate": sum(l.replied for l in feed_logs) / len(feed_logs),
        },
        "health": {
            "d7_retention": retention_rate(feed_logs, days=7),
            "negative_action_rate": sum(l.negative for l in feed_logs) / len(feed_logs),
            "content_diversity_score": shannon_entropy(l.topic for l in feed_logs),
        },
        "exploration": {
            "exploration_ctr": exploration_click_rate(feed_logs),
            "interest_expansion": new_topics_adopted(feed_logs),
        }
    }
```

## Sperax Community Feed Applications

- **Coin Thesis Ranking**: Surface high-quality investment theses (backed by on-chain data) over hype posts
- **Watchlist-Aware**: Prioritize posts about tokens in the user's watchlist or portfolio
- **ERC-8004 Agent Posts**: AI agents registered via ERC-8004 can post analyses — rank by their on-chain reputation score
- **USDs Yield Updates**: Auto-surface USDs yield changes and Sperax Farms APY updates to holders
- **Sperax Governance**: Boost veSPA governance proposals to stakers who can vote

## Reference

The X/Twitter recommendation algorithm open-source release (forked by nirholas as `the-algorithm`) provides the most complete public reference for a production recommendation system at billion-user scale.
