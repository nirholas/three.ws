---
status: not-started
last_updated: 2026-05-04
---
# Prompt 17: Caching Layer for On-Chain Data

## Objective
Implement a caching layer (e.g., using Redis) to reduce redundant calls to the Solana RPC and other external APIs, improving performance and reliability.

## Explanation
Our application makes several calls to the Solana network (e.g., `getLatestBlockhash`, `getParsedTransaction`) and potentially other services like CoinGecko. These calls can be slow and are subject to rate limiting. Caching frequently accessed, non-time-sensitive data can significantly speed up our API responses.

## Instructions
1.  **Set Up a Caching Client:**
    *   Add a Redis client library (e.g., `ioredis`) to the project.
    *   Create a Redis client instance that can be shared across the application, likely in `api/_lib/redis.js`.

2.  **Identify Caching Opportunities:**
    *   **Skill Prices:** Prices set by creators don't change often. They can be cached for several minutes. The cache should be invalidated whenever a creator updates their prices.
    *   **Agent Details:** Marketplace agent data is a prime candidate for caching.
    *   **Transaction Details:** A confirmed transaction is immutable. Once we've verified a purchase signature with `getParsedTransaction`, we can cache the result indefinitely. If we check the same signature again, we can serve it from the cache.
    *   **SOL/USD Price:** The CoinGecko API has rate limits. We should cache the SOL price for at least 60-120 seconds.

3.  **Implement Caching Logic:**
    *   Wrap your data-fetching logic in a "cache-aside" pattern:
        *   First, try to get the data from the Redis cache using a specific key (e.g., `skill-price:${agentId}:${skillName}`).
        *   If the data exists in the cache (a "cache hit"), return it immediately.
        *   If not (a "cache miss"), fetch the data from the primary source (database or external API).
        *   After fetching, store the data in Redis with a Time-To-Live (TTL) before returning it.

## Code Example (A generic caching function)

```javascript
// In api/_lib/cache.js
import { redis } from './redis.js'; // Assume this exports a Redis client

export async function cacheAside(key, ttlSeconds, fetchDataFn) {
    const cachedData = await redis.get(key);
    if (cachedData) {
        return JSON.parse(cachedData);
    }

    const liveData = await fetchDataFn();

    // Set with TTL and handle cases where liveData might be null
    if (liveData) {
        await redis.set(key, JSON.stringify(liveData), 'EX', ttlSeconds);
    }

    return liveData;
}
```

## Code Example (Using the cache in a service)

```javascript
// Inside MonetizationService.js
import { cacheAside } from '../../_lib/cache.js';

class MonetizationService {
    async getSkillPrice(agentId, skillName) {
        const cacheKey = `skill-price:${agentId}:${skillName}`;
        const ttl = 300; // 5 minutes

        return cacheAside(cacheKey, ttl, async () => {
            const [price] = await sql`
                SELECT amount, currency_mint FROM agent_skill_prices
                WHERE agent_id = ${agentId} AND skill_name = ${skillName}
            `;
            return price;
        });
    }
}
```
