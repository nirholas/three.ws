---
status: not-started
last_updated: 2026-05-04
---
# Prompt 25: Admin Panel for Monetization Management

## Objective
Create a secure admin-only panel to oversee and manage all monetization-related activities on the platform.

## Explanation
A robust platform needs an internal dashboard for administrators to monitor the health of the monetization system, manage disputes, and configure global settings. This is a critical tool for operations and support.

## Instructions
1.  **Admin Authentication/Authorization:**
    *   Implement a role-based access control (RBAC) system. In the `users` table, add an `is_admin` boolean flag.
    *   Create a backend middleware that checks this flag for all admin API endpoints. If `is_admin` is not true, reject the request.

2.  **Create the Admin UI:**
    *   Create a new, separate frontend application or a secured route (e.g., `/admin`) for the admin panel.
    *   This UI will be built to consume new, admin-only API endpoints.

3.  **Backend APIs for Admin:**
    *   Create a new set of API routes under `/api/admin/`.
    *   **Global Stats (`/api/admin/stats`):**
        *   Display platform-wide revenue, total sales, new subscriptions, etc.
    *   **Transaction Viewer (`/api/admin/transactions`):**
        *   A searchable, paginated view of the `user_purchased_skills` and `skill_subscriptions` tables. Allows admins to look up any purchase.
    *   **Currency Management (`/api/admin/currencies`):**
        *   An interface to manage the `SUPPORTED_CURRENCIES` whitelist. Admins can add or disable currencies without a code deployment.
    *   **Platform Fee Configuration (`/api/admin/settings`):**
        *   Allow admins to view and update the platform fee percentage and treasury wallet address.

4.  **Key Admin Features:**
    *   **Revenue Monitoring:** Dashboards with charts showing total platform revenue over time.
    *   **Dispute Resolution:** A feature that would allow an admin to, for example, manually credit a user with a skill if a purchase failed in a way our system didn't catch. This would involve manually inserting a row into `user_purchased_skills`.
    *   **User Lookup:** The ability to look up a user and see all their purchases and subscriptions.

## Code Example (Admin Auth Middleware)

```javascript
// In api/_lib/auth.js or a new middleware file

export async function requireAdmin(req, res) {
    const user = await getSessionUser(req);
    if (!user || !user.is_admin) {
        error(res, 403, 'forbidden', 'You do not have administrative privileges.');
        return null; // Stop execution
    }
    return user; // Proceed
}

// In an admin API handler
import { requireAdmin } from '../../_lib/auth.js';

export default wrap(async (req, res) => {
    const adminUser = await requireAdmin(req, res);
    if (!adminUser) return; // Stop if not admin

    // ... proceed with admin-only logic
});
```
