# Scheduled Spaces Example

Automatically join X Spaces on a **cron schedule** with auto-leave timers. Perfect for recurring shows, AMAs, or monitoring specific Spaces.

## Quickstart

1. Install dependencies:
   ```bash
   npm install
   ```

2. Copy `.env.example` to `.env` and fill in your credentials and Space URLs:
   ```bash
   cp .env.example .env
   ```

3. Run the scheduler:
   ```bash
   npm start
   ```

## Default Schedule

| Day | Time (ET) | Space | Duration |
|-----|-----------|-------|----------|
| Mon-Fri | 9:00 AM | Crypto Morning Show | 1 hour |
| Friday | 6:00 PM | Weekly AMA | 2 hours |
| Sunday | 3:00 PM | Sunday Recap | 1.5 hours |

## Customization

Edit `index.ts` to add or modify schedules:

```typescript
// Cron format: minute hour day-of-month month day-of-week
cron.schedule('30 14 * * 3', () => {
  joinSpace('Wednesday Show', 'https://x.com/i/spaces/...', 60 * 60 * 1000)
}, { timezone: 'America/New_York' })
```

## Production Tips

- Run with a process manager like `pm2` for auto-restart:
  ```bash
  pm2 start npm --name "space-scheduler" -- start
  ```
- The agent prevents joining two Spaces simultaneously
- Failed joins are logged and don't block future schedules


