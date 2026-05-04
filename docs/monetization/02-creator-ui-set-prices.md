---
status: not-started
---

# Prompt 2: Creator UI to Set Skill Prices

## Objective
Create a user interface within the agent creation/editing page that allows creators to set and update prices for their agent's skills.

## Explanation
To enable skill monetization, creators need a way to manage the prices of their skills. This new UI will allow them to assign a price and currency to each skill, which will then be saved to the database.

## Instructions
1.  **Modify the Agent Edit Page:**
    *   Locate the agent editing page, likely `agent-edit.html` or a similar file.
    *   Find the section where skills are listed or added.
    *   For each skill, add input fields for `price` and `currency`. The currency could be a dropdown (e.g., "USDC", "SOL").

2.  **Handle Form Submission:**
    *   In the corresponding JavaScript file (e.g., `src/agent-edit.js`), update the form submission logic.
    *   When the creator saves the agent, collect the pricing information for each skill.
    *   Send this data to the backend API.

## Code Example (Frontend - `agent-edit.html`)

This is a conceptual example of what the new skill section might look like.

```html
<div id="skills-section">
    <!-- Existing skill list -->
    <div class="skill-item">
        <span>Skill Name</span>
        <input type="number" class="skill-price-input" placeholder="Price">
        <select class="skill-currency-select">
            <option value="USDC">USDC</option>
            <option value="SOL">SOL</option>
        </select>
    </div>
</div>
```
