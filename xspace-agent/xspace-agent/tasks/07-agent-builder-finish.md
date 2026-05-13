# Task 07: Complete the Visual Agent Builder

## Context
`public/builder.html` has a node-based visual programming interface (like Node-RED/Zapier). The drag-and-drop canvas, node types, and connection drawing work at a basic level, but templates are empty, node configuration doesn't persist, and there's no working deploy flow.

## Requirements

### Working Templates
Populate the templates gallery modal with 5 pre-built agent flows:

1. **Basic Listener** — Trigger(Always On) → Listener(STT) → Processor(LLM) → Responder(Speak)
2. **Debate Agent** — Trigger(Always On) → Listener(STT) → Processor(LLM with debate personality) → Modifier(Cooldown 30s) → Responder(Speak)
3. **Moderator** — Trigger(Keyword "question") → Listener(STT) → Processor(LLM with moderator prompt) → Logic(Conditional: is question?) → Responder(Speak or Text)
4. **Sentiment Monitor** — Trigger(Always On) → Listener(Sentiment Monitor) → Logic(Conditional: negative?) → Responder(Webhook Out to Slack)
5. **Multi-Agent Coordinator** — Trigger(Schedule every 5min) → Processor(LLM) → Modifier(Rate Limit) → Responder(Speak) + Responder(Handoff to Agent 2)

Each template should:
- Load with pre-positioned nodes and connections
- Have all node properties pre-configured
- Include a description and "Use this template" button in the gallery

### Node Configuration Panel
When a node is selected, the right panel should show editable properties:

- **Trigger nodes**: Schedule cron input, webhook URL, keyword list
- **Listener nodes**: Provider selection (Groq/OpenAI for STT), sensitivity slider, language select
- **Processor nodes**: LLM provider select, model select, system prompt textarea, temperature slider, max tokens input
- **Responder nodes**: TTS provider select, voice select, speed slider; or webhook URL + headers for webhook out
- **Modifier nodes**: Cooldown duration input, rate limit (requests/minute), priority level select
- **Logic nodes**: Condition builder (field, operator, value)

All properties should save to the node's data object and persist in the flow JSON.

### Save & Load
- **Save**: Serialize the entire flow (nodes, connections, positions, properties) to JSON
- **Save to server**: `POST /api/flows` with the flow JSON
- **Load from server**: `GET /api/flows` returns list, `GET /api/flows/:id` returns a specific flow
- **Local save**: Also save to localStorage as backup
- **Auto-save**: Debounced auto-save every 30 seconds if changes detected
- **Flow list**: Show saved flows in a dropdown in the toolbar

### Validate
The "Validate" button should check:
- Every flow has at least one Trigger and one Responder
- All required node properties are filled in
- No disconnected nodes (every node has at least one connection)
- No circular dependencies
- Show validation results in a panel with clickable errors that highlight the problem node

### Test Panel
The slide-in test panel should:
- Simulate the flow by sending a test message through the pipeline
- Show step-by-step execution: which node is processing, what data is being passed
- Display the final output (what the agent would say)
- Allow typing test input (simulating what a speaker in the Space says)
- Show latency for each step

### Deploy
The "Deploy" button should:
1. Validate the flow first (block deploy if invalid)
2. Convert the visual flow to an agent configuration JSON
3. `POST /api/agents/deploy` with the configuration
4. Show deployment progress (creating agent → configuring → ready)
5. On success: show "Agent deployed!" with link to admin dashboard
6. On failure: show error with suggestion

### UX Polish
- Undo/redo (Ctrl+Z / Ctrl+Shift+Z) — keep a history stack of flow states
- Delete key removes selected node or connection
- Double-click a node to edit its name inline
- Zoom controls (mouse wheel + buttons) with a minimap in the corner
- Snap-to-grid for node positioning
- Connection validation: only allow valid connections (e.g., trigger output → listener input, not trigger → trigger)
- Copy/paste nodes (Ctrl+C/V)

## Server Endpoints Needed
- `GET /api/flows` — list saved flows
- `GET /api/flows/:id` — get a specific flow
- `POST /api/flows` — save a flow
- `PUT /api/flows/:id` — update a flow
- `DELETE /api/flows/:id` — delete a flow
- `POST /api/flows/:id/validate` — validate a flow
- `POST /api/flows/:id/test` — run a test execution
- `POST /api/agents/deploy` — deploy a flow as a running agent

## Files to Modify
- `public/builder.html` — main builder file

## Files to Create
- `public/js/builder/templates.js` — template definitions
- `public/js/builder/validator.js` — flow validation logic
- `public/js/builder/serializer.js` — save/load/deploy logic

## Acceptance Criteria
- [ ] All 5 templates load correctly with pre-configured nodes
- [ ] Node properties are editable and persist in the flow
- [ ] Save/Load works (both localStorage and server API)
- [ ] Validation catches all error cases and highlights problem nodes
- [ ] Test panel shows step-by-step execution with simulated output
- [ ] Deploy converts flow to agent config and starts the agent
- [ ] Undo/redo works for all operations
- [ ] Keyboard shortcuts work (Delete, Ctrl+Z, Ctrl+C/V)
- [ ] Canvas zoom and pan work smoothly


