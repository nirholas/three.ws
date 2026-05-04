# Prompt 22: "My Collection" Page

## Objective
Create a dedicated page where users can view all the premium skills and agent subscriptions they have purchased.

## Explanation
As users begin to acquire assets on the platform, they need a central place to view their collection. This page acts as their personal inventory, reinforcing the value of their purchases and providing easy access to the agents and skills they've unlocked.

## Instructions
1.  **Create New Page:**
    *   Create a new HTML file, `collection.html`, and its corresponding JavaScript file, `src/collection.js`.
    *   This page must be accessible only to logged-in users.

2.  **Backend API for Owned Assets:**
    *   Create a new backend endpoint, `/api/users/my-collection`.
    *   This endpoint will fetch all the assets owned by the currently logged-in user.
    *   It should query the database to find:
        *   All purchased skills (by looking at the `sales` table or by querying for their skill NFTs on-chain, though the database is faster).
        *   All active subscriptions from the `user_subscriptions` table.

3.  **Frontend UI:**
    *   On page load, `src/collection.js` should call the `/api/users/my-collection` endpoint.
    *   The UI should be divided into two sections: "My Skills" and "My Subscriptions."
    *   For each skill, display its name, the agent it belongs to, and a link to that agent's page.
    *   For each subscription, display the agent's name, the subscription tier, and the renewal/expiry date.
    *   Design the page with clean cards or list items to make the collection easy to browse.

## Code Example (HTML Structure for `collection.html`)
```html
<h1>My Collection</h1>

<section>
  <h2>My Subscriptions</h2>
  <div id="subscriptions-list" class="collection-grid">
    <!-- Subscription cards will be populated here -->
    <div class="card">
      <h3>Agent 'X' - Pro Tier</h3>
      <p>Renews on: 2026-06-04</p>
      <a href="/agent/x">View Agent</a>
    </div>
  </div>
</section>

<section>
  <h2>My Skills</h2>
  <div id="skills-list" class="collection-grid">
    <!-- Skill cards will be populated here -->
    <div class="card">
      <h3>Skill: dance</h3>
      <p>From: Agent 'Y'</p>
      <a href="/agent/y">View Agent</a>
    </div>
  </div>
</section>
```
