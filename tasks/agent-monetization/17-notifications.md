# Task 17 — Notifications: Earnings Alerts for Agent Owners

## Goal
Notify agent owners when they receive a payment (and when a withdrawal completes). This closes the feedback loop so owners know their monetized agents are generating revenue without having to check the dashboard.

## Success Criteria
- Owner receives a notification when an `agent_revenue_events` row is inserted
- Owner receives a notification when a withdrawal transitions to `completed` or `failed`
- Notifications are non-blocking (fire-and-forget, failure silently logged not thrown)
- Owners can opt out per notification type

## Notification Types to Implement

### In-app notifications (simplest, do this first)
Add a `notifications` table:
```sql
CREATE TABLE user_notifications (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type       TEXT NOT NULL,   -- "payment_received" | "withdrawal_completed" | "withdrawal_failed"
  payload    JSONB NOT NULL,
  read_at    TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON user_notifications (user_id, read_at, created_at DESC);
```

### Endpoints

`GET /api/notifications` — list unread notifications for the current user
```json
{
  "notifications": [
    {
      "id": "uuid",
      "type": "payment_received",
      "payload": { "agent_name": "Atlas", "skill": "answer-question", "net_amount": 950000 },
      "created_at": "2026-04-30T12:00:00Z"
    }
  ],
  "unread_count": 3
}
```

`POST /api/notifications/:id/read` — mark a notification read

`POST /api/notifications/read-all` — mark all read

### When to Write Notifications

**Payment received** — in the revenue attribution code (Task 04), after inserting the `agent_revenue_events` row:
```js
await db.query(
  `INSERT INTO user_notifications (user_id, type, payload)
   SELECT ai.user_id, 'payment_received',
     jsonb_build_object(
       'agent_id', $2,
       'skill', $3,
       'net_amount', $4,
       'currency_mint', $5
     )
   FROM agent_identities ai WHERE ai.id = $2`,
  [/* ... */]
);
```

**Withdrawal completed/failed** — in the cron processor (Task 15), after updating withdrawal status.

### UI: Notification Bell
In the main nav/header, add a bell icon with an unread count badge.
- Fetches `GET /api/notifications` on load (and on focus)
- Clicking opens a dropdown list of recent notifications
- "Mark all read" button

Keep the component small — a simple dropdown, not a full page.

## Email Notifications (optional, lower priority)
If `SENDGRID_API_KEY` or an SMTP env var is configured, also send an email. Make this opt-in via user preferences. Implement only if the in-app version is working.

## Files to Create/Touch
- `/api/_lib/migrations/014_notifications.sql` — new table
- `/api/notifications/index.js` — GET
- `/api/notifications/[id]/read.js` — POST
- `/api/notifications/read-all.js` — POST
- Revenue attribution handler (Task 04) — add notification insert
- Cron withdrawal processor (Task 15) — add notification insert
- `src/components/notification-bell.jsx` — new component
- Main layout/nav component — wire in notification bell

## Verify
1. Complete a payment for a priced skill → notification appears in bell within one page reload
2. Click bell → dropdown shows "Atlas received payment: 0.95 USDC for answer-question"
3. Click "Mark all read" → badge clears
4. Withdrawal completes → "Withdrawal of 1.00 USDC sent" notification appears
