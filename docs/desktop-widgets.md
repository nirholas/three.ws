# Desktop widgets and assistant

The web desktop at `/` has two live surfaces beside its windows: **widgets**,
small cards of real data that sit on the desktop or on the widgets board, and
the **assistant**, a chat pane that knows the platform and can open apps for
you. Neither shows sample data. When a source is down the card says what failed
and offers a retry, and stale numbers are labelled as stale.

## Widgets

| Widget | What it shows | Source |
| --- | --- | --- |
| $THREE | Price, 24 h change, market cap, a 24 hour chart | `/api/three-token/stats`, `/api/pump/price-history` |
| Weather | Conditions, feels-like, the next hours; at large size humidity and wind | Open-Meteo, for your saved city or your location |
| Clock | Analog face, local time and date | This device |
| Calendar | The month, starting on your locale's first weekday | This device |
| New agents | The newest public agents, each opening its profile | `/api/agents/public?sort=newest` |
| Pulse | Live wallet moves by agents | `/api/pulse` |
| Launches | Coins agents launched through three.ws | `/api/pump/launches` |
| Platform | Agents, launches and strategies right now | `/api/stats` |
| Headlines | Top stories from the three.ws news desk | `/api/news/feed` |
| System | Battery, network, memory and storage | Browser APIs; anything the browser does not expose is left out |
| Sticky note | Your own text, saved as you type | This browser |

Most widgets come in small (1 x 1), medium (2 x 1) and large (2 x 2), and each
renders a layout made for its size rather than a scaled copy. Feeds are shared:
a $THREE card on the desktop and another on the board make one request, polls
pause while the tab is hidden and refresh the moment it returns.

### On the desktop

Widgets sit on a grid along the right edge of the desktop.

- **Move:** drag a widget by its header. A ghost shows the cell it will land in;
  drops onto an occupied cell are refused.
- **Resize, refresh, open, remove:** right-click a widget or use its `...` button.
- **Edit mode:** right-click the desktop, **Edit widgets**. Every widget shows a
  remove button and a bar offers **Add widget** and **Done** (Escape also exits).
- **Add:** right-click the desktop, **Add a widget**. The gallery shows a live
  preview of each widget at each size before you add it.

The layout follows the screen: on a smaller window widgets re-flow into the
first free cells, and under 640 px wide the desktop layer hides and widgets
live on the board only.

### The board

The taskbar's Widgets button (or Ctrl+Alt+W) opens the board: a greeting with
the date, your board widgets, and a news column with the lead story expanded.
Each board widget can be pinned to the desktop, moved up or removed, and
**Add widget** opens the same gallery. Escape, a click outside or focusing a
window closes it.

## Assistant

The taskbar's Assistant button (or Ctrl+Alt+C) opens a pane on the right edge.

- **Ask anything about three.ws.** Replies stream from `/api/chat` and work
  signed out. The assistant is grounded on the date, $THREE and the desktop's
  app list, and never asks for keys or seed phrases.
- **It opens apps.** When an app would help, the reply ends with buttons such as
  **Open Create**; only real desktop apps can appear.
- **Talk to an agent.** Click the name in the header to search public agents
  and switch to one; the conversation then uses that agent's persona and brain.
- **Stop, retry, start over.** The send button becomes Stop while a reply
  streams, a failed reply shows why (rate limit, sign-in needed, network) and
  is left out of the conversation history, and the new-chat button clears it.
- Enter sends, Shift+Enter adds a line. The conversation is saved in this
  browser and stays in sync across tabs.

## Storage

Everything is local to the browser: `tws-widgets:desktop`, `tws-widgets:board`
and `tws-widgets:place` for widgets, `tws-assistant:v1` for the conversation.
Clearing site data resets both to their defaults.

## Code

[src/desktop/widgets/](../src/desktop/widgets/README.md) and
[src/desktop/assistant/](../src/desktop/assistant/README.md). Pure rules are
unit tested in `tests/desktop-widgets.test.js` and
`tests/desktop-assistant.test.js`. The shell wires the taskbar buttons,
shortcuts and desktop menu in `src/desktop/shell.js`. See also
[desktop.md](desktop.md) for the rest of the desktop and [field.md](field.md)
for the Field at `/?view=field`.
