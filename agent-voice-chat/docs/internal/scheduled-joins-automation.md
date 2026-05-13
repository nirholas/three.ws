> **Internal Planning Document** — Not part of the public documentation.

# Prompt: Scheduled Joins & Automation

## Problem
Currently, joining a Space requires manual action — either clicking "Join" in the admin panel or setting `X_SPACE_URL` for auto-join on startup. There's no way to schedule joins, auto-discover Spaces, or run the bot on a schedule.

## Goal
Automate Space joining with scheduling, Space discovery, and conditional logic.

## Features

### 1. Scheduled Joins
Schedule the bot to join specific Spaces at specific times:

```json
// schedules/schedule.json
{
  "schedules": [
    {
      "id": "daily-crypto",
      "name": "Daily Crypto Space",
      "spaceUrl": "https://x.com/i/spaces/1abc...",
      "cron": "0 14 * * *",
      "timezone": "America/New_York",
      "duration": 3600,
      "agents": {
        "count": 2,
        "personalities": ["crypto-degen", "tech-analyst"]
      },
      "enabled": true
    },
    {
      "id": "weekly-ama",
      "name": "Weekly AMA",
      "spaceUrl": "https://x.com/i/spaces/2def...",
      "cron": "0 18 * 5",
      "timezone": "UTC",
      "duration": 7200,
      "agents": {
        "count": 1,
        "personalities": ["interviewer"]
      },
      "enabled": true
    }
  ]
}
```

**Implementation:**
- Use `node-cron` for scheduling
- On trigger: auto-start bot (if not running), join Space, apply personality config
- Auto-leave after `duration` seconds
- Admin UI shows upcoming scheduled joins

### 2. Space Discovery
Automatically find and join relevant Spaces:

```json
// discovery/config.json
{
  "enabled": false,
  "watchAccounts": ["@elonmusk", "@VitalikButerin", "@CryptoProject"],
  "keywords": ["crypto", "AI", "web3"],
  "minListeners": 50,
  "maxConcurrentSpaces": 2,
  "autoJoin": false,
  "notifyOnly": true
}
```

**How it works:**
- Periodically check watched accounts for active Spaces (using X's GraphQL API via Puppeteer)
- Match Space titles against keywords
- Filter by listener count
- Either auto-join or notify admin via Socket.IO event

**Note:** This is advanced and relies on X's internal APIs which may change. Implement as optional/experimental.

### 3. Conditional Auto-Leave
Rules for when the bot should automatically leave a Space:

```js
const autoLeaveRules = {
  maxDuration: 7200,           // Leave after 2 hours
  minListeners: 5,             // Leave if audience drops below 5
  silenceTimeout: 600,         // Leave if no one speaks for 10 minutes
  hostLeft: true,              // Leave if the Space host leaves
  kicked: true,                // Handle being kicked gracefully
  spaceEnded: true             // Detect Space ending
}
```

### 4. Admin UI — Schedule Manager

```
┌─ SCHEDULES ──────────────────────────────────┐
│                                               │
│  [+ New Schedule]                             │
│                                               │
│  ┌─ Daily Crypto Space ──── ● Enabled ──────┐│
│  │ URL: x.com/i/spaces/1abc...              ││
│  │ Schedule: Daily at 2:00 PM ET            ││
│  │ Duration: 1 hour                          ││
│  │ Agents: 2 (crypto-degen, tech-analyst)   ││
│  │ Next run: Today 2:00 PM                   ││
│  │ [Edit] [Disable] [Run Now] [Delete]       ││
│  └───────────────────────────────────────────┘│
│                                               │
│  ┌─ Space Discovery ──── ○ Disabled ────────┐│
│  │ Watching: @elonmusk, @VitalikButerin     ││
│  │ Keywords: crypto, AI                      ││
│  │ Mode: Notify only                         ││
│  │ [Configure] [Enable]                      ││
│  └───────────────────────────────────────────┘│
└───────────────────────────────────────────────┘
```

### 5. Event Hooks
Allow users to define actions triggered by events:

```json
{
  "hooks": {
    "onJoinSpace": ["log", "notify-discord"],
    "onLeaveSpace": ["log", "save-transcript"],
    "onSpaceEnd": ["log", "save-transcript", "notify-discord"],
    "onError": ["log", "notify-discord", "auto-rejoin"]
  }
}
```

Start simple — just "log" and "save-transcript". Discord/Slack webhooks can be added later.

## New Dependencies
```json
"node-cron": "^3.0.0"
```

## Implementation Steps
1. Add `node-cron` and create schedule loader
2. Build schedule manager (CRUD for schedules)
3. Implement scheduled join logic (start bot → join → auto-leave)
4. Add auto-leave rules to space-ui.js
5. Build admin UI schedule manager
6. (Optional) Add Space discovery via X API
7. (Optional) Add event hooks system

## Validation
- [ ] Scheduled join triggers at correct time
- [ ] Bot auto-starts if not running when schedule triggers
- [ ] Bot auto-leaves after duration expires
- [ ] Admin can create/edit/delete schedules
- [ ] Admin can manually trigger a scheduled join ("Run Now")
- [ ] Schedule persists across server restarts
- [ ] Multiple schedules work without conflicts


