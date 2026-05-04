---
status: not-started
last_updated: 2026-05-04
---
# Prompt 24: Analytics for Creators

## Objective
Provide creators with analytics on how users are interacting with their paid skills, helping them understand what's popular and what's not.

## Explanation
Beyond sales data, creators need insight into skill usage to improve their offerings. We will track every time a paid skill is executed and present this data in the creator dashboard.

## Instructions
1.  **Database Schema for Skill Usage:**
    *   Create a new table `skill_usage_logs`.
    *   Columns: `id`, `user_id`, `agent_id`, `skill_name`, `created_at`, `status` ('success' or 'failure'), `execution_time_ms`.

2.  **Log Skill Executions:**
    *   In the main skill execution API (`api/chat.js`), after the ownership/access control check passes, add a logging step.
    *   Before executing the skill, record the start time.
    *   After execution, record the end time and whether it succeeded or failed.
    *   Asynchronously (to avoid slowing down the chat response), insert a new record into the `skill_usage_logs` table with this information.

3.  **Backend API for Analytics:**
    *   Create a new endpoint, `GET /api/creators/skill-analytics`.
    *   This endpoint will query the `skill_usage_logs` table for agents owned by the current user.
    *   It should aggregate the data to provide metrics like:
        *   Total usage count per skill.
        *   Unique users per skill.
        *   Success/failure rate per skill.
        *   Average execution time per skill.

4.  **Frontend Dashboard UI:**
    *   In `creator-dashboard.html`, add a new section for "Skill Analytics."
    *   Fetch data from the new analytics endpoint.
    *   Display the aggregated data in a table. This gives creators a clear overview of which of their skills are most used, most reliable, and fastest.
    *   Optionally, add charts to visualize usage trends over time.

## Code Example (Logging in `api/chat.js`)

```javascript
// ... after access control checks pass
const startTime = Date.now();
let status = 'success';
let result;

try {
    result = await executeSkill(skillName, ...);
} catch (e) {
    status = 'failure';
    throw e; // Re-throw the error to the user
} finally {
    const executionTimeMs = Date.now() - startTime;
    // Log asynchronously without waiting
    sql`
        INSERT INTO skill_usage_logs (user_id, agent_id, skill_name, status, execution_time_ms)
        VALUES (${userId}, ${agentId}, ${skillName}, ${status}, ${executionTimeMs})
    `.catch(dbErr => console.error("Failed to log skill usage:", dbErr));
}

return result;
```
