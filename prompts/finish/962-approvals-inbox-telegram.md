Remaining owner step for the approvals inbox: the inbox, API, /approvals page, web push, signed expiring Telegram buttons, chat commands, auto-approve rules and replay/tamper tests have shipped (see docs/approvals.md). What is left is a live check with a real throwaway Telegram bot, which needs a bot token from @BotFather.

1. Put the token in `TELEGRAM_BOT_TOKEN` (local `.env`), run `server/index.mjs` on a spare port with `--env-file`, and pair a chat with `/link`.
2. Create an approval request for a paper-mode swap, confirm the message shows the full confirmation table with Approve and Deny buttons, tap Approve twice (second tap must be a no-op), and let one request expire (button must fail closed).
3. Report what the chat showed. CLAUDE.md spend gate applies: use paper mode or devnet only.
