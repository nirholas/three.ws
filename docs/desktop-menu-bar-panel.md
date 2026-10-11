# Menu bar panel (three.ws desktop app)

Click the three.ws icon in the macOS menu bar (or the Windows tray) and a small
panel drops down with your agent alive in 3D and the numbers you would
otherwise open the console for. Right-click the icon for the full menu.

## What it shows

- **Your agent, in 3D.** The published walk embed, loaded for the selected
  agent and driven over its documented postMessage contract (the same one the
  desktop companion uses), so the panel carries no 3D code. The avatar reacts
  to the local runtime: it waves when something needs your approval, walks while
  agents work, and stands idle otherwise.
- **Wallet balance.** SOL in the selected agent's Solana wallet, with a
  click-to-copy address. If the balance cannot be read the address stays and the
  panel says so.
- **Start and stop.** The power button starts or stops the selected cloud agent
  (`POST /api/v1/agents/:id/start|stop`).
- **Local agents.** One tile pauses or resumes every local agent.
- **Approvals.** A card appears when a local agent is waiting on you. Review
  opens the same native confirmation dialog the tray uses. The panel has no
  approve call: the dialog is built in the main process from the stored
  approval and its hash, so what you approve is what you were shown.
- **Alerts.** Unread notification count, one click to the inbox.
- **Companion.** A switch for the on-screen companion character.
- **Ask.** A one-line box that sends a message to the selected agent and shows
  the reply, using the same chat endpoint as the console.

On macOS the menu bar title shows how many approvals are waiting (or the unread
count) next to the icon, and nothing when there is nothing to do. The balance is
deliberately not shown in the menu bar, so a shared screen never leaks it.

## How it works

| Piece | File |
| --- | --- |
| Pure logic (placement, avatar state, formatting) | `apps/desktop/src/panel/model.js` |
| Window, data aggregation, IPC | `apps/desktop/src/main/panel.js` |
| Sandboxed bridge | `apps/desktop/src/panel-preload.cjs` |
| Renderer | `apps/desktop/src/panel/{index.html,panel.css,panel.js}` |

The main process builds one snapshot from caches (cloud agents, wallet, local
runtime, unread, companion) and pushes it on every change. The network-backed
parts refresh when the panel opens, every 45 seconds while it is open and every
five minutes while it is closed. The panel hides on blur and positions itself
under the icon (above a taskbar), clamped to the display's work area. On Linux,
where the OS reports no icon bounds, it anchors at the cursor and the tray menu
stays attached to the icon.

Signed out, the panel shows a sign-in prompt that opens the console.

Tests: `tests/desktop-panel.test.js`.
