# Daily agent digest by email

A morning email that shows how your three.ws agents are doing and what is new on the platform.

## What it does

1. **Trigger:** Recurrence, every day at 08:00 in the time zone you set.
2. **three.ws "List my agents"** returns every agent your account owns.
3. **three.ws "Search public agents"** with sort `newest`, limit 5, and avatar `1` returns the five newest public agents that have a 3D body. It runs in parallel with step 2.
4. Two "Create HTML table" actions lay out your agents (name, chat count, last update, page) and the newest agents (name, description, page).
5. Outlook "Send an email (V2)" sends the digest. With no agents yet, the email links to https://three.ws/create instead of an empty table.

## Before you import

- A three.ws account with at least one agent, signed in on the three.ws connection. The digest is per account: it shows the agents of whoever signed in.
- An Office 365 Outlook mailbox to send from.

## Parameters

| Parameter | What to enter |
|---|---|
| Digest recipient | The address that gets the email |
| Time zone | A Windows time zone name, for example `Pacific Standard Time` (default `UTC`) |

## Import

Import `workflow.json` as described in [the templates README](../README.md), map the three.ws and Outlook connection references, and fill in the parameters. Use "Test" then "Manually" to send one right away.
