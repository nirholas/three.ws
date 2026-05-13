# Task 05: Onboarding Flow

## Context
New users who open the admin panel have zero guidance. They see an empty dashboard with no agents running and no idea what to do. We need a first-run experience.

## Requirements

### Detection
- Check `localStorage` for `xspace_onboarded` flag
- If not set, show the onboarding wizard instead of the dashboard
- Add a "Skip setup" link and a way to re-trigger from Settings

### Wizard Steps

**Step 1: Welcome**
- Headline: "Welcome to xspace"
- Subtext: "Let's get your first AI agent running in a live X Space. This takes about 2 minutes."
- Animated orb visual (reuse from landing page)
- "Let's go" button

**Step 2: Authentication**
- Explain the two auth methods: Cookie auth (recommended) vs Username/Password
- For cookie auth: step-by-step instructions with screenshots showing how to get `X_AUTH_TOKEN` and `X_CT0` from browser DevTools
- Input fields for the tokens with validation (check format, not empty)
- "Test Connection" button that hits the server to verify tokens work
- Show success/failure state with clear error messages

**Step 3: AI Provider**
- Card selection UI for: OpenAI, Claude, Groq
- Each card shows: logo, name, what it's used for, which API key is needed
- Input field for the selected provider's API key
- "Verify" button that makes a minimal API call to confirm the key works
- Optional: ElevenLabs TTS key input (shown as "enhance your agent's voice")

**Step 4: Create Agent**
- Agent name input (pre-filled with a fun default like "Agent Smith")
- Personality textarea (pre-filled with a good default)
- Provider selection (pre-selected from step 3)
- TTS voice selection dropdown (if ElevenLabs key provided)
- Preview card showing how the agent will appear

**Step 5: Join a Space**
- Input for X Space URL
- "Join Space" button that triggers the agent
- Real-time status updates as the agent: launches browser → authenticates → joins Space → requests speaker access
- Each step shows a checkbox/spinner/checkmark
- On success: confetti animation + "Your agent is live!" message

**Step 6: Done**
- "Your agent is talking!" with link to view the live chat
- Quick links: "View admin dashboard", "Read the docs", "Join our Discord"
- Set `xspace_onboarded = true` in localStorage

### UI/UX
- Full-screen modal overlay with step indicator (dots or progress bar)
- Smooth slide transitions between steps
- Back button on every step (except step 1)
- All state persisted in sessionStorage so refreshing doesn't lose progress
- Responsive — works on mobile (though primary use case is desktop)
- Match the landing page design system (dark theme, glassmorphism, same fonts)

### Server Endpoints Needed
If they don't exist, create them:
- `POST /api/auth/verify` — verify X auth tokens
- `POST /api/providers/verify` — verify an API key for a given provider
- `POST /api/agents/create` — create an agent with config
- `POST /api/agents/:id/join` — join a Space URL

## Files to Create
- `public/js/onboarding.js` — wizard logic and UI
- `public/css/onboarding.css` — wizard styles

## Files to Modify
- `public/admin.html` — add onboarding trigger
- Server routes if verification endpoints don't exist

## Acceptance Criteria
- [ ] First-time visitor sees the wizard automatically
- [ ] Each step validates before allowing "Next"
- [ ] Token/key verification provides clear pass/fail feedback
- [ ] Agent successfully joins a Space at the end of the flow
- [ ] Wizard can be dismissed and re-triggered from Settings
- [ ] Works on Chrome, Firefox, Safari
- [ ] Mobile responsive (stacks cleanly on small screens)


