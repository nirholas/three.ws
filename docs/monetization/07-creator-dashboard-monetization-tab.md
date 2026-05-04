# Prompt 7: Creator Dashboard Monetization Tab

## Objective
Create the basic structure for a new "Monetization" tab within the agent creator's dashboard, where they will manage skill pricing and view earnings.

## Explanation
To empower creators to sell their skills, they need a dedicated space within the application to manage their monetization settings. This first step involves creating the UI shell for this new section. We will add a new tab to the agent editing interface and create the container where the pricing and earnings components will live.

## Instructions
1.  **Add Tab to Dashboard UI:**
    *   Locate the HTML file for the agent editing/dashboard page (e.g., `agent-edit.html`).
    *   Add a new tab button for "Monetization" alongside existing tabs like "Profile" or "Skills".
    *   Add a corresponding tab panel container that will be shown when the Monetization tab is active.

2.  **Implement Tab Switching Logic:**
    *   In the corresponding JavaScript file (e.g., `src/agent-edit.js`), update the tab switching logic to handle the new Monetization tab.
    *   When the Monetization tab is clicked, its panel should become visible, and others should be hidden.

3.  **Create Placeholder Content:**
    *   Inside the Monetization tab panel, add placeholder sections for "Skill Pricing" and "Earnings". This sets the stage for future prompts where we will build out these features.

## HTML Example (`agent-edit.html`)

```html
<!-- In the tab list -->
<div class="tabs">
    <button class="tab-link" data-tab="profile">Profile</button>
    <button class="tab-link" data-tab="skills">Skills</button>
    <button class="tab-link" data-tab="monetization">Monetization</button>
</div>

<!-- In the tab content area -->
<div class="tab-content-wrapper">
    <div id="profile" class="tab-content">...</div>
    <div id="skills" class="tab-content">...</div>
    <div id="monetization" class="tab-content" style="display: none;">
        <h2>Monetization</h2>
        <div class="card">
            <h3>Skill Pricing</h3>
            <p>Set the price for your agent's premium skills.</p>
            <div id="skill-pricing-container">
                <!-- Pricing UI will go here -->
            </div>
        </div>
        <div class="card">
            <h3>Earnings</h3>
            <p>View your sales and manage payouts.</p>
            <div id="earnings-container">
                <!-- Earnings dashboard will go here -->
            </div>
        </div>
        <div class="card">
            <h3>Payout Wallet</h3>
            <p>Set the Solana wallet address where you will receive payments.</p>
            <div id="treasury-wallet-container">
                <label for="treasuryWallet">Your Solana Wallet Address:</label>
                <input type="text" id="treasuryWallet" placeholder="Enter public key...">
                <button id="saveTreasuryWallet">Save</button>
            </div>
        </div>
    </div>
</div>
```

## JavaScript Example (`src/agent-edit.js`)

```javascript
document.addEventListener('DOMContentLoaded', () => {
    const tabs = document.querySelectorAll('.tab-link');
    const contents = document.querySelectorAll('.tab-content');

    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            const target = tab.getAttribute('data-tab');

            // Hide all content
            contents.forEach(content => {
                content.style.display = 'none';
            });

            // Show target content
            document.getElementById(target).style.display = 'block';

            // Update active tab style
            tabs.forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
        });
    });

    // Default to the first tab
    tabs[0].click();
});
```
