---
status: not-started
---

# Prompt 11: Frontend Monetization Tab

**Status:** Not Started

## Objective
Add a new "Monetization" tab or section to the agent creation/editing page.

## Explanation
Agent creators need a dedicated area to manage the pricing of their skills. The first step is to create the UI container for these settings. This involves adding a new tab to the navigation on the agent editor page.

## Instructions
- [ ] **Identify the agent editor file:**
    - [ ] Locate the main HTML file for editing an agent (e.g., `agent-edit.html`).
- [ ] **Add a new navigation tab:**
    - [ ] In the HTML, find the tab navigation structure.
    - [ ] Add a new tab link labeled "Monetization".
- [ ] **Create the content pane:**
    - [ ] Add a corresponding content `div` for the monetization tab. This `div` will initially be hidden and shown only when the "Monetization" tab is active.
    - [ ] This pane will house the skill pricing UI, which will be built in the next prompt.
- [ ] **Implement the tab switching logic:**
    - [ ] In the corresponding JavaScript file, add or update the event listeners to handle showing and hiding the new monetization pane when its tab is clicked.

## Code Example (HTML in `agent-edit.html`)

```html
<!-- ... inside agent-edit.html ... -->

<div class="tabs">
  <a href="#" class="tab-link active" data-tab="profile">Profile</a>
  <a href="#" class="tab-link" data-tab="avatar">Avatar</a>
  <a href="#" class="tab-link" data-tab="skills">Skills</a>
  <!-- New Tab -->
  <a href="#" class="tab-link" data-tab="monetization">Monetization</a>
</div>

<div class="tab-content">
  <div id="tab-profile" class="tab-pane active">
    <!-- ... profile content ... -->
  </div>
  <div id="tab-avatar" class="tab-pane">
    <!-- ... avatar content ... -->
  </div>
  <div id="tab-skills" class="tab-pane">
    <!-- ... skills content ... -->
  </div>
  <!-- New Pane -->
  <div id="tab-monetization" class="tab-pane">
    <h2>Skill Pricing</h2>
    <p>Set prices for your premium skills here.</p>
    <!-- UI for pricing will go here in the next step -->
    <div id="skill-pricing-list"></div>
  </div>
</div>
```
