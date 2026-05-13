# Task 06: Admin Dashboard V2

## Context
The admin panel at `public/admin.html` has a sidebar nav and page structure but the individual pages need real data, proper visualizations, and polish. Currently many pages are shells.

## Requirements

### Dashboard Page (Home)
- **Status cards row**: Active agents (count), Current Space (name/link), Uptime, Total messages today
- **Real-time chart**: Messages per minute over the last hour (use a lightweight chart lib — Chart.js or uPlot via CDN)
- **Agent status cards**: For each configured agent, show name, state (FSM state), current audio level, message count. Clicking opens the agent detail view.
- **Recent activity feed**: Last 20 events (agent joined, agent spoke, error occurred, user message received) with timestamps
- **System health**: Provider status (green/red dots for each configured LLM/STT/TTS), browser connection status, memory usage
- **Empty state**: If no agents configured, show a friendly illustration and "Create your first agent" CTA that links to the onboarding wizard

### Agents Page
- **Agent list**: Table/grid of all configured agents with: name, personality snippet, provider, state, actions (start/stop/edit/delete)
- **Create agent modal**: Name, personality, LLM provider, TTS provider, voice selection, system prompt — with form validation
- **Agent detail view**: Click an agent to see:
  - Full configuration (editable)
  - State machine visualization (current state highlighted)
  - Conversation history for this agent
  - Provider metrics (tokens used, cost estimate, latency avg)
  - Start/Stop/Restart buttons with confirmation modals

### Knowledge Page
- **Document list**: Show uploaded/configured knowledge base files
- **Upload UI**: Drag-and-drop zone for adding documents
- **Preview**: Click a document to preview its content
- If knowledge base isn't implemented in the backend, show a "Coming Soon" state with explanation

### History Page
- **Conversation list**: Date-grouped list of past sessions
- **Session detail**: Click to view full transcript with:
  - Speaker labels (agent/user/unknown)
  - Timestamps
  - Audio level indicators (if available)
  - Search within transcript
  - Export as JSON/TXT button
- **Filters**: Date range picker, agent filter, text search

### Settings Page
- **Sections**: General, Authentication, Providers, Audio, Advanced
- **General**: Server port, headless mode toggle, log level select
- **Authentication**: X auth token inputs with mask/reveal, test button
- **Providers**: For each provider type (LLM/STT/TTS), show current selection and API key input with verify button
- **Audio**: VAD sensitivity slider, silence threshold slider, TTS voice selection
- **Advanced**: Browser mode (managed/connect), custom Puppeteer args, middleware config
- **Save button**: Persists to server config, shows success toast
- **Reset to defaults**: With confirmation modal

### Shared UI Components
- **Toast notifications**: Success/error/info toasts that auto-dismiss (top-right corner)
- **Confirmation modals**: Reusable "Are you sure?" dialog
- **Loading skeletons**: Pulse animation placeholders while data loads
- **Empty states**: Friendly illustrations + CTA for every page when there's no data
- **Connection status**: Header indicator that shows real-time Socket.IO connection state with reconnection attempts

### Real-time Updates
- All dashboard data should update via Socket.IO events, not polling
- Agent state changes reflect immediately
- New messages appear in real-time in history
- Provider health checks run periodically and update status dots

## Files to Modify
- `public/admin.html`
- `public/js/admin.js`
- `public/js/pages/dashboard.js`
- `public/js/pages/agents.js`
- `public/js/pages/knowledge.js`
- `public/js/pages/history.js`
- `public/js/pages/settings.js`
- `public/css/admin.css`

## Files to Create
- `public/js/components/toast.js`
- `public/js/components/modal.js`
- `public/js/components/chart.js`
- `public/js/components/skeleton.js`

## Acceptance Criteria
- [ ] Dashboard shows real data from Socket.IO events
- [ ] Agent CRUD operations work end-to-end
- [ ] History page loads and displays past conversations
- [ ] Settings persist when saved and survive server restart
- [ ] Empty states shown for every page when there's no data
- [ ] Toast notifications for all user actions (save, delete, error)
- [ ] No console errors in Chrome/Firefox/Safari
- [ ] Responsive layout works on tablet (1024px) and mobile (768px)
- [ ] Loading states shown while data is being fetched


