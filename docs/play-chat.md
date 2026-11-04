# World chat in /play: scrollback and the community board

World chat is the conversation in the chat panel at the bottom right of every `/play` world. Each coin world (and its Holders tier) has its own. This page covers the two things that turn it from a relay into a place with a memory: the **scrollback** a late joiner sees, and the read-only **Board** tab that shows the coin's persisted community posts.

## What a player sees

- **Joining a quiet world.** The panel shows "No messages yet." with a **Say hi** button that puts the cursor in the chat box.
- **Joining a world mid-conversation.** The last 60 lines appear at once, slightly muted, each stamped with when it was actually said (`14:05` today, `Nov 3, 14:05` on an earlier day). A **You're caught up** divider separates them from what arrives live.
- **Screen readers** hear "12 earlier messages" once, not the whole tail read aloud. The history block sits under `aria-live="off"` inside the `role="log"` region, so only new live lines are announced.
- **Nobody loses their place.** A reader scrolled up keeps the exact line under their eye when the tail lands; a reader at the bottom stays at the bottom; focus is never moved.
- **Reconnecting** (a dropped Wi-Fi, a server restart) does not repeat the tail. Only lines said while the player was away are added, below the ones already on screen.
- **Refreshing the page** shows the tail once, with no duplicates of lines that were also relayed live.

## The scrollback

Server: [`multiplayer/src/chat-scrollback.js`](../multiplayer/src/chat-scrollback.js), wired into [`multiplayer/src/rooms/WalkRoom.js`](../multiplayer/src/rooms/WalkRoom.js).

| Setting | Value | Meaning |
| --- | --- | --- |
| `SCROLLBACK_CAP` | 200 lines per world | Trimmed on every write. A trimmed line is gone for good. |
| `SCROLLBACK_TTL_S` | 3 days | The key expires 3 days after the last line, and any line older than 3 days is dropped on read even in a busy world. |
| `JOIN_TAIL` | 60 lines | Sent on join in one `chat_history` message. |

The values live at the top of the module; change them there only.

**One message, once per session.** After the client sends `ready`, the room sends the join snapshot, then one `chat_history` message `{ lines: [{ mid, name, text, ts }, ...] }` oldest first, then the presenter PA sync. An empty world gets `{ lines: [] }`. Measured with the Colyseus encoder, a full 60-line tail of maximum-length lines is 16.2 KB and a typical tail is about 5.6 KB.

**Message ids.** Every relayed `chat` broadcast now carries `mid`, the same id stored in the scrollback. The client keeps a set of ids on screen and drops a line it already has, which covers the overlap between the tail and the live relay and a reconnect re-sending the tail.

**What gets stored.** Only lines that passed the room's chat cooldown (one line per 700 ms per player) and its hate-slur gate. The module re-checks the slur gate itself, so no caller can store one by mistake. Party chat is never stored: it is relayed by the party service, not world chat.

**Privacy.** A stored line is `{ mid, name, text, ts }` and nothing else: no session id, account id, wallet address or IP. A display name that is itself a wallet address is shortened (`FeMb…pump`, `0x5290…9ee7`). Text is capped at 200 characters and names at 24. This is not an archive: nothing outlives the cap or the 3-day window.

**Storage.** The same Upstash Redis the activity feed uses (`UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`), as one list per world (`chat:scrollback:<coin>` or `chat:scrollback:<coin>#holders`), written with one `LPUSH` + `LTRIM` + `EXPIRE` pipeline so a write can never leave the list over the cap. Without Redis the server keeps the scrollback in process memory, per instance. Every call is best-effort: Redis down means no history, never a failed chat line or a thrown error in a room handler.

Client: [`src/game/chat-log-view.js`](../src/game/chat-log-view.js) renders the log, [`src/game/community-net.js`](../src/game/community-net.js) re-emits `chat_history` as the `chatHistory` event, and [`src/game/coincommunities.js`](../src/game/coincommunities.js) hands it to the panel. The DOM is capped at 200 rows; history is trimmed before live lines.

## The Board tab

[`src/game/community-board.js`](../src/game/community-board.js) shows the coin's persisted community stream (the posts people make on the coin's community page) inside the chat panel, through the same-origin proxy `GET /api/community/messages?token=<mint>` ([`api/community/messages.js`](../api/community/messages.js)).

- **Only when connected.** The World / Board tab bar appears only when `GET /api/community/capabilities` reports `configured: true`. One capabilities read per page load answers for every world. A deployment without community boards shows plain world chat, with no dead tab.
- **Lazy.** Nothing loads until the tab is opened. A second open within 60 seconds reuses what is shown; the ↻ button refreshes on demand.
- **Every state is designed.** A skeleton while loading (the panel is `aria-busy`), an empty board ("Posts made on this coin's community page show up here."), an unreachable server with a **Try again** button, and a deployment that is not connected ("This server isn't connected to community boards.") with no retry.
- **Safe rendering.** Post text is text, never markup. Avatars load only from `https://` with `referrerPolicy="no-referrer"`. A poster's wallet is never printed.
- **Keyboard.** The tabs follow the ARIA tabs pattern: arrow keys, Home and End move between World and Board.

### Why the board is read-only from the world

World chat never writes into the board. A board post is a public, permanent record made by a signed-in account; a world line is room talk from anyone, guests included, that expires after three days. Silently promoting one into the other would publish words their author meant to be ephemeral, under an identity they did not choose to post with. Posting stays on the coin's community page, where the author knows it is permanent.

### Turning the board on

The proxy needs `CC_API_KEY` on the API service. Without it, `/api/community/capabilities` reports `configured: false` and the tab stays hidden. After the key is set on Cloud Run (`gcloud run services update three-ws-api --region us-central1 --update-env-vars CC_API_KEY=...`), the tab appears on the next page load with no deploy.

## Tests

- [`tests/chat-scrollback.test.js`](../tests/chat-scrollback.test.js): cap and trim, TTL, dedupe by id, privacy, unrecoverable trim, best-effort storage, and the one-message join handshake in `WalkRoom`.
- [`tests/chat-log-view.test.js`](../tests/chat-log-view.test.js): empty state, the divider, stamps, the single announcement, one DOM append, dedupe, reconnect, scroll position, focus, the row cap.
- [`tests/community-board.test.js`](../tests/community-board.test.js): lazy load, skeleton, rendering without the wallet, text-not-markup, https-only avatars, empty, error with retry, unconfigured, staleness, and a slow answer for a world already left.
- [`tests/community-net-chat-history.test.js`](../tests/community-net-chat-history.test.js): the `chatHistory` client event.

Related: [Parties in /play](./play-parties.md) (the party chat scope), [How /play stays safe, honest, and light](./play-hardening.md).
