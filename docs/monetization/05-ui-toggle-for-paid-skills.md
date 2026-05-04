# Prompt 5: UI Toggle for Paid Skills

## Objective
Enhance the skill price management UI with dynamic toggles that intuitively show and hide price input fields.

## Explanation
This prompt focuses on the frontend user experience for creators. Instead of showing price inputs at all times, we'll use a checkbox or toggle switch for each skill. This makes the interface cleaner and the act of setting a price a more deliberate choice.

## Instructions
1.  **File to Edit:**
    *   Continue working in `agent-edit.html` and its associated JavaScript.

2.  **Refine the UI Structure:**
    *   For each skill listed in the pricing management section, ensure you have the following HTML structure:
        *   The skill name.
        *   A checkbox/toggle: `<input type="checkbox" class="paid-toggle">`.
        *   A container for the price inputs (e.g., a `<div>`) that is initially hidden if the skill is free.

3.  **Implement JavaScript Logic:**
    *   Add an event listener to all `.paid-toggle` checkboxes.
    *   When a checkbox is checked (toggled on):
        *   The associated price input container should become visible (e.g., `style.display = 'flex'`).
        *   You might want to focus the amount input field to encourage the user to enter a price.
    *   When a checkbox is unchecked (toggled off):
        *   The price input container should be hidden (`style.display = 'none'`).

4.  **Initial State:**
    *   When the UI is first rendered, the state of each checkbox and the visibility of the price inputs must reflect the current pricing data fetched from the backend. If a skill has a price, its checkbox should be checked and its price inputs should be visible.

## Code Example (Frontend - `agent-edit.html` script)

This builds upon the example from Prompt 3.

```html
<!-- Example HTML structure for one skill row within agent-edit.html -->
<div class="form-group skill-price-row">
    <label class="form-label">summarize-text</label>
    <div class="skill-price-controls">
        <input type="checkbox" class="paid-toggle" id="toggle-summarize-text" data-skill="summarize-text">
        <label for="toggle-summarize-text" class="toggle-label">Paid Skill</label>
        
        <div class="price-inputs" style="display: none;">
            <input type="number" class="price-amount" value="1.00" step="0.01" min="0">
            <span>USDC</span>
        </div>
    </div>
</div>
```

```css
/* Add some basic styling for the toggle and inputs in your CSS */
.skill-price-controls {
  display: flex;
  align-items: center;
  gap: 10px;
}
.price-inputs {
  display: flex;
  align-items: center;
  gap: 5px;
}
```

```javascript
// JavaScript to handle the dynamic visibility

document.addEventListener('DOMContentLoaded', () => {
    // Assume renderSkillPricingUI() has been called and the HTML is on the page

    const container = document.getElementById('skill-pricing-container');

    container.addEventListener('change', (e) => {
        if (e.target.classList.contains('paid-toggle')) {
            const controls = e.target.closest('.skill-price-controls');
            const priceInputs = controls.querySelector('.price-inputs');
            
            if (e.target.checked) {
                priceInputs.style.display = 'flex';
                priceInputs.querySelector('.price-amount').focus();
            } else {
                priceInputs.style.display = 'none';
            }
        }
    });
});
```
