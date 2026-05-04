---
status: not-started
---

# Prompt 4: Frontend - UI for Setting Skill Prices

**Status:** Not Started

## Objective
Create a user interface within the agent creation or editing page that allows creators to set prices for their skills.

## Explanation
Now that the backend can handle skill pricing, we need to provide a way for creators to use it. This task involves designing and building a new section in the UI where a creator can see a list of their agent's skills and attach a price to each one.

## Instructions
1.  **Locate the Agent Editor UI:**
    -   Find the HTML file and JavaScript module responsible for the agent editing page (e.g., `agent-edit.html` and `src/agent-edit.js`).

2.  **Design the UI Component:**
    -   Within the skills section of the agent editor, for each skill listed, add a form input for `price` and a dropdown for `currency`.
    -   Initially, the currency can be a static list (e.g., "USDC").
    -   Add a "Save Prices" button.

3.  **Implement the Component:**
    -   When the agent editor loads, it should fetch the agent's details, including the existing `skill_prices`.
    -   Populate the input fields with the existing prices for each skill.
    -   When the "Save Prices" button is clicked, the UI should gather the pricing data for all skills that have a price set.

## Code Example (HTML in `agent-edit.html`)

This is a conceptual example of what the new HTML might look like.

```html
<!-- Inside the agent editor form, where skills are listed -->
<div class="form-section">
    <h3>Skill Monetization</h3>
    <div id="skill-pricing-list">
        <!-- Skills will be rendered here by JavaScript -->
    </div>
    <button type="button" id="save-skill-prices-btn">Save Prices</button>
</div>
```

## Code Example (JavaScript in `src/agent-edit.js`)

```javascript
// ... inside the function that renders the agent editor ...

const skills = agent.skills || [];
const skillPrices = agent.skill_prices || {};
const skillPricingList = document.getElementById('skill-pricing-list');

skillPricingList.innerHTML = skills.map(skill => {
    const price = skillPrices[skill.name];
    const amountInUsdc = price ? (price.amount / 1e6).toFixed(2) : '';
    return `
        <div class="skill-price-entry">
            <span class="skill-name">${escapeHtml(skill.name)}</span>
            <div class="price-input-wrap">
                <input
                    type="number"
                    step="0.01"
                    min="0"
                    class="price-input"
                    data-skill-name="${escapeHtml(skill.name)}"
                    placeholder="e.g., 0.99"
                    value="${amountInUsdc}"
                />
                <span class="currency-label">USDC</span>
            </div>
        </div>
    `;
}).join('');
```

## CSS Example

Add styles to `/agent-edit.css` for the new elements.

```css
.skill-price-entry {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 8px 0;
    border-bottom: 1px solid #333;
}
.price-input-wrap {
    display: flex;
    align-items: center;
    gap: 8px;
}
.price-input {
    width: 80px;
    /* ... other styles */
}
```

## Definition of Done
-   The UI for setting skill prices is implemented on the agent editing page.
-   Existing prices are correctly displayed when the page loads.
-   The "Save Prices" button is present.
