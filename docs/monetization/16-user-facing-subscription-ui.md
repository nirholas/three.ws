---
status: not-started
---

# Prompt 16: User-Facing Subscription UI

## Objective
Display available subscription tiers on the agent detail page and provide a UI for users to initiate a subscription.

## Explanation
Now that creators can define tiers, we need to show them to potential subscribers. This involves fetching the tiers for an agent and displaying them in a clear, compelling way, with a "Subscribe" button for each.

## Instructions
1.  **Update Agent Detail API:**
    *   Modify the main agent detail API endpoint (`/api/marketplace/agents/:id`).
    *   In addition to the agent's details, also fetch its *active* subscription tiers from the `agent_subscription_tiers` table.
    *   Include these tiers in the response, e.g., in an `agent.subscription_tiers` array.

2.  **Create Subscription Tiers Section in UI:**
    *   On the `marketplace.html` page (or its detail view template), add a new section for "Subscriptions".
    *   This section will contain a grid or list to display the tier cards.

3.  **Implement Frontend Rendering Logic:**
    *   In the `renderDetail` function, check if `agent.subscription_tiers` exists and is not empty.
    *   If it is, iterate over the tiers and render a card for each one.
    *   Each card should display:
        *   Tier Name
        *   Price (e.g., "5.00 USDC / month")
        *   Description / list of perks
        *   A "Subscribe" button.

4.  **Handle User Subscription Status:**
    *   You will need to know if the user is already subscribed to the agent (at any tier).
    *   You can fetch this information along with the user's other data (like unlocked skills).
    *   If the user is already subscribed to a tier, the UI should reflect this. For example, highlight the current tier and change the button to "Manage Subscription", while disabling the buttons for other tiers.

## Code Example (HTML Structure for Tiers)

```html
<!-- In agent detail view -->
<div id="subscription-tiers-section" style="display: none;">
  <h3>Subscribe for Exclusive Perks</h3>
  <div id="tiers-grid" class="tiers-grid">
    <!-- Tier cards will be rendered here -->
  </div>
</div>
```

## CSS Example for Tier Cards

```css
.tiers-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
  gap: 16px;
  margin-top: 16px;
}
.tier-card {
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 20px;
  text-align: center;
}
.tier-card.subscribed {
  border-color: var(--accent);
  box-shadow: 0 0 10px rgba(0, 255, 65, 0.2);
}
.tier-card .name {
  font-size: 18px;
  font-weight: bold;
  color: var(--text-bright);
}
.tier-card .price {
  font-size: 22px;
  color: var(--accent);
  margin: 8px 0;
}
.tier-card .price .interval {
  font-size: 12px;
  color: #888;
}
.tier-card .description {
  font-size: 12px;
  color: #888;
  min-height: 50px;
}
.tier-card .subscribe-btn {
  margin-top: 16px;
  width: 100%;
}
```

## Code Example (Frontend Rendering Logic)

```javascript
function renderSubscriptionTiers(agent, userSubscription) {
  const container = document.getElementById('subscription-tiers-section');
  const grid = document.getElementById('tiers-grid');
  const tiers = agent.subscription_tiers || [];

  if (tiers.length === 0) {
    container.style.display = 'none';
    return;
  }
  container.style.display = 'block';

  grid.innerHTML = tiers.map(tier => {
    const isSubscribed = userSubscription && userSubscription.tier_id === tier.id;
    const buttonText = isSubscribed ? 'Current Plan' : 'Subscribe';
    const isDisabled = userSubscription && !isSubscribed; // Disable other tiers if already subbed

    return `
      <div class="tier-card ${isSubscribed ? 'subscribed' : ''}">
        <div class="name">${escapeHtml(tier.name)}</div>
        <div class="price">
          ${(tier.price_amount / 1e6).toFixed(2)} USDC
          <span class="interval">/ ${tier.interval}</span>
        </div>
        <div class="description">${escapeHtml(tier.description)}</div>
        <button class="subscribe-btn" ${isDisabled || isSubscribed ? 'disabled' : ''}
                onclick="initiateSubscription('${tier.id}')">
          ${buttonText}
        </button>
      </div>
    `;
  }).join('');
}
```
