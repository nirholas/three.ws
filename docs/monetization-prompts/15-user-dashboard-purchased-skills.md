# Prompt 15: User Profile Page to Show Purchased Skills

## Objective
Create a section or a new page in the user's profile/dashboard where they can see a list of all the premium skills they have purchased across all agents.

## Explanation
Users need a central place to view their entitlements. This feature adds transparency and value to their account by aggregating all their purchased skills in one place. It acts as a digital inventory of their premium agent capabilities.

## Instructions
1.  **Create an API Endpoint for All Purchased Skills:**
    *   Create a new endpoint, e.g., `api/users/me/purchased-skills.js`.
    *   **Authentication:** Get the logged-in user.
    *   **Database Query:** Query the `user_skill_purchases` table for all records matching the `user_id` where `status` is `'confirmed'`.
    *   Join with `agent_identities` and `agent_skill_prices` to retrieve details like agent name, skill name, and the price they paid.
    *   Return the list of purchased skills as a JSON array.

2.  **Create the Frontend Page:**
    *   Add a new tab or section to the user dashboard, e.g., `dashboard/my-skills.html`.
    *   Create a corresponding JS file, `src/dashboard-my-skills.js`.

3.  **Render the List:**
    *   In the new JS file, fetch the data from the API endpoint.
    *   Render the data in a table or a list format.
    *   Include columns for: Purchase Date, Skill Name, Agent Name, and a link to the agent's page.

## HTML Example (`dashboard/my-skills.html`)

```html
<div class="dashboard-content">
    <h2>My Purchased Skills</h2>
    <p>This is a list of all the premium skills you have unlocked.</p>
    
    <table id="my-skills-table">
        <thead>
            <tr>
                <th>Purchase Date</th>
                <th>Skill</th>
                <th>Agent</th>
                <th></th>
            </tr>
        </thead>
        <tbody>
            <!-- JS will render rows here -->
        </tbody>
    </table>
</div>

<script src="/src/dashboard-my-skills.js" type="module"></script>
```
