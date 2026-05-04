# Prompt 25: User-Facing "My Purchased Skills" Page

## Objective
Create a new page for authenticated users where they can view all the premium skills and agent subscriptions they have purchased.

## Explanation
Users need a central place to see what premium content they have access to, when it expires, or how many uses are left. This page improves transparency and helps users manage their purchases.

## Instructions
1.  **Create New Frontend Page:**
    *   Create a new HTML file, e.g., `purchases.html`.
    *   Add basic HTML structure and link to your standard CSS and a new JavaScript file, e.g., `src/purchases.js`.
    *   Add a link to this new page in the main user navigation menu (e.g., in the user dropdown after they log in).

2.  **Create Backend Endpoint:**
    *   Create a new authenticated endpoint: `GET /api/users/my-purchases`.
    *   This endpoint should query two tables for the currently logged-in user:
        *   **`skill_access_grants`**: Fetch all active grants (not expired, or uses > 0). Join with the `agents` table to get agent names.
        *   **`user_agent_subscriptions`**: Fetch all active subscriptions. Join with `agents` to get agent names.
    *   Return a JSON object containing two arrays: `skill_grants` and `subscriptions`.

3.  **Implement Frontend Logic:**
    *   In `src/purchases.js`, on page load, make a request to the `/api/users/my-purchases` endpoint.
    *   **Render Subscriptions:**
        *   Create a section for "Active Subscriptions".
        *   Iterate through the `subscriptions` array and render a card for each one, showing:
            *   Agent Name (linked to the agent's page).
            *   "Access until [formatted date]".
    *   **Render Skill Grants:**
        *   Create a section for "Individual Skill Purchases".
        *   Iterate through the `skill_grants` array and render a card or table row for each, showing:
            *   Skill Name.
            *   Agent Name.
            *   Access status (e.g., "Expires on [date]" or "[N] uses left").

## Code Example (Backend - `/api/users/my-purchases.js`)

```javascript
// --- Inside your API handler ---

const user = await getAuthenticatedUser(req);

const skill_grants = await db('skill_access_grants as grants')
  .join('agents', 'agents.id', 'grants.agent_id')
  .where('grants.user_id', user.id)
  .where(q => {
    q.where('grants.expires_at', '>', db.fn.now())
     .orWhere('grants.uses_left', '>', 0);
  })
  .select(
    'agents.name as agent_name',
    'agents.id as agent_id',
    'grants.skill_name',
    'grants.expires_at',
    'grants.uses_left'
  );

const subscriptions = await db('user_agent_subscriptions as subs')
  .join('agents', 'agents.id', 'subs.agent_id')
  .where({
    'subs.user_id': user.id,
    'subs.status': 'active'
  })
  .where('subs.current_period_ends_at', '>', db.fn.now())
  .select(
      'agents.name as agent_name',
      'agents.id as agent_id',
      'subs.current_period_ends_at'
  );

res.status(200).json({ skill_grants, subscriptions });
```

## Code Example (Frontend - `purchases.html` + `src/purchases.js`)

```html
<!-- purchases.html -->
<body>
    <!-- Header/Nav -->
    <main class="container">
        <h1>My Purchases</h1>
        
        <h2>Active Subscriptions</h2>
        <div id="subscriptions-list" class="purchase-list">
            <p>Loading...</p>
        </div>
        
        <h2>Individual Skills</h2>
        <div id="skills-list" class="purchase-list">
            <p>Loading...</p>
        </div>
    </main>
    <!-- Footer -->
    <script type="module" src="/src/purchases.js"></script>
</body>
```

```javascript
// src/purchases.js

function render(data) {
    const subsContainer = document.getElementById('subscriptions-list');
    // ... logic to map over data.subscriptions and render HTML ...

    const skillsContainer = document.getElementById('skills-list');
    // ... logic to map over data.skill_grants and render HTML ...
    // For each grant, display either expires_at or uses_left.
}

fetch('/api/users/my-purchases')
    .then(res => res.json())
    .then(render)
    .catch(err => {
        document.querySelector('main').innerHTML = 'Error loading your purchases.';
    });
```
