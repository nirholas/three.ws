# src/desktop/assistant

The desktop assistant: a chat pane docked to the right edge, opened from the
taskbar. It answers through `/api/chat` (streamed over SSE, works signed out),
knows every desktop app and can open one from its reply, and can switch to any
public agent so you talk to that agent's own persona. Guide:
[docs/desktop-widgets.md](../../../docs/desktop-widgets.md#assistant).

| File | Role |
| --- | --- |
| `logic.js` | Pure helpers: the grounding system prompt (kept under the API's 2000 characters, lists app ids), `parseActions` for `[[open:appId]]` tags (unknown ids dropped), `hidePartialTag` while streaming, `trimHistory` (last 20 turns), a safe Markdown renderer (escaped first, http(s) and same-site links only), starter suggestions. Unit tested in `tests/desktop-assistant.test.js` |
| `index.js` | The pane: `toggleAssistant(ctx)` / `closeAssistant()`, the agent picker over `/api/agents/public`, streaming with stop, rate-limit and sign-in errors, Open-app buttons, conversation saved under `tws-assistant:v1` and synced across tabs. Failed turns never enter the model history |
| `assistant.css` | Pane, picker, messages, composer; full width under 640 px; reduced motion |
