# Task 08: Live Chat UI Polish

## Context
`public/index.html` is the main "swarmsy" live agent conversation interface. It works but feels like a tech demo. It needs polish to feel like a product.

## Requirements

### Header
- Add nav links: "Admin" (→ /admin), "Builder" (→ /builder), "Docs" (→ external docs URL)
- Add a connection status indicator (green dot + "Connected" / red + "Reconnecting...")
- Add a "Share" button that copies the current page URL

### Agent Display
- Support dynamic number of agents (not hardcoded Bob/Alice) — fetch agent config from `/api/agents`
- Agent names and colors should come from the server config
- Add agent avatar/icon support (could be emoji, initials, or uploaded image)
- When an agent is in "thinking" state (between STT and LLM response), show a pulsing animation on the orb
- Add a subtle connecting line or particle effect between the two orbs when both agents are active

### Chat Panel
- Add message timestamps (relative: "2m ago", absolute on hover)
- Add message grouping — consecutive messages from the same speaker are grouped
- Add "scroll to bottom" button when user has scrolled up
- Add unread message count badge when scrolled up
- Support markdown rendering in messages (bold, italic, code, links)
- Add a "Clear chat" button (with confirmation)
- Add message reactions (optional, for fun — thumbs up/down on AI messages)

### Audio Visualization
- Replace the simple bar visualizer with a smoother waveform or circular visualizer
- Add a subtle background pulse on the entire page when an agent is speaking
- Audio level should smoothly interpolate (currently jumpy)

### User Input
- Add character count indicator
- Add slash commands: `/help`, `/clear`, `/agents` (lists active agents)
- Show typing indicator when user is typing (broadcast to other connected users via Socket.IO)
- Support sending with Ctrl+Enter as alternative to Enter
- Add input history (up arrow to recall previous messages)

### Mobile
- On mobile, the chat panel should be a bottom sheet that can be swiped up
- The orbs should be smaller and side-by-side on mobile
- The speech bubbles should be collapsible on mobile (tap to expand)

### Empty/Loading States
- Before Socket.IO connects: show a clean loading state with "Connecting to Space..."
- When no agents are active: show the orbs grayed out with "No agents active. Start one from the Admin panel."
- When agents are active but not speaking: show "Listening..." state

### Sound
- Optional notification sound when an agent starts speaking (muted by default, toggle in header)
- Sound toggle icon in the header

## Files to Modify
- `public/index.html`

## Acceptance Criteria
- [ ] Dynamic agent loading from server API
- [ ] Message timestamps and grouping work
- [ ] Scroll-to-bottom button appears and works
- [ ] Markdown rendering in messages
- [ ] Smooth audio visualization
- [ ] Mobile bottom sheet for chat works on iOS and Android
- [ ] Empty/loading states are clear and helpful
- [ ] No flickering or layout shifts during real-time updates


