# Chat Improvements — Dispatch Index

Eight independent tasks. Each can be run in a fresh chat with no knowledge of the others.

Run them in any order — none depends on another except where noted.

---

## Tasks

| File | Task | Effort | Notes |
|------|------|--------|-------|
| [01-agent-system-prompt.md](./01-agent-system-prompt.md) | Wire agent system_prompt + greeting into chat | ~2h | Highest impact — agents currently have no personality in chat |
| [02-tool-search.md](./02-tool-search.md) | Implement tool search in ToolDropdown | ~30m | Uncomment + wire the existing commented-out search input |
| [03-consensus-mode.md](./03-consensus-mode.md) | Wire up multi-model Consensus mode | ~2h | Backend exists, all UI is commented out — just needs unwiring |
| [04-message-deletion-sync.md](./04-message-deletion-sync.md) | Complete message deletion in sync | ~1h | `deletedMessages` from sync is received but ignored |
| [05-tradingview-tool-fix.md](./05-tradingview-tool-fix.md) | Verify + fix TradingViewChart tool | ~1h | Verify escape chain and return shape are correct |
| [06-tool-pack-marketplace.md](./06-tool-pack-marketplace.md) | Add tool pack install UI to ToolDropdown | ~3h | Browse + install curated tool packs from a modal |
| [07-knobs-sidebar-audit.md](./07-knobs-sidebar-audit.md) | Audit and fix KnobsSidebar FIXME | ~1h | Unknown FIXME on line 2 — investigate and resolve |
| [08-agent-marketplace-page.md](./08-agent-marketplace-page.md) | Add Tools tab to marketplace page | ~2h | Vanilla HTML/JS — adds tool pack discovery to /marketplace |
| [09-auto-install-tool-pack.md](./09-auto-install-tool-pack.md) | Auto-install tool pack from URL param | ~30m | Reads `?install=PACK_ID` on chat load and installs the pack |

---

## Dependency note

Task **09** references `curatedToolPacks` from `tools.js` (added in task **06**). If running 09 before 06, check whether `curatedToolPacks` already exists at the top of `chat/src/tools.js`. If not, add a minimal version as described in the prompt.

Task **08** (marketplace page) and task **09** (auto-install) form a pair — 08 is the discovery surface, 09 is the install side. They can still be run independently.

---

## House rules (apply to all tasks)

- One deliverable per task, one PR per task
- No scope creep — note unrelated bugs but don't fix them
- Prefer editing existing files to creating new ones
- Match existing code style (tabs, Svelte reactive syntax, Tailwind classes)
- Verify with `cd chat && npx vite build` after any Svelte changes
- End each session with a reporting block: what shipped, what was skipped, what broke, unrelated bugs noticed
