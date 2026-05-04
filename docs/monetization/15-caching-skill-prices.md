---
status: not-started
---

# Prompt 15: Caching Skill Prices

## Objective
Implement a caching layer to reduce database load and improve the performance of fetching skill prices.

## Explanation
Skill prices are unlikely to change frequently. Caching this data will improve the responsiveness of the marketplace and reduce the number of queries to the database.

## Instructions
1.  **Choose a Caching Strategy:**
    *   Decide on a caching solution, such as Redis or an in-memory cache.

2.  **Implement Caching Logic:**
    *   When fetching agent details, first check the cache for the skill prices.
    *   If the prices are in the cache, return them directly.
    *   If not, fetch them from the database and store them in the cache with an expiration time (e.g., 1 hour).

3.  **Cache Invalidation:**
    *   When a creator updates their skill prices, invalidate the corresponding cache entry to ensure the new prices are displayed.
